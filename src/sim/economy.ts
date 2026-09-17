/**
 * The city economy: the employment join, the damped demand/wage feedback loop
 * and the hourly settlement of wages, taxes, city services and the budget.
 *
 * `EconomySystem` is a {@link SimSystem} that settles exactly one sim-hour of
 * economic activity on every hour boundary the engine publishes:
 *
 * 1. **Employment join.** The system owns the {@link LabourMarket} the company
 *    system staffs itself through (see
 *    {@link EconomySystem.createLabourMarket}). A hire writes the employer onto
 *    the citizen's occupation record and a release clears it again, so
 *    `occupation.companyId !== null` is the single "employed" flag shared by the
 *    economy, the HUD and the entity inspector. Citizens are matched with the
 *    companies operating the premises the roster already assigned them to
 *    (`world.buildings[].jobSlots`); citizens whose premises host no company
 *    (schools, hospitals, civic offices) stay idle and count as unemployed.
 * 2. **Activity reading.** The hour that just ended is summarised into a city
 *    activity level: citizens present at work plus a weighted share of the
 *    citizens out on errands or at entertainment venues.
 * 3. **Damped signals.** Activity drives a demand-signal target and labour
 *    tightness drives a wage-signal target. Both signals move towards their
 *    target by a fixed response factor and are clamped into a fixed band after
 *    every step, so rising activity raises demand and wages, falling activity
 *    lowers them, and even a multi-day soak can never diverge. The signal a
 *    settlement publishes is the one companies trade on during the *next* hour:
 *    the company system settles the hour that just ended before the economy
 *    settles it, exactly as the attachment order above implies.
 * 4. **Settlement.** For every employed citizen who actually worked the hour
 *    (their activity was `work` and they were inside their workplace) the
 *    company pays `wagePerHour * wageSignal`: the net part lands on the
 *    citizen's daily income and household savings, the income-tax part on the
 *    city budget. The city then charges its service costs — per citizen and per
 *    building — against the same budget.
 * 5. **Publication.** Every settlement publishes one {@link EconomyRecord} (a
 *    structural superset of the shared {@link EconomySnapshot}) and hands it,
 *    together with the live {@link EconomyHudStats}, to every registered
 *    {@link EconomyListener}.
 *
 * Wiring (owned by the app composition root, mirroring the citizens and
 * companies systems):
 *
 * ```ts
 * const citizens = new CitizensSystem({ world });
 * const economy = new EconomySystem(world, { citizens });
 * const companies = new CompaniesSystem(world, {
 *   labourMarket: economy.createLabourMarket(),
 *   demandModel: economy.createDemandModel(), // base demand * demandSignal
 * });
 * economy.bindCompanies(companies);
 * engine.attach(citizens);
 * engine.attach(companies);
 * engine.attach(economy);
 * ```
 *
 * The economy is constructed first so companies can be handed the labour market
 * and the demand adapter at construction time; `bindCitizens`/`bindCompanies`
 * complete the reference graph. No import cycle exists: citizens and companies
 * never import this module.
 *
 * The module is DOM-free and has no import-time side effects.
 */

import { resolveDayPhase } from './clock';
import type { HourBoundary, SimTime } from './clock';
import { defaultDemandModel } from './companies';
import type { CompaniesSystem, DemandModel, LabourMarket } from './companies';
import type { CitizensSystem } from './citizens';
import type { EngineContext, SimSystem } from './engine';
import { COMPANY_SECTORS } from './types';
import type {
  Citizen,
  Company,
  CompanySector,
  DayPhase,
  EconomySnapshot,
  EntityId,
  HudStats,
  WorldMap,
} from './types';

/* ------------------------------------------------------------- constants -- */

/** System name registered with the engine unless the caller overrides it. */
export const ECONOMY_SYSTEM_NAME = 'economy';

/**
 * Fraction of every wage the city collects as income tax, withheld before the
 * wage reaches the citizen. Matches the roster's own `INCOME_TAX_RATE`, so a
 * citizen's generated take-home estimate and the live settlement agree.
 */
export const DEFAULT_TAX_RATE = 0.18;

/** Sim currency the city starts with. */
export const DEFAULT_INITIAL_BUDGET = 250_000;

/** Sim currency the city spends per citizen per sim-hour. */
export const DEFAULT_SERVICE_COST_PER_CITIZEN_HOUR = 0.75;

/** Sim currency the city spends per building per sim-hour. */
export const DEFAULT_SERVICE_COST_PER_BUILDING_HOUR = 0.5;

/** Activity level (share of the city out and about) that counts as "normal". */
export const DEFAULT_ACTIVITY_BASELINE = 0.4;

/** Demand-signal gain applied to the deviation from the activity baseline. */
export const DEFAULT_DEMAND_GAIN = 0.9;

/** Wage-signal gain applied to the deviation of demand from its neutral 1. */
export const DEFAULT_WAGE_GAIN = 0.45;

/** Fraction of the gap the demand signal closes per sim-hour (the dampener). */
export const DEFAULT_DEMAND_RESPONSE = 0.35;

/** Fraction of the gap the wage signal closes per sim-hour (the dampener). */
export const DEFAULT_WAGE_RESPONSE = 0.25;

/** Hard band the demand signal can never leave, whatever the activity does. */
export const DEMAND_SIGNAL_FLOOR = 0.6;
export const DEMAND_SIGNAL_CEILING = 1.6;

/** Hard band the wage signal can never leave, whatever the economy does. */
export const WAGE_SIGNAL_FLOOR = 0.6;
export const WAGE_SIGNAL_CEILING = 1.5;

/** How much an outing is worth relative to an hour of paid work, 0..1. */
export const OUT_AND_ABOUT_WEIGHT = 0.7;

/** Wage-signal weight given to labour tightness (employment above normal). */
export const LABOUR_TIGHTNESS_GAIN = 0.2;

/** Employment rate at which the labour market is neither tight nor slack. */
export const LABOUR_TIGHTNESS_BASELINE = 0.5;

/** Highest demand multiplier the economy hands to a company's demand model. */
export const DEMAND_MODEL_CEILING = 2;

/** Settlements kept in the rolling history. Defaults to one sim-week. */
export const DEFAULT_HISTORY_HOURS = 168;

/* ----------------------------------------------------------------- types -- */

/**
 * One settled sim-hour.
 *
 * It is a structural superset of the shared {@link EconomySnapshot}, so the HUD
 * and the inspector can read the standard fields while the tests and the
 * overlay can also see the flows behind them.
 *
 * The record describes the city *at* the boundary: the flows (`grossWages`,
 * `taxIncome`, `serviceCosts`, `budgetDelta`) belong to the hour that just
 * ended, while `employedCitizens`/`companyRosters` are the state the companies
 * just set for the hour that is starting.
 */
export interface EconomyRecord extends EconomySnapshot {
  /** Damped demand multiplier handed to the companies' demand model. */
  readonly demandSignal: number;
  /** Damped wage multiplier applied to every wage paid this settlement. */
  readonly wageSignal: number;
  /** `taxIncome - serviceCosts`: how much the city budget moved. */
  readonly budgetDelta: number;
  /** Income tax withheld from this hour's wages. */
  readonly taxIncome: number;
  /** City services charged for this hour. */
  readonly serviceCosts: number;
  /** Wages paid by companies this hour, before tax. */
  readonly grossWages: number;
  /** Wages that reached citizens this hour; `grossWages - taxIncome`. */
  readonly netWages: number;
  /** Gross wages per company, for cash-flow verification. */
  readonly wagesByCompany: Readonly<Record<EntityId, number>>;
  /** Share of the population at work or out and about, 0..1. */
  readonly activityLevel: number;
  /** Citizens at work, on an errand or at entertainment this hour. */
  readonly activeCitizens: number;
  /** Citizens present at work this hour (the ones wages were paid for). */
  readonly workingCitizens: number;
  /** 1-based number of settlements since the system was constructed. */
  readonly settlementCount: number;
  /** Employed citizen ids at the boundary, in roster order. */
  readonly employedCitizenIds: readonly EntityId[];
  /** Company id -> employed citizen ids at the boundary. */
  readonly companyRosters: Readonly<Record<EntityId, readonly EntityId[]>>;
  /** Day/night phase of the hour that just began. */
  readonly phase: DayPhase;
}

/**
 * HUD payload: the shared {@link HudStats} the top overlay renders plus the
 * economy readouts it decorates them with.
 */
export interface EconomyHudStats extends HudStats {
  readonly budgetDelta: number;
  readonly taxIncome: number;
  readonly serviceCosts: number;
  readonly demandSignal: number;
  readonly wageSignal: number;
  /** Aggregate company revenue for the current sim-day. */
  readonly totalRevenue: number;
  /** Mean base hourly wage across employed citizens. */
  readonly averageWage: number;
}

/** Called once per settlement with the fresh record and the live HUD stats. */
export type EconomyListener = (record: EconomyRecord, hud: EconomyHudStats) => void;

/** Constructor options for {@link EconomySystem}. */
export interface EconomyOptions {
  /** System name; defaults to `economy`. Must be unique per engine. */
  name?: string;
  /** Citizen system backing the labour market; may be bound later. */
  citizens?: CitizensSystem | null;
  /** Company system the labour market staffs; may be bound later. */
  companies?: CompaniesSystem | null;
  /** Income-tax rate in `[0, 1)`. Defaults to {@link DEFAULT_TAX_RATE}. */
  taxRate?: number;
  /** Starting city budget. Defaults to {@link DEFAULT_INITIAL_BUDGET}. */
  initialBudget?: number;
  /** City service cost per citizen per hour. */
  serviceCostPerCitizenHour?: number;
  /** City service cost per building per hour. */
  serviceCostPerBuildingHour?: number;
  /** Activity level treated as neutral, 0..1. */
  activityBaseline?: number;
  /** Demand-signal gain. */
  demandGain?: number;
  /** Wage-signal gain. */
  wageGain?: number;
  /** Fraction of the demand gap closed per hour, in `(0, 1]`. */
  demandResponse?: number;
  /** Fraction of the wage gap closed per hour, in `(0, 1]`. */
  wageResponse?: number;
  /** Settlements kept in the rolling history. Defaults to 168. */
  historyHours?: number;
}

/** Clock reading the HUD is served with between settlements. */
interface TimeReading {
  day: number;
  hour: number;
  minute: number;
  totalMinutes: number;
}

/* --------------------------------------------------------------- helpers -- */

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  return value > max ? max : value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `"Day 2, 07:35"`, the label the top overlay shows (see `SimClock`). */
export function formatCityTime(day: number, hour: number, minute: number): string {
  return `Day ${day + 1}, ${pad2(hour)}:${pad2(minute)}`;
}

function emptySectorRecord(): Record<CompanySector, number> {
  const record = {} as Record<CompanySector, number>;
  for (const sector of COMPANY_SECTORS) {
    record[sector] = 0;
  }
  return record;
}

/** Whether a citizen is currently employed, i.e. joined to a company. */
export function isEmployed(citizen: Citizen): boolean {
  return citizen.occupation.companyId !== null;
}

/**
 * Whether an employed citizen actually worked the hour that just ended: their
 * activity is `work` and they are inside the workplace they are hired at.
 * Commuting and lunch breaks therefore do not earn a wage.
 */
export function isPresentAtWork(citizen: Citizen): boolean {
  return (
    citizen.currentActivity === 'work' &&
    citizen.insideBuildingId !== null &&
    citizen.insideBuildingId === citizen.occupation.workplaceBuildingId
  );
}

/** One step of an exponential moving average: the demand/wage dampener. */
function damp(current: number, target: number, response: number): number {
  return current + (target - current) * response;
}

function normaliseHour(hour: number): number {
  return ((Math.floor(hour) % 24) + 24) % 24;
}

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`EconomySystem ${label} must be a finite number, received ${value}`);
  }
  return value;
}

function assertNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`EconomySystem ${label} must be a finite non-negative number, received ${value}`);
  }
  return value;
}

function assertResponse(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError(`EconomySystem ${label} must be a number in (0, 1], received ${value}`);
  }
  return value;
}

/* ------------------------------------------------------------- the system -- */

/**
 * The hourly economy.
 *
 * Lifecycle: construct with the world (and optionally the citizen/company
 * systems, or bind them later), hand {@link EconomySystem.createLabourMarket}
 * and {@link EconomySystem.createDemandModel} to the company system, then
 * attach to the engine. The engine calls {@link EconomySystem.onHourEnd} once
 * per hour boundary — the only place a settlement ever runs — and
 * {@link EconomySystem.update} once per fixed step for clock bookkeeping.
 */
export class EconomySystem implements SimSystem {
  readonly name: string;

  private readonly world: WorldMap;
  private readonly taxRateValue: number;
  private readonly serviceCostPerCitizenHour: number;
  private readonly serviceCostPerBuildingHour: number;
  private readonly activityBaseline: number;
  private readonly demandGain: number;
  private readonly wageGain: number;
  private readonly demandResponse: number;
  private readonly wageResponse: number;
  private readonly historyHours: number;
  private readonly listeners: EconomyListener[] = [];
  private readonly recordList: EconomyRecord[] = [];

  private citizensRef: CitizensSystem | null;
  private companiesRef: CompaniesSystem | null;
  private budgetValue: number;
  private demandSignalValue = 1;
  private wageSignalValue = 1;
  private settlementCountValue = 0;
  private recordValue: EconomyRecord | null = null;
  private attachedFlag = false;
  private lastTick = 0;
  private lastSettledMinutes: number | null = null;
  private timeValue: TimeReading = { day: 0, hour: 0, minute: 0, totalMinutes: 0 };
  private phaseValue: DayPhase = 'night';

  constructor(world: WorldMap, options: EconomyOptions = {}) {
    if (!world) {
      throw new TypeError('new EconomySystem(world, options) expects a world');
    }
    this.world = world;
    this.name = options.name ?? ECONOMY_SYSTEM_NAME;
    this.citizensRef = options.citizens ?? null;
    this.companiesRef = options.companies ?? null;

    const taxRate = options.taxRate ?? DEFAULT_TAX_RATE;
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate >= 1) {
      throw new RangeError(`EconomySystem taxRate must be a number in [0, 1), received ${taxRate}`);
    }
    this.taxRateValue = taxRate;

    this.budgetValue = assertFinite(options.initialBudget ?? DEFAULT_INITIAL_BUDGET, 'initialBudget');
    this.serviceCostPerCitizenHour = assertNonNegative(
      options.serviceCostPerCitizenHour ?? DEFAULT_SERVICE_COST_PER_CITIZEN_HOUR,
      'serviceCostPerCitizenHour',
    );
    this.serviceCostPerBuildingHour = assertNonNegative(
      options.serviceCostPerBuildingHour ?? DEFAULT_SERVICE_COST_PER_BUILDING_HOUR,
      'serviceCostPerBuildingHour',
    );
    this.activityBaseline = clamp(
      assertFinite(options.activityBaseline ?? DEFAULT_ACTIVITY_BASELINE, 'activityBaseline'),
      0,
      1,
    );
    this.demandGain = assertNonNegative(options.demandGain ?? DEFAULT_DEMAND_GAIN, 'demandGain');
    this.wageGain = assertNonNegative(options.wageGain ?? DEFAULT_WAGE_GAIN, 'wageGain');
    this.demandResponse = assertResponse(options.demandResponse ?? DEFAULT_DEMAND_RESPONSE, 'demandResponse');
    this.wageResponse = assertResponse(options.wageResponse ?? DEFAULT_WAGE_RESPONSE, 'wageResponse');

    const historyHours = options.historyHours ?? DEFAULT_HISTORY_HOURS;
    if (!Number.isInteger(historyHours) || historyHours < 1) {
      throw new RangeError(
        `EconomySystem historyHours must be a positive integer, received ${historyHours}`,
      );
    }
    this.historyHours = historyHours;
  }

  /* ------------------------------------------------------------ lifecycle -- */

  get attached(): boolean {
    return this.attachedFlag;
  }

  /** Called once when the engine attaches the system; seeds the clock reading. */
  onAttach(context: EngineContext): void {
    this.attachedFlag = true;
    this.lastTick = context.tick;
    this.applyClock(context.simTime);
  }

  /** Called once when the system is detached or the engine is disposed. */
  onDetach(): void {
    this.attachedFlag = false;
  }

  /**
   * Called once per fixed step. Settlements never run here: the tick only keeps
   * the HUD's clock reading current, so per-tick work stays interpolation-free
   * bookkeeping.
   */
  update(context: EngineContext): void {
    this.lastTick = context.tick;
    this.applyClock(context.simTime);
  }

  /**
   * Settles the sim-hour that just ended. The engine calls this exactly once per
   * hour boundary; a boundary delivered twice is ignored so the cadence can
   * never double-settle.
   */
  onHourEnd(context: EngineContext, boundary: HourBoundary): void {
    this.lastTick = context.tick;
    if (this.lastSettledMinutes === boundary.totalMinutes) {
      return;
    }
    this.lastSettledMinutes = boundary.totalMinutes;
    this.settleHour(boundary);
  }

  /* -------------------------------------------------------------- reading -- */

  /** Last engine tick seen by `update()`/`onHourEnd()`. */
  get ticksSeen(): number {
    return this.lastTick;
  }

  /** Sim currency the city holds right now. */
  get cityBudget(): number {
    return this.budgetValue;
  }

  /** Income-tax rate the city withholds from every wage. */
  get taxRate(): number {
    return this.taxRateValue;
  }

  /** Current damped demand multiplier handed to the companies. */
  get demandSignal(): number {
    return this.demandSignalValue;
  }

  /** Current damped wage multiplier applied to the wages the city pays. */
  get wageSignal(): number {
    return this.wageSignalValue;
  }

  /** Number of settlements run since construction. */
  get settlementCount(): number {
    return this.settlementCountValue;
  }

  /** The most recent settlement, or `null` before the first hour boundary. */
  get lastSettlement(): EconomyRecord | null {
    return this.recordValue;
  }

  /** Rolling settlement history, oldest first (capped at `historyHours`). */
  get settlements(): readonly EconomyRecord[] {
    return [...this.recordList];
  }

  /** Every employed citizen id, in roster order. */
  employedCitizenIds(): readonly EntityId[] {
    return this.roster()
      .filter((citizen) => isEmployed(citizen))
      .map((citizen) => citizen.id);
  }

  /** The workforce a company holds through the employment join, in roster order. */
  workforceFor(companyId: EntityId): readonly EntityId[] {
    return this.roster()
      .filter((citizen) => citizen.occupation.companyId === companyId)
      .map((citizen) => citizen.id);
  }

  /**
   * Live HUD reading: the fields the top overlay renders this frame. The
   * population and employment figures come from the current join state, and the
   * clock label tracks the last tick, so the overlay never shows stale time.
   */
  hudStats(): EconomyHudStats {
    const citizens = this.roster();
    const population = citizens.length;
    let employed = 0;
    let moodTotal = 0;
    for (const citizen of citizens) {
      moodTotal += citizen.mood;
      if (isEmployed(citizen)) {
        employed += 1;
      }
    }
    const record = this.recordValue;
    return {
      population,
      employedCitizens: employed,
      employmentRate: population === 0 ? 0 : employed / population,
      cityTimeLabel: formatCityTime(this.timeValue.day, this.timeValue.hour, this.timeValue.minute),
      cityBudget: this.budgetValue,
      day: this.timeValue.day,
      hour: this.timeValue.hour,
      minute: this.timeValue.minute,
      phase: this.phaseValue,
      citizenCount: population,
      vehicleCount: this.world.vehicles.length,
      companyCount: this.world.companies.length,
      buildingCount: this.world.buildings.length,
      averageMood: population === 0 ? 0 : round2(moodTotal / population),
      budgetDelta: record?.budgetDelta ?? 0,
      taxIncome: record?.taxIncome ?? 0,
      serviceCosts: record?.serviceCosts ?? 0,
      demandSignal: this.demandSignalValue,
      wageSignal: this.wageSignalValue,
      totalRevenue: record?.totalRevenue ?? 0,
      averageWage: record?.averageWage ?? 0,
    };
  }

  /* ---------------------------------------------------------- composition -- */

  /** Binds (or clears) the citizen system backing the labour market. */
  bindCitizens(citizens: CitizensSystem | null): void {
    this.citizensRef = citizens;
  }

  /** Binds (or clears) the company system the labour market staffs. */
  bindCompanies(companies: CompaniesSystem | null): void {
    this.companiesRef = companies;
  }

  /**
   * The employment API handed to the company system: companies ask for staff and
   * release it, and the economy owns the join with real citizen records.
   */
  createLabourMarket(): LabourMarket {
    return {
      requestEmployees: (companyId, count) => this.hire(companyId, count),
      releaseEmployees: (companyId, employeeIds) => this.release(companyId, employeeIds),
    };
  }

  /**
   * A demand model adapter for the company system: the wrapped model's reading
   * (the sector/day/hour curve by default) is scaled by the damped demand
   * signal, which is how aggregate citizen activity reaches the companies.
   */
  createDemandModel(base: DemandModel = defaultDemandModel): DemandModel {
    return (context) => clamp(base(context) * this.demandSignalValue, 0, DEMAND_MODEL_CEILING);
  }

  /**
   * Registers a settlement listener. Returns the unsubscribe function; listeners
   * are called in registration order, after the record is stored.
   */
  onSettlement(listener: EconomyListener): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('EconomySystem.onSettlement(listener) expects a function');
    }
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /* ------------------------------------------------------------ union shop -- */

  /**
   * Hires up to `count` idle citizens for a company.
   *
   * The join is site based: the roster already assigns every citizen a
   * workplace building, and a company is staffed by the idle citizens assigned
   * to the premises it operates from. Citizen order is the roster order, so the
   * same citizens are hired first every day and the simulation stays
   * deterministic.
   */
  private hire(companyId: EntityId, count: number): readonly EntityId[] {
    const wanted = Math.max(0, Math.floor(count));
    if (wanted === 0) {
      return [];
    }
    const company = this.companyById(companyId);
    const siteId = company?.buildingId ?? null;
    if (company === null || siteId === null) {
      return [];
    }
    const hired: EntityId[] = [];
    for (const citizen of this.roster()) {
      if (hired.length >= wanted) {
        break;
      }
      if (isEmployed(citizen)) {
        continue;
      }
      if (citizen.occupation.workplaceBuildingId !== siteId) {
        continue;
      }
      this.join(companyId, citizen);
      hired.push(citizen.id);
    }
    return hired;
  }

  /**
   * Releases employees back to the idle pool. Ids the citizen is not actually
   * employed by that company for are ignored, so the returned list is exactly
   * the set that changed hands.
   */
  private release(companyId: EntityId, employeeIds: readonly EntityId[]): readonly EntityId[] {
    const released: EntityId[] = [];
    for (const employeeId of employeeIds) {
      const citizen = this.citizenById(employeeId);
      if (citizen === null || citizen.occupation.companyId !== companyId) {
        continue;
      }
      citizen.occupation.companyId = null;
      released.push(citizen.id);
    }
    return released;
  }

  /** Writes the employer onto the citizen's occupation record. */
  private join(companyId: EntityId, citizen: Citizen): void {
    const company = this.companyById(companyId);
    if (company) {
      citizen.occupation.sector = company.sector;
    }
    citizen.occupation.companyId = companyId;
  }

  private companyById(companyId: EntityId): Company | null {
    const owned = this.companiesRef?.companyById(companyId) ?? null;
    if (owned !== null) {
      return owned;
    }
    return this.world.companies.find((company) => company.id === companyId) ?? null;
  }

  private citizenById(citizenId: EntityId): Citizen | null {
    return this.roster().find((citizen) => citizen.id === citizenId) ?? null;
  }

  /**
   * The roster the economy settles. The citizen system's roster wins when it is
   * bound (it owns the live records), with `world.citizens` as the fallback.
   */
  private roster(): readonly Citizen[] {
    const system = this.citizensRef;
    if (system && system.citizens.length > 0) {
      return system.citizens;
    }
    return this.world.citizens;
  }

  /* ----------------------------------------------------------- settlement -- */

  /** Runs one full settlement for the hour that just ended. */
  private settleHour(boundary: HourBoundary): void {
    const day = boundary.endedDay;
    const hour = normaliseHour(boundary.endedHour);
    const citizens = this.roster();
    const population = citizens.length;

    // 1. Aggregate the citizen activity of the hour that just ended.
    const rosters = new Map<EntityId, EntityId[]>();
    let workingCitizens = 0;
    let outAndAbout = 0;
    let employedCitizens = 0;
    let moodTotal = 0;
    let wageBaseTotal = 0;
    for (const citizen of citizens) {
      moodTotal += citizen.mood;
      if (citizen.currentActivity === 'work') {
        workingCitizens += 1;
      } else if (citizen.currentActivity === 'errand' || citizen.currentActivity === 'entertainment') {
        outAndAbout += 1;
      }
      const companyId = citizen.occupation.companyId;
      if (companyId === null) {
        continue;
      }
      employedCitizens += 1;
      wageBaseTotal += citizen.occupation.wagePerHour;
      const roster = rosters.get(companyId);
      if (roster) {
        roster.push(citizen.id);
      } else {
        rosters.set(companyId, [citizen.id]);
      }
    }
    const activityLevel =
      population === 0 ? 0 : clamp((workingCitizens + OUT_AND_ABOUT_WEIGHT * outAndAbout) / population, 0, 1);
    const employmentRate = population === 0 ? 0 : employedCitizens / population;

    // 2. Move the damped, hard-bounded demand and wage signals one hour.
    const demandTarget = clamp(
      1 + this.demandGain * (activityLevel - this.activityBaseline),
      DEMAND_SIGNAL_FLOOR,
      DEMAND_SIGNAL_CEILING,
    );
    this.demandSignalValue = round4(
      clamp(
        damp(this.demandSignalValue, demandTarget, this.demandResponse),
        DEMAND_SIGNAL_FLOOR,
        DEMAND_SIGNAL_CEILING,
      ),
    );
    const wageTarget = clamp(
      1 +
        this.wageGain * (this.demandSignalValue - 1) +
        LABOUR_TIGHTNESS_GAIN * (employmentRate - LABOUR_TIGHTNESS_BASELINE),
      WAGE_SIGNAL_FLOOR,
      WAGE_SIGNAL_CEILING,
    );
    this.wageSignalValue = round4(
      clamp(damp(this.wageSignalValue, wageTarget, this.wageResponse), WAGE_SIGNAL_FLOOR, WAGE_SIGNAL_CEILING),
    );

    // 3. Wages: company cash -> employed citizens; income tax -> city budget.
    const wageRate = this.wageSignalValue;
    const wagesByCompany: Record<EntityId, number> = {};
    let grossWages = 0;
    let taxIncome = 0;
    for (const citizen of citizens) {
      const companyId = citizen.occupation.companyId;
      if (companyId === null || !isPresentAtWork(citizen)) {
        continue;
      }
      const company = this.companyById(companyId);
      if (company === null) {
        // The employer left the city: there is nobody to pay the wage.
        continue;
      }
      const gross = round2(citizen.occupation.wagePerHour * wageRate);
      if (gross <= 0) {
        continue;
      }
      const tax = round2(gross * this.taxRateValue);
      const net = round2(gross - tax);
      company.cash = round2(company.cash - gross);
      citizen.income = round2(citizen.income + net);
      citizen.household.funds = round2(citizen.household.funds + net);
      wagesByCompany[companyId] = round2((wagesByCompany[companyId] ?? 0) + gross);
      grossWages = round2(grossWages + gross);
      taxIncome = round2(taxIncome + tax);
    }
    const netWages = round2(grossWages - taxIncome);

    // 4. City budget: tax income in, service costs out.
    const serviceCosts = round2(
      population * this.serviceCostPerCitizenHour +
        this.world.buildings.length * this.serviceCostPerBuildingHour,
    );
    const budgetDelta = round2(taxIncome - serviceCosts);
    this.budgetValue = round2(this.budgetValue + budgetDelta);

    // 5. Company ledger aggregates for the current sim-day.
    const sectorRevenue = emptySectorRecord();
    const sectorCosts = emptySectorRecord();
    let totalRevenue = 0;
    let totalCosts = 0;
    for (const company of this.world.companies) {
      totalRevenue += company.revenue;
      totalCosts += company.costs;
      sectorRevenue[company.sector] += company.revenue;
      sectorCosts[company.sector] += company.costs;
    }

    // 6. Publish the snapshot and the HUD stats.
    const companyRosters: Record<EntityId, readonly EntityId[]> = {};
    for (const [companyId, roster] of rosters) {
      companyRosters[companyId] = roster;
    }
    this.settlementCountValue += 1;
    const record: EconomyRecord = {
      day,
      hour,
      minute: 0,
      totalMinutes: boundary.totalMinutes,
      population,
      companyCount: this.world.companies.length,
      employedCitizens,
      employmentRate,
      unemploymentRate: 1 - employmentRate,
      averageWage: employedCitizens === 0 ? 0 : round2(wageBaseTotal / employedCitizens),
      totalRevenue: round2(totalRevenue),
      totalCosts: round2(totalCosts),
      netProfit: round2(totalRevenue - totalCosts),
      cityBudget: this.budgetValue,
      taxRate: this.taxRateValue,
      sectorRevenue,
      sectorCosts,
      averageMood: population === 0 ? 0 : round2(moodTotal / population),
      demandSignal: this.demandSignalValue,
      wageSignal: this.wageSignalValue,
      budgetDelta,
      taxIncome,
      serviceCosts,
      grossWages,
      netWages,
      wagesByCompany,
      activityLevel,
      activeCitizens: workingCitizens + outAndAbout,
      workingCitizens,
      settlementCount: this.settlementCountValue,
      employedCitizenIds: citizens.filter((citizen) => isEmployed(citizen)).map((citizen) => citizen.id),
      companyRosters,
      phase: boundary.phase,
    };
    this.recordValue = record;
    this.recordList.push(record);
    while (this.recordList.length > this.historyHours) {
      this.recordList.shift();
    }

    // 7. Clock bookkeeping: the boundary time is the freshest reading, and a new
    // sim-day restarts the citizens' daily income counters (like the companies'
    // daily revenue/cost counters).
    this.timeValue = { ...boundary.time };
    this.phaseValue = boundary.phase;
    if (boundary.startedHour === 0) {
      for (const citizen of citizens) {
        citizen.income = 0;
      }
    }

    for (const listener of [...this.listeners]) {
      listener(record, this.hudStats());
    }
  }

  private applyClock(simTime: SimTime): void {
    this.timeValue = {
      day: simTime.day,
      hour: simTime.hour,
      minute: simTime.minute,
      totalMinutes: simTime.totalMinutes,
    };
    this.phaseValue = resolveDayPhase(simTime.hour);
  }
}

/** Convenience factory mirroring `createCityWorld`/`createCompaniesSystem`. */
export function createEconomySystem(world: WorldMap, options: EconomyOptions = {}): EconomySystem {
  return new EconomySystem(world, options);
}
