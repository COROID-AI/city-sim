/**
 * Browser entry point.
 *
 * Boots the canvas, creates an empty world, wires up a panable camera
 * (keyboard + mouse-drag input), and starts the fixed-step game loop.
 * The loop ticks simulation time, advances the camera, and renders a
 * day/night gradient — with world content drawn through the camera
 * transform so panning is visible immediately.
 *
 * Entity spawning, the economy, and entity rendering are layered on by
 * later phases.
 */

import { createWorld, getDaylightFactor } from './sim/world';
import { startLoop } from './render/loop';
import { Camera } from './render/camera';
import type { CameraInput } from './render/camera';
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
  camera.setViewport(canvas.width, canvas.height);
}
// NOTE: `camera` is defined below; resizeCanvas is only invoked after it exists.

// ─── World ───────────────────────────────────────────────────────────────────

const world: World = createWorld(GRID_WIDTH, GRID_HEIGHT);

// ─── Camera ──────────────────────────────────────────────────────────────────

const camera = new Camera({
  worldWidth: GRID_WIDTH,
  worldHeight: GRID_HEIGHT,
  viewportWidth: canvas.width,
  viewportHeight: canvas.height,
});

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ─── Input (keyboard + mouse drag) ───────────────────────────────────────────

/** Keys currently held down (lowercased key names). */
const heldKeys = new Set<string>();

window.addEventListener('keydown', (e: KeyboardEvent) => {
  heldKeys.add(e.key.toLowerCase());
});
window.addEventListener('keyup', (e: KeyboardEvent) => {
  heldKeys.delete(e.key.toLowerCase());
});

/** Whether the left mouse button is currently pressed. */
let isDragging = false;
/** Last drag sample position in screen pixels. */
let lastDragX = 0;
let lastDragY = 0;
/** Accumulated mouse-drag delta for the current step (screen pixels). */
let dragDeltaX = 0;
let dragDeltaY = 0;

canvas.addEventListener('mousedown', (e: MouseEvent) => {
  if (e.button !== 0) return; // left button only
  isDragging = true;
  lastDragX = e.clientX;
  lastDragY = e.clientY;
});
window.addEventListener('mousemove', (e: MouseEvent) => {
  if (!isDragging) return;
  dragDeltaX += e.clientX - lastDragX;
  dragDeltaY += e.clientY - lastDragY;
  lastDragX = e.clientX;
  lastDragY = e.clientY;
});
window.addEventListener('mouseup', (e: MouseEvent) => {
  if (e.button !== 0) return;
  isDragging = false;
});

// ─── Simulation step ─────────────────────────────────────────────────────────

/**
 * Advance simulation time and the camera by `dtMs` milliseconds.
 *
 * One sim-hour = {@link SIM_HOUR_MS}, so a full 24-hour day takes
 * `24 × SIM_HOUR_MS` of real time.
 */
function update(dtMs: number): void {
  world.simTime.elapsedHours += dtMs / SIM_HOUR_MS;

  const camInput: CameraInput = {
    keys: heldKeys,
    mouseDragX: dragDeltaX,
    mouseDragY: dragDeltaY,
  };
  camera.tick(camInput, dtMs);
  // Reset transient drag deltas after consuming them.
  dragDeltaX = 0;
  dragDeltaY = 0;
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

  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset to identity (screen space)
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ── World layer: drawn through the camera transform ──────────────────────
  ctx.save();
  camera.applyTransform(ctx);

  // Draw a subtle grid so panning is immediately visible.
  drawWorldGrid(factor);

  ctx.restore();

  // ── Lighting & celestial body overlays (screen space) ───────────────────
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Day/night lighting overlay — tints the scene for the current time.
  applyLighting(ctx, world, canvas.width, canvas.height);

  // Sun / moon disk tracing the day/night arc.
  drawSun(ctx, world, canvas.width, canvas.height);

  // ── HUD overlay (screen space, always on top) ────────────────────────────
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = '16px monospace';
  ctx.fillStyle = factor < 0.4 ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)';
  const hh = Math.floor(hourOfDay).toString().padStart(2, '0');
  const mm = Math.floor((hourOfDay % 1) * 60).toString().padStart(2, '0');
  const budget = world.budget.toLocaleString('en-US');
  ctx.fillText(
    `Time ${hh}:${mm}  |  Daylight ${(factor * 100).toFixed(0)}%  |  Budget $${budget}`,
    12,
    24,
  );
}

/**
 * Draw a sparse grid in world coordinates so camera panning is visible.
 * Lines fade with the daylight factor.
 */
function drawWorldGrid(factor: number): void {
  const alpha = 0.08 + factor * 0.12;
  ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
  ctx.lineWidth = 1 / camera.zoom; // keep lines ~1px thick on screen

  const step = 10; // every 10 world units

  ctx.beginPath();
  for (let x = 0; x <= GRID_WIDTH; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, GRID_HEIGHT);
  }
  for (let y = 0; y <= GRID_HEIGHT; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(GRID_WIDTH, y);
  }
  ctx.stroke();

  // World border.
  ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 1.5})`;
  ctx.lineWidth = 2 / camera.zoom;
  ctx.strokeRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

startLoop({ update, render });
