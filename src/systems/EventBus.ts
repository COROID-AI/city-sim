/**
 * EventBus — typed pub/sub for inter-system communication.
 *
 * Spec reference: §7.4 Economy (event-driven dashboard, log, mini-map).
 *
 * The brief says "extend existing EventBus" but no EventBus exists in
 * the codebase yet (verified via grep across `src/`). This module
 * introduces the canonical bus and exposes a small typed event map
 * so downstream systems stay free of stringly-typed errors.
 *
 * Layer rule: this file lives in `src/systems/`, which is
 * framework-agnostic. No React, no DOM, no engine imports.
 *
 * Semantics:
 *   - `emit` is SYNCHRONOUS: listeners run in registration order.
 *   - Listener isolation: if a listener throws, the bus catches the
 *     error, forwards it to an optional `onError` hook, and continues
 *     dispatching to the remaining listeners.
 *   - `on` returns an `Unsubscribe` function for cleanup in React
 *     effects (useEffect can call it on unmount).
 */

import type { CitizenId, CompanyId, VehicleId, BuildingId, Vector2 } from '@/types/common';

/**
 * The complete event map for the city simulator. Adding a new event
 * is a type-only change: extend the union for the event name and add
 * the payload shape. Consumers get exhaustiveness checks for free.
 */
export interface CityEventMap {
  /** A new in-game day has started (emitted at hour 0 transition). */
  new_day: { day: number; totalMinutes: number };
  /** A company was opened by the EconomySystem. */
  company_opened: { companyId: CompanyId; buildingTypeId: string; position: Vector2 };
  /** A company was closed by the EconomySystem. */
  company_closed: { companyId: CompanyId; reason: 'shutdown' | 'bankrupt' | 'manual' };
  /** A citizen finished their commute and was restored to the world. */
  commute_arrived: { citizenId: CitizenId; destination: Vector2 };
  /** Traffic congestion has exceeded the configured threshold. */
  traffic_jam: { tileKey: string; vehicleCount: number; durationMs: number };
  /** Test hook: a low-traffic heartbeat that QA can subscribe to. */
  traffic_clear: { tileKey: string };
  /** Generic building event used by the CityGenerator to surface new buildings. */
  building_placed: { buildingId: BuildingId; position: Vector2 };
  /** A vehicle was destroyed (e.g. despawned on arrival). */
  vehicle_despawned: { vehicleId: VehicleId };
}

/** All known event names. Useful for iteration and tests. */
export type CityEventName = keyof CityEventMap;

/** A listener is a function that consumes a single payload. */
export type CityEventListener<T extends CityEventName> = (payload: CityEventMap[T]) => void;

/** Returned by `on` so callers can detach the listener cleanly. */
export type Unsubscribe = () => void;

/** Optional error reporter. Defaults to swallowing into console.warn. */
export type EventBusErrorHandler = (eventName: string, error: unknown) => void;

const defaultErrorHandler: EventBusErrorHandler = (eventName, error) => {
  // eslint-disable-next-line no-console
  console.warn(`[EventBus] listener for "${String(eventName)}" threw:`, error);
};

/**
 * A generic typed bus. The type parameter is the event map; defaults
 * to `CityEventMap` so the city-wide bus is the common case. Tests
 * can supply a narrower map to assert on a small surface.
 *
 * The generic is intentionally unconstrained (no `extends Record<...>`)
 * to keep the bus usable from systems that import only `CityEventMap`
 * without TypeScript needing an explicit index signature on the map.
 */
export class EventBus<TMap = CityEventMap> {
  private readonly listeners: Map<keyof TMap, Set<(payload: unknown) => void>> = new Map();
  private readonly errorHandler: EventBusErrorHandler;

  constructor(options: { onError?: EventBusErrorHandler } = {}) {
    this.errorHandler = options.onError ?? defaultErrorHandler;
  }

  /**
   * Register a listener for `eventName`. Returns an `Unsubscribe`
   * function the caller can invoke to detach.
   */
  on<K extends keyof TMap & string>(eventName: K, listener: (payload: TMap[K]) => void): Unsubscribe {
    const set = this.getOrCreate(eventName as keyof TMap);
    const wrapped = listener as (payload: unknown) => void;
    set.add(wrapped);
    return () => {
      this.listeners.get(eventName as keyof TMap)?.delete(wrapped);
    };
  }

  /**
   * Register a one-shot listener. The callback is invoked at most
   * once for `eventName`, then auto-unsubscribed.
   */
  once<K extends keyof TMap & string>(eventName: K, listener: (payload: TMap[K]) => void): Unsubscribe {
    const off: Unsubscribe[] = [];
    const wrapped = (payload: TMap[K]): void => {
      off.forEach((fn) => fn());
      listener(payload);
    };
    off.push(this.on(eventName, wrapped));
    return () => off.forEach((fn) => fn());
  }

  /**
   * Remove every listener for `eventName`. If `eventName` is omitted,
   * remove EVERY listener on the bus.
   */
  off<K extends keyof TMap & string>(eventName?: K): void {
    if (eventName === undefined) {
      this.listeners.clear();
      return;
    }
    this.listeners.delete(eventName as keyof TMap);
  }

  /**
   * Synchronously dispatch `payload` to every listener of `eventName`.
   * Listeners are invoked in registration order. A throwing listener
   * is reported to the error handler and does NOT stop the dispatch.
   */
  emit<K extends keyof TMap & string>(eventName: K, payload: TMap[K]): void {
    const set = this.listeners.get(eventName as keyof TMap);
    if (set === undefined || set.size === 0) return;
    const snapshot = Array.from(set);
    for (const listener of snapshot) {
      try {
        listener(payload);
      } catch (err) {
        this.errorHandler(eventName, err);
      }
    }
  }

  /** Returns the number of listeners currently registered for `eventName`. */
  listenerCount<K extends keyof TMap & string>(eventName: K): number {
    return this.listeners.get(eventName as keyof TMap)?.size ?? 0;
  }

  /** Returns every event name that has at least one listener. */
  eventNames(): readonly (keyof TMap)[] {
    return Array.from(this.listeners.keys());
  }

  private getOrCreate(eventName: keyof TMap): Set<(payload: unknown) => void> {
    let set = this.listeners.get(eventName);
    if (set === undefined) {
      set = new Set<(payload: unknown) => void>();
      this.listeners.set(eventName, set);
    }
    return set;
  }
}

/** A shared, default-constructed bus for the city simulator. */
export const cityBus = new EventBus<CityEventMap>();
