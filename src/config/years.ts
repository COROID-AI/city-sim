/**
 * Time-period configuration data model.
 *
 * Each entry describes a distinct historical era the city can render. The
 * `YearConfig` shape is intentionally minimal so downstream systems (buildings,
 * props, pedestrians) can extend it without breaking the store contract.
 */

export type EraId =
  | 'postwar'
  | 'sixties'
  | 'eighties'
  | 'twothousands'
  | 'present';

/**
 * Visual architectural style key consumed by the procedural building system.
 * Each era maps to one of these styles to drive facade, window, and roof
 * generation.
 */
export type BuildingStyle =
  | 'artDeco'
  | 'brutalist'
  | 'glassTower'
  | 'midcentury'
  | 'modern';

/**
 * Configuration for a single time period.
 */
export interface YearConfig {
  /** Canonical era identifier. */
  readonly id: EraId;
  /** Human-readable label, e.g. "1945". */
  readonly label: string;
  /** Numeric year used for ordering and comparisons. */
  readonly year: number;
  /** Dominant palette key consumed by materials/lighting. */
  readonly palette: string;
  /** Relative building density multiplier (0..1). */
  readonly density: number;
  /** Maximum building height in world units. */
  readonly maxHeight: number;
  /** Architectural style key for procedural building generation. */
  readonly buildingStyle: BuildingStyle;
}

/**
 * Ordered list of available eras, oldest first.
 *
 * The five discrete stops exposed by the timeline slider: 1945, 1965, 1985,
 * 2005, 2025.
 */
export const YEAR_CONFIGS: readonly YearConfig[] = [
  {
    id: 'postwar',
    label: '1945',
    year: 1945,
    palette: '#6b5b4a',
    density: 0.4,
    maxHeight: 12,
    buildingStyle: 'artDeco',
  },
  {
    id: 'sixties',
    label: '1965',
    year: 1965,
    palette: '#7a6f5d',
    density: 0.55,
    maxHeight: 20,
    buildingStyle: 'midcentury',
  },
  {
    id: 'eighties',
    label: '1985',
    year: 1985,
    palette: '#4a5a6b',
    density: 0.7,
    maxHeight: 32,
    buildingStyle: 'brutalist',
  },
  {
    id: 'twothousands',
    label: '2005',
    year: 2005,
    palette: '#3a5a7b',
    density: 0.85,
    maxHeight: 48,
    buildingStyle: 'glassTower',
  },
  {
    id: 'present',
    label: '2025',
    year: 2025,
    palette: '#2a4a6b',
    density: 1.0,
    maxHeight: 64,
    buildingStyle: 'modern',
  },
] as const;

/** Default era used when the store initialises. */
export const DEFAULT_ERA: EraId = 'present';

/**
 * Look up a `YearConfig` by its era id. Returns `undefined` when the id is
 * unknown so callers can decide how to handle missing data.
 */
export function getYearConfig(id: EraId): YearConfig | undefined {
  return YEAR_CONFIGS.find((config) => config.id === id);
}

/**
 * Return the config that immediately follows the given era in chronological
 * order. Returns `undefined` for the latest era (no successor).
 */
export function getNextYearConfig(id: EraId): YearConfig | undefined {
  const index = YEAR_CONFIGS.findIndex((config) => config.id === id);
  if (index === -1 || index === YEAR_CONFIGS.length - 1) {
    return undefined;
  }
  return YEAR_CONFIGS[index + 1];
}
