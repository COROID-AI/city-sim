// ---------------------------------------------------------------------------
// Entry point: wire the engine, renderer, input and UI, then run the rAF
// loop that drives gravity, DAS/ARR input, and rendering.
// ---------------------------------------------------------------------------
import './style.css';
import { Tetris } from './tetris.js';
import { BoardRenderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';

const engine = new Tetris();
const renderer = new BoardRenderer(document.getElementById('board'), engine);
const ui = new UI(engine, renderer);
const input = new Input(engine, ui);

let last = performance.now();

function loop(now) {
  const dt = Math.min(now - last, 250); // clamp big tab-switch gaps
  last = now;
  input.update(now);
  engine.tick(dt);
  renderer.draw();
  ui.update();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);