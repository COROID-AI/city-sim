/**
 * Lighting unit tests — pure-function math (no canvas mock needed).
 *
 * Covers the core acceptance criteria:
 *  - overlayAlpha ~0 at noon, >=0.5 at midnight.
 *  - Night overlay color rgba(10,15,40,0.55).
 *  - Window/street light color constants match spec.
 *  - Transitions interpolate monotonically across phase boundaries.
 */
import {
  computeLightingState,
  hashToUnit,
  LIGHT_THRESHOLD,
  NIGHT_OVERLAY_ALPHA,
  NIGHT_OVERLAY_COLOR,
  STREET_LIGHT_GLOW_COLOR,
  WINDOW_LIGHT_COLOR,
} from '@/engine/Lighting';
import type { CityTime } from '@/engine/types';

/** Helper: build a CityTime at a given hour/minute (day 0). */
function atTime(hour: number, minute = 0): CityTime {
  return { day: 0, hour, minute, totalMs: hour * 3_600_000 + minute * 60_000 };
}

describe('Lighting constants (spec §6.1)', () => {
  it('exports the night overlay color rgba(10,15,40,0.55)', () => {
    expect(NIGHT_OVERLAY_COLOR).toBe('rgba(10,15,40,0.55)');
  });

  it('exports the window light color #ffeb3b', () => {
    expect(WINDOW_LIGHT_COLOR).toBe('#ffeb3b');
  });

  it('exports the street light glow color rgba(255,220,100,0.3)', () => {
    expect(STREET_LIGHT_GLOW_COLOR).toBe('rgba(255,220,100,0.3)');
  });

  it('uses 0.55 as the max night overlay alpha', () => {
    expect(NIGHT_OVERLAY_ALPHA).toBe(0.55);
  });
});

describe('computeLightingState — key hours', () => {
  it('returns overlayAlpha < 0.01 at noon (12:00)', () => {
    const state = computeLightingState(atTime(12, 0));
    expect(state.overlayAlpha).toBeLessThan(0.01);
    expect(state.phase).toBe('day');
    expect(state.isNight).toBe(false);
  });

  it('returns overlayAlpha >= 0.5 at midnight (00:00)', () => {
    const state = computeLightingState(atTime(0, 0));
    expect(state.overlayAlpha).toBeGreaterThanOrEqual(0.5);
    expect(state.phase).toBe('night');
    expect(state.isNight).toBe(true);
  });

  it('returns full 0.55 alpha at deep night (03:00)', () => {
    const state = computeLightingState(atTime(3, 0));
    expect(state.overlayAlpha).toBeCloseTo(0.55, 5);
    expect(state.phase).toBe('night');
  });

  it('returns ~0 alpha during full day (15:00)', () => {
    const state = computeLightingState(atTime(15, 0));
    expect(state.overlayAlpha).toBeLessThan(0.01);
    expect(state.phase).toBe('day');
  });
});

describe('computeLightingState — overlay color string', () => {
  it('embeds the interpolated alpha in rgba(10,15,40,<alpha>)', () => {
    const state = computeLightingState(atTime(0, 0));
    expect(state.overlayColor).toMatch(/^rgba\(10,15,40,/);
    // At midnight the alpha portion should be ~0.55.
    const alpha = parseFloat(state.overlayColor.split(',')[3]);
    expect(alpha).toBeGreaterThanOrEqual(0.5);
  });
});

describe('computeLightingState — phase identification', () => {
  it('identifies night before dawn', () => {
    expect(computeLightingState(atTime(2, 0)).phase).toBe('night');
  });

  it('identifies dawn around 06:00–08:00', () => {
    expect(computeLightingState(atTime(7, 0)).phase).toBe('dawn');
  });

  it('identifies day around 09:00–17:00', () => {
    expect(computeLightingState(atTime(12, 0)).phase).toBe('day');
  });

  it('identifies dusk around 18:00–20:00', () => {
    expect(computeLightingState(atTime(19, 0)).phase).toBe('dusk');
  });

  it('identifies night after dusk', () => {
    expect(computeLightingState(atTime(22, 0)).phase).toBe('night');
  });
});

describe('computeLightingState — light intensity correlates with darkness', () => {
  it('isNight is true only when overlayAlpha exceeds the threshold', () => {
    const night = computeLightingState(atTime(0, 0));
    const day = computeLightingState(atTime(12, 0));
    expect(night.isNight).toBe(true);
    expect(night.overlayAlpha).toBeGreaterThan(LIGHT_THRESHOLD);
    expect(day.isNight).toBe(false);
    expect(day.overlayAlpha).toBeLessThanOrEqual(LIGHT_THRESHOLD);
  });

  it('overlayAlpha is monotonically non-increasing from night to day (05:00→09:00)', () => {
    let prev = computeLightingState(atTime(5, 0)).overlayAlpha;
    for (let h = 5; h <= 9; h++) {
      for (const m of [0, 15, 30, 45]) {
        const cur = computeLightingState(atTime(h, m)).overlayAlpha;
        expect(cur).toBeLessThanOrEqual(prev + 1e-9);
        prev = cur;
      }
    }
  });

  it('overlayAlpha is monotonically non-decreasing from day to night (17:00→21:00)', () => {
    let prev = computeLightingState(atTime(17, 0)).overlayAlpha;
    for (let h = 17; h <= 21; h++) {
      for (const m of [0, 15, 30, 45]) {
        const cur = computeLightingState(atTime(h, m)).overlayAlpha;
        expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = cur;
      }
    }
  });
});

describe('computeLightingState — 30-sim-minute transitions', () => {
  it('changes alpha across the 05:00–06:00 boundary', () => {
    const before = computeLightingState(atTime(5, 0)).overlayAlpha;
    const after = computeLightingState(atTime(6, 0)).overlayAlpha;
    expect(after).toBeLessThan(before);
  });

  it('changes alpha across the 08:00–09:00 boundary', () => {
    const before = computeLightingState(atTime(8, 0)).overlayAlpha;
    const after = computeLightingState(atTime(9, 0)).overlayAlpha;
    expect(after).toBeLessThan(before);
  });

  it('changes alpha across the 17:00–18:00 boundary', () => {
    const before = computeLightingState(atTime(17, 0)).overlayAlpha;
    const after = computeLightingState(atTime(18, 0)).overlayAlpha;
    expect(after).toBeGreaterThan(before);
  });

  it('changes alpha across the 20:00–21:00 boundary', () => {
    const before = computeLightingState(atTime(20, 0)).overlayAlpha;
    const after = computeLightingState(atTime(21, 0)).overlayAlpha;
    expect(after).toBeGreaterThan(before);
  });
});

describe('hashToUnit', () => {
  it('returns a value in [0, 1)', () => {
    expect(hashToUnit('building-1')).toBeGreaterThanOrEqual(0);
    expect(hashToUnit('building-1')).toBeLessThan(1);
  });

  it('is deterministic for the same input', () => {
    expect(hashToUnit('abc')).toBe(hashToUnit('abc'));
  });

  it('varies across different inputs', () => {
    const values = new Set<number>();
    for (let i = 0; i < 50; i++) {
      values.add(hashToUnit(`b-${i}`));
    }
    // At least 40 distinct values out of 50 — good distribution.
    expect(values.size).toBeGreaterThanOrEqual(40);
  });
});
