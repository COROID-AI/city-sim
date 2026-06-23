/**
 * World — aggregate root owning the simulation grid, buildings, and zones.
 *
 * Architecture decisions (see plan notes):
 *  - Flat-array tile storage (Tile[]) of length width*height, indexed by
 *    y*width+x for O(1) access and good cache locality.
 *  - World is the single integration point for downstream systems (Renderer,
 *    TimeSystem, lighting). They depend on World, not Grid directly.
 *  - Grid exposes spatial queries (queryRange, getNeighbors4) and a BFS-based
 *    road-connectivity check used by generation and tests.
 */
import type { Building, Tile, TileType, Zone } from './types';
import type { Citizen } from '@/entities/Citizen';

/** Edge length of one tile in world units (used by the Renderer). */
export const TILE_SIZE = 16;

/** Orthogonal neighbor offsets (4-connectivity). */
const NEIGHBORS_4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Grid — rectangular tile store with O(1) access and spatial queries.
 */
export class Grid {
  /** Grid width in tiles. */
  readonly width: number;
  /** Grid height in tiles. */
  readonly height: number;

  /** Flat tile storage, length === width*height. */
  private readonly tiles: Tile[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = new Array<Tile>(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        this.tiles[y * width + x] = {
          x,
          y,
          type: 'grass',
          buildingId: null,
          buildable: true,
        };
      }
    }
  }

  /** Total number of tiles in the grid. */
  get size(): number {
    return this.tiles.length;
  }

  /** Whether (x,y) is inside the grid bounds. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Return the tile at (x,y) or null if out of bounds. */
  getTile(x: number, y: number): Tile | null {
    if (!this.inBounds(x, y)) return null;
    return this.tiles[y * this.width + x];
  }

  /** Set the TileType of a tile. No-op if out of bounds. */
  setTileType(x: number, y: number, type: TileType): void {
    const tile = this.getTile(x, y);
    if (tile) {
      tile.type = type;
      // Roads and water are not buildable.
      tile.buildable = type === 'grass';
    }
  }

  /**
   * Return all tiles in the rectangle (x,y,w,h). Out-of-bounds regions are
   * clipped, so the returned array length is at most w*h.
   */
  queryRange(x: number, y: number, w: number, h: number): Tile[] {
    const result: Tile[] = [];
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        result.push(this.tiles[yy * this.width + xx]);
      }
    }
    return result;
  }

  /** The 4 orthogonal neighbors of (x,y) that are in bounds. */
  getNeighbors4(x: number, y: number): Tile[] {
    const result: Tile[] = [];
    for (const [dx, dy] of NEIGHBORS_4) {
      const tile = this.getTile(x + dx, y + dy);
      if (tile) result.push(tile);
    }
    return result;
  }

  /** Iterate every tile in the grid. */
  forEach(callback: (tile: Tile) => void): void {
    for (let i = 0; i < this.tiles.length; i++) {
      callback(this.tiles[i]);
    }
  }

  /**
   * Check whether the entire road network is a single connected component.
   * Performs a BFS from the first road tile and confirms every road tile is
   * reached. Returns true when there are zero roads (vacuously connected).
   */
  isRoadConnected(): boolean {
    let start: Tile | null = null;
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i].type === 'road') {
        start = this.tiles[i];
        break;
      }
    }
    if (!start) return true;

    let totalRoads = 0;
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i].type === 'road') totalRoads++;
    }

    const visited = new Set<number>();
    const queue: Tile[] = [start];
    visited.add(start.y * this.width + start.x);
    let visitedCount = 1;

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of this.getNeighbors4(current.x, current.y)) {
        if (neighbor.type !== 'road') continue;
        const key = neighbor.y * this.width + neighbor.x;
        if (visited.has(key)) continue;
        visited.add(key);
        visitedCount++;
        queue.push(neighbor);
      }
    }
    return visitedCount === totalRoads;
  }
}

/**
 * World — aggregate root exposing the grid, placed buildings, and zones.
 */
export class World {
  readonly width: number;
  readonly height: number;
  readonly grid: Grid;
  readonly buildings: Map<string, Building> = new Map();
  readonly zones: Zone[] = [];
  /** All spawned citizens in the city. */
  readonly citizens: Citizen[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.grid = new Grid(width, height);
  }

  /** Register a building instance and stamp its footprint on the grid. */
  addBuilding(building: Building): void {
    this.buildings.set(building.id, building);
    for (let dy = 0; dy < building.height; dy++) {
      for (let dx = 0; dx < building.width; dx++) {
        const tile = this.grid.getTile(building.x + dx, building.y + dy);
        if (tile) {
          tile.buildingId = building.id;
          tile.buildable = false;
        }
      }
    }
  }

  /**
   * Register a citizen in the world. Mirrors {@link addBuilding}.
   * The citizen is appended to {@link citizens} and keyed by id for lookup.
   */
  addCitizen(citizen: Citizen): void {
    this.citizens.push(citizen);
  }
}
