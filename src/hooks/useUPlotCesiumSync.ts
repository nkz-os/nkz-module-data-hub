/**
 * Hook: create uPlot instance, feed data, and sync via DOM CustomEvents only.
 * DataHub is agnostic: it does not access Cesium, ViewerContext, or any host globals.
 * - Emits: when the user selects a time range (brush), dispatches a CustomEvent so the Host
 *   can move its 3D viewer clock.
 * - Emits: on cursor move (setCursor), dispatches timeHover with Unix epoch milliseconds
 *   (X axis values from Arrow/uPlot are epoch seconds — multiplied by 1000 before dispatch).
 * - Listens: for a CustomEvent from the Host to set the chart's visible X range (e.g. when
 *   the user moves the timeline in the viewer).
 */

import { useEffect, useRef, RefObject } from 'react';
import uPlot from 'uplot';

/** CustomEvent detail: time range in Unix epoch seconds (uPlot X axis). */
export interface DataHubTimeRangeDetail {
  min: number;
  max: number;
}

/** CustomEvent detail: single instant for crosshair sync — Unix epoch milliseconds (for `new Date(timestamp)`). */
export interface DataHubTimeHoverDetail {
  timestamp: number;
}

/** Event emitted by DataHub when user selects a time range (e.g. brush). Host should listen and update its clock. */
export const DATAHUB_EVENT_TIME_SELECT = 'nekazari:datahub:timeSelect';

/** Event emitted on chart cursor move; detail.timestamp is Unix ms (derived from uPlot X in seconds × 1000). */
export const DATAHUB_EVENT_TIME_HOVER = 'nekazari:datahub:timeHover';

/** Event the Host can dispatch to set the chart's visible X range. DataHub listens and calls u.setScale('x', { min, max }). */
export const DATAHUB_EVENT_SET_TIME_RANGE = 'nekazari:datahub:setTimeRange';

export interface UseUPlotCesiumSyncProps {
  chartContainerRef: RefObject<HTMLDivElement | null>;
  options: uPlot.Options;
  data: uPlot.AlignedData | null;
}

function isTimeRangeDetail(d: unknown): d is DataHubTimeRangeDetail {
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof (d as DataHubTimeRangeDetail).min === 'number' &&
    typeof (d as DataHubTimeRangeDetail).max === 'number'
  );
}

export function useUPlotCesiumSync({
  chartContainerRef,
  options,
  data,
}: UseUPlotCesiumSyncProps): void {
  const uplotRef = useRef<uPlot | null>(null);

  // Single effect: create uPlot with data (or skip if no data yet).
  // Re-runs when options OR data change — always uses the latest data directly.
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    if (!data || data.length < 2) return;

    const opts = { ...options };
    if (!opts.width) opts.width = container.offsetWidth || 800;
    if (!opts.height) opts.height = 300;

    const existingSetSelect = opts.hooks?.setSelect ?? [];
    const setSelectHandlers = Array.isArray(existingSetSelect) ? [...existingSetSelect] : [existingSetSelect];
    setSelectHandlers.push((u: uPlot) => {
      const sel = u.select;
      if (!sel || sel.width <= 0) return;
      const min = u.posToVal(sel.left, 'x');
      const max = u.posToVal(sel.left + sel.width, 'x');
      if (min !== max && Number.isFinite(min) && Number.isFinite(max)) {
        window.dispatchEvent(
          new CustomEvent<DataHubTimeRangeDetail>(DATAHUB_EVENT_TIME_SELECT, {
            detail: { min, max },
          })
        );
      }
    });
    opts.hooks = { ...opts.hooks, setSelect: setSelectHandlers };

    const existingSetCursor = opts.hooks?.setCursor ?? [];
    const setCursorHandlers = Array.isArray(existingSetCursor) ? [...existingSetCursor] : [existingSetCursor];
    let hoverRafId: number | null = null;
    let pendingHoverMs: number | null = null;

    const flushTimeHover = () => {
      hoverRafId = null;
      if (pendingHoverMs == null || !Number.isFinite(pendingHoverMs)) return;
      const timestamp = pendingHoverMs;
      window.dispatchEvent(
        new CustomEvent<DataHubTimeHoverDetail>(DATAHUB_EVENT_TIME_HOVER, {
          detail: { timestamp },
        })
      );
    };

    setCursorHandlers.push(((u: uPlot) => {
      const idx = u.cursor.idx;
      if (idx == null || idx < 0) {
        pendingHoverMs = null;
        if (hoverRafId != null) {
          cancelAnimationFrame(hoverRafId);
          hoverRafId = null;
        }
        return;
      }
      const series0 = u.data[0];
      if (!series0 || idx >= series0.length) return;
      const xSeconds = series0[idx];
      if (xSeconds == null || !Number.isFinite(xSeconds)) return;
      pendingHoverMs = xSeconds * 1000;
      if (hoverRafId == null) {
        hoverRafId = requestAnimationFrame(flushTimeHover);
      }
    }) as (self: uPlot) => void);
    opts.hooks = { ...opts.hooks, setCursor: setCursorHandlers };

    // Create uPlot WITH data directly — avoids empty-init + setData race condition
    const u = new uPlot(opts, data, container);
    uplotRef.current = u;

    // Defer setSize to the next frame — synchronous resize inside ResizeObserver triggers
    // Chrome's "ResizeObserver loop completed with undelivered notifications" and host window.onerror spam.
    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (uplotRef.current && container) {
          const w = container.offsetWidth || opts.width || 800;
          const h = container.offsetHeight || opts.height || 300;
          uplotRef.current.setSize({ width: w, height: h });
        }
      });
    });
    ro.observe(container);

    const onSetTimeRange = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!isTimeRangeDetail(d) || !uplotRef.current) return;
      uplotRef.current.setScale('x', { min: d.min, max: d.max });
    };
    window.addEventListener(DATAHUB_EVENT_SET_TIME_RANGE, onSetTimeRange);

    return () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      if (hoverRafId != null) {
        cancelAnimationFrame(hoverRafId);
        hoverRafId = null;
      }
      pendingHoverMs = null;
      ro.disconnect();
      window.removeEventListener(DATAHUB_EVENT_SET_TIME_RANGE, onSetTimeRange);
      u.destroy();
      uplotRef.current = null;
    };
  }, [chartContainerRef, options, data]);
}
