/**
 * EventBus — lightweight pub/sub hub for city simulation events (spec §3.1).
 *
 * Systems publish typed {@link CityEvent}s via `emit`; UI consumers subscribe
 * with `on` (specific type) or `'*'` (wildcard — receives every event).
 *
 * Design:
 *  - Pure in-memory Map<string, Set<handler>>. No external dependencies.
 *  - Handlers are invoked synchronously during `emit`.
 *  - The wildcard channel (`'*'`) is always notified in addition to any
 *    type-specific channel.
 *  - Iteration uses a shallow copy of the handler set so listeners may
 *    safely unsubscribe (or subscribe) during dispatch without mutating the
 *    active iterator.
 */
import type { CityEvent } from '@/engine/types';

/** Handler invoked when a subscribed event is emitted. */
export type EventHandler = (event: CityEvent) => void;

/** Wildcard channel — receives every emitted event regardless of type. */
export const WILDCARD = '*';

export class EventBus {
  /** Type (or wildcard) -> handler set. */
  private readonly channels = new Map<string, Set<EventHandler>>();

  /**
   * Cumulative count of emitted events (all types). Used by BenchmarkReporter
   * to compute event throughput per second. Reset via getAndResetEventCount().
   */
  private eventCount = 0;

  /**
   * Subscribe to events of a specific `type`, or to all events via `'*'`.
   *
   * @returns An unsubscribe function (idempotent — safe to call multiple times).
   */
  on(type: string, handler: EventHandler): () => void {
    let set = this.channels.get(type);
    if (!set) {
      set = new Set();
      this.channels.set(type, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  /**
   * Unsubscribe a previously-registered handler from the given channel.
   * If `type` is omitted the handler is removed from ALL channels.
   */
  off(type: string, handler: EventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  /**
   * Emit an event to its type-specific channel and the wildcard channel.
   * Iterates over a snapshot of each set so handlers may unsubscribe during
   * dispatch without skipping siblings.
   */
  emit(event: CityEvent): void {
    const specific = this.channels.get(event.type);
    if (specific) {
      for (const handler of [...specific]) handler(event);
    }
    const wildcard = this.channels.get(WILDCARD);
    if (wildcard) {
      for (const handler of [...wildcard]) handler(event);
    }
    this.eventCount++;
  }

  /**
   * Return the cumulative event count since the last call and reset the counter
   * to zero. Used by BenchmarkReporter to compute events-per-second over each
   * 10s reporting interval.
   */
  getAndResetEventCount(): number {
    const count = this.eventCount;
    this.eventCount = 0;
    return count;
  }

  /** Remove all handlers from all channels (test/reset helper). */
  clear(): void {
    this.channels.clear();
    this.eventCount = 0;
  }
}
