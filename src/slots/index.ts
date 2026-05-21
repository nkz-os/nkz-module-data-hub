import DataHubQuickChart from './DataHubQuickChart';

export { DataCanvasPanel, DataCanvasPanelMemo } from './panel/DataCanvasPanel';
export { DataHubDashboard, type DataHubDashboardHandle } from './DataHubDashboard';

export const moduleSlots = {
  'bottom-panel': [
    {
      id: 'datahub-canvas',
      component: DataHubQuickChart,
      priority: 50,
    },
  ],
};
