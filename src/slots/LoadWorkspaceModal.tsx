/**
 * LoadWorkspaceModal — Phase 5. List workspaces from GET /api/datahub/workspaces
 * or pick a template preset with entity placeholder resolution.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { X, Sprout, CloudSun, Activity, Thermometer } from 'lucide-react';
import {
  listWorkspaces,
  fetchDataHubEntities,
  type DataHubEntity,
  type DataHubWorkspaceStored,
} from '../services/datahubApi';
import {
  WORKSPACE_TEMPLATES,
  PLACEHOLDER_PREFIX,
  type WorkspaceTemplate,
} from '../services/workspaceTemplates';

const TEMPLATE_ICONS: Record<WorkspaceTemplate['icon'], React.ComponentType<any>> = {
  Sprout,
  CloudSun,
  Activity,
  Thermometer,
};

function defaultTimeContext() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { startTime: start.toISOString(), endTime: end.toISOString(), resolution: 1000 };
}

export interface LoadWorkspaceModalProps {
  onSelect: (workspace: DataHubWorkspaceStored) => void;
  onClose: () => void;
}

export const LoadWorkspaceModal: React.FC<LoadWorkspaceModalProps> = ({ onSelect, onClose }) => {
  const { t } = useTranslation('datahub');
  const [tab, setTab] = useState<'workspaces' | 'templates'>('workspaces');
  const [workspaces, setWorkspaces] = useState<DataHubWorkspaceStored[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Template entity search
  const [selectedTemplate, setSelectedTemplate] = useState<WorkspaceTemplate | null>(null);
  const [entitySearch, setEntitySearch] = useState('');
  const [entityResults, setEntityResults] = useState<DataHubEntity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<DataHubEntity | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listWorkspaces()
      .then((list) => { if (!cancelled) setWorkspaces(list); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Entity search debounce
  useEffect(() => {
    if (!selectedTemplate || entitySearch.length < 2) {
      setEntityResults([]);
      return;
    }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetchDataHubEntities(entitySearch);
        setEntityResults(res.entities);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [selectedTemplate, entitySearch]);

  const applyTemplate = useCallback(() => {
    if (!selectedTemplate || !selectedEntity) return;
    const resolvedPanels = selectedTemplate.panels.map((panel) => ({
      ...panel,
      panelId: crypto.randomUUID(),
      series: panel.series.map((s: any) => ({
        ...s,
        entityId: typeof s.entityId === 'string' && s.entityId.startsWith(PLACEHOLDER_PREFIX)
          ? selectedEntity.id
          : s.entityId,
      })),
    }));
    onSelect({
      id: `urn:ngsi-ld:DataHubWorkspace:template-${Date.now()}`,
      type: 'DataHubWorkspace',
      name: { type: 'Property', value: t(selectedTemplate.nameKey as any) },
      timeContext: { type: 'Property', value: defaultTimeContext() },
      layout: { type: 'Property', value: resolvedPanels },
    } as DataHubWorkspaceStored);
  }, [selectedTemplate, selectedEntity, onSelect, t]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="load-workspace-title"
    >
      <div className="dh-bg-surface border dh-border-default rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b dh-border-default">
          <h2 id="load-workspace-title" className="text-sm font-semibold dh-text-primary">
            {tab === 'workspaces' ? t('loadWorkspace.title') : t('templates.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="dh-text-secondary hover:dh-text-primary p-1"
            aria-label={t('loadWorkspace.close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b dh-border-default">
          <button
            type="button"
            onClick={() => { setTab('workspaces'); setSelectedTemplate(null); }}
            className={`flex-1 px-3 py-2 text-xs text-center transition-colors ${
              tab === 'workspaces'
                ? 'dh-bg-surface-alt text-white border-b-2 dh-accent-border'
                : 'dh-text-secondary hover:dh-text-primary'
            }`}
          >
            {t('loadWorkspace.title')}
          </button>
          <button
            type="button"
            onClick={() => setTab('templates')}
            className={`flex-1 px-3 py-2 text-xs text-center transition-colors ${
              tab === 'templates'
                ? 'dh-bg-surface-alt text-white border-b-2 dh-accent-border'
                : 'dh-text-secondary hover:dh-text-primary'
            }`}
          >
            {t('templates.title')}
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 min-h-0">
          {tab === 'workspaces' && (
            <>
              {loading && <p className="dh-text-secondary text-sm">{t('loadWorkspace.loading')}</p>}
              {error && <p className="text-red-400 text-sm" role="alert">{error}</p>}
              {!loading && !error && workspaces.length === 0 && (
                <p className="dh-text-secondary text-sm">{t('loadWorkspace.empty')}</p>
              )}
              {!loading && workspaces.length > 0 && (
                <ul className="space-y-2">
                  {workspaces.map((ws) => (
                    <li key={ws.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(ws)}
                        className="w-full text-left px-3 py-2 dh-bg-surface-alt hover:dh-bg-surface-alt border dh-border-light rounded-lg dh-text-primary text-sm transition-colors"
                      >
                        <span className="font-medium">{ws.name?.value ?? ws.id}</span>
                        {ws.layout?.value?.length != null && (
                          <span className="block dh-text-muted text-xs mt-0.5">
                            {t('loadWorkspace.panelsCount', { count: ws.layout.value.length })}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'templates' && (
            <div className="grid grid-cols-2 gap-3">
              {WORKSPACE_TEMPLATES.map((tmpl) => {
                const Icon = TEMPLATE_ICONS[tmpl.icon];
                const isSelected = selectedTemplate?.id === tmpl.id;
                return (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => {
                      setSelectedTemplate(isSelected ? null : tmpl);
                      setSelectedEntity(null);
                      setEntitySearch('');
                    }}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? 'dh-accent-border/50 dh-accent-bg/10'
                        : 'dh-border-default dh-bg-surface-alt/60 hover:dh-border-light'
                    }`}
                  >
                    <Icon size={22} className="dh-accent-text mb-2" />
                    <div className="text-xs font-medium dh-text-primary">{t(tmpl.nameKey as any)}</div>
                    <div className="text-[10px] dh-text-secondary mt-0.5">{t(tmpl.descriptionKey as any)}</div>
                    <div className="text-[10px] dh-text-muted mt-1.5">{tmpl.panels.length} paneles</div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Entity picker after template selected */}
          {tab === 'templates' && selectedTemplate && (
            <div className="mt-4 border-t dh-border-default pt-3">
              <p className="text-xs dh-text-secondary mb-2">{t('templates.selectEntity')}</p>
              <input
                type="search"
                value={entitySearch}
                onChange={(e) => setEntitySearch(e.target.value)}
                placeholder="Buscar entidad…"
                className="w-full px-3 py-2 text-xs border dh-border-light rounded dh-bg-surface-alt dh-text-primary mb-2 placeholder-current opacity-50 focus:outline-none focus:ring-1 focus:dh-accent-border/50"
              />
              {entityResults.length > 0 && (
                <div className="max-h-32 overflow-y-auto mb-2">
                  {entityResults.map((ent) => (
                    <button
                      key={ent.id}
                      type="button"
                      onClick={() => setSelectedEntity(ent)}
                      className={`w-full text-left px-2 py-1.5 text-xs rounded ${
                        selectedEntity?.id === ent.id
                          ? 'dh-accent-bg/40 dh-accent-text'
                          : 'dh-text-secondary hover:dh-bg-surface-alt'
                      }`}
                    >
                      {ent.name} <span className="dh-text-muted">({ent.type})</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={applyTemplate}
                disabled={!selectedEntity}
                className="w-full px-3 py-2 text-xs dh-accent-bg text-white rounded hover:dh-accent-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('templates.apply')}
              </button>
            </div>
          )}
        </div>

        <div className="p-4 border-t dh-border-default">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm dh-text-secondary hover:dh-text-primary border dh-border-light rounded"
          >
            {t('loadWorkspace.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
