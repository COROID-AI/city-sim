/** Fixed simulation tick rate in Hertz. */
export const TICK_HZ = 20;
/** Seconds per fixed step. */
export const FIXED_DT = 1 / TICK_HZ;
/** Cap on consumed real-time delta per animation frame. */
export const MAX_FRAME_DT = 0.25;
/** Cap on the number of fixed steps drained per animation frame. */
export const DEFAULT_MAX_STEPS_PER_FRAME = 5;

export type LoopPhase = 'idle' | 'running' | 'paused' | 'stopped';

export interface GameLoopOptions {
  /** Override the default fixed step in seconds. */
  fixedDt?: number;
  /** Override the default max steps per frame. */
  maxStepsPerFrame?: number;
  /**
   * If true, the loop will still call `requestAnimationFrame` even when the
   * tab is hidden. Defaults to false (saves CPU when backgrounded).
   */
  runWhenHidden?: boolean;
}

export type FixedStepCallback = (fixedDt: number) => void;
export type FrameCallback = (realDt: number, accumulated: number) => void;

/**
 * Minimal rAF handle that works in any environment. On the server
 * (no `window.requestAnimationFrame`) the noop variant is returned so
 * importing this module is safe during Next.js static export.
 */
export type RafHandle = {
  readonly cancel: () => void;
};

interface RafApi {
  request(callback: (nowMs: number) => void): RafHandle;
  now(): number;
}

const browserRaf: RafApi = (() => {
  if (typeof globalThis === 'undefined') {
    return {
      request: () => ({ cancel: () => undefined }),
      now: () => 0,
    };
  }
  const g = globalThis as {
    requestAnimationFrame?: (cb: (now: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
    performance?: { now(): number };
  };
  if (typeof g.requestAnimationFrame !== 'function') {
    return {
      request: () => ({ cancel: () => undefined }),
      now: () => 0,
    };
  }
  return {
    request: (cb) => {
      const id = g.requestAnimationFrame!(cb);
      return {
        cancel: () => {
          if (typeof g.cancelAnimationFrame === 'function') {
            g.cancelAnimationFrame(id);
          }
        },
      };
    },
    now: () => (g.performance ? g.performance.now() : Date.now()),
  };
})();

/**
 * Fixed-timestep game loop. Drives both per-tick simulation updates (at a
 * stable, frame-rate-independent cadence) and per-frame rendering callbacks.
 *
 * Design notes:
 *  - `requestAnimationFrame` is only touched inside `start()`, so SSR
 *    imports of this module are safe.
 *  - `dt` is capped to `MAX_FRAME_DT` to avoid the "spiral of death" that
 *    occurs when a backgrounded tab resumes with a multi-second gap.
 *  - At most `maxStepsPerFrame` fixed steps are drained per frame; leftover
 *    time is carried into the next frame.
 */
export class GameLoop {
  readonly fixedDt: number;
  readonly maxStepsPerFrame: number;
  readonly runWhenHidden: boolean;

  private readonly raf: RafApi;
  private accumulator = 0;
  private lastFrameTime = 0;
  private currentHandle: RafHandle | null = null;
  private phase: LoopPhase = 'idle';
  private totalTicks = 0;

  private onFixedStep: FixedStepCallback | null = null;
  private onFrame: FrameCallback | null = null;

  constructor(options: GameLoopOptions = {}, raf: RafApi = browserRaf) {
    const fixedDt = options.fixedDt ?? FIXED_DT;
    if (!(fixedDt > 0)) throw new RangeError('fixedDt must be > 0');
    this.fixedDt = fixedDt;
    const maxSteps = options.maxStepsPerFrame ?? DEFAULT_MAX_STEPS_PER_FRAME;
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new RangeError('maxStepsPerFrame must be a positive integer');
    }
    this.maxStepsPerFrame = maxSteps;
    this.runWhenHidden = options.runWhenHidden ?? false;
    this.raf = raf;
  }

  /** Register the per-tick simulation callback. Overwrites any previous one. */
  setFixedStepCallback(cb: FixedStepCallback | null): void {
    this.onFixedStep = cb;
  }

  /** Register the per-frame render callback. Overwrites any previous one. */
  setFrameCallback(cb: FrameCallback | null): void {
    this.onFrame = cb;
  }

  /** Current lifecycle phase. */
  getPhase(): LoopPhase {
    return this.phase;
  }

  /** Total fixed-step ticks executed since the loop started. */
  getTickCount(): number {
    return this.totalTicks;
  }

  /**
   * Begin running. If the loop is already running this is a no-op. If it was
   * paused, the existing accumulator is preserved.
   */
  start(): void {
    if (this.phase === 'running') return;
    this.phase = 'running';
    this.lastFrameTime = this.raf.now();
    this.scheduleNext();
  }

  /**
   * Pause the loop. The animation frame handle is released but accumulator
   * state is preserved so `resume()` continues from where we left off.
   */
  pause(): void {
    if (this.phase !== 'running') return;
    this.phase = 'paused';
    this.cancelFrame();
  }

  /** Resume a previously-paused loop. */
  resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'running';
    this.lastFrameTime = this.raf.now();
    this.scheduleNext();
  }

  /**
   * Fully stop the loop and reset all transient state. The loop can be
   * restarted with `start()`; tick count is reset to 0.
   */
  stop(): void {
    this.cancelFrame();
    this.phase = 'stopped';
    this.accumulator = 0;
    this.totalTicks = 0;
    this.lastFrameTime = 0;
  }

  /**
   * For tests: manually advance the loop by `dt` seconds. Skips the rAF
   * scheduler. No-op when the loop is not running.
   */
  tick(dt: number): void {
    if (this.phase !== 'running') return;
    this.advance(dt);
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  private scheduleNext(): void {
    if (this.phase !== 'running') return;
    this.currentHandle = this.raf.request((now) => this.handleFrame(now));
  }

  private cancelFrame(): void {
    if (this.currentHandle) {
      this.currentHandle.cancel();
      this.currentHandle = null;
    }
  }

  private handleFrame(now: number): void {
    if (this.phase !== 'running') {
      this.currentHandle = null;
      return;
    }
    if (!this.runWhenHidden && typeof document !== 'undefined' && document.hidden) {
      // Skip work while backgrounded but keep the rAF chain alive so we
      // resume immediately on visibility change.
      this.lastFrameTime = now;
      this.scheduleNext();
      return;
    }
    const rawDt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
    this.advance(dt);
    this.scheduleNext();
  }

  private advance(realDt: number): void {
    this.accumulator += realDt;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxStepsPerFrame) {
      this.accumulator -= this.fixedDt;
      steps += 1;
      this.totalTicks += 1;
      if (this.onFixedStep) this.onFixedStep(this.fixedDt);
    }
    // If we hit the step cap, discard the leftover rather than letting it
    // accumulate forever (the canonical "spiral of death" guard).
    if (steps >= this.maxStepsPerFrame && this.accumulator >= this.fixedDt) {
      this.accumulator = 0;
    }
    if (this.onFrame) this.onFrame(realDt, this.accumulator);
  }
}
