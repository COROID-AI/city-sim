/**
 * Unit tests for the hourly economy.
 *
 * These tests drive `EconomySystem` on the fixture clock + engine with
 * hand-built citizens, so every figure the settlement publishes can be
 * recomputed from the inputs: the settlement cadence, the wage/tax/budget
 * arithmetic, the employment join through the company labour API, the damped
 * demand/wage feedback loop and the snapshot/HUD publication.
 *
 * `economy-composition.test.ts` covers the same system wired to the real
 * citizen and company systems over the seeded city world.
 */

import { describe, expect, it } from 'vitest';

import { MINUTES_PER_HOUR, resolveDayPhase } from '../../src/sim/clock';
import { CompaniesSystem } from '../../src/sim/companies';
import type { EngineContext } from '../../src/sim/engine';
import {
  DEFAULT_ACTIVITY_BASELINE,
  DEFAULT_DEMAND_GAIN,
  DEFAULT_DEMAND_RESPONSE,
  DEFAULT_HISTORY_HOURS,
  DEFAULT_SERVICE_COST_PER_BUILDING_HOUR,
  DEFAULT_SERVICE_COST_PER_CITIZEN_HOUR,
  DEFAULT_TAX_RATE,
  DEMAND_MODEL_CEILING,
  DEMAND_SIGNAL_CEILING,
  DEMAND_SIGNAL_FLOOR,
  ECONOMY_SYSTEM_NAME,
  EconomySystem,
  WAGE_SIGNAL_CEILING,
  WAGE_SIGNAL_FLOOR,
  createEconomySystem,
  formatCityTime,
  isEmployed,
  isPresentAtWork,
} from '../../src/sim/economy';
import type { EconomyRecord } from '../../src/sim/economy';
import { COMPANY_SECTORS } from '../../src/sim/types';
import type { ActivityKind, Citizen, WorldMap } from '../../src/sim/types';
import {
  SIM_DAY_MINUTES,
  createSimFixture,
  createTestCitizen,
  createTestOccupation,
} from '../helpers/sim-fixtures';
import type { SimFixture } from '../helpers/sim-fixtures';

/* ---------------------------------------------------------------- helpers -- */

const FIXTURE_BUILDING_COUNT = 3;
const FIXTURE_OPENING_CASH = 12_500;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Adds an idle citizen assigned to a premises but employed by nobody. */
function addIdleCitizen(world: WorldMap, index: number, workplaceBuildingId: string): Citizen {
  const citizen = createTestCitizen({
    id: `citizen-${index}`,
    name: `Citizen ${index}`,
    occupation: createTestOccupation({ companyId: null, workplaceBuildingId }),
    income: 0,
    mood: 0.5,
    currentActivity: 'home',
    insideBuildingId: 'building-home',
  });
  world.citizens.push(citizen);
  return citizen;
}

/** Puts the whole roster into one activity, inside the matching building. */
function setRosterActivity(world: WorldMap, activity: ActivityKind, atWork: boolean): void {
  for (const citizen of world.citizens) {
    citizen.currentActivity = activity;
    citizen.insideBuildingId = atWork ? citizen.occupation.workplaceBuildingId : citizen.homeBuildingId;
  }
}

function expectedServiceCosts(population: number, buildings: number): number {
  return round2(
    population * DEFAULT_SERVICE_COST_PER_CITIZEN_HOUR + buildings * DEFAULT_SERVICE_COST_PER_BUILDING_HOUR,
  );
}

/** The context shape a manual hour delivery needs (engine, clock, tick). */
function manualContext(fixture: SimFixture, tick: number): EngineContext {
  return {
    engine: fixture.engine,
    clock: fixture.clock,
    deltaMinutes: fixture.clock.minutesPerTick,
    tick,
    simTime: fixture.clock.time,
  };
}

/* ------------------------------------------------------------- cadence -- */

describe('economy / hourly settlement cadence', () => {
  it('runs exactly one settlement per sim-hour over two simulated days', () => {
    const fixture = createSimFixture({ seed: 'economy-cadence', startHour: 0 });
    try {
      const economy = createEconomySystem(fixture.world, { initialBudget: 10_000 });
      const published: EconomyRecord[] = [];
      const unsubscribe = economy.onSettlement((record) => published.push(record));
      fixture.engine.attach(economy);
      expect(economy.attached).toBe(true);
      expect(economy.name).toBe(ECONOMY_SYSTEM_NAME);

      expect(fixture.advanceMinutes(2 * SIM_DAY_MINUTES)).toBe(2 * SIM_DAY_MINUTES);

      expect(economy.settlementCount).toBe(48);
      expect(published).toHaveLength(48);

      const records = economy.settlements;
      expect(records).toHaveLength(48);
      const perDay = new Map<number, number>();
      records.forEach((record, index) => {
        // Every settlement lands on a distinct hour boundary, minute zero.
        expect(record.totalMinutes).toBe((index + 1) * MINUTES_PER_HOUR);
        expect(record.minute).toBe(0);
        expect(record.day).toBe(Math.floor(index / 24));
        expect(record.hour).toBe(index % 24);
        expect(record.settlementCount).toBe(index + 1);
        expect(record.phase).toBe(resolveDayPhase(record.hour + 1));
        // The published record is the stored one.
        expect(published[index]).toBe(record);
        perDay.set(record.day, (perDay.get(record.day) ?? 0) + 1);
      });
      expect([...perDay.entries()]).toEqual([
        [0, 24],
        [1, 24],
      ]);
      expect(economy.lastSettlement).toBe(records[47]);
      expect(economy.ticksSeen).toBe(2 * SIM_DAY_MINUTES);

      // Replaying the boundary the system just settled must not settle twice.
      const boundaries = fixture.systems[0].boundaries;
      economy.onHourEnd(manualContext(fixture, 2 * SIM_DAY_MINUTES), boundaries[boundaries.length - 1]);
      expect(economy.settlementCount).toBe(48);

      // Unsubscribing a listener stops its publication but not the settlement.
      unsubscribe();
      fixture.advanceMinutes(MINUTES_PER_HOUR);
      expect(economy.settlementCount).toBe(49);
      expect(published).toHaveLength(48);
    } finally {
      fixture.dispose();
    }
  });

  it('settles once per boundary even when a boundary is delivered twice', () => {
    const fixture = createSimFixture({ seed: 'economy-once', startHour: 0 });
    try {
      const economy = createEconomySystem(fixture.world);
      fixture.advanceMinutes(3 * MINUTES_PER_HOUR);
      const boundaries = fixture.systems[0].boundaries;
      expect(boundaries).toHaveLength(3);

      economy.onHourEnd(manualContext(fixture, 60), boundaries[0]);
      economy.onHourEnd(manualContext(fixture, 60), boundaries[0]);
      expect(economy.settlementCount).toBe(1);
      expect(economy.lastSettlement?.hour).toBe(0);

      economy.onHourEnd(manualContext(fixture, 120), boundaries[1]);
      expect(economy.settlementCount).toBe(2);
      economy.onHourEnd(manualContext(fixture, 120), boundaries[1]);
      expect(economy.settlementCount).toBe(2);
      expect(economy.lastSettlement?.hour).toBe(1);
    } finally {
      fixture.dispose();
    }
  });

  it('keeps a rolling settlement history capped at the configured length', () => {
    const fixture = createSimFixture({ seed: 'economy-history', startHour: 0 });
    try {
      const economy = createEconomySystem(fixture.world, { historyHours: 5 });
      fixture.engine.attach(economy);
      fixture.advanceMinutes(8 * MINUTES_PER_HOUR);
      expect(economy.settlementCount).toBe(8);
      expect(economy.settlements).toHaveLength(5);
      expect(economy.settlements.map((record) => record.hour)).toEqual([3, 4, 5, 6, 7]);
      expect(DEFAULT_HISTORY_HOURS).toBe(168);
    } finally {
      fixture.dispose();
    }
  });
});

/* --------------------------------------------------- wages, tax, budget -- */

describe('economy / wages, taxes and the city budget', () => {
  it('moves wages from company cash to citizens, taxes them and charges services', () => {
    const fixture = createSimFixture({ seed: 'economy-budget', startHour: 0 });
    try {
      const economy = createEconomySystem(fixture.world, { initialBudget: 10_000 });
      fixture.engine.attach(economy);
      const citizen = fixture.world.citizens[0];
      const company = fixture.world.companies[0];
      expect(isEmployed(citizen)).toBe(true);
      expect(isPresentAtWork(citizen)).toBe(true);

      // 47 hours: day one has been settled (and its daily income counter is
      // wiped by the midnight boundary) and day two is almost complete.
      fixture.advanceMinutes(2 * SIM_DAY_MINUTES - MINUTES_PER_HOUR);
      const beforeMidnight = economy.settlements;
      expect(beforeMidnight).toHaveLength(47);
      const accrued = beforeMidnight
        .filter((record) => record.day === 1)
        .reduce((sum, record) => sum + record.netWages, 0);
      expect(citizen.income).toBeCloseTo(accrued, 6);
      expect(accrued).toBeGreaterThan(0);
      expect(citizen.household.funds).toBeGreaterThan(0);

      // The last boundary starts day three: the per-day counter restarts.
      fixture.advanceMinutes(MINUTES_PER_HOUR);
      expect(citizen.income).toBe(0);

      const records = economy.settlements;
      expect(records).toHaveLength(48);

      // Every hour the citizen works the company pays wagePerHour * wageSignal,
      // the city withholds the income tax and the citizen keeps the rest.
      let budget = 10_000;
      for (const record of records) {
        expect(record.population).toBe(1);
        expect(record.employedCitizens).toBe(1);
        expect(record.employmentRate).toBe(1);
        expect(record.taxRate).toBe(DEFAULT_TAX_RATE);
        expect(record.workingCitizens).toBe(1);

        const gross = round2(citizen.occupation.wagePerHour * record.wageSignal);
        expect(record.grossWages).toBeCloseTo(gross, 9);
        expect(record.taxIncome).toBeCloseTo(round2(gross * DEFAULT_TAX_RATE), 9);
        expect(record.netWages).toBeCloseTo(gross - round2(gross * DEFAULT_TAX_RATE), 9);
        expect(record.serviceCosts).toBeCloseTo(
          expectedServiceCosts(record.population, FIXTURE_BUILDING_COUNT),
          9,
        );
        expect(record.budgetDelta).toBeCloseTo(record.taxIncome - record.serviceCosts, 9);

        budget = round2(budget + record.budgetDelta);
        expect(record.cityBudget).toBeCloseTo(budget, 9);
        expect(record.wagesByCompany['company-1']).toBeCloseTo(gross, 9);
      }
      expect(economy.cityBudget).toBeCloseTo(budget, 9);

      // Company cash fell by exactly the wages the economy paid out of it.
      const grossPaid = records.reduce((sum, record) => sum + record.grossWages, 0);
      expect(company.cash).toBeCloseTo(FIXTURE_OPENING_CASH - grossPaid, 6);
    } finally {
      fixture.dispose();
    }
  });

  it('pays no wage while the employed citizen is not at their workplace', () => {
    const fixture = createSimFixture({ seed: 'economy-absence', startHour: 0 });
    try {
      const economy = createEconomySystem(fixture.world, { initialBudget: 10_000 });
      fixture.engine.attach(economy);
      const citizen = fixture.world.citizens[0];
      const company = fixture.world.companies[0];

      citizen.currentActivity = 'home';
      citizen.insideBuildingId = citizen.homeBuildingId;
      const openingCash = company.cash;
      const openingIncome = citizen.income;

      fixture.advanceMinutes(MINUTES_PER_HOUR);
      const record = economy.lastSettlement as EconomyRecord;
      expect(record.grossWages).toBe(0);
      expect(record.taxIncome).toBe(0);
      expect(record.netWages).toBe(0);
      expect(record.workingCitizens).toBe(0);
      expect(company.cash).toBe(openingCash);
      expect(citizen.income).toBe(openingIncome);
      // Service costs still fall on the city, so the budget moves without tax.
      expect(record.budgetDelta).toBeCloseTo(-record.serviceCosts, 9);

      // Back at their desk, the next hour earns a wage again.
      citizen.currentActivity = 'work';
      citizen.insideBuildingId = citizen.occupation.workplaceBuildingId;
      fixture.advanceMinutes(MINUTES_PER_HOUR);
      const paid = economy.lastSettlement as EconomyRecord;
      expect(paid.grossWages).toBeGreaterThan(0);
      expect(citizen.income).toBeGreaterThan(openingIncome);
      expect(company.cash).toBeLessThan(openingCash);
    } finally {
      fixture.dispose();
    }
  });
});

/* ------------------------------------------------------- employment join -- */

describe('economy / employment join through the labour API', () => {
  it('joins idle citizens to a company and releases them again', () => {
    const fixture = createSimFixture({ seed: 'economy-join', startHour: 0 });
    try {
      const world = fixture.world;
      const economy = createEconomySystem(world);
      const market = economy.createLabourMarket();
      const homeCitizen = addIdleCitizen(world, 2, 'building-home');
      const shopCitizen = world.citizens[0];
      shopCitizen.occupation.companyId = null;

      // Only the citizen the roster assigned to the company's premises is hired.
      expect(world.companies[0].buildingId).toBe(shopCitizen.occupation.workplaceBuildingId);
      expect(market.requestEmployees('company-1', 5)).toEqual([shopCitizen.id]);
      expect(shopCitizen.occupation.companyId).toBe('company-1');
      expect(shopCitizen.occupation.sector).toBe(world.companies[0].sector);
      expect(homeCitizen.occupation.companyId).toBeNull();
      expect(economy.workforceFor('company-1')).toEqual([shopCitizen.id]);
      expect(economy.employedCitizenIds()).toEqual([shopCitizen.id]);
      expect(economy.workforceFor('company-unknown')).toEqual([]);

      // No second hire: the premises roster is exhausted.
      expect(market.requestEmployees('company-1', 3)).toEqual([]);
      expect(market.requestEmployees('company-1', 0)).toEqual([]);
      expect(market.requestEmployees('company-unknown', 3)).toEqual([]);

      // Release only returns the ids that really changed hands.
      expect(market.releaseEmployees('company-1', [homeCitizen.id, shopCitizen.id])).toEqual([
        shopCitizen.id,
      ]);
      expect(shopCitizen.occupation.companyId).toBeNull();
      expect(economy.employedCitizenIds()).toEqual([]);
      expect(economy.workforceFor('company-1')).toEqual([]);
      expect(isEmployed(homeCitizen)).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  it('publishes an employment rate that matches the joined roster', () => {
    const fixture = createSimFixture({ seed: 'economy-rate', startHour: 0 });
    try {
      const world = fixture.world;
      const economy = createEconomySystem(world);
      const market = economy.createLabourMarket();
      fixture.engine.attach(economy);
      const homeCitizen = addIdleCitizen(world, 2, 'building-home');
      const shopCitizen = addIdleCitizen(world, 3, 'building-shop');
      const worker = world.citizens[0];

      // Nobody is employed: the snapshot shows an unemployed city.
      worker.occupation.companyId = null;
      fixture.advanceMinutes(MINUTES_PER_HOUR);
      const idle = economy.lastSettlement as EconomyRecord;
      expect(idle.population).toBe(3);
      expect(idle.employedCitizens).toBe(0);
      expect(idle.employmentRate).toBe(0);
      expect(idle.unemploymentRate).toBe(1);
      expect(idle.averageWage).toBe(0);

      // One of the three citizens joins the shop's company.
      expect(market.requestEmployees('company-1', 1)).toEqual([worker.id]);
      fixture.advanceMinutes(MINUTES_PER_HOUR);
      const staffed = economy.lastSettlement as EconomyRecord;
      expect(staffed.employedCitizens).toBe(1);
      expect(staffed.employmentRate).toBeCloseTo(1 / 3, 12);
      expect(staffed.unemploymentRate).toBeCloseTo(2 / 3, 12);
      expect(staffed.employmentRate).toBeCloseTo(staffed.employedCitizens / staffed.population, 12);
      expect(staffed.averageWage).toBeCloseTo(worker.occupation.wagePerHour, 9);
      expect(staffed.employedCitizenIds).toEqual([worker.id]);
      expect(staffed.companyRosters['company-1']).toEqual([worker.id]);
      expect(isEmployed(homeCitizen)).toBe(false);
      expect(isEmployed(shopCitizen)).toBe(false);

      // The workforce is exactly the employed citizens of that company.
      expect(economy.workforceFor('company-1')).toEqual([worker.id]);
      expect(economy.employedCitizenIds()).toEqual([worker.id]);
    } finally {
      fixture.dispose();
    }
  });
});

/* ------------------------------------------------------ demand feedback -- */

describe('economy / damped demand and wage feedback', () => {
  it('raises demand and wages with activity and lowers them again', () => {
    const fixture = createSimFixture({ seed: 'economy-feedback', startHour: 0 });
    try {
      const world = fixture.world;
      const economy = createEconomySystem(world);
      fixture.engine.attach(economy);
      addIdleCitizen(world, 2, 'building-shop');
      addIdleCitizen(world, 3, 'building-shop');

      // A quiet hour: the whole city is at home.
      setRosterActivity(world, 'home', false);
      fixture.advanceMinutes(MINUTES_PER_HOUR);
      const quiet = economy.lastSettlement as EconomyRecord;
      expect(quiet.activityLevel).toBe(0);
      expect(quiet.demandSignal).toBeLessThan(1);
      expect(quiet.demandSignal).toBeGreaterThanOrEqual(DEMAND_SIGNAL_FLOOR);

      // Six busy hours: everybody works, so demand and wages climb.
      const rising: number[] = [];
      const risingWages: number[] = [];
      for (let hour = 0; hour < 6; hour += 1) {
        setRosterActivity(world, 'work', true);
        fixture.advanceMinutes(MINUTES_PER_HOUR);
        const record = economy.lastSettlement as EconomyRecord;
        expect(record.activityLevel).toBe(1);
        rising.push(record.demandSignal);
        risingWages.push(record.wageSignal);
      }
      const target = 1 + DEFAULT_DEMAND_GAIN * (1 - DEFAULT_ACTIVITY_BASELINE);
      expect(rising[0]).toBeGreaterThan(quiet.demandSignal);
      // The dampener: one hour only closes part of the gap to the target.
      expect(rising[0]).toBeLessThan(target);
      expect(rising[0]).toBeCloseTo(
        quiet.demandSignal + (target - quiet.demandSignal) * DEFAULT_DEMAND_RESPONSE,
        9,
      );
      for (let index = 1; index < rising.length; index += 1) {
        expect(rising[index]).toBeGreaterThanOrEqual(rising[index - 1]);
        expect(risingWages[index]).toBeGreaterThanOrEqual(risingWages[index - 1]);
      }
      expect(rising[5]).toBeGreaterThan(rising[0]);
      expect(rising[5]).toBeLessThanOrEqual(DEMAND_SIGNAL_CEILING);

      // Six quiet hours again: both signals fall back.
      const falling: number[] = [];
      for (let hour = 0; hour < 6; hour += 1) {
        setRosterActivity(world, 'home', false);
        fixture.advanceMinutes(MINUTES_PER_HOUR);
        falling.push((economy.lastSettlement as EconomyRecord).demandSignal);
      }
      for (let index = 1; index < falling.length; index += 1) {
        expect(falling[index]).toBeLessThanOrEqual(falling[index - 1]);
      }
      expect(falling[5]).toBeLessThan(rising[5]);
      expect(falling[5]).toBeGreaterThanOrEqual(DEMAND_SIGNAL_FLOOR);
      expect(economy.wageSignal).toBeGreaterThanOrEqual(WAGE_SIGNAL_FLOOR);
      expect(economy.wageSignal).toBeLessThanOrEqual(WAGE_SIGNAL_CEILING);
    } finally {
      fixture.dispose();
    }
  });

  it('stays inside its bands over an eight day soak', () => {
    const fixture = createSimFixture({ seed: 'economy-soak', startHour: 0 });
    try {
      const world = fixture.world;
      const economy = createEconomySystem(world);
      fixture.engine.attach(economy);
      addIdleCitizen(world, 2, 'building-shop');

      const dailies: number[][] = [];
      for (let day = 0; day < 8; day += 1) {
        const today: number[] = [];
        for (let hour = 0; hour < 24; hour += 1) {
          const busy = hour < 12;
          setRosterActivity(world, busy ? 'work' : 'home', busy);
          fixture.advanceMinutes(MINUTES_PER_HOUR);
          const record = economy.lastSettlement as EconomyRecord;
          expect(record.demandSignal).toBeGreaterThanOrEqual(DEMAND_SIGNAL_FLOOR);
          expect(record.demandSignal).toBeLessThanOrEqual(DEMAND_SIGNAL_CEILING);
          expect(record.wageSignal).toBeGreaterThanOrEqual(WAGE_SIGNAL_FLOOR);
          expect(record.wageSignal).toBeLessThanOrEqual(WAGE_SIGNAL_CEILING);
          today.push(record.demandSignal);
        }
        dailies.push(today);
      }

      expect(economy.settlementCount).toBe(8 * 24);
      // No runaway: the damped loop settles into a stationary daily cycle, so
      // day eight repeats day seven hour for hour.
      for (let hour = 0; hour < 24; hour += 1) {
        expect(dailies[7][hour]).toBeCloseTo(dailies[6][hour], 9);
      }
      const all = dailies.flat();
      expect(Math.max(...all)).toBeLessThanOrEqual(DEMAND_SIGNAL_CEILING);
      expect(Math.min(...all)).toBeGreaterThanOrEqual(DEMAND_SIGNAL_FLOOR);
      // The band the soak explores is wide but bounded: no collapse, no blow-up.
      expect(Math.max(...all) - Math.min(...all)).toBeGreaterThan(0.3);
    } finally {
      fixture.dispose();
    }
  });

  it('feeds the company demand model with the damped signal', () => {
    const fixture = createSimFixture({ seed: 'economy-feed', startHour: 0 });
    try {
      const world = fixture.world;
      const economy = new EconomySystem(world);
      const companies = new CompaniesSystem(world, {
        demandModel: economy.createDemandModel(() => 1),
        labourMarket: economy.createLabourMarket(),
        startHour: 0,
        initialStaffing: 'none',
      });
      economy.bindCompanies(companies);
      fixture.engine.attach(companies);
      fixture.engine.attach(economy);
      const company = companies.companies[0];
      expect(company).toBeDefined();

      for (let hour = 0; hour < 4; hour += 1) {
        // The company settles the hour before the economy publishes, so it
        // trades on the signal the previous settlement left behind.
        const signalBefore = economy.demandSignal;
        setRosterActivity(world, 'home', false);
        fixture.advanceMinutes(MINUTES_PER_HOUR);
        const entry = company.revenueHistory[company.revenueHistory.length - 1];
        expect(entry.demand).toBeCloseTo(Math.min(DEMAND_MODEL_CEILING, signalBefore), 9);
      }
      const quiet = economy.lastSettlement as EconomyRecord;

      let tradedOn = economy.demandSignal;
      for (let hour = 0; hour < 6; hour += 1) {
        tradedOn = economy.demandSignal;
        setRosterActivity(world, 'work', true);
        fixture.advanceMinutes(MINUTES_PER_HOUR);
        const entry = company.revenueHistory[company.revenueHistory.length - 1];
        expect(entry.demand).toBeCloseTo(Math.min(DEMAND_MODEL_CEILING, tradedOn), 9);
      }
      const busy = economy.lastSettlement as EconomyRecord;
      expect(busy.demandSignal).toBeGreaterThan(quiet.demandSignal);
      const lastEntry = company.revenueHistory[company.revenueHistory.length - 1];
      expect(lastEntry.demand).toBeCloseTo(Math.min(DEMAND_MODEL_CEILING, tradedOn), 9);
      expect(company.demand).toBeCloseTo(lastEntry.demand, 9);
      expect(tradedOn).toBeGreaterThan(quiet.demandSignal);
      // The busy signal is ahead of the reading the company traded on, and the
      // next trading hour will pick it up.
      expect(busy.demandSignal).toBeGreaterThan(company.demand);
    } finally {
      fixture.dispose();
    }
  });
});

/* ---------------------------------------------------- snapshot and HUD -- */

describe('economy / snapshot and HUD publication', () => {
  it('publishes every field the HUD overlay renders', () => {
    const fixture = createSimFixture({ seed: 'economy-hud', startHour: 8 });
    try {
      const world = fixture.world;
      const economy = createEconomySystem(world, { initialBudget: 25_000 });
      fixture.engine.attach(economy);
      const seen: { record: EconomyRecord; hud: ReturnType<EconomySystem['hudStats']> }[] = [];
      economy.onSettlement((record, hud) => seen.push({ record, hud }));

      fixture.advanceMinutes(2 * MINUTES_PER_HOUR);

      const record = economy.lastSettlement as EconomyRecord;
      expect(record.day).toBe(0);
      expect(record.hour).toBe(9);
      expect(record.minute).toBe(0);
      expect(record.totalMinutes).toBe(10 * MINUTES_PER_HOUR);
      expect(record.population).toBe(1);
      expect(record.companyCount).toBe(1);
      expect(record.employedCitizens).toBe(1);
      expect(record.employmentRate).toBeCloseTo(record.employedCitizens / record.population, 12);
      expect(record.unemploymentRate).toBeCloseTo(1 - record.employmentRate, 12);
      expect(record.averageWage).toBeCloseTo(world.citizens[0].occupation.wagePerHour, 9);
      expect(record.averageMood).toBeCloseTo(world.citizens[0].mood, 9);
      expect(record.totalRevenue).toBeCloseTo(world.companies[0].revenue, 9);
      expect(record.totalCosts).toBeCloseTo(world.companies[0].costs, 9);
      expect(record.netProfit).toBeCloseTo(record.totalRevenue - record.totalCosts, 9);
      expect(record.cityBudget).toBe(economy.cityBudget);
      expect(record.budgetDelta).toBeCloseTo(record.taxIncome - record.serviceCosts, 9);
      expect(record.taxRate).toBe(DEFAULT_TAX_RATE);
      expect(record.settlementCount).toBe(2);
      expect(Object.keys(record.sectorRevenue).sort()).toEqual([...COMPANY_SECTORS].sort());
      expect(record.sectorRevenue.hospitality).toBeCloseTo(world.companies[0].revenue, 9);
      expect(record.sectorCosts.hospitality).toBeCloseTo(world.companies[0].costs, 9);
      expect(record.employedCitizenIds).toEqual(['citizen-1']);
      expect(record.companyRosters['company-1']).toEqual(['citizen-1']);
      expect(record.phase).toBe(resolveDayPhase(10));

      const latest = seen[seen.length - 1];
      expect(latest.record).toBe(record);
      const hud = latest.hud;
      expect(hud.population).toBe(1);
      expect(hud.citizenCount).toBe(1);
      expect(hud.employedCitizens).toBe(1);
      expect(hud.employmentRate).toBeCloseTo(1, 12);
      expect(hud.cityBudget).toBe(record.cityBudget);
      expect(hud.day).toBe(0);
      expect(hud.hour).toBe(10);
      expect(hud.minute).toBe(0);
      expect(hud.phase).toBe('morning');
      expect(hud.cityTimeLabel).toBe('Day 1, 10:00');
      expect(hud.vehicleCount).toBe(world.vehicles.length);
      expect(hud.companyCount).toBe(world.companies.length);
      expect(hud.buildingCount).toBe(FIXTURE_BUILDING_COUNT);
      expect(hud.averageMood).toBeCloseTo(record.averageMood, 9);
      expect(hud.budgetDelta).toBe(record.budgetDelta);
      expect(hud.taxIncome).toBe(record.taxIncome);
      expect(hud.serviceCosts).toBe(record.serviceCosts);
      expect(hud.demandSignal).toBe(record.demandSignal);
      expect(hud.wageSignal).toBe(record.wageSignal);
      expect(hud.totalRevenue).toBe(record.totalRevenue);
      expect(hud.averageWage).toBe(record.averageWage);

      // The live HUD reading matches the published snapshot between settlements.
      expect(economy.hudStats()).toEqual(hud);
      expect(formatCityTime(0, 10, 0)).toBe('Day 1, 10:00');
    } finally {
      fixture.dispose();
    }
  });
});

/* --------------------------------------------------------- construction -- */

describe('economy / lifecycle', () => {
  it('rejects invalid configuration', () => {
    const fixture = createSimFixture({ seed: 'economy-config' });
    try {
      const world = fixture.world;
      expect(() => createEconomySystem(world, { taxRate: 1 })).toThrow(RangeError);
      expect(() => createEconomySystem(world, { taxRate: -0.1 })).toThrow(RangeError);
      expect(() => createEconomySystem(world, { initialBudget: Number.NaN })).toThrow(RangeError);
      expect(() => createEconomySystem(world, { serviceCostPerCitizenHour: -1 })).toThrow(RangeError);
      expect(() => createEconomySystem(world, { demandResponse: 0 })).toThrow(RangeError);
      expect(() => createEconomySystem(world, { wageResponse: 1.5 })).toThrow(RangeError);
      expect(() => createEconomySystem(world, { historyHours: 0 })).toThrow(RangeError);
    } finally {
      fixture.dispose();
    }
  });

  it('tracks the clock on attach and stops settling when detached', () => {
    const fixture = createSimFixture({ seed: 'economy-attach', startHour: 7 });
    try {
      const economy = createEconomySystem(fixture.world);
      expect(economy.attached).toBe(false);
      expect(economy.hudStats().cityTimeLabel).toBe('Day 1, 00:00');
      fixture.engine.attach(economy);
      expect(economy.attached).toBe(true);
      expect(economy.hudStats().cityTimeLabel).toBe('Day 1, 07:00');
      expect(economy.hudStats().phase).toBe('dawn');
      fixture.engine.detach('economy');
      expect(economy.attached).toBe(false);
      const settled = economy.settlementCount;
      fixture.advanceMinutes(3 * MINUTES_PER_HOUR);
      expect(economy.settlementCount).toBe(settled);
    } finally {
      fixture.dispose();
    }
  });
});
