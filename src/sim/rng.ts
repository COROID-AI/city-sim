/**
 * Mulberry32 — a tiny, fast, seedable pseudo-random number generator.
 *
 * Determinism guarantee: the same seed always yields the exact same sequence
 * of numbers, which is required by the simulation (same seed -> same world).
 *
 * The generator implements the contract expected by {@link createWorld}: it
 * exposes `next()` returning a float in [0, 1), and a few convenience helpers
 * built on top of it.
 */
export interface Rng {
  /** Returns a pseudo-random float in the half-open interval [0, 1). */
  next(): number;
  /** Returns an integer in the inclusive range [min, max]. */
  intRange(min: number, max: number): number;
}

/**
 * Create a seeded PRNG instance.
 *
 * @param seed - Any 32-bit unsigned integer. Defaults to 0.
 */
export function createRng(seed: number): Rng {
  // Mulberry32 internal state; operate on a 32-bit unsigned integer.
  let state = seed >>> 0;

  function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function intRange(min: number, max: number): number {
    return Math.floor(next() * (max - min + 1)) + min;
  }

  return { next, intRange };
}
