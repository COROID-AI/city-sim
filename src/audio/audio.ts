/**
 * Synthesized WebAudio bus for the Coroid holographic factory.
 *
 * ── What this module is ─────────────────────────────────────────────────────
 * A leaf presentation service. It owns one AudioContext, a small output chain
 * and a vocabulary of synthesized cues, and it is driven from the outside: the
 * input router unlocks it on the first user gesture and triggers UI clicks,
 * while domain events arrive through `handleEvent`/`connect`. The bus imports no
 * simulation module (only the event/state *types*), so it can never perturb the
 * deterministic run.
 *
 * ── Output chain ────────────────────────────────────────────────────────────
 *
 *   cue voices ────▶ sfxGain ────┐
 *                                ├──▶ mixer ─▶ masterGain ─▶ compressor ─▶ destination
 *   ambience bed ─▶ ambienceGain ┘
 *
 * `masterGain` is the single mute point: muting ramps it to zero and leaves
 * every node, the ambience bed and the context untouched, so unmuting is
 * instant and costs no rebuild.
 *
 * ── Gesture gating ──────────────────────────────────────────────────────────
 * Nothing is created before `unlock()`: that call constructs the context, which
 * is why the page never trips the browser's autoplay policy. Anything requested
 * before the gesture — cues, preferences, subscriptions — is recorded as
 * suppressed and stays silent.
 *
 * ── Event → cue map ─────────────────────────────────────────────────────────
 *   lane/assigned, lane/queued                → dispatch
 *   verification/run passed                   → gate-pass
 *   verification/run failed | blocked         → gate-fail
 *   plan/task-updated failed | blocked        → gate-fail
 *   verification/run running after a failure  → repair (once per failure)
 *   plan/task-updated running after a failure → repair (once per failure)
 *   lane/released                             → release
 *   `trigger('ui-click')` from the UI layer   → ui-click
 *
 * Every other domain event is deliberately silent: economy, quality and mission
 * bookkeeping should not chatter.
 *
 * ── Preferences ─────────────────────────────────────────────────────────────
 * `setMuted` and `setReducedMotion` are honoured live and never persisted.
 * Reduced motion removes motion-like layers — noise whooshes, glissando sweeps
 * and the slow filter/tremolo modulation of the ambience bed — while every cue
 * keeps a stationary core so it stays audible and identifiable.
 *
 * ── Disposal ────────────────────────────────────────────────────────────────
 * `dispose()` stops every source, disconnects every node the bus created,
 * unsubscribes every listener and closes the context. It is idempotent, and the
 * bus refuses to synthesize anything afterwards.
 *
 * There are no audio files, no CDNs and no network requests: every sound is
 * built from oscillators, noise buffers, biquad filters and gain envelopes.
 */

import type { DomainEventChannel } from '../game/events';
import type { DomainEvent } from '../sim/state';

/* -------------------------------------------------------------------------- */
/* Cue vocabulary                                                             */
/* -------------------------------------------------------------------------- */

/** Every cue the bus can synthesize. */
export type AudioCue = 'dispatch' | 'gate-pass' | 'gate-fail' | 'repair' | 'release' | 'ui-click';

/** Stable iteration order for tests, tooling and debug overlays. */
export const AUDIO_CUES: readonly AudioCue[] = [
  'dispatch',
  'gate-pass',
  'gate-fail',
  'repair',
  'release',
  'ui-click',
];

/** One scheduled oscillator voice inside a cue. */
export interface ToneVoiceSpec {
  readonly kind: 'tone';
  readonly wave: OscillatorType;
  /** Base frequency in Hz. */
  readonly frequency: number;
  /** Detune in cents, for beat effects. */
  readonly detune?: number;
  /** Seconds after the cue starts. Defaults to 0 (immediate). */
  readonly delay?: number;
  /** Seconds the voice stays audible, envelope included. */
  readonly duration: number;
  /** Linear peak gain of the envelope. */
  readonly peak: number;
  /** Attack time in seconds. Defaults to 5 ms. */
  readonly attack?: number;
  /** Release time in seconds. Defaults to 45% of `duration`. */
  readonly release?: number;
  /** Glide target in Hz: a motion-like sweep, dropped under reduced motion. */
  readonly glideTo?: number;
  /** Optional low-pass shaping of the voice. */
  readonly filter?: { readonly frequency: number; readonly q?: number };
}

/** One scheduled noise burst inside a cue. */
export interface NoiseVoiceSpec {
  readonly kind: 'noise';
  readonly delay?: number;
  readonly duration: number;
  readonly peak: number;
  readonly attack?: number;
  readonly release?: number;
  readonly filter: {
    readonly type: BiquadFilterType;
    readonly frequency: number;
    readonly q?: number;
    /** Band-pass sweep target in Hz: a motion-like whoosh. */
    readonly sweepTo?: number;
  };
}

/** A single synthesized voice of a cue. */
export type CueVoiceSpec = ToneVoiceSpec | NoiseVoiceSpec;

/** Audible design of one cue: what it is, and which voices build it. */
export interface CueProfile {
  readonly label: string;
  readonly description: string;
  readonly voices: readonly CueVoiceSpec[];
}

/** True for voices whose character is motion: glissandi and filter sweeps. */
export function isMotionVoice(spec: CueVoiceSpec): boolean {
  return spec.kind === 'tone' ? spec.glideTo !== undefined : spec.filter.sweepTo !== undefined;
}

/** Cue design table — one entry per audible event, read top to bottom. */
export const CUE_PROFILES: Readonly<Record<AudioCue, CueProfile>> = {
  dispatch: {
    label: 'Dispatch',
    description: 'Pneumatic launch whoosh under a two-step confirmation blip: work enters a lane.',
    voices: [
      // Motion layer: the air whoosh of the dispatch tube.
      {
        kind: 'noise',
        duration: 0.3,
        peak: 0.15,
        attack: 0.02,
        release: 0.24,
        filter: { type: 'bandpass', frequency: 420, q: 1.1, sweepTo: 2400 },
      },
      {
        kind: 'tone',
        wave: 'triangle',
        frequency: 96,
        duration: 0.18,
        peak: 0.13,
        release: 0.12,
        filter: { frequency: 520, q: 0.9 },
      },
      { kind: 'tone', wave: 'square', frequency: 660, duration: 0.07, peak: 0.05, delay: 0.06 },
      { kind: 'tone', wave: 'square', frequency: 990, duration: 0.09, peak: 0.045, delay: 0.13 },
    ],
  },
  'gate-pass': {
    label: 'Gate pass',
    description: 'Rising D-major arpeggio with a bright holographic bloom: a gate turned green.',
    voices: [
      // Motion layer: the upward sweep that announces success.
      {
        kind: 'tone',
        wave: 'sine',
        frequency: 440,
        duration: 0.32,
        peak: 0.045,
        attack: 0.01,
        release: 0.26,
        glideTo: 1320,
      },
      { kind: 'tone', wave: 'sine', frequency: 587.33, duration: 0.16, peak: 0.1, release: 0.12 },
      { kind: 'tone', wave: 'sine', frequency: 739.99, duration: 0.16, peak: 0.09, delay: 0.07, release: 0.12 },
      { kind: 'tone', wave: 'sine', frequency: 880, duration: 0.3, peak: 0.11, delay: 0.14, release: 0.24 },
      { kind: 'tone', wave: 'triangle', frequency: 1760, duration: 0.22, peak: 0.03, delay: 0.15, release: 0.2 },
    ],
  },
  'gate-fail': {
    label: 'Gate fail',
    description: 'Detuned low buzzer with a falling alarm sweep: a gate reported red.',
    voices: [
      // Motion layer: the alarm siren sliding down.
      {
        kind: 'tone',
        wave: 'sawtooth',
        frequency: 900,
        duration: 0.42,
        peak: 0.045,
        attack: 0.01,
        release: 0.3,
        glideTo: 220,
        filter: { frequency: 1400, q: 4 },
      },
      // Motion layer: the pressure hiss bleeding off with the sweep.
      {
        kind: 'noise',
        duration: 0.36,
        peak: 0.085,
        attack: 0.01,
        release: 0.3,
        filter: { type: 'bandpass', frequency: 1800, q: 1.4, sweepTo: 300 },
      },
      {
        kind: 'tone',
        wave: 'sawtooth',
        frequency: 220,
        duration: 0.4,
        peak: 0.09,
        release: 0.25,
        filter: { frequency: 900, q: 3 },
      },
      {
        kind: 'tone',
        wave: 'sawtooth',
        frequency: 233,
        duration: 0.4,
        peak: 0.07,
        detune: 6,
        release: 0.25,
        filter: { frequency: 900, q: 3 },
      },
      {
        kind: 'tone',
        wave: 'square',
        frequency: 110,
        duration: 0.45,
        peak: 0.07,
        release: 0.3,
        filter: { frequency: 320, q: 1 },
      },
    ],
  },
  repair: {
    label: 'Repair',
    description: 'Ratchet ticks climbing a fifth: failed work is picked up and reworked.',
    voices: [
      // Motion layer: a short upward shove of filtered air.
      {
        kind: 'noise',
        duration: 0.2,
        peak: 0.075,
        attack: 0.01,
        release: 0.16,
        filter: { type: 'bandpass', frequency: 600, q: 1.2, sweepTo: 1500 },
      },
      {
        kind: 'tone',
        wave: 'triangle',
        frequency: 196,
        duration: 0.09,
        peak: 0.09,
        release: 0.05,
        filter: { frequency: 700, q: 1 },
      },
      {
        kind: 'tone',
        wave: 'triangle',
        frequency: 294,
        duration: 0.09,
        peak: 0.085,
        delay: 0.08,
        release: 0.05,
        filter: { frequency: 800, q: 1 },
      },
      {
        kind: 'tone',
        wave: 'triangle',
        frequency: 392,
        duration: 0.12,
        peak: 0.09,
        delay: 0.16,
        release: 0.08,
        filter: { frequency: 900, q: 1 },
      },
      { kind: 'tone', wave: 'square', frequency: 1568, duration: 0.04, peak: 0.02, delay: 0.16 },
      { kind: 'tone', wave: 'square', frequency: 1568, duration: 0.04, peak: 0.02, delay: 0.26 },
    ],
  },
  release: {
    label: 'Release',
    description: 'Airlock hiss over a settling thud: a lane handed its task back.',
    voices: [
      // Motion layer: the pressure hiss dropping away.
      {
        kind: 'noise',
        duration: 0.5,
        peak: 0.11,
        attack: 0.03,
        release: 0.42,
        filter: { type: 'lowpass', frequency: 3200, q: 0.8, sweepTo: 400 },
      },
      {
        kind: 'tone',
        wave: 'sine',
        frequency: 74,
        duration: 0.3,
        peak: 0.13,
        release: 0.26,
        filter: { frequency: 260, q: 0.8 },
      },
      { kind: 'tone', wave: 'triangle', frequency: 440, duration: 0.18, peak: 0.04, delay: 0.02, release: 0.14 },
      { kind: 'tone', wave: 'triangle', frequency: 330, duration: 0.22, peak: 0.035, delay: 0.1, release: 0.18 },
    ],
  },
  'ui-click': {
    label: 'UI click',
    description: 'Crisp holographic tap for pointer feedback on console controls.',
    voices: [
      {
        kind: 'noise',
        duration: 0.035,
        peak: 0.09,
        attack: 0.001,
        release: 0.03,
        filter: { type: 'highpass', frequency: 2400, q: 0.7 },
      },
      { kind: 'tone', wave: 'sine', frequency: 1320, duration: 0.045, peak: 0.05, attack: 0.001, release: 0.035 },
      { kind: 'tone', wave: 'sine', frequency: 5280, duration: 0.02, peak: 0.015, attack: 0.001, release: 0.015 },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* Bus contract                                                               */
/* -------------------------------------------------------------------------- */

export interface AudioBusOptions {
  /**
   * Builds the AudioContext. Defaults to the platform constructor; tests inject
   * a stub here, and the input router never has to.
   */
  createContext?: () => AudioContext;
  /** Start muted. Defaults to `false`. Never persisted. */
  muted?: boolean;
  /** Start with motion-like layers suppressed. Defaults to `false`. */
  reducedMotion?: boolean;
  /** Synthesize the continuous ambience bed on unlock. Defaults to `true`. */
  ambience?: boolean;
  /** Master output level in 0..1. Defaults to 0.85. */
  masterVolume?: number;
  /** Ambience bed level in 0..1 (before the master gain). Defaults to 0.26. */
  ambienceVolume?: number;
  /** Cue level in 0..1 (before the master gain). Defaults to 0.7. */
  sfxVolume?: number;
}

/** Live counters for debug overlays and tests. */
export interface AudioBusStats {
  readonly unlocked: boolean;
  readonly muted: boolean;
  readonly reducedMotion: boolean;
  readonly disposed: boolean;
  /** Contexts constructed by the bus: 0 until `unlock()`. */
  readonly contextsCreated: number;
  /** Cues synthesized since unlock. */
  readonly cuesPlayed: number;
  /** Cues refused while locked, muted or disposed. */
  readonly cuesSuppressed: number;
  /** Cue voices still scheduled to sound. */
  readonly activeVoices: number;
  /** Nodes the bus currently owns. */
  readonly nodes: number;
  /** Effective master level: 0 while muted. */
  readonly outputLevel: number;
  /** Last cue that produced synthesis, if any. */
  readonly lastCue: AudioCue | null;
}

/**
 * The audio bus consumed by the input router and the composed runtime.
 *
 * Everything is lazy: constructing the bus touches no WebAudio API at all, so
 * it is safe to create during boot, before the visitor has interacted.
 */
export interface AudioBus {
  /** True once `unlock()` has created the graph. */
  readonly unlocked: boolean;
  /** True while output is silenced by preference. */
  readonly muted: boolean;
  /** True while motion-like layers are suppressed. */
  readonly reducedMotion: boolean;
  readonly disposed: boolean;
  /** `null` until `unlock()`; the closed context afterwards (for inspection). */
  readonly context: AudioContext | null;
  readonly stats: AudioBusStats;
  /**
   * Called from the first user gesture. Creates the context, builds the output
   * chain, starts the ambience bed and resumes the context. Safe to call again:
   * the voice and the context are created only once. Resolves to `false` when
   * WebAudio is unavailable, the context refuses to resume, or the bus is
   * already disposed.
   */
  unlock(): Promise<boolean>;
  /** Synthesize one cue now. Returns whether anything was audible. */
  trigger(cue: AudioCue): boolean;
  /** Map a domain event to its cue; unmapped events stay silent. */
  handleEvent(event: DomainEvent): void;
  /** Observe a domain event channel. Returns the unsubscribe function. */
  connect(events: DomainEventChannel): () => void;
  /** Unlock on the first pointer/key gesture on `target`. Returns a detach. */
  attachUnlockOnGesture(target: EventTarget): () => void;
  /** Silence or restore output without touching the graph. */
  setMuted(muted: boolean): void;
  /** Suppress or restore motion-like sweeps, including live ambience rebuild. */
  setReducedMotion(reducedMotion: boolean): void;
  /** Start or stop the continuous ambience bed. */
  setAmbienceEnabled(enabled: boolean): void;
  /** Tear the graph down: disconnect everything and close the context. */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Tunables                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_MASTER_VOLUME = 0.85;
const DEFAULT_AMBIENCE_VOLUME = 0.26;
const DEFAULT_SFX_VOLUME = 0.7;
/** Small offset so a cue scheduled "now" never lands in the past. */
const SCHEDULE_LEAD = 0.004;
/** Exponential ramps cannot reach 0; this is the practical floor. */
const SILENCE_FLOOR = 0.0001;
/** Length of the synthesized noise buffer, in seconds. */
const NOISE_BUFFER_SECONDS = 2;
/** Hum voices: `[frequency, detune cents, level]`. */
const HUM_VOICES: readonly (readonly [number, number, number])[] = [
  [55, -5, 0.5],
  [55.6, 7, 0.34],
];

/** Platform AudioContext constructor, with the legacy Safari escape hatch. */
function defaultContextFactory(): AudioContext {
  const scope = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!ctor) throw new Error('[coroid] WebAudio is unavailable in this environment');
  return new ctor();
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Envelope fields shared by every cue voice. */
type EnvelopeSpec = Pick<ToneVoiceSpec, 'duration' | 'peak' | 'attack' | 'release' | 'delay'>;

/* -------------------------------------------------------------------------- */
/* Bus implementation                                                         */
/* -------------------------------------------------------------------------- */

export function createAudioBus(options: AudioBusOptions = {}): AudioBus {
  const createContext = options.createContext ?? defaultContextFactory;
  const masterVolume = clamp01(options.masterVolume ?? DEFAULT_MASTER_VOLUME);
  const ambienceVolume = clamp01(options.ambienceVolume ?? DEFAULT_AMBIENCE_VOLUME);
  const sfxVolume = clamp01(options.sfxVolume ?? DEFAULT_SFX_VOLUME);

  let muted = options.muted ?? false;
  let reducedMotion = options.reducedMotion ?? false;
  let ambienceEnabled = options.ambience ?? true;
  let unlocked = false;
  let disposed = false;
  let contextsCreated = 0;
  let cuesPlayed = 0;
  let cuesSuppressed = 0;
  let lastCue: AudioCue | null = null;

  let audioContext: AudioContext | null = null;
  let mixer: GainNode | null = null;
  let masterGain: GainNode | null = null;
  let sfxGain: GainNode | null = null;
  let ambienceGain: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;

  /** Every node the bus has created and still owns. */
  const nodes = new Set<AudioNode>();
  /** Cue voices still sounding, with their stop time and disconnectable chain. */
  const voices = new Map<AudioScheduledSourceNode, { stopAt: number; chain: AudioNode[] }>();
  /** Sources and nodes of the currently playing ambience bed. */
  let ambienceSources: AudioScheduledSourceNode[] = [];
  let ambienceChain: AudioNode[] = [];
  /** Detach functions for channel subscriptions and gesture listeners. */
  const subscriptions = new Set<() => void>();
  const gestureDetachers = new Set<() => void>();
  /** Task ids and gate ids whose last run failed, so retries read as repairs. */
  const failedTasks = new Set<string>();
  const failedGates = new Set<string>();

  /* ------------------------------------------------------------ node bookkeeping */

  function track<T extends AudioNode>(node: T): T {
    nodes.add(node);
    return node;
  }

  function disconnectAll(collection: readonly AudioNode[], label: string): void {
    for (const node of collection) {
      try {
        node.disconnect();
      } catch (error) {
        console.warn(`[coroid] ${label} failed to disconnect`, error);
      }
    }
  }

  /** Disconnect one finished cue voice. Its sources have already stopped. */
  function releaseVoice(source: AudioScheduledSourceNode): void {
    const voice = voices.get(source);
    if (!voice) return;
    voices.delete(source);
    disconnectAll(voice.chain, 'audio voice');
  }

  /** Drop voices whose stop time has passed (a safety net for `onended`). */
  function sweepVoices(): void {
    const ctx = audioContext;
    if (!ctx) return;
    for (const [source, voice] of [...voices]) {
      if (voice.stopAt <= ctx.currentTime) releaseVoice(source);
    }
  }

  /* ----------------------------------------------------------------- output graph */

  function buildOutputGraph(ctx: AudioContext): void {
    mixer = track(ctx.createGain());
    mixer.gain.value = 1;

    masterGain = track(ctx.createGain());
    masterGain.gain.value = masterVolume;

    const compressor = track(ctx.createDynamicsCompressor());
    compressor.threshold.value = -12;
    compressor.knee.value = 6;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    sfxGain = track(ctx.createGain());
    sfxGain.gain.value = sfxVolume;

    ambienceGain = track(ctx.createGain());
    ambienceGain.gain.value = ambienceVolume;

    sfxGain.connect(mixer);
    ambienceGain.connect(mixer);
    mixer.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);
  }

  /** Apply the current mute preference to the single mute point. */
  function applyOutputLevel(): void {
    if (disposed || !audioContext || !masterGain) return;
    if (audioContext.state === 'closed') return;
    masterGain.gain.setValueAtTime(muted ? 0 : masterVolume, audioContext.currentTime);
  }

  /** Two seconds of white noise, generated once per bus and filtered per use. */
  function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (noiseBuffer) return noiseBuffer;
    const length = Math.max(1024, Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    noiseBuffer = buffer;
    return buffer;
  }

  /* -------------------------------------------------------------------- ambience */

  /**
   * Build the continuous factory ambience: a deep hum, room tone, a machinery
   * whirr and a quiet holographic shimmer. The slow modulation layers are
   * motion by nature, so they only exist when motion is allowed.
   */
  function startAmbience(): void {
    const ctx = audioContext;
    const target = ambienceGain;
    if (!ctx || !target || !ambienceEnabled || disposed) return;
    if (ambienceSources.length > 0) return;

    const now = ctx.currentTime;
    const sources: AudioScheduledSourceNode[] = [];
    const chain: AudioNode[] = [];

    /* Deep plant hum: two detuned saws behind a slow low-pass. */
    const humFilter = track(ctx.createBiquadFilter());
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 200;
    humFilter.Q.value = 5;
    const humGain = track(ctx.createGain());
    humGain.gain.value = 0.55;
    humFilter.connect(humGain);
    humGain.connect(target);
    chain.push(humFilter, humGain);

    for (const [frequency, detune, level] of HUM_VOICES) {
      const osc = track(ctx.createOscillator());
      osc.type = 'sawtooth';
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      const levelGain = track(ctx.createGain());
      levelGain.gain.value = level;
      osc.connect(levelGain);
      levelGain.connect(humFilter);
      osc.start(now);
      sources.push(osc);
      chain.push(osc, levelGain);
    }

    if (!reducedMotion) {
      // Slow filter breathing.
      const breathe = track(ctx.createOscillator());
      breathe.type = 'sine';
      breathe.frequency.value = 0.06;
      const breatheDepth = track(ctx.createGain());
      breatheDepth.gain.value = 55;
      breathe.connect(breatheDepth);
      breatheDepth.connect(humFilter.frequency);
      breathe.start(now);
      sources.push(breathe);
      chain.push(breathe, breatheDepth);
    }

    /* Room tone: looping noise through a wide band-pass. */
    const air = track(ctx.createBufferSource());
    air.buffer = createNoiseBuffer(ctx);
    air.loop = true;
    const airFilter = track(ctx.createBiquadFilter());
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 420;
    airFilter.Q.value = 0.7;
    const airGain = track(ctx.createGain());
    airGain.gain.value = 0.6;
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(target);
    air.start(now);
    sources.push(air);
    chain.push(air, airFilter, airGain);

    /* Machinery whirr: narrow band-pass noise. */
    const whirr = track(ctx.createBufferSource());
    whirr.buffer = createNoiseBuffer(ctx);
    whirr.loop = true;
    const whirrFilter = track(ctx.createBiquadFilter());
    whirrFilter.type = 'bandpass';
    whirrFilter.frequency.value = 1400;
    whirrFilter.Q.value = 6;
    const whirrGain = track(ctx.createGain());
    whirrGain.gain.value = 0.16;
    whirr.connect(whirrFilter);
    whirrFilter.connect(whirrGain);
    whirrGain.connect(target);
    whirr.start(now);
    sources.push(whirr);
    chain.push(whirr, whirrFilter, whirrGain);

    if (!reducedMotion) {
      // The whirr's slow wobble, as if the line is drifting under load.
      const wobble = track(ctx.createOscillator());
      wobble.type = 'sine';
      wobble.frequency.value = 0.11;
      const wobbleDepth = track(ctx.createGain());
      wobbleDepth.gain.value = 240;
      wobble.connect(wobbleDepth);
      wobbleDepth.connect(whirrFilter.frequency);
      wobble.start(now);
      sources.push(wobble);
      chain.push(wobble, wobbleDepth);
    }

    /* Holographic shimmer: a very quiet high sine. */
    const shimmer = track(ctx.createOscillator());
    shimmer.type = 'sine';
    shimmer.frequency.value = 1320;
    const shimmerGain = track(ctx.createGain());
    shimmerGain.gain.value = 0.012;
    shimmer.connect(shimmerGain);
    shimmerGain.connect(target);
    shimmer.start(now);
    sources.push(shimmer);
    chain.push(shimmer, shimmerGain);

    if (!reducedMotion) {
      const tremolo = track(ctx.createOscillator());
      tremolo.type = 'sine';
      tremolo.frequency.value = 0.23;
      const tremoloDepth = track(ctx.createGain());
      tremoloDepth.gain.value = 0.006;
      tremolo.connect(tremoloDepth);
      tremoloDepth.connect(shimmerGain.gain);
      tremolo.start(now);
      sources.push(tremolo);
      chain.push(tremolo, tremoloDepth);
    }

    ambienceSources = sources;
    ambienceChain = chain;
  }

  /** Stop and release the ambience bed, leaving the output chain in place. */
  function stopAmbience(): void {
    for (const source of ambienceSources) {
      try {
        source.stop();
      } catch (error) {
        console.warn('[coroid] ambience source failed to stop', error);
      }
    }
    disconnectAll([...ambienceSources, ...ambienceChain], 'ambience node');
    ambienceSources = [];
    ambienceChain = [];
  }

  /* ------------------------------------------------------------------- cue voices */

  /**
   * Build the attack/hold/release envelope every voice shares and connect it to
   * the cue bus. Returns the scheduled times so the source can be aligned with
   * the same envelope.
   */
  function createEnvelope(
    ctx: AudioContext,
    target: AudioNode,
    spec: EnvelopeSpec,
    cueStart: number,
  ): { gain: GainNode; at: number; stopAt: number } {
    const at = cueStart + (spec.delay ?? 0);
    const duration = Math.max(spec.duration, 0.01);
    const attack = Math.min(spec.attack ?? 0.005, duration * 0.3);
    const release = Math.max(Math.min(spec.release ?? duration * 0.45, duration - attack), 0.002);
    const stopAt = at + duration;

    const gain = track(ctx.createGain());
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(spec.peak, at + attack);
    gain.gain.setValueAtTime(spec.peak, at + duration - release);
    gain.gain.exponentialRampToValueAtTime(SILENCE_FLOOR, stopAt);
    gain.connect(target);

    return { gain, at, stopAt };
  }

  function registerVoice(source: AudioScheduledSourceNode, stopAt: number, chain: AudioNode[]): void {
    voices.set(source, { stopAt, chain });
    // Releasing on the natural end keeps the node set small between cues.
    source.onended = () => releaseVoice(source);
  }

  function scheduleTone(ctx: AudioContext, target: AudioNode, spec: ToneVoiceSpec, cueStart: number): void {
    const { gain, at, stopAt } = createEnvelope(ctx, target, spec, cueStart);

    const osc = track(ctx.createOscillator());
    osc.type = spec.wave;
    osc.frequency.setValueAtTime(spec.frequency, at);
    if (spec.glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(spec.glideTo, stopAt);
    if (spec.detune !== undefined) osc.detune.setValueAtTime(spec.detune, at);

    const chain: AudioNode[] = [gain, osc];
    if (spec.filter) {
      const filter = track(ctx.createBiquadFilter());
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(spec.filter.frequency, at);
      filter.Q.value = spec.filter.q ?? 1;
      osc.connect(filter);
      filter.connect(gain);
      chain.push(filter);
    } else {
      osc.connect(gain);
    }

    osc.start(at);
    osc.stop(stopAt);
    registerVoice(osc, stopAt, chain);
  }

  function scheduleNoise(ctx: AudioContext, target: AudioNode, spec: NoiseVoiceSpec, cueStart: number): void {
    const { gain, at, stopAt } = createEnvelope(ctx, target, spec, cueStart);

    const source = track(ctx.createBufferSource());
    source.buffer = createNoiseBuffer(ctx);
    source.loop = true;

    const filter = track(ctx.createBiquadFilter());
    filter.type = spec.filter.type;
    filter.frequency.setValueAtTime(spec.filter.frequency, at);
    if (spec.filter.sweepTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(spec.filter.sweepTo, stopAt);
    }
    filter.Q.value = spec.filter.q ?? 1;

    source.connect(filter);
    filter.connect(gain);
    source.start(at);
    source.stop(stopAt);
    registerVoice(source, stopAt, [gain, source, filter]);
  }

  /** Schedule every voice of a cue, skipping motion layers when asked to. */
  function scheduleCue(cue: AudioCue): void {
    const ctx = audioContext;
    const target = sfxGain;
    if (!ctx || !target) return;
    const cueStart = ctx.currentTime + SCHEDULE_LEAD;
    for (const voice of CUE_PROFILES[cue].voices) {
      if (reducedMotion && isMotionVoice(voice)) continue;
      if (voice.kind === 'tone') scheduleTone(ctx, target, voice, cueStart);
      else scheduleNoise(ctx, target, voice, cueStart);
    }
  }

  /* --------------------------------------------------------------- domain events */

  /**
   * Resolve the cue for a domain event.
   *
   * Repairs are recognized from history rather than from the event alone: a gate
   * or task that failed and is now running again is being reworked, and the
   * failure is consumed so one failure yields at most one repair cue.
   */
  function resolveCue(event: DomainEvent): AudioCue | null {
    switch (event.type) {
      case 'lane/assigned':
      case 'lane/queued':
        return 'dispatch';
      case 'lane/released':
        return 'release';
      case 'verification/run':
        if (event.status === 'running') {
          if (!failedGates.has(event.gateId)) return null;
          failedGates.delete(event.gateId);
          return 'repair';
        }
        if (event.status === 'passed') {
          failedGates.delete(event.gateId);
          return 'gate-pass';
        }
        if (event.status === 'failed' || event.status === 'blocked') {
          failedGates.add(event.gateId);
          return 'gate-fail';
        }
        return null;
      case 'plan/task-updated':
        if (event.status === 'failed' || event.status === 'blocked') {
          failedTasks.add(event.taskId);
          return 'gate-fail';
        }
        if (event.status === 'running') {
          if (!failedTasks.has(event.taskId)) return null;
          failedTasks.delete(event.taskId);
          return 'repair';
        }
        return null;
      default:
        return null;
    }
  }

  function handleEvent(event: DomainEvent): void {
    const cue = resolveCue(event);
    if (cue) trigger(cue);
  }

  /* -------------------------------------------------------------------- public API */

  async function unlock(): Promise<boolean> {
    if (disposed) return false;

    if (!audioContext) {
      let created: AudioContext;
      try {
        created = createContext();
      } catch (error) {
        console.warn('[coroid] audio unavailable; the bus stays silent', error);
        return false;
      }
      audioContext = created;
      contextsCreated += 1;
      buildOutputGraph(created);
      applyOutputLevel();
    }

    // The graph exists: cues scheduled from here on will sound once resumed.
    unlocked = true;
    startAmbience();

    if (audioContext.state !== 'running') {
      try {
        await audioContext.resume();
      } catch (error) {
        console.warn('[coroid] audio context failed to resume', error);
        return false;
      }
    }
    return audioContext.state === 'running';
  }

  function trigger(cue: AudioCue): boolean {
    const ctx = audioContext;
    if (disposed || !unlocked || !ctx || ctx.state === 'closed' || muted) {
      cuesSuppressed += 1;
      return false;
    }
    sweepVoices();
    scheduleCue(cue);
    cuesPlayed += 1;
    lastCue = cue;
    return true;
  }

  function connect(events: DomainEventChannel): () => void {
    if (disposed) return () => {};
    const unsubscribe = events.on(handleEvent);
    const detach = (): void => {
      unsubscribe();
      subscriptions.delete(detach);
    };
    subscriptions.add(detach);
    return detach;
  }

  function attachUnlockOnGesture(target: EventTarget): () => void {
    if (disposed) return () => {};

    function detach(): void {
      target.removeEventListener('pointerdown', onGesture);
      target.removeEventListener('keydown', onGesture);
      gestureDetachers.delete(detach);
    }

    function onGesture(): void {
      detach();
      void unlock();
    }

    target.addEventListener('pointerdown', onGesture);
    target.addEventListener('keydown', onGesture);
    gestureDetachers.add(detach);
    return detach;
  }

  function setMuted(next: boolean): void {
    if (muted === next) return;
    muted = next;
    applyOutputLevel();
  }

  function setReducedMotion(next: boolean): void {
    if (reducedMotion === next) return;
    reducedMotion = next;
    // Rebuild the bed so its modulation layers appear or disappear immediately.
    if (ambienceSources.length > 0) {
      stopAmbience();
      startAmbience();
    }
  }

  function setAmbienceEnabled(next: boolean): void {
    if (ambienceEnabled === next) return;
    ambienceEnabled = next;
    if (next) startAmbience();
    else stopAmbience();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    unlocked = false;

    for (const detach of [...gestureDetachers]) detach();
    gestureDetachers.clear();
    for (const unsubscribe of [...subscriptions]) unsubscribe();
    subscriptions.clear();

    stopAmbience();
    for (const source of [...voices.keys()]) releaseVoice(source);
    voices.clear();
    disconnectAll([...nodes], 'audio node');
    nodes.clear();

    mixer = null;
    masterGain = null;
    sfxGain = null;
    ambienceGain = null;
    noiseBuffer = null;

    // The context reference is retained so hosts can observe `state === 'closed'`.
    const closing = audioContext;
    if (!closing) return;
    try {
      const attempt = closing.close();
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch((error: unknown) => {
          console.warn('[coroid] audio context failed to close', error);
        });
      }
    } catch (error) {
      console.warn('[coroid] audio context failed to close', error);
    }
  }

  return {
    get unlocked() {
      return unlocked;
    },
    get muted() {
      return muted;
    },
    get reducedMotion() {
      return reducedMotion;
    },
    get disposed() {
      return disposed;
    },
    get context() {
      return audioContext;
    },
    get stats(): AudioBusStats {
      sweepVoices();
      return {
        unlocked,
        muted,
        reducedMotion,
        disposed,
        contextsCreated,
        cuesPlayed,
        cuesSuppressed,
        activeVoices: voices.size,
        nodes: nodes.size,
        outputLevel: muted ? 0 : masterVolume,
        lastCue,
      };
    },
    unlock,
    trigger,
    handleEvent,
    connect,
    attachUnlockOnGesture,
    setMuted,
    setReducedMotion,
    setAmbienceEnabled,
    dispose,
  };
}
