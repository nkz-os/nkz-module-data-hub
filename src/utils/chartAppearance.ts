/**
 * Chart appearance merge + linear regression for trendline (least squares on time vs value).
 */
import {
  DEFAULT_CHART_APPEARANCE,
  type ChartAppearance,
} from '../types/dashboard';

export function mergeChartAppearance(
  partial?: Partial<ChartAppearance>
): ChartAppearance {
  return { ...DEFAULT_CHART_APPEARANCE, ...partial };
}

/** Returns y = a + b*x coefficients, or null if not enough valid points. */
export function linearRegressionTau(
  xs: ArrayLike<number | null | undefined>,
  ys: ArrayLike<number | null | undefined>
): { a: number; b: number } | null {
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  const len = Math.min(xs.length, ys.length);
  for (let i = 0; i < len; i++) {
    const x = xs[i];
    const y = ys[i];
    if (y == null || !Number.isFinite(y) || x == null || !Number.isFinite(x)) continue;
    n += 1;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  if (n < 2) return null;
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-18) return { a: sumY / n, b: 0 };
  const b = (n * sumXY - sumX * sumY) / denom;
  const a = (sumY - b * sumX) / n;
  return { a, b };
}

/** One y value per x from regression; null where x invalid. */
export function buildTrendSeries(
  xs: ArrayLike<number | null | undefined>,
  ys: ArrayLike<number | null | undefined>
): (number | null)[] | null {
  const coef = linearRegressionTau(xs, ys);
  if (!coef) return null;
  const { a, b } = coef;
  const len = xs.length;
  const out = new Array<number | null>(len);
  for (let i = 0; i < len; i++) {
    const x = xs[i];
    out[i] = x != null && Number.isFinite(x) ? a + b * x : null;
  }
  return out;
}
