/**
 * Road graph extraction tests (spec §5.6).
 *
 * Covers: intersection detection, building-entrance node creation, edge
 * connectivity, node-count sparsity on an 80x80 grid, and the
 * getNearestNode helper.
 */
import type { Grid } from '@/engine/World';
import {
  extractRoadGraph,
  getNearestNode,
  isNodeTile,
  nodeId,
} from '@/entities/Road';
import { generateCity, placeGridRoads } from '@/generation/CityGenerator';
import { World } from '@/engine/World';

describe('Road graph extraction', () => {
  /**
   * Build a small plus-shaped road so (5,5) is a true intersection (neighbours
   * in both H and V axes) while the arms are straight segments.
   */
  function buildPlusGrid(): Grid {
    const world = new World(11, 11);
    const { grid } = world;
    // Horizontal arm.
    for (let x = 0; x < 11; x++) grid.setTileType(x, 5, 'road');
    // Vertical arm.
    for (let y = 0; y < 11; y++) grid.setTileType(5, y, 'road');
    return grid;
  }

  describe('isNodeTile / intersection detection', () => {
    it('marks a crossing as an intersection node', () => {
      const grid = buildPlusGrid();
      expect(isNodeTile(grid, 5, 5)).toBe(true);
    });

    it('does NOT mark a straight mid-segment tile as a node', () => {
      const grid = buildPlusGrid();
      // (2,5) is on the horizontal arm, two collinear neighbours only.
      expect(isNodeTile(grid, 2, 5)).toBe(false);
    });

    it('marks a dead-end corner (1 neighbour) as a node only if entrance', () => {
      const world = new World(5, 5);
      const { grid } = world;
      // Single road tile at (0,0) with one neighbour to the right.
      grid.setTileType(0, 0, 'road');
      grid.setTileType(1, 0, 'road');
      // (1,0) has a single road neighbour -> dead-end, not a node.
      expect(isNodeTile(grid, 1, 0)).toBe(false);
    });

    it('marks a T-junction (>2 road neighbours) as a node', () => {
      const world = new World(5, 5);
      const { grid } = world;
      grid.setTileType(2, 2, 'road');
      grid.setTileType(1, 2, 'road');
      grid.setTileType(3, 2, 'road');
      grid.setTileType(2, 3, 'road');
      // (2,2) has 3 road neighbours -> T-junction.
      expect(isNodeTile(grid, 2, 2)).toBe(true);
    });
  });

  describe('building-entrance nodes', () => {
    it('creates an entrance node on a road tile adjacent to a building', () => {
      const world = new World(5, 5);
      const { grid } = world;
      // Road along the middle row.
      for (let x = 0; x < 5; x++) grid.setTileType(x, 2, 'road');
      // Building above the road at (2,1).
      const tile = grid.getTile(2, 1)!;
      tile.type = 'residential';
      tile.buildingId = 'b1';

      const graph = extractRoadGraph(grid);
      // (2,2) is a straight segment but adjacent to a building -> entrance.
      expect(graph.nodes.has(nodeId(2, 2))).toBe(true);
      const node = graph.nodes.get(nodeId(2, 2))!;
      expect(node.kind).toBe('entrance');
    });

    it('does not create entrance nodes when no building is adjacent', () => {
      const grid = buildPlusGrid();
      const graph = extractRoadGraph(grid);
      for (const node of graph.nodes.values()) {
        // In a pure plus-grid with no buildings, every node is an intersection.
        expect(node.kind).toBe('intersection');
      }
    });
  });

  describe('edge connectivity', () => {
    it('connects intersection nodes along contiguous road segments', () => {
      // Use a grid with two crossing lines PLUS building entrances along the
      // arms so that intermediate nodes exist and edges connect them.
      const world = new World(11, 11);
      const { grid } = world;
      for (let x = 0; x < 11; x++) grid.setTileType(x, 5, 'road');
      for (let y = 0; y < 11; y++) grid.setTileType(5, y, 'road');
      // Add buildings adjacent to the horizontal arm to create entrance nodes.
      for (let x = 1; x <= 4; x++) {
        const above = grid.getTile(x, 4)!;
        above.type = 'residential';
        above.buildingId = `b-${x}`;
      }
      const graph = extractRoadGraph(grid);

      // The centre intersection must now have edges to entrance nodes.
      const centerId = nodeId(5, 5);
      const centerEdges = graph.edges.get(centerId) ?? [];
      expect(centerEdges.length).toBeGreaterThan(0);
      // Each edge weight equals Manhattan distance between endpoints.
      for (const edge of centerEdges) {
        const from = graph.nodes.get(edge.from)!;
        const to = graph.nodes.get(edge.to)!;
        const expected = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
        expect(edge.weight).toBe(expected);
      }
    });

    it('produces undirected edges (both directions present)', () => {
      const world = new World(11, 11);
      const { grid } = world;
      for (let x = 0; x < 11; x++) grid.setTileType(x, 5, 'road');
      for (let y = 0; y < 11; y++) grid.setTileType(5, y, 'road');
      // Add a couple of entrance nodes so edges exist.
      const a = grid.getTile(2, 4)!;
      a.type = 'residential';
      a.buildingId = 'b1';
      const b = grid.getTile(8, 6)!;
      b.type = 'commercial';
      b.buildingId = 'b2';
      const graph = extractRoadGraph(grid);
      for (const [fromId, outs] of graph.edges.entries()) {
        for (const edge of outs) {
          const reverse = (graph.edges.get(edge.to) ?? []).some(
            (e) => e.to === fromId,
          );
          expect(reverse).toBe(true);
        }
      }
    });
  });

  describe('sparsity on 80x80 generated city', () => {
    it('produces far fewer nodes than road tiles (sparse graph)', () => {
      const world = new World(80, 80);
      placeGridRoads(world);
      const graph = extractRoadGraph(world.grid);

      // Count total road tiles for comparison.
      let roadTiles = 0;
      world.grid.forEach((t) => {
        if (t.type === 'road') roadTiles++;
      });

      expect(graph.nodes.size).toBeLessThan(roadTiles);
      // The grid road layout (2-wide main roads every 16, 1-wide secondary
      // every 8) yields a node set that is meaningfully smaller than the raw
      // road-tile count (nodes only at intersections / entrances, not every
      // tile). Assert a strict sparsity ratio: nodes must be fewer than the
      // total road tiles by a clear margin.
      expect(graph.nodes.size).toBeLessThan(roadTiles * 0.9);
      expect(graph.nodes.size).toBeGreaterThan(0);
    });

    it('every node has at least one edge (no isolated nodes) on the grid', () => {
      const world = new World(80, 80);
      placeGridRoads(world);
      const graph = extractRoadGraph(world.grid);
      for (const id of graph.nodes.keys()) {
        const outs = graph.edges.get(id) ?? [];
        expect(outs.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getNearestNode', () => {
    it('returns the closest node by Manhattan distance', () => {
      const grid = buildPlusGrid();
      const graph = extractRoadGraph(grid);
      const nearest = getNearestNode(graph, 5, 5);
      expect(nearest).not.toBeNull();
      expect(nearest!.x).toBe(5);
      expect(nearest!.y).toBe(5);
    });

    it('returns null for an empty graph', () => {
      const world = new World(5, 5);
      const graph = extractRoadGraph(world.grid);
      expect(getNearestNode(graph, 0, 0)).toBeNull();
    });
  });

  describe('integration with generateCity(80,80)', () => {
    it('extracts a non-empty graph from a fully generated city', () => {
      const world = generateCity(80, 80);
      const graph = extractRoadGraph(world.grid);
      expect(graph.nodes.size).toBeGreaterThan(0);
      // Entrance nodes should exist because the city has buildings.
      const entrances = [...graph.nodes.values()].filter(
        (n) => n.kind === 'entrance',
      );
      expect(entrances.length).toBeGreaterThan(0);
    });
  });
});
