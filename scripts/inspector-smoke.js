/**
 * Headless smoke test for the entity inspector (src/ui/inspector.js).
 *
 * Verifies the acceptance criteria without a browser by providing a tiny DOM
 * shim (elements, style, events) and a fake Camera:
 *   - initInspector(world, camera, getVehicles) API surface
 *   - inspectAt() picks buildings by tile hit-test and citizens/vehicles by
 *     proximity
 *   - Panel (DOM overlay) opens with the right detail rows per entity type
 *   - Building with a company shows the full company section
 *   - Panel closes via the close button and close()
 *   - Canvas click -> camera.screenToWorld -> inspectAt conversion
 *   - Live refresh reflects mutated sim state (wealth)
 */
import { CONFIG } from '../src/core/config.js';
import { generateCity } from '../src/world/generate.js';
import { populateCitizens } from '../src/citizens/populate.js';
import { createEconomy } from '../src/economy/index.js';
import { initInspector, inspectAt, openEntity } from '../src/ui/inspector.js';

// --- Minimal DOM shim --------------------------------------------------------

class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.id = '';
    this.className = '';
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.textContent = '';
    this.innerHTML = '';
    this.scrollTop = 0;
    this._listeners = {};
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  fire(type, event = {}) {
    for (const fn of this._listeners[type] || []) fn(event);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
  }
}

const allEls = [];
const bodyEl = new FakeEl('body');
const headEl = new FakeEl('head');
const canvasEl = new FakeEl('canvas');
canvasEl.id = 'main-canvas';
const panelEl = new FakeEl('div');
panelEl.id = 'inspector-panel';
allEls.push(bodyEl, headEl, canvasEl, panelEl);

globalThis.document = {
  body: bodyEl,
  head: headEl,
  getElementById: (id) => (id === 'main-canvas' ? canvasEl : id === 'inspector-panel' ? panelEl : null),
  createElement: (tag) => {
    const el = new FakeEl(tag);
    allEls.push(el);
    return el;
  },
  querySelector: (sel) => (sel === 'canvas' ? canvasEl : null),
};
globalThis.window = { addEventListener: () => {} };

function rootChildren(el) {
  const out = [];
  for (const c of el.children) {
    out.push(c, ...rootChildren(c));
  }
  return out;
}
function findButton(el) {
  return rootChildren(el).find((e) => e.tagName === 'button');
}

// --- Fake camera (mirrors the real Camera math) ---------------------------------
const camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidth: 800,
  viewportHeight: 600,
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewportWidth / 2) / this.zoom + this.x,
      y: (sy - this.viewportHeight / 2) / this.zoom + this.y,
    };
  },
  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.viewportWidth / 2,
      y: (wy - this.y) * this.zoom + this.viewportHeight / 2,
    };
  },
};

// --- World boot ---------------------------------------------------------------
const world = generateCity(CONFIG.SEED, CONFIG);
const { city } = populateCitizens(world, CONFIG);
createEconomy(city, CONFIG);
const ts = city.tileSize || 32;

// A vehicle on the road (tile x=8 is a road column) so no building trumps it.
const vehicles = [
  { id: 1, kind: 'car', state: 'travel', tile: { x: 8.5, y: 4.5 }, speed: 40,
    origin: { name: 'Depot' }, destination: { name: 'Market St' }, occupant: null },
];

let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
}

function bodyText() {
  let out = '';
  for (const c of panelEl.children) {
    if (c.className === 'insp-head') {
      for (const hc of c.children) {
        out += hc.tagName === 'button' ? '' : (hc.textContent || '');
        if (hc.children) {
          for (const g of hc.children) out += g.textContent || '';
        }
      }
    }
    out += c.innerHTML || '';
  }
  return out;
}

// --- 1. API surface -------------------------------------------------------------
const inspector = initInspector(city, camera, () => vehicles);
check('initInspector returns handle', inspector && typeof inspector.close === 'function');
check('inspectAt exported', typeof inspectAt === 'function');
check('openEntity exported', typeof openEntity === 'function');
check('panel exists as DOM overlay element', panelEl.tagName === 'div' && panelEl.id === 'inspector-panel');

// --- 2. Building pick -----------------------------------------------------------
const home = world.buildings.find((b) => b.zone === 'residential');
const bX = (home.footprint.x + home.footprint.w / 2) * ts;
const bY = (home.footprint.y + home.footprint.h / 2) * ts;
const bPick = inspectAt(bX, bY);
check('building picked by tile hit-test', bPick && bPick.type === 'building', bPick && bPick.type);
check('panel opens (DOM overlay displayed)', panelEl.style.display === 'block');
let txt = bodyText();
check('building shows type + address', txt.includes('Residential') && txt.includes('Address'));
check('building shows occupants + residents + workers', txt.includes('Occupants') && txt.includes('Residents') && txt.includes('Workers'));
check('building shows capacity + condition', txt.includes('Capacity') && txt.includes('Condition'));
check('inspector open flag', inspector.isOpen() === true);

// --- 3. Building hosting a company shows the company section -----------------------
const coB = world.buildings.find((b) => b.zone !== 'residential');
inspectAt((coB.footprint.x + coB.footprint.w / 2) * ts, (coB.footprint.y + coB.footprint.h / 2) * ts);
txt = bodyText();
const coHost = city.companies.find((c2) => c2.buildingId === coB.id);
check('company section rendered', coHost && txt.includes('Company'), coHost ? coHost.name : 'no company');
check('company shows name + industry', coHost && txt.includes(coHost.name) && txt.includes('Industry'));
check('company shows employees by name', coHost && coHost.employeeRoster.length && txt.includes(coHost.employeeRoster[0].name));
check('company shows revenue/expenses/wages/profit',
  txt.includes('Revenue') && txt.includes('Expenses') && txt.includes('Wages') && txt.includes('Profit'));

// --- 4. Citizen pick (move one onto a road tile so no building trumps it) -----------
const c = city.citizens[0];
c.tile = { x: 24.5, y: 4.5 }; // road row y=8? no: off-block road-only cell (x=24 road col, y=4 inside block 0 row)
const c2 = city.citizens[1];
c2.tile = { x: 24.5, y: 20.5 };
const cPick = inspectAt(c.tile.x * ts, c.tile.y * ts + 0.01 * ts);
check('citizen picked by proximity', cPick && cPick.type === 'citizen', cPick && cPick.type);
txt = bodyText();
check('citizen shows name + age', txt.includes('Age') && txt.includes(c.name));
check('citizen shows job + employer', txt.includes('Job') && txt.includes('Employer'));
check('citizen shows home address', txt.includes('Home'));
check('citizen shows schedule stage + destination', txt.includes('Stage') && txt.includes('Destination'));
check('citizen shows wealth/money', txt.includes('Wealth'));
check('citizen shows current activity + path progress', txt.includes('Activity') && txt.includes('Path progress'));

// --- 5. Live refresh -----------------------------------------------------------------
c.wallet = 777;
inspector.refresh();
txt = bodyText();
check('live refresh surfaces changed wealth', txt.includes('777'), txt.slice(txt.indexOf('Wealth'), txt.indexOf('Wealth') + 40));

// --- 6. Vehicle pick ------------------------------------------------------------------
const v = vehicles[0];
const vPick = inspectAt(v.tile.x * ts, v.tile.y * ts);
check('vehicle picked by proximity', vPick && vPick.type === 'vehicle', vPick && vPick.type);
txt = bodyText();
check('vehicle shows id + type', txt.includes('ID') && txt.includes('Type'));
check('vehicle shows route origin/destination', txt.includes('Depot') && txt.includes('Market St'));
check('vehicle shows speed + occupant + state', txt.includes('Speed') && txt.includes('Occupant') && txt.includes('State'));

// --- 7. Close button + close API ---------------------------------------------------------
const btn = findButton(panelEl);
check('close button element created', !!btn);
if (btn) btn.fire('click', { preventDefault() {}, stopPropagation() {} });
check('close button hides panel', panelEl.style.display === 'none' && !inspector.isOpen());
inspectAt(bX, bY);
inspector.close();
check('close() hides panel and clears open flag', panelEl.style.display === 'none' && !inspector.isOpen());

// --- 7b. openEntity toolbar path (exact labels trim the same way the probe clicks) ----------
openEntity('citizen');
let t = bodyText();
check('openEntity(citizen) opens citizen detail', panelEl.style.display === 'block' && /(Age|Job)/.test(t),
  t.slice(t.indexOf('Age'), t.indexOf('Age') + 30));

openEntity('building');
t = bodyText();
check('openEntity(building) opens building detail', panelEl.style.display === 'block' && /(Address|Capacity)/.test(t));

openEntity('company');
t = bodyText();
check('openEntity(company) opens company detail', panelEl.style.display === 'block' && /(Revenue|Employees|Profit)/.test(t));

openEntity('vehicle');
t = bodyText();
check('openEntity(vehicle) opens vehicle detail', panelEl.style.display === 'block' && /(Speed|Route|Occupant)/.test(t));

// --- 8. Canvas click -> camera.screenToWorld -> inspectAt --------------------------------
const sp = camera.worldToScreen(bX, bY);
canvasEl.fire('pointerdown', { button: 0, clientX: sp.x, clientY: sp.y });
canvasEl.fire('click', { clientX: sp.x, clientY: sp.y });
check('canvas click opens inspector via camera conversion', inspector.isOpen());
txt = bodyText();
const clickedBuilding = world.buildings.find((b) => txt.includes(b.name));
check('canvas click pick matches building under cursor', !!clickedBuilding, clickedBuilding ? clickedBuilding.name : 'none');

// --- 9. Empty click closes the panel -----------------------------------------------------
inspector.close();
let far = null;
search: for (let ty = 0; ty < world.gridSize; ty += 4) {
  for (let tx = 0; tx < world.gridSize; tx += 4) {
    const wx2 = (tx + 0.5) * ts;
    const wy2 = (ty + 0.5) * ts;
    const inFp = world.buildings.some((b) =>
      tx >= b.footprint.x && tx < b.footprint.x + b.footprint.w &&
      ty >= b.footprint.y && ty < b.footprint.y + b.footprint.h);
    if (inFp) continue;
    const nearEntity = city.citizens.some((cit) => cit.tile && Math.hypot(cit.tile.x * ts - wx2, cit.tile.y * ts - wy2) < ts * 0.6)
      || vehicles.some((vv) => Math.hypot(vv.tile.x * ts - wx2, vv.tile.y * ts - wy2) < ts * 0.6);
    if (!nearEntity) { far = { x: wx2, y: wy2 }; break search; }
  }
}
check('an empty world point exists for close test', !!far);
if (far) {
  const res = inspectAt(far.x, far.y);
  check('inspectAt on empty point closes the panel', res === null && !inspector.isOpen() && panelEl.style.display === 'none');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);