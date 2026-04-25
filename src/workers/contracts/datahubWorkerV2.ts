/**
 * DataHub Worker Contract V2.1
 *
 * Per-series typed array output. Each series owns its own strictly-monotonic
 * X array and Y array. Multi-series panels feed this directly into uPlot mode 2.
 *
 * Spec: internal-docs/specs/2026-04-25-datahub-worker-contract-v2-1.md
 */

export type DatahubWorkerMode = 'single' | 'multi';

export interface WorkerSeriesSpec {
  entityId: string;
  attribute: string;
  source?: string;
}

export interface DatahubWorkerPolicy {
  /** Treat intervals larger than this as discontinuities (NaN bridge inserted). */
  maxGapSeconds: number;
  /** Trigger downsampling when a series exceeds this point count. */
  downsampleThreshold: number;
  /** Width hint in CSS pixels; informs target output density. */
  viewportWidthPx: number;
  /** Preserve local extrema when downsampling. */
  preserveExtrema: boolean;
  /** Optional fallback for incident response. */
  compatibilityMode?: boolean;
}

export interface DatahubWorkerRequest {
  type: 'PROCESS_SERIES';
  requestId: string;
  contractVersion: 2.1;
  mode: DatahubWorkerMode;
  baseUrl?: string;
  headers?: Record<string, string>;
  startTime: string;
  endTime: string;
  resolution: number;
  series: WorkerSeriesSpec[];
  forceRefresh?: boolean;
  policy: DatahubWorkerPolicy;
}

export interface DatahubWorkerReleaseRequest {
  type: 'RELEASE_SERIES';
  keys: string[];
}

export type DatahubWorkerMessage = DatahubWorkerRequest | DatahubWorkerReleaseRequest;

/** Per-series statistics surfaced to the UI for telemetry and axis pre-compute. */
export interface PerSeriesStats {
  rawPointsFetched: number;
  pointsPlotted: number;
  gapsInjected: number;
  pointsDiscarded: number;
  downsampleRatio: number;
  domainX: [number, number] | null;
  domainY: [number, number] | null;
}

/** Aggregate stats (sum across all series in this response). */
export interface WorkerStats {
  rawPointsFetched: number;
  pointsPlotted: number;
  gapsInjected: number;
  pointsDiscarded: number;
  processingTimeMs: number;
  downsampleRatio: number;
  domainX: [number, number] | null;
}

export interface WorkerError {
  code: 'FETCH_ERROR' | 'PARSE_ERROR' | 'PROCESS_ERROR';
  stage: 'fetch' | 'decode' | 'gap' | 'downsample' | 'transfer';
  message: string;
  retryable: boolean;
  httpStatus?: number;
  /** Which series failed (when applicable). null = whole-request failure. */
  seriesKey?: string | null;
}

/** Output for one series: identity + typed arrays + per-series stats. */
export interface WorkerSeriesPayload {
  /** Stable identity for cache + UI diffing: `${source}|${entityId}|${attribute}`. */
  key: string;
  entityId: string;
  attribute: string;
  source: string;
  /** Strictly increasing finite epoch seconds. Length matches ys. */
  xs: Float64Array;
  /** Y values aligned with xs. NaN allowed only at injected gap bridges. */
  ys: Float64Array;
  stats: PerSeriesStats;
}

export interface DatahubWorkerResponse {
  type: 'PROCESS_SERIES_RESULT';
  requestId: string;
  contractVersion: 2.1;
  workerBuild: string;
  /** One entry per requested series, in request order. */
  series: WorkerSeriesPayload[];
  stats: WorkerStats;
  error?: WorkerError;
}
