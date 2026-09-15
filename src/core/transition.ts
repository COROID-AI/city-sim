/**
 * Period transition — the in-place choreography that transforms the café when
 * the timeline selects a new era.
 *
 * The engine is the single writer of the transformation *timing*. It owns no
 * era content: given a target {@link YearId} it resolves the era through the
 * period registry, orders the registered scene modules by their distance from
 * the active camera and drives a deterministic, step-based choreography over
 * them plus the café audio engine:
 *
 *  - **Anticipation** — signage and screen surfaces start to flicker and the
 *    audio sweep opens.
 *  - **Staggered swaps** — each module is blended out (opacity dip and a small
 *    scale dip on its own root), swapped with `SceneModule.applyPeriod` at the
 *    trough of the dip — which is where the module's geometry, materials and
 *    procedural canvas textures change — and blended back in. Near props change
 *    first so the transformation ripples away from the viewer.
 *  - **Lighting ramp** — every light the modules expose ramps its colour
 *    temperature and intensity from the source era's recipe to the target era's
 *    recipe (tilted by the two eras' palette luminance so a dim era really is
 *    dimmer), and lit signage/screen materials flicker through the change.
 *  - **Audio crossfade** — the music programme and the era mix (which carries
 *    the machine character) are crossfaded on the audio engine's buses with a
 *    filter sweep across the music bus. The engine never unlocks audio: before
 *    the user gesture it only installs descriptors.
 *  - **Arrival** — the era caption (name and historical note from the target
 *    `PeriodDefinition`) is published and a subtle camera micro-move peaks and
 *    settles back to the viewer's prior framing.
 *
 * Contract properties the tests and the composition root rely on:
 *
 *  - **Deterministic** — every value is a pure function of the option set and
 *    the stepped clock; no wall clock, no `Math.random`. Stepping the same
 *    fixed delta schedule twice yields identical progress, ordering and end
 *    state.
 *  - **Interruptible** — a year selection issued mid-flight supersedes the
 *    pending choreography and re-plans from the state the scene has actually
 *    reached: every module's current era and blend value, the lighting colour
 *    and intensity the ramp had arrived at, and the framing the camera
 *    micro-move was holding. It ends at the newly selected era with no orphaned
 *    or duplicated nodes.
 *  - **Reduced motion** — `prefers-reduced-motion: reduce` (or an explicit
 *    option) resolves a selection to an immediate swap that still applies the
 *    full target period state and audio programme.
 *  - **Leaves nothing behind** — blending is applied in place and restored at
 *    each module's window end, the camera is restored exactly, no scene node is
 *    ever created by the engine, and the audio subscription it opens is closed
 *    on arrival and on dispose.
 *
 * The engine reads the frozen era contracts, the period registry, the audio
 * descriptor vocabulary and the domain music programme tables; it never edits
 * them, and application wiring (slider binding, module instantiation, frame
 * pumping) belongs to `app-composition`.
 */

import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  isYearId,
  type BuildContext,
  type PeriodDefinition,
  type SceneModule,
  type YearId,
} from '../contracts/period';
import type {
  AmbienceSpecInput,
  AudioEngineState,
  AudioMixState,
  AudioTransitionPlan,
  AudioYearProvider,
  BusId,
  EraMixInput,
  MachineTriggerRecord,
  MusicProgramInput,
} from '../audio';
/*
 * Default era source: the period registry, loaded lazily.
 *
 * The registry aggregates all ten domain modules, so an eager import would make
 * every consumer of this engine evaluate the entire domain graph. The lazy form
 * keeps the engine importable on its own — tooling, headless suites and
 * alternative scenes that inject their own `resolvePeriod` — and, when the
 * registry is unavailable, fails at the point a period is actually resolved with
 * an actionable message instead of at import time.
 */
let registryLookup: ((year: YearId) => PeriodDefinition) | null = null;
try {
  const registry = await import('../data/periodRegistry');
  registryLookup = registry.resolvePeriod;
} catch (error) {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[cafe-period-transition] the period registry could not be loaded', error);
  }
}

/** Resolves an era through the registry, or throws when it is unavailable. */
function defaultResolvePeriod(year: YearId): PeriodDefinition {
  if (registryLookup === null) {
    throw new Error(
      'The period transition engine has no period source: the period registry could not be ' +
        'loaded and no `resolvePeriod` was supplied.',
    );
  }
  return registryLookup(year);
}
import { eraMusicMix, musicProgram } from '../domains/music/MusicSourceModule';

/* -------------------------------------------------------------------------- */
/* Identity and tuning                                                        */
/* -------------------------------------------------------------------------- */

/** Stable identifier of the composed transition runtime. */
export const PERIOD_TRANSITION_ID = 'cafe-period-transition';

/** Outline interface this module publishes (`cafe-transition`). */
export const PERIOD_TRANSITION_INTERFACE = 'cafe-transition';

/** Default length of one full choreography, seconds. */
export const DEFAULT_TRANSITION_DURATION_SECONDS = 2.6;

/** Default delay between two consecutive module swaps, seconds. */
export const DEFAULT_STAGGER_SECONDS = 0.14;

/** Default length of one module's blend-out/swap/blend-in window, seconds. */
export const DEFAULT_MODULE_WINDOW_SECONDS = 0.55;

/** Minimum opacity at the trough of a module blend. */
export const DEFAULT_BLEND_FLOOR = 0.18;

/** Scale multiplier at the trough of a module blend. */
export const DEFAULT_BLEND_SCALE = 0.94;

/** Default amplitude of the camera micro-move, metres. */
export const DEFAULT_CAMERA_MICRO_MOVE_METRES = 0.07;

/** Default flicker amplitude applied to lit signage/screen materials. */
export const DEFAULT_FLICKER_STRENGTH = 0.32;

/** Default crossfade the audio engine applies to programme and mix, seconds. */
export const DEFAULT_AUDIO_CROSSFADE_SECONDS = 1.2;

/** Upper bound applied to a single stepped delta, seconds. */
export const MAX_TRANSITION_STEP_SECONDS = 0.25;

/** Bus whose filter the transition sweeps across the crossfade. */
const SWEEP_BUS: BusId = 'music';

/* -------------------------------------------------------------------------- */
/* Public types                                                              */
/* -------------------------------------------------------------------------- */

/** Lifecycle of the engine. */
export type TransitionStatus = 'settled' | 'transitioning' | 'disposed';

/** Stage of the choreography currently being played. */
export type TransitionPhase = 'anticipation' | 'swapping' | 'arrival' | 'settled' | 'disposed';

/** How one switch ended. */
export type TransitionOutcome = 'arrived' | 'superseded' | 'disposed';

/** Resolved result of one {@link PeriodTransition.requestYear} call. */
export interface TransitionSignal {
  /** Era that was requested. */
  readonly requestedYear: YearId;
  /** How the switch ended. */
  readonly outcome: TransitionOutcome;
  /** Era the switch started from, when known. */
  readonly fromYear: YearId | null;
  /** Era every module reported when the signal resolved (`null` if superseded). */
  readonly settledYear: YearId | null;
  /** Era that superseded this switch, when it was interrupted. */
  readonly supersededBy: YearId | null;
  /** Seconds of choreography the switch played (or `0` for an instant swap). */
  readonly elapsedSeconds: number;
  /** Engine step counter when the signal resolved. */
  readonly steps: number;
}

/**
 * Promise returned for every switch. It is a plain `Promise<TransitionSignal>`
 * carrying the requested year synchronously, so callers can both `await` it and
 * tag it without waiting.
 */
export interface CompletionSignal extends Promise<TransitionSignal> {
  readonly requestedYear: YearId;
}

/** Era caption published on arrival. */
export interface TransitionCaption {
  readonly year: YearId;
  readonly label: string;
  /** Era name from the target {@link PeriodDefinition}. */
  readonly name: string;
  /** Historical note (the definition's summary) for the arrived era. */
  readonly note: string;
}

/** What one module is doing in the current (or last) choreography. */
export interface TransitionModuleState {
  readonly id: string;
  /** Position in the composition order the engine was given. */
  readonly index: number;
  /** Swap order: `0` is the module nearest the camera. */
  readonly order: number;
  /** Distance from the camera to the module's bounds, metres. */
  readonly distance: number;
  readonly fromYear: YearId | null;
  readonly toYear: YearId;
  readonly needsSwap: boolean;
  /** Plan time the module's blend window opens, seconds. */
  readonly swapAtSeconds: number;
  /** Length of the module's blend window, seconds. */
  readonly windowSeconds: number;
  /** True once `applyPeriod` ran for the target era. */
  readonly applied: boolean;
  /** Current blend envelope: `1` is fully visible, the floor is fully blended out. */
  readonly blend: number;
  /** Era the module currently reports, read from its live spec. */
  readonly reportedYear: YearId | null;
}

/** State of one light the engine is ramping. */
export interface TransitionLightState {
  readonly id: string;
  readonly kind: string;
  /** Current colour as an sRGB hex string. */
  readonly color: string;
  readonly intensity: number;
  readonly sourceIntensity: number;
  readonly targetIntensity: number;
}

/** State of the audio crossfade. */
export interface TransitionAudioState {
  readonly attached: boolean;
  /** True while the engine still waits for the user gesture. */
  readonly locked: boolean;
  /** True once the target descriptors were installed. */
  readonly started: boolean;
  readonly crossfadeSeconds: number;
  /** Sweep progress, `0..1`. */
  readonly sweep: number;
  readonly sourceToneHz: number;
  readonly targetToneHz: number;
  readonly programId: string | null;
  readonly mixId: string | null;
  readonly machineCharacterId: string | null;
  /** Audio subscription callbacks the engine currently holds. */
  readonly listeners: number;
  /** Machine one-shots observed while the subscription was open. */
  readonly machineCues: number;
}

/** State of the camera micro-move. */
export interface TransitionCameraState {
  readonly microMove: number;
  readonly offset: { readonly x: number; readonly y: number; readonly z: number };
  readonly settled: boolean;
}

/** Plain, comparable snapshot of the whole engine. */
export interface TransitionSnapshot {
  readonly id: string;
  readonly status: TransitionStatus;
  readonly phase: TransitionPhase;
  readonly reducedMotion: boolean;
  readonly fromYear: YearId | null;
  readonly targetYear: YearId | null;
  readonly settledYear: YearId | null;
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly progress: number;
  readonly steps: number;
  readonly swapsApplied: number;
  /** Scene nodes created and owned by the engine (always `0`: blending is in place). */
  readonly ownedNodes: number;
  readonly caption: TransitionCaption | null;
  readonly modules: readonly TransitionModuleState[];
  readonly lights: readonly TransitionLightState[];
  readonly audio: TransitionAudioState;
  readonly camera: TransitionCameraState;
}

/* -------------------------------------------------------------------------- */
/* Consumer ports                                                            */
/* -------------------------------------------------------------------------- */

/** Build options forwarded to the host for each `applyPeriod` call. */
export interface TransitionBuildOptions {
  readonly root?: THREE.Object3D;
  readonly services?: Readonly<Record<string, unknown>>;
  readonly random?: () => number;
}

/** Read-only camera pose the engine samples and restores. */
export interface TransitionCameraRig {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
}

/**
 * The scene runtime the engine is composed against. `Kernel` satisfies it
 * structurally: it exposes the camera, the current era, the camera rig and the
 * build-context factory every `SceneModule` is applied with.
 */
export interface TransitionHost {
  readonly camera: THREE.Camera;
  /** Era the host currently reports; used as the default starting era. */
  readonly year?: YearId;
  readonly cameraRig?: TransitionCameraRig;
  createBuildContext(period: PeriodDefinition, options?: TransitionBuildOptions): BuildContext;
}

/**
 * The slice of the café audio engine the transition drives. `AudioEngine`
 * satisfies it structurally; the port keeps the choreography free of a private
 * audio graph and lets tests observe the crossfade without a browser.
 */
export interface TransitionAudioTarget {
  readonly state?: AudioEngineState;
  readonly isLocked?: boolean;
  readonly crossfadeSeconds?: number;
  transitionTo?(plan: AudioTransitionPlan): void;
  applyMix?(mix: EraMixInput, options?: { seconds?: number }): unknown;
  setMusicProgram?(
    program: MusicProgramInput | null,
    options?: { crossfadeSeconds?: number },
  ): void;
  setBusTone?(bus: BusId, hertz: number, seconds?: number): void;
  getMixState?(): AudioMixState;
  onMachineTrigger?(listener: (record: MachineTriggerRecord) => void): () => void;
}

/** Configuration of {@link createPeriodTransition}. */
export interface PeriodTransitionOptions {
  /** Scene modules to choreograph, in composition order. */
  readonly modules: readonly SceneModule[];
  /** Kernel-like runtime supplying build contexts, the camera and its rig. */
  readonly host: TransitionHost;
  /** Audio engine to crossfade on; omit for a silent scene. */
  readonly audio?: TransitionAudioTarget | null;
  /** Per-era programme/mix source; defaults to the music domain's tables. */
  readonly audioProvider?: AudioYearProvider | null;
  /** Period lookup; defaults to {@link resolvePeriod} from the period registry. */
  readonly resolvePeriod?: (year: YearId) => PeriodDefinition;
  /** Era the scene shows before the first selection. */
  readonly initialYear?: YearId;
  /** Length of one full choreography, seconds. */
  readonly durationSeconds?: number;
  /** Delay between consecutive module swaps, seconds. */
  readonly staggerSeconds?: number;
  /** Length of one module's blend window, seconds. */
  readonly moduleWindowSeconds?: number;
  /** Opacity at the trough of a module blend, `0..1`. */
  readonly blendFloor?: number;
  /** Scale multiplier at the trough of a module blend. */
  readonly swapScale?: number;
  /** Fraction of the timeline at which the caption publishes. */
  readonly captionAt?: number;
  /** Amplitude of the camera micro-move, metres. */
  readonly cameraMicroMove?: number;
  /** Crossfade asked of the audio engine, seconds. */
  readonly audioCrossfadeSeconds?: number;
  /** Flicker amplitude for lit signage/screen materials. */
  readonly flicker?: number;
  /** `'auto'` (default) follows `prefers-reduced-motion`; `true` forces a swap. */
  readonly reducedMotion?: boolean | 'auto';
  /** Seed of the deterministic flicker noise. */
  readonly seed?: number;
  /** Shared services forwarded to every module `applyPeriod` context. */
  readonly services?: Readonly<Record<string, unknown>>;
  /** Tilt light intensities by the two eras' palette luminance. Defaults to on. */
  readonly usePaletteExposure?: boolean;
}

/**
 * The period transition engine. Everything the composition root needs:
 * request a year, step the clock each frame, listen for the arrival caption and
 * dispose the engine with the rest of the scene.
 */
export interface PeriodTransition {
  readonly id: string;
  readonly status: TransitionStatus;
  readonly phase: TransitionPhase;
  readonly fromYear: YearId | null;
  readonly targetYear: YearId | null;
  readonly settledYear: YearId | null;
  readonly progress: number;
  readonly reducedMotion: boolean;
  readonly isTransitioning: boolean;
  readonly isDisposed: boolean;
  readonly caption: TransitionCaption | null;
  readonly modules: readonly TransitionModuleState[];
  /** Applies an era immediately (boot and reduced-motion path). */
  applyYear(year: YearId): TransitionSignal;
  /** Starts or re-targets a choreography; safe to call mid-flight. */
  requestYear(year: YearId): CompletionSignal;
  /** Advances the choreography with an explicit delta, seconds. */
  update(deltaSeconds: number): void;
  /** Sets the reduced-motion policy (`'auto'` re-probes the environment). */
  setReducedMotion(value: boolean | 'auto'): void;
  /** Re-probes `prefers-reduced-motion` and applies the result. */
  refreshReducedMotion(): boolean;
  onCaption(listener: (caption: TransitionCaption) => void): () => void;
  onComplete(listener: (signal: TransitionSignal) => void): () => void;
  getSnapshot(): TransitionSnapshot;
  dispose(): void;
}

/**
 * Default per-era audio source: the programmes and mixes owned by the music
 * domain. Ambitious scenes can inject their own {@link AudioYearProvider}
 * instead; the transition only ever reads descriptors through the interface.
 */
export function createMusicEraAudioProvider(): AudioYearProvider {
  return Object.freeze({
    mix: (year: YearId): EraMixInput => eraMusicMix(year),
    program: (year: YearId): MusicProgramInput => musicProgram(year),
  });
}

/** True when `value` behaves like the period transition engine. */
export function isPeriodTransition(value: unknown): value is PeriodTransition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['id'] === PERIOD_TRANSITION_ID &&
    typeof candidate['requestYear'] === 'function' &&
    typeof candidate['applyYear'] === 'function' &&
    typeof candidate['update'] === 'function' &&
    typeof candidate['getSnapshot'] === 'function' &&
    typeof candidate['dispose'] === 'function'
  );
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                              */
/* -------------------------------------------------------------------------- */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Smooth, deterministic 0..1 easing. */
function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Deterministic hash in `[0, 1)`; the flicker noise source. */
function hash01(seed: number, a: number, b: number, c: number): number {
  let h = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((b >>> 0) + 0x165667b1), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ ((c >>> 0) + 0x27d4eb2f), 0x27d4eb2f) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Era the module itself reports, read from its optional `year`/`spec`. */
function reportedYear(module: SceneModule): YearId | null {
  const candidate = module as {
    readonly year?: unknown;
    readonly spec?: { readonly year?: unknown } | undefined;
  };
  if (isYearId(candidate.year)) return candidate.year;
  const specYear = candidate.spec?.year;
  return isYearId(specYear) ? specYear : null;
}

function probeReducedMotion(): boolean {
  const scope = globalThis as typeof globalThis & {
    matchMedia?: (query: string) => { readonly matches?: boolean };
  };
  if (typeof scope.matchMedia !== 'function') return false;
  try {
    return scope.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** Signage role a material declares, if any (`'sign-face'`, `'fixture-glow'`, ...). */
function readSignageRole(material: THREE.Material): string | null {
  const signage = (material.userData as { signage?: { role?: unknown } }).signage;
  return typeof signage?.role === 'string' ? signage.role : null;
}

/** Mean relative luminance of an era palette (working colour space, 0..~1). */
function paletteLevel(period: PeriodDefinition): number {
  const colors = [period.palette.wall, period.palette.ceiling, period.palette.lamp];
  let sum = 0;
  for (const css of colors) {
    const color = new THREE.Color(css);
    sum += 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  }
  return sum / colors.length;
}

export function toHex(color: THREE.Color): string {
  return `#${color.getHexString()}`;
}

/* -------------------------------------------------------------------------- */
/* Internal plan shapes                                                      */
/* -------------------------------------------------------------------------- */

interface PlannedModule {
  readonly module: SceneModule;
  readonly index: number;
  readonly order: number;
  readonly distance: number;
  readonly fromYear: YearId | null;
  readonly toYear: YearId;
  readonly needsSwap: boolean;
  readonly hasWindow: boolean;
  readonly floor: number;
  readonly scaleFloor: number;
  readonly swapAt: number;
  readonly window: number;
  readonly baseEnvelope: number;
  applied: boolean;
  finished: boolean;
  blend: number;
}

interface LightBaseline {
  readonly color: THREE.Color;
  readonly intensity: number;
  readonly kind: string;
}

/**
 * A light's live colour and intensity at the moment a plan captured them.
 *
 * A plan that supersedes an in-flight one ramps from these values rather than
 * from the pre-transition {@link LightBaseline}, so an interrupted switch keeps
 * the lighting it had reached instead of snapping back to the era it is leaving.
 */
interface LightOrigin {
  readonly color: THREE.Color;
  readonly intensity: number;
}

interface MaterialBaseline {
  readonly opacity: number;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
  readonly emissiveIntensity: number | null;
  readonly lit: boolean;
  readonly signageRole: string | null;
}

interface TransitionPlan {
  readonly from: YearId | null;
  readonly target: YearId;
  readonly targetPeriod: PeriodDefinition;
  readonly sourcePeriod: PeriodDefinition | null;
  readonly duration: number;
  readonly modules: readonly PlannedModule[];
  readonly lightingStart: number;
  readonly lightingEnd: number;
  readonly audioStart: number;
  readonly audioCrossfade: number;
  readonly audioSweep: number;
  readonly cameraStart: number;
  readonly cameraPeak: number;
  readonly captionAt: number;
  /** Palette-derived intensity tilt between the two eras (`1` disables it). */
  readonly exposure: number;
  /** Live light values at plan creation: the start of this plan's colour/intensity ramp. */
  readonly lightOrigins: ReadonlyMap<THREE.Light, LightOrigin>;
  /** Camera offset the viewer held at plan creation, decayed across this plan's micro-move. */
  readonly cameraCarry: THREE.Vector3;
  elapsed: number;
  audioApplied: boolean;
  audioSweepDone: boolean;
  captionPublished: boolean;
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Creates the period transition engine.
 *
 * @param options modules, host, audio port and timing overrides
 */
export function createPeriodTransition(options: PeriodTransitionOptions): PeriodTransition {
  const modules: readonly SceneModule[] = Object.freeze([...new Set(options.modules)]);
  const host = options.host;
  const audio = options.audio ?? null;
  const lookup = options.resolvePeriod ?? defaultResolvePeriod;
  const seed = options.seed ?? 0xcafe;
  const services = options.services;
  const durationSeconds = Math.max(options.durationSeconds ?? DEFAULT_TRANSITION_DURATION_SECONDS, 0.05);
  const moduleWindowSeconds = Math.max(options.moduleWindowSeconds ?? DEFAULT_MODULE_WINDOW_SECONDS, 0.02);
  const staggerSeconds = Math.max(options.staggerSeconds ?? DEFAULT_STAGGER_SECONDS, 0);
  const blendFloor = clamp01(options.blendFloor ?? DEFAULT_BLEND_FLOOR);
  const swapScale = clamp(options.swapScale ?? DEFAULT_BLEND_SCALE, 0.05, 1);
  const captionFraction = clamp(options.captionAt ?? 0.88, 0.2, 0.98);
  const cameraMicroMove = Math.max(options.cameraMicroMove ?? DEFAULT_CAMERA_MICRO_MOVE_METRES, 0);
  const audioCrossfadeSeconds = Math.max(
    options.audioCrossfadeSeconds ?? DEFAULT_AUDIO_CROSSFADE_SECONDS,
    0,
  );
  const flickerStrength = Math.max(options.flicker ?? DEFAULT_FLICKER_STRENGTH, 0);
  const usePaletteExposure = options.usePaletteExposure ?? true;
  const audioProvider =
    options.audioProvider !== undefined
      ? options.audioProvider
      : audio !== null
        ? createMusicEraAudioProvider()
        : null;

  /* -- engine state -------------------------------------------------------- */

  let status: TransitionStatus = 'settled';
  let reducedMotion = options.reducedMotion === undefined
    ? probeReducedMotion()
    : options.reducedMotion === 'auto'
      ? probeReducedMotion()
      : options.reducedMotion;
  let settledYear: YearId | null = options.initialYear ?? host.year ?? DEFAULT_YEAR_ID;
  let requestedYear: YearId | null = null;
  let plan: TransitionPlan | null = null;
  let steps = 0;

  /* -- blend bookkeeping --------------------------------------------------- */

  const materialBaselines = new WeakMap<THREE.Material, MaterialBaseline>();
  const touchedMaterials = new Set<THREE.Material>();
  const scaleBaselines = new Map<SceneModule, THREE.Vector3>();
  const moduleEnvelopes = new Map<SceneModule, number>();
  const lightBaselines = new Map<THREE.Light, LightBaseline>();
  let cameraBaseline: THREE.Vector3 | null = null;

  const scratchRecipe = new THREE.Color();
  const scratchDirection = new THREE.Vector3();

  /* -- audio state --------------------------------------------------------- */

  let audioStarted = false;
  let audioSweepActive = false;
  let audioSweepDone = false;
  let sourceToneHz = 0;
  let targetToneHz = 0;
  let machineUnsubscribe: (() => void) | null = null;
  let machineCues = 0;

  /* -- listeners ----------------------------------------------------------- */

  const captionListeners = new Set<(caption: TransitionCaption) => void>();
  const completeListeners = new Set<(signal: TransitionSignal) => void>();
  let pendingResolve: ((signal: TransitionSignal) => void) | null = null;

  let caption: TransitionCaption | null = null;
  let moduleViews: readonly TransitionModuleState[] = [];
  let lightViews: readonly TransitionLightState[] = [];

  /* -- geometry / distance ------------------------------------------------- */

  const box = new THREE.Box3();
  const worldPoint = new THREE.Vector3();

  /** Distance from the active camera to a module's world bounds, metres. */
  function distanceToCamera(module: SceneModule): number {
    const root = module.root;
    if (root === undefined) return Number.POSITIVE_INFINITY;
    root.updateWorldMatrix(true, true);
    box.setFromObject(root);
    if (!box.isEmpty()) {
      return Math.max(box.distanceToPoint(host.camera.position), 0);
    }
    root.getWorldPosition(worldPoint);
    return host.camera.position.distanceTo(worldPoint);
  }

  /** Module indices ordered nearest first, with a stable composition-order tie break. */
  function orderByDistance(): { readonly module: SceneModule; readonly index: number; readonly distance: number }[] {
    const entries = modules.map((module, index) => ({
      module,
      index,
      distance: distanceToCamera(module),
    }));
    return [...entries].sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.index - b.index;
    });
  }

  /* -- materials ----------------------------------------------------------- */

  function forEachMaterial(root: THREE.Object3D, visit: (material: THREE.Material) => void): void {
    const materials = new Set<THREE.Material>();
    root.traverse((object) => {
      const material = (object as { material?: THREE.Material | THREE.Material[] }).material;
      if (material === undefined) return;
      if (Array.isArray(material)) for (const entry of material) materials.add(entry);
      else materials.add(material);
    });
    for (const material of materials) visit(material);
  }

  /**
   * `emissiveIntensity` lives on lit materials, not on the `Material` base type,
   * so the glow ramp writes it through this narrow accessor.
   */
  function setEmissiveIntensity(material: THREE.Material, value: number): void {
    (material as THREE.Material & { emissiveIntensity?: number }).emissiveIntensity = value;
  }

  function ensureMaterialBaseline(material: THREE.Material): MaterialBaseline {
    const existing = materialBaselines.get(material);
    if (existing !== undefined) return existing;
    const emissive = (material as { emissive?: THREE.Color }).emissive;
    const emissiveIntensity = (material as { emissiveIntensity?: number }).emissiveIntensity;
    const hasEmissive = emissive instanceof THREE.Color && typeof emissiveIntensity === 'number';
    const baseline: MaterialBaseline = {
      opacity: material.opacity,
      transparent: material.transparent,
      depthWrite: material.depthWrite,
      emissiveIntensity: hasEmissive ? emissiveIntensity : null,
      lit: hasEmissive && (emissive.getHex() !== 0 || emissiveIntensity > 0),
      signageRole: readSignageRole(material),
    };
    materialBaselines.set(material, baseline);
    touchedMaterials.add(material);
    return baseline;
  }

  /** Deterministic flicker multiplier for one lit material at time `t`. */
  function flickerAt(entry: PlannedModule, baseline: MaterialBaseline, t: number): number {
    if (flickerStrength <= 0) return 1;
    const strong = baseline.signageRole !== null;
    const amount = flickerStrength * (strong ? 1.6 : 1);
    const frame = Math.floor(Math.max(t, 0) * 24);
    const noise = hash01(seed, entry.index * 131 + 17, frame, entry.order);
    const wobble = 1 + (noise * 2 - 1) * amount;
    const dropout = strong && noise > 0.92 ? 0.25 : 1;
    return clamp(wobble * dropout, 0.05, 2.5);
  }

  function modulateModule(root: THREE.Object3D, entry: PlannedModule, opacity: number, t: number): void {
    forEachMaterial(root, (material) => {
      const baseline = ensureMaterialBaseline(material);
      if (!baseline.transparent && !material.transparent) {
        material.transparent = true;
        material.needsUpdate = true;
      }
      material.opacity = baseline.opacity * opacity;
      if (baseline.lit && baseline.emissiveIntensity !== null) {
        setEmissiveIntensity(material, baseline.emissiveIntensity * flickerAt(entry, baseline, t));
      }
    });
  }

  function restoreModuleMaterials(root: THREE.Object3D): void {
    forEachMaterial(root, (material) => {
      const baseline = materialBaselines.get(material);
      if (baseline === undefined) return;
      material.opacity = baseline.opacity;
      material.depthWrite = baseline.depthWrite;
      if (material.transparent !== baseline.transparent) {
        material.transparent = baseline.transparent;
        material.needsUpdate = true;
      }
      if (baseline.emissiveIntensity !== null) {
        setEmissiveIntensity(material, baseline.emissiveIntensity);
      }
      materialBaselines.delete(material);
      touchedMaterials.delete(material);
    });
  }

  /** Restores every material the engine has touched (arrival safety net / dispose). */
  function restoreAllMaterials(): void {
    const pending = [...touchedMaterials];
    for (const material of pending) {
      const baseline = materialBaselines.get(material);
      if (baseline === undefined) continue;
      material.opacity = baseline.opacity;
      material.depthWrite = baseline.depthWrite;
      if (material.transparent !== baseline.transparent) {
        material.transparent = baseline.transparent;
        material.needsUpdate = true;
      }
      if (baseline.emissiveIntensity !== null) {
        setEmissiveIntensity(material, baseline.emissiveIntensity);
      }
    }
    for (const material of pending) {
      materialBaselines.delete(material);
      touchedMaterials.delete(material);
    }
  }

  /* -- lights -------------------------------------------------------------- */

  function collectLights(): THREE.Light[] {
    const lights: THREE.Light[] = [];
    for (const module of modules) {
      const root = module.root;
      if (root === undefined) continue;
      root.traverse((object) => {
        if ((object as THREE.Light).isLight === true) lights.push(object as THREE.Light);
      });
    }
    return lights;
  }

  function ensureLightBaseline(light: THREE.Light): LightBaseline {
    const existing = lightBaselines.get(light);
    if (existing !== undefined) return existing;
    const baseline: LightBaseline = {
      color: light.color.clone(),
      intensity: light.intensity,
      kind: light.type,
    };
    lightBaselines.set(light, baseline);
    return baseline;
  }

  /** Writes the recipe colour for `kind` into `out` and returns its intensity. */
  function recipeFor(kind: string, period: PeriodDefinition, out: THREE.Color): number {
    const lighting = period.lighting;
    switch (kind) {
      case 'AmbientLight':
        out.set(lighting.ambientColor);
        return lighting.ambientIntensity;
      case 'HemisphereLight':
        out.set(lighting.keyColor);
        return lighting.ambientIntensity;
      case 'DirectionalLight':
        out.set(lighting.keyColor);
        return lighting.keyIntensity;
      case 'PointLight':
      case 'SpotLight':
        out.set(lighting.lampColor);
        return lighting.lampIntensity;
      default:
        out.set(lighting.fillColor);
        return lighting.fillIntensity;
    }
  }

  /**
   * Era exposure tilt: the ratio between the target and source eras' palette
   * luminance. It preserves each light's module tuning (the light keeps its
   * share of its era's recipe) while making a dim, warm era read dimmer than a
   * bright one. Computed once per plan so the ramp stays cheap and stable.
   */
  function computeExposure(target: PeriodDefinition, source: PeriodDefinition | null): number {
    if (!usePaletteExposure || source === null) return 1;
    const sourceLevel = paletteLevel(source);
    if (sourceLevel <= 1e-6) return 1;
    const ratio = clamp(paletteLevel(target) / sourceLevel, 0.6, 1.6);
    return Number.isFinite(ratio) ? ratio : 1;
  }

  function targetIntensityFor(
    baseline: LightBaseline,
    current: TransitionPlan,
    out: THREE.Color,
  ): number {
    const source = current.sourcePeriod;
    if (source === null) return recipeFor(baseline.kind, current.targetPeriod, out);
    const sourceIntensity = recipeFor(baseline.kind, source, scratchRecipe);
    const scale = sourceIntensity > 1e-6 ? baseline.intensity / sourceIntensity : 1;
    return recipeFor(baseline.kind, current.targetPeriod, out) * scale * current.exposure;
  }

  function rampLights(current: TransitionPlan, t: number, final: boolean): void {
    const span = current.lightingEnd - current.lightingStart;
    const ramp = final ? 1 : span <= 0 ? 1 : smoothstep((t - current.lightingStart) / span);
    const lights = collectLights();
    const views: TransitionLightState[] = [];
    for (let index = 0; index < lights.length; index += 1) {
      const light = lights[index];
      if (light === undefined) continue;
      const baseline = ensureLightBaseline(light);
      // A light a module re-created during its swap has no captured origin, so it
      // ramps from the baseline the engine captured when it first saw it.
      const origin = current.lightOrigins.get(light);
      const fromColor = origin?.color ?? baseline.color;
      const fromIntensity = origin?.intensity ?? baseline.intensity;
      const targetIntensity = targetIntensityFor(baseline, current, scratchRecipe);
      if (t >= current.lightingStart || final) {
        light.color.copy(fromColor).lerp(scratchRecipe, ramp);
        light.intensity = lerp(fromIntensity, targetIntensity, ramp);
      }
      views.push({
        id: `${light.name || light.type}#${index}`,
        kind: baseline.kind,
        color: toHex(light.color),
        intensity: light.intensity,
        sourceIntensity: fromIntensity,
        targetIntensity,
      });
    }
    lightViews = Object.freeze(views);
  }

  function finaliseLights(current: TransitionPlan): void {
    rampLights(current, current.duration, true);
    lightBaselines.clear();
  }

  function restoreLights(): void {
    for (const [light, baseline] of lightBaselines) {
      light.color.copy(baseline.color);
      light.intensity = baseline.intensity;
    }
    lightBaselines.clear();
  }

  /* -- camera -------------------------------------------------------------- */

  function ensureCameraBaseline(): THREE.Vector3 {
    if (cameraBaseline === null) cameraBaseline = host.camera.position.clone();
    return cameraBaseline;
  }

  /** 0 at the start and the end of the micro-move, 1 at the arrival peak. */
  function cameraEnvelope(current: TransitionPlan, t: number): number {
    if (t <= current.cameraStart || t >= current.duration) return 0;
    if (t <= current.cameraPeak) {
      const span = Math.max(current.cameraPeak - current.cameraStart, 1e-6);
      return smoothstep((t - current.cameraStart) / span);
    }
    const span = Math.max(current.duration - current.cameraPeak, 1e-6);
    return 1 - smoothstep((t - current.cameraPeak) / span);
  }

  function applyCamera(current: TransitionPlan, t: number): void {
    const baseline = ensureCameraBaseline();
    const amount = cameraMicroMove * cameraEnvelope(current, t);
    // Framing a superseded plan left behind decays across this plan's micro-move,
    // so an interrupted switch keeps the view it held and settles back to the
    // viewer's prior framing instead of snapping to it.
    const recovery =
      1 -
      smoothstep(
        clamp01((t - current.cameraStart) / Math.max(current.duration - current.cameraStart, 1e-6)),
      );
    const carryX = current.cameraCarry.x * recovery;
    const carryY = current.cameraCarry.y * recovery;
    const carryZ = current.cameraCarry.z * recovery;
    if (amount <= 0 && carryX === 0 && carryY === 0 && carryZ === 0) {
      host.camera.position.copy(baseline);
      return;
    }
    host.camera.updateWorldMatrix(true, false);
    host.camera.getWorldDirection(scratchDirection);
    host.camera.position.set(
      baseline.x + carryX + scratchDirection.x * amount,
      baseline.y + carryY + scratchDirection.y * amount + amount * 0.35,
      baseline.z + carryZ + scratchDirection.z * amount,
    );
  }

  function restoreCamera(): void {
    if (cameraBaseline === null) return;
    host.camera.position.copy(cameraBaseline);
    cameraBaseline = null;
  }

  /* -- audio --------------------------------------------------------------- */

  function audioState(): AudioEngineState | null {
    if (audio === null) return null;
    const mix = audio.getMixState?.();
    if (mix !== undefined) return mix.state;
    return audio.state ?? null;
  }

  function attachMachineListener(): void {
    if (audio === null || audio.onMachineTrigger === undefined) return;
    if (machineUnsubscribe !== null) return;
    if (audioState() !== 'running') return;
    machineUnsubscribe = audio.onMachineTrigger(() => {
      machineCues += 1;
    });
  }

  function detachMachineListener(): void {
    if (machineUnsubscribe === null) return;
    machineUnsubscribe();
    machineUnsubscribe = null;
  }

  /**
   * Installs the era's audio descriptors. It never unlocks the context: while
   * the engine is locked the descriptors are simply staged, and the sweep only
   * runs once the user gesture has started real playback.
   */
  function applyAudio(current: TransitionPlan, crossfadeOverride?: number): void {
    if (audio === null) return;
    const year = current.target;
    const mix = audioProvider?.mix(year) ?? null;
    const program = audioProvider?.program === undefined ? undefined : audioProvider.program(year);
    const ambience = audioProvider?.ambience === undefined ? undefined : audioProvider.ambience(year);
    const crossfade = crossfadeOverride ?? current.audioCrossfade;
    const before: AudioMixState | undefined = audio.getMixState?.();
    sourceToneHz = before?.musicToneHz ?? 0;

    if (audio.transitionTo !== undefined) {
      const transition: {
        year?: YearId;
        mix?: EraMixInput;
        program?: MusicProgramInput | null;
        ambience?: AmbienceSpecInput | null;
        crossfadeSeconds?: number;
      } = { crossfadeSeconds: crossfade };
      transition.year = year;
      if (mix !== null) transition.mix = mix;
      if (program !== undefined) transition.program = program;
      if (ambience !== undefined) transition.ambience = ambience;
      audio.transitionTo(transition as AudioTransitionPlan);
    } else {
      if (mix !== null && audio.applyMix !== undefined) {
        audio.applyMix(mix, { seconds: crossfade });
      }
      if (program !== undefined && audio.setMusicProgram !== undefined) {
        audio.setMusicProgram(program, { crossfadeSeconds: crossfade });
      }
    }

    const after: AudioMixState | undefined = audio.getMixState?.();
    targetToneHz = after?.musicToneHz ?? sourceToneHz;
    audioStarted = true;
    const playable = audioState() === 'running';
    audioSweepActive = playable && sourceToneHz > 0 && targetToneHz > 0 && crossfade > 0;
    audioSweepDone = !audioSweepActive;
  }

  function sweepAudio(current: TransitionPlan, t: number): void {
    if (!audioSweepActive || audioSweepDone || audio === null || audio.setBusTone === undefined) return;
    const span = Math.max(current.audioSweep, 1e-6);
    const progress = clamp01((t - current.audioStart) / span);
    const tone = lerp(sourceToneHz, targetToneHz, smoothstep(progress));
    audio.setBusTone(SWEEP_BUS, tone, 0);
    if (progress >= 1) {
      audioSweepDone = true;
      audio.setBusTone(SWEEP_BUS, targetToneHz, 0);
    }
  }

  function finaliseAudio(current: TransitionPlan): void {
    if (audio === null) return;
    if (!audioStarted) applyAudio(current, 0);
    audioSweepDone = true;
    if (audioSweepActive && audio.setBusTone !== undefined) {
      audio.setBusTone(SWEEP_BUS, targetToneHz, 0);
    }
  }

  function audioView(): TransitionAudioState {
    const mix: AudioMixState | undefined = audio?.getMixState?.();
    let sweep = 0;
    if (audioSweepActive && plan !== null) {
      sweep = audioSweepDone ? 1 : clamp01((plan.elapsed - plan.audioStart) / Math.max(plan.audioSweep, 1e-6));
    } else if (audioSweepDone) {
      sweep = 1;
    }
    return {
      attached: audio !== null,
      locked: mix === undefined ? audio?.isLocked ?? true : mix.state === 'locked',
      started: audioStarted,
      crossfadeSeconds: plan?.audioCrossfade ?? audioCrossfadeSeconds,
      sweep,
      sourceToneHz,
      targetToneHz,
      programId: mix?.programId ?? null,
      mixId: mix?.mixId ?? null,
      machineCharacterId: mix?.machineCharacterId ?? null,
      listeners: machineUnsubscribe === null ? 0 : 1,
      machineCues,
    };
  }

  /* -- caption ------------------------------------------------------------- */

  function publishCaption(current: TransitionPlan): void {
    if (current.captionPublished) return;
    current.captionPublished = true;
    caption = Object.freeze({
      year: current.target,
      label: current.targetPeriod.label,
      name: current.targetPeriod.name,
      note: current.targetPeriod.summary,
    });
    for (const listener of [...captionListeners]) {
      try {
        listener(caption);
      } catch (error) {
        reportListenerError('caption listener failed', error);
      }
    }
  }

  function reportListenerError(scope: string, error: unknown): void {
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error(`[${PERIOD_TRANSITION_ID}] ${scope}`, error);
    }
  }

  /* -- completion signals -------------------------------------------------- */

  function resolvedSignal(
    year: YearId,
    outcome: TransitionOutcome,
    from: YearId | null,
    settled: YearId | null,
    supersededBy: YearId | null,
    elapsed: number,
  ): TransitionSignal {
    return Object.freeze<TransitionSignal>({
      requestedYear: year,
      outcome,
      fromYear: from,
      settledYear: settled,
      supersededBy,
      elapsedSeconds: elapsed,
      steps,
    });
  }

  function signalFromPlan(current: TransitionPlan, outcome: TransitionOutcome, settled: YearId | null, supersededBy: YearId | null): TransitionSignal {
    return resolvedSignal(current.target, outcome, current.from, settled, supersededBy, current.elapsed);
  }

  function notifyComplete(signal: TransitionSignal): void {
    for (const listener of [...completeListeners]) {
      try {
        listener(signal);
      } catch (error) {
        reportListenerError('complete listener failed', error);
      }
    }
  }

  function resolvePending(signal: TransitionSignal): void {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.(signal);
    notifyComplete(signal);
  }

  function createCompletion(year: YearId): CompletionSignal {
    const promise = new Promise<TransitionSignal>((resolve) => {
      pendingResolve = resolve;
    });
    return Object.assign(promise, { requestedYear: year }) as CompletionSignal;
  }

  function alreadyResolved(year: YearId): CompletionSignal {
    const promise = Promise.resolve(resolvedSignal(year, 'arrived', year, year, null, 0));
    return Object.assign(promise, { requestedYear: year }) as CompletionSignal;
  }

  function supersedePending(supersededBy: YearId | null): void {
    if (pendingResolve === null || plan === null) {
      pendingResolve = null;
      return;
    }
    const signal = signalFromPlan(plan, 'superseded', null, supersededBy);
    resolvePending(signal);
  }

  /* -- plan construction --------------------------------------------------- */

  function createPlan(previous: TransitionPlan | null, target: YearId): TransitionPlan {
    const targetPeriod = lookup(target);
    const from = settledYear ?? previous?.from ?? options.initialYear ?? host.year ?? DEFAULT_YEAR_ID;
    const sourcePeriod = from === target ? targetPeriod : lookup(from);
    const duration = durationSeconds;
    const captionAt = duration * captionFraction;
    const window = Math.min(moduleWindowSeconds, Math.max(duration * 0.5, 0.02));
    const swapLead = duration * 0.1;
    const swapSpan = Math.max(captionAt - swapLead - window, 0);
    const ordering = orderByDistance();

    const planned: PlannedModule[] = ordering.map((entry, order) => {
      const reported = reportedYear(entry.module);
      const moduleFrom = reported ?? from;
      const needsSwap = moduleFrom !== target;
      const carried = previous === null
        ? moduleEnvelopes.get(entry.module) ?? 1
        : previous.modules.find((candidate) => candidate.module === entry.module)?.blend ??
          moduleEnvelopes.get(entry.module) ??
          1;
      const baseEnvelope = clamp01(carried);
      const hasWindow = needsSwap || baseEnvelope < 0.999;
      const stagger =
        ordering.length <= 1 ? 0 : Math.min(staggerSeconds, swapSpan / (ordering.length - 1));
      return {
        module: entry.module,
        index: entry.index,
        order,
        distance: entry.distance,
        fromYear: moduleFrom,
        toYear: target,
        needsSwap,
        hasWindow,
        floor: needsSwap ? blendFloor : 1,
        scaleFloor: needsSwap ? swapScale : 1,
        swapAt: swapLead + order * stagger,
        window,
        baseEnvelope,
        applied: !hasWindow,
        finished: !hasWindow,
        blend: hasWindow ? baseEnvelope : 1,
      };
    });

    // Capture the *live* lighting and framing into the new plan. Starting from
    // the values the scene holds right now — rather than from the pre-transition
    // baselines — is what makes an interrupted switch re-target from the current
    // interpolated state instead of snapping back to the era it is leaving.
    const lightOrigins = new Map<THREE.Light, LightOrigin>();
    for (const light of collectLights()) {
      lightOrigins.set(light, { color: light.color.clone(), intensity: light.intensity });
    }
    const cameraCarry =
      cameraBaseline === null
        ? new THREE.Vector3()
        : host.camera.position.clone().sub(cameraBaseline);

    plan = {
      from,
      target,
      targetPeriod,
      sourcePeriod,
      duration,
      modules: planned,
      lightingStart: duration * 0.18,
      lightingEnd: duration * 0.78,
      audioStart: duration * 0.08,
      audioCrossfade: Math.min(audioCrossfadeSeconds, Math.max(duration - duration * 0.08, 0)),
      audioSweep: Math.min(audioCrossfadeSeconds, Math.max(duration - duration * 0.08, 0)),
      cameraStart: duration * 0.55,
      cameraPeak: captionAt,
      captionAt,
      exposure: computeExposure(targetPeriod, sourcePeriod),
      lightOrigins,
      cameraCarry,
      elapsed: 0,
      audioApplied: false,
      audioSweepDone: false,
      captionPublished: false,
    };
    return plan;
  }

  /* -- module application -------------------------------------------------- */

  function buildContext(period: PeriodDefinition): BuildContext {
    const buildOptions: TransitionBuildOptions = services === undefined ? {} : { services };
    return host.createBuildContext(period, buildOptions);
  }

  function ensureScaleBaseline(entry: PlannedModule): THREE.Vector3 {
    const existing = scaleBaselines.get(entry.module);
    if (existing !== undefined) return existing;
    const root = entry.module.root;
    const baseline = root === undefined ? new THREE.Vector3(1, 1, 1) : root.scale.clone();
    scaleBaselines.set(entry.module, baseline);
    return baseline;
  }

  function applySwap(entry: PlannedModule, current: TransitionPlan): void {
    entry.module.applyPeriod(current.targetPeriod, buildContext(current.targetPeriod));
    entry.applied = true;
  }

  function opacityEnvelope(entry: PlannedModule, w: number): number {
    if (!entry.hasWindow) return 1;
    if (w <= 0) return entry.baseEnvelope;
    if (w >= 1) return 1;
    if (!entry.needsSwap) {
      return lerp(entry.baseEnvelope, 1, smoothstep(w));
    }
    const half = 0.5;
    if (w < half) return lerp(entry.baseEnvelope, entry.floor, smoothstep(w / half));
    return lerp(entry.floor, 1, smoothstep((w - half) / half));
  }

  function finaliseModule(entry: PlannedModule): void {
    const root = entry.module.root;
    if (root !== undefined) {
      const baseline = ensureScaleBaseline(entry);
      root.scale.copy(baseline);
      restoreModuleMaterials(root);
    }
    scaleBaselines.delete(entry.module);
    entry.finished = true;
    entry.blend = 1;
  }

  function blendModule(entry: PlannedModule, current: TransitionPlan, t: number): void {
    if (!entry.hasWindow || entry.finished) return;
    const w = clamp01((t - entry.swapAt) / Math.max(entry.window, 1e-6));
    if (w <= 0) return;
    if (entry.needsSwap && !entry.applied && w >= 0.5) applySwap(entry, current);
    const opacity = opacityEnvelope(entry, w);
    entry.blend = opacity;
    moduleEnvelopes.set(entry.module, opacity);
    const root = entry.module.root;
    if (root !== undefined) {
      const baseline = ensureScaleBaseline(entry);
      const normalised =
        entry.floor >= 0.999 ? 1 : clamp01((opacity - entry.floor) / Math.max(1 - entry.floor, 1e-6));
      const scale = lerp(entry.scaleFloor, 1, normalised);
      root.scale.set(baseline.x * scale, baseline.y * scale, baseline.z * scale);
      modulateModule(root, entry, opacity, t);
    }
    if (w >= 1) finaliseModule(entry);
  }

  /** Forces every module to the target era (large step / arrival / disposal-free path). */
  function finishAllModules(current: TransitionPlan): void {
    for (const entry of current.modules) {
      if (!entry.finished && entry.hasWindow) {
        if (entry.needsSwap && !entry.applied) applySwap(entry, current);
        finaliseModule(entry);
      } else if (entry.needsSwap && !entry.applied) {
        applySwap(entry, current);
        finaliseModule(entry);
      }
      moduleEnvelopes.set(entry.module, 1);
    }
  }

  /* -- views --------------------------------------------------------------- */

  function refreshModuleViews(): void {
    const planned = plan?.modules;
    if (planned === undefined) {
      moduleViews = Object.freeze(
        modules.map((module, index) => ({
          id: module.id,
          index,
          order: index,
          distance: 0,
          fromYear: settledYear,
          toYear: settledYear ?? DEFAULT_YEAR_ID,
          needsSwap: false,
          swapAtSeconds: 0,
          windowSeconds: 0,
          applied: false,
          blend: 1,
          reportedYear: reportedYear(module),
        })),
      );
      return;
    }
    moduleViews = Object.freeze(
      planned.map((entry) => ({
        id: entry.module.id,
        index: entry.index,
        order: entry.order,
        distance: Number.isFinite(entry.distance) ? entry.distance : Number.POSITIVE_INFINITY,
        fromYear: entry.fromYear,
        toYear: entry.toYear,
        needsSwap: entry.needsSwap,
        swapAtSeconds: entry.swapAt,
        windowSeconds: entry.window,
        applied: entry.applied,
        blend: entry.finished ? 1 : entry.blend,
        reportedYear: reportedYear(entry.module),
      })),
    );
  }

  function currentPhase(): TransitionPhase {
    if (status === 'disposed') return 'disposed';
    if (status === 'settled' || plan === null) return 'settled';
    if (plan.elapsed < plan.lightingStart) return 'anticipation';
    if (plan.elapsed < plan.captionAt) return 'swapping';
    return 'arrival';
  }

  /* -- timeline ------------------------------------------------------------ */

  function applyTimeline(current: TransitionPlan): void {
    const t = current.elapsed;

    if (t >= current.lightingStart) {
      rampLights(current, t, false);
    }

    for (const entry of current.modules) blendModule(entry, current, t);

    if (!current.audioApplied && t >= current.audioStart) {
      current.audioApplied = true;
      applyAudio(current);
    }
    if (current.audioApplied) sweepAudio(current, t);

    if (t >= current.cameraStart) applyCamera(current, t);

    if (t >= current.captionAt) publishCaption(current);
  }

  function settle(current: TransitionPlan, instant: boolean): void {
    finishAllModules(current);
    if (!current.audioApplied) {
      current.audioApplied = true;
      applyAudio(current, instant ? 0 : undefined);
    }
    finaliseAudio(current);
    finaliseLights(current);
    restoreCamera();
    restoreAllMaterials();
    detachMachineListener();
    publishCaption(current);
    moduleEnvelopes.clear();
    scaleBaselines.clear();

    status = 'settled';
    settledYear = current.target;
    requestedYear = current.target;
    refreshModuleViews();
    resolvePending(signalFromPlan(current, 'arrived', current.target, null));
  }

  /* -- instant application ------------------------------------------------- */

  function applyInstantly(current: TransitionPlan): void {
    for (const entry of current.modules) {
      if (entry.needsSwap && !entry.applied) applySwap(entry, current);
      finaliseModule(entry);
    }
    current.audioApplied = true;
    applyAudio(current, 0);
    finaliseAudio(current);
    finaliseLights(current);
    restoreAllMaterials();
    restoreCamera();
    detachMachineListener();
    publishCaption(current);
    moduleEnvelopes.clear();
    scaleBaselines.clear();

    status = 'settled';
    settledYear = current.target;
    requestedYear = current.target;
    refreshModuleViews();
    resolvePending(signalFromPlan(current, 'arrived', current.target, null));
  }

  /* -- public surface ------------------------------------------------------ */

  const engine: PeriodTransition = {
    id: PERIOD_TRANSITION_ID,
    get status() {
      return status;
    },
    get phase() {
      return currentPhase();
    },
    get fromYear() {
      return plan?.from ?? settledYear;
    },
    get targetYear() {
      return requestedYear;
    },
    get settledYear() {
      return settledYear;
    },
    get progress() {
      if (plan === null || status === 'settled') return status === 'disposed' ? 0 : 1;
      return clamp01(plan.elapsed / Math.max(plan.duration, 1e-6));
    },
    get reducedMotion() {
      return reducedMotion;
    },
    get isTransitioning() {
      return status === 'transitioning';
    },
    get isDisposed() {
      return status === 'disposed';
    },
    get caption() {
      return caption;
    },
    get modules() {
      return moduleViews;
    },
    applyYear(year: YearId): TransitionSignal {
      if (status === 'disposed') {
        throw new Error('The period transition engine has been disposed.');
      }
      supersedePending(year);
      const current = createPlan(plan, year);
      applyInstantly(current);
      refreshModuleViews();
      return signalFromPlan(current, 'arrived', year, null);
    },
    requestYear(year: YearId): CompletionSignal {
      if (status === 'disposed') {
        throw new Error('The period transition engine has been disposed.');
      }
      if (
        status === 'settled' &&
        settledYear === year &&
        modules.every((module) => (reportedYear(module) ?? settledYear) === year)
      ) {
        return alreadyResolved(year);
      }
      supersedePending(year);
      const previous = plan;
      detachMachineListener();
      const current = createPlan(previous, year);
      requestedYear = year;
      plan = current;
      status = 'transitioning';
      refreshModuleViews();
      const completion = createCompletion(year);
      if (reducedMotion) {
        applyInstantly(current);
        return completion;
      }
      attachMachineListener();
      return completion;
    },
    update(deltaSeconds: number): void {
      if (status === 'disposed') return;
      const delta = Number.isFinite(deltaSeconds) ? clamp(deltaSeconds, 0, MAX_TRANSITION_STEP_SECONDS) : 0;
      steps += 1;
      if (status !== 'transitioning' || plan === null) return;
      plan.elapsed += delta;
      applyTimeline(plan);
      refreshModuleViews();
      if (plan.elapsed >= plan.duration) {
        settle(plan, false);
      }
    },
    setReducedMotion(value: boolean | 'auto'): void {
      reducedMotion = value === 'auto' ? probeReducedMotion() : value;
    },
    refreshReducedMotion(): boolean {
      reducedMotion = probeReducedMotion();
      return reducedMotion;
    },
    onCaption(listener) {
      captionListeners.add(listener);
      return () => {
        captionListeners.delete(listener);
      };
    },
    onComplete(listener) {
      completeListeners.add(listener);
      return () => {
        completeListeners.delete(listener);
      };
    },
    getSnapshot(): TransitionSnapshot {
      const current = plan;
      return {
        id: PERIOD_TRANSITION_ID,
        status,
        phase: currentPhase(),
        reducedMotion,
        fromYear: current?.from ?? settledYear,
        targetYear: requestedYear,
        settledYear,
        elapsedSeconds: current?.elapsed ?? 0,
        durationSeconds: current?.duration ?? durationSeconds,
        progress: current === null ? 1 : clamp01(current.elapsed / Math.max(current.duration, 1e-6)),
        steps,
        swapsApplied:
          current === null ? 0 : current.modules.filter((entry) => entry.applied).length,
        ownedNodes: 0,
        caption,
        modules: moduleViews,
        lights: lightViews,
        audio: audioView(),
        camera: cameraView(),
      };
    },
    dispose(): void {
      if (status === 'disposed') return;
      const current = plan;
      if (current !== null) {
        for (const entry of current.modules) {
          const root = entry.module.root;
          if (root === undefined) continue;
          const baseline = scaleBaselines.get(entry.module);
          if (baseline !== undefined) root.scale.copy(baseline);
        }
      }
      restoreAllMaterials();
      restoreLights();
      restoreCamera();
      detachMachineListener();
      moduleEnvelopes.clear();
      scaleBaselines.clear();
      if (current !== null && pendingResolve !== null) {
        resolvePending(signalFromPlan(current, 'disposed', null, null));
      } else {
        pendingResolve = null;
      }
      plan = null;
      status = 'disposed';
      captionListeners.clear();
      completeListeners.clear();
    },
  };

  function cameraView(): TransitionCameraState {
    const baseline = cameraBaseline;
    const position = host.camera.position;
    return {
      microMove: cameraMicroMove,
      offset: {
        x: baseline === null ? 0 : position.x - baseline.x,
        y: baseline === null ? 0 : position.y - baseline.y,
        z: baseline === null ? 0 : position.z - baseline.z,
      },
      settled: baseline === null,
    };
  }

  refreshModuleViews();
  return engine;
}
