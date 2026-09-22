#!/usr/bin/env node
/**
 * tools/verify-static.mjs — deterministic structural gate for rocket-launch.html.
 *
 * DEV-ONLY. Not part of the deliverable; it uses Node builtins only (no network, no browser) and is
 * authoritative whenever the browser gate cannot run.
 *
 * It asserts:
 *   * exactly one product HTML file exists in the repository root;
 *   * exactly one external reference exists and it is the pinned Three.js CDN ES-module URL: no
 *     other http(s) or protocol-relative URLs, no base64 image blobs, no relative script/style
 *     references, no @import;
 *   * the fullscreen CSS contract (margins/size/overflow on html+body, fixed full-bleed canvas);
 *   * the body contains exactly one canvas element and no visible text;
 *   * the extracted inline module parses (node --check on tmp/verify/extracted.mjs);
 *   * all documented capability markers exist, each attached to a non-trivial section;
 *   * the full data-rd-* diagnostics contract is assigned and the ?t0 / ?nofx / ?q hooks are read;
 *   * the documented performance budgets exist and stay inside their limits;
 *   * the product never references tools/ or vendor/.
 *
 * Usage: node tools/verify-static.mjs
 */

import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'tmp', 'verify');
const PRODUCT = path.join(ROOT, 'rocket-launch.html');
const CDN_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const CDN_PATTERN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@\d+\.\d+\.\d+\/build\/three\.module\.js$/;

const CAPABILITIES = [
  'SHELL', 'FULLSCREEN', 'RESIZE', 'NO_UI', 'RENDERER', 'TONE_MAP', 'SHADOWS',
  'SKY', 'SUN', 'ATMOSPHERE_FOG', 'TERRAIN', 'HILLS',
  'ROCKET_BODY', 'NOSE_CONE', 'FINS', 'ENGINES', 'PANELS',
  'LAUNCH_PAD', 'FLAME_TRENCH', 'TOWER', 'CLAMPS', 'STRUCTURES', 'PIPES', 'PLATFORMS', 'EQUIPMENT', 'BARRIERS',
  'VEGETATION', 'PRELAUNCH_SMOKE', 'BEACONS', 'IGNITION', 'FLAMES', 'ENGINE_LIGHT', 'SMOKE', 'DUST', 'SPARKS',
  'EMBERS', 'DEBRIS', 'VEG_REACT', 'VIBRATION', 'CLAMP_RELEASE', 'LIFTOFF', 'PLUME', 'POST_LAUNCH_SMOKE',
  'HEAT_SHIMMER', 'CAMERA_DIRECTOR', 'CAMERA_SHAKE', 'CLOUDS', 'LANDSCAPE_REVEAL', 'RENDER_SCALE', 'QUALITY_SCALE',
  'DIAGNOSTICS', 'SEQUENCE', 'SEEK',
];

const DIAG_KEYS = [
  'ready', 'rev', 'webgl', 'frame', 't', 'phase', 'roty', 'thrust', 'clamp', 'vib', 'plume',
  'smoke', 'sparks', 'embers', 'debris', 'smokeradius', 'smokey', 'campos', 'rocketscreen',
  'rect', 'inner', 'dpr', 'scale', 'draw', 'tri', 'mesh', 'fps', 'quality', 'fx', 'shimmer', 'veg', 'beacon', 'error',
];

const BUDGET_LIMITS = {
  drawCalls: 250,
  triangles: 1200000,
  smokeDust: 3000,
  sparks: 1200,
  debris: 250,
  grass: 20000,
  cloudSprites: 500,
  shadowMap: 2048,
  shadowMapLow: 1024,
  pixelRatio: 2,
  canvasPixels: 400000,
  textures: 24,
  textureSize: 512,
  deltaClamp: 0.1,
  warmup: 60,
};

const failures = [];
const checks = [];
function fail(message) {
  failures.push(message);
}
function ok(message) {
  checks.push(message);
}

/* ------------------------------------------------------------------- product file discovery -- */
if (!statSync(PRODUCT, { throwIfNoEntry: false })) {
  fail(`missing product file ${path.relative(ROOT, PRODUCT)}`);
}
const rootHtml = readdirSync(ROOT).filter((f) => f.toLowerCase().endsWith('.html') && statSync(path.join(ROOT, f)).isFile());
if (rootHtml.length !== 1) fail(`expected exactly one product HTML file in the repository root, found ${rootHtml.length}: ${rootHtml.join(', ')}`);
else if (rootHtml[0] !== 'rocket-launch.html') fail(`unexpected product file name ${rootHtml[0]}`);
const html = readFileSync(PRODUCT, 'utf8');
ok(`single product file rocket-launch.html (${(html.length / 1024).toFixed(1)} KiB)`);

/* --------------------------------------------------------------------------- self-containment -- */
const urls = html.match(/https?:\/\/[^\s"'`)<>]+/g) || [];
const protocolRelative = html.match(/(^|[\s"'(=])\/\/[a-z0-9.-]+\.[a-z]{2,}\//gi) || [];
if (urls.length !== 1) fail(`expected exactly one external URL, found ${urls.length}: ${urls.slice(0, 4).join(' , ')}`);
else if (!CDN_PATTERN.test(urls[0])) fail(`the single external URL is not the pinned Three.js CDN module: ${urls[0]}`);
else if (urls[0] !== CDN_URL) fail(`unexpected CDN URL ${urls[0]}`);
else ok('exactly one external reference (pinned Three.js CDN ES module)');
if (protocolRelative.length) fail(`protocol-relative URLs found: ${protocolRelative.slice(0, 3).join(' , ')}`);
if (/data:image/i.test(html)) fail('base64 image blob (data:image) found — textures must be procedural');
if (/<script[^>]+\bsrc\s*=/i.test(html)) fail('external/relative <script src=...> reference found');
if (/<link\b/i.test(html)) fail('<link> element found (stylesheet/preload references are not allowed)');
if (/\bimport\s*\(/.test(html)) fail('dynamic import() found — the single static CDN import is the contract');
if (/@import/.test(html)) fail('CSS @import found');
if (/\b(tools|vendor)\//.test(html)) fail('product file references tools/ or vendor/ (dev-only paths)');
const imports = html.match(/^\s*import\s[^\n]*$/gm) || [];
if (imports.length !== 1) fail(`expected exactly one import statement, found ${imports.length}`);
ok('no base64 blobs, no relative script/style/link references, no tools/ or vendor/ references');

/* ---------------------------------------------------------------------------- fullscreen CSS -- */
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const css = styleMatch ? styleMatch[1] : '';
if (!styleMatch) fail('no inline <style> block found');
const needsCss = [
  [/html\s*,\s*body\s*\{[^}]*margin:\s*0/, 'html, body { margin: 0 }'],
  [/html\s*,\s*body\s*\{[^}]*padding:\s*0/, 'html, body { padding: 0 }'],
  [/html\s*,\s*body\s*\{[^}]*width:\s*100%/, 'html, body { width: 100% }'],
  [/html\s*,\s*body\s*\{[^}]*height:\s*100%/, 'html, body { height: 100% }'],
  [/html\s*,\s*body\s*\{[^}]*overflow:\s*hidden/, 'html, body { overflow: hidden }'],
  [/canvas#scene\s*\{[^}]*position:\s*fixed/, 'canvas { position: fixed }'],
  [/canvas#scene\s*\{[^}]*inset:\s*0/, 'canvas { inset: 0 }'],
  [/canvas#scene\s*\{[^}]*display:\s*block/, 'canvas { display: block }'],
  [/canvas#scene\s*\{[^}]*width:\s*100%/, 'canvas { width: 100% }'],
  [/canvas#scene\s*\{[^}]*height:\s*100%/, 'canvas { height: 100% }'],
];
for (const [re, label] of needsCss) if (!re.test(css)) fail(`missing fullscreen CSS rule: ${label}`);
if (needsCss.every(([re]) => re.test(css))) ok('fullscreen CSS contract present (no margins, no scrollbars, full-bleed canvas)');

/* ---------------------------------------------------------------------------------- no UI --- */
const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
if (!bodyMatch) fail('no <body> element found');
else {
  const body = bodyMatch[1];
  const elements = body.match(/<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g) || [];
  if (elements.length !== 1) fail(`body must contain exactly one element (the canvas), found ${elements.length}: ${elements.slice(0, 5).join(' ')}`);
  else if (!/^<canvas\b/.test(elements[0])) fail(`the only body element is not the canvas: ${elements[0]}`);
  const text = body.replace(/<[^>]*>/g, '').trim();
  if (text.length) fail(`body contains visible text: "${text.slice(0, 60)}"`);
  if (/<script\b/i.test(body)) fail('script element inside <body> (the module must live in <head> so the body holds only the canvas)');
  if (!failures.length) ok('body contains exactly one canvas element and no text');
}

/* ------------------------------------------------------------------------ module extraction -- */
mkdirSync(OUT, { recursive: true });
const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!scriptMatch) fail('no inline <script type="module"> block found');
else {
  const module = scriptMatch[1];
  const extracted = path.join(OUT, 'extracted.mjs');
  writeFileSync(extracted, module);
  try {
    execFileSync(process.execPath, ['--check', extracted], { stdio: 'pipe' });
    ok(`extracted module parses cleanly (${module.split('\n').length} lines)`);
  } catch (e) {
    fail(`extracted module failed node --check: ${String(e.stderr || e.message).split('\n')[0]}`);
  }

  /* ------------------------------------------------------------------ capability markers --- */
  const markerRe = /\[CAP:([A-Z_]+)\]/g;
  const found = new Map();
  let m;
  while ((m = markerRe.exec(html)) !== null) found.set(m[1], m.index);
  const missing = CAPABILITIES.filter((c) => !found.has(c));
  if (missing.length) fail(`missing capability markers: ${missing.join(', ')}`);
  const unknown = [...found.keys()].filter((k) => !CAPABILITIES.includes(k));
  if (unknown.length) fail(`undocumented capability markers: ${unknown.join(', ')}`);

  const isCommentLine = (line) => {
    const t = line.trim();
    return t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/') || t.startsWith('<!--') || t.endsWith('-->') || t.startsWith('*/');
  };
  const ordered = CAPABILITIES.map((c) => ({ c, i: found.get(c) })).filter((e) => e.i !== undefined).sort((a, b) => a.i - b.i);
  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i].i;
    const end = i + 1 < ordered.length ? ordered[i + 1].i : html.length;
    const section = html.slice(start, end);
    const codeLines = section.split('\n').slice(1).filter((l) => !isCommentLine(l)).length;
    if (codeLines < 3) fail(`capability section ${ordered[i].c} has only ${codeLines} non-comment lines`);
  }
  if (!missing.length && !unknown.length) ok(`all ${CAPABILITIES.length} capability markers present with non-trivial sections`);

  /* ---------------------------------------------------------------------- diagnostics ------ */
  const missingKeys = DIAG_KEYS.filter((k) => !new RegExp(`\\.rd[-A-Za-z]*${k}\\b`, 'i').test(module) && !new RegExp(`rd-${k}\\b`).test(module));
  if (missingKeys.length) fail(`diagnostics contract incomplete, never assigned: ${missingKeys.join(', ')}`);
  const camel = (k) => 'rd' + k.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
  const unassigned = DIAG_KEYS.filter((k) => !new RegExp(`d\\.${camel(k)}\\s*=`, 'i').test(module));
  if (unassigned.length) fail(`diagnostics keys not written each frame: ${unassigned.join(', ')}`);
  if (!/window\.__ROCKET_DIAG__\s*=/.test(module)) fail('window.__ROCKET_DIAG__ is never populated');
  if (!/ROCKET_BOOT_OK/.test(module)) fail('boot marker ROCKET_BOOT_OK is missing');
  if (!/window\.onerror\s*=/.test(module)) fail('window.onerror capture is missing');
  if (!/unhandledrejection/.test(module)) fail('unhandledrejection capture is missing');
  if (!missingKeys.length && !unassigned.length) ok('complete data-rd-* diagnostics contract, boot marker and error capture');

  /* --------------------------------------------------------------------------- test hooks -- */
  if (!/params\.get\('t0'\)/.test(module)) fail('?t0 simulation-offset hook is not parsed');
  if (!/params\.get\('nofx'\)/.test(module)) fail('?nofx hook is not parsed');
  if (!/params\.get\('q'\)/.test(module)) fail('?q quality hook is not parsed');
  if (!/warmup/.test(module) || !/1 \/ 60/.test(module)) fail('bounded fixed-step warm-up for ?t0 not found');
  if (/Math\.random\s*\(/.test(module)) fail('Math.random() used in the frame loop — determinism requires seeded RNGs');
  ok('?t0 / ?nofx / ?q hooks parsed, fixed-step warm-up present, seeded RNG only');

  /* ------------------------------------------------- keyboard seek (single-session evidence) -- */
  /* Browser evidence is collected per scene state, and the harness keeps the captures of the last
     run of a session, so a run must be able to reach every state without reloading. The seek hook
     must therefore exist, must replay the same fixed 1/60 s steps the ?t0 warm-up uses, and must
     hold the state it reaches (otherwise the captured frame drifts away from the state name). */
  if (!/window\.addEventListener\('keydown'/.test(module)) fail('keyboard timeline-seek hook (keydown listener) is missing');
  if (!/const SEEK_TIMES = Object\.freeze\(\{/.test(module)) fail('timeline-seek key map (SEEK_TIMES) is missing');
  if (!/seekHold/.test(module) || !/step\(seekHold \? 0 : dt\)/.test(module)) fail('keyboard seek does not hold the state it reaches (dt is not frozen)');
  if (!/if \(!seekHold\) adaptQuality\(/.test(module)) fail('keyboard seek does not pin the adaptive ladder while a state is held');
  const seekTimes = [...module.matchAll(/^\s*'([1-9])':\s*([0-9.]+),/gm)].map((m) => Number.parseFloat(m[2]));
  const seekTargets = [0.5, 4.5, 8.0, 9.3, 12.0, 20.0, 30.0, 45.0];
  if (seekTimes.length < seekTargets.length) fail(`timeline-seek key map covers only ${seekTimes.length} of the ${seekTargets.length} launch states`);
  else if (seekTargets.some((target, i) => seekTimes[i] !== target)) fail(`timeline-seek key map does not match the launch states: ${seekTimes.join(', ')}`);
  else ok(`keyboard timeline seek covers all ${seekTargets.length} launch states in one session (keys 1-8, held)`);

  /* ---------------------------------------------------------------------------- budgets --- */
  const budgetMatch = module.match(/const BUDGET = Object\.freeze\(\{([\s\S]*?)\}\);/);
  if (!budgetMatch) fail('performance budget constants (BUDGET) not found');
  else {
    const entries = {};
    const re = /(\w+)\s*:\s*([0-9.]+)/g;
    let b;
    while ((b = re.exec(budgetMatch[1])) !== null) entries[b[1]] = Number.parseFloat(b[2]);
    for (const [key, limit] of Object.entries(BUDGET_LIMITS)) {
      if (entries[key] === undefined) fail(`budget constant ${key} missing`);
      else if (entries[key] > limit) fail(`budget constant ${key}=${entries[key]} exceeds the documented limit ${limit}`);
    }
    if (entries.deltaClamp !== undefined && entries.deltaClamp > 0.1) fail(`delta clamp ${entries.deltaClamp} is larger than the documented 0.1 s`);
    ok(`performance budgets present and within limits (${Object.keys(entries).length} constants)`);
  }
  if (!/Math\.min\(clock\.getDelta\(\), BUDGET\.deltaClamp\)/.test(module)) fail('frame loop does not clamp its delta to the documented budget');
  if (!/requestAnimationFrame\(loop\)/.test(module)) fail('render loop is not driven by requestAnimationFrame');
  if (!/onResize/.test(module) || !/visualViewport/.test(module) || !/orientationchange/.test(module)) fail('resize handling is incomplete (resize / orientationchange / visualViewport)');
  if (!/Math\.min\(window\.devicePixelRatio \|\| 1,[^)]*BUDGET\.pixelRatio\)/.test(module)) fail('pixel ratio is not clamped to the documented budget');
  if (!/RENDER_SCALE_LADDER = \[/.test(module)) fail('adaptive render-scale ladder is missing');
  if (!/clamp\(Number\(next\) \|\| 1, minRenderScale\(\), maxRenderScale\(\)\)/.test(module)) fail('render scale is not clamped between its floor and the viewport-derived ceiling');
  if (!/softwareRasteriser \? budgetRenderScale\(\) : RENDER_SCALE_LADDER\[0\]/.test(module)) fail('software rasterisers must start on a budgeted render scale while hardware renderers keep full resolution');
  if (!/setRenderScale\(rungBelow\(renderScale\)\)/.test(module)) fail('render scale never adapts downwards');
  ok('render scale is budgeted, clamped and adaptive (hardware keeps full resolution)');
}

/* ------------------------------------------------------------------------------- report ----- */
console.log('static gate: rocket-launch.html');
for (const c of checks) console.log('  + ' + c);
if (failures.length) {
  console.log('');
  console.log(`FAILED (${failures.length})`);
  for (const f of failures) console.log('  x ' + f);
  process.exit(1);
}
console.log('');
console.log(`PASS — ${checks.length} structural checks green.`);
