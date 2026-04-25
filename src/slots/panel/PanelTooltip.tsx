/**
 * PanelTooltip — pure presentational component for the cursor tooltip.
 *
 * The orchestrator decides when it's visible and what data to show; this
 * component just lays it out and handles edge-flip. No state of its own.
 */

import React from 'react';

export interface TooltipRow {
  label: string;
  unit: string;
  color: string;
  value: number;
}

export interface PanelTooltipProps {
  visible: boolean;
  /** Pixel coords relative to the chart container. */
  left: number;
  top: number;
  /** Container width — used for edge-flip decision. */
  containerWidth: number;
  /** Pre-formatted timestamp (caller localizes). */
  timestamp: string;
  rows: TooltipRow[];
}

function formatNumberShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

export const PanelTooltip: React.FC<PanelTooltipProps> = ({
  visible,
  left,
  top,
  containerWidth,
  timestamp,
  rows,
}) => {
  if (!visible || rows.length === 0) return null;

  // Auto-flip horizontally near the right edge so the tooltip never gets clipped.
  const flipLeft = left > containerWidth - 220;
  const horizontalTransform = flipLeft ? 'translateX(-100%)' : 'translateX(0)';
  const offsetX = flipLeft ? -10 : 10;

  return (
    <div
      className="absolute z-30 pointer-events-none px-2.5 py-2 rounded-lg bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-md min-w-[160px] max-w-[280px]"
      style={{
        left: left + offsetX,
        top: Math.max(8, top - 8),
        transform: `${horizontalTransform} translateY(-100%)`,
      }}
    >
      <div className="text-[10px] text-slate-400 mb-1.5 font-mono tabular-nums">{timestamp}</div>
      <div className="flex flex-col gap-1">
        {rows.map((r, i) => (
          <div key={`${r.label}-${i}`} className="flex items-center gap-2 leading-tight text-[11px]">
            <span
              aria-hidden
              className="inline-block w-2.5 h-2.5 rounded-full ring-1 ring-slate-900 shrink-0"
              style={{ background: r.color }}
            />
            <span className="text-slate-200 truncate" title={r.label}>
              {r.label}
            </span>
            <span className="ml-auto tabular-nums text-slate-50 font-semibold whitespace-nowrap">
              {formatNumberShort(r.value)}
              {r.unit && <span className="text-slate-400 font-normal ml-0.5">{r.unit}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
