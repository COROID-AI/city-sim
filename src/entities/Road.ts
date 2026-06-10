/**
 * Road entity / graph.
 *
 * Spec reference: §5.3 Entity Model (roads as a sparse network),
 *                 §7.4 Traffic.
 *
 * We represent the road network at the *intersection* level rather than
 * at every tile. Roads in a city are sparse: most tiles are buildings,
 * so an explicit per-tile graph would be wasteful. Intersections are the
 * natural graph nodes because they are the only tiles that are
 * reachable from a building via a road and they are the only places a
 * vehicle can change direction.
 *
 * Conventions:
 *   - `RoadKind` is the raw tile kind produced by the world generator.
 *   - `buildRoadGraph` walks the grid, finds intersections, and emits an
 *     undirected adjacency list keyed by intersection coordinate.
 *   - `neighborCost` is intentionally injectable so tests can assert
 *     the red-light behaviour deterministically. The default cost model
 *     returns a high constant (1000) when the next intersection is in
 *     an opposing phase, so A* still produces a path but prefers the
 *     green one when an alternative exists.
 *
 * This file is pure-TS: no React, no DOM, no engine imports.
 */
import type { Vector2 } from '@/types/common';

/** Tile kinds the road layer understands. */
export type RoadKind = 'empty' | 'road' | 'intersection';

/** A 2D grid of road tiles, indexed [y][x]. */
export type RoadGrid = readonly (readonly RoadKind[])[];

/** A node in the road graph (always an intersection tile). */
export interface Intersection {
  /** Tile coordinate of the intersection. */
  position: Vector2;
  /** Adjacent intersection positions connected by a straight road segment. */
  neighbors: readonly Vector2[];
}

/**
 * A road graph keyed by `"x,y"` strings. We use a string key so the
 * graph can be cheaply serialised and so `Set<string>` is a valid
 * O(1) lookup for the red-light tile set used by the Vehicle layer.
 */
export interface RoadGraph {
  /** All intersections keyed by their `x,y` string. */
  intersections: ReadonlyMap<string, Intersection>;
  /** Default edge cost when no traffic phase penalty applies. */
  baseCost: number;
  /** Cost added when crossing an intersection in the opposing phase. */
  redLightCost: number;
  /**
   * Computes the cost to traverse from `from` to `to` given the current
   * traffic snapshot. The default implementation uses the red-light
   * penalty described above. Custom strategies can be passed in via
   * `buildRoadGraph({ costStrategy })` for testing.
   */
  neighborCost: (from: Vector2, to: Vector2, traffic: TrafficSnapshot) => number;
}

/**
 * A read-only snapshot of the traffic state. The pathfinder and the
 * vehicle advance code both take this rather than the live TrafficSystem
 * to keep the data flow explicit and unit-testable.
 */
export interface TrafficSnapshot {
  /**
   * Set of `x,y` keys for tiles that currently block traffic (i.e. an
   * intersection in ALL_RED or a phase that does not admit the
   * approach being considered). The default `neighborCost` returns
   * `redLightCost` when `to` is in this set.
   */
  redLightTiles: ReadonlySet<string>;
  /**
   * The current traffic phase. Used by custom cost strategies; the
   * default implementation only inspects `redLightTiles`.
   */
  phase: TrafficPhase;
}

/** Discrete traffic-light phase. */
export type TrafficPhase = 'NS_GREEN' | 'EW_GREEN' | 'ALL_RED';

export interface BuildRoadGraphOptions {
  /** Default cost for traversing one segment with no penalty. */
  baseCost?: number;
  /** Penalty added to a red-light crossing. */
  redLightCost?: number;
  /** Optional custom cost strategy. Defaults to `defaultNeighborCost`. */
  costStrategy?: (from: Vector2, to: Vector2, traffic: TrafficSnapshot) => number;
}

/**
 * Build a road graph from a 2D grid.
 *
 * Algorithm:
 *   1. Find all 'intersection' tiles - these are the graph nodes.
 *   2. For each intersection, walk in the four cardinal directions
 *      until the next intersection (or the grid edge). If we find one,
 *      record a mutual adjacency.
 *   3. Emit the resulting graph with the default cost strategy.
 *
 * An empty grid (no intersections) produces an empty graph; callers
 * can detect this by checking `graph.intersections.size === 0`.
 */
export function buildRoadGraph(
  grid: RoadGrid,
  options: BuildRoadGraphOptions = {},
): RoadGraph {
  const baseCost = options.baseCost ?? 1;
  const redLightCost = options.redLightCost ?? 1000;
  const costStrategy = options.costStrategy ?? defaultNeighborCost;

  const intersections = new Map<string, Intersection>();
  if (grid.length === 0) {
    return { intersections, baseCost, redLightCost, neighborCost: costStrategy };
  }

  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  // First pass: collect intersection positions.
  for (let y = 0; y < height; y += 1) {
    const row = grid[y];
    if (!row) continue;
    for (let x = 0; x < width; x += 1) {
      if (row[x] === 'intersection') {
        const key = tileKey(x, y);
        intersections.set(key, { position: { x, y }, neighbors: [] });
      }
    }
  }

  // Second pass: connect each intersection to its nearest neighbour
  // along each cardinal direction.
  for (const [key, node] of intersections) {
    const neighborKeys: string[] = [];
    const directions: readonly Vector2[] = CARDINAL_DIRECTIONS;
    for (const dir of directions) {
      const target = walkToIntersection(node.position, dir, grid, intersections);
      if (target !== null) {
        const tKey = tileKey(target.x, target.y);
        if (tKey !== key && !neighborKeys.includes(tKey)) {
          neighborKeys.push(tKey);
        }
      }
    }
    intersections.set(key, { position: node.position, neighbors: neighborKeys.map(parseTileKey) });
  }

  return { intersections, baseCost, redLightCost, neighborCost: costStrategy };
}

/**
 * Default neighbor cost: `baseCost` plus `redLightCost` if `to` is
 * currently in a red phase for the approach being made.
 */
export function defaultNeighborCost(
  _from: Vector2,
  to: Vector2,
  traffic: TrafficSnapshot,
): number {
  if (traffic.redLightTiles.has(tileKey(to.x, to.y))) {
    return 1000;
  }
  return 1;
}

/** Cardinal directions in (dx, dy) order: N, E, S, W. */
export const CARDINAL_DIRECTIONS: readonly Vector2[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** Encode a tile coordinate as `"x,y"`. */
export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Parse a `"x,y"` key back into a `Vector2`. */
export function parseTileKey(key: string): Vector2 {
  const [xs, ys] = key.split(',');
  const x = Number(xs);
  const y = Number(ys);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/**
 * Check whether a tile is a road or intersection (i.e. driveable).
 * Empty tiles are not driveable.
 */
export function isDriveable(grid: RoadGrid, x: number, y: number): boolean {
  if (y < 0 || y >= grid.length) return false;
  const row = grid[y];
  if (!row) return false;
  if (x < 0 || x >= row.length) return false;
  return row[x] === 'road' || row[x] === 'intersection';
}

// ---------- internal helpers ----------

/**
 * Walk from `start` in `dir` until we find another intersection. The
 * road segment between two intersections is implicitly driveable when
 * every tile along the way is a 'road' or 'intersection'. If we hit a
 * gap (an 'empty' tile or the grid edge) the walk fails.
 */
function walkToIntersection(
  start: Vector2,
  dir: Vector2,
  grid: RoadGrid,
  intersections: ReadonlyMap<string, Intersection>,
): Vector2 | null {
  let x = start.x + dir.x;
  let y = start.y + dir.y;
  while (true) {
    if (y < 0 || y >= grid.length) return null;
    const row = grid[y];
    if (!row) return null;
    if (x < 0 || x >= row.length) return null;
    const cell = row[x];
    if (cell === undefined) return null;
    if (cell === 'empty') return null;
    if (cell === 'intersection') {
      // Found a target intersection. Confirm we walked at least one
      // tile (we should never return the start tile because the loop
      // precondition guarantees the first step is off-grid).
      if (x === start.x && y === start.y) return null;
      if (!intersections.has(tileKey(x, y))) return null;
      return { x, y };
    }
    // 'road' tile - keep walking.
    x += dir.x;
    y += dir.y;
  }
}
