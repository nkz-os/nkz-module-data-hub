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

/** Y-axis scale strategy. Phase 5 (B3 + C2). */
export type YScaleMode = 'auto' | 'fit-visible' | 'focus' | 'manual';

/** Rolling average window (Phase 7). 'off' disables overlay. */
export type RollingAvgWindow = 'off' | '1h' | '24h' | '7d';

/** Per-series user override (Phase 4 series rail). Identified by `${entityId}|${attribute}|${source}`. */
export interface SeriesConfig {
  /** Hide the series from the chart without removing it from the panel. */
  visible?: boolean;
  /** Hex colour overriding the default palette assignment. */
  colorOverride?: string;
  /** Explicit axis assignment; null/undefined → auto-distribute by magnitude. */
  yAxis?: 'left' | 'right';
}

/** Threshold line displayed across the chart (Phase 8). */
export interface ThresholdLine {
  /** Y value where the line is drawn. */
  value: number;
  /** Hex colour. */
  color: string;
  /** Visible label rendered next to the line. */
  label: string;
  /** Which axis the value is on. */
  axis: 'left' | 'right';
  /** 'solid' | 'dash' | 'dot'. */
  style?: 'solid' | 'dash' | 'dot';
}

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
  /** Y-scale strategy (Phase 5). */
  yScaleMode: YScaleMode;
  /** Manual Y range when yScaleMode === 'manual'. Per-axis. */
  yScaleManual?: { left?: { min: number; max: number }; right?: { min: number; max: number } };
  /** Per-series UI overrides keyed by `${entityId}|${attribute}|${source}`. */
  seriesConfig?: Record<string, SeriesConfig>;
  /** User-defined threshold lines (overlays platform defaults from attribute → threshold dictionary). */
  thresholds?: ThresholdLine[];
  /** Rolling-average overlay window (Phase 7). */
  rollingAverage?: RollingAvgWindow;
}

export const DEFAULT_CHART_APPEARANCE: ChartAppearance = {
  viewMode: 'timeseries',
  mode: 'line',
  lineWidth: 2,
  pointRadius: 0,
  showTrendline: false,
  correlationXSeries: 0,
  correlationYSeries: 1,
  yScaleMode: 'auto',
  rollingAverage: 'off',
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
