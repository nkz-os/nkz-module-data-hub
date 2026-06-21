/**
 * DataTree — Entity tree sidebar for selecting timeseries attributes.
 * Supports click-to-select + drag-and-drop to grid panels.
 * Extracted from DataHubPanel to be shared across page and bottom-panel.
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@nekazari/module-kit';
import {
  fetchDataHubEntities,
  type DataHubEntity,
  type DataHubEntityAttribute,
} from '../services/datahubApi';
import { useSensorHealth, type ReliabilityStatus } from '../hooks/useSensorHealth';
import { HealthIndicator } from './sensor-panel/HealthIndicator';
import { SilenceButton } from './sensor-panel/SilenceButton';
import { AlertList } from './alert-panel/AlertList';
import { CalibrationPanel } from './calibration/CalibrationPanel';

/** Attributes that are not numeric timeseries. */
const NON_TIMESERIES_ATTRIBUTES = new Set([
  'location', 'type', 'name', 'id', '@context', 'dateCreated', 'dateModified',
  'locatedAt', 'refParcel', 'seeAlso', 'ownedBy', 'category', 'description', 'address',
  'area', 'landLocation', 'ndviEnabled',
]);

const timeseriesAttributes = (attrs: DataHubEntityAttribute[]) =>
  attrs.filter((a) => !NON_TIMESERIES_ATTRIBUTES.has(a.name));

/** Attribute-to-unit for display */
const ATTRIBUTE_UNIT: Record<string, string> = {
  temp_avg: '°C', temp_min: '°C', temp_max: '°C', temperature: '°C',
  humidity_avg: '%', humidity_min: '%', humidity_max: '%', humidity: '%',
  precip_mm: 'mm', precipitation: 'mm',
  solar_rad_w_m2: 'W/m²', radiation: 'W/m²',
  eto_mm: 'mm',
  soil_moisture_0_10cm: '%', soil_moisture: '%',
  wind_speed_ms: 'm/s', wind_speed_avg: 'm/s', wind_speed_max: 'm/s', wind_speed: 'm/s',
  pressure_hpa: 'hPa', pressure_avg: 'hPa', pressure: 'hPa',
  ndvi: '', ndviMean: '', evi: '', savi: '', gndvi: '', ndre: '', ndwi: '',
  delta_t: '°C', gdd_accumulated: 'GDD',
};

export interface DataTreeProps {
  selectedEntity: DataHubEntity | null;
  selectedAttribute: string | null;
  onSelect: (entity: DataHubEntity, attribute: string) => void;
  /** Called when an attribute is added to the canvas (click or drag). */
  onAddToCanvas?: (entity: DataHubEntity, attribute: string) => void;
  /** Whether a panel is active — shows "+" badge on attributes for multi-series add. */
  hasActivePanel?: boolean;
}

function isAgriSensor(type: string) {
  return type === 'AgriSensor' || type === 'Device' || type === 'AgriDevice';
}

/** Health dot — fetches real status only when selected (avoid N+1). */
function SensorHealthDot({ entityId }: { entityId: string }) {
  const health = useSensorHealth(entityId);
  if (health.loading) {
    return <span className="inline-block w-2 h-2 rounded-full bg-gray-400 animate-pulse shrink-0" title="…" />;
  }
  const colorMap: Record<ReliabilityStatus, string> = {
    optimal: 'bg-green-500',
    degraded: 'bg-yellow-500',
    error: 'bg-red-500',
    maintenance: 'bg-blue-500',
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colorMap[health.reliabilityStatus] ?? 'bg-gray-400'} shrink-0`}
      title={health.reliabilityStatus}
    />
  );
}

/** Expanded health detail for the selected sensor entity. */
function SensorHealthDetail({ entityId, tenantId }: { entityId: string; tenantId: string }) {
  const health = useSensorHealth(entityId);
  const { t } = useTranslation('datahub');

  if (health.loading) {
    return <div className="px-3 py-2 text-xs text-gray-500">{t('sensor.healthLoading', { defaultValue: 'Loading health…' })}</div>;
  }

  return (
    <div className="px-3 py-2 space-y-3 border-t dh-border-default/50 mt-2">
      <div className="flex items-center justify-between">
        <HealthIndicator status={health.reliabilityStatus} isSilenced={health.isSilenced} />
        <SilenceButton
          entityId={entityId}
          isSilenced={health.isSilenced}
          onToggle={() => health.refetch()}
        />
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer dh-text-secondary hover:dh-text-primary font-medium">
          {t('sensor.activeAlerts', { defaultValue: 'Alertas activas' })}
        </summary>
        <div className="mt-2">
          <AlertList tenantId={tenantId} sensorId={entityId} />
        </div>
      </details>
      <CalibrationPanel sensorId={entityId} />
    </div>
  );
}

export const DataTree: React.FC<DataTreeProps> = ({
  selectedEntity,
  selectedAttribute,
  onSelect,
  onAddToCanvas,
  hasActivePanel = false,
}) => {
  const { t } = useTranslation('datahub');
  const { tenantId } = useAuth();
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['datahub', 'entities', search || null],
    queryFn: () => fetchDataHubEntities(search || undefined),
    placeholderData: (prev) => prev,
  });

  const entities = useMemo(() => data?.entities ?? [], [data?.entities]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2 border-b dh-border-default/50">
        <input
          type="search"
          placeholder={t('tree.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 text-sm border dh-border-light rounded dh-bg-surface-alt dh-text-primary placeholder-current opacity-50 focus:outline-none focus:ring-1 focus:dh-accent-border/50"
        />
      </div>
      <div className="flex-1 overflow-auto p-2">
        {isLoading && <p className="text-sm dh-text-secondary">{t('tree.loading')}</p>}
        {error && <p className="text-sm text-red-400">{t('tree.errorLoad')}</p>}
        {!isLoading && !error && entities.length === 0 && (
          <p className="text-sm dh-text-secondary">{t('tree.empty')}</p>
        )}
        {!isLoading && !error && entities.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {entities.map((e: DataHubEntity) => (
              <li key={e.id} className="space-y-0.5 group">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    const ts = timeseriesAttributes(e.attributes);
                    const first = ts[0];
                    onSelect(e, first?.name ?? '');
                    // No auto-plot — only add to canvas when a specific attribute is clicked.
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      const ts = timeseriesAttributes(e.attributes);
                      const first = ts[0];
                      onSelect(e, first?.name ?? '');
                    }
                  }}
                  className={`flex items-center gap-2 px-2 py-2 rounded cursor-pointer transition-colors ${
                    selectedEntity?.id === e.id
                      ? 'dh-bg-surface-alt ring-1 dh-accent-border/40'
                      : 'hover:dh-bg-surface-alt'
                  }`}
                >
                  <span className="font-medium dh-text-primary truncate">{e.name}</span>
                  {isAgriSensor(e.type) && (
                    selectedEntity?.id === e.id
                      ? <SensorHealthDot entityId={e.id} />
                      : <span className="inline-block w-2 h-2 rounded-full bg-gray-400 shrink-0" title="unknown" />
                  )}
                  <span className="dh-text-muted shrink-0 text-xs">{e.type}</span>
                </div>
                {selectedEntity?.id === e.id && timeseriesAttributes(e.attributes).length > 0 && (
                  <ul className="pl-3 text-sm">
                    {timeseriesAttributes(e.attributes).map((attr) => {
                      const handleDragStart = (ev: React.DragEvent<HTMLElement>) => {
                        const payload = JSON.stringify({
                          entityId: e.id,
                          attribute: attr.name,
                          source: attr.source,
                          type: 'timeseries_chart',
                        });
                        ev.dataTransfer.setData('application/json', payload);
                        ev.dataTransfer.effectAllowed = 'copy';
                      };
                      return (
                        <li
                          key={attr.name}
                          role="button"
                          tabIndex={0}
                          draggable
                          onDragStart={handleDragStart}
                          onClick={() => {
                            onSelect(e, attr.name);
                            onAddToCanvas?.(e, attr.name);
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter' || ev.key === ' ') {
                              onSelect(e, attr.name);
                              onAddToCanvas?.(e, attr.name);
                            }
                          }}
                          className={`py-1.5 rounded px-2 cursor-grab active:cursor-grabbing transition-colors ${
                            selectedAttribute === attr.name
                              ? 'dh-accent-bg dh-accent-text ring-1 dh-accent-border/40'
                              : 'dh-text-secondary hover:dh-bg-surface-alt hover:dh-text-primary'
                          }`}
                        >
                          <span>{attr.name}</span>
                          {ATTRIBUTE_UNIT[attr.name] && (
                            <span className="dh-text-secondary ml-1">({ATTRIBUTE_UNIT[attr.name]})</span>
                          )}
                          {attr.source && attr.source !== 'timescale' && (
                            <span className="dh-text-muted ml-1 text-xs">
                              [{attr.source}]
                            </span>
                          )}
                          {hasActivePanel && (
                            <span className="ml-auto text-xs dh-accent-text dh-accent-bg px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                              + {t('tree.addToPanel')}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {/* Sensor health detail — shown after attributes for the selected sensor */}
                {selectedEntity?.id === e.id && isAgriSensor(e.type) && tenantId && (
                  <SensorHealthDetail entityId={e.id} tenantId={tenantId} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default DataTree;
