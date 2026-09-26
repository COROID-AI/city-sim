/**
 * Deterministic simulation primitives: clocks, seeded RNG and the fixed-step loop.
 *
 * Determinism contract
 * --------------------
 *  - Simulation advances only in whole `stepMs` ticks. A variable frame delta is
 *    accumulated and spent as whole steps; the leftover fraction is exposed as
 *    `alpha` and is used *only* at draw time for interpolation.
 *  - Randomness comes from a seeded `Rng` owned by the loop, never from
 *    `Math.random()`, so a given seed and step count always produce the same
 *    sequence.
 *  - The clock is injectable. Tests drive `createManualClock` (or call
 *    `loop.advance(ms)`) and therefore never depend on wall-clock time.
 */

/* -------------------------------------------------------------------------- */
/* Clocks                                                                     */
/* -------------------------------------------------------------------------- */

/** Anything that can report the current time in milliseconds. */
export interface Clock {
  now(): number;
}

/** A clock a caller can move by hand, for deterministic tests and fast-forward. */
export interface ManualClock extends Clock {
  advance(ms: number): number;
  set(ms: number): number;
}

/** Wall-clock source. Uses `performance.now()` when the host provides it. */
export function createPerformanceClock(): Clock {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return { now: () => performance.now() };
  }
  return { now: () => Date.now() };
}

/** Clock that only moves when the caller moves it. */
export function createManualClock(startMs = 0): ManualClock {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
      return current;
    },
    set: (ms: number) => {
      current = ms;
      return current;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Seeded RNG                                                                 */
/* -------------------------------------------------------------------------- */

/** Deterministic pseudo-random stream. Same seed ⇒ same sequence, always. */
export interface Rng {
  /** Resolved 32-bit seed after string/number normalisation. */
  readonly seed: number;
  /** Next value in [0, 1). */
  next(): number;
  /** Next value in [min, max). Defaults to [0, 1). */
  float(min?: number, max?: number): number;
  /** Next integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Coin flip with the given probability of returning `true`. */
  bool(probability?: number): boolean;
  /** Uniform pick from a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** Current internal counter, for determinism assertions. */
  peek(): number;
  /** Rewind to the seed. */
  reset(): void;
}

/** xmur3-style string hash so string seeds are as usable as numeric ones. */
function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') {
    return Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) >>> 0 || 1 : 1;
  }
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Create a seeded RNG (mulberry32). The stream is a pure function of the seed,
 * which is what lets fixtures, tests and replays agree.
 */
export function createRng(seed: number | string = 1): Rng {
  const resolved = hashSeed(seed);
  const initial = resolved >>> 0;
  let state = initial;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    seed: resolved,
    next,
    float: (min = 0, max = 1) => min + next() * (max - min),
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    bool: (probability = 0.5) => next() < probability,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) {
        throw new Error('[coroid] createRng().pick() requires a non-empty list');
      }
      const index = Math.min(items.length - 1, Math.floor(next() * items.length));
      return items[index] as T;
    },
    peek: () => state,
    reset: () => {
      state = initial;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Fixed-step loop                                                            */
/* -------------------------------------------------------------------------- */

/** 60 Hz simulation step. Overridable per loop/game. */
export const DEFAULT_STEP_MS = 1000 / 60;

/** Context handed to `onStep`, once per fixed simulation step. */
export interface StepContext {
  /** 1-based index of this step within the loop's lifetime. */
  readonly step: number;
  /** Fixed step duration in milliseconds. */
  readonly deltaMs: number;
  /** Simulated time elapsed after this step, in milliseconds. */
  readonly elapsedMs: number;
}

/** Context handed to `onFrame`, once per rendered frame. */
export interface FrameContext {
  /** 1-based rendered frame index. */
  readonly frame: number;
  /** Fixed steps executed during this frame. */
  readonly steps: number;
  /** Cumulative fixed steps executed by the loop. */
  readonly totalSteps: number;
  /** Draw-time interpolation factor in [0, 1): accumulator / stepMs. */
  readonly alpha: number;
  /** Simulated time elapsed, in milliseconds. */
  readonly elapsedMs: number;
  /** Fixed step duration in milliseconds. */
  readonly stepMs: number;
}

export interface FixedStepLoopOptions {
  /** Time source used by `tick()` and `start()`. Defaults to `performance.now()`. */
  clock?: Clock;
  /** Seed for the loop's deterministic RNG stream. Defaults to `1`. */
  seed?: number | string;
  /** Fixed step duration in milliseconds. Defaults to `DEFAULT_STEP_MS`. */
  stepMs?: number;
  /** Upper bound on steps per frame, protecting against the spiral of death. */
  maxStepsPerFrame?: number;
  onStep?(step: StepContext): void;
  onFrame?(frame: FrameContext): void;
}

/**
 * Accumulator-driven fixed-step loop.
 *
 * `tick()` consumes real elapsed time from the clock; `advance(ms)` consumes an
 * explicit delta and is what headless tests and fast-forwards use. Both run
 * whole steps and then emit exactly one frame.
 */
export interface FixedStepLoop {
  readonly clock: Clock;
  readonly rng: Rng;
  readonly stepMs: number;
  readonly maxStepsPerFrame: number;
  /** Leftover time that has not yet been spent as a whole step. */
  readonly accumulator: number;
  /** Cumulative fixed steps executed. */
  readonly steps: number;
  /** Cumulative frames emitted. */
  readonly frames: number;
  /** Simulated elapsed time in milliseconds. */
  readonly elapsedMs: number;
  readonly running: boolean;
  readonly disposed: boolean;
  /** Advance by the clock delta. Returns the number of steps executed. */
  tick(): number;
  /** Advance by an explicit delta. Returns the number of steps executed. */
  advance(ms: number): number;
  /** Begin driving from the clock (requestAnimationFrame, or a timer fallback). */
  start(): void;
  stop(): void;
  /** Rewind steps, frames, accumulator and RNG state. */
  reset(): void;
  dispose(): void;
}

export function createFixedStepLoop(options: FixedStepLoopOptions = {}): FixedStepLoop {
  const clock = options.clock ?? createPerformanceClock();
  const stepMs = options.stepMs && options.stepMs > 0 ? options.stepMs : DEFAULT_STEP_MS;
  const maxStepsPerFrame = Math.max(1, Math.trunc(options.maxStepsPerFrame ?? 240));
  const rng = createRng(options.seed ?? 1);

  let accumulator = 0;
  let steps = 0;
  let frames = 0;
  let elapsedMs = 0;
  let running = false;
  let disposed = false;
  let lastTime = clock.now();
  let cancelDriver: (() => void) | null = null;

  const hasAnimationFrame = typeof requestAnimationFrame === 'function';

  function consume(deltaMs: number): number {
    accumulator += deltaMs > 0 ? deltaMs : 0;
    let executed = 0;
    while (accumulator >= stepMs && executed < maxStepsPerFrame) {
      accumulator -= stepMs;
      executed += 1;
      steps += 1;
      elapsedMs += stepMs;
      const step: StepContext = { step: steps, deltaMs: stepMs, elapsedMs };
      options.onStep?.(step);
    }
    // Spiral-of-death guard: whatever could not be simulated this frame is
    // dropped rather than carried forever.
    if (accumulator >= stepMs) {
      accumulator %= stepMs;
    }
    return executed;
  }

  function emitFrame(stepsThisFrame: number): void {
    frames += 1;
    const frame: FrameContext = {
      frame: frames,
      steps: stepsThisFrame,
      totalSteps: steps,
      alpha: stepMs > 0 ? accumulator / stepMs : 0,
      elapsedMs,
      stepMs,
    };
    options.onFrame?.(frame);
  }

  function pump(deltaMs: number): number {
    const executed = consume(deltaMs);
    emitFrame(executed);
    return executed;
  }

  function tick(): number {
    const now = clock.now();
    const delta = now - lastTime;
    lastTime = now;
    return pump(delta > 0 ? delta : 0);
  }

  function start(): void {
    if (running || disposed) return;
    running = true;
    lastTime = clock.now();
    if (hasAnimationFrame) {
      const schedule = (): void => {
        const rafId = requestAnimationFrame(() => {
          if (!running || disposed) return;
          tick();
          schedule();
        });
        cancelDriver = () => {
          cancelAnimationFrame(rafId);
        };
      };
      schedule();
    } else {
      const timerId = setInterval(() => tick(), stepMs);
      cancelDriver = () => {
        clearInterval(timerId);
      };
    }
  }

  function stop(): void {
    running = false;
    if (cancelDriver) {
      cancelDriver();
      cancelDriver = null;
    }
  }

  function reset(): void {
    accumulator = 0;
    steps = 0;
    frames = 0;
    elapsedMs = 0;
    lastTime = clock.now();
    rng.reset();
  }

  function dispose(): void {
    if (disposed) return;
    stop();
    disposed = true;
  }

  return {
    clock,
    rng,
    stepMs,
    maxStepsPerFrame,
    get accumulator() {
      return accumulator;
    },
    get steps() {
      return steps;
    },
    get frames() {
      return frames;
    },
    get elapsedMs() {
      return elapsedMs;
    },
    get running() {
      return running;
    },
    get disposed() {
      return disposed;
    },
    tick,
    advance: pump,
    start,
    stop,
    reset,
    dispose,
  };
}
