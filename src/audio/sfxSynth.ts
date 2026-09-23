/**
 * Chrono City — synthesized sound-effect library.
 *
 * Every cue in the experience is *built* at play time from Web Audio
 * primitives: oscillators, seeded-noise buffers, biquad filters and `AudioParam`
 * envelopes. There are no audio files, no network fetches and no decode step,
 * which keeps the app self-contained and keeps a cue re-voiceable from data
 * rather than from assets.
 *
 * Lifecycle:
 *   create    → `createSfxLibrary()` builds the six era-neutral cue definitions
 *               plus the shared primitives (`createNoiseBuffer`,
 *               `scheduleEnvelope`, `connectSeries`, `startVoice`) used by them.
 *   consume   → `AudioDirector.registerCues()` registers the definitions and
 *               calls `render()` for each play, handing the cue a destination
 *               node to connect its chain into.
 *   integrate → later content tasks (era soundscapes and music beds) register
 *               their own `CueDefinition`s through the same contract.
 *
 * Cue definitions never touch buses, listener state or distance rolloff: the
 * director owns routing, gain staging and spatialisation, so a cue only has to
 * describe *what it sounds like*.
 */

import { clamp01 } from '../core/eraContracts';
import { createSeededRng } from '../core/sceneContext';

export const SFX_SYNTH_VERSION = 1;

/* ------------------------------------------------------------------------- *
 * Buses
 * ------------------------------------------------------------------------- */

/** Every bus the mixer exposes; only `master` is a terminal bus. */
export const AUDIO_BUS_NAMES = ['master', 'sfx', 'music', 'ambience'] as const;

/** A mixer bus name. */
export type AudioBusName = (typeof AUDIO_BUS_NAMES)[number];

/** Buses a cue can be routed through (everything except the terminal master). */
export type CueBusName = Exclude<AudioBusName, 'master'>;

/** The non-terminal buses, in mixer order. */
export const CUE_BUS_NAMES: readonly CueBusName[] = ['sfx', 'music', 'ambience'];

/** Bus used when a cue definition does not name one. */
export const DEFAULT_CUE_BUS: CueBusName = 'sfx';

/** Narrows an unknown value to `AudioBusName`. */
export function isAudioBusName(value: unknown): value is AudioBusName {
  return typeof value === 'string' && (AUDIO_BUS_NAMES as readonly string[]).includes(value);
}

/** Throws a descriptive error when `value` is not a known bus. */
export function assertBusName(value: unknown): AudioBusName {
  if (!isAudioBusName(value)) {
    throw new RangeError(
      `Unknown audio bus ${String(value)}; expected one of ${AUDIO_BUS_NAMES.join(', ')}.`,
    );
  }
  return value;
}

/** Narrows an unknown value to a cue bus (i.e. not `master`). */
export function isCueBusName(value: unknown): value is CueBusName {
  return value === 'sfx' || value === 'music' || value === 'ambience';
}

/** Small numeric clamp shared by every voice. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/* ------------------------------------------------------------------------- *
 * Cue contract
 * ------------------------------------------------------------------------- */

/**
 * Everything a cue needs in order to synthesize one voice.
 *
 * `output` is already routed to the correct bus (and, for positional voices,
 * through the emitter panner), so a cue only connects its own chain into it.
 */
export interface CueSynthContext {
  /** Live audio context the cue must create its nodes on. */
  readonly context: BaseAudioContext;
  /** Node the cue chain terminates into (the director's per-voice gain stage). */
  readonly output: AudioNode;
  /** Audio-context time the voice starts at. */
  readonly time: number;
  /** Requested musical gain, baked into the cue's own levels. */
  readonly gain: number;
  /** Rate/pitch multiplier (vehicles and crowds vary it per instance). */
  readonly rate: number;
  /** Deterministic seed for this voice's noise and jitter. */
  readonly seed: number;
  /** `true` when the caller asked for a sustained, looped voice. */
  readonly loop: boolean;
}

/** A live synthesized voice. */
export interface SynthVoice {
  /** Every node the cue created, for introspection/teardown. */
  readonly nodes: readonly AudioNode[];
  /** Source whose `ended` event marks the natural end of the voice. */
  readonly endSignal: AudioScheduledSourceNode | null;
  /** `true` when the voice has no scheduled end. */
  readonly loop: boolean;
  /** Stops every source of the voice (idempotent). */
  stop(when?: number): void;
}

/**
 * A registered cue.
 *
 * Cues are pure descriptions: the same definition renders many concurrent
 * voices, each on its own nodes, so a cue set is registered once and played
 * repeatedly by vehicles, pedestrians, shops and the HUD.
 */
export interface CueDefinition {
  /** Registry key, e.g. `'horn'`. */
  readonly name: string;
  /** Bus the cue plays through unless the caller overrides it. */
  readonly bus: CueBusName;
  /** Nominal length in seconds (used for scheduling and diagnostics). */
  readonly duration: number;
  /** `true` when the cue is meant to sustain until explicitly stopped. */
  readonly loop: boolean;
  /** `true` when the cue sounds better with 3D positioning. */
  readonly positional: boolean;
  /** Free-form labels used by content tasks to pick cues by role. */
  readonly tags: readonly string[];
  /** Synthesizes one voice and connects it into `synth.output`. */
  render(synth: CueSynthContext): SynthVoice;
}

/* ------------------------------------------------------------------------- *
 * Graph helpers
 * ------------------------------------------------------------------------- */

/** A connection target: a node, or an `AudioParam` (modulation). */
export type ConnectableNode = AudioNode | AudioParam;

function isAudioNode(value: ConnectableNode): value is AudioNode {
  return typeof (value as AudioNode).connect === 'function';
}

/**
 * Connects two graph endpoints. The cast is required because `AudioNode.connect`
 * is overloaded per target type; the runtime contract (`connect(nodeOrParam)`)
 * is identical for both.
 */
function connectEndpoint(from: AudioNode, to: ConnectableNode): void {
  (from.connect as (destination: ConnectableNode) => unknown)(to);
}

/**
 * Connects a linear chain and returns its tail: `connectSeries([a, b, c])`
 * makes `a → b → c` and returns `c`. An `AudioParam` may only end a chain.
 */
export function connectSeries(nodes: readonly ConnectableNode[]): ConnectableNode {
  const head = nodes[0];
  if (!head) throw new RangeError('connectSeries() needs at least one node.');
  let current: ConnectableNode = head;
  for (let index = 1; index < nodes.length; index += 1) {
    const next = nodes[index] as ConnectableNode;
    if (!isAudioNode(current)) break; // a param cannot feed anything else
    connectEndpoint(current, next);
    current = next;
  }
  return current;
}

function safeStart(source: AudioScheduledSourceNode, when: number): void {
  try {
    source.start(Math.max(0, when));
  } catch (error) {
    // Starting an already-started source is a no-op we never want to surface.
    void error;
  }
}

function safeStop(source: AudioScheduledSourceNode, when?: number): void {
  try {
    if (when === undefined) source.stop();
    else source.stop(Math.max(0, when));
  } catch (error) {
    void error;
  }
}

/** Everything needed to start a voice's sources and track its lifetime. */
export interface VoiceBuild {
  /** Nodes the cue created (defaults to the sources). */
  readonly nodes?: readonly AudioNode[];
  /** Sources to start (and stop) together. */
  readonly sources: readonly AudioScheduledSourceNode[];
  /** Audio-context time the sources start at. */
  readonly start: number;
  /** Audio-context time the sources stop at; omit for sustaining voices. */
  readonly stopAt?: number;
  /** Node whose `ended` event ends the voice (defaults to the first source). */
  readonly endSignal?: AudioScheduledSourceNode | null;
}

/** Starts a voice's sources and returns its handle. */
export function startVoice(build: VoiceBuild): SynthVoice {
  const { sources, start, stopAt } = build;
  for (const source of sources) safeStart(source, start);
  if (stopAt !== undefined) {
    for (const source of sources) safeStop(source, stopAt);
  }
  return {
    nodes: build.nodes ?? sources,
    endSignal: build.endSignal ?? (sources.length > 0 ? sources[0] : null),
    loop: stopAt === undefined,
    stop(when?: number): void {
      for (const source of sources) safeStop(source, when);
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Noise
 * ------------------------------------------------------------------------- */

export interface NoiseOptions {
  /** Buffer length in seconds. Defaults to `1`. */
  readonly seconds?: number;
  /** Deterministic seed. Defaults to `1`. */
  readonly seed?: number;
  /** Channel count. Defaults to `1` (mono noise is spatially panned later). */
  readonly channels?: number;
}

/** Milliseconds of head/tail taper applied to looping noise buffers. */
const NOISE_TAPER_SECONDS = 0.006;

const noiseCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/**
 * Creates (and caches) a deterministic white-noise buffer.
 *
 * Noise is the backbone of the traffic, footstep, click and whoosh cues. The
 * samples come from the shared seeded generator so a given seed always produces
 * the same texture — useful for reproducible screenshots *and* audio captures —
 * and a short head/tail taper keeps looped beds from clicking at the wrap point.
 */
export function createNoiseBuffer(context: BaseAudioContext, options: NoiseOptions = {}): AudioBuffer {
  const seconds = Math.max(0.01, options.seconds ?? 1);
  const channels = Math.max(1, Math.floor(options.channels ?? 1));
  const seed = Math.trunc(options.seed ?? 1);
  const sampleRate = Math.max(8000, Math.trunc(context.sampleRate || 44100));
  const key = `${seconds}|${channels}|${seed}|${sampleRate}`;

  let cache = noiseCache.get(context);
  if (!cache) {
    cache = new Map<string, AudioBuffer>();
    noiseCache.set(context, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;

  const length = Math.max(1, Math.ceil(seconds * sampleRate));
  const buffer = context.createBuffer(channels, length, sampleRate);
  const rng = createSeededRng(seed === 0 ? 1 : seed);
  const taper = Math.min(Math.round(sampleRate * NOISE_TAPER_SECONDS), Math.floor(length / 4));

  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      data[index] = rng.float(-1, 1);
    }
    for (let index = 0; index < taper; index += 1) {
      const gainIn = index / taper;
      const gainOut = (taper - index) / taper;
      data[index] = (data[index] as number) * gainIn;
      data[length - 1 - index] = (data[length - 1 - index] as number) * gainOut;
    }
  }

  cache.set(key, buffer);
  return buffer;
}

/* ------------------------------------------------------------------------- *
 * Envelopes
 * ------------------------------------------------------------------------- */

export interface EnvelopeOptions {
  /** Audio-context time the envelope starts at. Defaults to `0`. */
  readonly time?: number;
  /** Seconds from silence to peak. Defaults to `0.01`. */
  readonly attack?: number;
  /** Seconds held at peak before the decay starts. Defaults to `0`. */
  readonly hold?: number;
  /** Seconds the decay takes down to the sustain level. Defaults to `0`. */
  readonly decay?: number;
  /** Level held after the decay, as a fraction of the peak. Defaults to `1`. */
  readonly sustain?: number;
  /** Seconds from the sustain level down to the floor. Defaults to `0.2`. */
  readonly release?: number;
  /**
   * Total envelope length in seconds. When given it takes precedence over
   * `hold`, so callers can voice a cue by its musical length.
   */
  readonly duration?: number;
  /** Peak level. Defaults to `1`. */
  readonly peak?: number;
  /** Level the envelope rests at; exponential ramps cannot reach `0`. Defaults to `0.0001`. */
  readonly floor?: number;
}

/** Absolute times of one scheduled envelope, in audio-context seconds. */
export interface EnvelopeSchedule {
  /** Envelope start. */
  readonly start: number;
  /** Moment the attack lands on the peak. */
  readonly attackEnd: number;
  /** Moment the hold ends and the decay begins. */
  readonly holdEnd: number;
  /** Moment the decay lands on the sustain level (the release begins here). */
  readonly releaseStart: number;
  /** Moment the release lands on the floor. */
  readonly end: number;
  /** Peak level the envelope reached. */
  readonly peak: number;
  /** Resting level the envelope returns to. */
  readonly floor: number;
  /** Sustain level (absolute). */
  readonly sustain: number;
}

/**
 * Schedules a percussion-friendly A/HD/R envelope on an `AudioParam`.
 *
 * Exponential ramps are used for the decay and release because they match how
 * physical sounds lose energy; both therefore target `floor` rather than `0`.
 * The partial-flat layout (a linear attack, then exponential fall) is what gives
 * the cue set its percussive edge without a single sample file.
 */
export function scheduleEnvelope(param: AudioParam, options: EnvelopeOptions = {}): EnvelopeSchedule {
  const start = Math.max(0, options.time ?? 0);
  const floor = Math.max(0, options.floor ?? 0.0001);
  const peak = Math.max(floor, options.peak ?? 1);
  const attack = Math.max(0.0005, options.attack ?? 0.01);
  const release = Math.max(0.0005, options.release ?? 0.2);
  const decay = Math.max(0, options.decay ?? 0);
  const sustainRatio = clamp01(options.sustain ?? 1);
  const sustain = Math.max(floor, peak * sustainRatio);
  const requestedDuration = options.duration;
  const hold =
    requestedDuration === undefined
      ? Math.max(0, options.hold ?? 0)
      : Math.max(0, requestedDuration - attack - decay - release);

  const attackEnd = start + attack;
  const holdEnd = attackEnd + hold;
  const releaseStart = holdEnd + decay;
  const end = releaseStart + release;

  param.cancelScheduledValues(start);
  param.setValueAtTime(floor, start);
  param.linearRampToValueAtTime(peak, attackEnd);
  if (decay > 0 && sustainRatio < 1) {
    param.exponentialRampToValueAtTime(sustain, releaseStart);
  }
  param.exponentialRampToValueAtTime(floor, end);

  return { start, attackEnd, holdEnd, releaseStart, end, peak, floor, sustain };
}

/* ------------------------------------------------------------------------- *
 * The cue set
 * ------------------------------------------------------------------------- */

/** Canonical cue names of the built-in set. */
export const SFX_CUE_NAMES = [
  'traffic',
  'horn',
  'footsteps',
  'shop-bell',
  'ui-click',
  'era-whoosh',
] as const;

/** Name of a built-in cue. */
export type SfxCueName = (typeof SFX_CUE_NAMES)[number];

export const TRAFFIC_CUE: SfxCueName = 'traffic';
export const HORN_CUE: SfxCueName = 'horn';
export const FOOTSTEP_CUE: SfxCueName = 'footsteps';
export const SHOP_BELL_CUE: SfxCueName = 'shop-bell';
export const UI_CLICK_CUE: SfxCueName = 'ui-click';
export const ERA_WHOOSH_CUE: SfxCueName = 'era-whoosh';

/**
 * Bus routing for the built-in set. Traffic is the era-neutral city bed and
 * lives on `ambience` (it loops under everything else); every one-shot effect
 * fires through `sfx`; `music` is reserved for the era soundscape task.
 */
export const SFX_CUE_BUSES: Readonly<Record<SfxCueName, CueBusName>> = Object.freeze({
  traffic: 'ambience',
  horn: 'sfx',
  footsteps: 'sfx',
  'shop-bell': 'sfx',
  'ui-click': 'sfx',
  'era-whoosh': 'sfx',
});

/**
 * Forgiving aliases so call sites can say `horns`, `bells` or
 * `era-transition` and still hit the canonical registry entry.
 */
export const SFX_CUE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  horns: 'horn',
  'car-horn': 'horn',
  honk: 'horn',
  'shop-bells': 'shop-bell',
  bells: 'shop-bell',
  'door-bell': 'shop-bell',
  footstep: 'footsteps',
  steps: 'footsteps',
  walking: 'footsteps',
  clicks: 'ui-click',
  'ui-clicks': 'ui-click',
  click: 'ui-click',
  whoosh: 'era-whoosh',
  'era-transition': 'era-whoosh',
  'era-transition-whoosh': 'era-whoosh',
});

/** Resolves a cue alias (or returns the name unchanged). */
export function resolveCueAlias(name: string): string {
  const key = typeof name === 'string' ? name.trim() : '';
  return SFX_CUE_ALIASES[key] ?? key;
}

/** Bus a built-in cue name (or alias) belongs on. */
export function sfxCueBus(name: string): CueBusName {
  const resolved = resolveCueAlias(name) as SfxCueName;
  return SFX_CUE_BUSES[resolved] ?? DEFAULT_CUE_BUS;
}

const TRAFFIC_LOOP_SECONDS = 4;

/**
 * City traffic: a low-passed noise bed with a sub-bass rumble and a slow swell.
 * Looping and positional, so radiating vehicles can share it.
 */
export function createTrafficCue(): CueDefinition {
  return {
    name: TRAFFIC_CUE,
    bus: SFX_CUE_BUSES.traffic,
    duration: TRAFFIC_LOOP_SECONDS,
    loop: true,
    positional: true,
    tags: ['ambience', 'traffic', 'loop'],
    render({ context, output, time, gain, rate, seed }) {
      const speed = clamp(rate, 0.5, 2);

      const noise = context.createBufferSource();
      noise.buffer = createNoiseBuffer(context, { seconds: TRAFFIC_LOOP_SECONDS, seed });
      noise.loop = true;
      noise.playbackRate.value = speed;

      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 420 * speed;
      lowpass.Q.value = 0.6;

      const body = context.createGain();
      body.gain.value = 0.34 * gain;

      const rumble = context.createOscillator();
      rumble.type = 'sawtooth';
      rumble.frequency.value = 38 * speed;

      const rumbleGain = context.createGain();
      rumbleGain.gain.value = 0.12 * gain;

      // Slow swell: an LFO modulating the bed's body keeps the loop alive.
      const motion = context.createOscillator();
      motion.type = 'sine';
      motion.frequency.value = 0.14;
      const motionDepth = context.createGain();
      motionDepth.gain.value = 0.12 * gain;
      connectSeries([motion, motionDepth, body.gain]);

      connectSeries([noise, lowpass, body, output]);
      connectSeries([rumble, rumbleGain, body]);

      return startVoice({
        nodes: [noise, lowpass, body, rumble, rumbleGain, motion, motionDepth],
        sources: [noise, rumble, motion],
        start: time,
      });
    },
  };
}

/**
 * Car horn: two stacked tones (a square fundamental and a slightly sharp saw)
 * shaped by a band-pass and a fast-attack/hold/release envelope.
 */
export function createHornCue(): CueDefinition {
  return {
    name: HORN_CUE,
    bus: SFX_CUE_BUSES.horn,
    duration: 1.1,
    loop: false,
    positional: true,
    tags: ['traffic', 'vehicle', 'one-shot'],
    render({ context, output, time, gain, rate }) {
      const pitch = clamp(rate, 0.5, 2);

      const low = context.createOscillator();
      low.type = 'square';
      low.frequency.value = 246 * pitch;
      const lowGain = context.createGain();
      lowGain.gain.value = 0.5 * gain;

      const high = context.createOscillator();
      high.type = 'sawtooth';
      high.frequency.value = 311 * pitch;
      high.detune.value = 7;
      const highGain = context.createGain();
      highGain.gain.value = 0.3 * gain;

      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 540 * pitch;
      band.Q.value = 0.85;

      const shape = context.createGain();
      shape.gain.value = 0;
      const envelope = scheduleEnvelope(shape.gain, {
        time,
        attack: 0.035,
        hold: 0.3,
        decay: 0.12,
        sustain: 0.72,
        release: 0.55,
        peak: 1,
      });

      connectSeries([low, lowGain, band]);
      connectSeries([high, highGain, band]);
      connectSeries([band, shape, output]);

      return startVoice({
        nodes: [low, lowGain, high, highGain, band, shape],
        sources: [low, high],
        start: time,
        stopAt: envelope.end,
        endSignal: low,
      });
    },
  };
}

/** Two pavement footsteps, each a filtered noise burst over a small low thump. */
export function createFootstepCue(): CueDefinition {
  const stepOffsets = [0, 0.42];
  const stepLength = 0.18;

  return {
    name: FOOTSTEP_CUE,
    bus: SFX_CUE_BUSES.footsteps,
    duration: 0.95,
    loop: false,
    positional: true,
    tags: ['crowd', 'pedestrian', 'one-shot'],
    render({ context, output, time, gain, rate, seed }) {
      const pace = clamp(rate, 0.5, 2);
      const nodes: AudioNode[] = [];

      stepOffsets.forEach((offset, index) => {
        const strike = time + offset;

        const noise = context.createBufferSource();
        noise.buffer = createNoiseBuffer(context, {
          seconds: stepLength,
          seed: seed + index * 977,
        });

        const band = context.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = (index === 0 ? 1050 : 1460) * pace;
        band.Q.value = 1.3;

        const step = context.createGain();
        step.gain.value = 0;
        scheduleEnvelope(step.gain, {
          time: strike,
          attack: 0.004,
          decay: 0.02,
          sustain: 0.4,
          release: 0.13,
          peak: (index === 0 ? 0.5 : 0.42) * gain,
        });

        const thump = context.createOscillator();
        thump.type = 'sine';
        thump.frequency.value = (index === 0 ? 88 : 74) * pace;
        const thumpGain = context.createGain();
        thumpGain.gain.value = 0;
        scheduleEnvelope(thumpGain.gain, {
          time: strike,
          attack: 0.006,
          release: 0.12,
          peak: 0.18 * gain,
        });

        connectSeries([noise, band, step, output]);
        connectSeries([thump, thumpGain, output]);

        nodes.push(noise, band, step, thump, thumpGain);
      });

      const sources = nodes.filter(
        (node): node is AudioScheduledSourceNode =>
          typeof (node as AudioScheduledSourceNode).start === 'function',
      );

      return startVoice({
        nodes,
        sources,
        start: time,
        stopAt: time + 0.95,
        endSignal: sources[0] ?? null,
      });
    },
  };
}

interface BellStrikeOptions {
  readonly context: BaseAudioContext;
  readonly output: AudioNode;
  readonly time: number;
  readonly frequency: number;
  readonly gain: number;
  readonly duration: number;
}

/** One FM bell strike: a sine carrier whose frequency is modulated by a partial. */
function renderBellStrike(options: BellStrikeOptions): AudioNode[] {
  const { context, output, time, frequency, gain, duration } = options;

  const carrier = context.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = frequency;

  const modulator = context.createOscillator();
  modulator.type = 'sine';
  modulator.frequency.value = frequency * 2.76;
  const index = context.createGain();
  index.gain.value = frequency * 1.4;
  connectSeries([modulator, index, carrier.frequency]);

  const shape = context.createGain();
  shape.gain.value = 0;
  const envelope = scheduleEnvelope(shape.gain, {
    time,
    attack: 0.002,
    decay: duration * 0.55,
    sustain: 0.08,
    release: duration * 0.45,
    peak: gain,
  });

  connectSeries([carrier, shape, output]);

  safeStart(carrier, time);
  safeStart(modulator, time);
  safeStop(carrier, envelope.end);
  safeStop(modulator, envelope.end);

  return [carrier, modulator, index, shape];
}

/** Shop door chime: a two-strike FM bell with the classic falling second tone. */
export function createShopBellCue(): CueDefinition {
  const firstStrike = 1180;
  const secondStrike = 1568;

  return {
    name: SHOP_BELL_CUE,
    bus: SFX_CUE_BUSES['shop-bell'],
    duration: 1.9,
    loop: false,
    positional: true,
    tags: ['shop', 'interior', 'one-shot'],
    render({ context, output, time, gain, rate }) {
      const pitch = clamp(rate, 0.6, 1.8);

      const nodes = renderBellStrike({
        context,
        output,
        time,
        frequency: firstStrike * pitch,
        gain: 0.42 * gain,
        duration: 1.7,
      });
      nodes.push(
        ...renderBellStrike({
          context,
          output,
          time: time + 0.16,
          frequency: secondStrike * pitch,
          gain: 0.3 * gain,
          duration: 1.5,
        }),
      );

      const sources = nodes.filter(
        (node): node is AudioScheduledSourceNode =>
          typeof (node as AudioScheduledSourceNode).start === 'function',
      );

      return startVoice({
        nodes,
        sources,
        start: time,
        stopAt: time + 1.9,
        endSignal: sources[0] ?? null,
      });
    },
  };
}

/** HUD click: a high-passed noise tick with a tiny square blip on top. */
export function createUiClickCue(): CueDefinition {
  return {
    name: UI_CLICK_CUE,
    bus: SFX_CUE_BUSES['ui-click'],
    duration: 0.16,
    loop: false,
    positional: false,
    tags: ['ui', 'one-shot'],
    render({ context, output, time, gain, seed }) {
      const noise = context.createBufferSource();
      noise.buffer = createNoiseBuffer(context, { seconds: 0.06, seed });

      const highpass = context.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 1900;
      highpass.Q.value = 0.7;

      const tick = context.createGain();
      tick.gain.value = 0;
      const envelope = scheduleEnvelope(tick.gain, {
        time,
        attack: 0.001,
        decay: 0.006,
        sustain: 0.3,
        release: 0.045,
        peak: 0.34 * gain,
      });

      const blip = context.createOscillator();
      blip.type = 'square';
      blip.frequency.value = 1850;
      const blipGain = context.createGain();
      blipGain.gain.value = 0;
      const blipEnvelope = scheduleEnvelope(blipGain.gain, {
        time,
        attack: 0.0006,
        release: 0.04,
        peak: 0.1 * gain,
      });

      connectSeries([noise, highpass, tick, output]);
      connectSeries([blip, blipGain, output]);

      return startVoice({
        nodes: [noise, highpass, tick, blip, blipGain],
        sources: [noise, blip],
        start: time,
        stopAt: Math.max(envelope.end, blipEnvelope.end),
        endSignal: noise,
      });
    },
  };
}

/**
 * Era-transition whoosh: a band-passed noise sweep paired with a rising-then-
 * falling sine, straddling the tween so the timeline crossfade has an audible
 * seam.
 */
export function createEraWhooshCue(): CueDefinition {
  const sweepStart = 180;
  const sweepPeak = 4200;
  const sweepEnd = 260;

  return {
    name: ERA_WHOOSH_CUE,
    bus: SFX_CUE_BUSES['era-whoosh'],
    duration: 1.8,
    loop: false,
    positional: false,
    tags: ['era', 'transition', 'one-shot'],
    render({ context, output, time, gain, rate, seed }) {
      const pitch = clamp(rate, 0.5, 2);
      const rise = 1.0;

      const noise = context.createBufferSource();
      noise.buffer = createNoiseBuffer(context, { seconds: 2.2, seed });
      noise.playbackRate.value = pitch;

      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 1.2;
      band.frequency.setValueAtTime(sweepStart * pitch, time);
      band.frequency.exponentialRampToValueAtTime(sweepPeak * pitch, time + rise);
      band.frequency.exponentialRampToValueAtTime(sweepEnd * pitch, time + 1.7);

      const shape = context.createGain();
      shape.gain.value = 0;
      const envelope = scheduleEnvelope(shape.gain, {
        time,
        attack: 0.45,
        decay: 0.4,
        sustain: 0.75,
        release: 0.55,
        peak: 0.62 * gain,
      });

      const sweep = context.createOscillator();
      sweep.type = 'sine';
      sweep.frequency.setValueAtTime(70 * pitch, time);
      sweep.frequency.exponentialRampToValueAtTime(900 * pitch, time + rise);
      sweep.frequency.exponentialRampToValueAtTime(150 * pitch, time + 1.7);
      const sweepGain = context.createGain();
      sweepGain.gain.value = 0.22 * gain;

      connectSeries([noise, band, shape, output]);
      connectSeries([sweep, sweepGain, shape]);

      return startVoice({
        nodes: [noise, band, shape, sweep, sweepGain],
        sources: [noise, sweep],
        start: time,
        stopAt: Math.max(envelope.end, time + 1.75),
        endSignal: noise,
      });
    },
  };
}

/** Builds the six era-neutral cues of the base sound set. */
export function createSfxLibrary(): readonly CueDefinition[] {
  return Object.freeze([
    createTrafficCue(),
    createHornCue(),
    createFootstepCue(),
    createShopBellCue(),
    createUiClickCue(),
    createEraWhooshCue(),
  ]);
}

/** The base sound set keyed by canonical cue name. */
export function createSfxCueMap(): Readonly<Record<SfxCueName, CueDefinition>> {
  return Object.freeze({
    traffic: createTrafficCue(),
    horn: createHornCue(),
    footsteps: createFootstepCue(),
    'shop-bell': createShopBellCue(),
    'ui-click': createUiClickCue(),
    'era-whoosh': createEraWhooshCue(),
  });
}
