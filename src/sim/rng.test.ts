import { createRng, type Rng } from './rng';

describe('createRng', () => {
  // ─── next() determinism ───────────────────────────────────────────────────

  describe('next – determinism', () => {
    it('produces identical sequences for the same seed', () => {
      const a = createRng(12345);
      const b = createRng(12345);
      const seqA = Array.from({ length: 100 }, () => a.next());
      const seqB = Array.from({ length: 100 }, () => b.next());
      expect(seqA).toEqual(seqB);
    });

    it('produces different sequences for different seeds', () => {
      const a = createRng(1);
      const b = createRng(2);
      const seqA = Array.from({ length: 10 }, () => a.next());
      const seqB = Array.from({ length: 10 }, () => b.next());
      expect(seqA).not.toEqual(seqB);
    });
  });

  // ─── next() range ──────────────────────────────────────────────────────────

  describe('next – range', () => {
    it('always returns a value in [0, 1)', () => {
      const rng = createRng(42);
      for (let i = 0; i < 1_000; i++) {
        const v = rng.next();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it('produces a variety of values (not all the same)', () => {
      const rng = createRng(7);
      const values = new Set(Array.from({ length: 100 }, () => rng.next()));
      expect(values.size).toBeGreaterThan(50);
    });
  });

  // ─── int() ────────────────────────────────────────────────────────────────

  describe('int – bounds', () => {
    it('always returns an integer within [min, max]', () => {
      const rng = createRng(999);
      for (let i = 0; i < 1_000; i++) {
        const v = rng.int(5, 10);
        expect(v).toBeGreaterThanOrEqual(5);
        expect(v).toBeLessThanOrEqual(10);
        expect(Number.isInteger(v)).toBe(true);
      }
    });

    it('returns min when min === max', () => {
      const rng = createRng(7);
      for (let i = 0; i < 10; i++) {
        expect(rng.int(3, 3)).toBe(3);
      }
    });

    it('can reach both bounds over many iterations', () => {
      const rng = createRng(31415);
      const seen = new Set<number>();
      for (let i = 0; i < 5_000; i++) {
        seen.add(rng.int(0, 5));
      }
      expect(seen.size).toBe(6); // 0,1,2,3,4,5 all seen
    });

    it('supports negative ranges', () => {
      const rng = createRng(2024);
      for (let i = 0; i < 500; i++) {
        const v = rng.int(-10, -1);
        expect(v).toBeGreaterThanOrEqual(-10);
        expect(v).toBeLessThanOrEqual(-1);
      }
    });

    it('throws RangeError when max < min', () => {
      const rng = createRng(1);
      expect(() => rng.int(10, 5)).toThrow(RangeError);
    });
  });

  describe('int – determinism', () => {
    it('produces deterministic values for the same seed', () => {
      const a = createRng(555);
      const b = createRng(555);
      const seqA = Array.from({ length: 20 }, () => a.int(0, 100));
      const seqB = Array.from({ length: 20 }, () => b.int(0, 100));
      expect(seqA).toEqual(seqB);
    });
  });

  // ─── pick() ───────────────────────────────────────────────────────────────

  describe('pick', () => {
    it('returns an element from the array', () => {
      const rng = createRng(77);
      const items = ['a', 'b', 'c', 'd'];
      const picked = rng.pick(items);
      expect(items).toContain(picked);
    });

    it('is deterministic for the same seed', () => {
      const a = createRng(888);
      const b = createRng(888);
      const items = [10, 20, 30, 40, 50];
      const picksA = Array.from({ length: 20 }, () => a.pick(items));
      const picksB = Array.from({ length: 20 }, () => b.pick(items));
      expect(picksA).toEqual(picksB);
    });

    it('returns only elements from the source array', () => {
      const rng = createRng(31337);
      const items = [100, 200, 300];
      for (let i = 0; i < 100; i++) {
        expect(items).toContain(rng.pick(items));
      }
    });

    it('throws RangeError on an empty array', () => {
      const rng = createRng(1);
      expect(() => rng.pick([])).toThrow(RangeError);
    });
  });

  // ─── shared state across methods ──────────────────────────────────────────

  describe('state sharing', () => {
    it('advances shared state across next, int, and pick calls', () => {
      const interleaved = createRng(100);
      const control = createRng(100);

      // Interleaved: next, int, pick
      interleaved.next();
      interleaved.int(0, 9);
      interleaved.pick(['x', 'y']);

      // Control: same underlying calls
      control.next();
      control.int(0, 9);
      control.pick(['x', 'y']);

      // After same number of pulls, both should agree
      expect(interleaved.next()).toBeCloseTo(control.next(), 10);
    });
  });

  // ─── interface type ────────────────────────────────────────────────────────

  describe('interface', () => {
    it('returns an object implementing Rng', () => {
      const rng: Rng = createRng(0);
      expect(typeof rng.next).toBe('function');
      expect(typeof rng.int).toBe('function');
      expect(typeof rng.pick).toBe('function');
    });
  });
});
