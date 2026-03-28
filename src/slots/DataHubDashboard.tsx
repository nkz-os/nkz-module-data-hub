/**
 * DataHubDashboard — Orquestador del workspace táctico (Fase 2 + Fase 4 + Fase 5).
 * Grid, tiempo global, drop, Export/IA; global toolbar with Save/Load Workspace.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '@nekazari/sdk';
import ReactGridLayout from 'react-grid-layout/legacy';
import type { Layout, LayoutItem } from 'react-grid-layout';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { Download, Brain, Loader2, Save, FolderOpen } from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import { DATAHUB_EVENT_TIME_SELECT } from '../hooks/useUPlotCesiumSync';
import type { DataHubTimeRangeDetail } from '../hooks/useUPlotCesiumSync';
import type { ChartSeriesDef, DashboardPanel, GlobalTimeContext } from '../types/dashboard';
import {
  getIntelligenceStreamUrl,
  submitPredictJob,
  saveWorkspace,
  type DataHubWorkspacePayload,
  type DataHubWorkspaceStored,
  type WorkspaceLayoutPanel,
} from '../services/datahubApi';
import { DataCanvasPanelMemo } from './DataCanvasPanel';
import { ExportModal } from './ExportModal';
import { LoadWorkspaceModal } from './LoadWorkspaceModal';
import { IntegrationsPanel } from './IntegrationsPanel';
import { LabPanel } from './LabPanel';

function normalizePanel(panel: DashboardPanel & { entityId?: string; attribute?: string }): DashboardPanel {
  if (panel.series && panel.series.length > 0) return panel;
  if (panel.entityId != null && panel.attribute != null) {
    return {
      ...panel,
      series: [{ entityId: panel.entityId, attribute: panel.attribute, source: 'timescale' }],
      title: panel.title ?? `${panel.entityId} — ${panel.attribute}`,
    };
  }
  return { ...panel, series: [] };
}

const GRID_WIDTH_OFFSET = 300;

export interface DataHubDashboardProps {
  initialPanels?: DashboardPanel[];
  initialTimeContext: GlobalTimeContext;
}

function isTimeRangeDetail(d: unknown): d is DataHubTimeRangeDetail {
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof (d as DataHubTimeRangeDetail).min === 'number' &&
    typeof (d as DataHubTimeRangeDetail).max === 'number'
  );
}

export const DataHubDashboard: React.FC<DataHubDashboardProps> = ({
  initialPanels = [],
  initialTimeContext,
}) => {
  const { t } = useTranslation('datahub');
  const [panels, setPanels] = useState<DashboardPanel[]>(() =>
    initialPanels.map((p) => normalizePanel(p as DashboardPanel & { entityId?: string; attribute?: string }))
  );
  const [timeContext, setTimeContext] = useState<GlobalTimeContext>(initialTimeContext);
  const [exportModalPanel, setExportModalPanel] = useState<DashboardPanel | null>(null);
  const [predictingPanelId, setPredictingPanelId] = useState<string | null>(null);
  const [loadWorkspaceOpen, setLoadWorkspaceOpen] = useState(false);
  const [mainView, setMainView] = useState<'canvas' | 'integrations' | 'lab'>('canvas');
  const [saveMessage, setSaveMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveModalName, setSaveModalName] = useState('');
  const predictAbortRef = useRef<AbortController | null>(null);
  const [layoutWidth, setLayoutWidth] = useState(
    () => Math.max(800, (typeof window !== 'undefined' ? window.innerWidth : 1200) - GRID_WIDTH_OFFSET)
  );

  useEffect(() => {
    return () => {
      predictAbortRef.current?.abort();
      predictAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onResize = () =>
      setLayoutWidth(Math.max(800, window.innerWidth - GRID_WIDTH_OFFSET));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const handleGlobalZoom = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!isTimeRangeDetail(d)) return;
      const newStart = new Date(d.min * 1000).toISOString();
      const newEnd = new Date(d.max * 1000).toISOString();
      setTimeContext((prev) => ({
        ...prev,
        startTime: newStart,
        endTime: newEnd,
      }));
    };
    window.addEventListener(DATAHUB_EVENT_TIME_SELECT, handleGlobalZoom);
    return () => window.removeEventListener(DATAHUB_EVENT_TIME_SELECT, handleGlobalZoom);
  }, []);

  const onLayoutChange = useCallback((newLayout: Layout) => {
    setPanels((currentPanels) =>
      currentPanels.map((panel) => {
        const updated = newLayout.find((item: LayoutItem) => item.i === panel.id);
        return updated
          ? {
              ...panel,
              grid: {
                x: updated.x,
                y: updated.y,
                w: updated.w,
                h: updated.h,
              },
            }
          : panel;
      })
    );
  }, []);

  const onDrop = useCallback(
    (_layout: Layout, item: LayoutItem | undefined, e: Event) => {
      const dragEvent = e as DragEvent;
      const rawData = dragEvent.dataTransfer?.getData('application/json');
      if (!rawData) return;
      try {
        const newSeries = JSON.parse(rawData) as ChartSeriesDef & { type?: string };
        if (!newSeries.entityId || !newSeries.attribute || newSeries.type !== 'timeseries_chart') return;
        const dropX = item?.x ?? 0;
        const dropY = item?.y ?? 0;

        const targetPanelIndex = panels.findIndex(
          (p) =>
            dropX >= p.grid.x &&
            dropX < p.grid.x + p.grid.w &&
            dropY >= p.grid.y &&
            dropY < p.grid.y + p.grid.h
        );

        if (targetPanelIndex !== -1) {
          setPanels((current) => {
            const updated = [...current];
            const panel = { ...updated[targetPanelIndex] };
            const isDuplicate = panel.series.some(
              (s) => s.entityId === newSeries.entityId && s.attribute === newSeries.attribute
            );
            if (!isDuplicate) {
              panel.series = [...panel.series, { ...newSeries, source: newSeries.source ?? 'timescale' }];
              panel.title =
                panel.series.length === 1
                  ? `${panel.series[0].entityId} — ${panel.series[0].attribute}`
                  : t('dashboard.multiSeriesSources', { count: panel.series.length });
              updated[targetPanelIndex] = panel;
            }
            return updated;
          });
        } else {
          const newPanel: DashboardPanel = {
            id: crypto.randomUUID(),
            grid: { x: dropX, y: dropY, w: item?.w ?? 6, h: item?.h ?? 3 },
            type: 'timeseries_chart',
            title: `${newSeries.entityId} — ${newSeries.attribute}`,
            series: [{ ...newSeries, source: newSeries.source ?? 'timescale' }],
          };
          setPanels((current) => [...current, newPanel]);
        }
      } catch (err) {
        console.error('Drop payload error:', err);
      }
    },
    [panels, t]
  );

  const defaultDroppingItem: LayoutItem = {
    i: '__drop_placeholder__',
    x: 0,
    y: 0,
    w: 6,
    h: 3,
  };

  const handlePredict = useCallback(
    (panel: DashboardPanel) => {
      if (panel.series.length !== 1) return;
      const s = panel.series[0];
      predictAbortRef.current?.abort();
      const ac = new AbortController();
      predictAbortRef.current = ac;
      setPredictingPanelId(panel.id);
      submitPredictJob(
        s.entityId,
        s.attribute,
        timeContext.startTime,
        timeContext.endTime,
        24
      )
        .then((jobId) => {
          const url = getIntelligenceStreamUrl(jobId);
          fetchEventSource(url, {
            signal: ac.signal,
            credentials: 'include',
            onmessage(ev) {
              try {
                const d = JSON.parse(ev.data) as {
                  status?: string;
                  predictions?: Array<{ timestamp: string; value: number }>;
                };
                if (typeof d.status === 'string') {
                  if (d.status === 'completed') {
                    const preds = d.predictions;
                    if (Array.isArray(preds) && preds.length > 0) {
                      const timestamps = preds.map((p) => new Date(p.timestamp).getTime() / 1000);
                      const values = preds.map((p) => p.value);
                      setPanels((current) =>
                        current.map((p) =>
                          p.id === panel.id
                            ? { ...p, prediction: { timestamps, values } }
                            : p
                        )
                      );
                    }
                    setPredictingPanelId((id) => (id === panel.id ? null : id));
                    ac.abort();
                  } else if (d.status === 'error') {
                    setPredictingPanelId((id) => (id === panel.id ? null : id));
                    ac.abort();
                  }
                }
              } catch {
                // ignore non-JSON events
              }
            },
            onerror(err) {
              setPredictingPanelId((id) => (id === panel.id ? null : id));
              ac.abort();
              throw err;
            },
          });
        })
        .catch(() => setPredictingPanelId((id) => (id === panel.id ? null : id)));
    },
    [timeContext.startTime, timeContext.endTime]
  );

  const applyWorkspace = useCallback((saved: DataHubWorkspaceStored) => {
    if (saved.timeContext?.value) {
      setTimeContext(saved.timeContext.value);
    }
    const layoutValue = saved.layout?.value;
    if (Array.isArray(layoutValue) && layoutValue.length > 0) {
      const restoredPanels: DashboardPanel[] = layoutValue.map((p: WorkspaceLayoutPanel) => ({
        id: p.panelId,
        grid: p.grid,
        type: p.type,
        title: p.title,
        series: p.series ?? [],
      }));
      setPanels(restoredPanels.map((p) => normalizePanel(p)));
    }
    setLoadWorkspaceOpen(false);
  }, []);

  const showBanner = useCallback((text: string, type: 'success' | 'error') => {
    setSaveMessage({ text, type });
    setTimeout(() => setSaveMessage(null), 3000);
  }, []);

  const handleSaveWorkspace = useCallback(() => {
    setSaveModalName('');
    setShowSaveModal(true);
  }, []);

  const handleConfirmSave = useCallback(async () => {
    const workspaceName = saveModalName.trim();
    if (!workspaceName) return;
    setShowSaveModal(false);
    const payload: DataHubWorkspacePayload = {
      id: `urn:ngsi-ld:DataHubWorkspace:${crypto.randomUUID()}`,
      type: 'DataHubWorkspace',
      name: { type: 'Property', value: workspaceName },
      timeContext: { type: 'Property', value: timeContext },
      layout: {
        type: 'Property',
        value: panels.map((p) => ({
          panelId: p.id,
          grid: p.grid,
          type: p.type,
          title: p.title,
          series: p.series,
        })),
      },
    };
    try {
      await saveWorkspace(payload);
      showBanner(t('dashboard.workspaceSaved'), 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showBanner(t('dashboard.workspaceSaveError', { message: msg.slice(0, 100) }), 'error');
    }
  }, [panels, timeContext, saveModalName, showBanner, t]);

  const handleLoadWorkspace = useCallback(() => {
    setLoadWorkspaceOpen(true);
  }, []);

  return (
    <div
      className="w-full h-full min-h-screen bg-slate-950 flex flex-col overflow-x-hidden"
      style={{ isolation: 'isolate', zIndex: 0 }}
    >
      <div className="dashboard-global-toolbar h-12 shrink-0 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <h2 className="text-slate-200 font-semibold">{t('dashboard.tacticalCanvas')}</h2>
          <span className="text-slate-500 text-sm font-mono">{t('dashboard.activePanels', { count: panels.length })}</span>
          {saveMessage && (
            <span
              className={`text-xs px-2 py-1 rounded ${
                saveMessage.type === 'success'
                  ? 'bg-emerald-900/50 text-emerald-400'
                  : 'bg-red-900/50 text-red-400'
              }`}
              role="alert"
            >
              {saveMessage.text}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-slate-700 overflow-hidden mr-2">
            <button
              type="button"
              onClick={() => setMainView('canvas')}
              className={`px-3 py-1.5 text-xs ${
                mainView === 'canvas'
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('integrations.canvasTab')}
            </button>
            <button
              type="button"
              onClick={() => setMainView('integrations')}
              className={`px-3 py-1.5 text-xs ${
                mainView === 'integrations'
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('integrations.integrationsTab')}
            </button>
            <button
              type="button"
              onClick={() => setMainView('lab')}
              className={`px-3 py-1.5 text-xs ${
                mainView === 'lab'
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('lab.tab')}
            </button>
          </div>
          <button
            type="button"
            onClick={handleSaveWorkspace}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded transition-colors flex items-center gap-2"
          >
            <Save size={16} />
            {t('dashboard.saveWorkspace')}
          </button>
          <button
            type="button"
            onClick={handleLoadWorkspace}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded border border-slate-700 transition-colors flex items-center gap-2"
          >
            <FolderOpen size={16} />
            {t('dashboard.load')}
          </button>
        </div>
      </div>
      {mainView === 'integrations' ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <IntegrationsPanel panels={panels} timeContext={timeContext} />
        </div>
      ) : mainView === 'lab' ? (
        <div className="flex-1 min-h-0">
          <LabPanel />
        </div>
      ) : (
      <div className="flex-1 min-h-0 p-2">
      <ReactGridLayout
        className="layout"
        layout={panels.map((p) => ({ ...p.grid, i: p.id }))}
        cols={12}
        rowHeight={100}
        width={layoutWidth}
        onLayoutChange={onLayoutChange}
        draggableHandle=".panel-drag-handle"
        isDroppable={true}
        onDrop={onDrop}
        droppingItem={defaultDroppingItem}
      >
        {panels.map((panel) => (
          <div
            key={panel.id}
            className="flex flex-col bg-slate-900 border border-slate-800 rounded-lg overflow-hidden"
          >
            <div
              className={`panel-header flex justify-between items-center bg-slate-800 h-8 px-2 ${
                predictingPanelId === panel.id ? 'ring-1 ring-amber-500/80' : ''
              }`}
            >
              <div
                className="panel-drag-handle cursor-move flex-1 truncate text-xs text-slate-300 font-mono min-w-0"
                title={panel.title ??
                  (panel.series.length === 1
                    ? `${panel.series[0].entityId} / ${panel.series[0].attribute}`
                    : t('dashboard.multiSeriesShort', { count: panel.series.length }))}
              >
                {panel.title ??
                  (panel.series.length === 1
                    ? `${panel.series[0].entityId} / ${panel.series[0].attribute}`
                    : t('dashboard.multiSeriesShort', { count: panel.series.length }))}
              </div>
              <div className="panel-actions flex gap-1 shrink-0 items-center">
                {panel.series.length === 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePredict(panel);
                    }}
                    disabled={predictingPanelId === panel.id}
                    className="p-1.5 text-amber-500 hover:text-amber-400 disabled:opacity-70"
                    title={t('dashboard.predictTitle')}
                    aria-label={t('dashboard.predictAria')}
                  >
                    {predictingPanelId === panel.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Brain size={14} />
                    )}
                  </button>
                )}
                {panel.series.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExportModalPanel(panel);
                    }}
                    className="p-1.5 text-blue-400 hover:text-blue-300"
                    title={t('dashboard.exportTitle')}
                    aria-label={t('dashboard.exportAria')}
                  >
                    <Download size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 relative min-h-0">
              <DataCanvasPanelMemo
                panelId={panel.id}
                series={panel.series}
                startTime={timeContext.startTime}
                endTime={timeContext.endTime}
                resolution={timeContext.resolution}
                prediction={panel.prediction ?? null}
              />
            </div>
          </div>
        ))}
      </ReactGridLayout>
      </div>
      )}
      {exportModalPanel && (
        <ExportModal
          panel={exportModalPanel}
          timeContext={timeContext}
          onClose={() => setExportModalPanel(null)}
        />
      )}
      {loadWorkspaceOpen && (
        <LoadWorkspaceModal
          onSelect={applyWorkspace}
          onClose={() => setLoadWorkspaceOpen(false)}
        />
      )}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl w-full max-w-sm mx-4 p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">{t('dashboard.saveModalTitle')}</h3>
            <input
              type="text"
              value={saveModalName}
              onChange={(e) => setSaveModalName(e.target.value)}
              placeholder={t('dashboard.workspaceNamePlaceholder')}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmSave(); }}
              className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 mb-4 placeholder-slate-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100 border border-slate-600 rounded"
              >
                {t('dashboard.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmSave}
                disabled={!saveModalName.trim()}
                className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-500 disabled:opacity-50"
              >
                {t('dashboard.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
