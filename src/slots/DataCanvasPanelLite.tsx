/**
 * DataCanvasPanelLite — SOTA tactical chart panel.
 *
 * Architectural choices:
 *  - uPlot mode 2 (faceted): each series owns its own X array. No outer-join,
 *    no synthetic NaN gaps, no spanGaps tricks. Each line draws cleanly over
 *    its real timestamps regardless of what other series do.
 *  - Direct REST fetch per series (bypassing the worker pipeline whose
 *    alignment + gap-injection produced fragmented traces in multi-series).
 *  - Y range = robust percentile clamp (p1–p99) with 5% padding. Outliers
 *    stay in the data (no masking) but cannot compress the visible band.
 *  - Crosshair + custom HTML tooltip (per-series values + ISO timestamp).
 *  - Settings UI collapsed behind a gear; canvas stays visually clean.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTranslation } from '@nekazari/sdk';
import { Settings2 } from 'lucide-react';

import { getBaseUrl, getDatahubRequestHeaders } from '../services/datahubApi';
import type { ChartAppearance, ChartRenderMode, ChartSeriesDef, PredictionPayload } from '../types/dashboard';
import { mergeChartAppearance } from '../utils/chartAppearance';

const SERIES_COLORS = ['#22c55e', '#a855f7', '#f59e0b', '#3b82f6', '#ef4444', '#ec4899'];
const TEXT_MUTED = '#94a3b8';
const GRID_RGBA = 'rgba(148,163,184,0.10)';

type Status = 'loading' | 'ready' | 'empty' | 'error';

interface ParsedSeries {
  xs: Float64Array;
  ys: Float64Array;
}

interface SeriesStats {
  min: number;
  max: number;
  mean: number;
  last: number;
  count: number;
}

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

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

function toEpochSeconds(value: unknown): number {
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
      return Number.isFinite(n) ? normalize(n) : Number.NaN;
    }
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms / 1000 : Number.NaN;
  }
  return Number.NaN;
}

function parsePayload(payload: unknown): ParsedSeries {
  const obj = (payload ?? {}) as Record<string, unknown>;
  const ts = Array.isArray(obj.timestamps) ? obj.timestamps : [];
  const vs = Array.isArray(obj.values)
    ? obj.values
    : Array.isArray(obj.value_0)
      ? obj.value_0
      : [];
  const len = Math.min(ts.length, vs.length);
  const xs = new Float64Array(len);
  const ys = new Float64Array(len);
  let n = 0;
  for (let i = 0; i < len; i++) {
    const x = toEpochSeconds(ts[i]);
    if (!Number.isFinite(x)) continue;
    xs[n] = x;
    ys[n] = toFiniteNumber(vs[i]);
    n += 1;
  }
  // Drop unused slots and ensure ascending X.
  const finalXs = xs.slice(0, n);
  const finalYs = ys.slice(0, n);
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => finalXs[a] - finalXs[b]);
  const sortedX = new Float64Array(n);
  const sortedY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sortedX[i] = finalXs[idx[i]];
    sortedY[i] = finalYs[idx[i]];
  }
  return { xs: sortedX, ys: sortedY };
}

function quantile(sorted: Float64Array | number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const w = pos - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function computeStats(ys: Float64Array): SeriesStats | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let n = 0;
  let last = Number.NaN;
  for (let i = 0; i < ys.length; i++) {
    const v = ys[i];
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      n += 1;
      last = v;
    }
  }
  if (n === 0) return null;
  return { min, max, mean: sum / n, last, count: n };
}

/** Robust Y range = clamp by p1/p99 with 5% padding. Keeps natural variation, prevents single spikes from compressing the trace. */
function robustRange(values: Float64Array | number[]): [number, number] | null {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return null;
  finite.sort((a, b) => a - b);
  let lo = quantile(finite, 0.01);
  let hi = quantile(finite, 0.99);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = finite[0];
    hi = finite[finite.length - 1];
  }
  if (lo === hi) {
    const c = lo;
    return [c - 1, c + 1];
  }
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

function formatNumberShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

function formatDateLocal(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Find nearest sample in series.xs to xTarget; returns its y or NaN. */
function nearestY(series: ParsedSeries, xTarget: number): { y: number; x: number } | null {
  const xs = series.xs;
  const n = xs.length;
  if (n === 0) return null;
  // Binary search for nearest.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < xTarget) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first xs >= xTarget. Compare with previous.
  let best = lo;
  if (lo > 0 && Math.abs(xs[lo - 1] - xTarget) < Math.abs(xs[lo] - xTarget)) {
    best = lo - 1;
  }
  return { y: series.ys[best], x: xs[best] };
}

interface TooltipState {
  visible: boolean;
  left: number;
  top: number;
  xEpoch: number;
  rows: Array<{ label: string; color: string; value: number; xEpoch: number }>;
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
  const visual = useMemo(() => mergeChartAppearance(chartAppearance), [chartAppearance]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const seriesDataRef = useRef<ParsedSeries[]>([]);
  const seriesDefsRef = useRef<ChartSeriesDef[]>([]);

  const [status, setStatus] = useState<Status>('loading');
  const [perSeriesStats, setPerSeriesStats] = useState<Array<SeriesStats | null>>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    left: 0,
    top: 0,
    xEpoch: 0,
    rows: [],
  });

  // ---------- Data fetching ----------
  useEffect(() => {
    if (series.length === 0) {
      seriesDataRef.current = [];
      seriesDefsRef.current = [];
      setPerSeriesStats([]);
      setStatus('empty');
      return;
    }
    let active = true;
    setStatus('loading');
    (async () => {
      try {
        const base = getBaseUrl().replace(/\/$/, '');
        const headers = getDatahubRequestHeaders({ Accept: 'application/json' });
        const fetched: ParsedSeries[] = [];
        const stats: Array<SeriesStats | null> = [];
        let totalPoints = 0;
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
          if (!active) return;
          if (resp.status === 204) {
            fetched.push({ xs: new Float64Array(0), ys: new Float64Array(0) });
            stats.push(null);
            continue;
          }
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status} for ${s.attribute}`);
          }
          const payload = await resp.json();
          const parsed = parsePayload(payload);
          fetched.push(parsed);
          stats.push(computeStats(parsed.ys));
          totalPoints += parsed.xs.length;
        }
        if (!active) return;
        seriesDataRef.current = fetched;
        seriesDefsRef.current = series;
        setPerSeriesStats(stats);
        setStatus(totalPoints > 0 ? 'ready' : 'empty');
      } catch (err) {
        if (!active) return;
        console.error('[DataCanvasPanel] fetch failed', err);
        seriesDataRef.current = [];
        setPerSeriesStats([]);
        setStatus('error');
      }
    })();
    return () => {
      active = false;
    };
  }, [series, startTime, endTime, resolution]);

  // ---------- Hide tooltip whenever data reloads ----------
  useEffect(() => {
    if (status !== 'ready') {
      setTooltip((t) => ({ ...t, visible: false }));
    }
  }, [status]);

  // ---------- uPlot init / re-init ----------
  useEffect(() => {
    if (status !== 'ready') {
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    const seriesData = seriesDataRef.current;
    const seriesDefs = seriesDefsRef.current;
    if (seriesData.length === 0) return;

    // Compute global X domain across all series.
    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    for (const s of seriesData) {
      if (s.xs.length === 0) continue;
      if (s.xs[0] < xMin) xMin = s.xs[0];
      if (s.xs[s.xs.length - 1] > xMax) xMax = s.xs[s.xs.length - 1];
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return;
    if (xMin === xMax) {
      xMin -= 1;
      xMax += 1;
    }

    // Compute Y ranges per scale (left = "y", right = "y2").
    const leftValues: number[] = [];
    const rightValues: number[] = [];
    seriesData.forEach((sd, i) => {
      const def = seriesDefs[i];
      const target = def?.yAxis === 'right' ? rightValues : leftValues;
      for (let j = 0; j < sd.ys.length; j++) {
        const v = sd.ys[j];
        if (Number.isFinite(v)) target.push(v);
      }
    });
    const leftRange = robustRange(leftValues);
    const rightRange = robustRange(rightValues);

    // Build series (mode 2): index 0 is the X reference (must exist).
    const uplotSeries: uPlot.Series[] = [
      {},
      ...seriesDefs.map((def, i) => {
        const color = SERIES_COLORS[i % SERIES_COLORS.length];
        const scale = def.yAxis === 'right' ? 'y2' : 'y';
        const baseSeries: uPlot.Series = {
          label: def.attribute,
          scale,
          stroke: color,
          width: visual.mode === 'points' ? 0 : Math.max(1, visual.lineWidth),
          points: {
            show: visual.mode === 'points' || visual.pointRadius > 0,
            size: Math.max(2, visual.mode === 'points' ? Math.max(visual.pointRadius || 4, 4) : visual.pointRadius),
            stroke: '#0f172a',
            fill: color,
            width: 1,
          },
          paths: uPlot.paths.linear?.(),
          spanGaps: true,
        };
        // Pretty hover marker — we render our own tooltip but keep cursor point.
        return baseSeries;
      }),
    ];

    const opts: uPlot.Options = {
      width: container.clientWidth || 800,
      height: container.clientHeight || 400,
      mode: 2,
      pxAlign: false,
      legend: { show: false },
      scales: {
        x: {
          time: true,
          range: () => [xMin, xMax],
        },
        y: {
          range: () => leftRange ?? [0, 1],
        },
        y2: {
          range: () => rightRange ?? [0, 1],
        },
      },
      axes: [
        {
          stroke: TEXT_MUTED,
          grid: { stroke: GRID_RGBA, width: 1 },
          ticks: { stroke: 'rgba(148,163,184,0.20)', size: 4 },
          font: '11px ui-sans-serif, system-ui',
        },
        {
          scale: 'y',
          stroke: TEXT_MUTED,
          grid: { stroke: GRID_RGBA, width: 1 },
          ticks: { stroke: 'rgba(148,163,184,0.20)', size: 4 },
          size: 50,
          font: '11px ui-sans-serif, system-ui',
        },
        {
          scale: 'y2',
          side: 1,
          stroke: TEXT_MUTED,
          grid: { show: false },
          ticks: { stroke: 'rgba(148,163,184,0.20)', size: 4 },
          size: 50,
          font: '11px ui-sans-serif, system-ui',
        },
      ],
      cursor: {
        x: true,
        y: false,
        drag: { x: true, y: false, setScale: true },
        points: {
          show: true,
          size: 6,
          stroke: (u, i) => (u.series[i].stroke as string) ?? '#22c55e',
          fill: '#0f172a',
          width: 2,
        },
      },
      series: uplotSeries,
      padding: [16, 16, 6, 6],
      hooks: {
        setCursor: [
          (u: uPlot) => {
            const left = u.cursor.left ?? -1;
            const top = u.cursor.top ?? -1;
            if (left < 0 || top < 0) {
              setTooltip((t) => (t.visible ? { ...t, visible: false } : t));
              return;
            }
            const xEpoch = u.posToVal(left, 'x');
            if (!Number.isFinite(xEpoch)) {
              setTooltip((t) => (t.visible ? { ...t, visible: false } : t));
              return;
            }
            const rows: TooltipState['rows'] = [];
            seriesData.forEach((sd, i) => {
              const def = seriesDefs[i];
              const nearest = nearestY(sd, xEpoch);
              if (nearest && Number.isFinite(nearest.y)) {
                rows.push({
                  label: def.attribute,
                  color: SERIES_COLORS[i % SERIES_COLORS.length],
                  value: nearest.y,
                  xEpoch: nearest.x,
                });
              }
            });
            if (rows.length === 0) {
              setTooltip((t) => (t.visible ? { ...t, visible: false } : t));
              return;
            }
            // Show tooltip near cursor; auto-flip if too close to right edge.
            const flipRight = left > (u.bbox.left + u.bbox.width - 200);
            setTooltip({
              visible: true,
              left: flipRight ? left - 12 : left + 12,
              top: Math.max(8, top - 8),
              xEpoch,
              rows,
            });
          },
        ],
      },
    };

    // Mode-2 data: [null, [xs, ys], [xs, ys], ...]
    const data = [null as unknown as number[], ...seriesData.map((sd) => [Array.from(sd.xs), Array.from(sd.ys)] as unknown as uPlot.AlignedData)] as unknown as uPlot.AlignedData;

    if (plotRef.current) {
      plotRef.current.destroy();
      plotRef.current = null;
    }
    const plot = new uPlot(opts, data, container);
    plotRef.current = plot;

    // Resize observer for fluid layout.
    const ro = new ResizeObserver(() => {
      if (!plotRef.current || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        plotRef.current.setSize({ width: w, height: h });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (plotRef.current === plot) {
        plot.destroy();
        plotRef.current = null;
      }
    };
  }, [status, visual.lineWidth, visual.mode, visual.pointRadius]);

  const patchAppearance = useCallback(
    (partial: Partial<ChartAppearance>) => {
      if (!onAppearanceChange) return;
      onAppearanceChange(panelId, { ...visual, ...partial });
    },
    [onAppearanceChange, panelId, visual]
  );

  const summaryLabel = series.length === 1
    ? series[0].attribute
    : t('canvasPanel.multiSeries', { count: series.length });

  // Aggregate stats footer: prefer first series.
  const primaryStats = perSeriesStats[0] ?? null;

  return (
    <div className="relative w-full h-full bg-slate-950/30 flex flex-col min-h-0">
      {/* Plot container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Status overlay (loading / empty / error) */}
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <span
            className={
              status === 'error'
                ? 'px-3 py-1.5 rounded-full bg-red-950/60 border border-red-500/40 text-red-200 text-xs'
                : 'px-3 py-1.5 rounded-full bg-slate-800/70 border border-slate-600/40 text-slate-200 text-xs'
            }
          >
            {status === 'loading' && t('canvasPanel.loading')}
            {status === 'empty' && t('canvasPanel.noData')}
            {status === 'error' && t('canvasPanel.errorLoad')}
          </span>
        </div>
      )}

      {/* Settings gear */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSettingsOpen((v) => !v);
        }}
        className="absolute top-1.5 left-1.5 z-30 p-1 rounded-md text-slate-500 hover:text-slate-100 hover:bg-slate-800/70 transition-colors"
        title={t('canvasPanel.chartStyle')}
        aria-label={t('canvasPanel.chartStyle')}
      >
        <Settings2 size={14} />
      </button>

      {settingsOpen && (
        <div
          className="absolute top-9 left-1.5 z-30 px-2.5 py-2 flex flex-col gap-2 text-[11px] text-slate-100 rounded-md bg-slate-950/90 backdrop-blur-md border border-slate-700/60 shadow-xl"
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
                  <span
                    className="flex items-center gap-1.5 text-slate-300 truncate max-w-[140px]"
                    title={s.attribute}
                  >
                    <span
                      aria-hidden
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: SERIES_COLORS[idx % SERIES_COLORS.length] }}
                    />
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

      {/* Footer */}
      {status === 'ready' && (
        <div className="absolute bottom-1 left-2 right-2 z-20 flex items-center gap-3 text-[10px] text-slate-400 pointer-events-none">
          {series.length > 1 ? (
            <div className="flex items-center gap-2 truncate">
              {series.map((s, i) => (
                <span key={`${s.entityId}-${s.attribute}`} className="flex items-center gap-1 text-slate-300 truncate">
                  <span
                    aria-hidden
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                  />
                  <span className="truncate max-w-[140px]">{s.attribute}</span>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-slate-300 font-medium truncate" title={summaryLabel}>
              {summaryLabel}
            </span>
          )}
          {primaryStats && (
            <span className="tabular-nums whitespace-nowrap">
              <span className="text-slate-500">{t('canvasPanel.statMin')}</span> {formatNumberShort(primaryStats.min)}
              <span className="text-slate-500 ml-2">{t('canvasPanel.statMax')}</span> {formatNumberShort(primaryStats.max)}
              <span className="text-slate-500 ml-2">{t('canvasPanel.statAvg')}</span> {formatNumberShort(primaryStats.mean)}
              <span className="text-slate-500 ml-2">{t('canvasPanel.statLast')}</span> {formatNumberShort(primaryStats.last)}
            </span>
          )}
          <span className="tabular-nums text-slate-500 ml-auto whitespace-nowrap">
            {perSeriesStats.reduce((acc, s) => acc + (s?.count ?? 0), 0)} pts
          </span>
        </div>
      )}

      {/* Tooltip */}
      {tooltip.visible && status === 'ready' && (
        <div
          className="absolute z-30 pointer-events-none px-2 py-1.5 rounded-md bg-slate-950/95 border border-slate-700/70 shadow-lg text-[11px] text-slate-100 backdrop-blur-md"
          style={{ left: tooltip.left, top: tooltip.top, transform: 'translate(-50%, -100%)', maxWidth: 280 }}
        >
          <div className="text-slate-400 text-[10px] mb-1 tabular-nums">
            {formatDateLocal(tooltip.xEpoch)}
          </div>
          {tooltip.rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2 leading-tight">
              <span
                aria-hidden
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: r.color }}
              />
              <span className="truncate text-slate-200" style={{ maxWidth: 140 }} title={r.label}>
                {r.label}
              </span>
              <span className="ml-auto tabular-nums text-slate-100 font-medium">
                {formatNumberShort(r.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const DataCanvasPanelMemo = React.memo(DataCanvasPanel);
