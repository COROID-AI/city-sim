/**
 * CityGenerator + Grid + BuildingPlacer tests.
 *
 * Covers spec §7.1 acceptance criteria:
 *  - Grid dimensions and getTile/queryRange/getNeighbors4 behavior.
 *  - Road geometry (main every 16 / 2-wide, secondary every 8 / 1-wide).
 *  - 5 zone types each populated with at least one building.
 *  - >=20 buildings, no overlaps, road adjacency.
 *  - Road network is a single connected component (BFS).
 */
import { Grid, World } from '@/engine/World';
import {
  computeCitizenCount,
  generateCity,
  placeGridRoads,
  MAIN_ROAD_INTERVAL,
  SECONDARY_ROAD_INTERVAL,
} from '@/generation/CityGenerator';
import {
  isAdjacentToRoad,
  mulberry32,
  placeBuildings,
} from '@/generation/BuildingPlacer';
import type { ZoneType } from '@/engine/types';

describe('Grid', () => {
  it('creates exactly width*height tiles and getTile returns valid tiles in-bounds, null OOB', () => {
    const grid = new Grid(80, 80);
    expect(grid.size).toBe(80 * 80);
    expect(grid.width).toBe(80);
    expect(grid.height).toBe(80);

    // Corners and center are valid.
    expect(grid.getTile(0, 0)).not.toBeNull();
    expect(grid.getTile(79, 79)).not.toBeNull();
    expect(grid.getTile(40, 40)).not.toBeNull();

    // Out of bounds returns null.
    expect(grid.getTile(-1, 0)).toBeNull();
    expect(grid.getTile(0, -1)).toBeNull();
    expect(grid.getTile(80, 0)).toBeNull();
    expect(grid.getTile(0, 80)).toBeNull();
  });

  it('setTileType mutates the tile type', () => {
    const grid = new Grid(10, 10);
    grid.setTileType(3, 4, 'road');
    const tile = grid.getTile(3, 4);
    expect(tile).not.toBeNull();
    expect(tile!.type).toBe('road');
    expect(tile!.buildable).toBe(false);
  });

  it('queryRange returns the correct rectangular tile set', () => {
    const grid = new Grid(80, 80);
    const region = grid.queryRange(0, 0, 4, 4);
    expect(region.length).toBe(16);

    // Clipping: partially out-of-bounds returns only in-bounds tiles.
    const clipped = grid.queryRange(78, 78, 4, 4);
    expect(clipped.length).toBe(4); // 2x2 corner
  });

  it('getNeighbors4 returns up to 4 orthogonal in-bounds neighbors', () => {
    const grid = new Grid(10, 10);
    // Corner tile has 2 neighbors.
    expect(grid.getNeighbors4(0, 0).length).toBe(2);
    // Center tile has 4 neighbors.
    expect(grid.getNeighbors4(5, 5).length).toBe(4);
  });
});

describe('CityGenerator road network', () => {
  it('places main roads every 16 tiles (2 wide) and secondary roads every 8 tiles (1 wide)', () => {
    const world = new World(80, 80);
    placeGridRoads(world);

    // Main road columns at x=16,32,48,64 should be 2 tiles wide.
    for (const mx of [MAIN_ROAD_INTERVAL, 32, 48, 64]) {
      expect(world.grid.getTile(mx, 40)!.type).toBe('road');
      expect(world.grid.getTile(mx + 1, 40)!.type).toBe('road');
    }

    // Secondary road columns at x=8,24,40,56,72 should be roads (1 wide).
    for (const sx of [
      SECONDARY_ROAD_INTERVAL,
      24,
      40,
      56,
      72,
    ]) {
      expect(world.grid.getTile(sx, 40)!.type).toBe('road');
    }

    // A non-road column should remain grass.
    expect(world.grid.getTile(5, 5)!.type).toBe('grass');
  });

  it('forms a single connected road component (BFS)', () => {
    const world = generateCity(80, 80);
    expect(world.grid.isRoadConnected()).toBe(true);
  });
});

describe('CityGenerator zones and buildings', () => {
  const world = generateCity(80, 80);

  it('defines all 5 zone types with explicit bounds', () => {
    const zoneTypes = new Set(world.zones.map((z) => z.type));
    const expected: ZoneType[] = [
      'residential',
      'commercial',
      'industrial',
      'entertainment',
      'park',
    ];
    for (const zt of expected) {
      expect(zoneTypes.has(zt)).toBe(true);
    }
    expect(world.zones.length).toBeGreaterThanOrEqual(5);
  });

  it('places at least 20 building footprints', () => {
    expect(world.buildings.size).toBeGreaterThanOrEqual(20);
  });

  it('has no two buildings sharing any grid cell', () => {
    const occupied = new Set<string>();
    for (const building of world.buildings.values()) {
      for (let dy = 0; dy < building.height; dy++) {
        for (let dx = 0; dx < building.width; dx++) {
          const key = `${building.x + dx},${building.y + dy}`;
          expect(occupied.has(key)).toBe(false);
          occupied.add(key);
        }
      }
    }
  });

  it('every building footprint has at least one edge tile adjacent to a road', () => {
    for (const building of world.buildings.values()) {
      expect(
        isAdjacentToRoad(
          world.grid,
          building.x,
          building.y,
          building.width,
          building.height,
        ),
      ).toBe(true);
    }
  });

  it('populates each of the 5 zone types with at least one building', () => {
    const populated = new Set<ZoneType>();
    for (const building of world.buildings.values()) {
      populated.add(building.zone);
    }
    const expected: ZoneType[] = [
      'residential',
      'commercial',
      'industrial',
      'entertainment',
      'park',
    ];
    for (const zt of expected) {
      expect(populated.has(zt)).toBe(true);
    }
  });
});

describe('BuildingPlacer determinism', () => {
  it('produces identical output for the same seed', () => {
    const worldA = generateCity(80, 80, { seed: 42 });
    const worldB = generateCity(80, 80, { seed: 42 });
    expect(worldA.buildings.size).toBe(worldB.buildings.size);
    const a = Array.from(worldA.buildings.values());
    const b = Array.from(worldB.buildings.values());
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBe(b[i].x);
      expect(a[i].y).toBe(b[i].y);
      expect(a[i].type).toBe(b[i].type);
    }
  });

  it('mulberry32 is deterministic for a fixed seed', () => {
    const r1 = mulberry32(123);
    const r2 = mulberry32(123);
    for (let i = 0; i < 10; i++) {
      expect(r1()).toBe(r2());
    }
  });

  it('placeBuildings respects road adjacency on a hand-built grid', () => {
    // 10x10 grid with a single road column at x=0.
    const grid = new Grid(10, 10);
    for (let y = 0; y < 10; y++) {
      grid.setTileType(0, y, 'road');
    }
    const zones = [
      { type: 'residential' as ZoneType, x: 1, y: 0, width: 9, height: 10 },
    ];
    const buildings = placeBuildings(grid, zones, {
      target: 5,
      rng: mulberry32(7),
    });
    expect(buildings.length).toBeGreaterThanOrEqual(1);
    for (const b of buildings) {
      expect(
        isAdjacentToRoad(grid, b.x, b.y, b.width, b.height),
      ).toBe(true);
    }
  });
});

describe('CityGenerator citizen spawning', () => {
  const world = generateCity(80, 80);

  it('spawns between 50 and 100 citizens', () => {
    expect(world.citizens.length).toBeGreaterThanOrEqual(50);
    expect(world.citizens.length).toBeLessThanOrEqual(100);
  });

  it('every citizen has a homeId pointing to a valid residential building', () => {
    for (const citizen of world.citizens) {
      expect(citizen.homeId).not.toBeNull();
      const home = world.buildings.get(citizen.homeId!);
      expect(home).toBeDefined();
      expect(home!.zone).toBe('residential');
    }
  });

  it('every citizen has a 24-entry schedule with jitter in [-30, 30]', () => {
    for (const citizen of world.citizens) {
      expect(citizen.schedule).toHaveLength(24);
      for (const entry of citizen.schedule) {
        expect(entry.jitterMinutes).toBeGreaterThanOrEqual(-30);
        expect(entry.jitterMinutes).toBeLessThanOrEqual(30);
      }
    }
  });

  it('employed citizens have a workplaceId pointing to a job building', () => {
    const employmentZones = new Set<ZoneType>([
      'commercial',
      'industrial',
      'entertainment',
    ]);
    for (const citizen of world.citizens) {
      if (citizen.employed) {
        expect(citizen.workplaceId).not.toBeNull();
        const wp = world.buildings.get(citizen.workplaceId!);
        expect(wp).toBeDefined();
        expect(employmentZones.has(wp!.zone)).toBe(true);
      } else {
        expect(citizen.workplaceId).toBeNull();
      }
    }
  });

  it('every citizen starts positioned at the center of their home building', () => {
    for (const citizen of world.citizens) {
      const home = world.buildings.get(citizen.homeId!)!;
      const pos = citizen.getPosition();
      expect(pos.x).toBeCloseTo(home.x + home.width / 2, 5);
      expect(pos.y).toBeCloseTo(home.y + home.height / 2, 5);
    }
  });

  it('produces deterministic citizen count for the same seed', () => {
    const a = generateCity(80, 80, { seed: 42 });
    const b = generateCity(80, 80, { seed: 42 });
    expect(a.citizens.length).toBe(b.citizens.length);
  });

  it('computeCitizenCount caps at MAX_CITIZENS', () => {
    // Build a fake building list with huge residential capacity.
    const fakeBuilding = {
      id: 'r1',
      type: 'apartment' as const,
      zone: 'residential' as const,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      def: { capacity: 1000 } as never,
    };
    expect(computeCitizenCount([fakeBuilding])).toBe(100);
  });
});
