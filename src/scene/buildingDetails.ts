/**
 * Chrono City procedural building-detail library.
 *
 * Pure, renderer-agnostic helpers that turn an era descriptor into the pieces a
 * building is made of: massing steps, window grids, cornices, sill courses,
 * storefront bays, fire escapes, rooftop equipment, rooftop advertising
 * structures and media-facade panels - plus the procedural canvas textures and
 * PBR materials those pieces are drawn with.
 *
 * Two design rules keep this module cheap enough to run on every era switch:
 *
 * 1. Builders return *part descriptors* (recipe + transform), never geometry.
 *    Triangle budgets are therefore known analytically, so a caller can plan a
 *    whole era's buildings without allocating a single buffer, and only the
 *    active generation pays for real geometry (`mergeParts`).
 * 2. Textures are generated once per era and shared; advertising animates only
 *    by advancing a texture offset or an emissive intensity, never by
 *    repainting a canvas.
 *
 * Nothing here imports the layout contract or three.js scene state: geometry is
 * produced in building-local space (origin at the lot centre, +Z towards the
 * street) and the caller owns placement.
 */

import * as THREE from "three";

import type {
  AdMedium,
  ArchitectureStyle,
  BuildingDescriptor,
  EraConfig,
  EraId,
  FacadeRole,
  MaterialSpec,
} from "../era/eraTypes";

/* -------------------------------------------------------------------------- */
/* Small numeric helpers                                                      */
/* -------------------------------------------------------------------------- */

/** Clamps `value` into the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Deterministic 0..1 sample from a numeric seed and a salt label. */
function seedSample(seed: number, salt: string): number {
  return hashUnit(`${seed >>> 0}:${salt}`);
}

/** Deterministic 32-bit FNV-1a hash mapped to `[0, 1)`. */
export function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/** Small deterministic PRNG, used only by the texture painters. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function toRgb(color: number): readonly [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function mixColors(a: number, b: number, t: number): number {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  const channel = (x: number, y: number): number => clamp(Math.round(x + (y - x) * t), 0, 255);
  return (channel(ar, br) << 16) | (channel(ag, bg) << 8) | channel(ab, bb);
}

function shade(color: number, factor: number): number {
  const [r, g, b] = toRgb(color);
  const channel = (value: number): number => clamp(Math.round(value * factor), 0, 255);
  return (channel(r) << 16) | (channel(g) << 8) | channel(b);
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Part model                                                                 */
/* -------------------------------------------------------------------------- */

/** Material slot a building part is drawn with. */
export type PartMaterialKey =
  | "wall"
  | "trim"
  | "roof"
  | "glazing"
  | "storefront"
  | "metal"
  | "signage"
  | "media"
  | "green";

/** Canonical slot order, so material sets and reports iterate identically. */
export const PART_MATERIAL_KEYS = [
  "wall",
  "trim",
  "roof",
  "glazing",
  "storefront",
  "metal",
  "signage",
  "media",
  "green",
] as const satisfies readonly PartMaterialKey[];

/** Immutable 3-component vector used by part transforms. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Identity transform shorthand. */
export const NO_ROTATION: Vec3 = { x: 0, y: 0, z: 0 };

/** Parameterized primitive a part is built from; carries no geometry itself. */
export type GeometryRecipe =
  | { readonly kind: "box"; readonly width: number; readonly height: number; readonly depth: number }
  | { readonly kind: "plane"; readonly width: number; readonly height: number }
  | {
      readonly kind: "cylinder";
      readonly radiusTop: number;
      readonly radiusBottom: number;
      readonly height: number;
      readonly radialSegments: number;
      readonly openEnded: boolean;
    }
  | { readonly kind: "cone"; readonly radius: number; readonly height: number; readonly radialSegments: number }
  | {
      readonly kind: "torus";
      readonly radius: number;
      readonly tube: number;
      readonly radialSegments: number;
      readonly tubularSegments: number;
    }
  | { readonly kind: "disc"; readonly radius: number; readonly segments: number };

/** One piece of a building, in building-local space. */
export interface PartDescriptor {
  readonly material: PartMaterialKey;
  readonly recipe: GeometryRecipe;
  readonly position: Vec3;
  readonly rotation: Vec3;
  /** Optional UV density multiplier, used to keep facade texel size stable. */
  readonly uvScale?: { readonly u: number; readonly v: number };
}

/** Builds a box part. */
export function box(
  material: PartMaterialKey,
  width: number,
  height: number,
  depth: number,
  position: Vec3,
  rotation: Vec3 = NO_ROTATION,
  uvScale?: { readonly u: number; readonly v: number },
): PartDescriptor {
  return { material, recipe: { kind: "box", width, height, depth }, position, rotation, uvScale };
}

/** Builds a single-quad plane part; planes face +Z before rotation. */
export function plane(
  material: PartMaterialKey,
  width: number,
  height: number,
  position: Vec3,
  rotation: Vec3 = NO_ROTATION,
): PartDescriptor {
  return { material, recipe: { kind: "plane", width, height }, position, rotation };
}

/** Builds a cylinder part (optionally open-ended, for tubes and rings). */
export function cylinder(
  material: PartMaterialKey,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: Vec3,
  rotation: Vec3 = NO_ROTATION,
  radialSegments = 10,
  openEnded = false,
): PartDescriptor {
  return {
    material,
    recipe: { kind: "cylinder", radiusTop, radiusBottom, height, radialSegments, openEnded },
    position,
    rotation,
  };
}

/** Builds a cone part. */
export function cone(
  material: PartMaterialKey,
  radius: number,
  height: number,
  position: Vec3,
  rotation: Vec3 = NO_ROTATION,
  radialSegments = 10,
): PartDescriptor {
  return { material, recipe: { kind: "cone", radius, height, radialSegments }, position, rotation };
}

/** Builds a torus part; the ring lies in the XY plane before rotation. */
export function torus(
  material: PartMaterialKey,
  radius: number,
  tube: number,
  position: Vec3,
  rotation: Vec3 = NO_ROTATION,
  radialSegments = 5,
  tubularSegments = 14,
): PartDescriptor {
  return { material, recipe: { kind: "torus", radius, tube, radialSegments, tubularSegments }, position, rotation };
}

/** Builds a flat disc part; the disc faces +Z before rotation. */
export function disc(
  material: PartMaterialKey,
  radius: number,
  position: Vec3,
  rotation: Vec3 = NO_ROTATION,
  segments = 12,
): PartDescriptor {
  return { material, recipe: { kind: "disc", radius, segments }, position, rotation };
}

/* -------------------------------------------------------------------------- */
/* Geometry realisation and triangle accounting                                */
/* -------------------------------------------------------------------------- */

/** Creates the three.js geometry for a recipe. The caller owns the result. */
export function createGeometry(recipe: GeometryRecipe): THREE.BufferGeometry {
  switch (recipe.kind) {
    case "box":
      return new THREE.BoxGeometry(recipe.width, recipe.height, recipe.depth);
    case "plane":
      return new THREE.PlaneGeometry(recipe.width, recipe.height);
    case "cylinder":
      return new THREE.CylinderGeometry(
        recipe.radiusTop,
        recipe.radiusBottom,
        recipe.height,
        recipe.radialSegments,
        1,
        recipe.openEnded,
      );
    case "cone":
      return new THREE.ConeGeometry(recipe.radius, recipe.height, recipe.radialSegments);
    case "torus":
      return new THREE.TorusGeometry(recipe.radius, recipe.tube, recipe.radialSegments, recipe.tubularSegments);
    case "disc":
      return new THREE.CircleGeometry(recipe.radius, recipe.segments);
  }
}

/**
 * Triangle count of one recipe.
 *
 * Measured from the real geometry once per topology signature and memoized, so
 * the analytic budget always matches what `mergeParts` produces - only the
 * segment counts affect the count, never the dimensions.
 */
export function trianglesFor(recipe: GeometryRecipe): number {
  const key = topologyKey(recipe);
  const cached = TOPOLOGY_TRIANGLES.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const geometry = createGeometry(recipe);
  const count = triangleCount(geometry);
  geometry.dispose();
  TOPOLOGY_TRIANGLES.set(key, count);
  return count;
}

const TOPOLOGY_TRIANGLES = new Map<string, number>();

function topologyKey(recipe: GeometryRecipe): string {
  switch (recipe.kind) {
    case "box":
      return "box";
    case "plane":
      return "plane";
    case "cylinder":
      return `cylinder:${recipe.radialSegments}:${recipe.openEnded ? "open" : "closed"}`;
    case "cone":
      return `cone:${recipe.radialSegments}`;
    case "torus":
      return `torus:${recipe.radialSegments}:${recipe.tubularSegments}`;
    case "disc":
      return `disc:${recipe.segments}`;
  }
}

/** Sums the triangle budget of a part list without allocating geometry. */
export function countTriangles(parts: readonly PartDescriptor[]): number {
  let total = 0;
  for (const part of parts) {
    total += trianglesFor(part.recipe);
  }
  return total;
}

/** Triangle count of a realised geometry, honouring indexed buffers. */
export function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) {
    return Math.round(index.count / 3);
  }
  const position = geometry.getAttribute("position");
  return position ? Math.round(position.count / 3) : 0;
}

/**
 * Realises every part and merges the results per material slot.
 *
 * One merged buffer per slot keeps a building at a handful of draw calls, and
 * merging is triangle-preserving, so `countTriangles(parts)` stays the
 * authoritative budget. Source geometries are disposed inside the merge.
 */
export function mergeParts(parts: readonly PartDescriptor[]): Map<PartMaterialKey, THREE.BufferGeometry> {
  const grouped = new Map<PartMaterialKey, THREE.BufferGeometry[]>();
  for (const part of parts) {
    const geometry = createGeometry(part.recipe);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(part.position.x, part.position.y, part.position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotation.x, part.rotation.y, part.rotation.z)),
      new THREE.Vector3(1, 1, 1),
    );
    geometry.applyMatrix4(matrix);
    if (part.uvScale) {
      applyUvScale(geometry, part.uvScale);
    }
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) {
      geometry.dispose();
    }
    const bucket = grouped.get(part.material);
    if (bucket) {
      bucket.push(flat);
    } else {
      grouped.set(part.material, [flat]);
    }
  }

  const merged = new Map<PartMaterialKey, THREE.BufferGeometry>();
  for (const [material, geometries] of grouped) {
    merged.set(material, mergeGeometries(geometries));
  }
  return merged;
}

function applyUvScale(geometry: THREE.BufferGeometry, scale: { readonly u: number; readonly v: number }): void {
  const uv = geometry.getAttribute("uv");
  if (!uv) {
    return;
  }
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, uv.getX(index) * scale.u, uv.getY(index) * scale.v);
  }
  uv.needsUpdate = true;
}

function mergeGeometries(geometries: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertexCount = 0;
  for (const geometry of geometries) {
    vertexCount += geometry.getAttribute("position").count;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  let offset = 0;
  for (const geometry of geometries) {
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    for (let index = 0; index < position.count; index += 1) {
      const target = offset + index;
      positions[target * 3] = position.getX(index);
      positions[target * 3 + 1] = position.getY(index);
      positions[target * 3 + 2] = position.getZ(index);
      if (normal) {
        normals[target * 3] = normal.getX(index);
        normals[target * 3 + 1] = normal.getY(index);
        normals[target * 3 + 2] = normal.getZ(index);
      }
      if (uv) {
        uvs[target * 2] = uv.getX(index);
        uvs[target * 2 + 1] = uv.getY(index);
      }
    }
    offset += position.count;
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  merged.computeBoundingSphere();
  return merged;
}

/* -------------------------------------------------------------------------- */
/* Recipes: how each era's architecture is put together                        */
/* -------------------------------------------------------------------------- */

/** Window construction language of a building. */
export type GlazingSystem = "masonry-sash" | "steel-sash" | "mirror-ribbon" | "banded-curtain" | "smart-curtain";

/** Per-building window treatment derived from the era descriptor. */
export interface GlazingRecipe {
  readonly system: GlazingSystem;
  /** Per-window backer frame (masonry reveal or steel sash). */
  readonly frame: boolean;
  /** Per-window stone sill. */
  readonly sill: boolean;
  /** Per-window lintel, only on ornamented masonry. */
  readonly lintel: boolean;
  /** Continuous spandrel/sill course per storey and facade. */
  readonly band: boolean;
  /** Vertical mullion per bay boundary. */
  readonly mullion: boolean;
  /** Planted balcony fin per storey (green towers). */
  readonly planter: boolean;
  /** Accent band every N storeys (0 disables). */
  readonly accentEvery: number;
  /** Corner piers per building. */
  readonly piers: number;
  /** How far panes sit behind the facade plane, in metres. */
  readonly recess: number;
}

const GLAZING_BY_STYLE: Readonly<Record<ArchitectureStyle, GlazingSystem>> = {
  "postwar-brick-masonry": "masonry-sash",
  "art-deco-limestone": "masonry-sash",
  "midcentury-curtain-wall": "steel-sash",
  "precast-concrete-slab": "steel-sash",
  "mirror-glass-tower": "mirror-ribbon",
  "postmodern-trim-stone": "mirror-ribbon",
  "blue-glass-office": "banded-curtain",
  "brick-loft-revival": "banded-curtain",
  "mass-timber-hybrid": "smart-curtain",
  "adaptive-reuse-brick": "smart-curtain",
};

/** Derives the window treatment for an era's primary architecture style. */
export function glazingRecipeFor(descriptor: BuildingDescriptor): GlazingRecipe {
  const system = GLAZING_BY_STYLE[descriptor.style];
  const ornament = descriptor.ornament;
  const piers = ornament >= 0.5 ? 4 : 0;
  switch (system) {
    case "masonry-sash":
      return {
        system,
        frame: true,
        sill: true,
        lintel: ornament >= 0.6,
        band: false,
        mullion: false,
        planter: false,
        accentEvery: 0,
        piers,
        recess: descriptor.window.recessed ? 0.24 : 0.1,
      };
    case "steel-sash":
      return {
        system,
        frame: true,
        sill: false,
        lintel: false,
        band: true,
        mullion: descriptor.facadeModules >= 6,
        planter: false,
        accentEvery: 0,
        piers,
        recess: descriptor.window.recessed ? 0.18 : 0.08,
      };
    case "mirror-ribbon":
      return {
        system,
        frame: false,
        sill: false,
        lintel: false,
        band: true,
        mullion: true,
        planter: false,
        accentEvery: ornament >= 0.5 ? 6 : 0,
        piers,
        recess: 0.12,
      };
    case "banded-curtain":
      return {
        system,
        frame: false,
        sill: false,
        lintel: false,
        band: true,
        mullion: true,
        planter: false,
        accentEvery: 3,
        piers,
        recess: 0.1,
      };
    case "smart-curtain":
      return {
        system,
        frame: false,
        sill: false,
        lintel: false,
        band: true,
        mullion: true,
        planter: true,
        accentEvery: 0,
        piers,
        recess: 0.14,
      };
  }
}

/** Advertising structure this task hosts on a building's roof. */
export type RooftopSignStructure =
  | "painted-roof-sign"
  | "neon-rooftop-sign"
  | "neon-rooftop-billboard"
  | "digital-rooftop-panel"
  | "media-facade"
  | "none";

/** Advertising the era's descriptor puts on the buildings themselves. */
export interface AdvertisingStructures {
  readonly signage: RooftopSignStructure;
  readonly medium: AdMedium | null;
  /** Illuminated advertising panels let into the facade. */
  readonly mediaPanels: number;
  /** True when the structures are allowed to animate (UV/opacity only). */
  readonly animated: boolean;
}

/**
 * Maps an era's advertising descriptor onto rooftop signage plus media panels.
 *
 * The progression is data-driven: painted roof boards (post-war), neon roof
 * signs (mid-century), neon billboards (analog downtown), digital roof panels
 * (early digital) and full media facades (now).
 */
export function advertisingStructuresFor(era: EraConfig): AdvertisingStructures {
  const { advertising, buildings } = era;
  const has = (medium: AdMedium): boolean => advertising.media.includes(medium);
  const animated = advertising.animatedShare > 0;

  let signage: RooftopSignStructure = "none";
  let medium: AdMedium | null = null;

  if (has("programmatic-led-screen") || has("augmented-reality-overlay")) {
    signage = "media-facade";
    medium = has("programmatic-led-screen") ? "programmatic-led-screen" : "augmented-reality-overlay";
  } else if (has("street-furniture-lcd") || has("digital-kiosk") || has("bus-wrap")) {
    signage = "digital-rooftop-panel";
    medium = has("digital-kiosk") ? "digital-kiosk" : "street-furniture-lcd";
  } else if (has("neon-sign") && advertising.billboardScale >= 1.2) {
    signage = "neon-rooftop-billboard";
    medium = "neon-sign";
  } else if (has("neon-sign")) {
    signage = "neon-rooftop-sign";
    medium = "neon-sign";
  } else if (has("billboard-14x48") || has("billboard-panel")) {
    signage = "neon-rooftop-billboard";
    medium = has("billboard-14x48") ? "billboard-14x48" : "billboard-panel";
  } else if (has("painted-wall-bulletin") || has("war-bond-poster") || has("marquee-blade")) {
    signage = "painted-roof-sign";
    medium = has("painted-wall-bulletin") ? "painted-wall-bulletin" : "war-bond-poster";
  } else if (buildings.rooftopDetails.includes("painted-roof-sign")) {
    signage = "painted-roof-sign";
  }

  const scaledPanels = clamp(Math.round(advertising.animatedShare * 8), 0, 6);
  const mediaPanels = signage === "media-facade" ? Math.max(3, scaledPanels) : scaledPanels;

  return { signage, medium, mediaPanels, animated };
}

/** Rooftop detail ids consumed by the facade builders rather than the roof. */
export const FACADE_DETAIL_KINDS = ["fire-escape"] as const;

/** Rooftop detail ids consumed by the rooftop advertising builder. */
export const SIGNAGE_DETAIL_KINDS = ["painted-roof-sign", "billboard-truss"] as const;

/** True when the era's descriptor calls for facade fire escapes. */
export function hasFireEscape(descriptor: BuildingDescriptor): boolean {
  return descriptor.rooftopDetails.includes("fire-escape");
}

/** Rooftop detail ids this library builds as roof equipment. */
export function roofEquipmentKindsFor(descriptor: BuildingDescriptor): readonly string[] {
  return descriptor.rooftopDetails.filter(
    (detail) => !(FACADE_DETAIL_KINDS as readonly string[]).includes(detail)
      && !(SIGNAGE_DETAIL_KINDS as readonly string[]).includes(detail),
  );
}

/** Resolves a material recipe for a facade role, synthesizing a fallback. */
export function materialForRole(
  descriptor: BuildingDescriptor,
  role: FacadeRole,
  fallbackColor: number,
): MaterialSpec {
  const found = descriptor.materials.find((material) => material.role === role);
  if (found) {
    return found;
  }
  return {
    id: `${descriptor.style}-${role}-fallback`,
    role,
    color: fallbackColor,
    roughness: role === "glazing" ? 0.15 : 0.7,
    metalness: role === "glazing" ? 0.4 : 0.08,
  };
}

/* -------------------------------------------------------------------------- */
/* Massing                                                                    */
/* -------------------------------------------------------------------------- */

/** Inputs of the stepped massing generator. */
export interface MassingOptions {
  readonly width: number;
  readonly depth: number;
  readonly floors: number;
  readonly floorHeight: number;
  readonly setbackCount: number;
  readonly seed: number;
}

/** One mass in the stepped stack, with the storeys it carries. */
export interface MassingStep {
  readonly index: number;
  readonly y0: number;
  readonly y1: number;
  readonly width: number;
  readonly depth: number;
  readonly rows: number;
}

/** Massing parts plus the storey layout the facade builders consume. */
export interface MassingResult {
  readonly parts: readonly PartDescriptor[];
  readonly steps: readonly MassingStep[];
  readonly height: number;
  readonly topWidth: number;
  readonly topDepth: number;
}

/** Share of the storeys carried by the un-setback base mass. */
const BASE_STEP_SHARE = 0.62;
/** Nominal plan shrink per setback, so taller stacks taper towards the block edge. */
const STEP_SHRINK = 0.09;

/**
 * Builds the stepped building mass.
 *
 * Storeys are allocated to the base mass and the setbacks up front, so the
 * summed step heights are exactly `floors * floorHeight` - the window grids and
 * the reported height can never drift apart. `seed` only jitters how hard each
 * step tapers, which never grows the base mass beyond its footprint.
 */
export function buildMassing(options: MassingOptions): MassingResult {
  const totalSteps = Math.max(1, options.setbackCount + 1);
  const shrinkScale = STEP_SHRINK * (0.9 + seedSample(options.seed, "step") * 0.2);
  const baseRows = totalSteps > 1 && options.floors > 1
    ? Math.max(1, Math.round(options.floors * BASE_STEP_SHARE))
    : options.floors;

  const rowPlan: number[] = [baseRows];
  let remaining = options.floors - baseRows;
  for (let index = 1; index < totalSteps; index += 1) {
    const slots = totalSteps - index;
    const take = Math.max(0, Math.ceil(remaining / slots));
    rowPlan.push(take);
    remaining -= take;
  }

  const parts: PartDescriptor[] = [];
  const steps: MassingStep[] = [];
  let y = 0;
  let topWidth = options.width;
  let topDepth = options.depth;

  for (const rows of rowPlan) {
    if (rows <= 0) {
      continue;
    }
    const stepHeight = rows * options.floorHeight;
    const index = steps.length;
    const shrink = 1 - shrinkScale * index;
    const width = options.width * shrink;
    const depth = options.depth * shrink;
    parts.push(
      box("wall", width, stepHeight, depth, { x: 0, y: y + stepHeight / 2, z: 0 }, NO_ROTATION, wallUv(width, stepHeight)),
    );
    steps.push({ index, y0: y, y1: y + stepHeight, width, depth, rows });
    y += stepHeight;
    topWidth = width;
    topDepth = depth;
  }

  parts.push(box("roof", topWidth * 0.98, 0.3, topDepth * 0.98, { x: 0, y, z: 0 }, NO_ROTATION, wallUv(topWidth, topDepth)));
  return { parts, steps, height: y, topWidth, topDepth };
}

/** Keeps facade texel density roughly constant whatever the building size. */
function wallUv(width: number, height: number): { readonly u: number; readonly v: number } {
  return { u: clamp(Math.round(width / 3), 1, 8), v: clamp(Math.round(height / 3), 1, 14) };
}

/* -------------------------------------------------------------------------- */
/* Cornices and parapets                                                      */
/* -------------------------------------------------------------------------- */

/** Inputs of the cornice/parapet generator. */
export interface CorniceOptions {
  readonly steps: readonly MassingStep[];
  readonly ornament: number;
  readonly seed: number;
}

/** Cornice parts plus the number of cornice bands produced. */
export interface CorniceResult {
  readonly parts: readonly PartDescriptor[];
  readonly cornices: number;
}

/** Builds the overhanging cornice/parapet band on every massing step. */
export function buildCornices(options: CorniceOptions): CorniceResult {
  const parts: PartDescriptor[] = [];
  let cornices = 0;
  const overhang = (0.36 + options.ornament * 0.55) * (0.92 + seedSample(options.seed, "cornice") * 0.16);

  options.steps.forEach((step, index) => {
    const top = index === options.steps.length - 1;
    parts.push(
      box("trim", step.width + overhang, top ? 0.46 : 0.3, step.depth + overhang, { x: 0, y: step.y1, z: 0 }),
    );
    cornices += 1;
    if (options.ornament >= 0.45 && step.rows >= 3) {
      const belt = step.y0 + (step.y1 - step.y0) * 0.5;
      parts.push(box("trim", step.width + overhang * 0.5, 0.2, step.depth + overhang * 0.5, { x: 0, y: belt, z: 0 }));
      cornices += 1;
    }
  });

  return { parts, cornices };
}

/* -------------------------------------------------------------------------- */
/* Window grids                                                               */
/* -------------------------------------------------------------------------- */

interface FacadeFace {
  readonly origin: Vec3;
  readonly ry: number;
  readonly span: number;
  readonly columns: number;
}

function facadeFaces(width: number, depth: number, columns: number, sideColumns: number): readonly FacadeFace[] {
  return [
    { origin: { x: 0, y: 0, z: depth / 2 }, ry: 0, span: width, columns },
    { origin: { x: 0, y: 0, z: -depth / 2 }, ry: Math.PI, span: width, columns },
    { origin: { x: width / 2, y: 0, z: 0 }, ry: Math.PI / 2, span: depth, columns: sideColumns },
    { origin: { x: -width / 2, y: 0, z: 0 }, ry: -Math.PI / 2, span: depth, columns: sideColumns },
  ];
}

/** Places a facade-local point (along the frontage, up, out of the wall). */
function placeOnFace(face: FacadeFace, along: number, y: number, out: number): { position: Vec3; rotation: Vec3 } {
  const cos = Math.cos(face.ry);
  const sin = Math.sin(face.ry);
  return {
    position: {
      x: face.origin.x + along * cos + out * sin,
      y,
      z: face.origin.z - along * sin + out * cos,
    },
    rotation: { x: 0, y: face.ry, z: 0 },
  };
}

/** Inputs of one mass's window grid. */
export interface WindowGridOptions {
  readonly recipe: GlazingRecipe;
  readonly width: number;
  readonly depth: number;
  readonly columns: number;
  readonly sideColumns: number;
  readonly rows: number;
  readonly yBottom: number;
  readonly rowHeight: number;
  readonly includePiers: boolean;
}

/** Window grid parts plus the facade element census. */
export interface WindowGridResult {
  readonly parts: readonly PartDescriptor[];
  readonly panes: number;
  readonly frames: number;
  readonly sills: number;
  readonly lintels: number;
  readonly bands: number;
  readonly mullions: number;
  readonly planters: number;
  readonly piers: number;
}

/** Maximum pane size, so a sparse facade never grows cartoon windows. */
const MAX_PANE_WIDTH = 1.9;
const MAX_PANE_HEIGHT = 2.5;

/** Builds one mass's windows on all four facades, with era-specific framing. */
export function buildWindowGrid(options: WindowGridOptions): WindowGridResult {
  const parts: PartDescriptor[] = [];
  const { recipe } = options;
  const faces = facadeFaces(options.width, options.depth, options.columns, options.sideColumns);
  let panes = 0;
  let frames = 0;
  let sills = 0;
  let lintels = 0;
  let bands = 0;
  let mullions = 0;
  let planters = 0;
  const gridHeight = options.rows * options.rowHeight;

  for (const face of faces) {
    const columns = Math.max(2, face.columns);
    const bayWidth = face.span / columns;
    const paneWidth = Math.min(bayWidth * 0.62, MAX_PANE_WIDTH);
    const paneHeight = Math.min(options.rowHeight * 0.6, MAX_PANE_HEIGHT);

    if (recipe.mullion) {
      for (let bay = 0; bay <= columns; bay += 1) {
        const along = -face.span / 2 + bay * bayWidth;
        parts.push(
          box("trim", 0.14, gridHeight, 0.14, placeOnFace(face, along, options.yBottom + gridHeight / 2, -0.04).position),
        );
        mullions += 1;
      }
    }

    for (let row = 0; row < options.rows; row += 1) {
      const centre = options.yBottom + (row + 0.5) * options.rowHeight;

      if (recipe.band) {
        const bandY = options.yBottom + row * options.rowHeight + 0.12;
        parts.push(box("trim", face.span + 0.22, 0.18, 0.22, placeOnFace(face, 0, bandY, 0.05).position));
        bands += 1;
      }
      if (recipe.accentEvery > 0 && row % recipe.accentEvery === 0) {
        parts.push(
          box("trim", face.span + 0.34, 0.3, 0.28, placeOnFace(face, 0, options.yBottom + row * options.rowHeight + 0.05, 0.09).position),
        );
        bands += 1;
      }
      if (recipe.planter) {
        const planterY = options.yBottom + (row + 1) * options.rowHeight - 0.34;
        parts.push(
          box("green", face.span * 0.9, 0.62, 0.5, placeOnFace(face, 0, planterY, 0.32).position),
        );
        planters += 1;
      }

      for (let column = 0; column < columns; column += 1) {
        const along = -face.span / 2 + bayWidth * (column + 0.5);
        const pane = placeOnFace(face, along, centre, -recipe.recess);
        parts.push(plane("glazing", paneWidth, paneHeight, pane.position, pane.rotation));
        panes += 1;

        if (recipe.frame) {
          parts.push(
            box(
              "trim",
              paneWidth + 0.18,
              paneHeight + 0.18,
              0.14,
              placeOnFace(face, along, centre, -recipe.recess - 0.12).position,
            ),
          );
          frames += 1;
        }
        if (recipe.sill) {
          parts.push(
            box(
              "trim",
              paneWidth + 0.36,
              0.14,
              0.28,
              placeOnFace(face, along, centre - paneHeight / 2 - 0.08, 0.06).position,
            ),
          );
          sills += 1;
        }
        if (recipe.lintel) {
          parts.push(
            box(
              "trim",
              paneWidth + 0.36,
              0.2,
              0.24,
              placeOnFace(face, along, centre + paneHeight / 2 + 0.12, 0.05).position,
            ),
          );
          lintels += 1;
        }
      }
    }
  }

  let piers = 0;
  if (options.includePiers && recipe.piers > 0) {
    const corners: readonly Vec3[] = [
      { x: -options.width / 2, y: 0, z: -options.depth / 2 },
      { x: options.width / 2, y: 0, z: -options.depth / 2 },
      { x: options.width / 2, y: 0, z: options.depth / 2 },
      { x: -options.width / 2, y: 0, z: options.depth / 2 },
    ];
    for (const corner of corners) {
      parts.push(box("trim", 0.46, gridHeight, 0.46, { x: corner.x, y: options.yBottom + gridHeight / 2, z: corner.z }));
      piers += 1;
    }
  }

  return { parts, panes, frames, sills, lintels, bands, mullions, planters, piers };
}

/* -------------------------------------------------------------------------- */
/* Ground floor: storefront bays and entrance                                 */
/* -------------------------------------------------------------------------- */

/** Inputs of the ground-floor storefront generator. */
export interface StorefrontOptions {
  readonly width: number;
  readonly depth: number;
  readonly floorHeight: number;
  readonly bays: number;
  readonly ornament: number;
  readonly seed: number;
}

/** Storefront parts plus the bay/entrance census. */
export interface StorefrontResult {
  readonly parts: readonly PartDescriptor[];
  readonly bays: number;
  readonly entrances: number;
  readonly awnings: number;
}

/** Builds the storefront-height ground floor on the street facade. */
export function buildStorefrontBays(options: StorefrontOptions): StorefrontResult {
  const parts: PartDescriptor[] = [];
  const front: FacadeFace = { origin: { x: 0, y: 0, z: options.depth / 2 }, ry: 0, span: options.width, columns: options.bays };
  const bayCount = Math.max(1, options.bays);
  const bayWidth = options.width / bayCount;
  const bandHeight = Math.max(2.4, options.floorHeight * 1.1);
  let awnings = 0;

  for (let bay = 0; bay < bayCount; bay += 1) {
    const along = -options.width / 2 + bayWidth * (bay + 0.5);
    const glass = placeOnFace(front, along, bandHeight * 0.46, -0.06);
    const glassWidth = bayWidth * (0.76 + seedSample(options.seed, `glass-${bay}`) * 0.08);
    parts.push(plane("storefront", glassWidth, bandHeight * 0.68, glass.position, glass.rotation));
    parts.push(
      box("trim", 0.2, bandHeight, 0.34, placeOnFace(front, along - bayWidth / 2, bandHeight / 2, 0.02).position),
    );
    if (options.ornament >= 0.4) {
      const awning = placeOnFace(front, along, bandHeight - 0.16, 0.38);
      parts.push(
        box("trim", bayWidth * 0.82, 0.12, 0.8, awning.position, { x: -0.26, y: 0, z: 0 }),
      );
      awnings += 1;
    }
  }

  parts.push(box("trim", 0.2, bandHeight, 0.34, placeOnFace(front, options.width / 2, bandHeight / 2, 0.02).position));
  parts.push(box("trim", options.width + 0.24, 0.52, 0.34, placeOnFace(front, 0, bandHeight + 0.26, 0.06).position));
  parts.push(box("metal", 1.25, bandHeight * 0.78, 0.16, placeOnFace(front, 0, bandHeight * 0.39, 0.22).position));
  parts.push(box("trim", 1.7, 0.14, 0.95, placeOnFace(front, 0, bandHeight * 0.82, 0.46).position));

  return { parts, bays: bayCount, entrances: 1, awnings };
}

/* -------------------------------------------------------------------------- */
/* Fire escapes                                                               */
/* -------------------------------------------------------------------------- */

/** Inputs of the facade fire-escape generator. */
export interface FireEscapeOptions {
  readonly width: number;
  readonly depth: number;
  readonly rows: number;
  readonly yBottom: number;
  readonly rowHeight: number;
  readonly seed: number;
}

/** Fire-escape parts plus the structure/platform census. */
export interface FireEscapeResult {
  readonly parts: readonly PartDescriptor[];
  readonly escapes: number;
  readonly platforms: number;
}

/** Builds wrought-iron fire escapes on the street and side facades. */
export function buildFireEscapes(options: FireEscapeOptions): FireEscapeResult {
  const parts: PartDescriptor[] = [];
  const faces: readonly FacadeFace[] = [
    { origin: { x: 0, y: 0, z: options.depth / 2 }, ry: 0, span: options.width, columns: 1 },
    { origin: { x: options.width / 2, y: 0, z: 0 }, ry: Math.PI / 2, span: options.depth, columns: 1 },
  ];
  let platforms = 0;

  for (const face of faces) {
    const platformWidth = face.span * (0.38 + seedSample(options.seed, `escape-${face.ry}`) * 0.08);
    for (let row = 0; row < options.rows; row += 1) {
      const y = options.yBottom + (row + 0.82) * options.rowHeight;
      parts.push(box("metal", platformWidth, 0.14, 1.05, placeOnFace(face, 0, y, 0.58).position));
      parts.push(box("metal", platformWidth, 0.1, 0.1, placeOnFace(face, 0, y + 0.95, 1.02).position));
      parts.push(box("metal", 0.12, 1.05, 0.12, placeOnFace(face, -platformWidth / 2, y + 0.5, 1.02).position));
      parts.push(box("metal", 0.12, 1.05, 0.12, placeOnFace(face, platformWidth / 2, y + 0.5, 1.02).position));
      const stair = placeOnFace(face, 0, y + options.rowHeight * 0.5, 0.95);
      parts.push(box("metal", 0.86, options.rowHeight * 0.98, 0.16, stair.position, { x: -0.52, y: 0, z: 0 }));
      platforms += 1;
    }
  }

  return { parts, escapes: faces.length, platforms };
}

/* -------------------------------------------------------------------------- */
/* Rooftop equipment                                                          */
/* -------------------------------------------------------------------------- */

/** Where one rooftop structure sits on the roof deck. */
export interface RoofEquipmentPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly seed: number;
}

type RoofEquipmentBuilder = (placement: RoofEquipmentPlacement) => readonly PartDescriptor[];

function legs(x: number, y: number, z: number, spread: number, height: number): readonly PartDescriptor[] {
  return [
    box("metal", 0.16, height, 0.16, { x: x - spread, y: y + height / 2, z: z - spread }),
    box("metal", 0.16, height, 0.16, { x: x + spread, y: y + height / 2, z: z - spread }),
    box("metal", 0.16, height, 0.16, { x: x + spread, y: y + height / 2, z: z + spread }),
    box("metal", 0.16, height, 0.16, { x: x - spread, y: y + height / 2, z: z + spread }),
  ];
}

const ROOF_EQUIPMENT_BUILDERS: Readonly<Record<string, RoofEquipmentBuilder>> = {
  "water-tower": ({ x, y, z, scale }) => [
    ...legs(x, y, z, 0.55 * scale, 1.1 * scale),
    cylinder("metal", 0.85 * scale, 0.85 * scale, 1.5 * scale, { x, y: y + 1.1 * scale + 0.75 * scale, z }, NO_ROTATION, 10),
    cone("metal", 0.98 * scale, 0.7 * scale, { x, y: y + 1.1 * scale + 1.5 * scale + 0.35 * scale, z }, NO_ROTATION, 10),
    box("metal", 0.24, 1.2 * scale, 0.24, { x: x + 0.4 * scale, y: y + 1.6 * scale, z }),
  ],
  "brick-chimney": ({ x, y, z, scale }) => [
    box("wall", 0.8 * scale, 2.5 * scale, 0.8 * scale, { x, y: y + 1.25 * scale, z }),
    box("trim", 1.05 * scale, 0.22 * scale, 1.05 * scale, { x, y: y + 2.6 * scale, z }),
    box("metal", 0.26 * scale, 0.5 * scale, 0.26 * scale, { x: x - 0.2 * scale, y: y + 2.95 * scale, z }),
    box("metal", 0.26 * scale, 0.5 * scale, 0.26 * scale, { x: x + 0.2 * scale, y: y + 2.95 * scale, z }),
  ],
  "hvac-package-units": ({ x, y, z, scale }) => [
    box("metal", 1.5 * scale, 0.9 * scale, 1.1 * scale, { x, y: y + 0.45 * scale, z }),
    box("metal", 0.9 * scale, 0.7 * scale, 0.9 * scale, { x: x + 1.1 * scale, y: y + 0.35 * scale, z: z - 0.4 * scale }),
    cylinder("metal", 0.3 * scale, 0.3 * scale, 0.25 * scale, { x, y: y + 0.98 * scale, z }, NO_ROTATION, 8),
    cylinder("metal", 0.22 * scale, 0.22 * scale, 0.2 * scale, { x: x + 1.1 * scale, y: y + 0.78 * scale, z: z - 0.4 * scale }, NO_ROTATION, 8),
  ],
  "helipad-marker": ({ x, y, z, scale }) => [
    disc("roof", 1.5 * scale, { x, y: y + 0.02, z }, { x: -Math.PI / 2, y: 0, z: 0 }, 14),
    box("trim", 0.14 * scale, 0.1, 0.8 * scale, { x: x - 0.3 * scale, y: y + 0.06, z }),
    box("trim", 0.14 * scale, 0.1, 0.8 * scale, { x: x + 0.3 * scale, y: y + 0.06, z }),
    box("trim", 0.74 * scale, 0.1, 0.14 * scale, { x, y: y + 0.06, z }),
  ],
  "anodised-spandrel": ({ x, y, z, scale }) => [
    box("trim", 2.4 * scale, 0.36 * scale, 0.24, { x, y: y + 0.2 * scale, z }),
    box("trim", 2.4 * scale, 0.24 * scale, 0.24, { x, y: y + 0.72 * scale, z: z - 0.1 }),
    box("metal", 0.18, 0.9 * scale, 0.18, { x: x - 1.1 * scale, y: y + 0.45 * scale, z }),
    box("metal", 0.18, 0.9 * scale, 0.18, { x: x + 1.1 * scale, y: y + 0.45 * scale, z }),
  ],
  "roof-cafeteria-rail": ({ x, y, z, scale }) => {
    const parts: PartDescriptor[] = [
      box("metal", 2.6 * scale, 0.12, 0.12, { x, y: y + 1.05 * scale, z }),
      box("metal", 2.6 * scale, 0.1, 0.1, { x, y: y + 0.55 * scale, z }),
      box("trim", 0.9 * scale, 0.5 * scale, 0.9 * scale, { x, y: y + 0.25 * scale, z: z - 0.9 * scale }),
    ];
    for (let index = 0; index < 4; index += 1) {
      parts.push(
        box("metal", 0.1, 1.1 * scale, 0.1, { x: x - 1.3 * scale + index * (2.6 * scale) / 3, y: y + 0.55 * scale, z }),
      );
    }
    return parts;
  },
  "satellite-dish": ({ x, y, z, scale }) => [
    box("metal", 0.3, 1.1 * scale, 0.3, { x, y: y + 0.55 * scale, z }),
    disc("metal", 0.9 * scale, { x, y: y + 1.2 * scale, z }, { x: -0.9, y: 0, z: 0 }, 10),
    box("metal", 0.14, 0.4 * scale, 0.14, { x: x + 0.3 * scale, y: y + 1.4 * scale, z: z + 0.3 * scale }, { x: -0.6, y: 0, z: 0 }),
  ],
  "neon-crown-ring": ({ x, y, z, scale }) => [
    torus("signage", 1.35 * scale, 0.11 * scale, { x, y: y + 0.9 * scale, z }, { x: Math.PI / 2, y: 0, z: 0 }, 5, 16),
    ...legs(x, y, z, 1.35 * scale, 0.9 * scale),
  ],
  "cooling-towers": ({ x, y, z, scale }) => [
    box("metal", 1.4 * scale, 1.3 * scale, 1.2 * scale, { x: x - 0.9 * scale, y: y + 0.65 * scale, z }),
    box("metal", 1.4 * scale, 1.1 * scale, 1.2 * scale, { x: x + 0.9 * scale, y: y + 0.55 * scale, z }),
    cylinder("metal", 0.45 * scale, 0.45 * scale, 0.24 * scale, { x: x - 0.9 * scale, y: y + 1.4 * scale, z }, NO_ROTATION, 8),
    cylinder("metal", 0.4 * scale, 0.4 * scale, 0.22 * scale, { x: x + 0.9 * scale, y: y + 1.2 * scale, z }, NO_ROTATION, 8),
    box("metal", 0.22, 0.6 * scale, 0.22, { x, y: y + 0.3 * scale, z: z + 0.8 * scale }),
  ],
  "antenna-mast": ({ x, y, z, scale }) => [
    cylinder("metal", 0.09, 0.13, 3.6 * scale, { x, y: y + 1.8 * scale, z }, NO_ROTATION, 8),
    box("metal", 1.1 * scale, 0.1, 0.1, { x, y: y + 3.0 * scale, z }),
    box("metal", 0.8 * scale, 0.1, 0.1, { x, y: y + 2.4 * scale, z }),
    box("metal", 0.5 * scale, 0.1, 0.1, { x, y: y + 1.8 * scale, z }),
    cone("metal", 0.12, 0.4 * scale, { x, y: y + 3.75 * scale, z }, NO_ROTATION, 6),
  ],
  "green-roof-tray": ({ x, y, z, scale }) => [
    box("green", 2.2 * scale, 0.55 * scale, 1.1 * scale, { x, y: y + 0.28 * scale, z }),
    box("green", 1.9 * scale, 0.35 * scale, 0.9 * scale, { x, y: y + 0.72 * scale, z }),
    box("green", 1.0 * scale, 0.5 * scale, 1.0 * scale, { x: x + 1.5 * scale, y: y + 0.25 * scale, z: z + 0.9 * scale }),
    box("trim", 2.3 * scale, 0.14, 1.2 * scale, { x, y: y + 0.07, z }),
  ],
  "solar-hot-water": ({ x, y, z, scale }) => [
    box("metal", 1.7 * scale, 0.12, 1.1 * scale, { x, y: y + 0.75 * scale, z }, { x: -0.5, y: 0, z: 0 }),
    cylinder("metal", 0.4 * scale, 0.4 * scale, 1.4 * scale, { x, y: y + 1.35 * scale, z: z - 0.8 * scale }, { x: 0, y: 0, z: Math.PI / 2 }, 10),
    box("metal", 0.16, 0.8 * scale, 0.16, { x: x - 0.7 * scale, y: y + 0.4 * scale, z }),
    box("metal", 0.16, 0.8 * scale, 0.16, { x: x + 0.7 * scale, y: y + 0.4 * scale, z }),
  ],
  "telecom-array": ({ x, y, z, scale }) => [
    cylinder("metal", 0.12, 0.12, 3.0 * scale, { x, y: y + 1.5 * scale, z }, NO_ROTATION, 8),
    box("metal", 0.8 * scale, 1.3 * scale, 0.24, { x: x - 0.6 * scale, y: y + 2.0 * scale, z }, { x: 0, y: 0.5, z: 0 }),
    box("metal", 0.8 * scale, 1.3 * scale, 0.24, { x: x + 0.6 * scale, y: y + 2.0 * scale, z }, { x: 0, y: -0.5, z: 0 }),
    box("metal", 0.7 * scale, 1.0 * scale, 0.2, { x, y: y + 1.1 * scale, z }, { x: 0, y: Math.PI / 2, z: 0 }),
  ],
  "billboard-truss": ({ x, y, z, scale }) => [
    ...legs(x, y, z, 1.0 * scale, 1.4 * scale),
    box("metal", 2.6 * scale, 0.14, 0.14, { x, y: y + 1.4 * scale, z }),
    box("metal", 2.6 * scale, 0.14, 0.14, { x, y: y + 2.4 * scale, z }),
    box("metal", 0.14, 1.0 * scale, 0.14, { x: x - 1.2 * scale, y: y + 1.9 * scale, z }),
    box("metal", 0.14, 1.0 * scale, 0.14, { x: x + 1.2 * scale, y: y + 1.9 * scale, z }),
    box("metal", 1.4 * scale, 0.14, 0.14, { x, y: y + 1.9 * scale, z }, { x: 0, y: 0, z: 0.7 }),
  ],
  "solar-canopy": ({ x, y, z, scale }) => {
    const parts: PartDescriptor[] = [
      ...legs(x, y, z, 1.5 * scale, 2.1 * scale),
      box("metal", 3.4 * scale, 0.16, 0.18, { x, y: y + 2.2 * scale, z: z - 0.7 * scale }),
      box("metal", 3.4 * scale, 0.16, 0.18, { x, y: y + 2.2 * scale, z: z + 0.7 * scale }),
    ];
    for (let index = 0; index < 3; index += 1) {
      parts.push(
        box("glazing", 1.0 * scale, 0.1, 1.7 * scale, { x: x - 1.05 * scale + index * 1.05 * scale, y: y + 2.4 * scale, z }, { x: -0.24, y: 0, z: 0 }),
      );
    }
    return parts;
  },
  "wind-cowl": ({ x, y, z, scale }) => [
    cylinder("metal", 0.55 * scale, 0.55 * scale, 1.4 * scale, { x, y: y + 0.7 * scale, z }, NO_ROTATION, 10),
    cone("metal", 0.7 * scale, 0.6 * scale, { x, y: y + 1.7 * scale, z }, NO_ROTATION, 10),
    box("metal", 0.16, 1.4 * scale, 0.9 * scale, { x: x + 0.5 * scale, y: y + 0.8 * scale, z }, { x: 0, y: 0.4, z: 0 }),
    box("trim", 1.1 * scale, 0.16, 1.1 * scale, { x, y: y + 0.08, z }),
  ],
  "roof-garden-rail": ({ x, y, z, scale }) => {
    const parts: PartDescriptor[] = [
      box("green", 2.4 * scale, 0.6 * scale, 1.0 * scale, { x, y: y + 0.3 * scale, z }),
      box("green", 1.1 * scale, 0.5 * scale, 1.0 * scale, { x: x + 1.6 * scale, y: y + 0.25 * scale, z: z + 0.5 * scale }),
      box("metal", 2.6 * scale, 0.1, 0.1, { x, y: y + 1.15 * scale, z: z - 0.5 * scale }),
    ];
    for (let index = 0; index < 4; index += 1) {
      parts.push(box("metal", 0.1, 1.1 * scale, 0.1, { x: x - 1.2 * scale + index * (2.4 * scale) / 3, y: y + 0.55 * scale, z: z - 0.5 * scale }));
    }
    return parts;
  },
  "drone-pad": ({ x, y, z, scale }) => [
    disc("roof", 1.3 * scale, { x, y: y + 0.03, z }, { x: -Math.PI / 2, y: 0, z: 0 }, 14),
    torus("signage", 1.3 * scale, 0.07 * scale, { x, y: y + 0.08, z }, { x: Math.PI / 2, y: 0, z: 0 }, 4, 14),
    box("trim", 0.5 * scale, 0.08, 0.14, { x, y: y + 0.1, z: z - 0.5 * scale }),
    box("trim", 0.5 * scale, 0.08, 0.14, { x, y: y + 0.1, z: z + 0.5 * scale }),
    box("trim", 0.14, 0.08, 0.5 * scale, { x: x - 0.5 * scale, y: y + 0.1, z }),
    box("trim", 0.14, 0.08, 0.5 * scale, { x: x + 0.5 * scale, y: y + 0.1, z }),
  ],
};

/** Fallback structure for a rooftop detail this library does not know yet. */
function buildGenericMechanical(placement: RoofEquipmentPlacement): readonly PartDescriptor[] {
  const { x, y, z, scale } = placement;
  return [
    box("metal", 1.3 * scale, 0.9 * scale, 1.1 * scale, { x, y: y + 0.45 * scale, z }),
    cylinder("metal", 0.28 * scale, 0.28 * scale, 0.4 * scale, { x: x + 0.5 * scale, y: y + 1.1 * scale, z }, NO_ROTATION, 8),
    box("trim", 0.3, 0.4 * scale, 0.3, { x: x - 0.6 * scale, y: y + 0.2 * scale, z: z + 0.5 * scale }),
  ];
}

/** Every rooftop structure kind this library can build. */
export const ROOF_EQUIPMENT_KINDS: readonly string[] = Object.keys(ROOF_EQUIPMENT_BUILDERS);

/** Builds one rooftop structure, falling back to generic mechanical plant. */
export function buildRoofEquipment(kind: string, placement: RoofEquipmentPlacement): readonly PartDescriptor[] {
  const builder = ROOF_EQUIPMENT_BUILDERS[kind] ?? buildGenericMechanical;
  return builder(placement);
}

/** Inputs of the rooftop equipment layout. */
export interface RoofEquipmentOptions {
  readonly kinds: readonly string[];
  readonly roofWidth: number;
  readonly roofDepth: number;
  readonly y: number;
  readonly seed: number;
}

/** Rooftop equipment parts plus the kinds actually placed. */
export interface RoofEquipmentResult {
  readonly parts: readonly PartDescriptor[];
  readonly kinds: readonly string[];
}

/** Lays the era's rooftop structures out over the roof deck. */
export function buildRoofEquipmentGroup(options: RoofEquipmentOptions): RoofEquipmentResult {
  const kinds = options.kinds.slice(0, 6);
  const parts: PartDescriptor[] = [];
  const scale = clamp(Math.min(options.roofWidth, options.roofDepth) / 5.5, 0.45, 1.4);
  const rows = Math.max(1, Math.ceil(kinds.length / 2));

  kinds.forEach((kind, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = (column === 0 ? -1 : 1) * options.roofWidth * 0.22
      + (seedSample(options.seed, `roof-x-${index}`) - 0.5) * options.roofWidth * 0.08;
    const z = ((row + 0.5) / rows - 0.5) * options.roofDepth * 0.72
      + (seedSample(options.seed, `roof-z-${index}`) - 0.5) * options.roofDepth * 0.06;
    parts.push(...buildRoofEquipment(kind, { x, y: options.y, z, scale, seed: options.seed + index * 17 }));
  });

  return { parts, kinds };
}

/* -------------------------------------------------------------------------- */
/* Rooftop advertising                                                        */
/* -------------------------------------------------------------------------- */

/** Mounting anchor of a rooftop advertising structure (building-local space). */
export interface SignageAnchor {
  readonly id: string;
  readonly kind: "rooftop-mount" | "parapet-guy" | "facade-mount";
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly size: { readonly width: number; readonly height: number };
}

/** Inputs of the rooftop advertising structure generator. */
export interface RooftopSignOptions {
  readonly structure: RooftopSignStructure;
  readonly roofWidth: number;
  readonly roofDepth: number;
  readonly y: number;
  readonly seed: number;
}

/** Rooftop advertising parts, its panel size and its mounting anchors. */
export interface RooftopSignResult {
  readonly parts: readonly PartDescriptor[];
  readonly anchors: readonly SignageAnchor[];
  readonly panelWidth: number;
  readonly panelHeight: number;
}

function mountAnchors(
  structure: RooftopSignStructure,
  panelWidth: number,
  y: number,
  z: number,
  parapetZ: number,
): readonly SignageAnchor[] {
  const half = panelWidth / 2;
  return [
    {
      id: `${structure}-mount-port`,
      kind: "rooftop-mount",
      position: { x: -half, y, z },
      rotation: { x: 0, y: 0, z: 0 },
      size: { width: 0.24, height: 0.24 },
    },
    {
      id: `${structure}-mount-starboard`,
      kind: "rooftop-mount",
      position: { x: half, y, z },
      rotation: { x: 0, y: 0, z: 0 },
      size: { width: 0.24, height: 0.24 },
    },
    {
      id: `${structure}-guy-port`,
      kind: "parapet-guy",
      position: { x: -half, y, z: parapetZ },
      rotation: { x: 0, y: 0, z: 0 },
      size: { width: 0.16, height: 0.16 },
    },
    {
      id: `${structure}-guy-starboard`,
      kind: "parapet-guy",
      position: { x: half, y, z: parapetZ },
      rotation: { x: 0, y: 0, z: 0 },
      size: { width: 0.16, height: 0.16 },
    },
  ];
}

/** Builds the era's rooftop advertising structure and its mounting anchors. */
export function buildRooftopSign(options: RooftopSignOptions): RooftopSignResult {
  const { structure } = options;
  const parts: PartDescriptor[] = [];
  const boardZ = options.roofDepth * (0.26 + seedSample(options.seed, "sign-board") * 0.08);
  const parapetZ = options.roofDepth / 2;
  if (structure === "none") {
    return { parts, anchors: [], panelWidth: 0, panelHeight: 0 };
  }

  switch (structure) {
    case "painted-roof-sign": {
      const panelWidth = options.roofWidth * 0.82;
      const panelHeight = clamp(options.roofWidth * 0.26, 0.8, 1.5);
      parts.push(box("metal", 0.2, 1.3, 0.2, { x: -panelWidth * 0.34, y: options.y + 0.65, z: boardZ }));
      parts.push(box("metal", 0.2, 1.3, 0.2, { x: panelWidth * 0.34, y: options.y + 0.65, z: boardZ }));
      parts.push(box("signage", panelWidth, panelHeight, 0.16, { x: 0, y: options.y + 1.3 + panelHeight / 2, z: boardZ }));
      parts.push(box("trim", panelWidth + 0.16, 0.14, 0.22, { x: 0, y: options.y + 1.3 + panelHeight, z: boardZ }));
      return {
        parts,
        anchors: mountAnchors(structure, panelWidth, options.y, boardZ, parapetZ),
        panelWidth,
        panelHeight,
      };
    }
    case "neon-rooftop-sign": {
      const panelWidth = options.roofWidth * 0.88;
      const panelHeight = clamp(options.roofWidth * 0.3, 0.9, 1.8);
      const centreY = options.y + 1.6 + panelHeight / 2;
      parts.push(box("metal", 0.22, 1.7, 0.22, { x: -panelWidth * 0.38, y: options.y + 0.85, z: boardZ }));
      parts.push(box("metal", 0.22, 1.7, 0.22, { x: panelWidth * 0.38, y: options.y + 0.85, z: boardZ }));
      parts.push(box("signage", panelWidth, panelHeight, 0.18, { x: 0, y: centreY, z: boardZ }));
      parts.push(box("signage", panelWidth + 0.24, 0.12, 0.12, { x: 0, y: centreY + panelHeight / 2 + 0.1, z: boardZ + 0.14 }));
      parts.push(box("signage", panelWidth + 0.24, 0.12, 0.12, { x: 0, y: centreY - panelHeight / 2 - 0.1, z: boardZ + 0.14 }));
      parts.push(box("signage", 0.12, panelHeight + 0.3, 0.12, { x: -panelWidth / 2 - 0.12, y: centreY, z: boardZ + 0.14 }));
      parts.push(box("signage", 0.12, panelHeight + 0.3, 0.12, { x: panelWidth / 2 + 0.12, y: centreY, z: boardZ + 0.14 }));
      return {
        parts,
        anchors: mountAnchors(structure, panelWidth, options.y, boardZ, parapetZ),
        panelWidth,
        panelHeight,
      };
    }
    case "neon-rooftop-billboard": {
      const panelWidth = options.roofWidth * 0.95;
      const panelHeight = clamp(options.roofWidth * 0.42, 1.3, 2.6);
      const centreY = options.y + 1.9 + panelHeight / 2;
      parts.push(...legs(0, options.y, boardZ, panelWidth * 0.34, 1.9));
      parts.push(box("signage", panelWidth, panelHeight, 0.2, { x: 0, y: centreY, z: boardZ }));
      parts.push(box("signage", panelWidth + 0.3, 0.14, 0.14, { x: 0, y: centreY + panelHeight / 2 + 0.12, z: boardZ + 0.16 }));
      parts.push(box("signage", panelWidth + 0.3, 0.14, 0.14, { x: 0, y: centreY - panelHeight / 2 - 0.12, z: boardZ + 0.16 }));
      parts.push(box("metal", panelWidth + 0.2, 0.16, 0.5, { x: 0, y: centreY - panelHeight / 2 - 0.3, z: boardZ + 0.3 }));
      parts.push(box("metal", 0.18, 0.5, 0.18, { x: -panelWidth * 0.3, y: centreY + panelHeight / 2 + 0.5, z: boardZ - 0.3 }, { x: 0.5, y: 0, z: 0 }));
      parts.push(box("metal", 0.18, 0.5, 0.18, { x: panelWidth * 0.3, y: centreY + panelHeight / 2 + 0.5, z: boardZ - 0.3 }, { x: 0.5, y: 0, z: 0 }));
      return {
        parts,
        anchors: mountAnchors(structure, panelWidth, options.y, boardZ, parapetZ),
        panelWidth,
        panelHeight,
      };
    }
    case "digital-rooftop-panel": {
      const panelWidth = options.roofWidth * 0.9;
      const panelHeight = clamp(options.roofWidth * 0.34, 1.1, 2.1);
      const centreY = options.y + 1.75 + panelHeight / 2;
      parts.push(box("metal", 0.24, 1.85, 0.24, { x: -panelWidth * 0.36, y: options.y + 0.92, z: boardZ }));
      parts.push(box("metal", 0.24, 1.85, 0.24, { x: panelWidth * 0.36, y: options.y + 0.92, z: boardZ }));
      parts.push(box("metal", panelWidth + 0.3, 0.22, 0.24, { x: 0, y: centreY + panelHeight / 2 + 0.11, z: boardZ }));
      parts.push(box("metal", panelWidth + 0.3, 0.22, 0.24, { x: 0, y: centreY - panelHeight / 2 - 0.11, z: boardZ }));
      parts.push(box("media", panelWidth, panelHeight, 0.16, { x: 0, y: centreY, z: boardZ + 0.08 }));
      return {
        parts,
        anchors: mountAnchors(structure, panelWidth, options.y, boardZ, parapetZ),
        panelWidth,
        panelHeight,
      };
    }
    case "media-facade": {
      const panelWidth = options.roofWidth * 0.94;
      const panelHeight = clamp(options.roofWidth * 0.5, 1.6, 3);
      const centreY = options.y + 2.4 + panelHeight / 2;
      parts.push(cylinder("metal", 0.16, 0.22, 2.4, { x: 0, y: options.y + 1.2, z: boardZ }, NO_ROTATION, 8));
      parts.push(box("metal", 0.18, 2.4, 0.18, { x: -panelWidth * 0.3, y: options.y + 1.2, z: boardZ }));
      parts.push(box("metal", 0.18, 2.4, 0.18, { x: panelWidth * 0.3, y: options.y + 1.2, z: boardZ }));
      parts.push(box("metal", panelWidth + 0.34, 0.26, 0.3, { x: 0, y: centreY + panelHeight / 2 + 0.13, z: boardZ }));
      parts.push(box("media", panelWidth, panelHeight, 0.2, { x: 0, y: centreY, z: boardZ + 0.1 }));
      parts.push(box("signage", panelWidth * 0.5, 0.5, 0.24, { x: 0, y: options.y + 2.1, z: boardZ + 0.16 }));
      return {
        parts,
        anchors: mountAnchors(structure, panelWidth, options.y, boardZ, parapetZ),
        panelWidth,
        panelHeight,
      };
    }
  }
}

/** Inputs of the facade media-advertising generator. */
export interface MediaFacadeOptions {
  readonly panels: number;
  readonly width: number;
  readonly depth: number;
  readonly rows: number;
  readonly yBottom: number;
  readonly rowHeight: number;
  readonly seed: number;
}

/** Media facade parts plus the panel census and anchors. */
export interface MediaFacadeResult {
  readonly parts: readonly PartDescriptor[];
  readonly panels: number;
  readonly anchors: readonly SignageAnchor[];
}

/** Storeys between two media panels let into the facade. */
const MEDIA_PANEL_STRIDE = 3;

/** Builds the illuminated advertising panels let into the street facade. */
export function buildMediaFacade(options: MediaFacadeOptions): MediaFacadeResult {
  const parts: PartDescriptor[] = [];
  const anchors: SignageAnchor[] = [];
  const available = Math.max(1, Math.floor(Math.max(0, options.rows - 1) / MEDIA_PANEL_STRIDE) + 1);
  const count = clamp(Math.round(options.panels), 0, available);
  if (count <= 0) {
    return { parts, panels: 0, anchors };
  }

  const front: FacadeFace = { origin: { x: 0, y: 0, z: options.depth / 2 }, ry: 0, span: options.width, columns: 1 };
  const panelWidth = options.width * 0.78;
  const panelHeight = Math.min(options.rowHeight * (2.2 + seedSample(options.seed, "media-panel") * 0.4), 6);

  for (let index = 0; index < count; index += 1) {
    const row = 1 + index * MEDIA_PANEL_STRIDE;
    const centre = options.yBottom + (row + 1) * options.rowHeight;
    const panel = placeOnFace(front, 0, centre, 0.1);
    parts.push(plane("media", panelWidth, panelHeight, panel.position, panel.rotation));
    parts.push(box("trim", panelWidth + 0.3, panelHeight + 0.3, 0.16, placeOnFace(front, 0, centre, 0.02).position));
    anchors.push({
      id: `media-panel-${index + 1}`,
      kind: "facade-mount",
      position: { x: 0, y: centre, z: options.depth / 2 + 0.1 },
      rotation: { x: 0, y: 0, z: 0 },
      size: { width: panelWidth, height: panelHeight },
    });
  }

  return { parts, panels: count, anchors };
}

/* -------------------------------------------------------------------------- */
/* Procedural textures                                                        */
/* -------------------------------------------------------------------------- */

/** Texture set one era's materials are drawn with. */
export interface EraTextureSet {
  readonly facade: THREE.Texture;
  readonly roof: THREE.Texture;
  readonly window: THREE.Texture;
  readonly storefront: THREE.Texture;
  readonly signage: THREE.Texture;
  readonly media: THREE.Texture;
}

/** Canvas plus 2D context a painter draws into. */
export interface PaintingSurface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
}

/** Pluggable canvas source; tests inject a stub so painters stay covered. */
export type CanvasFactory = (size: number) => PaintingSurface | null;

/** Texture-generation options; the default factory paints into a real canvas. */
export interface TextureOptions {
  readonly canvasFactory?: CanvasFactory;
}

const TEXTURE_SIZE = 256;
const textureCache = new Map<EraId, EraTextureSet>();
let canvas2dSupport: boolean | null = null;

function defaultCanvasFactory(size: number): PaintingSurface | null {
  if (typeof document === "undefined" || typeof navigator === "undefined") {
    return null;
  }
  if (canvas2dSupport === null) {
    // jsdom ships a stub 2D context that only logs "not implemented"; skip it
    // and let the deterministic data-texture fallback cover unit tests.
    canvas2dSupport = !/jsdom/i.test(navigator.userAgent)
      && typeof document.createElement("canvas").getContext === "function";
  }
  if (!canvas2dSupport) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

/** Drops the cached textures for `eraId`, releasing GPU memory. */
export function disposeEraTextures(eraId: EraId): void {
  const cached = textureCache.get(eraId);
  if (!cached) {
    return;
  }
  for (const texture of Object.values(cached)) {
    texture.dispose();
  }
  textureCache.delete(eraId);
}

/** Clears the whole era texture cache. */
export function clearEraTextureCache(): void {
  for (const eraId of [...textureCache.keys()]) {
    disposeEraTextures(eraId);
  }
}

/**
 * Builds (or returns the cached) procedural texture set for an era.
 *
 * Caching only happens for the default canvas factory: a caller injecting its
 * own factory always gets freshly painted textures.
 */
export function createEraTextures(era: EraConfig, options: TextureOptions = {}): EraTextureSet {
  const factory = options.canvasFactory ?? defaultCanvasFactory;
  if (!options.canvasFactory) {
    const cached = textureCache.get(era.id);
    if (cached) {
      return cached;
    }
  }

  const descriptor = era.buildings;
  const palette = era.palette;
  const structures = advertisingStructuresFor(era);
  const primary = materialForRole(descriptor, "primary", palette.facadePrimary);
  const trim = materialForRole(descriptor, "trim", palette.facadeSecondary);
  const glazing = materialForRole(descriptor, "glazing", palette.facadeSecondary);
  const pattern = facadePatternFor(descriptor.style);

  const set: EraTextureSet = {
    facade: paintTexture(
      factory,
      primary.color,
      hashUnit(`${era.id}:facade`),
      (ctx, size, random) => paintFacade(ctx, size, random, pattern, {
        base: primary.color,
        joint: trim.color,
        accent: palette.accent,
      }),
    ),
    roof: paintTexture(factory, palette.sidewalk, hashUnit(`${era.id}:roof`), (ctx, size, random) =>
      paintRoof(ctx, size, random, palette.sidewalk, palette.asphalt),
    ),
    window: paintTexture(factory, glazing.color, hashUnit(`${era.id}:window`), (ctx, size, random) =>
      paintWindow(ctx, size, random, {
        glass: glazing.color,
        glow: palette.windowGlow,
        frame: trim.color,
        recessed: descriptor.window.recessed,
      }),
    ),
    storefront: paintTexture(factory, palette.windowGlow, hashUnit(`${era.id}:storefront`), (ctx, size, random) =>
      paintStorefront(ctx, size, random, {
        glow: palette.windowGlow,
        frame: trim.color,
        accent: palette.accent,
        awning: era.storefronts.awning,
      }),
    ),
    signage: paintTexture(factory, palette.accent, hashUnit(`${era.id}:signage`), (ctx, size, random) =>
      paintSignage(ctx, size, random, structures.signage, {
        board: mixColors(palette.facadeSecondary, 0x101014, 0.55),
        ink: palette.accent,
        glow: palette.windowGlow,
        base: palette.facadePrimary,
      }),
    ),
    media: paintTexture(factory, palette.accent, hashUnit(`${era.id}:media`), (ctx, size, random) =>
      paintMedia(ctx, size, random, palette.accent, palette.windowGlow),
    ),
  };

  if (!options.canvasFactory) {
    textureCache.set(era.id, set);
  }
  return set;
}

function paintTexture(
  factory: CanvasFactory,
  baseColor: number,
  seed: number,
  paint: (ctx: CanvasRenderingContext2D, size: number, random: () => number) => void,
): THREE.Texture {
  const surface = factory(TEXTURE_SIZE);
  if (!surface) {
    return createFallbackTexture(TEXTURE_SIZE, baseColor, seed);
  }
  const random = mulberry32(seed);
  surface.ctx.fillStyle = cssColor(baseColor);
  surface.ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  paint(surface.ctx, TEXTURE_SIZE, random);
  const texture = new THREE.CanvasTexture(surface.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Deterministic stand-in used when no 2D canvas is available (tests, node). */
function createFallbackTexture(size: number, baseColor: number, seed: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const random = mulberry32(seed);
  const [r, g, b] = toRgb(baseColor);
  for (let index = 0; index < size * size; index += 1) {
    const x = index % size;
    const y = Math.floor(index / size);
    const grid = (x % 16 === 0 || y % 16 === 0) ? 0.86 : 1;
    const jitter = 0.94 + random() * 0.12;
    data[index * 4] = clamp(Math.round(r * grid * jitter), 0, 255);
    data[index * 4 + 1] = clamp(Math.round(g * grid * jitter), 0, 255);
    data[index * 4 + 2] = clamp(Math.round(b * grid * jitter), 0, 255);
    data[index * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Wall pattern family an architecture style is painted with. */
export type FacadePattern = "brick" | "brick-loft" | "ashlar" | "concrete" | "curtain" | "mirror" | "timber";

/** Maps an architecture style onto its wall pattern. */
export function facadePatternFor(style: ArchitectureStyle): FacadePattern {
  switch (style) {
    case "postwar-brick-masonry":
      return "brick";
    case "art-deco-limestone":
      return "ashlar";
    case "midcentury-curtain-wall":
      return "curtain";
    case "precast-concrete-slab":
      return "concrete";
    case "mirror-glass-tower":
      return "mirror";
    case "postmodern-trim-stone":
      return "ashlar";
    case "blue-glass-office":
      return "curtain";
    case "brick-loft-revival":
      return "brick-loft";
    case "mass-timber-hybrid":
      return "timber";
    case "adaptive-reuse-brick":
      return "brick";
  }
}

interface FacadePaintColors {
  readonly base: number;
  readonly joint: number;
  readonly accent: number;
}

function paintFacade(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  pattern: FacadePattern,
  colors: FacadePaintColors,
): void {
  switch (pattern) {
    case "brick":
      paintBrickCourses(ctx, size, random, colors.base, colors.joint, 14, 6);
      break;
    case "brick-loft":
      paintBrickCourses(ctx, size, random, colors.base, colors.joint, 10, 4);
      paintBand(ctx, size, colors.joint, 0.28, 0.16);
      break;
    case "ashlar":
      paintPanels(ctx, size, random, colors.base, colors.joint, 4, 6, 0.1);
      break;
    case "concrete":
      paintPanels(ctx, size, random, colors.base, colors.joint, 3, 3, 0.16);
      break;
    case "curtain":
      paintCurtainWall(ctx, size, random, colors.base, colors.joint, colors.accent);
      break;
    case "mirror":
      paintMirrorWall(ctx, size, random, colors.base, colors.joint);
      break;
    case "timber":
      paintTimberSlats(ctx, size, random, colors.base, colors.joint);
      break;
  }
}

function paintBrickCourses(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  brick: number,
  mortar: number,
  rows: number,
  columns: number,
): void {
  const brickHeight = size / rows;
  const brickWidth = size / columns;
  ctx.fillStyle = cssColor(mortar);
  ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < rows; row += 1) {
    const offset = row % 2 === 0 ? 0 : -brickWidth / 2;
    for (let column = -1; column <= columns; column += 1) {
      const x = column * brickWidth + offset;
      const y = row * brickHeight;
      ctx.fillStyle = cssColor(shade(brick, 0.86 + random() * 0.28));
      ctx.fillRect(x + 1, y + 1, brickWidth - 2, brickHeight - 2);
    }
  }
  for (let index = 0; index < 5; index += 1) {
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = cssColor(shade(brick, 0.62));
    ctx.fillRect(random() * size, random() * size, size * (0.15 + random() * 0.3), size * (0.05 + random() * 0.16));
  }
  ctx.globalAlpha = 1;
}

function paintPanels(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  base: number,
  joint: number,
  columns: number,
  rows: number,
  speckle: number,
): void {
  const panelWidth = size / columns;
  const panelHeight = size / rows;
  ctx.fillStyle = cssColor(joint);
  ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      ctx.fillStyle = cssColor(shade(base, 0.92 + random() * 0.16));
      ctx.fillRect(column * panelWidth + 1.5, row * panelHeight + 1.5, panelWidth - 3, panelHeight - 3);
    }
  }
  for (let index = 0; index < 90; index += 1) {
    ctx.globalAlpha = speckle;
    ctx.fillStyle = cssColor(shade(base, random() > 0.5 ? 1.2 : 0.75));
    ctx.fillRect(random() * size, random() * size, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function paintCurtainWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  glass: number,
  frame: number,
  accent: number,
): void {
  const bays = 8;
  const bayWidth = size / bays;
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, cssColor(shade(glass, 1.35)));
  gradient.addColorStop(0.5, cssColor(glass));
  gradient.addColorStop(1, cssColor(shade(glass, 0.72)));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = cssColor(frame);
  for (let bay = 0; bay < bays; bay += 1) {
    ctx.fillRect(bay * bayWidth, 0, 2.5, size);
  }
  ctx.fillRect(0, size * 0.46, size, size * 0.05);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = cssColor(accent);
  ctx.fillRect(0, size * 0.46, size, size * 0.02);
  ctx.globalAlpha = 1;
  for (let index = 0; index < 8; index += 1) {
    ctx.globalAlpha = 0.14 + random() * 0.16;
    ctx.fillStyle = cssColor(shade(glass, 1.6));
    ctx.fillRect(random() * size, random() * size * 0.5, bayWidth * 0.8, size * 0.3);
  }
  ctx.globalAlpha = 1;
}

function paintMirrorWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  glass: number,
  mullion: number,
): void {
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, cssColor(shade(glass, 1.5)));
  gradient.addColorStop(0.45, cssColor(glass));
  gradient.addColorStop(1, cssColor(shade(glass, 0.6)));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = cssColor(mullion);
  for (let index = 0; index <= 4; index += 1) {
    ctx.fillRect(index * (size / 4), 0, 3, size);
    ctx.fillRect(0, index * (size / 4), size, 3);
  }
  for (let index = 0; index < 6; index += 1) {
    ctx.globalAlpha = 0.2 + random() * 0.2;
    ctx.fillStyle = cssColor(shade(glass, 1.7));
    ctx.fillRect(random() * size, random() * size * 0.4, size * 0.22, size * 0.4);
  }
  ctx.globalAlpha = 1;
}

function paintTimberSlats(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  timber: number,
  gap: number,
): void {
  const slats = 12;
  const slatWidth = size / slats;
  ctx.fillStyle = cssColor(shade(timber, 0.7));
  ctx.fillRect(0, 0, size, size);
  for (let slat = 0; slat < slats; slat += 1) {
    ctx.fillStyle = cssColor(shade(timber, 0.9 + random() * 0.24));
    ctx.fillRect(slat * slatWidth + 1, 0, slatWidth - 2, size);
    ctx.strokeStyle = cssColor(shade(timber, 0.78));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(slat * slatWidth + slatWidth / 2, 0);
    ctx.lineTo(slat * slatWidth + slatWidth / 2, size);
    ctx.stroke();
  }
  paintBand(ctx, size, gap, 0.5, 0.08);
}

function paintBand(ctx: CanvasRenderingContext2D, size: number, color: number, at: number, height: number): void {
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = cssColor(color);
  ctx.fillRect(0, size * at, size, size * height);
  ctx.globalAlpha = 1;
}

interface WindowPaintColors {
  readonly glass: number;
  readonly glow: number;
  readonly frame: number;
  readonly recessed: boolean;
}

function paintWindow(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  colors: WindowPaintColors,
): void {
  ctx.fillStyle = cssColor(shade(colors.frame, 0.8));
  ctx.fillRect(0, 0, size, size);
  const inset = size * (colors.recessed ? 0.14 : 0.08);
  const inner = size - inset * 2;
  const gradient = ctx.createLinearGradient(0, inset, 0, size - inset);
  gradient.addColorStop(0, cssColor(shade(colors.glass, 1.3)));
  gradient.addColorStop(0.6, cssColor(colors.glass));
  gradient.addColorStop(1, cssColor(shade(colors.glass, 0.66)));
  ctx.fillStyle = gradient;
  ctx.fillRect(inset, inset, inner, inner);

  const lit = 7 + Math.round(random() * 5);
  for (let index = 0; index < lit; index += 1) {
    ctx.globalAlpha = 0.3 + random() * 0.55;
    ctx.fillStyle = cssColor(index % 2 === 0 ? colors.glow : shade(colors.glow, 0.8));
    ctx.fillRect(inset + random() * inner * 0.78, inset + random() * inner * 0.78, inner * 0.16, inner * 0.16);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = cssColor(colors.frame);
  ctx.lineWidth = Math.max(2, size * 0.035);
  ctx.beginPath();
  ctx.moveTo(size / 2, inset);
  ctx.lineTo(size / 2, size - inset);
  ctx.moveTo(inset, size * 0.5);
  ctx.lineTo(size - inset, size * 0.5);
  ctx.stroke();
}

interface StorefrontPaintColors {
  readonly glow: number;
  readonly frame: number;
  readonly accent: number;
  readonly awning: boolean;
}

function paintStorefront(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  colors: StorefrontPaintColors,
): void {
  ctx.fillStyle = cssColor(shade(colors.frame, 0.55));
  ctx.fillRect(0, 0, size, size);
  const bandTop = size * 0.18;
  const bandHeight = size * 0.72;
  const gradient = ctx.createLinearGradient(0, bandTop, 0, bandTop + bandHeight);
  gradient.addColorStop(0, cssColor(shade(colors.glow, 1.1)));
  gradient.addColorStop(1, cssColor(shade(colors.glow, 0.45)));
  ctx.fillStyle = gradient;
  ctx.fillRect(size * 0.05, bandTop, size * 0.9, bandHeight);

  for (let index = 0; index < 5; index += 1) {
    ctx.globalAlpha = 0.35 + random() * 0.4;
    ctx.fillStyle = cssColor(shade(colors.frame, 0.5));
    ctx.fillRect(size * (0.08 + index * 0.18), bandTop + bandHeight * (0.25 + random() * 0.3), size * 0.09, bandHeight * 0.45);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = cssColor(colors.accent);
  ctx.fillRect(size * 0.04, size * 0.04, size * 0.92, size * 0.12);
  ctx.fillStyle = cssColor(shade(colors.frame, 0.35));
  for (let index = 0; index < 4; index += 1) {
    ctx.fillRect(size * (0.1 + index * 0.22), size * 0.06, size * 0.12, size * 0.07);
  }
  if (colors.awning) {
    ctx.fillStyle = cssColor(colors.accent);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 0, size, size * 0.04);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = cssColor(shade(colors.frame, 0.4));
  ctx.fillRect(size * 0.46, bandTop, size * 0.03, bandHeight);
}

interface SignagePaintColors {
  readonly board: number;
  readonly ink: number;
  readonly glow: number;
  readonly base: number;
}

function paintSignage(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  structure: RooftopSignStructure,
  colors: SignagePaintColors,
): void {
  const board = structure === "painted-roof-sign" ? colors.base : colors.board;
  ctx.fillStyle = cssColor(board);
  ctx.fillRect(0, 0, size, size);

  if (structure === "painted-roof-sign") {
    ctx.fillStyle = cssColor(shade(colors.ink, 0.8));
    for (let index = 0; index < 4; index += 1) {
      ctx.fillRect(size * (0.08 + index * 0.22), size * 0.3, size * 0.14, size * 0.34);
    }
    ctx.fillStyle = cssColor(shade(colors.ink, 0.6));
    ctx.fillRect(size * 0.08, size * 0.72, size * 0.84, size * 0.06);
    return;
  }

  if (structure === "digital-rooftop-panel" || structure === "media-facade") {
    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 10; column += 1) {
        ctx.globalAlpha = 0.3 + random() * 0.7;
        ctx.fillStyle = cssColor(random() > 0.5 ? colors.glow : colors.ink);
        ctx.fillRect(size * (0.04 + column * 0.094), size * (0.1 + row * 0.13), size * 0.07, size * 0.09);
      }
    }
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000000";
    for (let line = 0; line < 24; line += 1) {
      ctx.fillRect(0, (line * size) / 24, size, 1.4);
    }
    ctx.globalAlpha = 1;
    return;
  }

  // Neon structures: dark board, bright tube border, glowing letters.
  ctx.fillStyle = cssColor(shade(colors.board, 0.6));
  ctx.fillRect(size * 0.04, size * 0.1, size * 0.92, size * 0.8);
  ctx.strokeStyle = cssColor(colors.ink);
  ctx.lineWidth = Math.max(3, size * 0.03);
  ctx.beginPath();
  ctx.moveTo(size * 0.08, size * 0.16);
  ctx.lineTo(size * 0.92, size * 0.16);
  ctx.lineTo(size * 0.92, size * 0.84);
  ctx.lineTo(size * 0.08, size * 0.84);
  ctx.lineTo(size * 0.08, size * 0.16);
  ctx.stroke();
  for (let index = 0; index < 5; index += 1) {
    ctx.globalAlpha = 0.6 + random() * 0.4;
    ctx.fillStyle = cssColor(index % 2 === 0 ? colors.glow : colors.ink);
    ctx.fillRect(size * (0.12 + index * 0.16), size * (0.36 + random() * 0.08), size * 0.1, size * 0.26);
  }
  ctx.globalAlpha = 1;
}

function paintMedia(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  accent: number,
  glow: number,
): void {
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, cssColor(shade(accent, 0.5)));
  gradient.addColorStop(0.5, cssColor(shade(glow, 0.7)));
  gradient.addColorStop(1, cssColor(shade(accent, 0.9)));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 12; column += 1) {
      ctx.globalAlpha = 0.25 + random() * 0.6;
      ctx.fillStyle = cssColor(random() > 0.45 ? glow : shade(accent, 1.4));
      ctx.fillRect(size * (0.03 + column * 0.08), size * (0.06 + row * 0.11), size * 0.055, size * 0.08);
    }
  }
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#0b0b12";
  for (let line = 0; line < 32; line += 1) {
    ctx.fillRect(0, (line * size) / 32, size, 1.2);
  }
  ctx.globalAlpha = 1;
}

function paintRoof(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  gravel: number,
  asphalt: number,
): void {
  ctx.fillStyle = cssColor(asphalt);
  ctx.fillRect(0, 0, size, size);
  for (let index = 0; index < 420; index += 1) {
    ctx.globalAlpha = 0.2 + random() * 0.5;
    ctx.fillStyle = cssColor(shade(gravel, 0.7 + random() * 0.6));
    ctx.fillRect(random() * size, random() * size, 2 + random() * 3, 2 + random() * 3);
  }
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = cssColor(shade(gravel, 0.6));
  ctx.lineWidth = 2;
  for (let index = 1; index < 4; index += 1) {
    ctx.beginPath();
    ctx.moveTo(0, (index * size) / 4);
    ctx.lineTo(size, (index * size) / 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* -------------------------------------------------------------------------- */
/* Materials                                                                  */
/* -------------------------------------------------------------------------- */

/** Shared PBR material set for one era generation. */
export interface EraMaterialSet {
  readonly era: EraId;
  readonly materials: Readonly<Record<PartMaterialKey, THREE.MeshStandardMaterial>>;
  /** Cross-fade opacity of the whole set (1 = fully solid). */
  setOpacity(opacity: number): void;
  /** Scales window/signage emissive output during a morph. */
  setGlowScale(scale: number): void;
  /** Advances the cheap UV/opacity advertising loops. */
  animate(elapsed: number, delta: number): void;
  dispose(): void;
}

/**
 * Builds the shared material set for one era.
 *
 * Materials are shared by every building of a generation, so a transition only
 * has to touch nine materials no matter how many lots are populated.
 */
export function createEraMaterialSet(era: EraConfig, textures: EraTextureSet): EraMaterialSet {
  const descriptor = era.buildings;
  const palette = era.palette;
  const structures = advertisingStructuresFor(era);
  const primary = materialForRole(descriptor, "primary", palette.facadePrimary);
  const secondary = materialForRole(descriptor, "secondary", palette.facadeSecondary);
  const trim = materialForRole(descriptor, "trim", palette.facadeSecondary);
  const glazing = materialForRole(descriptor, "glazing", palette.facadeSecondary);

  const materials: Record<PartMaterialKey, THREE.MeshStandardMaterial> = {
    wall: new THREE.MeshStandardMaterial({
      name: `${era.id}:wall`,
      map: textures.facade,
      color: primary.color,
      roughness: primary.roughness,
      metalness: primary.metalness,
    }),
    trim: new THREE.MeshStandardMaterial({
      name: `${era.id}:trim`,
      color: trim.color,
      roughness: clamp(trim.roughness, 0.4, 0.95),
      metalness: trim.metalness,
    }),
    roof: new THREE.MeshStandardMaterial({
      name: `${era.id}:roof`,
      map: textures.roof,
      color: mixColors(palette.sidewalk, palette.asphalt, 0.35),
      roughness: 0.95,
      metalness: 0.04,
    }),
    glazing: new THREE.MeshStandardMaterial({
      name: `${era.id}:glazing`,
      map: textures.window,
      emissiveMap: textures.window,
      color: glazing.color,
      emissive: palette.windowGlow,
      emissiveIntensity: 0.25 + descriptor.window.glow * 1.4,
      roughness: glazing.roughness,
      metalness: glazing.metalness,
      side: THREE.DoubleSide,
    }),
    storefront: new THREE.MeshStandardMaterial({
      name: `${era.id}:storefront`,
      map: textures.storefront,
      emissiveMap: textures.storefront,
      color: 0xffffff,
      emissive: palette.windowGlow,
      emissiveIntensity: 0.4 + era.storefronts.interiorGlow * 1.6,
      roughness: 0.35,
      metalness: 0.1,
      side: THREE.DoubleSide,
    }),
    metal: new THREE.MeshStandardMaterial({
      name: `${era.id}:metal`,
      color: mixColors(secondary.color, 0x4a4e54, 0.45),
      roughness: 0.45,
      metalness: clamp(0.45 + secondary.metalness, 0.35, 0.9),
    }),
    signage: new THREE.MeshStandardMaterial({
      name: `${era.id}:signage`,
      map: textures.signage,
      emissiveMap: textures.signage,
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.3 + era.advertising.brightness * 1.5,
      roughness: 0.5,
      metalness: 0.1,
      side: THREE.DoubleSide,
    }),
    media: new THREE.MeshStandardMaterial({
      name: `${era.id}:media`,
      map: textures.media,
      emissiveMap: textures.media,
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.45 + era.advertising.brightness * 1.8,
      roughness: 0.35,
      metalness: 0.15,
      side: THREE.DoubleSide,
    }),
    green: new THREE.MeshStandardMaterial({
      name: `${era.id}:green`,
      color: mixColors(palette.accent, 0x3f5a3a, 0.55),
      roughness: 0.9,
      metalness: 0.02,
    }),
  };

  const baseIntensity = new Map<PartMaterialKey, number>();
  for (const key of PART_MATERIAL_KEYS) {
    baseIntensity.set(key, materials[key].emissiveIntensity);
  }

  const glowKeys: readonly PartMaterialKey[] = ["glazing", "storefront", "signage", "media"];
  const pulseKeys: readonly PartMaterialKey[] = structures.animated
    ? ["signage", "media"]
    : [];

  return {
    era: era.id,
    materials,
    setOpacity(opacity: number): void {
      const solid = clamp(opacity, 0, 1) >= 0.999;
      for (const key of PART_MATERIAL_KEYS) {
        const material = materials[key];
        material.opacity = clamp(opacity, 0, 1);
        material.transparent = !solid;
        material.depthWrite = solid;
      }
    },
    setGlowScale(scale: number): void {
      for (const key of glowKeys) {
        const material = materials[key];
        material.emissiveIntensity = (baseIntensity.get(key) ?? 0) * clamp(scale, 0, 2);
      }
    },
    animate(elapsed: number, delta: number): void {
      if (!structures.animated) {
        return;
      }
      const media = materials.media;
      const map = media.map;
      if (map) {
        map.offset.x = (map.offset.x + delta * 0.05 * (0.5 + era.advertising.animatedShare)) % 1;
      }
      const speed = 0.6 + era.advertising.animatedShare * 2.4;
      for (const key of pulseKeys) {
        const material = materials[key];
        const base = baseIntensity.get(key) ?? 0;
        material.emissiveIntensity = base * (0.78 + 0.22 * Math.sin(elapsed * speed + (key === "media" ? 1.1 : 0)));
      }
    },
    dispose(): void {
      for (const key of PART_MATERIAL_KEYS) {
        materials[key].dispose();
      }
    },
  };
}
