/**
 * Composition tests: the company system driven by the foundation engine over a
 * seeded city world.
 *
 * Where `companies.test.ts` pins demand and inspects a single premises, this
 * suite proves the whole join: `CompaniesSystem` places businesses into the
 * buildings `CityWorld` generated, attaches to the fixture `SimulationEngine`,
 * and then settles one ledger row per company for every sim-hour the clock
 * crosses — including across midnight — while cash stays consistent with the
 * posted nets.
 */

import { describe, expect, it } from 'vitest';

import { createCityWorld } from '../../src/sim/world';
import {
  COMMERCIAL_SITE_KINDS,
  CompaniesSystem,
  createOpenLabourMarket,
} from '../../src/sim/companies';
import { SIM_DAY_MINUTES, createSimFixture } from '../helpers/sim-fixtures';

describe('companies / engine + world composition', () => {
  it('runs on the fixture engine over the seeded world for a full sim-day', () => {
    const fixture = createSimFixture({ seed: 'companies-composition', startHour: 0 });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const system = new CompaniesSystem(world, {
        labourMarket: createOpenLabourMarket(),
        startHour: 0,
      });
      fixture.engine.attach(system);

      // Placement happened against the seeded world and nothing else did.
      expect(world.companies.length).toBeGreaterThanOrEqual(12);
      expect(world.companies.length).toBe(system.companies.length);
      expect(new Set(system.companies.map((company) => company.sector)).size).toBeGreaterThanOrEqual(3);

      const openingCash = new Map(system.companies.map((company) => [company.id, company.cash]));

      expect(fixture.advanceMinutes(SIM_DAY_MINUTES)).toBe(SIM_DAY_MINUTES);
      expect(system.hoursSettledCount).toBe(24);

      let lifetimeRevenue = 0;
      for (const company of system.companies) {
        // Placement is still valid after a day of simulation.
        const site = world.buildingById(company.buildingId as string);
        expect(site).not.toBeNull();
        expect(COMMERCIAL_SITE_KINDS).toContain(site?.kind);
        expect(site?.companyId).toBe(company.id);
        expect(company.capacity).toBe(site?.jobSlots);
        expect(company.employeeCount).toBe(company.employees.length);
        expect(company.revenueHistory.length).toBeLessThanOrEqual(company.postCount);

        // Exactly one revenue posting per sim-hour: 24 rows, hours 0..23, no
        // gaps and no duplicate hour keys.
        expect(company.postCount).toBe(24);
        expect(company.revenueHistory).toHaveLength(24);
        const keys = company.revenueHistory.map((entry) => `${entry.day}:${entry.hour}`);
        expect(new Set(keys).size).toBe(24);
        expect(keys[0]).toBe('0:0');
        expect(keys[23]).toBe('0:23');

        // Ledger arithmetic: cash is opening cash plus every posted net, and
        // each row balances internally.
        const net = company.revenueHistory.reduce((sum, entry) => sum + entry.netCash, 0);
        expect(company.cash).toBeCloseTo((openingCash.get(company.id) ?? 0) + net, 6);
        expect(company.totalRevenue).toBeCloseTo(
          company.revenueHistory.reduce((sum, entry) => sum + entry.revenue, 0),
          6,
        );
        expect(company.totalCosts).toBeCloseTo(
          company.revenueHistory.reduce((sum, entry) => sum + entry.totalCosts, 0),
          6,
        );
        for (const entry of company.revenueHistory) {
          expect(entry.totalCosts).toBeCloseTo(entry.wageCosts + entry.otherCosts, 6);
          expect(entry.netCash).toBeCloseTo(entry.revenue - entry.totalCosts, 6);
        }
        lifetimeRevenue += company.totalRevenue;
      }

      expect(lifetimeRevenue).toBeGreaterThan(0);

      const totals = system.totals();
      expect(totals.companyCount).toBe(world.companies.length);
      expect(totals.sectorCount).toBeGreaterThanOrEqual(3);
      expect(totals.hoursSettled).toBe(24);
      expect(totals.capacity).toBeGreaterThan(0);
      // Midnight: every shift has ended, so no worker is on the roster.
      expect(totals.employeeCount).toBe(0);
    } finally {
      fixture.dispose();
    }
  });

  it('keeps one posting per sim-hour across a midnight boundary', () => {
    const fixture = createSimFixture({ seed: 'companies-midnight', startHour: 22 });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const system = new CompaniesSystem(world, {
        labourMarket: createOpenLabourMarket(),
        startHour: 22,
      });
      fixture.engine.attach(system);

      expect(fixture.advanceMinutes(4 * 60)).toBe(240);
      expect(system.hoursSettledCount).toBe(4);
      for (const company of system.companies) {
        const keys = company.revenueHistory.map((entry) => `${entry.day}:${entry.hour}`);
        expect(keys).toEqual(['0:22', '0:23', '1:0', '1:1']);
        expect(new Set(keys).size).toBe(4);
        expect(company.postCount).toBe(4);
      }
    } finally {
      fixture.dispose();
    }
  });

  it('staffs the day shift and empties the rosters at night', () => {
    const fixture = createSimFixture({ seed: 'companies-shifts', startHour: 0 });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const system = new CompaniesSystem(world, {
        labourMarket: createOpenLabourMarket(),
        startHour: 0,
      });
      fixture.engine.attach(system);

      // Midnight to 11:00: every sector is open, so the city is at work.
      fixture.advanceMinutes(11 * 60);
      expect(system.totals().employeeCount).toBeGreaterThan(0);

      // Through the rest of the day, back to midnight: the shifts end.
      fixture.advanceMinutes(13 * 60);
      expect(system.hoursSettledCount).toBe(24);
      expect(system.totals().employeeCount).toBe(0);
    } finally {
      fixture.dispose();
    }
  });

  it('detaches cleanly from the engine', () => {
    const fixture = createSimFixture({ seed: 'companies-detach', startHour: 12 });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const system = new CompaniesSystem(world, {
        labourMarket: createOpenLabourMarket(),
        startHour: 12,
      });
      fixture.engine.attach(system);
      expect(fixture.engine.detach('companies')).toBe(true);
      expect(fixture.engine.getSystem('companies')).toBeUndefined();

      const settled = system.hoursSettledCount;
      fixture.advanceMinutes(120);
      expect(system.hoursSettledCount).toBe(settled);
    } finally {
      fixture.dispose();
    }
  });
});
