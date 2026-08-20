/**
 * Headless smoke test for the minimap renderer.
 * Verifies the acceptance criteria without a browser by exercising the pure
 * logic of src/render/minimap.js with minimal canvas/document mocks:
 *   - src/render/minimap.js exports initMinimap, renderMinimap, drawWorldToMinimap
 *   - The static city (roads, buildings, zones, park tiles) is pre-rendered once
 *     to an offscreen canvas via drawWorldToMinimap and reused on every frame
 *   - The viewport rectangle is derived from the camera every frame and moves
 *     when the camera pans or zooms
 *   - Clicking the minimap recenters the main camera at the clicked city
 *     coordinates
 *   - The minimap is styled as a corner overlay panel with a border
 */
import { CONFIG } from '../src/core/config.js';
import { generateCity } from '../src/world/generate.js';
import {
  initMinimap,
  renderMinimap,
  drawWorldToMinimap,
  MINIMAP_SIZE,
} from '../src/render/minimap.js';

// --- Minimal canvas/document mocks ------------------------------------------
function makeCtx() {
  const records = [];
  const ctx = {
    records,
    _fillStyle: '',
    set fillStyle(v) { this._fillStyle = v; },
    get fillStyle() { return this._fillStyle; },
    _strokeStyle: '',
    set strokeStyle(v) { this._strokeStyle = v; },
    get strokeStyle() { return this._strokeStyle; },
    _lineWidth: 1,
    set lineWidth(v) { this._lineWidth = v; },
    get lineWidth() { return this._lineWidth; },
    _globalAlpha: 1,
    set globalAlpha(v) { this._globalAlpha = v; },
    get globalAlpha() { return this._globalAlpha; },
    _lineDash: [],
    setLineDash(d) { this._lineDash = d; },
    clearRect(x, y, w, h) { records.push({ op: 'clearRect', x, y, w, h }); },
    fillRect(x, y, w, h) { records.push({ op: 'fillRect', x, y, w, h, fillStyle: this._fillStyle }); },
    strokeRect(x, y, w, h) { records.push({ op: 'strokeRect', x, y, w, h, strokeStyle: this._strokeStyle, lineWidth: this._lineWidth }); },
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    setTransform(a, b, c, d, e, f) { records.push({ op: 'setTransform', a, b, c, d, e, f }); },
    drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
      records.push({ op: 'drawImage', img, dx, dy, dw, dh });
    },
  };
  return ctx;
}

function makeCanvas(width = 220, height = 220) {
  const ctx = makeCtx();
  const c = {
    width,
    height,
    style: {},
    getContext: () => ctx,
    _listeners: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
  };
  c.addEventListener = (type, fn) => { c._listeners[type] = fn; };
  return c;
}

// The module creates offscreen canvases via document.createElement at runtime,
// so provide a tiny document mock before exercising those functions.
globalThis.document = {
  createElement: (tag) => makeCanvas(300, 150),
};

const canvas = makeCanvas();
const ctx = canvas.getContext('2d');

// --- World + camera ----------------------------------------------------------
const world = generateCity(CONFIG.SEED, CONFIG);
const worldPx = world.gridSize * world.tileSize;

// A camera with the same public state surface as src/render/camera.js, plus a
// real viewport() method so the viewport-preference path is exercised.
class TestCamera {
  constructor(opts = {}) {
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.zoom = opts.zoom ?? 1;
    this.viewportWidth = opts.viewportWidth ?? 800;
    this.viewportHeight = opts.viewportHeight ?? 600;
  }
  viewport() {
    return {
      x: this.x - this.viewportWidth / this.zoom / 2,
      y: this.y - this.viewportHeight / this.zoom / 2,
      width: this.viewportWidth / this.zoom,
      height: this.viewportHeight / this.zoom,
    };
  }
  clampToBounds(w, h) {
    const vw = this.viewportWidth / this.zoom;
    const vh = this.viewportHeight / this.zoom;
    const minX = vw >= w ? w / 2 : vw / 2;
    const maxX = vw >= w ? w / 2 : w - vw / 2;
    const minY = vh >= h ? h / 2 : vh / 2;
    const maxY = vh >= h ? h / 2 : h - vh / 2;
    this.x = Math.min(maxX, Math.max(minX, this.x));
    this.y = Math.min(maxY, Math.max(minY, this.y));
  }
}

const camera = new TestCamera({ x: worldPx / 2, y: worldPx / 2, zoom: 1, viewportWidth: 800, viewportHeight: 600 });
const MM_SCALE = MINIMAP_SIZE / worldPx;

let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
}

// --- 1. Exports --------------------------------------------------------------
check('module exports initMinimap/renderMinimap/drawWorldToMinimap',
  typeof initMinimap === 'function' && typeof renderMinimap === 'function' &&
    typeof drawWorldToMinimap === 'function');

// --- 2. Static city pre-rendered once ----------------------------------------
const offscreen = drawWorldToMinimap(world);
check('drawWorldToMinimap returns a canvas', !!offscreen && offscreen.width > 0 && offscreen.height > 0,
  `${offscreen.width}x${offscreen.height}`);
check('offscreen canvas is square MINIMAP_SIZE', offscreen.width === MINIMAP_SIZE && offscreen.height === MINIMAP_SIZE,
  `size=${MINIMAP_SIZE}`);
const offRecords = offscreen.getContext('2d').records;
check('pre-render drew roads', offRecords.some((r) => r.op === 'fillRect' && r.fillStyle === '#31363f'));
check('pre-render drew buildings', offRecords.some((r) => r.op === 'fillRect' && r.fillStyle === '#4a7fb5'));
check('pre-render drew ground', offRecords.some((r) => r.op === 'fillRect' && r.fillStyle === '#4d6b3d'));

// --- 3. initMinimap wires the panel + click-to-jump --------------------------
const state = initMinimap(canvas, world, camera);
check('initMinimap returns state with a cached offscreen', !!state && !!state.offscreen &&
  state.offscreen.width === MINIMAP_SIZE && state.offscreen.height === MINIMAP_SIZE);
check('panel styled as corner overlay with border',
  canvas.style.position === 'fixed' && canvas.style.right === '16px' && canvas.style.bottom === '16px' &&
    canvas.style.border && canvas.style.background && canvas.style.zIndex === '10');

// Click at 1/4 of the minimap -> camera recenters at 1/4 of the city (within
// clamp-to-bounds range: worldPx/4 = 512 is inside [400, 1648] at zoom 1).
canvas._listeners.click({ clientX: 55, clientY: 55 });
check('click recenters camera at clicked city coords',
  Math.abs(camera.x - worldPx / 4) < 1 && Math.abs(camera.y - worldPx / 4) < 1,
  `camera=(${camera.x.toFixed(1)},${camera.y.toFixed(1)})`);

// Click at 3/4 -> camera recenters at 3/4 of the city (1536, also in range).
canvas._listeners.click({ clientX: 165, clientY: 165 });
check('click at 3/4 recenters at 3/4 of the city',
  Math.abs(camera.x - (worldPx * 3) / 4) < 1 && Math.abs(camera.y - (worldPx * 3) / 4) < 1,
  `camera=(${camera.x.toFixed(1)},${camera.y.toFixed(1)})`);

// --- 4. renderMinimap draws the cached city + viewport rectangle -------------
camera.x = worldPx / 2;
camera.y = worldPx / 2;
renderMinimap(camera, world);
const renderRecords = ctx.records;
check('render blits the cached offscreen image',
  renderRecords.some((r) => r.op === 'drawImage' && r.img === state.offscreen));
check('render strokes a viewport rectangle',
  renderRecords.some((r) => r.op === 'strokeRect' && r.strokeStyle === '#ffd54f'));

// --- 5. Viewport rectangle follows pan/zoom ----------------------------------
function lastStrokeRect() {
  const strokes = ctx.records.filter((r) => r.op === 'strokeRect');
  return strokes[strokes.length - 1];
}

ctx.records.length = 0;
camera.x = worldPx / 2;
camera.y = worldPx / 2;
renderMinimap(camera, world);
const baseStroke = lastStrokeRect();

ctx.records.length = 0;
camera.x = worldPx / 2 + 100;
camera.y = worldPx / 2 + 50;
renderMinimap(camera, world);
const panStroke = lastStrokeRect();
check('viewport rect moves when the camera pans',
  panStroke && Math.abs((panStroke.x - baseStroke.x) - 100 * MM_SCALE) < 0.01 &&
    Math.abs((panStroke.y - baseStroke.y) - 50 * MM_SCALE) < 0.01,
  `delta=(${(panStroke.x - baseStroke.x).toFixed(2)},${(panStroke.y - baseStroke.y).toFixed(2)})`);

ctx.records.length = 0;
camera.zoom = 2;
camera.x = worldPx / 2;
camera.y = worldPx / 2;
renderMinimap(camera, world);
const zoomStroke = lastStrokeRect();
check('viewport rect shrinks when the camera zooms in',
  zoomStroke && Math.abs(zoomStroke.w - (800 / 2) * MM_SCALE) < 0.01 &&
    Math.abs(zoomStroke.h - (600 / 2) * MM_SCALE) < 0.01,
  `rect=(${zoomStroke.w.toFixed(2)}x${zoomStroke.h.toFixed(2)})`);

// --- 6. Recompute from camera every frame (no full-city redraw per frame) ----
check('per-frame render only blits cached image (no city redraw)',
  ctx.records.filter((r) => r.op === 'drawImage' && r.img === state.offscreen).length >= 1 &&
    ctx.records.every((r) =>
      r.op === 'drawImage' || r.op === 'strokeRect' || r.op === 'fillRect' ||
      r.op === 'clearRect' || r.op === 'setTransform'));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);