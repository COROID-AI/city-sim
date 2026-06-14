/**
 * A* pathfinder over a 4-connected road graph.
 *
 * Implementation notes:
 *  - The open set is a binary min-heap keyed by `f = g + h`.
 *  - The heuristic is Manhattan distance — admissible (never over-estimates)
 *    on a 4-neighbour grid with uniform edge weights. Admissibility is the
 *    key property: it guarantees A* returns an optimal path.
 *  - A `maxNodes` cap is enforced so a malformed / disconnected graph can
 *    never cause a runaway search. When the cap is hit, `findPath` returns
 *    `null` and sets `lastStats.capped` to `true`.
 *  - `path` is returned as a list of tile coords from start to goal
 *    (inclusive of both endpoints). The first entry is `start`; the
 *    last entry is `goal`.
 *
 * Layer rule: this module is the *engine* — no React, no DOM. It may
 * import engine *types* from `./types` and the `RoadGraph` from
 * `@/entities/Road` (which is itself pure TS).
 */

import type { TileCoord } from './types';
import type { RoadGraph } from '@/entities/Road';

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

export interface PathfinderOptions {
  /** Maximum number of expanded nodes per search. Default 5000. */
  readonly maxNodes?: number;
}

export interface PathfinderStats {
  /** Number of nodes expanded in the last search. */
  readonly expanded: number;
  /** True if the search was abandoned because `maxNodes` was reached. */
  readonly capped: boolean;
  /** Length of the returned path (in tiles), or 0 if no path. */
  readonly pathLength: number;
  /** Total run-time in milliseconds (rough). */
  readonly elapsedMs: number;
}

export interface PathfinderResult {
  /** Tile coords from start to goal, inclusive. Empty if no path. */
  readonly path: ReadonlyArray<TileCoord>;
  readonly stats: PathfinderStats;
}

/* -------------------------------------------------------------------------- */
/* Min-heap                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A binary min-heap keyed by `priority` (a number). Supports
 * `push`, `pop`, and `size`. Ties are broken by insertion order
 * (FIFO), so the heap is deterministic for a given input — no
 * `Math.random`, no Date.now.
 */
class MinHeap<T> {
  private readonly data: { key: T; priority: number; seq: number }[] = [];
  private seq = 0;

  get size(): number {
    return this.data.length;
  }

  push(key: T, priority: number): void {
    const entry = { key, priority, seq: this.seq++ };
    this.data.push(entry);
    this.siftUp(this.data.length - 1);
  }

  pop(): { key: T; priority: number } | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0]!;
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.siftDown(0);
    }
    return { key: top.key, priority: top.priority };
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(this.data[i]!, this.data[parent]!)) {
        this.swap(i, parent);
        i = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(i: number): void {
    const n = this.data.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.less(this.data[l]!, this.data[smallest]!)) smallest = l;
      if (r < n && this.less(this.data[r]!, this.data[smallest]!)) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private less(a: { priority: number; seq: number }, b: { priority: number; seq: number }): boolean {
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.seq < b.seq; // FIFO tiebreak
  }

  private swap(i: number, j: number): void {
    const tmp = this.data[i]!;
    this.data[i] = this.data[j]!;
    this.data[j] = tmp;
  }
}

/* -------------------------------------------------------------------------- */
/* Pathfinder                                                                 */
/* -------------------------------------------------------------------------- */

/** Default safety cap. Sized for ~100x100 cities. */
export const DEFAULT_MAX_NODES = 5000;

export class Pathfinder {
  readonly maxNodes: number;
  private lastStats: PathfinderStats = {
    expanded: 0,
    capped: false,
    pathLength: 0,
    elapsedMs: 0,
  };

  constructor(public readonly roadGraph: RoadGraph, options: PathfinderOptions = {}) {
    if (!roadGraph) {
      throw new RangeError('Pathfinder: roadGraph is required');
    }
    const cap = options.maxNodes ?? DEFAULT_MAX_NODES;
    if (!Number.isInteger(cap) || cap <= 0) {
      throw new RangeError(`Pathfinder: maxNodes must be a positive integer (got ${cap})`);
    }
    this.maxNodes = cap;
  }

  /**
   * Stats from the most recent `findPath` call. Useful for tests and
   * for the debug overlay.
   */
  get stats(): PathfinderStats {
    return this.lastStats;
  }

  /**
   * Find a shortest path from `start` to `goal`. Both `start` and
   * `goal` are expected to be in the graph (callers should use
   * `findNearestRoadNode` first if they have arbitrary tile coords).
   * Returns `null` when no path exists or the cap is hit.
   */
  findPath(start: TileCoord, goal: TileCoord): PathfinderResult | null {
    const t0 = nowMs();
    const graph = this.roadGraph;
    const startIdx = graph.indexByCoord.get(coordKey(start));
    const goalIdx = graph.indexByCoord.get(coordKey(goal));
    if (startIdx === undefined || goalIdx === undefined) {
      this.lastStats = { expanded: 0, capped: false, pathLength: 0, elapsedMs: nowMs() - t0 };
      return null;
    }
    if (startIdx === goalIdx) {
      const result: PathfinderResult = {
        path: [graph.nodes[startIdx]!],
        stats: { expanded: 0, capped: false, pathLength: 1, elapsedMs: nowMs() - t0 },
      };
      this.lastStats = result.stats;
      return result;
    }

    const goalNode = graph.nodes[goalIdx]!;
    const gScore = new Float64Array(graph.size);
    const fScore = new Float64Array(graph.size);
    const cameFrom = new Int32Array(graph.size);
    for (let i = 0; i < graph.size; i++) {
      gScore[i] = Number.POSITIVE_INFINITY;
      fScore[i] = Number.POSITIVE_INFINITY;
      cameFrom[i] = -1;
    }
    gScore[startIdx] = 0;
    fScore[startIdx] = manhattan(graph.nodes[startIdx]!, goalNode);

    const open = new MinHeap<number>();
    open.push(startIdx, fScore[startIdx]!);

    const closed = new Uint8Array(graph.size);
    let expanded = 0;
    let capped = false;

    while (open.size > 0) {
      const top = open.pop()!;
      const current = top.key;
      if (closed[current]) continue;
      if (current === goalIdx) {
        const path = reconstructPath(graph, cameFrom, current);
        const result: PathfinderResult = {
          path,
          stats: {
            expanded,
            capped,
            pathLength: path.length,
            elapsedMs: nowMs() - t0,
          },
        };
        this.lastStats = result.stats;
        return result;
      }
      closed[current] = 1;
      expanded += 1;
      if (expanded > this.maxNodes) {
        capped = true;
        break;
      }
      const adj = graph.adjacency[current]!;
      for (const next of adj) {
        if (closed[next]) continue;
        const tentativeG = gScore[current]! + 1; // uniform edge weight
        if (tentativeG < gScore[next]!) {
          cameFrom[next] = current;
          gScore[next] = tentativeG;
          fScore[next] = tentativeG + manhattan(graph.nodes[next]!, goalNode);
          open.push(next, fScore[next]!);
        }
      }
    }

    // Open set drained or cap hit before reaching goal → no path.
    this.lastStats = {
      expanded,
      capped,
      pathLength: 0,
      elapsedMs: nowMs() - t0,
    };
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function manhattan(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function coordKey(c: TileCoord): string {
  return `${c.x},${c.y}`;
}

function reconstructPath(
  graph: RoadGraph,
  cameFrom: Int32Array,
  goalIdx: number,
): TileCoord[] {
  const path: TileCoord[] = [];
  let cur = goalIdx;
  for (;;) {
    path.push(graph.nodes[cur]!);
    const prev = cameFrom[cur]!;
    if (prev === -1) break;
    cur = prev;
  }
  path.reverse();
  return path;
}

/**
 * `performance.now` when available, else `Date.now`. jsdom provides
 * `performance.now` so tests can rely on it.
 */
function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
