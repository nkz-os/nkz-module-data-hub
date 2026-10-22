/**
 * Main view for the /datahub route.
 * Renders DataHubDashboard (grid canvas) with a DataTree sidebar.
 *
 * Sidebar: static at >=768px; off-canvas overlay at <768px so the canvas
 * always has at least 350px of usable width (mobile-first mandate).
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { useAuth, useEntities } from '@nekazari/module-kit';
import { Menu, X } from 'lucide-react';
import { DataTree } from './components/DataTree';
import { CapabilityCatalog } from './components/CapabilityCatalog';
import { ParcelInspector } from './components/ParcelInspector';
import {
  DataHubDashboard,
  type DataHubDashboardHandle,
} from './slots/DataHubDashboard';
import type { DataHubEntity } from './services/datahubApi';
import type { GlobalTimeContext } from './types/dashboard';
import './lib-overrides.css';

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
  const { tenantName, isAuthenticated } = useAuth();
  // Smoke test for A.2.1b — confirms useEntities resolves through the NKZProvider QueryClient.
  // Not yet consumed by UI; logging is enough to verify gateway routing in production.
  const { data: parcelsForSmoke } = useEntities('AgriParcel', { limit: 1 });
  useEffect(() => {
    if (parcelsForSmoke) {
      console.debug('[datahub] useEntities AgriParcel sample length:', parcelsForSmoke.length);
    }
  }, [parcelsForSmoke]);
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

  const [view, setView] = useState<'dashboard' | 'catalog' | 'inspector'>('dashboard');

  const [hasActivePanel, setHasActivePanel] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setHasActivePanel(dashboardRef.current?.hasActivePanel?.() ?? false);
    }, 400);
    return () => clearInterval(id);
  }, []);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const sidebarContent = (
    <aside
      className="w-64 shrink-0 flex flex-col h-full"
      style={{
        backgroundColor: 'var(--dh-surface)',
        borderRight: '1px solid var(--dh-border)',
      }}
    >
      <div
        className="h-12 shrink-0 flex items-center justify-between px-4"
        style={{ borderBottom: '1px solid var(--dh-border)' }}
      >
        <h2
          className="text-sm font-semibold tracking-wide uppercase"
          style={{ color: 'var(--dh-text-primary)' }}
        >
          {t('tree.sidebarTitle')}
        </h2>
        {isMobile && (
          <button
            type="button"
            onClick={closeSidebar}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--dh-text-secondary)' }}
            aria-label={t('tree.closeSidebar', { defaultValue: 'Close' })}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--dh-text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--dh-text-secondary)')}
          >
            <X size={16} />
          </button>
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
  );

  return (
    <div
      className="datahub-dark flex h-full min-h-screen relative"
      style={{ backgroundColor: 'var(--dh-bg)' }}
      data-tenant={isAuthenticated ? tenantName ?? '' : ''}
    >
      {/* Desktop: static sidebar */}
      {!isMobile && sidebarContent}

      {/* Mobile: off-canvas sidebar + overlay */}
      {isMobile && (
        <>
          {/* Overlay */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/70 transition-opacity"
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
          <div
            className="h-10 shrink-0 flex items-center px-3"
            style={{
              borderBottom: '1px solid var(--dh-border)',
              backgroundColor: 'var(--dh-bg)',
            }}
          >
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: 'var(--dh-text-secondary)' }}
              aria-label={t('tree.toggleSidebar', { defaultValue: 'Toggle sidebar' })}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--dh-text-primary)';
                e.currentTarget.style.backgroundColor = 'var(--dh-surface-alt)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--dh-text-secondary)';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <Menu size={18} />
            </button>
            <span
              className="ml-2 text-xs font-mono truncate"
              style={{ color: 'var(--dh-text-muted)' }}
            >
              {selectedAttribute
                ? `${selectedEntity?.name ?? ''} · ${selectedAttribute}`
                : t('tree.sidebarTitle')}
            </span>
          </div>
        )}

        {/* View switcher */}
        <div
          className="shrink-0 flex items-center gap-1 px-3 py-2"
          style={{
            borderBottom: '1px solid var(--dh-border)',
            backgroundColor: 'var(--dh-bg)',
          }}
        >
          {(['dashboard', 'catalog', 'inspector'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className="px-3 py-1.5 text-xs rounded-full transition-colors font-medium"
              style={
                view === v
                  ? {
                      backgroundColor: 'var(--dh-accent-soft)',
                      color: 'var(--dh-accent-text)',
                      boxShadow: '0 0 0 1px rgba(5, 150, 105, 0.3)',
                    }
                  : { color: 'var(--dh-text-secondary)' }
              }
              onMouseEnter={(e) => {
                if (view !== v) {
                  e.currentTarget.style.color = 'var(--dh-text-primary)';
                  e.currentTarget.style.backgroundColor = 'var(--dh-surface-alt)';
                }
              }}
              onMouseLeave={(e) => {
                if (view !== v) {
                  e.currentTarget.style.color = 'var(--dh-text-secondary)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              {t(`capability.view_${v}`)}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {view === 'dashboard' && (
            <DataHubDashboard ref={dashboardRef} initialTimeContext={defaultTimeContext()} />
          )}
          {view === 'catalog' && (
            // TODO(Phase 4): replace ['open'] with tenant entitlements from auth context
            // useAuth() does not currently expose entitlements
            <CapabilityCatalog tenantEntitlements={['open']} />
          )}
          {view === 'inspector' && (
            // TODO(Phase 4): replace ['open'] with tenant entitlements from auth context
            // useAuth() does not currently expose entitlements
            <ParcelInspector
              parcelId={selectedEntity?.id ?? ''}
              tenantEntitlements={['open']}
            />
          )}
        </div>
      </main>
    </div>
  );
};

const DataHubPage: React.FC = () => <DataHubPageInner />;

export default DataHubPage;
