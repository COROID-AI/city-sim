'use client';

/**
 * useCitySnapshot — derive a `CitySnapshot` at a fixed cadence.
 *
 * Spec reference: §6.4 Dashboard (2 Hz polling).
 *
 * The hook is intentionally decoupled from any specific engine: the
 * caller passes a `read` function and we invoke it on a 500ms timer
 * (2 Hz). The `read` callback is allowed to return any object; we
 * compare it with `areSnapshotsEqual` before re-rendering so we don't
 * fire React updates when the value is reference-equal AND the small
 * scalar fields match. This keeps the dashboard cheap to render even
 * if the underlying systems produce a new object every tick.
 *
 * Cleanup: the timer is cleared on unmount. The latest `read`
 * callback is held in a ref so the timer always calls the freshest
 * closure without forcing a re-subscribe.
 */
import { useEffect, useRef, useState } from 'react';
import type { CitySnapshot } from '@/ui/CitySnapshot';

export const SNAPSHOT_POLL_INTERVAL_MS = 500;

export type SnapshotReader = () => CitySnapshot;

function shallowScalarEqual(a: CitySnapshot, b: CitySnapshot): boolean {
  return (
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.population === b.population &&
    Math.round(a.avgNeeds) === Math.round(b.avgNeeds) &&
    a.budget === b.budget &&
    a.openCompanies === b.openCompanies &&
    a.totalCompanies === b.totalCompanies &&
    a.vehicleCount === b.vehicleCount
  );
}

/**
 * Subscribe to a `SnapshotReader` at 2Hz. Returns the latest snapshot.
 *
 * @param read       Function that returns the current snapshot.
 * @param intervalMs Poll interval in ms. Defaults to 500 (2 Hz).
 */
export function useCitySnapshot(
  read: SnapshotReader,
  intervalMs: number = SNAPSHOT_POLL_INTERVAL_MS,
): CitySnapshot {
  const [snapshot, setSnapshot] = useState<CitySnapshot>(() => read());
  const readRef = useRef<SnapshotReader>(read);
  const lastRef = useRef<CitySnapshot>(snapshot);

  // Keep the latest reader without re-subscribing.
  useEffect(() => {
    readRef.current = read;
  }, [read]);

  useEffect(() => {
    const tick = (): void => {
      const next = readRef.current();
      if (!shallowScalarEqual(lastRef.current, next)) {
        lastRef.current = next;
        setSnapshot(next);
      }
    };
    // Take an immediate sample so the first paint matches the
    // engine instead of the placeholder used by useState's init.
    tick();
    const handle = setInterval(tick, intervalMs);
    return () => {
      clearInterval(handle);
    };
  }, [intervalMs]);

  return snapshot;
}
