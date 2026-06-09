/**
 * Shared types for the city generation pipeline.
 *
 * All coordinates are integer cell coordinates on a 2D grid where
 * (0, 0) is the top-left cell and (width-1, height-1) is the bottom-right.
 * x increases rightward, y increases downward. This matches the
 * downstream renderer's expected convention.
 */

/** The 5 distinct city zones. */
export type ZoneId = 'residential' | 'commercial' | 'industrial' | 'civic' | 'park';

/** A list of all valid zone IDs. Order is stable for iteration. */
export const ZONE_IDS: readonly ZoneId[] = [
  'residential',
  'commercial',
  'industrial',
  'civic',
  'park',
] as const;

/** Road classification. Main roads are wider and require a setback buffer. */
export type RoadKind = 'none' | 'secondary' | 'main';

/** A single cell on the city grid. */
export interface Cell {
  /** Column index (0-based, increases right). */
  readonly x: number;
  /** Row index (0-based, increases down). */
  readonly y: number;
}

/** A rectangular region of cells, inclusive of all corners. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Zone assignment for a single cell. */
export interface CellZone {
  readonly cell: Cell;
  readonly zone: ZoneId;
}

/** A company / business entity placed inside the city. */
export interface Company {
  /** Stable unique id, deterministic for a given seed. */
  readonly id: string;
  /** Display name, deterministic and unique within a generated city. */
  readonly name: string;
  /** Zone the company is allowed to operate in. */
  readonly zone: ZoneId;
  /** Indices into GeneratedCity.buildings for the company's plots. */
  readonly buildingIds: readonly number[];
}

/** A building plot placed on the grid. */
export interface Building {
  /** Stable unique id, deterministic for a given seed. */
  readonly id: string;
  /** Company this building belongs to, by id. May be null for unassigned plots. */
  readonly companyId: string | null;
  /** Zone the building sits within. */
  readonly zone: ZoneId;
  /** Footprint of the building, in cells. */
  readonly footprint: Rect;
  /** Per-cell positions (cached convenience for renderer lookups). */
  readonly cells: readonly Cell[];
}

/** Top-level output of CityGenerator. */
export interface GeneratedCity {
  /** Seed used for generation, echoed for debugging. */
  readonly seed: number;
  /** Grid width in cells. */
  readonly width: number;
  /** Grid height in cells. */
  readonly height: number;
  /** Per-cell road classification. Indexed as [y * width + x]. */
  readonly roads: readonly RoadKind[];
  /** Per-cell zone assignment. Indexed as [y * width + x]. */
  readonly zones: readonly ZoneId[];
  /** All company definitions. */
  readonly companies: readonly Company[];
  /** All placed buildings (some may be unassigned). */
  readonly buildings: readonly Building[];
  /** Setback in cells around main roads (no buildings allowed). */
  readonly mainRoadSetback: number;
}

/** Input options for the generator. */
export interface CityGeneratorOptions {
  /** Seed for deterministic output. */
  readonly seed: number;
  /** Override the default grid size. */
  readonly width?: number;
  /** Override the default grid height. */
  readonly height?: number;
  /** Override the desired number of companies (clamped to 8-12). */
  readonly companyCount?: number;
  /** Setback (in cells) around main roads. Defaults to 1. */
  readonly mainRoadSetback?: number;
}
