/**
 * Building footprint placement.
 *
 * Spec 7.2: populate each generated zone with concrete building footprints
 * that have road access. Placement is deterministic for a given seed via the
 * shared mulberry32 RNG.
 *
 * Validation rules (per plan):
 *  - Every footprint tile must be the zone's tile type (no spillover into
 *    roads or adjacent zones).
 *  - Footprint must not overlap an existing building.
 *  - The footprint's 8-neighborhood union must contain at least one road tile
 *    (citizens need road access to enter).
 *  - The footprint interior must not itself contain a road tile.
 */

import type { Grid } from '@/engine';
import type { GeneratedZone, ZoneType } from './CityGenerator';
import { mulberry32 } from './CityGenerator';
import {
  getBuildingTypesForZone,
  type BuildingDef,
  type BuildingTypeEntry,
} from '@/constants/building-types';

/** Options for placing buildings within a single zone. */
export interface PlaceBuildingsInZoneOptions {
  /** Seed for the deterministic RNG. */
  readonly seed: number;
  /** Fill density in [0,1]; higher means more buildings. Default 0.6. */
  readonly density?: number;
  /** Maximum placement attempts before giving up on a zone. Default 200. */
  readonly maxAttempts?: number;
}

/** Options for placing buildings across all zones. */
export interface PlaceAllBuildingsOptions {
  /** Seed for the deterministic RNG. */
  readonly seed: number;
  /** Fill density forwarded to each zone. Default 0.6. */
  readonly density?: number;
}

/** Default fill density tuned to yield ~5 buildings per spec zone. */
const DEFAULT_DENSITY = 0.7;

/** Default cap on placement attempts per zone. */
const DEFAULT_MAX_ATTEMPTS = 200;

/** 8-neighborhood offsets (N, NE, E, SE, S, SW, W, NW). */
const NEIGHBORHOOD: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/**
 * Check whether the footprint at (x, y) of size (w, h) is entirely within the
 * zone bounds and every tile is the zone's tile type.
 */
function footprintInsideZone(
  grid: Grid,
  zone: GeneratedZone,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const x1 = x + w - 1;
  const y1 = y + h - 1;
  // Bounds check against zone (inclusive).
  if (x < zone.x0 || y < zone.y0 || x1 > zone.x1 || y1 > zone.y1) {
    return false;
  }
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = grid.getTile(x + dx, y + dy);
      if (!tile || tile.type !== zone.type) return false;
    }
  }
  return true;
}

/**
 * Check whether the footprint's 8-neighborhood union contains at least one
 * road tile. The footprint interior is excluded (a road running through the
 * building is rejected by footprintInsideZone already).
 */
function footprintAdjacentToRoad(
  grid: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      // Skip interior tiles; only inspect the perimeter ring.
      const isInterior = dx >= 0 && dx < w && dy >= 0 && dy < h;
      if (isInterior) continue;
      const tile = grid.getTile(x + dx, y + dy);
      if (tile && tile.type === 'road') return true;
    }
  }
  return false;
}

/**
 * Check whether the footprint overlaps any already-placed building tile.
 * Building tiles are marked 'building' on the grid after placement.
 */
function footprintOverlapsBuilding(
  grid: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = grid.getTile(x + dx, y + dy);
      if (tile && tile.type === 'building') return true;
    }
  }
  return false;
}

/** Integer pick in [0, n) from an RNG float in [0,1). */
function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

/** Pick a random building type entry from the zone catalog. */
function pickBuildingType(rng: () => number, zone: ZoneType): BuildingTypeEntry {
  const entries = getBuildingTypesForZone(zone);
  return entries[randInt(rng, entries.length)];
}

/** Pick a random size option from a building type entry. */
function pickSize(
  rng: () => number,
  entry: BuildingTypeEntry,
): readonly [number, number] {
  return entry.sizes[randInt(rng, entry.sizes.length)];
}

/**
 * Place buildings within a single zone deterministically.
 *
 * Mutates `grid` by marking placed footprint tiles as 'building'. Returns the
 * list of placed BuildingDef records.
 *
 * @param grid   The city grid (already populated with roads + zones).
 * @param zone   The zone to fill.
 * @param opts   Seed, density, and attempt cap.
 * @returns      Array of placed buildings (possibly empty if no road adjacency).
 */
export function placeBuildingsInZone(
  grid: Grid,
  zone: GeneratedZone,
  opts: PlaceBuildingsInZoneOptions,
): BuildingDef[] {
  const density = opts.density ?? DEFAULT_DENSITY;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  // Derive a per-zone RNG seeded from the global seed + zone coordinates so
  // each zone is independently deterministic.
  const zoneSeed = (opts.seed ^ (zone.x0 * 73856093) ^ (zone.y0 * 19349663)) >>> 0;
  const rng = mulberry32(zoneSeed);

  const zoneW = zone.x1 - zone.x0 + 1;
  const zoneH = zone.y1 - zone.y0 + 1;
  // Target building count scales with zone area and density. The zone area
  // factor keeps small zones (e.g. park 12x12) from being over-filled.
  const area = zoneW * zoneH;
  const target = Math.max(4, Math.min(8, Math.round((area / 22) * density)));

  const placed: BuildingDef[] = [];
  let attempts = 0;

  while (placed.length < target && attempts < maxAttempts) {
    attempts++;

    const entry = pickBuildingType(rng, zone.type);
    const [w, h] = pickSize(rng, entry);

    // Random top-left within zone bounds that can fit the footprint.
    const minX = zone.x0;
    const maxX = zone.x1 - w + 1;
    const minY = zone.y0;
    const maxY = zone.y1 - h + 1;
    if (maxX < minX || maxY < minY) continue;

    const x = minX + randInt(rng, maxX - minX + 1);
    const y = minY + randInt(rng, maxY - minY + 1);

    // Validate footprint.
    if (!footprintInsideZone(grid, zone, x, y, w, h)) continue;
    if (footprintOverlapsBuilding(grid, x, y, w, h)) continue;
    if (!footprintAdjacentToRoad(grid, x, y, w, h)) continue;

    // Mark footprint tiles as 'building' on the grid.
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        grid.setTile(x + dx, y + dy, 'building');
      }
    }

    placed.push({
      id: `${zone.type}-${placed.length}`,
      name: entry.name,
      type: entry.type,
      width: w,
      height: h,
      x,
      y,
      color: entry.color,
      maxOccupants: entry.maxOccupants,
      operatingHours: entry.operatingHours,
      revenuePerHour: entry.revenuePerHour,
    });
  }

  return placed;
}

/**
 * Place buildings across all generated zones deterministically.
 *
 * @param grid   The city grid (already populated with roads + zones).
 * @param zones  The zones to fill.
 * @param opts   Seed and density.
 * @returns      Array of all placed buildings across every zone.
 */
export function placeAllBuildings(
  grid: Grid,
  zones: readonly GeneratedZone[],
  opts: PlaceAllBuildingsOptions,
): BuildingDef[] {
  const density = opts.density ?? DEFAULT_DENSITY;
  const all: BuildingDef[] = [];
  for (const zone of zones) {
    const buildings = placeBuildingsInZone(grid, zone, { seed: opts.seed, density });
    all.push(...buildings);
  }
  return all;
}

// Re-export neighborhood offsets for downstream/testing use.
export { NEIGHBORHOOD };
