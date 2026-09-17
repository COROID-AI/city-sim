/**
 * Companies: the businesses that occupy the city's commercial, office and
 * industrial buildings.
 *
 * `CompaniesSystem` is a {@link SimSystem} that runs the hourly economy for
 * every company. It first places businesses into vacant premises (a building's
 * `jobSlots` become the company's headcount capacity, its `address` the
 * company address), then once per sim-hour it posts revenue and costs against
 * each company's rolling ledger, updates its cash, reacts to the injected
 * demand signal by hiring and firing through an injectable labour market, and
 * moves the company between the `healthy` / `troubled` / `insolvent` viability
 * states.
 *
 * Three seams keep the system decoupled and testable:
 *
 * - {@link DemandModel} and {@link RevenueModel} are injected functions, so
 *   tests pin demand while the live app uses {@link defaultDemandModel} and
 *   {@link defaultRevenueModel}. The system never reads a global clock: sim
 *   time arrives on the hour boundary handed to {@link CompaniesSystem.onHourEnd}.
 * - {@link LabourMarket} owns employment. The system only ever calls
 *   `requestEmployees` / `releaseEmployees`; the economy task owns the join
 *   with real citizen records, so no citizen is mutated here.
 * - The world is consumed through the shared `WorldMap` contract: companies are
 *   placed from the buildings the world already generated and their id is
 *   written back onto `Building.companyId` so the detail inspector can find
 *   them from either direction.
 *
 * The module is DOM-free (the sim-layer guard test in `tests/sim/world.test.ts`
 * enforces it) and imports only the shared domain contracts, the engine's
 * system interface and the world's building shape.
 */

import type { HourBoundary } from './clock';
import type { EngineContext, SimSystem } from './engine';
import type {
  Building,
  BuildingKind,
  Company,
  CompanySector,
  EntityId,
  WorldMap,
} from './types';
import type { WorldBuilding } from './world';

/* ------------------------------------------------------------- contract -- */

/** Viability state of a company, as shown by the inspector and the HUD. */
export type CompanyState = 'healthy' | 'troubled' | 'insolvent';

/** Every viability state, worst last. */
export const COMPANY_STATES: readonly CompanyState[] = ['healthy', 'troubled', 'insolvent'];

/** Pay tier a company offers; derived from its sector's wage level. */
export type CompanyWageLevel = 'minimum' | 'standard' | 'premium';

/** Every pay tier. */
export const COMPANY_WAGE_LEVELS: readonly CompanyWageLevel[] = [
  'minimum',
  'standard',
  'premium',
];

/**
 * Building kinds that host companies by default: the commercial, office and
 * industrial premises the acceptance criteria call for. Civic/institutional
 * buildings are only staffed when a caller opts in through
 * {@link CompaniesSystemOptions.siteKinds}.
 */
export const COMMERCIAL_SITE_KINDS: readonly BuildingKind[] = [
  'shop',
  'office',
  'factory',
  'warehouse',
];

/** Highest demand reading the system accepts from an injected model. */
const MAX_DEMAND = 2;

/* ------------------------------------------------------- sector profiles -- */

/** Static economics of one sector: hours, pay, prices and demand shape. */
export interface CompanySectorProfile {
  readonly sector: CompanySector;
  /** Human readable sector name for the inspector. */
  readonly label: string;
  /** Hour-of-day the doors open (24h clock). */
  readonly openHour: number;
  /** Hour-of-day the doors close (24h clock). */
  readonly closeHour: number;
  readonly wageLevel: CompanyWageLevel;
  /** Sim currency paid per employee per worked sim-hour. */
  readonly wagePerHour: number;
  /** Sim currency one served customer brings in. */
  readonly revenuePerCustomer: number;
  /** Customers one employee can serve per sim-hour. */
  readonly customersPerEmployeeHour: number;
  /** Fixed rent per sim-hour. */
  readonly rentPerHour: number;
  /** Utilities/maintenance per employee per sim-hour. */
  readonly utilitiesPerEmployeeHour: number;
  /** Hour-of-day demand peaks at. */
  readonly demandPeakHour: number;
  /** Width of the demand bell, in hours. */
  readonly demandWidthHours: number;
  /** Demand floor outside the peak, 0..1. */
  readonly demandFloor: number;
  /** Demand multiplier applied at the weekend. */
  readonly weekendFactor: number;
  /** Business names, cycled with a numeric suffix when a sector is large. */
  readonly namePool: readonly string[];
}

/** Per-sector economics, tuned so a fully staffed trading hour is profitable. */
export const SECTOR_PROFILES: Record<CompanySector, CompanySectorProfile> = {
  retail: {
    sector: 'retail',
    label: 'Retail',
    openHour: 9,
    closeHour: 20,
    wageLevel: 'minimum',
    wagePerHour: 13,
    revenuePerCustomer: 11,
    customersPerEmployeeHour: 6,
    rentPerHour: 40,
    utilitiesPerEmployeeHour: 1.2,
    demandPeakHour: 16,
    demandWidthHours: 4.5,
    demandFloor: 0.3,
    weekendFactor: 1.15,
    namePool: [
      'Harbour Market Co.',
      'Copper Kettle Stores',
      'Green Grocer Group',
      'Thread & Needle Retail',
      'Lantern Deli Co.',
      'Nook Books & Co.',
      'Bramble Trading',
      'Alder Outfitters',
    ],
  },
  office: {
    sector: 'office',
    label: 'Office services',
    openHour: 8,
    closeHour: 18,
    wageLevel: 'premium',
    wagePerHour: 22,
    revenuePerCustomer: 45,
    customersPerEmployeeHour: 1.2,
    rentPerHour: 120,
    utilitiesPerEmployeeHour: 3,
    demandPeakHour: 11,
    demandWidthHours: 3.5,
    demandFloor: 0.15,
    weekendFactor: 0.45,
    namePool: [
      'Ledger House Partners',
      'Meridian Advisory',
      'Northgate Legal',
      'Bramble Business Group',
      'Kestrel Consulting',
      'Aurora Chambers Ltd',
      'Union Analytics',
      'Beacon Insurance',
    ],
  },
  manufacturing: {
    sector: 'manufacturing',
    label: 'Industry',
    openHour: 6,
    closeHour: 22,
    wageLevel: 'standard',
    wagePerHour: 18,
    revenuePerCustomer: 30,
    customersPerEmployeeHour: 2,
    rentPerHour: 150,
    utilitiesPerEmployeeHour: 4,
    demandPeakHour: 13,
    demandWidthHours: 5,
    demandFloor: 0.4,
    weekendFactor: 0.7,
    namePool: [
      'Ironworks Plant Co.',
      'Fairfield Assembly',
      'Bright Foundry',
      'Kettle Works Manufacturing',
      'Quarry Fabrication',
      'Redline Components',
      'Harbour Steelworks',
      'Linden Toolworks',
    ],
  },
  logistics: {
    sector: 'logistics',
    label: 'Logistics',
    openHour: 5,
    closeHour: 21,
    wageLevel: 'standard',
    wagePerHour: 16,
    revenuePerCustomer: 26,
    customersPerEmployeeHour: 2.5,
    rentPerHour: 110,
    utilitiesPerEmployeeHour: 2.5,
    demandPeakHour: 12,
    demandWidthHours: 5,
    demandFloor: 0.45,
    weekendFactor: 0.6,
    namePool: [
      'Dock 7 Logistics',
      'North Depot Freight',
      'Redline Storage Co.',
      'Quayside Haulage',
      'Meridian Cargo',
      'Union Freight',
      'Beacon Couriers',
      'Willow Distribution',
    ],
  },
  hospitality: {
    sector: 'hospitality',
    label: 'Hospitality & leisure',
    openHour: 10,
    closeHour: 23,
    wageLevel: 'minimum',
    wagePerHour: 12,
    revenuePerCustomer: 8,
    customersPerEmployeeHour: 8,
    rentPerHour: 60,
    utilitiesPerEmployeeHour: 1.5,
    demandPeakHour: 19,
    demandWidthHours: 4,
    demandFloor: 0.25,
    weekendFactor: 1.2,
    namePool: [
      'Night Owl Cafe',
      'Copper Kettle Kitchen',
      'Riverside Bistro',
      'Star Cinema Bar',
      'Lantern Rooms',
      'Foundry Taproom',
      'Willow Tea House',
      'Quayside Grill',
    ],
  },
  civic: {
    sector: 'civic',
    label: 'Civic services',
    openHour: 8,
    closeHour: 17,
    wageLevel: 'standard',
    wagePerHour: 19,
    revenuePerCustomer: 12,
    customersPerEmployeeHour: 4,
    rentPerHour: 90,
    utilitiesPerEmployeeHour: 2,
    demandPeakHour: 10,
    demandWidthHours: 4,
    demandFloor: 0.3,
    weekendFactor: 0.8,
    namePool: [
      'City Services Board',
      'Metropolitan Health Trust',
      'Union Education Trust',
      'Riverside Care Group',
      'Beacon Housing Trust',
      'Council Works Department',
      'Grand Museum Trust',
      'Public Library Service',
    ],
  },
};

/** Profile for a sector, falling back to retail for unexpected input. */
export function sectorProfile(sector: CompanySector): CompanySectorProfile {
  return SECTOR_PROFILES[sector] ?? SECTOR_PROFILES.retail;
}

/* -------------------------------------------------------- injectable seams -- */

/** Everything a demand model may look at; sim time arrives from the caller. */
export interface CompanyDemandContext {
  readonly companyId: EntityId;
  readonly sector: CompanySector;
  readonly buildingId: EntityId;
  readonly districtId: EntityId | null;
  readonly day: number;
  readonly hour: number;
}

/**
 * Injectable demand signal. Returns a non-negative multiplier: 1 is a normal
 * trading hour and 0 means no customers. Implementations must be pure
 * functions of the context so tests can pin demand to a constant.
 */
export type DemandModel = (context: CompanyDemandContext) => number;

/** Everything a revenue model may look at for one trading hour. */
export interface CompanyRevenueContext extends CompanyDemandContext {
  readonly demand: number;
  readonly employees: number;
  readonly capacity: number;
  /** 1 while the hour is inside opening hours, 0 while closed. */
  readonly openFraction: number;
  readonly wagePerHour: number;
}

/** Injectable price/revenue model; returns sim currency for one hour. */
export type RevenueModel = (context: CompanyRevenueContext) => number;

/**
 * Injectable employment API. The system never touches citizen records: it asks
 * the market for staff and releases them back, and the market owns the join.
 */
export interface LabourMarket {
  /** Requests up to `count` employees; returns the ids actually hired. */
  requestEmployees(companyId: EntityId, count: number): readonly EntityId[];
  /** Releases employees; returns the ids actually released. */
  releaseEmployees(companyId: EntityId, employeeIds: readonly EntityId[]): readonly EntityId[];
}

/** Options for {@link createOpenLabourMarket}. */
export interface OpenLabourMarketOptions {
  /** Prefix of the synthetic worker ids it hands out. Defaults to `worker`. */
  namePrefix?: string;
}

/**
 * A labour market with an unlimited pool, used when no economy system is
 * wired in yet. It hands out stable synthetic worker ids; the economy task
 * replaces it with the real citizen-backed market.
 */
export function createOpenLabourMarket(options: OpenLabourMarketOptions = {}): LabourMarket {
  const prefix = options.namePrefix ?? 'worker';
  let issued = 0;
  return {
    requestEmployees(_companyId: EntityId, count: number): readonly EntityId[] {
      const wanted = Math.max(0, Math.floor(count));
      const hired: EntityId[] = [];
      for (let index = 0; index < wanted; index += 1) {
        issued += 1;
        hired.push(`${prefix}-${issued}`);
      }
      return hired;
    },
    releaseEmployees(_companyId: EntityId, employeeIds: readonly EntityId[]): readonly EntityId[] {
      return [...employeeIds];
    },
  };
}

/* ------------------------------------------------------------- modelling -- */

/** Default daily demand curve: a smooth bell around each sector's peak. */
export function defaultDemandModel(context: CompanyDemandContext): number {
  const profile = sectorProfile(context.sector);
  const hour = ((Math.floor(context.hour) % 24) + 24) % 24;
  const offset = hour - profile.demandPeakHour;
  const bell = Math.exp(-(offset * offset) / (2 * profile.demandWidthHours * profile.demandWidthHours));
  const base = profile.demandFloor + (1 - profile.demandFloor) * bell;
  const dayOfWeek = ((Math.floor(context.day) % 7) + 7) % 7;
  const weekend = dayOfWeek === 5 || dayOfWeek === 6;
  return Math.max(0, base * (weekend ? profile.weekendFactor : 1));
}

/** How many potential customers a trading slot attracts at demand 1. */
const CUSTOMERS_PER_SLOT = 3;

/**
 * Default revenue model: customers arrive with the demand signal, employees
 * serve them at the sector's rate, and the smaller of the two sets the take.
 * Closed hours earn nothing.
 */
export function defaultRevenueModel(context: CompanyRevenueContext): number {
  if (context.openFraction <= 0 || context.employees <= 0) {
    return 0;
  }
  const profile = sectorProfile(context.sector);
  const potentialCustomers = context.demand * context.capacity * CUSTOMERS_PER_SLOT * context.openFraction;
  const serviceCapacity = context.employees * profile.customersPerEmployeeHour;
  const served = Math.max(0, Math.min(potentialCustomers, serviceCapacity));
  return served * profile.revenuePerCustomer;
}

/* ---------------------------------------------------------------- ledger -- */

/** One posted sim-hour of a company's ledger. */
export interface CompanyLedgerEntry {
  /** Day index the hour belonged to (see `SimClock`). */
  readonly day: number;
  /** Hour-of-day that was settled (0..23). */
  readonly hour: number;
  /** Sim currency earned during the hour. */
  readonly revenue: number;
  /** Sim currency paid to employees during the hour. */
  readonly wageCosts: number;
  /** Rent, utilities and maintenance paid during the hour. */
  readonly otherCosts: number;
  /** `wageCosts + otherCosts`. */
  readonly totalCosts: number;
  /** `revenue - totalCosts`. */
  readonly netCash: number;
  /** Cash balance right after this posting. */
  readonly cashAfter: number;
  /** Headcount that traded during the hour. */
  readonly employees: number;
  /** Demand reading used for the hour. */
  readonly demand: number;
  /** Whether the hour fell inside the company's opening hours. */
  readonly open: boolean;
  /** Viability state during the hour. */
  readonly state: CompanyState;
}

/**
 * The company record stored in `WorldMap.companies`.
 *
 * It is a structural superset of the shared {@link Company} contract, so the
 * standard fields stay readable by the economy/HUD, while the extra fields give
 * the detail inspector the sector, wage level, address, viability state and
 * rolling ledger it needs.
 */
export interface CompanyRecord extends Company {
  /** Street address copied from the premises. */
  readonly address: string;
  /** District the premises sit in, when the world exposes it. */
  readonly districtId: EntityId | null;
  /** Kind of building the company occupies. */
  readonly siteKind: BuildingKind;
  /** Pay tier offered. */
  readonly wageLevel: CompanyWageLevel;
  /** Sim currency paid per employee per worked sim-hour. */
  readonly wagePerHour: number;
  /** Maximum headcount the premises support (the building's `jobSlots`). */
  readonly capacity: number;
  /** Rolling per-sim-hour ledger, newest last (capped at `maxHistoryHours`). */
  readonly revenueHistory: CompanyLedgerEntry[];
  /** Revenue posted during the most recent sim-hour. */
  revenuePerHour: number;
  /** Wage costs posted during the most recent sim-hour. */
  wageCostsPerHour: number;
  /** Other costs posted during the most recent sim-hour. */
  otherCostsPerHour: number;
  /** Total costs posted during the most recent sim-hour. */
  costsPerHour: number;
  /** Lifetimes figures, independent of the daily `revenue`/`costs` counters. */
  totalRevenue: number;
  totalCosts: number;
  /** Number of hourly postings made since the company opened. */
  postCount: number;
  /** Most recent demand reading. */
  demand: number;
  /** Headcount the staffing rule is steering towards. */
  targetEmployees: number;
  /** Current viability state. */
  state: CompanyState;
  /** Day the company last entered a non-healthy state, or null while healthy. */
  troubledSinceDay: number | null;
}

/* ------------------------------------------------------------- options -- */

/** Context handed to an {@link InitialCashModel}. */
export interface CompanySeedContext {
  readonly sector: CompanySector;
  readonly capacity: number;
  readonly ordinal: number;
  readonly buildingId: EntityId;
}

/** Starting cash for a newly placed company. */
export type InitialCashModel = (context: CompanySeedContext) => number;

/** Construction options for {@link CompaniesSystem}. */
export interface CompaniesSystemOptions {
  /** System name; defaults to `companies`. Must be unique per engine. */
  name?: string;
  /** Demand signal; defaults to {@link defaultDemandModel}. */
  demandModel?: DemandModel;
  /** Price/revenue model; defaults to {@link defaultRevenueModel}. */
  revenueModel?: RevenueModel;
  /** Employment API; defaults to {@link createOpenLabourMarket}. */
  labourMarket?: LabourMarket;
  /** Building kinds eligible for a company; defaults to commercial premises. */
  siteKinds?: readonly BuildingKind[];
  /** Rolling ledger length kept per company. Defaults to one sim-week (168). */
  maxHistoryHours?: number;
  /** Starting cash, as a constant or a per-company model. */
  initialCash?: number | InitialCashModel;
  /** Seed headcount from demand on placement, or start empty. Default `demand`. */
  initialStaffing?: 'demand' | 'none';
  /** Day index used for the initial staffing decision. Defaults to 0. */
  startDay?: number;
  /** Hour-of-day used for the initial staffing decision. Defaults to 8. */
  startHour?: number;
  /** Below this many hours of runway a company turns troubled. Defaults to 24. */
  troubleRunwayHours?: number;
  /** Runway a troubled company must regain to turn healthy. Defaults to 48. */
  recoveryRunwayHours?: number;
  /** Cash deficit that marks a company insolvent. Defaults to 50_000. */
  bankruptcyFloor?: number;
  /** Fraction of the demand target a troubled company keeps. Defaults to 0.6. */
  shrinkFactor?: number;
}

/** Aggregate reading over every company the system owns. */
export interface CompanyTotals {
  readonly companyCount: number;
  readonly sectorCount: number;
  readonly employeeCount: number;
  readonly capacity: number;
  /** Current-day revenue summed over every company. */
  readonly revenue: number;
  /** Current-day costs summed over every company. */
  readonly costs: number;
  readonly netProfit: number;
  readonly cash: number;
  readonly troubledCount: number;
  readonly insolventCount: number;
  readonly hoursSettled: number;
}

const DEFAULT_SYSTEM_NAME = 'companies';
const DEFAULT_MAX_HISTORY_HOURS = 168;
const DEFAULT_TROUBLE_RUNWAY_HOURS = 24;
const DEFAULT_RECOVERY_RUNWAY_HOURS = 48;
const DEFAULT_BANKRUPTCY_FLOOR = 50_000;
const DEFAULT_SHRINK_FACTOR = 0.6;
const DEFAULT_START_DAY = 0;
const DEFAULT_START_HOUR = 8;

/* ----------------------------------------------------------- site helpers -- */

/**
 * Headcount capacity of a premises: the world's `jobSlots`, falling back to the
 * shared `capacity` field for worlds that only implement the base contract.
 */
function jobSlotsOf(building: Building): number {
  const slots = (building as Partial<WorldBuilding>).jobSlots;
  if (typeof slots === 'number' && Number.isFinite(slots)) {
    return Math.max(0, Math.floor(slots));
  }
  return Math.max(0, Math.floor(building.capacity));
}

/** Address of a premises, falling back to its name. */
function addressOf(building: Building): string {
  const address = (building as Partial<WorldBuilding>).address;
  return typeof address === 'string' && address.length > 0 ? address : building.name;
}

/** District id of a premises, when the world exposes one. */
function districtIdOf(building: Building): EntityId | null {
  const districtId = (building as Partial<WorldBuilding>).districtId;
  return typeof districtId === 'string' && districtId.length > 0 ? districtId : null;
}

/**
 * Sector a premises hosts. Shops alternate between retail and hospitality so
 * both commercial sectors appear in the city; factories and warehouses become
 * industry and logistics; offices host office-services firms.
 */
function sectorForBuildingKind(kind: BuildingKind, ordinalAmongKind: number): CompanySector {
  switch (kind) {
    case 'shop':
      return ordinalAmongKind % 2 === 0 ? 'retail' : 'hospitality';
    case 'office':
      return 'office';
    case 'factory':
      return 'manufacturing';
    case 'warehouse':
      return 'logistics';
    case 'school':
    case 'hospital':
    case 'civic':
      return 'civic';
    default:
      return 'retail';
  }
}

/** Deterministic, unique-per-sector business name. */
function companyNameFor(sector: CompanySector, ordinal: number): string {
  const pool = sectorProfile(sector).namePool;
  if (pool.length === 0) {
    return `${sector} company ${ordinal}`;
  }
  const index = (ordinal - 1) % pool.length;
  const wrap = Math.floor((ordinal - 1) / pool.length);
  return wrap === 0 ? pool[index] : `${pool[index]} ${wrap + 1}`;
}

/** Rounds money to cents so ledgers stay free of floating point noise. */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Clamps a demand reading into `[0, MAX_DEMAND]`, treating NaN as zero. */
function clampDemand(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(MAX_DEMAND, value));
}

function normaliseHour(hour: number): number {
  return ((Math.floor(hour) % 24) + 24) % 24;
}

/**
 * Default starting cash: enough to pay a fully staffed premises for a couple of
 * sim-days, which leaves new companies above the trouble runway.
 */
function defaultInitialCash(capacity: number, profile: CompanySectorProfile): number {
  return roundMoney(capacity * profile.wagePerHour * 40 + profile.rentPerHour * 240);
}

/* ------------------------------------------------------------- the system -- */

/**
 * Places companies into eligible buildings and runs their hourly economy.
 *
 * Lifecycle: construct with the world (companies are placed immediately and
 * appended to `world.companies`), `attach()` to an engine to receive hour
 * boundaries, and let the engine call `update()` each fixed step.
 */
export class CompaniesSystem implements SimSystem {
  readonly name: string;

  private readonly world: WorldMap;
  private readonly demandModel: DemandModel;
  private readonly revenueModel: RevenueModel;
  private readonly labour: LabourMarket;
  private readonly siteKinds: readonly BuildingKind[];
  private readonly maxHistoryHours: number;
  private readonly initialCash: number | InitialCashModel | undefined;
  private readonly initialStaffing: 'demand' | 'none';
  private readonly startDay: number;
  private readonly startHour: number;
  private readonly troubleRunwayHours: number;
  private readonly recoveryRunwayHours: number;
  private readonly bankruptcyFloor: number;
  private readonly shrinkFactor: number;

  private readonly companyList: CompanyRecord[] = [];
  private readonly companyIndex = new Map<EntityId, CompanyRecord>();
  private placed = false;
  private hoursSettled = 0;
  private lastTick = 0;
  private lastMinute = 0;

  constructor(world: WorldMap, options: CompaniesSystemOptions = {}) {
    this.world = world;
    this.name = options.name ?? DEFAULT_SYSTEM_NAME;
    this.demandModel = options.demandModel ?? defaultDemandModel;
    this.revenueModel = options.revenueModel ?? defaultRevenueModel;
    this.labour = options.labourMarket ?? createOpenLabourMarket();
    this.siteKinds = options.siteKinds ?? COMMERCIAL_SITE_KINDS;

    const maxHistoryHours = options.maxHistoryHours ?? DEFAULT_MAX_HISTORY_HOURS;
    if (!Number.isInteger(maxHistoryHours) || maxHistoryHours < 1) {
      throw new RangeError(
        `CompaniesSystem maxHistoryHours must be a positive integer, received ${maxHistoryHours}`,
      );
    }
    this.maxHistoryHours = maxHistoryHours;

    this.initialCash = options.initialCash;
    this.initialStaffing = options.initialStaffing ?? 'demand';

    const startDay = options.startDay ?? DEFAULT_START_DAY;
    if (!Number.isInteger(startDay) || startDay < 0) {
      throw new RangeError(`CompaniesSystem startDay must be a non-negative integer, received ${startDay}`);
    }
    this.startDay = startDay;

    const startHour = options.startHour ?? DEFAULT_START_HOUR;
    if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
      throw new RangeError(`CompaniesSystem startHour must be an integer between 0 and 23, received ${startHour}`);
    }
    this.startHour = startHour;

    this.troubleRunwayHours = assertNonNegative(
      options.troubleRunwayHours ?? DEFAULT_TROUBLE_RUNWAY_HOURS,
      'troubleRunwayHours',
    );
    this.recoveryRunwayHours = assertNonNegative(
      options.recoveryRunwayHours ?? DEFAULT_RECOVERY_RUNWAY_HOURS,
      'recoveryRunwayHours',
    );
    this.bankruptcyFloor = assertNonNegative(
      options.bankruptcyFloor ?? DEFAULT_BANKRUPTCY_FLOOR,
      'bankruptcyFloor',
    );

    const shrinkFactor = options.shrinkFactor ?? DEFAULT_SHRINK_FACTOR;
    if (!Number.isFinite(shrinkFactor) || shrinkFactor <= 0 || shrinkFactor > 1) {
      throw new RangeError(
        `CompaniesSystem shrinkFactor must be a number in (0, 1], received ${shrinkFactor}`,
      );
    }
    this.shrinkFactor = shrinkFactor;

    this.placeCompanies();
  }

  /* ----------------------------------------------------------- lifecycle -- */

  /** Read-only view of the companies this system placed, in placement order. */
  get companies(): readonly CompanyRecord[] {
    return [...this.companyList];
  }

  /** Number of hourly boundaries settled since construction. */
  get hoursSettledCount(): number {
    return this.hoursSettled;
  }

  /** Last engine tick seen by `update()`. */
  get ticksSeen(): number {
    return this.lastTick;
  }

  /** Total sim-minutes on the clock when `update()` last ran. */
  get simMinute(): number {
    return this.lastMinute;
  }

  /** Called once when the engine attaches the system. */
  onAttach(_context: EngineContext): void {
    this.placeCompanies();
  }

  /** Called once per fixed step; the hourly economy runs on `onHourEnd`. */
  update(context: EngineContext): void {
    this.lastTick = context.tick;
    this.lastMinute = context.clock.totalMinutes;
  }

  /**
   * Settles the sim-hour that just ended: posts revenue and costs exactly once
   * per company, then re-staffs and re-evaluates viability for the next one.
   */
  onHourEnd(_context: EngineContext, boundary: HourBoundary): void {
    const day = boundary.endedDay;
    const hour = normaliseHour(boundary.endedHour);
    for (const company of this.companyList) {
      this.stepCompany(company, day, hour);
    }
    if (boundary.startedHour === 0) {
      // A new sim-day began: the daily revenue/cost counters start from zero
      // again while cash and the rolling ledger carry over.
      for (const company of this.companyList) {
        company.revenue = 0;
        company.costs = 0;
      }
    }
    this.hoursSettled += 1;
  }

  /* -------------------------------------------------------------- lookups -- */

  /** Company by id, or `null` when unknown. */
  companyById(companyId: EntityId): CompanyRecord | null {
    return this.companyIndex.get(companyId) ?? null;
  }

  /** Rolling hourly ledger of a company, or an empty list when unknown. */
  ledgerFor(companyId: EntityId): readonly CompanyLedgerEntry[] {
    return this.companyIndex.get(companyId)?.revenueHistory ?? [];
  }

  /** Aggregate figures over every company, for HUD-style readouts. */
  totals(): CompanyTotals {
    let employeeCount = 0;
    let capacity = 0;
    let revenue = 0;
    let costs = 0;
    let cash = 0;
    let troubledCount = 0;
    let insolventCount = 0;
    const sectors = new Set<CompanySector>();
    for (const company of this.companyList) {
      employeeCount += company.employeeCount;
      capacity += company.capacity;
      revenue += company.revenue;
      costs += company.costs;
      cash += company.cash;
      sectors.add(company.sector);
      if (company.state === 'troubled') {
        troubledCount += 1;
      } else if (company.state === 'insolvent') {
        insolventCount += 1;
      }
    }
    return {
      companyCount: this.companyList.length,
      sectorCount: sectors.size,
      employeeCount,
      capacity,
      revenue: roundMoney(revenue),
      costs: roundMoney(costs),
      netProfit: roundMoney(revenue - costs),
      cash: roundMoney(cash),
      troubledCount,
      insolventCount,
      hoursSettled: this.hoursSettled,
    };
  }

  /* ------------------------------------------------------------ placement -- */

  /** Places one company per eligible, vacant premises. Idempotent. */
  private placeCompanies(): void {
    if (this.placed) {
      return;
    }
    this.placed = true;

    const usedIds = new Set(this.world.companies.map((company) => company.id));
    const siteOrdinals = new Map<BuildingKind, number>();
    const sectorOrdinals = new Map<CompanySector, number>();

    for (const building of this.world.buildings) {
      if (!this.siteKinds.includes(building.kind)) {
        continue;
      }
      const capacity = jobSlotsOf(building);
      if (capacity <= 0) {
        continue;
      }

      const kindOrdinal = siteOrdinals.get(building.kind) ?? 0;
      siteOrdinals.set(building.kind, kindOrdinal + 1);
      const sector = sectorForBuildingKind(building.kind, kindOrdinal);

      let ordinal = sectorOrdinals.get(sector) ?? 0;
      let id: string;
      do {
        ordinal += 1;
        id = `company-${sector}-${ordinal}`;
      } while (usedIds.has(id));
      sectorOrdinals.set(sector, ordinal);
      usedIds.add(id);

      const company = this.createCompany(building, sector, ordinal, capacity, id);
      this.companyList.push(company);
      this.companyIndex.set(company.id, company);
      this.world.companies.push(company);
      // Let the inspector walk from the premises to its operator.
      building.companyId = company.id;

      if (this.initialStaffing === 'demand') {
        const openFraction = this.openFraction(company, this.startHour);
        const demand = clampDemand(
          this.demandModel(this.demandContextFor(company, this.startDay, this.startHour)),
        );
        company.demand = demand;
        this.applyStaffing(company, this.targetHeadcount(company, demand, openFraction));
      }
    }
  }

  private createCompany(
    building: Building,
    sector: CompanySector,
    ordinal: number,
    capacity: number,
    id: string,
  ): CompanyRecord {
    const profile = sectorProfile(sector);
    const seed: CompanySeedContext = { sector, capacity, ordinal, buildingId: building.id };
    const configuredCash = typeof this.initialCash === 'function' ? this.initialCash(seed) : this.initialCash;
    const cash = Math.max(0, roundMoney(configuredCash ?? defaultInitialCash(capacity, profile)));

    return {
      // Shared Company contract.
      id,
      name: companyNameFor(sector, ordinal),
      sector,
      buildingId: building.id,
      employees: [],
      employeeCount: 0,
      revenue: 0,
      costs: 0,
      cash,
      openHour: profile.openHour,
      closeHour: profile.closeHour,
      color: building.color,
      // Company detail for the inspector and HUD.
      address: addressOf(building),
      districtId: districtIdOf(building),
      siteKind: building.kind,
      wageLevel: profile.wageLevel,
      wagePerHour: profile.wagePerHour,
      capacity,
      revenueHistory: [],
      revenuePerHour: 0,
      wageCostsPerHour: 0,
      otherCostsPerHour: 0,
      costsPerHour: 0,
      totalRevenue: 0,
      totalCosts: 0,
      postCount: 0,
      demand: 0,
      targetEmployees: 0,
      state: 'healthy',
      troubledSinceDay: null,
    };
  }

  /* --------------------------------------------------------- hourly step -- */

  private stepCompany(company: CompanyRecord, day: number, hour: number): void {
    const profile = sectorProfile(company.sector);
    const context = this.demandContextFor(company, day, hour);
    const demand = clampDemand(this.demandModel(context));
    company.demand = demand;

    const openFraction = this.openFraction(company, hour);
    const revenue = roundMoney(
      Math.max(
        0,
        this.revenueModel({
          ...context,
          demand,
          employees: company.employeeCount,
          capacity: company.capacity,
          openFraction,
          wagePerHour: company.wagePerHour,
        }),
      ),
    );
    const wageCosts = roundMoney(company.employeeCount * company.wagePerHour);
    const otherCosts = roundMoney(
      profile.rentPerHour + profile.utilitiesPerEmployeeHour * company.employeeCount,
    );
    const totalCosts = roundMoney(wageCosts + otherCosts);
    const netCash = roundMoney(revenue - totalCosts);

    company.revenuePerHour = revenue;
    company.wageCostsPerHour = wageCosts;
    company.otherCostsPerHour = otherCosts;
    company.costsPerHour = totalCosts;
    company.revenue = roundMoney(company.revenue + revenue);
    company.costs = roundMoney(company.costs + totalCosts);
    company.totalRevenue = roundMoney(company.totalRevenue + revenue);
    company.totalCosts = roundMoney(company.totalCosts + totalCosts);
    company.cash = roundMoney(company.cash + netCash);

    company.revenueHistory.push({
      day,
      hour,
      revenue,
      wageCosts,
      otherCosts,
      totalCosts,
      netCash,
      cashAfter: company.cash,
      employees: company.employeeCount,
      demand,
      open: openFraction > 0,
      state: company.state,
    });
    while (company.revenueHistory.length > this.maxHistoryHours) {
      company.revenueHistory.shift();
    }
    company.postCount += 1;

    this.updateViability(company, day, profile);
    this.applyStaffing(company, this.targetHeadcount(company, demand, openFraction));
  }

  private demandContextFor(company: CompanyRecord, day: number, hour: number): CompanyDemandContext {
    return {
      companyId: company.id,
      sector: company.sector,
      buildingId: company.buildingId ?? '',
      districtId: company.districtId,
      day,
      hour,
    };
  }

  /** 1 while `hour` is inside opening hours, 0 while closed (wraps midnight). */
  private openFraction(company: CompanyRecord, hour: number): number {
    const { openHour, closeHour } = company;
    if (openHour === closeHour) {
      return 1;
    }
    if (openHour < closeHour) {
      return hour >= openHour && hour < closeHour ? 1 : 0;
    }
    return hour >= openHour || hour < closeHour ? 1 : 0;
  }

  /** Headcount the staffing rule wants for the next hour. */
  private targetHeadcount(company: CompanyRecord, demand: number, openFraction: number): number {
    const scale = company.state === 'healthy' ? 1 : this.shrinkFactor;
    const target = Math.round(demand * company.capacity * openFraction * scale);
    return Math.max(0, Math.min(company.capacity, target));
  }

  /** Hires or fires through the labour market to reach `target` headcount. */
  private applyStaffing(company: CompanyRecord, target: number): void {
    company.targetEmployees = target;
    if (target > company.employeeCount) {
      const hired = this.labour.requestEmployees(company.id, target - company.employeeCount);
      for (const employeeId of hired) {
        if (typeof employeeId !== 'string' || employeeId.length === 0) {
          continue;
        }
        if (!company.employees.includes(employeeId)) {
          company.employees.push(employeeId);
        }
      }
      company.employeeCount = company.employees.length;
      return;
    }
    if (target < company.employeeCount) {
      const released = this.labour.releaseEmployees(company.id, company.employees.slice(target));
      const releasedIds = new Set(released);
      if (releasedIds.size > 0) {
        for (let index = company.employees.length - 1; index >= 0; index -= 1) {
          if (releasedIds.has(company.employees[index])) {
            company.employees.splice(index, 1);
          }
        }
      }
      company.employeeCount = company.employees.length;
    }
  }

  /**
   * Re-evaluates the viability state after a posting. A company with negative
   * cash, or with less than `troubleRunwayHours` of cash left, turns troubled
   * (and shrinks its staffing); a deep deficit marks it insolvent. Both states
   * recover once cash and runway climb back over the recovery threshold.
   */
  private updateViability(company: CompanyRecord, day: number, profile: CompanySectorProfile): void {
    const hourlyCost = Math.max(
      1,
      roundMoney(
        company.employeeCount * company.wagePerHour +
          profile.rentPerHour +
          profile.utilitiesPerEmployeeHour * company.employeeCount,
      ),
    );
    const runwayHours = company.cash / hourlyCost;

    let next: CompanyState;
    if (company.cash < -this.bankruptcyFloor) {
      next = 'insolvent';
    } else if (company.cash < 0 || runwayHours < this.troubleRunwayHours) {
      next = 'troubled';
    } else if (runwayHours >= this.recoveryRunwayHours) {
      next = 'healthy';
    } else {
      next = company.state === 'healthy' ? 'healthy' : 'troubled';
    }

    if (next !== company.state) {
      company.state = next;
    }
    company.troubledSinceDay = next === 'healthy' ? null : (company.troubledSinceDay ?? day);
  }
}

/* ---------------------------------------------------------------- helpers -- */

function assertNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`CompaniesSystem ${label} must be a finite non-negative number, received ${value}`);
  }
  return value;
}

/** Convenience factory mirroring `createCityWorld`/`createSimFixture`. */
export function createCompaniesSystem(
  world: WorldMap,
  options: CompaniesSystemOptions = {},
): CompaniesSystem {
  return new CompaniesSystem(world, options);
}
