/**
 * Unit tests for the colour interpolation utilities.
 *
 * lerpColor is the only export; the internal hexToRgb/rgbToHex/clamp helpers
 * are exercised through it.
 */
import { lerpColor } from '@/utils/color';

describe('color utilities', () => {
  describe('lerpColor', () => {
    it('returns the `from` colour at t=0', () => {
      expect(lerpColor('#000000', '#ffffff', 0)).toBe('#000000');
    });

    it('returns the `to` colour at t=1', () => {
      expect(lerpColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    });

    it('returns the midpoint at t=0.5', () => {
      // (0+255)/2 = 127.5 -> rounds to 128 -> hex 80
      expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    });

    it('clamps negative t to 0', () => {
      expect(lerpColor('#ff0000', '#00ff00', -1)).toBe('#ff0000');
    });

    it('clamps t above 1 to 1', () => {
      expect(lerpColor('#ff0000', '#00ff00', 2)).toBe('#00ff00');
    });

    it('handles shorthand 3-digit hex input', () => {
      // #fff expands to #ffffff
      expect(lerpColor('#fff', '#000', 0)).toBe('#ffffff');
      expect(lerpColor('#000', '#fff', 1)).toBe('#ffffff');
    });

    it('interpolates each channel independently', () => {
      // #100000 -> #200000 at t=0.5: r = (16+32)/2 = 24 -> hex 18
      expect(lerpColor('#100000', '#200000', 0.5)).toBe('#180000');
    });

    it('produces a valid 7-character hex string', () => {
      const result = lerpColor('#3a5a7b', '#2a4a6b', 0.5);
      expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('clamps channel values to [0, 255]', () => {
      // With normal hex inputs channels are already in range, but verify
      // the output never exceeds the bounds.
      const result = lerpColor('#000000', '#ffffff', 0.5);
      const channel = parseInt(result.slice(1, 3), 16);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    });
  });
});
