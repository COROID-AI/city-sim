/**
 * Entity picking: maps a screen-space click to the topmost entity.
 *
 * `pickEntityAt` converts screen pixel coordinates (e.g. from a `click`
 * event's `clientX` / `clientY`) into world coordinates via the camera's
 * `screenToWorld` transform, then performs hit-testing in this priority
 * order:
 *
 *   1. **Buildings** — a point-in-footprint test using the tile grid. Any
 *      click that lands on a building tile selects that building.
 *   2. **Citizens** — nearest-within-radius search. The closest citizen
 *      whose distance to the click is ≤ {@link CITIZEN_PICK_RADIUS} world
 *      units is selected.
 *   3. **Vehicles** — same nearest-within-radius search with
 *      {@link VEHICLE_PICK_RADIUS}.
 *
 * The function returns a {@link Selection} (a discriminated union on
 * `kind`) or `null` when nothing is hit.  The selection carries only the
 * entity kind and ID, keeping it lightweight and serialisable for the
 * detail-panel consumer.
 */

import type { Citizen, Vehicle, World } from '../sim/types';
import type { Camera } from './camera';
import { getBuildingAt } from '../sim/queries';

// ─── Tunables ────────────────────────────────────────────────────────────────

/**
 * Pick radius for citizens, in world units (grid cells).
 *
 * At default zoom (32 px/cell) this is ~25 screen pixels — comfortable
 * for clicking a single-citizen dot without being too generous.
 */
export const CITIZEN_PICK_RADIUS = 0.8;

/**
 * Pick radius for vehicles, in world units (grid cells).
 */
export const VEHICLE_PICK_RADIUS = 0.8;

// ─── Selection ───────────────────────────────────────────────────────────────

/**
 * A lightweight reference to a selected entity.
 *
 * Discriminated on `kind` so consumers can exhaustively switch.
 */
export type Selection =
  | { readonly kind: 'building'; readonly id: string }
  | { readonly kind: 'citizen'; readonly id: string }
  | { readonly kind: 'vehicle'; readonly id: string };

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Determine which entity (if any) is under the screen-space point
 * `(screenX, screenY)`.
 *
 * Hit-testing priority: buildings → citizens → vehicles.  Only the
 * topmost hit is returned.
 *
 * @param world    The simulation world.
 * @param camera   The camera providing the screen→world transform.
 * @param screenX  X coordinate in screen pixels (e.g. `clientX`).
 * @param screenY  Y coordinate in screen pixels (e.g. `clientY`).
 * @returns A {@link Selection} for the hit entity, or `null`.
 */
export function pickEntityAt(
  world: World,
  camera: Camera,
  screenX: number,
  screenY: number,
): Selection | null {
  const worldPos = camera.screenToWorld(screenX, screenY);

  // ── 1. Buildings (point-in-footprint via tile lookup) ─────────────────────
  const tileX = Math.floor(worldPos.x);
  const tileY = Math.floor(worldPos.y);
  const building = getBuildingAt(world, tileX, tileY);
  if (building) {
    return { kind: 'building', id: building.id };
  }

  // ── 2. Citizens (nearest within radius) ──────────────────────────────────
  const citizen = nearestEntity(
    world.citizens.values() as IterableIterator<Citizen>,
    worldPos,
    CITIZEN_PICK_RADIUS,
  );
  if (citizen) {
    return { kind: 'citizen', id: citizen.id };
  }

  // ── 3. Vehicles (nearest within radius) ──────────────────────────────────
  const vehicle = nearestEntity(
    world.vehicles.values() as IterableIterator<Vehicle>,
    worldPos,
    VEHICLE_PICK_RADIUS,
  );
  if (vehicle) {
    return { kind: 'vehicle', id: vehicle.id };
  }

  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generic nearest-within-radius search over any entity with a `position`
 * field and an `id`.
 *
 * Returns the closest entity whose Euclidean distance to `point` is
 * ≤ `radius`, or `null` if none qualify.
 */
function nearestEntity<T extends { id: string; position: { x: number; y: number } }>(
  entities: IterableIterator<T>,
  point: { x: number; y: number },
  radius: number,
): T | null {
  let best: T | null = null;
  let bestDist = radius;

  for (const entity of entities) {
    const dx = entity.position.x - point.x;
    const dy = entity.position.y - point.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= bestDist) {
      best = entity;
      bestDist = dist;
    }
  }

  return best;
}
