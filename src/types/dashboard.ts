/**
 * Dashboard workspace state (subset of NGSI-LD DataHubWorkspace for persistence).
 * Phase 3: panels hold an array of series. Phase 4.5: panel can hold SSE prediction for canvas injection.
 */

export interface ChartSeriesDef {
  entityId: string;
  attribute: string;
  source: string;
  yAxis?: 'left' | 'right';
}

/** How each panel renders uPlot (line / bars / points + trend). */
export type ChartRenderMode = 'line' | 'bars' | 'points';
export type ChartViewMode = 'timeseries' | 'correlation';

export interface ChartAppearance {
  viewMode: ChartViewMode;
  mode: ChartRenderMode;
  /** Stroke width for lines and bar outlines (1–4). */
  lineWidth: number;
  /** Point marker radius; 0 hides markers on line mode. */
  pointRadius: number;
  /** Least-squares line through (time, value) for the first series (multi-series: first only). */
  showTrendline: boolean;
  /** Correlation mode: index in panel series used as X axis. */
  correlationXSeries: number;
  /** Correlation mode: index in panel series used as Y axis. */
  correlationYSeries: number;
}

export const DEFAULT_CHART_APPEARANCE: ChartAppearance = {
  viewMode: 'timeseries',
  mode: 'line',
  lineWidth: 2,
  pointRadius: 0,
  showTrendline: false,
  correlationXSeries: 0,
  correlationYSeries: 1,
};

/** Result of SSE prediction stream (epoch seconds + values) for merge in worker. */
export interface PredictionPayload {
  timestamps: number[];
  values: number[];
}

export interface DashboardPanel {
  id: string;
  grid: { x: number; y: number; w: number; h: number };
  type: 'timeseries_chart';
  title?: string;
  series: ChartSeriesDef[];
  /** When set, canvas merges with historical and renders Histórico + Predicción (IA). */
  prediction?: PredictionPayload;
  /** uPlot styling; partial merges over DEFAULT_CHART_APPEARANCE. */
  chartAppearance?: Partial<ChartAppearance>;
}

export interface GlobalTimeContext {
  startTime: string;
  endTime: string;
  resolution: number;
}
