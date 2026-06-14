/**
 * Building definitions — the canonical catalog of company types and the
 * residential definition used by `EconomySystem` and the renderer.
 *
 * The catalog is intentionally a *constant* (not generated) so:
 *  - The same `BuildingDef` ids are produced for any seed → benchmarks
 *    and snapshots remain stable.
 *  - `World.registerBuildingDef` can be called deterministically during
 *    `CityGenerator` init.
 *  - The renderer can look up colors by id without re-deriving them.
 *
 * Ten company entries + one residential entry. Colors are
 * palette-aligned and human-friendly. `openHour`/`closeHour` are in
 * `[0, 24)`; values that wrap midnight (closeHour < openHour) are
 * valid and represent overnight businesses — see `isOpen` in
 * `EconomySystem`.
 *
 * Layer rule: pure TypeScript, no React, no DOM, no engine runtime.
 */

import type { BuildingDef } from '@/engine/types';

/** Residential definition. No revenue, no employees, no business hours. */
export const RESIDENTIAL_DEF: BuildingDef = {
  id: 'def-residential-house',
  name: 'House',
  type: 'residential',
  color: '#5b8def',
  revenue: 0,
  maxEmployees: 0,
  openHour: 0,
  closeHour: 24,
  size: { width: 2, height: 2 },
};

/**
 * Canonical catalog of 10 company (non-residential) building defs.
 *
 * The order is stable and meaningful: it is the iteration order the
 * `BuildingPlacer` uses to pick a def for each zone. Keep the first
 * 4 entries aligned with the canonical zone kinds
 * (commercial → shop, industrial → factory, entertainment → restaurant,
 * plus an office for the wider CBD).
 */
export const BUILDING_DEFS: readonly BuildingDef[] = [
  {
    id: 'def-shop',
    name: 'Shop',
    type: 'shop',
    color: '#ffb454',
    revenue: 320,
    maxEmployees: 6,
    openHour: 9,
    closeHour: 21,
    size: { width: 2, height: 2 },
  },
  {
    id: 'def-office',
    name: 'Office',
    type: 'office',
    color: '#3aa0ff',
    revenue: 480,
    maxEmployees: 20,
    openHour: 8,
    closeHour: 18,
    size: { width: 2, height: 2 },
  },
  {
    id: 'def-factory',
    name: 'Factory',
    type: 'factory',
    color: '#a4a4a4',
    revenue: 540,
    maxEmployees: 24,
    openHour: 6,
    closeHour: 22,
    size: { width: 3, height: 3 },
  },
  {
    id: 'def-warehouse',
    name: 'Warehouse',
    type: 'warehouse',
    color: '#8d6e63',
    revenue: 260,
    maxEmployees: 8,
    openHour: 7,
    closeHour: 19,
    size: { width: 3, height: 2 },
  },
  {
    id: 'def-tech',
    name: 'Tech Hub',
    type: 'tech',
    color: '#7c4dff',
    revenue: 720,
    maxEmployees: 32,
    openHour: 9,
    closeHour: 19,
    size: { width: 2, height: 2 },
  },
  {
    id: 'def-restaurant',
    name: 'Restaurant',
    type: 'restaurant',
    // Overnight: open at 17, close at 02 (next day).
    color: '#e879f9',
    revenue: 410,
    maxEmployees: 12,
    openHour: 17,
    closeHour: 2,
    size: { width: 2, height: 2 },
  },
  {
    id: 'def-hospital',
    name: 'Hospital',
    type: 'hospital',
    color: '#ff5252',
    revenue: 900,
    maxEmployees: 40,
    // 24h operation
    openHour: 0,
    closeHour: 24,
    size: { width: 3, height: 3 },
  },
  {
    id: 'def-school',
    name: 'School',
    type: 'school',
    color: '#fdd835',
    revenue: 0,
    maxEmployees: 18,
    openHour: 8,
    closeHour: 15,
    size: { width: 3, height: 2 },
  },
  {
    id: 'def-farm',
    name: 'Farm',
    type: 'farm',
    color: '#66bb6a',
    revenue: 220,
    maxEmployees: 4,
    openHour: 5,
    closeHour: 20,
    size: { width: 2, height: 2 },
  },
  {
    id: 'def-park',
    name: 'Park',
    type: 'park',
    color: '#43a047',
    revenue: 0,
    maxEmployees: 0,
    openHour: 0,
    closeHour: 24,
    size: { width: 2, height: 2 },
  },
] as const;

/**
 * Convenience alias: every non-residential def in `BUILDING_DEFS`.
 * Used by the EconomySystem to iterate over employers.
 */
export const COMPANY_BUILDING_DEFS: readonly BuildingDef[] = BUILDING_DEFS;
