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
    <div className="absolute inset-0 flex items-center justify-center text-sm z-10 bg-slate-900/70 rounded-md">
      {status === 'loading' && <span className="text-slate-300">{loadingText}</span>}
      {status === 'empty' && <span className="text-slate-300">{emptyText}</span>}
      {status === 'error' && <span className="text-red-400">{errorText}</span>}
    </div>
  );
}

