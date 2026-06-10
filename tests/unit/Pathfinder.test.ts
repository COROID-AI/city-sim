/**
 * A* Pathfinder tests: correctness, unreachable, red-light cost avoidance.
 */
import { buildRoadGraph, defaultNeighborCost, tileKey, type RoadGrid } from '@/entities/Road';
import { findPath, heuristic } from '@/engine/Pathfinder';
import type { Vector2 } from '@/types/common';

function makeGrid(rows: string[]): RoadGrid {
  return rows.map((row) =>
    row.split('').map((c) => {
      if (c === '#') return 'intersection' as const;
      if (c === '.') return 'road' as const;
      return 'empty' as const;
    }),
  );
}

describe('findPath (A*)', () => {
  it('returns the optimal Manhattan-length path on an open grid', () => {
    const grid = makeGrid(['###', '###', '###']);
    const g = buildRoadGraph(grid);
    const path = findPath(g, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5);
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 2, y: 2 });
  });

  it('returns null for an unreachable target', () => {
    const grid = makeGrid(['#.', '.#']);
    const g = buildRoadGraph(grid);
    const path = findPath(g, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(path).toBeNull();
  });

  it('returns [start] when start === goal', () => {
    const grid = makeGrid(['###', '###', '###']);
    const g = buildRoadGraph(grid);
    const path = findPath(g, { x: 1, y: 1 }, { x: 1, y: 1 });
    expect(path).toEqual([{ x: 1, y: 1 }]);
  });

  it('returns null when start or goal is not an intersection', () => {
    const grid = makeGrid(['###', '###', '###']);
    const g = buildRoadGraph(grid);
    expect(findPath(g, { x: 5, y: 5 }, { x: 0, y: 0 })).toBeNull();
    expect(findPath(g, { x: 0, y: 0 }, { x: 5, y: 5 })).toBeNull();
  });

  it('returns null on an empty graph', () => {
    const g = buildRoadGraph([]);
    expect(findPath(g, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it('avoids red-light cost when an alternative green route exists', () => {
    // 3x3 intersection grid. We use the default neighborCost (1000
    // for red tiles). Path (0,0) -> (2,0): the direct middle tile
    // (1,0) is red. The A* should prefer a path that doesn't go
    // through the red tile. This means the path must NOT contain
    // the red intersection, and the cost along the chosen path
    // must not include the 1000 red-light penalty.
    const grid = makeGrid(['###', '###', '###']);
    const g = buildRoadGraph(grid);
    const traffic = {
      redLightTiles: new Set([tileKey(1, 0)]),
      phase: 'NS_GREEN' as const,
    };
    const path = findPath(g, { x: 0, y: 0 }, { x: 2, y: 0 }, { traffic });
    expect(path).not.toBeNull();
    // The red tile (1,0) must NOT appear on the chosen path.
    expect(path!.some((p: Vector2) => p.x === 1 && p.y === 0)).toBe(false);
  });

  it('heuristic is the Manhattan distance', () => {
    expect(heuristic({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
    expect(heuristic({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(0);
  });

  it('defaultNeighborCost returns 1 for clear tiles and 1000 for red tiles', () => {
    const trafficClear = { redLightTiles: new Set<string>(), phase: 'NS_GREEN' as const };
    const trafficRed = { redLightTiles: new Set([tileKey(1, 0)]), phase: 'NS_GREEN' as const };
    expect(defaultNeighborCost({ x: 0, y: 0 }, { x: 1, y: 0 }, trafficClear)).toBe(1);
    expect(defaultNeighborCost({ x: 0, y: 0 }, { x: 1, y: 0 }, trafficRed)).toBe(1000);
  });
});
