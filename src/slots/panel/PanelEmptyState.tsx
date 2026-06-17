import React from 'react';
import { Inbox } from 'lucide-react';

interface PanelEmptyStateProps {
  message: string;
}

export const PanelEmptyState: React.FC<PanelEmptyStateProps> = ({ message }) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 dh-text-secondary pointer-events-none">
    <Inbox size={32} className="dh-text-muted" aria-hidden />
    <span className="text-sm">{message}</span>
  </div>
);
