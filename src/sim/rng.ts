/**
 * Deterministic seeded pseudo-random number generator.
 *
 * Uses the Mulberry32 algorithm — fast, compact, and with good
 * statistical quality for a 32-bit PRNG.  Identical seeds always
 * produce identical sequences, which is essential for reproducible
 * city generation and deterministic simulation.
 */

/** Public RNG API returned by {@link createRng}. */
export interface Rng {
  /**
   * Advance the generator and return a float in `[0, 1)`.
   * Consumes one step of the internal state.
   */
  next(): number;

  /**
   * Return a uniformly-distributed integer in `[min, max]` (inclusive
   * on both ends).  Consumes one step of the internal state.
   *
   * @throws {RangeError} if `max < min`.
   */
  int(min: number, max: number): number;

  /**
   * Return a uniformly-selected element from a non-empty array.
   * Consumes one step of the internal state.
   *
   * @throws {RangeError} if the array is empty.
   */
  pick<T>(array: readonly T[]): T;
}

/**
 * Create a new deterministic RNG seeded with `seed`.
 *
 * @param seed - 32-bit unsigned integer seed.
 * @returns An {@link Rng} instance.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    if (max < min) {
      throw new RangeError(`int(): max (${max}) must be >= min (${min})`);
    }
    return Math.floor(next() * (max - min + 1)) + min;
  }

  function pick<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new RangeError('pick(): array must not be empty');
    }
    const index = int(0, array.length - 1);
    // Length is guaranteed > 0, so index ∈ [0, length-1] is always valid.
    return array[index]!;
  }

  return { next, int, pick };
}
