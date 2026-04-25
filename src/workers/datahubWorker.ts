/// <reference lib="webworker" />

import type {
  DatahubWorkerMessage,
  DatahubWorkerRequest,
  DatahubWorkerResponse,
  WorkerSeriesSpec,
  WorkerStats,
} from './contracts/datahubWorkerV2';

const WORKER_BUILD = 'v2-bootstrap-2026-04-20';
const CACHE_BUDGET_MB = 128;
const CACHE_BUDGET_BYTES = CACHE_BUDGET_MB * 1024 * 1024;

interface CachedSeries {
  key: string;
  x: Float64Array;
  y: Float64Array;
  bytes: number;
  lastAccess: number;
}

const seriesCache = new Map<string, CachedSeries>();

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Epoch seconds from API (number) or ISO 8601 string (BFF may pass either). */
function timestampToEpochSeconds(value: unknown): number | null {
  const normalizeEpoch = (n: number): number => {
    let v = n;
    // Normalize ms/us/ns-like numeric epochs down to seconds.
    while (Math.abs(v) > 1e11) v /= 1000;
    return v;
  };
  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeEpoch(value);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number.parseFloat(t);
      if (!Number.isFinite(n)) return null;
      return normalizeEpoch(n);
    }
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms / 1000 : null;
  }
  return null;
}

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

function parseSingleSeriesPayload(data: unknown): { x: Float64Array; y: Float64Array } {
  const payload = (data ?? {}) as Record<string, unknown>;
  const timestamps = Array.isArray(payload.timestamps) ? payload.timestamps : [];
  const rawValues = Array.isArray(payload.values)
    ? payload.values
    : Array.isArray(payload.value_0)
      ? payload.value_0
      : [];
  const len = Math.min(timestamps.length, rawValues.length);
  const outX = new Float64Array(len);
  const outY = new Float64Array(len);
  let w = 0;
  for (let i = 0; i < len; i++) {
    const x = timestampToEpochSeconds(timestamps[i]);
    if (x == null) continue;
    outX[w] = x;
    const y = toFiniteNumber(rawValues[i]);
    outY[w] = y == null ? Number.NaN : y;
    w += 1;
  }
  return normalizeMonotonic(outX.slice(0, w), outY.slice(0, w));
}

function normalizeMonotonic(x: Float64Array, y: Float64Array): { x: Float64Array; y: Float64Array } {
  if (x.length <= 1) return { x, y };
  const pairs: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < x.length; i++) {
    const xv = x[i];
    if (!Number.isFinite(xv)) continue;
    pairs.push({ x: xv, y: y[i] });
  }
  if (pairs.length <= 1) {
    return {
      x: new Float64Array(pairs.map((p) => p.x)),
      y: new Float64Array(pairs.map((p) => p.y)),
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
      // prefer the latest finite value for duplicated timestamps
      if (Number.isFinite(pairs[j].y)) val = pairs[j].y;
      j += 1;
    }
    nx.push(pairs[i].x);
    ny.push(val);
    i = j;
  }
  return { x: new Float64Array(nx), y: new Float64Array(ny) };
}

function injectTemporalGaps(
  x: Float64Array,
  ys: Float64Array[],
  maxGapSeconds: number
): { x: Float64Array; ys: Float64Array[]; gapsInjected: number } {
  if (x.length < 2 || maxGapSeconds <= 0) return { x, ys, gapsInjected: 0 };
  let gaps = 0;
  for (let i = 1; i < x.length; i++) {
    if (x[i] - x[i - 1] > maxGapSeconds) gaps += 1;
  }
  if (gaps === 0) return { x, ys, gapsInjected: 0 };
  const nextLen = x.length + gaps;
  const outX = new Float64Array(nextLen);
  const outYs = ys.map(() => new Float64Array(nextLen));
  let w = 0;
  for (let i = 0; i < x.length; i++) {
    outX[w] = x[i];
    for (let s = 0; s < ys.length; s++) outYs[s][w] = ys[s][i];
    w += 1;
    if (i === x.length - 1) continue;
    if (x[i + 1] - x[i] > maxGapSeconds) {
      outX[w] = x[i] + 1e-6;
      for (let s = 0; s < ys.length; s++) outYs[s][w] = Number.NaN;
      w += 1;
    }
  }
  return { x: outX, ys: outYs, gapsInjected: gaps };
}

function mergeSeriesOuterJoin(series: Array<{ x: Float64Array; y: Float64Array }>): {
  x: Float64Array;
  ys: Float64Array[];
} {
  if (series.length === 0) return { x: new Float64Array(0), ys: [] };
  const timestampSet = new Set<number>();
  for (const s of series) {
    for (let i = 0; i < s.x.length; i++) timestampSet.add(s.x[i]);
  }
  const sortedX = Array.from(timestampSet.values()).sort((a, b) => a - b);
  const x = new Float64Array(sortedX.length);
  for (let i = 0; i < sortedX.length; i++) x[i] = sortedX[i];

  const xIndex = new Map<number, number>();
  for (let i = 0; i < x.length; i++) xIndex.set(x[i], i);

  const ys = series.map(() => {
    const arr = new Float64Array(x.length);
    arr.fill(Number.NaN);
    return arr;
  });
  for (let sIdx = 0; sIdx < series.length; sIdx++) {
    const s = series[sIdx];
    for (let i = 0; i < s.x.length; i++) {
      const dst = xIndex.get(s.x[i]);
      if (dst == null) continue;
      ys[sIdx][dst] = s.y[i];
    }
  }
  return { x, ys };
}

function splitSegmentsByGap(x: Float64Array, maxGapSeconds: number): Array<{ start: number; end: number }> {
  if (x.length === 0) return [];
  if (x.length === 1 || maxGapSeconds <= 0) return [{ start: 0, end: x.length - 1 }];
  const segments: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 1; i < x.length; i++) {
    if (x[i] - x[i - 1] > maxGapSeconds) {
      segments.push({ start, end: i - 1 });
      start = i;
    }
  }
  segments.push({ start, end: x.length - 1 });
  return segments;
}

function lttbIndices(x: Float64Array, y: Float64Array, threshold: number): number[] {
  const n = x.length;
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
      avgX += x[idx];
      avgY += Number.isFinite(y[idx]) ? y[idx] : 0;
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
      const yy = Number.isFinite(y[idx]) ? y[idx] : avgY;
      const area = Math.abs((x[a] - avgX) * (yy - y[a]) - (x[a] - x[idx]) * (avgY - y[a])) * 0.5;
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

function minMaxIndices(y: Float64Array, threshold: number): Set<number> {
  const idx = new Set<number>();
  const n = y.length;
  if (n === 0 || threshold <= 0) return idx;
  const bucketSize = Math.max(1, Math.floor(n / threshold));
  for (let start = 0; start < n; start += bucketSize) {
    const end = Math.min(n, start + bucketSize);
    let minI = start;
    let maxI = start;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (let i = start; i < end; i++) {
      const v = y[i];
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

function downsampleSegmented(
  x: Float64Array,
  ys: Float64Array[],
  threshold: number,
  maxGapSeconds: number,
  preserveExtrema: boolean
): { x: Float64Array; ys: Float64Array[]; downsampleRatio: number } {
  if (x.length === 0 || ys.length === 0 || threshold <= 0 || x.length <= threshold) {
    return { x, ys, downsampleRatio: 1 };
  }
  // Use the first series with finite samples as reference for LTTB.
  // If series[0] is empty/NaN-heavy, using it as reference can erase valid traces from other series.
  let refIdx = 0;
  let refFinite = 0;
  for (let s = 0; s < ys.length; s++) {
    let finite = 0;
    const arr = ys[s];
    for (let i = 0; i < arr.length; i++) {
      if (Number.isFinite(arr[i])) finite += 1;
    }
    if (finite > refFinite) {
      refFinite = finite;
      refIdx = s;
    }
  }
  if (refFinite < 2) {
    return { x, ys, downsampleRatio: 1 };
  }
  const segments = splitSegmentsByGap(x, maxGapSeconds);
  const pickGlobal = new Set<number>();
  for (const seg of segments) {
    const segLen = seg.end - seg.start + 1;
    if (segLen <= threshold) {
      for (let i = seg.start; i <= seg.end; i++) pickGlobal.add(i);
      continue;
    }
    const segX = x.slice(seg.start, seg.end + 1);
    const referenceY = ys[refIdx].slice(seg.start, seg.end + 1);
    const lttb = lttbIndices(segX, referenceY, threshold);
    const keep = new Set<number>(lttb.map((i) => seg.start + i));
    if (preserveExtrema) {
      const mm = minMaxIndices(referenceY, threshold);
      for (const i of mm) keep.add(seg.start + i);
    }
    keep.add(seg.start);
    keep.add(seg.end);
    for (const i of keep) pickGlobal.add(i);
  }
  const pick = Array.from(pickGlobal.values()).sort((a, b) => a - b);
  const outX = new Float64Array(pick.length);
  const outYs = ys.map(() => new Float64Array(pick.length));
  for (let i = 0; i < pick.length; i++) {
    const src = pick[i];
    outX[i] = x[src];
    for (let s = 0; s < ys.length; s++) outYs[s][i] = ys[s][src];
  }
  return { x: outX, ys: outYs, downsampleRatio: pick.length / Math.max(1, x.length) };
}

async function fetchSingleSeries(
  req: DatahubWorkerRequest,
  item: WorkerSeriesSpec
): Promise<{ x: Float64Array; y: Float64Array }> {
  const params = new URLSearchParams({
    start_time: req.startTime,
    end_time: req.endTime,
    resolution: String(req.resolution),
    attribute: item.attribute,
  });
  const path = `/api/datahub/timeseries/entities/${encodeURIComponent(item.entityId)}/data?${params}`;
  const url = req.baseUrl ? `${req.baseUrl}${path}` : path;
  const response = await fetch(url, {
    method: 'GET',
    headers: req.headers,
    credentials: 'include',
  });
  if (response.status === 204) return { x: new Float64Array(0), y: new Float64Array(0) };
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(text || `HTTP ${response.status}`), { status: response.status });
  }
  const data = await response.json();
  return parseSingleSeriesPayload(data);
}

async function fetchSingleSeriesWithRetry(
  req: DatahubWorkerRequest,
  item: WorkerSeriesSpec
): Promise<{ x: Float64Array; y: Float64Array }> {
  const first = await fetchSingleSeries(req, item);
  if (first.x.length > 0) return first;
  // Intermittent empty responses have been observed for identical requests.
  // Retry once before propagating an empty result to the panel.
  return fetchSingleSeries(req, item);
}

async function processSeries(req: DatahubWorkerRequest): Promise<DatahubWorkerResponse> {
  const started = performance.now();
  const rows: Array<{ x: Float64Array; y: Float64Array }> = [];
  let rawPointsFetched = 0;
  for (const item of req.series) {
    const key = cacheKey(item, req.startTime, req.endTime, req.resolution);
    let row = !req.forceRefresh ? seriesCache.get(key) : undefined;
    if (!row) {
      const fetched = await fetchSingleSeriesWithRetry(req, item);
      const bytes = fetched.x.byteLength + fetched.y.byteLength;
      row = {
        key,
        x: fetched.x,
        y: fetched.y,
        bytes,
        lastAccess: Date.now(),
      };
      // Do not cache empty responses (204/no points). Empty cache entries can
      // keep stale "no data" states after transient backend/auth failures.
      if (fetched.x.length > 0) {
        seriesCache.set(key, row);
        evictCacheIfNeeded();
      }
      rawPointsFetched += fetched.x.length;
    } else {
      row.lastAccess = Date.now();
    }
    rows.push({ x: row.x, y: row.y });
  }
  const merged = mergeSeriesOuterJoin(rows);
  const sampled = downsampleSegmented(
    merged.x,
    merged.ys,
    req.policy.downsampleThreshold,
    req.policy.maxGapSeconds,
    req.policy.preserveExtrema
  );
  let pointsPlotted = 0;
  let pointsDiscarded = 0;
  for (const y of sampled.ys) {
    for (let i = 0; i < y.length; i++) {
      if (Number.isFinite(y[i])) pointsPlotted += 1;
      else pointsDiscarded += 1;
    }
  }
  const withGaps = injectTemporalGaps(sampled.x, sampled.ys, req.policy.maxGapSeconds);
  const output: Float64Array[] = [withGaps.x, ...withGaps.ys];

  const stats: WorkerStats = {
    rawPointsFetched,
    pointsPlotted,
    gapsInjected: withGaps.gapsInjected,
    pointsDiscarded,
    processingTimeMs: performance.now() - started,
    downsampleRatio: sampled.downsampleRatio,
    domainX: withGaps.x.length > 0 ? [withGaps.x[0], withGaps.x[withGaps.x.length - 1]] : null,
  };

  return {
    type: 'PROCESS_SERIES_RESULT',
    requestId: req.requestId,
    contractVersion: 2,
    workerBuild: WORKER_BUILD,
    data: output,
    stats,
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
      const transferList = response.data.map((arr) => arr.buffer);
      self.postMessage(response, transferList);
    } catch (error) {
      const maybeStatus =
        typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status?: unknown }).status)
          : undefined;
      const fallback: DatahubWorkerResponse = {
        type: 'PROCESS_SERIES_RESULT',
        requestId: req.requestId,
        contractVersion: 2,
        workerBuild: WORKER_BUILD,
        data: [],
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
          code: 'PROCESS_ERROR',
          stage: maybeStatus ? 'fetch' : 'decode',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
          ...(maybeStatus ? { httpStatus: maybeStatus } : {}),
        },
      };
      self.postMessage(fallback);
    }
  })();
};

export {};

