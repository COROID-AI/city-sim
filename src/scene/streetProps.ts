/**
 * Era street furniture: catalogue, per-era prop sets and procedural builders.
 *
 * The module consumes the two shared contracts and changes neither:
 * `../era/eraTypes` supplies the era dataset (`environment.streetFurniture`,
 * `streetLightStyle`, `treeStyle`, textures-in-colours palettes) and `./layout`
 * supplies the real prop slots with their anchor transforms.
 *
 * What it produces:
 *
 * * a single {@link StreetFurnitureKind} union covering every prop the
 *   environment can place — globes and sodium lamps, trees, benches, hydrants,
 *   phone booths, bus stops, bins, mailboxes, newsstands, meters, bollards,
 *   planters and street-name signs;
 * * {@link furnitureKindFromName}, the deterministic mapping from the era
 *   descriptor's authored furniture names to those kinds, plus
 *   {@link eraFurnitureSet} / {@link extrasForEra} which decide what each era
 *   draws from its own prop set;
 * * {@link createStreetProp}, a procedural builder producing three.js geometry
 *   and canvas textures only — no external model or image assets;
 * * {@link PartAssembler}, the shared ledger that tracks every geometry,
 *   material and texture a builder allocates so the environment can dispose a
 *   retired era variant without leaking GPU resources.
 *
 * Every builder is period-styled from the descriptor: a 1945 cast-iron globe
 * post, a 1965 gooseneck mercury lamp, a 1985 cobra sodium head, a 2005
 * rectangular metal-halide luminaire and a 2025 adaptive LED smart pole are
 * five distinct meshes produced by the same `lamp` builder.
 */

import * as THREE from "three";

import type { EraConfig, EraId } from "../era/eraTypes";
import type { PropSlot } from "./layout";

/* -------------------------------------------------------------------------- */
/* Furniture catalogue                                                        */
/* -------------------------------------------------------------------------- */

/** Every street-furniture type the environment can build. */
export type StreetFurnitureKind =
  | "lamp"
  | "tree"
  | "bench"
  | "hydrant"
  | "bus-stop"
  | "phone-booth"
  | "trash-bin"
  | "mailbox"
  | "newsstand"
  | "parking-meter"
  | "bollard"
  | "planter"
  | "water-trough"
  | "vending-kiosk"
  | "newspaper-box"
  | "street-sign";

/** Canonical catalogue order, used by reporting and coverage assertions. */
export const STREET_FURNITURE_KINDS = [
  "lamp",
  "tree",
  "bench",
  "hydrant",
  "bus-stop",
  "phone-booth",
  "trash-bin",
  "mailbox",
  "newsstand",
  "parking-meter",
  "bollard",
  "planter",
  "water-trough",
  "vending-kiosk",
  "newspaper-box",
  "street-sign",
] as const satisfies readonly StreetFurnitureKind[];

/**
 * Furniture every era shows even when the descriptor does not name it.
 *
 * The brief explicitly asks for lamps, trees, benches, hydrants, phone booths,
 * bus stops, bins and mailboxes in every period, so these kinds are anchored in
 * each era's set and only their period styling changes.
 */
export const ANCHOR_FURNITURE_KINDS = [
  "lamp",
  "tree",
  "bench",
  "hydrant",
  "bus-stop",
  "phone-booth",
  "trash-bin",
  "mailbox",
] as const satisfies readonly StreetFurnitureKind[];

/** Kinds whose home is a dedicated layout prop slot. */
export const PRIMARY_SLOT_KINDS: Readonly<Record<"lamp" | "tree" | "bench" | "hydrant" | "bus-stop", StreetFurnitureKind>> = {
  lamp: "lamp",
  tree: "tree",
  bench: "bench",
  hydrant: "hydrant",
  "bus-stop": "bus-stop",
};

/** Era furniture names (`environment.streetFurniture`) to buildable kinds. */
const DECLARED_FURNITURE: Readonly<Record<string, StreetFurnitureKind>> = {
  "cast-iron-lamp-post": "lamp",
  "gooseneck-streetlight": "lamp",
  "sodium-streetlight": "lamp",
  "metal-halide-streetlight": "lamp",
  "adaptive-led-streetlight": "lamp",
  "horse-trough": "water-trough",
  "telephone-booth-wood": "phone-booth",
  "glass-phone-booth": "phone-booth",
  "fire-hydrant": "hydrant",
  "painted-fire-hydrant": "hydrant",
  newsstand: "newsstand",
  "bus-shelter-glass": "bus-stop",
  "bus-shelter-lcd": "bus-stop",
  "solar-bus-shelter-lcd": "bus-stop",
  "parking-meter": "parking-meter",
  "parking-pay-station": "parking-meter",
  "cigarette-vending-kiosk": "vending-kiosk",
  "slat-bench": "bench",
  "steel-bench": "bench",
  "solar-public-bench": "bench",
  "newspaper-box-row": "newspaper-box",
  "bollard-row": "bollard",
  "ev-charging-bollard": "bollard",
  "recycling-bin": "trash-bin",
  "bioswale-planter": "planter",
};

/** Maps one authored furniture name to its buildable kind (throws on drift). */
export function furnitureKindFromName(name: string): StreetFurnitureKind {
  const kind = DECLARED_FURNITURE[name];
  if (!kind) throw new Error(`Unknown era street-furniture name "${name}".`);
  return kind;
}

/** Kinds the era's `streetFurniture` list declares, in authored order. */
export function declaredFurnitureKinds(era: EraConfig): readonly StreetFurnitureKind[] {
  const kinds: StreetFurnitureKind[] = [];
  for (const name of era.environment.streetFurniture) {
    const kind = furnitureKindFromName(name);
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/** The kind a dedicated layout slot hosts; `null` leaves ad slots to advertising. */
export function primaryKindForSlot(slot: PropSlot): StreetFurnitureKind | null {
  if (slot.type === "signage") {
    return slot.signageKind === "advertisement" ? null : "street-sign";
  }
  return PRIMARY_SLOT_KINDS[slot.type];
}

/**
 * Kinds scattered as companions because the layout has no dedicated slots
 * (or, for street signs, because the layout's signage anchors are unusable).
 */
export function extrasForEra(era: EraConfig): readonly StreetFurnitureKind[] {
  const primary = new Set<StreetFurnitureKind>(Object.values(PRIMARY_SLOT_KINDS));
  const extras: StreetFurnitureKind[] = [];
  const push = (kind: StreetFurnitureKind): void => {
    if (!primary.has(kind) && !extras.includes(kind)) extras.push(kind);
  };
  for (const kind of ANCHOR_FURNITURE_KINDS) push(kind);
  push("street-sign");
  for (const kind of declaredFurnitureKinds(era)) push(kind);
  return extras;
}

/** Every kind the era draws from, in canonical catalogue order. */
export function eraFurnitureSet(era: EraConfig): readonly StreetFurnitureKind[] {
  const declared = new Set<StreetFurnitureKind>([
    ...ANCHOR_FURNITURE_KINDS,
    ...declaredFurnitureKinds(era),
  ]);
  return STREET_FURNITURE_KINDS.filter((kind) => declared.has(kind));
}

/* -------------------------------------------------------------------------- */
/* Lamp and tree specifications                                               */
/* -------------------------------------------------------------------------- */

/** Buildable lamp hardware: geometry plus its emissive colour and behaviour. */
export interface LampSpec {
  /** Post height in metres, above the plinth. */
  readonly height: number;
  readonly radius: number;
  /** Arm reach over the roadway in metres; `0` for post-top globes. */
  readonly arm: number;
  readonly head: "globe" | "gooseneck" | "cobra" | "bracket" | "smart";
  readonly color: number;
  /** Emissive strength at full darkness. */
  readonly intensity: number;
  /** 0..1 incandescent/sodium flicker depth. */
  readonly flicker: number;
}

const LAMP_SPECS: Readonly<Record<string, LampSpec>> = {
  "incandescent-mantle": { height: 4.4, radius: 0.13, arm: 0, head: "globe", color: 0xffd9a0, intensity: 1.05, flicker: 0.12 },
  "mercury-vapour": { height: 6.6, radius: 0.1, arm: 1.5, head: "gooseneck", color: 0xcfe4ff, intensity: 0.9, flicker: 0.05 },
  "high-pressure-sodium": { height: 7.4, radius: 0.11, arm: 2, head: "cobra", color: 0xffb057, intensity: 0.95, flicker: 0.08 },
  "metal-halide": { height: 8.1, radius: 0.11, arm: 1.8, head: "bracket", color: 0xdfeaff, intensity: 0.85, flicker: 0.02 },
  "adaptive-led": { height: 7.6, radius: 0.12, arm: 1.3, head: "smart", color: 0xeaf6ff, intensity: 0.8, flicker: 0 },
};

/** Lamp hardware configured for the era's `streetLightStyle`. */
export function lampSpecFor(era: EraConfig): LampSpec {
  const spec = LAMP_SPECS[era.environment.streetLightStyle];
  if (!spec) throw new Error(`Unknown street-light style "${era.environment.streetLightStyle}".`);
  return spec;
}

/** Buildable tree hardware derived from the era's `treeStyle`. */
export interface TreeSpec {
  readonly trunkHeight: number;
  readonly trunkRadius: number;
  readonly canopyRadius: number;
  readonly canopyCount: number;
  readonly planter: boolean;
}

const TREE_SPECS: Readonly<Record<string, TreeSpec>> = {
  "whip-saplings": { trunkHeight: 2.4, trunkRadius: 0.07, canopyRadius: 0.8, canopyCount: 2, planter: false },
  "mature-elm-canopy": { trunkHeight: 3.4, trunkRadius: 0.2, canopyRadius: 1.3, canopyCount: 4, planter: false },
  "pruned-honey-locust": { trunkHeight: 3.1, trunkRadius: 0.16, canopyRadius: 1.15, canopyCount: 3, planter: false },
  "crape-myrtle-planters": { trunkHeight: 2.5, trunkRadius: 0.12, canopyRadius: 1, canopyCount: 3, planter: true },
  "bioswale-native-grove": { trunkHeight: 2.3, trunkRadius: 0.1, canopyRadius: 1.05, canopyCount: 3, planter: true },
};

/** Tree hardware configured for the era's `treeStyle`. */
export function treeSpecFor(era: EraConfig): TreeSpec {
  const spec = TREE_SPECS[era.environment.treeStyle];
  if (!spec) throw new Error(`Unknown tree style "${era.environment.treeStyle}".`);
  return spec;
}

/* -------------------------------------------------------------------------- */
/* Resource ledger                                                            */
/* -------------------------------------------------------------------------- */

/** A light a prop emits, with the base intensity the morph scales. */
export interface StreetPropEmitter {
  readonly light: THREE.PointLight;
  readonly baseIntensity: number;
  /** 0..1 flicker depth applied per frame for incandescent/sodium sources. */
  readonly flicker: number;
}

/**
 * Tracks every GPU resource a procedural builder allocates.
 *
 * Builders only ever create resources through the assembler, so a retired era
 * variant can dispose geometry, materials and textures exactly once.
 */
export class PartAssembler {
  readonly group: THREE.Group;
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  readonly textures: THREE.Texture[] = [];
  readonly emitters: StreetPropEmitter[] = [];

  constructor(name: string) {
    this.group = new THREE.Group();
    this.group.name = name;
  }

  /** PBR material owned by this assembler. */
  standard(params: THREE.MeshStandardMaterialParameters, name: string): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial(params);
    material.name = name;
    this.materials.push(material);
    return material;
  }

  /** Unlit material for paint, signs and emissive strips. */
  basic(params: THREE.MeshBasicMaterialParameters, name: string): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial(params);
    material.name = name;
    this.materials.push(material);
    return material;
  }

  /**
   * Adds a shadow-casting mesh and registers its geometry.
   *
   * The third argument is either the mesh name or the local position; passing a
   * position first keeps the material's own descriptive name on the mesh.
   */
  add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    nameOrPosition?: string | readonly [number, number, number],
    position?: readonly [number, number, number],
  ): THREE.Mesh {
    const named = typeof nameOrPosition === "string";
    const name = named ? nameOrPosition : material.name;
    const local = named ? position : nameOrPosition;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (local) mesh.position.set(local[0], local[1], local[2]);
    if (!this.geometries.includes(geometry)) this.geometries.push(geometry);
    this.group.add(mesh);
    return mesh;
  }

  box(width: number, height: number, depth: number): THREE.BoxGeometry {
    return new THREE.BoxGeometry(width, height, depth);
  }

  cylinder(radiusTop: number, radiusBottom: number, height: number, segments = 10): THREE.CylinderGeometry {
    return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  }

  sphere(radius: number, segments = 12): THREE.SphereGeometry {
    return new THREE.SphereGeometry(radius, segments, Math.max(6, Math.round(segments / 2)));
  }

  plane(width: number, height: number): THREE.PlaneGeometry {
    return new THREE.PlaneGeometry(width, height);
  }

  /** Paints and registers a procedural canvas texture. */
  canvasTexture(
    width: number,
    height: number,
    paint: (context: CanvasRenderingContext2D, width: number, height: number) => void,
  ): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is required to generate procedural street furniture textures.");
    paint(context, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    this.textures.push(texture);
    return texture;
  }

  /** Adds an emitter and registers it with the era morph. */
  pointLight(
    color: number,
    intensity: number,
    distance: number,
    flicker: number,
    name: string,
    position: readonly [number, number, number],
  ): THREE.PointLight {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.name = name;
    light.userData.baseIntensity = intensity;
    light.position.set(position[0], position[1], position[2]);
    this.emitters.push({ light, baseIntensity: intensity, flicker });
    this.group.add(light);
    return light;
  }

  /** Releases every resource this assembler created. */
  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.group.clear();
  }
}

/** A built street prop plus the resources its holder must eventually free. */
export interface StreetPropModel {
  readonly kind: StreetFurnitureKind;
  readonly era: EraId;
  readonly group: THREE.Group;
  readonly geometries: readonly THREE.BufferGeometry[];
  readonly materials: readonly THREE.Material[];
  readonly textures: readonly THREE.Texture[];
  readonly emitters: readonly StreetPropEmitter[];
  /** Built world-space extents in metres (width X, depth Z, height Y). */
  readonly size: Readonly<{ width: number; depth: number; height: number }>;
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

function seededFraction(seed: number, key: string): number {
  let hash = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash / 0x100000000;
}

function mixHex(from: number, to: number, amount: number): number {
  return new THREE.Color(from).lerp(new THREE.Color(to), clamp01(amount)).getHex();
}

function setRotation(mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh {
  mesh.rotation.set(x, y, z);
  return mesh;
}

/* Era street-name plates, invented for each period. */
const STREET_NAMES: Readonly<Record<EraId, readonly string[]>> = {
  "1945": ["MERCER ST", "HARBOR LN", "CANNERY ROW", "VICTORY AVE"],
  "1965": ["SUNSET BLVD", "ORBIT WAY", "PARKVIEW AVE", "MOTOR CT"],
  "1985": ["NEON AVE", "ELECTRIC ST", "FREEWAY DR", "BROADWALK"],
  "2005": ["MARKET ST", "TRANSIT WAY", "CIVIC PLAZA", "RIVER RD"],
  "2025": ["GREEN LOOP", "SOLAR WAY", "COMMONS ST", "TRANSIT MALL"],
};

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

function buildLamp(a: PartAssembler, era: EraConfig, _seed: number): void {
  const spec = lampSpecFor(era);
  const metal = era.id === "1945" ? 0x24262a : era.id === "1985" ? 0x33373c : era.id === "2025" ? 0x8d979e : 0x474d52;
  const structural = a.standard({ color: metal, roughness: 0.6, metalness: 0.55 }, "lamp-structure");
  const nightFactor = clamp01(1 - era.environment.lux / 90000);
  const intensity = spec.intensity * (0.22 + 0.78 * nightFactor);
  a.add(a.cylinder(0.24, 0.32, 0.36, 12), structural, "lamp-base", [0, 0.18, 0]);
  a.add(a.cylinder(0.13, 0.17, 0.26, 12), structural, "lamp-plinth", [0, 0.45, 0]);
  a.add(a.box(0.16, 0.24, 0.02), structural, "lamp-access-door", [0, 0.7, 0.15]);
  const postHeight = spec.height;
  a.add(a.cylinder(spec.radius, spec.radius * 1.4, postHeight, 10), structural, "lamp-post", [0, postHeight / 2 + 0.4, 0]);
  for (const ring of [0.45, 0.72]) {
    a.add(a.cylinder(spec.radius * 1.55, spec.radius * 1.55, 0.07, 10), structural, "lamp-collar", [0, postHeight * ring + 0.4, 0]);
  }
  const headY = postHeight + 0.4;
  const luminaire = a.standard(
    { color: spec.color, emissive: new THREE.Color(spec.color), emissiveIntensity: era.id === "1945" ? 0.9 : 0.75, roughness: 0.32, metalness: 0.08 },
    "lamp-luminaire",
  );
  if (spec.arm > 0) {
    const arm = a.add(a.cylinder(spec.radius * 0.55, spec.radius * 0.75, spec.arm, 8), structural, "lamp-arm", [0, headY - 0.1, spec.arm / 2]);
    setRotation(arm, Math.PI / 2, 0, 0);
  }
  switch (spec.head) {
    case "globe": {
      a.add(a.cylinder(0.34, 0.4, 0.1, 12), structural, "lamp-lantern-ring", [0, headY, 0]);
      a.add(a.sphere(0.32, 14), luminaire, "lamp-globe", [0, headY + 0.32, 0]);
      a.add(a.cylinder(0.03, 0.03, 0.18, 6), structural, "lamp-finial", [0, headY + 0.68, 0]);
      break;
    }
    case "gooseneck": {
      const hood = a.add(a.cylinder(0.3, 0.16, 0.34, 12), luminaire, "lamp-hood", [0, headY - 0.08, spec.arm]);
      setRotation(hood, 0, 0, Math.PI / 2);
      a.add(a.cylinder(0.17, 0.17, 0.06, 12), luminaire, "lamp-lens", [0, headY - 0.26, spec.arm]);
      break;
    }
    case "cobra": {
      const head = a.add(a.box(0.36, 0.16, 1.05), luminaire, "lamp-cobra-head", [0, headY - 0.05, spec.arm - 0.35]);
      setRotation(head, 0.06, 0, 0);
      a.add(a.box(0.34, 0.03, 0.9), luminaire, "lamp-cobra-lens", [0, headY - 0.15, spec.arm - 0.35]);
      break;
    }
    case "bracket": {
      a.add(a.box(0.44, 0.18, 0.66), luminaire, "lamp-bracket-head", [0, headY - 0.02, spec.arm - 0.3]);
      a.add(a.box(0.4, 0.03, 0.56), luminaire, "lamp-bracket-lens", [0, headY - 0.13, spec.arm - 0.3]);
      a.add(a.box(0.2, 0.24, 0.2), structural, "lamp-bracket-lug", [0, headY - 0.18, spec.arm + 0.06]);
      break;
    }
    case "smart": {
      a.add(a.box(0.52, 0.15, 0.86), luminaire, "lamp-led-head", [0, headY - 0.02, spec.arm - 0.4]);
      a.add(a.box(0.48, 0.03, 0.74), luminaire, "lamp-led-lens", [0, headY - 0.12, spec.arm - 0.4]);
      a.add(a.box(0.16, 0.14, 0.36), structural, "lamp-camera", [0, headY - 0.16, spec.arm + 0.12]);
      a.add(a.cylinder(0.07, 0.07, 0.12, 8), structural, "lamp-sensor", [0, headY + 0.13, spec.arm - 0.4]);
      const panel = a.add(a.box(0.62, 0.03, 0.5), a.basic({ color: 0x1b2a33 }, "lamp-solar"), [0, headY + 0.22, spec.arm - 0.4]);
      setRotation(panel, -0.28, 0, 0);
      break;
    }
  }
  a.pointLight(spec.color, intensity, 18, spec.flicker, "lamp-light", [0, headY - 0.28, spec.arm]);
}

function buildTree(a: PartAssembler, era: EraConfig, seed: number): void {
  const spec = treeSpecFor(era);
  const variation = seededFraction(seed, `tree-${era.id}`);
  const bark = mixHex(0x4a3b2c, 0x6a5741, variation * 0.5);
  const barkMaterial = a.standard({ color: bark, roughness: 0.95, metalness: 0 }, "tree-bark");
  const foliageColor = mixHex(
    mixHex(era.palette.ground, 0x4f7a3d, 0.5),
    era.palette.accent,
    era.id === "1985" ? 0.16 : 0.04,
  );
  const foliage = a.standard({ color: foliageColor, roughness: 0.88, metalness: 0 }, "tree-foliage");
  const trunkHeight = spec.trunkHeight;
  a.add(a.cylinder(spec.trunkRadius * 1.35, spec.trunkRadius * 1.7, trunkHeight, 8), barkMaterial, "tree-trunk", [0, trunkHeight / 2, 0]);
  const branchMaterial = barkMaterial;
  for (const [index, tilt] of [0.5, -0.42, 0.22].entries()) {
    if (index >= spec.canopyCount) break;
    const branch = a.add(
      a.cylinder(spec.trunkRadius * 0.4, spec.trunkRadius * 0.62, trunkHeight * 0.6, 6),
      branchMaterial,
      "tree-branch",
      [Math.sin(tilt) * 0.32, trunkHeight * 0.82, Math.cos(tilt) * 0.12],
    );
    setRotation(branch, tilt * 0.6, 0, tilt);
  }
  const canopyBase = trunkHeight + spec.canopyRadius * 0.62;
  for (let index = 0; index < spec.canopyCount; index += 1) {
    const angle = (index / Math.max(1, spec.canopyCount)) * Math.PI * 2;
    const ring = index === 0 ? 0 : spec.canopyRadius * 0.3;
    const radius = spec.canopyRadius * (index === 0 ? 1 : 0.72);
    a.add(
      a.sphere(radius, 14),
      foliage,
      "tree-canopy",
      [Math.cos(angle) * ring, canopyBase + (index === 0 ? 0.35 : 0.1), Math.sin(angle) * ring],
    );
  }
  if (spec.planter) {
    const stone = a.standard({ color: era.palette.sidewalk, roughness: 0.9, metalness: 0 }, "tree-planter");
    a.add(a.box(1.8, 0.42, 1.8), stone, "tree-planter-box", [0, 0.21, 0]);
    a.add(a.box(1.6, 0.08, 1.6), a.standard({ color: 0x2f2a22, roughness: 1, metalness: 0 }, "tree-soil"), [0, 0.44, 0]);
    if (era.environment.treeStyle === "bioswale-native-grove") {
      const grass = a.standard({ color: mixHex(era.palette.accent, 0xd8e6a0, 0.35), roughness: 0.85, metalness: 0 }, "tree-grass");
      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2;
        const blade = a.add(a.cylinder(0.02, 0.06, 0.7, 5), grass, "tree-grass-blade", [Math.cos(angle) * 0.6, 0.8, Math.sin(angle) * 0.6]);
        setRotation(blade, Math.cos(angle) * 0.22, 0, -Math.sin(angle) * 0.22);
      }
    }
  }
}

function buildBench(a: PartAssembler, era: EraConfig, _seed: number): void {
  const wood = era.id === "1945" || era.id === "1965";
  const material = wood
    ? a.standard({ color: mixHex(0x6b4a2c, era.palette.accent, 0.15), roughness: 0.85, metalness: 0 }, "bench-slats")
    : a.standard({ color: era.id === "2025" ? 0x8f9c98 : 0x4c5459, roughness: 0.55, metalness: 0.4 }, "bench-slats");
  const frame = a.standard({ color: era.id === "2025" ? 0x5f6b6b : 0x2f3337, roughness: 0.5, metalness: 0.6 }, "bench-frame");
  for (const x of [-0.78, 0.78]) {
    a.add(a.box(0.1, 0.44, 0.56), frame, "bench-leg", [x, 0.22, 0]);
  }
  for (const z of [-0.18, -0.06, 0.06, 0.18]) {
    a.add(a.box(1.8, 0.06, 0.1), material, "bench-seat-slat", [0, 0.46, z]);
  }
  for (const [index, y] of [0.62, 0.78, 0.94].entries()) {
    const slat = a.add(a.box(1.8, 0.09, 0.05), material, "bench-back-slat", [0, y, -0.26 + index * 0.015]);
    setRotation(slat, -0.16, 0, 0);
  }
  if (era.id === "2025") {
    const panel = a.add(a.box(1.5, 0.04, 0.5), a.basic({ color: 0x1b2a33 }, "bench-solar-panel"), [0, 1.08, -0.2]);
    setRotation(panel, -0.2, 0, 0);
    a.add(a.box(1.5, 0.02, 0.06), a.basic({ color: 0x7fe0c0 }, "bench-usb-strip"), [0, 0.52, 0.22]);
  }
}

function buildHydrant(a: PartAssembler, era: EraConfig, _seed: number): void {
  const painted = era.id === "1985" || era.id === "2025";
  const body = a.standard(
    { color: painted ? era.palette.accent : mixHex(0x7a2f22, 0x9a3a2a, 0.4), roughness: 0.62, metalness: 0.25 },
    "hydrant-body",
  );
  const trim = a.standard({ color: 0xb8a05a, roughness: 0.45, metalness: 0.55 }, "hydrant-trim");
  a.add(a.cylinder(0.19, 0.22, 0.14, 12), trim, "hydrant-foot", [0, 0.07, 0]);
  a.add(a.cylinder(0.16, 0.17, 0.62, 12), body, "hydrant-barrel", [0, 0.42, 0]);
  a.add(a.cylinder(0.18, 0.18, 0.06, 12), trim, "hydrant-collar", [0, 0.74, 0]);
  a.add(a.sphere(0.16, 12), body, "hydrant-bonnet", [0, 0.82, 0]);
  a.add(a.cylinder(0.05, 0.05, 0.1, 6), trim, "hydrant-nut", [0, 0.97, 0]);
  for (const x of [-0.19, 0.19]) {
    const cap = a.add(a.cylinder(0.09, 0.09, 0.1, 10), trim, "hydrant-cap", [x, 0.5, 0]);
    setRotation(cap, 0, 0, Math.PI / 2);
  }
  a.add(a.box(0.03, 0.22, 0.05), trim, "hydrant-chain", [0.14, 0.42, 0.16]);
}

function buildBusStop(a: PartAssembler, era: EraConfig, _seed: number): void {
  const frame = a.standard({ color: era.id === "2025" ? 0x9aa6a2 : 0x3b4247, roughness: 0.5, metalness: 0.55 }, "stop-frame");
  if (era.id === "1945") {
    a.add(a.cylinder(0.07, 0.09, 2.9, 8), frame, "stop-post", [0, 1.45, 0]);
    const plate = a.add(a.box(0.9, 0.5, 0.05), a.basic({ color: 0xd8cfae }, "stop-sign"), [0, 2.4, 0]);
    setRotation(plate, 0, 0.18, 0);
    a.add(a.box(0.8, 0.09, 0.42), a.standard({ color: 0x6b4a2c, roughness: 0.85, metalness: 0 }, "stop-bench"), [0, 0.55, 0.1]);
    a.add(a.box(0.08, 0.5, 0.36), frame, "stop-bench-leg", [-0.32, 0.27, 0.1]);
    a.add(a.box(0.08, 0.5, 0.36), frame, "stop-bench-leg", [0.32, 0.27, 0.1]);
    return;
  }
  const glass = a.standard(
    { color: 0xc4dde6, transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false },
    "stop-glass",
  );
  a.add(a.box(3.3, 0.1, 1.2), frame, "stop-roof", [0, 2.52, 0]);
  for (const x of [-1.55, 1.55]) {
    for (const z of [-0.5, 0.5]) {
      a.add(a.cylinder(0.05, 0.05, 2.5, 8), frame, "stop-post", [x, 1.25, z]);
    }
  }
  a.add(a.box(3.1, 2.05, 0.04), glass, "stop-back-glass", [0, 1.35, -0.5]);
  a.add(a.box(0.04, 2.05, 1.0), glass, "stop-side-glass", [-1.55, 1.35, 0]);
  a.add(a.box(0.04, 2.05, 1.0), glass, "stop-side-glass", [1.55, 1.35, 0]);
  a.add(a.box(2.4, 0.09, 0.42), a.standard({ color: 0x5c5140, roughness: 0.8, metalness: 0.1 }, "stop-seat"), [0, 0.55, -0.18]);
  for (const x of [-1.0, 1.0]) a.add(a.box(0.08, 0.52, 0.36), frame, "stop-seat-leg", [x, 0.27, -0.18]);
  if (era.id === "1985") {
    a.add(a.box(3.34, 0.06, 0.08), a.basic({ color: era.palette.accent }, "stop-neon-trim"), [0, 2.45, 0.58]);
  }
  if (era.id === "2005" || era.id === "2025") {
    const screen = a.add(a.box(1.0, 1.4, 0.07), a.basic({ color: 0x101a24 }, "stop-lcd"), [-1.0, 1.4, 0.52]);
    setRotation(screen, 0, 0.1, 0);
    a.pointLight(era.id === "2025" ? 0x8fe6d6 : 0x9fd0ff, 0.35, 5, 0, "stop-screen-glow", [-1.0, 1.4, 0.6]);
  }
  if (era.id === "2025") {
    const panel = a.add(a.box(3.0, 0.04, 1.0), a.basic({ color: 0x18262f }, "stop-solar-panel"), [0, 2.6, 0]);
    setRotation(panel, -0.16, 0, 0);
  }
}

function buildPhoneBooth(a: PartAssembler, era: EraConfig, _seed: number): void {
  if (era.id === "2025") {
    const shell = a.standard({ color: 0x7d8a86, roughness: 0.42, metalness: 0.5 }, "kiosk-shell");
    a.add(a.box(0.52, 2.3, 0.42), shell, "kiosk-body", [0, 1.15, 0]);
    a.add(a.box(0.44, 0.72, 0.05), a.basic({ color: 0x14222b }, "kiosk-screen"), [0, 1.5, 0.22]);
    a.add(a.box(0.4, 0.03, 0.2), a.basic({ color: 0x7fe0c0 }, "kiosk-led"), [0, 2.36, 0.2]);
    return;
  }
  if (era.id === "2005") {
    const shell = a.standard({ color: 0x4d5a63, roughness: 0.5, metalness: 0.45 }, "kiosk-shell");
    a.add(a.box(0.6, 2.2, 0.5), shell, "kiosk-body", [0, 1.1, 0]);
    a.add(a.box(0.46, 0.6, 0.05), a.basic({ color: 0x16232d }, "kiosk-screen"), [0, 1.55, 0.26]);
    a.add(a.box(0.4, 0.28, 0.04), a.basic({ color: 0xb9c4c9 }, "kiosk-keypad"), [0, 1.05, 0.27]);
    return;
  }
  const wooden = era.id === "1945";
  const frameColor = wooden ? 0x3d2b1c : 0x9aa3a9;
  const frame = a.standard({ color: frameColor, roughness: wooden ? 0.8 : 0.4, metalness: wooden ? 0 : 0.6 }, "booth-frame");
  const glass = a.standard(
    { color: 0xbed7e0, transparent: true, opacity: wooden ? 0.24 : 0.34, roughness: 0.08, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false },
    "booth-glass",
  );
  const height = 2.35;
  if (wooden) {
    a.add(a.box(1.2, 0.12, 1.2), frame, "booth-base", [0, 0.06, 0]);
    a.add(a.box(1.24, 0.18, 1.24), frame, "booth-roof", [0, height + 0.06, 0]);
    for (const x of [-0.55, 0.55]) {
      for (const z of [-0.55, 0.55]) a.add(a.box(0.12, height, 0.12), frame, "booth-corner", [x, height / 2, z]);
    }
    a.add(a.box(1.0, 1.9, 0.05), glass, "booth-pane", [0, 1.25, 0.55]);
    a.add(a.box(0.05, 1.9, 1.0), glass, "booth-pane", [-0.55, 1.25, 0]);
    a.add(a.box(0.05, 1.9, 1.0), glass, "booth-pane", [0.55, 1.25, 0]);
    a.add(a.box(0.6, 0.3, 0.04), a.basic({ color: 0xf3ead1 }, "booth-sign"), [0, 2.2, 0.57]);
  } else {
    a.add(a.box(1.06, 0.1, 1.06), frame, "booth-base", [0, 0.05, 0]);
    a.add(a.box(1.1, 0.14, 1.1), frame, "booth-roof", [0, height, 0]);
    for (const x of [-0.48, 0.48]) {
      for (const z of [-0.48, 0.48]) a.add(a.box(0.08, height, 0.08), frame, "booth-post", [x, height / 2, z]);
    }
    a.add(a.box(0.92, 2.05, 0.04), glass, "booth-pane", [0, 1.2, 0.48]);
    a.add(a.box(0.04, 2.05, 0.92), glass, "booth-pane", [-0.48, 1.2, 0]);
    a.add(a.box(0.04, 2.05, 0.92), glass, "booth-pane", [0.48, 1.2, 0]);
    a.add(a.box(0.72, 0.26, 0.04), a.basic({ color: 0xdd5c2a }, "booth-sign"), [0, 2.15, 0.5]);
  }
  a.add(a.box(0.24, 0.36, 0.12), frame, "booth-phone", [0, 1.35, -0.42]);
}

function buildTrashBin(a: PartAssembler, era: EraConfig, _seed: number): void {
  const metal = a.standard(
    { color: era.id === "1945" ? 0x4a4438 : era.id === "2025" ? 0x7f8c88 : 0x53595e, roughness: 0.66, metalness: 0.45 },
    "bin-shell",
  );
  if (era.id === "2025") {
    a.add(a.box(0.72, 1.25, 0.62), metal, "bin-body", [0, 0.62, 0]);
    a.add(a.box(0.56, 0.22, 0.06), a.basic({ color: 0x7fe0c0 }, "bin-sensor"), [0, 1.34, 0.3]);
    a.add(a.box(0.5, 0.3, 0.03), a.basic({ color: 0x18313a }, "bin-display"), [0, 1.05, 0.32]);
    return;
  }
  if (era.id === "2005") {
    a.add(a.box(0.94, 1.12, 0.56), metal, "bin-body", [0, 0.56, 0]);
    a.add(a.box(0.42, 0.18, 0.06), a.basic({ color: 0x2f8fd8 }, "bin-chute"), [-0.22, 1.02, 0.29]);
    a.add(a.box(0.42, 0.18, 0.06), a.basic({ color: 0xd8a33a }, "bin-chute"), [0.22, 1.02, 0.29]);
    a.add(a.box(0.9, 0.08, 0.5), metal, "bin-lid", [0, 1.16, 0]);
    return;
  }
  if (era.id === "1985") {
    a.add(a.cylinder(0.3, 0.28, 0.92, 12), metal, "bin-shell", [0, 0.46, 0]);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      a.add(a.box(0.05, 0.8, 0.03), metal, "bin-slat", [Math.sin(angle) * 0.3, 0.46, Math.cos(angle) * 0.3]);
    }
    a.add(a.cylinder(0.32, 0.32, 0.06, 12), metal, "bin-rim", [0, 0.94, 0]);
    return;
  }
  a.add(a.cylinder(0.3, 0.28, 0.82, 12), metal, "bin-shell", [0, 0.41, 0]);
  a.add(a.cylinder(0.32, 0.32, 0.05, 12), metal, "bin-rim", [0, 0.84, 0]);
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    a.add(a.box(0.04, 0.66, 0.03), metal, "bin-mesh", [Math.sin(angle) * 0.29, 0.41, Math.cos(angle) * 0.29]);
  }
}

function buildMailbox(a: PartAssembler, era: EraConfig, _seed: number): void {
  if (era.id === "2025") {
    const shell = a.standard({ color: 0x7f8c88, roughness: 0.42, metalness: 0.5 }, "locker-shell");
    a.add(a.box(1.25, 1.85, 0.72), shell, "locker-body", [0, 0.95, 0]);
    for (let column = 0; column < 3; column += 1) {
      for (let row = 0; row < 3; row += 1) {
        a.add(a.box(0.34, 0.26, 0.04), a.basic({ color: 0x2a3a40 }, "locker-door"), [-0.38 + column * 0.38, 1.55 - row * 0.42, 0.38]);
      }
    }
    a.add(a.box(0.42, 0.32, 0.05), a.basic({ color: 0x18313a }, "locker-screen"), [0, 0.55, 0.39]);
    return;
  }
  if (era.id === "2005") {
    const shell = a.standard({ color: 0x4f6b7a, roughness: 0.5, metalness: 0.4 }, "relay-shell");
    a.add(a.box(0.95, 1.05, 0.62), shell, "relay-body", [0, 0.85, 0]);
    a.add(a.box(1.0, 0.08, 0.68), shell, "relay-lid", [0, 1.42, 0]);
    a.add(a.box(0.3, 0.34, 0.04), a.basic({ color: 0xe6e9ea }, "relay-plate"), [0.25, 1.05, 0.32]);
    return;
  }
  if (era.id === "1945") {
    const shell = a.standard({ color: 0x8c2f24, roughness: 0.55, metalness: 0.3 }, "pillar-shell");
    a.add(a.cylinder(0.29, 0.31, 1.05, 14), shell, "pillar-body", [0, 0.55, 0]);
    a.add(a.sphere(0.29, 14), shell, "pillar-dome", [0, 1.07, 0]);
    a.add(a.box(0.34, 0.06, 0.05), a.basic({ color: 0x171310 }, "pillar-slot"), [0, 0.95, 0.29]);
    a.add(a.box(0.26, 0.2, 0.03), a.basic({ color: 0xd8cfae }, "pillar-plate"), [0, 0.7, 0.3]);
    return;
  }
  const shell = a.standard({ color: era.id === "1985" ? 0x2f4f7a : 0x3d5a86, roughness: 0.52, metalness: 0.4 }, "relay-shell");
  a.add(a.box(0.6, 0.78, 0.52), shell, "relay-body", [0, 0.95, 0]);
  for (const x of [-0.2, 0.2]) a.add(a.box(0.06, 0.56, 0.06), shell, "relay-leg", [x, 0.28, 0]);
  a.add(a.box(0.42, 0.05, 0.06), a.basic({ color: 0x14181c }, "relay-slot"), [0, 1.2, 0.27]);
}

function buildNewsstand(a: PartAssembler, era: EraConfig, _seed: number): void {
  const shell = a.standard(
    { color: era.id === "1945" ? 0x54402c : 0x38525e, roughness: 0.72, metalness: era.id === "1945" ? 0 : 0.35 },
    "stand-shell",
  );
  a.add(a.box(1.7, 0.9, 0.9), shell, "stand-counter", [0, 0.45, 0]);
  a.add(a.box(1.8, 0.14, 1.0), shell, "stand-canopy", [0, 1.95, 0]);
  for (const x of [-0.78, 0.78]) a.add(a.box(0.09, 1.9, 0.09), shell, "stand-post", [x, 0.95, 0.42]);
  const goods = a.standard({ color: 0xd8c48a, roughness: 0.9, metalness: 0 }, "stand-goods");
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      a.add(a.box(0.18, 0.03, 0.24), goods, "stand-paper", [-0.65 + column * 0.26, 0.94 + row * 0.3, -0.2]);
    }
  }
  a.add(a.box(1.2, 0.28, 0.04), a.basic({ color: era.palette.accent }, "stand-sign"), [0, 2.2, 0.4]);
}

function buildParkingMeter(a: PartAssembler, era: EraConfig, _seed: number): void {
  const post = a.standard({ color: 0x4a5054, roughness: 0.5, metalness: 0.55 }, "meter-post");
  a.add(a.cylinder(0.05, 0.07, 1.05, 8), post, "meter-post", [0, 0.52, 0]);
  if (era.id === "2005" || era.id === "2025") {
    a.add(a.box(0.3, 0.46, 0.2), post, "meter-head", [0, 1.3, 0]);
    a.add(a.box(0.2, 0.24, 0.03), a.basic({ color: 0x18313a }, "meter-display"), [0, 1.36, 0.11]);
    a.add(a.box(0.24, 0.04, 0.16), a.basic({ color: era.palette.accent }, "meter-card-slot"), [0, 1.06, 0.08]);
    return;
  }
  a.add(a.box(0.26, 0.42, 0.18), post, "meter-head", [0, 1.26, 0]);
  a.add(a.cylinder(0.09, 0.09, 0.04, 12), a.standard({ color: 0xd8d2c0, roughness: 0.3, metalness: 0.1 }, "meter-window"), [0, 1.36, 0.09]);
  a.add(a.box(0.1, 0.06, 0.04), post, "meter-coin-slot", [0, 1.08, 0.1]);
}

function buildBollard(a: PartAssembler, era: EraConfig, _seed: number): void {
  if (era.id === "2025") {
    const shell = a.standard({ color: 0x7f8c88, roughness: 0.45, metalness: 0.5 }, "bollard-shell");
    a.add(a.box(0.26, 1.15, 0.34), shell, "bollard-body", [0, 0.58, 0]);
    a.add(a.box(0.18, 0.22, 0.03), a.basic({ color: 0x7fe0c0 }, "bollard-port"), [0, 0.9, 0.18]);
    a.add(a.cylinder(0.02, 0.02, 0.5, 6), shell, "bollard-cable", [0.14, 0.32, 0.1]);
    return;
  }
  const shell = a.standard({ color: era.id === "2005" ? 0x3f4a52 : 0x2f3337, roughness: 0.55, metalness: 0.5 }, "bollard-shell");
  a.add(a.cylinder(0.09, 0.12, 0.85, 10), shell, "bollard-post", [0, 0.42, 0]);
  a.add(a.sphere(0.09, 10), shell, "bollard-cap", [0, 0.86, 0]);
  a.add(a.cylinder(0.11, 0.11, 0.05, 10), a.basic({ color: 0xf0d27a }, "bollard-reflector"), [0, 0.74, 0]);
}

function buildPlanter(a: PartAssembler, era: EraConfig, seed: number): void {
  const stone = a.standard({ color: era.palette.sidewalk, roughness: 0.9, metalness: 0 }, "planter-shell");
  a.add(a.box(1.5, 0.5, 0.85), stone, "planter-box", [0, 0.25, 0]);
  a.add(a.box(1.35, 0.06, 0.7), a.standard({ color: 0x352d22, roughness: 1, metalness: 0 }, "planter-soil"), [0, 0.52, 0]);
  const green = a.standard({ color: mixHex(0x4f7a3d, era.palette.accent, era.id === "2025" ? 0.3 : 0.08), roughness: 0.85, metalness: 0 }, "planter-green");
  const count = era.id === "2025" ? 7 : 4;
  for (let index = 0; index < count; index += 1) {
    const fraction = seededFraction(seed, `planter-${index}`);
    a.add(a.sphere(0.22 + fraction * 0.08, 10), green, "planter-shrub", [-0.5 + index * (1 / count), 0.68, (fraction - 0.5) * 0.4]);
  }
}

function buildWaterTrough(a: PartAssembler, _era: EraConfig, _seed: number): void {
  const stone = a.standard({ color: 0x6e6a5e, roughness: 0.9, metalness: 0 }, "trough-shell");
  a.add(a.box(1.7, 0.5, 0.72), stone, "trough-basin", [0, 0.45, 0]);
  a.add(a.box(1.5, 0.04, 0.54), a.standard({ color: 0x2f4a52, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 }, "trough-water"), [0, 0.66, 0]);
  for (const x of [-0.6, 0.6]) a.add(a.box(0.18, 0.42, 0.5), stone, "trough-leg", [x, 0.11, 0]);
  a.add(a.cylinder(0.05, 0.05, 0.85, 6), stone, "trough-pump", [-0.72, 0.42, 0]);
}

function buildVendingKiosk(a: PartAssembler, _era: EraConfig, _seed: number): void {
  const shell = a.standard({ color: 0x6c2f34, roughness: 0.6, metalness: 0.25 }, "kiosk-shell");
  a.add(a.box(0.95, 1.9, 0.72), shell, "kiosk-body", [0, 0.95, 0]);
  a.add(a.box(0.7, 1.1, 0.04), a.basic({ color: 0xdd5c2a }, "kiosk-panel"), [0, 1.15, 0.37]);
  a.add(a.box(0.4, 0.14, 0.04), a.basic({ color: 0xf3ead1 }, "kiosk-sign"), [0, 2.02, 0.37]);
  a.add(a.box(0.16, 0.1, 0.04), a.basic({ color: 0xe8e2cf }, "kiosk-slot"), [0, 0.6, 0.37]);
  a.pointLight(0xffb46a, 0.22, 4, 0.04, "kiosk-glow", [0, 1.5, 0.5]);
}

function buildNewspaperBox(a: PartAssembler, era: EraConfig, _seed: number): void {
  const shell = a.standard({ color: era.id === "1985" ? 0x2f4f7a : 0x3f5a6b, roughness: 0.55, metalness: 0.35 }, "news-shell");
  for (let index = 0; index < 3; index += 1) {
    const x = -0.5 + index * 0.5;
    a.add(a.box(0.46, 0.86, 0.52), shell, "news-box", [x, 0.55, 0]);
    a.add(a.box(0.34, 0.44, 0.03), a.basic({ color: 0xc9d3d8 }, "news-window"), [x, 0.72, 0.27]);
    a.add(a.box(0.05, 0.2, 0.03), shell, "news-handle", [x + 0.16, 0.55, 0.28]);
    a.add(a.box(0.42, 0.32, 0.3), shell, "news-pedestal", [x, 0.16, 0]);
  }
}

function buildStreetSign(a: PartAssembler, era: EraConfig, seed: number): void {
  const names = STREET_NAMES[era.id];
  const label = names[Math.floor(seededFraction(seed, `sign-${era.id}`) * names.length)] ?? names[0];
  const ink = era.id === "1945" ? { plate: "#1f3a2c", text: "#efe6c8", edge: "#d9cfa8" }
    : era.id === "1965" ? { plate: "#f2f2ec", text: "#1d1f1c", edge: "#2b6f43" }
      : era.id === "1985" ? { plate: "#1d3f74", text: "#f4f7ff", edge: "#2ad4d4" }
        : era.id === "2005" ? { plate: "#f4f5f1", text: "#15181a", edge: "#2f8fd8" }
          : { plate: "#eef6f1", text: "#132a26", edge: "#54d69a" };
  const texture = a.canvasTexture(256, 64, (context, width, height) => {
    context.fillStyle = ink.plate;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = ink.edge;
    context.lineWidth = 5;
    context.strokeRect(4, 4, width - 8, height - 8);
    context.fillStyle = ink.text;
    context.font = "700 30px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, width / 2, height / 2, width - 24);
  });
  const plateMaterial = a.standard({ map: texture, roughness: 0.42, metalness: 0.15, side: THREE.DoubleSide }, "sign-plate");
  const post = a.standard({ color: era.id === "2025" ? 0x8d979e : 0x3b4247, roughness: 0.5, metalness: 0.55 }, "sign-post");
  a.add(a.cylinder(0.05, 0.07, 3, 8), post, "sign-post", [0, 1.5, 0]);
  a.add(a.plane(1.55, 0.4), plateMaterial, "sign-plate", [0, 2.72, 0.03]);
  a.add(a.box(0.72, 0.16, 0.03), a.basic({ color: era.palette.uiAccent }, "sign-permit"), [0, 2.34, 0.03]);
}

const BUILDERS: Readonly<Record<StreetFurnitureKind, (assembler: PartAssembler, era: EraConfig, seed: number) => void>> = {
  lamp: buildLamp,
  tree: buildTree,
  bench: buildBench,
  hydrant: buildHydrant,
  "bus-stop": buildBusStop,
  "phone-booth": buildPhoneBooth,
  "trash-bin": buildTrashBin,
  mailbox: buildMailbox,
  newsstand: buildNewsstand,
  "parking-meter": buildParkingMeter,
  bollard: buildBollard,
  planter: buildPlanter,
  "water-trough": buildWaterTrough,
  "vending-kiosk": buildVendingKiosk,
  "newspaper-box": buildNewspaperBox,
  "street-sign": buildStreetSign,
};

/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Builds one era-street prop of `kind` as procedural geometry.
 *
 * The returned model owns its geometry, materials and textures; callers mount
 * `group` and call `dispose()` when the era variant is retired.
 */
export function createStreetProp(
  kind: StreetFurnitureKind,
  era: EraConfig,
  seed = 0,
): StreetPropModel {
  const assembler = new PartAssembler(`${era.id}-${kind}`);
  BUILDERS[kind](assembler, era, seed);
  const bounds = new THREE.Box3().setFromObject(assembler.group);
  const size = bounds.isEmpty()
    ? { width: 0, depth: 0, height: 0 }
    : { width: bounds.max.x - bounds.min.x, depth: bounds.max.z - bounds.min.z, height: bounds.max.y - bounds.min.y };
  return {
    kind,
    era: era.id,
    group: assembler.group,
    geometries: assembler.geometries,
    materials: assembler.materials,
    textures: assembler.textures,
    emitters: assembler.emitters,
    size,
    dispose(): void {
      assembler.dispose();
    },
  };
}
