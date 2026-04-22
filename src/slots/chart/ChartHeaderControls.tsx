import React from 'react';
import type { ChartSeriesDef } from '../../types/dashboard';

interface ChartHeaderControlsProps {
  series: ChartSeriesDef[];
  buildLabel: string;
}

export function ChartHeaderControls({ series, buildLabel }: ChartHeaderControlsProps) {
  const label =
    series.length === 1
      ? `${series[0].attribute} · ${series[0].entityId.split(':').pop() ?? series[0].entityId}`
      : `Series (${series.length})`;

  return (
    <div className="flex items-center justify-between mb-2 px-1">
      <div className="text-[12px] font-semibold text-slate-100 truncate tracking-wide">
        {label}
      </div>
      <div className="text-[10px] text-slate-400/80">{buildLabel}</div>
    </div>
  );
}

