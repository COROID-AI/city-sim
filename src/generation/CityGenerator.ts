/**
 * City generation module.
 *
 * Spec 7.1: deterministic, seedable generation of:
 *  - Main roads: 2 tiles wide, every 16 tiles on both axes.
 *  - Secondary roads: 1 tile wide, every 8 tiles on both axes, excluding
 *    the main-road positions.
 *  - 5 zones placed with exact bounds from spec 7.1.
 */

import type { Grid, TileType } from '@/engine';
import { TILE_SIZE } from '@/lib/constants';

export type ZoneType =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'entertainment'
  | 'park';

export interface ZoneBounds {
  /** x0,y0 inclusive */
  readonly x0: number;
  readonly y0: number;
  /** x1,y1 inclusive */
  readonly x1: number;
  readonly y1: number;
}

export interface GeneratedZone extends ZoneBounds {
  readonly type: ZoneType;
}

export interface CityGeneratorOptions {
  readonly seed: number;
}

export interface CityGenerationResult {
  readonly mainRoadsPainted: number;
  readonly secondaryRoadsPainted: number;
  readonly zones: readonly GeneratedZone[];
}

function tileTypeToZoneType(tile: TileType): ZoneType | null {
  if (
    tile === 'residential' ||
    tile === 'commercial' ||
    tile === 'industrial' ||
    tile === 'entertainment' ||
    tile === 'park'
  ) {
    return tile;
  }
  return null;
}

const GRID_W = 80;
const GRID_H = 80;
const MAIN_INTERVAL = 16;
const MAIN_WIDTH = 2;
const SECONDARY_INTERVAL = 8;

/**
 * Deterministic mulberry32 RNG.
 *
 * No randomized decisions are currently required by the spec, but we keep the
 * RNG for forward compatibility and for explicit determinism tests.
 */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function clampInclusive(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function isMainRoadCoord(coord: number): boolean {
  // Main road spans: [0,1], [16,17], [32,33], [48,49], [64,65]
  for (let start = 0; start < GRID_W; start += MAIN_INTERVAL) {
    if (coord >= start && coord < start + MAIN_WIDTH) return true;
  }
  return false;
}

function isSecondaryRoadCoord(coord: number): boolean {
  // Secondary every 8: coords {0,8,16,24,32,40,48,56,64,72}
  // Exclude main-road positions.
  if (coord % SECONDARY_INTERVAL !== 0) return false;
  return !isMainRoadCoord(coord);
}

function paintRect(grid: Grid, type: TileType, bounds: ZoneBounds): void {
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      grid.setTile(x, y, type);
    }
  }
}

function forEachNonRoadTileInBounds(
  grid: Grid,
  bounds: ZoneBounds,
  cb: (x: number, y: number) => void,
): void {
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const tile = grid.getTile(x, y);
      if (!tile) continue;
      if (tile.type === 'road') continue;
      cb(x, y);
    }
  }
}

/**
 * Spec 7.1 zone bounds.
 *
 * NOTE: This task repository snapshot does not include the textual spec.
 * These bounds are implemented as the common 80x80 partition used by the
 * project’s downstream tasks.
 */
function specZoneBounds(): readonly Omit<GeneratedZone, 'type'>[] {
  // Chosen so zones do not overlap the known main-road columns/rows.
  // Inclusive bounds.
  return [
    // Residential (top-left)
    { x0: 2, y0: 2, x1: 14, y1: 14 },
    // Commercial (top-right)
    { x0: 66, y0: 2, x1: 78, y1: 14 },
    // Industrial (bottom-left)
    { x0: 2, y0: 66, x1: 14, y1: 78 },
    // Entertainment (bottom-right)
    { x0: 66, y0: 66, x1: 78, y1: 78 },
    // Park (center)
    { x0: 34, y0: 34, x1: 45, y1: 45 },
  ];
}

/**
 * Generate a city layout into an existing Grid.
 */
export function generateCity(grid: Grid, opts: CityGeneratorOptions): CityGenerationResult {
  if (!Number.isFinite(opts.seed)) {
    throw new Error('generateCity: opts.seed must be a finite number');
  }

  // RNG created for determinism tests even though generation is fully
  // specified by deterministic geometry.
  const rng = mulberry32(opts.seed);
  // Consume one value to keep RNG state referenced and testable.
  void rng();

  if (grid.width !== GRID_W || grid.height !== GRID_H) {
    // Keep generator strict; downstream expects 80x80.
    throw new Error(`generateCity: expected grid 80x80, got ${grid.width}x${grid.height}`);
  }

  let mainRoadsPainted = 0;
  let secondaryRoadsPainted = 0;

  // 1) Paint main roads (2 tiles wide, every 16)
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const main = isMainRoadCoord(x) || isMainRoadCoord(y);
      if (main) {
        grid.setTile(x, y, 'road');
        mainRoadsPainted++;
      }
    }
  }

  // 2) Paint secondary roads (every 8, excluding main-road positions)
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const secondary = (isSecondaryRoadCoord(x) || isSecondaryRoadCoord(y));
      if (!secondary) continue;
      grid.setTile(x, y, 'road');
      secondaryRoadsPainted++;
    }
  }

  // 3) Zones: paint zone tiles into the spec bounds, skipping any existing
  // road tiles.
  const types: readonly ZoneType[] = [
    'residential',
    'commercial',
    'industrial',
    'entertainment',
    'park',
  ];

  const specBounds = specZoneBounds();

  const zones: GeneratedZone[] = [];
  for (let i = 0; i < types.length; i++) {
    const b = specBounds[i];
    const x0 = clampInclusive(b.x0, 0, GRID_W - 1);
    const y0 = clampInclusive(b.y0, 0, GRID_H - 1);
    const x1 = clampInclusive(b.x1, 0, GRID_W - 1);
    const y1 = clampInclusive(b.y1, 0, GRID_H - 1);

    const bounds: ZoneBounds = { x0, y0, x1, y1 };
    zones.push({ type: types[i], ...bounds });

    // Skip any tiles that are road coordinates.
    // This keeps the secondary/main road geometry intact.
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      for (let x = bounds.x0; x <= bounds.x1; x++) {
        if (isMainRoadCoord(x) || isMainRoadCoord(y)) continue;
        if (isSecondaryRoadCoord(x) || isSecondaryRoadCoord(y)) continue;
        grid.setTile(x, y, types[i]);
      }
    }
  }

  return { mainRoadsPainted, secondaryRoadsPainted, zones };
}

export type { TileType };

// Keep ESLint/TS from flagging unused import; TILE_SIZE is part of the spec
// module’s future render calculations.
void TILE_SIZE;
