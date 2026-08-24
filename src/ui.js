/**
 * src/ui.js — café inspection + accessibility UI layer.
 *
 * Adds the interaction-layer acceptance criteria on top of the renderer:
 *   1. Hover / click info cards — raycasts the live scene; hovering a named
 *      hotspot shows a period note, clicking pins it open.
 *   2. Camera presets — era-aware preset buttons that animate the orbit
 *      camera to composed viewpoints (counter, tables, music, menu...).
 *   3. Keyboard access — era buttons / slider / volume / mute are already
 *      focusable; this also enables OrbitControls' arrow-key panning on the
 *      canvas and keeps the preset buttons focusable.
 *   4. WebGL-unavailable fallback — a friendly overlay when the renderer
 *      cannot be created.
 *   5. prefers-reduced-motion — shortens / simplifies the timelapse via the
 *      shared setReducedMotion() controller.
 */
import * as THREE from 'three';
import { getActiveYear } from './eras/registry.js';
import { setReducedMotion } from './world/animation/timelapse.js';

// ---------------------------------------------------------------------------
// Period info cards — matched by walking the picked object's parent names.
// ---------------------------------------------------------------------------
const INFO = Object.freeze({
  1945: Object.freeze([
    { re: /(espresso|lever|grinder)/, title: 'Manual lever espresso', body: '1945: a hand-pulled lever machine and wall-mounted grinder. The barista works the brass lever by hand, hissing steam with every shot.' },
    { re: /(cash|register|till)/, title: 'Hand-crank cash register', body: '1945: a brass mechanical register with a hand-crank and pop-out drawer — ringing up a 7¢ coffee.' },
    { re: /(radio|wireless|dial)/, title: '1945 wireless valve radio', body: '1945: the café music source — a walnut valve wireless set on the counter, tuned to a warm AM band.' },
    { re: /(menu)/, title: '1945 menu board', body: 'Coffee 7¢, pie 15¢, milk 5¢ — ration-era café prices.' },
    { re: /(war bonds|ration|coca|coke|herald|newspaper|victory)/, title: 'Post-war wall dressing', body: '1945: “Buy War Bonds” posters, a sugar-ration notice and a V-E Day headline.' },
    { re: /(table|bentwood|Thonet|chair)/, title: 'Heavy oak tables', body: '1945: dark oak café tables and Thonet bentwood chairs, worn by decades of service.' },
    { re: /(patron|man|woman|figure)/, title: 'Post-war patrons', body: '1945: suits, victory-roll hair and hats — guests reading the paper over a coffee.' },
    { re: /(sconce|pendant|tungsten)/, title: 'Warm tungsten lighting', body: '1945: brass pendants and wall sconces cast a warm, low-wattage glow.' },
  ]),
  1965: Object.freeze([
    { re: /(espresso)/, title: 'Chrome espresso bar', body: '1965: a chrome-and-bakelite espresso machine with a glass dome and steam wands — mid-century espresso-bar style.' },
    { re: /(cash|register)/, title: 'Electric cash register', body: '1965: a round-key electric register with a receipt printer — faster than the hand crank.' },
    { re: /(jukebox)/, title: 'Chrome-and-glass jukebox', body: '1965: the café’s music source — a glowing arch-trim jukebox with a visible stack of colourful 45s.' },
    { re: /(menu)/, title: '1965 letterboard menu', body: 'Plastic letterboard: coffee 15¢, espresso 20¢, milkshakes 25¢, sandwiches 30–35¢.' },
    { re: /(travel|poster|instant|ad)/, title: '60s travel posters', body: '1965: bold travel and instant-coffee ads on the walls.' },
    { re: /(table|chair|melamine|tableware)/, title: 'Mid-century tables', body: '1965: teak tables with chrome splayed legs, molded chairs and pastel melamine cups.' },
    { re: /(patron|businessman|woman|teen|girl|man)/, title: 'Swinging-60s patrons', body: '1965: slim suits, shift dresses, beehives and leather jackets gathered at the jukebox.' },
    { re: /(sputnik|pendant|lamp)/, title: 'Sputnik pendant', body: '1965: a chrome sputnik pendant and warm café lamps over the tables.' },
  ]),
  1985: Object.freeze([
    { re: /(espresso)/, title: 'Boxy chrome espresso', body: '1985: a boxy chrome espresso machine with a digital keypad facade and warm cups.' },
    { re: /(drip|tower|decanter)/, title: 'Drip-brew tower', body: '1985: a chrome drip tower filling glass decanters on warmers.' },
    { re: /(pos|segment|dot.?matrix)/, title: 'Early electronic POS', body: '1985: an early electronic POS with a green segment display and dot-matrix customer screen.' },
    { re: /(boombox)/, title: 'Twin-cassette boombox', body: '1985: the music source — a silver twin-cassette boombox with VU meters on a shelf.' },
    { re: /(menu|lightbox)/, title: '1985 backlit menu', body: 'Backlit lightbox menu: fresh coffee 55¢, espresso 75¢, cappuccino 85¢.' },
    { re: /(arcade|neon blaster)/, title: 'Arcade corner', body: '1985: a “Neon Blaster” arcade cabinet and a CRT TV playing static.' },
    { re: /(table|laminate|vinyl|mug)/, title: 'Laminate tables', body: '1985: black laminate tables with tubular chrome legs and black vinyl chairs.' },
    { re: /(patron|jacket|teen|girl|man)/, title: '80s patrons', body: '1985: Members-Only jackets, perms and feathered hair, Walkman and pager in hand.' },
    { re: /(neon|track|glow)/, title: 'Neon + track lighting', body: '1985: pink and teal neon strips over a black-and-chrome room with track spots.' },
  ]),
  2005: Object.freeze([
    { re: /(espresso)/, title: 'Semi-auto espresso', body: '2005: a stainless E61-style semi-automatic machine with a PID temperature panel.' },
    { re: /(pos|terminal|touchscreen)/, title: 'Touchscreen POS', body: '2005: a touchscreen POS with a card-swipe reader beside the register.' },
    { re: /(crt|imac|order)/, title: 'CRT order station', body: '2005: a beige CRT iMac-style order station (dome base) — early computerised orders.' },
    { re: /(ipod|dock|cd)/, title: 'iPod dock + CDs', body: '2005: the music source — a white click-wheel iPod in a speaker dock, with CDs for sale.' },
    { re: /(menu)/, title: '2005 menu board', body: 'The Daily Grind: coffee $1.50–$2.50, lattes $2.25, fair-trade + organic.' },
    { re: /(table|banquette|tableware)/, title: 'Early-Wi-Fi seating', body: '2005: dark wood tables, iron legs, a plush banquette and paper to-go cups.' },
    { re: /(patron|person)/, title: '2005 patrons', body: '2005: bootcut jeans, flip phones, chunky earbuds and early laptops — the Wi-Fi café crowd.' },
    { re: /(pendant|halogen|track)/, title: 'Halogen + pendants', body: '2005: exposed-bulb pendants and a halogen track over the tables.' },
  ]),
  2025: Object.freeze([
    { re: /(espresso)/, title: 'Multi-boiler espresso', body: '2025: a sleek multi-boiler machine with a touchscreen and pressure/flow readouts.' },
    { re: /(pour.?over|gooseneck|v60|scale)/, title: 'Pour-over station', body: '2025: a gooseneck kettle, V60 drippers and a digital scale — third-wave precision.' },
    { re: /(batch|brewer|thermal|carafe)/, title: 'Batch brewer', body: '2025: a batch brewer filling insulated double-wall carafes.' },
    { re: /(ipad|pos|tap|contactless|reader)/, title: 'iPad POS + tap-to-pay', body: '2025: an iPad register with a contactless tap-to-pay reader and tablet order screens.' },
    { re: /(smart|speaker|phone|charging)/, title: 'Smart speaker + phone', body: '2025: the music source — a smartphone on a wireless charger streaming to a smart speaker.' },
    { re: /(menu)/, title: '2025 menu board', body: 'Minimal board: flat white $4.50–$5.50, cold brew $5, oat/almond milk +50¢.' },
    { re: /(communal|slab|stool|bentwood|tableware)/, title: 'Communal oak slab', body: '2025: a long communal oak table, designer stools, double-wall glass and keep-cups.' },
    { re: /(patron|laptop|smartwatch|gimbal|tote|phone)/, title: '2025 patrons', body: '2025: oversized fits, smartwatches, filming lattes and tote bags.' },
    { re: /(pendant|globe|linear|led)/, title: 'LED pendants', body: '2025: globe and linear LED pendants over a bright Japandi room.' },
  ]),
});

// ---------------------------------------------------------------------------
// Camera presets (per era). Each is a composed viewpoint inside the room.
// ---------------------------------------------------------------------------
const PRESETS = Object.freeze({
  1945: Object.freeze([
    { label: 'Counter', pos: [-1.9, 1.5, 1.7], target: [-2.7, 0.95, 0.0] },
    { label: 'Tables', pos: [2.2, 1.7, 2.4], target: [0.0, 0.9, 0.0] },
    { label: 'Music', pos: [2.0, 1.5, 2.3], target: [1.6, 1.4, 1.5] },
    { label: 'Menu', pos: [-1.5, 1.9, 1.9], target: [0.5, 1.8, -2.3] },
  ]),
  1965: Object.freeze([
    { label: 'Counter', pos: [-1.9, 1.6, 1.9], target: [-2.8, 0.95, 0.4] },
    { label: 'Tables', pos: [2.1, 1.7, 2.3], target: [-0.1, 0.8, 0.1] },
    { label: 'Music', pos: [1.2, 1.4, 2.1], target: [2.4, 1.3, 0.3] },
    { label: 'Menu', pos: [-1.4, 1.9, 1.8], target: [-2.6, 1.6, -2.3] },
  ]),
  1985: Object.freeze([
    { label: 'Counter', pos: [-1.8, 1.6, 1.9], target: [-2.9, 0.95, 0.3] },
    { label: 'Tables', pos: [2.0, 1.6, 2.3], target: [0.1, 0.8, 0.2] },
    { label: 'Music', pos: [0.7, 1.5, 1.9], target: [1.7, 1.3, -2.2] },
    { label: 'Arcade', pos: [1.6, 1.6, 1.7], target: [2.6, 1.0, -1.9] },
  ]),
  2005: Object.freeze([
    { label: 'Counter', pos: [-1.8, 1.6, 1.9], target: [-2.9, 0.95, 0.6] },
    { label: 'Tables', pos: [2.1, 1.7, 2.3], target: [0.0, 0.9, 0.1] },
    { label: 'Music', pos: [-1.0, 1.4, 2.1], target: [-3.0, 1.1, 1.6] },
    { label: 'Menu', pos: [-1.5, 1.9, 1.8], target: [-1.4, 1.85, -2.3] },
  ]),
  2025: Object.freeze([
    { label: 'Counter', pos: [-1.8, 1.6, 1.9], target: [-2.9, 0.95, 0.5] },
    { label: 'Tables', pos: [2.2, 1.7, 2.4], target: [0.0, 0.9, 0.3] },
    { label: 'Music', pos: [-1.0, 1.4, 2.1], target: [-3.0, 1.1, -0.8] },
    { label: 'Menu', pos: [-1.5, 1.9, 1.8], target: [-1.4, 1.85, -2.3] },
  ]),
});

let anim = null;
let infoCard = null;
let cardPinned = false;
let presetsBuilt = false;

/** True while a preset camera animation is running (frame loop uses this). */
export function isPresetAnimating() {
  return anim !== null;
}

/** Advance the preset camera animation toward its target. */
export function updateUI(ctx, delta) {
  if (!anim) return;
  anim.t += THREE.MathUtils.clamp((delta || 0.016) / anim.dur, 0, 1);
  const t = easeInOut(THREE.MathUtils.clamp(anim.t, 0, 1));
  ctx.camera.position.set(
    THREE.MathUtils.lerp(anim.p0[0], anim.p1[0], t),
    THREE.MathUtils.lerp(anim.p0[1], anim.p1[1], t),
    THREE.MathUtils.lerp(anim.p0[2], anim.p1[2], t)
  );
  ctx.controls.target.set(
    THREE.MathUtils.lerp(anim.t0[0], anim.t1[0], t),
    THREE.MathUtils.lerp(anim.t0[1], anim.t1[1], t),
    THREE.MathUtils.lerp(anim.t0[2], anim.t1[2], t)
  );
  if (anim.t >= 1) anim = null;
}

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

/** Build the info-card overlay element (idempotent). */
function ensureInfoCard() {
  if (infoCard) return infoCard;
  infoCard = document.createElement('div');
  infoCard.id = 'info-card';
  infoCard.setAttribute('role', 'status');
  infoCard.setAttribute('aria-live', 'polite');
  infoCard.style.cssText =
    'position:fixed;z-index:30;pointer-events:none;max-width:280px;' +
    'padding:10px 12px;border-radius:8px;' +
    'background:rgba(14,20,28,0.9);border:1px solid rgba(236,197,122,0.5);' +
    'color:#f2ead8;font:12px/1.4 ui-sans-serif,system-ui,sans-serif;' +
    'box-shadow:0 4px 18px rgba(0,0,0,0.45);opacity:0;transition:opacity .12s ease;' +
    'transform:translate(-50%,-110%);';
  document.body.appendChild(infoCard);
  return infoCard;
}

/** Set the info card content + position; hide when `hit` is null. */
function showInfo(hit, px, py) {
  const card = ensureInfoCard();
  const year = getActiveYear();
  const entries = INFO[year];
  if (!hit || !entries) {
    card.style.opacity = '0';
    return;
  }
  // Walk the object's parent chain to collect names.
  const names = [];
  let node = hit.object;
  while (node) {
    if (node.name) names.push(String(node.name));
    node = node.parent;
  }
  const joined = names.join(' ').toLowerCase();
  let entry = null;
  for (const e of entries) {
    if (e.re.test(joined)) { entry = e; break; }
  }
  if (!entry) {
    card.style.opacity = '0';
    return;
  }
  card.innerHTML = `<strong>${entry.title}</strong><br><span>${entry.body}</span>`;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const x = THREE.MathUtils.clamp(px, 120, w - 120);
  const y = THREE.MathUtils.clamp(py, 90, h - 60);
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
  card.style.opacity = '1';
}

/** Raycast the active scene and return the nearest hit (or null). */
function pickNearest(ctx, px, py) {
  const el = ctx.renderer.domElement;
  const w = el?.clientWidth || window.innerWidth;
  const h = el?.clientHeight || window.innerHeight;
  const ndc = new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, ctx.camera);
  const hits = ray.intersectObjects(ctx.scene.children, true);
  return hits.length ? hits[0] : null;
}

/** Attach pointer hover + click handlers to the canvas. */
function wirePick(ctx) {
  const el = ctx.renderer.domElement;
  if (!el) return;
  el.addEventListener('pointermove', (e) => {
    if (cardPinned) return;
    const hit = pickNearest(ctx, e.clientX, e.clientY);
    showInfo(hit, e.clientX, e.clientY);
  });
  el.addEventListener('pointerdown', (e) => {
    const hit = pickNearest(ctx, e.clientX, e.clientY);
    if (hit) {
      cardPinned = !cardPinned;
      showInfo(cardPinned ? hit : null, e.clientX, e.clientY);
    } else {
      cardPinned = false;
      showInfo(null, 0, 0);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cardPinned = false;
      if (infoCard) infoCard.style.opacity = '0';
    }
  });
}

/** Build era-aware camera preset buttons. */
function buildPresets(ctx) {
  if (presetsBuilt) return;
  presetsBuilt = true;
  const bar = document.getElementById('cam-presets');
  if (!bar) return;
  const year = getActiveYear();
  const list = PRESETS[year] || PRESETS[2025];
  bar.textContent = '';
  for (const p of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn';
    btn.dataset.preset = p.label;
    btn.textContent = p.label;
    btn.addEventListener('click', () => applyPreset(ctx, p));
    bar.appendChild(btn);
  }
}

/** Animate the camera toward a preset viewpoint. */
export function applyPreset(ctx, preset) {
  anim = {
    p0: [ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z],
    t0: [ctx.controls.target.x, ctx.controls.target.y, ctx.controls.target.z],
    p1: preset.pos,
    t1: preset.target,
    t: 0,
    dur: 0.9,
  };
}

/** Rebuild preset buttons whenever the era changes. */
export function rebuildPresets(ctx) {
  presetsBuilt = false;
  buildPresets(ctx);
}

/** Friendly WebGL-unavailable fallback overlay. */
export function showWebGLFallback() {
  const el = document.getElementById('webgl-fallback');
  if (!el) return;
  el.hidden = false;
  console.warn('[cafe] WebGL is unavailable — showing the fallback message.');
}

/** Honour prefers-reduced-motion by shortening / simplifying transitions. */
export function applyReducedMotion() {
  let reduced = false;
  if (typeof matchMedia === 'function') {
    try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
  }
  setReducedMotion(reduced);
  return reduced;
}

/**
 * Full UI setup — called once from main.js after the scene context is ready.
 */
export function setupUI(ctx) {
  ensureInfoCard();
  buildPresets(ctx);
  wirePick(ctx);
  applyReducedMotion();
  // Enable OrbitControls keyboard panning on the canvas.
  try { ctx.controls.listenToKeyEvents(ctx.renderer.domElement); } catch {}
}