/**
 * Shared domain contracts for the city simulation.
 *
 * This module is intentionally DOM-free: it must stay importable from plain
 * Node (tests, tooling, headless runs) and never touches browser globals.
 * Renderers and UI layers consume these contracts but own every canvas call.
 *
 * Conventions used across the whole simulation:
 * - ids are stable strings, unique per entity collection;
 * - positions are expressed in tile units unless a `Px` suffix says otherwise;
 * - hours are hour-of-day values on a 24h clock (fractional values allowed);
 * - money is a plain number in the sim currency.
 */

/** Stable identifier for any simulated entity. */
export type EntityId = string;

/** Position in tile space. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Axis aligned rectangle in tile space. */
export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* --------------------------------------------------------------- day time -- */

/** Named slice of the 24 sim-hour day, used for schedules and day/night looks. */
export type DayPhase = 'night' | 'dawn' | 'morning' | 'day' | 'evening';

/** Every phase in the order it occurs across one day, starting at midnight. */
export const DAY_PHASES: readonly DayPhase[] = ['night', 'dawn', 'morning', 'day', 'evening'];

/* -------------------------------------------------------------- citizens -- */

/** What a citizen does during one block of their daily routine. */
export type ActivityKind = 'home' | 'work' | 'errand' | 'entertainment';

/** Every activity kind, in schedule order. */
export const ACTIVITY_KINDS: readonly ActivityKind[] = ['home', 'work', 'errand', 'entertainment'];

/** One block of a citizen routine: home -> work -> entertainment -> home. */
export interface ScheduleSlot {
  activity: ActivityKind;
  /** Hour-of-day the slot begins (0..23). */
  startHour: number;
  /** Hour-of-day the slot ends; smaller than `startHour` when it wraps midnight. */
  endHour: number;
  /** Building or road node the citizen should be at while the slot runs. */
  destinationId: EntityId | null;
}

/** Kinds of personal need tracked per citizen. */
export type NeedKind = 'hunger' | 'energy' | 'social' | 'fun' | 'hygiene';

/** Every tracked need kind. */
export const NEED_KINDS: readonly NeedKind[] = ['hunger', 'energy', 'social', 'fun', 'hygiene'];

/** A single personal need; `level` 0 = fully satisfied, 100 = critical. */
export interface Need {
  kind: NeedKind;
  level: number;
  /** How much `level` grows per sim-hour that the need is unmet. */
  growthPerHour: number;
}

/** A group of citizens sharing one home, one budget and one savings pool. */
export interface Household {
  id: EntityId;
  homeBuildingId: EntityId;
  memberIds: EntityId[];
  /** Shared savings in sim currency. */
  funds: number;
}

/** Job of a citizen: what they do, where, when and for how much. */
export interface Occupation {
  title: string;
  sector: CompanySector;
  /** Employing company, or null while unemployed. */
  companyId: EntityId | null;
  workplaceBuildingId: EntityId | null;
  /** Hour-of-day the shift starts (24h clock). */
  shiftStartHour: number;
  /** Hour-of-day the shift ends (24h clock). */
  shiftEndHour: number;
  /** Sim currency earned per worked sim-hour. */
  wagePerHour: number;
}

/** A single resident of the city. */
export interface Citizen {
  id: EntityId;
  name: string;
  age: number;
  householdId: EntityId;
  household: Household;
  homeBuildingId: EntityId;
  occupation: Occupation;
  /** Sim currency earned per sim-day (net of taxes); 0 while unemployed. */
  income: number;
  /** Overall happiness: 0 = miserable, 1 = delighted. */
  mood: number;
  needs: Need[];
  /** Daily routine, in schedule order. */
  schedule: ScheduleSlot[];
  currentActivity: ActivityKind;
  /** Building the citizen is inside, or null while outside on the street. */
  insideBuildingId: EntityId | null;
  position: Vec2;
  /** Vehicle the citizen currently rides, or null when on foot. */
  vehicleId: EntityId | null;
}

/* ------------------------------------------------------------- companies -- */

/** Economic sector a company operates in. */
export type CompanySector =
  | 'retail'
  | 'office'
  | 'manufacturing'
  | 'logistics'
  | 'hospitality'
  | 'civic';

/** Every sector, used to shape sector revenue/cost records. */
export const COMPANY_SECTORS: readonly CompanySector[] = [
  'retail',
  'office',
  'manufacturing',
  'logistics',
  'hospitality',
  'civic',
];

/** A business with staff, revenue, costs and a cash balance. */
export interface Company {
  id: EntityId;
  name: string;
  sector: CompanySector;
  /** Building the company occupies, or null while it has no premises. */
  buildingId: EntityId | null;
  employees: EntityId[];
  /** Cached length of `employees`, kept in sync for cheap HUD/economy maths. */
  employeeCount: number;
  /** Sim currency earned so far during the current sim-day. */
  revenue: number;
  /** Sim currency spent so far during the current sim-day. */
  costs: number;
  /** Liquid sim currency owned by the company. */
  cash: number;
  /** Hour-of-day the doors open. */
  openHour: number;
  /** Hour-of-day the doors close. */
  closeHour: number;
  /** Base fill colour used by renderers. */
  color: string;
}

/* ------------------------------------------------------------- buildings -- */

/** Functional kind of a building. */
export type BuildingKind =
  | 'house'
  | 'apartment'
  | 'office'
  | 'shop'
  | 'factory'
  | 'warehouse'
  | 'school'
  | 'hospital'
  | 'park'
  | 'civic';

/** Every building kind that world generation may place. */
export const BUILDING_KINDS: readonly BuildingKind[] = [
  'house',
  'apartment',
  'office',
  'shop',
  'factory',
  'warehouse',
  'school',
  'hospital',
  'park',
  'civic',
];

/** A structure placed on the tile grid. */
export interface Building {
  id: EntityId;
  kind: BuildingKind;
  name: string;
  /** Footprint in tile coordinates. */
  footprint: TileRect;
  floors: number;
  /** Maximum simultaneous occupants (residents or workers). */
  capacity: number;
  /** Citizens currently inside (residents at home, employees at work). */
  occupantIds: EntityId[];
  /** Households that call this building home. */
  residentHouseholdIds: EntityId[];
  /** Company operating from this building, when any. */
  companyId: EntityId | null;
  /** Road node pedestrians/vehicles use to enter, when reachable. */
  entranceNodeId: EntityId | null;
  /** Base fill colour used by renderers. */
  color: string;
}

/* ----------------------------------------------------------------- roads -- */

/** Role of a node inside the road graph. */
export type RoadNodeKind = 'intersection' | 'junction' | 'dead-end';

/** Every road node kind. */
export const ROAD_NODE_KINDS: readonly RoadNodeKind[] = ['intersection', 'junction', 'dead-end'];

/** A point in the road graph that vehicle routes hop between. */
export interface RoadNode {
  id: EntityId;
  kind: RoadNodeKind;
  /** Tile coordinates of the node centre. */
  x: number;
  y: number;
  /** Adjacent nodes reachable without crossing another node. */
  neighborIds: EntityId[];
  /** Speed ceiling along this node's approaches, in tiles per sim-minute. */
  speedLimit: number;
  hasTrafficLight: boolean;
}

/** A drivable link between two road nodes. */
export interface RoadSegment {
  id: EntityId;
  fromNodeId: EntityId;
  toNodeId: EntityId;
  /** Length in tiles. */
  length: number;
  lanes: number;
  /** Speed ceiling along the segment, in tiles per sim-minute. */
  speedLimit: number;
}

/** Surface type of a map tile. */
export type TerrainKind = 'grass' | 'road' | 'water' | 'park' | 'plaza';

/** Every terrain kind. */
export const TERRAIN_KINDS: readonly TerrainKind[] = ['grass', 'road', 'water', 'park', 'plaza'];

/** One cell of the world grid. */
export interface Tile {
  x: number;
  y: number;
  terrain: TerrainKind;
  /** Building covering the tile, when any. */
  buildingId: EntityId | null;
  /** Road segment crossing the tile, when any. */
  segmentId: EntityId | null;
}

/* -------------------------------------------------------------- vehicles -- */

/** Kinds of vehicle that can drive the road network. */
export type VehicleKind = 'car' | 'taxi' | 'bus' | 'truck' | 'bicycle' | 'tram';

/** Every vehicle kind. */
export const VEHICLE_KINDS: readonly VehicleKind[] = [
  'car',
  'taxi',
  'bus',
  'truck',
  'bicycle',
  'tram',
];

/** Ordered set of road nodes a vehicle keeps visiting. */
export interface VehicleRoute {
  id: EntityId;
  kind: 'loop' | 'shuttle' | 'delivery';
  /** Road nodes visited in order. */
  stopNodeIds: EntityId[];
  /** Whether the vehicle restarts the list after the last stop. */
  loop: boolean;
}

/** A vehicle moving on the road network. */
export interface Vehicle {
  id: EntityId;
  kind: VehicleKind;
  /** Human readable license plate. */
  plate: string;
  /** Maximum simultaneous riders/cargo units. */
  capacity: number;
  route: VehicleRoute;
  /** Current passenger count; equals `occupantIds.length`. */
  occupancy: number;
  occupantIds: EntityId[];
  /** Current fuel in sim units (0..fuelCapacity). */
  fuel: number;
  fuelCapacity: number;
  /** Current speed in tiles per sim-minute. */
  speed: number;
  /** Heading in radians, 0 = east, growing clockwise on screen. */
  headingRadians: number;
  position: Vec2;
  /** Node the vehicle is currently at or just left. */
  currentNodeId: EntityId | null;
  /** Node the vehicle is driving towards. */
  targetNodeId: EntityId | null;
  /** Company owning/running the vehicle, when any. */
  ownerCompanyId: EntityId | null;
  /** Base fill colour used by renderers. */
  color: string;
}

/* ----------------------------------------------------------------- world -- */

/**
 * The complete simulated world: grid, road graph and every entity collection.
 * Systems receive it (or part of it) and mutate the collections in place.
 */
export interface WorldMap {
  id: EntityId;
  /** Grid size in tiles. */
  widthInTiles: number;
  heightInTiles: number;
  /** Logical pixels per tile at zoom 1. */
  tileSize: number;
  /** Row-major tiles; length is `widthInTiles * heightInTiles`. */
  tiles: Tile[];
  nodes: RoadNode[];
  segments: RoadSegment[];
  buildings: Building[];
  households: Household[];
  citizens: Citizen[];
  companies: Company[];
  vehicles: Vehicle[];
  /** Road node where new vehicles enter the network. */
  spawnNodeId: EntityId | null;
}

/** Flat index of a tile inside `WorldMap.tiles`. */
export function tileIndex(widthInTiles: number, x: number, y: number): number {
  return y * widthInTiles + x;
}

/** Whether the given tile coordinates fall inside the map. */
export function isInsideMap(
  map: Pick<WorldMap, 'widthInTiles' | 'heightInTiles'>,
  x: number,
  y: number,
): boolean {
  return x >= 0 && y >= 0 && x < map.widthInTiles && y < map.heightInTiles;
}

/* --------------------------------------------------------------- metrics -- */

/**
 * Economy reading produced once per sim-hour by the economy system.
 * Rates are fractions in the 0..1 range, money values are sim currency.
 */
export interface EconomySnapshot {
  /** Day index the snapshot belongs to (0-based, see SimClock). */
  day: number;
  /** Hour-of-day the snapshot was taken at. */
  hour: number;
  minute: number;
  /** Total sim minutes elapsed since the clock origin. */
  totalMinutes: number;
  population: number;
  companyCount: number;
  employedCitizens: number;
  /** employedCitizens / population, 0 when the city is empty. */
  employmentRate: number;
  /** 1 - employmentRate. */
  unemploymentRate: number;
  /** Mean hourly wage across employed citizens. */
  averageWage: number;
  totalRevenue: number;
  totalCosts: number;
  /** totalRevenue - totalCosts. */
  netProfit: number;
  cityBudget: number;
  /** Fraction of revenue collected as tax. */
  taxRate: number;
  sectorRevenue: Record<CompanySector, number>;
  sectorCosts: Record<CompanySector, number>;
  /** Mean citizen mood, 0..1. */
  averageMood: number;
}

/** Values the top overlay reads each frame. */
export interface HudStats {
  population: number;
  employedCitizens: number;
  /** employedCitizens / population, 0 when the city is empty. */
  employmentRate: number;
  /** Preformatted city time, e.g. "Day 2, 07:35". */
  cityTimeLabel: string;
  cityBudget: number;
  day: number;
  hour: number;
  minute: number;
  phase: DayPhase;
  citizenCount: number;
  vehicleCount: number;
  companyCount: number;
  buildingCount: number;
  /** Mean citizen mood, 0..1. */
  averageMood: number;
}
