/**
 * Browser entry point.
 *
 * Boots the canvas, creates an empty world, and starts the fixed-step
 * game loop.  The loop ticks simulation time and renders a day/night
 * gradient so the cycle is immediately visible.
 *
 * This is the foundation scaffold — spawning systems, the economy, and
 * entity rendering are layered on by later phases.
 */

import { createWorld, getDaylightFactor } from './sim/world';
import { startLoop } from './render/loop';
import { applyLighting, drawSun } from './render/lighting';
import { SIM_HOUR_MS, HOURS_PER_DAY, GRID_WIDTH, GRID_HEIGHT } from './sim/constants';
import type { World } from './sim/types';

// ─── Canvas setup ────────────────────────────────────────────────────────────

function getCanvas(): HTMLCanvasElement {
  const el = document.getElementById('game');
  if (!(el instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #game not found');
  }
  return el;
}

function getCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas context unavailable');
  }
  return context;
}

const canvas: HTMLCanvasElement = getCanvas();
const ctx: CanvasRenderingContext2D = getCtx(canvas);

function resizeCanvas(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ─── World ───────────────────────────────────────────────────────────────────

const world: World = createWorld(GRID_WIDTH, GRID_HEIGHT);

// ─── Simulation step ─────────────────────────────────────────────────────────

/**
 * Advance simulation time by `dtMs` milliseconds.
 *
 * One sim-hour = {@link SIM_HOUR_MS}, so a full 24-hour day takes
 * `24 × SIM_HOUR_MS` of real time.
 */
function update(dtMs: number): void {
  world.simTime.elapsedHours += dtMs / SIM_HOUR_MS;
}

// ─── Render ──────────────────────────────────────────────────────────────────

/** Paint a full-viewport day/night gradient reflecting the current sim time. */
function render(): void {
  const factor = getDaylightFactor(world.simTime.elapsedHours);
  const hourOfDay = ((world.simTime.elapsedHours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;

  // Interpolate between a dark night sky and a bright day sky.
  // Night:   rgb(10, 12, 30)
  // Day:     rgb(135, 206, 235) (sky blue)
  const r = Math.round(10 + (135 - 10) * factor);
  const g = Math.round(12 + (206 - 12) * factor);
  const b = Math.round(30 + (235 - 30) * factor);

  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Day/night lighting overlay — tints the scene for the current time.
  applyLighting(ctx, world, canvas.width, canvas.height);

  // Sun / moon disk tracing the day/night arc.
  drawSun(ctx, world, canvas.width, canvas.height);

  // HUD: clock + daylight readout (temporary scaffold HUD).
  ctx.font = '16px monospace';
  ctx.fillStyle = factor < 0.4 ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)';
  const hh = Math.floor(hourOfDay).toString().padStart(2, '0');
  const mm = Math.floor((hourOfDay % 1) * 60).toString().padStart(2, '0');
  const budget = world.budget.toLocaleString('en-US');
  ctx.fillText(`Time ${hh}:${mm}  |  Daylight ${(factor * 100).toFixed(0)}%  |  Budget $${budget}`, 12, 24);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

startLoop({ update, render });
