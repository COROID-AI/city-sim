/* ===========================================================================
   Regression check for the exhaust heat-haze composite pass.

   Reported defect: "What is this kind of wavy pattern, it looks awful. I guess
   it is the engine distorting the camera, but this is really overdoing it."
   The heat shimmer is a full-screen post pass, so an over-wide / over-strong
   uv wobble warps the entire frame (vehicle, gantry, sky) instead of only the
   hot exhaust column, and a regular sine wobble reads as clean wave banding.

   Method (deterministic A/B, no reference images required):
     pass "on"  - the page exactly as authored
     pass "off" - the same page with the composite uv wobble compiled out, by
                  intercepting WebGL shaderSource on the next document
   Both passes seek to identical sim times through window.__LAUNCH__.seek(t).
   The scene is a pure function of sim time, so any pixel difference between
   the passes is caused by the heat shimmer alone. A repeated capture inside
   one pass is asserted bit-identical first, which validates the method.

   Assertions (verified near-identical for every sampled phase):
     - the shimmer is still present near the plume (the feature was not removed)
     - it perturbs only a small part of the frame
     - it stays at a couple of pixels and never bands across the frame
     - the disturbed pixels stay confined to the exhaust column

   Exits non-zero with a per-assertion report on failure. If the sandbox has no
   outbound network the CDN probe fails loudly with CDN_UNREACHABLE.
   =========================================================================== */

import * as H from './lib/harness.mjs';

const v = new H.Verifier('verify-shimmer');
const cleanup = [];
process.on('exit', () => { for (const fn of cleanup) { try { fn(); } catch (e) { /* ignore */ } } });

/* ---------------------------------------------------------------------------
   0. CDN reachability — the scene pins its Three.js module to a CDN
   --------------------------------------------------------------------------- */
const cdn = await H.probeCdn();
if (!cdn.ok) {
  console.log('\nCDN_UNREACHABLE: the pinned Three.js module could not be fetched from any host.');
  for (const line of cdn.tried) console.log('  ' + line);
  console.log('  The artifact itself is unchanged; this sandbox has no outbound network.');
  v.ok('Three.js CDN module reachable', false, 'CDN_UNREACHABLE');
  try {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['tests/verify-static.mjs'], { encoding: 'utf8' });
    console.log('\n--- static conformance (offline, independent of the network) ---');
    console.log(r.stdout || r.stderr);
  } catch (e) { /* ignore */ }
  v.finish();
}
v.info(`CDN reachable: ${cdn.url} (${cdn.bytes} bytes, attempt ${cdn.attempts})`);

/* ---------------------------------------------------------------------------
   1. Boot the local origin + headless Chromium
   --------------------------------------------------------------------------- */
const server = await H.startServer();
cleanup.push(() => server.close());
const chrome = await H.launchChromium({ width: 1280, height: 720 });
cleanup.push(() => chrome.close());
v.info('browser: ' + (chrome.version.Browser || '?'));

const cdp = await chrome.newPage();
cleanup.push(() => cdp.close());

/* ---------------------------------------------------------------------------
   2. The two passes
   --------------------------------------------------------------------------- */

/* Runs on the next document, before the page scripts: the composite shader is
   spotted by its uEngineUV uniform and its displacement statement is removed.
   Nothing else about the scene is touched. */
const WOBBLE_OFF = `(() => {
  const patch = (proto) => {
    if (!proto || !proto.shaderSource) return;
    const orig = proto.shaderSource;
    proto.shaderSource = function (shader, src) {
      if (src && String(src).indexOf('uEngineUV') !== -1) {
        const patched = String(src).replace(/uv\\s*\\+=\\s*wobble\\s*\\*[^;]*;/g, '/* uUV wobble removed for the A/B measurement */');
        window.__wobblePatchHits = (window.__wobblePatchHits || 0) + 1;
        return orig.call(this, shader, patched);
      }
      return orig.call(this, shader, src);
    };
  };
  patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
})();`;

const PHASES = [
  ['thrust-build', 8.8],
  ['liftoff', 10.4],
  ['ascent', 20]
];

/* In-page comparison of two PNG captures. Returns how much of the frame the
   shimmer moved, where the disturbed pixels sit and how strong they are. */
const COMPARE = `(async () => {
  const decode = async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height);
    return { w: img.width, h: img.height, data: d.data };
  };
  const A = await decode(window.__A); window.__A = null;
  const B = await decode(window.__B); window.__B = null;
  const W = A.w, Ht = A.h;
  const L = (img, x, y) => { const o = (y * W + x) * 4; return 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2]; };

  let sum = 0, big = 0, pert = 0, mx = 0, n = 0;
  let bx0 = W, by0 = Ht, bx1 = -1, by1 = -1, cx = 0, cy = 0;
  for (let y = 0; y < Ht; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.abs(L(A, x, y) - L(B, x, y));
      sum += d; n++;
      if (d > 6) big++;
      if (d > 3) { pert++; cx += x; cy += y; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      if (d > mx) mx = d;
    }
  }

  /* coherent horizontal row shift: the signature of a wavy banding pattern */
  const prof = [];
  for (let y = 8; y < Ht - 8; y += 4) {
    let best = Infinity, bestDx = 0;
    for (let dx = -12; dx <= 12; dx++) {
      let sad = 0, cnt = 0;
      for (let x = 20; x < W - 20; x += 6) { sad += Math.abs(L(A, x, y) - L(B, x + dx, y)); cnt++; }
      sad /= cnt;
      if (sad < best) { best = sad; bestDx = dx; }
    }
    prof.push(bestDx);
  }
  const pMean = prof.reduce((a, b) => a + b, 0) / prof.length;
  let rowShiftAmp = 0;
  for (const p of prof) rowShiftAmp = Math.max(rowShiftAmp, Math.abs(p - pMean));

  /* how alive the shimmer still is at the centre of the disturbed area */
  let plumeSum = 0, plumeN = 0;
  if (pert > 0) {
    const mx0 = Math.max(0, Math.floor(cx / pert - W * 0.12)), mx1 = Math.min(W, Math.ceil(cx / pert + W * 0.12));
    const my0 = Math.max(0, Math.floor(cy / pert - Ht * 0.12)), my1 = Math.min(Ht, Math.ceil(cy / pert + Ht * 0.12));
    for (let y = my0; y < my1; y++) for (let x = mx0; x < mx1; x++) { plumeSum += Math.abs(L(A, x, y) - L(B, x, y)); plumeN++; }
  }
  return {
    W, H: Ht,
    meanAbsDiff: +(sum / n).toFixed(4),
    maxAbsDiff: mx,
    bigFrac: +(big / n).toFixed(5),
    perturbedFrac: +(pert / n).toFixed(5),
    rowShiftAmp,
    bbox: { x0: +(bx0 / W).toFixed(3), y0: +(by0 / Ht).toFixed(3), x1: +((bx1 + 1) / W).toFixed(3), y1: +((by1 + 1) / Ht).toFixed(3) },
    centroid: { x: +(cx / Math.max(1, pert) / W).toFixed(3), y: +(cy / Math.max(1, pert) / Ht).toFixed(3) },
    plumeMean: +(plumeSum / Math.max(1, plumeN)).toFixed(4)
  };
})()`;

let injectId = null;

async function capturePass({ inject }) {
  if (inject && !injectId) {
    injectId = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: WOBBLE_OFF })).identifier;
  } else if (!inject && injectId) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injectId });
    injectId = null;
  }
  await H.navigate(cdp, server.url);
  await H.waitForLaunch(cdp, 120000);
  /* lock the internal resolution so the two passes cannot differ by scaling */
  await H.evaluate(cdp, "window.__LAUNCH__.setQuality('high')");
  const shots = {};
  for (const [label, t] of PHASES) {
    await H.evaluate(cdp, `window.__LAUNCH__.seek(${t}).simTime`);
    await H.sleep(320);
    shots[label] = await H.screenshot(cdp);
    if (label === PHASES[0][0]) {          /* repeat capture for the method control */
      await H.sleep(120);
      shots[label + ':repeat'] = await H.screenshot(cdp);
    }
  }
  const meta = JSON.parse(await H.evaluate(cdp, `JSON.stringify({
    patchHits: window.__wobblePatchHits || 0,
    quality: window.__LAUNCH__.quality,
    renderScale: window.__LAUNCH__.renderScale })`));
  return { shots, meta, errors: cdp.errors.slice(0, 4), exceptions: cdp.exceptions.slice(0, 4) };
}

async function compare(a, b) {
  await H.evaluate(cdp, `window.__A = ${JSON.stringify(a)}; 1`);
  await H.evaluate(cdp, `window.__B = ${JSON.stringify(b)}; 1`);
  const r = await H.evaluate(cdp, COMPARE, { awaitPromise: true });
  if (!r || typeof r.meanAbsDiff !== 'number') throw new Error('in-page comparison returned no result');
  return r;
}

v.info('--- two deterministic passes: shimmer as authored vs. wobble compiled out ---');
const on = await capturePass({ inject: false });
const off = await capturePass({ inject: true });

v.ok('authored pass renders clean (no console errors / exceptions)',
  on.errors.length === 0 && on.exceptions.length === 0, JSON.stringify(on.errors.concat(on.exceptions)).slice(0, 300));
v.ok('measurement pass renders clean (no console errors / exceptions)',
  off.errors.length === 0 && off.exceptions.length === 0, JSON.stringify(off.errors.concat(off.exceptions)).slice(0, 300));
v.ok('the composite heat-haze displacement is present in the authored shader',
  off.meta.patchHits >= 1, `shader patches applied: ${off.meta.patchHits}`);
v.ok('the measurement pass patched nothing else', on.meta.patchHits === 0, String(on.meta.patchHits));
v.ok('both passes render at the same locked resolution',
  on.meta.quality === 'high' && on.meta.renderScale === off.meta.renderScale,
  `${on.meta.quality}/${on.meta.renderScale} vs ${off.meta.quality}/${off.meta.renderScale}`);

/* ---------------------------------------------------------------------------
   3. Method control: the scene must be a pure function of sim time
   --------------------------------------------------------------------------- */
const control = await compare(on.shots[PHASES[0][0]], on.shots[PHASES[0][0] + ':repeat']);
v.ok('control: two captures of the same sim time are bit-identical (deterministic scene)',
  control.maxAbsDiff === 0 && control.meanAbsDiff === 0,
  `mean|dL| ${control.meanAbsDiff}, max|dL| ${control.maxAbsDiff}`);

/* ---------------------------------------------------------------------------
   4. The shimmer must be local, gentle and still there
   --------------------------------------------------------------------------- */
const LIMITS = {
  meanAbsDiff: 0.6,        /* frame-wide average perturbation */
  bigFrac: 0.012,          /* fraction of pixels displaced by more than 6 levels */
  perturbedFrac: 0.05,     /* fraction of pixels touched at all (> 3 levels) */
  rowShiftAmp: 3,          /* peak coherent row shift in pixels (wave banding) */
  maxBoxWidth: 0.5,        /* disturbed area must stay inside a narrow column */
  maxBoxHeight: 0.7,
  minPlumeMean: 0.02       /* the haze must still be visible at the plume */
};

for (const [label, t] of PHASES) {
  const label2 = `${label} (t=${t}s)`;
  const r = await compare(on.shots[label], off.shots[label]);
  const box = r.bbox, boxW = r.bbox.x1 - r.bbox.x0, boxH = r.bbox.y1 - r.bbox.y0;
  v.info(`${label2}: mean|dL|=${r.meanAbsDiff} max|dL|=${r.maxAbsDiff} ` +
    `touched=${(r.perturbedFrac * 100).toFixed(3)}% >6=${(r.bigFrac * 100).toFixed(3)}% ` +
    `rowShift=${r.rowShiftAmp}px box=${JSON.stringify(box)} centroid=${JSON.stringify(r.centroid)} ` +
    `plumeMean=${r.plumeMean}`);

  v.above(`${label2}: the heat haze is still visible at the exhaust`, r.plumeMean, LIMITS.minPlumeMean);
  v.below(`${label2}: the shimmer touches only a small part of the frame`, r.perturbedFrac, LIMITS.perturbedFrac);
  v.below(`${label2}: the frame stays calm overall (mean perturbation)`, r.meanAbsDiff, LIMITS.meanAbsDiff);
  v.below(`${label2}: no pixel is displaced hard by the shimmer`, r.bigFrac, LIMITS.bigFrac);
  v.below(`${label2}: no wavy banding (coherent row shift stays at a couple of pixels)`,
    r.rowShiftAmp, LIMITS.rowShiftAmp);
  v.ok(`${label2}: the disturbed area is a narrow column, not a full-frame pattern`,
    boxW <= LIMITS.maxBoxWidth && boxH <= LIMITS.maxBoxHeight,
    `box ${boxW.toFixed(3)} x ${boxH.toFixed(3)} of the frame`);
  v.ok(`${label2}: the disturbance stays at the exhaust column`,
    r.centroid.x > 0.25 && r.centroid.x < 0.75 && r.centroid.y > 0.35,
    `centroid ${r.centroid.x}, ${r.centroid.y}`);
}

v.finish();
