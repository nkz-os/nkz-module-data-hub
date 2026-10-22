/**
 * Threshold dictionary — agronomic / sensor reference lines drawn over the chart.
 *
 * Two sources:
 *   1. Built-in defaults per attribute (this file). E.g. 0°C frost line for
 *      temperature; 35°C heat-stress line; 90% disease-risk humidity.
 *   2. User-defined thresholds in chartAppearance.thresholds (Phase 8 user UI
 *      can be extended later — for now they round-trip via workspace persistence).
 *
 * resolveThresholds() returns the union, deduplicated by axis+value.
 */

import type { ChartSeriesDef, ThresholdLine } from '../../types/dashboard';

const DEFAULTS: Record<string, ThresholdLine[]> = {
  temperature: [
    { value: 0, color: '#22d3ee', label: 'Helada', axis: 'left', style: 'dash' },
    { value: 35, color: '#f87171', label: 'Estrés calor', axis: 'left', style: 'dash' },
  ],
  airTemperature: [
    { value: 0, color: '#22d3ee', label: 'Helada', axis: 'left', style: 'dash' },
    { value: 35, color: '#f87171', label: 'Estrés calor', axis: 'left', style: 'dash' },
  ],
  relativeHumidity: [
    { value: 90, color: '#fbbf24', label: 'Riesgo enfermedad', axis: 'left', style: 'dash' },
  ],
  humidity: [
    { value: 90, color: '#fbbf24', label: 'Riesgo enfermedad', axis: 'left', style: 'dash' },
  ],
};

/**
 * Build the effective threshold list for the panel.
 *
 * Defaults are applied only for attributes actually plotted on each axis.
 * User thresholds are appended verbatim (axis honoured as-is).
 */
export function resolveThresholds(
  series: ChartSeriesDef[],
  effectiveScales: Array<'y' | 'y2'>,
  userThresholds: ThresholdLine[] = []
): ThresholdLine[] {
  const out: ThresholdLine[] = [];
  const seen = new Set<string>();

  function add(line: ThresholdLine) {
    const key = `${line.axis}|${line.value.toFixed(6)}|${line.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(line);
  }

  series.forEach((s, i) => {
    const defaults = DEFAULTS[s.attribute];
    if (!defaults) return;
    const axis = effectiveScales[i] === 'y2' ? 'right' : 'left';
    for (const def of defaults) {
      add({ ...def, axis });
    }
  });

  for (const u of userThresholds) {
    add(u);
  }

  return out;
}

// ──────── Threshold Alerts ────────

export interface ThresholdAlert {
  threshold: ThresholdLine;
  crossedCount: number;
  extremeValue: number;
}

export function computeThresholdAlerts(
  series: Array<{ ys: Float64Array; xs: Float64Array }>,
  effectiveScales: Array<'y' | 'y2'>,
  thresholds: ThresholdLine[],
): ThresholdAlert[] {
  const alerts: ThresholdAlert[] = [];
  for (const t of thresholds) {
    let crossedCount = 0;
    let extremeValue = t.value;
    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      const axis = effectiveScales[i] === 'y2' ? 'right' : 'left';
      if (axis !== t.axis) continue;
      for (let j = 0; j < s.ys.length; j++) {
        const y = s.ys[j];
        if (!Number.isFinite(y)) continue;
        const crossed =
          (t.value > 0 && y > t.value) ||
          (t.value < 0 && y < t.value) ||
          (t.value === 0 && y < 0);
        if (crossed) {
          crossedCount++;
          if (Math.abs(y - t.value) > Math.abs(extremeValue - t.value)) {
            extremeValue = y;
          }
        }
      }
    }
    if (crossedCount > 0) {
      alerts.push({ threshold: t, crossedCount, extremeValue });
    }
  }
  return alerts;
}
