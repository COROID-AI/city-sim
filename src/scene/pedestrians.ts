/**
 * Chrono City pedestrians: era-dressed figures that walk the layout's
 * sidewalks and cross its crosswalks.
 *
 * The module owns three things:
 *
 * 1. **Routing** — {@link buildWalkNetwork} turns the shared `CITY_LAYOUT`
 *    pedestrian paths into walkable routes: the closed inner-sidewalk circuit
 *    plus four crossing excursions that detour over a marked crosswalk and
 *    back. Every vertex comes from the layout contract, so a figure can never
 *    wander into a building footprint or a traffic lane.
 * 2. **Figures** — each pedestrian is one procedural low-poly rig whose every
 *    dimension, accessory and fabric is driven by a flat numeric parameter set
 *    (`FigureRigParams`). Morphing eras is therefore a numeric blend, not a
 *    rebuild: nothing is added, removed or leaked while the timeline moves.
 * 3. **The scene system** — a `SceneSystem`/`EraAware` handle with `update`,
 *    `applyEra`, `getPickables` and `dispose`, so scene assembly can mount it,
 *    pump the shared fixed-step loop and tear it down without special cases.
 *
 * Era density, walking speed, stride, crowd grouping and gadget use all come
 * from the frozen era contract via `resolveEraWeights`, and the crowd size is
 * continuous: the figure straddling the density boundary grows or fades in
 * rather than popping.
 */

import * as THREE from "three";

import {
  ERA_IDS,
  clampBlend,
  getEraConfig,
  resolveEraWeights,
  type EraId,
  type EraSceneSystem,
  type EraUpdateContext,
} from "../era/eraTypes";
import {
  CITY_LAYOUT,
  SIDEWALK_WIDTH,
  type CityLayout,
  type Crosswalk,
  type PedestrianPath,
  type WorldPoint,
} from "./layout";
import {
  ACCESSORY_SLOTS,
  AGE_SPEED_FACTOR,
  FABRIC_TEXTURE_SIZE,
  SLOT_WEIGHT_KEYS,
  blendAppearances,
  createFabricTextureSet,
  describeLook,
  deterministicSample,
  pickAgeBracket,
  resolveFigureAppearance,
  type AccessorySlot,
  type AgeBracket,
  type FabricSpec,
  type FabricTextureSet,
  type FigureAppearance,
  type FigureColors,
  type FigureRigParams,
  type PedestrianLookSummary,
  type ResolvedAccessory,
} from "./pedestrianOutfits";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Stable system id used by picking and debug overlays. */
export const PEDESTRIAN_SYSTEM_ID = "pedestrians";
/** Name of the system root group. */
export const PEDESTRIAN_GROUP_NAME = "pedestrian-crowd";
/** Inset kept between a walker and the sidewalk edge, in metres. */
export const SIDEWALK_MARGIN = 0.35;
/** Inset kept between a walker and the crosswalk edge, in metres. */
export const CROSSWALK_MARGIN = 0.5;
/** Distance at which walkers stop walking into each other, in metres. */
export const MIN_FIGURE_SEPARATION = 0.55;
/** Start of the spacing-avoidance look-ahead cone, in metres. */
export const STOP_DISTANCE = 0.75;
/** End of the spacing-avoidance look-ahead cone, in metres. */
export const LOOKAHEAD_DISTANCE = 2.4;
/** Lateral distance under which two walkers are treated as a queue, in metres. */
export const LATERAL_CLEARANCE = 0.75;
/** Largest sideways sidestep a walker takes to get around someone, in metres. */
export const MAX_SIDESTEP = 0.7;
/** Extra corridor room a walker may use to squeeze past someone, in metres. */
export const CORRIDOR_TOLERANCE = 0.15;
/** Full-body amplitude of one walking cycle for a 1 m stride, in metres. */
export const BASE_STRIDE_LENGTH = 1.45;
/** Fractions of the crowd routed over a crosswalk rather than round the loop. */
export const CROSSING_ROUTE_SHARE = 0.45;
/** Presence weight below which a rig part is hidden entirely. */
export const HIDDEN_WEIGHT_EPSILON = 0.02;
/** Smallest sideways offset a walker keeps from its route centreline. */
export const MIN_LATERAL_OFFSET = 0.45;
/** Nominal adult height the rig is authored at, in metres. */
export const RIG_NOMINAL_HEIGHT = 1.72;

const TWO_PI = Math.PI * 2;

/** Rig proportions shared by every figure, in metres at a 1.72 m stature. */
const BODY = {
  hipHeight: 0.94,
  pelvisHeight: 0.17,
  thighLength: 0.46,
  shinLength: 0.44,
  upperArmLength: 0.29,
  forearmLength: 0.26,
  shoulderRise: 0.42,
  chestRise: 0.02,
  neckRise: 0.55,
  neckLength: 0.09,
  headRise: 0.11,
  headRadius: 0.105,
  legSpread: 0.098,
} as const;

/* -------------------------------------------------------------------------- */
/* Walk network                                                               */
/* -------------------------------------------------------------------------- */

/** Which kind of layout corridor a route sample sits in. */
export type RouteCorridor = "sidewalk" | "crosswalk";

/** One vertex of a walkable route, straight from the layout contract. */
export interface WalkRouteVertex {
  readonly x: number;
  readonly z: number;
  /** Half-width of walkable ground around this vertex, in metres. */
  readonly corridorHalfWidth: number;
  readonly corridor: RouteCorridor;
  /** Id of the `CITY_LAYOUT` pedestrian path this vertex came from. */
  readonly sourcePathId: string;
}

/** A walkable route: the sidewalk circuit, or the circuit plus a crossing. */
export interface WalkRoute {
  readonly id: string;
  readonly name: string;
  readonly kind: "sidewalk-loop" | "crossing-excursion";
  readonly crosswalkId: string | null;
  readonly closed: boolean;
  readonly vertices: readonly WalkRouteVertex[];
  /** Cumulative arc length at each vertex; last entry is the total length. */
  readonly cumulative: readonly number[];
  readonly length: number;
  /** Arc-length window spent crossing the street, if this route crosses. */
  readonly crossingWindow: readonly [number, number] | null;
}

/** The complete walkable network derived from the layout contract. */
export interface WalkNetwork {
  readonly layout: CityLayout;
  readonly routes: readonly WalkRoute[];
  /** Closed sidewalk-loop length in metres: the era density basis. */
  readonly sidewalkLength: number;
  readonly totalLength: number;
}

/** One sampled point on a route, with its local frame. */
export interface WalkRouteSample {
  readonly x: number;
  readonly z: number;
  /** Yaw for `Object3D.rotation.y`; forward is `(sin, cos)`. */
  readonly heading: number;
  readonly normalX: number;
  readonly normalZ: number;
  readonly corridor: RouteCorridor;
  readonly corridorHalfWidth: number;
  readonly lateralLimit: number;
  readonly lateral: number;
}

function clampRange(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return value < min ? min : value > max ? max : value;
}

/** Drops the repeated closing vertex of a closed layout loop. */
function openLoop(points: readonly WorldPoint[]): readonly WorldPoint[] {
  if (points.length > 1) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first.x === last.x && first.z === last.z) {
      return points.slice(0, -1);
    }
  }
  return points;
}

function toVertex(point: WorldPoint, halfWidth: number, corridor: RouteCorridor, pathId: string): WalkRouteVertex {
  return { x: point.x, z: point.z, corridorHalfWidth: halfWidth, corridor, sourcePathId: pathId };
}

/** Ground-plane point: everything routing needs to know about a position. */
interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

/** True when `point` lies strictly inside the axis-aligned segment `a -> b`. */
function segmentContains(a: GroundPoint, b: GroundPoint, point: GroundPoint): boolean {
  const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
  if (Math.abs(cross) > 1e-6) {
    return false;
  }
  const dot = (point.x - a.x) * (b.x - a.x) + (point.z - a.z) * (b.z - a.z);
  const lengthSquared = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
  return dot > 1e-6 && dot < lengthSquared - 1e-6;
}

function createRoute(
  id: string,
  name: string,
  kind: WalkRoute["kind"],
  crosswalkId: string | null,
  closed: boolean,
  vertices: readonly WalkRouteVertex[],
  crossingWindow: readonly [number, number] | null,
): WalkRoute {
  const cumulative: number[] = [0];
  const segmentCount = closed ? vertices.length : Math.max(0, vertices.length - 1);
  for (let index = 0; index < segmentCount; index += 1) {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % vertices.length]!;
    cumulative.push(cumulative[index]! + Math.hypot(end.x - start.x, end.z - start.z));
  }
  return {
    id,
    name,
    kind,
    crosswalkId,
    closed,
    vertices,
    cumulative,
    length: cumulative[cumulative.length - 1] ?? 0,
    crossingWindow,
  };
}

/**
 * Builds the walkable network from the layout's pedestrian paths.
 *
 * The inner sidewalk loop becomes a closed circuit. Each marked crossing
 * becomes an excursion route: the same circuit with an out-and-back spur
 * inserted at the loop edge the crossing anchors to, so pedestrians really do
 * step off the kerb, cross on the stripes and return.
 */
export function buildWalkNetwork(layout: CityLayout = CITY_LAYOUT): WalkNetwork {
  const loopPath = layout.pedestrianPaths.find((path) => path.kind === "sidewalk-loop" && path.closed);
  if (!loopPath) {
    throw new Error("Chrono City layout exposes no closed sidewalk loop for pedestrians.");
  }
  const sidewalkHalfWidth = SIDEWALK_WIDTH / 2 - SIDEWALK_MARGIN;
  const loopVertices = openLoop(loopPath.waypoints).map((point) =>
    toVertex(point, sidewalkHalfWidth, "sidewalk", loopPath.id),
  );
  const routes: WalkRoute[] = [
    createRoute("sidewalk-circuit", loopPath.name, "sidewalk-loop", null, true, loopVertices, null),
  ];

  const crossings = layout.pedestrianPaths.filter((path) => path.kind === "crossing");
  for (const crossing of crossings) {
    const route = createCrossingRoute(crossing, layout, loopVertices, sidewalkHalfWidth);
    if (route) {
      routes.push(route);
    }
  }

  const totalLength = routes.reduce((total, route) => total + route.length, 0);
  return {
    layout,
    routes,
    sidewalkLength: routes[0]!.length,
    totalLength,
  };
}

function createCrossingRoute(
  crossing: PedestrianPath,
  layout: CityLayout,
  loopVertices: readonly WalkRouteVertex[],
  sidewalkHalfWidth: number,
): WalkRoute | null {
  const crosswalk: Crosswalk | undefined = layout.crosswalks.find(
    (candidate) => candidate.id === crossing.crosswalkId,
  );
  const inner = crossing.waypoints[0];
  const outer = crossing.waypoints[crossing.waypoints.length - 1];
  if (!crosswalk || !inner || !outer) {
    return null;
  }
  const crossHalfWidth = Math.max(0.4, crosswalk.length / 2 - CROSSWALK_MARGIN);

  for (let index = 0; index < loopVertices.length; index += 1) {
    const start = loopVertices[index]!;
    const end = loopVertices[(index + 1) % loopVertices.length]!;
    if (!segmentContains(start, end, inner)) {
      continue;
    }
    const anchor = toVertex(inner, sidewalkHalfWidth, "sidewalk", crossing.id);
    const spine = toVertex(outer, crossHalfWidth, "crosswalk", crossing.id);
    const vertices: WalkRouteVertex[] = [
      ...loopVertices.slice(0, index + 1),
      anchor,
      spine,
      anchor,
      ...loopVertices.slice(index + 1),
    ];
    // Arc length of the spur: walk the built vertex list up to the anchor, then
    // out over the crossing and back.
    let travelled = 0;
    let crossingStart = 0;
    let crossingEnd = 0;
    for (let vertex = 1; vertex < vertices.length; vertex += 1) {
      const previous = vertices[vertex - 1]!;
      const current = vertices[vertex]!;
      travelled += Math.hypot(current.x - previous.x, current.z - previous.z);
      if (vertex === index + 1) {
        crossingStart = travelled;
      }
      if (vertex === index + 3) {
        crossingEnd = travelled;
      }
    }
    return createRoute(
      `${crossing.id}-excursion`,
      `${crossing.name} excursion`,
      "crossing-excursion",
      crosswalk.id,
      true,
      vertices,
      [crossingStart, crossingEnd],
    );
  }
  return null;
}

/** Samples a route at `distance` metres with a lateral offset in metres. */
export function sampleWalkRoute(route: WalkRoute, distance: number, lateral = 0): WalkRouteSample {
  const length = route.length;
  const wrapped = route.closed && length > 0 ? ((distance % length) + length) % length : clampRange(distance, 0, length);
  const segmentCount = route.closed ? route.vertices.length : Math.max(1, route.vertices.length - 1);
  let segment = 0;
  while (segment < segmentCount - 1 && route.cumulative[segment + 1]! <= wrapped) {
    segment += 1;
  }
  const start = route.vertices[segment]!;
  const end = route.vertices[(segment + 1) % route.vertices.length]!;
  const segmentStart = route.cumulative[segment]!;
  const span = Math.max(1e-6, route.cumulative[segment + 1]! - segmentStart);
  const t = clampRange((wrapped - segmentStart) / span, 0, 1);
  const centreX = start.x + (end.x - start.x) * t;
  const centreZ = start.z + (end.z - start.z) * t;
  const directionX = (end.x - start.x) / span;
  const directionZ = (end.z - start.z) / span;
  const corridor: RouteCorridor = start.corridor === "crosswalk" || end.corridor === "crosswalk" ? "crosswalk" : "sidewalk";
  const corridorHalfWidth = start.corridorHalfWidth + (end.corridorHalfWidth - start.corridorHalfWidth) * t;
  const offset = clampRange(lateral, -corridorHalfWidth - CORRIDOR_TOLERANCE, corridorHalfWidth + CORRIDOR_TOLERANCE);
  const normalX = -directionZ;
  const normalZ = directionX;
  return {
    x: centreX + normalX * offset,
    z: centreZ + normalZ * offset,
    heading: Math.atan2(directionX, directionZ),
    normalX,
    normalZ,
    corridor,
    corridorHalfWidth,
    lateralLimit: corridorHalfWidth,
    lateral: offset,
  };
}

/** Sidewalk length a density figure is spread over: one closed circuit. */
export function walkableSidewalkLength(layout: CityLayout = CITY_LAYOUT): number {
  return buildWalkNetwork(layout).sidewalkLength;
}

/**
 * Figures that `per100m` pedestrians per 100 m of sidewalk implies.
 *
 * The era contract's `density` is the input, unchanged: the crowd is exactly as
 * dense as the stop it is in. Those densities are not monotonic with the
 * timeline (2005 is the busiest stop, 1945 by far the quietest), so the crowd
 * follows the descriptor rather than an assumed trend.
 */
export function planPopulation(per100m: number, sidewalkLength: number): number {
  const safeDensity = Number.isFinite(per100m) && per100m > 0 ? per100m : 0;
  const safeLength = Number.isFinite(sidewalkLength) && sidewalkLength > 0 ? sidewalkLength : 0;
  return (safeDensity * safeLength) / 100;
}

/* -------------------------------------------------------------------------- */
/* Walk cycle                                                                 */
/* -------------------------------------------------------------------------- */

/** Limb and body state of one walking figure; refreshed every frame. */
export interface WalkCycleState {
  /** Cycle phase in radians. */
  readonly phase: number;
  readonly leftLegSwing: number;
  readonly rightLegSwing: number;
  readonly leftArmSwing: number;
  readonly rightArmSwing: number;
  readonly leftKneeBend: number;
  readonly rightKneeBend: number;
  /** Head pitch bobbing, in radians. */
  readonly headBob: number;
  /** Hip rise and fall, in metres. */
  readonly hipBob: number;
  /** Counter-rotation of the shoulders against the hips, in radians. */
  readonly torsoTwist: number;
  /** Metres covered by one full two-step cycle. */
  readonly strideLength: number;
}

/**
 * Derives the counter-swinging walk cycle for a phase.
 *
 * Arms swing opposite their same-side leg (`leftArmSwing` is the negation of
 * `leftLegSwing`), knees bend only on the recovery half, and the head bobs at
 * twice the stride frequency.
 */
export function computeWalkCycle(phase: number, strideLength: number): WalkCycleState {
  const swing = Math.sin(phase);
  const counter = Math.cos(phase);
  return {
    phase,
    leftLegSwing: swing * 0.62,
    rightLegSwing: -swing * 0.62,
    leftArmSwing: -swing * 0.5,
    rightArmSwing: swing * 0.5,
    leftKneeBend: Math.max(0, -Math.sin(phase + 0.7)) * 0.55,
    rightKneeBend: Math.max(0, -Math.sin(phase + Math.PI + 0.7)) * 0.55,
    headBob: Math.sin(phase * 2) * 0.035,
    hipBob: Math.abs(swing) * 0.028,
    torsoTwist: counter * 0.07,
    strideLength,
  };
}

/** Mutable form of {@link WalkCycleState}, updated in place each frame. */
type MutableWalkCycle = { -readonly [Key in keyof WalkCycleState]: WalkCycleState[Key] };

/* -------------------------------------------------------------------------- */
/* Resource ledger                                                            */
/* -------------------------------------------------------------------------- */

/** Live and disposed GPU resource counts, for leak assertions and HUD debug. */
export interface PedestrianResourceCounts {
  readonly geometries: number;
  readonly materials: number;
  readonly textures: number;
  readonly meshes: number;
  readonly disposedGeometries: number;
  readonly disposedMaterials: number;
  readonly disposedTextures: number;
}

/** Owns every GPU resource the system creates, so teardown is exhaustive. */
interface ResourceLedger {
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  readonly textures: THREE.Texture[];
  trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T;
  trackMaterial<T extends THREE.Material>(material: T): T;
  trackTexture<T extends THREE.Texture>(texture: T): T;
  counts(meshes: number): PedestrianResourceCounts;
  disposeAll(): void;
}

function createResourceLedger(): ResourceLedger {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();
  return {
    geometries,
    materials,
    textures,
    trackGeometry(geometry) {
      geometries.push(geometry);
      return geometry;
    },
    trackMaterial(material) {
      materials.push(material);
      return material;
    },
    trackTexture(texture) {
      textures.push(texture);
      return texture;
    },
    counts(meshes) {
      return {
        geometries: geometries.length,
        materials: materials.length,
        textures: textures.length,
        meshes,
        disposedGeometries: disposedGeometries.size,
        disposedMaterials: disposedMaterials.size,
        disposedTextures: disposedTextures.size,
      };
    },
    disposeAll() {
      for (const geometry of geometries) {
        if (!disposedGeometries.has(geometry)) {
          disposedGeometries.add(geometry);
          geometry.dispose();
        }
      }
      for (const material of materials) {
        if (!disposedMaterials.has(material)) {
          disposedMaterials.add(material);
          material.dispose();
        }
      }
      for (const texture of textures) {
        if (!disposedTextures.has(texture)) {
          disposedTextures.add(texture);
          texture.dispose();
        }
      }
    },
  };
}

/** Shared unit primitives: every rig part is one of these, scaled. */
export interface RigGeometryLibrary {
  readonly box: THREE.BufferGeometry;
  readonly cylinder: THREE.BufferGeometry;
  readonly taper: THREE.BufferGeometry;
  readonly sphere: THREE.BufferGeometry;
  readonly capsule: THREE.BufferGeometry;
}

function createGeometryLibrary(ledger: ResourceLedger): RigGeometryLibrary {
  return {
    box: ledger.trackGeometry(new THREE.BoxGeometry(1, 1, 1)),
    cylinder: ledger.trackGeometry(new THREE.CylinderGeometry(1, 1, 1, 10)),
    taper: ledger.trackGeometry(new THREE.CylinderGeometry(0.62, 1, 1, 10)),
    sphere: ledger.trackGeometry(new THREE.SphereGeometry(1, 12, 8)),
    capsule: ledger.trackGeometry(new THREE.CapsuleGeometry(1, 1, 4, 8)),
  };
}

/* -------------------------------------------------------------------------- */
/* Rig                                                                        */
/* -------------------------------------------------------------------------- */

/** Materials owned by one figure; recoloured in place as eras change. */
export interface RigMaterials {
  readonly skin: THREE.MeshStandardMaterial;
  readonly hand: THREE.MeshStandardMaterial;
  readonly hair: THREE.MeshStandardMaterial;
  readonly armWear: THREE.MeshStandardMaterial;
  readonly legWear: THREE.MeshStandardMaterial;
  readonly garment: THREE.MeshStandardMaterial;
  readonly garmentOverlay: THREE.MeshStandardMaterial;
  readonly garmentAlt: THREE.MeshStandardMaterial;
  readonly garmentAltOverlay: THREE.MeshStandardMaterial;
  readonly accent: THREE.MeshStandardMaterial;
  readonly headwear: THREE.MeshStandardMaterial;
  readonly bag: THREE.MeshStandardMaterial;
  readonly bagAccent: THREE.MeshStandardMaterial;
  readonly metal: THREE.MeshStandardMaterial;
  readonly eye: THREE.MeshStandardMaterial;
  readonly lens: THREE.MeshStandardMaterial;
  readonly shoe: THREE.MeshStandardMaterial;
  readonly sole: THREE.MeshStandardMaterial;
  readonly overlayer: THREE.MeshStandardMaterial;
  readonly carried: THREE.MeshStandardMaterial;
  readonly support: THREE.MeshStandardMaterial;
}

/** One garment layer: its own fabric, and the meshes it covers. */
export interface GarmentLayer {
  /** 0 or 1; layer 0 is the outgoing era, layer 1 the incoming one. */
  readonly index: number;
  readonly material: THREE.MeshStandardMaterial;
  readonly overlayMaterial: THREE.MeshStandardMaterial;
  readonly meshes: readonly THREE.Mesh[];
  /** Skirt/coat panel of the layer, swayed by the walk cycle. */
  readonly hem: THREE.Mesh;
  readonly overlay: THREE.Mesh;
  /** Era-blend weight in `0..1`; 0 hides the whole layer. */
  weight: number;
  /** Fabric currently bound to the layer's materials, if any. */
  fabricId: string | null;
}

/** Leg chain: hip pivot, knee pivot and ankle/shoe. */
export interface RigLeg {
  readonly hip: THREE.Group;
  readonly thigh: THREE.Mesh;
  readonly knee: THREE.Group;
  readonly shin: THREE.Mesh;
  readonly ankle: THREE.Group;
  readonly foot: THREE.Mesh;
  readonly shoe: THREE.Mesh;
  readonly sole: THREE.Mesh;
}

/** Arm chain, including the hand props (device, wrist tech, cane). */
export interface RigArm {
  readonly shoulder: THREE.Group;
  readonly upper: THREE.Mesh;
  readonly elbow: THREE.Group;
  readonly fore: THREE.Mesh;
  readonly hand: THREE.Group;
  readonly palm: THREE.Mesh;
  readonly wrist: THREE.Group;
  readonly wristBand: THREE.Mesh;
  readonly wristFace: THREE.Mesh;
  readonly carried: THREE.Group;
  readonly carriedBody: THREE.Mesh;
  readonly carriedScreen: THREE.Mesh;
  readonly cane: THREE.Group;
  readonly caneShaft: THREE.Mesh;
  readonly caneHandle: THREE.Mesh;
}

/** Every named detail mesh on a figure. */
export interface RigParts {
  readonly pelvis: THREE.Mesh;
  readonly torso: THREE.Mesh;
  readonly belt: THREE.Mesh;
  readonly shoulderLeft: THREE.Mesh;
  readonly shoulderRight: THREE.Mesh;
  readonly neck: THREE.Mesh;
  readonly head: THREE.Group;
  readonly skull: THREE.Mesh;
  readonly nose: THREE.Mesh;
  readonly eyeLeft: THREE.Mesh;
  readonly eyeRight: THREE.Mesh;
  readonly hairBase: THREE.Mesh;
  readonly hairVolume: THREE.Mesh;
  readonly hairTail: THREE.Mesh;
  readonly hairFringe: THREE.Mesh;
  readonly hat: THREE.Group;
  readonly hatCrown: THREE.Mesh;
  readonly hatBrim: THREE.Mesh;
  readonly hatBand: THREE.Mesh;
  readonly hatPeak: THREE.Mesh;
  readonly hatVeil: THREE.Mesh;
  readonly eyewear: THREE.Group;
  readonly eyewearFrame: THREE.Mesh;
  readonly eyewearLensLeft: THREE.Mesh;
  readonly eyewearLensRight: THREE.Mesh;
  readonly audio: THREE.Group;
  readonly audioPodLeft: THREE.Mesh;
  readonly audioPodRight: THREE.Mesh;
  readonly audioBand: THREE.Mesh;
  readonly neckwear: THREE.Group;
  readonly neckBand: THREE.Mesh;
  readonly neckPendant: THREE.Mesh;
  readonly bag: THREE.Group;
  readonly bagBody: THREE.Mesh;
  readonly bagFlap: THREE.Mesh;
  readonly bagStrap: THREE.Mesh;
  readonly bagHandle: THREE.Mesh;
  readonly overlayer: THREE.Group;
  readonly overlayerShell: THREE.Mesh;
  readonly overlayerCollar: THREE.Mesh;
  readonly hem: THREE.Mesh;
}

/** A complete figure rig plus its morph bookkeeping. */
export interface PedestrianRig {
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  readonly hips: THREE.Group;
  readonly chest: THREE.Group;
  readonly parts: RigParts;
  readonly legs: readonly [RigLeg, RigLeg];
  readonly arms: readonly [RigArm, RigArm];
  readonly layers: readonly [GarmentLayer, GarmentLayer];
  /** The materials by role, so colour grading never hard-codes an index. */
  readonly materialSet: RigMaterials;
  readonly materials: readonly THREE.MeshStandardMaterial[];
  /** Parts whose scale is `shape * weight`, flushed after every look change. */
  readonly weighted: readonly THREE.Object3D[];
  /** Detail meshes in the rig; constant for the lifetime of the figure. */
  readonly meshCount: number;
  /** Height in metres once the current look is applied. */
  height: number;
}

const SHAPE_KEY = "pedestrianShape";
const WEIGHT_KEY = "pedestrianWeight";
const OPACITY_KEY = "pedestrianOpacity";

/** Records the shape a part wants, and how present it currently is. */
function setPartShape(object: THREE.Object3D, weight: number, x: number, y: number, z: number): void {
  object.userData[SHAPE_KEY] = [x, y, z];
  object.userData[WEIGHT_KEY] = weight;
}

/** Overrides only the presence weight of an already-shaped part. */
function setPartWeight(object: THREE.Object3D, weight: number): void {
  object.userData[WEIGHT_KEY] = weight;
}

function setMaterialOpacity(material: THREE.MeshStandardMaterial, opacity: number): void {
  material.userData[OPACITY_KEY] = opacity;
}

/** Applies every pending shape/weight pair: scale to nothing means "hidden". */
function flushRigWeights(rig: PedestrianRig): void {
  for (const object of rig.weighted) {
    const shape = object.userData[SHAPE_KEY] as [number, number, number] | undefined;
    if (!shape) {
      continue;
    }
    const weight = clampRange((object.userData[WEIGHT_KEY] as number | undefined) ?? 1, 0, 1);
    object.visible = weight > HIDDEN_WEIGHT_EPSILON;
    object.scale.set(shape[0] * weight, shape[1] * weight, shape[2] * weight);
  }
}

/** Folds crowd activation into every material's opacity. */
function applyRigActivation(rig: PedestrianRig, activation: number): void {
  const clamped = clampRange(activation, 0, 1);
  rig.root.visible = clamped > HIDDEN_WEIGHT_EPSILON;
  for (const material of rig.materials) {
    const base = (material.userData[OPACITY_KEY] as number | undefined) ?? 1;
    const opacity = clampRange(base * clamped, 0, 1);
    material.opacity = opacity;
    material.transparent = opacity < 0.999;
  }
}

function createRigMaterial(
  ledger: ResourceLedger,
  color: number,
  options: { roughness: number; metalness: number; transparent?: boolean; depthWrite?: boolean },
): THREE.MeshStandardMaterial {
  return ledger.trackMaterial(
    new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness,
      metalness: options.metalness,
      transparent: options.transparent ?? false,
      depthWrite: options.depthWrite ?? true,
      side: THREE.FrontSide,
    }),
  );
}

function createRigMaterials(ledger: ResourceLedger, colors: FigureColors): RigMaterials {
  const cloth = { roughness: 0.85, metalness: 0.04 };
  const soft = { roughness: 0.72, metalness: 0.02 };
  const skin = ledger.trackMaterial(new THREE.MeshStandardMaterial({ color: colors.skin, roughness: 0.68, metalness: 0 }));
  return {
    skin,
    hand: ledger.trackMaterial(new THREE.MeshStandardMaterial({ color: colors.skin, roughness: 0.68, metalness: 0 })),
    hair: createRigMaterial(ledger, colors.hair, { roughness: 0.55, metalness: 0.05 }),
    armWear: createRigMaterial(ledger, colors.garment, soft),
    legWear: createRigMaterial(ledger, colors.trousers, cloth),
    garment: createRigMaterial(ledger, colors.garment, cloth),
    garmentOverlay: createRigMaterial(ledger, colors.garment, {
      roughness: 0.7,
      metalness: 0.05,
      transparent: true,
      depthWrite: false,
    }),
    garmentAlt: createRigMaterial(ledger, colors.garment, cloth),
    garmentAltOverlay: createRigMaterial(ledger, colors.garment, {
      roughness: 0.7,
      metalness: 0.05,
      transparent: true,
      depthWrite: false,
    }),
    accent: createRigMaterial(ledger, colors.garmentAccent, { roughness: 0.5, metalness: 0.18 }),
    headwear: createRigMaterial(ledger, colors.headwear, cloth),
    bag: createRigMaterial(ledger, colors.bag, { roughness: 0.62, metalness: 0.08 }),
    bagAccent: createRigMaterial(ledger, colors.garmentAccent, { roughness: 0.45, metalness: 0.22 }),
    metal: createRigMaterial(ledger, colors.metal, { roughness: 0.32, metalness: 0.75 }),
    eye: createRigMaterial(ledger, colors.eye, { roughness: 0.35, metalness: 0 }),
    lens: createRigMaterial(ledger, colors.lens, { roughness: 0.18, metalness: 0.4 }),
    shoe: createRigMaterial(ledger, colors.footwear, { roughness: 0.6, metalness: 0.06 }),
    sole: createRigMaterial(ledger, 0x1b1d21, { roughness: 0.9, metalness: 0.02 }),
    overlayer: createRigMaterial(ledger, colors.garmentAccent, { roughness: 0.55, metalness: 0.14 }),
    carried: createRigMaterial(ledger, colors.metal, { roughness: 0.42, metalness: 0.35 }),
    support: createRigMaterial(ledger, colors.support, { roughness: 0.58, metalness: 0.12 }),
  };
}

/**
 * Builds one pedestrian rig.
 *
 * Every mesh is created once and never replaced: the era look only rewrites
 * scales, positions, rotations, colours and texture references, which is what
 * makes `applyEra` continuous and leak-free.
 */
export function createPedestrianRig(
  ledger: ResourceLedger,
  geometry: RigGeometryLibrary,
  colors: FigureColors,
): PedestrianRig {
  const materials = createRigMaterials(ledger, colors);
  const weighted: THREE.Object3D[] = [];
  const materialList: THREE.MeshStandardMaterial[] = Object.values(materials);
  let meshCount = 0;

  const part = (
    geometryKey: keyof RigGeometryLibrary,
    material: THREE.Material,
    name: string,
    parent: THREE.Object3D,
    castsShadow = false,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry[geometryKey], material);
    mesh.name = name;
    mesh.castShadow = castsShadow;
    parent.add(mesh);
    weighted.push(mesh);
    meshCount += 1;
    return mesh;
  };

  const group = (name: string, parent: THREE.Object3D): THREE.Group => {
    const node = new THREE.Group();
    node.name = name;
    parent.add(node);
    return node;
  };

  const root = new THREE.Group();
  root.name = "pedestrian";
  const body = group("body", root);
  const hips = group("hips", body);
  hips.position.y = BODY.hipHeight;
  const chest = group("chest", hips);
  chest.position.y = BODY.chestRise;

  const pelvis = part("box", materials.legWear, "pelvis", hips, true);
  setPartShape(pelvis, 1, 0.3, BODY.pelvisHeight, 0.2);
  const torso = part("box", materials.skin, "torso", chest, true);
  setPartShape(torso, 1, 0.3, 0.52, 0.2);
  const belt = part("cylinder", materials.accent, "belt", chest);
  setPartShape(belt, 1, 0.31, 0.055, 0.21);
  const shoulderLeft = part("sphere", materials.skin, "shoulder-left", chest, true);
  const shoulderRight = part("sphere", materials.skin, "shoulder-right", chest, true);
  const neck = part("cylinder", materials.skin, "neck", chest);
  setPartShape(neck, 1, 0.05, BODY.neckLength, 0.05);
  const head = group("head", chest);
  const skull = part("sphere", materials.skin, "skull", head, true);
  const nose = part("box", materials.skin, "nose", head);
  const eyeLeft = part("sphere", materials.eye, "eye-left", head);
  const eyeRight = part("sphere", materials.eye, "eye-right", head);

  const hairBase = part("sphere", materials.hair, "hair-base", head);
  const hairVolume = part("sphere", materials.hair, "hair-volume", head);
  const hairFringe = part("box", materials.hair, "hair-fringe", head);
  const hairTail = part("capsule", materials.hair, "hair-tail", head);

  const hat = group("hat", head);
  const hatCrown = part("sphere", materials.headwear, "hat-crown", hat);
  const hatBrim = part("cylinder", materials.headwear, "hat-brim", hat);
  const hatBand = part("cylinder", materials.accent, "hat-band", hat);
  const hatPeak = part("box", materials.headwear, "hat-peak", hat);
  const hatVeil = part("box", materials.headwear, "hat-veil", hat);

  const eyewear = group("eyewear", head);
  const eyewearFrame = part("box", materials.lens, "eyewear-frame", eyewear);
  const eyewearLensLeft = part("box", materials.lens, "eyewear-lens-left", eyewear);
  const eyewearLensRight = part("box", materials.lens, "eyewear-lens-right", eyewear);

  const audio = group("audio", head);
  const audioPodLeft = part("sphere", materials.metal, "audio-pod-left", audio);
  const audioPodRight = part("sphere", materials.metal, "audio-pod-right", audio);
  const audioBand = part("box", materials.metal, "audio-band", audio);

  const neckwear = group("neckwear", chest);
  const neckBand = part("cylinder", materials.accent, "neck-band", neckwear);
  const neckPendant = part("box", materials.accent, "neck-pendant", neckwear);

  const bag = group("bag", chest);
  const bagBody = part("box", materials.bag, "bag-body", bag);
  const bagFlap = part("box", materials.bagAccent, "bag-flap", bag);
  const bagStrap = part("box", materials.bagAccent, "bag-strap", bag);
  const bagHandle = part("box", materials.bagAccent, "bag-handle", bag);

  const overlayer = group("overlayer", chest);
  const overlayerShell = part("box", materials.overlayer, "overlayer-shell", overlayer, true);
  const overlayerCollar = part("box", materials.overlayer, "overlayer-collar", overlayer);

  const layerMeshes: THREE.Mesh[][] = [[], []];
  const hem = part("taper", materials.garment, "hem", chest, true);
  const collar = part("box", materials.garment, "collar", chest);
  const placket = part("box", materials.garment, "placket", chest);
  const shell = part("box", materials.garment, "garment-shell", chest, true);
  const overlay = part("box", materials.garmentOverlay, "garment-pattern", chest);
  layerMeshes[0]!.push(shell, hem, collar, placket);
  const hemAlt = part("taper", materials.garmentAlt, "hem-alt", chest, true);
  const collarAlt = part("box", materials.garmentAlt, "collar-alt", chest);
  const placketAlt = part("box", materials.garmentAlt, "placket-alt", chest);
  const shellAlt = part("box", materials.garmentAlt, "garment-shell-alt", chest, true);
  const overlayAlt = part("box", materials.garmentAltOverlay, "garment-pattern-alt", chest);
  layerMeshes[1]!.push(shellAlt, hemAlt, collarAlt, placketAlt);

  const layers: [GarmentLayer, GarmentLayer] = [
    {
      index: 0,
      material: materials.garment,
      overlayMaterial: materials.garmentOverlay,
      meshes: layerMeshes[0]!,
      hem,
      overlay,
      weight: 1,
      fabricId: null,
    },
    {
      index: 1,
      material: materials.garmentAlt,
      overlayMaterial: materials.garmentAltOverlay,
      meshes: layerMeshes[1]!,
      hem: hemAlt,
      overlay: overlayAlt,
      weight: 0,
      fabricId: null,
    },
  ];
  setMaterialOpacity(materials.garmentOverlay, 0);
  setMaterialOpacity(materials.garmentAltOverlay, 0);

  const buildLeg = (side: 1 | -1, label: string): RigLeg => {
    const hip = group(`hip-${label}`, hips);
    hip.position.set(BODY.legSpread * side, 0, 0);
    const thigh = part("taper", materials.legWear, `thigh-${label}`, hip, true);
    const knee = group(`knee-${label}`, hip);
    const shin = part("taper", materials.legWear, `shin-${label}`, knee, true);
    const ankle = group(`ankle-${label}`, knee);
    const foot = part("box", materials.legWear, `foot-${label}`, ankle);
    const shoe = part("box", materials.shoe, `shoe-${label}`, ankle, true);
    const sole = part("box", materials.sole, `sole-${label}`, ankle);
    return { hip, thigh, knee, shin, ankle, foot, shoe, sole };
  };

  const buildArm = (label: string): RigArm => {
    const shoulder = group(`arm-${label}`, chest);
    const upper = part("capsule", materials.armWear, `upper-arm-${label}`, shoulder, true);
    const elbow = group(`elbow-${label}`, shoulder);
    const fore = part("capsule", materials.armWear, `forearm-${label}`, elbow, true);
    const hand = group(`hand-${label}`, elbow);
    const palm = part("sphere", materials.hand, `hand-${label}`, hand);
    const wrist = group(`wrist-${label}`, hand);
    const wristBand = part("cylinder", materials.metal, `wrist-band-${label}`, wrist);
    const wristFace = part("box", materials.lens, `wrist-face-${label}`, wrist);
    const carried = group(`carried-${label}`, hand);
    const carriedBody = part("box", materials.carried, `carried-${label}`, carried);
    const carriedScreen = part("box", materials.metal, `carried-screen-${label}`, carried);
    const cane = group(`cane-${label}`, hand);
    const caneShaft = part("cylinder", materials.support, `cane-shaft-${label}`, cane);
    const caneHandle = part("box", materials.support, `cane-handle-${label}`, cane);
    return {
      shoulder,
      upper,
      elbow,
      fore,
      hand,
      palm,
      wrist,
      wristBand,
      wristFace,
      carried,
      carriedBody,
      carriedScreen,
      cane,
      caneShaft,
      caneHandle,
    };
  };

  const legs: [RigLeg, RigLeg] = [buildLeg(-1, "left"), buildLeg(1, "right")];
  const arms: [RigArm, RigArm] = [buildArm("left"), buildArm("right")];

  const rig: PedestrianRig = {
    root,
    body,
    hips,
    chest,
    parts: {
      pelvis,
      torso,
      belt,
      shoulderLeft,
      shoulderRight,
      neck,
      head,
      skull,
      nose,
      eyeLeft,
      eyeRight,
      hairBase,
      hairVolume,
      hairTail,
      hairFringe,
      hat,
      hatCrown,
      hatBrim,
      hatBand,
      hatPeak,
      hatVeil,
      eyewear,
      eyewearFrame,
      eyewearLensLeft,
      eyewearLensRight,
      audio,
      audioPodLeft,
      audioPodRight,
      audioBand,
      neckwear,
      neckBand,
      neckPendant,
      bag,
      bagBody,
      bagFlap,
      bagStrap,
      bagHandle,
      overlayer,
      overlayerShell,
      overlayerCollar,
      hem,
    },
    legs,
    arms,
    layers,
    materialSet: materials,
    materials: materialList,
    weighted,
    meshCount,
    height: RIG_NOMINAL_HEIGHT,
  };
  setMaterialOpacity(materials.garment, 1);
  setMaterialOpacity(materials.garmentAlt, 0);
  return rig;
}

/* -------------------------------------------------------------------------- */
/* Applying a look                                                            */
/* -------------------------------------------------------------------------- */

/** Resolves the shared texture pair for a fabric recipe. */
export type FabricTextureResolver = (fabric: FabricSpec) => FabricTextureSet;

const scratchFrom = new THREE.Color();
const scratchTo = new THREE.Color();
/** Blends two hex colours into `out`, reused to avoid per-frame churn. */
function mixHex(from: number, to: number, amount: number, out: THREE.Color): THREE.Color {
  scratchFrom.setHex(from);
  scratchTo.setHex(to);
  return out.copy(scratchFrom).lerp(scratchTo, clampRange(amount, 0, 1));
}

/**
 * Writes a full parameter set onto a rig.
 *
 * This is the dress-up step: it shapes the body, garment layers, hair, hat,
 * bag, footwear, carried props and support cane from the numeric look, and
 * records `shape * weight` for every part. {@link flushRigWeights} then applies
 * it, so an absent accessory shrinks to nothing instead of popping into view.
 */
export function applyRigParams(rig: PedestrianRig, p: FigureRigParams): void {
  rig.height = RIG_NOMINAL_HEIGHT * p.heightScale;
  const torsoWidth = p.torsoWidth * p.build;
  const torsoDepth = p.torsoDepth * p.build;
  const torsoCentre = p.torsoHeight * 0.26;
  const shoulderY = p.torsoHeight * BODY.shoulderRise;

  /* Body block */
  setPartShape(rig.parts.pelvis, 1, 0.3 * torsoWidth, BODY.pelvisHeight, 0.2 * torsoDepth);
  setPartShape(rig.parts.torso, 1, 0.3 * torsoWidth, p.torsoHeight * 0.52, 0.2 * torsoDepth);
  rig.parts.torso.position.y = torsoCentre;
  setPartShape(rig.parts.belt, p.waistCinched, 0.32 * torsoWidth, 0.055, 0.22 * torsoDepth);
  rig.parts.belt.position.y = p.torsoHeight * 0.06;
  setPartShape(rig.parts.neck, 1, 0.05, BODY.neckLength, 0.05);
  rig.parts.neck.position.y = p.torsoHeight * BODY.neckRise + 0.02;
  const shoulders: readonly [THREE.Mesh, number][] = [
    [rig.parts.shoulderLeft, -1],
    [rig.parts.shoulderRight, 1],
  ];
  for (const [shoulder, side] of shoulders) {
    setPartShape(shoulder, 1, 0.075 + 0.02 * p.shoulderLift, 0.07 + 0.02 * p.shoulderLift, 0.07);
    shoulder.position.set(side * p.shoulderWidth * 0.5, shoulderY, 0);
  }

  /* Head and face */
  rig.parts.head.position.y = p.torsoHeight * BODY.neckRise + BODY.headRise;
  setPartShape(rig.parts.skull, 1, BODY.headRadius, BODY.headRadius * 1.2, BODY.headRadius * 1.05);
  rig.parts.skull.position.y = 0.06;
  setPartShape(rig.parts.nose, 1, 0.022, 0.03, 0.03);
  rig.parts.nose.position.set(0, 0.05, 0.1);
  const eyes: readonly [THREE.Mesh, number][] = [
    [rig.parts.eyeLeft, -1],
    [rig.parts.eyeRight, 1],
  ];
  for (const [eye, side] of eyes) {
    setPartShape(eye, 1, 0.015, 0.016, 0.012);
    eye.position.set(side * 0.042, 0.075, 0.092);
  }

  /* Hair */
  setPartShape(rig.parts.hairBase, 1, 0.115, 0.128 * (0.6 + 0.55 * p.hairVolume), 0.118);
  rig.parts.hairBase.position.y = 0.072;
  setPartShape(
    rig.parts.hairVolume,
    1,
    0.1 + 0.06 * p.hairVolume,
    0.08 + 0.1 * p.hairLength,
    0.09 + 0.06 * p.hairVolume,
  );
  rig.parts.hairVolume.position.set(0, 0.07, -0.04 - 0.02 * p.hairLength);
  setPartShape(rig.parts.hairFringe, 1, 0.17, 0.025 + 0.05 * p.hairFringe, 0.06);
  rig.parts.hairFringe.position.set(0, 0.125 + 0.02 * p.hairLift, 0.062);
  rig.parts.hairFringe.rotation.x = 0.22;
  rig.parts.hairFringe.rotation.z = (p.hairSidePart - 0.5) * 0.4;
  setPartShape(rig.parts.hairTail, p.hairTail, 0.05 + 0.03 * p.hairCurl, 0.09 + 0.34 * p.hairLength, 0.05);
  rig.parts.hairTail.position.set(0, 0.02 - 0.1 * p.hairLength, -0.12 - 0.04 * p.hairCurl);

  /* Headwear: crown, brim, band, peak and veil all morph between hat styles */
  setPartShape(rig.parts.hatCrown, p.hatWeight, p.hatCrownRadius, p.hatCrownHeight * (0.5 + 0.6 * p.hatCrownRound), p.hatCrownRadius);
  rig.parts.hatCrown.position.y = p.hatCrownHeight * 0.35;
  setPartShape(rig.parts.hatBrim, p.hatWeight, p.hatBrimRadius, Math.max(0.008, p.hatBrimThickness), p.hatBrimRadius * 1.06);
  rig.parts.hatBrim.position.y = p.hatCrownHeight * 0.12;
  rig.parts.hatBrim.rotation.x = p.hatBrimTilt;
  setPartShape(rig.parts.hatBand, p.hatWeight, p.hatCrownRadius * 1.06, Math.max(0.006, p.hatBandHeight), p.hatCrownRadius * 1.06);
  rig.parts.hatBand.position.y = p.hatCrownHeight * 0.16;
  const peakSide = p.hatBackwards > 0.5 ? -1 : 1;
  setPartShape(rig.parts.hatPeak, p.hatWeight, p.hatCrownRadius * 1.5, 0.018, Math.max(0.004, p.hatPeakLength));
  rig.parts.hatPeak.position.set(0, p.hatCrownHeight * 0.1, peakSide * (p.hatCrownRadius + p.hatPeakLength * 0.45));
  rig.parts.hatPeak.rotation.x = p.hatBrimTilt * 0.6;
  setPartShape(
    rig.parts.hatVeil,
    clampRange(p.hatVeilDrop / 0.05, 0, 1),
    p.hatCrownRadius * 2.4,
    Math.max(0.004, p.hatVeilDrop),
    p.hatCrownRadius * 2.6,
  );
  rig.parts.hatVeil.position.set(0, -p.hatVeilDrop * 0.4, -0.04);

  /* Eyewear */
  setPartShape(rig.parts.eyewearFrame, p.eyewearWeight, p.eyewearWidth, 0.014, 0.022);
  rig.parts.eyewearFrame.position.set(0, 0.075, 0.096);
  const lenses: readonly [THREE.Mesh, number][] = [
    [rig.parts.eyewearLensLeft, -1],
    [rig.parts.eyewearLensRight, 1],
  ];
  for (const [lens, side] of lenses) {
    setPartShape(lens, p.eyewearWeight, p.eyewearWidth * 0.4, p.eyewearLensHeight, 0.018);
    lens.position.set(side * p.eyewearWidth * 0.26, 0.075, 0.1 + p.eyewearWrap * 0.02);
    lens.rotation.y = side * p.eyewearWrap * 0.6;
  }

  /* Head-worn audio */
  const pods: readonly [THREE.Mesh, number][] = [
    [rig.parts.audioPodLeft, -1],
    [rig.parts.audioPodRight, 1],
  ];
  for (const [pod, side] of pods) {
    setPartShape(pod, p.audioWeight, p.audioPodRadius, p.audioPodRadius * 1.4, p.audioPodRadius);
    pod.position.set(side * 0.108, 0.02, 0);
  }
  setPartShape(rig.parts.audioBand, p.audioWeight, 0.22, Math.max(0.004, p.audioBandDrop), 0.02);
  rig.parts.audioBand.position.set(0, 0.06, 0);

  /* Neckwear */
  setPartShape(rig.parts.neckBand, p.neckWeight, 0.06, 0.012 + p.neckBeads * 0.02, 0.06);
  rig.parts.neckBand.position.y = 0;
  setPartShape(rig.parts.neckPendant, p.neckWeight, 0.03 + 0.06 * p.neckBeads, Math.max(0.01, p.neckDrop), 0.02);
  rig.parts.neckPendant.position.set(0, -p.neckDrop * 0.5 - 0.02, 0.035);

  /* Bag: hip, hand or back, per `bagWear` */
  if (p.bagWear < 0.5) {
    rig.parts.bag.position.set(p.shoulderWidth * 0.5, -0.02, -0.02);
  } else if (p.bagWear < 1.5) {
    rig.parts.bag.position.set(p.shoulderWidth * 0.5 + 0.06, -0.46, 0.02);
  } else {
    rig.parts.bag.position.set(0, 0.08, -0.2);
  }
  setPartShape(rig.parts.bagBody, p.bagWeight, p.bagWidth, p.bagHeight, p.bagDepth);
  rig.parts.bagBody.position.y = -p.bagHeight * 0.5;
  setPartShape(rig.parts.bagFlap, p.bagWeight, p.bagWidth * 0.96, p.bagHeight * 0.45, p.bagDepth * 1.04);
  rig.parts.bagFlap.position.y = -p.bagHeight * 0.32;
  setPartShape(rig.parts.bagStrap, p.bagWeight, 0.03, Math.max(0.05, p.bagStrapDrop), 0.02);
  rig.parts.bagStrap.position.y = -p.bagHeight * 0.5 + p.bagStrapDrop * 0.5;
  setPartShape(rig.parts.bagHandle, p.bagWeight, p.bagWidth * 0.42, 0.025, 0.03);
  rig.parts.bagHandle.position.y = -0.01;

  /* Outer layer: windbreaker, blazer or running vest over the garment */
  setPartShape(
    rig.parts.overlayerShell,
    p.overlayerWeight,
    0.34 * torsoWidth * p.overlayerBulk,
    p.torsoHeight * 0.5 * clampRange(p.overlayerLength, 0.2, 1.4),
    0.24 * torsoDepth * p.overlayerBulk,
  );
  rig.parts.overlayerShell.position.y = torsoCentre - p.torsoHeight * 0.25 * (1 - clampRange(p.overlayerLength, 0.2, 1.4)) * 0.5;
  setPartShape(rig.parts.overlayerCollar, p.overlayerWeight, p.shoulderWidth * 0.9, Math.max(0.008, 0.05 * p.overlayerCollar), 0.07);
  rig.parts.overlayerCollar.position.set(0, p.torsoHeight * 0.52, 0);

  /* Garment layers: shell, hem, collar and placket, twice, for the cross-fade */
  const garmentWidth = 0.325 * torsoWidth;
  const garmentDepth = 0.225 * torsoDepth;
  const hemHeight = 0.1 + p.hemLength * (BODY.thighLength + BODY.shinLength);
  for (const layer of rig.layers) {
    const shell = layer.meshes[0]!;
    const hem = layer.hem;
    const collar = layer.meshes[2]!;
    const placket = layer.meshes[3]!;
    setPartShape(shell, 1, garmentWidth, p.torsoHeight * 0.52, garmentDepth);
    shell.position.y = torsoCentre;
    setPartShape(
      hem,
      1,
      (0.16 + 0.12 * p.hemFlare) * torsoWidth,
      hemHeight,
      (0.11 + 0.1 * p.hemFlare) * torsoDepth,
    );
    hem.position.y = 0.04 - hemHeight * 0.5;
    setPartShape(collar, 1, p.shoulderWidth * 0.7, Math.max(0.012, p.collarHeight), 0.09);
    collar.position.set(0, p.torsoHeight * 0.52, 0);
    setPartShape(placket, 1, Math.max(0.012, p.lapelWidth), p.torsoHeight * 0.4, 0.02);
    placket.position.set(0, torsoCentre, garmentDepth * 0.52);
    setPartShape(layer.overlay, 1, garmentWidth * 1.02, p.torsoHeight * 0.53, garmentDepth * 1.02);
    layer.overlay.position.y = torsoCentre;
  }

  /* Legs and footwear */
  for (const [index, leg] of rig.legs.entries()) {
    const side = index === 0 ? -1 : 1;
    leg.hip.position.set(BODY.legSpread * side, 0, 0);
    setPartShape(leg.thigh, 1, p.legWidth * (1 + 0.25 * p.trouserBreak), BODY.thighLength, p.legWidth);
    leg.thigh.position.y = -BODY.thighLength * 0.5;
    leg.knee.position.y = -BODY.thighLength;
    setPartShape(leg.shin, 1, p.legWidth * (0.85 + 0.35 * p.trouserBreak), BODY.shinLength, p.legWidth * 0.85);
    leg.shin.position.y = -BODY.shinLength * 0.5;
    leg.ankle.position.y = -BODY.shinLength;
    setPartShape(leg.foot, 1, p.legWidth * 1.45, 0.05, 0.2);
    leg.foot.position.set(0, -0.028, 0.05);
    setPartShape(leg.shoe, p.footwearWeight, p.legWidth * 1.7, p.shoeHeight, p.shoeLength);
    leg.shoe.position.set(0, -0.02 + p.shoeSole / 2 + p.shoeHeight / 2, 0.048);
    setPartShape(leg.sole, p.footwearWeight, p.legWidth * 1.8, Math.max(0.006, p.shoeSole), p.shoeLength * 1.02);
    leg.sole.position.set(0, -0.02, 0.05);
  }

  /* Arms: sleeve coverage, gloves, wrist tech, carried gadget and cane */
  for (const [index, arm] of rig.arms.entries()) {
    const side = index === 0 ? -1 : 1;
    const rightArm = side === 1;
    arm.shoulder.position.set(side * (p.shoulderWidth * 0.5 + 0.02), shoulderY, 0);
    setPartShape(arm.upper, 1, p.sleeveWidth, BODY.upperArmLength, p.sleeveWidth);
    arm.upper.position.y = -BODY.upperArmLength * 0.5;
    arm.elbow.position.y = -BODY.upperArmLength;
    setPartShape(arm.fore, 1, p.sleeveWidth * 0.92, BODY.forearmLength, p.sleeveWidth * 0.92);
    arm.fore.position.y = -BODY.forearmLength * 0.5;
    arm.hand.position.y = -BODY.forearmLength;
    setPartShape(arm.palm, 1, 0.032, 0.05, 0.03);
    arm.palm.position.y = -0.022;
    setPartShape(arm.wristBand, rightArm ? p.wristWeight : 0, 0.036, 0.014, 0.036);
    arm.wristBand.position.y = -0.004;
    setPartShape(arm.wristFace, rightArm ? p.wristWeight : 0, 0.02 * p.wristFaceWidth, 0.02, 0.012);
    arm.wristFace.position.set(0, -0.004, 0.028);
    setPartShape(arm.carriedBody, rightArm ? p.carriedWeight : 0, p.carriedWidth, p.carriedHeight, p.carriedDepth);
    arm.carriedBody.position.set(0, -0.07, 0.02);
    arm.carriedBody.rotation.x = 0.25;
    setPartShape(arm.carriedScreen, rightArm ? p.carriedWeight : 0, p.carriedWidth * 0.8, p.carriedHeight * 0.45, 0.006);
    arm.carriedScreen.position.set(0, -0.06, 0.02 + p.carriedDepth * 0.5);
    arm.carriedScreen.rotation.x = 0.25;
    setPartShape(arm.caneShaft, rightArm ? p.supportWeight : 0, 0.013, Math.max(0.2, p.supportLength), 0.013);
    arm.caneShaft.position.y = -p.supportLength * 0.5;
    setPartShape(arm.caneHandle, rightArm ? p.supportWeight : 0, 0.05, 0.022, 0.022);
    arm.caneHandle.position.y = -0.012;
  }
}

/** Recolours every rig material from a blended colour set. */
export function applyRigColors(rig: PedestrianRig, colors: FigureColors, p: FigureRigParams): void {
  const materials = rig.materialSet;
  materials.skin.color.setHex(colors.skin);
  mixHex(colors.skin, colors.glove, p.handsWeight, materials.hand.color);
  materials.hair.color.setHex(colors.hair);
  mixHex(colors.skin, colors.garment, p.sleeveLength, materials.armWear.color);
  mixHex(colors.skin, colors.trousers, p.legCoverage, materials.legWear.color);
  materials.garment.color.setHex(colors.garment);
  materials.garmentAlt.color.setHex(colors.garment);
  materials.garmentOverlay.color.setHex(colors.garmentAccent);
  materials.garmentAltOverlay.color.setHex(colors.garmentAccent);
  materials.accent.color.setHex(colors.garmentAccent);
  materials.headwear.color.setHex(colors.headwear);
  materials.bag.color.setHex(colors.bag);
  materials.bagAccent.color.setHex(colors.garmentAccent);
  materials.overlayer.color.setHex(colors.garmentAccent);
  materials.carried.color.setHex(colors.metal);
  materials.metal.color.setHex(colors.metal);
  materials.eye.color.setHex(colors.eye);
  materials.lens.color.setHex(colors.lens);
  materials.shoe.color.setHex(colors.footwear);
  mixHex(colors.footwear, 0x14161a, 0.55, materials.sole.color);
  materials.support.color.setHex(colors.support);
  // `MeshStandardMaterial` has no sheen term, so fabric sheen is expressed as a
  // roughness reduction; era weaves therefore still read as cloth, satin or
  // technical shell without a second shader.
  const roughness = clampRange(p.fabricRoughness - 0.25 * p.fabricSheen, 0.08, 1);
  materials.garment.roughness = roughness;
  materials.garmentAlt.roughness = roughness;
  materials.garmentOverlay.roughness = clampRange(roughness - 0.2, 0.05, 1);
  materials.garmentAltOverlay.roughness = clampRange(roughness - 0.2, 0.05, 1);
  materials.garment.metalness = p.fabricMetalness;
  materials.garmentAlt.metalness = p.fabricMetalness;
  materials.garmentOverlay.metalness = clampRange(p.fabricMetalness + 0.1, 0, 1);
  materials.garmentAltOverlay.metalness = clampRange(p.fabricMetalness + 0.1, 0, 1);
}

function setLayer(layer: GarmentLayer, weight: number, fabric: FabricSpec, resolve: FabricTextureResolver): void {
  const clamped = clampRange(weight, 0, 1);
  layer.weight = clamped;
  if (layer.fabricId !== fabric.id) {
    const textures = resolve(fabric);
    layer.fabricId = fabric.id;
    layer.material.map = textures.weave;
    layer.overlayMaterial.map = textures.pattern;
    // The shader program changes when a map appears or is swapped.
    layer.material.needsUpdate = true;
    layer.overlayMaterial.needsUpdate = true;
  }
  for (const mesh of layer.meshes) {
    setPartWeight(mesh, clamped);
  }
  setPartWeight(layer.overlay, clamped);
  setMaterialOpacity(layer.material, clamped);
  setMaterialOpacity(layer.overlayMaterial, clamped);
}

/**
 * Cross-fades the two era fabrics.
 *
 * When both eras happen to share a cloth the rig keeps a single layer, so a
 * pure colour change never introduces transparency; otherwise each layer's
 * opacity follows the blend, which is what makes a tweed coat turn into a
 * ripstop shell without a visible switch.
 */
export function applyGarmentLayers(
  rig: PedestrianRig,
  from: FabricSpec,
  to: FabricSpec,
  blend: number,
  resolve: FabricTextureResolver,
): void {
  const t = clampRange(blend, 0, 1);
  if (from.id === to.id) {
    setLayer(rig.layers[0], 1, from, resolve);
    setLayer(rig.layers[1], 0, to, resolve);
    return;
  }
  setLayer(rig.layers[0], 1 - t, from, resolve);
  setLayer(rig.layers[1], t, to, resolve);
}

/** Poses the rig for a walk cycle, including prop sway and counter-swing. */
export function animateRig(rig: PedestrianRig, walk: WalkCycleState, p: FigureRigParams, elapsed: number): void {
  const [leftLeg, rightLeg] = rig.legs;
  const [leftArm, rightArm] = rig.arms;
  leftLeg.hip.rotation.x = walk.leftLegSwing;
  leftLeg.knee.rotation.x = walk.leftKneeBend;
  rightLeg.hip.rotation.x = walk.rightLegSwing;
  rightLeg.knee.rotation.x = walk.rightKneeBend;
  leftArm.shoulder.rotation.x = walk.leftArmSwing;
  rightArm.shoulder.rotation.x = walk.rightArmSwing;
  leftArm.elbow.rotation.x = -0.18 - 0.16 * Math.sin(walk.phase);
  rightArm.elbow.rotation.x = -0.18 - 0.16 * Math.sin(walk.phase + Math.PI);
  rig.parts.head.rotation.x = walk.headBob;
  rig.parts.head.rotation.y = Math.sin(elapsed * 0.35 + walk.phase * 0.25) * 0.12;
  rig.chest.rotation.y = walk.torsoTwist;
  rig.body.position.y = walk.hipBob;
  rig.parts.bag.rotation.z = Math.sin(walk.phase - 0.6) * p.bagSway * 0.14;
  rig.parts.overlayer.rotation.z = Math.sin(walk.phase * 0.5) * 0.02;
  rig.parts.hairTail.rotation.x = 0.12 + Math.sin(walk.phase) * 0.14 * p.hairTail;
  const hemSway = Math.sin(walk.phase * 0.5) * p.hemSway * 0.06;
  for (const layer of rig.layers) {
    layer.hem.rotation.z = hemSway;
  }
  // A cane is planted, so it counter-rotates the swinging arm to stay upright.
  rightArm.cane.rotation.x = -rightArm.shoulder.rotation.x + 0.1;
  rightArm.cane.position.y = -p.supportLength * 0.5 + 0.02;
}

/* -------------------------------------------------------------------------- */
/* Figures                                                                    */
/* -------------------------------------------------------------------------- */

/** One accessory slot as rendered, with its blended presence weight. */
export interface PedestrianSlotDetail {
  readonly slot: AccessorySlot;
  readonly accessoryId: string | null;
  readonly label: string | null;
  readonly source: "outfit" | "wardrobe" | null;
  /** Blended presence weight in `0..1`; the rig scales the part by this. */
  readonly weight: number;
}

/** Read-only inspection snapshot of one figure at the current instant. */
export interface FigureOutline {
  readonly id: string;
  readonly index: number;
  readonly ageBracket: AgeBracket;
  readonly scenario: "circuit" | "crossing";
  readonly crosswalkId: string | null;
  readonly routeId: string;
  readonly crossings: number;
  readonly eraId: EraId;
  readonly fromEra: EraId;
  readonly blend: number;
  readonly look: PedestrianLookSummary;
  readonly parameters: FigureRigParams;
  readonly slots: readonly PedestrianSlotDetail[];
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly distanceAlongRoute: number;
  readonly lateral: number;
  readonly speed: number;
  readonly baseSpeed: number;
  readonly activation: number;
  readonly meshCount: number;
  readonly walkCycle: WalkCycleState;
}

/** A live pedestrian figure exposed to scene assembly, HUD and tests. */
export interface PedestrianFigure {
  readonly id: string;
  readonly index: number;
  readonly ageBracket: AgeBracket;
  readonly scenario: "circuit" | "crossing";
  readonly crosswalkId: string | null;
  readonly routeId: string;
  /** Root of the figure; parent it into the block like any scene object. */
  readonly group: THREE.Group;
  readonly position: THREE.Vector3;
  readonly walkCycle: WalkCycleState;
  /** Crowd activation in `0..1`; also the figure's material opacity. */
  readonly activation: number;
  readonly speed: number;
  readonly baseSpeed: number;
  readonly speedFactor: number;
  /** Spacing-avoidance factor in `0..1` applied to the base speed this frame. */
  readonly guard: number;
  /** Transient sidestep currently added to the walker's lane offset, metres. */
  readonly steer: number;
  readonly distanceAlongRoute: number;
  readonly lateral: number;
  /** The blended look currently applied to the rig. */
  readonly appearance: FigureAppearance;
  /** Resolved look for one era, regardless of what is currently applied. */
  appearanceFor(era: EraId): FigureAppearance;
  describe(): PedestrianLookSummary;
  detailSlots(): readonly PedestrianSlotDetail[];
  outline(): FigureOutline;
}

interface FigureState {
  readonly id: string;
  readonly index: number;
  readonly seed: number;
  readonly ageBracket: AgeBracket;
  readonly route: WalkRoute;
  readonly scenario: "circuit" | "crossing";
  readonly crosswalkId: string | null;
  readonly speedFactor: number;
  readonly phaseOffset: number;
  /** Largest sideways offset this walker's corridor allows, in metres. */
  readonly lateralLimit: number;
  readonly rig: PedestrianRig;
  readonly looks: Map<EraId, FigureAppearance>;
  readonly walk: MutableWalkCycle;
  view: PedestrianFigure;
  s: number;
  lateralWant: number;
  lateral: number;
  /** Transient sidestep added to `lateralWant` while dodging another walker. */
  steer: number;
  x: number;
  z: number;
  heading: number;
  normalX: number;
  normalZ: number;
  speed: number;
  baseSpeed: number;
  guard: number;
  activation: number;
  inCrossing: boolean;
  crossings: number;
  fromEra: EraId;
  blend: number;
  appearance: FigureAppearance;
}

function mixSeed(seed: number, index: number): number {
  return (Math.imul(seed ^ (index + 1), 0x9e3779b1) ^ Math.imul(index + 7, 0x85ebca6b)) >>> 0;
}

/* -------------------------------------------------------------------------- */
/* System                                                                     */
/* -------------------------------------------------------------------------- */

/** Options for {@link createPedestrianSystem}. */
export interface PedestrianSystemOptions {
  /** Layout contract to route over; defaults to the shared `CITY_LAYOUT`. */
  readonly layout?: CityLayout;
  /** Era the crowd starts in; defaults to the first timeline stop. */
  readonly era?: EraId;
  /** Deterministic seed: the same seed always produces the same crowd. */
  readonly seed?: number;
  /** Overrides the derived figure pool size; tests use small crowds. */
  readonly figurePoolSize?: number;
  /** Fabric texture edge length in pixels. */
  readonly textureSize?: number;
}

/**
 * Live state of the pedestrian crowd.
 *
 * Every descriptor value here is blended from the frozen era contract through
 * `resolveEraWeights`, so a mid-transition frame reports the interpolated
 * wardrobe behaviour. `crowdRatio` and `chatterLevel` are surfaced for the HUD
 * and the voice layer rather than restated in the rig.
 */
export interface PedestrianSystemStats {
  readonly id: string;
  readonly eraId: EraId;
  readonly fromEra: EraId;
  readonly blend: number;
  readonly densityPer100m: number;
  readonly walkSpeed: number;
  readonly strideScale: number;
  readonly crowdRatio: number;
  readonly gadgetUse: number;
  readonly sidewalkLength: number;
  /** Continuous crowd size implied by the blended era density. */
  readonly targetPopulation: number;
  /** Figures above the activation threshold. */
  readonly activePopulation: number;
  readonly visibleFigures: number;
  readonly figurePoolSize: number;
  readonly crosswalkCrossings: number;
  readonly minPairDistance: number;
  readonly resources: PedestrianResourceCounts;
}

/** The pedestrian crowd as a mountable, era-aware scene system. */
export interface PedestrianSystem extends EraSceneSystem {
  readonly id: string;
  readonly group: THREE.Group;
  readonly layout: CityLayout;
  readonly network: WalkNetwork;
  readonly figures: readonly PedestrianFigure[];
  readonly poolSize: number;
  stats(): PedestrianSystemStats;
  outlines(): readonly FigureOutline[];
  update(context: EraUpdateContext): void;
  applyEra(era: EraId, blend: number): void;
  getPickables(): readonly THREE.Object3D[];
  dispose(): void;
}

function slotDetails(appearance: FigureAppearance): readonly PedestrianSlotDetail[] {
  return ACCESSORY_SLOTS.map((slot) => {
    const resolved: ResolvedAccessory | null = appearance.accessorySlots[slot];
    return {
      slot,
      accessoryId: resolved ? resolved.spec.id : null,
      label: resolved ? resolved.spec.label : null,
      source: resolved ? resolved.source : null,
      weight: appearance.parameters[SLOT_WEIGHT_KEYS[slot]],
    };
  });
}

function createOutline(state: FigureState): FigureOutline {
  return {
    id: state.id,
    index: state.index,
    ageBracket: state.ageBracket,
    scenario: state.scenario,
    crosswalkId: state.crosswalkId,
    routeId: state.route.id,
    crossings: state.crossings,
    eraId: state.appearance.eraId,
    fromEra: state.fromEra,
    blend: state.blend,
    look: describeLook(state.appearance),
    parameters: state.appearance.parameters,
    slots: slotDetails(state.appearance),
    position: {
      x: state.rig.root.position.x,
      y: state.rig.root.position.y,
      z: state.rig.root.position.z,
    },
    distanceAlongRoute: state.s,
    lateral: state.lateral,
    speed: state.speed,
    baseSpeed: state.baseSpeed,
    activation: state.activation,
    meshCount: state.rig.meshCount,
    walkCycle: state.walk,
  };
}

function createFigureView(state: FigureState): PedestrianFigure {
  return {
    id: state.id,
    index: state.index,
    ageBracket: state.ageBracket,
    scenario: state.scenario,
    crosswalkId: state.crosswalkId,
    routeId: state.route.id,
    group: state.rig.root,
    get position() {
      return state.rig.root.position;
    },
    get walkCycle() {
      return state.walk;
    },
    get activation() {
      return state.activation;
    },
    get speed() {
      return state.speed;
    },
    get baseSpeed() {
      return state.baseSpeed;
    },
    get speedFactor() {
      return state.speedFactor;
    },
    get guard() {
      return state.guard;
    },
    get steer() {
      return state.steer;
    },
    get distanceAlongRoute() {
      return state.s;
    },
    get lateral() {
      return state.lateral;
    },
    get appearance() {
      return state.appearance;
    },
    appearanceFor(era: EraId) {
      return resolveFigureAppearance(era, state.seed);
    },
    describe() {
      return describeLook(state.appearance);
    },
    detailSlots() {
      return slotDetails(state.appearance);
    },
    outline() {
      return createOutline(state);
    },
  };
}

/**
 * Creates the pedestrian crowd.
 *
 * Construction builds the walk network, the shared geometry/texture library
 * and a pool of rigs large enough for the densest era. From then on the system
 * only ever mutates existing objects: `update` walks and animates the crowd
 * from the fixed-step context, `applyEra` re-targets the era blend, and
 * `dispose` releases every geometry, material and texture it created.
 */
export function createPedestrianSystem(options: PedestrianSystemOptions = {}): PedestrianSystem {
  const layout = options.layout ?? CITY_LAYOUT;
  const network = buildWalkNetwork(layout);
  const ledger = createResourceLedger();
  const geometry = createGeometryLibrary(ledger);
  const textureSize = options.textureSize ?? FABRIC_TEXTURE_SIZE;
  const seed = options.seed ?? 0x5eed1e;
  const initialEra = options.era ?? ERA_IDS[0]!;

  const maxPopulation = Math.max(
    ...ERA_IDS.map((era) => planPopulation(getEraConfig(era).pedestrians.density, network.sidewalkLength)),
  );
  const poolSize = Math.max(1, options.figurePoolSize ?? Math.ceil(maxPopulation) + 1);

  const textureCache = new Map<string, FabricTextureSet>();
  const textureFor: FabricTextureResolver = (fabric) => {
    const cached = textureCache.get(fabric.id);
    if (cached) {
      return cached;
    }
    const set = createFabricTextureSet(fabric, textureSize);
    ledger.trackTexture(set.weave);
    ledger.trackTexture(set.pattern);
    textureCache.set(fabric.id, set);
    return set;
  };

  const crossingRoutes = network.routes.filter((route) => route.kind === "crossing-excursion");
  const circuitRoute = network.routes[0]!;
  const ageMix = getEraConfig(initialEra).pedestrians.ageMix;

  const states: FigureState[] = [];
  for (let index = 0; index < poolSize; index += 1) {
    const figureSeed = mixSeed(seed, index);
    const crossing = deterministicSample(figureSeed, "scenario") < CROSSING_ROUTE_SHARE && crossingRoutes.length > 0;
    const route = crossing
      ? crossingRoutes[Math.floor(deterministicSample(figureSeed, "route") * crossingRoutes.length) % crossingRoutes.length]!
      : circuitRoute;
    const ageBracket = pickAgeBracket(ageMix, figureSeed);
    // Every walker keeps a minimum lateral offset so opposite-direction pairs
    // on a crossing spur always pass with clearance instead of overlapping.
    const lateralLimit = Math.min(...route.vertices.map((vertex) => vertex.corridorHalfWidth)) - 0.15;
    const side = deterministicSample(figureSeed, "lateral-side") < 0.5 ? -1 : 1;
    const lateralWant = side * (MIN_LATERAL_OFFSET + deterministicSample(figureSeed, "lateral") * Math.max(0, lateralLimit - MIN_LATERAL_OFFSET));

    const rig = createPedestrianRig(ledger, geometry, resolveFigureAppearance(initialEra, figureSeed).colors);
    const state: FigureState = {
      id: `pedestrian-${index}`,
      index,
      seed: figureSeed,
      ageBracket,
      route,
      scenario: crossing ? "crossing" : "circuit",
      crosswalkId: crossing ? route.crosswalkId : null,
      speedFactor: 0.82 + deterministicSample(figureSeed, "speed") * 0.36,
      phaseOffset: deterministicSample(figureSeed, "phase"),
      lateralLimit,
      rig,
      looks: new Map<EraId, FigureAppearance>(),
      walk: computeWalkCycle(0, BASE_STRIDE_LENGTH) as MutableWalkCycle,
      view: undefined as unknown as PedestrianFigure,
      s: (index / poolSize) * route.length + deterministicSample(figureSeed, "offset") * 0.5,
      lateralWant,
      lateral: lateralWant,
      steer: 0,
      x: 0,
      z: 0,
      heading: 0,
      normalX: 0,
      normalZ: 1,
      speed: 0,
      baseSpeed: 0,
      guard: 1,
      activation: 0,
      inCrossing: false,
      crossings: 0,
      fromEra: initialEra,
      blend: 1,
      appearance: resolveFigureAppearance(initialEra, figureSeed),
    };
    // Space the crowd out so no two figures start inside each other.
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const candidate = sampleWalkRoute(route, state.s, lateralWant);
      const clash = states.some((other) => Math.hypot(other.x - candidate.x, other.z - candidate.z) < MIN_FIGURE_SEPARATION * 1.8);
      if (!clash) {
        break;
      }
      state.s += route.length * 0.017 + 0.6;
    }
    const placed = sampleWalkRoute(route, state.s, lateralWant);
    state.x = placed.x;
    state.z = placed.z;
    state.heading = placed.heading;
    state.normalX = placed.normalX;
    state.normalZ = placed.normalZ;
    state.lateral = placed.lateral;
    rig.root.position.set(placed.x, 0, placed.z);
    rig.root.rotation.y = placed.heading;
    rig.root.userData["pedestrianId"] = state.id;
    rig.root.userData["pedestrianIndex"] = index;
    state.view = createFigureView(state);
    states.push(state);
  }

  const group = new THREE.Group();
  group.name = PEDESTRIAN_GROUP_NAME;
  for (const state of states) {
    group.add(state.rig.root);
  }
  const pickables: THREE.Object3D[] = states.map((state) => state.rig.root);

  let era: EraId = initialEra;
  let fromEra: EraId = initialEra;
  let blend = 1;
  let densityPer100m = getEraConfig(initialEra).pedestrians.density;
  let walkSpeed = getEraConfig(initialEra).pedestrians.walkSpeed;
  let strideScale = getEraConfig(initialEra).pedestrians.strideScale;
  let crowdRatio = getEraConfig(initialEra).pedestrians.crowdRatio;
  let gadgetUse = getEraConfig(initialEra).pedestrians.gadgetUse;
  let targetPopulation = planPopulation(densityPer100m, network.sidewalkLength);
  let crossings = 0;
  let minPairDistance = Number.POSITIVE_INFINITY;
  let elapsed = 0;
  let lookKey = "";
  let disposed = false;

  function lookFor(state: FigureState, target: EraId): FigureAppearance {
    const cached = state.looks.get(target);
    if (cached) {
      return cached;
    }
    const resolved = resolveFigureAppearance(target, state.seed);
    state.looks.set(target, resolved);
    return resolved;
  }

  function applyLooksIfNeeded(): void {
    const key = `${fromEra}|${era}|${blend}`;
    if (key === lookKey) {
      return;
    }
    for (const state of states) {
      const fromLook = lookFor(state, fromEra);
      const toLook = lookFor(state, era);
      const blended = blendAppearances(fromLook, toLook, blend);
      state.appearance = blended;
      state.fromEra = fromEra;
      state.blend = blend;
      applyRigParams(state.rig, blended.parameters);
      applyRigColors(state.rig, blended.colors, blended.parameters);
      applyGarmentLayers(state.rig, fromLook.fabric, toLook.fabric, blend, textureFor);
      flushRigWeights(state.rig);
    }
    lookKey = key;
  }

  function resolveAvoidance(): void {
    minPairDistance = Number.POSITIVE_INFINITY;
    for (const state of states) {
      state.guard = 1;
      // Sidesteps decay, so a walker returns to its lane once the way is clear.
      state.steer *= 0.9;
    }
    for (let i = 0; i < states.length; i += 1) {
      const a = states[i]!;
      if (a.activation <= HIDDEN_WEIGHT_EPSILON) {
        continue;
      }
      for (let j = 0; j < states.length; j += 1) {
        if (i === j) {
          continue;
        }
        const b = states[j]!;
        if (b.activation <= HIDDEN_WEIGHT_EPSILON) {
          continue;
        }
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distance = Math.hypot(dx, dz);
        if (distance < minPairDistance) {
          minPairDistance = distance;
        }
        if (distance >= LOOKAHEAD_DISTANCE) {
          continue;
        }
        // Lateral gap in this walker's own frame; only meaningful for the
        // queue case, because perpendicular paths share no lateral axis.
        const otherOffset = dx * a.normalX + dz * a.normalZ;
        const gap = otherOffset - a.lateral;
        const close = distance < MIN_FIGURE_SEPARATION;
        if (!close) {
          if (Math.abs(gap) > LATERAL_CLEARANCE) {
            continue;
          }
          const ahead = dx * Math.sin(a.heading) + dz * Math.cos(a.heading);
          if (ahead <= 0) {
            continue;
          }
          const factor = clampRange(
            (distance - STOP_DISTANCE) / Math.max(0.001, LOOKAHEAD_DISTANCE - STOP_DISTANCE),
            0,
            1,
          );
          a.guard = Math.min(a.guard, 0.15 + 0.85 * factor);
          if (gap !== 0) {
            a.steer = clampRange(a.steer + (gap > 0 ? -0.08 : 0.08), -MAX_SIDESTEP, MAX_SIDESTEP);
          }
          continue;
        }
        // Too close: the walker facing the other one stops and steps aside;
        // the one being approached keeps walking. Index is the tie-break, so
        // the pair can never deadlock or mirror into each other.
        const aheadNow = dx * Math.sin(a.heading) + dz * Math.cos(a.heading);
        if (aheadNow > 0) {
          a.guard = 0;
        }
        const preference = Math.abs(gap) > 0.15 ? (gap > 0 ? -1 : 1) : i < j ? -1 : 1;
        // Only step towards the side with room left in the corridor.
        const direction =
          Math.abs(a.lateralWant + preference * 0.3) <= a.lateralLimit + CORRIDOR_TOLERANCE
            ? preference
            : -preference;
        a.steer = clampRange(a.steer + direction * 0.3, -MAX_SIDESTEP, MAX_SIDESTEP);
      }
    }
    if (!Number.isFinite(minPairDistance)) {
      minPairDistance = 0;
    }
  }

  function advance(delta: number): void {
    for (const state of states) {
      if (state.activation <= HIDDEN_WEIGHT_EPSILON) {
        state.speed = 0;
        continue;
      }
      state.speed = state.baseSpeed * state.guard;
      state.s += state.speed * delta;
      const sample = sampleWalkRoute(state.route, state.s, state.lateralWant + state.steer);
      state.x = sample.x;
      state.z = sample.z;
      state.lateral = sample.lateral;
      state.heading = sample.heading;
      state.normalX = sample.normalX;
      state.normalZ = sample.normalZ;
      state.rig.root.position.set(sample.x, 0, sample.z);
      state.rig.root.rotation.y = sample.heading;
      if (sample.corridor === "crosswalk") {
        if (!state.inCrossing) {
          state.inCrossing = true;
          state.crossings += 1;
          crossings += 1;
        }
      } else if (state.inCrossing) {
        state.inCrossing = false;
      }
    }
  }

  function animate(): void {
    for (const state of states) {
      const strideLength = BASE_STRIDE_LENGTH * strideScale * state.appearance.parameters.heightScale;
      const active = state.baseSpeed > 0 ? clampRange(state.speed / state.baseSpeed, 0, 1) : 0;
      const cycles = strideLength > 0 ? (state.s / strideLength) % 1 : 0;
      const cycle = computeWalkCycle((cycles + state.phaseOffset) * TWO_PI, strideLength);
      state.walk.phase = cycle.phase;
      state.walk.leftLegSwing = cycle.leftLegSwing * active;
      state.walk.rightLegSwing = cycle.rightLegSwing * active;
      state.walk.leftArmSwing = cycle.leftArmSwing * active;
      state.walk.rightArmSwing = cycle.rightArmSwing * active;
      state.walk.leftKneeBend = cycle.leftKneeBend * active;
      state.walk.rightKneeBend = cycle.rightKneeBend * active;
      state.walk.headBob = cycle.headBob * active;
      state.walk.hipBob = cycle.hipBob * active;
      state.walk.torsoTwist = cycle.torsoTwist * active;
      state.walk.strideLength = strideLength;
      animateRig(state.rig, state.walk, state.appearance.parameters, elapsed);
      applyRigActivation(state.rig, state.activation);
    }
  }

  function countMeshes(): number {
    let total = 0;
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        total += 1;
      }
    });
    return total;
  }

  function syncEra(nextEra: EraId, nextFrom: EraId, nextBlend: number): void {
    fromEra = nextFrom;
    era = nextEra;
    blend = clampBlend(nextBlend);
  }

  function descriptorValue(pick: (target: EraId) => number): number {
    const weights = resolveEraWeights(fromEra, era, blend);
    let total = 0;
    for (const id of ERA_IDS) {
      total += weights[id] * pick(id);
    }
    return total;
  }

  const system: PedestrianSystem = {
    id: PEDESTRIAN_SYSTEM_ID,
    group,
    layout,
    network,
    figures: states.map((state) => state.view),
    poolSize,
    applyEra(nextEra: EraId, nextBlend: number) {
      if (disposed) {
        return;
      }
      if (nextEra !== era) {
        fromEra = era;
        era = nextEra;
      }
      blend = clampBlend(nextBlend);
    },
    update(context: EraUpdateContext) {
      if (disposed) {
        return;
      }
      syncEra(context.era, context.from, context.blend);
      const delta = Number.isFinite(context.delta) && context.delta > 0 ? context.delta : 0;
      elapsed += delta;
      densityPer100m = descriptorValue((target) => getEraConfig(target).pedestrians.density);
      walkSpeed = descriptorValue((target) => getEraConfig(target).pedestrians.walkSpeed);
      strideScale = descriptorValue((target) => getEraConfig(target).pedestrians.strideScale);
      crowdRatio = descriptorValue((target) => getEraConfig(target).pedestrians.crowdRatio);
      gadgetUse = descriptorValue((target) => getEraConfig(target).pedestrians.gadgetUse);
      targetPopulation = planPopulation(densityPer100m, network.sidewalkLength);
      for (const state of states) {
        state.activation = clampRange(targetPopulation - state.index, 0, 1);
        state.baseSpeed = walkSpeed * strideScale * state.speedFactor * AGE_SPEED_FACTOR[state.ageBracket];
      }
      resolveAvoidance();
      advance(delta);
      applyLooksIfNeeded();
      animate();
    },
    getPickables() {
      return pickables;
    },
    stats() {
      return {
        id: PEDESTRIAN_SYSTEM_ID,
        eraId: era,
        fromEra,
        blend,
        densityPer100m,
        walkSpeed,
        strideScale,
        crowdRatio,
        gadgetUse,
        sidewalkLength: network.sidewalkLength,
        targetPopulation,
        activePopulation: states.filter((state) => state.activation > HIDDEN_WEIGHT_EPSILON).length,
        visibleFigures: states.filter((state) => state.rig.root.visible).length,
        figurePoolSize: poolSize,
        crosswalkCrossings: crossings,
        minPairDistance,
        resources: ledger.counts(countMeshes()),
      };
    },
    outlines() {
      return states.map((state) => createOutline(state));
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const state of states) {
        state.rig.root.removeFromParent();
      }
      group.clear();
      textureCache.clear();
      ledger.disposeAll();
    },
  };

  // Dress the crowd for its starting era, and place it for the first frame.
  for (const state of states) {
    state.activation = clampRange(targetPopulation - state.index, 0, 1);
    state.baseSpeed = walkSpeed * strideScale * state.speedFactor * AGE_SPEED_FACTOR[state.ageBracket];
  }
  applyLooksIfNeeded();
  resolveAvoidance();
  advance(0);
  animate();

  return system;
}

