import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import { useTranslation } from '@nekazari/sdk';

import { getBaseUrl, getDatahubRequestHeaders } from '../services/datahubApi';
import type { ChartAppearance, ChartRenderMode, ChartSeriesDef, PredictionPayload } from '../types/dashboard';
import type { DatahubWorkerRequest } from '../workers/contracts/datahubWorkerV2';
import DatahubWorkerInline from '../workers/datahubWorker.ts?worker&inline';
import { ChartHeaderControls } from './chart/ChartHeaderControls';
import { ChartStatusLayer } from './chart/ChartStatusLayer';
import { ChartSurface } from './chart/ChartSurface';
import { ChartLegend } from './chart/ChartLegend';
import { ChartRenderHost } from './chart/ChartRenderHost';
import { mergeChartAppearance } from '../utils/chartAppearance';

const COLORS = ['#22c55e', '#a855f7', '#f59e0b', '#3b82f6', '#ef4444'];
const BUILD = 'uplot-worker-2026-04-22-r3';

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

function buildSeriesOptions(series: ChartSeriesDef[]): uPlot.Series[] {
  const out: uPlot.Series[] = [{}];
  series.forEach((s, i) => {
    out.push({
      label: s.attribute,
      scale: s.yAxis === 'right' ? 'y2' : 'y',
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
        const result = await processWithWorker({
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
        });
        if (!active) return;
        if (!result || result.plottablePoints <= 0) {
          setPlotData(null);
          setDiag({ received: result?.receivedPoints ?? 0, plotted: result?.plottablePoints ?? 0 });
          setStatus('empty');
          return;
        }
        setPlotData(result.data);
        setDiag({ received: result.receivedPoints, plotted: result.plottablePoints });
        setStatus('ready');
      } catch {
        if (!active) return;
        setPlotData(null);
        setDiag({ received: 0, plotted: 0 });
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
      title:
        series.length === 1
          ? `${series[0].entityId} — ${series[0].attribute}`
          : `${t('canvasPanel.multiSeries', { count: series.length })}`,
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
      scales: { x: { time: true }, y: { auto: true }, y2: { auto: true } },
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
    <div className="relative w-full h-full bg-transparent border-none rounded-none p-1.5 flex flex-col min-h-0 gap-1">
      <ChartHeaderControls series={series} buildLabel={BUILD} />
      <div className="mb-1 px-1.5 py-1 flex items-center gap-2 text-[11px] text-slate-200 flex-wrap rounded-xl bg-slate-900/30 border border-slate-600/20">
        <label className="flex items-center gap-1">
          <span className="text-slate-400">{t('canvasPanel.chartStyle')}</span>
          <select
            value={visual.mode === 'bars' ? 'line' : visual.mode}
            onChange={(e) => patchAppearance({ mode: e.target.value as ChartRenderMode })}
            className="rounded-lg border border-slate-500/40 bg-slate-900/70 text-slate-100 px-2 py-1"
          >
            <option value="line">{t('canvasPanel.modeLine')}</option>
            <option value="points">{t('canvasPanel.modePoints')}</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-slate-400">{t('canvasPanel.lineWidth')}</span>
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
          <span className="text-slate-400">{t('canvasPanel.pointSize')}</span>
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
            className="px-2 py-1 rounded-lg border border-slate-500/40 bg-slate-900/70 text-slate-100"
          >
            {advancedOpen ? 'Basic' : 'Advanced'}
          </button>
        )}
      </div>
      {advancedOpen && onSeriesAxisChange && (
        <div className="mb-1 px-1 flex items-center gap-3 text-[11px] text-slate-300 flex-wrap">
          {series.map((s, idx) => (
            <label key={`${s.entityId}-${s.attribute}`} className="flex items-center gap-1">
              <span className="text-slate-500">{s.attribute}</span>
              <select
                value={s.yAxis ?? 'left'}
                onChange={(e) =>
                  onSeriesAxisChange(panelId, idx, e.target.value === 'right' ? 'right' : 'left')
                }
                className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-1.5 py-0.5"
              >
                <option value="left">{t('canvasPanel.axisLeft')}</option>
                <option value="right">{t('canvasPanel.axisRight')}</option>
              </select>
            </label>
          ))}
        </div>
      )}

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
        />
      </ChartSurface>

      <ChartLegend
        series={series}
        colors={COLORS}
        plottedPoints={diag.plotted}
        receivedPoints={diag.received}
        viewport={viewport}
      />
    </div>
  );
};

export const DataCanvasPanelMemo = React.memo(DataCanvasPanel);

