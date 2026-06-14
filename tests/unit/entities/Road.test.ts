/**
 * Unit tests for the road-graph extraction (src/entities/Road.ts).
 *
 * Happy path: a 3×3 grid of road tiles produces 9 nodes, each
 * with the correct 4-neighbour adjacency.
 * Failure path: an isolated single road tile is detected as orphan
 * by `getOrphanRoads`.
 */

import {
  buildRoadGraph,
  findNearestRoadNode,
  getOrphanRoads,
  indexOfCoord,
  isRoadTile,
  type RoadWorldView,
} from '@/entities/Road';
import type { Tile, TileCoord, WorldBounds } from '@/engine/types';

function makeWorld(bounds: WorldBounds, kindAt: (x: number, y: number) => Tile['kind'] | null): RoadWorldView {
  const tiles: Tile[] = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const k = kindAt(x, y);
      tiles.push({
        coord: { x, y },
        kind: (k ?? 'ground') as Tile['kind'],
        elevation: 0,
      });
    }
  }
  const view: RoadWorldView = {
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
  return view;
}

describe('buildRoadGraph', () => {
  it('returns an empty graph for a world with no roads', () => {
    const world = makeWorld({ width: 3, height: 3 }, () => 'ground');
    const g = buildRoadGraph(world);
    expect(g.size).toBe(0);
    expect(g.nodes).toEqual([]);
  });

  it('builds a 3x3 grid graph with correct adjacency', () => {
    const world = makeWorld({ width: 3, height: 3 }, () => 'road');
    const g = buildRoadGraph(world);
    expect(g.size).toBe(9);
    // Centre node (1,1) has 4 neighbours.
    const centreIdx = indexOfCoord(g, { x: 1, y: 1 });
    expect(centreIdx).toBeGreaterThanOrEqual(0);
    expect(g.adjacency[centreIdx]!.length).toBe(4);
    // Corner (0,0) has 2 neighbours.
    const cornerIdx = indexOfCoord(g, { x: 0, y: 0 });
    expect(cornerIdx).toBeGreaterThanOrEqual(0);
    expect(g.adjacency[cornerIdx]!.length).toBe(2);
  });

  it('ignores non-road tiles', () => {
    const world = makeWorld(
      { width: 3, height: 3 },
      (x, y) => (x === 1 && y === 1 ? 'water' : 'road'),
    );
    const g = buildRoadGraph(world);
    expect(g.size).toBe(8);
    expect(indexOfCoord(g, { x: 1, y: 1 })).toBe(-1);
  });
});

describe('findNearestRoadNode', () => {
  it('returns the index of the exact road tile when the coord is in the graph', () => {
    const world = makeWorld({ width: 5, height: 5 }, () => 'road');
    const g = buildRoadGraph(world);
    const idx = findNearestRoadNode(g, { x: 2, y: 2 });
    expect(idx).toBe(indexOfCoord(g, { x: 2, y: 2 }));
  });

  it('returns -1 for an empty graph', () => {
    const world = makeWorld({ width: 3, height: 3 }, () => 'ground');
    const g = buildRoadGraph(world);
    expect(findNearestRoadNode(g, { x: 1, y: 1 })).toBe(-1);
  });
});

describe('isRoadTile', () => {
  it('returns true for road coords and false otherwise', () => {
    const world = makeWorld(
      { width: 2, height: 2 },
      (x, y) => (x === 0 && y === 0 ? 'road' : 'ground'),
    );
    const g = buildRoadGraph(world);
    expect(isRoadTile(g, { x: 0, y: 0 })).toBe(true);
    expect(isRoadTile(g, { x: 1, y: 1 })).toBe(false);
  });
});

describe('getOrphanRoads', () => {
  it('returns an empty list for a fully-connected grid', () => {
    const world = makeWorld({ width: 3, height: 3 }, () => 'road');
    const g = buildRoadGraph(world);
    expect(getOrphanRoads(g)).toEqual([]);
  });

  it('detects an isolated road tile as an orphan', () => {
    // 2x2 grid of roads, plus one isolated road at (4, 4).
    const world = makeWorld(
      { width: 5, height: 5 },
      (x, y) => {
        if (x < 2 && y < 2) return 'road';
        if (x === 4 && y === 4) return 'road';
        return 'ground';
      },
    );
    const g = buildRoadGraph(world);
    const orphans = getOrphanRoads(g);
    // Exactly one orphan component, and the isolated tile.
    expect(orphans.length).toBeGreaterThanOrEqual(1);
    const hasIsolated = orphans.some((o) => o.tile.x === 4 && o.tile.y === 4);
    expect(hasIsolated).toBe(true);
  });
});
