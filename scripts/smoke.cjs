// Runtime smoke test for the engine modules. Compiled output is loaded
// from .runtime-out/engine/. This file is excluded from the real build.
const { Camera, GameLoop } = require('../.runtime-out/engine/index.js');

let passed = 0;
let failed = 0;
const assert = (cond, msg) => {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
};

// ---- Camera tests ----
console.log('Camera:');
{
  const cam = new Camera({ initial: { x: 0, y: 0, zoom: 1 }, minZoom: 0.5, maxZoom: 4 });
  const t0 = cam.getTransform();
  assert(t0.x === 0 && t0.y === 0 && t0.zoom === 1, 'starts at initial');

  cam.pan(5, -3);
  const tgt = cam.getTarget();
  assert(tgt.x === 5 && tgt.y === -3, 'pan updates target');

  // Initial current should still be at 0,0 before update()
  assert(cam.getTransform().x === 0, 'current lags target before update');

  // After a couple of updates it should approach target
  cam.update(0.5);
  cam.update(0.5);
  const t1 = cam.getTransform();
  assert(t1.x > 0 && t1.x <= 5, 'current converges toward target x');
  assert(t1.y < 0 && t1.y >= -3, 'current converges toward target y');

  // Zoom clamp
  cam.setZoom(999);
  assert(cam.getTarget().zoom === 4, 'zoom clamped to maxZoom');
  cam.setZoom(0.001);
  assert(cam.getTarget().zoom === 0.5, 'zoom clamped to minZoom');

  // Pan clamp
  const c2 = new Camera({ initial: { x: 0, y: 0, zoom: 1 }, minX: -10, maxX: 10, minY: -10, maxY: 10 });
  c2.pan(100, 100);
  assert(c2.getTarget().x === 10 && c2.getTarget().y === 10, 'pan clamped to bounds');
  c2.pan(-1000, -1000);
  assert(c2.getTarget().x === -10 && c2.getTarget().y === -10, 'pan clamped to min bounds');

  // zoomAt keeps anchor world point stable
  const c3 = new Camera({ initial: { x: 0, y: 0, zoom: 1 } });
  // Anchor at center (0.5, 0.5) -> world point (0, 0) under focus.
  c3.zoomAt(2, 0.5, 0.5);
  // World under anchor should still be (0, 0).
  const p = c3.worldToScreen(0, 0);
  assert(Math.abs(p.sx - 0.5) < 1e-9 && Math.abs(p.sy - 0.5) < 1e-9, 'zoomAt keeps center anchored');

  // snap()
  const c4 = new Camera();
  c4.pan(7, 9);
  c4.snap();
  const t4 = c4.getTransform();
  assert(t4.x === 7 && t4.y === 9, 'snap() copies target to current');
}

// ---- GameLoop tests ----
console.log('GameLoop:');
{
  const loop = new GameLoop({ fixedStepSeconds: 0.05, maxStepsPerFrame: 5, maxCatchupSeconds: 0.25 });
  assert(loop.getFixedStep() === 0.05, 'fixed step is 0.05 (20Hz)');
  assert(!loop.isRunning(), 'starts not running');

  // Use a fake rAF that drives ticks deterministically.
  const frames = [
    0,        // first tick: seeds lastTimestamp, no steps
    50,       // +50ms -> 1 step
    100,      // +50ms -> 1 step
    1000,     // +900ms -> would be 18 steps, but capped at 5, then discard
    1050,     // +50ms -> 1 step (accumulator was zeroed)
  ];

  let stepCount = 0;
  let renderCount = 0;
  let lastFixedDt = -1;
  loop.onStep((dt) => { stepCount++; lastFixedDt = dt; });
  loop.onRender(() => { renderCount++; });

  // Replace rAF with a manual driver.
  const origRaf = global.requestAnimationFrame;
  const origCancel = global.cancelAnimationFrame;
  let i = 0;
  global.requestAnimationFrame = (cb) => {
    if (i >= frames.length) return 0;
    const ts = frames[i++];
    setImmediate(() => cb(ts));
    return i;
  };
  global.cancelAnimationFrame = () => {};

  loop.start();

  // Wait for the queue to drain
  setTimeout(() => {
    loop.stop();
    global.requestAnimationFrame = origRaf;
    global.cancelAnimationFrame = origCancel;

    // Frames: 5 total. Steps: frame0=0, frame1=1, frame2=1, frame3=capped@5, frame4=1 => 8
    assert(renderCount === 5, `rendered every frame (got ${renderCount})`);
    assert(stepCount === 8, `stepped 8 times across frames (got ${stepCount})`);
    assert(lastFixedDt === 0.05, 'fixed dt is the configured 0.05s');
    assert(!loop.isRunning(), 'stops on stop()');

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  }, 200);
}
