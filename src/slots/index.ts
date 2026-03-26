import type { ModuleViewerSlots } from '@nekazari/sdk';
import DataHubQuickChart from './DataHubQuickChart';
import { DataCanvasPanel, DataCanvasPanelMemo } from './DataCanvasPanel';
import { DataHubDashboard } from './DataHubDashboard';

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

export { DataCanvasPanel, DataCanvasPanelMemo, DataHubDashboard };
