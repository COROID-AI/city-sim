'use client';

/**
 * CityLog — scrolling, event-driven activity feed.
 *
 * Spec reference: §6.4 Dashboard Layout, §7.4 Economy (event wiring).
 *
 * Subscribes to the full `CityEventMap` and renders a bounded ring
 * buffer of entries (newest first, max 100). Color is derived from
 * the event `tone` so the panel reads as a timeline.
 *
 * The component is intentionally NOT memoized: it must reflect every
 * event the bus dispatches.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { cityBus, type CityEventMap, type CityEventName, type EventBus, type Unsubscribe } from '@/systems/EventBus';

/** Max entries to keep in the ring buffer. */
export const CITY_LOG_RING_CAPACITY = 100;

export type CityLogTone = 'info' | 'open' | 'close' | 'traffic' | 'day' | 'arrival';

export interface CityLogEntry {
  /** Monotonic counter; older entries have smaller numbers. */
  id: number;
  /** Event name that produced this entry. */
  eventName: CityEventName;
  /** Display tone. */
  tone: CityLogTone;
  /** Human-readable message. */
  message: string;
}

export interface CityLogProps {
  /** Optional bus override. Defaults to the shared `cityBus`. Tests
   *  pass a fresh `new EventBus()` to keep events isolated. */
  bus?: EventBus<CityEventMap>;
  /** Optional initial entries (used by tests / Storybook). */
  initialEntries?: readonly CityLogEntry[];
  /** Optional cap override; defaults to CITY_LOG_RING_CAPACITY. */
  cap?: number;
}

const TONE_CLASS: Readonly<Record<CityLogTone, string>> = {
  info: 'text-foreground',
  open: 'text-accent',
  close: 'text-warning',
  traffic: 'text-warning',
  day: 'text-citizen',
  arrival: 'text-foreground',
};

/** Build the user-facing message + tone for a given event. */
function formatEvent<K extends CityEventName>(
  eventName: K,
  payload: CityEventMap[K],
): { message: string; tone: CityLogTone } {
  switch (eventName) {
    case 'new_day': {
      const p = payload as CityEventMap['new_day'];
      return { message: `Day ${p.day} begins`, tone: 'day' };
    }
    case 'company_opened': {
      const p = payload as CityEventMap['company_opened'];
      return {
        message: `New ${p.buildingTypeId} opened at (${p.position.x}, ${p.position.y})`,
        tone: 'open',
      };
    }
    case 'company_closed': {
      const p = payload as CityEventMap['company_closed'];
      return {
        message: `Company closed (${p.reason})`,
        tone: 'close',
      };
    }
    case 'commute_arrived': {
      const p = payload as CityEventMap['commute_arrived'];
      return {
        message: `Citizen arrived at (${p.destination.x}, ${p.destination.y})`,
        tone: 'arrival',
      };
    }
    case 'traffic_jam': {
      const p = payload as CityEventMap['traffic_jam'];
      return {
        message: `Traffic jam at ${p.tileKey} (${p.vehicleCount} vehicles)`,
        tone: 'traffic',
      };
    }
    case 'traffic_clear': {
      const p = payload as CityEventMap['traffic_clear'];
      return { message: `Traffic cleared at ${p.tileKey}`, tone: 'info' };
    }
    case 'building_placed': {
      const p = payload as CityEventMap['building_placed'];
      return {
        message: `Building placed at (${p.position.x}, ${p.position.y})`,
        tone: 'info',
      };
    }
    case 'vehicle_despawned': {
      const p = payload as CityEventMap['vehicle_despawned'];
      return { message: `Vehicle ${p.vehicleId} despawned`, tone: 'info' };
    }
    default: {
      return { message: String(eventName), tone: 'info' };
    }
  }
}

const ALL_EVENTS: readonly CityEventName[] = [
  'new_day',
  'company_opened',
  'company_closed',
  'commute_arrived',
  'traffic_jam',
  'traffic_clear',
  'building_placed',
  'vehicle_despawned',
];

export function CityLog({
  bus = cityBus,
  initialEntries,
  cap = CITY_LOG_RING_CAPACITY,
}: CityLogProps): ReactElement {
  const [entries, setEntries] = useState<CityLogEntry[]>(() =>
    initialEntries ? [...initialEntries] : [],
  );
  const counterRef = useRef<number>(
    initialEntries !== undefined ? initialEntries.length : 0,
  );

  useEffect(() => {
    const unsubs: Unsubscribe[] = [];
    for (const eventName of ALL_EVENTS) {
      const off = bus.on(eventName, (payload) => {
        const { message, tone } = formatEvent(eventName, payload);
        counterRef.current += 1;
        const id = counterRef.current;
        setEntries((prev) => {
          const next = [{ id, eventName, tone, message }, ...prev];
          if (next.length > cap) {
            next.length = cap;
          }
          return next;
        });
      });
      unsubs.push(off);
    }
    return () => {
      for (const off of unsubs) off();
    };
  }, [bus, cap]);

  return (
    <section
      data-testid="city-log"
      aria-label="City event log"
      className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-surface"
    >
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Event log
        </h2>
      </header>
      <ol
        data-testid="city-log-list"
        className="flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs"
      >
        {entries.length === 0 ? (
          <li className="text-muted" data-testid="city-log-empty">
            No events yet.
          </li>
        ) : (
          entries.map((entry) => (
            <li
              key={entry.id}
              data-testid="city-log-entry"
              data-event={entry.eventName}
              data-tone={entry.tone}
              className={`flex items-baseline gap-2 ${TONE_CLASS[entry.tone]}`}
            >
              <span className="text-muted">#{entry.id}</span>
              <span className="truncate">{entry.message}</span>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
