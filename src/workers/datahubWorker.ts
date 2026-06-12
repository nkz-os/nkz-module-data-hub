/// <reference lib="webworker" />

/**
 * DataHub Worker — V2.1
 *
 * Per-series typed array output (spec: internal-docs/specs/2026-04-25-datahub-worker-contract-v2-1.md).
 * Each series owns its own xs/ys Float64Array. Multi-series rendering uses uPlot mode 2.
 *
 * Pipeline per series: fetch → parse → normalize → gap injection → segmented MinMaxLTTB → transfer.
 * Cross-series merging removed; that was the source of the alignment-NaN render bug in V2.
 */

import type {
  DatahubWorkerMessage,
  DatahubWorkerRequest,
  DatahubWorkerResponse,
  PerSeriesStats,
  WorkerError,
  WorkerSeriesPayload,
  WorkerSeriesSpec,
  WorkerStats,
} from './contracts/datahubWorkerV2';
import { parseSingleSeriesPayload } from './parsing';
import {
  cacheKey,
  computeDomains,
  countFinite,
  downsampleSingle,
  injectGapsSingle,
  selectEvictions,
} from './pipeline';

const WORKER_BUILD = 'v2.1-per-series-2026-04-25';
const CACHE_BUDGET_MB = 128;
const CACHE_BUDGET_BYTES = CACHE_BUDGET_MB * 1024 * 1024;

interface CachedSeries {
  key: string;
  xs: Float64Array;
  ys: Float64Array;
  bytes: number;
  lastAccess: number;
  /** Cached per-series stats so we don't recompute on every cache hit. */
  stats: PerSeriesStats;
}

const seriesCache = new Map<string, CachedSeries>();

// ────────────────────────────────────────────────────────────────────────────
// Cache
// ────────────────────────────────────────────────────────────────────────────

function evictCacheIfNeeded(): void {
  const entries = [...seriesCache.values()].map(({ key, bytes, lastAccess }) => ({
    key,
    bytes,
    lastAccess,
  }));
  for (const key of selectEvictions(entries, CACHE_BUDGET_BYTES)) {
    seriesCache.delete(key);
  }
}

function releaseCacheKeys(keys: string[]): void {
  for (const key of keys) {
    if (!key) continue;
    seriesCache.delete(key);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Fetch
async function fetchSingleSeries(
  req: DatahubWorkerRequest,
  item: WorkerSeriesSpec
): Promise<{ xs: Float64Array; ys: Float64Array }> {
  const base = req.baseUrl || self.location.origin;

  // URN resolution is handled by the reader (Strangler Fig); BFF passes URNs directly.
  const resolvedEntityId = item.entityId;

  const params = new URLSearchParams({
    start_time: req.startTime,
    end_time: req.endTime,
    resolution: String(req.resolution),
    attribute: item.attribute,
    source: item.source ?? 'timescale',
  });
  const path = `/api/datahub/timeseries/entities/${encodeURIComponent(resolvedEntityId)}/data?${params}`;
  const url = `${base}${path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: req.headers,
    credentials: 'include',
  });
  if (response.status === 204) return { xs: new Float64Array(0), ys: new Float64Array(0) };
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(text || `HTTP ${response.status}`), {
      status: response.status,
    });
  }
  const data = await response.json();
  return parseSingleSeriesPayload(data);
}

async function fetchSingleSeriesWithRetry(
  req: DatahubWorkerRequest,
  item: WorkerSeriesSpec
): Promise<{ xs: Float64Array; ys: Float64Array }> {
  const first = await fetchSingleSeries(req, item);
  if (first.xs.length > 0) return first;
  // Single retry guards against rare empty responses for identical requests.
  return fetchSingleSeries(req, item);
}

// ────────────────────────────────────────────────────────────────────────────
// Per-series pipeline
// ────────────────────────────────────────────────────────────────────────────

async function processOneSeries(
  req: DatahubWorkerRequest,
  item: WorkerSeriesSpec
): Promise<WorkerSeriesPayload> {
  const key = cacheKey(item, req.startTime, req.endTime, req.resolution, req.policy);
  const cached = !req.forceRefresh ? seriesCache.get(key) : undefined;

  if (cached) {
    cached.lastAccess = Date.now();
    // Return cached buffers as-is. NOTE: caller must NOT transfer these — they
    // belong to the cache. We clone before returning to keep cache ownership.
    return {
      key,
      entityId: item.entityId,
      attribute: item.attribute,
      source: item.source ?? 'timescale',
      xs: new Float64Array(cached.xs),
      ys: new Float64Array(cached.ys),
      stats: { ...cached.stats },
    };
  }

  const fetched = await fetchSingleSeriesWithRetry(req, item);
  const rawPointsFetched = fetched.xs.length;

  const withGaps = injectGapsSingle(fetched.xs, fetched.ys, req.policy.maxGapSeconds);

  const downsampled = downsampleSingle(
    withGaps.xs,
    withGaps.ys,
    req.policy.downsampleThreshold,
    req.policy.maxGapSeconds,
    req.policy.preserveExtrema
  );

  const pointsPlotted = countFinite(downsampled.ys);
  const pointsDiscarded = Math.max(
    0,
    rawPointsFetched - pointsPlotted - withGaps.gapsInjected
  );
  const { domainX, domainY } = computeDomains(downsampled.xs, downsampled.ys);

  const stats: PerSeriesStats = {
    rawPointsFetched,
    pointsPlotted,
    gapsInjected: withGaps.gapsInjected,
    pointsDiscarded,
    downsampleRatio: downsampled.downsampleRatio,
    domainX,
    domainY,
  };

  // Cache the post-processed buffers (gap-injected + downsampled) — that's
  // what subsequent identical requests need. We store a *clone* so transfer
  // of the response buffers does not detach the cache.
  if (rawPointsFetched > 0) {
    const cacheEntry: CachedSeries = {
      key,
      xs: new Float64Array(downsampled.xs),
      ys: new Float64Array(downsampled.ys),
      bytes: downsampled.xs.byteLength + downsampled.ys.byteLength,
      lastAccess: Date.now(),
      stats: { ...stats },
    };
    seriesCache.set(key, cacheEntry);
    evictCacheIfNeeded();
  }

  return {
    key,
    entityId: item.entityId,
    attribute: item.attribute,
    source: item.source ?? 'timescale',
    xs: downsampled.xs,
    ys: downsampled.ys,
    stats,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level orchestration
// ────────────────────────────────────────────────────────────────────────────

async function processSeries(req: DatahubWorkerRequest): Promise<DatahubWorkerResponse> {
  const started = performance.now();
  const series: WorkerSeriesPayload[] = [];

  // Run per-series fetches in parallel — they're independent and we want low
  // total latency. fetch() is the dominant cost; cache hits are instant.
  const settled = await Promise.allSettled(
    req.series.map((spec) => processOneSeries(req, spec))
  );

  let firstError: WorkerError | undefined;
  settled.forEach((res, idx) => {
    if (res.status === 'fulfilled') {
      series.push(res.value);
      return;
    }
    const err = res.reason as { status?: number; message?: string };
    const httpStatus = typeof err?.status === 'number' ? err.status : undefined;
    if (!firstError) {
      firstError = {
        code: httpStatus ? 'FETCH_ERROR' : 'PROCESS_ERROR',
        stage: httpStatus ? 'fetch' : 'decode',
        message: err?.message ?? String(res.reason),
        retryable: true,
        seriesKey: cacheKey(req.series[idx], req.startTime, req.endTime, req.resolution, req.policy),
        ...(httpStatus ? { httpStatus } : {}),
      };
    }
  });

  // Aggregate stats across all successful series.
  let agg = {
    rawPointsFetched: 0,
    pointsPlotted: 0,
    gapsInjected: 0,
    pointsDiscarded: 0,
    downsampleRatio: 1,
    domainX: null as [number, number] | null,
  };
  let xMinAll = Number.POSITIVE_INFINITY;
  let xMaxAll = Number.NEGATIVE_INFINITY;
  for (const s of series) {
    agg.rawPointsFetched += s.stats.rawPointsFetched;
    agg.pointsPlotted += s.stats.pointsPlotted;
    agg.gapsInjected += s.stats.gapsInjected;
    agg.pointsDiscarded += s.stats.pointsDiscarded;
    if (s.stats.domainX) {
      if (s.stats.domainX[0] < xMinAll) xMinAll = s.stats.domainX[0];
      if (s.stats.domainX[1] > xMaxAll) xMaxAll = s.stats.domainX[1];
    }
  }
  if (Number.isFinite(xMinAll) && Number.isFinite(xMaxAll)) {
    agg.domainX = [xMinAll, xMaxAll];
  }
  if (series.length > 0) {
    const ratios = series.map((s) => s.stats.downsampleRatio);
    agg.downsampleRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }

  const stats: WorkerStats = {
    rawPointsFetched: agg.rawPointsFetched,
    pointsPlotted: agg.pointsPlotted,
    gapsInjected: agg.gapsInjected,
    pointsDiscarded: agg.pointsDiscarded,
    processingTimeMs: performance.now() - started,
    downsampleRatio: agg.downsampleRatio,
    domainX: agg.domainX,
  };

  return {
    type: 'PROCESS_SERIES_RESULT',
    requestId: req.requestId,
    contractVersion: 2.1,
    workerBuild: WORKER_BUILD,
    series,
    stats,
    ...(firstError ? { error: firstError } : {}),
  };
}

self.onmessage = (event: MessageEvent<DatahubWorkerMessage>) => {
  const msg = event.data;
  if (!msg) return;
  if (msg.type === 'RELEASE_SERIES') {
    releaseCacheKeys(msg.keys ?? []);
    evictCacheIfNeeded();
    return;
  }
  const req = msg;
  if (req.type !== 'PROCESS_SERIES') return;
  (async () => {
    const started = performance.now();
    try {
      const response = await processSeries(req);
      const transferList: Transferable[] = [];
      for (const s of response.series) {
        transferList.push(s.xs.buffer as ArrayBuffer);
        transferList.push(s.ys.buffer as ArrayBuffer);
      }
      self.postMessage(response, transferList);
    } catch (error) {
      const maybeStatus =
        typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status?: unknown }).status)
          : undefined;
      const fallback: DatahubWorkerResponse = {
        type: 'PROCESS_SERIES_RESULT',
        requestId: req.requestId,
        contractVersion: 2.1,
        workerBuild: WORKER_BUILD,
        series: [],
        stats: {
          rawPointsFetched: 0,
          pointsPlotted: 0,
          gapsInjected: 0,
          pointsDiscarded: 0,
          processingTimeMs: performance.now() - started,
          downsampleRatio: 1,
          domainX: null,
        },
        error: {
          code: maybeStatus ? 'FETCH_ERROR' : 'PROCESS_ERROR',
          stage: maybeStatus ? 'fetch' : 'decode',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
          seriesKey: null,
          ...(maybeStatus ? { httpStatus: maybeStatus } : {}),
        },
      };
      self.postMessage(fallback);
    }
  })();
};

export {};
