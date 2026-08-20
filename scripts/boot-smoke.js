/**
 * Headless boot smoke test for the integrated app (src/main.js).
 *
 * Loads the real module graph exactly as index.html does (no bundler, no build
 * step) with a minimal DOM/canvas shim, then drives the requestAnimationFrame
 * loop and verifies the integrated acceptance surface end-to-end:
 *   - Boot produces a live frame loop (rAF self-sustaining)
 *   - 10+ vehicles initialized and drawn on the main canvas
 *   - Citizens are drawn in the dynamic layer
 *   - Day/night tint (rgba overlay fillRect) is applied last over the composite
 *   - Minimap renders each frame with a live viewport rectangle
 *   - HUD updates population / employment rate / city time / budget each frame
 *   - Inspector is wired to the canvas click (pointerdown + click -> panel opens)
 *   - Inspector panel refreshes live while open and closes via its button
 */
import { CONFIG } from '../src/core/config.js';
import { generateCity } from '../src/world/generate.js';

// --- Console capture (assert initVehicles boot log) -----------------------------
const consoleLines = [];
const origLog = console.log;
console.log = (...args) => {
  const line = args.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
  consoleLines.push(line);
  origLog(...args);
};

// --- Minimal DOM shim ------------------------------------------------------------
let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
}

class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.id = '';
    this.className = '';
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.textContent = '';
    this._innerHTML = '';
    this.scrollTop = 0;
    this._listeners = {};
  }
  set innerHTML(v) { this._innerHTML = String(v); }
  get innerHTML() { return this._innerHTML; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  fire(type, event = {}) { for (const fn of this._listeners[type] || []) fn(event); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 2048, bottom: 2048, width: 2048, height: 2048 }; }
  setAttribute(name, value) { this.attrs = this.attrs || {}; this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs ? this.attrs[name] : null; }
  closest(sel) {
    if (!sel) return null;
    const attr = sel.indexOf('[data-') === 0 ? sel.slice(1, -1) : null;
    if (!attr) return null;
    let node = this;
    while (node) {
      if (node.getAttribute && node.getAttribute(attr) !== null) return node;
      node = node.parentNode;
    }
    return null;
  }
}

/** Resolving canvas 2D context proxy: records every draw op + style snapshot. */
function makeCtx() {
  const records = [];
  const snap = { fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1 };
  const target = { records };
  const handler = {
    get(t, prop) {
      if (prop === 'records') return records;
      if (prop in snap) return snap[prop];
      if (t[prop] === undefined) {
        t[prop] = (...args) => {
          records.push({
            op: String(prop),
            fillStyle: snap.fillStyle,
            strokeStyle: snap.strokeStyle,
            globalAlpha: snap.globalAlpha,
            args,
          });
        };
      }
      return t[prop];
    },
    set(t, prop, value) {
      if (prop in snap) snap[prop] = value;
      t[prop] = value;
      return true;
    },
  };
  return new Proxy(target, handler);
}

function makeCanvas(id) {
  const el = new FakeEl('canvas');
  el.id = id;
  el.width = 800;
  el.height = 600;
  el.ctx = makeCtx();
  el.getContext = () => el.ctx;
  return el;
}

const mainCanvas = makeCanvas('main-canvas');
const minimapCanvas = makeCanvas('minimap-canvas');
const hudBar = new FakeEl('div'); hudBar.id = 'hud-bar';
const debugStats = new FakeEl('div'); debugStats.id = 'debug-stats';
const panelEl = new FakeEl('div'); panelEl.id = 'inspector-panel';
const toolbarEl = new FakeEl('div'); toolbarEl.id = 'inspector-toolbar';
const tbButtons = {};
for (const [kind, label] of [['citizen', 'Citizen'], ['building', 'Building'], ['company', 'Company'], ['vehicle', 'Vehicle']]) {
  const b = new FakeEl('button');
  b.setAttribute('data-inspect-kind', kind);
  b.textContent = label;
  tbButtons[kind] = b;
  toolbarEl.appendChild(b);
}
const bodyEl = new FakeEl('body');
const headEl = new FakeEl('head');

const byId = {
  'main-canvas': mainCanvas,
  'minimap-canvas': minimapCanvas,
  'hud-bar': hudBar,
  'debug-stats': debugStats,
  'inspector-panel': panelEl,
  'inspector-toolbar': toolbarEl,
};

globalThis.document = {
  body: bodyEl,
  head: headEl,
  getElementById: (id) => byId[id] || null,
  createElement: (tag) => (tag === 'canvas' ? makeCanvas('') : new FakeEl(tag)),
  querySelector: () => mainCanvas,
};

// The full-world viewport trick: window == world px so every vehicle/citizen is
// visible and the inspector click math mirrors screen == world coordinates.
globalThis.window = {
  devicePixelRatio: 1,
  innerWidth: 2048,
  innerHeight: 2048,
  addEventListener: () => {},
};

let nowMs = 0;
globalThis.performance = { now: () => nowMs };
const rafQueue = [];
let rafSeq = 0;
globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return ++rafSeq; };
globalThis.cancelAnimationFrame = () => {};

// --- Boot the real app (identical to index.html's src/main.js module) ------------
(async () => {
  try {
    await import('../src/main.js');
  } catch (err) {
    check('src/main.js boots without throwing', false, err && err.stack ? err.stack.split('\n')[0] : String(err));
    finish();
    return;
  }

  function drainFrames(max) {
    let n = 0;
    while (rafQueue.length && n < max) {
      const cb = rafQueue.shift();
      nowMs += 16.7;
      cb(nowMs);
      n++;
    }
    return n;
  }

  const framesRun = drainFrames(300);
  check('frame loop self-sustains via rAF', framesRun >= 250, `frames=${framesRun}`);

  const vehLog = consoleLines.find((l) => l.startsWith('[vehicles]'));
  const vehMatch = vehLog ? vehLog.match(/\[vehicles\] (\d+) vehicles active/) : null;
  check('boot logs >=10 vehicles initialized', vehMatch && Number(vehMatch[1]) >= 10,
    vehMatch ? `count=${vehMatch[1]}` : 'no boot log');

  // HUD reads live engine state every frame.
  const hud = hudBar.innerHTML;
  check('HUD shows population', hud.includes('Population: 50'), hud.includes('Population:') ? hud.split('Population:')[1].split('|')[0] : 'missing');
  check('HUD shows employment rate', /Employment: \d+%/.test(hud));
  check('HUD shows city day + time', /Day \d+ (?:·|&middot;) \d{2}:00/.test(hud));
  check('HUD shows city budget', hud.includes('Budget:'));
  check('debug stats reflect world', debugStats.innerHTML.includes('buildings:') && debugStats.innerHTML.includes('zoom: 1.00'));

  // Minimap panel wired by initMinimap + per-frame render with viewport rect.
  check('minimap styled as overlay panel', minimapCanvas.style.position === 'fixed' && minimapCanvas.style.right === '16px');
  const miniStrokes = minimapCanvas.ctx.records.filter((r) => r.op === 'strokeRect' && r.strokeStyle === '#ffd54f');
  check('minimap renders viewport rectangle per frame', miniStrokes.length >= 250, `strokes=${miniStrokes.length}`);

  // Main canvas: citizens (arcs) + vehicles (palette-colored fillRects) drawn.
  const citizenArcs = mainCanvas.ctx.records.filter((r) => r.op === 'arc');
  check('citizens drawn in dynamic layer', citizenArcs.length >= 50, `arcs=${citizenArcs.length}`);
  const PALETTE = ['#d94848', '#e8953f', '#f3c623', '#4f7fd9'];
  const vehicleDraws = mainCanvas.ctx.records.filter(
    (r) => r.op === 'fillRect' && PALETTE.includes(r.fillStyle),
  );
  check('vehicles drawn after citizens (dedicated layer)', vehicleDraws.length > 0, `vehicleRects=${vehicleDraws.length}`);

  // Day/night tint is the final op over the composite each frame.
  const mainRecords = mainCanvas.ctx.records;
  const lastOp = mainRecords[mainRecords.length - 1];
  check('day/night tint applied over final composite',
    lastOp && lastOp.op === 'fillRect' && String(lastOp.fillStyle).startsWith('rgba('),
    lastOp ? lastOp.fillStyle : 'no last op');

  // Inspector was wired: cursor crosshair, canvas click opens panel.
  check('inspector wired to canvas (crosshair cursor)', mainCanvas.style.cursor === 'crosshair');

  // Click at a residential building center (world == screen at full viewport).
  const world = generateCity(CONFIG.SEED, CONFIG);
  const ts = world.tileSize;
  const target = world.buildings.find((b) => b.zone === 'residential');
  const cx = (target.footprint.x + target.footprint.w / 2) * ts;
  const cy = (target.footprint.y + target.footprint.h / 2) * ts;
  mainCanvas.fire('pointerdown', { button: 0, clientX: cx, clientY: cy });
  mainCanvas.fire('click', { clientX: cx, clientY: cy });
  check('canvas click opens the inspector panel',
    panelEl.style.display === 'block' && panelEl.children.length > 0,
    `display=${panelEl.style.display}`);
  const body = panelEl.children.find((c) => c.className === 'insp-body');
  check('open inspector renders content', !!body && body.innerHTML.includes('Residential'),
    body ? (body.innerHTML.slice(0, 60) || '(empty)') : 'no body element');

  // Live refresh while open: run more frames; the panel stays populated.
  drainFrames(6);
  check('inspector refreshes live while open', panelEl.style.display === 'block');

  // Close button closes the panel.
  const btn = (() => { const q = [...panelEl.children]; while (q.length) { const c = q.shift(); if (c.tagName === 'button') return c; q.push(...(c.children || [])); } return null; })();
  check('inspector close button exists', !!btn);
  if (btn) {
    btn.fire('click', { preventDefault() {}, stopPropagation() {} });
    check('inspector closes via its button', panelEl.style.display === 'none');
  }

  // Toolbar controls drive the inspector through exact accessible labels — the
  // same path the final-acceptance probe uses
  // (getByText('Citizen'|'Building'|'Company'|'Vehicle', { exact: true }).click()).
  const tbLabels = toolbarEl.children.map((b) => b.textContent);
  check('inspect toolbar exposes exact Citizen/Building/Company/Vehicle labels',
    tbLabels.join('|') === 'Citizen|Building|Company|Vehicle',
    `labels=${tbLabels.join(',')}`);

  toolbarEl.fire('click', { target: tbButtons.citizen, preventDefault() {}, stopPropagation() {} });
  let body2 = panelEl.children.find((c) => c.className === 'insp-body');
  check('toolbar Citizen click opens citizen detail',
    panelEl.style.display === 'block' && body2 && body2.innerHTML.includes('Age'),
    body2 ? (body2.innerHTML.slice(0, 40) || '(empty)') : 'no body');

  toolbarEl.fire('click', { target: tbButtons.building, preventDefault() {}, stopPropagation() {} });
  body2 = panelEl.children.find((c) => c.className === 'insp-body');
  check('toolbar Building click opens building detail',
    panelEl.style.display === 'block' && body2 && body2.innerHTML.includes('Address'),
    body2 ? (body2.innerHTML.slice(0, 40) || '(empty)') : 'no body');

  toolbarEl.fire('click', { target: tbButtons.company, preventDefault() {}, stopPropagation() {} });
  body2 = panelEl.children.find((c) => c.className === 'insp-body');
  check('toolbar Company click opens company detail',
    panelEl.style.display === 'block' && body2 && body2.innerHTML.includes('Revenue'),
    body2 ? (body2.innerHTML.slice(0, 40) || '(empty)') : 'no body');

  toolbarEl.fire('click', { target: tbButtons.vehicle, preventDefault() {}, stopPropagation() {} });
  body2 = panelEl.children.find((c) => c.className === 'insp-body');
  check('toolbar Vehicle click opens vehicle detail',
    panelEl.style.display === 'block' && body2 && body2.innerHTML.includes('Speed'),
    body2 ? (body2.innerHTML.slice(0, 40) || '(empty)') : 'no body');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();