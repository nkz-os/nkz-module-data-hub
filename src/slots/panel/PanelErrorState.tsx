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
      <span className="text-xs text-[#8b95a5] max-w-[400px] break-words font-mono">
        {detail}
      </span>
    )}
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 px-3 py-2 text-sm text-[#eaeef4] bg-[#161c28] hover:bg-[#1a2030] rounded-md border border-[#2a3345] transition-colors"
      >
        <RefreshCw size={14} aria-hidden />
        {retryLabel}
      </button>
    )}
  </div>
);
