/**
 * PanelChart — uPlot mode-1, created manually in a plain div.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

import type { WorkerSeriesPayload } from '../../workers/contracts/datahubWorkerV2';
import type { ChartAppearance, ChartSeriesDef } from '../../types/dashboard';

const TEXT_AXIS = '#cbd5e1';
const TEXT_AXIS_LEFT = '#34d399';
const TEXT_AXIS_RIGHT = '#c084fc';
const GRID_RGBA = 'rgba(148,163,184,0.14)';

export interface PanelChartProps {
  series: ChartSeriesDef[];
  workerSeries: WorkerSeriesPayload[];
  appearance: ChartAppearance;
  effectiveScales: Array<'y' | 'y2'>;
  colors: string[];
  leftRange: [number, number] | null;
  rightRange: [number, number] | null;
  hasRightAxis: boolean;
  leftUnit: string;
  rightUnit: string;
  onCursor?: (info: { left: number; top: number; xEpoch: number } | null) => void;
  onVisibleXChange?: (range: { min: number; max: number }) => void;
  zoomCommand?: { range: { min: number; max: number } | null; reset?: boolean; nonce: number };
  plotInstanceRef?: React.MutableRefObject<uPlot | null>;
  onLifecycleTick?: () => void;
}

function formatNumberShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

function buildSplitsFor(range: [number, number] | null, step: number): ((u: uPlot, axisIdx: number) => number[]) {
  return (u, axisIdx) => {
    const sc = u.axes[axisIdx]?.scale ?? 'y';
    const scale = u.scales[sc];
    const lo = scale.min ?? range?.[0];
    const hi = scale.max ?? range?.[1];
    if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return [];
    const out: number[] = [];
    const start = Math.ceil(lo / step) * step;
    for (let v = start; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
    return out;
  };
}

function buildAlignedData(ws: WorkerSeriesPayload[]): uPlot.AlignedData | null {
  if (ws.length === 0) return null;
  if (ws.length === 1) {
    const s = ws[0];
    if (s.xs.length === 0) return null;
    return [Array.from(s.xs), Array.from(s.ys)];
  }
  const tsSet = new Set<number>();
  for (const s of ws) for (let i = 0; i < s.xs.length; i++) tsSet.add(s.xs[i]);
  const xs = Array.from(tsSet).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const xIndex = new Map<number, number>();
  for (let i = 0; i < xs.length; i++) xIndex.set(xs[i], i);
  const yArrays = ws.map(() => new Array<number>(xs.length).fill(Number.NaN));
  for (let sIdx = 0; sIdx < ws.length; sIdx++) {
    const s = ws[sIdx];
    for (let i = 0; i < s.xs.length; i++) {
      const dst = xIndex.get(s.xs[i]);
      if (dst != null) yArrays[sIdx][dst] = s.ys[i];
    }
  }
  return [xs, ...yArrays];
}

export const PanelChart: React.FC<PanelChartProps> = ({
  series,
  workerSeries,
  appearance,
  effectiveScales,
  colors,
  leftRange,
  rightRange,
  hasRightAxis,
  leftUnit,
  rightUnit,
  onCursor,
  onVisibleXChange,
  zoomCommand,
  plotInstanceRef,
  onLifecycleTick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;
  const onVisibleXChangeRef = useRef(onVisibleXChange);
  onVisibleXChangeRef.current = onVisibleXChange;

  const data = useMemo(() => {
    if (workerSeries.length !== series.length ||
        workerSeries.length !== effectiveScales.length ||
        workerSeries.length !== colors.length) return null;
    return buildAlignedData(workerSeries);
  }, [workerSeries, series.length, effectiveScales.length, colors.length]);

  const xDomain = useMemo<[number, number] | null>(() => {
    if (!data) return null;
    const xs = data[0];
    if (!xs || xs.length === 0) return null;
    const xMin = xs[0], xMax = xs[xs.length - 1];
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return null;
    if (xMin === xMax) return [xMin - 1, xMax + 1];
    return [xMin, xMax];
  }, [data]);

  const leftStep = appearance.yScaleMode === 'manual' ? appearance.yScaleManual?.left?.step : undefined;
  const rightStep = appearance.yScaleMode === 'manual' ? appearance.yScaleManual?.right?.step : undefined;

  // Create uPlot manually — one shot, no hook
  useEffect(() => {
    const c = containerRef.current;
    if (!c || !data) return;

    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w <= 0 || h <= 0) return;

    const fallback: [number, number] = [0, 1];
    const xR = xDomain ?? fallback;
    const opts: uPlot.Options = {
      width: w,
      height: h,
      pxAlign: false,
      legend: { show: false },
      scales: {
        x: { time: true, range: () => xR },
        y: { range: () => leftRange ?? fallback },
        y2: { range: () => rightRange ?? fallback },
      },
      series: [
        {},
        ...series.map((def, i) => ({
          label: def.attribute,
          scale: effectiveScales[i],
          stroke: colors[i] ?? '#34d399',
          width: appearance.mode === 'points' ? 0 : Math.max(1, appearance.lineWidth),
          points: {
            show: appearance.mode === 'points' || (appearance.pointRadius ?? 0) > 0,
            size: Math.max(2, appearance.mode === 'points' ? Math.max(appearance.pointRadius || 4, 4) : appearance.pointRadius),
            stroke: '#0f172a',
            fill: colors[i] ?? '#34d399',
            width: 1,
          },
          paths: uPlot.paths.linear?.(),
          spanGaps: true,
        } as uPlot.Series)),
      ],
      axes: [
        { stroke: TEXT_AXIS, grid: { stroke: GRID_RGBA, width: 1 }, ticks: { stroke: 'rgba(203,213,225,0.30)', size: 4 }, font: '12px ui-sans-serif, system-ui', gap: 8 },
        {
          scale: 'y', stroke: TEXT_AXIS_LEFT, grid: { stroke: GRID_RGBA, width: 1 },
          ticks: { stroke: 'rgba(52,211,153,0.30)', size: 4 }, size: 60,
          font: '12px ui-sans-serif, system-ui', gap: 8,
          values: leftUnit ? (_u: uPlot, splits: number[]) => splits.map(v => `${formatNumberShort(v)} ${leftUnit}`) : undefined,
          ...(leftStep && leftStep > 0 ? { incrs: [leftStep] as uPlot.Axis.Incrs, splits: buildSplitsFor(leftRange, leftStep) } : {}),
        },
        ...(hasRightAxis ? [{
          scale: 'y2' as const, side: 1 as const, stroke: TEXT_AXIS_RIGHT, grid: { show: false },
          ticks: { stroke: 'rgba(192,132,252,0.30)', size: 4 }, size: 60,
          font: '12px ui-sans-serif, system-ui', gap: 8,
          values: rightUnit ? (_u: uPlot, splits: number[]) => splits.map(v => `${formatNumberShort(v)} ${rightUnit}`) : undefined,
          ...(rightStep && rightStep > 0 ? { incrs: [rightStep] as uPlot.Axis.Incrs, splits: buildSplitsFor(rightRange, rightStep) } : {}),
        } as uPlot.Axis] : []),
      ],
      padding: [28, 4, 4, 4] as [number, number, number, number],
      cursor: { x: true, y: false, drag: { x: true, y: false, setScale: true }, points: { show: true, size: 6, stroke: (u, i) => (u.series[i].stroke as string) ?? '#34d399', fill: '#0f172a', width: 2 } },
      hooks: {
        setCursor: [(u: uPlot) => {
          const l = u.cursor.left ?? -1, t = u.cursor.top ?? -1;
          if (l < 0 || t < 0) { onCursorRef.current?.(null); return; }
          const x = u.posToVal(l, 'x');
          if (!Number.isFinite(x)) { onCursorRef.current?.(null); return; }
          onCursorRef.current?.({ left: l, top: t, xEpoch: x });
          // Null the cached rect so RGL transform changes are picked up next move
          (u as any).syncRect(true);
        }],
        setScale: [(u: uPlot, key: string) => {
          if (key !== 'x') return;
          const s = u.scales.x;
          if (typeof s.min === 'number' && typeof s.max === 'number' && Number.isFinite(s.min) && Number.isFinite(s.max) && s.max > s.min) {
            onVisibleXChangeRef.current?.({ min: s.min, max: s.max });
          }
        }],
      },
    };

    const plot = new uPlot(opts, data, c);
    plotRef.current = plot;
    if (plotInstanceRef) plotInstanceRef.current = plot;
    onLifecycleTick?.();
    (window as unknown as { __nkz_chart?: unknown }).__nkz_chart = plot;

    // Keep canvas sized to container
    const ro = new ResizeObserver(() => {
      const inst = plotRef.current;
      if (!inst) return;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      if (cw > 0 && ch > 0 && (cw !== inst.width || ch !== inst.height)) {
        inst.setSize({ width: cw, height: ch });
      }
    });
    ro.observe(c);

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
      if (plotInstanceRef) plotInstanceRef.current = null;
    };
    // Rebuild when data, series shape, or appearance changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, series.length, appearance.mode, appearance.yScaleMode, effectiveScales.join(','), hasRightAxis, leftStep, rightStep]);

  // Imperative scale updates
  useEffect(() => {
    if (plotRef.current && leftRange) plotRef.current.setScale('y', { min: leftRange[0], max: leftRange[1] });
  }, [leftRange]);
  useEffect(() => {
    if (plotRef.current && rightRange && hasRightAxis) plotRef.current.setScale('y2', { min: rightRange[0], max: rightRange[1] });
  }, [rightRange, hasRightAxis]);

  // Zoom
  useEffect(() => {
    if (!zoomCommand || !plotRef.current) return;
    if (zoomCommand.reset) {
      const xs = data?.[0] as number[] | undefined;
      if (xs && xs.length > 0) plotRef.current.setScale('x', { min: xs[0], max: xs[xs.length - 1] });
      return;
    }
    if (zoomCommand.range) plotRef.current.setScale('x', { min: zoomCommand.range.min, max: zoomCommand.range.max });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomCommand?.nonce]);

  return <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%' }} />;
};
