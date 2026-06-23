/**
 * Vehicle — a path-following traffic actor (spec §5.3, §7.5).
 *
 * A Vehicle extends {@link Entity} and travels along an A* path (an ordered
 * list of {@link RoadNode}s produced by {@link Pathfinder}). Movement is
 * driven by {@link TrafficSystem.updateVehicles}, which:
 *   - advances the vehicle towards the next path node at `speed` tiles per
 *     simulation second,
 *   - snaps the vehicle onto each node centre and advances `currentNodeIndex`,
 *   - flips `isStopped` / `state` when a red or yellow light is encountered
 *     within {@link STOP_DISTANCE} tiles of an upcoming intersection.
 *
 * TIME INTEGRATION:
 *  `speed` is expressed in tiles per simulation second, exactly like
 *  MovementSystem's WALK_SPEED. The per-step travel distance is therefore
 *  `speed * (deltaSimMs / 1000)`.
 */
import type { RoadNode, VehicleState, Vector2 } from '@/engine/types';

/**
 * Bright vehicle color palette (spec §6.1). Each vehicle picks one at spawn.
 */
export const VEHICLE_COLORS = [
  '#f44336', // red
  '#ffeb3b', // yellow
  '#2196f3', // blue
  '#4caf50', // green
  '#e91e63', // pink
  '#ff9800', // orange
] as const;

/**
 * Pick a deterministic-ish random color from {@link VEHICLE_COLORS}.
 * @param rng Optional RNG (defaults to Math.random).
 */
export function randomVehicleColor(rng: () => number = Math.random): string {
  return VEHICLE_COLORS[Math.floor(rng() * VEHICLE_COLORS.length)]!;
}

import { Entity } from '@/entities/Entity';

/** Default vehicle speed in tiles per simulation second (spec §7.5). */
export const DEFAULT_VEHICLE_SPEED = 5;

/**
 * Distance (in tiles) at/under which a vehicle is considered to have reached
 * a path node centre. The vehicle snaps to the node and the index advances.
 */
export const NODE_ARRIVAL_THRESHOLD = 0.25;

/**
 * Distance (in tiles) within which a vehicle must stop for a red/yellow light
 * at an upcoming intersection (spec §7.5: "within 2 tiles").
 */
export const STOP_DISTANCE = 2;

/** Options accepted by the {@link Vehicle} constructor. */
export interface VehicleOptions {
  /** Explicit entity id; auto-generated when omitted. */
  id?: string;
  /** Ordered list of road nodes the vehicle will follow. */
  path?: RoadNode[];
  /** Speed in tiles per simulation second (defaults to 5). */
  speed?: number;
  /** Initial movement state (defaults to `driving`). */
  state?: VehicleState;
  /** Whether the vehicle starts stopped (defaults to false). */
  isStopped?: boolean;
  /** Index of the path node the vehicle is heading towards. */
  currentNodeIndex?: number;
  /**
   * Id of the citizen driving this vehicle. Populated by the downstream
   * citizen-vehicle handoff task; null for unassigned / test vehicles.
   */
  citizenId?: string | null;
  /** Render color from the {@link VEHICLE_COLORS} palette. */
  color?: string;
  /** Initial velocity vector (defaults to {x:0, y:0}). */
  velocity?: Vector2;
}

export class Vehicle extends Entity {
  /** Ordered road-node path the vehicle follows (may be empty). */
  path: RoadNode[];

  /**
   * Index into `path` of the node the vehicle is currently heading towards.
   * When the vehicle reaches this node the index advances. A vehicle whose
   * `currentNodeIndex >= path.length` has completed its path.
   */
  currentNodeIndex: number;

  /** Speed in tiles per simulation second. */
  speed: number;

  /** Whether the vehicle is currently stopped (e.g. at a red light). */
  isStopped: boolean;

  /** Current movement / activity state (spec §5.3 VehicleState). */
  state: VehicleState;

  /**
   * Id of the citizen driving this vehicle, or null. Set by the downstream
   * citizen-vehicle handoff task.
   */
  citizenId: string | null;

  /**
   * Render color (spec §6.1 bright palette). Assigned at spawn via
   * {@link randomVehicleColor} unless explicitly provided.
   */
  color: string;

  /**
   * Current velocity vector (tiles per sim-second). Used by the Renderer to
   * orient the vehicle rectangle. Defaults to {0,0}; TrafficSystem updates it
   * each step as the vehicle moves between path nodes.
   */
  velocity: Vector2;

  /**
   * @param position Initial world-space position.
   * @param options  Optional configuration (see {@link VehicleOptions}).
   */
  constructor(position: Vector2 = { x: 0, y: 0 }, options: VehicleOptions = {}) {
    super(position, options.id);
    this.path = options.path ? [...options.path] : [];
    this.speed = options.speed ?? DEFAULT_VEHICLE_SPEED;
    this.state = options.state ?? 'driving';
    this.isStopped = options.isStopped ?? false;
    this.currentNodeIndex = options.currentNodeIndex ?? 0;
    this.citizenId = options.citizenId ?? null;
    this.color = options.color ?? randomVehicleColor();
    this.velocity = options.velocity ? { ...options.velocity } : { x: 0, y: 0 };
  }

  /**
   * Whether the vehicle has consumed every node in its path.
   * A vehicle with an empty path is considered arrived immediately.
   */
  hasArrived(): boolean {
    return this.currentNodeIndex >= this.path.length;
  }

  /**
   * The node the vehicle is currently heading towards, or null if the path is
   * exhausted.
   */
  targetNode(): RoadNode | null {
    if (this.hasArrived()) return null;
    return this.path[this.currentNodeIndex] ?? null;
  }

  /**
   * Replace the vehicle's path and reset progress to the start.
   * State is reset to `driving` and `isStopped` to false.
   */
  setPath(path: RoadNode[]): void {
    this.path = [...path];
    this.currentNodeIndex = 0;
    this.isStopped = false;
    this.state = 'driving';
  }

  /**
   * Mark the vehicle as stopped (e.g. waiting at a red light).
   */
  stop(): void {
    this.isStopped = true;
    this.state = 'stopped';
  }

  /**
   * Mark the vehicle as driving again (e.g. light turned green).
   */
  resume(): void {
    this.isStopped = false;
    this.state = 'driving';
  }

  /**
   * Per-step update hook required by {@link Entity}.
   *
   * The actual movement logic lives in {@link TrafficSystem.updateVehicles},
   * which has access to the road graph and traffic-light state. This method
   * is a no-op placeholder so the Vehicle satisfies the Entity contract and
   * can be advanced standalone in unit tests if needed.
   *
   * @param _deltaMs Simulation milliseconds since the last update (unused).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_deltaMs: number): void {
    // Intentional no-op: movement is driven by TrafficSystem.
  }
}
