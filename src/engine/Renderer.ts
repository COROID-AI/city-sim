/**
 * Canvas 2D renderer for the city simulation tilemap.
 *
 * Spec 6.1 visual palette: ground (#e8e0d5), roads (#4a4a4a with #ffffff
 * center line), sidewalks (#c0b8ae). All draw methods are pure — they accept a
 * `CanvasRenderingContext2D` and a `Grid` and produce deterministic output
 * without mutating any internal Renderer state. This makes them trivially
 * unit-testable with a mock context and reusable across multiple canvases.
 *
 * Z-order: ground → roads → sidewalks (ground is the background, roads sit on
 * top of ground, sidewalks border roads last).
 */

import type { Grid, Tile } from './Grid';
import { TILE_SIZE } from '@/lib/constants';

/**
 * Visual palette for the city renderer (spec 6.1).
 *
 * Exported as a single source of truth so UI, minimap, and other modules can
 * reference the same colors without hardcoding hex values.
 */
export const PALETTE = {
  /** Bare ground tile fill. */
  GROUND: '#e8e0d5',
  /** Road tile fill. */
  ROAD_FILL: '#4a4a4a',
  /** Road center line / lane marker. */
  ROAD_CENTER: '#ffffff',
  /** Sidewalk tile fill. */
  SIDEWALK: '#c0b8ae',
} as const;

/**
 * Minimal camera descriptor accepted by `Renderer.render`.
 *
 * Kept as a structural type (not a class) so Renderer stays decoupled from the
 * not-yet-implemented Camera module. The downstream Camera task can pass its
 * own state object directly.
 */
export interface Camera {
  /** World-space x offset (pixels). */
  x: number;
  /** World-space y offset (pixels). */
  y: number;
  /** Zoom multiplier (1 = no zoom). */
  zoom: number;
}

/**
 * Determines whether a road tile should render a horizontal center line.
 *
 * A road is horizontal when its east and/or west neighbor is also a road.
 * Vertical roads (north/south neighbors) and isolated roads default to
 * horizontal per the spec convention (roads run left-to-right).
 */
function isHorizontalRoad(grid: Grid, tile: Tile): boolean {
  const east = grid.getTile(tile.x + 1, tile.y);
  const west = grid.getTile(tile.x - 1, tile.y);
  const eastIsRoad = east !== null && east.type === 'road';
  const westIsRoad = west !== null && west.type === 'road';
  // Horizontal if either E or W neighbor is a road. Isolated roads (no road
  // neighbors at all) also default to horizontal.
  if (eastIsRoad || westIsRoad) return true;

  const north = grid.getTile(tile.x, tile.y - 1);
  const south = grid.getTile(tile.x, tile.y + 1);
  const northIsRoad = north !== null && north.type === 'road';
  const southIsRoad = south !== null && south.type === 'road';
  // If vertical neighbors exist, this is a vertical road → not horizontal.
  if (northIsRoad || southIsRoad) return false;

  // Isolated road tile: default to horizontal.
  return true;
}

/**
 * Pure canvas 2D renderer. Holds no internal state — every draw method takes
 * the context and grid as parameters.
 */
export class Renderer {
  /**
   * Fill every ground tile with the ground palette color.
   *
   * Iterates all tiles and fills those whose `type === 'ground'` at pixel
   * coordinates `(x*TILE_SIZE, y*TILE_SIZE, TILE_SIZE, TILE_SIZE)`.
   */
  drawGround(ctx: CanvasRenderingContext2D, grid: Grid): void {
    ctx.fillStyle = PALETTE.GROUND;
    for (let y = 0; y < grid.height; y++) {
      const row = grid.tiles[y];
      for (let x = 0; x < grid.width; x++) {
        const tile = row[x];
        if (tile.type === 'ground') {
          ctx.fillRect(
            x * TILE_SIZE,
            y * TILE_SIZE,
            TILE_SIZE,
            TILE_SIZE,
          );
        }
      }
    }
  }

  /**
   * Draw road tiles: #4a4a4a fill plus a #ffffff center line.
   *
   * The center line direction is inferred from the road's neighbors via
   * `grid.getTile`: a horizontal road (E/W neighbors are road) gets a
   * horizontal line; a vertical road (N/S neighbors are road) gets a vertical
   * line; an isolated road defaults to horizontal. Intersection tiles default
   * to horizontal (downstream task can add cross/T-junction rendering).
   */
  drawRoads(ctx: CanvasRenderingContext2D, grid: Grid): void {
    for (let y = 0; y < grid.height; y++) {
      const row = grid.tiles[y];
      for (let x = 0; x < grid.width; x++) {
        const tile = row[x];
        if (tile.type !== 'road') continue;

        const px = tile.x * TILE_SIZE;
        const py = tile.y * TILE_SIZE;

        // Road fill.
        ctx.fillStyle = PALETTE.ROAD_FILL;
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        // Center line.
        ctx.strokeStyle = PALETTE.ROAD_CENTER;
        ctx.beginPath();
        if (isHorizontalRoad(grid, tile)) {
          // Horizontal line through the vertical midpoint.
          ctx.moveTo(px, py + TILE_SIZE / 2);
          ctx.lineTo(px + TILE_SIZE, py + TILE_SIZE / 2);
        } else {
          // Vertical line through the horizontal midpoint.
          ctx.moveTo(px + TILE_SIZE / 2, py);
          ctx.lineTo(px + TILE_SIZE / 2, py + TILE_SIZE);
        }
        ctx.stroke();
      }
    }
  }

  /**
   * Draw sidewalk tiles. Stub — downstream task implements sidewalk rendering.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  drawSidewalks(ctx: CanvasRenderingContext2D, grid: Grid): void {
    // Intentional no-op: sidewalk rendering is deferred to a downstream task.
  }

  /**
   * Full render pass applying the camera transform and drawing all layers in
   * z-order: ground → roads → sidewalks.
   *
   * The camera transform is wrapped in `ctx.save()` / `ctx.restore()` so the
   * context state is untouched after rendering.
   */
  render(
    ctx: CanvasRenderingContext2D,
    grid: Grid,
    camera: Camera,
  ): void {
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    this.drawGround(ctx, grid);
    this.drawRoads(ctx, grid);
    this.drawSidewalks(ctx, grid);

    ctx.restore();
  }
}
