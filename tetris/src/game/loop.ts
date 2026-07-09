/**
 * Fixed-timestep game loop helper.
 *
 * Isolated from game rules. Uses requestAnimationFrame, accumulates the frame
 * delta, and invokes `tick(dt)` at a fixed rate. `render()` is called every
 * animation frame so visuals stay smooth.
 */

export interface LoopCallbacks {
  /** Advance the simulation by `dt` milliseconds (clamped). */
  tick: (dt: number) => void;
  /** Draw the current state — called once per animation frame. */
  render: () => void;
  /** Optional target simulation rate in frames-per-second (default 60). */
  fps?: number;
}

export interface LoopController {
  /** Stop the animation frame loop. */
  stop: () => void;
}

/** Maximum accumulated delta (ms) per frame to prevent teleport after tab-switch. */
const MAX_DELTA = 250;

/**
 * Start a fixed-timestep loop. Returns a controller with a `stop()` method.
 */
export function startLoop({
  tick,
  render,
  fps = 60,
}: LoopCallbacks): LoopController {
  const fixedStep = 1000 / fps;
  let lastTime = performance.now();
  let accumulator = 0;
  let frameId = 0;
  let running = true;

  function frame(now: number): void {
    if (!running) return;

    let dt = now - lastTime;
    lastTime = now;

    // Clamp to avoid huge jumps after the tab was inactive.
    if (dt > MAX_DELTA) dt = MAX_DELTA;

    accumulator += dt;
    while (accumulator >= fixedStep) {
      tick(fixedStep);
      accumulator -= fixedStep;
    }

    render();

    frameId = requestAnimationFrame(frame);
  }

  frameId = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(frameId);
    },
  };
}
