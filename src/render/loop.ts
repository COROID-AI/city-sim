/**
 * Fixed-step game loop using `requestAnimationFrame`.
 *
 * The loop decouples simulation ticks from rendering:
 *   - **Update** runs on a fixed timestep (accumulator pattern) so the
 *     simulation is deterministic regardless of display refresh rate.
 *   - **Render** runs once per animation frame, interpolating between
 *     the last two sim states for smooth visuals.
 *
 * Usage:
 * ```ts
 * startLoop({ update, render });
 * ```
 */

/** Parameters passed to {@link startLoop}. */
export interface LoopOptions {
  /**
   * Called once per fixed simulation step.
   *
   * @param dt Fixed delta in milliseconds since the last step.
   */
  update: (dt: number) => void;

  /** Called once per animation frame for rendering. */
  render: () => void;

  /** Fixed timestep in milliseconds (default 16.67 ≈ 60 Hz). */
  fixedStepMs?: number;

  /** Maximum number of steps per frame to avoid the "spiral of death". */
  maxStepsPerFrame?: number;
}

/** Default fixed step (~60 updates per second). */
const DEFAULT_FIXED_STEP_MS = 1000 / 60;

/** Safety cap to prevent runaway catch-up if the tab was backgrounded. */
const DEFAULT_MAX_STEPS_PER_FRAME = 5;

/**
 * Start a fixed-step game loop.
 *
 * @returns A `stop()` function that cancels the animation frame.
 */
export function startLoop(options: LoopOptions): () => void {
  const {
    update,
    render,
    fixedStepMs = DEFAULT_FIXED_STEP_MS,
    maxStepsPerFrame = DEFAULT_MAX_STEPS_PER_FRAME,
  } = options;

  let rafId = 0;
  let lastTime = 0;
  let accumulator = 0;
  let running = true;
  let started = false;

  const frame = (now: number): void => {
    if (!running) return;

    if (!started) {
      // First frame: seed timestamp without a giant delta.
      lastTime = now;
      started = true;
    }

    const frameDelta = now - lastTime;
    lastTime = now;

    accumulator += frameDelta;

    let steps = 0;
    while (accumulator >= fixedStepMs && steps < maxStepsPerFrame) {
      update(fixedStepMs);
      accumulator -= fixedStepMs;
      steps++;
    }

    // If we exceeded the step cap, discard the backlog to avoid spiralling.
    if (accumulator > fixedStepMs * maxStepsPerFrame) {
      accumulator = 0;
    }

    render();

    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
  };
}
