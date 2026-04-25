import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import { useTranslation } from '@nekazari/sdk';
import { Settings2 } from 'lucide-react';

import { getBaseUrl, getDatahubRequestHeaders } from '../services/datahubApi';
import type { ChartAppearance, ChartRenderMode, ChartSeriesDef, PredictionPayload } from '../types/dashboard';
import type { DatahubWorkerRequest } from '../workers/contracts/datahubWorkerV2';
import DatahubWorkerInline from '../workers/datahubWorker.ts?worker&inline';
import { ChartStatusLayer } from './chart/ChartStatusLayer';
import { ChartSurface } from './chart/ChartSurface';
import { ChartRenderHost } from './chart/ChartRenderHost';
import { mergeChartAppearance } from '../utils/chartAppearance';

const COLORS = ['#22c55e', '#a855f7', '#f59e0b', '#3b82f6', '#ef4444'];

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

interface WorkerResult {
  data: uPlot.AlignedData;
  receivedPoints: number;
  plottablePoints: number;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toEpochSeconds(value: unknown): number | null {
  const normalize = (n: number): number => {
    let v = n;
    while (Math.abs(v) > 1e11) v /= 1000;
    return v;
  };
  if (typeof value === 'number' && Number.isFinite(value)) return normalize(value);
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number.parseFloat(t);
      return Number.isFinite(n) ? normalize(n) : null;
    }
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms / 1000 : null;
  }
  return null;
}

function parseSeriesPayload(payload: unknown): { x: number[]; y: number[] } {
  const obj = (payload ?? {}) as Record<string, unknown>;
  const timestamps = Array.isArray(obj.timestamps) ? obj.timestamps : [];
  const values = Array.isArray(obj.values)
    ? obj.values
    : Array.isArray(obj.value_0)
      ? obj.value_0
      : [];
  const len = Math.min(timestamps.length, values.length);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < len; i++) {
    const xv = toEpochSeconds(timestamps[i]);
    if (xv == null) continue;
    x.push(xv);
    const yv = toFiniteNumber(values[i]);
    y.push(yv == null ? Number.NaN : yv);
  }
  return { x, y };
}

function outerJoinSeries(rows: Array<{ x: number[]; y: number[] }>): uPlot.AlignedData {
  const all = new Set<number>();
  rows.forEach((r) => r.x.forEach((v) => all.add(v)));
  const x = Array.from(all.values()).sort((a, b) => a - b);
  const index = new Map<number, number>();
  x.forEach((v, i) => index.set(v, i));
  const ys = rows.map(() => Array.from({ length: x.length }, () => Number.NaN));
  rows.forEach((r, sIdx) => {
    for (let i = 0; i < r.x.length; i++) {
      const dst = index.get(r.x[i]);
      if (dst == null) continue;
      ys[sIdx][dst] = r.y[i];
    }
  });
  return [x, ...ys] as uPlot.AlignedData;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const w = pos - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

/**
 * Outlier removal using MAD (Median Absolute Deviation), floored by IQR fences
 * to handle near-flat data with rare spikes (typical sensor glitches).
 * Outliers are replaced with NaN so uPlot draws a gap; range stays compact.
 */
function maskOutliers(values: ReadonlyArray<number>): { cleaned: number[]; removed: number } {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length < 8) return { cleaned: values.slice(), removed: 0 };
  finite.sort((a, b) => a - b);
  const median = quantile(finite, 0.5);
  const q25 = quantile(finite, 0.25);
  const q75 = quantile(finite, 0.75);
  const iqr = Math.max(0, q75 - q25);
  const devs = finite.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = quantile(devs, 0.5);
  // 1.4826*MAD estimates σ under normality. 6σ keeps natural variation.
  const madBound = mad > 0 ? 6 * 1.4826 * mad : 0;
  const iqrBound = iqr > 0 ? 3 * iqr : 0;
  const bound = Math.max(madBound, iqrBound);
  if (!(bound > 0)) return { cleaned: values.slice(), removed: 0 };
  const cleaned = new Array<number>(values.length);
  let removed = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      cleaned[i] = Number.NaN;
      continue;
    }
    if (Math.abs(v - median) > bound) {
      cleaned[i] = Number.NaN;
      removed += 1;
    } else {
      cleaned[i] = v;
    }
  }
  return { cleaned, removed };
}

function buildSeriesOptions(series: ChartSeriesDef[]): uPlot.Series[] {
  const out: uPlot.Series[] = [{}];
  series.forEach((s, i) => {
    const resolvedScale =
      s.yAxis === 'right'
        ? 'y2'
        : s.yAxis === 'left'
          ? 'y'
          : series.length > 1 && i > 0
            ? 'y2'
            : 'y';
    out.push({
      label: s.attribute,
      scale: resolvedScale,
      stroke: COLORS[i % COLORS.length],
      width: 2,
      points: { show: false, size: 3, stroke: '#ffffff', fill: COLORS[i % COLORS.length] },
      paths: uPlot.paths.linear?.(),
      spanGaps: false,
    });
  });
  return out;
}

function rangeFor(scaleKey: 'y' | 'y2') {
  return (u: uPlot, min: number, max: number): [number, number] => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 1; i < u.series.length; i++) {
      if ((u.series[i].scale ?? 'y') !== scaleKey) continue;
      const col = u.data[i] as ArrayLike<number> | undefined;
      if (!col) continue;
      for (let j = 0; j < col.length; j++) {
        const v = Number(col[j]);
        if (Number.isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      const a = Number.isFinite(min) ? min : 0;
      const b = Number.isFinite(max) ? max : 1;
      if (a === b) return [a - 1, a + 1];
      return [a, b];
    }
    if (lo === hi) return [lo - 1, hi + 1];
    const pad = Math.max(1e-6, (hi - lo) * 0.08);
    return [lo - pad, hi + pad];
  };
}

function computeAdaptiveMaxGapSeconds(startTime: string, endTime: string, resolution: number): number {
  const startMs = Date.parse(startTime);
  const endMs = Date.parse(endTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || resolution <= 1) {
    return 6 * 3600;
  }
  const spanSec = (endMs - startMs) / 1000;
  const step = spanSec / Math.max(1, resolution - 1);
  return Math.max(15 * 60, Math.min(24 * 3600, step * 4));
}

function formatNumberShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

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
  const workerRef = useRef<Worker | null>(null);
  const pendingReqRef = useRef<string | null>(null);

  const visual = useMemo(() => mergeChartAppearance(chartAppearance), [chartAppearance]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [plotData, setPlotData] = useState<uPlot.AlignedData | null>(null);
  const [diag, setDiag] = useState({ received: 0, plotted: 0, outliers: 0 });
  const [stats, setStats] = useState<{ min: number; max: number; mean: number; last: number } | null>(null);

  useEffect(() => {
    const worker = new DatahubWorkerInline();
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingReqRef.current = null;
    };
  }, []);

  const processWithWorker = useCallback(
    (req: Omit<DatahubWorkerRequest, 'type' | 'requestId' | 'contractVersion'>): Promise<WorkerResult | null> => {
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
          const normalized = msg.data.map((arr) => Array.from(arr)) as unknown as uPlot.AlignedData;
          resolve({
            data: normalized,
            receivedPoints: msg.stats?.rawPointsFetched ?? 0,
            plottablePoints: msg.stats?.pointsPlotted ?? 0,
          });
        };
        worker.addEventListener('message', onMessage);
        worker.postMessage({
          ...req,
          type: 'PROCESS_SERIES',
          requestId,
          contractVersion: 2,
        } as DatahubWorkerRequest);
      });
    },
    [panelId]
  );

  const processDirectFallback = useCallback(
    async (base: string): Promise<WorkerResult | null> => {
      const headers = getDatahubRequestHeaders({ Accept: 'application/json' });
      const rows: Array<{ x: number[]; y: number[] }> = [];
      let receivedPoints = 0;
      for (const s of series) {
        const params = new URLSearchParams({
          start_time: startTime,
          end_time: endTime,
          resolution: String(resolution),
          attribute: s.attribute,
        });
        const path = `/api/datahub/timeseries/entities/${encodeURIComponent(s.entityId)}/data?${params}`;
        const url = base ? `${base}${path}` : path;
        const resp = await fetch(url, { headers, credentials: 'include' });
        if (resp.status === 204) {
          rows.push({ x: [], y: [] });
          continue;
        }
        if (!resp.ok) return null;
        const payload = await resp.json();
        const parsed = parseSeriesPayload(payload);
        receivedPoints += parsed.x.length;
        rows.push(parsed);
      }
      const data = outerJoinSeries(rows);
      let plotted = 0;
      for (let i = 1; i < data.length; i++) {
        const arr = data[i] as number[];
        for (let j = 0; j < arr.length; j++) if (Number.isFinite(arr[j])) plotted += 1;
      }
      if ((data[0] as number[]).length === 0) return null;
      return { data, receivedPoints, plottablePoints: plotted };
    },
    [endTime, resolution, series, startTime]
  );

  useEffect(() => {
    if (series.length === 0) {
      setPlotData(null);
      setStats(null);
      setStatus('empty');
      return;
    }
    let active = true;
    (async () => {
      try {
        setStatus('loading');
        const base = getBaseUrl().replace(/\/$/, '');
        const adaptiveGapSeconds = computeAdaptiveMaxGapSeconds(startTime, endTime, resolution);
        const effectiveGapSeconds = series.length === 1 ? 365 * 24 * 3600 : adaptiveGapSeconds;
        const workerRequest = {
          mode: series.length > 1 ? 'multi' : 'single',
          baseUrl: base || undefined,
          headers: getDatahubRequestHeaders({ Accept: 'application/json' }),
          startTime,
          endTime,
          resolution,
          series: series.map((s) => ({
            entityId: s.entityId,
            attribute: s.attribute,
            source: s.source ?? 'timescale',
          })),
          policy: {
            maxGapSeconds: effectiveGapSeconds,
            downsampleThreshold: 3000,
            viewportWidthPx: 1200,
            preserveExtrema: true,
          },
        } as Omit<DatahubWorkerRequest, 'type' | 'requestId' | 'contractVersion'>;

        let result = await processWithWorker(workerRequest);
        if ((!result || result.plottablePoints <= 0) && active) {
          result = await processWithWorker({ ...workerRequest, forceRefresh: true });
        }
        if ((!result || result.plottablePoints <= 0) && active) {
          result = await processDirectFallback(base);
        }
        if (!active) return;
        if (!result || result.plottablePoints <= 0) {
          setPlotData(null);
          setStats(null);
          setDiag({ received: result?.receivedPoints ?? 0, plotted: result?.plottablePoints ?? 0, outliers: 0 });
          setStatus('empty');
          return;
        }

        // Outlier sanitation per Y series.
        const cleanedColumns: number[][] = [];
        let outlierCount = 0;
        for (let i = 1; i < result.data.length; i++) {
          const col = result.data[i] as ArrayLike<number>;
          const arr: number[] = [];
          for (let j = 0; j < col.length; j++) arr.push(Number(col[j]));
          const { cleaned, removed } = maskOutliers(arr);
          outlierCount += removed;
          cleanedColumns.push(cleaned);
        }
        const cleanedData = [result.data[0] as number[], ...cleanedColumns] as unknown as uPlot.AlignedData;

        // Stats from the first series, cleaned.
        const firstClean = cleanedColumns[0] ?? [];
        let mn = Number.POSITIVE_INFINITY;
        let mx = Number.NEGATIVE_INFINITY;
        let sum = 0;
        let n = 0;
        let last = Number.NaN;
        for (let j = 0; j < firstClean.length; j++) {
          const v = firstClean[j];
          if (Number.isFinite(v)) {
            if (v < mn) mn = v;
            if (v > mx) mx = v;
            sum += v;
            n += 1;
            last = v;
          }
        }
        setStats(
          n > 0
            ? { min: mn, max: mx, mean: sum / n, last }
            : null
        );
        setPlotData(cleanedData);
        setDiag({ received: result.receivedPoints, plotted: result.plottablePoints, outliers: outlierCount });
        setStatus('ready');
      } catch {
        if (!active) return;
        setPlotData(null);
        setStats(null);
        setDiag({ received: 0, plotted: 0, outliers: 0 });
        setStatus('error');
      }
    })();
    return () => {
      active = false;
      pendingReqRef.current = null;
    };
  }, [series, startTime, endTime, resolution, processWithWorker, processDirectFallback]);

  const patchAppearance = useCallback(
    (partial: Partial<ChartAppearance>) => {
      if (!onAppearanceChange) return;
      onAppearanceChange(panelId, { ...visual, ...partial });
    },
    [onAppearanceChange, panelId, visual]
  );

  const options = useMemo(() => {
    const effectiveMode: ChartRenderMode = visual.mode === 'bars' ? 'line' : visual.mode;
    return {
      title: undefined,
      series: buildSeriesOptions(series).map((s, idx) => {
        if (idx === 0) return s;
        if (effectiveMode === 'points') {
          return {
            ...s,
            width: 0,
            points: { show: true, size: Math.max(2, visual.pointRadius || 4), stroke: '#ffffff' },
          } as uPlot.Series;
        }
        return {
          ...s,
          width: Math.max(1, visual.lineWidth),
          points: {
            show: visual.pointRadius > 0,
            size: Math.max(2, visual.pointRadius),
            stroke: '#ffffff',
          },
        } as uPlot.Series;
      }),
      scales: {
        x: { time: true },
        y: { auto: true, range: rangeFor('y') },
        y2: { auto: true, range: rangeFor('y2') },
      },
      axes: [
        {
          stroke: '#94a3b8',
          grid: { stroke: 'rgba(148,163,184,0.10)', width: 1 },
          ticks: { stroke: 'rgba(148,163,184,0.25)' },
        },
        {
          scale: 'y',
          stroke: '#94a3b8',
          grid: { stroke: 'rgba(148,163,184,0.10)', width: 1 },
          ticks: { stroke: 'rgba(148,163,184,0.25)' },
          size: 50,
        },
        {
          scale: 'y2',
          side: 1,
          stroke: '#94a3b8',
          grid: { show: false },
          ticks: { stroke: 'rgba(148,163,184,0.25)' },
          size: 50,
        },
      ],
      legend: { show: false },
      cursor: {
        drag: { x: true, y: false },
      },
      padding: [8, 12, 4, 4] as [number, number, number, number],
    } as unknown as uPlot.Options;
  }, [series, visual.lineWidth, visual.mode, visual.pointRadius]);

  const subtitle = series.length === 1
    ? series[0].attribute
    : t('canvasPanel.multiSeries', { count: series.length });

  return (
    <div className="relative w-full h-full bg-transparent flex flex-col min-h-0">
      <ChartSurface>
        <ChartStatusLayer
          status={status}
          loadingText={t('canvasPanel.loading')}
          emptyText={t('canvasPanel.noData')}
          errorText={t('canvasPanel.errorLoad')}
        />
        <ChartRenderHost
          options={options}
          data={plotData}
          syncEvents={true}
          debugKey={panelId}
        />
      </ChartSurface>

      {/* Settings gear: collapsed by default, no overlay clutter */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSettingsOpen((v) => !v);
        }}
        className="absolute top-1.5 left-1.5 z-30 p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors"
        title={t('canvasPanel.chartStyle')}
        aria-label={t('canvasPanel.chartStyle')}
      >
        <Settings2 size={14} />
      </button>

      {settingsOpen && (
        <div
          className="absolute top-9 left-1.5 z-30 px-2.5 py-2 flex flex-col gap-2 text-[11px] text-slate-100 rounded-md bg-slate-950/90 backdrop-blur-md border border-slate-700/60 shadow-lg"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-400">{t('canvasPanel.chartStyle')}</span>
            <select
              value={visual.mode === 'bars' ? 'line' : visual.mode}
              onChange={(e) => patchAppearance({ mode: e.target.value as ChartRenderMode })}
              className="rounded border border-slate-600/50 bg-slate-900 text-slate-100 px-1.5 py-0.5"
            >
              <option value="line">{t('canvasPanel.modeLine')}</option>
              <option value="points">{t('canvasPanel.modePoints')}</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-400">{t('canvasPanel.lineWidth')}</span>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={visual.lineWidth}
              onChange={(e) => patchAppearance({ lineWidth: Number(e.target.value) })}
              className="w-20 accent-emerald-500"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-400">{t('canvasPanel.pointSize')}</span>
            <input
              type="range"
              min={0}
              max={8}
              step={1}
              value={visual.pointRadius}
              onChange={(e) => patchAppearance({ pointRadius: Number(e.target.value) })}
              className="w-20 accent-emerald-500"
            />
          </label>
          {series.length > 1 && onSeriesAxisChange && (
            <div className="border-t border-slate-700/60 pt-2 mt-1 flex flex-col gap-1.5">
              <span className="text-slate-400">{t('canvasPanel.axisPerSeriesHint')}</span>
              {series.map((s, idx) => (
                <label key={`${s.entityId}-${s.attribute}`} className="flex items-center justify-between gap-3">
                  <span className="text-slate-300 truncate max-w-[140px]" title={s.attribute}>
                    {s.attribute}
                  </span>
                  <select
                    value={s.yAxis ?? 'left'}
                    onChange={(e) =>
                      onSeriesAxisChange(panelId, idx, e.target.value === 'right' ? 'right' : 'left')
                    }
                    className="rounded border border-slate-600/50 bg-slate-900 text-slate-100 px-1.5 py-0.5"
                  >
                    <option value="left">{t('canvasPanel.axisLeft')}</option>
                    <option value="right">{t('canvasPanel.axisRight')}</option>
                  </select>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {status === 'ready' && (
        <div className="absolute bottom-1 left-1.5 z-20 flex items-center gap-3 text-[10px] text-slate-400 pointer-events-none">
          <span className="text-slate-300 font-medium truncate max-w-[180px]" title={subtitle}>
            {subtitle}
          </span>
          {stats && (
            <span className="tabular-nums">
              <span className="text-slate-500">{t('canvasPanel.statMin')}</span> {formatNumberShort(stats.min)}
              <span className="text-slate-500 ml-2">{t('canvasPanel.statMax')}</span> {formatNumberShort(stats.max)}
              <span className="text-slate-500 ml-2">{t('canvasPanel.statAvg')}</span> {formatNumberShort(stats.mean)}
              <span className="text-slate-500 ml-2">{t('canvasPanel.statLast')}</span> {formatNumberShort(stats.last)}
            </span>
          )}
          <span className="tabular-nums text-slate-500">
            {diag.plotted} pts
            {diag.outliers > 0 && (
              <span className="ml-1.5 text-amber-400/80" title={t('canvasPanel.outliersHiddenTitle')}>
                · {t('canvasPanel.outliersHidden', { count: diag.outliers })}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
};

export const DataCanvasPanelMemo = React.memo(DataCanvasPanel);
