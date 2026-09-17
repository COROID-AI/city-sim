/**
 * Screen-to-entity picking over the camera transform.
 *
 * The picking layer answers exactly one question, deterministically and without
 * touching the DOM or a canvas pixel: *which entity did this screen click hit?*
 *
 * - the click arrives in **logical (CSS) screen pixels**, the coordinate system
 *   `ViewportCamera` documents;
 * - {@link EntityPicker} converts it to **world (tile) coordinates** with the
 *   camera's own `screenToWorld`, so picking can never disagree with what the
 *   renderer drew through `worldToScreen`;
 * - every building, citizen and vehicle is measured against that world point,
 *   and the nearest candidate within tolerance wins.
 *
 * ## Distances and tolerance
 *
 * An entity's distance is measured to its **edge**, in tiles, so it is zero
 * while the click is inside (or exactly on) the entity:
 *
 * - citizen: distance to its `position` minus {@link DEFAULT_CITIZEN_RADIUS_TILES};
 * - vehicle: distance to its `position` minus {@link DEFAULT_VEHICLE_RADIUS_TILES};
 * - building: distance to its `footprint` rectangle (0 inside the footprint).
 *
 * The tolerance is **constant on screen** ({@link DEFAULT_PICK_TOLERANCE_PX}
 * logical pixels by default) and therefore zoom-aware in world space: the world
 * tolerance is `tolerancePx / (tileSize * zoom)`, so zooming in shrinks the
 * clickable radius in tiles (precise building-by-building targeting) while
 * zooming out grows it (small entities stay clickable). See
 * {@link pickToleranceTiles} and {@link EntityPicker.toleranceTiles}.
 *
 * ## Priority and determinism
 *
 * Candidates are ranked by `(distance, priority, area, id)`:
 *
 * 1. **distance** — the genuinely nearest entity wins, so a click inside a
 *    building still picks that building even when a pedestrian stands on the
 *    pavement outside it;
 * 2. **priority** — on a distance tie agents ({@link CITIZEN_PICK_PRIORITY},
 *    {@link VEHICLE_PICK_PRIORITY}) beat buildings
 *    ({@link BUILDING_PICK_PRIORITY}), so a citizen standing inside a shop is
 *    picked rather than the shop;
 * 3. **area** — between buildings whose distance ties (both footprints contain
 *    the click) the tighter footprint wins;
 * 4. **id** — lexical id order, so the result never depends on array order.
 *
 * Nothing here mutates the simulation: the picker only reads entity records and
 * returns a plain {@link EntityPick} payload.
 */

import type { Building, Citizen, EntityId, TileRect, Vec2, Vehicle } from '../sim/types';

/* --------------------------------------------------------------- constants -- */

/** Default on-screen pick tolerance, in logical (CSS) pixels. */
export const DEFAULT_PICK_TOLERANCE_PX = 16;
/** Lowest on-screen tolerance a caller may configure. */
export const MIN_PICK_TOLERANCE_PX = 4;
/** Highest on-screen tolerance a caller may configure. */
export const MAX_PICK_TOLERANCE_PX = 64;
/** Click radius of a citizen sprite, in tiles. */
export const DEFAULT_CITIZEN_RADIUS_TILES = 0.28;
/** Click radius of a vehicle sprite, in tiles. */
export const DEFAULT_VEHICLE_RADIUS_TILES = 0.55;

/** Priority ranks used to break distance ties; a lower rank wins. */
export const CITIZEN_PICK_PRIORITY = 0;
export const VEHICLE_PICK_PRIORITY = 1;
export const BUILDING_PICK_PRIORITY = 2;

/** Distances closer than this count as equal, so float noise cannot flip a tie. */
const DISTANCE_EPSILON = 1e-9;

/* ------------------------------------------------------------------ types -- */

/** Entity classes the picker can resolve. */
export type PickedEntityKind = 'citizen' | 'vehicle' | 'building';

/** Pick result kinds: an entity class, or `'ground'` when nothing was hit. */
export type PickResultKind = PickedEntityKind | 'ground';

/**
 * The part of the world picking reads. `WorldMap` (and therefore the generated
 * `CityWorld` and the shared test world) structurally satisfies it.
 */
export interface PickingWorld {
  readonly buildings: readonly Building[];
  readonly citizens: readonly Citizen[];
  readonly vehicles: readonly Vehicle[];
}

/**
 * The part of the camera picking reads. `ViewportCamera` structurally satisfies
 * it, so the real camera can be handed over directly and a fake stays trivial.
 */
export interface PickingCamera {
  readonly zoom: number;
  /** Screen pixels per world tile (`tileSize * zoom`). */
  readonly scale: number;
  screenToWorld(point: Vec2): Vec2;
  worldToScreen(point: Vec2): Vec2;
}

/** Tolerance configuration, all values in logical (CSS) pixels. */
export interface PickingToleranceOptions {
  /** On-screen pick tolerance. Defaults to {@link DEFAULT_PICK_TOLERANCE_PX}. */
  readonly baseTolerancePx?: number;
  /** Floor applied to `baseTolerancePx`. Defaults to {@link MIN_PICK_TOLERANCE_PX}. */
  readonly minTolerancePx?: number;
  /** Ceiling applied to `baseTolerancePx`. Defaults to {@link MAX_PICK_TOLERANCE_PX}. */
  readonly maxTolerancePx?: number;
}

/** Constructor options for {@link EntityPicker}. */
export interface EntityPickerOptions extends PickingToleranceOptions {
  /** Camera whose transform converts screen clicks into world coordinates. */
  readonly camera: PickingCamera;
  /** World to pick from; may also be supplied later through `update()`. */
  readonly world?: PickingWorld | null;
  /** Click radius of citizens, in tiles. Defaults to 0.28. */
  readonly citizenRadiusTiles?: number;
  /** Click radius of vehicles, in tiles. Defaults to 0.55. */
  readonly vehicleRadiusTiles?: number;
  /** Set to false to ignore citizens entirely. Defaults to true. */
  readonly pickCitizens?: boolean;
  /** Set to false to ignore vehicles entirely. Defaults to true. */
  readonly pickVehicles?: boolean;
  /** Set to false to ignore buildings entirely. Defaults to true. */
  readonly pickBuildings?: boolean;
}

/** The result of one pick: the entity hit (or ground) plus the measurements. */
export interface EntityPick {
  /** Entity class hit, or `'ground'` when nothing was within tolerance. */
  readonly kind: PickResultKind;
  /** Id of the entity hit; `null` for a ground pick. */
  readonly id: EntityId | null;
  /** The screen point that was picked, in logical pixels. */
  readonly screen: Vec2;
  /** The screen point converted to world (tile) coordinates. */
  readonly world: Vec2;
  /** Camera zoom at pick time. */
  readonly zoom: number;
  /** Screen pixels per world tile at pick time. */
  readonly scale: number;
  /** Tolerance used, in logical pixels. */
  readonly tolerancePx: number;
  /** Tolerance used, converted to tiles (`tolerancePx / scale`). */
  readonly toleranceTiles: number;
  /**
   * Distance from the click to the nearest entity edge, in tiles (0 while
   * inside/touching an entity). On a ground pick this is the distance to the
   * closest entity in the world, whichever side of the tolerance it fell on;
   * it is `Infinity` when the world holds no entities at all.
   */
  readonly distanceTiles: number;
  /** Distance from the click to the nearest entity centre, in tiles. */
  readonly centreDistanceTiles: number;
  /** {@link EntityPick.distanceTiles} converted to screen pixels. */
  readonly distancePx: number;
}

/** A resolved candidate during the pick scan. */
interface Candidate {
  readonly kind: PickedEntityKind;
  readonly id: EntityId;
  readonly priority: number;
  readonly distanceTiles: number;
  readonly centreDistanceTiles: number;
  readonly areaTiles: number;
}

/* ---------------------------------------------------------------- helpers -- */

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  return value > max ? max : value;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than 0, received ${value}`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, received ${value}`);
  }
}

/** Resolved, validated tolerance bounds. */
export interface ResolvedTolerance {
  readonly basePx: number;
  readonly minPx: number;
  readonly maxPx: number;
  /** The applied tolerance: `basePx` clamped into `[minPx, maxPx]`. */
  readonly tolerancePx: number;
}

/**
 * Validates and resolves {@link PickingToleranceOptions} into the tolerance that
 * will actually be used: the base value clamped between the floor and ceiling.
 */
export function resolveTolerance(options: PickingToleranceOptions = {}): ResolvedTolerance {
  const basePx = options.baseTolerancePx ?? DEFAULT_PICK_TOLERANCE_PX;
  const minPx = options.minTolerancePx ?? MIN_PICK_TOLERANCE_PX;
  const maxPx = options.maxTolerancePx ?? MAX_PICK_TOLERANCE_PX;
  assertPositiveFinite(basePx, 'baseTolerancePx');
  assertPositiveFinite(minPx, 'minTolerancePx');
  assertPositiveFinite(maxPx, 'maxTolerancePx');
  if (minPx > maxPx) {
    throw new RangeError(`minTolerancePx (${minPx}) must not exceed maxTolerancePx (${maxPx})`);
  }
  return { basePx, minPx, maxPx, tolerancePx: clamp(basePx, minPx, maxPx) };
}

/**
 * The zoom-aware core of picking: the on-screen tolerance converted into world
 * tiles for a given scale. `scale` is `tileSize * zoom`, so the result shrinks
 * as the camera zooms in and grows as it zooms out.
 */
export function pickToleranceTiles(scale: number, options: PickingToleranceOptions = {}): number {
  assertPositiveFinite(scale, 'scale');
  return resolveTolerance(options).tolerancePx / scale;
}

/** Distance from a point to a rectangle, in tiles; 0 when inside the rectangle. */
export function distanceToRect(point: Vec2, rect: TileRect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/** Narrows a pick to an entity hit, so `id` reads as a plain `EntityId`. */
export function isEntityPick(
  pick: EntityPick,
): pick is EntityPick & { readonly kind: PickedEntityKind; readonly id: EntityId } {
  return pick.kind !== 'ground' && pick.id !== null;
}

/** Ranks two candidates; returns true when `left` should win. */
function isBetterCandidate(left: Candidate, right: Candidate): boolean {
  const delta = left.distanceTiles - right.distanceTiles;
  if (delta < -DISTANCE_EPSILON) {
    return true;
  }
  if (delta > DISTANCE_EPSILON) {
    return false;
  }
  if (left.priority !== right.priority) {
    return left.priority < right.priority;
  }
  if (left.areaTiles !== right.areaTiles) {
    return left.areaTiles < right.areaTiles;
  }
  return left.id < right.id;
}

/* ----------------------------------------------------------------- picker -- */

/**
 * Resolves screen clicks to the nearest building, citizen or vehicle.
 *
 * Lifecycle mirrors the rest of the render layer: construct it with the camera
 * (and optionally the world), call {@link EntityPicker.update} with the live
 * world every tick — the world arrays are mutated in place, so rebinding the
 * reference is enough — and reap it with {@link EntityPicker.dispose}.
 *
 * ```ts
 * const picker = new EntityPicker({ camera, world });
 * picker.update(world);
 * const pick = picker.pick(event.clientX, event.clientY);
 * if (isEntityPick(pick)) inspector.select(pick.kind, pick.id);
 * ```
 */
export class EntityPicker {
  /** Camera providing the world <-> screen transform. */
  readonly camera: PickingCamera;
  /** Resolved tolerance bounds. */
  readonly tolerance: ResolvedTolerance;
  /** Click radius of citizens, in tiles. */
  readonly citizenRadiusTiles: number;
  /** Click radius of vehicles, in tiles. */
  readonly vehicleRadiusTiles: number;

  private readonly pickCitizensValue: boolean;
  private readonly pickVehiclesValue: boolean;
  private readonly pickBuildingsValue: boolean;
  private worldValue: PickingWorld | null;
  private disposedFlag = false;

  constructor(options: EntityPickerOptions) {
    if (!options.camera) {
      throw new TypeError('EntityPicker requires a camera');
    }
    this.camera = options.camera;
    this.tolerance = resolveTolerance(options);
    this.citizenRadiusTiles = options.citizenRadiusTiles ?? DEFAULT_CITIZEN_RADIUS_TILES;
    this.vehicleRadiusTiles = options.vehicleRadiusTiles ?? DEFAULT_VEHICLE_RADIUS_TILES;
    assertFinite(this.citizenRadiusTiles, 'citizenRadiusTiles');
    assertFinite(this.vehicleRadiusTiles, 'vehicleRadiusTiles');
    this.pickCitizensValue = options.pickCitizens ?? true;
    this.pickVehiclesValue = options.pickVehicles ?? true;
    this.pickBuildingsValue = options.pickBuildings ?? true;
    this.worldValue = options.world ?? null;
  }

  /* -------------------------------------------------------------- reading -- */

  /** The world currently being picked from, or `null` before `update()`. */
  get world(): PickingWorld | null {
    return this.worldValue;
  }

  /** True once {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposedFlag;
  }

  /** Camera zoom at pick time. */
  get zoom(): number {
    return this.camera.zoom;
  }

  /** Screen pixels per world tile (`tileSize * zoom`). */
  get scale(): number {
    return this.camera.scale;
  }

  /** Applied tolerance in logical (CSS) pixels. */
  get tolerancePx(): number {
    return this.tolerance.tolerancePx;
  }

  /** Applied tolerance converted to tiles at the camera's current zoom. */
  get toleranceTiles(): number {
    return this.tolerancePx / this.camera.scale;
  }

  /**
   * Tolerance in tiles at an arbitrary zoom, without moving the camera: the
   * documented zoom-aware conversion `tolerancePx / (tileSize * zoom)`.
   */
  toleranceTilesForZoom(zoom: number): number {
    assertPositiveFinite(zoom, 'zoom');
    const tileSize = this.camera.scale / this.camera.zoom;
    return this.tolerancePx / (tileSize * zoom);
  }

  /* ------------------------------------------------------------ lifecycle -- */

  /**
   * Binds the picker to the live world (called every tick by the app loop), or
   * with no argument simply re-reads the current camera transform. Picking is
   * stateless, so this never queues work.
   */
  update(world?: PickingWorld | null): void {
    if (world !== undefined) {
      this.worldValue = world;
    }
  }

  /**
   * Idempotent teardown. After disposal the picker reports ground for every
   * click instead of throwing, so a render loop that still holds it stays safe.
   */
  dispose(): void {
    this.disposedFlag = true;
    this.worldValue = null;
  }

  /* --------------------------------------------------------------- picking -- */

  /** Picks from a screen point, e.g. `{ x: event.clientX, y: event.clientY }`. */
  pickScreen(point: Vec2): EntityPick {
    assertFinite(point.x, 'point.x');
    assertFinite(point.y, 'point.y');
    const screen = { x: point.x, y: point.y };
    return this.resolve(screen, this.camera.screenToWorld(screen));
  }

  /** Picks from raw screen coordinates. */
  pick(screenX: number, screenY: number): EntityPick {
    return this.pickScreen({ x: screenX, y: screenY });
  }

  /**
   * Picks from a world (tile) point — handy for tests and for hosts that already
   * converted their pointer position. The reported screen position is the one
   * the camera projects that world point onto.
   */
  pickWorld(point: Vec2): EntityPick {
    assertFinite(point.x, 'point.x');
    assertFinite(point.y, 'point.y');
    const world = { x: point.x, y: point.y };
    return this.resolve(this.camera.worldToScreen(world), world);
  }

  /* -------------------------------------------------------------- private -- */

  /** Measures every candidate and returns the winning pick payload. */
  private resolve(screen: Vec2, world: Vec2): EntityPick {
    const scale = this.camera.scale;
    const tolerancePx = this.tolerancePx;
    const toleranceTiles = tolerancePx / scale;
    const nearest = this.disposedFlag ? null : this.nearestCandidate(world);

    const distanceTiles = nearest ? nearest.distanceTiles : Number.POSITIVE_INFINITY;
    const centreDistanceTiles = nearest ? nearest.centreDistanceTiles : Number.POSITIVE_INFINITY;
    const base = {
      screen,
      world,
      zoom: this.camera.zoom,
      scale,
      tolerancePx,
      toleranceTiles,
      distanceTiles,
      centreDistanceTiles,
      distancePx: distanceTiles * scale,
    };

    if (nearest && distanceTiles <= toleranceTiles + DISTANCE_EPSILON) {
      return { ...base, kind: nearest.kind, id: nearest.id };
    }
    return { ...base, kind: 'ground', id: null };
  }

  /** The best candidate for a world point, ignoring the tolerance. */
  private nearestCandidate(world: Vec2): Candidate | null {
    const pickingWorld = this.worldValue;
    if (!pickingWorld) {
      return null;
    }
    let best: Candidate | null = null;
    if (this.pickCitizensValue) {
      for (const citizen of pickingWorld.citizens) {
        const candidate = this.citizenCandidate(world, citizen);
        if (!best || isBetterCandidate(candidate, best)) {
          best = candidate;
        }
      }
    }
    if (this.pickVehiclesValue) {
      for (const vehicle of pickingWorld.vehicles) {
        const candidate = this.vehicleCandidate(world, vehicle);
        if (!best || isBetterCandidate(candidate, best)) {
          best = candidate;
        }
      }
    }
    if (this.pickBuildingsValue) {
      for (const building of pickingWorld.buildings) {
        const candidate = this.buildingCandidate(world, building);
        if (!best || isBetterCandidate(candidate, best)) {
          best = candidate;
        }
      }
    }
    return best;
  }

  private citizenCandidate(world: Vec2, citizen: Citizen): Candidate {
    const centre = Math.hypot(world.x - citizen.position.x, world.y - citizen.position.y);
    return {
      kind: 'citizen',
      id: citizen.id,
      priority: CITIZEN_PICK_PRIORITY,
      distanceTiles: Math.max(0, centre - this.citizenRadiusTiles),
      centreDistanceTiles: centre,
      areaTiles: 0,
    };
  }

  private vehicleCandidate(world: Vec2, vehicle: Vehicle): Candidate {
    const centre = Math.hypot(world.x - vehicle.position.x, world.y - vehicle.position.y);
    return {
      kind: 'vehicle',
      id: vehicle.id,
      priority: VEHICLE_PICK_PRIORITY,
      distanceTiles: Math.max(0, centre - this.vehicleRadiusTiles),
      centreDistanceTiles: centre,
      areaTiles: 0,
    };
  }

  private buildingCandidate(world: Vec2, building: Building): Candidate {
    const edge = distanceToRect(world, building.footprint);
    const centre = Math.hypot(
      world.x - (building.footprint.x + building.footprint.width / 2),
      world.y - (building.footprint.y + building.footprint.height / 2),
    );
    return {
      kind: 'building',
      id: building.id,
      priority: BUILDING_PICK_PRIORITY,
      distanceTiles: edge,
      centreDistanceTiles: centre,
      areaTiles: building.footprint.width * building.footprint.height,
    };
  }
}

/**
 * Creates a picker over the camera and world. Pass the `ViewportCamera` used by
 * the renderer so picking and drawing cannot disagree about the transform.
 */
export function createEntityPicker(options: EntityPickerOptions): EntityPicker {
  return new EntityPicker(options);
}
