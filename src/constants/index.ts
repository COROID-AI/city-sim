/**
 * Simulation constants.
 *
 * Road spacing, zone layout, and entity-count scaling factors used by the
 * city generator. Values are tuned for the canonical 80×80 grid but scale
 * proportionally for other sizes.
 */

/** Default grid dimensions. */
export const DEFAULT_GRID_WIDTH = 80;
export const DEFAULT_GRID_HEIGHT = 80;

/** Main roads are placed at indices that are multiples of this value. */
export const MAIN_ROAD_INTERVAL = 16;

/** Secondary roads are placed at multiples of this value (excludes main). */
export const SECONDARY_ROAD_INTERVAL = 8;

/** Main road width in tiles. */
export const MAIN_ROAD_WIDTH = 2;

/** Secondary road width in tiles. */
export const SECONDARY_ROAD_WIDTH = 1;

/** Default seed for the deterministic PRNG (mulberry32). */
export const DEFAULT_SEED = 1337;

/** Street light spacing along roads (tiles between lights). */
export const STREET_LIGHT_INTERVAL = 8;

/**
 * Static zone bounds for the canonical 80×80 grid.
 *
 * Zones start at offset 2 from origin to avoid overlapping the x=0 / y=0 road
 * lines. Each zone occupies a distinct rectangular region. The layout divides
 * the grid into quadrants with the park in the center.
 *
 * Coords are half-open [minX, maxX).
 */
export const ZONE_BOUNDS = {
  residential: { minX: 2, minY: 2, maxX: 38, maxY: 38 },
  commercial: { minX: 42, minY: 2, maxX: 78, maxY: 38 },
  industrial: { minX: 2, minY: 42, maxX: 38, maxY: 78 },
  entertainment: { minX: 42, minY: 42, maxX: 78, maxY: 78 },
  park: { minX: 34, minY: 34, maxX: 46, maxY: 46 },
} as const;

/** All zone types in canonical order. */
export const ZONE_TYPES = [
  'residential',
  'commercial',
  'industrial',
  'entertainment',
  'park',
] as const;

/** Zones where citizens can work (commercial / industrial). */
export const EMPLOYMENT_ZONES = ['commercial', 'industrial'] as const;

/**
 * Entity count scaling factors relative to grid area.
 *
 * Counts are capped to avoid performance issues on large grids.
 */
export const CITIZEN_DENSITY = 0.02; // citizens per buildable tile
export const VEHICLE_DENSITY = 0.01; // vehicles per road tile
export const MAX_CITIZENS = 500;
export const MAX_VEHICLES = 200;
