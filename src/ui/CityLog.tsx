'use client';

import { useEffect, useState } from 'react';
import { useSimUi } from '@/ui/SimUiContext';
import type { SimEventMap, SimEventName } from '@/systems/SimEvents';

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 320,
  maxHeight: '40vh',
  overflowY: 'auto',
  background: 'rgba(17, 24, 39, 0.85)',
  color: '#f5f5f5',
  borderRadius: 8,
  padding: 12,
  font: '12px/1.4 ui-sans-serif, system-ui, sans-serif',
  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.35)',
  pointerEvents: 'auto',
  zIndex: 10,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  paddingBottom: 6,
};

const titleStyle: React.CSSProperties = {
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  fontSize: 11,
};

const countStyle: React.CSSProperties = {
  opacity: 0.7,
  fontVariantNumeric: 'tabular-nums',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '12px 1fr auto',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  display: 'inline-block',
};

const labelStyle: React.CSSProperties = {
  fontWeight: 500,
};

const summaryStyle: React.CSSProperties = {
  opacity: 0.7,
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 180,
};

const EVENT_LABEL: Record<SimEventName, string> = {
  arrival: 'Arrival',
  company_open: 'Opened',
  company_close: 'Closed',
  traffic_jam: 'Traffic',
  new_day: 'New Day',
  citizen_hired: 'Hired',
  citizen_fired: 'Fired',
};

const EVENT_DOT_COLOR: Record<SimEventName, string> = {
  arrival: '#60a5fa',
  company_open: '#22c55e',
  company_close: '#94a3b8',
  traffic_jam: '#fb7185',
  new_day: '#facc15',
  citizen_hired: '#a78bfa',
  citizen_fired: '#fbbf24',
};

type LogRow<K extends SimEventName = SimEventName> = {
  readonly id: number;
  readonly kind: K;
  readonly payload: SimEventMap[K];
};

let nextId = 0;
function nextRowId(): number {
  nextId += 1;
  return nextId;
}

function summarize(kind: SimEventName, payload: SimEventMap[SimEventName]): string {
  switch (kind) {
    // Exhaustive switch: all SimEventName variants are covered.
    default:
      // Should never happen because EVENT_LABEL and SimEventName are in sync.
      return String(kind);
    case 'arrival': {
      const p = payload as SimEventMap['arrival'];
      return `${p.citizenId} → ${p.buildingId}`;
    }
    case 'company_open':
    case 'company_close': {
      const p = payload as SimEventMap['company_open'];
      return `${p.name} (day ${p.day})`;
    }
    case 'traffic_jam': {
      const p = payload as SimEventMap['traffic_jam'];
      return `severity ${p.severity}`;
    }
    case 'new_day': {
      const p = payload as SimEventMap['new_day'];
      return `treasury ${p.treasury}`;
    }
    case 'citizen_hired':
    case 'citizen_fired': {
      const p = payload as SimEventMap['citizen_hired'];
      return `${p.citizenId} @ ${p.buildingId}`;
    }
  }
}

export function CityLog(): React.ReactElement {
  const { bus } = useSimUi();
  const [entries, setEntries] = useState<readonly LogRow[]>([]);

  useEffect(() => {
    if (!bus) return undefined;

    const MAX_ENTRIES = 20;

    const onAny = <K extends SimEventName>(kind: K, payload: SimEventMap[K]): void => {
      setEntries((prev) => {
        const next: LogRow<K>[] = [{ id: nextRowId(), kind, payload }, ...prev] as LogRow<K>[];
        return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
      });
    };

    const offs = (Object.keys(EVENT_LABEL) as SimEventName[]).map((k) =>
      bus.on(k, (payload) => onAny(k, payload as SimEventMap[typeof k])),
    );

    return () => {
      for (const off of offs) off();
    };
  }, [bus]);

  return (
    <aside
      role="log"
      aria-live="polite"
      aria-label="City event log"
      style={containerStyle}
      data-testid="city-log"
      data-event-log="event-log"
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

export default CityLog;
