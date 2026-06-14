'use client';

/**
 * CityLog - scrolling event log fed by the EventBus.
 * Each switch case below handles a *narrowed* event of type SimEventOf<K>,
 * so the payload type is inferred by the discriminated union — no `as`
 * casts and no TS18046 errors under `strict: true`.
 * // keep in sync with SimEventMap
 */

import * as React from 'react';
import type {
  SimEventOf,
  SimEventType,
} from '@/systems/EventBus';

type SupportedEventType = Exclude<SimEventType, 'tick'>;

function isSupportedEvent(
  event: { readonly type: SimEventType },
): event is SimEventOf<SupportedEventType> {
  return event.type !== 'tick';
}

function summarize(event: SimEventOf<SupportedEventType>): string {
  switch (event.type) {
    case 'money.changed': {
      const p = event.payload;
      const sign = p.delta >= 0 ? '+' : '';
      return `Treasury ${sign}${p.delta} (${p.reason}) -> ${p.treasury}`;
    }
    case 'citizen.hired': {
      const p = event.payload;
      return `Citizen ${p.citizenId} hired at ${p.companyType} ${p.companyId}`;
    }
    case 'shift.started': {
      const p = event.payload;
      return `Shift started at ${p.companyId} (h${p.hour})`;
    }
    case 'shift.ended': {
      const p = event.payload;
      return `Shift ended at ${p.companyId} (h${p.hour})`;
    }
    case 'building.constructed': {
      const p = event.payload;
      return `Built ${p.defId} (${p.buildingId}) at (${p.origin.x},${p.origin.y})`;
    }
    default:
      return `${event.type}`;
  }
}

export interface CityLogProps {
  readonly events: ReadonlyArray<{ readonly type: SimEventType }>;
  readonly maxEntries?: number;
}

export function CityLog({ events, maxEntries = 50 }: CityLogProps): React.JSX.Element {
  const visible = React.useMemo(() => {
    return events
      .filter(isSupportedEvent)
      .slice(-maxEntries)
      .reverse();
  }, [events, maxEntries]);

  return (
    <aside aria-label="City event log" className="city-log" data-testid="city-log">
      <h2 className="city-log__title">City Log</h2>
      {visible.length === 0 ? (
        <p className="city-log__empty">No events yet.</p>
      ) : (
        <ol className="city-log__list">
          {visible.map((event) => (
            <li key={event.seq} className="city-log__entry" data-event-type={event.type}>
              <time className="city-log__time">{new Date(event.at).toLocaleTimeString()}</time>
              <span className="city-log__summary">{summarize(event)}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

export default CityLog;
