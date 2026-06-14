/**
 * SimEvents — the concrete payload shapes for every event the
 * `EventBus` publishes.
 *
 * The map type lives here (and not in `EventBus.ts`) so payload
 * shapes are colocated with the systems that emit them. Consumers
 * import the map from this file and instantiate
 * `new EventBus<SimEventMap>()`.
 *
 * Layer rule: pure TypeScript. No React, no DOM, no engine runtime.
 */

import type { TileCoord } from '@/engine/types';

/** Where a citizen is arriving. */
export type ArrivalKind = 'work' | 'home' | 'shop' | 'leisure' | 'errand';

/**
 * Payload of the `arrival` event — emitted by the economy system
 * (via `recordArrival`) whenever a citizen arrives at a building.
 * The hook is currently called from the `MovementSystem` / page
 * wiring; `EconomySystem` just exposes the stable public surface.
 */
export interface ArrivalEvent {
  readonly citizenId: string;
  readonly buildingId: string;
  readonly kind: ArrivalKind;
}

/**
 * Payload of the `company_open` / `company_close` events — emitted
 * exactly once per business-day cycle when a company's `isOpen`
 * predicate flips state.
 */
export interface CompanyOpenCloseEvent {
  readonly buildingId: string;
  readonly defId: string;
  /** Company display name, for log rendering. */
  readonly name: string;
  /** Day on which the event fired. */
  readonly day: number;
}

/**
 * Payload of the `traffic_jam` event — emitted by the economy
 * system (via `recordTrafficJam`) when a cluster of vehicles is
 * detected on a set of tiles. Coordinates and vehicle ids are
 * forwarded as-is to subscribers for the minimap / dashboard.
 */
export interface TrafficJamEvent {
  /** Tile coordinates of the congested cells. */
  readonly tiles: readonly TileCoord[];
  /** Ids of the vehicles stuck in the jam. */
  readonly vehicles: readonly string[];
  /** Approximate number of vehicles in the jam (== vehicles.length). */
  readonly severity: number;
}

/**
 * Payload of the `new_day` event — emitted by the economy system
 * when a new in-world day starts. Treasury reflects the city
 * treasury *after* that day's revenue, wages, tax and infrastructure
 * costs have been applied.
 */
export interface NewDayEvent {
  readonly day: number;
  /** In-world hour at which the rollover occurred. */
  readonly hour: number;
  /** City treasury after the day's accounting close. */
  readonly treasury: number;
}

/**
 * Payload of the `citizen_hired` / `citizen_fired` events — emitted
 * by the economy system when an employee is added to or removed
 * from a building's roster.
 */
export interface CitizenHiredEvent {
  readonly citizenId: string;
  readonly buildingId: string;
  readonly day: number;
}

export interface CitizenFiredEvent {
  readonly citizenId: string;
  readonly buildingId: string;
  readonly day: number;
}

/**
 * The full set of events the simulation can publish. Adding a new
 * event is as simple as adding a key here and calling
 * `bus.emit('new_event', { ... })` in the producing system.
 *
 * The explicit string index signature satisfies
 * `EventMap = Record<string, unknown>` so `SimEventMap` can be
 * passed as the type parameter to `EventBus<SimEventMap>` without
 * a structural mismatch.
 */
export interface SimEventMap extends Record<string, unknown> {
  arrival: ArrivalEvent;
  company_open: CompanyOpenCloseEvent;
  company_close: CompanyOpenCloseEvent;
  traffic_jam: TrafficJamEvent;
  new_day: NewDayEvent;
  citizen_hired: CitizenHiredEvent;
  citizen_fired: CitizenFiredEvent;
}

/**
 * Convenience keys — useful in tests / dashboards that switch on event name.
 * Values mirror the `SimEventMap` keys so the same string can be used in
 * `bus.emit(SIM_EVENT_NAMES.NEW_DAY, payload)` and the type-checker will
 * refuse to drift. Exposes both the string constants and a typed
 * `SimEventName` union for switch-statement exhaustiveness.
 */
export const SIM_EVENT_NAMES = {
  arrival: 'arrival',
  company_open: 'company_open',
  company_close: 'company_close',
  traffic_jam: 'traffic_jam',
  new_day: 'new_day',
  citizen_hired: 'citizen_hired',
  citizen_fired: 'citizen_fired',
} as const satisfies { [K in keyof SimEventMap]: K };

/** Union of every published event name. Useful for switch exhaustiveness. */
export type SimEventName = keyof SimEventMap;
