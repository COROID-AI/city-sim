/**
 * GameLoop — requestAnimationFrame driver with a fixed simulation step.
 *
 * Why fixed step: downstream systems (time, citizens, events) need
 * deterministic tick intervals so behavior is reproducible. We accumulate
 * wall-clock time and run as many fixed-size simulation steps as fit,
 * bounded to prevent the "spiral of death" when a single step stalls.
 *
 * Conventions:
 *   - All time values are in seconds.
 *   - The default fixed step is 20Hz (50ms), per spec.
 *   - Render happens once per rAF tick, after simulation steps for that tick.
 *   - Callbacks receive the *fixed* dt, not the wall dt, so they're stable.
 */

export interface GameLoopOptions {
  /** Fixed simulation step size in seconds. Default 0.05 (20Hz). */
  fixedStepSeconds?: number;
  /**
   * Maximum wall time the accumulator may hold before being clamped.
   * Prevents spiral-of-death after tab background / heavy GC pauses.
   * Default 0.25s (5 fixed steps worth at 20Hz).
   */
  maxCatchupSeconds?: number;
  /**
   * Maximum number of fixed steps executed per rAF frame. Default 5.
   */
  maxStepsPerFrame?: number;
}

export type StepCallback = (fixedDt: number, stepIndex: number) => void;
export type RenderCallback = (frameDt: number) => void;

const DEFAULT_FIXED_STEP = 0.05; // 20Hz
const DEFAULT_MAX_CATCHUP = 0.25; // 5 ticks
const DEFAULT_MAX_STEPS = 5;

export class GameLoop {
  private readonly fixedStep: number;
  private readonly maxCatchup: number;
  private readonly maxSteps: number;

  private stepCallbacks: StepCallback[] = [];
  private renderCallbacks: RenderCallback[] = [];

  private rafHandle: number | null = null;
  private running = false;
  private accumulator = 0;
  private lastTimestamp = 0;
  private stepCounter = 0;
  /** True until the first tick has been seen; used to seed lastTimestamp. */
  private firstTick = true;

  /** Override hooks for tests. When unset, rAF is resolved lazily from globalThis. */
  private rafOverride: ((cb: FrameRequestCallback) => number) | null = null;
  private cancelRafOverride: ((handle: number) => void) | null = null;

  constructor(options: GameLoopOptions = {}) {
    this.fixedStep = options.fixedStepSeconds ?? DEFAULT_FIXED_STEP;
    this.maxCatchup = options.maxCatchupSeconds ?? DEFAULT_MAX_CATCHUP;
    this.maxSteps = options.maxStepsPerFrame ?? DEFAULT_MAX_STEPS;
  }

  /**
   * Resolve rAF/cancelRaf. Looked up lazily on each start() so that tests
   * can monkey-patch globalThis.requestAnimationFrame before the loop
   * actually schedules a frame. Falls back to a setTimeout-based shim
   * (~60Hz) in non-browser environments.
   */
  private getRaf(): (cb: FrameRequestCallback) => number {
    if (this.rafOverride) return this.rafOverride;
    const g = globalThis as {
      requestAnimationFrame?: (cb: FrameRequestCallback) => number;
    };
    if (typeof g.requestAnimationFrame === 'function') {
      return g.requestAnimationFrame.bind(g);
    }
    return (cb: FrameRequestCallback): number => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    };
  }

  private getCancelRaf(): (handle: number) => void {
    if (this.cancelRafOverride) return this.cancelRafOverride;
    const g = globalThis as {
      cancelAnimationFrame?: (handle: number) => void;
    };
    if (typeof g.cancelAnimationFrame === 'function') {
      return g.cancelAnimationFrame.bind(g);
    }
    return (handle: number): void => {
      clearTimeout(handle);
    };
  }

  /**
   * Test hook: install a custom rAF implementation. Returns the previous
   * value (or null) so tests can restore it. Calling with null restores
   * the default globalThis lookup.
   */
  setRaf(raf: ((cb: FrameRequestCallback) => number) | null): ((cb: FrameRequestCallback) => number) | null {
    const prev = this.rafOverride;
    this.rafOverride = raf;
    return prev;
  }

  setCancelRaf(cancel: ((handle: number) => void) | null): ((handle: number) => void) | null {
    const prev = this.cancelRafOverride;
    this.cancelRafOverride = cancel;
    return prev;
  }

  /** Register a per-fixed-step callback. Returns an unsubscribe function. */
  onStep(cb: StepCallback): () => void {
    this.stepCallbacks.push(cb);
    return (): void => {
      this.stepCallbacks = this.stepCallbacks.filter((x) => x !== cb);
    };
  }

  /** Register a per-frame render callback. Returns an unsubscribe function. */
  onRender(cb: RenderCallback): () => void {
    this.renderCallbacks.push(cb);
    return (): void => {
      this.renderCallbacks = this.renderCallbacks.filter((x) => x !== cb);
    };
  }

  /** Start the loop. No-op if already running. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.accumulator = 0;
    this.lastTimestamp = 0;
    this.firstTick = true;
    this.rafHandle = this.getRaf()(this.tick);
  }

  /** Stop the loop and cancel the pending rAF. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.rafHandle !== null) {
      this.getCancelRaf()(this.rafHandle);
      this.rafHandle = null;
    }
  }

  /** True if the loop is currently driving frames. */
  isRunning(): boolean {
    return this.running;
  }

  /** Configured fixed step in seconds. */
  getFixedStep(): number {
    return this.fixedStep;
  }

  private tick = (timestamp: number): void => {
    if (!this.running) return;

    // Seed lastTimestamp on the first tick so the first frame contributes
    // zero dt (no accumulated time) but subsequent frames measure real dt.
    if (this.firstTick) {
      this.lastTimestamp = timestamp;
      this.firstTick = false;
    }
    const frameDt = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;

    // Bound accumulator to avoid spiral of death after long pauses.
    this.accumulator = Math.min(this.accumulator + Math.max(0, frameDt), this.maxCatchup);

    let stepsThisFrame = 0;
    while (this.accumulator >= this.fixedStep && stepsThisFrame < this.maxSteps) {
      this.accumulator -= this.fixedStep;
      this.stepCounter += 1;
      stepsThisFrame += 1;
      for (const cb of this.stepCallbacks) {
        cb(this.fixedStep, this.stepCounter);
      }
    }

    // If we hit the step cap, discard the rest of the catch-up debt so we
    // don't spend subsequent frames trying to pay it off.
    if (stepsThisFrame >= this.maxSteps) {
      this.accumulator = 0;
    }

    for (const cb of this.renderCallbacks) {
      cb(frameDt);
    }

    this.rafHandle = this.getRaf()(this.tick);
  };
}
