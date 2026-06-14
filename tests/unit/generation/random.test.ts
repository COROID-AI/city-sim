import { createRng } from '@/generation/random';

describe('createRng', () => {
  it('produces a deterministic sequence for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const firstA = a.next();
    const firstB = b.next();
    expect(firstA).not.toBe(firstB);
  });

  it('next() always returns a float in [0, 1)', () => {
    const rng = createRng(123);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() is inclusive on both ends and integer-valued', () => {
    const rng = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(3, 5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
    }
  });

  it('int() throws on inverted bounds', () => {
    const rng = createRng(1);
    expect(() => rng.int(5, 3)).toThrow(RangeError);
  });

  it('int() throws on non-integer bounds', () => {
    const rng = createRng(1);
    expect(() => rng.int(1.5, 3)).toThrow(RangeError);
  });

  it('float() returns a number in [min, max)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.float(2, 4);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(4);
    }
  });

  it('float() throws when max <= min', () => {
    const rng = createRng(1);
    expect(() => rng.float(3, 3)).toThrow(RangeError);
  });

  it('pick() returns a member of the input', () => {
    const rng = createRng(5);
    const items = ['a', 'b', 'c', 'd', 'e'] as const;
    for (let i = 0; i < 200; i++) {
      const v = rng.pick(items);
      expect(items).toContain(v);
    }
  });

  it('pick() throws on empty arrays', () => {
    const rng = createRng(1);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('shuffle() returns a new array of the same length without mutating input', () => {
    const rng = createRng(11);
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const original = input.slice();
    const out = rng.shuffle(input);
    expect(out).not.toBe(input);
    expect(out).toHaveLength(input.length);
    expect(input).toEqual(original);
    // Same multiset (we don't assert order, just that nothing was lost/duped)
    expect([...out].sort((a, b) => a - b)).toEqual([...input].sort((a, b) => a - b));
  });

  it('shuffle() is deterministic for a given seed', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = createRng(2024).shuffle(input);
    const b = createRng(2024).shuffle(input);
    expect(a).toEqual(b);
  });

  it('chance() respects the probability (statistical)', () => {
    const rng = createRng(2025);
    let hits = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      if (rng.chance(0.3)) hits += 1;
    }
    const ratio = hits / n;
    // Loose bounds to keep the test stable.
    expect(ratio).toBeGreaterThan(0.27);
    expect(ratio).toBeLessThan(0.33);
  });

  it('chance(0) is always false; chance(1) is always true', () => {
    const rng = createRng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });
});
