/**
 * TimeSystem — deterministic simulation clock and lighting table.
 *
 * Responsibilities:
 *   1. Advance `simTime` (seconds since day 0, midnight) on each tick
 *      using a fixed-step multiplier `speed`.
 *   2. Expose a 4-phase lighting model: dawn / day / dusk / night, with
 *      linear 30-sim-min (1800s) fades between adjacent phases.
 *   3. Provide the current `Lighting` snapshot for the Renderer, so the
 *      overlay tint can be drawn without the Renderer needing to know
 *      about time.
 *
 * Determinism:
 *   - `tick(dt)` adds exactly `dt * speed` to `simTime`. There is no
 *     floating-point drift correction; the model is "linear seconds"
 *     and is reproducible for any given sequence of (initial, dt,
 *     speed) inputs.
 *   - The lighting phase lookup is a pure function of `simTime`.
 *
 * The 30-sim-min fade window is a constant (`FADE_SECONDS`) so QA and
 * tooling can override it per-build if the design intent changes.
 *
 * Time is measured in *sim-seconds*, not real wall-clock seconds. At
 * speed=1, one real second advances one sim-second.
 */

import { EventBus, type EventName } from './EventBus';

/** One of the four named lighting phases. */
export type LightingPhase = 'dawn' | 'day' | 'dusk' | 'night';

/**
 * A single RGB tint, components in [0, 1]. The renderer converts this
 * to a CSS color (clamped, premultiplied by alpha when needed).
 */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Snapshot of the lighting model for the current frame. The renderer
 * uses `phaseColor` and `phaseAlpha` directly; the explicit `phase`
 * and `alpha` are provided for downstream systems (e.g. citizen AI
 * deciding whether to use streetlights).
 */
export interface Lighting {
  /** Dominant named phase at this instant. */
  readonly phase: LightingPhase;
  /** Base tint of the dominant phase. */
  readonly phaseColor: Rgb;
  /**
   * Tint of the *next* phase we're fading toward (or the same color
   * when not in a fade). The renderer linearly interpolates between
   * `phaseColor` and `nextColor` using `phaseAlpha`.
   */
  readonly nextColor: Rgb;
  /** Blend weight in [0, 1]. 0 = pure `phaseColor`, 1 = pure `nextColor`. */
  readonly phaseAlpha: number;
  /** Convenience alpha used by the overlay; 0 outside a fade window. */
  readonly overlayAlpha: number;
  /**
   * Final blended tint. Renderer can use this directly; we expose it
   * so unit tests can assert the full math.
   */
  readonly blended: Rgb;
}

/** A read-only view of the simulation clock. */
export interface TimeState {
  /** Sim-seconds elapsed since the start of day 0. Always >= 0. */
  readonly simTime: number;
  /** Current speed multiplier. 0 = paused. */
  readonly speed: number;
  /** Convenience: floor(simTime / SECONDS_PER_DAY). */
  readonly day: number;
}

/** Options bag for the constructor. */
export interface TimeSystemOptions {
  /** Initial sim-time in seconds. Default 0 (midnight). */
  readonly initialTime?: number;
  /** Initial speed multiplier. Default 1. */
  readonly initialSpeed?: number;
  /** Optional EventBus for emitting `time.phase` / `time.day` events. */
  readonly bus?: EventBus;
  /**
   * Fade window between adjacent phases, in sim-seconds. Default
   * 1800 (30 sim-minutes). Override only for tooling/QA.
   */
  readonly fadeSeconds?: number;
  /**
   * Optional override for the phase color table. Useful for theme
   * testing. Colors are RGB components in [0, 1].
   */
  readonly paletteOverride?: Partial<Record<LightingPhase, Rgb>>;
}

/** Sim-seconds per in-game day. */
export const SECONDS_PER_DAY = 24 * 60 * 60; // 86400
/** Sim-seconds per in-game hour. */
export const SECONDS_PER_HOUR = 60 * 60; // 3600
/** Default fade window in sim-seconds (30 sim-minutes). */
export const FADE_SECONDS = 30 * 60; // 1800
/** Allowed speed presets exposed in the UI. */
export const SPEED_PRESETS: readonly number[] = [0, 1, 2, 5, 10] as const;

/** Default color table for the four phases. RGB in [0, 1]. */
export const DEFAULT_PHASE_COLORS: Readonly<Record<LightingPhase, Rgb>> = Object.freeze({
  dawn: { r: 1.0, g: 0.78, b: 0.55 },
  day: { r: 1.0, g: 1.0, b: 1.0 },
  dusk: { r: 1.0, g: 0.62, b: 0.42 },
  night: { r: 0.12, g: 0.16, b: 0.32 },
});

/**
 * Boundaries for the four named phases in sim-seconds-of-day.
 * Each phase is the *full-strength* window; fades live in the gaps
 * between them.
 *
 *   dawn: 05:00 -> 07:00  (full)
 *   day:  07:00 -> 17:00  (full)
 *   dusk: 17:00 -> 19:00  (full)
 *   night: 19:00 -> 05:00 next day (full)
 *
 * Fades (30 sim-min each):
 *   night -> dawn  over 04:30..05:00
 *   dawn  -> day   over 07:00..07:30
 *   day   -> dusk  over 17:00..17:30
 *   dusk  -> night over 19:00..19:30
 */
const PHASE_BOUNDARIES = Object.freeze({
  // Seconds-of-day where each phase becomes fully established.
  dawnStart: 5 * SECONDS_PER_HOUR,        // 18000
  dayStart: 7 * SECONDS_PER_HOUR,         // 25200
  duskStart: 17 * SECONDS_PER_HOUR,       // 61200
  nightStart: 19 * SECONDS_PER_HOUR,      // 68400
});

/** Clamp a number to [0, 1]. */
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Mix two RGB colors linearly. t in [0, 1]. */
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

/** Convert sim-seconds to seconds-of-day (always in [0, SECONDS_PER_DAY)). */
const toSecondsOfDay = (simTime: number): number => {
  const t = simTime % SECONDS_PER_DAY;
  return t < 0 ? t + SECONDS_PER_DAY : t;
};

export class TimeSystem {
  private simTime: number;
  private speed: number;
  private readonly bus: EventBus | null;
  private readonly fadeSeconds: number;
  private readonly colors: Readonly<Record<LightingPhase, Rgb>>;
  private lastEmittedDay: number;
  private lastEmittedPhase: LightingPhase | null;

  constructor(options: TimeSystemOptions = {}) {
    this.simTime = options.initialTime ?? 0;
    this.speed = options.initialSpeed ?? 1;
    this.bus = options.bus ?? null;
    this.fadeSeconds = options.fadeSeconds ?? FADE_SECONDS;
    this.colors = options.paletteOverride
      ? { ...DEFAULT_PHASE_COLORS, ...options.paletteOverride }
      : DEFAULT_PHASE_COLORS;
    this.lastEmittedDay = Math.floor(this.simTime / SECONDS_PER_DAY);
    this.lastEmittedPhase = null;
  }

  /**
   * Advance the simulation by `dt` real-seconds, multiplied by the
   * current `speed`. Idempotent: re-running with the same (dt, speed)
   * produces the same new simTime.
   */
  tick(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.simTime += dt * this.speed;
    this.maybeEmitEvents();
  }

  /**
   * Set the speed multiplier. 0 means paused. Negative values are
   * clamped to 0 (we don't support time-reversal in this phase).
   */
  setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) return;
    this.speed = speed < 0 ? 0 : speed;
  }

  /** Read the current speed multiplier. */
  getSpeed(): number {
    return this.speed;
  }

  /** Read the current sim-time in seconds since midnight of day 0. */
  getTime(): number {
    return this.simTime;
  }

  /** Get a snapshot of the time state for the UI. */
  getTimeState(): TimeState {
    return {
      simTime: this.simTime,
      speed: this.speed,
      day: Math.floor(this.simTime / SECONDS_PER_DAY),
    };
  }

  /**
   * Compute the lighting snapshot for the current sim-time. This is
   * a pure function of `simTime` and the configured palette; calling
   * it repeatedly is safe and side-effect free.
   */
  getLighting(): Lighting {
    const tod = toSecondsOfDay(this.simTime);
    const fade = this.fadeSeconds;
    const c = this.colors;
    const SEC = SECONDS_PER_HOUR;

    // The full-strength windows are:
    //   dawn  05:00..07:00
    //   day   07:00..17:00
    //   dusk  17:00..19:00
    //   night 19:00..05:00 next day
    // Fades live in 30-sim-min windows LEADING OUT of each full window
    // (i.e. the day->dusk fade is 17:00..17:30, ending at full dusk).
    //
    // For each branch below, `fadeStart` is the sim-second where alpha=0
    // (full base color) and `fadeEnd` is where alpha=1 (full next color).
    // The end of a fade is exactly the start of the next phase's full
    // window, so `tod >= fadeEnd` falls through to the next full branch.

    let phase: LightingPhase;
    let next: LightingPhase;
    let fadeStart: number;
    let fadeEnd: number;

    const dawnStart = 5 * SEC;        // 18000
    const dayStart = 7 * SEC;         // 25200
    const duskStart = 17 * SEC;       // 61200
    const nightStart = 19 * SEC;      // 68400

    // Night full window: 19:00 .. 05:00 (next day). The night->dawn
    // fade is the last 30 min: 04:30 .. 05:00.
    if (tod >= nightStart || tod < dawnStart - fade) {
      phase = 'night';
      next = 'night';
      fadeStart = 0;
      fadeEnd = 0;
    } else if (tod < dawnStart) {
      // Night -> Dawn fade: 04:30 .. 05:00
      phase = 'night';
      next = 'dawn';
      fadeStart = dawnStart - fade;
      fadeEnd = dawnStart;
    } else if (tod < dayStart) {
      // Dawn full window: 05:00 .. 07:00. The dawn->day fade is the
      // last 30 min: 06:30 .. 07:00.
      if (tod >= dayStart - fade) {
        phase = 'dawn';
        next = 'day';
        fadeStart = dayStart - fade;
        fadeEnd = dayStart;
      } else {
        phase = 'dawn';
        next = 'dawn';
        fadeStart = 0;
        fadeEnd = 0;
      }
    } else if (tod < duskStart + fade) {
      // Day full window: 07:00 .. 17:00. The day->dusk fade follows
      // immediately: 17:00 .. 17:30.
      if (tod >= duskStart) {
        phase = 'day';
        next = 'dusk';
        fadeStart = duskStart;
        fadeEnd = duskStart + fade;
      } else {
        phase = 'day';
        next = 'day';
        fadeStart = 0;
        fadeEnd = 0;
      }
    } else if (tod < nightStart + fade) {
      // Dusk full window: 17:00 .. 19:00. The dusk->night fade follows
      // immediately: 19:00 .. 19:30.
      if (tod >= nightStart) {
        phase = 'dusk';
        next = 'night';
        fadeStart = nightStart;
        fadeEnd = nightStart + fade;
      } else {
        phase = 'dusk';
        next = 'dusk';
        fadeStart = 0;
        fadeEnd = 0;
      }
    } else {
      // Unreachable: covered by the night full branch above.
      phase = 'night';
      next = 'night';
      fadeStart = 0;
      fadeEnd = 0;
    }

    const phaseColor = c[phase];
    const nextColor = c[next];
    let phaseAlpha = 0;
    if (phase !== next && fade > 0) {
      const elapsed = tod - fadeStart;
      phaseAlpha = clamp01(elapsed / fade);
    }
    const blended = mixRgb(phaseColor, nextColor, phaseAlpha);
    return {
      phase,
      phaseColor,
      nextColor,
      phaseAlpha,
      overlayAlpha: phaseAlpha,
      blended,
    };
  }

  /**
   * Apply a RenderFrame-compatible lighting record to a target. Used
   * by the CityView wiring code to populate `frame.lighting` from
   * this system. Returns the same record for convenience.
   */
  snapshotLighting(): Lighting {
    return this.getLighting();
  }

  /** Resolve the configured fade window (sim-seconds). */
  getFadeSeconds(): number {
    return this.fadeSeconds;
  }

  /** Resolve the active phase color table (after any override). */
  getPalette(): Readonly<Record<LightingPhase, Rgb>> {
    return this.colors;
  }

  /**
   * Emit `time.phase` and `time.day` events when the corresponding
   * state changes. Called internally from `tick()`. Public so callers
   * driving sim-time via a custom mechanism can re-emit.
   */
  maybeEmitEvents(): void {
    if (this.bus === null) return;
    const day = Math.floor(this.simTime / SECONDS_PER_DAY);
    if (day !== this.lastEmittedDay) {
      this.lastEmittedDay = day;
      safeEmit(this.bus, 'time.day', { day });
    }
    const phase = this.getLighting().phase;
    if (phase !== this.lastEmittedPhase) {
      this.lastEmittedPhase = phase;
      safeEmit(this.bus, 'time.phase', { phase });
    }
  }
}

function safeEmit(bus: EventBus, name: EventName, payload: unknown): void {
  try {
    bus.emit(name, payload);
  } catch (err: unknown) {
    console.warn(`TimeSystem: emit("${name}") threw:`, err);
  }
}

export default TimeSystem;
