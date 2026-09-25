/**
 * Fixed-step render loop for Chrono City.
 *
 * The simulation advances in deterministic increments (60 Hz by default) while
 * rendering happens once per animation frame, so scene behaviour is stable
 * regardless of display refresh rate or frame stalls. Wall-clock deltas are
 * clamped and the number of catch-up steps per frame is bounded, so a slow or
 * backgrounded tab can never trigger a spiral of death.
 *
 * The module is intentionally free of DOM and WebGL dependencies: `tick()`
 * consumes explicit timestamps, which keeps it unit-testable and lets later
 * systems (timelapse playback, camera easing, audio scheduling) share the same
 * clock.
 */

/** Default simulation step: 60 updates per simulated second. */
export const DEFAULT_FIXED_STEP = 1 / 60;

/** Largest wall-clock delta, in seconds, that a single frame may contribute. */
export const DEFAULT_MAX_DELTA = 0.1;

/**
 * Lower bound for the catch-up steps executed within one frame.
 *
 * The effective bound is derived from `maxDelta` (see
 * {@link FixedStepLoop.maxSubSteps}) so that a fully clamped frame is always
 * simulated completely; this constant is the floor for that derivation.
 */
export const DEFAULT_MAX_SUB_STEPS = 6;

/**
 * Snapshot of the loop's progress for a single frame.
 *
 * The object is reused between frames (and mutated once per fixed step while a
 * frame is processed), so consumers must copy any value they retain.
 */
export interface FrameInfo {
  /** 1-based index of the frame being processed. */
  frame: number;
  /** Clamped wall-clock seconds since the previous tick (0 on the first tick). */
  delta: number;
  /** Total simulated seconds advanced by fixed steps so far. */
  elapsed: number;
  /** Fixed steps executed during this frame. */
  steps: number;
  /** Interpolation factor in [0, 1) between the last two fixed steps. */
  alpha: number;
}

export interface LoopHooks {
  /** Advances the simulation by exactly `delta` seconds. */
  update(delta: number, frame: FrameInfo): void;
  /** Draws the current simulation state; called exactly once per tick. */
  render(frame: FrameInfo): void;
}

export interface FixedStepLoopOptions {
  /** Simulation and render hooks driven by the loop. */
  hooks: LoopHooks;
  /** Seconds per simulation step. Defaults to {@link DEFAULT_FIXED_STEP}. */
  fixedStep?: number;
  /** Maximum wall-clock delta accepted per frame, in seconds. */
  maxDelta?: number;
  /** Maximum catch-up steps per frame. */
  maxSubSteps?: number;
  /** Scheduler used by {@link FixedStepLoop.start}; injectable for tests. */
  requestFrame?: (callback: (timeMs: number) => void) => number;
  /** Cancels a handle returned by `requestFrame`. */
  cancelFrame?: (handle: number) => void;
}

/**
 * Clamps a raw frame delta into `[0, maxDelta]`.
 *
 * Non-finite and negative deltas (clock changes, first frame) collapse to zero
 * so the accumulator can never run backwards or be poisoned by `NaN`.
 */
export function clampDelta(delta: number, maxDelta: number = DEFAULT_MAX_DELTA): number {
  const limit = Number.isFinite(maxDelta) && maxDelta > 0 ? maxDelta : DEFAULT_MAX_DELTA;
  if (!Number.isFinite(delta) || delta <= 0) {
    return 0;
  }
  return delta < limit ? delta : limit;
}

/**
 * Fixed-step loop driven by the animation-frame clock.
 *
 * `tick()` is public and timestamp-driven so tests and tooling can advance the
 * loop deterministically without a browser, while `start()`/`stop()` own the
 * `requestAnimationFrame` scheduling.
 */
export class FixedStepLoop {
  /** Seconds per simulation step. */
  readonly fixedStep: number;
  /** Maximum wall-clock delta accepted per frame, in seconds. */
  readonly maxDelta: number;
  /** Maximum catch-up steps per frame. */
  readonly maxSubSteps: number;

  private readonly hooks: LoopHooks;
  private readonly requestFrame: (callback: (timeMs: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly frameInfo: FrameInfo = { frame: 0, delta: 0, elapsed: 0, steps: 0, alpha: 0 };

  private active = false;
  private frameHandle: number | null = null;
  private lastTimestamp: number | null = null;
  private accumulator = 0;
  private simulatedTime = 0;
  private frames = 0;

  constructor(options: FixedStepLoopOptions) {
    this.hooks = options.hooks;
    this.fixedStep = positiveOr(options.fixedStep, DEFAULT_FIXED_STEP);
    this.maxDelta = positiveOr(options.maxDelta, DEFAULT_MAX_DELTA);
    this.maxSubSteps = resolveMaxSubSteps(options.maxSubSteps, this.maxDelta, this.fixedStep);
    this.requestFrame = options.requestFrame ?? defaultRequestFrame;
    this.cancelFrame = options.cancelFrame ?? defaultCancelFrame;
  }

  /** True while the loop is scheduled against the animation-frame clock. */
  get running(): boolean {
    return this.active;
  }

  /** Total simulated seconds advanced by fixed steps. */
  get simulationTime(): number {
    return this.simulatedTime;
  }

  /** Number of ticks processed since construction or {@link reset}. */
  get frameCount(): number {
    return this.frames;
  }

  /** Pending interpolation factor in `[0, 1)`, useful for smoothed visuals. */
  get interpolation(): number {
    return this.frames === 0 ? 0 : this.accumulator / this.fixedStep;
  }

  /**
   * Processes one frame at `timestampSeconds` and returns its {@link FrameInfo}.
   *
   * The first tick only anchors the clock (zero delta, zero steps) and still
   * renders, which gives the app an immediate first paint while loading UI is
   * still visible.
   */
  tick(timestampSeconds: number): FrameInfo {
    const previous = this.lastTimestamp;
    this.lastTimestamp = timestampSeconds;

    const delta = clampDelta(previous === null ? 0 : timestampSeconds - previous, this.maxDelta);
    this.accumulator += delta;

    let steps = 0;
    while (this.accumulator >= this.fixedStep && steps < this.maxSubSteps) {
      this.accumulator -= this.fixedStep;
      this.simulatedTime += this.fixedStep;
      steps += 1;
      this.hooks.update(this.fixedStep, this.writeInfo(this.frames + 1, this.fixedStep, steps, 0));
    }

    // Only reachable when the frame was longer than `maxSubSteps * fixedStep`:
    // shed the surplus instead of letting the backlog grow frame over frame.
    if (this.accumulator >= this.fixedStep) {
      this.accumulator %= this.fixedStep;
    }

    this.frames += 1;
    const info = this.writeInfo(this.frames, delta, steps, this.accumulator / this.fixedStep);
    this.hooks.render(info);
    return info;
  }

  /** Starts driving ticks from the animation-frame clock. No-op when running. */
  start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.lastTimestamp = null;
    this.frameHandle = this.requestFrame(this.handleFrame);
  }

  /** Stops the loop and cancels any pending frame. No-op when stopped. */
  stop(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    if (this.frameHandle !== null) {
      this.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  /** Clears accumulated time so the next tick starts a fresh timeline. */
  reset(): void {
    this.lastTimestamp = null;
    this.accumulator = 0;
    this.simulatedTime = 0;
    this.frames = 0;
  }

  private readonly handleFrame = (timeMs: number): void => {
    if (!this.active) {
      return;
    }
    this.frameHandle = null;
    this.tick(timeMs / 1000);
    if (this.active) {
      this.frameHandle = this.requestFrame(this.handleFrame);
    }
  };

  private writeInfo(frame: number, delta: number, steps: number, alpha: number): FrameInfo {
    this.frameInfo.frame = frame;
    this.frameInfo.delta = delta;
    this.frameInfo.elapsed = this.simulatedTime;
    this.frameInfo.steps = steps;
    this.frameInfo.alpha = alpha;
    return this.frameInfo;
  }
}

/**
 * Resolves the per-frame catch-up bound.
 *
 * An explicit `maxSubSteps` wins; otherwise the bound is derived from
 * `maxDelta` and `fixedStep`, so the worst frame the loop accepts is still
 * simulated in full instead of quietly dropping simulated time.
 */
function resolveMaxSubSteps(
  requested: number | undefined,
  maxDelta: number,
  fixedStep: number,
): number {
  if (typeof requested === "number" && Number.isFinite(requested) && requested >= 1) {
    return Math.max(1, Math.floor(requested));
  }
  return Math.max(DEFAULT_MAX_SUB_STEPS, Math.ceil(maxDelta / fixedStep));
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function defaultRequestFrame(callback: (timeMs: number) => void): number {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return Number(setTimeout(() => callback(Date.now()), 16));
}

function defaultCancelFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}
