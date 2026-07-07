/**
 * Spatial query helpers for the city world.
 *
 * Provides utilities to look up buildings by location or kind, and to
 * find the nearest road tile to any grid position.
 */

import type { Rng } from './rng';
import { tileAt } from './world';
import type { Building, BuildingKind, Vec2, World } from './types';

// ─── Building lookups ────────────────────────────────────────────────────────

/**
 * Return the building occupying grid cell `(x, y)`, or `undefined` if
 * the cell is empty or out of bounds.
 *
 * @param world The world to query.
 * @param x     Column index (0-based).
 * @param y     Row index (0-based).
 */
export function getBuildingAt(
  world: World,
  x: number,
  y: number,
): Building | undefined {
  const tile = tileAt(world, x, y);
  if (!tile || tile.buildingId === null) return undefined;
  return world.buildings.get(tile.buildingId);
}

/**
 * Return a random building of the specified kind, or `undefined` if no
 * building of that kind exists.
 *
 * Selection uses the provided RNG for reproducibility.
 *
 * @param world The world to query.
 * @param kind  The desired building kind.
 * @param rng   Seeded RNG instance.
 */
export function randomBuildingOfKind(
  world: World,
  kind: BuildingKind,
  rng: Rng,
): Building | undefined {
  const candidates = Array.from(world.buildings.values()).filter(
    (b) => b.kind === kind,
  );
  if (candidates.length === 0) return undefined;
  return rng.pick(candidates);
}

// ─── Road proximity ──────────────────────────────────────────────────────────

/**
 * Find the nearest road tile to `(x, y)` using an expanding-ring
 * (Manhattan-distance) search.
 *
 * Returns `null` if no road tile exists anywhere in the world.
 *
 * @param world The world to search.
 * @param x     Column index (need not be a road tile).
 * @param y     Row index (need not be a road tile).
 */
export function nearestRoadTile(
  world: World,
  x: number,
  y: number,
): Vec2 | null {
  // Fast path: origin is itself a road tile.
  const origin = tileAt(world, x, y);
  if (origin && origin.terrain === 'ROAD') {
    return { x, y };
  }

  // Expanding diamond ring: check all tiles at Manhattan distance
  // `radius`, incrementing radius until a road is found.
  const maxRadius = Math.max(world.width, world.height);

  for (let radius = 1; radius < maxRadius; radius++) {
    for (let dx = 0; dx <= radius; dx++) {
      const dy = radius - dx;

      // Generate the 1–4 symmetric points for this (dx, dy) pair.
      const points: Array<[number, number]> = [];
      points.push([x + dx, y + dy]);
      if (dx !== 0) points.push([x - dx, y + dy]);
      if (dy !== 0) points.push([x + dx, y - dy]);
      if (dx !== 0 && dy !== 0) points.push([x - dx, y - dy]);

      for (const [cx, cy] of points) {
        const tile = tileAt(world, cx, cy);
        if (tile && tile.terrain === 'ROAD') {
          return { x: cx, y: cy };
        }
      }
    }
  }

  return null;
}
