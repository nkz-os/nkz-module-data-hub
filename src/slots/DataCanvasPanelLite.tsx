import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import { useTranslation } from '@nekazari/sdk';

import { getBaseUrl, getDatahubRequestHeaders } from '../services/datahubApi';
import { DATAHUB_EVENT_RENDER_DEBUG, type DataHubRenderDebugDetail } from '../hooks/useUPlotCesiumSync';
import type { ChartAppearance, ChartRenderMode, ChartSeriesDef, PredictionPayload } from '../types/dashboard';
import type { DatahubWorkerRequest } from '../workers/contracts/datahubWorkerV2';
import DatahubWorkerInline from '../workers/datahubWorker.ts?worker&inline';
import { ChartStatusLayer } from './chart/ChartStatusLayer';
import { ChartSurface } from './chart/ChartSurface';
import { ChartRenderHost } from './chart/ChartRenderHost';
import { mergeChartAppearance } from '../utils/chartAppearance';

const COLORS = ['#22c55e', '#a855f7', '#f59e0b', '#3b82f6', '#ef4444'];
const BUILD = 'uplot-worker-2026-04-25-r9';

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
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number.parseFloat(t);
      return Number.isFinite(n) ? n : null;
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
      points: {
        show: false,
        size: 3,
        stroke: '#ffffff',
        fill: COLORS[i % COLORS.length],
      },
      paths: uPlot.paths.linear?.(),
      spanGaps: false,
    });
  });
  return out;
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

function robustScaleRangeFor(scaleKey: 'y' | 'y2') {
  return (u: uPlot, min: number, max: number): [number, number] => {
    const values: number[] = [];
    for (let i = 1; i < u.series.length; i++) {
      const s = u.series[i];
      if ((s.scale ?? 'y') !== scaleKey) continue;
      const col = u.data[i] as ArrayLike<number> | undefined;
      if (!col) continue;
      for (let j = 0; j < col.length; j++) {
        const v = Number(col[j]);
        if (Number.isFinite(v)) values.push(v);
      }
    }
    if (values.length < 3) {
      if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
        const base = Number.isFinite(min) ? min : 0;
        return [base - 1, base + 1];
      }
      const pad = Math.max(1e-6, Math.abs(max - min) * 0.08);
      return [min - pad, max + pad];
    }
    values.sort((a, b) => a - b);
    const p05 = quantile(values, 0.05);
    const p95 = quantile(values, 0.95);
    let lo = Number.isFinite(p05) ? p05 : min;
    let hi = Number.isFinite(p95) ? p95 : max;
    if (!(Number.isFinite(lo) && Number.isFinite(hi))) {
      lo = Number.isFinite(min) ? min : 0;
      hi = Number.isFinite(max) ? max : 1;
    }
    if (hi <= lo) {
      const c = Number.isFinite(lo) ? lo : 0;
      return [c - 1, c + 1];
    }
    const pad = Math.max(1e-6, (hi - lo) * 0.12);
    return [lo - pad, hi + pad];
  };
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [plotData, setPlotData] = useState<uPlot.AlignedData | null>(null);
  const [diag, setDiag] = useState({ received: 0, plotted: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [renderDbg, setRenderDbg] = useState<{ stage: string; cw: number; ch: number; uw: number; uh: number; pt: number; ph: number } | null>(null);
  const [yDbg, setYDbg] = useState<{ min: number; max: number; p05: number; p95: number } | null>(null);

  useEffect(() => {
    const worker = new DatahubWorkerInline();
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingReqRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onDebug = (evt: Event) => {
      const d = (evt as CustomEvent<DataHubRenderDebugDetail>).detail;
      if (!d || d.key !== panelId) return;
      setRenderDbg({
        stage: d.stage,
        cw: d.containerW,
        ch: d.containerH,
        uw: d.chartW,
        uh: d.chartH,
        pt: d.plotTop,
        ph: d.plotHeight,
      });
    };
    window.addEventListener(DATAHUB_EVENT_RENDER_DEBUG, onDebug);
    return () => window.removeEventListener(DATAHUB_EVENT_RENDER_DEBUG, onDebug);
  }, [panelId]);

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
      setStatus('empty');
      return;
    }
    let active = true;
    (async () => {
      try {
        setStatus('loading');
        const base = getBaseUrl().replace(/\/$/, '');
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
            maxGapSeconds: 15 * 60,
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
          setDiag({ received: result?.receivedPoints ?? 0, plotted: result?.plottablePoints ?? 0 });
          setStatus('empty');
          return;
        }
        setPlotData(result.data);
        setDiag({ received: result.receivedPoints, plotted: result.plottablePoints });
        const y0 = (result.data?.[1] as number[] | undefined) ?? [];
        const finite = y0.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
        if (finite.length > 0) {
          setYDbg({
            min: finite[0],
            max: finite[finite.length - 1],
            p05: quantile(finite, 0.05),
            p95: quantile(finite, 0.95),
          });
        } else {
          setYDbg(null);
        }
        setStatus('ready');
      } catch {
        if (!active) return;
        setPlotData(null);
        setDiag({ received: 0, plotted: 0 });
        setYDbg(null);
        setStatus('error');
      }
    })();
    return () => {
      active = false;
      pendingReqRef.current = null;
    };
  }, [series, startTime, endTime, resolution, processWithWorker]);

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
      // Keep title unset in uPlot; long dynamic labels can consume vertical space
      // and visually push the plot area to the bottom of the viewport.
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
        y: { auto: true, range: robustScaleRangeFor('y') },
        y2: { auto: true, range: robustScaleRangeFor('y2') },
      },
      axes: [
        { grid: { show: false } },
        { scale: 'y', grid: { stroke: '#334155' }, label: t('canvasPanel.axisLeft') },
        { scale: 'y2', side: 3, grid: { show: false }, label: t('canvasPanel.axisRight') },
      ],
      legend: { show: false },
      cursor: {
        drag: {
          x: true,
          y: false,
        },
      },
    } as unknown as uPlot.Options;
  }, [series, t, visual.lineWidth, visual.mode, visual.pointRadius]);

  return (
    <div className="relative w-full h-full bg-transparent border-none rounded-none p-0 flex flex-col min-h-0">
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
          onViewportChange={setViewport}
          debugKey={panelId}
        />
      </ChartSurface>

      <div className="absolute top-1 left-1 z-20 px-1.5 py-1 flex items-center gap-2 text-[11px] text-slate-100 flex-wrap rounded-md bg-slate-950/70 backdrop-blur-sm">
        <label className="flex items-center gap-1">
          <span className="text-slate-300">{t('canvasPanel.chartStyle')}</span>
          <select
            value={visual.mode === 'bars' ? 'line' : visual.mode}
            onChange={(e) => patchAppearance({ mode: e.target.value as ChartRenderMode })}
            className="rounded border border-slate-500/50 bg-slate-900 text-slate-100 px-1.5 py-0.5"
          >
            <option value="line">{t('canvasPanel.modeLine')}</option>
            <option value="points">{t('canvasPanel.modePoints')}</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-slate-300">{t('canvasPanel.lineWidth')}</span>
          <input
            type="range"
            min={1}
            max={4}
            step={1}
            value={visual.lineWidth}
            onChange={(e) => patchAppearance({ lineWidth: Number(e.target.value) })}
            className="w-16 accent-emerald-500"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-slate-300">{t('canvasPanel.pointSize')}</span>
          <input
            type="range"
            min={0}
            max={8}
            step={1}
            value={visual.pointRadius}
            onChange={(e) => patchAppearance({ pointRadius: Number(e.target.value) })}
            className="w-16 accent-emerald-500"
          />
        </label>
        {series.length > 1 && (
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="px-1.5 py-0.5 rounded border border-slate-500/50 bg-slate-900 text-slate-100"
          >
            {advancedOpen ? 'Basic' : 'Advanced'}
          </button>
        )}
      </div>

      <div className="absolute bottom-1 left-1 z-20 flex items-center gap-2 rounded-md bg-slate-950/70 backdrop-blur-sm px-1.5 py-0.5 text-[10px] text-slate-200">
        <span>{series.length === 1 ? series[0].attribute : `series:${series.length}`}</span>
        <span>points {diag.plotted}/{diag.received}</span>
        <span>viewport {viewport.width}x{viewport.height}</span>
        {renderDbg ? (
          <span>
            dbg {renderDbg.stage} c:{renderDbg.cw}x{renderDbg.ch} u:{renderDbg.uw}x{renderDbg.uh} p:{renderDbg.pt}/{renderDbg.ph}
          </span>
        ) : null}
        {yDbg ? (
          <span>
            y {yDbg.min.toFixed(2)}/{yDbg.max.toFixed(2)} p05/p95 {yDbg.p05.toFixed(2)}/{yDbg.p95.toFixed(2)}
          </span>
        ) : null}
        <span className="text-slate-400">{BUILD}</span>
      </div>

      {advancedOpen && onSeriesAxisChange && (
        <div className="absolute top-10 left-1 z-20 px-1.5 py-1 flex items-center gap-3 text-[11px] text-slate-100 flex-wrap rounded-md bg-slate-950/70 backdrop-blur-sm">
          {series.map((s, idx) => (
            <label key={`${s.entityId}-${s.attribute}`} className="flex items-center gap-1">
              <span className="text-slate-300">{s.attribute}</span>
              <select
                value={s.yAxis ?? 'left'}
                onChange={(e) =>
                  onSeriesAxisChange(panelId, idx, e.target.value === 'right' ? 'right' : 'left')
                }
                className="rounded border border-slate-500/50 bg-slate-900 text-slate-100 px-1.5 py-0.5"
              >
                <option value="left">{t('canvasPanel.axisLeft')}</option>
                <option value="right">{t('canvasPanel.axisRight')}</option>
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export const DataCanvasPanelMemo = React.memo(DataCanvasPanel);

