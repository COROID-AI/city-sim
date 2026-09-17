/**
 * Domain event plumbing.
 *
 * Systems never mutate state directly. They `emit` events into a channel; the
 * runtime drains that channel at fixed-step boundaries and reduces the events
 * into `GameState`. Two consequences matter:
 *
 *  - Ordering is deterministic: a drain sorts by event timestamp and, for equal
 *    timestamps, keeps emission order (stable sort).
 *  - The same event list replayed into the same starting state always produces
 *    the same resulting state, which is what tests and replays rely on.
 */

import type { DomainEvent, GameState } from '../sim/state';
import { applyDomainEvents, compareDomainEvents } from '../sim/state';

/** Receives every emitted domain event, in emission order. */
export type DomainEventListener = (event: DomainEvent) => void;
/** Removes a previously registered listener. */
export type Unsubscribe = () => void;

/**
 * Emission channel between systems, the runtime and observers (UI, telemetry).
 *
 * `emit()` queues the event for the simulation and notifies live listeners
 * immediately. `drain()` hands the queued events to the runtime, which reduces
 * them into state at the next step boundary.
 */
export interface DomainEventChannel {
  emit(event: DomainEvent): void;
  /** Observe emissions (for UI, logging, dev overlays). Returns an unsubscribe. */
  on(listener: DomainEventListener): Unsubscribe;
  /** Number of events queued and not yet reduced into state. */
  readonly pending: number;
  /** Queued events in deterministic order, removing them from the queue. */
  drain(): DomainEvent[];
  /** Drop queued events and every listener. */
  clear(): void;
}

export function createDomainEventChannel(): DomainEventChannel {
  const listeners = new Set<DomainEventListener>();
  let queue: DomainEvent[] = [];

  return {
    emit(event: DomainEvent): void {
      queue.push(event);
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    on(listener: DomainEventListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get pending(): number {
      return queue.length;
    },
    drain(): DomainEvent[] {
      if (queue.length === 0) return [];
      const batch = [...queue].sort(compareDomainEvents);
      queue = [];
      return batch;
    },
    clear(): void {
      queue = [];
      listeners.clear();
    },
  };
}

/** Result of reducing a batch of events into state. */
export interface ReplayResult {
  state: GameState;
  applied: DomainEvent[];
}

/**
 * Append-only journal of domain events with deterministic replay.
 *
 * Used by fixtures to build sample states, by tests to prove replay
 * determinism, and by dev-preview pages to show what the factory just did.
 */
export interface DomainEventJournal {
  record(event: DomainEvent): DomainEvent;
  readonly length: number;
  entries(): readonly DomainEvent[];
  /** Reduce a batch through `state`, consuming it. */
  drainTo(state: GameState): ReplayResult;
  /** Reduce every entry (without consuming) — the replay path. */
  replay(state: GameState): ReplayResult;
  clear(): void;
}

export function createDomainEventJournal(): DomainEventJournal {
  let entries: DomainEvent[] = [];

  return {
    record(event: DomainEvent): DomainEvent {
      entries.push(event);
      return event;
    },
    get length(): number {
      return entries.length;
    },
    entries(): readonly DomainEvent[] {
      return entries;
    },
    drainTo(state: GameState): ReplayResult {
      const applied = [...entries].sort(compareDomainEvents);
      entries = [];
      return { state: applyDomainEvents(state, applied), applied };
    },
    replay(state: GameState): ReplayResult {
      const applied = [...entries].sort(compareDomainEvents);
      return { state: applyDomainEvents(state, applied), applied };
    },
    clear(): void {
      entries = [];
    },
  };
}

/**
 * Collect events emitted while `run` executes, then reduce them in one batch.
 * Handy for one-shot setup code and tests that want an immediate state change.
 */
export function collectDomainEvents(
  channel: DomainEventChannel,
  run: () => void,
): DomainEvent[] {
  const collected: DomainEvent[] = [];
  const unsubscribe = channel.on((event) => collected.push(event));
  try {
    run();
  } finally {
    unsubscribe();
  }
  return collected;
}
