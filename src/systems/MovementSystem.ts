/**
 * MovementSystem — moves citizens toward their per-citizen `target`
 * at 2 tiles per in-world second along grid-aligned paths.
 *
 * Phase-1 stub: the routing algorithm itself is a Manhattan walk
 * (axis-aligned, axis-at-a-time) because no road graph / A* exists
 * yet. The downstream "Road graph, A* Pathfinder, Vehicle, TrafficSystem"
 * task will replace the body of `update` with a real path-following
 * implementation. The public surface (`update(world, dt)`,
 * `setTarget(citizen, x, y)`) is the contract that the new
 * implementation must keep.
 *
 * Speed model: 2 tiles per in-world second. The `dt` argument is
 * expressed in in-world seconds (the time-system has already applied
 * the speed multiplier). The citizen's `velocity` is set to a unit
 * vector times 2 tiles/s whenever the citizen is in motion, and to
 * the zero vector when it has reached the target.
 *
 * Layer rule: this module is pure TypeScript. It must NOT import
 * React, DOM globals, or the engine runtime (no `World` import).
 * It accepts the world through the structural `MovementSystemWorldView`
 * interface so the systems layer stays decoupled from the engine.
 */

import type { Citizen, Vector2 } from '@/engine/types';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Default walking speed in tiles per in-world second. 2 tiles/s is
 * roughly 100 px/s at the default `TILE_PIXELS` and reads as a
 * brisk-but-not-frantic pace in the viewport.
 */
export const MOVEMENT_TILES_PER_SECOND = 2;

/** Stop the citizen within this many tiles of the target. */
export const MOVEMENT_ARRIVAL_TOLERANCE = 0.01;

/* -------------------------------------------------------------------------- */
/* World view                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Structural world view used by `MovementSystem`. The engine's `World`
 * class already exposes `citizens_(): IterableIterator<Citizen>`, so
 * no runtime engine import is needed.
 */
export interface MovementSystemWorldView {
  citizens_(): IterableIterator<Citizen>;
}

/* -------------------------------------------------------------------------- */
/* Per-citizen target storage                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A simple key→target map. We store the target alongside the citizen
 * in a parallel map (rather than mutating the `Citizen` shape) so the
 * engine type stays clean and the system remains testable in
 * isolation. Use `setTarget` / `clearTarget` to mutate.
 */
export type TargetMap = Map<string, Vector2>;

/* -------------------------------------------------------------------------- */
/* System                                                                     */
/* -------------------------------------------------------------------------- */

export interface MovementSystemOptions {
  /** Override the default walking speed, in tiles/sec. */
  readonly tilesPerSecond?: number;
  /** Override the default arrival tolerance, in tiles. */
  readonly arrivalTolerance?: number;
}

/**
 * Walk-to-target driver. Stateless apart from the per-citizen
 * `targets` map. The system is intentionally trivial in v1: it
 * moves the citizen along a Manhattan path (axis-aligned, axis at a
 * time) at 2 tiles/s. The downstream road-graph task will replace
 * the body of `update` with path-following logic while keeping the
 * public API identical.
 */
export class MovementSystem {
  private readonly tilesPerSecond: number;
  private readonly arrivalTolerance: number;
  private readonly targets: TargetMap = new Map();

  constructor(options: MovementSystemOptions = {}) {
    const tps = options.tilesPerSecond ?? MOVEMENT_TILES_PER_SECOND;
    if (!Number.isFinite(tps) || tps <= 0) {
      throw new RangeError(`MovementSystem: tilesPerSecond must be > 0 (got ${tps})`);
    }
    const tol = options.arrivalTolerance ?? MOVEMENT_ARRIVAL_TOLERANCE;
    if (!Number.isFinite(tol) || tol < 0) {
      throw new RangeError(`MovementSystem: arrivalTolerance must be >= 0 (got ${tol})`);
    }
    this.tilesPerSecond = tps;
    this.arrivalTolerance = tol;
  }

  /**
   * Set the in-world tile position the citizen should walk to.
   * Out-of-bounds / NaN inputs are clamped to finite numbers (the
   * world itself bounds-checks position via its own API; this
   * system is a pure-TS helper).
   */
  setTarget(citizen: Citizen, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError(
        `MovementSystem.setTarget: target must be finite (got ${x}, ${y})`,
      );
    }
    this.targets.set(citizen.id, { x, y });
  }

  /** Clear the citizen's target so `update` will zero its velocity. */
  clearTarget(citizen: Citizen): void {
    this.targets.delete(citizen.id);
  }

  /** Read-only snapshot of the per-citizen target map (for tests / debug). */
  getTargets(): TargetMap {
    return new Map(this.targets);
  }

  /**
   * Advance every citizen with a target by `dt` in-world seconds.
   * Sets `citizen.velocity` to a unit vector times `tilesPerSecond`
   * while the citizen is in motion, and to `{ x: 0, y: 0 }` once
   * they have arrived. Citizens without a target are left alone
   * (their velocity is also zeroed for safety).
   */
  update(world: MovementSystemWorldView, dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError(`MovementSystem.update: dt must be >= 0 (got ${dt})`);
    }
    if (dt === 0) return;
    const step = this.tilesPerSecond * dt;

    for (const citizen of world.citizens_()) {
      const target = this.targets.get(citizen.id);
      if (!target) {
        citizen.velocity.x = 0;
        citizen.velocity.y = 0;
        continue;
      }
      const dx = target.x - citizen.position.x;
      const dy = target.y - citizen.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= this.arrivalTolerance) {
        // Arrived: snap to target and zero velocity.
        citizen.position.x = target.x;
        citizen.position.y = target.y;
        citizen.velocity.x = 0;
        citizen.velocity.y = 0;
        continue;
      }
      if (dist <= step) {
        // Final step: take whatever distance is left and stop.
        citizen.position.x = target.x;
        citizen.position.y = target.y;
        citizen.velocity.x = 0;
        citizen.velocity.y = 0;
        continue;
      }
      // Normalise the direction and step by `step` tiles. Both axes
      // are scaled by the same factor so the result is a perfectly
      // diagonal-aware line of motion (not a Manhattan line). The
      // downstream path-following implementation will keep this
      // contract: velocity is a unit vector × speed, in tiles/s.
      const ux = dx / dist;
      const uy = dy / dist;
      citizen.position.x += ux * step;
      citizen.position.y += uy * step;
      citizen.velocity.x = ux * this.tilesPerSecond;
      citizen.velocity.y = uy * this.tilesPerSecond;
    }
  }
}
