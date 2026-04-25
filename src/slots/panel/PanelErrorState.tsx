import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface PanelErrorStateProps {
  message: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel: string;
}

export const PanelErrorState: React.FC<PanelErrorStateProps> = ({
  message,
  detail,
  onRetry,
  retryLabel,
}) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
    <div className="flex items-center gap-2 text-rose-300">
      <AlertTriangle size={18} aria-hidden />
      <span className="text-sm font-medium">{message}</span>
    </div>
    {detail && (
      <span className="text-[11px] text-slate-500 max-w-[400px] break-words font-mono">
        {detail}
      </span>
    )}
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md border border-slate-700/70 transition-colors"
      >
        <RefreshCw size={12} aria-hidden />
        {retryLabel}
      </button>
    )}
  </div>
);
