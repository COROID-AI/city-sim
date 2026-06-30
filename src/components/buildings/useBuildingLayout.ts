/**
 * Deterministic building layout hook.
 *
 * Given an era's `YearConfig`, produces an array of building placement
 * descriptors (position, dimensions, style config) arranged on a grid with no
 * bounding-box overlaps. The layout is deterministic — the same era always
 * yields the same building set — so snapshots are stable.
 */
import { useMemo } from 'react';
import type { YearConfig } from '@/config/years';
import {
  getBuildingStyleConfig,
  type BuildingStyleConfig,
} from './buildingStyles';

/**
 * A single building placement: world position, footprint, height, and the
 * resolved style config.
 */
export interface BuildingPlacement {
  /** Unique id (stable across renders for the same era). */
  readonly id: string;
  /** World position [x, y, z]. y is always 0 (buildings sit on the ground). */
  readonly position: [number, number, number];
  /** Footprint width (x axis). */
  readonly width: number;
  /** Footprint depth (z axis). */
  readonly depth: number;
  /** Building height in world units. */
  readonly height: number;
  /** Resolved style configuration. */
  readonly styleConfig: BuildingStyleConfig;
}

/** Minimum number of buildings per block (acceptance criterion). */
export const MIN_BUILDINGS = 6;

/** Grid cell size; buildings are centered within their cell. */
const CELL_SIZE = 10;
/** Gap between adjacent buildings to guarantee no overlap. */
const BUILDING_GAP = 1.5;

/**
 * Generate a deterministic building layout for the given era config.
 *
 * Uses a 3×3 grid (9 cells) and selects at least `MIN_BUILDINGS` cells. The
 * number of active cells scales with the era's `density` value. Each cell
 * hosts one building whose height is derived from `maxHeight` with a
 * deterministic per-cell variation.
 *
 * The function is pure and side-effect free.
 */
export function generateBuildingLayout(config: YearConfig): BuildingPlacement[] {
  const styleConfig = getBuildingStyleConfig(config.buildingStyle);
  const baseWidth = styleConfig.defaultWidth;
  const baseDepth = styleConfig.defaultDepth;

  // 3×3 grid = 9 candidate cells. Density controls how many are occupied.
  const totalCells = 9;
  const occupiedCells = Math.max(
    MIN_BUILDINGS,
    Math.round(totalCells * config.density),
  );

  // Deterministic pseudo-random based on cell index (no Math.random).
  const heightVariation = (index: number): number => {
    const factor = 0.5 + ((index * 37) % 100) / 100;
    return Math.max(4, config.maxHeight * factor * 0.6);
  };

  const placements: BuildingPlacement[] = [];
  const gridOffset = (CELL_SIZE * (3 - 1)) / 2; // center the 3×3 grid

  for (let i = 0; i < occupiedCells && i < totalCells; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);

    const x = col * CELL_SIZE - gridOffset;
    const z = row * CELL_SIZE - gridOffset;

    // Shrink footprint to fit within cell minus gap.
    const maxFootprint = CELL_SIZE - BUILDING_GAP * 2;
    const width = Math.min(baseWidth, maxFootprint);
    const depth = Math.min(baseDepth, maxFootprint);

    placements.push({
      id: `${config.id}-building-${i}`,
      position: [x, 0, z],
      width,
      depth,
      height: heightVariation(i),
      styleConfig,
    });
  }

  return placements;
}

/**
 * React hook wrapping `generateBuildingLayout` in `useMemo`. Re-computes only
 * when the era id or maxHeight changes.
 */
export function useBuildingLayout(config: YearConfig): BuildingPlacement[] {
  return useMemo(() => generateBuildingLayout(config), [config]);
}

/**
 * Check whether any two placements in the array have overlapping bounding
 * boxes (in the xz-plane). Returns `true` if there are no overlaps.
 */
export function hasNoOverlaps(placements: BuildingPlacement[]): boolean {
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i];
      const b = placements[j];
      const aHalfW = a.width / 2;
      const aHalfD = a.depth / 2;
      const bHalfW = b.width / 2;
      const bHalfD = b.depth / 2;

      const dx = Math.abs(a.position[0] - b.position[0]);
      const dz = Math.abs(a.position[2] - b.position[2]);

      if (dx < aHalfW + bHalfW && dz < aHalfD + bHalfD) {
        return false;
      }
    }
  }
  return true;
}
