/**
 * Signage and lighting scene module — the café's lettering, sign hardware and
 * the whole lighting rig, era by era.
 *
 * One module owns every sign surface and every fixture, exactly the way the
 * frozen {@link SceneModule} contract expects:
 *
 *  - `build(context)` reads the room from the environment shell (its
 *    {@link RoomBounds} and the structural anchor set: the fascia mount, the
 *    storefront glazing bays, the back wall and the counter), resolves each era
 *    sign and fixture onto those anchors, paints every face procedurally, and
 *    attaches one `signage-lighting` group to the composition root.
 *  - `applyPeriod(period, context)` rewrites the whole era in place: the next
 *    roster is built and attached first, then the previous one is detached and
 *    its geometries, materials and textures are released, so nothing can point
 *    at a released resource.
 *  - `update(delta, context)` runs the era's light: fluorescent stability,
 *    halogen steadiness, neon flicker and dropout, LED shimmer and the slow
 *    breathing of dimmable pendants. It mutates the existing objects only — no
 *    per-frame allocation, no texture churn.
 *  - `dispose()` releases every geometry, material and texture this module
 *    created, detaches the group and reports the disposition. Safe to call more
 *    than once.
 *  - `getHotspots()` exposes one affordance per sign and per fixture, anchored
 *    in the module's own group; {@link SignageLightingModule.signFocus} adds the
 *    close-up framing the navigation controller inspects a sign with.
 *
 * The module deliberately owns no post-processing: the era's exposure and
 * bloom-free brightness hints are published as data for the kernel and the
 * composition root to apply.
 */

import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  type BuildContext,
  type DomainSpecBase,
  type Hotspot,
  type PeriodDefinition,
  type RoomBounds,
  type RoomPoint,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../../contracts/period';
import { CAFE_ROOM_BOUNDS, STRUCTURAL_LAYOUT } from '../environment/EnvironmentModule';
import {
  createStructuralLayout,
  roomBoundsEqual,
  type CounterPassSlot,
  type ReservedZone,
  type StructuralLayout,
  type WallId,
} from '../environment/roomBounds';
import { SIGN_1945 } from './data/1945';
import { SIGN_1965 } from './data/1965';
import { SIGN_1985 } from './data/1985';
import { SIGN_2005 } from './data/2005';
import { SIGN_2025 } from './data/2025';
import {
  DEFAULT_SIGN_PIXELS_PER_METRE,
  SignageResources,
  SignageSurfaceCache,
  createSignageTexture,
  isProceduralSignageTexture,
  paintFixtureFace,
  paintGlowTexture,
  paintShaftTexture,
  paintSignFace,
  parseColor,
  rgbToInt,
  type CanvasFactory,
  type FixtureFaceKind,
  type SignStyleId,
  type SignageSurface,
  type SignageTexture,
  type SignageTextureKind,
} from './textures';

/** Stable module id: registry key, hotspot owner id and node namespace. */
export const SIGNAGE_LIGHTING_MODULE_ID = 'signage-lighting';

/** Name of the single group every signage and fixture node is parented to. */
export const SIGNAGE_LIGHTING_GROUP_NAME = 'signage-lighting';

/** Outline interface this module publishes (`cafe-signage-lighting`). */
export const SIGNAGE_LIGHTING_INTERFACE = 'cafe-signage-lighting';

/**
 * Documented per-frame budget for the era's light objects. A mid-range GPU
 * renders this many punctual lights over the café geometry comfortably, and the
 * module never exceeds the era's own `maxActiveLights` (always ≤ this budget):
 * every additional fixture is emissive-only, so detail never costs another light.
 */
export const LIGHT_BUDGET = 6;

/**
 * Documented draw-call budget for one era: the number of meshes the
 * `signage-lighting` group may contain. Every era builds sign panels, fixture
 * housings, lit faces, halos and light shafts as separate meshes for detail, and
 * the total stays well inside this cap (which also covers the shafts and halos),
 * so a mid-range GPU draws the rig in a handful of calls per sign or fixture.
 */
export const MESH_BUDGET = 120;

/**
 * `userData.signage.role` of the materials a build creates. Emissive roles are
 * the ones the renderer can treat as light sources; the rest are housings,
 * glass and frames.
 */
export type SignageMaterialRole =
  | 'sign-face'
  | 'sign-frame'
  | 'sign-halo'
  | 'fixture-emissive'
  | 'fixture-housing'
  | 'fixture-glow'
  | 'light-shaft';

/** Clearance between a sign face and the wall it hangs on, in metres. */
export const SIGN_STANDOFF = 0.02;

/** Headroom kept below the ceiling for any sign, in metres. */
export const SIGN_CEILING_CLEARANCE = 0.06;

/** Smallest gap kept between a fixture and the ceiling, in metres. */
export const FIXTURE_CEILING_CLEARANCE = 0.02;

/* -------------------------------------------------------------------------- */
/* Era data shapes                                                            */
/* -------------------------------------------------------------------------- */

/** Where in the room a sign is mounted. */
export type SignSurfaceKind =
  | 'facade'
  | 'storefront-glass'
  | 'interior-wall'
  | 'counter'
  | 'counter-front';

/** How the era's lettering was produced. */
export type LetteringTechnique =
  | 'hand-painted'
  | 'applied-vinyl'
  | 'enamel'
  | 'light-box'
  | 'channel-letters'
  | 'edge-lit-led'
  | 'printed';

/** What the sign face is made from. */
export type SignMaterial =
  | 'painted-board'
  | 'painted-glass'
  | 'adhesive-vinyl'
  | 'backlit-plastic'
  | 'translucent-acrylic'
  | 'satin-aluminium'
  | 'frosted-acrylic'
  | 'enamel';

/** Structural anchor a sign hangs from. */
export type SignAnchor =
  | 'storefront-signage-mount'
  | 'storefront-glazing'
  | 'back-wall'
  | 'counter'
  | 'counter-front';

/** One sign of one era, as authored in the era data files. */
export interface SignSpec {
  /** Stable id across all five eras (`'facade'`, `'window'`, ...). */
  readonly id: string;
  readonly label: string;
  readonly surface: SignSurfaceKind;
  readonly anchor: SignAnchor;
  /** Index used by anchors that offer several slots (glazing bay, pass slot). */
  readonly anchorIndex?: number;
  readonly material: SignMaterial;
  readonly technique: LetteringTechnique;
  readonly style: SignStyleId;
  /** The actual lettering painted on the face. */
  readonly text: string;
  readonly secondaryText?: string;
  readonly letterColor: string;
  readonly baseColor: string;
  readonly glowColor: string;
  /** True when the sign is internally lit (self-lit face). */
  readonly backlit: boolean;
  /** Emissive strength of the face; `0` leaves the sign unlit. */
  readonly emissiveIntensity: number;
  /** Physical width / height / depth of the sign, in metres. */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Position along the anchor: 0 = left, 0.5 = centred, 1 = right. */
  readonly align: number;
  readonly note: string;
}

/** Every fixture type the timeline uses. */
export type FixtureKind =
  | 'bare-bulb-pendant'
  | 'warm-pendant'
  | 'fluorescent-tube'
  | 'halogen-downlight'
  | 'neon-tube'
  | 'compact-fluorescent'
  | 'led-strip'
  | 'dimmable-pendant';

/** Where a fixture is hung. */
export type FixtureMount = 'ceiling' | 'wall' | 'counter';

/** One fixture family of one era, with its count and light settings. */
export interface FixtureSpec {
  readonly id: string;
  readonly label: string;
  readonly kind: FixtureKind;
  readonly mount: FixtureMount;
  /** How many copies of this fixture the era places. */
  readonly count: number;
  /** Colour temperature in kelvin (ignored when {@link color} is set). */
  readonly colorTemperatureK: number;
  /** Explicit colour override, used by neon. */
  readonly color?: string;
  /** Emissive strength of the lit surface. */
  readonly emissiveIntensity: number;
  /** Luminous intensity of the light object (three.js candela). */
  readonly intensity: number;
  /** Distance the light reaches, in metres. */
  readonly range: number;
  /** Draws a volumetric light shaft from the fixture. */
  readonly shaft: boolean;
  /** Bloom-independent brightness hint in `[0, 1]` for the renderer. */
  readonly brightness: number;
  /** Flicker amount: 0 is rock steady, 1 is a tired neon transformer. */
  readonly flicker: number;
  readonly note: string;
}

/** One era's complete signage and lighting recipe. */
export interface SignageLightingSpec extends DomainSpecBase {
  readonly year: YearId;
  readonly label: string;
  readonly summary: string;
  readonly paletteName: string;
  /** Representative colour temperature of the era, in kelvin. */
  readonly colorTemperatureK: number;
  /** Tone-mapping exposure hint the composition root should apply. */
  readonly exposure: number;
  /** Night exposure hint, so the room reads without going black. */
  readonly nightExposure: number;
  /** Bloom-independent brightness hint in `[0, 1]`. */
  readonly bloom: number;
  /** Colour the era's ambient fill should be tinted with. */
  readonly ambientTint: string;
  /** Light objects this era may activate; never above {@link LIGHT_BUDGET}. */
  readonly maxActiveLights: number;
  readonly signs: readonly SignSpec[];
  readonly fixtures: readonly FixtureSpec[];
}

/** Derived, scene-object-free summary of one era (registry and HUD friendly). */
export interface SignageLightingInventory {
  readonly year: YearId;
  readonly signCount: number;
  readonly fixtureCount: number;
  readonly activeLights: number;
  readonly internallyLitSigns: number;
  readonly neon: boolean;
  readonly fluorescentTubes: boolean;
  readonly compactFluorescents: boolean;
  readonly halogenDownlights: boolean;
  readonly ledStrips: boolean;
  readonly dimmablePendant: boolean;
  readonly bareBulbPendant: boolean;
  readonly warmPendant: boolean;
  readonly lightBox: boolean;
  readonly colouredAcrylic: boolean;
  readonly channelLetters: boolean;
  readonly edgeLitPanel: boolean;
  readonly backlitLogo: boolean;
  readonly printedVinyl: boolean;
  readonly qrDecal: boolean;
  readonly priceStrip: boolean;
  readonly paintedGlass: boolean;
  readonly handPainted: boolean;
  readonly appliedVinyl: boolean;
  readonly styles: readonly SignStyleId[];
  readonly fixtureKinds: readonly FixtureKind[];
  readonly colorTemperatureK: number;
  /** Lowest and highest fixture temperature of the era, in kelvin. */
  readonly kelvinRange: readonly [number, number];
}

/** Per-era exposure and brightness hints published for the composition root. */
export interface SignageLightingExposureHints {
  readonly exposure: number;
  readonly nightExposure: number;
  readonly bloom: number;
  readonly colorTemperatureK: number;
  readonly ambientTint: string;
  readonly maxActiveLights: number;
  readonly activeLightCount: number;
}

/** Axis aligned box in world space. */
export interface SignBox {
  readonly min: RoomPoint;
  readonly max: RoomPoint;
}

/** A sign resolved onto a structural anchor, ready to build. */
export interface SignPlacement {
  readonly signId: string;
  readonly label: string;
  readonly surface: SignSurfaceKind;
  readonly material: SignMaterial;
  readonly technique: LetteringTechnique;
  readonly style: SignStyleId;
  readonly text: string;
  readonly textSecondary: string;
  readonly anchor: SignAnchor;
  /** Id of the shell mount / glazing bay / pass slot the sign used. */
  readonly anchorId: string;
  readonly wall: WallId;
  readonly position: RoomPoint;
  readonly rotationY: number;
  /** Inward-facing normal of the sign face. */
  readonly normal: RoomPoint;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly box: SignBox;
  readonly backlit: boolean;
  readonly emissiveIntensity: number;
  readonly note: string;
  readonly textureKey: string;
}

/** A fixture instance resolved onto a structural anchor. */
export interface FixturePlacement {
  readonly fixtureId: string;
  readonly label: string;
  readonly kind: FixtureKind;
  readonly mount: FixtureMount;
  readonly anchorId: string;
  readonly position: RoomPoint;
  /** Direction the fixture emits in (unit vector). */
  readonly direction: RoomPoint;
  /** Distance from the emissive element up to its ceiling plate, in metres. */
  readonly drop: number;
  /** Length of tube and tape fixtures, in metres (`0` for round fittings). */
  readonly length: number;
  readonly colorTemperatureK: number;
  readonly colorHex: string;
  readonly colorInt: number;
  readonly intensity: number;
  readonly range: number;
  readonly emissiveIntensity: number;
  readonly shaft: boolean;
  readonly shaftLength: number;
  readonly brightness: number;
  readonly flicker: number;
  /** Whether a three.js light object was created for this instance. */
  readonly light: boolean;
  readonly note: string;
}

/** Close-up framing for one sign, used by the inspect mode. */
export interface SignFocusFraming {
  readonly signId: string;
  readonly label: string;
  readonly year: YearId;
  readonly target: RoomPoint;
  readonly direction: RoomPoint;
  readonly eye: RoomPoint;
  readonly distance: number;
  readonly radius: number;
}

/** Diagnostics snapshot for the overlay and the tests. */
export interface SignageLightingDescription {
  readonly moduleId: string;
  readonly year: YearId;
  readonly built: boolean;
  readonly signCount: number;
  readonly fixtureCount: number;
  readonly lightCount: number;
  readonly hotspotCount: number;
  readonly styles: readonly SignStyleId[];
  readonly materials: readonly SignMaterial[];
  readonly fixtureKinds: readonly FixtureKind[];
  readonly colorTemperatureK: number;
  readonly exposure: number;
  readonly nightExposure: number;
  readonly bloom: number;
  readonly brightnessHint: number;
  readonly textureCount: number;
  readonly materialCount: number;
  readonly geometryCount: number;
  readonly surfaceCount: number;
  readonly textureSource: 'canvas' | 'data' | 'mixed' | 'none';
  readonly proceduralOnly: boolean;
  readonly placementProblems: readonly string[];
  readonly rejected: readonly string[];
  readonly inventory: SignageLightingInventory;
}

/** What the last build or era change released. */
export interface SignageLightingDisposition {
  readonly geometries: number;
  readonly materials: number;
  readonly textures: number;
  readonly surfaces: number;
  readonly signs: number;
  readonly fixtures: number;
}

export interface SignageLightingModuleOptions {
  /** Interior volume; defaults to the shell's {@link CAFE_ROOM_BOUNDS}. */
  readonly bounds?: RoomBounds;
  /** Structural anchor set; defaults to the shell's {@link STRUCTURAL_LAYOUT}. */
  readonly layout?: StructuralLayout;
  /** Canvas factory for the procedural faces (defaults to the DOM canvas). */
  readonly canvasFactory?: CanvasFactory;
  /** Paint resolution of sign faces, in pixels per metre. */
  readonly texturePixelsPerMetre?: number;
  readonly anisotropy?: number;
  /** Seed of the procedural painters. */
  readonly seed?: number;
  /** Frontier reported by `getHotspots` before the first build. */
  readonly initialYear?: YearId;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

function offsetPoint(point: RoomPoint, direction: RoomPoint, distance: number): RoomPoint {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
    z: point.z + direction.z * distance,
  };
}

/** True when two boxes overlap (touching faces do not count). */
export function boxesOverlap(a: SignBox, b: SignBox): boolean {
  return (
    a.min.x < b.max.x &&
    b.min.x < a.max.x &&
    a.min.y < b.max.y &&
    b.min.y < a.max.y &&
    a.min.z < b.max.z &&
    b.min.z < a.max.z
  );
}

/** Box of a reserved opening, for the placement checks. */
export function reservedZoneBox(zone: ReservedZone): SignBox {
  const halfWidth = zone.width / 2;
  const alongX = zone.inward.x !== 0;
  const halfX = alongX ? 0.05 : halfWidth;
  const halfZ = alongX ? halfWidth : 0.05;
  return {
    min: { x: zone.position.x - halfX, y: zone.sillHeight, z: zone.position.z - halfZ },
    max: { x: zone.position.x + halfX, y: zone.sillHeight + zone.height, z: zone.position.z + halfZ },
  };
}

/** Inward-facing orientation of each wall. */
const WALL_FRAMES: Readonly<Record<WallId, { readonly rotationY: number; readonly normal: RoomPoint }>> =
  Object.freeze({
    back: { rotationY: 0, normal: { x: 0, y: 0, z: 1 } },
    front: { rotationY: Math.PI, normal: { x: 0, y: 0, z: -1 } },
    left: { rotationY: Math.PI / 2, normal: { x: 1, y: 0, z: 0 } },
    right: { rotationY: -Math.PI / 2, normal: { x: -1, y: 0, z: 0 } },
  });

function wallFrame(wall: WallId): { readonly rotationY: number; readonly normal: RoomPoint } {
  return WALL_FRAMES[wall];
}

/** Fixed coordinate of a wall plane (z for the back/front walls, x otherwise). */
function wallPlaneCoordinate(layout: StructuralLayout, wall: WallId, bounds: RoomBounds): number {
  const surface = layout.walls.find((entry) => entry.id === wall);
  if (surface) return surface.runAxis === 'x' ? surface.center.z : surface.center.x;
  const halfWidth = bounds.width / 2;
  const halfDepth = bounds.depth / 2;
  switch (wall) {
    case 'front':
      return halfDepth;
    case 'back':
      return -halfDepth;
    case 'left':
      return -halfWidth;
    case 'right':
      return halfWidth;
  }
}

/**
 * World position for a sign hanging on `wall`: `lateral` runs along the wall,
 * `y` is the face centre height and the panel stands `depth / 2 + standoff`
 * proud of the wall plane, inside the room.
 */
function wallPosition(wall: WallId, lateral: number, y: number, wallPlane: number, depth: number): RoomPoint {
  const offset = depth / 2 + SIGN_STANDOFF;
  switch (wall) {
    case 'front':
      return { x: lateral, y, z: wallPlane - offset };
    case 'back':
      return { x: lateral, y, z: wallPlane + offset };
    case 'left':
      return { x: wallPlane + offset, y, z: lateral };
    case 'right':
      return { x: wallPlane - offset, y, z: lateral };
  }
}

/** Axis aligned box of a face panel given its facing normal. */
function placementBox(
  position: RoomPoint,
  width: number,
  height: number,
  depth: number,
  normal: RoomPoint,
): SignBox {
  const faceAlongZ = Math.abs(normal.z) >= Math.abs(normal.x);
  const halfX = faceAlongZ ? width / 2 : depth / 2;
  const halfZ = faceAlongZ ? depth / 2 : width / 2;
  return {
    min: { x: position.x - halfX, y: position.y - height / 2, z: position.z - halfZ },
    max: { x: position.x + halfX, y: position.y + height / 2, z: position.z + halfZ },
  };
}

/** Reads the environment shell one build context may carry as a service. */
function readShell(context: BuildContext): { layout: StructuralLayout; bounds: RoomBounds } | null {
  const services = context.services;
  if (!services) return null;
  for (const key of ['environmentModule', 'environment', 'shell']) {
    const candidate = services[key];
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as { layout?: unknown; bounds?: unknown };
    const layout = record.layout as StructuralLayout | undefined;
    const bounds = record.bounds as RoomBounds | undefined;
    if (layout && Array.isArray(layout.wallMounts) && bounds) return { layout, bounds };
  }
  return null;
}

/** Tanner Helland's colour-temperature approximation, in 0..255 RGB. */
export function kelvinToRgb(kelvin: number): { readonly r: number; readonly g: number; readonly b: number } {
  const temperature = clampNumber(kelvin, 1000, 40000) / 100;
  let red: number;
  let green: number;
  let blue: number;
  if (temperature <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temperature) - 161.1195681661;
  } else {
    red = 329.698727446 * Math.pow(temperature - 60, -0.1332047592);
    green = 288.1221695283 * Math.pow(temperature - 60, -0.0755148492);
  }
  if (temperature >= 66) {
    blue = 255;
  } else if (temperature <= 19) {
    blue = 0;
  } else {
    blue = 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  }
  const clamp = (value: number) => Math.min(Math.max(Math.round(value), 0), 255);
  return { r: clamp(red), g: clamp(green), b: clamp(blue) };
}

/** `#rrggbb` form of a colour temperature. */
export function kelvinToHex(kelvin: number): string {
  const rgb = kelvinToRgb(kelvin);
  return `#${((rgb.r << 16) | (rgb.g << 8) | rgb.b).toString(16).padStart(6, '0')}`;
}

/** Colour of one fixture: an explicit override (neon) or its kelvin value. */
export function fixtureColorHex(spec: FixtureSpec): string {
  return spec.color ?? kelvinToHex(spec.colorTemperatureK);
}

/* -------------------------------------------------------------------------- */
/* Spec map                                                                   */
/* -------------------------------------------------------------------------- */

/** Per-year era specs, keyed by {@link YearId}. */
export const SIGNAGE_LIGHTING_SPECS: Readonly<Record<YearId, SignageLightingSpec>> = Object.freeze({
  '1945': SIGN_1945,
  '1965': SIGN_1965,
  '1985': SIGN_1985,
  '2005': SIGN_2005,
  '2025': SIGN_2025,
});

/** Looks up one era's signage and lighting spec. */
export function signageLightingSpec(year: YearId): SignageLightingSpec {
  return SIGNAGE_LIGHTING_SPECS[year];
}

/** Derives the scene-object-free era inventory the registry and HUD read. */
export function describeSignageLightingSpec(spec: SignageLightingSpec): SignageLightingInventory {
  const styles = [...new Set(spec.signs.map((sign) => sign.style))];
  const fixtureKinds = [...new Set(spec.fixtures.map((fixture) => fixture.kind))];
  const kelvins = spec.fixtures.map((fixture) => fixture.colorTemperatureK);
  const minKelvin = kelvins.length > 0 ? Math.min(...kelvins) : spec.colorTemperatureK;
  const maxKelvin = kelvins.length > 0 ? Math.max(...kelvins) : spec.colorTemperatureK;
  const fixtureCount = spec.fixtures.reduce((total, fixture) => total + fixture.count, 0);
  return Object.freeze({
    year: spec.year,
    signCount: spec.signs.length,
    fixtureCount,
    activeLights: fixtureCount,
    internallyLitSigns: spec.signs.filter((sign) => sign.backlit).length,
    neon: fixtureKinds.includes('neon-tube'),
    fluorescentTubes: fixtureKinds.includes('fluorescent-tube'),
    compactFluorescents: fixtureKinds.includes('compact-fluorescent'),
    halogenDownlights: fixtureKinds.includes('halogen-downlight'),
    ledStrips: fixtureKinds.includes('led-strip'),
    dimmablePendant: fixtureKinds.includes('dimmable-pendant'),
    bareBulbPendant: fixtureKinds.includes('bare-bulb-pendant'),
    warmPendant: fixtureKinds.includes('warm-pendant'),
    lightBox: styles.includes('light-box'),
    colouredAcrylic: styles.includes('coloured-acrylic'),
    channelLetters: styles.includes('channel-letters'),
    edgeLitPanel: styles.includes('edge-lit-panel'),
    backlitLogo: styles.includes('backlit-logo'),
    printedVinyl: styles.includes('printed-vinyl'),
    qrDecal: styles.includes('qr-decal'),
    priceStrip: styles.includes('price-strip'),
    paintedGlass: styles.includes('painted-glass'),
    handPainted: spec.signs.some((sign) => sign.technique === 'hand-painted'),
    appliedVinyl: spec.signs.some((sign) => sign.technique === 'applied-vinyl'),
    styles: Object.freeze(styles),
    fixtureKinds: Object.freeze(fixtureKinds),
    colorTemperatureK: spec.colorTemperatureK,
    kelvinRange: Object.freeze([minKelvin, maxKelvin]) as readonly [number, number],
  });
}

/* -------------------------------------------------------------------------- */
/* Sign placement                                                             */
/* -------------------------------------------------------------------------- */

function resolveSignPlacement(
  spec: SignSpec,
  layout: StructuralLayout,
  bounds: RoomBounds,
  year: YearId,
): SignPlacement | null {
  const halfWidth = bounds.width / 2;
  const align = clamp01(spec.align);
  const depth = clampNumber(spec.depth, 0.01, 0.4);
  const maxHeight = bounds.height * 0.5;

  let placement: Omit<SignPlacement, 'box' | 'textureKey'> | null = null;

  switch (spec.anchor) {
    case 'storefront-signage-mount': {
      const mount = layout.wallMounts.find((entry) => entry.purpose === 'signage');
      if (!mount) return null;
      const wall = mount.wall;
      const frame = wallFrame(wall);
      const width = clampNumber(spec.width, 0.2, Math.min(mount.width * 0.98, bounds.width * 0.92));
      const height = clampNumber(spec.height, 0.12, Math.min(mount.height * 1.2, maxHeight));
      const lateral = clampNumber(
        mount.position.x + (align - 0.5) * Math.max(mount.width - width, 0),
        -halfWidth + width / 2 + 0.05,
        halfWidth - width / 2 - 0.05,
      );
      const y = clampNumber(
        mount.mountHeight,
        height / 2 + 0.05,
        bounds.height - height / 2 - SIGN_CEILING_CLEARANCE,
      );
      const wallPlane = wallPlaneCoordinate(layout, wall, bounds);
      placement = {
        signId: spec.id,
        label: spec.label,
        surface: spec.surface,
        material: spec.material,
        technique: spec.technique,
        style: spec.style,
        text: spec.text,
        textSecondary: spec.secondaryText ?? '',
        anchor: spec.anchor,
        anchorId: mount.id,
        wall,
        position: wallPosition(wall, lateral, y, wallPlane, depth),
        rotationY: frame.rotationY,
        normal: frame.normal,
        width,
        height,
        depth,
        backlit: spec.backlit,
        emissiveIntensity: spec.emissiveIntensity,
        note: spec.note,
      };
      break;
    }
    case 'storefront-glazing': {
      const zones = layout.glazingZones;
      if (zones.length === 0) return null;
      const index = clampNumber(Math.trunc(spec.anchorIndex ?? 0), 0, zones.length - 1);
      const zone = zones[index];
      if (!zone) return null;
      const wall = zone.wall;
      const frame = wallFrame(wall);
      const width = clampNumber(spec.width, 0.2, zone.width * 0.96);
      const height = clampNumber(spec.height, 0.15, Math.min(zone.height * 0.8, maxHeight));
      const lateral = clampNumber(
        zone.position.x + (align - 0.5) * Math.max(zone.width - width, 0),
        -halfWidth + width / 2 + 0.05,
        halfWidth - width / 2 - 0.05,
      );
      const lowest = zone.sillHeight + height / 2 + 0.03;
      const highest = Math.min(
        zone.sillHeight + zone.height - height / 2 - 0.03,
        bounds.height - height / 2 - SIGN_CEILING_CLEARANCE,
      );
      const y = clampNumber(zone.position.y, Math.max(lowest, height / 2 + 0.05), Math.max(highest, lowest));
      const wallPlane = wallPlaneCoordinate(layout, wall, bounds);
      placement = {
        signId: spec.id,
        label: spec.label,
        surface: spec.surface,
        material: spec.material,
        technique: spec.technique,
        style: spec.style,
        text: spec.text,
        textSecondary: spec.secondaryText ?? '',
        anchor: spec.anchor,
        anchorId: zone.id,
        wall,
        position: wallPosition(wall, lateral, y, wallPlane, depth),
        rotationY: frame.rotationY,
        normal: frame.normal,
        width,
        height,
        depth,
        backlit: spec.backlit,
        emissiveIntensity: spec.emissiveIntensity,
        note: spec.note,
      };
      break;
    }
    case 'back-wall': {
      const wall: WallId = 'back';
      const frame = wallFrame(wall);
      const wallPlane = wallPlaneCoordinate(layout, wall, bounds);
      const doorway = layout.doorway;
      const width = clampNumber(spec.width, 0.2, Math.min(bounds.width * 0.42, bounds.width * 0.92));
      const height = clampNumber(spec.height, 0.12, Math.min(0.6, maxHeight));
      const leftLimit = -halfWidth + 0.3 + width / 2;
      const rightLimit = Math.min(
        doorway.position.x - doorway.width / 2 - 0.25 - width / 2,
        halfWidth - 0.3 - width / 2,
      );
      const lateral = clampNumber(
        -bounds.width * 0.22 + (align - 0.5) * 0.8,
        Math.min(leftLimit, rightLimit),
        Math.max(leftLimit, rightLimit),
      );
      const y = clampNumber(
        bounds.height * 0.66,
        Math.max(height / 2 + 0.05, layout.counter.surfaceHeight + height / 2 + 0.2),
        bounds.height - height / 2 - SIGN_CEILING_CLEARANCE,
      );
      placement = {
        signId: spec.id,
        label: spec.label,
        surface: spec.surface,
        material: spec.material,
        technique: spec.technique,
        style: spec.style,
        text: spec.text,
        textSecondary: spec.secondaryText ?? '',
        anchor: spec.anchor,
        anchorId: 'back-wall-above-counter',
        wall,
        position: wallPosition(wall, lateral, y, wallPlane, depth),
        rotationY: frame.rotationY,
        normal: frame.normal,
        width,
        height,
        depth,
        backlit: spec.backlit,
        emissiveIntensity: spec.emissiveIntensity,
        note: spec.note,
      };
      break;
    }
    case 'counter': {
      const slots = layout.counterPassSlots;
      const index = clampNumber(Math.trunc(spec.anchorIndex ?? slots.length - 1), 0, Math.max(slots.length - 1, 0));
      const slot: CounterPassSlot | undefined = slots[index] ?? slots[0];
      const counter = layout.counter;
      const width = clampNumber(spec.width, 0.15, (slot?.width ?? 0.6) * 0.98);
      const height = clampNumber(spec.height, 0.08, Math.min(0.45, maxHeight));
      const slotX = slot?.position.x ?? counter.center.x;
      const slotWidth = slot?.width ?? 0.6;
      const lateral = clampNumber(
        slotX + (align - 0.5) * Math.max(slotWidth - width, 0),
        -halfWidth + width / 2 + 0.05,
        halfWidth - width / 2 - 0.05,
      );
      placement = {
        signId: spec.id,
        label: spec.label,
        surface: spec.surface,
        material: spec.material,
        technique: spec.technique,
        style: spec.style,
        text: spec.text,
        textSecondary: spec.secondaryText ?? '',
        anchor: spec.anchor,
        anchorId: slot?.id ?? 'counter-pass',
        wall: 'back',
        position: {
          x: lateral,
          y: counter.surfaceHeight + height / 2 + 0.005,
          z: counter.center.z,
        },
        rotationY: 0,
        normal: { x: 0, y: 0, z: 1 },
        width,
        height,
        depth,
        backlit: spec.backlit,
        emissiveIntensity: spec.emissiveIntensity,
        note: spec.note,
      };
      break;
    }
    case 'counter-front': {
      const counter = layout.counter;
      const width = clampNumber(spec.width, 0.2, counter.width * 0.96);
      const height = clampNumber(spec.height, 0.06, Math.min(0.35, maxHeight));
      const lateral = clampNumber(
        counter.center.x + (align - 0.5) * Math.max(counter.width - width, 0),
        -halfWidth + width / 2 + 0.05,
        halfWidth - width / 2 - 0.05,
      );
      placement = {
        signId: spec.id,
        label: spec.label,
        surface: spec.surface,
        material: spec.material,
        technique: spec.technique,
        style: spec.style,
        text: spec.text,
        textSecondary: spec.secondaryText ?? '',
        anchor: spec.anchor,
        anchorId: 'counter-service-face',
        wall: 'back',
        position: {
          x: lateral,
          y: clampNumber(counter.baseHeight - 0.06, height / 2 + 0.05, bounds.height - height / 2 - 0.05),
          z: counter.serviceFaceZ + depth / 2 + 0.01,
        },
        rotationY: 0,
        normal: { x: 0, y: 0, z: 1 },
        width,
        height,
        depth,
        backlit: spec.backlit,
        emissiveIntensity: spec.emissiveIntensity,
        note: spec.note,
      };
      break;
    }
  }

  if (!placement) return null;
  const box = placementBox(placement.position, placement.width, placement.height, placement.depth, placement.normal);
  return Object.freeze({
    ...placement,
    box,
    textureKey: `sign:${year}:${placement.signId}:${placement.style}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Fixture placement                                                          */
/* -------------------------------------------------------------------------- */

interface FixtureAnchor {
  readonly anchorId: string;
  readonly position: RoomPoint;
  readonly direction: RoomPoint;
  readonly drop: number;
}

/** How far below the ceiling a fixture's emissive element hangs. */
function fixtureDrop(kind: FixtureKind): number {
  switch (kind) {
    case 'bare-bulb-pendant':
      return 0.85;
    case 'warm-pendant':
      return 0.95;
    case 'dimmable-pendant':
      return 1;
    case 'fluorescent-tube':
      return 0.14;
    case 'halogen-downlight':
      return 0.05;
    case 'compact-fluorescent':
      return 0.12;
    case 'led-strip':
      return 0.08;
    case 'neon-tube':
      return 0;
  }
}

/** Length of the tube/tape fixtures, in metres (`0` for round fittings). */
export function fixtureLength(kind: FixtureKind, bounds: RoomBounds): number {
  switch (kind) {
    case 'fluorescent-tube':
      return Math.min(1.2, bounds.width * 0.3);
    case 'led-strip':
      return Math.min(1.4, bounds.width * 0.32);
    case 'neon-tube':
      return Math.min(1.4, bounds.width * 0.16);
    default:
      return 0;
  }
}

function resolveFixtureAnchors(
  spec: FixtureSpec,
  layout: StructuralLayout,
  bounds: RoomBounds,
): readonly FixtureAnchor[] {
  const count = Math.max(Math.trunc(spec.count), 0);
  if (count === 0) return Object.freeze([]);
  const anchors: FixtureAnchor[] = [];
  const halfDepth = bounds.depth / 2;
  const counter = layout.counter;
  const drop = fixtureDrop(spec.kind);

  if (spec.mount === 'wall') {
    const step = count > 1 ? Math.min(1.8, (bounds.width * 0.7) / (count - 1)) : 0;
    for (let index = 0; index < count; index += 1) {
      anchors.push({
        anchorId: `back-wall-${index + 1}`,
        position: {
          x: (index - (count - 1) / 2) * step,
          y: bounds.height - 0.72,
          z: -halfDepth + 0.14,
        },
        direction: { x: 0, y: 0, z: 1 },
        drop: 0,
      });
    }
    return Object.freeze(anchors);
  }

  if (spec.mount === 'counter') {
    const spacing = Math.min(1.8, (counter.width * 0.7) / Math.max(count, 1));
    for (let index = 0; index < count; index += 1) {
      anchors.push({
        anchorId: `counter-${index + 1}`,
        position: {
          x: counter.center.x + (index - (count - 1) / 2) * spacing,
          y: bounds.height - drop,
          z: counter.center.z + 0.2,
        },
        direction: { x: 0, y: -1, z: 0 },
        drop,
      });
    }
    return Object.freeze(anchors);
  }

  const columns = count === 1 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const columnOffset = bounds.width * 0.22;
  const rowSpread = bounds.depth * 0.64;
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = columns === 1 ? 0 : column === 0 ? -columnOffset : columnOffset;
    const z = rows === 1 ? 0 : -rowSpread / 2 + (rowSpread * row) / (rows - 1);
    anchors.push({
      anchorId: `ceiling-${index + 1}`,
      position: { x, y: bounds.height - drop, z },
      direction: { x: 0, y: -1, z: 0 },
      drop,
    });
  }
  return Object.freeze(anchors);
}

/** Emissive radius of a light shaft, in metres, per fixture type. */
function shaftRadius(kind: FixtureKind): number {
  switch (kind) {
    case 'bare-bulb-pendant':
      return 0.32;
    case 'warm-pendant':
    case 'dimmable-pendant':
      return 0.42;
    case 'fluorescent-tube':
    case 'compact-fluorescent':
      return 0.5;
    case 'halogen-downlight':
      return 0.45;
    case 'led-strip':
      return 0.55;
    case 'neon-tube':
      return 0.36;
  }
}

function createFixturePlacement(
  spec: FixtureSpec,
  anchor: FixtureAnchor,
  index: number,
  bounds: RoomBounds,
  light: boolean,
): FixturePlacement {
  const colorHex = fixtureColorHex(spec);
  const downward = anchor.direction.y < -0.5;
  let shaftLength = 0;
  if (spec.shaft) {
    if (downward) {
      shaftLength = Math.min(spec.range * 0.45, Math.max(anchor.position.y - 0.12, 0.2));
    } else {
      const reach =
        anchor.direction.x !== 0
          ? bounds.width / 2 - Math.abs(anchor.position.x) - 0.1
          : bounds.depth / 2 - Math.abs(anchor.position.z) - 0.1;
      shaftLength = Math.min(spec.range * 0.4, Math.max(reach, 0.2));
    }
  }
  return Object.freeze({
    fixtureId: `${spec.id}-${index + 1}`,
    label: count1Label(spec.label, index),
    kind: spec.kind,
    mount: spec.mount,
    anchorId: anchor.anchorId,
    position: anchor.position,
    direction: anchor.direction,
    drop: anchor.drop,
    length: fixtureLength(spec.kind, bounds),
    colorTemperatureK: spec.colorTemperatureK,
    colorHex,
    colorInt: rgbToInt(parseColor(colorHex)),
    intensity: spec.intensity,
    range: spec.range,
    emissiveIntensity: spec.emissiveIntensity,
    shaft: spec.shaft && shaftLength > 0,
    shaftLength,
    brightness: spec.brightness,
    flicker: spec.flicker,
    light,
    note: spec.note,
  });
}

function count1Label(label: string, index: number): string {
  return `${label} ${index + 1}`;
}

/* -------------------------------------------------------------------------- */
/* Animation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Per-frame brightness multiplier of one fixture. Deterministic in time and
 * index, and allocation free — the update path only writes numbers onto
 * existing materials, lights and shaft opacities.
 */
function flickerLevel(kind: FixtureKind, flicker: number, phase: number, index: number): number {
  const amount = clamp01(flicker);
  let raw: number;
  switch (kind) {
    case 'neon-tube': {
      raw = 1 + 0.12 * Math.sin(phase * 31 + index * 1.7) + 0.07 * Math.sin(phase * 6.3 + index * 2.1);
      if (Math.sin(phase * 2.9 + index * 11.3) > 0.986) raw *= 0.35;
      break;
    }
    case 'fluorescent-tube':
    case 'compact-fluorescent': {
      raw = 1 + 0.02 * Math.sin(phase * 19 + index);
      if (Math.sin(phase * 2.3 + index * 3.1) > 0.9985) raw *= 0.72;
      break;
    }
    case 'led-strip':
      raw = 1 + 0.03 * Math.sin(phase * 1.7 + index * 1.3);
      break;
    case 'dimmable-pendant':
      raw = 0.94 + 0.06 * Math.sin(phase * 0.8 + index * 1.1);
      break;
    case 'bare-bulb-pendant':
      raw = 1 + 0.04 * Math.sin(phase * 23 + index * 5.5);
      break;
    case 'warm-pendant':
      raw = 1 + 0.015 * Math.sin(phase * 2.1 + index);
      break;
    case 'halogen-downlight':
    default:
      raw = 1;
      break;
  }
  return Math.max(0.05, 1 + (raw - 1) * amount);
}

/** Per-frame brightness multiplier of one lit sign. */
function signLevel(style: SignStyleId, phase: number, index: number): number {
  switch (style) {
    case 'light-box':
    case 'coloured-acrylic':
      return 1 + 0.03 * Math.sin(phase * 24 + index * 2.7) + 0.02 * Math.sin(phase * 3.3 + index);
    case 'channel-letters':
    case 'illuminated-panel':
    case 'edge-lit-panel':
    case 'backlit-logo':
      return 1 + 0.02 * Math.sin(phase * 1.9 + index * 0.9);
    default:
      return 1;
  }
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                   */
/* -------------------------------------------------------------------------- */

interface FixtureRuntime {
  readonly placement: FixturePlacement;
  readonly materials: readonly THREE.MeshStandardMaterial[];
  readonly baseEmissive: readonly number[];
  readonly light: THREE.PointLight | null;
  readonly baseIntensity: number;
  readonly shaftMaterial: THREE.MeshBasicMaterial | null;
  readonly baseOpacity: number;
}

interface SignRuntime {
  readonly placement: SignPlacement;
  readonly style: SignStyleId;
  readonly materials: readonly THREE.MeshStandardMaterial[];
  readonly baseEmissive: readonly number[];
  readonly haloMaterial: THREE.MeshBasicMaterial | null;
  readonly baseHaloOpacity: number;
}

interface SignageBuild {
  readonly year: YearId;
  readonly spec: SignageLightingSpec;
  readonly group: THREE.Group;
  readonly resources: SignageResources;
  readonly signs: readonly SignPlacement[];
  readonly fixtures: readonly FixturePlacement[];
  readonly runtime: readonly FixtureRuntime[];
  readonly signRuntime: readonly SignRuntime[];
  readonly textures: readonly SignageTexture[];
  readonly bounds: RoomBounds;
  readonly layout: StructuralLayout;
  readonly rejected: readonly string[];
  readonly exposure: SignageLightingExposureHints;
}

/** Emissive material of a lit fixture part. */
function emissiveMaterial(
  colorInt: number,
  intensity: number,
  texture: SignageTexture | null,
  roughness = 0.45,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorInt).multiplyScalar(0.35),
    emissive: new THREE.Color(colorInt),
    emissiveIntensity: intensity,
    roughness,
    metalness: 0,
  });
  if (texture) {
    material.map = texture.texture;
    material.emissiveMap = texture.texture;
  }
  return material;
}

/** Unlit housing / shade material of a fixture. */
function housingMaterial(colorHex: string, metalness = 0.3, roughness = 0.5): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(rgbToInt(parseColor(colorHex))),
    metalness,
    roughness,
  });
}

type TextureFactory = (key: string, kind: SignageTextureKind, paint: () => SignageSurface) => SignageTexture;

function fixtureFaceKindFor(kind: FixtureKind): FixtureFaceKind | null {
  switch (kind) {
    case 'fluorescent-tube':
      return 'tube';
    case 'led-strip':
      return 'led-strip';
    case 'neon-tube':
      return 'neon';
    case 'bare-bulb-pendant':
      return 'filament';
    case 'warm-pendant':
    case 'dimmable-pendant':
    case 'halogen-downlight':
    case 'compact-fluorescent':
      return 'diffuser';
  }
}

function buildSignAssembly(
  placement: SignPlacement,
  bounds: RoomBounds,
  faceTexture: SignageTexture,
  glowTexture: SignageTexture | null,
  resources: SignageResources,
): { readonly group: THREE.Group; readonly runtime: SignRuntime } {
  const group = new THREE.Group();
  group.name = `signage:sign:${placement.signId}`;
  group.position.set(placement.position.x, placement.position.y, placement.position.z);
  group.rotation.y = placement.rotationY;

  const baseInt = rgbToInt(parseColor(placement.material === 'painted-glass' ? '#182420' : '#2a2a2e'));
  const plateMaterial = resources.ownMaterial(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(baseInt),
      metalness: placement.style === 'channel-letters' ? 0.35 : 0.18,
      roughness: 0.55,
    }),
  );
  const plate = new THREE.Mesh(
    resources.ownGeometry(new THREE.BoxGeometry(placement.width, placement.height, placement.depth)),
    plateMaterial,
  );
  plateMaterial.userData = { signage: { role: 'sign-frame' } };
  plate.name = `${group.name}:plate`;
  group.add(plate);

  const faceMaterial = resources.ownMaterial(
    new THREE.MeshStandardMaterial({
      map: faceTexture.texture,
      emissiveMap: faceTexture.texture,
      emissive: new THREE.Color(placement.emissiveIntensity > 0 ? rgbToInt(parseColor('#ffffff')) : 0x000000),
      emissiveIntensity: placement.emissiveIntensity,
      color: 0xffffff,
      roughness: placement.material === 'painted-glass' ? 0.24 : 0.58,
      metalness: 0.05,
      transparent: faceTexture.transparent,
      alphaTest: faceTexture.transparent ? 0.02 : 0,
    }),
  );
  faceMaterial.userData = {
    signage: { role: 'sign-face', style: placement.style, backlit: placement.backlit },
  };
  const face = new THREE.Mesh(
    resources.ownGeometry(new THREE.PlaneGeometry(placement.width * 0.99, placement.height * 0.98)),
    faceMaterial,
  );
  face.name = `${group.name}:face`;
  face.position.set(0, 0, placement.depth / 2 + 0.004);
  group.add(face);

  let haloMaterial: THREE.MeshBasicMaterial | null = null;
  if (placement.backlit && glowTexture) {
    // The glow plane is bigger than the sign, so it is the element that would
    // first cross a wall or the ceiling: clamp it to the room that is left.
    const faceAlongX = Math.abs(placement.normal.z) >= Math.abs(placement.normal.x);
    const lateralRoom = faceAlongX ? bounds.width / 2 : bounds.depth / 2;
    const lateralCoordinate = faceAlongX ? placement.position.x : placement.position.z;
    const halfWidthLimit = lateralRoom - Math.abs(lateralCoordinate) - 0.05;
    const halfHeightLimit =
      Math.min(bounds.height - placement.position.y, placement.position.y) - 0.03;
    const haloHalfWidth = Math.min(placement.width * 0.68, halfWidthLimit);
    const haloHalfHeight = Math.min(placement.height * 0.85, halfHeightLimit);
    if (haloHalfWidth > 0.08 && haloHalfHeight > 0.08) {
      haloMaterial = resources.ownMaterial(
        new THREE.MeshBasicMaterial({
          map: glowTexture.texture,
          color: new THREE.Color(rgbToInt(parseColor('#ffffff'))),
          transparent: true,
          opacity: 0.34,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      haloMaterial.userData = { signage: { role: 'sign-halo' } };
      const halo = new THREE.Mesh(
        resources.ownGeometry(new THREE.PlaneGeometry(haloHalfWidth * 2, haloHalfHeight * 2)),
        haloMaterial,
      );
      halo.name = `${group.name}:halo`;
      halo.position.set(0, 0, placement.depth / 2 + 0.001);
      group.add(halo);
    }
  }

  return Object.freeze({
    group,
    runtime: Object.freeze({
      placement,
      style: placement.style,
      materials: Object.freeze([faceMaterial]),
      baseEmissive: Object.freeze([placement.emissiveIntensity]),
      haloMaterial,
      baseHaloOpacity: haloMaterial ? 0.34 : 0,
    }),
  });
}

function buildFixtureAssembly(
  placement: FixturePlacement,
  resources: SignageResources,
  texture: TextureFactory,
): { readonly group: THREE.Group; readonly runtime: FixtureRuntime } {
  const group = new THREE.Group();
  group.name = `signage:fixture:${placement.fixtureId}`;
  group.position.set(placement.position.x, placement.position.y, placement.position.z);

  const faceKind = fixtureFaceKindFor(placement.kind);
  const faceTexture =
    faceKind === null
      ? null
      : texture(`fixture:${placement.kind}:${placement.colorHex}`, 'fixture', () =>
          paintFixtureFace(faceKind, placement.colorHex, rgbToInt(parseColor(placement.colorHex))),
        );
  const emissive = resources.ownMaterial(
    emissiveMaterial(placement.colorInt, placement.emissiveIntensity, faceTexture),
  );
  emissive.userData = {
    signage: { role: 'fixture-emissive', kind: placement.kind, kelvin: placement.colorTemperatureK },
  };
  const housing = resources.ownMaterial(housingMaterial('#2b2b30', 0.45, 0.42));
  housing.userData = { signage: { role: 'fixture-housing' } };
  const shade = resources.ownMaterial(housingMaterial('#3a3a40', 0.3, 0.6));
  shade.userData = { signage: { role: 'fixture-housing' } };
  const length = placement.length;

  const addPart = (
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    rotation?: { readonly x?: number; readonly y?: number; readonly z?: number },
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(resources.ownGeometry(geometry), material);
    mesh.name = `${group.name}:${name}`;
    mesh.position.set(x, y, z);
    if (rotation) mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
    group.add(mesh);
    return mesh;
  };

  switch (placement.kind) {
    case 'bare-bulb-pendant': {
      addPart('cord', new THREE.CylinderGeometry(0.012, 0.012, Math.max(placement.drop, 0.1), 6), housing, 0, placement.drop / 2, 0);
      addPart('plate', new THREE.CylinderGeometry(0.06, 0.07, 0.02, 12), housing, 0, placement.drop, 0);
      addPart('shade', new THREE.ConeGeometry(0.15, 0.16, 16, 1, true), shade, 0, 0.06, 0);
      addPart('bulb', new THREE.SphereGeometry(0.072, 16, 12), emissive, 0, -0.02, 0);
      break;
    }
    case 'warm-pendant': {
      addPart('cord', new THREE.CylinderGeometry(0.012, 0.012, Math.max(placement.drop, 0.1), 6), housing, 0, placement.drop / 2, 0);
      addPart('plate', new THREE.CylinderGeometry(0.06, 0.07, 0.02, 12), housing, 0, placement.drop, 0);
      addPart('shade', new THREE.ConeGeometry(0.2, 0.2, 18, 1, true), shade, 0, 0.08, 0);
      addPart('diffuser', new THREE.CircleGeometry(0.15, 18), emissive, 0, -0.01, 0, { x: Math.PI / 2 });
      break;
    }
    case 'dimmable-pendant': {
      addPart('cord', new THREE.CylinderGeometry(0.012, 0.012, Math.max(placement.drop, 0.1), 6), housing, 0, placement.drop / 2, 0);
      addPart('plate', new THREE.CylinderGeometry(0.06, 0.07, 0.02, 12), housing, 0, placement.drop, 0);
      addPart('shade', new THREE.CylinderGeometry(0.16, 0.22, 0.22, 20, 1, true), shade, 0, 0.09, 0);
      addPart('diffuser', new THREE.CircleGeometry(0.17, 20), emissive, 0, -0.02, 0, { x: Math.PI / 2 });
      break;
    }
    case 'fluorescent-tube': {
      const tubeLength = Math.max(length, 0.3);
      addPart('housing', new THREE.BoxGeometry(tubeLength + 0.12, 0.07, 0.12), housing, 0, 0.05, 0);
      addPart('tube', new THREE.CylinderGeometry(0.028, 0.028, tubeLength, 12), emissive, 0, 0, 0, {
        z: Math.PI / 2,
      });
      addPart('cap-a', new THREE.CylinderGeometry(0.034, 0.034, 0.04, 12), housing, -tubeLength / 2 - 0.02, 0, 0, {
        z: Math.PI / 2,
      });
      addPart('cap-b', new THREE.CylinderGeometry(0.034, 0.034, 0.04, 12), housing, tubeLength / 2 + 0.02, 0, 0, {
        z: Math.PI / 2,
      });
      break;
    }
    case 'halogen-downlight': {
      addPart('housing', new THREE.CylinderGeometry(0.095, 0.085, 0.05, 16), housing, 0, 0.02, 0);
      addPart('lamp', new THREE.CircleGeometry(0.07, 18), emissive, 0, -0.01, 0, { x: Math.PI / 2 });
      break;
    }
    case 'neon-tube': {
      const tubeLength = Math.max(length, 0.4);
      addPart('rail', new THREE.BoxGeometry(tubeLength + 0.1, 0.05, 0.04), housing, 0, 0.06, 0);
      addPart('tube', new THREE.CylinderGeometry(0.018, 0.018, tubeLength, 10), emissive, 0, 0, 0, {
        z: Math.PI / 2,
      });
      const glow = resources.ownMaterial(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(placement.colorInt),
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      glow.userData = { signage: { role: 'fixture-glow' } };
      addPart('glow', new THREE.CylinderGeometry(0.05, 0.05, tubeLength, 10, 1, true), glow, 0, 0, 0, {
        z: Math.PI / 2,
      });
      break;
    }
    case 'compact-fluorescent': {
      addPart('housing', new THREE.CylinderGeometry(0.1, 0.09, 0.06, 16), housing, 0, 0.03, 0);
      addPart('tube-a', new THREE.CylinderGeometry(0.013, 0.013, 0.16, 8), emissive, -0.035, -0.08, 0);
      addPart('tube-b', new THREE.CylinderGeometry(0.013, 0.013, 0.16, 8), emissive, 0.035, -0.08, 0);
      addPart('diffuser', new THREE.CircleGeometry(0.08, 16), emissive, 0, -0.17, 0, { x: Math.PI / 2 });
      break;
    }
    case 'led-strip': {
      const stripLength = Math.max(length, 0.4);
      addPart('housing', new THREE.BoxGeometry(stripLength, 0.06, 0.09), housing, 0, 0.03, 0);
      addPart('tape', new THREE.PlaneGeometry(stripLength * 0.98, 0.07), emissive, 0, -0.005, 0, {
        x: Math.PI / 2,
      });
      break;
    }
  }

  // A down-facing halo so every fixture reads as a glowing source, not a shape.
  if (placement.kind !== 'neon-tube' && placement.kind !== 'led-strip') {
    const haloMaterial = resources.ownMaterial(
      new THREE.MeshBasicMaterial({
        map: texture(`glow:${placement.colorHex}`, 'glow', () => paintGlowTexture(placement.colorHex, placement.colorInt))
          .texture,
        color: new THREE.Color(placement.colorInt),
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    haloMaterial.userData = { signage: { role: 'fixture-glow' } };
    const halo = new THREE.Mesh(
      resources.ownGeometry(new THREE.PlaneGeometry(0.6, 0.6)),
      haloMaterial,
    );
    halo.name = `${group.name}:halo`;
    halo.position.set(0, -0.05, 0);
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
  }

  let light: THREE.PointLight | null = null;
  if (placement.light) {
    light = new THREE.PointLight(placement.colorInt, placement.intensity, placement.range, 2);
    light.name = `${group.name}:light`;
    light.position.set(0, placement.direction.y < -0.5 ? -0.08 : 0.02, placement.direction.z > 0.5 ? 0.08 : 0);
    group.add(light);
  }

  let shaftMaterial: THREE.MeshBasicMaterial | null = null;
  if (placement.shaft && placement.shaftLength > 0) {
    const geometry = new THREE.ConeGeometry(shaftRadius(placement.kind), placement.shaftLength, 20, 1, true);
    shaftMaterial = resources.ownMaterial(
      new THREE.MeshBasicMaterial({
        map: texture(`shaft:${placement.colorHex}`, 'shaft', () =>
          paintShaftTexture(placement.colorHex, placement.colorInt),
        ).texture,
        color: new THREE.Color(placement.colorInt),
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    shaftMaterial.userData = { signage: { role: 'light-shaft' } };
    const shaft = new THREE.Mesh(resources.ownGeometry(geometry), shaftMaterial);
    shaft.name = `${group.name}:shaft`;
    const direction = new THREE.Vector3(
      -placement.direction.x,
      -placement.direction.y,
      -placement.direction.z,
    ).normalize();
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    shaft.position.set(
      placement.direction.x * (placement.shaftLength / 2),
      placement.direction.y * (placement.shaftLength / 2),
      placement.direction.z * (placement.shaftLength / 2),
    );
    group.add(shaft);
  }

  return Object.freeze({
    group,
    runtime: Object.freeze({
      placement,
      materials: Object.freeze([emissive]),
      baseEmissive: Object.freeze([placement.emissiveIntensity]),
      light,
      baseIntensity: placement.intensity,
      shaftMaterial,
      baseOpacity: shaftMaterial ? 0.22 : 0,
    }),
  });
}

/* -------------------------------------------------------------------------- */
/* Placement validation                                                       */
/* -------------------------------------------------------------------------- */

function insideBounds(bounds: RoomBounds, point: RoomPoint, tolerance = 1e-6): boolean {
  return (
    Math.abs(point.x) <= bounds.width / 2 + tolerance &&
    Math.abs(point.z) <= bounds.depth / 2 + tolerance &&
    point.y >= -tolerance &&
    point.y <= bounds.height + tolerance
  );
}

/**
 * True when `material` is one of the materials this domain marks as a lit
 * surface or light-carrying element (an emissive fixture face, a lit sign face,
 * a sign halo, a fixture glow or a volumetric light shaft). The renderer, the
 * tests and any bloom-free brightness pass can use this instead of guessing from
 * colour values.
 */
export function isEmissiveSignageMaterial(material: THREE.Material): boolean {
  const signage = (material.userData as { signage?: { role?: SignageMaterialRole } }).signage;
  const role = signage?.role;
  if (role === undefined) return false;
  if (role === 'fixture-emissive' || role === 'sign-face') {
    return material instanceof THREE.MeshStandardMaterial && material.emissiveIntensity > 0;
  }
  return role === 'sign-halo' || role === 'fixture-glow' || role === 'light-shaft';
}

/**
 * Independent placement checks a consumer (or the composition test) can run:
 * every sign and fixture the era resolved must sit inside the room the shell
 * published, hang off a real anchor, stay clear of the back-room doorway and
 * respect the documented light budget.
 */
export function signagePlacementProblems(
  signs: readonly SignPlacement[],
  fixtures: readonly FixturePlacement[],
  layout: StructuralLayout,
  bounds: RoomBounds,
  spec?: SignageLightingSpec,
): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const doorway = reservedZoneBox(layout.doorway);
  const anchorIds = new Set<string>([
    ...layout.wallMounts.map((mount) => mount.id),
    ...layout.reservedZones.map((zone) => zone.id),
    ...layout.counterPassSlots.map((slot) => slot.id),
    'back-wall-above-counter',
    'counter-service-face',
  ]);

  for (const sign of signs) {
    if (seen.has(sign.signId)) problems.push(`${sign.signId}: duplicate sign id`);
    seen.add(sign.signId);
    if (!anchorIds.has(sign.anchorId)) problems.push(`${sign.signId}: unknown anchor "${sign.anchorId}"`);
    if (sign.width <= 0 || sign.height <= 0 || sign.depth <= 0) {
      problems.push(`${sign.signId}: non-positive sign size`);
    }
    for (const corner of [
      sign.box.min,
      sign.box.max,
      { x: sign.box.min.x, y: sign.box.min.y, z: sign.box.max.z },
      { x: sign.box.max.x, y: sign.box.max.y, z: sign.box.min.z },
    ]) {
      if (!insideBounds(bounds, corner)) {
        problems.push(`${sign.signId}: sign leaves the room volume`);
        break;
      }
    }
    if (sign.box.min.y <= layout.floorHeight + 0.05) {
      problems.push(`${sign.signId}: sign is planted on the floor`);
    }
    if (sign.box.max.y >= bounds.height - 0.02) {
      problems.push(`${sign.signId}: sign clips the ceiling`);
    }
    if (sign.surface === 'interior-wall' && boxesOverlap(sign.box, doorway)) {
      problems.push(`${sign.signId}: sign blocks the back-room doorway`);
    }
  }

  let lights = 0;
  for (const fixture of fixtures) {
    if (fixture.light) lights += 1;
    if (!insideBounds(bounds, fixture.position)) {
      problems.push(`${fixture.fixtureId}: fixture is outside the room`);
    }
    if (fixture.position.y <= 0.02 || fixture.position.y >= bounds.height) {
      problems.push(`${fixture.fixtureId}: fixture is not between floor and ceiling`);
    }
    if (fixture.shaft && fixture.shaftLength > 0) {
      const base = offsetPoint(fixture.position, fixture.direction, fixture.shaftLength);
      if (!insideBounds(bounds, base)) {
        problems.push(`${fixture.fixtureId}: light shaft leaves the room`);
      }
    }
  }

  const budget = spec?.maxActiveLights ?? LIGHT_BUDGET;
  if (lights > budget) problems.push(`${lights} light objects exceed the era budget of ${budget}`);

  return Object.freeze(problems);
}

/* -------------------------------------------------------------------------- */
/* Module                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The café's signage and lighting: every sign surface and every fixture of the
 * five eras, anchored to the environment shell's room bounds.
 */
export class SignageLightingModule implements SceneModule<SignageLightingSpec> {
  readonly id = SIGNAGE_LIGHTING_MODULE_ID;

  private readonly options: SignageLightingModuleOptions;
  private readonly surfaceCache: SignageSurfaceCache;
  private current: SignageBuild | null = null;
  private phase = 0;
  private updates = 0;
  private litLevelValue = 0;
  private lastDispositionValue: SignageLightingDisposition | null = null;
  private resolvedLayout: StructuralLayout;
  private resolvedBounds: RoomBounds;

  constructor(options: SignageLightingModuleOptions = {}) {
    this.options = options;
    // Five eras of signs and fixture faces: caching the painted surfaces keeps
    // timeline scrubbing from repainting artwork it has already produced.
    this.surfaceCache = new SignageSurfaceCache(48);
    this.resolvedLayout = options.layout ?? STRUCTURAL_LAYOUT;
    this.resolvedBounds = options.bounds ?? this.resolvedLayout.bounds ?? CAFE_ROOM_BOUNDS;
  }

  /* -- SceneModule surface -------------------------------------------------- */

  /** The single `signage-lighting` group, once built. */
  get root(): THREE.Object3D | undefined {
    return this.current?.group;
  }

  /** Era data currently applied. */
  get spec(): SignageLightingSpec | undefined {
    return this.current?.spec;
  }

  /** Structural anchors the current build used (or the configured defaults). */
  get layout(): StructuralLayout {
    return this.current?.layout ?? this.resolvedLayout;
  }

  /** Interior volume the current build used (or the configured defaults). */
  get bounds(): RoomBounds {
    return this.current?.bounds ?? this.resolvedBounds;
  }

  build(context: BuildContext): void {
    this.dispose();
    this.attach(this.createBuild(context.year, context), context);
  }

  applyPeriod(period: PeriodDefinition, context: BuildContext): void {
    const previous = this.current;
    const next = this.createBuild(period.year, context);
    this.attach(next, context);
    if (previous) this.release(previous);
  }

  /**
   * Advances the era's light. Every write lands on an object created at build
   * time: no per-frame allocation, no texture churn, no geometry rebuild.
   */
  update(deltaSeconds: number, _context: UpdateContext): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
    this.phase = (this.phase + delta) % (Math.PI * 2);
    this.updates += 1;
    const build = this.current;
    if (!build) {
      this.litLevelValue = 0;
      return;
    }
    let total = 0;
    for (let index = 0; index < build.runtime.length; index += 1) {
      const entry = build.runtime[index];
      if (!entry) continue;
      const level = flickerLevel(entry.placement.kind, entry.placement.flicker, this.phase, index);
      for (let slot = 0; slot < entry.materials.length; slot += 1) {
        const material = entry.materials[slot];
        if (!material) continue;
        material.emissiveIntensity = (entry.baseEmissive[slot] ?? 0) * level;
      }
      if (entry.light) entry.light.intensity = entry.baseIntensity * level;
      if (entry.shaftMaterial) entry.shaftMaterial.opacity = entry.baseOpacity * level;
      total += level;
    }
    for (let index = 0; index < build.signRuntime.length; index += 1) {
      const entry = build.signRuntime[index];
      if (!entry) continue;
      const level = signLevel(entry.style, this.phase, index);
      for (let slot = 0; slot < entry.materials.length; slot += 1) {
        const material = entry.materials[slot];
        if (!material) continue;
        material.emissiveIntensity = (entry.baseEmissive[slot] ?? 0) * level;
      }
      if (entry.haloMaterial) entry.haloMaterial.opacity = entry.baseHaloOpacity * level;
    }
    this.litLevelValue = build.runtime.length > 0 ? total / build.runtime.length : 0;
  }

  dispose(): void {
    const build = this.current;
    if (!build) return;
    this.release(build);
  }

  getHotspots(): readonly Hotspot[] {
    const build = this.current;
    if (!build) return [];
    const root = build.group;
    const hotspots: Hotspot[] = [];
    for (const sign of build.signs) {
      const anchor = root.getObjectByName(`signage:sign:${sign.signId}`);
      const face = offsetPoint(sign.position, sign.normal, sign.depth / 2);
      hotspots.push({
        id: `signage-${sign.signId}`,
        label: `${sign.label} — “${sign.text}”`,
        description: sign.note,
        position: new THREE.Vector3(face.x, face.y, face.z),
        radius: Math.max(sign.width, sign.height) * 0.6,
        year: build.year,
        moduleId: this.id,
        kind: 'info',
        anchor: anchor ?? undefined,
      });
    }
    for (const fixture of build.fixtures) {
      const anchor = root.getObjectByName(`signage:fixture:${fixture.fixtureId}`);
      hotspots.push({
        id: `signage-${fixture.fixtureId}`,
        label: fixture.label,
        description: fixture.note,
        position: new THREE.Vector3(fixture.position.x, fixture.position.y, fixture.position.z),
        radius: 0.42,
        year: build.year,
        moduleId: this.id,
        kind: 'interactive',
        anchor: anchor ?? undefined,
      });
    }
    return Object.freeze(hotspots);
  }

  /* -- Signage and lighting accessors -------------------------------------- */

  /** Signs of the current era, in hotspot order. */
  get signs(): readonly SignPlacement[] {
    return this.current?.signs ?? [];
  }

  /** Fixtures of the current era, in hotspot order. */
  get fixtures(): readonly FixturePlacement[] {
    return this.current?.fixtures ?? [];
  }

  /** Light objects the current era created (never more than the budget). */
  get lights(): readonly THREE.PointLight[] {
    const build = this.current;
    if (!build) return [];
    const lights: THREE.PointLight[] = [];
    for (const entry of build.runtime) {
      if (entry.light) lights.push(entry.light);
    }
    return Object.freeze(lights);
  }

  /** Emissive materials of every fixture, for diagnostics and the tests. */
  get litMaterials(): readonly THREE.MeshStandardMaterial[] {
    const build = this.current;
    if (!build) return [];
    const materials: THREE.MeshStandardMaterial[] = [];
    for (const entry of build.runtime) {
      for (const material of entry.materials) materials.push(material);
    }
    return Object.freeze(materials);
  }

  /** Resources (geometries, materials, textures) the current build owns. */
  get resources(): SignageResources | undefined {
    return this.current?.resources;
  }

  /** Textures the current build materialised. */
  get textures(): readonly SignageTexture[] {
    return this.current?.textures ?? [];
  }

  /** What the last build or era change released. */
  get disposition(): SignageLightingDisposition | null {
    return this.lastDispositionValue;
  }

  /** Number of light objects currently active. */
  get activeLightCount(): number {
    const build = this.current;
    if (!build) return 0;
    let count = 0;
    for (const entry of build.runtime) {
      if (entry.light) count += 1;
    }
    return count;
  }

  /** Documented light budget, comfortably above every era's own cap. */
  get lightBudget(): number {
    return LIGHT_BUDGET;
  }

  /** Documented draw-call budget: the meshes one era may build. */
  get drawCallBudget(): number {
    return MESH_BUDGET;
  }

  /** Meshes the current era's group contains (one per panel, housing, halo, shaft). */
  get meshCount(): number {
    const build = this.current;
    if (!build) return 0;
    let count = 0;
    build.group.traverse((object) => {
      if (object instanceof THREE.Mesh) count += 1;
    });
    return count;
  }

  /** Per-era exposure and brightness hints the composition root applies. */
  get exposureHints(): SignageLightingExposureHints {
    const build = this.current;
    if (build) return build.exposure;
    const spec = SIGNAGE_LIGHTING_SPECS[this.options.initialYear ?? DEFAULT_YEAR_ID];
    return Object.freeze({
      exposure: spec.exposure,
      nightExposure: spec.nightExposure,
      bloom: spec.bloom,
      colorTemperatureK: spec.colorTemperatureK,
      ambientTint: spec.ambientTint,
      maxActiveLights: spec.maxActiveLights,
      activeLightCount: 0,
    });
  }

  /** Mean bloom-free brightness of the active rig, in `[0, 1]`. */
  get brightnessHint(): number {
    const build = this.current;
    if (!build) return build === null ? SIGNAGE_LIGHTING_SPECS[this.options.initialYear ?? DEFAULT_YEAR_ID].bloom : 0;
    let weighted = 0;
    let weight = 0;
    for (const fixture of build.fixtures) {
      if (!fixture.light) continue;
      weighted += fixture.brightness * fixture.emissiveIntensity;
      weight += fixture.emissiveIntensity;
    }
    const mean = weight > 0 ? weighted / weight : build.spec.bloom;
    return clamp01(mean * (0.6 + build.spec.bloom * 0.8));
  }

  /** Mean emissive strength of the fixture faces, for the exposure sanity check. */
  get litSurfaceIntensity(): number {
    const materials = this.litMaterials;
    if (materials.length === 0) return 0;
    let total = 0;
    for (const material of materials) total += material.emissiveIntensity;
    return total / materials.length;
  }

  /** Mean per-frame flicker multiplier applied by the last {@link update}. */
  get litLevel(): number {
    return this.litLevelValue;
  }

  /** Number of times {@link SceneModule.update} has run. */
  get updateCount(): number {
    return this.updates;
  }

  /** Era currently applied, even before the first build. */
  get year(): YearId {
    return this.current?.year ?? this.options.initialYear ?? DEFAULT_YEAR_ID;
  }

  /** The era's flat inventory row (usable without reading into scene objects). */
  get inventory(): SignageLightingInventory {
    return describeSignageLightingSpec(SIGNAGE_LIGHTING_SPECS[this.year]);
  }

  /** Where the era's faces came from. */
  get textureSource(): 'canvas' | 'data' | 'mixed' | 'none' {
    const textures = this.textures;
    if (textures.length === 0) return 'none';
    const sources = new Set(textures.map((entry) => entry.source));
    return sources.size === 1 ? (textures[0]?.source ?? 'none') : 'mixed';
  }

  /** True when every texture the current build owns came from the painters. */
  get proceduralOnly(): boolean {
    const build = this.current;
    if (!build) return true;
    return build.textures.every((entry) => isProceduralSignageTexture(entry.texture));
  }

  /** Structural fingerprint of the era's signage and rig, for the transition engine. */
  get signature(): string {
    const build = this.current;
    if (!build) return `${this.year}:unbuilt`;
    const signs = build.signs.map((sign) => `${sign.signId}=${sign.style}@${sign.width.toFixed(2)}x${sign.height.toFixed(2)}`).join('|');
    const fixtures = build.fixtures
      .map((fixture) => `${fixture.fixtureId}=${fixture.kind}:${fixture.colorTemperatureK}K`)
      .join('|');
    return `${build.year}:${signs}#${fixtures}`;
  }

  /** Independent placement problems of the current era (empty when composed well). */
  get placementProblems(): readonly string[] {
    const build = this.current;
    if (!build) return [];
    return signagePlacementProblems(build.signs, build.fixtures, build.layout, build.bounds, build.spec);
  }

  /** Close-up framing for one sign, or `null` when it is not on the wall. */
  signFocus(signId: string): SignFocusFraming | null {
    const build = this.current;
    if (!build) return null;
    const placement = build.signs.find((entry) => entry.signId === signId);
    if (!placement) return null;
    const face = offsetPoint(placement.position, placement.normal, placement.depth / 2);
    const distance = Math.min(Math.max(Math.max(placement.width, placement.height) * 1.1, 0.6), 1.6);
    return Object.freeze({
      signId,
      label: placement.label,
      year: build.year,
      target: Object.freeze({ ...face }),
      direction: Object.freeze({ ...placement.normal }),
      eye: Object.freeze(offsetPoint(face, placement.normal, distance)),
      distance,
      radius: Math.max(placement.width, placement.height) * 0.6,
    });
  }

  /** Diagnostics snapshot for the overlay, the registry and the tests. */
  describe(): SignageLightingDescription {
    const build = this.current;
    const spec = build?.spec ?? SIGNAGE_LIGHTING_SPECS[this.options.initialYear ?? DEFAULT_YEAR_ID];
    const counts = build?.resources.counts;
    return Object.freeze({
      moduleId: this.id,
      year: spec.year,
      built: build !== null,
      signCount: build?.signs.length ?? 0,
      fixtureCount: build?.fixtures.length ?? 0,
      lightCount: this.activeLightCount,
      hotspotCount: (build?.signs.length ?? 0) + (build?.fixtures.length ?? 0),
      styles: Object.freeze([...new Set((build?.signs ?? []).map((sign) => sign.style))]),
      materials: Object.freeze([...new Set((build?.signs ?? []).map((sign) => sign.material))]),
      fixtureKinds: Object.freeze([...new Set((build?.fixtures ?? []).map((fixture) => fixture.kind))]),
      colorTemperatureK: spec.colorTemperatureK,
      exposure: spec.exposure,
      nightExposure: spec.nightExposure,
      bloom: spec.bloom,
      brightnessHint: this.brightnessHint,
      textureCount: counts?.textures ?? 0,
      materialCount: counts?.materials ?? 0,
      geometryCount: counts?.geometries ?? 0,
      surfaceCount: counts?.surfaces ?? 0,
      textureSource: this.textureSource,
      proceduralOnly: this.proceduralOnly,
      placementProblems: this.placementProblems,
      rejected: build?.rejected ?? [],
      inventory: describeSignageLightingSpec(spec),
    });
  }

  /* -- Internals ----------------------------------------------------------- */

  /** Resolves the room from the environment shell, the options or the contract. */
  private resolveShell(context: BuildContext): { bounds: RoomBounds; layout: StructuralLayout } {
    const shell = readShell(context);
    if (shell) return shell;
    const bounds = this.options.bounds ?? context.bounds ?? CAFE_ROOM_BOUNDS;
    const explicit = this.options.layout;
    if (explicit) {
      return roomBoundsEqual(explicit.bounds, bounds) ? { bounds, layout: explicit } : { bounds: explicit.bounds, layout: explicit };
    }
    if (roomBoundsEqual(bounds, STRUCTURAL_LAYOUT.bounds)) {
      return { bounds, layout: STRUCTURAL_LAYOUT };
    }
    return { bounds, layout: createStructuralLayout(bounds) };
  }

  private createBuild(year: YearId, context: BuildContext): SignageBuild {
    const { bounds, layout } = this.resolveShell(context);
    this.resolvedBounds = bounds;
    this.resolvedLayout = layout;
    const spec = SIGNAGE_LIGHTING_SPECS[year];
    const resources = new SignageResources();
    const group = new THREE.Group();
    group.name = SIGNAGE_LIGHTING_GROUP_NAME;

    const canvasFactory = this.options.canvasFactory;
    const anisotropy = this.options.anisotropy;
    const pixelsPerMetre = this.options.texturePixelsPerMetre ?? DEFAULT_SIGN_PIXELS_PER_METRE;
    const textures: SignageTexture[] = [];
    const textureCache = new Map<string, SignageTexture>();
    const texture: TextureFactory = (key, kind, paint) => {
      const found = textureCache.get(key);
      if (found) return found;
      const surface = resources.ownSurface(paint());
      const created = createSignageTexture(surface, { key, kind, canvasFactory, anisotropy });
      resources.ownTexture(created.texture);
      textureCache.set(key, created);
      textures.push(created);
      return created;
    };

    const signs: SignPlacement[] = [];
    const rejected: string[] = [];
    const signRuntime: SignRuntime[] = [];
    for (const signSpec of spec.signs) {
      const placement = resolveSignPlacement(signSpec, layout, bounds, year);
      if (!placement) {
        rejected.push(`${signSpec.id}: anchor "${signSpec.anchor}" is not available in this shell`);
        continue;
      }
      signs.push(placement);
      const faceKey = `${placement.textureKey}:${placement.width.toFixed(2)}x${placement.height.toFixed(2)}`;
      let surface = this.surfaceCache.get(faceKey);
      if (!surface) {
        surface = paintSignFace({
          year,
          signId: signSpec.id,
          style: signSpec.style,
          text: signSpec.text,
          secondaryText: signSpec.secondaryText,
          baseColor: signSpec.baseColor,
          letterColor: signSpec.letterColor,
          glowColor: signSpec.glowColor,
          backlit: signSpec.backlit,
          width: placement.width,
          height: placement.height,
          pixelsPerMetre,
          seed: seedFor(year, signSpec.id),
        });
        this.surfaceCache.set(faceKey, surface);
      }
      resources.ownSurface(surface);
      const faceTexture = createSignageTexture(surface, {
        key: faceKey,
        kind: 'sign',
        canvasFactory,
        anisotropy,
      });
      resources.ownTexture(faceTexture.texture);
      textures.push(faceTexture);
      const glow = placement.backlit
        ? texture(`glow:${signSpec.glowColor}`, 'glow', () =>
            paintGlowTexture(signSpec.glowColor, rgbToInt(parseColor(signSpec.glowColor))),
          )
        : null;
      const assembly = buildSignAssembly(placement, bounds, faceTexture, glow, resources);
      group.add(assembly.group);
      signRuntime.push(assembly.runtime);
    }

    const fixtures: FixturePlacement[] = [];
    const runtime: FixtureRuntime[] = [];
    const lightBudget = Math.max(Math.trunc(spec.maxActiveLights), 0);
    let lightsPlaced = 0;
    for (const fixtureSpec of spec.fixtures) {
      const anchors = resolveFixtureAnchors(fixtureSpec, layout, bounds);
      for (let index = 0; index < anchors.length; index += 1) {
        const anchor = anchors[index];
        if (!anchor) continue;
        const useLight = lightsPlaced < lightBudget;
        if (useLight) lightsPlaced += 1;
        const placement = createFixturePlacement(fixtureSpec, anchor, index, bounds, useLight);
        fixtures.push(placement);
        const assembly = buildFixtureAssembly(placement, resources, texture);
        group.add(assembly.group);
        runtime.push(assembly.runtime);
      }
    }

    const exposure: SignageLightingExposureHints = Object.freeze({
      exposure: spec.exposure,
      nightExposure: spec.nightExposure,
      bloom: spec.bloom,
      colorTemperatureK: spec.colorTemperatureK,
      ambientTint: spec.ambientTint,
      maxActiveLights: spec.maxActiveLights,
      activeLightCount: lightsPlaced,
    });

    return Object.freeze({
      year,
      spec,
      group,
      resources,
      signs: Object.freeze(signs),
      fixtures: Object.freeze(fixtures),
      runtime: Object.freeze(runtime),
      signRuntime: Object.freeze(signRuntime),
      textures: Object.freeze(textures),
      bounds,
      layout,
      rejected: Object.freeze(rejected),
      exposure,
    });
  }

  private attach(build: SignageBuild, context: BuildContext): void {
    const root = context.root;
    if (root) root.add(build.group);
    this.current = build;
  }

  private release(build: SignageBuild): void {
    build.group.removeFromParent();
    build.group.clear();
    const released = build.resources.dispose();
    this.lastDispositionValue = Object.freeze({
      ...released,
      signs: build.signs.length,
      fixtures: build.fixtures.length,
    });
    if (this.current === build) {
      this.current = null;
      this.phase = 0;
      this.litLevelValue = 0;
    }
  }
}

/** Deterministic painter seed for one era's sign. */
function seedFor(year: YearId, signId: string): number {
  let hash = 0x811c9dc5;
  const key = `${year}:${signId}`;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Convenience factory mirroring `createEnvironmentModule` / `createPosterModule`. */
export function createSignageLightingModule(
  options: SignageLightingModuleOptions = {},
): SignageLightingModule {
  return new SignageLightingModule(options);
}
