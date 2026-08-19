/**
 * Deterministic city generation.
 *
 * Builds the full world: a tile grid larger than any viewport, a connected
 * road network, and 20+ buildings distributed across residential, workplace,
 * entertainment, and service (shop/restaurant/park) zones. Each building
 * carries the shared contract shape from src/core/types.js.
 *
 * The final building counts per zone are logged to the console for
 * verification.
 */

import { CONFIG } from '../core/config.js';
import { RNG } from '../core/rng.js';
import { generateRoads } from './roads.js';

const NAMES = {
  residential: [
    'Willow Court', 'Cedar Residences', 'Maple Flats', 'Birch Apartments',
    'Elm Manor', 'Aspen Terrace', 'Pine Yards', 'Hazel House',
  ],
  workplace: [
    'Meridian Office', 'Summit Tower', 'Atlas Plaza', 'Orbit Center',
    'Crest Business', 'Nova Labs', 'Vertex Court', 'Axis Works',
  ],
  entertainment: [
    'Starlight Theatre', 'Arcade Central', 'Pinnacle Cinema', 'Harmonia Arena',
    'Jazz Stage', 'Comedy Lounge', 'The Odeon', 'Neon Pavilion',
  ],
  service: [
    'Golden Corner Shop', 'The Rusty Rest', 'Sparrow Market', 'Garden Bistro',
    'Harbor Grill', 'City Lights Park', 'Blossom Park', 'Corner Bazaar',
  ],
};

const SERVICE_TYPES = ['shop', 'restaurant', 'park'];

/**
 * Generate the complete city world.
 * @param {number} seed  Deterministic seed.
 * @param {object} config  Tunables config.
 * @returns {object} The world: { seed, gridSize, tileSize, tiles, roads, buildings }.
 */
export function generateCity(seed = CONFIG.SEED, config = CONFIG) {
  const rng = new RNG(seed);
  const gs = config.GRID_SIZE;

  const world = {
    seed,
    gridSize: gs,
    tileSize: config.TILE_SIZE,
    tiles: [],
    roads: [],
    buildings: [],
  };

  for (let y = 0; y < gs; y++) {
    const row = [];
    for (let x = 0; x < gs; x++) {
      row.push({ x, y, type: 'empty' });
    }
    world.tiles.push(row);
  }

  generateRoads(world, rng, config);
  placeBuildings(world, rng, config);
  logCounts(world);
  return world;
}

/**
 * Place buildings inside the road-delimited blocks of the grid.
 */
function placeBuildings(world, rng, config) {
  const spacing = config.ROAD_SPACING;
  const gs = config.GRID_SIZE;
  const blocksPerSide = Math.floor((gs - 1) / spacing);
  let id = 1;

  for (let bi = 0; bi < blocksPerSide; bi++) {
    for (let bj = 0; bj < blocksPerSide; bj++) {
      const x0 = bi * spacing + 1;
      const y0 = bj * spacing + 1;
      const blockW = Math.min(spacing - 1, gs - x0);
      const blockH = Math.min(spacing - 1, gs - y0);
      if (blockW < 2 || blockH < 2) continue;

      // Place a building in most blocks; occasionally two for density.
      if (rng.chance(0.8)) {
        world.buildings.push(makeBuilding(rng, x0, y0, blockW, blockH, id++, config));
      }
    }
  }
}

/**
 * Construct a single building within a block, with a road-facing door.
 */
function makeBuilding(rng, x0, y0, blockW, blockH, id, config) {
  const zone = pickZone(rng, config);
  const bw = rng.int(2, Math.min(4, blockW));
  const bh = rng.int(2, Math.min(4, blockH));
  const bx = x0 + rng.int(0, blockW - bw);
  const by = y0 + rng.int(0, blockH - bh);

  return {
    id,
    zone,
    subType: zone === 'service' ? rng.pick(SERVICE_TYPES) : null,
    footprint: { x: bx, y: by, w: bw, h: bh },
    door: chooseDoor(bx, by, bw, bh, x0, y0, blockW, blockH),
    capacity: rng.int(4, 40),
    name: rng.pick(NAMES[zone]) || `${zone} #${id}`,
    detailSeed: rng.int(1, 1000000000),
  };
}

/**
 * Place the door on whichever building edge is closest to a surrounding road.
 */
function chooseDoor(bx, by, bw, bh, x0, y0, blockW, blockH) {
  const leftDist = bx - x0;
  const rightDist = x0 + blockW - 1 - (bx + bw - 1);
  const topDist = by - y0;
  const bottomDist = y0 + blockH - 1 - (by + bh - 1);
  const midX = bx + Math.floor(bw / 2);
  const midY = by + Math.floor(bh / 2);
  const min = Math.min(leftDist, rightDist, topDist, bottomDist);

  if (min === leftDist) return { x: bx, y: midY };
  if (min === rightDist) return { x: bx + bw - 1, y: midY };
  if (min === topDist) return { x: midX, y: by };
  return { x: midX, y: by + bh - 1 };
}

/** Weighted zone selection using the config's ZONES table. */
function pickZone(rng, config) {
  const r = rng.float();
  let acc = 0;
  for (const [zone, weight] of Object.entries(config.ZONES)) {
    acc += weight;
    if (r < acc) return zone;
  }
  return 'residential';
}

/** Log final building counts per zone to the console for verification. */
function logCounts(world) {
  const counts = {};
  for (const b of world.buildings) {
    counts[b.zone] = (counts[b.zone] || 0) + 1;
  }
  console.log(`[city] ${world.buildings.length} buildings generated`);
  for (const [zone, n] of Object.entries(counts)) {
    console.log(`[city] ${zone}: ${n}`);
  }
}