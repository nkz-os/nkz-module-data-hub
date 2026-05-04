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
import { SlotShell } from '@nekazari/viewer-kit';
import { Button, Select, Slider } from '@nekazari/ui-kit';
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

const datahubAccent = { base: '#06B6D4', soft: '#CFFAFE', strong: '#0891B2' };

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
    <SlotShell moduleId="datahub" accent={datahubAccent}>
    <div className="h-8 flex items-center gap-1.5 px-2 text-[10px] text-foreground relative">
      <Button
        variant={seriesRailOpen ? 'primary' : 'ghost'}
        size="xs"
        onClick={onToggleSeriesRail}
        aria-pressed={seriesRailOpen}
        title={labels.seriesRail}
      >
        <Settings2 size={12} />
      </Button>

      <div className="w-px h-3 bg-border mx-0.5" />

      {/* Zoom controls (D1) */}
      <Button variant="ghost" size="xs" onClick={onZoomUndo} disabled={!canUndoZoom} title={labels.zoomUndo}>
        <Undo2 size={13} />
      </Button>
      <Button variant="ghost" size="xs" onClick={onZoomReset} disabled={!canResetZoom} title={labels.zoomReset}>
        <ZoomOut size={13} />
      </Button>

      {onExportImage && (
        <Button variant="ghost" size="xs" onClick={onExportImage} title="Copy chart as PNG">
          <Image size={13} />
        </Button>
      )}

      {onToggleLive && (
        <Button
          variant={liveMode ? 'primary' : 'ghost'}
          size="xs"
          onClick={onToggleLive}
          title="Live IoT refresh"
        >
          <span className={`h-1.5 w-1.5 rounded-full mr-1 ${liveMode ? 'bg-accent animate-pulse' : 'bg-muted'}`} />
          LIVE
        </Button>
      )}

      <div className="w-px h-3 bg-border mx-0.5" />

      {/* View mode (timeseries / correlation) — only shown when 2+ series */}
      <div
        className="inline-flex items-center rounded-md border border-border/50 overflow-hidden"
        role="group"
        aria-label={labels.viewMode}
      >
        <Button
          variant={appearance.viewMode === 'timeseries' ? 'primary' : 'ghost'}
          size="xs"
          className="rounded-none border-r border-border/50"
          onClick={() => onAppearanceChange({ viewMode: 'timeseries' as ChartViewMode })}
          title={labels.viewTimeseries}
          aria-pressed={appearance.viewMode === 'timeseries'}
        >
          <LineChart size={11} />
          {labels.viewTimeseries}
        </Button>
        <Button
          variant={appearance.viewMode === 'correlation' ? 'primary' : 'ghost'}
          size="xs"
          className="rounded-none"
          onClick={() => onAppearanceChange({ viewMode: 'correlation' as ChartViewMode })}
          title={labels.viewCorrelation}
          aria-pressed={appearance.viewMode === 'correlation'}
        >
          <GitCompare size={11} />
          {labels.viewCorrelation}
        </Button>
      </div>

      {appearance.viewMode === 'correlation' && seriesLabels && seriesLabels.length >= 2 && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-[10px]">X</span>
          <Select
            value={appearance.correlationXSeries}
            onChange={(v) => onAppearanceChange({ correlationXSeries: Number(v) })}
            options={seriesLabels.map((lbl, i) => ({ value: String(i), label: lbl }))}
            className="max-w-[120px] text-[10px]"
          />
          <span className="text-muted-foreground text-[10px]">Y</span>
          <Select
            value={appearance.correlationYSeries}
            onChange={(v) => onAppearanceChange({ correlationYSeries: Number(v) })}
            options={seriesLabels.map((lbl, i) => ({ value: String(i), label: lbl }))}
            className="max-w-[120px] text-[10px]"
          />
        </div>
      )}

      <div className="w-px h-3 bg-border mx-0.5" />

      {/* Trendline toggle */}
      <Button
        variant={appearance.showTrendline ? 'primary' : 'ghost'}
        size="xs"
        onClick={() => onAppearanceChange({ showTrendline: !appearance.showTrendline })}
        aria-pressed={appearance.showTrendline}
        title={labels.trendline}
      >
        <TrendingUp size={11} />
        {labels.trendline}
      </Button>

      {/* Rolling average dropdown */}
      <label className="flex items-center gap-1.5">
        <Waves size={11} className="text-muted-foreground" />
        <span className="text-muted-foreground">{labels.rollingAvg}</span>
        <Select
          value={appearance.rollingAverage ?? 'off'}
          onChange={(v) => onAppearanceChange({ rollingAverage: v as RollingAvgWindow })}
          options={[
            { value: 'off', label: labels.rollingOff },
            { value: '1h', label: '1h' },
            { value: '24h', label: '24h' },
            { value: '7d', label: '7d' },
          ]}
          className="text-[10px]"
        />
      </label>

      <div className="w-px h-3 bg-border mx-0.5" />

      {/* Y scale mode segmented */}
      <div
        className="inline-flex items-center rounded-md border border-border/50 overflow-hidden"
        role="group"
        aria-label={labels.yScale}
      >
        {Y_MODE_DEFS.map(({ value, labelKey, Icon, hint }) => {
          const active = appearance.yScaleMode === value;
          return (
            <Button
              key={value}
              variant={active ? 'primary' : 'ghost'}
              size="xs"
              className="rounded-none border-r border-border/50 last:border-r-0"
              onClick={() => {
                onAppearanceChange({ yScaleMode: value });
                if (value === 'manual') setManualOpen(true);
                else setManualOpen(false);
              }}
              title={hint}
              aria-pressed={active}
            >
              <Icon size={11} />
              {labels[labelKey]}
            </Button>
          );
        })}
      </div>

      {appearance.yScaleMode === 'focus' && (
        <Button variant="outline" size="xs" onClick={() => onAppearanceChange({ yScaleMode: 'auto' })} title={labels.showOutliers}>
          {labels.showOutliers}
        </Button>
      )}

      {appearance.yScaleMode === 'manual' && (
        <Button variant="outline" size="xs" onClick={() => setManualOpen((v) => !v)}>
          {manualOpen ? '−' : '+'} {labels.yManual}
        </Button>
      )}

      <div className="w-px h-3 bg-border mx-0.5" />

      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{labels.style}</span>
        <Select
          value={appearance.mode === 'bars' ? 'line' : appearance.mode}
          onChange={(v) => onAppearanceChange({ mode: v as ChartRenderMode })}
          options={[
            { value: 'line', label: labels.modeLine },
            { value: 'points', label: labels.modePoints },
          ]}
        />
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{labels.line}</span>
        <Slider
          min={1}
          max={4}
          step={1}
          value={appearance.lineWidth}
          onChange={(v) => onAppearanceChange({ lineWidth: v })}
          className="w-12"
        />
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{labels.points}</span>
        <Slider
          min={0}
          max={8}
          step={1}
          value={appearance.pointRadius}
          onChange={(v) => onAppearanceChange({ pointRadius: v })}
          className="w-12"
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
    </SlotShell>
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
    <div className="absolute top-9 left-2 z-30 px-3 py-2.5 rounded-lg bg-background/95 border border-border/70 shadow-2xl backdrop-blur-md flex flex-col gap-2 min-w-[260px]">
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
        <Button variant="outline" size="xs" onClick={() => {
            onAppearanceChange({ yScaleMode: 'auto', yScaleManual: undefined });
            onClose();
          }}>
          {labels.reset}
        </Button>
        <Button variant="ghost" size="xs" onClick={onClose} className="ml-auto">
          ✕
        </Button>
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
      <span aria-hidden className={`inline-block w-2 h-2 rounded-full ${dotClass} shrink-0`} />
      <span className="text-[11px] text-foreground w-12 shrink-0">{label}</span>
      <input
        type="number"
        value={draftMin}
        onChange={(e) => setDraftMin(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder={labels.manualMin}
        className="w-16 bg-background border border-border rounded px-1.5 py-0.5 text-[11px] text-foreground tabular-nums font-mono"
      />
      <span className="text-muted-foreground">→</span>
      <input
        type="number"
        value={draftMax}
        onChange={(e) => setDraftMax(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder={labels.manualMax}
        className="w-16 bg-background border border-border rounded px-1.5 py-0.5 text-[11px] text-foreground tabular-nums font-mono"
      />
      <span className="text-muted-foreground text-[10px]">step</span>
      <input
        type="number"
        value={draftStep}
        onChange={(e) => setDraftStep(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder="auto"
        className="w-12 bg-background border border-border rounded px-1.5 py-0.5 text-[11px] text-foreground tabular-nums font-mono"
      />
    </div>
  );
};
