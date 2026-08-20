/**
 * cityRenderer.js — top-down 2D Canvas rendering of the city.
 *
 * The whole city is pre-rendered once to two offscreen canvases so the per-frame
 * cost stays low enough for smooth 60fps panning over a world larger than the
 * viewport:
 *
 *   staticLayer — zone-colored ground, roads with lane markings and sidewalks,
 *                 and every building's per-zone distinctive art.
 *   nightLayer  — night-only glows: streetlamps, lit building windows, and
 *                 entertainment marquees. Drawn over the static layer at dusk
 *                 and night.
 *
 * Both layers are world-pixel aligned (1:1) so the frame orchestrator can crop
 * just the visible region each frame.
 */

import { CONFIG } from '../core/config.js';

const TS = CONFIG.TILE_SIZE;

/** Zone base colors shown as a ground ring around each building. */
const ZONE_BASE = {
  residential: '#6f91b8',
  workplace: '#8a93a2',
  entertainment: '#9a4fb0',
  service: '#7fa06b',
};

const PALETTE = {
  roof: '#b98d6b',
  roofDark: '#8a6f4d',
  office: '#7c8494',
  officeDark: '#5d6472',
  windowDay: '#cfe3ef',
  windowGlow: '#ffd98a',
  venue: '#8f4fb0',
  venueDark: '#5d2d6e',
  marquee: '#ffd24a',
  shop: '#7fa06b',
  awning: '#e0574a',
  restaurant: '#b0604f',
  park: '#5d8a4f',
  parkPath: '#d9b98a',
  pond: '#4a90c4',
  door: '#7a4a2d',
  doorDark: '#3a4350',
  tree: '#3f6b3a',
  asphalt: '#3c414e',
  sidewalk: '#b9b8bd',
  lane: '#e8c94a',
  lamp: '#8a8f96',
};

function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function shade(hex, f) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.min(255, Math.round(r * f))},${Math.min(255, Math.round(g * f))},${Math.min(255, Math.round(b * f))})`;
}

function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Deterministic 0..1 hash from tile coordinates (for ground variation). */
function hash2(x, y) {
  let n = Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return (n % 1000) / 1000;
}

/** Deterministic 0..1 pseudo-random value from a seed and an index. */
function prand(seed, i) {
  let n = Math.imul(seed + Math.imul(i, 374761393), 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return (n % 1000) / 1000;
}

/** Draw a five-point star at (cx, cy) with the given outer radius. */
function drawStar(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

export class CityRenderer {
  constructor(world, config = CONFIG) {
    this.world = world;
    this.config = config;
    this.worldPx = world.gridSize * world.tileSize;
    this.staticLayer = null;
    this.nightLayer = null;
    this._roadSet = new Set(world.roads.map((r) => `${r.x},${r.y}`));
  }

  getStaticLayer() {
    return this.staticLayer;
  }

  getNightLayer() {
    return this.nightLayer;
  }

  /** Render both offscreen layers once. Call after construction. */
  prerender() {
    const wp = this.worldPx;
    this.staticLayer = createCanvas(wp, wp);
    this.nightLayer = createCanvas(wp, wp);
    const ctx = this.staticLayer.getContext('2d');
    const nctx = this.nightLayer.getContext('2d');

    this._drawGround(ctx);
    this._drawRoads(ctx);
    this._drawBuildings(ctx);
    this._drawStreetPosts(ctx);

    this._drawNightWindows(nctx);
    this._drawNightLamps(nctx);
  }

  // --- Ground ---------------------------------------------------------------

  _drawGround(ctx) {
    const gs = this.world.gridSize;
    const ts = this.world.tileSize;
    const wp = this.worldPx;

    ctx.fillStyle = '#6d8a5a';
    ctx.fillRect(0, 0, wp, wp);

    // Subtle per-tile variation on non-road tiles.
    for (let y = 0; y < gs; y++) {
      for (let x = 0; x < gs; x++) {
        if (this.world.tiles[y][x].type === 'road') continue;
        const f = 0.92 + hash2(x, y) * 0.16;
        ctx.fillStyle = shade('#6d8a5a', f);
        ctx.fillRect(x * ts, y * ts, ts, ts);
      }
    }

    // Zone-colored footprint bases (a ground ring peeks out around each
    // building's inset art).
    for (const b of this.world.buildings) {
      const fp = b.footprint;
      ctx.fillStyle = ZONE_BASE[b.zone];
      ctx.fillRect(fp.x * ts, fp.y * ts, fp.w * ts, fp.h * ts);
    }
  }

  // --- Roads ----------------------------------------------------------------

  _drawRoads(ctx) {
    const ts = this.world.tileSize;
    const has = (x, y) => this._roadSet.has(`${x},${y}`);
    const curb = 5;

    for (const r of this.world.roads) {
      const { x, y } = r;
      const px = x * ts;
      const py = y * ts;
      const n = has(x, y - 1);
      const s = has(x, y + 1);
      const e = has(x + 1, y);
      const w = has(x - 1, y);

      // Asphalt.
      ctx.fillStyle = PALETTE.asphalt;
      ctx.fillRect(px, py, ts, ts);

      // Sidewalks (curbs on the open edges).
      ctx.fillStyle = PALETTE.sidewalk;
      if (!n) ctx.fillRect(px, py, ts, curb);
      if (!s) ctx.fillRect(px, py + ts - curb, ts, curb);
      if (!w) ctx.fillRect(px, py, curb, ts);
      if (!e) ctx.fillRect(px + ts - curb, py, curb, ts);

      // Lane markings (dashed center line along the road direction).
      const horiz = e || w;
      const vert = n || s;
      ctx.strokeStyle = PALETTE.lane;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      if (horiz) {
        ctx.beginPath();
        ctx.moveTo(px, py + ts / 2);
        ctx.lineTo(px + ts, py + ts / 2);
        ctx.stroke();
      }
      if (vert) {
        ctx.beginPath();
        ctx.moveTo(px + ts / 2, py);
        ctx.lineTo(px + ts / 2, py + ts);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  // --- Buildings ------------------------------------------------------------

  _drawBuildings(ctx) {
    const ts = this.world.tileSize;
    for (const b of this.world.buildings) {
      this._drawBuilding(ctx, b, ts);
    }
  }

  _drawBuilding(ctx, b, ts) {
    const fp = b.footprint;
    const px = fp.x * ts;
    const py = fp.y * ts;
    const pw = fp.w * ts;
    const ph = fp.h * ts;

    switch (b.zone) {
      case 'residential':
        this._drawResidential(ctx, b, px, py, pw, ph, ts);
        break;
      case 'workplace':
        this._drawOffice(ctx, b, px, py, pw, ph, ts);
        break;
      case 'entertainment':
        this._drawVenue(ctx, b, px, py, pw, ph, ts);
        break;
      case 'service':
        if (b.subType === 'park') this._drawPark(ctx, b, px, py, pw, ph, ts);
        else if (b.subType === 'restaurant')
          this._drawRestaurant(ctx, b, px, py, pw, ph, ts);
        else this._drawShop(ctx, b, px, py, pw, ph, ts);
        break;
    }
  }

  _drawDoor(ctx, b, ts, color) {
    const d = b.door;
    const px = d.x * ts;
    const py = d.y * ts;
    ctx.fillStyle = color;
    ctx.fillRect(px + ts * 0.3, py + ts * 0.3, ts * 0.4, ts * 0.4);
  }

  /** Residential houses/apartments: terracotta roof, ridge, windows, door. */
  _drawResidential(ctx, b, px, py, pw, ph, ts) {
    ctx.fillStyle = PALETTE.roof;
    ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);

    ctx.strokeStyle = PALETTE.roofDark;
    ctx.lineWidth = 3;
    if (pw >= ph) {
      ctx.beginPath();
      ctx.moveTo(px + 2, py + ph / 2);
      ctx.lineTo(px + pw - 2, py + ph / 2);
    } else {
      ctx.beginPath();
      ctx.moveTo(px + pw / 2, py + 2);
      ctx.lineTo(px + pw / 2, py + ph - 2);
    }
    ctx.stroke();

    ctx.fillStyle = PALETTE.windowDay;
    for (const w of this._windowsFor(b)) ctx.fillRect(w.x, w.y, w.w, w.h);

    this._drawDoor(ctx, b, ts, PALETTE.door);
  }

  /** Office blocks: gray slab with a window grid and rooftop unit. */
  _drawOffice(ctx, b, px, py, pw, ph, ts) {
    ctx.fillStyle = PALETTE.office;
    ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);
    ctx.strokeStyle = PALETTE.officeDark;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);

    ctx.fillStyle = PALETTE.windowDay;
    for (const w of this._windowsFor(b)) ctx.fillRect(w.x, w.y, w.w, w.h);

    ctx.fillStyle = '#9aa3b0';
    ctx.fillRect(px + pw - 12, py + 2, 8, 8);

    this._drawDoor(ctx, b, ts, PALETTE.doorDark);
  }

  /** Entertainment venues: purple block with a bright marquee star. */
  _drawVenue(ctx, b, px, py, pw, ph, ts) {
    ctx.fillStyle = PALETTE.venue;
    ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);
    ctx.strokeStyle = PALETTE.venueDark;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);

    drawStar(
      ctx,
      px + pw / 2,
      py + ph / 2,
      Math.max(6, Math.min(pw, ph) * 0.22),
      PALETTE.marquee,
    );

    this._drawDoor(ctx, b, ts, '#2d1a3d');
  }

  /** Shops: green block with an awning band and storefront windows. */
  _drawShop(ctx, b, px, py, pw, ph, ts) {
    ctx.fillStyle = PALETTE.shop;
    ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);

    const d = b.door;
    const horizontal = d.y === b.footprint.y || d.y === b.footprint.y + b.footprint.h - 1;
    ctx.fillStyle = PALETTE.awning;
    if (horizontal) ctx.fillRect(px + 2, py + ph / 2 - 4, pw - 4, 8);
    else ctx.fillRect(px + pw / 2 - 4, py + 2, 8, ph - 4);

    ctx.fillStyle = PALETTE.windowDay;
    for (const w of this._windowsFor(b)) ctx.fillRect(w.x, w.y, w.w, w.h);

    this._drawDoor(ctx, b, ts, '#3f4a36');
  }

  /** Restaurants: warm block with round tables. */
  _drawRestaurant(ctx, b, px, py, pw, ph, ts) {
    ctx.fillStyle = PALETTE.restaurant;
    ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);

    ctx.strokeStyle = '#7a4a38';
    ctx.lineWidth = 2;
    const n = Math.max(2, Math.round((pw * ph) / 700));
    for (let i = 0; i < n; i++) {
      const tx = px + 8 + (i * 29) % Math.max(8, pw - 16);
      const ty = py + 8 + (i * 47) % Math.max(8, ph - 16);
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    this._drawDoor(ctx, b, ts, '#5a2d1d');
  }

  /** Parks: green with diagonal paths, trees, and a pond. */
  _drawPark(ctx, b, px, py, pw, ph, ts) {
    ctx.fillStyle = PALETTE.park;
    ctx.fillRect(px, py, pw, ph);

    ctx.strokeStyle = PALETTE.parkPath;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px + 4, py + 4);
    ctx.lineTo(px + pw - 4, py + ph - 4);
    ctx.moveTo(px + pw - 4, py + 4);
    ctx.lineTo(px + 4, py + ph - 4);
    ctx.stroke();

    const n = Math.max(2, Math.round((pw * ph) / 900));
    for (let i = 0; i < n; i++) {
      const tx = px + 8 + (i * 41) % Math.max(8, pw - 16);
      const ty = py + 8 + (i * 67) % Math.max(8, ph - 16);
      ctx.fillStyle = shade(PALETTE.tree, 0.85 + prand(b.detailSeed, i) * 0.3);
      ctx.beginPath();
      ctx.arc(tx, ty, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = PALETTE.pond;
    ctx.beginPath();
    ctx.arc(px + pw * 0.25, py + ph * 0.25, Math.min(pw, ph) * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Windows --------------------------------------------------------------

  /**
   * Window rects (world px) for a building, shared by the day art and the
   * night glow layer so they align exactly.
   */
  _windowsFor(b) {
    const fp = b.footprint;
    const px = fp.x * TS;
    const py = fp.y * TS;
    const pw = fp.w * TS;
    const ph = fp.h * TS;
    const wins = [];

    if (b.zone === 'workplace') {
      const cols = Math.max(2, Math.floor((pw - 8) / 12));
      const rows = Math.max(2, Math.floor((ph - 8) / 12));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          wins.push({ x: px + 5 + c * 12, y: py + 5 + r * 12, w: 6, h: 6 });
        }
      }
    } else if (b.zone === 'residential') {
      const n = Math.max(1, Math.round((pw * ph) / 900));
      for (let i = 0; i < n; i++) {
        wins.push({
          x: px + 6 + (i * 37) % Math.max(6, pw - 14),
          y: py + 6 + (i * 53) % Math.max(6, ph - 14),
          w: 5,
          h: 5,
        });
      }
    } else if (b.zone === 'service' && b.subType !== 'park') {
      // Storefront window band along the door edge.
      const d = b.door;
      const horizontal = d.y === fp.y || d.y === fp.y + fp.h - 1;
      const n = Math.max(2, Math.floor((horizontal ? pw : ph) / 14));
      for (let i = 0; i < n; i++) {
        if (horizontal) {
          wins.push({ x: px + 6 + i * 14, y: py + ph / 2 - 3, w: 6, h: 6 });
        } else {
          wins.push({ x: px + pw / 2 - 3, y: py + 6 + i * 14, w: 6, h: 6 });
        }
      }
    }

    return wins;
  }

  // --- Night layer ----------------------------------------------------------

  _drawNightWindows(nctx) {
    for (const b of this.world.buildings) {
      if (b.zone === 'park') {
        this._drawParkLamps(nctx, b);
        continue;
      }
      if (b.zone === 'entertainment') {
        this._drawVenueGlow(nctx, b);
        continue;
      }

      const wins = this._windowsFor(b);
      let lit = wins;
      if (b.zone === 'residential') {
        lit = wins.filter((_, i) => prand(b.detailSeed, i) < 0.55);
      }

      for (const w of lit) {
        nctx.fillStyle = rgba(PALETTE.windowGlow, 0.5);
        nctx.fillRect(w.x - 2, w.y - 2, w.w + 4, w.h + 4);
        nctx.fillStyle = PALETTE.windowGlow;
        nctx.fillRect(w.x, w.y, w.w, w.h);
      }
    }
  }

  _drawVenueGlow(nctx, b) {
    const fp = b.footprint;
    const cx = fp.x * TS + (fp.w * TS) / 2;
    const cy = fp.y * TS + (fp.h * TS) / 2;
    const r = Math.min(fp.w, fp.h) * TS;
    nctx.fillStyle = rgba(PALETTE.marquee, 0.4);
    nctx.beginPath();
    nctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
    nctx.fill();
    nctx.fillStyle = PALETTE.marquee;
    nctx.beginPath();
    nctx.arc(cx, cy, r * 0.12, 0, Math.PI * 2);
    nctx.fill();
  }

  _drawParkLamps(nctx, b) {
    const fp = b.footprint;
    const ts = this.world.tileSize;
    const n = Math.max(2, Math.round((fp.w * fp.h) / 8));
    for (let i = 0; i < n; i++) {
      const lx = fp.x * ts + 10 + (i * 53) % Math.max(6, fp.w * ts - 20);
      const ly = fp.y * ts + 10 + (i * 71) % Math.max(6, fp.h * ts - 20);
      nctx.fillStyle = 'rgba(255,214,150,0.4)';
      nctx.beginPath();
      nctx.arc(lx, ly, 10, 0, Math.PI * 2);
      nctx.fill();
      nctx.fillStyle = '#fff0c0';
      nctx.beginPath();
      nctx.arc(lx, ly, 3, 0, Math.PI * 2);
      nctx.fill();
    }
  }

  /** Day-layer streetlight posts at road-lattice intersections. */
  _drawStreetPosts(ctx) {
    const spacing = this.config.ROAD_SPACING;
    const ts = this.world.tileSize;
    const gs = this.world.gridSize;
    ctx.fillStyle = PALETTE.lamp;
    for (let gy = spacing; gy < gs; gy += spacing) {
      for (let gx = spacing; gx < gs; gx += spacing) {
        const cx = gx * ts + ts / 2;
        const cy = gy * ts + ts / 2;
        ctx.fillRect(cx - 2, cy - 2, 4, 4);
      }
    }
  }

  /** Night-layer warm lamp glows at road-lattice intersections. */
  _drawNightLamps(nctx) {
    const spacing = this.config.ROAD_SPACING;
    const ts = this.world.tileSize;
    const gs = this.world.gridSize;
    for (let gy = spacing; gy < gs; gy += spacing) {
      for (let gx = spacing; gx < gs; gx += spacing) {
        const cx = gx * ts + ts / 2;
        const cy = gy * ts + ts / 2;
        nctx.fillStyle = 'rgba(255,214,150,0.35)';
        nctx.beginPath();
        nctx.arc(cx, cy, 16, 0, Math.PI * 2);
        nctx.fill();
        nctx.fillStyle = '#fff0c0';
        nctx.beginPath();
        nctx.arc(cx, cy, 4, 0, Math.PI * 2);
        nctx.fill();
      }
    }
  }
}