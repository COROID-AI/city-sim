/**
 * Time-period configuration data model.
 *
 * Each entry describes a distinct historical era the city can render. The
 * `YearConfig` shape is intentionally minimal so downstream systems (buildings,
 * props, pedestrians) can extend it without breaking the store contract.
 */

export type EraId =
  | 'medieval'
  | 'industrial'
  | 'modern'
  | 'future';

/**
 * Configuration for a single time period.
 */
export interface YearConfig {
  /** Canonical era identifier. */
  readonly id: EraId;
  /** Human-readable label, e.g. "1900". */
  readonly label: string;
  /** Numeric year used for ordering and comparisons. */
  readonly year: number;
  /** Dominant palette key consumed by materials/lighting. */
  readonly palette: string;
  /** Relative building density multiplier (0..1). */
  readonly density: number;
  /** Maximum building height in world units. */
  readonly maxHeight: number;
}

/**
 * Ordered list of available eras, oldest first.
 */
export const YEAR_CONFIGS: readonly YearConfig[] = [
  {
    id: 'medieval',
    label: '1500',
    year: 1500,
    palette: '#6b5b4a',
    density: 0.4,
    maxHeight: 8,
  },
  {
    id: 'industrial',
    label: '1900',
    year: 1900,
    palette: '#7a6f5d',
    density: 0.6,
    maxHeight: 16,
  },
  {
    id: 'modern',
    label: '2000',
    year: 2000,
    palette: '#4a5a6b',
    density: 0.8,
    maxHeight: 32,
  },
  {
    id: 'future',
    label: '2100',
    year: 2100,
    palette: '#2a4a6b',
    density: 1.0,
    maxHeight: 64,
  },
] as const;

/** Default era used when the store initialises. */
export const DEFAULT_ERA: EraId = 'modern';

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
