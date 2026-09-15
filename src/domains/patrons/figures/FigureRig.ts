/**
 * Figure rig — the procedural barista and patron bodies.
 *
 * Every figure is built from six shared primitives (`FigureResources`) scaled
 * per mesh, so a room full of patrons costs six buffer geometries, one material
 * library and a few hundred `Mesh` nodes. The rig owns:
 *
 *  - the body (hips, torso, head, arms, legs) with a seated and a standing
 *    build path, and a `counter` variation whose work surface is the counter,
 *  - the garments: every {@link GarmentCut} the wardrobe names is folded from
 *    the same primitives (sleeves into the arm groups so they swing with the
 *    idle motion, skirts into the hip group so they ride the sway),
 *  - the hairstyles: caps, waves, pompadours, victory rolls, beehives, big hair
 *    and top knots extruded from the same primitives,
 *  - the era prop sockets (`handLeft`, `surface`, `headwear`, …) the gadgets
 *    mount to, and the gadget props themselves,
 *  - the idle motion loops: pure functions of a phase the module advances with
 *    `update(dt)`, so identical deltas produce identical poses and nothing ever
 *    runs on an independent timer.
 *
 * The rig never touches the scene graph outside the group it returns, and never
 * disposes the shared resources it was handed: `PatronModule` owns those.
 */

import * as THREE from 'three';
import type { RoomPoint, YearId } from '../../../contracts/period';
import type { PlacedFigure, FigureVariation } from '../placement/placement';
import {
  GADGETS,
  createGadgetProp,
  gadgetLabels,
  type GadgetId,
  type GadgetMount,
} from './GadgetProps';
import {
  HAIR_STYLES,
  hairStyle,
  rampColor,
  wardrobeItem,
  type FigureMaterialLibrary,
  type FigurePattern,
  type GarmentSlot,
  type HairSilhouette,
  type HairStyleId,
  type WardrobeItem,
} from './Wardrobe';

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

/** The primitive set every figure mesh is scaled from. */
export const FIGURE_GEOMETRY_KEYS = ['box', 'sphere', 'cylinder', 'cone', 'torus'] as const;

export type FigureGeometryKey = (typeof FIGURE_GEOMETRY_KEYS)[number];

export interface FigureResources {
  readonly id: string;
  readonly geometries: Readonly<Record<FigureGeometryKey, THREE.BufferGeometry>>;
  readonly disposed: boolean;
  dispose(): void;
}

/** Creates the shared unit-sized primitive bag (box 1³, sphere ⌀1, …). */
export function createFigureResources(id = 'patron-primitives'): FigureResources {
  const geometries: Record<FigureGeometryKey, THREE.BufferGeometry> = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(0.5, 12, 8),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false),
    cone: new THREE.ConeGeometry(0.5, 1, 12, 1, false),
    torus: new THREE.TorusGeometry(0.5, 0.11, 6, 14),
  };
  for (const geometry of Object.values(geometries)) geometry.computeVertexNormals();

  let disposed = false;
  return {
    id,
    geometries: Object.freeze(geometries),
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of Object.values(geometries)) geometry.dispose();
    },
  };
}

type Vec3 = readonly [number, number, number];

interface MeshPlacement {
  readonly position?: Vec3;
  readonly scale?: Vec3;
  readonly rotation?: Vec3;
}

/** Adds one primitive mesh to `parent`, scaled into shape. */
function prim(
  parent: THREE.Object3D,
  resources: FigureResources,
  geometry: FigureGeometryKey,
  material: THREE.Material,
  name: string,
  placement: MeshPlacement = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(resources.geometries[geometry], material);
  mesh.name = name;
  const position = placement.position ?? [0, 0, 0];
  mesh.position.set(position[0], position[1], position[2]);
  const scale = placement.scale ?? [1, 1, 1];
  mesh.scale.set(scale[0], scale[1], scale[2]);
  const rotation = placement.rotation ?? [0, 0, 0];
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  mesh.matrixAutoUpdate = true;
  parent.add(mesh);
  return mesh;
}

function group(parent: THREE.Object3D, name: string, position: Vec3 = [0, 0, 0]): THREE.Group {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(position[0], position[1], position[2]);
  parent.add(node);
  return node;
}

/* -------------------------------------------------------------------------- */
/* Blueprints                                                                 */
/* -------------------------------------------------------------------------- */

export type FigureRole = 'barista' | 'patron';
export type FigurePose = 'standing' | 'seated';
/** Where the figure stands in the café; placement resolves it to coordinates. */
export type FigureZone = 'counter' | 'table' | 'standing' | 'window';

/** One garment chosen for a figure. */
export interface GarmentSelection {
  readonly slot: GarmentSlot;
  /** Catalogue id in {@link WARDROBE}. */
  readonly item: string;
  /** Index into the era's dye ramp. */
  readonly colorway: number;
}

/** Idle motion archetypes the rig can drive. */
export type IdleMotionKind =
  | 'breathe'
  | 'sip-coffee'
  | 'read-newspaper'
  | 'stir-counter'
  | 'wipe-counter'
  | 'shift-weight'
  | 'sway-window'
  | 'nurse-cup'
  | 'type-laptop'
  | 'glance-phone'
  | 'bob-to-radio'
  | 'tap-watch';

export interface FigureBlueprint {
  readonly id: string;
  readonly role: FigureRole;
  readonly pose: FigurePose;
  readonly zone: FigureZone;
  /** Standing stature in metres (the rig scales the canonical body to it). */
  readonly stature: number;
  readonly presentation: 'menswear' | 'womenswear' | 'unisex';
  readonly hair: HairStyleId;
  /** Index into the era's skin tone ramp. */
  readonly skinTone: number;
  /** Offset added to the hairstyle's own tone index. */
  readonly hairToneOffset?: number;
  readonly garments: readonly GarmentSelection[];
  readonly gadgets: readonly GadgetId[];
  readonly motion: IdleMotionKind;
  /** Era-exact caption the inspect overlay shows for this figure. */
  readonly caption: string;
}

/* -------------------------------------------------------------------------- */
/* Body dimensions                                                            */
/* -------------------------------------------------------------------------- */

/** Stature the canonical body is authored at; figures scale from here. */
export const CANONICAL_STATURE = 1.76;
export const STANDING_HIP_HEIGHT = 0.94;
export const SEAT_HEIGHT = 0.46;
const TORSO_LENGTH = 0.54;
const NECK_LENGTH = 0.05;
const HEAD_RADIUS = 0.115;
const HIP_HALF = 0.085;
const SHOULDER_HALF = 0.19;
const THIGH_LENGTH = 0.44;
const SHIN_LENGTH = 0.42;
const UPPER_ARM_LENGTH = 0.29;
const FOREARM_LENGTH = 0.26;
const FOOT_LENGTH = 0.24;
const CHEST_DEPTH = 0.21;

/** The measurements one figure's garments are cut against (body space). */
export interface FigureDimensions {
  readonly scale: number;
  readonly stature: number;
  readonly shoulderHalf: number;
  readonly torsoLength: number;
  readonly hipHalf: number;
  readonly headRadius: number;
  readonly headY: number;
  readonly thigh: number;
  readonly shin: number;
  readonly upperArm: number;
  readonly forearm: number;
  readonly chestDepth: number;
  readonly seat: boolean;
}

/** Body measurements for `blueprint`, scaled to its stature. */
export function figureDimensions(blueprint: FigureBlueprint): FigureDimensions {
  const stature = Number.isFinite(blueprint.stature) && blueprint.stature > 1
    ? blueprint.stature
    : CANONICAL_STATURE;
  const wide = blueprint.presentation === 'womenswear' ? 0.94 : blueprint.presentation === 'unisex' ? 0.97 : 1;
  return Object.freeze({
    scale: stature / CANONICAL_STATURE,
    stature,
    shoulderHalf: SHOULDER_HALF * wide,
    torsoLength: TORSO_LENGTH,
    hipHalf: HIP_HALF * wide,
    headRadius: HEAD_RADIUS,
    headY: TORSO_LENGTH + NECK_LENGTH + HEAD_RADIUS,
    thigh: THIGH_LENGTH,
    shin: SHIN_LENGTH,
    upperArm: UPPER_ARM_LENGTH,
    forearm: FOREARM_LENGTH,
    chestDepth: CHEST_DEPTH * wide,
    seat: blueprint.pose === 'seated',
  });
}

/* -------------------------------------------------------------------------- */
/* Parts and sockets                                                          */
/* -------------------------------------------------------------------------- */

export const FIGURE_PART_KEYS = [
  'root',
  'hips',
  'torso',
  'head',
  'hair',
  'armLeft',
  'armRight',
  'forearmLeft',
  'forearmRight',
  'legLeft',
  'legRight',
  'shinLeft',
  'shinRight',
] as const;

export type FigurePartKey = (typeof FIGURE_PART_KEYS)[number];

export const FIGURE_SOCKET_KEYS = [
  'handLeft',
  'handRight',
  'headwear',
  'ears',
  'shoulderLeft',
  'shoulderRight',
  'hip',
  'surface',
  'lap',
  'ground',
] as const;

export type FigureSocketKey = (typeof FIGURE_SOCKET_KEYS)[number];

export interface FigureProp {
  readonly gadget: GadgetId;
  readonly mount: GadgetMount;
  readonly group: THREE.Group;
}

export interface FigureTransform {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: number;
  readonly phase: number;
}

/** Stable serialisation of one figure transform (determinism evidence). */
export function figureTransformSignature(transform: FigureTransform): string {
  return [
    transform.id,
    transform.x.toFixed(6),
    transform.y.toFixed(6),
    transform.z.toFixed(6),
    transform.facing.toFixed(6),
    transform.phase.toFixed(6),
  ].join('|');
}

export interface FigureDescription {
  readonly id: string;
  readonly year: YearId;
  readonly role: FigureRole;
  readonly pose: FigurePose;
  readonly zone: FigureZone;
  readonly motion: IdleMotionKind;
  readonly caption: string;
  readonly hair: string;
  readonly outfit: readonly string[];
  readonly gadgets: readonly string[];
  readonly height: number;
  readonly footprintRadius: number;
}

export interface FigureInstance {
  readonly id: string;
  readonly year: YearId;
  readonly blueprint: FigureBlueprint;
  readonly role: FigureRole;
  readonly pose: FigurePose;
  readonly zone: FigureZone;
  readonly seated: boolean;
  readonly root: THREE.Group;
  readonly parts: Readonly<Record<FigurePartKey, THREE.Object3D>>;
  readonly sockets: Readonly<Record<FigureSocketKey, THREE.Object3D>>;
  readonly props: readonly FigureProp[];
  readonly height: number;
  readonly footprintRadius: number;
  readonly motion: IdleMotionKind;
  readonly motionSpeed: number;
  readonly variation: FigureVariation;
  readonly position: RoomPoint;
  readonly facing: number;
  readonly phase: number;
  /** Advances the idle loop by `deltaSeconds`; returns the new phase. */
  advance(deltaSeconds: number): number;
  /** Places the loop at an absolute phase (seconds of motion folded in). */
  setPhase(phase: number): void;
  /** Re-applies the base pose plus the current idle offsets. */
  applyPose(): void;
  transform(): FigureTransform;
  describe(): FigureDescription;
}

/* -------------------------------------------------------------------------- */
/* Idle motion                                                                */
/* -------------------------------------------------------------------------- */

export interface IdleMotionDefinition {
  readonly kind: IdleMotionKind;
  readonly label: string;
  /** Parts the loop actually moves (test/diagnostic evidence). */
  readonly parts: readonly FigurePartKey[];
}

export const IDLE_MOTIONS: Readonly<Record<IdleMotionKind, IdleMotionDefinition>> = Object.freeze({
  breathe: {
    kind: 'breathe',
    label: 'quiet breathing',
    parts: ['torso', 'head'],
  },
  'sip-coffee': {
    kind: 'sip-coffee',
    label: 'sipping coffee',
    parts: ['forearmRight', 'armRight', 'head', 'torso'],
  },
  'read-newspaper': {
    kind: 'read-newspaper',
    label: 'reading and turning pages',
    parts: ['armLeft', 'forearmLeft', 'forearmRight', 'head'],
  },
  'stir-counter': {
    kind: 'stir-counter',
    label: 'stirring at the counter',
    parts: ['forearmRight', 'armRight', 'torso', 'hips'],
  },
  'wipe-counter': {
    kind: 'wipe-counter',
    label: 'wiping the counter',
    parts: ['armRight', 'forearmRight', 'torso', 'hips'],
  },
  'shift-weight': {
    kind: 'shift-weight',
    label: 'shifting weight from foot to foot',
    parts: ['root', 'hips', 'torso'],
  },
  'sway-window': {
    kind: 'sway-window',
    label: 'swaying at the window',
    parts: ['root', 'head', 'torso'],
  },
  'nurse-cup': {
    kind: 'nurse-cup',
    label: 'nursing a cup',
    parts: ['forearmLeft', 'forearmRight', 'head', 'torso'],
  },
  'type-laptop': {
    kind: 'type-laptop',
    label: 'typing on a laptop',
    parts: ['forearmLeft', 'forearmRight', 'head', 'torso'],
  },
  'glance-phone': {
    kind: 'glance-phone',
    label: 'glancing at a phone',
    parts: ['forearmRight', 'armRight', 'head'],
  },
  'bob-to-radio': {
    kind: 'bob-to-radio',
    label: 'nodding along to a portable radio',
    parts: ['head', 'torso', 'shinLeft'],
  },
  'tap-watch': {
    kind: 'tap-watch',
    label: 'checking a watch',
    parts: ['forearmLeft', 'armLeft', 'head'],
  },
});

/** Every idle motion, sorted, for diagnostics. */
export const IDLE_MOTION_KINDS: readonly IdleMotionKind[] = Object.freeze(
  Object.keys(IDLE_MOTIONS).sort() as IdleMotionKind[],
);

interface Rotation3 {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}

interface PoseOffset {
  readonly position?: Vec3;
  readonly rotation?: Rotation3;
  readonly scale?: Vec3;
}

export type PoseOffsets = Partial<Record<FigurePartKey, PoseOffset>>;

export interface MotionContext {
  readonly phase: number;
  readonly pose: FigurePose;
  readonly role: FigureRole;
  readonly variation: FigureVariation;
}

/** Smooth 0..1 pulse repeated once per turn of `phase`. */
function pulse(phase: number): number {
  const wave = Math.sin(phase);
  return wave > 0 ? wave * wave : 0;
}

/** Smooth 0..1 pulse that holds for the second half of the cycle. */
function heldPulse(phase: number): number {
  const wave = Math.sin(phase);
  if (wave <= 0) return 0;
  return Math.min(wave * 1.6, 1);
}

/**
 * The idle loops, as pure functions of the phase. Each returns the offsets the
 * rig adds on top of the base pose, which keeps `applyPose` stateless and makes
 * `update(dt)` the only thing that can advance a figure.
 */
export function idleOffsets(kind: IdleMotionKind, context: MotionContext): PoseOffsets {
  const { phase } = context;
  const slow = phase * 0.62;
  const breath = Math.sin(phase) * 0.016;
  const lean = context.pose === 'seated' ? 0.06 : 0.02;

  switch (kind) {
    case 'breathe':
      return {
        torso: { scale: [1, 1 + breath, 1] },
        head: { rotation: { x: Math.sin(slow) * 0.03 } },
      };
    case 'sip-coffee': {
      const raise = heldPulse(phase);
      return {
        armRight: { rotation: { x: -0.42 * raise, z: -0.12 * raise } },
        forearmRight: { rotation: { x: -(1.15 * raise) } },
        head: { rotation: { x: 0.16 * raise - 0.02 } },
        torso: { scale: [1, 1 + breath, 1], rotation: { x: -0.03 * raise } },
      };
    }
    case 'read-newspaper': {
      const turn = pulse(phase * 0.5);
      return {
        armLeft: { rotation: { x: -0.55 - lean, z: 0.18 } },
        forearmLeft: { rotation: { x: -0.85 } },
        armRight: { rotation: { x: -0.32 - lean, z: -0.24 } },
        forearmRight: { rotation: { x: -0.62 - turn * 0.35 } },
        head: { rotation: { x: 0.22 } },
      };
    }
    case 'stir-counter': {
      const stir = phase * 1.6;
      return {
        torso: { rotation: { x: 0.12, y: Math.sin(stir * 0.5) * 0.06 } },
        armRight: { rotation: { x: -0.35, z: -0.2 + Math.sin(stir) * 0.16 } },
        forearmRight: { rotation: { x: -0.5, y: Math.cos(stir) * 0.3 } },
        hips: { rotation: { y: Math.sin(stir * 0.4) * 0.05 } },
      };
    }
    case 'wipe-counter': {
      const sweep = phase * 1.15;
      return {
        torso: { rotation: { x: 0.18, y: Math.sin(sweep) * 0.12 } },
        armRight: { rotation: { x: -0.5, y: Math.sin(sweep) * 0.55, z: -0.18 } },
        forearmRight: { rotation: { x: -0.35 } },
        hips: { rotation: { y: Math.sin(sweep) * 0.1 } },
      };
    }
    case 'shift-weight':
      return {
        root: { position: [0, Math.abs(Math.sin(phase)) * 0.012, 0] },
        hips: { rotation: { z: Math.sin(phase) * 0.06 } },
        torso: { rotation: { z: -Math.sin(phase) * 0.035 }, scale: [1, 1 + breath, 1] },
      };
    case 'sway-window':
      return {
        root: { rotation: { y: Math.sin(slow) * 0.07 } },
        torso: { rotation: { z: Math.sin(slow + 0.4) * 0.03 }, scale: [1, 1 + breath, 1] },
        head: { rotation: { y: Math.sin(slow * 0.6 + 1.2) * 0.18, x: 0.04 } },
      };
    case 'nurse-cup':
      return {
        armLeft: { rotation: { x: -0.5 - lean, z: 0.24 } },
        forearmLeft: { rotation: { x: -0.95 } },
        armRight: { rotation: { x: -0.3 - lean, z: -0.3 } },
        forearmRight: { rotation: { x: -0.7 } },
        head: { rotation: { x: 0.1 + Math.sin(slow) * 0.03 } },
        torso: { scale: [1, 1 + breath, 1] },
      };
    case 'type-laptop': {
      const tap = Math.sin(phase * 5.5) * 0.035;
      return {
        torso: { rotation: { x: 0.2 }, scale: [1, 1 + breath, 1] },
        armLeft: { rotation: { x: -0.55, z: 0.22 } },
        forearmLeft: { rotation: { x: -0.85 + tap } },
        armRight: { rotation: { x: -0.55, z: -0.22 } },
        forearmRight: { rotation: { x: -0.85 - tap } },
        head: { rotation: { x: 0.26 } },
      };
    }
    case 'glance-phone': {
      const glance = heldPulse(phase * 0.75);
      return {
        armRight: { rotation: { x: -0.55 * glance, z: -0.2 * glance } },
        forearmRight: { rotation: { x: -1.05 * glance } },
        head: { rotation: { x: 0.3 * glance, y: -0.06 * glance } },
      };
    }
    case 'bob-to-radio': {
      const beat = phase * 1.5;
      return {
        head: { rotation: { z: Math.sin(beat) * 0.07, x: Math.sin(beat * 2) * 0.03 } },
        torso: { rotation: { z: Math.sin(beat + 0.3) * 0.035 }, scale: [1, 1 + breath, 1] },
        shinLeft: { rotation: { x: context.pose === 'seated' ? 0 : Math.sin(beat * 2) * 0.12 } },
      };
    }
    case 'tap-watch': {
      const check = heldPulse(phase * 0.6);
      return {
        armLeft: { rotation: { x: -0.75 * check, z: 0.3 * check } },
        forearmLeft: { rotation: { x: -1.3 * check, y: 0.4 * check } },
        head: { rotation: { x: 0.34 * check, z: -0.05 * check } },
      };
    }
    default:
      return {};
  }
}

/* -------------------------------------------------------------------------- */
/* Garments                                                                   */
/* -------------------------------------------------------------------------- */

interface GarmentContext {
  readonly parts: Readonly<Record<FigurePartKey, THREE.Object3D>>;
  readonly resources: FigureResources;
  readonly materials: FigureMaterialLibrary;
  readonly dims: FigureDimensions;
  readonly item: WardrobeItem;
  readonly colorway: number;
  readonly pattern: FigurePattern;
  readonly figureId: string;
  readonly skin: THREE.Material;
}

function dyeMaterial(context: GarmentContext): THREE.MeshStandardMaterial {
  return context.materials.dye(context.colorway, context.pattern);
}

function nameOf(context: GarmentContext, suffix: string): string {
  return `${context.figureId}:${context.item.id}:${suffix}`;
}

/** Sleeves are parented to the limb groups so they swing with the idle loop. */
function addSleeves(context: GarmentContext, material: THREE.Material, long: boolean): void {
  const { dims, parts } = context;
  const width = 0.11 + context.item.form.fit * 0.09;
  for (const side of ['Left', 'Right'] as const) {
    const arm = parts[side === 'Left' ? 'armLeft' : 'armRight'];
    const forearm = parts[side === 'Left' ? 'forearmLeft' : 'forearmRight'];
    prim(arm, context.resources, 'cylinder', material, nameOf(context, `sleeve-upper-${side}`), {
      position: [0, -dims.upperArm * 0.45, 0],
      scale: [width * 2, dims.upperArm * 0.95, width * 2],
    });
    if (long) {
      prim(forearm, context.resources, 'cylinder', material, nameOf(context, `sleeve-fore-${side}`), {
        position: [0, -dims.forearm * 0.42, 0],
        scale: [width * 1.8, dims.forearm * 0.9, width * 1.8],
      });
    }
  }
}

function addCollar(context: GarmentContext, material: THREE.Material): void {
  const { dims, parts } = context;
  const collar = context.item.form.collar;
  const neckY = dims.torsoLength - 0.01;
  switch (collar) {
    case 'open':
      prim(parts.torso, context.resources, 'box', material, nameOf(context, 'collar-left'), {
        position: [-0.055, neckY, 0.03],
        scale: [0.07, 0.05, 0.16],
        rotation: [0.25, 0.35, 0.3],
      });
      prim(parts.torso, context.resources, 'box', material, nameOf(context, 'collar-right'), {
        position: [0.055, neckY, 0.03],
        scale: [0.07, 0.05, 0.16],
        rotation: [0.25, -0.35, -0.3],
      });
      return;
    case 'tall':
      prim(parts.torso, context.resources, 'cylinder', material, nameOf(context, 'collar-tall'), {
        position: [0, neckY + 0.02, 0],
        scale: [0.17, 0.1, 0.17],
      });
      return;
    case 'lapel':
      prim(parts.torso, context.resources, 'box', material, nameOf(context, 'lapel-left'), {
        position: [-0.075, neckY - 0.14, 0.075],
        scale: [0.1, 0.26, 0.03],
        rotation: [0.05, 0.12, 0.22],
      });
      prim(parts.torso, context.resources, 'box', material, nameOf(context, 'lapel-right'), {
        position: [0.075, neckY - 0.14, 0.075],
        scale: [0.1, 0.26, 0.03],
        rotation: [0.05, -0.12, -0.22],
      });
      return;
    case 'roll':
      prim(parts.torso, context.resources, 'torus', material, nameOf(context, 'collar-roll'), {
        position: [0, neckY + 0.01, 0],
        scale: [0.24, 0.24, 0.24],
        rotation: [Math.PI / 2, 0, 0],
      });
      return;
    case 'hood':
      prim(parts.torso, context.resources, 'sphere', material, nameOf(context, 'hood'), {
        position: [0, neckY + 0.02, -0.11],
        scale: [0.3, 0.32, 0.28],
      });
      return;
    case 'peter-pan':
      prim(parts.torso, context.resources, 'box', material, nameOf(context, 'collar-peter-pan'), {
        position: [0, neckY, 0.05],
        scale: [0.2, 0.04, 0.1],
      });
      return;
    default:
      return;
  }
}

function addTopShell(context: GarmentContext, options: { hem: number; extra?: number }): THREE.Mesh {
  const { dims } = context;
  const form = context.item.form;
  const material = dyeMaterial(context);
  const width = (dims.shoulderHalf * 2 + 0.03) * (1 + form.fit * 0.22);
  const depth = dims.chestDepth * (1 + form.fit * 0.3) + (options.extra ?? 0);
  const top = dims.torsoLength + 0.02;
  const bottom = options.hem;
  const height = Math.max(top - bottom, 0.1);
  return prim(
    context.parts.torso,
    context.resources,
    'box',
    material,
    nameOf(context, 'shell'),
    {
      position: [0, (top + bottom) / 2, 0],
      scale: [width, height, depth],
    },
  );
}

function buildShirt(context: GarmentContext): void {
  addTopShell(context, { hem: -0.04 });
  addCollar(context, dyeMaterial(context));
  addSleeves(context, dyeMaterial(context), context.item.form.sleeve === 'long');
}

function buildBlouse(context: GarmentContext): void {
  const material = dyeMaterial(context);
  addTopShell(context, { hem: -0.02 });
  addCollar(context, material);
  addSleeves(context, material, context.item.form.sleeve === 'long' || context.item.form.sleeve === 'puff');
  prim(context.parts.hips, context.resources, 'box', material, nameOf(context, 'waist-band'), {
    position: [0, 0.01, 0],
    scale: [0.3, 0.06, 0.2],
  });
}

function buildKnit(context: GarmentContext): void {
  const material = dyeMaterial(context);
  addTopShell(context, { hem: -0.08, extra: 0.03 });
  addCollar(context, material);
  addSleeves(context, material, true);
  prim(context.parts.hips, context.resources, 'box', material, nameOf(context, 'knit-hem'), {
    position: [0, -0.09, 0],
    scale: [0.31, 0.05, 0.22],
  });
}

function buildDress(context: GarmentContext): void {
  const { dims } = context;
  const material = dyeMaterial(context);
  const form = context.item.form;
  addTopShell(context, { hem: 0.06 });
  addCollar(context, material);
  addSleeves(context, material, form.sleeve === 'long' || form.sleeve === 'puff');
  const hemY = -0.18 - form.length * 0.6;
  const flare = 0.3 + form.flare * 0.34;
  prim(context.parts.hips, context.resources, 'cone', material, nameOf(context, 'skirt'), {
    position: [0, hemY / 2 + 0.04, 0],
    scale: [flare * 1.5, Math.abs(hemY) * 0.95, flare * 1.3],
    rotation: [Math.PI, 0, 0],
  });
  prim(context.parts.hips, context.resources, 'box', material, nameOf(context, 'waist'), {
    position: [0, 0.03, 0],
    scale: [0.3, 0.05, dims.chestDepth * 0.95],
  });
}

function buildVest(context: GarmentContext): void {
  const material = dyeMaterial(context);
  addTopShell(context, { hem: -0.02 });
  addCollar(context, material);
  prim(context.parts.torso, context.resources, 'box', context.materials.accent(1), nameOf(context, 'buttons'), {
    position: [0, context.dims.torsoLength * 0.45, context.dims.chestDepth * 0.55],
    scale: [0.03, 0.24, 0.02],
  });
}

function buildJacket(context: GarmentContext): void {
  const { dims } = context;
  const material = dyeMaterial(context);
  const form = context.item.form;
  const hem = -0.1 - form.length * 0.28;
  addTopShell(context, { hem, extra: form.fit * 0.05 + 0.03 });
  addCollar(context, material);
  addSleeves(context, material, true);
  // Open front: the two panels leave a visible seam down the chest.
  prim(context.parts.torso, context.resources, 'box', context.materials.accent(0), nameOf(context, 'front-seam'), {
    position: [0, dims.torsoLength * 0.42, dims.chestDepth * 0.62],
    scale: [0.015, dims.torsoLength * 0.8, 0.02],
  });
}

function buildCoat(context: GarmentContext): void {
  const { dims } = context;
  const material = dyeMaterial(context);
  const form = context.item.form;
  const hem = -0.3 - form.length * 0.5;
  addTopShell(context, { hem, extra: 0.06 });
  addCollar(context, material);
  addSleeves(context, material, true);
  prim(context.parts.hips, context.resources, 'box', material, nameOf(context, 'coat-skirt'), {
    position: [0, -0.18 - form.length * 0.2, 0],
    scale: [0.38 + form.flare * 0.16, 0.42 + form.length * 0.5, dims.chestDepth + 0.1],
  });
  prim(context.parts.hips, context.resources, 'box', context.materials.accent(1), nameOf(context, 'belt'), {
    position: [0, 0.02, 0],
    scale: [0.36, 0.05, dims.chestDepth + 0.11],
  });
}

function buildApron(context: GarmentContext): void {
  const { dims } = context;
  const material = dyeMaterial(context);
  const hem = -0.34;
  prim(context.parts.torso, context.resources, 'box', material, nameOf(context, 'bib'), {
    position: [0, dims.torsoLength * 0.4, dims.chestDepth * 0.55 + 0.01],
    scale: [0.26, dims.torsoLength * 0.7, 0.03],
  });
  prim(context.parts.hips, context.resources, 'box', material, nameOf(context, 'skirt'), {
    position: [0, hem / 2 + 0.02, dims.chestDepth * 0.5],
    scale: [0.34, Math.abs(hem), 0.05 + context.item.form.flare * 0.06],
  });
  prim(context.parts.hips, context.resources, 'box', context.materials.accent(0), nameOf(context, 'waist-tie'), {
    position: [0, 0.02, 0],
    scale: [0.34, 0.035, dims.chestDepth + 0.06],
  });
  prim(context.parts.torso, context.resources, 'box', context.materials.accent(0), nameOf(context, 'neck-strap'), {
    position: [0, dims.torsoLength * 0.78, dims.chestDepth * 0.3],
    scale: [0.05, 0.03, 0.02],
  });
}

function buildLeotard(context: GarmentContext): void {
  addTopShell(context, { hem: 0.06 });
  prim(context.parts.hips, context.resources, 'box', dyeMaterial(context), nameOf(context, 'high-cut'), {
    position: [0, -0.02, 0],
    scale: [0.26, 0.12, context.dims.chestDepth * 0.9],
  });
}

function buildTrousers(context: GarmentContext, denim: boolean): void {
  const { dims, parts } = context;
  const material = dyeMaterial(context);
  const form = context.item.form;
  const width = 0.1 + form.fit * 0.09;
  prim(parts.hips, context.resources, 'box', material, nameOf(context, 'seat'), {
    position: [0, -0.06, 0],
    scale: [dims.hipHalf * 2 + 0.05 + form.fit * 0.08, 0.2 + form.fit * 0.05, dims.chestDepth * 0.85],
  });
  const fullLength = form.length > 0.55;
  for (const side of ['Left', 'Right'] as const) {
    const leg = parts[side === 'Left' ? 'legLeft' : 'legRight'];
    const shin = parts[side === 'Left' ? 'shinLeft' : 'shinRight'];
    const thighCover = form.length > 0.4 ? dims.thigh * 0.92 : dims.thigh * 0.45;
    prim(leg, context.resources, 'cylinder', material, nameOf(context, `thigh-${side}`), {
      position: [0, -dims.thigh * 0.42, 0],
      scale: [width * 2, thighCover * 1.2, width * 2],
    });
    if (fullLength) {
      prim(shin, context.resources, 'cylinder', material, nameOf(context, `shin-${side}`), {
        position: [0, -dims.shin * 0.45, 0],
        scale: [width * 1.7, dims.shin * 0.95, width * 1.7],
      });
    }
    if (denim) {
      prim(leg, context.resources, 'box', context.materials.accent(3), nameOf(context, `pocket-${side}`), {
        position: [side === 'Left' ? -width : width, -0.05, dims.chestDepth * 0.4],
        scale: [0.06, 0.08, 0.02],
      });
    }
  }
  if (denim || form.length > 0.55) {
    prim(parts.hips, context.resources, 'box', context.materials.accent(0), nameOf(context, 'waistband'), {
      position: [0, 0.02, 0],
      scale: [dims.hipHalf * 2 + 0.06, 0.045, dims.chestDepth * 0.86],
    });
  }
}

function buildSkirt(context: GarmentContext): void {
  const { dims, parts } = context;
  const material = dyeMaterial(context);
  const form = context.item.form;
  const hemY = -0.14 - form.length * 0.52;
  const radius = 0.19 + form.flare * 0.2;
  prim(parts.hips, context.resources, 'cone', material, nameOf(context, 'skirt'), {
    position: [0, hemY / 2 + 0.03, 0],
    scale: [radius * 2, Math.abs(hemY), radius * 1.7],
    rotation: [Math.PI, 0, 0],
  });
  prim(parts.hips, context.resources, 'box', context.materials.accent(0), nameOf(context, 'waistband'), {
    position: [0, 0.02, 0],
    scale: [dims.hipHalf * 2 + 0.06, 0.05, dims.chestDepth * 0.9],
  });
  if (context.item.pattern === 'check') {
    for (let pleat = 0; pleat < 6; pleat += 1) {
      const angle = (pleat / 6) * Math.PI * 2;
      prim(parts.hips, context.resources, 'box', material, nameOf(context, `pleat-${pleat}`), {
        position: [Math.sin(angle) * radius * 0.55, hemY * 0.6, Math.cos(angle) * radius * 0.42],
        scale: [0.03, Math.abs(hemY) * 0.8, 0.03],
        rotation: [0, angle, 0],
      });
    }
  }
}

function buildLeggings(context: GarmentContext): void {
  const { dims, parts } = context;
  const material = dyeMaterial(context);
  const width = 0.085;
  for (const side of ['Left', 'Right'] as const) {
    const leg = parts[side === 'Left' ? 'legLeft' : 'legRight'];
    const shin = parts[side === 'Left' ? 'shinLeft' : 'shinRight'];
    prim(leg, context.resources, 'cylinder', material, nameOf(context, `thigh-${side}`), {
      position: [0, -dims.thigh * 0.45, 0],
      scale: [width * 2, dims.thigh * 0.95, width * 2],
    });
    prim(shin, context.resources, 'cylinder', material, nameOf(context, `shin-${side}`), {
      position: [0, -dims.shin * 0.5, 0],
      scale: [width * 1.9, dims.shin, width * 1.9],
    });
  }
  prim(parts.hips, context.resources, 'box', material, nameOf(context, 'waistband'), {
    position: [0, 0.02, 0],
    scale: [dims.hipHalf * 2 + 0.05, 0.1, dims.chestDepth * 0.88],
  });
}

function buildHeadwear(context: GarmentContext): void {
  const material = dyeMaterial(context);
  const head = context.parts.head;
  const accent = context.materials.accent(context.colorway);
  const radius = context.dims.headRadius;
  switch (context.item.form.cut) {
    case 'cap':
      prim(head, context.resources, 'sphere', material, nameOf(context, 'crown'), {
        position: [0, 0.05, -0.02],
        scale: [radius * 2.15, radius * 1.5, radius * 2.3],
      });
      prim(head, context.resources, 'box', accent, nameOf(context, 'peak'), {
        position: [0, 0.015, radius * 1.25],
        scale: [radius * 1.7, 0.015, radius * 1.15],
      });
      return;
    case 'hat':
      prim(head, context.resources, 'cylinder', material, nameOf(context, 'crown'), {
        position: [0, radius * 1.1, 0],
        scale: [radius * 1.9, radius * 1.2, radius * 1.9],
      });
      prim(head, context.resources, 'cylinder', material, nameOf(context, 'brim'), {
        position: [0, radius * 0.55, 0],
        scale: [radius * 4.4, 0.012, radius * 4.4],
      });
      prim(head, context.resources, 'cylinder', accent, nameOf(context, 'band'), {
        position: [0, radius * 0.72, 0],
        scale: [radius * 2, 0.03, radius * 2],
      });
      return;
    case 'beret':
      prim(head, context.resources, 'sphere', material, nameOf(context, 'beret'), {
        position: [-radius * 0.2, radius * 1.05, -radius * 0.1],
        scale: [radius * 3.1, radius * 1.1, radius * 2.9],
      });
      prim(head, context.resources, 'sphere', accent, nameOf(context, 'nub'), {
        position: [-radius * 0.2, radius * 1.6, -radius * 0.1],
        scale: [0.02, 0.02, 0.02],
      });
      return;
    case 'beanie':
      prim(head, context.resources, 'cylinder', material, nameOf(context, 'beanie'), {
        position: [0, radius * 1.35, -0.005],
        scale: [radius * 2.15, radius * 1.9, radius * 2.15],
      });
      prim(head, context.resources, 'torus', material, nameOf(context, 'cuff'), {
        position: [0, radius * 0.55, 0],
        scale: [radius * 2.3, radius * 2.3, radius * 2.3],
        rotation: [Math.PI / 2, 0, 0],
      });
      return;
    case 'headscarf':
      prim(head, context.resources, 'sphere', material, nameOf(context, 'scarf'), {
        position: [0, 0.06, -0.01],
        scale: [radius * 2.3, radius * 2.1, radius * 2.3],
      });
      prim(head, context.resources, 'box', material, nameOf(context, 'tail'), {
        position: [radius * 0.2, -radius * 1.1, -radius * 1.4],
        scale: [0.06, 0.16, 0.04],
        rotation: [0.4, 0, 0.25],
      });
      return;
    default:
      return;
  }
}

function buildFootwear(context: GarmentContext): void {
  const { dims, parts } = context;
  const material = dyeMaterial(context);
  const sole = context.materials.panel('sole');
  const cut = context.item.form.cut;
  for (const side of ['Left', 'Right'] as const) {
    const shin = parts[side === 'Left' ? 'shinLeft' : 'shinRight'];
    const ankle = -dims.shin + 0.035;
    if (cut === 'boots') {
      prim(shin, context.resources, 'cylinder', material, nameOf(context, `boot-${side}`), {
        position: [0, ankle + 0.09, 0],
        scale: [0.135, 0.2, 0.135],
      });
    }
    prim(shin, context.resources, 'box', material, nameOf(context, `shoe-${side}`), {
      position: [0, ankle, 0.045],
      scale: [0.1, cut === 'trainers' ? 0.08 : 0.065, FOOT_LENGTH],
    });
    prim(shin, context.resources, 'box', sole, nameOf(context, `sole-${side}`), {
      position: [0, ankle - 0.03, 0.045],
      scale: [0.105, 0.025, FOOT_LENGTH + 0.01],
    });
  }
}

function buildAccessory(context: GarmentContext): void {
  const material = dyeMaterial(context);
  const accent = context.materials.accent(context.colorway);
  const { dims, parts } = context;
  switch (context.item.form.cut) {
    case 'tie':
      prim(parts.torso, context.resources, 'box', material, nameOf(context, 'tie'), {
        position: [0, dims.torsoLength * 0.62, dims.chestDepth * 0.52],
        scale: [0.05, dims.torsoLength * 0.62, 0.02],
        rotation: [0, 0, 0.05],
      });
      prim(parts.torso, context.resources, 'box', material, nameOf(context, 'knot'), {
        position: [0, dims.torsoLength * 0.92, dims.chestDepth * 0.5],
        scale: [0.06, 0.06, 0.03],
      });
      return;
    case 'scarf':
      prim(parts.torso, context.resources, 'torus', material, nameOf(context, 'scarf-ring'), {
        position: [0, dims.torsoLength - 0.01, 0],
        scale: [0.28, 0.28, 0.28],
        rotation: [Math.PI / 2, 0, 0],
      });
      prim(parts.torso, context.resources, 'box', material, nameOf(context, 'scarf-tail-left'), {
        position: [-0.06, dims.torsoLength * 0.55, dims.chestDepth * 0.45],
        scale: [0.08, dims.torsoLength * 0.8, 0.03],
      });
      prim(parts.torso, context.resources, 'box', material, nameOf(context, 'scarf-tail-right'), {
        position: [0.06, dims.torsoLength * 0.6, dims.chestDepth * 0.5],
        scale: [0.08, dims.torsoLength * 0.7, 0.03],
      });
      return;
    case 'bag':
      prim(parts.torso, context.resources, 'box', accent, nameOf(context, 'strap'), {
        position: [0.07, dims.torsoLength * 0.6, 0],
        scale: [0.03, dims.torsoLength * 0.9, 0.03],
        rotation: [0, 0, -0.3],
      });
      prim(parts.hips, context.resources, 'box', material, nameOf(context, 'tote'), {
        position: [0.19, -0.08, 0],
        scale: [0.14, 0.22, 0.07],
      });
      return;
    case 'glasses':
      prim(parts.head, context.resources, 'box', context.materials.panel('gloss-black'), nameOf(context, 'lens-left'), {
        position: [-0.055, 0.01, dims.headRadius * 1.0],
        scale: [0.07, 0.045, 0.02],
      });
      prim(parts.head, context.resources, 'box', context.materials.panel('gloss-black'), nameOf(context, 'lens-right'), {
        position: [0.055, 0.01, dims.headRadius * 1.0],
        scale: [0.07, 0.045, 0.02],
      });
      prim(parts.head, context.resources, 'box', context.materials.panel('gloss-black'), nameOf(context, 'bridge'), {
        position: [0, 0.01, dims.headRadius * 1.0],
        scale: [0.03, 0.012, 0.015],
      });
      return;
    default:
      return;
  }
}

/** Folds one garment from the shared primitives. */
function applyGarment(context: GarmentContext): void {
  switch (context.item.form.cut) {
    case 'shirt':
      buildShirt(context);
      return;
    case 'blouse':
      buildBlouse(context);
      return;
    case 'knit':
      buildKnit(context);
      return;
    case 'dress':
      buildDress(context);
      return;
    case 'vest':
      buildVest(context);
      return;
    case 'jacket':
      buildJacket(context);
      return;
    case 'coat':
      buildCoat(context);
      return;
    case 'apron':
      buildApron(context);
      return;
    case 'leotard':
      buildLeotard(context);
      return;
    case 'trousers':
      buildTrousers(context, false);
      return;
    case 'jeans':
      buildTrousers(context, true);
      return;
    case 'shorts':
      buildTrousers(context, false);
      return;
    case 'skirt':
      buildSkirt(context);
      return;
    case 'leggings':
      buildLeggings(context);
      return;
    case 'cap':
    case 'hat':
    case 'beret':
    case 'beanie':
    case 'headscarf':
      buildHeadwear(context);
      return;
    case 'shoes':
    case 'boots':
    case 'trainers':
      buildFootwear(context);
      return;
    case 'tie':
    case 'scarf':
    case 'bag':
    case 'glasses':
      buildAccessory(context);
      return;
    default:
      return;
  }
}

/* -------------------------------------------------------------------------- */
/* Hair                                                                       */
/* -------------------------------------------------------------------------- */

function buildHair(
  parts: Readonly<Record<FigurePartKey, THREE.Object3D>>,
  resources: FigureResources,
  materials: FigureMaterialLibrary,
  styleId: HairStyleId,
  tone: number,
  figureId: string,
): void {
  const style = hairStyle(styleId);
  const material = materials.hair(tone);
  const head = parts.head;
  const radius = HEAD_RADIUS;
  const key = (suffix: string): string => `${figureId}:hair:${suffix}`;
  const volume = style.volume;
  const length = style.length;

  // Every style shares a crown cap that sits high enough to leave the face clear.
  prim(head, resources, 'sphere', material, key('cap'), {
    position: [0, 0.052 + volume * 0.03, -0.02],
    scale: [radius * (2.05 + volume * 0.3), radius * (1.7 + volume * 0.35), radius * (2.05 + volume * 0.4)],
  });

  const backMass = (): void => {
    prim(head, resources, 'sphere', material, key('back-mass'), {
      position: [0, 0.02 + volume * 0.04, -radius * (1.0 + volume * 0.5)],
      scale: [radius * (2 + volume * 0.5), radius * (2 + volume * 0.6), radius * (1.6 + volume * 0.4)],
    });
  };

  const sidePanels = (drop: number, width = 1.1): void => {
    for (const side of [-1, 1] as const) {
      prim(head, resources, 'box', material, key(`side-${side}`), {
        position: [side * radius * width, -drop / 2 + 0.02, -radius * 0.15],
        scale: [radius * 0.75, drop, radius * 1.5],
        rotation: [0, 0, side * 0.08],
      });
    }
  };

  switch (style.silhouette) {
    case 'crop':
      return;
    case 'buzz':
      return;
    case 'side-part': {
      prim(head, resources, 'box', material, key('sweep'), {
        position: [radius * 0.15, 0.075, radius * 0.3],
        scale: [radius * 2.1, 0.035, radius * 1.7],
        rotation: [0.12, 0, -0.12],
      });
      return;
    }
    case 'pompadour': {
      prim(head, resources, 'cylinder', material, key('roll'), {
        position: [0, radius * 1.5, radius * 0.25],
        scale: [radius * 2.1, radius * 1.5, radius * 1.3],
        rotation: [Math.PI / 2, 0, 0],
      });
      return;
    }
    case 'victory-rolls': {
      for (const side of [-1, 1] as const) {
        prim(head, resources, 'torus', material, key(`roll-${side}`), {
          position: [side * radius * 1.15, radius * 0.75, radius * 0.05],
          scale: [radius * 1.5, radius * 1.5, radius * 1.5],
          rotation: [0, side * 0.5, 0],
        });
      }
      return;
    }
    case 'bob': {
      sidePanels(0.11 + length * 0.16, 1.15);
      prim(head, resources, 'box', material, key('back'), {
        position: [0, -0.05, -radius * 1.15],
        scale: [radius * 2.1, 0.2 + length * 0.2, radius * 0.8],
      });
      return;
    }
    case 'beehive': {
      prim(head, resources, 'cone', material, key('hive-a'), {
        position: [0, radius * 2.1, -radius * 0.35],
        scale: [radius * 1.9, radius * 1.8, radius * 1.7],
      });
      prim(head, resources, 'cone', material, key('hive-b'), {
        position: [0, radius * 2.9, -radius * 0.5],
        scale: [radius * 1.1, radius * 1.1, radius * 1.0],
      });
      backMass();
      return;
    }
    case 'bouffant': {
      prim(head, resources, 'sphere', material, key('bouffant'), {
        position: [0, radius * (1.55 + volume * 0.3), -radius * 0.35],
        scale: [radius * (2.6 + volume * 0.9), radius * (2.1 + volume * 0.7), radius * (2.3 + volume * 0.6)],
      });
      backMass();
      if (length > 0.4) sidePanels(0.12 + length * 0.24, 1.2);
      return;
    }
    case 'curls': {
      backMass();
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        prim(head, resources, 'sphere', material, key(`curl-${index}`), {
          position: [
            Math.sin(angle) * radius * 1.3,
            radius * (0.75 + Math.cos(angle) * 0.45),
            -radius * 0.55 + Math.cos(angle) * radius * 0.5,
          ],
          scale: [radius * 0.95, radius * 0.95, radius * 0.95],
        });
      }
      return;
    }
    case 'shag': {
      sidePanels(0.14 + length * 0.26, 1.2);
      prim(head, resources, 'box', material, key('fringe'), {
        position: [0, radius * 0.85, radius * 0.72],
        scale: [radius * 2.2, 0.05, radius * 0.9],
        rotation: [0.35, 0, 0],
      });
      return;
    }
    case 'mullet': {
      sidePanels(0.1, 1.05);
      prim(head, resources, 'box', material, key('back-long'), {
        position: [0, -0.14 - length * 0.08, -radius * 1.05],
        scale: [radius * 1.9, 0.3 + length * 0.25, radius * 0.75],
        rotation: [0.12, 0, 0],
      });
      return;
    }
    case 'long-straight': {
      sidePanels(0.26 + length * 0.34, 1.25);
      prim(head, resources, 'box', material, key('back-long'), {
        position: [0, -0.2 - length * 0.16, -radius * 1.15],
        scale: [radius * 2.0, 0.42 + length * 0.32, radius * 0.7],
      });
      return;
    }
    case 'bun': {
      prim(head, resources, 'sphere', material, key('bun'), {
        position: [0, radius * 0.5, -radius * 1.6],
        scale: [radius * 1.6, radius * 1.5, radius * 1.4],
      });
      return;
    }
    case 'top-knot': {
      prim(head, resources, 'sphere', material, key('knot'), {
        position: [0, radius * (1.75 + volume * 0.2), -radius * 0.15],
        scale: [radius * 1.2, radius * 1.1, radius * 1.2],
      });
      return;
    }
    case 'waves': {
      sidePanels(0.16 + length * 0.3, 1.15);
      for (const side of [-1, 1] as const) {
        prim(head, resources, 'sphere', material, key(`wave-${side}`), {
          position: [side * radius * 1.35, radius * 0.45, radius * 0.1],
          scale: [radius * 1.1, radius * 1.2, radius * 1.1],
        });
      }
      prim(head, resources, 'box', material, key('fringe'), {
        position: [0, radius * 0.8, radius * 0.78],
        scale: [radius * 1.9, 0.045, radius * 0.7],
        rotation: [0.3, 0, 0],
      });
      return;
    }
    default:
      return;
  }
}

/** The hairstyle silhouettes the rig implements, exposed for the tests. */
export const HAIR_SILHOUETTES: readonly HairSilhouette[] = Object.freeze(
  [...new Set(Object.values(HAIR_STYLES).map((style) => style.silhouette))].sort(),
);

/* -------------------------------------------------------------------------- */
/* Gadget mounting                                                            */
/* -------------------------------------------------------------------------- */

export interface GadgetMountAssignment {
  readonly gadget: GadgetId;
  readonly mount: GadgetMount;
}

/** The socket each mount position resolves to. */
export const GADGET_MOUNT_SOCKETS: Readonly<Record<GadgetMount, FigureSocketKey>> = Object.freeze({
  'hand-left': 'handLeft',
  'hand-right': 'handRight',
  'worn-head': 'headwear',
  'worn-ear': 'ears',
  'worn-shoulder': 'shoulderLeft',
  'worn-hip': 'hip',
  'carry-side': 'shoulderRight',
  surface: 'surface',
  lap: 'lap',
  ground: 'ground',
});

/**
 * Assigns a free socket to every gadget, in the order the blueprint lists them,
 * preferring the gadget's own mount list. Prop orders are stable, so the same
 * blueprint always yields the same assignment.
 */
export function assignGadgetMounts(gadgetIds: readonly GadgetId[]): readonly GadgetMountAssignment[] {
  const used = new Set<GadgetMount>();
  const assignments: GadgetMountAssignment[] = [];
  for (const gadget of gadgetIds) {
    const definition = GADGETS[gadget];
    const free = definition.mounts.find((mount) => !used.has(mount));
    const mount = free ?? 'surface';
    used.add(mount);
    assignments.push(Object.freeze({ gadget, mount }));
  }
  return Object.freeze(assignments);
}

/* -------------------------------------------------------------------------- */
/* Figure instance                                                            */
/* -------------------------------------------------------------------------- */

interface PartBase {
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

const MAX_IDLE_DELTA = 0.25;

export interface FigureBuildOptions {
  readonly blueprint: FigureBlueprint;
  readonly year: YearId;
  readonly placed: PlacedFigure;
  readonly resources: FigureResources;
  readonly materials: FigureMaterialLibrary;
  /** Table surface height for seated figures; defaults to `placed.surfaceHeight`. */
  readonly surfaceHeight?: number;
}

class Figure implements FigureInstance {
  readonly id: string;
  readonly year: YearId;
  readonly blueprint: FigureBlueprint;
  readonly root: THREE.Group;
  readonly parts: Readonly<Record<FigurePartKey, THREE.Object3D>>;
  readonly sockets: Readonly<Record<FigureSocketKey, THREE.Object3D>>;
  readonly props: readonly FigureProp[];
  readonly height: number;
  readonly footprintRadius: number;
  readonly motion: IdleMotionKind;
  readonly motionSpeed: number;
  readonly variation: FigureVariation;
  readonly position: RoomPoint;
  readonly facing: number;

  private readonly bases = new Map<FigurePartKey, PartBase>();
  private phaseValue: number;
  private readonly dims: FigureDimensions;
  private readonly handSockets: readonly FigureSocketKey[];

  constructor(options: FigureBuildOptions) {
    const { blueprint, placed } = options;
    this.id = blueprint.id;
    this.year = options.year;
    this.blueprint = blueprint;
    this.motion = blueprint.motion;
    this.variation = placed.variation;
    this.position = placed.position;
    this.facing = placed.facing;
    this.dims = figureDimensions(blueprint);
    this.height = this.dims.stature;
    this.footprintRadius = blueprint.pose === 'seated' ? 0.3 : 0.24;
    this.motionSpeed = placed.variation.speed * (blueprint.role === 'barista' ? 1.15 : 1);
    this.phaseValue = placed.variation.phase;

    const resources = options.resources;
    const materials = options.materials;
    const root = new THREE.Group();
    root.name = `patron-figure:${blueprint.id}`;
    this.root = root;
    root.position.set(placed.position.x, placed.position.y, placed.position.z);
    root.rotation.y = placed.facing;

    const body = group(root, `${blueprint.id}:body`);
    body.scale.setScalar(this.dims.scale);

    const hipsY = blueprint.pose === 'seated' ? SEAT_HEIGHT / this.dims.scale : STANDING_HIP_HEIGHT;
    const hips = group(body, `${blueprint.id}:hips`, [0, hipsY, 0]);
    const torso = group(hips, `${blueprint.id}:torso`);
    const head = group(torso, `${blueprint.id}:head`, [0, this.dims.headY, 0]);

    const parts: Record<FigurePartKey, THREE.Object3D> = {
      root,
      hips,
      torso,
      head,
      hair: group(head, `${blueprint.id}:hair`),
      armLeft: group(torso, `${blueprint.id}:arm-left`, [this.dims.shoulderHalf, this.dims.torsoLength - 0.04, 0]),
      armRight: group(torso, `${blueprint.id}:arm-right`, [-this.dims.shoulderHalf, this.dims.torsoLength - 0.04, 0]),
      forearmLeft: null as unknown as THREE.Object3D,
      forearmRight: null as unknown as THREE.Object3D,
      legLeft: group(hips, `${blueprint.id}:leg-left`, [this.dims.hipHalf, 0, 0]),
      legRight: group(hips, `${blueprint.id}:leg-right`, [-this.dims.hipHalf, 0, 0]),
      shinLeft: null as unknown as THREE.Object3D,
      shinRight: null as unknown as THREE.Object3D,
    };
    parts.forearmLeft = group(parts.armLeft, `${blueprint.id}:forearm-left`, [0, -this.dims.upperArm, 0]);
    parts.forearmRight = group(parts.armRight, `${blueprint.id}:forearm-right`, [0, -this.dims.upperArm, 0]);
    parts.shinLeft = group(parts.legLeft, `${blueprint.id}:shin-left`, [0, -this.dims.thigh, 0]);
    parts.shinRight = group(parts.legRight, `${blueprint.id}:shin-right`, [0, -this.dims.thigh, 0]);
    this.parts = Object.freeze(parts);

    const sockets: Record<FigureSocketKey, THREE.Object3D> = {
      handLeft: group(parts.forearmLeft, `${blueprint.id}:hand-left`, [0, -this.dims.forearm, 0]),
      handRight: group(parts.forearmRight, `${blueprint.id}:hand-right`, [0, -this.dims.forearm, 0]),
      headwear: group(head, `${blueprint.id}:headwear`, [0, 0.07, -0.01]),
      ears: group(head, `${blueprint.id}:ears`, [0, 0.01, 0]),
      shoulderLeft: group(torso, `${blueprint.id}:shoulder-left`, [
        this.dims.shoulderHalf * 0.9,
        this.dims.torsoLength - 0.03,
        0,
      ]),
      shoulderRight: group(torso, `${blueprint.id}:shoulder-right`, [
        -this.dims.shoulderHalf * 0.9,
        this.dims.torsoLength - 0.03,
        0,
      ]),
      hip: group(hips, `${blueprint.id}:hip`, [this.dims.hipHalf * 1.15, -0.02, 0]),
      surface: group(root, `${blueprint.id}:surface`, [
        0,
        options.surfaceHeight ?? placed.surfaceHeight,
        placed.surfaceDistance,
      ]),
      lap: group(hips, `${blueprint.id}:lap`, [0, 0.05, 0.2]),
      ground: group(root, `${blueprint.id}:ground`, [0, 0, 0]),
    };
    this.sockets = Object.freeze(sockets);
    this.handSockets = ['handLeft', 'handRight'];

    this.buildBody(parts, resources, materials);
    this.buildOutfit(parts, resources, materials);
    buildHair(parts, resources, materials, blueprint.hair, this.hairTone(), blueprint.id);
    this.props = this.mountGadgets(resources, materials);

    for (const key of FIGURE_PART_KEYS) this.captureBase(key);
    this.applyPose();
  }

  get phase(): number {
    return this.phaseValue;
  }

  get seated(): boolean {
    return this.blueprint.pose === 'seated';
  }

  get role(): FigureRole {
    return this.blueprint.role;
  }

  get pose(): FigurePose {
    return this.blueprint.pose;
  }

  get zone(): FigureZone {
    return this.blueprint.zone;
  }

  advance(deltaSeconds: number): number {
    const delta = Number.isFinite(deltaSeconds)
      ? Math.min(Math.max(deltaSeconds, 0), MAX_IDLE_DELTA)
      : 0;
    this.phaseValue = (this.phaseValue + delta * this.motionSpeed) % (Math.PI * 2);
    this.applyPose();
    return this.phaseValue;
  }

  setPhase(phase: number): void {
    const value = Number.isFinite(phase) ? phase : 0;
    this.phaseValue = ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this.applyPose();
  }

  applyPose(): void {
    for (const key of FIGURE_PART_KEYS) {
      const part = this.parts[key];
      const base = this.bases.get(key);
      if (!base) continue;
      part.position.set(base.position[0], base.position[1], base.position[2]);
      part.rotation.set(base.rotation[0], base.rotation[1], base.rotation[2]);
      part.scale.set(base.scale[0], base.scale[1], base.scale[2]);
    }

    const offsets = idleOffsets(this.motion, {
      phase: this.phaseValue,
      pose: this.pose,
      role: this.role,
      variation: this.variation,
    });

    for (const key of Object.keys(offsets) as FigurePartKey[]) {
      const offset = offsets[key];
      const part = this.parts[key];
      if (!offset || !part) continue;
      if (offset.position) {
        part.position.x += offset.position[0];
        part.position.y += offset.position[1];
        part.position.z += offset.position[2];
      }
      if (offset.rotation) {
        part.rotation.x += offset.rotation.x ?? 0;
        part.rotation.y += offset.rotation.y ?? 0;
        part.rotation.z += offset.rotation.z ?? 0;
      }
      if (offset.scale) {
        part.scale.x *= offset.scale[0];
        part.scale.y *= offset.scale[1];
        part.scale.z *= offset.scale[2];
      }
    }

    // Held props counter-rotate a little so a cup or phone stays level while the
    // arm swings: the idle loop reads as intent instead of as a stiff puppet.
    for (const key of this.handSockets) {
      const socket = this.sockets[key];
      const armKey: FigurePartKey = key === 'handLeft' ? 'forearmLeft' : 'forearmRight';
      const forearm = this.parts[armKey];
      const base = this.bases.get(armKey);
      const baseX = base ? base.rotation[0] : 0;
      const baseZ = base ? base.rotation[2] : 0;
      socket.rotation.x = -(forearm.rotation.x - baseX) * 0.6;
      socket.rotation.z = -(forearm.rotation.z - baseZ) * 0.6;
    }
  }

  transform(): FigureTransform {
    return {
      id: this.id,
      x: this.root.position.x,
      y: this.root.position.y,
      z: this.root.position.z,
      facing: this.root.rotation.y,
      phase: this.phaseValue,
    };
  }

  describe(): FigureDescription {
    return Object.freeze({
      id: this.id,
      year: this.year,
      role: this.role,
      pose: this.pose,
      zone: this.zone,
      motion: this.motion,
      caption: this.blueprint.caption,
      hair: hairStyle(this.blueprint.hair).label,
      outfit: Object.freeze(this.blueprint.garments.map((garment) => wardrobeItem(garment.item).label)),
      gadgets: gadgetLabels(this.blueprint.gadgets),
      height: this.height,
      footprintRadius: this.footprintRadius,
    });
  }

  /* -- construction ------------------------------------------------------- */

  private hairTone(): number {
    const style = hairStyle(this.blueprint.hair);
    return style.colorTone + (this.blueprint.hairToneOffset ?? 0);
  }

  private captureBase(key: FigurePartKey): void {
    const part = this.parts[key];
    this.bases.set(key, {
      position: [part.position.x, part.position.y, part.position.z],
      rotation: [part.rotation.x, part.rotation.y, part.rotation.z],
      scale: [part.scale.x, part.scale.y, part.scale.z],
    });
  }

  private buildBody(
    parts: Readonly<Record<FigurePartKey, THREE.Object3D>>,
    resources: FigureResources,
    materials: FigureMaterialLibrary,
  ): void {
    const { dims } = this;
    const id = this.id;
    const skin = materials.skin(this.blueprint.skinTone);
    const core = materials.dye(0, 'solid');
    const accent = materials.accent(0);
    const seated = this.seated;

    // Torso core and pelvis: the layer every garment sits on top of.
    prim(parts.torso, resources, 'box', core, `${id}:torso-core`, {
      position: [0, dims.torsoLength * 0.48, 0],
      scale: [dims.shoulderHalf * 2, dims.torsoLength, dims.chestDepth],
    });
    prim(parts.torso, resources, 'sphere', core, `${id}:shoulders`, {
      position: [0, dims.torsoLength - 0.02, 0],
      scale: [dims.shoulderHalf * 2.1, 0.13, dims.chestDepth * 1.05],
    });
    prim(parts.hips, resources, 'box', core, `${id}:pelvis`, {
      position: [0, -0.05, 0],
      scale: [dims.hipHalf * 2 + 0.04, 0.2, dims.chestDepth * 0.85],
    });
    prim(parts.torso, resources, 'cylinder', skin, `${id}:neck`, {
      position: [0, dims.torsoLength + 0.02, 0],
      scale: [0.075, 0.09, 0.075],
    });
    prim(parts.head, resources, 'sphere', skin, `${id}:skull`, {
      position: [0, 0, 0],
      scale: [dims.headRadius * 2, dims.headRadius * 2.15, dims.headRadius * 2],
    });
    // Face: readable from the close-up inspect viewpoints the overlay offers.
    prim(parts.head, resources, 'sphere', materials.panel('gloss-black'), `${id}:eye-left`, {
      position: [-dims.headRadius * 0.42, 0.005, dims.headRadius * 0.98],
      scale: [0.024, 0.024, 0.02],
    });
    prim(parts.head, resources, 'sphere', materials.panel('gloss-black'), `${id}:eye-right`, {
      position: [dims.headRadius * 0.42, 0.005, dims.headRadius * 0.98],
      scale: [0.024, 0.024, 0.02],
    });
    prim(parts.head, resources, 'box', accent, `${id}:mouth`, {
      position: [0, -0.055, dims.headRadius * 0.95],
      scale: [0.045, 0.012, 0.02],
    });

    // Legs: the seated build folds the thighs forward and drops the shins.
    const fold = seated ? -Math.PI / 2 : 0;
    for (const side of ['Left', 'Right'] as const) {
      const leg = parts[side === 'Left' ? 'legLeft' : 'legRight'];
      const shin = parts[side === 'Left' ? 'shinLeft' : 'shinRight'];
      leg.rotation.x = fold;
      shin.rotation.x = -fold;
      prim(leg, resources, 'cylinder', skin, `${id}:thigh-${side}`, {
        position: [0, -dims.thigh * 0.5, 0],
        scale: [0.13, dims.thigh, 0.13],
      });
      prim(shin, resources, 'cylinder', skin, `${id}:shin-${side}`, {
        position: [0, -dims.shin * 0.5, 0],
        scale: [0.11, dims.shin, 0.11],
      });
    }
    for (const side of ['Left', 'Right'] as const) {
      const arm = parts[side === 'Left' ? 'armLeft' : 'armRight'];
      const forearm = parts[side === 'Left' ? 'forearmLeft' : 'forearmRight'];
      prim(arm, resources, 'cylinder', skin, `${id}:upper-arm-${side}`, {
        position: [0, -dims.upperArm * 0.5, 0],
        scale: [0.095, dims.upperArm, 0.095],
      });
      prim(forearm, resources, 'cylinder', skin, `${id}:forearm-${side}`, {
        position: [0, -dims.forearm * 0.5, 0],
        scale: [0.082, dims.forearm, 0.082],
      });
      prim(forearm, resources, 'sphere', skin, `${id}:hand-${side}`, {
        position: [0, -dims.forearm - 0.02, 0.01],
        scale: [0.075, 0.1, 0.06],
      });
    }
  }

  private buildOutfit(
    parts: Readonly<Record<FigurePartKey, THREE.Object3D>>,
    resources: FigureResources,
    materials: FigureMaterialLibrary,
  ): void {
    const skin = materials.skin(this.blueprint.skinTone);
    for (const garment of this.blueprint.garments) {
      const item = wardrobeItem(garment.item);
      const context: GarmentContext = {
        parts,
        resources,
        materials,
        dims: this.dims,
        item,
        colorway: garment.colorway,
        pattern: item.pattern,
        figureId: this.id,
        skin,
      };
      applyGarment(context);
    }
  }

  private mountGadgets(
    resources: FigureResources,
    materials: FigureMaterialLibrary,
  ): readonly FigureProp[] {
    const assignments = assignGadgetMounts(this.blueprint.gadgets);
    const props: FigureProp[] = [];
    let surfaceCount = 0;
    for (const assignment of assignments) {
      const socket = this.sockets[GADGET_MOUNT_SOCKETS[assignment.mount]];
      const prop = createGadgetProp(assignment.gadget, { resources, materials });
      const node = prop.group;
      if (assignment.mount === 'surface') {
        node.position.x += surfaceCount * 0.13;
        surfaceCount += 1;
        node.rotation.y = Math.PI;
      }
      socket.add(node);
      node.userData['patronGadget'] = assignment.gadget;
      props.push(Object.freeze({ gadget: assignment.gadget, mount: assignment.mount, group: node }));
    }
    return Object.freeze(props);
  }
}

/** Builds one figure from its blueprint plus its deterministic placement. */
export function createFigureInstance(options: FigureBuildOptions): FigureInstance {
  return new Figure(options);
}

/** Every garment slot a blueprint fills, exposed for the inventory tests. */
export function blueprintSlots(blueprint: FigureBlueprint): readonly GarmentSlot[] {
  return Object.freeze(blueprint.garments.map((garment) => garment.slot));
}

/** Resolves the wardrobe item a blueprint wears in `slot`, if any. */
export function garmentInSlot(blueprint: FigureBlueprint, slot: GarmentSlot): WardrobeItem | undefined {
  const selection = blueprint.garments.find((garment) => garment.slot === slot);
  return selection ? wardrobeItem(selection.item) : undefined;
}

/** Palette colour of one garment, resolved through the era ramp. */
export function garmentColor(
  blueprint: FigureBlueprint,
  slot: GarmentSlot,
  ramp: readonly string[],
): string | null {
  const selection = blueprint.garments.find((garment) => garment.slot === slot);
  if (!selection) return null;
  return rampColor(ramp, selection.colorway);
}
