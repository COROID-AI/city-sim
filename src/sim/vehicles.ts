/**
 * Vehicle spawning and road-following movement system.
 *
 * Vehicles traverse the connected road network using BFS paths from
 * {@link findRoadPath}.  Each vehicle:
 *
 *   - Follows its `currentRoadPath` tile-by-tile at a fixed speed
 *     determined by its kind.
 *   - Requests a new path (via `findRoadPath`) to a random road tile
 *     when the current path is exhausted.
 *   - May pick up a nearby commuting citizen as a passenger and route
 *     to that citizen's destination, dropping them off on arrival.
 *   - Tracks fuel, which depletes with distance and slowly refuels
 *     while stationary.
 *
 * All dynamic state — driver, passengers, kind, speed, fuel, path, and
 * progress — lives on the {@link Vehicle} entity so it is accessible
 * for inspection by rendering, UI, and detail-panel systems.
 */

import { findRoadPath } from './pathfinding';
import { nearestRoadTile } from './queries';
import { createRng, type Rng } from './rng';
import {
  MIN_VEHICLES,
  VEHICLE_SPEED,
  VEHICLE_PICKUP_RADIUS,
  VEHICLE_PICKUP_CHANCE,
  VEHICLE_DROPOFF_RADIUS,
  VEHICLE_FUEL_FULL,
  VEHICLE_FUEL_PER_TILE,
  VEHICLE_FUEL_REFUEL_RATE,
  SIM_HOUR_MS,
} from './constants';
import type { Citizen, Vehicle, VehicleKind, Vec2, World } from './types';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Default RNG seed for deterministic vehicle spawning and behaviour. */
export const DEFAULT_VEHICLE_SEED = 42_069_113;

/** Weighted distribution of vehicle kinds at spawn time. */
const KIND_WEIGHTS: ReadonlyArray<readonly [VehicleKind, number]> = [
  ['CAR', 55],
  ['TRUCK', 20],
  ['BUS', 15],
  ['MOTORCYCLE', 10],
];

/** Maximum passengers (excluding the driver) per vehicle kind. */
const PASSENGER_CAPACITY: Record<VehicleKind, number> = {
  CAR: 3,
  TRUCK: 1,
  BUS: 20,
  MOTORCYCLE: 1,
};

/** Base travel speed per vehicle kind in grid-cells per sim-hour. */
const KIND_SPEED: Record<VehicleKind, number> = {
  CAR: VEHICLE_SPEED,
  TRUCK: VEHICLE_SPEED - 10,
  BUS: VEHICLE_SPEED - 8,
  MOTORCYCLE: VEHICLE_SPEED + 8,
};

/** Fuel threshold below which a vehicle pauses to refuel. */
const FUEL_REFUEL_THRESHOLD = 5;

// ─── Module-level RNG ────────────────────────────────────────────────────────

/**
 * Persistent RNG used by both {@link spawnVehicles} and
 * {@link tickVehicles} for deterministic path-destination selection
 * and pickup probability rolls.
 *
 * Re-seeded every time {@link spawnVehicles} is called.
 */
let tickRng: Rng = createRng(DEFAULT_VEHICLE_SEED);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Collect every ROAD tile coordinate in the world.
 *
 * @param world The world to scan.
 * @returns Array of `{ x, y }` road-tile coordinates.
 */
function collectRoadTiles(world: World): Vec2[] {
  const roads: Vec2[] = [];
  for (const tile of world.tiles) {
    if (tile.terrain === 'ROAD') {
      roads.push({ x: tile.x, y: tile.y });
    }
  }
  return roads;
}

/** Return a uniformly-random road tile, or `null` if none exist. */
function randomRoadTile(roads: Vec2[], rng: Rng): Vec2 | null {
  if (roads.length === 0) return null;
  return rng.pick(roads);
}

/** Weighted random selection of a vehicle kind. */
function pickKind(rng: Rng): VehicleKind {
  const total = KIND_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let r = rng.next() * total;
  for (const [kind, w] of KIND_WEIGHTS) {
    r -= w;
    if (r <= 0) return kind;
  }
  return KIND_WEIGHTS[KIND_WEIGHTS.length - 1]![0];
}

/** Euclidean distance between two grid positions. */
function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Return the destination building ID of a citizen if they are currently
 * commuting (`COMMUTING` or `RETURNING` state), or `null` otherwise.
 */
function getCommuterDestination(citizen: Citizen): string | null {
  if (
    citizen.state.kind === 'COMMUTING' ||
    citizen.state.kind === 'RETURNING'
  ) {
    return citizen.state.toId;
  }
  return null;
}

/** Collect the set of citizen IDs currently riding in any vehicle. */
function collectRidingCitizens(world: World): Set<string> {
  const riding = new Set<string>();
  for (const vehicle of world.vehicles.values()) {
    for (const passengerId of vehicle.passengers) {
      riding.add(passengerId);
    }
  }
  return riding;
}

/**
 * Assign a new roaming path to a vehicle by selecting a random road
 * tile as the destination and computing the shortest road path to it.
 *
 * If no path can be found after several attempts (e.g. disconnected
 * road network), the vehicle is left idle and will try again next tick.
 *
 * @param world   The world grid.
 * @param vehicle The vehicle to re-path.
 * @param roads   Pre-collected list of road tiles.
 * @param rng     RNG for destination selection.
 */
function assignRoamingPath(
  world: World,
  vehicle: Vehicle,
  roads: Vec2[],
  rng: Rng,
): void {
  for (let attempt = 0; attempt < 5; attempt++) {
    const dest = randomRoadTile(roads, rng);
    if (!dest) break;

    // Don't path to where we already are.
    if (
      dest.x === Math.round(vehicle.position.x) &&
      dest.y === Math.round(vehicle.position.y)
    ) {
      continue;
    }

    const startRoad = nearestRoadTile(
      world,
      Math.round(vehicle.position.x),
      Math.round(vehicle.position.y),
    );
    if (!startRoad) break;

    const path = findRoadPath(world, startRoad, dest);
    if (path && path.length > 1) {
      vehicle.currentRoadPath = path;
      vehicle.pathIndex = 0;
      vehicle.pathProgress = 0;
      vehicle.target = null;
      return;
    }
  }
}

/**
 * Compute a road path from the vehicle's current position toward the
 * building identified by `vehicle.target`.
 */
function routeToTarget(
  world: World,
  vehicle: Vehicle,
  roads: Vec2[],
): void {
  if (!vehicle.target) {
    assignRoamingPath(world, vehicle, roads, tickRng);
    return;
  }

  const building = world.buildings.get(vehicle.target);
  if (!building) {
    vehicle.target = null;
    assignRoamingPath(world, vehicle, roads, tickRng);
    return;
  }

  const destRoad = nearestRoadTile(
    world,
    building.position.x,
    building.position.y,
  );
  if (!destRoad) return;

  const startRoad = nearestRoadTile(
    world,
    Math.round(vehicle.position.x),
    Math.round(vehicle.position.y),
  );
  if (!startRoad) return;

  const path = findRoadPath(world, startRoad, destRoad);
  if (path && path.length > 1) {
    vehicle.currentRoadPath = path;
    vehicle.pathIndex = 0;
    vehicle.pathProgress = 0;
  } else {
    // Destination unreachable — resume roaming.
    vehicle.target = null;
    assignRoamingPath(world, vehicle, roads, tickRng);
  }
}

/**
 * Move a vehicle along its current road path by `dtHours` sim-hours of
 * travel time, updating position, velocity, progress, and fuel.
 */
function moveAlongPath(vehicle: Vehicle, dtHours: number): void {
  const path = vehicle.currentRoadPath;
  if (path.length === 0) {
    vehicle.velocity = { x: 0, y: 0 };
    return;
  }

  let remaining = vehicle.speed * dtHours;

  while (
    remaining > 0 &&
    vehicle.pathIndex < path.length - 1 &&
    vehicle.fuel > 0
  ) {
    const distToNext = 1 - vehicle.pathProgress;

    if (remaining >= distToNext) {
      // Cross into the next tile.
      remaining -= distToNext;
      vehicle.pathIndex++;
      vehicle.pathProgress = 0;
      vehicle.fuel = Math.max(0, vehicle.fuel - VEHICLE_FUEL_PER_TILE);
    } else {
      vehicle.pathProgress += remaining;
      remaining = 0;
    }
  }

  updatePositionAndVelocity(vehicle);
}

/**
 * Recompute the vehicle's position (interpolated between path tiles)
 * and velocity (direction × speed) from its current path state.
 */
function updatePositionAndVelocity(vehicle: Vehicle): void {
  const path = vehicle.currentRoadPath;
  if (path.length === 0) {
    vehicle.velocity = { x: 0, y: 0 };
    return;
  }

  const from = path[vehicle.pathIndex]!;
  if (vehicle.pathIndex < path.length - 1) {
    const to = path[vehicle.pathIndex + 1]!;
    vehicle.position.x = from.x + (to.x - from.x) * vehicle.pathProgress;
    vehicle.position.y = from.y + (to.y - from.y) * vehicle.pathProgress;
    vehicle.velocity.x = Math.sign(to.x - from.x) * vehicle.speed;
    vehicle.velocity.y = Math.sign(to.y - from.y) * vehicle.speed;
  } else {
    // At the end of the path.
    vehicle.position.x = from.x;
    vehicle.position.y = from.y;
    vehicle.velocity = { x: 0, y: 0 };
  }
}

/**
 * Drop off all passengers if the vehicle is within
 * {@link VEHICLE_DROPOFF_RADIUS} of its target building.
 */
function dropOffPassengers(world: World, vehicle: Vehicle): void {
  if (vehicle.passengers.length === 0 || !vehicle.target) return;

  const building = world.buildings.get(vehicle.target);
  if (!building) return;

  const dist = distance(vehicle.position, building.position);
  if (dist <= VEHICLE_DROPOFF_RADIUS) {
    // Update each passenger's position to the destination building.
    for (const citizenId of vehicle.passengers) {
      const citizen = world.citizens.get(citizenId);
      if (citizen) {
        citizen.position.x = building.position.x;
        citizen.position.y = building.position.y;
      }
    }
    vehicle.passengers = [];
    vehicle.target = null;
  }
}

/**
 * With a small probability, pick up a nearby commuting citizen as a
 * passenger and route toward their destination.
 *
 * A citizen is eligible if they are in `COMMUTING` or `RETURNING`
 * state, are within {@link VEHICLE_PICKUP_RADIUS} of the vehicle, and
 * are not already riding in another vehicle.
 *
 * When the vehicle has no current target, the first pickup sets the
 * destination.  Subsequent pickups only occur if the commuter shares
 * the same destination building.
 */
function pickUpPassengers(
  world: World,
  vehicle: Vehicle,
  roads: Vec2[],
  riding: Set<string>,
): void {
  const capacity = PASSENGER_CAPACITY[vehicle.kind];
  if (vehicle.passengers.length >= capacity) return;

  // Probability gate — consumes one RNG step per attempt.
  if (tickRng.next() >= VEHICLE_PICKUP_CHANCE) return;

  for (const citizen of world.citizens.values()) {
    if (vehicle.passengers.length >= capacity) break;
    if (riding.has(citizen.id)) continue;
    if (citizen.id === vehicle.driver) continue;

    const destId = getCommuterDestination(citizen);
    if (!destId) continue;

    // Must be within pickup radius.
    if (distance(vehicle.position, citizen.position) > VEHICLE_PICKUP_RADIUS) {
      continue;
    }

    // If the vehicle already has a target, the commuter must share it.
    if (vehicle.target && vehicle.target !== destId) continue;

    // Pick up!
    vehicle.passengers.push(citizen.id);
    riding.add(citizen.id);

    // Set destination and route to it on first pickup.
    if (!vehicle.target) {
      vehicle.target = destId;
      routeToTarget(world, vehicle, roads);
    }
  }
}

// ─── Public API: spawnVehicles ───────────────────────────────────────────────

/**
 * Spawn `count` vehicles on random road tiles, each with a driver (a
 * citizen), an initial roaming path, and a full fuel tank.
 *
 * Vehicles are distributed across the four {@link VehicleKind}s
 * according to a weighted distribution.  Each vehicle is assigned a
 * citizen as its driver when citizens are available; drivers cycle if
 * there are fewer citizens than vehicles.
 *
 * @param world The world to populate (mutated in place).
 * @param count Number of vehicles to create (defaults to
 *              {@link MIN_VEHICLES}).
 * @param seed  RNG seed for deterministic spawning (optional).
 */
export function spawnVehicles(
  world: World,
  count: number = MIN_VEHICLES,
  seed: number = DEFAULT_VEHICLE_SEED,
): void {
  tickRng = createRng(seed >>> 0);

  const roads = collectRoadTiles(world);
  if (roads.length === 0) return;

  const citizens = Array.from(world.citizens.values());
  const occupiedStartingTiles = new Set<string>();

  for (let i = 0; i < count; i++) {
    // Pick a road tile that isn't already occupied by another new vehicle.
    let spawnTile: Vec2 | null = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = randomRoadTile(roads, tickRng);
      if (!candidate) break;
      const key = `${candidate.x},${candidate.y}`;
      if (!occupiedStartingTiles.has(key)) {
        spawnTile = candidate;
        occupiedStartingTiles.add(key);
        break;
      }
    }
    // Fallback: use any road tile even if occupied.
    if (!spawnTile) {
      spawnTile = randomRoadTile(roads, tickRng);
    }
    if (!spawnTile) break;

    const kind = pickKind(tickRng);
    const speed = KIND_SPEED[kind];

    // Assign a driver (citizen).  Cycle through citizens if fewer than vehicles.
    const driver =
      citizens.length > 0 ? citizens[i % citizens.length]!.id : null;

    const vehicle: Vehicle = {
      id: `v${i}`,
      kind,
      position: { x: spawnTile.x, y: spawnTile.y },
      velocity: { x: 0, y: 0 },
      driver,
      target: null,
      currentRoadPath: [],
      pathIndex: 0,
      pathProgress: 0,
      passengers: [],
      speed,
      fuel: VEHICLE_FUEL_FULL,
    };

    // Give the vehicle an initial roaming path.
    assignRoamingPath(world, vehicle, roads, tickRng);

    world.vehicles.set(vehicle.id, vehicle);
  }
}

// ─── Public API: tickVehicles ────────────────────────────────────────────────

/**
 * Advance every vehicle in the world by `dt` milliseconds.
 *
 * For each vehicle:
 *   1. Refuel if fuel is critically low.
 *   2. Ensure the vehicle has a path; assign one if not.
 *   3. Move along the path at the vehicle's fixed speed, consuming fuel.
 *   4. When the path is exhausted, request a new path via
 *      {@link findRoadPath}.
 *   5. Drop off passengers when arriving at their destination.
 *   6. Attempt to pick up nearby commuting citizens as passengers.
 *
 * @param world The world whose vehicles to advance (mutated in place).
 * @param dt    Delta time in milliseconds since the last tick.
 */
export function tickVehicles(world: World, dt: number): void {
  if (world.vehicles.size === 0) return;

  // Convert milliseconds to sim-hours for speed calculations.
  const dtHours = dt / SIM_HOUR_MS;
  const roads = collectRoadTiles(world);
  const riding = collectRidingCitizens(world);

  for (const vehicle of world.vehicles.values()) {
    tickVehicle(world, vehicle, dtHours, roads, riding);
  }
}

/**
 * Advance a single vehicle by `dtHours` sim-hours.
 */
function tickVehicle(
  world: World,
  vehicle: Vehicle,
  dtHours: number,
  roads: Vec2[],
  riding: Set<string>,
): void {
  // ── 1. Refuel if critically low ─────────────────────────────────────────
  if (vehicle.fuel < FUEL_REFUEL_THRESHOLD) {
    vehicle.fuel = Math.min(
      VEHICLE_FUEL_FULL,
      vehicle.fuel + VEHICLE_FUEL_REFUEL_RATE,
    );
    vehicle.velocity = { x: 0, y: 0 };
    return;
  }

  // ── 2. Pick up nearby commuters (before driving off) ────────────────────
  pickUpPassengers(world, vehicle, roads, riding);

  // ── 3. Ensure the vehicle has a path ────────────────────────────────────
  if (vehicle.currentRoadPath.length === 0) {
    assignRoamingPath(world, vehicle, roads, tickRng);
  }

  // ── 4. Move along the path ──────────────────────────────────────────────
  moveAlongPath(vehicle, dtHours);

  // ── 5. Request a new path when the current one is exhausted ─────────────
  if (vehicle.pathIndex >= vehicle.currentRoadPath.length - 1) {
    if (vehicle.passengers.length > 0 && vehicle.target) {
      // Still carrying passengers — re-route to the target building.
      routeToTarget(world, vehicle, roads);
    } else {
      // No passengers — roam to a new random destination.
      assignRoamingPath(world, vehicle, roads, tickRng);
    }
  }

  // ── 6. Drop off passengers at destination (after arriving) ──────────────
  dropOffPassengers(world, vehicle);
}
