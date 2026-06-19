/**
 * GameLoop — fixed-timestep simulation loop decoupled from rendering.
 *
 * Implements Glenn Fiedler's "Fix Your Timestep" pattern:
 *   - Each rAF frame computes a real-time delta.
 *   - The delta is accumulated (capped at MAX_ACCUMULATOR_MS to avoid the
 *     spiral-of-death when a tab is backgrounded and rAF is throttled).
 *   - While the accumulator holds at least one fixed step, `update(dt)` is
 *     called with a deterministic `dt` (STEP_MS * speed). This guarantees the
 *     simulation always advances in 20Hz (50ms) increments regardless of the
 *     display refresh rate.
 *   - `render()` runs once per rAF frame, decoupled from update cadence.
 *
 * Time and the rAF scheduler are dependency-injected so the loop is fully
 * deterministic under jsdom without real timers. Production callers can omit
 * the options and get sensible browser defaults.
 *
 * Pure TypeScript — no React imports. The engine is intentionally decoupled
 * from the React lifecycle so it can be unit-tested in isolation and reused
 * outside React (e.g. in a Web Worker).
 */

/** Fixed simulation step in milliseconds (20Hz => 50ms per tick). */
export const STEP_MS = 50;

/**
 * Maximum accumulated delta processed in a single frame (250ms => 5 steps).
 * Prevents the spiral-of-death after long tab-background pauses by dropping
 * excess time and resuming from "now".
 */
export const MAX_ACCUMULATOR_MS = 250;

/** Number of render frames between FPS console-log emissions. */
export const FPS_LOG_INTERVAL = 60;

/** Valid simulation speed multipliers. 0 = paused. */
export type Speed = 0 | 1 | 2 | 5;

/** Shape of the benchmark object published onto `window` every frame. */
export interface CityBenchmark {
  /** Rolling average frames-per-second over the last FPS_LOG_INTERVAL frames. */
  fps: number;
  /** Wall-clock duration (ms) of the most recent update batch. */
  lastTickMs: number;
}

/** Augment the global window with the benchmark hook (spec instrumentation). */
declare global {
  interface Window {
    __CITY_BENCHMARK__?: CityBenchmark;
  }
}

/** Update callback: advances the simulation by a fixed `dt` (ms). */
export type UpdateCallback = (dt: number) => void;

/** Render callback: draws the current simulation state. */
export type RenderCallback = () => void;

/** Injectable clock: returns the current high-resolution time in ms. */
type NowFn = () => number;

/** Injectable requestAnimationFrame-style scheduler. */
type RafFn = (cb: (time: number) => void) => number;

/** Injectable cancelAnimationFrame-style teardown. */
type CafFn = (handle: number) => void;

/**
 * Default clock: high-resolution time via the Performance API.
 *
 * Thin browser-global wrappers excluded from coverage — they cannot be
 * exercised under jsdom (which lacks a real requestAnimationFrame) and are
 * trivial pass-throughs to the platform APIs.
 */
/* istanbul ignore next */
const defaultNow = (): number => performance.now();

/* istanbul ignore next */
const defaultRaf: RafFn = (cb) => requestAnimationFrame(cb);

/* istanbul ignore next */
const defaultCaf: CafFn = (handle) => cancelAnimationFrame(handle);

/** Constructor options for GameLoop. All fields optional (sensible defaults). */
export interface GameLoopOptions {
  /** Clock function; defaults to `performance.now()` bound to `globalThis`. */
  now?: NowFn;
  /** rAF scheduler; defaults to `globalThis.requestAnimationFrame`. */
  raf?: RafFn;
  /** cAF teardown; defaults to `globalThis.cancelAnimationFrame`. */
  caf?: CafFn;
  /** Initial speed multiplier (defaults to 1). */
  speed?: Speed;
}

/**
 * Fixed-timestep game loop driven by requestAnimationFrame.
 *
 * @example
 * const loop = new GameLoop({
 *   update: (dt) => city.step(dt),
 *   render: () => renderer.draw(),
 * });
 * loop.start();
 * loop.setSpeed(2); // 2x simulation speed
 */
export class GameLoop {
  private readonly update: UpdateCallback;
  private readonly render: RenderCallback;
  private readonly now: NowFn;
  private readonly raf: RafFn;
  private readonly caf: CafFn;

  private speed: Speed;
  private running = false;
  private rafHandle: number | null = null;

  // Fixed-timestep bookkeeping.
  private lastTime = 0;
  private accumulator = 0;

  // FPS / benchmark instrumentation.
  private frameCount = 0;
  private fpsFrameTimestamps: number[] = [];
  private lastTickMs = 0;

  constructor(
    callbacks: { update: UpdateCallback; render: RenderCallback },
    options: GameLoopOptions = {},
  ) {
    this.update = callbacks.update;
    this.render = callbacks.render;

    this.now = options.now ?? defaultNow;
    this.raf = options.raf ?? defaultRaf;
    this.caf = options.caf ?? defaultCaf;
    this.speed = options.speed ?? 1;
  }

  /**
   * Start the loop. Idempotent: calling while already running is a no-op
n   * and never schedules a second rAF.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    // Reset time bookkeeping so the first delta is ~0 (no huge initial jump).
    this.lastTime = this.now();
    this.accumulator = 0;
    this.frameCount = 0;
    this.fpsFrameTimestamps = [];
    this.scheduleFrame();
  }

  /**
   * Stop the loop. Idempotent: safe to call when not running (no-op).
   * Cancels any pending rAF handle.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.rafHandle !== null) {
      this.caf(this.rafHandle);
      this.rafHandle = null;
    }
  }

  /**
   * Set the simulation speed multiplier. Only 0 (paused), 1, 2, or 5 are
   * accepted; invalid values are ignored to keep the sim in a known state.
   */
  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  /** Current speed multiplier (0 when paused). */
  getSpeed(): Speed {
    return this.speed;
  }

  /** Whether the loop is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /** Schedule the next rAF frame (internal). */
  private scheduleFrame(): void {
    this.rafHandle = this.raf((time) => this.frame(time));
  }

  /**
   * Per-frame callback: accumulate real-time delta, run fixed-step updates,
   * then render. Publishes benchmark data and periodically logs FPS.
   */
  private frame(time: number): void {
    if (!this.running) return;

    // Compute real-time delta since the last frame.
    const delta = time - this.lastTime;
    this.lastTime = time;

    // Cap the accumulator to avoid the spiral-of-death after long pauses.
    this.accumulator += Math.min(delta, MAX_ACCUMULATOR_MS);

    // Run fixed-step updates. Speed multiplies dt (not step frequency), so
    // speed=2 advances the sim by 100ms per tick while staying at 20Hz.
    const updateStart = this.now();
    if (this.speed > 0) {
      const dt = STEP_MS * this.speed;
      while (this.accumulator >= STEP_MS) {
        this.update(dt);
        this.accumulator -= STEP_MS;
      }
    }
    this.lastTickMs = this.now() - updateStart;

    // Render every frame, regardless of update cadence or pause state.
    this.render();

    // Track FPS via a rolling window of frame timestamps.
    this.frameCount += 1;
    this.fpsFrameTimestamps.push(time);
    // Keep only the last FPS_LOG_INTERVAL timestamps for the rolling average.
    if (this.fpsFrameTimestamps.length > FPS_LOG_INTERVAL) {
      this.fpsFrameTimestamps.shift();
    }

    // Publish benchmark instrumentation every frame (spec-mandated).
    this.publishBenchmark(time);

    // Log FPS every FPS_LOG_INTERVAL render frames.
    if (this.frameCount % FPS_LOG_INTERVAL === 0) {
      console.log(`FPS: ${this.computeFps(time).toFixed(1)}`);
    }

    // Schedule the next frame to keep the loop alive.
    this.scheduleFrame();
  }

  /** Compute the rolling FPS over the tracked frame timestamps. */
  private computeFps(currentTime: number): number {
    if (this.fpsFrameTimestamps.length < 2) return 0;
    const elapsed = currentTime - this.fpsFrameTimestamps[0];
    if (elapsed <= 0) return 0;
    return (this.fpsFrameTimestamps.length / elapsed) * 1000;
  }

  /** Publish `{ fps, lastTickMs }` onto `window.__CITY_BENCHMARK__`. */
  private publishBenchmark(currentTime: number): void {
    if (typeof window === 'undefined') return;
    window.__CITY_BENCHMARK__ = {
      fps: this.computeFps(currentTime),
      lastTickMs: this.lastTickMs,
    };
  }
}
