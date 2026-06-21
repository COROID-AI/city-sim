/**
 * Tests for CityGenerator: road placement, zones, buildings, citizens,
 * vehicles, and determinism.
 */

import { TileType } from '@/engine/types';
import { Grid } from '@/engine/World';
import {
  MAIN_ROAD_INTERVAL,
  ZONE_TYPES,
} from '@/constants';
import { generateCity } from '@/generation/CityGenerator';

describe('CityGenerator', () => {
 describe('generateCity', () => {
  it('returns a world with an 80×80 grid by default', () => {
   const world = generateCity();
   expect(world.grid.width).toBe(80);
   expect(world.grid.height).toBe(80);
  });

  it('respects custom width and height', () => {
   const world = generateCity(32, 32);
   expect(world.grid.width).toBe(32);
   expect(world.grid.height).toBe(32);
  });

  it('throws on non-positive dimensions', () => {
   expect(() => generateCity(0, 10)).toThrow();
   expect(() => generateCity(10, -1)).toThrow();
  });
 });

 describe('road placement', () => {
  const world = generateCity(80, 80);

  it('places main roads at multiples of 16 (2 tiles wide)', () => {
   // x=0 and x=1 should both be road (width 2)
   for (let i = 0; i < 80; i += MAIN_ROAD_INTERVAL) {
    for (let y = 0; y < 80; y += 1) {
     const v0 = world.grid.getTile(i, y);
     const v1 = world.grid.getTile(i + 1, y);
     // Road tiles may have StreetLight flag OR'd in
     expect(v0 === TileType.Road || v0 === (TileType.Road | TileType.StreetLight)).toBe(true);
     expect(v1 === TileType.Road || v1 === (TileType.Road | TileType.StreetLight)).toBe(true);
    }
   }
  });

  it('places secondary roads at multiples of 8 (excluding main)', () => {
   // x=8, 24, 40, 56, 72 are secondary road positions
   const secondaryIndices = [8, 24, 40, 56, 72];
   for (const x of secondaryIndices) {
    for (let y = 0; y < 80; y += 1) {
     const v = world.grid.getTile(x, y);
     // Road tiles may have StreetLight flag OR'd in
     expect(v === TileType.Road || v === (TileType.Road | TileType.StreetLight)).toBe(true);
    }
   }
  });

  it('has at least some road tiles in the grid', () => {
   let roadCount = 0;
   for (let y = 0; y < 80; y += 1) {
    for (let x = 0; x < 80; x += 1) {
     const v = world.grid.getTile(x, y);
     if (v === TileType.Road || v === (TileType.Road | TileType.StreetLight)) {
      roadCount += 1;
     }
    }
   }
   expect(roadCount).toBeGreaterThan(0);
  });
 });

 describe('zones', () => {
  const world = generateCity(80, 80);

  it('defines all five zone types with valid bounds', () => {
   for (const z of ZONE_TYPES) {
    const b = world.zones[z];
    expect(b).toBeDefined();
    expect(b.minX).toBeLessThanOrEqual(b.maxX);
    expect(b.minY).toBeLessThanOrEqual(b.maxY);
   }
  });
 });

 describe('buildings', () => {
  const world = generateCity(80, 80);

  it('places at least one building', () => {
   expect(world.buildings.length).toBeGreaterThan(0);
  });

  it('places buildings within zone bounds', () => {
   for (const b of world.buildings) {
    const zone = world.zones[b.zone];
    expect(b.x).toBeGreaterThanOrEqual(zone.minX);
    expect(b.y).toBeGreaterThanOrEqual(zone.minY);
    expect(b.x + b.width).toBeLessThanOrEqual(zone.maxX);
    expect(b.y + b.height).toBeLessThanOrEqual(zone.maxY);
   }
  });

  it('does not overlap building footprints', () => {
   const occupied = new Set<string>();
   for (const b of world.buildings) {
    for (let dy = 0; dy < b.height; dy += 1) {
     for (let dx = 0; dx < b.width; dx += 1) {
      const key = `${b.x + dx},${b.y + dy}`;
      expect(occupied.has(key)).toBe(false);
      occupied.add(key);
     }
    }
   }
  });
 });

 describe('street lights', () => {
  const world = generateCity(80, 80);

  it('places at least one street light', () => {
   expect(world.streetLights.length).toBeGreaterThan(0);
  });
 });

 describe('citizens', () => {
  const world = generateCity(80, 80);

  it('spawns citizens with home and work zones', () => {
   expect(world.citizens.length).toBeGreaterThan(0);
   for (const c of world.citizens) {
    expect(c.homeZone).toBe('residential');
    expect(['commercial', 'industrial']).toContain(c.workZone);
   }
  });
 });

 describe('vehicles', () => {
  const world = generateCity(80, 80);

  it('spawns vehicles on road tiles', () => {
   expect(world.vehicles.length).toBeGreaterThan(0);
   for (const v of world.vehicles) {
    const tile = world.grid.getTile(v.position.x, v.position.y);
    expect(tile === TileType.Road || tile === (TileType.Road | TileType.StreetLight)).toBe(true);
   }
  });
 });

 describe('determinism', () => {
  it('produces identical output for the same seed', () => {
   const w1 = generateCity(80, 80, { seed: 42 });
   const w2 = generateCity(80, 80, { seed: 42 });

   expect(w1.buildings).toEqual(w2.buildings);
   expect(w1.citizens).toEqual(w2.citizens);
   expect(w1.vehicles).toEqual(w2.vehicles);
   expect(w1.streetLights).toEqual(w2.streetLights);
  });

  it('produces different output for different seeds', () => {
   const w1 = generateCity(80, 80, { seed: 1 });
   const w2 = generateCity(80, 80, { seed: 999 });

   // At least buildings or citizens should differ
   const same = JSON.stringify(w1.buildings) === JSON.stringify(w2.buildings);
   expect(same).toBe(false);
  });
 });
});

describe('Grid', () => {
 describe('basic operations', () => {
  const grid = new Grid(10, 10);

  it('reports correct dimensions', () => {
   expect(grid.width).toBe(10);
   expect(grid.height).toBe(10);
  });

  it('getTile returns Empty (0) for uninitialized tiles', () => {
   expect(grid.getTile(0, 0)).toBe(0);
  });

  it('setTile and getTile round-trip', () => {
   grid.setTile(3, 4, TileType.Road);
   expect(grid.getTile(3, 4)).toBe(TileType.Road);
  });

  it('isInBounds works correctly', () => {
   expect(grid.isInBounds(0, 0)).toBe(true);
   expect(grid.isInBounds(9, 9)).toBe(true);
   expect(grid.isInBounds(-1, 0)).toBe(false);
   expect(grid.isInBounds(0, 10)).toBe(false);
   expect(grid.isInBounds(10, 10)).toBe(false);
  });

  it('getTile returns undefined for out-of-bounds', () => {
   expect(grid.getTile(-1, 0)).toBeUndefined();
   expect(grid.getTile(10, 0)).toBeUndefined();
  });

  it('setTile is a no-op for out-of-bounds', () => {
   expect(() => grid.setTile(100, 100, TileType.Road)).not.toThrow();
  });
 });

 describe('getTilesInRect', () => {
  const grid = new Grid(10, 10);
  grid.setTile(0, 0, 1);
  grid.setTile(1, 0, 2);
  grid.setTile(0, 1, 3);

  it('returns tiles in the specified rectangle', () => {
   const tiles = grid.getTilesInRect(0, 0, 2, 2);
   expect(tiles).toHaveLength(4);
   expect(tiles.some((t) => t.x === 0 && t.y === 0 && t.value === 1)).toBe(true);
   expect(tiles.some((t) => t.x === 1 && t.y === 0 && t.value === 2)).toBe(true);
  });

  it('returns empty array for zero-size rect', () => {
   expect(grid.getTilesInRect(0, 0, 0, 0)).toEqual([]);
  });

  it('clamps to bounds', () => {
   const tiles = grid.getTilesInRect(8, 8, 5, 5);
   // Only 2x2 region is in bounds (8,8 to 9,9)
   expect(tiles).toHaveLength(4);
  });
 });

 describe('getNeighbors', () => {
  const grid = new Grid(5, 5);

  it('returns 4 neighbors for interior cell', () => {
   const neighbors = grid.getNeighbors(2, 2);
   expect(neighbors).toHaveLength(4);
  });

  it('returns 2 neighbors for corner cell', () => {
   const neighbors = grid.getNeighbors(0, 0);
   expect(neighbors).toHaveLength(2);
  });

  it('returns 3 neighbors for edge cell', () => {
   const neighbors = grid.getNeighbors(0, 2);
   expect(neighbors).toHaveLength(3);
  });
 });

 describe('findNearestRoad', () => {
  it('finds a road tile when one exists', () => {
   const grid = new Grid(10, 10);
   grid.setTile(5, 5, TileType.Road);
   const road = grid.findNearestRoad(0, 0);
   expect(road).toBeDefined();
   expect(road!.x).toBe(5);
   expect(road!.y).toBe(5);
  });

  it('returns undefined when no road exists', () => {
   const grid = new Grid(10, 10);
   expect(grid.findNearestRoad(0, 0)).toBeUndefined();
  });
 });
});
