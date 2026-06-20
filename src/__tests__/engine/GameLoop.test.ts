// Unit tests for GameLoop - fixed-timestep update/render scheduling, pause
// behavior, FPS benchmark exposure, and resume-after-pause.
//
// These tests live under src/__tests__/engine/ (spec 9.1 testMatch pattern:
// '<rootDir>/src/**/__tests__/**/*.test.ts?(x)') and lock down the game-loop
// contract independently of the colocated per-module test.
//
// A fully controllable fake clock + rAF scheduler is injected so the loop is
// deterministic without real timers. The harness mirrors the pattern used in
// the colocated src/engine/GameLoop.test.ts.

import { GameLoop, STEP_MS } from '../../engine/GameLoop';

/**
 * Build a fake time/scheduler harness. `tick(ms, frameMs)` advances the
 * simulated clock in fixed increments, invoking the scheduled rAF callback for
 * each increment so the loop processes frames synchronously.
 */
function createHarness() {
  let currentTime = 0;
  let rafHandle = 0;
  const pending: Array<{ cb: (t: number) => void }> = [];

  const now = () => currentTime;

  const raf = (cb: (t: number) => void) => {
    rafHandle += 1;
    pending.push({ cb });
    return rafHandle;
  };

  const caf = (handle: number) => {
    const idx = pending.findIndex((_, i) => i === handle - 1);
    if (idx >= 0) pending.splice(idx, 1);
  };

  /** Advance simulated time by `totalMs` in `stepMs` increments. */
  const tick = (totalMs: number, stepMs = 16.67) => {
    let remaining = totalMs;
    while (remaining > 0) {
      const inc = Math.min(stepMs, remaining);
      currentTime += inc;
      // Drain any callbacks scheduled during the previous increment.
      const queued = pending.splice(0, pending.length);
      for (const { cb } of queued) cb(currentTime);
      remaining -= inc;
    }
  };

  return { now, raf, caf, tick };
}

describe('GameLoop (contract tests)', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    // Reset the benchmark hook to avoid cross-test pollution.
    delete window.__CITY_BENCHMARK__;
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('Test 1: runs update at ~20Hz over 100 frames at 16.67ms each', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.start();
    // 100 frames at 16.67ms each ~ 1667ms total simulated time.
    // start() resets lastTime = now() (=0), so the first frame's delta is
    // ~16.67ms. 1667ms / 50ms ~ 33.3 => 33 fixed-step updates.
    harness.tick(16.67 * 100, 16.67);

    const updateCount = update.mock.calls.length;
    // Spec: update called 33-34 times inclusive.
    expect(updateCount).toBeGreaterThanOrEqual(33);
    expect(updateCount).toBeLessThanOrEqual(34);

    // Each update receives the deterministic fixed dt (STEP_MS at speed 1).
    expect(update).toHaveBeenLastCalledWith(STEP_MS);

    // Render is called once per frame (100 frames).
    expect(render.mock.calls.length).toBeGreaterThanOrEqual(100);

    loop.stop();
  });

  it('Test 2: pauses updates at speed 0 while render continues', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.setSpeed(0);
    loop.start();
    // Advance 1000ms of simulated time while paused.
    harness.tick(1000, 16.67);

    // Update must NOT be called while paused.
    expect(update).not.toHaveBeenCalled();
    // Render continues every frame regardless of pause state.
    expect(render.mock.calls.length).toBeGreaterThan(0);

    loop.stop();
  });

  it('Test 3: exposes window.__CITY_BENCHMARK__ with fps and lastTickMs', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.start();
    // Advance enough fake time for at least one render frame.
    harness.tick(100, 16.67);

    expect(window.__CITY_BENCHMARK__).toBeDefined();
    expect(typeof window.__CITY_BENCHMARK__!.fps).toBe('number');
    expect(typeof window.__CITY_BENCHMARK__!.lastTickMs).toBe('number');

    loop.stop();
  });

  it('Test 4: resumes updates after pause (at least 5 updates in 250ms)', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.setSpeed(0);
    loop.start();
    // Advance 500ms while paused - no updates should fire. The accumulator
    // is capped at MAX_ACCUMULATOR_MS (250ms), so at most 250ms is banked.
    harness.tick(500, 16.67);
    expect(update).not.toHaveBeenCalled();

    // Resume at normal speed.
    loop.setSpeed(1);
    // Record the count at the moment of resume.
    const updatesBeforeResume = update.mock.calls.length;

    // Advance 250ms after resume => 250ms / 50ms = 5 fixed-step updates.
    // The banked accumulator (capped at 250ms) is consumed immediately on
    // resume, so the 250ms post-resume advance yields at least 5 updates.
    harness.tick(250, 16.67);

    const updatesAfterResume = update.mock.calls.length - updatesBeforeResume;
    expect(updatesAfterResume).toBeGreaterThanOrEqual(5);

    loop.stop();
  });
});
