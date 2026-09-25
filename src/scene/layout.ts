/**
 * Deterministic, renderer-independent world-space contract for Chrono City's
 * single dense neighborhood block. Coordinates are metres on the X/Z ground
 * plane (Y is elevation); consumers can convert these lightweight records to
 * their own rendering or simulation types.
 */

/** Lightweight world-space vector; deliberately does not depend on Three.js. */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Axis-aligned ground footprint dimensions in world units. */
export interface Footprint {
  /** Extent along world X. */
  readonly width: number;
  /** Extent along world Z. */
  readonly depth: number;
}

export type CardinalSide = "north" | "east" | "south" | "west";

export interface Bounds2D {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface CityBlock {
  readonly id: string;
  readonly name: string;
  /** Ground-plane extents; origin is the block centre. */
  readonly bounds: Bounds2D;
  readonly center: WorldPoint;
}

export interface Curb {
  readonly id: string;
  readonly side: CardinalSide;
  readonly position: WorldPoint;
  readonly length: number;
  readonly height: number;
  readonly width: number;
}

export interface Sidewalk {
  readonly id: string;
  readonly side: CardinalSide;
  /** Inner or outer edge of the perimeter street. */
  readonly edge: "inner" | "outer";
  readonly center: WorldPoint;
  readonly width: number;
  readonly length: number;
}

export interface Crosswalk {
  readonly id: string;
  readonly streetSide: CardinalSide;
  /** Center of the marked crossing, in world coordinates. */
  readonly center: WorldPoint;
  /** Width across the street and length along the street. */
  readonly width: number;
  readonly length: number;
  readonly stripeCount: number;
  readonly stripeWidth: number;
}

export interface PerimeterStreet {
  readonly id: string;
  readonly side: CardinalSide;
  readonly center: WorldPoint;
  readonly length: number;
  readonly width: number;
  readonly speedLimitKph: number;
  readonly curbs: readonly [Curb, Curb];
  readonly sidewalks: readonly [Sidewalk, Sidewalk];
  readonly crosswalkIds: readonly string[];
}

export interface BuildingLot {
  readonly id: string;
  readonly name: string;
  /** The street this frontage addresses; includes the block's inner frontage. */
  readonly streetSide: CardinalSide;
  readonly frontage: "inner" | "outer";
  readonly center: WorldPoint;
  readonly footprint: Footprint;
  readonly bounds: Bounds2D;
  /** Unit ground-plane vector pointing from the lot toward its street. */
  readonly facing: Readonly<{ x: number; z: number }>;
  readonly frontageWidth: number;
  readonly zone: "mixed-use" | "residential" | "commercial" | "civic";
}

export interface LaneWaypoint {
  readonly order: number;
  readonly position: WorldPoint;
  readonly speedKph: number;
  readonly action: "cruise" | "turn";
}

export interface VehicleLaneLoop {
  readonly id: string;
  readonly name: string;
  readonly direction: "clockwise" | "counterclockwise";
  readonly closed: true;
  /** Ordered center-line waypoints, with the first point repeated at the end. */
  readonly waypoints: readonly LaneWaypoint[];
}

export interface PedestrianPath {
  readonly id: string;
  readonly name: string;
  readonly kind: "sidewalk-loop" | "crossing";
  readonly crosswalkId?: string;
  /** Ordered world-space ground route. Closed loops repeat their start point. */
  readonly waypoints: readonly WorldPoint[];
  readonly closed: boolean;
}

export type PropSlotType = "lamp" | "tree" | "bench" | "hydrant" | "bus-stop" | "signage";
export type SignageSlotKind = "advertisement" | "street-name" | "wayfinding";

export interface AnchorTransform {
  readonly position: WorldPoint;
  /** Euler rotation in radians. */
  readonly rotation: Readonly<{ x: number; y: number; z: number }>;
  readonly scale: Readonly<{ x: number; y: number; z: number }>;
}

export interface PropSlot {
  readonly id: string;
  readonly type: PropSlotType;
  readonly anchor: AnchorTransform;
  readonly streetSide: CardinalSide;
  readonly sidewalkEdge: "inner" | "outer";
  readonly signageKind?: SignageSlotKind;
  /** Nominal display size, only populated on dedicated ad placements. */
  readonly displaySize?: Readonly<{ width: number; height: number }>;
}

export interface CameraLandmark {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly position: WorldPoint;
  readonly target: WorldPoint;
}

export interface CityLayout {
  readonly units: "metres";
  readonly block: CityBlock;
  readonly streets: readonly PerimeterStreet[];
  readonly crosswalks: readonly Crosswalk[];
  readonly lots: readonly BuildingLot[];
  readonly vehicleLanes: readonly VehicleLaneLoop[];
  readonly pedestrianPaths: readonly PedestrianPath[];
  readonly propSlots: readonly PropSlot[];
  readonly cameraLandmarks: readonly CameraLandmark[];
}

const ground = (x: number, z: number, y = 0): WorldPoint => ({ x, y, z });
const boundsAt = (x: number, z: number, width: number, depth: number): Bounds2D => ({
  minX: x - width / 2,
  maxX: x + width / 2,
  minZ: z - depth / 2,
  maxZ: z + depth / 2,
});

/** Ground-plane extents of the single central city block. */
export const BLOCK_HALF_EXTENT = 18;
/** Four 8 m streets make a clear perimeter with a 3 m sidewalk on each side. */
export const STREET_WIDTH = 8;
export const STREET_CENTER_OFFSET = 22;
export const SIDEWALK_WIDTH = 3;
export const INNER_SIDEWALK_OFFSET = 16.5;
export const OUTER_SIDEWALK_OFFSET = 28;

export const CENTRAL_BLOCK: CityBlock = {
  id: "central-block",
  name: "Chrono City Central Block",
  bounds: { minX: -BLOCK_HALF_EXTENT, maxX: BLOCK_HALF_EXTENT, minZ: -BLOCK_HALF_EXTENT, maxZ: BLOCK_HALF_EXTENT },
  center: ground(0, 0),
};

const SIDE_CONFIG: Readonly<Record<CardinalSide, {
  readonly center: WorldPoint;
  readonly tangentLength: number;
  readonly innerCurb: WorldPoint;
  readonly outerCurb: WorldPoint;
  readonly innerWalk: WorldPoint;
  readonly outerWalk: WorldPoint;
}>> = {
  north: {
    center: ground(0, -STREET_CENTER_OFFSET), tangentLength: 60,
    innerCurb: ground(0, -18), outerCurb: ground(0, -26),
    innerWalk: ground(0, -INNER_SIDEWALK_OFFSET), outerWalk: ground(0, -OUTER_SIDEWALK_OFFSET),
  },
  east: {
    center: ground(STREET_CENTER_OFFSET, 0), tangentLength: 60,
    innerCurb: ground(18, 0), outerCurb: ground(26, 0),
    innerWalk: ground(INNER_SIDEWALK_OFFSET, 0), outerWalk: ground(OUTER_SIDEWALK_OFFSET, 0),
  },
  south: {
    center: ground(0, STREET_CENTER_OFFSET), tangentLength: 60,
    innerCurb: ground(0, 18), outerCurb: ground(0, 26),
    innerWalk: ground(0, INNER_SIDEWALK_OFFSET), outerWalk: ground(0, OUTER_SIDEWALK_OFFSET),
  },
  west: {
    center: ground(-STREET_CENTER_OFFSET, 0), tangentLength: 60,
    innerCurb: ground(-18, 0), outerCurb: ground(-26, 0),
    innerWalk: ground(-INNER_SIDEWALK_OFFSET, 0), outerWalk: ground(-OUTER_SIDEWALK_OFFSET, 0),
  },
};

export const CROSSWALKS: readonly Crosswalk[] = (["north", "east", "south", "west"] as const).map((side) => {
  const center = side === "north" ? ground(0, -STREET_CENTER_OFFSET)
    : side === "east" ? ground(STREET_CENTER_OFFSET, 0)
      : side === "south" ? ground(0, STREET_CENTER_OFFSET)
        : ground(-STREET_CENTER_OFFSET, 0);
  return {
    id: `${side}-crosswalk`, streetSide: side, center,
    width: STREET_WIDTH, length: 5, stripeCount: 7, stripeWidth: 0.42,
  };
});

export const PERIMETER_STREETS: readonly PerimeterStreet[] = (["north", "east", "south", "west"] as const).map((side) => {
  const config = SIDE_CONFIG[side];
  const curb = (edge: "inner" | "outer", position: WorldPoint): Curb => ({
    id: `${side}-${edge}-curb`, side, position, length: config.tangentLength, height: 0.16, width: 0.24,
  });
  const sidewalk = (edge: "inner" | "outer", center: WorldPoint): Sidewalk => ({
    id: `${side}-${edge}-sidewalk`, side, edge, center, width: SIDEWALK_WIDTH, length: config.tangentLength,
  });
  return {
    id: `${side}-street`, side, center: config.center, length: config.tangentLength,
    width: STREET_WIDTH,
    speedLimitKph: 30,
    curbs: [curb("inner", config.innerCurb), curb("outer", config.outerCurb)],
    sidewalks: [sidewalk("inner", config.innerWalk), sidewalk("outer", config.outerWalk)],
    crosswalkIds: [`${side}-crosswalk`],
  };
});

function createLot(
  id: string,
  side: CardinalSide,
  frontage: BuildingLot["frontage"],
  x: number,
  z: number,
  width: number,
  depth: number,
  zone: BuildingLot["zone"],
): BuildingLot {
  const outward = side === "north" ? { x: 0, z: -1 }
    : side === "east" ? { x: 1, z: 0 }
      : side === "south" ? { x: 0, z: 1 }
        : { x: -1, z: 0 };
  // Inner facades look outward to the perimeter road; outer parcels look
  // inward, so both frontage rings address the same street corridor.
  const streetward = frontage === "inner" ? 1 : -1;
  const facing = { x: outward.x * streetward, z: outward.z * streetward };
  return {
    id, name: id.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    streetSide: side, frontage, center: ground(x, z), footprint: { width, depth },
    bounds: boundsAt(x, z, width, depth), facing,
    frontageWidth: side === "east" || side === "west" ? depth : width,
    zone,
  };
}

const OUTER_TANGENTS = [-13.5, -4.5, 4.5, 13.5] as const;
const lotSet: BuildingLot[] = [];
for (const side of ["north", "east", "south", "west"] as const) {
  for (const [index, tangent] of OUTER_TANGENTS.entries()) {
    const id = `${side}-outer-${index + 1}`;
    const x = side === "east" ? 34 : side === "west" ? -34 : tangent;
    const z = side === "south" ? 34 : side === "north" ? -34 : tangent;
    lotSet.push(createLot(id, side, "outer", x, z, 8, 8, index === 1 ? "commercial" : "mixed-use"));
  }
}
// One generous inner frontage on each face leaves a connected courtyard plaza.
lotSet.push(
  createLot("north-inner-civic", "north", "inner", 0, -10.5, 12, 6, "civic"),
  createLot("east-inner-market", "east", "inner", 10.5, 0, 6, 12, "commercial"),
  createLot("south-inner-hall", "south", "inner", 0, 10.5, 12, 6, "residential"),
  createLot("west-inner-arcade", "west", "inner", -10.5, 0, 6, 12, "commercial"),
);
export const BUILDING_LOTS: readonly BuildingLot[] = lotSet;

/** Build axis-aligned clockwise/counter-clockwise perimeter driving circuits. */
function createLaneLoop(
  id: string,
  name: string,
  direction: VehicleLaneLoop["direction"],
  offset: number,
): VehicleLaneLoop {
  const clockwise = [
    ground(-offset, -offset), ground(offset, -offset), ground(offset, offset), ground(-offset, offset), ground(-offset, -offset),
  ];
  const points = direction === "clockwise" ? clockwise : [...clockwise].reverse();
  return {
    id, name, direction, closed: true,
    waypoints: points.map((position, index) => ({
      order: index, position, speedKph: 20, action: index === 0 || index === points.length - 1 ? "cruise" : "turn",
    })),
  };
}

export const VEHICLE_LANE_LOOPS: readonly VehicleLaneLoop[] = [
  createLaneLoop("traffic-clockwise", "Clockwise perimeter lane", "clockwise", 20.8),
  createLaneLoop("traffic-counterclockwise", "Counter-clockwise perimeter lane", "counterclockwise", 23.2),
];

const innerLoop: readonly WorldPoint[] = [
  ground(-INNER_SIDEWALK_OFFSET, -INNER_SIDEWALK_OFFSET),
  ground(INNER_SIDEWALK_OFFSET, -INNER_SIDEWALK_OFFSET),
  ground(INNER_SIDEWALK_OFFSET, INNER_SIDEWALK_OFFSET),
  ground(-INNER_SIDEWALK_OFFSET, INNER_SIDEWALK_OFFSET),
  ground(-INNER_SIDEWALK_OFFSET, -INNER_SIDEWALK_OFFSET),
];
const crossingEndpoints: Readonly<Record<CardinalSide, readonly [WorldPoint, WorldPoint]>> = {
  north: [ground(0, -INNER_SIDEWALK_OFFSET), ground(0, -OUTER_SIDEWALK_OFFSET)],
  east: [ground(INNER_SIDEWALK_OFFSET, 0), ground(OUTER_SIDEWALK_OFFSET, 0)],
  south: [ground(0, INNER_SIDEWALK_OFFSET), ground(0, OUTER_SIDEWALK_OFFSET)],
  west: [ground(-INNER_SIDEWALK_OFFSET, 0), ground(-OUTER_SIDEWALK_OFFSET, 0)],
};

export const PEDESTRIAN_PATHS: readonly PedestrianPath[] = [
  { id: "central-sidewalk-circuit", name: "Central block sidewalk circuit", kind: "sidewalk-loop", waypoints: innerLoop, closed: true },
  ...(["north", "east", "south", "west"] as const).map((side): PedestrianPath => ({
    id: `${side}-crossing-path`, name: `${side[0]!.toUpperCase()}${side.slice(1)} street crossing`,
    kind: "crossing", crosswalkId: `${side}-crosswalk`, waypoints: crossingEndpoints[side], closed: false,
  })),
];

function makeAnchor(x: number, z: number, yaw = 0, y = 0): AnchorTransform {
  return {
    position: ground(x, z, y), rotation: { x: 0, y: yaw, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  };
}

const propSlots: PropSlot[] = [];
const sides = ["north", "east", "south", "west"] as const;
for (const [sideIndex, side] of sides.entries()) {
  const normalSign = side === "north" || side === "west" ? -1 : 1;
  const verticalStreet = side === "east" || side === "west";
  const yaw = side === "north" ? 0 : side === "east" ? Math.PI / 2 : side === "south" ? Math.PI : -Math.PI / 2;
  for (const edge of ["inner", "outer"] as const) {
    const normal = edge === "inner" ? INNER_SIDEWALK_OFFSET : OUTER_SIDEWALK_OFFSET;
    const sidewalkPositions = [-24, -8, 8, 24];
    for (const [index, tangent] of sidewalkPositions.entries()) {
      const x = verticalStreet ? normal * normalSign : tangent;
      const z = verticalStreet ? tangent : normal * normalSign;
      const types: readonly PropSlotType[] = ["lamp", "tree", "bench", "hydrant"];
      const type = types[(index + sideIndex + (edge === "outer" ? 1 : 0)) % types.length]!;
      propSlots.push({
        id: `${side}-${edge}-${type}-${index + 1}`, type, anchor: makeAnchor(x, z, yaw),
        streetSide: side, sidewalkEdge: edge,
      });
    }
    if (edge === "outer") {
      propSlots.push({
        id: `${side}-outer-bus-stop`, type: "bus-stop",
        anchor: makeAnchor(verticalStreet ? normal * normalSign : -8, verticalStreet ? -8 : normal * normalSign, yaw),
        streetSide: side, sidewalkEdge: edge,
      });
      // Four dedicated, billboard-sized ad anchors per facade: 16 placements total.
      for (let index = 0; index < 4; index += 1) {
        const tangent = -18 + index * 12;
        const x = verticalStreet ? normal * normalSign : tangent;
        const z = verticalStreet ? tangent : normal * normalSign;
        propSlots.push({
          id: `${side}-ad-sign-${index + 1}`, type: "signage", signageKind: "advertisement",
          anchor: makeAnchor(x, z, yaw, 2.8), streetSide: side, sidewalkEdge: edge,
          displaySize: { width: 2.4, height: 3.2 },
        });
      }
      propSlots.push({
        id: `${side}-street-name-sign`, type: "signage", signageKind: "street-name",
        anchor: makeAnchor(verticalStreet ? normal * normalSign : 25, verticalStreet ? 25 : normal * normalSign, yaw, 3.1),
        streetSide: side, sidewalkEdge: edge,
      });
    }
  }
}
export const PROP_SLOTS: readonly PropSlot[] = propSlots;

export const CAMERA_LANDMARKS: readonly CameraLandmark[] = [
  { id: "aerial-overview", name: "Aerial Overview", description: "Elevated view across the complete block and all four streets.", position: ground(47, 58, 58), target: ground(0, 0, 3) },
  { id: "northwest-corner", name: "Northwest Corner", description: "Street-level look toward the central plaza from the northwest.", position: ground(-36, -36, 9), target: ground(0, 0, 3) },
  { id: "northeast-corner", name: "Northeast Corner", description: "Street-level look across the east and north frontages.", position: ground(37, -35, 10), target: ground(0, 0, 4) },
  { id: "south-market", name: "South Market", description: "Approach the market-facing south street frontage.", position: ground(5, 40, 7), target: ground(0, 10, 3) },
  { id: "west-arcade", name: "West Arcade", description: "Frame the west inner arcade and its surrounding sidewalks.", position: ground(-37, 2, 8), target: ground(-9, 0, 4) },
  { id: "east-boulevard", name: "East Boulevard", description: "View the bus stop and east-side commercial frontage.", position: ground(42, 5, 10), target: ground(12, 0, 5) },
  { id: "courtyard", name: "Central Courtyard", description: "Close-up view into the open courtyard between inner lots.", position: ground(7, -9, 15), target: ground(0, 0, 0) },
  { id: "southwest-corner", name: "Southwest Corner", description: "Look diagonally across the southwest neighborhood corner.", position: ground(-37, 38, 12), target: ground(0, 0, 4) },
];

/** Canonical shared layout consumed by scene, navigation and placement systems. */
export const CITY_LAYOUT: CityLayout = {
  units: "metres",
  block: CENTRAL_BLOCK,
  streets: PERIMETER_STREETS,
  crosswalks: CROSSWALKS,
  lots: BUILDING_LOTS,
  vehicleLanes: VEHICLE_LANE_LOOPS,
  pedestrianPaths: PEDESTRIAN_PATHS,
  propSlots: PROP_SLOTS,
  cameraLandmarks: CAMERA_LANDMARKS,
};
