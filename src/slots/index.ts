import type { ModuleViewerSlots } from '@nekazari/sdk';
import DataHubQuickChart from './DataHubQuickChart';

export { DataCanvasPanel, DataCanvasPanelMemo } from './panel/DataCanvasPanel';
export { DataHubDashboard, type DataHubDashboardHandle } from './DataHubDashboard';

const MODULE_ID = 'datahub';

export const moduleSlots: ModuleViewerSlots = {
  'map-layer': [],
  'layer-toggle': [],
  'context-panel': [],
  'bottom-panel': [
    {
      id: 'datahub-canvas',
      moduleId: MODULE_ID,
      component: 'DataHubQuickChart',
      localComponent: DataHubQuickChart,
      priority: 50,
    },
  ],
  'entity-tree': [],
};
