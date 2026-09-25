/**
 * Chrono City — era soundscapes.
 *
 * A *soundscape* is the audible half of an era descriptor: an ambience bed, a
 * traffic layer, a crowd murmur, a music motif, plus mechanical and nature
 * punctuation. Every parameter comes from the real {@link SoundDescriptor} in
 * `src/era/eraTypes.ts` (`layers`, `mixer`, `musicStyle`, `musicTempo`,
 * `trafficGain`, `reverbSeconds`), so the block sounds like the period the
 * slider is showing and a future era only needs data, not code.
 *
 * Layout of one era's voice set:
 *
 * ```text
 *   layer voices ─► era bus faders ─► engine bus ─► limiter ─► master ─► out
 *   (beds, motif,        (mixer[bus] × crossfade weight)
 *    punctuation)
 * ```
 *
 * Layer gains and bus faders are both clamped, and their sum can never exceed
 * 1, which is what makes the master stage's headroom a guarantee instead of a
 * hope. {@link describeSoundscapeMix} exposes exactly that arithmetic so tests
 * can assert it per era and per crossfade position without an audio device.
 */

import {
  clampBlend,
  getEraConfig,
  resolveEraWeights,
  type EraAware,
  type EraId,
  type EraUpdateContext,
  type SoundDescriptor,
  type SoundLayer,
  type SoundLayerKind,
  type SoundMixer,
} from "../era/eraTypes";
import {
  SFX_SAFE_RANGES,
  clamp01,
  clampRange,
  createNoiseBuffer,
  createSfxEngine,
  mulberry32,
  type FootstepOptions,
  type HornOptions,
  type NoiseBurstOptions,
  type SfxBusId,
  type SfxEngine,
  type SfxEngineOptions,
  type ToneOptions,
} from "./sfx";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Invariants and budgets of the soundscape mixer. */
export const SOUNDSCAPE_LIMITS = {
  /**
   * Nominal full-scale material a bus presents to its fader.
   *
   * Descriptor layer gains are relative weights *inside* a bus, so each bus is
   * normalised up to this level before the mixer fader is applied. That is what
   * makes the mixer profile — and never the layer count — decide how loud a bus
   * is, while still leaving the remaining fader travel as cue headroom.
   */
  busMaterialGain: 0.6,
  /** Ceiling of all buses' material summed (4 buses × {@link busMaterialGain}). */
  maxMaterialLoad: 2.4,
  /** Ceiling of everything summed through the bus faders; must stay ≤ 1. */
  maxMasterInput: 1,
  /** Ceiling of any era bus fader. */
  maxBusGain: 1,
  /** Shortest crossfade the soundscape will schedule, in seconds. */
  minCrossfadeSeconds: 0.2,
  /** Longest crossfade the soundscape will schedule, in seconds. */
  maxCrossfadeSeconds: 4,
  /** Smoothing applied to per-frame blend tracking, in seconds. */
  followSeconds: 0.06,
  /** Tempo window; descriptors outside it are clamped, not trusted. */
  minTempo: 40,
  maxTempo: 220,
  /** Voice budget of one era's continuous beds plus punctuation layers. */
  maxVoicesPerEra: 12,
  /** Music bus attenuation while a transition stinger is ringing. */
  stingerDuck: 0.35,
  /** Decay time of that duck, in seconds. */
  stingerDuckSeconds: 1.1,
} as const;

/**
 * Which mixer bus a descriptor layer routes into.
 *
 * Voice chatter and machinery are both one-shot effects bed material, nature
 * belongs with the ambience bed, and music gets its own fader so the HUD mute
 * and the transition duck can act on it alone.
 */
export const LAYER_BUS: Readonly<Record<SoundLayerKind, SfxBusId>> = {
  ambience: "ambience",
  traffic: "traffic",
  music: "music",
  voice: "effects",
  mechanical: "effects",
  nature: "ambience",
};

/** Mixer bus a layer kind routes into. */
export function busForLayerKind(kind: SoundLayerKind): SfxBusId {
  return LAYER_BUS[kind];
}

/**
 * Bus fader of one era, before any crossfade weighting.
 *
 * `trafficGain` is the descriptor's pre-mixer traffic level, so the traffic bus
 * is the mixer value scaled by it: 1945's unmuffled four-strokes stay louder
 * than 2025's tyre hiss even though both eras carry traffic layers.
 */
export function eraBusGain(descriptor: SoundDescriptor, bus: SfxBusId): number {
  const mixerGain = descriptor.mixer[bus];
  const scaled = bus === "traffic" ? mixerGain * clamp01(descriptor.trafficGain) : mixerGain;
  return clampRange(scaled, 0, SOUNDSCAPE_LIMITS.maxBusGain);
}

/* -------------------------------------------------------------------------- */
/* Music motifs                                                               */
/* -------------------------------------------------------------------------- */

/** Recognisable musical identity of an era. */
export type MotifLabel = "jazz" | "rock" | "synth" | "pop" | "ambient" | "neutral";

/**
 * One era's music motif.
 *
 * Patterns are indexed by scale degree (a negative entry is a rest), which
 * makes the motif data trivially transposable and keeps the synth free of
 * note-name parsing.
 */
export interface MusicMotif {
  /** `SoundDescriptor.musicStyle` this motif answers to. */
  readonly style: string;
  readonly label: MotifLabel;
  /** Root pitch of the motif, in Hz. */
  readonly rootHz: number;
  /** Semitone offsets from the root. */
  readonly scale: readonly number[];
  /** Lead pattern, one entry per step (negative = rest). */
  readonly melody: readonly number[];
  /** Bass pattern, one entry per bar window (negative = rest). */
  readonly bass: readonly number[];
  readonly waveform: OscillatorType;
  readonly bassWaveform: OscillatorType;
  /** Detune of the second lead voice, in cents (chorusing). */
  readonly detuneCents: number;
  /** 0..1 swing push applied to the off-beats. */
  readonly swing: number;
  /** Fraction of a beat one step occupies (0.25 = sixteenth note). */
  readonly stepBeats: number;
  /** Steps a single note holds for (2025's pads hold for a whole bar). */
  readonly holdSteps: number;
  /** Note envelope length, in seconds. */
  readonly noteSeconds: number;
  /** 0..1 harmonic brightness. */
  readonly brightness: number;
}

/**
 * The five motifs of the timeline, keyed by the descriptor's `musicStyle`.
 *
 * Keying by style (rather than by era id) means a re-themed era or a new stop
 * picks up the motif that matches its declared musical identity, and
 * {@link resolveMusicMotif} keeps unknown styles audible via a neutral pad.
 */
export const MUSIC_MOTIFS: Readonly<Record<string, MusicMotif>> = {
  "big-band-wireless": {
    style: "big-band-wireless",
    label: "jazz",
    rootHz: 220,
    scale: [0, 2, 4, 5, 7, 9, 10],
    melody: [0, 2, 4, 6, 5, 4, 2, -1],
    bass: [0, -1, 4, -1, 3, -1, 5, -1],
    waveform: "triangle",
    bassWaveform: "sine",
    detuneCents: 6,
    swing: 0.35,
    stepBeats: 0.5,
    holdSteps: 1,
    noteSeconds: 0.42,
    brightness: 0.35,
  },
  "surf-rock-and-motown": {
    style: "surf-rock-and-motown",
    label: "rock",
    rootHz: 196,
    scale: [0, 2, 4, 7, 9],
    melody: [0, 4, 2, 4, 5, 4, 2, 0],
    bass: [0, 0, 4, 4, 2, 2, 4, 4],
    waveform: "square",
    bassWaveform: "sawtooth",
    detuneCents: 8,
    swing: 0.08,
    stepBeats: 0.5,
    holdSteps: 1,
    noteSeconds: 0.3,
    brightness: 0.65,
  },
  "synth-pop-and-early-hip-hop": {
    style: "synth-pop-and-early-hip-hop",
    label: "synth",
    rootHz: 261.63,
    scale: [0, 2, 3, 5, 7, 8, 10],
    melody: [0, 2, 4, 2, 0, 4, 6, 4],
    bass: [0, -1, 0, -1, 4, -1, 4, -1],
    waveform: "sawtooth",
    bassWaveform: "square",
    detuneCents: 12,
    swing: 0,
    stepBeats: 0.25,
    holdSteps: 1,
    noteSeconds: 0.16,
    brightness: 0.8,
  },
  "pop-punk-and-crunk-radio": {
    style: "pop-punk-and-crunk-radio",
    label: "pop",
    rootHz: 293.66,
    scale: [0, 2, 4, 5, 7, 9, 11],
    melody: [4, 4, 2, 0, 2, 4, 7, -1],
    bass: [0, 0, 4, 4, 5, 5, 4, 4],
    waveform: "square",
    bassWaveform: "triangle",
    detuneCents: 6,
    swing: 0,
    stepBeats: 0.5,
    holdSteps: 1,
    noteSeconds: 0.24,
    brightness: 0.7,
  },
  "ambient-electronic-and-global-bass": {
    style: "ambient-electronic-and-global-bass",
    label: "ambient",
    rootHz: 174.61,
    scale: [0, 2, 4, 6, 7, 9, 11],
    melody: [0, 4, 2, 6],
    bass: [0, -1, -1, -1],
    waveform: "sine",
    bassWaveform: "sine",
    detuneCents: 10,
    swing: 0,
    stepBeats: 1,
    holdSteps: 4,
    noteSeconds: 1.8,
    brightness: 0.25,
  },
};

/** Neutral pad used for a `musicStyle` this build does not know yet. */
export const FALLBACK_MOTIF: MusicMotif = {
  style: "unknown",
  label: "neutral",
  rootHz: 220,
  scale: [0, 5, 7],
  melody: [0, -1, 1, -1],
  bass: [0, -1],
  waveform: "triangle",
  bassWaveform: "sine",
  detuneCents: 4,
  swing: 0,
  stepBeats: 1,
  holdSteps: 2,
  noteSeconds: 1.2,
  brightness: 0.4,
};

/** Resolves the motif for a descriptor's `musicStyle`. */
export function resolveMusicMotif(style: string): MusicMotif {
  return MUSIC_MOTIFS[style] ?? FALLBACK_MOTIF;
}

/** Frequency of a scale degree, with octave shifts for bass registers. */
export function motifFrequency(motif: MusicMotif, degree: number, octaveShift = 0): number {
  if (motif.scale.length === 0) {
    return motif.rootHz;
  }
  const size = motif.scale.length;
  const wrapped = ((degree % size) + size) % size;
  const octave = Math.floor(degree / size);
  const semitone = (motif.scale[wrapped] ?? 0) + 12 * (octave + octaveShift);
  return clampRange(
    motif.rootHz * Math.pow(2, semitone / 12),
    SFX_SAFE_RANGES.frequency.min,
    SFX_SAFE_RANGES.frequency.max,
  );
}

/* -------------------------------------------------------------------------- */
/* Acoustic profiles                                                          */
/* -------------------------------------------------------------------------- */

/** Timbral shaping of an era's continuous beds, in Hz. */
export interface AcousticProfile {
  /** Corner of the ambience bed's low-pass. */
  readonly ambienceHz: number;
  /** Band centre of the traffic layer. */
  readonly trafficHz: number;
  /** Band centre of the crowd/voice murmur. */
  readonly crowdHz: number;
  /** Filter window of the mechanical punctuation bursts. */
  readonly mechanicalHz: number;
  /** Base pitch of the nature chirps. */
  readonly natureHz: number;
  /** 0..1 grain: filter tightness and modulation depth. */
  readonly grain: number;
}

/**
 * Acoustic fingerprint of each era, keyed by the descriptor's `soundscape` id.
 *
 * The period's acoustic character is a data question (how clean is the air, how
 * loud are the streets, how dense is the crowd), so it lives beside the era
 * descriptors keyed exactly like the storefront and advertising style tables.
 */
export const ACOUSTIC_PROFILES: Readonly<Record<string, AcousticProfile>> = {
  "radio-era-street": {
    ambienceHz: 340,
    trafficHz: 620,
    crowdHz: 780,
    mechanicalHz: 520,
    natureHz: 2400,
    grain: 0.7,
  },
  "midcentury-boulevard": {
    ambienceHz: 520,
    trafficHz: 540,
    crowdHz: 900,
    mechanicalHz: 900,
    natureHz: 2100,
    grain: 0.5,
  },
  "analog-downtown": {
    ambienceHz: 640,
    trafficHz: 700,
    crowdHz: 1100,
    mechanicalHz: 1400,
    natureHz: 2000,
    grain: 0.45,
  },
  "early-digital-plaza": {
    ambienceHz: 760,
    trafficHz: 820,
    crowdHz: 1250,
    mechanicalHz: 1900,
    natureHz: 1900,
    grain: 0.3,
  },
  "mesh-soft-city": {
    ambienceHz: 940,
    trafficHz: 1150,
    crowdHz: 1000,
    mechanicalHz: 2600,
    natureHz: 2700,
    grain: 0.2,
  },
};

/** Profile used for a `soundscape` id this build does not know yet. */
export const FALLBACK_ACOUSTIC_PROFILE: AcousticProfile = {
  ambienceHz: 460,
  trafficHz: 620,
  crowdHz: 900,
  mechanicalHz: 1100,
  natureHz: 2200,
  grain: 0.45,
};

/** Resolves the acoustic profile for a descriptor's `soundscape` id. */
export function resolveAcousticProfile(soundscape: string): AcousticProfile {
  return ACOUSTIC_PROFILES[soundscape] ?? FALLBACK_ACOUSTIC_PROFILE;
}

/* -------------------------------------------------------------------------- */
/* Deterministic descriptors                                                  */
/* -------------------------------------------------------------------------- */

/** One descriptor layer, with its era, bus and crossfade contribution. */
export interface SoundscapeLayerState {
  readonly era: EraId;
  readonly id: string;
  readonly kind: SoundLayerKind;
  readonly bus: SfxBusId;
  readonly character: string;
  /** Descriptor gain (relative weight inside its bus), safely clamped. */
  readonly gain: number;
  /** Gain applied to this layer's voice node, normalised inside its bus. */
  readonly voiceGain: number;
  /** Crossfade weight of this layer's era (1 when fully settled). */
  readonly weight: number;
  /** `voiceGain × weight`: the layer's contribution to its bus. */
  readonly level: number;
  /** Blended bus fader this layer routes through. */
  readonly busGain: number;
}

/** Everything the runtime needs to voice one era, fully resolved. */
export interface EraSoundscapeState {
  readonly era: EraId;
  readonly soundscape: string;
  readonly ambience: string;
  readonly listenerProfile: string;
  readonly musicStyle: string;
  readonly musicTempo: number;
  readonly reverbSeconds: number;
  readonly trafficGain: number;
  readonly mixer: SoundMixer;
  readonly signatureCues: readonly string[];
  readonly motif: MusicMotif;
  readonly profile: AcousticProfile;
  /** Per-era bus faders, before crossfade weighting. */
  readonly busGains: Readonly<Record<SfxBusId, number>>;
  readonly layers: readonly SoundscapeLayerState[];
  /** Material each bus presents to its fader (≈ {@link SOUNDSCAPE_LIMITS.busMaterialGain}). */
  readonly materialByBus: Readonly<Record<SfxBusId, number>>;
}

/** Blend-weighted mix of one or two eras. */
export interface SoundscapeMixState {
  readonly from: EraId;
  readonly to: EraId;
  readonly blend: number;
  readonly weights: Readonly<Record<EraId, number>>;
  readonly busGains: Readonly<Record<SfxBusId, number>>;
  readonly layers: readonly SoundscapeLayerState[];
  /** Weighted material of every bus before its fader; ≤ `maxMaterialLoad`. */
  readonly materialLoad: number;
  /**
   * Everything summed through the bus faders, i.e. the peak that reaches the
   * capped master. Staying ≤ 1 here is the clipping guarantee.
   */
  readonly masterInputGain: number;
  /** Largest bus fader in the blended profile. */
  readonly peakBusGain: number;
  /** Music attenuation applied while a transition stinger rings, 0..1. */
  readonly musicDuck: number;
}

/** Tempo of an era, clamped into the supported window. */
export function soundscapeTempo(descriptor: SoundDescriptor): number {
  const tempo = descriptor.musicTempo;
  return clampRange(tempo, SOUNDSCAPE_LIMITS.minTempo, SOUNDSCAPE_LIMITS.maxTempo);
}

/** Layer gain clamped into the safe per-layer window. */
export function safeLayerGain(layer: SoundLayer): number {
  return clampRange(layer.gain, SFX_SAFE_RANGES.layerGain.min, SFX_SAFE_RANGES.layerGain.max);
}

/**
 * Fully resolves one era into a voiceable soundscape.
 *
 * Descriptor layer gains are relative weights inside a bus, so the voice stage
 * normalises each bus up to {@link SOUNDSCAPE_LIMITS.busMaterialGain} before
 * the era's fader is applied. The mixer profile — never the number of layers a
 * descriptor happens to declare — then decides how loud each bus is.
 */
export function describeEraSoundscape(era: EraId): EraSoundscapeState {
  const descriptor = getEraConfig(era).sound;
  const busGains = busGainsFor(descriptor);

  const busTotals = zeroBuses();
  for (const layer of descriptor.layers) {
    busTotals[busForLayerKind(layer.kind)] += safeLayerGain(layer);
  }

  const layers: SoundscapeLayerState[] = descriptor.layers.map((layer) => {
    const bus = busForLayerKind(layer.kind);
    const gain = safeLayerGain(layer);
    const total = busTotals[bus];
    const voiceGain = clampRange(
      total > 0 ? (gain / total) * SOUNDSCAPE_LIMITS.busMaterialGain : 0,
      SFX_SAFE_RANGES.layerGain.min,
      SFX_SAFE_RANGES.layerGain.max,
    );
    return {
      era,
      id: layer.id,
      kind: layer.kind,
      bus,
      character: layer.character,
      gain,
      voiceGain,
      weight: 1,
      level: voiceGain,
      busGain: busGains[bus],
    };
  });

  const materialByBus = zeroBuses();
  for (const layer of layers) {
    materialByBus[layer.bus] += layer.level;
  }

  return {
    era,
    soundscape: descriptor.soundscape,
    ambience: descriptor.ambience,
    listenerProfile: descriptor.listenerProfile,
    musicStyle: descriptor.musicStyle,
    musicTempo: soundscapeTempo(descriptor),
    reverbSeconds: descriptor.reverbSeconds,
    trafficGain: descriptor.trafficGain,
    mixer: descriptor.mixer,
    signatureCues: [...descriptor.signatureCues],
    motif: resolveMusicMotif(descriptor.musicStyle),
    profile: resolveAcousticProfile(descriptor.soundscape),
    busGains,
    layers,
    materialByBus,
  };
}

/**
 * Blend-weighted mix of `from` towards `to`.
 *
 * Pure and device-free: this is the function the runtime and the tests both use
 * to answer "what should the mixer look like at this crossfade position".
 */
export function describeSoundscapeMix(
  from: EraId,
  to: EraId,
  blend: number,
  options: { readonly musicDuck?: number } = {},
): SoundscapeMixState {
  const progress = clampBlend(blend);
  const weights = resolveEraWeights(from, to, progress);
  const musicDuck = clamp01(options.musicDuck ?? 0);
  const involved = from === to ? [from] : [from, to];

  const busGains = zeroBuses();
  for (const era of involved) {
    const weight = weights[era];
    if (weight <= 0) {
      continue;
    }
    const eraGains = busGainsFor(getEraConfig(era).sound);
    for (const bus of BUS_ORDER) {
      busGains[bus] = clampRange(busGains[bus] + eraGains[bus] * weight, 0, SOUNDSCAPE_LIMITS.maxBusGain);
    }
  }
  busGains.music = clampRange(busGains.music * (1 - musicDuck), 0, SOUNDSCAPE_LIMITS.maxBusGain);

  const layers: SoundscapeLayerState[] = [];
  for (const era of involved) {
    const weight = weights[era];
    if (weight <= 0) {
      continue;
    }
    for (const layer of describeEraSoundscape(era).layers) {
      layers.push({
        ...layer,
        weight,
        level: clampRange(layer.voiceGain * weight, 0, SFX_SAFE_RANGES.layerGain.max),
        busGain: busGains[layer.bus],
      });
    }
  }

  let materialLoad = 0;
  const perBus = zeroBuses();
  for (const layer of layers) {
    materialLoad += layer.level;
    perBus[layer.bus] += layer.level;
  }
  let masterInputGain = 0;
  for (const bus of BUS_ORDER) {
    masterInputGain += perBus[bus] * busGains[bus];
  }

  return {
    from,
    to,
    blend: progress,
    weights,
    busGains,
    layers,
    materialLoad: clampRange(materialLoad, 0, SOUNDSCAPE_LIMITS.maxMaterialLoad),
    masterInputGain: clampRange(masterInputGain, 0, SOUNDSCAPE_LIMITS.maxMasterInput),
    peakBusGain: BUS_ORDER.reduce((peak, bus) => Math.max(peak, busGains[bus]), 0),
    musicDuck,
  };
}

const BUS_ORDER = ["ambience", "traffic", "music", "effects"] as const satisfies readonly SfxBusId[];

function zeroBuses(): Record<SfxBusId, number> {
  return { ambience: 0, traffic: 0, music: 0, effects: 0 };
}

function busGainsFor(descriptor: SoundDescriptor): Record<SfxBusId, number> {
  const gains = zeroBuses();
  for (const bus of BUS_ORDER) {
    gains[bus] = eraBusGain(descriptor, bus);
  }
  return gains;
}

/* -------------------------------------------------------------------------- */
/* Runtime                                                                    */
/* -------------------------------------------------------------------------- */

/** Observable soundscape state; deterministic with or without Web Audio. */
export interface SoundscapeState {
  readonly era: EraId;
  readonly from: EraId;
  readonly blend: number;
  readonly mix: SoundscapeMixState;
  readonly available: boolean;
  readonly running: boolean;
  readonly started: boolean;
  readonly muted: boolean;
  readonly volume: number;
  readonly masterGain: number;
  readonly reverbSeconds: number;
  readonly activeEras: readonly EraId[];
  /** Continuous voices currently in the graph (0 without Web Audio). */
  readonly voiceCount: number;
  /** Era changes the driver requested, including the silent fallback path. */
  readonly transitions: number;
  /** Transition stingers requested. */
  readonly stingerRequests: number;
  /** Stingers actually scheduled on the audio clock. */
  readonly stingers: number;
  readonly musicNotes: number;
  readonly footsteps: number;
  readonly horns: number;
}

export interface SoundscapeOptions {
  readonly era?: EraId;
  readonly engine?: SfxEngine;
  /** Engine options used when `engine` is omitted. */
  readonly audio?: Omit<SfxEngineOptions, "context">;
  /** Explicit context; `null` forces the graceful no-Web-Audio path. */
  readonly context?: AudioContext | null;
  /** Factory for the audio context; tests inject a recorder here. */
  readonly factory?: () => AudioContext | null;
  readonly volume?: number;
  readonly muted?: boolean;
  readonly headroom?: number;
  readonly seed?: number;
  /** Fire the whoosh+chime stinger when `applyEra` observes a new era. */
  readonly stingerOnEraChange?: boolean;
}

/**
 * The era soundscape contract consumed by scene assembly.
 *
 * `applyEra` satisfies the shared {@link EraAware} interface, so the soundscape
 * can be driven by the same timeline code as the visual systems, while
 * `triggerTransition` is the explicit hook for the transition driver.
 */
export interface Soundscape extends EraAware {
  readonly engine: SfxEngine;
  /** Era the soundscape is settling towards. */
  readonly currentEra: EraId;
  readonly state: SoundscapeState;
  /** Resolves an era's descriptor into a fully voicable soundscape. */
  describe(era?: EraId): EraSoundscapeState;
  applyEra(era: EraId, blend?: number): void;
  /**
   * Crossfades `from` to `to`, layers the era-transition stinger over it, and
   * settles the deterministic mix on `to`.
   *
   * This is the event-driven entry point: call it the moment the timeline
   * changes and the soundscape performs the whole fade itself, over the
   * descriptor's `durationMs`. A driver that instead reports a per-frame blend
   * uses {@link applyEra} (which arms the same transition automatically) and its
   * blends take precedence.
   */
  triggerTransition(from: EraId, to: EraId): void;
  /** Convenience for the shared loop: applies the era and advances the clock. */
  applyFrame(context: EraUpdateContext): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  attachGestureStart(target: EventTarget): () => void;
  start(fromUserGesture?: boolean): boolean;
  /** Player footfall cue; routed to the effects bus of the live mix. */
  footstep(options?: FootstepOptions): void;
  /** Traffic horn or bell cue. */
  horn(options?: HornOptions): void;
  /** Advances the musical clock, punctuation layers and stinger duck. */
  update(delta: number): void;
  /** Releases every voice set and the engine graph. Safe to call twice. */
  dispose(): void;
}

interface LayerVoice {
  readonly id: string;
  readonly kind: SoundLayerKind;
  dispose(): void;
}

interface EraVoiceSet {
  readonly era: EraId;
  readonly descriptor: SoundDescriptor;
  readonly state: EraSoundscapeState;
  readonly busNodes: Record<SfxBusId, GainNode>;
  readonly voices: readonly LayerVoice[];
  /** Bus fader targets already applied, so per-frame syncs stay quiet. */
  readonly applied: Record<SfxBusId, number>;
  update(delta: number): number;
  setLevel(weight: number, musicDuck: number, fadeSeconds: number): void;
  dispose(): void;
}

/**
 * Creates the era soundscape facade.
 *
 * With Web Audio present the soundscape builds one voice set per active era and
 * crossfades between them; without it every call still updates the
 * deterministic mix state and returns, so callers never need a feature test.
 */
export function createSoundscape(options: SoundscapeOptions = {}): Soundscape {
  const seed = options.seed ?? 0x51ce;
  const engine =
    options.engine ??
    createSfxEngine({
      ...options.audio,
      context: options.context,
      factory: options.factory,
      volume: options.volume,
      muted: options.muted,
      headroom: options.headroom,
      seed,
    });

  const stingerOnEraChange = options.stingerOnEraChange ?? true;
  let targetEra: EraId = options.era ?? "1945";
  let fromEra: EraId = targetEra;
  let progress = 1;
  let transitions = 0;
  let stingerRequests = 0;
  let stingers = 0;
  let musicNotes = 0;
  let duck = 0;
  let footsteps = 0;
  let horns = 0;
  let disposed = false;

  const sets = new Map<EraId, EraVoiceSet>();

  engine.setReverb(getEraConfig(targetEra).sound.reverbSeconds);

  syncVoices(SOUNDSCAPE_LIMITS.followSeconds);

  function weights(): Readonly<Record<EraId, number>> {
    return resolveEraWeights(fromEra, targetEra, progress);
  }

  function ensureSet(era: EraId): EraVoiceSet | null {
    if (disposed) {
      return null;
    }
    const existing = sets.get(era);
    if (existing) {
      return existing;
    }
    const context = engine.context;
    if (!context) {
      return null;
    }
    const set = createVoiceSet(context, era, engine, seed);
    if (!set) {
      return null;
    }
    sets.set(era, set);
    return set;
  }

  /** (Re)builds the active voice sets and drops any era no longer on screen. */
  function syncVoices(fadeSeconds: number): void {
    const active = weights();
    const involved: EraId[] = fromEra === targetEra ? [targetEra] : [fromEra, targetEra];
    for (const era of involved) {
      ensureSet(era);
    }
    for (const [era, set] of sets) {
      if (!involved.includes(era)) {
        set.dispose();
        sets.delete(era);
      }
    }
    for (const era of involved) {
      const set = sets.get(era);
      if (set) {
        set.setLevel(active[era] ?? 0, currentDuck(), fadeSeconds);
      }
    }
  }

  function currentDuck(): number {
    return clamp01(duck) * SOUNDSCAPE_LIMITS.stingerDuck;
  }

  function crossfadeSeconds(era: EraId): number {
    const seconds = getEraConfig(era).transition.durationMs / 1000;
    return clampRange(
      seconds,
      SOUNDSCAPE_LIMITS.minCrossfadeSeconds,
      SOUNDSCAPE_LIMITS.maxCrossfadeSeconds,
    );
  }

  function beginTransition(from: EraId, to: EraId, options: { stinger: boolean; settle: boolean }): void {
    fromEra = from;
    targetEra = to;
    transitions += 1;
    engine.setReverb(getEraConfig(to).sound.reverbSeconds);

    if (options.stinger) {
      stingerRequests += 1;
      if (engine.isRunning()) {
        // Layered over the crossfade: the sweep announces the change and the
        // chime lands on top of it, while the music bus ducks underneath.
        engine.transitionStinger({ gain: 0.2, duration: 0.75 });
        stingers += 1;
        duck = 1;
      }
    }

    // A settled transition fades the outgoing set out over the descriptor's
    // duration; a blend-driven one follows the reported progress instead.
    progress = options.settle ? 1 : 0;
    syncVoices(options.settle ? crossfadeSeconds(to) : SOUNDSCAPE_LIMITS.followSeconds);
  }

  function snapshot(): SoundscapeState {
    const active: EraId[] = fromEra === targetEra ? [targetEra] : [fromEra, targetEra];
    const mix = describeSoundscapeMix(fromEra, targetEra, progress, { musicDuck: currentDuck() });
    const engineState = engine.state;
    let voiceCount = 0;
    for (const set of sets.values()) {
      voiceCount += set.voices.length;
    }

    return {
      era: targetEra,
      from: fromEra,
      blend: progress,
      mix,
      available: engineState.available,
      running: engineState.running,
      started: engineState.started,
      muted: engineState.muted,
      volume: engineState.volume,
      masterGain: engineState.masterGain,
      reverbSeconds: engineState.reverbSeconds,
      activeEras: active,
      voiceCount,
      transitions,
      stingerRequests,
      stingers,
      musicNotes,
      footsteps,
      horns,
    };
  }

  const soundscape: Soundscape = {
    engine,
    get currentEra() {
      return targetEra;
    },
    get state() {
      return snapshot();
    },
    describe(era?: EraId) {
      return describeEraSoundscape(era ?? targetEra);
    },
    applyEra(era: EraId, blend?: number) {
      if (era !== targetEra) {
        beginTransition(targetEra, era, { stinger: stingerOnEraChange, settle: false });
      }
      progress = clampBlend(blend ?? 1);
      syncVoices(SOUNDSCAPE_LIMITS.followSeconds);
    },
    triggerTransition(from: EraId, to: EraId) {
      beginTransition(from, to, { stinger: true, settle: true });
    },
    applyFrame(context: EraUpdateContext) {
      soundscape.applyEra(context.era, context.blend);
      soundscape.update(context.delta);
    },
    setMuted(muted: boolean) {
      engine.setMuted(muted);
    },
    setVolume(volume: number) {
      engine.setVolume(volume);
    },
    attachGestureStart(target: EventTarget) {
      return engine.attachGestureStart(target);
    },
    start(fromUserGesture = false) {
      const running = engine.start(fromUserGesture);
      if (running) {
        syncVoices(0.35);
      }
      return running;
    },
    footstep(footstepOptions = {}) {
      if (!engine.isRunning()) {
        return;
      }
      footsteps += 1;
      engine.footstep(footstepOptions);
    },
    horn(hornOptions = {}) {
      if (!engine.isRunning()) {
        return;
      }
      horns += 1;
      engine.horn(hornOptions);
    },
    update(delta: number) {
      if (!engine.isRunning()) {
        // Silent no-op: no device, no gesture yet, or muted.
        return;
      }
      const step = clampRange(delta, 0, 0.5);
      if (step <= 0) {
        return;
      }
      if (duck > 0) {
        duck = Math.max(0, duck - step / SOUNDSCAPE_LIMITS.stingerDuckSeconds);
        syncVoices(0.12);
      }
      for (const set of sets.values()) {
        musicNotes += set.update(step);
      }
    },
    dispose() {
      disposed = true;
      for (const set of sets.values()) {
        set.dispose();
      }
      sets.clear();
      engine.dispose();
    },
  };

  return soundscape;
}

/* -------------------------------------------------------------------------- */
/* Voice construction                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Builds one era's voice set: continuous beds for every ambience/traffic/voice
 * layer, one motif player for the music layers, and scheduled punctuation for
 * the mechanical and nature layers. Returns `null` when a node type the runtime
 * needs is missing, so the soundscape stays a no-op rather than crashing.
 */
function createVoiceSet(context: AudioContext, era: EraId, engine: SfxEngine, seed: number): EraVoiceSet | null {
  const state = describeEraSoundscape(era);
  const descriptor = getEraConfig(era).sound;
  const random = mulberry32((seed ^ hashString(descriptor.soundscape)) >>> 0);
  const noise = createNoiseBuffer(context, 2, mulberry32((seed ^ hashString(era)) >>> 0));
  // Voice budget: a future descriptor with a hundred layers can never blow up
  // the graph, and the motif player takes the reserved last slot.
  const budget = state.layers.slice(0, SOUNDSCAPE_LIMITS.maxVoicesPerEra - 1);

  try {
    const busNodes = {} as Record<SfxBusId, GainNode>;
    for (const bus of BUS_ORDER) {
      const node = context.createGain();
      node.gain.value = 0;
      const destination = engine.busInput(bus);
      if (destination) {
        node.connect(destination);
      }
      busNodes[bus] = node;
    }

    const voices: LayerVoice[] = [];
    for (const kind of BED_KINDS) {
      for (const layer of budget.filter((candidate) => candidate.kind === kind)) {
        const bed = createNoiseBed(context, noise, busNodes[layer.bus], layer, kind, state.profile);
        voices.push({ id: layer.id, kind, dispose: bed.dispose });
      }
    }

    const musicLayers = budget.filter((layer) => layer.kind === "music");
    let motifVoice: MotifVoice | null = null;
    if (musicLayers.length > 0) {
      // Stacked music layers (a lead plus a radio bleed) collapse into one motif
      // player whose level is their sum: it keeps the voice budget bounded and
      // the melodic line intact, which is what the era's audio identity is.
      const motifGain = clampRange(
        musicLayers.reduce((sum, layer) => sum + layer.level, 0) * 0.75,
        0,
        SFX_SAFE_RANGES.layerGain.max,
      );
      motifVoice = createMotifVoice(engine, busNodes.music, state, motifGain);
      voices.push({ id: `${state.soundscape}-motif`, kind: "music", dispose: () => {} });
    }

    const punctuation: PunctuationVoice[] = [];
    for (const layer of budget) {
      if (layer.kind !== "mechanical" && layer.kind !== "nature") {
        continue;
      }
      const voice = createPunctuationVoice(engine, busNodes[layer.bus], layer, state.profile, random);
      punctuation.push(voice);
      voices.push({ id: layer.id, kind: layer.kind, dispose: voice.dispose });
    }

    const applied = zeroBuses();

    return {
      era,
      descriptor,
      state,
      busNodes,
      voices,
      applied,
      update(delta: number) {
        let played = 0;
        if (motifVoice) {
          played += motifVoice.update(delta);
        }
        for (const voice of punctuation) {
          voice.update(delta);
        }
        return played;
      },
      setLevel(weight: number, musicDuck: number, fadeSeconds: number) {
        const fade = clampRange(fadeSeconds, 0.01, SOUNDSCAPE_LIMITS.maxCrossfadeSeconds);
        const now = context.currentTime;
        for (const bus of BUS_ORDER) {
          const duckFactor = bus === "music" ? 1 - musicDuck : 1;
          const target = clampRange(
            weight * eraBusGain(descriptor, bus) * duckFactor,
            0,
            SOUNDSCAPE_LIMITS.maxBusGain,
          );
          const node = busNodes[bus];
          if (Math.abs(applied[bus] - target) < 0.0005) {
            continue;
          }
          applied[bus] = target;
          const gain = node.gain;
          gain.cancelScheduledValues(now);
          gain.setValueAtTime(gain.value, now);
          gain.linearRampToValueAtTime(target, now + fade);
        }
      },
      dispose() {
        for (const voice of voices) {
          voice.dispose();
        }
        for (const bus of BUS_ORDER) {
          disconnectQuietly(busNodes[bus]);
        }
      },
    };
  } catch {
    return null;
  }
}

/** Layer kinds voiced as a continuous noise bed. */
const BED_KINDS = ["ambience", "traffic", "voice"] as const;

/** Continuous filtered-noise bed; the ambience, traffic and crowd layers. */
function createNoiseBed(
  context: AudioContext,
  noise: AudioBuffer,
  destination: AudioNode,
  layer: SoundscapeLayerState,
  kind: (typeof BED_KINDS)[number],
  profile: AcousticProfile,
): { readonly dispose: () => void } {
  const grain = clamp01(profile.grain);
  const shape = BED_SHAPE[kind];
  const frequency = clampRange(
    shape.pick(profile),
    SFX_SAFE_RANGES.frequency.min,
    SFX_SAFE_RANGES.frequency.max,
  );
  const gain = clampRange(layer.voiceGain, 0, SFX_SAFE_RANGES.layerGain.max);
  // The bed swells *downwards* from its nominal level, so the peak envelope is
  // exactly `voiceGain` and the deterministic mix total stays a true ceiling.
  const modulation = clamp01(shape.modulation * (0.4 + grain));

  const source = context.createBufferSource();
  source.buffer = noise;
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = shape.filter;
  filter.frequency.value = frequency;
  filter.Q.value = clampRange(0.6 + grain * 0.9, SFX_SAFE_RANGES.q.min, SFX_SAFE_RANGES.q.max);

  const envelope = context.createGain();
  envelope.gain.value = gain * (1 - modulation);

  const lfo = context.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = shape.lfoHz(layer.id);
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = gain * modulation;
  lfo.connect(lfoDepth);
  lfoDepth.connect(envelope.gain);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(destination);
  source.start();
  lfo.start();

  return {
    dispose: () => {
      stopQuietly(source);
      stopQuietly(lfo);
      disconnectQuietly(source);
      disconnectQuietly(filter);
      disconnectQuietly(envelope);
      disconnectQuietly(lfo);
      disconnectQuietly(lfoDepth);
    },
  };
}

/** Filter/modulation shape of each continuous bed kind. */
const BED_SHAPE: Readonly<
  Record<
    (typeof BED_KINDS)[number],
    {
      readonly filter: BiquadFilterType;
      readonly pick: (profile: AcousticProfile) => number;
      /** 0..1 fraction of the nominal gain the bed swells by. */
      readonly modulation: number;
      readonly lfoHz: (id: string) => number;
    }
  >
> = {
  ambience: {
    filter: "lowpass",
    pick: (profile) => profile.ambienceHz,
    modulation: 0.25,
    lfoHz: () => 0.07,
  },
  traffic: {
    filter: "bandpass",
    pick: (profile) => profile.trafficHz,
    modulation: 0.3,
    lfoHz: () => 0.13,
  },
  voice: {
    filter: "bandpass",
    pick: (profile) => profile.crowdHz,
    modulation: 0.4,
    // Crowd murmur swells a little faster on the busier stops.
    lfoHz: (id) => (id.includes("chatter") || id.includes("hawker") ? 0.37 : 0.29),
  },
};

interface MotifVoice {
  update(delta: number): number;
}

/**
 * Step sequencer for one era's motif.
 *
 * Notes are scheduled a step at a time onto the era's music fader, with the
 * descriptor's tempo, the motif's swing, waveform and detune deciding the
 * character: 1945 swings a triangle lead, 1985 runs sixteenth-note saw
 * arpeggios, 2025 holds sine pads for a bar.
 */
function createMotifVoice(
  engine: SfxEngine,
  destination: AudioNode,
  state: EraSoundscapeState,
  gain: number,
): MotifVoice {
  const motif = state.motif;
  const stepSeconds = 60 / state.musicTempo * motif.stepBeats;
  const leadGain = clampRange(gain, 0, SFX_SAFE_RANGES.layerGain.max);
  const bassGain = clampRange(gain * 0.55, 0, SFX_SAFE_RANGES.layerGain.max);
  let clock = 0;
  let step = 0;

  function stepDuration(index: number): number {
    const swing = clamp01(motif.swing);
    const factor = index % 2 === 1 ? 1 + swing * 0.5 : 1 - swing * 0.5;
    return Math.max(0.02, stepSeconds * factor);
  }

  return {
    update(delta: number): number {
      let played = 0;
      clock += delta;
      let guard = 0;
      while (clock >= stepDuration(step) && guard < 128) {
        clock -= stepDuration(step);
        guard += 1;

        // A motif that holds (2025's pads) only strikes once per hold window,
        // so the leading edge stays melodic instead of retriggering every step.
        if (step % motif.holdSteps === 0) {
          const noteIndex = Math.floor(step / motif.holdSteps);
          const degree = motif.melody[noteIndex % motif.melody.length] ?? -1;
          if (degree >= 0) {
            const note: ToneOptions = {
              frequency: motifFrequency(motif, degree),
              waveform: motif.waveform,
              duration: motif.noteSeconds * motif.holdSteps,
              gain: leadGain,
              detune: motif.detuneCents,
              attack: motif.holdSteps > 1 ? 0.35 : 0.012,
              destination,
            };
            engine.tone(note);
            played += 1;
          }
        }

        // Bass hits on the downbeat of every hold window, an octave down.
        if (step % (motif.holdSteps * 2) === 0) {
          const barIndex = Math.floor(step / (motif.holdSteps * 2));
          const bassDegree = motif.bass[barIndex % motif.bass.length] ?? -1;
          if (bassDegree >= 0) {
            engine.tone({
              frequency: motifFrequency(motif, bassDegree, -1),
              waveform: motif.bassWaveform,
              duration: motif.noteSeconds * 1.4,
              gain: bassGain,
              attack: 0.03,
              destination,
            });
          }
        }
        step += 1;
      }
      return played;
    },
  };
}

interface PunctuationVoice {
  update(delta: number): void;
  dispose(): void;
}

/**
 * Sparse one-shot layer: machinery clanks and whirrs, birds and pigeons.
 *
 * The timer is seeded per era so the punctuation is deterministic and the two
 * sides of a crossfade never fall into lockstep.
 */
function createPunctuationVoice(
  engine: SfxEngine,
  destination: AudioNode,
  layer: SoundscapeLayerState,
  profile: AcousticProfile,
  random: () => number,
): PunctuationVoice {
  const window = PUNCTUATION_WINDOW[layer.kind === "nature" ? "nature" : "mechanical"];
  let timer = window[0] + random() * (window[1] - window[0]);

  return {
    update(delta: number): void {
      timer -= delta;
      if (timer > 0) {
        return;
      }
      timer = window[0] + random() * (window[1] - window[0]);
      const gain = clampRange(layer.voiceGain * 0.7, 0, SFX_SAFE_RANGES.layerGain.max);
      if (layer.kind === "mechanical") {
        const burst: NoiseBurstOptions = {
          duration: 0.14 + random() * 0.12,
          gain: gain * 0.8,
          filter: "bandpass",
          frequency: profile.mechanicalHz * (0.85 + random() * 0.3),
          q: 3.2,
          attack: 0.005,
          destination,
        };
        engine.noiseBurst(burst);
      } else {
        engine.tone({
          frequency: profile.natureHz * (0.9 + random() * 0.25),
          waveform: "sine",
          duration: 0.1,
          gain: gain * 0.6,
          attack: 0.008,
          glideTo: profile.natureHz * (1.1 + random() * 0.3),
          destination,
        });
      }
    },
    dispose: () => {},
  };
}

/** Jittered repeat window, in seconds, of each punctuation layer kind. */
const PUNCTUATION_WINDOW: Readonly<Record<"mechanical" | "nature", readonly [number, number]>> = {
  mechanical: [0.75, 1.7],
  nature: [1.6, 3.4],
};

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/** Cheap string hash; only used to seed per-era noise and punctuation. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stopQuietly(node: { stop?: (when?: number) => void }): void {
  if (typeof node.stop !== "function") {
    return;
  }
  try {
    node.stop();
  } catch {
    // Already stopped.
  }
}

function disconnectQuietly(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Already disconnected at worst.
  }
}
