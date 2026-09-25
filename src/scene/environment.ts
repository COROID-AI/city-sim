/**
 * Era environment system: sky, lighting, fog, street surfaces and furniture.
 *
 * This module is the **single writer of per-era scene fog and lighting state**
 * for Chrono City; the post-processing system only grades screen space. It
 * consumes the two shared contracts and changes neither: `../era/eraTypes`
 * supplies the era dataset (`environment` descriptor plus palette) and
 * `./layout` supplies the real street corridors, crosswalks and prop slots.
 *
 * What it produces, per timeline stop:
 *
 * * a gradient sky dome whose top/horizon colours, sun direction, sun colour
 *   and sun glow are driven straight from `skyModel`, `sunElevation`,
 *   `sunAzimuth` and the palette;
 * * a sun (`DirectionalLight`, shadows), a hemisphere sky/ground bounce, an
 *   ambient fill and an opposite bounce light, all scaled from `lux` and the
 *   sky model's cloudiness so 1945's low hazy light and 2025's crisp
 *   high-key light read as different afternoons;
 * * exponential-squared fog whose colour and density come from the era's
 *   `fogColor`/`fogDensity`;
 * * street surfaces: carriageways, sidewalks, curbs, gutters, drains, manhole
 *   covers, lane markings, crosswalk paint and 1945 tram rails, all painted
 *   from procedural canvas textures;
 * * street furniture built by `./streetProps` and mounted **only** on the
 *   layout's prop slots (advertisement slots stay with the advertising system).
 *
 * Morphing: `applyEra(era, blend)` is continuous in `0..1`. Lighting, sky and
 * fog are numerically lerped between the two era descriptors, while geometry
 * (surfaces and furniture) crossfades between two co-located variants; the
 * outgoing variant's geometry, materials and textures are disposed once the
 * incoming variant is fully visible, so `0..1` never leaves stale GPU state.
 */

import * as THREE from "three";

import {
  clampBlend,
  getEraConfig,
  type EraConfig,
  type EraId,
  type EraSceneSystem,
  type EraUpdateContext,
  type StreetSurface,
} from "../era/eraTypes";
import {
  CITY_LAYOUT,
  type CardinalSide,
  type CityLayout,
  type PerimeterStreet,
  type PropSlot,
} from "./layout";
import {
  PartAssembler,
  createStreetProp,
  eraFurnitureSet,
  extrasForEra,
  primaryKindForSlot,
  type StreetFurnitureKind,
  type StreetPropEmitter,
  type StreetPropModel,
} from "./streetProps";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_SEED = 0x4348524f;
const SKY_RADIUS = 300;
const SUN_DISTANCE = 150;
const SHADOW_EXTENT = 52;
const STREET_TILE_METRES = 4;
const SIDEWALK_TILE_METRES = 3;
const APRON_SIZE = 150;
/**
 * Companion props are only scattered on slots near the block centre so their
 * tangent offset can never push them past the sidewalk band's end.
 */
const COMPANION_TANGENT_LIMIT = 12;
/** Companion kinds too bulky to duplicate along one sidewalk. */
const SINGLE_COMPANIONS: ReadonlySet<StreetFurnitureKind> = new Set<StreetFurnitureKind>([
  "vending-kiosk",
  "water-trough",
  "newsstand",
]);

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
const lerpNumber = (from: number, to: number, amount: number): number => from + (to - from) * amount;
const css = (color: THREE.Color): string => `#${color.getHexString()}`;

/** Deterministic mulberry32 stream, so both era variants paint identically. */
function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Lighting model                                                             */
/* -------------------------------------------------------------------------- */

/** Resolved lighting/sky/fog parameters of one era stop. */
export interface EraLighting {
  readonly skyTop: THREE.Color;
  readonly skyHorizon: THREE.Color;
  readonly sunColor: THREE.Color;
  readonly ambientColor: THREE.Color;
  readonly groundBounce: THREE.Color;
  readonly sunDirection: THREE.Vector3;
  readonly sunElevation: number;
  readonly sunAzimuth: number;
  readonly sunIntensity: number;
  readonly hemisphereIntensity: number;
  readonly ambientIntensity: number;
  readonly bounceIntensity: number;
  readonly fogColor: THREE.Color;
  readonly fogDensity: number;
}

/** How much of the era's light arrives as diffuse sky rather than sun. */
const CLOUDINESS: Readonly<Record<string, number>> = {
  "sooted-overcast": 0.75,
  "clear-midcentury-noon": 0.25,
  "smoggy-dusk": 0.6,
  "cool-overcast-daylight": 0.65,
  "clean-high-key-daylight": 0.3,
};

/**
 * Converts one era descriptor into a concrete lighting rig.
 *
 * Pure and deterministic: the same {@link EraConfig} always yields the same
 * colours, intensities and sun vector, which is what makes the morph testable.
 */
export function lightingForEra(era: EraConfig): EraLighting {
  const environment = era.environment;
  const elevation = THREE.MathUtils.degToRad(environment.sunElevation);
  const azimuth = THREE.MathUtils.degToRad(environment.sunAzimuth);
  const horizontal = Math.cos(elevation);
  const sunDirection = new THREE.Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation),
    -Math.cos(azimuth) * horizontal,
  ).normalize();
  const cloudiness = CLOUDINESS[environment.skyModel] ?? 0.4;
  const lux = Math.max(0, environment.lux);
  const hemisphereIntensity = (lux / 100000) * 1.6 + cloudiness * 0.5;
  return {
    skyTop: new THREE.Color(era.palette.sky),
    skyHorizon: new THREE.Color(era.palette.skyHorizon),
    sunColor: new THREE.Color(era.palette.sunlight),
    ambientColor: new THREE.Color(era.palette.ambient),
    groundBounce: new THREE.Color(era.palette.ground),
    sunDirection,
    sunElevation: environment.sunElevation,
    sunAzimuth: environment.sunAzimuth,
    sunIntensity: (lux / 100000) * 3.4,
    hemisphereIntensity,
    ambientIntensity: hemisphereIntensity * 0.35,
    bounceIntensity: hemisphereIntensity * 0.22,
    fogColor: new THREE.Color(environment.fogColor),
    fogDensity: environment.fogDensity,
  };
}

/* -------------------------------------------------------------------------- */
/* Public shapes                                                              */
/* -------------------------------------------------------------------------- */

/** Counted street-surface features, used for era reporting and assertions. */
export interface SurfaceFeatureReport {
  readonly carriageways: number;
  readonly sidewalks: number;
  readonly curbs: number;
  readonly gutters: number;
  readonly drains: number;
  readonly manholes: number;
  /** Crosswalk paint meshes built for the era (0 before crosswalks are painted). */
  readonly crosswalkBars: number;
  readonly laneMarkings: readonly string[];
  readonly tramRails: number;
  readonly surface: StreetSurface;
  readonly sidewalkMaterial: string;
}

/** One prop mounted on a real layout prop slot. */
export interface StreetPropInstance {
  readonly slot: PropSlot;
  readonly kind: StreetFurnitureKind;
  /** True for the slot's own prop, false for an era companion. */
  readonly primary: boolean;
  /** Offset along the sidewalk tangent, in metres. */
  readonly tangentOffset: number;
  readonly group: THREE.Group;
  readonly model: StreetPropModel;
}

/** A mounted era variant: the surfaces and furniture of one timeline stop. */
export interface EnvironmentVariant {
  readonly era: EraId;
  readonly group: THREE.Group;
  readonly surfaces: THREE.Group;
  readonly furniture: THREE.Group;
  readonly props: readonly StreetPropInstance[];
  readonly report: SurfaceFeatureReport;
  readonly emitters: readonly StreetPropEmitter[];
  /** Slot ids left empty because their anchor stands inside a carriageway. */
  readonly skippedSlots: readonly string[];
  dispose(): void;
}

export interface EnvironmentSystemOptions {
  readonly layout?: CityLayout;
  /** When supplied, the system becomes the single writer of `scene.fog`. */
  readonly scene?: THREE.Scene;
  readonly seed?: number;
}

/** Shader uniforms of the sky dome, exposed for the morph. */
export type SkyUniforms = {
  uTopColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uSunColor: { value: THREE.Color };
  uSunDirection: { value: THREE.Vector3 };
  uSunIntensity: { value: number };
};

/* -------------------------------------------------------------------------- */
/* Sky dome                                                                   */
/* -------------------------------------------------------------------------- */

const SKY_VERTEX_SHADER = `
  varying vec3 vWorldDirection;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldDirection = normalize(worldPosition.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = `
  uniform vec3 uTopColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform float uSunIntensity;
  varying vec3 vWorldDirection;
  void main() {
    vec3 direction = normalize(vWorldDirection);
    float height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky = mix(uHorizonColor, uTopColor, pow(height, 0.85));
    float sun = max(dot(direction, normalize(uSunDirection)), 0.0);
    sky += uSunColor * (pow(sun, 320.0) * 0.9 + pow(sun, 8.0) * 0.22) * uSunIntensity;
    gl_FragColor = vec4(sky, 1.0);
  }
`;

/* -------------------------------------------------------------------------- */
/* Procedural surface textures                                                */
/* -------------------------------------------------------------------------- */

function paintStreetTexture(assembler: PartAssembler, era: EraConfig, seed: number): THREE.CanvasTexture {
  const surface = era.environment.streetSurface;
  const asphalt = new THREE.Color(era.palette.asphalt);
  const sidewalk = new THREE.Color(era.palette.sidewalk);
  const rng = makeRng(hashString(`${era.id}:${surface}`) ^ seed);
  const texture = assembler.canvasTexture(256, 256, (context, size) => {
    context.fillStyle = css(asphalt);
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 900; index += 1) {
      const shade = 0.8 + rng() * 0.36;
      context.fillStyle = css(asphalt.clone().multiplyScalar(shade));
      const dot = 1 + rng() * 2;
      context.fillRect(rng() * size, rng() * size, dot, dot);
    }
    if (surface === "cobblestone-patched") {
      const stone = asphalt.clone().lerp(sidewalk, 0.4);
      const rows = 12;
      const columns = 10;
      for (let row = 0; row < rows; row += 1) {
        const offset = row % 2 === 0 ? 0 : size / columns / 2;
        for (let column = 0; column < columns; column += 1) {
          const width = size / columns - 3;
          const height = size / rows - 3;
          const shade = 0.82 + rng() * 0.34;
          context.fillStyle = css(stone.clone().multiplyScalar(shade));
          context.fillRect(column * (size / columns) + offset + 1.5, row * (size / rows) + 1.5, width, height);
        }
      }
      context.strokeStyle = css(asphalt.clone().multiplyScalar(0.55));
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, size * 0.68);
      context.lineTo(size, size * 0.62);
      context.stroke();
    } else if (surface === "asphalt-seamed") {
      context.strokeStyle = css(asphalt.clone().multiplyScalar(0.5));
      context.lineWidth = 3;
      for (const fraction of [0.22, 0.55, 0.84]) {
        context.beginPath();
        context.moveTo(0, size * fraction);
        context.lineTo(size, size * fraction + size * 0.02);
        context.stroke();
      }
      context.fillStyle = css(asphalt.clone().multiplyScalar(1.22));
      context.fillRect(size * 0.1, size * 0.3, size * 0.32, size * 0.22);
      context.fillRect(size * 0.58, size * 0.6, size * 0.28, size * 0.2);
    } else if (surface === "asphalt-cracked") {
      context.strokeStyle = css(asphalt.clone().multiplyScalar(0.4));
      context.lineWidth = 2;
      for (let index = 0; index < 7; index += 1) {
        let x = rng() * size;
        let y = rng() * size;
        context.beginPath();
        context.moveTo(x, y);
        for (let step = 0; step < 5; step += 1) {
          x += (rng() - 0.5) * size * 0.28;
          y += (rng() - 0.5) * size * 0.28;
          context.lineTo(x, y);
        }
        context.stroke();
      }
    } else if (surface === "asphalt-resurfaced") {
      context.fillStyle = css(asphalt.clone().lerp(sidewalk, 0.16));
      context.fillRect(0, 0, size, size * 0.5);
      context.strokeStyle = css(asphalt.clone().multiplyScalar(0.65));
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, size * 0.52);
      context.lineTo(size, size * 0.52);
      context.stroke();
    } else {
      context.fillStyle = css(asphalt.clone().lerp(sidewalk, 0.3));
      for (let index = 0; index < 260; index += 1) {
        context.beginPath();
        context.arc(rng() * size, rng() * size, 1.4, 0, Math.PI * 2);
        context.fill();
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(60 / STREET_TILE_METRES, 8 / STREET_TILE_METRES);
  return texture;
}

function paintSidewalkTexture(assembler: PartAssembler, era: EraConfig, seed: number): THREE.CanvasTexture {
  const materialName = era.environment.sidewalkMaterial;
  const base = new THREE.Color(era.palette.sidewalk);
  const rng = makeRng(hashString(`${era.id}:${materialName}`) ^ seed);
  const texture = assembler.canvasTexture(256, 256, (context, size) => {
    context.fillStyle = css(base);
    context.fillRect(0, 0, size, size);
    if (materialName === "cast-concrete-slab" || materialName === "brushed-concrete") {
      context.strokeStyle = css(base.clone().multiplyScalar(0.62));
      context.lineWidth = materialName === "cast-concrete-slab" ? 4 : 2;
      for (const fraction of [0.34, 0.68]) {
        context.beginPath();
        context.moveTo(0, size * fraction);
        context.lineTo(size, size * fraction);
        context.stroke();
      }
      context.beginPath();
      context.moveTo(size * 0.5, 0);
      context.lineTo(size * 0.5, size);
      context.stroke();
      if (materialName === "brushed-concrete") {
        context.lineWidth = 1;
        for (let index = 0; index < 30; index += 1) {
          const y = rng() * size;
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(size, y);
          context.stroke();
        }
      }
      context.strokeStyle = css(base.clone().multiplyScalar(0.45));
      context.lineWidth = 1.6;
      context.beginPath();
      context.moveTo(size * 0.2, size * 0.1);
      context.lineTo(size * 0.3, size * 0.3);
      context.lineTo(size * 0.26, size * 0.5);
      context.stroke();
    } else if (materialName === "aggregate-exposed-concrete") {
      for (let index = 0; index < 900; index += 1) {
        const shade = 0.7 + rng() * 0.6;
        context.fillStyle = css(base.clone().multiplyScalar(shade));
        context.beginPath();
        context.arc(rng() * size, rng() * size, 1.2 + rng(), 0, Math.PI * 2);
        context.fill();
      }
    } else {
      const brick = base.clone().multiplyScalar(0.86);
      const rows = 16;
      const columns = 8;
      for (let row = 0; row < rows; row += 1) {
        const offset = row % 2 === 0 ? 0 : size / columns / 2;
        for (let column = 0; column < columns; column += 1) {
          const shade = 0.86 + rng() * 0.28;
          context.fillStyle = css(brick.clone().multiplyScalar(shade));
          context.fillRect(column * (size / columns) + offset + 1, row * (size / rows) + 1, size / columns - 2, size / rows - 2);
        }
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(60 / SIDEWALK_TILE_METRES, 3 / SIDEWALK_TILE_METRES);
  return texture;
}

/* -------------------------------------------------------------------------- */
/* Street geometry helpers                                                    */
/* -------------------------------------------------------------------------- */

interface StreetFrame {
  /** Unit vector along the street, in world ground coordinates. */
  readonly tangent: Readonly<{ x: number; z: number }>;
  /** Unit vector across the street, pointing from the centreline to the block. */
  readonly lateral: Readonly<{ x: number; z: number }>;
}

/** Street-local frame; the tangent runs along the corridor, the lateral across it. */
export function streetFrame(side: CardinalSide): StreetFrame {
  switch (side) {
    case "north": return { tangent: { x: 1, z: 0 }, lateral: { x: 0, z: 1 } };
    case "south": return { tangent: { x: 1, z: 0 }, lateral: { x: 0, z: -1 } };
    case "east": return { tangent: { x: 0, z: 1 }, lateral: { x: -1, z: 0 } };
    case "west": return { tangent: { x: 0, z: 1 }, lateral: { x: 1, z: 0 } };
  }
}

/**
 * Yaw that puts a prop's local +Z toward its street and +X along the sidewalk.
 *
 * Inner and outer walks of the same street face opposite ways (the street runs
 * between them), so the edge is part of the frame.
 */
export function streetFacingYaw(side: CardinalSide, edge: "inner" | "outer"): number {
  const outward = side === "north" ? { x: 0, z: -1 }
    : side === "south" ? { x: 0, z: 1 }
      : side === "east" ? { x: 1, z: 0 }
        : { x: -1, z: 0 };
  const streetward = edge === "inner" ? 1 : -1;
  return Math.atan2(outward.x * streetward, outward.z * streetward);
}

function streetPoint(street: PerimeterStreet, frame: StreetFrame, tangent: number, lateral: number): { x: number; z: number } {
  return {
    x: street.center.x + frame.tangent.x * tangent + frame.lateral.x * lateral,
    z: street.center.z + frame.tangent.z * tangent + frame.lateral.z * lateral,
  };
}

function addStreetPatch(
  assembler: PartAssembler,
  street: PerimeterStreet,
  frame: StreetFrame,
  tangent: number,
  lateral: number,
  alongTangent: number,
  alongLateral: number,
  height: number,
  y: number,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const alongX = frame.tangent.x !== 0;
  const geometry = assembler.box(alongX ? alongTangent : alongLateral, height, alongX ? alongLateral : alongTangent);
  const point = streetPoint(street, frame, tangent, lateral);
  return assembler.add(geometry, material, name, [point.x, y, point.z]);
}

function addDashedLine(
  assembler: PartAssembler,
  street: PerimeterStreet,
  frame: StreetFrame,
  dashLength: number,
  gapLength: number,
  lateral: number,
  thickness: number,
  material: THREE.Material,
  name: string,
): number {
  const span = dashLength + gapLength;
  const count = Math.max(1, Math.floor(street.length / span));
  for (let index = 0; index < count; index += 1) {
    const tangent = -street.length / 2 + span / 2 + index * span;
    addStreetPatch(assembler, street, frame, tangent, lateral, dashLength, thickness, 0.02, 0.03, material, name);
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* Street surfaces                                                            */
/* -------------------------------------------------------------------------- */

/** Builds the era's carriageways, walks, kerbs, drainage, markings and paint. */
export function buildEraSurfaces(
  assembler: PartAssembler,
  era: EraConfig,
  layout: CityLayout,
  seed = DEFAULT_SEED,
): SurfaceFeatureReport {
  const environment = era.environment;
  const apronMaterial = assembler.standard(
    { color: new THREE.Color(era.palette.asphalt).lerp(new THREE.Color(era.palette.ground), 0.55).getHex(), roughness: 1, metalness: 0 },
    "surface-apron",
  );
  const apron = assembler.add(assembler.plane(APRON_SIZE, APRON_SIZE), apronMaterial, "surface-block-apron", [0, -0.04, 0]);
  apron.rotation.x = -Math.PI / 2;

  const streetTexture = paintStreetTexture(assembler, era, seed);
  const sidewalkTexture = paintSidewalkTexture(assembler, era, seed);
  const streetMaterial = assembler.standard({ map: streetTexture, roughness: 0.94, metalness: 0.02 }, "surface-carriageway");
  const sidewalkMaterial = assembler.standard({ map: sidewalkTexture, roughness: 0.9, metalness: 0 }, "surface-sidewalk");
  const curbMaterial = assembler.standard({ color: era.palette.sidewalk, roughness: 0.88, metalness: 0 }, "surface-curb");
  const gutterMaterial = assembler.standard({ color: new THREE.Color(era.palette.asphalt).multiplyScalar(0.78).getHex(), roughness: 0.95, metalness: 0 }, "surface-gutter");
  const drainMaterial = assembler.standard({ color: 0x22242a, roughness: 0.5, metalness: 0.65 }, "surface-drain");
  const manholeMaterial = assembler.standard({ color: new THREE.Color(era.palette.sidewalk).multiplyScalar(0.55).getHex(), roughness: 0.6, metalness: 0.5 }, "surface-manhole");
  const railMaterial = assembler.standard({ color: 0x9aa1a6, roughness: 0.28, metalness: 0.9 }, "surface-tram-rail");
  const paintWhite = assembler.standard({ color: 0xd9d5c6, roughness: 0.9, metalness: 0 }, "surface-paint-white");
  const paintBright = assembler.basic({ color: 0xf2f0e6 }, "surface-paint-bright");
  const paintYellow = assembler.standard({ color: 0xd8b23a, roughness: 0.9, metalness: 0 }, "surface-paint-yellow");
  const bikeLane = assembler.standard({ color: 0x2f6b45, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.72 }, "surface-bike-lane");

  const markings = environment.laneMarkings;
  const paintsCrosswalk = markings.some((marking) => marking.startsWith("crosswalk"));
  const tramRails = environment.streetSurface === "cobblestone-patched";
  let carriageways = 0;
  let sidewalks = 0;
  let curbs = 0;
  let gutters = 0;
  let drains = 0;
  let manholes = 0;
  let crosswalkBars = 0;

  for (const street of layout.streets) {
    const frame = streetFrame(street.side);
    const alongX = frame.tangent.x !== 0;
    const carriageway = assembler.add(
      assembler.plane(alongX ? street.length : street.width, alongX ? street.width : street.length),
      streetMaterial,
      `surface-carriageway-${street.side}`,
      [street.center.x, 0.01, street.center.z],
    );
    carriageway.rotation.x = -Math.PI / 2;
    carriageways += 1;

    for (const sidewalk of street.sidewalks) {
      const walk = assembler.add(
        assembler.plane(alongX ? sidewalk.length : sidewalk.width, alongX ? sidewalk.width : sidewalk.length),
        sidewalkMaterial,
        `surface-sidewalk-${sidewalk.id}`,
        [sidewalk.center.x, 0.03, sidewalk.center.z],
      );
      walk.rotation.x = -Math.PI / 2;
      sidewalks += 1;
    }

    for (const curb of street.curbs) {
      const alongTangent = alongX ? curb.length : curb.width;
      const alongLateral = alongX ? curb.width : curb.length;
      assembler.add(
        assembler.box(alongTangent, curb.height, alongLateral),
        curbMaterial,
        `surface-curb-${curb.id}`,
        [curb.position.x, curb.height / 2, curb.position.z],
      );
      curbs += 1;
    }

    // Gutters, kerb inlets and manhole covers drain the carriageway.
    for (const lateral of [street.width / 2 - 0.3, -(street.width / 2 - 0.3)]) {
      addStreetPatch(assembler, street, frame, 0, lateral, street.length, 0.55, 0.02, 0.02, gutterMaterial, `surface-gutter-${street.side}`);
      gutters += 1;
      for (const tangent of [-14, 0, 14]) {
        addStreetPatch(assembler, street, frame, tangent, lateral, 0.5, 0.34, 0.05, 0.04, drainMaterial, `surface-drain-${street.side}`);
        drains += 1;
      }
    }

    for (const tangent of [-6, 6]) {
      const manhole = assembler.add(
        assembler.cylinder(0.36, 0.36, 0.04, 14),
        manholeMaterial,
        `surface-manhole-${street.side}`,
        [streetPoint(street, frame, tangent, 0.9).x, 0.045, streetPoint(street, frame, tangent, 0.9).z],
      );
      manhole.castShadow = false;
      manholes += 1;
    }

    if (tramRails) {
      for (const lateral of [-1.4, -0.7, 0.7, 1.4]) {
        addStreetPatch(assembler, street, frame, 0, lateral, street.length, 0.08, 0.05, 0.055, railMaterial, `surface-tram-rail-${street.side}`);
      }
    }

    for (const marking of markings) {
      switch (marking) {
        case "hand-painted-center-line":
          addDashedLine(assembler, street, frame, 4.5, 5.5, 0, 0.18, paintWhite, `surface-marking-${street.side}`);
          break;
        case "double-yellow-center":
          for (const lateral of [-0.09, 0.09]) {
            addStreetPatch(assembler, street, frame, 0, lateral, street.length, 0.12, 0.02, 0.03, paintYellow, `surface-marking-${street.side}`);
          }
          break;
        case "thermoplastic-dash":
          addDashedLine(assembler, street, frame, 3, 5, 0, 0.16, paintWhite, `surface-marking-${street.side}`);
          break;
        case "solar-reflective-dash":
          addDashedLine(assembler, street, frame, 3, 5, 0, 0.18, paintBright, `surface-marking-${street.side}`);
          break;
        case "bike-lane-edge-line":
          addStreetPatch(assembler, street, frame, 0, street.width / 2 - 0.62, street.length, 0.12, 0.02, 0.03, paintWhite, `surface-marking-${street.side}`);
          break;
        case "bike-boulevard-green-lane":
          addStreetPatch(assembler, street, frame, 0, street.width / 2 - 1.05, street.length, 1.7, 0.02, 0.028, bikeLane, `surface-bike-lane-${street.side}`);
          addStreetPatch(assembler, street, frame, 0, street.width / 2 - 1.95, street.length, 0.1, 0.02, 0.03, paintWhite, `surface-marking-${street.side}`);
          break;
        case "bike-box-stencil":
          for (const tangent of [street.length / 2 - 4.2, -street.length / 2 + 4.2]) {
            addStreetPatch(assembler, street, frame, tangent, street.width / 2 - 1.1, 2.1, 1.7, 0.02, 0.026, bikeLane, `surface-bike-box-${street.side}`);
          }
          break;
        default:
          break;
      }
    }

    if (paintsCrosswalk) {
      const ladder = markings.includes("crosswalk-ladder");
      for (const crosswalk of layout.crosswalks) {
        if (crosswalk.streetSide !== street.side) continue;
        const spacing = crosswalk.length / crosswalk.stripeCount;
        for (let index = 0; index < crosswalk.stripeCount; index += 1) {
          const tangent = -crosswalk.length / 2 + spacing / 2 + index * spacing;
          addStreetPatch(assembler, street, frame, tangent, 0, crosswalk.stripeWidth, crosswalk.width, 0.02, 0.035, paintWhite, `surface-crosswalk-${crosswalk.id}`);
          crosswalkBars += 1;
        }
        if (ladder) {
          for (const tangent of [crosswalk.length / 2 - 0.16, -crosswalk.length / 2 + 0.16]) {
            addStreetPatch(assembler, street, frame, tangent, 0, 0.24, crosswalk.width, 0.02, 0.035, paintBright, `surface-crosswalk-ladder-${crosswalk.id}`);
            crosswalkBars += 1;
          }
        }
      }
    }
  }

  return {
    carriageways,
    sidewalks,
    curbs,
    gutters,
    drains,
    manholes,
    crosswalkBars,
    laneMarkings: [...markings],
    tramRails: tramRails ? layout.streets.length * 4 : 0,
    surface: environment.streetSurface,
    sidewalkMaterial: environment.sidewalkMaterial,
  };
}

/* -------------------------------------------------------------------------- */
/* Furniture mounting                                                         */
/* -------------------------------------------------------------------------- */

function tangentOf(slot: PropSlot): number {
  const vertical = slot.streetSide === "east" || slot.streetSide === "west";
  return vertical ? slot.anchor.position.z : slot.anchor.position.x;
}

interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Axis-aligned carriageway rectangle of one perimeter street. */
export function carriagewayBounds(street: PerimeterStreet): Bounds {
  const alongX = street.side === "north" || street.side === "south";
  const halfAlong = (alongX ? street.length : street.width) / 2;
  const halfAcross = (alongX ? street.width : street.length) / 2;
  return {
    minX: street.center.x - halfAlong,
    maxX: street.center.x + halfAlong,
    minZ: street.center.z - halfAcross,
    maxZ: street.center.z + halfAcross,
  };
}

/**
 * True when a point stands clear of every carriageway.
 *
 * The layout runs each sidewalk the full length of its street, so its corner
 * slots (tangent ±24, and the signage anchors at ±25) land inside the
 * perpendicular street's carriageway; mounting furniture there would block
 * traffic, so those slots are reported as skipped instead.
 */
function isClearOfCarriageways(point: Readonly<{ x: number; z: number }>, carriageways: readonly Bounds[], margin = 0.05): boolean {
  return !carriageways.some((bounds) => point.x > bounds.minX + margin && point.x < bounds.maxX - margin
    && point.z > bounds.minZ + margin && point.z < bounds.maxZ - margin);
}

/** Furniture of one era variant plus the slots that could not be used. */
export interface FurniturePlacement {
  readonly props: readonly StreetPropInstance[];
  readonly skippedSlots: readonly string[];
}

function mountProp(
  root: THREE.Group,
  era: EraConfig,
  slot: PropSlot,
  kind: StreetFurnitureKind,
  primary: boolean,
  seed: number,
  tangentOffset: number,
): StreetPropInstance {
  const model = createStreetProp(kind, era, seed);
  const anchor = new THREE.Group();
  anchor.name = `prop-${slot.id}-${kind}`;
  anchor.position.set(slot.anchor.position.x, slot.anchor.position.y, slot.anchor.position.z);
  anchor.rotation.y = streetFacingYaw(slot.streetSide, slot.sidewalkEdge);
  anchor.scale.set(slot.anchor.scale.x, slot.anchor.scale.y, slot.anchor.scale.z);
  // Local X is the sidewalk tangent once the anchor yaw faces the street.
  model.group.position.x = tangentOffset;
  anchor.add(model.group);
  root.add(anchor);
  return { slot, kind, primary, tangentOffset, group: anchor, model };
}

/** Mounts every era prop on the layout's slots, plus era companions. */
export function buildEraFurniture(
  root: THREE.Group,
  era: EraConfig,
  layout: CityLayout,
  seed = DEFAULT_SEED,
): FurniturePlacement {
  const instances: StreetPropInstance[] = [];
  const skippedSlots: string[] = [];
  const carriageways = layout.streets.map(carriagewayBounds);
  const slots = [...layout.propSlots].sort((left, right) => left.id.localeCompare(right.id));
  const mountable = new Set(
    slots.filter((slot) => isClearOfCarriageways(slot.anchor.position, carriageways)).map((slot) => slot.id),
  );

  let index = 0;
  for (const slot of slots) {
    const kind = primaryKindForSlot(slot);
    if (!kind) continue;
    if (!mountable.has(slot.id)) {
      skippedSlots.push(slot.id);
      continue;
    }
    instances.push(mountProp(root, era, slot, kind, true, seed + index * 17, 0));
    index += 1;
  }

  const companions = slots.filter((slot) => mountable.has(slot.id)
    && slot.type !== "signage"
    && Math.abs(tangentOf(slot)) <= COMPANION_TANGENT_LIMIT);
  if (companions.length === 0) return { props: instances, skippedSlots };

  let ladder = 0;
  for (const [kindIndex, kind] of extrasForEra(era).entries()) {
    const copies = SINGLE_COMPANIONS.has(kind) ? 1 : 2;
    for (let copy = 0; copy < copies; copy += 1) {
      const target = companions[(kindIndex * 7 + copy * 11) % companions.length]!;
      const direction = ladder % 2 === 0 ? 1 : -1;
      const offset = direction * (2.6 + Math.floor(ladder / 2) * 1.3);
      ladder += 1;
      instances.push(mountProp(root, era, target, kind, false, seed + kindIndex * 101 + copy * 31, offset));
    }
  }
  return { props: instances, skippedSlots };
}

/* -------------------------------------------------------------------------- */
/* Variant crossfade                                                          */
/* -------------------------------------------------------------------------- */

/** Scales a variant's opacity and emitter intensity for the era crossfade. */
function applyVariantWeight(root: THREE.Group, weight: number): void {
  const clamped = clamp01(weight);
  root.visible = clamped > 0;
  root.traverse((object) => {
    if (object instanceof THREE.PointLight) {
      const base = Number(object.userData.baseIntensity ?? object.intensity);
      object.userData.baseIntensity = base;
      object.intensity = base * clamped;
      return;
    }
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.Material)) continue;
      const store = material.userData as Record<string, unknown>;
      if (store.baseOpacity === undefined) store.baseOpacity = material.opacity;
      if (store.baseTransparent === undefined) store.baseTransparent = material.transparent;
      if (store.baseDepthWrite === undefined) store.baseDepthWrite = material.depthWrite;
      material.opacity = Number(store.baseOpacity) * clamped;
      material.transparent = clamped < 1 || Boolean(store.baseTransparent);
      material.depthWrite = clamped >= 1 ? Boolean(store.baseDepthWrite) : false;
      material.needsUpdate = true;
    }
  });
}

/* -------------------------------------------------------------------------- */
/* System                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Procedural, era-driven environment for the shared city layout.
 *
 * The 1945 block is mounted initially. `applyEra(era, blend)` lerps sky,
 * lighting and fog continuously while crossfading the surface/furniture
 * variants; the retired variant's GPU resources are released on swap.
 */
export class EnvironmentSystem implements EraSceneSystem {
  readonly id = "environment";
  readonly group = new THREE.Group();
  readonly layout: CityLayout;
  /** The single scene fog this system owns. */
  readonly fog: THREE.FogExp2;
  readonly sky: THREE.Mesh;
  readonly skyUniforms: SkyUniforms;
  readonly sun: THREE.DirectionalLight;
  readonly skyLight: THREE.HemisphereLight;
  readonly ambientLight: THREE.AmbientLight;
  readonly bounce: THREE.DirectionalLight;

  private readonly scene: THREE.Scene | null;
  private readonly seed: number;
  private readonly variants = new Map<EraId, EnvironmentVariant>();
  private readonly weights = new Map<EraId, number>();
  private readonly lightingCache = new Map<EraId, EraLighting>();
  private readonly skyBackground = new THREE.Color();
  private sourceEra: EraId = "1945";
  private targetEra: EraId = "1945";
  private blend = 1;
  private elapsed = 0;
  private disposed = false;

  constructor(options: EnvironmentSystemOptions = {}) {
    this.layout = options.layout ?? CITY_LAYOUT;
    this.seed = (options.seed ?? DEFAULT_SEED) >>> 0;
    this.scene = options.scene ?? null;
    if (this.layout.propSlots.length === 0) {
      throw new Error("EnvironmentSystem requires layout prop slots to place street furniture.");
    }
    this.group.name = "era-environment";

    this.skyUniforms = {
      uTopColor: { value: new THREE.Color(0xffffff) },
      uHorizonColor: { value: new THREE.Color(0xffffff) },
      uSunColor: { value: new THREE.Color(0xffffff) },
      uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
      uSunIntensity: { value: 1 },
    };
    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), skyMaterial);
    this.sky.name = "era-sky-dome";
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.name = "era-sun";
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.camera.left = -SHADOW_EXTENT;
    this.sun.shadow.camera.right = SHADOW_EXTENT;
    this.sun.shadow.camera.top = SHADOW_EXTENT;
    this.sun.shadow.camera.bottom = -SHADOW_EXTENT;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.position.set(0, 0, 0);
    this.group.add(this.sun, this.sun.target);

    this.bounce = new THREE.DirectionalLight(0xffffff, 0.2);
    this.bounce.name = "era-bounce-light";
    this.bounce.target.position.set(0, 0, 0);
    this.group.add(this.bounce, this.bounce.target);

    this.skyLight = new THREE.HemisphereLight(0xffffff, 0x555555, 1);
    this.skyLight.name = "era-sky-light";
    this.group.add(this.skyLight);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    this.ambientLight.name = "era-ambient-light";
    this.group.add(this.ambientLight);

    this.fog = new THREE.FogExp2(0xffffff, 0.02);
    this.fog.name = "era-scene-fog";
    if (this.scene) {
      this.scene.fog = this.fog;
      this.scene.background = this.skyBackground;
    }

    const initial = this.createVariant("1945");
    this.variants.set("1945", initial);
    this.weights.set("1945", 1);
    this.group.add(initial.group);
    this.applyLighting(1);
  }

  /** Currently dominant era, suitable for scene/status inspection. */
  get activeEra(): EraId {
    return this.blend >= 0.5 ? this.targetEra : this.sourceEra;
  }

  /** Era currently being blended towards. */
  get transitionTarget(): EraId {
    return this.targetEra;
  }

  /** Current progress through the era transition. */
  get transitionBlend(): number {
    return this.blend;
  }

  /** Props of the dominant variant. */
  get props(): readonly StreetPropInstance[] {
    return this.variants.get(this.activeEra)?.props ?? [];
  }

  /** Surfaces group of the dominant variant. */
  get surfaces(): THREE.Group | null {
    return this.variants.get(this.activeEra)?.surfaces ?? null;
  }

  /** Surface-feature counts of the dominant variant. */
  get report(): SurfaceFeatureReport | undefined {
    return this.variants.get(this.activeEra)?.report;
  }

  /** Slot ids the dominant variant could not use (their anchor is in traffic). */
  get skippedSlots(): readonly string[] {
    return this.variants.get(this.activeEra)?.skippedSlots ?? [];
  }

  /** Mounted variant for an era, or `undefined` when it is not mounted. */
  getVariant(era: EraId): EnvironmentVariant | undefined {
    return this.variants.get(era);
  }

  /** Every furniture kind the era draws from, in catalogue order. */
  furnitureSet(era: EraId): readonly StreetFurnitureKind[] {
    return eraFurnitureSet(getEraConfig(era));
  }

  /**
   * Morphs the environment to `era` at `blend` (clamped to `0..1`).
   *
   * Lighting, sky and fog are lerped numerically, surfaces and furniture are
   * crossfaded; repeated calls with the same pair are idempotent, and the
   * outgoing variant's geometry, materials and textures are disposed on swap.
   */
  applyEra(era: EraId, rawBlend: number): void {
    this.assertLive();
    getEraConfig(era);
    const blend = clampBlend(rawBlend);
    if (era !== this.targetEra) {
      const dominant = this.activeEra;
      this.releaseExcept(dominant);
      this.sourceEra = dominant;
      this.targetEra = era;
      if (!this.variants.has(era)) this.variants.set(era, this.createVariant(era));
      const source = this.variants.get(this.sourceEra);
      const target = this.variants.get(era)!;
      if (source && source !== target) this.group.add(target.group);
    }
    this.blend = blend;
    const settling = this.sourceEra === this.targetEra;
    const amount = settling ? 1 : blend;
    const source = this.variants.get(this.sourceEra);
    const target = this.variants.get(this.targetEra);
    if (source) {
      const weight = settling ? 1 : 1 - blend;
      this.weights.set(source.era, weight);
      applyVariantWeight(source.group, weight);
    }
    if (target) {
      this.weights.set(target.era, amount);
      applyVariantWeight(target.group, amount);
    }
    this.applyLighting(amount);
    if (blend >= 1) {
      this.sourceEra = era;
      this.targetEra = era;
      this.releaseExcept(era);
      const settled = this.variants.get(era);
      if (settled) {
        this.weights.set(era, 1);
        applyVariantWeight(settled.group, 1);
      }
      this.applyLighting(1);
    }
  }

  /** Advances lamp flicker; era morphing itself is driven by {@link applyEra}. */
  update(context: EraUpdateContext): void {
    this.assertLive();
    const delta = Number.isFinite(context.delta) ? Math.max(0, Math.min(context.delta, 0.5)) : 0;
    this.elapsed = Number.isFinite(context.elapsed) ? context.elapsed : this.elapsed + delta;
    const variant = this.variants.get(this.activeEra);
    if (!variant) return;
    const weight = this.weights.get(this.activeEra) ?? 1;
    for (const [index, emitter] of variant.emitters.entries()) {
      const pulse = 1 + emitter.flicker * Math.sin(this.elapsed * 3.7 + index * 1.7);
      emitter.light.intensity = emitter.baseIntensity * weight * pulse;
    }
  }

  getPickables(): readonly THREE.Object3D[] {
    return this.props.map(({ group }) => group);
  }

  dispose(): void {
    if (this.disposed) return;
    for (const variant of this.variants.values()) variant.dispose();
    this.variants.clear();
    this.weights.clear();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.sun.dispose();
    this.bounce.dispose();
    this.group.clear();
    if (this.scene) {
      if (this.scene.fog === this.fog) this.scene.fog = null;
      if (this.scene.background === this.skyBackground) this.scene.background = null;
    }
    this.disposed = true;
  }

  private createVariant(eraId: EraId): EnvironmentVariant {
    const era = getEraConfig(eraId);
    const variantGroup = new THREE.Group();
    variantGroup.name = `environment-${eraId}`;
    variantGroup.userData.era = eraId;
    const surfaces = new THREE.Group();
    surfaces.name = `environment-surfaces-${eraId}`;
    const furniture = new THREE.Group();
    furniture.name = `environment-furniture-${eraId}`;
    variantGroup.add(surfaces, furniture);

    const surfaceAssembler = new PartAssembler(`surface-assembler-${eraId}`);
    const report = buildEraSurfaces(surfaceAssembler, era, this.layout, this.seed);
    surfaces.add(surfaceAssembler.group);

    const placement = buildEraFurniture(furniture, era, this.layout, this.seed);
    const props = placement.props;
    const emitters = props.flatMap(({ model }) => [...model.emitters]);
    return {
      era: eraId,
      group: variantGroup,
      surfaces,
      furniture,
      props,
      report,
      emitters,
      skippedSlots: placement.skippedSlots,
      dispose(): void {
        surfaceAssembler.dispose();
        for (const { model } of props) model.dispose();
        variantGroup.removeFromParent();
        variantGroup.clear();
      },
    };
  }

  private lightingFor(eraId: EraId): EraLighting {
    const cached = this.lightingCache.get(eraId);
    if (cached) return cached;
    const lighting = lightingForEra(getEraConfig(eraId));
    this.lightingCache.set(eraId, lighting);
    return lighting;
  }

  private applyLighting(amount: number): void {
    const from = this.lightingFor(this.sourceEra);
    const to = this.lightingFor(this.targetEra);
    const mix = (a: THREE.Color, b: THREE.Color, out: THREE.Color): THREE.Color => out.copy(a).lerp(b, amount);
    mix(from.skyTop, to.skyTop, this.skyUniforms.uTopColor.value);
    mix(from.skyHorizon, to.skyHorizon, this.skyUniforms.uHorizonColor.value);
    mix(from.sunColor, to.sunColor, this.skyUniforms.uSunColor.value);
    mix(from.sunColor, to.sunColor, this.sun.color);
    mix(from.ambientColor, to.ambientColor, this.skyLight.color);
    mix(from.groundBounce, to.groundBounce, this.skyLight.groundColor);
    mix(from.ambientColor, to.ambientColor, this.ambientLight.color);
    mix(from.groundBounce, to.groundBounce, this.bounce.color);
    mix(from.fogColor, to.fogColor, this.fog.color);

    this.skyUniforms.uSunDirection.value.copy(from.sunDirection).lerp(to.sunDirection, amount).normalize();
    this.sun.position.copy(this.skyUniforms.uSunDirection.value).multiplyScalar(SUN_DISTANCE);
    this.bounce.position.copy(this.sun.position).multiplyScalar(-0.6);

    this.sun.intensity = lerpNumber(from.sunIntensity, to.sunIntensity, amount);
    this.skyLight.intensity = lerpNumber(from.hemisphereIntensity, to.hemisphereIntensity, amount);
    this.ambientLight.intensity = lerpNumber(from.ambientIntensity, to.ambientIntensity, amount);
    this.bounce.intensity = lerpNumber(from.bounceIntensity, to.bounceIntensity, amount);
    this.fog.density = lerpNumber(from.fogDensity, to.fogDensity, amount);
    this.skyUniforms.uSunIntensity.value = this.sun.intensity / 2.6;
    this.skyBackground.copy(this.skyUniforms.uHorizonColor.value);
  }

  private releaseExcept(era: EraId): void {
    for (const [key, variant] of [...this.variants.entries()]) {
      if (key === era) continue;
      variant.dispose();
      this.variants.delete(key);
      this.weights.delete(key);
    }
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("EnvironmentSystem has been disposed.");
  }
}

/** Builds the era environment, owning per-era fog and lighting state. */
export function createEnvironmentSystem(options: EnvironmentSystemOptions = {}): EnvironmentSystem {
  return new EnvironmentSystem(options);
}
