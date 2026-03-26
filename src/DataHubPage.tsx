/**
 * Main view for the /datahub route.
 * Renders DataHubDashboard (grid canvas) with a DataTree sidebar.
 * Entities are dragged from the sidebar to dropping zones in the grid.
 */
import React, { useState, useCallback } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataTree } from './components/DataTree';
import { DataHubDashboard } from './slots/DataHubDashboard';
import type { DataHubEntity } from './services/datahubApi';
import type { GlobalTimeContext } from './types/dashboard';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, structuralSharing: false } },
});

const RESOLUTION = 1000;

function defaultTimeContext(): GlobalTimeContext {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    resolution: RESOLUTION,
  };
}

const DataHubPageInner: React.FC = () => {
  const { t } = useTranslation('datahub');
  const [selectedEntity, setSelectedEntity] = useState<DataHubEntity | null>(null);
  const [selectedAttribute, setSelectedAttribute] = useState<string | null>(null);

  const handleSelect = useCallback((entity: DataHubEntity, attribute: string) => {
    setSelectedEntity(entity);
    setSelectedAttribute(attribute);
  }, []);

  return (
    <div className="flex h-full min-h-screen bg-slate-950">
      {/* Sidebar: entity tree for drag-and-drop */}
      <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col">
        <div className="h-12 shrink-0 flex items-center px-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
            {t('tree.searchPlaceholder').split('(')[0].trim()}
          </h2>
        </div>
        <div className="flex-1 min-h-0">
          <DataTree
            selectedEntity={selectedEntity}
            selectedAttribute={selectedAttribute}
            onSelect={handleSelect}
          />
        </div>
      </aside>

      {/* Main area: grid canvas */}
      <main className="flex-1 min-w-0">
        <DataHubDashboard initialTimeContext={defaultTimeContext()} />
      </main>
    </div>
  );
};

const DataHubPage: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <DataHubPageInner />
  </QueryClientProvider>
);

export default DataHubPage;
