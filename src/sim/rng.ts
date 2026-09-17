/**
 * Deterministic seeded pseudo random number generator.
 *
 * The whole simulation (world generation, schedules, traffic jitter) draws from
 * these streams so that a given seed always reproduces the same city. The
 * implementation is mulberry32: 32 bits of state, fast, no dependencies and
 * identical results on every JS engine.
 */

/** Serializable generator state, so long-running systems can persist/restore. */
export interface RngState {
  /** Seed the generator was created from. */
  readonly seed: number;
  /** Current 32-bit internal state. */
  readonly state: number;
  /** Number of values drawn so far. */
  readonly calls: number;
}

/** A deterministic random source. */
export interface Rng {
  /** Seed this generator was created from. */
  readonly seed: number;
  /** Current 32-bit internal state. */
  readonly state: number;
  /** Number of values drawn so far. */
  readonly calls: number;
  /** Next float in [0, 1). */
  next(): number;
  /** Next float in [min, max). */
  float(min: number, max: number): number;
  /** Next integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number;
  /** Next integer in [minInclusive, maxInclusive]. */
  intInclusive(minInclusive: number, maxInclusive: number): number;
  /** True with the given probability (default 0.5). */
  bool(probability?: number): boolean;
  /** Uniformly picks one element; throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** Picks by relative weight; throws on an empty list or non-positive total. */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Returns a shuffled copy (the input array is left untouched). */
  shuffle<T>(items: readonly T[]): T[];
  /** Independent child stream derived from the current state and a label. */
  fork(label?: string): Rng;
  /** Snapshot of the internal state. */
  snapshot(): RngState;
  /** Restores a snapshot so the following draws repeat exactly. */
  restore(state: RngState): void;
}

const UINT32 = 0x100000000;

/** FNV-1a style string hash producing a stable 32-bit seed. */
export function hashStringToSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function normalizeSeed(seed: number | string): number {
  if (typeof seed === 'string') {
    return hashStringToSeed(seed);
  }
  if (!Number.isFinite(seed)) {
    throw new RangeError(`createRng(seed) expects a finite number or string, received ${seed}`);
  }
  return Math.trunc(seed) >>> 0;
}

class Mulberry32Rng implements Rng {
  readonly seed: number;
  private current: number;
  private draws = 0;

  constructor(seed: number | string) {
    this.seed = normalizeSeed(seed);
    this.current = this.seed;
  }

  get state(): number {
    return this.current;
  }

  get calls(): number {
    return this.draws;
  }

  next(): number {
    this.current = (this.current + 0x6d2b79f5) >>> 0;
    let t = this.current;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    this.draws += 1;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  }

  float(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      throw new RangeError(`rng.float(min, max) expects finite bounds with max >= min, received ${min}, ${max}`);
    }
    return min + this.next() * (max - min);
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive) || maxExclusive <= minInclusive) {
      throw new RangeError(
        `rng.int(min, max) expects integers with max > min, received ${minInclusive}, ${maxExclusive}`,
      );
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  intInclusive(minInclusive: number, maxInclusive: number): number {
    return this.int(minInclusive, maxInclusive + 1);
  }

  bool(probability = 0.5): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError(`rng.bool(probability) expects a value in [0, 1], received ${probability}`);
    }
    if (probability === 0) {
      return false;
    }
    if (probability === 1) {
      return true;
    }
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('rng.pick(items) expects a non-empty list');
    }
    return items[this.int(0, items.length)];
  }

  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError('rng.pickWeighted(items, weights) expects matching, non-empty lists');
    }
    let total = 0;
    for (const weight of weights) {
      if (!Number.isFinite(weight) || weight < 0) {
        throw new RangeError(`rng.pickWeighted weights must be finite and non-negative, received ${weight}`);
      }
      total += weight;
    }
    if (total <= 0) {
      throw new RangeError('rng.pickWeighted expects a positive total weight');
    }
    let threshold = this.next() * total;
    for (let index = 0; index < items.length; index += 1) {
      threshold -= weights[index];
      if (threshold < 0) {
        return items[index];
      }
    }
    return items[items.length - 1];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = items.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = this.int(0, index + 1);
      const value = copy[index];
      copy[index] = copy[swap];
      copy[swap] = value;
    }
    return copy;
  }

  fork(label = ''): Rng {
    const mixed = (Math.imul(this.current ^ hashStringToSeed(label), 0x9e3779b1) >>> 0) ^ this.seed;
    return new Mulberry32Rng(mixed);
  }

  snapshot(): RngState {
    return { seed: this.seed, state: this.current, calls: this.draws };
  }

  restore(state: RngState): void {
    if (!Number.isInteger(state.state) || state.state < 0) {
      throw new RangeError(`rng.restore(state) expects a non-negative integer state, received ${state.state}`);
    }
    this.current = state.state >>> 0;
    this.draws = state.calls ?? 0;
  }
}

/** Creates a deterministic generator. Numeric and string seeds both work. */
export function createRng(seed: number | string = 1): Rng {
  return new Mulberry32Rng(seed);
}
