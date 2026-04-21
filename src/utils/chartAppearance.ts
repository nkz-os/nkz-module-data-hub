/**
 * Chart appearance merge + linear regression for trendline (least squares on time vs value).
 */
import {
  DEFAULT_CHART_APPEARANCE,
  type ChartAppearance,
  type ChartViewMode,
} from '../types/dashboard';

export function mergeChartAppearance(
  partial?: Partial<ChartAppearance>
): ChartAppearance {
  const mode = partial?.mode;
  const normalizedMode =
    mode === 'line' || mode === 'bars' || mode === 'points'
      ? mode
      : DEFAULT_CHART_APPEARANCE.mode;
  const viewMode = partial?.viewMode;
  const normalizedViewMode: ChartViewMode =
    viewMode === 'correlation' || viewMode === 'timeseries'
      ? viewMode
      : DEFAULT_CHART_APPEARANCE.viewMode;

  const lineWidthRaw =
    typeof partial?.lineWidth === 'number'
      ? partial.lineWidth
      : Number.parseFloat(String(partial?.lineWidth ?? DEFAULT_CHART_APPEARANCE.lineWidth));
  const pointRadiusRaw =
    typeof partial?.pointRadius === 'number'
      ? partial.pointRadius
      : Number.parseFloat(String(partial?.pointRadius ?? DEFAULT_CHART_APPEARANCE.pointRadius));

  const lineWidth = Number.isFinite(lineWidthRaw)
    ? Math.min(4, Math.max(1, Math.round(lineWidthRaw)))
    : DEFAULT_CHART_APPEARANCE.lineWidth;
  const pointRadius = Number.isFinite(pointRadiusRaw)
    ? Math.min(8, Math.max(0, Math.round(pointRadiusRaw)))
    : DEFAULT_CHART_APPEARANCE.pointRadius;
  const correlationXSeriesRaw =
    typeof partial?.correlationXSeries === 'number'
      ? partial.correlationXSeries
      : Number.parseFloat(String(partial?.correlationXSeries ?? DEFAULT_CHART_APPEARANCE.correlationXSeries));
  const correlationYSeriesRaw =
    typeof partial?.correlationYSeries === 'number'
      ? partial.correlationYSeries
      : Number.parseFloat(String(partial?.correlationYSeries ?? DEFAULT_CHART_APPEARANCE.correlationYSeries));
  const correlationXSeries = Number.isFinite(correlationXSeriesRaw) ? Math.max(0, Math.floor(correlationXSeriesRaw)) : 0;
  const correlationYSeries = Number.isFinite(correlationYSeriesRaw) ? Math.max(0, Math.floor(correlationYSeriesRaw)) : 1;

  return {
    ...DEFAULT_CHART_APPEARANCE,
    ...partial,
    viewMode: normalizedViewMode,
    mode: normalizedMode,
    lineWidth,
    pointRadius,
    showTrendline: partial?.showTrendline === true,
    correlationXSeries,
    correlationYSeries,
  };
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
  if (!Number.isFinite(denom)) return null;
  if (Math.abs(denom) < 1e-18) {
    const flat = sumY / n;
    if (!Number.isFinite(flat)) return null;
    return { a: flat, b: 0 };
  }
  const b = (n * sumXY - sumX * sumY) / denom;
  const a = (sumY - b * sumX) / n;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
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
    if (x == null || !Number.isFinite(x)) {
      out[i] = null;
      continue;
    }
    const y = a + b * x;
    out[i] = Number.isFinite(y) ? y : null;
  }
  return out;
}
