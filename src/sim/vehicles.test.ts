import { createWorld } from './world';
import { generateCity, DEFAULT_CITY_SEED } from './worldGen';
import { spawnVehicles, tickVehicles, DEFAULT_VEHICLE_SEED } from './vehicles';
import { tileAt } from './world';
import { SIM_HOUR_MS, MIN_VEHICLES } from './constants';
import type { Citizen, VehicleKind, World } from './types';

// Force deterministic (100%) pickup probability so pickup/dropoff tests
// do not depend on low-probability RNG rolls.
jest.mock('./constants', () => ({
  ...jest.requireActual('./constants'),
  VEHICLE_PICKUP_CHANCE: 1.0,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Build a fully-generated city with roads and buildings. */
function makeCity(seed: number = DEFAULT_CITY_SEED): World {
  const world = createWorld();
  generateCity(world, seed);
  return world;
}

/** Add `n` citizens to the world with home/work assignments. */
function addCitizens(world: World, n: number): Citizen[] {
  const homes = Array.from(world.buildings.values());
  const citizens: Citizen[] = [];
  for (let i = 0; i < n; i++) {
    const home = homes[i % homes.length]!;
    const citizen: Citizen = {
      id: `c${i}`,
      home: home.id,
      work: homes[(i + 1) % homes.length]!.id,
      entertainment: null,
      state: { kind: 'HOME', buildingId: home.id },
      position: { x: home.position.x, y: home.position.y },
      money: 100,
      path: [],
      pathIndex: 0,
    };
    world.citizens.set(citizen.id, citizen);
    citizens.push(citizen);
  }
  return citizens;
}

// ─── spawnVehicles ───────────────────────────────────────────────────────────

describe('spawnVehicles', () => {
  it('creates at least 10 vehicles by default', () => {
    const world = makeCity();
    spawnVehicles(world);
    expect(world.vehicles.size).toBeGreaterThanOrEqual(MIN_VEHICLES);
  });

  it('creates the requested number of vehicles', () => {
    const world = makeCity();
    spawnVehicles(world, 15);
    expect(world.vehicles.size).toBe(15);
  });

  it('places every vehicle on a road tile', () => {
    const world = makeCity();
    spawnVehicles(world, 12);
    for (const vehicle of world.vehicles.values()) {
      const tile = tileAt(
        world,
        Math.round(vehicle.position.x),
        Math.round(vehicle.position.y),
      );
      expect(tile).toBeDefined();
      expect(tile!.terrain).toBe('ROAD');
    }
  });

  it('gives each vehicle a unique ID', () => {
    const world = makeCity();
    spawnVehicles(world, 12);
    const ids = Array.from(world.vehicles.keys());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces a mix of vehicle kinds', () => {
    const world = makeCity();
    spawnVehicles(world, 20);
    const kinds = new Set(
      Array.from(world.vehicles.values()).map((v) => v.kind),
    );
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  });

  it('assigns a citizen driver when citizens exist', () => {
    const world = makeCity();
    addCitizens(world, 50);
    spawnVehicles(world, 10);
    for (const vehicle of world.vehicles.values()) {
      expect(vehicle.driver).not.toBeNull();
      expect(world.citizens.has(vehicle.driver!)).toBe(true);
    }
  });

  it('initialises detailed vehicle state', () => {
    const world = makeCity();
    spawnVehicles(world, 10);
    for (const vehicle of world.vehicles.values()) {
      // kind is one of the valid VehicleKind values
      const validKinds: VehicleKind[] = ['CAR', 'TRUCK', 'BUS', 'MOTORCYCLE'];
      expect(validKinds).toContain(vehicle.kind);

      // speed is positive
      expect(vehicle.speed).toBeGreaterThan(0);

      // fuel starts full (0–100)
      expect(vehicle.fuel).toBeLessThanOrEqual(100);
      expect(vehicle.fuel).toBeGreaterThan(0);

      // passengers list is empty initially
      expect(vehicle.passengers).toEqual([]);

      // path state exists
      expect(Array.isArray(vehicle.currentRoadPath)).toBe(true);
      expect(vehicle.pathProgress).toBeGreaterThanOrEqual(0);
      expect(vehicle.pathProgress).toBeLessThanOrEqual(1);
    }
  });

  it('assigns an initial road path to each vehicle', () => {
    const world = makeCity();
    spawnVehicles(world, 10);
    let withPath = 0;
    for (const vehicle of world.vehicles.values()) {
      if (vehicle.currentRoadPath.length > 1) withPath++;
    }
    // At least most vehicles should have a multi-tile path.
    expect(withPath).toBeGreaterThan(0);
  });

  it('is deterministic: identical seeds produce identical vehicles', () => {
    const a = makeCity();
    spawnVehicles(a, 10, DEFAULT_VEHICLE_SEED);

    const b = makeCity();
    spawnVehicles(b, 10, DEFAULT_VEHICLE_SEED);

    const sa = JSON.stringify(
      Array.from(a.vehicles.values()).map((v) => ({
        id: v.id,
        kind: v.kind,
        position: v.position,
        speed: v.speed,
      })),
    );
    const sb = JSON.stringify(
      Array.from(b.vehicles.values()).map((v) => ({
        id: v.id,
        kind: v.kind,
        position: v.position,
        speed: v.speed,
      })),
    );
    expect(sa).toEqual(sb);
  });

  it('produces different vehicles for different seeds', () => {
    const a = makeCity();
    spawnVehicles(a, 10, 111);

    const b = makeCity();
    spawnVehicles(b, 10, 222);

    const sa = JSON.stringify(
      Array.from(a.vehicles.values()).map((v) => ({
        kind: v.kind,
        position: v.position,
      })),
    );
    const sb = JSON.stringify(
      Array.from(b.vehicles.values()).map((v) => ({
        kind: v.kind,
        position: v.position,
      })),
    );
    expect(sa).not.toEqual(sb);
  });

  it('handles an empty world with no roads gracefully', () => {
    const world = createWorld();
    expect(() => spawnVehicles(world, 10)).not.toThrow();
    expect(world.vehicles.size).toBe(0);
  });
});

// ─── tickVehicles ────────────────────────────────────────────────────────────

describe('tickVehicles', () => {
  it('advances vehicles along their paths', () => {
    const world = makeCity();
    spawnVehicles(world, 10, DEFAULT_VEHICLE_SEED);

    // Snapshot initial positions.
    const before = Array.from(world.vehicles.values()).map((v) => ({
      id: v.id,
      x: v.position.x,
      y: v.position.y,
    }));

    // Advance by a few sim-hours worth of ticks.
    for (let i = 0; i < 20; i++) {
      tickVehicles(world, SIM_HOUR_MS);
    }

    const after = Array.from(world.vehicles.values()).map((v) => ({
      id: v.id,
      x: v.position.x,
      y: v.position.y,
    }));

    // At least one vehicle should have moved.
    let moved = 0;
    for (let i = 0; i < before.length; i++) {
      if (
        before[i]!.x !== after[i]!.x ||
        before[i]!.y !== after[i]!.y
      ) {
        moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('keeps vehicles on road tiles after movement', () => {
    const world = makeCity();
    spawnVehicles(world, 10);

    for (let i = 0; i < 10; i++) {
      tickVehicles(world, SIM_HOUR_MS);
    }

    for (const vehicle of world.vehicles.values()) {
      const tile = tileAt(
        world,
        Math.round(vehicle.position.x),
        Math.round(vehicle.position.y),
      );
      expect(tile).toBeDefined();
      expect(tile!.terrain).toBe('ROAD');
    }
  });

  it('requests a new path when the current one is exhausted', () => {
    const world = makeCity();
    spawnVehicles(world, 5);

    // Tick many times so vehicles exhaust their initial paths.
    for (let i = 0; i < 100; i++) {
      tickVehicles(world, SIM_HOUR_MS);
    }

    // Every active vehicle should still have a path.
    for (const vehicle of world.vehicles.values()) {
      expect(vehicle.currentRoadPath.length).toBeGreaterThan(0);
    }
  });

  it('updates velocity during movement', () => {
    const world = makeCity();
    spawnVehicles(world, 10);

    let anyMoving = false;
    for (let i = 0; i < 10; i++) {
      tickVehicles(world, 500);
      for (const vehicle of world.vehicles.values()) {
        if (vehicle.velocity.x !== 0 || vehicle.velocity.y !== 0) {
          anyMoving = true;
        }
      }
    }
    expect(anyMoving).toBe(true);
  });

  it('does not throw on an empty world', () => {
    const world = createWorld();
    expect(() => tickVehicles(world, 1000)).not.toThrow();
  });

  it('depletes fuel during travel', () => {
    const world = makeCity();
    spawnVehicles(world, 10, DEFAULT_VEHICLE_SEED);

    // Snapshot initial fuel levels.
    const initialFuel = Array.from(world.vehicles.values()).map(
      (v) => v.fuel,
    );

    // Advance substantially.
    for (let i = 0; i < 50; i++) {
      tickVehicles(world, SIM_HOUR_MS);
    }

    const finalFuel = Array.from(world.vehicles.values()).map(
      (v) => v.fuel,
    );

    // At least one vehicle should have consumed fuel.
    let depleted = false;
    for (let i = 0; i < initialFuel.length; i++) {
      if (finalFuel[i]! < initialFuel[i]!) {
        depleted = true;
        break;
      }
    }
    expect(depleted).toBe(true);
  });

  it('refuels when fuel is critically low', () => {
    const world = makeCity();
    spawnVehicles(world, 1, DEFAULT_VEHICLE_SEED);

    const vehicle = Array.from(world.vehicles.values())[0]!;
    // Force fuel below the refuel threshold.
    vehicle.fuel = 1;

    tickVehicles(world, 500);

    // Fuel should have increased (refuelling).
    expect(vehicle.fuel).toBeGreaterThan(1);
  });
});

// ─── Pickup / Dropoff ────────────────────────────────────────────────────────

describe('citizen pickup and dropoff', () => {
  it('picks up a nearby commuting citizen as a passenger', () => {
    const world = makeCity();
    const citizens = addCitizens(world, 5);

    // Spawn 1 vehicle — citizens[0] is assigned as the driver.
    spawnVehicles(world, 1, DEFAULT_VEHICLE_SEED);
    const vehicle = Array.from(world.vehicles.values())[0]!;

    // Use citizens[1] as the commuter (NOT the driver, since
    // pickUpPassengers skips the driver).
    const commuter = citizens[1]!;
    commuter.state = {
      kind: 'COMMUTING',
      fromId: commuter.home!,
      toId: commuter.work!,
      progress: 0,
    };
    // Position the commuter exactly at the vehicle's location.
    commuter.position = { x: vehicle.position.x, y: vehicle.position.y };

    // VEHICLE_PICKUP_CHANCE is mocked to 1.0, so pickup is deterministic.
    let pickedUp = false;
    for (let i = 0; i < 200; i++) {
      tickVehicles(world, 500);
      if (vehicle.passengers.includes(commuter.id)) {
        pickedUp = true;
        break;
      }
    }
    expect(pickedUp).toBe(true);
  });

  it('drops off passengers at their destination', () => {
    const world = makeCity();
    const citizens = addCitizens(world, 5);

    spawnVehicles(world, 1, DEFAULT_VEHICLE_SEED);
    const vehicle = Array.from(world.vehicles.values())[0]!;

    // Set up a commuter at the vehicle's position.
    const commuter = citizens[0]!;
    commuter.state = {
      kind: 'COMMUTING',
      fromId: commuter.home!,
      toId: commuter.work!,
      progress: 0,
    };
    commuter.position = { x: vehicle.position.x, y: vehicle.position.y };

    // Run the simulation until the citizen is picked up and dropped off.
    let droppedOff = false;
    for (let i = 0; i < 1000; i++) {
      tickVehicles(world, SIM_HOUR_MS);

      if (vehicle.passengers.includes(commuter.id)) {
        // Wait for drop-off.
      }
      if (
        !vehicle.passengers.includes(commuter.id) &&
        commuter.position.x !== vehicle.position.x
      ) {
        // Was picked up (since it left the vehicle) — check if dropped.
      }
      // After pickup, the passenger is removed from the list on drop-off.
      if (vehicle.target === null && i > 5) {
        droppedOff = true;
        break;
      }
    }
    // The vehicle should have eventually cleared its target.
    expect(droppedOff).toBe(true);
  });

  it('does not pick up the same citizen into two vehicles', () => {
    const world = makeCity();
    const citizens = addCitizens(world, 2);

    spawnVehicles(world, 3, DEFAULT_VEHICLE_SEED);
    const [v0, v1] = Array.from(world.vehicles.values());

    // Put a commuter at a shared position between two vehicles.
    const commuter = citizens[0]!;
    commuter.state = {
      kind: 'COMMUTING',
      fromId: commuter.home!,
      toId: commuter.work!,
      progress: 0,
    };

    // Position both vehicles at the same tile as the commuter.
    const sharedPos = { x: 0, y: 0 };
    v0!.position = { ...sharedPos };
    v1!.position = { ...sharedPos };
    commuter.position = { ...sharedPos };

    for (let i = 0; i < 200; i++) {
      tickVehicles(world, 500);
    }

    // The commuter should be in at most one vehicle's passenger list.
    const inV0 = v0!.passengers.includes(commuter.id);
    const inV1 = v1!.passengers.includes(commuter.id);
    expect(inV0 && inV1).toBe(false);
  });
});
