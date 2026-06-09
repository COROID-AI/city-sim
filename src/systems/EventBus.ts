/**
 * EventBus — minimal typed pub/sub for engine systems.
 *
 * Design goals:
 *   - Zero dependencies. Pure TS, no React, no DOM.
 *   - Strictly typed events. Each event name maps to a payload type.
 *   - Throw isolation: a handler that throws does not break emission to
 *     subsequent handlers. The exception is reported via `console.warn`
 *     alongside the event name and (when available) the listener id.
 *   - Stable iteration order: handlers are invoked in subscription order.
 *   - Off-by-name and off-by-handler both supported, plus a `clear` reset
 *     and a wildcard (`'*'`) subscription channel.
 *
 * The wildcard listener receives `{ type, payload }` envelopes for every
 * event, which is useful for an instrumentation dashboard (see the
 * EventBus-instrumentation downstream task).
 *
 * Concurrency: this class is single-threaded; it assumes all calls
 * happen on the simulation thread (or inside a single tick). It is not
 * safe to mutate subscriptions concurrently with emit() from another
 * thread.
 */

export type EventName = string;

/**
 * A single event in the system. Use string literal types for `name`
 * (e.g. `type GameEvents = 'citizen.spawn' | 'economy.tick'`) to get
 * payload type-checking at the call site.
 */
export interface Envelope<T = unknown> {
  readonly type: EventName;
  readonly payload: T;
}

/** Per-event handler. Receives the typed payload. */
export type EventHandler<T = unknown> = (payload: T) => void;

/** Wildcard handler. Receives the full envelope for every event. */
export type WildcardHandler = (envelope: Envelope<unknown>) => void;

/**
 * Listener metadata kept for diagnostics and stable unsubscribe.
 * The `id` is monotonically increasing and unique within the bus, so
 * callers can store a reference and unsubscribe by id even if the
 * handler closure is not retained.
 */
interface ListenerRecord<T = unknown> {
  readonly id: number;
  readonly name: EventName;
  readonly handler: EventHandler<T>;
}

interface WildcardRecord {
  readonly id: number;
  readonly handler: WildcardHandler;
}

const WILDCARD_NAME: '*' = '*';

export class EventBus {
  private nextId = 1;
  /** Per-name handler lists, preserving subscription order. */
  private readonly listeners: Map<EventName, ListenerRecord<unknown>[]> = new Map();
  private readonly wildcards: WildcardRecord[] = [];

  /**
   * Subscribe to an event. Returns an unsubscribe function. The
   * returned function is idempotent: calling it more than once has
   * no additional effect.
   */
  on<T = unknown>(name: EventName, handler: EventHandler<T>): () => void {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('EventBus.on: event name must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new Error('EventBus.on: handler must be a function');
    }
    const record: ListenerRecord<T> = {
      id: this.nextId++,
      name,
      handler,
    };
    const list = this.listeners.get(name);
    if (list === undefined) {
      this.listeners.set(name, [record as unknown as ListenerRecord<unknown>]);
    } else {
      list.push(record as unknown as ListenerRecord<unknown>);
    }
    return (): void => this.offById(name, record.id);
  }

  /**
   * Subscribe to all events via the wildcard channel. Receives the
   * full envelope. Returns an unsubscribe function (idempotent).
   */
  onAny(handler: WildcardHandler): () => void {
    if (typeof handler !== 'function') {
      throw new Error('EventBus.onAny: handler must be a function');
    }
    const record: WildcardRecord = { id: this.nextId++, handler };
    this.wildcards.push(record);
    return (): void => {
      const idx = this.wildcards.findIndex((w) => w.id === record.id);
      if (idx >= 0) this.wildcards.splice(idx, 1);
    };
  }

  /**
   * Unsubscribe a specific handler from a specific event. No-op if the
   * handler is not currently subscribed.
   */
  off<T = unknown>(name: EventName, handler: EventHandler<T>): void {
    if (typeof name !== 'string' || name.length === 0) return;
    const list = this.listeners.get(name);
    if (list === undefined) return;
    const idx = list.findIndex((r) => r.handler === (handler as unknown as EventHandler<unknown>));
    if (idx >= 0) list.splice(idx, 1);
  }

  /**
   * Remove every listener for a given event. Useful for teardown.
   * Does not affect wildcard subscribers.
   */
  removeAllListeners(name: EventName): void {
    this.listeners.delete(name);
  }

  /**
   * Drop every subscription (typed and wildcard). The bus can be
   * reused after a clear.
   */
  clear(): void {
    this.listeners.clear();
    this.wildcards.length = 0;
  }

  /**
   * Emit an event. Handlers are invoked in subscription order. A
   * handler that throws is caught and logged via `console.warn`; the
   * remaining handlers still run. Wildcard subscribers run after the
   * typed handlers for the same event.
   */
  emit<T = unknown>(name: EventName, payload: T): void {
    if (typeof name !== 'string' || name.length === 0) {
      console.warn('EventBus.emit: ignoring empty event name');
      return;
    }
    const list = this.listeners.get(name);
    if (list !== undefined) {
      // Iterate over a snapshot so a handler that unsubscribes itself
      // does not skip the next handler.
      const snapshot = list.slice();
      for (const rec of snapshot) {
        try {
          (rec.handler as EventHandler<T>)(payload);
        } catch (err: unknown) {
          console.warn(
            `EventBus: handler for "${name}" (id=${rec.id}) threw:`,
            err,
          );
        }
      }
    }
    if (this.wildcards.length > 0) {
      const envelope: Envelope<unknown> = { type: name, payload: payload as unknown };
      const snap = this.wildcards.slice();
      for (const w of snap) {
        try {
          w.handler(envelope);
        } catch (err: unknown) {
          console.warn(
            `EventBus: wildcard handler (id=${w.id}) threw for "${name}":`,
            err,
          );
        }
      }
    }
  }

  /** Number of typed listeners currently registered for `name`. */
  listenerCount(name: EventName): number {
    return this.listeners.get(name)?.length ?? 0;
  }

  /** Total typed subscriptions across every event. */
  totalListenerCount(): number {
    let n = 0;
    for (const list of this.listeners.values()) n += list.length;
    return n;
  }

  /** Number of wildcard subscribers. */
  wildcardCount(): number {
    return this.wildcards.length;
  }

  /**
   * The wildcard name. Exposed as a constant so downstream code can
   * reference it without hardcoding `'*'` in multiple places.
   */
  static readonly WILDCARD: '*' = WILDCARD_NAME;

  private offById(name: EventName, id: number): void {
    const list = this.listeners.get(name);
    if (list === undefined) return;
    const idx = list.findIndex((r) => r.id === id);
    if (idx >= 0) list.splice(idx, 1);
  }
}

export default EventBus;
