/**
 * Audio bus behaviour, verified against a stubbed AudioContext.
 *
 * The stub is a small but real WebAudio-shaped graph: it records node creation,
 * `connect` wiring, AudioParam scheduling, source start/stop and context
 * lifecycle calls. That lets these tests assert the *audible* contract of
 * `src/audio/audio.ts` without a browser:
 *
 *  - nothing exists before `unlock()`, and the explicit unlock resumes exactly
 *    one context;
 *  - domain events map to distinct synthesized cue configurations;
 *  - mute zeroes the master gain and refuses synthesis while leaving every node,
 *    the ambience bed and the context alive;
 *  - reduced motion removes whooshes/glissandi but never silences a cue;
 *  - disposal disconnects every node, stops every source and closes the context
 *    exactly once, and is a no-op the second time.
 *
 * Runs in the default Node environment: injecting the context factory is what
 * keeps the bus testable without a DOM.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AUDIO_CUES,
  CUE_PROFILES,
  createAudioBus,
  isMotionVoice,
  type AudioBus,
  type AudioBusOptions,
} from '../src/audio/audio';
import { createDomainEventChannel } from '../src/game/events';
import { makeDomainEvent } from '../src/sim/state';

/* -------------------------------------------------------------------------- */
/* Stubbed WebAudio graph                                                     */
/* -------------------------------------------------------------------------- */

interface ParamEvent {
  kind: 'set' | 'linear' | 'exponential' | 'target' | 'cancel';
  value: number;
  time: number;
  constant?: number;
}

/** Minimal AudioParam stand-in that remembers its automation timeline. */
class StubParam {
  value = 0;
  readonly events: ParamEvent[] = [];

  setValueAtTime(value: number, time: number): StubParam {
    this.value = value;
    this.events.push({ kind: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): StubParam {
    this.value = value;
    this.events.push({ kind: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): StubParam {
    this.value = value;
    this.events.push({ kind: 'exponential', value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number, constant: number): StubParam {
    this.value = value;
    this.events.push({ kind: 'target', value, time, constant });
    return this;
  }

  cancelScheduledValues(time: number): void {
    this.events.push({ kind: 'cancel', value: this.value, time });
  }

  /** Ramp events only: the motion this bus must avoid under reduced motion. */
  get ramps(): ParamEvent[] {
    return this.events.filter((event) => event.kind === 'linear' || event.kind === 'exponential');
  }
}

class StubNode {
  readonly outputs: StubNode[] = [];
  readonly allParams: StubParam[] = [];
  disconnected = false;

  constructor(
    readonly kind: string,
    readonly id: number,
  ) {}

  connect(target: unknown): unknown {
    if (target instanceof StubNode) this.outputs.push(target);
    return target;
  }

  disconnect(): void {
    this.disconnected = true;
    this.outputs.length = 0;
  }
}

class StubGain extends StubNode {
  readonly gain = new StubParam();

  constructor(id: number) {
    super('gain', id);
    this.allParams.push(this.gain);
  }
}

class StubFilter extends StubNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new StubParam();
  readonly Q = new StubParam();
  readonly detune = new StubParam();

  constructor(id: number) {
    super('filter', id);
    this.allParams.push(this.frequency, this.Q, this.detune);
  }
}

class StubCompressor extends StubNode {
  readonly threshold = new StubParam();
  readonly knee = new StubParam();
  readonly ratio = new StubParam();
  readonly attack = new StubParam();
  readonly release = new StubParam();

  constructor(id: number) {
    super('compressor', id);
    this.allParams.push(this.threshold, this.knee, this.ratio, this.attack, this.release);
  }
}

class StubSource extends StubNode {
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: ((event?: unknown) => void) | null = null;

  start(when = 0): void {
    this.startedAt = when;
  }

  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

class StubOscillator extends StubSource {
  type: OscillatorType = 'sine';
  readonly frequency = new StubParam();
  readonly detune = new StubParam();

  constructor(id: number) {
    super('oscillator', id);
    this.allParams.push(this.frequency, this.detune);
  }
}

class StubBufferSource extends StubSource {
  buffer: StubBuffer | null = null;
  loop = false;
  readonly playbackRate = new StubParam();

  constructor(id: number) {
    super('buffer-source', id);
    this.allParams.push(this.playbackRate);
  }
}

class StubBuffer {
  private readonly data: Float32Array;

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(_channel: number): Float32Array {
    return this.data;
  }
}

/** Stubbed AudioContext: the whole observable surface of the bus under test. */
class StubAudioContext {
  readonly created: StubNode[] = [];
  readonly destination = new StubNode('destination', -1);
  readonly sampleRate = 48_000;
  currentTime = 0;
  state: AudioContextState = 'suspended';
  resumeCount = 0;
  suspendCount = 0;
  closeCount = 0;

  private nextId = 0;

  get gains(): StubGain[] {
    return this.created.filter((node): node is StubGain => node instanceof StubGain);
  }

  get oscillators(): StubOscillator[] {
    return this.created.filter((node): node is StubOscillator => node instanceof StubOscillator);
  }

  get noiseSources(): StubBufferSource[] {
    return this.created.filter((node): node is StubBufferSource => node instanceof StubBufferSource);
  }

  get sources(): StubSource[] {
    return this.created.filter((node): node is StubSource => node instanceof StubSource);
  }

  /** The single gain feeding the compressor: the bus's mute point. */
  masterGain(): StubGain {
    const compressor = this.created.find((node) => node instanceof StubCompressor);
    const master = this.gains.find((gain) => compressor !== undefined && gain.outputs.includes(compressor));
    if (!master) throw new Error('stub graph has no master gain');
    return master;
  }

  /** Hum/whirr/shimmer modulation runs far below 1 Hz. */
  get modulationOscillators(): StubOscillator[] {
    return this.oscillators.filter((osc) => osc.frequency.value < 1);
  }

  createGain(): StubGain {
    return this.track(new StubGain(this.nextId++));
  }

  createOscillator(): StubOscillator {
    return this.track(new StubOscillator(this.nextId++));
  }

  createBufferSource(): StubBufferSource {
    return this.track(new StubBufferSource(this.nextId++));
  }

  createBiquadFilter(): StubFilter {
    return this.track(new StubFilter(this.nextId++));
  }

  createDynamicsCompressor(): StubCompressor {
    return this.track(new StubCompressor(this.nextId++));
  }

  createBuffer(channels: number, length: number, sampleRate: number): StubBuffer {
    return new StubBuffer(channels, length, sampleRate);
  }

  resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCount += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCount += 1;
    this.state = 'closed';
    return Promise.resolve();
  }

  private track<T extends StubNode>(node: T): T {
    this.created.push(node);
    return node;
  }
}

/* -------------------------------------------------------------------------- */
/* Harness and helpers                                                        */
/* -------------------------------------------------------------------------- */

interface Harness {
  readonly ctx: StubAudioContext;
  readonly bus: AudioBus;
  /** How many times the injected factory was called. */
  creations(): number;
}

function createHarness(options: AudioBusOptions = {}): Harness {
  const ctx = new StubAudioContext();
  let creations = 0;
  const bus = createAudioBus({
    ...options,
    createContext: () => {
      creations += 1;
      return ctx as unknown as AudioContext;
    },
  });
  return { ctx, bus, creations: () => creations };
}

function createdSince(ctx: StubAudioContext, mark: number): StubNode[] {
  return ctx.created.slice(mark);
}

function tones(nodes: readonly StubNode[]): StubOscillator[] {
  return nodes.filter((node): node is StubOscillator => node instanceof StubOscillator);
}

function noises(nodes: readonly StubNode[]): StubBufferSource[] {
  return nodes.filter((node): node is StubBufferSource => node instanceof StubBufferSource);
}

function frequencies(nodes: readonly StubOscillator[]): number[] {
  return nodes.map((osc) => osc.frequency.events[0]?.value ?? osc.frequency.value);
}

/** Frequency automation (glissandi and filter sweeps) inside a node slice. */
function frequencyRamps(nodes: readonly StubNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node instanceof StubOscillator || node instanceof StubFilter) {
      count += node.frequency.ramps.length;
    }
  }
  return count;
}

/** Filter nodes whose cutoff is swept: the whoosh layers. */
function sweptFilters(nodes: readonly StubNode[]): number {
  return nodes.filter((node): node is StubFilter => node instanceof StubFilter && node.frequency.ramps.length > 0)
    .length;
}

/* -------------------------------------------------------------------------- */
/* Gesture gating                                                             */
/* -------------------------------------------------------------------------- */

describe('audio bus — gesture gating', () => {
  it('touches no WebAudio API before unlock()', () => {
    const harness = createHarness();

    expect(harness.bus.context).toBeNull();
    expect(harness.bus.unlocked).toBe(false);
    expect(harness.bus.stats.contextsCreated).toBe(0);

    // Preferences, cues and domain events are all safe pre-gesture.
    harness.bus.setMuted(true);
    harness.bus.setReducedMotion(true);
    harness.bus.setAmbienceEnabled(false);
    expect(harness.bus.trigger('ui-click')).toBe(false);
    harness.bus.handleEvent(makeDomainEvent('lane/assigned', { laneId: 'lane-build', taskId: 't-a' }, 0));

    expect(harness.creations()).toBe(0);
    expect(harness.ctx.created).toHaveLength(0);
    expect(harness.ctx.resumeCount).toBe(0);
    expect(harness.ctx.suspendCount).toBe(0);
    expect(harness.bus.stats.cuesPlayed).toBe(0);
    expect(harness.bus.stats.cuesSuppressed).toBeGreaterThanOrEqual(2);
  });

  it('creates and resumes exactly one context on unlock() and starts the ambience bed', async () => {
    const harness = createHarness();

    expect(await harness.bus.unlock()).toBe(true);
    expect(harness.creations()).toBe(1);
    expect(harness.ctx.resumeCount).toBe(1);
    expect(harness.ctx.state).toBe('running');
    expect(harness.bus.context).toBe(harness.ctx);
    expect(harness.bus.unlocked).toBe(true);

    // The bed is continuous: started, looping, and never stopped.
    expect(harness.ctx.sources.length).toBeGreaterThanOrEqual(3);
    for (const source of harness.ctx.sources) {
      expect(source.startedAt).not.toBeNull();
      expect(source.stoppedAt).toBeNull();
    }
    expect(harness.ctx.noiseSources.every((source) => source.loop)).toBe(true);
    // Two detuned saws carry the hum.
    expect(harness.ctx.oscillators.filter((osc) => osc.type === 'sawtooth')).toHaveLength(2);

    // A second unlock reuses the same voice and context.
    expect(await harness.bus.unlock()).toBe(true);
    expect(harness.creations()).toBe(1);
    expect(harness.ctx.resumeCount).toBe(1);
  });

  it('unlocks from the first pointer or key gesture and detaches afterwards', async () => {
    const target = new EventTarget();

    const viaGesture = createHarness();
    viaGesture.bus.attachUnlockOnGesture(target);
    target.dispatchEvent(new Event('keydown'));

    // Creation and resume happen in the gesture's own task, not a later tick.
    expect(viaGesture.creations()).toBe(1);
    expect(viaGesture.ctx.resumeCount).toBe(1);
    expect(viaGesture.bus.unlocked).toBe(true);
    expect(await viaGesture.bus.unlock()).toBe(true);

    // A detached listener no longer unlocks.
    const detached = createHarness();
    const detach = detached.bus.attachUnlockOnGesture(target);
    detach();
    target.dispatchEvent(new Event('pointerdown'));
    expect(detached.creations()).toBe(0);
  });

  it('stays silent and reports failure when WebAudio is unavailable', async () => {
    const bus = createAudioBus({
      createContext: () => {
        throw new Error('no WebAudio here');
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await bus.unlock()).toBe(false);
    expect(bus.unlocked).toBe(false);
    expect(bus.trigger('ui-click')).toBe(false);
    expect(bus.stats.contextsCreated).toBe(0);
    expect(warn).toHaveBeenCalled();

    bus.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Event → cue mapping                                                        */
/* -------------------------------------------------------------------------- */

describe('audio bus — cue mapping', () => {
  it('plays a distinct cue for dispatch, pass, fail, repair, release and UI clicks', async () => {
    const harness = createHarness();
    await harness.bus.unlock();

    // Dispatch: filtered air plus a two-step blip.
    let mark = harness.ctx.created.length;
    harness.bus.handleEvent(makeDomainEvent('lane/assigned', { laneId: 'lane-build', taskId: 't-a' }, 0));
    expect(harness.bus.stats.lastCue).toBe('dispatch');
    const dispatch = createdSince(harness.ctx, mark);
    expect(tones(dispatch).length).toBeGreaterThanOrEqual(3);
    expect(noises(dispatch)).toHaveLength(1);
    expect(sweptFilters(dispatch)).toBe(1);

    // Gate pass: bright rising arpeggio.
    mark = harness.ctx.created.length;
    harness.bus.handleEvent(
      makeDomainEvent('verification/run', { gateId: 'g-type', status: 'passed', coverage: 1 }, 100),
    );
    expect(harness.bus.stats.lastCue).toBe('gate-pass');
    const pass = createdSince(harness.ctx, mark);
    const passFrequencies = frequencies(tones(pass));
    expect(passFrequencies).toContain(880);
    expect(new Set(tones(pass).map((osc) => osc.type)).has('sine')).toBe(true);

    // Gate fail: low detuned buzzer plus a falling alarm.
    mark = harness.ctx.created.length;
    harness.bus.handleEvent(
      makeDomainEvent('verification/run', { gateId: 'g-lint', status: 'failed', coverage: 0.4 }, 200),
    );
    expect(harness.bus.stats.lastCue).toBe('gate-fail');
    const fail = createdSince(harness.ctx, mark);
    const failFrequencies = frequencies(tones(fail));
    expect(new Set(tones(fail).map((osc) => osc.type)).has('sawtooth')).toBe(true);
    expect(Math.max(...failFrequencies)).toBeLessThan(Math.max(...passFrequencies));
    expect(new Set(failFrequencies)).not.toEqual(new Set(passFrequencies));
    expect(sweptFilters(fail)).toBe(1);

    // Repair: the failed gate runs again, and only that first retry speaks.
    mark = harness.ctx.created.length;
    harness.bus.handleEvent(
      makeDomainEvent('verification/run', { gateId: 'g-lint', status: 'running', coverage: 0.2 }, 300),
    );
    expect(harness.bus.stats.lastCue).toBe('repair');
    const repair = createdSince(harness.ctx, mark);
    expect(tones(repair).length).toBeGreaterThanOrEqual(3);
    expect(new Set(frequencies(tones(repair)))).not.toEqual(new Set(passFrequencies));

    // Repeated progress updates stay silent; a failure has one repair.
    const playedAfterRepair = harness.bus.stats.cuesPlayed;
    harness.bus.handleEvent(
      makeDomainEvent('verification/run', { gateId: 'g-lint', status: 'running', coverage: 0.6 }, 400),
    );
    expect(harness.bus.stats.cuesPlayed).toBe(playedAfterRepair);

    // A rerun that passes is a pass again, and clears the failure memory.
    harness.bus.handleEvent(
      makeDomainEvent('verification/run', { gateId: 'g-lint', status: 'passed', coverage: 1 }, 450),
    );
    expect(harness.bus.stats.lastCue).toBe('gate-pass');

    // Task-level failure and retry use the same vocabulary.
    harness.bus.handleEvent(makeDomainEvent('plan/task-updated', { taskId: 't-a', status: 'failed' }, 500));
    expect(harness.bus.stats.lastCue).toBe('gate-fail');
    harness.bus.handleEvent(makeDomainEvent('plan/task-updated', { taskId: 't-a', status: 'running' }, 600));
    expect(harness.bus.stats.lastCue).toBe('repair');

    // Release: a lane hands its task back.
    harness.bus.handleEvent(makeDomainEvent('lane/released', { laneId: 'lane-build', taskId: 't-a' }, 700));
    expect(harness.bus.stats.lastCue).toBe('release');

    // UI clicks are triggered imperatively by the input router.
    expect(harness.bus.trigger('ui-click')).toBe(true);
    expect(harness.bus.stats.lastCue).toBe('ui-click');

    // Unmapped bookkeeping events stay silent.
    const before = harness.ctx.created.length;
    harness.bus.handleEvent(makeDomainEvent('economy/reward', { credits: 100, reputation: 1 }, 800));
    harness.bus.handleEvent(
      makeDomainEvent('quality/measured', { metric: { id: 'm-fidelity', label: 'Fidelity', value: 0.5 } }, 810),
    );
    harness.bus.handleEvent(makeDomainEvent('mission/status', { status: 'delivering' }, 820));
    expect(harness.ctx.created).toHaveLength(before);
    expect(harness.bus.stats.lastCue).toBe('ui-click');
  });

  it('gives every cue its own voice signature and a non-motion core', () => {
    const signatures = AUDIO_CUES.map((cue) => JSON.stringify(CUE_PROFILES[cue].voices));
    expect(new Set(signatures).size).toBe(AUDIO_CUES.length);

    for (const cue of AUDIO_CUES) {
      expect(CUE_PROFILES[cue].label.length).toBeGreaterThan(0);
      expect(CUE_PROFILES[cue].description.length).toBeGreaterThan(0);
      // Reduced motion drops motion layers, so a stationary core must remain.
      expect(CUE_PROFILES[cue].voices.some((voice) => !isMotionVoice(voice))).toBe(true);
    }
  });

  it('subscribes to a domain event channel and unsubscribes on dispose', async () => {
    const harness = createHarness();
    const channel = createDomainEventChannel();
    const unsubscribe = harness.bus.connect(channel);
    await harness.bus.unlock();

    channel.emit(makeDomainEvent('lane/assigned', { laneId: 'lane-build', taskId: 't-a' }, 0));
    expect(harness.bus.stats.lastCue).toBe('dispatch');
    expect(harness.bus.stats.cuesPlayed).toBe(1);

    unsubscribe();
    channel.emit(makeDomainEvent('lane/released', { laneId: 'lane-build', taskId: 't-a' }, 1));
    expect(harness.bus.stats.cuesPlayed).toBe(1);

    harness.bus.connect(channel);
    channel.emit(makeDomainEvent('lane/released', { laneId: 'lane-build', taskId: 't-a' }, 2));
    expect(harness.bus.stats.lastCue).toBe('release');

    harness.bus.dispose();
    channel.emit(makeDomainEvent('lane/assigned', { laneId: 'lane-build', taskId: 't-b' }, 3));
    expect(harness.bus.stats.cuesPlayed).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Mute                                                                       */
/* -------------------------------------------------------------------------- */

describe('audio bus — mute', () => {
  it('silences the output without tearing the graph down', async () => {
    const harness = createHarness();
    await harness.bus.unlock();

    const master = harness.ctx.masterGain();
    expect(master.gain.value).toBeGreaterThan(0);
    const ambienceSources = harness.ctx.sources.length;
    const nodesBefore = harness.ctx.created.length;

    harness.bus.setMuted(true);
    expect(harness.bus.muted).toBe(true);
    expect(harness.bus.stats.outputLevel).toBe(0);
    // The single mute point is zeroed…
    expect(master.gain.value).toBe(0);
    // …while the graph, the sources and the context survive untouched.
    expect(harness.ctx.state).toBe('running');
    expect(harness.ctx.closeCount).toBe(0);
    expect(harness.ctx.created.every((node) => !node.disconnected)).toBe(true);
    expect(harness.ctx.sources.every((source) => source.stoppedAt === null)).toBe(true);

    // Cues are refused rather than synthesized into a muted graph.
    expect(harness.bus.trigger('ui-click')).toBe(false);
    harness.bus.handleEvent(makeDomainEvent('lane/assigned', { laneId: 'lane-build', taskId: 't-a' }, 0));
    expect(harness.ctx.created).toHaveLength(nodesBefore);
    expect(harness.ctx.sources).toHaveLength(ambienceSources);
    expect(harness.bus.stats.cuesSuppressed).toBeGreaterThanOrEqual(2);
    expect(harness.bus.stats.cuesPlayed).toBe(0);

    harness.bus.setMuted(false);
    expect(harness.bus.muted).toBe(false);
    expect(master.gain.value).toBeGreaterThan(0);
    expect(harness.bus.trigger('ui-click')).toBe(true);
  });

  it('honours a mute requested before unlock', async () => {
    const harness = createHarness({ muted: true });
    harness.bus.setMuted(true);
    expect(harness.creations()).toBe(0);

    await harness.bus.unlock();
    expect(harness.ctx.masterGain().gain.value).toBe(0);
    // The bed still exists so unmuting is instant.
    expect(harness.ctx.sources.length).toBeGreaterThan(0);
  });

  it('stops and restarts the ambience bed on request without touching cues', async () => {
    const harness = createHarness();
    await harness.bus.unlock();
    const ambienceSources = [...harness.ctx.sources];
    expect(ambienceSources.length).toBeGreaterThan(0);

    harness.bus.setAmbienceEnabled(false);
    expect(ambienceSources.every((source) => source.stoppedAt !== null)).toBe(true);
    expect(ambienceSources.every((source) => source.disconnected)).toBe(true);

    harness.bus.setAmbienceEnabled(true);
    const restarted = harness.ctx.sources.filter((source) => source.stoppedAt === null);
    expect(restarted.length).toBe(ambienceSources.length);
    expect(harness.bus.trigger('ui-click')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Reduced motion                                                             */
/* -------------------------------------------------------------------------- */

describe('audio bus — reduced motion', () => {
  it('drops whooshes and glissandi while keeping cues audible and distinct', async () => {
    async function capture(reducedMotion: boolean): Promise<{
      pass: StubNode[];
      fail: StubNode[];
      dispatch: StubNode[];
    }> {
      const harness = createHarness({ reducedMotion });
      await harness.bus.unlock();
      let mark = harness.ctx.created.length;
      harness.bus.trigger('gate-pass');
      const pass = createdSince(harness.ctx, mark);
      mark = harness.ctx.created.length;
      harness.bus.trigger('gate-fail');
      const fail = createdSince(harness.ctx, mark);
      mark = harness.ctx.created.length;
      harness.bus.trigger('dispatch');
      const dispatch = createdSince(harness.ctx, mark);
      return { pass, fail, dispatch };
    }

    const full = await capture(false);
    const reduced = await capture(true);

    // Motion layers exist normally…
    expect(frequencyRamps(full.pass)).toBeGreaterThan(0);
    expect(frequencyRamps(full.fail)).toBeGreaterThan(0);
    expect(sweptFilters(full.fail)).toBe(1);
    expect(sweptFilters(full.dispatch)).toBe(1);

    // …and are gone under reduced motion.
    expect(frequencyRamps(reduced.pass)).toBe(0);
    expect(frequencyRamps(reduced.fail)).toBe(0);
    expect(sweptFilters(reduced.fail)).toBe(0);
    expect(sweptFilters(reduced.dispatch)).toBe(0);

    // The stationary core keeps both gates recognizable: a bright high
    // arpeggio for a pass, a low buzzer for a fail.
    const reducedPass = frequencies(tones(reduced.pass));
    const reducedFail = frequencies(tones(reduced.fail));
    expect(reducedPass.length).toBeGreaterThanOrEqual(3);
    expect(reducedFail.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...reducedPass)).toBeGreaterThan(400);
    expect(Math.max(...reducedFail)).toBeLessThan(400);
    expect(tones(reduced.dispatch).length).toBeGreaterThanOrEqual(3);
  });

  it('applies a live reduced-motion change to the bed and to later cues', async () => {
    const harness = createHarness();
    await harness.bus.unlock();

    const modulation = harness.ctx.modulationOscillators.length;
    expect(modulation).toBeGreaterThanOrEqual(3);
    const beforeChange = [...harness.ctx.sources];
    const isModulation = (source: StubSource): boolean =>
      source instanceof StubOscillator && source.frequency.value < 1;
    const steadySources = beforeChange.filter((source) => !isModulation(source)).length;

    harness.bus.setReducedMotion(true);
    expect(harness.bus.reducedMotion).toBe(true);
    // The old bed is retired…
    expect(beforeChange.every((source) => source.stoppedAt !== null)).toBe(true);
    expect(beforeChange.every((source) => source.disconnected)).toBe(true);
    // …and the replacement keeps the same steady layers without modulation.
    const live = harness.ctx.sources.filter((source) => source.stoppedAt === null);
    expect(live).toHaveLength(steadySources);
    expect(live.filter(isModulation)).toHaveLength(0);

    // Cues stop sweeping immediately as well.
    const mark = harness.ctx.created.length;
    harness.bus.trigger('dispatch');
    expect(sweptFilters(createdSince(harness.ctx, mark))).toBe(0);

    // Turning it back off restores the modulation layers.
    harness.bus.setReducedMotion(false);
    expect(harness.ctx.modulationOscillators.filter((osc) => osc.stoppedAt === null).length).toBeGreaterThanOrEqual(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Disposal                                                                   */
/* -------------------------------------------------------------------------- */

describe('audio bus — disposal', () => {
  it('disconnects every node, stops every source and closes the context once', async () => {
    const harness = createHarness();
    await harness.bus.unlock();
    harness.bus.trigger('dispatch');
    harness.bus.trigger('gate-pass');
    harness.bus.handleEvent(makeDomainEvent('lane/released', { laneId: 'lane-build', taskId: 't-a' }, 900));
    expect(harness.ctx.created.length).toBeGreaterThan(10);

    harness.bus.dispose();

    expect(harness.bus.disposed).toBe(true);
    expect(harness.bus.unlocked).toBe(false);
    expect(harness.ctx.created.every((node) => node.disconnected)).toBe(true);
    expect(harness.ctx.sources.every((source) => source.stoppedAt !== null)).toBe(true);
    expect(harness.ctx.closeCount).toBe(1);
    expect(harness.ctx.state).toBe('closed');
    expect(harness.bus.stats.activeVoices).toBe(0);
    expect(harness.bus.stats.nodes).toBe(0);

    // A second dispose is a no-op…
    harness.bus.dispose();
    expect(harness.ctx.closeCount).toBe(1);

    // …and the bus refuses to synthesize or rebuild afterwards.
    const before = harness.ctx.created.length;
    expect(harness.bus.trigger('ui-click')).toBe(false);
    harness.bus.handleEvent(makeDomainEvent('lane/assigned', { laneId: 'lane-build', taskId: 't-b' }, 1_000));
    harness.bus.setMuted(false);
    harness.bus.setReducedMotion(true);
    harness.bus.setAmbienceEnabled(true);
    expect(harness.ctx.created).toHaveLength(before);
    expect(await harness.bus.unlock()).toBe(false);
    expect(harness.creations()).toBe(1);
    expect(harness.ctx.resumeCount).toBe(1);
  });

  it('disposes cleanly when it was never unlocked', () => {
    const harness = createHarness();
    expect(() => harness.bus.dispose()).not.toThrow();
    expect(() => harness.bus.dispose()).not.toThrow();
    expect(harness.bus.disposed).toBe(true);
    expect(harness.ctx.closeCount).toBe(0);
    expect(harness.creations()).toBe(0);
  });

  it('detaches pending gesture listeners on dispose', async () => {
    const target = new EventTarget();
    const harness = createHarness();
    harness.bus.attachUnlockOnGesture(target);
    harness.bus.dispose();

    target.dispatchEvent(new Event('pointerdown'));
    expect(harness.creations()).toBe(0);
    expect(await harness.bus.unlock()).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Self-contained synthesis                                                   */
/* -------------------------------------------------------------------------- */

describe('audio bus — self-contained synthesis', () => {
  it('never fetches an asset: every sound is built from WebAudio primitives', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const harness = createHarness();
      await harness.bus.unlock();
      for (const cue of AUDIO_CUES) harness.bus.trigger(cue);

      expect(fetchMock).not.toHaveBeenCalled();
      // Everything audible came from oscillators, noise buffers and filters.
      expect(harness.ctx.oscillators.length).toBeGreaterThan(0);
      expect(harness.ctx.noiseSources.length).toBeGreaterThan(0);
      expect(harness.ctx.noiseSources.every((source) => source.buffer instanceof StubBuffer)).toBe(true);
      expect(harness.ctx.created.every((node) => node.allParams.length > 0 || node instanceof StubFilter)).toBe(
        true,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
