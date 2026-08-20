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
 * Dynamic entity sprites are layered through the frame pipeline: citizens via
 * the pluggable drawDynamic hook, then vehicles in a dedicated layer after
 * buildings/citizens (so traffic is never hidden behind buildings).
 * The minimap renders each frame from the camera viewport, the inspector
 * picks entities on canvas click and refreshes live, and the HUD reads the
 * engine state every frame.
 *
 * Loads directly from index.html and starts on load: no build step, no user
 * action. Serve the folder with any static file server (e.g. python3 -m
 * http.server) and open index.html — no bundler, no CDN. Opening index.html
 * via file:// works in browsers that permit file:// module scripts, e.g.
 * Chromium launched with --allow-file-access-from-files.
 */

import { CONFIG } from './core/config.js';
import { SimClock } from './core/clock.js';
import { generateCity } from './world/generate.js';
import { populateCitizens } from './citizens/populate.js';
import { advanceSchedules } from './citizens/schedule.js';
import { updateCitizens, drawCitizens } from './citizens/update.js';
import { createEconomy, tickEconomy } from './economy/index.js';
import { initVehicles, updateVehicles, getVehicles } from './vehicles/index.js';
import { drawVehicles } from './vehicles/update.js';
import { Camera } from './render/camera.js';
import { CityRenderer } from './render/cityRenderer.js';
import { FrameRenderer } from './render/frame.js';
import { initMinimap, renderMinimap } from './render/minimap.js';
import { initInspector } from './ui/inspector.js';

// --- World boot -------------------------------------------------------------
const world = generateCity(CONFIG.SEED, CONFIG);
const { city, citizens } = populateCitizens(world, CONFIG);
const vehicles = initVehicles(world, CONFIG);
city.vehicles = vehicles;
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

const economy = createEconomy(city, CONFIG);
clock.subscribe((c) => {
  advanceSchedules(city, c);
  tickEconomy(city, economy, c);
});

// --- Vehicles (fleet lives on the CityState for the renderer + inspector) ----
console.log(`[vehicles] ${vehicles.length} vehicles active`);

// --- Read-only QA/browser-automation handle -----------------------------------
// Exposes live engine state for the smoke/inspection harness. The handle is
// passive: mutations through it are at the caller's own risk.
window.__sim = {
  world, city, citizens, vehicles, economy, clock, camera,
  _qa: {
    updateCitizens,
    updateVehicles,
    advanceSchedules,
  },
};

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
 * Invoked every frame inside the camera transform so sprites live in world
 * space. Draws the city's citizens; vehicles render in the dedicated vehicle
 * layer that follows (see setVehiclesDraw).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Camera} camera
 * @param {object} world
 * @param {{simHour:number,simDay:number,dayPhase:number}} simTime
 */
function drawDynamic(ctx, camera, world, simTime) {
  drawCitizens(ctx, city, camera);
}
frame.setDynamicDraw(drawDynamic);

/** Dedicated vehicle layer (drawn after citizens so traffic is never hidden). */
function drawVehicleLayer(ctx, simTime) {
  drawVehicles(ctx, vehicles, camera, simTime);
}
frame.setVehiclesDraw(drawVehicleLayer);

// --- Minimap + inspector ------------------------------------------------------
initMinimap(minimapCanvas, world, camera);
initInspector(city, camera, getVehicles);

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

// --- HUD ---------------------------------------------------------------------

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
    ` &nbsp;|&nbsp; Population: ${city.economy.population}` +
    ` &nbsp;|&nbsp; Employment: ${Math.round(city.economy.employmentRate * 100)}%` +
    ` &nbsp;|&nbsp; Budget: ${economy.budget.toLocaleString()}`;

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
  renderMinimap(camera, world);
  updateHud();
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock.tick(now);
  updateCitizens(city, clock, dt);
  updateVehicles(dt, world, camera);
  camera.update(dt);
  camera.clampToBounds(worldPx, worldPx);
  render();
  requestAnimationFrame(loop);
}

resizeCanvases();
window.addEventListener('resize', resizeCanvases);
requestAnimationFrame(loop);
