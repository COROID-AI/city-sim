/**
 * EconomySystem unit tests.
 *
 * Covers openCompany / closeCompany / payWages / collectTax, the
 * daily ledger rollup, and the bus emissions.
 */
import {
  type CompanyId,
  type CitizenId,
} from '@/types/common';
import { EconomySystem, DEFAULT_TAX_RATE, DEFAULT_DAILY_UPKEEP } from '@/systems/EconomySystem';
import { EventBus, type CityEventMap } from '@/systems/EventBus';

const coid = (s: string): CompanyId => s as CompanyId;
const cid = (s: string): CitizenId => s as CitizenId;

function makeEconomy(): { bus: EventBus<CityEventMap>; eco: EconomySystem } {
  const bus = new EventBus<CityEventMap>();
  const eco = new EconomySystem({
    bus,
    initialBudget: 100_000,
    idFactory: (() => {
      let n = 0;
      return (): string => `co-${++n}`;
    })(),
  });
  return { bus, eco };
}

describe('EconomySystem', () => {
  it('opens a company and emits company_opened', () => {
    const { bus, eco } = makeEconomy();
    const events: unknown[] = [];
    bus.on('company_opened', (p) => events.push(p));
    const result = eco.openCompany('shop', { x: 10, y: 20 });
    expect(result.ok).toBe(true);
    expect(result.company).not.toBeNull();
    expect(result.company?.buildingTypeId).toBe('shop');
    expect(events.length).toBe(1);
    expect((events[0] as { buildingTypeId: string }).buildingTypeId).toBe('shop');
  });

  it('rejects an unknown buildingTypeId', () => {
    const { eco } = makeEconomy();
    const result = eco.openCompany('not-a-type', { x: 0, y: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown-type');
  });

  it('rejects duplicate positions', () => {
    const { eco } = makeEconomy();
    eco.openCompany('shop', { x: 0, y: 0 });
    const second = eco.openCompany('office', { x: 0, y: 0 });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('duplicate-position');
  });

  it('honors maxCompanies', () => {
    const bus = new EventBus<CityEventMap>();
    const eco = new EconomySystem({ bus, maxCompanies: 2, idFactory: (() => {
      let n = 0;
      return (): string => `co-${++n}`;
    })() });
    eco.openCompany('shop', { x: 0, y: 0 });
    eco.openCompany('office', { x: 1, y: 0 });
    const third = eco.openCompany('farm', { x: 2, y: 0 });
    expect(third.ok).toBe(false);
    expect(third.reason).toBe('at-capacity');
  });

  it('closes a company and emits company_closed', () => {
    const { bus, eco } = makeEconomy();
    const opened = eco.openCompany('shop', { x: 0, y: 0 });
    const id = opened.company!.id;
    const reasons: string[] = [];
    bus.on('company_closed', (p) => reasons.push(p.reason));
    const closed = eco.closeCompany(id, 'shutdown');
    expect(closed).not.toBeNull();
    expect(closed?.status).toBe('closed');
    expect(reasons).toEqual(['shutdown']);
  });

  it('closeCompany is a no-op on unknown id', () => {
    const { eco } = makeEconomy();
    expect(eco.closeCompany(coid('nope'))).toBeNull();
  });

  it('hire + fire update the employee set', () => {
    const { eco } = makeEconomy();
    const opened = eco.openCompany('shop', { x: 0, y: 0 });
    const id = opened.company!.id;
    eco.hire(id, cid('a'));
    eco.hire(id, cid('b'));
    expect(eco.getCompany(id)?.employees.length).toBe(2);
    eco.fire(id, cid('a'));
    expect(eco.getCompany(id)?.employees.length).toBe(1);
  });

  it('payWages debits the budget and records wage entries', () => {
    const { eco } = makeEconomy();
    const opened = eco.openCompany('shop', { x: 0, y: 0 });
    const id = opened.company!.id;
    eco.hire(id, cid('a'));
    eco.hire(id, cid('b'));
    const before = eco.getBudget();
    const total = eco.payWages();
    expect(total).toBeGreaterThan(0);
    expect(eco.getBudget()).toBe(before - total);
    const company = eco.getCompany(id);
    expect(company?.totalWages).toBe(total);
    expect(company?.ledger.some((e) => e.label.startsWith('wage'))).toBe(true);
  });

  it('collectTax credits the budget and records tax entries', () => {
    const { eco } = makeEconomy();
    const opened = eco.openCompany('shop', { x: 0, y: 0 });
    eco.hire(opened.company!.id, cid('a'));
    eco.payWages();
    const before = eco.getBudget();
    const tax = eco.collectTax();
    expect(eco.getBudget()).toBe(before + tax);
  });

  it('settleDay rolls up a daily ledger entry', () => {
    const { eco } = makeEconomy();
    const opened = eco.openCompany('shop', { x: 0, y: 0 });
    eco.hire(opened.company!.id, cid('a'));
    const ledger = eco.settleDay();
    expect(ledger.day).toBe(0);
    expect(ledger.revenue).toBeGreaterThanOrEqual(0);
    expect(ledger.wages).toBeGreaterThanOrEqual(0);
    expect(ledger.tax).toBeGreaterThanOrEqual(0);
    expect(eco.getDailyHistory().length).toBe(1);
  });

  it('emits new_day on hour wrap from 23 to 0', () => {
    const { bus, eco } = makeEconomy();
    const days: number[] = [];
    bus.on('new_day', (p) => days.push(p.day));
    eco.tick(5);
    eco.tick(10);
    eco.tick(23);
    eco.tick(0); // wrap
    eco.tick(5);
    expect(days.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT emit new_day mid-day', () => {
    const { bus, eco } = makeEconomy();
    const fn = jest.fn();
    bus.on('new_day', fn);
    eco.tick(0);
    eco.tick(5);
    eco.tick(10);
    eco.tick(20);
    // No wrap from 23 -> 0 happened.
    expect(fn).not.toHaveBeenCalled();
  });

  it('exposes default tax + upkeep constants', () => {
    expect(DEFAULT_TAX_RATE).toBeGreaterThan(0);
    expect(DEFAULT_TAX_RATE).toBeLessThan(1);
    expect(DEFAULT_DAILY_UPKEEP).toBeGreaterThan(0);
  });

  it('clamps tax rate into [0, 1]', () => {
    const eco = new EconomySystem({ taxRate: 5 });
    expect(eco.getTaxRate()).toBe(1);
    const eco2 = new EconomySystem({ taxRate: -1 });
    expect(eco2.getTaxRate()).toBe(0);
  });

  it('getOpenCompanies filters by status', () => {
    const { eco } = makeEconomy();
    const a = eco.openCompany('shop', { x: 0, y: 0 });
    eco.openCompany('office', { x: 1, y: 0 });
    eco.closeCompany(a.company!.id, 'manual');
    expect(eco.getOpenCompanies().length).toBe(1);
  });
});
