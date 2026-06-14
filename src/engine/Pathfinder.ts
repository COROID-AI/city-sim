/**
 * A* pathfinder over a 4-connected road graph.
 *
 * Implementation notes:
 *  - The open set is a binary min-heap keyed by `f = g + h`.
 *  - The heuristic is Manhattan distance — admissible (never over-estimates)
 *    on a 4-neighbour grid with uniform edge weights. Admissibility is the
 *    key property: it guarantees A* returns an optimal path.
 *  - A `maxNodes` cap is enforced so a malformed / disconnected graph can
 *    never hang the simulation. When the cap is hit, `findPath` returns
 *    `null` and the caller can fall back to a straight-line approach.
 *  - The pathfinder holds the graph as a const reference; it does not
 *    mutate the graph. The same `Pathfinder` instance is therefore safe
 *    to share across all vehicles in a tick.
 *  - Reusing a single instance also means the closed-set Map can be
 *    retained between calls if we ever want to; for v1 we keep it
 *    per-call to avoid state leaks and to keep the API trivially testable.
 *
 * Engine layer rule: pure TS, no React, no DOM. Uses only structural
 * types so the file can be unit-tested without spinning up a world.
 */

import type { TileCoord } from './types';
import { indexOfCoord, type RoadGraph } from '@/entities/Road';

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

export interface PathfinderOptions {
  /**
   * Maximum number of nodes the A* expansion may visit before giving up.
   * Defaults to 5000 — enough for an 80x80 world with a dense 2-tile
   * road grid, low enough to bound the worst-case tick cost. Pass a
   * lower value to make the pathfinder more aggressive about failing
   * fast (e.g. for batched nightly commute requests).
   */
  readonly maxNodes?: number;
}

export interface PathfinderStats {
  /** Nodes expanded before returning. `0` if the start == goal. */
  readonly expanded: number;
  /** Length of the returned path (in tiles), or 0 for a no-op. */
  readonly pathLength: number;
  /** True if the search was abandoned because it hit `maxNodes`. */
  readonly capped: boolean;
}

export interface PathResult {
  /** Tile coords from `start` to `goal` (both inclusive). */
  readonly path: ReadonlyArray<TileCoord>;
  readonly stats: PathfinderStats;
}

/* -------------------------------------------------------------------------- */
/* Class                                                                      */
/* -------------------------------------------------------------------------- */

const DEFAULT_MAX_NODES = 5000;

/**
 * A* pathfinder. Construct with a `RoadGraph` and (optionally) override
 * the `maxNodes` cap. Call `findPath` with tile coordinates that exist
 * in the graph; if either endpoint is off the road, the call returns
 * `null`.
 */
export class Pathfinder {
  private readonly graph: RoadGraph;
  private readonly maxNodes: number;

  constructor(graph: RoadGraph, options: PathfinderOptions = {}) {
    this.graph = graph;
    const m = options.maxNodes ?? DEFAULT_MAX_NODES;
    if (!Number.isInteger(m) || m <= 0) {
      throw new RangeError(`Pathfinder: maxNodes must be a positive integer (got ${m})`);
    }
    this.maxNodes = m;
  }

  /** Expose the graph for read-only callers (e.g. for diagnostics). */
  get roadGraph(): RoadGraph {
    return this.graph;
  }

  /** Expose the node cap (read-only). */
  get cap(): number {
    return this.maxNodes;
  }

  /**
   * Find the shortest path between two tile coordinates. Both endpoints
   * MUST lie on the road graph (use `findNearestRoadNode` from
   * `entities/Road` to snap arbitrary coords to roads).
   *
   * Returns:
   *  - `null` if either endpoint is not on the graph, or if the search
   *    exhausted `maxNodes` without reaching the goal.
   *  - A `PathResult` whose `path` is a `TileCoord[]` (start..goal,
   *    inclusive) and whose `stats.expanded` is the number of nodes
   *    the search popped from the heap.
   */
  findPath(start: TileCoord, goal: TileCoord): PathResult | null {
    const startIdx = indexOfCoord(this.graph, start);
    const goalIdx = indexOfCoord(this.graph, goal);
    if (startIdx === -1 || goalIdx === -1) return null;

    // Fast path: start === goal.
    if (startIdx === goalIdx) {
      return {
        path: [start],
        stats: { expanded: 0, pathLength: 1, capped: false },
      };
    }

    const goalCoord = this.graph.nodes[goalIdx]!;
    const { nodes, neighbors } = this.graph;
    const n = nodes.length;

    // gScore[i] = best known cost from start to i. Use Float64 infinity
    // sentinel. All costs are non-negative integers, so we use a single
    // typed-array-of-objects-via-Map isn't faster than two flat arrays.
    const gScore = new Float64Array(n);
    for (let i = 0; i < n; i++) gScore[i] = Number.POSITIVE_INFINITY;
    gScore[startIdx] = 0;

    // cameFrom[i] = predecessor index on the best path so far, or -1
    // for the start node.
    const cameFrom = new Int32Array(n);
    for (let i = 0; i < n; i++) cameFrom[i] = -1;

    // closed[i] = true once the node has been popped (i.e. its optimal
    // f-score is known). Boolean arrays are not used because jsdom's
    // performance for typed arrays is fine but we want a flat memory
    // layout; Uint8Array gives us that.
    const closed = new Uint8Array(n);

    // Open set as a binary heap of node INDICES, ordered by f-score.
    // We use parallel arrays (heapF) instead of wrapping each entry so
    // the inner loop is allocation-free.
    const heap: number[] = [];
    const heapF: number[] = [];
    pushHeap(heap, heapF, startIdx, heuristic(nodes[startIdx]!, goalCoord));
    let expanded = 0;
    let capped = false;

    while (heap.length > 0) {
      // Honour the cap. expanded counts pops (not pushes).
      if (expanded >= this.maxNodes) {
        capped = true;
        break;
      }
      const current = popHeap(heap, heapF);
      expanded++;
      if (current === goalIdx) {
        return {
          path: reconstructPath(nodes, cameFrom, current),
          stats: { expanded, pathLength: 0, capped: false },
        };
      }
      closed[current] = 1;
      const gCurrent = gScore[current]!;
      const neigh = neighbors[current] ?? [];
      for (let k = 0; k < neigh.length; k++) {
        const nb = neigh[k]!;
        if (closed[nb]) continue;
        const tentativeG = gCurrent + 1; // uniform edge weight
        if (tentativeG < gScore[nb]!) {
          cameFrom[nb] = current;
          gScore[nb] = tentativeG;
          const f = tentativeG + heuristic(nodes[nb]!, goalCoord);
          pushHeap(heap, heapF, nb, f);
        }
      }
    }

    // Exhausted the open set (goal unreachable) or hit the cap.
    if (capped) return null;
    // If we got here with a non-empty closed set, the goal is
    // unreachable from the start. We return null either way — callers
    // can treat null as "give up, route by other means".
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/** Manhattan distance — admissible on a 4-connected grid. */
function heuristic(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Walk the `cameFrom` chain from `goalIdx` back to the start, then
 * reverse to get start → goal. Length is bounded by the number of nodes
 * in the graph.
 */
function reconstructPath(
  nodes: ReadonlyArray<TileCoord>,
  cameFrom: Int32Array,
  goalIdx: number,
): TileCoord[] {
  const out: TileCoord[] = [];
  let cur: number = goalIdx;
  // Safety bound: at most `nodes.length` steps. Use a while(true) with
  // a hard cap so a corrupt `cameFrom` (cycle) cannot hang the engine.
  const cap = nodes.length + 1;
  let safety = 0;
  while (cur !== -1 && safety < cap) {
    const node = nodes[cur]!;
    out.push(node);
    cur = cameFrom[cur]!;
    safety++;
  }
  out.reverse();
  return out;
}

/* -------------------------------------------------------------------------- */
/* Binary heap                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Min-heap push. We use parallel arrays (`heap` for indices, `heapF` for
 * their f-score) so we don't allocate a wrapper object per node — this
 * is the hot inner loop of A* and allocation pressure matters.
 */
function pushHeap(heap: number[], heapF: number[], idx: number, f: number): void {
  heap.push(idx);
  heapF.push(f);
  siftUp(heap, heapF, heap.length - 1);
}

/** Min-heap pop: returns the index with the smallest f-score. */
function popHeap(heap: number[], heapF: number[]): number {
  const top = heap[0]!;
  const lastIdx = heap.length - 1;
  heap[0] = heap[lastIdx]!;
  heapF[0] = heapF[lastIdx]!;
  heap.pop();
  heapF.pop();
  if (heap.length > 0) siftDown(heap, heapF, 0);
  return top;
}

function siftUp(heap: number[], heapF: number[], i: number): void {
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heapF[i]! < heapF[parent]!) {
      swap(heap, heapF, i, parent);
      i = parent;
    } else break;
  }
}

function siftDown(heap: number[], heapF: number[], i: number): void {
  const n = heap.length;
  while (true) {
    const l = i * 2 + 1;
    const r = l + 1;
    let smallest = i;
    if (l < n && heapF[l]! < heapF[smallest]!) smallest = l;
    if (r < n && heapF[r]! < heapF[smallest]!) smallest = r;
    if (smallest === i) break;
    swap(heap, heapF, i, smallest);
    i = smallest;
  }
}

function swap(heap: number[], heapF: number[], a: number, b: number): void {
  const ia = heap[a]!;
  const fa = heapF[a]!;
  heap[a] = heap[b]!;
  heapF[a] = heapF[b]!;
  heap[b] = ia;
  heapF[b] = fa;
}
