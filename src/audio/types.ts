/**
 * The Web Audio surface the café audio engine is written against.
 *
 * The engine never depends on a concrete `AudioContext` implementation. Every
 * node, parameter and buffer it needs is described by the small structural
 * interfaces below, which the browser classes satisfy as they are. Two
 * consequences follow:
 *
 *  - the complete graph can be built, scheduled and asserted inside vitest
 *    against an injected fake context, with no audio device and no DOM, and
 *  - `src/audio` stays free of browser-only assumptions and of any audio asset
 *    loading, because every sound is synthesised from oscillators, noise buffers
 *    and filters created through this surface.
 *
 * Alongside the node vocabulary this module owns the small numeric helpers
 * (clamping, decibel conversion), the seeded random source that makes every
 * schedule reproducible, and the {@link AudioResourceBag} used by every unit to
 * guarantee that `dispose()` really stops sources and disconnects nodes.
 */

/* -------------------------------------------------------------------------- */
/* Node vocabulary                                                            */
/* -------------------------------------------------------------------------- */

/** Context lifecycle as reported by the injected audio context. */
export type AudioContextStateLike = 'suspended' | 'running' | 'closed';

/** Oscillator wave shapes; mirrors the browser union without importing the DOM. */
export type OscillatorTypeLike = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'custom';

/** Biquad filter modes; mirrors the browser union without importing the DOM. */
export type BiquadFilterTypeLike =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'lowshelf'
  | 'highshelf'
  | 'peaking'
  | 'notch'
  | 'allpass';

/**
 * One automatable parameter. The setter methods are declared as returning
 * `void`: real `AudioParam` methods return the parameter itself, which is still
 * assignable here, and the engine never chains automation calls.
 */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  exponentialRampToValueAtTime(value: number, endTime: number): void;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): void;
  cancelScheduledValues(startTime: number): void;
}

/** Anything that can appear on either end of a graph connection. */
export interface AudioNodeLike {
  connect(
    destination: AudioNodeLike | AudioParamLike,
    outputIndex?: number,
    inputIndex?: number,
  ): AudioNodeLike;
  disconnect(destination?: AudioNodeLike | AudioParamLike): void;
}

/** A node that can be started and stopped (oscillators, buffer sources). */
export interface AudioScheduledSourceLike extends AudioNodeLike {
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

export interface OscillatorNodeLike extends AudioScheduledSourceLike {
  type: OscillatorTypeLike;
  frequency: AudioParamLike;
  detune: AudioParamLike;
}

export interface AudioBufferSourceNodeLike extends AudioScheduledSourceLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  playbackRate: AudioParamLike;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterTypeLike;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
  readonly gain: AudioParamLike;
}

export interface DelayNodeLike extends AudioNodeLike {
  readonly delayTime: AudioParamLike;
}

export interface ConvolverNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  normalize: boolean;
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
  /** Gain reduction currently applied, in decibels (negative when limiting). */
  readonly reduction: number;
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
}

/** Multi channel sample storage; only the members the engine uses. */
export interface AudioBufferLike {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * The minimum context surface the engine needs. A real `AudioContext` is
 * assignable to it; tests inject a recording fake. `createStereoPanner` is
 * optional so the engine can run on contexts without panning support.
 */
export interface AudioContextLike {
  readonly destination: AudioNodeLike;
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly state: AudioContextStateLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createDelay(maxDelayTime?: number): DelayNodeLike;
  createConvolver(): ConvolverNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  createDynamicsCompressor(): DynamicsCompressorNodeLike;
  createStereoPanner?(): StereoPannerNodeLike;
}

/**
 * Lazily creates the audio context. The engine calls the factory only from its
 * gesture-gated `unlock()`; returning `null` means the host has no audio
 * implementation and the engine stays locked.
 */
export type AudioContextLikeFactory = () => AudioContextLike | null;

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export type AudioEngineErrorCode =
  | 'no-context'
  | 'locked'
  | 'disposed'
  | 'descriptor'
  | 'unsupported'
  | 'graph';

/** Raised for engine level misuse (unlocking without a context, bad state, ...). */
export class AudioEngineError extends Error {
  readonly code: AudioEngineErrorCode;

  constructor(code: AudioEngineErrorCode, message: string) {
    super(message);
    this.name = 'AudioEngineError';
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/* Numeric helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Clamps `value` into `[min, max]`, mapping non finite input to `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Clamps `value` into `[0, 1]`. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Linear interpolation between `a` and `b`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/** Decibels to linear gain. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Linear gain to decibels (`0` maps to negative infinity territory). */
export function gainToDb(gain: number): number {
  return gain <= 0 ? -120 : 20 * Math.log10(gain);
}

/** Smallest non zero gain the engine ever schedules. */
export const SILENT_GAIN = 0.0001;

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Seedable mulberry32 generator returning values in `[0, 1)`. This is the same
 * generator the kernel exposes, re-declared locally so `src/audio` stays free of
 * the three.js dependency graph.
 */
export function createAudioRandom(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stable integer hash used to derive a per event seed from the engine seed and
 * the event coordinates. Deriving instead of drawing from one shared stream
 * makes each note, blip and one-shot reproducible no matter which other sounds
 * happen to be scheduled in between — the prerequisite for identical repeated
 * runs and for a loop that repeats exactly.
 */
export function deriveSeed(base: number, ...parts: readonly number[]): number {
  let hash = Math.trunc(base) >>> 0;
  for (const part of parts) {
    hash = (hash ^ (Math.trunc(part) >>> 0)) >>> 0;
    hash = Math.imul(hash, 0x2545f491) >>> 0;
    hash = (hash ^ (hash >>> 13)) >>> 0;
  }
  return hash >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Parameter automation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Schedules a click free move of `param` from `from` to `to`, taking `seconds`.
 * Exponential curves are used whenever both ends are audible (they match how
 * loudness is perceived); otherwise the move is linear, which is the only curve
 * Web Audio accepts for targets of zero. Returns the time the move completes.
 */
export function scheduleRamp(
  param: AudioParamLike,
  from: number,
  to: number,
  seconds: number,
  now: number,
): number {
  const start = Math.max(from, 0);
  const end = Math.max(to, 0);
  const duration = Math.max(seconds, 0);
  param.cancelScheduledValues(now);
  param.setValueAtTime(start, now);
  if (duration <= 0 || start === end) {
    param.setValueAtTime(end, now);
    return now;
  }
  const endTime = now + duration;
  if (start > 0 && end > 0) {
    param.exponentialRampToValueAtTime(end, endTime);
  } else {
    param.linearRampToValueAtTime(end, endTime);
  }
  return endTime;
}

/** Places `param` at `value` immediately (from `now`), cancelling pending moves. */
export function scheduleValue(param: AudioParamLike, value: number, now: number): number {
  param.cancelScheduledValues(now);
  param.setValueAtTime(Math.max(value, 0), now);
  return now;
}

/* -------------------------------------------------------------------------- */
/* Resource bookkeeping                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every node a unit creates is registered here, so `dispose()` can stop all
 * sources and disconnect all nodes without relying on the caller remembering
 * each one. Stopping a source twice is harmless: Web Audio throws for a repeated
 * `stop()`, so the bag swallows that error.
 */
export interface AudioResourceBag {
  readonly nodes: readonly AudioNodeLike[];
  readonly sources: readonly AudioScheduledSourceLike[];
  /** Number of registered nodes. */
  readonly size: number;
  /** Registers and returns a node. */
  node<T extends AudioNodeLike>(value: T): T;
  /** Registers a scheduled source (as a node and as a source). */
  source<T extends AudioScheduledSourceLike>(value: T): T;
  /** Registers `source`, starts it at `when` and returns it. */
  startSource<T extends AudioScheduledSourceLike>(source: T, when: number): T;
  /** Stops every registered source. Returns how many stops were attempted. */
  stopAll(when?: number): number;
  /** Disconnects every registered node and empties the bag. */
  disconnectAll(): number;
  /** Drops all registrations without touching the nodes. */
  clear(): void;
}

/** Creates a fresh resource bag. */
export function createAudioResourceBag(): AudioResourceBag {
  const nodes: AudioNodeLike[] = [];
  const sources: AudioScheduledSourceLike[] = [];

  const register = <T extends AudioNodeLike>(value: T): T => {
    nodes.push(value);
    return value;
  };
  const registerSource = <T extends AudioScheduledSourceLike>(value: T): T => {
    nodes.push(value);
    sources.push(value);
    return value;
  };

  return {
    get nodes() {
      return nodes;
    },
    get sources() {
      return sources;
    },
    get size() {
      return nodes.length;
    },
    node: register,
    source: registerSource,
    startSource(source, when) {
      registerSource(source);
      source.start(when);
      return source;
    },
    stopAll(when) {
      let count = 0;
      for (const source of sources) {
        try {
          source.stop(when);
        } catch {
          // Already stopped, or the context is closing: nothing to do.
        }
        count += 1;
      }
      return count;
    },
    disconnectAll() {
      let count = 0;
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // Already disconnected (or the context is gone): nothing to do.
        }
        count += 1;
      }
      nodes.length = 0;
      sources.length = 0;
      return count;
    },
    clear() {
      nodes.length = 0;
      sources.length = 0;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Noise synthesis                                                            */
/* -------------------------------------------------------------------------- */

export interface NoiseBufferOptions {
  /** Buffer length in seconds. */
  readonly seconds?: number;
  readonly seed?: number;
  readonly channels?: number;
  /**
   * Spectral tilt: `1` is white noise, `0` is brown; the murmur beds, machine
   * hiss and room tone all sit somewhere in between.
   */
  readonly tilt?: number;
  /** Overall sample level, kept below 1 so summed noise never clips. */
  readonly level?: number;
}

/**
 * Generates a looping noise buffer — the raw material for every noise based
 * sound in the café: murmur beds, espresso hiss, steam, grinder burrs, muffled
 * cup impacts and the reverb tail's diffuse field. Deterministic for a seed, so
 * the same engine seed always produces the same noise floor.
 */
export function createNoiseBuffer(
  context: AudioContextLike,
  options: NoiseBufferOptions = {},
): AudioBufferLike {
  const seconds = clamp(options.seconds ?? 2, 0.02, 30);
  const channels = Math.round(clamp(options.channels ?? 1, 1, 4));
  const tilt = clamp01(options.tilt ?? 0.6);
  const level = clamp(options.level ?? 0.9, 0, 4);
  const sampleRate = context.sampleRate > 0 ? context.sampleRate : 48000;
  const length = Math.max(1, Math.round(seconds * sampleRate));
  const buffer = context.createBuffer(channels, length, sampleRate);

  for (let channel = 0; channel < channels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    const random = createAudioRandom(deriveSeed(options.seed ?? 0x11ea, channel + 1));
    // Paul Kellet's economy pink noise filter, blended with white by `tilt`.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let index = 0; index < length; index += 1) {
      const white = random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      samples[index] = (pink * (1 - tilt) + white * tilt) * level;
    }
  }

  return buffer;
}

/* -------------------------------------------------------------------------- */
/* Browser context factory                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Default factory: creates a real `AudioContext` the first time the engine is
 * unlocked. It is deliberately lazy and reads the constructor off `globalThis`,
 * so importing `src/audio` never touches the audio device (and never breaks the
 * Node test run).
 */
export function createBrowserAudioContextFactory(): AudioContextLikeFactory {
  return () => {
    const scope = globalThis as {
      AudioContext?: new () => unknown;
      webkitAudioContext?: new () => unknown;
    };
    const Constructor = scope.AudioContext ?? scope.webkitAudioContext;
    if (typeof Constructor !== 'function') return null;
    try {
      return new Constructor() as AudioContextLike;
    } catch {
      return null;
    }
  };
}

/** Structural guard for injected contexts, used by tests and diagnostics. */
export function isAudioContextLike(value: unknown): value is AudioContextLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['resume'] === 'function' &&
    typeof candidate['suspend'] === 'function' &&
    typeof candidate['close'] === 'function' &&
    typeof candidate['createGain'] === 'function' &&
    typeof candidate['createOscillator'] === 'function' &&
    typeof candidate['createBiquadFilter'] === 'function' &&
    typeof candidate['createBuffer'] === 'function' &&
    typeof candidate['sampleRate'] === 'number'
  );
}
