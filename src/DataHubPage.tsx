/**
 * Main view for the /datahub route.
 * Renders DataHubDashboard (grid canvas) with a DataTree sidebar.
 *
 * Sidebar: static at >=768px; off-canvas overlay at <768px so the canvas
 * always has at least 350px of usable width (mobile-first mandate).
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { SlotShell } from '@nekazari/viewer-kit';
import { Button } from '@nekazari/ui-kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Menu, X } from 'lucide-react';

const datahubAccent = { base: '#06B6D4', soft: '#CFFAFE', strong: '#0891B2' };
import { DataTree } from './components/DataTree';
import {
  DataHubDashboard,
  type DataHubDashboardHandle,
} from './slots/DataHubDashboard';
import type { DataHubEntity } from './services/datahubApi';
import type { GlobalTimeContext } from './types/dashboard';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, structuralSharing: false } },
});

const RESOLUTION = 1000;
const SIDEBAR_BREAKPOINT = 768;

function defaultTimeContext(): GlobalTimeContext {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    resolution: RESOLUTION,
  };
}

const DataHubPageInner: React.FC = () => {
  const { t } = useTranslation('datahub');
  const dashboardRef = useRef<DataHubDashboardHandle>(null);
  const [selectedEntity, setSelectedEntity] = useState<DataHubEntity | null>(null);
  const [selectedAttribute, setSelectedAttribute] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < SIDEBAR_BREAKPOINT
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < SIDEBAR_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close sidebar when viewport expands beyond mobile
  useEffect(() => {
    if (!isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleSelect = useCallback((entity: DataHubEntity, attribute: string) => {
    setSelectedEntity(entity);
    setSelectedAttribute(attribute || null);
  }, []);

  const handleAddToCanvas = useCallback((entity: DataHubEntity, attribute: string) => {
    dashboardRef.current?.addSeriesFromTree(entity, attribute);
    // Auto-close sidebar on mobile after selection
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const [hasActivePanel, setHasActivePanel] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setHasActivePanel(dashboardRef.current?.hasActivePanel?.() ?? false);
    }, 400);
    return () => clearInterval(id);
  }, []);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const sidebarContent = (
    <SlotShell moduleId="datahub" accent={datahubAccent}>
    <aside className="w-64 shrink-0 border-r border-border bg-background flex flex-col h-full">
      <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground tracking-wide uppercase">
          {t('tree.sidebarTitle')}
        </h2>
        {isMobile && (
          <Button variant="ghost" size="xs" onClick={closeSidebar} aria-label={t('tree.closeSidebar', { defaultValue: 'Close' })}>
            <X size={16} />
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <DataTree
          selectedEntity={selectedEntity}
          selectedAttribute={selectedAttribute}
          onSelect={handleSelect}
          onAddToCanvas={handleAddToCanvas}
          hasActivePanel={hasActivePanel}
        />
      </div>
    </aside>
    </SlotShell>
  );

  return (
    <SlotShell moduleId="datahub" accent={datahubAccent}>
    <div className="flex h-full min-h-screen relative">
      {/* Desktop: static sidebar */}
      {!isMobile && sidebarContent}

      {/* Mobile: off-canvas sidebar + overlay */}
      {isMobile && (
        <>
          {/* Overlay */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity"
              onClick={closeSidebar}
              aria-hidden
            />
          )}
          {/* Slide-in panel */}
          <div
            className={`fixed inset-y-0 left-0 z-50 transition-transform duration-200 ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            {sidebarContent}
          </div>
        </>
      )}

      {/* Main area */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile hamburger bar */}
        {isMobile && (
          <div className="h-10 shrink-0 flex items-center px-3 border-b border-border bg-background">
            <Button variant="ghost" size="xs" onClick={() => setSidebarOpen((v) => !v)} aria-label={t('tree.toggleSidebar', { defaultValue: 'Toggle sidebar' })}>
              <Menu size={18} />
            </Button>
            <span className="ml-2 text-xs text-muted-foreground font-mono truncate">
              {selectedAttribute
                ? `${selectedEntity?.name ?? ''} · ${selectedAttribute}`
                : t('tree.sidebarTitle')}
            </span>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <DataHubDashboard ref={dashboardRef} initialTimeContext={defaultTimeContext()} />
        </div>
      </main>
    </div>
    </SlotShell>
  );
};

const DataHubPage: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <DataHubPageInner />
  </QueryClientProvider>
);

export default DataHubPage;
