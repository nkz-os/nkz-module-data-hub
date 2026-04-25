/**
 * useViewportHistory — stack of recent X-axis viewports for D1 zoom-undo.
 *
 * This file is the contract surface used by Fase 3's panel shell. The actual
 * push-on-zoom and right-click handlers are wired in Fase 6 along with the
 * uPlot drag/setScale hooks.
 */

import { useCallback, useRef, useState } from 'react';

export interface Viewport {
  /** Epoch seconds. */
  min: number;
  /** Epoch seconds. */
  max: number;
}

export interface UseViewportHistoryResult {
  current: Viewport | null;
  hasHistory: boolean;
  push: (next: Viewport) => void;
  pop: () => Viewport | null;
  reset: () => Viewport | null;
}

const MAX_HISTORY = 10;

export function useViewportHistory(initial: Viewport | null = null): UseViewportHistoryResult {
  const stackRef = useRef<Viewport[]>(initial ? [initial] : []);
  const baselineRef = useRef<Viewport | null>(initial);
  const [, force] = useState(0);

  const push = useCallback((next: Viewport) => {
    const stk = stackRef.current;
    stk.push(next);
    if (stk.length > MAX_HISTORY) stk.splice(0, stk.length - MAX_HISTORY);
    if (!baselineRef.current) baselineRef.current = next;
    force((n) => n + 1);
  }, []);

  const pop = useCallback((): Viewport | null => {
    const stk = stackRef.current;
    if (stk.length <= 1) return null;
    stk.pop();
    force((n) => n + 1);
    return stk[stk.length - 1] ?? null;
  }, []);

  const reset = useCallback((): Viewport | null => {
    const base = baselineRef.current;
    stackRef.current = base ? [base] : [];
    force((n) => n + 1);
    return base;
  }, []);

  return {
    get current() {
      const stk = stackRef.current;
      return stk[stk.length - 1] ?? null;
    },
    get hasHistory() {
      return stackRef.current.length > 1;
    },
    push,
    pop,
    reset,
  };
}
