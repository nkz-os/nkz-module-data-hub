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
      <span className="text-xs dh-text-secondary max-w-[400px] break-words font-mono">
        {detail}
      </span>
    )}
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 px-3 py-2 text-sm dh-text-primary dh-bg-surface-alt hover:dh-bg-surface-alt rounded-md border dh-border-light transition-colors"
      >
        <RefreshCw size={14} aria-hidden />
        {retryLabel}
      </button>
    )}
  </div>
);
