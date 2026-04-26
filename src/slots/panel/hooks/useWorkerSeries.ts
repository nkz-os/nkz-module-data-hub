/**
 * useWorkerSeries — single source of truth for fetching series via the worker.
 *
 * Owns:
 *  - one Worker instance per panel (terminated on unmount)
 *  - request-id ownership: a stale response (different requestId) is silently
 *    ignored so we never paint old data over a newer fetch
 *  - status state machine: idle → loading → ready | empty | error
 *  - the typed-array buffers received from the worker (unmodified, ready for uPlot)
 *
 * The hook does NOT decide axis assignment, scale ranges, or rendering. Those
 * concerns live in the panel's reducer/uPlot config.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getBaseUrl, getDatahubRequestHeaders } from '../../../services/datahubApi';
import DatahubWorkerInline from '../../../workers/datahubWorker.ts?worker&inline';
import type {
  DatahubWorkerPolicy,
  DatahubWorkerRequest,
  DatahubWorkerResponse,
  WorkerError,
  WorkerSeriesPayload,
  WorkerStats,
} from '../../../workers/contracts/datahubWorkerV2';
import type { ChartSeriesDef } from '../../../types/dashboard';

export type WorkerStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export type FallbackStage = 'worker' | 'cache' | 'fallback';

export interface UseWorkerSeriesArgs {
  panelId: string;
  series: ChartSeriesDef[];
  startTime: string;
  endTime: string;
  resolution: number;
  /** Width hint passed to the downsampler. */
  viewportWidthPx?: number;
}

export interface UseWorkerSeriesResult {
  status: WorkerStatus;
  series: WorkerSeriesPayload[];
  stats: WorkerStats | null;
  error: WorkerError | null;
  /** Where the data came from on the last successful load (for telemetry). */
  stage: FallbackStage;
  /** Force a fresh fetch ignoring the worker's LRU cache. */
  refetch: () => void;
  /** Tell the worker to drop a cached series (used when removing from a panel). */
  release: (keys: string[]) => void;
}

function computeAdaptiveMaxGapSeconds(
  startTime: string,
  endTime: string,
  resolution: number
): number {
  const startMs = Date.parse(startTime);
  const endMs = Date.parse(endTime);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs ||
    resolution <= 1
  ) {
    return 6 * 3600;
  }
  const spanSec = (endMs - startMs) / 1000;
  const step = spanSec / Math.max(1, resolution - 1);
  // 4× the nominal step is the default discontinuity threshold; clamped to keep
  // small ranges responsive and large ranges from missing real outages.
  return Math.max(15 * 60, Math.min(24 * 3600, step * 4));
}

export function useWorkerSeries(args: UseWorkerSeriesArgs): UseWorkerSeriesResult {
  const { panelId, series, startTime, endTime, resolution, viewportWidthPx = 1200 } = args;

  const workerRef = useRef<Worker | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const forceRefreshRef = useRef(false);
  const tickRef = useRef(0); // bumped to trigger refetch

  const [status, setStatus] = useState<WorkerStatus>('idle');
  const [seriesPayloads, setSeriesPayloads] = useState<WorkerSeriesPayload[]>([]);
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [errorState, setErrorState] = useState<WorkerError | null>(null);
  const [stage, setStage] = useState<FallbackStage>('worker');
  const [refetchTick, setRefetchTick] = useState(0);

  // Worker lifecycle: 1 instance per panel, terminated on unmount.
  useEffect(() => {
    const w = new DatahubWorkerInline();
    workerRef.current = w;
    return () => {
      w.terminate();
      workerRef.current = null;
      currentRequestIdRef.current = null;
    };
  }, []);

  // Stable signature for the series list so a re-render of the parent that
  // produces a new array reference (with the same content) doesn't trigger an
  // unnecessary refetch. Using a string key here is much cheaper than deep-eq
  // and survives cross-renders cleanly.
  const seriesSignature = useMemo(
    () =>
      series
        .map((s) => `${s.source ?? 'timescale'}|${s.entityId}|${s.attribute}|${s.yAxis ?? ''}`)
        .join('§'),
    [series]
  );

  useEffect(() => {
    if (series.length === 0) {
      setSeriesPayloads([]);
      setStats(null);
      setErrorState(null);
      setStatus('empty');
      return;
    }

    const worker = workerRef.current;
    if (!worker) return;

    const requestId = `${panelId}-${Date.now()}-${tickRef.current++}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    currentRequestIdRef.current = requestId;
    setStatus('loading');
    setErrorState(null);

    const onMessage = (event: MessageEvent<unknown>) => {
      const msg = event.data as DatahubWorkerResponse | undefined;
      if (!msg || msg.type !== 'PROCESS_SERIES_RESULT') return;
      if (msg.requestId !== currentRequestIdRef.current) {
        // Stale response — silently ignore. A newer request has already taken
        // ownership of the panel state.
        return;
      }
      worker.removeEventListener('message', onMessage);

      if (msg.error && (!msg.series || msg.series.length === 0)) {
        setSeriesPayloads([]);
        setStats(msg.stats);
        setErrorState(msg.error);
        setStage('worker');
        setStatus('error');
        return;
      }

      setSeriesPayloads(msg.series);
      setStats(msg.stats);
      setErrorState(msg.error ?? null);
      setStage(msg.stats.processingTimeMs < 5 ? 'cache' : 'worker');
      const totalPlotted = msg.stats.pointsPlotted;
      setStatus(totalPlotted > 0 ? 'ready' : 'empty');
    };
    worker.addEventListener('message', onMessage);

    const policy: DatahubWorkerPolicy = {
      maxGapSeconds: computeAdaptiveMaxGapSeconds(startTime, endTime, resolution),
      downsampleThreshold: Math.max(1024, viewportWidthPx * 2),
      viewportWidthPx,
      preserveExtrema: true,
    };

    const request: DatahubWorkerRequest = {
      type: 'PROCESS_SERIES',
      requestId,
      contractVersion: 2.1,
      mode: series.length > 1 ? 'multi' : 'single',
      baseUrl: getBaseUrl().replace(/\/$/, '') || undefined,
      headers: getDatahubRequestHeaders({ Accept: 'application/json' }),
      startTime,
      endTime,
      resolution,
      series: series.map((s) => ({
        entityId: s.entityId,
        attribute: s.attribute,
        source: s.source ?? 'timescale',
      })),
      forceRefresh: forceRefreshRef.current,
      policy,
    };
    forceRefreshRef.current = false;
    worker.postMessage(request);

    return () => {
      worker.removeEventListener('message', onMessage);
    };
    // refetchTick is intentionally a dep so refetch() forces a new fetch.
    // We depend on seriesSignature, not the array reference, so re-renders
    // with identical content do not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, seriesSignature, startTime, endTime, resolution, viewportWidthPx, refetchTick]);

  const refetch = useCallback(() => {
    forceRefreshRef.current = true;
    setRefetchTick((n) => n + 1);
  }, []);

  const release = useCallback((keys: string[]) => {
    const worker = workerRef.current;
    if (!worker || keys.length === 0) return;
    worker.postMessage({ type: 'RELEASE_SERIES', keys });
  }, []);

  return {
    status,
    series: seriesPayloads,
    stats,
    error: errorState,
    stage,
    refetch,
    release,
  };
}
