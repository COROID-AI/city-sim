'use client';

/**
 * useCityClock - subscribes the React tree to the TimeSystem's tick.
 *
 * Lives in `@/hooks` so the systems layer never imports React. The
 * game-loop driver (engine) calls `advanceClock(deltaMs)` once per
 * animation frame and the hook re-renders consumers.
 */
import { useEffect, useState } from 'react';
import { TimeSystem } from '@/systems/TimeSystem';

let sharedTime: TimeSystem | null = null;
const subscribers = new Set<() => void>();

function getSharedTime(): TimeSystem {
  if (!sharedTime) sharedTime = new TimeSystem();
  return sharedTime;
}

/** Called by the engine on every animation frame. */
export function advanceClock(deltaMs: number): void {
  getSharedTime().tick(deltaMs);
  for (const cb of subscribers) cb();
}

export function useCityClock(): number {
  const [hour, setHour] = useState<number>(() => getSharedTime().getCurrentHour());
  useEffect(() => {
    const cb = () => setHour(getSharedTime().getCurrentHour());
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }, []);
  return hour;
}
