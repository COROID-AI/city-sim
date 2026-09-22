#!/usr/bin/env node
/**
 * tools/verify-browser.mjs — headless-Chromium render gate for rocket-launch.html.
 *
 * DEV-ONLY. Not part of the deliverable. Runs the documented checkpoint matrix against the real
 * page, reads the live `data-rd-*` diagnostics out of the DOM dump, analyses the captured PNGs and
 * fails with a per-checkpoint report.
 *
 * Modes:
 *   cdn     the real pinned Three.js CDN URL is reachable -> the page is loaded straight from
 *           file:// (the primary, product-accurate mode).
 *   mirror  no network: a git-ignored vendor/three.module.js copy is served over a local node:http
 *           server and the CDN URL is rewritten in a throwaway temp copy of the page.
 *   skip    no network and no mirror: prints an explicit ENVIRONMENT-LIMITED report and exits 0
 *           (the deterministic static gate then carries the run). A checkpoint is never silently
 *           passed.
 *
 * Usage: node tools/verify-browser.mjs [--quick] [--keep]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, frameStats, diffRatio, regionStats, nearWhiteRatio, meanColorOfRegion } from './lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PRODUCT = 'rocket-launch.html';
const OUT = path.join(ROOT, 'tmp', 'verify');
const CDN_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const PAGE_BG = [13, 13, 18]; // html/body background colour: any border pixel matching it is a gap
const QUICK = process.argv.includes('--quick');
const KEEP = process.argv.includes('--keep');
const FORCE_MODE = process.argv.includes('--mirror') ? 'mirror' : process.argv.includes('--cdn') ? 'cdn' : null;

/* ------------------------------------------------------------------ checkpoint contract ---- */
const BASE = { t0: 0.5, phase: 'PRELAUNCH', w: 800, h: 450, budget: 2200 };
/* `t0` is a *page* offset, not the timestamp the diagnostics are read at: after the bounded
   warm-up the page keeps stepping while chromium drains the virtual-time budget, so the sampled
   timestamp is `t0` plus the measured drift (roughly 0.2-0.35 s, i.e. three or four frames of the
   page's 0.1 s delta clamp). Every checkpoint below is therefore placed so that the *observed*
   time, not `t0`, lands inside the window it exists to measure. That matters most for
   CLAMP_RELEASE: the clamps must be fully open before the vehicle's altitude leaves the pad
   (t = 10 s), so the product's release ramp is necessarily saturated at 1 by the end of the phase
   and a reading taken ~0.32 s after 9.6 s would only ever see the completed value. Sampling at
   9.3 s puts the reading in the middle of the 0.9 s release ramp (~0.6-0.85), with slack on both
   sides of the `0.2 < clamp < 1` release assertion. */
const CHECKPOINTS = [
  { id: 'prelaunch', t0: 0.5, phase: 'PRELAUNCH' },
  { id: 'ignition', t0: 4.5, phase: 'IGNITION' },
  { id: 'thrust-ramp', t0: 8.0, phase: 'THRUST_RAMP' },
  // observed ~9.5-9.65 s: mid-transition of the tower arms' 9.0 -> 9.9 s release ramp
  { id: 'clamp-release', t0: 9.3, phase: 'CLAMP_RELEASE' },
  { id: 'liftoff', t0: 12.0, phase: 'LIFTOFF' },
  { id: 'ascent-18', t0: 18.0, phase: 'ASCENT' },
  { id: 'ascent-20', t0: 20.0, phase: 'ASCENT' },
  { id: 'ascent-20-progress', t0: 20.0, phase: 'ASCENT', budget: 4200, progress: true },
  { id: 'cloud-layer', t0: 30.0, phase: 'CLOUD_LAYER' },
  { id: 'high-altitude', t0: 45.0, phase: 'HIGH_ALTITUDE' },
  { id: 'coverage-800', t0: 0.5, phase: 'PRELAUNCH', coverage: true },
  { id: 'coverage-1024', t0: 30.0, phase: 'CLOUD_LAYER', w: 1024, h: 576, coverage: true },
  { id: 'nofx', t0: 8.0, phase: 'THRUST_RAMP', query: 'nofx=1', nofx: true },
  { id: 'quality-low', t0: 8.0, phase: 'THRUST_RAMP', query: 'q=low', qlow: true },
  { id: 'isolated', t0: 4.5, phase: 'IGNITION', isolated: true },
];

const failures = [];
const warnings = [];
const observations = [];
function fail(where, message) {
  failures.push(`${where}: ${message}`);
}
function note(where, message) {
  observations.push(`${where}: ${message}`);
}

/* ------------------------------------------------------------------------------- helpers ---- */
function findChromium() {
  const candidates = [process.env.CHROMIUM, 'chromium', 'chromium-browser', 'google-chrome', 'chrome'].filter(Boolean);
  for (const c of candidates) {
    if (c.includes('/')) {
      if (existsSync(c)) return c;
      continue;
    }
    const found = which(c);
    if (found) return found;
  }
  return null;
}
function which(bin) {
  const paths = (process.env.PATH || '').split(path.delimiter);
  for (const p of paths) {
    const full = path.join(p, bin);
    try {
      if (statSync(full).isFile()) return full;
    } catch (e) {
      /* not here */
    }
  }
  return null;
}
function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr, error: true });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
function cdnReachable() {
  return new Promise((resolve) => {
    const req = httpsRequest(CDN_URL, { method: 'GET', timeout: 6000 }, (res) => {
      resolve(res.statusCode === 200);
      res.destroy();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
function fetchCdnTo(file) {
  return new Promise((resolve) => {
    const req = httpsRequest(CDN_URL, { method: 'GET', timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) {
        res.destroy();
        resolve(false);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        writeFileSync(file, Buffer.concat(chunks));
        resolve(true);
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
function parseDiag(dom) {
  const out = {};
  const re = /data-rd-([a-z0-9]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(dom)) !== null) out[m[1]] = m[2];
  return out;
}
const num = (d, key) => (d[key] === undefined ? NaN : Number.parseFloat(d[key]));
const vec = (d, key) => (d[key] === undefined ? [] : String(d[key]).split(',').map(Number));

/* ---------------------------------------------------------------------------------- main --- */
mkdirSync(OUT, { recursive: true });
const chromium = findChromium();
if (!chromium) {
  console.log('ENVIRONMENT-LIMITED: no chromium binary found; browser gate skipped (static gate authoritative).');
  process.exit(0);
}

let mode = 'skip';
let serveServer = null;
const mirrorFile = path.join(ROOT, 'vendor', 'three.module.js');

async function chooseMode() {
  const reachable = FORCE_MODE === 'mirror' ? false : await cdnReachable();
  if (reachable) return 'cdn';
  if (FORCE_MODE === 'cdn') return 'skip';
  mkdirSync(path.dirname(mirrorFile), { recursive: true });
  if (!existsSync(mirrorFile)) {
    console.log('... CDN unreachable, attempting to cache a local mirror');
    await fetchCdnTo(mirrorFile);
  }
  return existsSync(mirrorFile) ? 'mirror' : 'skip';
}
mode = await chooseMode();

let baseUrl;
if (mode === 'cdn') {
  baseUrl = `file://${path.join(ROOT, PRODUCT)}`;
} else if (mode === 'mirror') {
  const source = readFileSync(path.join(ROOT, PRODUCT), 'utf8');
  const mirrorHtml = path.join(OUT, 'mirror.html');
  const port = 8787;
  writeFileSync(mirrorHtml, source.split(CDN_URL).join(`http://127.0.0.1:${port}/three.module.js`));
  serveServer = createServer((req, res) => {
    const body = readFileSync(mirrorFile);
    res.writeHead(200, {
      'content-type': 'text/javascript',
      'access-control-allow-origin': '*',
      'content-length': body.length,
    });
    res.end(body);
  });
  await new Promise((resolve) => serveServer.listen(port, '127.0.0.1', resolve));
  baseUrl = `file://${mirrorHtml}`;
} else {
  console.log('='.repeat(92));
  console.log('ENVIRONMENT-LIMITED: the Three.js CDN is unreachable and no vendor/three.module.js mirror is');
  console.log('available, so no browser checkpoint could be executed. This is NOT a pass. The deterministic');
  console.log('static gate (node tools/verify-static.mjs) remains authoritative for this run.');
  console.log('='.repeat(92));
  process.exit(0);
}

const list = QUICK ? CHECKPOINTS.filter((c) => ['prelaunch', 'thrust-ramp', 'liftoff', 'high-altitude', 'nofx'].includes(c.id)) : CHECKPOINTS;
console.log(`browser gate: mode=${mode} chromium=${chromium} checkpoints=${list.length}`);

function isolatedCopy() {
  const dir = path.join(OUT, 'isolated');
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, PRODUCT);
  copyFileSync(path.join(ROOT, PRODUCT), target);
  return `file://${target}`;
}
let isolatedUrl = null;

const results = {};
for (const cp of list) {
  const w = cp.w || BASE.w;
  const h = cp.h || BASE.h;
  const budget = cp.budget || BASE.budget;
  let url = baseUrl;
  if (cp.isolated) {
    isolatedUrl = isolatedUrl || isolatedCopy();
    url = isolatedUrl;
  }
  const query = [`t0=${cp.t0}`, cp.query || ''].filter(Boolean).join('&');
  const shot = path.join(OUT, `${cp.id}.png`);
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=' + w + ',' + h,
    '--virtual-time-budget=' + budget,
    '--screenshot=' + shot,
    '--dump-dom',
    '--enable-logging=stderr',
    '--v=0',
    `${url}?${query}`,
  ];
  const started = Date.now();
  const run1 = await run(chromium, args, 240000);
  const ms = Date.now() - started;
  const diag = parseDiag(run1.stdout);
  let img = null;
  let stats = null;
  try {
    img = decodePNG(shot);
    stats = frameStats(img, { borderColor: PAGE_BG, borderTolerance: 8 });
  } catch (e) {
    img = null;
    stats = null;
  }
  const record = { id: cp.id, cp, diag, ms, shot, stderr: run1.stderr, img, stats, chromiumCode: run1.code };
  results[cp.id] = record;
  console.log(`  ${cp.id.padEnd(20)} t0=${String(cp.t0).padEnd(5)} phase=${(diag.phase || '?').padEnd(14)} t=${diag.t || '?'} draw=${diag.draw || '?'} ${ms}ms`);
}

/* ------------------------------------------------------------------ per-checkpoint checks -- */
for (const cp of list) {
  const rec = results[cp.id];
  const d = rec.diag;
  const where = cp.id;
  const stderr = rec.stderr;

  if (d.ready !== '1') fail(where, 'page did not report rd-ready=1');
  if (!['webgl2', 'webgl'].includes(d.webgl)) fail(where, `no WebGL context reported (rd-webgl=${d.webgl})`);
  if (d.rev !== '160') fail(where, `unexpected three.js revision rd-rev=${d.rev}`);
  if ((d.error || '') !== '') fail(where, `runtime error captured: ${d.error}`);
  if (!stderr.includes('ROCKET_BOOT_OK')) fail(where, 'boot marker ROCKET_BOOT_OK missing from console output');
  if (/Uncaught/i.test(stderr)) fail(where, 'Uncaught page error on stderr');
  if (/THREE\.WebGLProgram|Shader Error|VALIDATE_STATUS/i.test(stderr)) fail(where, 'shader compilation error reported by three.js');
  if (cp.phase && d.phase !== cp.phase) fail(where, `expected phase ${cp.phase}, reported ${d.phase}`);

  // edge-to-edge: the canvas CSS rect must equal the page-reported viewport
  const rect = vec(d, 'rect');
  const inner = String(d.inner || '').split('x').map(Number);
  if (rect.length !== 4) fail(where, 'rd-rect missing');
  else {
    if (Math.abs(rect[0]) > 0.5 || Math.abs(rect[1]) > 0.5) fail(where, `canvas rect offset not 0 (${d.rect})`);
    if (Math.abs(rect[2] - inner[0]) > 1.5 || Math.abs(rect[3] - inner[1]) > 1.5) fail(where, `canvas rect ${d.rect} does not match viewport ${d.inner}`);
  }
  if (!(inner[0] > 0 && inner[1] > 0)) fail(where, 'rd-inner invalid');

  // frame analysis
  const img = rec.img;
  {
    const stats = rec.stats || { meanLuma: 0, meanSaturation: 0, uniqueColors: 0, largestUniformFrac: 1, border: { max: 1 }, skyBlueFrac: 0 };
    if (!img) fail(where, 'screenshot missing or undecodable');
    /* Thresholds are calibrated against the reference frames of the finished scene (measured
       ranges: luma 164-196, saturation 0.18-0.28, unique colours 2030-4720, largest uniform
       region 0.04-0.09, pre-launch sky reading 0.81-0.88) with a healthy safety margin, so a
       washed-out, dark or flat frame still fails loudly. */
    if (stats.meanLuma < 120) fail(where, `frame too dark (mean luma ${stats.meanLuma.toFixed(1)})`);
    if (stats.meanLuma > 235) fail(where, `frame blown out (mean luma ${stats.meanLuma.toFixed(1)})`);
    if (stats.meanSaturation < 0.12) fail(where, `frame not colourful (mean saturation ${stats.meanSaturation.toFixed(3)})`);
    if (stats.uniqueColors < 1200) fail(where, `too few distinct colours (${stats.uniqueColors})`);
    if (stats.largestUniformFrac > 0.45) fail(where, `large uniform blank region (${(stats.largestUniformFrac * 100).toFixed(0)}% of frame)`);
    if (stats.border.max > 0) fail(where, `page-background pixels found on the frame border (${JSON.stringify(stats.border)})`);
    if (cp.phase === 'PRELAUNCH') {
      if (stats.skyBlueFrac < 0.35) fail(where, `upper frame does not read as blue sky (${stats.skyBlueFrac.toFixed(3)})`);
    }
    const rs = vec(d, 'rocketscreen');
    if (rs.length === 4) {
      if (rs[0] < 0.25 || rs[0] > 0.75) fail(where, `rocket centre x outside the central region (${rs[0]})`);
      if (rs[1] < 0.12 || rs[1] > 0.88) fail(where, `rocket centre y outside the central region (${rs[1]})`);
      if (rs[3] < 0.18) fail(where, `rocket not prominent enough (screen height ${rs[3]})`);
      if (rs[2] < 0.02) fail(where, `rocket screen width implausibly small (${rs[2]})`);
    } else fail(where, 'rd-rocketscreen missing');
    if (num(d, 'draw') > 250) fail(where, `draw calls over budget (${d.draw})`);
    if (num(d, 'tri') > 1200000) fail(where, `triangle count over budget (${d.tri})`);
    if (num(d, 'smoke') > 3000) fail(where, `smoke particles over budget (${d.smoke})`);
    if (num(d, 'sparks') > 1200) fail(where, `sparks over budget (${d.sparks})`);
    if (num(d, 'debris') > 250) fail(where, `debris over budget (${d.debris})`);
    if (num(d, 'cloudbands') < 3) fail(where, `fewer than three cloud bands (${d.cloudbands})`);
    if (num(d, 'flamelayers') < 4) fail(where, `flame rig has fewer than four layers (${d.flamelayers})`);
    if (!['high', 'medium', 'low'].includes(d.quality)) fail(where, `quality tier not reported (${d.quality})`);
    const renderScale = num(d, 'scale');
    if (!(renderScale >= 0.4 && renderScale <= 1)) fail(where, `internal render scale out of range (${d.scale})`);
  }

  // quality / fx variants
  if (cp.nofx) {
    if (d.fx !== '0') fail(where, `?nofx=1 did not disable post-processing (rd-fx=${d.fx})`);
    if (num(d, 'shimmer') !== 0) fail(where, `shimmer should be zero without post-processing (${d.shimmer})`);
  } else if (cp.qlow) {
    if (d.quality !== 'low') fail(where, `?q=low did not force the low tier (${d.quality})`);
    if (d.fx !== '0') fail(where, `low tier should not use post-processing (rd-fx=${d.fx})`);
  } else if (d.fx !== '1' && ['prelaunch', 'ignition', 'thrust-ramp', 'liftoff'].includes(cp.id)) {
    fail(where, `post-processing unexpectedly disabled (rd-fx=${d.fx})`);
  }
}

/* --------------------------------------------------------------- cross-checkpoint contract -- */
const at = (id) => results[id].diag;
const REQUIRED = ['prelaunch', 'ignition', 'thrust-ramp', 'clamp-release', 'liftoff', 'ascent-18', 'ascent-20', 'cloud-layer', 'high-altitude'];
const haveAll = REQUIRED.every((id) => results[id]);
if (!haveAll) warnings.push('cross-checkpoint contract skipped: not every required checkpoint was executed (use the full matrix)');
if (haveAll) {
  const pre = at('prelaunch');
  const ign = at('ignition');
  const ramp = at('thrust-ramp');
  const release = at('clamp-release');
  const lift = at('liftoff');
  const a18 = at('ascent-18');
  const a20 = at('ascent-20');
  const cloud = at('cloud-layer');
  const high = at('high-altitude');

  // 1. sequence order
  if (num(pre, 'thrust') > 0.02) fail('sequence', `thrust not zero at pre-launch (${pre.thrust})`);
  if (!(num(ign, 'thrust') > 0.05)) fail('sequence', `ignition thrust did not start from zero (${ign.thrust})`);
  if (!(num(ramp, 'thrust') > num(ign, 'thrust') + 0.2)) fail('sequence', `thrust did not keep rising (${ign.thrust} -> ${ramp.thrust})`);
  if (!(num(lift, 'thrust') >= 0.9)) fail('sequence', `thrust not sustained at liftoff (${lift.thrust})`);
  if (!(num(pre, 'vib') === 0)) fail('sequence', `vibration non-zero before ignition (${pre.vib})`);
  if (!(num(ramp, 'vib') > 0.2)) fail('sequence', `vibration did not rise with thrust (${ramp.vib})`);
  if (!(num(release, 'vib') >= num(ramp, 'vib'))) fail('sequence', `vibration did not peak at clamp release (${ramp.vib} -> ${release.vib})`);
  if (!(num(lift, 'shake') > 0.05)) fail('sequence', `camera shake not active at liftoff (${lift.shake})`);
  if (num(pre, 'shake') !== 0) fail('sequence', `camera shake active during the calm pre-launch (${pre.shake})`);
  if (!(num(lift, 'shake') <= 1.25)) fail('sequence', `camera shake not bounded (${lift.shake})`);

  // 2. clamp release before the vehicle moves
  if (num(pre, 'clamp') !== 0) fail('clamps', `clamps not closed at pre-launch (${pre.clamp})`);
  if (!(num(release, 'clamp') > 0.2 && num(release, 'clamp') < 1)) fail('clamps', `clamps did not open during CLAMP_RELEASE (${release.clamp})`);
  if (num(release, 'roty') > 12.6) fail('clamps', `rocket left the pad before the clamps finished opening (roty=${release.roty})`);
  if (num(lift, 'clamp') !== 1) fail('clamps', `clamps not fully open by liftoff (${lift.clamp})`);

  // 3. ascent physics
  if (!(num(lift, 'roty') > 12.6)) fail('ascent', `rocket did not leave the pad by t=12 (roty=${lift.roty})`);
  if (!(num(a18, 'roty') > num(lift, 'roty'))) fail('ascent', 'altitude did not increase from liftoff to ascent');
  if (!(num(a20, 'roty') > num(a18, 'roty'))) fail('ascent', 'altitude not monotonic between 18 s and 20 s');
  if (!(num(cloud, 'roty') > num(a20, 'roty'))) fail('ascent', 'altitude not monotonic between 20 s and 30 s');
  if (!(num(high, 'roty') > num(cloud, 'roty'))) fail('ascent', 'altitude not monotonic between 30 s and 45 s');
  const v1 = (num(a18, 'roty') - num(lift, 'roty')) / 6;
  const v2 = (num(a20, 'roty') - num(a18, 'roty')) / 2;
  if (!(v2 > v1)) fail('ascent', `vertical speed did not increase during early ascent (${v1.toFixed(2)} -> ${v2.toFixed(2)})`);
  for (const id of ['liftoff', 'ascent-18', 'ascent-20', 'cloud-layer', 'high-altitude']) {
    const xz = vec(results[id].diag || results[id], 'rocketxz');
    if (xz.length === 2 && Math.hypot(xz[0], xz[1]) > 0.6) fail('ascent', `${id}: horizontal drift ${xz.join(',')} exceeds tolerance`);
  }

  // 4. plume stays attached and changes shape
  if (num(pre, 'plume') !== 0) fail('plume', `plume present before ignition (${pre.plume})`);
  if (!(num(lift, 'plume') > 5)) fail('plume', `no plume at liftoff (${lift.plume})`);
  if (!(num(a18, 'plume') > num(lift, 'plume'))) fail('plume', `plume did not grow with altitude (${lift.plume} -> ${a18.plume})`);
  if (!(Math.abs(num(a20, 'plume') - num(a18, 'plume')) > 0.5)) fail('plume', `plume length identical across ascent checkpoints (${a18.plume} / ${a20.plume})`);
  if (!(Math.abs(num(high, 'plume') - num(cloud, 'plume')) > 1)) fail('plume', `plume shape did not change between cloud layer and high altitude`);

  // 5. smoke and dust spread
  if (!(num(pre, 'smoke') >= 1)) fail('smoke', 'no pre-launch drift smoke at all');
  if (!(num(lift, 'smoke') >= num(pre, 'smoke') * 8)) fail('smoke', `smoke count did not grow by roughly an order of magnitude (${pre.smoke} -> ${lift.smoke})`);
  if (!(num(ign, 'smokeradius') >= num(pre, 'smokeradius') * 0.9)) fail('smoke', 'smoke radius collapsed during ignition');
  if (!(num(ramp, 'smokeradius') > num(ign, 'smokeradius') * 1.1)) fail('smoke', `smoke did not spread during the thrust ramp (${ign.smokeradius} -> ${ramp.smokeradius})`);
  if (!(num(lift, 'smokeradius') > num(ramp, 'smokeradius'))) fail('smoke', 'smoke radius did not keep growing to liftoff');
  if (!(num(cloud, 'smokeradius') > num(lift, 'smokeradius'))) fail('smoke', 'ground smoke stopped spreading after liftoff');
  if (!(num(cloud, 'smokey') > num(ramp, 'smokey'))) fail('smoke', 'smoke did not rise over the sequence');

  // 6. small particles
  if (num(pre, 'sparks') !== 0) fail('particles', 'sparks present before ignition');
  if (!(num(ramp, 'sparks') > 50)) fail('particles', `too few sparks at thrust ramp (${ramp.sparks})`);
  if (!(num(ramp, 'embers') > 20)) fail('particles', `too few embers at thrust ramp (${ramp.embers})`);
  if (!(num(lift, 'debris') > 5)) fail('particles', `no tumbling debris at liftoff (${lift.debris})`);

  // 7. vegetation / props reaction
  if (num(pre, 'veg') !== 0) fail('react', `vegetation bend non-zero before ignition (${pre.veg})`);
  if (!(num(ramp, 'veg') > 0.5)) fail('react', `vegetation did not bend with thrust (${ramp.veg})`);
  if (num(pre, 'propspread') > 0.2) fail('react', 'loose props moved before ignition');
  if (!(num(lift, 'propspread') > 0.5)) fail('react', `loose props did not react to the blast (${lift.propspread})`);

  // 8. ignition light
  if (!(num(ramp, 'veg') > 0 && num(ramp, 'shimmer') > 0)) fail('light', 'no heat shimmer while thrust is high');
  if (num(pre, 'shimmer') !== 0) fail('light', 'heat shimmer active before ignition');
  const nozzlePre = regionStats(results.prelaunch.img, 0.38, 0.55, 0.62, 0.98);
  const nozzleHot = regionStats(results['thrust-ramp'].img, 0.38, 0.55, 0.62, 0.98);
  if (!(nozzleHot.meanLuma > nozzlePre.meanLuma * 1.05)) fail('light', `engine light did not brighten the pad area (${nozzlePre.meanLuma.toFixed(1)} -> ${nozzleHot.meanLuma.toFixed(1)})`);
  if (!(nozzleHot.meanRed >= nozzlePre.meanRed)) fail('light', 'engine light did not warm the pad area');
  const whiteHot = nearWhiteRatio(results['thrust-ramp'].img, 0.3, 0.45, 0.7, 1.0, 225, 0.22);
  if (!(whiteHot > 0.002)) fail('light', `no near-white flame core pixels measurable at the nozzle (${whiteHot.toFixed(5)})`);

  // 9. camera
  const camY = (d) => vec(d, 'campos')[1];
  if (!(camY(a18) > camY(lift))) fail('camera', 'camera height did not follow the rocket after liftoff');
  if (!(camY(a20) > camY(a18))) fail('camera', 'camera height not increasing during ascent');
  if (!(camY(cloud) > camY(a20))) fail('camera', 'camera height not increasing into the cloud layer');
  if (!(camY(high) > camY(cloud))) fail('camera', 'camera height not increasing at high altitude');

  // 10. clouds and landscape reveal
  if (!(num(cloud, 'cloudreach') > 0)) fail('clouds', 'rocket never reached a cloud band');
  if (!(num(cloud, 'cloudreach') >= 450)) fail('clouds', `rocket did not reach the mid cloud deck (${cloud.cloudreach})`);
  const lowBand = regionStats(results['high-altitude'].img, 0.0, 0.55, 1.0, 1.0);
  if (!(lowBand.meanSaturation > 0.08)) fail('clouds', 'no colourful landscape below the rocket at high altitude');

  // 11. visual progress / density
  const rampImg = results['thrust-ramp'].img;
  const preImg = results.prelaunch.img;
  if (diffRatio(preImg, rampImg) < 0.05) fail('progress', 'pre-launch and thrust-ramp frames are nearly identical');
  const p1 = results['ascent-20'].img;
  const p2 = results['ascent-20-progress'] ? results['ascent-20-progress'].img : null;
  if (p2 && diffRatio(p1, p2) < 0.001) fail('progress', 'two runs at the same t0 produced identical frames (animation not progressing)');
  if (p2 && String(results['ascent-20'].diag.hash) === String(results['ascent-20-progress'].diag.hash)) {
    fail('progress', 'particle motion hash identical across two different virtual-time budgets');
  }
  for (const cp of list) {
    if (cp.progress) continue;
    const st = results[cp.id].stats;
    if (st && st.largestUniformFrac > 0.42) fail('density', `${cp.id}: ${(st.largestUniformFrac * 100).toFixed(0)}% of the frame is one flat colour`);
  }

  // coverage pair
  if (results['coverage-1024']) {
    const d1024 = results['coverage-1024'].diag;
    if (d1024.inner !== '1024x576') warnings.push(`coverage-1024 reported viewport ${d1024.inner} (layout viewport may differ from window size)`);
  }
  if (results.isolated) {
    if (results.isolated.diag.ready !== '1') fail('isolated', 'page failed to render from an isolated directory (relative reference?)');
  }
}

/* ------------------------------------------------------------------------------- report ----- */

console.log('');
console.log('checkpoint          phase           t      luma  sat    uniq  uniform  sky   rocket-h  draw  tri      particles');
for (const cp of list) {
  const rec = results[cp.id];
  const d = rec.diag;
  const s = rec.stats || {};
  const rs = vec(d, 'rocketscreen');
  console.log(
    [
      cp.id.padEnd(19),
      String(d.phase || '?').padEnd(15),
      String(d.t || '?').padEnd(6),
      (s.meanLuma !== undefined ? s.meanLuma.toFixed(1) : '?').padEnd(5),
      (s.meanSaturation !== undefined ? s.meanSaturation.toFixed(3) : '?').padEnd(6),
      String(s.uniqueColors || '?').padEnd(5),
      (s.largestUniformFrac !== undefined ? s.largestUniformFrac.toFixed(3) : '?').padEnd(8),
      (s.skyBlueFrac !== undefined ? s.skyBlueFrac.toFixed(3) : '?').padEnd(5),
      (rs.length === 4 ? rs[3].toFixed(3) : '?').padEnd(9),
      String(d.draw || '?').padEnd(5),
      String(d.tri || '?').padEnd(8),
      `smoke=${d.smoke || 0} sparks=${d.sparks || 0} embers=${d.embers || 0} debris=${d.debris || 0}`,
    ].join(' ')
  );
}

const report = {
  mode,
  chromium,
  generated: new Date().toISOString(),
  checkpoints: list.map((cp) => ({ id: cp.id, t0: cp.t0, phase: results[cp.id].diag.phase, ms: results[cp.id].ms })),
  failures,
  warnings,
  observations,
};
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
if (!KEEP) {
  /* screenshots stay in tmp/verify for inspection; nothing to clean outside it */
}

/* ------------------------------------------- acceptance-criterion evidence (live + screenshot) -- */
/* Every checkpoint yields two kinds of acceptance evidence: the live runtime state read out of the
 * page (the `data-rd-*` diagnostics, i.e. live functional evidence) and the function of the same
 * checkpoint's retained frame on disk (`<checkpoint>.png`, i.e. screenshot evidence). Mapping both
 * onto the acceptance criteria keeps the live run citable per criterion, instead of forcing a
 * hand-built mapping after the fact. `tmp/verify/evidence.json` is the machine-readable result. */
const CRITERIA = [
  { ref: 'AC-1', label: 'cold start renders the scene automatically (boot marker, no Uncaught)', checkpoints: ['prelaunch', 'isolated'] },
  { ref: 'AC-2', label: 'scene fills the viewport edge to edge at 800x450 and 1024x576', checkpoints: ['coverage-800', 'coverage-1024'] },
  { ref: 'AC-3', label: 'body holds only the canvas — no overlay, text or UI', checkpoints: ['prelaunch', 'coverage-1024'] },
  { ref: 'AC-4', label: 'frames stay bright and colourful, blue sky at pre-launch', checkpoints: ['prelaunch', 'ignition', 'thrust-ramp', 'liftoff', 'cloud-layer', 'high-altitude'] },
  { ref: 'AC-5', label: 'rocket vertical on the pad, prominent, held by the tower arms', checkpoints: ['prelaunch'] },
  { ref: 'AC-6', label: 'required sequence with observable state changes', checkpoints: ['prelaunch', 'ignition', 'thrust-ramp', 'clamp-release', 'liftoff', 'ascent-18', 'cloud-layer', 'high-altitude'] },
  { ref: 'AC-7', label: 'multi-layered engine fire with a measurable near-white core', checkpoints: ['thrust-ramp', 'liftoff', 'nofx'] },
  { ref: 'AC-8', label: 'engine light brightens and warms the pad, structure and rocket body', checkpoints: ['prelaunch', 'thrust-ramp', 'liftoff'] },
  { ref: 'AC-9', label: 'smoke and dust roll, spread radially and rise', checkpoints: ['ignition', 'liftoff', 'ascent-18', 'cloud-layer', 'high-altitude'] },
  { ref: 'AC-10', label: 'sparks, embers, dust motes and debris are active and moving', checkpoints: ['thrust-ramp', 'liftoff', 'ascent-20', 'ascent-20-progress'] },
  { ref: 'AC-11', label: 'vegetation bends and loose props react to the exhaust', checkpoints: ['prelaunch', 'thrust-ramp', 'liftoff'] },
  { ref: 'AC-12', label: 'clamps release before the altitude leaves the pad', checkpoints: ['clamp-release', 'liftoff'] },
  { ref: 'AC-13', label: 'vertical rise with smooth acceleration and no lateral drift', checkpoints: ['liftoff', 'ascent-18', 'ascent-20', 'cloud-layer'] },
  { ref: 'AC-14', label: 'long plume stays attached and keeps changing shape', checkpoints: ['liftoff', 'ascent-18', 'cloud-layer', 'high-altitude'] },
  { ref: 'AC-15', label: 'rocket stays prominent, camera follows, shake stays watchable', checkpoints: ['prelaunch', 'thrust-ramp', 'liftoff', 'ascent-20', 'high-altitude'] },
  { ref: 'AC-16', label: 'layered cloud decks plus landscape reveal below', checkpoints: ['cloud-layer', 'high-altitude'] },
  { ref: 'AC-17', label: 'viewport stays tight and dense, animation visibly progresses', checkpoints: ['prelaunch', 'thrust-ramp', 'ascent-20', 'ascent-20-progress', 'high-altitude'] },
  { ref: 'AC-18', label: 'heat shimmer / atmospheric distortion near the exhaust', checkpoints: ['prelaunch', 'thrust-ramp', 'nofx', 'quality-low'] },
  { ref: 'AC-19', label: 'one external dependency only; renders outside the repository layout', checkpoints: ['isolated'] },
  { ref: 'AC-20', label: 'performance budgets respected, adaptive quality path works', checkpoints: ['quality-low', 'thrust-ramp', 'high-altitude'] },
];
const LIVE_DIAG_KEYS = [
  'phase', 't', 'thrust', 'clamp', 'vib', 'plume', 'smoke', 'sparks', 'embers', 'debris', 'smokeradius',
  'smokey', 'campos', 'rocketscreen', 'rect', 'inner', 'dpr', 'draw', 'tri', 'mesh', 'fps', 'quality',
  'scale',
  'fx', 'shimmer', 'veg', 'beacon', 'error',
];
const evidencePrefix = path.relative(ROOT, OUT).split(path.sep).join('/');
const criteriaEvidence = CRITERIA.map(({ ref, label, checkpoints }) => {
  const entries = [];
  const missingCheckpoints = [];
  for (const id of checkpoints) {
    const rec = results[id];
    if (!rec || !rec.diag || rec.diag.phase === undefined) {
      missingCheckpoints.push(id);
      continue;
    }
    entries.push({
      checkpoint: id,
      screenshot: `${evidencePrefix}/${id}.png`,
      live: Object.fromEntries(LIVE_DIAG_KEYS.filter((k) => rec.diag[k] !== undefined).map((k) => [k, rec.diag[k]])),
      frame: Object.fromEntries(Object.entries(rec.stats || {}).filter(([, v]) => typeof v === 'number')),
    });
  }
  return { ref, label, evidenceKinds: ['live_functional', 'screenshot'], checkpoints: entries, missingCheckpoints };
});
const unlinked = criteriaEvidence.filter((c) => c.checkpoints.length === 0).map((c) => c.ref);
writeFileSync(
  path.join(OUT, 'evidence.json'),
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      mode,
      source: 'tools/verify-browser.mjs — live headless-Chromium run of rocket-launch.html',
      evidenceKinds: {
        live_functional: 'runtime state read from the live page (data-rd-* diagnostics at the checkpoint time)',
        screenshot: 'the same checkpoint’s captured frame, retained on disk for inspection',
      },
      criteriaLinked: criteriaEvidence.length - unlinked.length,
      criteriaTotal: criteriaEvidence.length,
      unlinked,
      criteria: criteriaEvidence,
    },
    null,
    2
  )
);
console.log('');
console.log(`acceptance evidence: ${criteriaEvidence.length - unlinked.length}/${criteriaEvidence.length} criteria linked to live checkpoints + retained frames -> ${evidencePrefix}/evidence.json`);
if (unlinked.length) warnings.push(`no executed checkpoint mapped to ${unlinked.join(', ')} (run without --quick for the full criterion map)`);

if (warnings.length) {
  console.log('');
  console.log('warnings:');
  for (const w of warnings) console.log('  ! ' + w);
}
if (failures.length) {
  console.log('');
  console.log(`FAILED (${failures.length})`);
  for (const f of failures) console.log('  x ' + f);
  if (serveServer) serveServer.close();
  process.exit(1);
}
console.log('');
console.log(`PASS — ${list.length} checkpoints rendered and verified in ${mode} mode.`);
if (serveServer) serveServer.close();
rmSync(path.join(OUT, 'isolated'), { recursive: true, force: true });
process.exit(0);
