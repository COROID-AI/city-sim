import { generateCity } from '@/generation/CityGenerator';
import { TileType } from '@/engine/types';
import {
  DEFAULT_GRID_HEIGHT,
  DEFAULT_GRID_WIDTH,
  DEFAULT_SEED,
  SECONDARY_ROAD_INTERVAL,
} from '@/constants';

describe('CityGenerator', () => {
  describe('generateCity — grid dimensions', () => {
    it('returns a World with default 80×80 grid dimensions', () => {
      const world = generateCity();

      expect(world.grid.width).toBe(DEFAULT_GRID_WIDTH);
      expect(world.grid.height).toBe(DEFAULT_GRID_HEIGHT);
    });

    it('honours custom width and height', () => {
      const world = generateCity(40, 40);

      expect(world.grid.width).toBe(40);
      expect(world.grid.height).toBe(40);
    });
  });

  describe('generateCity — roads', () => {
    it('places Road tiles on main road indices (multiples of 16)', () => {
      const world = generateCity();
      const { grid } = world;

      // Main roads run along both axes at multiples of MAIN_ROAD_INTERVAL.
      // Check a vertical main road at x=0, y=0.
      const tile = grid.getTile(0, 0);
      expect(tile).toBeDefined();
      // Road tiles may be Road (2) or Road|StreetLight (2|4=6).
      expect(tile === TileType.Road || tile === (TileType.Road | TileType.StreetLight)).toBe(true);
    });

    it('places Road tiles on secondary road indices (multiples of 8, excluding 16)', () => {
      const world = generateCity();
      const { grid } = world;

      // x=8 is a secondary road index (8 % 8 === 0 && 8 % 16 !== 0).
      const tile = grid.getTile(SECONDARY_ROAD_INTERVAL, 0);
      expect(tile).toBeDefined();
      expect(tile === TileType.Road || tile === (TileType.Road | TileType.StreetLight)).toBe(true);
    });

    it('has road tiles spanning the full grid (non-zero road count)', () => {
      const world = generateCity();
      const { grid } = world;

      let roadCount = 0;
      for (let y = 0; y < grid.height; y += 1) {
        for (let x = 0; x < grid.width; x += 1) {
          const v = grid.getTile(x, y);
          if (v === TileType.Road || v === (TileType.Road | TileType.StreetLight)) {
            roadCount += 1;
          }
        }
      }

      // With main roads every 16 and secondary every 8, we expect a substantial
      // road network on an 80×80 grid.
      expect(roadCount).toBeGreaterThan(100);
    });
  });

  describe('generateCity — buildings', () => {
    it('produces a non-empty buildings array with valid footprints', () => {
      const world = generateCity();

      expect(world.buildings.length).toBeGreaterThan(0);

      for (const b of world.buildings) {
        expect(b.id).toBeTruthy();
        expect(b.width).toBeGreaterThanOrEqual(1);
        expect(b.height).toBeGreaterThanOrEqual(1);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(world.grid.width);
        expect(b.y + b.height).toBeLessThanOrEqual(world.grid.height);
      }
    });

    it('marks building tiles on the grid', () => {
      const world = generateCity();
      const { grid } = world;

      // At least one building footprint should have Building tiles on the grid.
      let buildingTileCount = 0;
      for (let y = 0; y < grid.height; y += 1) {
        for (let x = 0; x < grid.width; x += 1) {
          if (grid.getTile(x, y) === TileType.Building) {
            buildingTileCount += 1;
          }
        }
      }

      expect(buildingTileCount).toBeGreaterThan(0);
    });
  });

  describe('generateCity — determinism', () => {
    it('produces identical output for the same seed', () => {
      const worldA = generateCity(undefined, undefined, { seed: 42 });
      const worldB = generateCity(undefined, undefined, { seed: 42 });

      expect(worldA.buildings).toEqual(worldB.buildings);
      expect(worldA.citizens).toEqual(worldB.citizens);
      expect(worldA.vehicles).toEqual(worldB.vehicles);
    });

    it('uses DEFAULT_SEED when no seed is provided', () => {
      const worldDefault = generateCity();
      const worldExplicit = generateCity(undefined, undefined, { seed: DEFAULT_SEED });

      expect(worldDefault.buildings).toEqual(worldExplicit.buildings);
    });
  });

  describe('generateCity — validation', () => {
    it('throws on non-positive width', () => {
      expect(() => generateCity(0, 80)).toThrow('width');
      expect(() => generateCity(-5, 80)).toThrow('width');
    });

    it('throws on non-positive height', () => {
      expect(() => generateCity(80, 0)).toThrow('height');
      expect(() => generateCity(80, -1)).toThrow('height');
    });

    it('throws on non-integer dimensions', () => {
      expect(() => generateCity(10.5, 80)).toThrow('width');
      expect(() => generateCity(80, 10.5)).toThrow('height');
    });
  });
});
