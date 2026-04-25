/**
 * PanelToolbar — visible action bar for axis modes, view mode, zoom, options.
 *
 * Fase 3 ships the structural shell with two minimal controls (style & line width),
 * preserving the appearance API. Fase 5 (B3) adds yScaleMode segmented; Fase 6 (D1)
 * adds zoom reset/undo and crosshair-sync toggle; Fase 7 (C1) adds viewMode toggle
 * and trendline; Fase 8 adds threshold management.
 */

import React from 'react';
import { Settings2 } from 'lucide-react';

import type { ChartAppearance, ChartRenderMode } from '../../types/dashboard';

export interface PanelToolbarProps {
  appearance: ChartAppearance;
  onAppearanceChange: (next: Partial<ChartAppearance>) => void;
  /** Toggle for the side rail (Fase 4). */
  seriesRailOpen: boolean;
  onToggleSeriesRail: () => void;
  /** Localized labels. */
  labels: {
    style: string;
    line: string;
    points: string;
    modeLine: string;
    modePoints: string;
    seriesRail: string;
  };
}

export const PanelToolbar: React.FC<PanelToolbarProps> = ({
  appearance,
  onAppearanceChange,
  seriesRailOpen,
  onToggleSeriesRail,
  labels,
}) => {
  return (
    <div className="h-8 flex items-center gap-2 px-2 border-b border-slate-800/80 bg-slate-950/40 text-[11px] text-slate-300">
      <button
        type="button"
        onClick={onToggleSeriesRail}
        className={[
          'p-1 rounded-md border transition-colors',
          seriesRailOpen
            ? 'bg-slate-800 border-slate-600 text-slate-100'
            : 'bg-transparent border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-100',
        ].join(' ')}
        aria-pressed={seriesRailOpen}
        title={labels.seriesRail}
      >
        <Settings2 size={13} />
      </button>

      <div className="w-px h-4 bg-slate-700/70 mx-0.5" />

      <label className="flex items-center gap-1.5">
        <span className="text-slate-500">{labels.style}</span>
        <select
          value={appearance.mode === 'bars' ? 'line' : appearance.mode}
          onChange={(e) => onAppearanceChange({ mode: e.target.value as ChartRenderMode })}
          className="rounded border border-slate-700 bg-slate-900 text-slate-100 px-1.5 py-0.5"
        >
          <option value="line">{labels.modeLine}</option>
          <option value="points">{labels.modePoints}</option>
        </select>
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-slate-500">{labels.line}</span>
        <input
          type="range"
          min={1}
          max={4}
          step={1}
          value={appearance.lineWidth}
          onChange={(e) => onAppearanceChange({ lineWidth: Number(e.target.value) })}
          className="w-14 accent-emerald-500"
        />
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-slate-500">{labels.points}</span>
        <input
          type="range"
          min={0}
          max={8}
          step={1}
          value={appearance.pointRadius}
          onChange={(e) => onAppearanceChange({ pointRadius: Number(e.target.value) })}
          className="w-14 accent-emerald-500"
        />
      </label>
    </div>
  );
};
