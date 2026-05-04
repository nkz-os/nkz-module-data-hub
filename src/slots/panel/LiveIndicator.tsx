/**
 * LiveIndicator — pulsing dot + countdown since last refresh.
 * Shown in the panel header when liveMode is active.
 */

import React, { useEffect, useState } from 'react';

export interface LiveIndicatorProps {
  /** Whether live mode is active. */
  active: boolean;
  /** Seconds since last successful data refresh. */
  secondsSinceRefresh: number;
}

export const LiveIndicator: React.FC<LiveIndicatorProps> = ({ active, secondsSinceRefresh }) => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  const displaySeconds = tick > 0 ? secondsSinceRefresh + tick : secondsSinceRefresh;

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/30 text-[10px] text-accent font-mono tabular-nums">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
      </span>
      LIVE
      <span className="text-accent/60">{displaySeconds}s ago</span>
    </span>
  );
};
