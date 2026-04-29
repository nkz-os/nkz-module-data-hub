/**
 * Workspace templates — preset dashboards for common analytical workflows.
 * Each template defines panel layouts with placeholder entity IDs that the
 * UI resolves to real NGSI-LD entities when the user picks one.
 */

import type { WorkspaceLayoutPanel } from './datahubApi';

export interface WorkspaceTemplate {
  id: string;
  nameKey: string;
  descriptionKey: string;
  icon: 'Sprout' | 'CloudSun' | 'Activity' | 'Thermometer';
  panels: WorkspaceLayoutPanel[];
}

function p(
  panelId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  series: Array<{ entityId: string; attribute: string; source: string }>,
): WorkspaceLayoutPanel {
  return {
    panelId,
    grid: { x, y, w, h },
    type: 'timeseries_chart',
    title,
    series,
    chartAppearance: {
      viewMode: 'timeseries',
      mode: 'line',
      yScaleMode: 'auto',
      rollingAverage: 'off',
    },
  };
}

export const PLACEHOLDER_PREFIX = '__template__';
const PH = (n: number) => `${PLACEHOLDER_PREFIX}:${n}`;

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'parcel-monitor',
    nameKey: 'templates.parcelMonitor',
    descriptionKey: 'templates.parcelMonitorDesc',
    icon: 'Sprout',
    panels: [
      p('t1', 0, 0, 6, 4, 'NDVI', [
        { entityId: PH(0), attribute: 'ndviMean', source: 'vegetation_health' },
      ]),
      p('t2', 6, 0, 6, 4, 'Temperatura + Humedad', [
        { entityId: PH(0), attribute: 'temperature', source: 'timescale' },
        { entityId: PH(0), attribute: 'relativeHumidity', source: 'timescale' },
      ]),
      p('t3', 0, 5, 6, 4, 'Precipitación', [
        { entityId: PH(0), attribute: 'precipitation', source: 'timescale' },
      ]),
      p('t4', 6, 5, 6, 4, 'GDD Acumulado', [
        { entityId: PH(0), attribute: 'gdd_accumulated', source: 'timescale' },
      ]),
    ],
  },
  {
    id: 'weather-station',
    nameKey: 'templates.weatherStation',
    descriptionKey: 'templates.weatherStationDesc',
    icon: 'CloudSun',
    panels: [
      p('t1', 0, 0, 6, 4, 'Temperatura', [
        { entityId: PH(0), attribute: 'temperature', source: 'timescale' },
        { entityId: PH(0), attribute: 'temp_min', source: 'timescale' },
        { entityId: PH(0), attribute: 'temp_max', source: 'timescale' },
      ]),
      p('t2', 6, 0, 6, 4, 'Humedad + Presión', [
        { entityId: PH(0), attribute: 'relativeHumidity', source: 'timescale' },
        { entityId: PH(0), attribute: 'atmosphericPressure', source: 'timescale' },
      ]),
      p('t3', 0, 5, 6, 4, 'Viento', [
        { entityId: PH(0), attribute: 'windSpeed', source: 'timescale' },
        { entityId: PH(0), attribute: 'windDirection', source: 'timescale' },
      ]),
      p('t4', 6, 5, 6, 4, 'Precipitación', [
        { entityId: PH(0), attribute: 'precipitation', source: 'timescale' },
      ]),
    ],
  },
  {
    id: 'crop-health',
    nameKey: 'templates.cropHealth',
    descriptionKey: 'templates.cropHealthDesc',
    icon: 'Activity',
    panels: [
      p('t1', 0, 0, 6, 5, 'Estrés hídrico', [
        { entityId: PH(0), attribute: 'eto_mm', source: 'timescale' },
        { entityId: PH(0), attribute: 'precipitation', source: 'timescale' },
      ]),
      p('t2', 6, 0, 6, 5, 'Índices de vegetación', [
        { entityId: PH(0), attribute: 'ndviMean', source: 'vegetation_health' },
        { entityId: PH(0), attribute: 'evi', source: 'vegetation_health' },
      ]),
    ],
  },
  {
    id: 'sensor-live',
    nameKey: 'templates.sensorLive',
    descriptionKey: 'templates.sensorLiveDesc',
    icon: 'Thermometer',
    panels: [
      p('t1', 0, 0, 12, 6, 'Temperatura suelo + Humedad', [
        { entityId: PH(0), attribute: 'soilTemperature', source: 'timescale' },
        { entityId: PH(0), attribute: 'soilMoisture', source: 'timescale' },
      ]),
    ],
  },
];
