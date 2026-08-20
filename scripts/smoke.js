/**
 * Headless smoke test for the integrated simulation layers.
 * Verifies the acceptance criteria without a browser:
 *   - 50+ citizens with complete detail fields
 *   - A* pathfinding between two building doors
 *   - Daily schedule drives observable movement between buildings
 *   - Employment status is queryable
 *   - 10+ vehicles active and every vehicle stays on road tiles across N ticks
 */
import { CONFIG } from '../src/core/config.js';
import { generateCity } from '../src/world/generate.js';
import { populateCitizens } from '../src/citizens/populate.js';
import { advanceSchedules, phaseForHour } from '../src/citizens/schedule.js';
import { updateCitizens } from '../src/citizens/update.js';
import { findPath } from '../src/citizens/pathfinding.js';
import { initVehicles, updateVehicles, getVehicles } from '../src/vehicles/index.js';
import { vehicleTile } from '../src/vehicles/update.js';

const world = generateCity(CONFIG.SEED, CONFIG);
const { city, citizens } = populateCitizens(world, CONFIG);

let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
}

// 1. Population size + detail fields.
check('>=50 citizens', citizens.length >= 50, `count=${citizens.length}`);
const first = citizens[0];
check(
  'citizens have full detail fields',
  first.name && first.firstName && first.lastName &&
    Number.isFinite(first.age) && first.gender &&
    first.homeId && first.wallet && first.needs &&
    Number.isFinite(first.needs.hunger) &&
    Number.isFinite(first.needs.energy) &&
    Number.isFinite(first.needs.fun) &&
    Number.isFinite(first.happiness),
  `sample=${first.name}`,
);

// 2. Employment is queryable.
const employed = citizens.filter((c) => c.employed).length;
check('employment rate queryable', city.economy.employmentRate > 0 &&
  city.economy.employmentRate <= 1 &&
  city.economy.employed === employed,
  `rate=${city.economy.employmentRate.toFixed(2)}`);
const worker = citizens.find((c) => c.employed);
check('employed citizen has job/salary/employer',
  worker && worker.jobTitle !== 'Unemployed' && worker.salary > 0 &&
    worker.workplaceId && worker.companyId,
  worker ? `${worker.jobTitle} @ ${worker.companyName} ($ ${worker.salary})` : 'none');

// 3. A* pathfinding between two building doors.
const b1 = world.buildings[0];
const b2 = world.buildings[world.buildings.length - 1];
const route = findPath(world, b1.door, b2.door);
check('A* returns a road route between doors', route.length >= 2,
  `len=${route.length}`);
if (route.length >= 2) {
  // Every interior step must lie on a road tile (start/goal are doors).
  const roadSet = new Set(world.roads.map((r) => `${r.x},${r.y}`));
  let allOnRoad = true;
  for (let i = 1; i < route.length - 1; i++) {
    if (!roadSet.has(`${route[i].x},${route[i].y}`)) { allOnRoad = false; break; }
  }
  check('A* route follows roads', allOnRoad);
}

// 4. Daily schedule: citizens move between buildings over a simulated day.
const startPositions = citizens.map((c) => `${c.tile.x.toFixed(1)},${c.tile.y.toFixed(1)}`);
let movementObserved = false;
let workObserved = false;
let entertainObserved = false;
let homeObserved = false;
for (let h = 0; h < 24 && !(movementObserved && workObserved && entertainObserved); h++) {
  advanceSchedules(city, { simHour: h, simDay: 1 });
  // Advance several frames within the hour so walking is observable.
  for (let f = 0; f < 60; f++) updateCitizens(city, { simHour: h }, 0.05);
  const phases = new Set(citizens.map((c) => c.phase));
  if (phases.has('work')) workObserved = true;
  if (phases.has('entertain')) entertainObserved = true;
  if (phases.has('sleep')) homeObserved = true;
}
const nowPositions = citizens.map((c) => `${c.tile.x.toFixed(1)},${c.tile.y.toFixed(1)}`);
for (let i = 0; i < citizens.length; i++) {
  if (startPositions[i] !== nowPositions[i]) { movementObserved = true; break; }
}
check('citizens move between buildings over the day', movementObserved);
check('schedule reaches work phase', workObserved);
check('schedule reaches entertainment phase', entertainObserved);
check('schedule returns home to sleep', homeObserved);

// 5. Phase mapping sanity.
check('phaseForHour(6)=sleep', phaseForHour(6) === 'sleep');
check('phaseForHour(9)=work', phaseForHour(9) === 'work');
check('phaseForHour(20)=entertain', phaseForHour(20) === 'entertain');
check('phaseForHour(23)=to-home', phaseForHour(23) === 'to-home');

// 6. Vehicle fleet: >=10 active vehicles, all on road tiles across N ticks.
const N_TICKS = 600;
const vehicles = initVehicles(world, CONFIG);
check('>=10 vehicles active', vehicles.length >= 10, `count=${vehicles.length}`);
check(
  'all vehicles travel at boot',
  vehicles.every((v) => v.state === 'travel'),
  `states=${[...new Set(vehicles.map((v) => v.state))].join(',')}`,
);

const ts = world.tileSize;
const roadSet = new Set(world.roads.map((r) => `${r.x},${r.y}`));
let roadViolations = 0;
for (let tick = 0; tick < N_TICKS; tick++) {
  updateVehicles(1 / 60, world, { zoom: 1 });
  for (const v of vehicles) {
    const t = vehicleTile(v, ts);
    if (!roadSet.has(`${t.x},${t.y}`)) roadViolations++;
  }
}
check(
  'every vehicle stays on road tiles across N ticks',
  roadViolations === 0,
  `violations=${roadViolations}/${N_TICKS * vehicles.length}`,
);
check('fleet still active after N ticks', getVehicles().length === vehicles.length);
check(
  'vehicles still moving/driving after N ticks',
  vehicles.every((v) => v.state === 'travel'),
  `states=${[...new Set(vehicles.map((v) => v.state))].join(',')}`,
);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);