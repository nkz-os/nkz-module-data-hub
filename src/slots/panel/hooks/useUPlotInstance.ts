/**
 * useUPlotInstance — uPlot mode 2 lifecycle, fluid resize, single source of truth.
 *
 * The hook creates one uPlot instance bound to `containerRef` and recreates it
 * whenever `options` changes by structural identity. Data updates that don't
 * change options shape go through `setData` in-place to avoid expensive
 * teardown/rebuild on every fetch.
 *
 * ResizeObserver pushes width/height into uPlot incrementally via `setSize`.
 */

import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface UseUPlotInstanceArgs {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** uPlot mode-2 data shape: [null, [xs, ys], [xs, ys], ...] */
  data: uPlot.AlignedData | null;
  options: uPlot.Options;
  /** Reset the instance when this changes (use a stable key derived from series identity). */
  resetKey: string;
}

export function useUPlotInstance({
  containerRef,
  data,
  options,
  resetKey,
}: UseUPlotInstanceArgs): React.MutableRefObject<uPlot | null> {
  const plotRef = useRef<uPlot | null>(null);
  const lastResetKeyRef = useRef<string>('');

  // (Re)create uPlot when reset key changes (e.g. series shape changed).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data) return;

    if (plotRef.current && lastResetKeyRef.current === resetKey) {
      // Same instance is fine; data update path will handle this.
      return;
    }

    if (plotRef.current) {
      plotRef.current.destroy();
      plotRef.current = null;
    }

    const sized: uPlot.Options = {
      ...options,
      width: container.clientWidth || options.width || 800,
      height: container.clientHeight || options.height || 400,
    };
    const plot = new uPlot(sized, data, container);
    plotRef.current = plot;
    lastResetKeyRef.current = resetKey;

    const ro = new ResizeObserver(() => {
      const inst = plotRef.current;
      if (!inst || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) inst.setSize({ width: w, height: h });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (plotRef.current === plot) {
        plot.destroy();
        plotRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // In-place data updates (cheap path, no instance rebuild).
  useEffect(() => {
    const inst = plotRef.current;
    if (!inst || !data) return;
    if (lastResetKeyRef.current !== resetKey) return; // a reset is queued; skip
    inst.setData(data);
  }, [data, resetKey]);

  return plotRef;
}
