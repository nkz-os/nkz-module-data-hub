import React from 'react';

interface ChartSurfaceProps {
  children: React.ReactNode;
}

/**
 * Lightweight visual shell for the chart viewport.
 * Keeps structure styling separated from render/data logic.
 */
export function ChartSurface({ children }: ChartSurfaceProps) {
  return (
    <div className="relative flex-1 min-h-[240px] bg-slate-900/45 rounded-md border border-slate-700/20 p-1">
      {children}
    </div>
  );
}

