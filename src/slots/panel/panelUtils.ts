/**
 * Shared utilities for the panel: unit dictionary, color palette, axis assignment,
 * Y-range computation. Single home so chart, rail, footer and tooltip all agree.
 */

import type { ChartSeriesDef, YScaleMode } from '../../types/dashboard';
import type { WorkerSeriesPayload } from '../../workers/contracts/datahubWorkerV2';

export const SERIES_PALETTE = [
  '#34d399', // emerald-400
  '#c084fc', // purple-400
  '#fbbf24', // amber-400
  '#60a5fa', // blue-400
  '#f87171', // red-400
  '#f472b6', // pink-400
  '#a3e635', // lime-400
  '#22d3ee', // cyan-400
];

/** Unit-by-attribute display table. Keep in sync with src/components/DataTree.tsx. */
const ATTRIBUTE_UNIT: Record<string, string> = {
  temperature: '°C', temp_avg: '°C', temp_min: '°C', temp_max: '°C',
  airTemperature: '°C', delta_t: '°C',
  humidity: '%', humidity_avg: '%', humidity_min: '%', humidity_max: '%',
  relativeHumidity: '%', soil_moisture: '%', soil_moisture_0_10cm: '%',
  precipitation: 'mm', precip_mm: 'mm', eto_mm: 'mm', et0: 'mm',
  solar_rad_w_m2: 'W/m²', radiation: 'W/m²', solarRadiation: 'W/m²',
  wind_speed: 'm/s', wind_speed_avg: 'm/s', wind_speed_max: 'm/s',
  wind_speed_ms: 'm/s', windSpeed: 'm/s',
  windDirection: '°',
  pressure: 'hPa', pressure_avg: 'hPa', pressure_hpa: 'hPa',
  atmosphericPressure: 'hPa',
  panelInclination: '°',
  gdd_accumulated: 'GDD',
};

export function unitFor(attribute: string): string {
  return ATTRIBUTE_UNIT[attribute] ?? '';
}

/** Stable identity for a series across requests, panels, cache, UI overrides. */
export function seriesKey(s: ChartSeriesDef): string {
  return `${s.source ?? 'timescale'}|${s.entityId}|${s.attribute}`;
}

export function colorForIndex(index: number): string {
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}

/** Quantile of a sorted finite-numbers array. */
export function quantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const w = pos - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

/**
 * Auto-distribute series across left ('y') and right ('y2') Y axes.
 *
 * Rule (in order of precedence):
 *   1. Explicit user choice (yAxis === 'right') is always honored.
 *   2. The first series with implicit/'left' axis goes to 'y' and seeds the
 *      left "bucket" with its unit and magnitude.
 *   3. A subsequent series joins an existing axis ONLY if BOTH:
 *      - its unit is compatible with the axis's units, AND
 *      - its magnitude is within 5× of an existing series on that axis.
 *   4. Otherwise it goes to the OTHER axis.
 *   5. As last resort: whichever axis has fewer series.
 *
 * Why both checks: temperature (°C, 3–30) and relativeHumidity (%, 0–100) have
 * a magnitude ratio of ~2.7× — within 5× — so a magnitude-only check kept
 * them on the same axis and the resulting [0, 105] Y range squashed the
 * temperature trace to the bottom 30% of the canvas. Different unit ⇒
 * different axis is the only safe semantics.
 */
export function distributeAxes(
  defs: ChartSeriesDef[],
  workerSeries: WorkerSeriesPayload[]
): Array<'y' | 'y2'> {
  const result: Array<'y' | 'y2'> = [];
  const leftMags: number[] = [];
  const rightMags: number[] = [];
  const leftUnits = new Set<string>();
  const rightUnits = new Set<string>();

  function magnitude(payload: WorkerSeriesPayload | undefined): number {
    if (!payload || payload.ys.length === 0) return 0;
    const vals: number[] = [];
    for (let i = 0; i < payload.ys.length; i++) {
      const v = payload.ys[i];
      if (Number.isFinite(v)) vals.push(Math.abs(v));
    }
    if (vals.length === 0) return 0;
    vals.sort((a, b) => a - b);
    return quantile(vals, 0.9);
  }

  function magnitudeCompatible(mag: number, refs: number[]): boolean {
    if (refs.length === 0) return true;
    for (const r of refs) {
      if (mag === 0 && r === 0) return true;
      if (r === 0 || mag === 0) continue;
      const ratio = Math.max(mag, r) / Math.min(mag, r);
      if (ratio <= 5) return true;
    }
    return false;
  }

  function unitCompatible(unit: string, axisUnits: Set<string>): boolean {
    if (axisUnits.size === 0) return true;
    if (!unit) return true; // unitless series can sit anywhere
    if (axisUnits.has('')) return true; // axis already has unitless members
    return axisUnits.has(unit);
  }

  defs.forEach((def, i) => {
    const mag = magnitude(workerSeries[i]);
    const unit = unitFor(def.attribute);
    if (def.yAxis === 'right') {
      result.push('y2');
      rightMags.push(mag);
      rightUnits.add(unit);
      return;
    }
    if (i === 0) {
      result.push('y');
      leftMags.push(mag);
      leftUnits.add(unit);
      return;
    }
    const fitsLeft =
      unitCompatible(unit, leftUnits) && magnitudeCompatible(mag, leftMags);
    const fitsRight =
      unitCompatible(unit, rightUnits) && magnitudeCompatible(mag, rightMags);
    if (fitsLeft) {
      result.push('y');
      leftMags.push(mag);
      leftUnits.add(unit);
    } else if (fitsRight) {
      result.push('y2');
      rightMags.push(mag);
      rightUnits.add(unit);
    } else if (rightMags.length < leftMags.length) {
      result.push('y2');
      rightMags.push(mag);
      rightUnits.add(unit);
    } else {
      result.push('y');
      leftMags.push(mag);
      leftUnits.add(unit);
    }
  });
  return result;
}

/** Result of Y-range computation; includes outlier accounting for focus mode. */
export interface YRangeResult {
  range: [number, number] | null;
  /** Count of finite values inside `pool` (after fit-visible filtering). */
  poolSize: number;
  /** Count of finite values that fall outside the computed range. */
  outliersExcluded: number;
}

/**
 * Compute Y range for one axis given the value pool on that axis and the
 * current scale mode. Outliers stay in the data; only the *range* is shaped.
 *
 * Returns the computed range plus the number of values that fall outside it
 * (used by the outlier badge in focus mode).
 */
export function computeYRange(
  values: number[],
  mode: YScaleMode,
  manual?: { min: number; max: number },
  visibleX?: {
    /** Per-series Y arrays — same order as Y series on this axis. */
    perSeriesY: Float64Array[];
    /** Per-series X arrays. */
    perSeriesX: Float64Array[];
    xMin: number;
    xMax: number;
  }
): YRangeResult {
  // Manual: caller specifies the range. Pool size / outliers don't matter for UI.
  if (mode === 'manual' && manual && Number.isFinite(manual.min) && Number.isFinite(manual.max)) {
    if (manual.max <= manual.min) {
      return { range: [manual.min - 1, manual.min + 1], poolSize: 0, outliersExcluded: 0 };
    }
    let outsideCount = 0;
    for (const v of values) {
      if (Number.isFinite(v) && (v < manual.min || v > manual.max)) outsideCount += 1;
    }
    return { range: [manual.min, manual.max], poolSize: values.length, outliersExcluded: outsideCount };
  }

  // Build the working pool: fit-visible filters by X range, others use full pool.
  let pool = values;
  if (mode === 'fit-visible' && visibleX) {
    const filtered: number[] = [];
    for (let s = 0; s < visibleX.perSeriesX.length; s++) {
      const xs = visibleX.perSeriesX[s];
      const ys = visibleX.perSeriesY[s];
      if (!xs || !ys) continue;
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        const y = ys[i];
        if (
          Number.isFinite(y) &&
          Number.isFinite(x) &&
          x >= visibleX.xMin &&
          x <= visibleX.xMax
        ) {
          filtered.push(y);
        }
      }
    }
    pool = filtered;
  }

  if (pool.length === 0) {
    return { range: null, poolSize: 0, outliersExcluded: 0 };
  }
  const sorted = pool.slice().sort((a, b) => a - b);

  if (mode === 'focus') {
    const lo = quantile(sorted, 0.02);
    const hi = quantile(sorted, 0.98);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return { range: null, poolSize: pool.length, outliersExcluded: 0 };
    }
    if (lo === hi) {
      return { range: [lo - 1, lo + 1], poolSize: pool.length, outliersExcluded: 0 };
    }
    const pad = (hi - lo) * 0.05;
    const lower = lo - pad;
    const upper = hi + pad;
    let outsideCount = 0;
    for (const v of sorted) {
      if (v < lower || v > upper) outsideCount += 1;
    }
    return { range: [lower, upper], poolSize: pool.length, outliersExcluded: outsideCount };
  }

  // 'auto' and 'fit-visible' (after pool filtering) → simple min/max + 5% pad.
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  if (lo === hi) {
    return { range: [lo - 1, lo + 1], poolSize: pool.length, outliersExcluded: 0 };
  }
  const pad = (hi - lo) * 0.05;
  return { range: [lo - pad, hi + pad], poolSize: pool.length, outliersExcluded: 0 };
}

/** Localized "yyyy-mm-dd HH:MM" from epoch seconds. */
export function formatLocalTimestamp(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Binary search nearest index in a strictly increasing xs Float64Array. */
export function nearestIndex(xs: Float64Array, target: number): number {
  const n = xs.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(xs[lo - 1] - target) < Math.abs(xs[lo] - target)) {
    return lo - 1;
  }
  return lo;
}
