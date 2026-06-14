'use client';

/**
 * CityLog - scrolling event log fed by the EventBus.
 * Each switch case below handles a *narrowed* payload from SimEventMap, so
 * the file compiles cleanly under `strict: true` with no TS18046 errors.
 * // keep in sync with SimEventMap
 */

import * as React from 'react';
import type {
  SimEvent,
  SimEventMap,
  SimEventType,
} from '@/systems/EventBus';

type SupportedEventType = Exclude<SimEventType, 'tick'>;

function isSupportedEvent(event: SimEvent): event is SimEvent & { type: SupportedEventType } {
  return event.type !== 'tick';
}

type PayloadByType = {
  readonly [K in SupportedEventType]: SimEventMap[K];
};

function summarize(event: SimEvent & { type: SupportedEventType }): string {
  switch (event.type) {
    case 'money.changed': {
      const p = event.payload as PayloadByType['money.changed'];
      const sign = p.delta >= 0 ? '+' : '';
      return `Treasury ${sign}${p.delta} (${p.reason}) -> ${p.treasury}`;
    }
    case 'citizen.hired': {
      const p = event.payload as PayloadByType['citizen.hired'];
      return `Citizen ${p.citizenId} hired at ${p.companyType} ${p.companyId}`;
    }
    case 'shift.started': {
      const p = event.payload as PayloadByType['shift.started'];
      return `Shift started at ${p.companyId} (h${p.hour})`;
    }
    case 'shift.ended': {
      const p = event.payload as PayloadByType['shift.ended'];
      return `Shift ended at ${p.companyId} (h${p.hour})`;
    }
    case 'building.constructed': {
      const p = event.payload as PayloadByType['building.constructed'];
      return `Built ${p.defId} (${p.buildingId}) at (${p.origin.x},${p.origin.y})`;
    }
    default:
      return `${event.type}`;
  }
}

export interface CityLogProps {
  readonly events: ReadonlyArray<SimEvent>;
  readonly maxEntries?: number;
}

export function CityLog({ events, maxEntries = 50 }: CityLogProps): React.JSX.Element {
  const visible = React.useMemo(() => {
    return events.filter(isSupportedEvent).slice(-maxEntries).reverse();
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
