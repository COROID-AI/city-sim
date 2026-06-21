import {
  DEFAULT_GRID_HEIGHT,
  DEFAULT_GRID_WIDTH,
  DEFAULT_SEED,
  EMPLOYMENT_ZONES,
  MAIN_ROAD_INTERVAL,
  MAIN_ROAD_WIDTH,
  SECONDARY_ROAD_INTERVAL,
  SECONDARY_ROAD_WIDTH,
  STREET_LIGHT_INTERVAL,
  ZONE_BOUNDS,
  ZONE_TYPES,
  CITIZEN_DENSITY,
  VEHICLE_DENSITY,
  MAX_CITIZENS,
  MAX_VEHICLES,
} from '@/constants';
import type {
  Building,
  Citizen,
  StreetLight,
  TileType,
  Vehicle,
  ZoneBounds,
  ZoneType,
} from '@/engine/types';
import {
  applyRoadToGrid,
  createWorld,
  Grid,
  isMainRoadIndex,
  isSecondaryRoadIndex,
  type World,
} from '@/engine/World';
import { TileType as TileTypeEnum } from '@/engine/types';

function mulberry32(seed: number): () => number {
  // eslint-disable-next-line no-bitwise
  let t = seed >>> 0;
  return () => {
    // eslint-disable-next-line no-bitwise
    t = (t + 0x6d2b79f5) >>> 0;
    // eslint-disable-next-line no-bitwise
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    // eslint-disable-next-line no-bitwise
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    // eslint-disable-next-line no-bitwise
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeZoneRecord(): Record<ZoneType, ZoneBounds> {
  return {
    residential: { ...ZONE_BOUNDS.residential, type: 'residential' },
    commercial: { ...ZONE_BOUNDS.commercial, type: 'commercial' },
    industrial: { ...ZONE_BOUNDS.industrial, type: 'industrial' },
    entertainment: { ...ZONE_BOUNDS.entertainment, type: 'entertainment' },
    park: { ...ZONE_BOUNDS.park, type: 'park' },
  };
}

function setZonesOnGrid(grid: Grid, zones: Record<ZoneType, ZoneBounds>): void {
  for (const zoneType of ZONE_TYPES) {
    const b = zones[zoneType];
    for (let y = b.minY; y < b.maxY; y += 1) {
      for (let x = b.minX; x < b.maxX; x += 1) {
        // Don't tag roads/streets as zones.
        const v = grid.getTile(x, y);
        if (v === TileTypeEnum.Road) continue;
        grid.setTile(x, y, grid.getTile(x, y) ?? 0);
      }
    }
  }
}

function isRoad(grid: Grid, x: number, y: number): boolean {
  return grid.getTile(x, y) === TileTypeEnum.Road || grid.getTile(x, y) === (TileTypeEnum.Road | TileTypeEnum.StreetLight);
}

function getZoneAt(zones: Record<ZoneType, ZoneBounds>, x: number, y: number): ZoneType | undefined {
  for (const z of ZONE_TYPES) {
    const b = zones[z];
    if (x >= b.minX && x < b.maxX && y >= b.minY && y < b.maxY) return z;
  }
  return undefined;
}

function computeBuildableCells(zones: Record<ZoneType, ZoneBounds>, grid: Grid): Array<{ x: number; y: number; zone: ZoneType }> {
  const cells: Array<{ x: number; y: number; zone: ZoneType }> = [];

  for (const z of ZONE_TYPES) {
    const b = zones[z];
    for (let y = b.minY; y < b.maxY; y += 1) {
      for (let x = b.minX; x < b.maxX; x += 1) {
        if (grid.getTile(x, y) !== TileTypeEnum.Empty) continue;
        cells.push({ x, y, zone: z });
      }
    }
  }

  return cells;
}

function isAdjacentToRoad(grid: Grid, x: number, y: number): boolean {
  const neighbors = grid.getNeighbors(x, y);
  return neighbors.some((n) => n.value === TileTypeEnum.Road || n.value === (TileTypeEnum.Road | TileTypeEnum.StreetLight));
}

function rectFits(grid: Grid, x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && y >= 0 && x + w <= grid.width && y + h <= grid.height;
}

function canPlaceBuilding(grid: Grid, x: number, y: number, w: number, h: number): boolean {
  if (!rectFits(grid, x, y, w, h)) return false;
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const v = grid.getTile(xx, yy);
      if (v === undefined) return false;
      if (v !== TileTypeEnum.Empty) return false;
      if (isRoad(grid, xx, yy)) return false;
    }
  }
  return true;
}

function placeBuilding(grid: Grid, building: Building): void {
  for (let yy = building.y; yy < building.y + building.height; yy += 1) {
    for (let xx = building.x; xx < building.x + building.width; xx += 1) {
      grid.setTile(xx, yy, TileTypeEnum.Building);
    }
  }
}

function placeGridRoads(grid: Grid): void {
  // Main roads: multiples of 16, width 2
  for (let i = 0; i < grid.width; i += 1) {
    if (isMainRoadIndex(i)) {
      applyRoadToGrid(grid, 'main', 'x', i);
    }
  }
  for (let j = 0; j < grid.height; j += 1) {
    if (isMainRoadIndex(j)) {
      applyRoadToGrid(grid, 'main', 'y', j);
    }
  }

  // Secondary: multiples of 8 excluding main, width 1
  for (let i = 0; i < grid.width; i += 1) {
    if (isSecondaryRoadIndex(i)) {
      applyRoadToGrid(grid, 'secondary', 'x', i);
    }
  }
  for (let j = 0; j < grid.height; j += 1) {
    if (isSecondaryRoadIndex(j)) {
      applyRoadToGrid(grid, 'secondary', 'y', j);
    }
  }
}

function placeBuildingsInZone(grid: Grid, zones: Record<ZoneType, ZoneBounds>, rand: () => number): Building[] {
  const buildings: Building[] = [];

  const sizesByZone: Record<ZoneType, Array<{ w: number; h: number }>> = {
    residential: [
      { w: 2, h: 2 },
      { w: 3, h: 2 },
    ],
    commercial: [
      { w: 3, h: 2 },
      { w: 2, h: 3 },
      { w: 3, h: 3 },
    ],
    industrial: [
      { w: 4, h: 2 },
      { w: 4, h: 3 },
    ],
    entertainment: [
      { w: 3, h: 3 },
      { w: 4, h: 2 },
    ],
    park: [{ w: 2, h: 2 }],
  };

  const buildable = computeBuildableCells(zones, grid);

  // Greedy: shuffle buildable cells by PRNG and try placing.
  for (let i = buildable.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = buildable[i]!;
    buildable[i] = buildable[j]!;
    buildable[j] = tmp;
  }

  const targetBuildings = Math.max(
    10,
    Math.min(
      220,
      Math.floor((grid.width * grid.height) * 0.012)
    )
  );

  const byZoneQuota: Record<ZoneType, number> = {
    residential: Math.floor(targetBuildings * 0.45),
    commercial: Math.floor(targetBuildings * 0.25),
    industrial: Math.floor(targetBuildings * 0.17),
    entertainment: Math.floor(targetBuildings * 0.08),
    park: targetBuildings - (Math.floor(targetBuildings * 0.45) + Math.floor(targetBuildings * 0.25) + Math.floor(targetBuildings * 0.17) + Math.floor(targetBuildings * 0.08)),
  };

  const placedByZone: Record<ZoneType, number> = {
    residential: 0,
    commercial: 0,
    industrial: 0,
    entertainment: 0,
    park: 0,
  };

  for (const cell of buildable) {
    const zone = cell.zone;
    if (placedByZone[zone] >= byZoneQuota[zone]) continue;

    if (!isAdjacentToRoad(grid, cell.x, cell.y)) continue;

    const candidates = sizesByZone[zone];
    const chosen = candidates[Math.floor(rand() * candidates.length)]!;

    // Keep buildings within zone bounds.
    const b = zones[zone];
    const x = cell.x;
    const y = cell.y;
    if (x < b.minX || y < b.minY) continue;
    if (x + chosen.w > b.maxX || y + chosen.h > b.maxY) continue;

    if (!canPlaceBuilding(grid, x, y, chosen.w, chosen.h)) continue;

    const id = `b_${zone}_${buildings.length}`;
    const building: Building = { id, zone, x, y, width: chosen.w, height: chosen.h };
    placeBuilding(grid, building);
    buildings.push(building);
    placedByZone[zone] += 1;
  }

  return buildings;
}

function placeStreetLights(grid: Grid, zones: Record<ZoneType, ZoneBounds>): StreetLight[] {
  const lights: StreetLight[] = [];

  const isRoadTile = (x: number, y: number): boolean => {
    const v = grid.getTile(x, y);
    return v === TileTypeEnum.Road || v === (TileTypeEnum.Road | TileTypeEnum.StreetLight);
  };

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (!isRoadTile(x, y)) continue;

      // Place a light at the start of each road segment and then every interval.
      const atIntersection = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ].some(({ dx, dy }) => isRoadTile(x + dx, y + dy));

      const intervalOk = (x + y) % STREET_LIGHT_INTERVAL === 0;
      if (!atIntersection && !intervalOk) continue;

      // Avoid double placement.
      const current = grid.getTile(x, y);
      if (current === (TileTypeEnum.Road | TileTypeEnum.StreetLight)) continue;

      grid.setTile(x, y, TileTypeEnum.Road | TileTypeEnum.StreetLight);
      lights.push({ id: `l_${lights.length}`, x, y });

      // Reduce over-dense lighting on wide road tiles.
      if (MAIN_ROAD_WIDTH === 2) {
        // no-op; still deterministic.
      }
    }
  }

  // Ensure zones are non-road: keep unused param to satisfy future extension.
  void zones;
  return lights;
}

function spawnCitizens(grid: Grid, zones: Record<ZoneType, ZoneBounds>, rand: () => number, buildings: Building[]): Citizen[] {
  const residentialBuildings = buildings.filter((b) => b.zone === 'residential');

  const candidateHomes: Array<{ x: number; y: number; b: Building }> = [];
  for (const b of residentialBuildings) {
    const cx = b.x + Math.floor(b.width / 2);
    const cy = b.y + Math.floor(b.height / 2);
    candidateHomes.push({ x: cx, y: cy, b });
  }

  if (candidateHomes.length === 0) return [];

  const target = Math.min(
    MAX_CITIZENS,
    Math.max(1, Math.floor(candidateHomes.length * CITIZEN_DENSITY * 10))
  );

  const employment: Array<{ zone: ZoneType }> = EMPLOYMENT_ZONES.map((z) => ({ zone: z } as const));

  const citizens: Citizen[] = [];
  for (let i = 0; i < target; i += 1) {
    const home = candidateHomes[Math.floor(rand() * candidateHomes.length)]!;
    const workZone = employment[Math.floor(rand() * employment.length)]!.zone;

    citizens.push({
      id: `c_${i}`,
      position: { x: home.x, y: home.y },
      homeZone: 'residential',
      workZone,
    });
  }

  return citizens;
}

function assignJobs(citizens: Citizen[], buildings: Building[], rand: () => number): void {
  const workBuildings = buildings.filter((b) => b.zone === 'commercial' || b.zone === 'industrial');
  if (workBuildings.length === 0) return;

  for (const citizen of citizens) {
    const candidate = workBuildings[Math.floor(rand() * workBuildings.length)]!;
    citizen.workZone = candidate.zone;
  }
}

function spawnVehicles(grid: Grid, rand: () => number): Vehicle[] {
  const roadTiles: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (grid.getTile(x, y) === TileTypeEnum.Road) roadTiles.push({ x, y });
    }
  }

  if (roadTiles.length === 0) return [];

  const target = Math.min(
    MAX_VEHICLES,
    Math.max(1, Math.floor(roadTiles.length * VEHICLE_DENSITY))
  );

  const vehicles: Vehicle[] = [];
  for (let i = 0; i < target; i += 1) {
    const tile = roadTiles[Math.floor(rand() * roadTiles.length)]!;
    vehicles.push({ id: `v_${i}`, position: { x: tile.x, y: tile.y } });
  }

  // Touch rand to keep determinism stable for future modifications.
  void rand;
  return vehicles;
}

export type GenerateCityOptions = {
  seed?: number;
};

export function generateCity(width: number = DEFAULT_GRID_WIDTH, height: number = DEFAULT_GRID_HEIGHT, options: GenerateCityOptions = {}): World {
  if (!Number.isInteger(width) || width <= 0) throw new Error('width must be a positive integer');
  if (!Number.isInteger(height) || height <= 0) throw new Error('height must be a positive integer');

  const seed = options.seed ?? DEFAULT_SEED;
  const rand = mulberry32(seed);

  const zones = makeZoneRecord();
  const world = createWorld(width, height, zones);

  placeGridRoads(world.grid);

  // Buildings should not overlap roads; grid starts as Empty.
  const buildings = placeBuildingsInZone(world.grid, zones, rand);
  world.buildings = buildings;

  world.streetLights = placeStreetLights(world.grid, zones);

  // Citizens + jobs.
  const citizens = spawnCitizens(world.grid, zones, rand, buildings);
  assignJobs(citizens, buildings, rand);
  world.citizens = citizens;

  world.vehicles = spawnVehicles(world.grid, rand);

  return world;
}
