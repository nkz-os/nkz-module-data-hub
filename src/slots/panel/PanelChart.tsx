/**
 * PanelChart — uPlot mode-2 renderer fed by V2.1 worker payloads.
 *
 * Pure rendering surface. State machine (loading/empty/error) lives in the
 * orchestrator; the chart only mounts when status === 'ready' and series.length>0.
 *
 * Why mode 2: each series owns its own xs/ys array. With V2.1 there is no
 * cross-series alignment NaN, so spanGaps:false is honest — a NaN in ys means
 * a real sensor outage, not an alignment hole.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';

import type { WorkerSeriesPayload } from '../../workers/contracts/datahubWorkerV2';
import type { ChartAppearance, ChartSeriesDef } from '../../types/dashboard';
import { useUPlotInstance } from './hooks/useUPlotInstance';

const TEXT_AXIS = '#cbd5e1';
const TEXT_AXIS_LEFT = '#34d399';
const TEXT_AXIS_RIGHT = '#c084fc';
const GRID_RGBA = 'rgba(148,163,184,0.14)';

export interface PanelChartProps {
  series: ChartSeriesDef[];
  workerSeries: WorkerSeriesPayload[];
  appearance: ChartAppearance;
  /** Effective scale per series (computed by orchestrator: respects user override + auto-distribute). */
  effectiveScales: Array<'y' | 'y2'>;
  /** Resolved colour per series (after user override and palette assignment). */
  colors: string[];
  /** Y range per axis (orchestrator-computed; varies by yScaleMode). */
  leftRange: [number, number] | null;
  rightRange: [number, number] | null;
  /** Should the right axis be rendered at all? */
  hasRightAxis: boolean;
  /** Unit summary per axis to render in tick values. */
  leftUnit: string;
  rightUnit: string;
  /** Cursor moved → orchestrator uses this to update tooltip + emit time-hover. */
  onCursor?: (info: { left: number; top: number; xEpoch: number } | null) => void;
  /** Fired whenever uPlot updates the X scale (zoom/pan). Epoch seconds. */
  onVisibleXChange?: (range: { min: number; max: number }) => void;
  /**
   * Forwarded zoom commands from the toolbar / right-click handler.
   * When this changes (and includes a non-null range), the chart calls
   * u.setScale('x', range). Pass `{ reset: true }` to restore the full data
   * domain. Setting both null is a no-op.
   */
  zoomCommand?: { range: { min: number; max: number } | null; reset?: boolean; nonce: number };
  /** Exposes the live uPlot instance so overlays can valToPos against scales. */
  plotInstanceRef?: React.MutableRefObject<uPlot | null>;
  /** Bumped after each lifecycle event (init/resize) so overlays re-render. */
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
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;
  const onVisibleXChangeRef = useRef(onVisibleXChange);
  onVisibleXChangeRef.current = onVisibleXChange;

  // Build a stable reset key so uPlot is rebuilt only when series shape changes.
  const resetKey = useMemo(() => {
    const seriesShape = workerSeries.map((s) => s.key).join('|');
    return [
      seriesShape,
      appearance.mode,
      hasRightAxis ? '2axes' : '1axis',
      effectiveScales.join(''),
      leftUnit,
      rightUnit,
    ].join('::');
  }, [workerSeries, appearance.mode, hasRightAxis, effectiveScales, leftUnit, rightUnit]);

  // Build uPlot mode-2 data only when all input arrays are aligned in length;
  // otherwise return null and skip render. This avoids 't[g] is undefined'
  // from inside uPlot when, for example, a newly added series exists in
  // `series` but its worker payload hasn't landed yet.
  const data = useMemo<uPlot.AlignedData | null>(() => {
    if (workerSeries.length === 0) return null;
    if (
      workerSeries.length !== series.length ||
      workerSeries.length !== effectiveScales.length ||
      workerSeries.length !== colors.length
    ) {
      return null;
    }
    return [
      null as unknown as number[],
      ...workerSeries.map(
        (s) => [Array.from(s.xs), Array.from(s.ys)] as unknown as uPlot.AlignedData
      ),
    ] as unknown as uPlot.AlignedData;
  }, [workerSeries, series.length, effectiveScales.length, colors.length]);

  // Compute global X domain across all series.
  const xDomain = useMemo<[number, number] | null>(() => {
    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    for (const s of workerSeries) {
      if (s.xs.length === 0) continue;
      if (s.xs[0] < xMin) xMin = s.xs[0];
      if (s.xs[s.xs.length - 1] > xMax) xMax = s.xs[s.xs.length - 1];
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return null;
    if (xMin === xMax) return [xMin - 1, xMax + 1];
    return [xMin, xMax];
  }, [workerSeries]);

  const options = useMemo<uPlot.Options>(() => {
    const fallbackRange: [number, number] = [0, 1];
    const xRange = xDomain ?? fallbackRange;

    return {
      width: 800,
      height: 400,
      mode: 2,
      pxAlign: false,
      legend: { show: false },
      scales: {
        x: { time: true, range: () => xRange },
        y: { range: () => leftRange ?? fallbackRange },
        y2: { range: () => rightRange ?? fallbackRange },
      },
      series: [
        {},
        ...series.map((def, i) => {
          const color = colors[i] ?? '#34d399';
          const baseSeries: uPlot.Series = {
            label: def.attribute,
            scale: effectiveScales[i],
            stroke: color,
            width: appearance.mode === 'points' ? 0 : Math.max(1, appearance.lineWidth),
            points: {
              show:
                appearance.mode === 'points' || (appearance.pointRadius ?? 0) > 0,
              size: Math.max(
                2,
                appearance.mode === 'points'
                  ? Math.max(appearance.pointRadius || 4, 4)
                  : appearance.pointRadius
              ),
              stroke: '#0f172a',
              fill: color,
              width: 1,
            },
            paths: uPlot.paths.linear?.(),
            spanGaps: false,
          };
          return baseSeries;
        }),
      ],
      axes: [
        {
          stroke: TEXT_AXIS,
          grid: { stroke: GRID_RGBA, width: 1 },
          ticks: { stroke: 'rgba(203,213,225,0.30)', size: 4 },
          font: '11px ui-sans-serif, system-ui',
          gap: 6,
        },
        {
          scale: 'y',
          stroke: TEXT_AXIS_LEFT,
          grid: { stroke: GRID_RGBA, width: 1 },
          ticks: { stroke: 'rgba(52,211,153,0.30)', size: 4 },
          size: 60,
          font: '11px ui-sans-serif, system-ui',
          gap: 6,
          values: leftUnit
            ? (_u, splits) => splits.map((v) => `${formatNumberShort(v)} ${leftUnit}`)
            : undefined,
        },
        ...(hasRightAxis
          ? [
              {
                scale: 'y2',
                side: 1 as const,
                stroke: TEXT_AXIS_RIGHT,
                grid: { show: false },
                ticks: { stroke: 'rgba(192,132,252,0.30)', size: 4 },
                size: 60,
                font: '11px ui-sans-serif, system-ui',
                gap: 6,
                values: rightUnit
                  ? (_u: uPlot, splits: number[]) =>
                      splits.map((v) => `${formatNumberShort(v)} ${rightUnit}`)
                  : undefined,
              } as uPlot.Axis,
            ]
          : []),
      ],
      cursor: {
        x: true,
        y: false,
        drag: { x: true, y: false, setScale: true },
        points: {
          show: true,
          size: 6,
          stroke: (u, i) => (u.series[i].stroke as string) ?? '#34d399',
          fill: '#0f172a',
          width: 2,
        },
      },
      padding: [12, hasRightAxis ? 8 : 16, 4, 4] as [number, number, number, number],
      hooks: {
        setCursor: [
          (u: uPlot) => {
            const left = u.cursor.left ?? -1;
            const top = u.cursor.top ?? -1;
            if (left < 0 || top < 0) {
              onCursorRef.current?.(null);
              return;
            }
            const xEpoch = u.posToVal(left, 'x');
            if (!Number.isFinite(xEpoch)) {
              onCursorRef.current?.(null);
              return;
            }
            onCursorRef.current?.({ left, top, xEpoch });
          },
        ],
        setScale: [
          (u: uPlot, key: string) => {
            if (key !== 'x') return;
            const scale = u.scales.x;
            const min = scale?.min;
            const max = scale?.max;
            if (
              typeof min === 'number' &&
              typeof max === 'number' &&
              Number.isFinite(min) &&
              Number.isFinite(max) &&
              max > min
            ) {
              onVisibleXChangeRef.current?.({ min, max });
            }
          },
        ],
      },
    } as uPlot.Options;
  }, [
    appearance.mode,
    appearance.lineWidth,
    appearance.pointRadius,
    series,
    workerSeries,
    effectiveScales,
    colors,
    leftRange,
    rightRange,
    leftUnit,
    rightUnit,
    hasRightAxis,
    xDomain,
  ]);

  const plotRef = useUPlotInstance({
    containerRef,
    data,
    options,
    resetKey,
  });

  // Expose the instance to the orchestrator (overlays).
  useEffect(() => {
    if (plotInstanceRef) plotInstanceRef.current = plotRef.current;
    onLifecycleTick?.();
  }, [resetKey, plotInstanceRef, onLifecycleTick, plotRef]);

  // Y range is read at uPlot init via the `range` callback closure. When
  // leftRange / rightRange update post-init (e.g. user toggles Y-scale mode,
  // adds/removes a series, switches axis), the closure keeps the *initial*
  // range — uPlot never sees the new value because we don't bump resetKey on
  // range changes (would force an expensive rebuild). Instead, drive the
  // scale imperatively when the range prop changes.
  useEffect(() => {
    const inst = plotRef.current;
    if (!inst || !leftRange) return;
    inst.setScale('y', { min: leftRange[0], max: leftRange[1] });
  }, [leftRange, plotRef]);

  useEffect(() => {
    const inst = plotRef.current;
    if (!inst || !rightRange || !hasRightAxis) return;
    inst.setScale('y2', { min: rightRange[0], max: rightRange[1] });
  }, [rightRange, hasRightAxis, plotRef]);

  // Apply incoming zoom commands (reset or set range) without rebuilding uPlot.
  useEffect(() => {
    if (!zoomCommand) return;
    const inst = plotRef.current;
    if (!inst) return;
    if (zoomCommand.reset) {
      // Full data domain is currently options.scales.x.range() — undefined → uPlot
      // recomputes to data extents.
      const xs = data?.[1] as number[] | undefined;
      if (xs && xs.length > 0) {
        inst.setScale('x', { min: xs[0], max: xs[xs.length - 1] });
      }
      return;
    }
    if (zoomCommand.range) {
      inst.setScale('x', { min: zoomCommand.range.min, max: zoomCommand.range.max });
    }
    // intentionally only re-run on nonce change — same command should not re-fire
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomCommand?.nonce]);

  return <div ref={containerRef} className="absolute inset-0" />;
};
