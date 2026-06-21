/**
 * Core engine type definitions.
 *
 * Extended by the world-generation task to add tile, zone, building, citizen,
 * vehicle, and street-light types consumed by Grid / World / CityGenerator.
 * Existing interfaces (Vector2, CityTime, CityEconomy, CityEvent, UpdateContext)
 * are preserved for backward compatibility with GameLoop.
 */

export interface Vector2 {
  x: number;
  y: number;
}

export interface Tile {
  x: number;
  y: number;
  zone: string;
}

export interface BuildingDef {
  id: string;
  footprint: { width: number; height: number };
}

export interface CitizenState {
  id: string;
  position: Vector2;
}

export interface VehicleState {
  id: string;
  position: Vector2;
}

export interface CityTime {
  tick: number;
  elapsedMs: number;
}

export interface CityEconomy {
  money: number;
}

export interface CityEvent {
  type: string;
  payload?: unknown;
}

export interface UpdateContext {
  fixedDtMs: number;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// World-generation types
// ---------------------------------------------------------------------------

/**
 * Tile type encoding for the flat-array grid.
 *
 * Stored as a single byte per cell for cache locality. The numeric values are
 * intentionally small and stable so they can be persisted and rendered by a
 * simple lookup table.
 */
export enum TileType {
  Empty = 0,
  Grass = 1,
  Road = 2,
  Building = 3,
  StreetLight = 4,
}

/**
 * Zone classification for city regions.
 *
 * The five zones required by the spec. Each zone occupies a rectangular region
 * of the grid and constrains which buildings may be placed inside it.
 */
export type ZoneType =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'entertainment'
  | 'park';

/**
 * Rectangular zone bounds in grid coordinates (inclusive of min, exclusive of
 * max, matching the half-open interval convention used by getTilesInRect).
 */
export interface ZoneBounds {
  type: ZoneType;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A placed building footprint on the grid.
 */
export interface Building {
  id: string;
  zone: ZoneType;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A street light placed at a road-adjacent intersection or interval.
 */
export interface StreetLight {
  id: string;
  x: number;
  y: number;
}

/**
 * A citizen with a home zone and an assigned workplace zone.
 *
 * `homeZone` is always a residential zone. `workZone` is commercial or
 * industrial (parks and entertainment zones do not employ citizens).
 */
export interface Citizen {
  id: string;
  position: Vector2;
  homeZone: ZoneType;
  workZone: ZoneType;
}

/**
 * A vehicle spawned on a road tile.
 */
export interface Vehicle {
  id: string;
  position: Vector2;
}

/**
 * Road classification for the grid network.
 */
export type RoadType = 'main' | 'secondary';
