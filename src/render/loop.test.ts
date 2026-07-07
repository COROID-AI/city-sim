import { startLoop } from './loop';

// ─── Mock requestAnimationFrame / cancelAnimationFrame ────────────────────────

let rafCallbacks: ((ts: number) => void)[] = [];
let rafIdCounter = 0;
const idToIndex = new Map<number, number>();

beforeEach(() => {
  rafCallbacks = [];
  rafIdCounter = 0;
  idToIndex.clear();
});

function installMockRaf() {
  // Define on globalThis first so spyOn has a property to spy on.
  (globalThis as Record<string, unknown>).requestAnimationFrame = () => 0;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};

  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = ++rafIdCounter;
    idToIndex.set(id, rafCallbacks.length);
    rafCallbacks.push(cb as (ts: number) => void);
    return id;
  });
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
    const idx = idToIndex.get(id);
    if (idx !== undefined) {
      rafCallbacks.splice(idx, 1);
      idToIndex.delete(id);
    }
  });
}

function restoreRaf() {
  jest.restoreAllMocks();
}

/**
 * Advance the mocked clock: executes each pending RAF callback with the
 * given timestamp, simulating one animation frame.
 */
function tickFrame(timestamp: number) {
  // Snapshot the callbacks active at this frame; update() may re-queue.
  const pending = [...rafCallbacks];
  rafCallbacks = [];
  idToIndex.clear();
  for (const cb of pending) {
    cb(timestamp);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('startLoop', () => {
  it('starts and calls requestAnimationFrame', () => {
    installMockRaf();
    const update = jest.fn();
    const render = jest.fn();

    startLoop({ update, render });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    restoreRaf();
  });

  it('calls update with the fixed step and render each frame', () => {
    installMockRaf();
    const update = jest.fn();
    const render = jest.fn();
    const fixedStepMs = 16;

    startLoop({ update, render, fixedStepMs });
    tickFrame(0);     // First frame: seeds lastTime, no delta yet
    tickFrame(16);    // 16ms later → one step

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith(fixedStepMs);
    expect(render).toHaveBeenCalled();
    restoreRaf();
  });

  it('runs multiple steps when frame delta exceeds the fixed step', () => {
    installMockRaf();
    const update = jest.fn();
    const render = jest.fn();
    const fixedStepMs = 16;

    startLoop({ update, render, fixedStepMs, maxStepsPerFrame: 10 });
    tickFrame(0);        // seed
    tickFrame(100);      // 100ms → floor(100/16) = 6 steps

    expect(update).toHaveBeenCalledTimes(6);
    restoreRaf();
  });

  it('caps steps per frame to avoid spiral of death', () => {
    installMockRaf();
    const update = jest.fn();
    const render = jest.fn();
    const fixedStepMs = 16;
    const maxStepsPerFrame = 3;

    startLoop({ update, render, fixedStepMs, maxStepsPerFrame });
    tickFrame(0);         // seed
    tickFrame(1000);      // huge gap → should cap at 3 steps

    expect(update).toHaveBeenCalledTimes(3);
    restoreRaf();
  });

  it('stop function cancels the animation frame', () => {
    installMockRaf();
    const update = jest.fn();
    const render = jest.fn();

    const stop = startLoop({ update, render });
    stop();

    expect(cancelAnimationFrame).toHaveBeenCalled();
    restoreRaf();
  });

  it('does not call update or render after stop', () => {
    installMockRaf();
    const update = jest.fn();
    const render = jest.fn();

    const stop = startLoop({ update, render });
    tickFrame(0);
    const updateCount = update.mock.calls.length;
    const renderCount = render.mock.calls.length;
    stop();
    tickFrame(16);

    expect(update.mock.calls.length).toBe(updateCount);
    expect(render.mock.calls.length).toBe(renderCount);
    restoreRaf();
  });
});
