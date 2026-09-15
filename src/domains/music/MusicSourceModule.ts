/**
 * MusicSourceModule — the café's music domain.
 *
 * One module owns both halves of "the music and what it plays from":
 *
 *  - **the device.** For each of the five eras it raises exactly one playback
 *    device under the supplied parent — a 1945 wireless set (with its
 *    gramophone), a 1965 wall jukebox and selector, a 1985 counter boombox with
 *    tape stacks, a 2005 iPod in a speaker dock with cable clutter, and a 2025
 *    phone paired to a smart speaker. The other four variants are never in the
 *    scene graph: {@link MusicSourceModule.applyPeriod} releases the previous
 *    device before raising the new one, so no two sources are ever visible and
 *    only one can be audible.
 *  - **the programme.** Each year also routes its era programme and era mix into
 *    the café's {@link MusicAudioTarget} — the `AudioEngine` music bus. The
 *    engine's own gesture gate is respected: descriptors are applied while the
 *    engine is locked (so the right music starts at the enter-café unlock), but
 *    this module never calls `unlock()` and never starts a private
 *    `AudioContext`.
 *
 * `SceneModule` conformance:
 *
 *  - `build(context)` raises the year's device under `context.root`,
 *  - `applyPeriod(period, context)` swaps device and programme when the timeline
 *    moves (and is idempotent when the year has not changed),
 *  - `update(delta, context)` animates dial needles, tape reels, turntables, LED
 *    glow and cone excursion with delta time — frozen under
 *    `prefers-reduced-motion`,
 *  - `getHotspots()` reports the active device,
 *  - `dispose()` releases every geometry, material and texture and leaves no
 *    node behind.
 *
 * The module file is the task's public surface: it exports the factory, the
 * per-year spec map ({@link MUSIC_SOURCE_SPECS}) and the programme set
 * ({@link MUSIC_PROGRAMS} / {@link ERA_MUSIC_MIXES}) re-exported from
 * `./programs`.
 */

import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  type BuildContext,
  type Hotspot,
  type PeriodDefinition,
  type RoomBounds,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../../contracts/period';
import { CAFE_ROOM_BOUNDS, STRUCTURAL_LAYOUT, type StructuralLayout } from '../environment/roomBounds';
import type {
  AudioEngineState,
  AudioMixState,
  EraMixDescriptor,
  EraMixInput,
  MusicProgramInput,
} from '../../audio';
import {
  MUSIC_GROUP_NAME,
  advanceMusicAnimations,
  buildMusicDevice,
  disposeMusicDevice,
  musicDevicePlacement,
  type BuiltMusicDevice,
  type MusicDeviceKind,
  type MusicDevicePlacement,
  type MusicDeviceSpec,
  type MusicPlacementKind,
  type MusicPlacementZone,
} from './devices';
import {
  ERA_MUSIC_MIXES,
  MUSIC_PROGRAMS,
  describeMusicProgram,
  eraMixSignature,
  eraMusicMix,
  musicProgram,
  musicProgramSignature,
  type MusicProgramDescription,
} from './programs';
import { MUSIC_SPEC_1945 } from './data/1945';
import { MUSIC_SPEC_1965 } from './data/1965';
import { MUSIC_SPEC_1985 } from './data/1985';
import { MUSIC_SPEC_2005 } from './data/2005';
import { MUSIC_SPEC_2025 } from './data/2025';
import type { CanvasFactory } from './textures';

/* -------------------------------------------------------------------------- */
/* Public tables                                                              */
/* -------------------------------------------------------------------------- */

/** Stable module id: registry key, hotspot owner id and node namespace. */
export const MUSIC_MODULE_ID = 'music';

/** Alias used by the framework outline (`cafe-music-sources`). */
export const MUSIC_SOURCE_MODULE_ID = MUSIC_MODULE_ID;

/** Seed of the module's deterministic placement and texture source. */
export const DEFAULT_MUSIC_SEED = 0x6d75_5349;

/** The five era device specs, keyed by the shared `YearId`. */
export const MUSIC_SOURCE_SPECS: Readonly<Record<YearId, MusicDeviceSpec>> = Object.freeze({
  '1945': MUSIC_SPEC_1945,
  '1965': MUSIC_SPEC_1965,
  '1985': MUSIC_SPEC_1985,
  '2005': MUSIC_SPEC_2005,
  '2025': MUSIC_SPEC_2025,
});

/** Device spec of `year` (always defined for the five café eras). */
export function musicSpec(year: YearId): MusicDeviceSpec {
  return MUSIC_SOURCE_SPECS[year];
}

/* -------------------------------------------------------------------------- */
/* Audio target                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The slice of the café audio engine this module drives. `AudioEngine`
 * satisfies it structurally; the interface exists so the module owns no private
 * audio graph and so tests can observe routing without a browser.
 */
export interface MusicAudioTarget {
  /** Lifecycle state the engine reports. */
  readonly state: AudioEngineState;
  /** Applies the era programme to the music bus (validated by the engine). */
  setMusicProgram(
    program: MusicProgramInput | null,
    options?: { crossfadeSeconds?: number },
  ): void;
  /** Applies the era mix to the bus trims, tones and master. */
  applyMix(mix: EraMixInput, options?: { seconds?: number }): EraMixDescriptor;
  /** Snapshot of the applied mix, used to read back the era volume and tone. */
  getMixState(): AudioMixState;
}

/** What the module observed after routing an era into the engine. */
export interface MusicRoutingState {
  readonly engineAttached: boolean;
  readonly engineState: AudioEngineState | null;
  /** True while the engine is still waiting for the enter-café gesture. */
  readonly awaitingUnlock: boolean;
  readonly programId: string | null;
  readonly mixId: string | null;
  /** Music bus level the engine reports for the era. */
  readonly musicLevel: number;
  /** Music bus tone (lowpass) in hertz the engine reports for the era. */
  readonly musicToneHz: number;
  readonly crossfadeSeconds: number;
}

const DETACHED_ROUTING: MusicRoutingState = Object.freeze({
  engineAttached: false,
  engineState: null,
  awaitingUnlock: true,
  programId: null,
  mixId: null,
  musicLevel: 0,
  musicToneHz: 0,
  crossfadeSeconds: 0,
});

/** True when `value` behaves like the café audio engine's bus surface. */
export function isMusicAudioTarget(value: unknown): value is MusicAudioTarget {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['setMusicProgram'] === 'function' &&
    typeof candidate['applyMix'] === 'function' &&
    typeof candidate['getMixState'] === 'function'
  );
}

/* -------------------------------------------------------------------------- */
/* Module                                                                     */
/* -------------------------------------------------------------------------- */

export interface MusicSourceModuleOptions {
  /** Interior volume; defaults to the café's {@link CAFE_ROOM_BOUNDS}. */
  readonly bounds?: RoomBounds;
  /** Structural anchors (counter, walls); defaults to the café layout. */
  readonly layout?: StructuralLayout;
  /** Canvas factory for the procedural device textures. */
  readonly canvasFactory?: CanvasFactory;
  /** Texture resolution override. */
  readonly textureSize?: number;
  /** Era reported before the first build. */
  readonly initialYear?: YearId;
  /** Deterministic seed for texture and placement jitter. */
  readonly seed?: number;
  /** Audio engine to route programmes into (also read from build services). */
  readonly engine?: MusicAudioTarget | null;
  /** Crossfade used when the era changes, seconds. */
  readonly crossfadeSeconds?: number;
  /** `'auto'` (default) follows `prefers-reduced-motion`; `true` freezes motion. */
  readonly reducedMotion?: boolean | 'auto';
  /** Key the engine is looked up under in `BuildContext.services`. */
  readonly audioServiceKey?: string;
}

/** The active device, as reported to the overlay and diagnostics. */
export interface MusicDeviceRecord {
  readonly year: YearId;
  readonly deviceId: string;
  readonly kind: MusicDeviceKind;
  readonly name: string;
  readonly maker: string;
  readonly model: string;
  readonly caption: string;
  readonly placement: MusicPlacementKind;
  readonly zone: MusicPlacementZone;
  /** World position of the device base centre. */
  readonly worldPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly surfaceHeight: number;
  readonly support: MusicDevicePlacement['support'];
  readonly partCount: number;
  readonly meshCount: number;
  readonly accessoryLabels: readonly string[];
  readonly programId: string;
}

/** Diagnostics snapshot of the module for one moment in the timeline. */
export interface MusicSourceDescription {
  readonly moduleId: string;
  readonly year: YearId;
  readonly built: boolean;
  readonly device: MusicDeviceRecord | null;
  readonly nodeName: string | null;
  readonly geometryCount: number;
  readonly materialCount: number;
  readonly textureCount: number;
  readonly animatedPartCount: number;
  readonly updates: number;
  readonly reducedMotion: boolean;
  readonly routing: MusicRoutingState;
  readonly program: MusicProgramDescription;
  readonly programSignature: string;
  readonly mixSignature: string;
}

function resolveReducedMotion(value: boolean | 'auto' | undefined): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }
  return false;
}

/** Part families present on the built device (cable is absent when wireless). */
export function presentPartFamilies(parts: ReadonlyMap<string, THREE.Object3D>): readonly string[] {
  const families = new Set<string>();
  for (const path of parts.keys()) {
    const [family = path] = path.split('.');
    families.add(family);
  }
  return [...families].sort();
}

/**
 * The café's music sources: the era playback device plus the era programme it
 * plays, driven through the shared {@link SceneModule} contract.
 */
export class MusicSourceModule implements SceneModule<MusicDeviceSpec> {
  readonly id = MUSIC_MODULE_ID;

  /** Interior volume devices are placed inside. */
  readonly bounds: RoomBounds;

  /** Structural anchors used for placement (counter zone and walls). */
  readonly layout: StructuralLayout;

  /**
   * Per-year programme/mix provider, shaped exactly like the audio engine's
   * `AudioYearProvider`, so the period registry can wire this module straight
   * into `createAudioSceneModule` if it prefers that route.
   */
  readonly provider = Object.freeze({
    mix: (year: YearId): EraMixInput => eraMusicMix(year),
    program: (year: YearId): MusicProgramInput => musicProgram(year),
  });

  private readonly options: MusicSourceModuleOptions;
  private readonly audioServiceKey: string;
  private group: THREE.Group | null = null;
  private built: BuiltMusicDevice | null = null;
  private currentSpec: MusicDeviceSpec | null = null;
  private lastYear: YearId | null = null;
  private engineValue: MusicAudioTarget | null = null;
  private routingValue: MusicRoutingState = DETACHED_ROUTING;
  private reducedMotionValue: boolean;
  private phase = 0;
  private updates = 0;

  constructor(options: MusicSourceModuleOptions = {}) {
    this.options = options;
    this.bounds = options.bounds ?? CAFE_ROOM_BOUNDS;
    this.layout = options.layout ?? STRUCTURAL_LAYOUT;
    this.audioServiceKey = options.audioServiceKey ?? 'audio';
    this.engineValue = options.engine ?? null;
    this.reducedMotionValue = resolveReducedMotion(options.reducedMotion);
    if (
      this.layout.bounds.width !== this.bounds.width ||
      this.layout.bounds.depth !== this.bounds.depth ||
      this.layout.bounds.height !== this.bounds.height
    ) {
      throw new Error('The structural layout must describe the same room as `bounds`.');
    }
  }

  /* -- SceneModule surface -------------------------------------------------- */

  /** The single `music` group, once built. */
  get root(): THREE.Object3D | undefined {
    return this.group ?? undefined;
  }

  /** Era data currently applied. */
  get spec(): MusicDeviceSpec | undefined {
    return this.currentSpec ?? undefined;
  }

  /** Era the module is showing (falls back to the configured initial year). */
  get year(): YearId {
    return this.currentSpec?.year ?? this.lastYear ?? this.options.initialYear ?? DEFAULT_YEAR_ID;
  }

  /** Crossfade applied to era changes, seconds. */
  get crossfadeSeconds(): number {
    return this.options.crossfadeSeconds ?? 1.2;
  }

  /** True while animated detail is frozen (prefers-reduced-motion). */
  get reducedMotion(): boolean {
    return this.reducedMotionValue;
  }

  /** Audio engine the module is routing into, once supplied. */
  get engine(): MusicAudioTarget | null {
    return this.engineValue;
  }

  /** What the module last observed on the engine's music bus. */
  get routing(): MusicRoutingState {
    return this.routingValue;
  }

  build(context: BuildContext): void {
    this.dispose();
    this.raise(context.year, context);
  }

  applyPeriod(period: PeriodDefinition, context: BuildContext): void {
    if (this.built && this.currentSpec?.year === period.year) {
      // Same era: re-apply the programme in place (idempotent, no rebuild) so a
      // repeated timeline event cannot double the device.
      this.applyAudio(period.year, context);
      return;
    }
    // Device geometry is era specific — a walnut valve set is not a fabric puck —
    // so the swap releases the previous device before raising the new one. At no
    // point are two music devices in the scene graph.
    this.dispose();
    this.raise(period.year, context);
  }

  update(deltaSeconds: number, _context: UpdateContext): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
    this.phase += delta;
    this.updates += 1;
    const built = this.built;
    if (!built) return;
    // Motion only. Playback itself is the audio engine's business, and it starts
    // on the enter-café gesture — never here.
    advanceMusicAnimations(built.animations, this.phase, delta, this.reducedMotionValue);
  }

  dispose(): void {
    if (this.built) {
      disposeMusicDevice(this.built);
      this.built = null;
    }
    if (this.group) {
      if (this.group.parent) this.group.parent.remove(this.group);
      this.group.clear();
      this.group = null;
    }
    this.currentSpec = null;
    this.routingValue = DETACHED_ROUTING;
    this.phase = 0;
  }

  getHotspots(): readonly Hotspot[] {
    const spec = this.currentSpec ?? musicSpec(this.year);
    const placement = musicDevicePlacement(spec, this.bounds, this.layout);
    const program = describeMusicProgram(spec.year);
    const position = new THREE.Vector3(
      placement.position.x,
      placement.position.y + spec.cabinet.height / 2,
      placement.position.z,
    );
    return [
      {
        id: `music-source-${spec.year}`,
        label: `${spec.year} ${spec.name}`,
        description: `${spec.maker} ${spec.model}. ${spec.caption} Playing "${program.label}" — ${program.tempo} bpm in ${program.keyRoot} ${program.keyMode}, ${program.instruments.join(', ')}.`,
        position,
        radius: Math.max(spec.cabinet.width, spec.cabinet.depth) * 1.1,
        year: spec.year,
        moduleId: MUSIC_MODULE_ID,
        kind: 'interactive',
        anchor: this.built?.group,
      },
    ];
  }

  /* -- domain API ---------------------------------------------------------- */

  /** The single active device, or `null` before the first build. */
  activeDevice(): MusicDeviceRecord | null {
    const spec = this.currentSpec;
    const built = this.built;
    if (!spec || !built) return null;
    return {
      year: spec.year,
      deviceId: spec.deviceId,
      kind: spec.kind,
      name: spec.name,
      maker: spec.maker,
      model: spec.model,
      caption: spec.caption,
      placement: built.placement.kind,
      zone: built.placement.zone,
      worldPosition: {
        x: built.placement.position.x,
        y: built.placement.position.y,
        z: built.placement.position.z,
      },
      surfaceHeight: built.placement.surfaceHeight,
      support: built.placement.support,
      partCount: built.parts.size,
      meshCount: built.meshCount,
      accessoryLabels: built.accessoryLabels,
      programId: spec.programId,
    };
  }

  /** Name of the device group currently in the scene graph, or `null`. */
  activeDeviceNodeName(): string | null {
    return this.built?.nodeName ?? null;
  }

  /** Part families present on the active device (cabinet, dial, grille, ...). */
  partFamilies(): readonly string[] {
    return this.built ? presentPartFamilies(this.built.parts) : [];
  }

  /** True when the active device carries a part under `path` (dot separated). */
  hasPart(path: string): boolean {
    return this.built?.parts.has(path) ?? false;
  }

  /** Part paths of the active device that start with `prefix`. */
  partsWithPrefix(prefix: string): readonly string[] {
    if (!this.built) return [];
    return [...this.built.parts.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  /** Programme of the active era. */
  program(): MusicProgramInput {
    return musicProgram(this.year);
  }

  /** Era mix of the active era. */
  mix(): EraMixInput {
    return eraMusicMix(this.year);
  }

  /** Music bus level the engine currently reports for the era. */
  appliedMusicLevel(): number {
    return this.routingValue.musicLevel;
  }

  /** Music bus tone (hertz) the engine currently reports for the era. */
  appliedMusicToneHz(): number {
    return this.routingValue.musicToneHz;
  }

  /** Freezes or resumes animated detail at runtime. */
  setReducedMotion(value: boolean | 'auto'): void {
    this.reducedMotionValue = resolveReducedMotion(value);
  }

  /** Diagnostics snapshot (device, geometry counts, routing and programme). */
  describe(): MusicSourceDescription {
    const year = this.year;
    const built = this.built;
    return {
      moduleId: MUSIC_MODULE_ID,
      year,
      built: built !== null,
      device: this.activeDevice(),
      nodeName: built?.nodeName ?? null,
      geometryCount: built?.geometries.length ?? 0,
      materialCount: built?.materials.length ?? 0,
      textureCount: built?.textures.length ?? 0,
      animatedPartCount: built?.animations.length ?? 0,
      updates: this.updates,
      reducedMotion: this.reducedMotionValue,
      routing: this.routingValue,
      program: describeMusicProgram(year),
      programSignature: musicProgramSignature(musicProgram(year)),
      mixSignature: eraMixSignature(eraMusicMix(year)),
    };
  }

  /* -- internals ----------------------------------------------------------- */

  private resolveEngine(context: BuildContext): MusicAudioTarget | null {
    const explicit = this.options.engine;
    if (explicit !== undefined && explicit !== null) return explicit;
    const fromServices = context.services?.[this.audioServiceKey];
    if (isMusicAudioTarget(fromServices)) return fromServices;
    return null;
  }

  private raise(year: YearId, context: BuildContext): void {
    const spec = musicSpec(year);
    const group = new THREE.Group();
    group.name = MUSIC_GROUP_NAME;
    group.userData = { music: { year, deviceId: spec.deviceId, kind: spec.kind } };
    context.root.add(group);
    this.group = group;

    const built = buildMusicDevice(spec, {
      bounds: this.bounds,
      layout: this.layout,
      canvasFactory: this.options.canvasFactory,
      textureSize: this.options.textureSize,
      seed: this.options.seed ?? DEFAULT_MUSIC_SEED,
    });
    group.add(built.group);
    this.built = built;
    this.currentSpec = spec;
    this.lastYear = spec.year;

    // Only the frame this phase belongs to is ours; animations start from rest.
    this.phase = 0;
    this.applyAudio(year, context);
  }

  /**
   * Routes the era programme and mix into the audio engine's music bus.
   *
   * Descriptors are applied even while the engine is locked: the engine stores
   * them and starts scheduling on the gesture, which is exactly what "never
   * start playback before the enter-café audio unlock" requires.
   */
  private applyAudio(year: YearId, context: BuildContext): void {
    const engine = this.resolveEngine(context);
    this.engineValue = engine;
    if (engine === null) {
      this.routingValue = DETACHED_ROUTING;
      return;
    }
    const seconds = this.crossfadeSeconds;
    engine.applyMix(eraMusicMix(year), { seconds });
    engine.setMusicProgram(musicProgram(year), { crossfadeSeconds: seconds });
    const state = engine.getMixState();
    this.routingValue = {
      engineAttached: true,
      engineState: state.state,
      awaitingUnlock: state.state !== 'running',
      programId: state.programId,
      mixId: state.mixId,
      musicLevel: state.musicLevel,
      musicToneHz: state.musicToneHz,
      crossfadeSeconds: seconds,
    };
  }
}

/** Convenience factory mirroring the other domain modules' style. */
export function createMusicSourceModule(options: MusicSourceModuleOptions = {}): MusicSourceModule {
  return new MusicSourceModule(options);
}

/* -------------------------------------------------------------------------- */
/* Re-exports: the module file is the task's public surface                    */
/* -------------------------------------------------------------------------- */

export {
  ERA_MUSIC_MIXES,
  MUSIC_ERA_DISCRIMINATOR_FIELDS,
  MUSIC_PROGRAMS,
  MUSIC_PROGRAM_YEARS,
  describeMusicProgram,
  eraMixSignature,
  eraMusicMix,
  musicDeviceKind,
  musicInstrumentation,
  musicProgram,
  musicProgramSeed,
  musicProgramSignature,
  musicProgramSteps,
  type MusicProgramDescription,
} from './programs';

export {
  MUSIC_DEVICE_KINDS,
  MUSIC_GROUP_NAME,
  MUSIC_NODE_PREFIX,
  MUSIC_PART_FAMILIES,
  advanceMusicAnimations,
  buildMusicDevice,
  disposeMusicDevice,
  isMusicDeviceKind,
  musicCableRoute,
  musicDeviceNodeName,
  musicDevicePlacement,
  toDeviceLocal,
  type BuiltMusicDevice,
  type MusicAnimation,
  type MusicAnimationKind,
  type MusicCabinetMaterial,
  type MusicCabinetSpec,
  type MusicCableKind,
  type MusicCableRoute,
  type MusicCableSpec,
  type MusicControlKind,
  type MusicControlSpec,
  type MusicDeviceBuildOptions,
  type MusicDeviceKind,
  type MusicDevicePalette,
  type MusicDevicePlacement,
  type MusicDeviceSpec,
  type MusicDialKind,
  type MusicDialSpec,
  type MusicGlowPart,
  type MusicGlowSpec,
  type MusicGrilleKind,
  type MusicGrilleSpec,
  type MusicPlacementKind,
  type MusicPlacementSpec,
  type MusicPlacementSupport,
  type MusicPlacementZone,
  type MusicPoint,
  type MusicSpeakerSpec,
} from './devices';
