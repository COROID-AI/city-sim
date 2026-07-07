import { createCompanies, assignEmployees, tickCompanies } from './companies';
import { createWorld } from './world';
import { generateCity, DEFAULT_CITY_SEED } from './worldGen';
import { spawnCitizens } from './citizens';
import {
  BUILDING_MAINTENANCE,
  HOURLY_WAGE,
  MIN_CITIZENS,
  REVENUE_PER_EMPLOYEE,
  HOURS_PER_DAY,
} from './constants';
import type { Building, Company, World } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Build a fully-generated city ready for company systems. */
function makeCity(seed: number = DEFAULT_CITY_SEED): World {
  const world = createWorld();
  generateCity(world, seed);
  return world;
}

/** Build a city, spawn citizens, create companies, and assign employees. */
function makeCityWithCompanies(
  seed: number = DEFAULT_CITY_SEED,
  count: number = MIN_CITIZENS,
): World {
  const world = makeCity(seed);
  spawnCitizens(world, count);
  createCompanies(world);
  assignEmployees(world);
  return world;
}

/** Create a SimTime object at a given hour-of-day on day 0. */
function timeAt(hour: number): { elapsedHours: number } {
  return { elapsedHours: hour };
}

/** Count workplace buildings in a world. */
function countWorkBuildings(world: World): number {
  let count = 0;
  for (const b of world.buildings.values()) {
    if (b.kind === 'WORK') count++;
  }
  return count;
}

// ─── createCompanies ─────────────────────────────────────────────────────────

describe('createCompanies', () => {
  it('creates one Company per workplace building', () => {
    const world = makeCity();
    const workCount = countWorkBuildings(world);
    createCompanies(world);
    expect(world.companies.size).toBe(workCount);
    expect(workCount).toBeGreaterThanOrEqual(8);
  });

  it('sets id, name, buildingId, productKind, and productivity', () => {
    const world = makeCity();
    createCompanies(world);
    for (const company of world.companies.values()) {
      expect(company.id).toMatch(/^co\d+$/);
      expect(company.name).toBeTruthy();
      expect(company.buildingId).toBeTruthy();
      expect(world.buildings.has(company.buildingId)).toBe(true);
      expect(company.productKind).toBeDefined();
      expect(company.productivity).toBeGreaterThanOrEqual(0.7);
      expect(company.productivity).toBeLessThanOrEqual(1.3);
    }
  });

  it('initialises financial fields to zero', () => {
    const world = makeCity();
    createCompanies(world);
    for (const company of world.companies.values()) {
      expect(company.revenue).toBe(0);
      expect(company.expenses).toBe(0);
      expect(company.profit).toBe(0);
      expect(company.dailyRevenue).toBe(0);
      expect(company.dailyExpenses).toBe(0);
      expect(company.employees).toEqual([]);
      expect(company.employeeIds).toEqual([]);
    }
  });

  it('links the building owner back to the company', () => {
    const world = makeCity();
    createCompanies(world);
    for (const company of world.companies.values()) {
      const building = world.buildings.get(company.buildingId)!;
      expect(building.owner).toBe(company.id);
    }
  });

  it('is idempotent (does not duplicate companies on re-run)', () => {
    const world = makeCity();
    const workCount = countWorkBuildings(world);
    createCompanies(world);
    createCompanies(world);
    expect(world.companies.size).toBe(workCount);
  });
});

// ─── assignEmployees ─────────────────────────────────────────────────────────

describe('assignEmployees', () => {
  it('assigns employed citizens to their workplace company', () => {
    const world = makeCityWithCompanies();
    let totalAssigned = 0;
    for (const company of world.companies.values()) {
      totalAssigned += company.employees.length;
    }
    // At least some citizens should be employed and assigned.
    expect(totalAssigned).toBeGreaterThan(0);
  });

  it('adds each employed citizen to the company at their workplace', () => {
    const world = makeCityWithCompanies();
    // Build citizen → company lookup.
    const citizenCompany = new Map<string, Company>();
    for (const company of world.companies.values()) {
      for (const emp of company.employees) {
        citizenCompany.set(emp.citizenId, company);
      }
    }
    // Every assigned citizen must work at that company's building.
    for (const [citizenId, company] of citizenCompany) {
      const citizen = world.citizens.get(citizenId)!;
      expect(citizen.work).toBe(company.buildingId);
    }
  });

  it('respects building capacity', () => {
    const world = makeCityWithCompanies();
    for (const company of world.companies.values()) {
      const building = world.buildings.get(company.buildingId)!;
      expect(company.employees.length).toBeLessThanOrEqual(building.capacity);
    }
  });

  it('syncs employees list with employeeIds array', () => {
    const world = makeCityWithCompanies();
    for (const company of world.companies.values()) {
      expect(company.employees.length).toBe(company.employeeIds.length);
      for (let i = 0; i < company.employees.length; i++) {
        expect(company.employees[i]!.citizenId).toBe(company.employeeIds[i]);
      }
    }
  });

  it('employee records contain names and productivity', () => {
    const world = makeCityWithCompanies();
    for (const company of world.companies.values()) {
      for (const emp of company.employees) {
        expect(emp.name).toBeTruthy();
        expect(typeof emp.name).toBe('string');
        expect(emp.productivity).toBeGreaterThanOrEqual(0.8);
        expect(emp.productivity).toBeLessThanOrEqual(1.2);
      }
    }
  });

  it('does not assign unemployed citizens', () => {
    const world = makeCityWithCompanies();
    const assignedIds = new Set<string>();
    for (const company of world.companies.values()) {
      for (const emp of company.employees) {
        assignedIds.add(emp.citizenId);
      }
    }
    for (const citizen of world.citizens.values()) {
      if (citizen.work === null) {
        expect(assignedIds.has(citizen.id)).toBe(false);
      }
    }
  });
});

// ─── tickCompanies ───────────────────────────────────────────────────────────

describe('tickCompanies', () => {
  it('increases revenue proportional to employees', () => {
    const world = makeCityWithCompanies();
    // Find a company with employees.
    const company = Array.from(world.companies.values()).find(
      (c) => c.employees.length > 0,
    )!;
    expect(company).toBeDefined();

    const empCount = company.employees.length;
    const expectedRevenue = empCount * REVENUE_PER_EMPLOYEE * company.productivity;

    tickCompanies(world, timeAt(9));

    expect(company.revenue).toBeCloseTo(expectedRevenue, 5);
  });

  it('adds expenses (wages + maintenance)', () => {
    const world = makeCityWithCompanies();
    const company = Array.from(world.companies.values()).find(
      (c) => c.employees.length > 0,
    )!;

    const empCount = company.employees.length;
    const expectedExpenses = empCount * HOURLY_WAGE + BUILDING_MAINTENANCE;

    tickCompanies(world, timeAt(9));

    expect(company.expenses).toBeCloseTo(expectedExpenses, 5);
  });

  it('updates profit = revenue - expenses', () => {
    const world = makeCityWithCompanies();
    tickCompanies(world, timeAt(9));

    for (const company of world.companies.values()) {
      expect(company.profit).toBeCloseTo(
        company.revenue - company.expenses,
        5,
      );
    }
  });

  it('accumulates revenue across multiple ticks', () => {
    const world = makeCityWithCompanies();
    const company = Array.from(world.companies.values()).find(
      (c) => c.employees.length > 0,
    )!;

    tickCompanies(world, timeAt(9));
    const rev1 = company.revenue;

    tickCompanies(world, timeAt(10));
    const rev2 = company.revenue;

    expect(rev2).toBeGreaterThan(rev1);
  });

  it('updates dailyRevenue and dailyExpenses', () => {
    const world = makeCityWithCompanies();
    const company = Array.from(world.companies.values()).find(
      (c) => c.employees.length > 0,
    )!;

    tickCompanies(world, timeAt(9));
    tickCompanies(world, timeAt(10));

    // Two ticks on the same day.
    const empCount = company.employees.length;
    const expectedDailyRevenue =
      2 * empCount * REVENUE_PER_EMPLOYEE * company.productivity;
    expect(company.dailyRevenue).toBeCloseTo(expectedDailyRevenue, 5);
    expect(company.dailyExpenses).toBeGreaterThan(0);
  });

  it('resets daily counters on a new day boundary', () => {
    const world = makeCityWithCompanies();
    const company = Array.from(world.companies.values()).find(
      (c) => c.employees.length > 0,
    )!;

    // Day 0, hour 23.
    tickCompanies(world, timeAt(23));
    expect(company.dailyRevenue).toBeGreaterThan(0);

    // Day 1, hour 0 — daily counters reset.
    tickCompanies(world, timeAt(HOURS_PER_DAY + 0));
    const resetDailyRevenue = company.dailyRevenue;
    const empCount = company.employees.length;
    const expectedSingleTickRevenue =
      empCount * REVENUE_PER_EMPLOYEE * company.productivity;
    expect(resetDailyRevenue).toBeCloseTo(expectedSingleTickRevenue, 5);
  });

  it('still charges maintenance for companies with no employees', () => {
    const world = makeCityWithCompanies();
    const empty = Array.from(world.companies.values()).find(
      (c) => c.employees.length === 0,
    );

    // It is possible (though unlikely) that all companies have employees.
    if (empty) {
      tickCompanies(world, timeAt(9));
      expect(empty.expenses).toBeCloseTo(BUILDING_MAINTENANCE, 5);
      expect(empty.revenue).toBe(0);
    }
  });

  it('cumulative revenue keeps growing across day boundaries', () => {
    const world = makeCityWithCompanies();
    const company = Array.from(world.companies.values()).find(
      (c) => c.employees.length > 0,
    )!;

    tickCompanies(world, timeAt(23));
    const rev1 = company.revenue;

    tickCompanies(world, timeAt(HOURS_PER_DAY + 0));
    const rev2 = company.revenue;

    expect(rev2).toBeGreaterThan(rev1);
  });
});
