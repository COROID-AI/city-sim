/**
 * AudioEngine — the café's sound layer.
 *
 * One engine owns the whole graph:
 *
 * ```
 *   music ─┐
 *  murmur ─┼─▶ bus trims / tones / mutes ─┬─▶ dry sum ─▶ reverb dry ─┐
 * machine ─┘                              └─▶ sends ─▶ convolver ─────┴─▶ limiter ─▶ master ─▶ destination
 * ```
 *
 * Design rules this class implements:
 *
 *  - **Gesture gated.** The context is created (or resumed) only from
 *    {@link AudioEngine.unlock}, which the composition root calls from a real
 *    user gesture. Before that the engine reports `'locked'` and schedules
 *    nothing at all; {@link AudioEngine.update} returns immediately.
 *  - **Injected.** The context comes from an {@link AudioContextLikeFactory}, so
 *    the entire graph is constructible, schedulable and observable headlessly.
 *  - **Descriptor driven.** Era music programs, murmur specs, machine characters
 *    and mix values are all injected through `src/audio/program.ts`; the engine
 *    owns only the generic scheduler and synthesis.
 *  - **Click free.** Every level change, crossfade and mute is an automation ramp.
 *  - **Protected.** A compressor plus a scheduled headroom stage sit after the
 *    summed buses, so stacked one-shots plus music plus murmur cannot exceed full
 *    scale.
 *  - **Teardownable.** {@link AudioEngine.dispose} stops every active source,
 *    disconnects every node, releases the reverb buffer and closes the context;
 *    the same instance can then be unlocked and driven again.
 */

import {
  clamp,
  clamp01,
  createAudioResourceBag,
  createBrowserAudioContextFactory,
  gainToDb,
  AudioEngineError,
  type AudioContextLike,
  type AudioContextLikeFactory,
  type AudioResourceBag,
  type GainNodeLike,
} from './types';
import {
  normalizeAmbienceSpec,
  normalizeEraMix,
  normalizeMusicProgram,
  type AmbienceSpecDescriptor,
  type AmbienceSpecInput,
  type AudioYearProvider,
  type EraMixDescriptor,
  type EraMixInput,
  type MachineCharacterDescriptor,
  type MusicProgramDescriptor,
  type MusicProgramInput,
} from './program';
import {
  BUS_IDS,
  brightnessToToneHz,
  createBusStrip,
  createMasterOutput,
  type BusId,
  type BusStrip,
  type LimiterOptions,
  type MasterOutput,
} from './buses';
import { createRoomReverb, type ImpulseResponseOptions, type RoomReverb } from './reverb';
import {
  createMusicScheduler,
  type MusicScheduler,
  type ScheduledMusicEvent,
} from './music';
import { createMurmurBed, type MurmurBed } from './ambience';
import {
  createMachineSfx,
  MACHINE_SFX_KINDS,
  type MachineSfx,
  type MachineSfxKind,
  type MachineTriggerOptions,
  type MachineTriggerRecord,
} from './machineSfx';
import type { DomainSpecBase, Hotspot, PeriodDefinition, SceneModule, UpdateContext, YearId } from '../contracts/period';

/** Stable identifier of the composed audio runtime. */
export const CAFE_AUDIO_ENGINE_ID = 'cafe-audio-engine';

/** Lifecycle the engine reports: locked until a gesture unlocks it. */
export type AudioEngineState = 'locked' | 'running' | 'suspended';

/** Kinds of diagnostics the engine records (bounded ring buffer). */
export type AudioEngineEventKind =
  | 'unlock'
  | 'suspend'
  | 'dispose'
  | 'mix'
  | 'music-program'
  | 'ambience'
  | 'bus'
  | 'reverb'
  | 'music-note'
  | 'murmur-blip'
  | 'machine-trigger'
  | 'limiter';

/** One recorded engine event; the suite uses these to prove determinism. */
export interface AudioEngineEvent {
  readonly kind: AudioEngineEventKind;
  /** Engine clock time in seconds. */
  readonly time: number;
  readonly year?: YearId;
  readonly id?: string;
  readonly detail?: Readonly<Record<string, number | string | boolean>>;
  readonly trigger?: MachineTriggerRecord;
}

/** Snapshot of what the engine is currently playing. */
export interface AudioMixState {
  readonly state: AudioEngineState;
  readonly year: YearId | null;
  readonly mixId: string | null;
  readonly programId: string | null;
  readonly ambienceId: string | null;
  readonly machineCharacterId: string | null;
  readonly machineArchetype: string | null;
  readonly musicLevel: number;
  readonly musicToneHz: number;
  readonly ambienceLevel: number;
  readonly ambienceDensity: number;
  readonly machineLevel: number;
  readonly masterLevel: number;
  readonly reverbDryWet: number;
  readonly reverbSeconds: number;
  readonly limiterReduction: number;
  readonly mutes: Readonly<Record<BusId, boolean>>;
  readonly sends: Readonly<Record<BusId, number>>;
  readonly activeMusicVoices: number;
  readonly scheduledNotes: number;
  readonly murmurBlips: number;
  readonly machineTriggers: number;
}

export interface AudioEngineOptions {
  /** Creates the audio context on unlock; defaults to the browser context. */
  readonly contextFactory?: AudioContextLikeFactory;
  /** Initial music program (an era's program descriptor). */
  readonly program?: MusicProgramInput | null;
  /** Initial murmur bed spec. */
  readonly ambience?: AmbienceSpecInput | null;
  /** Initial per-year mix; required before machine SFX can be triggered. */
  readonly mix?: EraMixInput | null;
  /** Seed of the whole engine: schedules are identical for identical seeds. */
  readonly seed?: number;
  /** How far ahead notes and blips are queued, seconds. */
  readonly lookaheadSeconds?: number;
  /** Default crossfade length for program and bed changes, seconds. */
  readonly crossfadeSeconds?: number;
  /** Reverb impulse response shape (era mixes can override size and decay). */
  readonly reverb?: ImpulseResponseOptions;
  /** Limiter settings. */
  readonly limiter?: LimiterOptions;
  /** Largest frame delta accepted by {@link AudioEngine.update}. */
  readonly maxDeltaSeconds?: number;
  /** Number of diagnostics events kept. */
  readonly eventLogLimit?: number;
}

interface EngineGraph {
  readonly context: AudioContextLike;
  readonly drySum: GainNodeLike;
  readonly reverb: RoomReverb;
  readonly buses: Readonly<Record<BusId, BusStrip>>;
  readonly master: MasterOutput;
  readonly resources: AudioResourceBag;
  dispose(): void;
}

interface BusState {
  gain: number;
  send: number;
  toneHz: number;
  muted: boolean;
}

interface Retiring {
  readonly disposeAt: number;
  readonly dispose: () => void;
  readonly label: string;
}

/** Lead time added to the clock when (re)starting sinks, seconds. */
const START_LEAD = 0.05;
/** How much of the murmur bed level counts toward the limiter estimate. */
const AMBIENCE_PEAK_WEIGHT = 1;

/**
 * The public audio surface: what `app-composition` starts, suspends and disposes
 * and what the period transition crossfades. Everything else on the class is
 * telemetry or synthesis detail.
 */
export interface CafeAudioEngine {
  readonly id: typeof CAFE_AUDIO_ENGINE_ID;
  readonly state: AudioEngineState;
  readonly isLocked: boolean;
  readonly isRunning: boolean;
  readonly isDisposed: boolean;
  readonly context: AudioContextLike | null;
  readonly sampleRate: number;
  /** Time the next automation is scheduled at, seconds. */
  readonly now: number;
  /** Default crossfade length, seconds. */
  readonly crossfadeSeconds: number;

  /** Creates or resumes the context from a user gesture and starts the sinks. */
  unlock(): Promise<AudioEngineState>;
  /** Suspends the context (the engine keeps its descriptors). */
  suspend(): Promise<AudioEngineState>;
  /** Advances lookahead scheduling; call once per frame from the composition. */
  update(deltaSeconds: number): void;

  setMusicProgram(
    program: MusicProgramInput | null,
    options?: { crossfadeSeconds?: number },
  ): void;
  setAmbience(
    spec: AmbienceSpecInput | null,
    options?: { intensity?: number; crossfadeSeconds?: number },
  ): void;
  setAmbienceIntensity(value: number, seconds?: number): void;
  /** Validates and applies a per-year mix; throws for a missing or bad one. */
  applyMix(mix: EraMixInput, options?: { seconds?: number }): EraMixDescriptor;
  /** Applies mix, program and bed together (what a timeline change asks for). */
  transitionTo(plan: AudioTransitionPlan): void;

  triggerMachine(kind: MachineSfxKind, options?: MachineTriggerOptions): MachineTriggerRecord;

  setBusGain(bus: BusId, value: number, seconds?: number): void;
  setBusMute(bus: BusId, muted: boolean, seconds?: number): void;
  setBusSend(bus: BusId, value: number, seconds?: number): void;
  setBusTone(bus: BusId, hertz: number, seconds?: number): void;
  setMasterLevel(value: number, seconds?: number): void;
  /** Dry/wet balance of the shared café reverb. */
  setReverb(dryWet: number, seconds?: number): void;

  getBus(bus: BusId): BusStrip | null;
  getMaster(): MasterOutput | null;
  getReverb(): RoomReverb | null;
  getMusicScheduler(): MusicScheduler | null;
  getMurmurBed(): MurmurBed | null;
  getMachineSfx(): MachineSfx | null;
  getMixState(): AudioMixState;
  /** Headroom gain the limiter currently applies (`1` = untouched). */
  getLimiterReduction(): number;
  getEventLog(): readonly AudioEngineEvent[];
  clearEventLog(): void;
  /** Notifies a listener whenever a machine one-shot fires. */
  onMachineTrigger(listener: (record: MachineTriggerRecord) => void): () => void;

  dispose(): void;
}

/** Everything a timeline change asks the engine to crossfade to. */
export interface AudioTransitionPlan {
  readonly year?: YearId;
  readonly mix?: EraMixInput;
  readonly program?: MusicProgramInput | null;
  readonly ambience?: AmbienceSpecInput | null;
  readonly crossfadeSeconds?: number;
}

/** One era's change, keyed by the shared `YearId`. */
export class AudioEngine implements CafeAudioEngine {
  readonly id = CAFE_AUDIO_ENGINE_ID;

  private readonly contextFactory: AudioContextLikeFactory;
  private readonly seed: number;
  private readonly lookahead: number;
  private readonly maxDelta: number;
  private readonly eventLogLimit: number;
  private readonly reverbOptions: ImpulseResponseOptions;
  private readonly limiterOptions: LimiterOptions;

  private contextValue: AudioContextLike | null = null;
  private graphValue: EngineGraph | null = null;
  private stateValue: AudioEngineState = 'locked';
  private disposed = false;
  private clock = 0;
  private wasSuspended = false;

  private musicValue: MusicScheduler | null = null;
  private murmurValue: MurmurBed | null = null;
  private machineValue: MachineSfx | null = null;
  private readonly retiring: Retiring[] = [];

  private programValue: MusicProgramDescriptor | null = null;
  private ambienceValue: AmbienceSpecDescriptor | null = null;
  private mixValue: EraMixDescriptor | null = null;
  private yearValue: YearId | null = null;
  private intensityValue = 0.5;

  private busState: Record<BusId, BusState> = {
    music: { gain: 0.8, send: 0.35, toneHz: 12000, muted: false },
    ambience: { gain: 0.7, send: 0.2, toneHz: 4200, muted: false },
    machine: { gain: 0.6, send: 0.3, toneHz: 6000, muted: false },
  };
  private masterState = { level: 0.9, dryWet: 0.25 };
  private reductionValue = 1;
  private events: AudioEngineEvent[] = [];
  private readonly triggerListeners = new Set<(record: MachineTriggerRecord) => void>();
  private readonly crossfadeDefault: number;

  constructor(options: AudioEngineOptions = {}) {
    this.contextFactory = options.contextFactory ?? createBrowserAudioContextFactory();
    this.seed = Math.trunc(options.seed ?? 0xca11ab1e);
    this.lookahead = clamp(options.lookaheadSeconds ?? 0.5, 0.05, 4);
    this.maxDelta = clamp(options.maxDeltaSeconds ?? 0.25, 0.001, 5);
    this.eventLogLimit = Math.max(Math.round(options.eventLogLimit ?? 1024), 32);
    this.reverbOptions = { ...(options.reverb ?? {}), seed: options.reverb?.seed ?? this.seed };
    this.limiterOptions = options.limiter ?? {};
    this.crossfadeDefault = clamp(options.crossfadeSeconds ?? 1.2, 0, 30);

    // Descriptors are validated on the way in, so a malformed era table fails
    // here rather than surfacing as silence at run time.
    if (options.mix !== undefined && options.mix !== null) {
      this.applyMix(options.mix, { seconds: 0 });
    }
    if (options.ambience !== undefined && options.ambience !== null) {
      this.setAmbience(options.ambience, { crossfadeSeconds: 0 });
    }
    if (options.program !== undefined && options.program !== null) {
      this.setMusicProgram(options.program, { crossfadeSeconds: 0 });
    }
  }

  /* -- lifecycle ---------------------------------------------------------- */

  get state(): AudioEngineState {
    return this.stateValue;
  }

  get isLocked(): boolean {
    return this.stateValue === 'locked';
  }

  get isRunning(): boolean {
    return this.stateValue === 'running';
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get context(): AudioContextLike | null {
    return this.contextValue;
  }

  get sampleRate(): number {
    return this.contextValue?.sampleRate ?? 0;
  }

  get now(): number {
    return this.clock;
  }

  get crossfadeSeconds(): number {
    return this.crossfadeDefault;
  }

  /**
   * Gesture entry point. Creates the context on first use, resumes it when it was
   * suspended, then starts the music, murmur and machine sinks.
   */
  unlock = async (): Promise<AudioEngineState> => {
    const context = this.ensureContext();
    if (context === null) {
      throw new AudioEngineError(
        'no-context',
        'No Web Audio implementation is available, so the café audio engine cannot unlock.',
      );
    }
    if (this.graphValue === null) this.buildGraph(context);
    if (context.state !== 'running') {
      await context.resume();
    }
    const resuming = this.wasSuspended;
    this.stateValue = context.state === 'running' ? 'running' : 'suspended';
    this.disposed = false;
    if (this.stateValue === 'running') {
      this.clock = Math.max(this.clock, context.currentTime) + START_LEAD;
      // A resumed context has a stale schedule: rebuild the sinks at the new now.
      if (resuming) this.retireSinks(0, this.clock, 'resume');
      this.startSinks(this.clock, resuming);
    }
    this.wasSuspended = false;
    this.pushEvent({
      kind: 'unlock',
      time: this.clock,
      detail: { state: this.stateValue, sampleRate: context.sampleRate },
    });
    this.refreshLimiter(this.clock);
    return this.stateValue;
  };

  suspend = async (): Promise<AudioEngineState> => {
    const context = this.contextValue;
    if (context === null || this.stateValue === 'locked') return this.stateValue;
    await context.suspend();
    this.stateValue = context.state === 'suspended' ? 'suspended' : 'running';
    this.wasSuspended = this.stateValue === 'suspended';
    this.pushEvent({ kind: 'suspend', time: this.clock });
    return this.stateValue;
  };

  /**
   * Stops every source, disconnects every node, releases the reverb buffer and
   * closes the context. The instance stays usable: a later `unlock()` rebuilds
   * the graph from the descriptors it still holds.
   */
  dispose = (): void => {
    if (this.disposed && this.contextValue === null && this.graphValue === null) return;
    this.retireSinks(0, this.clock, 'dispose');
    // Anything still waiting on a crossfade window is released immediately too,
    // so teardown really leaves no connected node behind.
    const pending = [...this.retiring];
    this.retiring.length = 0;
    for (const entry of pending) entry.dispose();
    const graph = this.graphValue;
    const context = this.contextValue;
    const machine = this.machineValue;
    this.machineValue = null;
    this.graphValue = null;
    this.contextValue = null;
    this.stateValue = 'locked';
    this.disposed = true;
    machine?.dispose();
    if (graph) graph.dispose();
    if (context !== null && context.state !== 'closed') {
      try {
        const closing = context.close();
        if (closing && typeof closing.catch === 'function') closing.catch(() => undefined);
      } catch {
        // The context refused to close; the graph is already torn down.
      }
    }
    this.pushEvent({ kind: 'dispose', time: this.clock });
  };

  /* -- frame driving ------------------------------------------------------ */

  /**
   * Queues everything that falls inside the lookahead window. Does nothing at all
   * before the first user gesture, which is what "the engine schedules nothing
   * while locked" means in practice.
   */
  update = (deltaSeconds: number): void => {
    if (this.stateValue !== 'running' || this.contextValue === null) return;
    const delta = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, this.maxDelta);
    this.clock += delta;
    const contextTime = this.contextValue.currentTime;
    if (Number.isFinite(contextTime)) this.clock = Math.max(this.clock, contextTime);
    const now = this.clock;
    this.retireDue(now);
    this.musicValue?.reap(now);
    this.murmurValue?.reap(now);
    this.machineValue?.reap(now);
    const horizon = now + this.lookahead;
    this.musicValue?.scheduleAhead(horizon);
    this.murmurValue?.scheduleAhead(horizon);
    this.refreshLimiter(now);
  };

  /* -- descriptors --------------------------------------------------------- */

  setMusicProgram(
    program: MusicProgramInput | null,
    options: { crossfadeSeconds?: number } = {},
  ): void {
    const seconds = clamp(options.crossfadeSeconds ?? this.crossfadeDefault, 0, 30);
    const now = this.now;
    if (program === null) {
      this.programValue = null;
      const previous = this.musicValue;
      this.musicValue = null;
      if (previous !== null) {
        previous.stop(seconds, now);
        this.retire(now + seconds, 'music-stop', () => previous.dispose());
      }
      this.pushEvent({ kind: 'music-program', time: now, id: 'silence' });
      return;
    }
    const descriptor = normalizeMusicProgram(program, 'music program');
    this.programValue = descriptor;
    this.yearValue = descriptor.year;
    this.pushEvent({
      kind: 'music-program',
      time: now,
      year: descriptor.year,
      id: descriptor.id,
      detail: {
        tempo: descriptor.tempo,
        device: descriptor.device.kind,
        loopSeconds: descriptor.loopDurationSeconds,
        crossfadeSeconds: seconds,
      },
    });
    if (this.contextValue === null || this.graphValue === null) return;
    const previous = this.musicValue;
    const next = this.createMusicScheduler(descriptor, now, seconds > 0 ? 0 : 1);
    this.musicValue = next;
    if (seconds > 0) next.setLevel(1, seconds, now);
    if (previous !== null && previous !== next) {
      previous.stop(seconds, now);
      this.retire(now + seconds, 'music-crossfade', () => previous.dispose());
    }
  }

  setAmbience(
    spec: AmbienceSpecInput | null,
    options: { intensity?: number; crossfadeSeconds?: number } = {},
  ): void {
    const seconds = clamp(options.crossfadeSeconds ?? this.crossfadeDefault, 0, 30);
    const now = this.now;
    if (spec === null) {
      this.ambienceValue = null;
      const previous = this.murmurValue;
      this.murmurValue = null;
      if (previous !== null) {
        previous.stop(seconds, now);
        this.retire(now + seconds, 'ambience-stop', () => previous.dispose());
      }
      this.pushEvent({ kind: 'ambience', time: now, id: 'silence' });
      return;
    }
    const descriptor = normalizeAmbienceSpec(spec, 'ambience spec');
    this.ambienceValue = descriptor;
    this.yearValue = descriptor.year;
    if (options.intensity !== undefined) this.intensityValue = clamp01(options.intensity);
    this.pushEvent({
      kind: 'ambience',
      time: now,
      year: descriptor.year,
      id: descriptor.id,
      detail: { intensity: this.intensityValue, crossfadeSeconds: seconds },
    });
    if (this.contextValue === null || this.graphValue === null) return;
    const previous = this.murmurValue;
    const next = this.createMurmurBed(descriptor, now);
    this.murmurValue = next;
    next.setIntensity(this.intensityValue, 0, now);
    next.setLevel(seconds > 0 ? 0 : 1, 0, now);
    if (seconds > 0) next.fadeIn(seconds, now);
    if (previous !== null && previous !== next) {
      previous.stop(seconds, now);
      this.retire(now + seconds, 'ambience-crossfade', () => previous.dispose());
    }
  }

  setAmbienceIntensity(value: number, seconds = 0.4): void {
    const intensity = clamp01(value);
    this.intensityValue = intensity;
    const now = this.now;
    this.murmurValue?.setIntensity(intensity, seconds, now);
  }

  /**
   * Applies a per-year mix to bus gains, tones, sends, master level and the
   * reverb's dry/wet balance.
   *
   * Throws an {@link AudioDescriptorError} when the descriptor is missing or
   * malformed — a hand authored era table should fail loudly, not play wrong.
   */
  applyMix(mix: EraMixInput, options: { seconds?: number } = {}): EraMixDescriptor {
    const descriptor = normalizeEraMix(mix, 'era mix');
    const seconds = clamp(options.seconds ?? 0.25, 0, 30);
    const now = this.now;
    this.mixValue = descriptor;
    this.yearValue = descriptor.year;
    this.intensityValue = descriptor.ambience.density;
    this.busState = {
      music: {
        gain: descriptor.music.level,
        send: descriptor.music.send,
        toneHz: clamp(
          descriptor.music.toneHz * (0.65 + 0.5 * descriptor.brightness) * descriptor.music.brightness,
          200,
          20000,
        ),
        muted: this.busState.music.muted,
      },
      ambience: {
        gain: descriptor.ambience.level,
        send: descriptor.ambience.send,
        toneHz: clamp(descriptor.ambience.toneHz * (0.7 + 0.5 * descriptor.brightness), 200, 20000),
        muted: this.busState.ambience.muted,
      },
      machine: {
        gain: descriptor.machine.level,
        send: descriptor.machine.send,
        toneHz: brightnessToToneHz(descriptor.brightness, 2500, 16000),
        muted: this.busState.machine.muted,
      },
    };
    this.masterState = { level: descriptor.master, dryWet: descriptor.reverb.dryWet };

    this.pushEvent({
      kind: 'mix',
      time: now,
      year: descriptor.year,
      id: descriptor.id,
      detail: {
        music: descriptor.music.level,
        ambience: descriptor.ambience.level,
        density: descriptor.ambience.density,
        machine: descriptor.machine.level,
        brightness: descriptor.brightness,
      },
    });

    if (this.contextValue === null || this.graphValue === null) return descriptor;

    for (const bus of BUS_IDS) this.applyBusState(bus, seconds, now);
    const graph = this.graphValue;
    graph.master.setLevel(this.masterState.level, seconds, now);
    graph.reverb.setDryWet(this.masterState.dryWet, seconds, now);
    const reverb = descriptor.reverb;
    if (
      Math.abs(reverb.sizeSeconds - graph.reverb.options.sizeSeconds) > 0.001 ||
      Math.abs(reverb.decay - graph.reverb.options.decay) > 0.001
    ) {
      graph.reverb.setImpulseResponse({ sizeSeconds: reverb.sizeSeconds, decay: reverb.decay });
    }
    this.murmurValue?.setIntensity(this.intensityValue, seconds, now);
    this.ensureMachineUnit();
    this.machineValue?.setCharacter(descriptor.machine.character);
    return descriptor;
  }

  /** One call for a timeline change: mix, music program and murmur bed together. */
  transitionTo(plan: AudioTransitionPlan): void {
    const seconds = clamp(plan.crossfadeSeconds ?? this.crossfadeDefault, 0, 30);
    if (plan.mix !== undefined && plan.mix !== null) {
      this.applyMix(plan.mix, { seconds });
    }
    if (plan.year !== undefined) this.yearValue = plan.year;
    if (plan.program !== undefined) {
      this.setMusicProgram(plan.program, { crossfadeSeconds: seconds });
    }
    if (plan.ambience !== undefined) {
      this.setAmbience(plan.ambience, { crossfadeSeconds: seconds });
    }
    this.refreshLimiter(this.now);
  }

  /* -- machine SFX --------------------------------------------------------- */

  triggerMachine(kind: MachineSfxKind, options: MachineTriggerOptions = {}): MachineTriggerRecord {
    if (this.stateValue !== 'running') {
      throw new AudioEngineError(
        'locked',
        'The café audio engine is locked: unlock it from a user gesture before triggering machine SFX.',
      );
    }
    const machine = this.machineValue;
    if (machine === null) {
      throw new AudioEngineError(
        'descriptor',
        'No machine character is applied yet: call applyMix() with an era mix descriptor first.',
      );
    }
    const record = machine.trigger(kind, options, this.now);
    this.refreshLimiter(this.now);
    return record;
  }

  onMachineTrigger(listener: (record: MachineTriggerRecord) => void): () => void {
    this.triggerListeners.add(listener);
    return () => {
      this.triggerListeners.delete(listener);
    };
  }

  /* -- mixer controls ------------------------------------------------------ */

  setBusGain(bus: BusId, value: number, seconds = 0.1): void {
    this.busState[bus].gain = clamp(value, 0, 4);
    this.applyBusState(bus, seconds, this.now);
  }

  setBusMute(bus: BusId, muted: boolean, seconds = 0.1): void {
    this.busState[bus].muted = muted;
    this.applyBusState(bus, seconds, this.now);
  }

  setBusSend(bus: BusId, value: number, seconds = 0.1): void {
    this.busState[bus].send = clamp01(value);
    this.applyBusState(bus, seconds, this.now);
  }

  setBusTone(bus: BusId, hertz: number, seconds = 0.1): void {
    this.busState[bus].toneHz = clamp(hertz, 80, 20000);
    this.applyBusState(bus, seconds, this.now);
  }

  setMasterLevel(value: number, seconds = 0.1): void {
    this.masterState.level = clamp(value, 0, 2);
    this.graphValue?.master.setLevel(this.masterState.level, seconds, this.now);
  }

  setReverb(dryWet: number, seconds = 0.2): void {
    this.masterState.dryWet = clamp01(dryWet);
    const now = this.now;
    this.graphValue?.reverb.setDryWet(this.masterState.dryWet, seconds, now);
    this.pushEvent({ kind: 'reverb', time: now, detail: { dryWet: this.masterState.dryWet } });
  }

  /* -- inspection ---------------------------------------------------------- */

  getBus(bus: BusId): BusStrip | null {
    return this.graphValue?.buses[bus] ?? null;
  }

  getMaster(): MasterOutput | null {
    return this.graphValue?.master ?? null;
  }

  getReverb(): RoomReverb | null {
    return this.graphValue?.reverb ?? null;
  }

  getMusicScheduler(): MusicScheduler | null {
    return this.musicValue;
  }

  getMurmurBed(): MurmurBed | null {
    return this.murmurValue;
  }

  getMachineSfx(): MachineSfx | null {
    return this.machineValue;
  }

  getLimiterReduction(): number {
    return this.reductionValue;
  }

  getEventLog(): readonly AudioEngineEvent[] {
    return this.events;
  }

  clearEventLog(): void {
    this.events = [];
  }

  getMixState(): AudioMixState {
    return {
      state: this.stateValue,
      year: this.yearValue,
      mixId: this.mixValue?.id ?? null,
      programId: this.programValue?.id ?? null,
      ambienceId: this.ambienceValue?.id ?? null,
      machineCharacterId: this.machineValue?.character.id ?? this.mixValue?.machine.character.id ?? null,
      machineArchetype: this.machineValue?.character.extraction.archetype ?? null,
      musicLevel: this.busState.music.gain,
      musicToneHz: this.busState.music.toneHz,
      ambienceLevel: this.busState.ambience.gain,
      ambienceDensity: this.intensityValue,
      machineLevel: this.busState.machine.gain,
      masterLevel: this.masterState.level,
      reverbDryWet: this.masterState.dryWet,
      reverbSeconds: this.graphValue?.reverb.options.sizeSeconds ?? this.reverbOptions.sizeSeconds ?? 1.1,
      limiterReduction: this.reductionValue,
      mutes: {
        music: this.busState.music.muted,
        ambience: this.busState.ambience.muted,
        machine: this.busState.machine.muted,
      },
      sends: {
        music: this.busState.music.send,
        ambience: this.busState.ambience.send,
        machine: this.busState.machine.send,
      },
      activeMusicVoices: this.musicValue?.activeVoiceCount ?? 0,
      scheduledNotes: this.musicValue?.scheduledCount ?? 0,
      murmurBlips: this.murmurValue?.blipCount ?? 0,
      machineTriggers: this.machineValue?.triggerCount ?? 0,
    };
  }

  /* -- internals ----------------------------------------------------------- */

  private ensureContext(): AudioContextLike | null {
    if (this.contextValue !== null) return this.contextValue;
    const created = this.contextFactory();
    if (created === null) return null;
    this.contextValue = created;
    this.disposed = false;
    return created;
  }

  private buildGraph(context: AudioContextLike): void {
    const resources = createAudioResourceBag();
    const drySum = resources.node(context.createGain());
    drySum.gain.value = 1;
    const reverb = createRoomReverb(context, {
      ...this.reverbOptions,
      dryWet: this.masterState.dryWet,
    });
    const destinations = { dry: drySum, reverb: reverb.send };
    const buses: Record<BusId, BusStrip> = {
      music: createBusStrip(context, 'music', destinations, {
        gain: this.busState.music.gain,
        send: this.busState.music.send,
        toneHz: this.busState.music.toneHz,
        muted: this.busState.music.muted,
      }),
      ambience: createBusStrip(context, 'ambience', destinations, {
        gain: this.busState.ambience.gain,
        send: this.busState.ambience.send,
        toneHz: this.busState.ambience.toneHz,
        muted: this.busState.ambience.muted,
      }),
      machine: createBusStrip(context, 'machine', destinations, {
        gain: this.busState.machine.gain,
        send: this.busState.machine.send,
        toneHz: this.busState.machine.toneHz,
        muted: this.busState.machine.muted,
      }),
    };
    const master = createMasterOutput(context, context.destination, {
      ...this.limiterOptions,
      level: this.masterState.level,
    });
    // The reverb's dry path takes the sum; its output is the last bus into the limiter.
    drySum.connect(reverb.dry);
    reverb.output.connect(master.input);

    const graph: EngineGraph = {
      context,
      drySum,
      reverb,
      buses,
      master,
      resources,
      dispose() {
        for (const id of BUS_IDS) buses[id].dispose();
        reverb.dispose();
        master.dispose();
        resources.disconnectAll();
      },
    };
    this.graphValue = graph;
  }

  /** (Re)creates the music, murmur and machine sinks for the current descriptors. */
  private startSinks(now: number, restart: boolean): void {
    if (this.graphValue === null) return;
    if (this.programValue !== null && (restart || this.musicValue === null)) {
      this.musicValue = this.createMusicScheduler(this.programValue, now, 1);
    }
    if (this.ambienceValue !== null && (restart || this.murmurValue === null)) {
      const bed = this.createMurmurBed(this.ambienceValue, now);
      this.murmurValue = bed;
      bed.setIntensity(this.intensityValue, 0, now);
      bed.setLevel(1, 0, now);
    } else if (this.murmurValue !== null) {
      this.murmurValue.setIntensity(this.intensityValue, 0.2, now);
    }
    this.ensureMachineUnit();
  }

  private ensureMachineUnit(): void {
    const graph = this.graphValue;
    const context = this.contextValue;
    const character: MachineCharacterDescriptor | null = this.mixValue?.machine.character ?? null;
    if (graph === null || context === null || character === null) return;
    if (this.machineValue === null) {
      this.machineValue = createMachineSfx({
        context,
        destination: graph.buses.machine.input,
        character,
        seed: this.seed,
        level: 1,
        onTrigger: (record) => {
          this.pushEvent({
            kind: 'machine-trigger',
            time: record.time,
            year: record.year,
            id: record.kind,
            trigger: record,
            detail: {
              archetype: record.archetype,
              material: record.material,
              pitch: record.pitchFactor,
              duration: record.durationFactor,
              level: record.level,
              emitted: record.emitted,
            },
          });
          for (const listener of [...this.triggerListeners]) {
            try {
              listener(record);
            } catch {
              // A listener throwing must not break the audio graph.
            }
          }
        },
      });
      return;
    }
    this.machineValue.setCharacter(character);
  }

  private createMusicScheduler(
    descriptor: MusicProgramDescriptor,
    now: number,
    level: number,
  ): MusicScheduler {
    const context = this.contextValue;
    const graph = this.graphValue;
    if (context === null || graph === null) {
      throw new AudioEngineError('graph', 'The audio graph is not built yet.');
    }
    return createMusicScheduler({
      context,
      destination: graph.buses.music.input,
      program: descriptor,
      lookaheadSeconds: this.lookahead,
      startTime: now,
      level,
      onEvent: (event: ScheduledMusicEvent) => {
        this.pushEvent({
          kind: 'music-note',
          time: event.time,
          year: descriptor.year,
          id: event.voiceId,
          detail: {
            program: descriptor.id,
            step: event.step,
            loop: event.loop,
            frequency: Math.round(event.frequency * 1000) / 1000,
            velocity: Math.round(event.velocity * 1000) / 1000,
            durationSeconds: Math.round(event.durationSeconds * 1000) / 1000,
          },
        });
      },
    });
  }

  private createMurmurBed(descriptor: AmbienceSpecDescriptor, now: number): MurmurBed {
    const context = this.contextValue;
    const graph = this.graphValue;
    if (context === null || graph === null) {
      throw new AudioEngineError('graph', 'The audio graph is not built yet.');
    }
    return createMurmurBed({
      context,
      destination: graph.buses.ambience.input,
      spec: descriptor,
      seed: this.seed,
      intensity: this.intensityValue,
      level: 0,
      startTime: now,
      onBlip: (blip) => {
        this.pushEvent({
          kind: 'murmur-blip',
          time: blip.time,
          year: descriptor.year,
          id: descriptor.id,
          detail: {
            index: blip.index,
            fundamentalHz: Math.round(blip.fundamentalHz * 10) / 10,
            durationSeconds: Math.round(blip.durationSeconds * 1000) / 1000,
            level: Math.round(blip.level * 1000) / 1000,
          },
        });
      },
    });
  }

  private applyBusState(bus: BusId, seconds: number, now: number): void {
    const strip = this.graphValue?.buses[bus] ?? null;
    const state = this.busState[bus];
    if (strip === null) {
      this.pushEvent({
        kind: 'bus',
        time: now,
        id: bus,
        detail: { gain: state.gain, send: state.send, toneHz: state.toneHz, muted: state.muted, deferred: true },
      });
      return;
    }
    strip.setGain(state.gain, seconds, now);
    strip.setSend(state.send, seconds, now);
    strip.setTone(state.toneHz, seconds, now);
    strip.setMute(state.muted, seconds, now);
    this.pushEvent({
      kind: 'bus',
      time: now,
      id: bus,
      detail: { gain: state.gain, send: state.send, toneHz: state.toneHz, muted: state.muted, deferred: false },
    });
  }

  /**
   * Estimates the summed output level and ducks the master headroom stage when it
   * would pass full scale.
   *
   * The estimate mirrors how the graph is used: music is a continuous bed on its
   * own bus, the murmur is a continuous bed on the ambience bus, and machine
   * one-shots land *on top of the murmur*. So the worst case is either music
   * alone or ambience plus stacked one-shots.
   */
  private refreshLimiter(now: number): number {
    const graph = this.graphValue;
    if (graph === null || this.stateValue === 'locked') return this.reductionValue;
    const musicPeak = this.musicValue !== null && !this.busState.music.muted ? this.busState.music.gain : 0;
    const ambiencePeak =
      this.murmurValue !== null && !this.busState.ambience.muted
        ? this.busState.ambience.gain * this.murmurValue.intensity * AMBIENCE_PEAK_WEIGHT
        : 0;
    const machinePeak =
      this.machineValue !== null && !this.busState.machine.muted
        ? this.busState.machine.gain * this.machineValue.pendingLevel(now)
        : 0;
    const estimate = Math.max(musicPeak, ambiencePeak + machinePeak);
    const previous = this.reductionValue;
    const reduction = graph.master.limit(estimate, now);
    this.reductionValue = reduction;
    if (reduction !== previous) {
      this.pushEvent({
        kind: 'limiter',
        time: now,
        detail: {
          reduction: Math.round(reduction * 1000) / 1000,
          reductionDb: Math.round(gainToDb(reduction) * 10) / 10,
          estimate: Math.round(estimate * 1000) / 1000,
        },
      });
    }
    return reduction;
  }

  private retire(disposeAt: number, label: string, dispose: () => void): void {
    this.retiring.push({ disposeAt, dispose, label });
  }

  private retireDue(now: number): void {
    for (let index = this.retiring.length - 1; index >= 0; index -= 1) {
      const entry = this.retiring[index];
      if (entry === undefined || entry.disposeAt > now) continue;
      entry.dispose();
      this.retiring.splice(index, 1);
    }
  }

  private retireSinks(seconds: number, now: number, label: string): void {
    const music = this.musicValue;
    const murmur = this.murmurValue;
    this.musicValue = null;
    this.murmurValue = null;
    if (music !== null) {
      music.stop(seconds, now);
      this.retire(now + seconds, `${label}-music`, () => music.dispose());
    }
    if (murmur !== null) {
      murmur.stop(seconds, now);
      this.retire(now + seconds, `${label}-ambience`, () => murmur.dispose());
    }
    if (seconds <= 0) this.retireDue(now);
  }

  private pushEvent(event: AudioEngineEvent): void {
    this.events.push(event);
    if (this.events.length > this.eventLogLimit) {
      this.events.splice(0, this.events.length - this.eventLogLimit);
    }
  }
}

/** Convenience factory mirroring the kernel's `createKernel` style. */
export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  return new AudioEngine(options);
}

/** True when `value` exposes the café audio engine surface. */
export function isCafeAudioEngine(value: unknown): value is CafeAudioEngine {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['id'] === CAFE_AUDIO_ENGINE_ID &&
    typeof candidate['unlock'] === 'function' &&
    typeof candidate['suspend'] === 'function' &&
    typeof candidate['update'] === 'function' &&
    typeof candidate['dispose'] === 'function' &&
    typeof candidate['transitionTo'] === 'function'
  );
}

/* -------------------------------------------------------------------------- */
/* Scene module adapter                                                       */
/* -------------------------------------------------------------------------- */

/** Per-era audio spec the scene module holds, resolved from the provider. */
export interface AudioSceneSpec extends DomainSpecBase {
  readonly year: YearId;
  readonly mixId: string | null;
  readonly programId: string | null;
  readonly ambienceId: string | null;
  /** Patron density the murmur is following, `0..1`. */
  readonly density: number;
}

export interface AudioSceneModuleOptions {
  readonly engine: CafeAudioEngine;
  readonly provider: AudioYearProvider;
  readonly id?: string;
  readonly crossfadeSeconds?: number;
  /** Hotspots to expose (the audio layer has none of its own by default). */
  readonly hotspots?: readonly Hotspot[];
}

/**
 * Adapts the audio engine to the shared {@link SceneModule} contract so the
 * period registry and the composition root can drive it like any other domain
 * module: `build`/`applyPeriod` crossfade to the era's descriptors, `update`
 * pumps the scheduler, `dispose` tears the engine down.
 *
 * The engine itself never unlocks on its own: the composition root still calls
 * `unlock()` from a user gesture (or via {@link AudioSceneModule.unlock}).
 */
export interface AudioSceneModule extends SceneModule<AudioSceneSpec> {
  readonly engine: CafeAudioEngine;
  /** Instance of the gesture gate the composition root should call on click. */
  unlock(): Promise<AudioEngineState>;
}

/** Creates the scene-module adapter for an engine plus its per-year provider. */
export function createAudioSceneModule(options: AudioSceneModuleOptions): AudioSceneModule {
  const engine = options.engine;
  const provider = options.provider;
  const crossfade = options.crossfadeSeconds ?? 1.2;
  const hotspots = options.hotspots ?? [];
  let specValue: AudioSceneSpec | undefined;

  const applyYear = (year: YearId): void => {
    const mix = provider.mix(year) ?? null;
    if (mix !== null) engine.applyMix(mix, { seconds: crossfade });
    const program = provider.program?.(year) ?? null;
    engine.setMusicProgram(program, { crossfadeSeconds: crossfade });
    const ambience = provider.ambience?.(year) ?? null;
    engine.setAmbience(ambience, { crossfadeSeconds: crossfade });
    const state = engine.getMixState();
    specValue = {
      year,
      mixId: state.mixId,
      programId: state.programId,
      ambienceId: state.ambienceId,
      density: state.ambienceDensity,
      label: `café audio ${year}`,
      tags: ['audio', year],
    };
  };

  return {
    id: options.id ?? CAFE_AUDIO_ENGINE_ID,
    engine,
    unlock: () => engine.unlock(),
    get spec() {
      return specValue;
    },
    build(context) {
      applyYear(context.year);
    },
    applyPeriod(period: PeriodDefinition, context) {
      applyYear(period.year);
      void context;
    },
    update(deltaSeconds: number, _context: UpdateContext) {
      engine.update(deltaSeconds);
    },
    dispose() {
      engine.dispose();
    },
    getHotspots() {
      return hotspots;
    },
  };
}

/** Every machine one-shot kind, re-exported for the composition layer. */
export { MACHINE_SFX_KINDS };
export type { MachineSfxKind };
