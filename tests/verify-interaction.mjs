/* ===========================================================================
   Optional camera-control behaviour check.

   The scene ships subtle drag-orbit + wheel/pinch zoom that must never hide
   the rocket or break the full-bleed composition, and must hand the shot back
   to the cinematic rig once the pointer goes idle.

   Dispatches real pointer/wheel input over the canvas and asserts the view
   actually moves. Exits 0 with a SKIPPED line only when the headless
   environment cannot deliver input events at all; exits non-zero if the
   controls are advertised but the view does not respond.
   =========================================================================== */

import * as H from './lib/harness.mjs';

const v = new H.Verifier('verify-interaction');
const cleanup = [];
process.on('exit', () => { for (const fn of cleanup) { try { fn(); } catch (e) { /* ignore */ } } });

const chrome = await H.launchChromium({ width: 1280, height: 720 });
cleanup.push(() => chrome.close());
const cdp = await chrome.newPage();
cleanup.push(() => cdp.close());

const vp = { w: 1280, h: 720 };
await H.setViewport(cdp, vp.w, vp.h);
await H.navigate(cdp, H.INDEX_FILE_URL);
try {
  await H.waitForLaunch(cdp, 120000);
} catch (err) {
  v.ok('scene becomes ready for the interaction check', false, err.message);
  v.finish();
}
for (let i = 0; i < 240; i++) {
  if ((await H.evaluate(cdp, 'window.__LAUNCH__.frames')) >= 12) break;
  await H.sleep(250);
}

async function sample() {
  return JSON.parse(await H.evaluate(cdp, 'JSON.stringify(window.__LAUNCH__.sample())'));
}
async function viewport() {
  return JSON.parse(await H.evaluate(cdp, `JSON.stringify((() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    const se = document.scrollingElement;
    return { w: r.width, h: r.height, l: r.left, t: r.top, iw: innerWidth, ih: innerHeight,
      sw: se.scrollWidth, sh: se.scrollHeight };
  })())`));
}

/* --- hold the shot on the pad so the camera measurements are stable ------- */
await H.evaluate(cdp, 'window.__LAUNCH__.seek(6).simTime');
await H.sleep(600);

let inputAvailable = true;
try {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10, button: 'none', buttons: 0 });
} catch (err) {
  inputAvailable = false;
}
if (!inputAvailable) {
  console.log('SKIPPED: this headless environment cannot dispatch input events');
  process.exit(0);
}

const start = await sample();
v.info(`start: azimuth=${start.camera.azimuth.toFixed(3)} distance=${start.camera.distance.toFixed(1)} ` +
  `rocketScreenHeight=${start.rocket.projectedScreenHeight.toFixed(3)}`);

/* --- pointer drag: orbit around the rocket -------------------------------- */
const cx = vp.w / 2, cy = vp.h / 2;
const beforeDrag = await sample();
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 12; i++) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(cx + i * 18), y: Math.round(cy + Math.sin(i / 3) * 10),
    button: 'left', buttons: 1
  });
  await H.sleep(40);
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 216, y: cy, button: 'left', buttons: 0, clickCount: 1 });
await H.sleep(400);
const afterDrag = await sample();
const azDelta = Math.abs(afterDrag.camera.azimuth - beforeDrag.camera.azimuth);
v.above('dragging the pointer orbits the view around the rocket', azDelta, 0.05);
v.above('the rocket stays prominent during the orbit', afterDrag.rocket.projectedScreenHeight, 0.25);
const vpDrag = await viewport();
v.ok('the canvas stays full-bleed during the orbit',
  Math.abs(vpDrag.w - vp.w) < 1 && Math.abs(vpDrag.h - vp.h) < 1 && vpDrag.sw <= vp.w && vpDrag.sh <= vp.h,
  JSON.stringify(vpDrag));

/* --- wheel: zoom in, then confirm the rig takes the shot back ------------- */
const beforeZoom = await sample();
for (let i = 0; i < 3; i++) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -300, button: 'none', buttons: 0 });
  await H.sleep(120);
}
await H.sleep(600);
const afterZoom = await sample();
const zoomDelta = Math.abs(afterZoom.camera.distance - beforeZoom.camera.distance);
v.above('the mouse wheel changes the camera distance', zoomDelta, 5,
  `${beforeZoom.camera.distance.toFixed(1)} -> ${afterZoom.camera.distance.toFixed(1)}`);
v.above('the rocket stays prominent while zooming', afterZoom.rocket.projectedScreenHeight, 0.25);

/* --- the cinematic rig must take over again when left alone --------------- */
await H.sleep(8000);
const idleEnd = await sample();
v.ok('the cinematic rig drifts back to the authored framing once idle',
  Math.abs(idleEnd.camera.distance - beforeZoom.camera.distance) < zoomDelta * 0.4,
  `cinematic ${beforeZoom.camera.distance.toFixed(1)}, zoomed ${afterZoom.camera.distance.toFixed(1)}, ` +
  `after idle ${idleEnd.camera.distance.toFixed(1)}`);
v.ok('the orbit angle also returns to the authored framing',
  Math.abs(idleEnd.camera.azimuth - beforeDrag.camera.azimuth) < 0.5,
  `${idleEnd.camera.azimuth.toFixed(3)} vs cinematic ${beforeDrag.camera.azimuth.toFixed(3)}`);
v.ok('no console errors were produced by the interaction',
  cdp.errors.length === 0 && cdp.exceptions.length === 0,
  JSON.stringify(cdp.errors.concat(cdp.exceptions)).slice(0, 400));

/* --- the scene keeps animating afterwards --------------------------------- */
await H.evaluate(cdp, 'window.__LAUNCH__.play().valueOf()');
const running = await sample();
await H.sleep(2500);
const later = await sample();
v.ok('the scene is still animating after the interaction', later.simTime > running.simTime + 0.5,
  `${running.simTime} -> ${later.simTime}`);
v.above('the rocket stays prominent after the interaction', later.rocket.projectedScreenHeight, 0.25);

v.finish();
