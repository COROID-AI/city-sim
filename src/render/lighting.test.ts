import { applyLighting, drawSun, getSunPosition } from './lighting';
import { getDaylightFactor } from '../sim/world';
import { HOURS_PER_DAY } from '../sim/constants';
import type { World } from '../sim/types';

// ─── Test fixtures ───────────────────────────────────────────────────────────

/** Build a minimal, valid {@link World} pinned to `elapsedHours`. */
function makeWorld(elapsedHours: number): World {
  return {
    width: 1,
    height: 1,
    tiles: [],
    buildings: new Map(),
    citizens: new Map(),
    vehicles: new Map(),
    companies: new Map(),
    simTime: { elapsedHours },
    budget: 0,
    derivedStats: {
      population: 0,
      employmentRate: 0,
      lastHourTaxIncome: 0,
      lastHourExpenses: 0,
    },
    lastEconomyHour: -1,
    lastRevenueBaseline: 0,
  };
}

/** Parse the alpha channel out of an `rgba(r, g, b, a)` string. */
function alphaOf(rgba: string): number {
  const match = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(rgba);
  return match ? Number(match[1]) : NaN;
}

/** A jest.Mock function alias for readability. */
type MockFn = jest.Mock;

/**
 * Recording mock for `CanvasRenderingContext2D`.
 *
 * Every assignment to `fillStyle` is captured in `fillStyles`, and the
 * drawing methods are exposed as `jest.fn()` spies so tests can inspect
 * their arguments directly via the returned `fns` map.
 */
interface MockCtx {
  ctx: CanvasRenderingContext2D;
  fillStyles: string[];
  fns: {
    fillRect: MockFn;
    save: MockFn;
    restore: MockFn;
    beginPath: MockFn;
    arc: MockFn;
    fill: MockFn;
    createRadialGradient: MockFn;
  };
}

function createMockCtx(): MockCtx {
  const fillStyles: string[] = [];
  let currentFillStyle = '';

  const fillRect = jest.fn();
  const save = jest.fn();
  const restore = jest.fn();
  const beginPath = jest.fn();
  const arc = jest.fn();
  const fill = jest.fn();
  const createRadialGradient = jest.fn(() => ({ addColorStop: jest.fn() }));

  const ctx = {
    get fillStyle(): string {
      return currentFillStyle;
    },
    set fillStyle(value: string) {
      currentFillStyle = value;
      fillStyles.push(value);
    },
    fillRect,
    save,
    restore,
    beginPath,
    arc,
    fill,
    createRadialGradient,
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    fillStyles,
    fns: { fillRect, save, restore, beginPath, arc, fill, createRadialGradient },
  };
}

/** Local sunrise/sunset hours mirroring the module constants. */
const SUNRISE_HOUR = 6;
const SUNSET_HOUR = 18;

const W = 800;
const H = 600;

// ─── Exports ─────────────────────────────────────────────────────────────────

describe('lighting exports', () => {
  it('exports applyLighting and drawSun as functions', () => {
    expect(typeof applyLighting).toBe('function');
    expect(typeof drawSun).toBe('function');
  });
});

// ─── applyLighting ───────────────────────────────────────────────────────────

describe('applyLighting', () => {
  it('draws two full-viewport overlays', () => {
    const { ctx, fns } = createMockCtx();
    applyLighting(ctx, makeWorld(6), W, H);

    expect(fns.fillRect).toHaveBeenCalledTimes(2);
    fns.fillRect.mock.calls.forEach((args: number[]) => {
      expect(args[0]).toBe(0);
      expect(args[1]).toBe(0);
      expect(args[2]).toBe(W);
      expect(args[3]).toBe(H);
    });
  });

  it('applies a significant night-darkening alpha (≥0.3) at hour 0', () => {
    const { ctx, fillStyles } = createMockCtx();
    applyLighting(ctx, makeWorld(0), W, H); // midnight → daylight 0

    const night = fillStyles.find(
      (f) => typeof f === 'string' && f.startsWith('rgba(10, 15, 40'),
    );
    expect(night).toBeDefined();
    expect(alphaOf(night as string)).toBeGreaterThanOrEqual(0.3);
  });

  it('applies a near-zero night-darkening alpha (≤0.1) at hour 12', () => {
    const { ctx, fillStyles } = createMockCtx();
    applyLighting(ctx, makeWorld(12), W, H); // noon → daylight 1

    const night = fillStyles.find(
      (f) => typeof f === 'string' && f.startsWith('rgba(10, 15, 40'),
    );
    expect(night).toBeDefined();
    expect(alphaOf(night as string)).toBeLessThanOrEqual(0.1);
  });

  it('applies a small but non-zero daytime warm tint at hour 12', () => {
    const { ctx, fillStyles } = createMockCtx();
    applyLighting(ctx, makeWorld(12), W, H);

    const warm = fillStyles.find(
      (f) => typeof f === 'string' && f.startsWith('rgba(255, 220, 140'),
    );
    expect(warm).toBeDefined();
    const a = alphaOf(warm as string);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(0.1);
  });

  it('drives overlay alphas directly from the daylight factor', () => {
    const { ctx, fillStyles } = createMockCtx();
    const world = makeWorld(18); // dusk
    applyLighting(ctx, world, W, H);

    const daylight = getDaylightFactor(world.simTime.elapsedHours);

    const night = fillStyles.find(
      (f) => typeof f === 'string' && f.startsWith('rgba(10, 15, 40'),
    ) as string;
    const warm = fillStyles.find(
      (f) => typeof f === 'string' && f.startsWith('rgba(255, 220, 140'),
    ) as string;

    expect(alphaOf(night)).toBeCloseTo(0.55 * (1 - daylight), 5);
    expect(alphaOf(warm)).toBeCloseTo(0.08 * daylight, 5);
  });
});

// ─── getSunPosition (arc) ────────────────────────────────────────────────────

describe('getSunPosition', () => {
  it('places the disk on the left horizon at sunrise', () => {
    const pos = getSunPosition(SUNRISE_HOUR, W, H);
    expect(pos.x).toBeCloseTo(0, 5);
  });

  it('peaks above the horizon at noon (top-centre)', () => {
    const noon = getSunPosition(12, W, H);
    const sunrise = getSunPosition(SUNRISE_HOUR, W, H);

    expect(noon.x).toBeCloseTo(W / 2, 5);
    // Higher up than at sunrise (smaller y).
    expect(noon.y).toBeLessThan(sunrise.y);
  });

  it('reaches the right horizon at sunset', () => {
    const pos = getSunPosition(SUNSET_HOUR, W, H);
    expect(pos.x).toBeCloseTo(W, 5);
  });

  it('rises between sunrise and noon', () => {
    const early = getSunPosition(8, W, H);
    const later = getSunPosition(11, W, H);
    expect(later.y).toBeLessThan(early.y); // higher → smaller y
  });

  it('sets between noon and sunset', () => {
    const early = getSunPosition(13, W, H);
    const later = getSunPosition(17, W, H);
    expect(later.y).toBeGreaterThan(early.y); // lower → larger y
  });

  it('keeps the disk within the viewport bounds for all hours', () => {
    for (let h = 0; h < HOURS_PER_DAY; h += 1) {
      const pos = getSunPosition(h, W, H);
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.x).toBeLessThanOrEqual(W);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeLessThanOrEqual(H);
    }
  });
});

// ─── drawSun ─────────────────────────────────────────────────────────────────

describe('drawSun', () => {
  it('draws at least one disk (arc call) on the canvas', () => {
    const { ctx, fns } = createMockCtx();
    drawSun(ctx, makeWorld(12), W, H);

    expect(fns.arc).toHaveBeenCalled();
    expect(fns.fill).toHaveBeenCalled();
  });

  it('positions the disk at the computed sun position for the hour', () => {
    const { ctx, fns } = createMockCtx();
    drawSun(ctx, makeWorld(12), W, H);

    const expected = getSunPosition(12, W, H);
    // The last arc call is the core disk.
    const lastCall = fns.arc.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![0]).toBeCloseTo(expected.x, 1);
    expect(lastCall![1]).toBeCloseTo(expected.y, 1);
  });

  it('moves the disk as the hour changes (rising arc)', () => {
    const { ctx: ctxSunrise, fns: fnsSunrise } = createMockCtx();
    drawSun(ctxSunrise, makeWorld(SUNRISE_HOUR), W, H);
    const sunriseCall = fnsSunrise.arc.mock.calls.at(-1);

    const { ctx: ctxNoon, fns: fnsNoon } = createMockCtx();
    drawSun(ctxNoon, makeWorld(12), W, H);
    const noonCall = fnsNoon.arc.mock.calls.at(-1);

    expect(sunriseCall![0]).not.toBeCloseTo(noonCall![0], 1);
  });
});
