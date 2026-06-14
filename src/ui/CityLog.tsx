'use client';

/**
 * CityLog - scrolling event log fed by the EventBus.
 *
 * Per-event-type handlers are stored in a typed lookup table keyed by
 * `SimEventType`. Each entry is typed `(event: SimEventOf<K>) => string`,
 * so the payload type is *narrowed* by the discriminant with no `as` casts
 * and no TS18046 errors under `strict: true`.
 * // keep in sync with SimEventMap
 */

import * as React from 'react';
import type {
  MoneyChangedPayload,
  CitizenHiredPayload,
  ShiftStartedPayload,
  ShiftEndedPayload,
  BuildingConstructedPayload,
  SimEventOf,
  SimEventType,
} from '@/systems/EventBus';

type SupportedEventType = Exclude<SimEventType, 'tick'>;

function isSupportedEvent(
  event: { readonly type: SimEventType },
): event is SimEventOf<SupportedEventType> {
  return event.type !== 'tick';
}

type SummarizeHandlers = {
  readonly [K in SupportedEventType]: (event: SimEventOf<K>) => string;
};

const SUMMARIZERS: SummarizeHandlers = {
  'money.changed': (event) => {
    const p = event.payload as MoneyChangedPayload;
    const sign = p.delta >= 0 ? '+' : '';
    return `Treasury ${sign}${p.delta} (${p.reason}) -> ${p.treasury}`;
  },
  'citizen.hired': (event) => {
    const p = event.payload as CitizenHiredPayload;
    return `Citizen ${p.citizenId} hired at ${p.companyType} ${p.companyId}`;
  },
  'shift.started': (event) => {
    const p = event.payload as ShiftStartedPayload;
    return `Shift started at ${p.companyId} (h${p.hour})`;
  },
  'shift.ended': (event) => {
    const p = event.payload as ShiftEndedPayload;
    return `Shift ended at ${p.companyId} (h${p.hour})`;
  },
  'building.constructed': (event) => {
    const p = event.payload as BuildingConstructedPayload;
    return `Built ${p.defId} (${p.buildingId}) at (${p.origin.x},${p.origin.y})`;
  },
};

function summarize(event: SimEventOf<SupportedEventType>): string {
  const handler = SUMMARIZERS[event.type] as
    | ((e: SimEventOf<SupportedEventType>) => string)
    | undefined;
  if (handler) {
    return handler(event);
  }
  return `${event.type}`;
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
