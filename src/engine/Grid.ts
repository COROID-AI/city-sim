/**
 * In-memory tile world backing store for the city simulation.
 *
 * Provides spatial queries (getTile, setTile, neighbors, inBounds) used by
 * pathfinding, rendering, and city generation. Storage is a row-major
 * `Tile[][]` (array-of-arrays) indexed as `tiles[y][x]`.
 *
 * Spec 3.1 / 6.1: 80x80 tile grid, each tile 16px (TILE_SIZE).
 */

/**
 * Tile type union.
 *
 * Extensible: downstream tasks (CityGenerator, BuildingPlacer) add new kinds
 * (e.g. 'water', 'building') by appending to this union.
 */
export type TileType =
  | 'ground'
  | 'road'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'entertainment'
  | 'park';

/** A single tile in the grid. Carries its own (x,y) coordinates. */
export interface Tile {
  /** X coordinate (column), 0..width-1. */
  x: number;
  /** Y coordinate (row), 0..height-1. */
  y: number;
  /** Semantic type of this tile. */
  type: TileType;
}

/**
 * Row-major grid of tiles.
 *
 * Coordinates use (x, y) where x is the column and y is the row. The internal
 * `index(x, y)` helper converts to a flat `y * width + x` offset, exercised by
 * both `getTile` and `setTile`.
 */
export class Grid {
  /** Grid width in tiles (number of columns). */
  readonly width: number;
  /** Grid height in tiles (number of rows). */
  readonly height: number;

  /** Row-major tile storage: `tiles[y][x]`. */
  readonly tiles: Tile[][];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    const tiles: Tile[][] = [];
    for (let y = 0; y < height; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < width; x++) {
        row.push({ x, y, type: 'ground' as TileType });
      }
      tiles.push(row);
    }
    this.tiles = tiles;
  }

  /**
 * Convert (x, y) to a flat row-major index: `y * width + x`.
 *
 * Private helper centralizing all coordinate→index conversion so getTile and
 * setTile stay consistent (avoids row/column-major mixups).
 */
  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  /**
 * Returns true when (x, y) is inside the grid bounds.
 *
 * Handles negatives and values >= width/height.
 */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /**
 * Get the tile at (x, y), or `null` when out of bounds.
 */
  getTile(x: number, y: number): Tile | null {
    if (!this.inBounds(x, y)) return null;
    // index() is exercised here (and in setTile) per acceptance criteria.
    const idx = this.index(x, y);
    const row = Math.floor(idx / this.width);
    const col = idx % this.width;
    return this.tiles[row][col];
  }

  /**
 * Mutate the tile at (x, y) in place. Out-of-bounds writes are a silent
 * no-op (matching getTile's null-return contract).
 */
  setTile(x: number, y: number, type: TileType): void {
    if (!this.inBounds(x, y)) return;
    const idx = this.index(x, y);
    const row = Math.floor(idx / this.width);
    const col = idx % this.width;
    this.tiles[row][col].type = type;
  }

  /**
 * Return in-bounds neighbors of (x, y) in deterministic order.
 *
 * Cardinal order: N, E, S, W.
 * Diagonal order (when `diagonal === true`): N, NE, E, SE, S, SW, W, NW.
 *
 * Out-of-bounds neighbors are omitted; the returned array length varies from
 * 0 (empty grid) up to 4 (cardinal) or 8 (diagonal) for interior tiles.
   */
  neighbors(x: number, y: number, diagonal = false): Tile[] {
    const cardinal: ReadonlyArray<readonly [number, number]> = [
      [0, -1], // N
      [1, 0], // E
      [0, 1], // S
      [-1, 0], // W
    ];

    const offsets = diagonal
      ? [
          [0, -1], // N
          [1, -1], // NE
          [1, 0], // E
          [1, 1], // SE
          [0, 1], // S
          [-1, 1], // SW
          [-1, 0], // W
          [-1, -1], // NW
        ]
      : cardinal;

    const result: Tile[] = [];
    for (const [dx, dy] of offsets) {
      const tile = this.getTile(x + dx, y + dy);
      if (tile !== null) {
        result.push(tile);
      }
    }
    return result;
  }
}
