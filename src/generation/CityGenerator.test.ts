/**
 * Unit tests for the CityGenerator.
 */

import { Grid } from '@/engine';
import { generateCity, mulberry32, type ZoneType } from './CityGenerator';

const GRID_W = 80;
const GRID_H = 80;

function hashGrid(grid: Grid): string {
  // FNV-1a over tile types.
  let h = 0x811c9dc5;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const t = grid.getTile(x, y);
      if (!t) continue;
      const s = t.type;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function countRoadTiles(grid: Grid): number {
  let count = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.getTile(x, y)?.type === 'road') count++;
    }
  }
  return count;
}

function isMainRoadCoord(coord: number): boolean {
  for (const start of [0, 16, 32, 48, 64]) {
    if (coord === start || coord === start + 1) return true;
  }
  return false;
}

function isSecondaryRoadCoord(coord: number): boolean {
  const secondaries = new Set([8, 24, 40, 56, 72]);
  return secondaries.has(coord);
}

describe('CityGenerator', () => {
  it('mulberry32 is deterministic for same seed and different for different seeds', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);

    for (let i = 0; i < 50; i++) {
      expect(a()).toBe(b());
    }

    let diff = false;
    for (let i = 0; i < 10; i++) {
      if (c() !== b()) diff = true;
    }
    expect(diff).toBe(true);
  });

  it('generates at least one road tile', () => {
    const grid = new Grid(GRID_W, GRID_H);
    generateCity(grid, { seed: 123 });
    expect(countRoadTiles(grid)).toBeGreaterThan(0);
  });

  it('main roads are exactly 2 tiles wide every 16 tiles (x and y axes)', () => {
    const grid = new Grid(GRID_W, GRID_H);
    generateCity(grid, { seed: 1 });

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const expected = isMainRoadCoord(x) || isMainRoadCoord(y);
        const actualIsRoad = grid.getTile(x, y)!.type === 'road';
        if (!expected) continue;
        expect(actualIsRoad).toBe(true);
      }
    }
  });

  it('secondary roads are 1 tile wide every 8 tiles excluding main-road positions', () => {
    const grid = new Grid(GRID_W, GRID_H);
    generateCity(grid, { seed: 1 });

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const main = isMainRoadCoord(x) || isMainRoadCoord(y);
        const secondary = isSecondaryRoadCoord(x) || isSecondaryRoadCoord(y);

        if (!secondary || main) continue;
        expect(grid.getTile(x, y)!.type).toBe('road');
      }
    }
  });

  it('seed=42 produces deterministic identical grid hash', () => {
    const grid1 = new Grid(GRID_W, GRID_H);
    const grid2 = new Grid(GRID_W, GRID_H);
    generateCity(grid1, { seed: 42 });
    generateCity(grid2, { seed: 42 });

    expect(hashGrid(grid1)).toBe(hashGrid(grid2));
  });

  it('zones include all 5 zone types and have stable bounds for BuildingPlacer', () => {
    const grid = new Grid(GRID_W, GRID_H);
    const res = generateCity(grid, { seed: 7 });

    const types = res.zones.map((z) => z.type);
    const unique = new Set(types);
    expect(unique).toEqual(
      new Set<ZoneType>([
        'residential',
        'commercial',
        'industrial',
        'entertainment',
        'park',
      ]),
    );

    expect(res.zones).toHaveLength(5);

    const byType = new Map(res.zones.map((z) => [z.type, z] as const));
    expect(byType.get('residential')).toMatchObject({ x0: 2, y0: 2, x1: 14, y1: 14 });
    expect(byType.get('commercial')).toMatchObject({ x0: 66, y0: 2, x1: 78, y1: 14 });
    expect(byType.get('industrial')).toMatchObject({ x0: 2, y0: 66, x1: 14, y1: 78 });
    expect(byType.get('entertainment')).toMatchObject({ x0: 66, y0: 66, x1: 78, y1: 78 });
    expect(byType.get('park')).toMatchObject({ x0: 34, y0: 34, x1: 45, y1: 45 });
  });
});
