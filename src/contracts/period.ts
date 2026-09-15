/**
 * Café era contracts — the frozen foundation every other module compiles against.
 *
 * The application is a single 3D café interior whose every detail is transformed
 * between the years 1945, 1965, 1985, 2005 and 2025 by a timeline slider. This
 * module owns the vocabulary for that transformation:
 *
 *  - {@link YearId} / {@link YEAR_IDS} — the five eras and their order,
 *  - {@link PeriodDefinition} — one era's palette, lighting and prose,
 *  - {@link DomainSpecBase} — shared shape of the per-era specs domain modules hold,
 *  - {@link SceneModule} — the surface every domain module implements,
 *  - {@link BuildContext}, {@link RoomBounds}, {@link Hotspot} — the shared
 *    structures modules build against and expose.
 *
 * The declarations here are frozen: thirteen downstream tasks compile against
 * them, so later work may only add to them, never reshape them. Keeping this
 * module import-light (types plus pure helpers, no side effects) lets it be
 * consumed from the browser bundle, node test suites and tooling alike.
 */

import type * as THREE from 'three';

/* -------------------------------------------------------------------------- */
/* Years                                                                      */
/* -------------------------------------------------------------------------- */

/** The five eras the timeline can display, in chronological order. */
export const YEAR_IDS = ['1945', '1965', '1985', '2005', '2025'] as const;

/** Identifier of one of the five café eras. */
export type YearId = (typeof YEAR_IDS)[number];

/** Era shown before the timeline moves the scene. */
export const DEFAULT_YEAR_ID: YearId = '1945';

const YEAR_ID_LOOKUP: ReadonlySet<string> = new Set<string>(YEAR_IDS);

/** Runtime narrowing helper: is `value` one of the five era identifiers? */
export function isYearId(value: unknown): value is YearId {
  return typeof value === 'string' && YEAR_ID_LOOKUP.has(value);
}

/** Position of `year` in the chronological timeline (0 based). */
export function yearIndex(year: YearId): number {
  return YEAR_IDS.indexOf(year);
}

/** The era at `index`, clamped to the ends of the timeline. */
export function yearAt(index: number): YearId {
  const clamped = Math.min(Math.max(Math.trunc(index), 0), YEAR_IDS.length - 1);
  const year: YearId | undefined = Number.isFinite(clamped) ? YEAR_IDS[clamped] : undefined;
  if (year === undefined) {
    throw new RangeError(`Era index ${index} is out of range (expected 0..${YEAR_IDS.length - 1}).`);
  }
  return year;
}

/** The next era, clamped at 2025. */
export function nextYearId(year: YearId): YearId {
  return yearAt(yearIndex(year) + 1);
}

/** The previous era, clamped at 1945. */
export function previousYearId(year: YearId): YearId {
  return yearAt(yearIndex(year) - 1);
}

/** Numeric form of an era (`'1985'` -> `1985`), handy for seeds and interpolation. */
export function yearToNumber(year: YearId): number {
  return Number.parseInt(year, 10);
}

/**
 * Strict narrowing helper: returns the era for `value`, accepting the string
 * form as well as an integer year (`1985`), and throws for anything else.
 */
export function parseYearId(value: unknown): YearId {
  if (isYearId(value)) return value;
  if (typeof value === 'number' && Number.isInteger(value) && isYearId(String(value))) {
    return String(value) as YearId;
  }
  throw new TypeError(
    `"${String(value)}" is not a supported café era. Expected one of: ${YEAR_IDS.join(', ')}.`,
  );
}

/** Lenient narrowing helper: falls back to `fallback` instead of throwing. */
export function toYearId(value: unknown, fallback: YearId = DEFAULT_YEAR_ID): YearId {
  if (isYearId(value)) return value;
  if (typeof value === 'number' && Number.isInteger(value) && isYearId(String(value))) {
    return String(value) as YearId;
  }
  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Room geometry                                                              */
/* -------------------------------------------------------------------------- */

/** Axis aligned point in metres, scene space. */
export interface RoomPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Interior dimensions of the café room, in metres, centred on the origin. */
export interface RoomBounds {
  /** Interior width along X. */
  readonly width: number;
  /** Interior depth along Z. */
  readonly depth: number;
  /** Interior height along Y. */
  readonly height: number;
}

/** Default café footprint shared by the milestone room and the environment shell. */
export const DEFAULT_ROOM_BOUNDS: RoomBounds = Object.freeze({
  width: 9,
  depth: 11,
  height: 3.6,
});

/** Centre of the room volume. */
export function roomCenter(bounds: RoomBounds): RoomPoint {
  return { x: 0, y: bounds.height / 2, z: 0 };
}

/** True when the ground plane position (`x`, `z`) lies inside the room minus `margin`. */
export function isInsideRoom(bounds: RoomBounds, x: number, z: number, margin = 0): boolean {
  return (
    Math.abs(x) <= bounds.width / 2 - margin && Math.abs(z) <= bounds.depth / 2 - margin
  );
}

/* -------------------------------------------------------------------------- */
/* Hotspots                                                                   */
/* -------------------------------------------------------------------------- */

/** How a hotspot should be presented by the HUD/inspection overlay. */
export type HotspotKind = 'info' | 'interactive' | 'transition';

/**
 * Interactive affordance exposed by a {@link SceneModule} for the active era,
 * used by later HUD/overlay tasks to explain and navigate the scene.
 */
export interface Hotspot {
  /** Stable identifier, unique across the scene. */
  readonly id: string;
  /** Short human readable name. */
  readonly label: string;
  /** Optional longer explanation shown when the hotspot is selected. */
  readonly description?: string;
  /** World space position (metres). */
  readonly position: THREE.Vector3;
  /** Hit radius in metres. */
  readonly radius: number;
  /** Era the hotspot belongs to; omit for hotspots that exist in every era. */
  readonly year?: YearId;
  /** Id of the module that owns the hotspot. */
  readonly moduleId?: string;
  /** Presentation hint for the overlay. */
  readonly kind?: HotspotKind;
  /** When set, the overlay should follow this object instead of `position`. */
  readonly anchor?: THREE.Object3D;
}

/* -------------------------------------------------------------------------- */
/* Period definitions                                                         */
/* -------------------------------------------------------------------------- */

/** Era palette. Values are CSS colour strings so DOM overlays and three.js share them. */
export interface PeriodPalette {
  /** Scene clear colour / page backdrop. */
  readonly background: string;
  readonly floor: string;
  readonly wall: string;
  readonly ceiling: string;
  /** Secondary colour for trim, upholstery and props. */
  readonly accent: string;
  /** Colour of the era's light fixtures (used for emissive parts). */
  readonly lamp: string;
}

/** Era lighting recipe applied by the lighting domain module. */
export interface PeriodLighting {
  readonly ambientColor: string;
  readonly ambientIntensity: number;
  readonly keyColor: string;
  readonly keyIntensity: number;
  readonly fillColor: string;
  readonly fillIntensity: number;
  readonly lampColor: string;
  readonly lampIntensity: number;
  /** Exponential fog density for era haze; `0` disables fog. */
  readonly fogDensity: number;
}

/** One era of the café: its palette, light recipe and editorial description. */
export interface PeriodDefinition {
  /** Era this definition describes. */
  readonly year: YearId;
  /** Short label for the timeline (`'1945'`). */
  readonly label: string;
  /** Era name (`'Post-war austerity'`). */
  readonly name: string;
  /** One or two sentences of context for the overlay. */
  readonly summary: string;
  readonly palette: PeriodPalette;
  readonly lighting: PeriodLighting;
  /** Era signifiers used by tooling and the milestone readout. */
  readonly details: readonly string[];
}

/** Runtime guard for period definitions handed over by the registry. */
export function isPeriodDefinition(value: unknown): value is PeriodDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isYearId(candidate['year']) &&
    typeof candidate['label'] === 'string' &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['summary'] === 'string' &&
    typeof candidate['palette'] === 'object' &&
    candidate['palette'] !== null &&
    typeof candidate['lighting'] === 'object' &&
    candidate['lighting'] !== null &&
    Array.isArray(candidate['details'])
  );
}

/* -------------------------------------------------------------------------- */
/* Domain specs                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Base shape of the per-era data a domain module holds (furniture lists,
 * material recipes, patron wardrobes, ...). Domain specs add fields, they never
 * remove these.
 */
export interface DomainSpecBase {
  /** Era the spec describes. */
  readonly year: YearId;
  /** Optional display name for diagnostics and overlays. */
  readonly label?: string;
  /** Free-form tags (`'bakelite'`, `'formica'`, ...). */
  readonly tags?: readonly string[];
  /** Longer notes / research references for the era. */
  readonly notes?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Scene modules                                                              */
/* -------------------------------------------------------------------------- */

/** Per-frame context handed to every module through {@link SceneModule.update}. */
export interface UpdateContext {
  /** Era currently displayed. */
  readonly year: YearId;
  /** Seconds simulated since the kernel started. */
  readonly elapsedSeconds: number;
  /** Monotonic frame counter since the kernel started. */
  readonly frame: number;
}

/**
 * Everything a module needs while building. The composition layer (or the
 * kernel's `createBuildContext`) creates one per era.
 */
export interface BuildContext {
  /** Scene currently rendering. */
  readonly scene: THREE.Scene;
  /** Node the module attaches its own objects to. */
  readonly root: THREE.Object3D;
  /** Main camera, for modules that face procedural detail towards the viewer. */
  readonly camera: THREE.Camera;
  /** Room the café is laid out in. */
  readonly bounds: RoomBounds;
  /** Era being built (mirrors `period.year`). */
  readonly year: YearId;
  /** Full definition of the era being built. */
  readonly period: PeriodDefinition;
  /** Deterministic random source in `[0, 1)` for procedural placement. */
  readonly random: () => number;
  /** Shared services supplied by the composition layer. */
  readonly services?: Readonly<Record<string, unknown>>;
}

/**
 * The surface every domain module implements. It is intentionally small: ten
 * domain modules, the period registry and the composition layer all implement
 * or drive exactly these five methods.
 */
export interface SceneModule<TSpec extends DomainSpecBase = DomainSpecBase> {
  /** Stable identifier, unique across the scene (registry key and hotspot owner id). */
  readonly id: string;
  /** Optional era data the module is currently showing (useful for diagnostics). */
  readonly spec?: TSpec;
  /** Optional node the module owns, once {@link SceneModule.build} has run. */
  readonly root?: THREE.Object3D;
  /** Create the module's objects and resources for the era in `context`. */
  build(context: BuildContext): void;
  /** Re-apply every era specific visual and behaviour in place when the timeline moves. */
  applyPeriod(period: PeriodDefinition, context: BuildContext): void;
  /** Advance time based state (animation, ambience, particles). */
  update(deltaSeconds: number, context: UpdateContext): void;
  /** Release GPU/audio/DOM resources. Must be safe to call more than once. */
  dispose(): void;
  /** Affordances the overlay may present for the active era. */
  getHotspots(): readonly Hotspot[];
}

/** Runtime guard used by the registry to reject malformed module implementations. */
export function isSceneModule(value: unknown): value is SceneModule {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['build'] === 'function' &&
    typeof candidate['applyPeriod'] === 'function' &&
    typeof candidate['update'] === 'function' &&
    typeof candidate['dispose'] === 'function' &&
    typeof candidate['getHotspots'] === 'function'
  );
}
