import React from 'react';

interface ChartStatusLayerProps {
  status: 'loading' | 'ready' | 'empty' | 'error';
  loadingText: string;
  emptyText: string;
  errorText: string;
}

export function ChartStatusLayer({
  status,
  loadingText,
  emptyText,
  errorText,
}: ChartStatusLayerProps) {
  if (status === 'ready') return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center text-sm z-10 rounded-xl bg-slate-950/45 backdrop-blur-sm">
      {status === 'loading' && <span className="text-slate-200 px-3 py-1.5 rounded-full bg-slate-800/70 border border-slate-600/30">{loadingText}</span>}
      {status === 'empty' && <span className="text-slate-200 px-3 py-1.5 rounded-full bg-slate-800/70 border border-slate-600/30">{emptyText}</span>}
      {status === 'error' && <span className="text-red-300 px-3 py-1.5 rounded-full bg-red-950/40 border border-red-500/30">{errorText}</span>}
    </div>
  );
}

