import React from 'react';
import type { ChartSeriesDef } from '../../types/dashboard';

interface ChartLegendProps {
  series: ChartSeriesDef[];
  colors: string[];
  plottedPoints: number;
  receivedPoints: number;
  viewport?: { width: number; height: number };
}

export function ChartLegend({
  series,
  colors,
  plottedPoints,
  receivedPoints,
  viewport,
}: ChartLegendProps) {
  return (
    <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400 flex-wrap px-1">
      {series.map((s, i) => (
        <div key={`${s.entityId}-${s.attribute}`} className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: colors[i % colors.length] }}
          />
          <span className="text-slate-300">{s.attribute}</span>
        </div>
      ))}
      <span className="text-slate-500">points {plottedPoints}/{receivedPoints}</span>
      {viewport ? (
        <span className="text-slate-600">viewport {viewport.width}x{viewport.height}</span>
      ) : null}
    </div>
  );
}

