/**
 * Chrono City — synthesized SFX engine.
 *
 * Every sound the block makes is generated at runtime with the Web Audio API:
 * oscillators, deterministic noise buffers and biquad filters. There are no
 * sample files, no network fetches and no third-party audio dependency, so the
 * bundle stays fully static and every parameter remains inspectable.
 *
 * Graph shape (built once, lazily, when a context is available):
 *
 * ```text
 *   cue voices ─┬─► ambience ─┐
 *               ├─► traffic  ─┤
 *               ├─► music    ─┼─► bus sum ─► limiter ─► master ─► destination
 *               └─► effects  ─┘        ▲                     ▲
 *                          reverb send ─┘                     │
 *                                       volume × headroom ───┘
 * ```
 *
 * `master` is capped by {@link MIX_LIMITS.maxMasterGain} and scaled by the user
 * volume times the headroom factor, and the compressor in front of it catches
 * the rare overlapping transient, so the mix cannot clip no matter how many
 * cues land in the same frame.
 *
 * Playback is gesture gated: a context is only resumed from inside a real user
 * gesture, either via {@link SfxEngine.attachGestureStart} or by calling
 * `start(true)` from a gesture handler. A bare `start()` never resumes audio.
 * When the environment has no Web Audio implementation at all — or refuses to
 * construct one — the engine degrades to a deterministic, throwing-free no-op.
 */

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Mixer bus a cue or soundscape layer routes into. */
export type SfxBusId = "ambience" | "traffic" | "music" | "effects";

/** Canonical bus order, so records and tests iterate identically. */
export const SFX_BUS_IDS = [
  "ambience",
  "traffic",
  "music",
  "effects",
] as const satisfies readonly SfxBusId[];

/** Hard limits of the mix; every public setter clamps into these. */
export const MIX_LIMITS = {
  /** Absolute ceiling for the master output gain, headroom included. */
  maxMasterGain: 0.75,
  /** Default headroom multiplier applied on top of the user volume. */
  defaultHeadroom: 0.7,
  /** Volume used when the caller never calls `setVolume`. */
  defaultVolume: 0.8,
  /** Shortest scheduled fade, so gain changes never click. */
  minFadeSeconds: 0.02,
  /** Longest scheduled fade, so a bad caller cannot hold a stale mix louder. */
  maxFadeSeconds: 3,
  /** Send level feeding the algorithmic room tail. */
  reverbSendGain: 0.24,
  /** Ceiling of the room-tail feedback comb (stability guard). */
  maxReverbFeedback: 0.72,
  /** Bus profile of the compressor that protects the master stage. */
  limiter: { threshold: -6, knee: 6, ratio: 12, attack: 0.003, release: 0.25 },
} as const;

/**
 * Safe ranges for every synthesised parameter.
 *
 * The engine clamps at these bounds, which is what lets the soundscape promise
 * that a hand-authored (or future) ear descriptor cannot blow up the mix.
 */
export const SFX_SAFE_RANGES = {
  /**
   * Per-layer voice gain before the bus stage.
   *
   * The soundscape normalises a bus's layers up to its material level, so a
   * single-layer bus can legitimately ask for the full ceiling; the bus fader,
   * the limiter and the capped master still stand between it and the output.
   */
  layerGain: { min: 0, max: 0.6 },
  /** Per-cue one-shot gain. */
  cueGain: { min: 0, max: 0.35 },
  /** User volume. */
  volume: { min: 0, max: 1 },
  /** Audible frequency window; below/above this is inaudible or harsh. */
  frequency: { min: 20, max: 18000 },
  /** Biquad Q; above ~24 self-oscillates unpleasantly. */
  q: { min: 0.05, max: 24 },
  /** Oscillator detune, in cents. */
  detuneCents: { min: -1200, max: 1200 },
} as const;

/* -------------------------------------------------------------------------- */
/* Small pure helpers (exported for deterministic tests)                      */
/* -------------------------------------------------------------------------- */

/** Clamps `value` into `[0, 1]`; `NaN` collapses to 0. */
export function clamp01(value: number): number {
  return clampRange(value, 0, 1);
}

/** Clamps `value` into `[min, max]`; non-finite input collapses to `min`. */
export function clampRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return value <= min ? min : value >= max ? max : value;
}

/**
 * Effective master gain for a volume/mute/headroom triple.
 *
 * Muting wins over everything (the graph ramps to true silence), and the
 * result can never exceed {@link MIX_LIMITS.maxMasterGain}, which is the
 * headroom guarantee the soundscape relies on.
 */
export function computeMasterGain(volume: number, muted: boolean, headroom: number): number {
  if (muted) {
    return 0;
  }
  const safeHeadroom = clampRange(headroom, 0, MIX_LIMITS.maxMasterGain);
  return clampRange(clamp01(volume) * safeHeadroom, 0, MIX_LIMITS.maxMasterGain);
}

/** Feedback coefficient of the room tail for a reverb time in seconds. */
export function reverbFeedbackFor(reverbSeconds: number): number {
  const seconds = clampRange(reverbSeconds, 0, 4);
  return clampRange(0.22 + seconds * 0.5, 0.2, MIX_LIMITS.maxReverbFeedback);
}

/** Comb delay, in seconds, of the room tail for a reverb time in seconds. */
export function reverbDelayFor(reverbSeconds: number): number {
  const seconds = clampRange(reverbSeconds, 0, 4);
  return clampRange(0.035 + seconds * 0.05, 0.02, 0.25);
}

/** Deterministic 32-bit PRNG; keeps the noise buffers reproducible. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/** Counters of everything the engine has actually scheduled. */
export interface SfxCueCounters {
  readonly footsteps: number;
  readonly horns: number;
  readonly stingers: number;
  readonly whooshes: number;
  readonly chimes: number;
  readonly tones: number;
  readonly noiseBursts: number;
}

/** Deterministic engine snapshot; the whole audio state tests can assert on. */
export interface SfxEngineState {
  readonly available: boolean;
  readonly running: boolean;
  /** True once a gesture-gated start succeeded. */
  readonly started: boolean;
  /** True once any user gesture has been observed. */
  readonly gestureSeen: boolean;
  readonly muted: boolean;
  readonly volume: number;
  readonly headroom: number;
  /** Effective master gain after volume, mute and headroom. */
  readonly masterGain: number;
  readonly reverbSeconds: number;
  readonly reverbFeedback: number;
  readonly cues: SfxCueCounters;
  /** Audio clock in seconds; 0 when no context exists. */
  readonly time: number;
}

export interface SfxEngineOptions {
  /** Explicit context; pass `null` to force the no-Web-Audio path. */
  readonly context?: AudioContext | null;
  /** Factory used when `context` is omitted (tests inject a recorder here). */
  readonly factory?: () => AudioContext | null;
  readonly volume?: number;
  readonly muted?: boolean;
  /** Headroom multiplier; clamped to `[0, maxMasterGain]`. */
  readonly headroom?: number;
  /** Seed of the deterministic noise buffers. */
  readonly seed?: number;
}

export interface ToneOptions {
  readonly frequency: number;
  readonly waveform?: OscillatorType;
  readonly duration: number;
  readonly gain?: number;
  readonly detune?: number;
  readonly bus?: SfxBusId;
  /** Explicit destination node; overrides `bus` when given. */
  readonly destination?: AudioNode;
  readonly attack?: number;
  /** Optional pitch glide target reached at the end of the note. */
  readonly glideTo?: number;
}

export interface NoiseBurstOptions {
  readonly duration: number;
  readonly gain?: number;
  readonly filter?: BiquadFilterType;
  readonly frequency: number;
  /** Optional filter sweep target reached at the end of the burst. */
  readonly endFrequency?: number;
  readonly q?: number;
  readonly bus?: SfxBusId;
  /** Explicit destination node; overrides `bus` when given. */
  readonly destination?: AudioNode;
  readonly attack?: number;
}

/** Horn timbres the block's eras can ask for. */
export type HornTimbre = "brass-two-tone" | "air-horn" | "streetcar-bell" | "ev-chirp";

export interface FootstepOptions {
  readonly surface?: "pavement" | "asphalt" | "grate" | "tile";
  readonly gain?: number;
}

export interface HornOptions {
  readonly timbre?: HornTimbre;
  readonly gain?: number;
}

export interface StingerOptions {
  readonly gain?: number;
  readonly duration?: number;
}

/**
 * The Web Audio engine contract.
 *
 * All mutators are safe to call at any time, in any order, with or without an
 * audio implementation present.
 */
export interface SfxEngine {
  readonly available: boolean;
  /** The live audio context, or `null` when Web Audio is unavailable. */
  readonly context: AudioContext | null;
  readonly state: SfxEngineState;
  /** Current audio-clock time in seconds (0 without a context). */
  now(): number;
  isRunning(): boolean;
  /**
   * Resume audio. `fromUserGesture` must be true for the very first resume —
   * this is what keeps the engine gesture gated. Returns whether the engine is
   * running afterwards.
   */
  start(fromUserGesture?: boolean): boolean;
  /**
   * Binds one-shot gesture listeners that start audio, and returns a detach
   * function. The listeners remove themselves once the engine is running.
   */
  attachGestureStart(target: EventTarget): () => void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  setReverb(reverbSeconds: number): void;
  /** Input node of a bus, so external voice sets can route into the mix. */
  busInput(bus: SfxBusId): AudioNode | null;
  tone(options: ToneOptions): void;
  noiseBurst(options: NoiseBurstOptions): void;
  footstep(options?: FootstepOptions): void;
  horn(options?: HornOptions): void;
  /** Rising/falling filtered-noise sweep used by the era transition. */
  whoosh(options?: StingerOptions): void;
  /** Bell-like partial stack used by the era transition. */
  chime(options?: StingerOptions): void;
  /** Whoosh + chime layered: the era-change signature. */
  transitionStinger(options?: StingerOptions): void;
  /**
   * Tears the graph down and closes the context.
   *
   * Safe to call twice, and safe when Web Audio was never available. Callers
   * that share one context between systems should keep ownership of it and
   * simply stop scheduling cues instead.
   */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Internal graph                                                             */
/* -------------------------------------------------------------------------- */

interface SynthGraph {
  readonly context: AudioContext;
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly busSum: GainNode;
  readonly buses: Record<SfxBusId, GainNode>;
  readonly reverbSend: GainNode;
  readonly reverbDelay: DelayNode;
  readonly reverbFeedback: GainNode;
  readonly reverbOut: GainNode;
  readonly noise: AudioBuffer;
}

/** Fully silent ramp floor: `exponentialRampToValueAtTime` cannot reach zero. */
const SILENCE = 0.0001;

/* -------------------------------------------------------------------------- */
/* Engine                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Builds a synthesized SFX engine.
 *
 * The returned object never throws on the audio path: with no Web Audio
 * implementation every cue is a no-op and the deterministic state still reports
 * the requested volume, mute and reverb settings.
 */
export function createSfxEngine(options: SfxEngineOptions = {}): SfxEngine {
  const headroom = clampRange(options.headroom ?? MIX_LIMITS.defaultHeadroom, 0, MIX_LIMITS.maxMasterGain);
  const noise = mulberry32(options.seed ?? 0x5eed);

  let volume = clamp01(options.volume ?? MIX_LIMITS.defaultVolume);
  let muted = options.muted ?? false;
  let started = false;
  let gestureSeen = false;
  let reverbSeconds = 0.4;
  let graph: SynthGraph | null = null;
  let disposed = false;

  const counters = {
    footsteps: 0,
    horns: 0,
    stingers: 0,
    whooshes: 0,
    chimes: 0,
    tones: 0,
    noiseBursts: 0,
  };

  graph = buildGraph(resolveContext(options), noise);

  function snapshot(): SfxEngineState {
    return {
      available: graph !== null,
      running: isRunning(),
      started,
      gestureSeen,
      muted,
      volume,
      headroom,
      masterGain: computeMasterGain(volume, muted, headroom),
      reverbSeconds,
      reverbFeedback: reverbFeedbackFor(reverbSeconds),
      cues: { ...counters },
      time: graph ? graph.context.currentTime : 0,
    };
  }

  function isRunning(): boolean {
    return graph !== null && started && !muted;
  }

  /** True when a cue may be scheduled: audio is live and audible. */
  function canPlay(): boolean {
    return isRunning();
  }

  function applyMasterGain(): void {
    if (!graph) {
      return;
    }
    const target = computeMasterGain(volume, muted, headroom);
    const now = graph.context.currentTime;
    const gain = graph.master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(target, now + MIX_LIMITS.minFadeSeconds);
  }

  function busNode(bus: SfxBusId): GainNode | null {
    return graph ? graph.buses[bus] ?? null : null;
  }

  const engine: SfxEngine = {
    get available() {
      return graph !== null;
    },
    get context() {
      return graph ? graph.context : null;
    },
    get state() {
      return snapshot();
    },
    now() {
      return graph ? graph.context.currentTime : 0;
    },
    isRunning,
    start(fromUserGesture = false) {
      if (disposed || !graph) {
        return false;
      }
      if (fromUserGesture) {
        gestureSeen = true;
      }
      if (!gestureSeen) {
        // Hard gesture gate: never resume the clock without a real interaction.
        return false;
      }

      const context = graph.context;
      if (context.state === "suspended") {
        const resumed = context.resume();
        if (resumed && typeof resumed.then === "function") {
          resumed.then(
            () => {
              started = true;
            },
            () => {
              started = false;
            },
          );
        }
      }
      started = true;
      applyMasterGain();
      return isRunning();
    },
    attachGestureStart(target: EventTarget) {
      const gestureEvents = ["pointerdown", "keydown", "touchstart"] as const;
      const detach = (): void => {
        for (const type of gestureEvents) {
          target.removeEventListener(type, onGesture);
        }
      };
      function onGesture(): void {
        engine.start(true);
        if (engine.isRunning()) {
          detach();
        }
      }
      for (const type of gestureEvents) {
        target.addEventListener(type, onGesture);
      }
      return detach;
    },
    setMuted(nextMuted: boolean) {
      muted = Boolean(nextMuted);
      applyMasterGain();
    },
    setVolume(nextVolume: number) {
      volume = clamp01(nextVolume);
      applyMasterGain();
    },
    setReverb(seconds: number) {
      reverbSeconds = clampRange(seconds, 0, 4);
      if (!graph) {
        return;
      }
      const now = graph.context.currentTime;
      const delay = graph.reverbDelay.delayTime;
      delay.cancelScheduledValues(now);
      delay.setValueAtTime(reverbDelayFor(reverbSeconds), now);
      const feedback = graph.reverbFeedback.gain;
      feedback.cancelScheduledValues(now);
      feedback.setValueAtTime(reverbFeedbackFor(reverbSeconds), now);
    },
    busInput: busNode,
    tone(toneOptions: ToneOptions) {
      if (!canPlay() || !graph) {
        return;
      }
      const destination = toneOptions.destination ?? busNode(toneOptions.bus ?? "effects");
      if (!destination) {
        return;
      }
      scheduleTone(graph.context, destination, toneOptions);
      counters.tones += 1;
    },
    noiseBurst(burstOptions: NoiseBurstOptions) {
      if (!canPlay() || !graph) {
        return;
      }
      const destination = burstOptions.destination ?? busNode(burstOptions.bus ?? "effects");
      if (!destination) {
        return;
      }
      scheduleNoiseBurst(graph.context, graph.noise, destination, burstOptions);
      counters.noiseBursts += 1;
    },
    footstep(footstepOptions: FootstepOptions = {}) {
      if (!canPlay() || !graph) {
        return;
      }
      const bus = busNode("effects");
      if (!bus) {
        return;
      }
      const surface = footstepOptions.surface ?? "pavement";
      const body = SURFACE_CUTOFF[surface];
      scheduleNoiseBurst(graph.context, graph.noise, bus, {
        duration: body.duration,
        gain: clampRange(footstepOptions.gain ?? 0.16, 0, SFX_SAFE_RANGES.cueGain.max),
        filter: "lowpass",
        frequency: body.low,
        endFrequency: body.high,
        q: 0.9,
        attack: 0.004,
      });
      counters.noiseBursts += 1;
      counters.footsteps += 1;
    },
    horn(hornOptions: HornOptions = {}) {
      if (!canPlay() || !graph) {
        return;
      }
      const bus = busNode("effects");
      if (!bus) {
        return;
      }
      scheduleHorn(graph.context, bus, hornOptions.timbre ?? "brass-two-tone", hornOptions.gain);
      counters.horns += 1;
    },
    whoosh(stingerOptions: StingerOptions = {}) {
      if (!canPlay() || !graph) {
        return;
      }
      const bus = busNode("effects");
      if (!bus) {
        return;
      }
      scheduleWhoosh(graph.context, graph.noise, bus, stingerOptions);
      counters.noiseBursts += 1;
      counters.whooshes += 1;
    },
    chime(stingerOptions: StingerOptions = {}) {
      if (!canPlay() || !graph) {
        return;
      }
      const bus = busNode("effects");
      if (!bus) {
        return;
      }
      scheduleChime(graph.context, bus, stingerOptions);
      counters.chimes += 1;
    },
    transitionStinger(stingerOptions: StingerOptions = {}) {
      if (!canPlay() || !graph) {
        return;
      }
      const bus = busNode("effects");
      if (!bus) {
        return;
      }
      // Layered signature: the sweep announces the change, the chime lands on
      // top of the crossfade a beat later.
      scheduleWhoosh(graph.context, graph.noise, bus, stingerOptions);
      counters.noiseBursts += 1;
      counters.whooshes += 1;
      scheduleChime(graph.context, bus, {
        gain: (stingerOptions.gain ?? 0.16) * 0.9,
        duration: stingerOptions.duration,
        delay: 0.08,
      });
      counters.chimes += 1;
      counters.stingers += 1;
    },
    dispose() {
      disposed = true;
      started = false;
      if (!graph) {
        return;
      }
      const context = graph.context;
      for (const bus of SFX_BUS_IDS) {
        disconnectQuietly(graph.buses[bus]);
      }
      disconnectQuietly(graph.reverbSend);
      disconnectQuietly(graph.reverbDelay);
      disconnectQuietly(graph.reverbFeedback);
      disconnectQuietly(graph.reverbOut);
      disconnectQuietly(graph.busSum);
      disconnectQuietly(graph.limiter);
      disconnectQuietly(graph.master);
      graph = null;
      const closer = context.close;
      if (typeof closer === "function") {
        try {
          void context.close();
        } catch {
          // A context that is already closed (or closing) is fine.
        }
      }
    },
  };

  if (graph) {
    applyMasterGain();
    engine.setReverb(reverbSeconds);
  }

  return engine;
}

/* -------------------------------------------------------------------------- */
/* Graph construction                                                         */
/* -------------------------------------------------------------------------- */

/** Resolves the context to use, honouring the explicit no-audio escape hatch. */
function resolveContext(options: SfxEngineOptions): AudioContext | null {
  if (options.context !== undefined) {
    return options.context;
  }
  if (options.factory) {
    try {
      return options.factory() ?? null;
    } catch {
      return null;
    }
  }
  return defaultAudioContext();
}

/** Constructs the platform context, or `null` when Web Audio is unavailable. */
function defaultAudioContext(): AudioContext | null {
  const scope = globalThis as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

/**
 * Builds the mixing graph; returns `null` when the context is missing or the
 * implementation rejects a node type, which keeps the engine a silent no-op
 * instead of a crash on exotic runtimes.
 */
function buildGraph(context: AudioContext | null, noise: () => number): SynthGraph | null {
  if (!context) {
    return null;
  }
  try {
    const master = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = MIX_LIMITS.limiter.threshold;
    limiter.knee.value = MIX_LIMITS.limiter.knee;
    limiter.ratio.value = MIX_LIMITS.limiter.ratio;
    limiter.attack.value = MIX_LIMITS.limiter.attack;
    limiter.release.value = MIX_LIMITS.limiter.release;

    const busSum = context.createGain();
    busSum.gain.value = 1;

    const buses = {} as Record<SfxBusId, GainNode>;
    for (const bus of SFX_BUS_IDS) {
      const node = context.createGain();
      node.gain.value = 1;
      node.connect(busSum);
      buses[bus] = node;
    }

    // Algorithmic room tail: a single feedback comb whose delay and decay come
    // from the era descriptor's `reverbSeconds`, so no impulse response files
    // (and no convolver) are needed.
    const reverbSend = context.createGain();
    reverbSend.gain.value = MIX_LIMITS.reverbSendGain;
    const reverbDelay = context.createDelay(0.5);
    const reverbFeedback = context.createGain();
    const reverbOut = context.createGain();
    reverbOut.gain.value = 0.7;

    reverbSend.connect(reverbDelay);
    reverbDelay.connect(reverbFeedback);
    reverbFeedback.connect(reverbDelay);
    reverbDelay.connect(reverbOut);
    reverbOut.connect(limiter);
    for (const bus of SFX_BUS_IDS) {
      buses[bus].connect(reverbSend);
    }

    busSum.connect(limiter);
    limiter.connect(master);
    master.connect(context.destination);

    return {
      context,
      master,
      limiter,
      busSum,
      buses,
      reverbSend,
      reverbDelay,
      reverbFeedback,
      reverbOut,
      noise: createNoiseBuffer(context, 2, noise),
    };
  } catch {
    return null;
  }
}

/**
 * Builds the shared white-noise source buffer.
 *
 * The samples come from a seeded PRNG, so two engines built with the same seed
 * produce byte-identical buffers and audio output stays reproducible.
 */
export function createNoiseBuffer(context: BaseAudioContext, seconds = 2, random: () => number = Math.random): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * clampRange(seconds, 0.05, 8)));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    channel[index] = random() * 2 - 1;
  }
  return buffer;
}

/* -------------------------------------------------------------------------- */
/* Voice synthesis                                                            */
/* -------------------------------------------------------------------------- */

/** Filter window of each footstep surface, in Hz. */
const SURFACE_CUTOFF: Readonly<Record<string, { readonly low: number; readonly high: number; readonly duration: number }>> = {
  pavement: { low: 900, high: 260, duration: 0.11 },
  asphalt: { low: 700, high: 200, duration: 0.13 },
  grate: { low: 2600, high: 900, duration: 0.16 },
  tile: { low: 3200, high: 1400, duration: 0.09 },
};

/** Schedules a single enveloped oscillator note. */
function scheduleTone(context: AudioContext, bus: AudioNode, options: ToneOptions): void {
  const start = context.currentTime;
  const duration = clampRange(options.duration, 0.02, 6);
  const attack = clampRange(options.attack ?? 0.008, 0.001, duration * 0.9);
  const peak = clampRange(options.gain ?? 0.12, 0, SFX_SAFE_RANGES.cueGain.max);

  const oscillator = context.createOscillator();
  oscillator.type = options.waveform ?? "sine";
  oscillator.frequency.setValueAtTime(clampRange(options.frequency, SFX_SAFE_RANGES.frequency.min, SFX_SAFE_RANGES.frequency.max), start);
  if (options.glideTo !== undefined) {
    oscillator.frequency.linearRampToValueAtTime(
      clampRange(options.glideTo, SFX_SAFE_RANGES.frequency.min, SFX_SAFE_RANGES.frequency.max),
      start + duration * 0.85,
    );
  }
  oscillator.detune.value = clampRange(options.detune ?? 0, SFX_SAFE_RANGES.detuneCents.min, SFX_SAFE_RANGES.detuneCents.max);

  const envelope = context.createGain();
  envelope.gain.setValueAtTime(SILENCE, start);
  envelope.gain.linearRampToValueAtTime(peak, start + attack);
  envelope.gain.exponentialRampToValueAtTime(SILENCE, start + duration);

  oscillator.connect(envelope);
  envelope.connect(bus);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

/** Schedules an enveloped filtered noise burst, optionally filter-swept. */
function scheduleNoiseBurst(
  context: AudioContext,
  noise: AudioBuffer,
  bus: AudioNode,
  options: NoiseBurstOptions,
): void {
  const start = context.currentTime;
  const duration = clampRange(options.duration, 0.02, 6);
  const attack = clampRange(options.attack ?? 0.01, 0.001, duration * 0.9);
  const peak = clampRange(options.gain ?? 0.14, 0, SFX_SAFE_RANGES.cueGain.max);
  const frequency = clampRange(options.frequency, SFX_SAFE_RANGES.frequency.min, SFX_SAFE_RANGES.frequency.max);

  const source = context.createBufferSource();
  source.buffer = noise;
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = options.filter ?? "lowpass";
  filter.frequency.setValueAtTime(frequency, start);
  if (options.endFrequency !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(
      clampRange(options.endFrequency, SFX_SAFE_RANGES.frequency.min, SFX_SAFE_RANGES.frequency.max),
      start + duration,
    );
  }
  filter.Q.value = clampRange(options.q ?? 0.8, SFX_SAFE_RANGES.q.min, SFX_SAFE_RANGES.q.max);

  const envelope = context.createGain();
  envelope.gain.setValueAtTime(SILENCE, start);
  envelope.gain.linearRampToValueAtTime(peak, start + attack);
  envelope.gain.exponentialRampToValueAtTime(SILENCE, start + duration);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(bus);
  source.start(start);
  source.stop(start + duration + 0.02);
}

/** Two-tone brass, air horn, streetcar bell or EV chirp, chosen per era. */
function scheduleHorn(context: AudioContext, bus: AudioNode, timbre: HornTimbre, gain?: number): void {
  const peak = clampRange(gain ?? 0.18, 0, SFX_SAFE_RANGES.cueGain.max);
  switch (timbre) {
    case "air-horn":
      scheduleTone(context, bus, { frequency: 155, waveform: "sawtooth", duration: 0.9, gain: peak, attack: 0.05 });
      scheduleTone(context, bus, { frequency: 196, waveform: "sawtooth", duration: 0.9, gain: peak * 0.8, attack: 0.05, detune: 6 });
      break;
    case "streetcar-bell":
      scheduleTone(context, bus, { frequency: 1046.5, waveform: "triangle", duration: 0.28, gain: peak * 0.7, attack: 0.003 });
      scheduleTone(context, bus, { frequency: 1568, waveform: "triangle", duration: 0.2, gain: peak * 0.35, attack: 0.003 });
      break;
    case "ev-chirp":
      scheduleTone(context, bus, { frequency: 1180, waveform: "sine", duration: 0.26, gain: peak * 0.6, attack: 0.01, glideTo: 2360 });
      break;
    case "brass-two-tone":
    default:
      scheduleTone(context, bus, { frequency: 440, waveform: "square", duration: 0.45, gain: peak, attack: 0.012 });
      scheduleTone(context, bus, { frequency: 554.37, waveform: "square", duration: 0.45, gain: peak * 0.85, attack: 0.012, detune: 8 });
      break;
  }
}

/** Filtered-noise sweep that announces an era change. */
function scheduleWhoosh(context: AudioContext, noise: AudioBuffer, bus: AudioNode, options: StingerOptions): void {
  const duration = clampRange(options.duration ?? 0.7, 0.15, 2.5);
  scheduleNoiseBurst(context, noise, bus, {
    duration,
    gain: clampRange(options.gain ?? 0.2, 0, SFX_SAFE_RANGES.cueGain.max),
    filter: "bandpass",
    frequency: 220,
    endFrequency: 4200,
    q: 0.9,
    attack: duration * 0.45,
  });
}

/** Bell-like partial stack that lands on the crossfade. */
function scheduleChime(context: AudioContext, bus: AudioNode, options: StingerOptions & { delay?: number }): void {
  const start = clampRange(options.delay ?? 0, 0, 1);
  const duration = clampRange(options.duration ?? 1.1, 0.2, 3);
  const peak = clampRange(options.gain ?? 0.16, 0, SFX_SAFE_RANGES.cueGain.max);
  const partials = [
    { frequency: 659.25, ratio: 1 },
    { frequency: 830.61, ratio: 0.72 },
    { frequency: 987.77, ratio: 0.58 },
    { frequency: 1318.51, ratio: 0.34 },
  ];

  for (const [index, partial] of partials.entries()) {
    const base = context.currentTime + start;
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(partial.frequency, base);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(SILENCE, base);
    envelope.gain.linearRampToValueAtTime(peak * partial.ratio, base + 0.006 + index * 0.004);
    envelope.gain.exponentialRampToValueAtTime(SILENCE, base + duration * (1 - index * 0.12));
    oscillator.connect(envelope);
    envelope.connect(bus);
    oscillator.start(base);
    oscillator.stop(base + duration + 0.05);
  }
}

/** Best-effort disconnect; a half-built graph must never throw on teardown. */
function disconnectQuietly(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Already disconnected at worst.
  }
}
