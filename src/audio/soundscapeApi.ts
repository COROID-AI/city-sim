/**
 * Chrono City — SoundscapeApi: per-era layer control, crossfades and footsteps.
 *
 * `SoundscapeApi` is the control half of the era audio system. It takes the ten
 * synthesized beds authored in `eraSoundscapes.ts`, registers them with the
 * shared `AudioDirector`, and mixes them as *layers*:
 *
 *   * one music layer and one ambience layer are sounding per era at most;
 *   * an era change keeps exactly the outgoing and the incoming era alive and
 *     rides the `TimelineRuntime` tween, so the beds crossfade instead of
 *     cutting — and the layer gains *are* the tween progress;
 *   * every layer voice is routed through the director's `music` / `ambience`
 *     buses (the cue definitions carry the bus), so master volume, mute and the
 *     director's own era dip all apply without a second mixer;
 *   * footsteps are triggered from the `NavigationRig`'s measured walk velocity
 *     and stay silent in orbit mode.
 *
 * Lifecycle:
 *   create    → `createSoundscapeApi({ director, timeline, context, rig })`
 *               registers the era cues and, when a timeline is supplied,
 *               registers itself as an `EraBlendable` (which immediately syncs
 *               it to the current era).
 *   consume   → `setEra()` / `updateEraTransition()` are the `EraBlendable`
 *               contract the timeline drives; `footsteps`, `layers`,
 *               `getLayer()` and `snapshot()` are the read surface for HUD and
 *               browser harnesses.
 *   integrate → `attach(context)` joins the frame loop (`update()` per frame),
 *               `integrateSoundscapeGlobal()` publishes the api on
 *               `window.__chronoCitySoundscape`, and `dispose()` releases every
 *               voice. The era-transition integration task performs the app
 *               wiring.
 *
 * Failure policy: audio is additive. A missing `AudioContext` simply leaves the
 * layers voice-less — `update()` retries on later frames — so the city keeps
 * running whatever the platform supports.
 */

import {
  DEFAULT_ERA,
  assertEraId,
  clamp01,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../core/eraContracts';
import type { FrameInfo, SceneContext, SystemRegistration } from '../core/sceneContext';
import type { EraBlendableRegistration, TimelineRuntime } from '../era/timelineRuntime';
import type { NavigationRig, NavigationRigState } from '../navigation/navigationRig';
import type { AudioCueHandle, AudioDirector } from './audioDirector';
import {
  SOUNDSCAPE_LAYER_KINDS,
  createEraSoundscapeCues,
  getEraSoundscapeProfile,
  soundscapeLayerBus,
  soundscapeLayerGain,
  type EraSoundscapeProfile,
  type SoundscapeLayerKind,
} from './eraSoundscapes';
import { FOOTSTEP_CUE, type CueBusName, type CueDefinition } from './sfxSynth';

export const SOUNDSCAPE_API_VERSION = 1;

/** System id the api registers on the `SceneContext` tick registry. */
export const SOUNDSCAPE_SYSTEM_ID = 'era-soundscape';

/**
 * Runs after the navigation rig (-100) so footsteps read this frame's walk
 * velocity, and before the audio director (90) so the listener follows the pose
 * the layers were mixed against.
 */
export const SOUNDSCAPE_SYSTEM_ORDER = 80;

/** Blendable id used when the api registers itself with a `TimelineRuntime`. */
export const SOUNDSCAPE_BLENDABLE_ID = 'era-soundscape-blendable';

/** Global key the live api is published on for overlays and harnesses. */
export const SOUNDSCAPE_GLOBAL_KEY = '__chronoCitySoundscape';

/** `document.documentElement` dataset attribute carrying the compact state. */
export const SOUNDSCAPE_STATE_ATTRIBUTE = 'chronoSoundscape';

/** Metres travelled per footstep; tuned so the rig's default walk is ~3.2 steps/s. */
export const DEFAULT_STRIDE_LENGTH = 2;

/** Below this walk speed (m/s) the walker counts as standing still. */
export const DEFAULT_MIN_STEP_SPEED = 0.3;

/** Hard cap on footstep cadence, in steps per second. */
export const DEFAULT_MAX_STEP_RATE = 5.2;

/** Feet per second above which extra speed stops raising the cadence. */
export const DEFAULT_MAX_TRACKED_SPEED = 16;

/** Velocity smoothing strength for the footstep cadence. */
export const DEFAULT_SPEED_DAMPING = 12;

/** Peak level of a footstep voice; scaled by speed and per-foot variation. */
export const DEFAULT_STEP_GAIN = 0.9;

/** Layer trim applied on top of the profile gains. */
export const DEFAULT_LAYER_TRIM = 1;

/** Safety valve: never fire more than this many steps in one frame. */
const MAX_STEPS_PER_FRAME = 4;

const HALF_PI = Math.PI / 2;

/* ------------------------------------------------------------------------- *
 * Public shapes
 * ------------------------------------------------------------------------- */

/** Crossfade curve between the outgoing and incoming era. */
export type SoundscapeCrossfadeCurve = 'linear' | 'equal-power';

export interface SoundscapeApiOptions {
  /** The mixer everything routes through. Required. */
  readonly director: AudioDirector;
  /**
   * The era timeline that drives the crossfade. When supplied the api registers
   * itself as a blendable (unless `registerWithTimeline` is `false`) and follows
   * the timeline's era, tween progress and durations.
   */
  readonly timeline?: TimelineRuntime | null;
  readonly registerWithTimeline?: boolean;
  /** Frame source for the footsteps. Without one, footsteps stay silent. */
  readonly rig?: NavigationRig | null;
  /** Registers the per-frame `update()` with this context. */
  readonly context?: SceneContext | null;
  readonly autoAttach?: boolean;
  /** Tick-system id/order overrides. */
  readonly systemId?: string;
  readonly order?: number;
  /** Cues to register; defaults to `createEraSoundscapeCues()`. */
  readonly cues?: readonly CueDefinition[];
  /** Set `false` to leave cue registration to the caller. Defaults to `true`. */
  readonly registerCues?: boolean;
  /** Era used when no timeline is supplied. Defaults to `DEFAULT_ERA`. */
  readonly initialEra?: EraId;
  /** Crossfade curve. Defaults to `linear` so the layer gain is the tween progress. */
  readonly curve?: SoundscapeCrossfadeCurve;
  /** Extra trim on every layer gain. Defaults to `DEFAULT_LAYER_TRIM`. */
  readonly layerTrim?: number;
  readonly footsteps?: boolean;
  readonly strideLength?: number;
  readonly minStepSpeed?: number;
  readonly maxStepRate?: number;
  readonly maxTrackedSpeed?: number;
  readonly speedDamping?: number;
  readonly stepGain?: number;
  /** DOM the state attribute is written to. Defaults to the global document. */
  readonly documentRef?: Document | null;
}

/** Immutable view of one layer: an era's music or ambience bed. */
export interface SoundscapeLayerState {
  readonly era: EraId;
  readonly kind: SoundscapeLayerKind;
  /** Era-scoped cue name, e.g. `era:2025:music-bed`. */
  readonly cue: string;
  readonly bus: CueBusName;
  /** Crossfade weight in `[0, 1]`: `1` at full strength for the settled era. */
  readonly crossfade: number;
  /** Applied gain: `crossfade` times the profile's layer gain, times the trim. */
  readonly gain: number;
  /** `true` while a voice is running on the director. */
  readonly playing: boolean;
  /** Voice id, or `null` before the voice could start. */
  readonly voiceId: number | null;
}

/** Footstep diagnostics: exactly what the cadence reacts to. */
export interface SoundscapeFootstepState {
  /** Navigation mode the footsteps are reading, or `'none'` without a rig. */
  readonly mode: NavigationRigState['mode'] | 'none';
  /** Smoothed walk speed in metres per second. */
  readonly speed: number;
  /** Commanded cadence in steps per second (`0` when silent). */
  readonly cadence: number;
  /** Steps triggered since the api was created. */
  readonly steps: number;
  /** `true` when the walker is still, the mode is not `walk`, or footsteps are off. */
  readonly silent: boolean;
}

/** Flat, serialisable view of the soundscape for overlays and browser probes. */
export interface SoundscapeSnapshot {
  readonly version: number;
  readonly era: EraId;
  /** Era the current crossfade is leaving. */
  readonly from: EraId;
  /** Eased tween progress in `[0, 1]`; `1` when settled. */
  readonly progress: number;
  readonly transitioning: boolean;
  readonly enabled: boolean;
  readonly footstepsEnabled: boolean;
  readonly layerCount: number;
  /** `era:kind` keys of every layer with a non-zero gain. */
  readonly audibleLayers: readonly string[];
  readonly layers: readonly SoundscapeLayerState[];
  readonly footstep: SoundscapeFootstepState;
}

/* ------------------------------------------------------------------------- *
 * Internals
 * ------------------------------------------------------------------------- */

interface LayerRecord {
  readonly era: EraId;
  readonly kind: SoundscapeLayerKind;
  readonly cue: string;
  readonly bus: CueBusName;
  voice: AudioCueHandle | null;
  crossfade: number;
  gain: number;
}

function layerKey(era: EraId, kind: SoundscapeLayerKind): string {
  return `${era}:${kind}`;
}

function resolveDocument(documentRef?: Document | null): Document | null {
  if (documentRef) return documentRef;
  return typeof document === 'undefined' ? null : document;
}

/* ------------------------------------------------------------------------- *
 * SoundscapeApi
 * ------------------------------------------------------------------------- */

/**
 * Per-era soundscape mixer: crossfades the era beds along the `TimelineRuntime`
 * tween and turns `NavigationRig` velocity into footsteps.
 */
export class SoundscapeApi implements EraBlendable {
  readonly version = SOUNDSCAPE_API_VERSION;

  private readonly director: AudioDirector;
  private readonly rig: NavigationRig | null;
  private readonly documentRef: Document | null;
  private readonly curve: SoundscapeCrossfadeCurve;
  private readonly layerTrim: number;
  private readonly strideLength: number;
  private readonly minStepSpeed: number;
  private readonly maxStepRate: number;
  private readonly maxTrackedSpeed: number;
  private readonly speedDamping: number;
  private readonly stepGain: number;

  private readonly layerMap = new Map<string, LayerRecord>();
  private registration: SystemRegistration | null = null;
  private blendableRegistration: EraBlendableRegistration | null = null;
  private disposedState = false;

  private eraState: EraId;
  private fromState: EraId;
  private progressState = 1;
  private transitioningState = false;
  private enabledState = true;
  private footstepsState: boolean;

  private speedState = 0;
  private cadenceState = 0;
  private stridePhase = 0;
  private stepCountState = 0;
  private stepIndex = 0;
  private lastPosition: { readonly x: number; readonly z: number } | null = null;
  private footstepModeState: NavigationRigState['mode'] | 'none' = 'none';

  private lastDomState = '';

  constructor(options: SoundscapeApiOptions) {
    if (!options || !options.director) {
      throw new TypeError('SoundscapeApi requires an AudioDirector.');
    }
    this.director = options.director;
    this.rig = options.rig ?? null;
    this.documentRef = resolveDocument(options.documentRef);
    this.curve = options.curve ?? 'linear';
    this.layerTrim = Math.max(0, options.layerTrim ?? DEFAULT_LAYER_TRIM);
    this.strideLength = Math.max(0.1, options.strideLength ?? DEFAULT_STRIDE_LENGTH);
    this.minStepSpeed = Math.max(0, options.minStepSpeed ?? DEFAULT_MIN_STEP_SPEED);
    this.maxStepRate = Math.max(0.1, options.maxStepRate ?? DEFAULT_MAX_STEP_RATE);
    this.maxTrackedSpeed = Math.max(this.minStepSpeed, options.maxTrackedSpeed ?? DEFAULT_MAX_TRACKED_SPEED);
    this.speedDamping = Math.max(0, options.speedDamping ?? DEFAULT_SPEED_DAMPING);
    this.stepGain = Math.max(0, options.stepGain ?? DEFAULT_STEP_GAIN);
    this.footstepsState = options.footsteps ?? true;

    const initial = options.initialEra ?? options.timeline?.era ?? DEFAULT_ERA;
    this.eraState = assertEraId(initial);
    this.fromState = this.eraState;

    if (options.registerCues ?? true) {
      this.director.registerCues(options.cues ?? createEraSoundscapeCues());
    }

    const timeline = options.timeline ?? null;
    if (timeline && (options.registerWithTimeline ?? true)) {
      // Registering syncs us immediately (`setEra` + `updateEraTransition`), so
      // the beds are already sounding along the timeline's current era.
      this.blendableRegistration = timeline.registerBlendable(this, {
        id: SOUNDSCAPE_BLENDABLE_ID,
      });
    } else {
      this.snapTo(this.eraState);
    }

    if (options.context && (options.autoAttach ?? true)) {
      this.attach(options.context, { id: options.systemId, order: options.order });
    }
    this.syncDomState();
  }

  /* ---------------- state ---------------- */

  /** Era the beds are heading to (the timeline's selected era). */
  get era(): EraId {
    return this.eraState;
  }

  /** Era the running crossfade is leaving. */
  get from(): EraId {
    return this.fromState;
  }

  /** Eased crossfade progress in `[0, 1]`; the timeline tween progress. */
  get progress(): number {
    return this.progressState;
  }

  /** `true` while a crossfade is still running. */
  get transitioning(): boolean {
    return this.transitioningState;
  }

  /** `false` while the layers have been muted at the api level. */
  get enabled(): boolean {
    return this.enabledState;
  }

  get footstepsEnabled(): boolean {
    return this.footstepsState;
  }

  /** Profile of the era the beds are heading to. */
  get profile(): EraSoundscapeProfile {
    return getEraSoundscapeProfile(this.eraState);
  }

  /** Every kept layer, endpoints included, in creation order. */
  get layers(): readonly SoundscapeLayerState[] {
    return [...this.layerMap.values()].map((layer) => this.describeLayer(layer));
  }

  get layerCount(): number {
    return this.layerMap.size;
  }

  /** Layers with a non-zero gain right now (what the listener can hear). */
  get audibleLayers(): readonly SoundscapeLayerState[] {
    return this.layers.filter((layer) => layer.gain > 0);
  }

  /** Total footsteps triggered since construction. */
  get stepCount(): number {
    return this.stepCountState;
  }

  /** Live footstep diagnostics. */
  get footsteps(): SoundscapeFootstepState {
    const mode = this.footstepModeState;
    return {
      mode,
      speed: this.speedState,
      cadence: this.cadenceState,
      steps: this.stepCountState,
      silent: mode !== 'walk' || this.cadenceState <= 0,
    };
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** Snapshot of one layer, or `null` when the era/kind is not kept. */
  getLayer(era: EraId, kind: SoundscapeLayerKind): SoundscapeLayerState | null {
    const layer = this.layerMap.get(layerKey(era, kind));
    return layer ? this.describeLayer(layer) : null;
  }

  /** Live voice of one layer, for routing assertions and diagnostics. */
  getLayerVoice(era: EraId, kind: SoundscapeLayerKind): AudioCueHandle | null {
    return this.layerMap.get(layerKey(era, kind))?.voice ?? null;
  }

  /** Flat snapshot for overlays and browser harnesses. */
  snapshot(): SoundscapeSnapshot {
    const layers = this.layers;
    return {
      version: SOUNDSCAPE_API_VERSION,
      era: this.eraState,
      from: this.fromState,
      progress: this.progressState,
      transitioning: this.transitioningState,
      enabled: this.enabledState,
      footstepsEnabled: this.footstepsState,
      layerCount: layers.length,
      audibleLayers: layers.filter((layer) => layer.gain > 0).map((layer) => layerKey(layer.era, layer.kind)),
      layers,
      footstep: this.footsteps,
    };
  }

  /* ---------------- era blending (EraBlendable) ---------------- */

  /**
   * Records the target era. A tween (`durationMs > 0`) prepares both endpoints
   * so the following `updateEraTransition()` calls can crossfade; anything else
   * snaps immediately and releases every other era, which is what keeps slider
   * scrubbing from stacking duplicate layers.
   */
  setEra(era: EraId, options: EraTransitionOptions = {}): void {
    if (this.disposedState) return;
    const next = assertEraId(era);
    const immediate =
      options.immediate === true || options.durationMs === undefined || options.durationMs <= 0;

    if (immediate) {
      this.snapTo(next);
      return;
    }

    const from = this.eraState;
    this.eraState = next;
    this.fromState = from;
    this.progressState = 0;
    this.transitioningState = true;
    this.pruneLayersExcept([from, next]);
    this.ensureLayers(from);
    this.ensureLayers(next);
    this.applyWeights();
    this.syncDomState();
  }

  /**
   * Rides the timeline tween: the incoming era's weight is the eased progress,
   * the outgoing era's weight is its complement (equal-power when configured),
   * and every other era is released on sight.
   */
  updateEraTransition(progress: number, transition: EraTransitionInfo): void {
    if (this.disposedState) return;
    const next = clamp01(progress);
    this.fromState = transition.from;
    this.eraState = transition.to;
    this.progressState = transition.active && next < 1 ? next : 1;
    this.transitioningState = transition.active && next < 1;

    if (!this.transitioningState) {
      // Settled: exactly one era survives, so nothing can stack or linger.
      this.fromState = this.eraState;
      this.pruneLayersExcept([this.eraState]);
      this.ensureLayers(this.eraState);
    } else {
      this.pruneLayersExcept([transition.from, transition.to]);
      this.ensureLayers(transition.from);
      this.ensureLayers(transition.to);
    }
    this.applyWeights();
    this.syncDomState();
  }

  /* ---------------- layer control ---------------- */

  /** Mutes (`false`) or restarts (`true`) every layer at the api level. */
  setEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    if (this.disposedState || next === this.enabledState) return;
    this.enabledState = next;
    if (!next) {
      this.releaseAllLayers();
    } else {
      this.ensureLayers(this.fromState);
      this.ensureLayers(this.eraState);
    }
    this.applyWeights();
    this.syncDomState();
  }

  /** Enables or disables the movement-reactive footsteps. */
  setFootstepsEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    if (next === this.footstepsState) return;
    this.footstepsState = next;
    if (!next) {
      this.speedState = 0;
      this.cadenceState = 0;
      this.stridePhase = 0;
      this.lastPosition = null;
    }
    this.syncDomState();
  }

  /**
   * Triggers one footstep now, for browser harnesses and manual probes. Still
   * respects walk mode and the speed gate, so a probe cannot make footsteps
   * sound in orbit mode.
   */
  triggerFootstep(options: { readonly speed?: number } = {}): boolean {
    if (this.disposedState || !this.footstepsState || !this.enabledState) return false;
    if (this.rig && this.rig.state.mode !== 'walk') return false;
    const speed = Math.max(options.speed ?? this.speedState, this.minStepSpeed);
    this.playFootstep(speed);
    this.syncDomState();
    return true;
  }

  /* ---------------- frame loop ---------------- */

  /**
   * Registers `update()` on the `SceneContext` tick loop so layers self-heal
   * around audio-unlock and footsteps follow the rig each frame.
   */
  attach(
    context: SceneContext,
    options: { id?: string; order?: number } = {},
  ): SystemRegistration {
    if (this.registration) this.detach();
    this.registration = context.registerSystem(
      options.id ?? SOUNDSCAPE_SYSTEM_ID,
      (_context: SceneContext, frame: FrameInfo) => this.update(frame.delta),
      { order: options.order ?? SOUNDSCAPE_SYSTEM_ORDER },
    );
    return this.registration;
  }

  /** Removes the tick system; layer state is left intact. */
  detach(): void {
    this.registration?.dispose();
    this.registration = null;
  }

  /** One frame of soundscape work: voice upkeep plus footstep cadence. */
  update(delta: number): void {
    if (this.disposedState) return;
    this.refreshVoices();
    this.updateFootsteps(delta);
    this.syncDomState();
  }

  /** Releases every voice and unregisters from the timeline and the tick loop. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.detach();
    this.blendableRegistration?.dispose();
    this.blendableRegistration = null;
    this.releaseAllLayers();
    this.syncDomState();
    detachSoundscapeGlobal(SOUNDSCAPE_GLOBAL_KEY, this);
  }

  /* ---------------- internals: layers ---------------- */

  private describeLayer(layer: LayerRecord): SoundscapeLayerState {
    return {
      era: layer.era,
      kind: layer.kind,
      cue: layer.cue,
      bus: layer.bus,
      crossfade: layer.crossfade,
      gain: layer.gain,
      playing: layer.voice !== null && !layer.voice.finished,
      voiceId: layer.voice?.id ?? null,
    };
  }

  /** Snaps straight to one era: at most two layers, no crossfade. */
  private snapTo(era: EraId): void {
    this.eraState = era;
    this.fromState = era;
    this.progressState = 1;
    this.transitioningState = false;
    this.pruneLayersExcept([era]);
    this.ensureLayers(era);
    this.applyWeights();
    this.syncDomState();
  }

  private ensureLayers(era: EraId): void {
    for (const kind of SOUNDSCAPE_LAYER_KINDS) this.ensureLayer(era, kind);
  }

  private ensureLayer(era: EraId, kind: SoundscapeLayerKind): LayerRecord {
    const key = layerKey(era, kind);
    const existing = this.layerMap.get(key);
    if (existing) return existing;

    const layer: LayerRecord = {
      era,
      kind,
      cue: getEraSoundscapeProfile(era)[kind === 'music' ? 'musicCue' : 'ambienceCue'],
      bus: soundscapeLayerBus(kind),
      voice: null,
      crossfade: 0,
      gain: 0,
    };
    this.layerMap.set(key, layer);
    this.startLayer(layer);
    return layer;
  }

  /**
   * Starts the layer's single looping voice. A layer owns at most one voice,
   * which is what makes a duplicated bed impossible no matter how fast the
   * timeline is scrubbed. Returns the live handle, or `null` while the platform
   * cannot create an audio context yet.
   */
  private startLayer(layer: LayerRecord): AudioCueHandle | null {
    if (this.disposedState || !this.enabledState) return null;
    const existing = layer.voice;
    if (existing && !existing.finished && this.director.hasVoice(existing)) return existing;
    layer.voice = null;
    if (!this.director.canCreateContext()) return null;
    // Explicit bus + loop: the cue carries the same bus, and the director owns
    // staging, era dips and master mute for every voice on it.
    const handle = this.director.play(layer.cue, { bus: layer.bus, loop: true });
    if (!handle) return null;
    layer.voice = handle;
    handle.setGain(layer.gain);
    return handle;
  }

  private releaseLayer(layer: LayerRecord): void {
    layer.voice?.stop();
    layer.voice = null;
    this.layerMap.delete(layerKey(layer.era, layer.kind));
  }

  private releaseAllLayers(): void {
    for (const layer of [...this.layerMap.values()]) this.releaseLayer(layer);
    this.layerMap.clear();
  }

  private pruneLayersExcept(eras: readonly EraId[]): void {
    for (const layer of [...this.layerMap.values()]) {
      if (!eras.includes(layer.era)) this.releaseLayer(layer);
    }
  }

  /** Re-starts any layer whose voice ended or never started (pre-unlock, dispose). */
  private refreshVoices(): void {
    if (!this.enabledState) return;
    for (const layer of this.layerMap.values()) {
      const voice = layer.voice;
      if (voice && !voice.finished && this.director.hasVoice(voice)) continue;
      layer.voice = null;
      const started = this.startLayer(layer);
      started?.setGain(layer.gain);
    }
  }

  /** Crossfade weight and applied gain of one layer, from the live tween state. */
  private crossfadeFor(era: EraId, kind: SoundscapeLayerKind): { crossfade: number; gain: number } {
    const from = this.fromState;
    const to = this.eraState;
    const progress = clamp01(this.progressState);
    let crossfade: number;
    if (from === to) crossfade = 1;
    else if (era === to) crossfade = this.curve === 'equal-power' ? Math.sin(progress * HALF_PI) : progress;
    else if (era === from) {
      crossfade = this.curve === 'equal-power' ? Math.cos(progress * HALF_PI) : 1 - progress;
    } else crossfade = 0;

    const gain = clamp01(crossfade) * soundscapeLayerGain(era, kind) * this.layerTrim;
    return { crossfade, gain };
  }

  private applyWeights(): void {
    for (const layer of this.layerMap.values()) {
      const { crossfade, gain } = this.crossfadeFor(layer.era, layer.kind);
      layer.crossfade = crossfade;
      layer.gain = this.enabledState ? gain : 0;
      if (!layer.voice) this.startLayer(layer);
      layer.voice?.setGain(layer.gain);
    }
  }

  /* ---------------- internals: footsteps ---------------- */

  private updateFootsteps(delta: number): void {
    const step = Number.isFinite(delta) && delta > 0 ? delta : 0;
    const rig = this.rig;
    this.footstepModeState = rig ? rig.state.mode : 'none';

    if (!rig || !this.footstepsState || !this.enabledState) {
      this.speedState = 0;
      this.cadenceState = 0;
      this.stridePhase = 0;
      this.lastPosition = null;
      return;
    }

    const { position } = rig.state;
    const previous = this.lastPosition;
    this.lastPosition = { x: position.x, z: position.z };

    const travelled =
      previous === null || step === 0
        ? 0
        : Math.hypot(position.x - previous.x, position.z - previous.z);
    const measured = step > 0 ? travelled / step : 0;
    // Exponential smoothing: frame jitter must not chatter the cadence.
    const blend = step > 0 ? 1 - Math.exp(-this.speedDamping * step) : 0;
    const clamped = Math.min(this.maxTrackedSpeed, Math.max(0, measured));
    this.speedState += (clamped - this.speedState) * blend;

    if (rig.state.mode !== 'walk' || this.speedState < this.minStepSpeed) {
      this.stridePhase = 0;
      this.cadenceState = 0;
      return;
    }

    // Cadence is literally velocity / stride length, capped for comfort.
    const cadence = Math.min(this.maxStepRate, this.speedState / this.strideLength);
    this.cadenceState = cadence;
    this.stridePhase += cadence * step;

    let fired = 0;
    while (this.stridePhase >= 1 && fired < MAX_STEPS_PER_FRAME) {
      this.stridePhase -= 1;
      fired += 1;
      this.playFootstep(this.speedState);
    }
  }

  /** Plays one era-coloured footstep through the director's SFX cue. */
  private playFootstep(speed: number): void {
    const normalized = clamp01(speed / (this.strideLength * this.maxStepRate));
    const leftFoot = this.stepIndex % 2 === 0;
    this.stepIndex += 1;
    this.stepCountState += 1;
    this.cadenceState = Math.min(this.maxStepRate, speed / this.strideLength);
    this.speedState = speed;

    if (!this.director.canCreateContext()) return;
    this.director.play(FOOTSTEP_CUE, {
      // Era-scoped resolution lets a later task re-voice footsteps per era
      // without touching this call site; the built-in cue is the fallback.
      era: this.eraState,
      gain: this.stepGain * (0.72 + 0.4 * normalized) * (leftFoot ? 1 : 0.92),
      rate: 0.94 + normalized * 0.18 + (leftFoot ? 0 : 0.03),
      seed: 1000 + this.stepIndex * 37,
    });
  }

  /* ---------------- internals: DOM state ---------------- */

  /**
   * Publishes a compact state string on `document.documentElement`, so a browser
   * harness can assert era, layer count and cadence without reaching into JS.
   */
  private syncDomState(): void {
    const root = this.documentRef?.documentElement;
    if (!root) return;
    const state = this.isDisposed
      ? 'disposed'
      : [
          this.eraState,
          this.fromState,
          this.progressState.toFixed(2),
          String(this.layerMap.size),
          String(this.audibleLayers.length),
          this.footstepModeState,
          this.cadenceState.toFixed(2),
          String(this.stepCountState),
        ].join('|');
    if (state === this.lastDomState) return;
    this.lastDomState = state;
    root.dataset[SOUNDSCAPE_STATE_ATTRIBUTE] = state;
    root.dataset.chronoSoundscapeEra = this.eraState;
    root.dataset.chronoSoundscapeLayers = String(this.layerMap.size);
    root.dataset.chronoSoundscapeCadence = this.cadenceState.toFixed(2);
  }
}

/* ------------------------------------------------------------------------- *
 * Lifecycle helpers
 * ------------------------------------------------------------------------- */

/** Creates the soundscape mixer (the `create` half of the lifecycle). */
export function createSoundscapeApi(options: SoundscapeApiOptions): SoundscapeApi {
  return new SoundscapeApi(options);
}

/** Publishes the api on `globalThis` for overlays and browser harnesses. */
export function integrateSoundscapeGlobal(
  api: SoundscapeApi,
  key: string = SOUNDSCAPE_GLOBAL_KEY,
): SoundscapeApi {
  if (typeof globalThis !== 'undefined') {
    (globalThis as unknown as Record<string, unknown>)[key] = api;
  }
  return api;
}

/** Removes a published api (only when the handle still points at it). */
export function detachSoundscapeGlobal(
  key: string = SOUNDSCAPE_GLOBAL_KEY,
  api?: SoundscapeApi,
): void {
  if (typeof globalThis === 'undefined') return;
  const scope = globalThis as unknown as Record<string, unknown>;
  if (api && scope[key] !== api) return;
  delete scope[key];
}

/** The published api, or `null` before boot. */
export function getSoundscapeApi(key: string = SOUNDSCAPE_GLOBAL_KEY): SoundscapeApi | null {
  if (typeof globalThis === 'undefined') return null;
  const value = (globalThis as unknown as Record<string, unknown>)[key];
  return value instanceof SoundscapeApi ? value : null;
}

declare global {
  interface Window {
    __chronoCitySoundscape?: SoundscapeApi;
  }
}
