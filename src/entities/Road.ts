/**
 * Road graph extraction.
 *
 * A `RoadGraph` is a compact representation of the road network suitable
 * for A* pathfinding and traffic-light analysis. It is built from a `World`
 * by scanning every tile once: a tile with `kind: 'road'` becomes a node,
 * and a 4-connected neighbour that is also a road becomes an undirected
 * edge of weight 1.
 *
 * Layer rule: this module is an *entity*. It must NOT import the engine
 * runtime (`World` is treated as a structural interface here — only
 * `getTile`, `tiles_`, and `bounds` are referenced). All exports are pure
 * TS functions / data.
 */

import type { Tile, TileCoord, WorldBounds } from '@/engine/types';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** A read-only view of the world needed to build a road graph. */
export interface RoadWorldView {
  readonly bounds: WorldBounds;
  getTile(coord: TileCoord): Tile | null;
  tiles_(): IterableIterator<Tile>;
}

/**
 * Compact adjacency representation. The `nodes` array is the source of
 * truth for the canonical key index; the `neighbors` array is parallel,
 * so `neighbors[i]` is the list of neighbour INDICES for node `i`.
 */
export interface RoadGraph {
  /** Number of road nodes. */
  readonly size: number;
  /** Canonical key for node `i`. */
  readonly nodes: ReadonlyArray<TileCoord>;
  /** Parallel-to-`nodes` adjacency list of neighbour indices. */
  readonly neighbors: ReadonlyArray<ReadonlyArray<number>>;
}

/** Result of an orphan-road check. */
export interface OrphanReport {
  /** Number of road tiles that have zero road neighbours. */
  readonly count: number;
  /** Coordinates of every orphan road tile. */
  readonly tiles: ReadonlyArray<TileCoord>;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Cardinal-direction deltas used for 4-neighbour scans. */
const CARDINAL_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
];

/* -------------------------------------------------------------------------- */
/* Graph construction                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Build a `RoadGraph` by scanning every tile of the world. Cost is O(n)
 * in the world tile count and the resulting graph is immutable. Tiles
 * whose kind is anything other than 'road' are excluded.
 *
 * The graph is intended to be built ONCE per world (it does not change
 * at runtime unless roads are added/removed) and shared across all
 * pathfinding callers. See `Pathfinder` for the matching consumer.
 */
export function buildRoadGraph(world: RoadWorldView): RoadGraph {
  // 1. Collect every road tile into the `nodes` array in scan order.
  const nodes: TileCoord[] = [];
  const indexByKey = new Map<string, number>();
  for (const tile of world.tiles_()) {
    if (tile.kind !== 'road') continue;
    const key = coordKey(tile.coord);
    // Defensive: tile scans can yield duplicates if a downstream world
    // implementation is buggy. We keep the first occurrence.
    if (indexByKey.has(key)) continue;
    indexByKey.set(key, nodes.length);
    nodes.push({ x: tile.coord.x, y: tile.coord.y });
  }

  // 2. Build adjacency lists. For each node, look at its 4 cardinal
  //    neighbours. If the neighbour is also a road, add a bidirectional
  //    edge (weight 1 — uniform Manhattan distance).
  const { width, height } = world.bounds;
  const neighbors: number[][] = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    const c = nodes[i]!;
    for (const [dx, dy] of CARDINAL_DELTAS) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = indexByKey.get(coordKey({ x: nx, y: ny }));
      if (j === undefined || j === i) continue;
      neighbors[i]!.push(j);
    }
    // Sort neighbour lists so consumers can rely on a stable iteration
    // order (helpful for deterministic tests and for pathfinder
    // tie-breaking).
    neighbors[i]!.sort((a, b) => a - b);
  }

  return { size: nodes.length, nodes, neighbors };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Return the index of the road node at the given coordinate, or -1 if
 * the coordinate is not a road. Useful for the pathfinder to convert
 * start / goal tile coords into graph indices.
 */
export function indexOfCoord(
  graph: RoadGraph,
  coord: TileCoord,
): number {
  // Linear scan is fine for a graph of this size; the pathfinder is the
  // hot path, not this lookup. We could add a coordinate-key Map in the
  // future if profiling shows it matters.
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i]!;
    if (n.x === coord.x && n.y === coord.y) return i;
  }
  return -1;
}

/**
 * Find the road node closest (in Manhattan distance) to the given
 * coordinate. If the coordinate itself is a road, that node is returned.
 * If no road exists, returns -1.
 *
 * This is the dispatcher the citizen/vehicle handoff uses: a citizen's
 * home or workplace may not be on a road, but we always want to know
 * "what is the nearest road I can board a vehicle from?".
 */
export function findNearestRoadNode(
  graph: RoadGraph,
  coord: TileCoord,
): number {
  if (graph.size === 0) return -1;
  // First, the O(1) exact-match fast path.
  const exact = indexOfCoord(graph, coord);
  if (exact !== -1) return exact;
  // Otherwise, scan every node. For the canonical 80x80 world this is
  // ~5000 nodes — well under a millisecond.
  let bestIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i]!;
    const d = Math.abs(n.x - coord.x) + Math.abs(n.y - coord.y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Return every road tile with ZERO road neighbours (an "island" of
 * width 1 or an isolated piece of road). Used by validation tooling
 * to flag dead-end network fragments.
 */
export function getOrphanRoads(graph: RoadGraph): OrphanReport {
  const tiles: TileCoord[] = [];
  for (let i = 0; i < graph.size; i++) {
    if ((graph.neighbors[i]?.length ?? 0) === 0) {
      tiles.push({ x: graph.nodes[i]!.x, y: graph.nodes[i]!.y });
    }
  }
  return { count: tiles.length, tiles };
}

/**
 * True if the given tile coordinate lies on the road graph.
 */
export function isRoadTile(graph: RoadGraph, coord: TileCoord): boolean {
  return indexOfCoord(graph, coord) !== -1;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/** Stable string key for a coordinate (used in `buildRoadGraph`). */
function coordKey(coord: TileCoord): string {
  return `${coord.x},${coord.y}`;
}
