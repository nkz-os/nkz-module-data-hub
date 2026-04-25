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
    <div className="absolute inset-0 min-h-0 bg-transparent border-none rounded-none p-0 overflow-visible">
      {children}
    </div>
  );
}
