/**
 * usePanelTimeSync — bridge between this panel and the rest of the workspace.
 *
 * Two CustomEvent channels (already used by the existing dashboard):
 *  - DATAHUB_EVENT_TIME_HOVER: emitted by ANY panel on cursor move; carries
 *    epoch ms. Other panels listen and draw a synced crosshair.
 *  - DATAHUB_EVENT_TIME_SELECT: emitted on shift+drag range select; the Host
 *    listens and moves its 3D viewer clock.
 *
 * Fase 3 only sets up the listener side (so other panels' cursors propagate
 * here). The emit side is wired in the chart hooks during Fase 6.
 */

import { useEffect } from 'react';

import {
  DATAHUB_EVENT_TIME_HOVER,
  DATAHUB_EVENT_SET_TIME_RANGE,
  type DataHubTimeHoverDetail,
  type DataHubTimeRangeDetail,
} from '../../../hooks/useUPlotCesiumSync';

export interface PanelTimeSyncHandlers {
  /** External cursor moved → align crosshair. Receives epoch seconds. */
  onExternalHover?: (epochSec: number) => void;
  /** External requested visible X range (e.g. Cesium clock moved). Epoch seconds. */
  onExternalRange?: (range: { min: number; max: number }) => void;
}

export function usePanelTimeSync(handlers: PanelTimeSyncHandlers): void {
  const { onExternalHover, onExternalRange } = handlers;

  useEffect(() => {
    if (!onExternalHover) return;
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<DataHubTimeHoverDetail>).detail;
      if (!detail || typeof detail.timestamp !== 'number') return;
      onExternalHover(detail.timestamp / 1000); // ms → seconds
    };
    window.addEventListener(DATAHUB_EVENT_TIME_HOVER, handler);
    return () => window.removeEventListener(DATAHUB_EVENT_TIME_HOVER, handler);
  }, [onExternalHover]);

  useEffect(() => {
    if (!onExternalRange) return;
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<DataHubTimeRangeDetail>).detail;
      if (!detail) return;
      const min = Number(detail.min);
      const max = Number(detail.max);
      if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
        onExternalRange({ min, max });
      }
    };
    window.addEventListener(DATAHUB_EVENT_SET_TIME_RANGE, handler);
    return () => window.removeEventListener(DATAHUB_EVENT_SET_TIME_RANGE, handler);
  }, [onExternalRange]);
}
