/**
 * City simulation entrypoint.
 *
 * Boot sequence:
 *   1. Generate the deterministic world (grid + roads + buildings).
 *   2. Create the fixed-timestep SimClock and subscribe the economy so it
 *      updates every sim-hour.
 *   3. Build the render pipeline: a pan/zoom Camera, a pre-rendered
 *      CityRenderer (static day layer + night glow layer), and a FrameRenderer
 *      that applies the camera transform, draws the city, and tints the scene
 *      by daylight.
 *   4. Start the requestAnimationFrame loop.
 *
 * Dynamic entity sprites (citizens/vehicles) are drawn through the pluggable
 * drawDynamic hook below; Phase 2 tasks fill that in without touching the
 * render pipeline.
 *
 * Runs directly from a file:// double-click: no bundler, no server, no CDN.
 */

import { CONFIG } from './core/config.js';
import { SimClock } from './core/clock.js';
import { generateCity } from './world/generate.js';
import { Camera } from './render/camera.js';
import { CityRenderer } from './render/cityRenderer.js';
import { FrameRenderer } from './render/frame.js';

// --- World boot -------------------------------------------------------------
const world = generateCity(CONFIG.SEED, CONFIG);
const worldPx = world.gridSize * world.tileSize;

// --- DOM handles ------------------------------------------------------------
const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap-canvas');
const mctx = minimapCanvas.getContext('2d');
const hudBar = document.getElementById('hud-bar');
const debugStats = document.getElementById('debug-stats');

// --- Camera (pan WASD/drag, zoom wheel) --------------------------------------
const camera = new Camera({
  x: worldPx / 2,
  y: worldPx / 2,
  zoom: 1,
  minZoom: 0.25,
  maxZoom: 4,
});
camera.bindInput();

// --- Sim clock + economy (updates every sim-hour via the clock) --------------
const clock = new SimClock(CONFIG);
clock.start(performance.now());

const economy = {
  budget: CONFIG.STARTING_BUDGET,
  lastHour: -1,
  tick(c) {
    if (c.simHour !== this.lastHour) {
      this.lastHour = c.simHour;
      // Placeholder hourly drift; real economy arrives with later modules.
      this.budget += Math.round(50 + Math.sin(c.simHour) * 10);
      console.log(
        `[economy] day ${c.simDay} hour ${String(c.simHour).padStart(2, '0')} budget $${this.budget.toLocaleString()}`,
      );
    }
  },
};
clock.subscribe((c) => economy.tick(c));

// --- Render pipeline ---------------------------------------------------------
const cityRenderer = new CityRenderer(world, CONFIG);
cityRenderer.prerender();

const frame = new FrameRenderer({
  camera,
  world,
  staticLayer: cityRenderer.getStaticLayer(),
  nightLayer: cityRenderer.getNightLayer(),
  config: CONFIG,
});

/**
 * Pluggable entity sprite hook.
 *
 * Phase 2 tasks (citizens, vehicles) implement this function; it is invoked
 * every frame inside the camera transform so sprites live in world space.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Camera} camera
 * @param {object} world
 * @param {{simHour:number,simDay:number,dayPhase:number}} simTime
 */
function drawDynamic(ctx, camera, world, simTime) {
  // Phase 2 fills this in with citizen & vehicle sprites (and, at night,
  // vehicle headlights via the exposed rendering API).
}
frame.setDynamicDraw(drawDynamic);

// --- Canvas sizing -----------------------------------------------------------
function dpr() {
  return window.devicePixelRatio || 1;
}

function resizeCanvases() {
  const scale = dpr();
  canvas.width = Math.floor(window.innerWidth * scale);
  canvas.height = Math.floor(window.innerHeight * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  minimapCanvas.width = Math.floor(220 * scale);
  minimapCanvas.height = Math.floor(220 * scale);
  mctx.setTransform(scale, 0, 0, scale, 0, 0);
}

// --- Minimap / HUD -----------------------------------------------------------
function zoneColor(zone) {
  switch (zone) {
    case 'residential': return '#4a7fb5';
    case 'workplace': return '#b08f4a';
    case 'entertainment': return '#a54ab5';
    case 'service': return '#4ab57f';
    default: return '#888888';
  }
}

function drawMinimap() {
  const scale = dpr();
  const mw = minimapCanvas.width / scale;
  const mh = minimapCanvas.height / scale;
  mctx.clearRect(0, 0, mw, mh);
  mctx.fillStyle = '#101018';
  mctx.fillRect(0, 0, mw, mh);

  const ts = world.tileSize;
  const mmScale = mw / worldPx;

  for (const b of world.buildings) {
    mctx.fillStyle = zoneColor(b.zone);
    mctx.fillRect(
      b.footprint.x * ts * mmScale,
      b.footprint.y * ts * mmScale,
      b.footprint.w * ts * mmScale,
      Math.max(1, b.footprint.h * ts * mmScale),
    );
  }

  // Viewport rectangle (camera state drives the minimap).
  const vw = (canvas.width / scale) / camera.zoom;
  const vh = (canvas.height / scale) / camera.zoom;
  const vx = camera.x - vw / 2;
  const vy = camera.y - vh / 2;
  mctx.strokeStyle = '#ffd54f';
  mctx.lineWidth = 1;
  mctx.strokeRect(vx * mmScale, vy * mmScale, vw * mmScale, vh * mmScale);
}

function zoneCounts() {
  const counts = {};
  for (const b of world.buildings) {
    counts[b.zone] = (counts[b.zone] || 0) + 1;
  }
  return counts;
}

function updateHud() {
  const hour = String(clock.simHour).padStart(2, '0');
  hudBar.innerHTML =
    `City: Day ${clock.simDay} &middot; ${hour}:00` +
    ` &nbsp;|&nbsp; Population: 0` +
    ` &nbsp;|&nbsp; Employment: 0%` +
    ` &nbsp;|&nbsp; Budget: $${economy.budget.toLocaleString()}`;

  const counts = zoneCounts();
  const lines = Object.entries(counts)
    .map(([z, n]) => `${z}: ${n}`)
    .join('<br>');
  debugStats.innerHTML =
    `buildings: ${world.buildings.length}<br>${lines}` +
    `<br>grid: ${world.gridSize}&times;${world.gridSize}` +
    `<br>zoom: ${camera.zoom.toFixed(2)}` +
    `<br>hour: ${hour}:00`;
}

// --- Main loop ---------------------------------------------------------------
let last = performance.now();

function render() {
  const scale = dpr();
  const w = canvas.width / scale;
  const h = canvas.height / scale;
  frame.render(ctx, w, h, clock.simTime);
  drawMinimap();
  updateHud();
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock.tick(now);
  camera.update(dt);
  camera.clampToBounds(worldPx, worldPx);
  render();
  requestAnimationFrame(loop);
}

resizeCanvases();
window.addEventListener('resize', resizeCanvases);
requestAnimationFrame(loop);