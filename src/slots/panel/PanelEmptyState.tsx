import React from 'react';
import { Inbox } from 'lucide-react';

interface PanelEmptyStateProps {
  message: string;
}

export const PanelEmptyState: React.FC<PanelEmptyStateProps> = ({ message }) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400 pointer-events-none">
    <Inbox size={28} className="text-slate-600" aria-hidden />
    <span className="text-xs">{message}</span>
  </div>
);
