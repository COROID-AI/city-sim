import type { World } from './World';
import type { ZoneType } from './types';

export type CameraTransform = {
  x: number;
  y: number;
  zoom: number;
};

const COLORS = {
  ground: '#e8e0d5',
  road: '#4a4a4a',
  roadCenter: '#ffffff',
  residential: '#7cb342',
  commercial: '#42a5f5',
  industrial: '#8d6e63',
  entertainment: '#ab47bc',
  park: '#a5d6a7',
} as const satisfies Record<string, string>;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cellSize: number;

  constructor(ctx: CanvasRenderingContext2D, cellSize = 10) {
    if (cellSize <= 0 || !Number.isFinite(cellSize)) {
      throw new Error('cellSize must be a positive finite number');
    }

    this.ctx = ctx;
    this.cellSize = cellSize;
  }

  public render(world: World, camera: CameraTransform = { x: 0, y: 0, zoom: 1 }): void {
    if (!world) throw new Error('world is required');
    const { x, y, zoom } = camera;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) {
      throw new Error('camera must have finite x/y and a positive zoom');
    }

    const ctx = this.ctx;

    // Clear in screen space (outside transformed world).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Apply camera transform around world origin.
    ctx.translate(x, y);
    ctx.scale(zoom, zoom);

    this.drawGround(world);
    this.drawRoads(world);
    this.drawBuildings(world);
  }

  private drawGround(world: World): void {
    const ctx = this.ctx;

    ctx.fillStyle = COLORS.ground;

    // Ground is a simple rectangle covering the grid.
    const widthPx = world.grid.width * this.cellSize;
    const heightPx = world.grid.height * this.cellSize;
    ctx.fillRect(0, 0, widthPx, heightPx);
  }

  private drawRoads(world: World): void {
    const ctx = this.ctx;

    ctx.fillStyle = COLORS.road;

    const drawRoadRect = (x: number, y: number, w: number, h: number): void => {
      ctx.fillRect(x * this.cellSize, y * this.cellSize, w * this.cellSize, h * this.cellSize);
    };

    // Render each road tile as a square. For determinism and simplicity,
    // we use the world.grid tile values.
    for (let y = 0; y < world.grid.height; y += 1) {
      for (let x = 0; x < world.grid.width; x += 1) {
        const value = world.grid.getTile(x, y);
        if (value === undefined) continue;
        if ((value & 2) !== 0) {
          drawRoadRect(x, y, 1, 1);
        }

        // Center line: main roads use width >= 2 (in this project: 2).
        // We draw a 1px vertical/horizontal line inside each 2-tile wide
        // segment. Because we render per-tile, we draw the center line when
        // the tile lies on the computed center column/row for a contiguous
        // segment.
        //
        // For simplicity, we treat any road tile that is adjacent to non-road
        // on its two sides as a boundary and then place the center line at
        // midpoints. This is deterministic for the generated road widths.
        if ((value & 2) !== 0) {
          const leftIsRoad = x > 0 ? ((world.grid.getTile(x - 1, y) ?? 0) & 2) !== 0 : false;
          const rightIsRoad = x + 1 < world.grid.width ? ((world.grid.getTile(x + 1, y) ?? 0) & 2) !== 0 : false;
          const upIsRoad = y > 0 ? ((world.grid.getTile(x, y - 1) ?? 0) & 2) !== 0 : false;
          const downIsRoad = y + 1 < world.grid.height ? ((world.grid.getTile(x, y + 1) ?? 0) & 2) !== 0 : false;

          // If road is vertical (neighbors left/right not roads, up/down are), draw center line
          // in the middle of the 2-tile wide vertical segment.
          if (!leftIsRoad && !rightIsRoad && (upIsRoad || downIsRoad)) {
            // Vertical line at x-? Center of 2-tile segment depends on which tile is being processed.
            // Place the center line using cell center offset: always draw within the tile.
            ctx.fillStyle = COLORS.roadCenter;
            ctx.fillRect(
              x * this.cellSize + this.cellSize * 0.5,
              y * this.cellSize,
              1,
              this.cellSize
            );
            ctx.fillStyle = COLORS.road;
          }

          // If road is horizontal (neighbors up/down not roads, left/right are), draw center line.
          if (!upIsRoad && !downIsRoad && (leftIsRoad || rightIsRoad)) {
            ctx.fillStyle = COLORS.roadCenter;
            ctx.fillRect(
              x * this.cellSize,
              y * this.cellSize + this.cellSize * 0.5,
              this.cellSize,
              1
            );
            ctx.fillStyle = COLORS.road;
          }
        }
      }
    }
  }

  private drawBuildings(world: World): void {
    const buildings = [...world.buildings];

    // Depth sort by Y ascending (lower Y drawn first).
    buildings.sort((a, b) => {
      const dy = a.y - b.y;
      if (dy !== 0) return dy;
      // Deterministic secondary sort.
      const dx = a.x - b.x;
      if (dx !== 0) return dx;
      return a.id.localeCompare(b.id);
    });

    for (const b of buildings) {
      const fill = this.getZoneColor(b.zone);
      this.ctx.fillStyle = fill;
      this.ctx.fillRect(
        b.x * this.cellSize,
        b.y * this.cellSize,
        b.width * this.cellSize,
        b.height * this.cellSize
      );
    }
  }

  private getZoneColor(zone: ZoneType): string {
    switch (zone) {
      case 'residential':
        return COLORS.residential;
      case 'commercial':
        return COLORS.commercial;
      case 'industrial':
        return COLORS.industrial;
      case 'entertainment':
        return COLORS.entertainment;
      case 'park':
        return COLORS.park;
      default: {
        // Exhaustiveness guard.
        const _never: never = zone;
        void _never;
        return COLORS.park;
      }
    }
  }
}
