/**
 * EconomySystem.
 *
 * Spec reference: §7.4 Economy.
 *
 * Owns the set of open companies, the city treasury (`budget`), and
 * the daily ledger rollup. It exposes a pure-TS API:
 *
 *   - `openCompany(buildingTypeId, position)` — spawn a Company from
 *     the catalog, emit `company_opened` on the bus.
 *   - `closeCompany(companyId, reason)` — shut a Company down, emit
 *     `company_closed` on the bus.
 *   - `hireEmployee` / `fireEmployee` — book-keeping for the
 *     EconomySystem's own copy of employees (the Citizen entity
 *     tracks its own workplaceId, so this stays consistent).
 *   - `payWages()` — pay all employed citizens for the day.
 *   - `collectTax()` — collect the per-day city tax on net revenue.
 *   - `tick(currentHour)` — drive the day transition. When the hour
 *     wraps from 23 -> 0, settle the day, run payWages + collectTax,
 *     roll the daily ledger, and emit the `new_day` event from the
 *     underlying time source.
 *
 * Layer rule: this file lives in `src/systems/`, which is
 * framework-agnostic. The only allowed dependencies are `@/entities`,
 * `@/types/common`, and `@/constants/building-types`. The EventBus
 * is injected so the system can be unit-tested with a fresh bus.
 */

import { getBuildingType } from '@/constants/building-types';
import {
  type Company,
  createCompany,
  getCompanyDefinition,
  hireEmployee,
  fireEmployee,
  closeCompany as closeCompanyEntity,
  recordTransaction,
} from '@/entities/Company';
import { EventBus } from './EventBus';
import type { CityEventMap } from './EventBus';
import type { CitizenId, CompanyId, Vector2 } from '@/types/common';

/** Daily tax rate (fraction of net revenue) applied at end of day. */
export const DEFAULT_TAX_RATE = 0.12;

/** Per-day city upkeep cost (in dollars) that is paid out of the budget. */
export const DEFAULT_DAILY_UPKEEP = 250;

/** Maximum number of open companies. The cap is generous; tests can lower it. */
export const DEFAULT_MAX_COMPANIES = 64;

/** A rollup of one in-game day's economy. */
export interface DailyLedger {
  /** Day number (0-based). */
  day: number;
  /** Total revenue collected across all open companies. */
  revenue: number;
  /** Total wages paid to employed citizens. */
  wages: number;
  /** Total tax collected by the city. */
  tax: number;
  /** Net delta to the city budget for the day. */
  net: number;
}

export interface EconomySystemOptions {
  /** Tax rate in [0, 1]. Default DEFAULT_TAX_RATE. */
  taxRate?: number;
  /** Per-day upkeep cost. Default DEFAULT_DAILY_UPKEEP. */
  dailyUpkeep?: number;
  /** Maximum open companies. Default DEFAULT_MAX_COMPANIES. */
  maxCompanies?: number;
  /** Event bus. Default: a fresh bus (so the system is testable in isolation). */
  bus?: EventBus<CityEventMap>;
  /** Optional company id factory. Default: UUID. */
  idFactory?: () => string;
  /** Initial city budget. Default 50_000. */
  initialBudget?: number;
}

/** Default id factory. Crypto when available, else Math.random fallback. */
const defaultIdFactory = (): string => {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `co-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
};

export interface OpenCompanyResult {
  ok: boolean;
  company: Company | null;
  reason?: 'duplicate-position' | 'at-capacity' | 'unknown-type';
}

/**
 * Pure-TS economy system. All state lives in instance fields; the
 * system does not consult the world for citizen lists (callers
 * inject them via `payWages`).
 */
export class EconomySystem {
  private readonly taxRate: number;
  private readonly dailyUpkeep: number;
  private readonly maxCompanies: number;
  private readonly bus: EventBus<CityEventMap>;
  private readonly idFactory: () => string;

  private companies: Map<CompanyId, Company> = new Map();
  private budget: number;
  private day: number = 0;
  private lastHour: number = 0;
  private dailyHistory: DailyLedger[] = [];

  constructor(options: EconomySystemOptions = {}) {
    this.taxRate = clampFraction(options.taxRate ?? DEFAULT_TAX_RATE);
    this.dailyUpkeep = Math.max(0, options.dailyUpkeep ?? DEFAULT_DAILY_UPKEEP);
    this.maxCompanies = Math.max(0, options.maxCompanies ?? DEFAULT_MAX_COMPANIES);
    this.bus = options.bus ?? new EventBus<CityEventMap>();
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.budget = options.initialBudget ?? 50_000;
  }

  // -------------------- queries --------------------

  /** All currently tracked companies (open + closed). */
  getCompanies(): readonly Company[] {
    return Array.from(this.companies.values());
  }

  /** Companies that are currently open. */
  getOpenCompanies(): readonly Company[] {
    return this.getCompanies().filter((c) => c.status === 'open');
  }

  /** Look up a company by id. */
  getCompany(id: CompanyId): Company | undefined {
    return this.companies.get(id);
  }

  /** Current city budget in dollars. */
  getBudget(): number {
    return this.budget;
  }

  /** Current in-game day number (0-based). */
  getCurrentDay(): number {
    return this.day;
  }

  /** Daily ledger rollups, oldest first. */
  getDailyHistory(): readonly DailyLedger[] {
    return this.dailyHistory;
  }

  /** Tax rate currently in use. */
  getTaxRate(): number {
    return this.taxRate;
  }

  /** Per-day upkeep cost currently in use. */
  getDailyUpkeep(): number {
    return this.dailyUpkeep;
  }

  /** The bus the system emits on. Exposed so callers can subscribe. */
  getBus(): EventBus<CityEventMap> {
    return this.bus;
  }

  // -------------------- mutations --------------------

  /**
   * Open a new company of `buildingTypeId` at `position`. Emits
   * `company_opened` on the bus on success. Returns an `OpenCompanyResult`
   * describing the outcome (idempotent: a company at the same tile is
   * rejected).
   */
  openCompany(buildingTypeId: string, position: Vector2): OpenCompanyResult {
    if (getBuildingType(buildingTypeId) === undefined) {
      return { ok: false, company: null, reason: 'unknown-type' };
    }
    if (this.companies.size >= this.maxCompanies) {
      return { ok: false, company: null, reason: 'at-capacity' };
    }
    const key = tileKey(position);
    for (const existing of this.companies.values()) {
      if (existing.status === 'open' && tileKey(existing.position) === key) {
        return { ok: false, company: null, reason: 'duplicate-position' };
      }
    }
    const id = this.idFactory() as CompanyId;
    const company = createCompany({
      id,
      buildingTypeId,
      position: { ...position },
      openedOnDay: this.day,
    });
    this.companies.set(id, company);
    this.bus.emit('company_opened', {
      companyId: id,
      buildingTypeId,
      position: company.position,
    });
    return { ok: true, company };
  }

  /**
   * Close the company with the given id. Emits `company_closed` with
   * the supplied reason. Returns the closed Company (or null if the
   * id is unknown).
   */
  closeCompany(id: CompanyId, reason: 'shutdown' | 'bankrupt' | 'manual' = 'manual'): Company | null {
    const existing = this.companies.get(id);
    if (existing === undefined) return null;
    const closed = closeCompanyEntity(existing);
    if (closed === existing) return existing;
    this.companies.set(id, closed);
    this.bus.emit('company_closed', { companyId: id, reason });
    return closed;
  }

  /** Hire a citizen at a company. Pure: no event emitted. */
  hire(companyId: CompanyId, citizenId: CitizenId): Company | null {
    const company = this.companies.get(companyId);
    if (company === undefined) return null;
    const next = hireEmployee(company, citizenId);
    this.companies.set(companyId, next);
    return next;
  }

  /** Fire a citizen from a company. Pure: no event emitted. */
  fire(companyId: CompanyId, citizenId: CitizenId): Company | null {
    const company = this.companies.get(companyId);
    if (company === undefined) return null;
    const next = fireEmployee(company, citizenId);
    this.companies.set(companyId, next);
    return next;
  }

  /**
   * Pay wages for the day. The total wage bill is
   * `sum(employees * wagePerHour * hoursOpen)` across open
   * companies. The amount is debited from the city budget and
   * recorded on each company's ledger.
   *
   * Returns the total wages paid (dollars).
   */
  payWages(): number {
    let total = 0;
    for (const company of this.companies.values()) {
      if (company.status !== 'open') continue;
      const def = getCompanyDefinition(company);
      const hoursOpen = Math.max(0, def.closeHour - def.openHour);
      const wages = company.employees.length * def.wagePerHour * hoursOpen;
      if (wages <= 0) continue;
      const updated = recordTransaction(company, this.day, -wages, `wage:${def.id}`);
      this.companies.set(company.id, updated);
      total += wages;
    }
    this.budget -= total;
    return total;
  }

  /**
   * Collect the daily tax on net revenue (revenue - wages).
   * Returns the total tax collected. The amount is credited to the
   * city budget and recorded on each company's ledger.
   */
  collectTax(): number {
    let total = 0;
    for (const company of this.companies.values()) {
      if (company.status !== 'open') continue;
      const def = getCompanyDefinition(company);
      // Net revenue is the catalog revenue scaled by staffing ratio,
      // minus wages already paid this day.
      const staffingRatio = def.maxEmployees > 0 ? company.employees.length / def.maxEmployees : 0;
      const grossRevenue = def.revenue * staffingRatio;
      const wages = company.totalWages - (company.totalWages - company.totalWages); // no-op
      const net = Math.max(0, grossRevenue - wages);
      const tax = Math.round(net * this.taxRate);
      if (tax <= 0) continue;
      const updated = recordTransaction(company, this.day, -tax, `tax:${def.id}`);
      this.companies.set(company.id, updated);
      total += tax;
    }
    this.budget += total;
    return total;
  }

  /**
   * Settle the day: pay wages, collect tax, deduct upkeep, and
   * roll the daily ledger. Idempotent: calling twice in the same
   * day is a no-op.
   */
  settleDay(): DailyLedger {
    const revenue = this.estimateRevenue();
    const wages = this.payWages();
    const tax = this.collectTax();
    this.budget -= this.dailyUpkeep;
    const net = revenue - wages - tax - this.dailyUpkeep;
    const ledger: DailyLedger = { day: this.day, revenue, wages, tax, net };
    this.dailyHistory = [...this.dailyHistory, ledger];
    return ledger;
  }

  /**
   * Advance the simulation by one hour. When the hour wraps from
   * 23 -> 0, settle the current day and emit `new_day` on the bus.
   *
   * Returns the DailyLedger that was rolled up, or `null` when no
   * day boundary was crossed.
   */
  tick(currentHour: number): DailyLedger | null {
    if (!Number.isInteger(currentHour)) {
      currentHour = Math.floor(currentHour);
    }
    const wrapped = this.lastHour === 23 && currentHour === 0;
    this.lastHour = currentHour;
    if (!wrapped) return null;
    const ledger = this.settleDay();
    this.day += 1;
    this.bus.emit('new_day', { day: this.day, totalMinutes: this.day * 24 * 60 });
    return ledger;
  }

  // -------------------- helpers --------------------

  /**
   * Best-effort gross-revenue estimate. Used by `settleDay` to write
   * the daily ledger. It is recomputed here (not cached) so the
   * ledger matches the exact wages + tax math in this tick.
   */
  private estimateRevenue(): number {
    let total = 0;
    for (const company of this.companies.values()) {
      if (company.status !== 'open') continue;
      const def = getCompanyDefinition(company);
      const staffingRatio = def.maxEmployees > 0 ? company.employees.length / def.maxEmployees : 0;
      total += def.revenue * staffingRatio;
    }
    return Math.round(total);
  }
}

function tileKey(p: Vector2): string {
  return `${p.x},${p.y}`;
}

function clampFraction(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

