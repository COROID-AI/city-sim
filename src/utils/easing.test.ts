/**
 * Unit tests for the easing and interpolation utilities.
 *
 * These are pure functions, so tests verify mathematical correctness at
 * boundary and mid-range points, including clamping behaviour.
 */
import {
  clamp01,
  smoothstep,
  smootherstep,
  easeInOutCubic,
  lerp,
} from '@/utils/easing';

describe('easing utilities', () => {
  describe('clamp01', () => {
    it('clamps values below 0 to 0', () => {
      expect(clamp01(-1)).toBe(0);
      expect(clamp01(-0.001)).toBe(0);
    });

    it('clamps values above 1 to 1', () => {
      expect(clamp01(2)).toBe(1);
      expect(clamp01(1.001)).toBe(1);
    });

    it('passes through values in [0, 1] unchanged', () => {
      expect(clamp01(0)).toBe(0);
      expect(clamp01(0.5)).toBe(0.5);
      expect(clamp01(1)).toBe(1);
    });
  });

  describe('smoothstep', () => {
    it('returns 0 at t=0', () => {
      expect(smoothstep(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(smoothstep(1)).toBe(1);
    });

    it('returns 0.5 at t=0.5', () => {
      expect(smoothstep(0.5)).toBeCloseTo(0.5);
    });

    it('clamps negative input to 0', () => {
      expect(smoothstep(-0.5)).toBe(0);
    });

    it('clamps input above 1 to 1', () => {
      expect(smoothstep(1.5)).toBe(1);
    });

    it('produces an S-curve (midpoint is exactly 0.5)', () => {
      // 3t² - 2t³ at t=0.5 = 3(0.25) - 2(0.125) = 0.75 - 0.25 = 0.5
      expect(smoothstep(0.5)).toBeCloseTo(0.5, 10);
    });
  });

  describe('smootherstep', () => {
    it('returns 0 at t=0', () => {
      expect(smootherstep(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(smootherstep(1)).toBe(1);
    });

    it('returns 0.5 at t=0.5', () => {
      expect(smootherstep(0.5)).toBeCloseTo(0.5);
    });

    it('clamps negative input to 0', () => {
      expect(smootherstep(-1)).toBe(0);
    });

    it('clamps input above 1 to 1', () => {
      expect(smootherstep(5)).toBe(1);
    });
  });

  describe('easeInOutCubic', () => {
    it('returns 0 at t=0', () => {
      expect(easeInOutCubic(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(easeInOutCubic(1)).toBe(1);
    });

    it('returns 0.5 at t=0.5', () => {
      expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    });

    it('uses the first branch for t < 0.5', () => {
      // 4x³ at x=0.25 = 4(0.015625) = 0.0625
      expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625);
    });

    it('uses the second branch for t >= 0.5', () => {
      // 1 - (-2*0.75+2)³ / 2 = 1 - (0.5)³ / 2 = 1 - 0.0625 = 0.9375
      expect(easeInOutCubic(0.75)).toBeCloseTo(0.9375);
    });

    it('clamps negative input to 0', () => {
      expect(easeInOutCubic(-0.5)).toBe(0);
    });

    it('clamps input above 1 to 1', () => {
      expect(easeInOutCubic(2)).toBe(1);
    });
  });

  describe('lerp', () => {
    it('returns `from` at t=0', () => {
      expect(lerp(10, 20, 0)).toBe(10);
    });

    it('returns `to` at t=1', () => {
      expect(lerp(10, 20, 1)).toBe(20);
    });

    it('returns the midpoint at t=0.5', () => {
      expect(lerp(10, 20, 0.5)).toBe(15);
    });

    it('clamps negative t to 0 (returns from)', () => {
      expect(lerp(10, 20, -1)).toBe(10);
    });

    it('clamps t above 1 to 1 (returns to)', () => {
      expect(lerp(10, 20, 5)).toBe(20);
    });

    it('works with negative ranges', () => {
      expect(lerp(0, -10, 0.5)).toBe(-5);
    });
  });
});
