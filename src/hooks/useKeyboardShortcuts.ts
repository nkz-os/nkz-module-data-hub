/**
 * useKeyboardShortcuts — global chart keybindings for DataHub canvas.
 *
 * Suppressed when focus is inside INPUT/TEXTAREA/SELECT.
 * Mounted once in DataHubDashboard.
 */

import { useEffect } from 'react';

export interface ShortcutCallbacks {
  removeActivePanel: () => void;
  undoZoom: () => void;
  resetZoom: () => void;
  openExport: () => void;
  toggleSeriesRail: () => void;
  toggleTrendline: () => void;
  toggleRollingAvg: () => void;
  setTimeRange: (range: '24h' | '7d' | '30d') => void;
}

export function useKeyboardShortcuts(callbacks: ShortcutCallbacks) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        callbacks.undoZoom();
        return;
      }
      if (ctrl && e.key === 'Z') {
        e.preventDefault();
        callbacks.resetZoom();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !ctrl) {
        callbacks.removeActivePanel();
        return;
      }
      if (e.key === 'e' && !ctrl) { callbacks.openExport(); return; }
      if (e.key === 's' && !ctrl) { callbacks.toggleSeriesRail(); return; }
      if (e.key === 't' && !ctrl) { callbacks.toggleTrendline(); return; }
      if (e.key === 'r' && !ctrl) { callbacks.toggleRollingAvg(); return; }
      if (e.key === '1') { callbacks.setTimeRange('24h'); return; }
      if (e.key === '2') { callbacks.setTimeRange('7d'); return; }
      if (e.key === '3') { callbacks.setTimeRange('30d'); return; }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [callbacks]);
}
