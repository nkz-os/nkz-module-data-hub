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
    <div className="relative flex-1 min-h-[320px] bg-gradient-to-b from-slate-800/30 via-slate-900/10 to-transparent rounded-xl border border-slate-500/20 shadow-[0_0_0_1px_rgba(148,163,184,0.08),0_12px_32px_rgba(2,6,23,0.35)] p-2 backdrop-blur-[2px]">
      {children}
    </div>
  );
}

