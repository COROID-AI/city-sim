import { drawHud, formatCityTime } from './hud';
import type { Citizen, World } from '../sim/types';

// ─── Test fixtures ───────────────────────────────────────────────────────────

/** Build a minimal, valid {@link World} for a given budget/time. */
function makeWorld(
  elapsedHours: number,
  budget = 100_000,
  population = 0,
  employmentRate = 0,
): World {
  const citizens = new Map<string, Citizen>();

  // aggregateStats() reads population from `world.citizens.size` and the
  // employment rate from citizens whose `work` field is non-null.  Populate
  // the map accordingly so the HUD reflects these values live.
  const employedCount = Math.round(population * employmentRate);
  for (let i = 0; i < population; i++) {
    citizens.set(`c${i}`, {
      id: `c${i}`,
      home: null,
      work: i < employedCount ? `b${i}` : null,
      entertainment: null,
      state: { kind: 'HOME', buildingId: 'b0' },
      position: { x: 0, y: 0 },
      money: 0,
      path: [],
      pathIndex: 0,
    });
  }

  return {
    width: 1,
    height: 1,
    tiles: [],
    buildings: new Map(),
    citizens,
    vehicles: new Map(),
    companies: new Map(),
    simTime: { elapsedHours },
    budget,
    derivedStats: {
      population,
      employmentRate,
      lastHourTaxIncome: 0,
      lastHourExpenses: 0,
    },
    lastEconomyHour: -1,
    lastRevenueBaseline: 0,
  };
}

/** A jest.Mock function alias for readability. */
type MockFn = jest.Mock;

/**
 * Recording mock for `CanvasRenderingContext2D`.
 *
 * Captures every `fillStyle`/`font` assignment and every text value
 * passed to `fillText` so tests can assert the rendered HUD readouts.
 */
interface MockCtx {
  ctx: CanvasRenderingContext2D;
  texts: string[];
  fillStyles: string[];
  fns: {
    fill: MockFn;
    stroke: MockFn;
    beginPath: MockFn;
    moveTo: MockFn;
    arcTo: MockFn;
    closePath: MockFn;
    fillText: MockFn;
    save: MockFn;
    restore: MockFn;
  };
  canvas: { width: number; height: number };
}

function createMockCtx(width = 1280): MockCtx {
  const texts: string[] = [];
  const fillStyles: string[] = [];
  let currentFillStyle = '';
  let currentFont = '';

  const fill = jest.fn();
  const stroke = jest.fn();
  const beginPath = jest.fn();
  const moveTo = jest.fn();
  const arcTo = jest.fn();
  const closePath = jest.fn();
  const fillText = jest.fn((text: string) => {
    texts.push(text);
  });
  const save = jest.fn();
  const restore = jest.fn();

  const canvas = { width, height: 720 };

  const ctx = {
    canvas,
    get fillStyle(): string {
      return currentFillStyle;
    },
    set fillStyle(value: string) {
      currentFillStyle = value;
      fillStyles.push(value);
    },
    get font(): string {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
    },
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    lineWidth: 1,
    fill,
    stroke,
    beginPath,
    moveTo,
    arcTo,
    closePath,
    fillText,
    save,
    restore,
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    texts,
    fillStyles,
    fns: {
      fill,
      stroke,
      beginPath,
      moveTo,
      arcTo,
      closePath,
      fillText,
      save,
      restore,
    },
    canvas,
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

describe('hud exports', () => {
  it('exports drawHud as a function', () => {
    expect(typeof drawHud).toBe('function');
  });
});

// ─── formatCityTime ──────────────────────────────────────────────────────────

describe('formatCityTime', () => {
  it('formats day 0 hour 0 as "Day 0, 00:00"', () => {
    expect(formatCityTime(0)).toBe('Day 0, 00:00');
  });

  it('formats hour 33 as day 1 hour 9', () => {
    expect(formatCityTime(33)).toBe('Day 1, 09:00');
  });

  it('zero-pads single-digit hours', () => {
    expect(formatCityTime(8)).toBe('Day 0, 08:00');
  });

  it('wraps back to day 0 after a full 24-hour cycle', () => {
    expect(formatCityTime(48)).toBe('Day 2, 00:00');
  });
});

// ─── drawHud ─────────────────────────────────────────────────────────────────

describe('drawHud', () => {
  it('draws a semi-transparent rounded bar (fill with alpha < 1)', () => {
    const { ctx, fillStyles, fns } = createMockCtx();
    drawHud(ctx, makeWorld(8));

    // At least one fillStyle should be a translucent rgba.
    const barFill = fillStyles.find((f) => f.startsWith('rgba('));
    expect(barFill).toBeDefined();
    const alphaMatch = /rgba\([^)]+,\s*([\d.]+)\)/.exec(barFill as string);
    expect(alphaMatch).not.toBeNull();
    expect(Number(alphaMatch![1])).toBeGreaterThan(0);
    expect(Number(alphaMatch![1])).toBeLessThan(1);

    expect(fns.fill).toHaveBeenCalled();
    expect(fns.beginPath).toHaveBeenCalled();
    expect(fns.arcTo).toHaveBeenCalled();
  });

  it('renders all four readout labels: Population, Employment Rate, City Time, City Budget', () => {
    const { ctx, texts } = createMockCtx();
    drawHud(ctx, makeWorld(8));

    const labels = ['POPULATION', 'EMPLOYMENT RATE', 'CITY TIME', 'CITY BUDGET'];
    for (const label of labels) {
      expect(texts).toContain(label);
    }
  });

  it('renders the population value from aggregateStats', () => {
    const { ctx, texts } = createMockCtx();
    drawHud(ctx, makeWorld(8, 100_000, 50, 0.6));

    expect(texts).toContain('50');
  });

  it('renders the employment-rate percentage from aggregateStats', () => {
    const { ctx, texts } = createMockCtx();
    drawHud(ctx, makeWorld(8, 100_000, 50, 0.6));

    expect(texts).toContain('60%');
  });

  it('renders the city time from world.simTime', () => {
    const { ctx, texts } = createMockCtx();
    drawHud(ctx, makeWorld(33, 100_000, 50, 0.6)); // Day 1, 09:00

    expect(texts).toContain('Day 1, 09:00');
  });

  it('renders the city budget from world.budget with currency formatting', () => {
    const { ctx, texts } = createMockCtx();
    drawHud(ctx, makeWorld(8, 99999, 50, 0.6));

    expect(texts).toContain('$99,999');
  });

  it('reflects updated values when world.budget changes between frames', () => {
    const { ctx, texts } = createMockCtx();
    const world = makeWorld(8, 100_000, 50, 0.5);

    drawHud(ctx, world);
    expect(texts).toContain('$100,000');

    world.budget = 75_000;
    const { texts: texts2 } = createMockCtx();
    drawHud(ctx, world);
    // texts2 is unused; re-check via the same ctx capture for the second draw.
    void texts2;

    // After mutating budget, the newly drawn value should reflect $75,000.
    expect(ctx.fillText).toHaveBeenCalled();
    const lastTexts = (ctx.fillText as jest.Mock).mock.calls
      .slice(-8)
      .map((c: unknown[]) => String(c[0]));
    expect(lastTexts).toContain('$75,000');
  });

  it('restores the canvas state (balanced save/restore)', () => {
    const { ctx, fns } = createMockCtx();
    drawHud(ctx, makeWorld(8));

    expect(fns.save).toHaveBeenCalled();
    expect(fns.restore).toHaveBeenCalled();
    expect(fns.save.mock.calls.length).toBe(fns.restore.mock.calls.length);
  });
});
