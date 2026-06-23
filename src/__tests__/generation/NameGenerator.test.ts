/**
 * Unit tests for NameGenerator (spec §6.3).
 *
 * Tests assert structural properties (name parts drawn from the exported
 * pools, single space separator) rather than exact values, since the
 * generator is intentionally non-deterministic.
 */
import {
  NameGenerator,
  FIRST_NAMES,
  LAST_NAMES,
} from '@/generation/NameGenerator';

describe('NameGenerator', () => {
  describe('name pools', () => {
    it('exposes non-empty first and last name arrays', () => {
      expect(FIRST_NAMES.length).toBeGreaterThan(0);
      expect(LAST_NAMES.length).toBeGreaterThan(0);
    });

    it('every pool entry is a non-empty string', () => {
      for (const name of FIRST_NAMES) {
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
      for (const name of LAST_NAMES) {
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
    });
  });

  describe('generate()', () => {
    it('produces a string with exactly one space', () => {
      const name = NameGenerator.generate();
      expect(typeof name).toBe('string');
      expect(name.split(' ')).toHaveLength(2);
    });

    it('first part is drawn from FIRST_NAMES', () => {
      // Run many times to exercise randomness.
      for (let i = 0; i < 50; i += 1) {
        const [first] = NameGenerator.generate().split(' ');
        expect(FIRST_NAMES).toContain(first);
      }
    });

    it('second part is drawn from LAST_NAMES', () => {
      for (let i = 0; i < 50; i += 1) {
        const [, last] = NameGenerator.generate().split(' ');
        expect(LAST_NAMES).toContain(last);
      }
    });

    it('produces non-empty first and last parts', () => {
      const name = NameGenerator.generate();
      const [first, last] = name.split(' ');
      expect(first.length).toBeGreaterThan(0);
      expect(last.length).toBeGreaterThan(0);
    });
  });

  describe('generateMany()', () => {
    it('returns the requested number of names', () => {
      const names = NameGenerator.generateMany(10);
      expect(names).toHaveLength(10);
      for (const name of names) {
        expect(name.split(' ')).toHaveLength(2);
      }
    });

    it('returns an empty array for count 0', () => {
      expect(NameGenerator.generateMany(0)).toEqual([]);
    });

    it('throws for negative count', () => {
      expect(() => NameGenerator.generateMany(-1)).toThrow();
    });
  });
});
