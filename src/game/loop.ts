/**
 * Fixed-timestep game loop.
 *
 * `startLoop` drives the game with `requestAnimationFrame` while advancing
 * gravity on a fixed interval that decreases as the level rises. It drains an
 * action queue between gravity ticks, so player input is always applied before
 * the next automatic drop. The loop is fully pure with respect to state: it
 * calls `applyAction` to produce the next immutable state.
 */

import { applyAction, type Action, type GameState } from "./state.js";

/** Returns the gravity interval (ms) for a given level. */
export function gravityInterval(level: number): number {
  // Speed ramps up with level but never gets faster than 100 ms.
  return Math.max(100, 1000 - (level - 1) * 100);
}

/** Options accepted by `startLoop`. */
export interface LoopOptions {
  /** Called every animation frame with the current state (usually to render). */
  readonly onFrame: (state: GameState) => void;
  /** Optional custom clock, mainly for testing. Defaults to the performance clock. */
  readonly now?: () => number;
  /** Optional rAF shim, mainly for testing. */
  readonly requestAnimationFrame?: (cb: (t: number) => void) => number;
  /** Optional rAF cancellation shim, mainly for testing. */
  readonly cancelAnimationFrame?: (id: number) => void;
}

/**
 * Starts the game loop. Returns a `stop` function.
 *
 * Each animation frame:
 *  1. Accumulates elapsed time and emits `Tick` (gravity) actions on the
 *     level-based interval.
 *  2. Drains all queued player actions in order.
 *  3. Renders the latest state via `onFrame`.
 *
 * When the game is over, gravity and queued actions are ignored so the final
 * board and overlay remain visible and stable.
 */
export function startLoop(
  initialState: GameState,
  queue: Action[],
  options: LoopOptions
): () => void {
  const raf =
    options.requestAnimationFrame ??
    ((cb: (t: number) => void) => requestAnimationFrame(cb));
  const cancel =
    options.cancelAnimationFrame ??
    ((id: number) => cancelAnimationFrame(id));
  const now = options.now ?? (() => performance.now());

  let state: GameState = initialState;
  let lastTime = now();
  let accumulator = 0;
  let rafId = 0;
  let running = true;

  const frame = (): void => {
    if (!running) {
      return;
    }

    const currentTime = now();
    const delta = currentTime - lastTime;
    lastTime = currentTime;

    if (!state.gameOver) {
      accumulator += delta;
      const interval = gravityInterval(state.level);

      // Emit as many gravity ticks as fit in the accumulated time (catches up
      // after the tab was backgrounded). Cap at a sane number to avoid spirals.
      let ticks = 0;
      while (accumulator >= interval && ticks < 5 && !state.gameOver) {
        state = applyAction(state, { type: "Tick" });
        accumulator -= interval;
        ticks += 1;
      }
      if (state.gameOver) {
        accumulator = 0;
      }

      // Drain queued player actions in order.
      while (queue.length > 0 && !state.gameOver) {
        const action = queue.shift() as Action;
        state = applyAction(state, action);
      }
    }

    options.onFrame(state);

    if (running) {
      rafId = raf(frame);
    }
  };

  rafId = raf(frame);

  return () => {
    running = false;
    cancel(rafId);
  };
}
