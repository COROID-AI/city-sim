/**
 * Browser entry point.
 *
 * Boots the canvas, generates a procedural city, spawns citizens, vehicles,
 * and companies, wires up a panable camera (keyboard + mouse-drag input),
 * and starts the fixed-step game loop.
 *
 * The loop ticks simulation time, advances entities (citizens, vehicles,
 * companies, economy), and renders the full scene — terrain, roads,
 * buildings, citizens, and vehicles through the camera transform, with a
 * day/night lighting overlay, minimap, and HUD on top.
 */

import { createWorld, getDaylightFactor } from './sim/world';
import { generateCity, DEFAULT_CITY_SEED } from './sim/worldGen';
import { spawnCitizens, tickCitizens } from './sim/citizens';
import { spawnVehicles, tickVehicles } from './sim/vehicles';
import { createCompanies, assignEmployees, tickCompanies } from './sim/companies';
import { tickEconomy } from './sim/economy';
import { startLoop } from './render/loop';
import { Camera } from './render/camera';
import type { CameraInput } from './render/camera';
import { applyLighting, drawSun } from './render/lighting';
import { drawMinimap, BUILDING_COLORS } from './render/minimap';
import { drawHud } from './render/hud';
import {
  SIM_HOUR_MS,
  GRID_WIDTH,
  GRID_HEIGHT,
  MIN_CITIZENS,
  MIN_VEHICLES,
} from './sim/constants';
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

// Bootstrap the city: procedural generation → citizens → companies → employees → vehicles.
generateCity(world, DEFAULT_CITY_SEED);
spawnCitizens(world, MIN_CITIZENS);
createCompanies(world);
assignEmployees(world);
spawnVehicles(world, MIN_VEHICLES);

// Start the simulation in daytime (10:00) so the city is clearly visible on load.
world.simTime.elapsedHours = 10;

// ─── Camera ──────────────────────────────────────────────────────────────────

/**
 * Initial zoom chosen so that the entire city (100×100) fits comfortably
 * in a typical desktop viewport, guaranteeing ≥20 buildings, ≥50 citizens,
 * and ≥10 vehicles are all visible on load.
 */
const INITIAL_ZOOM = 8;

const camera = new Camera({
  worldWidth: GRID_WIDTH,
  worldHeight: GRID_HEIGHT,
  zoom: INITIAL_ZOOM,
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
 * Advance simulation time, entities, and the camera by `dtMs` milliseconds.
 *
 * One sim-hour = {@link SIM_HOUR_MS}, so a full 24-hour day takes
 * `24 × SIM_HOUR_MS` of real time.  Citizens, vehicles, companies, and the
 * economy are all ticked each step; the economy is internally idempotent
 * within a single sim-hour.
 */
function update(dtMs: number): void {
  world.simTime.elapsedHours += dtMs / SIM_HOUR_MS;

  // Advance all entity systems.
  tickCitizens(world, dtMs);
  tickVehicles(world, dtMs);
  tickCompanies(world, world.simTime);
  tickEconomy(world);

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

/**
 * Render a full frame:
 *   1. Day/night sky gradient (screen space).
 *   2. World content — terrain, roads, buildings, citizens, vehicles —
 *      drawn through the camera transform so panning is visible.
 *   3. Day/night lighting overlay (screen space).
 *   4. Sun / moon celestial body.
 *   5. Minimap overlay.
 *   6. HUD overlay (always on top).
 */
function render(): void {
  const factor = getDaylightFactor(world.simTime.elapsedHours);

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
  drawWorld();
  ctx.restore();

  // ── Lighting & celestial body overlays (screen space) ───────────────────
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Day/night lighting overlay — tints the scene for the current time.
  applyLighting(ctx, world, canvas.width, canvas.height);

  // Sun / moon disk tracing the day/night arc.
  drawSun(ctx, world, canvas.width, canvas.height);

  // ── Minimap overlay (bottom-right, screen space) ─────────────────────────
  drawMinimap(ctx, world, camera, canvas.width, canvas.height);

  // ── HUD overlay (screen space, always on top) ────────────────────────────
  // Called LAST so it sits above lighting, minimap, and all other layers.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHud(ctx, world);
}

// ─── World rendering ─────────────────────────────────────────────────────────

/** Full circle angle (2π). */
const TAU = Math.PI * 2;

/**
 * Draw the full city scene in world coordinates (inside the camera transform).
 *
 * Layers, back-to-front:
 *   1. Ground (grass) base for the visible area.
 *   2. Road tiles (batched into a single fill for performance).
 *   3. Buildings coloured by kind, with dark outlines for definition.
 *   4. Citizens as small bright dots.
 *   5. Vehicles as small red dots.
 *
 * Tile iteration is culled to the camera's visible bounds so only on-screen
 * tiles are processed, keeping the frame budget tight even for a 100×100 grid.
 */
function drawWorld(): void {
  // Compute visible tile bounds for culling.
  const halfW = camera.visibleWidth / 2;
  const halfH = camera.visibleHeight / 2;
  const minX = Math.max(0, Math.floor(camera.centerX - halfW));
  const minY = Math.max(0, Math.floor(camera.centerY - halfH));
  const maxX = Math.min(GRID_WIDTH, Math.ceil(camera.centerX + halfW));
  const maxY = Math.min(GRID_HEIGHT, Math.ceil(camera.centerY + halfH));

  // ── Ground base (grass) ──────────────────────────────────────────────────
  ctx.fillStyle = '#2d4a2d';
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

  // ── Roads (batched into a single fill for performance) ───────────────────
  ctx.fillStyle = '#4a4a4a';
  ctx.beginPath();
  for (let y = minY; y < maxY; y++) {
    const rowOffset = y * GRID_WIDTH;
    for (let x = minX; x < maxX; x++) {
      const tile = world.tiles[rowOffset + x];
      if (tile && tile.terrain === 'ROAD') {
        ctx.rect(x, y, 1, 1);
      }
    }
  }
  ctx.fill();

  // ── Buildings coloured by kind (batched per kind) ────────────────────────
  for (const [kind, color] of Object.entries(BUILDING_COLORS)) {
    ctx.fillStyle = color;
    for (const b of world.buildings.values()) {
      if (b.kind !== kind) continue;
      // Cull buildings entirely outside the visible area.
      if (b.position.x + b.size.width < minX || b.position.x > maxX) continue;
      if (b.position.y + b.size.height < minY || b.position.y > maxY) continue;
      ctx.fillRect(b.position.x, b.position.y, b.size.width, b.size.height);
    }
  }

  // ── Building outlines for visual definition ──────────────────────────────
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 0.1; // thin outline in world units
  for (const b of world.buildings.values()) {
    if (b.position.x + b.size.width < minX || b.position.x > maxX) continue;
    if (b.position.y + b.size.height < minY || b.position.y > maxY) continue;
    ctx.strokeRect(b.position.x, b.position.y, b.size.width, b.size.height);
  }

  // ── Citizens (bright dots) ───────────────────────────────────────────────
  ctx.fillStyle = '#fff176';
  for (const c of world.citizens.values()) {
    ctx.beginPath();
    ctx.arc(c.position.x, c.position.y, 0.3, 0, TAU);
    ctx.fill();
  }

  // ── Vehicles (red dots) ──────────────────────────────────────────────────
  ctx.fillStyle = '#ef5350';
  for (const v of world.vehicles.values()) {
    ctx.beginPath();
    ctx.arc(v.position.x, v.position.y, 0.35, 0, TAU);
    ctx.fill();
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

startLoop({ update, render });
