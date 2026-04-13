/**
 * DataCanvasPanel — Single or multi-series chart (Phase 1 + 3 + 4.5).
 * Single: GET /data. Multi: POST /align. Optional: chart mode, stroke/points, linear trendline.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

import { useUPlotCesiumSync } from '../hooks/useUPlotCesiumSync';
import { fetchTimeseriesJson, fetchTimeseriesAlign } from '../services/datahubApi';
import type { ChartAppearance, ChartRenderMode, ChartSeriesDef, PredictionPayload } from '../types/dashboard';
import { mergeChartAppearance, buildTrendSeries } from '../utils/chartAppearance';

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
      stroke: color,
      width: 0,
      paths: uPlot.paths.linear?.(),
      points: { show: true, size: pr, stroke: '#f8fafc', fill: color },
    };
  }
  return {
    label,
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

  useEffect(() => {
    if (series.length === 0) {
      setStatus('empty');
      return;
    }

    const ac = new AbortController();

    const fetchData = async () => {
      setStatus('loading');
      try {
        let uPlotData: uPlot.AlignedData;

        if (series.length === 1) {
          const s = series[0];
          const result = await fetchTimeseriesJson(
            s.entityId, s.attribute, startTime, endTime, resolution, ac.signal
          );
          if (!result.timestamps.length) { setStatus('empty'); return; }
          uPlotData = [result.timestamps, result.values];
        } else {
          const result = await fetchTimeseriesAlign(
            series.map((s) => ({
              entity_id: s.entityId,
              attribute: s.attribute,
              source: s.source ?? 'timescale',
            })),
            startTime, endTime, resolution, ac.signal
          );
          if (!result.timestamps.length) { setStatus('empty'); return; }
          uPlotData = [result.timestamps, ...result.valueArrays] as uPlot.AlignedData;
        }

        setPlotData(uPlotData);
        setStatus('ready');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setStatus('error');
      }
    };

    fetchData();
    return () => ac.abort();
  }, [panelId, series, startTime, endTime, resolution]);

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

  const effectiveMode: ChartRenderMode =
    series.length > 1 && visual.mode === 'bars' ? 'line' : visual.mode;

  const displayData = useMemo(() => {
    if (hasPrediction && mergedPlotData) {
      if (!visual.showTrendline) return mergedPlotData;
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
    if (!visual.showTrendline) return plotData;
    const xs = plotData[0];
    const y1 = plotData[1];
    const trend = buildTrendSeries(xs, y1);
    if (!trend) return plotData;
    return [...plotData, trend] as uPlot.AlignedData;
  }, [hasPrediction, mergedPlotData, plotData, visual.showTrendline]);

  const uPlotOptions = useMemo(() => {
    const containerWidth = containerRef.current?.offsetWidth || 800;
    const trendAdded =
      Boolean(visual.showTrendline && displayData) &&
      ((hasPrediction && displayData!.length === 4) ||
        (!hasPrediction &&
          series.length > 0 &&
          displayData!.length === series.length + 2));

    if (hasPrediction && series.length === 1) {
      const histOpts = buildValueSeriesOpts(0, series[0], effectiveMode, visual.lineWidth, visual.pointRadius);
      const seriesOpts: uPlot.Series[] = [
        {},
        { ...histOpts, label: t('canvasPanel.historic') },
        {
          label: t('canvasPanel.predictionAI'),
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
        axes: [{ grid: { show: false } }, { grid: { stroke: '#334155' } }],
      } as uPlot.Options;
    }

    const dynamicSeries: uPlot.Series[] = [{}];
    series.forEach((s, idx) => {
      dynamicSeries.push(buildValueSeriesOpts(idx, s, effectiveMode, visual.lineWidth, visual.pointRadius));
    });
    if (trendAdded && displayData && displayData.length === series.length + 2) {
      dynamicSeries.push({
        label: t('canvasPanel.trendline'),
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
      axes: [{ grid: { show: false } }, { grid: { stroke: '#334155' } }],
    } as uPlot.Options;
  }, [series, hasPrediction, displayData, effectiveMode, visual, t]);

  const chartData = displayData;

  useUPlotCesiumSync({
    chartContainerRef: containerRef,
    options: uPlotOptions,
    data: chartData,
  });

  useEffect(() => {
    if (series.length > 1 && visual.mode === 'bars' && onAppearanceChange) {
      onAppearanceChange(panelId, { ...visual, mode: 'line' });
    }
  }, [series.length, visual, onAppearanceChange, panelId]);

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
          {series.map((s, idx) => {
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const DataCanvasPanelMemo = React.memo(DataCanvasPanel);
