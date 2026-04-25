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
}) => {
  const { t } = useTranslation('datahub');
  const appearance = useMemo(() => mergeChartAppearance(chartAppearance), [chartAppearance]);

  const [railOpen, setRailOpen] = useState(false);
  const [cursor, setCursor] = useState<CursorState>(EMPTY_CURSOR);

  const { status, series: workerSeries, refetch, error, stats, stage } = useWorkerSeries({
    panelId,
    series,
    startTime,
    endTime,
    resolution,
  });

  // Resolve color per series, honoring chartAppearance.seriesConfig override.
  const colors = useMemo(
    () =>
      series.map((s, i) => {
        const cfg = appearance.seriesConfig?.[seriesKey(s)];
        return cfg?.colorOverride ?? colorForIndex(i);
      }),
    [series, appearance.seriesConfig]
  );

  // Auto-distribute axes by magnitude. Explicit user choice via series rail
  // takes precedence (ChartSeriesDef.yAxis = 'right' is honored).
  const effectiveScales = useMemo(
    () => distributeAxes(series, workerSeries),
    [series, workerSeries]
  );

  // Per-axis value pool for Y range computation.
  const { leftValues, rightValues, leftUnit, rightUnit, hasRightAxis } = useMemo(() => {
    const lvs: number[] = [];
    const rvs: number[] = [];
    const lUnits = new Set<string>();
    const rUnits = new Set<string>();
    workerSeries.forEach((s, i) => {
      const target = effectiveScales[i] === 'y2' ? rvs : lvs;
      for (let j = 0; j < s.ys.length; j++) {
        const v = s.ys[j];
        if (Number.isFinite(v)) target.push(v);
      }
      const u = unitFor(s.attribute);
      if (u) (effectiveScales[i] === 'y2' ? rUnits : lUnits).add(u);
    });
    return {
      leftValues: lvs,
      rightValues: rvs,
      leftUnit: Array.from(lUnits).join(' / '),
      rightUnit: Array.from(rUnits).join(' / '),
      hasRightAxis: effectiveScales.includes('y2'),
    };
  }, [workerSeries, effectiveScales]);

  const leftRange = useMemo(
    () =>
      computeYRange(
        leftValues,
        appearance.yScaleMode,
        appearance.yScaleManual?.left
      ),
    [leftValues, appearance.yScaleMode, appearance.yScaleManual]
  );
  const rightRange = useMemo(
    () =>
      computeYRange(
        rightValues,
        appearance.yScaleMode,
        appearance.yScaleManual?.right
      ),
    [rightValues, appearance.yScaleMode, appearance.yScaleManual]
  );

  // Footer primary stats from the first visible series.
  const primaryFooter = useMemo(
    () => (workerSeries.length > 0 ? computeFooterStats(workerSeries[0]) : null),
    [workerSeries]
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
      workerSeries.forEach((s, i) => {
        const idx = nearestIndex(s.xs, info.xEpoch);
        if (idx < 0) return;
        const y = s.ys[idx];
        if (!Number.isFinite(y)) return;
        rows.push({
          label: s.attribute,
          unit: unitFor(s.attribute),
          color: colors[i] ?? '#34d399',
          value: y,
        });
        nearestEpoch = s.xs[idx];
      });
      if (rows.length === 0) {
        setCursor((prev) => (prev.visible ? EMPTY_CURSOR : prev));
        return;
      }
      setCursor({ visible: true, left: info.left, top: info.top, xEpoch: nearestEpoch, rows });
    },
    [workerSeries, colors]
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
        labels={{
          style: t('canvasPanel.chartStyle'),
          line: t('canvasPanel.lineWidth'),
          points: t('canvasPanel.pointSize'),
          modeLine: t('canvasPanel.modeLine'),
          modePoints: t('canvasPanel.modePoints'),
          seriesRail: t('canvasPanel.axisPerSeriesHint'),
        }}
      />

      <div className="flex-1 flex min-h-0 relative">
        {railOpen && (
          <PanelSeriesRail
            series={series}
            colorFor={(_, i) => colors[i] ?? '#34d399'}
            unitFor={unitFor}
            seriesKey={seriesKey}
            onAxisChange={handleAxisChange}
            labels={{
              axisLeft: t('canvasPanel.axisLeft'),
              axisRight: t('canvasPanel.axisRight'),
              emptyHint: t('canvasPanel.dragHere'),
            }}
          />
        )}
        <div ref={containerWidthRef} className="relative flex-1 min-w-0">
          {status === 'ready' && workerSeries.length > 0 && (
            <PanelChart
              series={series}
              workerSeries={workerSeries}
              appearance={appearance}
              effectiveScales={effectiveScales}
              colors={colors}
              leftRange={leftRange}
              rightRange={rightRange}
              hasRightAxis={hasRightAxis}
              leftUnit={leftUnit}
              rightUnit={rightUnit}
              onCursor={handleCursor}
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
          workerSeries={workerSeries}
          colorFor={(_, i) => colors[i] ?? '#34d399'}
          unitFor={unitFor}
          primaryStats={primaryFooter}
          telemetry={{
            plotted: aggregatePoints(workerSeries).plotted,
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
