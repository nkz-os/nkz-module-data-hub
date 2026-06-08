/**
 * DataHubQuickChart — Compact bottom-panel widget for the unified Cesium viewer.
 * Shows a single entity's timeseries chart with bidirectional Cesium time sync.
 * Lightweight: no grid, no workspace, no chart-style toolbar (defaults only; full controls on module page).
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { DataTree } from '../components/DataTree';
import { DataCanvasPanelMemo } from './panel/DataCanvasPanel';
import type { DataHubEntity } from '../services/datahubApi';
import type { ChartSeriesDef } from '../types/dashboard';

const RESOLUTION = 1000;

function defaultTimeRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

const DataHubQuickChart: React.FC = () => {
  const { t } = useTranslation('datahub');
  const [selectedEntity, setSelectedEntity] = useState<DataHubEntity | null>(null);
  const [selectedAttribute, setSelectedAttribute] = useState<string | null>(null);
  const [series, setSeries] = useState<ChartSeriesDef[]>([]);
  const [timeRange] = useState(defaultTimeRange);

  const handleSelect = useCallback((entity: DataHubEntity, attribute: string) => {
    setSelectedEntity(entity);
    setSelectedAttribute(attribute);
  }, []);

  const handleAdd = useCallback((entity: DataHubEntity, attribute: string) => {
    const attrDef = entity.attributes.find((a) => a.name === attribute);
    const source = attrDef?.source ?? entity.source ?? 'timescale';
    // In compact mode, replace series instead of stacking
    setSeries([{ entityId: entity.id, attribute, source }]);
  }, []);

  return (
    <div className="datahub-dark flex h-full text-[#8b95a5] bg-[#090d14]">
      {/* Narrow entity tree */}
      <div className="w-56 shrink-0 border-r border-[#1e2738] overflow-hidden">
        <DataTree
          selectedEntity={selectedEntity}
          selectedAttribute={selectedAttribute}
          onSelect={handleSelect}
          onAddToCanvas={handleAdd}
        />
      </div>
      {/* Chart area */}
      <div className="flex-1 min-w-0 relative">
        {series.length > 0 ? (
          <>
            <div className="absolute top-2 left-3 z-10 text-xs text-[#596373] font-mono truncate max-w-[50%]">
              {series[0].entityId.split(':').pop()} · {series[0].attribute}
            </div>
            <DataCanvasPanelMemo
              panelId="quick-chart"
              series={series}
              startTime={timeRange.start}
              endTime={timeRange.end}
              resolution={RESOLUTION}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-[#596373] text-sm">
            {t('panel.canvasEmptyHint')}
          </div>
        )}
      </div>
    </div>
  );
};

export default DataHubQuickChart;
