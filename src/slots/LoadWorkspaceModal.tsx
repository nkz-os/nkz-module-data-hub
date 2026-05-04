/**
 * LoadWorkspaceModal — Phase 5. List workspaces from GET /api/datahub/workspaces
 * or pick a template preset with entity placeholder resolution.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { SlotShell } from '@nekazari/viewer-kit';
import { Button, Tabs, Input, Spinner } from '@nekazari/ui-kit';
import { X, Sprout, CloudSun, Activity, Thermometer } from 'lucide-react';

const datahubAccent = { base: '#06B6D4', soft: '#CFFAFE', strong: '#0891B2' };
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
      <SlotShell moduleId="datahub" accent={datahubAccent}>
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-border">
          <h2 id="load-workspace-title" className="text-sm font-semibold text-foreground">
            {tab === 'workspaces' ? t('loadWorkspace.title') : t('templates.title')}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('loadWorkspace.close')}>
            <X size={18} />
          </Button>
        </div>

        {/* Tab bar */}
        <Tabs
          tabs={[
            { id: 'workspaces', label: t('loadWorkspace.title') },
            { id: 'templates', label: t('templates.title') },
          ]}
          activeTab={tab}
          onChange={(id) => { setTab(id as 'workspaces' | 'templates'); setSelectedTemplate(null); }}
        />

        <div className="p-4 overflow-y-auto flex-1 min-h-0">
          {tab === 'workspaces' && (
            <>
              {loading && <div className="flex justify-center py-4"><Spinner /></div>}
              {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
              {!loading && !error && workspaces.length === 0 && (
                <p className="text-muted-foreground text-sm">{t('loadWorkspace.empty')}</p>
              )}
              {!loading && workspaces.length > 0 && (
                <ul className="space-y-2">
                  {workspaces.map((ws) => (
                    <li key={ws.id}>
                      <Button
                        variant="ghost"
                        className="w-full text-left justify-start px-3 py-2"
                        onClick={() => onSelect(ws)}
                      >
                        <div className="flex flex-col items-start">
                          <span className="font-medium text-foreground">{ws.name?.value ?? ws.id}</span>
                          {ws.layout?.value?.length != null && (
                            <span className="text-muted-foreground text-xs mt-0.5">
                              {t('loadWorkspace.panelsCount', { count: ws.layout.value.length })}
                            </span>
                          )}
                        </div>
                      </Button>
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
                  <Button
                    key={tmpl.id}
                    variant={isSelected ? 'primary' : 'ghost'}
                    className={`text-left p-3 justify-start h-auto ${isSelected ? 'border-accent bg-accent/10' : ''}`}
                    onClick={() => {
                      setSelectedTemplate(isSelected ? null : tmpl);
                      setSelectedEntity(null);
                      setEntitySearch('');
                    }}
                  >
                    <Icon size={22} className="text-accent mb-2" />
                    <div className="text-xs font-medium text-foreground">{t(tmpl.nameKey as any)}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{t(tmpl.descriptionKey as any)}</div>
                    <div className="text-[10px] text-muted-foreground mt-1.5">{tmpl.panels.length} paneles</div>
                  </Button>
                );
              })}
            </div>
          )}

          {/* Entity picker after template selected */}
          {tab === 'templates' && selectedTemplate && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground mb-2">{t('templates.selectEntity')}</p>
              <Input
                type="search"
                value={entitySearch}
                onChange={(e) => setEntitySearch(e.target.value)}
                placeholder="Buscar entidad…"
                className="w-full mb-2"
              />
              {entityResults.length > 0 && (
                <div className="max-h-32 overflow-y-auto mb-2">
                  {entityResults.map((ent) => (
                    <Button
                      key={ent.id}
                      variant={selectedEntity?.id === ent.id ? 'primary' : 'ghost'}
                      size="sm"
                      className="w-full text-left justify-start px-2 py-1.5"
                      onClick={() => setSelectedEntity(ent)}
                    >
                      {ent.name} <span className="text-muted-foreground">({ent.type})</span>
                    </Button>
                  ))}
                </div>
              )}
              <Button
                variant="primary"
                className="w-full"
                onClick={applyTemplate}
                disabled={!selectedEntity}
              >
                {t('templates.apply')}
              </Button>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('loadWorkspace.cancel')}
          </Button>
        </div>
      </div>
      </SlotShell>
    </div>
  );
};
