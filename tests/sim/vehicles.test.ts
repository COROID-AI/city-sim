/**
 * Behavioural tests for the city's road traffic (`src/sim/vehicles.ts`).
 *
 * The suite asserts the promises the rest of the simulation depends on: the
 * kind table is data-driven and complete, a dispatched vehicle satisfies the
 * shared `Vehicle` contract, the fleet drives the real road graph at
 * kind-specific speeds (braking for the vehicle ahead, yielding at occupied
 * intersections) without ever leaving the network, commuter demand from the
 * citizen system produces real board/alight events at home, work and
 * entertainment buildings, the demand fleet parks outside the peaks, and a
 * three day soak keeps a bounded fleet that recycles its vehicle objects
 * instead of leaking them.
 */

import { describe, expect, it } from 'vitest';

import { CitizensSystem } from '../../src/sim/citizens';
import type { CommuteIntent } from '../../src/sim/citizens';
import { MINUTES_PER_HOUR } from '../../src/sim/clock';
import { VEHICLE_KINDS } from '../../src/sim/types';
import type { Building, Vehicle, VehicleKind } from '../../src/sim/types';
import {
  COMMUTE_PEAKS,
  DEFAULT_MAX_ACTIVE_VEHICLES,
  MIN_ACTIVE_VEHICLES,
  ROAD_PACE_MULTIPLIER,
  SERVICE_END_HOUR,
  SERVICE_START_HOUR,
  VEHICLES_SYSTEM_NAME,
  VEHICLE_KIND_SPECS,
  VehiclesSystem,
  createVehiclesSystem,
  isCommutePeak,
  pacedSpeedLimit,
  peakForMinute,
  vehicleKindForCommuteMode,
} from '../../src/sim/vehicles';
import type { VehicleWorld } from '../../src/sim/vehicles';
import { createCityWorld, distanceBetweenPoints } from '../../src/sim/world';
import type { CityWorld } from '../../src/sim/world';
import { createSimFixture } from '../helpers/sim-fixtures';
import type { SimFixture } from '../helpers/sim-fixtures';

/* ------------------------------------------------------------ sim sources -- */

const SIM_SOURCES = import.meta.glob('../../src/sim/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const BROWSER_GLOBAL =
  /\b(document|window|canvas|navigator|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|HTMLCanvasElement|HTMLDivElement|ImageData|OffscreenCanvas|CanvasRenderingContext2D|devicePixelRatio)\b/;
const IMPORT_SPECIFIER = /from\s+'([^']+)'/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/* ------------------------------------------------------------------- rigs -- */

interface FleetRig {
  readonly fixture: SimFixture;
  readonly world: CityWorld;
  readonly citizens: CitizensSystem;
  readonly vehicles: VehiclesSystem;
}

/** Builds the production wiring: seeded world, citizen roster, engine, fleet. */
function createFleetRig(options: {
  seed: string;
  startHour?: number;
  count?: number;
  serviceFleetSize?: number;
}): FleetRig {
  const fixture = createSimFixture({
    seed: options.seed,
    startHour: options.startHour ?? 0,
    minutesPerTick: 1,
  });
  const world = createCityWorld({ seed: fixture.rng.seed });
  const citizens = new CitizensSystem({ world, count: options.count ?? 72, seed: fixture.rng.seed });
  const vehicles = new VehiclesSystem({
    world,
    citizens,
    serviceFleetSize: options.serviceFleetSize ?? MIN_ACTIVE_VEHICLES,
  });
  fixture.engine.attach(citizens);
  fixture.engine.attach(vehicles);
  return { fixture, world, citizens, vehicles };
}

/** Distance from the straight line between the nodes a vehicle is driving between. */
function roadOffset(vehicle: Vehicle, world: CityWorld): number {
  const from = vehicle.currentNodeId ? world.roadNodeById(vehicle.currentNodeId) : null;
  const to = vehicle.targetNodeId ? world.roadNodeById(vehicle.targetNodeId) : null;
  if (!from || !to) {
    return 0;
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return Math.abs((vehicle.position.x - from.x) * dy - (vehicle.position.y - from.y) * dx) / length;
}

/** Nearest road node to a vehicle's position, for on-network assertions. */
function insideWorld(vehicle: Vehicle, world: CityWorld): boolean {
  return (
    vehicle.position.x >= 0 &&
    vehicle.position.y >= 0 &&
    vehicle.position.x <= world.widthInTiles &&
    vehicle.position.y <= world.heightInTiles
  );
}

/** Node the vehicle is standing on; `null` while it is between two nodes. */
function nodeAt(vehicle: Vehicle, world: CityWorld, tolerance = 0.05): string | null {
  for (const node of world.nodes) {
    if (distanceBetweenPoints(node, vehicle.position) <= tolerance) {
      return node.id;
    }
  }
  return null;
}

/** A home/workplace pair a commute can actually be driven between. */
function distinctEntrancePair(world: CityWorld): { home: Building; work: Building } {
  const homes = world.buildings.filter(
    (building) => building.kind === 'house' || building.kind === 'apartment',
  );
  const workplaces = world.buildings.filter(
    (building) => building.kind === 'shop' || building.kind === 'office',
  );
  for (const home of homes) {
    for (const work of workplaces) {
      if (home.entranceNodeId && work.entranceNodeId && home.entranceNodeId !== work.entranceNodeId) {
        return { home, work };
      }
    }
  }
  throw new Error('generated world has no home/workplace pair with distinct entrances');
}

/* ------------------------------------------------------------ kind tables -- */

describe('fleet kind data', () => {
  it('describes every vehicle kind with a data-driven spec', () => {
    for (const kind of VEHICLE_KINDS) {
      const spec = VEHICLE_KIND_SPECS[kind];
      expect(spec.kind, kind).toBe(kind);
      expect(spec.label.length, kind).toBeGreaterThan(0);
      expect(spec.capacity, kind).toBeGreaterThanOrEqual(1);
      expect(spec.maxSpeed, kind).toBeGreaterThan(0);
      expect(spec.fuelCapacity, kind).toBeGreaterThan(0);
      expect(spec.fuelPerTile, kind).toBeGreaterThan(0);
      expect(spec.lengthTiles, kind).toBeGreaterThan(0);
      expect(spec.platePrefix, kind).toMatch(/^[A-Z]{2}$/);
      expect(spec.color, kind).toMatch(/^#[0-9a-f]{6}$/);
      // A full tank outlasts any service run, so fuel is a live reading.
      expect(spec.fuelCapacity / spec.fuelPerTile, kind).toBeGreaterThan(400);
    }
    const platePrefixes = VEHICLE_KINDS.map((kind) => VEHICLE_KIND_SPECS[kind].platePrefix);
    expect(new Set(platePrefixes).size).toBe(VEHICLE_KINDS.length);

    // Kind-specific speed ceilings: the fast commute kinds outrun the heavy ones.
    const speeds = VEHICLE_KINDS.map((kind) => VEHICLE_KIND_SPECS[kind].maxSpeed);
    expect(VEHICLE_KIND_SPECS.taxi.maxSpeed).toBeGreaterThan(VEHICLE_KIND_SPECS.car.maxSpeed);
    expect(VEHICLE_KIND_SPECS.car.maxSpeed).toBeGreaterThan(VEHICLE_KIND_SPECS.tram.maxSpeed);
    expect(VEHICLE_KIND_SPECS.tram.maxSpeed).toBeGreaterThan(VEHICLE_KIND_SPECS.truck.maxSpeed);
    expect(VEHICLE_KIND_SPECS.truck.maxSpeed).toBeGreaterThan(VEHICLE_KIND_SPECS.bus.maxSpeed);
    expect(VEHICLE_KIND_SPECS.bus.maxSpeed).toBeGreaterThan(VEHICLE_KIND_SPECS.bicycle.maxSpeed);
    expect(new Set(speeds).size).toBeGreaterThanOrEqual(4);

    // The world's planning limits are paced up for road traffic, capped per kind.
    expect(ROAD_PACE_MULTIPLIER).toBeGreaterThan(1);
    expect(pacedSpeedLimit(0.45, 'car')).toBeCloseTo(0.45 * ROAD_PACE_MULTIPLIER, 6);
    // On the fastest avenue the kind ceiling, not the paced limit, binds.
    expect(pacedSpeedLimit(0.6, 'car')).toBe(VEHICLE_KIND_SPECS.car.maxSpeed);
    expect(pacedSpeedLimit(0.45, 'car')).toBeLessThan(VEHICLE_KIND_SPECS.car.maxSpeed);
    expect(pacedSpeedLimit(2, 'car')).toBe(VEHICLE_KIND_SPECS.car.maxSpeed);
    expect(pacedSpeedLimit(2, 'bicycle')).toBe(VEHICLE_KIND_SPECS.bicycle.maxSpeed);
  });

  it('classifies commuter peaks and commute modes', () => {
    expect(SERVICE_START_HOUR).toBeLessThan(SERVICE_END_HOUR);
    expect(COMMUTE_PEAKS.length).toBeGreaterThanOrEqual(2);
    for (const peak of COMMUTE_PEAKS) {
      expect(peak.endHour).toBeGreaterThan(peak.startHour);
      expect(isCommutePeak(peak.startHour * MINUTES_PER_HOUR)).toBe(true);
      expect(isCommutePeak((peak.startHour * MINUTES_PER_HOUR) - 1)).toBe(false);
      expect(peakForMinute(peak.startHour * MINUTES_PER_HOUR)?.id).toBe(peak.id);
    }
    expect(peakForMinute(2 * MINUTES_PER_HOUR)).toBeNull();
    expect(peakForMinute(12 * MINUTES_PER_HOUR)).toBeNull();
    expect(vehicleKindForCommuteMode('car')).toBe('car');
    expect(vehicleKindForCommuteMode('bus')).toBe('bus');
    expect(vehicleKindForCommuteMode('tram')).toBe('tram');
    expect(vehicleKindForCommuteMode('bicycle')).toBe('bicycle');
    expect(vehicleKindForCommuteMode('foot')).toBeNull();
  });

  it('keeps the traffic module DOM-free and platform-agnostic', () => {
    const entry = Object.entries(SIM_SOURCES).find(([path]) => path.endsWith('/sim/vehicles.ts'));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? '';
    expect(stripComments(source)).not.toMatch(BROWSER_GLOBAL);
    const specifiers = [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(new Set(specifiers)).toEqual(
      new Set(['./clock', './citizens', './engine', './rng', './types', './world']),
    );
  });
});

/* ---------------------------------------------------- construction/records -- */

describe('fleet construction and records', () => {
  it('validates the world and the fleet configuration', () => {
    const world = createCityWorld({ seed: 5 });
    expect(() => new VehiclesSystem(undefined as never)).toThrow(TypeError);
    const roadless = { ...world, nodes: [], segments: [] } as unknown as VehicleWorld;
    expect(() => new VehiclesSystem({ world: roadless })).toThrow(/road network/);
    const empty = { ...world, buildings: [] } as unknown as VehicleWorld;
    expect(() => new VehiclesSystem({ world: empty })).toThrow(/buildings/);
    expect(() => new VehiclesSystem({ world, serviceFleetSize: MIN_ACTIVE_VEHICLES - 1 })).toThrow(
      RangeError,
    );
    expect(() => new VehiclesSystem({ world, nightFleetSize: 0 })).toThrow(RangeError);
    expect(() => new VehiclesSystem({ world, serviceFleetSize: 20, maxActiveVehicles: 12 })).toThrow(
      RangeError,
    );
    const minimal = new VehiclesSystem({ world, serviceFleetSize: MIN_ACTIVE_VEHICLES });
    expect(minimal.serviceFleetSize).toBe(MIN_ACTIVE_VEHICLES);
    expect(minimal.nightFleetSize).toBeGreaterThan(0);
    expect(minimal.maxActiveVehicles).toBe(DEFAULT_MAX_ACTIVE_VEHICLES);
    expect(minimal.activeCount).toBe(0);
    expect(minimal.attached).toBe(false);
  });

  it('dispatches vehicles that satisfy the shared Vehicle contract', () => {
    const world = createCityWorld({ seed: 9 });
    world.companies.push(
      {
        id: 'company-civic',
        name: 'City Transit',
        sector: 'civic',
        buildingId: null,
        employees: [],
        employeeCount: 0,
        revenue: 0,
        costs: 0,
        cash: 0,
        openHour: 5,
        closeHour: 23,
        color: '#4f8bd6',
      },
      {
        id: 'company-logistics',
        name: 'Northline Freight',
        sector: 'logistics',
        buildingId: null,
        employees: [],
        employeeCount: 0,
        revenue: 0,
        costs: 0,
        cash: 0,
        openHour: 5,
        closeHour: 23,
        color: '#c9884a',
      },
    );
    const vehicles = createVehiclesSystem({ world, seed: 'records' });
    expect(vehicles.name).toBe(VEHICLES_SYSTEM_NAME);
    const depot = vehicles.depotNodeId;
    const depotNode = world.roadNodeById(depot);
    expect(depotNode).not.toBeNull();
    const neighbour = depotNode?.neighborIds[0] ?? depot;
    const beyond = world.roadNodeById(neighbour)?.neighborIds.find((id) => id !== depot) ?? depot;

    const dispatched: Vehicle[] = [];
    for (const kind of VEHICLE_KINDS) {
      const vehicle = vehicles.dispatchVehicle({
        kind,
        fromNodeId: neighbour,
        toNodeId: beyond,
      });
      expect(vehicle, kind).not.toBeNull();
      if (vehicle) {
        dispatched.push(vehicle);
      }
    }
    expect(dispatched).toHaveLength(VEHICLE_KINDS.length);

    for (const vehicle of dispatched) {
      const spec = VEHICLE_KIND_SPECS[vehicle.kind];
      expect(vehicle.id).toMatch(/^vehicle-\d+$/);
      expect(vehicle.plate).toMatch(new RegExp(`^${spec.platePrefix}-\\d+$`));
      expect(vehicle.capacity).toBe(spec.capacity);
      expect(vehicle.occupancy).toBe(0);
      expect(vehicle.occupantIds).toEqual([]);
      expect(vehicle.fuel).toBe(spec.fuelCapacity);
      expect(vehicle.fuelCapacity).toBe(spec.fuelCapacity);
      expect(vehicle.color).toBe(spec.color);
      expect(Number.isFinite(vehicle.speed)).toBe(true);
      expect(vehicle.speed).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(vehicle.headingRadians)).toBe(true);
      expect(insideWorld(vehicle, world)).toBe(true);
      expect(vehicle.currentNodeId).toBe(depot);
      expect(vehicle.route.loop).toBe(false);
      expect(vehicle.route.kind).toBe('shuttle');
      expect(vehicle.route.stopNodeIds).toEqual([neighbour, beyond]);
      expect(vehicles.owns(vehicle)).toBe(true);
      expect(vehicles.vehicleById(vehicle.id)).toBe(vehicle);
      expect(world.vehicles).toContain(vehicle);
      const details = vehicles.detailsFor(vehicle.id);
      expect(details?.plate).toBe(vehicle.plate);
      expect(details?.kindLabel).toBe(spec.label);
      expect(details?.activity).toBe('driving');
      expect(details?.role).toBe(spec.role);
      expect(details?.nextStopNodeId).toBe(neighbour);
    }
    expect(new Set(dispatched.map((vehicle) => vehicle.id)).size).toBe(dispatched.length);
    expect(new Set(dispatched.map((vehicle) => vehicle.plate)).size).toBe(dispatched.length);

    // Owners come from the city's own companies, by sector.
    const bus = dispatched.find((vehicle) => vehicle.kind === 'bus');
    const truck = dispatched.find((vehicle) => vehicle.kind === 'truck');
    const car = dispatched.find((vehicle) => vehicle.kind === 'car');
    expect(bus?.ownerCompanyId).toBe('company-civic');
    expect(truck?.ownerCompanyId).toBe('company-logistics');
    expect(car?.ownerCompanyId).toBeNull();

    expect(() =>
      vehicles.dispatchVehicle({ toNodeId: 'node-does-not-exist' }),
    ).toThrow(RangeError);
    expect(() => vehicles.dispatchVehicle({ toNodeId: '' })).toThrow(TypeError);
    expect(() =>
      vehicles.dispatchVehicle({ toNodeId: beyond, fromNodeId: 'node-does-not-exist' }),
    ).toThrow(RangeError);
    expect(vehicles.stats().dispatches).toBe(dispatched.length);

    // With the fleet already at its cap, a commuter waits at the kerb instead of
    // receiving a vehicle - and is visible to the inspector while they wait.
    const capped = new VehiclesSystem({
      world,
      serviceFleetSize: MIN_ACTIVE_VEHICLES,
      maxActiveVehicles: MIN_ACTIVE_VEHICLES,
    });
    for (let index = 0; index < MIN_ACTIVE_VEHICLES; index += 1) {
      expect(
        capped.dispatchVehicle({ kind: 'car', fromNodeId: neighbour, toNodeId: beyond }),
      ).not.toBeNull();
    }
    const { home, work } = distinctEntrancePair(world);
    const intent: CommuteIntent = {
      citizenId: 'citizen-1',
      mode: 'bus',
      fromBuildingId: home.id,
      toBuildingId: work.id,
      departMinute: 8 * 60,
      arriveMinute: 8 * 60 + 20,
      durationMinutes: 20,
      distanceTiles: 12,
      nodeIds: [],
    };
    expect(capped.dispatchRide(intent)).toBeNull();
    expect(capped.stats().unservedIntents).toBe(1);
    expect(capped.waitingAt(home.entranceNodeId ?? '').map((passenger) => passenger.citizenId)).toEqual([
      'citizen-1',
    ]);
  });

  it('creates the fleet through the factory and follows the SimSystem lifecycle', () => {
    const fixture = createSimFixture({ seed: 'lifecycle', startHour: 6, minutesPerTick: 1 });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const vehicles = createVehiclesSystem({ world, seed: fixture.rng.seed });
      const detach = vehicles.attach(fixture.engine);
      expect(vehicles.attached).toBe(true);
      expect(fixture.engine.getSystem(VEHICLES_SYSTEM_NAME)).toBe(vehicles);

      fixture.engine.step(3);
      expect(vehicles.updateCount).toBe(3);
      expect(vehicles.minuteOfDay).toBe(6 * MINUTES_PER_HOUR + 3);
      expect(vehicles.activeCount).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(world.vehicles.length).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(vehicles.stats().peakLabel).toBe('morning peak');

      expect(detach()).toBe(true);
      expect(vehicles.attached).toBe(false);
      expect(vehicles.activeCount).toBe(0);
      expect(world.vehicles).toHaveLength(0);
      expect(vehicles.parkedCount).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);

      fixture.engine.attach(vehicles);
      expect(vehicles.attached).toBe(true);
      fixture.engine.dispose();
      expect(vehicles.attached).toBe(false);
      expect(world.vehicles).toHaveLength(0);
    } finally {
      fixture.dispose();
    }
  });
});

/* --------------------------------------------------------------- driving -- */

describe('driving the road network', () => {
  it('drives commuter routes without ever leaving the road network', () => {
    const rig = createFleetRig({ seed: 'road-network' });
    const { fixture, world, vehicles } = rig;
    let offRoad = 0;
    let outside = 0;
    let badNumbers = 0;
    let fuelViolations = 0;
    let minServiceActive = Number.POSITIVE_INFINITY;
    try {
      for (let tick = 1; tick <= 11 * 60; tick += 1) {
        fixture.engine.step(1);
        for (const vehicle of world.vehicles) {
          if (roadOffset(vehicle, world) > 1e-9) {
            offRoad += 1;
          }
          if (!insideWorld(vehicle, world)) {
            outside += 1;
          }
          if (
            !Number.isFinite(vehicle.position.x) ||
            !Number.isFinite(vehicle.position.y) ||
            !Number.isFinite(vehicle.speed) ||
            !Number.isFinite(vehicle.fuel) ||
            !Number.isFinite(vehicle.headingRadians)
          ) {
            badNumbers += 1;
          }
          if (vehicle.fuel < 0 || vehicle.fuel > vehicle.fuelCapacity) {
            fuelViolations += 1;
          }
        }
        const hour = fixture.clock.hourOfDay;
        if (hour >= SERVICE_START_HOUR && hour < SERVICE_END_HOUR) {
          minServiceActive = Math.min(minServiceActive, vehicles.activeCount);
        }
      }

      expect(offRoad).toBe(0);
      expect(outside).toBe(0);
      expect(badNumbers).toBe(0);
      expect(fuelViolations).toBe(0);
      expect(vehicles.stats().totalDistanceTiles).toBeGreaterThan(10_000);
      expect(vehicles.stats().peakActiveVehicles).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(minServiceActive).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(vehicles.stats().activeVehicles).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      // Every road node a vehicle stands on is a real node of the graph.
      for (const vehicle of vehicles.activeVehicles()) {
        const node = nodeAt(vehicle, world, 1.01);
        const midpoint =
          vehicle.currentNodeId !== null &&
          vehicle.targetNodeId !== null &&
          node === null &&
          roadOffset(vehicle, world) < 1e-9;
        expect(node !== null || midpoint, vehicle.id).toBe(true);
      }
    } finally {
      fixture.dispose();
    }
  });

  it('moves at kind-specific speeds below each kind ceiling', () => {
    const rig = createFleetRig({ seed: 'kind-speeds' });
    const { fixture, world } = rig;
    const observed = new Map<VehicleKind, number>();
    const overCeiling: string[] = [];
    try {
      for (let tick = 1; tick <= 11 * 60; tick += 1) {
        fixture.engine.step(1);
        for (const vehicle of world.vehicles) {
          const spec = VEHICLE_KIND_SPECS[vehicle.kind];
          if (vehicle.speed > spec.maxSpeed + 1e-9) {
            overCeiling.push(`${vehicle.id}:${vehicle.kind}:${vehicle.speed}`);
          }
          if (vehicle.speed > 0) {
            observed.set(vehicle.kind, Math.max(observed.get(vehicle.kind) ?? 0, vehicle.speed));
          }
        }
      }
    } finally {
      fixture.dispose();
    }
    expect(overCeiling).toEqual([]);
    for (const kind of ['car', 'bus', 'truck', 'bicycle', 'tram'] as VehicleKind[]) {
      expect(observed.get(kind) ?? 0, kind).toBeGreaterThan(0);
    }
    expect(observed.get('car')!).toBeGreaterThan(observed.get('bus')!);
    expect(observed.get('bus')!).toBeGreaterThan(observed.get('bicycle')!);
    expect(observed.get('car')!).toBeGreaterThan(observed.get('truck')!);
    // Observed car speed actually reaches the paced street limit.
    expect(observed.get('car')!).toBeGreaterThanOrEqual(pacedSpeedLimit(0.45, 'car') - 1e-9);
    expect(observed.get('car')!).toBeLessThanOrEqual(VEHICLE_KIND_SPECS.car.maxSpeed + 1e-9);
  });

  it('brakes for the vehicle ahead', () => {
    const fixture = createSimFixture({ seed: 'following', startHour: 3, minutesPerTick: 1 });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const vehicles = new VehiclesSystem({ world, serviceFleetSize: MIN_ACTIVE_VEHICLES });
      fixture.engine.attach(vehicles);
      const depot = world.roadNodeById(vehicles.depotNodeId);
      expect(depot).not.toBeNull();
      const neighbour = world.roadNodeById(depot?.neighborIds[0] ?? '');
      const beyondId = neighbour?.neighborIds.find((id) => id !== depot?.id) ?? '';
      const beyond = world.roadNodeById(beyondId);
      expect(neighbour).not.toBeNull();
      expect(beyond).not.toBeNull();

      const leader = vehicles.dispatchVehicle({
        kind: 'car',
        fromNodeId: neighbour!.id,
        toNodeId: beyond!.id,
      });
      const follower = vehicles.dispatchVehicle({
        kind: 'car',
        fromNodeId: neighbour!.id,
        toNodeId: beyond!.id,
      });
      expect(leader).not.toBeNull();
      expect(follower).not.toBeNull();

      let followerSlower = 0;
      let minGap = Number.POSITIVE_INFINITY;
      for (let tick = 1; tick <= 6; tick += 1) {
        fixture.engine.step(1);
        if (!leader || !follower) {
          break;
        }
        if (follower.speed < leader.speed) {
          followerSlower += 1;
        }
        minGap = Math.min(minGap, distanceBetweenPoints(leader.position, follower.position));
      }
      // Both cars were dispatched at the same second: the follower brakes and
      // then holds a safe headway behind the leader instead of overlapping it.
      expect(followerSlower).toBeGreaterThanOrEqual(1);
      expect(vehicles.stats().followTicks).toBeGreaterThan(0);
      expect(minGap).toBeGreaterThanOrEqual(0);
      const settledGap = distanceBetweenPoints(leader!.position, follower!.position);
      expect(settledGap).toBeGreaterThanOrEqual(1.5);
      expect(settledGap).toBeLessThanOrEqual(4);
    } finally {
      fixture.dispose();
    }
  });

  it('yields at an intersection another vehicle is occupying', () => {
    const fixture = createSimFixture({ seed: 'yielding', startHour: 3, minutesPerTick: 1 });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const vehicles = new VehiclesSystem({ world });
      fixture.engine.attach(vehicles);
      const depot = world.roadNodeById(vehicles.depotNodeId);
      expect(depot).not.toBeNull();
      const neighbours = (depot?.neighborIds ?? [])
        .map((id) => world.roadNodeById(id))
        .filter((node): node is NonNullable<typeof node> => node !== null);
      expect(neighbours.length).toBeGreaterThanOrEqual(3);
      // Two approaches to the same intersection, at the same distance from it:
      // both cars are due on the node in the very same sim-minute.
      const sorted = [...neighbours].sort(
        (left, right) =>
          distanceBetweenPoints(left, depot!) - distanceBetweenPoints(right, depot!) ||
          (left.id < right.id ? -1 : 1),
      );
      const first = sorted[0];
      const second =
        sorted.find(
          (node) =>
            node.id !== first.id &&
            Math.abs(distanceBetweenPoints(node, depot!) - distanceBetweenPoints(first, depot!)) < 1e-9,
        ) ?? sorted[1];
      const beyond = neighbours.find((node) => node.id !== first.id && node.id !== second.id);
      expect(beyond).toBeDefined();

      const a = vehicles.dispatchVehicle({
        kind: 'car',
        spawnAtNodeId: first.id,
        fromNodeId: depot!.id,
        toNodeId: beyond!.id,
      });
      const b = vehicles.dispatchVehicle({
        kind: 'car',
        spawnAtNodeId: second.id,
        fromNodeId: depot!.id,
        toNodeId: beyond!.id,
      });
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();

      let pairEvidence = 0;
      let systemEvidence = 0;
      for (let tick = 1; tick <= 30; tick += 1) {
        fixture.engine.step(1);
        const active = vehicles.activeVehicles();
        if (a && b && a.speed === 0 && vehicles.detailsFor(a.id)?.activity === 'driving') {
          if (active.some((other) => other.id !== a.id && other.currentNodeId === a.targetNodeId)) {
            pairEvidence += 1;
          }
        }
        if (a && b && b.speed === 0 && vehicles.detailsFor(b.id)?.activity === 'driving') {
          if (active.some((other) => other.id !== b.id && other.currentNodeId === b.targetNodeId)) {
            pairEvidence += 1;
          }
        }
        for (const vehicle of active) {
          if (vehicle.speed !== 0 || vehicle.targetNodeId === null) {
            continue;
          }
          if (vehicles.detailsFor(vehicle.id)?.activity !== 'driving') {
            continue;
          }
          if (active.some((other) => other !== vehicle && other.currentNodeId === vehicle.targetNodeId)) {
            systemEvidence += 1;
          }
        }
      }
      expect(vehicles.stats().yieldStarts).toBeGreaterThanOrEqual(1);
      expect(vehicles.stats().yieldTicks).toBeGreaterThanOrEqual(1);
      expect(systemEvidence).toBeGreaterThan(0);
      expect(pairEvidence).toBeGreaterThan(0);
    } finally {
      fixture.dispose();
    }
  });
});

/* ------------------------------------------------------- commuter service -- */

describe('commuter service', () => {
  it('picks commuters up at their home, work or venue and drops them at their destination', () => {
    const rig = createFleetRig({ seed: 'service' });
    const { fixture, citizens, vehicles } = rig;
    const intents = new Map<string, { from: string; to: string }>();
    let boards = 0;
    let alights = 0;
    let mismatchedBoards = 0;
    let mismatchedAlights = 0;
    let occupancyDrift = 0;
    let maxOccupancy = 0;
    try {
      for (let tick = 1; tick <= 11 * 60; tick += 1) {
        const boardsBefore = vehicles.stats().boardings;
        const alightsBefore = vehicles.stats().alightings;
        fixture.engine.step(1);
        for (const intent of citizens.pendingCommuteIntents()) {
          intents.set(intent.citizenId, { from: intent.fromBuildingId, to: intent.toBuildingId });
        }
        const newBoards = vehicles.stats().boardings - boardsBefore;
        const newAlights = vehicles.stats().alightings - alightsBefore;
        // `slice(-0)` would re-read the whole log, so only look when there is news.
        const boardEvents = newBoards > 0 ? vehicles.eventsOfKind('board').slice(-newBoards) : [];
        const alightEvents = newAlights > 0 ? vehicles.eventsOfKind('alight').slice(-newAlights) : [];
        for (const event of boardEvents) {
          const intent = event.citizenId ? intents.get(event.citizenId) : undefined;
          if (intent && intent.from === event.buildingId) {
            boards += 1;
          } else {
            mismatchedBoards += 1;
          }
        }
        for (const event of alightEvents) {
          const intent = event.citizenId ? intents.get(event.citizenId) : undefined;
          if (intent && intent.to === event.buildingId) {
            alights += 1;
          } else {
            mismatchedAlights += 1;
          }
        }
        for (const vehicle of rig.world.vehicles) {
          if (vehicle.occupancy !== vehicle.occupantIds.length) {
            occupancyDrift += 1;
          }
          maxOccupancy = Math.max(maxOccupancy, vehicle.occupancy);
        }
      }
      expect(boards).toBeGreaterThan(10);
      expect(alights).toBeGreaterThan(5);
      expect(mismatchedBoards).toBe(0);
      expect(mismatchedAlights).toBe(0);
      expect(occupancyDrift).toBe(0);
      expect(maxOccupancy).toBeGreaterThanOrEqual(1);
      expect(vehicles.stats().ridersInTransit).toBeGreaterThan(0);
      // Vehicles that finished their run have given the building back.
      expect(
        vehicles.parkedVehicles().every((vehicle) => vehicle.occupancy === 0 && vehicle.occupantIds.length === 0),
      ).toBe(true);
    } finally {
      fixture.dispose();
    }
  });

  it('links riders to their vehicle while they ride', () => {
    const rig = createFleetRig({ seed: 'rider-links' });
    const { fixture, citizens, vehicles } = rig;
    const linkedCitizens = new Set<string>();
    const releasedCitizens = new Set<string>();
    let linkedSamples = 0;
    let mismatches = 0;
    try {
      expect(fixture.engine.systems.map((system) => system.name)).toEqual([
        'alpha',
        'beta',
        'citizens',
        'vehicles',
      ]);
      for (let tick = 1; tick <= 11 * 60; tick += 1) {
        fixture.engine.step(1);
        for (const citizen of citizens.citizens) {
          if (citizen.vehicleId === null) {
            if (linkedCitizens.has(citizen.id)) {
              releasedCitizens.add(citizen.id);
            }
            continue;
          }
          const details = vehicles.detailsFor(citizen.vehicleId);
          if (!details || !details.occupantIds.includes(citizen.id)) {
            mismatches += 1;
            continue;
          }
          linkedSamples += 1;
          linkedCitizens.add(citizen.id);
        }
      }
      expect(linkedSamples).toBeGreaterThan(20);
      expect(linkedCitizens.size).toBeGreaterThanOrEqual(5);
      expect(mismatches).toBe(0);
      // Once they alight, riders are released again.
      expect(releasedCitizens.size).toBeGreaterThan(0);
    } finally {
      fixture.dispose();
    }
  });

  it('holds the ten vehicle floor around the clock and parks the demand fleet overnight', () => {
    const rig = createFleetRig({ seed: 'parking' });
    const { fixture, vehicles } = rig;
    let nightActive = 0;
    let nightKinds: Record<string, number> = {};
    let nightParks = 0;
    let morningActive = 0;
    let morningKinds: Record<string, number> = {};
    let noonActive = 0;
    try {
      expect(vehicles.nightFleetSize).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(vehicles.serviceFleetSize).toBeGreaterThanOrEqual(vehicles.nightFleetSize);
      for (let tick = 1; tick <= 24 * 60; tick += 1) {
        fixture.engine.step(1);
        const hour = fixture.clock.hourOfDay;
        if (hour === 2 && fixture.clock.minuteOfHour === 0) {
          nightActive = vehicles.activeCount;
          nightKinds = vehicles.kindCounts();
          nightParks = vehicles.stats().parks;
        }
        if (hour === 8 && fixture.clock.minuteOfHour === 0) {
          morningActive = vehicles.activeCount;
          morningKinds = vehicles.kindCounts();
        }
        if (hour === 12 && fixture.clock.minuteOfHour === 0) {
          noonActive = vehicles.activeCount;
        }
      }
      // The promised floor holds at the quietest hour of the night too: the
      // overnight timetable is the skeleton service (buses and vans).
      expect(nightActive).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(nightKinds.bus ?? 0).toBeGreaterThanOrEqual(1);
      expect(nightKinds.truck ?? 0).toBeGreaterThanOrEqual(1);
      // Overnight the demand-dispatched vehicles have parked and been recycled.
      expect(nightParks).toBeGreaterThan(0);
      // The morning brings commuter demand and with it a much bigger fleet.
      expect(morningActive).toBeGreaterThan(nightActive);
      expect(morningKinds.car ?? 0).toBeGreaterThanOrEqual(1);
      expect(morningKinds.bicycle ?? 0).toBeGreaterThanOrEqual(1);
      expect(noonActive).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      const stats = vehicles.stats();
      expect(stats.parks).toBeGreaterThan(100);
      expect(stats.reusedVehicles).toBeGreaterThan(20);
      expect(stats.boardings).toBeGreaterThan(50);
      expect(stats.activeVehicles).toBeLessThanOrEqual(vehicles.maxActiveVehicles);
    } finally {
      fixture.dispose();
    }
  });
});

/* ------------------------------------------------------------------ soak -- */

describe('long run stability', () => {
  it('stays bounded, keeps serving and recycles its vehicle objects for three days', () => {
    const rig = createFleetRig({ seed: 'three-day-soak' });
    const { fixture, world, vehicles } = rig;
    let offRoad = 0;
    let outside = 0;
    let badNumbers = 0;
    let fuelViolations = 0;
    let peakActive = 0;
    let minActive = Number.POSITIVE_INFINITY;
    const boardingsByDay: number[] = [];
    try {
      for (let tick = 1; tick <= 3 * 24 * 60; tick += 1) {
        fixture.engine.step(1);
        peakActive = Math.max(peakActive, vehicles.activeCount);
        minActive = Math.min(minActive, vehicles.activeCount);
        expect(vehicles.activeCount).toBeLessThanOrEqual(vehicles.maxActiveVehicles);
        for (const vehicle of world.vehicles) {
          if (roadOffset(vehicle, world) > 1e-9) {
            offRoad += 1;
          }
          if (!insideWorld(vehicle, world)) {
            outside += 1;
          }
          if (
            !Number.isFinite(vehicle.position.x) ||
            !Number.isFinite(vehicle.position.y) ||
            !Number.isFinite(vehicle.speed) ||
            !Number.isFinite(vehicle.fuel)
          ) {
            badNumbers += 1;
          }
          if (vehicle.fuel < 0 || vehicle.fuel > vehicle.fuelCapacity) {
            fuelViolations += 1;
          }
        }
        if (fixture.clock.minuteOfHour === 0 && fixture.clock.hourOfDay === 0) {
          boardingsByDay.push(vehicles.stats().boardings);
        }
      }

      const stats = vehicles.stats();
      expect(offRoad).toBe(0);
      expect(outside).toBe(0);
      expect(badNumbers).toBe(0);
      expect(fuelViolations).toBe(0);
      expect(peakActive).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(minActive).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
      expect(stats.peakActiveVehicles).toBeLessThanOrEqual(vehicles.maxActiveVehicles);
      // The fleet keeps working across every simulated day.
      expect(boardingsByDay.length).toBeGreaterThanOrEqual(3);
      expect(stats.boardings).toBeGreaterThan(200);
      expect(stats.alightings).toBeGreaterThan(150);
      expect(stats.ridersInTransit).toBeGreaterThan(0);
      expect(stats.expiredWaits).toBe(0);

      // Objects are recycled: far more dispatches than allocations, and every
      // parked vehicle is refuelled and empty, ready to be sent out again.
      expect(stats.createdVehicles).toBeLessThanOrEqual(vehicles.maxActiveVehicles);
      expect(stats.dispatches).toBeGreaterThan(stats.createdVehicles * 2);
      expect(stats.reusedVehicles).toBeGreaterThan(100);
      expect(stats.parks).toBeGreaterThan(150);
      expect(stats.refuels).toBeGreaterThanOrEqual(stats.parks);
      const parked = vehicles.parkedVehicles();
      expect(parked.length).toBeGreaterThan(0);
      for (const vehicle of parked) {
        expect(vehicle.occupancy).toBe(0);
        expect(vehicle.occupantIds).toEqual([]);
        expect(vehicle.fuel).toBe(vehicle.fuelCapacity);
        expect(vehicle.speed).toBe(0);
      }
      const parkedDetails = vehicles.detailsFor(parked[0].id);
      expect(parkedDetails?.activity).toBe('parked');
      expect(parkedDetails?.occupantIds).toEqual([]);
      expect(parkedDetails?.stops).toEqual([]);
      // Identities are reused rather than duplicated.
      const reuses = vehicles.eventsOfKind('reuse');
      const dispatchEvents = vehicles.eventsOfKind('dispatch');
      expect(reuses.length).toBeGreaterThan(0);
      const plateById = new Map<string, string>();
      for (const event of dispatchEvents) {
        plateById.set(event.vehicleId, vehicles.vehicleById(event.vehicleId)?.plate ?? '');
      }
      for (const event of reuses) {
        const plate = vehicles.vehicleById(event.vehicleId)?.plate;
        expect(plate).toBe(plateById.get(event.vehicleId));
      }
      // Riding links are still consistent at the end of the soak.
      for (const citizen of rig.citizens.citizens) {
        if (citizen.vehicleId === null) {
          continue;
        }
        expect(vehicles.detailsFor(citizen.vehicleId)?.occupantIds).toContain(citizen.id);
      }
    } finally {
      fixture.dispose();
    }
  }, 240_000);
});
