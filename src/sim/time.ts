/**
 * Simulation clock.
 *
 * Simulation time is decoupled from wall-clock time: one in-game hour equals
 * {@link SIM_HOUR_MS} milliseconds of real time. Systems query the clock to
 * schedule behaviours (e.g. citizens leaving for work at hour 8) and to drive
 * day/night visuals.
 */

/** Real-time milliseconds that represent one simulation hour. */
export const SIM_HOUR_MS = 2_500; // 2.5 seconds of real time per sim-hour

/** First hour considered "night". Night spans 19:00 -> 05:00 inclusive. */
export const NIGHT_START_HOUR = 19;
/** Hour after the last night hour (exclusive upper bound, before wrap). */
export const NIGHT_END_HOUR = 6;

/**
 * Determine whether a given hour of day is considered night time.
 *
 * Night spans the inclusive range 19:00 -> 05:00, i.e. hours 19, 20, 21, 22,
 * 23, 0, 1, 2, 3, 4, 5.
 *
 * @param hour - Hour of day in the range [0, 23].
 * @returns true when the hour is night time.
 */
export function isNight(hour: number): boolean {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/** Mutable simulation clock state. */
export class SimClock {
  /** Current hour of day, always in the range [0, 23]. */
  currentSimHour: number;
  /** Current day number, starting at 0. Increments on 23 -> 0 wrap. */
  day: number;
  /** Sub-hour real-time accumulator in milliseconds. */
  private accumulatedMs: number;

  constructor(startHour = 8, startDay = 0) {
    this.currentSimHour = startHour % 24;
    this.day = startDay;
    this.accumulatedMs = 0;
  }

  /**
   * Advance the simulation clock by `deltaMs` real-time milliseconds.
   *
   * Whole sim-hours are consumed immediately; any remainder is retained and
   * carried into the next step. When the hour wraps past 23 it returns to 0
   * and the day counter increments.
   *
   * @param deltaMs - Elapsed real-time milliseconds (must be >= 0).
   * @returns The number of whole sim-hours advanced during this step.
   */
  step(deltaMs: number): number {
    if (deltaMs < 0) {
      throw new Error(`step() requires a non-negative deltaMs, got ${deltaMs}`);
    }
    this.accumulatedMs += deltaMs;
    const hoursAdvanced = Math.floor(this.accumulatedMs / SIM_HOUR_MS);
    if (hoursAdvanced <= 0) return 0;

    this.accumulatedMs -= hoursAdvanced * SIM_HOUR_MS;
    this.currentSimHour += hoursAdvanced;

    // Wrap hours and increment the day counter for every full 24-hour cycle.
    const totalHours = this.currentSimHour;
    this.day += Math.floor(totalHours / 24);
    this.currentSimHour = totalHours % 24;

    return hoursAdvanced;
  }

  /** Whether the current hour is night time. */
  get isNight(): boolean {
    return isNight(this.currentSimHour);
  }

  /** Reset the clock to an initial state. */
  reset(startHour = 8, startDay = 0): void {
    this.currentSimHour = startHour % 24;
    this.day = startDay;
    this.accumulatedMs = 0;
  }
}
