/**
 * GameLoop — fixed-timestep simulation scheduler decoupled from rendering.
 *
 * Architecture: classic accumulator pattern (Glenn Fiedler's "Fix Your Timestep").
 *
 * - Simulation updates at a fixed 50ms step (20 Hz) regardless of render rate.
 * - Rendering fires once per requestAnimationFrame frame with an interpolation
 *   alpha in [0..1] representing how far between the previous and next sim step
 *   the current frame falls.
 * - Speed multiplier scales how fast simulation time accumulates relative to
 *   real time, while every individual update still processes exactly 50ms —
 *   preserving determinism.
 * - maxFrameDelta clamp (250ms default) bounds the number of updates per frame
 *   to prevent the spiral-of-death when frames are slow.
 * - pause() freezes simulation updates while render continues (so the camera
 *   and UI remain interactive); resume() resets the time baseline to avoid a
 *   time-jump flood into the accumulator.
 *
 * The class has NO knowledge of game systems — it is a pure timing scheduler
 * that invokes caller-supplied `update` and `render` callbacks. It does NOT
 * import from types.ts, avoiding any circular dependency.
 */

/** Callback invoked once per fixed simulation step (always 50ms of sim time). */
export type UpdateCallback = (deltaMs: number) => void;

/** Callback invoked once per animation frame with interpolation alpha [0..1]. */
export type RenderCallback = (alpha: number) => void;

/** Fixed simulation step in milliseconds (20 Hz). */
export const SIMULATION_STEP = 50;

/** Default clamp for a single frame delta, preventing spiral-of-death. */
export const DEFAULT_MAX_FRAME_DELTA = 250;

export interface GameLoopOptions {
  /** Called for each fixed simulation step. */
  update: UpdateCallback;
  /** Called once per animation frame with interpolation alpha. */
  render: RenderCallback;
  /** Maximum processed frame delta in ms (default 250). */
  maxFrameDelta?: number;
}

export class GameLoop {
  private readonly update: UpdateCallback;
  private readonly render: RenderCallback;
  private readonly maxFrameDelta: number;

  /** Accumulated unsimulated time (in ms, already scaled by speed). */
  private accumulator = 0;

  /** Timestamp (ms) of the previous frame, used to compute frame delta. */
  private lastTime = 0;

  /** Current rAF handle so we can cancel on stop(). */
  private rafId: number | null = null;

  /** Whether the loop is actively scheduling frames. */
  private running = false;

  /** Whether simulation updates are suspended (render continues). */
  private paused = false;

  /** Simulation speed multiplier (1.0 = real time). */
  private speed = 1;

  // --- FPS counter (1-second sliding window) ---
  private frameCount = 0;
  private fpsWindowStart = 0;
  private currentFps = 0;

  constructor(options: GameLoopOptions) {
    this.update = options.update;
    this.render = options.render;
    this.maxFrameDelta = options.maxFrameDelta ?? DEFAULT_MAX_FRAME_DELTA;
  }

  /** Begin the animation frame loop. Idempotent — safe to call twice. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.accumulator = 0;
    this.frameCount = 0;
    this.currentFps = 0;
    this.lastTime = performance.now();
    this.fpsWindowStart = this.lastTime;
    this.scheduleFrame();
  }

  /** Cancel the animation frame loop and reset transient state. */
  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** Suspend simulation updates; render continues so the UI stays responsive. */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume simulation updates. Resets the time baseline to the current moment
   * so the paused interval does not flood the accumulator.
   */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastTime = performance.now();
  }

  /**
   * Set the simulation speed multiplier. Applied to the frame delta before it
   * enters the accumulator, so each update still processes exactly 50ms.
   */
  setSpeed(multiplier: number): void {
    this.speed = multiplier;
  }

  /** Current simulation speed multiplier. */
  getSpeed(): number {
    return this.speed;
  }

  /** Latest computed frames-per-second (updated once per second). */
  getFps(): number {
    return this.currentFps;
  }

  /** Whether the loop is actively scheduling frames. */
  isRunning(): boolean {
    return this.running;
  }

  /** Whether simulation updates are currently suspended. */
  isPaused(): boolean {
    return this.paused;
  }

  // ------------------------------------------------------------------

  private scheduleFrame(): void {
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Bound rAF callback. */
  private tick = (now: number): void => {
    if (!this.running) return;

    // Compute and clamp the frame delta to avoid spiral-of-death.
    let frameDelta = now - this.lastTime;
    this.lastTime = now;
    if (frameDelta > this.maxFrameDelta) {
      frameDelta = this.maxFrameDelta;
    }
    if (frameDelta < 0) {
      frameDelta = 0;
    }

    // Advance simulation only when not paused. Speed scales accumulation.
    if (!this.paused) {
      this.accumulator += frameDelta * this.speed;
      // Fixed-step updates. Bounded by maxFrameDelta / SIMULATION_STEP.
      while (this.accumulator >= SIMULATION_STEP) {
        this.update(SIMULATION_STEP);
        this.accumulator -= SIMULATION_STEP;
      }
    }

    // Interpolation alpha: how far between the last and next sim step.
    const alpha = this.paused ? 0 : this.accumulator / SIMULATION_STEP;
    this.render(alpha);

    // FPS counter over a 1-second window.
    this.frameCount++;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / elapsed);
      console.log(`FPS: ${this.currentFps}`);
      this.frameCount = 0;
      this.fpsWindowStart = now;
    }

    this.scheduleFrame();
  };
}
