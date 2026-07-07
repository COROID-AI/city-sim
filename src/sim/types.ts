/**
 * Core simulation type definitions.
 *
 * All types are pure data — no React, Canvas, or DOM dependencies.
 * Discriminated unions use a `kind` discriminant field for exhaustive
 * pattern matching in switch statements.
 */

// ─── Citizen State ───────────────────────────────────────────────────────────

/**
 * The finite-state machine a citizen cycles through each day.
 *
 * Daily schedule: HOME → COMMUTING → WORKING → COMMUTING → ENTERTAINMENT
 *                → RETURNING → HOME
 */
export type CitizenState =
  | { readonly kind: 'HOME'; buildingId: string }
  | {
      readonly kind: 'COMMUTING';
      readonly fromId: string;
      readonly toId: string;
      readonly progress: number;
    }
  | { readonly kind: 'WORKING'; buildingId: string }
  | { readonly kind: 'ENTERTAINMENT'; buildingId: string }
  | {
      readonly kind: 'RETURNING';
      readonly fromId: string;
      readonly toId: string;
      readonly progress: number;
    };

/** String-literal union of all citizen state kinds. */
export type CitizenStateKind = CitizenState['kind'];

// ─── Vehicle ─────────────────────────────────────────────────────────────────

/** Categorises vehicles for rendering and behaviour. */
export type VehicleKind = 'CAR' | 'TRUCK' | 'BUS' | 'MOTORCYCLE';

// ─── Building ────────────────────────────────────────────────────────────────

/** The functional purpose of a building. */
export type BuildingKind = 'HOME' | 'WORK' | 'ENTERTAINMENT' | 'CIVIC';

// ─── Zone ────────────────────────────────────────────────────────────────────

/** High-level zoning designation for a region of the grid. */
export type Zone = 'RESIDENTIAL' | 'COMMERCIAL' | 'INDUSTRIAL' | 'MIXED';

// ─── Geometry ────────────────────────────────────────────────────────────────

/** 2D vector / point in grid coordinates. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Dimensions of a rectangular area in grid cells. */
export interface Size {
  width: number;
  height: number;
}

// ─── Time ────────────────────────────────────────────────────────────────────

/**
 * Continuous simulation clock expressed in elapsed hours.
 *
 * Derived values are computed by helpers in `time.ts`:
 *   - hour-of-day = elapsedHours mod 24
 *   - day-number  = floor(elapsedHours / 24)
 */
export interface SimTime {
  /** Total elapsed sim-hours since the simulation started (fractional). */
  elapsedHours: number;
}

// ─── Grid ────────────────────────────────────────────────────────────────────

/**
 * Physical ground cover / surface type of a tile.
 *
 *  - `GRASS`    — open ground; buildings may be placed here.
 *  - `ROAD`     — traversable road surface for vehicles & pedestrians.
 *  - `BUILDING` — covered by a building footprint.
 */
export type Terrain = 'GRASS' | 'ROAD' | 'BUILDING';

/** A single cell on the city grid. */
export interface Tile {
  /** Column index (0-based, left-to-right). */
  readonly x: number;
  /** Row index (0-based, top-to-bottom). */
  readonly y: number;
  /** Zoning designation for this cell. */
  zone: Zone;
  /** Physical surface type (grass, road, or building). */
  terrain: Terrain;
  /** ID of the building occupying this tile, or `null` if empty. */
  buildingId: string | null;
}

// ─── Entities ────────────────────────────────────────────────────────────────

/** A building on the grid. */
export interface Building {
  /** Unique identifier (e.g. `"b0"`, `"b1"`). */
  readonly id: string;
  /** Functional purpose. */
  readonly kind: BuildingKind;
  /** Top-left grid position. */
  readonly position: Vec2;
  /** Footprint in grid cells. */
  readonly size: Size;
  /** Maximum number of occupants (citizens or employees). */
  readonly capacity: number;
  /** Human-readable name (e.g. `"Oak Apartments"`, `"City Hall"`). */
  readonly name: string;
  /** Owning company ID (`null` for residential / civic buildings). */
  owner: string | null;
}

/** A citizen inhabitant with a daily schedule. */
export interface Citizen {
  /** Unique identifier (e.g. `"c0"`, `"c1"`). */
  readonly id: string;
  /** Home building ID (`null` until assigned housing). */
  readonly home: string | null;
  /** Workplace building ID (`null` if unemployed). */
  readonly work: string | null;
  /** Current schedule state (finite-state machine). */
  state: CitizenState;
  /** Current grid position (mutated during movement). */
  position: Vec2;
  /** Personal funds in city currency. */
  money: number;
}

/** A vehicle travelling on the road network. */
export interface Vehicle {
  /** Unique identifier (e.g. `"v0"`, `"v1"`). */
  readonly id: string;
  /** Vehicle category for rendering and speed. */
  readonly kind: VehicleKind;
  /** Current grid position (mutated during movement). */
  position: Vec2;
  /** Current velocity vector (direction × speed, grid-cells per sim-hour). */
  velocity: Vec2;
  /** Driving citizen ID, or `null` for autonomous / transit vehicles. */
  driver: string | null;
  /** Destination building ID, or `null` when idle. */
  target: string | null;
  /** Road path currently being followed, as a list of grid coordinates. */
  currentRoadPath: Vec2[];
  /** Index into {@link currentRoadPath} of the tile most recently reached. */
  pathIndex: number;
  /** Fractional progress `[0, 1)` toward the next tile in the path. */
  pathProgress: number;
  /** Citizen IDs currently riding as passengers. */
  passengers: string[];
  /** Current travel speed in grid-cells per sim-hour. */
  speed: number;
  /** Fuel level in `[0, 100]` (percentage of full tank). */
  fuel: number;
}

/** A company that employs citizens and tracks finances. */
export interface Company {
  /** Unique identifier (e.g. `"co0"`, `"co1"`). */
  readonly id: string;
  /** Headquarter / workplace building ID. */
  readonly buildingId: string;
  /** Employee citizen IDs. */
  employeeIds: string[];
  /** Cumulative revenue (sim currency). */
  revenue: number;
  /** Cumulative expenses (wages, maintenance). */
  expenses: number;
}

// ─── World ───────────────────────────────────────────────────────────────────

/** Root simulation state containing all entities and global data. */
export interface World {
  /** Grid width in cells. */
  readonly width: number;
  /** Grid height in cells. */
  readonly height: number;
  /** Flat tile array indexed as `tiles[y * width + x]`. */
  readonly tiles: Tile[];
  /** All buildings keyed by ID. */
  readonly buildings: Map<string, Building>;
  /** All citizens keyed by ID. */
  readonly citizens: Map<string, Citizen>;
  /** All vehicles keyed by ID. */
  readonly vehicles: Map<string, Vehicle>;
  /** All companies keyed by ID. */
  readonly companies: Map<string, Company>;
  /** Continuous simulation clock. */
  simTime: SimTime;
  /** City treasury in sim currency. */
  budget: number;
}
