/**
 * Chrono City — fixed city-block geometry.
 *
 * Every value in this module is an authored constant in metres, expressed in
 * the Three.js world frame the whole app shares: **+X east, +Z south, +Y up**.
 * The block is centred on the world origin, so navigation, streetscape, traffic
 * and pedestrian systems all derive their data from this single shared source
 * instead of re-deriving layout numbers.
 *
 * Half-extent cross-section, west → east (all values in metres):
 *
 *   -51      -43  -40            0            40  43      51
 *    |  road  | sidewalk |        block         | sidewalk |  road  |
 *    |  (8)   |   (3)    |     80 x 50 deep     |   (3)    |  (8)   |
 *
 *   * block      : the buildable lot, `|x| <= 40`, `|z| <= 25`
 *   * sidewalk   : the pedestrian band ringing the lot, 3 m wide
 *   * road ring  : 8 m asphalt ring around the sidewalk, split into two 4 m lanes
 *   * cell       : the whole layout, 102 x 72 m including the roads
 *   * crosswalks : one crossing per road leg at each block corner, connecting
 *                  the sidewalk ring to the cell perimeter
 *
 * Lifecycle:
 *   create    → the frozen geometry constants below.
 *   consume   → helpers (`isOnRoad`, `lanePoint`, `pointOnSidewalkLoop`, …).
 *   integrate → the streetscape / traffic / pedestrian tasks read `BlockLayout`.
 */

export const BLOCK_LAYOUT_VERSION = 1;

/** A point on the ground plane (the Y component is always 0 by convention). */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

/** The four corners of the block, named by compass direction. */
export type BlockCornerId = 'northWest' | 'northEast' | 'southEast' | 'southWest';

/** A compass side of the layout: the side of the block and the road along it. */
export type BlockSide = 'north' | 'south' | 'east' | 'west';

/** The world axis a road runs along, or a pedestrian walks along. */
export type RoadAxis = 'x' | 'z';

/* ------------------------------------------------------------------------- *
 * Authored metrics (metres)
 * ------------------------------------------------------------------------- */

/** Block footprint along X. */
export const BLOCK_WIDTH = 80;
/** Block footprint along Z. */
export const BLOCK_DEPTH = 50;
export const BLOCK_HALF_WIDTH = BLOCK_WIDTH / 2;
export const BLOCK_HALF_DEPTH = BLOCK_DEPTH / 2;

/** Width of the pedestrian band ringing the block. */
export const SIDEWALK_WIDTH = 3;
/** Width of the asphalt ring around the sidewalk. */
export const ROAD_WIDTH = 8;
export const ROAD_HALF_WIDTH = ROAD_WIDTH / 2;
/** Two lanes per road leg, one per travel direction. */
export const LANE_WIDTH = ROAD_WIDTH / 2;
/** Width of a zebra band, measured along the sidewalk it continues. */
export const CROSSWALK_WIDTH = 3;
/** Length of a zebra band, spanning the road it crosses. */
export const CROSSWALK_LENGTH = ROAD_WIDTH;

export const SIDEWALK_INNER_X = BLOCK_HALF_WIDTH;
export const SIDEWALK_OUTER_X = SIDEWALK_INNER_X + SIDEWALK_WIDTH;
export const SIDEWALK_INNER_Z = BLOCK_HALF_DEPTH;
export const SIDEWALK_OUTER_Z = SIDEWALK_INNER_Z + SIDEWALK_WIDTH;
/** Centre line of the sidewalk band (the natural pedestrian path). */
export const SIDEWALK_CENTER_X = (SIDEWALK_INNER_X + SIDEWALK_OUTER_X) / 2;
export const SIDEWALK_CENTER_Z = (SIDEWALK_INNER_Z + SIDEWALK_OUTER_Z) / 2;

export const ROAD_INNER_X = SIDEWALK_OUTER_X;
export const ROAD_OUTER_X = ROAD_INNER_X + ROAD_WIDTH;
export const ROAD_INNER_Z = SIDEWALK_OUTER_Z;
export const ROAD_OUTER_Z = ROAD_INNER_Z + ROAD_WIDTH;
/** Centre line of the north/south road legs. */
export const ROAD_CENTER_X = ROAD_INNER_X + ROAD_HALF_WIDTH;
/** Centre line of the east/west road legs. */
export const ROAD_CENTER_Z = ROAD_INNER_Z + ROAD_HALF_WIDTH;

/** Total layout size, including the road ring. */
export const CELL_HALF_WIDTH = ROAD_OUTER_X;
export const CELL_HALF_DEPTH = ROAD_OUTER_Z;
export const CELL_WIDTH = CELL_HALF_WIDTH * 2;
export const CELL_DEPTH = CELL_HALF_DEPTH * 2;

/* ------------------------------------------------------------------------- *
 * Areas
 * ------------------------------------------------------------------------- */

/** An axis-aligned ground rectangle. */
export interface RectExtents {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly width: number;
  readonly depth: number;
  readonly center: Vec2;
}

/** The buildable lot in the middle of the layout. */
export const BLOCK: RectExtents = {
  minX: -BLOCK_HALF_WIDTH,
  maxX: BLOCK_HALF_WIDTH,
  minZ: -BLOCK_HALF_DEPTH,
  maxZ: BLOCK_HALF_DEPTH,
  width: BLOCK_WIDTH,
  depth: BLOCK_DEPTH,
  center: { x: 0, z: 0 },
};

/** The pedestrian band: everything between the lot and the road ring. */
export interface SidewalkExtents {
  readonly width: number;
  readonly innerX: number;
  readonly outerX: number;
  readonly innerZ: number;
  readonly outerZ: number;
  /** Centre line of the band; pedestrians walk this loop. */
  readonly centerX: number;
  readonly centerZ: number;
  /** Rectangle traced by the block-facing edge of the band. */
  readonly inner: RectExtents;
  /** Rectangle traced by the road-facing edge of the band. */
  readonly outer: RectExtents;
  /** Length of the closed pedestrian loop around the block. */
  readonly loopLength: number;
}

/** Total length of the sidewalk loop (perimeter of the band centre line). */
export const SIDEWALK_LOOP_LENGTH = 4 * (SIDEWALK_CENTER_X + SIDEWALK_CENTER_Z);

export const SIDEWALK: SidewalkExtents = {
  width: SIDEWALK_WIDTH,
  innerX: SIDEWALK_INNER_X,
  outerX: SIDEWALK_OUTER_X,
  innerZ: SIDEWALK_INNER_Z,
  outerZ: SIDEWALK_OUTER_Z,
  centerX: SIDEWALK_CENTER_X,
  centerZ: SIDEWALK_CENTER_Z,
  inner: {
    minX: -SIDEWALK_INNER_X,
    maxX: SIDEWALK_INNER_X,
    minZ: -SIDEWALK_INNER_Z,
    maxZ: SIDEWALK_INNER_Z,
    width: SIDEWALK_INNER_X * 2,
    depth: SIDEWALK_INNER_Z * 2,
    center: { x: 0, z: 0 },
  },
  outer: {
    minX: -SIDEWALK_OUTER_X,
    maxX: SIDEWALK_OUTER_X,
    minZ: -SIDEWALK_OUTER_Z,
    maxZ: SIDEWALK_OUTER_Z,
    width: SIDEWALK_OUTER_X * 2,
    depth: SIDEWALK_OUTER_Z * 2,
    center: { x: 0, z: 0 },
  },
  loopLength: SIDEWALK_LOOP_LENGTH,
};

/** The asphalt ring around the sidewalk. */
export interface RoadRingExtents {
  readonly width: number;
  readonly halfWidth: number;
  readonly innerX: number;
  readonly outerX: number;
  readonly innerZ: number;
  readonly outerZ: number;
  readonly centerX: number;
  readonly centerZ: number;
}

export const ROAD_RING: RoadRingExtents = {
  width: ROAD_WIDTH,
  halfWidth: ROAD_HALF_WIDTH,
  innerX: ROAD_INNER_X,
  outerX: ROAD_OUTER_X,
  innerZ: ROAD_INNER_Z,
  outerZ: ROAD_OUTER_Z,
  centerX: ROAD_CENTER_X,
  centerZ: ROAD_CENTER_Z,
};

/** The whole layout, roads included. */
export interface CellExtents {
  readonly width: number;
  readonly depth: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export const CELL: CellExtents = {
  width: CELL_WIDTH,
  depth: CELL_DEPTH,
  halfWidth: CELL_HALF_WIDTH,
  halfDepth: CELL_HALF_DEPTH,
  minX: -CELL_HALF_WIDTH,
  maxX: CELL_HALF_WIDTH,
  minZ: -CELL_HALF_DEPTH,
  maxZ: CELL_HALF_DEPTH,
};

/* ------------------------------------------------------------------------- *
 * Road ring
 * ------------------------------------------------------------------------- */

/** One driving lane of a road leg. */
export interface RoadLane {
  /** Stable id, e.g. `north-lane-east`. */
  readonly id: string;
  /** `+1` travels towards `RoadSegment.end`, `-1` towards `start`. */
  readonly direction: 1 | -1;
  /** Signed offset of the lane centre from the road centre line. */
  readonly offset: number;
  /** Compass heading of travel along this lane. */
  readonly heading: BlockSide;
}

/** One leg of the road ring. */
export interface RoadSegment {
  readonly id: BlockSide;
  /** Axis the leg runs along. */
  readonly axis: RoadAxis;
  /** Fixed cross-axis coordinate of the leg's centre line. */
  readonly center: number;
  /** Fixed cross-axis coordinate of the block-facing asphalt edge. */
  readonly innerEdge: number;
  /** Fixed cross-axis coordinate of the outer asphalt edge. */
  readonly outerEdge: number;
  /** Coordinate along `axis` where the leg begins. */
  readonly start: number;
  /** Coordinate along `axis` where the leg ends. */
  readonly end: number;
  readonly length: number;
  /** Two lanes, right-hand traffic. */
  readonly lanes: readonly RoadLane[];
}

const LANE_OFFSET = LANE_WIDTH / 2;

function buildRoadSegment(side: BlockSide): RoadSegment {
  const axis: RoadAxis = side === 'north' || side === 'south' ? 'x' : 'z';
  const sign = side === 'north' || side === 'west' ? -1 : 1;
  const alongX = axis === 'x';

  const center = sign * (alongX ? ROAD_CENTER_Z : ROAD_CENTER_X);
  const innerEdge = sign * (alongX ? ROAD_INNER_Z : ROAD_INNER_X);
  const outerEdge = sign * (alongX ? ROAD_OUTER_Z : ROAD_OUTER_X);
  const start = -(alongX ? CELL_HALF_WIDTH : CELL_HALF_DEPTH);
  const end = alongX ? CELL_HALF_WIDTH : CELL_HALF_DEPTH;

  // Right-hand traffic: a vehicle keeps to its right, so travelling with the
  // axis (+1) puts the lane towards +Z on an east/west leg and towards -X on a
  // north/south leg.
  const lanes: RoadLane[] =
    axis === 'x'
      ? [
          { id: `${side}-lane-east`, direction: 1, offset: LANE_OFFSET, heading: 'east' },
          { id: `${side}-lane-west`, direction: -1, offset: -LANE_OFFSET, heading: 'west' },
        ]
      : [
          { id: `${side}-lane-south`, direction: 1, offset: -LANE_OFFSET, heading: 'south' },
          { id: `${side}-lane-north`, direction: -1, offset: LANE_OFFSET, heading: 'north' },
        ];

  return {
    id: side,
    axis,
    center,
    innerEdge,
    outerEdge,
    start,
    end,
    length: end - start,
    lanes,
  };
}

/** The four legs of the road ring, ordered north → east → south → west. */
export const ROADS: readonly RoadSegment[] = (['north', 'east', 'south', 'west'] as const).map(
  buildRoadSegment,
);

/* ------------------------------------------------------------------------- *
 * Corners, intersections and crosswalks
 * ------------------------------------------------------------------------- */

export interface BlockCorner {
  readonly id: BlockCornerId;
  /** Sidewalk kerb corner where the two sidewalk strips meet. */
  readonly point: Vec2;
  /** Centre of the ring intersection beside this corner. */
  readonly intersection: Vec2;
}

/** The four block corners, ordered north-west → north-east → south-east → south-west. */
export const BLOCK_CORNERS: readonly BlockCorner[] = [
  {
    id: 'northWest',
    point: { x: -SIDEWALK_OUTER_X, z: -SIDEWALK_OUTER_Z },
    intersection: { x: -ROAD_CENTER_X, z: -ROAD_CENTER_Z },
  },
  {
    id: 'northEast',
    point: { x: SIDEWALK_OUTER_X, z: -SIDEWALK_OUTER_Z },
    intersection: { x: ROAD_CENTER_X, z: -ROAD_CENTER_Z },
  },
  {
    id: 'southEast',
    point: { x: SIDEWALK_OUTER_X, z: SIDEWALK_OUTER_Z },
    intersection: { x: ROAD_CENTER_X, z: ROAD_CENTER_Z },
  },
  {
    id: 'southWest',
    point: { x: -SIDEWALK_OUTER_X, z: SIDEWALK_OUTER_Z },
    intersection: { x: -ROAD_CENTER_X, z: ROAD_CENTER_Z },
  },
];

/** The four ring intersections, keyed by their adjacent block corner. */
export interface BlockIntersection {
  readonly id: BlockCornerId;
  readonly center: Vec2;
}

export const INTERSECTIONS: readonly BlockIntersection[] = BLOCK_CORNERS.map((corner) => ({
  id: corner.id,
  center: corner.intersection,
}));

/**
 * A zebra crossing over one road leg.
 *
 * The band continues the sidewalk strip it belongs to: `near` sits on the
 * sidewalk ring the pedestrian starts from, `far` sits on the outer cell kerb
 * the walk ends at, and `center` is the middle of the road.
 */
export interface CrosswalkAnchor {
  /** Stable id, e.g. `northEast-cross-east`. */
  readonly id: string;
  /** Block corner this crossing serves. */
  readonly corner: BlockCornerId;
  /** Road leg being crossed. */
  readonly road: BlockSide;
  /** Axis the pedestrian walks along while crossing. */
  readonly axis: RoadAxis;
  /** Band centre, on the road centre line. */
  readonly center: Vec2;
  /** Kerb point on the block sidewalk ring (walk start). */
  readonly near: Vec2;
  /** Kerb point on the cell perimeter (walk end). */
  readonly far: Vec2;
  /** Span across the road (`CROSSWALK_LENGTH`). */
  readonly length: number;
  /** Band width along the sidewalk direction (`CROSSWALK_WIDTH`). */
  readonly width: number;
  /** Y rotation that turns a band whose long axis is +X into this crossing. */
  readonly rotationY: number;
}

function buildCrosswalks(): CrosswalkAnchor[] {
  const anchors: CrosswalkAnchor[] = [];

  for (const corner of BLOCK_CORNERS) {
    const sx = corner.point.x < 0 ? -1 : 1;
    const sz = corner.point.z < 0 ? -1 : 1;

    // Crossing the east/west leg: the band continues the north/south sidewalk
    // strip, so it is offset inwards from the intersection by half its width.
    anchors.push({
      id: `${corner.id}-cross-${sx > 0 ? 'east' : 'west'}`,
      corner: corner.id,
      road: sx > 0 ? 'east' : 'west',
      axis: 'x',
      center: { x: sx * ROAD_CENTER_X, z: sz * (ROAD_INNER_Z - CROSSWALK_WIDTH / 2) },
      near: { x: sx * ROAD_INNER_X, z: sz * (ROAD_INNER_Z - CROSSWALK_WIDTH / 2) },
      far: { x: sx * ROAD_OUTER_X, z: sz * (ROAD_INNER_Z - CROSSWALK_WIDTH / 2) },
      length: CROSSWALK_LENGTH,
      width: CROSSWALK_WIDTH,
      rotationY: 0,
    });

    // Crossing the north/south leg: the band continues the east/west strip.
    anchors.push({
      id: `${corner.id}-cross-${sz < 0 ? 'north' : 'south'}`,
      corner: corner.id,
      road: sz < 0 ? 'north' : 'south',
      axis: 'z',
      center: { x: sx * (ROAD_INNER_X - CROSSWALK_WIDTH / 2), z: sz * ROAD_CENTER_Z },
      near: { x: sx * (ROAD_INNER_X - CROSSWALK_WIDTH / 2), z: sz * ROAD_INNER_Z },
      far: { x: sx * (ROAD_INNER_X - CROSSWALK_WIDTH / 2), z: sz * ROAD_OUTER_Z },
      length: CROSSWALK_LENGTH,
      width: CROSSWALK_WIDTH,
      rotationY: Math.PI / 2,
    });
  }

  return anchors;
}

/** Eight crossings: two per block corner, one per adjacent road leg. */
export const CROSSWALK_ANCHORS: readonly CrosswalkAnchor[] = buildCrosswalks();

/**
 * Closed pedestrian loop around the block, walking the sidewalk centre line.
 * Ordered clockwise in the XZ plane starting at the north-east corner, with an
 * extra waypoint at each edge midpoint so travellers can be placed smoothly.
 */
export const SIDEWALK_LOOP: readonly Vec2[] = [
  { x: SIDEWALK_CENTER_X, z: -SIDEWALK_CENTER_Z },
  { x: SIDEWALK_CENTER_X, z: 0 },
  { x: SIDEWALK_CENTER_X, z: SIDEWALK_CENTER_Z },
  { x: 0, z: SIDEWALK_CENTER_Z },
  { x: -SIDEWALK_CENTER_X, z: SIDEWALK_CENTER_Z },
  { x: -SIDEWALK_CENTER_X, z: 0 },
  { x: -SIDEWALK_CENTER_X, z: -SIDEWALK_CENTER_Z },
  { x: 0, z: -SIDEWALK_CENTER_Z },
];

/* ------------------------------------------------------------------------- *
 * Queries
 * ------------------------------------------------------------------------- */

/** `true` when the point falls inside the buildable lot. */
export function isInsideBlock(point: Vec2, margin = 0): boolean {
  return (
    Math.abs(point.x) <= BLOCK_HALF_WIDTH + margin && Math.abs(point.z) <= BLOCK_HALF_DEPTH + margin
  );
}

/** `true` when the point falls on the pedestrian band ringing the block. */
export function isOnSidewalk(point: Vec2): boolean {
  const withinOuter =
    Math.abs(point.x) <= SIDEWALK_OUTER_X && Math.abs(point.z) <= SIDEWALK_OUTER_Z;
  const withinInner =
    Math.abs(point.x) <= SIDEWALK_INNER_X && Math.abs(point.z) <= SIDEWALK_INNER_Z;
  return withinOuter && !withinInner;
}

/** `true` when the point falls on the asphalt ring (intersections included). */
export function isOnRoad(point: Vec2): boolean {
  const withinCell =
    Math.abs(point.x) <= CELL_HALF_WIDTH && Math.abs(point.z) <= CELL_HALF_DEPTH;
  return withinCell && !isInsideBlock(point) && !isOnSidewalk(point);
}

/** `true` when the point falls inside any zebra band. */
export function isOnCrosswalk(point: Vec2, tolerance = 0): boolean {
  return CROSSWALK_ANCHORS.some((anchor) => {
    const halfLength = anchor.length / 2 + tolerance;
    const halfWidth = anchor.width / 2 + tolerance;
    const alongX = anchor.axis === 'x';
    const across = alongX ? point.z - anchor.center.z : point.x - anchor.center.x;
    const along = alongX ? point.x - anchor.center.x : point.z - anchor.center.z;
    return Math.abs(across) <= halfWidth && Math.abs(along) <= halfLength;
  });
}

/** Road leg lookup by compass side. */
export function roadSegment(side: BlockSide): RoadSegment {
  const segment = ROADS.find((candidate) => candidate.id === side);
  if (!segment) throw new RangeError(`Unknown road side ${side}`);
  return segment;
}

/** Block corner lookup by id. */
export function cornerById(id: BlockCornerId): BlockCorner {
  const corner = BLOCK_CORNERS.find((candidate) => candidate.id === id);
  if (!corner) throw new RangeError(`Unknown block corner ${id}`);
  return corner;
}

/** The two crossings that belong to a corner. */
export function crosswalksAtCorner(id: BlockCornerId): readonly CrosswalkAnchor[] {
  return CROSSWALK_ANCHORS.filter((anchor) => anchor.corner === id);
}

/**
 * World position on the sidewalk loop `t` turns around the block
 * (`0` = north-east corner, values wrap for `t` outside `[0, 1)`).
 */
export function pointOnSidewalkLoop(t: number): Vec2 {
  const normalised = ((t % 1) + 1) % 1;
  let remaining = normalised * SIDEWALK_LOOP_LENGTH;

  for (let index = 0; index < SIDEWALK_LOOP.length; index += 1) {
    const from = SIDEWALK_LOOP[index];
    const to = SIDEWALK_LOOP[(index + 1) % SIDEWALK_LOOP.length];
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    if (remaining <= distance || index === SIDEWALK_LOOP.length - 1) {
      const ratio = distance === 0 ? 0 : remaining / distance;
      return { x: from.x + (to.x - from.x) * ratio, z: from.z + (to.z - from.z) * ratio };
    }
    remaining -= distance;
  }

  const first = SIDEWALK_LOOP[0];
  return { x: first.x, z: first.z };
}

/**
 * World position on a lane, `along` metres from the start of the leg (clamped to
 * the leg length).
 */
export function lanePoint(segment: RoadSegment, lane: RoadLane, along: number): Vec2 {
  const clamped = Math.min(Math.max(along, 0), segment.length);
  const alongValue = segment.start + clamped;
  const crossValue = segment.center + lane.offset;
  return segment.axis === 'x' ? { x: alongValue, z: crossValue } : { x: crossValue, z: alongValue };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Frozen aggregate of the whole layout plus its query helpers — the handle every
 * later system imports.
 */
export const BlockLayout = deepFreeze({
  version: BLOCK_LAYOUT_VERSION,
  block: BLOCK,
  sidewalk: SIDEWALK,
  roadRing: ROAD_RING,
  cell: CELL,
  roads: ROADS,
  crosswalks: CROSSWALK_ANCHORS,
  sidewalkLoop: SIDEWALK_LOOP,
  sidewalkLoopLength: SIDEWALK_LOOP_LENGTH,
  corners: BLOCK_CORNERS,
  intersections: INTERSECTIONS,
  isInsideBlock,
  isOnSidewalk,
  isOnRoad,
  isOnCrosswalk,
  roadSegment,
  cornerById,
  crosswalksAtCorner,
  pointOnSidewalkLoop,
  lanePoint,
});
