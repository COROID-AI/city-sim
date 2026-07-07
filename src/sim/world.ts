/**
 * World creation and grid helpers.
 *
 * `createWorld` builds an empty city grid with no entities, ready for
 * population by the spawning systems.  `getDaylightFactor` maps the
 * simulation clock to a 0–1 brightness value used to tint the canvas
 * for the day/night cycle.
 */

import {
  GRID_WIDTH,
  GRID_HEIGHT,
  STARTING_BUDGET,
  HOURS_PER_DAY,
} from './constants';
import type { Terrain, Tile, Vec2, World, Zone } from './types';

// ─── Grid creation ───────────────────────────────────────────────────────────

/**
 * Build a flat array of tiles representing an empty grid.
 *
 * Every tile starts as `MIXED` zoning with no building.  The caller
 * (spawning systems) assigns zones and buildings later.
 */
export function createTiles(width: number, height: number): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push({
        x,
        y,
        zone: 'MIXED' as Zone,
        terrain: 'GRASS',
        buildingId: null,
      });
    }
  }
  return tiles;
}

// ─── World factory ───────────────────────────────────────────────────────────

/**
 * Create a fresh, empty {@link World} sized to the grid dimensions
 * defined in constants, with the starting treasury budget.
 *
 * Entity maps are empty — spawning systems populate them afterwards.
 *
 * @param width  Grid width  (defaults to {@link GRID_WIDTH}).
 * @param height Grid height (defaults to {@link GRID_HEIGHT}).
 */
export function createWorld(
  width: number = GRID_WIDTH,
  height: number = GRID_HEIGHT,
): World {
  return {
    width,
    height,
    tiles: createTiles(width, height),
    buildings: new Map(),
    citizens: new Map(),
    vehicles: new Map(),
    companies: new Map(),
    simTime: { elapsedHours: 0 },
    budget: STARTING_BUDGET,
  };
}

// ─── Grid accessors ──────────────────────────────────────────────────────────

/**
 * Return the tile at grid coordinates `(x, y)`, or `undefined` if the
 * coordinates are outside the world bounds.
 *
 * Tiles are stored row-major as `tiles[y * width + x]`.
 *
 * @param world  The world whose grid to query.
 * @param x      Column index (0-based).
 * @param y      Row index (0-based).
 */
export function tileAt(world: World, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) {
    return undefined;
  }
  return world.tiles[y * world.width + x];
}

/**
 * Return the tile at the grid position described by a {@link Vec2}.
 *
 * @param world    The world whose grid to query.
 * @param position The grid coordinates to look up.
 */
export function tileAtPos(world: World, position: Vec2): Tile | undefined {
  return tileAt(world, position.x, position.y);
}

/**
 * Check whether `(x, y)` is a valid, in-bounds grid cell.
 *
 * @param world The world whose grid to query.
 * @param x     Column index (0-based).
 * @param y     Row index (0-based).
 */
export function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.width && y < world.height;
}

/**
 * Set the terrain type of an in-bounds tile.
 *
 * Out-of-bounds coordinates are silently ignored.
 *
 * @param world   The world whose grid to mutate.
 * @param x       Column index (0-based).
 * @param y       Row index (0-based).
 * @param terrain The new surface type.
 */
export function setTerrain(
  world: World,
  x: number,
  y: number,
  terrain: Terrain,
): void {
  const tile = tileAt(world, x, y);
  if (tile) {
    tile.terrain = terrain;
  }
}

// ─── Daylight ────────────────────────────────────────────────────────────────

/** Hour at which full daylight is reached (noon reference). */
const NOON_HOUR = 12;

/**
 * Convert simulation time (elapsed hours) into a daylight factor in
 * `[0, 1]`.
 *
 *   - `1.0` at noon (brightest).
 *   - `0.0` at midnight (darkest).
 *
 * The curve is a smooth sinusoid over a 24-hour day so the day/night
 * gradient shifts visibly and continuously.
 *
 * @param elapsedHours Total elapsed sim-hours since start (fractional).
 */
export function getDaylightFactor(elapsedHours: number): number {
  const hourOfDay = ((elapsedHours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  // sin ranges [-1, 1]; shift to [0, 1].
  // At noon (hour 12) sin = 1 → factor 1.
  return (Math.sin(((hourOfDay - NOON_HOUR + 6) / HOURS_PER_DAY) * Math.PI * 2) + 1) / 2;
}
