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
export const DATAHUB_EVENT_RENDER_DEBUG = 'nekazari:datahub:renderDebug';

/** Keyboard shortcut action targetting a specific panel. */
export const DATAHUB_EVENT_KEYBOARD_ACTION = 'nekazari:datahub:keyboardAction';
export interface DataHubKeyboardActionDetail {
  panelId: string;
  action: 'undoZoom' | 'resetZoom' | 'toggleSeriesRail' | 'toggleTrendline' | 'toggleRollingAvg' | 'openExport';
}

export interface DataHubRenderDebugDetail {
  key?: string;
  stage: 'init' | 'resize';
  containerW: number;
  containerH: number;
  chartW: number;
  chartH: number;
  plotTop: number;
  plotHeight: number;
}

export interface UseUPlotCesiumSyncProps {
  chartContainerRef: RefObject<HTMLDivElement | null>;
  options: uPlot.Options;
  data: uPlot.AlignedData | null;
  syncEvents?: boolean;
  debugKey?: string;
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
  syncEvents = true,
  debugKey,
}: UseUPlotCesiumSyncProps): void {
  const uplotRef = useRef<uPlot | null>(null);

  // Single effect: create uPlot with data (or skip if no data yet).
  // Re-runs when options OR data change — always uses the latest data directly.
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    if (!data || data.length < 2) return;

    let resizeRaf = 0;
    let hoverRafId: number | null = null;
    let pendingHoverMs: number | null = null;
    let isInitialized = false;
    let stableW = 0;
    let stableH = 0;
    let stableFrames = 0;

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

    const emitRenderDebug = (stage: 'init' | 'resize') => {
      if (!uplotRef.current) return;
      const u = uplotRef.current as unknown as { width?: number; height?: number; bbox?: { top?: number; height?: number } };
      window.dispatchEvent(
        new CustomEvent<DataHubRenderDebugDetail>(DATAHUB_EVENT_RENDER_DEBUG, {
          detail: {
            key: debugKey,
            stage,
            containerW: container.offsetWidth || 0,
            containerH: container.offsetHeight || 0,
            chartW: u.width ?? 0,
            chartH: u.height ?? 0,
            plotTop: u.bbox?.top ?? 0,
            plotHeight: u.bbox?.height ?? 0,
          },
        })
      );
    };

    const markStableSize = (w: number, h: number): number => {
      if (w <= 0 || h <= 0) {
        stableFrames = 0;
        stableW = 0;
        stableH = 0;
        return stableFrames;
      }
      if (w === stableW && h === stableH) {
        stableFrames += 1;
      } else {
        stableW = w;
        stableH = h;
        stableFrames = 1;
      }
      return stableFrames;
    };

    // Deferred Initialization: only create uPlot if container has stable dimensions.
    const tryInitChart = () => {
      const w = container.offsetWidth;
      const h = container.offsetHeight;
      if (w === 0 || h === 0) return false;
      if (markStableSize(w, h) < 2) return false;

      const opts = { ...options };
      opts.width = w;
      opts.height = h;

      const existingSetSelect = opts.hooks?.setSelect ?? [];
      const setSelectHandlers = Array.isArray(existingSetSelect) ? [...existingSetSelect] : [existingSetSelect];
      if (syncEvents) {
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
      }
      opts.hooks = { ...opts.hooks, setSelect: setSelectHandlers };

      const existingSetCursor = opts.hooks?.setCursor ?? [];
      const setCursorHandlers = Array.isArray(existingSetCursor) ? [...existingSetCursor] : [existingSetCursor];
      
      if (syncEvents) {
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
      }
      opts.hooks = { ...opts.hooks, setCursor: setCursorHandlers };

      // Create uPlot WITH data directly.
      uplotRef.current = new uPlot(opts, data, container);
      // One extra size sync next frame to guarantee final viewport anchoring.
      requestAnimationFrame(() => {
        const cw = container.offsetWidth;
        const ch = container.offsetHeight;
        if (uplotRef.current && cw > 0 && ch > 0) {
          uplotRef.current.setSize({ width: cw, height: ch });
          emitRenderDebug('init');
        }
      });
      return true;
    };

    // 1. Try to initialize immediately (in case DOM layout is already resolved)
    isInitialized = tryInitChart();

    // 2. Observer kicks in to either initialize or resize
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (!container) return;

        const w = container.offsetWidth;
        const h = container.offsetHeight;
        markStableSize(w, h);
        if (!isInitialized) {
          isInitialized = tryInitChart();
        } else if (uplotRef.current) {
          if (w > 0 && h > 0) {
            uplotRef.current.setSize({ width: w, height: h });
            emitRenderDebug('resize');
          }
        }
      });
    });
    ro.observe(container);

    const onSetTimeRange = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!isTimeRangeDetail(d) || !uplotRef.current) return;
      const xSeries = uplotRef.current.data?.[0] as ArrayLike<number> | undefined;
      if (!xSeries || xSeries.length === 0) return;
      const rawMin = Number(d.min);
      const rawMax = Number(d.max);
      if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax) || rawMax <= rawMin) return;

      let min = rawMin;
      let max = rawMax;
      // Accept host events in either epoch seconds or epoch milliseconds.
      if (Math.max(Math.abs(min), Math.abs(max)) > 1e11) {
        min /= 1000;
        max /= 1000;
      }

      const first = Number(xSeries[0]);
      const last = Number(xSeries[xSeries.length - 1]);
      const dataMin = Math.min(first, last);
      const dataMax = Math.max(first, last);

      if (max < dataMin || min > dataMax) return;
      const clampedMin = Math.max(min, dataMin);
      const clampedMax = Math.min(max, dataMax);
      if (!(Number.isFinite(clampedMin) && Number.isFinite(clampedMax) && clampedMax > clampedMin)) return;

      uplotRef.current.setScale('x', { min: clampedMin, max: clampedMax });
    };
    
    if (syncEvents) {
      window.addEventListener(DATAHUB_EVENT_SET_TIME_RANGE, onSetTimeRange);
    }

    return () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      if (hoverRafId != null) {
        cancelAnimationFrame(hoverRafId);
        hoverRafId = null;
      }
      pendingHoverMs = null;
      ro.disconnect();
      if (syncEvents) {
        window.removeEventListener(DATAHUB_EVENT_SET_TIME_RANGE, onSetTimeRange);
      }
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [chartContainerRef, options, data, syncEvents, debugKey]);
}
