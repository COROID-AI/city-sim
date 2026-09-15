/**
 * Era material sets and the shared prop vocabulary for the furniture domain.
 *
 * Two responsibilities live here, both of them about *how a prop surface is
 * expressed in three.js*:
 *
 *  1. **Material sets** — {@link createFurnitureMaterialSet} turns one era's
 *     {@link FurnitureMaterialSource} (31 named surface recipes: dark and light
 *     timber, reclaimed boards, laminate, formica, vinyl, wool, leather, cane,
 *     moulded plastic, painted steel, worn metal, chrome, brass, glass, stone,
 *     terrazzo, cork, linoleum, rug pile, sheers, blind slats, ceramic,
 *     terracotta, foliage, printed paper, paint, the era accent and the lamp
 *     stock) into named `MeshStandardMaterial`s. Every map is painted by
 *     `./textures`, so a set never triggers a network request.
 *  2. **Prop vocabulary** — the mesh factories ({@link boxMesh},
 *     {@link cylinderMesh}, {@link torusMesh}, {@link sphereMesh},
 *     {@link propMesh}) and mount transforms ({@link wallMountTransform},
 *     {@link yawForDirection}) the five builder modules share. Keeping them
 *     here avoids both a second geometry toolkit and an import cycle: the build
 *     modules only ever import types from `FurnitureModule`.
 *
 * Lifecycle mirrors the shell: `createFurnitureMaterialSet` builds a fresh set,
 * `disposeFurnitureMaterialSet` releases every texture and material in it. The
 * module builds the next set before releasing the previous one, so a frame can
 * never render a disposed material.
 */

import * as THREE from 'three';
import type { RoomPoint, YearId } from '../../contracts/period';
import {
  createFurnitureTexture,
  type CanvasFactory,
  type FurnitureTextureKind,
  type FurnitureTexturePalette,
  type FurnitureTextureStyle,
} from './textures';

/* -------------------------------------------------------------------------- */
/* Material slots                                                             */
/* -------------------------------------------------------------------------- */

/** Every surface slot a furniture material set carries. */
export const FURNITURE_MATERIAL_SLOTS = Object.freeze([
  'woodDark',
  'woodLight',
  'woodReclaimed',
  'woodTop',
  'laminate',
  'formica',
  'vinyl',
  'fabric',
  'leather',
  'cane',
  'plastic',
  'metal',
  'wornMetal',
  'chrome',
  'brass',
  'glass',
  'stone',
  'terrazzo',
  'cork',
  'linoleum',
  'rug',
  'sheer',
  'blind',
  'ceramic',
  'terracotta',
  'foliage',
  'print',
  'paint',
  'accent',
  'lamp',
  'mirror',
] as const);

/** Name of a furniture material slot. */
export type FurnitureMaterialSlot = (typeof FURNITURE_MATERIAL_SLOTS)[number];

/** True when `value` names a furniture material slot. */
export function isFurnitureMaterialSlot(value: unknown): value is FurnitureMaterialSlot {
  return typeof value === 'string' && (FURNITURE_MATERIAL_SLOTS as readonly string[]).includes(value);
}

/** Canonical name of one furniture material (`furniture:<year>:<slot>`). */
export function furnitureMaterialName(year: YearId, slot: FurnitureMaterialSlot): string {
  return `furniture:${year}:${slot}`;
}

/* -------------------------------------------------------------------------- */
/* Recipes                                                                    */
/* -------------------------------------------------------------------------- */

/** One era's recipe for a single surface slot. */
export interface FurnitureMaterialRecipe {
  /** Prose description of the finish, surfaced in diagnostics and hotspots. */
  readonly finish: string;
  readonly style: FurnitureTextureStyle;
  readonly roughness: number;
  readonly metalness: number;
  readonly color?: string;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly side?: 'front' | 'back' | 'double';
  /** Overrides the material set's texture resolution for this slot. */
  readonly size?: number;
}

/** Optional extras accepted by {@link furnitureRecipe}. */
export interface FurnitureRecipeOptions {
  readonly detail?: string;
  readonly highlight?: string;
  readonly scale?: number;
  readonly contrast?: number;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly repeat?: readonly [number, number];
  readonly size?: number;
  readonly color?: string;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly side?: 'front' | 'back' | 'double';
}

/**
 * Builds one surface recipe. Era data files use this so each of the 31 slots
 * stays a single readable line while still carrying its full painter recipe.
 */
export function furnitureRecipe(
  finish: string,
  kind: FurnitureTextureKind,
  base: string,
  accent: string,
  roughness: number,
  metalness: number,
  options: FurnitureRecipeOptions = {},
): FurnitureMaterialRecipe {
  const palette: FurnitureTexturePalette = {
    base,
    accent,
    detail: options.detail,
    highlight: options.highlight,
  };
  return {
    finish,
    style: {
      kind,
      palette,
      scale: options.scale,
      contrast: options.contrast,
      orientation: options.orientation,
      repeat: options.repeat,
      size: options.size,
    },
    roughness,
    metalness,
    color: options.color,
    emissive: options.emissive,
    emissiveIntensity: options.emissiveIntensity,
    transparent: options.transparent,
    opacity: options.opacity,
    side: options.side,
    size: options.size,
  };
}

/* -------------------------------------------------------------------------- */
/* Material set                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The part of a furniture era spec a material set is built from. `FurnitureSpec`
 * extends it, so a spec can be handed straight to
 * {@link createFurnitureMaterialSet}.
 */
export interface FurnitureMaterialSource {
  readonly year: YearId;
  /** Name of the era's material palette, e.g. `'Utility oak and oxblood rexine'`. */
  readonly paletteName: string;
  /** Identifier of the material set `applyPeriod` swaps in. */
  readonly materialSetId: string;
  readonly surfaces: Readonly<Record<FurnitureMaterialSlot, FurnitureMaterialRecipe>>;
}

/** A complete set of era materials for the furniture domain. */
export interface FurnitureMaterialSet {
  /** `furniture-material-set:<year>:<spec-material-set-id>`. */
  readonly id: string;
  readonly year: YearId;
  readonly paletteName: string;
  readonly specMaterialSetId: string;
  readonly slots: Readonly<Record<FurnitureMaterialSlot, THREE.Material>>;
  /** Every procedural texture the set owns. */
  readonly textures: readonly THREE.Texture[];
  readonly textureSource: 'canvas' | 'data' | 'mixed';
}

export interface FurnitureMaterialSetOptions {
  /** Canvas factory used for the procedural maps (defaults to the DOM). */
  readonly canvasFactory?: CanvasFactory;
  /** Texture resolution override for every slot. */
  readonly textureSize?: number;
}

/** Reads one slot out of a set, typed as a standard material for mesh use. */
export function furnitureMaterial(
  set: FurnitureMaterialSet,
  slot: FurnitureMaterialSlot,
): THREE.MeshStandardMaterial {
  return set.slots[slot] as THREE.MeshStandardMaterial;
}

/** Every material in a set, in slot order. */
export function furnitureMaterialSetMaterials(set: FurnitureMaterialSet): readonly THREE.Material[] {
  return FURNITURE_MATERIAL_SLOTS.map((slot) => set.slots[slot]);
}

/** Deterministic signature of a set: identical for identical era material sets. */
export function furnitureMaterialSetSignature(set: FurnitureMaterialSet): string {
  const parts = FURNITURE_MATERIAL_SLOTS.map((slot) => {
    const material = set.slots[slot] as THREE.MeshStandardMaterial;
    const map = material.map;
    return `${slot}=${material.name}${map ? `:${map.name}` : ''}`;
  });
  return [set.id, ...parts].join('|');
}

interface BuildState {
  readonly source: FurnitureMaterialSource;
  readonly canvasFactory: CanvasFactory | undefined;
  readonly textureSize: number | undefined;
  readonly textures: THREE.Texture[];
  readonly sources: Set<'canvas' | 'data'>;
}

function sideOf(side: FurnitureMaterialRecipe['side']): THREE.Side {
  if (side === 'double') return THREE.DoubleSide;
  if (side === 'back') return THREE.BackSide;
  return THREE.FrontSide;
}

function buildSlot(state: BuildState, slot: FurnitureMaterialSlot): THREE.Material {
  const recipe = state.source.surfaces[slot];
  if (!recipe) {
    throw new Error(`The ${state.source.year} furniture spec is missing the "${slot}" surface.`);
  }
  const textureSize = recipe.size ?? state.textureSize;
  const finish = createFurnitureTexture(
    { ...recipe.style, size: textureSize ?? recipe.style.size },
    { key: `${state.source.year}:${slot}`, canvasFactory: state.canvasFactory },
  );
  state.textures.push(finish.texture);
  state.sources.add(finish.source);

  const material = new THREE.MeshStandardMaterial({
    name: furnitureMaterialName(state.source.year, slot),
    map: finish.texture,
    color: recipe.color ?? 0xffffff,
    roughness: Math.min(Math.max(recipe.roughness, 0), 1),
    metalness: Math.min(Math.max(recipe.metalness, 0), 1),
    side: sideOf(recipe.side),
    transparent: recipe.transparent ?? false,
    opacity: recipe.opacity ?? 1,
    emissive: recipe.emissive ?? 0x000000,
    emissiveIntensity: recipe.emissive ? (recipe.emissiveIntensity ?? 1) : 0,
  });
  material.userData = {
    furniture: {
      slot,
      year: state.source.year,
      materialSetId: state.source.materialSetId,
      paletteName: state.source.paletteName,
      finish: recipe.finish,
      textureKey: finish.texture.name,
      textureSource: finish.source,
      procedural: true,
    },
  };
  return material;
}

/** Builds an era's complete material set (procedural textures, no network). */
export function createFurnitureMaterialSet(
  source: FurnitureMaterialSource,
  options: FurnitureMaterialSetOptions = {},
): FurnitureMaterialSet {
  const state: BuildState = {
    source,
    canvasFactory: options.canvasFactory,
    textureSize: options.textureSize,
    textures: [],
    sources: new Set(),
  };

  const slots = {} as Record<FurnitureMaterialSlot, THREE.Material>;
  for (const slot of FURNITURE_MATERIAL_SLOTS) {
    slots[slot] = buildSlot(state, slot);
  }

  const textureSource: FurnitureMaterialSet['textureSource'] =
    state.sources.size > 1 ? 'mixed' : state.sources.has('canvas') ? 'canvas' : 'data';

  return {
    id: `furniture-material-set:${source.year}:${source.materialSetId}`,
    year: source.year,
    paletteName: source.paletteName,
    specMaterialSetId: source.materialSetId,
    slots: Object.freeze(slots),
    textures: Object.freeze([...state.textures]),
    textureSource,
  };
}

/** Releases every material and texture of a set. Safe to call once per set. */
export function disposeFurnitureMaterialSet(set: FurnitureMaterialSet): void {
  for (const texture of set.textures) texture.dispose();
  for (const slot of FURNITURE_MATERIAL_SLOTS) set.slots[slot].dispose();
}

/* -------------------------------------------------------------------------- */
/* Prop vocabulary                                                            */
/* -------------------------------------------------------------------------- */

/** Options every mesh factory accepts. */
export interface PropMeshOptions {
  /** Node name, namespaced by the caller (`furniture-chair-…`). */
  readonly name: string;
  /** Part tag used by diagnostics and the placement tests. */
  readonly part: string;
  readonly position?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly scale?: readonly [number, number, number];
  readonly castShadow?: boolean;
}

/**
 * Creates a prop mesh bound to its era material. The material's slot (recorded
 * in `userData.furniture.slot`) is copied onto the mesh so placement diagnostics
 * and tests can address every part of a prop without a second lookup.
 */
export function propMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  options: PropMeshOptions,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  const slot = (material.userData['furniture'] as { slot?: FurnitureMaterialSlot } | undefined)?.slot;
  mesh.name = options.name;
  mesh.userData.furniturePart = options.part;
  mesh.userData.furnitureSlot = slot ?? null;
  if (options.position) mesh.position.set(...options.position);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.scale) mesh.scale.set(...options.scale);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Axis aligned box prop part. */
export function boxMesh(
  size: readonly [number, number, number],
  material: THREE.Material,
  options: PropMeshOptions,
): THREE.Mesh {
  return propMesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material, options);
}

/** Cylinder prop part (pedestals, legs, rails, pots, clocks). */
export function cylinderMesh(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  material: THREE.Material,
  options: PropMeshOptions,
  segments = 18,
): THREE.Mesh {
  return propMesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
    options,
  );
}

/** Torus prop part (chrome rims, bagged edges, foot rings). */
export function torusMesh(
  radius: number,
  tube: number,
  material: THREE.Material,
  options: PropMeshOptions,
  segments = 20,
): THREE.Mesh {
  return propMesh(new THREE.TorusGeometry(radius, tube, 10, segments), material, options);
}

/** Sphere prop part (finials, bulbs, finials on hat racks). */
export function sphereMesh(
  radius: number,
  material: THREE.Material,
  options: PropMeshOptions,
  segments = 16,
): THREE.Mesh {
  return propMesh(new THREE.SphereGeometry(radius, segments, Math.max(Math.round(segments / 2), 6)), material, options);
}

/** Yaw (radians) that turns a prop's +Z face towards (`x`, `z`). */
export function yawForDirection(x: number, z: number): number {
  return Math.atan2(x, z);
}

/** Where a wall mounted prop sits and how it is turned to face the room. */
export interface WallMountTransform {
  readonly position: RoomPoint;
  readonly rotationY: number;
}

/**
 * Places a wall mounted prop against the inward face of a wall.
 *
 * `mount.position` lies exactly on the wall plane, so the prop is pushed into
 * the room by half its depth (plus `inset`) — which also keeps its bounding box
 * inside {@link RoomBounds} rather than half-buried in the wall.
 */
export function wallMountTransform(
  mount: { readonly position: RoomPoint; readonly normal: RoomPoint; readonly mountHeight: number },
  options: { readonly depth: number; readonly height?: number; readonly inset?: number },
): WallMountTransform {
  const inset = Math.max(options.inset ?? 0.004, 0);
  const push = options.depth / 2 + inset;
  const height = options.height ?? mount.mountHeight;
  return {
    position: {
      x: mount.position.x + mount.normal.x * push,
      y: height,
      z: mount.position.z + mount.normal.z * push,
    },
    rotationY: yawForDirection(mount.normal.x, mount.normal.z),
  };
}
