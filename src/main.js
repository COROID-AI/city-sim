/**
 * City simulation entrypoint.
 *
 * Boot sequence:
 *   1. Generate the deterministic world (grid + roads + buildings).
 *   2. Create the fixed-timestep SimClock and subscribe the economy so it
 *      updates every sim-hour.
 *   3. Start the requestAnimationFrame render loop, drawing a debug
 *      placeholder scene: city grid, road network, and building footprints.
 *
 * Runs directly from a file:// double-click: no bundler, no server, no CDN.
 */

import { CONFIG } from './core/config.js';
import { SimClock } from './core/clock.js';
import { generateCity } from './world/generate.js';
import { populateCitizens } from './citizens/populate.js';
import { advanceSchedules } from './citizens/schedule.js';
import {
  updateCitizens,
  drawDynamic,
  drawCitizens,
  registerDrawDynamic,
} from './citizens/update.js';
import { createEconomy, tickEconomy } from './economy/index.js';

// --- World boot -------------------------------------------------------------
const world = generateCity(CONFIG.SEED, CONFIG);
const { city, citizens } = populateCitizens(world, CONFIG);
registerDrawDynamic(drawCitizens);

// --- DOM handles ------------------------------------------------------------
const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap-canvas');
const mctx = minimapCanvas.getContext('2d');
const hudBar = document.getElementById('hud-bar');
const debugStats = document.getElementById('debug-stats');

// --- Camera ---------------------------------------------------------------
const camera = { x: 0, y: 0, zoom: 1 };

// --- Sim clock + economy (updates every sim-hour via the clock) ------------
const clock = new SimClock(CONFIG);
clock.start(performance.now());

const economy = createEconomy(city, CONFIG);
clock.subscribe((c) => {
  advanceSchedules(city, c);
  tickEconomy(city, economy, c);
});

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

// --- Rendering ---------------------------------------------------------------
function zoneColor(zone) {
  switch (zone) {
    case 'residential': return '#4a7fb5';
    case 'workplace': return '#b08f4a';
    case 'entertainment': return '#a54ab5';
    case 'service': return '#4ab57f';
    default: return '#888888';
  }
}

function drawWorld() {
  const ts = world.tileSize;
  const size = world.gridSize * ts;

  // City grid.
  ctx.strokeStyle = 'rgba(200,200,220,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= world.gridSize; i++) {
    ctx.beginPath();
    ctx.moveTo(i * ts, 0);
    ctx.lineTo(i * ts, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * ts);
    ctx.lineTo(size, i * ts);
    ctx.stroke();
  }

  // Road network.
  ctx.fillStyle = '#3a3f4d';
  for (const r of world.roads) {
    ctx.fillRect(r.x * ts, r.y * ts, ts, ts);
  }

  // Building footprints + doors.
  for (const b of world.buildings) {
    ctx.fillStyle = zoneColor(b.zone);
    ctx.fillRect(
      b.footprint.x * ts,
      b.footprint.y * ts,
      b.footprint.w * ts,
      b.footprint.h * ts,
    );
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(b.door.x * ts + ts * 0.3, b.door.y * ts + ts * 0.3, ts * 0.4, ts * 0.4);
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
  const worldPx = world.gridSize * ts;
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

  // Viewport rectangle.
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
    `<br>zoom: ${camera.zoom.toFixed(2)}`;
}

function render() {
  const scale = dpr();
  const w = canvas.width / scale;
  const h = canvas.height / scale;

  ctx.fillStyle = '#14141f';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
  drawWorld();
  drawDynamic(ctx, city, camera);
  ctx.restore();

  drawMinimap();
  updateHud();
}

// --- Input (pan/zoom so the large world is explorable) ----------------------
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.key] = true;
});
window.addEventListener('keyup', (e) => {
  keys[e.key] = false;
});
window.addEventListener('wheel', (e) => {
  camera.zoom *= e.deltaY < 0 ? 0.9 : 1.1;
  camera.zoom = Math.min(4, Math.max(0.25, camera.zoom));
});

function pan(dt) {
  const speed = 500 / camera.zoom;
  const half = speed * dt;
  if (keys['a'] || keys['ArrowLeft']) camera.x -= half;
  if (keys['d'] || keys['ArrowRight']) camera.x += half;
  if (keys['w'] || keys['ArrowUp']) camera.y -= half;
  if (keys['s'] || keys['ArrowDown']) camera.y += half;
}

// --- Main loop ---------------------------------------------------------------
let last = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock.tick(now);
  updateCitizens(city, clock, dt);
  pan(dt);
  render();
  requestAnimationFrame(loop);
}

resizeCanvases();
window.addEventListener('resize', resizeCanvases);
requestAnimationFrame(loop);