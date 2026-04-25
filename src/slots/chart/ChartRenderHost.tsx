import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

import { useUPlotCesiumSync } from '../../hooks/useUPlotCesiumSync';

interface ChartRenderHostProps {
  options: uPlot.Options;
  data: uPlot.AlignedData | null;
  syncEvents?: boolean;
  onViewportChange?: (size: { width: number; height: number }) => void;
  debugKey?: string;
}

/**
 * Single render host: uPlot-only, worker-fed.
 * Keeps chart rendering isolated from panel orchestration/UI controls.
 */
export function ChartRenderHost({
  options,
  data,
  syncEvents = true,
  onViewportChange,
  debugKey,
}: ChartRenderHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useUPlotCesiumSync({
    chartContainerRef: containerRef,
    options,
    data,
    syncEvents,
    debugKey,
  });

  useEffect(() => {
    if (!onViewportChange || !containerRef.current) return;
    const el = containerRef.current;
    const notify = () => {
      onViewportChange({
        width: el.offsetWidth || 0,
        height: el.offsetHeight || 0,
      });
    };
    notify();
    const ro = new ResizeObserver(notify);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onViewportChange]);

  return <div ref={containerRef} className="uplot-container absolute inset-0 h-full min-h-0 rounded-none overflow-hidden bg-transparent" />;
}
