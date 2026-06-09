/**
 * A* Pathfinder.
 *
 * Spec reference: §7.4 Traffic, §5.3 Entity Model.
 *
 * This file lives in `src/engine` because the layer convention says
 * engine code is pure-TS algorithms with no React or DOM imports.
 * Future renderer-side helpers (e.g. BFS for camera framing) may also
 * live here, but never anything that touches the DOM or the canvas.
 *
 * Implementation notes:
 *   - Heuristic: Manhattan distance, which is admissible for cardinal
 *     movement on a grid.
 *   - Open set: binary min-heap (O(log n) per insert). This keeps the
 *     pathfinder tractable on larger grids even though our tests use
 *     small ones.
 *   - Edge cost: delegated to `RoadGraph.neighborCost`, which is
 *     responsible for applying the red-light penalty. The default
 *     implementation in `Road.ts` returns 1000 for red-light tiles,
 *     which is larger than the Manhattan heuristic for any practical
 *     grid (so A* will not be misled into taking a long detour just
 *     to avoid one stop).
 *   - Path: a list of `Vector2` starting at `start` and ending at
 *     `goal` inclusive. Returns `null` when the goal is unreachable.
 *     Returns `[start]` when start === goal.
 */

import type { Vector2 } from '@/types/common';
import type { RoadGraph, TrafficSnapshot } from '@/entities/Road';

/** Public options for the pathfinder. */
export interface FindPathOptions {
  /**
   * Optional traffic snapshot. If omitted, an empty snapshot is used
   * (no red lights, no phase penalty). Tests can pass a snapshot with
   * a known red set to assert the cost-avoidance behaviour.
   */
  traffic?: TrafficSnapshot;
  /**
   * Hard cap on the number of expanded nodes. The default is generous
   * (10k) so tests don't need to know about it; production can lower
   * it for very large maps.
   */
  maxExpansions?: number;
}

/**
 * Find a path through a road graph from `start` to `goal` using A*.
 * Returns the list of intersection coordinates (inclusive) or `null`
 * when no path exists.
 */
export function findPath(
  graph: RoadGraph,
  start: Vector2,
  goal: Vector2,
  options: FindPathOptions = {},
): Vector2[] | null {
  if (graph.intersections.size === 0) return null;

  const startKey = `${start.x},${start.y}`;
  const goalKey = `${goal.x},${goal.y}`;
  const traffic: TrafficSnapshot = options.traffic ?? {
    redLightTiles: new Set<string>(),
    phase: 'NS_GREEN',
  };
  const maxExpansions = options.maxExpansions ?? 10_000;

  // If start or goal is not a known intersection we cannot route -
  // a vehicle can only sit on or visit intersection tiles.
  if (!graph.intersections.has(startKey)) return null;
  if (!graph.intersections.has(goalKey)) return null;

  if (startKey === goalKey) return [start];

  // cameFrom[key] = previous key on the optimal path.
  const cameFrom = new Map<string, string>();
  // gScore[key] = best known cost from start -> key.
  const gScore = new Map<string, number>();
  gScore.set(startKey, 0);

  const open = new MinHeap<HeapNode>((a, b) => a.f - b.f);
  open.push({ key: startKey, f: heuristic(start, goal) });

  let expansions = 0;
  while (open.size > 0) {
    if (expansions >= maxExpansions) return null;
    expansions += 1;

    const current = open.pop();
    if (!current) break;
    if (current.key === goalKey) {
      return reconstructPath(cameFrom, current.key);
    }

    const node = graph.intersections.get(current.key);
    if (!node) continue;
    const currentG = gScore.get(current.key) ?? Infinity;
    for (const neighbor of node.neighbors) {
      const neighborKey = `${neighbor.x},${neighbor.y}`;
      const stepCost = graph.neighborCost(node.position, neighbor, traffic);
      if (!Number.isFinite(stepCost)) continue;
      const tentativeG = currentG + stepCost;
      const existingG = gScore.get(neighborKey) ?? Infinity;
      if (tentativeG < existingG) {
        cameFrom.set(neighborKey, current.key);
        gScore.set(neighborKey, tentativeG);
        const f = tentativeG + heuristic(neighbor, goal);
        open.push({ key: neighborKey, f });
      }
    }
  }
  return null;
}

/** Manhattan distance. Admissible for cardinal grid movement. */
export function heuristic(a: Vector2, b: Vector2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstructPath(cameFrom: ReadonlyMap<string, string>, endKey: string): Vector2[] {
  const path: Vector2[] = [];
  let current: string | undefined = endKey;
  while (current !== undefined) {
    const [xs, ys] = current.split(',');
    const x = Number(xs);
    const y = Number(ys);
    path.push({ x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 });
    current = cameFrom.get(current);
  }
  path.reverse();
  return path;
}

interface HeapNode {
  key: string;
  f: number;
}

/**
 * Tiny binary min-heap. ~30 LOC, comparator-driven so it can be reused
 * for future A*-variants (e.g. D* Lite) without changing the pop/push
 * surface.
 */
class MinHeap<T> {
  private readonly data: T[] = [];
  private readonly cmp: (a: T, b: T) => number;

  constructor(cmp: (a: T, b: T) => number) {
    this.cmp = cmp;
  }

  get size(): number {
    return this.data.length;
  }

  push(value: T): void {
    this.data.push(value);
    this.siftUp(this.data.length - 1);
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0 && last !== undefined) {
      this.data[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const a = this.data[i];
      const b = this.data[parent];
      if (a === undefined || b === undefined) return;
      if (this.cmp(a, b) < 0) {
        this.data[i] = b;
        this.data[parent] = a;
      } else {
        return;
      }
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      const a = this.data[smallest];
      const left = l < n ? this.data[l] : undefined;
      const right = r < n ? this.data[r] : undefined;
      if (left !== undefined && a !== undefined && this.cmp(left, a) < 0) {
        smallest = l;
      }
      if (right !== undefined) {
        const target = this.data[smallest];
        if (target !== undefined && this.cmp(right, target) < 0) {
          smallest = r;
        }
      }
      if (smallest === i) return;
      const ti = this.data[i];
      const ts = this.data[smallest];
      if (ti === undefined || ts === undefined) return;
      this.data[i] = ts;
      this.data[smallest] = ti;
      i = smallest;
    }
  }
}
