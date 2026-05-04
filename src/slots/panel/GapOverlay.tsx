/**
 * GapOverlay — renders translucent vertical bands where data gaps exist.
 * Uses uPlot valToPos to map from epochs to pixel coordinates.
 */

import React, { useEffect, useRef, useState } from 'react';
import type uPlot from 'uplot';

export interface GapZone {
  from: number;
  to: number;
}

export interface GapOverlayProps {
  plotRef: React.MutableRefObject<uPlot | null>;
  gaps: GapZone[];
}

export function detectGaps(
  xs: Float64Array,
  maxGapSeconds: number = 6 * 3600,
): GapZone[] {
  const gaps: GapZone[] = [];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > maxGapSeconds) {
      gaps.push({ from: xs[i - 1], to: xs[i] });
    }
  }
  return gaps;
}

export const GapOverlay: React.FC<GapOverlayProps> = ({ plotRef, gaps }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);

  // Re-render on uPlot draw cycle
  useEffect(() => {
    const inst = plotRef.current;
    if (!inst) return;
    const handler = () => setTick((n) => n + 1);
    inst.hooks.draw = inst.hooks.draw ?? [];
    inst.hooks.draw.push(handler);
    return () => {
      const arr = inst.hooks.draw;
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }, [plotRef]);

  const inst = plotRef.current;
  if (!inst || gaps.length === 0 || tick < 0) return <div ref={ref} className="absolute inset-0 pointer-events-none" />;

  const dpr = window.devicePixelRatio || 1;
  const bbox = inst.bbox;
  if (!bbox) return <div ref={ref} className="absolute inset-0 pointer-events-none" />;

  const top = bbox.top / dpr;
  const height = bbox.height / dpr;

  return (
    <div ref={ref} className="absolute inset-0 pointer-events-none" aria-hidden>
      {gaps.map((gap, i) => {
        const pxFrom = inst.valToPos(gap.from, 'x', false);
        const pxTo = inst.valToPos(gap.to, 'x', false);
        if (!Number.isFinite(pxFrom) || !Number.isFinite(pxTo)) return null;
        const w = pxTo - pxFrom;
        if (w <= 1) return null;
        return (
          <div
            key={`gap-${i}`}
            className="absolute"
            style={{
              left: pxFrom,
              top,
              width: w,
              height,
              background: 'repeating-linear-gradient(-45deg, var(--theme-colors-border), var(--theme-colors-border) 4px, transparent 4px, transparent 8px)',
            }}
          />
        );
      })}
    </div>
  );
};
