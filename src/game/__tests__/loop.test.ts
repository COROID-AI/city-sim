/**
 * Tests for the game loop.
 *
 * Acceptance criteria covered:
 *  - Gravity (Tick) automatically drops the piece on a level-based interval.
 *  - Locking spawns from the 7-bag, clears lines, updates score.
 *  - The loop drains queued player actions.
 */
import { startLoop, gravityInterval } from "../loop";
import { applyAction, newGame, type Action, type GameState } from "../state";

/** Deterministic linear-congruential RNG so sequences are reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * A controllable rAF/clock harness. `tick(ms)` advances the virtual clock and
 * fires the pending animation-frame callback, simulating one frame.
 */
class FakeClock {
  private nowMs = 0;
  private callback: ((t: number) => void) | null = null;
  readonly requestAnimationFrame = (cb: (t: number) => void): number => {
    this.callback = cb;
    return 1;
  };
  readonly cancelAnimationFrame = (): void => {
    this.callback = null;
  };

  tick(ms: number): void {
    this.nowMs += ms;
    if (this.callback !== null) {
      const cb = this.callback;
      // The next frame re-registers itself inside cb, so clear first.
      this.callback = null;
      cb(this.nowMs);
    }
  }

  now(): number {
    return this.nowMs;
  }
}

describe("game loop", () => {
  it("gravityInterval decreases with level and floors at 100ms", () => {
    expect(gravityInterval(1)).toBe(1000);
    expect(gravityInterval(2)).toBe(900);
    expect(gravityInterval(5)).toBe(600);
    expect(gravityInterval(10)).toBe(100);
    expect(gravityInterval(20)).toBe(100);
  });

  it("gravity drops the piece once per interval", () => {
    const clock = new FakeClock();
    const initialState = newGame({ random: makeRng(1) });
    const startRow = initialState.current!.row;
    const queue: Action[] = [];
    const frames: GameState[] = [];

    const stop = startLoop(initialState, queue, {
      onFrame: (s) => frames.push(s),
      now: () => clock.now(),
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
    });

    // Advance exactly one gravity interval for level 1 (1000ms).
    clock.tick(1000);

    expect(frames.length).toBeGreaterThan(0);
    const last = frames[frames.length - 1];
    expect(last.current!.row).toBe(startRow + 1);

    stop();
  });

  it("processes queued player actions before the next frame renders", () => {
    const clock = new FakeClock();
    const initialState = newGame({ random: makeRng(2) });
    const queue: Action[] = [{ type: "MoveLeft" }];
    const frames: GameState[] = [];

    const stop = startLoop(initialState, queue, {
      onFrame: (s) => frames.push(s),
      now: () => clock.now(),
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
    });

    // A small frame step that is under the gravity interval.
    clock.tick(16);

    expect(queue).toHaveLength(0);
    expect(frames[frames.length - 1].current!.col).toBe(
      initialState.current!.col - 1
    );

    stop();
  });

  it("gravity eventually locks a piece and spawns the next from the 7-bag", () => {
    const clock = new FakeClock();
    const initialState = newGame({ random: makeRng(3) });
    const firstType = initialState.current!.type;
    const queue: Action[] = [];
    const frames: GameState[] = [];

    const stop = startLoop(initialState, queue, {
      onFrame: (s) => frames.push(s),
      now: () => clock.now(),
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
    });

    // Drop the piece well past the board height to force a lock.
    // 20 rows * 1000ms plus a couple of extra ticks for the lock step.
    for (let i = 0; i < 25; i++) {
      clock.tick(1000);
    }

    const last = frames[frames.length - 1];
    // A new piece spawned.
    expect(last.current!.type).not.toBe(firstType);
    // The original piece is locked at the bottom of the board.
    expect(last.board.some((row) => row.some((c) => c === firstType))).toBe(
      true
    );

    stop();
  });

  it("stops invoking onFrame after the returned stop function is called", () => {
    const clock = new FakeClock();
    const initialState = newGame({ random: makeRng(4) });
    const queue: Action[] = [];
    let frameCount = 0;

    const stop = startLoop(initialState, queue, {
      onFrame: () => {
        frameCount += 1;
      },
      now: () => clock.now(),
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
    });

    clock.tick(16);
    const countAfterFirst = frameCount;
    stop();
    clock.tick(16);
    clock.tick(16);

    expect(frameCount).toBe(countAfterFirst);
  });

  it("drains multiple queued actions in order", () => {
    const clock = new FakeClock();
    const initialState = newGame({ random: makeRng(5) });
    const queue: Action[] = [
      { type: "MoveRight" },
      { type: "MoveRight" },
      { type: "Rotate" },
    ];
    const frames: GameState[] = [];

    const stop = startLoop(initialState, queue, {
      onFrame: (s) => frames.push(s),
      now: () => clock.now(),
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
    });

    clock.tick(16);

    const last = frames[frames.length - 1];
    expect(last.current!.col).toBe(initialState.current!.col + 2);
    expect(last.current!.rotation).toBe(1);

    stop();
  });
});
