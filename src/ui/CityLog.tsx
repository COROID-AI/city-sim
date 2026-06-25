'use client';

import { useEffect, useRef, useState } from 'react';
import type { EventBus } from '@/systems/EventBus';
import type { CityEvent, CityTime } from '@/engine/types';

/**
 * CityLog — bottom-right scrollable event log (spec §6.4).
 *
 * Renders the last {@link MAX_EVENTS} city events, each with a timestamp and a
 * colored dot indicating the event category:
 *  - green:  arrival (citizen_arrived)
 *  - blue:   company (company_opened / company_closed)
 *  - red:    traffic (traffic_jam)
 *  - slate:  other (new_day)
 *
 * Canvas↔React bridge (spec §5.5):
 *  - Events are collected via an EventBus wildcard subscription (push) into a
 *    ref, but React only re-renders at 2 Hz (pull) to batch updates and avoid
 *    render thrashing during high-frequency events (e.g. traffic jams).
 *  - The ref is trimmed to MAX_EVENTS on every push, so it never grows beyond
 *    20 entries between polls.
 *
 * Auto-scroll: when new events arrive, the log scrolls to the newest entry.
 */

/** Polling interval (ms) for syncing the displayed event list. 2 Hz. */
const POLL_INTERVAL_MS = 500;

/** Maximum number of events retained for display. */
export const MAX_EVENTS = 20;

/** Dot color for each event category. */
const EVENT_DOT_COLOR: Record<string, string> = {
  citizen_arrived: 'bg-green-500',
  company_opened: 'bg-blue-500',
  company_closed: 'bg-blue-500',
  traffic_jam: 'bg-red-500',
  new_day: 'bg-slate-400',
};

/** Human-readable label for each event category. */
const EVENT_LABEL: Record<string, string> = {
  citizen_arrived: 'Arrived',
  company_opened: 'Company opened',
  company_closed: 'Company closed',
  traffic_jam: 'Traffic jam',
  new_day: 'New day',
};

/** Format a CityTime as HH:MM for the log timestamp. */
function formatTime(time: CityTime): string {
  const hh = time.hour.toString().padStart(2, '0');
  const mm = time.minute.toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface CityLogProps {
  /** Engine event bus to subscribe to. */
  eventBus: EventBus;
}

export default function CityLog({ eventBus }: CityLogProps): JSX.Element {
  // Accumulates events from the subscription (push). Trimmed to MAX_EVENTS.
  const eventsRef = useRef<CityEvent[]>([]);
  // Display list, synced from the ref at 2 Hz.
  const [events, setEvents] = useState<CityEvent[]>([]);
  // Ref to the scroll container for auto-scroll-to-bottom.
  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to all events via the wildcard channel. Events are pushed into
  // the ref immediately but only rendered at 2 Hz. Cleanup on unmount.
  useEffect(() => {
    const unsubscribe = eventBus.on('*', (event) => {
      const next = eventsRef.current;
      next.push(event);
      // Trim to the last MAX_EVENTS to bound memory between polls.
      if (next.length > MAX_EVENTS) {
        next.splice(0, next.length - MAX_EVENTS);
      }
    });
    return unsubscribe;
  }, [eventBus]);

  // Sync the display list from the ref at 2 Hz (spec §5.5).
  useEffect(() => {
    const id = window.setInterval(() => {
      setEvents([...eventsRef.current]);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Auto-scroll to the newest event whenever the displayed list changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events]);

  return (
    <div
      className="pointer-events-auto fixed bottom-4 right-4 z-20 flex h-48 w-64 flex-col rounded-lg bg-slate-900/80 text-white backdrop-blur"
      data-testid="city-log"
    >
      <div className="border-b border-slate-700 px-3 py-1 text-xs font-semibold text-slate-300">
        Event Log
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-1 text-xs"
        data-testid="city-log-scroll"
      >
        {events.length === 0 ? (
          <div className="py-2 text-slate-400" data-testid="city-log-empty">
            No events yet.
          </div>
        ) : (
          events.map((event, i) => {
            const color = EVENT_DOT_COLOR[event.type] ?? 'bg-slate-400';
            const label = EVENT_LABEL[event.type] ?? event.type;
            return (
              <div
                key={`${event.type}-${event.time.totalMs}-${i}`}
                className="flex items-center gap-2 py-0.5"
                data-testid="city-log-entry"
              >
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`}
                  data-testid="city-log-dot"
                  data-event-type={event.type}
                />
                <span className="font-mono text-slate-400">
                  {formatTime(event.time)}
                </span>
                <span className="truncate">{label}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
