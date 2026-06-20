/**
 * Unit tests for GameLoop — fixed-timestep scheduling, pause behavior,
 * speed multipliers, accumulator cap, FPS logging, and benchmark publishing.
 *
 * A fully controllable fake clock + rAF scheduler is injected so the loop is
 * deterministic without real timers.
 */

import {
  GameLoop,
  STEP_MS,
  MAX_ACCUMULATOR_MS,
} from './GameLoop';

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
    // Remove the matching pending callback (if still queued).
    const idx = pending.findIndex((_, i) => i === handle - 1);
    if (idx >= 0) pending.splice(idx, 1);
  };

  /** Advance simulated time by `totalMs` in `stepMs` increments. */
  const tick = (totalMs: number, stepMs = 16) => {
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

  return { now, raf, caf, tick, get currentTime() { return currentTime; } };
}

describe('GameLoop', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('runs update at ~20Hz (50ms steps) over 5000ms of simulated time', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.start();
    // 5000ms / 50ms = 100 expected update ticks.
    harness.tick(5000, 16);

    expect(update).toHaveBeenCalledTimes(100);
    // Each update receives the deterministic fixed dt (50ms at speed 1).
    expect(update).toHaveBeenLastCalledWith(STEP_MS);
    // Render is called every frame (5000ms / 16ms ≈ 312 frames).
    expect(render.mock.calls.length).toBeGreaterThan(100);

    loop.stop();
  });

  it('passes dt = STEP_MS * speed for speed 2 and 5', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.start();

    loop.setSpeed(2);
    harness.tick(100, 16);
    expect(update).toHaveBeenLastCalledWith(STEP_MS * 2);

    loop.setSpeed(5);
    harness.tick(100, 16);
    expect(update).toHaveBeenLastCalledWith(STEP_MS * 5);

    loop.stop();
  });

  it('pauses updates at speed 0 while render continues', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.setSpeed(0);
    loop.start();
    harness.tick(1000, 16);

    expect(update).not.toHaveBeenCalled();
    expect(render.mock.calls.length).toBeGreaterThan(0);

    loop.stop();
  });

  it('start() is idempotent (no double loop)', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.start();
    loop.start(); // second call must not spawn a second loop

    harness.tick(100, 16);
    // At 100ms / 50ms = 2 updates — not doubled.
    expect(update).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it('stop() is idempotent and safe when not running', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    expect(() => loop.stop()).not.toThrow(); // not running
    loop.start();
    loop.stop();
    loop.stop(); // double stop
    expect(loop.isRunning()).toBe(false);
  });

  it('publishes window.__CITY_BENCHMARK__ with fps and lastTickMs after render', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.start();
    harness.tick(100, 16);

    expect(window.__CITY_BENCHMARK__).toBeDefined();
    expect(typeof window.__CITY_BENCHMARK__!.fps).toBe('number');
    expect(typeof window.__CITY_BENCHMARK__!.lastTickMs).toBe('number');

    loop.stop();
  });

  it('logs FPS every 60 render frames and not before', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.start();
    // Advance less than 60 frames worth of time (each frame ~16ms).
    harness.tick(16 * 30, 16); // ~30 frames
    expect(logSpy).not.toHaveBeenCalled();

    // Cross the 60-frame boundary.
    harness.tick(16 * 40, 16); // ~70 frames total
    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls[0][0]).toMatch(/FPS:/);

    loop.stop();
  });

  it('caps the accumulator at MAX_ACCUMULATOR_MS (no spiral-of-death)', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.start();
    // Advance 2000ms in a single step — only 250ms (5 steps) should process.
    harness.tick(2000, 2000);

    expect(update.mock.calls.length).toBeLessThanOrEqual(
      MAX_ACCUMULATOR_MS / STEP_MS,
    );

    loop.stop();
  });

  it('uses injected now/raf/caf and does not touch real timers', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.start();
    harness.tick(150, 16);
    // 150ms / 50ms = 3 updates.
    expect(update).toHaveBeenCalledTimes(3);
    loop.stop();
    expect(loop.isRunning()).toBe(false);
  });

  it('getSpeed returns the current speed', () => {
    const harness = createHarness();
    const loop = new GameLoop(
      { update: jest.fn(), render: jest.fn() },
      harness,
    );

    expect(loop.getSpeed()).toBe(1); // default
    loop.setSpeed(5);
    expect(loop.getSpeed()).toBe(5);
    loop.setSpeed(0);
    expect(loop.getSpeed()).toBe(0);
  });

  it('uses default browser globals when no options are injected', () => {
    // Construct without options to exercise the default now/raf/caf branch.
    // We only assert construction + initial state; the loop is not started so
    // no real rAF is scheduled.
    const loop = new GameLoop({ update: jest.fn(), render: jest.fn() });
    expect(loop.isRunning()).toBe(false);
    expect(loop.getSpeed()).toBe(1);
  });

  it('accepts an explicit initial speed via options', () => {
    const harness = createHarness();
    const loop = new GameLoop(
      { update: jest.fn(), render: jest.fn() },
      { ...harness, speed: 2 },
    );
    expect(loop.getSpeed()).toBe(2);
  });

  it('skips benchmark publishing when window is undefined (SSR guard)', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    const originalWindow = global.window;
    // Simulate SSR / non-browser environment.
    // @ts-expect-error — intentionally unset global.window for this test.
    delete global.window;

    loop.start();
    expect(() => harness.tick(100, 16)).not.toThrow();
    expect(render).toHaveBeenCalled();

    global.window = originalWindow;
    loop.stop();
  });

  it('reports fps=0 before enough frames are collected', () => {
    const harness = createHarness();
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render }, harness);

    loop.start();
    // A single tiny tick yields <2 frame timestamps => fps should be 0.
    harness.tick(1, 1);
    expect(window.__CITY_BENCHMARK__!.fps).toBe(0);

    loop.stop();
  });

  it('removes the pending rAF callback via caf on stop', () => {
    const removed: number[] = [];
    let scheduledCb: ((t: number) => void) | null = null;
    const harness = {
      now: () => 0,
      raf: (cb: (t: number) => void) => {
        // Store cb so it is never auto-invoked; we control it manually.
        scheduledCb = cb;
        return 42;
      },
      caf: (handle: number) => {
        removed.push(handle);
      },
      tick: () => undefined,
    };

    const loop = new GameLoop(
      { update: jest.fn(), render: jest.fn() },
      harness,
    );

    loop.start();
    expect(scheduledCb).not.toBeNull();
    loop.stop();
    // caf must have been called with the rAF handle (42).
    expect(removed).toContain(42);
    expect(loop.isRunning()).toBe(false);
  });

  it('trims the FPS rolling window once it exceeds FPS_LOG_INTERVAL', () => {
    const harness = createHarness();
    const loop = new GameLoop(
      { update: jest.fn(), render: jest.fn() },
      harness,
    );

    loop.start();
    // Advance well past 60 frames so the rolling-window trim branch runs.
    harness.tick(16 * 120, 16);
    // After 120 frames the benchmark fps should be a positive number,
    // proving the rolling window is populated and trimmed correctly.
    expect(window.__CITY_BENCHMARK__!.fps).toBeGreaterThan(0);

    loop.stop();
  });

  it('reports fps=0 when elapsed time between frames is zero', () => {
    // Craft a harness where rAF delivers the same timestamp twice so the
    // `elapsed <= 0` guard in computeFps is exercised.
    let frame = 0;
    const fixedTime = 1000;
    const harness = {
      now: () => 0,
      raf: (cb: (t: number) => void) => {
        // Always deliver the same timestamp to force elapsed === 0.
        if (frame < 5) {
          frame += 1;
          cb(fixedTime);
        }
        return frame;
      },
      caf: () => undefined,
      tick: () => undefined,
    };

    const loop = new GameLoop(
      { update: jest.fn(), render: jest.fn() },
      harness,
    );

    loop.start();
    // After 5 frames all delivered with the same timestamp, fps must be 0.
    expect(window.__CITY_BENCHMARK__!.fps).toBe(0);

    loop.stop();
  });
});
