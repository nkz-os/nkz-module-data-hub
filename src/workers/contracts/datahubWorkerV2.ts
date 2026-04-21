export type DatahubWorkerMode = 'single' | 'multi';

export interface WorkerSeriesSpec {
  entityId: string;
  attribute: string;
  source?: string;
}

export interface DatahubWorkerPolicy {
  maxGapSeconds: number;
  downsampleThreshold: number;
  viewportWidthPx: number;
  preserveExtrema: boolean;
  compatibilityMode?: boolean;
}

export interface DatahubWorkerNetworkRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface DatahubWorkerRequest {
  type: 'PROCESS_SERIES';
  requestId: string;
  contractVersion: 2;
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
}

export interface DatahubWorkerResponse {
  type: 'PROCESS_SERIES_RESULT';
  requestId: string;
  contractVersion: 2;
  workerBuild: string;
  data: Float64Array[];
  stats: WorkerStats;
  error?: WorkerError;
}

