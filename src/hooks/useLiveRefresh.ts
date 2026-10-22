/**
 * useLiveRefresh — calls onTick at a fixed interval when enabled.
 * For DataHub live IoT mode: advances the time range and triggers refetch.
 */

import { useEffect, useRef } from 'react';

interface UseLiveRefreshArgs {
  enabled: boolean;
  intervalMs: number;
  onTick: () => void;
}

export function useLiveRefresh({ enabled, intervalMs, onTick }: UseLiveRefreshArgs) {
  const callbackRef = useRef(onTick);
  callbackRef.current = onTick;

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => callbackRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}
