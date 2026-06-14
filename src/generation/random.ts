/**
 * Deterministic seeded PRNG utilities for procedural generation.
 *
 * The generation pipeline is reproducible: the same seed must always
 * produce the same city layout. To that end, every random decision flows
 * through an injected `Rng` instance backed by mulberry32. Direct
 * `Math.random()` calls inside `src/generation/*` are forbidden.
 *
 * Reference: https://stackoverflow.com/a/47593316 (mulberry32, public domain)
 */

/**
 * A function returning a float in [0, 1) given a uniform [0, 1) source.
 * Implemented as a method on a stateful instance so callers cannot
 * accidentally re-seed mid-pipeline.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Integer in [min, max] (both inclusive). */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  /** Pick a uniformly random element; throws on empty arrays. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates shuffle; returns a new array, does not mutate input. */
  shuffle<T>(items: readonly T[]): T[];
  /** True with probability `p` (0..1). */
  chance(p: number): boolean;
}

/**
 * Build a new Rng from a 32-bit unsigned integer seed.
 *
 * @param seed - 32-bit unsigned integer. Will be coerced via `>>> 0`.
 */
export function createRng(seed: number): Rng {
  let state = (seed >>> 0) || 1;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new RangeError('createRng.int requires integer bounds');
      }
      if (max < min) {
        throw new RangeError(`createRng.int: max (${max}) < min (${min})`);
      }
      // Floor of next() * (max - min + 1) gives a uniform integer in [min, max].
      return Math.floor(next() * (max - min + 1)) + min;
    },
    float(min, max) {
      if (!(max > min)) {
        throw new RangeError('createRng.float requires max > min');
      }
      return next() * (max - min) + min;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new RangeError('createRng.pick called on empty array');
      }
      const i = Math.floor(next() * items.length);
      // Clamp defensively in case of floating-point edge cases.
      const idx = Math.min(i, items.length - 1);
      return items[idx] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = out[i] as T;
        const b = out[j] as T;
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
    chance(p) {
      if (p <= 0) return false;
      if (p >= 1) return true;
      return next() < p;
    },
  };
}
