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
import {
  Settings2,
  Sliders,
  Maximize2,
  Activity,
  RotateCcw,
  Undo2,
  ZoomOut,
  TrendingUp,
  Waves,
  LineChart,
  GitCompare,
  Image,
} from 'lucide-react';

import type {
  ChartAppearance,
  ChartRenderMode,
  ChartViewMode,
  RollingAvgWindow,
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
  /** Labels for the currently visible series — used by correlation X/Y selectors. */
  seriesLabels?: string[];
  /** Image export callback. When omitted, the button is hidden. */
  onExportImage?: () => void;
  /** Live mode state + toggle. */
  liveMode?: boolean;
  onToggleLive?: () => void;
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
    trendline: string;
    showOutliers: string;
    rollingAvg: string;
    rollingOff: string;
    viewMode: string;
    viewTimeseries: string;
    viewCorrelation: string;
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
  seriesLabels,
  onExportImage,
  liveMode,
  onToggleLive,
  labels,
}) => {
  const [manualOpen, setManualOpen] = useState(false);

  return (
    <div className="min-h-[40px] flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-[#eaeef4] relative">
      <button
        type="button"
        onClick={onToggleSeriesRail}
        className={[
          'p-1 rounded-md transition-colors',
          seriesRailOpen
            ? 'bg-white/10 text-[#eaeef4]'
            : 'text-[#8b95a5] hover:bg-white/5 hover:text-[#eaeef4]',
        ].join(' ')}
        aria-pressed={seriesRailOpen}
        title={labels.seriesRail}
      >
        <Settings2 size={14} />
      </button>

      <div className="w-px h-4 bg-white/10 mx-0.5" />

      {/* Zoom controls (D1) */}
      <button
        type="button"
        onClick={onZoomUndo}
        disabled={!canUndoZoom}
        className="p-1.5 rounded-md border border-transparent text-[#8b95a5] hover:bg-[#1a2030] hover:text-[#eaeef4] disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
        title={labels.zoomUndo}
      >
        <Undo2 size={14} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onZoomReset}
        disabled={!canResetZoom}
        className="p-1.5 rounded-md border border-transparent text-[#8b95a5] hover:bg-[#1a2030] hover:text-[#eaeef4] disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
        title={labels.zoomReset}
      >
        <ZoomOut size={14} aria-hidden />
      </button>

      {onExportImage && (
        <button
          type="button"
          onClick={onExportImage}
          className="p-1.5 rounded-md text-[#8b95a5] hover:bg-[#1a2030] hover:text-[#eaeef4] transition-colors"
          title="Copy chart as PNG"
        >
          <Image size={14} aria-hidden />
        </button>
      )}

      {onToggleLive && (
        <button
          type="button"
          onClick={onToggleLive}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
            liveMode
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'text-[#8b95a5] hover:bg-[#1a2030] hover:text-[#eaeef4]'
          }`}
          title="Live IoT refresh"
        >
          <span className={`h-2 w-2 rounded-full ${liveMode ? 'bg-emerald-400 animate-pulse' : 'bg-[#2a3345]'}`} />
          LIVE
        </button>
      )}

      <div className="w-px h-4 bg-white/10 mx-0.5" />

      {/* View mode (timeseries / correlation) — only shown when 2+ series */}
      <div
        className="inline-flex items-center rounded-md border border-white/10 overflow-hidden"
        role="group"
        aria-label={labels.viewMode}
      >
        <button
          type="button"
          onClick={() => onAppearanceChange({ viewMode: 'timeseries' as ChartViewMode })}
          className={[
            'flex items-center gap-1 px-2 py-1 text-xs transition-colors border-r border-white/10',
            appearance.viewMode === 'timeseries'
              ? 'bg-emerald-500/20 text-emerald-200'
              : 'bg-[#111622] text-[#8b95a5] hover:bg-[#1a2030] hover:text-[#eaeef4]',
          ].join(' ')}
          title={labels.viewTimeseries}
          aria-pressed={appearance.viewMode === 'timeseries'}
        >
          <LineChart size={13} aria-hidden />
          {labels.viewTimeseries}
        </button>
        <button
          type="button"
          onClick={() => onAppearanceChange({ viewMode: 'correlation' as ChartViewMode })}
          className={[
            'flex items-center gap-1 px-2 py-1 text-xs transition-colors',
            appearance.viewMode === 'correlation'
              ? 'bg-purple-500/20 text-purple-200'
              : 'bg-[#111622] text-[#8b95a5] hover:bg-[#1a2030] hover:text-[#eaeef4]',
          ].join(' ')}
          title={labels.viewCorrelation}
          aria-pressed={appearance.viewMode === 'correlation'}
        >
          <GitCompare size={13} aria-hidden />
          {labels.viewCorrelation}
        </button>
      </div>

      {appearance.viewMode === 'correlation' && seriesLabels && seriesLabels.length >= 2 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[#8b95a5] text-xs">X</span>
          <select
            value={appearance.correlationXSeries}
            onChange={(e) =>
              onAppearanceChange({ correlationXSeries: Number.parseInt(e.target.value, 10) })
            }
            className="rounded border border-white/10 bg-[#111622] text-[#eaeef4] px-2 py-1 text-xs max-w-[140px]"
          >
            {seriesLabels.map((lbl, i) => (
              <option key={`x-${i}`} value={i}>
                {lbl}
              </option>
            ))}
          </select>
          <span className="text-[#8b95a5] text-xs">Y</span>
          <select
            value={appearance.correlationYSeries}
            onChange={(e) =>
              onAppearanceChange({ correlationYSeries: Number.parseInt(e.target.value, 10) })
            }
            className="rounded border border-white/10 bg-[#111622] text-[#eaeef4] px-2 py-1 text-xs max-w-[140px]"
          >
            {seriesLabels.map((lbl, i) => (
              <option key={`y-${i}`} value={i}>
                {lbl}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="w-px h-4 bg-white/10 mx-0.5" />

      {/* Trendline toggle */}
      <button
        type="button"
        onClick={() => onAppearanceChange({ showTrendline: !appearance.showTrendline })}
        className={[
          'flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors',
          appearance.showTrendline
            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200'
            : 'bg-[#111622] border-white/10 text-[#8b95a5] hover:bg-[#1a2030] hover:text-[#eaeef4]',
        ].join(' ')}
        aria-pressed={appearance.showTrendline}
        title={labels.trendline}
      >
        <TrendingUp size={13} aria-hidden />
        {labels.trendline}
      </button>

      {/* Rolling average dropdown */}
      <label className="flex items-center gap-1.5">
        <Waves size={13} className="text-[#8b95a5]" aria-hidden />
        <span className="text-[#8b95a5] text-xs">{labels.rollingAvg}</span>
        <select
          value={appearance.rollingAverage ?? 'off'}
          onChange={(e) => onAppearanceChange({ rollingAverage: e.target.value as RollingAvgWindow })}
          className="rounded border border-white/10 bg-[#111622] text-[#eaeef4] px-2 py-1 text-xs"
        >
          <option value="off">{labels.rollingOff}</option>
          <option value="1h">1h</option>
          <option value="24h">24h</option>
          <option value="7d">7d</option>
        </select>
      </label>

      <div className="w-px h-4 bg-white/10 mx-0.5" />

      {/* Y scale mode segmented */}
      <div
        className="inline-flex items-center rounded-md border border-white/10 overflow-hidden"
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
                'flex items-center gap-1 px-2 py-1 text-xs transition-colors border-r border-white/10 last:border-r-0',
                active
                  ? 'bg-emerald-500/20 text-emerald-200'
                  : 'bg-[#111622] text-[#8b95a5] hover:bg-[#1a2030] hover:text-[#eaeef4]',
              ].join(' ')}
              title={hint}
              aria-pressed={active}
            >
              <Icon size={13} aria-hidden />
              {labels[labelKey]}
            </button>
          );
        })}
      </div>

      {appearance.yScaleMode === 'focus' && (
        <button
          type="button"
          onClick={() => onAppearanceChange({ yScaleMode: 'auto' })}
          className="flex items-center gap-1 px-2 py-1 rounded border border-amber-700/30 bg-amber-900/20 hover:bg-amber-900/40 text-xs text-amber-300 transition-colors"
          title={labels.showOutliers}
        >
          {labels.showOutliers}
        </button>
      )}

      {appearance.yScaleMode === 'manual' && (
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="px-2 py-1 rounded border border-white/10 bg-[#111622] hover:bg-[#1a2030] text-xs text-[#8b95a5]"
        >
          {manualOpen ? '−' : '+'} {labels.yManual}
        </button>
      )}

      <div className="w-px h-4 bg-white/10 mx-0.5" />

      <label className="flex items-center gap-1.5">
        <span className="text-[#8b95a5] text-xs">{labels.style}</span>
        <select
          value={appearance.mode === 'bars' ? 'line' : appearance.mode}
          onChange={(e) => onAppearanceChange({ mode: e.target.value as ChartRenderMode })}
          className="rounded border border-white/10 bg-[#111622] text-[#eaeef4] px-2 py-1 text-xs"
        >
          <option value="line">{labels.modeLine}</option>
          <option value="points">{labels.modePoints}</option>
        </select>
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-[#8b95a5] text-xs">{labels.line}</span>
        <input
          type="range"
          min={1}
          max={4}
          step={1}
          value={appearance.lineWidth}
          onChange={(e) => onAppearanceChange({ lineWidth: Number(e.target.value) })}
          className="w-16 accent-emerald-500"
        />
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-[#8b95a5] text-xs">{labels.points}</span>
        <input
          type="range"
          min={0}
          max={8}
          step={1}
          value={appearance.pointRadius}
          onChange={(e) => onAppearanceChange({ pointRadius: Number(e.target.value) })}
          className="w-16 accent-emerald-500"
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
    <div className="absolute top-10 left-2 z-30 px-4 py-3 rounded-lg bg-[#0f1620] border border-white/10 shadow-2xl flex flex-col gap-3 min-w-[280px]">
      <ManualAxisRow
        label={labels.manualLeft}
        accent="emerald"
        min={left?.min}
        max={left?.max}
        step={left?.step}
        onApply={(min, max, step) =>
          onAppearanceChange({
            yScaleManual: { ...(appearance.yScaleManual ?? {}), left: { min, max, step } },
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
          step={right?.step}
          onApply={(min, max, step) =>
            onAppearanceChange({
              yScaleManual: { ...(appearance.yScaleManual ?? {}), right: { min, max, step } },
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
          className="text-xs px-2 py-1 rounded border border-white/10 bg-[#111622] hover:bg-[#1a2030] text-[#8b95a5]"
        >
          {labels.reset}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-sm text-[#8b95a5] hover:text-[#eaeef4]"
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
  step: number | undefined;
  onApply: (min: number, max: number, step?: number) => void;
  labels: PanelToolbarProps['labels'];
}

const ManualAxisRow: React.FC<ManualAxisRowProps> = ({ label, accent, min, max, step, onApply, labels }) => {
  const [draftMin, setDraftMin] = useState<string>(min != null ? String(min) : '');
  const [draftMax, setDraftMax] = useState<string>(max != null ? String(max) : '');
  const [draftStep, setDraftStep] = useState<string>(step != null ? String(step) : '');

  // Reset drafts when external value changes (mode switch, reset).
  React.useEffect(() => {
    setDraftMin(min != null ? String(min) : '');
    setDraftMax(max != null ? String(max) : '');
    setDraftStep(step != null ? String(step) : '');
  }, [min, max, step]);

  const apply = () => {
    const a = Number.parseFloat(draftMin);
    const b = Number.parseFloat(draftMax);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    if (b <= a) return;
    const s = Number.parseFloat(draftStep);
    const stepVal = Number.isFinite(s) && s > 0 ? s : undefined;
    onApply(a, b, stepVal);
  };

  const dotClass = accent === 'emerald' ? 'bg-emerald-400' : 'bg-purple-400';

  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className={`inline-block w-2.5 h-2.5 rounded-full ${dotClass} shrink-0`} />
      <span className="text-xs text-[#eaeef4] w-12 shrink-0">{label}</span>
      <input
        type="number"
        value={draftMin}
        onChange={(e) => setDraftMin(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder={labels.manualMin}
        className="w-16 bg-[#111622] border border-white/10 rounded px-2 py-1 text-xs text-[#eaeef4] tabular-nums font-mono"
      />
      <span className="text-[#596373]">→</span>
      <input
        type="number"
        value={draftMax}
        onChange={(e) => setDraftMax(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder={labels.manualMax}
        className="w-16 bg-[#111622] border border-white/10 rounded px-2 py-1 text-xs text-[#eaeef4] tabular-nums font-mono"
      />
      <span className="text-[#8b95a5] text-xs">step</span>
      <input
        type="number"
        value={draftStep}
        onChange={(e) => setDraftStep(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder="auto"
        className="w-14 bg-[#111622] border border-white/10 rounded px-2 py-1 text-xs text-[#eaeef4] tabular-nums font-mono"
      />
    </div>
  );
};
