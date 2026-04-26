/**
 * Derived series — analytical overlays computed from the worker payload.
 *
 * These run in the panel (not the worker) because:
 *   - they're cheap (O(n) trendline, O(n) rolling avg) and the worker should
 *     not have to redo them every time the user toggles a UI switch
 *   - they depend on UI-only state (window size, primary series choice)
 *   - they're conceptually presentational: a line on top of the data
 *
 * Both produce a synthetic WorkerSeriesPayload with stable .key so PanelChart's
 * resetKey logic distinguishes them from real series.
 */

import type {
  PerSeriesStats,
  WorkerSeriesPayload,
} from '../../workers/contracts/datahubWorkerV2';
import type { RollingAvgWindow } from '../../types/dashboard';

const EMPTY_STATS: PerSeriesStats = {
  rawPointsFetched: 0,
  pointsPlotted: 0,
  gapsInjected: 0,
  pointsDiscarded: 0,
  downsampleRatio: 1,
  domainX: null,
  domainY: null,
};

/**
 * Least-squares regression line (a + b·x) computed in O(n).
 * Returns a synthetic WorkerSeriesPayload spanning the same xs as the source.
 */
export function buildTrendlineSeries(
  source: WorkerSeriesPayload | undefined
): WorkerSeriesPayload | null {
  if (!source || source.xs.length < 2) return null;
  const xs = source.xs;
  const ys = source.ys;
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n += 1;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  if (n < 2) return null;
  const denom = n * sumXX - sumX * sumX;
  let a: number;
  let b: number;
  if (Math.abs(denom) < 1e-18) {
    b = 0;
    a = sumY / n;
  } else {
    b = (n * sumXY - sumX * sumY) / denom;
    a = (sumY - b * sumX) / n;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const outX = new Float64Array(xs.length);
  const outY = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    outX[i] = xs[i];
    outY[i] = a + b * xs[i];
  }
  return {
    key: `${source.key}::trendline`,
    entityId: source.entityId,
    attribute: `${source.attribute} trend`,
    source: source.source,
    xs: outX,
    ys: outY,
    stats: EMPTY_STATS,
  };
}

const ROLLING_SECONDS: Record<RollingAvgWindow, number> = {
  off: 0,
  '1h': 3600,
  '24h': 24 * 3600,
  '7d': 7 * 24 * 3600,
};

/**
 * Centered rolling average with a fixed-time window. O(n) using a two-pointer
 * sliding sum — works correctly for irregular sample spacing because the
 * window is in time units, not sample count.
 */
export function buildRollingAverageSeries(
  source: WorkerSeriesPayload | undefined,
  window: RollingAvgWindow
): WorkerSeriesPayload | null {
  if (!source || window === 'off') return null;
  const span = ROLLING_SECONDS[window];
  if (!span || source.xs.length < 2) return null;
  const xs = source.xs;
  const ys = source.ys;
  const half = span / 2;
  const n = xs.length;
  const outX = new Float64Array(n);
  const outY = new Float64Array(n);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    outX[i] = x;
    if (!Number.isFinite(x)) {
      outY[i] = Number.NaN;
      continue;
    }
    // Advance hi to the first index where xs[hi] > x + half.
    while (hi < n && xs[hi] <= x + half) {
      const yv = ys[hi];
      if (Number.isFinite(yv)) {
        sum += yv;
        count += 1;
      }
      hi += 1;
    }
    // Retract lo while xs[lo] < x - half.
    while (lo < hi && xs[lo] < x - half) {
      const yv = ys[lo];
      if (Number.isFinite(yv)) {
        sum -= yv;
        count -= 1;
      }
      lo += 1;
    }
    outY[i] = count > 0 ? sum / count : Number.NaN;
  }
  return {
    key: `${source.key}::rolling-${window}`,
    entityId: source.entityId,
    attribute: `${source.attribute} ${window} avg`,
    source: source.source,
    xs: outX,
    ys: outY,
    stats: EMPTY_STATS,
  };
}

/**
 * Pearson correlation coefficient over aligned (x_i, y_i) pairs.
 * Aligns by nearest-timestamp matching with a tolerance equal to the median
 * native step of the X-source series.
 *
 * Returns r in [-1, 1] and the sample count n that contributed.
 */
export function pearsonCorrelation(
  xSeries: WorkerSeriesPayload | undefined,
  ySeries: WorkerSeriesPayload | undefined
): { r: number; n: number; pairs: Array<{ x: number; y: number }> } | null {
  if (!xSeries || !ySeries) return null;
  if (xSeries.xs.length === 0 || ySeries.xs.length === 0) return null;

  // Median step on the X-source as the alignment tolerance.
  const xs1 = xSeries.xs;
  const steps: number[] = [];
  for (let i = 1; i < xs1.length; i++) {
    const d = xs1[i] - xs1[i - 1];
    if (Number.isFinite(d) && d > 0) steps.push(d);
  }
  steps.sort((a, b) => a - b);
  const tol = steps.length > 0 ? steps[steps.length >> 1] : 60;

  // Two-pointer alignment over already-sorted xs.
  const xs2 = ySeries.xs;
  const ys1 = xSeries.ys;
  const ys2 = ySeries.ys;
  const pairs: Array<{ x: number; y: number }> = [];
  let j = 0;
  for (let i = 0; i < xs1.length; i++) {
    const tx = xs1[i];
    if (!Number.isFinite(tx)) continue;
    while (j < xs2.length - 1 && Math.abs(xs2[j + 1] - tx) <= Math.abs(xs2[j] - tx)) {
      j += 1;
    }
    if (Math.abs(xs2[j] - tx) > tol) continue;
    const xv = ys1[i];
    const yv = ys2[j];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    pairs.push({ x: xv, y: yv });
  }
  const n = pairs.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of pairs) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (const p of pairs) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return { r: Number.NaN, n, pairs };
  const r = cov / Math.sqrt(varX * varY);
  return { r, n, pairs };
}
