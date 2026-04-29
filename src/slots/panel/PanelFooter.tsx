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
import type { ThresholdAlert } from './thresholds';

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
  /** Pearson r between first 2 visible series (timeseries mode only). */
  pearsonR?: number | null;
  /** Sample size n for Pearson. */
  pearsonN?: number | null;
  /** Outliers excluded by focus Y-scale mode. */
  outlierCount?: number;
  /** A3 guardrail: true when Y range was auto-expanded to keep trace visible. */
  guardrailFired?: boolean;
  /** Threshold alerts computed from visible series. */
  thresholdAlerts?: ThresholdAlert[];
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
  pearsonR,
  pearsonN,
  outlierCount,
  guardrailFired,
  thresholdAlerts,
  telemetry,
  labels,
}) => {
  return (
    <div className="h-6 flex items-center gap-3 px-3 text-[10px] text-slate-300 bg-slate-950/90 border-t border-slate-800/60 pointer-events-none">
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

      {/* Pearson r badge — shows when 2+ series in timeseries mode */}
      {pearsonR != null && Number.isFinite(pearsonR) && (
        <span className="tabular-nums whitespace-nowrap font-mono text-[9px] px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700/50">
          <span className="text-slate-400">r=</span>
          <span className={pearsonR >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
            {pearsonR.toFixed(3)}
          </span>
          {pearsonN != null && (
            <span className="text-slate-500 ml-1">n={pearsonN}</span>
          )}
        </span>
      )}

      {/* Outlier count badge */}
      {outlierCount != null && outlierCount > 0 && (
        <span className="tabular-nums whitespace-nowrap font-mono text-[9px] px-1.5 py-0.5 rounded bg-amber-900/30 border border-amber-700/30 text-amber-300">
          {outlierCount} outliers
        </span>
      )}

      {/* Threshold alert badges */}
      {thresholdAlerts && thresholdAlerts.length > 0 && thresholdAlerts.map((a, i) => (
        <span
          key={`alert-${i}`}
          className="tabular-nums whitespace-nowrap font-mono text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1"
          style={{ background: `${a.threshold.color}15`, border: `1px solid ${a.threshold.color}40`, color: a.threshold.color }}
        >
          <span className="text-[10px]">⚠</span>
          {a.threshold.label}
          <span className="opacity-60">{a.crossedCount} pts</span>
        </span>
      ))}

      {/* A3 Guardrail indicator */}
      {guardrailFired && (
        <span
          className="tabular-nums whitespace-nowrap font-mono text-[9px] px-1.5 py-0.5 rounded bg-sky-900/30 border border-sky-700/30 text-sky-300"
          title="Y range auto-expanded: flat trace detected"
        >
          auto-scaled
        </span>
      )}

      {/* Telemetry strip — always present but compact. Devs can hide it with
          ?datahub_debug=0 or boost it (per-series breakdown) with =2. */}
      <TelemetryStrip telemetry={telemetry} />
    </div>
  );
};

const TelemetryStrip: React.FC<{ telemetry: PanelFooterProps['telemetry'] }> = ({ telemetry }) => {
  const debugLevel = (() => {
    if (typeof window === 'undefined') return 1;
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('datahub_debug');
      if (fromUrl != null) return Number.parseInt(fromUrl, 10) || 0;
      const stored = window.localStorage.getItem('datahub.debug');
      if (stored != null) return Number.parseInt(stored, 10) || 0;
    } catch {
      // ignore (private mode, etc.)
    }
    return 1;
  })();
  if (debugLevel <= 0) return <span className="ml-auto" aria-hidden />;
  const fullDetail = debugLevel >= 2;
  return (
    <span
      className="ml-auto tabular-nums text-slate-500 whitespace-nowrap font-mono text-[9px]"
      title={`debug=${debugLevel}`}
    >
      {telemetry.plotted}/{telemetry.received} pts · {telemetry.viewportWidth}×
      {telemetry.viewportHeight} · {telemetry.scaleMode} · {telemetry.stage}
      {fullDetail && (
        <>
          {' '}· dpr {typeof window !== 'undefined' ? window.devicePixelRatio : 1}
        </>
      )}
    </span>
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
