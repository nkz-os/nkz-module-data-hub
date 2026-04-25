/**
 * PanelSeriesRail — left-side per-series inspector (Fase 4 / B2).
 *
 * Per-series controls, all panel-local, all instant (no re-fetch needed):
 *   - visibility toggle (eye / eye-off)
 *   - color chip with native picker for override
 *   - mini stats (min / max / avg / last)
 *   - axis selector left / right
 *   - remove from panel (calls into DataHubDashboard via callback)
 *
 * Mobile (<360px host width): rendered as a bottom sheet by the orchestrator.
 * This component is layout-agnostic — the orchestrator decides where to mount it.
 */

import React from 'react';
import { Eye, EyeOff, Trash2 } from 'lucide-react';

import type { ChartSeriesDef, SeriesConfig } from '../../types/dashboard';
import type { WorkerSeriesPayload } from '../../workers/contracts/datahubWorkerV2';

export interface MiniStats {
  min: number;
  max: number;
  mean: number;
  last: number;
  count: number;
}

export interface PanelSeriesRailProps {
  series: ChartSeriesDef[];
  workerSeries: WorkerSeriesPayload[];
  /** Color resolver shared with chart and footer. */
  colorFor: (seriesKey: string, index: number) => string;
  /** Unit resolver. */
  unitFor: (attribute: string) => string;
  /** Stable key generator must match the chart's. */
  seriesKey: (s: ChartSeriesDef) => string;
  /** Read-only seriesConfig snapshot keyed by seriesKey(s). */
  config: Record<string, SeriesConfig>;
  onAxisChange: (seriesIndex: number, yAxis: 'left' | 'right') => void;
  onVisibilityChange: (seriesIndex: number, visible: boolean) => void;
  onColorChange: (seriesIndex: number, colorHex: string) => void;
  onRemove: (seriesIndex: number) => void;
  labels: {
    axisLeft: string;
    axisRight: string;
    show: string;
    hide: string;
    remove: string;
    emptyHint: string;
    statMin: string;
    statMax: string;
    statAvg: string;
    statLast: string;
  };
}

function formatNumberShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

function computeMini(payload: WorkerSeriesPayload | undefined): MiniStats | null {
  if (!payload || payload.ys.length === 0) return null;
  let mn = Number.POSITIVE_INFINITY;
  let mx = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let n = 0;
  let last = Number.NaN;
  for (let i = 0; i < payload.ys.length; i++) {
    const v = payload.ys[i];
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

export const PanelSeriesRail: React.FC<PanelSeriesRailProps> = ({
  series,
  workerSeries,
  colorFor,
  unitFor,
  seriesKey,
  config,
  onAxisChange,
  onVisibilityChange,
  onColorChange,
  onRemove,
  labels,
}) => {
  if (series.length === 0) {
    return (
      <div className="w-44 shrink-0 border-r border-slate-800/80 bg-slate-950/30 px-3 py-2 text-[11px] text-slate-500">
        {labels.emptyHint}
      </div>
    );
  }

  return (
    <div className="w-44 shrink-0 border-r border-slate-800/80 bg-slate-950/40 overflow-y-auto">
      <ul className="flex flex-col">
        {series.map((s, i) => {
          const key = seriesKey(s);
          const color = colorFor(key, i);
          const unit = unitFor(s.attribute);
          const cfg = config[key] ?? {};
          const visible = cfg.visible !== false;
          const payload = workerSeries.find((p) => p.key === key);
          const stats = computeMini(payload);

          return (
            <li
              key={key}
              className={[
                'px-2 py-1.5 border-b border-slate-800/40',
                visible ? 'opacity-100' : 'opacity-50',
              ].join(' ')}
            >
              {/* Title row: color picker + name + unit + remove */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <label className="relative inline-flex shrink-0 cursor-pointer" title={cfg.colorOverride ?? color}>
                  <span
                    aria-hidden
                    className="inline-block w-3 h-3 rounded-full ring-1 ring-slate-900"
                    style={{ background: color }}
                  />
                  <input
                    type="color"
                    value={cfg.colorOverride ?? color}
                    onChange={(e) => onColorChange(i, e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    aria-label={`color for ${s.attribute}`}
                  />
                </label>
                <span
                  className="text-[11px] text-slate-100 truncate flex-1 min-w-0"
                  title={`${s.attribute} (${s.entityId})`}
                >
                  {s.attribute}
                </span>
                {unit && <span className="text-[9px] text-slate-500">{unit}</span>}
              </div>

              {/* Mini stats */}
              {stats && (
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mb-1.5 text-[9px] font-mono tabular-nums">
                  <Stat label={labels.statMin} value={stats.min} />
                  <Stat label={labels.statMax} value={stats.max} />
                  <Stat label={labels.statAvg} value={stats.mean} />
                  <Stat label={labels.statLast} value={stats.last} />
                </div>
              )}

              {/* Action row: axis selector + visibility + remove */}
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onAxisChange(i, 'left')}
                  className={[
                    'flex-1 text-[9px] py-0.5 rounded-l border transition-colors',
                    (s.yAxis ?? 'left') === 'left'
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800',
                  ].join(' ')}
                  title={labels.axisLeft}
                >
                  L
                </button>
                <button
                  type="button"
                  onClick={() => onAxisChange(i, 'right')}
                  className={[
                    'flex-1 text-[9px] py-0.5 border-y transition-colors',
                    s.yAxis === 'right'
                      ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800',
                  ].join(' ')}
                  title={labels.axisRight}
                >
                  R
                </button>
                <button
                  type="button"
                  onClick={() => onVisibilityChange(i, !visible)}
                  className="px-1 py-0.5 border border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
                  aria-pressed={!visible}
                  title={visible ? labels.hide : labels.show}
                >
                  {visible ? <Eye size={10} aria-hidden /> : <EyeOff size={10} aria-hidden />}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="px-1 py-0.5 rounded-r border border-slate-700 bg-slate-900 text-slate-400 hover:bg-rose-900/40 hover:text-rose-300 hover:border-rose-700 transition-colors"
                  title={labels.remove}
                >
                  <Trash2 size={10} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <span className="flex items-center gap-1 text-slate-500 truncate">
    <span>{label}</span>
    <span className="text-slate-200">{formatNumberShort(value)}</span>
  </span>
);
