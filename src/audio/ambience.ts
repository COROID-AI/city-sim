import type { EraId } from '../contracts';

/**
 * Procedural per-era ambient beds built entirely with the Web Audio API
 * (oscillators, filtered noise and small synthesized loops). No external
 * audio files are required.
 *
 * Each era's bed is a collection of layers that all feed a single output
 * `GainNode` (the "bed gain"). The manager crossfades between beds by
 * ramping this output gain.
 */

/** A repeating synthesized loop used for accents like a mobile ringtone. */
export interface LoopSpec {
  /** Frequency of the loop's tones in Hz. */
  toneFreq: number;
  /**
   * Note durations in seconds. Each entry plays the tone for that long;
   * gaps can be encoded as quiet tone segments. The whole pattern loops.
   */
  pattern: number[];
}

/** One layer of an era's ambient bed. */
export type AmbienceLayer =
  | { kind: 'traffic'; gain: number; cutoff: number; noise: 'brown' | 'white' }
  | { kind: 'drone'; gain: number; freq: number; type: OscillatorType }
  | {
      kind: 'engine';
      gain: number;
      baseFreq: number;
      lfoRate: number;
      lfoDepth: number;
    }
  | { kind: 'crowd'; gain: number; cutoff: number }
  | { kind: 'pad'; gain: number; freqs: number[] }
  | { kind: 'ringtone'; gain: number; loop: LoopSpec }
  | { kind: 'tram'; gain: number; freq: number };

/** The layered ambient bed definition for every era. */
export const ERA_AMBIENCE_SPECS: Record<EraId, AmbienceLayer[]> = {
  1945: [
    // Low traffic hum — a quiet, heavily low-passed brown noise.
    { kind: 'traffic', gain: 0.11, cutoff: 260, noise: 'brown' },
    // Vintage engine notes — a slow, puttering sawtooth.
    { kind: 'engine', gain: 0.045, baseFreq: 52, lfoRate: 7, lfoDepth: 5 },
    // Distant tram — a low, slowly swelling rumble.
    { kind: 'tram', gain: 0.05, freq: 58 },
    // Mellow crowd — a soft band-passed swell.
    { kind: 'crowd', gain: 0.04, cutoff: 750 },
  ],
  1965: [
    // Busier engines — two overlapping engine layers.
    { kind: 'traffic', gain: 0.13, cutoff: 380, noise: 'brown' },
    { kind: 'engine', gain: 0.05, baseFreq: 58, lfoRate: 9, lfoDepth: 7 },
    { kind: 'engine', gain: 0.035, baseFreq: 74, lfoRate: 11, lfoDepth: 6 },
    // Radio-era ambience — a warm, slightly detuned AM-style pad.
    { kind: 'pad', gain: 0.05, freqs: [110, 138.59, 164.81] },
    // Livelier crowd.
    { kind: 'crowd', gain: 0.055, cutoff: 1000 },
  ],
  1985: [
    // Denser traffic — brighter, more present noise.
    { kind: 'traffic', gain: 0.16, cutoff: 620, noise: 'white' },
    // Synth-era city hum — a neon synth pad.
    { kind: 'pad', gain: 0.06, freqs: [110, 165, 220] },
    // A subtle synth drone underneath.
    { kind: 'drone', gain: 0.04, freq: 82.41, type: 'sine' },
    { kind: 'crowd', gain: 0.06, cutoff: 1200 },
  ],
  2005: [
    // Modern traffic drone — noise plus a low continuous drone.
    { kind: 'traffic', gain: 0.15, cutoff: 700, noise: 'brown' },
    { kind: 'drone', gain: 0.05, freq: 92, type: 'sine' },
    // Mobile ringtone accents — a soft, repeating synthesized loop.
    {
      kind: 'ringtone',
      gain: 0.03,
      loop: { toneFreq: 880, pattern: [0.09, 0.09, 0.09, 0.28, 0.65] },
    },
    // Urban crowd.
    { kind: 'crowd', gain: 0.065, cutoff: 1300 },
  ],
  2025: [
    // Quiet EV hum — a gentle low sine.
    { kind: 'drone', gain: 0.05, freq: 80, type: 'sine' },
    // Faint electronic/ambient texture.
    { kind: 'pad', gain: 0.035, freqs: [196, 246.94, 293.66] },
    { kind: 'traffic', gain: 0.08, cutoff: 900, noise: 'brown' },
    // Modern crowd.
    { kind: 'crowd', gain: 0.06, cutoff: 1400 },
  ],
};

/** Generate a looping noise buffer (brown noise via leaky integration). */
function createNoiseBuffer(
  ctx: AudioContext,
  noise: 'brown' | 'white',
): AudioBuffer {
  const seconds = 2;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (noise === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white * 0.7;
    }
  }
  return buffer;
}

/** Build a looping synthesized ringtone buffer from a pattern of durations. */
function createRingtoneBuffer(ctx: AudioContext, loop: LoopSpec): AudioBuffer {
  const { toneFreq, pattern } = loop;
  const total = pattern.reduce((sum, d) => sum + d, 0);
  const buffer = ctx.createBuffer(
    1,
    Math.floor(ctx.sampleRate * total),
    ctx.sampleRate,
  );
  const data = buffer.getChannelData(0);
  let offset = 0;
  for (const dur of pattern) {
    const samples = Math.floor(ctx.sampleRate * dur);
    for (let i = 0; i < samples; i++) {
      const t = i / ctx.sampleRate;
      const attack = Math.min(1, t / 0.01);
      const release = Math.min(1, (dur - t) / 0.05);
      const env = Math.min(attack, release);
      data[offset + i] = Math.sin(2 * Math.PI * toneFreq * t) * env * 0.4;
    }
    offset += samples;
  }
  return buffer;
}

function buildTraffic(
  ctx: AudioContext,
  layer: Extract<AmbienceLayer, { kind: 'traffic' }>,
) {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx, layer.noise);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = layer.cutoff;
  const gain = ctx.createGain();
  gain.gain.value = layer.gain;
  src.connect(filter).connect(gain);
  src.start();
  return gain;
}

function buildDrone(
  ctx: AudioContext,
  layer: Extract<AmbienceLayer, { kind: 'drone' }>,
) {
  const osc = ctx.createOscillator();
  osc.type = layer.type;
  osc.frequency.value = layer.freq;
  const gain = ctx.createGain();
  gain.gain.value = layer.gain;
  osc.connect(gain);
  osc.start();
  return gain;
}

function buildEngine(
  ctx: AudioContext,
  layer: Extract<AmbienceLayer, { kind: 'engine' }>,
) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = layer.baseFreq;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = layer.lfoRate;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = layer.lfoDepth;
  lfo.connect(lfoGain).connect(osc.frequency);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  const gain = ctx.createGain();
  gain.gain.value = layer.gain;
  osc.connect(filter).connect(gain);
  osc.start();
  lfo.start();
  return gain;
}

function buildCrowd(
  ctx: AudioContext,
  layer: Extract<AmbienceLayer, { kind: 'crowd' }>,
) {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx, 'brown');
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = layer.cutoff;
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  gain.gain.value = layer.gain;
  src.connect(filter).connect(gain);
  src.start();
  return gain;
}

function buildPad(
  ctx: AudioContext,
  layer: Extract<AmbienceLayer, { kind: 'pad' }>,
) {
  const gain = ctx.createGain();
  gain.gain.value = layer.gain;
  for (const freq of layer.freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.detune.value = Math.random() * 12 - 6;
    osc.connect(gain);
    osc.start();
  }
  return gain;
}

function buildRingtone(
  ctx: AudioContext,
  layer: Extract<AmbienceLayer, { kind: 'ringtone' }>,
) {
  const src = ctx.createBufferSource();
  src.buffer = createRingtoneBuffer(ctx, layer.loop);
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = layer.gain;
  src.connect(gain);
  src.start();
  return gain;
}

function buildTram(
  ctx: AudioContext,
  layer: Extract<AmbienceLayer, { kind: 'tram' }>,
) {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = layer.freq;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.15;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = layer.gain * 0.5;
  const gain = ctx.createGain();
  gain.gain.value = layer.gain * 0.5;
  lfo.connect(lfoGain).connect(gain.gain);
  osc.connect(gain);
  osc.start();
  lfo.start();
  return gain;
}

function buildLayer(ctx: AudioContext, layer: AmbienceLayer): AudioNode {
  switch (layer.kind) {
    case 'traffic':
      return buildTraffic(ctx, layer);
    case 'drone':
      return buildDrone(ctx, layer);
    case 'engine':
      return buildEngine(ctx, layer);
    case 'crowd':
      return buildCrowd(ctx, layer);
    case 'pad':
      return buildPad(ctx, layer);
    case 'ringtone':
      return buildRingtone(ctx, layer);
    case 'tram':
      return buildTram(ctx, layer);
  }
}

/**
 * Build the full ambient bed for an era. The returned `GainNode` is the
 * bed's master output (started at 0 so the manager can fade it in), with
 * every layer already connected and running.
 */
export function buildEraAmbience(ctx: AudioContext, era: EraId): GainNode {
  const bed = ctx.createGain();
  bed.gain.value = 0;
  for (const layer of ERA_AMBIENCE_SPECS[era]) {
    buildLayer(ctx, layer).connect(bed);
  }
  return bed;
}
