/**
 * Web Audio SFX engine.
 *
 * Everything is synthesised - no audio files. The engine owns:
 *  - a lazily-created AudioContext that is only started from a user gesture
 *    (autoplay policy), with a persistent "enable sound" prompt until then;
 *  - a master chain (per-layer gains -> DynamicsCompressor -> masterGain ->
 *    destination) with a mute toggle;
 *  - per-era ambience beds (noise / hum / murmur / buzz / birds / siren / bell)
 *    rebuilt whenever the era changes;
 *  - vehicle pass-by swooshes panned by screen position;
 *  - UI click ticks and a whoosh fired on every era change;
 *  - gentle era music beds (jazz walking bass, surf arpeggio, synth sequence,
 *    downtempo pad, lo-fi loop) from a tiny beat sequencer.
 *
 * The AudioContext is injectable, so all of this is exercised headlessly with a
 * fake context in `tests/audio.test.ts`.
 */

import type { AmbienceLayer, AudioSpec, Year } from '../config/types';
import { ERA_AUDIO } from './eraAudio';

/* --------------------------------------------------------- context types -- */

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime?(value: number, time: number, constant: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike;
  disconnect?(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface OscillatorLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  detune?: AudioParamLike;
  start(time?: number): void;
  stop(time?: number): void;
}

export interface FilterNodeLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  Q: AudioParamLike;
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: unknown;
  loop: boolean;
  loopStart?: number;
  loopEnd?: number;
  start(time?: number): void;
  stop(time?: number): void;
}

export interface PannerNodeLike extends AudioNodeLike {
  pan: AudioParamLike;
}

export interface CompressorNodeLike extends AudioNodeLike {
  threshold: AudioParamLike;
  knee: AudioParamLike;
  ratio: AudioParamLike;
  attack: AudioParamLike;
  release: AudioParamLike;
}

export interface AudioBufferLike {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioContextLike {
  state: string;
  currentTime: number;
  sampleRate: number;
  destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorLike;
  createBiquadFilter(): FilterNodeLike;
  createBufferSource(): BufferSourceLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createDynamicsCompressor(): CompressorNodeLike;
  createStereoPanner?(): PannerNodeLike;
  resume?(): Promise<void>;
  suspend?(): Promise<void>;
  close?(): Promise<void>;
}

export type AudioContextFactory = () => AudioContextLike | null;

/** Default factory: real Web Audio in the browser, `null` when unavailable. */
export function defaultAudioContextFactory(): AudioContextFactory {
  return () => {
    const scope = globalThis as unknown as {
      AudioContext?: new () => AudioContextLike;
      webkitAudioContext?: new () => AudioContextLike;
    };
    const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
    if (!Ctor) return null;
    try {
      return new Ctor();
    } catch {
      return null;
    }
  };
}

/* ------------------------------------------------------------ the engine -- */

export interface AudioEngineOptions {
  contextFactory?: AudioContextFactory;
  specProvider?: (year: Year) => AudioSpec;
  /** Skip the music sequencer entirely (used by the reduced-motion path). */
  musicEnabled?: boolean;
}

export interface PassByOptions {
  /** -1 left .. +1 right. */
  pan?: number;
  /** Engine base frequency; defaults to the era profile. */
  engineHz?: number;
  gain?: number;
}

const MASTER_LEVEL = 0.85;
/** Semitone offsets per motif, cycled by the sequencer. */
const MOTIF_NOTES: Record<string, number[]> = {
  jazz: [0, 7, 3, 5, 0, 7, 10, 5],
  surf: [0, 4, 7, 12, 7, 4, 0, 5],
  synth: [0, 12, 7, 12, 3, 15, 10, 12],
  downtempo: [0, 3, 7, 5],
  lofi: [0, 5, 7, 3, 10, 7],
};

function semitoneToHz(root: number, semitones: number): number {
  return root * Math.pow(2, semitones / 12);
}

export class AudioEngine {
  private readonly contextFactory: AudioContextFactory;
  private readonly specProvider: (year: Year) => AudioSpec;
  private readonly musicEnabled: boolean;
  /** True when the host plainly exposes Web Audio (checked without constructing). */
  private readonly globallySupported: boolean;
  /** True when the caller supplied its own context factory. */
  private readonly customFactory: boolean;

  private context: AudioContextLike | null = null;
  /** Lazily created (single) context; `undefined` = not probed yet. */
  private probed: AudioContextLike | null | undefined;
  private master: GainNodeLike | null = null;
  private compressor: CompressorNodeLike | null = null;
  private noiseBuffer: AudioBufferLike | null = null;

  private readonly ambienceGains = new Map<string, GainNodeLike>();
  private activeLayers: AmbienceLayer[] = [];

  private unlockedFlag = false;
  private mutedFlag = false;
  private currentYear: Year = 1945;

  private beat = 0;
  private musicTimer = 0;
  private bellTimer = 0;
  private birdTimer = 0;
  private readonly eventLog: string[] = [];

  constructor(options: AudioEngineOptions = {}) {
    this.contextFactory = options.contextFactory ?? defaultAudioContextFactory();
    this.specProvider = options.specProvider ?? ((year) => ERA_AUDIO[year]);
    this.musicEnabled = options.musicEnabled ?? true;
    this.customFactory = options.contextFactory !== undefined;
    const scope = globalThis as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
    this.globallySupported = Boolean(scope.AudioContext ?? scope.webkitAudioContext);
  }

  /* ------------------------------------------------------------ state ---- */

  get unlocked(): boolean {
    return this.unlockedFlag;
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** True once an AudioContext exists (even before it is resumed). */
  get hasContext(): boolean {
    return this.context !== null;
  }

  /** False when the browser has no Web Audio at all - the engine degrades silently. */
  get available(): boolean {
    if (this.context !== null) return true;
    if (this.globallySupported) return true;
    // Injected factory (tests / hosts without a global constructor): probe once.
    return this.customFactory ? this.ensureContext() !== null : false;
  }

  get currentSpec(): AudioSpec {
    return this.specProvider(this.currentYear);
  }

  /** Ambience layer ids currently mixed in. */
  get activeAmbienceIds(): string[] {
    return this.activeLayers.map((layer) => layer.id);
  }

  /** Distinctive per-era signature used by the audio tests. */
  get eraSignature(): string {
    const spec = this.currentSpec;
    const ids = this.activeLayers.length > 0 ? this.activeAmbienceIds : spec.ambience.map((layer) => layer.id);
    return [
      spec.engineProfile,
      spec.music.motif,
      spec.transition,
      ids.join('+'),
    ].join('::');
  }

  get masterLevel(): number {
    if (!this.master) return this.mutedFlag ? 0 : MASTER_LEVEL;
    return this.master.gain.value;
  }

  /** Rolling record of scheduled one-shots ('whoosh', 'click', 'pass-by'). */
  get events(): string[] {
    return this.eventLog.slice();
  }

  get year(): Year {
    return this.currentYear;
  }

  /* ------------------------------------------------------------ unlock -- */

  /**
   * Start audio in response to a user gesture. Returns true when the engine is
   * producing sound afterwards. Never throws: any failure degrades to silence.
   */
  unlock(): boolean {
    if (this.unlockedFlag) return true;
    try {
      if (!this.context) {
        this.context = this.ensureContext();
        if (!this.context) return false;
        this.buildMasterChain();
        this.buildAmbience(this.currentYear);
      }
      void this.context.resume?.();
      this.unlockedFlag = true;
      this.applyMasterGain();
      return true;
    } catch {
      this.context = null;
      this.unlockedFlag = false;
      return false;
    }
  }

  /** Detach listeners / release the context. */
  dispose(): void {
    try {
      void this.context?.close?.();
    } catch {
      /* ignore */
    }
    this.context = null;
    this.probed = null;
    this.master = null;
    this.compressor = null;
    this.ambienceGains.clear();
    this.activeLayers = [];
    this.unlockedFlag = false;
  }

  /* ------------------------------------------------------------- mixing -- */

  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    this.applyMasterGain();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.mutedFlag);
    return this.mutedFlag;
  }

  /** Switch the whole soundscape to another era (whoosh is fired separately). */
  setYear(year: Year): void {
    this.currentYear = year;
    if (this.context) this.buildAmbience(year);
    // Restart the music phrase on the new motif.
    this.beat = 0;
    this.musicTimer = 0;
  }

  /* --------------------------------------------------------- one-shots --- */

  playClick(): void {
    if (!this.ready()) return;
    const ctx = this.context as AudioContextLike;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1320;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.master as GainNodeLike);
    osc.start(now);
    osc.stop(now + 0.08);
    this.eventLog.push('click');
  }

  /** Era-change whoosh: a filtered noise sweep plus an upward tone. */
  playWhoosh(): void {
    if (!this.ready()) return;
    const ctx = this.context as AudioContextLike;
    const now = ctx.currentTime;
    const spec = this.currentSpec;

    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer();
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    const startHz = spec.transition === 'whoosh-warm' ? 220 : spec.transition === 'whoosh-neon' ? 900 : 420;
    filter.frequency.setValueAtTime(startHz, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, startHz * 5), now + 0.5);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, startHz * 0.6), now + 0.85);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.09);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master as GainNodeLike);
    source.start(now);
    source.stop(now + 0.95);

    const tone = ctx.createOscillator();
    tone.type = 'triangle';
    tone.frequency.setValueAtTime(180, now);
    tone.frequency.exponentialRampToValueAtTime(760, now + 0.55);
    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(0.0001, now);
    toneGain.gain.exponentialRampToValueAtTime(0.08, now + 0.1);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    tone.connect(toneGain);
    toneGain.connect(this.master as GainNodeLike);
    tone.start(now);
    tone.stop(now + 0.75);

    this.eventLog.push('whoosh');
  }

  /** A vehicle passing the listener, panned across the stereo field. */
  playPassBy(options: PassByOptions = {}): void {
    if (!this.ready()) return;
    const ctx = this.context as AudioContextLike;
    const now = ctx.currentTime;
    const spec = this.currentSpec;
    const pan = Math.max(-1, Math.min(1, options.pan ?? 0));
    const engineHz = options.engineHz ?? spec.engineBaseHz;

    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer();
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = spec.engineProfile === 'electric' ? 'highpass' : 'lowpass';
    filter.frequency.setValueAtTime(engineHz * 3.2, now);
    filter.frequency.linearRampToValueAtTime(engineHz * 6.5, now + 0.45);
    filter.frequency.linearRampToValueAtTime(engineHz * 2.4, now + 1.1);
    const gain = ctx.createGain();
    const level = options.gain ?? 0.18;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.35);
    gain.gain.linearRampToValueAtTime(level * 0.7, now + 0.75);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);

    source.connect(filter);
    filter.connect(gain);
    const target = this.master as GainNodeLike;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(target);
    } else {
      gain.connect(target);
    }
    source.start(now);
    source.stop(now + 1.3);

    if (spec.engineProfile !== 'electric') {
      // Combustion engines get a low tone under the noise swoosh.
      const tone = ctx.createOscillator();
      tone.type = 'sawtooth';
      tone.frequency.setValueAtTime(engineHz * 0.7, now);
      tone.frequency.linearRampToValueAtTime(engineHz * 1.5, now + 0.5);
      const toneGain = ctx.createGain();
      toneGain.gain.setValueAtTime(0.0001, now);
      toneGain.gain.linearRampToValueAtTime(0.05, now + 0.3);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 1);
      tone.connect(toneGain);
      toneGain.connect(target);
      tone.start(now);
      tone.stop(now + 1.05);
    }

    this.eventLog.push('pass-by');
  }

  /** Streetcar / trolley bell - early eras only. */
  playBell(): void {
    if (!this.ready()) return;
    const ctx = this.context as AudioContextLike;
    const now = ctx.currentTime;
    for (const [index, hz] of [1180, 1580].entries()) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const gain = ctx.createGain();
      const start = now + index * 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.09, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(gain);
      gain.connect(this.master as GainNodeLike);
      osc.start(start);
      osc.stop(start + 0.55);
    }
    this.eventLog.push('bell');
  }

  /* ------------------------------------------------------------- frames -- */

  update(dt: number): void {
    if (!this.ready() || !this.musicEnabled) return;
    const spec = this.currentSpec;
    const beatDuration = 60 / Math.max(40, spec.music.tempo);
    this.musicTimer += dt;
    while (this.musicTimer >= beatDuration) {
      this.musicTimer -= beatDuration;
      this.scheduleBeat(spec, beatDuration);
      this.beat += 1;
    }

    if (spec.streetcarBell) {
      this.bellTimer -= dt;
      if (this.bellTimer <= 0) {
        this.bellTimer = 9 + (this.beat % 5);
        this.playBell();
      }
    }
    if (this.activeLayers.some((layer) => layer.kind === 'birds')) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.birdTimer = 5 + (this.beat % 4);
        this.chirp();
      }
    }
  }

  /* ------------------------------------------------------------ internals */

  /** Create (once) and cache the audio context; null when unsupported. */
  private ensureContext(): AudioContextLike | null {
    if (this.probed === undefined) {
      try {
        this.probed = this.contextFactory();
      } catch {
        this.probed = null;
      }
    }
    return this.probed;
  }

  private ready(): boolean {
    return this.unlockedFlag && this.context !== null && this.master !== null && !this.mutedFlag;
  }

  private applyMasterGain(): void {
    if (!this.master) return;
    const value = this.mutedFlag ? 0 : MASTER_LEVEL;
    if (typeof this.master.gain.setTargetAtTime === 'function' && this.context) {
      this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.05);
    } else {
      this.master.gain.value = value;
    }
    this.master.gain.value = value;
  }

  private buildMasterChain(): void {
    const ctx = this.context as AudioContextLike;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 3.2;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.22;
    this.master = ctx.createGain();
    this.master.gain.value = this.mutedFlag ? 0 : MASTER_LEVEL;
    this.compressor.connect(this.master);
    this.master.connect(ctx.destination);
  }

  private getNoiseBuffer(): AudioBufferLike {
    const ctx = this.context as AudioContextLike;
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic pseudo-noise so runs are reproducible.
    let seed = 12345;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff) - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** Rebuild the era ambience bed. */
  private buildAmbience(year: Year): void {
    const ctx = this.context as AudioContextLike;
    const spec = this.specProvider(year);
    for (const gain of this.ambienceGains.values()) gain.disconnect?.();
    this.ambienceGains.clear();
    this.activeLayers = spec.ambience;

    for (const layer of spec.ambience) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.compressor as CompressorNodeLike);

      const filter = ctx.createBiquadFilter();
      filter.frequency.value = layer.filterHz;
      filter.Q.value = layer.q ?? 1;
      filter.type =
        layer.kind === 'noise' || layer.kind === 'murmur' || layer.kind === 'birds'
          ? 'lowpass'
          : layer.kind === 'buzz'
            ? 'highpass'
            : 'bandpass';
      filter.connect(gain);

      if (layer.kind === 'noise' || layer.kind === 'murmur') {
        const source = ctx.createBufferSource();
        source.buffer = this.getNoiseBuffer();
        source.loop = true;
        source.connect(filter);
        source.start();
      } else if (layer.kind === 'hum' || layer.kind === 'buzz' || layer.kind === 'tone') {
        const osc = ctx.createOscillator();
        osc.type = layer.kind === 'buzz' ? 'sawtooth' : 'sine';
        osc.frequency.value = Math.max(24, layer.filterHz / (layer.kind === 'hum' ? 4 : 8));
        osc.connect(filter);
        osc.start();
      } else {
        // bell / birds / siren are scheduled one-shots: keep a quiet bed only.
        const source = ctx.createBufferSource();
        source.buffer = this.getNoiseBuffer();
        source.loop = true;
        source.connect(filter);
        source.start();
      }

      // Fade the new bed in so era changes are smooth.
      const target = layer.gain * (this.mutedFlag ? 0 : 1);
      if (typeof gain.gain.linearRampToValueAtTime === 'function') {
        gain.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.6);
      }
      gain.gain.value = target;
      this.ambienceGains.set(layer.id, gain);
    }
  }

  private scheduleBeat(spec: AudioSpec, beatDuration: number): void {
    const ctx = this.context as AudioContextLike;
    const now = ctx.currentTime;
    const notes = MOTIF_NOTES[spec.music.motif] ?? MOTIF_NOTES.downtempo;
    const offset = notes[this.beat % notes.length];
    const hz = semitoneToHz(spec.music.root, offset >= 12 ? offset - 12 : offset);
    const osc = ctx.createOscillator();
    osc.type = spec.music.motif === 'synth' ? 'square' : spec.music.motif === 'surf' ? 'triangle' : 'sine';
    osc.frequency.value = hz;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.music.motif === 'jazz' ? 900 : spec.music.motif === 'synth' ? 2600 : 1600;
    const gain = ctx.createGain();
    const level = spec.music.gain * 0.5;
    const attack = spec.music.motif === 'downtempo' || spec.music.motif === 'lofi' ? 0.12 : 0.01;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(level, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + beatDuration * 1.4);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master as GainNodeLike);
    osc.start(now);
    osc.stop(now + beatDuration * 1.5);
  }

  private chirp(): void {
    if (!this.ready()) return;
    const ctx = this.context as AudioContextLike;
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i += 1) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const start = now + i * 0.11;
      osc.frequency.setValueAtTime(2400 + i * 240, start);
      osc.frequency.exponentialRampToValueAtTime(1600, start + 0.07);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.08);
      osc.connect(gain);
      gain.connect(this.master as GainNodeLike);
      osc.start(start);
      osc.stop(start + 0.1);
    }
  }
}
