/**
 * DataHubDashboard — Orquestador del workspace táctico (Fase 2 + Fase 4 + Fase 5).
 * Grid, tiempo global, drop, Export/IA; global toolbar with Save/Load Workspace.
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { useTranslation } from '@nekazari/sdk';
import ReactGridLayout from 'react-grid-layout/legacy';
import type { Layout, LayoutItem } from 'react-grid-layout';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { Download, Brain, Loader2, Save, FolderOpen, Trash2 } from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import { DATAHUB_EVENT_TIME_SELECT } from '../hooks/useUPlotCesiumSync';
import type { DataHubTimeRangeDetail } from '../hooks/useUPlotCesiumSync';
import type {
  ChartAppearance,
  ChartSeriesDef,
  DashboardPanel,
  GlobalTimeContext,
} from '../types/dashboard';
import {
  getIntelligenceStreamUrl,
  submitPredictJob,
  saveWorkspace,
  type DataHubEntity,
  type DataHubWorkspacePayload,
  type DataHubWorkspaceStored,
  type WorkspaceLayoutPanel,
} from '../services/datahubApi';
import { DataCanvasPanelMemo } from './DataCanvasPanelLite';
import { ExportModal } from './ExportModal';
import { LoadWorkspaceModal } from './LoadWorkspaceModal';
import { IntegrationsPanel } from './IntegrationsPanel';
import { LabPanel } from './LabPanel';

function normalizePanel(panel: DashboardPanel & { entityId?: string; attribute?: string }): DashboardPanel {
  if (panel.series && panel.series.length > 0) {
    return {
      ...panel,
      series: panel.series.map((s) => ({ ...s, yAxis: s.yAxis ?? 'left' })),
    };
  }
  if (panel.entityId != null && panel.attribute != null) {
    return {
      ...panel,
      series: [{ entityId: panel.entityId, attribute: panel.attribute, source: 'timescale', yAxis: 'left' }],
      title: panel.title ?? `${panel.entityId} — ${panel.attribute}`,
    };
  }
  return { ...panel, series: [] };
}

const GRID_WIDTH_OFFSET = 300;
const PANEL_DEFAULT_W = 8;
const PANEL_DEFAULT_H = 5;
const PANEL_MIN_W = 3;
const PANEL_MIN_H = 2;

/** Input value for type="datetime-local" from an ISO 8601 string (local timezone). */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface DataHubDashboardProps {
  initialPanels?: DashboardPanel[];
  initialTimeContext: GlobalTimeContext;
}

/** Imperative API so the host page can add a chart when the user picks an attribute in the tree. */
export interface DataHubDashboardHandle {
  addSeriesFromTree: (entity: DataHubEntity, attribute: string) => void;
}

function isTimeRangeDetail(d: unknown): d is DataHubTimeRangeDetail {
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof (d as DataHubTimeRangeDetail).min === 'number' &&
    typeof (d as DataHubTimeRangeDetail).max === 'number'
  );
}

export const DataHubDashboard = forwardRef<DataHubDashboardHandle, DataHubDashboardProps>(
  function DataHubDashboard({ initialPanels = [], initialTimeContext }, ref) {
  const { t } = useTranslation('datahub');
  const [panels, setPanels] = useState<DashboardPanel[]>(() =>
    initialPanels.map((p) => normalizePanel(p as DashboardPanel & { entityId?: string; attribute?: string }))
  );
  const [timeContext, setTimeContext] = useState<GlobalTimeContext>(initialTimeContext);
  const [exportModalPanel, setExportModalPanel] = useState<DashboardPanel | null>(null);
  const [predictingPanelId, setPredictingPanelId] = useState<string | null>(null);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [loadWorkspaceOpen, setLoadWorkspaceOpen] = useState(false);
  const [mainView, setMainView] = useState<'canvas' | 'integrations' | 'lab'>('canvas');
  const [saveMessage, setSaveMessage] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveModalName, setSaveModalName] = useState('');
  const predictAbortRef = useRef<AbortController | null>(null);
  const [layoutWidth, setLayoutWidth] = useState(
    () => Math.max(800, (typeof window !== 'undefined' ? window.innerWidth : 1200) - GRID_WIDTH_OFFSET)
  );
  const [draftRangeStart, setDraftRangeStart] = useState(() =>
    toDatetimeLocalValue(initialTimeContext.startTime)
  );
  const [draftRangeEnd, setDraftRangeEnd] = useState(() =>
    toDatetimeLocalValue(initialTimeContext.endTime)
  );

  const panelsRef = useRef(panels);
  panelsRef.current = panels;

  useEffect(() => {
    if (panels.length === 0) {
      setActivePanelId(null);
      return;
    }
    if (!activePanelId || !panels.some((p) => p.id === activePanelId)) {
      setActivePanelId(panels[0].id);
    }
  }, [panels, activePanelId]);

  useEffect(() => {
    setDraftRangeStart(toDatetimeLocalValue(timeContext.startTime));
    setDraftRangeEnd(toDatetimeLocalValue(timeContext.endTime));
  }, [timeContext.startTime, timeContext.endTime]);

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
          const targetPanel = panels[targetPanelIndex];
          const isDuplicate = targetPanel.series.some(
            (s) => s.entityId === newSeries.entityId && s.attribute === newSeries.attribute
          );
          if (isDuplicate) {
            setSaveMessage({ text: t('dashboard.duplicateSeries'), type: 'info' });
            setTimeout(() => setSaveMessage(null), 3000);
            return;
          }
          setPanels((current) => {
            const updated = [...current];
            const panel = { ...updated[targetPanelIndex] };
            panel.series = [...panel.series, { ...newSeries, source: newSeries.source ?? 'timescale', yAxis: 'left' }];
            panel.title =
              panel.series.length === 1
                ? `${panel.series[0].entityId} — ${panel.series[0].attribute}`
                : t('dashboard.multiSeriesSources', { count: panel.series.length });
            updated[targetPanelIndex] = panel;
            return updated;
          });
          setActivePanelId(targetPanel.id);
        } else {
          const newPanel: DashboardPanel = {
            id: crypto.randomUUID(),
            grid: { x: dropX, y: dropY, w: item?.w ?? PANEL_DEFAULT_W, h: item?.h ?? PANEL_DEFAULT_H },
            type: 'timeseries_chart',
            title: `${newSeries.entityId} — ${newSeries.attribute}`,
            series: [{ ...newSeries, source: newSeries.source ?? 'timescale', yAxis: 'left' }],
          };
          setPanels((current) => [...current, newPanel]);
          setActivePanelId(newPanel.id);
        }
      } catch (err) {
        console.error('Drop payload error:', err);
      }
    },
    [panels, t]
  );

  const onEmptyCanvasDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onEmptyCanvasDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rawData = e.dataTransfer?.getData('application/json');
    if (!rawData) return;
    try {
      const newSeries = JSON.parse(rawData) as ChartSeriesDef & { type?: string };
      if (!newSeries.entityId || !newSeries.attribute || newSeries.type !== 'timeseries_chart') return;
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `panel-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const newPanel: DashboardPanel = {
        id,
        grid: { x: 0, y: 0, w: PANEL_DEFAULT_W, h: PANEL_DEFAULT_H },
        type: 'timeseries_chart',
        title: `${newSeries.entityId} — ${newSeries.attribute}`,
        series: [{ ...newSeries, source: newSeries.source ?? 'timescale' }],
      };
      setPanels([newPanel]);
      setActivePanelId(newPanel.id);
    } catch (err) {
      console.error('Empty canvas drop error:', err);
    }
  }, []);

  const defaultDroppingItem: LayoutItem = {
    i: '__drop_placeholder__',
    x: 0,
    y: 0,
    w: PANEL_DEFAULT_W,
    h: PANEL_DEFAULT_H,
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
        chartAppearance: p.chartAppearance,
      }));
      setPanels(restoredPanels.map((p) => normalizePanel(p)));
    }
    setLoadWorkspaceOpen(false);
  }, []);

  const showBanner = useCallback((text: string, type: 'success' | 'error' | 'info') => {
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
          ...(p.chartAppearance && Object.keys(p.chartAppearance).length > 0
            ? { chartAppearance: p.chartAppearance }
            : {}),
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

  const applyPreset = useCallback((preset: '24h' | '7d' | '30d') => {
    const end = new Date();
    const start = new Date(end.getTime());
    const day = 24 * 60 * 60 * 1000;
    if (preset === '24h') start.setTime(start.getTime() - day);
    else if (preset === '7d') start.setTime(start.getTime() - 7 * day);
    else start.setTime(start.getTime() - 30 * day);
    setTimeContext((prev) => ({
      ...prev,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    }));
  }, []);

  const updatePanelAppearance = useCallback((panelId: string, next: ChartAppearance) => {
    setPanels((ps) => ps.map((x) => (x.id === panelId ? { ...x, chartAppearance: next } : x)));
  }, []);

  const updatePanelSeriesAxis = useCallback((panelId: string, seriesIndex: number, yAxis: 'left' | 'right') => {
    setPanels((ps) =>
      ps.map((panel) => {
        if (panel.id !== panelId) return panel;
        if (seriesIndex < 0 || seriesIndex >= panel.series.length) return panel;
        const nextSeries = panel.series.map((s, idx) => (idx === seriesIndex ? { ...s, yAxis } : s));
        return { ...panel, series: nextSeries };
      })
    );
  }, []);

  const applyCustomRange = useCallback(() => {
    const s = new Date(draftRangeStart);
    const e = new Date(draftRangeEnd);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s >= e) {
      showBanner(t('dashboard.invalidRange'), 'error');
      return;
    }
    setTimeContext((prev) => ({
      ...prev,
      startTime: s.toISOString(),
      endTime: e.toISOString(),
    }));
  }, [draftRangeStart, draftRangeEnd, showBanner, t]);

  const removePanel = useCallback((panelId: string) => {
    setPanels((p) => p.filter((x) => x.id !== panelId));
    setActivePanelId((current) => (current === panelId ? null : current));
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      addSeriesFromTree: (entity: DataHubEntity, attribute: string) => {
        const current = panelsRef.current;
        const attrMeta = entity.attributes.find((a) => a.name === attribute);
        const source = attrMeta?.source ?? entity.source ?? 'timescale';
        const nextSeries: ChartSeriesDef = { entityId: entity.id, attribute, source, yAxis: 'left' };
        const targetIdx = activePanelId
          ? current.findIndex((p) => p.id === activePanelId)
          : -1;

        if (targetIdx !== -1) {
          const target = current[targetIdx];
          const duplicateInTarget = target.series.some(
            (s) => s.entityId === entity.id && s.attribute === attribute
          );
          if (duplicateInTarget) {
            showBanner(t('dashboard.duplicateSeries'), 'info');
            return;
          }
          const updated = [...current];
          const mergedSeries = [...target.series, nextSeries];
          updated[targetIdx] = {
            ...target,
            series: mergedSeries,
            title:
              mergedSeries.length === 1
                ? `${entity.name} — ${attribute}`
                : t('dashboard.multiSeriesSources', { count: mergedSeries.length }),
          };
          setPanels(updated);
          setActivePanelId(target.id);
          setMainView('canvas');
          return;
        }

        const nextY =
          current.length === 0 ? 0 : Math.max(...current.map((p) => p.grid.y + p.grid.h));
        const id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `panel-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const newPanel: DashboardPanel = {
          id,
          grid: { x: 0, y: nextY, w: PANEL_DEFAULT_W, h: PANEL_DEFAULT_H },
          type: 'timeseries_chart',
          title: `${entity.name} — ${attribute}`,
          series: [nextSeries],
        };
        setPanels([...current, newPanel]);
        setActivePanelId(id);
        setMainView('canvas');
      },
    }),
    [showBanner, t, activePanelId]
  );

  return (
    <div
      className="w-full h-full min-h-screen bg-slate-950 flex flex-col overflow-x-hidden"
      style={{ isolation: 'isolate', zIndex: 0 }}
    >
      <div className="shrink-0 border-b border-slate-800 bg-slate-900 flex flex-col">
      <div className="dashboard-global-toolbar h-12 flex items-center justify-between px-4">
        <div className="flex items-center gap-4 min-w-0">
          <h2 className="text-slate-200 font-semibold shrink-0">{t('dashboard.tacticalCanvas')}</h2>
          <span className="text-slate-500 text-sm font-mono">{t('dashboard.activePanels', { count: panels.length })}</span>
          {saveMessage && (
            <span
              className={`text-xs px-2 py-1 rounded ${
                saveMessage.type === 'success'
                  ? 'bg-emerald-900/50 text-emerald-400'
                  : saveMessage.type === 'info'
                    ? 'bg-slate-800/90 text-slate-300 border border-slate-600/80'
                    : 'bg-red-900/50 text-red-400'
              }`}
              role={saveMessage.type === 'error' ? 'alert' : 'status'}
              aria-live={saveMessage.type === 'error' ? 'assertive' : 'polite'}
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
      {mainView === 'canvas' && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-t border-slate-800/80 bg-slate-950/80">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 shrink-0">
            {t('dashboard.timeRange')}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {(['24h', '7d', '30d'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                className="px-2 py-1 text-xs rounded border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 hover:border-slate-600 transition-colors"
              >
                {preset === '24h'
                  ? t('dashboard.preset24h')
                  : preset === '7d'
                    ? t('dashboard.preset7d')
                    : t('dashboard.preset30d')}
              </button>
            ))}
          </div>
          <span className="hidden sm:inline w-px h-4 bg-slate-700 mx-1 shrink-0" aria-hidden />
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <span className="shrink-0">{t('dashboard.customFrom')}</span>
            <input
              type="datetime-local"
              value={draftRangeStart}
              onChange={(e) => setDraftRangeStart(e.target.value)}
              className="rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-1.5 py-1"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <span className="shrink-0">{t('dashboard.customTo')}</span>
            <input
              type="datetime-local"
              value={draftRangeEnd}
              onChange={(e) => setDraftRangeEnd(e.target.value)}
              className="rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-1.5 py-1"
            />
          </label>
          <button
            type="button"
            onClick={applyCustomRange}
            className="px-2 py-1 text-xs rounded bg-emerald-700/90 text-white hover:bg-emerald-600 transition-colors"
          >
            {t('dashboard.applyRange')}
          </button>
        </div>
      )}
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
      <div className="flex-1 min-h-0 p-2 flex flex-col">
        {panels.length === 0 ? (
          <div
            className="flex-1 flex items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 min-h-[min(420px,50vh)]"
            role="region"
            aria-label={t('dashboard.emptyCanvasTitle')}
            onDragOver={onEmptyCanvasDragOver}
            onDrop={onEmptyCanvasDrop}
          >
            <div className="max-w-md text-center px-4">
              <h3 className="text-base font-semibold text-slate-200 mb-2">
                {t('dashboard.emptyCanvasTitle')}
              </h3>
              <p className="text-sm text-slate-400 mb-4">{t('dashboard.emptyCanvasIntro')}</p>
              <ol className="text-left text-sm text-slate-300 space-y-2 list-decimal list-inside">
                <li>{t('dashboard.emptyCanvasStep1')}</li>
                <li>{t('dashboard.emptyCanvasStep2')}</li>
                <li>{t('dashboard.emptyCanvasStep3')}</li>
              </ol>
            </div>
          </div>
        ) : (
          <ReactGridLayout
            className="layout flex-1"
            layout={panels.map((p) => ({
              ...p.grid,
              i: p.id,
              minW: PANEL_MIN_W,
              minH: PANEL_MIN_H,
            }))}
            cols={12}
            rowHeight={120}
            width={layoutWidth}
            onLayoutChange={onLayoutChange}
            draggableHandle=".panel-drag-handle"
            isResizable={true}
            resizeHandles={['se', 's', 'e']}
            isDroppable={true}
            onDrop={onDrop}
            droppingItem={defaultDroppingItem}
          >
            {panels.map((panel) => (
              <div
                key={panel.id}
                onMouseDown={() => setActivePanelId(panel.id)}
                className={`relative flex flex-col bg-transparent border-none rounded-none overflow-hidden p-0 ${
                  activePanelId === panel.id
                    ? 'ring-1 ring-emerald-400/30'
                    : ''
                }`}
              >
                <div
                  className={`panel-header panel-drag-handle absolute top-1 right-1 z-30 flex justify-between items-center bg-slate-950/75 backdrop-blur-sm rounded-md h-7 px-2 border border-slate-600/30 ${
                    predictingPanelId === panel.id ? 'ring-1 ring-amber-500/70' : ''
                  }`}
                >
                  <div
                    className="cursor-move flex-1 truncate text-[10px] text-slate-300 min-w-0 max-w-[180px]"
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
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePanel(panel.id);
                      }}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-700/80 rounded"
                      title={t('dashboard.removePanel')}
                      aria-label={t('dashboard.removePanelAria')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="absolute inset-0 min-h-0 rounded-none overflow-hidden">
                  <DataCanvasPanelMemo
                    panelId={panel.id}
                    series={panel.series}
                    startTime={timeContext.startTime}
                    endTime={timeContext.endTime}
                    resolution={timeContext.resolution}
                    prediction={panel.prediction ?? null}
                    chartAppearance={panel.chartAppearance}
                    onAppearanceChange={updatePanelAppearance}
                    onSeriesAxisChange={updatePanelSeriesAxis}
                  />
                </div>
              </div>
            ))}
          </ReactGridLayout>
        )}
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
      <style>{`
        .react-resizable-handle {
          opacity: 1 !important;
          z-index: 50 !important;
          cursor: se-resize !important;
          width: 20px !important;
          height: 20px !important;
          bottom: 0 !important;
          right: 0 !important;
        }
        .react-resizable-handle::after {
          border-right: 2px solid rgba(148, 163, 184, 0.9) !important;
          border-bottom: 2px solid rgba(148, 163, 184, 0.9) !important;
          right: 4px !important;
          bottom: 4px !important;
          width: 8px !important;
          height: 8px !important;
        }
      `}</style>
    </div>
  );
});

DataHubDashboard.displayName = 'DataHubDashboard';
