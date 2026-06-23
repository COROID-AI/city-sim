/**
 * GameLoop tests.
 *
 * Both requestAnimationFrame and performance.now are fully mocked so the tests
 * control timestamps manually by invoking the stored rAF callback with
 * synthetic DOMHighResTimeStamp values.
 */
import { GameLoop, SIMULATION_STEP } from '@/engine/GameLoop';

describe('GameLoop', () => {
  let rafCallbacks: Array<(t: number) => void>;
  let rafIdCounter: number;
  let currentTime: number;
  let originalRAF: typeof requestAnimationFrame;
  let originalCAF: typeof cancelAnimationFrame;
  let originalNow: typeof performance.now;
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 1;
    currentTime = 0;

    originalRAF = globalThis.requestAnimationFrame;
    originalCAF = globalThis.cancelAnimationFrame;
    originalNow = performance.now;
    originalConsoleLog = console.log;

    // rAF stores the callback; tests drive it via fireFrame().
    globalThis.requestAnimationFrame = ((cb: (t: number) => void): number => {
      const id = rafIdCounter++;
      rafCallbacks.push(cb);
      return id;
    }) as typeof requestAnimationFrame;

    globalThis.cancelAnimationFrame = (() => {
      // no-op: we drive frames manually
    }) as typeof cancelAnimationFrame;

    performance.now = (() => currentTime) as typeof performance.now;
    console.log = jest.fn();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
    performance.now = originalNow;
    console.log = originalConsoleLog;
  });

  /** Advance the mock clock and fire the next pending rAF callback. */
  function fireFrame(deltaMs: number): void {
    currentTime += deltaMs;
    const cb = rafCallbacks.shift();
    if (cb) cb(currentTime);
  }

  it('fires exactly 2 updates for a 100ms frame delta (fixed 20 Hz)', () => {
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render });

    loop.start();
    // First frame establishes baseline (0 delta).
    fireFrame(0);
    update.mockClear();

    // 100ms frame -> exactly 2 steps of 50ms.
    fireFrame(100);
    expect(update).toHaveBeenCalledTimes(2);
    update.mock.calls.forEach((call) => {
      expect(call[0]).toBe(SIMULATION_STEP);
    });

    loop.stop();
  });

  it('fires the render callback exactly once per frame', () => {
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render });

    loop.start();
    fireFrame(0);
    render.mockClear();

    fireFrame(16);
    expect(render).toHaveBeenCalledTimes(1);
    fireFrame(16);
    expect(render).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it('passes an interpolation alpha in [0..1] to render', () => {
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render });

    loop.start();
    fireFrame(0); // baseline

    // 25ms frame -> 0 full steps, alpha = 25/50 = 0.5
    fireFrame(25);
    const alpha = render.mock.calls[render.mock.calls.length - 1][0];
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThanOrEqual(1);
    expect(alpha).toBeCloseTo(0.5, 5);

    loop.stop();
  });

  it('pause() stops update calls while render continues', () => {
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render });

    loop.start();
    fireFrame(0); // baseline
    update.mockClear();

    loop.pause();
    expect(loop.isPaused()).toBe(true);

    fireFrame(100);
    expect(update).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalled();

    loop.stop();
  });

  it('resume() restarts updates without a time-jump flood', () => {
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render });

    loop.start();
    fireFrame(0); // baseline

    loop.pause();
    // Simulate a long pause (5s) while paused — should NOT accumulate.
    fireFrame(5000);
    update.mockClear();

    loop.resume();
    expect(loop.isPaused()).toBe(false);

    // First frame after resume: small delta only.
    fireFrame(50);
    expect(update).toHaveBeenCalledTimes(1);

    loop.stop();
  });

  it('setSpeed(2.0) doubles the update frequency', () => {
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render });

    loop.start();
    fireFrame(0); // baseline
    loop.setSpeed(2.0);
    update.mockClear();

    // 100ms * 2.0 = 200ms accumulated -> 4 steps of 50ms.
    fireFrame(100);
    expect(update).toHaveBeenCalledTimes(4);

    loop.stop();
  });

  it('start() is idempotent and does not create two rAF chains', () => {
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render });

    loop.start();
    loop.start(); // second call should be a no-op
    expect(loop.isRunning()).toBe(true);

    // Only one callback should be pending.
    expect(rafCallbacks.length).toBe(1);

    loop.stop();
  });

  it('stop() cancels the loop and isRunning() becomes false', () => {
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render });

    loop.start();
    expect(loop.isRunning()).toBe(true);

    loop.stop();
    expect(loop.isRunning()).toBe(false);

    const pendingBefore = rafCallbacks.length;
    fireFrame(100);
    // No new frame should have been scheduled after stop().
    expect(rafCallbacks.length).toBe(pendingBefore - 1);
  });

  it('maxFrameDelta clamp limits updates to 5 for a 1000ms frame', () => {
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render });

    loop.start();
    fireFrame(0); // baseline
    update.mockClear();

    // 1000ms frame clamped to 250ms -> max 5 updates.
    fireFrame(1000);
    expect(update).toHaveBeenCalledTimes(5);

    loop.stop();
  });

  it('FPS counter logs to console over a 1-second window', () => {
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render });

    loop.start();
    fireFrame(0); // baseline

    // Drive just over 1 second of frames at 16ms each (70 frames ~ 1120ms).
    for (let i = 0; i < 70; i++) {
      fireFrame(16);
    }

    expect(console.log).toHaveBeenCalled();
    const lastCall = (
      console.log as jest.Mock
    ).mock.calls[
      (console.log as jest.Mock).mock.calls.length - 1
    ][0] as string;
    expect(lastCall).toMatch(/FPS/i);
    expect(loop.getFps()).toBeGreaterThan(0);

    loop.stop();
  });

  it('getFps() returns 0 before any 1-second window completes', () => {
    const update = jest.fn();
    const render = jest.fn();
    const loop = new GameLoop({ update, render });

    loop.start();
    fireFrame(0); // baseline
    fireFrame(16);
    expect(loop.getFps()).toBe(0);

    loop.stop();
  });
});
