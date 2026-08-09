/**
 * Vite entry point: wires the game state, arrow-key input, and canvas
 * renderer together, then runs the main loop.
 *
 * The loop is driven by `requestAnimationFrame`. Each frame advances an
 * accumulator by the elapsed time; while the accumulator holds at least one
 * `tickMs` interval, the state advances one gravity `tick` (subtracting the
 * interval), and the canvas is re-rendered on every frame.
 */
import { mapKeyToAction } from './input/keyboard';
import { createInitialState, step } from './game/state';
import { draw, getCanvasSize } from './render/draw';
import type { RNG } from './game/types';
import type { RenderConfig } from './render/draw';

/** 10x20 board, 30px cells, one gravity tick every 500ms. */
const CONFIG: RenderConfig = { width: 10, height: 20, cell: 30, tickMs: 500 };

/**
 * Mulberry32 — a tiny deterministic seeded RNG returning values in [0, 1).
 * A fixed seed keeps the piece sequence identical across page loads.
 */
function createRng(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrap(): void {
  const canvas = document.getElementById('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Missing <canvas id="canvas"> element');
  }

  const size = getCanvasSize(CONFIG);
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('2D canvas context is unavailable');
  }
  const ctx: CanvasRenderingContext2D = context;

  const rng = createRng(0x7e57);

  let state = createInitialState(CONFIG, rng);

  // Single keydown listener: only reacts when the key maps to a known
  // action. Arrow keys also stop the page from scrolling.
  window.addEventListener('keydown', (event) => {
    const action = mapKeyToAction(event.key);
    if (action === null) return;
    event.preventDefault();
    state = step(state, action, rng);
  });

  let accumulator = 0;
  let lastTime = performance.now();

  function frame(now: number): void {
    // Clamp huge gaps (e.g. after a background tab) so the accumulator
    // cannot cascade through dozens of ticks at once.
    accumulator += Math.min(now - lastTime, 250);
    lastTime = now;

    while (accumulator >= CONFIG.tickMs) {
      state = step(state, { type: 'tick' }, rng);
      accumulator -= CONFIG.tickMs;
    }

    draw(ctx, state, CONFIG);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

bootstrap();