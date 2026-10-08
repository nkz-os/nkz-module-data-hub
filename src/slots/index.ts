export { DataCanvasPanel, DataCanvasPanelMemo } from './panel/DataCanvasPanel';
export { DataHubDashboard, type DataHubDashboardHandle } from './DataHubDashboard';

// No unified-viewer widgets: the viewer's bottom panel is the time axis of the
// selected entity, and the DataHub workbench lives on the module page.
// DataHubQuickChart is kept for a future timeline track.
export const moduleSlots = {};
