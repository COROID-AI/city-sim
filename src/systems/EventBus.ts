/**
 * EventBus — a tiny, typed publish/subscribe primitive.
 *
 * Used by `EconomySystem` and friends to decouple producers (the
 * simulation systems) from consumers (the React UI, the CityLog, the
 * Dashboard). The bus is *generic* over the event payload map so
 * consumers get autocompletion of the payload shape:
 *
 *   type Events = { new_day: { day: number; hour: number; treasury: number } };
 *   const bus = new EventBus<Events>();
 *   bus.on('new_day', (e) => e.day); // e is typed
 *
 * Listener errors are caught and logged (mirrors the pattern in
 * `TimeSystem.tick` for day-rollover listeners) so a buggy subscriber
 * cannot break the simulation.
 *
 * Layer rule: pure TypeScript. No React, no DOM, no engine runtime.
 */

import type { Unsubscribe } from './TimeSystem';

/** Map of event name → payload type. */
export type EventMap = Record<string, unknown>;

/** Listener for an event `K` on a bus of type `M`. */
export type Listener<K extends keyof M, M extends EventMap> = (payload: M[K]) => void;

/**
 * The default logger used for swallowed listener errors. Tests can
 * stub this via `setLogger` to capture warnings without polluting
 * the console.
 */
type Logger = (message: string, err: unknown) => void;

const defaultLogger: Logger = (message, err) => {
  // Use the warn level so production builds still see it; consumers
  // can suppress via `setLogger(() => {})` in their test harness.
  // eslint-disable-next-line no-console
  console.warn(message, err);
};

let activeLogger: Logger = defaultLogger;

/** Override the logger used to report swallowed listener errors. */
export function setEventBusLogger(logger: Logger | null): void {
  activeLogger = logger ?? (() => undefined);
}

/**
 * A generic, typed event bus. The map type `M` is the union of
 * every event name → payload the bus will ever carry. Producers
 * (i.e. `emit`) and consumers (i.e. `on`) both check the key against
 * this map at compile time, so a typo in an event name is a type
 * error rather than a silent miss.
 */
export class EventBus<M extends EventMap> {
  private readonly listeners: {
    [K in keyof M]?: Set<Listener<K, M>>;
  } = {};

  /**
   * Subscribe to an event. The returned function unsubscribes; this
   * is the same shape as `TimeSystem.onDayChange` so callers can use
   * either handle interchangeably.
   *
   * Multiple listeners for the same event are supported; they fire
   * in insertion order. A listener that throws is logged and skipped
   * — subsequent listeners and the producer still see the event.
   */
  on<K extends keyof M>(event: K, listener: Listener<K, M>): Unsubscribe {
    let bucket = this.listeners[event];
    if (bucket === undefined) {
      bucket = new Set<Listener<K, M>>();
      this.listeners[event] = bucket;
    }
    bucket.add(listener);
    return () => {
      const current = this.listeners[event];
      if (current !== undefined) current.delete(listener);
    };
  }

  /**
   * Publish an event to every subscribed listener. Listener errors
   * are caught and logged so a buggy subscriber cannot break the
   * simulation. Returns the number of listeners that were invoked.
   */
  emit<K extends keyof M>(event: K, payload: M[K]): number {
    const bucket = this.listeners[event];
    if (bucket === undefined) return 0;
    let fired = 0;
    for (const listener of bucket) {
      try {
        listener(payload);
        fired += 1;
      } catch (err) {
        activeLogger(`[EventBus] listener for "${String(event)}" threw:`, err);
      }
    }
    return fired;
  }

  /**
   * Remove every listener from every event. Useful for hot-reload
   * teardown; the UI's `useEffect` cleanup can call this rather than
   * tracking individual unsubscribe handles.
   */
  clear(): void {
    for (const key of Object.keys(this.listeners) as (keyof M)[]) {
      this.listeners[key]?.clear();
    }
  }

  /**
   * The number of registered listeners for an event. Used by tests
   * to assert subscribe/unsubscribe bookkeeping.
   */
  listenerCount<K extends keyof M>(event: K): number {
    return this.listeners[event]?.size ?? 0;
  }
}
