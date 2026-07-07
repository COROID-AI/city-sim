/**
 * Procedural city generation.
 *
 * Given an empty {@link World} from `createWorld`, `generateCity`
 * populates it with a realistic city layout:
 *
 *   - A **road grid** — evenly-spaced horizontal and vertical roads
 *     forming a fully connected lattice of intersections.
 *   - **Building plots** — grass tiles between roads are zoned and
 *     stamped with buildings.
 *   - **Buildings** — a mix of residential, workplace, entertainment,
 *     and civic structures, each with a position, footprint, capacity,
 *     and name.
 *
 * Generation is driven by the seeded RNG from `rng.ts`, so identical
 * seeds always produce identical cities.
 */

import { createRng, type Rng } from './rng';
import { setTerrain, tileAt } from './world';
import type { Building, BuildingKind, World, Zone } from './types';

// ─── Generation parameters ───────────────────────────────────────────────────

/** Spacing between parallel road lines, in grid cells. */
export const ROAD_SPACING = 10;

/** Default seed for reproducible city generation. */
export const DEFAULT_CITY_SEED = 8675309;

/** Target number of buildings (well above the README ≥20 minimum). */
const TARGET_BUILDINGS = 48;

// ─── Building-kind configuration ─────────────────────────────────────────────

/** Maps a building kind to its zoning designation. */
const KIND_TO_ZONE: Record<BuildingKind, Zone> = {
  HOME: 'RESIDENTIAL',
  WORK: 'COMMERCIAL',
  ENTERTAINMENT: 'COMMERCIAL',
  CIVIC: 'MIXED',
};

/**
 * Weighted kind distribution used once minimum quotas are satisfied.
 * Residential and workplaces dominate; entertainment and civic are rarer.
 */
const KIND_WEIGHTS: ReadonlyArray<readonly [BuildingKind, number]> = [
  ['HOME', 40],
  ['WORK', 30],
  ['ENTERTAINMENT', 20],
  ['CIVIC', 10],
];

/** Minimum buildings per kind to guarantee a balanced, varied city. */
const MIN_PER_KIND: Record<BuildingKind, number> = {
  HOME: 8,
  WORK: 8,
  ENTERTAINMENT: 5,
  CIVIC: 3,
};

/** Kinds checked in priority order (rarest first) when filling quotas. */
const QUOTA_PRIORITY: readonly BuildingKind[] = [
  'CIVIC',
  'ENTERTAINMENT',
  'WORK',
  'HOME',
];

/** Human-readable name pools keyed by building kind. */
const NAME_POOLS: Record<BuildingKind, readonly string[]> = {
  HOME: [
    'Oak Apartments', 'Maple Court', 'Sunrise Flats', 'Riverside Towers',
    'Cedar Gardens', 'Birch House', 'Pine View Estates', 'Willow Court',
    'Elm Street Homes', 'Aspen Lofts', 'Juniper Residences', 'Magnolia House',
    'Sycamore Place', 'Hawthorn Heights',
  ],
  WORK: [
    'Tech Plaza', 'Commerce Tower', 'Industrial Park', 'Innovation Center',
    'Business Hub', 'Trade Center', 'Enterprise Building', 'Gateway Offices',
    'Metro Workspaces', 'Harbor Industries', 'Summit Corporate', 'Pioneer Labs',
    'Sterling Offices', 'Vector Industries',
  ],
  ENTERTAINMENT: [
    'Star Theater', 'Central Park', 'Neon Arcade', 'Grand Cinema',
    'Blue Note Club', 'Sunset Lounge', 'Riverside Park', 'Crystal Bowl',
    'Joy Land', 'The Plaza Mall', 'Velvet Lounge', 'Emerald Gardens',
    'Cosmo Entertainment', 'Lighthouse Cinema',
  ],
  CIVIC: [
    'City Hall', 'Police Station', 'General Hospital', 'Central Library',
    'Fire Station', 'Post Office', 'Courthouse', 'Community Center',
    'Civic Auditorium', 'Memorial Hall',
  ],
};

/** Candidate footprint dimensions per building kind. */
const SIZE_OPTIONS: Record<
  BuildingKind,
  ReadonlyArray<{ readonly width: number; readonly height: number }>
> = {
  HOME: [
    { width: 3, height: 3 },
    { width: 4, height: 3 },
    { width: 3, height: 4 },
    { width: 4, height: 4 },
    { width: 5, height: 4 },
  ],
  WORK: [
    { width: 4, height: 4 },
    { width: 5, height: 4 },
    { width: 4, height: 5 },
    { width: 5, height: 5 },
    { width: 6, height: 4 },
  ],
  ENTERTAINMENT: [
    { width: 3, height: 4 },
    { width: 4, height: 3 },
    { width: 4, height: 4 },
    { width: 5, height: 3 },
  ],
  CIVIC: [
    { width: 4, height: 4 },
    { width: 5, height: 4 },
    { width: 4, height: 5 },
    { width: 5, height: 5 },
  ],
};

/** Occupant-density range: capacity = area × density (random within range). */
const DENSITY_RANGE: Record<
  BuildingKind,
  { readonly min: number; readonly max: number }
> = {
  HOME: { min: 2, max: 3 },
  WORK: { min: 2, max: 4 },
  ENTERTAINMENT: { min: 2, max: 3 },
  CIVIC: { min: 1, max: 2 },
};

// ─── Internal types ──────────────────────────────────────────────────────────

/** A rectangular interior region bounded by road lines on all four sides. */
interface Block {
  readonly x0: number;
  readonly y0: number;
  /** Inclusive right edge. */
  readonly x1: number;
  /** Inclusive bottom edge. */
  readonly y1: number;
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

/** Fisher–Yates shuffle driven by the seeded RNG for deterministic ordering. */
function shuffle<T>(array: readonly T[], rng: Rng): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

/** Weighted random pick from [kind, weight] pairs. */
function weightedKindPick(rng: Rng): BuildingKind {
  const total = KIND_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let r = rng.next() * total;
  for (const [kind, w] of KIND_WEIGHTS) {
    r -= w;
    if (r <= 0) return kind;
  }
  return KIND_WEIGHTS[KIND_WEIGHTS.length - 1]![0];
}

/** True when every cell in the footprint is free GRASS with no building. */
function canPlace(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = tileAt(world, x + dx, y + dy);
      if (!tile || tile.terrain !== 'GRASS' || tile.buildingId !== null) {
        return false;
      }
    }
  }
  return true;
}

/** Stamp a building onto the grid: set terrain, buildingId, and zone. */
function stampBuilding(world: World, building: Building, zone: Zone): void {
  for (let dy = 0; dy < building.size.height; dy++) {
    for (let dx = 0; dx < building.size.width; dx++) {
      const tile = tileAt(
        world,
        building.position.x + dx,
        building.position.y + dy,
      );
      if (tile) {
        tile.terrain = 'BUILDING';
        tile.buildingId = building.id;
        tile.zone = zone;
      }
    }
  }
}

// ─── Road generation ─────────────────────────────────────────────────────────

/**
 * Lay down a fully-connected grid of horizontal and vertical roads
 * spanning the entire world.  Roads run along every ROAD_SPACING-th
 * column and row, creating a lattice of intersections.
 */
function buildRoadGrid(world: World): void {
  // Vertical roads along columns 0, ROAD_SPACING, 2×ROAD_SPACING, …
  for (let x = 0; x < world.width; x += ROAD_SPACING) {
    for (let y = 0; y < world.height; y++) {
      setTerrain(world, x, y, 'ROAD');
    }
  }
  // Horizontal roads along rows 0, ROAD_SPACING, 2×ROAD_SPACING, …
  for (let y = 0; y < world.height; y += ROAD_SPACING) {
    for (let x = 0; x < world.width; x++) {
      setTerrain(world, x, y, 'ROAD');
    }
  }
}

// ─── Block enumeration ───────────────────────────────────────────────────────

/**
 * Enumerate every interior block — a rectangular region bounded by road
 * lines on all four sides where buildings may be placed.
 */
function enumerateBlocks(world: World): Block[] {
  const blocks: Block[] = [];

  // Collect road-line positions (shared for both axes since spacing is uniform).
  const roadLines: number[] = [];
  for (let p = 0; p < Math.max(world.width, world.height); p += ROAD_SPACING) {
    roadLines.push(p);
  }

  for (let i = 0; i < roadLines.length; i++) {
    const left = roadLines[i]!;
    const rightBound =
      i + 1 < roadLines.length ? roadLines[i + 1]! : world.width;
    const x0 = left + 1;
    const x1 = Math.min(rightBound - 1, world.width - 1);
    if (x1 < x0) continue;

    for (let j = 0; j < roadLines.length; j++) {
      const top = roadLines[j]!;
      const bottomBound =
        j + 1 < roadLines.length ? roadLines[j + 1]! : world.height;
      const y0 = top + 1;
      const y1 = Math.min(bottomBound - 1, world.height - 1);
      if (y1 < y0) continue;

      blocks.push({ x0, y0, x1, y1 });
    }
  }

  return blocks;
}

// ─── Building placement ──────────────────────────────────────────────────────

/**
 * Attempt to place a building of the given kind inside a block.
 *
 * Tries up to `maxAttempts` random size/position combinations.  Returns
 * the placed building on success, or `null` if no valid placement was
 * found.
 */
function tryPlaceBuilding(
  world: World,
  rng: Rng,
  block: Block,
  kind: BuildingKind,
  id: string,
): Building | null {
  const sizes = SIZE_OPTIONS[kind];
  const zone = KIND_TO_ZONE[kind];
  const maxAttempts = 12;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const size = rng.pick(sizes);
    const maxX = block.x1 - size.width + 1;
    const maxY = block.y1 - size.height + 1;
    if (maxX < block.x0 || maxY < block.y0) continue;

    const px = rng.int(block.x0, maxX);
    const py = rng.int(block.y0, maxY);

    if (canPlace(world, px, py, size.width, size.height)) {
      const area = size.width * size.height;
      const dr = DENSITY_RANGE[kind];
      const density = dr.min + rng.next() * (dr.max - dr.min);
      const capacity = Math.max(1, Math.round(area * density));
      const name = rng.pick(NAME_POOLS[kind]);

      const building: Building = {
        id,
        kind,
        position: { x: px, y: py },
        size: { width: size.width, height: size.height },
        capacity,
        name,
        owner: null,
      };

      stampBuilding(world, building, zone);
      return building;
    }
  }

  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Populate an empty world with a procedural city: road grid, zoning, and
 * a mix of residential, workplace, entertainment, and civic buildings.
 *
 * The layout is fully deterministic for a given seed — identical seeds
 * always produce identical cities.  At least 20 buildings are placed,
 * spanning all four building kinds.
 *
 * @param world The empty world to populate (mutated in place).
 * @param seed  RNG seed (defaults to {@link DEFAULT_CITY_SEED}).
 */
export function generateCity(
  world: World,
  seed: number = DEFAULT_CITY_SEED,
): void {
  const rng = createRng(seed >>> 0);

  // 1. Road grid ──────────────────────────────────────────────────────────
  buildRoadGrid(world);

  // 2. Enumerate and shuffle blocks for organic placement order ───────────
  const blocks = shuffle(enumerateBlocks(world), rng);

  // 3. Place buildings ────────────────────────────────────────────────────
  let idCounter = 0;
  const kindCounts: Record<BuildingKind, number> = {
    HOME: 0,
    WORK: 0,
    ENTERTAINMENT: 0,
    CIVIC: 0,
  };
  let totalPlaced = 0;

  for (const block of blocks) {
    if (totalPlaced >= TARGET_BUILDINGS) break;

    // Pick kind: fill quotas first (rarest first), then weighted random.
    const quotaKind = QUOTA_PRIORITY.find(
      (k) => kindCounts[k] < MIN_PER_KIND[k],
    );
    const kind: BuildingKind = quotaKind ?? weightedKindPick(rng);

    const building = tryPlaceBuilding(world, rng, block, kind, `b${idCounter}`);
    if (building) {
      world.buildings.set(building.id, building);
      kindCounts[kind]++;
      totalPlaced++;
      idCounter++;
    }
  }
}
