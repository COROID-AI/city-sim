/**
 * Company + BUILDING_TYPES unit tests.
 */
import {
  type CompanyId,
  type CitizenId,
} from '@/types/common';
import {
  BUILDING_TYPES,
  getBuildingType,
  isBuildingTypeId,
} from '@/constants/building-types';
import {
  type Company,
  createCompany,
  openCompany,
  closeCompany,
  hireEmployee,
  fireEmployee,
  recordTransaction,
  appendLedger,
  isCompany,
} from '@/entities/Company';

const cid = (s: string): CitizenId => s as CitizenId;
const coid = (s: string): CompanyId => s as CompanyId;

describe('BUILDING_TYPES catalog', () => {
  it('has between 8 and 12 entries', () => {
    expect(BUILDING_TYPES.length).toBeGreaterThanOrEqual(8);
    expect(BUILDING_TYPES.length).toBeLessThanOrEqual(12);
  });

  it('every entry has the required fields', () => {
    for (const def of BUILDING_TYPES) {
      expect(typeof def.id).toBe('string');
      expect(def.id.length).toBeGreaterThan(0);
      expect(typeof def.name).toBe('string');
      expect(typeof def.type).toBe('string');
      expect(typeof def.color).toBe('string');
      expect(def.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(typeof def.revenue).toBe('number');
      expect(def.revenue).toBeGreaterThan(0);
      expect(typeof def.maxEmployees).toBe('number');
      expect(def.maxEmployees).toBeGreaterThan(0);
      expect(Number.isInteger(def.openHour)).toBe(true);
      expect(Number.isInteger(def.closeHour)).toBe(true);
      expect(def.openHour).toBeGreaterThanOrEqual(0);
      expect(def.openHour).toBeLessThanOrEqual(23);
      expect(def.closeHour).toBeGreaterThanOrEqual(0);
      expect(def.closeHour).toBeLessThanOrEqual(23);
      expect(typeof def.wagePerHour).toBe('number');
      expect(def.wagePerHour).toBeGreaterThan(0);
    }
  });

  it('ids are unique', () => {
    const ids = BUILDING_TYPES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getBuildingType returns the matching entry', () => {
    const def = getBuildingType('office');
    expect(def).toBeDefined();
    expect(def?.name).toBe('Office Tower');
  });

  it('isBuildingTypeId is a type guard', () => {
    expect(isBuildingTypeId('office')).toBe(true);
    expect(isBuildingTypeId('not-a-type')).toBe(false);
    expect(isBuildingTypeId(42)).toBe(false);
  });
});

describe('createCompany', () => {
  it('creates an open company with zero counters', () => {
    const company = createCompany({
      id: coid('co-1'),
      buildingTypeId: 'shop',
      position: { x: 10, y: 20 },
    });
    expect(company.status).toBe('open');
    expect(company.employees).toEqual([]);
    expect(company.totalRevenue).toBe(0);
    expect(company.totalWages).toBe(0);
    expect(company.totalTax).toBe(0);
    expect(company.ledger).toEqual([]);
    expect(company.position).toEqual({ x: 10, y: 20 });
  });

  it('throws on unknown buildingTypeId', () => {
    expect(() =>
      createCompany({
        id: coid('co-bad'),
        buildingTypeId: 'unknown',
        position: { x: 0, y: 0 },
      }),
    ).toThrow(/Unknown buildingTypeId/);
  });
});

describe('openCompany / closeCompany (entity helpers)', () => {
  function makeCompany(): Company {
    return createCompany({ id: coid('co-1'), buildingTypeId: 'shop', position: { x: 0, y: 0 } });
  }

  it('openCompany is idempotent', () => {
    const c = makeCompany();
    const opened = openCompany(c);
    expect(opened).toBe(c);
    const again = openCompany(opened);
    expect(again).toBe(opened);
  });

  it('closeCompany is idempotent', () => {
    const c = makeCompany();
    const closed = closeCompany(c);
    expect(closed.status).toBe('closed');
    expect(closed).not.toBe(c);
    const again = closeCompany(closed);
    expect(again).toBe(closed);
  });
});

describe('hireEmployee / fireEmployee', () => {
  function makeCompany(): Company {
    return createCompany({ id: coid('co-1'), buildingTypeId: 'shop', position: { x: 0, y: 0 } });
  }

  it('hires citizens up to maxEmployees', () => {
    let c = makeCompany();
    for (let i = 0; i < 6; i += 1) {
      c = hireEmployee(c, cid(`citizen-${i}`));
    }
    expect(c.employees.length).toBe(6);
  });

  it('rejects hires past maxEmployees', () => {
    let c = makeCompany();
    for (let i = 0; i < 6; i += 1) {
      c = hireEmployee(c, cid(`citizen-${i}`));
    }
    const overflow = hireEmployee(c, cid('citizen-99'));
    expect(overflow).toBe(c);
    expect(overflow.employees.length).toBe(6);
  });

  it('rejects hires on closed companies', () => {
    let c = makeCompany();
    c = closeCompany(c);
    const after = hireEmployee(c, cid('citizen-1'));
    expect(after.employees.length).toBe(0);
  });

  it('rejects duplicates', () => {
    let c = makeCompany();
    c = hireEmployee(c, cid('citizen-1'));
    const again = hireEmployee(c, cid('citizen-1'));
    expect(again.employees.length).toBe(1);
  });

  it('fires citizens', () => {
    let c = makeCompany();
    c = hireEmployee(c, cid('citizen-1'));
    c = fireEmployee(c, cid('citizen-1'));
    expect(c.employees).toEqual([]);
  });

  it('fireEmployee is a no-op when citizen is absent', () => {
    const c = makeCompany();
    const after = fireEmployee(c, cid('citizen-1'));
    expect(after).toBe(c);
  });
});

describe('recordTransaction / appendLedger', () => {
  function makeCompany(): Company {
    return createCompany({ id: coid('co-1'), buildingTypeId: 'office', position: { x: 0, y: 0 } });
  }

  it('records positive amounts as revenue', () => {
    const c = recordTransaction(makeCompany(), 0, 1000, 'revenue:office');
    expect(c.totalRevenue).toBe(1000);
    expect(c.ledger.length).toBe(1);
    expect(c.ledger[0]?.label).toBe('revenue:office');
  });

  it('records negative wage amounts as wages', () => {
    const c = recordTransaction(makeCompany(), 0, -500, 'wage:office');
    expect(c.totalWages).toBe(500);
    expect(c.totalRevenue).toBe(0);
  });

  it('records negative tax amounts as tax', () => {
    const c = recordTransaction(makeCompany(), 0, -100, 'tax:office');
    expect(c.totalTax).toBe(100);
  });

  it('trims the ledger to 64 entries', () => {
    let c = makeCompany();
    for (let i = 0; i < 80; i += 1) {
      c = recordTransaction(c, 0, 1, `entry-${i}`);
    }
    expect(c.ledger.length).toBe(64);
  });

  it('appendLedger keeps the ledger frozen (read-only)', () => {
    const c = appendLedger(makeCompany(), { day: 0, amount: 1, label: 'x' });
    expect(Object.isFrozen(c.ledger)).toBe(true);
  });
});

describe('isCompany type guard', () => {
  it('accepts a well-formed Company', () => {
    const c = createCompany({ id: coid('co-1'), buildingTypeId: 'farm', position: { x: 1, y: 1 } });
    expect(isCompany(c)).toBe(true);
  });

  it('rejects malformed objects', () => {
    expect(isCompany(null)).toBe(false);
    expect(isCompany({})).toBe(false);
    expect(isCompany({ id: 1 })).toBe(false);
  });
});
