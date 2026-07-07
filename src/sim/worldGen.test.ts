import { createWorld } from './world';
import { tileAt } from './world';
import { generateCity, ROAD_SPACING, DEFAULT_CITY_SEED } from './worldGen';
import { findRoadPath } from './pathfinding';
import {
  getBuildingAt,
  randomBuildingOfKind,
  nearestRoadTile,
} from './queries';
import { createRng } from './rng';
import type { BuildingKind, World } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCity(seed: number = DEFAULT_CITY_SEED): World {
  const world = createWorld();
  generateCity(world, seed);
  return world;
}

// ─── generateCity ────────────────────────────────────────────────────────────

describe('generateCity', () => {
  it('places at least 20 buildings', () => {
    const world = makeCity();
    expect(world.buildings.size).toBeGreaterThanOrEqual(20);
  });

  it('produces a mix of all four building kinds', () => {
    const world = makeCity();
    const kinds = new Set(Array.from(world.buildings.values()).map((b) => b.kind));
    expect(kinds.has('HOME')).toBe(true);
    expect(kinds.has('WORK')).toBe(true);
    expect(kinds.has('ENTERTAINMENT')).toBe(true);
    expect(kinds.has('CIVIC')).toBe(true);
  });

  it('places at least one of each required kind for citizen schedules', () => {
    const world = makeCity();
    const counts: Record<BuildingKind, number> = {
      HOME: 0,
      WORK: 0,
      ENTERTAINMENT: 0,
      CIVIC: 0,
    };
    for (const b of world.buildings.values()) counts[b.kind]++;
    expect(counts.HOME).toBeGreaterThanOrEqual(1);
    expect(counts.WORK).toBeGreaterThanOrEqual(1);
    expect(counts.ENTERTAINMENT).toBeGreaterThanOrEqual(1);
    expect(counts.CIVIC).toBeGreaterThanOrEqual(1);
  });

  it('gives every building a name, position, footprint, and capacity', () => {
    const world = makeCity();
    for (const b of world.buildings.values()) {
      expect(typeof b.name).toBe('string');
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.position.x).toBeGreaterThanOrEqual(0);
      expect(b.position.y).toBeGreaterThanOrEqual(0);
      expect(b.size.width).toBeGreaterThanOrEqual(1);
      expect(b.size.height).toBeGreaterThanOrEqual(1);
      expect(b.capacity).toBeGreaterThanOrEqual(1);
    }
  });

  it('does not place buildings on top of each other (no tile overlap)', () => {
    const world = makeCity();
    // Every building's footprint tiles should carry that building's ID.
    for (const b of world.buildings.values()) {
      for (let dy = 0; dy < b.size.height; dy++) {
        for (let dx = 0; dx < b.size.width; dx++) {
          const tile = tileAt(world, b.position.x + dx, b.position.y + dy);
          expect(tile).toBeDefined();
          expect(tile!.terrain).toBe('BUILDING');
          expect(tile!.buildingId).toBe(b.id);
        }
      }
    }
  });

  it('keeps buildings off road tiles', () => {
    const world = makeCity();
    for (const tile of world.tiles) {
      if (tile.terrain === 'ROAD') {
        expect(tile.buildingId).toBeNull();
      }
    }
  });

  it('is deterministic: identical seeds produce identical layouts', () => {
    const a = makeCity(12345);
    const b = makeCity(12345);
    const sa = JSON.stringify(Array.from(a.buildings.values()));
    const sb = JSON.stringify(Array.from(b.buildings.values()));
    expect(sa).toEqual(sb);
  });

  it('produces different layouts for different seeds', () => {
    const a = makeCity(1);
    const b = makeCity(2);
    const sa = JSON.stringify(Array.from(a.buildings.values()));
    const sb = JSON.stringify(Array.from(b.buildings.values()));
    expect(sa).not.toEqual(sb);
  });

  it('works with an explicit seed argument', () => {
    const world = createWorld();
    expect(world.buildings.size).toBe(0);
    generateCity(world, 999);
    expect(world.buildings.size).toBeGreaterThanOrEqual(20);
  });
});

// ─── Road network ────────────────────────────────────────────────────────────

describe('road network', () => {
  it('contains road tiles after generation', () => {
    const world = makeCity();
    const roadCount = world.tiles.filter((t) => t.terrain === 'ROAD').length;
    expect(roadCount).toBeGreaterThan(0);
  });

  it('lays roads on the expected grid lines', () => {
    const world = makeCity();
    // Column 0 should be entirely road.
    for (let y = 0; y < world.height; y++) {
      expect(tileAt(world, 0, y)!.terrain).toBe('ROAD');
    }
    // Row 0 should be entirely road.
    for (let x = 0; x < world.width; x++) {
      expect(tileAt(world, x, 0)!.terrain).toBe('ROAD');
    }
    // ROAD_SPACING columns should be roads.
    for (let y = 0; y < world.height; y++) {
      expect(tileAt(world, ROAD_SPACING, y)!.terrain).toBe('ROAD');
    }
  });

  it('is fully connected: any two road tiles have a path', () => {
    const world = makeCity();
    const roads = world.tiles.filter((t) => t.terrain === 'ROAD');
    expect(roads.length).toBeGreaterThanOrEqual(2);

    // Sample a subset of road tiles to test connectivity.
    const samples = roads.filter((_, i) => i % 50 === 0).slice(0, 8);
    expect(samples.length).toBeGreaterThanOrEqual(2);

    const start = samples[0]!;
    const end = samples[samples.length - 1]!;
    const path = findRoadPath(
      world,
      { x: start.x, y: start.y },
      { x: end.x, y: end.y },
    );
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
  });
});

// ─── findRoadPath ────────────────────────────────────────────────────────────

describe('findRoadPath', () => {
  it('returns a single-element path when start === goal', () => {
    const world = makeCity();
    const path = findRoadPath(world, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(path).toEqual([{ x: 0, y: 0 }]);
  });

  it('returns null when start is not a road tile', () => {
    const world = makeCity();
    // Find a non-road tile to use as an invalid start.
    const grass = world.tiles.find((t) => t.terrain === 'GRASS');
    expect(grass).toBeDefined();
    const path = findRoadPath(world, { x: grass!.x, y: grass!.y }, { x: 0, y: 0 });
    expect(path).toBeNull();
  });

  it('returns null when goal is not a road tile', () => {
    const world = makeCity();
    const grass = world.tiles.find((t) => t.terrain === 'GRASS');
    expect(grass).toBeDefined();
    const path = findRoadPath(world, { x: 0, y: 0 }, { x: grass!.x, y: grass!.y });
    expect(path).toBeNull();
  });

  it('returns a path that starts at the start tile and ends at the goal', () => {
    const world = makeCity();
    const path = findRoadPath(world, { x: 0, y: 0 }, { x: ROAD_SPACING, y: 0 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: ROAD_SPACING, y: 0 });
  });

  it('every step of the path is on a road tile and is 4-adjacent', () => {
    const world = makeCity();
    const path = findRoadPath(world, { x: 0, y: 0 }, { x: ROAD_SPACING, y: ROAD_SPACING });
    expect(path).not.toBeNull();
    for (let i = 0; i < path!.length; i++) {
      const p = path![i]!;
      const tile = tileAt(world, p.x, p.y);
      expect(tile!.terrain).toBe('ROAD');
      if (i > 0) {
        const prev = path![i - 1]!;
        const manhattan = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
        expect(manhattan).toBe(1);
      }
    }
  });

  it('returns null for unreachable coordinates (out of bounds)', () => {
    const world = makeCity();
    const path = findRoadPath(world, { x: 0, y: 0 }, { x: -1, y: 0 });
    expect(path).toBeNull();
  });

  it('finds paths between randomly chosen road tiles', () => {
    const world = makeCity();
    const rng = createRng(42);
    const roads = world.tiles.filter((t) => t.terrain === 'ROAD');
    for (let trial = 0; trial < 5; trial++) {
      const a = rng.pick(roads);
      const b = rng.pick(roads);
      const path = findRoadPath(world, { x: a.x, y: a.y }, { x: b.x, y: b.y });
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);
    }
  });
});

// ─── Queries: getBuildingAt ─────────────────────────────────────────────────

describe('getBuildingAt', () => {
  it('returns the building whose footprint covers the tile', () => {
    const world = makeCity();
    const building = world.buildings.values().next().value;
    expect(building).toBeDefined();
    if (!building) return;
    const result = getBuildingAt(world, building.position.x, building.position.y);
    expect(result?.id).toBe(building.id);
  });

  it('returns the building for any tile in its footprint', () => {
    const world = makeCity();
    for (const b of world.buildings.values()) {
      const cx = b.position.x + b.size.width - 1;
      const cy = b.position.y + b.size.height - 1;
      expect(getBuildingAt(world, cx, cy)?.id).toBe(b.id);
      break;
    }
  });

  it('returns undefined for an empty grass tile', () => {
    const world = makeCity();
    const grass = world.tiles.find((t) => t.terrain === 'GRASS' && t.buildingId === null);
    expect(grass).toBeDefined();
    expect(getBuildingAt(world, grass!.x, grass!.y)).toBeUndefined();
  });

  it('returns undefined for a road tile', () => {
    const world = makeCity();
    expect(getBuildingAt(world, 0, 0)).toBeUndefined();
  });

  it('returns undefined for out-of-bounds coordinates', () => {
    const world = makeCity();
    expect(getBuildingAt(world, -1, -1)).toBeUndefined();
    expect(getBuildingAt(world, world.width, world.height)).toBeUndefined();
  });
});

// ─── Queries: randomBuildingOfKind ──────────────────────────────────────────

describe('randomBuildingOfKind', () => {
  it('returns a building of the requested kind', () => {
    const world = makeCity();
    const rng = createRng(100);
    const result = randomBuildingOfKind(world, 'HOME', rng);
    expect(result?.kind).toBe('HOME');
  });

  it('returns undefined when no building of that kind exists', () => {
    const world = createWorld();
    const rng = createRng(100);
    expect(randomBuildingOfKind(world, 'HOME', rng)).toBeUndefined();
  });

  it('is deterministic for the same seed', () => {
    const world = makeCity();
    const a = randomBuildingOfKind(world, 'WORK', createRng(555));
    const b = randomBuildingOfKind(world, 'WORK', createRng(555));
    expect(a?.id).toBe(b?.id);
  });

  it('returns each kind when requested', () => {
    const world = makeCity();
    const rng = createRng(100);
    const kinds: BuildingKind[] = ['HOME', 'WORK', 'ENTERTAINMENT', 'CIVIC'];
    for (const kind of kinds) {
      const result = randomBuildingOfKind(world, kind, rng);
      expect(result?.kind).toBe(kind);
    }
  });
});

// ─── Queries: nearestRoadTile ───────────────────────────────────────────────

describe('nearestRoadTile', () => {
  it('returns the same coordinate when the tile is itself a road', () => {
    const world = makeCity();
    const result = nearestRoadTile(world, 0, 0);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('finds a road tile for a non-road position', () => {
    const world = makeCity();
    const grass = world.tiles.find((t) => t.terrain === 'GRASS');
    expect(grass).toBeDefined();
    const result = nearestRoadTile(world, grass!.x, grass!.y);
    expect(result).not.toBeNull();
    const tile = tileAt(world, result!.x, result!.y);
    expect(tile!.terrain).toBe('ROAD');
  });

  it('finds a road tile near a building', () => {
    const world = makeCity();
    const building = world.buildings.values().next().value;
    expect(building).toBeDefined();
    if (!building) return;
    const result = nearestRoadTile(world, building.position.x, building.position.y);
    expect(result).not.toBeNull();
    expect(tileAt(world, result!.x, result!.y)!.terrain).toBe('ROAD');
  });

  it('returns null when no roads exist', () => {
    const world = createWorld();
    expect(nearestRoadTile(world, 5, 5)).toBeNull();
  });

  it('handles out-of-bounds query coordinates gracefully', () => {
    const world = makeCity();
    // Out of bounds origin — should still find a road via expanding ring.
    const result = nearestRoadTile(world, -3, -3);
    expect(result).not.toBeNull();
    expect(tileAt(world, result!.x, result!.y)!.terrain).toBe('ROAD');
  });
});
