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
  /** Preferred entertainment building ID (`null` if none assigned). */
  readonly entertainment: string | null;
  /** Current schedule state (finite-state machine). */
  state: CitizenState;
  /** Current grid position (mutated during movement). */
  position: Vec2;
  /** Personal funds in city currency. */
  money: number;
  /** Current road path being walked (empty when at rest). */
  path: Vec2[];
  /** Index of the next waypoint in `path` (0 when not travelling). */
  pathIndex: number;
}

/** A vehicle travelling on the grid. */
export interface Vehicle {
  /** Unique identifier (e.g. `"v0"`, `"v1"`). */
  readonly id: string;
  /** Vehicle category for rendering and speed. */
  readonly kind: VehicleKind;
  /** Current grid position (mutated during movement). */
  position: Vec2;
  /** Current velocity in grid-cells per sim-hour. */
  velocity: Vec2;
  /** Driving citizen ID, or `null` for autonomous / transit vehicles. */
  driver: string | null;
  /** Destination building ID, or `null` when idle. */
  target: string | null;
}

// ─── Product Kind ────────────────────────────────────────────────────────────

/**
 * The type of goods or services a company produces.
 *
 * Derived from the workplace building's name at creation time, used for
 * classification and detail display.
 */
export type ProductKind =
  | 'TECHNOLOGY'
  | 'COMMERCE'
  | 'INDUSTRY'
  | 'SERVICES'
  | 'FINANCE'
  | 'TRADE';

// ─── Company Employee ────────────────────────────────────────────────────────

/**
 * A detailed employee record within a company.
 *
 * Stores both the citizen reference and human-readable display
 * information for the detail-panel UI.
 */
export interface CompanyEmployee {
  /** Citizen ID of this employee. */
  readonly citizenId: string;
  /** Display name generated deterministically from the citizen ID. */
  readonly name: string;
  /** Individual productivity multiplier (0.8–1.2). */
  readonly productivity: number;
}

// ─── Company ─────────────────────────────────────────────────────────────────

/** A company that employs citizens and tracks finances. */
export interface Company {
  /** Unique identifier (e.g. `"co0"`, `"co1"`). */
  readonly id: string;
  /** Human-readable company name (mirrors the workplace building name). */
  readonly name: string;
  /** Headquarter / workplace building ID. */
  readonly buildingId: string;
  /** Type of goods or services this company produces. */
  readonly productKind: ProductKind;
  /** Per-company productivity factor (0.70–1.30) affecting revenue output. */
  readonly productivity: number;
  /** Employee citizen IDs (mirrors `employees[].citizenId`). */
  employeeIds: string[];
  /** Detailed employee records with display names. */
  employees: CompanyEmployee[];
  /** Cumulative revenue (sim currency). */
  revenue: number;
  /** Cumulative expenses (wages, maintenance). */
  expenses: number;
  /** Revenue earned during the most recent sim-day. */
  dailyRevenue: number;
  /** Expenses incurred during the most recent sim-day. */
  dailyExpenses: number;
  /** Net profit = cumulative `revenue − expenses`. */
  profit: number;
  /** Day number when `dailyRevenue` / `dailyExpenses` were last reset. */
  lastResetDay: number;
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
