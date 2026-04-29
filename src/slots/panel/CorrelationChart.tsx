/**
 * CorrelationChart — scatter plot of two series (X vs Y) with Pearson r overlay.
 *
 * Used when ChartAppearance.viewMode === 'correlation'. Renders one uPlot
 * mode-1 surface with numeric x and y scales (not time), points-only, plus a
 * floating r/n badge in the corner.
 */

import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import uPlotCSS from 'uplot/dist/uPlot.min.css?inline';

if (typeof document !== 'undefined') {
  const STYLE_ID = '__nkz_uplot_css__';
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = uPlotCSS;
    document.head.appendChild(s);
  }
}

import type { WorkerSeriesPayload } from '../../workers/contracts/datahubWorkerV2';
import { pearsonCorrelation } from './derivedSeries';

const TEXT_AXIS = '#cbd5e1';
const GRID_RGBA = 'rgba(148,163,184,0.10)';

export interface CorrelationChartProps {
  xSeries: WorkerSeriesPayload | undefined;
  ySeries: WorkerSeriesPayload | undefined;
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  pointColor: string;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

export const CorrelationChart: React.FC<CorrelationChartProps> = ({
  xSeries,
  ySeries,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
  pointColor,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  const correlation = React.useMemo(
    () => pearsonCorrelation(xSeries, ySeries),
    [xSeries, ySeries]
  );

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w <= 0 || h <= 0) return;
    if (!correlation || correlation.pairs.length < 2) return;

    const xs = correlation.pairs.map((p) => p.x);
    const ys = correlation.pairs.map((p) => p.y);

    const opts: uPlot.Options = {
      width: w,
      height: h,
      pxAlign: false,
      legend: { show: false },
      scales: {
        x: { time: false },
        y: {},
      },
      series: [
        {},
        {
          label: yLabel,
          stroke: pointColor,
          width: 0,
          points: { show: true, size: 5, stroke: pointColor, fill: pointColor, width: 1 },
          paths: () => null,
          spanGaps: true,
        },
      ],
      axes: [
        {
          stroke: TEXT_AXIS,
          grid: { stroke: GRID_RGBA, width: 1 },
          ticks: { stroke: 'rgba(203,213,225,0.30)', size: 4 },
          font: '12px ui-sans-serif, system-ui',
          gap: 8,
          values: (_u, splits) => splits.map((v) => (xUnit ? `${fmt(v)} ${xUnit}` : fmt(v))),
        },
        {
          scale: 'y',
          stroke: TEXT_AXIS,
          grid: { stroke: GRID_RGBA, width: 1 },
          ticks: { stroke: 'rgba(203,213,225,0.30)', size: 4 },
          size: 60,
          font: '12px ui-sans-serif, system-ui',
          gap: 8,
          values: (_u, splits) => splits.map((v) => (yUnit ? `${fmt(v)} ${yUnit}` : fmt(v))),
        },
      ],
      padding: [28, 12, 4, 4] as [number, number, number, number],
      cursor: { x: true, y: true, drag: { x: false, y: false } },
    };

    const plot = new uPlot(opts, [xs, ys], c);
    plotRef.current = plot;

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
    };
  }, [correlation, pointColor, xLabel, yLabel, xUnit, yUnit]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {/* X / Y axis labels */}
      <div className="absolute bottom-7 left-1/2 -translate-x-1/2 text-[10px] text-slate-400 font-mono pointer-events-none">
        X: {xLabel}
        {xUnit && <span className="text-slate-500"> ({xUnit})</span>}
      </div>
      <div
        className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-mono pointer-events-none"
        style={{ writingMode: 'vertical-rl', transform: 'translateY(-50%) rotate(180deg)' }}
      >
        Y: {yLabel}
        {yUnit && <span className="text-slate-500"> ({yUnit})</span>}
      </div>
      {/* Pearson r badge */}
      {correlation && (
        <div className="absolute top-12 right-3 px-2 py-1 rounded bg-slate-950/90 border border-slate-700/70 shadow-lg text-[11px] font-mono tabular-nums pointer-events-none">
          <span className="text-slate-400">r=</span>
          <span className={correlation.r >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
            {Number.isFinite(correlation.r) ? correlation.r.toFixed(3) : '—'}
          </span>
          <span className="text-slate-500 ml-2">n={correlation.n}</span>
        </div>
      )}
      {(!correlation || correlation.pairs.length < 2) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-600/40 text-slate-300 text-xs">
            No hay pares alineados suficientes
          </span>
        </div>
      )}
    </div>
  );
};
