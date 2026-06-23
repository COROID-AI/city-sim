/**
 * MovementSystem — moves citizens towards their targets (spec §7.2).
 *
 * Responsibilities:
 *  1. For each citizen with an active `targetPosition`, walk them towards the
 *     target at WALK_SPEED (2 tiles / sim-second).
 *  2. When a commuting citizen's distance to target exceeds the vehicle
 *     threshold (20 tiles), set `commuteMode = 'vehicle'` (stub flag only —
 *     no Vehicle entity is spawned; that is Phase 5's job).
 *  3. Snap the citizen to the target and clear `targetPosition` once they are
 *     within ARRIVAL_THRESHOLD (0.5 tiles).
 *
 * TIME INTEGRATION:
 *  `update(citizens, deltaSimMs, buildings)` receives SIMULATION
 *  milliseconds (the compressed delta from TimeSystem), exactly like
 *  NeedSystem. WALK_SPEED is expressed in tiles per sim-second, so the
 *  per-step travel distance is `WALK_SPEED * (deltaSimMs / 1000)`.
 */
import type { Building, Vector2 } from '@/engine/types';
import type { Citizen } from '@/entities/Citizen';

/** Walking speed in tiles per simulation second. */
export const WALK_SPEED = 2;

/**
 * Distance (in tiles) at/under which a citizen is considered to have arrived
 * at their target. The citizen snaps to the target and targetPosition clears.
 */
export const ARRIVAL_THRESHOLD = 0.5;

/**
 * Distance (in tiles) above which a commuting citizen switches to vehicle
 * mode (stub). Distances <= this stay on foot.
 */
export const VEHICLE_DISTANCE_THRESHOLD = 20;

/**
 * Euclidean distance between two points.
 */
export function distance(a: Vector2, b: Vector2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Resolve the center position (in tile coordinates) of a building footprint.
 * Returns null if the building is undefined.
 */
export function buildingCenter(building: Building | undefined): Vector2 | null {
  if (!building) return null;
  return {
    x: building.x + building.width / 2,
    y: building.y + building.height / 2,
  };
}

export interface MovementUpdateOptions {
  /** Map of building id -> Building, used to resolve target positions. */
  buildings: Map<string, Building>;
}

/**
 * Advance all citizens towards their targets by one simulation step.
 *
 * Citizens without a `targetPosition` are skipped. Commuting citizens whose
 * distance to target exceeds the vehicle threshold get `commuteMode='vehicle'`
 * (stub). Citizens within ARRIVAL_THRESHOLD snap to the target and have their
 * `targetPosition` cleared.
 *
 * @param citizens   The citizen population to move.
 * @param deltaSimMs Simulation milliseconds elapsed this step.
 * @param options    Buildings map (reserved for future target resolution).
 */
export function updateMovement(
  citizens: ReadonlyArray<Citizen>,
  deltaSimMs: number,
  // Reserved for future target resolution (e.g. pathfinder lookups).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: MovementUpdateOptions,
): void {
  if (deltaSimMs <= 0) return;

  // Tiles travelled this step = speed (tiles/sec) * elapsed (sec).
  const stepDistance = WALK_SPEED * (deltaSimMs / 1000);

  for (const citizen of citizens) {
    const target = citizen.targetPosition;
    if (!target) continue;

    const pos = citizen.getPosition();
    const dist = distance(pos, target);

    // Commute vehicle stub: long-distance commutes switch to vehicle mode.
    if (citizen.activity === 'commuting' && dist > VEHICLE_DISTANCE_THRESHOLD) {
      citizen.commuteMode = 'vehicle';
    }

    // Arrived: snap to target and clear the destination.
    if (dist <= ARRIVAL_THRESHOLD) {
      citizen.setPosition({ x: target.x, y: target.y });
      citizen.targetPosition = null;
      citizen.commuteMode = 'foot';
      continue;
    }

    // Move towards the target, clamped so we never overshoot.
    const moveDist = Math.min(stepDistance, dist);
    const nx = pos.x + ((target.x - pos.x) / dist) * moveDist;
    const ny = pos.y + ((target.y - pos.y) / dist) * moveDist;
    citizen.setPosition({ x: nx, y: ny });

    // After moving, re-check arrival: a large step that lands within the
    // arrival threshold (or exactly on the target) should snap and clear.
    const newDist = distance(citizen.getPosition(), target);
    if (newDist <= ARRIVAL_THRESHOLD) {
      citizen.setPosition({ x: target.x, y: target.y });
      citizen.targetPosition = null;
      citizen.commuteMode = 'foot';
    }
  }
}

/**
 * Convenience wrapper exposing updateMovement as a class with the same shape
 * as NeedSystem / TimeSystem (an `update` method).
 */
export class MovementSystem {
  /**
   * Per-step movement update. See {@link updateMovement} for details.
   */
  update(
    citizens: ReadonlyArray<Citizen>,
    deltaSimMs: number,
    options: MovementUpdateOptions,
  ): void {
    updateMovement(citizens, deltaSimMs, options);
  }
}
