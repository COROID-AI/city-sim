import { tickEconomy, aggregateStats } from './economy';
import { createWorld } from './world';
import { generateCity, DEFAULT_CITY_SEED } from './worldGen';
import { spawnCitizens } from './citizens';
import { createCompanies, assignEmployees, tickCompanies } from './companies';
import {
  BUILDING_MAINTENANCE,
  INCOME_TAX_RATE,
  MIN_CITIZENS,
  REVENUE_PER_EMPLOYEE,
  WELFARE_PER_CITIZEN,
  HOURS_PER_DAY,
} from './constants';
import type { World } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Build a fully-generated city ready for the economy system. */
function makeCity(seed: number = DEFAULT_CITY_SEED): World {
  const world = createWorld();
  generateCity(world, seed);
  return world;
}

/**
 * Build a fully-populated city: city grid + citizens + companies + employee
 * assignments.  This mirrors the real-world bootstrap order.
 */
function makePopulatedCity(
  seed: number = DEFAULT_CITY_SEED,
  citizenCount: number = MIN_CITIZENS,
): World {
  const world = makeCity(seed);
  spawnCitizens(world, citizenCount);
  createCompanies(world);
  assignEmployees(world);
  return world;
}

/** Count civic buildings in a world. */
function countCivicBuildings(world: World): number {
  let count = 0;
  for (const b of world.buildings.values()) {
    if (b.kind === 'CIVIC') count++;
  }
  return count;
}

/** Count unemployed citizens in a world. */
function countUnemployed(world: World): number {
  let count = 0;
  for (const c of world.citizens.values()) {
    if (c.work === null) count++;
  }
  return count;
}

/** Total cumulative company revenue in a world. */
function totalCompanyRevenue(world: World): number {
  let total = 0;
  for (const company of world.companies.values()) {
    total += company.revenue;
  }
  return total;
}

/** Sum of all employees across all companies. */
function totalEmployees(world: World): number {
  let total = 0;
  for (const company of world.companies.values()) {
    total += company.employees.length;
  }
  return total;
}

// ─── tickEconomy: per-sim-hour gating ────────────────────────────────────────

describe('tickEconomy — per-sim-hour gating', () => {
  it('runs once when the sim-hour advances', () => {
    const world = makePopulatedCity();
    const budgetBefore = world.budget;

    world.simTime.elapsedHours = 1;
    tickEconomy(world);

    // Budget should have changed.
    expect(world.budget).not.toBe(budgetBefore);
    expect(world.lastEconomyHour).toBe(1);
  });

  it('is a no-op when called multiple times within the same hour', () => {
    const world = makePopulatedCity();
    world.simTime.elapsedHours = 1;
    tickEconomy(world);
    const budgetAfterFirst = world.budget;

    // Call again without advancing time.
    tickEconomy(world);
    tickEconomy(world);

    expect(world.budget).toBe(budgetAfterFirst);
    expect(world.lastEconomyHour).toBe(1);
  });

  it('does not run before simTime advances past hour 0', () => {
    const world = makePopulatedCity();
    // lastEconomyHour starts at -1, so hour 0 is a new hour.
    world.simTime.elapsedHours = 0;
    tickEconomy(world);
    expect(world.lastEconomyHour).toBe(0);
  });

  it('only processes when the integer hour increases', () => {
    const world = makePopulatedCity();
    world.simTime.elapsedHours = 5.9;
    tickEconomy(world);
    expect(world.lastEconomyHour).toBe(5);

    // Fractional progress within hour 5 — no change.
    const budgetAtHour5 = world.budget;
    world.simTime.elapsedHours = 5.99;
    tickEconomy(world);
    expect(world.lastEconomyHour).toBe(5);
    expect(world.budget).toBe(budgetAtHour5);

    // Cross into hour 6.
    world.simTime.elapsedHours = 6.0;
    tickEconomy(world);
    expect(world.lastEconomyHour).toBe(6);
  });
});

// ─── tickEconomy: budget / tax / expenses ───────────────────────────────────

describe('tickEconomy — budget, taxes, and expenses', () => {
  it('applies tax income from company revenue', () => {
    const world = makePopulatedCity();

    // Advance companies by one hour so they earn revenue.
    tickCompanies(world, { elapsedHours: 9 });
    world.simTime.elapsedHours = 10;
    tickEconomy(world);

    const expectedTax = totalCompanyRevenue(world) * INCOME_TAX_RATE;
    expect(world.derivedStats.lastHourTaxIncome).toBeCloseTo(expectedTax, 5);
  });

  it('taxes only the hourly revenue delta, not the cumulative total', () => {
    const world = makePopulatedCity();

    // Hour 0: companies earn their first hour of revenue.
    tickCompanies(world, { elapsedHours: 0 });
    world.simTime.elapsedHours = 1;
    tickEconomy(world);
    const taxAfterHour1 = world.derivedStats.lastHourTaxIncome;

    // Hour 1: companies earn another hour.
    tickCompanies(world, { elapsedHours: 1 });
    world.simTime.elapsedHours = 2;
    tickEconomy(world);
    const taxAfterHour2 = world.derivedStats.lastHourTaxIncome;

    // The second hour's tax should be based on the incremental revenue,
    // not the full cumulative total.  Both hours have similar revenue
    // (same companies, same employees), so taxes should be close.
    expect(taxAfterHour2).toBeGreaterThan(0);
    expect(taxAfterHour2).toBeCloseTo(taxAfterHour1, 1);
  });

  it('charges civic building upkeep as an expense', () => {
    const world = makePopulatedCity();
    const civicCount = countCivicBuildings(world);
    expect(civicCount).toBeGreaterThan(0);

    world.simTime.elapsedHours = 1;
    tickEconomy(world);

    const expectedCivicUpkeep = civicCount * BUILDING_MAINTENANCE;
    expect(world.derivedStats.lastHourExpenses).toBeGreaterThanOrEqual(
      expectedCivicUpkeep,
    );
  });

  it('charges welfare for unemployed citizens', () => {
    const world = makePopulatedCity();
    const unemployed = countUnemployed(world);
    const civicCount = countCivicBuildings(world);

    world.simTime.elapsedHours = 1;
    tickEconomy(world);

    const expectedWelfare = unemployed * WELFARE_PER_CITIZEN;
    const expectedTotal = civicCount * BUILDING_MAINTENANCE + expectedWelfare;
    expect(world.derivedStats.lastHourExpenses).toBeCloseTo(expectedTotal, 5);
  });

  it('updates world.budget = previous + taxIncome − expenses', () => {
    const world = makePopulatedCity();
    const budgetBefore = world.budget;

    tickCompanies(world, { elapsedHours: 9 });
    world.simTime.elapsedHours = 10;
    tickEconomy(world);

    const tax = world.derivedStats.lastHourTaxIncome;
    const expenses = world.derivedStats.lastHourExpenses;
    expect(world.budget).toBeCloseTo(budgetBefore + tax - expenses, 5);
  });

  it('handles an empty world (no citizens, no companies)', () => {
    const world = createWorld();
    const budgetBefore = world.budget;

    world.simTime.elapsedHours = 1;
    tickEconomy(world);

    expect(world.budget).toBe(budgetBefore); // no tax, no expenses on empty grid
    expect(world.derivedStats.lastHourTaxIncome).toBe(0);
    expect(world.derivedStats.lastHourExpenses).toBe(0);
    expect(world.derivedStats.population).toBe(0);
    expect(world.derivedStats.employmentRate).toBe(0);
  });

  it('accumulates budget changes across multiple hours', () => {
    const world = makePopulatedCity();
    const budgetStart = world.budget;

    tickCompanies(world, { elapsedHours: 9 });
    world.simTime.elapsedHours = 10;
    tickEconomy(world);

    tickCompanies(world, { elapsedHours: 10 });
    world.simTime.elapsedHours = 11;
    tickEconomy(world);

    // Budget should differ from the starting value after two ticks.
    expect(world.budget).not.toBe(budgetStart);
  });
});

// ─── tickEconomy: derivedStats ───────────────────────────────────────────────

describe('tickEconomy — derivedStats', () => {
  it('sets population to the number of citizens', () => {
    const world = makePopulatedCity();
    const expectedPop = world.citizens.size;

    world.simTime.elapsedHours = 1;
    tickEconomy(world);

    expect(world.derivedStats.population).toBe(expectedPop);
  });

  it('sets employmentRate to employed / population', () => {
    const world = makePopulatedCity();
    const employed = totalEmployees(world);
    const population = world.citizens.size;

    world.simTime.elapsedHours = 1;
    tickEconomy(world);

    const expectedRate = population > 0 ? employed / population : 0;
    expect(world.derivedStats.employmentRate).toBeCloseTo(expectedRate, 5);
    expect(world.derivedStats.employmentRate).toBeGreaterThan(0);
    expect(world.derivedStats.employmentRate).toBeLessThanOrEqual(1);
  });

  it('derivedStats are always present on a fresh world', () => {
    const world = createWorld();
    expect(world.derivedStats.population).toBe(0);
    expect(world.derivedStats.employmentRate).toBe(0);
    expect(world.derivedStats.lastHourTaxIncome).toBe(0);
    expect(world.derivedStats.lastHourExpenses).toBe(0);
  });
});

// ─── aggregateStats ──────────────────────────────────────────────────────────

describe('aggregateStats', () => {
  it('returns population, employmentRate, lastHourTaxIncome, lastHourExpenses', () => {
    const world = makePopulatedCity();

    tickCompanies(world, { elapsedHours: 9 });
    world.simTime.elapsedHours = 10;
    tickEconomy(world);

    const stats = aggregateStats(world);
    expect(stats).toHaveProperty('population');
    expect(stats).toHaveProperty('employmentRate');
    expect(stats).toHaveProperty('lastHourTaxIncome');
    expect(stats).toHaveProperty('lastHourExpenses');
    expect(typeof stats.population).toBe('number');
    expect(typeof stats.employmentRate).toBe('number');
    expect(typeof stats.lastHourTaxIncome).toBe('number');
    expect(typeof stats.lastHourExpenses).toBe('number');
  });

  it('reflects the same values as world.derivedStats after a tick', () => {
    const world = makePopulatedCity();

    tickCompanies(world, { elapsedHours: 9 });
    world.simTime.elapsedHours = 10;
    tickEconomy(world);

    const stats = aggregateStats(world);
    expect(stats.population).toBe(world.derivedStats.population);
    expect(stats.employmentRate).toBeCloseTo(
      world.derivedStats.employmentRate,
      10,
    );
    expect(stats.lastHourTaxIncome).toBeCloseTo(
      world.derivedStats.lastHourTaxIncome,
      10,
    );
    expect(stats.lastHourExpenses).toBeCloseTo(
      world.derivedStats.lastHourExpenses,
      10,
    );
  });

  it('does not mutate the world', () => {
    const world = makePopulatedCity();
    world.simTime.elapsedHours = 1;
    tickEconomy(world);

    const budgetBefore = world.budget;
    const hourBefore = world.lastEconomyHour;
    aggregateStats(world);

    expect(world.budget).toBe(budgetBefore);
    expect(world.lastEconomyHour).toBe(hourBefore);
  });

  it('computes employmentRate as 0 for an empty world', () => {
    const world = createWorld();
    const stats = aggregateStats(world);
    expect(stats.population).toBe(0);
    expect(stats.employmentRate).toBe(0);
  });
});
