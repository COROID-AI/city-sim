/**
 * TrafficSystem — moves vehicles along A* paths and manages traffic lights
 * (spec §7.5).
 *
 * Responsibilities:
 *  1. Implement {@link TrafficLightProvider} so the Pathfinder can query the
 *     current light state at any intersection node.
 *  2. Cycle traffic lights on intersection nodes through four phases:
 *       NS green (30s) → NS yellow (5s) → EW green (30s) → EW yellow (5s)
 *     Total cycle = 70 simulation seconds.
 *  3. Advance each {@link Vehicle} along its path at the vehicle's `speed`
 *     (tiles / sim-second), stopping it when a red or yellow light is within
 *     {@link STOP_DISTANCE} tiles of an upcoming intersection, and resuming
 *     when the light turns green.
 *
 * TIME INTEGRATION:
 *  All timing uses SIMULATION milliseconds (the compressed delta from
 *  TimeSystem). Phase durations are expressed in sim-seconds, so 30s =
 *  30 000 sim-ms. `update(deltaSimMs)` advances the global phase clock by
 *  `deltaSimMs` each step.
 */
import type {
  RoadGraph,
  RoadNode,
  TrafficLightProvider,
  TrafficLightState,
} from '@/engine/types';
import {
  NODE_ARRIVAL_THRESHOLD,
  STOP_DISTANCE,
  Vehicle,
} from '@/entities/Vehicle';

/** Maximum number of vehicles the system will track (spec §7.5). */
export const MAX_VEHICLES = 20;

/** Simulation milliseconds per simulation second. */
const MS_PER_SECOND = 1000;

/** Duration of each green phase, in simulation milliseconds. */
const GREEN_PHASE_MS = 30 * MS_PER_SECOND;

/** Duration of each yellow phase, in simulation milliseconds. */
const YELLOW_PHASE_MS = 5 * MS_PER_SECOND;

/** Total length of one full traffic-light cycle, in simulation ms. */
const CYCLE_MS = 2 * GREEN_PHASE_MS + 2 * YELLOW_PHASE_MS; // 70 000

/**
 * The four sequential phases of a traffic-light cycle.
 *
 * During NS phases the north/south direction has right-of-way; during EW
 * phases the east/west direction does. Yellow phases always follow the
 * matching green phase.
 */
export type TrafficPhase = 'ns-green' | 'ns-yellow' | 'ew-green' | 'ew-yellow';

/** Ordered phase list defining the cycle order. */
const PHASE_ORDER: TrafficPhase[] = [
  'ns-green',
  'ns-yellow',
  'ew-green',
  'ew-yellow',
];

/** Duration of each phase, in simulation milliseconds. */
const PHASE_DURATION_MS: Record<TrafficPhase, number> = {
  'ns-green': GREEN_PHASE_MS,
  'ns-yellow': YELLOW_PHASE_MS,
  'ew-green': GREEN_PHASE_MS,
  'ew-yellow': YELLOW_PHASE_MS,
};

/**
 * Determine the active traffic phase from an elapsed-within-cycle timestamp.
 *
 * @param elapsedInCycle Simulation ms elapsed since the start of the cycle
 *                       (will be normalised into [0, CYCLE_MS)).
 */
export function phaseForElapsed(elapsedInCycle: number): TrafficPhase {
  let t = elapsedInCycle % CYCLE_MS;
  if (t < 0) t += CYCLE_MS;
  for (const phase of PHASE_ORDER) {
    const dur = PHASE_DURATION_MS[phase];
    if (t < dur) return phase;
    t -= dur;
  }
  // Unreachable given the modulo above; fall back to the first phase.
  return 'ns-green';
}

/**
 * Resolve the light state a given approach direction sees during a phase.
 *
 * A vehicle travelling north/south sees green during `ns-green`, yellow
 * during `ns-yellow`, and red otherwise. East/west is the mirror image.
 *
 * @param phase     The active global phase.
 * @param direction `'ns'` if the vehicle is travelling vertically, `'ew'`
 *                  if travelling horizontally.
 */
export function lightStateForDirection(
  phase: TrafficPhase,
  direction: 'ns' | 'ew',
): TrafficLightState {
  if (direction === 'ns') {
    if (phase === 'ns-green') return 'green';
    if (phase === 'ns-yellow') return 'yellow';
    return 'red';
  }
  // ew
  if (phase === 'ew-green') return 'green';
  if (phase === 'ew-yellow') return 'yellow';
  return 'red';
}

/**
 * Manhattan distance between two nodes (consistent with the grid road graph).
 */
function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Euclidean distance between two points (used for smooth vehicle movement).
 */
function euclidean(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Determine the travel direction between two consecutive path nodes.
 *
 * On the 4-connected grid a segment is purely horizontal or vertical. If the
 * x-delta dominates the vehicle is east/west bound; otherwise north/south.
 *
 * @returns `'ns'` or `'ew'`.
 */
function approachDirection(from: RoadNode, to: RoadNode): 'ns' | 'ew' {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx > dy ? 'ew' : 'ns';
}

export interface TrafficSystemOptions {
  /** Road graph used to look up intersection nodes. */
  graph?: RoadGraph;
  /** Initial elapsed simulation ms (for deterministic testing). */
  initialElapsedMs?: number;
}

export class TrafficSystem implements TrafficLightProvider {
  /** Vehicles currently managed by the system. */
  private readonly vehicles: Vehicle[] = [];

  /** Road graph used to resolve intersection nodes. */
  private readonly graph: RoadGraph | null;

  /** Accumulated simulation ms since the system started (drives phases). */
  private elapsedMs: number;

  /**
   * Cached active phase for the current `elapsedMs`. Recomputed in `update`.
   */
  private currentPhase: TrafficPhase;

  constructor(options: TrafficSystemOptions = {}) {
    this.graph = options.graph ?? null;
    this.elapsedMs = options.initialElapsedMs ?? 0;
    this.currentPhase = phaseForElapsed(this.elapsedMs);
  }

  // ---------------------------------------------------------------------
  // TrafficLightProvider implementation
  // ---------------------------------------------------------------------

  /**
   * Return the traffic-light state at the given intersection node, or null if
   * the node has no light (non-intersection or unknown node).
   *
   * Because the global cycle is synchronised, the NS and EW directions share
   * a single light fixture per intersection: the returned state reflects the
   * direction that currently has right-of-way. Callers needing per-direction
   * state should use {@link getLightForDirection}.
   *
   * The state returned here is the *right-of-way* state: green while any
   * direction may proceed, yellow during a yellow phase, red only when both
   * directions are stopped (which never happens in this cycle). To keep the
   * Pathfinder behaviour meaningful we return the state of the direction that
   * currently has green/yellow; the opposing direction is implicitly red.
   */
  getLight(nodeId: string): TrafficLightState | null {
    const node = this.resolveNode(nodeId);
    if (!node || node.kind !== 'intersection') return null;
    // Return the state of whichever direction currently has right-of-way.
    // During ns-* phases report the NS state; during ew-* the EW state.
    if (this.currentPhase === 'ns-green' || this.currentPhase === 'ns-yellow') {
      return lightStateForDirection(this.currentPhase, 'ns');
    }
    return lightStateForDirection(this.currentPhase, 'ew');
  }

  /**
   * Return the light state a vehicle travelling `direction` sees at the given
   * intersection node, or null if the node has no light.
   */
  getLightForDirection(
    nodeId: string,
    direction: 'ns' | 'ew',
  ): TrafficLightState | null {
    const node = this.resolveNode(nodeId);
    if (!node || node.kind !== 'intersection') return null;
    return lightStateForDirection(this.currentPhase, direction);
  }

  /** Current active global phase. */
  getPhase(): TrafficPhase {
    return this.currentPhase;
  }

  /** Elapsed simulation ms since the system started. */
  getElapsedMs(): number {
    return this.elapsedMs;
  }

  // ---------------------------------------------------------------------
  // Vehicle management
  // ---------------------------------------------------------------------

  /**
   * Register a vehicle with the system. Enforces the {@link MAX_VEHICLES}
   * cap: once the cap is reached further additions are rejected.
   *
   * @returns true if the vehicle was added, false if the cap was reached.
   */
  addVehicle(vehicle: Vehicle): boolean {
    if (this.vehicles.length >= MAX_VEHICLES) return false;
    if (this.vehicles.includes(vehicle)) return true;
    this.vehicles.push(vehicle);
    return true;
  }

  /** Remove a vehicle from the system (e.g. after it arrives). */
  removeVehicle(vehicle: Vehicle): void {
    const idx = this.vehicles.indexOf(vehicle);
    if (idx >= 0) this.vehicles.splice(idx, 1);
  }

  /** Current number of managed vehicles. */
  vehicleCount(): number {
    return this.vehicles.length;
  }

  /** Read-only snapshot of managed vehicles. */
  getVehicles(): readonly Vehicle[] {
    return this.vehicles;
  }

  // ---------------------------------------------------------------------
  // Per-step update
  // ---------------------------------------------------------------------

  /**
   * Advance the traffic-light clock and all managed vehicles by one step.
   *
   * @param deltaSimMs Simulation milliseconds elapsed this step.
   */
  update(deltaSimMs: number): void {
    if (deltaSimMs <= 0) return;

    // 1. Advance the global phase clock.
    this.elapsedMs += deltaSimMs;
    this.currentPhase = phaseForElapsed(this.elapsedMs);

    // 2. Move each vehicle.
    for (const vehicle of this.vehicles) {
      this.updateVehicle(vehicle, deltaSimMs);
    }
  }

  /**
   * Advance a single vehicle along its path, honouring traffic lights.
   */
  private updateVehicle(vehicle: Vehicle, deltaSimMs: number): void {
    // Parked / departed vehicles do not move.
    if (vehicle.state === 'parked' || vehicle.state === 'departing') return;
    if (vehicle.hasArrived()) return;

    const target = vehicle.targetNode();
    if (!target) return;

    // Determine whether the vehicle must stop for a red/yellow light on an
    // upcoming intersection node within STOP_DISTANCE tiles.
    const blocking = this.findBlockingLight(vehicle);

    if (blocking) {
      // A red or yellow light is within range: stop the vehicle.
      vehicle.stop();
      return;
    }

    // No blocker: ensure the vehicle is driving.
    if (vehicle.isStopped) vehicle.resume();

    // Tiles travelled this step = speed (tiles/sec) * elapsed (sec).
    const stepDistance = vehicle.speed * (deltaSimMs / MS_PER_SECOND);
    if (stepDistance <= 0) return;

    const pos = vehicle.getPosition();
    const distToTarget = euclidean(pos, target);

    if (distToTarget <= NODE_ARRIVAL_THRESHOLD) {
      // Snap onto the node centre and advance the path index.
      vehicle.setPosition({ x: target.x, y: target.y });
      vehicle.currentNodeIndex += 1;
      return;
    }

    // Move towards the target node, clamped so we never overshoot.
    const moveDist = Math.min(stepDistance, distToTarget);
    const nx = pos.x + ((target.x - pos.x) / distToTarget) * moveDist;
    const ny = pos.y + ((target.y - pos.y) / distToTarget) * moveDist;
    vehicle.setPosition({ x: nx, y: ny });

    // After moving, re-check node arrival.
    const newPos = vehicle.getPosition();
    if (euclidean(newPos, target) <= NODE_ARRIVAL_THRESHOLD) {
      vehicle.setPosition({ x: target.x, y: target.y });
      vehicle.currentNodeIndex += 1;
    }
  }

  /**
   * Find an upcoming intersection node within {@link STOP_DISTANCE} tiles that
   * currently shows red or yellow for the vehicle's approach direction.
   *
   * Returns the blocking node id, or null if the path is clear.
   */
  private findBlockingLight(vehicle: Vehicle): string | null {
    const path = vehicle.path;
    const idx = vehicle.currentNodeIndex;
    if (idx >= path.length) return null;

    const pos = vehicle.getPosition();

    // Inspect upcoming nodes (starting from the current target) until we move
    // beyond STOP_DISTANCE from the vehicle's current position.
    for (let i = idx; i < path.length; i++) {
      const node = path[i];
      const distToNode = manhattan(pos, node);
      if (distToNode > STOP_DISTANCE) break;

      if (node.kind !== 'intersection') continue;

      // Determine the approach direction: from the previous node (or the
      // vehicle position when on the first segment) to this intersection.
      const prev = i > 0 ? path[i - 1] : null;
      const direction = prev
        ? approachDirection(prev, node)
        : this.directionFromPosition(pos, node);

      const state = this.getLightForDirection(node.id, direction);
      if (state === 'red' || state === 'yellow') {
        return node.id;
      }
    }
    return null;
  }

  /**
   * Derive travel direction from the vehicle's current position to a node,
   * used when the vehicle is between its start and the first path node.
   */
  private directionFromPosition(
    pos: { x: number; y: number },
    node: RoadNode,
  ): 'ns' | 'ew' {
    const dx = Math.abs(node.x - pos.x);
    const dy = Math.abs(node.y - pos.y);
    return dx > dy ? 'ew' : 'ns';
  }

  /** Look up a node by id from the configured road graph. */
  private resolveNode(nodeId: string): RoadNode | null {
    if (!this.graph) return null;
    return this.graph.nodes.get(nodeId) ?? null;
  }
}
