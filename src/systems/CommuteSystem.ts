/**
 * CommuteSystem — orchestrates the citizen↔vehicle commute handoff (spec §7.2).
 *
 * State machine per employed citizen during commute hours (8 and 17):
 *  1. `none` → `toRoad`: when commute distance > VEHICLE_DISTANCE_THRESHOLD,
 *     set the citizen's target to the nearest road node and mark `toRoad`.
 *  2. `toRoad` → `inVehicle`: when the citizen reaches the road node, spawn a
 *     Vehicle with an A* path to the destination road node, hide the citizen,
 *     and register the vehicle with TrafficSystem + World.
 *  3. `inVehicle` → `arrived`: when the vehicle reaches its destination,
 *     despawn it, move the citizen to the destination building center, and
 *     make the citizen visible again.
 *  4. `arrived` → `none`: reset commute state.
 *
 * Short-distance commuters (< threshold) stay on foot and never spawn a
 * vehicle. The number of active vehicles is capped at floor(employed/5) with
 * a hard maximum of MAX_VEHICLES (20).
 */
import type { Building, RoadGraph, RoadNode } from '@/engine/types';
import type { Citizen } from '@/entities/Citizen';
import { Vehicle } from '@/entities/Vehicle';
import type { World } from '@/engine/World';
import { Pathfinder } from '@/engine/Pathfinder';
import { getNearestNode } from '@/entities/Road';
import { TrafficSystem, MAX_VEHICLES } from '@/systems/TrafficSystem';
import {
  COMMUTE_START_HOUR,
  WORK_END_HOUR,
} from '@/entities/Citizen';
import {
  VEHICLE_DISTANCE_THRESHOLD,
  buildingCenter,
  distance,
} from '@/systems/MovementSystem';

/** Maximum vehicles = 1 per 5 employed citizens (spec §7.1). */
const EMPLOYED_PER_VEHICLE = 5;

export interface CommuteSystemOptions {
  /** Road graph for pathfinding. */
  graph: RoadGraph;
  /** TrafficSystem to register/deregister vehicles. */
  traffic: TrafficSystem;
  /** Optional RNG for deterministic vehicle colors in tests. */
  rng?: () => number;
}

export class CommuteSystem {
  private readonly graph: RoadGraph;
  private readonly traffic: TrafficSystem;
  private readonly world: World;
  private readonly pathfinder: Pathfinder;
  private readonly rng: () => number;

  constructor(world: World, options: CommuteSystemOptions) {
    this.world = world;
    this.graph = options.graph;
    this.traffic = options.traffic;
    this.pathfinder = new Pathfinder(this.graph);
    this.rng = options.rng ?? Math.random;
  }

  /** Current maximum allowed vehicles based on employed population. */
  maxVehicles(): number {
    const employed = this.world.citizens.filter((c) => c.employed).length;
    return Math.min(MAX_VEHICLES, Math.floor(employed / EMPLOYED_PER_VEHICLE));
  }

  /**
   * Per-step update. Drives the commute state machine for all citizens.
   * @param hour Current simulation hour [0..23].
   */
  update(hour: number): void {
    const isCommuteHour = hour === COMMUTE_START_HOUR || hour === WORK_END_HOUR;

    for (const citizen of this.world.citizens) {
      // Only employed citizens with both home and workplace can commute.
      if (!citizen.employed || !citizen.homeId || !citizen.workplaceId) {
        continue;
      }

      // Reset non-commuting citizens that were in a transient state.
      if (!isCommuteHour && citizen.commuteState !== 'inVehicle') {
        if (citizen.commuteState !== 'none') {
          citizen.commuteState = 'none';
          citizen.setVisible(true);
          citizen.vehicleId = null;
        }
        continue;
      }
      if (!isCommuteHour) continue;

      switch (citizen.commuteState) {
        case 'none':
          this.handleNone(citizen, hour);
          break;
        case 'toRoad':
          this.handleToRoad(citizen);
          break;
        case 'inVehicle':
          this.handleInVehicle(citizen);
          break;
        case 'arrived':
          citizen.commuteState = 'none';
          citizen.setVisible(true);
          citizen.vehicleId = null;
          break;
      }
    }
  }

  /** Resolve the commute destination building for the current direction. */
  private resolveDestination(citizen: Citizen, hour: number): Building | undefined {
    const buildings = this.world.buildings;
    // Morning (hour 8): home → workplace. Evening (hour 17): workplace → home.
    const targetId = hour === COMMUTE_START_HOUR ? citizen.workplaceId : citizen.homeId;
    return targetId ? buildings.get(targetId) : undefined;
  }

  /** Resolve the origin building for the current direction. */
  private resolveOrigin(citizen: Citizen, hour: number): Building | undefined {
    const buildings = this.world.buildings;
    const originId = hour === COMMUTE_START_HOUR ? citizen.homeId : citizen.workplaceId;
    return originId ? buildings.get(originId) : undefined;
  }

  /** State `none`: decide whether to start a vehicle commute. */
  private handleNone(citizen: Citizen, hour: number): void {
    const origin = this.resolveOrigin(citizen, hour);
    const dest = this.resolveDestination(citizen, hour);
    if (!origin || !dest) return;

    const originCenter = buildingCenter(origin);
    const destCenter = buildingCenter(dest);
    if (!originCenter || !destCenter) return;

    const dist = distance(originCenter, destCenter);
    // Short-distance commuters walk on foot.
    if (dist <= VEHICLE_DISTANCE_THRESHOLD) return;

    // Find the nearest road node to the citizen's current position.
    const pos = citizen.getPosition();
    const roadNode = getNearestNode(this.graph, pos.x, pos.y);
    if (!roadNode) return;

    // Set the citizen walking toward the road node.
    citizen.setTarget({ x: roadNode.x, y: roadNode.y });
    citizen.commuteState = 'toRoad';
    citizen.commuteMode = 'vehicle';
  }

  /** State `toRoad`: when the citizen reaches the road, spawn a vehicle. */
  private handleToRoad(citizen: Citizen): void {
    // Wait until the citizen has arrived at the road (target cleared by MovementSystem).
    if (citizen.targetPosition !== null) return;

    // Respect the vehicle cap.
    if (this.traffic.vehicleCount() >= this.maxVehicles()) return;

    const pos = citizen.getPosition();
    const startNode = getNearestNode(this.graph, pos.x, pos.y);
    if (!startNode) {
      citizen.commuteState = 'none';
      return;
    }

    // Determine destination building and its nearest road node.
    // Infer direction from current activity context: if near workplace, go home.
    const hour = this.inferHour(citizen);
    const dest = this.resolveDestination(citizen, hour);
    if (!dest) {
      citizen.commuteState = 'none';
      return;
    }
    const destCenter = buildingCenter(dest);
    if (!destCenter) {
      citizen.commuteState = 'none';
      return;
    }
    const goalNode = getNearestNode(this.graph, destCenter.x, destCenter.y);
    if (!goalNode) {
      citizen.commuteState = 'none';
      return;
    }

    // Compute A* path through the road network.
    const path = this.pathfinder.findPath(startNode.id, goalNode.id);
    if (path.length === 0) {
      // No path: fall back to foot mode.
      citizen.commuteState = 'none';
      citizen.commuteMode = 'foot';
      return;
    }

    // Spawn the vehicle at the road node.
    const vehicle = new Vehicle(
      { x: startNode.x, y: startNode.y },
      {
        path,
        citizenId: citizen.id,
        color: this.pickColor(),
      },
    );
    // Initialize velocity toward the first path segment.
    if (path.length > 1) {
      const next = path[1]!;
      const dx = next.x - startNode.x;
      const dy = next.y - startNode.y;
      const len = Math.hypot(dx, dy) || 1;
      vehicle.velocity = { x: dx / len, y: dy / len };
    }

    this.traffic.addVehicle(vehicle);
    this.world.addVehicle(vehicle);

    // Hide the citizen and track the vehicle.
    citizen.setVisible(false);
    citizen.vehicleId = vehicle.id;
    citizen.commuteState = 'inVehicle';
  }

  /** State `inVehicle`: when the vehicle arrives, restore the citizen. */
  private handleInVehicle(citizen: Citizen): void {
    if (!citizen.vehicleId) {
      citizen.commuteState = 'none';
      citizen.setVisible(true);
      return;
    }

    const vehicle = this.world.vehicles.find((v) => v.id === citizen.vehicleId);
    if (!vehicle) {
      // Vehicle was removed externally; restore citizen at current spot.
      citizen.commuteState = 'none';
      citizen.setVisible(true);
      citizen.vehicleId = null;
      return;
    }

    if (!vehicle.hasArrived()) return;

    // Vehicle reached destination: despawn it.
    this.traffic.removeVehicle(vehicle);
    this.world.removeVehicle(vehicle);

    // Move the citizen to the destination building center.
    const hour = this.inferHour(citizen);
    const dest = this.resolveDestination(citizen, hour);
    const destCenter = dest ? buildingCenter(dest) : null;
    if (destCenter) {
      citizen.setPosition({ x: destCenter.x, y: destCenter.y });
    }

    citizen.setVisible(true);
    citizen.vehicleId = null;
    citizen.commuteState = 'arrived';
    citizen.commuteMode = 'foot';
    citizen.targetPosition = null;
  }

  /**
   * Infer the commute direction from the citizen's current position relative
   * to home/workplace. If near home → morning (to work); if near workplace →
   * evening (to home).
   */
  private inferHour(citizen: Citizen): number {
    const home = citizen.homeId ? this.world.buildings.get(citizen.homeId) : undefined;
    const work = citizen.workplaceId ? this.world.buildings.get(citizen.workplaceId) : undefined;
    const pos = citizen.getPosition();
    const homeCenter = home ? buildingCenter(home) : null;
    const workCenter = work ? buildingCenter(work) : null;
    if (homeCenter && workCenter) {
      const dHome = distance(pos, homeCenter);
      const dWork = distance(pos, workCenter);
      return dHome < dWork ? COMMUTE_START_HOUR : WORK_END_HOUR;
    }
    return COMMUTE_START_HOUR;
  }

  /** Pick a vehicle color from the bright palette. */
  private pickColor(): string {
    const colors = ['#f44336', '#ffeb3b', '#2196f3', '#4caf50', '#e91e63', '#ff9800'];
    return colors[Math.floor(this.rng() * colors.length)]!;
  }
}
