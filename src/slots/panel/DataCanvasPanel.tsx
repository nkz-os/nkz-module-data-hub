/**
 * DataCanvasPanel — orchestrator. Composes worker → presentation.
 *
 * Layered responsibilities:
 *   - useWorkerSeries: fetch and cache via the worker (V2.1 per-series payloads)
 *   - panelUtils: pure functions for axis distribution, Y ranges, units, colors
 *   - PanelHeader/Toolbar/SeriesRail/Chart/Tooltip/Footer: presentational
 *
 * The orchestrator stays thin: state for tooltip + railOpen, derived values
 * memo'd, callbacks pass-through.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '@nekazari/sdk';

import type {
  ChartAppearance,
  ChartSeriesDef,
  PredictionPayload,
} from '../../types/dashboard';
import { mergeChartAppearance } from '../../utils/chartAppearance';

import { PanelToolbar } from './PanelToolbar';
import { PanelSeriesRail } from './PanelSeriesRail';
import { PanelChart } from './PanelChart';
import { CorrelationChart } from './CorrelationChart';
import { PanelEmptyState } from './PanelEmptyState';
import { PanelErrorState } from './PanelErrorState';
import { PanelTooltip, type TooltipRow } from './PanelTooltip';
import {
  PanelFooter,
  computeFooterStats,
  aggregatePoints,
} from './PanelFooter';
import {
  buildTrendlineSeries,
  buildRollingAverageSeries,
  pearsonCorrelation,
} from './derivedSeries';
import { resolveThresholds } from './thresholds';
import { PanelOverlays } from './PanelOverlays';
import type uPlot from 'uplot';
import { useWorkerSeries } from './hooks/useWorkerSeries';
import { useViewportHistory, type Viewport } from './hooks/useViewportHistory';
import { usePanelTimeSync } from './hooks/usePanelTimeSync';
import { DATAHUB_EVENT_KEYBOARD_ACTION, DATAHUB_EVENT_TIME_HOVER } from '../../hooks/useUPlotCesiumSync';
import type { DataHubKeyboardActionDetail } from '../../hooks/useUPlotCesiumSync';
import {
  colorForIndex,
  computeYRange,
  distributeAxes,
  formatLocalTimestamp,
  nearestIndex,
  seriesKey,
  unitFor,
} from './panelUtils';

export interface DataCanvasPanelProps {
  panelId: string;
  series: ChartSeriesDef[];
  startTime: string;
  endTime: string;
  resolution: number;
  prediction?: PredictionPayload | null;
  chartAppearance?: Partial<ChartAppearance>;
  onAppearanceChange?: (panelId: string, next: ChartAppearance) => void;
  onSeriesAxisChange?: (panelId: string, seriesIndex: number, yAxis: 'left' | 'right') => void;
  /** Remove one series from the panel. When omitted the rail's remove button is hidden. */
  onSeriesRemove?: (panelId: string, seriesIndex: number) => void;
}

interface CursorState {
  visible: boolean;
  left: number;
  top: number;
  xEpoch: number;
  rows: TooltipRow[];
}

const EMPTY_CURSOR: CursorState = { visible: false, left: 0, top: 0, xEpoch: 0, rows: [] };

export const DataCanvasPanel: React.FC<DataCanvasPanelProps> = ({
  panelId,
  series,
  startTime,
  endTime,
  resolution,
  prediction,
  chartAppearance,
  onAppearanceChange,
  onSeriesAxisChange,
  onSeriesRemove,
}) => {
  const { t } = useTranslation('datahub');
  const appearance = useMemo(() => mergeChartAppearance(chartAppearance), [chartAppearance]);

  const [railOpen, setRailOpen] = useState(false);
  const [cursor, setCursor] = useState<CursorState>(EMPTY_CURSOR);
  /** Current visible X range from uPlot (epoch seconds). null = full data domain. */
  const [visibleX, setVisibleX] = useState<{ min: number; max: number } | null>(null);
  /** Imperative zoom command sent to PanelChart (nonce bumps to retrigger). */
  const [zoomCommand, setZoomCommand] = useState<{
    range: { min: number; max: number } | null;
    reset?: boolean;
    nonce: number;
  } | null>(null);
  const viewportHistory = useViewportHistory(null);
  const plotInstanceRef = React.useRef<uPlot | null>(null);
  const [lifecycleTick, setLifecycleTick] = useState(0);
  const bumpLifecycle = useCallback(() => setLifecycleTick((n) => n + 1), []);

  const { status, series: workerSeries, refetch, error, stats, stage } = useWorkerSeries({
    panelId,
    series,
    startTime,
    endTime,
    resolution,
  });

  // Resolve seriesConfig per series (visibility, colour override, axis override).
  const seriesCfg = appearance.seriesConfig ?? {};

  // Per-series visibility flag (default = visible). Hidden series stay in the
  // rail (with eye-off icon) but are filtered out of chart and Y-range pools.
  const visibilityMask = useMemo(
    () => series.map((s) => seriesCfg[seriesKey(s)]?.visible !== false),
    [series, seriesCfg]
  );

  // Resolve color per series (full list — rail needs all, even hidden).
  const colors = useMemo(
    () =>
      series.map((s, i) => {
        const cfg = seriesCfg[seriesKey(s)];
        return cfg?.colorOverride ?? colorForIndex(i);
      }),
    [series, seriesCfg]
  );

  // Auto-distribute axes by magnitude. Explicit user choice via series rail
  // takes precedence (ChartSeriesDef.yAxis = 'right' is honored).
  const effectiveScales = useMemo(
    () => distributeAxes(series, workerSeries),
    [series, workerSeries]
  );

  // Visible-only views passed to the chart. CRITICAL: all three arrays
  // (defs / payloads / colours / scales) must stay in 1-to-1 alignment, even
  // mid-fetch when a newly added series exists in `series` but its worker
  // payload has not landed yet. Filter all of them by the same index set —
  // the indices for which a worker payload exists AND visibility is on.
  const visibleIndices = useMemo(
    () => series.map((_, i) => i).filter((i) => visibilityMask[i]),
    [series, visibilityMask]
  );
  const renderableIndices = useMemo(
    () => visibleIndices.filter((i) => workerSeries[i] !== undefined),
    [visibleIndices, workerSeries]
  );
  const visibleSeriesDefs = useMemo(
    () => renderableIndices.map((i) => series[i]),
    [renderableIndices, series]
  );
  const baseVisibleWorkerSeries = useMemo(
    () => renderableIndices.map((i) => workerSeries[i]),
    [renderableIndices, workerSeries]
  );
  const baseVisibleColors = useMemo(
    () => renderableIndices.map((i) => colors[i]),
    [renderableIndices, colors]
  );
  const baseVisibleScales = useMemo(
    () => renderableIndices.map((i) => effectiveScales[i] ?? 'y'),
    [renderableIndices, effectiveScales]
  );

  // ──────── Phase 7: derived overlay series (trendline + rolling avg) ────────
  const trendlineSeries = useMemo(() => {
    if (!appearance.showTrendline || baseVisibleWorkerSeries.length === 0) return null;
    return buildTrendlineSeries(baseVisibleWorkerSeries[0]);
  }, [appearance.showTrendline, baseVisibleWorkerSeries]);

  const rollingSeries = useMemo(() => {
    const window = appearance.rollingAverage ?? 'off';
    if (window === 'off' || baseVisibleWorkerSeries.length === 0) return null;
    return buildRollingAverageSeries(baseVisibleWorkerSeries[0], window);
  }, [appearance.rollingAverage, baseVisibleWorkerSeries]);

  // Pearson r between first 2 visible series (shown in footer)
  const pearsonResult = useMemo(() => {
    if (baseVisibleWorkerSeries.length < 2 || appearance.viewMode !== 'timeseries') return null;
    return pearsonCorrelation(baseVisibleWorkerSeries[0], baseVisibleWorkerSeries[1]);
  }, [baseVisibleWorkerSeries, appearance.viewMode]);

  // Compose final visible series list: real series first, then overlays.
  const visibleWorkerSeries = useMemo(() => {
    const out = [...baseVisibleWorkerSeries];
    if (rollingSeries) out.push(rollingSeries);
    if (trendlineSeries) out.push(trendlineSeries);
    return out;
  }, [baseVisibleWorkerSeries, rollingSeries, trendlineSeries]);

  // Synthetic series colours: rolling = primary 60% alpha; trend = primary 80%.
  const visibleColors = useMemo(() => {
    const out = [...baseVisibleColors];
    const primary = baseVisibleColors[0] ?? '#34d399';
    if (rollingSeries) out.push(`${primary}99`);
    if (trendlineSeries) out.push(`${primary}cc`);
    return out;
  }, [baseVisibleColors, rollingSeries, trendlineSeries]);

  const visibleSeriesDefsAugmented = useMemo(() => {
    const out = [...visibleSeriesDefs];
    if (rollingSeries) {
      out.push({
        entityId: rollingSeries.entityId,
        attribute: rollingSeries.attribute,
        source: rollingSeries.source,
        yAxis: visibleSeriesDefs[0]?.yAxis,
      });
    }
    if (trendlineSeries) {
      out.push({
        entityId: trendlineSeries.entityId,
        attribute: trendlineSeries.attribute,
        source: trendlineSeries.source,
        yAxis: visibleSeriesDefs[0]?.yAxis,
      });
    }
    return out;
  }, [visibleSeriesDefs, rollingSeries, trendlineSeries]);

  const visibleScales = useMemo(() => {
    const out = [...baseVisibleScales];
    const primaryScale = baseVisibleScales[0] ?? 'y';
    if (rollingSeries) out.push(primaryScale);
    if (trendlineSeries) out.push(primaryScale);
    return out;
  }, [baseVisibleScales, rollingSeries, trendlineSeries]);

  // Per-axis value pool for Y range computation — VISIBLE series only.
  const { leftValues, rightValues, leftUnit, rightUnit, hasRightAxis } = useMemo(() => {
    const lvs: number[] = [];
    const rvs: number[] = [];
    const lUnits = new Set<string>();
    const rUnits = new Set<string>();
    visibleWorkerSeries.forEach((s, idx) => {
      const target = visibleScales[idx] === 'y2' ? rvs : lvs;
      for (let j = 0; j < s.ys.length; j++) {
        const v = s.ys[j];
        if (Number.isFinite(v)) target.push(v);
      }
      const u = unitFor(s.attribute);
      if (u) (visibleScales[idx] === 'y2' ? rUnits : lUnits).add(u);
    });
    return {
      leftValues: lvs,
      rightValues: rvs,
      leftUnit: Array.from(lUnits).join(' / '),
      rightUnit: Array.from(rUnits).join(' / '),
      hasRightAxis: visibleScales.includes('y2'),
    };
  }, [visibleWorkerSeries, visibleScales]);

  // Build per-axis visibleX context for fit-visible mode.
  const fitVisibleContext = useMemo(() => {
    if (appearance.yScaleMode !== 'fit-visible' || !visibleX) return undefined;
    const buildAxis = (axis: 'y' | 'y2') => {
      const perSeriesX: Float64Array[] = [];
      const perSeriesY: Float64Array[] = [];
      visibleWorkerSeries.forEach((s, i) => {
        if (visibleScales[i] !== axis) return;
        perSeriesX.push(s.xs);
        perSeriesY.push(s.ys);
      });
      return { perSeriesX, perSeriesY, xMin: visibleX.min, xMax: visibleX.max };
    };
    return { left: buildAxis('y'), right: buildAxis('y2') };
  }, [appearance.yScaleMode, visibleX, visibleWorkerSeries, visibleScales]);

  const leftResult = useMemo(
    () =>
      computeYRange(
        leftValues,
        appearance.yScaleMode,
        appearance.yScaleManual?.left,
        fitVisibleContext?.left
      ),
    [leftValues, appearance.yScaleMode, appearance.yScaleManual, fitVisibleContext]
  );
  const rightResult = useMemo(
    () =>
      computeYRange(
        rightValues,
        appearance.yScaleMode,
        appearance.yScaleManual?.right,
        fitVisibleContext?.right
      ),
    [rightValues, appearance.yScaleMode, appearance.yScaleManual, fitVisibleContext]
  );

  const leftRange = leftResult.range;
  const rightRange = rightResult.range;

  // A3 Guardrail: auto-expand collapsed Y range so valid points are always visible
  const guardrailFiredRef = React.useRef(false);
  const safeLeftRange = useMemo<[number, number] | null>(() => {
    if (!leftRange || leftResult.poolSize === 0) return leftRange;
    const span = leftRange[1] - leftRange[0];
    const mid = (leftRange[0] + leftRange[1]) / 2;
    const mag = Math.max(Math.abs(mid), 1);
    if (span < mag * 0.001) {
      guardrailFiredRef.current = true;
      const pad = Math.max(mag * 0.05, 0.5);
      return [mid - pad, mid + pad];
    }
    return leftRange;
  }, [leftRange, leftResult.poolSize]);
  const safeRightRange = useMemo<[number, number] | null>(() => {
    if (!rightRange || rightResult.poolSize === 0) return rightRange;
    const span = rightRange[1] - rightRange[0];
    const mid = (rightRange[0] + rightRange[1]) / 2;
    const mag = Math.max(Math.abs(mid), 1);
    if (span < mag * 0.001) {
      guardrailFiredRef.current = true;
      const pad = Math.max(mag * 0.05, 0.5);
      return [mid - pad, mid + pad];
    }
    return rightRange;
  }, [rightRange, rightResult.poolSize]);
  const outlierCount = useMemo(() => {
    if (appearance.yScaleMode !== 'focus') return 0;
    return leftResult.outliersExcluded + rightResult.outliersExcluded;
  }, [appearance.yScaleMode, leftResult.outliersExcluded, rightResult.outliersExcluded]);

  // Footer primary stats: first visible series.
  const primaryFooter = useMemo(
    () => (visibleWorkerSeries.length > 0 ? computeFooterStats(visibleWorkerSeries[0]) : null),
    [visibleWorkerSeries]
  );

  // Track mouse position via capture phase — fires BEFORE uPlot's bubble listener
  const rootRef = React.useRef<HTMLDivElement>(null);
  const mousePosRef = React.useRef<{ left: number; top: number }>({ left: 0, top: 0 });
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) mousePosRef.current = { left: e.clientX - r.left, top: e.clientY - r.top };
    };
    window.addEventListener('mousemove', onMove, true); // capture phase
    (window as any).__nkz_mousePosRef = mousePosRef;
    return () => window.removeEventListener('mousemove', onMove, true);
  }, []);

  // Cursor → tooltip rows using real mouse coords + plotRef for data lookup
  const handleCursor = useCallback(
    (info: { left: number; top: number; xEpoch: number } | null) => {
      if (!info) {
        setCursor((prev) => (prev.visible ? EMPTY_CURSOR : prev));
        return;
      }
      const mp = mousePosRef.current;
      const plot = plotInstanceRef.current;
      if (!plot || mp.left === 0) {
        setCursor((prev) => (prev.visible ? EMPTY_CURSOR : prev));
        return;
      }
      // Convert real mouse X to data value. posToVal expects bbox-relative coords.
      const bbox = plot.bbox;
      const xEpoch = plot.posToVal(mp.left - (bbox?.left ?? 0), 'x');
      if (!Number.isFinite(xEpoch)) {
        setCursor((prev) => (prev.visible ? EMPTY_CURSOR : prev));
        return;
      }
      const rows: TooltipRow[] = [];
      let nearestEpoch = xEpoch;
      visibleWorkerSeries.forEach((s, idx) => {
        const i = nearestIndex(s.xs, xEpoch);
        if (i < 0) return;
        const y = s.ys[i];
        if (!Number.isFinite(y)) return;
        rows.push({
          label: s.attribute,
          unit: unitFor(s.attribute),
          color: visibleColors[idx] ?? '#34d399',
          value: y,
        });
        nearestEpoch = s.xs[i];
      });
      if (rows.length === 0) {
        setCursor((prev) => (prev.visible ? EMPTY_CURSOR : prev));
        return;
      }
      setCursor({ visible: true, left: mp.left, top: mp.top, xEpoch: nearestEpoch, rows });
    },
    [visibleWorkerSeries, visibleColors, plotInstanceRef]
  );

  const patchAppearance = useCallback(
    (partial: Partial<ChartAppearance>) => {
      if (!onAppearanceChange) return;
      onAppearanceChange(panelId, { ...appearance, ...partial });
    },
    [onAppearanceChange, panelId, appearance]
  );

  const handleAxisChange = useCallback(
    (idx: number, axis: 'left' | 'right') => {
      onSeriesAxisChange?.(panelId, idx, axis);
    },
    [onSeriesAxisChange, panelId]
  );

  const updateSeriesConfig = useCallback(
    (key: string, patch: Partial<NonNullable<ChartAppearance['seriesConfig']>[string]>) => {
      const nextConfig: ChartAppearance['seriesConfig'] = {
        ...(appearance.seriesConfig ?? {}),
        [key]: { ...(appearance.seriesConfig?.[key] ?? {}), ...patch },
      };
      patchAppearance({ seriesConfig: nextConfig });
    },
    [appearance.seriesConfig, patchAppearance]
  );

  const handleVisibilityChange = useCallback(
    (idx: number, visible: boolean) => {
      const s = series[idx];
      if (!s) return;
      updateSeriesConfig(seriesKey(s), { visible });
    },
    [series, updateSeriesConfig]
  );

  const handleColorChange = useCallback(
    (idx: number, colorHex: string) => {
      const s = series[idx];
      if (!s) return;
      updateSeriesConfig(seriesKey(s), { colorOverride: colorHex });
    },
    [series, updateSeriesConfig]
  );

  const handleRemove = useCallback(
    (idx: number) => {
      onSeriesRemove?.(panelId, idx);
    },
    [onSeriesRemove, panelId]
  );

  // ──────── D1: Viewport history (zoom + undo + reset) ────────
  const handleVisibleXChange = useCallback(
    (range: { min: number; max: number }) => {
      setVisibleX(range);
      const last = viewportHistory.current;
      if (!last || Math.abs(last.min - range.min) > 0.5 || Math.abs(last.max - range.max) > 0.5) {
        viewportHistory.push(range as Viewport);
      }
    },
    [viewportHistory]
  );

  const handleZoomUndo = useCallback(() => {
    const prev = viewportHistory.pop();
    if (!prev) return;
    setZoomCommand({ range: prev, nonce: Date.now() });
  }, [viewportHistory]);

  const handleZoomReset = useCallback(() => {
    viewportHistory.reset();
    setZoomCommand({ range: null, reset: true, nonce: Date.now() });
  }, [viewportHistory]);

  // Right-click anywhere on the chart area undoes the last zoom (Grafana-style).
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!viewportHistory.hasHistory) return;
      e.preventDefault();
      handleZoomUndo();
    },
    [viewportHistory.hasHistory, handleZoomUndo]
  );

  // ──────── D2: Cross-panel sync (hover + brush) ────────
  // Listen for hover events from other panels to draw an external crosshair.
  // (Implementation note: uPlot does not expose a setCursor-from-X method
  //  out-of-the-box; this is a placeholder for Phase 9 once we expose the
  //  plotRef from PanelChart. Brush emission is wired below.)
  usePanelTimeSync({
    onExternalRange: (range) => {
      setZoomCommand({ range, nonce: Date.now() });
    },
  });

  // Emit hover events to peer panels (cheap, no feedback loop possible — the
  // dashboard does not consume DATAHUB_EVENT_TIME_HOVER).
  React.useEffect(() => {
    if (!cursor.visible) return;
    window.dispatchEvent(
      new CustomEvent(DATAHUB_EVENT_TIME_HOVER, {
        detail: { timestamp: cursor.xEpoch * 1000 },
      })
    );
  }, [cursor.visible, cursor.xEpoch]);

  // Keyboard shortcuts — listen for actions targeting this panel
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as DataHubKeyboardActionDetail | undefined;
      if (!detail || detail.panelId !== panelId) return;
      switch (detail.action) {
        case 'undoZoom': handleZoomUndo(); break;
        case 'resetZoom': handleZoomReset(); break;
        case 'toggleSeriesRail': setRailOpen((v) => !v); break;
        case 'toggleTrendline':
          patchAppearance({ showTrendline: !appearance.showTrendline });
          break;
        case 'toggleRollingAvg':
          patchAppearance({
            rollingAverage: (appearance.rollingAverage ?? 'off') === 'off' ? '24h' : 'off',
          });
          break;
      }
    };
    window.addEventListener(DATAHUB_EVENT_KEYBOARD_ACTION, handler);
    return () => window.removeEventListener(DATAHUB_EVENT_KEYBOARD_ACTION, handler);
  }, [panelId, handleZoomUndo, handleZoomReset, patchAppearance, appearance.showTrendline, appearance.rollingAverage]);

  // NOTE: do NOT auto-emit DATAHUB_EVENT_TIME_SELECT on every visibleX change.
  // DataHubDashboard listens to that event to update its global timeContext,
  // which would re-trigger the panel's data fetch, which fires setScale on
  // init, which updates visibleX again — infinite loop. Brush-to-Cesium sync
  // is now a deliberate user action wired through PanelChart's setSelect hook
  // (shift+drag), not a side-effect of every uPlot setScale.

  const headerTitle = series.length === 1
    ? series[0].attribute
    : t('canvasPanel.multiSeries', { count: series.length });

  const containerWidthRef = React.useRef<HTMLDivElement>(null);
  const containerWidth = containerWidthRef.current?.clientWidth ?? 800;
  const containerHeight = containerWidthRef.current?.clientHeight ?? 400;

  // Force resize handle visibility — module CSS may not reach RGL elements
  React.useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .react-resizable-handle {
        position: absolute !important;
        bottom: 0 !important;
        right: 0 !important;
        width: 28px !important;
        height: 28px !important;
        cursor: se-resize !important;
        z-index: 100 !important;
        background: none !important;
        display: block !important;
      }
      .react-resizable-handle::after {
        content: '';
        position: absolute;
        bottom: 6px;
        right: 6px;
        width: 12px;
        height: 12px;
        border-right: 2px solid rgba(148,163,184,0.5);
        border-bottom: 2px solid rgba(148,163,184,0.5);
      }
      .react-resizable-handle:hover::after {
        border-color: rgba(203,213,225,0.9);
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const [toolbarOpen, setToolbarOpen] = React.useState(false);

  return (
    <div ref={rootRef} className="relative w-full h-full rounded-md ring-1 ring-slate-700/30" onContextMenu={handleContextMenu}>
      {/* ===== Chart layer — first in DOM ===== */}
      {status === 'ready' && visibleWorkerSeries.length > 0 && appearance.viewMode !== 'correlation' && (
        <PanelChart
          series={visibleSeriesDefsAugmented}
          workerSeries={visibleWorkerSeries}
          appearance={appearance}
          effectiveScales={visibleScales}
          colors={visibleColors}
          leftRange={safeLeftRange}
          rightRange={safeRightRange}
          hasRightAxis={hasRightAxis}
          leftUnit={leftUnit}
          rightUnit={rightUnit}
          onCursor={handleCursor}
          onVisibleXChange={handleVisibleXChange}
          zoomCommand={zoomCommand ?? undefined}
          plotInstanceRef={plotInstanceRef}
          onLifecycleTick={bumpLifecycle}
        />
      )}
      {status === 'ready' && appearance.viewMode === 'correlation' && baseVisibleWorkerSeries.length >= 2 && (() => {
        const xIdx = Math.min(Math.max(0, appearance.correlationXSeries), baseVisibleWorkerSeries.length - 1);
        const yIdx = Math.min(Math.max(0, appearance.correlationYSeries), baseVisibleWorkerSeries.length - 1);
        const xS = baseVisibleWorkerSeries[xIdx];
        const yS = baseVisibleWorkerSeries[yIdx];
        return (
          <CorrelationChart
            xSeries={xS}
            ySeries={yS}
            xLabel={xS?.attribute ?? ''}
            yLabel={yS?.attribute ?? ''}
            xUnit={xS ? unitFor(xS.attribute) : ''}
            yUnit={yS ? unitFor(yS.attribute) : ''}
            pointColor={baseVisibleColors[yIdx] ?? '#34d399'}
          />
        );
      })()}
      {status === 'ready' && visibleWorkerSeries.length > 0 && appearance.viewMode !== 'correlation' && (
        <PanelOverlays
          plotRef={plotInstanceRef}
          resizeNonce={lifecycleTick}
          thresholds={resolveThresholds(
            visibleSeriesDefs,
            baseVisibleScales,
            appearance.thresholds ?? []
          )}
          annotations={[]}
          prediction={prediction ?? null}
          predictionColor={baseVisibleColors[0] ?? '#34d399'}
          xDomain={visibleX}
        />
      )}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="px-3 py-1.5 rounded-full bg-slate-800/70 border border-slate-600/40 text-slate-200 text-xs">
            {t('canvasPanel.loading')}
          </span>
        </div>
      )}
      {status === 'empty' && <PanelEmptyState message={t('canvasPanel.noData')} />}
      {status === 'error' && (
        <PanelErrorState
          message={t('canvasPanel.errorLoad')}
          detail={error?.message}
          onRetry={refetch}
          retryLabel={t('canvasPanel.retry', { defaultValue: 'Reintentar' })}
        />
      )}

      {/* ===== UI Overlays — after chart in DOM, paint on top ===== */}
      {/* Header bar */}
      <div className="absolute top-0 left-0 right-0 px-2 py-1.5">
        <div className="flex items-center gap-2">
          {/* Title + drag handle */}
          <div className="panel-drag-handle cursor-move bg-slate-950/90 backdrop-blur-sm rounded-md pl-3 pr-3 py-1.5 border border-slate-600/40 shadow-lg select-none">
            <span className="text-xs text-slate-200 font-mono font-medium truncate max-w-[280px] tracking-tight">
              {headerTitle}
            </span>
          </div>
          {/* Single "More" button — all tools inside */}
          {status === 'ready' && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setToolbarOpen(v => !v); }}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-2 shadow-lg border ${
                toolbarOpen
                  ? 'text-white bg-slate-700 border-slate-500'
                  : 'text-slate-300 bg-slate-950/90 border-slate-600/40 hover:text-white hover:bg-slate-800 hover:border-slate-500'
              }`}
              title="Chart tools"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
              <span className="text-[11px] text-slate-400">Tools</span>
            </button>
          )}
        </div>
        {toolbarOpen && status === 'ready' && (
          <div className="pointer-events-auto px-2 pb-1"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="bg-slate-950/95 backdrop-blur-sm rounded-md border border-slate-700/40 shadow-2xl max-h-[80vh] overflow-y-auto">
              <PanelToolbar
                appearance={appearance}
                onAppearanceChange={patchAppearance}
                seriesRailOpen={railOpen}
                onToggleSeriesRail={() => setRailOpen((v) => !v)}
                hasRightAxis={hasRightAxis}
                canUndoZoom={viewportHistory.hasHistory}
                canResetZoom={viewportHistory.hasHistory}
                onZoomUndo={handleZoomUndo}
                onZoomReset={handleZoomReset}
                seriesLabels={baseVisibleWorkerSeries.map((s) => s.attribute)}
                labels={{
                  style: t('canvasPanel.chartStyle'), line: t('canvasPanel.lineWidth'),
                  points: t('canvasPanel.pointSize'), modeLine: t('canvasPanel.modeLine'),
                  modePoints: t('canvasPanel.modePoints'), seriesRail: t('canvasPanel.axisPerSeriesHint'),
                  yScale: t('canvasPanel.yScale', { defaultValue: 'Escala Y' }),
                  yAuto: t('canvasPanel.yAuto', { defaultValue: 'Auto' }),
                  yFitVisible: t('canvasPanel.yFitVisible', { defaultValue: 'Visible' }),
                  yFocus: t('canvasPanel.yFocus', { defaultValue: 'Focus' }),
                  yManual: t('canvasPanel.yManual', { defaultValue: 'Manual' }),
                  manualLeft: t('canvasPanel.axisLeft'), manualRight: t('canvasPanel.axisRight'),
                  manualMin: t('canvasPanel.statMin'), manualMax: t('canvasPanel.statMax'),
                  apply: t('canvasPanel.apply', { defaultValue: 'Aplicar' }),
                  reset: t('canvasPanel.reset', { defaultValue: 'Restablecer' }),
                  zoomUndo: t('canvasPanel.zoomUndo', { defaultValue: 'Deshacer zoom' }),
                  zoomReset: t('canvasPanel.zoomReset', { defaultValue: 'Restablecer zoom' }),
                  trendline: t('canvasPanel.trendline'),
                  showOutliers: t('canvasPanel.showOutliers'),
                  rollingAvg: t('canvasPanel.rollingAvg', { defaultValue: 'Media móvil' }),
                  rollingOff: t('canvasPanel.rollingOff', { defaultValue: 'Off' }),
                  viewMode: t('canvasPanel.viewMode'),
                  viewTimeseries: t('canvasPanel.viewModeTimeseries'),
                  viewCorrelation: t('canvasPanel.viewModeCorrelation'),
                }}
              />
              {railOpen && (
                <div className="border-t border-slate-700/50 p-2 bg-slate-900/95">
                  <PanelSeriesRail
                    series={series} workerSeries={workerSeries}
                    colorFor={(_, i) => colors[i] ?? '#34d399'}
                    unitFor={unitFor} seriesKey={seriesKey} config={seriesCfg}
                    onAxisChange={handleAxisChange} onVisibilityChange={handleVisibilityChange}
                    onColorChange={handleColorChange} onRemove={handleRemove}
                    labels={{
                      axisLeft: t('canvasPanel.axisLeft'), axisRight: t('canvasPanel.axisRight'),
                      show: t('canvasPanel.show', { defaultValue: 'Mostrar' }),
                      hide: t('canvasPanel.hide', { defaultValue: 'Ocultar' }),
                      remove: t('canvasPanel.removeSeries', { defaultValue: 'Quitar serie' }),
                      statMin: t('canvasPanel.statMin'), statMax: t('canvasPanel.statMax'),
                      statAvg: t('canvasPanel.statAvg'), statLast: t('canvasPanel.statLast'),
                      emptyHint: t('canvasPanel.dragHere'),
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {status === 'ready' && stats && (
        <div className="absolute bottom-0 left-0 right-0">
          <PanelFooter
            workerSeries={visibleWorkerSeries}
            colorFor={(_, i) => visibleColors[i] ?? '#34d399'}
            unitFor={unitFor}
            primaryStats={primaryFooter}
            pearsonR={pearsonResult?.r ?? null}
            pearsonN={pearsonResult?.n ?? null}
            outlierCount={outlierCount}
            guardrailFired={guardrailFiredRef.current}
            telemetry={{
              plotted: aggregatePoints(visibleWorkerSeries).plotted,
              received: aggregatePoints(workerSeries).received,
              viewportWidth: containerWidth, viewportHeight: containerHeight,
              scaleMode: appearance.yScaleMode, stage,
            }}
            labels={{
              min: t('canvasPanel.statMin'), max: t('canvasPanel.statMax'),
              mean: t('canvasPanel.statAvg'), last: t('canvasPanel.statLast'),
            }}
          />
        </div>
      )}

      {/* Tooltip */}
      <PanelTooltip
        visible={cursor.visible} left={cursor.left} top={cursor.top}
        containerWidth={containerWidth}
        timestamp={formatLocalTimestamp(cursor.xEpoch)} rows={cursor.rows}
      />
    </div>
  );

};

export const DataCanvasPanelMemo = React.memo(DataCanvasPanel);
