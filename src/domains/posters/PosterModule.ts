/**
 * Poster scene module — the café's wall artwork.
 *
 * One module owns every framed, pinned, taped and unframed sheet on the wall,
 * exactly the way the frozen {@link SceneModule} contract expects:
 *
 *  - `build(context)` plans the era's placements from the environment shell's
 *    structural anchors, paints one poster face per placement (procedural canvas
 *    or data texture), assembles each sheet with its era frame, mounting
 *    hardware and wall-wear decals, and attaches the whole set as a single
 *    `posters` group under the composition root.
 *  - `applyPeriod(period, context)` swaps the whole wall to the new era: the next
 *    set is built and attached first, then the previous one is detached and its
 *    geometries, materials and textures are disposed, so no frame can reference a
 *    released resource.
 *  - `update(delta, context)` runs the era's small life: neon tube flicker on the
 *    1985 frames, a barely visible sway on taped and pinned sheets.
 *  - `dispose()` releases every geometry, material and texture this module
 *    created, detaches the group and reports the disposition. Safe to call twice.
 *  - `getHotspots()` exposes one affordance per mounted poster, with the era note
 *    and an `Object3D` anchor; {@link PosterModule.posterFocus} adds the exact
 *    framing the navigation controller should use to inspect the artwork up
 *    close.
 *
 * Placement is derived, never hard-coded: candidate positions come from the wall
 * mount surfaces the environment shell publishes, and a candidate is rejected
 * when its footprint leaves the room, crosses the doorway, the storefront
 * glazing or the counter, or sits in the menu board's readable sightline.
 */

import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  yearToNumber,
  type BuildContext,
  type Hotspot,
  type PeriodDefinition,
  type RoomBounds,
  type RoomPoint,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../../contracts/period';
import { createSeededRandom } from '../../core/kernel';
import { CAFE_ROOM_BOUNDS, STRUCTURAL_LAYOUT } from '../environment/EnvironmentModule';
import type {
  ReservedZone,
  StructuralLayout,
  WallId,
  WallMountSurface,
  WallSurface,
} from '../environment/roomBounds';
import {
  PosterMaterialLibrary,
  buildPosterAssembly,
  detachPosterAssembly,
  frameExtents,
  type PosterAssembly,
  type PosterMount,
} from './frames';
import {
  POSTER_SPECS,
  POSTER_INVENTORY,
  describePosterSpec,
  posterSpec,
  type PosterCategory,
  type PosterInventoryRow,
  type PosterSpec,
  type PosterYearSpec,
  type PosterYearSpecSummary,
} from './data/index';
import {
  PosterResources,
  PosterSurfaceCache,
  POSTER_FACE_TEXTURE_HEIGHT,
  createPosterFaceTexture,
  hashString,
  isProceduralPosterTexture,
  type CanvasFactory,
  type PosterFaceRequest,
  type PosterTexture,
} from './textures';

/** Stable module id: registry key, hotspot owner id and node namespace. */
export const POSTER_MODULE_ID = 'posters';

/** Name of the single group every poster node is parented to. */
export const POSTER_GROUP_NAME = 'posters';

/** How far the mounting hole sits off the wall plane, in metres. */
const PLANE_CLEARANCE = 0.02;

/** Clearance kept between a poster footprint and a reserved zone, in metres. */
const ZONE_CLEARANCE = 0.06;

/** Distance kept from the wall ends/corners, in metres. */
const WALL_INSET = 0.02;

/** Lowest the paper and frame may hang (above the wainscot cap), in metres. */
const MIN_HANG_HEIGHT = 1.06;

/** Headroom kept below the ceiling, in metres. */
const CEILING_CLEARANCE = 0.22;

/** Lateral offsets tried around each wall mount, in metres. */
const LATERAL_STEPS: readonly number[] = Object.freeze([0, 0.82, -0.82, 1.64, -1.64, 2.46, -2.46]);

/** Vertical offsets (extra rows) tried on each wall mount, in metres. */
const VERTICAL_STEPS: readonly number[] = Object.freeze([0, 1.16, 2.32]);

/**
 * How far the menu board's readable sightline reaches into the room, in metres.
 * Posters are never allowed inside it.
 */
export const MENU_SIGHTLINE_DEPTH = 2.4;

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                           */
/* -------------------------------------------------------------------------- */

/** Axis aligned box in world space. */
export interface PosterBox {
  readonly min: RoomPoint;
  readonly max: RoomPoint;
}

/** True when two boxes overlap (touching faces do not count). */
export function boxesOverlap(a: PosterBox, b: PosterBox): boolean {
  return (
    a.min.x < b.max.x &&
    b.min.x < a.max.x &&
    a.min.y < b.max.y &&
    b.min.y < a.max.y &&
    a.min.z < b.max.z &&
    b.min.z < a.max.z
  );
}

/** Size of a box along each axis. */
export function boxSize(box: PosterBox): RoomPoint {
  return {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  };
}

function box(center: RoomPoint, half: RoomPoint): PosterBox {
  return {
    min: { x: center.x - half.x, y: center.y - half.y, z: center.z - half.z },
    max: { x: center.x + half.x, y: center.y + half.y, z: center.z + half.z },
  };
}

/** Box occupied by a reserved opening (doorway, entrance, glazing bay). */
export function reservedZoneBox(zone: ReservedZone): PosterBox {
  const depth = 0.18;
  if (Math.abs(zone.inward.x) > 0.5) {
    const from = zone.position.x;
    const to = zone.position.x + depth * zone.inward.x;
    return {
      min: { x: Math.min(from, to), y: zone.sillHeight, z: zone.position.z - zone.width / 2 },
      max: { x: Math.max(from, to), y: zone.sillHeight + zone.height, z: zone.position.z + zone.width / 2 },
    };
  }
  const from = zone.position.z;
  const to = zone.position.z + depth * zone.inward.z;
  return {
    min: { x: zone.position.x - zone.width / 2, y: zone.sillHeight, z: Math.min(from, to) },
    max: { x: zone.position.x + zone.width / 2, y: zone.sillHeight + zone.height, z: Math.max(from, to) },
  };
}

/** The wall mount carrying the menu board, whose sightline posters must avoid. */
export function menuBoardMount(layout: StructuralLayout): WallMountSurface | undefined {
  return (
    layout.wallMounts.find((mount) => mount.purpose === 'menu') ??
    layout.wallMounts.find((mount) => mount.id.includes('menu'))
  );
}

/** True when a mount belongs to the menu board rather than to the posters. */
export function isMenuBoardMount(mount: WallMountSurface): boolean {
  return mount.purpose === 'menu' || mount.id.includes('menu');
}

/** Volume the menu board's readable sightline occupies. */
export function menuSightlineBox(layout: StructuralLayout): PosterBox | null {
  const mount = menuBoardMount(layout);
  if (!mount) return null;
  const normal = mount.normal;
  if (Math.abs(normal.x) > 0.5) {
    const to = mount.position.x + MENU_SIGHTLINE_DEPTH * normal.x;
    return {
      min: { x: Math.min(mount.position.x, to), y: mount.mountHeight - 0.75, z: mount.position.z - mount.width / 2 - 0.25 },
      max: { x: Math.max(mount.position.x, to), y: mount.mountHeight + 0.75, z: mount.position.z + mount.width / 2 + 0.25 },
    };
  }
  const to = mount.position.z + MENU_SIGHTLINE_DEPTH * normal.z;
  return {
    min: { x: mount.position.x - mount.width / 2 - 0.25, y: mount.mountHeight - 0.75, z: Math.min(mount.position.z, to) },
    max: { x: mount.position.x + mount.width / 2 + 0.25, y: mount.mountHeight + 0.75, z: Math.max(mount.position.z, to) },
  };
}

/** Volume the counter occupies, which posters must stay above. */
export function counterBox(layout: StructuralLayout): PosterBox {
  const counter = layout.counter;
  return box(
    { x: counter.center.x, y: counter.surfaceHeight / 2, z: counter.center.z },
    { x: counter.width / 2, y: counter.surfaceHeight / 2, z: counter.depth / 2 },
  );
}

/** Wall coordinate frame: how a wall's plane, normal and lateral axis map to world. */
export interface PosterWallFrame {
  readonly wall: WallId;
  /** Rotation about Y that turns a `+Z` facing plane into the wall's inward normal. */
  readonly rotationY: number;
  /** Inward normal of the wall. */
  readonly normal: RoomPoint;
  /** World direction of the poster's local `+X`. */
  readonly lateral: RoomPoint;
}

/** Coordinate frame of one wall of the room. */
export function posterWallFrame(wall: WallId): PosterWallFrame {
  switch (wall) {
    case 'back':
      return { wall, rotationY: 0, normal: { x: 0, y: 0, z: 1 }, lateral: { x: 1, y: 0, z: 0 } };
    case 'front':
      return { wall, rotationY: Math.PI, normal: { x: 0, y: 0, z: -1 }, lateral: { x: -1, y: 0, z: 0 } };
    case 'right':
      return { wall, rotationY: -Math.PI / 2, normal: { x: -1, y: 0, z: 0 }, lateral: { x: 0, y: 0, z: 1 } };
    case 'left':
    default:
      return { wall: 'left', rotationY: Math.PI / 2, normal: { x: 1, y: 0, z: 0 }, lateral: { x: 0, y: 0, z: -1 } };
  }
}

function wallRun(layout: StructuralLayout, wall: WallId): number {
  const surface: WallSurface | undefined = layout.walls.find((entry) => entry.id === wall);
  return surface ? surface.run : Math.max(layout.bounds.width, layout.bounds.depth);
}

/** Offsets, in metres, from the anchor to the centre of the paper and its frame. */
function offsetPoint(point: RoomPoint, direction: RoomPoint, distance: number): RoomPoint {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance, z: point.z + direction.z * distance };
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                  */
/* -------------------------------------------------------------------------- */

/** One poster, mounted on a wall: where it hangs and how big it is. */
export interface PosterPlacement {
  readonly posterId: string;
  readonly mountId: string;
  readonly wall: WallId;
  readonly category: PosterCategory;
  readonly mount: PosterMount;
  readonly frame: PosterSpec['frame'];
  readonly label: string;
  readonly headline: string;
  readonly note: string;
  /** Origin of the mounted poster (on the wall plane, proud of the paint). */
  readonly position: RoomPoint;
  readonly rotationY: number;
  /** Rotation about the wall normal (hand-hung tilt), in radians. */
  readonly tilt: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Anchor the placement was derived from. */
  readonly anchor: RoomPoint;
  readonly offsets: { readonly lateral: number; readonly vertical: number };
  /** Paper plus frame. */
  readonly box: PosterBox;
  /** Paper, frame and the wall-wear decals behind it. */
  readonly footprint: PosterBox;
}

/** A poster that could not be placed, and why. */
export interface PosterPlacementRejection {
  readonly posterId: string;
  readonly reason: string;
}

/** Result of planning one era's wall. */
export interface PosterPlacementPlan {
  readonly placements: readonly PosterPlacement[];
  readonly rejected: readonly PosterPlacementRejection[];
  /** Poster mounts the plan was allowed to use. */
  readonly candidateMounts: readonly string[];
}

export interface PosterPlacementOptions {
  readonly bounds?: RoomBounds;
  readonly random?: () => number;
  readonly maxPosters?: number;
}

function footprintsOf(placements: readonly PosterPlacement[]): readonly PosterBox[] {
  return placements.map((placement) => placement.footprint);
}

function placementBoxes(
  anchor: RoomPoint,
  frame: PosterWallFrame,
  width: number,
  height: number,
  depth: number,
  tilt: number,
  wearMargin: number,
): { box: PosterBox; footprint: PosterBox } {
  const cos = Math.abs(Math.cos(tilt));
  const sin = Math.abs(Math.sin(tilt));
  const halfLateral = (width / 2) * cos + (height / 2) * sin;
  const halfVertical = (width / 2) * sin + (height / 2) * cos;
  const origin = offsetPoint(anchor, frame.normal, PLANE_CLEARANCE);
  const axis = (value: PosterBox, direction: RoomPoint, negative: number, positive: number): void => {
    const mutableMin = value.min as { x: number; y: number; z: number };
    const mutableMax = value.max as { x: number; y: number; z: number };
    if (direction.x !== 0) {
      mutableMin.x += Math.min(negative * direction.x, positive * direction.x);
      mutableMax.x += Math.max(negative * direction.x, positive * direction.x);
    }
    if (direction.y !== 0) {
      mutableMin.y += Math.min(negative * direction.y, positive * direction.y);
      mutableMax.y += Math.max(negative * direction.y, positive * direction.y);
    }
    if (direction.z !== 0) {
      mutableMin.z += Math.min(negative * direction.z, positive * direction.z);
      mutableMax.z += Math.max(negative * direction.z, positive * direction.z);
    }
  };
  const build = (extra: number): PosterBox => {
    const value: PosterBox = {
      min: { x: origin.x, y: origin.y, z: origin.z },
      max: { x: origin.x, y: origin.y, z: origin.z },
    };
    // Lateral and vertical extent of the paper and frame, then the depth: the
    // decals sit 0.016 m behind the paper (flat against the wall), while the
    // frame stands proud into the room.
    axis(value, frame.lateral, -halfLateral - extra, halfLateral + extra);
    axis(value, { x: 0, y: 1, z: 0 }, -halfVertical - extra, halfVertical + extra);
    axis(value, frame.normal, -0.016, depth + extra);
    return value;
  };
  return { box: build(0), footprint: build(wearMargin) };
}

function inflateBox(value: PosterBox, amount: number): PosterBox {
  return {
    min: { x: value.min.x - amount, y: value.min.y - amount, z: value.min.z - amount },
    max: { x: value.max.x + amount, y: value.max.y + amount, z: value.max.z + amount },
  };
}

/**
 * The invariant a candidate placement must satisfy, or `null` when it is sound.
 * Exposed so other tasks (and the tests) can re-check a placement plan without
 * reimplementing the rules.
 */
export function placementConflict(
  candidate: PosterPlacement,
  layout: StructuralLayout,
  bounds: RoomBounds,
  placed: readonly PosterBox[],
): string | null {
  const frame = posterWallFrame(candidate.wall);
  const run = wallRun(layout, candidate.wall);
  const lateralCoordinate = frame.lateral.x !== 0 ? candidate.position.x : candidate.position.z;
  if (Math.abs(lateralCoordinate) + candidate.width / 2 > run / 2 - WALL_INSET) {
    return 'the sheet would run past the end of the wall';
  }
  if (candidate.box.min.y < MIN_HANG_HEIGHT) {
    return 'the sheet would hang below the dado';
  }
  if (candidate.box.max.y > bounds.height - CEILING_CLEARANCE) {
    return 'the sheet would crowd the ceiling';
  }
  if (
    candidate.footprint.min.x < -bounds.width / 2 - 1e-9 ||
    candidate.footprint.max.x > bounds.width / 2 + 1e-9 ||
    candidate.footprint.min.z < -bounds.depth / 2 - 1e-9 ||
    candidate.footprint.max.z > bounds.depth / 2 + 1e-9
  ) {
    return 'the sheet would leave the room bounds';
  }
  for (const zone of layout.reservedZones) {
    if (boxesOverlap(candidate.footprint, inflateBox(reservedZoneBox(zone), ZONE_CLEARANCE))) {
      return `the sheet would cross the ${zone.id}`;
    }
  }
  if (boxesOverlap(candidate.footprint, counterBox(layout))) {
    return 'the sheet would hang in front of the counter';
  }
  const sightline = menuSightlineBox(layout);
  if (sightline && boxesOverlap(candidate.footprint, sightline)) {
    return 'the sheet would block the menu board sightline';
  }
  for (const other of placed) {
    if (boxesOverlap(candidate.footprint, other)) return 'the sheet would overlap another poster';
  }
  return null;
}

/** Builds the candidate placement of `poster` at one mount offset. */
export function posterCandidate(
  poster: PosterSpec,
  spec: PosterYearSpec,
  mount: WallMountSurface,
  lateral: number,
  vertical: number,
  tilt: number,
): PosterPlacement {
  const frame = posterWallFrame(mount.wall);
  const extents = frameExtents(poster.frame, poster.size);
  const anchor = offsetPoint(mount.position, frame.lateral, lateral);
  const anchorWithRow = offsetPoint(anchor, { x: 0, y: 1, z: 0 }, vertical);
  const origin = offsetPoint(anchorWithRow, frame.normal, PLANE_CLEARANCE);
  const wearMargin = poster.mount === 'framed' ? 0.05 : 0.08;
  const boxes = placementBoxes(anchor, frame, extents.width, extents.height, extents.depth, tilt, wearMargin);
  return {
    posterId: poster.id,
    mountId: mount.id,
    wall: mount.wall,
    category: poster.category,
    mount: poster.mount,
    frame: poster.frame,
    label: poster.title,
    headline: poster.headline,
    note: poster.note,
    position: origin,
    rotationY: frame.rotationY,
    tilt,
    width: extents.width,
    height: extents.height,
    depth: extents.depth,
    anchor: mount.position,
    offsets: { lateral, vertical },
    box: boxes.box,
    footprint: boxes.footprint,
  };
}

/**
 * Plans one era's wall: every poster is mounted on a real wall mount surface
 * published by the environment shell, offset laterally or into a second row when
 * the prime spot is taken, and rejected when the result would leave the room,
 * cross a reserved opening or block the menu board.
 */
export function planPosterPlacements(
  spec: PosterYearSpec,
  layout: StructuralLayout,
  options: PosterPlacementOptions = {},
): PosterPlacementPlan {
  const bounds = options.bounds ?? layout.bounds;
  const random = options.random ?? createSeededRandom(hashString(`posters:${spec.year}`));
  const mounts = layout.wallMounts.filter(
    (mount) => mount.purpose === 'poster' && !isMenuBoardMount(mount),
  );
  const wallOrder: readonly WallId[] = ['back', 'left', 'right', 'front'];
  const ordered = [...mounts].sort((left, right) => {
    const wallDelta = wallOrder.indexOf(left.wall) - wallOrder.indexOf(right.wall);
    return wallDelta !== 0 ? wallDelta : left.id.localeCompare(right.id);
  });
  const posters = [...spec.posters]
    .sort((left, right) => left.priority - right.priority)
    .slice(0, options.maxPosters ?? spec.posters.length);

  const placements: PosterPlacement[] = [];
  const rejected: PosterPlacementRejection[] = [];

  for (const poster of posters) {
    let accepted: PosterPlacement | null = null;
    let lastReason = 'no wall mount could take the sheet';
    for (const mount of ordered) {
      for (const vertical of VERTICAL_STEPS) {
        for (const lateral of LATERAL_STEPS) {
          const tilt = poster.mount === 'framed' ? 0 : (random() - 0.5) * 0.03;
          const candidate = posterCandidate(poster, spec, mount, lateral, vertical, tilt);
          const conflict = placementConflict(candidate, layout, bounds, footprintsOf(placements));
          if (conflict === null) {
            accepted = candidate;
            break;
          }
          lastReason = conflict;
        }
        if (accepted) break;
      }
      if (accepted) break;
    }
    if (accepted) placements.push(accepted);
    else rejected.push({ posterId: poster.id, reason: lastReason });
  }

  return Object.freeze({
    placements: Object.freeze(placements),
    rejected: Object.freeze(rejected),
    candidateMounts: Object.freeze(ordered.map((mount) => mount.id)),
  });
}

/**
 * Re-runs every placement invariant against the live layout and returns one
 * message per problem: off-room, off-wall, clashing with a reserved opening,
 * hanging over the counter, inside the menu board sightline or overlapping
 * another sheet.
 */
export function posterPlacementProblems(
  placements: readonly PosterPlacement[],
  layout: StructuralLayout,
  bounds: RoomBounds = layout.bounds,
): readonly string[] {
  const problems: string[] = [];
  const known = new Map(layout.wallMounts.map((mount) => [mount.id, mount]));
  const boxes: PosterBox[] = [];
  for (const placement of placements) {
    const mount = known.get(placement.mountId);
    if (!mount) {
      problems.push(`${placement.posterId}: mounts on unknown wall mount ${placement.mountId}`);
      continue;
    }
    if (mount.wall !== placement.wall) {
      problems.push(`${placement.posterId}: wall ${placement.wall} does not match mount ${mount.id}`);
    }
    if (isMenuBoardMount(mount)) {
      problems.push(`${placement.posterId}: must not mount on the menu board's own mount ${mount.id}`);
    }
    const frame = posterWallFrame(placement.wall);
    const planeCoordinate = frame.normal.x !== 0 ? placement.position.x : placement.position.z;
    const wallPlane = frame.normal.x !== 0 ? (bounds.width / 2) * Math.sign(-frame.normal.x) : (bounds.depth / 2) * Math.sign(-frame.normal.z);
    if (Math.abs(planeCoordinate - wallPlane) > PLANE_CLEARANCE + 1e-6) {
      problems.push(`${placement.posterId}: does not sit on the ${placement.wall} wall plane`);
    }
    const conflict = placementConflict(placement, layout, bounds, boxes);
    if (conflict) problems.push(`${placement.posterId}: ${conflict}`);
    boxes.push(placement.footprint);
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Module                                                                     */
/* -------------------------------------------------------------------------- */

/** Options for {@link PosterModule}. */
export interface PosterModuleOptions {
  /** Interior volume; defaults to the environment shell's bounds. */
  readonly bounds?: RoomBounds;
  /** Structural anchor set; defaults to the environment shell's layout. */
  readonly layout?: StructuralLayout;
  /** Canvas factory for the procedural artwork (defaults to the DOM canvas). */
  readonly canvasFactory?: CanvasFactory;
  /** Poster face resolution in pixels. */
  readonly faceTextureHeight?: number;
  readonly anisotropy?: number;
  /** Deterministic seed for placement jitter and hand-hung tilt. */
  readonly seed?: number;
  /** Era reported by `getHotspots` before the first build. */
  readonly initialYear?: YearId;
  /** Caps how many posters of the era are mounted. */
  readonly maxPosters?: number;
  /** Overrides the era wall colour the wear decals are tinted against. */
  readonly wallColour?: string;
}

/** What one poster build released when it was disposed. */
export interface PosterDisposition {
  readonly geometries: number;
  readonly materials: number;
  readonly textures: number;
  readonly surfaces: number;
  readonly posters: number;
  readonly hotspots: number;
}

/** Close-up framing the navigation controller should use for one poster. */
export interface PosterFocusFraming {
  readonly posterId: string;
  readonly label: string;
  readonly year: YearId;
  readonly target: RoomPoint;
  /** Direction from the eye to the artwork (the wall's inward normal). */
  readonly direction: RoomPoint;
  readonly eye: RoomPoint;
  readonly distance: number;
  readonly radius: number;
}

/** Per-frame animation state of one mounted poster. */
export interface PosterState {
  readonly posterId: string;
  readonly mountId: string;
  readonly mount: PosterMount;
  /** In-plane sway of the sheet, in radians. */
  readonly sway: number;
  /** Emissive intensity of the frame's lit parts (neon tube / lightbox). */
  readonly emissive: number;
}

/** Diagnostics snapshot of the module for one moment in the timeline. */
export interface PosterModuleDescription {
  readonly moduleId: string;
  readonly year: YearId;
  readonly built: boolean;
  readonly posterCount: number;
  readonly hotspotCount: number;
  readonly mounts: readonly string[];
  readonly mountStyles: readonly PosterMount[];
  readonly categories: readonly PosterCategory[];
  readonly frames: readonly string[];
  readonly headlines: readonly string[];
  readonly textureCount: number;
  readonly materialCount: number;
  readonly geometryCount: number;
  readonly surfaceCount: number;
  readonly textureSource: 'canvas' | 'data' | 'mixed' | 'none';
  readonly proceduralOnly: boolean;
  readonly printFades: readonly number[];
  readonly placementProblems: readonly string[];
  readonly rejected: readonly string[];
  readonly summary: PosterYearSpecSummary;
  readonly inventory: PosterInventoryRow;
}

interface PosterBuild {
  readonly year: YearId;
  readonly group: THREE.Group;
  readonly resources: PosterResources;
  readonly assemblies: readonly PosterAssembly[];
  readonly anchors: readonly THREE.Group[];
  readonly faces: readonly PosterTexture[];
  readonly placements: readonly PosterPlacement[];
  readonly rejected: readonly PosterPlacementRejection[];
  readonly spec: PosterYearSpec;
  readonly layout: StructuralLayout;
  readonly bounds: RoomBounds;
}

function readEnvironment(context: BuildContext): { layout: StructuralLayout; bounds: RoomBounds } | null {
  const services = context.services;
  if (!services) return null;
  for (const key of ['environmentModule', 'environment', 'shell']) {
    const candidate = services[key];
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as { layout?: unknown; bounds?: unknown };
    const layout = record.layout as StructuralLayout | undefined;
    const bounds = record.bounds as RoomBounds | undefined;
    if (layout && Array.isArray(layout.wallMounts) && bounds) return { layout, bounds };
  }
  return null;
}

/**
 * The café's wall artwork: framed, pinned, taped and unframed posters for every
 * era, mounted on the environment shell's wall surfaces.
 */
export class PosterModule implements SceneModule<PosterYearSpec> {
  readonly id = POSTER_MODULE_ID;

  private readonly options: PosterModuleOptions;
  private readonly faceCache: PosterSurfaceCache;
  private current: PosterBuild | null = null;
  private states: readonly PosterState[] = [];
  private phase = 0;
  private updates = 0;
  private lastDispositionValue: PosterDisposition | null = null;
  private resolvedLayout: StructuralLayout;
  private resolvedBounds: RoomBounds;

  constructor(options: PosterModuleOptions = {}) {
    this.options = options;
    // Five eras × eight posters: caching the whole set keeps timeline scrubbing
    // from repainting artwork it has already produced.
    this.faceCache = new PosterSurfaceCache(48);
    this.resolvedLayout = options.layout ?? STRUCTURAL_LAYOUT;
    this.resolvedBounds = options.bounds ?? this.resolvedLayout.bounds ?? CAFE_ROOM_BOUNDS;
  }

  /* -- SceneModule surface -------------------------------------------------- */

  /** The single `posters` group, once built. */
  get root(): THREE.Object3D | undefined {
    return this.current?.group;
  }

  /** Era data currently applied. */
  get spec(): PosterYearSpec | undefined {
    return this.current?.spec;
  }

  /** Structural anchors the current build used (or the configured defaults). */
  get layout(): StructuralLayout {
    return this.current?.layout ?? this.resolvedLayout;
  }

  /** Interior volume the current build used (or the configured defaults). */
  get bounds(): RoomBounds {
    return this.current?.bounds ?? this.resolvedBounds;
  }

  build(context: BuildContext): void {
    this.dispose();
    this.attach(this.createBuild(context), context);
  }

  applyPeriod(period: PeriodDefinition, context: BuildContext): void {
    const previous = this.current;
    const next = this.createBuild(context, period.year);
    this.attach(next, context);
    if (previous) {
      previous.group.removeFromParent();
      for (const assembly of previous.assemblies) detachPosterAssembly(assembly);
      const released = previous.resources.dispose();
      this.lastDispositionValue = Object.freeze({
        ...released,
        posters: previous.placements.length,
        hotspots: previous.placements.length,
      });
    }
  }

  update(deltaSeconds: number, _context: UpdateContext): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
    this.phase = (this.phase + delta) % (Math.PI * 2);
    this.updates += 1;
    const build = this.current;
    if (!build) {
      this.states = [];
      return;
    }
    const nextStates: PosterState[] = [];
    build.placements.forEach((placement, index) => {
      const assembly = build.assemblies[index];
      if (!assembly) return;
      const amplitude = placement.mount === 'taped' ? 0.007 : placement.mount === 'unframed' ? 0.005 : placement.mount === 'pinned' ? 0.003 : 0.0008;
      const sway = Math.sin(this.phase * 1.4 + index * 0.7) * amplitude;
      const lit = assembly.litMaterials[0];
      const emissive = lit ? lit.userData['baseEmissive'] as number ?? lit.emissiveIntensity : 0;
      const flicker = 1 + Math.sin(this.phase * 7.3 + index) * 0.07 + Math.sin(this.phase * 2.17 + index) * 0.04;
      assembly.group.rotation.z = placement.tilt + sway;
      for (const material of assembly.litMaterials) {
        material.emissiveIntensity = emissive * flicker;
      }
      nextStates.push(
        Object.freeze({
          posterId: placement.posterId,
          mountId: placement.mountId,
          mount: placement.mount,
          sway,
          emissive: lit ? emissive * flicker : 0,
        }),
      );
    });
    this.states = Object.freeze(nextStates);
  }

  dispose(): void {
    const build = this.current;
    if (!build) return;
    build.group.removeFromParent();
    for (const assembly of build.assemblies) detachPosterAssembly(assembly);
    const released = build.resources.dispose();
    this.lastDispositionValue = Object.freeze({
      ...released,
      posters: build.placements.length,
      hotspots: build.placements.length,
    });
    this.current = null;
    this.states = [];
    this.phase = 0;
  }

  getHotspots(): readonly Hotspot[] {
    const build = this.current;
    if (!build) return [];
    return build.placements.map((placement, index) => {
      const frame = posterWallFrame(placement.wall);
      const face = offsetPoint(placement.position, frame.normal, placement.depth / 2);
      const anchor = build.anchors[index];
      return {
        id: `poster-${placement.posterId}`,
        label: `${placement.label} — ${placement.headline}`,
        description: placement.note,
        position: new THREE.Vector3(face.x, face.y, face.z),
        radius: Math.max(placement.width, placement.height) * 0.6,
        year: build.year,
        moduleId: this.id,
        kind: 'info',
        anchor,
      } satisfies Hotspot;
    });
  }

  /* -- Poster specific accessors ------------------------------------------- */

  /** Placements of the current era, in hotspot order. */
  get placements(): readonly PosterPlacement[] {
    return this.current?.placements ?? [];
  }

  /** Assemblies of the current era, in placement order. */
  get assemblies(): readonly PosterAssembly[] {
    return this.current?.assemblies ?? [];
  }

  /** Painted face textures of the current era. */
  get faces(): readonly PosterTexture[] {
    return this.current?.faces ?? [];
  }

  /** Resources (geometries, materials, textures) the current build owns. */
  get resources(): PosterResources | undefined {
    return this.current?.resources;
  }

  /** What the last build or era change released. */
  get disposition(): PosterDisposition | null {
    return this.lastDispositionValue;
  }

  /** Live animation state of every mounted poster. */
  get posterStates(): readonly PosterState[] {
    return this.states;
  }

  /** Number of times {@link SceneModule.update} has run. */
  get updateCount(): number {
    return this.updates;
  }

  /** Number of mounted posters in the current era. */
  get posterCount(): number {
    return this.current?.placements.length ?? 0;
  }

  /** Era currently mounted, even before the first build. */
  get year(): YearId {
    return this.current?.year ?? this.options.initialYear ?? DEFAULT_YEAR_ID;
  }

  /** The era's flat inventory row (usable without reading into poster internals). */
  get inventory(): PosterInventoryRow {
    return POSTER_INVENTORY[this.year];
  }

  /** Where the era's finishes came from. */
  get textureSource(): 'canvas' | 'data' | 'mixed' | 'none' {
    const faces = this.faces;
    if (faces.length === 0) return 'none';
    const sources = new Set(faces.map((face) => face.source));
    return sources.size === 1 ? (faces[0]?.source ?? 'none') : 'mixed';
  }

  /** True when every texture the current build owns came from the painters. */
  get proceduralOnly(): boolean {
    const resources = this.current?.resources;
    if (!resources) return true;
    return resources.snapshot().textures.every((texture) => isProceduralPosterTexture(texture));
  }

  /** Close-up framing for one mounted poster, or `null` when it is not on the wall. */
  posterFocus(posterId: string): PosterFocusFraming | null {
    const build = this.current;
    if (!build) return null;
    const placement = build.placements.find((entry) => entry.posterId === posterId);
    if (!placement) return null;
    const frame = posterWallFrame(placement.wall);
    const target = offsetPoint(placement.position, frame.normal, placement.depth / 2);
    const distance = Math.min(Math.max(Math.max(placement.width, placement.height) * 1.15, 0.55), 1.25);
    return Object.freeze({
      posterId,
      label: placement.label,
      year: build.year,
      target: Object.freeze({ ...target }),
      direction: Object.freeze({ ...frame.normal }),
      eye: Object.freeze(offsetPoint(target, frame.normal, distance)),
      distance,
      radius: Math.max(placement.width, placement.height) * 0.6,
    });
  }

  /** Diagnostics snapshot for the overlay and the tests. */
  describe(): PosterModuleDescription {
    const build = this.current;
    const spec = build?.spec ?? POSTER_SPECS[this.options.initialYear ?? DEFAULT_YEAR_ID];
    const counts = build?.resources.counts;
    return Object.freeze({
      moduleId: this.id,
      year: spec.year,
      built: build !== null,
      posterCount: build?.placements.length ?? 0,
      hotspotCount: build?.placements.length ?? 0,
      mounts: Object.freeze((build?.placements ?? []).map((placement) => placement.mountId)),
      mountStyles: Object.freeze([...new Set((build?.placements ?? []).map((placement) => placement.mount))]),
      categories: Object.freeze([...new Set((build?.placements ?? []).map((placement) => placement.category))]),
      frames: Object.freeze([...new Set((build?.placements ?? []).map((placement) => placement.frame))]),
      headlines: Object.freeze((build?.placements ?? []).map((placement) => placement.headline)),
      textureCount: counts?.textures ?? 0,
      materialCount: counts?.materials ?? 0,
      geometryCount: counts?.geometries ?? 0,
      surfaceCount: counts?.surfaces ?? 0,
      textureSource: this.textureSource,
      proceduralOnly: this.proceduralOnly,
      printFades: Object.freeze((build?.placements ?? []).map((placement) => {
        const poster = spec.posters.find((entry) => entry.id === placement.posterId);
        return (poster?.fade ?? 0) + spec.print.fade;
      })),
      placementProblems: build ? posterPlacementProblems(build.placements, build.layout, build.bounds) : Object.freeze([]),
      rejected: Object.freeze((build?.rejected ?? []).map((entry) => `${entry.posterId}: ${entry.reason}`)),
      summary: describePosterSpec(spec),
      inventory: POSTER_INVENTORY[spec.year],
    });
  }

  /** Empties the painted-face cache (the module keeps it alive between eras). */
  clearFaceCache(): void {
    this.faceCache.clear();
  }

  /* -- Internals ------------------------------------------------------------ */

  private createBuild(context: BuildContext, year: YearId = context.year): PosterBuild {
    const environment = readEnvironment(context);
    const layout = this.options.layout ?? environment?.layout ?? STRUCTURAL_LAYOUT;
    const bounds =
      this.options.bounds ?? environment?.bounds ?? layout.bounds ?? context.bounds ?? CAFE_ROOM_BOUNDS;
    this.resolvedLayout = layout;
    this.resolvedBounds = bounds;

    const spec = posterSpec(year);
    const resources = new PosterResources();
    const materials = new PosterMaterialLibrary({
      resources,
      canvasFactory: this.options.canvasFactory,
      anisotropy: this.options.anisotropy,
    });
    const seed = this.options.seed ?? 0x1945;
    const plan = planPosterPlacements(spec, layout, {
      bounds,
      random: createSeededRandom(seed ^ yearToNumber(spec.year)),
      maxPosters: this.options.maxPosters,
    });

    const group = new THREE.Group();
    group.name = POSTER_GROUP_NAME;
    const assemblies: PosterAssembly[] = [];
    const anchors: THREE.Group[] = [];
    const faces: PosterTexture[] = [];
    const faceHeight = this.options.faceTextureHeight ?? POSTER_FACE_TEXTURE_HEIGHT;
    const wallColour = this.options.wallColour ?? spec.wallColour;

    for (const placement of plan.placements) {
      const poster = spec.posters.find((entry) => entry.id === placement.posterId);
      if (!poster) continue;
      const request: PosterFaceRequest = {
        id: poster.id,
        title: poster.title,
        layout: poster.layout,
        motif: poster.motif,
        palette: poster.palette,
        headline: poster.headline,
        subhead: poster.subhead,
        body: poster.body,
        badge: poster.badge,
        footer: poster.footer,
        wear: poster.wear,
        fade: poster.fade,
        year: spec.year,
        typography: spec.typography,
        print: spec.print,
        aspect: poster.size[0] / poster.size[1],
      };
      const face = createPosterFaceTexture(request, {
        canvasFactory: this.options.canvasFactory,
        height: faceHeight,
        anisotropy: this.options.anisotropy,
        cache: this.faceCache,
      });
      resources.ownTexture(face.texture);
      resources.ownSurface(face.surface);
      faces.push(face);

      const anchor = new THREE.Group();
      anchor.name = `poster-${poster.id}`;
      anchor.position.set(placement.position.x, placement.position.y, placement.position.z);
      anchor.rotation.y = placement.rotationY;
      const assembly = buildPosterAssembly({
        face,
        size: poster.size,
        mount: poster.mount,
        frame: poster.frame,
        wear: poster.wear,
        year: spec.year,
        wallColour,
        seed,
        materials,
        resources,
        name: `poster-assembly-${poster.id}`,
      });
      assembly.group.rotation.z = placement.tilt;
      for (const material of assembly.litMaterials) {
        material.userData['baseEmissive'] = material.emissiveIntensity;
      }
      anchor.add(assembly.group);
      group.add(anchor);
      anchors.push(anchor);
      assemblies.push(assembly);
    }

    return {
      year: spec.year,
      group,
      resources,
      assemblies: Object.freeze(assemblies),
      anchors: Object.freeze(anchors),
      faces: Object.freeze(faces),
      placements: plan.placements,
      rejected: plan.rejected,
      spec,
      layout,
      bounds,
    };
  }

  private attach(build: PosterBuild, context: BuildContext): void {
    context.root.add(build.group);
    this.current = build;
    this.states = [];
    this.phase = 0;
  }
}

/** Convenience factory mirroring `createEnvironmentModule` / `createPatronModule`. */
export function createPosterModule(options: PosterModuleOptions = {}): PosterModule {
  return new PosterModule(options);
}

/** Per-year poster specs, keyed by {@link YearId}. */
export { POSTER_SPECS };

/** Flat per-era inventory of the café's wall artwork. */
export { POSTER_INVENTORY };

/** Looks up one era's poster spec. */
export { posterSpec };
