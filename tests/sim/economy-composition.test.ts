/**
 * Composition tests: the hourly economy wired to the real citizen and company
 * systems over the seeded city world.
 *
 * Where `economy.test.ts` pins hand-built citizens, this suite proves the whole
 * join: `CitizensSystem` generates the roster, `CompaniesSystem` places
 * businesses and staffs itself through the economy's labour market, and
 * `EconomySystem` settles one hour at a time on the fixture `SimulationEngine`.
 * Every wage therefore flows between a real company record and a real citizen
 * record, and the city budget is settled for every hour of two simulated days.
 */

import { describe, expect, it } from 'vitest';

import { MINUTES_PER_HOUR } from '../../src/sim/clock';
import { CitizensSystem } from '../../src/sim/citizens';
import { CompaniesSystem, defaultDemandModel } from '../../src/sim/companies';
import {
  DEFAULT_SERVICE_COST_PER_BUILDING_HOUR,
  DEFAULT_SERVICE_COST_PER_CITIZEN_HOUR,
  DEFAULT_TAX_RATE,
  DEMAND_SIGNAL_CEILING,
  DEMAND_SIGNAL_FLOOR,
  EconomySystem,
  WAGE_SIGNAL_CEILING,
  WAGE_SIGNAL_FLOOR,
} from '../../src/sim/economy';
import type { EconomyRecord } from '../../src/sim/economy';
import { createCityWorld } from '../../src/sim/world';
import { SIM_DAY_MINUTES, createSimFixture } from '../helpers/sim-fixtures';
import type { SimFixture } from '../helpers/sim-fixtures';

const INITIAL_BUDGET = 250_000;
/** The city is labour scarce: most businesses cannot fill every post. */
const MIN_MIDDAY_EMPLOYED = 40;

interface Composition {
  readonly fixture: SimFixture;
  readonly world: ReturnType<typeof createCityWorld>;
  readonly citizens: CitizensSystem;
  readonly companies: CompaniesSystem;
  readonly economy: EconomySystem;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Builds the full four-system composition. The economy comes first so the
 * company system can be handed its labour market and its demand adapter, then
 * every system attaches to the shared fixture engine.
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
  fixture.engine.attach(citizens);
  fixture.engine.attach(companies);
  fixture.engine.attach(economy);
  return { fixture, world, citizens, companies, economy };
}

describe('economy / engine + citizens + companies composition', () => {
  it('settles two simulated days hour by hour, aligned with the companies', () => {
    const { fixture, citizens, companies, economy } = buildComposition('economy-composition');
    try {
      const published: EconomyRecord[] = [];
      economy.onSettlement((record) => published.push(record));

      expect(fixture.advanceMinutes(2 * SIM_DAY_MINUTES)).toBe(2 * SIM_DAY_MINUTES);

      // One settlement per hour boundary for both hourly systems.
      expect(economy.settlementCount).toBe(48);
      expect(companies.hoursSettledCount).toBe(48);
      expect(published).toHaveLength(48);

      const records = economy.settlements;
      const perDay = new Map<number, number>();
      records.forEach((record, index) => {
        expect(record.totalMinutes).toBe((index + 1) * MINUTES_PER_HOUR);
        expect(record.minute).toBe(0);
        expect(record.day).toBe(Math.floor(index / 24));
        expect(record.hour).toBe(index % 24);
        expect(record.population).toBe(citizens.citizens.length);
        expect(record.companyCount).toBe(companies.companies.length);
        perDay.set(record.day, (perDay.get(record.day) ?? 0) + 1);
      });
      expect([...perDay.entries()]).toEqual([
        [0, 24],
        [1, 24],
      ]);

      // The companies booked exactly the same hours, in the same order.
      for (const company of companies.companies) {
        expect(company.postCount).toBe(48);
        const keys = company.revenueHistory.map((entry) => `${entry.day}:${entry.hour}`);
        expect(keys).toEqual(records.map((record) => `${record.day}:${record.hour}`));
      }

      expect(economy.hudStats().cityTimeLabel).toBe('Day 3, 00:00');
      expect(economy.hudStats().cityBudget).toBe(economy.cityBudget);
    } finally {
      fixture.dispose();
    }
  });

  it('joins employed citizens to the company workforces through the labour API', () => {
    const { fixture, citizens, companies, economy } = buildComposition('economy-join');
    try {
      // Midday: the companies are staffed and the citizens are at work.
      fixture.advanceMinutes(13 * MINUTES_PER_HOUR);
      const record = economy.lastSettlement as EconomyRecord;
      expect(record.hour).toBe(12);
      expect(record.employedCitizens).toBeGreaterThan(0);

      // Every company's roster is exactly its employed citizens, and each of
      // them is employed at the premises that company operates from.
      for (const company of companies.companies) {
        expect(company.employeeCount).toBe(company.employees.length);
        const workforce = [...economy.workforceFor(company.id)].sort();
        expect(workforce).toEqual([...company.employees].sort());
        for (const citizenId of workforce) {
          const citizen = citizens.citizenById(citizenId);
          expect(citizen).not.toBeNull();
          expect(citizen?.occupation.companyId).toBe(company.id);
          expect(citizen?.occupation.workplaceBuildingId).toBe(company.buildingId);
        }
      }

      // The union of the rosters is the employed population, with no duplicates
      // and no citizen employed by a company that does not exist.
      const employedIds = economy.employedCitizenIds();
      expect(employedIds).toEqual([...record.employedCitizenIds]);
      expect(new Set(employedIds).size).toBe(employedIds.length);
      for (const citizen of citizens.citizens) {
        const companyId = citizen.occupation.companyId;
        if (companyId === null) {
          continue;
        }
        expect(employedIds).toContain(citizen.id);
        expect(companies.companyById(companyId)).not.toBeNull();
      }

      // The published employment rate is the joined roster over the population.
      expect(record.employmentRate).toBeCloseTo(record.employedCitizens / record.population, 12);
      expect(record.unemploymentRate).toBeCloseTo(1 - record.employmentRate, 12);
      expect(record.employmentRate).toBeGreaterThan(0.5);
      expect(record.averageWage).toBeGreaterThan(0);
    } finally {
      fixture.dispose();
    }
  });

  it('moves wages from company cash to citizens and settles the budget each hour', () => {
    const { fixture, world, companies, economy } = buildComposition('economy-budget');
    try {
      const opening = new Map(companies.companies.map((company) => [company.id, company.cash]));
      expect(opening.size).toBeGreaterThanOrEqual(12);

      fixture.advanceMinutes(2 * SIM_DAY_MINUTES);
      const records = economy.settlements;

      let budget = INITIAL_BUDGET;
      let totalGross = 0;
      let totalTax = 0;
      for (const record of records) {
        // Budget arithmetic is recomputable from the record's own inputs and the
        // world the economy settled in.
        expect(record.taxRate).toBe(DEFAULT_TAX_RATE);
        // The tax is withheld per wage and rounded per citizen, so it can drift
        // from the flat rate by less than half a cent per paid citizen.
        expect(Math.abs(record.taxIncome - record.grossWages * DEFAULT_TAX_RATE)).toBeLessThanOrEqual(
          0.005 * record.workingCitizens + 0.005,
        );
        expect(record.netWages).toBeCloseTo(record.grossWages - record.taxIncome, 6);
        expect(record.serviceCosts).toBeCloseTo(
          round2(
            record.population * DEFAULT_SERVICE_COST_PER_CITIZEN_HOUR +
              world.buildings.length * DEFAULT_SERVICE_COST_PER_BUILDING_HOUR,
          ),
          9,
        );
        expect(record.budgetDelta).toBeCloseTo(record.taxIncome - record.serviceCosts, 9);
        budget = round2(budget + record.budgetDelta);
        expect(record.cityBudget).toBeCloseTo(budget, 9);
        totalGross += record.grossWages;
        totalTax += record.taxIncome;
      }
      expect(economy.cityBudget).toBeCloseTo(INITIAL_BUDGET + records.reduce((s, r) => s + r.budgetDelta, 0), 6);
      expect(totalGross).toBeGreaterThan(0);
      expect(totalTax).toBeGreaterThan(0);
      expect(totalTax).toBeLessThan(totalGross);

      // Wages really left company cash: per company, cash equals the opening
      // balance plus the ledger nets minus every wage the economy paid out.
      for (const company of companies.companies) {
        const net = company.revenueHistory.reduce((sum, entry) => sum + entry.netCash, 0);
        const wages = records.reduce((sum, record) => sum + (record.wagesByCompany[company.id] ?? 0), 0);
        expect(company.cash).toBeCloseTo((opening.get(company.id) ?? 0) + net - wages, 6);
      }

      // Many businesses really did pay their staff during the two days (every
      // roster is emptied again at midnight, so the cash identity above is the
      // lasting evidence of who paid whom).
      const payingCompanies = companies.companies.filter((company) =>
        records.some((record) => (record.wagesByCompany[company.id] ?? 0) > 0),
      );
      expect(payingCompanies.length).toBeGreaterThan(10);
      for (const company of payingCompanies) {
        expect(company.totalCosts).toBeGreaterThan(0);
      }

      // The wages of one hour add up across the companies that paid them.
      for (const record of records) {
        const perCompany = Object.values(record.wagesByCompany).reduce((sum, value) => sum + value, 0);
        expect(perCompany).toBeCloseTo(record.grossWages, 6);
      }
    } finally {
      fixture.dispose();
    }
  });

  it('changes citizen employment with company staffing through the day', () => {
    const { fixture, citizens, companies, economy } = buildComposition('economy-staffing');
    try {
      fixture.advanceMinutes(2 * SIM_DAY_MINUTES);
      const records = economy.settlements;
      const population = citizens.citizens.length;

      // The city empties when every sector has closed for the night.
      const midnight = records[records.length - 1];
      expect(midnight.hour).toBe(23);
      expect(midnight.employedCitizens).toBe(0);
      expect(midnight.employmentRate).toBe(0);
      expect(midnight.unemploymentRate).toBe(1);
      expect(companies.totals().employeeCount).toBe(0);
      expect(economy.employedCitizenIds()).toEqual([]);

      // Employment swings widely over the day as the companies staff up and down.
      const counts = new Set(records.map((record) => record.employedCitizens));
      expect(counts.size).toBeGreaterThan(4);
      const busy = records.filter((record) => record.hour >= 10 && record.hour <= 16);
      for (const record of busy) {
        expect(record.employedCitizens).toBeGreaterThanOrEqual(MIN_MIDDAY_EMPLOYED);
        expect(record.employmentRate).toBeCloseTo(record.employedCitizens / population, 12);
      }

      // At least one citizen held a job during the day and lost it at midnight.
      const midday = records.find((record) => record.day === 0 && record.hour === 12);
      expect(midday).toBeDefined();
      const middayWorker = midday?.employedCitizenIds[0];
      expect(middayWorker).toBeDefined();
      const citizen = citizens.citizenById(middayWorker as string);
      expect(citizen?.occupation.companyId).toBeNull();
      expect(midnight.employedCitizenIds).not.toContain(middayWorker);
    } finally {
      fixture.dispose();
    }
  });

  it('feeds the damped demand signal into the company ledgers and stays bounded', () => {
    const { fixture, companies, economy } = buildComposition('economy-feedback');
    try {
      fixture.advanceMinutes(2 * SIM_DAY_MINUTES);
      const records = economy.settlements;

      // The companies traded at exactly the demand the economy signalled.
      const busyRecord = records.find((entry) => entry.day === 0 && entry.hour === 12);
      if (!busyRecord) {
        throw new Error('the economy did not settle hour 12 of day 0');
      }
      const company = companies.companies.find((entry) =>
        entry.revenueHistory.some((row) => row.day === 0 && row.hour === 12),
      );
      if (!company) {
        throw new Error('no company traded during hour 12 of day 0');
      }
      const row = company.revenueHistory.find((entry) => entry.day === 0 && entry.hour === 12);
      if (!row) {
        throw new Error(`${company.id} has no ledger row for hour 12 of day 0`);
      }
      // The company system settles the hour before the economy settles it, so
      // hour 12 traded on the signal the settlement of hour 11 published.
      const previous = records.find((entry) => entry.day === 0 && entry.hour === 11);
      if (!previous) {
        throw new Error('the economy did not settle hour 11 of day 0');
      }
      const base = defaultDemandModel({
        companyId: company.id,
        sector: company.sector,
        buildingId: company.buildingId ?? '',
        districtId: company.districtId,
        day: 0,
        hour: 12,
      });
      expect(row.demand).toBeCloseTo(Math.max(0, Math.min(2, base * previous.demandSignal)), 9);
      expect(busyRecord.demandSignal).toBeGreaterThan(previous.demandSignal);

      // Signals track activity: the business peak is above the small hours.
      const smallHours = records.find((entry) => entry.day === 0 && entry.hour === 3);
      if (!smallHours) {
        throw new Error('the economy did not settle hour 3 of day 0');
      }
      expect(busyRecord.demandSignal).toBeGreaterThan(smallHours.demandSignal);
      expect(busyRecord.wageSignal).toBeGreaterThan(smallHours.wageSignal);
      expect(new Set(records.map((entry) => entry.demandSignal)).size).toBeGreaterThan(10);

      // Bounded over the whole soak: no runaway growth and no collapse.
      for (const entry of records) {
        expect(entry.demandSignal).toBeGreaterThanOrEqual(DEMAND_SIGNAL_FLOOR);
        expect(entry.demandSignal).toBeLessThanOrEqual(DEMAND_SIGNAL_CEILING);
        expect(entry.wageSignal).toBeGreaterThanOrEqual(WAGE_SIGNAL_FLOOR);
        expect(entry.wageSignal).toBeLessThanOrEqual(WAGE_SIGNAL_CEILING);
      }
    } finally {
      fixture.dispose();
    }
  });

  it('publishes the snapshot and HUD stats the top overlay renders', () => {
    const { fixture, world, citizens, companies, economy } = buildComposition('economy-hud');
    try {
      fixture.advanceMinutes(2 * SIM_DAY_MINUTES);
      const record = economy.lastSettlement as EconomyRecord;
      const hud = economy.hudStats();

      expect(record.population).toBe(citizens.citizens.length);
      expect(record.companyCount).toBe(world.companies.length);
      expect(record.employedCitizens).toBe(economy.employedCitizenIds().length);
      expect(record.employmentRate).toBeCloseTo(record.employedCitizens / record.population, 12);
      expect(record.averageMood).toBeGreaterThan(0);
      expect(record.averageMood).toBeLessThanOrEqual(1);
      expect(record.netProfit).toBeCloseTo(record.totalRevenue - record.totalCosts, 9);
      expect(record.totalRevenue).toBeGreaterThanOrEqual(0);
      // Day-to-date revenue is reset at midnight by the company system, so the
      // daytime hours are what prove the aggregate revenue is published.
      const midday = economy.settlements.find((entry) => entry.day === 1 && entry.hour === 12);
      expect(midday?.totalRevenue).toBeGreaterThan(0);
      expect(midday?.netProfit).toBeCloseTo((midday?.totalRevenue ?? 0) - (midday?.totalCosts ?? 0), 9);
      expect(record.cityBudget).toBe(economy.cityBudget);

      expect(hud.population).toBe(record.population);
      expect(hud.employedCitizens).toBe(record.employedCitizens);
      expect(hud.employmentRate).toBeCloseTo(record.employmentRate, 12);
      expect(hud.cityBudget).toBe(record.cityBudget);
      expect(hud.cityTimeLabel).toBe('Day 3, 00:00');
      expect(hud.day).toBe(2);
      expect(hud.hour).toBe(0);
      expect(hud.minute).toBe(0);
      expect(hud.phase).toBe('night');
      expect(hud.citizenCount).toBe(citizens.citizens.length);
      expect(hud.buildingCount).toBe(world.buildings.length);
      expect(hud.vehicleCount).toBe(world.vehicles.length);
      expect(hud.companyCount).toBe(companies.companies.length);
      expect(hud.budgetDelta).toBe(record.budgetDelta);
      expect(hud.taxIncome).toBe(record.taxIncome);
      expect(hud.serviceCosts).toBe(record.serviceCosts);
      expect(hud.demandSignal).toBe(record.demandSignal);
      expect(hud.wageSignal).toBe(record.wageSignal);
      expect(hud.totalRevenue).toBe(record.totalRevenue);
      expect(hud.averageWage).toBe(record.averageWage);

      // The overlay is fed once per settlement, in step with the snapshots.
      const publications: string[] = [];
      economy.onSettlement((snapshot) => publications.push(`${snapshot.day}:${snapshot.hour}`));
      fixture.advanceMinutes(3 * MINUTES_PER_HOUR);
      expect(publications).toEqual(['2:0', '2:1', '2:2']);
    } finally {
      fixture.dispose();
    }
  });
});
