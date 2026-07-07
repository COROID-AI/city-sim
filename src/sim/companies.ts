/**
 * Company creation, employee assignment, and per-hour revenue / expense
 * tracking.
 *
 * Every workplace building becomes a {@link Company}.  Companies employ
 * citizens (respecting building capacity), earn hourly revenue based on
 * the number of employees and a per-company productivity factor, and
 * incur hourly expenses (wages + maintenance).  The simulation clock
 * drives per-sim-hour updates.
 *
 * Revenue model (per sim-hour):
 *   revenueGain = employees × REVENUE_PER_EMPLOYEE × company.productivity
 *   expenseGain = employees × HOURLY_WAGE + BUILDING_MAINTENANCE
 *   profitGain  = revenueGain − expenseGain
 */

import {
  HOURS_PER_DAY,
  BUILDING_MAINTENANCE,
  HOURLY_WAGE,
  REVENUE_PER_EMPLOYEE,
} from './constants';
import { createRng } from './rng';
import type {
  Building,
  Company,
  CompanyEmployee,
  ProductKind,
  SimTime,
  World,
} from './types';

// ─── Internal configuration ──────────────────────────────────────────────────

/** Seed for company-generation RNG (deterministic productivity factors). */
const COMPANY_SEED = 1337;

/** Minimum per-company productivity multiplier. */
const MIN_PRODUCTIVITY = 0.7;

/** Maximum per-company productivity multiplier. */
const MAX_PRODUCTIVITY = 1.3;

/** Minimum per-employee productivity multiplier. */
const MIN_EMPLOYEE_PRODUCTIVITY = 0.8;

/** Maximum per-employee productivity multiplier. */
const MAX_EMPLOYEE_PRODUCTIVITY = 1.2;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return all workplace (`WORK`) buildings from the world, ordered by ID
 * for deterministic company creation.
 */
function workplaceBuildings(world: World): Building[] {
  return Array.from(world.buildings.values())
    .filter((b) => b.kind === 'WORK')
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Derive a {@link ProductKind} from a workplace building's name.
 *
 * The world generator assigns thematic names such as "Tech Plaza" or
 * "Harbor Industries"; we classify on keyword matching and fall back to
 * `SERVICES` when no keyword matches.
 */
function classifyProduct(name: string): ProductKind {
  const lower = name.toLowerCase();
  if (lower.includes('tech') || lower.includes('lab') || lower.includes('pioneer')) {
    return 'TECHNOLOGY';
  }
  if (lower.includes('industry') || lower.includes('park')) {
    return 'INDUSTRY';
  }
  if (lower.includes('commerce') || lower.includes('trade')) {
    return 'COMMERCE';
  }
  if (lower.includes('finance') || lower.includes('corporate') || lower.includes('summit')) {
    return 'FINANCE';
  }
  if (lower.includes('gateway') || lower.includes('enterprise')) {
    return 'TRADE';
  }
  return 'SERVICES';
}

/**
 * Generate a human-readable display name for a citizen based on their ID.
 *
 * Uses a deterministic palette so the same citizen always gets the same
 * name.  Used for the employee detail list inside a company.
 */
function citizenName(citizenId: string): string {
  const firstNames = [
    'Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie',
    'Avery', 'Quinn', 'Drew', 'Reese', 'Charlie', 'Skyler', 'Parker', 'Rowan',
    'Sage', 'Finley', 'Emerson', 'Hayden', 'Blake', 'Cameron', 'Devon', 'Elliot',
  ];
  const lastNames = [
    'Smith', 'Johnson', 'Lee', 'Patel', 'Garcia', 'Kim', 'Brown', 'Davis',
    'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson',
    'White', 'Harris', 'Martin', 'Thompson', 'Lopez', 'Young', 'King', 'Wright',
    'Hill',
  ];
  // Extract the numeric suffix from IDs like "c0", "c42".
  const match = citizenId.match(/\d+$/);
  const n = match ? Number.parseInt(match[0], 10) : 0;
  const first = firstNames[n % firstNames.length]!;
  const last = lastNames[(n * 7 + 3) % lastNames.length]!;
  return `${first} ${last}`;
}

/**
 * Build a detailed employee record for a citizen.
 */
function makeEmployee(
  citizenId: string,
  productivity: number,
): CompanyEmployee {
  return {
    citizenId,
    name: citizenName(citizenId),
    productivity,
  };
}

// ─── Public API: createCompanies ─────────────────────────────────────────────

/**
 * Create one {@link Company} for every workplace (`WORK`) building in
 * the world.
 *
 * Each company inherits its building's name and receives a deterministic
 * per-company productivity factor (0.70–1.30).  Revenue, expenses, and
 * daily counters start at zero.  If a company already exists for a given
 * building it is skipped (idempotent).
 *
 * @param world The world to populate (mutated in place).
 */
export function createCompanies(world: World): void {
  const rng = createRng(COMPANY_SEED);
  const startId = world.companies.size;
  let created = 0;

  for (const building of workplaceBuildings(world)) {
    // Skip if a company already exists for this building (idempotent).
    if (Array.from(world.companies.values()).some((c) => c.buildingId === building.id)) {
      continue;
    }

    const productKind = classifyProduct(building.name);
    const productivity =
      MIN_PRODUCTIVITY + rng.next() * (MAX_PRODUCTIVITY - MIN_PRODUCTIVITY);

    const company: Company = {
      id: `co${startId + created}`,
      name: building.name,
      buildingId: building.id,
      productKind,
      productivity,
      employeeIds: [],
      employees: [],
      revenue: 0,
      expenses: 0,
      dailyRevenue: 0,
      dailyExpenses: 0,
      profit: 0,
      lastResetDay: 0,
    };

    // Link the building back to its owning company.
    building.owner = company.id;

    world.companies.set(company.id, company);
    created++;
  }
}

// ─── Public API: assignEmployees ─────────────────────────────────────────────

/**
 * Assign every employed citizen to the company located at their
 * workplace building, respecting each building's capacity.
 *
 * A citizen is "employed" when their `work` field is non-null.  The
 * company's `employees` list (with display names) and `employeeIds`
 * array are rebuilt from scratch on each call so the two stay in sync.
 *
 * @param world The world whose citizens and companies to link.
 */
export function assignEmployees(world: World): void {
  const rng = createRng(COMPANY_SEED + 1);

  // Reset all company employee data.
  for (const company of world.companies.values()) {
    company.employees = [];
    company.employeeIds = [];
  }

  // Map building ID → company for fast lookup.
  const buildingToCompany = new Map<string, Company>();
  for (const company of world.companies.values()) {
    buildingToCompany.set(company.buildingId, company);
  }

  // Track remaining capacity per company.
  const remainingCapacity = new Map<string, number>();
  for (const building of world.buildings.values()) {
    if (building.kind === 'WORK') {
      const company = buildingToCompany.get(building.id);
      if (company) {
        remainingCapacity.set(company.id, building.capacity);
      }
    }
  }

  // Assign every employed citizen, respecting capacity.
  for (const citizen of world.citizens.values()) {
    if (citizen.work === null) continue;

    const company = buildingToCompany.get(citizen.work);
    if (!company) continue;

    const capacity = remainingCapacity.get(company.id) ?? 0;
    if (capacity <= 0) continue; // Building is full.

    const productivity =
      MIN_EMPLOYEE_PRODUCTIVITY +
      rng.next() * (MAX_EMPLOYEE_PRODUCTIVITY - MIN_EMPLOYEE_PRODUCTIVITY);

    company.employees.push(makeEmployee(citizen.id, productivity));
    company.employeeIds.push(citizen.id);
    remainingCapacity.set(company.id, capacity - 1);
  }
}

// ─── Public API: tickCompanies ───────────────────────────────────────────────

/**
 * Advance every company by one simulation tick (one sim-hour).
 *
 * For each company with employees, hourly revenue is computed as:
 *
 *   revenueGain = employees × REVENUE_PER_EMPLOYEE × company.productivity
 *
 * Hourly expenses are computed as:
 *
 *   expenseGain = employees × HOURLY_WAGE + BUILDING_MAINTENANCE
 *
 * Revenue, expenses, profit, and daily counters are updated.  When the
 * simulation crosses a day boundary (day-of-day changes) the daily
 * counters reset for the new day.
 *
 * @param world   The world whose companies to advance (mutated in place).
 * @param simTime The current simulation clock.
 */
export function tickCompanies(world: World, simTime: SimTime): void {
  const currentDay = Math.floor(simTime.elapsedHours / HOURS_PER_DAY);

  for (const company of world.companies.values()) {
    const employeeCount = company.employees.length;

    // Reset daily counters when a new sim-day begins.
    if (currentDay !== company.lastResetDay) {
      company.dailyRevenue = 0;
      company.dailyExpenses = 0;
      company.lastResetDay = currentDay;
    }

    // Skip revenue/expense computation for companies with no employees,
    // but still charge maintenance so empty workplaces cost money.
    const revenueGain =
      employeeCount * REVENUE_PER_EMPLOYEE * company.productivity;

    const expenseGain = employeeCount * HOURLY_WAGE + BUILDING_MAINTENANCE;

    company.revenue += revenueGain;
    company.expenses += expenseGain;
    company.dailyRevenue += revenueGain;
    company.dailyExpenses += expenseGain;
    company.profit = company.revenue - company.expenses;
  }
}
