/**
 * The mixer: three independent sub-buses, a shared reverb send, and the master
 * limiter that protects the summed output.
 *
 * ```
 *   sources ─▶ bus.input ─▶ bus.trim ─▶ bus.tone ─▶ bus.mute ─┬─▶ dry sum ─▶ reverb.dry ─┐
 *                                                              └─▶ bus.send ─▶ reverb.send ─┴─▶ limiter ─▶ master ─▶ destination
 * ```
 *
 * Every bus carries its own level (`trim`), tone (lowpass), mute and reverb send,
 * and every one of those moves is an automation ramp rather than a value jump, so
 * crossfading a program, fading a murmur bed or ducking the machine bus never
 * clicks. The limiter is a two stage safety net: a `DynamicsCompressorNode`
 * catches the instantaneous peaks of stacked one-shots, and a scheduled headroom
 * gain ducks the sum when the engine knows the summed bus levels exceed full
 * scale. That headroom value is readable (`reduction`) and observable in the
 * recorded automation, which is how the headless suite proves the stage works.
 */

import {
  clamp,
  clamp01,
  createAudioResourceBag,
  dbToGain,
  scheduleRamp,
  type AudioContextLike,
  type AudioNodeLike,
  type BiquadFilterNodeLike,
  type DynamicsCompressorNodeLike,
  type GainNodeLike,
} from './types';

/* -------------------------------------------------------------------------- */
/* Sub-buses                                                                  */
/* -------------------------------------------------------------------------- */

/** The three independently controlled sub-buses of the café mix. */
export const BUS_IDS = ['music', 'ambience', 'machine'] as const;

export type BusId = (typeof BUS_IDS)[number];

/** Where a bus delivers its signal. */
export interface BusDestinations {
  /** Dry mix point (the reverb unit's dry path). */
  readonly dry: AudioNodeLike;
  /** Reverb send input; omit to run the bus without a reverb send. */
  readonly reverb?: AudioNodeLike | null;
}

export interface BusOptions {
  /** Initial bus level. */
  readonly gain?: number;
  /** Initial reverb send amount. */
  readonly send?: number;
  /** Whether the bus starts muted. */
  readonly muted?: boolean;
  /** Initial tone lowpass cutoff, hertz. */
  readonly toneHz?: number;
}

export interface BusStrip {
  readonly id: BusId;
  /** Sources connect here. */
  readonly input: GainNodeLike;
  /** Bus level (set by the era mix or by hand). */
  readonly trim: GainNodeLike;
  /** Bus tone control: a lowpass on the whole bus. */
  readonly tone: BiquadFilterNodeLike;
  /** Mute stage: `1` when audible, `0` when muted. */
  readonly mute: GainNodeLike;
  /** Reverb send amount for this bus. */
  readonly send: GainNodeLike;
  /** End of the dry chain (same node as {@link BusStrip.mute}). */
  readonly output: GainNodeLike;
  readonly gainValue: number;
  readonly sendValue: number;
  readonly toneHz: number;
  readonly muted: boolean;
  setGain(value: number, seconds: number, now: number): number;
  setSend(value: number, seconds: number, now: number): number;
  setTone(hertz: number, seconds: number, now: number): number;
  setMute(muted: boolean, seconds: number, now: number): number;
  dispose(): void;
}

/**
 * Creates one bus: level, tone, mute and send, already wired to the dry mix and
 * (when provided) the reverb send input.
 */
export function createBusStrip(
  context: AudioContextLike,
  id: BusId,
  destinations: BusDestinations,
  options: BusOptions = {},
): BusStrip {
  const resources = createAudioResourceBag();
  const input = resources.node(context.createGain());
  const trim = resources.node(context.createGain());
  const tone = resources.node(context.createBiquadFilter());
  const mute = resources.node(context.createGain());
  const send = resources.node(context.createGain());

  tone.type = 'lowpass';
  let gainValue = clamp(options.gain ?? 1, 0, 4);
  let sendValue = clamp01(options.send ?? 0);
  let toneHz = clamp(options.toneHz ?? 12000, 80, 20000);
  let muted = options.muted === true;

  input.gain.value = 1;
  trim.gain.value = gainValue;
  tone.frequency.value = toneHz;
  tone.Q.value = 0.7;
  mute.gain.value = muted ? 0 : 1;
  send.gain.value = sendValue;

  input.connect(trim);
  trim.connect(tone);
  tone.connect(mute);
  mute.connect(destinations.dry);
  if (destinations.reverb) {
    mute.connect(send);
    send.connect(destinations.reverb);
  }

  return {
    id,
    input,
    trim,
    tone,
    mute,
    send,
    output: mute,
    get gainValue() {
      return gainValue;
    },
    get sendValue() {
      return sendValue;
    },
    get toneHz() {
      return toneHz;
    },
    get muted() {
      return muted;
    },
    setGain(value, seconds, now) {
      const target = clamp(value, 0, 4);
      const start = gainValue;
      gainValue = target;
      return scheduleRamp(trim.gain, start, target, seconds, now);
    },
    setSend(value, seconds, now) {
      const target = clamp01(value);
      const start = sendValue;
      sendValue = target;
      scheduleRamp(send.gain, start, target, seconds, now);
      return now;
    },
    setTone(hertz, seconds, now) {
      const target = clamp(hertz, 80, 20000);
      const start = toneHz;
      toneHz = target;
      tone.frequency.cancelScheduledValues(now);
      tone.frequency.setValueAtTime(start, now);
      if (seconds <= 0 || start === target) {
        tone.frequency.setValueAtTime(target, now);
        return now;
      }
      tone.frequency.exponentialRampToValueAtTime(target, now + seconds);
      return now + seconds;
    },
    setMute(next, seconds, now) {
      const target = next ? 0 : 1;
      if (target === (muted ? 0 : 1)) {
        muted = next;
        return now;
      }
      const start = muted ? 0 : 1;
      muted = next;
      return scheduleRamp(mute.gain, start, target, seconds, now);
    },
    dispose() {
      resources.disconnectAll();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Limiter                                                                    */
/* -------------------------------------------------------------------------- */

export interface LimiterOptions {
  /** Compressor threshold in decibels. */
  readonly thresholdDb?: number;
  readonly kneeDb?: number;
  readonly ratio?: number;
  readonly attackSeconds?: number;
  readonly releaseSeconds?: number;
  /** Lowest headroom gain the scheduled limiter will duck to. */
  readonly floor?: number;
  /** Time constant of the scheduled headroom duck. */
  readonly responseSeconds?: number;
}

export interface LimiterStage {
  /** Sum point where every bus arrives. */
  readonly input: GainNodeLike;
  readonly compressor: DynamicsCompressorNodeLike;
  /** Scheduled headroom gain, automatically ducked by {@link LimiterStage.limit}. */
  readonly gain: GainNodeLike;
  readonly output: GainNodeLike;
  /** Gain currently applied by {@link LimiterStage.limit} (`1` = untouched). */
  readonly reduction: number;
  readonly gainValue: number;
  /** Live reduction reported by the compressor itself, in decibels. */
  readonly compressorReduction: number;
  /**
   * Ducks the summed signal so `peakLevel` cannot pass full scale, and returns
   * the attenuation applied.
   */
  limit(peakLevel: number, now: number): number;
  /** Returns the headroom gain to unity. */
  reset(now: number): void;
  dispose(): void;
}

const LIMITER_DEFAULTS: Required<LimiterOptions> = {
  thresholdDb: -3,
  kneeDb: 3,
  ratio: 12,
  attackSeconds: 0.004,
  releaseSeconds: 0.18,
  floor: 0.35,
  responseSeconds: 0.06,
};

/** Builds the compressor plus scheduled headroom stage placed after the buses. */
export function createLimiterStage(
  context: AudioContextLike,
  options: LimiterOptions = {},
): LimiterStage {
  const settings = { ...LIMITER_DEFAULTS, ...options };
  const resources = createAudioResourceBag();
  const input = resources.node(context.createGain());
  const compressor = resources.node(context.createDynamicsCompressor());
  const gain = resources.node(context.createGain());
  const output = resources.node(context.createGain());

  compressor.threshold.value = settings.thresholdDb;
  compressor.knee.value = settings.kneeDb;
  compressor.ratio.value = settings.ratio;
  compressor.attack.value = settings.attackSeconds;
  compressor.release.value = settings.releaseSeconds;
  gain.gain.value = 1;
  output.gain.value = 1;

  input.connect(compressor);
  compressor.connect(gain);
  gain.connect(output);

  let reduction = 1;
  let gainValue = 1;

  return {
    input,
    compressor,
    gain,
    output,
    get reduction() {
      return reduction;
    },
    get gainValue() {
      return gainValue;
    },
    get compressorReduction() {
      return compressor.reduction;
    },
    limit(peakLevel, now) {
      const peak = Number.isFinite(peakLevel) ? Math.max(peakLevel, 0) : 0;
      const target = peak <= 1 ? 1 : Math.max(settings.floor, 1 / peak);
      if (target === reduction) return reduction;
      const previous = reduction;
      reduction = target;
      gainValue = target;
      scheduleRamp(gain.gain, previous, target, settings.responseSeconds, now);
      return target;
    },
    reset(now) {
      const previous = reduction;
      reduction = 1;
      gainValue = 1;
      scheduleRamp(gain.gain, previous, 1, settings.responseSeconds, now);
    },
    dispose() {
      resources.disconnectAll();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Master output                                                              */
/* -------------------------------------------------------------------------- */

export interface MasterOutputOptions extends LimiterOptions {
  /** Master level, `0..2`. */
  readonly level?: number;
}

export interface MasterOutput {
  /** Sum point where the reverb unit delivers its mixed output. */
  readonly input: GainNodeLike;
  readonly limiter: LimiterStage;
  /** Final master level, adjusted by the era mix. */
  readonly master: GainNodeLike;
  /** Same node as {@link MasterOutput.master}. */
  readonly output: GainNodeLike;
  readonly level: number;
  readonly reduction: number;
  readonly gainValue: number;
  setLevel(value: number, seconds: number, now: number): number;
  limit(peakLevel: number, now: number): number;
  reset(now: number): void;
  dispose(): void;
}

/**
 * Assembles `sum ─▶ limiter ─▶ master ─▶ destination`: the stage that guarantees
 * stacked machine one-shots plus music plus murmur cannot exceed full scale.
 */
export function createMasterOutput(
  context: AudioContextLike,
  destination: AudioNodeLike,
  options: MasterOutputOptions = {},
): MasterOutput {
  const limiter = createLimiterStage(context, options);
  const master = context.createGain();
  let level = clamp(options.level ?? 0.9, 0, 2);
  master.gain.value = level;
  limiter.output.connect(master);
  master.connect(destination);

  return {
    input: limiter.input,
    limiter,
    master,
    output: master,
    get level() {
      return level;
    },
    get reduction() {
      return limiter.reduction;
    },
    get gainValue() {
      return limiter.gainValue;
    },
    setLevel(value, seconds, now) {
      const target = clamp(value, 0, 2);
      const start = level;
      level = target;
      return scheduleRamp(master.gain, start, target, seconds, now);
    },
    limit(peakLevel, now) {
      return limiter.limit(peakLevel, now);
    },
    reset(now) {
      limiter.reset(now);
    },
    dispose() {
      limiter.dispose();
      try {
        master.disconnect();
      } catch {
        // Already disconnected.
      }
    },
  };
}

/** Converts a `0..1` era brightness value into a usable tone cutoff. */
export function brightnessToToneHz(brightness: number, min = 1200, max = 18000): number {
  return clamp(min + clamp01(brightness) * (max - min), min, max);
}

/** Linear-to-decibel helper re-exported for units that describe levels in dB. */
export { dbToGain };
