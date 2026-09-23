/**
 * Chrono City — articulated low-poly pedestrians.
 *
 * Builds the body every crowd member is made of: a small articulated rig
 * (hip root → spine → head + shoulders + knees) whose parts are unit primitives
 * (`BoxGeometry` / `CylinderGeometry` / `SphereGeometry` / a skirt cone) scaled
 * into place, so a hundred figures share four geometries and two textures.
 *
 * Responsibilities:
 *   create    → `createPedestrianFigure()` / `FigurePool` build and recycle
 *               figures; every garment material is *cloned* from a cached
 *               `MaterialLibrary` fabric surface so colours can be tinted per
 *               figure without touching the shared cache entry.
 *   consume   → `applyOutfitBlend()` pushes the era morph into the wardrobe and
 *               the silhouette, `poseWalk/poseIdle/poseTalk/poseWindowShop()`
 *               drive the animation loops, `place()` puts the figure on the
 *               sidewalk and `metrics` reports the measured silhouette.
 *   integrate → `crowdSystem` owns the figures, ticks them, and hands their
 *               `root` objects to the `AudioDirector` as emitter anchors.
 *
 * Budget notes:
 *   - four geometries, ~20 meshes and two textures per figure;
 *   - `FigurePool` caps how many articulated figures exist at once and recycles
 *     released ones instead of rebuilding them (`created` stays flat while
 *     `acquire()` keeps handing out figures);
 *   - poses are pure trig over a pooled phase per pedestrian, so animating the
 *     crowd allocates nothing per frame.
 */

import * as THREE from 'three';

import type { MaterialLibrary } from '../../materials/materialLibrary';
import type { TexturePalette } from '../../materials/materialLibrary';
import {
  SKIN_TONES,
  blendOutfits,
  resolveFigureForm,
  type BlendedOutfit,
  type EraGarmentColors,
  type EraGarmentForm,
  type EraOutfit,
} from './outfits';

export const FIGURE_FACTORY_VERSION = 1;

/** Name prefix of every figure root, so harnesses can find them in the graph. */
export const FIGURE_NAME_PREFIX = 'chrono-pedestrian';

/** Number of shared geometries every figure reuses. */
export const FIGURE_SHARED_GEOMETRY_COUNT = 4;

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------------- *
 * Authored body metrics (metres)
 * ------------------------------------------------------------------------- */

/** Bare body height without headwear; the era form adds a few centimetres. */
export const FIGURE_BODY_HEIGHT = 1.72;
const PELVIS_HEIGHT = 0.9;
const TORSO_HEIGHT = 0.52;
const TORSO_WIDTH = 0.34;
const TORSO_DEPTH = 0.2;
const COAT_WIDTH = 0.4;
const COAT_DEPTH = 0.25;
const COAT_BASE_LENGTH = 0.62;
const ARM_SPAN = 0.23;
const UPPER_ARM = 0.28;
const FOREARM = 0.26;
const ARM_RADIUS = 0.05;
const HIP_SPAN = 0.1;
const THIGH = 0.4;
const SHIN = 0.44;
const THIGH_RADIUS = 0.075;
const SHIN_RADIUS = 0.06;
const FOOT_LENGTH = 0.25;
const NECK_HEIGHT = 0.08;
const HEAD_RADIUS = 0.105;

/* ------------------------------------------------------------------------- *
 * Shared geometry
 * ------------------------------------------------------------------------- */

/** Unit box, cylinder and sphere: every part is one of these, scaled. */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYLINDER = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const UNIT_SPHERE = new THREE.SphereGeometry(0.5, 12, 8);
/** Tapered skirt/dress cone: wider at the hem than at the waist. */
const SKIRT_CONE = new THREE.CylinderGeometry(0.17, 0.3, 1, 10, 1, false);

/**
 * Neutral fabric palette. Garment *colour* is applied as a material tint on top
 * of this weave, so one generated texture serves every era and every garment
 * while `blendEraColor()` can still crossfade the tint per frame.
 */
const FABRIC_PALETTE: TexturePalette = Object.freeze({
  base: '#e4e4e4',
  accent: '#cfcfcf',
  joint: '#a9a9a9',
  grime: '#8d8d8d',
  highlight: '#f4f4f4',
});

/** Even lighter weave for skin, with almost no wear so it never looks grubby. */
const SKIN_PALETTE: TexturePalette = Object.freeze({
  base: '#f2f2f2',
  accent: '#e2e2e2',
  joint: '#d2d2d2',
  grime: '#c4c4c4',
  highlight: '#fbfbfb',
});

type Vector3Tuple = readonly [number, number, number];

/* ------------------------------------------------------------------------- *
 * Public shapes
 * ------------------------------------------------------------------------- */

/** The articulated rig. Rotate a joint group to pose the limb below it. */
export interface FigureJoints {
  /** Hip root: bob it vertically for the walk bounce. */
  readonly body: THREE.Group;
  /** Torso: lean, twist and shoulder-scale live here. */
  readonly spine: THREE.Group;
  readonly head: THREE.Group;
  readonly armLeft: THREE.Group;
  readonly armRight: THREE.Group;
  readonly forearmLeft: THREE.Group;
  readonly forearmRight: THREE.Group;
  readonly legLeft: THREE.Group;
  readonly legRight: THREE.Group;
  readonly shinLeft: THREE.Group;
  readonly shinRight: THREE.Group;
}

/** The meshes a figure wears; the wardrobe rebuilds the headgear/accessory. */
export interface FigureParts {
  readonly torso: THREE.Mesh;
  readonly coat: THREE.Mesh;
  readonly top: THREE.Mesh;
  readonly head: THREE.Mesh;
  readonly hair: THREE.Mesh;
  readonly skirt: THREE.Mesh;
  readonly bag: THREE.Mesh;
  readonly thighLeft: THREE.Mesh;
  readonly thighRight: THREE.Mesh;
  readonly shinLeft: THREE.Mesh;
  readonly shinRight: THREE.Mesh;
  readonly footLeft: THREE.Mesh;
  readonly footRight: THREE.Mesh;
  /** Headwear meshes; rebuilt whenever the headwear form changes. */
  readonly headwear: THREE.Group;
  /** Single accessory mesh, reconfigured when the accessory form changes. */
  readonly accessory: THREE.Mesh;
}

/** Per-figure tinted materials (clones of the shared library materials). */
export interface FigureMaterials {
  readonly skin: THREE.MeshStandardMaterial;
  readonly hair: THREE.MeshStandardMaterial;
  readonly hat: THREE.MeshStandardMaterial;
  readonly outerwear: THREE.MeshStandardMaterial;
  readonly top: THREE.MeshStandardMaterial;
  readonly legs: THREE.MeshStandardMaterial;
  readonly dress: THREE.MeshStandardMaterial;
  readonly shoes: THREE.MeshStandardMaterial;
  readonly accent: THREE.MeshStandardMaterial;
}

/** Measured silhouette of one figure, in metres. */
export interface FigureMetrics {
  /** Total height including headwear. */
  readonly height: number;
  /** Total width including shoulder pads, brims and bags. */
  readonly width: number;
  /** Total depth, front to back. */
  readonly depth: number;
  /** Width of the torso/shoulder subtree — the padded-vs-slim signal. */
  readonly shoulderWidth: number;
  /** Height of the visible figure above the ground. */
  readonly groundClearance: number;
  /** `width x depth x height` rounded to centimetres. */
  readonly silhouette: string;
}

/** Animation loop a figure is currently playing. */
export type FigurePoseKind = 'walk' | 'cross' | 'idle' | 'talk' | 'window-shopping';

export interface PedestrianFigureOptions {
  readonly id: string;
  /** Shared material source; omitted falls back to plain untextured materials. */
  readonly library?: MaterialLibrary | null;
  /** Per-person variation in `[0, 1)`: dress vs trousers, skin tone, hair. */
  readonly variant?: number;
  /** Explicit skin tone; defaults to a tone picked from `variant`. */
  readonly skinTone?: number;
  /** Roll against the era's headwear ratio. */
  readonly headwearRoll?: number;
  /** Roll against the era's formal ratio (outerwear on/off). */
  readonly outerwearRoll?: number;
  /** Outfit applied at construction. Defaults to nothing (naked rig). */
  readonly outfit?: EraOutfit;
}

/* ------------------------------------------------------------------------- *
 * Measurement helper
 * ------------------------------------------------------------------------- */

/**
 * Bounding box of the *visible* meshes only.
 *
 * Three's `Box3.setFromObject()` measures hidden children too, which would make
 * a trousers figure report the skirt it is not wearing; this walk skips
 * `visible === false` subtrees, so `metrics` reports what a camera sees.
 */
function measureVisibleBox(root: THREE.Object3D, target = new THREE.Box3()): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  const scratch = new THREE.Box3();
  const stack: THREE.Object3D[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as THREE.Object3D;
    if (!node.visible) continue;
    const geometry = (node as THREE.Mesh).geometry;
    if (geometry) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      if (bounds) {
        scratch.copy(bounds).applyMatrix4(node.matrixWorld);
        target.union(scratch);
      }
    }
    for (const child of node.children) stack.push(child);
  }
  return target;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ------------------------------------------------------------------------- *
 * Materials
 * ------------------------------------------------------------------------- */

function plainMaterial(name: string, color: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, color, roughness, metalness: 0.02 });
}

/**
 * Clones a cached library material so this figure can tint it.
 *
 * `library.get()` returns a shared instance keyed by request; cloning keeps the
 * generated texture (one upload for the whole crowd) while giving the figure a
 * private `color` to crossfade during era tweens.
 */
function tintedMaterial(
  library: MaterialLibrary | null | undefined,
  name: string,
  fallbackColor: number,
): THREE.MeshStandardMaterial {
  if (!library) return plainMaterial(name, fallbackColor, 0.78);

  const fabric = library.get({
    surface: 'fabric',
    palette: FABRIC_PALETTE,
    roughness: 0.78,
    metalness: 0.02,
    wear: 0.24,
    repeat: [2, 2],
    size: 256,
    name: 'pedestrian-fabric-base',
  });
  const material = fabric.clone();
  material.name = name;
  material.color.setHex(fallbackColor);
  return material;
}

function skinMaterialFor(
  library: MaterialLibrary | null | undefined,
  tone: number,
): THREE.MeshStandardMaterial {
  if (!library) return plainMaterial('pedestrian-skin', tone, 0.92);

  const skin = library.get({
    surface: 'fabric',
    palette: SKIN_PALETTE,
    roughness: 0.92,
    metalness: 0,
    wear: 0.05,
    repeat: [3, 3],
    size: 256,
    name: 'pedestrian-skin-base',
  });
  const material = skin.clone();
  material.name = 'pedestrian-skin';
  material.color.setHex(tone);
  return material;
}

/* ------------------------------------------------------------------------- *
 * Figure
 * ------------------------------------------------------------------------- */

function partMesh(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  scale: Vector3Tuple,
  position: Vector3Tuple = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.matrixAutoUpdate = true;
  return mesh;
}

/**
 * Neutral form used before any outfit arrives: plain trousers, no headwear.
 * Keeps a freshly built figure presentable for one frame.
 */
const ERA_NEUTRAL_FORM: EraGarmentForm = Object.freeze({
  hat: 'none',
  legs: 'trousers',
  bag: 'none',
  accessory: 'none',
  coatLength: 0.5,
  shoulderWidth: 1,
  hemFlare: 0.1,
});

/**
 * One articulated pedestrian. Figures are pooled by `FigurePool`, so the
 * constructor is private to the module and callers go through the factory.
 */
export class PedestrianFigure {
  readonly version = FIGURE_FACTORY_VERSION;

  /** Stable id, also published on `root.userData.chronoPedestrianId`. */
  id: string;
  /** Scene-graph root the crowd positions and the audio director tracks. */
  readonly root: THREE.Group;
  readonly joints: FigureJoints;
  readonly parts: FigureParts;
  readonly materials: FigureMaterials;

  /** Per-person variation in `[0, 1)`. */
  readonly variant: number;
  readonly skinTone: number;
  readonly headwearRoll: number;
  readonly outerwearRoll: number;

  private form: EraGarmentForm | null = null;
  private formKey = '';
  private blend: BlendedOutfit | null = null;
  private metricsState: FigureMetrics;
  private disposedState = false;

  constructor(options: PedestrianFigureOptions) {
    this.id = options.id;
    this.variant = options.variant ?? 0.5;
    this.skinTone =
      options.skinTone ??
      (SKIN_TONES[Math.floor(this.variant * SKIN_TONES.length) % SKIN_TONES.length] as number);
    this.headwearRoll = options.headwearRoll ?? this.variant;
    this.outerwearRoll = options.outerwearRoll ?? 1 - this.variant;

    const library = options.library;

    this.materials = Object.freeze({
      skin: skinMaterialFor(library, this.skinTone),
      hair: tintedMaterial(library, 'pedestrian-hair', 0x3b2f24),
      hat: tintedMaterial(library, 'pedestrian-hat', 0x2f3b45),
      outerwear: tintedMaterial(library, 'pedestrian-outerwear', 0x4a4436),
      top: tintedMaterial(library, 'pedestrian-top', 0x6b6255),
      legs: tintedMaterial(library, 'pedestrian-legs', 0x3b3b3b),
      dress: tintedMaterial(library, 'pedestrian-dress', 0x7d2f2a),
      shoes: tintedMaterial(library, 'pedestrian-shoes', 0x2f2a24),
      accent: tintedMaterial(library, 'pedestrian-accent', 0x8a7a4a),
    });

    this.root = new THREE.Group();
    this.root.name = `${FIGURE_NAME_PREFIX}-${this.id}`;
    this.root.userData.chronoPedestrianId = this.id;

    /* ---------------- body ---------------- */
    const body = new THREE.Group();
    body.name = 'body';
    body.position.y = PELVIS_HEIGHT;
    this.root.add(body);

    const spine = new THREE.Group();
    spine.name = 'spine';
    body.add(spine);

    const torso = partMesh(
      'torso',
      UNIT_BOX,
      this.materials.top,
      [TORSO_WIDTH, TORSO_HEIGHT, TORSO_DEPTH],
      [0, TORSO_HEIGHT / 2, 0],
    );
    spine.add(torso);

    const coat = partMesh(
      'coat',
      UNIT_BOX,
      this.materials.outerwear,
      [COAT_WIDTH, COAT_BASE_LENGTH, COAT_DEPTH],
      [0, -COAT_BASE_LENGTH / 2 + 0.02, 0],
    );
    spine.add(coat);

    const top = partMesh(
      'top',
      UNIT_BOX,
      this.materials.top,
      [TORSO_WIDTH * 0.98, TORSO_HEIGHT * 0.72, TORSO_DEPTH * 0.98],
      [0, TORSO_HEIGHT * 0.42, TORSO_DEPTH * 0.06],
    );
    spine.add(top);

    const head = new THREE.Group();
    head.name = 'head';
    head.position.y = TORSO_HEIGHT + NECK_HEIGHT;
    spine.add(head);

    const neck = partMesh(
      'neck',
      UNIT_CYLINDER,
      this.materials.skin,
      [0.09, NECK_HEIGHT, 0.09],
      [0, -NECK_HEIGHT / 2 + NECK_HEIGHT * 0.2, 0],
    );
    head.add(neck);

    const headMesh = partMesh(
      'skull',
      UNIT_SPHERE,
      this.materials.skin,
      [HEAD_RADIUS * 2, HEAD_RADIUS * 2.2, HEAD_RADIUS * 2],
      [0, HEAD_RADIUS, 0],
    );
    head.add(headMesh);

    const nose = partMesh(
      'nose',
      UNIT_BOX,
      this.materials.skin,
      [0.03, 0.04, 0.05],
      [0, HEAD_RADIUS * 0.95, HEAD_RADIUS + 0.01],
    );
    head.add(nose);

    const hair = partMesh(
      'hair',
      UNIT_SPHERE,
      this.materials.hair,
      [HEAD_RADIUS * 2.08, HEAD_RADIUS * 1.5, HEAD_RADIUS * 2.08],
      [0, HEAD_RADIUS + 0.035, -0.01],
    );
    head.add(hair);

    const headwear = new THREE.Group();
    headwear.name = 'headwear';
    head.add(headwear);

    const accessory = partMesh(
      'accessory',
      UNIT_BOX,
      this.materials.accent,
      [0.1, 0.1, 0.1],
      [0, TORSO_HEIGHT - 0.06, 0],
    );
    accessory.visible = false;
    spine.add(accessory);

    /* ---------------- arms ---------------- */
    const armLeft = new THREE.Group();
    armLeft.name = 'arm-left';
    armLeft.position.set(-ARM_SPAN, TORSO_HEIGHT - 0.06, 0);
    spine.add(armLeft);
    const armRight = new THREE.Group();
    armRight.name = 'arm-right';
    armRight.position.set(ARM_SPAN, TORSO_HEIGHT - 0.06, 0);
    spine.add(armRight);

    for (const [group, name] of [
      [armLeft, 'left'],
      [armRight, 'right'],
    ] as const) {
      group.add(
        partMesh(
          `upper-arm-${name}`,
          UNIT_CYLINDER,
          this.materials.top,
          [ARM_RADIUS * 2, UPPER_ARM, ARM_RADIUS * 2],
          [0, -UPPER_ARM / 2, 0],
        ),
      );
      const forearm = new THREE.Group();
      forearm.name = `forearm-${name}`;
      forearm.position.y = -UPPER_ARM;
      group.add(forearm);
      forearm.add(
        partMesh(
          `forearm-mesh-${name}`,
          UNIT_CYLINDER,
          this.materials.skin,
          [ARM_RADIUS * 1.7, FOREARM, ARM_RADIUS * 1.7],
          [0, -FOREARM / 2, 0],
        ),
      );
      forearm.add(
        partMesh(
          `hand-${name}`,
          UNIT_SPHERE,
          this.materials.skin,
          [0.09, 0.1, 0.07],
          [0, -FOREARM - 0.01, 0],
        ),
      );
    }

    /* ---------------- legs ---------------- */
    const legLeft = new THREE.Group();
    legLeft.name = 'leg-left';
    legLeft.position.set(-HIP_SPAN, 0, 0);
    body.add(legLeft);
    const legRight = new THREE.Group();
    legRight.name = 'leg-right';
    legRight.position.set(HIP_SPAN, 0, 0);
    body.add(legRight);

    const thighLeft = partMesh(
      'thigh-left',
      UNIT_CYLINDER,
      this.materials.legs,
      [THIGH_RADIUS * 2, THIGH, THIGH_RADIUS * 2],
      [0, -THIGH / 2, 0],
    );
    const thighRight = partMesh(
      'thigh-right',
      UNIT_CYLINDER,
      this.materials.legs,
      [THIGH_RADIUS * 2, THIGH, THIGH_RADIUS * 2],
      [0, -THIGH / 2, 0],
    );
    legLeft.add(thighLeft);
    legRight.add(thighRight);

    const shinLeftGroup = new THREE.Group();
    shinLeftGroup.name = 'shin-left';
    shinLeftGroup.position.y = -THIGH;
    legLeft.add(shinLeftGroup);
    const shinRightGroup = new THREE.Group();
    shinRightGroup.name = 'shin-right';
    shinRightGroup.position.y = -THIGH;
    legRight.add(shinRightGroup);

    const shinLeft = partMesh(
      'shin-mesh-left',
      UNIT_CYLINDER,
      this.materials.legs,
      [SHIN_RADIUS * 2, SHIN, SHIN_RADIUS * 2],
      [0, -SHIN / 2, 0],
    );
    const shinRight = partMesh(
      'shin-mesh-right',
      UNIT_CYLINDER,
      this.materials.legs,
      [SHIN_RADIUS * 2, SHIN, SHIN_RADIUS * 2],
      [0, -SHIN / 2, 0],
    );
    shinLeftGroup.add(shinLeft);
    shinRightGroup.add(shinRight);

    const footLeft = partMesh(
      'foot-left',
      UNIT_BOX,
      this.materials.shoes,
      [SHIN_RADIUS * 2.1, 0.08, FOOT_LENGTH],
      [0, -SHIN, FOOT_LENGTH * 0.18],
    );
    const footRight = partMesh(
      'foot-right',
      UNIT_BOX,
      this.materials.shoes,
      [SHIN_RADIUS * 2.1, 0.08, FOOT_LENGTH],
      [0, -SHIN, FOOT_LENGTH * 0.18],
    );
    shinLeftGroup.add(footLeft);
    shinRightGroup.add(footRight);

    const skirt = partMesh(
      'skirt',
      SKIRT_CONE,
      this.materials.dress,
      [1, 0.56, 1],
      [0, -0.26, 0],
    );
    body.add(skirt);

    const bag = partMesh(
      'bag',
      UNIT_BOX,
      this.materials.accent,
      [0.18, 0.2, 0.08],
      [0.28, -0.26, 0],
    );
    spine.add(bag);

    this.joints = Object.freeze({
      body,
      spine,
      head,
      armLeft,
      armRight,
      forearmLeft: armLeft.children[1] as THREE.Group,
      forearmRight: armRight.children[1] as THREE.Group,
      legLeft,
      legRight,
      shinLeft: shinLeftGroup,
      shinRight: shinRightGroup,
    });

    this.parts = Object.freeze({
      torso,
      coat,
      top,
      head: headMesh,
      hair,
      skirt,
      bag,
      thighLeft,
      thighRight,
      shinLeft,
      shinRight,
      footLeft,
      footRight,
      headwear,
      accessory,
    });

    this.form = null;
    this.formKey = '';
    this.metricsState = {
      height: FIGURE_BODY_HEIGHT,
      width: TORSO_WIDTH,
      depth: TORSO_DEPTH,
      shoulderWidth: TORSO_WIDTH,
      groundClearance: 0,
      silhouette: 'naked',
    };

    // Default to a neutral stance so a figure is never rendered mid-T-pose.
    this.resetJoints();
    this.applyForm(resolveFigureForm(ERA_NEUTRAL_FORM, 0, 1));
    this.measure();

    if (options.outfit) this.applyOutfit(options.outfit);
  }

  /** Measured silhouette; recomputed whenever the garment form changes. */
  get metrics(): FigureMetrics {
    return this.metricsState;
  }

  /** Garment form currently built into the geometry. */
  get garmentForm(): EraGarmentForm {
    return this.form ?? ERA_NEUTRAL_FORM;
  }

  /** Outfit morph currently applied (or `null` before the first application). */
  get outfitBlend(): BlendedOutfit | null {
    return this.blend;
  }

  /** Renames the figure (pool reuse keeps the body, not the person). */
  rename(id: string): void {
    this.id = id;
    this.root.name = `${FIGURE_NAME_PREFIX}-${id}`;
    this.root.userData.chronoPedestrianId = id;
  }

  /** Parents/detaches the figure and toggles its whole subtree. */
  setVisible(visible: boolean, parent?: THREE.Object3D | null): void {
    if (parent !== undefined && parent !== null && this.root.parent !== parent) {
      parent.add(this.root);
    }
    this.root.visible = visible;
  }

  /** Places the figure on the ground plane, facing `yaw` (radians, +Z forward). */
  place(point: { readonly x: number; readonly z: number }, yaw: number): void {
    this.root.position.set(point.x, 0, point.z);
    this.root.rotation.y = yaw;
  }

  /** Sets the facing without moving the figure. */
  setFacing(yaw: number): void {
    this.root.rotation.y = yaw;
  }

  /* ---------------- wardrobe ---------------- */

  /** Applies one era's outfit at full strength. */
  applyOutfit(outfit: EraOutfit): void {
    this.applyOutfitBlend(blendOutfits(outfit, outfit, 1));
  }

  /**
   * Applies a two-era outfit morph: garment tints every frame, discrete
   * silhouette pieces at the tween midpoint.
   */
  applyOutfitBlend(blend: BlendedOutfit): void {
    if (this.disposedState) return;
    this.blend = blend;

    const form = resolveFigureForm(blend.form, blend.dressRatio, this.variant);
    this.applyForm(form);
    this.applyGarmentColors(blend.colors);

    // Outerwear follows the era's formal ratio, so a 1985 pavement shows both
    // bare-armed punks and buttoned power suits.
    this.parts.coat.visible = this.outerwearRoll < blend.formalRatio;

    const wearsHeadwear = this.headwearRoll < blend.headwearRatio && form.hat !== 'none';
    this.parts.headwear.visible = wearsHeadwear;
    // Hair shows under a crest or when the head is bare; hats and hoods cover it.
    this.parts.hair.visible = form.hat === 'mohawk' || !wearsHeadwear;
  }

  private applyGarmentColors(colors: EraGarmentColors): void {
    this.materials.hat.color.setHex(colors.hat);
    this.materials.hair.color.setHex(colors.hair);
    this.materials.outerwear.color.setHex(colors.outerwear);
    this.materials.top.color.setHex(colors.top);
    this.materials.legs.color.setHex(colors.legs);
    this.materials.dress.color.setHex(colors.dress);
    this.materials.shoes.color.setHex(colors.shoes);
    this.materials.accent.color.setHex(colors.accent);
  }

  /** Builds the silhouette the form describes (no-op when it is unchanged). */
  private applyForm(form: EraGarmentForm): void {
    const key = [
      form.hat,
      form.legs,
      form.bag,
      form.accessory,
      round2(form.coatLength),
      round2(form.shoulderWidth),
      round2(form.hemFlare),
    ].join('|');
    if (key === this.formKey && this.form) return;

    this.form = form;
    this.formKey = key;

    /* shoulders: the padded power suit vs the slim mod jacket */
    this.parts.torso.scale.x = TORSO_WIDTH * form.shoulderWidth;
    this.parts.top.scale.x = TORSO_WIDTH * 0.98 * form.shoulderWidth;
    this.joints.armLeft.position.x = -ARM_SPAN * form.shoulderWidth;
    this.joints.armRight.position.x = ARM_SPAN * form.shoulderWidth;

    /* coat length: cropped 1985 leather vs the 1945 knee-length wool coat */
    const coatLength = COAT_BASE_LENGTH * (0.55 + form.coatLength * 0.95);
    this.parts.coat.scale.set(
      COAT_WIDTH * form.shoulderWidth,
      coatLength,
      COAT_DEPTH,
    );
    this.parts.coat.position.y = -coatLength / 2 + 0.02;

    /* legs: trousers, bootcut flares or wide utility legs */
    const bulk = form.legs === 'wide-leg' ? 1.34 : form.legs === 'bootcut' ? 1.1 : 1;
    const ankle = form.legs === 'bootcut' ? 1.45 : bulk;
    const thinned = form.legs === 'skirt' ? 0.92 : 1;
    for (const thigh of [this.parts.thighLeft, this.parts.thighRight]) {
      thigh.scale.set(THIGH_RADIUS * 2 * bulk * thinned, THIGH, THIGH_RADIUS * 2 * bulk * thinned);
      thigh.visible = form.legs !== 'skirt';
    }
    for (const shin of [this.parts.shinLeft, this.parts.shinRight]) {
      shin.scale.set(SHIN_RADIUS * 2 * bulk, SHIN, SHIN_RADIUS * 2 * ankle);
    }
    this.parts.skirt.visible = form.legs === 'skirt';
    const flare = 0.9 + form.hemFlare * 1.5;
    this.parts.skirt.scale.set(flare, 0.56, flare);

    this.rebuildHeadwear(form.hat);
    this.configureAccessory(form.accessory);
    this.configureBag(form.bag);
    this.measure();
  }

  private rebuildHeadwear(hat: EraGarmentForm['hat']): void {
    const group = this.parts.headwear;
    for (const child of [...group.children]) group.remove(child);

    const hatMaterial = this.materials.hat;
    const accent = this.materials.accent;
    const crownTop = HEAD_RADIUS + 0.02;

    switch (hat) {
      case 'brimmed': {
        group.add(
          partMesh(
            'hat-crown',
            UNIT_CYLINDER,
            hatMaterial,
            [HEAD_RADIUS * 2.1, 0.14, HEAD_RADIUS * 2.1],
            [0, crownTop + 0.07, 0],
          ),
        );
        group.add(
          partMesh(
            'hat-brim',
            UNIT_CYLINDER,
            hatMaterial,
            [HEAD_RADIUS * 3.4, 0.02, HEAD_RADIUS * 3.4],
            [0, crownTop, 0],
          ),
        );
        group.add(
          partMesh(
            'hat-band',
            UNIT_CYLINDER,
            accent,
            [HEAD_RADIUS * 2.16, 0.03, HEAD_RADIUS * 2.16],
            [0, crownTop + 0.015, 0],
          ),
        );
        break;
      }
      case 'pillbox': {
        group.add(
          partMesh(
            'hat-pillbox',
            UNIT_CYLINDER,
            hatMaterial,
            [HEAD_RADIUS * 1.95, 0.1, HEAD_RADIUS * 1.95],
            [0, crownTop + 0.05, 0.01],
          ),
        );
        break;
      }
      case 'mohawk': {
        group.add(
          partMesh(
            'hair-crest',
            UNIT_BOX,
            hatMaterial,
            [0.05, 0.17, HEAD_RADIUS * 2.2],
            [0, crownTop + 0.09, -0.01],
          ),
        );
        group.add(
          partMesh(
            'hair-crest-tip',
            UNIT_BOX,
            accent,
            [0.045, 0.09, HEAD_RADIUS * 1.7],
            [0, crownTop + 0.2, -0.03],
          ),
        );
        break;
      }
      case 'cap': {
        group.add(
          partMesh(
            'cap-crown',
            UNIT_SPHERE,
            hatMaterial,
            [HEAD_RADIUS * 2.16, HEAD_RADIUS * 1.5, HEAD_RADIUS * 2.16],
            [0, crownTop + 0.055, 0],
          ),
        );
        group.add(
          partMesh(
            'cap-peak',
            UNIT_BOX,
            hatMaterial,
            [HEAD_RADIUS * 1.9, 0.025, HEAD_RADIUS * 1.4],
            [0, crownTop + 0.02, HEAD_RADIUS + 0.05],
          ),
        );
        break;
      }
      case 'hood': {
        group.add(
          partMesh(
            'hood-shell',
            UNIT_SPHERE,
            hatMaterial,
            [HEAD_RADIUS * 2.5, HEAD_RADIUS * 2.6, HEAD_RADIUS * 2.5],
            [0, HEAD_RADIUS + 0.02, -0.035],
          ),
        );
        break;
      }
      case 'none':
      default:
        break;
    }
  }

  private configureAccessory(accessory: EraGarmentForm['accessory']): void {
    const mesh = this.parts.accessory;
    mesh.visible = accessory !== 'none';
    const accent = this.materials.accent;
    mesh.material = accent;

    switch (accessory) {
      case 'scarf':
        mesh.scale.set(0.3, 0.1, 0.26);
        mesh.position.set(0, TORSO_HEIGHT - 0.02, 0);
        break;
      case 'badge':
        mesh.scale.set(0.07, 0.07, 0.02);
        mesh.position.set(-0.08, TORSO_HEIGHT * 0.62, TORSO_DEPTH * 0.55);
        break;
      case 'bandana':
        mesh.scale.set(0.24, 0.06, 0.24);
        mesh.position.set(0, TORSO_HEIGHT + NECK_HEIGHT + 0.02, 0);
        break;
      case 'headphones':
        mesh.scale.set(0.26, 0.05, 0.22);
        mesh.position.set(0, TORSO_HEIGHT + NECK_HEIGHT + HEAD_RADIUS * 2.1, 0);
        break;
      case 'sunglasses':
        mesh.scale.set(0.2, 0.05, 0.03);
        mesh.position.set(0, TORSO_HEIGHT + NECK_HEIGHT + HEAD_RADIUS * 1.05, HEAD_RADIUS + 0.02);
        break;
      default:
        break;
    }
  }

  private configureBag(bag: EraGarmentForm['bag']): void {
    const mesh = this.parts.bag;
    mesh.visible = bag !== 'none';
    switch (bag) {
      case 'handbag':
        mesh.scale.set(0.18, 0.2, 0.08);
        mesh.position.set(0.3, -0.26, 0.02);
        break;
      case 'satchel':
        mesh.scale.set(0.24, 0.16, 0.09);
        mesh.position.set(-0.24, -0.22, 0.06);
        break;
      case 'messenger':
        mesh.scale.set(0.28, 0.2, 0.11);
        mesh.position.set(0.26, -0.3, -0.04);
        break;
      case 'tote':
        mesh.scale.set(0.26, 0.28, 0.1);
        mesh.position.set(0.3, -0.34, 0);
        break;
      default:
        break;
    }
  }

  private measure(): void {
    const box = measureVisibleBox(this.root);
    const spine = measureVisibleBox(this.joints.spine);
    const height = box.isEmpty() ? FIGURE_BODY_HEIGHT : box.max.y - Math.min(0, box.min.y);
    const width = box.isEmpty() ? TORSO_WIDTH : box.max.x - box.min.x;
    const depth = box.isEmpty() ? TORSO_DEPTH : box.max.z - box.min.z;
    const shoulderWidth = spine.isEmpty() ? TORSO_WIDTH : spine.max.x - spine.min.x;

    this.metricsState = Object.freeze({
      height: round2(height),
      width: round2(width),
      depth: round2(depth),
      shoulderWidth: round2(shoulderWidth),
      groundClearance: round2(box.isEmpty() ? 0 : Math.max(0, box.min.y)),
      silhouette: `${round2(width)}x${round2(depth)}x${round2(height)}`,
    });
  }

  /* ---------------- animation loops ---------------- */

  private resetJoints(): void {
    const j = this.joints;
    j.body.position.y = PELVIS_HEIGHT;
    j.spine.rotation.set(0.02, 0, 0);
    j.head.rotation.set(0, 0, 0);
    for (const arm of [j.armLeft, j.armRight]) arm.rotation.set(0, 0, 0);
    j.armLeft.rotation.z = 0.08;
    j.armRight.rotation.z = -0.08;
    j.forearmLeft.rotation.set(0.14, 0, 0);
    j.forearmRight.rotation.set(0.14, 0, 0);
    for (const leg of [j.legLeft, j.legRight]) leg.rotation.set(0, 0, 0);
    j.shinLeft.rotation.set(0, 0, 0);
    j.shinRight.rotation.set(0, 0, 0);
  }

  /**
   * Walk cycle: hips swing in antiphase, knees flex on the back swing, arms
   * counter-swing and the body bobs twice per stride. `phase` wraps in `[0, 1)`.
   */
  poseWalk(phase: number, intensity = 1): void {
    const k = Number.isFinite(intensity) ? Math.min(Math.max(intensity, 0), 1.6) : 1;
    const t = (((phase % 1) + 1) % 1) * TAU;
    const swing = Math.sin(t);
    const lift = Math.cos(t);
    const j = this.joints;

    this.resetJoints();
    j.legLeft.rotation.x = -swing * 0.6 * k;
    j.legRight.rotation.x = swing * 0.6 * k;
    j.shinLeft.rotation.x = Math.max(0, lift) * 0.85 * k;
    j.shinRight.rotation.x = Math.max(0, -lift) * 0.85 * k;
    j.armLeft.rotation.x = swing * 0.45 * k;
    j.armRight.rotation.x = -swing * 0.45 * k;
    j.forearmLeft.rotation.x = 0.25 + Math.max(0, swing) * 0.35 * k;
    j.forearmRight.rotation.x = 0.25 + Math.max(0, -swing) * 0.35 * k;
    j.spine.rotation.y = swing * 0.07 * k;
    j.spine.rotation.x = 0.05 * k;
    j.head.rotation.y = -swing * 0.05 * k;
    j.body.position.y = PELVIS_HEIGHT + Math.abs(Math.sin(t * 2)) * 0.02 * k;
  }

  /** Idle loop: weight shift, slow head drift, arms hanging with a small sway. */
  poseIdle(elapsed: number, variant = 0): void {
    const t = elapsed * 0.9 + variant * TAU;
    const j = this.joints;

    this.resetJoints();
    j.spine.rotation.z = Math.sin(t) * 0.04;
    j.spine.rotation.x = 0.03;
    j.head.rotation.y = Math.sin(t * 0.7) * 0.14;
    j.head.rotation.x = Math.sin(t * 0.5) * 0.03;
    j.armLeft.rotation.x = Math.sin(t) * 0.05;
    j.armRight.rotation.x = -Math.sin(t) * 0.05;
    j.legLeft.rotation.x = 0.04;
    j.legRight.rotation.x = -0.02;
    j.body.position.y = PELVIS_HEIGHT + Math.sin(t * 2) * 0.005;
  }

  /** Talk loop: head turns between listeners, one hand gestures. */
  poseTalk(elapsed: number, variant = 0): void {
    const t = elapsed * 1.7 + variant * TAU;
    const j = this.joints;

    this.resetJoints();
    j.spine.rotation.y = Math.sin(t * 0.5) * 0.1;
    j.head.rotation.y = Math.sin(t) * 0.3;
    j.head.rotation.x = -0.04 + Math.sin(t * 1.3) * 0.06;
    j.armRight.rotation.x = -0.6 + Math.sin(t * 2.1) * 0.35;
    j.forearmRight.rotation.x = 0.9 + Math.sin(t * 2.7) * 0.25;
    j.armLeft.rotation.x = -0.25 + Math.sin(t * 1.9) * 0.1;
    j.forearmLeft.rotation.x = 0.7;
    j.body.position.y = PELVIS_HEIGHT + Math.sin(t * 3.1) * 0.006;
  }

  /** Window-shopping loop: leans in towards the glass and looks up at displays. */
  poseWindowShop(elapsed: number, variant = 0): void {
    const t = elapsed * 1.1 + variant * TAU;
    const j = this.joints;

    this.resetJoints();
    j.spine.rotation.x = 0.09;
    j.head.rotation.x = -0.22 + Math.sin(t) * 0.07;
    j.head.rotation.y = Math.sin(t * 0.6) * 0.24;
    j.armLeft.rotation.x = -0.35;
    j.forearmLeft.rotation.x = 0.55;
    j.armRight.rotation.x = -0.3;
    j.forearmRight.rotation.x = 0.6;
    j.legLeft.rotation.x = 0.07;
    j.legRight.rotation.x = -0.05;
    j.body.position.y = PELVIS_HEIGHT + Math.sin(t * 1.4) * 0.008;
  }

  /** Dispatches to the loop that matches the crowd state. */
  poseFor(kind: FigurePoseKind, elapsed: number, phase = 0): void {
    switch (kind) {
      case 'walk':
        this.poseWalk(phase);
        break;
      case 'cross':
        this.poseWalk(phase, 1.15);
        break;
      case 'talk':
        this.poseTalk(elapsed, this.variant);
        break;
      case 'window-shopping':
        this.poseWindowShop(elapsed, this.variant);
        break;
      case 'idle':
      default:
        this.poseIdle(elapsed, this.variant);
        break;
    }
  }

  /** Disposes the figure's private materials and detaches it from the scene. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.root.removeFromParent();
    for (const material of Object.values(this.materials)) material.dispose();
    this.root.clear();
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** Measure of the visible mesh count, used by the budget assertions. */
  meshCount(): number {
    let count = 0;
    this.root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) count += 1;
    });
    return count;
  }
}

/** Creates one standalone figure (tests, portraits, pool misses). */
export function createPedestrianFigure(options: PedestrianFigureOptions): PedestrianFigure {
  return new PedestrianFigure(options);
}

/* ------------------------------------------------------------------------- *
 * Pool
 * ------------------------------------------------------------------------- */

/** Deterministic random source shape the pool needs (mirrors `SeededRandom`). */
export interface FigurePoolRandom {
  next(): number;
  float(min?: number, max?: number): number;
  int(min: number, max: number): number;
}

export interface FigurePoolOptions {
  /** Shared material source for every figure in the pool. */
  readonly library?: MaterialLibrary | null;
  /** Hard cap on simultaneous articulated figures. Defaults to 24. */
  readonly capacity?: number;
  /** Deterministic random source for per-person variation. */
  readonly random?: FigurePoolRandom;
  /**
   * Seed used when no `random` is supplied. When neither is given, variation
   * falls back to a fixed internal sequence (still deterministic).
   */
  readonly seed?: number;
  /** Parent the figures are attached to as they are acquired. */
  readonly parent?: THREE.Object3D | null;
}

/** Default simultaneous articulated figures: the crowd's 60 fps budget cap. */
export const DEFAULT_FIGURE_CAPACITY = 24;

/**
 * Recycles articulated figures.
 *
 * `acquire()` hands back a pooled figure (rebuilding only when the pool is
 * empty) and `release()` parks it for the next person, so a crowd that turns
 * over never keeps piling up meshes and materials. `capacity` is the hard cap.
 */
export class FigurePool {
  readonly capacity: number;
  readonly library: MaterialLibrary | null;

  private readonly random: FigurePoolRandom;
  private readonly parked: PedestrianFigure[] = [];
  private readonly live: PedestrianFigure[] = [];
  private readonly parent: THREE.Object3D | null;
  private createdState = 0;
  private sequence = 0;

  constructor(options: FigurePoolOptions = {}) {
    const capacity = options.capacity ?? DEFAULT_FIGURE_CAPACITY;
    this.capacity = Math.max(1, Math.floor(Number.isFinite(capacity) ? capacity : DEFAULT_FIGURE_CAPACITY));
    this.library = options.library ?? null;
    this.parent = options.parent ?? null;
    this.random = options.random ?? createFallbackRandom(options.seed ?? 0x5eed);
  }

  /** Total figures ever built. Stays flat while the pool is recycled. */
  get created(): number {
    return this.createdState;
  }

  /** Figures currently handed out. */
  get size(): number {
    return this.live.length;
  }

  /** Figures parked, ready to be re-handed out. */
  get available(): number {
    return this.parked.length;
  }

  /** Live figures, in acquisition order. */
  get figures(): readonly PedestrianFigure[] {
    return [...this.live];
  }

  /** Acquires a figure for `id`, or `null` when the cap is reached. */
  acquire(id: string): PedestrianFigure | null {
    if (this.live.length >= this.capacity) return null;
    const figure = this.parked.pop() ?? this.build();
    figure.rename(id);
    figure.setVisible(true, this.parent);
    this.live.push(figure);
    return figure;
  }

  /** Acquires up to `count` figures, numbered from `prefix-0`. */
  acquireMany(count: number, prefix = 'pedestrian'): PedestrianFigure[] {
    const out: PedestrianFigure[] = [];
    const wanted = Math.min(Math.max(0, Math.floor(count)), this.capacity);
    for (let index = 0; index < wanted; index += 1) {
      const figure = this.acquire(`${prefix}-${index}`);
      if (!figure) break;
      out.push(figure);
    }
    return out;
  }

  /** Parks a figure for reuse. Unknown figures are ignored. */
  release(figure: PedestrianFigure): boolean {
    const index = this.live.indexOf(figure);
    if (index < 0) return false;
    this.live.splice(index, 1);
    figure.setVisible(false);
    this.parked.push(figure);
    return true;
  }

  /** Disposes every figure, live and parked. The pool stays usable. */
  dispose(): void {
    for (const figure of [...this.live, ...this.parked]) figure.dispose();
    this.live.length = 0;
    this.parked.length = 0;
  }

  private build(): PedestrianFigure {
    const variant = this.random.next();
    this.createdState += 1;
    const figure = new PedestrianFigure({
      id: `${this.sequence}`,
      library: this.library,
      variant,
      headwearRoll: this.random.next(),
      outerwearRoll: this.random.next(),
      skinTone: SKIN_TONES[this.random.int(0, SKIN_TONES.length - 1)] as number,
    });
    this.sequence += 1;
    return figure;
  }
}

/**
 * Tiny deterministic mulberry32 clone, used only when the caller does not pass
 * the scene's seeded RNG. Keeps pool variation reproducible in unit tests.
 */
function createFallbackRandom(seed: number): FigurePoolRandom {
  let state = (Math.trunc(seed) || 1) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value = (value ^ (value + Math.imul(value ^ (value >>> 7), value | 61))) >>> 0;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    float: (min = 0, max = 1) => min + next() * (max - min),
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
  };
}
