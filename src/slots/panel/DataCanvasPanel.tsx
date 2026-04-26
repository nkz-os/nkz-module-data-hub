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
import { useWorkerSeries } from './hooks/useWorkerSeries';
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

  // Visible-only views passed to the chart.
  const visibleIndices = useMemo(
    () => series.map((_, i) => i).filter((i) => visibilityMask[i]),
    [series, visibilityMask]
  );
  const visibleSeriesDefs = useMemo(
    () => visibleIndices.map((i) => series[i]),
    [visibleIndices, series]
  );
  const visibleWorkerSeries = useMemo(
    () => visibleIndices.map((i) => workerSeries[i]).filter(Boolean),
    [visibleIndices, workerSeries]
  );
  const visibleColors = useMemo(
    () => visibleIndices.map((i) => colors[i]),
    [visibleIndices, colors]
  );
  const visibleScales = useMemo(
    () => visibleIndices.map((i) => effectiveScales[i] ?? 'y'),
    [visibleIndices, effectiveScales]
  );

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
    <div className="relative w-full h-full bg-gradient-to-br from-slate-900/60 via-slate-900/40 to-slate-950/60 rounded-md ring-1 ring-slate-800/60 overflow-hidden flex flex-col min-h-0">
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
        <div ref={containerWidthRef} className="relative flex-1 min-w-0">
          {status === 'ready' && visibleWorkerSeries.length > 0 && (
            <PanelChart
              series={visibleSeriesDefs}
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
              onVisibleXChange={setVisibleX}
            />
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
