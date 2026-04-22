import React from 'react';
import type { ChartSeriesDef } from '../../types/dashboard';

interface ChartHeaderControlsProps {
  series: ChartSeriesDef[];
  buildLabel: string;
}

export function ChartHeaderControls({ series, buildLabel }: ChartHeaderControlsProps) {
  return (
    <div className="flex items-center justify-between mb-1 px-1">
      <div className="text-[12px] font-medium text-slate-200 truncate">
        {series.length === 1 ? `${series[0].entityId} — ${series[0].attribute}` : `Series (${series.length})`}
      </div>
      <div className="text-[10px] text-slate-500">{buildLabel}</div>
    </div>
  );
}

