import type { Building, BuildingDef, Citizen, Tile, TileCoord, Vehicle, WorldBounds } from './types';

/**
 * The simulation world: a 2D tile grid plus a building map and a citizen list.
 *
 * All mutating operations are bounds-checked. Out-of-bounds writes are
 * ignored (returning `false`) rather than throwing, so the simulation can
 * tolerate off-by-one placement bugs from upstream systems without crashing.
 */
export class World {
  readonly bounds: WorldBounds;
  /** Row-major tile grid: `tiles[y * width + x]`. */
  private readonly tiles: Tile[];
  /** Building instances keyed by id, with a spatial index by origin. */
  private readonly buildings = new Map<string, Building>();
  /** Spatial index: origin string `"x,y"` -> building id. */
  private readonly buildingByOrigin = new Map<string, string>();
  /** Citizens keyed by id, insertion-ordered. */
  private readonly citizens = new Map<string, Citizen>();
  /** Vehicles keyed by id, insertion-ordered. */
  private readonly vehicles = new Map<string, Vehicle>();
  /** Owner index: citizen id -> vehicle id. At most one vehicle per citizen. */
  private readonly vehicleByOwner = new Map<string, string>();
  /** Building def catalog keyed by id. */
  private readonly buildingDefs = new Map<string, BuildingDef>();

  constructor(bounds: WorldBounds) {
    if (!Number.isInteger(bounds.width) || bounds.width <= 0) {
      throw new RangeError('World bounds width must be a positive integer');
    }
    if (!Number.isInteger(bounds.height) || bounds.height <= 0) {
      throw new RangeError('World bounds height must be a positive integer');
    }
    this.bounds = { ...bounds };
    this.tiles = new Array<Tile>(bounds.width * bounds.height);
    // Default to plain ground tiles.
    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        this.tiles[y * bounds.width + x] = {
          coord: { x, y },
          kind: 'ground',
          elevation: 0,
        };
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Tiles                                                                  */
  /* ---------------------------------------------------------------------- */

  inBounds(coord: TileCoord): boolean {
    return (
      Number.isInteger(coord.x) &&
      Number.isInteger(coord.y) &&
      coord.x >= 0 &&
      coord.y >= 0 &&
      coord.x < this.bounds.width &&
      coord.y < this.bounds.height
    );
  }

  getTile(coord: TileCoord): Tile | null {
    if (!this.inBounds(coord)) return null;
    return this.tiles[coord.y * this.bounds.width + coord.x] ?? null;
  }

  /**
   * Replace a tile. Returns `false` for out-of-bounds coords (no throw).
   */
  setTile(coord: TileCoord, kind: Tile['kind'], elevation = 0): boolean {
    if (!this.inBounds(coord)) return false;
    this.tiles[coord.y * this.bounds.width + coord.x] = {
      coord: { x: coord.x, y: coord.y },
      kind,
      elevation,
    };
    return true;
  }

  /** Iterate over all tiles. */
  *tiles_(): IterableIterator<Tile> {
    for (const tile of this.tiles) yield tile;
  }

  /* ---------------------------------------------------------------------- */
  /* Buildings                                                              */
  /* ---------------------------------------------------------------------- */

  registerBuildingDef(def: BuildingDef): void {
    this.buildingDefs.set(def.id, def);
  }

  getBuildingDef(id: string): BuildingDef | null {
    return this.buildingDefs.get(id) ?? null;
  }

  addBuilding(building: Building): boolean {
    if (this.buildings.has(building.id)) return false;
    if (!this.inBounds(building.origin)) return false;
    // Footprint must fit entirely within the world.
    if (
      building.origin.x + building.size.width > this.bounds.width ||
      building.origin.y + building.size.height > this.bounds.height
    ) {
      return false;
    }
    // Reject negative/zero footprints up front.
    if (building.size.width <= 0 || building.size.height <= 0) return false;
    // No overlapping footprints: every tile within the new footprint must
    // not already host another building.
    for (let dy = 0; dy < building.size.height; dy++) {
      for (let dx = 0; dx < building.size.width; dx++) {
        const key = this.originKey({
          x: building.origin.x + dx,
          y: building.origin.y + dy,
        });
        if (this.buildingByOrigin.has(key)) return false;
      }
    }
    this.buildings.set(building.id, building);
    // Index every tile in the footprint, not just the origin, so
    // getBuildingAt() and overlap detection work for multi-tile buildings.
    for (let dy = 0; dy < building.size.height; dy++) {
      for (let dx = 0; dx < building.size.width; dx++) {
        this.buildingByOrigin.set(
          this.originKey({
            x: building.origin.x + dx,
            y: building.origin.y + dy,
          }),
          building.id,
        );
      }
    }
    return true;
  }

  removeBuilding(id: string): boolean {
    const b = this.buildings.get(id);
    if (!b) return false;
    this.buildings.delete(id);
    for (let dy = 0; dy < b.size.height; dy++) {
      for (let dx = 0; dx < b.size.width; dx++) {
        this.buildingByOrigin.delete(
          this.originKey({
            x: b.origin.x + dx,
            y: b.origin.y + dy,
          }),
        );
      }
    }
    return true;
  }

  getBuilding(id: string): Building | null {
    return this.buildings.get(id) ?? null;
  }

  getBuildingAt(coord: TileCoord): Building | null {
    if (!this.inBounds(coord)) return null;
    const id = this.buildingByOrigin.get(this.originKey(coord));
    return id ? this.buildings.get(id) ?? null : null;
  }

  *buildings_(): IterableIterator<Building> {
    for (const b of this.buildings.values()) yield b;
  }

  /* ---------------------------------------------------------------------- */
  /* Citizens                                                               */
  /* ---------------------------------------------------------------------- */

  addCitizen(citizen: Citizen): boolean {
    if (this.citizens.has(citizen.id)) return false;
    this.citizens.set(citizen.id, citizen);
    return true;
  }

  removeCitizen(id: string): boolean {
    return this.citizens.delete(id);
  }

  getCitizen(id: string): Citizen | null {
    return this.citizens.get(id) ?? null;
  }

  *citizens_(): IterableIterator<Citizen> {
    for (const c of this.citizens.values()) yield c;
  }

  get citizenCount(): number {
    return this.citizens.size;
  }

  get buildingCount(): number {
    return this.buildings.size;
  }

  /* ---------------------------------------------------------------------- */
  /* Vehicles                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Register a vehicle with the world. Returns `false` if a vehicle with
   * the same id is already registered. If `vehicle.ownerId` is set and
   * a different vehicle is already owned by that citizen, the existing
   * vehicle is NOT silently removed — callers must `removeVehicle` it
   * first (or use `spawnVehicle` which handles the swap).
   */
  addVehicle(vehicle: Vehicle): boolean {
    if (this.vehicles.has(vehicle.id)) return false;
    if (vehicle.ownerId !== null) {
      if (this.vehicleByOwner.has(vehicle.ownerId)) {
        // Same owner is re-registering the same vehicle id? Allow it.
        if (this.vehicleByOwner.get(vehicle.ownerId) === vehicle.id) {
          this.vehicles.set(vehicle.id, vehicle);
          return true;
        }
        return false;
      }
      this.vehicleByOwner.set(vehicle.ownerId, vehicle.id);
    }
    this.vehicles.set(vehicle.id, vehicle);
    return true;
  }

  /**
   * Remove a vehicle by id. The owner index is updated automatically.
   * Returns `false` if the vehicle didn't exist.
   */
  removeVehicle(id: string): boolean {
    const v = this.vehicles.get(id);
    if (!v) return false;
    if (v.ownerId !== null) {
      this.vehicleByOwner.delete(v.ownerId);
    }
    this.vehicles.delete(id);
    return true;
  }

  /** Look up a vehicle by id. */
  getVehicle(id: string): Vehicle | null {
    return this.vehicles.get(id) ?? null;
  }

  /**
   * Look up a vehicle by its `ownerId`. Returns `null` if the citizen
   * does not currently own a vehicle.
   */
  findVehicleByOwner(ownerId: string): Vehicle | null {
    const id = this.vehicleByOwner.get(ownerId);
    if (id === undefined) return null;
    return this.vehicles.get(id) ?? null;
  }

  /** Iterate over every registered vehicle. */
  *vehicles_(): IterableIterator<Vehicle> {
    for (const v of this.vehicles.values()) yield v;
  }

  get vehicleCount(): number {
    return this.vehicles.size;
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  private originKey(coord: TileCoord): string {
    return `${coord.x},${coord.y}`;
  }
}
