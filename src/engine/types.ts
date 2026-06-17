/**
 * Engine core type definitions.
 *
 * All shapes are pure data — no logic, no functions — so that the engine
 * remains framework-agnostic (no React, no DOM). Structural types only.
 *
 * Conventions:
 *  - `readonly` is used for fields that should never mutate after construction
 *    (entity IDs, world bounds, building definitions).
 *  - Mutable runtime state (camera position, citizen position, time) is left
 *    mutable because systems update it in place each tick.
 */

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/** A 2D vector / point in screen or world space. */
export interface Vector2 {
  x: number;
  y: number;
}

/** A single tile on the world grid. Tiles are immutable once placed. */
export interface Tile {
  readonly coord: TileCoord;
  /** Terrain kind — concrete values listed in `TileKind`. */
  readonly kind: TileKind;
  /** Optional elevation in world units (0 for default). */
  readonly elevation: number;
}

/** Integer grid coordinate. Distinct from `Vector2` to prevent unit confusion. */
export interface TileCoord {
  readonly x: number;
  readonly y: number;
}

export type TileKind =
  | 'ground'
  | 'road'
  | 'water'
  | 'park'
  | 'lot';

/* -------------------------------------------------------------------------- */
/* Buildings                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Structural union of building categories. The canonical, extended list lives
 * in `src/constants/building-types.ts` and is re-exported under the same name
 * once that file exists. Kept inline here so this task is not blocked.
 */
export type BuildingType =
  | 'office'
  | 'shop'
  | 'factory'
  | 'farm'
  | 'warehouse'
  | 'tech'
  | 'restaurant'
  | 'hospital'
  | 'school'
  | 'park'
  | 'residential';

/** Static, immutable definition of a building type. */
export interface BuildingDef {
  readonly id: string;
  readonly name: string;
  readonly type: BuildingType;
  /** Hex color, palette-aligned (e.g. '#3aa0ff'). */
  readonly color: string;
  /** Approximate daily revenue in currency units. */
  readonly revenue: number;
  readonly maxEmployees: number;
  /** 0–23, inclusive. */
  readonly openHour: number;
  /** 0–23, inclusive. May be < openHour for overnight businesses. */
  readonly closeHour: number;
  /** Footprint in tiles, width × height. */
  readonly size: { width: number; height: number };
}

/** Runtime instance of a building placed on the world grid. */
export interface Building {
  readonly id: string;
  readonly defId: string;
  readonly origin: TileCoord;
  readonly size: { width: number; height: number };
  /** IDs of citizens currently employed here. */
  employees: readonly string[];
  /** Treasury for this specific building. */
  treasury: number;
}

/* -------------------------------------------------------------------------- */
/* Citizens                                                                   */
/* -------------------------------------------------------------------------- */

export type CitizenState =
  | 'idle'
  | 'commuting'
  | 'working'
  | 'shopping'
  | 'resting'
  | 'leisure';

/**
 * Higher-level schedule activity vocabulary used by the citizen activity
 * picker.
 */
export type Activity =
  | 'sleeping'
  | 'commuting'
  | 'working'
  | 'errand'
  | 'leisure';

export interface ScheduleBlock {
  readonly start: number;
  readonly end: number;
}

export interface Schedule {
  readonly work: ScheduleBlock | null;
  readonly id: string;
}

export interface Citizen {
  readonly id: string;
  /** Display name. */
  name: string;
  /** Home building id, if assigned. */
  homeId: string | null;
  /** Workplace building id, if assigned. */
  workId: string | null;
  /** Current world position (in world units, not tile coords). */
  position: Vector2;
  /** Current world velocity (world units per second). */
  velocity: Vector2;
  state: CitizenState;
  /** 0..1, where 0 = starving, 1 = fully satiated. */
  hunger: number;
  /** 0..1, where 0 = exhausted, 1 = fully rested. */
  energy: number;
  /** 0..1, where 0 = bored, 1 = fully entertained. */
  fun: number;
}

/* -------------------------------------------------------------------------- */
/* Vehicles                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Runtime state of a single vehicle. Vehicles are placed on road tiles
 * and progress through a precomputed path one tile per tick. The
 * `ownerId` references the citizen that boarded the vehicle — used by
 * the EconomySystem to attribute per-trip payroll.
 */
export type VehicleState =
  | 'driving'
  | 'waiting_for_light'
  | 'waiting_for_vehicle'
  | 'arrived';

/** A runtime vehicle instance. */
export interface Vehicle {
  readonly id: string;
  /** Citizen id that boarded the vehicle. Null while parked / unowned. */
  ownerId: string | null;
  /** Building id the vehicle is heading to (or `null` if idle). */
  destinationId: string | null;
  /** Current world position in world units (tile coords + 0.5 for the centre). */
  position: Vector2;
  /** Heading in unit-tile/s. Zero while waiting. */
  velocity: Vector2;
  /** Current lifecycle state. */
  state: VehicleState;
  /**
   * Tile-coordinate path the vehicle is following. The first entry is
   * the current / next tile; the last entry is the destination tile.
   * Empty when the vehicle is idle or has arrived.
   */
  path: readonly TileCoord[];
}

/* -------------------------------------------------------------------------- */
/* Time                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * City simulation clock. `tick` is the number of fixed-step ticks since the
 * simulation started; `hour` is the in-world hour of day [0, 24).
 */
export interface CityTime {
  /** Total real time elapsed in seconds (wall clock since start). */
  readonly elapsed: number;
  /** Number of fixed-step ticks since start (1 tick = 1 / TICK_HZ seconds). */
  tick: number;
  /** Current in-world hour of day, 0..24 (may exceed 24 on multi-day wrap). */
  hour: number;
  /** Current in-world day number, starting at 1. */
  day: number;
}

/* -------------------------------------------------------------------------- */
/* Camera                                                                     */
/* -------------------------------------------------------------------------- */

export interface CameraState {
  /** Current pan position in world coordinates (centre of viewport). */
  position: Vector2;
  /** Target pan position; camera lerps `position` toward this. */
  targetPosition: Vector2;
  /** Current zoom factor. 1 = native, > 1 = zoomed in. */
  zoom: number;
  /** Target zoom factor. */
  targetZoom: number;
  /** Viewport size in CSS pixels. */
  viewport: { width: number; height: number };
}

/* -------------------------------------------------------------------------- */
/* World                                                                      */
/* -------------------------------------------------------------------------- */

export interface WorldBounds {
  readonly width: number;
  readonly height: number;
}

// Re-export RoadGraph for tests and consumers that import from the engine type barrel.
export type { RoadGraph, RoadWorldView, OrphanReport } from '@/entities/Road';
