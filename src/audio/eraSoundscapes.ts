/**
 * Chrono City — per-era soundscapes and synthesized music beds.
 *
 * This module is the *content* half of the era audio system: one music bed and
 * one ambience bed per era, synthesized live from Web Audio primitives (no audio
 * files, no fetches, no decode step). `soundscapeApi.ts` is the *control* half:
 * it crossfades these beds along the `TimelineRuntime` tween.
 *
 * The five beds follow the approved era soundscape descriptors:
 *
 *   1945  big-band crooners on an AM radio + streetcar clangs
 *   1965  rockabilly twang + V8 muscle engines
 *   1985  synth-pop pads + arcade cabinet bleeps
 *   2005  hip-hop sub bass + polyphonic cell chatter
 *   2025  ambient electronica + drone hums
 *
 * Lifecycle:
 *   create    → `createEraSoundscapeCues()` builds the ten looping
 *               `CueDefinition`s (five `music-bed`s and five `ambience-bed`s)
 *               that `AudioDirector.registerCues()` accepts.
 *   consume   → a registered `CueDefinition.render()` is called once per voice
 *               and only has to describe *what it sounds like*.
 *   integrate → `SoundscapeApi` plays the beds on the `music` and `ambience`
 *               buses and crossfades them; the era-transition integration task
 *               wires `SoundscapeApi` into the app shell.
 *
 * Every bed is a *loop*: tonal layers are continuous oscillators, while the
 * rhythmic/percussive content is generated into a short, seamlessly wrapping
 * `AudioBuffer` (see `createTextureLoop`). Buffers are deterministic for a given
 * era and cached per audio context, so scrubbing the timeline back and forth
 * never re-synthesizes the same bed twice.
 */

import { ERA_IDS, clamp01, type EraId } from '../core/eraContracts';
import { createSeededRng } from '../core/sceneContext';
import { getEraDescriptor } from '../era/eraDescriptors';
import { eraCueName } from './audioDirector';
import {
  clamp,
  connectSeries,
  startVoice,
  type CueBusName,
  type CueDefinition,
  type CueSynthContext,
  type SynthVoice,
} from './sfxSynth';

export const ERA_SOUNDSCAPES_VERSION = 1;

/* ------------------------------------------------------------------------- *
 * Layer vocabulary
 * ------------------------------------------------------------------------- */

/** The two layers every era contributes: a music bed and an ambience bed. */
export type SoundscapeLayerKind = 'music' | 'ambience';

/** The layer kinds, in mix order. */
export const SOUNDSCAPE_LAYER_KINDS: readonly SoundscapeLayerKind[] = ['music', 'ambience'];

/** Era-neutral cue names; the registered cues are era-scoped (`era:1985:...`). */
export const MUSIC_BED_CUE = 'music-bed';
export const AMBIENCE_BED_CUE = 'ambience-bed';

/** Which mixer bus each layer plays through. */
export const LAYER_BUSES: Readonly<Record<SoundscapeLayerKind, CueBusName>> = Object.freeze({
  music: 'music',
  ambience: 'ambience',
});

/** Music beds sit just under the SFX; ambience sits further back again. */
export const MUSIC_LAYER_TRIM = 0.78;
export const AMBIENCE_LAYER_TRIM = 0.62;

/** The bus a layer kind is routed through. */
export function soundscapeLayerBus(kind: SoundscapeLayerKind): CueBusName {
  return LAYER_BUSES[kind] ?? 'ambience';
}

/** Era-scoped cue name of one layer, e.g. `era:2005:music-bed`. */
export function soundscapeCueName(era: EraId, kind: SoundscapeLayerKind): string {
  return eraCueName(era, kind === 'music' ? MUSIC_BED_CUE : AMBIENCE_BED_CUE);
}

/** `true` for the two layer kinds. */
export function isSoundscapeLayerKind(value: unknown): value is SoundscapeLayerKind {
  return value === 'music' || value === 'ambience';
}

/* ------------------------------------------------------------------------- *
 * Profiles (descriptor + synthesis identity)
 * ------------------------------------------------------------------------- */

/**
 * Everything a system needs to know about one era's soundscape: the descriptor
 * data it inherits from the era table (id, mood, bed description, ambience
 * ingredients, loudness) plus the concrete cue names and layer gains the
 * `SoundscapeApi` mixes with.
 */
export interface EraSoundscapeProfile {
  readonly era: EraId;
  /** Stable descriptor id (`soundscape-1945-postwar`), shared with the era table. */
  readonly id: string;
  readonly label: string;
  /** Descriptor mood line. */
  readonly mood: string;
  /** Descriptor music-bed line, e.g. `mono AM radio crooners and brass`. */
  readonly musicBed: string;
  /** Descriptor ambience ingredients (streetcar, hand bell, ...). */
  readonly ambience: readonly string[];
  /** Relative mix level in `[0, 1]`, straight from the era descriptor. */
  readonly loudness: number;
  /** Bed tempo in BPM (the loop length follows from it). */
  readonly tempo: number;
  /** Era-scoped cue names the beds are registered under. */
  readonly musicCue: string;
  readonly ambienceCue: string;
  /** Full-strength layer gains: descriptor loudness scaled by the layer trim. */
  readonly musicGain: number;
  readonly ambienceGain: number;
  /** What the synthesized music bed actually contains. */
  readonly musicNotes: string;
  /** What the synthesized ambience actually contains. */
  readonly ambienceNotes: string;
}

/* ------------------------------------------------------------------------- *
 * Synth primitives shared by every bed
 * ------------------------------------------------------------------------- */

const TWO_PI = Math.PI * 2;
const MIN_LOOP_SECONDS = 0.5;
const MAX_LOOP_SECONDS = 4;
const MIN_LOOP_SAMPLE_RATE = 8000;
const MAX_LOOP_SAMPLE_RATE = 48000;
/** Head-room kept by the loop normaliser: a dense bed must never clip the bus. */
const LOOP_PEAK = 0.92;
/** Hit attack in seconds: long enough to avoid a click, short enough to cut. */
const HIT_ATTACK_SECONDS = 0.004;
/** Hits below this envelope level stop being rendered. */
const HIT_FLOOR = 0.0005;
const MIN_FREQUENCY = 20;

/** One sine partial of the continuous drone layer inside a texture loop. */
export interface LoopHum {
  readonly frequency: number;
  readonly level: number;
}

/**
 * One baked hit inside a texture loop. Hits are summed from sine partials and a
 * noise mix under an exponential decay, which covers everything from a streetcar
 * clang (inharmonic partials, long ring) to a hi-hat (pure noise, fast decay).
 */
export interface LoopEvent {
  /** Offset into the loop, in seconds. Hits wrap around the loop end. */
  readonly at: number;
  /** Ring-out length in seconds. */
  readonly length: number;
  /** Fundamental frequency in Hz. */
  readonly frequency: number;
  /** Harmonic multipliers mixed into the hit. Defaults to `[1]`. */
  readonly partials?: readonly number[];
  /** Exponential decay rate in 1/s. Defaults to `6`. */
  readonly decay?: number;
  /** Noise blend: `0` is a pure tone, `1` is pure noise. Defaults to `0.35`. */
  readonly noise?: number;
  /** Peak level of the hit. Defaults to `0.6`. */
  readonly level?: number;
  /** Linear pitch glide over the hit, in Hz. Defaults to `0`. */
  readonly sweep?: number;
}

export interface TextureLoopOptions {
  /** Cache key: the same key on the same context reuses one buffer. */
  readonly key: string;
  /** Loop length in seconds (clamped to a sane 0.5–4 s window). */
  readonly seconds: number;
  /** Deterministic seed for the noise content. */
  readonly seed: number;
  /** Buffer sample rate; lo-fi textures need less. Defaults to the context rate. */
  readonly sampleRate?: number;
  /** Continuous white-noise bed level. Defaults to `0`. */
  readonly noise?: number;
  /** Continuous sine drone partials under the texture. */
  readonly hum?: readonly LoopHum[];
  /** Percussive/melodic hits placed around the loop. */
  readonly events?: readonly LoopEvent[];
}

const loopCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/**
 * Renders a deterministic, seamlessly looping texture buffer from Web Audio
 * primitives — a sine drone, a noise bed and a list of decaying hits.
 *
 * Two details make the loop click-free and cheap:
 *   * drone frequencies are snapped to whole cycles per loop, so the waveform is
 *     sample-continuous across the wraparound;
 *   * hits are written modulo the loop length, so a clang that starts near the
 *     end rings out into the beginning of the next pass.
 *
 * The result is normalised to `LOOP_PEAK`, cached per context (so timeline
 * scrubbing never re-synthesizes a bed) and fully deterministic for a given
 * `seed`.
 */
export function createTextureLoop(
  context: BaseAudioContext,
  options: TextureLoopOptions,
): AudioBuffer {
  const sampleRate = clamp(
    Math.round(options.sampleRate ?? context.sampleRate ?? 44100),
    MIN_LOOP_SAMPLE_RATE,
    MAX_LOOP_SAMPLE_RATE,
  );
  const seconds = clamp(options.seconds, MIN_LOOP_SECONDS, MAX_LOOP_SECONDS);
  const key = `${options.key}|${seconds.toFixed(3)}|${sampleRate}|${Math.trunc(options.seed)}`;

  let cache = loopCache.get(context);
  if (!cache) {
    cache = new Map<string, AudioBuffer>();
    loopCache.set(context, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;

  const length = Math.max(1, Math.round(seconds * sampleRate));
  const data = new Float32Array(length);
  const rng = createSeededRng(options.seed === 0 ? 1 : Math.trunc(options.seed));

  for (const tone of options.hum ?? []) {
    const level = Math.max(0, tone.level);
    if (level <= 0) continue;
    const cycles = Math.max(1, Math.round(Math.max(MIN_FREQUENCY, tone.frequency) * seconds));
    const frequency = cycles / seconds;
    for (let index = 0; index < length; index += 1) {
      data[index] = (data[index] as number) + level * Math.sin((TWO_PI * frequency * index) / sampleRate);
    }
  }

  const noiseLevel = Math.max(0, options.noise ?? 0);
  if (noiseLevel > 0) {
    for (let index = 0; index < length; index += 1) {
      data[index] = (data[index] as number) + noiseLevel * rng.float(-1, 1);
    }
  }

  (options.events ?? []).forEach((event, eventIndex) => {
    const decay = Math.max(0.01, event.decay ?? 6);
    const noiseMix = clamp01(event.noise ?? 0.35);
    const level = Math.max(0, event.level ?? 0.6);
    const partials = event.partials && event.partials.length > 0 ? event.partials : [1];
    const sweep = event.sweep ?? 0;
    const attackSamples = Math.max(1, Math.round(HIT_ATTACK_SECONDS * sampleRate));
    const startSample = Math.round(Math.max(0, event.at) * sampleRate);
    const hitSamples = Math.max(1, Math.round(event.length * sampleRate));
    const hitRng = rng.fork(`hit-${eventIndex}`);

    for (let offset = 0; offset < hitSamples; offset += 1) {
      const elapsed = offset / sampleRate;
      const envelope = Math.min(1, offset / attackSamples) * Math.exp(-decay * elapsed);
      if (envelope < HIT_FLOOR) continue;
      const frequency = Math.max(MIN_FREQUENCY, event.frequency + sweep * elapsed);
      let tone = 0;
      for (const partial of partials) {
        tone += Math.sin(TWO_PI * frequency * partial * elapsed) / partial;
      }
      tone /= partials.length;
      const sample = level * envelope * ((1 - noiseMix) * tone + noiseMix * hitRng.float(-1, 1));
      const index = (startSample + offset) % length;
      data[index] = (data[index] as number) + sample;
    }
  });

  // Deterministic peak normalisation: dense ambience beds stay inside the bus.
  let peak = 0;
  for (let index = 0; index < length; index += 1) {
    const magnitude = Math.abs(data[index] as number);
    if (magnitude > peak) peak = magnitude;
  }
  if (peak > LOOP_PEAK) {
    const scale = LOOP_PEAK / peak;
    for (let index = 0; index < length; index += 1) data[index] = (data[index] as number) * scale;
  }

  const buffer = context.createBuffer(1, length, sampleRate);
  buffer.getChannelData(0).set(data);
  cache.set(key, buffer);
  return buffer;
}

/** One oscillator layer of a tonal bed. */
interface ToneLayer {
  readonly wave: OscillatorType;
  readonly frequency: number;
  readonly gain: number;
  readonly detune?: number;
}

interface TonalVoiceOptions {
  /** Low-pass corner of the tonal body, in Hz. */
  readonly lowpass?: number;
  /** High-pass corner, in Hz. */
  readonly highpass?: number;
  /** Resonance of the low-pass. Defaults to `0.9`. */
  readonly q?: number;
  /** Shared pitch wobble (brass, tape, synth drift). */
  readonly vibrato?: { readonly frequency: number; readonly depth: number };
  /** Slow amplitude swell — the "breathing" that keeps a loop alive. */
  readonly motion?: { readonly frequency: number; readonly depth: number };
}

/**
 * Builds a continuous tonal bed: every layer is an oscillator with its own gain
 * level, mixed through an optional filter pair into `output`.
 */
function createTonalVoice(
  context: BaseAudioContext,
  output: AudioNode,
  time: number,
  gain: number,
  layers: readonly ToneLayer[],
  options: TonalVoiceOptions = {},
): SynthVoice {
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];

  const filters: AudioNode[] = [];
  if (options.highpass !== undefined) {
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = options.highpass;
    highpass.Q.value = 0.7;
    filters.push(highpass);
    nodes.push(highpass);
  }
  if (options.lowpass !== undefined) {
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = options.lowpass;
    lowpass.Q.value = options.q ?? 0.9;
    filters.push(lowpass);
    nodes.push(lowpass);
  }

  const body = context.createGain();
  body.gain.value = 1;
  nodes.push(body);

  const mix: AudioNode = filters[0] ?? body;
  const oscillators: OscillatorNode[] = [];
  for (const layer of layers) {
    const oscillator = context.createOscillator();
    oscillator.type = layer.wave;
    oscillator.frequency.value = Math.max(MIN_FREQUENCY, layer.frequency);
    if (layer.detune !== undefined) oscillator.detune.value = layer.detune;
    const level = context.createGain();
    level.gain.value = Math.max(0, layer.gain) * gain;
    connectSeries([oscillator, level, mix]);
    oscillators.push(oscillator);
    nodes.push(oscillator, level);
    sources.push(oscillator);
  }

  connectSeries([...filters, body, output]);

  if (options.vibrato && oscillators.length > 0) {
    const lfo = context.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = Math.max(0.01, options.vibrato.frequency);
    const depth = context.createGain();
    depth.gain.value = options.vibrato.depth;
    connectSeries([lfo, depth]);
    for (const oscillator of oscillators) connectSeries([depth, oscillator.detune]);
    nodes.push(lfo, depth);
    sources.push(lfo);
  }

  if (options.motion) {
    const motion = context.createOscillator();
    motion.type = 'sine';
    motion.frequency.value = Math.max(0.01, options.motion.frequency);
    const depth = context.createGain();
    depth.gain.value = options.motion.depth * gain;
    connectSeries([motion, depth, body.gain]);
    nodes.push(motion, depth);
    sources.push(motion);
  }

  return startVoice({ nodes, sources, start: time });
}

export interface TextureVoiceOptions extends TextureLoopOptions {
  /** Low-pass applied to the whole texture (the "distance" of the bed). */
  readonly lowpass?: number;
  /** High-pass applied to the whole texture. */
  readonly highpass?: number;
  /** Resonance of the texture low-pass. Defaults to `0.8`. */
  readonly q?: number;
  /** Loop trim before the bed's own gains. Defaults to `1`. */
  readonly trim?: number;
  /** Slow amplitude swell. */
  readonly motion?: { readonly frequency: number; readonly depth: number };
}

/** Plays one looping texture buffer through an optional filter pair. */
function createTextureVoice(
  context: BaseAudioContext,
  output: AudioNode,
  time: number,
  gain: number,
  options: TextureVoiceOptions,
): SynthVoice {
  const source = context.createBufferSource();
  source.buffer = createTextureLoop(context, options);
  source.loop = true;

  const nodes: AudioNode[] = [source];
  const filters: AudioNode[] = [];
  if (options.highpass !== undefined) {
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = options.highpass;
    highpass.Q.value = 0.7;
    filters.push(highpass);
    nodes.push(highpass);
  }
  if (options.lowpass !== undefined) {
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = options.lowpass;
    lowpass.Q.value = options.q ?? 0.8;
    filters.push(lowpass);
    nodes.push(lowpass);
  }

  const body = context.createGain();
  body.gain.value = clamp(options.trim ?? 1, 0, 4) * gain;
  nodes.push(body);

  connectSeries([source, ...filters, body, output]);

  const sources: AudioScheduledSourceNode[] = [source];
  if (options.motion) {
    const motion = context.createOscillator();
    motion.type = 'sine';
    motion.frequency.value = Math.max(0.01, options.motion.frequency);
    const depth = context.createGain();
    depth.gain.value = options.motion.depth * gain;
    connectSeries([motion, depth, body.gain]);
    nodes.push(motion, depth);
    sources.push(motion);
  }

  return startVoice({ nodes, sources, start: time });
}

/** Merges the voices of one bed into a single stop-able voice. */
function combineVoices(...voices: readonly SynthVoice[]): SynthVoice {
  return {
    nodes: voices.flatMap((voice) => voice.nodes),
    endSignal: null,
    loop: true,
    stop(when?: number): void {
      for (const voice of voices) voice.stop(when);
    },
  };
}

/** Synthesizes one looping bed voice for an era. */
export type SoundscapeRenderer = (synth: CueSynthContext) => SynthVoice;

/* ------------------------------------------------------------------------- *
 * 1945 — big-band radio and streetcar clangs
 * ------------------------------------------------------------------------- */

/** Brass-and-crooner band on a narrow AM radio band, over shellac crackle. */
function render1945Music({ context, output, time, gain }: CueSynthContext): SynthVoice {
  const band = createTonalVoice(
    context,
    output,
    time,
    gain,
    [
      { wave: 'triangle', frequency: 196, gain: 0.2 },
      { wave: 'triangle', frequency: 246.9, gain: 0.14 },
      { wave: 'triangle', frequency: 293.7, gain: 0.11 },
      { wave: 'sine', frequency: 98, gain: 0.18 },
    ],
    {
      lowpass: 2400,
      q: 0.9,
      vibrato: { frequency: 5.2, depth: 6 },
      motion: { frequency: 0.09, depth: 0.16 },
    },
  );

  const radio = createTextureVoice(context, output, time, gain, {
    key: 'era-1945-music',
    seed: 1945,
    seconds: 2.4,
    sampleRate: 22050,
    noise: 0.03,
    lowpass: 3600,
    highpass: 180,
    trim: 0.9,
    events: [
      { at: 0.05, length: 1.1, frequency: 196, partials: [1, 2, 3], decay: 2.4, noise: 0.18, level: 0.26 },
      { at: 1.25, length: 1, frequency: 220, partials: [1, 2, 3], decay: 2.6, noise: 0.16, level: 0.22 },
      { at: 0.62, length: 0.22, frequency: 900, decay: 14, noise: 0.95, level: 0.1 },
      { at: 1.82, length: 0.22, frequency: 900, decay: 14, noise: 0.95, level: 0.08 },
    ],
  });

  return combineVoices(band, radio);
}

/** Streetcar clangs answered by a distant steam whistle and a hand bell. */
function render1945Ambience({ context, output, time, gain }: CueSynthContext): SynthVoice {
  return createTextureVoice(context, output, time, gain, {
    key: 'era-1945-ambience',
    seed: 19450,
    seconds: 3,
    sampleRate: 22050,
    noise: 0.045,
    hum: [
      { frequency: 52, level: 0.03 },
      { frequency: 104, level: 0.012 },
    ],
    lowpass: 4200,
    trim: 0.9,
    motion: { frequency: 0.11, depth: 0.22 },
    events: [
      { at: 0.35, length: 1, frequency: 617, partials: [1, 2.76, 5.4], decay: 4.2, noise: 0.22, level: 0.5 },
      { at: 1.72, length: 0.9, frequency: 549, partials: [1, 2.76, 5.4], decay: 4.6, noise: 0.2, level: 0.42 },
      { at: 1.05, length: 1.3, frequency: 880, partials: [1, 1.5, 2], decay: 1.1, noise: 0.3, level: 0.14 },
      { at: 2.35, length: 0.7, frequency: 1180, partials: [1, 2.4, 3.1], decay: 3.4, noise: 0.12, level: 0.2 },
    ],
  });
}

/* ------------------------------------------------------------------------- *
 * 1965 — rockabilly twang and muscle engines
 * ------------------------------------------------------------------------- */

/** Twanging lead and walking square bass over a slapping, echoing groove. */
function render1965Music({ context, output, time, gain }: CueSynthContext): SynthVoice {
  const band = createTonalVoice(
    context,
    output,
    time,
    gain,
    [
      { wave: 'sawtooth', frequency: 164.8, gain: 0.16 },
      { wave: 'sawtooth', frequency: 246.9, gain: 0.1, detune: -7 },
      { wave: 'square', frequency: 110, gain: 0.13 },
    ],
    {
      lowpass: 2600,
      q: 1.1,
      vibrato: { frequency: 6.1, depth: 4 },
      motion: { frequency: 0.12, depth: 0.14 },
    },
  );

  const guitar = [
    { frequency: 246.9, decay: 5.5, level: 0.26 },
    { frequency: 329.6, decay: 5.2, level: 0.2 },
    { frequency: 196, decay: 5.8, level: 0.22 },
    { frequency: 293.7, decay: 5.4, level: 0.18 },
  ];
  const groove = createTextureVoice(context, output, time, gain, {
    key: 'era-1965-music',
    seed: 1965,
    seconds: 1.82,
    sampleRate: 22050,
    noise: 0.02,
    lowpass: 4200,
    trim: 0.95,
    events: [
      { at: 0, length: 0.4, frequency: 62, partials: [1, 1.6], decay: 9, noise: 0.08, level: 0.42 },
      { at: 0.91, length: 0.4, frequency: 62, partials: [1, 1.6], decay: 9, noise: 0.08, level: 0.38 },
      ...guitar.flatMap((note, index) => {
        const at = index * 0.455;
        return [
          {
            at,
            length: 0.5,
            frequency: note.frequency,
            partials: [1, 2, 3, 4],
            decay: note.decay,
            noise: 0.24,
            level: note.level,
          },
          {
            // Tape slapback: the repeating echo that defines the era's guitar.
            at: at + 0.145,
            length: 0.42,
            frequency: note.frequency,
            partials: [1, 2, 3],
            decay: note.decay + 3,
            noise: 0.3,
            level: note.level * 0.42,
          },
        ];
      }),
      { at: 0.455, length: 0.2, frequency: 1500, decay: 16, noise: 0.9, level: 0.18 },
      { at: 1.365, length: 0.2, frequency: 1500, decay: 16, noise: 0.9, level: 0.16 },
    ],
  });

  return combineVoices(band, groove);
}

/** A V8 idling under bus bells, riveter bursts and a tyre squeal. */
function render1965Ambience({ context, output, time, gain }: CueSynthContext): SynthVoice {
  const engine = createTonalVoice(
    context,
    output,
    time,
    gain,
    [
      { wave: 'sawtooth', frequency: 55, gain: 0.22 },
      { wave: 'sawtooth', frequency: 110.5, gain: 0.1, detune: 6 },
      { wave: 'square', frequency: 27.5, gain: 0.1 },
    ],
    {
      lowpass: 480,
      q: 2.2,
      vibrato: { frequency: 7.4, depth: 12 },
      motion: { frequency: 3.1, depth: 0.3 },
    },
  );

  const street = createTextureVoice(context, output, time, gain, {
    key: 'era-1965-ambience',
    seed: 19650,
    seconds: 2.8,
    sampleRate: 22050,
    noise: 0.05,
    lowpass: 3600,
    trim: 0.85,
    events: [
      { at: 0.6, length: 0.5, frequency: 1046, partials: [1, 2.7], decay: 6, noise: 0.15, level: 0.28 },
      { at: 2, length: 0.5, frequency: 1046, partials: [1, 2.7], decay: 6, noise: 0.15, level: 0.24 },
      ...[0.3, 0.42, 0.54, 1.6, 1.72, 1.84].map((at) => ({
        at,
        length: 0.09,
        frequency: 2400,
        decay: 30,
        noise: 0.92,
        level: 0.18,
      })),
      { at: 1.25, length: 0.6, frequency: 1400, sweep: 500, decay: 2, noise: 0.4, level: 0.12 },
    ],
  });

  return combineVoices(engine, street);
}

/* ------------------------------------------------------------------------- *
 * 1985 — synth-pop and arcade bleeps
 * ------------------------------------------------------------------------- */

/** Detuned synth-pop pads over a drum-machine groove. */
function render1985Music({ context, output, time, gain }: CueSynthContext): SynthVoice {
  const pads = createTonalVoice(
    context,
    output,
    time,
    gain,
    [
      { wave: 'sawtooth', frequency: 261.6, gain: 0.14, detune: -9 },
      { wave: 'sawtooth', frequency: 392, gain: 0.12, detune: 10 },
      { wave: 'sine', frequency: 130.8, gain: 0.12 },
    ],
    {
      lowpass: 3200,
      q: 3.4,
      vibrato: { frequency: 0.33, depth: 9 },
      motion: { frequency: 0.21, depth: 0.2 },
    },
  );

  const machine = createTextureVoice(context, output, time, gain, {
    key: 'era-1985-music',
    seed: 1985,
    seconds: 2.03,
    sampleRate: 22050,
    noise: 0.015,
    lowpass: 5200,
    trim: 1,
    events: [
      ...[0, 0.508, 1.015, 1.523].map((at) => ({
        at,
        length: 0.4,
        frequency: 55,
        decay: 11,
        noise: 0.05,
        level: 0.5,
      })),
      ...[0.508, 1.523].map((at) => ({
        at,
        length: 0.2,
        frequency: 1400,
        decay: 15,
        noise: 0.85,
        level: 0.2,
      })),
      ...[0.254, 0.635, 0.762, 1.27, 1.65, 1.78].map((at) => ({
        at,
        length: 0.06,
        frequency: 7200,
        decay: 45,
        noise: 1,
        level: 0.1,
      })),
    ],
  });

  return combineVoices(pads, machine);
}

/** Cabinet bleeps, a distant siren and wet-night brake squeal. */
function render1985Ambience({ context, output, time, gain }: CueSynthContext): SynthVoice {
  return createTextureVoice(context, output, time, gain, {
    key: 'era-1985-ambience',
    seed: 19850,
    seconds: 2.6,
    sampleRate: 22050,
    noise: 0.03,
    hum: [
      { frequency: 120, level: 0.035 },
      { frequency: 240, level: 0.018 },
    ],
    lowpass: 5200,
    trim: 0.9,
    motion: { frequency: 0.17, depth: 0.2 },
    events: [
      ...[0.18, 0.3, 0.42, 1.2, 1.32, 1.44].map((at) => ({
        at,
        length: 0.13,
        frequency: 1244.5,
        partials: [1, 3, 5],
        decay: 9,
        noise: 0.05,
        level: 0.22,
      })),
      { at: 0.7, length: 1.5, frequency: 720, partials: [1, 2], sweep: 140, decay: 1.4, noise: 0.25, level: 0.09 },
      { at: 2.05, length: 0.5, frequency: 1800, sweep: -400, decay: 3, noise: 0.5, level: 0.12 },
    ],
  });
}

/* ------------------------------------------------------------------------- *
 * 2005 — hip-hop and cell chatter
 * ------------------------------------------------------------------------- */

/** Sub-bass hip-hop beat: 808 hits, hi-hats and a filtered vocal chop. */
function render2005Music({ context, output, time, gain }: CueSynthContext): SynthVoice {
  const sub = createTonalVoice(
    context,
    output,
    time,
    gain,
    [
      { wave: 'sine', frequency: 87.3, gain: 0.18 },
      { wave: 'triangle', frequency: 174.6, gain: 0.1 },
      { wave: 'square', frequency: 349.2, gain: 0.05 },
    ],
    { lowpass: 1500, q: 1.4, motion: { frequency: 0.15, depth: 0.12 } },
  );

  const beat = createTextureVoice(context, output, time, gain, {
    key: 'era-2005-music',
    seed: 2005,
    seconds: 2.6,
    sampleRate: 22050,
    noise: 0.012,
    lowpass: 4600,
    trim: 1,
    events: [
      ...[0, 1.3].map((at) => ({
        at,
        length: 1.5,
        frequency: 48,
        sweep: -18,
        decay: 3.4,
        noise: 0.05,
        level: 0.62,
      })),
      ...[0.325, 0.65, 0.975, 1.625, 1.95, 2.275].map((at) => ({
        at,
        length: 0.05,
        frequency: 8200,
        decay: 55,
        noise: 1,
        level: 0.1,
      })),
      ...[0.975, 2.275].map((at) => ({
        at,
        length: 0.2,
        frequency: 1500,
        decay: 17,
        noise: 0.88,
        level: 0.2,
      })),
      ...[1.46, 2.44].map((at) => ({
        at,
        length: 0.25,
        frequency: 392,
        partials: [1, 2],
        decay: 8,
        noise: 0.2,
        level: 0.1,
      })),
    ],
  });

  return combineVoices(sub, beat);
}

/** Polyphonic ringtones over cell chatter and keyboard clicks. */
function render2005Ambience({ context, output, time, gain }: CueSynthContext): SynthVoice {
  return createTextureVoice(context, output, time, gain, {
    key: 'era-2005-ambience',
    seed: 20050,
    seconds: 2.7,
    sampleRate: 22050,
    noise: 0.035,
    hum: [{ frequency: 118, level: 0.03 }],
    lowpass: 5000,
    trim: 0.9,
    motion: { frequency: 0.13, depth: 0.18 },
    events: [
      ...[0.15, 0.27, 0.39, 1.5, 1.62, 1.74].map((at) => ({
        at,
        length: 0.12,
        frequency: 1318.5,
        partials: [1, 2],
        decay: 10,
        noise: 0.1,
        level: 0.2,
      })),
      ...[0.6, 0.72, 0.84, 0.96, 1.9, 2.02, 2.14].map((at) => ({
        at,
        length: 0.1,
        frequency: 340,
        decay: 26,
        noise: 0.95,
        level: 0.13,
      })),
      ...[1.05, 1.12, 1.19].map((at) => ({
        at,
        length: 0.04,
        frequency: 4200,
        decay: 70,
        noise: 1,
        level: 0.1,
      })),
    ],
  });
}

/* ------------------------------------------------------------------------- *
 * 2025 — ambient electronica and drone hums
 * ------------------------------------------------------------------------- */

/** Ambient pads with sparse sub pulses and shimmering high notes. */
function render2025Music({ context, output, time, gain }: CueSynthContext): SynthVoice {
  const pads = createTonalVoice(
    context,
    output,
    time,
    gain,
    [
      { wave: 'sine', frequency: 220, gain: 0.13 },
      { wave: 'sine', frequency: 329.6, gain: 0.1 },
      { wave: 'sine', frequency: 440, gain: 0.07, detune: 5 },
      { wave: 'triangle', frequency: 110, gain: 0.1 },
    ],
    {
      lowpass: 1400,
      q: 0.8,
      vibrato: { frequency: 0.13, depth: 7 },
      motion: { frequency: 0.07, depth: 0.24 },
    },
  );

  const air = createTextureVoice(context, output, time, gain, {
    key: 'era-2025-music',
    seed: 2025,
    seconds: 3,
    sampleRate: 22050,
    noise: 0.022,
    hum: [
      { frequency: 55, level: 0.025 },
      { frequency: 165, level: 0.012 },
    ],
    lowpass: 3400,
    trim: 0.95,
    motion: { frequency: 0.05, depth: 0.2 },
    events: [
      ...[0, 1.5].map((at) => ({
        at,
        length: 1.4,
        frequency: 55,
        decay: 1.4,
        noise: 0.04,
        level: 0.22,
      })),
      ...[0.42, 1.95].map((at) => ({
        at,
        length: 1,
        frequency: 659.3,
        partials: [1, 2],
        decay: 2.6,
        noise: 0.1,
        level: 0.1,
      })),
      ...[0.8, 2.35].map((at) => ({
        at,
        length: 1.2,
        frequency: 1318.5,
        decay: 3.2,
        noise: 0.2,
        level: 0.06,
      })),
    ],
  });

  return combineVoices(pads, air);
}

/** A drone hum with drivetrain whine, bird calls and a fountain. */
function render2025Ambience({ context, output, time, gain }: CueSynthContext): SynthVoice {
  const drone = createTonalVoice(
    context,
    output,
    time,
    gain,
    [
      { wave: 'sine', frequency: 100, gain: 0.06 },
      { wave: 'sine', frequency: 200, gain: 0.03, detune: 4 },
    ],
    { lowpass: 600, q: 0.7, motion: { frequency: 0.06, depth: 0.22 } },
  );

  const street = createTextureVoice(context, output, time, gain, {
    key: 'era-2025-ambience',
    seed: 20250,
    seconds: 3,
    sampleRate: 22050,
    noise: 0.025,
    hum: [
      { frequency: 50, level: 0.05 },
      { frequency: 100, level: 0.022 },
      { frequency: 150, level: 0.01 },
    ],
    lowpass: 4600,
    trim: 0.9,
    motion: { frequency: 0.05, depth: 0.26 },
    events: [
      ...[0.2, 1.7].map((at) => ({
        at,
        length: 1.8,
        frequency: 420,
        partials: [1, 2, 3],
        decay: 1.2,
        noise: 0.25,
        level: 0.14,
      })),
      ...[0.85, 2.45].map((at) => ({
        at,
        length: 0.3,
        frequency: 2800,
        partials: [1, 1.5],
        sweep: 320,
        decay: 7,
        noise: 0.15,
        level: 0.08,
      })),
      { at: 1.35, length: 0.35, frequency: 1568, partials: [1, 2.5], decay: 8, noise: 0.1, level: 0.1 },
      { at: 0, length: 2.4, frequency: 600, decay: 1, noise: 1, level: 0.05 },
    ],
  });

  return combineVoices(drone, street);
}

/* ------------------------------------------------------------------------- *
 * Recipe table
 * ------------------------------------------------------------------------- */

/** The synthesized content of one era: a music bed and an ambience bed. */
export interface EraSoundscapeRecipe {
  readonly era: EraId;
  /** Bed tempo in BPM. */
  readonly tempo: number;
  /** Music-bed loop length in seconds (a whole number of bars at `tempo`). */
  readonly loopSeconds: number;
  readonly music: SoundscapeRenderer;
  readonly ambience: SoundscapeRenderer;
}

/**
 * One recipe per era. Tempi step from a 100 BPM post-war stroll through the
 * rockabilly and drum-machine decades to an 80 BPM ambient drift, which is what
 * makes each era's bed audibly its own even before the timbres are compared.
 */
export const ERA_SOUNDSCAPE_RECIPES: Readonly<Record<EraId, EraSoundscapeRecipe>> = Object.freeze({
  '1945': { era: '1945', tempo: 100, loopSeconds: 2.4, music: render1945Music, ambience: render1945Ambience },
  '1965': { era: '1965', tempo: 132, loopSeconds: 1.82, music: render1965Music, ambience: render1965Ambience },
  '1985': { era: '1985', tempo: 118, loopSeconds: 2.03, music: render1985Music, ambience: render1985Ambience },
  '2005': { era: '2005', tempo: 92, loopSeconds: 2.6, music: render2005Music, ambience: render2005Ambience },
  '2025': { era: '2025', tempo: 80, loopSeconds: 3, music: render2025Music, ambience: render2025Ambience },
});

/** The recipe for one era; throws on an unknown era. */
export function getEraSoundscapeRecipe(era: EraId): EraSoundscapeRecipe {
  const recipe = ERA_SOUNDSCAPE_RECIPES[era];
  if (!recipe) throw new RangeError(`No soundscape recipe for era "${String(era)}".`);
  return recipe;
}

/** What the synthesized beds of one era are made of, keyed by layer kind. */
const SYNTHESIS_NOTES: Readonly<
  Record<EraId, { readonly music: string; readonly ambience: string }>
> = Object.freeze({
  '1945': {
    music: 'big-band brass and crooner triangles on a narrow AM radio band over shellac crackle',
    ambience: 'streetcar clangs, a distant steam whistle and a hand bell under post-war hush',
  },
  '1965': {
    music: 'twanging rockabilly saw lead with a walking square bass and tape slapback echo',
    ambience: 'a V8 muscle engine idling under bus bells, riveter bursts and a tyre squeal',
  },
  '1985': {
    music: 'detuned synth-pop saw pads over a drum-machine kick, snare and hi-hat groove',
    ambience: 'arcade cabinet bleeps with cabinet hum, a distant siren and brake squeal',
  },
  '2005': {
    music: 'hip-hop sub bass with 808 hits, hi-hat ticks and a filtered vocal chop',
    ambience: 'polyphonic cell ringtones over chatter bursts and keyboard clicks',
  },
  '2025': {
    music: 'ambient electronica pads with sparse sub pulses and shimmering high notes',
    ambience: 'a drone hum with electric drivetrain whine, bird calls and a fountain',
  },
});

/* ------------------------------------------------------------------------- *
 * Profiles
 * ------------------------------------------------------------------------- */

function buildProfile(era: EraId): EraSoundscapeProfile {
  const descriptor = getEraDescriptor(era);
  const { soundscape } = descriptor;
  const recipe = getEraSoundscapeRecipe(era);
  const notes = SYNTHESIS_NOTES[era];
  const loudness = clamp01(soundscape.loudness);

  return Object.freeze({
    era,
    id: soundscape.id,
    label: descriptor.label,
    mood: soundscape.mood,
    musicBed: soundscape.musicBed,
    ambience: Object.freeze([...soundscape.ambience]),
    loudness,
    tempo: recipe.tempo,
    musicCue: soundscapeCueName(era, 'music'),
    ambienceCue: soundscapeCueName(era, 'ambience'),
    musicGain: loudness * MUSIC_LAYER_TRIM,
    ambienceGain: loudness * AMBIENCE_LAYER_TRIM,
    musicNotes: notes.music,
    ambienceNotes: notes.ambience,
  });
}

function buildProfiles(): Readonly<Record<EraId, EraSoundscapeProfile>> {
  const profiles = {} as Record<EraId, EraSoundscapeProfile>;
  for (const era of ERA_IDS) profiles[era] = buildProfile(era);
  return Object.freeze(profiles);
}

/** The five era profiles: descriptor identity plus mix-ready cue names/gains. */
export const ERA_SOUNDSCAPE_PROFILES: Readonly<Record<EraId, EraSoundscapeProfile>> =
  buildProfiles();

/** Profile of one era; throws for an unknown era. */
export function getEraSoundscapeProfile(era: EraId | string): EraSoundscapeProfile {
  const profile = ERA_SOUNDSCAPE_PROFILES[era as EraId];
  if (!profile) throw new RangeError(`Unknown era "${String(era)}" for a soundscape profile.`);
  return profile;
}

/** Full-strength gain of one layer: profile loudness times the layer trim. */
export function soundscapeLayerGain(era: EraId, kind: SoundscapeLayerKind): number {
  const profile = getEraSoundscapeProfile(era);
  return kind === 'music' ? profile.musicGain : profile.ambienceGain;
}

/* ------------------------------------------------------------------------- *
 * Cues
 * ------------------------------------------------------------------------- */

function createBedCue(
  era: EraId,
  kind: SoundscapeLayerKind,
  description: string,
  recipe: EraSoundscapeRecipe,
  render: SoundscapeRenderer,
): CueDefinition {
  return {
    name: soundscapeCueName(era, kind),
    bus: soundscapeLayerBus(kind),
    duration: recipe.loopSeconds,
    loop: true,
    positional: false,
    tags: Object.freeze(['soundscape', kind, `era-${era}`, 'loop', description]),
    render,
  };
}

/**
 * The ten era bed cues, ready for `AudioDirector.registerCues()`. Each bed is a
 * looping, non-positional cue on the `music` or `ambience` bus, so the director
 * owns routing, staging and the era crossfade dips.
 */
export function createEraSoundscapeCues(): readonly CueDefinition[] {
  const cues: CueDefinition[] = [];
  for (const era of ERA_IDS) {
    const profile = ERA_SOUNDSCAPE_PROFILES[era];
    const recipe = ERA_SOUNDSCAPE_RECIPES[era];
    cues.push(
      createBedCue(era, 'music', profile.musicNotes, recipe, recipe.music),
      createBedCue(era, 'ambience', profile.ambienceNotes, recipe, recipe.ambience),
    );
  }
  return cues;
}

/** The same cues keyed by cue name, for registry-style lookups and tests. */
export function createEraSoundscapeCueMap(): Readonly<Record<string, CueDefinition>> {
  const map: Record<string, CueDefinition> = {};
  for (const cue of createEraSoundscapeCues()) map[cue.name] = cue;
  return Object.freeze(map);
}
