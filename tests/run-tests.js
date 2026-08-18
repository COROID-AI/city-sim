'use strict';
// Headless verification for CitySim.
// 1) vm-compiles every js module (syntax gate).
// 2) Loads the logic modules into a shared global and runs assertions.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const ALL_JS = [
  'js/config.js', 'js/utils.js', 'js/city.js', 'js/pathfinding.js',
  'js/buildings.js', 'js/companies.js', 'js/citizens.js', 'js/vehicles.js',
  'js/economy.js', 'js/sim.js', 'js/camera.js', 'js/renderer.js',
  'js/minimap.js', 'js/hud.js', 'js/inspector.js', 'js/main.js',
  'server.js'
];

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('ok - ' + msg);
  } else {
    failures++;
    console.error('FAIL - ' + msg);
  }
}
function assertClose(a, b, eps, msg) {
  assert(Math.abs(a - b) <= eps, msg + ' (' + a + ' vs ' + b + ')');
}

// ---- Syntax gate ----
console.log('Syntax gate: vm-compiling every js module');
for (const f of ALL_JS) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  try {
    new vm.Script(code, { filename: f });
    console.log('ok - compiles ' + f);
  } catch (e) {
    failures++;
    console.error('FAIL - syntax error in ' + f + ': ' + e.message);
  }
}

// ---- Load modules ----
console.log('Loading modules');
const sandbox = {};
sandbox.globalThis = sandbox;
sandbox.window = undefined;
sandbox.console = console;
sandbox.Math = Math;
sandbox.Date = Date;
sandbox.JSON = JSON;
sandbox.Number = Number;
sandbox.String = String;
sandbox.Array = Array;
sandbox.Object = Object;
sandbox.Uint8Array = Uint8Array;
sandbox.Float32Array = Float32Array;
sandbox.Int32Array = Int32Array;
sandbox.Map = Map;
sandbox.Set = Set;
sandbox.Infinity = Infinity;
sandbox.NaN = NaN;
sandbox.isNaN = isNaN;
sandbox.parseFloat = parseFloat;
sandbox.parseInt = parseInt;
vm.createContext(sandbox);

const LOAD = ALL_JS.slice(0, ALL_JS.length - 1); // everything except server.js
for (const f of LOAD) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}
const CS = sandbox.CitySim;

// ---- World generation ----
console.log('World generation');
const cfg = CS.config;
const city = CS.city.generate(cfg);
const buildings = CS.buildings.create(cfg, city);
const companies = CS.companies.create(cfg, city, buildings);
const citizens = CS.citizens.create(cfg, city, buildings, companies);
const vehicles = CS.vehicles.create(cfg, city, buildings, companies, citizens);
const ctx = {
  city: city,
  buildings: buildings,
  companies: companies,
  citizens: citizens,
  vehicles: vehicles,
  config: cfg,
  rng: CS.utils.mulberry32(cfg.seed + 7)
};

assert(buildings.length >= 20, 'AC2: >=20 buildings (got ' + buildings.length + ')');
assert(citizens.length >= 50, 'AC2: >=50 citizens (got ' + citizens.length + ')');
assert(vehicles.length >= 10, 'AC2: >=10 vehicles (got ' + vehicles.length + ')');

const sim = CS.sim.create(cfg);
const economy = CS.economy.init(cfg);
CS.sim.attach(sim, ctx, economy);
for (const c of citizens) CS.citizens.syncToTime(c, sim.min, ctx);
for (const v of vehicles) {
  if (v.kind !== 'bus') CS.vehicles.startRoute(v, sim, ctx);
}

// ---- Movement at load (AC1/AC2) ----
let movingCitizens = 0;
for (const c of citizens) if (c.current.activity === 'TRAVEL') movingCitizens++;
let movingVehicles = 0;
for (const v of vehicles) if (v.path.length) movingVehicles++;
assert(movingCitizens > 0, 'AC1: citizens moving at load (got ' + movingCitizens + ')');
assert(movingVehicles >= 10, 'AC2: >=10 vehicles moving at load (got ' + movingVehicles + ')');

// ---- Pathfinding ----
console.log('Pathfinding');
const roadA = city.roadTiles[0];
const roadB = city.roadTiles[Math.floor(city.roadTiles.length / 2)];
const vPath = CS.pathfinding.findPath(city, roadA.x, roadA.y, roadB.x, roadB.y, city.isPassableVehicle);
assert(!!vPath && vPath.length > 1, 'AC9: vehicle path found between road tiles');
if (vPath) {
  let valid = true;
  for (const step of vPath) if (!city.isRoad(step.x, step.y)) { valid = false; break; }
  assert(valid, 'AC9: every vehicle path step is a road tile');
}

const b1 = buildings[0];
const b2 = buildings[Math.floor(buildings.length / 2)];
const cPath = CS.pathfinding.findPath(city, b1.entrance.x, b1.entrance.y, b2.entrance.x, b2.entrance.y, city.isPassableCitizen);
assert(!!cPath && cPath.length > 1, 'AC9: citizen path found between building entrances');
if (cPath) {
  let valid = true;
  for (const step of cPath) if (!city.isPassableCitizen(step.x, step.y)) { valid = false; break; }
  assert(valid, 'AC9: every citizen path step is passable for citizens');
}

// ---- Citizen schedules (AC4): 30+ hour fast-forward ----
console.log('Citizen schedules');
const visited = citizens.map(() => ({}));
for (let step = 0; step < 32; step++) {
  CS.sim.advanceSimMinutes(sim, 60);
  for (const c of citizens) {
    visited[c.id][c.current.activity] = true;
  }
}
let scheduleOk = true;
for (const c of citizens) {
  if (c.workId != null) {
    if (!visited[c.id].WORK || !visited[c.id].ENTERTAINMENT || !(visited[c.id].HOME || visited[c.id].SLEEP)) {
      scheduleOk = false;
      break;
    }
  } else {
    if (!visited[c.id].ENTERTAINMENT || !(visited[c.id].HOME || visited[c.id].SLEEP)) {
      scheduleOk = false;
      break;
    }
  }
}
assert(scheduleOk, 'AC4: each citizen cycles through work/entertainment/home-sleep');

// Night: keep stepping until an overnight hour, then assert most are home/asleep.
let nightHome = 0;
{
  let guard = 0;
  while (guard++ < 30) {
    CS.sim.advanceSimMinutes(sim, 60);
    const hour = sim.getHour();
    if (hour >= 0 && hour < 6) break;
  }
  nightHome = 0;
  for (const c of citizens) {
    if (c.current.activity === 'SLEEP' || c.current.activity === 'HOME') nightHome++;
  }
}
assert(nightHome >= citizens.length * 0.6, 'AC4: most citizens asleep/home at night (got ' + nightHome + ')');

// Midday: keep stepping until work hours, then assert most employed citizens work.
let working = 0, employed = 0;
{
  let guard = 0;
  while (guard++ < 40) {
    CS.sim.advanceSimMinutes(sim, 60);
    const hour = sim.getHour();
    if (hour >= 9 && hour <= 11) break;
  }
  working = 0;
  employed = 0;
  for (const c of citizens) {
    if (c.workId != null) {
      employed++;
      if (c.current.activity === 'WORK') working++;
    }
  }
}
assert(working >= employed * 0.5, 'AC4: most employed citizens working mid-morning (got ' + working + '/' + employed + ')');

// ---- Economy (AC5) ----
console.log('Economy');
const budgetBefore = economy.budget;
const histBefore = economy.history.length;
for (let step = 0; step < 3; step++) CS.sim.advanceSimMinutes(sim, 60);
assert(economy.history.length >= histBefore + 3, 'AC5: economy ticked each of 3 hours');
assert(economy.budget !== budgetBefore, 'AC5: budget changed over 3 hours');
assert(economy.employmentRate >= 0 && economy.employmentRate <= 1, 'AC5: employment rate in [0,1] (got ' + economy.employmentRate.toFixed(3) + ')');
let someCompanyHistory = false;
for (const co of companies) if (co.profitHistory.length > 0) { someCompanyHistory = true; break; }
assert(someCompanyHistory, 'AC5: companies track profit history');

// ---- Day/night (AC3) ----
console.log('Day/night');
assert(CS.sim.sunFactor(2) < CS.sim.sunFactor(12), 'AC3: sunFactor distinct at 02:00 vs 12:00');
const tintNight = CS.renderer.tintForHour(2);
const tintDay = CS.renderer.tintForHour(12);
assert(tintNight.a > tintDay.a, 'AC3: night tint alpha > day tint alpha for 02:00 vs 12:00');

// ---- Camera / minimap (AC7) ----
console.log('Camera / minimap');
const cam = CS.camera.create(800, 600);
cam.x = 100; cam.y = 50; cam.zoom = 1;
const sp = CS.camera.worldToScreen(cam, 1234, 2345);
const wp = CS.camera.screenToWorld(cam, sp.x, sp.y);
assertClose(wp.x, 1234, 0.001, 'AC7: camera world<->screen round-trip x');
assertClose(wp.y, 2345, 0.001, 'AC7: camera world<->screen round-trip y');
CS.camera.clampToBounds(cam, city.worldWidth, city.worldHeight);
assert(cam.x >= 0 && cam.y >= 0 && cam.x + cam.viewW / cam.zoom <= city.worldWidth + 0.001, 'AC7: camera clamped within world bounds');

const mm = { size: 220, worldW: city.worldWidth, worldH: city.worldHeight };
const m1 = CS.minimap.worldToMap(mm, 1234, 5678);
const m2 = CS.minimap.mapToWorld(mm, m1.x, m1.y);
assertClose(m2.x, 1234, 0.6, 'AC7: minimap world<->map round-trip x');
assertClose(m2.y, 5678, 0.6, 'AC7: minimap world<->map round-trip y');

const cam2 = CS.camera.create(800, 600);
cam2.x = 100; cam2.y = 50; cam2.zoom = 1;
const tl = CS.minimap.worldToMap(mm, cam2.x, cam2.y);
const br = CS.minimap.worldToMap(mm, cam2.x + cam2.viewW / cam2.zoom, cam2.y + cam2.viewH / cam2.zoom);
assert(tl.x >= 0 && tl.y >= 0 && br.x <= mm.size + 0.001 && br.y <= mm.size + 0.001, 'AC7: viewport rect within minimap bounds');
assertClose(tl.x, CS.minimap.worldToMap(mm, cam2.x, cam2.y).x, 0.001, 'AC7: rect top-left matches camera mapping');

CS.minimap.handlePointer(mm, cam2, 110, 110, city.worldWidth, city.worldHeight);
const target = CS.minimap.mapToWorld(mm, 110, 110);
const centerX = cam2.x + cam2.viewW / (2 * cam2.zoom);
const centerY = cam2.y + cam2.viewH / (2 * cam2.zoom);
assertClose(centerX, target.x, 1, 'AC7: click-to-jump centers camera on target x');
assertClose(centerY, target.y, 1, 'AC7: click-to-jump centers camera on target y');

// ---- Picking (finding) ----
console.log('Picking');
const pickCam = CS.camera.create(800, 600);
pickCam.x = 0; pickCam.y = 0; pickCam.zoom = 1;
const testCitizen = citizens[0];
testCitizen.current.pos.x = 400; testCitizen.current.pos.y = 300;
const pickC = CS.inspector.pickAt(400, 300, pickCam, ctx, cfg);
assert(pickC && pickC.kind === 'citizen' && pickC.entity.id === testCitizen.id, 'picking: nearest citizen within radius');
const pickV = CS.inspector.pickAt(400, 300, pickCam, ctx, cfg);
assert(pickV && (pickV.kind === 'citizen' || pickV.kind === 'vehicle'), 'picking: entity found at center');

// building fallback: click the center tile of a large building footprint,
// far from any standing citizen
const farCam = CS.camera.create(800, 600);
farCam.x = 0; farCam.y = 0; farCam.zoom = 1;
const bigBuilding = buildings.filter((b) => b.w >= 3 && b.h >= 3).sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
const centerTile = {
  x: bigBuilding.x + Math.floor(bigBuilding.w / 2),
  y: bigBuilding.y + Math.floor(bigBuilding.h / 2)
};
const cWorld = city.tileToWorld(centerTile.x, centerTile.y);
const cScreen = CS.camera.worldToScreen(farCam, cWorld.x, cWorld.y);
const pickB = CS.inspector.pickAt(cScreen.x, cScreen.y, farCam, ctx, cfg);
assert(pickB && pickB.kind === 'building', 'picking: building fallback works');

// ---- file:// compliance (finding) ----
console.log('file:// compliance');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert(!/type=["']module["']/.test(html), 'file://: no ES module script tags in index.html');
assert(!/https?:\/\//.test(html), 'file://: no external http(s) URLs in index.html');
assert(!/fetch\(|XMLHttpRequest|@import\s+url/.test(html), 'file://: no runtime external loading in index.html');
const importExportRe = /\b(import|export)\b/;
let noModules = true;
for (const f of LOAD) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (importExportRe.test(code)) { noModules = false; console.error('FAIL - ES module token in ' + f); }
}
assert(noModules, 'file://: no import/export tokens in any js module');

// ---- HUD data-testid presence (AC6) ----
for (const id of ['hud-population', 'hud-employment', 'hud-time', 'hud-budget']) {
  assert(html.indexOf('data-testid="' + id + '"') !== -1, 'AC6: data-testid ' + id + ' present');
}
assert(CS.utils.formatTime(7 * 60 + 30) === '07:30', 'AC6: formatTime produces HH:MM');

console.log('');
if (failures === 0) {
  console.log('ALL TESTS PASSED');
  process.exit(0);
} else {
  console.error(failures + ' test(s) failed');
  process.exit(1);
}