/**
 * TimeSystem — advances CityTime at a configurable speed multiplier and
 * drives the day/night cycle per spec §3.1 and §6.2.
 *
 * Time compression (CRITICAL):
 *  - 1 sim-day = 24 hours = 86,400,000 ms (sim time)
 *  - 1 sim-day = 5 real minutes = 300,000 ms (real time at 1x)
 *  - Compression ratio = 86,400,000 / 300,000 = 288
 *  - Per GameLoop step (50ms real): simDelta = 50 * speed * 288 ms
 *
 * Integration with GameLoop (spec §5.4):
 *  - TimeSystem.update(deltaMs) is called FIRST in the update sequence.
 *  - GameLoop should keep its own speed at 1; TimeSystem owns pause/1x/2x/5x
 *    to avoid double-applying the multiplier.
 *
 * Determinism:
 *  - hour/minute/day are DERIVED from totalMs via modulo arithmetic on every
 *    update, eliminating floating-point drift from incremental carry logic.
 *
 * Events:
 *  - Self-contained listener pattern (on/emit/off) so TimeSystem has no hard
 *    dependency on a not-yet-created EventBus. When one exists, TimeSystem can
 *    delegate to it without breaking its public API.
 */
import type { CityTime } from '@/engine/types';

/** Available simulation speed multipliers. */
export type SpeedMultiplier = 0 | 1 | 2 | 5;

/**
 * Compression ratio: 1 sim-day (86,400,000 ms) per 5 real minutes (300,000 ms).
 */
export const TIME_COMPRESSION = 288;

/** Milliseconds in one simulated day (24 hours). */
export const MS_PER_DAY = 86_400_000;

/** Milliseconds in one simulated hour. */
export const MS_PER_HOUR = 3_600_000;

/** Milliseconds in one simulated minute. */
export const MS_PER_MINUTE = 60_000;

/** Payload emitted on day rollover. */
export interface NewDayPayload {
  /** The new (incremented) day number. */
  day: number;
  /** Simulation time at which the new day began. */
  time: CityTime;
}

/** Listener callback signature for TimeSystem events. */
export type TimeListener = (payload: NewDayPayload) => void;

/** Event type identifiers emitted by TimeSystem. */
export const NEW_DAY_EVENT = 'new_day';

/**
 * Derive a full CityTime snapshot (day/hour/minute) from a totalMs value.
 * Centralised so update() and reset() stay perfectly consistent.
 */
function deriveCityTime(totalMs: number): CityTime {
  const day = Math.floor(totalMs / MS_PER_DAY);
  const hour = Math.floor((totalMs % MS_PER_DAY) / MS_PER_HOUR);
  const minute = Math.floor((totalMs % MS_PER_HOUR) / MS_PER_MINUTE);
  return { day, hour, minute, totalMs };
}

export class TimeSystem {
  /** Total elapsed simulation milliseconds. Source of truth for all fields. */
  private totalMs = 0;

  /** Current speed multiplier (0 = paused). */
  private speed: SpeedMultiplier = 1;

  /** Listeners keyed by event type. */
  private readonly listeners = new Map<string, Set<TimeListener>>();

  /**
   * Advance simulation time by a real-time delta.
   *
   * @param deltaMs Real-time milliseconds since the last update (e.g. the
   *   GameLoop's fixed 50ms step). The value is scaled by the current speed
   *   multiplier and the time-compression ratio.
   */
  update(deltaMs: number): void {
    if (this.speed === 0 || deltaMs <= 0) return;

    const prevDay = Math.floor(this.totalMs / MS_PER_DAY);
    this.totalMs += deltaMs * this.speed * TIME_COMPRESSION;
    const newDay = Math.floor(this.totalMs / MS_PER_DAY);

    if (newDay > prevDay) {
      this.emit(NEW_DAY_EVENT, { day: newDay, time: this.getTime() });
    }
  }

  /** Current simulation speed multiplier (0 = paused). */
  getSpeed(): SpeedMultiplier {
    return this.speed;
  }

  /**
   * Set the simulation speed multiplier.
   * @param multiplier One of 0 (pause), 1, 2, or 5.
   */
  setSpeed(multiplier: SpeedMultiplier): void {
    this.speed = multiplier;
  }

  /** Convenience: pause simulation (equivalent to setSpeed(0)). */
  pause(): void {
    this.speed = 0;
  }

  /** Whether the simulation is currently paused (speed === 0). */
  isPaused(): boolean {
    return this.speed === 0;
  }

  /**
   * Whether it is currently daytime.
   *
   * Daytime = hours 06:00 to 20:00 (inclusive of 6, exclusive of 20) per
   * spec §6.2 — 14 hours of daylight.
   */
  isDaytime(): boolean {
    const hour = Math.floor((this.totalMs % MS_PER_DAY) / MS_PER_HOUR);
    return hour >= 6 && hour < 20;
  }

  /**
   * Return an immutable snapshot of the current CityTime.
   *
   * Fields are derived from totalMs on every call, guaranteeing consistency.
   */
  getTime(): CityTime {
    return deriveCityTime(this.totalMs);
  }

  /** Total elapsed simulation milliseconds (source of truth). */
  getTotalMs(): number {
    return this.totalMs;
  }

  /**
   * Reset the clock to the city's founding moment (day 0, 00:00, totalMs 0).
   * Does NOT emit a new_day event.
   */
  reset(): void {
    this.totalMs = 0;
  }

  // ------------------------------------------------------------------
  // Lightweight event listener API (self-contained; no EventBus dep).
  // ------------------------------------------------------------------

  /**
   * Subscribe to a TimeSystem event.
   * @returns An unsubscribe function.
   */
  on(event: string, listener: TimeListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  /** Remove a previously-registered listener for the given event. */
  off(event: string, listener: TimeListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /** Emit an event to all subscribers. */
  private emit(event: string, payload: NewDayPayload): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Iterate over a copy so listeners may unsubscribe during dispatch.
    for (const listener of [...set]) {
      listener(payload);
    }
  }
}
