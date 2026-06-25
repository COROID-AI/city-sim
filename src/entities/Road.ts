/**
 * Road — sparse road-graph extraction from the tile grid (spec §5.6).
 *
 * Architecture decisions (see plan notes):
 *  - Nodes are placed ONLY at intersections and building-entrance tiles. A
 *    road tile is an intersection when it has road neighbours in BOTH the
 *    horizontal and vertical axes, OR more than two road neighbours (a
 *    junction / T-junction / dead-end corner). Mid-segment road tiles are
 *    traversed during edge construction but are not stored as nodes.
 *  - Edges are built by "walking" from each node along each of the four
 *    cardinal directions over contiguous road tiles until another node is
 *    reached; the edge weight is the Manhattan distance between the two
 *    endpoints. This yields a sparse graph (~200 nodes on an 80x80 grid)
 *    instead of one node per road tile (~6400).
 *  - Building-entrance nodes are created on road tiles that are 4-adjacent to
 *    any non-road, occupied tile (buildingId !== null). One entrance node per
 *    such road tile keeps entrances reachable while preserving sparsity.
 */
import type { RoadEdge, RoadGraph, RoadNode } from '@/engine/types';
import type { Grid } from '@/engine/World';

/** Orthogonal neighbour offsets (4-connectivity), as [dx, dy]. */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Build the stable node id for a grid coordinate.
 * Kept as a function so producers and consumers never disagree on format.
 */
export function nodeId(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Whether a tile at (x,y) is a road tile. Out-of-bounds tiles are not roads.
 */
function isRoad(grid: Grid, x: number, y: number): boolean {
  const tile = grid.getTile(x, y);
  return tile !== null && tile.type === 'road';
}

/**
 * Count the road neighbours of (x,y) and report axis presence.
 */
function roadNeighbours(
  grid: Grid,
  x: number,
  y: number,
): { count: number; hasH: boolean; hasV: boolean } {
  let count = 0;
  let hasH = false;
  let hasV = false;
  for (const [dx, dy] of DIRS) {
    if (isRoad(grid, x + dx, y + dy)) {
      count++;
      if (dx !== 0) hasH = true;
      if (dy !== 0) hasV = true;
    }
  }
  return { count, hasH, hasV };
}

/**
 * Whether a road tile at (x,y) is adjacent to a building (non-road occupied
 * tile). Such tiles become building-entrance nodes.
 */
function isAdjacentToBuilding(grid: Grid, x: number, y: number): boolean {
  for (const [dx, dy] of DIRS) {
    const tile = grid.getTile(x + dx, y + dy);
    if (tile === null) continue;
    if (tile.type === 'road') continue;
    // Any non-road tile that is occupied by a building counts as an entrance
    // candidate. We do not require a specific building type here.
    if (tile.buildingId !== null) return true;
  }
  return false;
}

/**
 * Decide whether a road tile should become a graph node.
 *
 * A road tile becomes a node when it is:
 *  - an intersection: road neighbours in BOTH horizontal and vertical axes,
 *    OR more than two road neighbours (junctions / T-junctions); or
 *  - a building entrance: 4-adjacent to an occupied non-road tile.
 *
 * Dead-ends (1 neighbour) and straight segments (2 collinear neighbours) are
 * NOT nodes unless they are also building entrances.
 */
export function isNodeTile(grid: Grid, x: number, y: number): boolean {
  if (!isRoad(grid, x, y)) return false;
  const { count, hasH, hasV } = roadNeighbours(grid, x, y);
  if (count > 2 || (hasH && hasV)) return true;
  return isAdjacentToBuilding(grid, x, y);
}

/**
 * Collect all graph nodes from the grid.
 * Returns a Map keyed by node id for O(1) membership checks during edge
 * construction.
 */
function collectNodes(grid: Grid): Map<string, RoadNode> {
  const nodes = new Map<string, RoadNode>();
  grid.forEach((tile) => {
    if (tile.type !== 'road') return;
    if (!isNodeTile(grid, tile.x, tile.y)) return;
    const id = nodeId(tile.x, tile.y);
    if (nodes.has(id)) return;
    const isEntrance = isAdjacentToBuilding(grid, tile.x, tile.y);
    nodes.set(id, {
      id,
      x: tile.x,
      y: tile.y,
      kind: isEntrance ? 'entrance' : 'intersection',
    });
  });
  return nodes;
}

/**
 * From a node at (x,y), walk in direction (dx,dy) over contiguous road tiles
 * until another node is reached or the road ends. If another node is reached,
 * add an edge between them with weight = Manhattan distance.
 *
 * Returns true if an edge was added.
 */
function walkAndConnect(
  grid: Grid,
  nodes: Map<string, RoadNode>,
  edges: Map<string, RoadEdge[]>,
  from: RoadNode,
  dx: number,
  dy: number,
): void {
  let cx = from.x + dx;
  let cy = from.y + dy;
  let steps = 1;

  while (isRoad(grid, cx, cy)) {
    const id = nodeId(cx, cy);
    if (nodes.has(id)) {
      // Reached another node: connect them. Weight is Manhattan distance,
      // which for an axis-aligned walk equals the number of steps taken.
      const weight = Math.abs(cx - from.x) + Math.abs(cy - from.y);
      addEdge(edges, from.id, id, weight);
      return;
    }
    // Continue along the same direction. If the road bends (a perpendicular
    // road neighbour appears but this tile is not a node), we still follow the
    // current direction as long as it stays on a road tile. This keeps edge
    // construction simple and correct for the grid road layout.
    cx += dx;
    cy += dy;
    steps++;
    // Safety guard against infinite loops on malformed grids.
    if (steps > grid.width * grid.height) return;
  }
}

/**
 * Add an undirected edge between two nodes (both directions). Duplicate edges
 * between the same pair are tolerated (the walk only fires once per node per
 * direction, but defensive de-dup keeps the graph clean).
 */
function addEdge(
  edges: Map<string, RoadEdge[]>,
  fromId: string,
  toId: string,
  weight: number,
): void {
  if (fromId === toId) return;
  const listA = edges.get(fromId) ?? [];
  if (!listA.some((e) => e.to === toId)) {
    listA.push({ from: fromId, to: toId, weight });
    edges.set(fromId, listA);
  }
  const listB = edges.get(toId) ?? [];
  if (!listB.some((e) => e.to === fromId)) {
    listB.push({ from: toId, to: fromId, weight });
    edges.set(toId, listB);
  }
}

/**
 * Build the adjacency list by walking from every node in all four directions.
 */
function buildEdges(
  grid: Grid,
  nodes: Map<string, RoadNode>,
): Map<string, RoadEdge[]> {
  const edges = new Map<string, RoadEdge[]>();
  for (const node of nodes.values()) {
    for (const [dx, dy] of DIRS) {
      walkAndConnect(grid, nodes, edges, node, dx, dy);
    }
  }
  return edges;
}

/**
 * Extract the sparse road graph from a tile grid.
 *
 * Nodes are placed at intersections and building entrances; edges connect
 * nodes along contiguous road segments with weight = Manhattan distance.
 *
 * @param grid The city grid to extract from.
 * @returns The extracted {@link RoadGraph}.
 */
export function extractRoadGraph(grid: Grid): RoadGraph {
  const nodes = collectNodes(grid);
  const edges = buildEdges(grid, nodes);
  return { nodes, edges };
}

/**
 * Find the graph node nearest to a world/grid point.
 *
 * Uses Manhattan distance for selection (consistent with the graph weighting).
 * Returns null when the graph has no nodes.
 *
 * @param graph The road graph.
 * @param x     Grid column / world x.
 * @param y     Grid row / world y.
 */
export function getNearestNode(
  graph: RoadGraph,
  x: number,
  y: number,
): RoadNode | null {
  let best: RoadNode | null = null;
  let bestDist = Infinity;
  for (const node of graph.nodes.values()) {
    const dist = Math.abs(node.x - x) + Math.abs(node.y - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = node;
    }
  }
  return best;
}
