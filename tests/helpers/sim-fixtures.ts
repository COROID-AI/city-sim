/**
 * Deterministic simulation fixtures shared by every sim/render/UI test.
 *
 * Two things live here:
 * 1. entity builders (`createTestCitizen`, `createTestWorldMap`, ...) that
 *    produce fully populated domain contracts with stable values, so later
 *    render/ui tasks never duplicate mock data;
 * 2. a clock + engine fixture with recording systems and an hourly economy
 *    system, so tests can assert tick ordering, hook counts and metrics.
 */

import { MINUTES_PER_DAY, SimClock } from '../../src/sim/clock';
import type { HourBoundary } from '../../src/sim/clock';
import { SimulationEngine } from '../../src/sim/engine';
import type { EngineContext, SimSystem } from '../../src/sim/engine';
import { createRng } from '../../src/sim/rng';
import type { Rng } from '../../src/sim/rng';
import {
  ACTIVITY_KINDS,
  COMPANY_SECTORS,
  NEED_KINDS,
} from '../../src/sim/types';
import type {
  Building,
  Citizen,
  Company,
  CompanySector,
  EconomySnapshot,
  Household,
  HudStats,
  Need,
  Occupation,
  RoadNode,
  RoadSegment,
  ScheduleSlot,
  Tile,
  Vehicle,
  WorldMap,
} from '../../src/sim/types';

/* ------------------------------------------------------------- entities -- */

export function createTestHousehold(overrides: Partial<Household> = {}): Household {
  return {
    id: 'household-1',
    homeBuildingId: 'building-home',
    memberIds: ['citizen-1', 'citizen-2'],
    funds: 4_800,
    ...overrides,
  };
}

export function createTestOccupation(overrides: Partial<Occupation> = {}): Occupation {
  return {
    title: 'Barista',
    sector: 'hospitality',
    companyId: 'company-1',
    workplaceBuildingId: 'building-shop',
    shiftStartHour: 8,
    shiftEndHour: 16,
    wagePerHour: 14,
    ...overrides,
  };
}

export function createTestNeeds(): Need[] {
  return NEED_KINDS.map((kind, index) => ({
    kind,
    level: 10 + index * 5,
    growthPerHour: 1 + index * 0.25,
  }));
}

export function createTestSchedule(): ScheduleSlot[] {
  return [
    { activity: 'home', startHour: 0, endHour: 8, destinationId: 'building-home' },
    { activity: 'work', startHour: 8, endHour: 16, destinationId: 'building-shop' },
    { activity: 'entertainment', startHour: 16, endHour: 19, destinationId: 'building-park' },
    { activity: 'home', startHour: 19, endHour: 24, destinationId: 'building-home' },
  ];
}

export function createTestCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: 'citizen-1',
    name: 'Ada Moss',
    age: 34,
    householdId: 'household-1',
    household: createTestHousehold(),
    homeBuildingId: 'building-home',
    occupation: createTestOccupation(),
    income: 112,
    mood: 0.72,
    needs: createTestNeeds(),
    schedule: createTestSchedule(),
    currentActivity: 'work',
    insideBuildingId: 'building-shop',
    position: { x: 3, y: 4 },
    vehicleId: null,
    ...overrides,
  };
}

export function createTestCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1',
    name: 'Bean & Barrel',
    sector: 'hospitality',
    buildingId: 'building-shop',
    employees: ['citizen-1'],
    employeeCount: 1,
    revenue: 640,
    costs: 410,
    cash: 12_500,
    openHour: 8,
    closeHour: 20,
    color: '#c9884a',
    ...overrides,
  };
}

export function createTestBuilding(overrides: Partial<Building> = {}): Building {
  return {
    id: 'building-home',
    kind: 'house',
    name: 'Home',
    footprint: { x: 2, y: 3, width: 2, height: 2 },
    floors: 2,
    capacity: 4,
    occupantIds: ['citizen-1'],
    residentHouseholdIds: ['household-1'],
    companyId: null,
    entranceNodeId: 'node-1',
    color: '#8fb7d8',
    ...overrides,
  };
}

export function createTestRoadNode(overrides: Partial<RoadNode> = {}): RoadNode {
  return {
    id: 'node-1',
    kind: 'intersection',
    x: 2,
    y: 2,
    neighborIds: ['node-2'],
    speedLimit: 0.5,
    hasTrafficLight: true,
    ...overrides,
  };
}

export function createTestRoadSegment(overrides: Partial<RoadSegment> = {}): RoadSegment {
  return {
    id: 'segment-1',
    fromNodeId: 'node-1',
    toNodeId: 'node-2',
    length: 4,
    lanes: 2,
    speedLimit: 0.5,
    ...overrides,
  };
}

export function createTestVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'vehicle-1',
    kind: 'car',
    plate: 'CITY-001',
    capacity: 4,
    route: { id: 'route-1', kind: 'loop', stopNodeIds: ['node-1', 'node-2'], loop: true },
    occupancy: 1,
    occupantIds: ['citizen-1'],
    fuel: 32,
    fuelCapacity: 45,
    speed: 0.25,
    headingRadians: 0,
    position: { x: 2, y: 2 },
    currentNodeId: 'node-1',
    targetNodeId: 'node-2',
    ownerCompanyId: null,
    color: '#e0e6f2',
    ...overrides,
  };
}

function createTestTiles(width: number, height: number): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      tiles.push({
        x,
        y,
        terrain: x === 2 || y === 2 ? 'road' : 'grass',
        buildingId: x === 2 && y === 3 ? 'building-home' : null,
        segmentId: x === 2 || y === 2 ? 'segment-1' : null,
      });
    }
  }
  return tiles;
}

/**
 * Small, fully populated world: an 8x8 grid, a cross of roads, a home, a shop,
 * one household, one employed citizen, one company and one vehicle.
 */
export function createTestWorldMap(overrides: Partial<WorldMap> = {}): WorldMap {
  const widthInTiles = 8;
  const heightInTiles = 8;
  const household = createTestHousehold();
  const citizen = createTestCitizen();
  const company = createTestCompany();
  return {
    id: 'world-1',
    widthInTiles,
    heightInTiles,
    tileSize: 24,
    tiles: createTestTiles(widthInTiles, heightInTiles),
    nodes: [
      createTestRoadNode({ id: 'node-1', x: 2, y: 2, neighborIds: ['node-2', 'node-3'] }),
      createTestRoadNode({ id: 'node-2', x: 6, y: 2, kind: 'junction', neighborIds: ['node-1'], hasTrafficLight: false }),
      createTestRoadNode({ id: 'node-3', x: 2, y: 6, kind: 'junction', neighborIds: ['node-1'], hasTrafficLight: false }),
    ],
    segments: [
      createTestRoadSegment({ id: 'segment-1', fromNodeId: 'node-1', toNodeId: 'node-2', length: 4 }),
      createTestRoadSegment({ id: 'segment-2', fromNodeId: 'node-1', toNodeId: 'node-3', length: 4 }),
    ],
    buildings: [
      createTestBuilding(),
      createTestBuilding({
        id: 'building-shop',
        kind: 'shop',
        name: 'Bean & Barrel',
        footprint: { x: 5, y: 3, width: 2, height: 2 },
        capacity: 12,
        occupantIds: ['citizen-1'],
        residentHouseholdIds: [],
        companyId: 'company-1',
        entranceNodeId: 'node-2',
        color: '#d8a25f',
      }),
      createTestBuilding({
        id: 'building-park',
        kind: 'park',
        name: 'Riverside Green',
        footprint: { x: 4, y: 6, width: 2, height: 1 },
        floors: 1,
        capacity: 40,
        occupantIds: [],
        residentHouseholdIds: [],
        companyId: null,
        entranceNodeId: 'node-3',
        color: '#7dbb6a',
      }),
    ],
    households: [household],
    citizens: [citizen],
    companies: [company],
    vehicles: [createTestVehicle()],
    spawnNodeId: 'node-1',
    ...overrides,
  };
}

/** Economy reading for a world, using the supplied clock reading. */
export function computeEconomySnapshot(
  world: WorldMap,
  clock: SimClock,
  options: { taxRate?: number; cityBudget?: number } = {},
): EconomySnapshot {
  const taxRate = options.taxRate ?? 0.12;
  const population = world.citizens.length;
  const employed = world.citizens.filter((citizen) => citizen.occupation.companyId !== null);
  const employmentRate = population === 0 ? 0 : employed.length / population;
  const sectorRevenue = createSectorRecord();
  const sectorCosts = createSectorRecord();
  let totalRevenue = 0;
  let totalCosts = 0;
  for (const company of world.companies) {
    totalRevenue += company.revenue;
    totalCosts += company.costs;
    sectorRevenue[company.sector] += company.revenue;
    sectorCosts[company.sector] += company.costs;
  }
  const averageWage =
    employed.length === 0
      ? 0
      : employed.reduce((sum, citizen) => sum + citizen.occupation.wagePerHour, 0) / employed.length;
  const averageMood =
    population === 0 ? 0 : world.citizens.reduce((sum, citizen) => sum + citizen.mood, 0) / population;
  const time = clock.time;
  return {
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    totalMinutes: time.totalMinutes,
    population,
    companyCount: world.companies.length,
    employedCitizens: employed.length,
    employmentRate,
    unemploymentRate: 1 - employmentRate,
    averageWage,
    totalRevenue,
    totalCosts,
    netProfit: totalRevenue - totalCosts,
    cityBudget: (options.cityBudget ?? 25_000) + totalRevenue * taxRate,
    taxRate,
    sectorRevenue,
    sectorCosts,
    averageMood,
  };
}

function createSectorRecord(): Record<CompanySector, number> {
  const record = {} as Record<CompanySector, number>;
  for (const sector of COMPANY_SECTORS) {
    record[sector] = 0;
  }
  return record;
}

export function createTestEconomySnapshot(overrides: Partial<EconomySnapshot> = {}): EconomySnapshot {
  return { ...computeEconomySnapshot(createTestWorldMap(), new SimClock({ startHour: 8 })), ...overrides };
}

export function createTestHudStats(overrides: Partial<HudStats> = {}): HudStats {
  return {
    population: 1,
    employedCitizens: 1,
    employmentRate: 1,
    cityTimeLabel: 'Day 1, 08:00',
    cityBudget: 25_076.8,
    day: 0,
    hour: 8,
    minute: 0,
    phase: 'morning',
    citizenCount: 1,
    vehicleCount: 1,
    companyCount: 1,
    buildingCount: 3,
    averageMood: 0.72,
    ...overrides,
  };
}

/* -------------------------------------------------------------- systems -- */

/** System that records everything the engine sends it. */
export interface RecordingSystem extends SimSystem {
  /** `context.tick` for every update call. */
  readonly updates: number[];
  /** `boundary.startedHour` for every start-of-hour call. */
  readonly hourStarts: number[];
  /** `boundary.endedHour` for every end-of-hour call. */
  readonly hourEnds: number[];
  /** Every boundary payload received by either hour channel. */
  readonly boundaries: HourBoundary[];
  /** `context.clock.totalMinutes` for every update call. */
  readonly minuteLog: number[];
  /** Name of the system for its `onDetach` call, when it got one. */
  detachCount: number;
}

/**
 * Creates a system that records update/hour callbacks.
 * Pass a shared `order` array to assert cross-system ordering.
 */
export function createRecordingSystem(name: string, order: string[] = []): RecordingSystem {
  const updates: number[] = [];
  const hourStarts: number[] = [];
  const hourEnds: number[] = [];
  const boundaries: HourBoundary[] = [];
  const minuteLog: number[] = [];
  const system: RecordingSystem = {
    name,
    updates,
    hourStarts,
    hourEnds,
    boundaries,
    minuteLog,
    detachCount: 0,
    update(context: EngineContext) {
      updates.push(context.tick);
      minuteLog.push(context.clock.totalMinutes);
      order.push(name);
    },
    onHourStart(_context: EngineContext, boundary: HourBoundary) {
      hourStarts.push(boundary.startedHour);
      boundaries.push(boundary);
      order.push(`${name}:hour-start`);
    },
    onHourEnd(_context: EngineContext, boundary: HourBoundary) {
      hourEnds.push(boundary.endedHour);
      order.push(`${name}:hour-end`);
    },
    onDetach() {
      system.detachCount += 1;
      order.push(`${name}:detach`);
    },
  };
  return system;
}

/** System that stores one {@link EconomySnapshot} per sim-hour. */
export interface EconomySystem extends SimSystem {
  readonly snapshots: EconomySnapshot[];
}

export function createEconomySystem(
  name: string,
  world: WorldMap,
  options: { taxRate?: number; cityBudget?: number } = {},
): EconomySystem {
  const snapshots: EconomySnapshot[] = [];
  const system: EconomySystem = {
    name,
    snapshots,
    onHourStart(_context: EngineContext) {
      snapshots.push(computeEconomySnapshot(world, _context.clock, options));
    },
    update() {
      /* the economy only ticks hourly */
    },
  };
  return system;
}

/* -------------------------------------------------------------- fixture -- */

export interface FixtureOptions {
  /** Numeric or string seed for the fixture RNG. */
  seed?: number | string;
  startDay?: number;
  startHour?: number;
  minutesPerTick?: number;
  speed?: number;
  /** Systems to attach before returning; defaults to none. */
  systems?: SimSystem[];
}

export interface SimFixture {
  readonly clock: SimClock;
  readonly engine: SimulationEngine;
  readonly rng: Rng;
  readonly world: WorldMap;
  /** Shared call order across the two default recording systems. */
  readonly order: string[];
  readonly systems: RecordingSystem[];
  /** `context.clock.totalMinutes` log of the first default system. */
  readonly minuteLog: number[];
  /** Steps the engine enough fixed ticks to cover `minutes`. */
  advanceMinutes(minutes: number): number;
  dispose(): void;
}

/**
 * Builds a clock + engine pair with two recording systems attached
 * (`alpha`, then `beta`) plus a deterministic RNG and test world.
 */
export function createSimFixture(options: FixtureOptions = {}): SimFixture {
  const minutesPerTick = options.minutesPerTick ?? 1;
  const clock = new SimClock({
    startDay: options.startDay ?? 0,
    startHour: options.startHour ?? 0,
    minutesPerTick,
  });
  const engine = new SimulationEngine({
    clock,
    minutesPerTick,
    ticksPerSecond: 60,
    speed: options.speed ?? 1,
  });
  const order: string[] = [];
  const alpha = createRecordingSystem('alpha', order);
  const beta = createRecordingSystem('beta', order);
  engine.attach(alpha);
  engine.attach(beta);
  for (const system of options.systems ?? []) {
    engine.attach(system);
  }

  return {
    clock,
    engine,
    rng: createRng(options.seed ?? 1),
    world: createTestWorldMap(),
    order,
    systems: [alpha, beta],
    minuteLog: alpha.minuteLog,
    advanceMinutes: (minutes: number) => {
      if (minutes % minutesPerTick !== 0) {
        throw new RangeError(`advanceMinutes(${minutes}) is not a multiple of minutesPerTick ${minutesPerTick}`);
      }
      return engine.step(minutes / minutesPerTick);
    },
    dispose: () => {
      engine.dispose();
    },
  };
}

/** A full 24h day in sim-minutes; handy for "one simulated day" assertions. */
export const SIM_DAY_MINUTES = MINUTES_PER_DAY;

/** Every activity kind, re-exported so render tests can assert schedule order. */
export const TEST_ACTIVITY_KINDS = ACTIVITY_KINDS;
