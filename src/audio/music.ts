/**
 * The music bus: procedural instrument primitives plus the seamless program
 * scheduler.
 *
 * An era's music is pure data — a {@link MusicProgramDescriptor} with a tempo, a
 * key, a grid, and one or more voices carrying an arrangement pattern. This
 * module turns that data into sound:
 *
 *  1. every note is rendered by one of the {@link INSTRUMENT_KINDS} primitives
 *     (oscillator stacks, filters, envelopes, FM, noise transients) into a short
 *     lived voice that stops and disconnects itself,
 *  2. the program's *device* (wireless set, jukebox, boombox, iPod, phone) shapes
 *     the whole bus through a bandwidth/tone/drive/hiss/flutter chain, and
 *  3. the scheduler walks the grid with a lookahead window, so the loop repeats
 *     exactly — every loop is planned from the same seed, which makes the music
 *     seamless *and* byte-for-byte reproducible across runs.
 *
 * The module never fetches or decodes audio: instruments are synthesised, and the
 * only sample data it uses are noise buffers generated in the browser.
 */

import {
  clamp,
  createAudioRandom,
  createAudioResourceBag,
  createNoiseBuffer,
  deriveSeed,
  scheduleRamp,
  SILENT_GAIN,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioResourceBag,
  type BiquadFilterTypeLike,
  type GainNodeLike,
  type OscillatorNodeLike,
  type StereoPannerNodeLike,
} from './types';
import {
  midiToFrequency,
  normalizeMusicProgram,
  resolvePitch,
  type InstrumentKind,
  type InstrumentSpec,
  type MusicProgramDescriptor,
  type MusicProgramInput,
  type ProgramVoice,
} from './program';

/* -------------------------------------------------------------------------- */
/* Instrument primitives                                                      */
/* -------------------------------------------------------------------------- */

interface PartialSpec {
  /** Frequency multiplier applied to the note's pitch. */
  readonly ratio: number;
  /** Level relative to the voice's peak. */
  readonly gain: number;
  readonly detuneCents: number;
}

interface NoiseTransientSpec {
  readonly level: number;
  readonly seconds: number;
  readonly filter: BiquadFilterTypeLike;
  /** Filter cutoff as a multiple of the instrument's brightness. */
  readonly hzScale: number;
  readonly q: number;
}

/**
 * The structural part of a primitive: which partials it stacks, how it is
 * filtered and which transients it adds. Numbers (attack, decay, brightness,
 * resonance, vibrato, detune) come from the {@link InstrumentSpec}, so a program
 * can retune a primitive without losing its character.
 */
export interface InstrumentShape {
  readonly partials: readonly PartialSpec[];
  readonly filter: BiquadFilterTypeLike;
  /** Multiplies the instrument's brightness to get the filter cutoff. */
  readonly filterScale: number;
  readonly noise?: NoiseTransientSpec;
  /** Frequency modulation applied to the first partial (bell-like tine, ...). */
  readonly fm?: { readonly ratio: number; readonly index: number; readonly decayScale: number };
  /** Pitch sweep at the start of the note (drum hits). */
  readonly pitchDrop?: { readonly fromRatio: number; readonly seconds: number };
  /** Struck or scraped sounds decay on their own instead of holding. */
  readonly percussive?: boolean;
}

/** Structural recipes of every procedural primitive. */
export const INSTRUMENT_SHAPES: Readonly<Record<InstrumentKind, InstrumentShape>> = {
  sine: { partials: [{ ratio: 1, gain: 1, detuneCents: 0 }], filter: 'lowpass', filterScale: 1 },
  triangle: { partials: [{ ratio: 1, gain: 1, detuneCents: 0 }], filter: 'lowpass', filterScale: 1 },
  square: { partials: [{ ratio: 1, gain: 1, detuneCents: 0 }], filter: 'lowpass', filterScale: 0.9 },
  sawtooth: { partials: [{ ratio: 1, gain: 1, detuneCents: 0 }], filter: 'lowpass', filterScale: 0.9 },
  pluck: {
    partials: [
      { ratio: 1, gain: 1, detuneCents: 0 },
      { ratio: 2, gain: 0.28, detuneCents: 5 },
      { ratio: 3, gain: 0.12, detuneCents: -6 },
    ],
    filter: 'lowpass',
    filterScale: 1.4,
    noise: { level: 0.16, seconds: 0.02, filter: 'bandpass', hzScale: 3.2, q: 0.8 },
  },
  harp: {
    partials: [
      { ratio: 1, gain: 1, detuneCents: 0 },
      { ratio: 2, gain: 0.32, detuneCents: 0 },
      { ratio: 4, gain: 0.1, detuneCents: 6 },
    ],
    filter: 'lowpass',
    filterScale: 1.7,
  },
  marimba: {
    partials: [
      { ratio: 1, gain: 1, detuneCents: 0 },
      { ratio: 4, gain: 0.22, detuneCents: 0 },
    ],
    filter: 'lowpass',
    filterScale: 2,
  },
  bell: {
    partials: [
      { ratio: 1, gain: 1, detuneCents: 0 },
      { ratio: 2.76, gain: 0.45, detuneCents: 4 },
      { ratio: 5.4, gain: 0.2, detuneCents: -6 },
      { ratio: 8.93, gain: 0.08, detuneCents: 8 },
    ],
    filter: 'lowpass',
    filterScale: 2.4,
  },
  'electric-piano': {
    partials: [
      { ratio: 1, gain: 1, detuneCents: 0 },
      { ratio: 2, gain: 0.18, detuneCents: 2 },
    ],
    filter: 'lowpass',
    filterScale: 1.6,
    fm: { ratio: 3.5, index: 0.4, decayScale: 0.25 },
  },
  reed: { partials: [{ ratio: 1, gain: 1, detuneCents: 0 }], filter: 'lowpass', filterScale: 1 },
  organ: {
    partials: [
      { ratio: 1, gain: 1, detuneCents: 0 },
      { ratio: 2, gain: 0.6, detuneCents: 0 },
      { ratio: 3, gain: 0.3, detuneCents: 0 },
      { ratio: 4, gain: 0.18, detuneCents: 0 },
    ],
    filter: 'lowpass',
    filterScale: 1.2,
  },
  strings: {
    partials: [
      { ratio: 1, gain: 1, detuneCents: -7 },
      { ratio: 1, gain: 0.9, detuneCents: 7 },
      { ratio: 2, gain: 0.24, detuneCents: 3 },
    ],
    filter: 'lowpass',
    filterScale: 0.95,
  },
  pad: {
    partials: [
      { ratio: 1, gain: 1, detuneCents: -11 },
      { ratio: 1, gain: 0.85, detuneCents: 12 },
      { ratio: 2, gain: 0.26, detuneCents: -5 },
    ],
    filter: 'lowpass',
    filterScale: 0.7,
  },
  lead: {
    partials: [
      { ratio: 1, gain: 1, detuneCents: 0 },
      { ratio: 1.005, gain: 0.7, detuneCents: 0 },
    ],
    filter: 'lowpass',
    filterScale: 1,
  },
  bass: {
    partials: [
      { ratio: 1, gain: 1, detuneCents: 0 },
      { ratio: 2, gain: 0.22, detuneCents: 0 },
    ],
    filter: 'lowpass',
    filterScale: 1,
  },
  sub: {
    partials: [
      { ratio: 1, gain: 1, detuneCents: 0 },
      { ratio: 0.5, gain: 0.4, detuneCents: 0 },
    ],
    filter: 'lowpass',
    filterScale: 1,
  },
  percussion: {
    partials: [{ ratio: 1, gain: 0.7, detuneCents: 0 }],
    filter: 'bandpass',
    filterScale: 1,
    noise: { level: 0.9, seconds: 0.14, filter: 'bandpass', hzScale: 1.8, q: 0.9 },
    percussive: true,
  },
  kick: {
    partials: [{ ratio: 1, gain: 1, detuneCents: 0 }],
    filter: 'lowpass',
    filterScale: 1,
    pitchDrop: { fromRatio: 3.4, seconds: 0.09 },
    noise: { level: 0.22, seconds: 0.012, filter: 'lowpass', hzScale: 4, q: 0.7 },
    percussive: true,
  },
  snare: {
    partials: [
      { ratio: 1, gain: 0.45, detuneCents: 0 },
      { ratio: 1.5, gain: 0.3, detuneCents: 4 },
    ],
    filter: 'bandpass',
    filterScale: 1.1,
    noise: { level: 1, seconds: 0.18, filter: 'bandpass', hzScale: 2.6, q: 0.7 },
    percussive: true,
  },
  'hi-hat': {
    partials: [
      { ratio: 4, gain: 0.2, detuneCents: 0 },
      { ratio: 6.2, gain: 0.16, detuneCents: 7 },
    ],
    filter: 'highpass',
    filterScale: 1.1,
    noise: { level: 1, seconds: 0.06, filter: 'highpass', hzScale: 0.55, q: 0.6 },
    percussive: true,
  },
};

/** Everything one note needs in order to be rendered. */
export interface InstrumentRenderRequest {
  readonly context: AudioContextLike;
  readonly destination: AudioNodeLike;
  /** Looping noise used by transients (and by noise-only primitives). */
  readonly noiseBuffer: AudioBufferLike;
  readonly instrument: InstrumentSpec;
  readonly frequency: number;
  /** Absolute context time the note starts at. */
  readonly time: number;
  readonly durationSeconds: number;
  readonly velocity: number;
  /** `0..1` amount of per-note variation applied with `random`. */
  readonly variation: number;
  readonly random: () => number;
  /** The context's `createStereoPanner` is used when available. */
  readonly pannerAvailable: boolean;
}

/** A note currently sounding; the scheduler reaps these when their tail ends. */
export interface InstrumentVoice {
  /** Absolute time the voice has fully decayed. */
  readonly endTime: number;
  /** Nodes this voice created (diagnostics and tests). */
  readonly nodeCount: number;
  readonly kind: InstrumentKind;
  /** Frequency actually rendered (after any variation). */
  readonly frequency: number;
  stop(when?: number): void;
  dispose(): void;
}

function createGain(bag: AudioResourceBag, context: AudioContextLike, value: number): GainNodeLike {
  const node = bag.node(context.createGain());
  node.gain.value = value;
  return node;
}

/**
 * Renders one note of one primitive into `destination` and returns the voice
 * handle. The envelope holds for the note's duration for sustaining primitives
 * and decays naturally for struck ones, which is what keeps a plucked string
 * from sounding like an organ.
 */
export function renderInstrumentNote(request: InstrumentRenderRequest): InstrumentVoice {
  const { context, destination, instrument } = request;
  const shape = INSTRUMENT_SHAPES[instrument.kind];
  const bag = createAudioResourceBag();
  const peakScale = clamp(
    instrument.gain * clamp(request.velocity, 0.02, 1.4),
    SILENT_GAIN * 10,
    4,
  );

  const voiceGain = createGain(bag, context, 0);
  let output: AudioNodeLike = voiceGain;
  let panner: StereoPannerNodeLike | null = null;
  if (request.pannerAvailable && typeof context.createStereoPanner === 'function') {
    panner = bag.node(context.createStereoPanner());
    const spread = clamp(instrument.pan + (request.random() - 0.5) * 0.3 * request.variation, -1, 1);
    panner.pan.value = spread;
    voiceGain.connect(panner);
    output = panner;
  }
  output.connect(destination);

  const attack = Math.max(instrument.attack, 0.0008);
  const decay = Math.max(instrument.decay, 0.004);
  const release = Math.max(instrument.release, 0.005);
  const sustaining = shape.percussive !== true && instrument.sustain > 0.05;
  const holdUntil = sustaining
    ? request.time + Math.max(request.durationSeconds, attack + decay)
    : request.time + attack + decay;
  const sustainPeak = Math.max(peakScale * instrument.sustain, SILENT_GAIN * 10);
  const endTime = holdUntil + release;

  const envelope = voiceGain.gain;
  envelope.cancelScheduledValues(request.time);
  envelope.setValueAtTime(0, request.time);
  envelope.linearRampToValueAtTime(peakScale, request.time + attack);
  if (sustaining) {
    const decayEnd = Math.min(request.time + attack + decay, holdUntil);
    envelope.linearRampToValueAtTime(sustainPeak, decayEnd);
    if (holdUntil > decayEnd) envelope.setValueAtTime(sustainPeak, holdUntil);
    envelope.exponentialRampToValueAtTime(SILENT_GAIN, endTime);
  } else {
    envelope.exponentialRampToValueAtTime(Math.max(peakScale * 0.02, SILENT_GAIN * 4), holdUntil);
    envelope.exponentialRampToValueAtTime(SILENT_GAIN, endTime);
  }

  /** Voices drive their partials through a shared filter into the envelope. */
  const filter = bag.node(context.createBiquadFilter());
  const cutoff = clamp(
    instrument.brightness * shape.filterScale * (0.55 + 0.45 * clamp(request.velocity, 0, 1.4)),
    40,
    19000,
  );
  filter.type = shape.filter;
  filter.frequency.value = cutoff;
  filter.Q.value = instrument.resonance;
  filter.connect(voiceGain);

  const oscillators: OscillatorNodeLike[] = [];
  shape.partials.forEach((partial, index) => {
    const oscillator = bag.node(context.createOscillator());
    const baseFrequency = clamp(request.frequency * partial.ratio, 8, 20000);
    oscillator.type = instrument.waveform;
    if (shape.pitchDrop && index === 0) {
      oscillator.frequency.setValueAtTime(
        clamp(baseFrequency * shape.pitchDrop.fromRatio, 8, 20000),
        request.time,
      );
      oscillator.frequency.exponentialRampToValueAtTime(
        baseFrequency,
        request.time + shape.pitchDrop.seconds,
      );
    } else {
      oscillator.frequency.value = baseFrequency;
    }
    oscillator.detune.value =
      instrument.detuneCents + partial.detuneCents + (request.random() - 0.5) * 6 * request.variation;
    const partialGain = createGain(bag, context, partial.gain);
    oscillator.connect(partialGain);
    partialGain.connect(filter);
    bag.startSource(oscillator, request.time);
    oscillator.stop(endTime + 0.02);
    oscillators.push(oscillator);
  });

  const carrier = oscillators[0];
  if (shape.fm && carrier) {
    const modulator = bag.node(context.createOscillator());
    modulator.type = 'sine';
    modulator.frequency.value = clamp(request.frequency * shape.fm.ratio, 8, 20000);
    const depth = createGain(bag, context, 0);
    depth.gain.setValueAtTime(
      clamp(request.frequency * shape.fm.index * clamp(request.velocity, 0.05, 1.4), 0.01, 8000),
      request.time,
    );
    depth.gain.exponentialRampToValueAtTime(
      Math.max(request.frequency * 0.002, 0.01),
      request.time + Math.max(decay * shape.fm.decayScale, 0.02),
    );
    modulator.connect(depth);
    depth.connect(carrier.frequency);
    bag.startSource(modulator, request.time);
    modulator.stop(endTime + 0.02);
  }

  if (instrument.vibratoHz > 0.01 && instrument.vibratoCents > 0.01) {
    const vibrato = bag.node(context.createOscillator());
    vibrato.type = 'sine';
    vibrato.frequency.value = instrument.vibratoHz;
    const depth = createGain(bag, context, instrument.vibratoCents);
    vibrato.connect(depth);
    for (const oscillator of oscillators) depth.connect(oscillator.detune);
    bag.startSource(vibrato, request.time + attack);
    vibrato.stop(endTime + 0.02);
  }

  if (shape.noise) {
    const noiseSource = bag.source(context.createBufferSource());
    noiseSource.buffer = request.noiseBuffer;
    noiseSource.loop = true;
    noiseSource.loopStart = 0;
    noiseSource.loopEnd = request.noiseBuffer.duration;
    const noiseFilter = bag.node(context.createBiquadFilter());
    noiseFilter.type = shape.noise.filter;
    noiseFilter.frequency.value = clamp(instrument.brightness * shape.noise.hzScale, 60, 19000);
    noiseFilter.Q.value = shape.noise.q;
    const noiseGain = createGain(bag, context, 0);
    const noisePeak = Math.max(peakScale * shape.noise.level, SILENT_GAIN * 10);
    const noiseEnd = request.time + shape.noise.seconds;
    const noiseEnvelope = noiseGain.gain;
    noiseEnvelope.setValueAtTime(0, request.time);
    noiseEnvelope.linearRampToValueAtTime(noisePeak, request.time + 0.0015);
    noiseEnvelope.exponentialRampToValueAtTime(SILENT_GAIN, noiseEnd);
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(voiceGain);
    noiseSource.start(request.time, request.random() * Math.max(request.noiseBuffer.duration - 0.01, 0));
    noiseSource.stop(noiseEnd + 0.02);
  }

  const voice: InstrumentVoice = {
    endTime,
    nodeCount: bag.size,
    kind: instrument.kind,
    frequency: clamp(request.frequency, 8, 20000),
    stop(when) {
      bag.stopAll(when);
    },
    dispose() {
      bag.stopAll();
      bag.disconnectAll();
    },
  };
  return voice;
}

/* -------------------------------------------------------------------------- */
/* Program scheduling                                                         */
/* -------------------------------------------------------------------------- */

/** One planned note onset of a program loop. */
export interface ScheduledMusicEvent {
  readonly voiceId: string;
  /** Grid step inside the loop. */
  readonly step: number;
  /** Loop number since the scheduler started. */
  readonly loop: number;
  readonly midi: number;
  readonly frequency: number;
  /** Absolute context time of the onset. */
  readonly time: number;
  readonly durationSeconds: number;
  readonly velocity: number;
  /** Voice level from the program. */
  readonly voiceGain: number;
}

export interface MusicSchedulerOptions {
  readonly context: AudioContextLike;
  /** Where the program's device chain output goes (the music bus input). */
  readonly destination: AudioNodeLike;
  readonly program: MusicProgramInput;
  /** Lookahead window in seconds (how far ahead of the clock notes are queued). */
  readonly lookaheadSeconds?: number;
  /** Absolute time the loop starts at. */
  readonly startTime?: number;
  /** Mix level of the program output, `0..2` (crossfades use this). */
  readonly level?: number;
  /** Called for every scheduled note; the engine uses it for its event log. */
  readonly onEvent?: (event: ScheduledMusicEvent) => void;
}

export interface MusicScheduler {
  readonly program: MusicProgramDescriptor;
  readonly loopDurationSeconds: number;
  readonly secondsPerStep: number;
  readonly level: number;
  /** Notes scheduled so far. */
  readonly scheduledCount: number;
  readonly activeVoiceCount: number;
  readonly disposed: boolean;
  /** Lookahead window used by {@link MusicScheduler.scheduleAhead}, in seconds. */
  readonly lookaheadSeconds: number;
  /** Output stage; the crossfade ramps this. */
  readonly output: GainNodeLike;
  /** Device chain input, where note voices arrive. */
  readonly voiceMix: GainNodeLike;
  /** The device tone chain, in order: highpass, lowpass, drive, flutter. */
  readonly deviceChain: readonly AudioNodeLike[];
  setLevel(value: number, seconds: number, now: number): number;
  /** Queues every note onset that falls inside `[cursor, untilTime)`. */
  scheduleAhead(untilTime: number): readonly ScheduledMusicEvent[];
  /** Plans one loop without scheduling it (deterministic; used by tests). */
  plan(loop?: number): readonly ScheduledMusicEvent[];
  /** Drops voices whose tail has finished; returns how many were released. */
  reap(now: number): number;
  /** Fades out and stops scheduling; {@link MusicScheduler.dispose} releases it. */
  stop(fadeSeconds: number, now: number): void;
  dispose(): void;
}

/** Upper bound on loops walked in one `scheduleAhead` call (safety net). */
const MAX_LOOPS_PER_CALL = 32;

/**
 * Builds a scheduler for one era program.
 *
 * Throws an {@link normalizeMusicProgram} validation error when the descriptor is
 * missing voices or carries bad values, so a malformed era table fails loudly
 * instead of quietly playing silence.
 */
export function createMusicScheduler(options: MusicSchedulerOptions): MusicScheduler {
  const program = normalizeMusicProgram(options.program, 'music program');
  const context = options.context;
  const resources = createAudioResourceBag();
  const seed = program.seed;
  const lookaheadSeconds = clamp(options.lookaheadSeconds ?? 0.5, 0.05, 4);
  const startTime = options.startTime ?? 0;
  const noiseBuffer = createProgramNoise(context, seed);

  const audibleVoices = program.voices.filter((voice) => !voice.mute && voice.pattern.length > 0);
  const voiceById = new Map<string, ProgramVoice>();
  program.voices.forEach((voice) => voiceById.set(voice.id, voice));

  /* -- device chain ------------------------------------------------------- */

  const voiceMix = resources.node(context.createGain());
  const highpass = resources.node(context.createBiquadFilter());
  const lowpass = resources.node(context.createBiquadFilter());
  const drive = resources.node(context.createDynamicsCompressor());
  const flutter = resources.node(context.createGain());
  const output = resources.node(context.createGain());

  voiceMix.gain.value = 1;
  highpass.type = 'highpass';
  highpass.frequency.value = program.device.lowHz;
  highpass.Q.value = program.device.resonance;
  lowpass.type = 'lowpass';
  lowpass.frequency.value = program.device.highHz;
  lowpass.Q.value = program.device.resonance;
  drive.threshold.value = program.device.drive > 0 ? -6 - 18 * program.device.drive : 0;
  drive.knee.value = 8;
  drive.ratio.value = 1 + 14 * program.device.drive;
  drive.attack.value = 0.008;
  drive.release.value = 0.25;
  flutter.gain.value = 1;

  let level = clamp(options.level ?? 1, 0, 2);
  output.gain.value = level;

  voiceMix.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(drive);
  drive.connect(flutter);
  flutter.connect(output);
  output.connect(options.destination);

  // Device noise floor: the wireless set's hiss, the jukebox's rumble.
  if (program.device.hiss > 0) {
    const hissSource = resources.source(context.createBufferSource());
    hissSource.buffer = noiseBuffer;
    hissSource.loop = true;
    hissSource.loopEnd = noiseBuffer.duration;
    const hissFilter = resources.node(context.createBiquadFilter());
    hissFilter.type = 'highpass';
    hissFilter.frequency.value = clamp(program.device.lowHz * 3, 200, 12000);
    const hissGain = resources.node(context.createGain());
    hissGain.gain.value = clamp(program.device.hiss * 0.05, 0, 0.2);
    hissSource.connect(hissFilter);
    hissFilter.connect(hissGain);
    hissGain.connect(output);
    hissSource.start(startTime, 0);
  }

  // Transport flutter: a jukebox or tape device that never ran perfectly true.
  if (program.device.wobble > 0) {
    const wobble = resources.node(context.createOscillator());
    wobble.type = 'sine';
    wobble.frequency.value = clamp(0.7 + program.device.wobble * 4, 0.5, 8);
    const depth = resources.node(context.createGain());
    depth.gain.value = clamp(program.device.wobble * 0.25, 0, 0.5);
    wobble.connect(depth);
    depth.connect(flutter.gain);
    wobble.start(startTime, 0);
  }

  /* -- scheduling state --------------------------------------------------- */

  const activeVoices: InstrumentVoice[] = [];
  let pendingLoop = 0;
  let pendingIndex = 0;
  let scheduledCount = 0;
  let stopping = false;
  let disposed = false;
  const planCache = new Map<number, readonly ScheduledMusicEvent[]>();

  function plan(loopIndex: number): readonly ScheduledMusicEvent[] {
    const target = Math.max(Math.trunc(loopIndex), 0);
    const cached = planCache.get(target);
    if (cached !== undefined) return cached;
    const loopStart = startTime + target * program.loopDurationSeconds;
    const events: ScheduledMusicEvent[] = [];
    audibleVoices.forEach((voice, voiceIndex) => {
      for (const step of voice.pattern) {
        const midi = resolvePitch(
          step.note,
          program.key,
          voice.octave + voice.instrument.octave,
        );
        if (midi === null) continue;
        // Every value derives from (seed, voice, loop, step): the same jitter in
        // every loop, identical across runs, independent of scheduling order.
        const random = createAudioRandom(deriveSeed(seed, voiceIndex + 1, target, step.step));
        const timing =
          (random() - 0.5) * 2 * voice.humanize * program.secondsPerStep * 0.18;
        const velocity = clamp(step.velocity * (1 - random() * 0.18 * voice.humanize), 0.02, 1);
        const swing = step.step % 2 === 1 ? program.swing * program.secondsPerStep * 0.5 : 0;
        const time = Math.max(
          loopStart + step.step * program.secondsPerStep + swing + timing,
          loopStart,
        );
        events.push({
          voiceId: voice.id,
          step: step.step,
          loop: target,
          midi,
          frequency: midiToFrequency(midi),
          time,
          durationSeconds: Math.max(step.durationSteps * program.secondsPerStep, 0.02),
          velocity,
          voiceGain: voice.gain,
        });
      }
    });
    events.sort((a, b) => a.time - b.time || a.step - b.step);
    if (planCache.size > 64) planCache.clear();
    planCache.set(target, events);
    return events;
  }

  function render(event: ScheduledMusicEvent): void {
    const voice = voiceById.get(event.voiceId);
    if (voice === undefined) return;
    const random = createAudioRandom(deriveSeed(seed, event.loop + 1, event.step, event.midi));
    const instrument: InstrumentSpec = voice.instrument;
    const rendered = renderInstrumentNote({
      context,
      destination: voiceMix,
      noiseBuffer,
      instrument,
      frequency: event.frequency,
      time: event.time,
      durationSeconds: event.durationSeconds,
      velocity: clamp(event.velocity * voice.gain, 0.02, 1.4),
      variation: voice.humanize,
      random,
      pannerAvailable: true,
    });
    activeVoices.push(rendered);
  }

  return {
    program,
    loopDurationSeconds: program.loopDurationSeconds,
    secondsPerStep: program.secondsPerStep,
    get level() {
      return level;
    },
    get scheduledCount() {
      return scheduledCount;
    },
    get activeVoiceCount() {
      return activeVoices.length;
    },
    get disposed() {
      return disposed;
    },
    output,
    voiceMix,
    deviceChain: [highpass, lowpass, drive, flutter],
    setLevel(value, seconds, now) {
      const target = clamp(value, 0, 2);
      const start = level;
      level = target;
      return scheduleRamp(output.gain, start, target, seconds, now);
    },
    scheduleAhead(untilTime) {
      const scheduled: ScheduledMusicEvent[] = [];
      if (disposed || stopping) return scheduled;
      const limit = Number.isFinite(untilTime) ? untilTime : startTime;
      for (let guard = 0; guard < MAX_LOOPS_PER_CALL; guard += 1) {
        const events = plan(pendingLoop);
        let windowClosed = false;
        for (let index = pendingIndex; index < events.length; index += 1) {
          const event = events[index];
          if (event === undefined) break;
          if (event.time >= limit) {
            windowClosed = true;
            break;
          }
          pendingIndex = index + 1;
          render(event);
          scheduled.push(event);
          options.onEvent?.(event);
        }
        if (windowClosed) break;
        pendingLoop += 1;
        pendingIndex = 0;
        if (startTime + pendingLoop * program.loopDurationSeconds >= limit) break;
      }
      scheduledCount += scheduled.length;
      return scheduled;
    },
    plan,
    reap(now) {
      let released = 0;
      for (let index = activeVoices.length - 1; index >= 0; index -= 1) {
        const voice = activeVoices[index];
        if (voice === undefined || voice.endTime > now) continue;
        voice.dispose();
        activeVoices.splice(index, 1);
        released += 1;
      }
      return released;
    },
    stop(fadeSeconds, now) {
      if (stopping || disposed) return;
      stopping = true;
      this.setLevel(0, fadeSeconds, now);
    },
    dispose() {
      if (disposed) return;
      stopping = true;
      disposed = true;
      for (const voice of activeVoices) voice.dispose();
      activeVoices.length = 0;
      resources.stopAll();
      resources.disconnectAll();
    },
    lookaheadSeconds,
  };
}

/** Noise used by the program's transients and device hiss. */
function createProgramNoise(context: AudioContextLike, seed: number): AudioBufferLike {
  return createNoiseBuffer(context, { seconds: 2, seed: deriveSeed(seed, 0x0de1), tilt: 0.75 });
}

/* Re-exported so ambience and machine SFX share one noise generator. */
export { createNoiseBuffer };
