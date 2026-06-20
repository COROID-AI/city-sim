/**
 * Building type definitions and catalog.
 *
 * Spec Phase 6.1: building type names, colors, and metadata live here as the
 * single source of truth consumed by BuildingPlacer and the Renderer.
 */

import type { ZoneType } from '@/generation/CityGenerator';

/**
 * Concrete building footprint definition emitted by BuildingPlacer.
 *
 * `width`/`height` are in tiles; `x`/`y` is the top-left tile coordinate.
 */
export interface BuildingDef {
  /** Stable unique id within a generation run. */
  readonly id: string;
  /** Human-readable name from the building-type catalog. */
  readonly name: string;
  /** Zone/category this building belongs to. */
  readonly type: ZoneType;
  /** Footprint width in tiles. */
  readonly width: number;
  /** Footprint height in tiles. */
  readonly height: number;
  /** Top-left x tile coordinate. */
  readonly x: number;
  /** Top-left y tile coordinate. */
  readonly y: number;
  /** Render color (hex) from the building-type catalog. */
  readonly color: string;
  /** Maximum number of citizen occupants. */
  readonly maxOccupants: number;
  /** Operating hours as [openHour, closeHour) in 24h clock. */
  readonly operatingHours: readonly [number, number];
  /** Revenue generated per simulated hour when occupied. */
  readonly revenuePerHour: number;
}

/**
 * Catalog entry describing a buildable building archetype per zone.
 */
export interface BuildingTypeEntry {
  readonly name: string;
  readonly type: ZoneType;
  /** Footprint size options in tiles (width, height). */
  readonly sizes: readonly (readonly [number, number])[];
  readonly color: string;
  readonly maxOccupants: number;
  readonly operatingHours: readonly [number, number];
  readonly revenuePerHour: number;
}

/**
 * Building archetype catalog keyed by zone type (Phase 6.1).
 *
 * Each zone exposes several named building types with palette colors and
 * economic metadata. BuildingPlacer selects from this catalog deterministically.
 */
export const BUILDING_TYPES: Readonly<Record<ZoneType, readonly BuildingTypeEntry[]>> = {
  residential: [
    {
      name: 'House',
      type: 'residential',
      sizes: [
        [2, 2],
        [3, 2],
      ],
      color: '#8fd3a8',
      maxOccupants: 4,
      operatingHours: [0, 24],
      revenuePerHour: 1,
    },
    {
      name: 'Apartment',
      type: 'residential',
      sizes: [
        [3, 3],
        [4, 3],
      ],
      color: '#5fb583',
      maxOccupants: 12,
      operatingHours: [0, 24],
      revenuePerHour: 3,
    },
  ],
  commercial: [
    {
      name: 'Shop',
      type: 'commercial',
      sizes: [
        [2, 2],
        [3, 2],
      ],
      color: '#6db4e8',
      maxOccupants: 8,
      operatingHours: [8, 22],
      revenuePerHour: 10,
    },
    {
      name: 'Office',
      type: 'commercial',
      sizes: [
        [3, 3],
        [4, 4],
      ],
      color: '#4a90d9',
      maxOccupants: 20,
      operatingHours: [9, 18],
      revenuePerHour: 25,
    },
  ],
  industrial: [
    {
      name: 'Factory',
      type: 'industrial',
      sizes: [
        [3, 3],
        [4, 3],
      ],
      color: '#d9b36c',
      maxOccupants: 15,
      operatingHours: [6, 20],
      revenuePerHour: 18,
    },
    {
      name: 'Warehouse',
      type: 'industrial',
      sizes: [
        [4, 3],
        [4, 4],
      ],
      color: '#b89355',
      maxOccupants: 10,
      operatingHours: [0, 24],
      revenuePerHour: 12,
    },
  ],
  entertainment: [
    {
      name: 'Cafe',
      type: 'entertainment',
      sizes: [
        [2, 2],
        [3, 2],
      ],
      color: '#e88fd0',
      maxOccupants: 10,
      operatingHours: [10, 24],
      revenuePerHour: 15,
    },
    {
      name: 'Theater',
      type: 'entertainment',
      sizes: [
        [3, 3],
        [4, 3],
      ],
      color: '#c96bb8',
      maxOccupants: 30,
      operatingHours: [12, 24],
      revenuePerHour: 30,
    },
  ],
  park: [
    {
      name: 'Garden',
      type: 'park',
      sizes: [
        [2, 2],
        [3, 2],
      ],
      color: '#a8e06a',
      maxOccupants: 20,
      operatingHours: [6, 22],
      revenuePerHour: 2,
    },
    {
      name: 'Plaza',
      type: 'park',
      sizes: [
        [3, 3],
        [4, 3],
      ],
      color: '#86c950',
      maxOccupants: 40,
      operatingHours: [6, 22],
      revenuePerHour: 5,
    },
  ],
};

/**
 * Return the building-type catalog entries for a given zone.
 */
export function getBuildingTypesForZone(zone: ZoneType): readonly BuildingTypeEntry[] {
  return BUILDING_TYPES[zone];
}
