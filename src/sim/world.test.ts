import {
  createWorld,
  createTiles,
  getDaylightFactor,
} from './world';
import { GRID_WIDTH, GRID_HEIGHT, STARTING_BUDGET, HOURS_PER_DAY } from './constants';
import type { World } from './types';

// ─── createWorld ─────────────────────────────────────────────────────────────

describe('createWorld', () => {
  it('creates a world with the default grid dimensions', () => {
    const world = createWorld();
    expect(world.width).toBe(GRID_WIDTH);
    expect(world.height).toBe(GRID_HEIGHT);
    expect(world.tiles).toHaveLength(GRID_WIDTH * GRID_HEIGHT);
  });

  it('creates a world with custom dimensions', () => {
    const world = createWorld(10, 6);
    expect(world.width).toBe(10);
    expect(world.height).toBe(6);
    expect(world.tiles).toHaveLength(60);
  });

  it('initialises the starting budget', () => {
    const world = createWorld();
    expect(world.budget).toBe(STARTING_BUDGET);
  });

  it('starts at simulation time zero', () => {
    const world = createWorld();
    expect(world.simTime.elapsedHours).toBe(0);
  });

  it('creates empty entity maps', () => {
    const world: World = createWorld();
    expect(world.buildings.size).toBe(0);
    expect(world.citizens.size).toBe(0);
    expect(world.vehicles.size).toBe(0);
    expect(world.companies.size).toBe(0);
  });
});

// ─── createTiles ─────────────────────────────────────────────────────────────

describe('createTiles', () => {
  it('produces width × height tiles', () => {
    const tiles = createTiles(4, 3);
    expect(tiles).toHaveLength(12);
  });

  it('assigns correct x/y coordinates', () => {
    const tiles = createTiles(3, 2);
    // Tile at (1, 1) → index 4 in row-major order
    expect(tiles[4]).toMatchObject({ x: 1, y: 1 });
    // Tile at (2, 0) → index 2
    expect(tiles[2]).toMatchObject({ x: 2, y: 0 });
  });

  it('initialises all tiles as empty MIXED zone', () => {
    const tiles = createTiles(5, 5);
    for (const tile of tiles) {
      expect(tile.zone).toBe('MIXED');
      expect(tile.buildingId).toBeNull();
    }
  });
});

// ─── getDaylightFactor ───────────────────────────────────────────────────────

describe('getDaylightFactor', () => {
  it('returns a value in [0, 1]', () => {
    for (let h = 0; h < HOURS_PER_DAY; h += 0.5) {
      const factor = getDaylightFactor(h);
      expect(factor).toBeGreaterThanOrEqual(0);
      expect(factor).toBeLessThanOrEqual(1);
    }
  });

  it('is brightest near noon', () => {
    // Noon (hour 12) should be close to maximum (1)
    const noonFactor = getDaylightFactor(12);
    expect(noonFactor).toBeGreaterThan(0.9);
  });

  it('is darkest near midnight', () => {
    // Midnight (hour 0) should be close to minimum (0)
    const midnightFactor = getDaylightFactor(0);
    expect(midnightFactor).toBeLessThan(0.1);
  });

  it('is periodic with period 24 hours', () => {
    const factorA = getDaylightFactor(6);
    const factorB = getDaylightFactor(6 + HOURS_PER_DAY);
    expect(factorA).toBeCloseTo(factorB, 5);
  });

  it('changes monotonically from midnight to noon', () => {
    // From midnight to noon the factor should generally increase.
    let prev = getDaylightFactor(0);
    for (let h = 0.5; h <= 12; h += 0.5) {
      const curr = getDaylightFactor(h);
      // Allow tiny float noise but overall upward trend.
      expect(curr).toBeGreaterThanOrEqual(prev - 0.01);
      prev = curr;
    }
  });

  it('wraps correctly for elapsed hours beyond 24', () => {
    const base = getDaylightFactor(3);
    const wrapped = getDaylightFactor(3 + 3 * HOURS_PER_DAY);
    expect(wrapped).toBeCloseTo(base, 5);
  });
});
