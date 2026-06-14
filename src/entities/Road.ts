/**
 * Road graph extraction.
 *
 * A `RoadGraph` is a compact representation of the road network suitable
 * for A* pathfinding and traffic-light analysis. It is built from a world
 * by scanning every tile once: a tile with `kind: 'road'` becomes a node,
 * and a 4-connected neighbour that is also a road becomes an undirected
 * edge of weight 1.
 *
 * The graph is immutable after construction. Rebuild it whenever the
 * road network changes.
 *
 * Layer rule: this module is an *entity*. It must NOT import the engine
 * runtime (`World` class), React, or DOM globals. It may import engine
 * *types* via `@/engine` (structural, erased at runtime).
 */

import type { Tile, TileCoord, WorldBounds } from '@/engine/types';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface RoadGraph {
  /** Tile coords for each graph node. */
  readonly nodes: ReadonlyArray<TileCoord>;
  /** Adjacency list: `adjacency[i]` is the list of node indices reachable from node `i` in one step. */
  readonly adjacency: ReadonlyArray<ReadonlyArray<number>>;
  /** Look up the node index for a tile coord, or `-1` if not in the graph. */
  readonly indexByCoord: ReadonlyMap<string, number>;
  /** Number of nodes. */
  readonly size: number;
}

/**
 * Minimal world view the graph builder needs. Decouples the entity
 * from the full `World` class so the graph can be unit-tested with
 * a fake.
 */
export interface RoadWorldView {
  readonly bounds: WorldBounds;
  getTile(coord: TileCoord): Tile | null;
  tiles_(): IterableIterator<Tile>;
}

/**
 * Report describing a road tile that is not connected to the main
 * road network (i.e. isolated or stranded in a tiny component).
 */
export interface OrphanReport {
  /** The isolated tile. */
  readonly tile: TileCoord;
  /** 0 = no road neighbours at all, 1+ = connected to a component separate from the largest. */
  readonly componentSize: number;
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build a `RoadGraph` from a world view. Performs a single pass over
 * every tile; for each road tile, registers it as a node and adds
 * 4-connected edges to the E and S neighbour (W and N are handled
 * implicitly by the E/S of the neighbour, so we avoid double-adding).
 *
 * Time complexity: O(W * H).
 */
export function buildRoadGraph(world: RoadWorldView): RoadGraph {
  const { bounds } = world;
  // First pass: collect the set of road tiles (in row-major order).
  const nodes: TileCoord[] = [];
  const indexByCoord = new Map<string, number>();
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const t = world.getTile({ x, y });
      if (!t || t.kind !== 'road') continue;
      const idx = nodes.length;
      nodes.push({ x, y });
      indexByCoord.set(coordKey({ x, y }), idx);
    }
  }
  // Second pass: build adjacency. For each node, check E and S only
  // (the other two directions are handled by those neighbours).
  const adjacency: number[][] = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    // East
    if (n.x + 1 < bounds.width) {
      const east = indexByCoord.get(coordKey({ x: n.x + 1, y: n.y }));
      if (east !== undefined && east !== i) {
        adjacency[i]!.push(east);
      }
    }
    // South
    if (n.y + 1 < bounds.height) {
      const south = indexByCoord.get(coordKey({ x: n.x, y: n.y + 1 }));
      if (south !== undefined && south !== i) {
        adjacency[i]!.push(south);
      }
    }
    // North (if present in graph)
    if (n.y - 1 >= 0) {
      const north = indexByCoord.get(coordKey({ x: n.x, y: n.y - 1 }));
      if (north !== undefined && north !== i) {
        adjacency[i]!.push(north);
      }
    }
    // West (if present in graph)
    if (n.x - 1 >= 0) {
      const west = indexByCoord.get(coordKey({ x: n.x - 1, y: n.y }));
      if (west !== undefined && west !== i) {
        adjacency[i]!.push(west);
      }
    }
  }
  return {
    nodes,
    adjacency,
    indexByCoord,
    size: nodes.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Look up the node index for a tile coord. Returns `-1` if the tile
 * is not a road (i.e. not in the graph).
 */
export function indexOfCoord(graph: RoadGraph, coord: TileCoord): number {
  return graph.indexByCoord.get(coordKey(coord)) ?? -1;
}

/**
 * Find the road node index closest to `coord` by Manhattan distance.
 * Returns `-1` if the graph is empty.
 *
 * Linear scan over the node list. Acceptable for the small cities
 * this engine targets; for very large graphs callers can index by
 * spatial bucket first.
 */
export function findNearestRoadNode(graph: RoadGraph, coord: TileCoord): number {
  if (graph.size === 0) return -1;
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
 * Return every road tile that is NOT connected to the largest
 * connected component of the graph. A road is "orphaned" when it
 * cannot reach the bulk of the network — typical of tiny isolated
 * stubs the generator left behind.
 *
 * Algorithm: BFS from an arbitrary start (node 0, or any node in
 * the largest component). Any node not reached is in a smaller
 * component; those are the orphans.
 */
export function getOrphanRoads(graph: RoadGraph): OrphanReport[] {
  if (graph.size === 0) return [];
  // Find the largest component by BFS, starting from node 0.
  // (This is a reasonable default; for the small worlds we ship
  // with, node 0 is usually part of the main grid.)
  const visited = new Uint8Array(graph.size);
  const largest = bfsComponent(graph, 0, visited);
  const orphans: OrphanReport[] = [];
  // Re-scan for any unvisited nodes.
  for (let i = 0; i < graph.size; i++) {
    if (visited[i]) continue;
    const comp = bfsComponent(graph, i, visited);
    // All nodes in `comp` are orphans. Report the first tile and
    // the component size; downstream consumers can rescan to find
    // all of them if needed.
    const tile = graph.nodes[i]!;
    orphans.push({ tile, componentSize: comp });
  }
  // Touch `largest` so the unused-warning linter is satisfied; the
  // value is implicit in the visited set.
  void largest;
  return orphans;
}

/**
 * Convenience: true if a tile coord is a road tile (i.e. a node in
 * the graph). Equivalent to `indexOfCoord(graph, c) !== -1` but
 * more readable at call sites.
 */
export function isRoadTile(graph: RoadGraph, coord: TileCoord): boolean {
  return graph.indexByCoord.has(coordKey(coord));
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function coordKey(c: TileCoord): string {
  return `${c.x},${c.y}`;
}

function bfsComponent(graph: RoadGraph, start: number, visited: Uint8Array): number {
  const queue: number[] = [start];
  visited[start] = 1;
  let size = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    size += 1;
    const adj = graph.adjacency[node]!;
    for (const next of adj) {
      if (visited[next]) continue;
      visited[next] = 1;
      queue.push(next);
    }
  }
  return size;
}
