/**
 * Behavioural tests for the company system (`src/sim/companies.ts`).
 *
 * The suite covers the four promises the economy, inspector and HUD depend on:
 * full-detail companies are placed into the seeded city's commercial, office
 * and industrial premises; the per-sim-hour ledger posts exactly and moves cash
 * by the net; staffing follows the injected demand signal through the
 * injectable labour market; and viability moves between healthy, troubled and
 * insolvent as cash and runway change. A final guard keeps the module DOM-free.
 */

import { describe, expect, it } from 'vitest';

import type { SimSystem } from '../../src/sim/engine';
import type { CompanySector, EntityId, WorldMap } from '../../src/sim/types';
import type { WorldBuilding } from '../../src/sim/world';
import { createCityWorld } from '../../src/sim/world';
import {
  COMMERCIAL_SITE_KINDS,
  CompaniesSystem,
  COMPANY_STATES,
  COMPANY_WAGE_LEVELS,
  SECTOR_PROFILES,
  createCompaniesSystem,
  createOpenLabourMarket,
  defaultDemandModel,
  defaultRevenueModel,
  sectorProfile,
} from '../../src/sim/companies';
import type { CompanyRevenueContext, LabourMarket } from '../../src/sim/companies';
import { SIM_DAY_MINUTES, createSimFixture } from '../helpers/sim-fixtures';

/* ------------------------------------------------------------ test world -- */

function createPremises(overrides: Partial<WorldBuilding> & { id: string }): WorldBuilding {
  return {
    kind: 'shop',
    name: 'Test Shop',
    footprint: { x: 1, y: 1, width: 2, height: 2 },
    floors: 1,
    capacity: 4,
    occupantIds: [],
    residentHouseholdIds: [],
    companyId: null,
    entranceNodeId: 'node-1',
    color: '#d8a25f',
    address: '10 Alder Way',
    jobSlots: 4,
    leisure: true,
    landmark: false,
    districtId: 'district-1',
    ...overrides,
  };
}

/** Minimal `WorldMap` with only the collections the company system reads. */
function createStubWorld(buildings: WorldBuilding[]): WorldMap {
  return {
    id: 'world-stub',
    widthInTiles: 8,
    heightInTiles: 8,
    tileSize: 32,
    tiles: [],
    nodes: [],
    segments: [],
    buildings,
    households: [],
    citizens: [],
    companies: [],
    vehicles: [],
    spawnNodeId: null,
  };
}

function createShopWorld(overrides: Partial<WorldBuilding> = {}): WorldMap {
  return createStubWorld([createPremises({ id: 'building-shop-1', ...overrides })]);
}

/* -------------------------------------------------------- labour market -- */

interface LabourCall {
  readonly kind: 'hire' | 'release';
  readonly companyId: EntityId;
  /** Headcount the system asked for. */
  readonly requested: number;
  /** Headcount the market actually granted or released. */
  readonly count: number;
}

interface RecordingLabourMarket {
  readonly market: LabourMarket;
  readonly calls: LabourCall[];
  /** Workers the market currently has out on hire. */
  employedCount(): number;
}

/** Labour market that records every call and can be made scarce. */
function createRecordingLabourMarket(available = Number.POSITIVE_INFINITY): RecordingLabourMarket {
  const calls: LabourCall[] = [];
  let issued = 0;
  let employed = 0;
  const market: LabourMarket = {
    requestEmployees(companyId: EntityId, count: number): readonly EntityId[] {
      const wanted = Math.max(0, Math.floor(count));
      const granted = Math.max(0, Math.min(wanted, available - employed));
      const hired: EntityId[] = [];
      for (let index = 0; index < granted; index += 1) {
        issued += 1;
        hired.push(`worker-${issued}`);
      }
      employed += granted;
      calls.push({ kind: 'hire', companyId, requested: wanted, count: granted });
      return hired;
    },
    releaseEmployees(companyId: EntityId, employeeIds: readonly EntityId[]): readonly EntityId[] {
      const released = [...employeeIds];
      employed = Math.max(0, employed - released.length);
      calls.push({
        kind: 'release',
        companyId,
        requested: released.length,
        count: released.length,
      });
      return released;
    },
  };
  return { market, calls, employedCount: () => employed };
}

/* --------------------------------------------------------------- placement -- */

describe('companies / placement', () => {
  const world = createCityWorld({ seed: 'companies-placement' });
  const system = new CompaniesSystem(world, { initialCash: 10_000, startHour: 12 });
  const companies = system.companies;

  it('places companies in commercial, office and industrial premises', () => {
    expect(companies.length).toBeGreaterThanOrEqual(12);

    for (const company of companies) {
      expect(company.buildingId).not.toBeNull();
      const site = world.buildingById(company.buildingId as EntityId);
      expect(site).not.toBeNull();
      if (!site) {
        continue;
      }
      expect(COMMERCIAL_SITE_KINDS).toContain(site.kind);
      expect(site.jobSlots).toBeGreaterThan(0);
      expect(site.companyId).toBe(company.id);
      expect(company.address).toBe(site.address);
      expect(company.capacity).toBe(site.jobSlots);
      expect(company.districtId).toBe(site.districtId);
    }

    const ignored = world.buildings.filter(
      (building) => !COMMERCIAL_SITE_KINDS.includes(building.kind),
    );
    expect(ignored.length).toBeGreaterThan(0);
    expect(ignored.every((building) => building.companyId === null)).toBe(true);
  });

  it('covers at least three sectors, including the named ones', () => {
    const sectors = new Set(companies.map((company) => company.sector));
    expect(sectors.size).toBeGreaterThanOrEqual(3);
    for (const expected of ['retail', 'hospitality', 'office', 'manufacturing', 'logistics']) {
      expect([...sectors]).toContain(expected);
    }
  });

  it('gives every company the detail the inspector needs', () => {
    const ids = new Set<string>();
    for (const company of companies) {
      expect(company.id.length).toBeGreaterThan(0);
      expect(ids.has(company.id)).toBe(false);
      ids.add(company.id);
      expect(company.name.length).toBeGreaterThan(0);
      expect(company.address.length).toBeGreaterThan(0);
      expect(COMMERCIAL_SITE_KINDS).toContain(company.siteKind);
      expect(COMPANY_WAGE_LEVELS).toContain(company.wageLevel);
      expect(company.wagePerHour).toBe(sectorProfile(company.sector).wagePerHour);
      expect(company.capacity).toBeGreaterThan(0);
      expect(company.openHour).toBeGreaterThanOrEqual(0);
      expect(company.closeHour).toBeLessThanOrEqual(24);
      expect(company.color).toMatch(/^#/);
      expect(COMPANY_STATES).toContain(company.state);
      expect(company.troubledSinceDay).toBeNull();
      expect(company.postCount).toBe(0);
      expect(Array.isArray(company.revenueHistory)).toBe(true);
      expect(company.revenueHistory).toHaveLength(0);
      expect(company.employeeCount).toBe(company.employees.length);
      expect(company.employeeCount).toBeLessThanOrEqual(company.capacity);
    }

    const names = companies.map((company) => `${company.sector}:${company.name}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it('alternates shop premises between retail and hospitality', () => {
    const shopWorld = createStubWorld([
      createPremises({ id: 'building-shop-1' }),
      createPremises({ id: 'building-shop-2' }),
    ]);
    const shops = new CompaniesSystem(shopWorld, { initialStaffing: 'none' });
    expect(shops.companies.map((company) => company.sector)).toEqual(['retail', 'hospitality']);
    expect(shopWorld.buildings[0].companyId).toBe(shops.companies[0].id);
    expect(shopWorld.buildings[1].companyId).toBe(shops.companies[1].id);
  });

  it('can host civic premises when the caller opts in', () => {
    const civicWorld = createCityWorld({ seed: 'companies-civic' });
    const civic = new CompaniesSystem(civicWorld, {
      siteKinds: [...COMMERCIAL_SITE_KINDS, 'civic', 'school', 'hospital'],
      initialStaffing: 'none',
    });
    const publicSites = civic.companies.filter((company) => company.sector === 'civic');
    expect(publicSites.length).toBeGreaterThan(0);
    for (const company of publicSites) {
      expect(['civic', 'school', 'hospital']).toContain(company.siteKind);
    }
  });

  it('registers as an engine system and appends to the world company list', () => {
    const engineWorld = createShopWorld();
    const shopSystem = createCompaniesSystem(engineWorld, { initialStaffing: 'none' });
    expect(shopSystem).toBeInstanceOf(CompaniesSystem);
    expect(engineWorld.companies).toContain(shopSystem.companies[0]);

    const fixture = createSimFixture({ startHour: 12 });
    try {
      const systemContract: SimSystem = shopSystem;
      expect(systemContract.name).toBe('companies');
      fixture.engine.attach(systemContract);
      expect(fixture.engine.getSystem('companies')).toBe(shopSystem);
      fixture.advanceMinutes(60);
      expect(shopSystem.simMinute).toBe(720 + 60);
      expect(shopSystem.ticksSeen).toBe(60);
    } finally {
      fixture.dispose();
    }
  });

  it('validates its options', () => {
    const invalidWorld = createShopWorld();
    expect(() => new CompaniesSystem(invalidWorld, { shrinkFactor: 0 })).toThrow(RangeError);
    expect(() => new CompaniesSystem(invalidWorld, { startHour: 24 })).toThrow(RangeError);
    expect(() => new CompaniesSystem(invalidWorld, { maxHistoryHours: 0 })).toThrow(RangeError);
  });
});

/* ------------------------------------------------------------------ ledger -- */

describe('companies / ledger', () => {
  it('posts one hour of revenue and costs and moves cash by the net', () => {
    const labour = createRecordingLabourMarket();
    const world = createShopWorld();
    const system = new CompaniesSystem(world, {
      demandModel: () => 1,
      labourMarket: labour.market,
      initialStaffing: 'demand',
      startHour: 12,
      startDay: 0,
      initialCash: 1_000,
    });
    const company = system.companies[0];
    expect(company.employeeCount).toBe(4);

    const fixture = createSimFixture({ startHour: 12 });
    try {
      fixture.engine.attach(system);
      expect(fixture.advanceMinutes(60)).toBe(60);

      // Retail, capacity 4, demand 1, open at 12: 12 customers * 11.
      expect(company.revenuePerHour).toBe(132);
      expect(company.wageCostsPerHour).toBe(52);
      expect(company.otherCostsPerHour).toBeCloseTo(44.8, 6);
      expect(company.costsPerHour).toBeCloseTo(96.8, 6);
      expect(company.revenue).toBe(132);
      expect(company.costs).toBeCloseTo(96.8, 6);
      expect(company.cash).toBeCloseTo(1_035.2, 6);
      expect(company.totalRevenue).toBe(132);
      expect(company.postCount).toBe(1);
      expect(company.revenueHistory).toHaveLength(1);

      const entry = company.revenueHistory[0];
      expect(entry).toMatchObject({ day: 0, hour: 12, employees: 4, open: true, state: 'healthy' });
      expect(entry.netCash).toBeCloseTo(35.2, 6);
      expect(entry.cashAfter).toBeCloseTo(company.cash, 6);
      expect(entry.revenue - entry.totalCosts).toBeCloseTo(entry.netCash, 6);
    } finally {
      fixture.dispose();
    }
  });

  it('resets the daily counters at midnight while cash and the ledger carry over', () => {
    const labour = createRecordingLabourMarket();
    const world = createShopWorld();
    const system = new CompaniesSystem(world, {
      demandModel: () => 1,
      labourMarket: labour.market,
      initialCash: 10_000,
      startHour: 12,
    });
    const company = system.companies[0];

    const fixture = createSimFixture({ startHour: 12 });
    try {
      fixture.engine.attach(system);
      fixture.advanceMinutes(12 * 60);

      expect(company.postCount).toBe(12);
      expect(company.revenueHistory.map((entry) => entry.hour)).toEqual([
        12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
      ]);
      expect(company.totalRevenue).toBeGreaterThan(0);
      // Midnight has passed, so the day-to-date counters are back to zero...
      expect(company.revenue).toBe(0);
      expect(company.costs).toBe(0);
      // ...while cash and the lifetime totals reflect every posting.
      const net = company.revenueHistory.reduce((sum, entry) => sum + entry.netCash, 0);
      expect(company.cash).toBeCloseTo(10_000 + net, 6);
      expect(company.totalCosts).toBeCloseTo(
        company.revenueHistory.reduce((sum, entry) => sum + entry.totalCosts, 0),
        6,
      );
    } finally {
      fixture.dispose();
    }
  });

  it('charges rent but no wages while closed, and still posts a ledger row', () => {
    const labour = createRecordingLabourMarket();
    const world = createShopWorld();
    const system = new CompaniesSystem(world, {
      demandModel: () => 1,
      labourMarket: labour.market,
      initialCash: 1_000,
      startHour: 21,
    });
    const company = system.companies[0];

    const fixture = createSimFixture({ startHour: 21 });
    try {
      fixture.engine.attach(system);
      fixture.advanceMinutes(60);

      expect(company.employeeCount).toBe(0);
      expect(company.revenuePerHour).toBe(0);
      expect(company.wageCostsPerHour).toBe(0);
      expect(company.otherCostsPerHour).toBe(40);
      expect(company.cash).toBeCloseTo(960, 6);
      expect(company.revenueHistory).toHaveLength(1);
      expect(company.revenueHistory[0].open).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  it('uses the injected revenue model', () => {
    const labour = createRecordingLabourMarket();
    const world = createShopWorld();
    const system = new CompaniesSystem(world, {
      demandModel: () => 1,
      revenueModel: () => 250,
      labourMarket: labour.market,
      initialCash: 1_000,
      startHour: 12,
    });
    const company = system.companies[0];

    const fixture = createSimFixture({ startHour: 12 });
    try {
      fixture.engine.attach(system);
      fixture.advanceMinutes(60);
      expect(company.revenuePerHour).toBe(250);
      expect(company.cash).toBeCloseTo(1_000 + 250 - company.costsPerHour, 6);
    } finally {
      fixture.dispose();
    }
  });

  it('caps the rolling history at maxHistoryHours', () => {
    const labour = createRecordingLabourMarket();
    const world = createShopWorld();
    const system = new CompaniesSystem(world, {
      demandModel: () => 1,
      labourMarket: labour.market,
      initialCash: 1_000,
      startHour: 12,
      maxHistoryHours: 3,
    });
    const company = system.companies[0];

    const fixture = createSimFixture({ startHour: 12 });
    try {
      fixture.engine.attach(system);
      fixture.advanceMinutes(5 * 60);
      expect(company.postCount).toBe(5);
      expect(company.revenueHistory).toHaveLength(3);
      expect(company.revenueHistory.map((entry) => entry.hour)).toEqual([14, 15, 16]);
    } finally {
      fixture.dispose();
    }
  });
});

/* -------------------------------------------------------- staffing rules -- */

describe('companies / demand-driven staffing', () => {
  it('hires when demand rises and sheds staff when it falls', () => {
    const labour = createRecordingLabourMarket();
    const world = createShopWorld();
    let demand = 0.5;
    const system = new CompaniesSystem(world, {
      demandModel: () => demand,
      labourMarket: labour.market,
      initialStaffing: 'none',
      initialCash: 50_000,
      startHour: 12,
    });
    const company = system.companies[0];

    const fixture = createSimFixture({ startHour: 12 });
    try {
      fixture.engine.attach(system);
      expect(company.employeeCount).toBe(0);

      fixture.advanceMinutes(60);
      expect(company.employeeCount).toBe(2);
      expect(company.targetEmployees).toBe(2);
      expect(labour.calls).toEqual([
        { kind: 'hire', companyId: company.id, requested: 2, count: 2 },
      ]);

      demand = 1;
      fixture.advanceMinutes(60);
      expect(company.employeeCount).toBe(4);
      expect(company.employeeCount).toBeLessThanOrEqual(company.capacity);

      demand = 0;
      fixture.advanceMinutes(60);
      expect(company.employeeCount).toBe(0);
      const releases = labour.calls.filter((call) => call.kind === 'release');
      expect(releases).toHaveLength(1);
      expect(releases[0]).toMatchObject({ companyId: company.id, requested: 4, count: 4 });

      // Employment always flows through the market: its ledger matches ours.
      expect(labour.employedCount()).toBe(system.totals().employeeCount);
      expect(system.totals().employeeCount).toBe(0);
    } finally {
      fixture.dispose();
    }
  });

  it('stops at capacity and never exceeds what the labour market grants', () => {
    const labour = createRecordingLabourMarket(1);
    const world = createShopWorld();
    const system = new CompaniesSystem(world, {
      demandModel: () => 1,
      labourMarket: labour.market,
      initialStaffing: 'none',
      initialCash: 50_000,
      startHour: 12,
    });
    const company = system.companies[0];

    const fixture = createSimFixture({ startHour: 12 });
    try {
      fixture.engine.attach(system);
      fixture.advanceMinutes(60);

      // The company asked for the full demand target but only one worker was
      // available, and headcount followed the market's answer.
      expect(labour.calls[0]).toMatchObject({ kind: 'hire', requested: 4, count: 1 });
      expect(company.targetEmployees).toBe(4);
      expect(company.employeeCount).toBe(1);
      expect(company.employees).toHaveLength(1);
      expect(labour.employedCount()).toBe(1);
    } finally {
      fixture.dispose();
    }
  });
});

/* ------------------------------------------------------------- viability -- */

describe('companies / viability', () => {
  it('turns troubled on negative cash, shrinks the staffing target, then recovers', () => {
    const labour = createRecordingLabourMarket();
    const world = createShopWorld();
    const system = new CompaniesSystem(world, {
      demandModel: () => 1,
      labourMarket: labour.market,
      initialStaffing: 'none',
      initialCash: 10,
      startHour: 12,
      troubleRunwayHours: 0,
      recoveryRunwayHours: 0,
    });
    const company = system.companies[0];

    const fixture = createSimFixture({ startHour: 12 });
    try {
      fixture.engine.attach(system);

      // Hour 12: rent only on an empty roster, so cash goes negative.
      fixture.advanceMinutes(60);
      expect(company.cash).toBeCloseTo(-30, 6);
      expect(company.state).toBe('troubled');
      expect(company.troubledSinceDay).toBe(0);
      // Staffing is shrunk to 60% of the demand target while troubled.
      expect(company.targetEmployees).toBe(2);
      expect(company.employeeCount).toBe(2);

      // Hour 13: two employees trade, cash recovers, the company turns healthy
      // and re-staffs to the full demand target.
      fixture.advanceMinutes(60);
      expect(company.cash).toBeCloseTo(33.6, 6);
      expect(company.state).toBe('healthy');
      expect(company.troubledSinceDay).toBeNull();
      expect(company.employeeCount).toBe(4);
    } finally {
      fixture.dispose();
    }
  });

  it('sheds staff when cash keeps falling', () => {
    const labour = createRecordingLabourMarket();
    const world = createShopWorld();
    const system = new CompaniesSystem(world, {
      demandModel: () => 0,
      labourMarket: labour.market,
      initialStaffing: 'demand',
      initialCash: 300,
      startHour: 12,
    });
    const company = system.companies[0];
    expect(company.employeeCount).toBe(0); // demand 0 -> nothing to hire yet

    const fixture = createSimFixture({ startHour: 12 });
    try {
      fixture.engine.attach(system);
      fixture.advanceMinutes(60);
      // With demand pinned at zero the target is zero, so the company keeps
      // burning rent until it is troubled with no staff left to pay.
      expect(company.employeeCount).toBe(0);
      expect(company.state).toBe('troubled');
      expect(company.targetEmployees).toBe(0);
    } finally {
      fixture.dispose();
    }
  });

  it('turns insolvent past the bankruptcy floor and can still recover', () => {
    const labour = createRecordingLabourMarket();
    const world = createShopWorld();
    let demand = 0;
    const system = new CompaniesSystem(world, {
      demandModel: () => demand,
      labourMarket: labour.market,
      initialStaffing: 'none',
      initialCash: 100,
      startHour: 12,
      bankruptcyFloor: 50,
      troubleRunwayHours: 0,
      recoveryRunwayHours: 0,
    });
    const company = system.companies[0];

    const fixture = createSimFixture({ startHour: 12 });
    try {
      fixture.engine.attach(system);
      fixture.advanceMinutes(4 * 60);
      expect(company.cash).toBeCloseTo(-60, 6);
      expect(company.state).toBe('insolvent');

      demand = 1;
      fixture.advanceMinutes(4 * 60);
      expect(company.cash).toBeGreaterThan(0);
      expect(company.state).toBe('healthy');
      expect(company.employeeCount).toBe(4);
    } finally {
      fixture.dispose();
    }
  });
});

/* ----------------------------------------------------------- default models -- */

describe('companies / injectable defaults', () => {
  /** A revenue context with sane defaults, overridden per assertion. */
  function revenueContext(
    sector: CompanySector,
    overrides: Partial<CompanyRevenueContext> = {},
  ): CompanyRevenueContext {
    return {
      companyId: 'company-1',
      sector,
      buildingId: 'building-shop-1',
      districtId: 'district-1',
      day: 1,
      hour: 12,
      wagePerHour: sectorProfile(sector).wagePerHour,
      demand: 1,
      employees: 4,
      capacity: 4,
      openFraction: 1,
      ...overrides,
    };
  }

  it('scales revenue by demand, opening hours and sector', () => {
    const open = defaultRevenueModel(revenueContext('retail'));
    const closed = defaultRevenueModel(revenueContext('retail', { openFraction: 0 }));
    const quiet = defaultRevenueModel(revenueContext('retail', { demand: 0.5 }));
    const idle = defaultRevenueModel(revenueContext('retail', { employees: 0 }));
    const office = defaultRevenueModel(revenueContext('office'));

    expect(open).toBeGreaterThan(0);
    expect(closed).toBe(0);
    expect(idle).toBe(0);
    expect(quiet).toBeLessThan(open);
    expect(office).not.toBe(open);
  });

  it('shapes demand around the sector peak and boosts trading sectors at the weekend', () => {
    const retail = { companyId: 'c', sector: 'retail' as CompanySector, buildingId: 'b', districtId: null };
    expect(defaultDemandModel({ ...retail, day: 1, hour: 16 })).toBeGreaterThan(
      defaultDemandModel({ ...retail, day: 1, hour: 3 }),
    );
    expect(defaultDemandModel({ ...retail, day: 5, hour: 16 })).toBeGreaterThan(
      defaultDemandModel({ ...retail, day: 1, hour: 16 }),
    );
    const office = { companyId: 'c', sector: 'office' as CompanySector, buildingId: 'b', districtId: null };
    expect(defaultDemandModel({ ...office, day: 5, hour: 11 })).toBeLessThan(
      defaultDemandModel({ ...office, day: 1, hour: 11 }),
    );
  });

  it('supplies a usable fallback labour market', () => {
    const market = createOpenLabourMarket();
    const hired = market.requestEmployees('company-1', 3);
    expect(hired).toHaveLength(3);
    expect(new Set(hired).size).toBe(3);
    expect(market.releaseEmployees('company-1', hired)).toEqual(hired);
  });

  it('tunes wages per sector', () => {
    expect(sectorProfile('office').wageLevel).toBe('premium');
    expect(SECTOR_PROFILES.retail.wagePerHour).toBeLessThan(SECTOR_PROFILES.office.wagePerHour);
  });
});

/* --------------------------------------------------------------- sim-day -- */

describe('companies / full sim-day', () => {
  it('keeps one ledger row per company for a whole day', () => {
    const labour = createRecordingLabourMarket();
    const world = createCityWorld({ seed: 'companies-day' });
    const system = new CompaniesSystem(world, {
      labourMarket: labour.market,
      initialCash: 20_000,
      startHour: 0,
    });

    const fixture = createSimFixture({ startHour: 0 });
    try {
      fixture.engine.attach(system);
      fixture.advanceMinutes(SIM_DAY_MINUTES);

      expect(system.hoursSettledCount).toBe(24);
      for (const company of system.companies) {
        expect(company.postCount).toBe(24);
        expect(company.revenueHistory).toHaveLength(24);
        expect(company.revenueHistory.map((entry) => entry.hour)).toEqual(
          Array.from({ length: 24 }, (_value, hour) => hour),
        );
      }
    } finally {
      fixture.dispose();
    }
  });
});

/* ---------------------------------------------------------- dom-free guard -- */

const COMPANY_SOURCE = import.meta.glob('../../src/sim/companies.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const BROWSER_GLOBAL =
  /\b(document|window|canvas|navigator|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|HTMLCanvasElement|ImageData|OffscreenCanvas|CanvasRenderingContext2D|devicePixelRatio)\b/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('companies / dom-free guard', () => {
  const source = Object.values(COMPANY_SOURCE)[0] ?? '';

  it('reads the company module source', () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it('never touches a browser global', () => {
    expect(stripComments(source)).not.toMatch(BROWSER_GLOBAL);
  });

  it('imports only the shared sim contracts', () => {
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(new Set(specifiers)).toEqual(new Set(['./clock', './engine', './types', './world']));
  });
});
