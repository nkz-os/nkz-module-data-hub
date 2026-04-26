/**
 * useUPlotInstance — uPlot mode-2 lifecycle, robust against late-layout flex parents.
 *
 * The previous implementation read container.clientHeight at first useEffect
 * commit. Inside RGL's grid layout + multiple nested flex containers, that
 * dimension is often 0 on the first mount tick (parents haven't computed yet).
 * uPlot was instantiated at fallback 400 px tall, drew at that size, and
 * remained visually anchored to the bottom band even after later setSize
 * calls — uPlot's internal padding/axis offsets in mode 2 are not always
 * recomputed cleanly when the canvas grows by an order of magnitude.
 *
 * This rewrite:
 *  - uses useLayoutEffect so we run after DOM commit but before paint
 *  - WAITS for the container to report a positive height before instantiating;
 *    if the first measurement is 0, an inline ResizeObserver retries on the
 *    very next layout tick
 *  - rebuilds the instance from scratch when the container grows or shrinks
 *    by more than ~5%, instead of relying on setSize. Slightly more expensive
 *    but eliminates the residual-state bug.
 *  - cheap data updates still go through setData (no rebuild).
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface UseUPlotInstanceArgs {
  containerRef: React.RefObject<HTMLDivElement | null>;
  data: uPlot.AlignedData | null;
  options: uPlot.Options;
  /** Bumped when series shape (count / scale assignment) changes; forces rebuild. */
  resetKey: string;
}

const SIZE_DELTA_PCT = 0.05; // 5 % size jump triggers a full rebuild

export function useUPlotInstance({
  containerRef,
  data,
  options,
  resetKey,
}: UseUPlotInstanceArgs): React.MutableRefObject<uPlot | null> {
  const plotRef = useRef<uPlot | null>(null);
  const lastResetKeyRef = useRef<string>('');
  const lastSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // Build / rebuild uPlot when resetKey OR significant size change happens.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !data) return;

    let cancelled = false;
    let ro: ResizeObserver | null = null;

    const buildIfReady = () => {
      if (cancelled) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) {
        // Still no layout — wait for ResizeObserver to fire.
        return;
      }

      const sizeChanged =
        Math.abs(w - lastSizeRef.current.w) / Math.max(1, lastSizeRef.current.w) > SIZE_DELTA_PCT ||
        Math.abs(h - lastSizeRef.current.h) / Math.max(1, lastSizeRef.current.h) > SIZE_DELTA_PCT;

      if (
        plotRef.current &&
        lastResetKeyRef.current === resetKey &&
        !sizeChanged
      ) {
        return;
      }

      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }

      const sized: uPlot.Options = { ...options, width: w, height: h };
      const plot = new uPlot(sized, data, container);
      plotRef.current = plot;
      lastResetKeyRef.current = resetKey;
      lastSizeRef.current = { w, h };
    };

    // First attempt synchronously.
    buildIfReady();

    // If the first attempt couldn't build (container 0×0), keep watching until it can.
    ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (cancelled) return;
      if (!plotRef.current && w > 0 && h > 0) {
        // Still uncreated — try now that we have real dimensions.
        buildIfReady();
        return;
      }
      // Created already: rebuild on substantial size change to keep uPlot's
      // layout state in sync with the new geometry.
      const last = lastSizeRef.current;
      const delta =
        Math.max(
          Math.abs(w - last.w) / Math.max(1, last.w),
          Math.abs(h - last.h) / Math.max(1, last.h)
        );
      if (delta > SIZE_DELTA_PCT) {
        buildIfReady();
        return;
      }
      // Tiny resize (handle drag, scrollbar appears) — cheap setSize is fine.
      if (plotRef.current && w > 0 && h > 0 && (w !== last.w || h !== last.h)) {
        plotRef.current.setSize({ width: w, height: h });
        lastSizeRef.current = { w, h };
      }
    });
    ro.observe(container);

    return () => {
      cancelled = true;
      ro?.disconnect();
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
        lastResetKeyRef.current = '';
        lastSizeRef.current = { w: 0, h: 0 };
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Cheap data path: only setData when resetKey is stable.
  useEffect(() => {
    const inst = plotRef.current;
    if (!inst || !data) return;
    if (lastResetKeyRef.current !== resetKey) return;
    inst.setData(data);
  }, [data, resetKey]);

  return plotRef;
}
