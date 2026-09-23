/**
 * Chrono City — era soundscapes and SoundscapeApi suite.
 *
 * The suite drives the real modules through the real frame loop:
 *
 *   * `src/audio/eraSoundscapes.ts` — five distinct music/ambience profiles,
 *     the ten era-scoped bed cues and the deterministic buffer synthesis;
 *   * `src/audio/soundscapeApi.ts` — layer control, the TimelineRuntime
 *     crossfade (no duplicate stacking while scrubbing), AudioDirector bus
 *     routing and NavigationRig-driven footsteps.
 *
 * Everything runs against an in-memory Web Audio stub that records the node
 * graph, the connections and the scheduled `AudioParam` events, so the
 * assertions inspect the *real* graph the cue renderers build. The composition
 * tests tick a real `SceneContext`, which runs the `NavigationRig`, the
 * `TimelineRuntime`, the `SoundscapeApi` and the `AudioDirector` in one frame —
 * the same wiring the application entry point will perform.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  AUDIO_SYSTEM_ID,
  AudioDirector,
  createAudioDirector,
  eraCueName,
  type AudioEngineContext,
} from '../../src/audio/audioDirector';
import {
  ERA_SOUNDSCAPES_VERSION,
  ERA_SOUNDSCAPE_PROFILES,
  AMBIENCE_BED_CUE,
  MUSIC_BED_CUE,
  createEraSoundscapeCueMap,
  createEraSoundscapeCues,
  getEraSoundscapeProfile,
  soundscapeCueName,
} from '../../src/audio/eraSoundscapes';
import {
  DEFAULT_MIN_STEP_SPEED,
  DEFAULT_STRIDE_LENGTH,
  SOUNDSCAPE_API_VERSION,
  SOUNDSCAPE_BLENDABLE_ID,
  SOUNDSCAPE_GLOBAL_KEY,
  SOUNDSCAPE_SYSTEM_ID,
  SoundscapeApi,
  createSoundscapeApi,
  detachSoundscapeGlobal,
  getSoundscapeApi,
  integrateSoundscapeGlobal,
} from '../../src/audio/soundscapeApi';
import { FOOTSTEP_CUE, createSfxLibrary, type CueDefinition } from '../../src/audio/sfxSynth';
import { ERA_IDS, type EraId } from '../../src/core/eraContracts';
import { createSceneContext, type SceneContext } from '../../src/core/sceneContext';
import { getEraDescriptor } from '../../src/era/eraDescriptors';
import {
  TIMELINE_SYSTEM_ID,
  createTimelineRuntime,
  type TimelineRuntime,
} from '../../src/era/timelineRuntime';
import { NAVIGATION_SYSTEM_ID, NavigationRig } from '../../src/navigation/navigationRig';
import type { NavigationMode } from '../../src/navigation/movementController';

/* ------------------------------------------------------------------------- *
 * Web Audio stub
 * ------------------------------------------------------------------------- */

interface ParamEvent {
  readonly type: string;
  readonly value: number;
  readonly time: number;
}

interface StubParam {
  readonly kind: string;
  readonly events: ParamEvent[];
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
    value,
    setValueAtTime(next, time) {
      param.value = next;
      events.push({ type: 'setValueAtTime', value: next, time });
      return param;
    },
    linearRampToValueAtTime(next, time) {
      param.value = next;
      events.push({ type: 'linearRampToValueAtTime', value: next, time });
      return param;
    },
    exponentialRampToValueAtTime(next, time) {
      param.value = next;
      events.push({ type: 'exponentialRampToValueAtTime', value: next, time });
      return param;
    },
    setTargetAtTime(next, time) {
      param.value = next;
      events.push({ type: 'setTargetAtTime', value: next, time });
      return param;
    },
    cancelScheduledValues(time) {
      events.push({ type: 'cancelScheduledValues', value: param.value, time });
      return param;
    },
    cancelAndHoldAtTime(time) {
      events.push({ type: 'cancelAndHoldAtTime', value: param.value, time });
      return param;
    },
    setValueCurveAtTime(_values, startTime, duration) {
      events.push({ type: 'setValueCurveAtTime', value: param.value, time: startTime + duration });
      return param;
    },
  };
  return param;
}

function isStubParam(target: unknown): target is StubParam {
  return Boolean(
    target &&
      typeof (target as StubParam).setValueAtTime === 'function' &&
      !('connect' in (target as object)),
  );
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
  maxDistance = 10_000;
  rolloffFactor = 1;
  coneInnerAngle = 360;
  coneOuterAngle = 360;
  coneOuterGain = 0;

  constructor() {
    super('panner');
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
  readonly buffers: StubBuffer[] = [];
  sampleRate = 48_000;
  currentTime = 0;
  state: AudioContextState = 'running';
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
    const buffer = new StubBuffer(numberOfChannels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
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

  byKind(kind: string): StubNode[] {
    return this.nodes.filter((node) => node.kind === kind);
  }

  private track<T extends StubNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}

/* ------------------------------------------------------------------------- *
 * Harness
 * ------------------------------------------------------------------------- */

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

interface Session {
  readonly stub: StubAudioContext;
  readonly container: HTMLElement;
  readonly scene: SceneContext;
  readonly rig: NavigationRig;
  readonly timeline: TimelineRuntime;
  readonly director: AudioDirector;
  readonly api: SoundscapeApi;
}

const openSessions: Session[] = [];

interface SessionOptions {
  readonly initialEra?: EraId;
  readonly mode?: NavigationMode;
  readonly walkSpeed?: number;
  readonly withRig?: boolean;
}

/**
 * Boots the whole era audio composition in one scene context: renderer stub,
 * navigation rig, timeline, soundscape api and audio director, each on its own
 * tick order.
 */
function openSession(options: SessionOptions = {}): Session {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const canvas = document.createElement('canvas');
  const overlayRoot = document.createElement('div');
  container.appendChild(overlayRoot);

  const scene = createSceneContext({
    canvas,
    container,
    overlayRoot,
    autoResize: false,
    autoStart: false,
    maxPixelRatio: 1,
    createRenderer: () => createStubRenderer(canvas),
  });

  const stub = new StubAudioContext();
  const engineContext = stub as unknown as AudioEngineContext;
  const director = createAudioDirector({
    createAudioContext: () => engineContext,
    documentRef: document,
    maxVoices: 64,
  });
  director.registerCues(createSfxLibrary());
  director.attach(scene);

  const timeline = createTimelineRuntime({
    initialEra: options.initialEra ?? '2025',
    durationMs: 1200,
  });
  timeline.attach(scene);
  timeline.registerBlendable(director, { id: 'audio-director-blendable' });

  const rig = new NavigationRig(scene, {
    mode: options.mode ?? 'orbit',
    controls: false,
    walkSpeed: options.walkSpeed,
  });

  const api = createSoundscapeApi({
    director,
    timeline,
    context: scene,
    rig: options.withRig === false ? null : rig,
    documentRef: document,
  });

  const session: Session = { stub, container, scene, rig, timeline, director, api };
  openSessions.push(session);
  return session;
}

afterEach(() => {
  for (const session of openSessions.splice(0)) {
    session.api.dispose();
    session.director.dispose();
    session.timeline.dispose();
    session.rig.dispose();
    session.scene.dispose();
    session.container.remove();
  }
  detachSoundscapeGlobal();
  delete window.__chronoCitySoundscape;
});

function runFrames(scene: SceneContext, frames: number, delta = 1 / 60): void {
  for (let index = 0; index < frames; index += 1) scene.tick(delta);
}

function pressKey(type: 'keydown' | 'keyup', code: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

/** Walks the rig for `frames` by holding W, releasing it at the end. */
function walkFrames(session: Session, frames: number, onFrame?: (index: number) => void): void {
  pressKey('keydown', 'KeyW');
  for (let index = 0; index < frames; index += 1) {
    session.scene.tick(1 / 60);
    onFrame?.(index);
  }
  pressKey('keyup', 'KeyW');
}

/** Every live bed voice of the director (era whooshes excluded). */
function bedVoices(director: AudioDirector) {
  return director.activeVoices.filter(
    (voice) => voice.cue.endsWith(MUSIC_BED_CUE) || voice.cue.endsWith(AMBIENCE_BED_CUE),
  );
}

/** Renders a cue once against a stub and returns a comparable graph signature. */
function renderSignature(cue: CueDefinition, stub: StubAudioContext): { signature: string; buffer: StubBuffer | null } {
  const output = stub.createGain();
  const voice = cue.render({
    context: stub as unknown as BaseAudioContext,
    output: output as unknown as AudioNode,
    time: 0,
    gain: 1,
    rate: 1,
    seed: 7,
    loop: true,
  });

  const parts: string[] = [];
  let buffer: StubBuffer | null = null;
  for (const node of voice.nodes) {
    const stubNode = node as unknown as StubNode;
    if (stubNode.kind === 'oscillator') {
      const oscillator = stubNode as StubOscillator;
      parts.push(`osc:${oscillator.type}:${oscillator.frequency.value.toFixed(2)}`);
    } else if (stubNode.kind === 'biquad') {
      const filter = stubNode as StubBiquadFilter;
      parts.push(`filter:${filter.type}:${filter.frequency.value.toFixed(0)}`);
    } else if (stubNode.kind === 'bufferSource') {
      const source = stubNode as StubBufferSource;
      buffer = source.buffer;
      parts.push(`buffer:${source.buffer ? source.buffer.duration.toFixed(3) : 'none'}:${checksum(source.buffer)}`);
    }
  }
  return { signature: parts.join('|'), buffer };
}

function checksum(buffer: StubBuffer | null): string {
  if (!buffer) return 'none';
  const data = buffer.getChannelData(0);
  let sum = 0;
  for (let index = 0; index < data.length; index += 13) sum += Math.abs(data[index] as number);
  return sum.toFixed(3);
}

/* ------------------------------------------------------------------------- *
 * Profiles and synthesis
 * ------------------------------------------------------------------------- */

describe('era soundscapes', () => {
  it('authors five era-authentic profiles keyed off the era descriptors', () => {
    expect(ERA_SOUNDSCAPES_VERSION).toBeGreaterThan(0);

    const musicBeds = new Set<string>();
    const ambienceSets = new Set<string>();
    const cueNames = new Set<string>();
    const signatures = new Set<string>();

    // The signature instruments the user asked each era to sound like.
    const expected: Record<EraId, { readonly music: RegExp; readonly ambience: RegExp }> = {
      '1945': { music: /big-band|brass/i, ambience: /streetcar/i },
      '1965': { music: /rockabilly/i, ambience: /V8|engine/i },
      '1985': { music: /synth-pop/i, ambience: /arcade/i },
      '2005': { music: /hip-hop/i, ambience: /ringtone|cell/i },
      '2025': { music: /ambient/i, ambience: /drone|hum/i },
    };

    for (const era of ERA_IDS) {
      const profile = getEraSoundscapeProfile(era);
      const descriptor = getEraDescriptor(era);

      expect(profile.era).toBe(era);
      expect(profile.id).toBe(descriptor.soundscapeId);
      expect(profile.loudness).toBeCloseTo(descriptor.soundscape.loudness, 9);
      expect(profile.musicCue).toBe(eraCueName(era, MUSIC_BED_CUE));
      expect(profile.ambienceCue).toBe(eraCueName(era, AMBIENCE_BED_CUE));
      expect(profile.musicGain).toBeGreaterThan(0);
      expect(profile.ambienceGain).toBeGreaterThan(0);
      expect(profile.musicNotes).toMatch(expected[era].music);
      expect(profile.ambienceNotes).toMatch(expected[era].ambience);

      musicBeds.add(profile.musicBed);
      ambienceSets.add(profile.ambience.join('|'));
      cueNames.add(profile.musicCue);
      cueNames.add(profile.ambienceCue);
    }

    expect(Object.keys(ERA_SOUNDSCAPE_PROFILES)).toEqual([...ERA_IDS]);
    expect(musicBeds.size).toBe(5);
    expect(ambienceSets.size).toBe(5);
    expect(cueNames.size).toBe(10);
    expect(signatures.size).toBe(0);
  });

  it('registers ten looping bed cues on the music and ambience buses', () => {
    const cues = createEraSoundscapeCues();
    expect(cues).toHaveLength(10);

    const map = createEraSoundscapeCueMap();
    for (const era of ERA_IDS) {
      const profile = getEraSoundscapeProfile(era);
      const music = map[profile.musicCue] as CueDefinition;
      const ambience = map[profile.ambienceCue] as CueDefinition;

      expect(music.bus).toBe('music');
      expect(ambience.bus).toBe('ambience');
      expect(music.loop).toBe(true);
      expect(ambience.loop).toBe(true);
      expect(music.positional).toBe(false);
      expect(ambience.positional).toBe(false);
      expect(music.duration).toBeGreaterThan(0.5);
      expect(music.tags).toContain(`era-${era}`);
      expect(ambience.tags).toContain('ambience');
    }
  });

  it('synthesizes a different, deterministic bed graph per era and layer', () => {
    const signatures = new Map<string, string>();

    for (const cue of createEraSoundscapeCues()) {
      const stub = new StubAudioContext();
      const first = renderSignature(cue, stub);
      const second = renderSignature(cue, stub);

      // Deterministic and cached: no re-synthesis when a bed is replayed.
      expect(second.signature).toBe(first.signature);
      expect(second.buffer).toBe(first.buffer);
      expect(first.signature.length).toBeGreaterThan(10);
      expect(first.buffer).not.toBeNull();
      expect((first.buffer as StubBuffer).duration).toBeGreaterThan(0.5);

      signatures.set(cue.name, first.signature);
      // A bed is more than a label: it has to build real audio nodes — one
      // looping texture buffer plus live tonal/motion oscillators.
      expect(stub.byKind('oscillator').length).toBeGreaterThan(0);
      expect((first.signature.match(/buffer:/g) ?? []).length).toBe(1);
      expect(stub.byKind('bufferSource').length).toBe(2);
    }

    expect(signatures.size).toBe(10);
    expect(new Set(signatures.values()).size).toBe(10);

    const musicSignatures = [...signatures.entries()]
      .filter(([name]) => name.endsWith(MUSIC_BED_CUE))
      .map(([, signature]) => signature);
    const ambienceSignatures = [...signatures.entries()]
      .filter(([name]) => name.endsWith(AMBIENCE_BED_CUE))
      .map(([, signature]) => signature);
    expect(new Set(musicSignatures).size).toBe(5);
    expect(new Set(ambienceSignatures).size).toBe(5);
  });
});

/* ------------------------------------------------------------------------- *
 * Registration and routing through the AudioDirector
 * ------------------------------------------------------------------------- */

describe('SoundscapeApi registration', () => {
  it('registers era-scoped cues the director resolves per era', () => {
    const session = openSession({ initialEra: '1985' });
    const { director } = session;

    for (const era of ERA_IDS) {
      const profile = getEraSoundscapeProfile(era);
      expect(director.getCue(profile.musicCue)?.bus).toBe('music');
      expect(director.getCue(profile.ambienceCue)?.bus).toBe('ambience');
      expect(director.resolveCueName(MUSIC_BED_CUE, era)).toBe(profile.musicCue);
      expect(director.resolveCueName(AMBIENCE_BED_CUE, era)).toBe(profile.ambienceCue);
    }

    const handle = director.play(MUSIC_BED_CUE, { era: '1965', loop: true });
    expect(handle?.cue).toBe(eraCueName('1965', MUSIC_BED_CUE));
    expect(handle?.bus).toBe('music');
    expect(director.describeRoute(handle)).toEqual([
      'source',
      'gain',
      'bus:music',
      'master',
      'destination',
    ]);
  });

  it('starts one music and one ambience layer for the current era', () => {
    const session = openSession({ initialEra: '2005' });
    const profile = getEraSoundscapeProfile('2005');
    const music = session.api.getLayer('2005', 'music');
    const ambience = session.api.getLayer('2005', 'ambience');

    expect(session.api.version).toBe(SOUNDSCAPE_API_VERSION);
    expect(session.api.era).toBe('2005');
    expect(session.api.progress).toBe(1);
    expect(session.api.transitioning).toBe(false);
    expect(session.api.layerCount).toBe(2);

    expect(music?.cue).toBe(soundscapeCueName('2005', 'music'));
    expect(music?.bus).toBe('music');
    expect(music?.crossfade).toBe(1);
    expect(music?.gain).toBeCloseTo(profile.musicGain, 9);
    expect(music?.playing).toBe(true);
    expect(ambience?.bus).toBe('ambience');
    expect(ambience?.gain).toBeCloseTo(profile.ambienceGain, 9);

    const voices = bedVoices(session.director);
    expect(voices).toHaveLength(2);
    expect(session.director.describeRoute(session.api.getLayerVoice('2005', 'music'))).toEqual([
      'source',
      'gain',
      'bus:music',
      'master',
      'destination',
    ]);
    expect(session.director.describeRoute(session.api.getLayerVoice('2005', 'ambience'))).toEqual([
      'source',
      'gain',
      'bus:ambience',
      'master',
      'destination',
    ]);
  });

  it('mutes and restarts every layer through setEnabled', () => {
    const session = openSession({ initialEra: '1945' });
    session.api.setEnabled(false);
    expect(session.api.enabled).toBe(false);
    expect(session.api.layerCount).toBe(0);
    expect(bedVoices(session.director)).toHaveLength(0);

    // A muted api must not resurrect layers on the next frame either.
    runFrames(session.scene, 3);
    expect(session.api.layerCount).toBe(0);

    session.api.setEnabled(true);
    runFrames(session.scene, 1);
    expect(session.api.layerCount).toBe(2);
    expect(session.api.getLayer('1945', 'music')?.gain).toBeCloseTo(
      getEraSoundscapeProfile('1945').musicGain,
      9,
    );
  });

  it('ticks between the navigation rig and the audio director', () => {
    const session = openSession({ initialEra: '2025' });
    const order = (id: string): number => {
      const system = session.scene.getSystem(id);
      expect(system).toBeDefined();
      return system?.order ?? Number.NaN;
    };
    expect(order(TIMELINE_SYSTEM_ID)).toBeLessThan(order(NAVIGATION_SYSTEM_ID));
    expect(order(NAVIGATION_SYSTEM_ID)).toBeLessThan(order(SOUNDSCAPE_SYSTEM_ID));
    expect(order(SOUNDSCAPE_SYSTEM_ID)).toBeLessThan(order(AUDIO_SYSTEM_ID));
  });
});

/* ------------------------------------------------------------------------- *
 * TimelineRuntime crossfade
 * ------------------------------------------------------------------------- */

describe('SoundscapeApi crossfade', () => {
  it('rides the TimelineRuntime tween instead of cutting between eras', () => {
    const session = openSession({ initialEra: '2025' });
    const { api, timeline, scene } = session;

    timeline.selectEra('1945');
    expect(api.era).toBe('1945');
    expect(api.from).toBe('2025');
    expect(api.layerCount).toBe(4);
    expect(api.getLayer('1945', 'music')?.crossfade).toBe(0);
    expect(api.getLayer('2025', 'music')?.crossfade).toBe(1);
    expect(api.getLayer('1945', 'music')?.playing).toBe(true);

    // Half-way through the ~1.2 s tween both eras are audible, each at its
    // share of the eased progress: a crossfade, not a cut.
    runFrames(scene, 36, 1 / 60);
    expect(api.progress).toBeCloseTo(0.5, 2);
    expect(api.progress).toBeCloseTo(timeline.progress, 9);
    expect(api.getLayer('1945', 'music')?.crossfade).toBeCloseTo(timeline.progress, 9);
    expect(api.getLayer('2025', 'music')?.crossfade).toBeCloseTo(1 - timeline.progress, 9);
    expect(api.getLayer('1945', 'music')?.gain).toBeGreaterThan(0);
    expect(api.getLayer('2025', 'music')?.gain).toBeGreaterThan(0);
    expect(api.audibleLayers).toHaveLength(4);
    expect(api.transitioning).toBe(true);

    runFrames(scene, 72, 1 / 60);
    expect(api.progress).toBe(1);
    expect(api.transitioning).toBe(false);
    expect(api.layerCount).toBe(2);
    expect(api.getLayer('2025', 'music')).toBeNull();
    expect(api.getLayer('1945', 'music')?.crossfade).toBe(1);
    expect(api.getLayer('1945', 'music')?.gain).toBeCloseTo(
      getEraSoundscapeProfile('1945').musicGain,
      9,
    );
    expect(api.getLayer('1945', 'ambience')?.gain).toBeCloseTo(
      getEraSoundscapeProfile('1945').ambienceGain,
      9,
    );
  });

  it('never stacks duplicate layer voices while scrubbing mid-tween', () => {
    const session = openSession({ initialEra: '2025' });
    const { api, timeline, scene, director } = session;
    const scrub: readonly EraId[] = ['1945', '1985', '2005', '1965', '2025', '1945'];

    let peakLayers = 0;
    for (const era of scrub) {
      timeline.selectEra(era, { durationMs: 600 });
      runFrames(scene, 4, 1 / 60);
      peakLayers = Math.max(peakLayers, api.layerCount);

      const cues = bedVoices(director).map((voice) => voice.cue);
      // Two endpoints, two layers each — and one voice per cue name, always.
      expect(cues.length).toBeLessThanOrEqual(4);
      expect(new Set(cues).size).toBe(cues.length);
    }

    expect(peakLayers).toBeLessThanOrEqual(4);
    runFrames(scene, 60, 1 / 60);
    expect(api.era).toBe('1945');
    expect(api.layerCount).toBe(2);
    expect(bedVoices(director)).toHaveLength(2);
  });

  it('keeps exactly one layer set per kind for instant year changes', () => {
    const session = openSession({ initialEra: '2025' });
    const { api, timeline, scene, director } = session;

    for (const era of ERA_IDS) {
      timeline.selectEra(era, { immediate: true });
      runFrames(scene, 2, 1 / 60);

      expect(api.era).toBe(era);
      expect(api.progress).toBe(1);
      expect(api.transitioning).toBe(false);
      expect(api.layerCount).toBe(2);
      expect(api.layers.every((layer) => layer.era === era)).toBe(true);
      expect(api.getLayer(era, 'music')?.crossfade).toBe(1);

      const cues = bedVoices(director).map((voice) => voice.cue);
      expect(cues).toHaveLength(2);
      expect(new Set(cues).size).toBe(2);
    }
  });

  it('supports an equal-power crossfade curve', () => {
    const session = openSession({ initialEra: '2025' });
    // Swap in a second api on the same director/timeline pair with the
    // alternative curve, so both curves are exercised on the same graph.
    session.api.dispose();

    const api = new SoundscapeApi({
      director: session.director,
      timeline: session.timeline,
      curve: 'equal-power',
      registerWithTimeline: false,
      initialEra: '2025',
    });
    session.timeline.registerBlendable(api, { id: 'equal-power-soundscape' });

    session.timeline.selectEra('1985');
    runFrames(session.scene, 36, 1 / 60);
    expect(api.progress).toBeCloseTo(0.5, 2);
    expect(api.getLayer('1985', 'music')?.crossfade).toBeCloseTo(Math.sin(Math.PI / 4), 4);
    expect(api.getLayer('2025', 'music')?.crossfade).toBeCloseTo(Math.cos(Math.PI / 4), 4);
    runFrames(session.scene, 72, 1 / 60);
    expect(api.layerCount).toBe(2);
    api.dispose();
  });
});

/* ------------------------------------------------------------------------- *
 * Movement-reactive footsteps
 * ------------------------------------------------------------------------- */

describe('movement-reactive footsteps', () => {
  it('scales the footstep cadence with walk velocity and falls silent at rest', () => {
    const slow = openSession({ mode: 'walk', walkSpeed: 2 });
    const brisk = openSession({ mode: 'walk', walkSpeed: 6.5 });

    const sampled: number[] = [];
    walkFrames(slow, 120, () => sampled.push(slow.api.footsteps.cadence));

    const cadenceSamples: number[] = [];
    walkFrames(brisk, 120, () => cadenceSamples.push(brisk.api.footsteps.cadence));

    const slowFoot = slow.api.footsteps;
    const briskFoot = brisk.api.footsteps;

    expect(slowFoot.speed).toBeGreaterThan(1);
    expect(briskFoot.speed).toBeGreaterThan(slowFoot.speed);
    expect(slowFoot.cadence).toBeGreaterThan(0);
    expect(briskFoot.cadence).toBeGreaterThan(slowFoot.cadence);
    expect(briskFoot.steps).toBeGreaterThan(slowFoot.steps);
    expect(briskFoot.silent).toBe(false);
    // Cadence is literally velocity / stride length, capped for comfort.
    expect(briskFoot.cadence).toBeCloseTo(briskFoot.speed / DEFAULT_STRIDE_LENGTH, 1);
    // …and it tracks the acceleration ramp rather than metronoming.
    expect(cadenceSamples[10]).toBeLessThan(cadenceSamples[cadenceSamples.length - 1] as number);
    expect(sampled[sampled.length - 1]).toBeGreaterThan(sampled[0] as number);

    // Standing still (keys released, velocity damped) means silence.
    const resting = brisk.api.stepCount;
    runFrames(brisk.scene, 60, 1 / 60);
    expect(brisk.api.footsteps.speed).toBeLessThan(DEFAULT_MIN_STEP_SPEED);
    expect(brisk.api.footsteps.cadence).toBe(0);
    expect(brisk.api.footsteps.silent).toBe(true);
    runFrames(brisk.scene, 30, 1 / 60);
    expect(brisk.api.stepCount).toBe(resting);
  });

  it('keeps footsteps silent in orbit mode and resumes them in walk mode', () => {
    const session = openSession({ mode: 'orbit', walkSpeed: 6.5 });
    const before = session.api.stepCount;

    walkFrames(session, 90);
    expect(session.rig.state.mode).toBe('orbit');
    expect(session.api.footsteps.mode).toBe('orbit');
    expect(session.api.footsteps.silent).toBe(true);
    expect(session.api.stepCount).toBe(before);
    expect(session.api.triggerFootstep({ speed: 5 })).toBe(false);

    session.rig.setMode('walk');
    walkFrames(session, 90);
    expect(session.rig.state.mode).toBe('walk');
    expect(session.api.footsteps.silent).toBe(false);
    expect(session.api.footsteps.cadence).toBeGreaterThan(0);
    expect(session.api.stepCount).toBeGreaterThan(before);

    session.api.setFootstepsEnabled(false);
    const muted = session.api.stepCount;
    runFrames(session.scene, 60, 1 / 60);
    expect(session.api.stepCount).toBe(muted);
    expect(session.api.footsteps.silent).toBe(true);
  });

  it('plays footsteps through the director SFX bus, scaled by speed', () => {
    const session = openSession({ mode: 'walk', walkSpeed: 6.5 });
    walkFrames(session, 90);

    const steps = session.director.activeVoices.filter((voice) => voice.cue === FOOTSTEP_CUE);
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.bus).toBe('sfx');
      expect(step.gainNode.gain.value).toBeGreaterThan(0);
      expect(step.gainNode.gain.value).toBeLessThanOrEqual(1);
    }
    expect(session.director.describeRoute(steps[0] ?? null)).toEqual([
      'source',
      'gain',
      'bus:sfx',
      'master',
      'destination',
    ]);
  });
});

/* ------------------------------------------------------------------------- *
 * Lifecycle
 * ------------------------------------------------------------------------- */

describe('SoundscapeApi lifecycle', () => {
  it('publishes era state on the document for browser harnesses', () => {
    const session = openSession({ initialEra: '1985' });
    const root = document.documentElement;

    expect(root.dataset.chronoSoundscapeEra).toBe('1985');
    expect(root.dataset.chronoSoundscapeLayers).toBe('2');
    expect(root.dataset.chronoSoundscape?.split('|')[0]).toBe('1985');

    session.timeline.selectEra('2025', { immediate: true });
    runFrames(session.scene, 1, 1 / 60);
    expect(root.dataset.chronoSoundscapeEra).toBe('2025');
    expect(session.api.snapshot().audibleLayers).toEqual(['2025:music', '2025:ambience']);
  });

  it('publishes and detaches the global handle', () => {
    const session = openSession({ initialEra: '1945' });
    integrateSoundscapeGlobal(session.api);
    expect(getSoundscapeApi()).toBe(session.api);
    expect(window.__chronoCitySoundscape).toBe(session.api);

    detachSoundscapeGlobal(SOUNDSCAPE_GLOBAL_KEY, session.api);
    expect(getSoundscapeApi()).toBeNull();
    expect(window.__chronoCitySoundscape).toBeUndefined();
  });

  it('releases every voice and unregisters on dispose', () => {
    const session = openSession({ initialEra: '2025' });
    expect(session.timeline.hasBlendable(SOUNDSCAPE_BLENDABLE_ID)).toBe(true);
    expect(session.scene.hasSystem(SOUNDSCAPE_SYSTEM_ID)).toBe(true);
    expect(bedVoices(session.director).length).toBeGreaterThan(0);

    session.api.dispose();

    expect(session.api.isDisposed).toBe(true);
    expect(session.api.layerCount).toBe(0);
    expect(bedVoices(session.director)).toHaveLength(0);
    expect(session.timeline.hasBlendable(SOUNDSCAPE_BLENDABLE_ID)).toBe(false);
    expect(session.scene.hasSystem(SOUNDSCAPE_SYSTEM_ID)).toBe(false);

    // Disposing twice, or ticking a disposed api, is safe.
    session.api.dispose();
    expect(() => session.api.update(1 / 60)).not.toThrow();
  });

  it('degrades gracefully when no audio context can be created', () => {
    const director = createAudioDirector({ createAudioContext: () => null });
    director.registerCues(createSfxLibrary());
    const api = new SoundscapeApi({
      director,
      initialEra: '1965',
      registerWithTimeline: false,
      documentRef: document,
    });

    expect(api.era).toBe('1965');
    // The beds are known, so their layers exist — they simply have no voice.
    expect(api.layerCount).toBe(2);
    expect(api.getLayer('1965', 'music')?.playing).toBe(false);
    expect(api.getLayer('1965', 'music')?.voiceId).toBeNull();
    expect(() => api.update(1 / 60)).not.toThrow();

    api.dispose();
    director.dispose();
  });
});
