/**
 * useUPlotInstance — creates (and destroys) a single uPlot instance per resetKey.
 * No ResizeObserver, no setSize — just create once with the current container size.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface UseUPlotInstanceArgs {
  containerRef: React.RefObject<HTMLDivElement | null>;
  data: uPlot.AlignedData | null;
  options: uPlot.Options;
  resetKey: string;
}

export function useUPlotInstance({
  containerRef,
  data,
  options,
  resetKey,
}: UseUPlotInstanceArgs): React.MutableRefObject<uPlot | null> {
  const plotRef = useRef<uPlot | null>(null);
  const resetKeyRef = useRef('');

  useLayoutEffect(() => {
    const c = containerRef.current;
    if (!c || !data) return;

    let cancelled = false;
    let ro: ResizeObserver | null = null;

    const tryCreate = () => {
      if (cancelled || !c) return;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (w <= 0 || h <= 0) return;

      if (plotRef.current) plotRef.current = null; // don't destroy here, already cleaned

      const sized: uPlot.Options = { ...options, width: w, height: h };
      plotRef.current = new uPlot(sized, data, c);
      resetKeyRef.current = resetKey;
      ro?.disconnect();
      ro = null;
    };

    // Try immediately
    tryCreate();

    // If dimensions are 0, wait for ResizeObserver
    if (!plotRef.current) {
      ro = new ResizeObserver(() => {
        if (!plotRef.current) tryCreate();
      });
      ro.observe(c);
    }

    return () => {
      cancelled = true;
      ro?.disconnect();
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
    };
  }, [resetKey]);

  useEffect(() => {
    const inst = plotRef.current;
    if (!inst || !data) return;
    if (resetKeyRef.current !== resetKey) return;
    inst.setData(data);
  }, [data, resetKey]);

  return plotRef;
}
