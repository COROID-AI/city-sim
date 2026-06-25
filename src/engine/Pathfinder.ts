/**
 * Pathfinder — A* shortest-path over the sparse road graph (spec §5.6).
 *
 * Architecture decisions (see plan notes):
 *  - A* with the Manhattan-distance heuristic (|dx| + |dy|), which is admissible
 *    and consistent for the 4-connected, unit-grid-weighted road graph.
 *  - The open set is a binary min-heap keyed by fScore, giving O(log n) push /
 *    pop instead of the O(n) extraction a sorted array would require.
 *  - Traffic lights are decoupled via an injectable {@link TrafficLightProvider}.
 *    red   -> the neighbour node is skipped entirely (impassable);
 *    yellow-> the edge cost into that node is multiplied by
 *             YELLOW_LIGHT_COST_MULTIPLIER (high cost, discouraging but not
 *             forbidding the route);
 *    green / no provider / no light -> normal cost.
 *  - Paths are cached in a Map keyed by `${startId}->${goalId}`. The cache key
 *    excludes traffic-light state (topology is static; lights are dynamic).
 *    Callers should {@link Pathfinder.clearCache} when lights change state if
 *    the optimal route must reflect the new light phases.
 *  - Unreachable goals return an empty array `[]` without throwing.
 */
import type {
  RoadGraph,
  RoadNode,
  TrafficLightProvider,
  Vector2,
} from './types';

/**
 * Cost multiplier applied to edges that enter a yellow-light node. Chosen to
 * be high enough that A* strongly prefers green-lit alternatives while still
 * allowing a yellow route when no alternative exists.
 */
export const YELLOW_LIGHT_COST_MULTIPLIER = 5;

/**
 * Binary min-heap of node ids keyed by a numeric priority (fScore).
 *
 * Standard array-backed binary heap:
 *  - push  : O(log n), appends then sifts up.
 *  - pop   : O(log n), swaps root with last, sifts down.
 *  - decrease: O(log n), re-sifts an existing entry up.
 */
class MinHeap {
  private readonly ids: string[] = [];
  private readonly prios: number[] = [];
  /** index of each id within the heap, for O(1) decrease-key lookup. */
  private readonly pos = new Map<string, number>();

  get size(): number {
    return this.ids.length;
  }

  has(id: string): boolean {
    return this.pos.has(id);
  }

  push(id: string, priority: number): void {
    const idx = this.ids.length;
    this.ids.push(id);
    this.prios.push(priority);
    this.pos.set(id, idx);
    this.siftUp(idx);
  }

  pop(): { id: string; priority: number } | null {
    if (this.ids.length === 0) return null;
    const topId = this.ids[0]!;
    const topPrio = this.prios[0]!;
    const lastIdx = this.ids.length - 1;
    // Move the last element to the root and sift down.
    const lastId = this.ids[lastIdx]!;
    const lastPrio = this.prios[lastIdx]!;
    this.ids.pop();
    this.prios.pop();
    this.pos.delete(topId);
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.prios[0] = lastPrio;
      this.pos.set(lastId, 0);
      this.siftDown(0);
    }
    return { id: topId, priority: topPrio };
  }

  /**
   * Lower the priority of an existing entry and restore heap order.
   * No-op if the new priority is not smaller than the current one.
   */
  decrease(id: string, priority: number): void {
    const idx = this.pos.get(id);
    if (idx === undefined) return;
    if (priority >= this.prios[idx]!) return;
    this.prios[idx] = priority;
    this.siftUp(idx);
  }

  private siftUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.prios[idx]! < this.prios[parent]!) {
        this.swap(idx, parent);
        idx = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(idx: number): void {
    const n = this.ids.length;
    while (true) {
      let smallest = idx;
      const left = idx * 2 + 1;
      const right = idx * 2 + 2;
      if (left < n && this.prios[left]! < this.prios[smallest]!) smallest = left;
      if (right < n && this.prios[right]! < this.prios[smallest]!) smallest = right;
      if (smallest === idx) break;
      this.swap(idx, smallest);
      idx = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const idA = this.ids[a]!;
    const idB = this.ids[b]!;
    const prioA = this.prios[a]!;
    const prioB = this.prios[b]!;
    this.ids[a] = idB;
    this.prios[a] = prioB;
    this.ids[b] = idA;
    this.prios[b] = prioA;
    this.pos.set(idB, a);
    this.pos.set(idA, b);
  }
}

/** Manhattan distance between two nodes / points. */
function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * A* pathfinder over a {@link RoadGraph}.
 *
 * Create one Pathfinder per road graph and reuse it; cached paths make
 * repeated queries between the same pair cheap.
 */
export class Pathfinder {
  private readonly graph: RoadGraph;
  private readonly lights: TrafficLightProvider | null;
  private readonly cache = new Map<string, RoadNode[]>();

  /**
   * @param graph  The road graph to search.
   * @param lights Optional traffic-light provider. When omitted or null, every
   *               node is treated as green (normal cost).
   */
  constructor(graph: RoadGraph, lights: TrafficLightProvider | null = null) {
    this.graph = graph;
    this.lights = lights;
  }

  /**
   * Compute the shortest path between two node ids.
   *
   * @param startId Node id of the origin.
   * @param goalId  Node id of the destination.
   * @returns Ordered list of nodes from start to goal (inclusive), or an empty
   *          array when the goal is unreachable or either id is unknown.
   */
  findPath(startId: string, goalId: string): RoadNode[] {
    // Unknown nodes can never be reached.
    const start = this.graph.nodes.get(startId);
    const goal = this.graph.nodes.get(goalId);
    if (!start || !goal) return [];

    // Trivial case: start is the goal.
    if (startId === goalId) return [start];

    // Topology-only cache lookup. Traffic lights are dynamic and applied
    // during traversal; see class docs for the cache-invalidation contract.
    const cacheKey = `${startId}->${goalId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const path = this.search(start, goal);
    // Cache even empty results so repeated unreachable queries are O(1).
    this.cache.set(cacheKey, path);
    return path;
  }

  /**
   * Core A* search. Returns the ordered node list or [] when unreachable.
   */
  private search(start: RoadNode, goal: RoadNode): RoadNode[] {
    const nodes = this.graph.nodes;
    const edges = this.graph.edges;

    const open = new MinHeap();
    const closed = new Set<string>();
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>();

    gScore.set(start.id, 0);
    open.push(start.id, manhattan(start, goal));

    while (open.size > 0) {
      const current = open.pop()!.id;

      if (current === goal.id) {
        return this.reconstruct(cameFrom, goal.id);
      }

      // A node may be pushed multiple times with decreasing priorities; skip
      // stale entries that were already expanded.
      if (closed.has(current)) continue;
      closed.add(current);

      const currentG = gScore.get(current) ?? Infinity;
      const neighbours = edges.get(current);
      if (!neighbours) continue;

      for (const edge of neighbours) {
        const neighbourNode = nodes.get(edge.to);
        if (!neighbourNode) continue;

        // Traffic-light aware cost.
        const light = this.lights?.getLight(edge.to) ?? null;
        if (light === 'red') {
          // Red = impassable: skip this neighbour entirely.
          continue;
        }
        const cost =
          light === 'yellow'
            ? edge.weight * YELLOW_LIGHT_COST_MULTIPLIER
            : edge.weight;

        const tentativeG = currentG + cost;
        const knownG = gScore.get(edge.to) ?? Infinity;
        if (tentativeG < knownG) {
          cameFrom.set(edge.to, current);
          gScore.set(edge.to, tentativeG);
          const f = tentativeG + manhattan(neighbourNode, goal);
          if (open.has(edge.to)) {
            open.decrease(edge.to, f);
          } else {
            open.push(edge.to, f);
          }
        }
      }
    }

    // Goal was never reached.
    return [];
  }

  /** Walk cameFrom backwards from goal to start, then reverse. */
  private reconstruct(cameFrom: Map<string, string>, goalId: string): RoadNode[] {
    const path: RoadNode[] = [];
    let cur: string | undefined = goalId;
    while (cur !== undefined) {
      const node = this.graph.nodes.get(cur);
      if (node) path.push(node);
      cur = cameFrom.get(cur);
    }
    path.reverse();
    return path;
  }

  /**
   * Convenience: find a path between two arbitrary world points by snapping
   * each end to its nearest graph node. Returns [] if the graph is empty or
   * the snapped nodes are unreachable.
   */
  findPathBetween(a: Vector2, b: Vector2): RoadNode[] {
    const start = this.getNearestNode(a.x, a.y);
    const goal = this.getNearestNode(b.x, b.y);
    if (!start || !goal) return [];
    return this.findPath(start.id, goal.id);
  }

  /**
   * Nearest graph node to a point (Manhattan distance). null if graph empty.
   */
  getNearestNode(x: number, y: number): RoadNode | null {
    let best: RoadNode | null = null;
    let bestDist = Infinity;
    for (const node of this.graph.nodes.values()) {
      const dist = Math.abs(node.x - x) + Math.abs(node.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
    return best;
  }

  /** Number of cached paths (useful for tests / debugging). */
  get cacheSize(): number {
    return this.cache.size;
  }

  /**
   * Clear the path cache. Call when traffic lights change state and cached
   * routes must be recomputed, or when the road graph is rebuilt.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
