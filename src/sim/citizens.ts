/**
 * The citizen population.
 *
 * `CitizensSystem` fills the city produced by `src/sim/world.ts` with a
 * deterministic roster of detailed residents. Generation is seeded
 * (`CitizensSystem` takes a seed, defaulting to the world's own seed), so the
 * same world always yields the same citizens, the same households and the same
 * daily routines - in this process and in any other.
 *
 * ## What a citizen carries
 *
 * Every entry in `world.citizens` is a complete {@link Citizen} contract
 * record: a unique name, an age, a household (shared funds), a real home
 * building, a real employer building taken from the world's job slots, an
 * occupation with sector, shift hours and hourly wage, a net daily income, a
 * mood, five tracked {@link Need}s and an eight slot {@link ScheduleSlot}
 * routine. Nothing the detail inspector shows has to be invented later.
 *
 * ## The daily routine
 *
 * Each citizen owns a {@link CitizenRoutine}: a ring of eight blocks that
 * covers exactly 24 sim-hours, in the order the citizen walks through them:
 *
 * ```
 * home -> commute-to-work -> work-morning -> lunch -> work-afternoon
 *      -> commute-to-entertainment -> entertainment -> commute-home -> (home)
 * ```
 *
 * The last block arrives back at the home building exactly when the first block
 * begins, so one ring is exactly one schedule cycle per citizen per sim-day.
 * The engine advances the clock in fixed steps and calls `update()` once per
 * tick; `update()` resolves each citizen's block from the clock, so live state
 * is a pure function of sim time and cannot drift, whatever step size the
 * engine uses.
 *
 * `ScheduleSlot`/`ActivityKind` have no dedicated *commute* member, so the
 * commute legs and the lunch break are recorded as the domain's `errand`
 * activity while `insideBuildingId` is `null` and the live position walks the
 * road network. The richer {@link RoutineStage} (surfaced by `liveStateFor` and
 * `detailsFor`) names the exact leg for inspectors, renderers and the minimap.
 * While a citizen is on a commute leg the system also publishes a
 * {@link CommuteIntent} - the traffic task consumes those intents; this system
 * never spawns a vehicle and always leaves `Citizen.vehicleId` null.
 *
 * ## What the system writes to the world
 *
 * Occupancy only: `world.households` / `world.citizens` receive the generated
 * records, homes receive their `residentHouseholdIds`, and the building a
 * citizen is currently inside is listed in `Building.occupantIds` (and removed
 * again when they leave). Geometry, roads, districts and companies are never
 * touched - employment status lives on the citizen record so the economy task
 * can join citizens to companies later.
 *
 * The module is DOM-free and imports only `./clock`, `./rng`, `./types`,
 * `./world` and the engine contract types.
 */

import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from './clock';
import { createRng, hashStringToSeed } from './rng';
import type { Rng } from './rng';
import { NEED_KINDS } from './types';
import type {
  ActivityKind,
  Building,
  BuildingKind,
  Citizen,
  CompanySector,
  EntityId,
  Household,
  Need,
  NeedKind,
  Occupation,
  RoadNode,
  ScheduleSlot,
  Vec2,
  WorldMap,
} from './types';
import { buildingCenter, distanceBetweenPoints, RESIDENTIAL_BUILDING_KINDS } from './world';
import type { RoutePath } from './world';
import type { EngineContext, SimSystem, SimulationEngine } from './engine';

/* ---------------------------------------------------------------- limits -- */

/** Roster size used when the caller does not ask for a specific one. */
export const DEFAULT_CITIZEN_COUNT = 72;
/**
 * README floor: at least 50 citizens must be active simultaneously. The system
 * refuses smaller rosters rather than silently under-populating the city.
 */
export const ACTIVE_CITIZEN_FLOOR = 50;
/** Acceptance floor for this task; the default roster clears it with headroom. */
export const ROSTER_HEADROOM = 60;
/** Fraction of gross pay withheld as income tax when netting `Citizen.income`. */
export const INCOME_TAX_RATE = 0.18;
/** System name registered with the engine unless the caller overrides it. */
export const CITIZENS_SYSTEM_NAME = 'citizens';

/** Shortest / longest transit time reserved for a single commute leg. */
const MIN_COMMUTE_MINUTES = 6;
const MAX_COMMUTE_MINUTES = 90;
/** Shortest night `home` block; keeps every routine ring inside a 24h day. */
const MIN_HOME_BLOCK_MINUTES = 240;
/** How far a citizen will walk for lunch, and how much slack the break needs. */
const LUNCH_VENUE_RADIUS_TILES = 8;
/** A break always leaves at least this long at the table after the walk. */
const MIN_LUNCH_STAY_MINUTES = 15;
/** Longest break the city grants, even when the walk out and back is long. */
const MAX_LUNCH_MINUTES = 75;
/** Breaks are planned in five minute slices. */
const LUNCH_STEP_MINUTES = 5;
/** Speed of mood responding to the current need levels, per sim-hour. */
const MOOD_RESPONSE_PER_HOUR = 0.8;

/** Building kinds that offer paid work; parks and housing are excluded. */
const JOB_BUILDING_KINDS: readonly BuildingKind[] = [
  'office',
  'shop',
  'factory',
  'warehouse',
  'school',
  'hospital',
  'civic',
];

/* ------------------------------------------------------------------ names -- */

const FIRST_NAMES: readonly string[] = [
  'Ada', 'Amir', 'Ana', 'Anya', 'Beatriz', 'Bilal', 'Bruno', 'Camila',
  'Chloe', 'Dalia', 'Daniel', 'Dara', 'Dmitri', 'Elena', 'Emeka', 'Esme',
  'Farid', 'Fatima', 'Felix', 'Freya', 'Gabriel', 'Georgia', 'Hana', 'Harun',
  'Hugo', 'Ida', 'Imran', 'Iris', 'Ivan', 'Jamil', 'Jonas', 'Julia',
  'Kaito', 'Karim', 'Klara', 'Lars', 'Leila', 'Lena', 'Liam', 'Lucia',
  'Maja', 'Malik', 'Marta', 'Mateo', 'Mira', 'Nadia', 'Niels', 'Noor',
  'Olga', 'Omar', 'Oscar', 'Priya', 'Rafa', 'Ravi', 'Rosa', 'Samira',
  'Selma', 'Sofia', 'Tariq', 'Tomas', 'Uma', 'Viktor', 'Wren', 'Yusuf',
];

const LAST_NAMES: readonly string[] = [
  'Aalto', 'Abara', 'Almeida', 'Bakker', 'Bauer', 'Bellini', 'Bergstrom',
  'Costa', 'Dahl', 'Delgado', 'Dubois', 'Eriksen', 'Farkas', 'Fischer',
  'Garrido', 'Grigoryan', 'Haddad', 'Hansen', 'Ibrahim', 'Ivanova', 'Jansen',
  'Kaur', 'Keller', 'Kowalski', 'Laurent', 'Lindqvist', 'Marchetti',
  'Moreau', 'Novak', 'Okonkwo', 'Oliveira', 'Oyelaran', 'Petrov', 'Rossi',
  'Salazar', 'Schneider', 'Silva', 'Sorensen', 'Tanaka', 'Varga', 'Vasquez',
  'Weber', 'Yamamoto', 'Zieliński',
];

/** Ages are drawn from these bands; weights shape the working-age spread. */
const AGE_BANDS: readonly { readonly min: number; readonly max: number; readonly weight: number }[] = [
  { min: 18, max: 24, weight: 3 },
  { min: 25, max: 39, weight: 8 },
  { min: 40, max: 54, weight: 6 },
  { min: 55, max: 68, weight: 3 },
];

/* ---------------------------------------------------------- occupations -- */

/** One building kind's job market: sector, job titles and pay band. */
interface JobMarket {
  readonly kind: BuildingKind;
  readonly sector: CompanySector;
  readonly titles: readonly string[];
  readonly minWage: number;
  readonly maxWage: number;
}

const JOB_MARKETS: readonly JobMarket[] = [
  {
    kind: 'office',
    sector: 'office',
    titles: ['Architect', 'Accountant', 'Software Engineer', 'Policy Analyst', 'Consultant', 'Office Manager'],
    minWage: 22,
    maxWage: 46,
  },
  {
    kind: 'shop',
    sector: 'retail',
    titles: ['Shop Assistant', 'Cashier', 'Baker', 'Barista', 'Florist', 'Store Manager'],
    minWage: 12,
    maxWage: 24,
  },
  {
    kind: 'factory',
    sector: 'manufacturing',
    titles: ['Machinist', 'Assembler', 'Quality Inspector', 'Line Supervisor', 'Welder'],
    minWage: 15,
    maxWage: 28,
  },
  {
    kind: 'warehouse',
    sector: 'logistics',
    titles: ['Warehouse Operative', 'Forklift Driver', 'Dispatcher', 'Stock Controller'],
    minWage: 13,
    maxWage: 22,
  },
  {
    kind: 'school',
    sector: 'civic',
    titles: ['Teacher', 'Teaching Assistant', 'Head of Year', 'Caretaker'],
    minWage: 16,
    maxWage: 34,
  },
  {
    kind: 'hospital',
    sector: 'civic',
    titles: ['Nurse', 'Paramedic', 'Doctor', 'Ward Clerk', 'Porter'],
    minWage: 17,
    maxWage: 42,
  },
  {
    kind: 'civic',
    sector: 'civic',
    titles: ['Clerk', 'Librarian', 'Park Keeper', 'Museum Guide', 'Council Officer'],
    minWage: 15,
    maxWage: 30,
  },
];

/* ---------------------------------------------------------------- shifts -- */

/** Named shift family; citizens specialise into one of these. */
export type ShiftPatternId = 'early' | 'day' | 'late' | 'night';

interface ShiftPattern {
  readonly id: ShiftPatternId;
  readonly label: string;
  /** Hour-of-day the shift may start between, inclusive. */
  readonly startHourMin: number;
  readonly startHourMax: number;
  /** Shift length in hours, inclusive. */
  readonly minHours: number;
  readonly maxHours: number;
  readonly weight: number;
}

const SHIFT_PATTERNS: readonly ShiftPattern[] = [
  { id: 'early', label: 'early shift', startHourMin: 5, startHourMax: 7, minHours: 7, maxHours: 9, weight: 2 },
  { id: 'day', label: 'day shift', startHourMin: 8, startHourMax: 10, minHours: 7, maxHours: 9, weight: 6 },
  { id: 'late', label: 'late shift', startHourMin: 12, startHourMax: 15, minHours: 7, maxHours: 9, weight: 3 },
  { id: 'night', label: 'night shift', startHourMin: 20, startHourMax: 23, minHours: 7, maxHours: 8, weight: 2 },
];

/** Lunch breaks start this many minutes into the shift, and last this long. */
const LUNCH_START_OFFSET_MINUTES: readonly number[] = [180, 210, 240, 270, 300];
const LUNCH_LENGTH_MINUTES: readonly number[] = [30, 35, 40, 45, 50, 60];
/** Evening entertainment lasts one of these long, in minutes. */
const ENTERTAINMENT_LENGTH_MINUTES: readonly number[] = [60, 75, 90, 105, 120, 135, 150];
/** Household sizes offered during roster generation. */
const HOUSEHOLD_SIZE_CHOICES: readonly number[] = [1, 2, 2, 3, 3, 4];

/* --------------------------------------------------------------- travel -- */

/** How a citizen covers a commute leg. */
export type CommuteMode = 'foot' | 'bicycle' | 'bus' | 'tram' | 'car';

/** Every way a citizen may cover a commute leg. */
export const COMMUTE_MODES: readonly CommuteMode[] = ['foot', 'bicycle', 'bus', 'tram', 'car'];

interface CommuteModeProfile {
  readonly mode: CommuteMode;
  /** Multiplier over the world's own speed-limit travel estimate. */
  readonly travelFactor: number;
  readonly weight: number;
}

const COMMUTE_MODE_PROFILES: readonly CommuteModeProfile[] = [
  { mode: 'foot', travelFactor: 1.5, weight: 3 },
  { mode: 'bicycle', travelFactor: 0.8, weight: 4 },
  { mode: 'bus', travelFactor: 0.7, weight: 4 },
  { mode: 'tram', travelFactor: 0.55, weight: 2 },
  { mode: 'car', travelFactor: 0.45, weight: 8 },
];

/** Walking for lunch is slower than the world's car-speed routing estimate. */
const WALK_TRAVEL_FACTOR = 1.5;

/* --------------------------------------------------------------- venues -- */

/** Kind of leisure venue a building plays host to, derived per building id. */
export type VenueType =
  | 'park'
  | 'garden'
  | 'plaza'
  | 'cafe'
  | 'bar'
  | 'restaurant'
  | 'mall'
  | 'gym'
  | 'library'
  | 'museum'
  | 'cinema';

const VENUE_TYPES_BY_KIND: Readonly<Record<BuildingKind, readonly VenueType[]>> = {
  house: [],
  apartment: [],
  office: [],
  shop: ['cafe', 'bar', 'restaurant', 'mall'],
  factory: [],
  warehouse: [],
  school: [],
  hospital: [],
  park: ['park', 'garden', 'plaza'],
  civic: ['gym', 'library', 'museum', 'cinema'],
};

/** Every venue type a citizen can form a preference for. */
export const VENUE_TYPES: readonly VenueType[] = [
  'park',
  'garden',
  'plaza',
  'cafe',
  'bar',
  'restaurant',
  'mall',
  'gym',
  'library',
  'museum',
  'cinema',
];

/* ---------------------------------------------------------------- stages -- */

/**
 * One block of the routine state machine, in walking order. `commute-*` and
 * `lunch` are transit or break blocks; the remaining stages are the citizen's
 * canonical home / work / entertainment stays.
 */
export type RoutineStage =
  | 'home'
  | 'commute-to-work'
  | 'work-morning'
  | 'lunch'
  | 'work-afternoon'
  | 'commute-to-entertainment'
  | 'entertainment'
  | 'commute-home';

/** Every stage, in the order the citizen walks through them. */
export const ROUTINE_STAGES: readonly RoutineStage[] = [
  'home',
  'commute-to-work',
  'work-morning',
  'lunch',
  'work-afternoon',
  'commute-to-entertainment',
  'entertainment',
  'commute-home',
];

/** Activity the shared contract records while a stage runs. */
export const STAGE_ACTIVITY: Readonly<Record<RoutineStage, ActivityKind>> = {
  home: 'home',
  'commute-to-work': 'errand',
  'work-morning': 'work',
  lunch: 'errand',
  'work-afternoon': 'work',
  'commute-to-entertainment': 'errand',
  entertainment: 'entertainment',
  'commute-home': 'errand',
};

/** Inspector-facing label for a stage. */
export const STAGE_LABELS: Readonly<Record<RoutineStage, string>> = {
  home: 'At home',
  'commute-to-work': 'Commuting to work',
  'work-morning': 'Working (morning)',
  lunch: 'Lunch break',
  'work-afternoon': 'Working (afternoon)',
  'commute-to-entertainment': 'Heading out for the evening',
  entertainment: 'Out for entertainment',
  'commute-home': 'Commuting home',
};

/**
 * Stages that run under each shared {@link ActivityKind}; renderers and the
 * inspector use it to translate a citizen's activity back into the exact legs
 * of the routine (`errand` covers commuting and the lunch break).
 */
export const STAGES_BY_ACTIVITY: Readonly<Record<ActivityKind, readonly RoutineStage[]>> = {
  home: ['home'],
  work: ['work-morning', 'work-afternoon'],
  errand: ['commute-to-work', 'lunch', 'commute-to-entertainment', 'commute-home'],
  entertainment: ['entertainment'],
};

/* ------------------------------------------------------------------ types -- */

/**
 * World building as the citizen system needs it: the shared contract plus the
 * world's own employment and venue metadata.
 */
export interface CitizenBuilding extends Building {
  /** Job slots the building offers; 0 for housing and parks. */
  jobSlots: number;
  /** Whether the venue serves citizens during their entertainment hours. */
  leisure: boolean;
  /** Human readable street address, when the world provides one. */
  address?: string;
}

/**
 * The part of the world the citizen system consumes: the generated city with
 * its homes, workplaces, leisure venues and routable road graph.
 * `CityWorld` satisfies this interface structurally.
 */
export interface CitizenWorld extends WorldMap {
  readonly buildings: CitizenBuilding[];
  /** Every leisure-capable venue, e.g. `CityWorld.leisureVenues()`. */
  leisureVenues(): readonly CitizenBuilding[];
  /** Shortest route between two buildings' entrance nodes. */
  routeBetweenBuildings(fromBuildingId: EntityId, toBuildingId: EntityId): RoutePath | null;
  /** Road node lookup, used to turn a route into a walkable polyline. */
  roadNodeById(nodeId: EntityId): RoadNode | null;
}

/** One block of a citizen's routine ring, in minutes from the ring anchor. */
export interface RoutineBlock {
  readonly stage: RoutineStage;
  readonly activity: ActivityKind;
  /** Where the citizen ends up once the block's transit is done. */
  readonly destinationId: EntityId;
  /** Where the citizen starts the block (the previous block's destination). */
  readonly originId: EntityId;
  /** Minutes from the ring anchor to the block's first minute. */
  readonly startMinute: number;
  /** Block length in sim-minutes; always at least one minute. */
  readonly durationMinutes: number;
  /** Transit reserved at the head of the block. */
  readonly travelMinutes: number;
  /** Transit reserved at the tail of the block (off-site lunch only). */
  readonly returnTravelMinutes: number;
  /** Polyline in tile units walked while `travelMinutes` runs. */
  readonly route: readonly Vec2[];
  /** Polyline walked while `returnTravelMinutes` runs. */
  readonly returnRoute: readonly Vec2[];
  /** Road nodes of the outbound leg; the traffic task plans vehicles from these. */
  readonly nodeIds: readonly EntityId[];
  /** Outbound route distance in tile units. */
  readonly distanceTiles: number;
}

/** A citizen's personalised daily routine. */
export interface CitizenRoutine {
  readonly citizenId: EntityId;
  /** Minute-of-day at which the night `home` block begins (the ring anchor). */
  readonly anchorMinute: number;
  /** The eight blocks, in the order the citizen walks through them. */
  readonly blocks: RoutineBlock[];
  /** Stage order of `blocks`, e.g. `ROUTINE_STAGES`. */
  readonly stageOrder: RoutineStage[];
  readonly shiftPatternId: ShiftPatternId;
  readonly shiftLabel: string;
  /** Minute-of-day the shift starts; `shiftEndMinute` wraps past midnight. */
  readonly shiftStartMinute: number;
  readonly shiftEndMinute: number;
  readonly shiftMinutes: number;
  readonly commuteMode: CommuteMode;
  /** Where the citizen eats lunch (the workplace when they stay on site). */
  readonly lunchVenueId: EntityId;
  readonly lunchOffSite: boolean;
  readonly lunchMinutes: number;
  readonly lunchTravelMinutes: number;
  readonly entertainmentVenueId: EntityId;
  readonly entertainmentVenueName: string;
  readonly entertainmentVenueType: VenueType;
  readonly entertainmentMinutes: number;
}

/** Travel leg published for the traffic system while a citizen is commuting. */
export interface CommuteIntent {
  readonly citizenId: EntityId;
  readonly mode: CommuteMode;
  readonly fromBuildingId: EntityId;
  readonly toBuildingId: EntityId;
  /** Minute-of-day the leg departs / arrives (arrival may wrap past midnight). */
  readonly departMinute: number;
  readonly arriveMinute: number;
  readonly durationMinutes: number;
  readonly distanceTiles: number;
  readonly nodeIds: readonly EntityId[];
}

/** Live per-tick state the renderer, minimap and inspector read without bookkeeping. */
export interface CitizenLiveState {
  readonly citizenId: EntityId;
  readonly stage: RoutineStage;
  readonly activity: ActivityKind;
  /** Minute-of-day the reading was taken at. */
  readonly minuteOfDay: number;
  readonly insideBuildingId: EntityId | null;
  readonly travelling: boolean;
  /** Progress along the current transit leg, 0..1 (0 when not travelling). */
  readonly travelProgress: number;
  readonly position: Vec2;
  readonly destinationId: EntityId | null;
  /** Populated only while the citizen is on a commute leg. */
  readonly commuteIntent: CommuteIntent | null;
}

/** Everything the entity inspector shows for one citizen. */
export interface CitizenDetails {
  readonly id: EntityId;
  readonly name: string;
  readonly age: number;
  readonly householdId: EntityId;
  readonly homeBuildingId: EntityId;
  readonly homeName: string;
  readonly homeAddress: string | null;
  readonly workplaceBuildingId: EntityId;
  readonly workplaceName: string;
  readonly occupationTitle: string;
  readonly sector: CompanySector;
  readonly wagePerHour: number;
  readonly shiftLabel: string;
  readonly shiftHours: string;
  readonly commuteMode: CommuteMode;
  readonly income: number;
  readonly mood: number;
  readonly needs: readonly Need[];
  readonly schedule: readonly ScheduleSlot[];
  readonly stageOrder: readonly RoutineStage[];
  readonly entertainmentVenueId: EntityId;
  readonly entertainmentVenueName: string;
  readonly entertainmentVenueType: VenueType;
  readonly lunchVenueId: EntityId;
  readonly lunchOffSite: boolean;
  readonly live: CitizenLiveState | null;
}

/** Aggregate figures over the roster, for tests, HUD and diagnostics. */
export interface CitizensStats {
  citizenCount: number;
  householdCount: number;
  homeBuildingCount: number;
  workplaceCount: number;
  venueCount: number;
  employedCount: number;
  travellingCount: number;
  averageMood: number;
  averageIncome: number;
  averageAge: number;
  averageNeedLevels: Record<NeedKind, number>;
  stageCounts: Record<RoutineStage, number>;
}

/** Constructor options for {@link CitizensSystem}. */
export interface CitizensOptions {
  /** The generated city the roster is placed in. */
  world: CitizenWorld;
  /** Roster size; at least {@link ACTIVE_CITIZEN_FLOOR}. Defaults to 72. */
  count?: number;
  /** Roster seed; defaults to the world seed (or the world id). */
  seed?: number | string;
  /** Engine system name; defaults to {@link CITIZENS_SYSTEM_NAME}. */
  systemName?: string;
}

/* ---------------------------------------------------------------- helpers -- */

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  return value > max ? max : value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function compareIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/** Total length of a polyline, in tile units. */
export function polylineLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceBetweenPoints(points[index - 1], points[index]);
  }
  return total;
}

/** Point at `t` (0..1) along a polyline; clamps to the ends. */
export function pointAlongPolyline(points: readonly Vec2[], t: number): Vec2 {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  if (points.length === 1) {
    return { x: points[0].x, y: points[0].y };
  }
  const total = polylineLength(points);
  if (total <= 0) {
    return { x: points[0].x, y: points[0].y };
  }
  let remaining = clamp(t, 0, 1) * total;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const segment = distanceBetweenPoints(from, to);
    if (segment <= 0) {
      continue;
    }
    if (remaining <= segment) {
      const ratio = remaining / segment;
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    }
    remaining -= segment;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

function reversePolyline(points: readonly Vec2[]): Vec2[] {
  return points.slice().reverse();
}

/**
 * Collapses a routine to its canonical stays, e.g. `['home', 'work',
 * 'entertainment']` for a full day. `errand` blocks (commuting and the lunch
 * break) are dropped and repeats merged, so the result reads home -> work ->
 * entertainment and, closed back into a ring, is the README's daily schedule.
 */
export function canonicalActivityChain(schedule: readonly ScheduleSlot[]): ActivityKind[] {
  const chain: ActivityKind[] = [];
  for (const slot of schedule) {
    if (slot.activity === 'errand') {
      continue;
    }
    if (chain.length === 0 || chain[chain.length - 1] !== slot.activity) {
      chain.push(slot.activity);
    }
  }
  if (chain.length > 1 && chain[0] === chain[chain.length - 1]) {
    chain.pop();
  }
  return chain;
}

/**
 * How fast a need grows during a stage, as a multiple of its own
 * `growthPerHour`. A negative multiplier means the stage satisfies the need.
 */
const NEED_MULTIPLIERS: Readonly<Record<RoutineStage, Record<NeedKind, number>>> = {
  home: { hunger: 0.5, energy: -1.2, social: -0.15, fun: -0.9, hygiene: -0.8 },
  'commute-to-work': { hunger: 0.7, energy: 1.0, social: 0.7, fun: 0.8, hygiene: 0.8 },
  'work-morning': { hunger: 0.9, energy: 1.4, social: 0.3, fun: 1.0, hygiene: 0.6 },
  lunch: { hunger: -1.4, energy: -0.2, social: -0.6, fun: -0.4, hygiene: -0.2 },
  'work-afternoon': { hunger: 0.9, energy: 1.4, social: 0.3, fun: 1.0, hygiene: 0.6 },
  'commute-to-entertainment': { hunger: 0.7, energy: 1.0, social: 0.7, fun: 0.8, hygiene: 0.8 },
  entertainment: { hunger: 1.0, energy: 0.9, social: -1.4, fun: -2.2, hygiene: 0.4 },
  'commute-home': { hunger: 0.7, energy: 1.0, social: 0.7, fun: 0.8, hygiene: 0.8 },
};

/** Hunger at which a citizen stops snacking and cooks a proper meal at home. */
const HOME_MEAL_THRESHOLD = 40;

function needMultiplier(
  kind: NeedKind,
  stage: RoutineStage,
  level: number,
  householdSize: number,
): number {
  const base = NEED_MULTIPLIERS[stage][kind];
  if (stage === 'home' && kind === 'hunger') {
    return level >= HOME_MEAL_THRESHOLD ? -1.1 : base;
  }
  if (stage === 'home' && kind === 'social') {
    // Living with more people satisfies the social need faster.
    return base * (0.55 + 0.4 * Math.max(1, householdSize));
  }
  return base;
}

/** Weights used to turn need levels into a target mood. */
const MOOD_NEED_WEIGHTS: Readonly<Record<NeedKind, number>> = {
  hunger: 0.25,
  energy: 0.25,
  social: 0.18,
  fun: 0.2,
  hygiene: 0.12,
};

function targetMood(needs: readonly Need[]): number {
  let weighted = 0;
  let weightSum = 0;
  for (const need of needs) {
    const weight = MOOD_NEED_WEIGHTS[need.kind];
    weighted += need.level * weight;
    weightSum += weight;
  }
  if (weightSum <= 0) {
    return 0.5;
  }
  return clamp(1 - weighted / weightSum / 100, 0, 1);
}

/** Resolved location of a citizen at one instant of their routine ring. */
interface ResolvedState {
  stage: RoutineStage;
  activity: ActivityKind;
  insideBuildingId: EntityId | null;
  position: Vec2;
  travelling: boolean;
  travelProgress: number;
  destinationId: EntityId | null;
  block: RoutineBlock;
}

/* ----------------------------------------------------------------- system -- */

/**
 * Generates and drives the city's citizen population.
 *
 * ```ts
 * const world = createCityWorld({ seed: 7 });
 * const citizens = new CitizensSystem({ world, count: 72 });
 * engine.attach(citizens);          // or `citizens.attach(engine)`
 * engine.step(SIM_DAY_MINUTES);     // one full schedule cycle per citizen
 * ```
 */
export class CitizensSystem implements SimSystem {
  readonly name: string;
  /** The city this roster lives in. */
  readonly world: CitizenWorld;
  /** Seed the roster was generated from. */
  readonly seed: number | string;
  /** Requested roster size. */
  readonly targetCount: number;

  /** Households created for this roster, in creation order. */
  readonly households: Household[] = [];
  /** The roster, in creation order; the same records live in `world.citizens`. */
  readonly citizens: Citizen[] = [];

  private readonly routines = new Map<EntityId, CitizenRoutine>();
  private readonly liveStates = new Map<EntityId, CitizenLiveState>();
  private readonly liveBlocks = new Map<EntityId, RoutineBlock>();
  private readonly liveLocations = new Map<EntityId, EntityId | null>();
  private readonly buildingsById = new Map<EntityId, CitizenBuilding>();
  private readonly venueTypeByBuilding = new Map<EntityId, VenueType>();
  private readonly routeCache = new Map<string, RoutePath | null>();
  private rosterSummary: { homeCount: number; workplaceCount: number; venueCount: number } = {
    homeCount: 0,
    workplaceCount: 0,
    venueCount: 0,
  };
  private engineRef: SimulationEngine | null = null;
  private updateCountValue = 0;
  private minuteOfDayValue = 0;

  constructor(options: CitizensOptions) {
    if (!options || !options.world) {
      throw new TypeError('new CitizensSystem(options) expects options.world');
    }
    const world = options.world;
    if (!Array.isArray(world.buildings) || world.buildings.length === 0) {
      throw new Error('CitizensSystem needs a generated city world with buildings');
    }
    this.world = world;
    this.name = options.systemName ?? CITIZENS_SYSTEM_NAME;
    this.targetCount = options.count ?? DEFAULT_CITIZEN_COUNT;
    if (!Number.isInteger(this.targetCount) || this.targetCount < ACTIVE_CITIZEN_FLOOR) {
      throw new RangeError(
        `CitizensSystem count must be an integer >= ${ACTIVE_CITIZEN_FLOOR}, received ${this.targetCount}`,
      );
    }
    const worldSeed = (world as { seed?: unknown }).seed;
    this.seed = options.seed ?? (typeof worldSeed === 'number' ? worldSeed : world.id);

    for (const building of world.buildings) {
      this.buildingsById.set(building.id, building);
      if (building.leisure) {
        this.venueTypeByBuilding.set(building.id, deriveVenueType(building));
      }
    }
    this.generateRoster();
  }

  /* ------------------------------------------------------------ lifecycle -- */

  /** Registers this system on an engine; returns the engine's detach function. */
  attach(engine: SimulationEngine): () => boolean {
    return engine.attach(this);
  }

  /** Called once when the engine attaches the system: seeds live state. */
  onAttach(context: EngineContext): void {
    if (this.engineRef !== null && this.engineRef !== context.engine) {
      throw new Error('CitizensSystem is already attached to another SimulationEngine');
    }
    this.engineRef = context.engine;
    this.updateCountValue = 0;
    this.syncTo(context.clock.hourOfDay * 60 + context.clock.minuteOfHour, 0);
  }

  /** Called once when the system is detached or the engine is disposed. */
  onDetach(): void {
    for (const citizen of this.citizens) {
      const buildingId = this.liveLocations.get(citizen.id) ?? null;
      if (buildingId !== null) {
        this.removeOccupant(buildingId, citizen.id);
      }
      for (const building of this.world.buildings) {
        const index = building.residentHouseholdIds.indexOf(citizen.householdId);
        if (index >= 0) {
          building.residentHouseholdIds.splice(index, 1);
        }
      }
    }
    this.liveLocations.clear();
    this.liveStates.clear();
    this.liveBlocks.clear();
    this.engineRef = null;
  }

  /**
   * Advances every citizen by one fixed engine step: resolves their routine
   * block from the clock, moves them, and grows their needs and mood.
   */
  update(context: EngineContext): void {
    this.updateCountValue += 1;
    this.syncTo(context.clock.hourOfDay * 60 + context.clock.minuteOfHour, context.deltaMinutes / 60);
  }

  /* -------------------------------------------------------------- reading -- */

  get attached(): boolean {
    return this.engineRef !== null;
  }

  /** Fixed steps applied through the engine so far. */
  get updateCount(): number {
    return this.updateCountValue;
  }

  /** Minute-of-day of the latest reading. */
  get minuteOfDay(): number {
    return this.minuteOfDayValue;
  }

  /** Every citizen in the roster. All of them are active simultaneously. */
  activeCitizens(): readonly Citizen[] {
    return this.citizens;
  }

  citizenById(citizenId: EntityId): Citizen | null {
    return this.citizens.find((citizen) => citizen.id === citizenId) ?? null;
  }

  buildingById(buildingId: EntityId): CitizenBuilding | null {
    return this.buildingsById.get(buildingId) ?? null;
  }

  /** The personalised routine of one citizen. */
  routineFor(citizenId: EntityId): CitizenRoutine | null {
    return this.routines.get(citizenId) ?? null;
  }

  /** Every routine in the roster, in citizen order. */
  allRoutines(): CitizenRoutine[] {
    return this.citizens
      .map((citizen) => this.routines.get(citizen.id))
      .filter((routine): routine is CitizenRoutine => routine !== undefined);
  }

  /** Live per-tick state of one citizen, or `null` before the first attach. */
  liveStateFor(citizenId: EntityId): CitizenLiveState | null {
    return this.liveStates.get(citizenId) ?? null;
  }

  /** Current routine stage of one citizen, or `null` before the first attach. */
  stageFor(citizenId: EntityId): RoutineStage | null {
    return this.liveStates.get(citizenId)?.stage ?? null;
  }

  /** Venue type a building plays host to, or `null` for non-leisure buildings. */
  venueTypeFor(buildingId: EntityId): VenueType | null {
    return this.venueTypeByBuilding.get(buildingId) ?? null;
  }

  /** Commute legs currently under way, ready for the traffic task to consume. */
  pendingCommuteIntents(): CommuteIntent[] {
    const intents: CommuteIntent[] = [];
    for (const state of this.liveStates.values()) {
      if (state.commuteIntent) {
        intents.push(state.commuteIntent);
      }
    }
    return intents;
  }

  /** Everything the detail inspector shows for one citizen. */
  detailsFor(citizenId: EntityId): CitizenDetails | null {
    const citizen = this.citizenById(citizenId);
    const routine = this.routines.get(citizenId);
    if (!citizen || !routine) {
      return null;
    }
    const home = this.buildingById(citizen.homeBuildingId);
    const workplace = citizen.occupation.workplaceBuildingId
      ? this.buildingById(citizen.occupation.workplaceBuildingId)
      : null;
    const shift = citizen.occupation;
    return {
      id: citizen.id,
      name: citizen.name,
      age: citizen.age,
      householdId: citizen.householdId,
      homeBuildingId: citizen.homeBuildingId,
      homeName: home?.name ?? citizen.homeBuildingId,
      homeAddress: home?.address ?? null,
      workplaceBuildingId: shift.workplaceBuildingId ?? '',
      workplaceName: workplace?.name ?? 'unemployed',
      occupationTitle: shift.title,
      sector: shift.sector,
      wagePerHour: shift.wagePerHour,
      shiftLabel: routine.shiftLabel,
      shiftHours: `${formatHour(routine.shiftStartMinute)}-${formatHour(routine.shiftEndMinute)}`,
      commuteMode: routine.commuteMode,
      income: citizen.income,
      mood: citizen.mood,
      needs: citizen.needs,
      schedule: citizen.schedule,
      stageOrder: routine.stageOrder,
      entertainmentVenueId: routine.entertainmentVenueId,
      entertainmentVenueName: routine.entertainmentVenueName,
      entertainmentVenueType: routine.entertainmentVenueType,
      lunchVenueId: routine.lunchVenueId,
      lunchOffSite: routine.lunchOffSite,
      live: this.liveStateFor(citizenId),
    };
  }

  /** Aggregate figures over the roster and its current live state. */
  stats(): CitizensStats {
    const stageCounts: Record<RoutineStage, number> = {
      home: 0,
      'commute-to-work': 0,
      'work-morning': 0,
      lunch: 0,
      'work-afternoon': 0,
      'commute-to-entertainment': 0,
      entertainment: 0,
      'commute-home': 0,
    };
    const needTotals = new Map<NeedKind, number>();
    let moodTotal = 0;
    let incomeTotal = 0;
    let ageTotal = 0;
    let employed = 0;
    let travelling = 0;
    for (const citizen of this.citizens) {
      moodTotal += citizen.mood;
      incomeTotal += citizen.income;
      ageTotal += citizen.age;
      if (citizen.occupation.workplaceBuildingId !== null) {
        employed += 1;
      }
      for (const need of citizen.needs) {
        needTotals.set(need.kind, (needTotals.get(need.kind) ?? 0) + need.level);
      }
      const state = this.liveStates.get(citizen.id);
      if (state) {
        stageCounts[state.stage] += 1;
        if (state.travelling) {
          travelling += 1;
        }
      }
    }
    const count = Math.max(1, this.citizens.length);
    const averageNeedLevels = {} as Record<NeedKind, number>;
    for (const kind of NEED_KINDS) {
      averageNeedLevels[kind] = round2((needTotals.get(kind) ?? 0) / count);
    }
    return {
      citizenCount: this.citizens.length,
      householdCount: this.households.length,
      homeBuildingCount: this.rosterSummary.homeCount,
      workplaceCount: this.rosterSummary.workplaceCount,
      venueCount: this.rosterSummary.venueCount,
      employedCount: employed,
      travellingCount: travelling,
      averageMood: round2(moodTotal / count),
      averageIncome: round2(incomeTotal / count),
      averageAge: round2(ageTotal / count),
      averageNeedLevels,
      stageCounts,
    };
  }

  /**
   * Stable JSON summary of the generated roster: identities, homes, jobs,
   * income, shifts and routines. Live values (mood, current need levels) are
   * deliberately excluded so the fingerprint identifies the roster itself.
   */
  fingerprint(): string {
    return JSON.stringify(
      this.citizens.map((citizen) => {
        const routine = this.routines.get(citizen.id);
        return {
          id: citizen.id,
          name: citizen.name,
          age: citizen.age,
          householdId: citizen.householdId,
          homeBuildingId: citizen.homeBuildingId,
          workplaceBuildingId: citizen.occupation.workplaceBuildingId,
          title: citizen.occupation.title,
          shift: [citizen.occupation.shiftStartHour, citizen.occupation.shiftEndHour],
          wagePerHour: citizen.occupation.wagePerHour,
          income: citizen.income,
          needs: citizen.needs.map((need) => [need.kind, round2(need.growthPerHour)]),
          schedule: citizen.schedule.map((slot) => [
            slot.activity,
            round2(slot.startHour),
            round2(slot.endHour),
            slot.destinationId,
          ]),
          venue: routine?.entertainmentVenueId ?? null,
          mode: routine?.commuteMode ?? null,
        };
      }),
    );
  }

  /* --------------------------------------------------------- roster build -- */

  /**
   * Builds households and citizens deterministically from the world and seed:
   * homes are toured in a seeded order so households of one to four residents
   * spread across the city instead of packing the first house full.
   */
  private generateRoster(): void {
    const rng = createRng(this.seed).fork('citizen-roster');
    const homes = this.sortedBuildings(RESIDENTIAL_BUILDING_KINDS, (building) => building.capacity > 0);
    const workplaces = this.sortedBuildings(JOB_BUILDING_KINDS, (building) => building.jobSlots > 0);
    const venues = [...this.world.leisureVenues()].sort((left, right) => compareIds(left.id, right.id));

    if (homes.length === 0) {
      throw new Error('CitizensSystem needs at least one residential building (house or apartment)');
    }
    if (workplaces.length === 0) {
      throw new Error(`CitizensSystem needs at least one workplace (${JOB_BUILDING_KINDS.join(', ')})`);
    }
    if (venues.length === 0) {
      throw new Error('CitizensSystem needs at least one leisure venue for daily entertainment');
    }
    const housingCapacity = homes.reduce((total, home) => total + home.capacity, 0);
    if (housingCapacity < this.targetCount) {
      throw new Error(
        `world housing capacity ${housingCapacity} cannot hold the requested ${this.targetCount} citizens`,
      );
    }
    this.rosterSummary = {
      homeCount: homes.length,
      workplaceCount: workplaces.length,
      venueCount: venues.length,
    };

    const homeOrder = rng.shuffle(homes);
    const jobWeights = workplaces.map((workplace) => workplace.jobSlots);
    const usedNames = new Set<string>();
    const roomByHome = new Map<EntityId, number>();
    for (const home of homeOrder) {
      roomByHome.set(home.id, home.capacity);
    }

    // One household per home per pass keeps the population spread out.
    let pass = 0;
    while (this.citizens.length < this.targetCount && pass < 64) {
      for (const home of homeOrder) {
        if (this.citizens.length >= this.targetCount) {
          break;
        }
        const room = roomByHome.get(home.id) ?? 0;
        if (room <= 0) {
          continue;
        }
        const size = Math.min(
          room,
          rng.pick(HOUSEHOLD_SIZE_CHOICES),
          this.targetCount - this.citizens.length,
        );
        if (size <= 0) {
          continue;
        }
        this.createHousehold(home, size, rng, workplaces, jobWeights, venues, usedNames);
        roomByHome.set(home.id, room - size);
      }
      pass += 1;
    }
    if (this.citizens.length < this.targetCount) {
      throw new Error(
        `roster generation placed ${this.citizens.length} of ${this.targetCount} citizens`,
      );
    }
  }

  private sortedBuildings(
    kinds: readonly BuildingKind[],
    predicate: (building: CitizenBuilding) => boolean,
  ): CitizenBuilding[] {
    return this.world.buildings
      .filter((building) => kinds.includes(building.kind) && predicate(building))
      .slice()
      .sort((left, right) => compareIds(left.id, right.id));
  }

  private createHousehold(
    home: CitizenBuilding,
    size: number,
    rng: Rng,
    workplaces: CitizenBuilding[],
    jobWeights: number[],
    venues: CitizenBuilding[],
    usedNames: Set<string>,
  ): void {
    const householdId = `household-${this.households.length + 1}`;
    const household: Household = {
      id: householdId,
      homeBuildingId: home.id,
      memberIds: [],
      funds: 0,
    };
    this.households.push(household);
    this.world.households.push(household);
    if (!home.residentHouseholdIds.includes(householdId)) {
      home.residentHouseholdIds.push(householdId);
    }
    let dailyIncome = 0;
    for (let member = 0; member < size; member += 1) {
      const citizen = this.createCitizen(household, home, rng, workplaces, jobWeights, venues, usedNames);
      dailyIncome += citizen.income;
    }
    household.funds = Math.round(dailyIncome * rng.intInclusive(18, 55));
  }

  private createCitizen(
    household: Household,
    home: CitizenBuilding,
    rng: Rng,
    workplaces: CitizenBuilding[],
    jobWeights: number[],
    venues: CitizenBuilding[],
    usedNames: Set<string>,
  ): Citizen {
    const id = `citizen-${this.citizens.length + 1}`;
    const name = uniqueName(rng, usedNames);
    const age = pickAge(rng);
    const workplace = rng.pickWeighted(workplaces, jobWeights);
    const market = JOB_MARKET_FOR_KIND.get(workplace.kind) ?? JOB_MARKETS[0];
    const title = rng.pick(market.titles);
    const wagePerHour = round2(rng.float(market.minWage, market.maxWage) * rng.float(0.92, 1.12));
    const shift = rng.pickWeighted(SHIFT_PATTERNS, SHIFT_PATTERNS.map((pattern) => pattern.weight));
    const shiftStartMinute =
      mod(shift.startHourMin * MINUTES_PER_HOUR + rng.intInclusive(0, 3) * 15, MINUTES_PER_DAY);
    const shiftHours = rng.intInclusive(shift.minHours, shift.maxHours);
    const shiftMinutes = shiftHours * MINUTES_PER_HOUR;

    const occupation: Occupation = {
      title,
      sector: market.sector,
      // Companies arrive with the economy task; employment lives on the record.
      companyId: null,
      workplaceBuildingId: workplace.id,
      shiftStartHour: shiftStartMinute / MINUTES_PER_HOUR,
      shiftEndHour: mod(shiftStartMinute + shiftMinutes, MINUTES_PER_DAY) / MINUTES_PER_HOUR,
      wagePerHour,
    };

    const needs = NEED_KINDS.map((kind) => ({
      kind,
      level: round2(rng.float(6, 42)),
      growthPerHour: round2(BASE_NEED_GROWTH[kind] * rng.float(0.85, 1.15)),
    }));

    const citizen: Citizen = {
      id,
      name,
      age,
      householdId: household.id,
      household,
      homeBuildingId: home.id,
      occupation,
      income: round2(wagePerHour * shiftHours * (1 - INCOME_TAX_RATE)),
      mood: clamp(rng.float(0.4, 0.85), 0, 1),
      needs,
      // Filled in below, once the routine ring is known.
      schedule: [],
      currentActivity: 'home',
      insideBuildingId: home.id,
      position: buildingCenter(home),
      vehicleId: null,
    };
    this.citizens.push(citizen);
    this.world.citizens.push(citizen);
    household.memberIds.push(citizen.id);

    const routine = this.buildRoutine(citizen, home, workplace, venues, rng, shift, shiftStartMinute, shiftMinutes);
    this.routines.set(citizen.id, routine);
    citizen.schedule = scheduleFor(routine);
    return citizen;
  }

  /**
   * Lays the eight routine blocks onto a 1440 minute ring anchored at the start
   * of the night `home` block. Commute blocks are sized from the world's real
   * routes, so citizens arrive exactly when their shift or outing begins and
   * the ring always closes back on the home block.
   */
  private buildRoutine(
    citizen: Citizen,
    home: CitizenBuilding,
    workplace: CitizenBuilding,
    venues: CitizenBuilding[],
    rng: Rng,
    shift: ShiftPattern,
    shiftStartMinute: number,
    shiftMinutes: number,
  ): CitizenRoutine {
    const modeProfile = rng.pickWeighted(COMMUTE_MODE_PROFILES, COMMUTE_MODE_PROFILES.map((entry) => entry.weight));
    const venue = this.pickEntertainmentVenue(home, venues, rng);
    const commuteToWork = this.commuteMinutes(home.id, workplace.id, modeProfile.travelFactor);
    const commuteToVenue = this.commuteMinutes(workplace.id, venue.id, modeProfile.travelFactor);
    const commuteHome = this.commuteMinutes(venue.id, home.id, modeProfile.travelFactor);

    const preferredLunchMinutes = rng.pick(LUNCH_LENGTH_MINUTES);
    const lunchOffsetMinutes = rng.pick(LUNCH_START_OFFSET_MINUTES);
    const lunch = this.planLunch(workplace, venues, preferredLunchMinutes);
    const lunchMinutes = lunch.lunchMinutes;
    const entertainmentMinutes = rng.pick(ENTERTAINMENT_LENGTH_MINUTES);

    // work-morning + lunch + work-afternoon always add up to the shift length.
    const workMorning = lunchOffsetMinutes;
    const workAfternoon = shiftMinutes - lunchOffsetMinutes - lunchMinutes;
    if (workAfternoon <= 0) {
      throw new Error(`shift ${shiftMinutes} minutes is too short for a ${lunchMinutes} minute lunch break`);
    }

    const homeMinutes =
      MINUTES_PER_DAY -
      (commuteToWork + shiftMinutes + commuteToVenue + entertainmentMinutes + commuteHome);
    if (homeMinutes < MIN_HOME_BLOCK_MINUTES) {
      throw new Error(
        `routine for ${citizen.id} leaves only ${homeMinutes} minutes at home, below the ${MIN_HOME_BLOCK_MINUTES} minute floor`,
      );
    }

    const anchorMinute = mod(shiftStartMinute - commuteToWork - homeMinutes, MINUTES_PER_DAY);
    const stages: readonly RoutineStage[] = ROUTINE_STAGES;
    const durations: readonly number[] = [
      homeMinutes,
      commuteToWork,
      workMorning,
      lunchMinutes,
      workAfternoon,
      commuteToVenue,
      entertainmentMinutes,
      commuteHome,
    ];
    const destinations: readonly EntityId[] = [
      home.id,
      workplace.id,
      workplace.id,
      lunch.venueId,
      workplace.id,
      venue.id,
      venue.id,
      home.id,
    ];
    const transits: readonly { from: EntityId; to: EntityId }[] = [
      { from: home.id, to: home.id },
      { from: home.id, to: workplace.id },
      { from: workplace.id, to: workplace.id },
      { from: workplace.id, to: lunch.venueId },
      { from: workplace.id, to: workplace.id },
      { from: workplace.id, to: venue.id },
      { from: venue.id, to: venue.id },
      { from: venue.id, to: home.id },
    ];

    const blocks: RoutineBlock[] = [];
    let cursor = 0;
    for (let index = 0; index < stages.length; index += 1) {
      const stage = stages[index];
      const durationMinutes = durations[index];
      const transit = transits[index];
      const isLunchLeg = stage === 'lunch' && lunch.offSite;
      const isCommuteLeg = stage.startsWith('commute-');
      // Commute blocks are pure transit; a lunch block may walk out and back.
      const travelMinutes = isLunchLeg ? lunch.travelMinutes : isCommuteLeg ? durationMinutes : 0;
      const returnTravelMinutes = isLunchLeg ? lunch.travelMinutes : 0;
      const hasTransit = travelMinutes > 0;
      const route = hasTransit ? this.polylineBetween(transit.from, destinations[index]) : [];
      blocks.push({
        stage,
        activity: STAGE_ACTIVITY[stage],
        destinationId: destinations[index],
        originId: transit.from,
        startMinute: cursor,
        durationMinutes,
        travelMinutes,
        returnTravelMinutes,
        route,
        returnRoute: returnTravelMinutes > 0 ? reversePolyline(route) : [],
        nodeIds: hasTransit ? this.routeNodeIds(transit.from, destinations[index]) : [],
        distanceTiles: route.length > 0 ? polylineLength(route) : 0,
      });
      cursor += durationMinutes;
    }

    return {
      citizenId: citizen.id,
      anchorMinute,
      blocks,
      stageOrder: [...stages],
      shiftPatternId: shift.id,
      shiftLabel: shift.label,
      shiftStartMinute,
      shiftEndMinute: mod(shiftStartMinute + shiftMinutes, MINUTES_PER_DAY),
      shiftMinutes,
      commuteMode: modeProfile.mode,
      lunchVenueId: lunch.venueId,
      lunchOffSite: lunch.offSite,
      lunchMinutes,
      lunchTravelMinutes: lunch.travelMinutes,
      entertainmentVenueId: venue.id,
      entertainmentVenueName: venue.name,
      entertainmentVenueType: deriveVenueType(venue),
      entertainmentMinutes,
    };
  }

  /**
   * Lunch break: stay on site at the workplace, or walk out to a leisure venue
   * near the workplace. A break is only taken off site when the round trip plus
   * a proper sit-down still fits inside the longest break the city grants, and
   * the break is stretched (up to {@link MAX_LUNCH_MINUTES}) to pay for the walk.
   */
  private planLunch(
    workplace: CitizenBuilding,
    venues: CitizenBuilding[],
    preferredLunchMinutes: number,
  ): { venueId: EntityId; offSite: boolean; travelMinutes: number; lunchMinutes: number } {
    const workplaceCentre = buildingCenter(workplace);
    const candidates = venues
      .filter((venue) => venue.id !== workplace.id)
      .map((venue) => ({ venue, distance: distanceBetweenPoints(buildingCenter(venue), workplaceCentre) }))
      .filter((entry) => entry.distance <= LUNCH_VENUE_RADIUS_TILES)
      .sort((left, right) => left.distance - right.distance || compareIds(left.venue.id, right.venue.id));

    for (const candidate of candidates) {
      const eachWay = Math.ceil(this.routeTravelMinutes(workplace.id, candidate.venue.id) * WALK_TRAVEL_FACTOR);
      const needed = eachWay * 2 + MIN_LUNCH_STAY_MINUTES;
      if (eachWay > 0 && needed <= MAX_LUNCH_MINUTES) {
        const lunchMinutes = Math.min(
          MAX_LUNCH_MINUTES,
          Math.ceil(Math.max(preferredLunchMinutes, needed) / LUNCH_STEP_MINUTES) * LUNCH_STEP_MINUTES,
        );
        return { venueId: candidate.venue.id, offSite: true, travelMinutes: eachWay, lunchMinutes };
      }
    }
    return {
      venueId: workplace.id,
      offSite: false,
      travelMinutes: 0,
      lunchMinutes: preferredLunchMinutes,
    };
  }

  /**
   * Evening venue: citizens keep a personal venue taste (gym, bar, park, ...)
   * and pick from the handful of matching venues nearest their home, so
   * entertainment always lands on a real leisure building.
   */
  private pickEntertainmentVenue(home: CitizenBuilding, venues: CitizenBuilding[], rng: Rng): CitizenBuilding {
    const favourite = rng.pick(VENUE_TYPES);
    const typed = venues.filter((venue) => deriveVenueType(venue) === favourite);
    const pool = (typed.length > 0 ? typed : venues).slice();
    const homeCentre = buildingCenter(home);
    pool.sort(
      (left, right) =>
        distanceBetweenPoints(buildingCenter(left), homeCentre) -
          distanceBetweenPoints(buildingCenter(right), homeCentre) ||
        compareIds(left.id, right.id),
    );
    return rng.pick(pool.slice(0, Math.min(6, pool.length)));
  }

  /* -------------------------------------------------------------- routing -- */

  private routeBetween(fromBuildingId: EntityId, toBuildingId: EntityId): RoutePath | null {
    const key = `${fromBuildingId}->${toBuildingId}`;
    if (this.routeCache.has(key)) {
      return this.routeCache.get(key) ?? null;
    }
    let route: RoutePath | null = null;
    try {
      route = this.world.routeBetweenBuildings(fromBuildingId, toBuildingId);
    } catch {
      route = null;
    }
    this.routeCache.set(key, route);
    return route;
  }

  /** Real route length in sim-minutes at the world's own speed limits. */
  private routeTravelMinutes(fromBuildingId: EntityId, toBuildingId: EntityId): number {
    const route = this.routeBetween(fromBuildingId, toBuildingId);
    if (route && Number.isFinite(route.travelMinutes) && route.travelMinutes > 0) {
      return route.travelMinutes;
    }
    const from = this.buildingById(fromBuildingId);
    const to = this.buildingById(toBuildingId);
    if (!from || !to) {
      return MIN_COMMUTE_MINUTES;
    }
    // Straight-line fallback so an unroutable pair still yields a sane plan.
    return distanceBetweenPoints(buildingCenter(from), buildingCenter(to)) / 0.5;
  }

  private routeNodeIds(fromBuildingId: EntityId, toBuildingId: EntityId): EntityId[] {
    return this.routeBetween(fromBuildingId, toBuildingId)?.nodeIds.slice() ?? [];
  }

  private commuteMinutes(fromBuildingId: EntityId, toBuildingId: EntityId, travelFactor: number): number {
    const raw = this.routeTravelMinutes(fromBuildingId, toBuildingId) * travelFactor;
    return Math.round(clamp(raw, MIN_COMMUTE_MINUTES, MAX_COMMUTE_MINUTES));
  }

  /** Polyline in tile units from one building's centre to another's. */
  private polylineBetween(fromBuildingId: EntityId, toBuildingId: EntityId): Vec2[] {
    const from = this.buildingById(fromBuildingId);
    const to = this.buildingById(toBuildingId);
    if (!from || !to) {
      return [];
    }
    const points: Vec2[] = [{ ...buildingCenter(from) }];
    for (const nodeId of this.routeNodeIds(fromBuildingId, toBuildingId)) {
      const node = this.world.roadNodeById(nodeId);
      if (node) {
        points.push({ x: node.x, y: node.y });
      }
    }
    points.push({ ...buildingCenter(to) });
    return points;
  }

  /* ----------------------------------------------------------- simulation -- */

  /** Resolves and applies every citizen's state, then advances their needs. */
  private syncTo(minuteOfDay: number, deltaHours: number): void {
    this.minuteOfDayValue = minuteOfDay;
    for (const citizen of this.citizens) {
      const routine = this.routines.get(citizen.id);
      if (!routine) {
        continue;
      }
      const resolved = resolveBlock(routine, minuteOfDay, this.buildingsById);
      this.applyResolved(citizen, resolved);
      this.advanceNeeds(citizen, resolved.stage, deltaHours);
    }
  }

  private applyResolved(citizen: Citizen, resolved: ResolvedState): void {
    citizen.currentActivity = resolved.activity;
    citizen.insideBuildingId = resolved.insideBuildingId;
    citizen.position = resolved.position;
    // Vehicles belong to the traffic task; citizens only publish commute intent.
    citizen.vehicleId = null;

    const previous = this.liveLocations.get(citizen.id) ?? null;
    if (previous !== resolved.insideBuildingId) {
      if (previous !== null) {
        this.removeOccupant(previous, citizen.id);
      }
      if (resolved.insideBuildingId !== null) {
        this.addOccupant(resolved.insideBuildingId, citizen.id);
      }
      this.liveLocations.set(citizen.id, resolved.insideBuildingId);
    }

    this.liveBlocks.set(citizen.id, resolved.block);
    this.liveStates.set(citizen.id, {
      citizenId: citizen.id,
      stage: resolved.stage,
      activity: resolved.activity,
      minuteOfDay: this.minuteOfDayValue,
      insideBuildingId: resolved.insideBuildingId,
      travelling: resolved.travelling,
      travelProgress: resolved.travelProgress,
      position: { ...resolved.position },
      destinationId: resolved.destinationId,
      commuteIntent: resolved.travelling && isCommuteStage(resolved.stage)
        ? this.buildCommuteIntent(citizen.id, resolved.block)
        : null,
    });
  }

  private buildCommuteIntent(citizenId: EntityId, block: RoutineBlock): CommuteIntent {
    const routine = this.routines.get(citizenId);
    const departMinute = mod(this.minuteOfDayValue - this.offsetWithinBlock(citizenId, block), MINUTES_PER_DAY);
    return {
      citizenId,
      mode: routine?.commuteMode ?? 'foot',
      fromBuildingId: block.originId,
      toBuildingId: block.destinationId,
      departMinute,
      arriveMinute: mod(departMinute + block.durationMinutes, MINUTES_PER_DAY),
      durationMinutes: block.durationMinutes,
      distanceTiles: round2(block.distanceTiles),
      nodeIds: block.nodeIds,
    };
  }

  /** Minutes already spent inside the block the citizen is currently in. */
  private offsetWithinBlock(citizenId: EntityId, block: RoutineBlock): number {
    const routine = this.routines.get(citizenId);
    if (!routine) {
      return 0;
    }
    const cycleMinute = mod(this.minuteOfDayValue - routine.anchorMinute, MINUTES_PER_DAY);
    return mod(cycleMinute - block.startMinute, MINUTES_PER_DAY);
  }

  /**
   * Needs grow (or are satisfied) according to the current stage, and mood
   * drifts towards the mood the current need levels imply.
   */
  private advanceNeeds(citizen: Citizen, stage: RoutineStage, deltaHours: number): void {
    if (deltaHours > 0) {
      const householdSize = citizen.household.memberIds.length;
      for (const need of citizen.needs) {
        const multiplier = needMultiplier(need.kind, stage, need.level, householdSize);
        need.level = clamp(need.level + need.growthPerHour * multiplier * deltaHours, 0, 100);
      }
    }
    const target = targetMood(citizen.needs);
    const response = Math.min(1, deltaHours * MOOD_RESPONSE_PER_HOUR);
    citizen.mood = clamp(citizen.mood + (target - citizen.mood) * response, 0, 1);
  }

  private addOccupant(buildingId: EntityId, citizenId: EntityId): void {
    const building = this.buildingsById.get(buildingId);
    if (building && !building.occupantIds.includes(citizenId)) {
      building.occupantIds.push(citizenId);
    }
  }

  private removeOccupant(buildingId: EntityId, citizenId: EntityId): void {
    const building = this.buildingsById.get(buildingId);
    if (!building) {
      return;
    }
    const index = building.occupantIds.indexOf(citizenId);
    if (index >= 0) {
      building.occupantIds.splice(index, 1);
    }
  }
}

/* --------------------------------------------------------- state machine -- */

function isCommuteStage(stage: RoutineStage): boolean {
  return stage.startsWith('commute-');
}

/** Block index whose time range contains `cycleMinute`. */
function blockIndexAt(routine: CitizenRoutine, cycleMinute: number): number {
  for (let index = 0; index < routine.blocks.length; index += 1) {
    if (cycleMinute < routine.blocks[index].startMinute + routine.blocks[index].durationMinutes) {
      return index;
    }
  }
  return routine.blocks.length - 1;
}

/**
 * Resolves where a citizen is and what they are doing at a given minute of the
 * day. This is a pure function of sim time, which is what keeps movement free
 * of drift regardless of the engine's step size.
 */
function resolveBlock(
  routine: CitizenRoutine,
  minuteOfDay: number,
  buildings: Map<EntityId, CitizenBuilding>,
): ResolvedState {
  const cycleMinute = mod(minuteOfDay - routine.anchorMinute, MINUTES_PER_DAY);
  const block = routine.blocks[blockIndexAt(routine, cycleMinute)];
  const offset = cycleMinute - block.startMinute;
  const centreOf = (buildingId: EntityId): Vec2 => {
    const building = buildings.get(buildingId);
    return building ? buildingCenter(building) : { x: 0, y: 0 };
  };

  if (block.stage === 'lunch' && block.returnTravelMinutes > 0) {
    const back = block.returnTravelMinutes;
    if (offset < block.travelMinutes) {
      const progress = clamp(offset / block.travelMinutes, 0, 1);
      return transit(block, progress, pointAlongPolyline(block.route, progress));
    }
    if (offset >= block.durationMinutes - back) {
      const progress = clamp((offset - (block.durationMinutes - back)) / back, 0, 1);
      return transit(block, progress, pointAlongPolyline(block.returnRoute, progress));
    }
  } else if (block.travelMinutes > 0 && offset < block.travelMinutes) {
    const progress = clamp(offset / block.travelMinutes, 0, 1);
    return transit(block, progress, pointAlongPolyline(block.route, progress));
  }

  return {
    stage: block.stage,
    activity: block.activity,
    insideBuildingId: block.destinationId,
    position: centreOf(block.destinationId),
    travelling: false,
    travelProgress: 0,
    destinationId: block.destinationId,
    block,
  };
}

function transit(block: RoutineBlock, progress: number, position: Vec2): ResolvedState {
  return {
    stage: block.stage,
    activity: block.activity,
    insideBuildingId: null,
    position,
    travelling: true,
    travelProgress: progress,
    destinationId: block.destinationId,
    block,
  };
}

/** Mirrors the routine ring as the shared `ScheduleSlot` contract. */
export function scheduleFor(routine: CitizenRoutine): ScheduleSlot[] {
  return routine.blocks.map((block) => ({
    activity: block.activity,
    startHour: mod(routine.anchorMinute + block.startMinute, MINUTES_PER_DAY) / MINUTES_PER_HOUR,
    endHour:
      mod(routine.anchorMinute + block.startMinute + block.durationMinutes, MINUTES_PER_DAY) /
      MINUTES_PER_HOUR,
    destinationId: block.destinationId,
  }));
}

/* ------------------------------------------------------------------ data -- */

/** Base unmet-need growth per sim-hour, before each citizen's own variance. */
const BASE_NEED_GROWTH: Readonly<Record<NeedKind, number>> = {
  hunger: 4.5,
  energy: 3.2,
  social: 2.4,
  fun: 3.6,
  hygiene: 2.1,
};

const JOB_MARKET_FOR_KIND = new Map<BuildingKind, JobMarket>(
  JOB_MARKETS.map((market) => [market.kind, market]),
);

function deriveVenueType(building: Building): VenueType {
  const pool = VENUE_TYPES_BY_KIND[building.kind];
  if (pool.length === 0) {
    return 'park';
  }
  return pool[hashStringToSeed(building.id) % pool.length];
}

function uniqueName(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 512; attempt += 1) {
    const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Deterministic fallback; unreachable while the pool exceeds the roster size.
  const suffix = used.size + 1;
  const fallback = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${suffix}`;
  used.add(fallback);
  return fallback;
}

function pickAge(rng: Rng): number {
  const band = rng.pickWeighted(AGE_BANDS, AGE_BANDS.map((entry) => entry.weight));
  return rng.intInclusive(band.min, band.max);
}

function formatHour(minuteOfDay: number): string {
  const hours = Math.floor(mod(minuteOfDay, MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const minutes = mod(minuteOfDay, MINUTES_PER_HOUR);
  return `${hours < 10 ? '0' : ''}${hours}:${minutes < 10 ? '0' : ''}${minutes}`;
}

/** Builds a citizen system for a world. */
export function createCitizensSystem(options: CitizensOptions): CitizensSystem {
  return new CitizensSystem(options);
}
