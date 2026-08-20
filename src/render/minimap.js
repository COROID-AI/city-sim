/**
 * minimap.js — compact overview of the whole city.
 *
 * The city is large and the browser window only ever reveals a slice of it,
 * so the minimap renders the entire static city into a small corner panel and
 * highlights exactly which slice the camera is looking at.
 *
 * Performance model:
 *   - initMinimap(canvas, world, camera) pre-renders the static city (ground,
 *     roads, zone-colored buildings, and water/park tiles when present) once
 *     onto an offscreen canvas via drawWorldToMinimap(world).
 *   - Every frame renderMinimap(camera, world) only blits that cached image,
 *     scaled into the small minimap canvas, and strokes the viewport rectangle
 *     derived from the camera. There is no full-city redraw per frame.
 *   - Clicking the minimap recentres the main camera at the clicked city
 *     coordinates.
 *
 * The panel is styled as a small semi-transparent overlay in the bottom-right
 * corner, below the top HUD bar, with a border so it reads as an overlay on
 * top of the city view.
 */

/** Panel CSS size in px (square). */
export const MINIMAP_SIZE = 220;

/** Panel chrome. */
const PANEL_BG = 'rgba(12, 14, 22, 0.86)';
const PANEL_BORDER = 'rgba(58, 63, 77, 0.95)';

/** Static-city palette (deliberately high-contrast at minimap scale). */
const GROUND = '#4d6b3d';
const ROAD = '#31363f';
const WATER = '#2f7fb2';
const PARK = '#3f7a3a';
const ZONE_COLORS = {
  residential: '#4a7fb5',
  workplace: '#b08f4a',
  entertainment: '#a54ab5',
  service: '#3f9f6f',
};
const BUILDING_FALLBACK = '#8a9ba8';

/** Viewport overlay colors. */
const VIEWPORT_COLOR = '#ffd54f';
const VIEWPORT_FILL = 'rgba(255, 213, 79, 0.12)';

/** Latest initialised minimap (single overlay panel per page). */
let _minimap = null;

function createCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Pre-render the static city onto an offscreen canvas.
 *
 * Draws the ground, then terrain tiles (road / water / park when they exist),
 * then every building as a zone-colored block (parks get a pond dot). The
 * result is a complete, immutable minimap image that renderMinimap reuses on
 * every frame.
 *
 * @param {object} world  City world ({ gridSize, tileSize, tiles?, roads, buildings }).
 * @param {object} [options]
 * @param {number} [options.size]  Offscreen canvas size in px (defaults to MINIMAP_SIZE).
 * @returns {HTMLCanvasElement} A canvas containing the whole city at minimap scale.
 */
export function drawWorldToMinimap(world, options = {}) {
  const size = options.size || MINIMAP_SIZE;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const tileSize = world.tileSize || 1;
  const gs = world.gridSize || 0;
  const worldPx = gs * tileSize;
  const scale = worldPx > 0 ? size / worldPx : 1;
  const tileW = Math.max(1, tileSize * scale);

  // Ground (grass) fills every gap so the minimap always reads as the city.
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, size, size);

  // Terrain tiles: roads, plus water/park tiles if the world model has them.
  if (Array.isArray(world.tiles) && world.tiles.length > 0) {
    for (let y = 0; y < gs; y++) {
      const row = world.tiles[y] || [];
      for (let x = 0; x < row.length; x++) {
        const t = row[x];
        if (!t) continue;
        if (t.type === 'road') {
          ctx.fillStyle = ROAD;
          ctx.fillRect(x * tileSize * scale, y * tileSize * scale, tileW, tileW);
        } else if (t.type === 'water') {
          ctx.fillStyle = WATER;
          ctx.fillRect(x * tileSize * scale, y * tileSize * scale, tileW, tileW);
        } else if (t.type === 'park') {
          ctx.fillStyle = PARK;
          ctx.fillRect(x * tileSize * scale, y * tileSize * scale, tileW, tileW);
        }
      }
    }
  } else if (Array.isArray(world.roads)) {
    // Fallback for worlds without a tile grid: draw the road list directly.
    for (const r of world.roads) {
      ctx.fillStyle = ROAD;
      ctx.fillRect(r.x * tileSize * scale, r.y * tileSize * scale, tileW, tileW);
    }
  }

  // Buildings: one zone-colored footprint rect each (parks include a pond).
  for (const b of world.buildings || []) {
    const fp = b.footprint;
    if (!fp) continue;
    const x = fp.x * tileSize * scale;
    const y = fp.y * tileSize * scale;
    const w = Math.max(1, fp.w * tileSize * scale);
    const h = Math.max(1, fp.h * tileSize * scale);
    ctx.fillStyle = ZONE_COLORS[b.zone] || BUILDING_FALLBACK;
    ctx.fillRect(x, y, w, h);
    if (b.zone === 'service' && b.subType === 'park') {
      ctx.fillStyle = WATER;
      ctx.beginPath();
      ctx.arc(x + w * 0.35, y + h * 0.35, Math.max(1, Math.min(w, h) * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas;
}

/**
 * Compute the camera's visible world rect.
 *
 * Prefers `camera.viewport()` when available; otherwise mirrors the exact rect
 * from the camera's public state (the camera is the single source of truth for
 * what the main view shows: `x/y/zoom` + `viewportWidth/Height`).
 *
 * @returns {{x:number,y:number,width:number,height:number}} World rect, px.
 */
function cameraViewport(camera) {
  if (typeof camera.viewport === 'function') {
    const vp = camera.viewport();
    if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y) &&
        Number.isFinite(vp.width) && Number.isFinite(vp.height)) {
      return vp;
    }
  }

  const zoom = camera.zoom || 1;
  let vw = camera.viewWorldW;
  if (!Number.isFinite(vw)) vw = (camera.viewportWidth ?? 800) / zoom;
  let vh = camera.viewWorldH;
  if (!Number.isFinite(vh)) vh = (camera.viewportHeight ?? 600) / zoom;
  return { x: camera.x - vw / 2, y: camera.y - vh / 2, width: vw, height: vh };
}

/**
 * Set up the minimap overlay for a page.
 *
 * Styles the canvas as a small semi-transparent corner panel, pre-renders the
 * static city to an offscreen canvas, and wires click-to-jump so a click on
 * the minimap recenters the camera at the corresponding city coordinates.
 *
 * @param {HTMLCanvasElement} canvas  The minimap canvas element.
 * @param {object} world  City world.
 * @param {object} camera  Main pan/zoom camera.
 * @returns {object} The initialised minimap state (offscreen canvas etc).
 */
export function initMinimap(canvas, world, camera) {
  if (!canvas || !world) return null;

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssSize = MINIMAP_SIZE;
  const worldSize = (world.gridSize || 0) * (world.tileSize || 1);

  // Panel look: small semi-transparent bottom-right overlay with a border,
  // underneath the top HUD bar.
  Object.assign(canvas.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    width: `${cssSize}px`,
    height: `${cssSize}px`,
    background: PANEL_BG,
    border: `1px solid ${PANEL_BORDER}`,
    borderRadius: '6px',
    boxShadow: '0 2px 14px rgba(0, 0, 0, 0.55)',
    cursor: 'crosshair',
    zIndex: '10',
  });
  canvas.width = Math.floor(cssSize * dpr);
  canvas.height = Math.floor(cssSize * dpr);

  // Static city pre-rendered once (with the panel alpha baked into the page
  // background; the map image itself is drawn over the panel every frame).
  const offscreen = drawWorldToMinimap(world, { size: Math.round(cssSize * dpr) });

  const state = {
    canvas,
    camera,
    world,
    offscreen,
    dpr,
    cssSize,
    worldSizePx: worldSize,
  };
  _minimap = state;

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const wx = (relX / rect.width) * state.worldSizePx;
    const wy = (relY / rect.height) * state.worldSizePx;
    state.camera.x = wx;
    state.camera.y = wy;
    if (typeof state.camera.clampToBounds === 'function') {
      state.camera.clampToBounds(state.worldSizePx, state.worldSizePx);
    }
  });

  return state;
}

/**
 * Draw one minimap frame.
 *
 * Blits the cached offscreen city image onto the small minimap canvas, then
 * overlays a bright rectangle for the camera's current viewport, recomputed
 * from the camera every frame so panning/zooming moves it immediately.
 *
 * @param {object} camera  Main Camera.
 * @param {object} world  City world (used as a size fallback only).
 */
export function renderMinimap(camera, world) {
  const state = _minimap;
  if (!state) return;
  if (!camera) return;

  const { canvas, offscreen } = state;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // World size (px) this minimap represents.
  const worldSize = state.worldSizePx > 0
    ? state.worldSizePx
    : (world ? (world.gridSize || 0) * (world.tileSize || 1) : 0);
  if (worldSize <= 0) return;

  // Use the canvas' current backing/device ratio so external resizes keep
  // working; CSS size is derived from canvas size so the drawing stays scaled.
  const cssSize = state.cssSize;
  const scaleX = cssSize > 0 ? canvas.width / cssSize : 1;
  const scaleY = cssSize > 0 ? canvas.height / cssSize : 1;

  ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);

  // Semi-transparent panel base.
  ctx.globalAlpha = 1;
  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(0, 0, cssSize, cssSize);

  // Static city image, scaled into the small minimap (the only per-frame cost).
  ctx.globalAlpha = 0.92;
  ctx.drawImage(offscreen, 0, 0, offscreen.width, offscreen.height, 0, 0, cssSize, cssSize);
  ctx.globalAlpha = 1;

  // Bright viewport rectangle derived from the camera every frame.
  const vp = cameraViewport(camera);
  const s = cssSize / worldSize;
  const vx = vp.x * s;
  const vy = vp.y * s;
  const vw = Math.max(0, vp.width * s);
  const vh = Math.max(0, vp.height * s);

  // Subtle translucent fill over the visible slice.
  const ix = clamp(Math.floor(vx), 0, cssSize);
  const iy = clamp(Math.floor(vy), 0, cssSize);
  const iw = clamp(Math.ceil(vx + vw), 0, cssSize) - ix;
  const ih = clamp(Math.ceil(vy + vh), 0, cssSize) - iy;
  if (iw > 0 && ih > 0) {
    ctx.fillStyle = VIEWPORT_FILL;
    ctx.fillRect(ix, iy, iw, ih);
  }

  ctx.strokeStyle = VIEWPORT_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(vx, vy, vw, vh);
}