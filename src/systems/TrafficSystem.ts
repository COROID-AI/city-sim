/**
 * TrafficSystem — drives the traffic-light phase cycle for road tiles.
 *
 * Responsibilities:
 *  - Walk every road tile in the world and advance its `lightPhase`
 *    counter on every fixed-step tick.
 *  - Compute the current visual phase (green / yellow / red) for a
 *    given tile by mapping the counter through a small cycle table.
 *  - Expose `isGreenAt(tile)` so vehicles can decide whether to
 *    proceed, stop, or yield at the intersection.
 *
 * Layer rule: pure TypeScript, no React, no DOM, no engine runtime
 * imports. Operates on a structural world view (`TrafficSystemWorldView`)
 * so the engine's `World` class can be substituted with a fake in
 * tests.
 */

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/** Discrete traffic-light state. The renderer maps these to colours. */
export type TrafficPhase = 'green' | 'yellow' | 'red';

/**
 * Minimal world view the TrafficSystem needs. Decouples the system
 * from the engine `World` class so unit tests can pass a hand-rolled
 * fake without instantiating the full engine.
 */
export interface TrafficSystemWorldView {
  /**
   * Iterate every road tile. The callback receives the tile's
   * row-major `index` and the phase counter (an integer that the
   * renderer / system increments every tick).
   */
  forEachRoadTile(callback: (index: number, phaseCounter: number) => void): void;
  /** Total number of tiles in the world. */
  readonly tileCount: number;
}

export interface TrafficSystemOptions {
  /**
   * How long (in seconds, in-world) the green phase lasts.
   * Default: 8 s.
   */
  greenSeconds?: number;
  /** How long the yellow phase lasts. Default: 2 s. */
  yellowSeconds?: number;
  /** How long the red phase lasts. Default: 8 s. */
  redSeconds?: number;
  /**
   * Master speed multiplier applied to phase advance. Setting this
   * to 0 freezes every light (useful for debugging or for a global
   * "pause traffic" button). Default: 1.
   */
  speed?: number;
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

export const DEFAULT_GREEN_SECONDS = 8;
export const DEFAULT_YELLOW_SECONDS = 2;
export const DEFAULT_RED_SECONDS = 8;
export const DEFAULT_TRAFFIC_SPEED = 1;

/* -------------------------------------------------------------------------- */
/* System                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cycle table for a single intersection. We treat the light as a
 * 3-state machine with green → yellow → red → green. The `phaseCounter`
 * stored on each road tile counts the elapsed in-world seconds within
 * the current phase; the system maps counter → phase via a small
 * lookup that handles wraparound.
 */
export class TrafficSystem {
  private readonly greenSeconds: number;
  private readonly yellowSeconds: number;
  private readonly redSeconds: number;
  private speed: number;
  private _tick = 0;

  constructor(options: TrafficSystemOptions = {}) {
    this.greenSeconds = options.greenSeconds ?? DEFAULT_GREEN_SECONDS;
    this.yellowSeconds = options.yellowSeconds ?? DEFAULT_YELLOW_SECONDS;
    this.redSeconds = options.redSeconds ?? DEFAULT_RED_SECONDS;
    this.speed = options.speed ?? DEFAULT_TRAFFIC_SPEED;
    if (!(this.greenSeconds > 0)) {
      throw new RangeError('greenSeconds must be > 0');
    }
    if (!(this.yellowSeconds > 0)) {
      throw new RangeError('yellowSeconds must be > 0');
    }
    if (!(this.redSeconds > 0)) {
      throw new RangeError('redSeconds must be > 0');
    }
    if (!Number.isFinite(this.speed) || this.speed < 0) {
      throw new RangeError('speed must be >= 0');
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Tick                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Advance every road tile's phase counter by `dtSeconds` (real-time
   * seconds), scaled by the current speed multiplier. Pass a frozen
   * `world` to also halt the cycle (used by pause).
   *
   * The system does not mutate the world tiles directly: it is a
   * pure read+compute step that publishes phase transitions through
   * `onPhaseChange` for any consumer that needs to react (e.g. the
   * renderer). Callers that want to persist the new phase counter
   * should subscribe and write back via their own store.
   */
  tick(world: TrafficSystemWorldView, dtSeconds: number): void {
    if (!(dtSeconds > 0)) return;
    if (this.speed === 0) {
      this._tick += 1;
      return;
    }
    const dt = dtSeconds * this.speed;
    world.forEachRoadTile((index, phaseCounter) => {
      const next = phaseCounter + dt;
      this._publishPhase(index, next);
    });
    this._tick += 1;
  }

  /* ---------------------------------------------------------------------- */
  /* Phase queries                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * Map a phase counter (in in-world seconds) to a discrete phase.
   * Exposed for the renderer / vehicle planner; the test suite uses
   * this directly to assert boundary behaviour.
   */
  phaseFor(phaseCounter: number): TrafficPhase {
    if (!(phaseCounter >= 0)) return 'green';
    const cycle = this.greenSeconds + this.yellowSeconds + this.redSeconds;
    const t = ((phaseCounter % cycle) + cycle) % cycle;
    if (t < this.greenSeconds) return 'green';
    if (t < this.greenSeconds + this.yellowSeconds) return 'yellow';
    return 'red';
  }

  /** True when the light at the given counter is green or yellow. */
  isGreenAt(phaseCounter: number): boolean {
    const p = this.phaseFor(phaseCounter);
    return p === 'green' || p === 'yellow';
  }

  /** Master speed multiplier. */
  getSpeed(): number {
    return this.speed;
  }

  /**
   * Set the master speed multiplier. 0 freezes every light without
   * pausing the loop. Negative values are rejected.
   */
  setSpeed(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      throw new RangeError('speed must be >= 0');
    }
    this.speed = multiplier;
  }

  /** Number of times `tick()` has been invoked. Useful for tests. */
  getTick(): number {
    return this._tick;
  }

  /* ---------------------------------------------------------------------- */
  /* Events (no-op by default)                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Internal hook so subclasses / tests can observe per-tile phase
   * transitions. The default implementation is a no-op; the concrete
   * production subclass (in a downstream task) wires this to the
   * EventBus.
   *
   * Marked `protected` so unit tests can spy on it via a subclass.
   */
  protected _publishPhase(_index: number, _phaseCounter: number): void {
    // no-op
  }
}
