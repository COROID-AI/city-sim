/**
 * Renderer — layered Canvas 2D renderer for the generated city (spec §3.3, §6.1).
 *
 * Layer order per frame: ground → roads → buildings.
 *
 * KEY DECISIONS (see plan notes):
 *  - SPEC PALETTE OVER DEF COLOR: ZONE_COLORS holds the spec §6.1 hex values
 *    and buildings are colored by `building.zone`, NOT `building.def.color`.
 *    BuildingPlacer's def colors are gameplay/economy-oriented and differ from
 *    the art spec; the acceptance criteria assert the exact spec hex values.
 *  - CAMERA-FORWARD DESIGN: an optional camera {x,y,zoom} is accepted now
 *    (identity default) so the downstream Camera task can inject pan/zoom
 *    without modifying this class. applyCameraTransform() does translate+scale
 *    inside save/restore.
 *  - DEPTH SORT KEY: buildings are sorted by (y + height) — the south/bottom
 *    edge — so a 3-tall building at y=5 correctly draws behind a 1-tall
 *    building at y=6 (painter's algorithm).
 *  - CANVAS 2D ONLY: no WebGL, no sprites, no external rendering deps.
 */
import type { Building, ZoneType } from './types';
import { TILE_SIZE, World } from './World';

/** Spec §6.1 zone → render color map. */
export const ZONE_COLORS: Record<ZoneType, string> = {
  residential: '#7cb342',
  commercial: '#42a5f5',
  industrial: '#8d6e63',
  entertainment: '#ab47bc',
  park: '#7ec850',
};

/** Spec §3.3 ground / road palette. */
const GROUND_COLOR = '#e8e0d5';
const ROAD_SURFACE = '#4a4a4a';
const ROAD_CENTER_LINE = '#ffffff';
const SIDEWALK_COLOR = '#c0b8ae';

/** Sidewalk border thickness in world pixels (per road tile edge). */
const SIDEWALK_INSET = 2;
/** Center-line thickness in world pixels. */
const CENTER_LINE_THICKNESS = 1;

/** Optional camera transform injected by the downstream Camera system. */
export interface CameraTransform {
  /** Pan offset in world pixels applied as translate(-x, -y). */
  x: number;
  /** Pan offset in world pixels applied as translate(-x, -y). */
  y: number;
  /** Zoom scale factor (1 = identity). */
  zoom: number;
}

export interface RendererOptions {
  /** Optional camera; defaults to identity (no pan/zoom). */
  camera?: CameraTransform;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly world: World;
  private camera: CameraTransform;

  constructor(
    ctx: CanvasRenderingContext2D,
    world: World,
    options: RendererOptions = {},
  ) {
    this.ctx = ctx;
    this.world = world;
    this.camera = options.camera ?? { x: 0, y: 0, zoom: 1 };
  }

  /** Update the active camera transform (used by the downstream Camera task). */
  setCamera(camera: CameraTransform): void {
    this.camera = camera;
  }

  /**
   * Full frame render. Matches GameLoop's RenderCallback signature so it can be
   * wired directly as `render: (alpha) => renderer.render(alpha)`.
   *
   * `alpha` is the interpolation fraction [0..1]; unused for static geometry
   * but reserved for future interpolated entity positions (vehicles/citizens).
   */
  render(_alpha: number): void {
    const { ctx } = this;
    ctx.save();
    this.applyCameraTransform();

    // Layer order (spec §3.3): ground → roads → buildings.
    this.drawGround();
    this.drawRoads();
    this.drawBuildings();

    ctx.restore();
  }

  /** Fill the entire world rectangle with the beige ground color. */
  drawGround(): void {
    const { ctx, world } = this;
    const w = world.width * TILE_SIZE;
    const h = world.height * TILE_SIZE;
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Draw the road network: for every road tile, a dark-grey surface with a
   * light sidewalk border and a white center line. Per-tile rendering keeps
   * the geometry deterministic and makes sidewalks/center lines straightforward.
   */
  drawRoads(): void {
    const { ctx, world } = this;
    world.grid.forEach((tile) => {
      if (tile.type !== 'road') return;
      const px = tile.x * TILE_SIZE;
      const py = tile.y * TILE_SIZE;

      // Sidewalk border (light) fills the full tile.
      ctx.fillStyle = SIDEWALK_COLOR;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      // Road surface inset by the sidewalk border.
      ctx.fillStyle = ROAD_SURFACE;
      ctx.fillRect(
        px + SIDEWALK_INSET,
        py + SIDEWALK_INSET,
        TILE_SIZE - SIDEWALK_INSET * 2,
        TILE_SIZE - SIDEWALK_INSET * 2,
      );

      // White center line down the middle of the tile.
      ctx.fillStyle = ROAD_CENTER_LINE;
      const clOffset = (TILE_SIZE - CENTER_LINE_THICKNESS) / 2;
      ctx.fillRect(px + clOffset, py, CENTER_LINE_THICKNESS, TILE_SIZE);
    });
  }

  /**
   * Draw all buildings as colored rectangles, depth-sorted by south edge
   * (y + height) ascending so lower-Y buildings render first (painter's).
   * Color comes from ZONE_COLORS keyed by `building.zone`, NOT def.color.
   */
  drawBuildings(): void {
    const { ctx, world } = this;
    const buildings = Array.from(world.buildings.values());
    // Painter's algorithm: sort by south edge (y + height) ascending.
    const sorted = this.sortByDepth(buildings);

    for (const building of sorted) {
      const color = ZONE_COLORS[building.zone] ?? building.def.color;
      ctx.fillStyle = color;
      ctx.fillRect(
        building.x * TILE_SIZE,
        building.y * TILE_SIZE,
        building.width * TILE_SIZE,
        building.height * TILE_SIZE,
      );
    }
  }

  /**
   * Return buildings sorted by south edge (y + height) ascending. Exposed for
   * unit testing the depth order without a canvas.
   */
  sortByDepth(buildings: Building[]): Building[] {
    return [...buildings].sort((a, b) => {
      const aSouth = a.y + a.height;
      const bSouth = b.y + b.height;
      if (aSouth !== bSouth) return aSouth - bSouth;
      // Stable tiebreak by x then id for deterministic output.
      if (a.x !== b.x) return a.x - b.x;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  /** Apply the current camera translate+scale inside the active save/restore. */
  private applyCameraTransform(): void {
    const { ctx, camera } = this;
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
  }
}
