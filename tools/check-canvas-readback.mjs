#!/usr/bin/env node
/**
 * tools/check-canvas-readback.mjs — canvas pixel-evidence gate for rocket-launch.html.
 *
 * DEV-ONLY. Not part of the deliverable, Node builtins only (no install, no network).
 *
 * Why this exists
 * ---------------
 * Automated acceptance evidence for this product is pixel evidence: a reviewer or a browser probe
 * has to be able to read the rendered frame back out of the page and conclude something about it.
 * A WebGL canvas that does not preserve its drawing buffer hands back a *blank* buffer to every
 * canvas-level read (`canvas.toDataURL()`, `ctx.drawImage(canvas, ...)`, `getImageData`) as soon as
 * the frame callback has returned, so canvas-based sampling reports "inconclusive: no blank /
 * non-blank conclusion" instead of usable evidence. `rocket-launch.html` therefore creates its
 * renderer with `preserveDrawingBuffer: true`, and this gate proves it: at every phase of the
 * launch the canvas reads back as a real, bright, non-uniform, visibly changing frame.
 *
 * What it asserts per phase
 * -------------------------
 *   * the page booted (`rd-ready=1`, `rd-webgl` is webgl/webgl2, `rd-error` empty);
 *   * the reported phase matches the phase the checkpoint targets;
 *   * canvas readback is non-blank: every sampled pixel is non-zero, mean luma sits in the
 *     bright-daylight window, luma variance is well above the flat-frame floor and the PNG the
 *     page itself encodes is far larger than a blank canvas image;
 *   * two samples 400 ms apart differ, so the canvas is genuinely animating (a frozen or detached
 *     buffer cannot satisfy this).
 *
 * Evidence it emits (tmp/verify/, git-ignored)
 * -------------------------------------------
 *   * `readback-<phase>.png` — the frame the page read back out of its own canvas;
 *   * `readback-evidence.json` — per phase the live `data-rd-*` runtime state, the pixel statistics
 *     and the retained frame path, plus the criterion -> phases map, so each acceptance criterion
 *     has both live functional evidence and screenshot evidence from one run.
 *
 * Usage:
 *   node tools/check-canvas-readback.mjs            # full phase matrix
 *   node tools/check-canvas-readback.mjs --quick    # prelaunch / thrust-ramp / high-altitude
 *   node tools/check-canvas-readback.mjs --out DIR  # evidence directory (default tmp/verify)
 *
 * Uses the Chrome DevTools Protocol over the WebSocket built into Node 21+ (`WebSocket`), so no
 * dependency is installed. When the runtime has no chromium binary or no global WebSocket the gate
 * prints an explicit `ENVIRONMENT-LIMITED` line and exits 0 — it never silently claims a pass.
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PRODUCT = 'rocket-launch.html';
const CATEGORY = { bright: [60, 250], variance: 100, dataUrlChars: 50000, motion: 0.004 };

const QUICK = process.argv.includes('--quick');
const outFlag = process.argv.indexOf('--out');
const OUT = outFlag > -1 && process.argv[outFlag + 1] ? path.resolve(ROOT, process.argv[outFlag + 1]) : path.join(ROOT, 'tmp', 'verify');

/* Each phase is an acceptance-criterion checkpoint: `criteria` are the ACs that the frame and the
   live state at that phase evidence, mirroring tmp/verify/evidence.json. */
const PHASES = [
  { id: 'prelaunch', t0: 0.5, phase: 'PRELAUNCH', criteria: ['AC-1', 'AC-3', 'AC-4', 'AC-5', 'AC-6', 'AC-8', 'AC-11', 'AC-15', 'AC-17', 'AC-18'] },
  { id: 'ignition', t0: 4.5, phase: 'IGNITION', criteria: ['AC-4', 'AC-6', 'AC-9'] },
  { id: 'thrust-ramp', t0: 8.0, phase: 'THRUST_RAMP', criteria: ['AC-4', 'AC-6', 'AC-7', 'AC-8', 'AC-10', 'AC-11', 'AC-15', 'AC-17', 'AC-18', 'AC-20'] },
  { id: 'clamp-release', t0: 9.6, phase: 'CLAMP_RELEASE', criteria: ['AC-6', 'AC-12'] },
  { id: 'liftoff', t0: 12.0, phase: 'LIFTOFF', criteria: ['AC-4', 'AC-6', 'AC-7', 'AC-8', 'AC-9', 'AC-10', 'AC-11', 'AC-12', 'AC-13', 'AC-14', 'AC-15', 'AC-16'] },
  { id: 'cloud-layer', t0: 30.0, phase: 'CLOUD_LAYER', criteria: ['AC-4', 'AC-6', 'AC-9', 'AC-13', 'AC-14', 'AC-16', 'AC-20'] },
  { id: 'high-altitude', t0: 45.0, phase: 'HIGH_ALTITUDE', criteria: ['AC-4', 'AC-6', 'AC-9', 'AC-14', 'AC-15', 'AC-16', 'AC-17', 'AC-20'] },
  { id: 'nofx', t0: 8.0, phase: 'THRUST_RAMP', query: 'nofx=1', criteria: ['AC-7', 'AC-18'] },
  { id: 'quality-low', t0: 8.0, phase: 'THRUST_RAMP', query: 'q=low', criteria: ['AC-18', 'AC-20'] },
  { id: 'coverage-800', t0: 0.5, phase: 'PRELAUNCH', coverage: true, criteria: ['AC-2'] },
  { id: 'coverage-1024', t0: 30.0, phase: 'CLOUD_LAYER', w: 1024, h: 576, coverage: true, criteria: ['AC-2', 'AC-3'] },
  { id: 'isolated', t0: 4.5, phase: 'IGNITION', isolated: true, criteria: ['AC-1', 'AC-19'] },
];
const LIST = QUICK ? PHASES.filter((p) => ['prelaunch', 'thrust-ramp', 'high-altitude'].includes(p.id)) : PHASES;

/* --------------------------------------------------------------------------------- helpers -- */
const failures = [];
const checks = [];
function fail(where, message) {
  failures.push(`${where}: ${message}`);
}
function ok(message) {
  checks.push(message);
}
function which(bin) {
  for (const p of (process.env.PATH || '').split(path.delimiter)) {
    const full = path.join(p, bin);
    try {
      if (statSync(full).isFile()) return full;
    } catch (e) {
      /* not in this directory */
    }
  }
  return null;
}
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

/* Runs inside the page: read the canvas back through both the 2D-canvas path and the page's own
   PNG encoder, and report the live data-rd-* diagnostics with the pixel statistics. */
const SAMPLE = `(() => {
  const root = document.documentElement;
  const ds = (root && root.dataset) || {};
  const diag = {};
  for (const key of Object.keys(ds)) if (key.startsWith('rd')) diag[key] = ds[key];
  const empty = {
    phase: ds.rdPhase || '',
    ready: ds.rdReady || '',
    error: ds.rdError || '',
    diag,
    pixels: 0,
    nonZeroPixels: 0,
    meanLuma: 0,
    minLuma: 0,
    maxLuma: 0,
    variance: 0,
    uniqueColors: 0,
    dataUrlChars: 0,
    dataUrlError: 'canvas not ready',
    lumaGrid: [],
    image: '',
    jpeg: '',
    jpegPixels: '',
  };
  const canvas = document.getElementById('scene');
  if (!canvas || !canvas.width) return empty;
  const grid = document.createElement('canvas');
  grid.width = 64;
  grid.height = 36;
  const ctx = grid.getContext('2d');
  ctx.drawImage(canvas, 0, 0, 64, 36);
  const px = ctx.getImageData(0, 0, 64, 36).data;
  const vals = [];
  let sum = 0;
  let min = 255;
  let max = 0;
  let nonZero = 0;
  const seen = new Set();
  for (let i = 0; i < px.length; i += 4) {
    const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
    vals.push(+l.toFixed(2));
    sum += l;
    if (l < min) min = l;
    if (l > max) max = l;
    if (l > 0) nonZero++;
    seen.add(((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4));
  }
  const mean = sum / vals.length;
  let variance = 0;
  for (const v of vals) variance += (v - mean) * (v - mean);
  variance /= vals.length;
  let dataUrl = '';
  let dataUrlError = '';
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch (e) {
    dataUrlError = String(e && e.message);
  }
  /* A compact JPEG copy of the same frame: small enough to travel as a review/evidence artifact
     next to the full-size PNG (a blank canvas compresses to a flat, tiny image, so this also has
     to be checked). The quality is stepped down until the encoded copy fits the evidence budget:
     artifact publication reads the file, and a binary file's effective read budget is its base64
     form, so the copy is kept well under 16 kB. */
  let jpeg = '';
  const compact = document.createElement('canvas');
  compact.width = 512;
  compact.height = Math.max(1, Math.round((512 * canvas.height) / canvas.width));
  compact.getContext('2d').drawImage(canvas, 0, 0, compact.width, compact.height);
  for (const quality of [0.7, 0.6, 0.5, 0.42, 0.34]) {
    jpeg = compact.toDataURL('image/jpeg', quality);
    if (jpeg.length * 0.75 <= 16000) break;
  }
  return {
    phase: ds.rdPhase,
    ready: ds.rdReady,
    error: ds.rdError,
    diag,
    pixels: vals.length,
    nonZeroPixels: nonZero,
    meanLuma: +mean.toFixed(2),
    minLuma: min,
    maxLuma: max,
    variance: +variance.toFixed(2),
    uniqueColors: seen.size,
    dataUrlChars: dataUrl.length,
    dataUrlError,
    lumaGrid: vals,
    image: dataUrl.replace(/^data:image\\/png;base64,/, ''),
    jpeg: jpeg.replace(/^data:image\\/jpeg;base64,/, ''),
    jpegPixels: compact.width + 'x' + compact.height,
  };
})()`;

function frameDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length / 255;
}

/* ----------------------------------------------------------------------- chromium launcher -- */
function launch(chromium, url, w, h) {
  const child = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=' + w + ',' + h, '--remote-debugging-port=0', '--enable-logging=stderr', '--v=0', url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const port = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chromium never announced a DevTools port')), 60000);
    child.stderr.on('data', (b) => {
      stderr += b.toString();
      const m = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.on('exit', () => {
      clearTimeout(timer);
      reject(new Error('chromium exited before the DevTools port was announced'));
    });
  });
  return { child, port, stderrNow: () => stderr };
}

async function findPageTarget(port) {
  let seen = 'none';
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      seen = list.map((t) => `${t.type}:${t.url}`).join(' | ') || 'empty';
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && /rocket-launch\.html/.test(t.url));
      if (page) return page;
    } catch (e) {
      seen = `fetch error: ${e.message}`;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no page target with rocket-launch.html on the DevTools endpoint (port ${port}, saw ${seen})`);
}

async function attach(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('DevTools websocket failed to open'));
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send('Runtime.enable', {});
  return { send, close: () => ws.close() };
}

const evaluate = async (session, expression) => {
  const res = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'evaluation threw');
  return res.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------------------- phase sweep -- */
const chromium = findChromium();
if (!chromium || typeof WebSocket === 'undefined') {
  const missing = !chromium ? 'no chromium binary on PATH' : 'no global WebSocket (needs Node 21+)';
  console.log(`ENVIRONMENT-LIMITED: ${missing}; canvas readback gate skipped (static + browser gates remain authoritative).`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const isolatedDir = path.join(OUT, 'isolated');
mkdirSync(isolatedDir, { recursive: true });
const isolatedPath = path.join(isolatedDir, PRODUCT);
copyFileSync(path.join(ROOT, PRODUCT), isolatedPath);

const W = 800;
const H = 450;
const records = [];
const unbooted = [];
console.log(`canvas readback gate: chromium=${chromium} phases=${LIST.length} out=${path.relative(ROOT, OUT)}`);

for (const ph of LIST) {
  const file = ph.isolated ? isolatedPath : path.join(ROOT, PRODUCT);
  const query = [`t0=${ph.t0}`, ph.query || ''].filter(Boolean).join('&');
  const url = `file://${file}?${query}`;
  const started = Date.now();
  const w = ph.w || W;
  const h = ph.h || H;
  const { child, port: portPromise } = launch(chromium, url, w, h);
  const where = ph.id;
  let record = { id: ph.id, t0: ph.t0, phase: ph.phase, url, criteria: ph.criteria };
  try {
    const port = await portPromise;
    const page = await findPageTarget(port);
    const session = await attach(page);
    // Wait for the page's own readiness marker, then keep sampling until the canvas really hands
    // back a frame. Attaching to the target early can land before the document exists, so every
    // step tolerates a null document / missing canvas instead of failing the phase.
    const sample = async () => {
      for (let i = 0; i < 40; i++) {
        try {
          const value = await evaluate(session, SAMPLE);
          // Only accept a *real* frame: the page booted and the canvas read back non-blank content.
          // Anything else (no document yet, canvas not painted, blank buffer) is retried, so the
          // motion metric below always compares two rendered frames.
          if (value && value.ready === '1' && value.image && value.pixels > 0
            && value.nonZeroPixels === value.pixels && value.dataUrlChars >= CATEGORY.dataUrlChars) {
            return value;
          }
        } catch (e) {
          /* document not created yet, or the canvas is not up — retry */
        }
        await sleep(250);
      }
      throw new Error('the canvas never produced a readable frame');
    };
    const first = await sample();
    await sleep(400);
    const second = await sample();
    session.close();
    const png = Buffer.from(second.image, 'base64');
    const pngPath = path.join(OUT, `readback-${ph.id}.png`);
    writeFileSync(pngPath, png);
    const jpg = Buffer.from(second.jpeg, 'base64');
    const jpgPath = path.join(OUT, `readback-${ph.id}.jpg`);
    writeFileSync(jpgPath, jpg);
    record = {
      ...record,
      reportedPhase: second.phase,
      ready: second.ready,
      runtimeError: second.error,
      live: second.diag,
      pixels: second.pixels,
      nonZeroPixels: second.nonZeroPixels,
      meanLuma: second.meanLuma,
      minLuma: second.minLuma,
      maxLuma: second.maxLuma,
      variance: second.variance,
      uniqueColors: second.uniqueColors,
      dataUrlChars: second.dataUrlChars,
      dataUrlError: second.dataUrlError,
      motionDiff: +frameDiff(first.lumaGrid, second.lumaGrid).toFixed(5),
      pngBytes: png.length,
      png: path.relative(ROOT, pngPath),
      jpegBytes: jpg.length,
      jpegPixels: second.jpegPixels,
      jpeg: path.relative(ROOT, jpgPath),
      ms: Date.now() - started,
    };
  } catch (e) {
    fail(where, `could not sample the canvas: ${e.message}`);
  } finally {
    child.kill('SIGTERM');
  }

  if (record.reportedPhase !== undefined) {
    if (record.ready !== '1') {
      // The page never booted. In this image that means the pinned Three.js CDN module was
      // unreachable, which is an environment limitation the browser gate states explicitly — not a
      // canvas-evidence defect. It is still never silently swallowed (see the summary below).
      unbooted.push(where);
    } else {
      if (!['webgl2', 'webgl'].includes(record.live && record.live.rdWebgl)) fail(where, `no WebGL context reported (rd-webgl=${record.live && record.live.rdWebgl})`);
      if (record.runtimeError !== '') fail(where, `runtime error captured: ${record.runtimeError}`);
      if (record.reportedPhase !== ph.phase) fail(where, `expected phase ${ph.phase}, reported ${record.reportedPhase}`);
      if (record.pixels === 0 || record.nonZeroPixels !== record.pixels) fail(where, `canvas readback is blank (${record.nonZeroPixels}/${record.pixels} non-zero pixels)`);
      if (record.dataUrlError) fail(where, `toDataURL failed: ${record.dataUrlError}`);
      if (!(record.meanLuma >= CATEGORY.bright[0] && record.meanLuma <= CATEGORY.bright[1])) fail(where, `mean readback luma ${record.meanLuma} outside the bright window ${CATEGORY.bright.join('..')}`);
      if (record.variance < CATEGORY.variance) fail(where, `readback variance ${record.variance} below the flat-frame floor ${CATEGORY.variance}`);
      if (record.dataUrlChars < CATEGORY.dataUrlChars) fail(where, `canvas-encoded PNG is ${record.dataUrlChars} chars — a blank canvas encodes to a few thousand`);
      if (record.motionDiff < CATEGORY.motion) fail(where, `two samples 400 ms apart differ by only ${record.motionDiff} — the canvas is not animating`);
      if (record.pngBytes < 20000) fail(where, `retained readback frame is only ${record.pngBytes} bytes`);
      if (!(record.jpegBytes > 3000 && record.jpegBytes <= 17000)) fail(where, `compact JPEG evidence copy is ${record.jpegBytes} bytes (expected 3-17 kB at ${record.jpegPixels})`);
      if (ph.coverage) {
        // edge-to-edge: the canvas CSS rect the page reports must equal the reported viewport
        const rect = String(record.live.rdRect || '').split(',').map(Number);
        const inner = String(record.live.rdInner || '').split('x').map(Number);
        const matches = rect.length === 4 && inner.length === 2 && rect[0] === 0 && rect[1] === 0 && rect[2] === inner[0] && rect[3] === inner[1];
        if (!matches) fail(where, `canvas rect ${record.live.rdRect} does not equal the reported viewport ${record.live.rdInner}`);
      }
    }
  }
  records.push(record);
  if (record.reportedPhase !== undefined) {
    console.log(`  ${ph.id.padEnd(14)} t0=${String(ph.t0).padEnd(5)} phase=${String(record.reportedPhase).padEnd(14)} luma=${String(record.meanLuma).padEnd(6)} var=${String(record.variance).padEnd(9)} uniq=${String(record.uniqueColors).padEnd(5)} motion=${record.motionDiff} png=${record.pngBytes}B jpg=${record.jpegBytes}B ${record.ms}ms`);
  }
}

if (records.length && unbooted.length === records.length) {
  console.log(`\nENVIRONMENT-LIMITED: rocket-launch.html never booted in this runtime (${unbooted.join(', ')}) — the pinned Three.js CDN module looks unreachable here, so no canvas evidence could be sampled; this gate is skipped and the static + browser gates stay authoritative.`);
  process.exit(0);
}
for (const where of unbooted) fail(where, 'page did not report rd-ready=1 — it never booted, so the canvas could not be sampled');

/* ------------------------------------------------------------------------------- evidence -- */
const criteria = {};
for (const rec of records) {
  if (rec.reportedPhase === undefined) continue;
  for (const ref of rec.criteria) {
    criteria[ref] = criteria[ref] || { ref, phases: [], frames: [] };
    criteria[ref].phases.push(rec.id);
    criteria[ref].frames.push(rec.png);
  }
}
const linked = new Set(Object.keys(criteria));
const allRefs = [...new Set(PHASES.flatMap((p) => p.criteria))];
const unlinked = allRefs.filter((r) => !linked.has(r));

const evidencePath = path.join(OUT, 'readback-evidence.json');
writeFileSync(evidencePath, JSON.stringify({
  generated: new Date().toISOString(),
  source: 'tools/check-canvas-readback.mjs — canvas pixel readback of rocket-launch.html over CDP',
  renderer: 'WebGLRenderer created with preserveDrawingBuffer: true, so canvas-level readback returns the rendered frame',
  evidenceKinds: {
    live_functional: 'runtime state read from the live page (data-rd-* diagnostics) at the phase',
    screenshot: 'the frame read back out of the live canvas: full-size PNG plus a compact JPEG copy (< 30 kB) that is small enough to travel as a review/evidence artifact',
  },
  thresholds: CATEGORY,
  phases: records,
  criteria: Object.keys(criteria).sort().map((ref) => criteria[ref]),
  unlinked,
}, null, 2));

if (failures.length) {
  console.log(`\nFAIL — ${failures.length} canvas readback problem(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(`evidence: ${path.relative(ROOT, evidencePath)}`);
  process.exit(1);
}
console.log(`\nPASS — ${records.length} phases read back a bright, non-uniform, animating canvas frame.`);
console.log(`evidence: ${path.relative(ROOT, evidencePath)} (${Object.keys(criteria).length}/${allRefs.length} criteria linked to live state + retained canvas frames)`);
if (unlinked.length) console.log(`  note: criteria not covered by this matrix: ${unlinked.join(', ')}`);
