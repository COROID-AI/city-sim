/**
 * Unit tests for the Grid class.
 *
 * Covers all acceptance criteria: construction, getTile (in/out of bounds),
 * setTile persistence + out-of-bounds no-op, inBounds, neighbors (cardinal &
 * diagonal), and the private index() round-trip via getTile/setTile.
 */

import { Grid } from './Grid';
import type { Tile } from './Grid';

describe('Grid', () => {
  describe('constructor', () => {
    it('initializes an 80x80 grid of ground tiles', () => {
      const grid = new Grid(80, 80);
      expect(grid.width).toBe(80);
      expect(grid.height).toBe(80);
      expect(grid.tiles.length).toBe(80);
      for (let y = 0; y < 80; y++) {
        expect(grid.tiles[y].length).toBe(80);
        for (let x = 0; x < 80; x++) {
          expect(grid.tiles[y][x].type).toBe('ground');
          expect(grid.tiles[y][x].x).toBe(x);
          expect(grid.tiles[y][x].y).toBe(y);
        }
      }
    });

    it('initializes a 3x3 grid with 9 ground tiles', () => {
      const grid = new Grid(3, 3);
      let count = 0;
      for (const row of grid.tiles) {
        for (const tile of row) {
          expect(tile.type).toBe('ground');
          count++;
        }
      }
      expect(count).toBe(9);
    });
  });

  describe('getTile', () => {
    const grid = new Grid(80, 80);

    it('returns a ground tile at (0, 0)', () => {
      const tile = grid.getTile(0, 0);
      expect(tile).not.toBeNull();
      expect(tile!.type).toBe('ground');
      expect(tile!.x).toBe(0);
      expect(tile!.y).toBe(0);
    });

    it.each([
      ['(-1, 0)', -1, 0],
      ['(0, -1)', 0, -1],
      ['(80, 0)', 80, 0],
      ['(0, 80)', 0, 80],
      ['(-1, -1)', -1, -1],
      ['(80, 80)', 80, 80],
    ])('returns null when out of bounds %s', (_label, x, y) => {
      expect(grid.getTile(x, y)).toBeNull();
    });
  });

  describe('setTile', () => {
    it('mutates the tile in place and is reflected by getTile', () => {
      const grid = new Grid(80, 80);
      grid.setTile(5, 5, 'road');
      const tile = grid.getTile(5, 5);
      expect(tile).not.toBeNull();
      expect(tile!.type).toBe('road');
    });

    it('is a no-op when out of bounds (no throw)', () => {
      const grid = new Grid(80, 80);
      expect(() => grid.setTile(-1, 0, 'road')).not.toThrow();
      expect(() => grid.setTile(0, 80, 'road')).not.toThrow();
      // Grid unchanged.
      expect(grid.getTile(0, 0)!.type).toBe('ground');
    });
  });

  describe('inBounds', () => {
    const grid = new Grid(80, 80);

    it('returns true for the full valid range (0,0)..(79,79)', () => {
      expect(grid.inBounds(0, 0)).toBe(true);
      expect(grid.inBounds(79, 79)).toBe(true);
      expect(grid.inBounds(40, 40)).toBe(true);
    });

    it.each([
      ['(-1, 0)', -1, 0],
      ['(0, -1)', 0, -1],
      ['(80, 0)', 80, 0],
      ['(0, 80)', 0, 80],
      ['(-1, -1)', -1, -1],
      ['(80, 80)', 80, 80],
    ])('returns false for out-of-bounds %s', (_label, x, y) => {
      expect(grid.inBounds(x, y)).toBe(false);
    });
  });

  describe('neighbors (cardinal)', () => {
    it('returns 4 neighbors in N,E,S,W order for an interior tile', () => {
      const grid = new Grid(80, 80);
      const ns = grid.neighbors(40, 40);
      expect(ns).toHaveLength(4);
      // N, E, S, W
      expect(ns[0]).toMatchObject({ x: 40, y: 39 });
      expect(ns[1]).toMatchObject({ x: 41, y: 40 });
      expect(ns[2]).toMatchObject({ x: 40, y: 41 });
      expect(ns[3]).toMatchObject({ x: 39, y: 40 });
    });

    it('returns 2 neighbors for the (0,0) corner', () => {
      const grid = new Grid(80, 80);
      const ns = grid.neighbors(0, 0);
      expect(ns).toHaveLength(2);
      // E, S
      expect(ns[0]).toMatchObject({ x: 1, y: 0 });
      expect(ns[1]).toMatchObject({ x: 0, y: 1 });
    });

    it('returns 3 neighbors for a left-edge tile', () => {
      const grid = new Grid(80, 80);
      const ns = grid.neighbors(0, 40);
      expect(ns).toHaveLength(3);
    });

    it('returns 2 neighbors for the (79,79) corner', () => {
      const grid = new Grid(80, 80);
      const ns = grid.neighbors(79, 79);
      expect(ns).toHaveLength(2);
      // N, W
      expect(ns[0]).toMatchObject({ x: 79, y: 78 });
      expect(ns[1]).toMatchObject({ x: 78, y: 79 });
    });
  });

  describe('neighbors (diagonal)', () => {
    it('returns 8 neighbors including all diagonals for an interior tile', () => {
      const grid = new Grid(80, 80);
      const ns = grid.neighbors(40, 40, true);
      expect(ns).toHaveLength(8);
      // N, NE, E, SE, S, SW, W, NW
      expect(ns[0]).toMatchObject({ x: 40, y: 39 });
      expect(ns[1]).toMatchObject({ x: 41, y: 39 });
      expect(ns[2]).toMatchObject({ x: 41, y: 40 });
      expect(ns[3]).toMatchObject({ x: 41, y: 41 });
      expect(ns[4]).toMatchObject({ x: 40, y: 41 });
      expect(ns[5]).toMatchObject({ x: 39, y: 41 });
      expect(ns[6]).toMatchObject({ x: 39, y: 40 });
      expect(ns[7]).toMatchObject({ x: 39, y: 39 });
    });

    it('returns 3 neighbors for the (0,0) corner', () => {
      const grid = new Grid(80, 80);
      const ns = grid.neighbors(0, 0, true);
      expect(ns).toHaveLength(3);
      // E, SE, S
      expect(ns[0]).toMatchObject({ x: 1, y: 0 });
      expect(ns[1]).toMatchObject({ x: 1, y: 1 });
      expect(ns[2]).toMatchObject({ x: 0, y: 1 });
    });
  });

  describe('index helper round-trip', () => {
    it('getTile/setTile resolve to y*width+x for a 5x5 grid', () => {
      const grid = new Grid(5, 5);
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          const expectedIndex = y * 5 + x;
          // setTile uses index() internally; tag each tile uniquely.
          grid.setTile(x, y, 'road');
          const tile = grid.getTile(x, y);
          expect(tile).not.toBeNull();
          expect(tile!.type).toBe('road');
          // Verify the flat index maps back to the same (x, y).
          const row = Math.floor(expectedIndex / 5);
          const col = expectedIndex % 5;
          expect(grid.tiles[row][col]).toBe(tile);
        }
      }
    });
  });

  describe('barrel re-export', () => {
    it('Grid is importable from the engine barrel', async () => {
      const mod = (await import('@/engine')) as { Grid: typeof Grid };
      expect(mod.Grid).toBe(Grid);
      const g = new mod.Grid(2, 2);
      const t: Tile | null = g.getTile(0, 0);
      expect(t).not.toBeNull();
      expect(t!.type).toBe('ground');
    });
  });
});
