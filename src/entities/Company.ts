/**
 * Company entity.
 *
 * Spec reference: §7.4 Economy.
 *
 * A company is the operational unit of the economy: a building of a
 * given `buildingTypeId` (from `BUILDING_TYPES`) staffed by up to
 * `maxEmployees` citizens. It tracks its open/closed lifecycle, the
 * set of currently-employed citizen ids, and the accumulated
 * revenue/expenses ledger entries.
 *
 * The Company itself is pure data; mutations are immutable
 * (`open`/`close`/`hire`/`fire` return new Company instances) so the
 * event bus and React consumers can compare references cheaply.
 *
 * Layer rule: this file lives in `src/entities/`, which is
 * framework-agnostic. No React, no DOM, no engine imports.
 */

import type { CitizenId, CompanyId, Vector2 } from '@/types/common';
import { getBuildingType, type BuildingTypeDefinition } from '@/constants/building-types';

/** Status of a company over its lifetime. */
export type CompanyStatus = 'open' | 'closed';

/** A single line item in the daily ledger. */
export interface LedgerEntry {
  /** In-game day this entry belongs to. */
  day: number;
  /** Positive = revenue, negative = expense. */
  amount: number;
  /** Human-readable label, e.g. "revenue:office" or "wage:office". */
  label: string;
}

export interface Company {
  id: CompanyId;
  /** Catalog id pointing into BUILDING_TYPES. */
  buildingTypeId: string;
  /** World position of the building footprint. */
  position: Vector2;
  /** 'open' or 'closed'. A closed company does not generate revenue. */
  status: CompanyStatus;
  /** Citizens currently employed here (bounded by maxEmployees). */
  employees: readonly CitizenId[];
  /** Cumulative revenue earned, in dollars. */
  totalRevenue: number;
  /** Cumulative wages paid, in dollars. */
  totalWages: number;
  /** Cumulative tax paid to the city, in dollars. */
  totalTax: number;
  /** Running tally of the most recent N ledger entries. */
  ledger: readonly LedgerEntry[];
  /** In-game day the company was opened on. */
  openedOnDay: number;
}

/** Parameters accepted by `createCompany`. */
export interface CreateCompanyParams {
  id: CompanyId;
  buildingTypeId: string;
  position: Vector2;
  openedOnDay?: number;
  /** Optional id factory for stable tests. Unused at runtime. */
}

/**
 * Build a new Company. Validates that `buildingTypeId` is known and
 * initialises empty employees + zeroed counters.
 */
export function createCompany(params: CreateCompanyParams): Company {
  const def = getBuildingType(params.buildingTypeId);
  if (def === undefined) {
    throw new Error(`Unknown buildingTypeId: ${params.buildingTypeId}`);
  }
  return {
    id: params.id,
    buildingTypeId: params.buildingTypeId,
    position: { ...params.position },
    status: 'open',
    employees: Object.freeze([]) as readonly CitizenId[],
    totalRevenue: 0,
    totalWages: 0,
    totalTax: 0,
    ledger: Object.freeze([]) as readonly LedgerEntry[],
    openedOnDay: params.openedOnDay ?? 0,
  };
}

/**
 * Return the catalog definition for a Company. Convenience wrapper
 * for callers that already have a `Company` and want its type
 * details without re-typing the lookup.
 */
export function getCompanyDefinition(company: Company): BuildingTypeDefinition {
  const def = getBuildingType(company.buildingTypeId);
  if (def === undefined) {
    // Should be unreachable: createCompany validates the id.
    throw new Error(`Company ${company.id} references unknown type ${company.buildingTypeId}`);
  }
  return def;
}

/**
 * Transition a Company to 'open'. Idempotent: a Company that is
 * already open is returned unchanged.
 */
export function openCompany(company: Company): Company {
  if (company.status === 'open') return company;
  return { ...company, status: 'open' };
}

/**
 * Transition a Company to 'closed'. Idempotent: a Company that is
 * already closed is returned unchanged. The caller is responsible
 * for emitting the `company_closed` event with the appropriate
 * `reason`.
 */
export function closeCompany(company: Company): Company {
  if (company.status === 'closed') return company;
  return { ...company, status: 'closed' };
}

/**
 * Add `citizenId` to the company's employees. Returns the company
 * unchanged when:
 *   - the company is closed
 *   - the citizen is already employed
 *   - the company is at maxEmployees
 */
export function hireEmployee(company: Company, citizenId: CitizenId): Company {
  if (company.status === 'closed') return company;
  if (company.employees.includes(citizenId)) return company;
  const def = getCompanyDefinition(company);
  if (company.employees.length >= def.maxEmployees) return company;
  return { ...company, employees: Object.freeze([...company.employees, citizenId]) as readonly CitizenId[] };
}

/**
 * Remove `citizenId` from the company's employees. Returns the
 * company unchanged when the citizen is not employed there.
 */
export function fireEmployee(company: Company, citizenId: CitizenId): Company {
  if (!company.employees.includes(citizenId)) return company;
  return {
    ...company,
    employees: Object.freeze(company.employees.filter((id) => id !== citizenId)) as readonly CitizenId[],
  };
}

/**
 * Append a ledger entry. Trims the ledger to the most recent 64
 * entries to bound memory usage in long-running sessions.
 */
export function appendLedger(company: Company, entry: LedgerEntry): Company {
  const next = [...company.ledger, entry];
  if (next.length > 64) next.splice(0, next.length - 64);
  return { ...company, ledger: Object.freeze(next) as readonly LedgerEntry[] };
}

/**
 * Apply a financial delta. Positive `amount` increments
 * `totalRevenue`; negative decrements `totalRevenue`. `label` is
 * stored on the ledger entry.
 */
export function recordTransaction(company: Company, day: number, amount: number, label: string): Company {
  let next: Company;
  if (amount >= 0) {
    next = { ...company, totalRevenue: company.totalRevenue + amount };
  } else {
    // Treat negative deltas as wage/tax outflows.
    if (label.startsWith('wage')) {
      next = { ...company, totalWages: company.totalWages + Math.abs(amount) };
    } else if (label.startsWith('tax')) {
      next = { ...company, totalTax: company.totalTax + Math.abs(amount) };
    } else {
      next = { ...company, totalRevenue: company.totalRevenue + amount };
    }
  }
  return appendLedger(next, { day, amount, label });
}

/** Type guard: returns true when the value looks like a Company. */
export function isCompany(value: unknown): value is Company {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string') return false;
  if (typeof v.buildingTypeId !== 'string') return false;
  if (v.position === null || typeof v.position !== 'object') return false;
  const pos = v.position as Record<string, unknown>;
  if (typeof pos.x !== 'number' || typeof pos.y !== 'number') return false;
  if (v.status !== 'open' && v.status !== 'closed') return false;
  if (!Array.isArray(v.employees)) return false;
  for (const id of v.employees) {
    if (typeof id !== 'string') return false;
  }
  if (typeof v.totalRevenue !== 'number') return false;
  if (typeof v.totalWages !== 'number') return false;
  if (typeof v.totalTax !== 'number') return false;
  if (!Array.isArray(v.ledger)) return false;
  if (typeof v.openedOnDay !== 'number') return false;
  return true;
}
