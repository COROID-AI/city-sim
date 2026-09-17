// @vitest-environment jsdom
/**
 * Composition test: the top HUD overlay attached to the real engine, over the
 * seeded city, the citizen roster, the company ledger and the hourly economy,
 * all under jsdom.
 *
 * Where `hud.test.ts` pins the rendered text for known snapshots, this suite
 * proves the integrated behaviour: over a simulated day the overlay's city-time
 * text crosses hour boundaries and the day/night indicator follows the clock,
 * every settlement repaints population, employment rate and the city budget,
 * the budget delta always agrees with the settlement that just landed, and the
 * secondary economy figures track the published aggregates.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MINUTES_PER_HOUR } from '../../src/sim/clock';
import { CitizensSystem } from '../../src/sim/citizens';
import { CompaniesSystem } from '../../src/sim/companies';
import { EconomySystem } from '../../src/sim/economy';
import { VehiclesSystem } from '../../src/sim/vehicles';
import { createCityWorld } from '../../src/sim/world';
import {
  HudOverlay,
  budgetTrend,
  formatBudgetDelta,
  formatInteger,
  formatMoney,
  formatPercent,
} from '../../src/ui/hud';
import { SIM_DAY_MINUTES, createSimFixture } from '../helpers/sim-fixtures';

const INITIAL_BUDGET = 250_000;
/** One full day plus ten hours: deep into day two's morning shift. */
const RUN_MINUTES = SIM_DAY_MINUTES + 10 * MINUTES_PER_HOUR;
/** One settlement per sim-hour boundary, including midnight. */
const EXPECTED_SETTLEMENTS = RUN_MINUTES / MINUTES_PER_HOUR;

interface Composition {
  readonly fixture: ReturnType<typeof createSimFixture>;
  readonly citizens: CitizensSystem;
  readonly companies: CompaniesSystem;
  readonly economy: EconomySystem;
  readonly hud: HudOverlay;
}

/**
 * Wires the same graph the app composition owner will: the seeded city, the
 * citizen roster, the companies (staffed through the economy's labour market),
 * the hourly economy and the vehicle fleet, then the HUD on top of them.
 */
function buildComposition(seed: string): Composition {
  const fixture = createSimFixture({ seed, startHour: 0 });
  const world = createCityWorld({ seed: fixture.rng.seed });
  const citizens = new CitizensSystem({ world });
  const economy = new EconomySystem(world, { citizens, initialBudget: INITIAL_BUDGET });
  const companies = new CompaniesSystem(world, {
    labourMarket: economy.createLabourMarket(),
    demandModel: economy.createDemandModel(),
    startHour: 0,
  });
  economy.bindCompanies(companies);
  const vehicles = new VehiclesSystem({ world, citizens });

  fixture.engine.attach(citizens);
  fixture.engine.attach(companies);
  fixture.engine.attach(economy);
  fixture.engine.attach(vehicles);

  const hud = new HudOverlay({ document, container: document.body, economy, companies });
  fixture.engine.attach(hud);

  return { fixture, citizens, companies, economy, hud };
}

let composition: Composition | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  composition?.hud.dispose();
  composition?.fixture.dispose();
  composition = null;
  document.body.innerHTML = '';
});

describe('HUD / engine + economy + clock composition', () => {
  it('reflects the clock and the settlements across a simulated day under jsdom', () => {
    composition = buildComposition('hud-composition');
    const { fixture, citizens, companies, economy, hud } = composition;

    // The overlay paints as soon as it attaches: midnight, night, day one.
    expect(hud.attached).toBe(true);
    expect(hud.readout('time')?.textContent).toBe('00:00');
    expect(hud.readout('phase')?.getAttribute('data-phase')).toBe('night');
    expect(hud.readout('day')?.textContent).toBe('Day 1');

    // Observe the overlay at every settlement. The listener is registered after
    // the HUD's own, so the bar has already been repainted for the hour.
    const timeTexts = new Set<string>();
    const phases = new Set<string>();
    const trends = new Set<string>();
    const budgetTexts = new Set<string>();
    const deltaProblems: string[] = [];

    economy.onSettlement((record) => {
      const time = hud.readout('time')?.textContent ?? '';
      const phase = hud.readout('phase')?.getAttribute('data-phase') ?? '';
      const trend = hud.readout('budget-delta')?.getAttribute('data-trend') ?? '';
      const deltaText = hud.readout('budget-delta')?.textContent ?? '';
      timeTexts.add(time);
      phases.add(phase);
      trends.add(trend);
      budgetTexts.add(hud.readout('budget')?.textContent ?? '');

      const expectedDelta = formatBudgetDelta(record.budgetDelta);
      if (deltaText !== expectedDelta) {
        deltaProblems.push(`delta ${time} "${deltaText}" != "${expectedDelta}"`);
      }
      if (trend !== budgetTrend(record.budgetDelta)) {
        deltaProblems.push(`trend ${time} "${trend}" != "${budgetTrend(record.budgetDelta)}"`);
      }
    });

    fixture.advanceMinutes(RUN_MINUTES);

    const stats = economy.hudStats();

    // Clock: a day of hour boundaries crossed, day advanced, indicator live.
    expect(economy.settlementCount).toBe(EXPECTED_SETTLEMENTS);
    expect(hud.readout('time')?.textContent).toBe('10:00');
    expect(hud.readout('day')?.textContent).toBe('Day 2');
    expect(hud.readout('phase')?.getAttribute('data-phase')).toBe('morning');
    expect(timeTexts.size).toBeGreaterThanOrEqual(24);
    expect(phases.has('night')).toBe(true);
    expect(phases.has('morning')).toBe(true);

    // Required readouts match the live snapshot.
    expect(stats.population).toBe(citizens.citizens.length);
    expect(hud.readout('population')?.textContent).toBe(formatInteger(stats.population));
    expect(stats.employmentRate).toBeGreaterThan(0);
    expect(hud.readout('employment')?.textContent).toBe(formatPercent(stats.employmentRate));
    expect(hud.readout('budget')?.textContent).toBe(formatMoney(economy.cityBudget));

    // The hourly delta is always the one the last settlement published.
    expect(deltaProblems).toEqual([]);
    expect(trends.size).toBeGreaterThanOrEqual(2);
    expect(trends.has('up')).toBe(true);
    expect(trends.has('down')).toBe(true);
    // The budget itself moves on every settled hour.
    expect(budgetTexts.size).toBe(EXPECTED_SETTLEMENTS);

    // Secondary economy readouts track the aggregates.
    expect(companies.totals().revenue).toBeGreaterThan(0);
    expect(hud.readout('revenue')?.textContent).toBe(formatMoney(companies.totals().revenue));
    expect(stats.vehicleCount).toBeGreaterThan(0);
    expect(hud.readout('vehicles')?.textContent).toBe(formatInteger(stats.vehicleCount));
  });
});
