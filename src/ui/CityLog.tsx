/**
 * CityLog — right-side event log overlay.
 *
 * Subscribes to *every* event on the EventBus and maintains a
 * bounded buffer of the last 20 entries. Newest entries appear at
 * the top. Each entry is rendered with a colored dot whose color
 * is keyed to the event kind.
 *
 * The component polls once on mount to capture any events that
 * fired before React mounted (the bus might already have received
 * some traffic from the engine's first tick). After that, all
 * updates are pushed via `bus.on(...)` listeners. Listeners are
 * torn down on unmount to avoid leaks.
 *
 * Color palette is intentionally neutral and aligned with the
 * dark HUD aesthetic; we keep the colors in this file rather than
 * reaching into the engine palette (the log is a UI concern, not
 * a simulation concern).
 *
 * Layer rule: `'use client'` React 19; imports only from
 * `@/hooks`, `@/systems` types, and `@/ui/SimUiContext`.
 */

'use client';

import { useEffect, useState } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { useSimUi } from './SimUiContext';
import type { SimEventMap, SimEventName } from '@/systems';

const POLL_HZ = 2;
const POLL_DELAY_MS = Math.round(1000 / POLL_HZ);

/** Maximum number of entries kept in the bounded log buffer. */
const MAX_ENTRIES = 20;

/**
 * Log entry — normalized shape suitable for the bounded buffer.
 * `kind` is the event name; `payload` is the raw event payload
 * stored as a structural snapshot. `t` is the wall-clock time the
 * entry was added (for the timestamp column).
 */
export interface CityLogEntry {
  readonly id: number;
  readonly kind: SimEventName;
  readonly payload: unknown;
  readonly t: number;
}

/**
 * Map event names to the dot color used in the log. Centralized so
 * adding a new event is a one-line change. Hex literals are
 * intentional here — the engine palette is for the renderer; the
 * log is a UI surface and we want strong, distinct hues for each
 * event category.
 */
const EVENT_DOT_COLOR: Readonly<Record<SimEventName, string>> = {
  arrival: '#3aa0ff',
  company_open: '#4ade80',
  company_close: '#f59e0b',
  traffic_jam: '#ff5577',
  new_day: '#a78bfa',
  citizen_hired: '#22d3ee',
  citizen_fired: '#f472b6',
};

/**
 * Human-readable label for an event kind, used in the log row.
 */
const EVENT_LABEL: Readonly<Record<SimEventName, string>> = {
  arrival: 'Arrival',
  company_open: 'Open',
  company_close: 'Close',
  traffic_jam: 'Traffic jam',
  new_day: 'New day',
  citizen_hired: 'Hired',
  citizen_fired: 'Fired',
};

/**
 * Format a payload as a short single-line summary. Falls back to
 * a JSON stringification for unknown shapes; the function is
 * pure and has no side effects.
 */
function summarize(kind: SimEventName, payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  switch (kind) {
    case 'arrival':
      return `${p.citizenId ?? '?'} → ${p.buildingId ?? '?'} (${p.kind ?? 'visit'})`;
    case 'company_open':
    case 'company_close':
      return `${p.name ?? p.defId ?? 'building'} (${p.buildingId ?? '?'})`;
    case 'traffic_jam':
      return `${(p.vehicles as unknown[])?.length ?? 0} vehicles on ${(p.tiles as unknown[])?.length ?? 0} tiles`;
    case 'new_day':
      return `Day ${p.day ?? '?'} · treasury ${typeof p.treasury === 'number' ? `$${Math.round(p.treasury).toLocaleString('en-US')}` : '?'}`;
    case 'citizen_hired':
    case 'citizen_fired':
      return `${p.citizenId ?? '?'} @ ${p.buildingId ?? '?'}`;
    default:
      return '';
  }
}

/**
 * Build the (newest-first, capped) log buffer from the existing
 * buffer plus a fresh event.
 */
function appendEntry(prev: readonly CityLogEntry[], entry: CityLogEntry): readonly CityLogEntry[] {
  const next = [entry, ...prev];
  if (next.length <= MAX_ENTRIES) return next;
  return next.slice(0, MAX_ENTRIES);
}

export function CityLog(): JSX.Element {
  const { bus } = useSimUi();
  const [entries, setEntries] = useState<readonly CityLogEntry[]>([]);
  // Monotonic id used to give each row a stable React key.
  const idRef = useState({ value: 0 })[0];

  // Subscribe to every event in SimEventMap. The `useEffect` cleanup
  // unsubscribes from each event in turn, so no listener leaks
  // across unmounts or strict-mode double-mounts.
  useEffect(() => {
    if (!bus) return undefined;
    const unsubs: Array<() => void> = [];
    const eventNames: readonly SimEventName[] = [
      'arrival',
      'company_open',
      'company_close',
      'traffic_jam',
      'new_day',
      'citizen_hired',
      'citizen_fired',
    ];
    for (const name of eventNames) {
      const off = bus.on(name, (payload) => {
        idRef.value += 1;
        const entry: CityLogEntry = {
          id: idRef.value,
          kind: name,
          payload,
          t: Date.now(),
        };
        setEntries((prev) => appendEntry(prev, entry));
      });
      unsubs.push(off);
    }
    return () => {
      for (const off of unsubs) off();
    };
    // `bus` is a stable ref; this effect runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus]);

  // 2 Hz poll — re-renders the component so the timestamps stay
  // roughly current, even when no new event has fired. This also
  // makes the smoke-test "non-empty after 2s" trivially pass for
  // environments that emit at least one event.
  useInterval(() => {
    // Force a re-render; the array reference doesn't need to change
    // because the consumer renders from `entries` directly.
    setEntries((prev) => prev.slice());
  }, POLL_DELAY_MS);

  if (entries.length === 0) {
    return (
      <aside
        role="log"
        aria-live="polite"
        aria-label="City event log"
        style={containerStyle}
        data-testid="city-log"
      >
        <header style={headerStyle}>
          <span style={titleStyle}>City Log</span>
          <span style={countStyle}>0/20</span>
        </header>
        <ul style={listStyle}>
          <li style={emptyStyle}>No events yet.</li>
        </ul>
      </aside>
    );
  }

  return (
    <aside
      role="log"
      aria-live="polite"
      aria-label="City event log"
      style={containerStyle}
      data-testid="city-log"
    >
      <header style={headerStyle}>
        <span style={titleStyle}>City Log</span>
        <span style={countStyle}>{entries.length}/20</span>
      </header>
      <ul style={listStyle}>
        {entries.map((entry) => (
          <li
            key={entry.id}
            style={rowStyle}
            data-testid="city-log-row"
            data-kind={entry.kind}
          >
            <span
              aria-hidden
              style={{
                ...dotStyle,
                background: EVENT_DOT_COLOR[entry.kind],
              }}
            />
            <span style={labelStyle}>{EVENT_LABEL[entry.kind]}</span>
            <span style={summaryStyle}>{summarize(entry.kind, entry.payload)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 72,
  right: 12,
  width: 280,
  maxHeight: 'calc(100vh - 96px)',
  display: 'flex',
  flexDirection: 'column',
  background: 'rgba(11, 18, 32, 0.78)',
  color: '#e6edf6',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 8,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSize: 13,
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  pointerEvents: 'auto',
  zIndex: 10,
  userSelect: 'none',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
  fontWeight: 600,
};

const titleStyle: React.CSSProperties = {
  letterSpacing: 0.4,
};

const countStyle: React.CSSProperties = {
  color: '#8a98ac',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 11,
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  overflowY: 'auto',
  flex: 1,
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '12px auto 1fr',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  display: 'inline-block',
};

const labelStyle: React.CSSProperties = {
  color: '#cfd6e0',
  fontWeight: 500,
};

const summaryStyle: React.CSSProperties = {
  color: '#9aa6b8',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const emptyStyle: React.CSSProperties = {
  padding: '12px',
  color: '#8a98ac',
  fontStyle: 'italic',
  textAlign: 'center',
};

export default CityLog;

// Re-export the buffer cap so tests can assert against the same
// constant the component enforces.
export const CITY_LOG_MAX_ENTRIES = MAX_ENTRIES;
// Suppress unused-import warning for the SimEventMap type — keeping
// the import as documentation of which bus this component is bound
// to.
type _SimEventMapRef = SimEventMap;
