import React from 'react';
import { Button } from '@nekazari/ui-kit';
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
    <div className="flex items-center gap-2 text-destructive">
      <AlertTriangle size={18} aria-hidden />
      <span className="text-sm font-medium">{message}</span>
    </div>
    {detail && (
      <span className="text-[11px] text-muted-foreground max-w-[400px] break-words font-mono">
        {detail}
      </span>
    )}
    {onRetry && (
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw size={12} aria-hidden />
        {retryLabel}
      </Button>
    )}
  </div>
);
