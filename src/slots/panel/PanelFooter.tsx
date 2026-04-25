/**
 * PanelFooter — telemetry strip + per-series legend + primary stats.
 *
 * Compact, always visible while status === 'ready'. The plan G1 (Fase 9) refines
 * the telemetry portion to dev-toggle; for now it's always shown in slate-500
 * font-mono so it's there when needed and unobtrusive when not.
 */

import React from 'react';

import type { PerSeriesStats, WorkerSeriesPayload } from '../../workers/contracts/datahubWorkerV2';
import type { FallbackStage } from './hooks/useWorkerSeries';

export interface FooterStats {
  min: number;
  max: number;
  mean: number;
  last: number;
  count: number;
}

export interface PanelFooterProps {
  /** Series payloads returned by the worker (for legend). */
  workerSeries: WorkerSeriesPayload[];
  /** Color resolver — orchestrator may override series colour from chartAppearance. */
  colorFor: (key: string, index: number) => string;
  /** Unit resolver. */
  unitFor: (attribute: string) => string;
  /** Primary-series footer stats (computed from cleaned data). */
  primaryStats: FooterStats | null;
  /** Telemetry — points, viewport, scale mode, stage. */
  telemetry: {
    plotted: number;
    received: number;
    viewportWidth: number;
    viewportHeight: number;
    scaleMode: string;
    stage: FallbackStage;
  };
  /** Pre-localized labels. */
  labels: { min: string; max: string; mean: string; last: string };
}

function formatNumberShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

export const PanelFooter: React.FC<PanelFooterProps> = ({
  workerSeries,
  colorFor,
  unitFor,
  primaryStats,
  telemetry,
  labels,
}) => {
  return (
    <div className="h-6 flex items-center gap-3 px-3 text-[10px] text-slate-300 bg-gradient-to-t from-slate-950/85 to-transparent pointer-events-none">
      {/* Legend */}
      {workerSeries.length > 0 && (
        <div className="flex items-center gap-3 truncate min-w-0">
          {workerSeries.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1.5 truncate">
              <span
                aria-hidden
                className="inline-block w-2 h-2 rounded-full shrink-0 ring-1 ring-slate-900"
                style={{ background: colorFor(s.key, i) }}
              />
              <span className="truncate max-w-[140px] text-slate-200">{s.attribute}</span>
              {unitFor(s.attribute) && (
                <span className="text-slate-500">{unitFor(s.attribute)}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Primary stats */}
      {primaryStats && (
        <span className="tabular-nums whitespace-nowrap font-mono">
          <span className="text-slate-500">{labels.min}</span>
          <span className="text-slate-100 ml-1">{formatNumberShort(primaryStats.min)}</span>
          <span className="text-slate-500 ml-2.5">{labels.max}</span>
          <span className="text-slate-100 ml-1">{formatNumberShort(primaryStats.max)}</span>
          <span className="text-slate-500 ml-2.5">{labels.mean}</span>
          <span className="text-slate-100 ml-1">{formatNumberShort(primaryStats.mean)}</span>
          <span className="text-slate-500 ml-2.5">{labels.last}</span>
          <span className="text-slate-100 ml-1">{formatNumberShort(primaryStats.last)}</span>
        </span>
      )}

      {/* Telemetry strip — always visible, always discreet */}
      <span className="ml-auto tabular-nums text-slate-500 whitespace-nowrap font-mono text-[9px]">
        {telemetry.plotted}/{telemetry.received} pts · {telemetry.viewportWidth}×
        {telemetry.viewportHeight} · {telemetry.scaleMode} · {telemetry.stage}
      </span>
    </div>
  );
};

/** Helper to compute footer stats from a single series' Y values. */
export function computeFooterStats(series: WorkerSeriesPayload | null): FooterStats | null {
  if (!series || series.ys.length === 0) return null;
  let mn = Number.POSITIVE_INFINITY;
  let mx = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let n = 0;
  let last = Number.NaN;
  for (let i = 0; i < series.ys.length; i++) {
    const v = series.ys[i];
    if (Number.isFinite(v)) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sum += v;
      n += 1;
      last = v;
    }
  }
  if (n === 0) return null;
  return { min: mn, max: mx, mean: sum / n, last, count: n };
}

/** Convenience: aggregate plotted/received across all series for the telemetry strip. */
export function aggregatePoints(series: WorkerSeriesPayload[]): {
  plotted: number;
  received: number;
} {
  let plotted = 0;
  let received = 0;
  for (const s of series) {
    plotted += (s.stats as PerSeriesStats).pointsPlotted;
    received += (s.stats as PerSeriesStats).rawPointsFetched;
  }
  return { plotted, received };
}
