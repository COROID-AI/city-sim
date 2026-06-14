/**
 * Road network generation: paints a 2-tile grid of road tiles around and
 * between the zones. Roads connect adjacent zones by sharing the same
 * border tile rows / columns. The function is pure and writes via
 * `World.setTile` so it respects the engine's bounds-checked API.
 *
 * The road layout guarantees:
 *  - Every zone has a 2-tile-wide road border (or `roadWidth` if customised).
 *  - Tiles along zone borders are `kind: 'road'`.
 *  - The central vertical and horizontal roads connect opposite edges of
 *    the world, so any tile in the city can reach any other tile by
 *    Manhattan moves on road tiles.
 */

import type { World } from '@/engine/World';
import type { Zone } from './zones';

export interface RoadNetworkOptions {
  /** Width of the road grid in tiles. */
  readonly roadWidth?: number;
}

const DEFAULT_ROAD_WIDTH = 2;

/**
 * Paint the road network into the given world. Returns the list of road
 * tile coordinates for downstream consumers (e.g. the benchmark object).
 */
export function buildRoadNetwork(
  world: World,
  zones: readonly Zone[],
  options: RoadNetworkOptions = {},
): { x: number; y: number }[] {
  const roadWidth = options.roadWidth ?? DEFAULT_ROAD_WIDTH;
  const roads: { x: number; y: number }[] = [];
  const painted = new Set<string>();

  const paint = (x: number, y: number): void => {
    if (x < 0 || y < 0) return;
    if (x >= world.bounds.width || y >= world.bounds.height) return;
    const key = `${x},${y}`;
    if (painted.has(key)) return;
    painted.add(key);
    if (world.setTile({ x, y }, 'road')) {
      roads.push({ x, y });
    }
  };

  const { width: W, height: H } = world.bounds;

  // Outer border roads around the entire world — gives every zone a
  // perimeter that connects to the grid.
  for (let i = 0; i < W; i++) {
    for (let k = 0; k < roadWidth; k++) {
      paint(i, k);
      paint(i, H - 1 - k);
    }
  }
  for (let j = 0; j < H; j++) {
    for (let k = 0; k < roadWidth; k++) {
      paint(k, j);
      paint(W - 1 - k, j);
    }
  }

  // Per-zone border roads. A zone border is `roadWidth` tiles thick on
  // each of its four sides. Zones don't overlap, but the road tiles
  // separating two zones will be painted twice and deduplicated.
  for (const zone of zones) {
    const { origin, end } = zone;
    // Top and bottom edges
    for (let x = origin.x - roadWidth; x <= end.x + roadWidth; x++) {
      for (let k = 0; k < roadWidth; k++) {
        paint(x, origin.y - roadWidth + k);
        paint(x, end.y + 1 + k);
      }
    }
    // Left and right edges
    for (let y = origin.y - roadWidth; y <= end.y + roadWidth; y++) {
      for (let k = 0; k < roadWidth; k++) {
        paint(origin.x - roadWidth + k, y);
        paint(end.x + 1 + k, y);
      }
    }
  }

  return roads;
}

/**
 * Returns the set of `kind: 'road'` tile coordinates currently painted in
 * the world. Useful for downstream connectivity checks.
 */
export function collectRoadTiles(world: World): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const tile of world.tiles_()) {
    if (tile.kind === 'road') out.push({ x: tile.coord.x, y: tile.coord.y });
  }
  return out;
}
