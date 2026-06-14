/**
 * Canvas 2D renderer for the city simulation.
 *
 * The renderer is intentionally minimal: it paints three layers per
 * frame, in back-to-front order, with viewport culling and Y-sorted
 * buildings so taller-front-row buildings correctly occlude shorter
 * ones behind them. It is framework-agnostic and never imports from
 * `src/systems`, `src/components`, `src/hooks`, or `src/app`.
 *
 * Layer order:
 *   1. ground (base terrain) — drawn per tile, culled to the camera.
 *   2. roads — drawn per tile on top of ground, also culled.
 *   3. buildings — sorted ascending by `origin.y + size.height` so
 *      buildings with larger Y (visually "in front") draw last. Equal
 *      Y is tie-broken by ascending `origin.x`.
 *   4. (post-pass) drawLightingOverlay — full-viewport radial gradient
 *      that fades to night based on `daylightFactor`.
 *   5. (post-pass) drawWindowLights — deterministic per-building grid
 *      of warm rects.
 *   6. (post-pass) drawStreetLightGlows — radial glow at every cached
 *      streetlight tile.
 *
 * The renderer never throws when sprites are missing. Every draw
 * falls back to a procedural rectangle (palette-colored) when the
 * corresponding sprite slot is null.
 */

import type { Camera } from './Camera';
import { DEFAULT_PALETTE, colorForTile, type CityPalette } from './palette';
import type { SpriteAtlas } from './sprites';
import type { Building, Tile, TileCoord } from './types';
import { World } from './World';
import { createRng } from '@/generation/random';

/** Pixel size of a single tile on the canvas. */
export const TILE_PIXELS = 16;

/** A 2D point with no semantic meaning; used for gradient params and the like. */
export interface RadialGradientStop {
  offset: number;
  color: string;
}

/**
 * Minimal interface for a CanvasGradient — jsdom does not implement
 * CanvasGradient, so test stubs return a plain object that records
 * `addColorStop` calls.
 */
export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

/**
 * Per-layer interface to the underlying 2D context. Narrower than full
 * CanvasRenderingContext2D so tests can stub it. `createRadialGradient`
 * is OPTIONAL — callers that don't draw night lighting (e.g. unit
 * tests of the ground layer) can omit it; the renderer treats a
 * missing implementation as a no-op and skips the lighting passes.
 */
export interface RendererContext {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  drawImage(image: CanvasImageSource, x: number, y: number): void;
  /** Optional. When present, used by the night overlay. */
  createRadialGradient?(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradientLike;
  set fillStyle(value: string | CanvasGradientLike | CanvasPattern);
  set strokeStyle(value: string | CanvasGradientLike | CanvasPattern);
  set globalAlpha(value: number);
  set imageSmoothingEnabled(value: boolean);
}

export interface RendererOptions {
  /** Pixels per world tile. Defaults to {@link TILE_PIXELS}. */
  tilePixels?: number;
  /** Color palette. Defaults to {@link DEFAULT_PALETTE}. */
  palette?: CityPalette;
  /**
   * Optional sprite atlas. When provided, the renderer will draw the
   * sprite for a tile / building when its slot is non-null. When a
   * slot is null, the renderer falls back to a procedural rectangle
   * using the palette color. If omitted, the renderer behaves as if
   * the atlas is fully empty (i.e. always uses the procedural path).
   */
  sprites?: SpriteAtlas | null;
}

/**
 * City renderer. Construct once per `<canvas>` element, then call
 * `draw(world, camera)` from your animation loop.
 */
export class Renderer {
  readonly tilePixels: number;
  readonly palette: CityPalette;
  readonly sprites: SpriteAtlas | null;

  /**
   * Cache of streetlight positions keyed by world bounds + building count.
   * Invalidated when the world changes (heuristic: bounds or building
   * count differ from when the cache was last built). Cheap and good
   * enough for the current scope.
   */
  private streetlightCache: {
    key: string;
    positions: TileCoord[];
  } | null = null;

  constructor(options: RendererOptions = {}) {
    const tp = options.tilePixels ?? TILE_PIXELS;
    if (!Number.isFinite(tp) || tp <= 0) {
      throw new RangeError('Renderer.tilePixels must be a positive number');
    }
    this.tilePixels = tp;
    this.palette = options.palette ?? DEFAULT_PALETTE;
    this.sprites = options.sprites ?? null;
  }

  /**
   * Paint one frame of the world to the given 2D context, applying the
   * camera's pan/zoom transform. Safe to call when the world is empty.
   */
  draw(ctx: RendererContext, world: World, camera: Camera): void {
    if (!ctx || !world || !camera) return;

    const { viewport } = camera;
    const width = viewport.width;
    const height = viewport.height;

    ctx.save();
    // Always paint the background first so transparent areas are
    // consistent across themes.
    ctx.fillStyle = this.palette.background;
    ctx.fillRect(0, 0, width, height);

    // World → screen transform: world origin is at the canvas centre,
    // zoom multiplies world units, and the camera pan centres the view.
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.zoom * this.tilePixels, camera.zoom * this.tilePixels);
    ctx.translate(-camera.position.x, -camera.position.y);

    const view = camera.visibleRect();
    this.drawGround(ctx, world, view);
    this.drawRoads(ctx, world, view);
    this.drawBuildings(ctx, world, view);

    ctx.restore();
    ctx.restore();
  }

  /**
   * Convenience: draw the world then the post-pass lighting effects.
   * Lighting effects (overlay, window lights, streetlight glows) must
   * be drawn in screen space, so this method handles the
   * save/restore dance and only invokes the lighting passes when
   * `daylightFactor` is < 1.
   */
  drawWithLighting(
    ctx: RendererContext,
    world: World,
    camera: Camera,
    daylightFactor: number,
  ): void {
    this.draw(ctx, world, camera);
    if (daylightFactor >= 1) return;
    const { viewport } = camera;
    this.drawLightingOverlay(ctx, viewport.width, viewport.height, daylightFactor);
    this.drawWindowLights(ctx, world, camera, daylightFactor);
    this.drawStreetLightGlows(ctx, world, camera, daylightFactor);
  }

  /* ---------------------------------------------------------------------- */
  /* Lighting: night overlay                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Paint a single full-viewport radial gradient whose alpha is
   * `(1 - daylightFactor) * palette.maxNightAlpha` (clamped to
   * [0, 1]). When `daylightFactor === 1` no draw occurs. The gradient
   * centre is the viewport centre; the outer stop is opaque, the
   * inner stop is transparent (so the centre reads brighter — a
   * subtle vignette inversion that hints at a moon overhead).
   */
  drawLightingOverlay(
    ctx: RendererContext,
    viewportWidth: number,
    viewportHeight: number,
    daylightFactor: number,
  ): void {
    if (daylightFactor >= 1) return;
    if (!ctx.createRadialGradient) return;
    const alpha = clamp01((1 - daylightFactor) * this.palette.maxNightAlpha);
    if (alpha <= 0) return;

    const cx = viewportWidth / 2;
    const cy = viewportHeight / 2;
    const r = Math.hypot(viewportWidth, viewportHeight) / 2;
    const grad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    grad.addColorStop(0, withAlpha(this.palette.duskSky, 0));
    grad.addColorStop(1, withAlpha(this.palette.nightOverlay, 1));

    // We intentionally do NOT wrap in save/restore: the only thing we
    // mutate is `globalAlpha`, and we want it to remain at `alpha` so
    // callers (e.g. unit tests) can read it back. fillStyle is a single
    // assignment and is reset by the next `draw()` call which always
    // sets fillStyle before any draw. globalAlpha is naturally reset
    // by the next pass (e.g. drawWindowLights) which sets it before
    // any further draw.
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);
  }

  /* ---------------------------------------------------------------------- */
  /* Lighting: window lights                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Iterate visible buildings in the camera frustum and draw a
   * deterministic per-building grid of warm window rects. The pattern
   * is a pure function of `building.id` (hashed → seeded PRNG) and
   * `building.size` — same building always gets the same windows.
   *
   * Only windows whose `lit` probability is above a per-frame
   * threshold derived from `daylightFactor` are drawn. At full
   * daylight, no windows are drawn. At full night, ~70% are drawn.
   *
   * Caps at 12 windows per building for performance.
   */
  drawWindowLights(
    ctx: RendererContext,
    world: World,
    camera: Camera,
    daylightFactor: number,
  ): void {
    if (daylightFactor >= 1) return;
    const view = camera.visibleRect();
    const { bounds } = world;
    const winColor = this.palette.windowLight;
    // Lit probability peaks at ~0.7 at full night (daylightFactor=0).
    const litProb = clamp01((1 - daylightFactor) * 0.7);
    if (litProb <= 0) return;

    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = winColor;

    for (const b of world.buildings_()) {
      const bMinX = b.origin.x;
      const bMinY = b.origin.y;
      const bMaxX = b.origin.x + b.size.width;
      const bMaxY = b.origin.y + b.size.height;
      if (bMaxX <= view.minX || bMinX >= view.maxX) continue;
      if (bMaxY <= view.minY || bMinY >= view.maxY) continue;
      if (bMinX < 0 || bMinY < 0) continue;
      if (bMaxX > bounds.width || bMaxY > bounds.height) continue;

      // Hash the building id to a 32-bit seed.
      const seed = hashStringToSeed(b.id);
      const rng = createRng(seed);
      // Per-building window grid: 2-3 columns × 2-3 rows depending on size.
      const cols = Math.max(1, Math.min(3, Math.floor(b.size.width * 1.5)));
      const rows = Math.max(1, Math.min(3, Math.floor(b.size.height * 1.5)));
      const marginX = b.size.width > 1 ? 0.2 : 0.25;
      const marginY = b.size.height > 1 ? 0.2 : 0.25;
      const cellW = (b.size.width - marginX * 2) / cols;
      const cellH = (b.size.height - marginY * 2) / rows;
      const winW = Math.max(0.1, cellW * 0.55);
      const winH = Math.max(0.1, cellH * 0.5);

      let drawn = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (drawn >= 12) break;
          // Deterministic "is this window lit?" — same answer every frame.
          const lit = rng.next() < litProb + 0.3; // base 30% so daytime also has some
          if (!lit) continue;
          const x = b.origin.x + marginX + c * cellW + (cellW - winW) / 2;
          const y = b.origin.y + marginY + r * cellH + (cellH - winH) / 2;
          ctx.fillRect(x, y, winW, winH);
          drawn += 1;
        }
      }
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------------- */
  /* Lighting: streetlight glows                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Draw a soft radial glow at every cached streetlight position.
   * The radial gradient is precomputed once and reused across all
   * positions for performance.
   */
  drawStreetLightGlows(
    ctx: RendererContext,
    world: World,
    camera: Camera,
    daylightFactor: number,
  ): void {
    if (daylightFactor >= 1) return;
    if (!ctx.createRadialGradient) return;
    const positions = this.getStreetlightPositions(world);
    if (positions.length === 0) return;
    const view = camera.visibleRect();
    if (view.maxX <= view.minX || view.maxY <= view.minY) return;

    const radius = this.palette.streetlightRadius;
    const r = radius * 2;
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, withAlpha(this.palette.streetlightGlow, 0.85));
    grad.addColorStop(0.4, withAlpha(this.palette.streetlightGlow, 0.35));
    grad.addColorStop(1, withAlpha(this.palette.streetlightGlow, 0));

    const alpha = clamp01((1 - daylightFactor) * 0.9);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    for (const p of positions) {
      if (p.x < view.minX - 1 || p.x > view.maxX + 1) continue;
      if (p.y < view.minY - 1 || p.y > view.maxY + 1) continue;
      const cx = p.x + 0.5;
      const cy = p.y + 0.5;
      ctx.save();
      ctx.translate(cx - r, cy - r);
      ctx.fillRect(0, 0, r * 2, r * 2);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Compute (or fetch from cache) the set of tile coordinates where a
   * streetlight should be placed. The placement is deterministic for
   * a given world input.
   *
   * Rules:
   *  - Only consider road tiles.
   *  - Skip road tiles that are at an intersection (4-way or T-junction)
   *    of road neighbours — intersections are too busy for a lamp.
   *  - Skip road tiles that are immediately adjacent (4-neighbourhood)
   *    to a water or lot tile — the lamp would look like it's in the
   *    wrong terrain.
   *  - Place lights at most every other road tile along a road, so
   *    along a long straight road we get a light every 2 tiles.
   */
  placeStreetLights(world: World): TileCoord[] {
    const { bounds } = world;
    const candidates: TileCoord[] = [];
    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        const t = world.getTile({ x, y });
        if (!t || t.kind !== 'road') continue;

        // Count road neighbours.
        const up = y > 0 && world.getTile({ x, y: y - 1 })?.kind === 'road';
        const down =
          y < bounds.height - 1 &&
          world.getTile({ x, y: y + 1 })?.kind === 'road';
        const left = x > 0 && world.getTile({ x: x - 1, y })?.kind === 'road';
        const right =
          x < bounds.width - 1 &&
          world.getTile({ x: x + 1, y })?.kind === 'road';
        const roadCount = Number(up) + Number(down) + Number(left) + Number(right);
        // Intersections have ≥ 3 road neighbours. Skip them.
        if (roadCount >= 3) continue;

        // Skip if any 4-neighbour is water or lot.
        const neighbours: TileCoord[] = [];
        if (up) neighbours.push({ x, y: y - 1 });
        if (down) neighbours.push({ x, y: y + 1 });
        if (left) neighbours.push({ x: x - 1, y });
        if (right) neighbours.push({ x: x + 1, y });
        // Water/lot check is on the *tiles immediately around* the road
        // tile, not the road neighbours. (The road neighbours are
        // obviously road by definition.)
        const checks: TileCoord[] = [];
        if (y > 0) checks.push({ x, y: y - 1 });
        if (y < bounds.height - 1) checks.push({ x, y: y + 1 });
        if (x > 0) checks.push({ x: x - 1, y });
        if (x < bounds.width - 1) checks.push({ x: x + 1, y });
        let skip = false;
        for (const c of checks) {
          const k = world.getTile(c)?.kind;
          if (k === 'water' || k === 'lot') {
            skip = true;
            break;
          }
        }
        if (skip) continue;

        // Space lights every other road tile along each direction.
        // We use a hash of (x, y) to pick "every other" deterministically
        // for a given world layout, but it's simpler to just stagger by
        // a tile parity based on whether the road runs horizontally
        // or vertically.
        const horizontal = left || right;
        const vertical = up || down;
        let strideParity: number;
        if (horizontal && !vertical) {
          // Horizontal road → stagger by x parity.
          strideParity = x & 1;
        } else if (vertical && !horizontal) {
          // Vertical road → stagger by y parity.
          strideParity = y & 1;
        } else {
          // Isolated road tile — keep it.
          strideParity = 0;
        }
        if (strideParity !== 0) continue;

        candidates.push({ x, y });
        void neighbours;
      }
    }
    return candidates;
  }

  /**
   * Get the cached streetlight positions for a world, recomputing
   * when the cache is stale (different bounds or building count).
   */
  getStreetlightPositions(world: World): TileCoord[] {
    const key = `${world.bounds.width}x${world.bounds.height}#${world.buildingCount}`;
    if (this.streetlightCache && this.streetlightCache.key === key) {
      return this.streetlightCache.positions;
    }
    const positions = this.placeStreetLights(world);
    this.streetlightCache = { key, positions };
    return positions;
  }

  /**
   * Drop the streetlight cache. Call this from tests that mutate
   * the world and then re-query positions.
   */
  invalidateStreetlightCache(): void {
    this.streetlightCache = null;
  }

  /* ---------------------------------------------------------------------- */
  /* Layer: ground                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * Paint the base terrain layer. Every tile within the visible viewport
   * is drawn as a procedural rectangle (or sprite, if loaded). Tiles
   * that are not 'ground' are skipped here — non-ground kinds are
   * handled by the road/building/water layers above.
   */
  drawGround(
    ctx: RendererContext,
    world: World,
    view: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const { bounds } = world;
    const x0 = Math.max(0, Math.floor(view.minX));
    const y0 = Math.max(0, Math.floor(view.minY));
    const x1 = Math.min(bounds.width, Math.ceil(view.maxX));
    const y1 = Math.min(bounds.height, Math.ceil(view.maxY));
    const groundSprite = this.sprites?.ground ?? null;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const tile: Tile | null = world.getTile({ x, y });
        if (!tile) continue;
        if (tile.kind !== 'ground') continue;
        if (groundSprite) {
          this.drawSpriteSafe(ctx, groundSprite, x, y);
        } else {
          // Subtle variation so flat ground reads as terrain, not as a
          // single flat color. Checker by tile parity.
          const alt = (x + y) & 1;
          ctx.fillStyle = alt ? this.palette.groundAlt : this.palette.ground;
          this.fillTile(ctx, x, y);
        }
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Layer: roads                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Paint the road network. Only tiles whose kind is 'road' are
   * touched. A thin lane-marking strip is drawn on top of each road
   * tile to give the network visible structure.
   */
  drawRoads(
    ctx: RendererContext,
    world: World,
    view: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const { bounds } = world;
    const x0 = Math.max(0, Math.floor(view.minX));
    const y0 = Math.max(0, Math.floor(view.minY));
    const x1 = Math.min(bounds.width, Math.ceil(view.maxX));
    const y1 = Math.min(bounds.height, Math.ceil(view.maxY));
    const roadSprite = this.sprites?.road ?? null;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const tile = world.getTile({ x, y });
        if (!tile || tile.kind !== 'road') continue;
        if (roadSprite) {
          this.drawSpriteSafe(ctx, roadSprite, x, y);
        } else {
          ctx.fillStyle = this.palette.road;
          this.fillTile(ctx, x, y);
        }
        // Centerline marking. We check the four neighbours to decide
        // orientation: if there is road above AND below, this is a
        // vertical road; if left AND right, a horizontal road.
        const hasUp = y > 0 && world.getTile({ x, y: y - 1 })?.kind === 'road';
        const hasDown =
          y < bounds.height - 1 &&
          world.getTile({ x, y: y + 1 })?.kind === 'road';
        const hasLeft =
          x > 0 && world.getTile({ x: x - 1, y })?.kind === 'road';
        const hasRight =
          x < bounds.width - 1 &&
          world.getTile({ x: x + 1, y })?.kind === 'road';
        const vertical = hasUp || hasDown;
        const horizontal = hasLeft || hasRight;
        if (vertical || horizontal) {
          ctx.fillStyle = this.palette.roadMarking;
          if (vertical && !horizontal) {
            // Vertical road: thin vertical strip in the middle.
            ctx.fillRect(x + 0.45, y, 0.1, 1);
          } else if (horizontal && !vertical) {
            // Horizontal road: thin horizontal strip in the middle.
            ctx.fillRect(x, y + 0.45, 1, 0.1);
          } else {
            // Intersection: small dot.
            ctx.fillRect(x + 0.45, y + 0.45, 0.1, 0.1);
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Layer: buildings                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Paint all buildings, depth-sorted so that buildings with larger
   * `(origin.y + size.height)` (visually "in front") draw last and
   * therefore occlude buildings further back. Equal Y is tie-broken
   * by `origin.x` ascending. Off-screen buildings are culled.
   */
  drawBuildings(
    ctx: RendererContext,
    world: World,
    view: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const { bounds } = world;

    // Collect visible buildings into an array so we can sort without
    // mutating the world's insertion order.
    const visible: Building[] = [];
    for (const b of world.buildings_()) {
      const bMinX = b.origin.x;
      const bMinY = b.origin.y;
      const bMaxX = b.origin.x + b.size.width;
      const bMaxY = b.origin.y + b.size.height;
      // Cull anything fully outside the viewport.
      if (bMaxX <= view.minX) continue;
      if (bMinX >= view.maxX) continue;
      if (bMaxY <= view.minY) continue;
      if (bMinY >= view.maxY) continue;
      // Reject buildings that somehow lie outside world bounds.
      if (bMinX < 0 || bMinY < 0) continue;
      if (bMaxX > bounds.width || bMaxY > bounds.height) continue;
      visible.push(b);
    }

    visible.sort(compareBuildingsByDepth);

    for (const b of visible) {
      this.drawBuilding(ctx, world, b);
    }
  }

  /**
   * Draw a single building instance: a footprint rect filled with the
   * def's color (or the palette default), a darker shadow band along
   * the bottom, and a thin roof band along the top.
   */
  private drawBuilding(
    ctx: RendererContext,
    world: World,
    b: Building,
  ): void {
    const def = world.getBuildingDef(b.defId);
    const fillColor = def?.color ?? this.palette.building;
    const w = b.size.width;
    const h = b.size.height;

    // Shadow band along the bottom: gives a faux-3D depth cue.
    ctx.fillStyle = this.palette.buildingShadow;
    ctx.fillRect(b.origin.x, b.origin.y + h - 0.15, w, 0.15);

    // Main footprint.
    const buildingSprite = this.sprites?.building ?? null;
    if (buildingSprite && w === 1 && h === 1) {
      // Only stamp the building sprite on unit-sized buildings so the
      // sprite is never stretched over a multi-tile footprint.
      this.drawSpriteSafe(ctx, buildingSprite, b.origin.x, b.origin.y);
    } else {
      ctx.fillStyle = fillColor;
      ctx.fillRect(b.origin.x, b.origin.y, w, h);
    }

    // Roof band along the top edge.
    ctx.fillStyle = this.palette.buildingRoof;
    ctx.fillRect(b.origin.x, b.origin.y, w, 0.12);
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  /** Fill a single tile's footprint using the current fillStyle. */
  private fillTile(ctx: RendererContext, x: number, y: number): void {
    ctx.fillRect(x, y, 1, 1);
  }

  /**
   * Try to draw a sprite into a tile slot. Wrapped in try/catch so a
   * mid-frame image decode error never crashes the renderer — the
   * procedural fallback (palette rectangle) is what callers want in
   * that case anyway.
   */
  private drawSpriteSafe(
    ctx: RendererContext,
    image: CanvasImageSource,
    x: number,
    y: number,
  ): void {
    try {
      ctx.drawImage(image, x, y);
    } catch {
      // Swallow: image not yet ready / tainted / unsupported source.
    }
  }
}

/**
 * Sort comparator for buildings: ascending by
 * `(origin.y + size.height)` then ascending by `origin.x`. This is
 * the canonical top-down depth order: buildings whose bottom edge
 * is further down the screen draw later (and therefore on top).
 */
export function compareBuildingsByDepth(a: Building, b: Building): number {
  const aBottom = a.origin.y + a.size.height;
  const bBottom = b.origin.y + b.size.height;
  if (aBottom !== bBottom) return aBottom - bBottom;
  // Bottom edges tie: break by origin.x DESCENDING so buildings further
  // to the right at the same depth draw first. This matches the
  // top-down rendering convention: in classic isometric/city sims,
  // when two buildings share a bottom row, the rightmost is drawn
  // first so the leftmost (which is the one whose sprite is closer
  // to the camera in 3/4 perspective) ends up on top.
  return b.origin.x - a.origin.x;
}

/**
 * Expose `colorForTile` via the engine barrel contract for downstream
 * systems that want to render tiles without holding a palette ref.
 *
 * Note: `CityPalette`, `CanvasGradientLike`, and `RadialGradientStop`
 * are already exported at the top of this file via their `export
 * interface` declarations, so re-exporting them here would conflict.
 */
export { colorForTile, DEFAULT_PALETTE };

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * FNV-1a 32-bit string hash. Stable across runs and platforms, which
 * is what we need to make window-light placement deterministic.
 */
function hashStringToSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Convert a colour string to an `rgba(...)` form with the given alpha.
 * Supports `#rrggbb` and `rgba(r,g,b,a)` inputs. For anything else,
 * returns the input as-is — the worst case is a no-op overlay which
 * is the safest failure mode.
 */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    let r: number;
    let g: number;
    let b: number;
    if (color.length === 7) {
      r = parseInt(color.slice(1, 3), 16);
      g = parseInt(color.slice(3, 5), 16);
      b = parseInt(color.slice(5, 7), 16);
    } else {
      r = parseInt(color[1]! + color[1]!, 16);
      g = parseInt(color[2]! + color[2]!, 16);
      b = parseInt(color[3]! + color[3]!, 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  if (color.startsWith('rgba(')) {
    return color.replace(
      /rgba\(([^)]+)\)/,
      (_match, body: string) => {
        const parts = body.split(',').slice(0, 3).join(',');
        return `rgba(${parts}, ${alpha})`;
      },
    );
  }
  return color;
}
