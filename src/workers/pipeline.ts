/**
 * Pure processing pipeline for the DataHub worker (Contract V2.1).
 * Extracted from datahubWorker.ts so the math can be unit-tested with
 * precision. No I/O, no worker globals, no cache state here.
 */

import type { WorkerSeriesSpec } from './contracts/datahubWorkerV2';

// ────────────────────────────────────────────────────────────────────────────
// Gap injection (per-series)
// ────────────────────────────────────────────────────────────────────────────

export function injectGapsSingle(
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

export function splitSegmentsByGap(
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

export function lttbIndices(xs: Float64Array, ys: Float64Array, threshold: number): number[] {
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

export function minMaxIndicesPerBucket(ys: Float64Array, buckets: number): Set<number> {
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

export function downsampleSingle(
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

export function quantile(sortedFinite: number[], q: number): number {
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

export function computeDomains(xs: Float64Array, ys: Float64Array): {
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

export function countFinite(arr: Float64Array): number {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) n += 1;
  return n;
}

// ────────────────────────────────────────────────────────────────────────────
// Cache
// ────────────────────────────────────────────────────────────────────────────

export function cacheKey(
  item: WorkerSeriesSpec,
  startTime: string,
  endTime: string,
  resolution: number
): string {
  return `${item.source ?? 'timescale'}|${item.entityId}|${item.attribute}|${startTime}|${endTime}|${resolution}`;
}

/** LRU eviction decision: which keys to delete to get total <= budget. Pure. */
export interface EvictableEntry {
  key: string;
  bytes: number;
  lastAccess: number;
}

export function selectEvictions(entries: EvictableEntry[], budgetBytes: number): string[] {
  let total = 0;
  for (const e of entries) total += e.bytes;
  if (total <= budgetBytes) return [];
  const sorted = [...entries].sort((a, b) => a.lastAccess - b.lastAccess);
  const out: string[] = [];
  for (const row of sorted) {
    out.push(row.key);
    total -= row.bytes;
    if (total <= budgetBytes) break;
  }
  return out;
}
