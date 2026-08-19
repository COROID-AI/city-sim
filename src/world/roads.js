/**
 * Road network generation.
 *
 * Produces a connected road graph over the city grid: full road lines every
 * ROAD_SPACING tiles on both axes, plus a handful of extra road tiles for
 * organic variety. The lattice alone is fully connected.
 */

import { CONFIG } from '../core/config.js';

/**
 * Draws the road network onto the world's tile grid.
 * @param {object} world  Mutable world being built ({ tiles, roads }).
 * @param {RNG} rng   Deterministic RNG.
 * @param {object} config  Tunables config.
 */
export function generateRoads(world, rng, config = CONFIG) {
  const spacing = config.ROAD_SPACING;
  const gs = config.GRID_SIZE;

  for (let y = 0; y < gs; y++) {
    for (let x = 0; x < gs; x++) {
      if (x % spacing === 0 || y % spacing === 0) {
        const tile = world.tiles[y][x];
        tile.type = 'road';
        world.roads.push({ x, y, type: 'road' });
      }
    }
  }

  // Sprinkle a few extra road tiles for organic variety. Each spur is bridged
  // back to the nearest lattice road so the whole road graph stays connected.
  const markRoad = (x, y) => {
    if (world.tiles[y][x].type !== 'road') {
      world.tiles[y][x].type = 'road';
      world.roads.push({ x, y, type: 'road' });
    }
  };

  const extra = Math.floor(gs / 4);
  for (let i = 0; i < extra; i++) {
    const y = rng.int(1, gs - 2);
    const x = rng.int(1, gs - 2);
    if (world.tiles[y][x].type === 'road') continue;

    // Nearest lattice road (roads run at multiples of `spacing`).
    const gx = Math.max(0, Math.min(gs - 1, Math.round(x / spacing) * spacing));
    const gy = Math.max(0, Math.min(gs - 1, Math.round(y / spacing) * spacing));

    // Carve a horizontal segment to the lattice column, then a vertical one.
    for (let cx = Math.min(x, gx); cx <= Math.max(x, gx); cx++) markRoad(cx, y);
    for (let cy = Math.min(y, gy); cy <= Math.max(y, gy); cy++) markRoad(gx, cy);
  }
}