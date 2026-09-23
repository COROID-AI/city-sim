/**
 * Chrono City — AudioDirector suite.
 *
 * Covers the audio engine contract end to end, without a GPU or a real sound
 * card:
 *
 *  - the cue registry (six built-in cues, aliases, era-scoped names);
 *  - autoplay-safe unlocking (lazy context, gesture unlock, affordance/mute);
 *  - master/sfx/music/ambience bus routing and the mute toggle;
 *  - envelope synthesis and deterministic noise buffers;
 *  - positional emitters: panner wiring, distance rolloff, `Object3D` binding;
 *  - the composition seam: `AudioDirector.tick()` driven by a real
 *    `SceneContext` frame, with listener state fed from the camera;
 *  - graceful degradation when the platform has no Web Audio at all.
 *
 * The Web Audio implementation below is a small in-memory stub: it records the
 * node graph, the connections and every scheduled `AudioParam` event, so the
 * assertions inspect the *real* graph the director builds.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { bootChronoCity, getChronoCityAudio, stopChronoCity } from '../../src/main';
import {
  DEFAULT_ERA,
  ERA_IDS,
  type EraId,
  type EraTransitionInfo,
} from '../../src/core/eraContracts';
import {
  createSceneContext,
  type SceneContext,
  type SceneContextOptions,
} from '../../src/core/sceneContext';
import {
  AUDIO_DIRECTOR_VERSION,
  AUDIO_GLOBAL_KEY,
  AUDIO_SYSTEM_ID,
  AUDIO_UNLOCK_ATTRIBUTE,
  DEFAULT_BUS_VOLUMES,
  DEFAULT_MASTER_VOLUME,
  AudioDirector,
  bootAudioDirector,
  createAudioDirector,
  detachAudioDirectorGlobal,
  eraCueName,
  getAudioDirector,
  parseEraCueName,
  rolloffGain,
  supportsWebAudio,
  type AudioCueHandle,
  type AudioEngineContext,
} from '../../src/audio/audioDirector';
import {
  AUDIO_BUS_NAMES,
  CUE_BUS_NAMES,
  SFX_CUE_BUSES,
  SFX_CUE_NAMES,
  createNoiseBuffer,
  createSfxLibrary,
  resolveCueAlias,
  scheduleEnvelope,
  sfxCueBus,
  startVoice,
  type CueBusName,
  type CueDefinition,
} from '../../src/audio/sfxSynth';

/* ------------------------------------------------------------------ */
/* Web Audio stub                                                      */
/* ------------------------------------------------------------------ */

interface ParamEvent {
  readonly type: string;
  readonly value: number;
  readonly time: number;
}

interface StubParam {
  readonly kind: string;
  readonly events: ParamEvent[];
  readonly defaultValue: number;
  readonly minValue: number;
  readonly maxValue: number;
  automationRate: AutomationRate;
  value: number;
  setValueAtTime(value: number, time: number): StubParam;
  linearRampToValueAtTime(value: number, time: number): StubParam;
  exponentialRampToValueAtTime(value: number, time: number): StubParam;
  setTargetAtTime(value: number, time: number, constant: number): StubParam;
  cancelScheduledValues(time: number): StubParam;
  cancelAndHoldAtTime(time: number): StubParam;
  setValueCurveAtTime(values: Float32Array, startTime: number, duration: number): StubParam;
}

function createStubParam(kind: string, value = 0): StubParam {
  const events: ParamEvent[] = [];
  const param: StubParam = {
    kind,
    events,
    defaultValue: value,
    minValue: -3.4028235e38,
    maxValue: 3.4028235e38,
    automationRate: 'a-rate',
    value,
    setValueAtTime(next: number, time: number) {
      param.value = next;
      events.push({ type: 'setValueAtTime', value: next, time });
      return param;
    },
    linearRampToValueAtTime(next: number, time: number) {
      param.value = next;
      events.push({ type: 'linearRampToValueAtTime', value: next, time });
      return param;
    },
    exponentialRampToValueAtTime(next: number, time: number) {
      param.value = next;
      events.push({ type: 'exponentialRampToValueAtTime', value: next, time });
      return param;
    },
    setTargetAtTime(next: number, time: number, constant: number) {
      param.value = next;
      events.push({ type: 'setTargetAtTime', value: next, time: time + constant * 0 });
      return param;
    },
    cancelScheduledValues(time: number) {
      events.push({ type: 'cancelScheduledValues', value: param.value, time });
      return param;
    },
    cancelAndHoldAtTime(time: number) {
      events.push({ type: 'cancelAndHoldAtTime', value: param.value, time });
      return param;
    },
    setValueCurveAtTime(_values: Float32Array, startTime: number, duration: number) {
      events.push({ type: 'setValueCurveAtTime', value: param.value, time: startTime + duration });
      return param;
    },
  };
  return param;
}

function isStubParam(target: unknown): target is StubParam {
  return Boolean(target && typeof (target as StubParam).setValueAtTime === 'function' && !('connect' in (target as object)));
}

/** Base graph node: records outgoing node connections and param modulation. */
class StubNode {
  readonly kind: string;
  readonly outputs: StubNode[] = [];
  readonly paramTargets: StubParam[] = [];
  readonly inputs: StubNode[] = [];

  constructor(kind: string) {
    this.kind = kind;
  }

  connect(target: StubNode | StubParam): unknown {
    if (isStubParam(target)) {
      this.paramTargets.push(target);
      return target;
    }
    this.outputs.push(target);
    target.inputs.push(this);
    return target;
  }

  disconnect(): void {
    for (const target of this.outputs) {
      const index = target.inputs.indexOf(this);
      if (index >= 0) target.inputs.splice(index, 1);
    }
    this.outputs.length = 0;
    this.paramTargets.length = 0;
  }
}

/** Source node with a start/stop lifecycle and an `ended` event. */
class StubSource extends StubNode {
  readonly starts: number[] = [];
  readonly stops: number[] = [];
  onended: (() => void) | null = null;
  private endedListeners: Array<() => void> = [];

  constructor(kind: string) {
    super(kind);
  }

  start(when = 0): void {
    this.starts.push(when);
  }

  stop(when = 0): void {
    this.stops.push(when);
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'ended') this.endedListeners.push(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type !== 'ended') return;
    this.endedListeners = this.endedListeners.filter((entry) => entry !== listener);
  }

  /** Fires the source's natural end, exactly as the browser would. */
  emitEnded(): void {
    const listeners = [...this.endedListeners];
    this.endedListeners = [];
    for (const listener of listeners) listener();
    this.onended?.();
  }
}

class StubGain extends StubNode {
  readonly gain = createStubParam('gain', 1);

  constructor() {
    super('gain');
  }
}

class StubPanner extends StubNode {
  readonly positionX = createStubParam('positionX', 0);
  readonly positionY = createStubParam('positionY', 0);
  readonly positionZ = createStubParam('positionZ', 0);
  panningModel = 'equalpower';
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  coneInnerAngle = 360;
  coneOuterAngle = 360;
  coneOuterGain = 0;

  constructor() {
    super('panner');
  }

  get position(): { x: number; y: number; z: number } {
    return { x: this.positionX.value, y: this.positionY.value, z: this.positionZ.value };
  }
}

class StubOscillator extends StubSource {
  type = 'sine';
  readonly frequency = createStubParam('frequency', 440);
  readonly detune = createStubParam('detune', 0);

  constructor() {
    super('oscillator');
  }
}

class StubBufferSource extends StubSource {
  buffer: StubBuffer | null = null;
  loop = false;
  readonly playbackRate = createStubParam('playbackRate', 1);
  readonly detune = createStubParam('detune', 0);

  constructor() {
    super('bufferSource');
  }
}

class StubBiquadFilter extends StubNode {
  type = 'lowpass';
  readonly frequency = createStubParam('frequency', 350);
  readonly Q = createStubParam('Q', 1);
  readonly gain = createStubParam('gain', 0);
  readonly detune = createStubParam('detune', 0);

  constructor() {
    super('biquad');
  }
}

class StubBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel] as Float32Array;
  }
}

class StubListener {
  readonly positionX = createStubParam('positionX', 0);
  readonly positionY = createStubParam('positionY', 0);
  readonly positionZ = createStubParam('positionZ', 0);
  readonly forwardX = createStubParam('forwardX', 0);
  readonly forwardY = createStubParam('forwardY', 0);
  readonly forwardZ = createStubParam('forwardZ', -1);
  readonly upX = createStubParam('upX', 0);
  readonly upY = createStubParam('upY', 1);
  readonly upZ = createStubParam('upZ', 0);
}

class StubAudioContext {
  readonly destination = new StubNode('destination');
  readonly listener = new StubListener();
  readonly nodes: StubNode[] = [];
  sampleRate = 48000;
  currentTime = 0;
  state: AudioContextState = 'suspended';
  resumeCalls = 0;
  closeCalls = 0;

  createGain(): StubGain {
    return this.track(new StubGain());
  }

  createPanner(): StubPanner {
    return this.track(new StubPanner());
  }

  createOscillator(): StubOscillator {
    return this.track(new StubOscillator());
  }

  createBufferSource(): StubBufferSource {
    return this.track(new StubBufferSource());
  }

  createBiquadFilter(): StubBiquadFilter {
    return this.track(new StubBiquadFilter());
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): StubBuffer {
    return new StubBuffer(numberOfChannels, length, sampleRate);
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
  }

  /** Nodes of one kind, in creation order. */
  byKind(kind: string): StubNode[] {
    return this.nodes.filter((node) => node.kind === kind);
  }

  private track<T extends StubNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}

interface StubHarness {
  readonly stub: StubAudioContext;
  readonly context: AudioEngineContext;
  readonly createContext: () => AudioEngineContext;
}

function createStubHarness(state: AudioContextState = 'suspended'): StubHarness {
  const stub = new StubAudioContext();
  stub.state = state;
  const context = stub as unknown as AudioEngineContext;
  return { stub, context, createContext: () => context };
}

function asNode(value: AudioNode | AudioParam | null | undefined): StubNode {
  if (!value) throw new Error('expected a stub node, got nothing');
  return value as unknown as StubNode;
}

function asPanner(value: PannerNode | null | undefined): StubPanner {
  if (!value) throw new Error('expected a stub panner, got nothing');
  return value as unknown as StubPanner;
}

/** `true` when `to` is reachable from `from` by following node connections. */
function reaches(from: StubNode, to: StubNode): boolean {
  const seen = new Set<StubNode>();
  const queue: StubNode[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as StubNode;
    if (current === to) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...current.outputs);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Harness helpers                                                     */
/* ------------------------------------------------------------------ */

const openDirectors: AudioDirector[] = [];
const openContexts: SceneContext[] = [];

function openDirector(options: Parameters<typeof createAudioDirector>[0] = {}): AudioDirector {
  const director = createAudioDirector(options);
  director.registerCues(createSfxLibrary());
  openDirectors.push(director);
  return director;
}

function createStubRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    render: () => undefined,
    setAnimationLoop: () => undefined,
    dispose: () => undefined,
  };
  return stub as unknown as THREE.WebGLRenderer;
}

function openSceneContext(options: SceneContextOptions = {}): SceneContext {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const canvas = document.createElement('canvas');
  const overlayRoot = document.createElement('div');
  container.appendChild(overlayRoot);
  const context = createSceneContext({
    canvas,
    container,
    overlayRoot,
    autoResize: false,
    autoStart: false,
    maxPixelRatio: 1,
    createRenderer: () => createStubRenderer(canvas),
    ...options,
  });
  openContexts.push(context);
  return context;
}

/** A minimal registered cue used to probe routing and era-scoped naming. */
function createProbeCue(name: string, bus: CueBusName = 'sfx'): CueDefinition {
  return {
    name,
    bus,
    duration: 0.5,
    loop: false,
    positional: true,
    tags: ['test'],
    render({ context, output, time, gain }) {
      const source = context.createOscillator();
      source.frequency.value = 440;
      const shape = context.createGain();
      shape.gain.value = 0;
      const envelope = scheduleEnvelope(shape.gain, {
        time,
        attack: 0.01,
        release: 0.2,
        peak: gain,
      });
      source.connect(shape);
      shape.connect(output);
      return startVoice({
        nodes: [source, shape],
        sources: [source],
        start: time,
        stopAt: envelope.end,
        endSignal: source,
      });
    },
  };
}

function transition(from: EraId, to: EraId, progress: number, active: boolean): EraTransitionInfo {
  const durationMs = 1400;
  return { from, to, elapsedMs: progress * durationMs, durationMs, active };
}

afterEach(() => {
  while (openDirectors.length > 0) openDirectors.pop()?.dispose();
  while (openContexts.length > 0) openContexts.pop()?.dispose();
  detachAudioDirectorGlobal();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Cue registry                                                        */
/* ------------------------------------------------------------------ */

describe('cue registry', () => {
  it('exposes the master, sfx, music and ambience buses', () => {
    expect(AUDIO_BUS_NAMES).toEqual(['master', 'sfx', 'music', 'ambience']);
    expect(CUE_BUS_NAMES).toEqual(['sfx', 'music', 'ambience']);
  });

  it('ships the six synthesized cues, each on its documented bus', () => {
    expect(SFX_CUE_NAMES).toEqual([
      'traffic',
      'horn',
      'footsteps',
      'shop-bell',
      'ui-click',
      'era-whoosh',
    ]);
    expect(SFX_CUE_BUSES.traffic).toBe('ambience');
    expect(SFX_CUE_BUSES.horn).toBe('sfx');
    expect(SFX_CUE_BUSES.footsteps).toBe('sfx');
    expect(SFX_CUE_BUSES['shop-bell']).toBe('sfx');
    expect(SFX_CUE_BUSES['ui-click']).toBe('sfx');
    expect(SFX_CUE_BUSES['era-whoosh']).toBe('sfx');
    expect(sfxCueBus('horns')).toBe('sfx');

    const library = createSfxLibrary();
    expect(library).toHaveLength(SFX_CUE_NAMES.length);
    expect(library.map((cue) => cue.name)).toEqual([...SFX_CUE_NAMES]);
    for (const cue of library) {
      expect(cue.render).toBeTypeOf('function');
      expect(cue.duration).toBeGreaterThan(0);
      expect(cue.bus).toBe(SFX_CUE_BUSES[cue.name as keyof typeof SFX_CUE_BUSES]);
    }
  });

  it('registers the built-in set and resolves aliases', () => {
    const director = openDirector();

    expect(director.version).toBe(AUDIO_DIRECTOR_VERSION);
    expect(director.cueCount).toBe(SFX_CUE_NAMES.length);
    expect([...director.cueNames].sort()).toEqual([...SFX_CUE_NAMES].sort());
    expect(director.hasCue('horn')).toBe(true);
    expect(director.hasCue('horns')).toBe(true);
    expect(resolveCueAlias('horns')).toBe('horn');
    expect(resolveCueAlias('era-transition')).toBe('era-whoosh');
    expect(director.getCue('bells')?.name).toBe('shop-bell');
    expect(director.hasCue('trombone')).toBe(false);
  });

  it('rejects malformed cues and unknown playback without breaking the scene', () => {
    const director = openDirector();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => director.registerCue({ name: '' } as unknown as CueDefinition)).toThrow(TypeError);
    expect(() => director.registerCue({ name: 'x' } as unknown as CueDefinition)).toThrow(TypeError);

    director.ensureContext();
    expect(director.play('trombone')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Mixer: buses, gain staging, mute                                    */
/* ------------------------------------------------------------------ */

describe('mixer', () => {
  it('builds master → destination with sfx, music and ambience feeding master', () => {
    const harness = createStubHarness();
    const director = openDirector({ createAudioContext: harness.createContext });

    const context = director.ensureContext();
    expect(context).toBe(harness.context);

    const master = asNode(director.masterGainNode);
    const sfx = asNode(director.getBusGain('sfx'));
    const music = asNode(director.getBusGain('music'));
    const ambience = asNode(director.getBusGain('ambience'));
    const destination = harness.stub.destination;

    expect(master.outputs).toEqual([destination]);
    expect(sfx.outputs).toEqual([master]);
    expect(music.outputs).toEqual([master]);
    expect(ambience.outputs).toEqual([master]);
    expect(director.state).toBe('locked');
    expect(director.masterGainValue).toBeCloseTo(DEFAULT_MASTER_VOLUME, 5);
    expect(director.getBusGain('sfx')?.gain.value).toBeCloseTo(DEFAULT_BUS_VOLUMES.sfx, 5);
    expect(director.getBusGain('music')?.gain.value).toBeCloseTo(DEFAULT_BUS_VOLUMES.music, 5);
    expect(director.getBusGain('ambience')?.gain.value).toBeCloseTo(DEFAULT_BUS_VOLUMES.ambience, 5);
  });

  it('applies a per-bus volume change without disturbing the other buses', () => {
    const harness = createStubHarness();
    const director = openDirector({ createAudioContext: harness.createContext });
    director.ensureContext();

    director.setBusVolume('music', 0.25);

    expect(director.getBusVolume('music')).toBeCloseTo(0.25, 5);
    expect(director.getBusGain('music')?.gain.value).toBeCloseTo(0.25, 5);
    expect(director.getBusGain('sfx')?.gain.value).toBeCloseTo(DEFAULT_BUS_VOLUMES.sfx, 5);
    expect(() => director.setBusVolume('vocals' as CueBusName, 1)).toThrow(RangeError);
  });

  it('mutes by driving the master gain to zero and restores it on toggle', () => {
    const harness = createStubHarness();
    const director = openDirector({ createAudioContext: harness.createContext });
    director.ensureContext();

    expect(director.toggleMute()).toBe(true);
    expect(director.isMuted).toBe(true);
    expect(director.masterGainValue).toBe(0);
    expect(director.effectiveBusGain('master')).toBe(0);
    // Sub-bus staging is preserved: mute is applied once, at the master.
    expect(director.getBusGain('sfx')?.gain.value).toBeCloseTo(DEFAULT_BUS_VOLUMES.sfx, 5);
    expect(document.documentElement.dataset.chronoAudioMuted).toBe('true');

    director.setMuted(false);
    expect(director.isMuted).toBe(false);
    expect(director.masterGainValue).toBeCloseTo(DEFAULT_MASTER_VOLUME, 5);
    expect(document.documentElement.dataset.chronoAudioMuted).toBe('false');

    director.setMasterVolume(0.4);
    expect(director.masterGainValue).toBeCloseTo(0.4, 5);
  });
});

/* ------------------------------------------------------------------ */
/* Autoplay-safe unlock                                                */
/* ------------------------------------------------------------------ */

describe('unlock', () => {
  it('creates the context lazily and only reports running after unlock', async () => {
    const harness = createStubHarness('suspended');
    const director = openDirector({ createAudioContext: harness.createContext });

    expect(director.state).toBe('idle');
    expect(director.context).toBeNull();

    await expect(director.unlock()).resolves.toBe(true);

    expect(director.context).toBe(harness.context);
    expect(director.state).toBe('running');
    expect(director.isUnlocked).toBe(true);
    expect(harness.stub.resumeCalls).toBe(1);
    expect(document.documentElement.dataset.chronoAudio).toBe('running');
    expect(document.documentElement.dataset.chronoAudioUnlocked).toBe('true');

    // The listener is pushed into the real AudioListener as soon as it exists.
    expect(harness.stub.listener.positionY.value).toBe(0);
  });

  it('unlocks on the first user gesture and detaches its listeners afterwards', async () => {
    const harness = createStubHarness('suspended');
    const director = openDirector({ createAudioContext: harness.createContext });
    const detach = director.attachGestureUnlock(document);

    expect(director.isUnlocked).toBe(false);
    document.dispatchEvent(new Event('pointerdown'));
    await vi.waitFor(() => expect(director.isUnlocked).toBe(true));
    expect(harness.stub.resumeCalls).toBe(1);

    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('keydown'));
    await Promise.resolve();
    expect(harness.stub.resumeCalls).toBe(1);

    detach();
    expect(director.isUnlocked).toBe(true);
  });

  it('provides an affordance that unlocks first and then toggles mute', async () => {
    const harness = createStubHarness('suspended');
    const director = openDirector({ createAudioContext: harness.createContext });
    const container = document.createElement('div');
    document.body.appendChild(container);

    const button = director.createUnlockAffordance({ documentRef: document, container });
    expect(button).not.toBeNull();
    const affordance = button as HTMLButtonElement;
    expect(affordance.hasAttribute(AUDIO_UNLOCK_ATTRIBUTE)).toBe(true);
    expect(container.contains(affordance)).toBe(true);
    expect(affordance.dataset.chronoAudioState).toBe('locked');
    expect(affordance.textContent).toBe('Enable sound');
    expect(affordance.getAttribute('aria-pressed')).toBe('false');

    affordance.click();
    await vi.waitFor(() => expect(director.isUnlocked).toBe(true));
    expect(affordance.dataset.chronoAudioState).toBe('ready');
    expect(affordance.textContent).toBe('Sound on');

    affordance.click();
    expect(affordance.dataset.chronoAudioState).toBe('muted');
    expect(affordance.textContent).toBe('Sound off');
    expect(director.masterGainValue).toBe(0);
    expect(affordance.getAttribute('aria-pressed')).toBe('true');

    affordance.click();
    expect(director.isMuted).toBe(false);
    expect(director.masterGainValue).toBeCloseTo(DEFAULT_MASTER_VOLUME, 5);
  });

  it('degrades to silence — never an exception — without Web Audio', () => {
    expect(supportsWebAudio()).toBe(false); // jsdom has no AudioContext

    const director = openDirector({ createAudioContext: () => null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(director.canCreateContext()).toBe(true);
    expect(director.ensureContext()).toBeNull();
    expect(director.state).toBe('unsupported');
    expect(director.play('horn')).toBeNull();
    expect(director.play('horn', { position: { x: 1, y: 0, z: 0 } })).toBeNull();
    expect(() => director.tick(openSceneContext())).not.toThrow();
    expect(() => director.dispose()).not.toThrow();
    expect(warn).not.toHaveBeenCalled();

    const platformDirector = openDirector();
    expect(platformDirector.canCreateContext()).toBe(false);
    expect(platformDirector.state).toBe('unsupported');
    expect(platformDirector.play('horn')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Routing and synthesis                                              */
/* ------------------------------------------------------------------ */

describe('routing', () => {
  it('routes a positional cue source → gain → panner → bus → master → destination', () => {
    const harness = createStubHarness('running');
    const director = openDirector({ createAudioContext: harness.createContext });

    const handle = director.play('horn', { position: { x: 30, y: 2, z: -12 } });
    expect(handle).not.toBeNull();
    const voice = handle as AudioCueHandle;

    expect(voice.bus).toBe('sfx');
    expect(voice.positional).toBe(true);
    expect(voice.panner).not.toBeNull();
    expect(voice.nodes.length).toBeGreaterThan(0);

    const stage = asNode(voice.gainNode);
    const panner = asPanner(voice.panner);
    const bus = asNode(director.getBusGain('sfx'));
    const master = asNode(director.masterGainNode);

    expect(stage.outputs).toEqual([panner]);
    expect(panner.outputs).toEqual([bus]);
    expect(bus.outputs).toEqual([master]);
    expect(master.outputs).toEqual([harness.stub.destination]);
    expect(reaches(asNode(voice.nodes[0]), stage)).toBe(true);
    expect(director.describeRoute(voice)).toEqual([
      'source',
      'gain',
      'panner',
      'bus:sfx',
      'master',
      'destination',
    ]);

    // The panner is configured for inverse distance rolloff and sits at the cue.
    expect(panner.panningModel).toBe('HRTF');
    expect(panner.distanceModel).toBe('inverse');
    expect(panner.refDistance).toBeGreaterThan(0);
    expect(panner.maxDistance).toBeGreaterThan(panner.refDistance);
    expect(panner.position.x).toBeCloseTo(30, 5);
    expect(panner.position.y).toBeCloseTo(2, 5);
    expect(panner.position.z).toBeCloseTo(-12, 5);

    // Sources were started and scheduled to stop: the voice has a lifetime.
    const source = asNode(voice.nodes[0]) as StubSource;
    expect(source.starts).toHaveLength(1);
    expect(source.stops.length).toBeGreaterThan(0);
  });

  it('skips the panner for non-positional cues and honours bus overrides', () => {
    const harness = createStubHarness('running');
    const director = openDirector({ createAudioContext: harness.createContext });

    const click = director.play('ui-click');
    expect(click).not.toBeNull();
    const clickVoice = click as AudioCueHandle;
    expect(clickVoice.positional).toBe(false);
    expect(clickVoice.panner).toBeNull();
    expect(asNode(clickVoice.gainNode).outputs).toEqual([asNode(director.getBusGain('sfx'))]);
    expect(director.describeRoute(clickVoice)).toEqual([
      'source',
      'gain',
      'bus:sfx',
      'master',
      'destination',
    ]);

    const traffic = director.play('traffic');
    expect(traffic?.bus).toBe('ambience');
    expect(asNode((traffic as AudioCueHandle).gainNode).outputs).toEqual([
      asNode(director.getBusGain('ambience')),
    ]);

    const music = director.play('footsteps', { bus: 'music' });
    expect(music?.bus).toBe('music');
    expect(asNode((music as AudioCueHandle).gainNode).outputs).toEqual([
      asNode(director.getBusGain('music')),
    ]);
  });

  it('releases voices when their sources end and caps runaway bursts', () => {
    const harness = createStubHarness('running');
    const director = openDirector({ createAudioContext: harness.createContext, maxVoices: 2 });

    const first = director.play('horn') as AudioCueHandle;
    const second = director.play('horn') as AudioCueHandle;
    expect(director.activeVoiceCount).toBe(2);

    // A third one-shot retires the oldest voice instead of piling up.
    const third = director.play('horn') as AudioCueHandle;
    expect(director.activeVoiceCount).toBe(2);
    expect(first.finished).toBe(true);
    expect(director.hasVoice(first)).toBe(false);
    expect(director.hasVoice(second)).toBe(true);
    expect(director.hasVoice(third)).toBe(true);

    const voice = director.play('ui-click') as AudioCueHandle;
    const stage = asNode(voice.gainNode);
    (asNode(voice.nodes[0]) as StubSource).emitEnded();

    expect(voice.finished).toBe(true);
    expect(director.hasVoice(voice)).toBe(false);
    expect(stage.outputs).toHaveLength(0); // the graph was released
    expect(director.stopAll()).toBeUndefined();
    expect(director.activeVoiceCount).toBe(0);
    void second;
  });

  it('synthesizes deterministic noise buffers and A/HD/R envelopes', () => {
    const harness = createStubHarness();
    const buffer = createNoiseBuffer(harness.context, { seconds: 0.05, seed: 7 });
    const cached = createNoiseBuffer(harness.context, { seconds: 0.05, seed: 7 });
    expect(cached).toBe(buffer);

    const other = createStubHarness();
    const sameSeed = createNoiseBuffer(other.context, { seconds: 0.05, seed: 7 });
    const otherSeed = createNoiseBuffer(other.context, { seconds: 0.05, seed: 8 });
    const slice = (value: typeof buffer): number[] =>
      Array.from(value.getChannelData(0).slice(64, 128));
    expect(slice(sameSeed)).toEqual(slice(buffer));
    expect(slice(otherSeed)).not.toEqual(slice(buffer));

    const param = createStubParam('gain');
    const envelope = scheduleEnvelope(param, {
      time: 1,
      attack: 0.02,
      hold: 0.3,
      decay: 0.1,
      sustain: 0.5,
      release: 0.4,
      peak: 0.8,
    });
    expect(envelope.attackEnd).toBeCloseTo(1.02, 5);
    expect(envelope.holdEnd).toBeCloseTo(1.32, 5);
    expect(envelope.releaseStart).toBeCloseTo(1.42, 5);
    expect(envelope.end).toBeCloseTo(1.82, 5);
    expect(envelope.sustain).toBeCloseTo(0.4, 5);
    expect(param.events.map((event) => event.type)).toEqual([
      'cancelScheduledValues',
      'setValueAtTime',
      'linearRampToValueAtTime',
      'exponentialRampToValueAtTime',
      'exponentialRampToValueAtTime',
    ]);
    expect(param.events[2]).toMatchObject({ value: 0.8, time: 1.02 });
    expect(param.events[3]?.value).toBeCloseTo(0.4, 5);
    expect(param.events[3]?.time).toBeCloseTo(1.42, 5);
    expect(param.events[4]?.value).toBeCloseTo(0.0001, 6);
    expect(param.events[4]?.time).toBeCloseTo(1.82, 5);

    // A musical duration solves for the hold segment instead.
    const shaped = createStubParam('gain');
    const byDuration = scheduleEnvelope(shaped, {
      time: 0,
      attack: 0.1,
      decay: 0.2,
      sustain: 0.5,
      release: 0.3,
      duration: 1,
    });
    expect(byDuration.holdEnd - byDuration.attackEnd).toBeCloseTo(0.4, 5);
    expect(byDuration.end).toBeCloseTo(1, 5);

    // The synthesized cues actually schedule an envelope on a gain param.
    const director = openDirector({ createAudioContext: harness.createContext });
    director.play('ui-click');
    const strike = harness.stub
      .byKind('gain')
      .find((node) =>
        (node as StubGain).gain.events.some(
          (event) => event.type === 'exponentialRampToValueAtTime',
        ),
      );
    expect(strike).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* Positional emitters                                                 */
/* ------------------------------------------------------------------ */

describe('positional emitters', () => {
  it('rolls volume off with distance and reaches silence at maxDistance', () => {
    expect(rolloffGain(0, { refDistance: 10, maxDistance: 100, rolloffFactor: 1 })).toBe(1);
    expect(rolloffGain(10, { refDistance: 10, maxDistance: 100, rolloffFactor: 1 })).toBe(1);

    const near = rolloffGain(20, { refDistance: 10, maxDistance: 100, rolloffFactor: 1 });
    const far = rolloffGain(60, { refDistance: 10, maxDistance: 100, rolloffFactor: 1 });
    expect(near).toBeLessThan(1);
    expect(far).toBeLessThan(near);
    expect(rolloffGain(100, { refDistance: 10, maxDistance: 100, rolloffFactor: 1 })).toBe(0);
    expect(rolloffGain(250, { refDistance: 10, maxDistance: 100, rolloffFactor: 1 })).toBe(0);
    expect(rolloffGain(Number.NaN)).toBe(0);
  });

  it('tracks an Object3D and updates panner position and attenuation every tick', async () => {
    const harness = createStubHarness('suspended');
    const director = openDirector({ createAudioContext: harness.createContext });
    const scene = openSceneContext();
    director.attach(scene);
    await director.unlock();

    const car = new THREE.Object3D();
    car.position.set(0, 0, 0);
    scene.scene.add(car);

    const emitter = director.registerEmitter({
      id: 'car-1',
      cue: 'horn',
      object: car,
      gain: 0.8,
      refDistance: 5,
      maxDistance: 100,
      rolloffFactor: 1,
      autoStart: true,
    });

    expect(director.emitterCount).toBe(1);
    expect(director.getEmitter('car-1')).toBe(emitter);
    expect(() => director.registerEmitter({ id: 'car-1', cue: 'horn' })).toThrow(/already registered/);

    // The camera sits at the car: full attenuation (distance 0).
    scene.camera.position.set(0, 0, 0);
    scene.tick(0.1);
    expect(emitter.isPlaying).toBe(true);
    expect(emitter.distance).toBeCloseTo(0, 5);
    expect(emitter.attenuation).toBeCloseTo(1, 5);
    expect(emitter.handle?.gainNode.gain.value).toBeCloseTo(0.8, 5);

    const panner = asPanner(emitter.handle?.panner);
    expect(panner.position.x).toBeCloseTo(0, 5);

    // Move the car away: the panner follows and the voice ducks.
    car.position.set(0, 0, 60);
    scene.tick(0.2);
    expect(emitter.distance).toBeCloseTo(60, 5);
    expect(panner.position.z).toBeCloseTo(60, 5);
    expect(emitter.attenuation).toBeLessThan(1);
    expect(emitter.handle?.gainNode.gain.value).toBeCloseTo(0.8 * emitter.attenuation, 5);

    // Beyond maxDistance the emitter is silent.
    car.position.set(0, 0, 140);
    scene.tick(0.3);
    expect(emitter.attenuation).toBe(0);
    expect(emitter.handle?.gainNode.gain.value).toBe(0);

    emitter.setGain(0.5);
    emitter.setPosition({ x: 4, y: 0, z: 140 });
    expect(emitter.gain).toBeCloseTo(0.5, 5);
    expect(emitter.position.x).toBeCloseTo(4, 5);

    expect(director.unregisterEmitter('car-1')).toBe(true);
    expect(director.unregisterEmitter('car-1')).toBe(false);
    expect(director.emitterCount).toBe(0);
  });

  it('keeps one-shot positional voices spatialised until they finish', () => {
    const harness = createStubHarness('running');
    const director = openDirector({ createAudioContext: harness.createContext });
    const scene = openSceneContext();
    director.attach(scene);

    scene.camera.position.set(0, 0, 0);
    scene.tick(1 / 60); // frame the listener on the voice before it is played
    const voice = director.play('shop-bell', { position: { x: 0, y: 0, z: 0 } }) as AudioCueHandle;
    expect(voice.gainNode.gain.value).toBeCloseTo(1, 5);

    // Listener walks away → the one-shot voice fades with the distance.
    scene.camera.position.set(0, 0, 60);
    scene.tick(0.1);
    expect(voice.gainNode.gain.value).toBeLessThan(1);
    expect(asPanner(voice.panner).position.z).toBeCloseTo(0, 5);
  });
});

/* ------------------------------------------------------------------ */
/* Scene composition + era contracts                                   */
/* ------------------------------------------------------------------ */

describe('scene composition', () => {
  it('ticks through SceneContext to update listener state from the camera', () => {
    const harness = createStubHarness('running');
    const director = openDirector({ createAudioContext: harness.createContext });
    director.ensureContext();
    const scene = openSceneContext();

    const registration = director.attach(scene);
    expect(scene.hasSystem(AUDIO_SYSTEM_ID)).toBe(true);
    expect(scene.getSystem(AUDIO_SYSTEM_ID)?.order).toBeGreaterThan(0);

    scene.camera.position.set(12, 8, -30);
    scene.camera.lookAt(0, 4, 0);
    const frame = scene.tick(1 / 60);

    expect(director.tickCount).toBe(1);
    expect(director.lastFrame).toBe(frame.frame);
    expect(director.listener.position.x).toBeCloseTo(12, 5);
    expect(director.listener.position.y).toBeCloseTo(8, 5);
    expect(director.listener.position.z).toBeCloseTo(-30, 5);

    const expectedForward = new THREE.Vector3();
    scene.camera.getWorldDirection(expectedForward);
    expect(director.listener.forward.x).toBeCloseTo(expectedForward.x, 5);
    expect(director.listener.forward.z).toBeCloseTo(expectedForward.z, 5);

    // The same state is pushed into the platform AudioListener.
    expect(harness.stub.listener.positionX.value).toBeCloseTo(12, 5);
    expect(harness.stub.listener.positionZ.value).toBeCloseTo(-30, 5);
    expect(harness.stub.listener.forwardX.value).toBeCloseTo(expectedForward.x, 5);

    scene.tick(1 / 60);
    expect(director.tickCount).toBe(2);

    registration.dispose();
    expect(scene.hasSystem(AUDIO_SYSTEM_ID)).toBe(false);
    expect(() => director.tick(scene)).not.toThrow();
  });

  it('blends eras through the shared EraBlendable contract', () => {
    const harness = createStubHarness('running');
    const director = openDirector({ createAudioContext: harness.createContext });
    director.ensureContext();

    expect(director.era).toBe(DEFAULT_ERA);
    expect(director.eraBlend).toBe(1);

    // An immediate switch lands at once.
    director.setEra('1965', { immediate: true });
    expect(director.era).toBe('1965');
    expect(director.eraTransitionActive).toBe(false);
    expect(() => director.setEra('1955' as EraId)).toThrow(RangeError);

    // A tween opens with the era whoosh and dips the bed buses mid-transition.
    director.setEra('1985', { durationMs: 1400 });
    expect(director.eraTransitionActive).toBe(true);
    expect(director.eraTarget).toBe('1985');
    expect(director.eraFrom).toBe('1965');
    expect(director.eraBlend).toBe(0);
    expect(director.activeVoices.some((voice) => voice.cue === 'era-whoosh')).toBe(true);
    expect(director.activeVoices.find((voice) => voice.cue === 'era-whoosh')?.bus).toBe('sfx');

    director.setBusVolume('music', 0.8);
    const musicGain = director.getBusGain('music');
    director.updateEraTransition(0.5, transition('1965', '1985', 0.5, true));
    expect(director.eraBlend).toBeCloseTo(0.5, 5);
    expect(director.era).toBe('1965'); // still the source era mid-tween
    expect(director.effectiveBusGain('music')).toBeCloseTo(0.2, 5);
    expect(musicGain?.gain.value).toBeCloseTo(0.2, 5);
    expect(director.effectiveBusGain('sfx')).toBeCloseTo(DEFAULT_BUS_VOLUMES.sfx, 5);

    director.updateEraTransition(1, transition('1965', '1985', 1, false));
    expect(director.era).toBe('1985');
    expect(director.eraTransitionActive).toBe(false);
    expect(director.eraBlend).toBe(1);
    expect(director.effectiveBusGain('music')).toBeCloseTo(0.8, 5);
  });

  it('resolves era-scoped cue names from the shared era contracts', () => {
    const harness = createStubHarness('running');
    const director = openDirector({ createAudioContext: harness.createContext });
    director.ensureContext();

    expect(eraCueName('1985', 'traffic')).toBe('era:1985:traffic');
    expect(eraCueName('1945', 'horns')).toBe('era:1945:horn');
    for (const era of ERA_IDS) {
      expect(parseEraCueName(eraCueName(era, 'horn'))).toEqual({ era, cue: 'horn' });
    }
    expect(parseEraCueName('horn')).toBeNull();
    expect(parseEraCueName('era:nope:horn')).toBeNull();

    // Without a registration the era-neutral cue wins.
    expect(director.resolveCueName('traffic')).toBe('traffic');
    expect(director.play('traffic')?.cue).toBe('traffic');

    // Registering the era-scoped variant re-voices the cue for that era only.
    director.registerCue(createProbeCue(eraCueName('1985', 'traffic'), 'ambience'));
    director.setEra('1985', { immediate: true });

    expect(director.resolveCueName('traffic')).toBe('era:1985:traffic');
    expect(director.resolveCueName('traffic', '1945')).toBe('traffic');
    const voice = director.play('traffic');
    expect(voice?.cue).toBe('era:1985:traffic');
    expect(voice?.bus).toBe('ambience');
    expect(asNode(voice?.gainNode).outputs).toEqual([asNode(director.getBusGain('ambience'))]);
  });
});

/* ------------------------------------------------------------------ */
/* Application boot                                                    */
/* ------------------------------------------------------------------ */

describe('boot', () => {
  it('boots the director into a scene, publishes it and unwinds cleanly', async () => {
    const harness = createStubHarness('suspended');
    const scene = openSceneContext();
    const container = scene.overlayRoot;

    const boot = bootAudioDirector({
      createAudioContext: harness.createContext,
      scene,
      container,
      documentRef: document,
    });

    openDirectors.push(boot.director);

    expect(boot.director.cueCount).toBe(SFX_CUE_NAMES.length);
    expect(boot.registration).not.toBeNull();
    expect(scene.hasSystem(AUDIO_SYSTEM_ID)).toBe(true);
    expect(getAudioDirector()).toBe(boot.director);
    expect((globalThis as unknown as Record<string, unknown>)[AUDIO_GLOBAL_KEY]).toBe(boot.director);
    expect(document.documentElement.dataset.chronoAudioCues).toBe(String(SFX_CUE_NAMES.length));

    const affordance = boot.affordance as HTMLButtonElement;
    expect(affordance).not.toBeNull();
    expect(container.contains(affordance)).toBe(true);

    affordance.click();
    await vi.waitFor(() => expect(boot.director.isUnlocked).toBe(true));
    expect(boot.director.state).toBe('running');

    scene.camera.position.set(0, 5, 20);
    scene.tick(1 / 60);
    expect(boot.director.tickCount).toBe(1);

    const snapshot = boot.director.snapshot();
    expect(snapshot.state).toBe('running');
    expect(snapshot.cueNames).toHaveLength(SFX_CUE_NAMES.length);
    expect(snapshot.listener.position.z).toBeCloseTo(20, 5);
    expect(snapshot.busGains.master).toBeCloseTo(DEFAULT_MASTER_VOLUME, 5);

    boot.dispose();

    expect(boot.director.isDisposed).toBe(true);
    expect(scene.hasSystem(AUDIO_SYSTEM_ID)).toBe(false);
    expect(container.contains(affordance)).toBe(false);
    expect(getAudioDirector()).toBeNull();
    expect(harness.stub.closeCalls).toBe(1);
  });

  it('wires the director into the real app boot path and clears it on stop', () => {
    const container = document.createElement('div');
    container.dataset.chronoStage = '';
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    const overlayRoot = document.createElement('div');
    container.appendChild(overlayRoot);

    const app = bootChronoCity({
      canvas,
      container,
      overlayRoot,
      autoResize: false,
      seed: 4242,
      createRenderer: () => createStubRenderer(canvas),
    });

    const director = getChronoCityAudio();
    expect(director).not.toBeNull();
    expect(window.__chronoCityAudio).toBe(director);
    expect(director?.cueCount).toBe(SFX_CUE_NAMES.length);
    expect(app.context.hasSystem(AUDIO_SYSTEM_ID)).toBe(true);

    // jsdom has no Web Audio: the engine degrades to silence and adds no DOM.
    expect(director?.state).toBe('unsupported');
    expect(document.documentElement.dataset.chronoAudio).toBe('unsupported');
    expect(overlayRoot.querySelector(`[${AUDIO_UNLOCK_ATTRIBUTE}]`)).toBeNull();

    // The audio system ticks with the scene like any other system.
    app.context.tick(1 / 60);
    expect(director?.tickCount).toBe(1);

    stopChronoCity();
    expect(getChronoCityAudio()).toBeNull();
    expect(window.__chronoCityAudio).toBeUndefined();
    expect(app.context.isDisposed).toBe(true);
  });
});
