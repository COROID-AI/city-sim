// @vitest-environment jsdom
/**
 * Acceptance cadence: the hourly economy of the composed live app.
 *
 * The sibling `scale-soak.test.ts` drives two full simulated days once and
 * asserts every acceptance bar; this suite zooms into the economy cadence the
 * README states ("economy updates every sim-hour") and proves it on the
 * assembled application:
 *
 * 1. **Exactly one settlement per sim-hour** — nothing is settled between
 *    boundaries and every boundary settles once, 48 times over two days.
 * 2. **The city budget updates hourly** — it is frozen between boundaries, each
 *    settlement applies its own delta exactly once, and the HUD budget readout
 *    is repainted from that value.
 * 3. **The employment rate matches the company workforces** — the economy's
 *    employment join and the companies' own headcounts agree at every
 *    settlement, with each employed citizen holding a real job at a real site.
 *
 * Everything runs through the composition root (`src/main`), consuming the same
 * assembled runtime the browser gets; jsdom's missing canvas backend is served
 * by the shared recording double and never affects the simulation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CityAppOptions, LiveCityApp } from '../../src/main';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from '../../src/sim/clock';
import type { EconomyRecord } from '../../src/sim/economy';
import { formatMoney } from '../../src/ui/hud';
import { createRecordingContext } from '../helpers/fake-canvas';
import type { RecordingContext2D } from '../helpers/fake-canvas';

/* ------------------------------------------------------------- expectation -- */

/** Sim-minutes of the two-day cadence run. */
const SOAK_MINUTES = 2 * MINUTES_PER_DAY;
/** Settlements two full days must produce: one per sim-hour. */
const REQUIRED_SETTLEMENTS = SOAK_MINUTES / MINUTES_PER_HOUR;
/** Day 2, 12:00: the city is staffed, the sun is up and the join is live. */
const MIDDAY_MINUTES = MINUTES_PER_DAY + 12 * MINUTES_PER_HOUR;
/** Host viewport the shell reports. */
const VIEWPORT = { width: 1280, height: 800 };

/* ---------------------------------------------------------------- harness -- */

const contexts = new Map<HTMLCanvasElement, RecordingContext2D>();
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext =
  HTMLCanvasElement.prototype.getContext;

function installRecordingContexts(): void {
  contexts.clear();
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
  ): CanvasRenderingContext2D | null {
    if (type !== '2d') {
      return null;
    }
    let context = contexts.get(this);
    if (!context) {
      context = createRecordingContext(this);
      contexts.set(this, context);
    }
    return context.toContext2D();
  } as unknown as HTMLCanvasElement['getContext'];
}

function restoreRecordingContexts(): void {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  contexts.clear();
  document.body.innerHTML = '';
  delete window.__citySim;
}

/** Builds the page shell the composition root mounts into. */
function buildShell(): void {
  document.body.innerHTML = `
    <div id="app">
      <canvas id="city-canvas" aria-label="Live city simulation"></canvas>
      <div id="minimap" class="minimap"></div>
    </div>`;
  const canvas = document.getElementById('city-canvas') as HTMLCanvasElement;
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: VIEWPORT.width,
      bottom: VIEWPORT.height,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      toJSON: () => ({}),
    }),
  });
}

function uiClock(stepMs = 16): () => number {
  let cursor = 0;
  return () => {
    cursor += stepMs;
    return cursor;
  };
}

/** Boots the composed app from midnight, with the frame loop held for the test. */
async function bootEconomyApp(options: Partial<CityAppOptions> = {}): Promise<LiveCityApp> {
  const module = await import('../../src/main');
  module.stopCitySimulation();
  return module.bootCityApp({
    document,
    autoStart: false,
    startDay: 0,
    startHour: 0,
    startMinute: 0,
    speed: 60,
    now: uiClock(),
    ...options,
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ------------------------------------------------------------------ setup -- */

let app: LiveCityApp;

beforeEach(async () => {
  vi.resetModules();
  installRecordingContexts();
  buildShell();
  app = await bootEconomyApp();
});

afterEach(() => {
  app.dispose();
  restoreRecordingContexts();
});

/* ------------------------------------------------------------- cadence -- */

describe('live acceptance: exactly one economy settlement per sim-hour', () => {
  it('settles once at every hour boundary and never between them', () => {
    const observed: EconomyRecord[] = [];
    app.economy.onSettlement((record) => {
      observed.push(record);
    });

    // Fifty-nine minutes: no boundary has been crossed, so nothing settles.
    app.engine.step(59);
    expect(app.economy.settlementCount).toBe(0);
    expect(observed).toHaveLength(0);

    // The sixtieth minute completes the first hour: one settlement, aligned.
    app.engine.step(1);
    expect(app.economy.settlementCount).toBe(1);
    expect(observed).toHaveLength(1);
    expect(observed[0].totalMinutes).toBe(MINUTES_PER_HOUR);
    expect(observed[0].minute).toBe(0);
    expect(observed[0].hour).toBe(0);

    // Still mid-hour after another 59 minutes: no second settlement.
    app.engine.step(59);
    expect(app.economy.settlementCount).toBe(1);
    app.engine.step(1);
    expect(app.economy.settlementCount).toBe(2);
    expect(observed[1].totalMinutes).toBe(2 * MINUTES_PER_HOUR);
  });

  it('runs exactly 48 settlements over two simulated days', () => {
    const observed: EconomyRecord[] = [];
    app.economy.onSettlement((record) => {
      observed.push(record);
    });

    const advanced = app.engine.step(SOAK_MINUTES);
    expect(advanced).toBe(SOAK_MINUTES);
    expect(app.clock.totalMinutes).toBe(SOAK_MINUTES);

    // One settlement per hour, in order, aligned to the hour boundary.
    expect(observed).toHaveLength(REQUIRED_SETTLEMENTS);
    expect(app.economy.settlementCount).toBe(REQUIRED_SETTLEMENTS);
    expect(app.economy.settlements).toHaveLength(REQUIRED_SETTLEMENTS);
    expect(app.companies.hoursSettledCount).toBe(REQUIRED_SETTLEMENTS);

    const minutes = observed.map((record) => record.totalMinutes);
    expect(new Set(minutes).size).toBe(REQUIRED_SETTLEMENTS);
    for (let index = 0; index < observed.length; index += 1) {
      const record = observed[index];
      expect(record.totalMinutes).toBe((index + 1) * MINUTES_PER_HOUR);
      expect(record.minute).toBe(0);
      expect(record.settlementCount).toBe(index + 1);
      expect(app.economy.settlements[index]).toBe(record);
    }
    // The last settlement is the one the HUD is currently showing.
    expect(app.economy.lastSettlement).toBe(observed[observed.length - 1]);
  });
});

/* ---------------------------------------------------------------- budget -- */

describe('live acceptance: the city budget updates hourly', () => {
  it('freezes the budget between boundaries and applies each delta once', () => {
    const initialBudget = app.economy.cityBudget;
    let expected = initialBudget;
    let changedHours = 0;
    const paintedBudgets = new Set<string>();

    for (let hour = 0; hour < REQUIRED_SETTLEMENTS; hour += 1) {
      const before = app.economy.cityBudget;
      app.engine.step(MINUTES_PER_HOUR / 2);
      // Half an hour in, the budget has not moved.
      expect(app.economy.cityBudget).toBe(before);

      app.engine.step(MINUTES_PER_HOUR / 2);
      const record = app.economy.lastSettlement;
      expect(record).not.toBeNull();
      if (!record) {
        return;
      }
      // The settlement is exactly one hour's worth of income and services.
      expect(record.totalMinutes).toBe((hour + 1) * MINUTES_PER_HOUR);
      expect(record.budgetDelta).toBe(round2(record.taxIncome - record.serviceCosts));
      expected = round2(expected + record.budgetDelta);
      expect(app.economy.cityBudget).toBe(expected);
      if (record.budgetDelta !== 0) {
        changedHours += 1;
      }

      // The HUD readout is the settled budget, repainted from the same value.
      app.hud.refresh(true);
      const painted = app.hud.readout('budget')?.textContent ?? '';
      expect(painted).toBe(formatMoney(app.economy.cityBudget));
      paintedBudgets.add(painted);
    }

    // Two days of income and services really moved the budget, hour by hour.
    expect(changedHours).toBeGreaterThan(REQUIRED_SETTLEMENTS / 2);
    expect(paintedBudgets.size).toBeGreaterThan(REQUIRED_SETTLEMENTS / 2);
    expect(app.economy.cityBudget).not.toBe(initialBudget);
    expect(app.hud.snapshot?.cityBudget).toBe(app.economy.cityBudget);
    expect(app.hud.snapshot?.budgetDelta).toBe(app.economy.lastSettlement?.budgetDelta);
  });
});

/* ------------------------------------------------------------ employment -- */

describe('live acceptance: employment matches the company workforces', () => {
  it('joins employed citizens to real companies at every settlement', () => {
    const observed: EconomyRecord[] = [];
    app.economy.onSettlement((record) => {
      observed.push(record);
    });

    app.engine.step(MIDDAY_MINUTES);
    expect(app.clock.day).toBe(1);
    expect(app.clock.hourOfDay).toBe(12);

    const employed = app.economy.employedCitizenIds();
    expect(employed.length).toBeGreaterThan(0);
    expect(new Set(employed).size).toBe(employed.length);

    // The economy's employment join is the companies' own headcount.
    const companies = app.companies.companies;
    expect(companies.length).toBeGreaterThan(0);
    let workforceTotal = 0;
    for (const company of companies) {
      const workforce = app.economy.workforceFor(company.id);
      workforceTotal += workforce.length;
      expect(workforce.length, `workforce of ${company.id}`).toBe(company.employeeCount);
    }
    expect(workforceTotal).toBe(employed.length);
    expect(app.companies.totals().employeeCount).toBe(employed.length);

    // Every employed citizen really holds the job their company reports.
    for (const citizenId of employed) {
      const citizen = app.citizens.citizenById(citizenId);
      expect(citizen, `citizen ${citizenId}`).not.toBeNull();
      const companyId = citizen?.occupation.companyId ?? null;
      expect(companyId, `employer of ${citizenId}`).not.toBeNull();
      const company = companyId ? app.companies.companyById(companyId) : null;
      expect(company, `company ${companyId}`).not.toBeNull();
      expect(citizen?.occupation.workplaceBuildingId).toBe(company?.buildingId);
      expect(
        app.world.buildings.some((building) => building.id === company?.buildingId),
        `site of ${companyId}`,
      ).toBe(true);
    }
    // ...and nobody outside that join is employed.
    expect(
      app.citizens.citizens.filter((citizen) => citizen.occupation.companyId !== null),
    ).toHaveLength(employed.length);

    // The live HUD rate is that join over the population.
    const stats = app.economy.hudStats();
    expect(stats.population).toBe(app.citizens.citizens.length);
    expect(stats.employedCitizens).toBe(employed.length);
    expect(stats.employmentRate).toBe(employed.length / stats.population);
    expect(stats.employmentRate).toBeGreaterThan(0);
    expect(stats.employmentRate).toBeLessThanOrEqual(1);
  });

  it('reports the same employment figures in every settlement record', () => {
    const observed: EconomyRecord[] = [];
    app.economy.onSettlement((record) => {
      observed.push(record);
    });

    app.engine.step(MIDDAY_MINUTES);
    expect(observed).toHaveLength(MIDDAY_MINUTES / MINUTES_PER_HOUR);

    for (const record of observed) {
      expect(record.population).toBe(app.citizens.citizens.length);
      expect(record.employedCitizenIds).toHaveLength(record.employedCitizens);
      expect(new Set(record.employedCitizenIds).size).toBe(record.employedCitizens);
      const rostered = Object.values(record.companyRosters).reduce(
        (total, roster) => total + roster.length,
        0,
      );
      expect(rostered).toBe(record.employedCitizens);
      for (const [companyId, roster] of Object.entries(record.companyRosters)) {
        expect(app.companies.companyById(companyId), `company ${companyId}`).not.toBeNull();
        expect(new Set(roster).size).toBe(roster.length);
      }
      expect(record.unemploymentRate).toBeCloseTo(1 - record.employmentRate, 12);
      expect(record.employmentRate).toBe(
        record.population === 0 ? 0 : record.employedCitizens / record.population,
      );
    }

    // The final record and the live join describe the same hour.
    const last = observed[observed.length - 1];
    const employed = app.economy.employedCitizenIds();
    expect(last.employedCitizenIds).toEqual(employed);
    expect(app.companies.totals().employeeCount).toBe(employed.length);
    expect(app.economy.lastSettlement).toBe(last);
  });
});
