/**
 * The machine-SFX bus: parameterised coffee-machine one-shots.
 *
 * Every sound the machine makes is a recipe driven by the era's
 * {@link MachineCharacterDescriptor}, so a 1945 percolator, a 1965 lever machine,
 * an 1985 semi-automatic, a 2005 super-automatic and a 2025 multi-group machine
 * with a contactless reader are audibly different without any of them being
 * hard-coded here:
 *
 * | one-shot | what it is | what the era character changes |
 * | --- | --- | --- |
 * | `extraction` | espresso hiss / percolation | archetype (bubbles, pump pulses, motor, second group), hiss band, click |
 * | `steamPurge` | steam wand purge | hiss band, burst length, pressure rise, sputter chatter |
 * | `grinder` | burr run | burr frequency and Q, motor tone, wobble, pitch jitter |
 * | `cupClatter` | cup and saucer clatter | material tonality, piece count, ring and decay times |
 * | `milkKnock` | milk pitcher knock | knock pitch, decay, steam tail |
 * | `till` | till drawer and beep | whether the era has one at all, mechanical vs contactless |
 *
 * Each trigger randomises pitch, duration and level from a seed derived from the
 * trigger index, so repeated runs produce identical sequences while consecutive
 * hits never sound mechanically identical.
 */

import {
  clamp,
  clamp01,
  createAudioRandom,
  createAudioResourceBag,
  createNoiseBuffer,
  deriveSeed,
  scheduleRamp,
  SILENT_GAIN,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioResourceBag,
  type BiquadFilterNodeLike,
  type BiquadFilterTypeLike,
  type GainNodeLike,
  type OscillatorNodeLike,
  type OscillatorTypeLike,
} from './types';
import {
  normalizeMachineCharacter,
  type ClatterMaterial,
  type MachineArchetype,
  type MachineCharacterDescriptor,
  type MachineCharacterInput,
} from './program';

/* -------------------------------------------------------------------------- */
/* Trigger vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/** The parameterised one-shots the machine bus exposes. */
export const MACHINE_SFX_KINDS = [
  'extraction',
  'steamPurge',
  'grinder',
  'cupClatter',
  'milkKnock',
  'till',
] as const;

export type MachineSfxKind = (typeof MACHINE_SFX_KINDS)[number];

/** Per trigger randomisation knobs; every field defaults to a seeded value. */
export interface MachineTriggerOptions {
  /** Strike strength, `0..1`. */
  readonly velocity?: number;
  /** Pitch multiplier applied to the recipe's centre frequencies. */
  readonly pitch?: number;
  /** Duration multiplier. */
  readonly duration?: number;
  /** Extra level multiplier. */
  readonly level?: number;
  /** Absolute time override (defaults to the clock the caller passes). */
  readonly at?: number;
  /** Explicit randomisation seed, replacing the derived one. */
  readonly seed?: number;
}

/** What a trigger actually did — logged by the engine and asserted in tests. */
export interface MachineTriggerRecord {
  readonly kind: MachineSfxKind;
  readonly year: MachineCharacterDescriptor['year'];
  readonly archetype: MachineArchetype;
  readonly material: ClatterMaterial;
  readonly time: number;
  readonly durationSeconds: number;
  readonly velocity: number;
  readonly pitchFactor: number;
  readonly durationFactor: number;
  readonly levelFactor: number;
  readonly level: number;
  readonly seed: number;
  /** Nodes the one-shot created. */
  readonly nodes: number;
  /** `false` when the era's character provides no such sound (silence). */
  readonly emitted: boolean;
  /** Index of this trigger since the unit was created. */
  readonly index: number;
}

export interface MachineSfxOptions {
  readonly context: AudioContextLike;
  /** Where one-shots arrive (the machine bus input). */
  readonly destination: AudioNodeLike;
  /** The era's machine character; required — there is no era-neutral default. */
  readonly character: MachineCharacterInput;
  /** Base seed for per-trigger randomisation. */
  readonly seed?: number;
  /** Starting bus-facing level, `0..2`. */
  readonly level?: number;
  /** Called for every trigger; the engine uses it for its event log. */
  readonly onTrigger?: (record: MachineTriggerRecord) => void;
}

interface OneShotVoice {
  readonly startTime: number;
  readonly endTime: number;
  readonly level: number;
  dispose(): void;
}

export interface MachineSfx {
  readonly character: MachineCharacterDescriptor;
  /** Bus-facing level stage (crossfaded by the engine). */
  readonly level: number;
  readonly output: GainNodeLike;
  readonly triggerCount: number;
  readonly activeOneShotCount: number;
  readonly disposed: boolean;
  /** Replaces the era character for all following triggers. */
  setCharacter(character: MachineCharacterInput): void;
  setLevel(value: number, seconds: number, now: number): number;
  /** Fire one one-shot; returns the record describing exactly what was emitted. */
  trigger(
    kind: MachineSfxKind,
    options?: MachineTriggerOptions,
    now?: number,
  ): MachineTriggerRecord;
  /**
   * Estimated *summed* level of the one-shots currently sounding, for the master
   * limiter's headroom calculation: simultaneous one-shots really do add up in
   * the mix, so the estimate adds their decaying peaks together.
   */
  pendingLevel(now: number): number;
  /** Releases finished one-shots; returns how many were released. */
  reap(now: number): number;
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Node helpers                                                               */
/* -------------------------------------------------------------------------- */

function gainNode(context: AudioContextLike, bag: AudioResourceBag, value: number): GainNodeLike {
  const node = bag.node(context.createGain());
  node.gain.value = value;
  return node;
}

function filterNode(
  context: AudioContextLike,
  bag: AudioResourceBag,
  type: BiquadFilterTypeLike,
  hertz: number,
  q: number,
): BiquadFilterNodeLike {
  const node = bag.node(context.createBiquadFilter());
  node.type = type;
  node.frequency.value = clamp(hertz, 20, 19000);
  node.Q.value = clamp(q, 0.05, 30);
  return node;
}

function toneNode(
  context: AudioContextLike,
  bag: AudioResourceBag,
  type: OscillatorTypeLike,
  hertz: number,
  time: number,
  stopTime: number,
): OscillatorNodeLike {
  const node = bag.node(context.createOscillator());
  node.type = type;
  node.frequency.value = clamp(hertz, 8, 19000);
  bag.startSource(node, time);
  node.stop(stopTime);
  return node;
}

function noiseNode(
  context: AudioContextLike,
  bag: AudioResourceBag,
  buffer: AudioBufferLike,
  time: number,
  offset: number,
  stopTime: number,
): AudioBufferSourceNodeLike {
  const node = bag.source(context.createBufferSource());
  node.buffer = buffer;
  node.loop = true;
  node.loopStart = 0;
  node.loopEnd = buffer.duration;
  const span = Math.max(buffer.duration - 0.02, 0.001);
  node.start(time, clamp(offset, 0, span));
  node.stop(stopTime);
  return node;
}

interface EnvelopeHandle {
  readonly gain: GainNodeLike;
  readonly endTime: number;
}

/**
 * Attack → hold → release envelope on a fresh gain node. Used by every one-shot
 * so machine sounds grow and die instead of switching on and off.
 */
function envelope(
  context: AudioContextLike,
  bag: AudioResourceBag,
  time: number,
  peak: number,
  attackSeconds: number,
  holdSeconds: number,
  releaseSeconds: number,
): EnvelopeHandle {
  const node = gainNode(context, bag, 0);
  const attack = Math.max(attackSeconds, 0.0015);
  const release = Math.max(releaseSeconds, 0.01);
  const holdUntil = time + Math.max(holdSeconds, attack);
  const endTime = holdUntil + release;
  const safePeak = Math.max(peak, SILENT_GAIN * 10);
  const param = node.gain;
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(safePeak, time + attack);
  param.setValueAtTime(safePeak, holdUntil);
  param.exponentialRampToValueAtTime(SILENT_GAIN, endTime);
  return { gain: node, endTime };
}

/* -------------------------------------------------------------------------- */
/* Era character → synthesis behaviour                                        */
/* -------------------------------------------------------------------------- */

/** How each archetype colours the extraction sound. */
export interface ArchetypeBehaviour {
  /** Multiplier on the extraction hiss level. */
  readonly noiseLevel: number;
  readonly attack: number;
  /** Percolator bubbling (falls back to a default rate when unexplained). */
  readonly bubbles: boolean;
  /** Pump pulse rate used when the character does not specify one. */
  readonly pumpHz: number;
  readonly pumpDepth: number;
  /** Whether a motor tone sits under the hiss (super-automatic). */
  readonly motor: boolean;
  /** Whether a second group pulls a shot slightly later (multi-group). */
  readonly secondGroup: boolean;
  readonly clickLevel: number;
  /** Spread of the second group's start, seconds. */
  readonly secondGroupDelay: number;
}

export const ARCHETYPE_BEHAVIOUR: Readonly<Record<MachineArchetype, ArchetypeBehaviour>> = {
  percolator: { noiseLevel: 0.5, attack: 0.06, bubbles: true, pumpHz: 0, pumpDepth: 0, motor: false, secondGroup: false, clickLevel: 0.5, secondGroupDelay: 0 },
  lever: { noiseLevel: 1.15, attack: 0.008, bubbles: false, pumpHz: 0, pumpDepth: 0, motor: false, secondGroup: false, clickLevel: 1.4, secondGroupDelay: 0 },
  'semi-automatic': { noiseLevel: 1, attack: 0.03, bubbles: false, pumpHz: 1.3, pumpDepth: 0.35, motor: false, secondGroup: false, clickLevel: 0.9, secondGroupDelay: 0 },
  'super-automatic': { noiseLevel: 0.8, attack: 0.02, bubbles: false, pumpHz: 0, pumpDepth: 0, motor: true, secondGroup: false, clickLevel: 1.1, secondGroupDelay: 0 },
  'multi-group': { noiseLevel: 0.95, attack: 0.02, bubbles: false, pumpHz: 1.1, pumpDepth: 0.22, motor: false, secondGroup: true, clickLevel: 1, secondGroupDelay: 0.25 },
  manual: { noiseLevel: 0.8, attack: 0.02, bubbles: false, pumpHz: 0, pumpDepth: 0, motor: false, secondGroup: false, clickLevel: 1, secondGroupDelay: 0 },
};

/** Tonality of each cup material: ring ratio, decay scale and brightness. */
export const CLATTER_TONALITY: Readonly<
  Record<ClatterMaterial, { readonly ringRatio: number; readonly decayScale: number; readonly brightness: number }>
> = {
  porcelain: { ringRatio: 1, decayScale: 1.2, brightness: 1.15 },
  china: { ringRatio: 0.92, decayScale: 0.95, brightness: 1 },
  'heavy-china': { ringRatio: 0.78, decayScale: 0.8, brightness: 0.85 },
  glass: { ringRatio: 1.35, decayScale: 1.35, brightness: 1.25 },
  ceramic: { ringRatio: 0.85, decayScale: 0.85, brightness: 0.9 },
  paper: { ringRatio: 0.6, decayScale: 0.35, brightness: 0.55 },
  steel: { ringRatio: 1.6, decayScale: 1.6, brightness: 1.35 },
};

/**
 * A character descriptor plus the node a one-shot's voices connect to: the
 * unit's level stage. Builders see the era character and their routing in one
 * place instead of threading both through every helper call.
 */
export type RoutedMachineCharacter = MachineCharacterDescriptor & {
  readonly outputTarget: AudioNodeLike;
};

/** Context handed to every one-shot builder. */
interface TriggerContext {
  readonly context: AudioContextLike;
  readonly noise: AudioBufferLike;
  readonly character: RoutedMachineCharacter;
  readonly random: () => number;
  /** Absolute start time of the one-shot. */
  readonly time: number;
  readonly pitchFactor: number;
  readonly durationFactor: number;
  /** Velocity × explicit level multiplier. */
  readonly strength: number;
}

interface TriggerResult {
  readonly endTime: number;
  readonly emitted: boolean;
  /** Nodes the one-shot created, or `null` when nothing was emitted. */
  readonly bag: AudioResourceBag | null;
  /** Peak level reached, used for the limiter's headroom estimate. */
  readonly peak: number;
}

/* -------------------------------------------------------------------------- */
/* One-shot builders                                                          */
/* -------------------------------------------------------------------------- */

function buildExtraction(trigger: TriggerContext): TriggerResult {
  const { context, noise, character, random, time } = trigger;
  const profile = character.extraction;
  const behaviour = ARCHETYPE_BEHAVIOUR[profile.archetype];
  const bag = createAudioResourceBag();
  const duration = clamp(profile.durationSeconds * trigger.durationFactor, 0.05, 30);
  const level = clamp(
    profile.level * behaviour.noiseLevel * trigger.strength,
    SILENT_GAIN * 10,
    4,
  );
  const hiss = envelope(context, bag, time, level, behaviour.attack, duration, 0.16);
  hiss.gain.connect(character.outputTarget);
  const hissBand = filterNode(
    context,
    bag,
    'bandpass',
    profile.noiseHz * trigger.pitchFactor,
    0.7 + profile.noiseQ * 0.5,
  );
  hissBand.connect(hiss.gain);
  noiseNode(
    context,
    bag,
    noise,
    time,
    random() * 1.5,
    hiss.endTime + 0.05,
  ).connect(hissBand);
  // Brightness tilts the band second time round, giving each era a different hiss colour.
  const tiltBand = filterNode(
    context,
    bag,
    'peaking',
    clamp(profile.toneHz * (0.6 + profile.brightness), 60, 12000),
    0.8,
  );
  tiltBand.gain.value = clamp((profile.brightness - 0.5) * 12, -12, 12);
  hissBand.connect(tiltBand);
  tiltBand.connect(hiss.gain);

  let endTime = hiss.endTime;

  // Pump pulses: the rhythm of a semi-automatic machine pulling a shot.
  const pumpHz = profile.pumpHz > 0 ? profile.pumpHz : behaviour.pumpHz;
  const pumpDepth = profile.pumpDepth > 0 ? profile.pumpDepth : behaviour.pumpDepth;
  if (pumpHz > 0 && pumpDepth > 0) {
    const lfo = toneNode(context, bag, 'sine', pumpHz, time, hiss.endTime + 0.05);
    const depth = gainNode(context, bag, 0);
    depth.gain.value = clamp(level * pumpDepth * 0.7, 0, 4);
    lfo.connect(depth);
    depth.connect(hiss.gain.gain);
  }

  // Motor tone under the hiss of a super-automatic.
  if (behaviour.motor) {
    const motor = toneNode(
      context,
      bag,
      'sawtooth',
      clamp(profile.toneHz * 0.22, 25, 220) * trigger.pitchFactor,
      time,
      hiss.endTime + 0.05,
    );
    const motorFilter = filterNode(context, bag, 'lowpass', 900, 1.2);
    const motorGain = gainNode(context, bag, clamp(level * 0.28, 0, 4));
    motor.connect(motorFilter);
    motorFilter.connect(motorGain);
    motorGain.connect(hiss.gain);
  }

  // Second group pulling a shot slightly later (multi-group machines).
  if (behaviour.secondGroup) {
    const delay = behaviour.secondGroupDelay;
    const second = envelope(context, bag, time + delay, level * 0.8, behaviour.attack, Math.max(duration - delay, 0.1), 0.16);
    second.gain.connect(character.outputTarget);
    const secondBand = filterNode(
      context,
      bag,
      'bandpass',
      profile.noiseHz * trigger.pitchFactor * 1.06,
      0.7 + profile.noiseQ * 0.5,
    );
    secondBand.connect(second.gain);
    noiseNode(context, bag, noise, time + delay, random() * 1.5, second.endTime + 0.05).connect(secondBand);
    endTime = Math.max(endTime, second.endTime);
  }

  // Percolator bubbles: repeated short rising blips through the extraction.
  const bubbleRate =
    profile.bubbleRate > 0 ? profile.bubbleRate : behaviour.bubbles ? 6 : 0;
  if (bubbleRate > 0) {
    const count = Math.max(1, Math.round(clamp(bubbleRate * duration, 1, 64)));
    for (let index = 0; index < count; index += 1) {
      const bubbleTime = time + (index / count) * duration * (0.15 + random() * 0.85);
      const bubbleHz = clamp(
        (180 + random() * 240) * trigger.pitchFactor,
        60,
        2400,
      );
      const bubbleTone = toneNode(context, bag, 'sine', bubbleHz, bubbleTime, bubbleTime + 0.12);
      bubbleTone.frequency.exponentialRampToValueAtTime(
        clamp(bubbleHz * (1.5 + random() * 0.8), 60, 3600),
        bubbleTime + 0.08,
      );
      const bubbleEnvelope = envelope(context, bag, bubbleTime, level * 0.9, 0.002, 0.02, 0.06);
      bubbleEnvelope.gain.connect(character.outputTarget);
      bubbleTone.connect(bubbleEnvelope.gain);
      endTime = Math.max(endTime, bubbleEnvelope.endTime);
    }
  }

  // Solenoid, lever or portafilter knock.
  const clickLevel = profile.clickLevel * behaviour.clickLevel;
  if (clickLevel > 0.001) {
    const clickTime = time + 0.005;
    const thud = toneNode(
      context,
      bag,
      'triangle',
      clamp(profile.toneHz * 0.35 * trigger.pitchFactor, 40, 900),
      clickTime,
      clickTime + 0.12,
    );
    thud.frequency.exponentialRampToValueAtTime(
      clamp(profile.toneHz * 0.18, 30, 600),
      clickTime + 0.09,
    );
    const clickEnvelope = envelope(
      context,
      bag,
      clickTime,
      level * clickLevel * 1.1,
      0.0015,
      0.008,
      0.05,
    );
    clickEnvelope.gain.connect(character.outputTarget);
    thud.connect(clickEnvelope.gain);
    const clickNoise = filterNode(context, bag, 'bandpass', 1800 * trigger.pitchFactor, 1.1);
    clickNoise.connect(clickEnvelope.gain);
    noiseNode(context, bag, noise, clickTime, random() * 1.5, clickEnvelope.endTime + 0.03).connect(clickNoise);
    endTime = Math.max(endTime, clickEnvelope.endTime);
  }

  return finish(bag, level, endTime);
}

function buildSteamPurge(trigger: TriggerContext): TriggerResult {
  const { context, noise, character, random, time } = trigger;
  const profile = character.steam;
  const bag = createAudioResourceBag();
  const burst = clamp(profile.burstSeconds * trigger.durationFactor, 0.05, 20);
  const peak = clamp(profile.level * trigger.strength, SILENT_GAIN * 10, 4);

  const output = gainNode(context, bag, 1);
  output.connect(character.outputTarget);
  const param = output.gain;
  const rise = clamp(profile.pressureRise, 0, 1);
  const attack = 0.03;
  const holdUntil = time + burst;
  const endTime = holdUntil + 0.18;
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(Math.max(peak * (1 - rise * 0.55), SILENT_GAIN * 10), time + attack);
  param.linearRampToValueAtTime(peak, time + attack + burst * 0.45);
  param.setValueAtTime(peak, holdUntil);
  param.exponentialRampToValueAtTime(SILENT_GAIN, endTime);

  const hiss = filterNode(
    context,
    bag,
    'highpass',
    profile.hissHz * trigger.pitchFactor,
    0.5 + profile.hissQ * 0.5,
  );
  hiss.connect(output);
  noiseNode(context, bag, noise, time, random() * 1.5, endTime + 0.05).connect(hiss);

  // Sputtering wand: chatter modulates the hiss level.
  if (profile.chatterHz > 0) {
    const chatter = toneNode(context, bag, 'square', profile.chatterHz, time, endTime + 0.05);
    const depth = gainNode(context, bag, 0);
    depth.gain.value = clamp(peak * 0.35, 0, 4);
    chatter.connect(depth);
    depth.connect(param);
  }

  return finish(bag, peak, endTime);
}

function buildGrinder(trigger: TriggerContext): TriggerResult {
  const { context, noise, character, random, time } = trigger;
  const profile = character.grinder;
  const bag = createAudioResourceBag();
  const duration = clamp(profile.durationSeconds * trigger.durationFactor, 0.05, 30);
  const peak = clamp(profile.level * trigger.strength, SILENT_GAIN * 10, 4);
  const jitter = 1 + (random() - 0.5) * 2 * profile.pitchJitter;

  const burr = envelope(context, bag, time, peak, 0.05, duration, 0.14);
  burr.gain.connect(character.outputTarget);
  const burrBand = filterNode(
    context,
    bag,
    'bandpass',
    profile.burrHz * trigger.pitchFactor * jitter,
    profile.burrQ,
  );
  burrBand.connect(burr.gain);
  noiseNode(context, bag, noise, time, random() * 1.5, burr.endTime + 0.05).connect(burrBand);

  // Burr wobble: an uneven load on the motor.
  if (profile.wobbleHz > 0 && profile.wobbleDepth > 0) {
    const wobble = toneNode(context, bag, 'sine', profile.wobbleHz, time, burr.endTime + 0.05);
    const depth = gainNode(context, bag, 0);
    depth.gain.value = clamp(
      (profile.burrHz * trigger.pitchFactor * 0.25) * profile.wobbleDepth,
      1,
      6000,
    );
    wobble.connect(depth);
    depth.connect(burrBand.frequency);
  }

  let endTime = burr.endTime;

  if (profile.motorHz > 0) {
    const motor = toneNode(
      context,
      bag,
      'sawtooth',
      profile.motorHz * trigger.pitchFactor,
      time,
      burr.endTime + 0.05,
    );
    const motorFilter = filterNode(context, bag, 'lowpass', 420, 1.4);
    const motorGain = gainNode(context, bag, clamp(peak * 0.4, 0, 4));
    motor.connect(motorFilter);
    motorFilter.connect(motorGain);
    motorGain.connect(burr.gain);
  }

  return finish(bag, peak, endTime);
}

function buildCupClatter(trigger: TriggerContext): TriggerResult {
  const { context, noise, character, random, time } = trigger;
  const profile = character.clatter;
  const tonality = CLATTER_TONALITY[profile.material];
  const bag = createAudioResourceBag();
  const bus = gainNode(context, bag, 1);
  bus.connect(character.outputTarget);
  const peak = clamp(
    profile.level * trigger.strength * (0.85 + random() * 0.3),
    SILENT_GAIN * 10,
    4,
  );

  let endTime = time;
  const pieces = Math.max(1, Math.round(profile.pieces));
  for (let index = 0; index < pieces; index += 1) {
    const spread =
      pieces > 1
        ? (index / (pieces - 1)) * profile.spreadSeconds * (0.6 + random() * 0.8) * trigger.durationFactor
        : 0;
    const pieceTime = time + spread;
    const ringHz = clamp(
      profile.ringHz * tonality.ringRatio * trigger.pitchFactor * (0.85 + random() * 0.3),
      120,
      16000,
    );
    const ringDecay = clamp(
      profile.ringDecaySeconds * tonality.decayScale * (0.7 + random() * 0.6) * trigger.durationFactor,
      0.01,
      6,
    );
    const pieceGain = clamp(peak * (0.7 + random() * 0.5), SILENT_GAIN * 10, 4);

    const clickEnvelope = envelope(
      context,
      bag,
      pieceTime,
      pieceGain,
      0.0015,
      0.003,
      profile.decaySeconds * tonality.decayScale * 0.6,
    );
    clickEnvelope.gain.connect(bus);
    const clickBand = filterNode(
      context,
      bag,
      'bandpass',
      ringHz * tonality.brightness,
      1.1,
    );
    clickBand.connect(clickEnvelope.gain);
    noiseNode(context, bag, noise, pieceTime, random() * 1.5, clickEnvelope.endTime + 0.03).connect(clickBand);

    const ring = toneNode(context, bag, 'triangle', ringHz, pieceTime, pieceTime + ringDecay + 0.05);
    const ringEnvelope = envelope(context, bag, pieceTime, pieceGain * 0.5, 0.002, 0.004, ringDecay);
    ringEnvelope.gain.connect(bus);
    ring.connect(ringEnvelope.gain);
    endTime = Math.max(endTime, clickEnvelope.endTime, ringEnvelope.endTime);
  }

  // The saucer rings lower and longer under the cups.
  if (profile.saucer) {
    const saucerTime = time + profile.spreadSeconds * 0.3 * trigger.durationFactor;
    const saucerHz = clamp(
      profile.ringHz * 0.45 * tonality.ringRatio * trigger.pitchFactor,
      80,
      8000,
    );
    const saucerDecay = clamp(
      profile.ringDecaySeconds * tonality.decayScale * 1.4,
      0.01,
      6,
    );
    const saucer = toneNode(context, bag, 'sine', saucerHz, saucerTime, saucerTime + saucerDecay + 0.05);
    const saucerEnvelope = envelope(
      context,
      bag,
      saucerTime,
      clamp(peak * 0.6, SILENT_GAIN * 10, 4),
      0.002,
      0.006,
      saucerDecay,
    );
    saucerEnvelope.gain.connect(bus);
    saucer.connect(saucerEnvelope.gain);
    endTime = Math.max(endTime, saucerEnvelope.endTime);
  }

  return finish(bag, peak, endTime);
}

function buildMilkKnock(trigger: TriggerContext): TriggerResult {
  const { context, noise, character, random, time } = trigger;
  const profile = character.milk;
  const bag = createAudioResourceBag();
  const peak = clamp(profile.level * trigger.strength, SILENT_GAIN * 10, 4);
  const decay = clamp(profile.decaySeconds * trigger.durationFactor, 0.01, 8);
  const knockHz = clamp(profile.knockHz * trigger.pitchFactor, 40, 4000);

  const knockEnvelope = envelope(context, bag, time, peak, 0.002, 0.006, decay);
  knockEnvelope.gain.connect(character.outputTarget);
  const knock = toneNode(context, bag, 'triangle', knockHz, time, knockEnvelope.endTime + 0.03);
  knock.frequency.exponentialRampToValueAtTime(
    clamp(knockHz * 0.72, 30, 3000),
    time + decay * 0.6,
  );
  knock.connect(knockEnvelope.gain);
  const knockBody = filterNode(context, bag, 'bandpass', knockHz * 2.4, 1.3);
  knockBody.connect(knockEnvelope.gain);
  noiseNode(context, bag, noise, time, random() * 1.5, knockEnvelope.endTime + 0.03).connect(knockBody);

  let endTime = knockEnvelope.endTime;

  // A breath of steam still curling off the pitcher.
  if (profile.steamTail > 0.001) {
    const tailSeconds = clamp(decay * 2.2, 0.05, 3);
    const tailEnvelope = envelope(
      context,
      bag,
      time + 0.02,
      clamp(peak * profile.steamTail * 0.5, SILENT_GAIN * 10, 4),
      0.08,
      tailSeconds,
      0.25,
    );
    tailEnvelope.gain.connect(character.outputTarget);
    const tailHiss = filterNode(context, bag, 'highpass', 4200 * trigger.pitchFactor, 0.7);
    tailHiss.connect(tailEnvelope.gain);
    noiseNode(context, bag, noise, time + 0.02, random() * 1.5, tailEnvelope.endTime + 0.05).connect(tailHiss);
    endTime = Math.max(endTime, tailEnvelope.endTime);
  }

  return finish(bag, peak, endTime);
}

function buildTill(trigger: TriggerContext): TriggerResult {
  const { context, noise, character, random, time } = trigger;
  const profile = character.till;
  if (!profile.drawer && !profile.beep) {
    // The era has no till (or no reader): the trigger is deliberately silent.
    return { endTime: time, emitted: false, bag: null, peak: 0 };
  }
  const bag = createAudioResourceBag();
  const peak = clamp(profile.level * trigger.strength, SILENT_GAIN * 10, 4);
  let endTime = time;

  if (profile.drawer) {
    const drawerSeconds = clamp(profile.drawerSeconds * trigger.durationFactor, 0.02, 5);
    const drawerEnvelope = envelope(context, bag, time, peak, 0.004, drawerSeconds, 0.08);
    drawerEnvelope.gain.connect(character.outputTarget);
    const drawer = toneNode(context, bag, 'square', 150 * trigger.pitchFactor, time, drawerEnvelope.endTime + 0.03);
    drawer.frequency.exponentialRampToValueAtTime(90, time + drawerSeconds);
    const drawerGain = gainNode(context, bag, 0.35);
    drawer.connect(drawerGain);
    drawerGain.connect(drawerEnvelope.gain);
    const drawerNoise = filterNode(context, bag, 'lowpass', 1400, 1.2);
    drawerNoise.connect(drawerEnvelope.gain);
    noiseNode(context, bag, noise, time, random() * 1.5, drawerEnvelope.endTime + 0.03).connect(drawerNoise);
    endTime = Math.max(endTime, drawerEnvelope.endTime);
  }

  if (profile.beep) {
    const beeps = profile.contactless ? 2 : 1;
    for (let index = 0; index < beeps; index += 1) {
      const beepTime = time + index * (profile.beepSeconds + 0.05);
      const beepHz = clamp(
        profile.beepHz * trigger.pitchFactor * (profile.contactless ? 1 + index * 0.25 : 1),
        120,
        8000,
      );
      const beep = toneNode(
        context,
        bag,
        profile.contactless ? 'sine' : 'square',
        beepHz,
        beepTime,
        beepTime + profile.beepSeconds + 0.03,
      );
      const beepEnvelope = envelope(
        context,
        bag,
        beepTime,
        peak * 0.8,
        0.004,
        profile.beepSeconds,
        0.05,
      );
      beepEnvelope.gain.connect(character.outputTarget);
      beep.connect(beepEnvelope.gain);
      endTime = Math.max(endTime, beepEnvelope.endTime);
    }
  }

  return finish(bag, peak, endTime);
}

/** Wraps a built one-shot into the result the unit registers. */
function finish(bag: AudioResourceBag, peak: number, endTime: number): TriggerResult {
  return { endTime, emitted: true, bag, peak };
}

const BUILDERS: Readonly<Record<MachineSfxKind, (trigger: TriggerContext) => TriggerResult>> = {
  extraction: buildExtraction,
  steamPurge: buildSteamPurge,
  grinder: buildGrinder,
  cupClatter: buildCupClatter,
  milkKnock: buildMilkKnock,
  till: buildTill,
};

/** Stable per-kind number used when deriving trigger seeds. */
const KIND_CODES: Readonly<Record<MachineSfxKind, number>> = {
  extraction: 1,
  steamPurge: 2,
  grinder: 3,
  cupClatter: 4,
  milkKnock: 5,
  till: 6,
};

/* -------------------------------------------------------------------------- */
/* The unit                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Creates the machine-SFX unit. A character is mandatory: the engine always
 * receives one through the era mix descriptor, and triggering without one would
 * mean emitting an era-neutral machine, which the scene never wants.
 */
export function createMachineSfx(options: MachineSfxOptions): MachineSfx {
  const context = options.context;
  const baseSeed = Math.trunc(options.seed ?? 0x6a11);
  let character = normalizeMachineCharacter(options.character, 'machine character');
  let level = clamp(options.level ?? 1, 0, 2);
  let disposed = false;
  let triggerCount = 0;
  const voices: OneShotVoice[] = [];
  const noise = createNoiseBuffer(context, { seconds: 2.5, seed: deriveSeed(baseSeed, 0x3c0f), tilt: 0.8 });

  const output = context.createGain();
  output.gain.value = level;
  output.connect(options.destination);

  /** The character as the builders see it: with their routing attached. */
  function routedCharacter(): RoutedMachineCharacter {
    return { ...character, outputTarget: output };
  }

  function trigger(
    kind: MachineSfxKind,
    triggerOptions: MachineTriggerOptions = {},
    now = 0,
  ): MachineTriggerRecord {
    const seed =
      triggerOptions.seed !== undefined
        ? Math.trunc(triggerOptions.seed)
        : deriveSeed(baseSeed, KIND_CODES[kind], triggerCount + 1);
    const random = createAudioRandom(seed);
    const pitchFactor = clamp(triggerOptions.pitch ?? 0.94 + random() * 0.12, 0.4, 2.5);
    const durationFactor = clamp(triggerOptions.duration ?? 0.88 + random() * 0.3, 0.3, 3);
    const levelFactor = clamp(triggerOptions.level ?? 0.85 + random() * 0.3, 0, 2);
    const velocity = clamp(triggerOptions.velocity ?? 0.8, 0.05, 1.4);
    const time = Math.max(triggerOptions.at ?? now, 0);
    const strength = velocity * levelFactor;

    const result: TriggerResult = disposed
      ? { endTime: time, emitted: false, bag: null, peak: 0 }
      : BUILDERS[kind]({
          context,
          noise,
          character: routedCharacter(),
          random,
          time,
          pitchFactor,
          durationFactor,
          strength,
        });

    const index = triggerCount;
    triggerCount += 1;
    const bag = result.bag;
    const record: MachineTriggerRecord = {
      kind,
      year: character.year,
      archetype: character.extraction.archetype,
      material: character.clatter.material,
      time,
      durationSeconds: Math.max(result.endTime - time, 0),
      velocity,
      pitchFactor,
      durationFactor,
      levelFactor,
      level: clamp(result.peak * level, 0, 8),
      seed,
      nodes: bag?.size ?? 0,
      emitted: result.emitted && bag !== null && bag.size > 0,
      index,
    };

    if (bag !== null) {
      if (record.emitted) {
        voices.push({
          startTime: time,
          endTime: result.endTime,
          level: Math.max(record.level, SILENT_GAIN * 10),
          dispose() {
            bag.stopAll();
            bag.disconnectAll();
          },
        });
      } else {
        bag.stopAll();
        bag.disconnectAll();
      }
    }

    options.onTrigger?.(record);
    return record;
  }

  return {
    get character() {
      return character;
    },
    get level() {
      return level;
    },
    output,
    get triggerCount() {
      return triggerCount;
    },
    get activeOneShotCount() {
      return voices.length;
    },
    get disposed() {
      return disposed;
    },
    setCharacter(next) {
      character = normalizeMachineCharacter(next, 'machine character');
    },
    setLevel(value, seconds, now) {
      const target = clamp(value, 0, 2);
      const previous = level;
      level = target;
      return scheduleRamp(output.gain, previous, target, seconds, now);
    },
    trigger,
    pendingLevel(now) {
      let total = 0;
      for (const voice of voices) {
        if (voice.endTime <= now) continue;
        const span = Math.max(voice.endTime - voice.startTime, 0.001);
        const progress = clamp01((now - voice.startTime) / span);
        total += voice.level * (1 - progress);
      }
      return Math.min(total, 8);
    },
    reap(now) {
      let released = 0;
      for (let index = voices.length - 1; index >= 0; index -= 1) {
        const voice = voices[index];
        if (voice === undefined || voice.endTime > now) continue;
        voice.dispose();
        voices.splice(index, 1);
        released += 1;
      }
      return released;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const voice of voices) voice.dispose();
      voices.length = 0;
      try {
        output.disconnect();
      } catch {
        // Already disconnected.
      }
    },
  };
}
