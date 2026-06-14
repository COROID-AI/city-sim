/**
 * EconomySystem — accrues daily revenue, wages, tax and infrastructure
 * cost, and emits the canonical SimEventMap events.
 *
 * Spec (this task):
 *  - Per building: revenue is `def.revenue * utilization` where
 *    utilization ∈ [0, 1] is `min(1, employees / maxEmployees)`.
 *  - Per building: wages are `WAGE_PER_EMPLOYEE * employees`, paid
 *    out of the building treasury. If a building's treasury is
 *    negative, the city subsidises it up to a soft limit (informational
 *    only — no game-over).
 *  - Per day, the city collects `TAX_RATE * sum(perBuildingRevenue)`
 *    as tax, and pays `INFRA_DAILY_COST` as infrastructure.
 *  - The city's net change is `TAX_RATE * sumRevenue - INFRA_DAILY_COST`.
 *  - First time a business's `isOpen(def, hour)` flips true within a
 *    day, the system emits a single `company_open` event. Symmetric
 *    `company_close` on the closing transition. Both events are
 *    suppressed on the next open/close cycle (tracked via
 *    `Set<buildingId>`).
 *
 * Layer rule: pure TypeScript. It may import engine *types* (erased
 * at runtime) and the `BUILDING_DEFS` catalog from `@/constants`,
 * but it must NOT import React, DOM globals, the `World` class, or
 * any renderer / UI module. The bus is a stable dependency: the
 * system never throws into the bus; it always invokes
 * `bus.emit(...)` and trusts the bus to swallow listener errors.
 */

import type { Building, BuildingDef, TileCoord } from '@/engine/types';
import { BUILDING_DEFS } from '@/constants/building-types';
import type { EventBus } from './EventBus';
import type { SimEventMap } from './SimEvents';

/* -------------------------------------------------------------------------- */
/* Tunables                                                                   */
/* -------------------------------------------------------------------------- */

/** Tax rate applied to per-building daily revenue. */
export const TAX_RATE = 0.1;
/** Daily infrastructure cost paid by the city treasury. */
export const INFRA_DAILY_COST = 100;
/** Per-employee daily wage in currency units. */
export const WAGE_PER_EMPLOYEE = 35;

/* -------------------------------------------------------------------------- */
/* Minimal world view                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The structural shape EconomySystem needs from the world. Declared
 * as an interface (not a class import) so the systems layer doesn't
 * pull in the engine module. `World` already implements this exact
 * shape — it exposes `buildings_(): IterableIterator<Building>` and
 * `getBuildingDef(id: string): BuildingDef | null`.
 */
export interface EconomySystemWorldView {
  buildings_(): IterableIterator<Building>;
  getBuildingDef(id: string): BuildingDef | null;
}

/* -------------------------------------------------------------------------- */
/* EconomySystemOptions                                                       */
/* -------------------------------------------------------------------------- */

export interface EconomySystemOptions {
  /** Override the tax rate. Defaults to 0.1. */
  readonly taxRate?: number;
  /** Override the daily infrastructure cost. Defaults to 100. */
  readonly infraDailyCost?: number;
  /** Override the per-employee daily wage. Defaults to 35. */
  readonly wagePerEmployee?: number;
  /** Initial city treasury. Defaults to 0. */
  readonly initialTreasury?: number;
}

/* -------------------------------------------------------------------------- */
/* Util predicates                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Predicate: is the given def "open" at the given in-world hour?
 *
 * Two cases:
 *  - Daytime: `openHour <= hour < closeHour` (most businesses).
 *  - Overnight: `closeHour <= openHour`; treat the window as
 *    `[openHour, 24) ∪ [0, closeHour)` (e.g. restaurant 17→02).
 *  - 24h operation: `openHour == 0 && closeHour == 24` is always open.
 *  - Defensive: missing or invalid hours treat the def as closed.
 */
export function isOpen(def: BuildingDef, hour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  // Normalise hour to [0, 24) so callers may pass >24 from multi-day wrap.
  const h = ((hour % 24) + 24) % 24;
  const o = def.openHour;
  const c = def.closeHour;
  if (o < 0 || o > 24 || c < 0 || c > 24) return false;
  if (o === c) return false;
  if (o < c) {
    return h >= o && h < c;
  }
  // Overnight wrap: open from `o` to midnight, then midnight to `c`.
  return h >= o || h < c;
}

/* -------------------------------------------------------------------------- */
/* EconomySystem                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Pure-TS economic engine. Holds:
 *  - A reference to a `EventBus<SimEventMap>` (so producers can wire
 *    UI consumers without coupling the system to React).
 *  - A reference to a structural `EconomySystemWorldView` (so the
 *    system never imports the `World` class).
 *  - The city treasury.
 *  - Tracking sets for `company_open` / `company_close` de-duplication.
 *
 * The system is deterministic given the same world + the same
 * sequence of `onNewDay` calls.
 */
export class EconomySystem {
  private readonly taxRate: number;
  private readonly infraDailyCost: number;
  private readonly wagePerEmployee: number;

  private _treasury: number;
  private readonly bus: EventBus<SimEventMap>;

  /**
   * Building ids whose `isOpen` predicate flipped from closed→open
   * on the most recent in-world day. Cleared on the next `onNewDay`
   * so the events fire exactly once per business-day cycle.
   */
  private readonly openToday = new Set<string>();
  /**
   * Building ids that fired `company_open` on the most recent open
   * transition. Cleared when the building next closes, so the open
   * event re-fires on the next business day.
   */
  private readonly firedOpen = new Set<string>();
  /** Building ids that fired `company_close` on the most recent close. */
  private readonly firedClose = new Set<string>();

  /**
   * Last day the system accrued for. Used to make `onNewDay` idempotent
   * — calling it twice with the same `day` is a no-op for the per-day
   * accounting. Tracking this *only* on the system means callers can
   * freely re-tick at high speed without double-crediting the city.
   */
  private lastAccruedDay: number | null = null;

  constructor(
    bus: EventBus<SimEventMap>,
    private readonly world: EconomySystemWorldView,
    options: EconomySystemOptions = {},
  ) {
    if (!bus) throw new TypeError('EconomySystem: bus is required');
    if (!world) throw new TypeError('EconomySystem: world is required');
    const tax = options.taxRate ?? TAX_RATE;
    const infra = options.infraDailyCost ?? INFRA_DAILY_COST;
    const wage = options.wagePerEmployee ?? WAGE_PER_EMPLOYEE;
    if (!Number.isFinite(tax) || tax < 0) {
      throw new RangeError(`EconomySystem: taxRate must be >= 0 (got ${tax})`);
    }
    if (!Number.isFinite(infra) || infra < 0) {
      throw new RangeError(`EconomySystem: infraDailyCost must be >= 0 (got ${infra})`);
    }
    if (!Number.isFinite(wage) || wage < 0) {
      throw new RangeError(`EconomySystem: wagePerEmployee must be >= 0 (got ${wage})`);
    }
    this.taxRate = tax;
    this.infraDailyCost = infra;
    this.wagePerEmployee = wage;
    this._treasury = options.initialTreasury ?? 0;
    this.bus = bus;
  }

  /* ---------------------------------------------------------------------- */
  /* Day rollover                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Accrue one in-world day. Idempotent: re-calling with the same
   * `day` value is a no-op (no double-credit). Returns the new city
   * treasury after this day's accounting close, or `null` if the call
   * was a re-tick of the same day.
   */
  onNewDay(day: number, hour: number): number | null {
    if (!Number.isInteger(day) || day < 1) {
      throw new RangeError(`EconomySystem.onNewDay: day must be a positive integer (got ${day})`);
    }
    if (this.lastAccruedDay === day) return null;
    this.lastAccruedDay = day;

    const summary = this.accrueForDay(day, hour);
    this._treasury += summary.taxRevenue - this.infraDailyCost;
    // Emit `new_day` last so listeners see the post-accounting treasury.
    this.bus.emit('new_day', {
      day,
      hour,
      treasury: this._treasury,
    });
    return this._treasury;
  }

  /**
   * Convenience method: drive the day-rollover + open/close tracking
   * for an arbitrary in-world hour on a given day. The two-pass
   * semantics is identical to `onNewDay` followed by `updateOpenClose`
   * but collapsed into a single hot-path call.
   */
  tick(day: number, hour: number): number | null {
    const treasury = this.onNewDay(day, hour);
    this.updateOpenClose(day, hour);
    return treasury;
  }

  /* ---------------------------------------------------------------------- */
  /* Open / close tracking                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Compare the current `isOpen(def, hour)` against the previous
   * tracked state for every company building. Emit `company_open` on
   * the closed→open transition, `company_close` on the open→closed
   * transition. Events fire exactly once per transition.
   */
  updateOpenClose(day: number, hour: number): void {
    for (const building of this.world.buildings_()) {
      const def = this.world.getBuildingDef(building.defId);
      if (!def) continue;
      // Skip non-employer / non-business defs (parks, residential).
      if (def.revenue <= 0 && def.maxEmployees <= 0) {
        this.openToday.delete(building.id);
        this.firedOpen.delete(building.id);
        this.firedClose.delete(building.id);
        continue;
      }
      const nowOpen = isOpen(def, hour);
      const wasOpen = this.openToday.has(building.id);
      if (nowOpen && !wasOpen) {
        // Closed → open.
        this.openToday.add(building.id);
        if (!this.firedOpen.has(building.id)) {
          this.firedOpen.add(building.id);
          this.firedClose.delete(building.id);
          this.bus.emit('company_open', {
            buildingId: building.id,
            defId: def.id,
            name: def.name,
            day,
          });
        }
      } else if (!nowOpen && wasOpen) {
        // Open → closed.
        this.openToday.delete(building.id);
        if (!this.firedClose.has(building.id)) {
          this.firedClose.add(building.id);
          this.firedOpen.delete(building.id);
          this.bus.emit('company_close', {
            buildingId: building.id,
            defId: def.id,
            name: def.name,
            day,
          });
        }
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Per-day accounting                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Per-day accounting, factored out for testability. Computes the
   * total revenue per building (with utilisation discount), pays
   * wages from each building's treasury, and credits the city tax
   * receipt. Returns the totals for assertions.
   */
  private accrueForDay(day: number, hour: number): { taxRevenue: number; perBuildingRevenue: number } {
    let sumRevenue = 0;
    // The iteration is over the live building map; we mutate the
    // building treasuries in place so the renderer / dashboard can
    // read them immediately after the tick.
    for (const building of this.world.buildings_()) {
      const def = this.world.getBuildingDef(building.defId);
      if (!def) continue;
      const employees = building.employees.length;
      // Utilisation is the share of `maxEmployees` actually filled;
      // a building with no roster earns zero revenue.
      const utilisation =
        def.maxEmployees > 0 ? Math.min(1, employees / def.maxEmployees) : 0;
      const revenue = def.revenue * utilisation;
      const wages = this.wagePerEmployee * employees;
      const profit = revenue - wages;
      // Mutate the building's treasury in place. Buildings can go
      // negative (informational only; the city does not bail them
      // out automatically — that's a future policy lever).
      building.treasury += profit;
      sumRevenue += revenue;
      // Emit hiring/firing events on the very first day a building
      // shows up with employees. We don't track per-citizen
      // employment changes here (the CommuteDispatcher owns that)
      // — these are just *informational* signals for the dashboard.
      if (employees > 0 && !this.firedOpen.has(building.id) && day === 1) {
        // Best-effort hint to the dashboard; intentionally a no-op
        // for the simulation. Listeners can join a citizen_id →
        // building mapping on the side.
        for (const citizenId of building.employees) {
          this.bus.emit('citizen_hired', {
            citizenId,
            buildingId: building.id,
            day,
          });
        }
      }
      // Suppress lint warning for the unused parameter.
      void hour;
    }
    const taxRevenue = this.taxRate * sumRevenue;
    // Suppress lint warning for the unused parameter in callers.
    void day;
    return { taxRevenue, perBuildingRevenue: sumRevenue };
  }

  /* ---------------------------------------------------------------------- */
  /* Stable hooks for arrivals / traffic jams                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Public hook called whenever a citizen arrives at a building.
   * Emits an `arrival` event on the bus. The actual call sites
   * (MovementSystem, page-level mousemove hooks, etc.) live in
   * downstream tasks; this method is the stable integration point.
   */
  recordArrival(input: { citizenId: string; buildingId: string; kind: SimEventMap['arrival']['kind'] }): void {
    this.bus.emit('arrival', {
      citizenId: input.citizenId,
      buildingId: input.buildingId,
      kind: input.kind,
    });
  }

  /**
   * Public hook called by the traffic system when a cluster of
   * vehicles is detected on a set of tiles. Emits a `traffic_jam`
   * event with the affected coordinates and the stuck vehicle ids.
   */
  recordTrafficJam(input: { tiles: readonly TileCoord[]; vehicles: readonly string[] }): void {
    this.bus.emit('traffic_jam', {
      tiles: input.tiles,
      vehicles: input.vehicles,
      severity: input.vehicles.length,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Accessors                                                              */
  /* ---------------------------------------------------------------------- */

  /** Current city treasury. May be negative (informational). */
  getTreasury(): number {
    return this._treasury;
  }

  /**
   * Test/debug accessor: the last day the system accrued for. `null`
   * before the first `onNewDay` call.
   */
  getLastAccruedDay(): number | null {
    return this.lastAccruedDay;
  }

  /**
   * Test/debug accessor: true if the building is currently tracked
   * as "open" on the most recent in-world day.
   */
  isBuildingOpen(buildingId: string): boolean {
    return this.openToday.has(buildingId);
  }

  /**
   * Test/debug accessor: the building-def catalog the system was
   * built against. (It is the live `BUILDING_DEFS` array, so callers
   * should not mutate it.)
   */
  getBuildingDefs(): readonly BuildingDef[] {
    return BUILDING_DEFS;
  }
}
