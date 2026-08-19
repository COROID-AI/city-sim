/**
 * Vehicle fleet generation.
 *
 * Creates the city's active traffic layer at boot: 12+ vehicles across four
 * classes — city buses, taxis, delivery vans, and private cars. Every vehicle
 * carries full detail (id, plate, type, driver citizen link, passengers,
 * capacity, speed, fuel, condition, route) so the fleet is inspectable and
 * renderable from the moment the simulation starts.
 *
 * The fleet is deterministic (seeded RNG) and reads only from the shared
 * CityState — it never mutates road/world structures.
 */

import { CONFIG } from '../core/config.js';
import { RNG } from '../core/rng.js';
import { buildRoute } from './route.js';

const PLATE_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

/** Random 3-letter + 3-digit licence plate (e.g. "JT-482K"). */
function makePlate(rng) {
  const letters = (n) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      s += PLATE_LETTERS[rng.int(0, PLATE_LETTERS.length - 1)];
    }
    return s;
  };
  return `${letters(2)}-${rng.int(100, 999)}${letters(1)}`;
}

/** Door tile for a building id (snap point for routes). */
function doorTile(city, buildingId) {
  const b = city.buildingById.get(buildingId);
  return b ? { x: b.door.x, y: b.door.y } : null;
}

/**
 * Shared base vehicle shape. Fields follow (and extend) the Vehicle contract
 * in src/core/types.js so the fleet is queryable by the renderer and HUD.
 */
function baseVehicle(id, kind, type, capacity, speed, city, rng) {
  const road = rng.pick(city.roads) || { x: 0, y: 0 };
  return {
    id,
    kind,
    type,
    plate: makePlate(rng),
    driverId: null,
    ownerId: null,
    passengers: [],
    capacity,
    speed,
    fuel: rng.int(60, 100),
    fuelTank: 100,
    condition: rng.int(70, 100),
    route: [],
    path: [],
    pathIndex: 0,
    tile: { x: road.x, y: road.y },
    state: 'idle',
    prevState: 'idle',
    heading: 'e',
    detailSeed: rng.int(1, 1000000000),
  };
}

/** Pick one building door per zone to form a bus route (residential → office → entertainment). */
function pickBusStops(city, rng) {
  const zones = ['residential', 'workplace', 'entertainment'];
  const stops = [];
  for (const zone of zones) {
    const pool = city.buildings.filter((b) => b.zone === zone);
    const b = pool.length ? rng.pick(pool) : city.buildings[rng.int(0, city.buildings.length - 1)];
    if (b) stops.push({ x: b.door.x, y: b.door.y, buildingId: b.id });
  }
  if (!stops.length) {
    for (const b of city.buildings.slice(0, 3)) {
      stops.push({ x: b.door.x, y: b.door.y, buildingId: b.id });
    }
  }
  return stops;
}

/** Public transit bus: loops between residential / office / entertainment stops. */
function makeBus(id, city, rng) {
  const v = baseVehicle(id, 'bus', 'City Bus', 20, 14, city, rng);
  v.driverId = null; // public transit — no single citizen driver
  v.stops = pickBusStops(city, rng);
  v.stopIndex = 0;
  v.route = v.stops.map((s) => ({ x: s.x, y: s.y }));
  v.destination = v.stops[0];
  v.path = buildRoute(city, v.tile, v.destination);
  v.pathIndex = 0;
  v.state = 'traveling';
  return v;
}

/** Taxi: a private citizen driver, carries long-distance commuters. */
function makeTaxi(id, city, rng) {
  const v = baseVehicle(id, 'taxi', 'Taxi', 4, 18, city, rng);
  const drivers = city.citizens.filter((c) => c.employed);
  const driver = rng.pick(drivers) || city.citizens[0];
  v.driverId = driver ? driver.id : null;
  v.passengerId = null;
  return v;
}

/** Delivery van: company-owned, circulates between offices and shops. */
function makeVan(id, city, rng) {
  const v = baseVehicle(id, 'van', 'Delivery Van', 15, 12, city, rng);
  const companies = city.companies || [];
  const shops = city.buildings.filter((b) => b.zone === 'service' && b.subType === 'shop');
  const circuit = [];
  for (const co of companies.slice(0, 4)) {
    const t = doorTile(city, co.buildingId);
    if (t) circuit.push(t);
  }
  for (const s of shops.slice(0, 4)) {
    circuit.push({ x: s.door.x, y: s.door.y });
  }
  if (!circuit.length) circuit.push({ x: city.roads[0].x, y: city.roads[0].y });
  v.circuit = circuit;
  v.circuitIndex = 0;
  v.route = circuit.map((t) => ({ x: t.x, y: t.y }));
  v.destination = circuit[0];
  v.path = buildRoute(city, v.tile, v.destination);
  v.pathIndex = 0;
  v.state = 'traveling';
  const worker = city.citizens.find((c) => c.employed);
  v.driverId = worker ? worker.id : null;
  return v;
}

/** Private car: owned by a citizen, carries its owner to/from work. */
function makeCar(id, city, rng) {
  const v = baseVehicle(id, 'car', 'Private Car', 4, 20, city, rng);
  const owners = city.citizens.filter((c) => c.employed);
  const owner = owners.length ? owners[id % owners.length] : city.citizens[0];
  v.ownerId = owner ? owner.id : null;
  v.driverId = owner ? owner.id : null;
  return v;
}

/**
 * Create the full active fleet. Returns an array of ≥10 vehicles (3 buses,
 * 3 taxis, 3 delivery vans, 3 private cars).
 * @param {object} city  CityState ({ citizens, buildings, roads, companies }).
 * @param {object} config  Tunables config.
 * @returns {object[]} The vehicle fleet.
 */
export function createFleet(city, config = CONFIG) {
  const rng = new RNG(config.SEED + 101);
  const vehicles = [];
  let id = 0;
  for (let i = 0; i < 3; i++) vehicles.push(makeBus(id++, city, rng));
  for (let i = 0; i < 3; i++) vehicles.push(makeTaxi(id++, city, rng));
  for (let i = 0; i < 3; i++) vehicles.push(makeVan(id++, city, rng));
  for (let i = 0; i < 3; i++) vehicles.push(makeCar(id++, city, rng));
  return vehicles;
}