import type { AudioManager } from '../contracts/audio';
import type { EraId } from '../contracts/era';

/**
 * A single synthesizable sound layer inside an ambient bed.
 *
 * Each layer owns its sources and exposes a single output node (a gain) that
 * the owning bed connects into its own gain. `stop()` releases every source.
 */
interface Layer {
  /** Node that should be connected into the bed's gain. */
  output: AudioNode;
  /** Stop and free the layer's sources. */
  stop(): void;
}

/** One era's ambient bed: a gain feeding the master plus its sound layers. */
class EraBed {
  readonly gain: GainNode;
  private readonly layers: Layer[];
  private readonly ctx: AudioContext;

  constructor(ctx: AudioContext, eraId: EraId) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.layers = buildEraLayers(ctx, eraId);
    for (const layer of this.layers) {
      layer.output.connect(this.gain);
    }
  }

  /** Ramp the bed gain to a target over a duration. */
  fadeTo(target: number, durationMs: number): void {
    const now = this.ctx.currentTime;
    const gain = this.gain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(target, now + durationMs / 1000);
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.stop();
    }
    this.gain.disconnect();
  }
}

/** Brown-ish looping noise buffer used as raw ambience material. */
function createNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

interface NoiseOptions {
  gain: number;
  filterFreq: number;
  filterType?: BiquadFilterType;
}

/** Filtered looping noise — crowd, air, traffic hiss. */
function noiseLayer(ctx: AudioContext, opts: NoiseOptions): Layer {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType ?? 'lowpass';
  filter.frequency.value = opts.filterFreq;
  const g = ctx.createGain();
  g.gain.value = opts.gain;
  src.connect(filter);
  filter.connect(g);
  src.start();
  return {
    output: g,
    stop: () => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

interface DroneOptions {
  freqs: number[];
  gain: number;
  filterFreq: number;
  type?: OscillatorType;
  detune?: number;
}

/** Stacked detuned oscillators through a low-pass — hum, engine, synth pad. */
function droneLayer(ctx: AudioContext, opts: DroneOptions): Layer {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = opts.filterFreq;
  const g = ctx.createGain();
  g.gain.value = opts.gain;
  const oscs: OscillatorNode[] = [];
  const spread = opts.detune ?? 20;
  for (const f of opts.freqs) {
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sawtooth';
    osc.frequency.value = f;
    osc.detune.value = (Math.random() - 0.5) * spread;
    osc.connect(filter);
    osc.start();
    oscs.push(osc);
  }
  filter.connect(g);
  return {
    output: g,
    stop: () => {
      for (const osc of oscs) {
        try {
          osc.stop();
        } catch {
          /* already stopped */
        }
      }
    },
  };
}

interface PulseOptions {
  rate: number;
  gain: number;
  filterFreq: number;
}

/** Low-frequency gated noise — distant tram / rhythmic machinery. */
function pulseLayer(ctx: AudioContext, opts: PulseOptions): Layer {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = opts.filterFreq;
  const g = ctx.createGain();
  g.gain.value = opts.gain / 2;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = opts.rate;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = opts.gain / 2;
  lfo.connect(lfoGain);
  lfoGain.connect(g.gain);
  src.connect(filter);
  filter.connect(g);
  src.start();
  lfo.start();
  return {
    output: g,
    stop: () => {
      try {
        src.stop();
        lfo.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

interface RadioOptions {
  freq: number;
  tremoloRate: number;
  gain: number;
  filterFreq: number;
}

/** Tremolo-wobbled tone — radio-era ambience. */
function radioLayer(ctx: AudioContext, opts: RadioOptions): Layer {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = opts.freq;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = opts.filterFreq;
  filter.Q.value = 4;
  const g = ctx.createGain();
  g.gain.value = opts.gain / 2;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = opts.tremoloRate;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = opts.gain / 2;
  lfo.connect(lfoGain);
  lfoGain.connect(g.gain);
  osc.connect(filter);
  filter.connect(g);
  osc.start();
  lfo.start();
  return {
    output: g,
    stop: () => {
      try {
        osc.stop();
        lfo.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

interface RingtoneOptions {
  freqA: number;
  freqB: number;
  interval: number;
  gain: number;
  dur: number;
}

/** Periodic two-tone beeps — mobile ringtone accents (2005). */
function ringtoneLayer(ctx: AudioContext, opts: RingtoneOptions): Layer {
  const g = ctx.createGain();
  g.gain.value = opts.gain;
  let timer: number | null = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) {
      return;
    }
    const now = ctx.currentTime;
    const beep = (freq: number, start: number) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const eg = ctx.createGain();
      eg.gain.setValueAtTime(0, start);
      eg.gain.linearRampToValueAtTime(1, start + 0.01);
      eg.gain.setValueAtTime(1, start + opts.dur - 0.01);
      eg.gain.linearRampToValueAtTime(0, start + opts.dur);
      osc.connect(eg);
      eg.connect(g);
      osc.start(start);
      osc.stop(start + opts.dur + 0.05);
    };
    beep(opts.freqA, now);
    beep(opts.freqB, now + opts.dur + 0.05);
    timer = window.setTimeout(schedule, opts.interval);
  };
  schedule();

  return {
    output: g,
    stop: () => {
      stopped = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    },
  };
}

/** Assemble the era-distinct layer set for a given era. */
function buildEraLayers(ctx: AudioContext, eraId: EraId): Layer[] {
  switch (eraId) {
    case 1945:
      return [
        // Low traffic hum.
        droneLayer(ctx, { freqs: [55, 82], gain: 0.05, filterFreq: 220 }),
        // Vintage engine notes.
        droneLayer(ctx, {
          freqs: [70, 88, 105],
          gain: 0.04,
          filterFreq: 300,
          type: 'square',
        }),
        // Distant tram.
        pulseLayer(ctx, { rate: 0.6, gain: 0.05, filterFreq: 500 }),
        // Mellow crowd.
        noiseLayer(ctx, { gain: 0.03, filterFreq: 700 }),
      ];
    case 1965:
      return [
        droneLayer(ctx, { freqs: [60, 90, 120], gain: 0.06, filterFreq: 320 }),
        // Busier engines.
        droneLayer(ctx, {
          freqs: [85, 110],
          gain: 0.05,
          filterFreq: 400,
          type: 'square',
        }),
        // Radio-era ambience.
        radioLayer(ctx, { freq: 220, tremoloRate: 4, gain: 0.03, filterFreq: 900 }),
        // Livelier crowd.
        noiseLayer(ctx, { gain: 0.05, filterFreq: 1200 }),
      ];
    case 1985:
      return [
        // Denser traffic.
        droneLayer(ctx, { freqs: [62, 93, 124, 155], gain: 0.08, filterFreq: 500 }),
        // Denser traffic hiss.
        noiseLayer(ctx, { gain: 0.06, filterFreq: 1800 }),
        // Synth-era city hum.
        droneLayer(ctx, {
          freqs: [110, 165, 220],
          gain: 0.04,
          filterFreq: 900,
          type: 'sawtooth',
          detune: 30,
        }),
      ];
    case 2005:
      return [
        // Modern traffic drone.
        droneLayer(ctx, { freqs: [70, 140, 210], gain: 0.06, filterFreq: 600 }),
        // Urban crowd.
        noiseLayer(ctx, { gain: 0.05, filterFreq: 2000 }),
        // Mobile ringtone accents.
        ringtoneLayer(ctx, {
          freqA: 784,
          freqB: 988,
          interval: 6000,
          gain: 0.04,
          dur: 0.18,
        }),
      ];
    case 2025:
      return [
        // Quiet EV hum.
        droneLayer(ctx, {
          freqs: [110, 220],
          gain: 0.03,
          filterFreq: 400,
          type: 'sine',
        }),
        // Faint electronic / ambient pad.
        droneLayer(ctx, {
          freqs: [146, 220, 293],
          gain: 0.025,
          filterFreq: 800,
          type: 'sine',
          detune: 12,
        }),
        // Modern crowd.
        noiseLayer(ctx, { gain: 0.02, filterFreq: 1500 }),
      ];
  }
}

/**
 * Concrete Web Audio implementation of the foundation {@link AudioManager}.
 *
 * Per-era ambient beds are synthesized procedurally (oscillators, filtered
 * noise, LFO pulses) so no external audio files are required. Era changes
 * crossfade the beds over the transition duration and trigger a synthesized
 * time-shift sweep. Playback is gesture-gated: nothing sounds until
 * {@link unlock} is called from a user gesture, satisfying autoplay policy.
 */
export class WebAudioManager implements AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private beds = new Map<EraId, EraBed>();
  private currentEra: EraId | null = null;
  private pendingEra: EraId | null = null;
  private volume = 0.8;
  private muted = false;
  private unlocked = false;
  private transitionMs = 2200;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * Resume the audio context from a user gesture. Safe to call repeatedly.
   * Must be invoked on the first user interaction to satisfy autoplay policy.
   */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    this.unlocked = true;
    if (this.pendingEra) {
      const era = this.pendingEra;
      this.pendingEra = null;
      void this.loadEraAmbience(era);
    }
  }

  /** Reports whether audio has been unlocked by a user gesture. */
  get isUnlocked(): boolean {
    return this.unlocked;
  }

  async loadEraAmbience(eraId: EraId): Promise<void> {
    if (!this.unlocked) {
      this.pendingEra = eraId;
      return;
    }
    const ctx = this.ensureContext();
    if (this.currentEra === eraId && this.beds.has(eraId)) {
      return;
    }
    let bed = this.beds.get(eraId);
    if (!bed) {
      bed = new EraBed(ctx, eraId);
      bed.gain.connect(this.master!);
      this.beds.set(eraId, bed);
    }
    bed.fadeTo(1, this.transitionMs);

    // Fade out and later dispose the previous bed.
    if (this.currentEra && this.currentEra !== eraId) {
      const prevEra = this.currentEra;
      const prev = this.beds.get(prevEra);
      if (prev) {
        prev.fadeTo(0, this.transitionMs);
        window.setTimeout(() => {
          if (this.currentEra === prevEra) {
            return;
          }
          if (this.beds.get(prevEra) === prev) {
            this.beds.delete(prevEra);
            prev.dispose();
          }
        }, this.transitionMs + 100);
      }
    }
    this.currentEra = eraId;
  }

  stopEraAmbience(): void {
    for (const bed of this.beds.values()) {
      bed.fadeTo(0, 300);
      window.setTimeout(() => bed.dispose(), 400);
    }
    this.beds.clear();
    this.currentEra = null;
    this.pendingEra = null;
  }

  playTransitionSfx(fromEra: EraId, toEra: EraId): void {
    if (!this.unlocked || !this.master) {
      return;
    }
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const dur = 1.6;

    // Time-shift whoosh: a band-pass noise sweep.
    const src = ctx.createBufferSource();
    src.buffer = createNoiseBuffer(ctx, 2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.25, now + 0.15);
    g.gain.setValueAtTime(0.25, now + dur - 0.2);
    g.gain.linearRampToValueAtTime(0, now + dur);
    const ascending = toEra > fromEra;
    const f0 = ascending ? 200 : 1800;
    const f1 = ascending ? 1800 : 200;
    filter.frequency.setValueAtTime(f0, now);
    filter.frequency.exponentialRampToValueAtTime(f1, now + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.05);

    // Sub-bass swell for weight.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, now);
    sub.frequency.exponentialRampToValueAtTime(40, now + dur);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, now);
    sg.gain.linearRampToValueAtTime(0.2, now + 0.1);
    sg.gain.linearRampToValueAtTime(0, now + dur);
    sub.connect(sg);
    sg.connect(this.master);
    sub.start(now);
    sub.stop(now + dur + 0.05);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.02,
      );
    }
  }
}
