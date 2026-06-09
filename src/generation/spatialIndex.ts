import type { Building, Cell, GeneratedCity, Rect, ZoneId } from './types';

/**
 * A simple grid-aligned spatial index keyed by integer cell coordinates.
 *
 * Footprint-occupancy index:
 *   - queryCell(x, y): returns building ids whose footprint contains (x, y).
 *   - queryRect(rect): returns building ids whose footprint intersects rect.
 *   - queryZone(zone): returns all building ids in a zone.
 *
 * The index is built from a GeneratedCity and is read-only afterwards.
 * All coordinates are inclusive cell coordinates matching GeneratedCity's
 * coordinate convention.
 */
export class SpatialIndex {
  private readonly width: number;
  private readonly height: number;
  /** Per-cell list of building ids covering that cell. */
  private readonly occupancy: number[][];
  private readonly buildings: readonly Building[];

  constructor(city: GeneratedCity) {
    this.width = city.width;
    this.height = city.height;
    this.buildings = city.buildings;
    const size = city.width * city.height;
    this.occupancy = new Array<number[]>(size);
    for (let i = 0; i < size; i++) {
      this.occupancy[i] = [];
    }
    for (let bi = 0; bi < this.buildings.length; bi++) {
      const b = this.buildings[bi];
      if (b === undefined) continue;
      const f = b.footprint;
      for (let yy = f.y; yy < f.y + f.height; yy++) {
        for (let xx = f.x; xx < f.x + f.width; xx++) {
          if (xx < 0 || yy < 0 || xx >= this.width || yy >= this.height) continue;
          const idx = yy * this.width + xx;
          const bucket = this.occupancy[idx];
          if (bucket !== undefined) bucket.push(bi);
        }
      }
    }
  }

  /** Whether the given cell is within the indexed grid. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Building ids whose footprint contains the cell, or [] if none. */
  queryCell(x: number, y: number): readonly number[] {
    if (!this.inBounds(x, y)) return [];
    const idx = y * this.width + x;
    return this.occupancy[idx] ?? [];
  }

  /** Building ids whose footprint intersects the given rect (inclusive). */
  queryRect(rect: Rect): readonly number[] {
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(this.width - 1, rect.x + rect.width - 1);
    const y1 = Math.min(this.height - 1, rect.y + rect.height - 1);
    if (x0 > x1 || y0 > y1) return [];
    const seen = new Set<number>();
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const idx = yy * this.width + xx;
        const bucket = this.occupancy[idx];
        if (bucket === undefined) continue;
        for (const bi of bucket) {
          seen.add(bi);
        }
      }
    }
    return Array.from(seen);
  }

  /** Building ids whose zone matches the given zone. */
  queryZone(zone: ZoneId): readonly number[] {
    const out: number[] = [];
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      if (b !== undefined && b.zone === zone) out.push(i);
    }
    return out;
  }

  /** All buildings, as stored. */
  allBuildings(): readonly Building[] {
    return this.buildings;
  }

  /** Convert a cell to a stable string key ("x,y"). */
  static cellKey(c: Cell): string {
    return `${c.x},${c.y}`;
  }
}
