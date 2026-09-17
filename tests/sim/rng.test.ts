import { describe, expect, it } from 'vitest';

import { createRng, hashStringToSeed } from '../../src/sim/rng';

function take(rng: ReturnType<typeof createRng>, count: number): number[] {
  return Array.from({ length: count }, () => rng.next());
}

describe('createRng', () => {
  it('is deterministic for a numeric seed', () => {
    const first = take(createRng(1234), 6);
    const second = take(createRng(1234), 6);
    expect(first).toEqual(second);
    expect(first).toHaveLength(6);
  });

  it('is deterministic for a string seed and differs across seeds', () => {
    expect(take(createRng('city'), 4)).toEqual(take(createRng('city'), 4));
    expect(take(createRng('city'), 4)).not.toEqual(take(createRng('city-2'), 4));
    expect(hashStringToSeed('city')).toBe(hashStringToSeed('city'));
    expect(hashStringToSeed('city')).not.toBe(hashStringToSeed('metro'));
  });

  it('keeps next() inside [0, 1) and float() inside its bounds', () => {
    const rng = createRng(99);
    for (let index = 0; index < 500; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    for (let index = 0; index < 200; index += 1) {
      const value = rng.float(-3, 7);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(7);
    }
    expect(() => rng.float(5, 1)).toThrow(RangeError);
    expect(() => rng.float(Number.NaN, 1)).toThrow(RangeError);
  });

  it('produces bounded integers and validates its range', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let index = 0; index < 400; index += 1) {
      const value = rng.int(2, 6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(6);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
    expect(rng.intInclusive(1, 3)).toBeGreaterThanOrEqual(1);
    expect(rng.intInclusive(1, 3)).toBeLessThanOrEqual(3);
    expect(() => rng.int(1, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
  });

  it('honours probability bounds in bool()', () => {
    const rng = createRng(5);
    expect(rng.bool(0)).toBe(false);
    expect(rng.bool(1)).toBe(true);
    let hits = 0;
    for (let index = 0; index < 400; index += 1) {
      if (rng.bool(0.5)) {
        hits += 1;
      }
    }
    expect(hits).toBeGreaterThan(100);
    expect(hits).toBeLessThan(300);
    expect(() => rng.bool(1.5)).toThrow(RangeError);
  });

  it('picks and shuffles deterministically without mutating the input', () => {
    const items = ['a', 'b', 'c', 'd', 'e'] as const;
    const first = createRng(42).shuffle(items);
    const second = createRng(42).shuffle(items);
    expect(first).toEqual(second);
    expect([...first].sort()).toEqual([...items].sort());
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);

    const rng = createRng(3);
    expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);

    const weighted = rng.pickWeighted(['bus', 'car'], [0, 1]);
    expect(weighted).toBe('car');
    expect(() => rng.pickWeighted([], [])).toThrow(RangeError);
    expect(() => rng.pickWeighted(['a', 'b'], [1])).toThrow(RangeError);
  });

  it('forks independent, reproducible child streams', () => {
    const parent = createRng('metro');
    const before = parent.state;
    const childA = parent.fork('traffic');
    const childB = parent.fork('traffic');
    const childC = parent.fork('economy');
    expect(parent.state).toBe(before);
    expect(take(childA, 3)).toEqual(take(childB, 3));
    expect(take(createRng('metro').fork('traffic'), 3)).not.toEqual(take(childC, 3));
  });

  it('snapshots and restores its state', () => {
    const rng = createRng(2024);
    take(rng, 3);
    const snapshot = rng.snapshot();
    const expected = take(rng, 4);
    rng.restore(snapshot);
    expect(rng.state).toBe(snapshot.state);
    expect(take(rng, 4)).toEqual(expected);
    expect(() => rng.restore({ seed: 1, state: -1, calls: 0 })).toThrow(RangeError);
  });
});
