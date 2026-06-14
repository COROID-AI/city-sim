/**
 * Building placement: fills each non-park zone with non-overlapping
 * building footprints chosen from a per-zone catalog. The catalog
 * is now sourced from `@/constants/building-types` (the canonical
 * `BUILDING_DEFS` + `RESIDENTIAL_DEF`) so the ids registered with
 * the world always match what the renderer / economy system expects.
 *
 * The placer respects:
 *  - World bounds (via `World.addBuilding`).
 *  - Non-overlap (via `World.addBuilding`).
 *  - Per-zone catalog (residential gets houses, commercial gets shops, …).
 *
 * Park zones get no buildings — the spec mandates that.
 */

import { World } from '@/engine/World';
import type { Building, BuildingDef, TileCoord } from '@/engine/types';
import { BUILDING_DEFS, RESIDENTIAL_DEF } from '@/constants/building-types';
import type { NameGenerator } from './NameGenerator';
import type { Rng } from './random';
import type { Zone, ZoneKind } from './zones';

/** Per-zone building catalog. Keys are `ZoneKind`s. */
const ZONE_CATALOG: Partial<Record<ZoneKind, BuildingDef>> = {
  residential: RESIDENTIAL_DEF,
  commercial:
    BUILDING_DEFS.find((d) => d.type === 'shop') ?? BUILDING_DEFS[0]!,
  industrial:
    BUILDING_DEFS.find((d) => d.type === 'factory') ?? BUILDING_DEFS[0]!,
  entertainment:
    BUILDING_DEFS.find((d) => d.type === 'restaurant') ?? BUILDING_DEFS[0]!,
};

export interface BuildingPlacerOptions {
  /** Density factor 0..1; higher = more buildings. */
  readonly density?: number;
  /** Road border width reserved inside each zone. */
  readonly roadWidth?: number;
  /** Minimum in-zone margin to skip when placing footprints. */
  readonly inset?: number;
}

const DEFAULT_DENSITY = 0.85;
const DEFAULT_ROAD_WIDTH = 2;
const DEFAULT_INSET = 1;

export class BuildingPlacer {
  private nextId = 0;

  constructor(
    private readonly world: World,
    private readonly rng: Rng,
    private readonly names: NameGenerator,
  ) {}

  /**
   * Place buildings in every non-park zone. Returns the list of buildings
   * that were successfully added (i.e. the world accepted them).
   */
  placeInZones(zones: readonly Zone[], options: BuildingPlacerOptions = {}): Building[] {
    const density = clamp01(options.density ?? DEFAULT_DENSITY);
    const roadWidth = options.roadWidth ?? DEFAULT_ROAD_WIDTH;
    const inset = options.inset ?? DEFAULT_INSET;
    const placed: Building[] = [];

    for (const zone of zones) {
      if (zone.kind === 'park') continue;
      const def = ZONE_CATALOG[zone.kind];
      if (!def) continue;
      this.world.registerBuildingDef(def);
      placed.push(...this.fillZone(zone, def, density, roadWidth, inset));
    }
    return placed;
  }

  private fillZone(
    zone: Zone,
    def: BuildingDef,
    density: number,
    roadWidth: number,
    inset: number,
  ): Building[] {
    const margin = roadWidth + inset;
    const x0 = zone.origin.x + margin;
    const y0 = zone.origin.y + margin;
    const x1 = zone.end.x - margin;
    const y1 = zone.end.y - margin;

    if (x1 < x0 || y1 < y0) return [];
    const availW = x1 - x0 + 1;
    const availH = y1 - y0 + 1;
    if (availW < def.size.width || availH < def.size.height) return [];

    // Step the grid by the footprint size so we never overlap ourselves.
    const stepX = def.size.width;
    const stepY = def.size.height;
    const cols = Math.floor(availW / stepX);
    const rows = Math.floor(availH / stepY);
    if (cols <= 0 || rows <= 0) return [];

    const cellSlots: { x: number; y: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const slotX = x0 + c * stepX;
        const slotY = y0 + r * stepY;
        // Skip a slot on the basis of density; uses the rng so it stays
        // deterministic for a given seed.
        if (this.rng.next() > density) continue;
        cellSlots.push({ x: slotX, y: slotY });
      }
    }

    // Shuffle so the order of placement varies between seeds.
    const slots = this.rng.shuffle(cellSlots);
    const placed: Building[] = [];
    for (const slot of slots) {
      const building = this.tryPlace(slot, def, zone);
      if (building) placed.push(building);
    }
    return placed;
  }

  private tryPlace(
    origin: { x: number; y: number },
    def: BuildingDef,
    zone: Zone,
  ): Building | null {
    const coord: TileCoord = { x: origin.x, y: origin.y };
    if (!this.world.inBounds(coord)) return null;
    const id = this.makeId(zone.kind);
    const building: Building = {
      id,
      defId: def.id,
      origin: coord,
      size: { ...def.size },
      employees: [],
      treasury: 0,
    };
    const ok = this.world.addBuilding(building);
    return ok ? building : null;
  }

  private makeId(zone: ZoneKind): string {
    this.nextId += 1;
    return `b-${zone}-${this.nextId.toString(36)}`;
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return DEFAULT_DENSITY;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
