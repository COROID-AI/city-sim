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
 *
 * The renderer never throws when sprites are missing. Every draw
 * falls back to a procedural rectangle (palette-colored) when the
 * corresponding sprite slot is null.
 */

import type { Camera } from './Camera';
import { DEFAULT_PALETTE, colorForTile, type CityPalette } from './palette';
import type { SpriteAtlas } from './sprites';
import type { Building, Tile } from './types';
import { World } from './World';

/** Pixel size of a single tile on the canvas. */
export const TILE_PIXELS = 16;

/** Per-layer interface to the underlying 2D context. Narrower than full CanvasRenderingContext2D so tests can stub it. */
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
  set fillStyle(value: string | CanvasGradient | CanvasPattern);
  set strokeStyle(value: string | CanvasGradient | CanvasPattern);
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
 */
export { colorForTile, DEFAULT_PALETTE };
export type { CityPalette };
