import {
  GameLoop,
  TICK_HZ,
  FIXED_DT,
  DEFAULT_MAX_STEPS_PER_FRAME,
  type FrameCallback,
  type FixedStepCallback,
  type GameLoopOptions,
} from '@/engine/GameLoop';
import type { RafHandle } from '@/engine/GameLoop';

interface FakeRaf {
  request: (cb: (nowMs: number) => void) => RafHandle;
  now: () => number;
}

function createFakeRaf(): FakeRaf & { pending: Array<(n: number) => void>; currentTime: number } {
  const state = {
    pending: [] as Array<(n: number) => void>,
    currentTime: 0,
    request(cb: (nowMs: number) => void) {
      state.pending.push(cb);
      return { cancel: () => { state.pending = state.pending.filter((c) => c !== cb); } };
    },
    now() {
      return state.currentTime;
    },
  };
  return state;
}

describe('GameLoop', () => {
  it('exports 20 Hz tick rate', () => {
    expect(TICK_HZ).toBe(20);
    expect(FIXED_DT).toBeCloseTo(0.05);
  });

  it('runs at a fixed 20 Hz tick frequency over a simulated 500ms', () => {
    const raf = createFakeRaf();
    const loop = new GameLoop({ fixedDt: FIXED_DT, maxStepsPerFrame: 100 } as GameLoopOptions, raf);
    let ticks = 0;
    loop.setFixedStepCallback(() => {
      ticks += 1;
    });
    loop.start();
    // Simulate 500ms of real time across 10 frames of 50ms each.
    for (let i = 0; i < 10; i++) {
      raf.currentTime += 50;
      const cb = raf.pending.shift()!;
      cb(raf.currentTime);
    }
    expect(ticks).toBe(10);
    expect(loop.getTickCount()).toBe(10);
    loop.stop();
  });

  it('caps accumulated steps per frame to avoid spiral of death', () => {
    const raf = createFakeRaf();
    const loop = new GameLoop(
      { fixedDt: FIXED_DT, maxStepsPerFrame: DEFAULT_MAX_STEPS_PER_FRAME } as GameLoopOptions,
      raf,
    );
    let ticks = 0;
    loop.setFixedStepCallback(() => {
      ticks += 1;
    });
    loop.start();
    // Simulate a 1s gap on a single frame.
    raf.currentTime = 1000;
    const cb = raf.pending.shift()!;
    cb(raf.currentTime);
    // Should not exceed maxStepsPerFrame, and the leftover is discarded.
    expect(ticks).toBe(DEFAULT_MAX_STEPS_PER_FRAME);
    expect(loop.getTickCount()).toBe(DEFAULT_MAX_STEPS_PER_FRAME);
    loop.stop();
  });

  it('pause stops ticks; resume continues; stop() cancels rAF chain', () => {
    const raf = createFakeRaf();
    const loop = new GameLoop(
      { fixedDt: FIXED_DT, maxStepsPerFrame: 100 } as GameLoopOptions,
      raf,
    );
    let ticks = 0;
    loop.setFixedStepCallback(() => {
      ticks += 1;
    });
    loop.start();
    // Run 100ms
    raf.currentTime = 100;
    raf.pending.shift()!(raf.currentTime);
    expect(ticks).toBe(2);

    loop.pause();
    // No callbacks should be scheduled while paused.
    expect(raf.pending.length).toBe(0);

    // Advance time while paused: still no ticks.
    raf.currentTime = 200;
    // (No pending callback to fire.)

    loop.resume();
    // Run another 100ms.
    raf.currentTime = 300;
    raf.pending.shift()!(raf.currentTime);
    expect(ticks).toBe(4);

    loop.stop();
    // After stop, no further rAF should be scheduled.
    expect(raf.pending.length).toBe(0);
    expect(loop.getPhase()).toBe('stopped');
  });

  it('start() is a no-op when already running', () => {
    const raf = createFakeRaf();
    const loop = new GameLoop({ fixedDt: FIXED_DT } as GameLoopOptions, raf);
    loop.start();
    const scheduled = raf.pending.length;
    loop.start();
    expect(raf.pending.length).toBe(scheduled);
    loop.stop();
  });

  it('stop() resets tick count', () => {
    const raf = createFakeRaf();
    const loop = new GameLoop({ fixedDt: FIXED_DT, maxStepsPerFrame: 100 } as GameLoopOptions, raf);
    loop.setFixedStepCallback(() => undefined);
    loop.start();
    raf.currentTime = 50;
    raf.pending.shift()!(raf.currentTime);
    expect(loop.getTickCount()).toBe(1);
    loop.stop();
    expect(loop.getTickCount()).toBe(0);
  });

  it('forwards real dt to frame callback', () => {
    const raf = createFakeRaf();
    const loop = new GameLoop({ fixedDt: FIXED_DT, maxStepsPerFrame: 100 } as GameLoopOptions, raf);
    const frameEvents: Array<{ dt: number; acc: number }> = [];
    const frameCb: FrameCallback = (dt, acc) => {
      frameEvents.push({ dt, acc });
    };
    loop.setFrameCallback(frameCb);
    loop.start();
    raf.currentTime = 50;
    raf.pending.shift()!(raf.currentTime);
    expect(frameEvents.length).toBe(1);
    expect(frameEvents[0]!.dt).toBeCloseTo(0.05);
    loop.stop();
  });

  it('calls fixed step callback with the configured fixed dt', () => {
    const raf = createFakeRaf();
    const loop = new GameLoop({ fixedDt: 0.1, maxStepsPerFrame: 100 } as GameLoopOptions, raf);
    const dts: number[] = [];
    const cb: FixedStepCallback = (dt) => dts.push(dt);
    loop.setFixedStepCallback(cb);
    loop.start();
    raf.currentTime = 100;
    raf.pending.shift()!(raf.currentTime);
    expect(dts.length).toBe(1);
    expect(dts[0]).toBeCloseTo(0.1);
    loop.stop();
  });

  it('rejects invalid fixedDt or maxStepsPerFrame', () => {
    const raf = createFakeRaf();
    expect(() => new GameLoop({ fixedDt: 0 } as GameLoopOptions, raf)).toThrow(RangeError);
    expect(() => new GameLoop({ maxStepsPerFrame: 0 } as GameLoopOptions, raf)).toThrow(
      RangeError,
    );
    expect(() => new GameLoop({ maxStepsPerFrame: 2.5 } as GameLoopOptions, raf)).toThrow(
      RangeError,
    );
  });
});
