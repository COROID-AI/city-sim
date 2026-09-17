// @vitest-environment jsdom
/**
 * Unit tests for the top HUD overlay.
 *
 * These drive the overlay through its public surface only — `render()` with a
 * known snapshot, the injected stats provider and the tick cadence — so the
 * rendered text, the fixed-width layout classes and the throttled repaint
 * behaviour are pinned without needing the engine or the economy. The
 * integrated engine + economy + clock run lives in `hud-composition.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_HUD_THROTTLE_MS,
  DELTA_DOWN,
  DELTA_FLAT,
  DELTA_UP,
  HUD_READOUTS,
  HUD_SYSTEM_NAME,
  HudOverlay,
  REQUIRED_HUD_READOUTS,
  SECONDARY_HUD_READOUTS,
  budgetTrend,
  formatBudgetDelta,
  formatClock,
  formatInteger,
  formatMoney,
  formatPercent,
} from '../../src/ui/hud';
import type { HudReadoutKey, HudSnapshot } from '../../src/ui/hud';
import hudCss from '../../src/ui/hud.css?inline';
import { createSimFixture, createTestHudStats } from '../helpers/sim-fixtures';

/** A complete snapshot with the fixture values, overridable field by field. */
function snapshot(overrides: Partial<HudSnapshot> = {}): HudSnapshot {
  return {
    ...createTestHudStats(),
    budgetDelta: 0,
    totalRevenue: 0,
    ...overrides,
  };
}

function textOf(hud: HudOverlay, key: HudReadoutKey): string {
  const element = hud.readout(key);
  expect(element, `readout ${key} should exist`).not.toBeNull();
  return (element as HTMLElement).textContent ?? '';
}

function attrOf(hud: HudOverlay, key: HudReadoutKey, name: string): string | null {
  return hud.readout(key)?.getAttribute(name) ?? null;
}

let hud: HudOverlay | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  hud?.dispose();
  hud = null;
  document.body.innerHTML = '';
});

describe('HUD formatting', () => {
  it('formats integers, money, percentages and the clock at stable widths', () => {
    expect(formatInteger(0)).toBe('0');
    expect(formatInteger(1234)).toBe('1,234');
    expect(formatInteger(1_234_567)).toBe('1,234,567');

    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(250_000)).toBe('$250,000.00');
    expect(formatMoney(4321.5)).toBe('$4,321.50');
    expect(formatMoney(-12.5)).toBe('-$12.50');

    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.8)).toBe('80%');
    expect(formatPercent(0.123)).toBe('12%');

    expect(formatClock(7, 5)).toBe('07:05');
    expect(formatClock(0, 0)).toBe('00:00');
    expect(formatClock(23, 59)).toBe('23:59');
  });

  it('signs the hourly budget delta with an up/down marker', () => {
    expect(formatBudgetDelta(1234.56)).toBe(`${DELTA_UP} $1,234.56`);
    expect(formatBudgetDelta(-12.5)).toBe(`${DELTA_DOWN} $12.50`);
    expect(formatBudgetDelta(0)).toBe(`${DELTA_FLAT} $0.00`);
    expect(budgetTrend(10)).toBe('up');
    expect(budgetTrend(-10)).toBe('down');
    expect(budgetTrend(0)).toBe('flat');
  });
});

describe('HUD required readouts', () => {
  it('renders the four required readouts for a known snapshot', () => {
    hud = new HudOverlay({ document, container: document.body });
    hud.render(
      snapshot({
        day: 2,
        hour: 7,
        minute: 5,
        phase: 'morning',
        population: 1234,
        employedCitizens: 1000,
        employmentRate: 0.81,
        cityBudget: 250_000,
        budgetDelta: 1234.56,
      }),
    );

    expect(textOf(hud, 'time')).toBe('07:05');
    expect(textOf(hud, 'phase')).toBe('☀ Morning');
    expect(textOf(hud, 'population')).toBe('1,234');
    expect(textOf(hud, 'employment')).toBe('81%');
    expect(textOf(hud, 'budget')).toBe('$250,000.00');
    expect(textOf(hud, 'budget-delta')).toBe(`${DELTA_UP} $1,234.56`);

    expect(attrOf(hud, 'phase', 'data-phase')).toBe('morning');
    expect(attrOf(hud, 'phase', 'data-night')).toBe('false');
    expect(attrOf(hud, 'budget-delta', 'data-trend')).toBe('up');
  });

  it('drives the day/night indicator from the phase', () => {
    hud = new HudOverlay({ document, container: document.body });

    hud.render(snapshot({ hour: 2, minute: 0, phase: 'night' }));
    expect(textOf(hud, 'phase')).toBe('☾ Night');
    expect(attrOf(hud, 'phase', 'data-night')).toBe('true');

    hud.render(snapshot({ hour: 12, minute: 30, phase: 'day' }));
    expect(textOf(hud, 'phase')).toBe('☀ Day');
    expect(attrOf(hud, 'phase', 'data-night')).toBe('false');
  });

  it('refreshes every value and flips the budget delta across two settlements', () => {
    hud = new HudOverlay({ document, container: document.body });

    hud.render(
      snapshot({
        hour: 8,
        phase: 'morning',
        population: 100,
        employmentRate: 0.6,
        cityBudget: 10_000,
        budgetDelta: 250,
      }),
    );
    expect(textOf(hud, 'population')).toBe('100');
    expect(textOf(hud, 'employment')).toBe('60%');
    expect(textOf(hud, 'budget')).toBe('$10,000.00');
    expect(textOf(hud, 'budget-delta')).toBe(`${DELTA_UP} $250.00`);

    hud.render(
      snapshot({
        hour: 9,
        phase: 'morning',
        population: 110,
        employmentRate: 0.7,
        cityBudget: 9_875,
        budgetDelta: -125,
      }),
    );
    expect(textOf(hud, 'population')).toBe('110');
    expect(textOf(hud, 'employment')).toBe('70%');
    expect(textOf(hud, 'budget')).toBe('$9,875.00');
    expect(textOf(hud, 'budget-delta')).toBe(`${DELTA_DOWN} $125.00`);
    expect(attrOf(hud, 'budget-delta', 'data-trend')).toBe('down');
  });
});

describe('HUD layout and secondary fields', () => {
  it('keeps every readout on one bar row with fixed-width numeric classes', () => {
    hud = new HudOverlay({ document, container: document.body });
    hud.render(snapshot({ day: 1, totalRevenue: 4321.5, vehicleCount: 12 }));

    // Secondary economy readouts.
    expect(textOf(hud, 'day')).toBe('Day 2');
    expect(textOf(hud, 'revenue')).toBe('$4,321.50');
    expect(textOf(hud, 'vehicles')).toBe('12');

    // One bar, all readouts inside it, each inside its own item.
    expect(hud.root.classList.contains('hud')).toBe(true);
    expect(hud.bar.classList.contains('hud__bar')).toBe(true);
    expect(hud.bar.parentElement).toBe(hud.root);
    expect(hud.root.querySelectorAll('.hud__bar')).toHaveLength(1);
    for (const key of HUD_READOUTS) {
      const element = hud.readout(key) as HTMLElement;
      expect(element, `readout ${key}`).not.toBeNull();
      expect(hud.bar.contains(element)).toBe(true);
      expect(element.closest('.hud__item')).not.toBeNull();
    }

    // The required four each have their own item; the secondary three are tagged.
    for (const modifier of ['time', 'population', 'employment', 'budget']) {
      expect(hud.bar.querySelector(`.hud__item--${modifier}`)).not.toBeNull();
    }
    expect(hud.bar.querySelectorAll('.hud__item--secondary')).toHaveLength(
      SECONDARY_HUD_READOUTS.length,
    );

    // Fixed-width numeric readouts carry the tabular class.
    for (const key of ['population', 'employment', 'budget'] as const) {
      expect(hud.readout(key)?.classList.contains('hud__num')).toBe(true);
    }
    expect(REQUIRED_HUD_READOUTS).toHaveLength(6);
  });

  it('ships one-row, tabular-figure styling so updates cannot shift layout', () => {
    expect(hudCss).toMatch(/flex-wrap:\s*nowrap/);
    expect(hudCss).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(hudCss).toMatch(/min-width/);
  });
});

describe('HUD cadence and lifecycle', () => {
  it('repaints on a throttled tick cadence and forces a repaint when asked', () => {
    const fixture = createSimFixture({ startHour: 0 });
    let nowMs = 0;
    let population = 10;

    hud = new HudOverlay({
      document,
      container: document.body,
      throttleMs: DEFAULT_HUD_THROTTLE_MS,
      now: () => nowMs,
      stats: () =>
        snapshot({
          population,
          day: fixture.clock.day,
          hour: fixture.clock.hourOfDay,
          minute: fixture.clock.minuteOfHour,
          phase: fixture.clock.phase,
        }),
    });
    // The constructor paints the initial row before anything else happens.
    expect(hud.renderCount).toBe(1);
    fixture.engine.attach(hud);
    expect(hud.renderCount).toBe(2);
    expect(textOf(hud, 'population')).toBe('10');

    // Inside the throttle window the tick must not repaint.
    population = 42;
    fixture.engine.step(5);
    expect(hud.renderCount).toBe(2);
    expect(textOf(hud, 'population')).toBe('10');

    // Once the window elapses, the next tick repaints with the new value.
    nowMs = DEFAULT_HUD_THROTTLE_MS;
    fixture.engine.step(1);
    expect(hud.renderCount).toBe(3);
    expect(textOf(hud, 'population')).toBe('42');

    // A forced refresh (what a settlement does) bypasses the window.
    population = 99;
    hud.refresh(true);
    expect(hud.renderCount).toBe(4);
    expect(textOf(hud, 'population')).toBe('99');

    fixture.dispose();
  });

  it('attaches to an engine and detaches through the returned handle', () => {
    const fixture = createSimFixture();
    hud = new HudOverlay({ document, container: document.body });

    const detach = hud.attach(fixture.engine);
    expect(hud.attached).toBe(true);
    expect(fixture.engine.getSystem(HUD_SYSTEM_NAME)).toBe(hud);

    detach();
    expect(hud.attached).toBe(false);
    expect(fixture.engine.getSystem(HUD_SYSTEM_NAME)).toBeUndefined();

    fixture.dispose();
  });

  it('disposes cleanly: removes the bar and refuses further rendering', () => {
    hud = new HudOverlay({ document, container: document.body });
    const root = hud.root;
    expect(document.body.contains(root)).toBe(true);
    expect(hud.attached).toBe(false);

    hud.render(snapshot({ population: 5 }));
    hud.dispose();

    expect(document.body.contains(root)).toBe(false);
    expect(hud.readout('population')).toBeNull();
    expect(hud.snapshot).toBeNull();
    expect(() => hud?.render(snapshot())).toThrow(/dispose/);
    // Disposal is idempotent.
    hud.dispose();
  });
});
