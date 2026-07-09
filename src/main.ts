/**
 * Browser entry point for the Tetris game.
 *
 * Responsibilities:
 *   - Bootstrap the canvas and its 2D rendering context.
 *   - Maintain the game state (immutable snapshots via the state reducer).
 *   - Attach **exactly one** `keydown` listener and route every key through
 *     {@link mapKeyToAction} — the sole input surface. There are **no** keyup,
 *     mousedown, touchstart, or pointer listeners anywhere in this module.
 *   - Run the main loop via `requestAnimationFrame`, applying periodic gravity
 *     ticks (whose speed depends on the level) and rendering each frame.
 *
 * Player input is intentionally limited to the four arrow keys, honouring the
 * "only using arrow keys to turn the blocks" contract.
 */

import { createInitialState, step, DEFAULT_CONFIG } from './game/state';
import { mapKeyToAction } from './input/keyboard';
import { draw, DEFAULT_DRAW_CONFIG } from './render/draw';

const CANVAS_ID = 'tetris-canvas';

/**
 * Compute the gravity interval (ms per drop step) for the current level.
 *
 * Higher levels drop the piece faster. The interval is clamped to a minimum of
 * 50 ms so the game never becomes unplayably fast.
 *
 * @param level  Current game level (1-based).
 * @returns      Milliseconds between automatic gravity ticks.
 */
function dropIntervalMs(level: number): number {
  return Math.max(50, DEFAULT_CONFIG.baseDropIntervalMs / level);
}

/**
 * Start the game: wire up input and kick off the render loop.
 *
 * @throws if the canvas element or 2D context cannot be obtained.
 */
function main(): void {
  const canvas = document.getElementById(
    CANVAS_ID,
  ) as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error(`Canvas element with id "${CANVAS_ID}" was not found.`);
  }

  const rawContext = canvas.getContext('2d');
  if (!rawContext) {
    throw new Error('2D canvas context is unavailable in this browser.');
  }
  // Bind the narrowed, non-null context so TypeScript keeps the type inside the
  // nested `frame` closure (closure capture does not preserve flow narrowing on
  // the original binding).
  const context: CanvasRenderingContext2D = rawContext;

  let state = createInitialState();

  // ── Input ──────────────────────────────────────────────────────────────
  // Exactly ONE keydown listener. Every keypress is routed through
  // mapKeyToAction; non-arrow keys produce `null` and are silently ignored.
  // Arrow keys are preventDefault-ed so they don't scroll the page.
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    const action = mapKeyToAction(event);
    if (action !== null) {
      event.preventDefault();
      state = step(state, action);
    }
  });

  // Paint the very first frame synchronously so the canvas never appears
  // blank, even before the first `requestAnimationFrame` callback fires. This
  // keeps automated smoke checks (which may snapshot immediately after load)
  // from capturing an empty, transparent canvas.
  draw(context, state, DEFAULT_DRAW_CONFIG);

  // ── Main loop ──────────────────────────────────────────────────────────
  let lastTime = performance.now();
  let accumulator = 0;

  function frame(now: number): void {
    const elapsed = now - lastTime;
    lastTime = now;
    accumulator += elapsed;

    // Apply zero or more gravity ticks depending on how much time passed.
    const interval = dropIntervalMs(state.level);
    while (accumulator >= interval) {
      accumulator -= interval;
      state = step(state, { type: 'tick' });
    }

    // Render the current state.
    draw(context, state, DEFAULT_DRAW_CONFIG);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main();
