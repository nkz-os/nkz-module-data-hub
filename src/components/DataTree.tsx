/**
 * DataTree — Entity tree sidebar for selecting timeseries attributes.
 * Supports click-to-select + drag-and-drop to grid panels.
 * Extracted from DataHubPanel to be shared across page and bottom-panel.
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { useQuery } from '@tanstack/react-query';
import {
  fetchDataHubEntities,
  type DataHubEntity,
  type DataHubEntityAttribute,
} from '../services/datahubApi';

/** Attributes that are not numeric timeseries. */
const NON_TIMESERIES_ATTRIBUTES = new Set([
  'location', 'type', 'name', 'id', '@context', 'dateCreated', 'dateModified',
  'refParcel', 'seeAlso', 'ownedBy', 'category', 'description', 'address',
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
}

export const DataTree: React.FC<DataTreeProps> = ({
  selectedEntity,
  selectedAttribute,
  onSelect,
  onAddToCanvas,
}) => {
  const { t } = useTranslation('datahub');
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['datahub', 'entities', search || null],
    queryFn: () => fetchDataHubEntities(search || undefined),
    placeholderData: (prev) => prev,
  });

  const entities = useMemo(() => data?.entities ?? [], [data?.entities]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2 border-b border-slate-700">
        <input
          type="search"
          placeholder={t('tree.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-600 rounded bg-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
        />
      </div>
      <div className="flex-1 overflow-auto p-2">
        {isLoading && <p className="text-sm text-slate-500">{t('tree.loading')}</p>}
        {error && <p className="text-sm text-red-400">{t('tree.errorLoad')}</p>}
        {!isLoading && !error && entities.length === 0 && (
          <p className="text-sm text-slate-500">{t('tree.empty')}</p>
        )}
        {!isLoading && !error && entities.length > 0 && (
          <ul className="space-y-1 text-sm">
            {entities.map((e: DataHubEntity) => (
              <li key={e.id} className="space-y-0.5">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    const ts = timeseriesAttributes(e.attributes);
                    const first = ts[0];
                    onSelect(e, first?.name ?? '');
                    // Match leaf attribute behavior: one click on the entity row adds the first
                    // plottable attribute to the canvas (otherwise the chart stays empty).
                    if (first) {
                      onAddToCanvas?.(e, first.name);
                    }
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      const ts = timeseriesAttributes(e.attributes);
                      const first = ts[0];
                      onSelect(e, first?.name ?? '');
                      if (first) {
                        onAddToCanvas?.(e, first.name);
                      }
                    }
                  }}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                    selectedEntity?.id === e.id
                      ? 'bg-slate-700 ring-1 ring-emerald-500/40'
                      : 'hover:bg-slate-800'
                  }`}
                >
                  <span className="font-medium text-slate-200 truncate">{e.name}</span>
                  <span className="text-slate-500 shrink-0 text-xs">{e.type}</span>
                </div>
                {selectedEntity?.id === e.id && timeseriesAttributes(e.attributes).length > 0 && (
                  <ul className="pl-3 text-xs">
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
                          className={`py-1 rounded px-1.5 cursor-grab active:cursor-grabbing transition-colors ${
                            selectedAttribute === attr.name
                              ? 'bg-emerald-900/40 text-emerald-300 ring-1 ring-emerald-500/30'
                              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                          }`}
                        >
                          <span>{attr.name}</span>
                          {ATTRIBUTE_UNIT[attr.name] && (
                            <span className="text-slate-500 ml-1">({ATTRIBUTE_UNIT[attr.name]})</span>
                          )}
                          {attr.source && attr.source !== 'timescale' && (
                            <span className="text-slate-600 ml-1 text-[10px]">
                              [{attr.source}]
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
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
