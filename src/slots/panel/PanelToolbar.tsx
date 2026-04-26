/**
 * PanelToolbar — visible action bar for axis modes, view mode, zoom, options.
 *
 * Phase 3 introduced the structural shell. Phase 5 (B3) adds:
 *  - yScaleMode segmented control (auto / fit-visible / focus / manual)
 *  - manual range popover (per axis when both axes are in use)
 *
 * Phase 6 (D1) will add zoom reset / undo + crosshair-sync toggle.
 * Phase 7 (C1) will add viewMode toggle (timeseries / correlation) and trendline.
 * Phase 8 will add threshold management.
 */

import React, { useState } from 'react';
import { Settings2, Sliders, Maximize2, Activity, RotateCcw, Undo2, ZoomOut } from 'lucide-react';

import type {
  ChartAppearance,
  ChartRenderMode,
  YScaleMode,
} from '../../types/dashboard';

export interface PanelToolbarProps {
  appearance: ChartAppearance;
  onAppearanceChange: (next: Partial<ChartAppearance>) => void;
  /** Toggle for the side rail (Phase 4). */
  seriesRailOpen: boolean;
  onToggleSeriesRail: () => void;
  /** Whether the right axis is currently in use — gates manual right inputs. */
  hasRightAxis: boolean;
  /** Zoom controls (D1). */
  canUndoZoom: boolean;
  canResetZoom: boolean;
  onZoomUndo: () => void;
  onZoomReset: () => void;
  /** Localized labels. */
  labels: {
    style: string;
    line: string;
    points: string;
    modeLine: string;
    modePoints: string;
    seriesRail: string;
    yScale: string;
    yAuto: string;
    yFitVisible: string;
    yFocus: string;
    yManual: string;
    manualLeft: string;
    manualRight: string;
    manualMin: string;
    manualMax: string;
    apply: string;
    reset: string;
    zoomUndo: string;
    zoomReset: string;
  };
}

const Y_MODE_DEFS: Array<{
  value: YScaleMode;
  labelKey: keyof PanelToolbarProps['labels'];
  Icon: typeof Sliders;
  hint: string;
}> = [
  { value: 'auto', labelKey: 'yAuto', Icon: Sliders, hint: 'min/max + 5% padding' },
  { value: 'fit-visible', labelKey: 'yFitVisible', Icon: Maximize2, hint: 'fit to currently visible X range' },
  { value: 'focus', labelKey: 'yFocus', Icon: Activity, hint: 'p2/p98 — outliers excluded from scale' },
  { value: 'manual', labelKey: 'yManual', Icon: RotateCcw, hint: 'fixed min/max' },
];

export const PanelToolbar: React.FC<PanelToolbarProps> = ({
  appearance,
  onAppearanceChange,
  seriesRailOpen,
  onToggleSeriesRail,
  hasRightAxis,
  canUndoZoom,
  canResetZoom,
  onZoomUndo,
  onZoomReset,
  labels,
}) => {
  const [manualOpen, setManualOpen] = useState(false);

  return (
    <div className="h-8 flex items-center gap-2 px-2 border-b border-slate-800/80 bg-slate-950/40 text-[11px] text-slate-300 relative">
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

      {/* Zoom controls (D1) */}
      <button
        type="button"
        onClick={onZoomUndo}
        disabled={!canUndoZoom}
        className="p-1 rounded-md border border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
        title={labels.zoomUndo}
      >
        <Undo2 size={13} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onZoomReset}
        disabled={!canResetZoom}
        className="p-1 rounded-md border border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
        title={labels.zoomReset}
      >
        <ZoomOut size={13} aria-hidden />
      </button>

      <div className="w-px h-4 bg-slate-700/70 mx-0.5" />

      {/* Y scale mode segmented */}
      <div
        className="inline-flex items-center rounded-md border border-slate-700 overflow-hidden"
        role="group"
        aria-label={labels.yScale}
      >
        {Y_MODE_DEFS.map(({ value, labelKey, Icon, hint }) => {
          const active = appearance.yScaleMode === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => {
                onAppearanceChange({ yScaleMode: value });
                if (value === 'manual') setManualOpen(true);
                else setManualOpen(false);
              }}
              className={[
                'flex items-center gap-1 px-1.5 py-0.5 text-[10px] transition-colors border-r border-slate-700 last:border-r-0',
                active
                  ? 'bg-emerald-500/20 text-emerald-200'
                  : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-100',
              ].join(' ')}
              title={hint}
              aria-pressed={active}
            >
              <Icon size={11} aria-hidden />
              {labels[labelKey]}
            </button>
          );
        })}
      </div>

      {appearance.yScaleMode === 'manual' && (
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[10px] text-slate-300"
        >
          {manualOpen ? '−' : '+'} {labels.yManual}
        </button>
      )}

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
          className="w-12 accent-emerald-500"
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
          className="w-12 accent-emerald-500"
        />
      </label>

      {appearance.yScaleMode === 'manual' && manualOpen && (
        <ManualRangePopover
          appearance={appearance}
          hasRightAxis={hasRightAxis}
          onAppearanceChange={onAppearanceChange}
          onClose={() => setManualOpen(false)}
          labels={labels}
        />
      )}
    </div>
  );
};

interface ManualRangePopoverProps {
  appearance: ChartAppearance;
  hasRightAxis: boolean;
  onAppearanceChange: (next: Partial<ChartAppearance>) => void;
  onClose: () => void;
  labels: PanelToolbarProps['labels'];
}

const ManualRangePopover: React.FC<ManualRangePopoverProps> = ({
  appearance,
  hasRightAxis,
  onAppearanceChange,
  onClose,
  labels,
}) => {
  const left = appearance.yScaleManual?.left;
  const right = appearance.yScaleManual?.right;

  return (
    <div className="absolute top-9 left-2 z-30 px-3 py-2.5 rounded-lg bg-slate-950/95 border border-slate-700/70 shadow-2xl backdrop-blur-md flex flex-col gap-2 min-w-[260px]">
      <ManualAxisRow
        label={labels.manualLeft}
        accent="emerald"
        min={left?.min}
        max={left?.max}
        onApply={(min, max) =>
          onAppearanceChange({
            yScaleManual: { ...(appearance.yScaleManual ?? {}), left: { min, max } },
          })
        }
        labels={labels}
      />
      {hasRightAxis && (
        <ManualAxisRow
          label={labels.manualRight}
          accent="purple"
          min={right?.min}
          max={right?.max}
          onApply={(min, max) =>
            onAppearanceChange({
              yScaleManual: { ...(appearance.yScaleManual ?? {}), right: { min, max } },
            })
          }
          labels={labels}
        />
      )}
      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={() => {
            onAppearanceChange({ yScaleMode: 'auto', yScaleManual: undefined });
            onClose();
          }}
          className="text-[10px] px-2 py-0.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300"
        >
          {labels.reset}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] text-slate-500 hover:text-slate-200"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

interface ManualAxisRowProps {
  label: string;
  accent: 'emerald' | 'purple';
  min: number | undefined;
  max: number | undefined;
  onApply: (min: number, max: number) => void;
  labels: PanelToolbarProps['labels'];
}

const ManualAxisRow: React.FC<ManualAxisRowProps> = ({ label, accent, min, max, onApply, labels }) => {
  const [draftMin, setDraftMin] = useState<string>(min != null ? String(min) : '');
  const [draftMax, setDraftMax] = useState<string>(max != null ? String(max) : '');

  // Reset drafts when external value changes (mode switch, reset).
  React.useEffect(() => {
    setDraftMin(min != null ? String(min) : '');
    setDraftMax(max != null ? String(max) : '');
  }, [min, max]);

  const apply = () => {
    const a = Number.parseFloat(draftMin);
    const b = Number.parseFloat(draftMax);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    if (b <= a) return;
    onApply(a, b);
  };

  const dotClass = accent === 'emerald' ? 'bg-emerald-400' : 'bg-purple-400';

  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className={`inline-block w-2 h-2 rounded-full ${dotClass} shrink-0`} />
      <span className="text-[11px] text-slate-300 w-12 shrink-0">{label}</span>
      <input
        type="number"
        value={draftMin}
        onChange={(e) => setDraftMin(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder={labels.manualMin}
        className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-100 tabular-nums font-mono"
      />
      <span className="text-slate-600">→</span>
      <input
        type="number"
        value={draftMax}
        onChange={(e) => setDraftMax(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder={labels.manualMax}
        className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-100 tabular-nums font-mono"
      />
    </div>
  );
};
