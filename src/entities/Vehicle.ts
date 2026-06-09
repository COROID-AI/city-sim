/**
 * Vehicle entity.
 *
 * Spec reference: §5.3 Entity Model, §7.4 Traffic.
 *
 * Pure data + pure functions. `advanceVehicle` returns a new Vehicle
 * object on every tick, so the downstream renderer (and the citizen
 * handoff task) can subscribe to position changes with simple equality
 * checks. No React, no DOM, no engine imports.
 *
 * Path representation: a flat array of `Vector2` tile coordinates
 * (intersections) produced by the A* pathfinder. The vehicle's
 * `pathIndex` is the index of the *next* tile it intends to enter,
 * which makes the red-light stop check a constant-time lookup of
 * `path[pathIndex]`.
 */
import type { Vector2, VehicleId } from '@/types/common';

/** A vehicle moving through a path of intersection tiles. */
export interface Vehicle {
  /** Stable unique identifier. */
  id: VehicleId;
  /** Current tile position. */
  position: Vector2;
  /** Path to traverse, produced by the A* pathfinder. */
  path: readonly Vector2[];
  /** Index of the *next* tile in `path` the vehicle intends to enter. */
  pathIndex: number;
  /** Current driving status. */
  status: VehicleStatus;
  /** Tiles-per-tick movement speed. Defaults to 1. Clamped to >= 1. */
  speed: number;
}

export type VehicleStatus = 'driving' | 'waiting' | 'arrived';

export interface CreateVehicleParams {
  id: VehicleId;
  position: Vector2;
  path?: readonly Vector2[];
  pathIndex?: number;
  status?: VehicleStatus;
  speed?: number;
}

/**
 * Build a fully-formed vehicle. Defaults: speed=1, pathIndex=0,
 * status='driving'. The path is frozen so downstream code can't
 * mutate it accidentally.
 */
export function createVehicle(params: CreateVehicleParams): Vehicle {
  const pathArray = params.path ?? [];
  const path = Object.freeze([...pathArray]) as readonly Vector2[];
  const defaultIndex = initialPathIndex(params.position, path);
  const pathIndex = clampPathIndex(params.pathIndex ?? defaultIndex, path.length);
  const status = params.status ?? 'driving';
  const speed = Math.max(1, Number.isFinite(params.speed) ? Math.floor(params.speed as number) : 1);
  return {
    id: params.id,
    position: { ...params.position },
    path,
    pathIndex,
    status,
    speed,
  };
}

export interface AdvanceVehicleParams {
  /** Set of `x,y` keys for tiles that are currently red. */
  redLightTiles?: ReadonlySet<string>;
  /**
   * Speed override for this tick. If omitted, the vehicle's own
   * `speed` field is used.
   */
  speed?: number;
  /**
   * Tick counter (passed in for testability). Not used by the
   * implementation today but reserved for future per-tile animations.
   */
  tick?: number;
}

/**
 * Advance a vehicle by one tick. Returns a new Vehicle; never mutates
 * the input. Behaviour:
 *   - if status === 'arrived' the vehicle is returned unchanged;
 *   - if the next tile is in the red set, status -> 'waiting' and the
 *     vehicle does not move (position/pathIndex unchanged);
 *   - otherwise position becomes the next tile and pathIndex advances;
 *   - when pathIndex reaches `path.length - 1` and the vehicle has
 *     arrived at the last tile, status -> 'arrived'.
 */
export function advanceVehicle(
  vehicle: Vehicle,
  params: AdvanceVehicleParams = {},
): Vehicle {
  if (vehicle.status === 'arrived') {
    return vehicle;
  }

  const redSet = params.redLightTiles ?? new Set<string>();
  const next = vehicle.path[vehicle.pathIndex];
  if (!next) {
    return { ...vehicle, status: 'arrived' };
  }

  const nextKey = `${next.x},${next.y}`;
  if (redSet.has(nextKey) && vehicle.status !== 'waiting') {
    return { ...vehicle, status: 'waiting' };
  }
  if (redSet.has(nextKey)) {
    return vehicle;
  }

  const newPosition = next;
  const newIndex = vehicle.pathIndex + 1;
  const atEnd = newIndex >= vehicle.path.length;
  return {
    ...vehicle,
    position: { x: newPosition.x, y: newPosition.y },
    pathIndex: newIndex,
    status: atEnd ? 'arrived' : 'driving',
  };
}

// ---------- internal helpers ----------

/**
 * Decide the initial pathIndex for a vehicle. If the vehicle's
 * position already matches the first path tile, skip ahead by one so
 * the next `advanceVehicle` call moves to a new tile. If the position
 * is unknown, start at 0 (the path's first tile is then "where I
 * want to be" and the first tick will move toward it).
 */
function initialPathIndex(
  position: Vector2,
  path: readonly Vector2[],
): number {
  if (path.length === 0) return 0;
  const first = path[0];
  if (first && first.x === position.x && first.y === position.y) {
    return 1;
  }
  return 0;
}

function clampPathIndex(value: number, length: number): number {
  if (!Number.isFinite(value) || length === 0) return 0;
  const floored = Math.floor(value);
  if (floored < 0) return 0;
  if (floored >= length) return length - 1;
  return floored;
}
