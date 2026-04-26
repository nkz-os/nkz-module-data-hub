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
// Parsing
// ────────────────────────────────────────────────────────────────────────────

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestampToEpochSeconds(value: unknown): number | null {
  const normalize = (n: number): number => {
    let v = n;
    while (Math.abs(v) > 1e11) v /= 1000;
    return v;
  };
  if (typeof value === 'number' && Number.isFinite(value)) return normalize(value);
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number.parseFloat(t);
      return Number.isFinite(n) ? normalize(n) : null;
    }
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms / 1000 : null;
  }
  return null;
}

function parseSingleSeriesPayload(data: unknown): { xs: Float64Array; ys: Float64Array } {
  const payload = (data ?? {}) as Record<string, unknown>;
  const timestamps = Array.isArray(payload.timestamps) ? payload.timestamps : [];
  const rawValues = Array.isArray(payload.values)
    ? payload.values
    : Array.isArray(payload.value_0)
      ? payload.value_0
      : [];
  const len = Math.min(timestamps.length, rawValues.length);
  const tmpX = new Float64Array(len);
  const tmpY = new Float64Array(len);
  let w = 0;
  for (let i = 0; i < len; i++) {
    const x = timestampToEpochSeconds(timestamps[i]);
    if (x == null) continue;
    tmpX[w] = x;
    const y = toFiniteNumber(rawValues[i]);
    tmpY[w] = y == null ? Number.NaN : y;
    w += 1;
  }
  return normalizeMonotonic(tmpX.slice(0, w), tmpY.slice(0, w));
}

function normalizeMonotonic(
  x: Float64Array,
  y: Float64Array
): { xs: Float64Array; ys: Float64Array } {
  if (x.length <= 1) return { xs: x, ys: y };
  const pairs: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < x.length; i++) {
    const xv = x[i];
    if (!Number.isFinite(xv)) continue;
    pairs.push({ x: xv, y: y[i] });
  }
  if (pairs.length <= 1) {
    return {
      xs: new Float64Array(pairs.map((p) => p.x)),
      ys: new Float64Array(pairs.map((p) => p.y)),
    };
  }
  pairs.sort((a, b) => a.x - b.x);
  const nx: number[] = [];
  const ny: number[] = [];
  let i = 0;
  while (i < pairs.length) {
    let j = i + 1;
    let val = pairs[i].y;
    while (j < pairs.length && pairs[j].x === pairs[i].x) {
      // For duplicated timestamps prefer the latest finite value.
      if (Number.isFinite(pairs[j].y)) val = pairs[j].y;
      j += 1;
    }
    nx.push(pairs[i].x);
    ny.push(val);
    i = j;
  }
  return { xs: new Float64Array(nx), ys: new Float64Array(ny) };
}

// ────────────────────────────────────────────────────────────────────────────
// Gap injection (per-series)
// ────────────────────────────────────────────────────────────────────────────

function injectGapsSingle(
  xs: Float64Array,
  ys: Float64Array,
  maxGapSeconds: number
): { xs: Float64Array; ys: Float64Array; gapsInjected: number } {
  if (xs.length < 2 || maxGapSeconds <= 0) return { xs, ys, gapsInjected: 0 };
  let gaps = 0;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > maxGapSeconds) gaps += 1;
  }
  if (gaps === 0) return { xs, ys, gapsInjected: 0 };
  const nextLen = xs.length + gaps;
  const outX = new Float64Array(nextLen);
  const outY = new Float64Array(nextLen);
  let w = 0;
  for (let i = 0; i < xs.length; i++) {
    outX[w] = xs[i];
    outY[w] = ys[i];
    w += 1;
    if (i === xs.length - 1) continue;
    if (xs[i + 1] - xs[i] > maxGapSeconds) {
      // Bridge timestamp halfway between samples; NaN in y forces a visual break.
      outX[w] = (xs[i] + xs[i + 1]) / 2;
      outY[w] = Number.NaN;
      w += 1;
    }
  }
  return { xs: outX, ys: outY, gapsInjected: gaps };
}

// ────────────────────────────────────────────────────────────────────────────
// Downsampling (segmented MinMaxLTTB, per series)
// ────────────────────────────────────────────────────────────────────────────

function splitSegmentsByGap(
  xs: Float64Array,
  maxGapSeconds: number
): Array<{ start: number; end: number }> {
  if (xs.length === 0) return [];
  if (xs.length === 1 || maxGapSeconds <= 0) return [{ start: 0, end: xs.length - 1 }];
  const segments: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > maxGapSeconds) {
      segments.push({ start, end: i - 1 });
      start = i;
    }
  }
  segments.push({ start, end: xs.length - 1 });
  return segments;
}

function lttbIndices(xs: Float64Array, ys: Float64Array, threshold: number): number[] {
  const n = xs.length;
  if (threshold >= n || threshold < 3) return Array.from({ length: n }, (_, i) => i);
  const sampled: number[] = [0];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const avgStart = Math.floor((i + 1) * every) + 1;
    const avgEnd = Math.floor((i + 2) * every) + 1;
    const avgRangeEnd = Math.min(avgEnd, n);
    let avgX = 0;
    let avgY = 0;
    let avgCount = 0;
    for (let idx = avgStart; idx < avgRangeEnd; idx++) {
      avgX += xs[idx];
      avgY += Number.isFinite(ys[idx]) ? ys[idx] : 0;
      avgCount += 1;
    }
    if (avgCount === 0) avgCount = 1;
    avgX /= avgCount;
    avgY /= avgCount;

    const rangeOffs = Math.floor(i * every) + 1;
    const rangeTo = Math.floor((i + 1) * every) + 1;
    const rangeEnd = Math.min(rangeTo, n - 1);
    let maxArea = -1;
    let nextA = rangeOffs;
    for (let idx = rangeOffs; idx < rangeEnd; idx++) {
      const yy = Number.isFinite(ys[idx]) ? ys[idx] : avgY;
      const area =
        Math.abs(
          (xs[a] - avgX) * (yy - ys[a]) - (xs[a] - xs[idx]) * (avgY - ys[a])
        ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        nextA = idx;
      }
    }
    sampled.push(nextA);
    a = nextA;
  }
  sampled.push(n - 1);
  return sampled;
}

function minMaxIndicesPerBucket(ys: Float64Array, buckets: number): Set<number> {
  const idx = new Set<number>();
  const n = ys.length;
  if (n === 0 || buckets <= 0) return idx;
  const bucketSize = Math.max(1, Math.floor(n / buckets));
  for (let start = 0; start < n; start += bucketSize) {
    const end = Math.min(n, start + bucketSize);
    let minI = start;
    let maxI = start;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (let i = start; i < end; i++) {
      const v = ys[i];
      if (!Number.isFinite(v)) continue;
      if (v < minV) {
        minV = v;
        minI = i;
      }
      if (v > maxV) {
        maxV = v;
        maxI = i;
      }
    }
    if (Number.isFinite(minV)) idx.add(minI);
    if (Number.isFinite(maxV)) idx.add(maxI);
  }
  return idx;
}

function downsampleSingle(
  xs: Float64Array,
  ys: Float64Array,
  threshold: number,
  maxGapSeconds: number,
  preserveExtrema: boolean
): { xs: Float64Array; ys: Float64Array; downsampleRatio: number } {
  if (xs.length === 0 || threshold <= 0 || xs.length <= threshold) {
    return { xs, ys, downsampleRatio: 1 };
  }
  // If the series has fewer than 2 finite samples, downsampling is meaningless.
  let finite = 0;
  for (let i = 0; i < ys.length; i++) if (Number.isFinite(ys[i])) finite += 1;
  if (finite < 2) return { xs, ys, downsampleRatio: 1 };

  const segments = splitSegmentsByGap(xs, maxGapSeconds);
  const pickGlobal = new Set<number>();
  for (const seg of segments) {
    const segLen = seg.end - seg.start + 1;
    if (segLen <= threshold) {
      for (let i = seg.start; i <= seg.end; i++) pickGlobal.add(i);
      continue;
    }
    const segX = xs.slice(seg.start, seg.end + 1);
    const segY = ys.slice(seg.start, seg.end + 1);
    const lttb = lttbIndices(segX, segY, threshold);
    const keep = new Set<number>(lttb.map((i) => seg.start + i));
    if (preserveExtrema) {
      const mm = minMaxIndicesPerBucket(segY, threshold);
      for (const i of mm) keep.add(seg.start + i);
    }
    keep.add(seg.start);
    keep.add(seg.end);
    for (const i of keep) pickGlobal.add(i);
  }
  const pick = Array.from(pickGlobal.values()).sort((a, b) => a - b);
  const outX = new Float64Array(pick.length);
  const outY = new Float64Array(pick.length);
  for (let i = 0; i < pick.length; i++) {
    outX[i] = xs[pick[i]];
    outY[i] = ys[pick[i]];
  }
  return { xs: outX, ys: outY, downsampleRatio: pick.length / Math.max(1, xs.length) };
}

// ────────────────────────────────────────────────────────────────────────────
// Per-series stats helpers
// ────────────────────────────────────────────────────────────────────────────

function quantile(sortedFinite: number[], q: number): number {
  const n = sortedFinite.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sortedFinite[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedFinite[lo];
  const w = pos - lo;
  return sortedFinite[lo] * (1 - w) + sortedFinite[hi] * w;
}

function computeDomains(xs: Float64Array, ys: Float64Array): {
  domainX: [number, number] | null;
  domainY: [number, number] | null;
} {
  if (xs.length === 0) return { domainX: null, domainY: null };
  const finiteY: number[] = [];
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i])) {
      if (xs[i] < xMin) xMin = xs[i];
      if (xs[i] > xMax) xMax = xs[i];
    }
    const y = ys[i];
    if (Number.isFinite(y)) finiteY.push(y);
  }
  const domainX: [number, number] | null =
    Number.isFinite(xMin) && Number.isFinite(xMax) ? [xMin, xMax] : null;
  if (finiteY.length === 0) return { domainX, domainY: null };
  finiteY.sort((a, b) => a - b);
  const lo = quantile(finiteY, 0.01);
  const hi = quantile(finiteY, 0.99);
  return {
    domainX,
    domainY: Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null,
  };
}

function countFinite(arr: Float64Array): number {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) n += 1;
  return n;
}

// ────────────────────────────────────────────────────────────────────────────
// Cache
// ────────────────────────────────────────────────────────────────────────────

function cacheKey(
  item: WorkerSeriesSpec,
  startTime: string,
  endTime: string,
  resolution: number
): string {
  return `${item.source ?? 'timescale'}|${item.entityId}|${item.attribute}|${startTime}|${endTime}|${resolution}`;
}

function getCacheSizeBytes(): number {
  let total = 0;
  for (const row of seriesCache.values()) total += row.bytes;
  return total;
}

function evictCacheIfNeeded(): void {
  let total = getCacheSizeBytes();
  if (total <= CACHE_BUDGET_BYTES) return;
  const entries = [...seriesCache.values()].sort((a, b) => a.lastAccess - b.lastAccess);
  for (const row of entries) {
    seriesCache.delete(row.key);
    total -= row.bytes;
    if (total <= CACHE_BUDGET_BYTES) break;
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
// ────────────────────────────────────────────────────────────────────────────

async function fetchSingleSeries(
  req: DatahubWorkerRequest,
  item: WorkerSeriesSpec
): Promise<{ xs: Float64Array; ys: Float64Array }> {
  const params = new URLSearchParams({
    start_time: req.startTime,
    end_time: req.endTime,
    resolution: String(req.resolution),
    attribute: item.attribute,
  });
  const path = `/api/datahub/timeseries/entities/${encodeURIComponent(item.entityId)}/data?${params}`;
  // Web Workers do not resolve relative URLs — fetch() requires an absolute one.
  // When the orchestrator does not pass an explicit baseUrl (same-origin case),
  // we fall back to the worker's own origin (which equals the spawning page's
  // origin since this is an inline worker).
  const base = req.baseUrl || self.location.origin;
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
  const key = cacheKey(item, req.startTime, req.endTime, req.resolution);
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
        seriesKey: cacheKey(req.series[idx], req.startTime, req.endTime, req.resolution),
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
