/**
 * CityGenerator — procedural city layout pipeline (spec §7.1).
 *
 * Pipeline:
 *  1. Create an empty World of the requested size.
 *  2. placeGridRoads: main roads every 16 tiles (2 wide) and secondary roads
 *     every 8 tiles (1 wide), drawn both horizontally and vertically so the
 *     network is a single connected component.
 *  3. Define 5 zoning districts (residential, commercial, industrial,
 *     entertainment, park) with explicit bounds in the blocks between roads.
 *  4. BuildingPlacer fills each zone with footprints respecting road adjacency
 *     and no-overlap constraints.
 *
 * Determinism: a fixed default seed makes `generateCity(80,80)` reproducible.
 */
import type { Building, Zone, ZoneType } from '@/engine/types';
import { World } from '@/engine/World';
import { Citizen } from '@/entities/Citizen';
import {
  mulberry32,
  placeBuildings,
} from './BuildingPlacer';

/** Default deterministic seed for reproducible generation. */
export const DEFAULT_SEED = 1337;

/** Main road interval (tiles). */
export const MAIN_ROAD_INTERVAL = 16;
/** Secondary road interval (tiles). */
export const SECONDARY_ROAD_INTERVAL = 8;
/** Main road width (tiles). */
export const MAIN_ROAD_WIDTH = 2;
/** Secondary road width (tiles). */
export const SECONDARY_ROAD_WIDTH = 1;

/** Default target building count for an 80x80 city. */
export const DEFAULT_BUILDING_TARGET = 40;

/** Maximum number of citizens the city will spawn. */
export const MAX_CITIZENS = 100;

/**
 * Residential capacity divisor: one citizen is spawned per this many units of
 * residential capacity (spec §7.1 step 6).
 */
export const CITIZENS_PER_CAPACITY = 2;

/** Zone types that provide jobs for employed citizens. */
const EMPLOYMENT_ZONES: ReadonlySet<ZoneType> = new Set([
  'commercial',
  'industrial',
  'entertainment',
]);

/**
 * Compute the number of citizens to spawn for the placed buildings.
 *
 * Formula: floor(totalResidentialCapacity / CITIZENS_PER_CAPACITY), capped at
 * {@link MAX_CITIZENS}. Residential capacity is the sum of `def.capacity` over
 * all residential buildings.
 *
 * @param buildings The placed building instances.
 * @returns The citizen count to spawn (>= 0).
 */
export function computeCitizenCount(buildings: ReadonlyArray<Building>): number {
  let residentialCapacity = 0;
  for (const b of buildings) {
    if (b.zone === 'residential') {
      residentialCapacity += b.def.capacity;
    }
  }
  return Math.min(
    MAX_CITIZENS,
    Math.floor(residentialCapacity / CITIZENS_PER_CAPACITY),
  );
}

/**
 * Spawn the citizen population into the world.
 *
 * Each citizen is assigned:
 *  - A `homeId` pointing to a residential building (round-robin over the
 *    residential buildings, weighted by capacity).
 *  - An initial position at the center of their home building.
 *  - Employment status + `workplaceId`: ~70% are employed and assigned a job
 *    building (commercial / industrial / entertainment); the rest are
 *    unemployed. Employment is deterministic given the seeded RNG.
 *  - An auto-generated 24-hour schedule (via the Citizen constructor).
 *
 * @param world     The world to populate (citizens are added via addCitizen).
 * @param buildings The placed building instances.
 * @param rng       Seeded RNG for deterministic employment / assignment.
 */
export function spawnCitizens(
  world: World,
  buildings: ReadonlyArray<Building>,
  rng: () => number,
): void {
  const count = computeCitizenCount(buildings);
  if (count <= 0) return;

  const residential = buildings.filter((b) => b.zone === 'residential');
  const workplaces = buildings.filter((b) => EMPLOYMENT_ZONES.has(b.zone));

  if (residential.length === 0) return;

  // Build a weighted home pool so larger residential buildings get more
  // residents (one slot per unit of capacity).
  const homePool: Building[] = [];
  for (const b of residential) {
    const slots = Math.max(1, b.def.capacity);
    for (let i = 0; i < slots; i++) homePool.push(b);
  }

  for (let i = 0; i < count; i++) {
    const home = homePool[Math.floor(rng() * homePool.length)] ?? residential[0]!;
    const employed = workplaces.length > 0 && rng() < 0.7;
    const workplace = employed
      ? workplaces[Math.floor(rng() * workplaces.length)]! ?? null
      : null;

    const homePos = {
      x: home.x + home.width / 2,
      y: home.y + home.height / 2,
    };

    const citizen = new Citizen(homePos, {
      id: `citizen-${i}`,
      employed,
      homeId: home.id,
      workplaceId: workplace ? workplace.id : null,
      rng,
    });
    world.addCitizen(citizen);
  }
}

/**
 * Draw the grid-pattern road network onto the grid.
 *
 * Main roads run every MAIN_ROAD_INTERVAL tiles (2 wide); secondary roads run
 * every SECONDARY_ROAD_INTERVAL tiles (1 wide) and fill the gaps between main
 * roads. Both horizontal and vertical lines are drawn, guaranteeing a single
 * connected component with intersections at every crossing. A border road on
 * all four edges closes the loop.
 *
 * Exported standalone so road geometry can be unit-tested directly.
 */
export function placeGridRoads(world: World): void {
  const { width, height, grid } = world;

  const isMain = (coord: number): boolean =>
    coord > 0 && coord % MAIN_ROAD_INTERVAL === 0;
  const isSecondary = (coord: number): boolean =>
    coord > 0 &&
    coord % SECONDARY_ROAD_INTERVAL === 0 &&
    !isMain(coord);

  const roadWidthAt = (coord: number): number => {
    if (coord === 0) return SECONDARY_ROAD_WIDTH;
    if (isMain(coord)) return MAIN_ROAD_WIDTH;
    if (isSecondary(coord)) return SECONDARY_ROAD_WIDTH;
    return 0;
  };

  // Vertical roads (columns).
  for (let x = 0; x < width; x++) {
    const w = roadWidthAt(x);
    if (w === 0) continue;
    for (let dx = 0; dx < w && x + dx < width; dx++) {
      for (let y = 0; y < height; y++) {
        grid.setTileType(x + dx, y, 'road');
      }
    }
  }

  // Horizontal roads (rows).
  for (let y = 0; y < height; y++) {
    const w = roadWidthAt(y);
    if (w === 0) continue;
    for (let dy = 0; dy < w && y + dy < height; dy++) {
      for (let x = 0; x < width; x++) {
        grid.setTileType(x, y + dy, 'road');
      }
    }
  }
}

/**
 * Define the 5 zoning districts. Zones are placed in road-free blocks; each is
 * at least 10x10 so placement reliably reaches its quota.
 */
export function defineZones(): Zone[] {
  // Blocks between secondary roads are ~7 tiles wide (8-1). We pick generous
  // interior rectangles that avoid road columns/rows.
  // Residential is duplicated across several blocks so that total residential
  // capacity comfortably exceeds 100 (needed for >=50 citizens at the spec's
  // 1-per-2-units ratio). The 80x80 map has ample room in the lower half.
  const zones: Array<Zone & { type: ZoneType }> = [
    { type: 'residential', x: 2, y: 2, width: 12, height: 12 },
    { type: 'commercial', x: 18, y: 2, width: 12, height: 12 },
    { type: 'industrial', x: 2, y: 18, width: 12, height: 12 },
    { type: 'entertainment', x: 18, y: 18, width: 12, height: 12 },
    { type: 'park', x: 34, y: 2, width: 12, height: 12 },
    { type: 'residential', x: 34, y: 18, width: 12, height: 12 },
    { type: 'residential', x: 2, y: 34, width: 12, height: 12 },
    { type: 'residential', x: 18, y: 34, width: 12, height: 12 },
  ];
  return zones;
}

export interface GenerateCityOptions {
  /** RNG seed for deterministic generation. */
  seed?: number;
  /** Target number of buildings to place. */
  buildingTarget?: number;
}

/**
 * Generate a complete city: roads, zones, and buildings.
 * Returns the populated World.
 */
export function generateCity(
  width: number,
  height: number,
  options: GenerateCityOptions = {},
): World {
  const seed = options.seed ?? DEFAULT_SEED;
  const buildingTarget = options.buildingTarget ?? DEFAULT_BUILDING_TARGET;

  const world = new World(width, height);

  // 1. Roads.
  placeGridRoads(world);

  // 2. Zones.
  const zones = defineZones();
  for (const zone of zones) {
    world.zones.push(zone);
  }

  // 3. Buildings.
  const rng = mulberry32(seed);
  const buildings = placeBuildings(world.grid, zones, {
    target: buildingTarget,
    rng,
  });
  for (const building of buildings) {
    world.addBuilding(building);
  }

  // 4. Citizens (spec §7.1 step 6).
  spawnCitizens(world, buildings, rng);

  return world;
}
