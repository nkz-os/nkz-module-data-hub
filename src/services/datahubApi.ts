/**
 * DataHub BFF API client.
 * Uses same origin /api and httpOnly cookie for auth (credentials: 'include').
 */

/** A single timeseries attribute on a DataHub entity. */
export interface DataHubEntityAttribute {
  /** Attribute name as it appears in NGSI-LD (e.g. "ndviMean", "temperature"). */
  name: string;
  /**
   * Data source for this specific attribute. Maps to the BFF adapter env var
   * TIMESERIES_ADAPTER_{SOURCE}_URL (upper-cased). Examples:
   *   "timescale"         → platform TimescaleDB (default)
   *   "vegetation_health" → vegetation-health adapter (Arrow IPC)
   *   "carbon"            → carbon module adapter
   */
  source: string;
}

export interface DataHubEntity {
  id: string;
  type: string;
  name: string;
  /** Per-attribute source metadata. Each attribute routes to its own adapter. */
  attributes: DataHubEntityAttribute[];
  /** Entity-level default source (fallback when attribute has no explicit source). */
  source?: string;
}

export interface DataHubEntitiesResponse {
  entities: DataHubEntity[];
}

/** Check if the user is authenticated (cookie is set by the host). */
export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  const ctx = (window as unknown as { __nekazariAuthContext?: { isAuthenticated?: boolean } }).__nekazariAuthContext;
  return ctx?.isAuthenticated === true;
}

/** Read tenant ID from the host auth context (set by Keycloak JWT → host). */
function getTenantId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const ctx = (window as unknown as { __nekazariAuthContext?: { tenantId?: string } }).__nekazariAuthContext;
  return ctx?.tenantId || undefined;
}

/** Build common headers with optional tenant ID for multi-tenancy. */
function withTenantHeaders(base: HeadersInit = {}): HeadersInit {
  const tenantId = getTenantId();
  if (tenantId) {
    return { ...base, 'X-Tenant-ID': tenantId };
  }
  return base;
}

/** Exported helper for worker-driven requests. */
export function getDatahubRequestHeaders(base: Record<string, string> = {}): Record<string, string> {
  return withTenantHeaders(base) as Record<string, string>;
}

/**
 * API base for fetch(). When VITE_API_URL points to another host (e.g. nkz.*) but the SPA runs
 * on nekazari.*, httpOnly cookies are not sent cross-origin — use same-origin /api/* instead
 * (Ingress must route those prefixes on the frontend host).
 */
export function getBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const w = window as unknown as { __ENV__?: { VITE_API_URL?: string } };
  const raw = (w.__ENV__?.VITE_API_URL ?? '').replace(/\/$/, '');
  if (!raw) return '';
  try {
    const apiHost = new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname;
    if (apiHost && apiHost !== window.location.hostname) return '';
  } catch {
    return '';
  }
  return raw;
}

export async function fetchDataHubEntities(search?: string): Promise<DataHubEntitiesResponse> {
  const base = getBaseUrl().replace(/\/$/, '');
  const path = '/api/datahub/entities' + (search ? `?search=${encodeURIComponent(search)}` : '');
  const url = base ? `${base}${path}` : path;
  const headers: HeadersInit = withTenantHeaders({ Accept: 'application/json' });

  const res = await fetch(url, { headers, credentials: 'include' });
  if (!res.ok) throw new Error(`DataHub entities: ${res.status} ${await res.text()}`);
  return res.json();
}

export interface AlignSeriesSpec {
  entity_id: string;
  attribute: string;
  source?: string;
}

// ---------------------------------------------------------------------------
// Intelligence /predict job + SSE stream (Phase 3.5)
// ---------------------------------------------------------------------------

export interface PredictJobResponse {
  job_id: string;
  status: string;
  message?: string;
}

export interface PredictionPoint {
  timestamp: string; // ISO 8601
  value: number;
}

export interface PredictionResult {
  predictions: PredictionPoint[];
  confidence?: number;
  model?: string;
  metadata?: Record<string, unknown>;
}

/** Submit metadata-only predict job; returns job_id for SSE stream. */
export async function submitPredictJob(
  entityId: string,
  attribute: string,
  startTime: string,
  endTime: string,
  predictionHorizonHours: number = 24
): Promise<string> {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = base ? `${base}/api/intelligence/predict` : '/api/intelligence/predict';
  const headers: HeadersInit = withTenantHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' });

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      entity_id: entityId,
      attribute,
      start_time: startTime,
      end_time: endTime,
      prediction_horizon: predictionHorizonHours,
    }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Predict: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as PredictJobResponse;
  return data.job_id;
}

/** SSE stream URL for job status. Use fetchEventSource with credentials: 'include' (never JWT in URL). */
export function getIntelligenceStreamUrl(jobId: string): string {
  const base = getBaseUrl().replace(/\/$/, '');
  const path = `/api/intelligence/jobs/${encodeURIComponent(jobId)}/stream`;
  return base ? `${base}${path}` : path;
}

// ---------------------------------------------------------------------------
// Export (Phase 3.1 CSV, 3.2 Parquet) — metadata-only POST
// ---------------------------------------------------------------------------

export interface ExportSeriesSpec {
  entity_id: string;
  attribute: string;
}

/** Analytical granularity for export (not screen resolution). */
export type ExportAggregation = 'raw' | '1 hour' | '1 day';

export interface ExportRequest {
  start_time: string;
  end_time: string;
  series: ExportSeriesSpec[];
  format: 'csv' | 'parquet';
  /** Aggregation interval: raw (finest), 1 hour, 1 day. Default 1 hour. */
  aggregation: ExportAggregation;
}

export interface ExportParquetResponse {
  download_url: string;
  expires_in: number;
  format: 'parquet';
}

/**
 * POST /api/datahub/export with view state only. Returns CSV blob or JSON with presigned URL.
 */
export async function requestExport(
  payload: ExportRequest
): Promise<{ format: 'csv'; blob: Blob } | { format: 'parquet'; data: ExportParquetResponse }> {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = base ? `${base}/api/datahub/export` : '/api/datahub/export';
  const headers: HeadersInit = withTenantHeaders({ 'Content-Type': 'application/json', Accept: 'text/csv, application/json' });

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' });
  if (!res.ok) throw new Error(`Export: ${res.status} ${await res.text()}`);

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/csv')) {
    const blob = await res.blob();
    return { format: 'csv', blob };
  }
  const data = (await res.json()) as ExportParquetResponse;
  return { format: 'parquet', data };
}

// ---------------------------------------------------------------------------
// Workspaces (Phase 5) — NGSI-LD DataHubWorkspace persist/load
// ---------------------------------------------------------------------------

/** Mirrors DashboardPanel chart options for workspace round-trip. Schema v2. */
export interface WorkspaceChartAppearance {
  viewMode?: 'timeseries' | 'correlation';
  mode?: 'line' | 'bars' | 'points';
  lineWidth?: number;
  pointRadius?: number;
  showTrendline?: boolean;
  correlationXSeries?: number;
  correlationYSeries?: number;
  /** Schema v2 fields (Phase 5/7/8). All optional for forward/back compat. */
  yScaleMode?: 'auto' | 'fit-visible' | 'focus' | 'manual';
  yScaleManual?: {
    left?: { min: number; max: number };
    right?: { min: number; max: number };
  };
  seriesConfig?: Record<
    string,
    { visible?: boolean; colorOverride?: string; yAxis?: 'left' | 'right' }
  >;
  thresholds?: Array<{
    value: number;
    color: string;
    label: string;
    axis: 'left' | 'right';
    style?: 'solid' | 'dash' | 'dot';
  }>;
  rollingAverage?: 'off' | '1h' | '24h' | '7d';
}

export interface WorkspaceLayoutPanel {
  panelId: string;
  grid: { x: number; y: number; w: number; h: number };
  type: 'timeseries_chart';
  title?: string;
  series: Array<{ entityId: string; attribute: string; source: string; yAxis?: 'left' | 'right' }>;
  chartAppearance?: WorkspaceChartAppearance;
}

export interface DataHubWorkspacePayload {
  id: string;
  type: 'DataHubWorkspace';
  name: { type: 'Property'; value: string };
  timeContext: { type: 'Property'; value: { startTime: string; endTime: string; resolution: number } };
  layout: { type: 'Property'; value: WorkspaceLayoutPanel[] };
  /** Workspace schema version. v2 added Y-scale modes, series config,
   *  thresholds and rolling-average overlays. v1 payloads load as v2 with
   *  defaults applied through mergeChartAppearance. */
  version?: { type: 'Property'; value: number };
}

export interface DataHubWorkspaceStored {
  id: string;
  type: string;
  name?: { type: string; value: string };
  timeContext?: { type: string; value: { startTime: string; endTime: string; resolution: number } };
  layout?: { type: string; value: WorkspaceLayoutPanel[] };
}

/** POST /api/datahub/workspaces — create or update workspace (BFF → Context Broker). */
export async function saveWorkspace(payload: DataHubWorkspacePayload): Promise<void> {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = base ? `${base}/api/datahub/workspaces` : '/api/datahub/workspaces';
  const headers: HeadersInit = withTenantHeaders({ 'Content-Type': 'application/json' });

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
}

/** GET /api/datahub/workspaces — list workspaces for current tenant. */
export async function listWorkspaces(): Promise<DataHubWorkspaceStored[]> {
  const base = getBaseUrl().replace(/\/$/, '');
  const path = '/api/datahub/workspaces';
  const url = base ? `${base}${path}` : path;
  const headers: HeadersInit = withTenantHeaders({ Accept: 'application/json' });

  const res = await fetch(url, { headers, credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return Array.isArray(data) ? data : data.workspaces ?? [];
}

/** Platform PAT metadata (ADR 003). */
export interface TenantPatMeta {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  created_at?: string | null;
  expires_at?: string | null;
  created_by_sub?: string | null;
}

/** GET /api/tenant/api-keys — list PATs for current tenant (cookie auth). */
export async function listTenantPats(): Promise<TenantPatMeta[]> {
  const base = getBaseUrl().replace(/\/$/, '');
  const path = '/api/tenant/api-keys';
  const url = base ? `${base}${path}` : path;
  const res = await fetch(url, { headers: withTenantHeaders({ Accept: 'application/json' }), credentials: 'include' });
  if (!res.ok) throw new Error(`PAT list: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** POST /api/tenant/api-keys — create PAT; returns raw token once. */
export async function createTenantPat(body: {
  name: string;
  description?: string;
  expires_at?: string;
}): Promise<{ id: string; token: string; name: string; warning?: string }> {
  const base = getBaseUrl().replace(/\/$/, '');
  const path = '/api/tenant/api-keys';
  const url = base ? `${base}${path}` : path;
  const res = await fetch(url, {
    method: 'POST',
    headers: withTenantHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PAT create: ${res.status} ${await res.text()}`);
  return res.json();
}

/** DELETE /api/tenant/api-keys/:id — revoke PAT. */
export async function revokeTenantPat(id: string): Promise<void> {
  const base = getBaseUrl().replace(/\/$/, '');
  const path = `/api/tenant/api-keys/${encodeURIComponent(id)}`;
  const url = base ? `${base}${path}` : path;
  const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error(`PAT revoke: ${res.status} ${await res.text()}`);
}
