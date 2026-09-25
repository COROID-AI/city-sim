/**
 * Deterministic pseudo-random number generation.
 *
 * Every procedural decision in the city (layout jitter, facade colours, window
 * light flicker, crowd waypoints) is drawn from a seeded {@link RNG}, so a
 * given year always produces an identical scene graph. That is what makes the
 * generation integration-testable and keeps era transitions predictable.
 */

/** mulberry32 - tiny, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn a string into a stable 32-bit seed (FNV-1a). */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Convenience wrapper around {@link mulberry32} with typed helpers. */
export class RNG {
  private readonly source: () => number;

  constructor(seed: number | string = 1) {
    this.source = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed >>> 0);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.source();
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.source() * (max - min);
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return Math.floor(this.range(min, max + 1 - 1e-9));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.source() < p;
  }

  /** Random element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.source() * items.length) % items.length];
  }

  /** Signed jitter in [-amount, amount). */
  jitter(amount: number): number {
    return (this.source() * 2 - 1) * amount;
  }

  /** Shallow-shuffled copy (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.source() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }
}

/** Deterministic seed for an era layer: stable across builds and platforms. */
export function eraSeed(year: number): number {
  return hashSeed(`chrono-city:${year}`);
}
