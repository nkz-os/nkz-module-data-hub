/**
 * PanelSeriesRail — left-side per-series inspector.
 *
 * Fase 3: minimal contract — renders the series list with color, name, and an
 * axis selector (left/right). Fase 4 (B2) adds visibility toggle, color picker,
 * remove button, and per-series mini stats; without re-fetch.
 */

import React from 'react';
import type { ChartSeriesDef } from '../../types/dashboard';

export interface PanelSeriesRailProps {
  series: ChartSeriesDef[];
  /** Color resolver shared with the chart and footer. */
  colorFor: (seriesKey: string, index: number) => string;
  /** Unit resolver. */
  unitFor: (attribute: string) => string;
  /** Stable key generator must match the chart's. */
  seriesKey: (s: ChartSeriesDef) => string;
  onAxisChange: (seriesIndex: number, yAxis: 'left' | 'right') => void;
  labels: { axisLeft: string; axisRight: string; emptyHint: string };
}

export const PanelSeriesRail: React.FC<PanelSeriesRailProps> = ({
  series,
  colorFor,
  unitFor,
  seriesKey,
  onAxisChange,
  labels,
}) => {
  if (series.length === 0) {
    return (
      <div className="w-40 shrink-0 border-r border-slate-800/80 bg-slate-950/30 px-2 py-2 text-[11px] text-slate-500">
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
          return (
            <li
              key={key}
              className="px-2 py-1.5 border-b border-slate-800/40 hover:bg-slate-800/30"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  aria-hidden
                  className="inline-block w-2.5 h-2.5 rounded-full ring-1 ring-slate-900 shrink-0"
                  style={{ background: color }}
                />
                <span
                  className="text-[11px] text-slate-100 truncate"
                  title={`${s.attribute} (${s.entityId})`}
                >
                  {s.attribute}
                </span>
                {unit && <span className="text-[9px] text-slate-500 ml-auto">{unit}</span>}
              </div>
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
                >
                  {labels.axisLeft.toUpperCase()}
                </button>
                <button
                  type="button"
                  onClick={() => onAxisChange(i, 'right')}
                  className={[
                    'flex-1 text-[9px] py-0.5 rounded-r border transition-colors',
                    s.yAxis === 'right'
                      ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800',
                  ].join(' ')}
                >
                  {labels.axisRight.toUpperCase()}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
