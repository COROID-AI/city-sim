/**
 * Renderer unit tests.
 *
 * We exercise the pure style-resolution helpers and the colour table
 * shape; we do NOT exercise the actual ctx.draw* path because jsdom's
 * 2D context is a stub. Visual verification is via Playwright e2e in
 * the next iteration.
 */
import {
  ACTIVITY_COLORS,
  VEHICLE_COLOR,
  assertActivityColorsComplete,
  assertVehicleColorsComplete,
  resolveCitizenStyle,
  resolveVehicleStyle,
} from '@/components/city/Renderer';
import { ACTIVITY_IDS, type ActivityId } from '@/types/common';

describe('Renderer', () => {
  describe('ACTIVITY_COLORS table', () => {
    it('has an entry for every ActivityId', () => {
      for (const id of ACTIVITY_IDS) {
        expect(typeof ACTIVITY_COLORS[id]).toBe('string');
        expect(ACTIVITY_COLORS[id]?.length ?? 0).toBeGreaterThan(0);
      }
    });

    it('has exactly 7 entries (one per ActivityId)', () => {
      expect(Object.keys(ACTIVITY_COLORS)).toHaveLength(7);
    });

    it('passes assertActivityColorsComplete with no throw', () => {
      expect(() => assertActivityColorsComplete(ACTIVITY_COLORS)).not.toThrow();
    });

    it('throws when an activity is missing from the table', () => {
      const broken: Record<string, string> = { ...ACTIVITY_COLORS };
      delete (broken as Record<string, string | undefined>)['work'];
      expect(() => assertActivityColorsComplete(broken)).toThrow(/work/);
    });
  });

  describe('resolveCitizenStyle', () => {
    it('returns a non-empty fill and halo for every activity', () => {
      const activities: ActivityId[] = [...ACTIVITY_IDS];
      for (const a of activities) {
        const style = resolveCitizenStyle(a, null);
        expect(style.fill.length).toBeGreaterThan(0);
        expect(style.halo.length).toBeGreaterThan(0);
      }
    });

    it('falls back to the hard-coded palette when getComputedStyle returns ""', () => {
      // jsdom returns '' for any CSS custom property, which is exactly
      // the case we need to handle. The fallback should kick in and
      // produce a sensible hex colour.
      const style = resolveCitizenStyle('sleep', null);
      expect(style.fill.startsWith('#') || style.fill.startsWith('oklch')).toBe(true);
    });

    it('returns the CSS variable value when getComputedStyle provides one', () => {
      const fakeRoot = {
        // Minimal Element-shaped stub; we only use getPropertyValue.
        // Cast through unknown because we don't implement the full Element
        // interface in a test.
      } as unknown as Element;
      const original = (globalThis as { getComputedStyle?: (e: Element) => CSSStyleDeclaration }).getComputedStyle;
      (globalThis as unknown as { getComputedStyle: (e: Element) => CSSStyleDeclaration }).getComputedStyle = (): CSSStyleDeclaration => {
        const map: Record<string, string> = { '--color-citizen': 'oklch(0.5 0.1 200)' };
        return {
          getPropertyValue(name: string): string {
            return map[name] ?? '';
          },
        } as unknown as CSSStyleDeclaration;
      };
      try {
        const style = resolveCitizenStyle('sleep', fakeRoot);
        expect(style.fill).toBe('oklch(0.5 0.1 200)');
      } finally {
        if (original === undefined) {
          delete (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
        } else {
          (globalThis as unknown as { getComputedStyle: typeof original }).getComputedStyle = original;
        }
      }
    });
  });

  describe('Renderer vehicles', () => {
    it('exports a VEHICLE_COLOR token pointing at --color-warning', () => {
      expect(VEHICLE_COLOR).toBe('--color-warning');
    });

    it('resolveVehicleStyle falls back to a non-empty orange when CSS is missing', () => {
      const style = resolveVehicleStyle(null);
      expect(typeof style.body).toBe('string');
      expect(style.body.length).toBeGreaterThan(0);
    });

    it('resolveVehicleStyle returns the CSS value when getComputedStyle provides one', () => {
      const original = (globalThis as { getComputedStyle?: (e: Element) => CSSStyleDeclaration }).getComputedStyle;
      (globalThis as unknown as { getComputedStyle: (e: Element) => CSSStyleDeclaration }).getComputedStyle = (): CSSStyleDeclaration => {
        const map: Record<string, string> = { '--color-warning': 'oklch(0.7 0.15 60)' };
        return {
          getPropertyValue(name: string): string {
            return map[name] ?? '';
          },
        } as unknown as CSSStyleDeclaration;
      };
      try {
        const style = resolveVehicleStyle({} as unknown as Element);
        expect(style.body).toBe('oklch(0.7 0.15 60)');
      } finally {
        if (original === undefined) {
          delete (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
        } else {
          (globalThis as unknown as { getComputedStyle: typeof original }).getComputedStyle = original;
        }
      }
    });

    it('assertVehicleColorsComplete accepts valid token/fallback pairs', () => {
      expect(() => assertVehicleColorsComplete('--color-warning', '#e8b878')).not.toThrow();
    });

    it('assertVehicleColorsComplete rejects empty / malformed tokens', () => {
      expect(() => assertVehicleColorsComplete('color-warning', '#e8b878')).toThrow();
      expect(() => assertVehicleColorsComplete('', '#e8b878')).toThrow();
      expect(() => assertVehicleColorsComplete('--color-warning', '')).toThrow();
    });
  });
});
