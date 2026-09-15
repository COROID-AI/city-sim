/**
 * Room acoustics: a procedurally generated café impulse response and the send /
 * return around it.
 *
 * The café is a small tiled interior, so the tail is short and bright but not
 * flat: a dense decaying diffuse field (filtered noise) plus a handful of early
 * reflections from the tiles, walls and counter. Generating it in code keeps the
 * repository free of audio files and lets the *era* influence the room through
 * the per-year mix descriptor (`sizeSeconds`, `decay`, `dryWet`).
 *
 * Signal flow of one reverb unit:
 *
 * ```
 *   bus send gains ─▶ send ─▶ convolver ─▶ wet ─┐
 *   dry sum ────────▶ dry ──────────────────────┴▶ output
 * ```
 *
 * Every generated impulse response is reproducible: the same seed always yields
 * byte identical samples, which is what lets the headless suite compare
 * schedules and graph state across runs.
 */

import {
  clamp,
  createAudioRandom,
  createAudioResourceBag,
  deriveSeed,
  scheduleRamp,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioNodeLike,
  type ConvolverNodeLike,
  type GainNodeLike,
} from './types';

/* -------------------------------------------------------------------------- */
/* Impulse response generation                                                */
/* -------------------------------------------------------------------------- */

export interface ImpulseResponseOptions {
  /** Total tail length in seconds (the room's size). */
  readonly sizeSeconds?: number;
  /** Decay exponent: higher values die away faster. */
  readonly decay?: number;
  /** One pole lowpass cutoff of the tail, modelling soft furnishings. */
  readonly dampingHz?: number;
  /** Silence before the first reflection, seconds. */
  readonly preDelaySeconds?: number;
  /** Number of discrete early reflections. */
  readonly earlyReflections?: number;
  readonly seed?: number;
  readonly channels?: number;
}

export interface ResolvedImpulseOptions {
  readonly sizeSeconds: number;
  readonly decay: number;
  readonly dampingHz: number;
  readonly preDelaySeconds: number;
  readonly earlyReflections: number;
  readonly seed: number;
  readonly channels: number;
}

const IMPULSE_DEFAULTS: ResolvedImpulseOptions = {
  sizeSeconds: 1.1,
  decay: 3.2,
  dampingHz: 6500,
  preDelaySeconds: 0.008,
  earlyReflections: 7,
  seed: 0x5eed1e,
  channels: 2,
};

/** Fills in defaults and clamps the impulse response options. */
export function resolveImpulseOptions(
  options: ImpulseResponseOptions = {},
): ResolvedImpulseOptions {
  return {
    sizeSeconds: clamp(options.sizeSeconds ?? IMPULSE_DEFAULTS.sizeSeconds, 0.05, 6),
    decay: clamp(options.decay ?? IMPULSE_DEFAULTS.decay, 0.4, 14),
    dampingHz: clamp(options.dampingHz ?? IMPULSE_DEFAULTS.dampingHz, 400, 20000),
    preDelaySeconds: clamp(
      options.preDelaySeconds ?? IMPULSE_DEFAULTS.preDelaySeconds,
      0,
      0.2,
    ),
    earlyReflections: Math.round(
      clamp(options.earlyReflections ?? IMPULSE_DEFAULTS.earlyReflections, 0, 32),
    ),
    seed: Math.trunc(options.seed ?? IMPULSE_DEFAULTS.seed),
    channels: Math.round(clamp(options.channels ?? IMPULSE_DEFAULTS.channels, 1, 4)),
  };
}

/**
 * Synthesises the café's impulse response into a fresh buffer.
 *
 * Deterministic: the noise field, the early reflection pattern and the damping
 * all derive from `seed`, so repeated runs produce identical tail samples.
 */
export function createImpulseResponse(
  context: AudioContextLike,
  options: ImpulseResponseOptions = {},
): AudioBufferLike {
  const resolved = resolveImpulseOptions(options);
  const sampleRate = context.sampleRate > 0 ? context.sampleRate : 48000;
  const length = Math.max(1, Math.round(resolved.sizeSeconds * sampleRate));
  const buffer = context.createBuffer(resolved.channels, length, sampleRate);
  const fadeInSamples = Math.min(
    Math.round(resolved.preDelaySeconds * sampleRate),
    length,
  );
  // One pole coefficient of the damping filter, derived from its cutoff.
  const damping = clamp(1 - Math.exp((-2 * Math.PI * resolved.dampingHz) / sampleRate), 0, 1);

  for (let channel = 0; channel < resolved.channels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    const random = createAudioRandom(deriveSeed(resolved.seed, channel + 1, 0x9e37));
    const polarity = channel % 2 === 0 ? 1 : -1;
    let filtered = 0;

    for (let index = 0; index < length; index += 1) {
      const white = random() * 2 - 1;
      filtered += (white - filtered) * damping;
      const progress = index / length;
      // Front loaded decay: loud right after the direct sound, dying away to zero.
      const envelope = Math.pow(1 - progress, resolved.decay);
      samples[index] = filtered * envelope;
    }

    // Discrete early reflections, spread per channel for stereo width.
    for (let tap = 0; tap < resolved.earlyReflections; tap += 1) {
      const tapSeconds =
        resolved.preDelaySeconds +
        (tap + 1) * 0.011 * (1 + (tap % 3) * 0.35) +
        channel * 0.0017;
      const index = Math.round(tapSeconds * sampleRate);
      if (index > 0 && index < length) {
        const amplitude = 0.6 / (tap + 1);
        samples[index] = (samples[index] ?? 0) + amplitude * polarity;
      }
    }

    for (let index = 0; index < fadeInSamples; index += 1) {
      const gain = index / Math.max(fadeInSamples, 1);
      samples[index] = (samples[index] ?? 0) * gain;
    }
  }

  return buffer;
}

/* -------------------------------------------------------------------------- */
/* Reverb unit                                                                */
/* -------------------------------------------------------------------------- */

export interface RoomReverbOptions extends ImpulseResponseOptions {
  /** Dry/wet balance, `0` = fully dry, `1` = fully wet. */
  readonly dryWet?: number;
}

export interface RoomReverb {
  /** Send input; every bus connects its send gain here. */
  readonly send: GainNodeLike;
  readonly convolver: ConvolverNodeLike;
  /** Return level of the wet path. */
  readonly wet: GainNodeLike;
  /** Input of the dry path (the summed buses). */
  readonly dry: GainNodeLike;
  /** Mixed output, feeding the limiter. */
  readonly output: GainNodeLike;
  /** Current impulse response (regenerated by {@link RoomReverb.setImpulseResponse}). */
  readonly buffer: AudioBufferLike;
  readonly options: ResolvedImpulseOptions;
  /** Dry/wet balance currently scheduled. */
  readonly dryWet: number;
  setDryWet(amount: number, seconds: number, now: number): number;
  /** Replaces the impulse response; returns the new tail length in seconds. */
  setImpulseResponse(options: ImpulseResponseOptions): number;
  dispose(): void;
}

/**
 * Builds the shared convolution send used by music, murmur and machine SFX.
 * The unit owns its nodes and releases its buffer on {@link RoomReverb.dispose}.
 */
export function createRoomReverb(
  context: AudioContextLike,
  options: RoomReverbOptions = {},
): RoomReverb {
  const resources = createAudioResourceBag();
  const optionsState = resolveImpulseOptions(options);

  const send = resources.node(context.createGain());
  const convolver = resources.node(context.createConvolver());
  const wet = resources.node(context.createGain());
  const dry = resources.node(context.createGain());
  const output = resources.node(context.createGain());

  send.gain.value = 1;
  dry.gain.value = 1;
  wet.gain.value = 0;
  output.gain.value = 1;
  convolver.normalize = true;

  let buffer = createImpulseResponse(context, options);
  convolver.buffer = buffer;
  send.connect(convolver);
  convolver.connect(wet);
  wet.connect(output);
  dry.connect(output);

  let dryWet = clamp(options.dryWet ?? 0.25, 0, 1);
  dry.gain.value = 1 - dryWet;
  wet.gain.value = dryWet;

  return {
    send,
    convolver,
    wet,
    dry,
    output,
    get buffer() {
      return buffer;
    },
    get options() {
      return optionsState;
    },
    get dryWet() {
      return dryWet;
    },
    setDryWet(amount, seconds, now) {
      const target = clamp(amount, 0, 1);
      const start = dryWet;
      dryWet = target;
      scheduleRamp(dry.gain, 1 - start, 1 - target, seconds, now);
      return scheduleRamp(wet.gain, start, target, seconds, now);
    },
    setImpulseResponse(next) {
      const merged: ImpulseResponseOptions = {
        ...optionsState,
        ...next,
      };
      Object.assign(optionsState, resolveImpulseOptions(merged));
      buffer = createImpulseResponse(context, optionsState);
      convolver.buffer = buffer;
      return optionsState.sizeSeconds;
    },
    dispose() {
      convolver.buffer = null;
      resources.disconnectAll();
    },
  };
}

/** Disconnects a node if the audio context is still alive. */
export function safeDisconnect(node: AudioNodeLike): void {
  try {
    node.disconnect();
  } catch {
    // The context was closed first; there is nothing left to disconnect.
  }
}
