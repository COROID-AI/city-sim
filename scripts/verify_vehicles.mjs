import { generateCity } from '../src/world/generate.js';
import { CONFIG } from '../src/core/config.js';
import {
  initVehicles,
  updateVehicles,
  getVehicles,
  cachedRouteCount,
} from '../src/vehicles/index.js';
import { vehicleTile } from '../src/vehicles/update.js';

const DT = 1 / 60;
const FRAMES = 1500;
let failures = 0;

function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

function runSim(seed) {
  const world = generateCity(seed, CONFIG);
  const ts = world.tileSize;
  const roadKeys = new Set(world.roads.map((r) => `${r.x},${r.y}`));
  const vehicles = initVehicles(world, CONFIG);
  const moved = vehicles.map(() => 0);
  const arrivals = { count: 0 };
  const recycles = { count: 0 };
  const prevRoute = vehicles.map((v) => v.route);
  const roadCheck = (v) => {
    const t = vehicleTile(v, ts);
    return roadKeys.has(`${t.x},${t.y}`);
  };
  const floorRoadCheck = (v) => {
    const tx = Math.floor(v.position.x / ts);
    const ty = Math.floor(v.position.y / ts);
    if (tx < 0 || ty < 0 || tx >= world.gridSize || ty >= world.gridSize) return false;
    return world.tiles[ty][tx].type === 'road';
  };
  // Vehicles are allowed to pass over a building footprint only when the
  // underlying tile is a road tile (a pre-existing world-gen artifact where
  // spur roads run under later-placed footprints). A real violation is a
  // building/grass tile that is not road.
  const buildingOverNonRoadCheck = (v) => {
    const tx = Math.floor(v.position.x / ts);
    const ty = Math.floor(v.position.y / ts);
    if (tx < 0 || ty < 0 || tx >= world.gridSize || ty >= world.gridSize) return true;
    if (world.tiles[ty][tx].type !== 'road') {
      for (const b of world.buildings) {
        const f = b.footprint;
        if (tx >= f.x && tx < f.x + f.w && ty >= f.y && ty < f.y + f.h) return false;
      }
    }
    return true;
  };

  let prevPos = vehicles.map((v) => `${v.position.x.toFixed(6)},${v.position.y.toFixed(6)}`);
  for (let frame = 0; frame < FRAMES; frame++) {
    updateVehicles(DT, world, { zoom: 1 });
    const nowPos = vehicles.map((v) => `${v.position.x.toFixed(6)},${v.position.y.toFixed(6)}`);
    vehicles.forEach((v, i) => {
      if (nowPos[i] !== prevPos[i]) moved[i]++;
      if (v.route !== prevRoute[i]) {
        recycles.count++;
        prevRoute[i] = v.route;
      }
      if (!roadCheck(v)) failures++; // occupied tile must be a road tile
      if (!floorRoadCheck(v)) failures++; // raw centerline must sit on a road tile
      if (!buildingOverNonRoadCheck(v)) failures++; // never on a non-road building tile
    });
    prevPos = nowPos;
  }

  return { fleet: vehicles, arrivals, recycles: recycles.count, cached: cachedRouteCount(), roadKeys };
}

// First run
const world = generateCity(CONFIG.SEED, CONFIG);
const vehicles = initVehicles(world, CONFIG);
check('fleet size >= 10', vehicles.length >= 10, `count=${vehicles.length}`);
check('all fleet travel at boot', vehicles.every((v) => v.state === 'travel'));
check('every vehicle has a route with >= 2 points', vehicles.every((v) => v.route && v.route.points.length >= 2));
check('type palette covers car/delivery van/taxi/bus',
  new Set(vehicles.map((v) => v.type)).size >= 4);
check('all vehicles unique ids', new Set(vehicles.map((v) => v.id)).size === vehicles.length);

// Determinism: two identical sims must produce identical outcome
const a = runSim(CONFIG.SEED);
const b = runSim(CONFIG.SEED);
check('same seed -> identical final positions',
  JSON.stringify(a.fleet.map((v) => v.position)) === JSON.stringify(b.fleet.map((v) => v.position)));
check('same seed -> identical route assignments',
  JSON.stringify(a.fleet.map((v) => v.route.goal)) === JSON.stringify(b.fleet.map((v) => v.route.goal)));
check('same seed -> identical cache size', a.cached === b.cached);

// Different seed should differ (movement is seeded, not constant)
const c = runSim(CONFIG.SEED + 1);
const d = runSim(CONFIG.SEED + 2);
check('different seeds -> different final positions',
  JSON.stringify(c.fleet.map((v) => v.position)) !== JSON.stringify(d.fleet.map((v) => v.position)));
check('arrivals happened (routes recycled, continuous motion)',
  a.recycles > 0 && a.fleet.every((v) => v.state === 'travel'));

console.log(`[verify] final cached routes: ${a.cached} / max 512 · recycles: ${a.recycles}`);
console.log(failures === 0 ? '[verify] ALL CHECKS PASSED' : `[verify] ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
