/**
 * DataCanvasPanel — Single or multi-series chart (Phase 1 + 3 + 4.5).
 * Single: GET /data. Multi: POST /align. Optional: chart mode, stroke/points, linear trendline.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

import { useUPlotCesiumSync } from '../hooks/useUPlotCesiumSync';
import { getBaseUrl, getDatahubRequestHeaders } from '../services/datahubApi';
import type { ChartAppearance, ChartRenderMode, ChartSeriesDef, ChartViewMode, PredictionPayload } from '../types/dashboard';
import { mergeChartAppearance, buildTrendSeries } from '../utils/chartAppearance';
import type {
  DatahubWorkerRequest,
  DatahubWorkerReleaseRequest,
} from '../workers/contracts/datahubWorkerV2';
import DatahubWorkerInline from '../workers/datahubWorker.ts?worker&inline';

const COLORS = ['#10B981', '#8B5CF6', '#F59E0B', '#3B82F6', '#EF4444'];
const PREDICTION_STROKE = '#F59E0B';
const TREND_STROKE = '#94a3b8';

/** Attribute-to-unit mapping for display */
const ATTRIBUTE_UNITS: Record<string, string> = {
  temp_avg: '°C', temp_min: '°C', temp_max: '°C', temperature: '°C',
  humidity_avg: '%', humidity_min: '%', humidity_max: '%', humidity: '%',
  precip_mm: 'mm', precipitation: 'mm',
  wind_speed_avg: 'm/s', wind_speed_max: 'm/s', wind_speed: 'm/s',
  pressure_avg: 'hPa', pressure: 'hPa',
  solar_radiation: 'W/m²', radiation: 'W/m²',
  soil_moisture: '%', soil_moisture_0_10cm: '%',
  ndvi: '', ndviMean: '', evi: '', savi: '', gndvi: '', ndre: '', ndwi: '',
  delta_t: '°C', gdd_accumulated: 'GDD',
};

interface SeriesStats {
  min: number;
  max: number;
  avg: number;
  last: number;
  count: number;
}

interface SanitizedSeriesData {
  data: uPlot.AlignedData;
  receivedPoints: number;
  plottablePoints: number;
}

function clampIndex(idx: number, maxExclusive: number, fallback: number): number {
  if (maxExclusive <= 0) return 0;
  if (!Number.isFinite(idx)) return Math.min(Math.max(0, fallback), maxExclusive - 1);
  return Math.min(Math.max(0, Math.floor(idx)), maxExclusive - 1);
}

function computePearsonR(
  xs: ArrayLike<number | null | undefined>,
  ys: ArrayLike<number | null | undefined>
): { r: number; n: number } | null {
  const len = Math.min(xs.length, ys.length);
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  for (let i = 0; i < len; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const xv = Number(x);
    const yv = Number(y);
    n += 1;
    sumX += xv;
    sumY += yv;
    sumXY += xv * yv;
    sumXX += xv * xv;
    sumYY += yv * yv;
  }
  if (n < 2) return null;
  const cov = n * sumXY - sumX * sumY;
  const varX = n * sumXX - sumX * sumX;
  const varY = n * sumYY - sumY * sumY;
  if (varX <= 0 || varY <= 0) return null;
  const r = cov / Math.sqrt(varX * varY);
  if (!Number.isFinite(r)) return null;
  return { r: Math.max(-1, Math.min(1, r)), n };
}

function workerCacheKey(
  source: string,
  entityId: string,
  attribute: string,
  startTime: string,
  endTime: string,
  resolution: number
): string {
  return `${source}|${entityId}|${attribute}|${startTime}|${endTime}|${resolution}`;
}

function computeStats(values: (number | null | undefined)[]): SeriesStats | null {
  const nums = (values as number[]).filter((v) => v != null && !isNaN(v));
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...nums),
    max: Math.max(...nums),
    avg: sum / nums.length,
    last: nums[nums.length - 1],
    count: nums.length,
  };
}

function formatStat(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function shortEntityId(entityId: string): string {
  return entityId.includes(':') ? (entityId.split(':').pop() ?? entityId) : entityId;
}

function buildValueSeriesOpts(
  idx: number,
  s: ChartSeriesDef,
  mode: ChartRenderMode,
  lineWidth: number,
  pointRadius: number
): uPlot.Series {
  const color = COLORS[idx % COLORS.length];
  const unit = ATTRIBUTE_UNITS[s.attribute] || '';
  const label = `${shortEntityId(s.entityId)} · ${s.attribute}${unit ? ` (${unit})` : ''}`;

  if (mode === 'bars' && uPlot.paths.bars) {
    return {
      label,
      scale: s.yAxis === 'right' ? 'y2' : 'y',
      stroke: color,
      fill: `${color}99`,
      width: Math.max(1, lineWidth),
      paths: uPlot.paths.bars({ size: [0.62, 8] }),
      points: {
        show: pointRadius > 0,
        size: Math.max(2, pointRadius),
        stroke: color,
        fill: color,
      },
    };
  }
  if (mode === 'points') {
    const pr = Math.max(2, pointRadius || 5);
    return {
      label,
      scale: s.yAxis === 'right' ? 'y2' : 'y',
      stroke: color,
      width: 0,
      paths: uPlot.paths.linear?.(),
      points: { show: true, size: pr, stroke: '#f8fafc', fill: color },
    };
  }
  return {
    label,
    scale: s.yAxis === 'right' ? 'y2' : 'y',
    stroke: color,
    width: lineWidth,
    paths: uPlot.paths.linear?.(),
    points: {
      show: pointRadius > 0,
      size: Math.max(2, pointRadius),
      stroke: '#f8fafc',
      fill: color,
    },
  };
}

export interface DataCanvasPanelProps {
  panelId: string;
  series: ChartSeriesDef[];
  startTime: string;
  endTime: string;
  resolution: number;
  prediction?: PredictionPayload | null;
  chartAppearance?: Partial<ChartAppearance>;
  /** Stable handler recommended so memoized panel skips re-renders when unrelated state changes. */
  onAppearanceChange?: (panelId: string, next: ChartAppearance) => void;
  onSeriesAxisChange?: (panelId: string, seriesIndex: number, yAxis: 'left' | 'right') => void;
}

export const DataCanvasPanel: React.FC<DataCanvasPanelProps> = ({
  panelId,
  series,
  startTime,
  endTime,
  resolution,
  prediction = null,
  chartAppearance,
  onAppearanceChange,
  onSeriesAxisChange,
}) => {
  const { t } = useTranslation('datahub');
  const containerRef = useRef<HTMLDivElement>(null);

  const visual = useMemo(() => mergeChartAppearance(chartAppearance), [chartAppearance]);

  const patchAppearance = useCallback(
    (partial: Partial<ChartAppearance>) => {
      onAppearanceChange?.(panelId, { ...visual, ...partial });
    },
    [onAppearanceChange, visual, panelId]
  );

  const [plotData, setPlotData] = useState<uPlot.AlignedData | null>(null);
  const [mergedPlotData, setMergedPlotData] = useState<uPlot.AlignedData | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready' | 'empty'>('loading');
  const [plotDiagnostics, setPlotDiagnostics] = useState({
    receivedPoints: 0,
    plottablePoints: 0,
  });
  const workerRef = useRef<Worker | null>(null);
  const pendingReqRef = useRef<string | null>(null);

  useEffect(() => {
    // Inline worker avoids /assets URL resolution issues in module runtime (/modules/<id>/...).
    const worker = new DatahubWorkerInline();
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingReqRef.current = null;
    };
  }, []);

  const processWithWorker = useCallback(
    (
      workerRequest: Omit<DatahubWorkerRequest, 'type' | 'requestId' | 'contractVersion'>
    ): Promise<SanitizedSeriesData | null> => {
      const worker = workerRef.current;
      if (!worker) return Promise.resolve(null);
      const requestId = `${panelId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      pendingReqRef.current = requestId;
      return new Promise((resolve) => {
        const onMessage = (event: MessageEvent<unknown>) => {
          const msg = event.data as {
            type?: string;
            requestId?: string;
            data?: Float64Array[];
            error?: unknown;
            stats?: { rawPointsFetched?: number; pointsPlotted?: number };
          };
          if (!msg || msg.type !== 'PROCESS_SERIES_RESULT') return;
          if (msg.requestId !== requestId) return;
          worker.removeEventListener('message', onMessage);
          if (pendingReqRef.current !== requestId) {
            resolve(null);
            return;
          }
          if (msg.error || !msg.data || msg.data.length < 2 || !msg.data[0].length) {
            resolve(null);
            return;
          }
          resolve({
            data: msg.data as unknown as uPlot.AlignedData,
            receivedPoints: msg.stats?.rawPointsFetched ?? 0,
            plottablePoints: msg.stats?.pointsPlotted ?? 0,
          });
        };
        worker.addEventListener('message', onMessage);
        const req: DatahubWorkerRequest = {
          type: 'PROCESS_SERIES',
          requestId,
          contractVersion: 2,
          ...workerRequest,
        };
        worker.postMessage(req);
      });
    },
    [panelId]
  );

  useEffect(() => {
    if (series.length === 0) {
      setStatus('empty');
      return;
    }

    const fetchData = async () => {
      setStatus('loading');
      try {
        const base = getBaseUrl().replace(/\/$/, '');
        const viewportWidth = containerRef.current?.offsetWidth || 800;
        const commonPolicy = {
          maxGapSeconds: 15 * 60,
          downsampleThreshold: Math.max(1024, Math.floor(viewportWidth * 2)),
          viewportWidthPx: viewportWidth,
          preserveExtrema: true,
        };
        const sanitized = await processWithWorker({
          mode: series.length > 1 ? 'multi' : 'single',
          baseUrl: base || undefined,
          headers: getDatahubRequestHeaders({ Accept: 'application/json' }),
          startTime,
          endTime,
          resolution,
          series: series.map((item) => ({
            entityId: item.entityId,
            attribute: item.attribute,
            source: item.source ?? 'timescale',
          })),
          policy: commonPolicy,
        });

        if (!sanitized) {
          setPlotData(null);
          setPlotDiagnostics({ receivedPoints: 0, plottablePoints: 0 });
          setStatus('empty');
          return;
        }
        setPlotData(sanitized.data);
        setPlotDiagnostics({
          receivedPoints: sanitized.receivedPoints,
          plottablePoints: sanitized.plottablePoints,
        });
        setStatus('ready');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setPlotData(null);
        setPlotDiagnostics({ receivedPoints: 0, plottablePoints: 0 });
        setStatus('error');
      }
    };

    fetchData();
    return () => {
      pendingReqRef.current = null;
      const worker = workerRef.current;
      if (!worker) return;
      const keys = series.map((item) =>
        workerCacheKey(
          item.source ?? 'timescale',
          item.entityId,
          item.attribute,
          startTime,
          endTime,
          resolution
        )
      );
      const releaseReq: DatahubWorkerReleaseRequest = {
        type: 'RELEASE_SERIES',
        keys,
      };
      worker.postMessage(releaseReq);
    };
  }, [panelId, series, startTime, endTime, resolution, processWithWorker]);

  useEffect(() => {
    if (!prediction) {
      setMergedPlotData(null);
      return;
    }
    if (series.length !== 1 || !plotData || plotData.length !== 2) return;
    const histTimes = plotData[0] as number[];
    const histValues = plotData[1] as number[];
    if (histTimes.length === 0) return;
    // Merge historical + prediction into 3-column matrix for uPlot
    const N = histTimes.length;
    const predTs = prediction.timestamps;
    const predVals = prediction.values;
    const M = predTs.length;
    const totalLen = N + M;
    const mergedTimes = new Array<number>(totalLen);
    const mergedHist = new Array<number | null>(totalLen);
    const mergedPred = new Array<number | null>(totalLen);
    for (let i = 0; i < N; i++) {
      mergedTimes[i] = histTimes[i];
      mergedHist[i] = histValues[i];
      mergedPred[i] = null;
    }
    if (N > 0) mergedPred[N - 1] = histValues[N - 1]; // anchor
    for (let i = 0; i < M; i++) {
      mergedTimes[N + i] = predTs[i];
      mergedHist[N + i] = null;
      mergedPred[N + i] = predVals[i];
    }
    setMergedPlotData([mergedTimes, mergedHist, mergedPred] as uPlot.AlignedData);
  }, [panelId, series.length, prediction, plotData]);

  const hasPrediction = mergedPlotData != null && mergedPlotData.length === 3;
  const trendlineEnabled = visual.showTrendline;
  const viewMode: ChartViewMode =
    visual.viewMode === 'correlation' && series.length >= 2 && !hasPrediction
      ? 'correlation'
      : 'timeseries';

  const effectiveMode: ChartRenderMode =
    series.length > 1 && visual.mode === 'bars' ? 'line' : visual.mode;

  const displayData = useMemo(() => {
    if (hasPrediction && mergedPlotData) {
      if (!trendlineEnabled) return mergedPlotData;
      const xs = mergedPlotData[0];
      const hist = mergedPlotData[1];
      const trend = buildTrendSeries(xs, hist);
      if (!trend) return mergedPlotData;
      const out: uPlot.AlignedData = [
        mergedPlotData[0],
        mergedPlotData[1],
        mergedPlotData[2],
        trend,
      ];
      return out;
    }
    if (!plotData || plotData.length < 2) return plotData;
    if (!trendlineEnabled) return plotData;
    const xs = plotData[0];
    const y1 = plotData[1];
    const trend = buildTrendSeries(xs, y1);
    if (!trend) return plotData;
    return [...plotData, trend] as uPlot.AlignedData;
  }, [hasPrediction, mergedPlotData, plotData, trendlineEnabled]);

  const correlationIndices = useMemo(() => {
    const x = clampIndex(visual.correlationXSeries, series.length, 0);
    const ySeed = series.length > 1 ? (x === 0 ? 1 : 0) : 0;
    let y = clampIndex(visual.correlationYSeries, series.length, ySeed);
    if (series.length > 1 && y === x) y = ySeed;
    return { x, y };
  }, [visual.correlationXSeries, visual.correlationYSeries, series.length]);

  const correlationData = useMemo(() => {
    if (viewMode !== 'correlation' || !plotData || plotData.length < 3) return null;
    const xSeries = plotData[correlationIndices.x + 1] as ArrayLike<number | null | undefined> | undefined;
    const ySeries = plotData[correlationIndices.y + 1] as ArrayLike<number | null | undefined> | undefined;
    if (!xSeries || !ySeries) return null;
    const len = Math.min(xSeries.length, ySeries.length);
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < len; i++) {
      const xv = xSeries[i];
      const yv = ySeries[i];
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
      points.push({ x: Number(xv), y: Number(yv) });
    }
    if (points.length === 0) return null;
    points.sort((a, b) => a.x - b.x);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    if (!trendlineEnabled) return [xs, ys] as uPlot.AlignedData;
    const trend = buildTrendSeries(xs, ys);
    if (!trend) return [xs, ys] as uPlot.AlignedData;
    return [xs, ys, trend] as uPlot.AlignedData;
  }, [viewMode, plotData, correlationIndices.x, correlationIndices.y, trendlineEnabled]);

  const pearson = useMemo(() => {
    if (viewMode !== 'correlation' || !correlationData || correlationData.length < 2) return null;
    return computePearsonR(correlationData[0] as number[], correlationData[1] as number[]);
  }, [viewMode, correlationData]);

  const uPlotOptions = useMemo(() => {
    const containerWidth = containerRef.current?.offsetWidth || 800;
    if (viewMode === 'correlation' && correlationData && series.length >= 2) {
      const xIdx = correlationIndices.x;
      const yIdx = correlationIndices.y;
      const xDef = series[xIdx];
      const yDef = series[yIdx];
      const xUnit = ATTRIBUTE_UNITS[xDef.attribute] || '';
      const yUnit = ATTRIBUTE_UNITS[yDef.attribute] || '';
      const baseLabel = `${shortEntityId(yDef.entityId)} · ${yDef.attribute}${yUnit ? ` (${yUnit})` : ''}`;
      const correlationSeries: uPlot.Series[] = [
        {},
        {
          label: baseLabel,
          stroke: COLORS[yIdx % COLORS.length],
          width: 0,
          points: {
            show: true,
            size: Math.max(2, visual.pointRadius || 4),
            stroke: '#f8fafc',
            fill: COLORS[yIdx % COLORS.length],
          },
          paths: uPlot.paths.linear?.(),
        },
      ];
      if (correlationData.length === 3) {
        correlationSeries.push({
          label: t('canvasPanel.trendline'),
          stroke: TREND_STROKE,
          width: 2,
          dash: [4, 4],
          paths: uPlot.paths.linear?.(),
          spanGaps: false,
        });
      }
      return {
        width: containerWidth,
        height: 280,
        title: t('canvasPanel.correlationTitle', {
          x: xDef.attribute,
          y: yDef.attribute,
        }),
        series: correlationSeries,
        scales: { x: { time: false, auto: true }, y: { auto: true } },
        axes: [
          {
            grid: { show: false },
            label: `${xDef.attribute}${xUnit ? ` (${xUnit})` : ''}`,
          },
          {
            scale: 'y',
            grid: { stroke: '#334155' },
            label: `${yDef.attribute}${yUnit ? ` (${yUnit})` : ''}`,
          },
        ],
      } as uPlot.Options;
    }

    const trendAdded =
      Boolean(trendlineEnabled && displayData) &&
      ((hasPrediction && displayData!.length === 4) ||
        (!hasPrediction &&
          series.length > 0 &&
          displayData!.length === series.length + 2));

    if (hasPrediction && series.length === 1) {
      const histOpts = buildValueSeriesOpts(0, series[0], effectiveMode, visual.lineWidth, visual.pointRadius);
      const baseScale = series[0].yAxis === 'right' ? 'y2' : 'y';
      const seriesOpts: uPlot.Series[] = [
        {},
        { ...histOpts, label: t('canvasPanel.historic'), scale: baseScale },
        {
          label: t('canvasPanel.predictionAI'),
          scale: baseScale,
          stroke: PREDICTION_STROKE,
          width: 2,
          dash: [10, 5],
          paths: uPlot.paths.linear?.(),
          spanGaps: false,
        },
      ];
      if (trendAdded && displayData?.length === 4) {
        seriesOpts.push({
          label: t('canvasPanel.trendline'),
          scale: baseScale,
          stroke: TREND_STROKE,
          width: 2,
          dash: [4, 4],
          paths: uPlot.paths.linear?.(),
          spanGaps: false,
        });
      }
      return {
        width: containerWidth,
        height: 300,
        title: `${series[0].entityId} — ${series[0].attribute}`,
        series: seriesOpts,
        scales: { x: { time: true }, y: { auto: true }, y2: { auto: true } },
        axes: [
          { grid: { show: false } },
          { scale: 'y', grid: { stroke: '#334155' }, label: t('canvasPanel.axisLeft') },
          { scale: 'y2', side: 3, grid: { show: false }, label: t('canvasPanel.axisRight') },
        ],
      } as uPlot.Options;
    }

    const dynamicSeries: uPlot.Series[] = [{}];
    series.forEach((s, idx) => {
      dynamicSeries.push(buildValueSeriesOpts(idx, s, effectiveMode, visual.lineWidth, visual.pointRadius));
    });
    if (trendAdded && displayData && displayData.length === series.length + 2) {
      dynamicSeries.push({
        label: t('canvasPanel.trendline'),
        scale: series[0]?.yAxis === 'right' ? 'y2' : 'y',
        stroke: TREND_STROKE,
        width: 2,
        dash: [4, 4],
        paths: uPlot.paths.linear?.(),
        spanGaps: false,
      });
    }
    const shortTitle =
      series.length === 1
        ? `${shortEntityId(series[0].entityId)} — ${series[0].attribute}`
        : t('canvasPanel.multiSeries', { count: series.length });
    return {
      width: containerWidth,
      height: 260,
      title: shortTitle,
      series: dynamicSeries,
      scales: { x: { time: true }, y: { auto: true }, y2: { auto: true } },
      axes: [
        { grid: { show: false } },
        { scale: 'y', grid: { stroke: '#334155' }, label: t('canvasPanel.axisLeft') },
        { scale: 'y2', side: 3, grid: { show: false }, label: t('canvasPanel.axisRight') },
      ],
    } as uPlot.Options;
  }, [series, hasPrediction, displayData, effectiveMode, visual, t, viewMode, correlationData, correlationIndices.x, correlationIndices.y]);

  const chartData = viewMode === 'correlation' ? correlationData : displayData;

  useUPlotCesiumSync({
    chartContainerRef: containerRef,
    options: uPlotOptions,
    data: chartData,
    syncEvents: viewMode === 'timeseries',
  });

  useEffect(() => {
    if (viewMode === 'timeseries' && series.length > 1 && visual.mode === 'bars' && onAppearanceChange) {
      onAppearanceChange(panelId, { ...visual, mode: 'line' });
    }
  }, [series.length, visual, onAppearanceChange, panelId, viewMode]);

  if (series.length === 0) {
    return (
      <div className="relative w-full h-full bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-center justify-center text-slate-400 text-sm">
        {t('canvasPanel.dragHere')}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col min-h-0">
      {onAppearanceChange && (
        <div className="shrink-0 mb-2 space-y-1">
          {hasPrediction ? (
            <p className="text-[10px] text-slate-500">{t('canvasPanel.styleLockedWithPrediction')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {series.length > 1 && (
                <>
                  <span className="text-slate-500 uppercase tracking-wide mr-1">{t('canvasPanel.viewMode')}</span>
                  <select
                    value={viewMode}
                    onChange={(e) => patchAppearance({ viewMode: e.target.value as ChartViewMode })}
                    className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-1.5 py-0.5 max-w-[160px]"
                    aria-label={t('canvasPanel.viewMode')}
                  >
                    <option value="timeseries">{t('canvasPanel.viewModeTimeseries')}</option>
                    <option value="correlation">{t('canvasPanel.viewModeCorrelation')}</option>
                  </select>
                </>
              )}
              <span className="text-slate-500 uppercase tracking-wide mr-1">{t('canvasPanel.chartStyle')}</span>
              <select
                value={series.length > 1 && visual.mode === 'bars' ? 'line' : visual.mode}
                onChange={(e) => patchAppearance({ mode: e.target.value as ChartRenderMode })}
                className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-1.5 py-0.5 max-w-[140px]"
                aria-label={t('canvasPanel.chartStyle')}
              >
                <option value="line">{t('canvasPanel.modeLine')}</option>
                <option value="points">{t('canvasPanel.modePoints')}</option>
                {series.length === 1 && <option value="bars">{t('canvasPanel.modeBars')}</option>}
              </select>
              <label className="flex items-center gap-1 text-slate-400">
                <span>{t('canvasPanel.lineWidth')}</span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={1}
                  value={visual.lineWidth}
                  onChange={(e) => patchAppearance({ lineWidth: Number(e.target.value) })}
                  className="w-16 accent-emerald-500"
                  aria-label={t('canvasPanel.lineWidth')}
                />
              </label>
              <label className="flex items-center gap-1 text-slate-400">
                <span>{t('canvasPanel.pointSize')}</span>
                <input
                  type="range"
                  min={0}
                  max={8}
                  step={1}
                  value={visual.pointRadius}
                  onChange={(e) => patchAppearance({ pointRadius: Number(e.target.value) })}
                  className="w-16 accent-emerald-500"
                  aria-label={t('canvasPanel.pointSize')}
                />
              </label>
              <label className="flex items-center gap-2 text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visual.showTrendline}
                  onChange={(e) => patchAppearance({ showTrendline: e.target.checked })}
                  className="rounded border-slate-500 accent-emerald-600"
                />
                <span>{t('canvasPanel.showTrendline')}</span>
              </label>
              {viewMode === 'correlation' && series.length > 1 && (
                <>
                  <span className="text-slate-500">{t('canvasPanel.correlationX')}</span>
                  <select
                    value={correlationIndices.x}
                    onChange={(e) => patchAppearance({ correlationXSeries: Number(e.target.value) })}
                    className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-1.5 py-0.5 max-w-[150px]"
                    aria-label={t('canvasPanel.correlationX')}
                  >
                    {series.map((s, idx) => (
                      <option key={`corr-x-${idx}`} value={idx}>
                        {s.attribute}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-500">{t('canvasPanel.correlationY')}</span>
                  <select
                    value={correlationIndices.y}
                    onChange={(e) => patchAppearance({ correlationYSeries: Number(e.target.value) })}
                    className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-1.5 py-0.5 max-w-[150px]"
                    aria-label={t('canvasPanel.correlationY')}
                  >
                    {series.map((s, idx) => (
                      <option key={`corr-y-${idx}`} value={idx}>
                        {s.attribute}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {series.length > 0 && <span className="text-slate-500">{t('canvasPanel.axisPerSeriesHint')}</span>}
            </div>
          )}
        </div>
      )}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-10 text-slate-400 text-sm">
          <svg
            className="animate-spin h-5 w-5 mr-2 text-emerald-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          {t('canvasPanel.loading')}
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-10 text-red-400 text-sm">
          {t('canvasPanel.errorLoad')}
        </div>
      )}
      {status === 'empty' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-10 text-slate-400 text-sm">
          {t('canvasPanel.noData')}
        </div>
      )}
      <div ref={containerRef} className="uplot-container flex-1 min-h-[200px]" />
      {status === 'ready' && chartData && chartData.length > 1 && (
        <div className="flex flex-wrap gap-3 mt-1 px-1 text-[11px] text-slate-400">
          <div className="text-slate-500">
            {t('canvasPanel.pointsInfo', {
              plottable: plotDiagnostics.plottablePoints,
              received: plotDiagnostics.receivedPoints,
            })}
          </div>
          {viewMode === 'correlation' && series.length > 1 && (
            <div className="text-slate-500">
              {t('canvasPanel.correlationInfo', {
                x: series[correlationIndices.x]?.attribute ?? '-',
                y: series[correlationIndices.y]?.attribute ?? '-',
              })}
            </div>
          )}
          {viewMode === 'correlation' && pearson && (
            <div className="text-slate-400">
              {t('canvasPanel.pearsonR', {
                r: pearson.r.toFixed(4),
                n: pearson.n,
              })}
            </div>
          )}
          {viewMode === 'timeseries' && series.map((s, idx) => {
            const vals = chartData[idx + 1];
            if (!vals) return null;
            const stats = computeStats(vals as (number | null)[]);
            if (!stats) return null;
            const unit = ATTRIBUTE_UNITS[s.attribute] || '';
            const color = COLORS[idx % COLORS.length];
            return (
              <div key={idx} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-slate-500">{s.attribute}:</span>
                <span>
                  {t('canvasPanel.statMin')} {formatStat(stats.min)}
                </span>
                <span>
                  {t('canvasPanel.statMax')} {formatStat(stats.max)}
                </span>
                <span>
                  {t('canvasPanel.statAvg')} {formatStat(stats.avg)}
                </span>
                <span>
                  {t('canvasPanel.statLast')} {formatStat(stats.last)}
                </span>
                {unit && <span className="text-slate-600">{unit}</span>}
                {onSeriesAxisChange && (
                  <select
                    value={s.yAxis ?? 'left'}
                    onChange={(e) =>
                      onSeriesAxisChange(panelId, idx, e.target.value === 'right' ? 'right' : 'left')
                    }
                    className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-1 py-0.5"
                    aria-label={t('canvasPanel.axisSelectorAria', { series: s.attribute })}
                  >
                    <option value="left">{t('canvasPanel.axisLeft')}</option>
                    <option value="right">{t('canvasPanel.axisRight')}</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const DataCanvasPanelMemo = React.memo(DataCanvasPanel);
