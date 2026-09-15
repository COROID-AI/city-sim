/**
 * Headless engine suite.
 *
 * Every test drives the *real* audio graph through the recording fake context:
 * buses, limiter, reverb, music scheduler, murmur bed and machine one-shots are
 * all built by the production code, and the assertions read back node wiring,
 * parameter automation, scheduled events and buffer contents.
 *
 * The era data used here are **test fixtures**, generated from the shared
 * `YearId`s so the engine can be driven per year. The five production era
 * programs, murmur specs, machine characters and mix values belong to
 * `domain-music-sources` and are injected through exactly the same descriptor
 * shapes.
 */

import { describe, expect, it } from 'vitest';
import { YEAR_IDS, type YearId } from '../../src/contracts/period';
import {
  AudioDescriptorError,
  AudioEngineError,
  CLATTER_MATERIALS,
  MACHINE_ARCHETYPES,
  createAudioEngine,
  createAudioSceneModule,
  isCafeAudioEngine,
  type AmbienceSpecInput,
  type AudioEngine,
  type EraMixInput,
  type MachineArchetype,
  type MachineCharacterInput,
  type MusicProgramInput,
} from '../../src/audio';
import type { AudioNodeLike, AudioParamLike } from '../../src/audio/types';
import {
  FakeAudioBuffer,
  FakeAudioContext,
  FakeAudioNode,
  FakeAudioParam,
  FakeBiquadFilterNode,
  FakeConvolverNode,
  FakeGainNode,
  createFakeAudioContextFactory,
  requireContext,
} from './fakeAudioContext';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const FIXTURE_ARCHETYPES: readonly MachineArchetype[] = [
  'percolator',
  'lever',
  'semi-automatic',
  'super-automatic',
  'multi-group',
];

const yearPosition = (year: YearId): number => {
  const index = YEAR_IDS.indexOf(year);
  return index < 0 ? 0 : index;
};

/** Test-only era music program: distinct per year, but generic in shape. */
function fixtureProgram(year: YearId): MusicProgramInput {
  const index = yearPosition(year);
  return {
    id: `fixture-program-${year}`,
    year,
    label: `fixture ${year} program`,
    tempo: 92 + index * 9,
    key: { root: ['C', 'D', 'E', 'G', 'A'][index] ?? 'C', mode: 'mixolydian' },
    bars: 2,
    beatsPerBar: 4,
    stepsPerBeat: 2,
    swing: index === 0 ? 0.25 : 0,
    voices: [
      {
        id: 'bass',
        instrument: { kind: 'bass', gain: 0.32, brightness: 1200 + index * 120 },
        pattern: [
          { step: 0, note: 0, durationSteps: 2 },
          { step: 4, note: 2, durationSteps: 2 },
          { step: 8, note: 4 },
          { step: 12, note: 2 },
        ],
      },
      {
        id: 'comp',
        instrument: index % 2 === 0 ? 'pluck' : 'electric-piano',
        pattern: [
          { step: 0, note: 7 },
          { step: 2, note: 9 },
          { step: 6, note: 11 },
          { step: 8, note: 7 },
          { step: 12, note: 12, velocity: 0.5 },
        ],
        humanize: 0.35,
      },
      {
        id: 'kit',
        instrument: 'kick',
        pattern: [
          { step: 0, note: 0 },
          { step: 6, note: 0 },
          { step: 8, note: 0 },
          { step: 14, note: 0 },
        ],
      },
      {
        id: 'shaker',
        instrument: 'hi-hat',
        pattern: Array.from({ length: 16 }, (_, step) => ({
          step,
          note: 24,
          velocity: step % 4 === 0 ? 0.8 : 0.35,
        })),
      },
    ],
    device: {
      kind: index < 2 ? 'wireless' : index < 4 ? 'boombox' : 'phone',
      lowHz: 120 + index * 20,
      highHz: 3800 + index * 2400,
      drive: index * 0.08,
      hiss: 0.2 - index * 0.04,
      wobble: index === 1 ? 0.3 : 0,
    },
    seed: 4100 + index,
  };
}

/** Test-only murmur spec for a year. */
function fixtureAmbience(year: YearId): AmbienceSpecInput {
  const index = yearPosition(year);
  return {
    id: `fixture-ambience-${year}`,
    year,
    murmur: {
      bedLevel: 0.3 + index * 0.02,
      bedLowHz: 110 + index * 10,
      bedHighHz: 820 + index * 40,
      densityHighHz: 2400 + index * 120,
      densityLevel: 0.24 + index * 0.02,
      blipRate: 3 + index * 0.2,
      blipLevel: 0.16,
      formantLowHz: 400 + index * 15,
      formantHighHz: 1700 + index * 60,
      blipSeconds: 0.22,
      roomToneLevel: 0.1,
      roomToneHz: 150 + index * 8,
    },
  };
}

/** Test-only machine character for a year (one archetype per era). */
function fixtureCharacter(year: YearId, overrides: Partial<MachineCharacterInput> = {}): MachineCharacterInput {
  const index = yearPosition(year);
  const archetype = FIXTURE_ARCHETYPES[index] ?? 'manual';
  return {
    id: `fixture-machine-${year}`,
    year,
    extraction: {
      archetype,
      noiseHz: 2400 + index * 320,
      noiseQ: 0.9,
      pumpHz: archetype === 'semi-automatic' ? 1.3 : 0,
      pumpDepth: archetype === 'semi-automatic' ? 0.35 : 0,
      bubbleRate: archetype === 'percolator' ? 7 : 0,
      clickLevel: 0.3,
      durationSeconds: 1.6,
      level: 0.55,
      brightness: 0.35 + index * 0.1,
      toneHz: 900 + index * 120,
    },
    steam: { burstSeconds: 1.1, hissHz: 5200, level: 0.5, pressureRise: 0.3, chatterHz: index < 2 ? 9 : 0 },
    grinder: {
      burrHz: 300 + index * 45,
      durationSeconds: 1.2,
      level: 0.5,
      wobbleHz: index >= 2 ? 12 : 0,
      wobbleDepth: index >= 2 ? 0.3 : 0,
      pitchJitter: 0.08,
      motorHz: index >= 3 ? 70 : 0,
    },
    clatter: {
      material: CLATTER_MATERIALS[index] ?? 'china',
      pieces: 2 + index,
      decaySeconds: 0.45,
      ringHz: 2100 + index * 60,
      ringDecaySeconds: 0.2,
      spreadSeconds: 0.12,
      level: 0.45,
    },
    milk: { knockHz: 220, decaySeconds: 0.3, level: 0.45, steamTail: 0.3 },
    till: {
      drawer: index >= 1,
      beep: index === 4,
      beepHz: 1180,
      beepSeconds: 0.12,
      contactless: index === 4,
    },
    ...overrides,
  };
}

/** Test-only per-year mix. */
function fixtureMix(year: YearId): EraMixInput {
  const index = yearPosition(year);
  return {
    id: `fixture-mix-${year}`,
    year,
    music: { level: 0.6 + index * 0.02, toneHz: 5200 + index * 900, send: 0.3, brightness: 0.8 + index * 0.05 },
    ambience: { level: 0.55 + index * 0.02, density: 0.28 + index * 0.14, toneHz: 4000 + index * 200, send: 0.2 },
    machine: { level: 0.5 + index * 0.04, character: fixtureCharacter(year), send: 0.35 },
    brightness: 0.4 + index * 0.12,
    reverb: { dryWet: 0.22 + index * 0.03, sizeSeconds: 0.9 + index * 0.1, decay: 3 + index * 0.2 },
    master: 0.9,
  };
}

interface Harness {
  readonly engine: AudioEngine;
  readonly contexts: readonly FakeAudioContext[];
  readonly context: () => FakeAudioContext;
}

/** Engine + fake context factory, configured with era fixtures. */
function createHarness(seed = 90210): Harness {
  const { factory, contexts } = createFakeAudioContextFactory();
  const engine = createAudioEngine({
    contextFactory: factory,
    seed,
    program: fixtureProgram('1945'),
    ambience: fixtureAmbience('1945'),
    mix: fixtureMix('1945'),
  });
  return { engine, contexts, context: () => requireContext({ contexts, factory }) };
}

/** Advances the engine in bounded frame steps (its own max delta is 0.25s). */
function advance(engine: AudioEngine, seconds: number, step = 0.25): void {
  const steps = Math.max(1, Math.round(seconds / step));
  for (let index = 0; index < steps; index += 1) engine.update(step);
}

const asNode = (node: AudioNodeLike): FakeAudioNode => node as unknown as FakeAudioNode;
const asParam = (param: AudioParamLike): FakeAudioParam => param as unknown as FakeAudioParam;
const gainOf = (node: AudioNodeLike): FakeAudioParam => (node as unknown as FakeGainNode).gain;
const filterOf = (node: AudioNodeLike): FakeBiquadFilterNode => node as unknown as FakeBiquadFilterNode;

/* -------------------------------------------------------------------------- */
/* Gesture gating and lifecycle                                               */
/* -------------------------------------------------------------------------- */

describe('gesture gating and lifecycle', () => {
  it('starts locked, creates no context and schedules nothing', () => {
    const { engine, contexts } = createHarness();
    expect(engine.state).toBe('locked');
    expect(engine.isLocked).toBe(true);
    expect(engine.isDisposed).toBe(false);
    expect(engine.context).toBeNull();
    expect(engine.sampleRate).toBe(0);
    expect(engine.getMusicScheduler()).toBeNull();
    expect(engine.getMurmurBed()).toBeNull();
    expect(isCafeAudioEngine(engine)).toBe(true);

    // No frame driving, no machine SFX, no descriptor application: still silent.
    advance(engine, 2);
    expect(contexts).toHaveLength(0);
    expect(engine.getMusicScheduler()).toBeNull();
    expect(() => engine.triggerMachine('extraction')).toThrowError(AudioEngineError);
    expect(engine.getEventLog().some((event) => event.kind === 'music-note')).toBe(false);
  });

  it('creates and resumes the context only on unlock, and reports state', async () => {
    const { engine, contexts } = createHarness();
    const state = await engine.unlock();
    expect(state).toBe('running');
    expect(engine.state).toBe('running');
    expect(engine.isRunning).toBe(true);
    expect(contexts).toHaveLength(1);

    const context = engine.context as unknown as FakeAudioContext;
    expect(context.resumeCalls).toBe(1);
    expect(engine.sampleRate).toBe(context.sampleRate);

    // Unlocking again is inert: no second context, no extra resume.
    await engine.unlock();
    expect(contexts).toHaveLength(1);
    expect(context.resumeCalls).toBe(1);

    // The three sinks are alive after unlock.
    expect(engine.getMusicScheduler()).not.toBeNull();
    expect(engine.getMurmurBed()).not.toBeNull();
    expect(engine.getMachineSfx()).not.toBeNull();
  });

  it('suspends without scheduling and resumes safely afterwards', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    advance(engine, 1);
    const beforeSuspend = engine.getEventLog().length;

    expect(await engine.suspend()).toBe('suspended');
    expect(engine.state).toBe('suspended');
    const context = engine.context as unknown as FakeAudioContext;
    expect(context.suspendCalls).toBe(1);

    const nodesWhileSuspended = context.nodes.length;
    advance(engine, 2);
    expect(context.nodes.length).toBe(nodesWhileSuspended);
    expect(engine.getEventLog().length).toBe(beforeSuspend + 1);

    expect(await engine.unlock()).toBe('running');
    expect(context.resumeCalls).toBe(2);
    // The resumed context gets a fresh schedule instead of replaying stale notes.
    const resumed = engine.getMusicScheduler();
    expect(resumed).not.toBeNull();
    advance(engine, 1);
    expect(engine.getEventLog().some((event) => event.kind === 'music-note')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Bus graph                                                                  */
/* -------------------------------------------------------------------------- */

describe('bus graph', () => {
  it('wires one master feeding three sub-buses and a shared reverb send', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const context = engine.context as unknown as FakeAudioContext;
    const reverb = engine.getReverb();
    const master = engine.getMaster();
    expect(reverb).not.toBeNull();
    expect(master).not.toBeNull();
    if (reverb === null || master === null) return;

    // One shared reverb: a single convolver, fed by every bus's send.
    expect(context.countNodes('convolver')).toBe(1);
    const drySum = context.inputsOf(asNode(reverb.dry))[0];
    expect(drySum).toBeDefined();
    if (drySum === undefined) return;

    const seen = new Set<FakeAudioNode>();
    for (const id of ['music', 'ambience', 'machine'] as const) {
      const bus = engine.getBus(id);
      expect(bus).not.toBeNull();
      if (bus === null) continue;
      // input → trim → tone → mute → dry sum, with the send taken post-mute.
      expect(asNode(bus.input).feeds(asNode(bus.trim))).toBe(true);
      expect(asNode(bus.trim).feeds(asNode(bus.tone))).toBe(true);
      expect(asNode(bus.tone).feeds(asNode(bus.mute))).toBe(true);
      expect(asNode(bus.mute).feeds(drySum)).toBe(true);
      expect(asNode(bus.mute).feeds(asNode(bus.send))).toBe(true);
      expect(asNode(bus.send).feeds(asNode(reverb.send))).toBe(true);
      expect(bus.tone.type).toBe('lowpass');
      seen.add(asNode(bus.input));
    }
    // The three sub-buses are independent nodes, not one shared chain.
    expect(seen.size).toBe(3);

    // Reverb return and dry path meet at the reverb output, which feeds the limiter.
    expect(asNode(reverb.send).feeds(asNode(reverb.convolver))).toBe(true);
    expect(asNode(reverb.convolver).feeds(asNode(reverb.wet))).toBe(true);
    expect(asNode(reverb.wet).feeds(asNode(reverb.output))).toBe(true);
    expect(asNode(reverb.dry).feeds(asNode(reverb.output))).toBe(true);
    expect(asNode(reverb.output).feeds(asNode(master.input))).toBe(true);
  });

  it('puts the limiter between the summed buses and the destination', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const context = engine.context as unknown as FakeAudioContext;
    const master = engine.getMaster();
    expect(master).not.toBeNull();
    if (master === null) return;

    const limiter = master.limiter;
    expect(asNode(limiter.input).feeds(asNode(limiter.compressor))).toBe(true);
    expect(asNode(limiter.compressor).feeds(asNode(limiter.gain))).toBe(true);
    expect(asNode(limiter.gain).feeds(asNode(limiter.output))).toBe(true);
    expect(asNode(limiter.output).feeds(asNode(master.master))).toBe(true);
    expect(asNode(master.master).feeds(context.destination)).toBe(true);
    // The limiter owns the compressor that sits after the sum; the music device
    // chain may use a separate drive compressor of its own.
    expect(context.findNodes('compressor')).toContain(asNode(limiter.compressor));
    expect(context.inputsOf(asNode(limiter.compressor))).toContain(asNode(limiter.input));
    expect(limiter.compressor.threshold.value).toBeLessThan(0);
    expect(limiter.compressor.ratio.value).toBeGreaterThan(4);
  });

  it('generates a stereo café impulse response with a decaying tail', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const reverb = engine.getReverb();
    expect(reverb).not.toBeNull();
    if (reverb === null) return;
    const buffer = reverb.convolver.buffer;
    expect(buffer).not.toBeNull();
    expect(buffer).toBeInstanceOf(FakeAudioBuffer);
    if (!(buffer instanceof FakeAudioBuffer)) return;

    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(Math.round(reverb.options.sizeSeconds * buffer.sampleRate));
    expect(reverb.convolver.normalize).toBe(true);

    const samples = buffer.getChannelData(0);
    const window = Math.max(1, Math.round(samples.length * 0.05));
    let early = 0;
    let late = 0;
    for (let index = 0; index < window; index += 1) {
      early = Math.max(early, Math.abs(samples[index] ?? 0));
      late = Math.max(late, Math.abs(samples[samples.length - 1 - index] ?? 0));
    }
    expect(early).toBeGreaterThan(0.001);
    expect(late).toBeLessThan(early * 0.5);
    // The two channels differ (stereo width from the decorrelated noise field).
    const other = buffer.getChannelData(1);
    expect(other[window] ?? 0).not.toBe(samples[window] ?? 0);
  });

  it('applies per-bus gain, mute, send and tone independently and click free', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const music = engine.getBus('music');
    const ambience = engine.getBus('ambience');
    const machine = engine.getBus('machine');
    expect(music).not.toBeNull();
    expect(ambience).not.toBeNull();
    expect(machine).not.toBeNull();
    if (music === null || ambience === null || machine === null) return;

    engine.setBusGain('music', 0.42, 0.5);
    expect(music.gainValue).toBeCloseTo(0.42, 6);
    expect(gainOf(music.trim).lastRampTarget).toBeCloseTo(0.42, 6);
    expect(ambience.gainValue).not.toBeCloseTo(0.42, 6);
    expect(engine.getMixState().musicLevel).toBeCloseTo(0.42, 6);

    engine.setBusMute('ambience', true, 0.2);
    expect(ambience.muted).toBe(true);
    expect(asParam(ambience.mute.gain).lastRampTarget).toBe(0);
    expect(music.mute.gain.value).toBe(1);
    expect(engine.getMixState().mutes.ambience).toBe(true);

    engine.setBusSend('machine', 0.72, 0.3);
    expect(machine.sendValue).toBeCloseTo(0.72, 6);
    expect(asParam(machine.send.gain).lastRampTarget).toBeCloseTo(0.72, 6);

    engine.setBusTone('music', 3100, 0.2);
    expect(music.toneHz).toBeCloseTo(3100, 6);
    expect(filterOf(music.tone).frequency.lastRampTarget).toBeCloseTo(3100, 3);

    engine.setBusMute('ambience', false, 0.2);
    expect(ambience.muted).toBe(false);
    expect(asParam(ambience.mute.gain).lastRampTarget).toBe(1);
  });

  it('crossfades the reverb dry/wet balance and regenerates the tail on request', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const reverb = engine.getReverb();
    expect(reverb).not.toBeNull();
    if (reverb === null) return;
    const convolver = engine.context as unknown as FakeAudioContext;
    expect(convolver.countNodes('convolver')).toBe(1);

    engine.setReverb(0.6, 0.3);
    expect(reverb.dryWet).toBeCloseTo(0.6, 6);
    expect(asParam(reverb.wet.gain).lastRampTarget).toBeCloseTo(0.6, 6);
    expect(asParam(reverb.dry.gain).lastRampTarget).toBeCloseTo(0.4, 6);

    const before = reverb.convolver.buffer;
    engine.applyMix(fixtureMix('2025'), { seconds: 0 });
    expect(reverb.options.sizeSeconds).toBeCloseTo(fixtureMix('2025').reverb?.sizeSeconds ?? 0, 5);
    expect(reverb.convolver.buffer).not.toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* Music                                                                      */
/* -------------------------------------------------------------------------- */

describe('music bus and program scheduling', () => {
  it('schedules an injected program as a seamless, identical-every-loop loop', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const scheduler = engine.getMusicScheduler();
    expect(scheduler).not.toBeNull();
    if (scheduler === null) return;

    const loopA = scheduler.plan(0);
    const loopB = scheduler.plan(1);
    expect(loopA.length).toBeGreaterThan(8);
    expect(loopB.length).toBe(loopA.length);
    // The grid, the voices and the pitches repeat exactly, one loop apart. Only
    // the humanised micro-timing differs between passes, by less than a quarter
    // of a step, so the loop still joins without a gap.
    const periodicityTolerance = scheduler.secondsPerStep * 0.25;
    const keyOf = (event: (typeof loopA)[number]): string => `${event.voiceId}@${event.step}`;
    const byKeyB = new Map(loopB.map((event) => [keyOf(event), event]));
    expect(byKeyB.size).toBe(loopA.length);
    for (const event of loopA) {
      const next = byKeyB.get(keyOf(event));
      expect(next).toBeDefined();
      if (next === undefined) continue;
      expect(next.frequency).toBeCloseTo(event.frequency, 9);
      expect(next.midi).toBe(event.midi);
      expect(next.durationSeconds).toBeCloseTo(event.durationSeconds, 9);
      expect(Math.abs(next.time - event.time - scheduler.loopDurationSeconds)).toBeLessThan(
        periodicityTolerance,
      );
    }

    // Continuity: no silence gap of even a quarter of the loop.
    const times = loopA.map((event) => event.time);
    let maxGap = 0;
    for (let index = 1; index < times.length; index += 1) {
      maxGap = Math.max(maxGap, (times[index] ?? 0) - (times[index - 1] ?? 0));
    }
    expect(maxGap).toBeLessThan(scheduler.loopDurationSeconds / 4);
    expect(scheduler.loopDurationSeconds).toBeCloseTo(
      (fixtureProgram('1945').beatsPerBar ?? 4) * (fixtureProgram('1945').bars ?? 4) * (60 / (fixtureProgram('1945').tempo)),
      6,
    );
  });

  it('renders the program through the device tone chain and schedules notes in the window', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const context = engine.context as unknown as FakeAudioContext;
    const scheduler = engine.getMusicScheduler();
    expect(scheduler).not.toBeNull();
    if (scheduler === null) return;

    // Device chain: highpass (bandwidth), lowpass (tone), drive, flutter.
    expect(scheduler.deviceChain).toHaveLength(4);
    const [highpass, lowpass, drive, flutter] = scheduler.deviceChain;
    expect(highpass).toBeDefined();
    expect(lowpass).toBeDefined();
    expect(drive).toBeDefined();
    expect(flutter).toBeDefined();
    if (highpass === undefined || lowpass === undefined) return;
    expect(asNode(highpass).feeds(asNode(lowpass))).toBe(true);
    const filters = context.findNodesWhere<FakeBiquadFilterNode>('biquad', () => true);
    expect(
      filters.some((node) => node.type === 'highpass' && node.frequency.value > 0),
    ).toBe(true);
    // The wireless fixture declares hiss, so a noise floor source exists.
    expect(context.sources.length).toBeGreaterThan(0);

    const scheduledBefore = scheduler.scheduledCount;
    advance(engine, 1);
    expect(scheduler.scheduledCount).toBeGreaterThan(scheduledBefore);
    const notes = engine.getEventLog().filter((event) => event.kind === 'music-note');
    expect(notes.length).toBe(scheduler.scheduledCount);
    expect(notes.every((event) => event.year === '1945')).toBe(true);
    // Voices are rendered and later reaped once their tails end.
    expect(scheduler.activeVoiceCount).toBeGreaterThan(0);
    advance(engine, 8);
    const connectedWhilePlaying = context.connectedNodes.length;
    expect(connectedWhilePlaying).toBeGreaterThan(0);
  });

  it('crossfades between programs and releases the outgoing one', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const first = engine.getMusicScheduler();
    expect(first).not.toBeNull();
    if (first === null) return;

    engine.setMusicProgram(fixtureProgram('1985'), { crossfadeSeconds: 0.8 });
    const second = engine.getMusicScheduler();
    expect(second).not.toBe(first);
    expect(first.level).toBe(0);
    expect(second).not.toBeNull();
    if (second === null) return;
    expect(second.level).toBe(1);
    expect(gainOf(second.output).wasRamped).toBe(true);
    expect(first.disposed).toBe(false);

    advance(engine, 2);
    expect(first.disposed).toBe(true);
    expect(asNode(first.output).isConnected).toBe(false);
    const programs = engine.getEventLog().filter((event) => event.kind === 'music-program');
    expect(programs.map((event) => event.id)).toContain('fixture-program-1985');
    // The new program's notes are the ones being scheduled now.
    advance(engine, 1);
    const newest = engine.getEventLog().filter((event) => event.kind === 'music-note');
    expect(newest.some((event) => event.year === '1985')).toBe(true);
  });

  it('rejects programs that declare no voices, or only silent ones', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const base = fixtureProgram('1945');

    expect(() => engine.setMusicProgram({ ...base, id: 'empty', voices: [] })).toThrowError(
      AudioDescriptorError,
    );
    expect(() =>
      engine.setMusicProgram({
        ...base,
        id: 'muted',
        voices: base.voices.map((voice) => ({ ...voice, mute: true })),
      }),
    ).toThrowError(AudioDescriptorError);
    expect(() =>
      engine.setMusicProgram({
        ...base,
        id: 'empty-patterns',
        voices: base.voices.map((voice) => ({ ...voice, pattern: [] })),
      }),
    ).toThrowError(AudioDescriptorError);
    expect(() =>
      engine.setMusicProgram({ ...base, id: 'bad-tempo', tempo: 10_000 }),
    ).toThrowError(AudioDescriptorError);

    // A rejected program never replaces the one that is playing.
    expect(engine.getMusicScheduler()?.program.id).toBe('fixture-program-1945');

    advance(engine, 1);
    const notesWhilePlaying = engine
      .getEventLog()
      .filter((event) => event.kind === 'music-note').length;
    expect(notesWhilePlaying).toBeGreaterThan(0);

    engine.setMusicProgram(null, { crossfadeSeconds: 0 });
    expect(engine.getMusicScheduler()).toBeNull();
    advance(engine, 1);
    // Stopping the music stops the scheduler: no further notes are queued.
    expect(engine.getEventLog().filter((event) => event.kind === 'music-note').length).toBe(
      notesWhilePlaying,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Ambience                                                                   */
/* -------------------------------------------------------------------------- */

describe('conversation murmur bed', () => {
  it('raises level, spectral density and blip rate with intensity', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const bed = engine.getMurmurBed();
    expect(bed).not.toBeNull();
    if (bed === null) return;
    const context = engine.context as unknown as FakeAudioContext;

    engine.setAmbienceIntensity(0.2, 0.1);
    const lowBedTarget = asParam(bed.bedGain.gain).lastRampTarget ?? 0;
    const lowDensityTarget = asParam(bed.densityFilter.frequency).lastRampTarget ?? 0;
    const lowStart = bed.blipCount;
    advance(engine, 4);
    const lowBlips = bed.blipCount - lowStart;

    engine.setAmbienceIntensity(1, 0.1);
    const highBedTarget = asParam(bed.bedGain.gain).lastRampTarget ?? 0;
    const highDensityTarget = asParam(bed.densityFilter.frequency).lastRampTarget ?? 0;
    const highStart = bed.blipCount;
    advance(engine, 4);
    const highBlips = bed.blipCount - highStart;

    expect(highBedTarget).toBeGreaterThan(lowBedTarget * 4);
    expect(highDensityTarget).toBeGreaterThan(lowDensityTarget * 1.8);
    expect(lowBlips).toBeGreaterThan(0);
    expect(highBlips).toBeGreaterThan(lowBlips * 2);

    // Blips are voiced: formant bandpasses plus a glottal carrier.
    const bandpass = context.findNodesWhere<FakeBiquadFilterNode>(
      'biquad',
      (node) => node.type === 'bandpass',
    );
    expect(bandpass.length).toBeGreaterThanOrEqual(3);
    const blips = engine.getEventLog().filter((event) => event.kind === 'murmur-blip');
    expect(blips.length).toBeGreaterThan(0);
    for (const blip of blips) {
      expect(Number(blip.detail?.['fundamentalHz'] ?? 0)).toBeGreaterThan(70);
      expect(Number(blip.detail?.['fundamentalHz'] ?? 0)).toBeLessThan(220);
    }

    // Intensity drives the limiter's view of the ambience too.
    expect(engine.getMixState().ambienceDensity).toBeCloseTo(1, 6);
  });

  it('fades the bed in and out when the era changes patron density', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const first = engine.getMurmurBed();
    expect(first).not.toBeNull();
    if (first === null) return;
    const context = engine.context as unknown as FakeAudioContext;
    const noiseSourcesBefore = context.countNodes('buffer-source');

    engine.setAmbience(fixtureAmbience('1985'), { intensity: 0.9, crossfadeSeconds: 0.6 });
    const second = engine.getMurmurBed();
    expect(second).not.toBe(first);
    expect(second).not.toBeNull();
    if (second === null) return;
    expect(second.spec.id).toBe('fixture-ambience-1985');
    expect(asParam(first.output.gain).lastRampTarget).toBe(0);
    expect(gainOf(second.output).wasRamped).toBe(true);
    expect(context.countNodes('buffer-source')).toBeGreaterThan(noiseSourcesBefore);
    expect(engine.getMixState().ambienceDensity).toBeCloseTo(0.9, 6);

    advance(engine, 2);
    expect(first.disposed).toBe(true);
    expect(asNode(first.output).isConnected).toBe(false);

    engine.setAmbience(null, { crossfadeSeconds: 0.2 });
    expect(engine.getMurmurBed()).toBeNull();
    advance(engine, 1);
    expect(engine.getEventLog().some((event) => event.kind === 'ambience' && event.id === 'silence')).toBe(
      true,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Machine SFX                                                                */
/* -------------------------------------------------------------------------- */

describe('machine SFX bus', () => {
  it('emits every parameterised one-shot with per-trigger randomisation', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const machine = engine.getMachineSfx();
    expect(machine).not.toBeNull();
    if (machine === null) return;

    const kinds = ['extraction', 'steamPurge', 'grinder', 'cupClatter', 'milkKnock', 'till'] as const;
    for (const kind of kinds) {
      const record = engine.triggerMachine(kind);
      expect(record.kind).toBe(kind);
      expect(record.year).toBe('1945');
      if (kind === 'till') {
        // The 1945 fixture has no till: the one-shot is deliberately silent.
        expect(record.emitted).toBe(false);
        expect(record.nodes).toBe(0);
      } else {
        expect(record.emitted).toBe(true);
        expect(record.nodes).toBeGreaterThanOrEqual(3);
      }
    }

    const pitches = new Set<number>();
    const durations = new Set<number>();
    const levels = new Set<number>();
    for (let index = 0; index < 6; index += 1) {
      const record = engine.triggerMachine('cupClatter');
      pitches.add(record.pitchFactor);
      durations.add(record.durationFactor);
      levels.add(record.levelFactor);
    }
    expect(pitches.size).toBeGreaterThan(1);
    expect(durations.size).toBeGreaterThan(1);
    expect(levels.size).toBeGreaterThan(1);

    const explicit = engine.triggerMachine('grinder', {
      pitch: 0.5,
      duration: 2,
      level: 1.4,
      velocity: 1,
    });
    expect(explicit.pitchFactor).toBe(0.5);
    expect(explicit.durationFactor).toBe(2);
    expect(explicit.levelFactor).toBe(1.4);
    expect(explicit.velocity).toBe(1);
    expect(explicit.seed).not.toBe(0);

    // Triggers are logged and announced to subscribers.
    const seen: string[] = [];
    const off = engine.onMachineTrigger((record) => seen.push(record.kind));
    engine.triggerMachine('steamPurge');
    off();
    engine.triggerMachine('steamPurge');
    expect(seen).toEqual(['steamPurge']);
    expect(
      engine.getEventLog().filter((event) => event.kind === 'machine-trigger').length,
    ).toBeGreaterThan(6);
  });

  it('changes character per era and keeps the till contactless only where provided', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const context = engine.context as unknown as FakeAudioContext;

    const first = engine.getMachineSfx();
    expect(first?.character.extraction.archetype).toBe('percolator');
    // The 1945 percolator percolates: many short rising bubbles.
    const percolator = engine.triggerMachine('extraction');
    expect(percolator.nodes).toBeGreaterThan(4);
    const percolatorOscillators = context.countNodes('oscillator');
    expect(percolatorOscillators).toBeGreaterThan(4);
    expect(context.countNodes('buffer-source')).toBeGreaterThan(0);

    engine.applyMix(fixtureMix('2025'), { seconds: 0.05 });
    const machine = engine.getMachineSfx();
    expect(machine?.character.year).toBe('2025');
    expect(machine?.character.extraction.archetype).toBe('multi-group');
    expect(machine?.character.till.beep).toBe(true);
    expect(machine?.character.clatter.material).toBe(CLATTER_MATERIALS[4]);
    // Applying a character alone makes no sound.
    expect(context.countNodes('oscillator')).toBe(percolatorOscillators);

    const beep = engine.triggerMachine('till');
    expect(beep.emitted).toBe(true);
    expect(beep.archetype).toBe('multi-group');
    expect(context.countNodes('oscillator')).toBeGreaterThan(percolatorOscillators);

    const extraction = engine.triggerMachine('extraction');
    expect(extraction.archetype).toBe('multi-group');
    expect(extraction.nodes).toBeGreaterThan(4);
    // A multi-group machine with a motor-free hiss is a different graph from the
    // percolator's bubbling one.
    expect(extraction.nodes).not.toBe(percolator.nodes);

    engine.applyMix(fixtureMix('1945'), { seconds: 0.05 });
    const tillWithoutTill = engine.triggerMachine('till');
    expect(tillWithoutTill.emitted).toBe(false);
    expect(tillWithoutTill.nodes).toBe(0);
  });

  it('refuses to fire while locked or before a character is applied', async () => {
    const { factory, contexts } = createFakeAudioContextFactory();
    const engine = createAudioEngine({ contextFactory: factory, seed: 5 });
    expect(() => engine.triggerMachine('extraction')).toThrowError(AudioEngineError);

    await engine.unlock();
    // Unlocked, but no mix descriptor was ever applied: no character to play.
    expect(() => engine.triggerMachine('extraction')).toThrowError(AudioEngineError);
    expect(contexts[0]!.findNodes('oscillator')).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Mix descriptors                                                            */
/* -------------------------------------------------------------------------- */

describe('era mix descriptors', () => {
  it('applies music level and tone, murmur density, machine level and brightness', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const mix = fixtureMix('2005');
    engine.applyMix(mix, { seconds: 0.05 });

    const state = engine.getMixState();
    expect(state.year).toBe('2005');
    expect(state.mixId).toBe('fixture-mix-2005');
    expect(state.musicLevel).toBeCloseTo(mix.music.level, 6);
    expect(state.ambienceLevel).toBeCloseTo(mix.ambience.level, 6);
    expect(state.ambienceDensity).toBeCloseTo(mix.ambience.density, 6);
    expect(state.machineLevel).toBeCloseTo(mix.machine.level, 6);
    expect(state.masterLevel).toBeCloseTo(mix.master ?? 0.9, 6);
    expect(state.reverbDryWet).toBeCloseTo(mix.reverb?.dryWet ?? 0.25, 6);
    expect(state.sends.music).toBeCloseTo(mix.music.send ?? 0, 6);

    // Applied to the graph, not just remembered.
    const musicBus = engine.getBus('music');
    expect(musicBus).not.toBeNull();
    if (musicBus === null) return;
    expect(gainOf(musicBus.trim).lastRampTarget).toBeCloseTo(mix.music.level, 6);
    expect(engine.getMurmurBed()?.intensity).toBeCloseTo(mix.ambience.density, 6);
    expect(engine.getMachineSfx()?.character.year).toBe('2005');
    // Brightness tilts the bus tones.
    const bright = fixtureMix('2025');
    engine.applyMix(bright, { seconds: 0 });
    expect(engine.getMixState().musicToneHz).toBeGreaterThan(state.musicToneHz);
  });

  it('rejects a missing or malformed descriptor and keeps the previous mix', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    engine.applyMix(fixtureMix('1965'), { seconds: 0 });

    expect(() => engine.applyMix(undefined as unknown as EraMixInput)).toThrowError(AudioDescriptorError);
    expect(() => engine.applyMix(null as unknown as EraMixInput)).toThrowError(AudioDescriptorError);
    expect(() => engine.applyMix({} as EraMixInput)).toThrowError(AudioDescriptorError);
    expect(() => engine.applyMix({ year: '1965' } as EraMixInput)).toThrowError(AudioDescriptorError);
    expect(() =>
      engine.applyMix({
        ...fixtureMix('1965'),
        music: { level: 0.5, toneHz: 'bright' },
      } as unknown as EraMixInput),
    ).toThrowError(AudioDescriptorError);
    expect(() =>
      engine.applyMix({
        ...fixtureMix('1965'),
        machine: { level: 0.5, character: { year: '1965' } },
      } as unknown as EraMixInput),
    ).toThrowError(AudioDescriptorError);

    const state = engine.getMixState();
    expect(state.mixId).toBe('fixture-mix-1965');
    expect(state.year).toBe('1965');
  });

  it('transitions mix, program and bed in one call', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    const before = engine.getMusicScheduler();
    engine.transitionTo({
      year: '1985',
      mix: fixtureMix('1985'),
      program: fixtureProgram('1985'),
      ambience: fixtureAmbience('1985'),
      crossfadeSeconds: 0.5,
    });
    expect(engine.getMusicScheduler()).not.toBe(before);
    expect(engine.getMurmurBed()?.spec.year).toBe('1985');
    const state = engine.getMixState();
    expect(state.year).toBe('1985');
    expect(state.mixId).toBe('fixture-mix-1985');
    expect(state.programId).toBe('fixture-program-1985');
    expect(state.ambienceId).toBe('fixture-ambience-1985');
    advance(engine, 2);
    expect(before?.disposed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Limiter                                                                    */
/* -------------------------------------------------------------------------- */

describe('master limiter', () => {
  it('leaves the mix alone at idle and ducks when one-shots stack up', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    advance(engine, 1);
    expect(engine.getLimiterReduction()).toBe(1);

    const master = engine.getMaster();
    expect(master).not.toBeNull();
    if (master === null) return;
    const headroom = asParam(master.limiter.gain.gain);
    const reductionBefore = engine.getLimiterReduction();

    // Every bus at maximum, with one-shots stacked on top of the murmur.
    engine.setBusGain('music', 1, 0);
    engine.setBusGain('ambience', 1, 0);
    engine.setBusGain('machine', 1.4, 0);
    for (let index = 0; index < 12; index += 1) {
      engine.triggerMachine('steamPurge', { level: 1.6, velocity: 1 });
      engine.triggerMachine('grinder', { level: 1.5, velocity: 1 });
    }
    engine.update(0.05);

    const reduction = engine.getLimiterReduction();
    expect(reduction).toBeLessThan(1);
    expect(reduction).toBeLessThan(reductionBefore);
    expect(reduction).toBeGreaterThanOrEqual(0.35);
    // The attenuation is observable in the recorded graph, in the same chain.
    expect(headroom.rampTargets.some((target) => target < 1)).toBe(true);
    const limiterEvents = engine.getEventLog().filter((event) => event.kind === 'limiter');
    expect(limiterEvents.length).toBeGreaterThan(0);
    const last = limiterEvents[limiterEvents.length - 1];
    expect(Number(last?.detail?.['reduction'] ?? 1)).toBeLessThan(1);
    expect(Number(last?.detail?.['reductionDb'] ?? 0)).toBeLessThan(0);
    expect(asNode(master.limiter.output).feeds(asNode(master.master))).toBe(true);
    expect(asNode(master.master).feeds((engine.context as unknown as FakeAudioContext).destination)).toBe(
      true,
    );
    // Headroom ducking times the master level keeps the output inside full scale.
    const state = engine.getMixState();
    expect(engine.getLimiterReduction() * state.masterLevel).toBeLessThanOrEqual(1);
    expect(state.limiterReduction).toBeLessThan(1);
  });

  it('recovers headroom once the one-shots have finished', async () => {
    const { engine } = createHarness();
    await engine.unlock();
    for (let index = 0; index < 16; index += 1) {
      engine.triggerMachine('grinder', { level: 1.8, velocity: 1 });
    }
    engine.update(0.05);
    expect(engine.getLimiterReduction()).toBeLessThan(1);
    advance(engine, 30);
    expect(engine.getLimiterReduction()).toBe(1);
    expect(engine.getMachineSfx()?.activeOneShotCount).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Determinism                                                                */
/* -------------------------------------------------------------------------- */

describe('determinism', () => {
  async function runScript(seed: number): Promise<string> {
    const { engine } = createHarness(seed);
    await engine.unlock();
    advance(engine, 1);
    engine.triggerMachine('extraction');
    engine.triggerMachine('cupClatter');
    advance(engine, 1);
    engine.transitionTo({ year: '1985', mix: fixtureMix('1985'), program: fixtureProgram('1985') });
    advance(engine, 2);
    engine.setAmbienceIntensity(0.85, 0.3);
    for (let index = 0; index < 3; index += 1) engine.triggerMachine('grinder');
    advance(engine, 2);
    engine.transitionTo({ year: '2025', mix: fixtureMix('2025'), program: fixtureProgram('2025'), ambience: fixtureAmbience('2025') });
    advance(engine, 2);
    await engine.suspend();
    await engine.unlock();
    advance(engine, 1);
    const log = JSON.stringify(engine.getEventLog());
    engine.dispose();
    return log;
  }

  it('produces identical schedules and event logs for identical seeds', async () => {
    const first = await runScript(20240915);
    const second = await runScript(20240915);
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(500);
  });

  it('produces different schedules for different seeds', async () => {
    const first = await runScript(20240915);
    const other = await runScript(4242);
    expect(other).not.toBe(first);
  });
});

/* -------------------------------------------------------------------------- */
/* Teardown and re-initialisation                                             */
/* -------------------------------------------------------------------------- */

describe('dispose and re-initialise', () => {
  it('stops every source, disconnects every node, releases the reverb and closes', async () => {
    const { engine, contexts } = createHarness();
    await engine.unlock();
    advance(engine, 2);
    engine.triggerMachine('cupClatter');
    const context = contexts[0];
    expect(context).toBeDefined();
    if (context === undefined) return;

    const convolver = context.findNodesWhere<FakeConvolverNode>('convolver', () => true)[0];
    expect(context.connectedNodes.length).toBeGreaterThan(0);
    const started = context.sources.filter((source) => source.started);
    expect(started.length).toBeGreaterThan(0);

    engine.dispose();

    expect(engine.state).toBe('locked');
    expect(engine.isDisposed).toBe(true);
    expect(engine.context).toBeNull();
    expect(engine.getMusicScheduler()).toBeNull();
    expect(engine.getMurmurBed()).toBeNull();
    expect(context.closeCalls).toBe(1);
    expect(context.state).toBe('closed');
    expect(context.connectedNodes).toHaveLength(0);
    expect(context.runningSources).toHaveLength(0);
    expect(started.every((source) => source.stopped)).toBe(true);
    expect(convolver?.buffer).toBeNull();

    // Idempotent: disposing twice is safe and does not close a second context.
    engine.dispose();
    expect(context.closeCalls).toBe(1);

    // Nothing further can be scheduled or triggered through the disposed engine.
    const eventsAfterDispose = engine.getEventLog().length;
    engine.update(1);
    expect(engine.getEventLog().length).toBe(eventsAfterDispose);
    expect(() => engine.triggerMachine('grinder')).toThrowError(AudioEngineError);
  });

  it('can be unlocked and driven again after dispose', async () => {
    const { engine, contexts } = createHarness();
    await engine.unlock();
    advance(engine, 1);
    // A long crossfade leaves a retirement pending; dispose must clear it too.
    engine.setMusicProgram(fixtureProgram('2025'), { crossfadeSeconds: 30 });
    engine.setAmbience(fixtureAmbience('2025'), { crossfadeSeconds: 30 });
    engine.dispose();
    expect(contexts[0]?.connectedNodes).toHaveLength(0);
    expect(contexts[0]?.runningSources).toHaveLength(0);

    expect(await engine.unlock()).toBe('running');
    expect(engine.isDisposed).toBe(false);
    expect(contexts).toHaveLength(2);
    const second = contexts[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    expect(second.resumeCalls).toBe(1);
    expect(second.findNodesWhere<FakeConvolverNode>('convolver', () => true)).toHaveLength(1);
    expect(engine.getMusicScheduler()?.disposed).toBe(false);
    expect(engine.getMurmurBed()).not.toBeNull();
    expect(engine.getMachineSfx()).not.toBeNull();

    advance(engine, 1);
    engine.triggerMachine('grinder');
    expect(second.countNodes('oscillator')).toBeGreaterThan(0);

    engine.dispose();
    expect(second.closeCalls).toBe(1);
    expect(second.connectedNodes).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Source hygiene                                                             */
/* -------------------------------------------------------------------------- */

describe('audio sources stay synthesised', () => {
  const modules = import.meta.glob<string>('../../src/audio/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  });

  it('ships the whole audio module set', () => {
    expect(Object.keys(modules).sort()).toEqual([
      '../../src/audio/AudioEngine.ts',
      '../../src/audio/ambience.ts',
      '../../src/audio/buses.ts',
      '../../src/audio/index.ts',
      '../../src/audio/machineSfx.ts',
      '../../src/audio/music.ts',
      '../../src/audio/program.ts',
      '../../src/audio/reverb.ts',
      '../../src/audio/types.ts',
    ]);
  });

  it('loads no audio files, reaches no network and imports no Node built-ins', () => {
    for (const [path, source] of Object.entries(modules)) {
      expect(source, path).not.toMatch(/\bfetch\s*\(/);
      expect(source, path).not.toMatch(/new\s+Audio\s*\(/);
      expect(source, path).not.toMatch(/HTMLAudioElement|createElement\s*\(\s*['"]audio/i);
      expect(source, path).not.toMatch(/\.(mp3|wav|ogg|m4a|aac|flac|opus)\b/i);
      expect(source, path).not.toMatch(/from\s+['"]node:/);
      expect(source, path).not.toMatch(/\brequire\s*\(/);
      expect(source, path).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/);
    }
  });

  it('constructs browser audio contexts only through the injected factory', async () => {
    const source = modules['../../src/audio/types.ts'];
    expect(source).toBeDefined();
    expect(source ?? '').toMatch(/createBrowserAudioContextFactory/);
    expect(source ?? '').not.toMatch(/new\s+(AudioContext|webkitAudioContext)\s*\(/);
    const context = new FakeAudioContext();
    expect(context.state).toBe('suspended');
  });
});

/* -------------------------------------------------------------------------- */
/* Composition surface                                                        */
/* -------------------------------------------------------------------------- */

describe('scene module adapter', () => {
  it('exposes the engine, applies each era and disposes through the adapter', async () => {
    const { engine } = createHarness(777);
    const module = createAudioSceneModule({
      engine,
      provider: {
        mix: (year) => fixtureMix(year),
        program: (year) => fixtureProgram(year),
        ambience: (year) => fixtureAmbience(year),
      },
    });
    expect(module.id).toBe('cafe-audio-engine');
    expect(module.engine).toBe(engine);
    expect(module.getHotspots()).toHaveLength(0);
    await module.unlock();
    expect(engine.state).toBe('running');
    module.dispose();
    expect(engine.isDisposed).toBe(true);
  });

  it('varies the murmur density and archetype per year', async () => {
    const { engine } = createHarness(31);
    const module = createAudioSceneModule({
      engine,
      crossfadeSeconds: 0.2,
      provider: {
        mix: (year) => fixtureMix(year),
        program: (year) => fixtureProgram(year),
        ambience: (year) => fixtureAmbience(year),
      },
    });
    await module.unlock();
    const archetypes = new Set<string>();
    const densities = new Set<number>();
    for (const year of YEAR_IDS) {
      engine.applyMix(fixtureMix(year), { seconds: 0 });
      engine.setAmbience(fixtureAmbience(year), { crossfadeSeconds: 0 });
      const state = engine.getMixState();
      expect(state.year).toBe(year);
      expect(engine.getMachineSfx()?.character.year).toBe(year);
      archetypes.add(engine.getMachineSfx()?.character.extraction.archetype ?? '');
      densities.add(state.ambienceDensity);
      advance(engine, 0.5);
    }
    expect(archetypes.size).toBe(YEAR_IDS.length);
    expect(densities.size).toBe(YEAR_IDS.length);
    expect(MACHINE_ARCHETYPES.length).toBeGreaterThanOrEqual(YEAR_IDS.length);
  });
});
