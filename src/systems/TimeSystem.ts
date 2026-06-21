/**
 * TimeSystem — configurable simulation clock with day/night cycle.
 *
 * One sim-day = 5 real minutes (300 000 ms) at 1× speed.
 * Supported speed multipliers: 0 (pause), 1, 2, 5.
 * Emits a 'new_day' event each time the day counter increments.
 */

import type { CityTime } from '@/engine/types';

/** Valid speed multipliers. */
const VALID_SPEEDS = new Set([0, 1, 2, 5]);

/** Real milliseconds per sim-day at 1× speed. */
const MS_PER_SIM_DAY = 300_000;

/** Sim minutes per sim day (24 h × 60 min). */
const SIM_MINUTES_PER_DAY = 24 * 60;

/** Real ms per sim-minute at 1× speed. */
const MS_PER_SIM_MINUTE = MS_PER_SIM_DAY / SIM_MINUTES_PER_DAY;

/**
 * Determine whether a given hour is considered daytime.
 * Daytime = hour in [6, 18] inclusive.
 */
function isDaytime(hour: number): boolean {
  return hour >= 6 && hour <= 18;
}

/** Event listener callback signature. */
export type TimeEventListener = (day: number) => void;

export class TimeSystem {
  // ---- Time state ----
  private hour = 0;
  private minute = 0;
  private day = 1;
  private tick = 0;
  private elapsedMs = 0;

  /**
   * Total accumulated sim-milliseconds (real-ms × speed), tracked as integer.
   * Used to compute whole sim-minutes via exact integer arithmetic:
   *   totalSimMinutes = Math.floor(totalSimMs * SIM_MINUTES_PER_DAY / MS_PER_SIM_DAY)
   * This avoids floating-point drift from accumulating fractional sim-minutes.
   */
  private totalSimMs = 0;

  /** Number of sim-minutes already committed to the clock. */
  private committedSimMinutes = 0;

  // ---- Event listeners ----
  private readonly newDayListeners = new Set<TimeEventListener>();

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Advance simulation time.
   *
   * @param deltaMs        Real elapsed milliseconds (must be ≥ 0).
   * @param speedMultiplier Speed factor — only 0, 1, 2, or 5 accepted.
   */
  update(deltaMs: number, speedMultiplier: number): void {
    if (deltaMs < 0) {
      throw new Error(`TimeSystem.update: deltaMs must be >= 0, got ${deltaMs}`);
    }
    if (!VALID_SPEEDS.has(speedMultiplier)) {
      throw new Error(
        `TimeSystem.update: speedMultiplier must be one of [0, 1, 2, 5], got ${speedMultiplier}`,
      );
    }

    // Paused — no advancement.
    if (speedMultiplier === 0) return;

    // No elapsed time — nothing to do.
    if (deltaMs === 0) return;

    this.tick += 1;
    this.elapsedMs += deltaMs;

    // Accumulate sim-milliseconds (integer: deltaMs × speed is always integer
    // since valid speeds are integers and deltaMs is a number).
    this.totalSimMs += deltaMs * speedMultiplier;

    // Compute total whole sim-minutes using integer-first arithmetic to
    // avoid floating-point drift:
    //   totalSimMinutes = floor(totalSimMs * 1440 / 300000)
    // totalSimMs * 1440 is an integer (or very close for large values),
    // so the division yields an exact floor.
    const totalSimMinutes = Math.floor(
      (this.totalSimMs * SIM_MINUTES_PER_DAY) / MS_PER_SIM_DAY,
    );

    // Only advance the delta since last commit.
    const newMinutes = totalSimMinutes - this.committedSimMinutes;
    if (newMinutes === 0) return;
    this.committedSimMinutes = totalSimMinutes;

    this.advanceMinutes(newMinutes);
  }

  /**
   * Register a listener for the 'new_day' event.
   * The listener receives the new day number.
   */
  on(event: 'new_day', listener: TimeEventListener): void {
    this.newDayListeners.add(listener);
  }

  /** Remove a previously registered 'new_day' listener. */
  off(event: 'new_day', listener: TimeEventListener): void {
    this.newDayListeners.delete(listener);
  }

  /**
   * Return a snapshot of the current simulation time.
   * The returned object is a fresh copy — callers may mutate freely.
   */
  getCityTime(): CityTime {
    return {
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      hour: this.hour,
      minute: this.minute,
      day: this.day,
      isDaytime: isDaytime(this.hour),
    };
  }

  /** Reset the clock to its initial state (hour=0, minute=0, day=1). */
  reset(): void {
    this.hour = 0;
    this.minute = 0;
    this.day = 1;
    this.tick = 0;
    this.elapsedMs = 0;
    this.totalSimMs = 0;
    this.committedSimMinutes = 0;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /** Advance the clock by `count` whole sim-minutes, rolling over as needed. */
  private advanceMinutes(count: number): void {
    let daysCrossed = 0;

    this.minute += count;

    // Roll minutes into hours.
    if (this.minute >= 60) {
      const hoursDelta = Math.floor(this.minute / 60);
      this.minute %= 60;
      this.hour += hoursDelta;
    }

    // Roll hours into days.
    if (this.hour >= 24) {
      daysCrossed = Math.floor(this.hour / 24);
      this.hour %= 24;
      this.day += daysCrossed;
    }

    // Emit one 'new_day' event per day crossed.
    for (let i = 0; i < daysCrossed; i += 1) {
      this.emitNewDay(this.day - daysCrossed + i + 1);
    }
  }

  /** Emit 'new_day' to all listeners, catching errors per listener. */
  private emitNewDay(newDay: number): void {
    for (const listener of this.newDayListeners) {
      try {
        listener(newDay);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[TimeSystem] new_day listener threw:', err);
      }
    }
  }
}
