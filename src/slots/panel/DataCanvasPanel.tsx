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

import { PanelHeader } from './PanelHeader';
import { PanelToolbar } from './PanelToolbar';
import { PanelSeriesRail } from './PanelSeriesRail';
import { PanelChart } from './PanelChart';
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
import { DATAHUB_EVENT_TIME_HOVER } from '../../hooks/useUPlotCesiumSync';
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

  // ──────── Phase 7: correlation mode (Pearson r) ────────
  const correlation = useMemo(() => {
    if (appearance.viewMode !== 'correlation' || baseVisibleWorkerSeries.length < 2) {
      return null;
    }
    const xIdx = Math.min(
      Math.max(0, appearance.correlationXSeries),
      baseVisibleWorkerSeries.length - 1
    );
    const yIdx = Math.min(
      Math.max(0, appearance.correlationYSeries),
      baseVisibleWorkerSeries.length - 1
    );
    if (xIdx === yIdx) return null;
    return pearsonCorrelation(
      baseVisibleWorkerSeries[xIdx],
      baseVisibleWorkerSeries[yIdx]
    );
  }, [
    appearance.viewMode,
    appearance.correlationXSeries,
    appearance.correlationYSeries,
    baseVisibleWorkerSeries,
  ]);

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
  const totalOutliersExcluded = leftResult.outliersExcluded + rightResult.outliersExcluded;
  const totalPool = leftResult.poolSize + rightResult.poolSize;
  const showOutlierBadge =
    appearance.yScaleMode === 'focus' &&
    totalPool > 0 &&
    totalOutliersExcluded / totalPool >= 0.01;

  // Footer primary stats: first visible series.
  const primaryFooter = useMemo(
    () => (visibleWorkerSeries.length > 0 ? computeFooterStats(visibleWorkerSeries[0]) : null),
    [visibleWorkerSeries]
  );

  // Cursor → tooltip rows (nearest sample per series at the cursor's xEpoch).
  const handleCursor = useCallback(
    (info: { left: number; top: number; xEpoch: number } | null) => {
      if (!info) {
        setCursor((prev) => (prev.visible ? EMPTY_CURSOR : prev));
        return;
      }
      const rows: TooltipRow[] = [];
      let nearestEpoch = info.xEpoch;
      visibleWorkerSeries.forEach((s, idx) => {
        const i = nearestIndex(s.xs, info.xEpoch);
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
      setCursor({ visible: true, left: info.left, top: info.top, xEpoch: nearestEpoch, rows });
    },
    [visibleWorkerSeries, visibleColors]
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

  // NOTE: do NOT auto-emit DATAHUB_EVENT_TIME_SELECT on every visibleX change.
  // DataHubDashboard listens to that event to update its global timeContext,
  // which would re-trigger the panel's data fetch, which fires setScale on
  // init, which updates visibleX again — infinite loop. Brush-to-Cesium sync
  // is now a deliberate user action wired through PanelChart's setSelect hook
  // (shift+drag), not a side-effect of every uPlot setScale.

  // Header subtitle: primary axis units summary.
  const headerSubtitle = useMemo(() => {
    if (!leftUnit && !rightUnit) return undefined;
    if (rightUnit && leftUnit) return `${leftUnit}  ·  ${rightUnit}`;
    return leftUnit || rightUnit;
  }, [leftUnit, rightUnit]);

  const headerTitle = series.length === 1
    ? series[0].attribute
    : t('canvasPanel.multiSeries', { count: series.length });

  const containerWidthRef = React.useRef<HTMLDivElement>(null);
  const containerWidth = containerWidthRef.current?.clientWidth ?? 800;
  const containerHeight = containerWidthRef.current?.clientHeight ?? 400;

  return (
    <div className="relative w-full h-full bg-gradient-to-br from-slate-900/60 via-slate-900/40 to-slate-950/60 rounded-md ring-1 ring-slate-800/60 flex flex-col min-h-0">
      <PanelHeader
        title={headerTitle}
        subtitle={headerSubtitle}
        status={status}
        dragHandleClass=""
      />

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
        labels={{
          style: t('canvasPanel.chartStyle'),
          line: t('canvasPanel.lineWidth'),
          points: t('canvasPanel.pointSize'),
          modeLine: t('canvasPanel.modeLine'),
          modePoints: t('canvasPanel.modePoints'),
          seriesRail: t('canvasPanel.axisPerSeriesHint'),
          yScale: t('canvasPanel.yScale', { defaultValue: 'Escala Y' }),
          yAuto: t('canvasPanel.yAuto', { defaultValue: 'Auto' }),
          yFitVisible: t('canvasPanel.yFitVisible', { defaultValue: 'Visible' }),
          yFocus: t('canvasPanel.yFocus', { defaultValue: 'Focus' }),
          yManual: t('canvasPanel.yManual', { defaultValue: 'Manual' }),
          manualLeft: t('canvasPanel.axisLeft'),
          manualRight: t('canvasPanel.axisRight'),
          manualMin: t('canvasPanel.statMin'),
          manualMax: t('canvasPanel.statMax'),
          apply: t('canvasPanel.apply', { defaultValue: 'Aplicar' }),
          reset: t('canvasPanel.reset', { defaultValue: 'Restablecer' }),
          zoomUndo: t('canvasPanel.zoomUndo', { defaultValue: 'Deshacer zoom' }),
          zoomReset: t('canvasPanel.zoomReset', { defaultValue: 'Restablecer zoom' }),
          trendline: t('canvasPanel.trendline'),
          rollingAvg: t('canvasPanel.rollingAvg', { defaultValue: 'Media móvil' }),
          rollingOff: t('canvasPanel.rollingOff', { defaultValue: 'Off' }),
          viewMode: t('canvasPanel.viewMode'),
          viewTimeseries: t('canvasPanel.viewModeTimeseries'),
          viewCorrelation: t('canvasPanel.viewModeCorrelation'),
        }}
      />

      <div className="flex-1 flex min-h-0 relative">
        {railOpen && (
          <PanelSeriesRail
            series={series}
            workerSeries={workerSeries}
            colorFor={(_, i) => colors[i] ?? '#34d399'}
            unitFor={unitFor}
            seriesKey={seriesKey}
            config={seriesCfg}
            onAxisChange={handleAxisChange}
            onVisibilityChange={handleVisibilityChange}
            onColorChange={handleColorChange}
            onRemove={handleRemove}
            labels={{
              axisLeft: t('canvasPanel.axisLeft'),
              axisRight: t('canvasPanel.axisRight'),
              show: t('canvasPanel.show', { defaultValue: 'Mostrar' }),
              hide: t('canvasPanel.hide', { defaultValue: 'Ocultar' }),
              remove: t('canvasPanel.removeSeries', { defaultValue: 'Quitar serie' }),
              statMin: t('canvasPanel.statMin'),
              statMax: t('canvasPanel.statMax'),
              statAvg: t('canvasPanel.statAvg'),
              statLast: t('canvasPanel.statLast'),
              emptyHint: t('canvasPanel.dragHere'),
            }}
          />
        )}
        <div
          ref={containerWidthRef}
          className="relative flex-1 min-w-0"
          onContextMenu={handleContextMenu}
        >
          {status === 'ready' && visibleWorkerSeries.length > 0 && (
            <PanelChart
              series={visibleSeriesDefsAugmented}
              workerSeries={visibleWorkerSeries}
              appearance={appearance}
              effectiveScales={visibleScales}
              colors={visibleColors}
              leftRange={leftRange}
              rightRange={rightRange}
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
          {status === 'ready' && visibleWorkerSeries.length > 0 && (
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
          {appearance.viewMode === 'correlation' && correlation && (
            <div className="absolute top-2 left-2 z-20 px-2 py-1 text-[10px] rounded-md bg-purple-500/15 border border-purple-500/40 text-purple-200 flex items-center gap-1.5 shadow-lg pointer-events-none font-mono tabular-nums">
              <span className="font-semibold">r =</span>
              <span>{Number.isFinite(correlation.r) ? correlation.r.toFixed(4) : '—'}</span>
              <span className="text-purple-300/70">·</span>
              <span>n =</span>
              <span>{correlation.n}</span>
            </div>
          )}
          {appearance.viewMode === 'correlation' && !correlation && status === 'ready' && (
            <div className="absolute top-2 left-2 z-20 px-2 py-1 text-[10px] rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-200 flex items-center gap-1.5 shadow-lg pointer-events-none">
              {t('canvasPanel.correlationNeed2', { defaultValue: 'Correlación necesita 2 series' })}
            </div>
          )}
          {showOutlierBadge && (
            <button
              type="button"
              onClick={() => patchAppearance({ yScaleMode: 'auto' })}
              className="absolute top-2 right-2 z-20 px-2 py-1 text-[10px] rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25 transition-colors flex items-center gap-1.5 shadow-lg"
              title={t('canvasPanel.outliersHiddenTitle')}
            >
              <span className="font-semibold">{totalOutliersExcluded}</span>
              <span>{t('canvasPanel.outliersOutOfScale', { defaultValue: 'fuera de escala' })}</span>
              <span className="text-amber-300/70">·</span>
              <span className="text-amber-300 underline-offset-2 hover:underline">
                {t('canvasPanel.showAll', { defaultValue: 'Mostrar todos' })}
              </span>
            </button>
          )}
          {status === 'ready' && visibleWorkerSeries.length === 0 && workerSeries.length > 0 && (
            <PanelEmptyState message={t('canvasPanel.allHidden', { defaultValue: 'Todas las series ocultas' })} />
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
          <PanelTooltip
            visible={cursor.visible}
            left={cursor.left}
            top={cursor.top}
            containerWidth={containerWidth}
            timestamp={formatLocalTimestamp(cursor.xEpoch)}
            rows={cursor.rows}
          />
        </div>
      </div>

      {status === 'ready' && stats && (
        <PanelFooter
          workerSeries={visibleWorkerSeries}
          colorFor={(_, i) => visibleColors[i] ?? '#34d399'}
          unitFor={unitFor}
          primaryStats={primaryFooter}
          telemetry={{
            plotted: aggregatePoints(visibleWorkerSeries).plotted,
            received: aggregatePoints(workerSeries).received,
            viewportWidth: containerWidth,
            viewportHeight: containerHeight,
            scaleMode: appearance.yScaleMode,
            stage,
          }}
          labels={{
            min: t('canvasPanel.statMin'),
            max: t('canvasPanel.statMax'),
            mean: t('canvasPanel.statAvg'),
            last: t('canvasPanel.statLast'),
          }}
        />
      )}
    </div>
  );
};

export const DataCanvasPanelMemo = React.memo(DataCanvasPanel);
