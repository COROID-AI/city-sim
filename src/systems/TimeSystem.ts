/**
 * TimeSystem — drives the in-world clock for the city simulation.
 *
 * Responsibilities:
 *  - Advance `CityTime` by `fixedDt` (seconds) on every fixed-step tick.
 *  - Apply a speed multiplier (0× freeze, 1× normal, 2/4/8× fast-forward).
 *  - Notify subscribers on every day rollover via `onDayChange()`.
 *  - Expose a `daylightFactor` in [0, 1] that the renderer uses to
 *    interpolate the night overlay, and a boolean `isDaytime()` for
 *    systems that only care about the discrete day/night state.
 *
 * Layer rule: this module is pure TypeScript. It MUST NOT import from
 * `react`, `next`, DOM globals, or `@/engine` (the engine is the
 * consumer of the time, not the other way around — importing it here
 * would create a circular dependency once EconomySystem is added).
 * It can only depend on engine *types* (re-exported through
 * `@/engine` as structural shapes, which are erased at runtime).
 *
 * Speed model: the simulation runs at `fixedDt` per tick (e.g. 1/20s).
 * `setSpeed(n)` multiplies the in-world seconds advanced per tick.
 * `setSpeed(0)` freezes the clock without pausing the loop — useful
 * for "pause city life, keep rendering".
 */

import type { CityTime } from '@/engine';

/** Hours per in-world day. */
export const HOURS_PER_DAY = 24;
/** Minutes per in-world hour (used only for display formatting). */
export const MINUTES_PER_HOUR = 60;
/** Default in-world seconds advanced per real-time second at 1× speed. */
export const DEFAULT_REAL_TO_SIM_RATIO = 60;
/** Hour of day at which daylight starts to fade into "day" (default 6). */
export const DEFAULT_DAY_START_HOUR = 6;
/** Hour of day at which "day" ends and "night" begins (default 18). */
export const DEFAULT_NIGHT_START_HOUR = 18;

/** Callback signature for day-rollover subscribers. */
export type DayChangeListener = (day: number, hour: number) => void;

/** Unsubscribe handle returned by `onDayChange()`. */
export type Unsubscribe = () => void;

export interface TimeSystemOptions {
  /** Override the in-world seconds advanced per real-time second at 1×. */
  realToSimRatio?: number;
  /** Hour at which the day period starts. Defaults to 6. */
  dayStartHour?: number;
  /** Hour at which the night period starts. Defaults to 18. */
  nightStartHour?: number;
  /** Starting clock state. Defaults to day 1, hour 8 (morning). */
  initial?: Partial<CityTime>;
}

/**
 * Pure-TS simulation clock. Owns a `CityTime` and a list of day-change
 * subscribers. Drives itself from the fixed-step callback in the page
 * (see `src/app/page.tsx`).
 */
export class TimeSystem {
  private readonly realToSimRatio: number;
  private readonly dayStartHour: number;
  private readonly nightStartHour: number;

  private _time: CityTime;
  private _speed = 1;
  private _paused = false;

  /** Set of day-change listeners keyed by their identity (the listener fn). */
  private readonly dayListeners = new Set<DayChangeListener>();

  constructor(options: TimeSystemOptions = {}) {
    this.realToSimRatio = options.realToSimRatio ?? DEFAULT_REAL_TO_SIM_RATIO;
    this.dayStartHour = options.dayStartHour ?? DEFAULT_DAY_START_HOUR;
    this.nightStartHour = options.nightStartHour ?? DEFAULT_NIGHT_START_HOUR;

    if (!(this.realToSimRatio > 0)) {
      throw new RangeError('realToSimRatio must be > 0');
    }
    if (
      !Number.isFinite(this.dayStartHour) ||
      this.dayStartHour < 0 ||
      this.dayStartHour >= HOURS_PER_DAY
    ) {
      throw new RangeError('dayStartHour must be in [0, 24)');
    }
    if (
      !Number.isFinite(this.nightStartHour) ||
      this.nightStartHour < 0 ||
      this.nightStartHour >= HOURS_PER_DAY
    ) {
      throw new RangeError('nightStartHour must be in [0, 24)');
    }

    this._time = {
      elapsed: options.initial?.elapsed ?? 0,
      tick: options.initial?.tick ?? 0,
      hour: options.initial?.hour ?? 8,
      day: options.initial?.day ?? 1,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Tick                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Advance the in-world clock by `fixedDt` real-time seconds, scaled
   * by the current speed multiplier. Call this once per fixed step
   * from the page's rAF loop.
   *
   * - `setSpeed(0)` (freeze): no in-world time passes.
   * - `paused` state: identical to `setSpeed(0)`.
   *
   * Fires `onDayChange` exactly once per in-world day rollover.
   */
  tick(fixedDt: number): void {
    if (!(fixedDt > 0)) return;
    // `CityTime` has `readonly` fields, so we mutate the local copy
    // through a non-readonly view. We then re-publish the snapshot via
    // `getTime()`.
    const t = this._time as { -readonly [K in keyof CityTime]: CityTime[K] };
    t.elapsed += fixedDt;
    t.tick += 1;
    if (this._paused || this._speed === 0) return;

    const inWorldSeconds = fixedDt * this._speed * this.realToSimRatio;
    const inWorldHours = inWorldSeconds / 3600;
    const previousDay = t.day;
    t.hour += inWorldHours;
    // Track every day that rolled over so we can fire the listener once
    // per rollover — including the rare case where a single tick spans
    // multiple day boundaries (e.g. paused sim resuming at high speed).
    const rolledOverDays: number[] = [];
    while (t.hour >= HOURS_PER_DAY) {
      t.hour -= HOURS_PER_DAY;
      t.day += 1;
      rolledOverDays.push(t.day);
    }
    if (rolledOverDays.length > 0) {
      // Fire listeners on every day that just rolled over so consumers
      // can react to "the new day has started" semantics. Listener
      // errors must not break the simulation.
      for (const listener of this.dayListeners) {
        try {
          for (const d of rolledOverDays) {
            listener(d, t.hour);
          }
        } catch {
          // Listener errors must not break the simulation.
        }
      }
    }
    // Suppress lint warning when the day value isn't consumed by callers.
    void previousDay;
  }

  /* ---------------------------------------------------------------------- */
  /* Speed                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Current speed multiplier. 0 = frozen, 1 = real-time, 2/4/8 = fast. */
  getSpeed(): number {
    return this._speed;
  }

  /**
   * Set the speed multiplier. `0` is a freeze (in-world time does not
   * advance) but ticks still fire so day-change subscribers can still
   * trigger and the renderer still updates the daylight curve.
   */
  setSpeed(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      throw new RangeError('speed multiplier must be >= 0');
    }
    this._speed = multiplier;
  }

  /* ---------------------------------------------------------------------- */
  /* Pause                                                                  */
  /* ---------------------------------------------------------------------- */

  /** True if the clock is frozen via `pause()` or `setSpeed(0)`. */
  isPaused(): boolean {
    return this._paused || this._speed === 0;
  }

  /** Freeze the clock. Equivalent to `setSpeed(0)` but tracks intent. */
  pause(): void {
    this._paused = true;
  }

  /** Resume from `pause()`. Does NOT touch the current speed multiplier. */
  resume(): void {
    this._paused = false;
  }

  /** Flip between paused and running. */
  togglePause(): void {
    this._paused = !this._paused;
  }

  /* ---------------------------------------------------------------------- */
  /* Time access                                                            */
  /* ---------------------------------------------------------------------- */

  /** Immutable snapshot of the current clock state. */
  getTime(): CityTime {
    return {
      elapsed: this._time.elapsed,
      tick: this._time.tick,
      hour: this._time.hour,
      day: this._time.day,
    };
  }

  /**
   * True between `dayStartHour` (inclusive) and `nightStartHour`
   * (exclusive). Buildings can have lights off, citizens commute, etc.
   */
  isDaytime(): boolean {
    const h = this._time.hour;
    if (this.dayStartHour <= this.nightStartHour) {
      return h >= this.dayStartHour && h < this.nightStartHour;
    }
    // Wraps midnight (e.g. dayStart=22, nightStart=6).
    return h >= this.dayStartHour || h < this.nightStartHour;
  }

  /**
   * Continuous daylight factor in [0, 1] used by the renderer to fade
   * the night overlay. Returns 1 at noon, 0 at midnight, with smooth
   * ramps around the dawn/dusk boundaries. The transition windows are
   * `transitionHours` wide centred on the dawn/dusk times.
   */
  daylightFactor(transitionHours = 2): number {
    const h = this._time.hour;
    const t = Math.max(0.1, transitionHours);
    // Peak at noon (12), trough at midnight (0 / 24).
    // Map hour -> distance from noon -> bell curve.
    const distFromNoon = Math.min(
      Math.abs(h - 12),
      HOURS_PER_DAY - Math.abs(h - 12),
    );
    // Full daylight between (noon - t) and (noon + t); fades to 0 over
    // an additional t hours on either side.
    if (distFromNoon <= HOURS_PER_DAY / 4 - t) return 1;
    if (distFromNoon >= HOURS_PER_DAY / 4 + t) return 0;
    const x =
      (distFromNoon - (HOURS_PER_DAY / 4 - t)) / (2 * t);
    return clamp01(1 - smoothstep(x));
  }

  /* ---------------------------------------------------------------------- */
  /* Events                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Subscribe to day rollover. The returned function unsubscribes.
   * Multiple subscribers are supported; listener errors are swallowed
   * so a buggy subscriber cannot break the simulation.
   */
  onDayChange(listener: DayChangeListener): Unsubscribe {
    this.dayListeners.add(listener);
    return () => {
      this.dayListeners.delete(listener);
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function smoothstep(x: number): number {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
}
