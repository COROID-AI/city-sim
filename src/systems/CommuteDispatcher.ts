/**
 * Commute dispatcher — decides how a citizen travels between
 * buildings and (when the commute is long enough) spawns a vehicle
 * on the road graph.
 *
 * The dispatcher is a thin policy layer:
 *  - `shouldDrive(home, work)` answers the policy question
 *    "should this commute be by vehicle?".
 *  - `planCommute(home, work, pathfinder)` returns either a 'walk'
 *    decision (citizen walks) or a 'drive' decision with a road
 *    graph path.
 *  - `createCommuteVehicle(...)` builds the actual `Vehicle` object
 *    to insert into the world.
 *
 * Layer rule: pure TypeScript, no React, no DOM, no engine runtime
 * import. Allowed deps: `@/engine` (types), `@/entities` (Road +
 * Vehicle helpers).
 *
 * Policy:
 *  - If the Manhattan distance from home to work is strictly greater
 *    than 20 tiles, the citizen drives.
 *  - Otherwise they walk (the existing `MovementSystem` handles that).
 *  - When driving, the dispatcher plans a road path from the road
 *    tile closest to the home, to the road tile closest to the work.
 *  - If the path planner returns no path (e.g. the world has no
 *    roads), the dispatcher falls back to a 'walk' decision so the
 *    citizen is never permanently stuck.
 */

import type { TileCoord, Vehicle } from '@/engine/types';
import type { Pathfinder } from '@/engine/Pathfinder';
import { createVehicle } from '@/entities/Vehicle';
import { findNearestRoadNode } from '@/entities/Road';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Manhattan-distance threshold above which a citizen drives instead
 * of walking. Set in the plan as a strict greater-than (20 tiles
 * walks, 21+ drives).
 */
export const COMMUTE_DRIVE_THRESHOLD_TILES = 20;

/* -------------------------------------------------------------------------- */
/* Decision types                                                             */
/* -------------------------------------------------------------------------- */

export type CommuteDecision =
  | { mode: 'walk' }
  | { mode: 'drive'; path: ReadonlyArray<TileCoord>; startTile: TileCoord };

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Pure: true iff the commute should be by vehicle. Strict greater
 * than: at exactly 20 tiles the citizen walks, at 21+ they drive.
 */
export function shouldDrive(home: TileCoord, work: TileCoord): boolean {
  return manhattan(home, work) > COMMUTE_DRIVE_THRESHOLD_TILES;
}

/**
 * Decide the commute mode. If the policy says "drive" but the road
 * graph has no road near either endpoint, falls back to "walk".
 */
export function planCommute(
  home: TileCoord,
  work: TileCoord,
  pathfinder: Pathfinder,
): CommuteDecision {
  if (!shouldDrive(home, work)) return { mode: 'walk' };

  const startIdx = pathfinder.roadGraph.size > 0 ? findNearestRoadNode(pathfinder.roadGraph, home) : -1;
  const endIdx = pathfinder.roadGraph.size > 0 ? findNearestRoadNode(pathfinder.roadGraph, work) : -1;
  if (startIdx === -1 || endIdx === -1) return { mode: 'walk' };
  const startTile = pathfinder.roadGraph.nodes[startIdx]!;
  const endTile = pathfinder.roadGraph.nodes[endIdx]!;

  const result = pathfinder.findPath(startTile, endTile);
  if (!result) return { mode: 'walk' };
  return { mode: 'drive', path: result.path, startTile };
}

/**
 * Build the `Vehicle` object a drive commute should spawn. The
 * caller is responsible for inserting the vehicle into the world
 * via `World.addVehicle`.
 */
export function createCommuteVehicle(args: {
  /** Unique id, e.g. `vehicle-${ownerId}`. */
  id: string;
  /** Citizen that owns the vehicle. */
  ownerId: string;
  /** Destination building id (the workplace). */
  destinationId: string | null;
  /** Precomputed drive decision from `planCommute`. */
  decision: Extract<CommuteDecision, { mode: 'drive' }>;
}): Vehicle {
  return createVehicle({
    id: args.id,
    ownerId: args.ownerId,
    destinationId: args.destinationId,
    startTile: args.decision.startTile,
    path: args.decision.path,
  });
}

/**
 * Manhattan distance between two tile coords. Exported for tests
 * and for callers that want to log the threshold logic.
 */
export function manhattan(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
