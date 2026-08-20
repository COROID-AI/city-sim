/**
 * Deterministic seeded RNG used by all generation so cities are reproducible.
 *
 * Implements the mulberry32 PRNG (tiny, fast, good-enough distribution).
 * Given the same seed, every call sequence yields identical results, which
 * lets the world, economy, and agents share one reproducible stream.
 */

/**
 * Create a stateless PRNG function from a seed.
 * @param {number} seed 32-bit seed value.
 * @returns {() => number} Float in [0, 1).
 */
export function mulberry32(seed) {
  let state = (seed >>> 0) || 1;
  return function next() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stateful RNG wrapper with convenient helpers used across generation.
 */
export class RNG {
  /** @param {number} seed */
  constructor(seed) {
    this._next = mulberry32(seed);
  }

  /** @returns {number} Uniform float in [0, 1). */
  float() {
    return this._next();
  }

  /**
   * Uniform integer in [min, max] inclusive.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  int(min, max) {
    if (max < min) return min;
    return min + Math.floor(this._next() * (max - min + 1));
  }

  /** @param {number} p Probability 0-1. @returns {boolean} */
  chance(p) {
    return this._next() < p;
  }

  /** @param {T[]} arr @returns {T|undefined} Random element. */
  pick(arr) {
    return arr.length ? arr[this.int(0, arr.length - 1)] : undefined;
  }

  /** Fisher-Yates shuffle (in place). @param {T[]} arr @returns {T[]} */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
}