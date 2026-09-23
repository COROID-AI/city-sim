/**
 * Chrono City — AudioDirector.
 *
 * One object owns the whole audio side of the experience:
 *
 *  - a lazily created `AudioContext` with a `master` gain feeding the
 *    destination and `sfx` / `music` / `ambience` sub-buses feeding `master`;
 *  - autoplay-safe unlocking: the context is created on demand and resumed on
 *    the first user gesture, with a visible affordance that doubles as the
 *    persistent mute toggle (audio never blocks app boot);
 *  - a cue registry (`registerCue` / `play`) whose voices are synthesized by
 *    `sfxSynth` and routed `source → staging gain → [panner] → bus → master`;
 *  - 3D positional emitters with inverse distance rolloff, bound either to a
 *    fixed position or to a live `THREE.Object3D` (vehicles, shops, crowds);
 *  - a `SceneContext` system tick that refreshes the three.js-compatible
 *    listener from the camera and re-spatialises every emitter each frame;
 *  - the shared `EraContracts` blend surface, so cue naming and crossfades
 *    follow the timeline without re-implementing era maths.
 *
 * Lifecycle:
 *   create    → `createAudioDirector()` / `bootAudioDirector()`. No
 *               `AudioContext` exists until something needs sound.
 *   consume   → game systems call `play()`, `registerEmitter()` and
 *               `setEra()`; the tick loop calls `tick()`.
 *   integrate → `attach(sceneContext)` joins the frame loop and
 *               `integrateAudioDirectorGlobal()` publishes the director on
 *               `window.__chronoCityAudio` for overlays and browser harnesses.
 */

import * as THREE from 'three';

import {
  DEFAULT_ERA,
  assertEraId,
  clamp01,
  isEraId,
  smoothStep01,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../core/eraContracts';
import {
  DEFAULT_SEED,
  createSeededRng,
  type FrameInfo,
  type SceneContext,
  type SystemRegistration,
} from '../core/sceneContext';
import {
  AUDIO_BUS_NAMES,
  CUE_BUS_NAMES,
  DEFAULT_CUE_BUS,
  ERA_WHOOSH_CUE,
  SFX_CUE_ALIASES,
  assertBusName,
  clamp,
  createSfxLibrary,
  isCueBusName,
  resolveCueAlias,
  type AudioBusName,
  type CueBusName,
  type CueDefinition,
  type CueSynthContext,
  type SynthVoice,
} from './sfxSynth';

export const AUDIO_DIRECTOR_VERSION = 1;

/** Global key the live director is published on for overlays and harnesses. */
export const AUDIO_GLOBAL_KEY = '__chronoCityAudio';

/** Attribute (and selector) of the unlock/mute affordance button. */
export const AUDIO_UNLOCK_ATTRIBUTE = 'data-chrono-audio-unlock';

/** System id used when the director joins the `SceneContext` tick loop. */
export const AUDIO_SYSTEM_ID = 'audio-director';

/** Late in the frame, so the listener reflects this frame's camera. */
export const AUDIO_SYSTEM_ORDER = 90;

/** Label of the unlock button before the first gesture. */
export const AUDIO_UNLOCK_LABEL = 'Enable sound';

/** Gestures that count as a user activation for autoplay purposes. */
export const AUDIO_UNLOCK_EVENTS: readonly string[] = ['pointerdown', 'keydown', 'touchstart'];

export const DEFAULT_MASTER_VOLUME = 0.85;

/** Per-bus gain staging. `sfx` leads; beds sit underneath it. */
export const DEFAULT_BUS_VOLUMES: Readonly<Record<CueBusName, number>> = Object.freeze({
  sfx: 0.9,
  music: 0.7,
  ambience: 0.55,
});

export const DEFAULT_MAX_VOICES = 32;

/** Default era tween length when a transition does not specify one. */
export const DEFAULT_ERA_TRANSITION_MS = 1400;

export const DEFAULT_REF_DISTANCE = 8;
export const DEFAULT_MAX_DISTANCE = 240;
export const DEFAULT_ROLLOFF_FACTOR = 1.15;

/* ------------------------------------------------------------------------- *
 * Small math/typing helpers
 * ------------------------------------------------------------------------- */

/** Any world-space position, including a `THREE.Vector3`. */
export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Euclidean distance between two world-space positions. */
export function distanceBetween(a: Vector3Like, b: Vector3Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export interface DistanceRolloffOptions {
  /** Distance at which the emitter is at full volume. */
  readonly refDistance?: number;
  /** Distance at which the emitter goes silent. */
  readonly maxDistance?: number;
  /** How fast volume falls away between the two distances. */
  readonly rolloffFactor?: number;
}

/**
 * Inverse-distance rolloff, matching the Web Audio `inverse` distance model but
 * computed on the CPU as well so emitter volumes are observable and testable.
 *
 * Returns `1` at (or inside) `refDistance`, falls monotonically and reaches
 * exactly `0` at `maxDistance`, with a smooth edge so emitters fade out instead
 * of popping when they cross the boundary.
 */
export function rolloffGain(distance: number, options: DistanceRolloffOptions = {}): number {
  if (!Number.isFinite(distance)) return 0;
  const reference = Math.max(0.01, options.refDistance ?? DEFAULT_REF_DISTANCE);
  const maximum = Math.max(reference, options.maxDistance ?? DEFAULT_MAX_DISTANCE);
  const rolloff = Math.max(0, options.rolloffFactor ?? DEFAULT_ROLLOFF_FACTOR);
  const clamped = Math.max(distance, reference);
  if (clamped >= maximum) return 0;

  const inverse = reference / (reference + rolloff * (clamped - reference));
  const span = maximum - reference;
  if (span <= 0) return clamp01(inverse);

  // Only the last quarter of the range is faded, which keeps the curve honest
  // in the useful part of the field and silent at the boundary.
  const edge = smoothStep01((maximum - clamped) / (span * 0.25));
  return clamp01(inverse * edge);
}

/** Writes a gain-style param: a short ramp for the ear, the final value for readers. */
function writeParam(param: AudioParam, target: number, context: BaseAudioContext | null, seconds = 0.02): void {
  const now = context && Number.isFinite(context.currentTime) ? context.currentTime : 0;
  if (seconds > 0 && typeof param.setValueAtTime === 'function' && typeof param.linearRampToValueAtTime === 'function') {
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + seconds);
    } catch (error) {
      void error; // automation is a nicety; the assignment below still lands
    }
  }
  param.value = target;
}

function writeAudioParam(param: AudioParam | undefined | null, target: number): void {
  if (!param || typeof param.value !== 'number') return;
  try {
    param.value = target;
  } catch (error) {
    void error;
  }
}

/** Positions a panner, preferring the modern `AudioParam` triple. */
function setPannerPosition(panner: PannerNode, position: Vector3Like): void {
  const { positionX, positionY, positionZ } = panner;
  if (positionX && positionY && positionZ) {
    writeAudioParam(positionX, position.x);
    writeAudioParam(positionY, position.y);
    writeAudioParam(positionZ, position.z);
    return;
  }
  const legacy = panner as unknown as {
    setPosition?: (x: number, y: number, z: number) => void;
    position?: { set: (x: number, y: number, z: number) => void };
  };
  if (typeof legacy.setPosition === 'function') legacy.setPosition(position.x, position.y, position.z);
  else legacy.position?.set(position.x, position.y, position.z);
}

/** Connects two graph endpoints (overloaded `connect` needs the cast). */
function connectNodes(from: AudioNode, to: AudioNode): void {
  (from.connect as (destination: AudioNode) => unknown)(to);
}

/* ------------------------------------------------------------------------- *
 * Environment support
 * ------------------------------------------------------------------------- */

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

/**
 * The audio context surface the director drives. `BaseAudioContext` covers the
 * node factories and the graph, but `resume` / `suspend` / `close` live on the
 * concrete context (and on the headless fakes used in tests), so the engine
 * types that superset explicitly.
 */
export interface AudioEngineContext extends BaseAudioContext {
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

interface AudioGlobal {
  readonly AudioContext?: AudioContextConstructor;
  readonly webkitAudioContext?: AudioContextConstructor;
}

/** `true` when the running environment can synthesize audio at all. */
export function supportsWebAudio(scope: unknown = globalThis): boolean {
  if (!scope) return false;
  const candidate = scope as AudioGlobal;
  return (
    typeof candidate.AudioContext === 'function' || typeof candidate.webkitAudioContext === 'function'
  );
}

/** Creates the platform `AudioContext`, or `null` when the platform has none. */
function createPlatformAudioContext(): AudioEngineContext | null {
  const scope = globalThis as unknown as AudioGlobal;
  const Constructor = scope.AudioContext ?? scope.webkitAudioContext;
  if (typeof Constructor !== 'function') return null;
  try {
    return new Constructor({ latencyHint: 'interactive' });
  } catch (error) {
    void error;
    try {
      return new Constructor();
    } catch (error_) {
      console.warn('[chrono-city] audio: AudioContext could not be created', error_);
      return null;
    }
  }
}

function resolveDocument(documentRef?: Document | null): Document | null {
  if (documentRef) return documentRef;
  return typeof document === 'undefined' ? null : document;
}

/* ------------------------------------------------------------------------- *
 * Listener, voices, emitters
 * ------------------------------------------------------------------------- */

/** three.js-compatible listener state fed from the scene camera. */
export interface ListenerState {
  readonly position: Vector3Like;
  readonly forward: Vector3Like;
  readonly up: Vector3Like;
}

/** One playing voice, as handed back by `play()`. */
export interface AudioCueHandle {
  /** Unique, monotonically increasing voice id. */
  readonly id: number;
  /** Resolved cue name (era-scoped when an era-scoped cue is registered). */
  readonly cue: string;
  /** Bus the voice is routed through. */
  readonly bus: AudioBusName;
  /** `true` when the voice has a panner and distance rolloff. */
  readonly positional: boolean;
  /** Audio-context time the voice started at. */
  readonly startedAt: number;
  /** Per-voice staging gain (distance attenuation for spatial voices). */
  readonly gainNode: GainNode;
  /** Spatial node, or `null` for a non-positional voice. */
  readonly panner: PannerNode | null;
  /** Nodes the cue synthesized for this voice. */
  readonly nodes: readonly AudioNode[];
  /** `true` once the voice stopped or its sources ended. */
  readonly finished: boolean;
  /** Replaces the staging gain (distance attenuation for spatial voices). */
  setGain(value: number): void;
  /** Moves a positional voice; a no-op for non-positional voices. */
  setPosition(position: Vector3Like): void;
  /** Stops the voice now (or at `when`). Idempotent. */
  stop(when?: number): void;
}

interface VoiceHandleFields {
  readonly id: number;
  readonly cue: string;
  readonly bus: AudioBusName;
  readonly positional: boolean;
  readonly startedAt: number;
  readonly gainNode: GainNode;
  readonly panner: PannerNode | null;
  readonly voice: SynthVoice;
  readonly spatialPosition: THREE.Vector3 | null;
  readonly initialGain: number;
  readonly onFinished: (id: number) => void;
}

class VoiceHandle implements AudioCueHandle {
  readonly id: number;
  readonly cue: string;
  readonly bus: AudioBusName;
  readonly positional: boolean;
  readonly startedAt: number;
  readonly gainNode: GainNode;
  readonly panner: PannerNode | null;
  readonly nodes: readonly AudioNode[];

  /** Emitter that owns this voice, when it was spawned by one. */
  owner: PositionalEmitter | null = null;

  private readonly synth: SynthVoice;
  private readonly onFinished: (id: number) => void;
  private readonly spatial: THREE.Vector3 | null;
  private finishedState = false;

  constructor(fields: VoiceHandleFields) {
    this.id = fields.id;
    this.cue = fields.cue;
    this.bus = fields.bus;
    this.positional = fields.positional;
    this.startedAt = fields.startedAt;
    this.gainNode = fields.gainNode;
    this.panner = fields.panner;
    this.synth = fields.voice;
    this.nodes = fields.voice.nodes;
    this.spatial = fields.spatialPosition;
    this.onFinished = fields.onFinished;
    this.applyGain(fields.initialGain);
  }

  get finished(): boolean {
    return this.finishedState;
  }

  /** Source whose `ended` event ends the voice. */
  get endSignal(): AudioScheduledSourceNode | null {
    return this.synth.endSignal;
  }

  /** Current world-space position of a positional voice. */
  get position(): THREE.Vector3 | null {
    return this.spatial;
  }

  setGain(value: number): void {
    this.applyGain(value);
  }

  setPosition(position: Vector3Like): void {
    if (!this.spatial || !this.panner) return;
    this.spatial.set(position.x, position.y, position.z);
    setPannerPosition(this.panner, this.spatial);
  }

  stop(when?: number): void {
    if (this.finishedState) return;
    this.synth.stop(when);
    this.finish();
  }

  /** Marks the voice finished and lets the director release its nodes. */
  finish(): void {
    if (this.finishedState) return;
    this.finishedState = true;
    this.onFinished(this.id);
  }

  private applyGain(value: number): void {
    writeAudioParam(this.gainNode.gain, clamp(value, 0, 4));
  }
}

/** A 3D emitter bound to a world position or to a live `Object3D`. */
export interface PositionalEmitter {
  /** Stable id used for lookup and diagnostics. */
  readonly id: string;
  /** Cue the emitter plays. */
  readonly cue: string;
  /** Bus the emitter plays through. */
  readonly bus: CueBusName;
  /** Current world-space position (refreshed every tick when bound to an object). */
  readonly position: Vector3Like;
  /** Metres to the listener, as of the last tick. */
  readonly distance: number;
  /** Distance rolloff multiplier applied to `gain`, as of the last tick. */
  readonly attenuation: number;
  /** Base gain before rolloff. */
  readonly gain: number;
  /** `true` while a voice is sounding. */
  readonly isPlaying: boolean;
  /** The live voice, or `null`. */
  readonly handle: AudioCueHandle | null;
  /** Rolloff settings in force. */
  readonly rolloff: DistanceRolloffOptions;
  setPosition(position: Vector3Like): void;
  /** Binds (or unbinds with `null`) an `Object3D` whose world position wins. */
  bind(object: THREE.Object3D | null): void;
  setGain(value: number): void;
  /** Starts one voice through the director; positional and rolloff-aware. */
  play(): AudioCueHandle | null;
  stop(when?: number): void;
  dispose(): void;
}

export interface PositionalEmitterOptions extends DistanceRolloffOptions {
  /** Stable id, unique per director. */
  readonly id: string;
  /** Cue to play (name or alias; era-scoped names resolve like `play()`). */
  readonly cue: string;
  readonly bus?: CueBusName;
  /** Fixed world position; overridden by `object` when both are given. */
  readonly position?: Vector3Like;
  /** Object whose world position is tracked every frame. */
  readonly object?: THREE.Object3D | null;
  /** Base gain before rolloff. Defaults to `1`. */
  readonly gain?: number;
  /** Pitch/rate multiplier for the cue. Defaults to `1`. */
  readonly rate?: number;
  /** Start sounding as soon as audio is unlocked (until `stop()`). */
  readonly autoStart?: boolean;
  /** Retrigger interval in milliseconds for non-looping cues. */
  readonly retriggerMs?: number;
  /** Era used when resolving the cue name. */
  readonly era?: EraId;
}

class Emitter implements PositionalEmitter {
  readonly id: string;
  readonly cue: string;
  readonly bus: CueBusName;
  readonly rolloff: DistanceRolloffOptions;
  readonly position = new THREE.Vector3();

  private readonly director: AudioDirector;
  private readonly autoStart: boolean;
  private readonly retriggerSeconds: number;
  private readonly rate: number;
  private readonly era: EraId | undefined;

  private objectRef: THREE.Object3D | null;
  private handleRef: AudioCueHandle | null = null;
  private gainState: number;
  private attenuationState = 1;
  private distanceState = 0;
  private lastStartSeconds = Number.NEGATIVE_INFINITY;
  private disposedState = false;

  constructor(director: AudioDirector, options: PositionalEmitterOptions) {
    if (!options || typeof options.id !== 'string' || options.id.length === 0) {
      throw new TypeError('registerEmitter() requires a non-empty emitter id.');
    }
    if (typeof options.cue !== 'string' || options.cue.length === 0) {
      throw new TypeError(`Emitter "${options.id}" needs a cue name.`);
    }

    this.director = director;
    this.id = options.id;
    this.cue = options.cue;
    this.bus = options.bus ?? DEFAULT_CUE_BUS;
    this.autoStart = options.autoStart ?? false;
    this.retriggerSeconds = Math.max(0, (options.retriggerMs ?? 0) / 1000);
    this.rate = clamp(options.rate ?? 1, 0.25, 4);
    this.era = options.era;
    this.gainState = clamp(options.gain ?? 1, 0, 4);
    this.objectRef = options.object ?? null;
    this.rolloff = Object.freeze({
      refDistance: options.refDistance ?? DEFAULT_REF_DISTANCE,
      maxDistance: options.maxDistance ?? DEFAULT_MAX_DISTANCE,
      rolloffFactor: options.rolloffFactor ?? DEFAULT_ROLLOFF_FACTOR,
    });

    const start = options.position ?? { x: 0, y: 0, z: 0 };
    this.position.set(start.x, start.y, start.z);
    this.syncFromObject();
  }

  get distance(): number {
    return this.distanceState;
  }

  get attenuation(): number {
    return this.attenuationState;
  }

  get gain(): number {
    return this.gainState;
  }

  get isPlaying(): boolean {
    const handle = this.handleRef;
    return Boolean(handle && !handle.finished && this.director.hasVoice(handle));
  }

  get handle(): AudioCueHandle | null {
    return this.handleRef;
  }

  setPosition(position: Vector3Like): void {
    this.position.set(position.x, position.y, position.z);
  }

  bind(object: THREE.Object3D | null): void {
    this.objectRef = object;
    this.syncFromObject();
  }

  setGain(value: number): void {
    this.gainState = clamp(value, 0, 4);
  }

  play(): AudioCueHandle | null {
    if (this.disposedState) return null;
    this.syncFromObject();
    const handle = this.director.play(this.cue, {
      bus: this.bus,
      position: this.position,
      gain: 1,
      rate: this.rate,
      era: this.era,
    });
    if (!handle) return null;
    this.handleRef = handle;
    this.director.adoptEmitterVoice(this, handle);
    this.applySpatial();
    return handle;
  }

  stop(when?: number): void {
    this.handleRef?.stop(when);
    this.handleRef = null;
  }

  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.stop();
  }

  /** Refreshes position, distance and attenuation; called once per tick. */
  update(elapsedSeconds: number): void {
    if (this.disposedState) return;
    this.syncFromObject();

    const listener = this.director.listener;
    this.distanceState = distanceBetween(this.position, listener.position);
    this.attenuationState = rolloffGain(this.distanceState, this.rolloff);

    const handle = this.handleRef;
    if (handle && (handle.finished || !this.director.hasVoice(handle))) {
      this.handleRef = null;
    }

    if (this.handleRef) this.applySpatial();
    else if (this.autoStart && this.director.isUnlocked) this.autoTrigger(elapsedSeconds);
  }

  private autoTrigger(elapsedSeconds: number): void {
    const interval = this.retriggerSeconds;
    if (interval > 0 && elapsedSeconds - this.lastStartSeconds < interval) return;
    this.lastStartSeconds = elapsedSeconds;
    this.play();
  }

  private applySpatial(): void {
    const handle = this.handleRef;
    if (!handle) return;
    handle.setPosition(this.position);
    handle.setGain(this.gainState * this.attenuationState);
  }

  private syncFromObject(): void {
    const object = this.objectRef;
    if (!object || typeof object.getWorldPosition !== 'function') return;
    object.getWorldPosition(this.position);
  }
}

/* ------------------------------------------------------------------------- *
 * Director
 * ------------------------------------------------------------------------- */

export type AudioEngineState =
  | 'idle'
  | 'locked'
  | 'running'
  | 'suspended'
  | 'unsupported'
  | 'disposed';

export interface AudioDirectorOptions {
  /** Context factory override (tests, headless hosts). `null` = no audio. */
  readonly createAudioContext?: () => AudioEngineContext | null;
  readonly masterVolume?: number;
  readonly busVolumes?: Partial<Record<CueBusName, number>>;
  readonly muted?: boolean;
  /** Cues registered at construction time. */
  readonly cues?: readonly CueDefinition[];
  readonly aliases?: Readonly<Record<string, string>>;
  readonly seed?: number;
  readonly maxVoices?: number;
  readonly documentRef?: Document | null;
  readonly rolloff?: DistanceRolloffOptions;
}

export interface PlayCueOptions {
  readonly bus?: CueBusName;
  /** Era used to resolve era-scoped cue names; defaults to the active era. */
  readonly era?: EraId;
  /** World-space position; supplying one makes the voice positional. */
  readonly position?: Vector3Like;
  /** Force positional synthesis on/off when a position is supplied. */
  readonly spatial?: boolean;
  /** Musical gain baked into the synthesis. Defaults to `1`. */
  readonly gain?: number;
  /** Pitch/rate multiplier. Defaults to `1`. */
  readonly rate?: number;
  /** Seconds to delay the voice. Defaults to `0`. */
  readonly delay?: number;
  /** Override the cue's own loop flag. */
  readonly loop?: boolean;
  /** Deterministic noise seed for this voice. */
  readonly seed?: number;
}

export interface AttachAudioOptions {
  readonly systemId?: string;
  readonly order?: number;
}

/** Frame state the director needs from the scene: the camera and the clock. */
export interface AudioSceneSource {
  readonly camera: THREE.Camera;
  readonly elapsed?: number;
  readonly frameCount?: number;
}

/** Flat, serialisable view of the engine for overlays and browser harnesses. */
export interface AudioDirectorSnapshot {
  readonly state: AudioEngineState;
  readonly unlocked: boolean;
  readonly muted: boolean;
  readonly masterVolume: number;
  readonly busVolumes: Readonly<Record<CueBusName, number>>;
  readonly busGains: Readonly<Record<AudioBusName, number>>;
  readonly era: EraId;
  readonly eraFrom: EraId;
  readonly eraTarget: EraId;
  readonly eraBlend: number;
  readonly eraTransitionActive: boolean;
  readonly cueNames: readonly string[];
  readonly activeVoiceCount: number;
  readonly emitterCount: number;
  readonly tickCount: number;
  readonly listener: ListenerState;
}

/**
 * The audio engine. Implements `EraBlendable`, so a timeline system can hand it
 * the same `setEra` / `updateEraTransition` calls it hands everything else.
 */
export class AudioDirector implements EraBlendable {
  readonly version = AUDIO_DIRECTOR_VERSION;

  private readonly contextFactory: () => AudioEngineContext | null;
  private readonly hasExplicitFactory: boolean;
  private readonly random: ReturnType<typeof createSeededRng>;
  private readonly maxVoices: number;
  private readonly rolloffOptions: DistanceRolloffOptions;
  private readonly aliases = new Map<string, string>();
  private readonly cues = new Map<string, CueDefinition>();
  private readonly voices = new Map<number, VoiceHandle>();
  private readonly emitterMap = new Map<string, Emitter>();
  private readonly busNodes = new Map<AudioBusName, GainNode>();

  private readonly busVolumes: Record<CueBusName, number>;
  private listenerPosition = new THREE.Vector3();
  private listenerForward = new THREE.Vector3(0, 0, -1);
  private listenerUp = new THREE.Vector3(0, 1, 0);

  private readonly tmpPosition = new THREE.Vector3();
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpQuaternion = new THREE.Quaternion();

  private readonly onAffordanceClick = (): void => {
    if (!this.unlockedState) {
      void this.unlock();
      return;
    }
    this.toggleMute();
  };

  private audioContextValue: AudioEngineContext | null = null;
  private masterVolumeState: number;
  private mutedState: boolean;
  private unlockedState = false;
  private contextUnavailable = false;
  private disposedState = false;
  private nextVoiceId = 1;
  private tickCountState = 0;
  private lastElapsed = 0;
  private lastFrameValue = -1;
  private registration: SystemRegistration | null = null;
  private gestureDetach: (() => void) | null = null;
  private affordance: HTMLButtonElement | null = null;
  private affordanceLabel = AUDIO_UNLOCK_LABEL;
  private documentRef: Document | null;

  private eraState: EraId = DEFAULT_ERA;
  private eraTargetState: EraId = DEFAULT_ERA;
  private eraFromState: EraId = DEFAULT_ERA;
  private eraBlendState = 1;
  private eraTransitionActiveState = false;
  private transitionDurationMs = 0;
  private transitionElapsedMs = 0;
  private eraBusScale: Record<CueBusName, number> = { sfx: 1, music: 1, ambience: 1 };

  constructor(options: AudioDirectorOptions = {}) {
    this.contextFactory = options.createAudioContext ?? createPlatformAudioContext;
    this.hasExplicitFactory = typeof options.createAudioContext === 'function';
    this.masterVolumeState = clamp(options.masterVolume ?? DEFAULT_MASTER_VOLUME, 0, 4);
    this.mutedState = options.muted ?? false;
    this.random = createSeededRng(options.seed ?? DEFAULT_SEED);
    this.maxVoices = Math.max(1, Math.floor(options.maxVoices ?? DEFAULT_MAX_VOICES));
    this.documentRef = resolveDocument(options.documentRef);
    this.rolloffOptions = options.rolloff ?? {};

    this.busVolumes = { ...DEFAULT_BUS_VOLUMES };
    if (options.busVolumes) {
      for (const bus of CUE_BUS_NAMES) {
        const volume = options.busVolumes[bus];
        if (typeof volume === 'number') this.busVolumes[bus] = clamp(volume, 0, 4);
      }
    }

    for (const [alias, target] of Object.entries(SFX_CUE_ALIASES)) this.aliases.set(alias, target);
    if (options.aliases) {
      for (const [alias, target] of Object.entries(options.aliases)) this.aliases.set(alias, target);
    }

    if (options.cues) this.registerCues(options.cues);
    this.syncDomState();
  }

  /* ---------------- engine state ---------------- */

  /** `true` when this environment can create an `AudioContext`. */
  canCreateContext(): boolean {
    return !this.contextUnavailable && (this.hasExplicitFactory || supportsWebAudio());
  }

  get state(): AudioEngineState {
    if (this.disposedState) return 'disposed';
    const context = this.audioContextValue;
    if (context) {
      if (context.state === 'running') return 'running';
      if (context.state === 'closed') return 'suspended';
      return this.unlockedState ? 'suspended' : 'locked';
    }
    return this.canCreateContext() ? 'idle' : 'unsupported';
  }

  get engineState(): AudioEngineState {
    return this.state;
  }

  /** Live context, or `null` before the first sound (creation is lazy). */
  get context(): AudioEngineContext | null {
    return this.audioContextValue;
  }

  get isUnlocked(): boolean {
    return this.unlockedState;
  }

  get isMuted(): boolean {
    return this.mutedState;
  }

  get masterVolume(): number {
    return this.masterVolumeState;
  }

  /** Effective gain of the `master` bus node (what a browser probe reads). */
  get masterGainValue(): number {
    const node = this.busNodes.get('master');
    return node ? node.gain.value : 0;
  }

  get tickCount(): number {
    return this.tickCountState;
  }

  get lastFrame(): number {
    return this.lastFrameValue;
  }

  /** Creates the context (and its bus graph) on first use. */
  ensureContext(): AudioEngineContext | null {
    if (this.disposedState) return null;
    if (this.audioContextValue) return this.audioContextValue;
    if (!this.canCreateContext()) {
      this.contextUnavailable = true;
      this.syncDomState();
      return null;
    }

    let context: AudioEngineContext | null = null;
    try {
      context = this.contextFactory();
    } catch (error) {
      console.warn('[chrono-city] audio: context factory failed', error);
    }
    if (!context) {
      this.contextUnavailable = true;
      this.syncDomState();
      return null;
    }

    this.audioContextValue = context;
    this.buildGraph(context);
    this.pushListener();
    this.syncDomState();
    return context;
  }

  /**
   * Resumes the context on a user gesture. Safe to call repeatedly, and never
   * throws: a rejected `resume()` simply leaves the engine locked.
   */
  async unlock(): Promise<boolean> {
    if (this.disposedState) return false;
    const context = this.ensureContext();
    if (!context) return false;

    if (this.isContextRunning(context)) {
      this.markUnlocked();
      return true;
    }
    try {
      await context.resume();
    } catch (error) {
      void error; // autoplay policy refused the resume; stay locked
    }
    if (this.isContextRunning(context)) {
      this.markUnlocked();
      return true;
    }
    this.syncDomState();
    return false;
  }

  /**
   * Auto-unlocks on the first user gesture (pointer, key or touch), the
   * autoplay-policy-safe half of the unlock contract. Returns a detach function.
   */
  attachGestureUnlock(
    target: EventTarget | null = this.documentRef,
    events: readonly string[] = AUDIO_UNLOCK_EVENTS,
  ): () => void {
    if (!target || typeof target.addEventListener !== 'function') return () => undefined;
    this.detachGestureUnlock();

    let attached = true;
    const detach = (): void => {
      if (!attached) return;
      attached = false;
      for (const event of events) target.removeEventListener(event, onGesture, true);
      if (this.gestureDetach === detach) this.gestureDetach = null;
    };
    const onGesture = (): void => {
      detach();
      void this.unlock().then((ok) => {
        // A gesture that could not resume (rare Safari ordering) re-arms.
        if (!ok && !this.disposedState && !attached) {
          attached = true;
          for (const event of events) {
            target.addEventListener(event, onGesture, { capture: true, passive: true });
          }
        }
      });
    };

    for (const event of events) {
      target.addEventListener(event, onGesture, { capture: true, passive: true });
    }
    this.gestureDetach = detach;
    return detach;
  }

  /** Removes the gesture listeners installed by `attachGestureUnlock()`. */
  detachGestureUnlock(): void {
    const detach = this.gestureDetach;
    this.gestureDetach = null;
    detach?.();
  }

  /**
   * Creates the visible unlock affordance. Before the first gesture it unlocks
   * the context; afterwards it is the persistent mute toggle.
   */
  createUnlockAffordance(options: UnlockAffordanceOptions = {}): HTMLButtonElement | null {
    const doc = resolveDocument(options.documentRef ?? this.documentRef);
    if (!doc || !doc.body) return null;
    this.documentRef = doc;
    if (this.affordance) return this.affordance;

    const existing = doc.querySelector<HTMLButtonElement>(`[${AUDIO_UNLOCK_ATTRIBUTE}]`);
    const button = existing ?? doc.createElement('button');
    if (!existing) {
      button.type = 'button';
      button.setAttribute(AUDIO_UNLOCK_ATTRIBUTE, '');
      button.id = 'chrono-audio-unlock';
      button.style.cssText = AUDIO_AFFORDANCE_CSS;
    }
    button.addEventListener('click', this.onAffordanceClick);
    const container = options.container ?? doc.querySelector('[data-chrono-overlay]') ?? doc.body;
    if (!container.contains(button)) container.appendChild(button);

    this.affordance = button;
    this.affordanceLabel = options.label ?? AUDIO_UNLOCK_LABEL;
    this.syncAffordance();
    return button;
  }

  /* ---------------- mixer ---------------- */

  get masterGainNode(): GainNode | null {
    return this.busNodes.get('master') ?? null;
  }

  /** Bus node, or `null` before the context exists. */
  getBusGain(bus: AudioBusName): GainNode | null {
    return this.busNodes.get(assertBusName(bus)) ?? null;
  }

  getBusVolume(bus: CueBusName): number {
    return this.busVolumes[bus];
  }

  setBusVolume(bus: CueBusName, volume: number): void {
    if (!isCueBusName(bus)) {
      throw new RangeError(`Unknown cue bus ${String(bus)}.`);
    }
    this.busVolumes[bus] = clamp(volume, 0, 4);
    this.applyBusGains();
    this.syncDomState();
  }

  setMasterVolume(volume: number): void {
    this.masterVolumeState = clamp(volume, 0, 4);
    this.applyBusGains();
    this.syncDomState();
  }

  setMuted(muted: boolean): void {
    const next = Boolean(muted);
    if (next === this.mutedState) {
      this.applyBusGains();
      return;
    }
    this.mutedState = next;
    this.applyBusGains();
    this.syncDomState();
  }

  toggleMute(): boolean {
    this.setMuted(!this.mutedState);
    return this.mutedState;
  }

  /**
   * Effective gain of a bus. The `master` bus carries the mute, so one mute
   * silences everything at once without destroying the per-bus staging; the
   * non-terminal buses report their volume times the era crossfade scaling.
   */
  effectiveBusGain(bus: AudioBusName): number {
    if (bus === 'master') return this.mutedState ? 0 : clamp(this.masterVolumeState, 0, 4);
    return clamp(this.busVolumes[bus] * (this.eraBusScale[bus] ?? 1), 0, 4);
  }

  get busGains(): Readonly<Record<AudioBusName, number>> {
    const gains = {} as Record<AudioBusName, number>;
    for (const bus of AUDIO_BUS_NAMES) gains[bus] = this.effectiveBusGain(bus);
    return gains;
  }

  /* ---------------- cue registry ---------------- */

  registerCue(definition: CueDefinition): this {
    if (!definition || typeof definition.name !== 'string' || definition.name.length === 0) {
      throw new TypeError('registerCue() requires a cue with a non-empty name.');
    }
    if (typeof definition.render !== 'function') {
      throw new TypeError(`Cue "${definition.name}" must implement render().`);
    }
    const bus = isCueBusName(definition.bus) ? definition.bus : DEFAULT_CUE_BUS;
    const stored = bus === definition.bus ? definition : { ...definition, bus };
    this.cues.set(definition.name, stored);
    this.syncDomState();
    return this;
  }

  registerCues(input: readonly CueDefinition[] | Record<string, CueDefinition>): this {
    const definitions = Array.isArray(input) ? input : Object.values(input ?? {});
    for (const definition of definitions) this.registerCue(definition);
    return this;
  }

  /** Registers an alias so `play(alias)` reaches `target`. */
  registerCueAlias(alias: string, target: string): this {
    if (typeof alias !== 'string' || alias.length === 0) {
      throw new TypeError('registerCueAlias() requires a non-empty alias.');
    }
    this.aliases.set(alias.trim(), resolveCueAlias(target));
    return this;
  }

  hasCue(name: string): boolean {
    return this.cues.has(resolveCueAlias(name)) || this.cues.has(name);
  }

  getCue(name: string): CueDefinition | undefined {
    return this.cues.get(resolveCueAlias(name)) ?? this.cues.get(name);
  }

  get cueNames(): readonly string[] {
    return [...this.cues.keys()].filter((name) => this.cues.has(name));
  }

  get cueCount(): number {
    return this.cues.size;
  }

  /**
   * Resolves a cue name against the registry, preferring an era-scoped
   * registration (`era:1985:traffic`) over the era-neutral one. This is how
   * content tasks re-voice a cue per era without touching call sites.
   */
  resolveCueName(cue: string, era?: EraId): string {
    const base = this.aliases.get(cue) ?? resolveCueAlias(cue);
    const scopedEra = era === undefined ? this.eraForNaming : assertEraId(era);
    const scoped = eraCueName(scopedEra, base);
    if (this.cues.has(scoped)) return scoped;
    return base;
  }

  /** Human-readable route of a voice, for logs and browser assertions. */
  describeRoute(handle: AudioCueHandle | null): readonly string[] {
    if (!handle) return [];
    return [
      'source',
      'gain',
      ...(handle.panner ? ['panner'] : []),
      `bus:${handle.bus}`,
      'master',
      'destination',
    ];
  }

  /* ---------------- playback ---------------- */

  /**
   * Plays a registered cue. Never throws: an unknown cue or an environment
   * without Web Audio logs once and returns `null` so the scene keeps running.
   */
  play(cue: string, options: PlayCueOptions = {}): AudioCueHandle | null {
    if (this.disposedState) return null;

    const resolvedName = this.resolveCueName(cue, options.era);
    const definition = this.cues.get(resolvedName);
    if (!definition) {
      console.warn(`[chrono-city] audio: no cue registered for "${cue}".`);
      return null;
    }

    const context = this.ensureContext();
    if (!context) return null;
    const busNode = this.busNodes.get(options.bus ?? definition.bus) ?? this.busNodes.get(DEFAULT_CUE_BUS);
    if (!busNode) return null;

    // Voice cap: retire the oldest voice so a burst of one-shots cannot pile up.
    while (this.voices.size >= this.maxVoices) {
      const oldest = this.voices.values().next().value as VoiceHandle | undefined;
      if (!oldest) break;
      oldest.stop();
    }

    const position = options.position
      ? new THREE.Vector3(options.position.x, options.position.y, options.position.z)
      : null;
    const positional = position !== null && options.spatial !== false;
    const time = (Number.isFinite(context.currentTime) ? context.currentTime : 0) + Math.max(0, options.delay ?? 0);
    const gain = clamp(options.gain ?? 1, 0, 4);
    const rate = clamp(options.rate ?? 1, 0.25, 4);
    const seed = options.seed ?? this.random.int(1, 0x7fffffff);

    const stage = context.createGain();
    stage.gain.value = 0;
    const panner = positional && position ? this.createPanner(position) : null;

    const synthContext: CueSynthContext = {
      context,
      output: stage,
      time,
      gain,
      rate,
      seed,
      loop: options.loop ?? definition.loop,
    };
    const voice = definition.render(synthContext);

    // Routing: cue sources → staging gain → [panner] → bus → master → destination.
    if (panner) {
      connectNodes(stage, panner);
      connectNodes(panner, busNode);
    } else {
      connectNodes(stage, busNode);
    }

    const initialGain = positional && position
      ? rolloffGain(distanceBetween(this.listenerPosition, position), this.rolloffOptions)
      : 1;

    const handle = new VoiceHandle({
      id: this.nextVoiceId,
      cue: resolvedName,
      bus: options.bus ?? definition.bus,
      positional: panner !== null,
      startedAt: time,
      gainNode: stage,
      panner,
      voice,
      spatialPosition: position,
      initialGain,
      onFinished: (id) => this.releaseVoice(id),
    });
    this.nextVoiceId += 1;
    this.voices.set(handle.id, handle);
    this.attachVoiceEnd(handle);
    return handle;
  }

  get activeVoices(): readonly AudioCueHandle[] {
    return [...this.voices.values()];
  }

  get activeVoiceCount(): number {
    return this.voices.size;
  }

  hasVoice(handle: AudioCueHandle): boolean {
    return this.voices.has(handle.id);
  }

  stopAll(): void {
    for (const voice of [...this.voices.values()]) voice.stop();
  }

  /* ---------------- listener + emitters ---------------- */

  get listener(): ListenerState {
    return {
      position: this.listenerPosition,
      forward: this.listenerForward,
      up: this.listenerUp,
    };
  }

  setListener(state: Partial<ListenerState>): void {
    if (state.position) this.listenerPosition.set(state.position.x, state.position.y, state.position.z);
    if (state.forward) this.listenerForward.set(state.forward.x, state.forward.y, state.forward.z);
    if (state.up) this.listenerUp.set(state.up.x, state.up.y, state.up.z);
    this.pushListener();
  }

  /** Feeds the listener from the camera — three.js-compatible orientation. */
  updateListenerFromCamera(camera: THREE.Camera): void {
    if (!camera || typeof camera.getWorldPosition !== 'function') return;
    camera.getWorldPosition(this.tmpPosition);
    camera.getWorldDirection(this.tmpForward);
    const quaternion = camera.getWorldQuaternion(this.tmpQuaternion);
    this.tmpUp.set(0, 1, 0).applyQuaternion(quaternion);
    this.setListener({ position: this.tmpPosition, forward: this.tmpForward, up: this.tmpUp });
  }

  registerEmitter(options: PositionalEmitterOptions): PositionalEmitter {
    if (this.emitterMap.has(options?.id)) {
      throw new Error(`Emitter "${options.id}" is already registered.`);
    }
    const emitter = new Emitter(this, options);
    this.emitterMap.set(emitter.id, emitter);
    return emitter;
  }

  unregisterEmitter(id: string): boolean {
    const emitter = this.emitterMap.get(id);
    if (!emitter) return false;
    this.emitterMap.delete(id);
    emitter.dispose();
    return true;
  }

  getEmitter(id: string): PositionalEmitter | undefined {
    return this.emitterMap.get(id);
  }

  get emitters(): readonly PositionalEmitter[] {
    return [...this.emitterMap.values()];
  }

  get emitterCount(): number {
    return this.emitterMap.size;
  }

  /* ---------------- scene integration ---------------- */

  /** Joins the `SceneContext` tick loop and frames the listener. */
  attach(scene: SceneContext, options: AttachAudioOptions = {}): SystemRegistration {
    this.registration?.dispose();
    const registration = scene.registerSystem(
      options.systemId ?? AUDIO_SYSTEM_ID,
      (context, frame) => this.tick(context, frame),
      { order: options.order ?? AUDIO_SYSTEM_ORDER },
    );
    this.registration = registration;
    this.updateListenerFromCamera(scene.camera);
    return registration;
  }

  /**
   * One audio frame: refresh the listener from the camera, then update every
   * emitter and one-shot spatial voice against it.
   */
  tick(scene: AudioSceneSource, frame?: FrameInfo): void {
    if (this.disposedState) return;
    this.updateListenerFromCamera(scene.camera);
    const elapsed = frame?.elapsed ?? scene.elapsed ?? this.lastElapsed;
    this.tickCountState += 1;
    this.lastFrameValue = frame?.frame ?? scene.frameCount ?? this.lastFrameValue + 1;
    this.lastElapsed = elapsed;

    for (const emitter of this.emitterMap.values()) emitter.update(elapsed);

    for (const voice of [...this.voices.values()]) {
      const position = voice.position;
      if (voice.owner || !voice.panner || !position) continue;
      voice.setPosition(position);
      voice.setGain(rolloffGain(distanceBetween(this.listenerPosition, position), this.rolloffOptions));
    }
  }

  /* ---------------- era blending ---------------- */

  get era(): EraId {
    return this.eraState;
  }

  get eraFrom(): EraId {
    return this.eraFromState;
  }

  get eraTarget(): EraId {
    return this.eraTargetState;
  }

  get eraBlend(): number {
    return this.eraBlendState;
  }

  get eraTransitionActive(): boolean {
    return this.eraTransitionActiveState;
  }

  get eraTransition(): { readonly durationMs: number; readonly elapsedMs: number } {
    return { durationMs: this.transitionDurationMs, elapsedMs: this.transitionElapsedMs };
  }

  /**
   * Starts (or snaps) a move to `era`. A tween kicks off the era whoosh and
   * dips the bed buses mid-transition; an immediate switch just lands.
   */
  setEra(era: EraId, options: EraTransitionOptions = {}): void {
    const next = assertEraId(era);
    const previous = this.eraState;
    const durationMs = options.durationMs ?? DEFAULT_ERA_TRANSITION_MS;
    const immediate = options.immediate === true || durationMs <= 0;

    if (immediate) {
      this.eraState = next;
      this.eraTargetState = next;
      this.eraFromState = next;
      this.eraTransitionActiveState = false;
      this.eraBlendState = 1;
      this.transitionDurationMs = 0;
      this.transitionElapsedMs = 0;
      this.applyEraWeights(1);
      this.applyBusGains();
      this.syncDomState();
      return;
    }

    this.eraFromState = previous;
    this.eraTargetState = next;
    this.eraTransitionActiveState = true;
    this.eraBlendState = 0;
    this.transitionDurationMs = durationMs;
    this.transitionElapsedMs = 0;
    this.applyEraWeights(0);
    this.applyBusGains();
    this.syncDomState();
    // The whoosh is the audible seam between two eras.
    this.play(ERA_WHOOSH_CUE, { gain: 1, rate: 0.92 + this.random.next() * 0.16 });
  }

  /** `EraBlendable`: driven once per frame by the timeline system. */
  updateEraTransition(progress: number, transition: EraTransitionInfo): void {
    if (this.disposedState) return;
    const blend = smoothStep01(clamp01(progress));
    this.eraBlendState = blend;
    this.eraFromState = transition.from;
    this.eraTargetState = transition.to;
    this.transitionDurationMs = transition.durationMs;
    this.transitionElapsedMs = transition.elapsedMs;
    this.applyEraWeights(blend);
    this.applyBusGains();

    if (!transition.active || clamp01(progress) >= 1) {
      this.eraState = transition.to;
      this.eraFromState = transition.to;
      this.eraBlendState = 1;
      this.eraTransitionActiveState = false;
      this.applyEraWeights(1);
      this.applyBusGains();
    }
    this.syncDomState();
  }

  /* ---------------- diagnostics + teardown ---------------- */

  snapshot(): AudioDirectorSnapshot {
    return {
      state: this.state,
      unlocked: this.unlockedState,
      muted: this.mutedState,
      masterVolume: this.masterVolumeState,
      busVolumes: { ...this.busVolumes },
      busGains: this.busGains,
      era: this.eraState,
      eraFrom: this.eraFromState,
      eraTarget: this.eraTargetState,
      eraBlend: this.eraBlendState,
      eraTransitionActive: this.eraTransitionActiveState,
      cueNames: this.cueNames,
      activeVoiceCount: this.voices.size,
      emitterCount: this.emitterMap.size,
      tickCount: this.tickCountState,
      listener: this.listener,
    };
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.stopAll();
    this.detachGestureUnlock();
    this.registration?.dispose();
    this.registration = null;
    for (const emitter of this.emitterMap.values()) emitter.dispose();
    this.emitterMap.clear();
    if (this.affordance) {
      this.affordance.removeEventListener('click', this.onAffordanceClick);
      this.affordance.remove();
      this.affordance = null;
    }

    const context = this.audioContextValue;
    this.audioContextValue = null;
    this.busNodes.clear();
    this.voices.clear();
    if (context && typeof context.close === 'function' && context.state !== 'closed') {
      void Promise.resolve(context.close()).catch(() => undefined);
    }
    this.syncDomState();
  }

  /* ---------------- internals ---------------- */

  /** @internal Used by `Emitter` so its voice is exempt from one-shot updates. */
  adoptEmitterVoice(emitter: PositionalEmitter, handle: AudioCueHandle): void {
    const voice = handle as VoiceHandle;
    if (voice instanceof VoiceHandle) voice.owner = emitter;
  }

  private get eraForNaming(): EraId {
    return this.eraTransitionActiveState ? this.eraTargetState : this.eraState;
  }

  private isContextRunning(context: AudioEngineContext): boolean {
    return context.state === 'running';
  }

  private buildGraph(context: AudioEngineContext): void {
    const master = context.createGain();
    master.gain.value = 0;
    connectNodes(master, context.destination);
    this.busNodes.set('master', master);

    for (const bus of CUE_BUS_NAMES) {
      const node = context.createGain();
      node.gain.value = 0;
      connectNodes(node, master);
      this.busNodes.set(bus, node);
    }
    this.applyBusGains();
  }

  private applyBusGains(): void {
    for (const bus of AUDIO_BUS_NAMES) {
      const node = this.busNodes.get(bus);
      if (!node) continue;
      writeParam(node.gain, this.effectiveBusGain(bus), this.audioContextValue, 0.03);
    }
  }

  private applyEraWeights(blend: number): void {
    const dip = Math.sin(Math.PI * clamp01(blend));
    this.eraBusScale = {
      sfx: 1,
      music: 1 - 0.75 * dip,
      ambience: 1 - 0.45 * dip,
    };
  }

  private createPanner(position: Vector3Like): PannerNode {
    const context = this.audioContextValue as AudioEngineContext;
    const panner = context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = this.rolloffOptions.refDistance ?? DEFAULT_REF_DISTANCE;
    panner.maxDistance = this.rolloffOptions.maxDistance ?? DEFAULT_MAX_DISTANCE;
    panner.rolloffFactor = this.rolloffOptions.rolloffFactor ?? DEFAULT_ROLLOFF_FACTOR;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 0;
    setPannerPosition(panner, position);
    return panner;
  }

  private pushListener(): void {
    const context = this.audioContextValue;
    if (!context || !context.listener) return;
    const listener = context.listener;
    writeAudioParam(listener.positionX, this.listenerPosition.x);
    writeAudioParam(listener.positionY, this.listenerPosition.y);
    writeAudioParam(listener.positionZ, this.listenerPosition.z);
    writeAudioParam(listener.forwardX, this.listenerForward.x);
    writeAudioParam(listener.forwardY, this.listenerForward.y);
    writeAudioParam(listener.forwardZ, this.listenerForward.z);
    writeAudioParam(listener.upX, this.listenerUp.x);
    writeAudioParam(listener.upY, this.listenerUp.y);
    writeAudioParam(listener.upZ, this.listenerUp.z);

    const legacy = listener as unknown as {
      setPosition?: (x: number, y: number, z: number) => void;
      setOrientation?: (x: number, y: number, z: number, ux: number, uy: number, uz: number) => void;
    };
    if (typeof legacy.setPosition === 'function' && typeof legacy.setOrientation === 'function') {
      try {
        legacy.setPosition(this.listenerPosition.x, this.listenerPosition.y, this.listenerPosition.z);
        legacy.setOrientation(
          this.listenerForward.x,
          this.listenerForward.y,
          this.listenerForward.z,
          this.listenerUp.x,
          this.listenerUp.y,
          this.listenerUp.z,
        );
      } catch (error) {
        void error;
      }
    }
  }

  private attachVoiceEnd(voice: VoiceHandle): void {
    const signal = voice.endSignal;
    if (!signal) return;
    const onEnded = (): void => {
      voice.finish();
    };
    if (typeof signal.addEventListener === 'function') {
      try {
        signal.addEventListener('ended', onEnded, { once: true });
        return;
      } catch (error) {
        void error;
      }
    }
    signal.onended = onEnded;
  }

  private releaseVoice(id: number): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    this.voices.delete(id);
    for (const node of [voice.gainNode, voice.panner]) {
      if (!node) continue;
      try {
        node.disconnect();
      } catch (error) {
        void error;
      }
    }
  }

  private markUnlocked(): void {
    this.unlockedState = true;
    this.pushListener();
    this.applyBusGains();
    this.syncDomState();
  }

  private syncAffordance(): void {
    const button = this.affordance;
    if (!button) return;
    const affordanceState = !this.unlockedState ? 'locked' : this.mutedState ? 'muted' : 'ready';
    button.dataset.chronoAudioState = affordanceState;
    button.setAttribute('aria-pressed', String(this.mutedState));
    button.setAttribute(
      'aria-label',
      affordanceState === 'locked'
        ? `${this.affordanceLabel} — tap to start Chrono City sound`
        : affordanceState === 'muted'
          ? 'Unmute Chrono City sound'
          : 'Mute Chrono City sound',
    );
    button.textContent =
      affordanceState === 'locked' ? this.affordanceLabel : affordanceState === 'muted' ? 'Sound off' : 'Sound on';
    button.style.opacity = affordanceState === 'muted' ? '0.72' : '1';
    this.documentRef?.documentElement?.setAttribute('data-chrono-audio-state', affordanceState);
  }

  private syncDomState(): void {
    const root = this.documentRef?.documentElement;
    if (!root) return;
    root.dataset.chronoAudio = this.state;
    root.dataset.chronoAudioMuted = String(this.mutedState);
    root.dataset.chronoAudioUnlocked = String(this.unlockedState);
    root.dataset.chronoAudioCues = String(this.cues.size);
    this.syncAffordance();
  }
}

/** Options for the DOM affordance that unlocks (and then mutes) the engine. */
export interface UnlockAffordanceOptions {
  readonly documentRef?: Document | null;
  readonly container?: HTMLElement | null;
  readonly label?: string;
}

/** Inline styling keeps the affordance self-contained (no stylesheet edits). */
const AUDIO_AFFORDANCE_CSS = [
  'position:absolute',
  'right:18px',
  'bottom:18px',
  'z-index:20',
  'margin:0',
  'padding:9px 16px',
  'border-radius:999px',
  'border:1px solid rgba(111,211,255,0.35)',
  'background:rgba(6,12,22,0.72)',
  'color:#e8eef7',
  "font:600 11px/1 'Inter','Segoe UI',system-ui,-apple-system,sans-serif",
  'letter-spacing:0.12em',
  'text-transform:uppercase',
  'cursor:pointer',
  'pointer-events:auto',
  'backdrop-filter:blur(10px)',
  'transition:background 160ms ease,border-color 160ms ease,opacity 160ms ease',
].join(';');

/** Creates the director (`create` half of the lifecycle). */
export function createAudioDirector(options: AudioDirectorOptions = {}): AudioDirector {
  return new AudioDirector(options);
}

/**
 * Canonical, era-scoped cue name: `eraCueName('1985', 'traffic')` →
 * `'era:1985:traffic'`. Registering that name re-voices a cue for one era.
 */
export function eraCueName(era: EraId, cue: string): string {
  return `era:${assertEraId(era)}:${resolveCueAlias(cue)}`;
}

/** Inverse of `eraCueName()`; `null` when the name is not era-scoped. */
export function parseEraCueName(name: string): { readonly era: EraId; readonly cue: string } | null {
  if (typeof name !== 'string' || !name.startsWith('era:')) return null;
  const rest = name.slice(4);
  const separator = rest.indexOf(':');
  if (separator <= 0) return null;
  const era = rest.slice(0, separator);
  const cue = rest.slice(separator + 1);
  if (!isEraId(era) || cue.length === 0) return null;
  return { era, cue };
}

/* ------------------------------------------------------------------------- *
 * Application boot
 * ------------------------------------------------------------------------- */

export interface AudioDirectorBootOptions extends AudioDirectorOptions {
  /** Scene to join: registers the tick system and frames the listener. */
  readonly scene?: SceneContext | null;
  /** Overlay element the unlock affordance is appended to. */
  readonly container?: HTMLElement | null;
  /** Create the unlock/mute affordance. Defaults to `true` when audio works. */
  readonly unlockAffordance?: boolean;
  /** Auto-unlock on the first gesture. Defaults to `true`. */
  readonly autoUnlockOnGesture?: boolean;
  /** Register the built-in cue set. Defaults to `true`. */
  readonly defaultCues?: boolean;
  readonly globalKey?: string;
  readonly systemId?: string;
  readonly systemOrder?: number;
}

/** Handle returned by `bootAudioDirector()`. */
export interface AudioDirectorBoot {
  readonly director: AudioDirector;
  readonly registration: SystemRegistration | null;
  readonly affordance: HTMLElement | null;
  readonly globalKey: string;
  /** Unwinds everything the boot installed (gestures, affordance, system). */
  dispose(): void;
}

/**
 * Boots the audio side of the app: builds the director, registers the base cue
 * set, installs the gesture-gated unlock (plus its affordance) and joins the
 * scene tick loop. Audio is additive and defensive — nothing here may throw and
 * stop the city from booting.
 */
export function bootAudioDirector(options: AudioDirectorBootOptions = {}): AudioDirectorBoot {
  const director = createAudioDirector(options);
  if (options.defaultCues ?? true) director.registerCues(createSfxLibrary());

  const documentRef = resolveDocument(options.documentRef);
  let affordance: HTMLElement | null = null;
  let detachGesture: (() => void) | null = null;

  try {
    if (director.canCreateContext() && documentRef) {
      if (options.unlockAffordance ?? true) {
        affordance = director.createUnlockAffordance({
          documentRef,
          container: options.container ?? null,
        });
      }
      if (options.autoUnlockOnGesture ?? true) detachGesture = director.attachGestureUnlock(documentRef);
    }
  } catch (error) {
    console.warn('[chrono-city] audio: unlock affordance unavailable', error);
  }

  let registration: SystemRegistration | null = null;
  if (options.scene) {
    try {
      registration = director.attach(options.scene, {
        systemId: options.systemId,
        order: options.systemOrder,
      });
    } catch (error) {
      console.warn('[chrono-city] audio: could not join the scene tick loop', error);
    }
  }

  const globalKey = options.globalKey ?? AUDIO_GLOBAL_KEY;
  integrateAudioDirectorGlobal(director, globalKey);

  return {
    director,
    registration,
    affordance,
    globalKey,
    dispose(): void {
      detachGesture?.();
      director.detachGestureUnlock();
      director.dispose();
      detachAudioDirectorGlobal(globalKey, director);
    },
  };
}

/** Publishes the director on `globalThis` for overlays and browser harnesses. */
export function integrateAudioDirectorGlobal(
  director: AudioDirector,
  key: string = AUDIO_GLOBAL_KEY,
): AudioDirector {
  if (typeof globalThis !== 'undefined') {
    (globalThis as unknown as Record<string, unknown>)[key] = director;
  }
  return director;
}

/** Removes a published director (only when the handle still points at it). */
export function detachAudioDirectorGlobal(
  key: string = AUDIO_GLOBAL_KEY,
  director?: AudioDirector,
): void {
  if (typeof globalThis === 'undefined') return;
  const scope = globalThis as unknown as Record<string, unknown>;
  if (director && scope[key] !== director) return;
  delete scope[key];
}

/** The published director, or `null` before boot. */
export function getAudioDirector(key: string = AUDIO_GLOBAL_KEY): AudioDirector | null {
  if (typeof globalThis === 'undefined') return null;
  const value = (globalThis as unknown as Record<string, unknown>)[key];
  return value instanceof AudioDirector ? value : null;
}

export {
  AUDIO_BUS_NAMES,
  CUE_BUS_NAMES,
  DEFAULT_CUE_BUS,
  SFX_CUE_ALIASES,
  SFX_CUE_BUSES,
  SFX_CUE_NAMES,
  createSfxCueMap,
  createSfxLibrary,
  resolveCueAlias,
  sfxCueBus,
} from './sfxSynth';
export type {
  AudioBusName,
  CueBusName,
  CueDefinition,
  CueSynthContext,
  SfxCueName,
  SynthVoice,
} from './sfxSynth';

declare global {
  interface Window {
    __chronoCityAudio?: AudioDirector;
  }
}
