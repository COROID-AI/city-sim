/**
 * Room volume, shell node vocabulary and the structural placement anchor set.
 *
 * This module is the single source of truth for *where things are* in the café:
 *
 *  - {@link CAFE_ROOM_BOUNDS} — the interior {@link RoomBounds} volume that
 *    navigation, prop placement and hotspot anchoring consume (a walkable floor
 *    at y = 0, wide enough for the service counter, the seating field and the
 *    entrance). It is era independent: the timeline moves surfaces, never the
 *    room, so a prop placed in 1945 is still valid in 2025.
 *  - {@link WallSurface} records — the four walls with their inward normals,
 *    used by the shell builder, the storefront and every wall mounted prop.
 *  - {@link STRUCTURAL_LAYOUT} — the structural anchor and zone set: the table
 *    slot grid (with the surface height props are placed at), the counter zone,
 *    the counter-pass slots machines and tableware sit on, the service lane,
 *    the wall mount surfaces posters and signage hang from, and the reserved
 *    doorway and glazing zones that prop placement must leave empty.
 *
 * The layout is deliberately data only — no three.js meshes — so any domain can
 * read it without building anything. {@link validateLayout} checks the
 * invariants (anchors inside the room, props clear of the service lane, the
 * reserved zones on the right walls) and is used by the module's own tests and
 * by consumers that derive a custom layout.
 */

import * as THREE from 'three';
import { DEFAULT_ROOM_BOUNDS, type RoomBounds, type RoomPoint } from '../../contracts/period';

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function freezeList<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

function freezeRecord<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/** Axis aligned rectangle in the floor plane. */
export interface FloorRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Rectangle centred on `point` with half extents `halfX` / `halfZ`. */
export function floorRect(point: RoomPoint, halfX: number, halfZ: number): FloorRect {
  return {
    minX: point.x - halfX,
    maxX: point.x + halfX,
    minZ: point.z - halfZ,
    maxZ: point.z + halfZ,
  };
}

/** True when two floor rectangles overlap (touching edges do not count). */
export function rectsOverlap(a: FloorRect, b: FloorRect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

/** True when `point` lies inside the room volume, `margin` away from the walls. */
export function pointInsideBounds(bounds: RoomBounds, point: RoomPoint, margin = 0): boolean {
  return (
    Math.abs(point.x) <= bounds.width / 2 - margin &&
    Math.abs(point.z) <= bounds.depth / 2 - margin &&
    point.y >= -1e-9 &&
    point.y <= bounds.height + 1e-9
  );
}

/* -------------------------------------------------------------------------- */
/* Room volume                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Interior volume of the café shell, in metres, centred on the origin: 9 m
 * wide, 11 m deep and 3.6 m to the ceiling. Navigation clamps the camera to it,
 * props are placed inside it and the shell's floor plane sits at y = 0.
 */
export const CAFE_ROOM_BOUNDS: RoomBounds = Object.freeze({
  width: DEFAULT_ROOM_BOUNDS.width,
  depth: DEFAULT_ROOM_BOUNDS.depth,
  height: DEFAULT_ROOM_BOUNDS.height,
});

/** Height of the walkable floor plane, in metres (the shell's floor sits here). */
export const WALKABLE_FLOOR_HEIGHT = 0;

/** Thickness of the wall slabs the storefront piers are drawn from. */
export const WALL_THICKNESS = 0.18;

/* -------------------------------------------------------------------------- */
/* Shell node vocabulary                                                      */
/* -------------------------------------------------------------------------- */

/** Name of the single group every environment node is parented to. */
export const ENVIRONMENT_GROUP_NAME = 'environment';

/**
 * Canonical names of the shell nodes. Every one of these exists exactly once in
 * the environment group, which lets navigation, prop placement and the tests
 * address the shell without knowing how it was built.
 */
export const SHELL_NODE_NAMES = {
  floor: 'environment-floor',
  ceiling: 'environment-ceiling',
  wallBack: 'environment-wall-back',
  wallFront: 'environment-wall-front',
  wallLeft: 'environment-wall-left',
  wallRight: 'environment-wall-right',
  wainscot: 'environment-wainscot',
  counterShell: 'environment-counter-shell',
  backRoomDoorway: 'environment-back-room-doorway',
  storefrontGlazing: 'environment-storefront-glazing',
  entranceDoor: 'environment-entrance-door',
  streetSliver: 'environment-street-sliver',
  signageBracket: 'environment-signage-bracket',
} as const;

/** Key of a required shell node. */
export type ShellNodeKey = keyof typeof SHELL_NODE_NAMES;

/** Every shell node, in inventory order. */
export const SHELL_INVENTORY_NODE_NAMES: readonly string[] = freezeList(
  Object.values(SHELL_NODE_NAMES),
);

/**
 * Nodes that describe the *interior envelope*: floor, four walls and ceiling.
 * Their combined bounds must equal {@link CAFE_ROOM_BOUNDS}, which
 * {@link measureShellEnvelope} checks.
 */
export const SHELL_STRUCTURAL_NODE_NAMES: readonly string[] = freezeList([
  SHELL_NODE_NAMES.floor,
  SHELL_NODE_NAMES.ceiling,
  SHELL_NODE_NAMES.wallBack,
  SHELL_NODE_NAMES.wallFront,
  SHELL_NODE_NAMES.wallLeft,
  SHELL_NODE_NAMES.wallRight,
]);

/* -------------------------------------------------------------------------- */
/* Walls                                                                      */
/* -------------------------------------------------------------------------- */

/** Which wall of the room a record describes. */
export type WallId = 'back' | 'front' | 'left' | 'right';

/** One wall of the shell, with the normals props need to face the room. */
export interface WallSurface {
  readonly id: WallId;
  /** Centre of the wall plane in world space. */
  readonly center: RoomPoint;
  /** Axis the wall runs along (`'x'` for the back/front walls). */
  readonly runAxis: 'x' | 'z';
  /** Extent of the wall along {@link runAxis}, in metres. */
  readonly run: number;
  readonly height: number;
  /** Normal pointing into the room. */
  readonly inward: RoomPoint;
  /** Normal pointing out of the room. */
  readonly outward: RoomPoint;
}

/** Builds the four wall records for `bounds` (centred on the origin). */
export function createWalls(bounds: RoomBounds = CAFE_ROOM_BOUNDS): readonly WallSurface[] {
  const halfWidth = bounds.width / 2;
  const halfDepth = bounds.depth / 2;
  const y = bounds.height / 2;
  return freezeList([
    {
      id: 'back',
      center: { x: 0, y, z: -halfDepth },
      runAxis: 'x',
      run: bounds.width,
      height: bounds.height,
      inward: { x: 0, y: 0, z: 1 },
      outward: { x: 0, y: 0, z: -1 },
    },
    {
      id: 'front',
      center: { x: 0, y, z: halfDepth },
      runAxis: 'x',
      run: bounds.width,
      height: bounds.height,
      inward: { x: 0, y: 0, z: -1 },
      outward: { x: 0, y: 0, z: 1 },
    },
    {
      id: 'left',
      center: { x: -halfWidth, y, z: 0 },
      runAxis: 'z',
      run: bounds.depth,
      height: bounds.height,
      inward: { x: 1, y: 0, z: 0 },
      outward: { x: -1, y: 0, z: 0 },
    },
    {
      id: 'right',
      center: { x: halfWidth, y, z: 0 },
      runAxis: 'z',
      run: bounds.depth,
      height: bounds.height,
      inward: { x: -1, y: 0, z: 0 },
      outward: { x: 1, y: 0, z: 0 },
    },
  ]);
}

/** Looks up a wall record, throwing for an unknown id. */
export function wallSurface(walls: readonly WallSurface[], id: WallId): WallSurface {
  const wall = walls.find((entry) => entry.id === id);
  if (!wall) throw new Error(`Unknown wall "${id}".`);
  return wall;
}

/* -------------------------------------------------------------------------- */
/* Structural anchors                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One table position in the seating grid. Props consume {@link position} (the
 * floor anchor) and {@link surfaceHeight} (the height of the table top above
 * it), so a tableware or patron module never has to guess the room.
 */
export interface TableSlot {
  readonly id: string;
  /** 1 based grid coordinates. */
  readonly column: number;
  readonly row: number;
  /** Floor anchor: where the table base is planted. */
  readonly position: RoomPoint;
  /** Height of the usable surface above the floor anchor. */
  readonly surfaceHeight: number;
  /** Chairs that fit around the slot. */
  readonly seats: number;
  /** Free radius props must leave around the anchor. */
  readonly clearance: number;
  /** Rotation of the table around Y, in radians. */
  readonly orientation: number;
  /** Row spacing the slot was derived from, in metres. */
  readonly gridSpacing: number;
}

/** The service counter shell: the volume the counter occupies and its surface. */
export interface CounterZone {
  readonly id: string;
  /** Centre of the counter footprint on the floor. */
  readonly center: RoomPoint;
  readonly width: number;
  readonly depth: number;
  /** Height of the usable counter top above the floor. */
  readonly surfaceHeight: number;
  /** Height of the counter shell below the top slab. */
  readonly baseHeight: number;
  /** Thickness of the top slab. */
  readonly topThickness: number;
  /** Z of the face the barista serves from (towards the room). */
  readonly serviceFaceZ: number;
  /** Z of the counter back (against the back wall). */
  readonly backFaceZ: number;
}

/** What a counter-pass slot is reserved for. */
export type CounterPassKind = 'machine-bay' | 'grinder-bay' | 'tray-run' | 'handoff';

/**
 * One slot on the counter top. Machines, tableware and the till are placed at
 * these anchors instead of at arbitrary counter positions.
 */
export interface CounterPassSlot {
  readonly id: string;
  readonly index: number;
  /** Centre of the slot on the counter surface. */
  readonly position: RoomPoint;
  readonly width: number;
  readonly depth: number;
  /** Counter surface height (mirrors {@link CounterZone.surfaceHeight}). */
  readonly surfaceHeight: number;
  readonly kind: CounterPassKind;
}

/** Barista path between the entrance and the counter service face. */
export interface ServiceLane {
  readonly id: string;
  readonly width: number;
  /** Entrance end of the lane. */
  readonly from: RoomPoint;
  /** Counter end of the lane. */
  readonly to: RoomPoint;
}

/** What a wall mount surface is meant to carry. */
export type WallMountPurpose = 'poster' | 'menu' | 'mirror' | 'clock' | 'signage';

/** A flat, era appropriate surface a wall mounted prop can be attached to. */
export interface WallMountSurface {
  readonly id: string;
  readonly wall: WallId;
  /** Centre of the mount face in world space. */
  readonly position: RoomPoint;
  /** Inward normal of the wall (points into the room). */
  readonly normal: RoomPoint;
  readonly width: number;
  readonly height: number;
  /** Height of the mount centre above the floor. */
  readonly mountHeight: number;
  readonly purpose: WallMountPurpose;
}

/** Kind of opening a reserved zone protects from props. */
export type ReservedZoneKind = 'doorway' | 'glazing' | 'entrance';

/** An opening in the shell that placement must keep clear. */
export interface ReservedZone {
  readonly id: string;
  readonly kind: ReservedZoneKind;
  readonly wall: WallId;
  /** Centre of the opening on the wall plane. */
  readonly position: RoomPoint;
  readonly width: number;
  readonly height: number;
  readonly sillHeight: number;
  /** Inward normal of the wall the opening sits in. */
  readonly inward: RoomPoint;
}

/** The complete structural anchor and zone set consumed by the other domains. */
export interface StructuralLayout {
  /** Interior volume the layout describes. */
  readonly bounds: RoomBounds;
  /** Walkable floor height (0). */
  readonly floorHeight: number;
  readonly wallThickness: number;
  readonly walls: readonly WallSurface[];
  readonly tableSlots: readonly TableSlot[];
  readonly counter: CounterZone;
  readonly counterPassSlots: readonly CounterPassSlot[];
  readonly serviceLane: ServiceLane;
  readonly wallMounts: readonly WallMountSurface[];
  readonly reservedZones: readonly ReservedZone[];
  /** Back room doorway (also present in {@link reservedZones}). */
  readonly doorway: ReservedZone;
  /** Storefront entrance (also present in {@link reservedZones}). */
  readonly entrance: ReservedZone;
  /** Storefront glazing bays, left to right (also present in {@link reservedZones}). */
  readonly glazingZones: readonly ReservedZone[];
}

/** Default counter shell height and top slab thickness (matches the era specs). */
export const COUNTER_BASE_HEIGHT = 1.02;
export const COUNTER_TOP_THICKNESS = 0.06;

/** Default table surface height (matches the era table specs). */
export const TABLE_SURFACE_HEIGHT = 0.74;

/**
 * Height of the exterior signage bracket above the pavement. Also the height of
 * the storefront's reserved wall mount surface, so the signage domain and the
 * shell agree on where the blade hangs.
 */
export const SIGNAGE_MOUNT_HEIGHT = 3.15;

/** Derives the structural layout for `bounds` (defaults to the café room). */
export function createStructuralLayout(bounds: RoomBounds = CAFE_ROOM_BOUNDS): StructuralLayout {
  const halfWidth = bounds.width / 2;
  const halfDepth = bounds.depth / 2;
  const walls = createWalls(bounds);

  /* -- service counter, against the back wall ------------------------------- */

  const counterDepth = 0.9;
  const counterWidth = Math.max(bounds.width - 2.4, 1.2);
  const counterBackZ = -halfDepth + 0.03;
  const counter = freezeRecord<CounterZone>({
    id: 'counter-zone',
    center: { x: 0, y: WALKABLE_FLOOR_HEIGHT, z: counterBackZ + counterDepth / 2 },
    width: counterWidth,
    depth: counterDepth,
    surfaceHeight: COUNTER_BASE_HEIGHT + COUNTER_TOP_THICKNESS,
    baseHeight: COUNTER_BASE_HEIGHT,
    topThickness: COUNTER_TOP_THICKNESS,
    serviceFaceZ: counterBackZ + counterDepth,
    backFaceZ: counterBackZ,
  });

  /* -- counter-pass slots --------------------------------------------------- */

  const passCount = 4;
  const passInset = Math.min(1.0, counterWidth * 0.2);
  const passSpread = Math.max(counterWidth - passInset * 2, 0);
  const passKinds: readonly CounterPassKind[] = ['machine-bay', 'grinder-bay', 'tray-run', 'handoff'];
  const counterPassSlots = freezeList(
    Array.from({ length: passCount }, (_unused, index): CounterPassSlot => {
      const t = index / (passCount - 1);
      const x = -passSpread / 2 + passSpread * t;
      return freezeRecord({
        id: `counter-pass-${index + 1}`,
        index,
        position: { x, y: counter.surfaceHeight, z: counter.center.z },
        width: Math.min(1.2, passSpread / passCount + 0.2),
        depth: counterDepth * 0.7,
        surfaceHeight: counter.surfaceHeight,
        kind: passKinds[index] ?? 'tray-run',
      });
    }),
  );

  /* -- service lane, entrance to counter ------------------------------------ */

  const laneWidth = Math.min(1.5, bounds.width * 0.24);
  const serviceLane = freezeRecord<ServiceLane>({
    id: 'service-lane',
    width: laneWidth,
    from: { x: 0, y: WALKABLE_FLOOR_HEIGHT, z: halfDepth - 0.9 },
    to: { x: 0, y: WALKABLE_FLOOR_HEIGHT, z: counter.serviceFaceZ + 0.35 },
  });

  /* -- seating grid --------------------------------------------------------- */

  const clearance = 0.8;
  const columns = 2;
  const rows = 4;
  const columnSpread = Math.min(
    Math.max(bounds.width * 0.29, laneWidth / 2 + clearance + 0.2),
    Math.max(halfWidth - clearance - 0.2, laneWidth / 2),
  );
  const rowStart = Math.max(-halfDepth + 2.3, counter.serviceFaceZ + clearance + 0.35);
  const rowEnd = halfDepth - clearance - 0.35;
  const rowStep = rows > 1 ? Math.max(Math.min(2, (rowEnd - rowStart) / (rows - 1)), 0.4) : 0;

  const tableSlots: TableSlot[] = [];
  for (let column = 1; column <= columns; column += 1) {
    const side = column === 1 ? -1 : 1;
    for (let row = 1; row <= rows; row += 1) {
      tableSlots.push(
        freezeRecord<TableSlot>({
          id: `table-slot-c${column}-r${row}`,
          column,
          row,
          position: {
            x: columnSpread * side,
            y: WALKABLE_FLOOR_HEIGHT,
            z: rowStart + (row - 1) * rowStep,
          },
          surfaceHeight: TABLE_SURFACE_HEIGHT,
          seats: 2,
          clearance,
          orientation: row % 2 === 0 ? Math.PI / 2 : 0,
          gridSpacing: rowStep,
        }),
      );
    }
  }

  /* -- reserved openings ---------------------------------------------------- */

  const doorwayWidth = Math.min(1.05, bounds.width * 0.12);
  const doorwayHeight = Math.min(2.15, bounds.height * 0.6);
  const doorway = freezeRecord<ReservedZone>({
    id: 'back-room-doorway',
    kind: 'doorway',
    wall: 'back',
    position: { x: bounds.width * 0.32, y: doorwayHeight / 2, z: -halfDepth },
    width: doorwayWidth,
    height: doorwayHeight,
    sillHeight: 0,
    inward: { x: 0, y: 0, z: 1 },
  });

  const entranceWidth = Math.min(1.8, bounds.width * 0.2);
  const entranceHeight = Math.min(2.5, bounds.height * 0.7);
  const entrance = freezeRecord<ReservedZone>({
    id: 'storefront-entrance',
    kind: 'entrance',
    wall: 'front',
    position: { x: 0, y: entranceHeight / 2, z: halfDepth },
    width: entranceWidth,
    height: entranceHeight,
    sillHeight: 0,
    inward: { x: 0, y: 0, z: -1 },
  });

  const baySill = Math.min(0.7, bounds.height * 0.2);
  const bayHeight = Math.min(2.2, bounds.height - baySill - 0.4);
  const innerPier = 0.2;
  const midPier = 0.3;
  const outerPier = Math.max(bounds.width * 0.045, 0.2);
  const bayRun = halfWidth - entranceWidth / 2 - innerPier - midPier - outerPier;
  const bayWidth = Math.max(Math.min(1.35, bayRun / 2), 0.5);
  const glazingZones = freezeList(
    Array.from({ length: 4 }, (_unused, index): ReservedZone => {
      const side = index < 2 ? -1 : 1;
      const order = index % 2;
      const innerEdge = entranceWidth / 2 + innerPier + order * (bayWidth + midPier);
      const centre = (innerEdge + bayWidth / 2) * side;
      return freezeRecord({
        id: `storefront-glazing-${index + 1}`,
        kind: 'glazing' as const,
        wall: 'front' as const,
        position: { x: centre, y: baySill + bayHeight / 2, z: halfDepth },
        width: bayWidth,
        height: bayHeight,
        sillHeight: baySill,
        inward: { x: 0, y: 0, z: -1 },
      });
    }),
  );

  /* -- wall mounts ---------------------------------------------------------- */

  const wallMounts: WallMountSurface[] = [];
  const posterHeight = 0.96;
  const posterWidth = 0.68;
  const posterHeightY = 1.62;
  const backWall = wallSurface(walls, 'back');
  const leftWall = wallSurface(walls, 'left');
  const rightWall = wallSurface(walls, 'right');
  const frontWall = wallSurface(walls, 'front');

  // Back wall, either side of the back room doorway.
  const backEdge = -halfWidth + 0.35;
  const backStopLeft = doorway.position.x - doorwayWidth / 2 - 0.3;
  const backMountSpan = Math.max(backStopLeft - backEdge, 0);
  const backMountCount = Math.min(3, Math.max(Math.floor(backMountSpan / 1.1), 1));
  for (let index = 0; index < backMountCount; index += 1) {
    const t = backMountCount === 1 ? 0.5 : index / (backMountCount - 1);
    wallMounts.push(
      freezeRecord<WallMountSurface>({
        id: `wall-mount-back-${index + 1}`,
        wall: 'back',
        position: {
          x: backEdge + backMountSpan * t,
          y: posterHeightY,
          z: backWall.center.z,
        },
        normal: backWall.inward,
        width: posterWidth,
        height: posterHeight,
        mountHeight: posterHeightY,
        purpose: 'poster',
      }),
    );
  }
  const backRightEdge = doorway.position.x + doorwayWidth / 2 + 0.3;
  if (halfWidth - 0.35 - backRightEdge > posterWidth) {
    wallMounts.push(
      freezeRecord<WallMountSurface>({
        id: 'wall-mount-back-menu',
        wall: 'back',
        position: { x: (backRightEdge + halfWidth - 0.35) / 2, y: posterHeightY, z: backWall.center.z },
        normal: backWall.inward,
        width: posterWidth,
        height: posterHeight,
        mountHeight: posterHeightY,
        purpose: 'poster',
      }),
    );
  }

  // Side walls: evenly spaced mounts from the counter end to the storefront.
  const sideInset = Math.min(1.9, halfDepth * 0.35);
  const sideCount = 4;
  const purposes: readonly WallMountPurpose[] = ['poster', 'menu', 'clock', 'mirror'];
  for (let index = 0; index < sideCount; index += 1) {
    const t = index / (sideCount - 1);
    const z = -halfDepth + sideInset + (bounds.depth - sideInset * 2) * t;
    wallMounts.push(
      freezeRecord<WallMountSurface>({
        id: `wall-mount-left-${index + 1}`,
        wall: 'left',
        position: { x: leftWall.center.x, y: posterHeightY, z },
        normal: leftWall.inward,
        width: posterWidth,
        height: posterHeight,
        mountHeight: posterHeightY,
        purpose: 'poster',
      }),
    );
    wallMounts.push(
      freezeRecord<WallMountSurface>({
        id: `wall-mount-right-${index + 1}`,
        wall: 'right',
        position: { x: rightWall.center.x, y: posterHeightY, z },
        normal: rightWall.inward,
        width: posterWidth,
        height: posterHeight,
        mountHeight: posterHeightY,
        purpose: purposes[index] ?? 'poster',
      }),
    );
  }

  // Storefront facade, above the glazing: the exterior signage bracket anchor.
  const signageHeight = SIGNAGE_MOUNT_HEIGHT;
  wallMounts.push(
    freezeRecord<WallMountSurface>({
      id: 'wall-mount-front-signage',
      wall: 'front',
      position: { x: 0, y: signageHeight, z: frontWall.center.z },
      normal: frontWall.inward,
      width: Math.min(bounds.width * 0.38, 3.4),
      height: 0.52,
      mountHeight: signageHeight,
      purpose: 'signage',
    }),
  );

  return freezeRecord<StructuralLayout>({
    bounds,
    floorHeight: WALKABLE_FLOOR_HEIGHT,
    wallThickness: WALL_THICKNESS,
    walls,
    tableSlots: freezeList(tableSlots),
    counter,
    counterPassSlots,
    serviceLane,
    wallMounts: freezeList(wallMounts),
    reservedZones: freezeList([doorway, entrance, ...glazingZones]),
    doorway,
    entrance,
    glazingZones,
  });
}

/** Structural anchor set of the café room. Frozen: every domain shares it. */
export const STRUCTURAL_LAYOUT: StructuralLayout = createStructuralLayout();

/** Floor rectangle the service lane occupies. */
export function serviceLaneRect(lane: ServiceLane): FloorRect {
  const halfWidth = lane.width / 2;
  return {
    minX: Math.min(lane.from.x, lane.to.x) - halfWidth,
    maxX: Math.max(lane.from.x, lane.to.x) + halfWidth,
    minZ: Math.min(lane.from.z, lane.to.z),
    maxZ: Math.max(lane.from.z, lane.to.z),
  };
}

/** Floor rectangle the counter zone occupies. */
export function counterRect(counter: CounterZone): FloorRect {
  return floorRect(counter.center, counter.width / 2, counter.depth / 2);
}

/** Looks up a table slot by its 1 based grid position. */
export function tableSlot(
  layout: StructuralLayout,
  column: number,
  row: number,
): TableSlot | undefined {
  return layout.tableSlots.find((slot) => slot.column === column && slot.row === row);
}

/** Looks up a reserved zone by id. */
export function reservedZone(layout: StructuralLayout, id: string): ReservedZone | undefined {
  return layout.reservedZones.find((zone) => zone.id === id);
}

/** Looks up a counter-pass slot by id. */
export function counterPassSlot(
  layout: StructuralLayout,
  id: string,
): CounterPassSlot | undefined {
  return layout.counterPassSlots.find((slot) => slot.id === id);
}

/** Wall mounts of one wall, optionally filtered by purpose. */
export function wallMountsOf(
  layout: StructuralLayout,
  wall: WallId,
  purpose?: WallMountPurpose,
): readonly WallMountSurface[] {
  return layout.wallMounts.filter(
    (mount) => mount.wall === wall && (purpose === undefined || mount.purpose === purpose),
  );
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Checks the layout invariants and returns one message per problem (an empty
 * array means the layout is sound). Consumers deriving a custom room can run
 * this before placing props; the module's tests run it on {@link STRUCTURAL_LAYOUT}.
 */
export function validateLayout(layout: StructuralLayout): readonly string[] {
  const problems: string[] = [];
  const { bounds } = layout;

  if (!(bounds.width > 0 && bounds.depth > 0 && bounds.height > 0)) {
    problems.push('room bounds must be positive in every axis');
  }
  if (layout.floorHeight !== WALKABLE_FLOOR_HEIGHT) {
    problems.push(`floor height must be ${WALKABLE_FLOOR_HEIGHT}, got ${layout.floorHeight}`);
  }
  if (layout.walls.length !== 4) {
    problems.push(`expected 4 walls, got ${layout.walls.length}`);
  }

  const lane = serviceLaneRect(layout.serviceLane);
  const counter = counterRect(layout.counter);

  if (layout.counter.surfaceHeight <= 0) {
    problems.push('counter surface height must be above the floor');
  }
  if (layout.counter.center.z - layout.counter.depth / 2 < -bounds.depth / 2 - 1e-9) {
    problems.push('counter extends through the back wall');
  }
  if (layout.counter.width > bounds.width) {
    problems.push('counter is wider than the room');
  }
  if (layout.serviceLane.width <= 0) {
    problems.push('service lane must have a positive width');
  }
  if (rectsOverlap(lane, counter)) {
    problems.push('service lane overlaps the counter zone');
  }
  if (layout.serviceLane.from.z <= layout.serviceLane.to.z) {
    problems.push('service lane must run from the entrance towards the counter');
  }

  const tableRects: { id: string; rect: FloorRect }[] = [];
  for (const slot of layout.tableSlots) {
    const rect = floorRect(slot.position, slot.clearance, slot.clearance);
    tableRects.push({ id: slot.id, rect });
    if (slot.position.y !== WALKABLE_FLOOR_HEIGHT) {
      problems.push(`${slot.id}: floor anchor must sit at floor height`);
    }
    if (slot.surfaceHeight <= 0 || slot.surfaceHeight > bounds.height) {
      problems.push(`${slot.id}: implausible surface height ${slot.surfaceHeight}`);
    }
    if (!pointInsideBounds(bounds, slot.position, slot.clearance)) {
      problems.push(`${slot.id}: clearance crosses the room envelope`);
    }
    if (rectsOverlap(rect, counter)) {
      problems.push(`${slot.id}: overlaps the counter zone`);
    }
    if (rectsOverlap(rect, lane)) {
      problems.push(`${slot.id}: blocks the service lane`);
    }
  }
  for (let a = 0; a < tableRects.length; a += 1) {
    for (let b = a + 1; b < tableRects.length; b += 1) {
      const left = tableRects[a];
      const right = tableRects[b];
      if (left && right && rectsOverlap(left.rect, right.rect)) {
        problems.push(`${left.id} and ${right.id} overlap`);
      }
    }
  }

  if (layout.counterPassSlots.length === 0) {
    problems.push('counter needs at least one pass slot');
  }
  for (const pass of layout.counterPassSlots) {
    if (Math.abs(pass.position.y - layout.counter.surfaceHeight) > 1e-9) {
      problems.push(`${pass.id}: pass slot must sit on the counter surface`);
    }
    if (Math.abs(pass.position.z - layout.counter.center.z) > 1e-9) {
      problems.push(`${pass.id}: pass slot must sit inside the counter footprint`);
    }
    const rect = floorRect(pass.position, pass.width / 2, pass.depth / 2);
    if (rect.minX < counter.minX - 1e-9 || rect.maxX > counter.maxX + 1e-9) {
      problems.push(`${pass.id}: pass slot overhangs the counter`);
    }
  }

  for (const mount of layout.wallMounts) {
    const wall = layout.walls.find((entry) => entry.id === mount.wall);
    if (!wall) {
      problems.push(`${mount.id}: unknown wall "${mount.wall}"`);
      continue;
    }
    const onPlane =
      wall.runAxis === 'x'
        ? Math.abs(mount.position.z - wall.center.z) < 1e-9
        : Math.abs(mount.position.x - wall.center.x) < 1e-9;
    if (!onPlane) {
      problems.push(`${mount.id}: mount is not on the ${mount.wall} wall plane`);
    }
    if (mount.normal.x !== wall.inward.x || mount.normal.y !== wall.inward.y || mount.normal.z !== wall.inward.z) {
      problems.push(`${mount.id}: mount normal does not face into the room`);
    }
    if (mount.mountHeight <= 0 || mount.mountHeight > bounds.height) {
      problems.push(`${mount.id}: mount height ${mount.mountHeight} is outside the room`);
    }
    if (mount.width <= 0 || mount.height <= 0) {
      problems.push(`${mount.id}: mount surface must have a positive size`);
    }
  }
  for (const wall of layout.walls) {
    if (wallMountsOf(layout, wall.id).length === 0) {
      problems.push(`no wall mount surface on the ${wall.id} wall`);
    }
  }

  if (layout.doorway.kind !== 'doorway' || layout.doorway.wall !== 'back') {
    problems.push('the back room doorway must be a doorway zone on the back wall');
  }
  if (layout.entrance.kind !== 'entrance' || layout.entrance.wall !== 'front') {
    problems.push('the entrance must be an entrance zone on the front wall');
  }
  if (layout.glazingZones.length < 2) {
    problems.push('storefront needs at least two glazing bays');
  }
  for (const zone of layout.reservedZones) {
    if (!pointInsideBounds(bounds, zone.position, 0)) {
      problems.push(`${zone.id}: reserved zone centre is outside the room`);
    }
    if (zone.sillHeight < 0 || zone.sillHeight + zone.height > bounds.height + 1e-9) {
      problems.push(`${zone.id}: reserved zone is taller than the storefront wall`);
    }
  }
  const entranceRect = floorRect(layout.entrance.position, layout.entrance.width / 2, 0.6);
  for (const entry of tableRects) {
    if (rectsOverlap(entry.rect, entranceRect)) {
      problems.push(`${entry.id}: blocks the storefront entrance`);
    }
  }

  return freezeList(problems);
}

/* -------------------------------------------------------------------------- */
/* Shell measurement                                                          */
/* -------------------------------------------------------------------------- */

/** True when every component of the bounds is finite and positive. */
export function roomBoundsFinite(bounds: RoomBounds): boolean {
  return (
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.depth) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.depth > 0 &&
    bounds.height > 0
  );
}

/** Compares two volumes, returning true when every axis matches within `tolerance`. */
export function roomBoundsEqual(a: RoomBounds, b: RoomBounds, tolerance = 1e-6): boolean {
  return (
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.depth - b.depth) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

/**
 * Measures the interior envelope of a built shell: the union of the structural
 * nodes (floor, four walls, ceiling). Returns `null` when the shell carries no
 * measurable structural node.
 */
export function measureShellEnvelope(
  root: THREE.Object3D,
  nodeNames: readonly string[] = SHELL_STRUCTURAL_NODE_NAMES,
): RoomBounds | null {
  if (nodeNames.length === 0) return null;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const nodeBox = new THREE.Box3();
  let found = false;
  root.traverse((object) => {
    if (!nodeNames.includes(object.name)) return;
    nodeBox.setFromObject(object);
    if (nodeBox.isEmpty()) return;
    if (
      !Number.isFinite(nodeBox.min.x) ||
      !Number.isFinite(nodeBox.min.y) ||
      !Number.isFinite(nodeBox.min.z) ||
      !Number.isFinite(nodeBox.max.x) ||
      !Number.isFinite(nodeBox.max.y) ||
      !Number.isFinite(nodeBox.max.z)
    ) {
      return;
    }
    box.union(nodeBox);
    found = true;
  });
  if (!found || box.isEmpty()) return null;
  return {
    width: box.max.x - box.min.x,
    depth: box.max.z - box.min.z,
    height: box.max.y - box.min.y,
  };
}

/** Lowest point of the shell floor plane, or `null` when it is missing. */
export function shellFloorHeight(root: THREE.Object3D, floorNode = SHELL_NODE_NAMES.floor): number | null {
  const floor = root.getObjectByName(floorNode);
  if (!floor) return null;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(floor);
  if (box.isEmpty() || !Number.isFinite(box.min.y)) return null;
  return box.min.y;
}
