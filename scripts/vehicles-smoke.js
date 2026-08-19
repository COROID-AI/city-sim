/**
 * Headless smoke test for the vehicles layer.
 * Verifies the traffic acceptance criteria without a browser:
 *   - ≥10 active vehicles with full detail (plate, type, driver, fuel, ...)
 *   - Vehicles stay on the road network (no off-road / through-building motion)
 *   - Buses, taxis, and delivery vans exhibit distinct behaviours
 *   - Night lighting flag drives the headlight render path
 *   - Taxis carry commuting citizens between stops (pickup + dropoff)
 */
import { CONFIG } from '../src/core/config.js';
import { generateCity } from '../src/world/generate.js';
import { populateCitizens } from '../src/citizens/populate.js';
import { advanceSchedules } from '../src/citizens/schedule.js';
import { createFleet } from '../src/vehicles/fleet.js';
import { updateVehicles } from '../src/vehicles/update.js';

const world = generateCity(CONFIG.SEED, CONFIG);
const { city, citizens } = populateCitizens(world, CONFIG);
city.vehicles = createFleet(city, CONFIG);

let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
}

// 1. Fleet size + full detail.
check('>=10 vehicles active', city.vehicles.length >= 10, `count=${city.vehicles.length}`);
const kinds = new Set(city.vehicles.map((v) => v.kind));
check('has buses', kinds.has('bus'));
check('has taxis', kinds.has('taxi'));
check('has delivery vans', kinds.has('van'));
check('has private cars', kinds.has('car'));
const sample = city.vehicles[0];
check(
  'vehicle has full detail fields',
  sample.id !== undefined && sample.plate && sample.type && sample.kind &&
    Number.isFinite(sample.capacity) && Number.isFinite(sample.speed) &&
    Number.isFinite(sample.fuel) && Number.isFinite(sample.condition) &&
    Array.isArray(sample.route) && Array.isArray(sample.passengers),
  `plate=${sample.plate} type=${sample.type}`,
);
const bus = city.vehicles.find((v) => v.kind === 'bus');
check('bus has a stop loop route', bus && bus.route && bus.route.length >= 3, `stops=${bus && bus.route.length}`);
const van = city.vehicles.find((v) => v.kind === 'van');
check('delivery van has a service circuit', van && van.circuit && van.circuit.length >= 2, `circuit=${van && van.circuit.length}`);

// 2. Vehicles stay on the road network while moving.
const roadSet = new Set(world.roads.map((r) => `${r.x},${r.y}`));
for (let f = 0; f < 240; f++) updateVehicles(city, { simHour: 7, dayPhase: 7 / 24 }, 0.05);
let onRoad = true;
let moved = false;
const startPos = city.vehicles.map((v) => `${v.tile.x.toFixed(2)},${v.tile.y.toFixed(2)}`);
for (let f = 0; f < 600; f++) updateVehicles(city, { simHour: 7, dayPhase: 7 / 24 }, 0.05);
for (let i = 0; i < city.vehicles.length; i++) {
  const v = city.vehicles[i];
  const key = `${Math.floor(v.tile.x)},${Math.floor(v.tile.y)}`;
  if (!roadSet.has(key)) onRoad = false;
  const now = `${v.tile.x.toFixed(2)},${v.tile.y.toFixed(2)}`;
  if (startPos[i] !== now) moved = true;
}
check('vehicles remain on the road network', onRoad);
check('vehicles actively move along roads', moved);

// 3. Night lighting is published for the headlight render.
updateVehicles(city, { simHour: 2, dayPhase: 2 / 24 }, 0.05);
check('night lighting published at night', city.lighting && city.lighting.night === true);
updateVehicles(city, { simHour: 12, dayPhase: 12 / 24 }, 0.05);
check('day lighting published at noon', city.lighting && city.lighting.night === false);

// 4. Passenger transport: taxis and buses carry commuting citizens.
advanceSchedules(city, { simHour: 7, simDay: 1 });
let taxiPickedUp = false;
let taxiDropped = false;
let riderId = null;
let busBoarded = false;
for (let f = 0; f < 30000 && !(taxiDropped && busBoarded); f++) {
  updateVehicles(city, { simHour: 7, dayPhase: 7 / 24 }, 0.05);
  const taxi = city.vehicles.find((v) => v.kind === 'taxi' && v.passengerId != null);
  if (taxi && !taxiPickedUp) {
    taxiPickedUp = true;
    riderId = taxi.passengerId;
  }
  if (riderId != null) {
    const rider = citizens.find((c) => c.id === riderId);
    if (rider && rider.riding === null && taxiPickedUp) taxiDropped = true;
  }
  const b = city.vehicles.find((v) => v.kind === 'bus' && v.passengers.length > 0);
  if (b) busBoarded = true;
}
check('taxi picks up a commuting citizen', taxiPickedUp);
check('taxi carries citizen and drops them off', taxiDropped);
check('bus carries passengers between stops', busBoarded);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);