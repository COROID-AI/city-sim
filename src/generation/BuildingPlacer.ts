/**
 * BuildingPlacer — places building footprints inside zoning districts.
 *
 * Constraints enforced:
 *  - No two buildings share any grid cell (occupancy Set of "x,y" keys).
 *  - Every placed building has at least one footprint edge tile orthogonally
 *    adjacent to a road tile (road adjacency).
 *  - Footprints stay within their owning zone bounds.
 *
 * Determinism: a seeded RNG (mulberry32) is threaded through so tests are
 * reproducible. A high attempt cap plus a 1x1 fallback guarantees we reach the
 * requested building count on an 80x80 grid.
 */
import type { Building, BuildingDef, Zone, ZoneType } from '@/engine/types';
import type { Grid } from '@/engine/World';

/** Seeded mulberry32 PRNG returning floats in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min,max] inclusive using the provided RNG. */
function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Orthogonal neighbor offsets. */
const NEIGHBORS_4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Determine whether any perimeter cell of the footprint at (x,y,w,h) has an
 * orthogonal neighbor that is a road tile.
 */
export function isAdjacentToRoad(
  grid: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      // Only check perimeter cells.
      const isPerimeter =
        dx === 0 || dy === 0 || dx === w - 1 || dy === h - 1;
      if (!isPerimeter) continue;
      for (const [nx, ny] of NEIGHBORS_4) {
        const neighbor = grid.getTile(cx + nx, cy + ny);
        if (neighbor && neighbor.type === 'road') return true;
      }
    }
  }
  return false;
}

/** Default building definitions keyed by zone type. */
export const ZONE_BUILDINGS: Record<ZoneType, BuildingDef[]> = {
  residential: [
    {
      id: 'house',
      name: 'House',
      type: 'house',
      width: 2,
      height: 2,
      cost: 100,
      upkeep: 2,
      capacity: 4,
      color: '#8fd3a0',
    },
    {
      id: 'apartment',
      name: 'Apartment',
      type: 'apartment',
      width: 3,
      height: 3,
      cost: 400,
      upkeep: 8,
      capacity: 20,
      color: '#5bb37a',
    },
  ],
  commercial: [
    {
      id: 'shop',
      name: 'Shop',
      type: 'shop',
      width: 2,
      height: 2,
      cost: 150,
      upkeep: 3,
      capacity: 6,
      color: '#6db4ff',
    },
    {
      id: 'office',
      name: 'Office',
      type: 'office',
      width: 3,
      height: 3,
      cost: 500,
      upkeep: 10,
      capacity: 30,
      color: '#4a90d9',
    },
  ],
  industrial: [
    {
      id: 'factory',
      name: 'Factory',
      type: 'factory',
      width: 3,
      height: 2,
      cost: 300,
      upkeep: 6,
      capacity: 12,
      color: '#d9b56b',
    },
  ],
  entertainment: [
    {
      id: 'cinema',
      name: 'Cinema',
      type: 'cinema',
      width: 2,
      height: 2,
      cost: 250,
      upkeep: 5,
      capacity: 15,
      color: '#c77dff',
    },
  ],
  park: [
    {
      id: 'park',
      name: 'Park',
      type: 'park',
      width: 2,
      height: 2,
      cost: 80,
      upkeep: 1,
      capacity: 0,
      color: '#7ec850',
    },
  ],
};

export interface PlaceOptions {
  /** Target number of buildings to place. */
  target: number;
  /** Seeded RNG. */
  rng: () => number;
  /** Max placement attempts before giving up. */
  maxAttempts?: number;
}

/**
 * Place buildings across the given zones, returning the placed instances.
 * Stamps occupancy on the grid and marks footprint tiles with building ids.
 */
export function placeBuildings(
  grid: Grid,
  zones: Zone[],
  options: PlaceOptions,
): Building[] {
  const { target, rng } = options;
  const maxAttempts = options.maxAttempts ?? 4000;
  const placed: Building[] = [];
  const occupied = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;

  let idCounter = 0;
  let attempts = 0;

  while (placed.length < target && attempts < maxAttempts) {
    attempts++;
    const zone = zones[Math.floor(rng() * zones.length)];
    if (!zone) continue;
    const defs = ZONE_BUILDINGS[zone.type];
    if (!defs || defs.length === 0) continue;
    const def = defs[Math.floor(rng() * defs.length)];

    // Try the natural footprint size first; fall back to 1x1 if needed.
    const sizes: Array<{ w: number; h: number }> = [
      { w: def.width, h: def.height },
      { w: 1, h: 1 },
    ];

    for (const { w, h } of sizes) {
      if (w > zone.width || h > zone.height) continue;
      const px = zone.x + randInt(rng, 0, zone.width - w);
      const py = zone.y + randInt(rng, 0, zone.height - h);

      // Overlap check.
      let collision = false;
      for (let dy = 0; dy < h && !collision; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (occupied.has(key(px + dx, py + dy))) {
            collision = true;
            break;
          }
        }
      }
      if (collision) continue;

      // Road adjacency check.
      if (!isAdjacentToRoad(grid, px, py, w, h)) continue;

      // Place it.
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          occupied.add(key(px + dx, py + dy));
          const tile = grid.getTile(px + dx, py + dy);
          if (tile) {
            tile.buildable = false;
          }
        }
      }
      const id = `b-${idCounter++}`;
      const building: Building = {
        id,
        type: def.type,
        zone: zone.type,
        x: px,
        y: py,
        width: w,
        height: h,
        def,
      };
      placed.push(building);
      break;
    }
  }

  return placed;
}
