import React from 'react';
import { Activity, AlertTriangle, Loader2 } from 'lucide-react';

import type { WorkerStatus } from './hooks/useWorkerSeries';

interface PanelHeaderProps {
  /** Series count or panel title fallback. */
  title: string;
  /** Subtitle (units summary, "X • Y" axis hint). */
  subtitle?: string;
  status: WorkerStatus;
  /** Right-side content (DataHubDashboard renders predict/export/remove there). */
  rightSlot?: React.ReactNode;
  /** Drag handle CSS class — set by parent to allow react-grid-layout drag. */
  dragHandleClass?: string;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  title,
  subtitle,
  status,
  rightSlot,
  dragHandleClass,
}) => {
  return (
    <div
      className={[
        'h-9 flex items-center gap-2 px-3 border-b border-slate-800/80 bg-slate-950/50 backdrop-blur-sm',
        dragHandleClass ?? '',
      ].join(' ')}
    >
      <StatusDot status={status} />
      <div className="flex items-baseline gap-2 min-w-0 flex-1">
        <span className="text-[12px] font-semibold text-slate-100 truncate">{title}</span>
        {subtitle && (
          <span className="text-[10px] text-slate-500 font-mono truncate">{subtitle}</span>
        )}
      </div>
      {rightSlot && <div className="flex items-center gap-1 shrink-0">{rightSlot}</div>}
    </div>
  );
};

function StatusDot({ status }: { status: WorkerStatus }) {
  if (status === 'loading') {
    return <Loader2 size={12} className="text-slate-400 animate-spin shrink-0" aria-hidden />;
  }
  if (status === 'error') {
    return <AlertTriangle size={12} className="text-rose-400 shrink-0" aria-hidden />;
  }
  if (status === 'empty') {
    return <Activity size={12} className="text-slate-500 shrink-0" aria-hidden />;
  }
  return (
    <span
      aria-hidden
      className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)] shrink-0"
    />
  );
}
