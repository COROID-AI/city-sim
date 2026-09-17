/**
 * The simulation clock.
 *
 * Time is expressed as whole sim-minutes. The clock is advanced either with
 * `advanceTicks(count)` (fixed steps, what the engine uses) or with
 * `advanceMinutes(minutes)` (a raw minute jump). Whenever the advance crosses
 * an hour boundary the clock emits an end-of-hour event for the completed hour
 * followed by a start-of-hour event for the new one, so hourly systems (the
 * economy, schedules, tax collection) can hook them without polling.
 */

import type { DayPhase } from './types';

export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;

/** Immutable reading of the clock. */
export interface SimTime {
  /** 0-based day index; the HUD displays `day + 1`. */
  readonly day: number;
  /** Hour-of-day, 0..23. */
  readonly hour: number;
  /** Minute-of-hour, 0..59. */
  readonly minute: number;
  /** Total sim-minutes elapsed since the clock origin. */
  readonly totalMinutes: number;
}

/** Payload delivered on both hour channels. */
export interface HourBoundary {
  /** Hour-of-day (0..23) that just completed. */
  readonly endedHour: number;
  /** Day the completed hour belonged to. */
  readonly endedDay: number;
  /** Hour-of-day (0..23) that just began. */
  readonly startedHour: number;
  /** Day the new hour belongs to (increments at midnight). */
  readonly day: number;
  /** Total sim-minutes at the boundary (minute is always 0). */
  readonly totalMinutes: number;
  /** Clock reading at the boundary. */
  readonly time: SimTime;
  /** Day/night phase of the hour that just began. */
  readonly phase: DayPhase;
}

export type HourListener = (boundary: HourBoundary) => void;
export type Unsubscribe = () => void;

export interface SimClockOptions {
  /** 0-based start day. Defaults to 0. */
  startDay?: number;
  /** Start hour-of-day, 0..23. Defaults to 0. */
  startHour?: number;
  /** Start minute-of-hour, 0..59. Defaults to 0. */
  startMinute?: number;
  /** Sim-minutes advanced per `advanceTicks()` call. Defaults to 1. */
  minutesPerTick?: number;
}

/** Phase boundaries, evaluated top to bottom; the last match wins. */
const PHASE_START_HOURS: readonly { readonly sinceHour: number; readonly phase: DayPhase }[] = [
  { sinceHour: 0, phase: 'night' },
  { sinceHour: 5, phase: 'dawn' },
  { sinceHour: 8, phase: 'morning' },
  { sinceHour: 12, phase: 'day' },
  { sinceHour: 17, phase: 'evening' },
  { sinceHour: 21, phase: 'night' },
];

/** Resolves the day/night phase for an hour-of-day (0..23). */
export function resolveDayPhase(hour: number): DayPhase {
  if (!Number.isFinite(hour)) {
    throw new RangeError(`resolveDayPhase(hour) expects a finite hour, received ${hour}`);
  }
  const normalized = ((Math.floor(hour) % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  let phase: DayPhase = PHASE_START_HOURS[0].phase;
  for (const entry of PHASE_START_HOURS) {
    if (normalized >= entry.sinceHour) {
      phase = entry.phase;
    }
  }
  return phase;
}

function assertIntegerInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer between ${min} and ${max}, received ${value}`);
  }
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export class SimClock {
  /** Sim-minutes advanced by one `advanceTicks()` call. */
  readonly minutesPerTick: number;

  private readonly initialTotalMinutes: number;
  private baseTotalMinutes: number;
  private elapsedMinutes = 0;
  private hourStartListeners: HourListener[] = [];
  private hourEndListeners: HourListener[] = [];

  constructor(options: SimClockOptions = {}) {
    const startDay = options.startDay ?? 0;
    const startHour = options.startHour ?? 0;
    const startMinute = options.startMinute ?? 0;
    const minutesPerTick = options.minutesPerTick ?? 1;
    assertIntegerInRange(startDay, 0, Number.MAX_SAFE_INTEGER, 'startDay');
    assertIntegerInRange(startHour, 0, HOURS_PER_DAY - 1, 'startHour');
    assertIntegerInRange(startMinute, 0, MINUTES_PER_HOUR - 1, 'startMinute');
    if (!Number.isInteger(minutesPerTick) || minutesPerTick < 1) {
      throw new RangeError(`minutesPerTick must be a positive integer, received ${minutesPerTick}`);
    }
    this.minutesPerTick = minutesPerTick;
    this.initialTotalMinutes =
      startDay * MINUTES_PER_DAY + startHour * MINUTES_PER_HOUR + startMinute;
    this.baseTotalMinutes = this.initialTotalMinutes;
  }

  /* ------------------------------------------------------------- reading -- */

  get totalMinutes(): number {
    return this.baseTotalMinutes + this.elapsedMinutes;
  }

  /** 0-based day index (display as `day + 1`). */
  get day(): number {
    return Math.floor(this.totalMinutes / MINUTES_PER_DAY);
  }

  get hourOfDay(): number {
    return Math.floor((this.totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  }

  get minuteOfHour(): number {
    return this.totalMinutes % MINUTES_PER_HOUR;
  }

  /** Day/night phase of the current hour. */
  get phase(): DayPhase {
    return resolveDayPhase(this.hourOfDay);
  }

  /** Fraction of the current day already elapsed, 0..1 (useful for lighting). */
  get dayProgress(): number {
    return (this.totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_DAY;
  }

  /** Snapshot of the current sim time. */
  get time(): SimTime {
    return {
      day: this.day,
      hour: this.hourOfDay,
      minute: this.minuteOfHour,
      totalMinutes: this.totalMinutes,
    };
  }

  get hourStartListenerCount(): number {
    return this.hourStartListeners.length;
  }

  get hourEndListenerCount(): number {
    return this.hourEndListeners.length;
  }

  /** `"HH:MM"` label for the current sim time. */
  formatTime(): string {
    return `${pad2(this.hourOfDay)}:${pad2(this.minuteOfHour)}`;
  }

  /** Human facing label, e.g. `"Day 2, 07:35"`. */
  formatDayTime(): string {
    return `Day ${this.day + 1}, ${this.formatTime()}`;
  }

  /* ------------------------------------------------------------- control -- */

  /** Advances `count` fixed ticks (each `minutesPerTick` sim-minutes). */
  advanceTicks(count = 1): SimTime {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`advanceTicks(count) expects a non-negative integer, received ${count}`);
    }
    return this.advanceMinutes(count * this.minutesPerTick);
  }

  /**
   * Advances the clock by whole sim-minutes.
   * Fires `end-of-hour` then `start-of-hour` for every boundary crossed, in
   * chronological order, so a large jump behaves like many small ones.
   */
  advanceMinutes(minutes: number): SimTime {
    if (!Number.isInteger(minutes) || minutes < 0) {
      throw new RangeError(`advanceMinutes(minutes) expects a non-negative integer, received ${minutes}`);
    }
    let remaining = minutes;
    while (remaining > 0) {
      const step = Math.min(remaining, MINUTES_PER_HOUR - this.minuteOfHour);
      this.elapsedMinutes += step;
      remaining -= step;
      if (this.minuteOfHour === 0) {
        this.emitHourBoundary();
      }
    }
    return this.time;
  }

  /** Jumps to an absolute time; no hour events are emitted. */
  setTime(partial: { day?: number; hour?: number; minute?: number } = {}): SimTime {
    const day = partial.day ?? this.day;
    const hour = partial.hour ?? this.hourOfDay;
    const minute = partial.minute ?? this.minuteOfHour;
    assertIntegerInRange(day, 0, Number.MAX_SAFE_INTEGER, 'day');
    assertIntegerInRange(hour, 0, HOURS_PER_DAY - 1, 'hour');
    assertIntegerInRange(minute, 0, MINUTES_PER_HOUR - 1, 'minute');
    this.baseTotalMinutes = day * MINUTES_PER_DAY + hour * MINUTES_PER_HOUR + minute;
    this.elapsedMinutes = 0;
    return this.time;
  }

  /** Returns to the time the clock was constructed with; listeners are kept. */
  reset(): SimTime {
    this.baseTotalMinutes = this.initialTotalMinutes;
    this.elapsedMinutes = 0;
    return this.time;
  }

  /**
   * Subscribes to the moment a new hour begins.
   * Returns an unsubscribe function; listeners are called in subscription order.
   */
  onHourStart(listener: HourListener): Unsubscribe {
    this.hourStartListeners.push(listener);
    return () => {
      this.hourStartListeners = this.hourStartListeners.filter((entry) => entry !== listener);
    };
  }

  /**
   * Subscribes to the moment an hour completes (just before the next begins).
   * Returns an unsubscribe function; listeners are called in subscription order.
   */
  onHourEnd(listener: HourListener): Unsubscribe {
    this.hourEndListeners.push(listener);
    return () => {
      this.hourEndListeners = this.hourEndListeners.filter((entry) => entry !== listener);
    };
  }

  /* ------------------------------------------------------------ internal -- */

  private emitHourBoundary(): void {
    const total = this.totalMinutes;
    const previousTotal = total - MINUTES_PER_HOUR;
    const boundary: HourBoundary = {
      endedHour: Math.floor((previousTotal % MINUTES_PER_DAY) / MINUTES_PER_HOUR),
      endedDay: Math.floor(previousTotal / MINUTES_PER_DAY),
      startedHour: this.hourOfDay,
      day: this.day,
      totalMinutes: total,
      time: this.time,
      phase: this.phase,
    };
    for (const listener of [...this.hourEndListeners]) {
      listener(boundary);
    }
    for (const listener of [...this.hourStartListeners]) {
      listener(boundary);
    }
  }
}
