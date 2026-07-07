import { createRng, type Rng } from './rng';

/**
 * Core simulation world layout.
 *
 * The world is a 2D tile grid of {@link GRID_WIDTH} x {@link GRID_HEIGHT} cells.
 * Each cell holds a {@link CellKind} describing the terrain at that location.
 * Buildings, roads, and sidewalks are materialized on the grid so that other
 * systems (rendering, pathfinding, spawning) can query them in O(1).
 */

/** Width of the world grid in tiles. */
export const GRID_WIDTH = 64;
/** Height of the world grid in tiles. */
export const GRID_HEIGHT = 64;

/** Kind of terrain a single grid cell can hold. */
export enum CellKind {
  /** Empty, buildable / walkable space. */
  Empty = 0,
  /** A road tile — vehicles travel here. */
  Road = 1,
  /** A sidewalk tile adjacent to roads — pedestrians walk here. */
  Sidewalk = 2,
  /** A building footprint tile. */
  Building = 3,
}

/** A 2D integer coordinate into the world grid. */
export interface Cell {
  x: number;
  y: number;
}

/** An axis-aligned rectangle in grid coordinates (inclusive bounds). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The kind of a building (drives later gameplay + visuals). */
export enum BuildingKind {
  Residential = 'residential',
  Commercial = 'commercial',
  Office = 'office',
  Industrial = 'industrial',
}

/** A materialized building occupying a {@link Rect} on the grid. */
export interface Building {
  rect: Rect;
  kind: BuildingKind;
}

/** A materialized road segment along a row or column. */
export interface RoadSegment {
  rect: Rect;
}

/** The complete, queryable world layout. */
export interface World {
  /** Width of the grid in tiles. */
  width: number;
  /** Height of the grid in tiles. */
  height: number;
  /** Flattened cell grid, row-major: index = y * width + x. */
  cells: CellKind[];
  /** All materialized buildings. */
  buildings: Building[];
  /** All materialized road segments. */
  roads: RoadSegment[];
}

const DIRECTIONS: ReadonlyArray<Cell> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** Create an empty grid filled with {@link CellKind.Empty}. */
export function createGrid(width: number, height: number): CellKind[] {
  return new Array<CellKind>(width * height).fill(CellKind.Empty);
}

/** Read the cell kind at a coordinate. Out-of-bounds reads return Empty. */
export function cellAt(world: World, x: number, y: number): CellKind {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) {
    return CellKind.Empty;
  }
  return world.cells[y * world.width + x];
}

/**
 * Place a rectangular region of cells of the given kind onto the grid.
 * Existing road tiles are preserved (roads take precedence) unless the kind
 * being placed is itself a road.
 *
 * @returns true if any cell was changed.
 */
export function placeRect(world: World, rect: Rect, kind: CellKind): boolean {
  let changed = false;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const idx = y * world.width + x;
      const current = world.cells[idx];
      if (current === kind) continue;
      // Roads have priority and are never overwritten by non-road placement.
      if (current === CellKind.Road && kind !== CellKind.Road) continue;
      world.cells[idx] = kind;
      changed = true;
    }
  }
  return changed;
}

/**
 * Place a building footprint onto the grid and register it in the world's
 * building list. Surrounding non-road, non-building tiles are paved as
 * sidewalk so pedestrians always have walkable space next to a building.
 */
export function placeBuilding(
  world: World,
  rect: Rect,
  kind: BuildingKind,
): void {
  placeRect(world, rect, CellKind.Building);
  // Carve a 1-tile sidewalk ring around the footprint.
  const ring: Rect = {
    x: rect.x - 1,
    y: rect.y - 1,
    width: rect.width + 2,
    height: rect.height + 2,
  };
  placeRect(world, ring, CellKind.Sidewalk);
  // Re-stamp the building core so the sidewalk ring doesn't overwrite it.
  placeRect(world, rect, CellKind.Building);
  world.buildings.push({ rect, kind });
}

/** Returns true when the given cell kind is a road. */
export function isRoad(kind: CellKind): boolean {
  return kind === CellKind.Road;
}

/** Whether a cell coordinate is walkable by pedestrians. */
export function isWalkable(kind: CellKind): boolean {
  return (
    kind === CellKind.Sidewalk || kind === CellKind.Empty || kind === CellKind.Road
  );
}

/**
 * Returns the 4-neighbourhood (von Neumann) of a cell that lies within the
 * grid bounds. The returned cells are guaranteed to be valid coordinates but
 * the caller decides which neighbours are usable (road, walkable, etc.).
 */
export function neighbors(world: World, cell: Cell): Cell[] {
  const result: Cell[] = [];
  for (const dir of DIRECTIONS) {
    const nx = cell.x + dir.x;
    const ny = cell.y + dir.y;
    if (nx >= 0 && ny >= 0 && nx < world.width && ny < world.height) {
      result.push({ x: nx, y: ny });
    }
  }
  return result;
}

/** All grid coordinates that hold a road tile. */
export function roadCells(world: World): Cell[] {
  const result: Cell[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (world.cells[y * world.width + x] === CellKind.Road) {
        result.push({ x, y });
      }
    }
  }
  return result;
}

/**
 * Check that every road tile is reachable from every other road tile — i.e.
 * the road network is a single connected component spanning the grid.
 *
 * Uses a flood-fill (BFS) over road cells from the first road tile found.
 */
export function isRoadNetworkConnected(world: World): boolean {
  const start = roadCells(world);
  if (start.length === 0) return false;
  const visited = new Uint8Array(world.width * world.height);
  const queue: Cell[] = [start[0]];
  visited[start[0].y * world.width + start[0].x] = 1;
  let visitedCount = 1;

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const n of neighbors(world, current)) {
      const idx = n.y * world.width + n.x;
      if (visited[idx]) continue;
      if (world.cells[idx] !== CellKind.Road) continue;
      visited[idx] = 1;
      visitedCount += 1;
      queue.push(n);
    }
  }

  return visitedCount === start.length;
}

/**
 * Build a complete, deterministic world layout from a seed.
 *
 * The layout strategy:
 *  1. Lay a grid of road "blocks" — a set of vertical and horizontal road
 *     segments dividing the map into city blocks.
 *  2. Inside each block, place 1-3 buildings of varying size and kind.
 *
 * Guarantees produced by this generator (see acceptance criteria):
 *  - >= 20 building rects.
 *  - >= 10 road segments.
 *  - A single connected road network spanning the grid.
 *
 * @param seedOrRng - Either a numeric seed or an existing {@link Rng}.
 */
export function createWorld(seedOrRng: number | Rng): World {
  const rng: Rng =
    typeof seedOrRng === 'number' ? createRng(seedOrRng) : seedOrRng;

  const width = GRID_WIDTH;
  const height = GRID_HEIGHT;
  const world: World = {
    width,
    height,
    cells: createGrid(width, height),
    buildings: [],
    roads: [],
  };

  // --- 1. Road grid -------------------------------------------------------
  // Divide the map into blocks of roughly BLOCK_SIZE tiles. Roads run along
  // the block boundaries both horizontally and vertically, guaranteeing
  // connectivity and a spanning road network.
  const BLOCK_SIZE = 10;
  const ROAD_WIDTH = 2;

  const positions: number[] = [];
  for (let p = BLOCK_SIZE; p < width; p += BLOCK_SIZE) {
    positions.push(p);
  }

  // Vertical roads (columns).
  for (const x of positions) {
    const rect: Rect = { x, y: 0, width: ROAD_WIDTH, height };
    placeRect(world, rect, CellKind.Road);
    world.roads.push({ rect });
  }
  // Horizontal roads (rows).
  for (const y of positions) {
    const rect: Rect = { x: 0, y, width, height: ROAD_WIDTH };
    placeRect(world, rect, CellKind.Road);
    world.roads.push({ rect });
  }

  // --- 2. Buildings -------------------------------------------------------
  const kinds = [
    BuildingKind.Residential,
    BuildingKind.Commercial,
    BuildingKind.Office,
    BuildingKind.Industrial,
  ];

  // Walk every block interior and drop buildings, leaving a sidewalk margin.
  for (let by = 0; by < positions.length; by++) {
    const top = by === 0 ? ROAD_WIDTH : positions[by - 1] + ROAD_WIDTH;
    const bottom = positions[by];
    for (let bx = 0; bx < positions.length; bx++) {
      const left = bx === 0 ? ROAD_WIDTH : positions[bx - 1] + ROAD_WIDTH;
      const right = positions[bx];
      const blockWidth = right - left;
      const blockHeight = bottom - top;
      if (blockWidth < 4 || blockHeight < 4) continue;

      const buildingCount = rng.intRange(1, 3);
      for (let b = 0; b < buildingCount; b++) {
        const bw = rng.intRange(3, Math.max(4, Math.min(blockWidth - 2, 8)));
        const bh = rng.intRange(3, Math.max(4, Math.min(blockHeight - 2, 8)));
        const maxOffX = Math.max(0, blockWidth - bw - 1);
        const maxOffY = Math.max(0, blockHeight - bh - 1);
        const ox = rng.intRange(0, maxOffX);
        const oy = rng.intRange(0, maxOffY);
        const rect: Rect = {
          x: left + ox,
          y: top + oy,
          width: bw,
          height: bh,
        };
        const kind = kinds[rng.intRange(0, kinds.length - 1)];
        placeBuilding(world, rect, kind);
      }
    }
  }

  return world;
}
