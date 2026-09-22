/* ===========================================================================
   Headless behavioural + visual verification of the rocket launch scene.

   Drives the system Chromium (SwiftShader) over the raw Chrome DevTools
   Protocol from BOTH the file:// origin and a local http:// origin and checks:
     - zero console errors / exceptions, document + Three.js CDN only
     - exact full-bleed canvas at several viewport sizes, no overlay text/UI
     - the animation starts and advances on its own with no user input
     - the ordered cinematic sequence via deterministic __LAUNCH__.seek(t)
     - flames, plume, engine light, smoke, dust, sparks, vegetation reaction
     - clamp release strictly before the first vertical motion, monotonic climb
     - camera follow / rocket prominence / bounded decaying shake
     - cloud-layer interaction on the way up
     - screenshot pixel statistics: bright, vibrant daytime rendering at a
       high visual density in every sampled phase
     - a real-time soak with no frame stall greater than 0.5 s

   Exits non-zero with a phase-by-phase report on failure. If the sandbox has
   no outbound network the CDN probe fails loudly with CDN_UNREACHABLE.
   =========================================================================== */

import fs from 'node:fs';
import * as H from './lib/harness.mjs';

const v = new H.Verifier('verify-browser');
const cleanup = [];
process.on('exit', () => { for (const fn of cleanup) { try { fn(); } catch (e) { /* ignore */ } } });

/* ---------------------------------------------------------------------------
   0. CDN reachability — fail loudly rather than silently skipping the suite
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
v.info('browser: ' + (chrome.version.Browser || '?') + '  |  ' + (chrome.version['User-Agent'] || '').slice(0, 60));

const cdp = await chrome.newPage();
cleanup.push(() => cdp.close());

const EXPECT_DOCS = new Set([H.INDEX_FILE_URL, server.url, 'about:blank']);

async function assertLoadSurface(label, url, { fresh }) {
  await H.setViewport(cdp, 1280, 720);
  await H.navigate(cdp, url);
  let ready = true;
  try { await H.waitForLaunch(cdp, 120000); }
  catch (err) {
    ready = false;
    v.ok(`${label}: window.__LAUNCH__ becomes ready`, false, err.message);
    v.ok(`${label}: zero console errors`, cdp.errors.length === 0, JSON.stringify(cdp.errors).slice(0, 600));
    v.ok(`${label}: zero uncaught exceptions`, cdp.exceptions.length === 0, JSON.stringify(cdp.exceptions).slice(0, 600));
    return null;
  }
  v.ok(`${label}: window.__LAUNCH__ becomes ready`, ready);

  v.ok(`${label}: zero console errors`, cdp.errors.length === 0, JSON.stringify(cdp.errors).slice(0, 600));
  v.ok(`${label}: zero uncaught exceptions`, cdp.exceptions.length === 0, JSON.stringify(cdp.exceptions).slice(0, 600));

  const reqs = cdp.requests.map(r => r.url).filter(u => !/favicon/i.test(u));
  const unexpected = reqs.filter(u => !EXPECT_DOCS.has(u) && !H.THREE_HOSTS.some(h => u.startsWith('https://' + h + '/')));
  v.ok(`${label}: only the document and the Three.js CDN module are requested`,
    unexpected.length === 0, unexpected.join(', '));
  v.ok(`${label}: the Three.js module was actually fetched`,
    reqs.some(u => u.startsWith('https://') && u.includes('three')), reqs.join(', '));
  v.ok(`${label}: every response is a success`,
    cdp.responses.filter(r => !/favicon/i.test(r.url)).every(r => r.status >= 200 && r.status < 400),
    JSON.stringify(cdp.responses.filter(r => !/favicon/i.test(r.url)).map(r => r.status + ' ' + r.url)).slice(0, 400));

  /* full-bleed geometry */
  const geo = JSON.parse(await H.evaluate(cdp, `JSON.stringify((() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    const se = document.scrollingElement;
    return { w: r.width, h: r.height, l: r.left, t: r.top,
      iw: innerWidth, ih: innerHeight,
      sw: se.scrollWidth, sh: se.scrollHeight,
      bw: parseFloat(cs.borderTopWidth) + parseFloat(cs.borderLeftWidth),
      pad: parseFloat(cs.paddingTop) + parseFloat(cs.paddingLeft),
      mar: parseFloat(cs.marginTop) + parseFloat(cs.marginLeft),
      display: cs.display };
  })())`));
  v.near(`${label}: canvas width equals the viewport width`, geo.w, geo.iw, 0.6);
  v.near(`${label}: canvas height equals the viewport height`, geo.h, geo.ih, 0.6);
  v.near(`${label}: canvas offset is 0,0`, Math.abs(geo.l) + Math.abs(geo.t), 0, 0.5);
  v.ok(`${label}: no scroll overflow (document is exactly the viewport)`,
    geo.sw <= geo.iw && geo.sh <= geo.ih, `scroll ${geo.sw}x${geo.sh} vs viewport ${geo.iw}x${geo.ih}`);
  v.ok(`${label}: no borders, padding or margins on the canvas`,
    geo.bw === 0 && geo.pad === 0 && geo.mar === 0, JSON.stringify(geo));

  /* no overlay UI, no text, no extra visible DOM */
  const dom = JSON.parse(await H.evaluate(cdp, `JSON.stringify((() => {
    const bad = [];
    document.querySelectorAll('body *').forEach(el => {
      const tag = el.tagName;
      if (tag === 'CANVAS' || tag === 'SCRIPT' || tag === 'STYLE') return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) bad.push(tag + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    return { bad, text: document.body.innerText.trim(), canvasCount: document.querySelectorAll('canvas').length,
      bodyChildren: document.body.children.length };
  })())`));
  v.ok(`${label}: document.body.innerText is empty (no titles/captions/HUD)`, dom.text === '', JSON.stringify(dom.text).slice(0, 120));
  v.ok(`${label}: no visible element other than the scene canvas`, dom.bad.length === 0, dom.bad.join(', '));
  v.ok(`${label}: exactly one canvas in the document`, dom.canvasCount === 1, String(dom.canvasCount));

  /* the animation must start by itself (measured after the shaders and the
     adaptive quality controller have settled) */
  for (let i = 0; i < 240; i++) {
    if ((await H.evaluate(cdp, 'window.__LAUNCH__.frames')) >= 14) break;
    await H.sleep(250);
  }
  const before = JSON.parse(await H.evaluate(cdp, 'JSON.stringify(window.__LAUNCH__.sample())'));
  await H.sleep(5000);
  const after = JSON.parse(await H.evaluate(cdp, 'JSON.stringify(window.__LAUNCH__.sample())'));
  v.ok(`${label}: simulation time advances with no user input`,
    after.simTime > before.simTime + 2, `${before.simTime} -> ${after.simTime}`);
  v.ok(`${label}: frame counter advances`, after.frames > before.frames, `${before.frames} -> ${after.frames}`);
  v.ok(`${label}: flame/engine state evolves by itself`,
    after.flame.intensity >= before.flame.intensity && after.engineLight.intensity >= before.engineLight.intensity,
    `flame ${before.flame.intensity} -> ${after.flame.intensity}`);
  return after;
}

const fileSample = await assertLoadSurface('file://', H.INDEX_FILE_URL, { fresh: true });
if (!fileSample) v.finish();
const httpSample = await assertLoadSurface('http://127.0.0.1', server.url, { fresh: true });

/* ---------------------------------------------------------------------------
   2. Deterministic sequence matrix (seek-driven, render-speed independent)
   --------------------------------------------------------------------------- */
v.info('--- phase matrix ---');
const cache = new Map();
async function at(t) {
  const key = t.toFixed(2);
  if (cache.has(key)) return cache.get(key);
  const s = JSON.parse(await H.evaluate(cdp, `JSON.stringify(window.__LAUNCH__.seek(${t}))`));
  cache.set(key, s);
  return s;
}

const pre = await at(1.0);
const ign1 = await at(4.0);
const ign2 = await at(7.0);
const full = await at(8.8);
const justBeforeRelease = await at(9.5);
const afterRelease = await at(9.8);
const stillHeld = await at(9.9);
const justAfterLift = await at(10.4);

/* 2a. calm pre-launch */
v.ok('pre-launch: engines are not lit yet', pre.flame.intensity === 0 && pre.engineLight.intensity === 0,
  `flame ${pre.flame.intensity}, light ${pre.engineLight.intensity}`);
v.ok('pre-launch: the rocket still sits on the pad', pre.rocket.altitude === 0 && pre.clamps.released === false,
  `alt ${pre.rocket.altitude}, released ${pre.clamps.released}`);
v.ok('pre-launch: light smoke is already drifting', pre.smoke.particleCount > 0, String(pre.smoke.particleCount));
v.ok('pre-launch: vegetation and props are quiescent',
  pre.vegetation.displacement < 0.01 && pre.props.displacement < 0.5,
  `veg ${pre.vegetation.displacement}, props ${pre.props.displacement}`);
v.ok('pre-launch: no sparks/embers flying yet', pre.particles.active === 0, String(pre.particles.active));

/* 2b. ordered phases */
const sweepTimes = [];
for (let t = 0; t <= 14; t += 0.25) sweepTimes.push(+t.toFixed(2));
for (let t = 14.5; t <= 60; t += 1) sweepTimes.push(+t.toFixed(2));
const sweep = [];
for (const t of sweepTimes) sweep.push({ t, s: await at(t) });
let ordered = true, lastIdx = -1, worstOrder = '';
for (const { t, s } of sweep) {
  if (s.phaseIndex < lastIdx) { ordered = false; worstOrder = `t=${t} index ${s.phaseIndex} after ${lastIdx}`; }
  lastIdx = s.phaseIndex;
}
v.ok('phases never run out of order across the whole timeline', ordered, worstOrder);
const names = ['prelaunch', 'ignition', 'thrust-build', 'clamps-released', 'liftoff', 'ascent', 'cloud-climb'];
const seqNames = sweep.filter((e, i) => i === 0 || e.s.phaseIndex !== sweep[i - 1].s.phaseIndex).map(e => e.s.phase);
let sub = 0;
for (const n of seqNames) if (n === names[sub]) sub++;
v.ok('phase sequence follows the planned order', sub === seqNames.length && seqNames.length >= 5,
  seqNames.join(' -> '));
for (const [t, expected] of [[1.0, 'prelaunch'], [3.5, 'ignition'], [6.5, 'thrust-build'],
  [9.7, 'clamps-released'], [10.2, 'liftoff'], [13.5, 'ascent'], [40, 'cloud-climb']]) {
  const s = await at(t);
  v.ok(`phase at t=${t}s is "${expected}"`, s.phase === expected, s.phase);
}

/* 2c. strictly increasing ignition -> thrust build */
function strictlyIncreasing(key) {
  let ok = true, prev = -Infinity, worst = '';
  for (let t = 3.0; t <= 8.9; t += 0.4) {
    const s = cache.get(t.toFixed(2)) || null;
    if (!s) return { ok: false, worst: 'missing sample ' + t };
    const val = key(s);
    if (!(val > prev)) { ok = false; worst = `t=${t.toFixed(2)} ${val} <= ${prev}`; }
    prev = val;
  }
  return { ok, worst };
}
for (let t = 3.0; t <= 8.9; t += 0.4) await at(t);
for (const [label, key] of [
  ['flame intensity', s => s.flame.intensity],
  ['exhaust plume length', s => s.flame.plumeLength],
  ['engine light intensity', s => s.engineLight.intensity],
  ['engine plume light', s => s.engineLight.glow],
  ['smoke particle count', s => s.smoke.particleCount],
  ['ground smoke spread radius', s => s.smoke.groundRadius],
  ['rocket vibration', s => s.rocket.vibration]
]) {
  const r = strictlyIncreasing(key);
  v.ok(`thrust build: ${label} increases monotonically from ignition to liftoff`, r.ok, r.worst);
}
v.ok('flames are multi-layered (bright core + mid flame + long plume)',
  full.flame.layerCount >= 3 && full.flame.visible, `layers ${full.flame.layerCount}`);
v.ok('the exhaust plume is dozens of metres long at full thrust', full.flame.plumeLength > 100,
  String(full.flame.plumeLength));

/* 2d. clamp release strictly before liftoff */
v.ok('clamps are still holding just before release', justBeforeRelease.clamps.released === false);
v.ok('clamps release at the planned time', afterRelease.clamps.released === true && afterRelease.clamps.angle > 0,
  `released ${afterRelease.clamps.released}, angle ${afterRelease.clamps.angle}`);
v.ok('rocket stays on the pad until release (within tolerance)',
  justBeforeRelease.rocket.altitude === 0 && stillHeld.rocket.altitude === 0,
  `${justBeforeRelease.rocket.altitude} / ${stillHeld.rocket.altitude}`);
v.ok('rocket first moves only after the release command',
  justAfterLift.rocket.altitude > 0 && justAfterLift.clamps.released === true, String(justAfterLift.rocket.altitude));
v.ok('clamp release time is strictly before the first upward motion',
  justBeforeRelease.clamps.releaseTime < justAfterLift.simTime && justBeforeRelease.clamps.released === false &&
  justAfterLift.clamps.released === true, `release ${justBeforeRelease.clamps.releaseTime}, lift ${justAfterLift.simTime}`);
v.ok('vibration rises before liftoff and is bounded',
  pre.rocket.vibration < 0.02 && full.rocket.vibration > 0.05 && full.rocket.vibration < 2,
  `pre ${pre.rocket.vibration}, thrust ${full.rocket.vibration}`);

/* 2e. monotonic, powerful climb */
const climbTimes = [10.4, 12, 15, 20, 25, 30.5, 40, 50, 60];
const climb = [];
for (const t of climbTimes) climb.push(await at(t));
let altOk = true, velOk = true, worstAlt = '';
for (let i = 1; i < climb.length; i++) {
  if (!(climb[i].rocket.altitude > climb[i - 1].rocket.altitude)) {
    altOk = false; worstAlt = `${climbTimes[i - 1]}->${climbTimes[i]}: ${climb[i - 1].rocket.altitude} -> ${climb[i].rocket.altitude}`;
  }
  if (climb[i].rocket.velocity < climb[i - 1].rocket.velocity) velOk = false;
}
v.ok('altitude increases monotonically after liftoff', altOk, worstAlt);
v.ok('velocity never decreases and acceleration is positive', velOk && climb.every(c => c.rocket.acceleration >= 0));
v.ok('the climb is smooth, not instant (velocity ramps up over time)',
  climb[0].rocket.velocity < climb[3].rocket.velocity && climb[0].rocket.velocity > 0,
  `${climb[0].rocket.velocity} -> ${climb[3].rocket.velocity}`);
v.above('the rocket reaches a high altitude by the end of the sequence', climb[climb.length - 1].rocket.altitude, 2000);
v.ok('the plume length keeps changing with altitude during the climb',
  justAfterLift.flame.plumeLength < climb[3].flame.plumeLength &&
  climb[3].flame.plumeLength < climb[climb.length - 1].flame.plumeLength,
  `${justAfterLift.flame.plumeLength} -> ${climb[3].flame.plumeLength} -> ${climb[climb.length - 1].flame.plumeLength}`);

/* 2f. smoke, dust and secondary particles */
v.above('smoke particle count grows substantially during thrust build',
  full.smoke.particleCount, ign1.smoke.particleCount * 2);
v.above('ground smoke spread radius keeps expanding after liftoff',
  climb[4].smoke.groundRadius, climb[0].smoke.groundRadius * 1.4);
v.above('pad-area smoke continues to spread late in the sequence',
  climb[climb.length - 1].smoke.groundRadius, climb[4].smoke.groundRadius);
v.ok('sparks, embers and debris particles are all active during thrust',
  full.particles.sparks > 0 && full.particles.embers > 0 && full.particles.debris > 0,
  JSON.stringify(full.particles));
v.ok('particle systems have distinct motion regimes (different counts/lifetimes)',
  full.particles.sparks !== full.particles.embers || full.particles.embers !== full.particles.debris,
  JSON.stringify(full.particles));
v.ok('smoke keeps rolling/rising rather than sitting still (radius + count grow together)',
  climb[2].smoke.groundRadius > climb[1].smoke.groundRadius && climb[2].smoke.particleCount >= climb[1].smoke.particleCount);

/* 2g. exhaust reaction of nearby vegetation and loose objects */
v.ok('vegetation displacement is zero at idle and grows with thrust',
  pre.vegetation.displacement < 0.01 && full.vegetation.displacement > pre.vegetation.displacement + 0.4,
  `${pre.vegetation.displacement} -> ${full.vegetation.displacement}`);
v.ok('loose objects are blown by the exhaust as thrust builds',
  pre.props.displacement < 0.5 && full.props.displacement > 10, `${pre.props.displacement} -> ${full.props.displacement}`);

/* 2h. camera rig: prominence, follow and bounded shake */
const camTimes = [1.5, 5, 8.8, 10.5, 16, 25, 30.5, 40, 60];
const cams = [];
for (const t of camTimes) cams.push({ t, s: await at(t) });
const padPhases = cams.filter(c => c.t <= 8.8);
const late = cams.filter(c => c.t >= 10.5);
v.ok('rocket stays large and prominent on the pad (>= 45% of viewport height)',
  padPhases.every(c => c.s.rocket.projectedScreenHeight >= 0.45),
  padPhases.map(c => `${c.t}:${c.s.rocket.projectedScreenHeight.toFixed(3)}`).join(' '));
v.ok('rocket stays prominent for the whole climb (>= 25% of viewport height)',
  late.every(c => c.s.rocket.projectedScreenHeight >= 0.25),
  late.map(c => `${c.t}:${c.s.rocket.projectedScreenHeight.toFixed(3)}`).join(' '));
v.ok('the cinematic camera follows the rocket with bounded error',
  cams.every(c => c.s.camera.followError < 0.5),
  cams.map(c => `${c.t}:${c.s.camera.followError.toFixed(3)}`).join(' '));
v.ok('the camera rises with the rocket and reveals the landscape below',
  cams[cams.length - 1].s.camera.y > cams[0].s.camera.y + 1000,
  `${cams[0].s.camera.y.toFixed(0)} -> ${cams[cams.length - 1].s.camera.y.toFixed(0)}`);
const shakeLift = (await at(9.8)).camera.shake;
const shakeMid = (await at(16)).camera.shake;
const shakeLate = (await at(22)).camera.shake;
const shakeEnd = (await at(40)).camera.shake;
v.ok('camera shake is present from ignition and peaks around liftoff',
  ign1.camera.shake > 0.01 && afterRelease.camera.shake > 0.3,
  `ignition ${ign1.camera.shake}, liftoff ${afterRelease.camera.shake}`);
v.ok('camera shake decays after liftoff and never becomes unwatchable',
  shakeLift > shakeMid && shakeMid > shakeLate && shakeLate > shakeEnd && shakeLift < 2.0,
  `${shakeLift.toFixed(3)} > ${shakeMid.toFixed(3)} > ${shakeLate.toFixed(3)} > ${shakeEnd.toFixed(3)}`);

/* 2i. layered clouds + rocket interaction */
const cloudPass = await at(30.5);
v.ok('cloud layers at several altitudes are configured', cloudPass.clouds.layers.length >= 3,
  JSON.stringify(cloudPass.clouds.layers));
v.ok('the rocket climbs into a cloud layer as it ascends',
  cloudPass.clouds.insideLayer === true && cloudPass.clouds.localDensity > 0,
  `layer ${cloudPass.clouds.layerIndex}, density ${cloudPass.clouds.localDensity}`);
v.ok('the rocket is not inside a cloud while still on the pad', pre.clouds.insideLayer === false);

/* ---------------------------------------------------------------------------
   3. Screenshot pixel statistics (bright, vibrant, dense daytime rendering)
   --------------------------------------------------------------------------- */
v.info('--- rendered pixel statistics ---');
const SHOT_PHASES = [
  { label: 'pad', t: 1.5 },
  { label: 'ignition-thrust', t: 8.8 },
  { label: 'liftoff', t: 10.6 },
  { label: 'mid-ascent', t: 20 },
  { label: 'cloud-pass', t: 30.5 },
  { label: 'high-altitude', t: 60 }
];
const shots = {};
// Full-quality capture: the adaptive controller may have reduced the internal
// resolution during the previous assertions, and the visual bar must be judged
// on the scene as authored.
await H.evaluate(cdp, "window.__LAUNCH__.setQuality('high')");
for (const p of SHOT_PHASES) {
  await H.evaluate(cdp, `window.__LAUNCH__.seek(${p.t}).simTime`);
  await H.sleep(320);
  const b64 = await H.screenshot(cdp);
  const all = await H.pixelStats(cdp, b64);
  const below = await H.pixelStats(cdp, b64, { x0: 0, y0: 0.55, x1: 1, y1: 1 });
  const upper = await H.pixelStats(cdp, b64, { x0: 0, y0: 0, x1: 1, y1: 0.30 });
  shots[p.label] = { all, below, upper };
  v.info(`${p.label.padEnd(15)} lum=${all.meanLuminance.toFixed(1)} sat=${all.meanSaturation.toFixed(3)} ` +
    `blue=${all.blueSkyFraction.toFixed(3)} nonSky=${all.nonSkyContentFraction.toFixed(3)} ` +
    `grad=${all.meanGradient.toFixed(2)} edges=${all.edgeFraction.toFixed(3)} ` +
    `| below: blue=${below.blueSkyFraction.toFixed(2)} grad=${below.meanGradient.toFixed(2)} ` +
    `| upper: blue=${upper.blueSkyFraction.toFixed(2)} sat=${upper.meanSaturation.toFixed(2)}`);
  if (p.label === 'pad' || p.label === 'cloud-pass') {
    const dir = '/tmp/coroid-shots';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${p.label}.png`, Buffer.from(b64, 'base64'));
  }
}
for (const p of SHOT_PHASES) {
  const s = shots[p.label].all;
  const hist = s.histogram;
  const spread = hist.filter(x => x > 0.015).length;
  const dark = hist.slice(0, 4).reduce((a, b) => a + b, 0);
  v.above(`${p.label}: bright daytime exposure (mean luminance)`, s.meanLuminance, 90);
  v.below(`${p.label}: not blown out to flat white`, s.meanLuminance, 236);
  v.above(`${p.label}: vibrant colour (mean saturation)`, s.meanSaturation, 0.12);
  v.ok(`${p.label}: wide tonal range (>= 5 luminance bins above 1.5%)`, spread >= 5,
    `${spread} bins :: ${JSON.stringify(hist.map(x => +x.toFixed(3)))}`);
  v.ok(`${p.label}: no single-tone wash (no bin holds most of the frame)`, Math.max(...hist) < 0.75,
    JSON.stringify(hist.map(x => +x.toFixed(3))));
  v.above(`${p.label}: scene detail/density (mean luminance gradient)`, s.meanGradient, 1.5);
  v.above(`${p.label}: visual density (non-sky content fraction)`, s.nonSkyContentFraction, 0.22);
  if (p.t <= 10.6) {
    // near the pad there are shadowed structures, trench and underside detail
    v.above(`${p.label}: shadowed structure present (dark pixel fraction)`, dark, 0.004);
  } else {
    v.above(`${p.label}: some dark structure survives the atmospheric haze`, dark, 0.001);
  }
}
v.above('pad phase: the launch site and terrain fill the lower frame',
  shots['pad'].below.nonSkyContentFraction, 0.5);
v.above('cloud-pass: blue sky is still strongly visible at altitude',
  shots['cloud-pass'].upper.blueSkyFraction, 0.25);
v.above('cloud-pass: the launch pad has been left far below (camera rose with the rocket)',
  (await at(30.5)).camera.y, 800);
v.above('cloud-pass: content is visible below the rocket (landscape + clouds)',
  shots['cloud-pass'].below.nonSkyContentFraction, 0.5);

/* ---------------------------------------------------------------------------
   4. Viewport / resize matrix
   --------------------------------------------------------------------------- */
v.info('--- viewport matrix ---');
for (const [w, h] of [[1280, 720], [960, 540], [720, 1280], [1600, 900]]) {
  await H.setViewport(cdp, w, h);
  await H.evaluate(cdp, 'window.__LAUNCH__.play().valueOf()');
  await H.sleep(700);
  const geo = JSON.parse(await H.evaluate(cdp, `JSON.stringify((() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    const se = document.scrollingElement;
    return { w: r.width, h: r.height, l: r.left, t: r.top, iw: innerWidth, ih: innerHeight,
      sw: se.scrollWidth, sh: se.scrollHeight };
  })())`));
  v.ok(`${w}x${h}: canvas is exactly full-bleed`,
    Math.abs(geo.w - w) < 1 && Math.abs(geo.h - h) < 1 && Math.abs(geo.l) < 0.5 && Math.abs(geo.t) < 0.5 &&
    geo.sw <= w && geo.sh <= h, JSON.stringify(geo));
  const a = await H.evaluate(cdp, 'window.__LAUNCH__.simTime');
  await H.sleep(900);
  const b = await H.evaluate(cdp, 'window.__LAUNCH__.simTime');
  v.ok(`${w}x${h}: animation continues across the resize`, b > a, `${a} -> ${b}`);
}
await H.setViewport(cdp, 1280, 720);
await H.evaluate(cdp, "window.__LAUNCH__.setQuality('auto')");

/* ---------------------------------------------------------------------------
   5. Real-time soak: no frame stall greater than 0.5 s
   --------------------------------------------------------------------------- */
v.info('--- 20s real-time soak at 960x540 (software rendering) ---');
await H.setViewport(cdp, 960, 540);
// Let the adaptive quality controller settle before measuring so the soak
// measures the render loop, not the one-off cost of retargeting it.
await H.evaluate(cdp, "window.__LAUNCH__.setQuality('auto'); window.__LAUNCH__.seek(14); window.__LAUNCH__.play(); 1");
await H.sleep(8000);
await H.evaluate(cdp, 'window.__LAUNCH__.restart().simTime');
await H.sleep(4000);
await H.evaluate(cdp, `(window.__SOAK__ = { max: 0, last: performance.now(), n: 0 },
  (function tick(){ const now = performance.now();
    if (window.__SOAK__.n > 0) window.__SOAK__.max = Math.max(window.__SOAK__.max, now - window.__SOAK__.last);
    window.__SOAK__.last = now; window.__SOAK__.n++; requestAnimationFrame(tick); })(), true)`);
const soakStart = JSON.parse(await H.evaluate(cdp, 'JSON.stringify(window.__LAUNCH__.sample())'));
const soakWall = Date.now();
await H.sleep(20000);
const soakSeconds = (Date.now() - soakWall) / 1000;
const soak = JSON.parse(await H.evaluate(cdp, 'JSON.stringify(window.__SOAK__)'));
const soakEnd = JSON.parse(await H.evaluate(cdp, 'JSON.stringify(window.__LAUNCH__.sample())'));
v.info(`soak: ${soak.n} frames in ${soakSeconds.toFixed(1)}s (~${(soak.n / soakSeconds).toFixed(1)} fps software-rendered), max frame gap ${soak.max.toFixed(0)}ms`);
v.above('soak: the render loop keeps producing frames', soak.n, 20);
v.below('soak: no frame stall greater than 0.5 s', soak.max, 500);
v.above('soak: animation time keeps advancing in real time',
  soakEnd.simTime - soakStart.simTime, soakSeconds * 0.6);
v.above('soak: the smoke/dust state kept evolving', soakEnd.smoke.particleCount, soakStart.smoke.particleCount + 50);
v.above('soak: the rocket lifted off and climbed during the soak', soakEnd.rocket.altitude, 1);
v.ok('soak: no console errors accumulated during real-time play',
  cdp.errors.length === 0 && cdp.exceptions.length === 0,
  JSON.stringify(cdp.errors.concat(cdp.exceptions)).slice(0, 400));

/* ---------------------------------------------------------------------------
   6. Quality presets (after the soak so shader recompiles cannot skew it)
   --------------------------------------------------------------------------- */
const qq = JSON.parse(await H.evaluate(cdp, `JSON.stringify({
  low: window.__LAUNCH__.setQuality('low'), lowScale: window.__LAUNCH__.renderScale,
  then: window.__LAUNCH__.setQuality('auto'), autoScale: window.__LAUNCH__.renderScale })`));
v.ok('setQuality("low") reduces the render budget', qq.lowScale < 0.6, JSON.stringify(qq));
v.ok('setQuality("auto") returns the scene to adaptive quality', qq.autoScale >= qq.lowScale, JSON.stringify(qq));

v.finish();
