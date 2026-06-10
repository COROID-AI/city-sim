/**
 * Building / company type catalog.
 *
 * Spec reference: §7.4 Economy (companies + revenue + wages).
 *
 * Each entry describes a business archetype that the CityGenerator and
 * EconomySystem can spawn. The `color` field is the saturated hex that
 * the renderer will paint the building footprint with in a follow-up
 * task; values were picked for adequate contrast against the dark
 * `bg-surface` token used by the canvas.
 *
 * Pure data, dependency-free: this file lives in `src/constants/` so
 * every layer (entities, systems, renderer) can import the catalog
 * without pulling in React, the DOM, or the engine.
 */

export type CompanyType =
  | 'office'
  | 'shop'
  | 'factory'
  | 'farm'
  | 'warehouse'
  | 'tech'
  | 'restaurant'
  | 'hospital'
  | 'school'
  | 'power-plant';

export interface BuildingTypeDefinition {
  /** Stable, lowercase id used for lookups and persistence. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Coarse archetype used for tax / wage formulas. */
  type: CompanyType;
  /** Hex color for the building footprint (renderer will use it directly). */
  color: string;
  /**
   * Gross revenue the company produces per in-game day when fully
   * staffed. Used by the EconomySystem to compute the daily ledger.
   */
  revenue: number;
  /** Maximum simultaneous employees. Citizens beyond this are rejected. */
  maxEmployees: number;
  /** Hour of day (0..23) when the business opens. */
  openHour: number;
  /** Hour of day (0..23) when the business closes. */
  closeHour: number;
  /** Per-employee hourly wage in dollars. */
  wagePerHour: number;
}

/**
 * Canonical 10-entry catalog. The order is stable so the CityGenerator
 * can deterministically assign roles (first office gets role 'office',
 * second gets 'shop', etc.) without consulting random salts.
 */
export const BUILDING_TYPES: readonly BuildingTypeDefinition[] = Object.freeze([
  {
    id: 'office',
    name: 'Office Tower',
    type: 'office',
    color: '#5B8DEF',
    revenue: 4800,
    maxEmployees: 40,
    openHour: 8,
    closeHour: 18,
    wagePerHour: 22,
  },
  {
    id: 'shop',
    name: 'Corner Shop',
    type: 'shop',
    color: '#F2B134',
    revenue: 1200,
    maxEmployees: 6,
    openHour: 9,
    closeHour: 21,
    wagePerHour: 14,
  },
  {
    id: 'factory',
    name: 'Factory',
    type: 'factory',
    color: '#D9534F',
    revenue: 7200,
    maxEmployees: 60,
    openHour: 6,
    closeHour: 22,
    wagePerHour: 18,
  },
  {
    id: 'farm',
    name: 'Farm',
    type: 'farm',
    color: '#7CB342',
    revenue: 2400,
    maxEmployees: 12,
    openHour: 5,
    closeHour: 19,
    wagePerHour: 12,
  },
  {
    id: 'warehouse',
    name: 'Warehouse',
    type: 'warehouse',
    color: '#8D6E63',
    revenue: 3000,
    maxEmployees: 20,
    openHour: 7,
    closeHour: 20,
    wagePerHour: 16,
  },
  {
    id: 'tech',
    name: 'Tech Hub',
    type: 'tech',
    color: '#7E57C2',
    revenue: 9600,
    maxEmployees: 50,
    openHour: 9,
    closeHour: 19,
    wagePerHour: 30,
  },
  {
    id: 'restaurant',
    name: 'Restaurant',
    type: 'restaurant',
    color: '#EC407A',
    revenue: 1800,
    maxEmployees: 10,
    openHour: 11,
    closeHour: 23,
    wagePerHour: 13,
  },
  {
    id: 'hospital',
    name: 'Hospital',
    type: 'hospital',
    color: '#26A69A',
    revenue: 5400,
    maxEmployees: 35,
    openHour: 0,
    closeHour: 23,
    wagePerHour: 28,
  },
  {
    id: 'school',
    name: 'School',
    type: 'school',
    color: '#FFA726',
    revenue: 2100,
    maxEmployees: 25,
    openHour: 7,
    closeHour: 17,
    wagePerHour: 19,
  },
  {
    id: 'power-plant',
    name: 'Power Plant',
    type: 'power-plant',
    color: '#FFB300',
    revenue: 8400,
    maxEmployees: 30,
    openHour: 0,
    closeHour: 23,
    wagePerHour: 24,
  },
] as const);

/** Look up a definition by id. Returns undefined when the id is unknown. */
export function getBuildingType(id: string): BuildingTypeDefinition | undefined {
  return BUILDING_TYPES.find((b) => b.id === id);
}

/** Type guard: returns true when the value is a known catalog id. */
export function isBuildingTypeId(value: unknown): value is string {
  return typeof value === 'string' && BUILDING_TYPES.some((b) => b.id === value);
}
