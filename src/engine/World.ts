import {
  DEFAULT_GRID_HEIGHT,
  DEFAULT_GRID_WIDTH,
  MAIN_ROAD_INTERVAL,
  MAIN_ROAD_WIDTH,
  SECONDARY_ROAD_INTERVAL,
  SECONDARY_ROAD_WIDTH,
} from '@/constants';
import {
  Building,
  Citizen,
  StreetLight,
  TileType,
  Vehicle,
  ZoneBounds,
  ZoneType,
} from './types';

export class Grid {
  public readonly width: number;
  public readonly height: number;

  private readonly tiles: Uint8Array;

  constructor(width: number = DEFAULT_GRID_WIDTH, height: number = DEFAULT_GRID_HEIGHT) {
    if (!Number.isInteger(width) || width <= 0) throw new Error('Grid width must be a positive integer');
    if (!Number.isInteger(height) || height <= 0) throw new Error('Grid height must be a positive integer');

    this.width = width;
    this.height = height;
    this.tiles = new Uint8Array(width * height);
  }

  private indexOf(x: number, y: number): number {
    return y * this.width + x;
  }

  public isInBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  public getTile(x: number, y: number): number | undefined {
    if (!this.isInBounds(x, y)) return undefined;
    return this.tiles[this.indexOf(x, y)] ?? undefined;
  }

  public setTile(x: number, y: number, tile: number): void {
    if (!this.isInBounds(x, y)) return;
    this.tiles[this.indexOf(x, y)] = tile;
  }

  /**
   * Returns all tiles in the half-open rectangle [x, x+w) × [y, y+h).
   */
  public getTilesInRect(x: number, y: number, w: number, h: number): Array<{ x: number; y: number; value: number }> {
    if (!Number.isInteger(w) || w < 0) throw new Error('w must be a non-negative integer');
    if (!Number.isInteger(h) || h < 0) throw new Error('h must be a non-negative integer');

    if (w === 0 || h === 0) return [];

    const result: Array<{ x: number; y: number; value: number }> = [];
    const xEnd = x + w;
    const yEnd = y + h;

    for (let yy = y; yy < yEnd; yy += 1) {
      for (let xx = x; xx < xEnd; xx += 1) {
        if (!this.isInBounds(xx, yy)) continue;
        const idx = this.indexOf(xx, yy);
        result.push({ x: xx, y: yy, value: this.tiles[idx]! });
      }
    }

    return result;
  }

  private isRoadTile(value: number): boolean {
    return value === TileType.Road || value === (TileType.Road | TileType.StreetLight);
  }

  /**
   * Finds the nearest road tile (Manhattan distance) from a given point.
   */
  public findNearestRoad(x: number, y: number): { x: number; y: number } | undefined {
    if (!this.isInBounds(x, y)) return undefined;

    // Multi-source BFS from all road tiles would be heavier; Manhattan
    // expanding ring is sufficient for a small 80×80 grid.
    const maxDist = this.width + this.height;

    for (let d = 0; d <= maxDist; d += 1) {
      const candidates: Array<{ x: number; y: number }> = [];

      // x+y parity doesn't matter; iterate rectangle edges of the diamond.
      for (let dx = 0; dx <= d; dx += 1) {
        const dy = d - dx;
        candidates.push({ x: x + dx, y: y + dy });
        candidates.push({ x: x - dx, y: y + dy });
        candidates.push({ x: x + dx, y: y - dy });
        candidates.push({ x: x - dx, y: y - dy });
      }

      for (const c of candidates) {
        if (!this.isInBounds(c.x, c.y)) continue;
        const v = this.tiles[this.indexOf(c.x, c.y)]!;
        if (v === TileType.Road || v === (TileType.Road | TileType.StreetLight)) {
          return c;
        }
      }
    }

    return undefined;
  }

  /**
   * Returns 4-neighborhood neighbors within bounds.
   */
  public getNeighbors(x: number, y: number): Array<{ x: number; y: number; value: number }> {
    const deltas = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ] as const;

    const result: Array<{ x: number; y: number; value: number }> = [];
    for (const { dx, dy } of deltas) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.isInBounds(nx, ny)) continue;
      const v = this.tiles[this.indexOf(nx, ny)]!;
      result.push({ x: nx, y: ny, value: v });
    }

    return result;
  }
}

export type World = {
  grid: Grid;
  zones: Record<ZoneType, ZoneBounds>;
  buildings: Building[];
  streetLights: StreetLight[];
  citizens: Citizen[];
  vehicles: Vehicle[];
};

export function createWorld(gridWidth: number, gridHeight: number, zones: Record<ZoneType, ZoneBounds>): World {
  return {
    grid: new Grid(gridWidth, gridHeight),
    zones,
    buildings: [],
    streetLights: [],
    citizens: [],
    vehicles: [],
  };
}

export function isMainRoadIndex(i: number): boolean {
  return i % MAIN_ROAD_INTERVAL === 0;
}

export function isSecondaryRoadIndex(i: number): boolean {
  return i % SECONDARY_ROAD_INTERVAL === 0 && i % MAIN_ROAD_INTERVAL !== 0;
}

export function applyRoadToGrid(grid: Grid, roadType: 'main' | 'secondary', axis: 'x' | 'y', idx: number): void {
  const width = axis === 'x' ? MAIN_ROAD_WIDTH : MAIN_ROAD_WIDTH;
  const secondaryWidth = SECONDARY_ROAD_WIDTH;
  const w = roadType === 'main' ? width : secondaryWidth;

  if (axis === 'x') {
    // vertical road at x=idx..idx+w-1
    for (let dx = 0; dx < w; dx += 1) {
      const xx = idx + dx;
      for (let y = 0; y < grid.height; y += 1) {
        if (!grid.isInBounds(xx, y)) continue;
        grid.setTile(xx, y, TileType.Road);
      }
    }
  } else {
    // horizontal road at y=idx..idx+w-1
    for (let dy = 0; dy < w; dy += 1) {
      const yy = idx + dy;
      for (let x = 0; x < grid.width; x += 1) {
        if (!grid.isInBounds(x, yy)) continue;
        grid.setTile(x, yy, TileType.Road);
      }
    }
  }
}
