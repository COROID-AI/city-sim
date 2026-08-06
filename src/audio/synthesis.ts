import type { EraId } from '../contracts';

/**
 * Procedural Web Audio synthesis for per-era ambient beds.
 *
 * Everything is generated at runtime from oscillators and noise buffers so the
 * app ships with zero external audio assets. Each era's bed is a small set of
 * looping layers (traffic hum, engines, crowd, period accents) mixed through a
 * single bed gain the {@link WebAudioManager} fades in/out to crossfade.
 */

/** A single era's ambient bed: sources already wired to `gain`, not yet started. */
export interface EraBed {
  era: EraId;
  /** Master gain for this bed. The manager connects it to the ambience bus. */
  gain: GainNode;
  /** Every schedulable source (oscillators + buffer sources) that must be started. */
  sources: AudioScheduledSourceNode[];
  /** Stop every source (optionally at an explicit audio time). */
  stop: (when?: number) => void;
}

/** Noise colour used for a layer. */
type NoiseType = 'white' | 'brown' | 'pink';

/** Options for a looping filtered-noise layer. */
interface NoiseLayerOptions {
  type: NoiseType;
  seconds: number;
  filterType: BiquadFilterType;
  freq: number;
  q?: number;
  gain: number;
}

/** Options for a looping oscillator layer (optionally LFO-modulated). */
interface ToneLayerOptions {
  freq: number;
  type: OscillatorType;
  gain: number;
  detune?: number;
  /** Slow LFO frequency applied to the layer's gain (tremolo). */
  lfoFreq?: number;
  /** Depth of the tremolo LFO (0..1 of the gain). */
  lfoDepth?: number;
}

/** A single beep in a repeating ringtone-style pattern. */
interface Beep {
  /** Offset in seconds from the start of the loop. */
  time: number;
  freq: number;
  dur: number;
  gain: number;
}

/** Accumulates layers and their sources while an era bed is being assembled. */
class BedBuilder {
  readonly sources: AudioScheduledSourceNode[] = [];

  constructor(
    private readonly ctx: AudioContext,
    private readonly bus: AudioNode,
  ) {}

  noise(opts: NoiseLayerOptions): void {
    const src = this.ctx.createBufferSource();
    src.buffer = createNoiseBuffer(this.ctx, opts.type, opts.seconds);
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.value = opts.freq;
    filter.Q.value = opts.q ?? 0.7;

    const g = this.ctx.createGain();
    g.gain.value = opts.gain;

    src.connect(filter).connect(g).connect(this.bus);
    this.sources.push(src);
  }

  tone(opts: ToneLayerOptions): void {
    const osc = this.ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.value = opts.freq;
    osc.detune.value = opts.detune ?? 0;

    const g = this.ctx.createGain();
    g.gain.value = opts.gain;

    if (opts.lfoFreq && opts.lfoDepth) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = opts.lfoFreq;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = opts.lfoDepth;
      lfo.connect(lfoGain).connect(g.gain);
      this.sources.push(lfo);
    }

    osc.connect(g).connect(this.bus);
    this.sources.push(osc);
  }

  beepLoop(pattern: Beep[], loopSeconds: number, gain: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = createBeepBuffer(this.ctx, pattern, loopSeconds);
    src.loop = true;

    const g = this.ctx.createGain();
    g.gain.value = gain;

    src.connect(g).connect(this.bus);
    this.sources.push(src);
  }
}

/** Fill a single-channel buffer with a given noise colour. */
export function createNoiseBuffer(ctx: AudioContext, type: NoiseType, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  let last = 0;
  // Paul Kellet's pink-noise approximation state.
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (type === 'white') {
      data[i] = white;
    } else if (type === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }

  return buffer;
}

/** Build a looping buffer containing a sequence of short sine beeps. */
function createBeepBuffer(ctx: AudioContext, pattern: Beep[], loopSeconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * loopSeconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (const beep of pattern) {
    const start = Math.floor(beep.time * ctx.sampleRate);
    const samples = Math.max(1, Math.floor(beep.dur * ctx.sampleRate));
    const phaseStep = (2 * Math.PI * beep.freq) / ctx.sampleRate;
    for (let i = 0; i < samples; i++) {
      const idx = start + i;
      if (idx >= length) break;
      // Simple raised-cosine envelope to avoid clicks.
      const env = Math.sin((Math.PI * i) / samples) ** 2;
      data[idx] += Math.sin(phaseStep * i) * env * beep.gain;
    }
  }

  return buffer;
}

/** Assemble the full ambient bed for a given era. */
export function buildEraBed(ctx: AudioContext, era: EraId): EraBed {
  const gain = ctx.createGain();
  gain.gain.value = 0;

  const b = new BedBuilder(ctx, gain);

  switch (era) {
    case '1945':
      build1945(b);
      break;
    case '1965':
      build1965(b);
      break;
    case '1985':
      build1985(b);
      break;
    case '2005':
      build2005(b);
      break;
    case '2025':
      build2025(b);
      break;
  }

  return {
    era,
    gain,
    sources: b.sources,
    stop: (when?: number) => {
      const t = when ?? ctx.currentTime;
      for (const src of b.sources) {
        try {
          src.stop(t);
        } catch {
          // Source may already be stopped; ignore.
        }
      }
    },
  };
}

/** 1945: low traffic hum, vintage engine notes, distant tram, mellow crowd. */
function build1945(b: BedBuilder): void {
  // Low traffic hum.
  b.noise({ type: 'brown', seconds: 4, filterType: 'lowpass', freq: 180, gain: 0.12 });
  // Vintage engine note (two detuned low saws with a slow wobble).
  b.tone({ freq: 55, type: 'sawtooth', gain: 0.045, detune: -8, lfoFreq: 0.4, lfoDepth: 0.3 });
  b.tone({ freq: 82, type: 'sawtooth', gain: 0.04, detune: 8, lfoFreq: 0.4, lfoDepth: 0.3 });
  // Distant tram: low rumble with a slow tremolo suggesting a passing car.
  b.noise({ type: 'brown', seconds: 6, filterType: 'bandpass', freq: 90, q: 1.2, gain: 0.05 });
  b.tone({ freq: 45, type: 'sine', gain: 0.03, lfoFreq: 0.18, lfoDepth: 0.7 });
  // Mellow crowd: gentle band-passed noise.
  b.noise({ type: 'pink', seconds: 4, filterType: 'bandpass', freq: 1100, q: 0.5, gain: 0.045 });
}

/** 1965: busier engines, radio-era ambience, livelier crowd. */
function build1965(b: BedBuilder): void {
  // Busier traffic hum.
  b.noise({ type: 'brown', seconds: 4, filterType: 'lowpass', freq: 260, gain: 0.16 });
  // Busier engine notes.
  b.tone({ freq: 60, type: 'sawtooth', gain: 0.07, detune: -10, lfoFreq: 0.6, lfoDepth: 0.35 });
  b.tone({ freq: 90, type: 'sawtooth', gain: 0.06, detune: 12, lfoFreq: 0.5, lfoDepth: 0.3 });
  // Radio-era ambience: a distant AM-ish tone with tremolo.
  b.tone({ freq: 440, type: 'sine', gain: 0.02, lfoFreq: 6, lfoDepth: 0.5 });
  // Livelier crowd.
  b.noise({ type: 'pink', seconds: 4, filterType: 'bandpass', freq: 1400, q: 0.6, gain: 0.07 });
}

/** 1985: denser traffic, synth-era city hum. */
function build1985(b: BedBuilder): void {
  // Denser traffic.
  b.noise({ type: 'brown', seconds: 4, filterType: 'lowpass', freq: 340, gain: 0.2 });
  // Synth-era city hum (detuned saw pad with vibrato).
  b.tone({ freq: 110, type: 'sawtooth', gain: 0.05, detune: -6, lfoFreq: 0.8, lfoDepth: 0.25 });
  b.tone({ freq: 111, type: 'sawtooth', gain: 0.045, detune: 6, lfoFreq: 0.8, lfoDepth: 0.25 });
  // Faint neon buzz.
  b.noise({ type: 'white', seconds: 3, filterType: 'bandpass', freq: 3000, q: 4, gain: 0.02 });
  // Crowd.
  b.noise({ type: 'pink', seconds: 4, filterType: 'bandpass', freq: 1500, q: 0.6, gain: 0.06 });
}

/** 2005: modern traffic drone, mobile ringtone accents, urban crowd. */
function build2005(b: BedBuilder): void {
  // Modern traffic drone.
  b.noise({ type: 'brown', seconds: 4, filterType: 'lowpass', freq: 300, gain: 0.18 });
  b.tone({ freq: 60, type: 'sine', gain: 0.06 });
  // Mobile ringtone accents (a repeating two-tone beep pattern).
  b.beepLoop(
    [
      { time: 0.5, freq: 880, dur: 0.12, gain: 0.5 },
      { time: 0.9, freq: 1174, dur: 0.12, gain: 0.5 },
      { time: 4.5, freq: 988, dur: 0.1, gain: 0.45 },
    ],
    7,
    0.03,
  );
  // Urban crowd.
  b.noise({ type: 'pink', seconds: 4, filterType: 'bandpass', freq: 1700, q: 0.6, gain: 0.08 });
}

/** 2025: quiet EV hum, faint electronic/ambient, modern crowd. */
function build2025(b: BedBuilder): void {
  // Quiet EV hum.
  b.tone({ freq: 50, type: 'sine', gain: 0.04, lfoFreq: 0.3, lfoDepth: 0.2 });
  b.noise({ type: 'brown', seconds: 4, filterType: 'lowpass', freq: 160, gain: 0.05 });
  // Faint electronic/ambient pad.
  b.tone({ freq: 220, type: 'sine', gain: 0.02, lfoFreq: 0.12, lfoDepth: 0.5 });
  b.tone({ freq: 330, type: 'sine', gain: 0.02, lfoFreq: 0.09, lfoDepth: 0.5 });
  // Modern crowd.
  b.noise({ type: 'pink', seconds: 4, filterType: 'bandpass', freq: 1800, q: 0.6, gain: 0.05 });
}
