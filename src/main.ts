/**
 * Application entry point.
 *
 * Wires together the game state reducer, the canvas renderer, and the
 * keyboard mapper into a playable Tetris loop:
 *   - grabs the #canvas element, sizes it, and obtains a 2D context;
 *   - creates the initial state with a deterministic seeded rng;
 *   - attaches a single `keydown` listener that dispatches mapped actions;
 *   - runs a `requestAnimationFrame` loop that ticks the state at
 *     `config.tickMs` intervals and renders every frame.
 */
import { createInitialState, step } from './game/state';
import { draw } from './render/draw';
import { mapKeyToAction } from './input/keyboard';
import type { GameConfig, GameState, Rng } from './game/types';

/** Game configuration: 10x20 board, 30px cells, 500ms gravity tick. */
const CONFIG: GameConfig = {
  width: 10,
  height: 20,
  cell: 30,
  tickMs: 500,
};

/** Width in CSS pixels of the side panel (must match draw.ts). */
const PANEL_WIDTH = 160;

/**
 * Deterministic seeded rng (mulberry32). Returns floats in [0, 1) so the
 * game is reproducible across reloads.
 */
function createSeededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canvas = document.getElementById('canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas element #canvas not found');
}
canvas.width = CONFIG.width * CONFIG.cell + PANEL_WIDTH;
canvas.height = CONFIG.height * CONFIG.cell;

const maybeCtx = canvas.getContext('2d');
if (!maybeCtx) {
  throw new Error('2D canvas context unavailable');
}
const ctx: CanvasRenderingContext2D = maybeCtx;

const rng = createSeededRng(0x5eed);
let state: GameState = createInitialState(CONFIG, rng);

// Single keydown listener: dispatch when the key maps to a known action.
window.addEventListener('keydown', (event) => {
  const action = mapKeyToAction(event.key);
  if (action) {
    event.preventDefault();
    state = step(state, action, rng);
  }
});

// Render loop: advance the accumulator, tick at tickMs intervals, render.
let lastTime = performance.now();
let accumulator = 0;

function frame(time: number): void {
  const delta = Math.min(time - lastTime, 250);
  lastTime = time;
  accumulator += delta;

  while (accumulator >= CONFIG.tickMs) {
    state = step(state, { type: 'tick' }, rng);
    accumulator -= CONFIG.tickMs;
  }

  draw(ctx, state, CONFIG);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
