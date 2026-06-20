/**
 * Unit tests for BuildingPlacer.
 */

import { Grid } from '@/engine';
import { generateCity, type GeneratedZone } from './CityGenerator';
import { placeBuildingsInZone, placeAllBuildings } from './BuildingPlacer';
import type { BuildingDef } from '@/constants/building-types';

const GRID_W = 80;
const GRID_H = 80;

/** Build a fully-generated city grid + zones for tests. */
function makeCity(seed = 42): { grid: Grid; zones: GeneratedZone[] } {
  const grid = new Grid(GRID_W, GRID_H);
  const res = generateCity(grid, { seed });
  return { grid, zones: [...res.zones] };
}

/** Check whether a footprint has at least one road tile in its 8-neighborhood. */
function hasRoadNeighbor(grid: Grid, b: BuildingDef): boolean {
  for (let dy = -1; dy <= b.height; dy++) {
    for (let dx = -1; dx <= b.width; dx++) {
      const isInterior = dx >= 0 && dx < b.width && dy >= 0 && dy < b.height;
      if (isInterior) continue;
      const tile = grid.getTile(b.x + dx, b.y + dy);
      if (tile && tile.type === 'road') return true;
    }
  }
  return false;
}

/** Check whether two footprints overlap (axis-aligned). */
function overlaps(a: BuildingDef, b: BuildingDef): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Stable hash of a BuildingDef list for determinism checks. */
function hashBuildings(buildings: readonly BuildingDef[]): string {
  let h = 0x811c9dc5;
  for (const b of buildings) {
    const s = `${b.id}|${b.x},${b.y}|${b.width}x${b.height}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('BuildingPlacer', () => {
  it('placeBuildingsInZone returns 3-8 buildings for a residential zone', () => {
    const { grid, zones } = makeCity();
    const residential = zones.find((z) => z.type === 'residential')!;
    const buildings = placeBuildingsInZone(grid, residential, { seed: 42, density: 0.6 });

    expect(buildings.length).toBeGreaterThanOrEqual(3);
    expect(buildings.length).toBeLessThanOrEqual(8);
  });

  it('no two building footprints overlap', () => {
    const { grid, zones } = makeCity();
    const residential = zones.find((z) => z.type === 'residential')!;
    const buildings = placeBuildingsInZone(grid, residential, { seed: 42 });

    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        expect(overlaps(buildings[i], buildings[j])).toBe(false);
      }
    }
  });

  it('every building has at least one road tile in its 8-neighborhood', () => {
    const { grid, zones } = makeCity();
    for (const zone of zones) {
      const buildings = placeBuildingsInZone(grid, zone, { seed: 42 });
      for (const b of buildings) {
        expect(hasRoadNeighbor(grid, b)).toBe(true);
      }
    }
  });

  it('all footprint tiles remain within zone bounds (no spillover)', () => {
    const { grid, zones } = makeCity();
    for (const zone of zones) {
      const buildings = placeBuildingsInZone(grid, zone, { seed: 42 });
      for (const b of buildings) {
        expect(b.x).toBeGreaterThanOrEqual(zone.x0);
        expect(b.y).toBeGreaterThanOrEqual(zone.y0);
        expect(b.x + b.width - 1).toBeLessThanOrEqual(zone.x1);
        expect(b.y + b.height - 1).toBeLessThanOrEqual(zone.y1);
      }
    }
  });

  it('footprint tiles are marked building on the grid after placement', () => {
    const { grid, zones } = makeCity();
    const residential = zones.find((z) => z.type === 'residential')!;
    const buildings = placeBuildingsInZone(grid, residential, { seed: 42 });

    for (const b of buildings) {
      for (let dy = 0; dy < b.height; dy++) {
        for (let dx = 0; dx < b.width; dx++) {
          expect(grid.getTile(b.x + dx, b.y + dy)?.type).toBe('building');
        }
      }
    }
  });

  it('BuildingDef has all required fields', () => {
    const { grid, zones } = makeCity();
    const residential = zones.find((z) => z.type === 'residential')!;
    const buildings = placeBuildingsInZone(grid, residential, { seed: 42 });

    for (const b of buildings) {
      expect(typeof b.id).toBe('string');
      expect(typeof b.name).toBe('string');
      expect(b.type).toBe('residential');
      expect(typeof b.width).toBe('number');
      expect(typeof b.height).toBe('number');
      expect(typeof b.color).toBe('string');
      expect(typeof b.maxOccupants).toBe('number');
      expect(Array.isArray(b.operatingHours)).toBe(true);
      expect(b.operatingHours.length).toBe(2);
      expect(typeof b.revenuePerHour).toBe('number');
    }
  });

  it('placeAllBuildings with seed=42 returns >=20 buildings deterministically', () => {
    const a = makeCity(42);
    const b = makeCity(42);

    const buildingsA = placeAllBuildings(a.grid, a.zones, { seed: 42 });
    const buildingsB = placeAllBuildings(b.grid, b.zones, { seed: 42 });

    expect(buildingsA.length).toBeGreaterThanOrEqual(20);
    expect(hashBuildings(buildingsA)).toBe(hashBuildings(buildingsB));
  });

  it('placeBuildingsInZone is deterministic for a given seed', () => {
    const a = makeCity(7);
    const b = makeCity(7);
    const commercial = a.zones.find((z) => z.type === 'commercial')!;
    const commercial2 = b.zones.find((z) => z.type === 'commercial')!;

    const buildingsA = placeBuildingsInZone(a.grid, commercial, { seed: 7 });
    const buildingsB = placeBuildingsInZone(b.grid, commercial2, { seed: 7 });

    expect(hashBuildings(buildingsA)).toBe(hashBuildings(buildingsB));
  });

  it('building type names come from the building-types catalog', () => {
    const { grid, zones } = makeCity();
    const all = placeAllBuildings(grid, zones, { seed: 42 });

    const validNames = new Set<string>([
      'House',
      'Apartment',
      'Shop',
      'Office',
      'Factory',
      'Warehouse',
      'Cafe',
      'Theater',
      'Garden',
      'Plaza',
    ]);

    for (const b of all) {
      expect(validNames.has(b.name)).toBe(true);
    }
  });
});
