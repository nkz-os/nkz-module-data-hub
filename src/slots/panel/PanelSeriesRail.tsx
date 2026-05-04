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
import { SlotShell } from '@nekazari/viewer-kit';
import { Button } from '@nekazari/ui-kit';
import { Eye, EyeOff, Trash2 } from 'lucide-react';

const datahubAccent = { base: '#06B6D4', soft: '#CFFAFE', strong: '#0891B2' };

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
      <SlotShell moduleId="datahub" accent={datahubAccent}>
      <div className="w-44 shrink-0 border-r border-border/5 px-3 py-2 text-[11px] text-muted-foreground">
        {labels.emptyHint}
      </div>
      </SlotShell>
    );
  }

  return (
    <SlotShell moduleId="datahub" accent={datahubAccent}>
    <div className="w-44 shrink-0 border-r border-border/5 bg-transparent overflow-y-auto">
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
                    className="inline-block w-3 h-3 rounded-full ring-1 ring-background"
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
                  className="text-[11px] text-foreground truncate flex-1 min-w-0"
                  title={`${s.attribute} (${s.entityId})`}
                >
                  {s.attribute}
                </span>
                {unit && <span className="text-[9px] text-muted-foreground">{unit}</span>}
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
                <Button
                  variant={(s.yAxis ?? 'left') === 'left' ? 'primary' : 'ghost'}
                  size="xs"
                  className="flex-1 rounded-l rounded-r-none text-[9px]"
                  onClick={() => onAxisChange(i, 'left')}
                  title={labels.axisLeft}
                >
                  L
                </Button>
                <Button
                  variant={s.yAxis === 'right' ? 'primary' : 'ghost'}
                  size="xs"
                  className="flex-1 rounded-none text-[9px]"
                  onClick={() => onAxisChange(i, 'right')}
                  title={labels.axisRight}
                >
                  R
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="px-1 rounded-none"
                  onClick={() => onVisibilityChange(i, !visible)}
                  aria-pressed={!visible}
                  title={visible ? labels.hide : labels.show}
                >
                  {visible ? <Eye size={10} /> : <EyeOff size={10} />}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="px-1 rounded-r rounded-l-none"
                  onClick={() => onRemove(i)}
                  title={labels.remove}
                >
                  <Trash2 size={10} />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
    </SlotShell>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <span className="flex items-center gap-1 text-muted-foreground truncate">
    <span>{label}</span>
    <span className="text-foreground">{formatNumberShort(value)}</span>
  </span>
);
