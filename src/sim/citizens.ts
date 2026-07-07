/**
 * Citizen spawning, daily schedule FSM, and movement.
 *
 * Citizens are the inhabitants of the city.  Each one has a home, and
 * most have a workplace and a preferred entertainment venue.  They cycle
 * through a daily schedule driven by the simulation clock:
 *
 *   HOME → COMMUTING → WORKING → COMMUTING → ENTERTAINMENT → RETURNING → HOME
 *
 * Movement uses the road-pathfinding from Phase 2 (`findRoadPath`).  When
 * a schedule transition fires, the citizen computes a road path to the
 * destination building and walks along it each tick at {@link CITIZEN_SPEED}
 * grid-cells per sim-hour.
 */

import {
  CITIZEN_SPEED,
  HOURS_PER_DAY,
  MIN_CITIZENS,
  SIM_HOUR_MS,
  WORK_START_HOUR,
  WORK_END_HOUR,
} from './constants';
import { createRng, type Rng } from './rng';
import { findRoadPath } from './pathfinding';
import { nearestRoadTile } from './queries';
import type { Building, Citizen, CitizenState, SimTime, Vec2, World } from './types';

// ─── Schedule State ──────────────────────────────────────────────────────────

/**
 * The time-of-day phase a citizen *should* be in, derived purely from the
 * simulation clock's hour-of-day.
 *
 * This is the "desired" state.  The actual FSM (`CitizenState`) may lag
 * behind while the citizen is physically travelling.
 */
export type ScheduleState =
  | 'home'
  | 'commutingToWork'
  | 'atWork'
  | 'commutingToEntertainment'
  | 'atEntertainment';

// ─── Schedule Hour Boundaries ────────────────────────────────────────────────

/** Hour when nighttime home begins (22:00). */
const SCHEDULE_NIGHT_START = 22;

/** Hour when the morning commute begins (06:00). */
const SCHEDULE_MORNING_COMMUTE = 6;

/** Hour when evening entertainment begins (19:00). */
const SCHEDULE_EVENING_ENTERTAINMENT = 19;

/** Fraction of citizens that receive a workplace assignment (~80 %). */
const EMPLOYMENT_RATE = 0.8;

/** Seed for citizen-generation RNG. */
const CITIZEN_SEED = 42;

/** Minimum starting funds for a new citizen. */
const MIN_STARTING_MONEY = 100;

/** Maximum starting funds for a new citizen. */
const MAX_STARTING_MONEY = 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the integer hour-of-day (0–23) from the simulation clock.
 *
 * Handles fractional and negative elapsed-hours gracefully.
 */
function hourOfDay(simTime: SimTime): number {
  return (
    ((simTime.elapsedHours % HOURS_PER_DAY) + HOURS_PER_DAY) %
    HOURS_PER_DAY
  );
}

/**
 * Return the centre coordinate of a building's footprint.
 */
function buildingCenter(building: Building): Vec2 {
  return {
    x: building.position.x + Math.floor(building.size.width / 2),
    y: building.position.y + Math.floor(building.size.height / 2),
  };
}

/**
 * Return all buildings of the given kind from the world.
 */
function buildingsOfKind(world: World, kind: Building['kind']): Building[] {
  return Array.from(world.buildings.values()).filter((b) => b.kind === kind);
}

/**
 * Check whether a citizen is positioned at (or very near) a building.
 */
function isAtBuilding(citizen: Citizen, building: Building): boolean {
  const center = buildingCenter(building);
  const dx = center.x - citizen.position.x;
  const dy = center.y - citizen.position.y;
  return Math.hypot(dx, dy) < 0.5;
}

/**
 * Determine the building ID a citizen should head toward for a given
 * schedule phase.
 */
function scheduleTargetId(
  citizen: Citizen,
  schedule: ScheduleState,
): string | null {
  switch (schedule) {
    case 'home':
      return citizen.home;
    case 'commutingToWork':
    case 'atWork':
      return citizen.work;
    case 'commutingToEntertainment':
    case 'atEntertainment':
      return citizen.entertainment;
  }
}

/**
 * Map a schedule phase to the "settled" FSM state used once the citizen
 * arrives at the destination.
 */
function settledState(
  citizen: Citizen,
  schedule: ScheduleState,
): CitizenState | null {
  const buildingId = scheduleTargetId(citizen, schedule);
  if (!buildingId) return null;

  switch (schedule) {
    case 'home':
      return { kind: 'HOME', buildingId };
    case 'commutingToWork':
    case 'atWork':
      return { kind: 'WORKING', buildingId };
    case 'commutingToEntertainment':
    case 'atEntertainment':
      return { kind: 'ENTERTAINMENT', buildingId };
  }
}

/**
 * Determine the building a citizen is currently associated with (for the
 * `fromId` field of a commuting state).
 */
function currentBuildingId(citizen: Citizen): string {
  switch (citizen.state.kind) {
    case 'HOME':
    case 'WORKING':
    case 'ENTERTAINMENT':
      return citizen.state.buildingId;
    case 'COMMUTING':
    case 'RETURNING':
      return citizen.state.fromId;
  }
}

/**
 * Check whether the citizen is actively travelling along a path.
 */
function hasActivePath(citizen: Citizen): boolean {
  return citizen.path.length > 0 && citizen.pathIndex < citizen.path.length;
}

/**
 * Update the `progress` field of a commuting/returning FSM state to
 * reflect how far along the path the citizen has walked.
 */
function updateTravelProgress(citizen: Citizen): void {
  if (citizen.state.kind === 'COMMUTING' || citizen.state.kind === 'RETURNING') {
    const total = citizen.path.length;
    const progress = total > 0 ? Math.min(1, citizen.pathIndex / total) : 1;
    citizen.state = { ...citizen.state, progress };
  }
}

// ─── Public API: spawnCitizens ───────────────────────────────────────────────

/**
 * Populate the world with `count` citizens, each assigned a residential
 * home building.  Approximately 80 % of citizens also receive a workplace
 * assignment, and all citizens receive an entertainment venue preference
 * (when available).
 *
 * Each citizen starts at their home building with a small random money
 * balance and an initial FSM state of `HOME`.
 *
 * @param world The world to populate (mutated in place).
 * @param count Number of citizens to create (defaults to {@link MIN_CITIZENS}).
 */
export function spawnCitizens(world: World, count: number = MIN_CITIZENS): void {
  const rng = createRng(CITIZEN_SEED);

  const homes = buildingsOfKind(world, 'HOME');
  const workplaces = buildingsOfKind(world, 'WORK');
  const entertainments = buildingsOfKind(world, 'ENTERTAINMENT');

  // Cannot spawn citizens without at least one home building.
  if (homes.length === 0) return;

  // IDs start from the current citizen count to avoid collisions.
  const startId = world.citizens.size;

  for (let i = 0; i < count; i++) {
    const home = rng.pick(homes);

    // ~80 % of citizens are employed (requires at least one workplace).
    const hasWork = rng.next() < EMPLOYMENT_RATE && workplaces.length > 0;
    const work = hasWork ? rng.pick(workplaces) : null;

    // Every citizen gets an entertainment venue if one exists.
    const entertainment =
      entertainments.length > 0 ? rng.pick(entertainments) : null;

    const citizen: Citizen = {
      id: `c${startId + i}`,
      home: home.id,
      work: work?.id ?? null,
      entertainment: entertainment?.id ?? null,
      state: { kind: 'HOME', buildingId: home.id },
      position: buildingCenter(home),
      money: rng.int(MIN_STARTING_MONEY, MAX_STARTING_MONEY),
      path: [],
      pathIndex: 0,
    };

    world.citizens.set(citizen.id, citizen);
  }
}

// ─── Public API: determineScheduleState ──────────────────────────────────────

/**
 * Determine the schedule phase a citizen should be in based on the
 * simulation clock's hour-of-day.
 *
 * Schedule rules (hour-of-day):
 *
 * | Hours  | State                      |
 * |--------|----------------------------|
 * | 22 – 6 | `home`                     |
 * | 6 – 8  | `commutingToWork`          |
 * | 8 – 17 | `atWork`                   |
 * | 17 – 19| `commutingToEntertainment` |
 * | 19 – 22| `atEntertainment`          |
 *
 * The `citizen` parameter is accepted for future per-citizen schedule
 * customisation but the current implementation is purely time-based.
 *
 * @param citizen  The citizen (unused in the time-based default schedule).
 * @param simTime  The simulation clock.
 * @returns The desired schedule phase.
 */
export function determineScheduleState(
  citizen: Citizen,
  simTime: SimTime,
): ScheduleState {
  void citizen; // Reserved for per-citizen schedule variation.

  const hour = hourOfDay(simTime);

  // 22:00 – 06:00 → home (night).
  if (hour >= SCHEDULE_NIGHT_START || hour < SCHEDULE_MORNING_COMMUTE) {
    return 'home';
  }

  // 06:00 – 08:00 → commuting to work.
  if (hour < WORK_START_HOUR) {
    return 'commutingToWork';
  }

  // 08:00 – 17:00 → at work.
  if (hour < WORK_END_HOUR) {
    return 'atWork';
  }

  // 17:00 – 19:00 → commuting to entertainment.
  if (hour < SCHEDULE_EVENING_ENTERTAINMENT) {
    return 'commutingToEntertainment';
  }

  // 19:00 – 22:00 → at entertainment.
  return 'atEntertainment';
}

// ─── Public API: tickCitizens ────────────────────────────────────────────────

/**
 * Advance every citizen by one simulation tick.
 *
 * For each citizen the function:
 *   1. Determines the desired schedule phase from the clock.
 *   2. If the citizen is mid-journey, walks them further along their path.
 *   3. On arrival, transitions the FSM to the appropriate settled state.
 *   4. If a new trip is needed (schedule transition), computes a road path
 *      and begins the commute.
 *
 * Citizens without a valid destination (e.g. unemployed during work hours)
 * fall back to staying at or returning home.
 *
 * @param world The world whose citizens to advance (mutated in place).
 * @param dtMs  Elapsed real-time milliseconds since the last tick.
 */
export function tickCitizens(world: World, dtMs: number): void {
  const dtHours = dtMs / SIM_HOUR_MS;

  for (const citizen of world.citizens.values()) {
    const desired = determineScheduleState(citizen, world.simTime);
    tickCitizen(world, citizen, desired, dtHours);
  }
}

// ─── Per-citizen tick ────────────────────────────────────────────────────────

/**
 * Advance a single citizen by `dtHours` sim-hours.
 */
function tickCitizen(
  world: World,
  citizen: Citizen,
  desired: ScheduleState,
  dtHours: number,
): void {
  // ── 1. Continue walking if mid-journey ──────────────────────────────────
  if (hasActivePath(citizen)) {
    walkAlongPath(citizen, dtHours);
    if (!hasActivePath(citizen)) {
      // Arrived at destination.
      onArrival(citizen, desired);
    }
    return;
  }

  // ── 2. Determine the effective destination ──────────────────────────────
  let effective = desired;
  let targetId = scheduleTargetId(citizen, desired);
  let target = targetId ? (world.buildings.get(targetId) ?? null) : null;

  // If no target for this schedule (e.g. unemployed), fall back to home.
  if (!target && citizen.home) {
    effective = 'home';
    targetId = citizen.home;
    target = world.buildings.get(citizen.home) ?? null;
  }

  // Still no destination — citizen stays put.
  if (!target) return;

  // ── 3. Already at the destination ───────────────────────────────────────
  if (isAtBuilding(citizen, target)) {
    const settled = settledState(citizen, effective);
    if (settled) citizen.state = settled;
    return;
  }

  // ── 4. Start a new trip ─────────────────────────────────────────────────
  startTrip(world, citizen, target, effective);

  // Walk along the newly assigned path this same tick so movement is
  // continuous from the moment a trip begins.
  if (hasActivePath(citizen)) {
    walkAlongPath(citizen, dtHours);
    if (!hasActivePath(citizen)) {
      onArrival(citizen, desired);
    }
  }
}

/**
 * Begin a commute from the citizen's current position to the target
 * building, computing a road path via {@link findRoadPath}.
 */
function startTrip(
  world: World,
  citizen: Citizen,
  target: Building,
  schedule: ScheduleState,
): void {
  const startRoad = nearestRoadTile(
    world,
    citizen.position.x,
    citizen.position.y,
  );
  const endRoad = nearestRoadTile(
    world,
    target.position.x,
    target.position.y,
  );

  // Cannot path without road access at either end.
  if (!startRoad || !endRoad) return;

  const roadPath = findRoadPath(world, startRoad, endRoad);
  if (!roadPath) return; // No connected road route.

  // Assemble the full walking path: current pos → road → building centre.
  const fullPath: Vec2[] = [
    citizen.position,
    ...roadPath,
    buildingCenter(target),
  ];

  citizen.path = fullPath;
  citizen.pathIndex = 1; // Skip index 0 (the citizen's current position).

  // Set the travelling FSM state.
  const fromId = currentBuildingId(citizen);
  if (schedule === 'home') {
    citizen.state = {
      kind: 'RETURNING',
      fromId,
      toId: target.id,
      progress: 0,
    };
  } else {
    citizen.state = {
      kind: 'COMMUTING',
      fromId,
      toId: target.id,
      progress: 0,
    };
  }
}

/**
 * Walk a citizen along their assigned path by `dtHours` sim-hours.
 *
 * Movement speed is {@link CITIZEN_SPEED} grid-cells per sim-hour.  The
 * function consumes waypoints one at a time, moving the citizen's position
 * in straight-line segments between consecutive waypoints.
 */
function walkAlongPath(citizen: Citizen, dtHours: number): void {
  let remaining = CITIZEN_SPEED * dtHours; // total cells to travel this tick

  while (remaining > 0 && citizen.pathIndex < citizen.path.length) {
    const waypoint = citizen.path[citizen.pathIndex]!;

    const dx = waypoint.x - citizen.position.x;
    const dy = waypoint.y - citizen.position.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= remaining) {
      // Fully reach this waypoint.
      citizen.position = { x: waypoint.x, y: waypoint.y };
      citizen.pathIndex++;
      remaining -= dist;
    } else {
      // Move partially toward the waypoint.
      const ratio = remaining / dist;
      citizen.position = {
        x: citizen.position.x + dx * ratio,
        y: citizen.position.y + dy * ratio,
      };
      remaining = 0;
    }
  }

  updateTravelProgress(citizen);
}

/**
 * Handle a citizen's arrival at their destination: clear the path and
 * transition to the settled FSM state.
 */
function onArrival(citizen: Citizen, desired: ScheduleState): void {
  citizen.path = [];
  citizen.pathIndex = 0;

  const settled = settledState(citizen, desired);
  if (settled) citizen.state = settled;
}
