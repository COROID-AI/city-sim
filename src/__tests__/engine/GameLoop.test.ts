import { GameLoop } from '@/engine/GameLoop';
import type { UpdateContext } from '@/engine/types';

type RafCallback = (timeMs: number) => void;

describe('GameLoop', () => {
  const rafQueue: RafCallback[] = [];
  let nowMs = 0;

  let originalRaf: typeof window.requestAnimationFrame;
  let originalCancelRaf: typeof window.cancelAnimationFrame;
  let originalPerformanceNow: () => number;

  beforeEach(() => {
    rafQueue.length = 0;
    nowMs = 0;

    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    originalPerformanceNow = performance.now.bind(performance);

    window.requestAnimationFrame = ((cb: RafCallback): number => {
      rafQueue.push(cb);
      return rafQueue.length;
    }) as typeof window.requestAnimationFrame;

    window.cancelAnimationFrame = (() => {
      // no-op stub
    }) as typeof window.cancelAnimationFrame;

    jest.spyOn(performance, 'now').mockImplementation(() => nowMs);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    performance.now = originalPerformanceNow;
    jest.restoreAllMocks();
  });

  /**
   * Advance the simulated clock by `dtMs` and fire the next queued rAF
   * callback with the updated timestamp. Mirrors how a real browser delivers
   * rAF callbacks with monotonically increasing timestamps.
   */
 const runFrames = (count: number, dtMs: number): void => {
    for (let i = 0; i < count; i += 1) {
      nowMs += dtMs;
      const cb = rafQueue.shift();
      if (!cb) return;
      cb(nowMs);
    }
  };

  it('fires update at 20 Hz: ~20 calls over a 1000 ms window (±2) with fixedDtMs === 50', () => {
    const update = jest.fn<(ctx: UpdateContext) => void>();
    const render = jest.fn();

    const loop = new GameLoop(update, render);
    loop.start();

    // Simulate 1000 ms of wall-clock time in 50 ms rAF increments (20 frames).
    runFrames(20, 50);

    // Each 50 ms frame accumulates exactly one fixed step (fixedDtMs = 50).
    // Tolerance ±2 absorbs any boundary/rounding effects.
    expect(update.mock.calls.length).toBeGreaterThanOrEqual(18);
    expect(update.mock.calls.length).toBeLessThanOrEqual(22);

    // Every update must receive the canonical fixed timestep (1000 / 20 Hz).
    for (const call of update.mock.calls) {
      expect(call[0].fixedDtMs).toBe(50);
    }
  });

  it('fires render at rAF rate: at least once after start() and on each subsequent tick', () => {
    const update = jest.fn();
    const render = jest.fn();

    const loop = new GameLoop(update, render);
    loop.start();

    // start() performs an initial synchronous render before scheduling rAF.
    const initialRenderCount = render.mock.calls.length;
    expect(initialRenderCount).toBeGreaterThanOrEqual(1);

    // Advance a few rAF ticks; render should fire once per tick.
    runFrames(3, 16);

    expect(render.mock.calls.length).toBeGreaterThan(initialRenderCount);
  });

  it('pause halts update/render; resume restarts them', () => {
    const update = jest.fn();
    const render = jest.fn();

    const loop = new GameLoop(update, render);
    loop.start();

    // Prime the loop with one tick.
    runFrames(1, 50);

    loop.pause();
    const rendersAfterPause = render.mock.calls.length;
    const updatesAfterPause = update.mock.calls.length;

    // While paused, advancing rAF must not invoke update or render.
    runFrames(5, 50);
    expect(render.mock.calls.length).toBe(rendersAfterPause);
    expect(update.mock.calls.length).toBe(updatesAfterPause);

    loop.resume();
    runFrames(2, 50);

    expect(render.mock.calls.length).toBeGreaterThan(rendersAfterPause);
    expect(update.mock.calls.length).toBeGreaterThan(updatesAfterPause);
  });

  it('stop cancels the rAF chain and prevents further callbacks (cleanup)', () => {
    const update = jest.fn();
    const render = jest.fn();

    const cancelSpy = jest.spyOn(window, 'cancelAnimationFrame');

    const loop = new GameLoop(update, render);
    loop.start();

    runFrames(1, 50);

    loop.stop();

    expect(cancelSpy).toHaveBeenCalled();
    expect(loop.isRunning()).toBe(false);

    const rendersAfterStop = render.mock.calls.length;
    const updatesAfterStop = update.mock.calls.length;

    // No further callbacks after stop.
    runFrames(5, 50);
    expect(render.mock.calls.length).toBe(rendersAfterStop);
    expect(update.mock.calls.length).toBe(updatesAfterStop);
  });
});
