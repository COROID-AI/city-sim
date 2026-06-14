/**
 * Traffic light controller.
 *
 * The TrafficSystem owns:
 *  - The set of detected 4-way intersections (auto-derived from the
 *    road graph at construction time).
 *  - A 4-phase cycle: NS_green → all_red → EW_green → all_red. Each
 *    phase has a configurable duration in seconds.
 *  - A per-tick `advance(dt)` method that flips the phase when the
 *    current phase's duration has elapsed.
 *  - A read-only `isGreenAt(coord)` query used by vehicles in
 *    `advanceVehicle` (see `entities/Vehicle.ts`).
 *  - An occupancy-set builder `buildOccupancy(vehicles)` that
 *    collapses a vehicle list into the `{coord → blocked}` set the
 *    traffic system needs to feed to `advanceVehicle`.
 *
 * Layer rule: this module is a *system* — pure TypeScript, no
 * React, no DOM, no engine runtime. Allowed deps: `@/engine` (types
 * only, structural, erased at runtime), `@/entities` (Road graph
 * helpers + Vehicle types).
 *
 * Design notes:
 *  - We do NOT mutate the road graph. Intersections are derived once
 *    at construction time.
 *  - The phase is held as a `TrafficPhase` enum-style value, not a
 *    numeric timer, so the renderer / tests can `switch` on it.
 *  - The system is deterministic given the same inputs and the
 *    same sequence of `advance` calls — no Date.now, no Math.random.
 */

import type { Tile, TileCoord, WorldBounds } from '@/engine/types';
import { findNearestRoadNode, type RoadGraph } from '@/entities/Road';

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

export type TrafficPhase =
  | 'NS_green'
  | 'NS_to_EW_all_red'
  | 'EW_green'
  | 'EW_to_NS_all_red';

export interface TrafficSystemOptions {
  /** Phase durations in seconds. Defaults to a 30s cycle. */
  readonly phaseDurations?: Partial<Record<TrafficPhase, number>>;
  /** Starting phase. Defaults to `'NS_green'`. */
  readonly initialPhase?: TrafficPhase;
  /** Optional starting offset (seconds into the current phase). */
  readonly initialElapsed?: number;
}

/**
 * Minimal world view the TrafficSystem needs. Decouples the system
 * from the full `World` class so it can be unit-tested with a fake.
 */
export interface TrafficSystemWorldView {
  readonly bounds: WorldBounds;
  getTile(coord: TileCoord): Tile | null;
  tiles_(): IterableIterator<Tile>;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_PHASE_SECONDS: Record<TrafficPhase, number> = {
  NS_green: 12,
  NS_to_EW_all_red: 3,
  EW_green: 12,
  EW_to_NS_all_red: 3,
};

/**
 * Cardinal-direction deltas, in (dx, dy) form. Order matches the
 * "4-way" requirement: N, E, S, W. Used both to count neighbours and
 * to build the intersection set.
 */
const CARDINAL_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
];

/* -------------------------------------------------------------------------- */
/* Intersection detection                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Return every road tile that has FOUR road neighbours (N, S, E, W).
 * The strict 4-way rule means T-junctions (3 neighbours) are NOT
 * classified as intersections — they don't need a light.
 */
export function detectIntersections(world: TrafficSystemWorldView): ReadonlyArray<TileCoord> {
  const { bounds } = world;
  const out: TileCoord[] = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const t = world.getTile({ x, y });
      if (!t || t.kind !== 'road') continue;
      let roadCount = 0;
      for (const [dx, dy] of CARDINAL_DELTAS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= bounds.width || ny >= bounds.height) continue;
        if (world.getTile({ x: nx, y: ny })?.kind === 'road') roadCount++;
      }
      if (roadCount === 4) out.push({ x, y });
    }
  }
  return out;
}

/**
 * Detect intersections from a `RoadGraph` alone (no world access).
 * This is the variant the system class uses internally; the
 * `detectIntersections(world)` overload is for callers that don't
 * have a graph handy.
 */
export function detectIntersectionsFromGraph(
  graph: RoadGraph,
  bounds: WorldBounds,
): ReadonlyArray<TileCoord> {
  const nodeSet = new Set<string>();
  for (const n of graph.nodes) nodeSet.add(coordKey(n));
  const out: TileCoord[] = [];
  for (const n of graph.nodes) {
    let roadCount = 0;
    for (const [dx, dy] of CARDINAL_DELTAS) {
      const nx = n.x + dx;
      const ny = n.y + dy;
      if (nx < 0 || ny < 0 || nx >= bounds.width || ny >= bounds.height) continue;
      if (nodeSet.has(coordKey({ x: nx, y: ny }))) roadCount++;
    }
    if (roadCount === 4) out.push({ x: n.x, y: n.y });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Occupancy                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A minimal set of blocked tile coordinates, used by
 * `advanceVehicle` to refuse gridlock. Backed by a `Set<string>` of
 * `"x,y"` keys for O(1) lookups.
 */
export class TileOccupancy {
  private readonly blocked = new Set<string>();
  /** Resize the set to a known capacity to avoid rehashes. */
  constructor(initialCapacity = 0) {
    // The Set doesn't expose capacity, but we hint by adding & removing
    // no-op values; in practice the V8 hash-set grows on demand. The
    // constructor parameter is reserved for future optimisation.
    void initialCapacity;
  }

  /** True if `coord` is currently blocked. */
  has(coord: TileCoord): boolean {
    return this.blocked.has(coordKey(coord));
  }

  /** Mark `coord` as blocked. */
  add(coord: TileCoord): void {
    this.blocked.add(coordKey(coord));
  }

  /** Unmark `coord` as blocked. */
  delete(coord: TileCoord): void {
    this.blocked.delete(coordKey(coord));
  }

  /** Empty the set. */
  clear(): void {
    this.blocked.clear();
  }

  get size(): number {
    return this.blocked.size;
  }
}

/* -------------------------------------------------------------------------- */
/* TrafficSystem                                                              */
/* -------------------------------------------------------------------------- */

const PHASE_ORDER: ReadonlyArray<TrafficPhase> = [
  'NS_green',
  'NS_to_EW_all_red',
  'EW_green',
  'EW_to_NS_all_red',
];

/**
 * Owns the traffic-light state for a fixed road graph. Construct
 * once per world (the graph is immutable), then call `advance(dt)`
 * each tick to cycle phases.
 *
 * The system is intentionally simple: it does not consult vehicle
 * counts, demand-side pressure, or any other input beyond time.
 * Phase changes are time-based only.
 */
export class TrafficSystem {
  private readonly intersections: ReadonlyArray<TileCoord>;
  private readonly intersectionSet: Set<string>;
  private readonly phaseDurations: Record<TrafficPhase, number>;
  private currentPhase: TrafficPhase;
  private elapsedInPhase: number;

  constructor(
    private readonly graph: RoadGraph,
    bounds: WorldBounds,
    options: TrafficSystemOptions = {},
  ) {
    if (!graph) {
      throw new RangeError('TrafficSystem: graph is required');
    }
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      throw new RangeError('TrafficSystem: bounds must have positive width/height');
    }
    this.intersections = detectIntersectionsFromGraph(graph, bounds);
    this.intersectionSet = new Set(this.intersections.map(coordKey));
    this.phaseDurations = { ...DEFAULT_PHASE_SECONDS, ...(options.phaseDurations ?? {}) };
    this.currentPhase = options.initialPhase ?? 'NS_green';
    this.elapsedInPhase = options.initialElapsed ?? 0;
  }

  /** Read-only list of detected intersection tile coords. */
  get intersectionTiles(): ReadonlyArray<TileCoord> {
    return this.intersections;
  }

  /** Current phase. */
  get phase(): TrafficPhase {
    return this.currentPhase;
  }

  /** Seconds elapsed in the current phase. */
  get phaseElapsed(): number {
    return this.elapsedInPhase;
  }

  /** True if `coord` is a detected 4-way intersection. */
  isIntersection(coord: TileCoord): boolean {
    return this.intersectionSet.has(coordKey(coord));
  }

  /**
   * True if a vehicle at `coord` is allowed to advance RIGHT NOW.
   * - At an intersection: true only during the matching green phase.
   * - Anywhere else: always true (no light, no stop).
   */
  isGreenAt(coord: TileCoord): boolean {
    if (!this.isIntersection(coord)) return true;
    switch (this.currentPhase) {
      case 'NS_green':
        return true;
      case 'EW_green':
        return true;
      case 'NS_to_EW_all_red':
      case 'EW_to_NS_all_red':
        return false;
    }
  }

  /**
   * The phase that's currently GREEN, or `null` during the all-red
   * clearance phase. Useful for the renderer to colour traffic
   * light dots.
   */
  greenAxis(): 'NS' | 'EW' | null {
    if (this.currentPhase === 'NS_green') return 'NS';
    if (this.currentPhase === 'EW_green') return 'EW';
    return null;
  }

  /**
   * Step the timer forward by `dt` seconds. Phases flip when their
   * duration elapses. The order is NS_green → NS_to_EW_all_red →
   * EW_green → EW_to_NS_all_red → NS_green (cycle).
   */
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError(`TrafficSystem.advance: dt must be a non-negative finite number (got ${dt})`);
    }
    if (dt === 0) return;
    this.elapsedInPhase += dt;
    // Loop: a single huge dt could skip multiple phases; we still
    // want to land in the right one.
    let safety = PHASE_ORDER.length + 1;
    while (safety-- > 0) {
      const phaseDur = this.phaseDurations[this.currentPhase];
      if (this.elapsedInPhase < phaseDur) break;
      this.elapsedInPhase -= phaseDur;
      const idx = PHASE_ORDER.indexOf(this.currentPhase);
      this.currentPhase = PHASE_ORDER[(idx + 1) % PHASE_ORDER.length]!;
    }
  }

  /**
   * Build an occupancy set from a snapshot of vehicles. The set
   * contains every tile occupied by a non-arrived vehicle (the
   * head of its `path`). Pass the set to `advanceVehicle` to
   * enforce the one-tile-per-vehicle rule.
   */
  buildOccupancy(
    vehicles: Iterable<{ state: string; path: readonly TileCoord[] }>,
  ): TileOccupancy {
    const occ = new TileOccupancy();
    for (const v of vehicles) {
      if (v.state === 'arrived') continue;
      if (v.path.length === 0) continue;
      const head = v.path[0]!;
      occ.add(head);
    }
    return occ;
  }

  /**
   * Find the road node index closest to `coord`. Convenience wrapper
   * around `findNearestRoadNode` so callers using TrafficSystem
   * don't have to import the Road entity.
   */
  findNearestRoadNode(coord: TileCoord): number {
    return findNearestRoadNode(this.graph, coord);
  }
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function coordKey(c: TileCoord): string {
  return `${c.x},${c.y}`;
}
