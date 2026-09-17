/**
 * System registry — the composition seam of the game.
 *
 * `src/game/Game.ts` is closed for modification: it attaches whatever this
 * registry contains, in array order, and drives it through the fixed-step loop.
 * Composing the game therefore means editing this file (or pushing into the
 * registry before `createGame` runs) and nothing else.
 *
 * A system:
 *  - `attach(context)` — runs once, receives the scene root, camera, adapter,
 *    event channel, deterministic RNG, clock and step duration. Create objects,
 *    add them to `context.scene`, subscribe to events here.
 *  - `update(update)` — runs once per fixed simulation step with the frozen
 *    state snapshot. Emit domain events instead of mutating state directly.
 *  - `dispose()` — runs exactly once on teardown; release geometries,
 *    materials, GPU resources and listeners here.
 */

import type { Object3D, PerspectiveCamera } from 'three';
import type { DomainEventChannel } from './events';
import type { Clock, Rng } from './loop';
import type { DeepReadonly, GameState } from '../sim/state';
import type { RenderAdapter } from '../render/renderer';

/** Everything an attached system may touch while it lives. */
export interface SystemContext {
  /** Scene graph root; systems add their own subtree under it. */
  readonly scene: Object3D;
  /** Active camera, for systems that place billboards or labels. */
  readonly camera: PerspectiveCamera;
  /** The adapter the runtime draws through (webgl or headless). */
  readonly adapter: RenderAdapter;
  /** Emit domain events here; the runtime reduces them at step boundaries. */
  readonly events: DomainEventChannel;
  /** Seeded, deterministic random stream shared by the run. */
  readonly rng: Rng;
  /** Time source driving the loop. */
  readonly clock: Clock;
  /** Seed this run was started with. */
  readonly seed: number;
  /** Fixed simulation step duration in milliseconds. */
  readonly stepMs: number;
}

/** Per-step payload handed to `update()`. */
export interface SystemUpdate {
  /** Same context object the system received in `attach()`. */
  readonly context: SystemContext;
  /** Frozen, read-only view of the state as of this step. */
  readonly state: DeepReadonly<GameState>;
  /** 1-based fixed-step index. */
  readonly step: number;
  /** Fixed step duration in milliseconds. */
  readonly deltaMs: number;
  /** Simulated time elapsed after this step, in milliseconds. */
  readonly elapsedMs: number;
}

/** A composable unit of game behaviour. */
export interface GameSystem {
  /** Stable identity, unique within a run. Used for ordering and diagnostics. */
  readonly id: string;
  /** Called once when the runtime starts. */
  attach(context: SystemContext): void;
  /** Called once per fixed simulation step, in registry order. */
  update(update: SystemUpdate): void;
  /** Called exactly once when the runtime is disposed. */
  dispose(): void;
}

/**
 * Ordered registry of systems composed into the game.
 *
 * Shipped empty on purpose: this foundation task delivers the runtime, its
 * contracts and the boot scene, while later modules append their systems here.
 * Edit this array to compose the game.
 */
export const systems: GameSystem[] = [];

/** Read-only view of the live registry. */
export function getRegisteredSystems(): readonly GameSystem[] {
  return systems;
}

/** Append a system to the registry and return it, for fluent composition. */
export function registerSystem(system: GameSystem): GameSystem {
  systems.push(system);
  return system;
}

/** Remove a system from the registry. Returns whether it was present. */
export function unregisterSystem(system: GameSystem): boolean {
  const index = systems.indexOf(system);
  if (index < 0) return false;
  systems.splice(index, 1);
  return true;
}
