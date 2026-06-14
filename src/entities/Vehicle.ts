/**
 * Vehicle entity — runtime inhabitants of the road network.
 *
 * The `Vehicle` interface itself lives in `@/engine/types` (the single
 * source of truth, per the `engine_types_for_generation` discovery).
 * This module adds the pure-function helpers that systems and tests
 * use to create, advance, and query vehicles:
 *
 *  - `createVehicle(opts)` — factory used by `CommuteDispatcher`.
 *  - `advanceVehicle(vehicle, roadGraph, traffic, occupancy)` —
 *    one-tick step along the planned path. Respects traffic-light
 *    state and one-tile-per-vehicle occupancy.
 *  - `vehicleBlocksTile(vehicle)` — convenience for the `OccupancySet`
 *    used by the TrafficSystem.
 *
 * Layer rule: pure TypeScript, no React, no DOM, no engine runtime
 * import (only structural types). Uses `RoadGraph` and traffic
 * snapshot from `@/systems/TrafficSystem` (structural, also erased).
 *
 * Path semantics:
 *  - `path[0]` is the tile the vehicle is CURRENTLY in.
 *  - `path[1]` is the next tile the vehicle will enter.
 *  - When the path is reduced to a single tile, the vehicle has
 *    arrived (or one tick from arrival, depending on interpretation).
 */

import type { TileCoord, Vehicle, VehicleState, Vector2 } from '@/engine/types';
import type { RoadGraph } from './Road';

/* -------------------------------------------------------------------------- */
/* Re-exports                                                                 */
/* -------------------------------------------------------------------------- */

export type { Vehicle, VehicleState } from '@/engine/types';

/* -------------------------------------------------------------------------- */
/* Traffic snapshot                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Read-only traffic snapshot the vehicle uses to decide whether to
 * enter a given tile. Decoupled from the TrafficSystem class itself
 * so the helper can be unit-tested without instantiating the system.
 */
export interface TrafficSnapshot {
  /** True if a vehicle at the given tile is allowed to advance (green phase). */
  isGreenAt(coord: TileCoord): boolean;
  /** True if the given coord is a detected intersection tile. */
  isIntersection(coord: TileCoord): boolean;
}

/** Set of tile coordinates currently blocked by a vehicle. */
export interface OccupancySet {
  has(coord: TileCoord): boolean;
}

/* -------------------------------------------------------------------------- */
/* Vehicle factory                                                            */
/* -------------------------------------------------------------------------- */

export interface CreateVehicleOptions {
  /** Unique id; required. */
  readonly id: string;
  /** Citizen id that boarded the vehicle. */
  readonly ownerId?: string | null;
  /** Destination building id, if any. */
  readonly destinationId?: string | null;
  /** Starting tile coordinate. Required. */
  readonly startTile: TileCoord;
  /** Tile-coordinate path the vehicle should follow. Required. */
  readonly path: readonly TileCoord[];
  /**
   * Optional initial state. Defaults to `'driving'`. When the path
   * is empty the constructor forces `'arrived'`.
   */
  readonly initialState?: VehicleState;
}

/**
 * Build a new Vehicle with sensible defaults. Pure function — no
 * side effects, no time, no RNG.
 *
 * The vehicle's `position` is the centre of `startTile` (tile coord
 * + 0.5, 0.5). `velocity` defaults to (0, 0); the first
 * `advanceVehicle` call computes the heading from the path.
 */
export function createVehicle(options: CreateVehicleOptions): Vehicle {
  if (!options.id) {
    throw new RangeError('createVehicle: id is required');
  }
  if (!options.startTile) {
    throw new RangeError('createVehicle: startTile is required');
  }
  if (!Array.isArray(options.path)) {
    throw new RangeError('createVehicle: path must be an array');
  }
  // The path stored on the vehicle is the *remaining* path. We expect
  // callers (Pathfinder, CommuteDispatcher) to pass the full plan
  // starting with the current tile, so we just copy it through.
  const path: TileCoord[] = options.path.map((c) => ({ x: c.x, y: c.y }));
  // A path of length 0 means we never started; length 1 means we're
  // already at the destination.
  const isArrived = path.length === 0;
  const initialState: VehicleState = isArrived
    ? 'arrived'
    : (options.initialState ?? 'driving');
  return {
    id: options.id,
    ownerId: options.ownerId ?? null,
    destinationId: options.destinationId ?? null,
    position: tileCentre(options.startTile),
    velocity: { x: 0, y: 0 },
    state: initialState,
    path,
  };
}

/* -------------------------------------------------------------------------- */
/* Path stepping                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Optional headlight helper: true when a vehicle should render its
 * headlight dot. Equivalent to "it's night" — kept here as a
 * convenience for callers that don't want to thread hour-of-day.
 */
export function shouldRenderHeadlight(hour: number): boolean {
  return !(hour >= 6 && hour <= 20);
}

/**
 * Step a single vehicle one tile along its path. The function is
 * pure with respect to the vehicle: it does NOT mutate the input
 * vehicle. It returns a NEW vehicle (same id, owner, destination)
 * with the new position, velocity, state, and trimmed path.
 *
 * Behaviour:
 *  - `state === 'arrived'` is a no-op; the vehicle is returned
 *    unchanged.
 *  - If the path has only one entry (we are at the destination), the
 *    vehicle is set to `'arrived'`.
 *  - `next` is the next tile to enter: `path[1]`. `current` is
 *    `path[0]`.
 *  - If `next` is in `occupancy`, the vehicle enters
 *    `'waiting_for_vehicle'`.
 *  - If `next` is an intersection AND the traffic snapshot says red,
 *    the vehicle enters `'waiting_for_light'`.
 *  - Otherwise the vehicle enters `'driving'`, advances one tile
 *    along the path, and its `position` is set to the new tile
 *    centre. Velocity is computed from the heading.
 *  - When the path is reduced to a single entry (we consumed the last
 *    step), the vehicle is set to `'arrived'`.
 *
 * `roadGraph` is currently unused (kept for future routing helpers
 * that need to look up neighbour tiles for a vehicle at an
 * intersection) but is part of the API to keep it stable for v2.
 */
export function advanceVehicle(
  vehicle: Vehicle,
  _roadGraph: RoadGraph,
  traffic: TrafficSnapshot,
  occupancy: OccupancySet,
): Vehicle {
  // Immutable input check.
  if (!vehicle) {
    throw new RangeError('advanceVehicle: vehicle is required');
  }
  if (vehicle.state === 'arrived') {
    return cloneVehicle(vehicle);
  }
  if (vehicle.path.length === 0) {
    return { ...cloneVehicle(vehicle), state: 'arrived', velocity: ZERO };
  }
  if (vehicle.path.length === 1) {
    // We're at the destination.
    return { ...cloneVehicle(vehicle), state: 'arrived', velocity: ZERO };
  }

  // The first path entry is the CURRENT tile. The NEXT tile to enter
  // is path[1].
  const next = vehicle.path[1]!;

  // Occupancy: a tile is blocked if another vehicle already claims it.
  if (occupancy.has(next)) {
    return {
      ...cloneVehicle(vehicle),
      state: 'waiting_for_vehicle',
      velocity: ZERO,
    };
  }

  // Traffic light: at an intersection, respect the phase.
  if (traffic.isIntersection(next) && !traffic.isGreenAt(next)) {
    return {
      ...cloneVehicle(vehicle),
      state: 'waiting_for_light',
      velocity: ZERO,
    };
  }

  // All clear — advance one tile. After advancing, the path drops
  // the current entry (we just consumed it) and the new "current"
  // becomes what was previously `next`.
  const newPath = vehicle.path.slice(1);
  // If newPath has at most one entry, we have entered the
  // destination tile — the vehicle has arrived.
  const arrived = newPath.length <= 1;
  const prev = vehicle.position;
  const target = tileCentre(next);
  const velocity: Vector2 = {
    x: target.x - prev.x,
    y: target.y - prev.y,
  };
  return {
    ...cloneVehicle(vehicle),
    position: target,
    velocity: arrived ? ZERO : velocity,
    path: newPath,
    state: arrived ? 'arrived' : 'driving',
  };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The current tile the vehicle is in. Tile coords are derived from
 * `position` (which is the centre of the tile). Always returns a
 * fresh object so callers can hold a snapshot.
 */
export function currentTile(vehicle: Vehicle): TileCoord {
  return {
    x: Math.floor(vehicle.position.x),
    y: Math.floor(vehicle.position.y),
  };
}

/**
 * Convenience: true if the vehicle is currently sitting on `coord`.
 * Used by the `OccupancySet` builder in `TrafficSystem`.
 */
export function vehicleBlocksTile(vehicle: Vehicle, coord: TileCoord): boolean {
  if (vehicle.state === 'arrived') return false;
  if (vehicle.path.length === 0) return false;
  const head = vehicle.path[0]!;
  return head.x === coord.x && head.y === coord.y;
}

/**
 * Return every tile the vehicle is projected to occupy in the
 * current tick. A driving vehicle occupies its current tile
 * (the head of `path`). A waiting vehicle still occupies its head.
 */
export function* projectedOccupiedTiles(vehicle: Vehicle): IterableIterator<TileCoord> {
  if (vehicle.state === 'arrived') return;
  if (vehicle.path.length === 0) return;
  yield { x: vehicle.path[0]!.x, y: vehicle.path[0]!.y };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

const ZERO: Vector2 = { x: 0, y: 0 };

function tileCentre(c: TileCoord): Vector2 {
  return { x: c.x + 0.5, y: c.y + 0.5 };
}

/**
 * Shallow-clone a vehicle. We never deep-clone the path because
 * `advanceVehicle` always returns a new path array, but we DO
 * copy the position/velocity objects so callers can mutate the
 * returned vehicle's position without affecting the input.
 */
function cloneVehicle(v: Vehicle): Vehicle {
  return {
    id: v.id,
    ownerId: v.ownerId,
    destinationId: v.destinationId,
    position: { x: v.position.x, y: v.position.y },
    velocity: { x: v.velocity.x, y: v.velocity.y },
    state: v.state,
    path: v.path.map((c) => ({ x: c.x, y: c.y })),
  };
}
