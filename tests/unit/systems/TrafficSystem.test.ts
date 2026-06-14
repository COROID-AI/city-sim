/**
 * Unit tests for the TrafficSystem (src/systems/TrafficSystem.ts).
 *
 * Happy path: phase cycle progresses NS_green → all_red → EW_green → all_red.
 * Failure path: isGreenAt is true everywhere except detected
 * intersections during an all-red phase.
 */

import { TrafficSystem, detectIntersectionsFromGraph, TileOccupancy } from '@/systems/TrafficSystem';
import { buildRoadGraph, type RoadWorldView } from '@/entities/Road';
import type { Tile, TileCoord, WorldBounds } from '@/engine/types';

function makeWorld(bounds: WorldBounds, kindAt: (x: number, y: number) => Tile['kind']): RoadWorldView {
  const tiles: Tile[] = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      tiles.push({ coord: { x, y }, kind: kindAt(x, y), elevation: 0 });
    }
  }
  return {
    bounds,
    getTile(coord: TileCoord) {
      if (coord.x < 0 || coord.y < 0 || coord.x >= bounds.width || coord.y >= bounds.height) {
        return null;
      }
      return tiles[coord.y * bounds.width + coord.x] ?? null;
    },
    *tiles_() {
      for (const t of tiles) yield t;
    },
  };
}

describe('TrafficSystem — intersection detection', () => {
  it('detects a 4-way intersection in a cross-shaped network', () => {
    // Plus-sign: a vertical column of roads at x=1, plus a horizontal row at y=1.
    const world = makeWorld({ width: 3, height: 3 }, (x, y) => (x === 1 || y === 1 ? 'road' : 'ground'));
    const g = buildRoadGraph(world);
    const intersections = detectIntersectionsFromGraph(g, world.bounds);
    expect(intersections).toEqual([{ x: 1, y: 1 }]);
  });

  it('does NOT classify T-junctions as intersections', () => {
    // A T: vertical line of roads at x=0, plus horizontal bar only at y=2.
    const world = makeWorld({ width: 3, height: 3 }, (x, y) => (x === 0 || y === 2 ? 'road' : 'ground'));
    const g = buildRoadGraph(world);
    const intersections = detectIntersectionsFromGraph(g, world.bounds);
    expect(intersections.length).toBe(0);
  });
});

describe('TrafficSystem — phase cycle', () => {
  it('progresses through the four phases in order', () => {
    const world = makeWorld({ width: 3, height: 3 }, (x, y) => (x === 1 || y === 1 ? 'road' : 'ground'));
    const g = buildRoadGraph(world);
    const ts = new TrafficSystem(g, world.bounds, {
      phaseDurations: {
        NS_green: 1,
        NS_to_EW_all_red: 1,
        EW_green: 1,
        EW_to_NS_all_red: 1,
      },
    });
    expect(ts.phase).toBe('NS_green');
    ts.advance(1);
    expect(ts.phase).toBe('NS_to_EW_all_red');
    ts.advance(1);
    expect(ts.phase).toBe('EW_green');
    ts.advance(1);
    expect(ts.phase).toBe('EW_to_NS_all_red');
    ts.advance(1);
    expect(ts.phase).toBe('NS_green'); // wraps
  });

  it('isGreenAt is true during green phases at the intersection', () => {
    const world = makeWorld({ width: 3, height: 3 }, (x, y) => (x === 1 || y === 1 ? 'road' : 'ground'));
    const g = buildRoadGraph(world);
    const ts = new TrafficSystem(g, world.bounds, {
      phaseDurations: { NS_green: 100, NS_to_EW_all_red: 100, EW_green: 100, EW_to_NS_all_red: 100 },
    });
    expect(ts.isGreenAt({ x: 1, y: 1 })).toBe(true); // NS_green
    ts.advance(100);
    expect(ts.phase).toBe('NS_to_EW_all_red');
    expect(ts.isGreenAt({ x: 1, y: 1 })).toBe(false);
  });

  it('isGreenAt is true everywhere outside detected intersections', () => {
    const world = makeWorld({ width: 3, height: 3 }, (x, y) => (x === 1 || y === 1 ? 'road' : 'ground'));
    const g = buildRoadGraph(world);
    const ts = new TrafficSystem(g, world.bounds, {
      initialPhase: 'NS_to_EW_all_red',
    });
    // (0,1) is a road but NOT an intersection.
    expect(ts.isGreenAt({ x: 0, y: 1 })).toBe(true);
    // (1,1) IS an intersection.
    expect(ts.isGreenAt({ x: 1, y: 1 })).toBe(false);
  });

  it('rejects negative or non-finite dt', () => {
    const world = makeWorld({ width: 3, height: 3 }, (x, y) => (x === 1 || y === 1 ? 'road' : 'ground'));
    const g = buildRoadGraph(world);
    const ts = new TrafficSystem(g, world.bounds);
    expect(() => ts.advance(-1)).toThrow(RangeError);
    expect(() => ts.advance(Number.NaN)).toThrow(RangeError);
  });
});

describe('TileOccupancy', () => {
  it('adds, has, deletes, and clears', () => {
    const occ = new TileOccupancy();
    occ.add({ x: 1, y: 2 });
    occ.add({ x: 3, y: 4 });
    expect(occ.size).toBe(2);
    expect(occ.has({ x: 1, y: 2 })).toBe(true);
    expect(occ.has({ x: 3, y: 4 })).toBe(true);
    expect(occ.has({ x: 0, y: 0 })).toBe(false);
    occ.delete({ x: 1, y: 2 });
    expect(occ.size).toBe(1);
    occ.clear();
    expect(occ.size).toBe(0);
  });
});
