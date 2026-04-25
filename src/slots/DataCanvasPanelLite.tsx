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

const SERIES_COLORS = ['#34d399', '#c084fc', '#fbbf24', '#60a5fa', '#f87171', '#f472b6'];
const AXIS_LEFT_COLOR = '#34d399';   // emerald-400
const AXIS_RIGHT_COLOR = '#c084fc';  // purple-400
const TEXT_MUTED = '#cbd5e1';        // slate-300, brighter for legibility
const GRID_RGBA = 'rgba(148,163,184,0.14)';

/** Display unit by attribute name (best-effort). Empty string when unknown. */
const ATTRIBUTE_UNIT: Record<string, string> = {
  temperature: '°C', temp_avg: '°C', temp_min: '°C', temp_max: '°C',
  airTemperature: '°C', delta_t: '°C',
  humidity: '%', humidity_avg: '%', humidity_min: '%', humidity_max: '%',
  relativeHumidity: '%', soil_moisture: '%', soil_moisture_0_10cm: '%',
  precipitation: 'mm', precip_mm: 'mm', eto_mm: 'mm', et0: 'mm',
  solar_rad_w_m2: 'W/m²', radiation: 'W/m²', solarRadiation: 'W/m²',
  wind_speed: 'm/s', wind_speed_avg: 'm/s', wind_speed_max: 'm/s',
  wind_speed_ms: 'm/s', windSpeed: 'm/s',
  windDirection: '°',
  pressure: 'hPa', pressure_avg: 'hPa', pressure_hpa: 'hPa',
  atmosphericPressure: 'hPa',
  panelInclination: '°',
  gdd_accumulated: 'GDD',
};

function unitFor(attribute: string): string {
  return ATTRIBUTE_UNIT[attribute] ?? '';
}

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

/**
 * Auto-assign each series to left ('y') or right ('y2') axis based on data magnitude.
 *
 * Why: when two series with very different magnitudes share an axis (e.g. temperature 3–30
 * and windSpeed 0–1, both default to 'left'), the combined range squashes the smaller-range
 * series until it appears as a flat line near zero. This is *the* bug that produced the
 * "tiny spike at the bottom" rendering.
 *
 * Rule: respect explicit user choice ('right' is always honored). For everything else,
 * keep series 0 on left, place subsequent series on the right *only* when their magnitude
 * differs from a left-axis sibling by more than 5×. Compatible series (same units / same
 * magnitude) stay together.
 */
function distributeAxes(
  defs: ChartSeriesDef[],
  data: ParsedSeries[]
): Array<'y' | 'y2'> {
  const result: Array<'y' | 'y2'> = [];
  const leftMags: number[] = [];
  const rightMags: number[] = [];

  function magnitudeOf(series: ParsedSeries): number {
    if (!series || series.ys.length === 0) return 0;
    const vals: number[] = [];
    for (let i = 0; i < series.ys.length; i++) {
      const v = series.ys[i];
      if (Number.isFinite(v)) vals.push(Math.abs(v));
    }
    if (vals.length === 0) return 0;
    vals.sort((a, b) => a - b);
    return quantile(vals, 0.9);
  }

  function compatible(mag: number, refs: number[]): boolean {
    if (refs.length === 0) return true;
    for (const r of refs) {
      if (mag === 0 && r === 0) return true;
      if (r === 0 || mag === 0) continue;
      const ratio = Math.max(mag, r) / Math.min(mag, r);
      if (ratio <= 5) return true;
    }
    return false;
  }

  defs.forEach((def, i) => {
    const mag = magnitudeOf(data[i]);
    if (def.yAxis === 'right') {
      result.push('y2');
      rightMags.push(mag);
      return;
    }
    // 'left' or undefined → auto-distribute
    if (i === 0) {
      result.push('y');
      leftMags.push(mag);
      return;
    }
    if (compatible(mag, leftMags)) {
      result.push('y');
      leftMags.push(mag);
    } else if (compatible(mag, rightMags)) {
      result.push('y2');
      rightMags.push(mag);
    } else {
      // Fallback: try right axis if it has fewer series, otherwise left.
      if (rightMags.length < leftMags.length) {
        result.push('y2');
        rightMags.push(mag);
      } else {
        result.push('y');
        leftMags.push(mag);
      }
    }
  });
  return result;
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
  rows: Array<{ label: string; unit: string; color: string; value: number; xEpoch: number }>;
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

    // Auto-distribute series to left/right axis by magnitude (see distributeAxes for rationale).
    const effectiveScales = distributeAxes(seriesDefs, seriesData);

    // Compute Y ranges per scale using ONLY the series assigned to that scale.
    const leftValues: number[] = [];
    const rightValues: number[] = [];
    seriesData.forEach((sd, i) => {
      const target = effectiveScales[i] === 'y2' ? rightValues : leftValues;
      for (let j = 0; j < sd.ys.length; j++) {
        const v = sd.ys[j];
        if (Number.isFinite(v)) target.push(v);
      }
    });
    const leftRange = robustRange(leftValues);
    const rightRange = robustRange(rightValues);

    // Determine units per axis (from the series assigned to each).
    const leftUnits = new Set<string>();
    const rightUnits = new Set<string>();
    seriesDefs.forEach((def, i) => {
      const u = unitFor(def.attribute);
      if (!u) return;
      (effectiveScales[i] === 'y2' ? rightUnits : leftUnits).add(u);
    });
    const leftUnitLabel = Array.from(leftUnits).join(' / ');
    const rightUnitLabel = Array.from(rightUnits).join(' / ');
    const hasRightAxis = effectiveScales.includes('y2');

    // Build series (mode 2): index 0 is the X reference (must exist).
    const uplotSeries: uPlot.Series[] = [
      {},
      ...seriesDefs.map((def, i) => {
        const color = SERIES_COLORS[i % SERIES_COLORS.length];
        const scale = effectiveScales[i];
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
          ticks: { stroke: 'rgba(203,213,225,0.30)', size: 4 },
          font: '11px ui-sans-serif, system-ui',
          gap: 6,
        },
        {
          scale: 'y',
          stroke: AXIS_LEFT_COLOR,
          grid: { stroke: GRID_RGBA, width: 1 },
          ticks: { stroke: 'rgba(52,211,153,0.30)', size: 4 },
          size: 60,
          font: '11px ui-sans-serif, system-ui',
          gap: 6,
          values: leftUnitLabel
            ? (_u, splits) => splits.map((v) => `${formatNumberShort(v)} ${leftUnitLabel}`)
            : undefined,
        },
        ...(hasRightAxis
          ? [{
              scale: 'y2',
              side: 1 as const,
              stroke: AXIS_RIGHT_COLOR,
              grid: { show: false },
              ticks: { stroke: 'rgba(192,132,252,0.30)', size: 4 },
              size: 60,
              font: '11px ui-sans-serif, system-ui',
              gap: 6,
              values: rightUnitLabel
                ? (_u: uPlot, splits: number[]) => splits.map((v) => `${formatNumberShort(v)} ${rightUnitLabel}`)
                : undefined,
            } as uPlot.Axis]
          : []),
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
      padding: [12, hasRightAxis ? 8 : 16, 4, 4],
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
                  unit: unitFor(def.attribute),
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
    <div className="relative w-full h-full bg-gradient-to-br from-slate-900/60 via-slate-900/40 to-slate-950/60 rounded-md ring-1 ring-slate-800/60 overflow-hidden flex flex-col min-h-0">
      {/* Plot container — leaves a 28px band at the bottom for the footer so the trace never overlaps it. */}
      <div ref={containerRef} className="absolute inset-x-0 top-0 bottom-7" />

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

      {/* Footer: legend + primary stats + total points. Sits in a band below the chart canvas. */}
      {status === 'ready' && (
        <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-3 px-3 py-1.5 bg-gradient-to-t from-slate-950/85 to-transparent text-[11px] text-slate-300 pointer-events-none">
          {series.length > 1 ? (
            <div className="flex items-center gap-3 truncate">
              {series.map((s, i) => (
                <span key={`${s.entityId}-${s.attribute}`} className="flex items-center gap-1.5 truncate">
                  <span
                    aria-hidden
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-slate-900"
                    style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                  />
                  <span className="truncate max-w-[160px] text-slate-200">{s.attribute}</span>
                  {unitFor(s.attribute) && <span className="text-slate-500 text-[10px]">{unitFor(s.attribute)}</span>}
                </span>
              ))}
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-slate-200 font-medium truncate" title={summaryLabel}>
              <span
                aria-hidden
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-slate-900"
                style={{ background: SERIES_COLORS[0] }}
              />
              {summaryLabel}
              {series.length === 1 && unitFor(series[0].attribute) && (
                <span className="text-slate-500 text-[10px] font-normal">{unitFor(series[0].attribute)}</span>
              )}
            </span>
          )}
          {primaryStats && (
            <span className="tabular-nums whitespace-nowrap font-mono text-[10px]">
              <span className="text-slate-500">{t('canvasPanel.statMin')}</span>
              <span className="text-slate-100 ml-1">{formatNumberShort(primaryStats.min)}</span>
              <span className="text-slate-500 ml-2.5">{t('canvasPanel.statMax')}</span>
              <span className="text-slate-100 ml-1">{formatNumberShort(primaryStats.max)}</span>
              <span className="text-slate-500 ml-2.5">{t('canvasPanel.statAvg')}</span>
              <span className="text-slate-100 ml-1">{formatNumberShort(primaryStats.mean)}</span>
              <span className="text-slate-500 ml-2.5">{t('canvasPanel.statLast')}</span>
              <span className="text-slate-100 ml-1">{formatNumberShort(primaryStats.last)}</span>
            </span>
          )}
          <span className="tabular-nums text-slate-500 ml-auto whitespace-nowrap font-mono text-[10px]">
            {perSeriesStats.reduce((acc, s) => acc + (s?.count ?? 0), 0)} pts
          </span>
        </div>
      )}

      {/* Tooltip */}
      {tooltip.visible && status === 'ready' && (
        <div
          className="absolute z-30 pointer-events-none px-2.5 py-2 rounded-lg bg-slate-900/95 border border-slate-700/80 shadow-2xl text-[11px] text-slate-100 backdrop-blur-md"
          style={{ left: tooltip.left, top: tooltip.top, transform: 'translate(-50%, -100%)', maxWidth: 300 }}
        >
          <div className="text-slate-400 text-[10px] mb-1.5 tabular-nums font-mono">
            {formatDateLocal(tooltip.xEpoch)}
          </div>
          <div className="flex flex-col gap-1">
            {tooltip.rows.map((r) => (
              <div key={r.label} className="flex items-center gap-2 leading-tight">
                <span
                  aria-hidden
                  className="inline-block w-2.5 h-2.5 rounded-full ring-1 ring-slate-900"
                  style={{ background: r.color }}
                />
                <span className="truncate text-slate-200" style={{ maxWidth: 150 }} title={r.label}>
                  {r.label}
                </span>
                <span className="ml-auto tabular-nums text-slate-50 font-semibold whitespace-nowrap">
                  {formatNumberShort(r.value)}
                  {r.unit && <span className="text-slate-400 font-normal ml-0.5">{r.unit}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const DataCanvasPanelMemo = React.memo(DataCanvasPanel);
