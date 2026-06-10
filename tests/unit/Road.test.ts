/**
 * Road / graph construction tests.
 */
import { buildRoadGraph, defaultNeighborCost, tileKey, isDriveable } from '@/entities/Road';
import type { RoadGrid } from '@/entities/Road';

function makeGrid(rows: string[]): RoadGrid {
  return rows.map((row) =>
    row.split('').map((c) => {
      if (c === '#') return 'intersection' as const;
      if (c === '.') return 'road' as const;
      return 'empty' as const;
    }),
  );
}

describe('buildRoadGraph', () => {
  it('builds intersections and adjacency on a plus-shaped grid', () => {
    // .#.
    // ###
    // .#.
    // Row 0: road, intersection, road
    // Row 1: intersection, intersection, intersection
    // Row 2: road, intersection, road
    // Total intersections: 5 (1 + 3 + 1).
    const grid = makeGrid(['.#.', '###', '.#.']);
    const g = buildRoadGraph(grid);
    expect(g.intersections.size).toBe(5);
    // Center (1,1) should be adjacent to all 4 other intersections.
    const center = g.intersections.get(tileKey(1, 1));
    expect(center).toBeDefined();
    const centerKeys = center!.neighbors.map((v) => tileKey(v.x, v.y)).sort();
    expect(centerKeys).toEqual(
      [tileKey(0, 1), tileKey(1, 0), tileKey(1, 2), tileKey(2, 1)].sort(),
    );
  });

  it('returns an empty graph for an empty grid', () => {
    const g = buildRoadGraph([]);
    expect(g.intersections.size).toBe(0);
  });

  it('returns an empty graph when no intersections exist', () => {
    const grid = makeGrid(['...', '...']);
    const g = buildRoadGraph(grid);
    expect(g.intersections.size).toBe(0);
  });

  it('isolates intersections that are not connected by roads', () => {
    // Two intersections, with a road tile in between but the road
    // tile is on a perpendicular axis. The cardinal walks must still
    // find a neighbor when the segment is 'road'-collinear.
    // Use two intersections separated by an empty tile - they must be
    // isolated.
    const grid = makeGrid(['#X', 'X#']);
    const g = buildRoadGraph(grid);
    expect(g.intersections.size).toBe(2);
    expect(g.intersections.get(tileKey(0, 0))!.neighbors.length).toBe(0);
    expect(g.intersections.get(tileKey(1, 1))!.neighbors.length).toBe(0);
  });

  it('neighborCost returns 1000 on opposing phase (red-light) and 1 on green', () => {
    const trafficRed = { redLightTiles: new Set([tileKey(1, 0)]), phase: 'NS_GREEN' as const };
    const trafficClear = { redLightTiles: new Set<string>(), phase: 'NS_GREEN' as const };
    expect(defaultNeighborCost({ x: 0, y: 0 }, { x: 1, y: 0 }, trafficRed)).toBe(1000);
    expect(defaultNeighborCost({ x: 0, y: 0 }, { x: 1, y: 0 }, trafficClear)).toBe(1);
  });

  it('isDriveable returns true for road and intersection, false for empty/OOB', () => {
    const grid = makeGrid(['#X', 'X#']);
    // (0,0) is intersection - driveable.
    expect(isDriveable(grid, 0, 0)).toBe(true);
    // (1,0) is empty - not driveable.
    expect(isDriveable(grid, 1, 0)).toBe(false);
    // (0,1) is empty - not driveable.
    expect(isDriveable(grid, 0, 1)).toBe(false);
    // OOB.
    expect(isDriveable(grid, -1, 0)).toBe(false);
    expect(isDriveable(grid, 0, 99)).toBe(false);
  });
});
