import React from 'react';
import { Inbox } from 'lucide-react';

interface PanelEmptyStateProps {
  message: string;
}

export const PanelEmptyState: React.FC<PanelEmptyStateProps> = ({ message }) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#8b95a5] pointer-events-none">
    <Inbox size={32} className="text-[#596373]" aria-hidden />
    <span className="text-sm">{message}</span>
  </div>
);
