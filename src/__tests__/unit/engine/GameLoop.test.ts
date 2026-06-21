import { GameLoop } from '@/engine/GameLoop';

type RafCallback = (timeMs: number) => void;

describe('GameLoop', () => {
  const rafQueue: RafCallback[] = [];
  let nowMs = 0;

  beforeEach(() => {
    rafQueue.length = 0;
    nowMs = 0;

    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: RafCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });

    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      // no-op
    });

    jest.spyOn(globalThis, 'performance', 'get').mockReturnValue({ now: () => nowMs } as unknown as Performance);

    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const flushRaf = (ticks: number): void => {
    for (let i = 0; i < ticks; i += 1) {
      const cb = rafQueue.shift();
      if (!cb) return;
      cb(nowMs);
    }
  };

  it('advancing 100ms produces exactly 2 fixed 20Hz updates', () => {
    const update = jest.fn<void, [unknown]>();
    const render = jest.fn<void, [unknown]>();

    const loop = new GameLoop(update as never, render as never);
    loop.start();

    // First RAF tick uses nowMs; start() sets lastTimeMs=performance.now() (0).
    nowMs = 100;
    flushRaf(1);

    // fixedDt = 50ms -> 100ms accumulates -> 2 updates
    expect(update).toHaveBeenCalledTimes(2);

    const firstCtx = update.mock.calls[0]?.[0] as { fixedDtMs: number; elapsedMs: number }; 
    expect(firstCtx).toBeDefined();
    const secondCtx = update.mock.calls[1]?.[0] as { fixedDtMs: number; elapsedMs: number }; 
    expect(secondCtx).toBeDefined();

    expect(firstCtx.fixedDtMs).toBe(50);
    expect(firstCtx.elapsedMs).toBe(50);
    expect(secondCtx.fixedDtMs).toBe(50);
    expect(secondCtx.elapsedMs).toBe(50);
  });

  it('renders every rAF tick even when no fixed update fires', () => {
    const update = jest.fn();
    const render = jest.fn();

    const loop = new GameLoop(update, render);
    loop.start();

    nowMs = 0; // accumulator < fixedDt after first tick
    flushRaf(1);

    nowMs = 10;
    flushRaf(3);

    // Render should run on every rAF tick.
    expect(render).toHaveBeenCalledTimes(5);
    // Fixed updates should never fire for this cadence (10ms < fixedDt=50ms).
    expect(update).toHaveBeenCalledTimes(0);
  });

  it('pause stops updates and renders; resume restarts', () => {
    const update = jest.fn();
    const render = jest.fn();

    const loop = new GameLoop(update, render);
    loop.start();

    nowMs = 60;
    flushRaf(1);

    loop.pause();
    const renderedAfterPause = render.mock.calls.length;
    const updatedAfterPause = update.mock.calls.length;

    nowMs = 120;
    flushRaf(5);

    expect(render).toHaveBeenCalledTimes(renderedAfterPause);
    expect(update).toHaveBeenCalledTimes(updatedAfterPause);

    loop.resume();
    nowMs = 170;
    flushRaf(1);

    expect(render.mock.calls.length).toBeGreaterThan(renderedAfterPause);
    expect(update.mock.calls.length).toBeGreaterThan(updatedAfterPause);
  });

  it('stop cancels RAF and prevents further callbacks', () => {
    const update = jest.fn();
    const render = jest.fn();

    const cancelSpy = jest.spyOn(window, 'cancelAnimationFrame');

    const loop = new GameLoop(update, render);
    loop.start();

    nowMs = 50;
    flushRaf(1);

    loop.stop();

    const renderedAfterStop = render.mock.calls.length;
    const updatedAfterStop = update.mock.calls.length;

    nowMs = 200;
    flushRaf(5);

    expect(cancelSpy).toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(renderedAfterStop);
    expect(update).toHaveBeenCalledTimes(updatedAfterStop);
  });

  it('logs FPS every second', () => {
    const update = jest.fn();
    const render = jest.fn();

    const loop = new GameLoop(update, render);
    loop.start();

    // Drive renders/raf to cross 1000ms.
    nowMs = 0;
    flushRaf(1);

    nowMs = 1000;
    flushRaf(1);

    expect(console.info).toHaveBeenCalled();
    const logged = (console.info as jest.Mock).mock.calls
      .map((c) => String(c[0] ?? ''))
      .join(' ');

    expect(logged).toMatch(/FPS:\s*\d+/);
  });

  it('idempotent start schedules only one rAF chain', () => {
    const update = jest.fn();
    const render = jest.fn();

    const loop = new GameLoop(update, render);
    loop.start();
    loop.start();

    // requestAnimationFrame is called once for start; tick schedules additional calls.
    // After start twice, only one initial schedule should exist.
    expect(rafQueue.length).toBe(1);
  });

  it('spiral-of-death guard clamps accumulated time', () => {
    const update = jest.fn();
    const render = jest.fn();

    const loop = new GameLoop(update, render, { maxAccumulatedMs: 250, fixedDtHz: 20 });
    loop.start();

    nowMs = 5000;
    flushRaf(1);

    // fixedDt=50ms -> maxAccumulatedMs=250 -> at most 5 updates
    expect(update).toHaveBeenCalledTimes(5);
  });

  it('throwing update does not stop subsequent renders', () => {
    const update = jest.fn(() => {
      throw new Error('boom');
    });
    const render = jest.fn();

    const loop = new GameLoop(update, render);
    loop.start();

    nowMs = 100;
    flushRaf(2);

    expect(render).toHaveBeenCalled();
  });
});
