/**
 * Chrono City — tour layer suite.
 *
 * Exercises `src/tour/**` against the *real* upstream systems rather than
 * doubles, because the whole point of this layer is composition:
 *
 *  - `src/tour/introTour.ts` — the cinematic path, the show-case drift and the
 *    hand-off glide, checked as pure maths (no DOM, no systems);
 *  - `src/tour/onboardingHints.ts` — the first-run control card and the
 *    dismissal flag it persists;
 *  - `src/tour/tourApi.ts` — the seam itself: `TimelineRuntime` year changes,
 *    `HudApi` captions, `AudioDirector` era whooshes and the `NavigationRig`
 *    hand-off, all driven through a real `SceneContext` tick.
 *
 * The Web Audio implementation at the top is a small in-memory stub owning a
 * real gain graph, real `AudioParam` records and a real `resume()`, so the
 * director under test is the production class and the whoosh assertions look at
 * the voice the director actually created.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  AudioDirector,
  createAudioDirector,
  type AudioEngineContext,
} from '../../src/audio/audioDirector';
import { createSfxLibrary } from '../../src/audio/sfxSynth';
import {
  ERA_IDS,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../../src/core/eraContracts';
import {
  SceneContext,
  createSceneContext,
  type SceneContextOptions,
} from '../../src/core/sceneContext';
import { createTimelineRuntime, type TimelineRuntime } from '../../src/era/timelineRuntime';
import {
  NavigationRig,
  createNavigationRig,
} from '../../src/navigation/navigationRig';
import { createHudApi, type HudApi } from '../../src/ui/hudApi';
import {
  HandoffBlend,
  cameraPose,
  defaultIntroKeyframes,
  tourDriftPose,
  vec3,
  type CameraPose,
} from '../../src/tour/introTour';
import {
  ONBOARDING_SELECTORS,
  ONBOARDING_STORAGE_KEY,
  createMemoryStorage,
  type OnboardingStorage,
} from '../../src/tour/onboardingHints';
import {
  DEFAULT_TOUR_STOPS,
  TOUR_GLOBAL_KEY,
  TourApi,
  bootTour,
  createTourApi,
  getTourApi,
} from '../../src/tour/tourApi';

/* ------------------------------------------------------------------ */
/* Web Audio stub                                                      */
/* ------------------------------------------------------------------ */

interface StubParam {
  value: number;
  setValueAtTime(value: number, time: number): StubParam;
  linearRampToValueAtTime(value: number, time: number): StubParam;
  exponentialRampToValueAtTime(value: number, time: number): StubParam;
  setTargetAtTime(value: number, time: number, constant: number): StubParam;
  cancelScheduledValues(time: number): StubParam;
  cancelAndHoldAtTime(time: number): StubParam;
}

function createStubParam(value = 0): StubParam {
  const param: StubParam = {
    value,
    setValueAtTime(next: number) {
      param.value = next;
      return param;
    },
    linearRampToValueAtTime(next: number) {
      param.value = next;
      return param;
    },
    exponentialRampToValueAtTime(next: number) {
      param.value = next;
      return param;
    },
    setTargetAtTime(next: number) {
      param.value = next;
      return param;
    },
    cancelScheduledValues() {
      return param;
    },
    cancelAndHoldAtTime() {
      return param;
    },
  };
  return param;
}

class StubNode {
  readonly kind: string;

  constructor(kind: string) {
    this.kind = kind;
  }

  connect(target: unknown): unknown {
    return target;
  }

  disconnect(): void {}
}

class StubSource extends StubNode {
  onended: (() => void) | null = null;
  private endedListeners: Array<() => void> = [];

  start(): void {}

  stop(): void {}

  addEventListener(type: string, listener: () => void): void {
    if (type === 'ended') this.endedListeners.push(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type !== 'ended') return;
    this.endedListeners = this.endedListeners.filter((entry) => entry !== listener);
  }
}

class StubGain extends StubNode {
  readonly gain = createStubParam(1);

  constructor() {
    super('gain');
  }
}

class StubPanner extends StubNode {
  readonly positionX = createStubParam(0);
  readonly positionY = createStubParam(0);
  readonly positionZ = createStubParam(0);
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
}

class StubOscillator extends StubSource {
  type = 'sine';
  readonly frequency = createStubParam(440);

  constructor() {
    super('oscillator');
  }
}

class StubBufferSource extends StubSource {
  buffer: StubBuffer | null = null;
  loop = false;
  readonly playbackRate = createStubParam(1);

  constructor() {
    super('bufferSource');
  }
}

class StubBiquadFilter extends StubNode {
  type = 'lowpass';
  readonly frequency = createStubParam(350);
  readonly Q = createStubParam(1);

  constructor() {
    super('biquad');
  }
}

class StubBuffer {
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    void sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel] as Float32Array;
  }
}

class StubListener {
  readonly positionX = createStubParam(0);
  readonly positionY = createStubParam(0);
  readonly positionZ = createStubParam(0);
  readonly forwardX = createStubParam(0);
  readonly forwardY = createStubParam(0);
  readonly forwardZ = createStubParam(-1);
  readonly upX = createStubParam(0);
  readonly upY = createStubParam(1);
  readonly upZ = createStubParam(0);
}

class StubAudioContext {
  readonly destination = new StubNode('destination');
  readonly listener = new StubListener();
  sampleRate = 48000;
  currentTime = 0;
  state: AudioContextState = 'running';

  createGain(): StubGain {
    return new StubGain();
  }

  createPanner(): StubPanner {
    return new StubPanner();
  }

  createOscillator(): StubOscillator {
    return new StubOscillator();
  }

  createBufferSource(): StubBufferSource {
    return new StubBufferSource();
  }

  createBiquadFilter(): StubBiquadFilter {
    return new StubBiquadFilter();
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): StubBuffer {
    return new StubBuffer(numberOfChannels, length, sampleRate);
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

/** A blendable stand-in for "the rest of the scene": records what it was told. */
class EraProbe implements EraBlendable {
  readonly setups: Array<{ era: EraId; durationMs: number; immediate: boolean }> = [];
  readonly frames: Array<{ era: EraId; progress: number; active: boolean }> = [];
  readonly completed: EraId[] = [];

  setEra(era: EraId, options: EraTransitionOptions = {}): void {
    this.setups.push({
      era,
      durationMs: options.durationMs ?? -1,
      immediate: options.immediate === true,
    });
  }

  updateEraTransition(progress: number, transition: EraTransitionInfo): void {
    this.frames.push({ era: transition.to, progress, active: transition.active });
    if (progress >= 1 && !transition.active) this.completed.push(transition.to);
  }

  /** `true` when the probe was driven all the way through `era`. */
  sawFullTransition(era: EraId): boolean {
    return this.completed.includes(era);
  }

  reset(): void {
    this.setups.length = 0;
    this.frames.length = 0;
    this.completed.length = 0;
  }
}

interface TourComposition {
  readonly context: SceneContext;
  readonly timeline: TimelineRuntime;
  readonly rig: NavigationRig;
  readonly hud: HudApi;
  readonly director: AudioDirector;
  readonly audioStub: StubAudioContext;
  readonly probe: EraProbe;
  readonly storage: OnboardingStorage;
  readonly tour: TourApi;
}

interface CompositionOptions {
  readonly intro?: { durationMs?: number; blendInMs?: number; handoffMs?: number };
  /** Extra tour options; the wiring below always wins. */
  readonly tourOptions?: Record<string, unknown>;
  readonly audioBlendable?: boolean;
  readonly storage?: OnboardingStorage;
  readonly showOnboarding?: boolean;
  readonly onboarding?: Record<string, unknown> | null;
}

const cleanups: Array<() => void> = [];

function registerCleanup(fn: () => void): void {
  cleanups.push(fn);
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

/** A scene context with the overlay root the HUD and the hint card mount into. */
function openSceneContext(options: SceneContextOptions = {}): SceneContext {
  const container = document.createElement('div');
  const overlayRoot = document.createElement('div');
  overlayRoot.setAttribute('data-chrono-overlay', '');
  container.appendChild(overlayRoot);
  document.body.appendChild(container);
  const canvas = document.createElement('canvas');
  // The canvas must be in the document: the rig listens on it and the tour
  // listens on the document, so a detached canvas would swallow the gesture
  // before either of them could see it.
  container.appendChild(canvas);
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
  registerCleanup(() => context.dispose());
  return context;
}

/** The live app exactly as the integration layer wires it, plus the tour. */
function openComposition(options: CompositionOptions = {}): TourComposition {
  const context = openSceneContext();
  const timeline = createTimelineRuntime({ initialEra: '2025', durationMs: 200 });
  timeline.attach(context);
  registerCleanup(() => timeline.dispose());

  const probe = new EraProbe();
  timeline.registerBlendable(probe, { id: 'scene-probe' });
  probe.reset();

  const rig = createNavigationRig(context, { controls: true });
  registerCleanup(() => rig.dispose());

  const audioStub = new StubAudioContext();
  const director = createAudioDirector({
    createAudioContext: () => audioStub as unknown as AudioEngineContext,
  });
  director.registerCues(createSfxLibrary());
  registerCleanup(() => director.dispose());
  if (options.audioBlendable ?? false) {
    timeline.registerBlendable(director, { id: 'audio-director' });
  }

  const hud = createHudApi({ context, timeline, audio: director, integrateGlobal: false });
  registerCleanup(() => hud.dispose());

  const storage = options.storage ?? createMemoryStorage();
  const tour = createTourApi({
    ...(options.tourOptions ?? {}),
    context,
    timeline,
    rig,
    hud,
    audio: director,
    document,
    overlayRoot: context.overlayRoot,
    integrateGlobal: false,
    introDurationMs: options.intro?.durationMs,
    introBlendInMs: options.intro?.blendInMs,
    handoffMs: options.intro?.handoffMs,
    autoShowOnboarding: options.showOnboarding ?? false,
    onboarding:
      options.onboarding === null ? null : { storage, ...(options.onboarding ?? {}) },
  } as unknown as Parameters<typeof createTourApi>[0]);
  registerCleanup(() => tour.dispose());

  return { context, timeline, rig, hud, director, audioStub, probe, storage, tour };
}

/** Releases a composition mid-test (the "reload" half of a persistence check). */
function disposeComposition(composition: TourComposition): void {
  composition.tour.dispose();
  composition.hud.dispose();
  composition.rig.dispose();
  composition.timeline.dispose();
  composition.director.dispose();
  composition.context.dispose();
}

/* ------------------------------------------------------------------ */
/* Event + frame helpers                                               */
/* ------------------------------------------------------------------ */

function tick(context: SceneContext, frames = 1, delta = 1 / 60): void {
  for (let frame = 0; frame < frames; frame += 1) context.tick(delta);
}

/** Runs frames until `done()` or the guard trips; returns the frames spent. */
function tickUntil(context: SceneContext, done: () => boolean, guard = 4000): number {
  let frames = 0;
  while (!done() && frames < guard) {
    context.tick(1 / 60);
    frames += 1;
  }
  return frames;
}

function distance(
  a: { readonly x: number; readonly y: number; readonly z: number },
  b: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function pointerEvent(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    isPrimary: true,
    button: 0,
    ...init,
  });
}

function keyEvent(code: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true });
}

/** A real orbit drag as the browser would deliver it: down on the canvas, move on window. */
function dragOrbit(context: SceneContext, deltaX = 48): void {
  const canvas = context.canvas;
  canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 640, clientY: 400 }));
  window.dispatchEvent(pointerEvent('pointermove', { clientX: 640 + deltaX, clientY: 400 }));
  window.dispatchEvent(pointerEvent('pointerup', { clientX: 640 + deltaX, clientY: 400 }));
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  delete (window as unknown as Record<string, unknown>)[TOUR_GLOBAL_KEY];
  delete (window as unknown as Record<string, unknown>).__chronoCity;
  delete (window as unknown as Record<string, unknown>).__chronoCityHud;
  delete (window as unknown as Record<string, unknown>).__chronoCityTimeline;
  delete (window as unknown as Record<string, unknown>).__chronoCityAudio;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Intro flythrough                                                    */
/* ------------------------------------------------------------------ */

describe('intro flythrough', () => {
  it('plays on load and lands exactly on the frame navigation resumes from', () => {
    const { context, rig, tour } = openComposition();
    const { camera } = context;

    tour.startIntro();
    const started = tour.snapshot();
    expect(started.state).toBe('intro');
    expect(started.cameraOwner).toBe('intro');
    expect(started.introPhase).toBe('flying');
    expect(started.counters.introStarts).toBe(1);

    // Frame one is still the user's frame: the cinematic grows out of it.
    tick(context);
    expect(distance(camera.position, rig.state.position)).toBeLessThan(0.05);

    // Fly the whole intro, watching for teleports and for the landing.
    let previous = camera.position.clone();
    let maxStep = 0;
    let handoffFrames = 0;
    let frames = 0;
    while (frames < 900 && !tour.intro.isFinished) {
      context.tick(1 / 60);
      maxStep = Math.max(maxStep, previous.distanceTo(camera.position));
      previous = camera.position.clone();
      if (tour.intro.phase === 'handoff') handoffFrames += 1;
      frames += 1;
    }

    expect(tour.intro.isFinished).toBe(true);
    expect(frames).toBeGreaterThan(60);
    // No teleport anywhere in the cinematic (one frame never crosses the block).
    expect(maxStep).toBeLessThan(2.5);
    // The hand-off is a real glide, not a cut.
    expect(handoffFrames).toBeGreaterThan(10);

    // The last tour frame is the pose the rig takes over with.
    const landed = distance(camera.position, rig.state.position);
    expect(landed).toBeLessThan(1e-6);
    expect(tour.snapshot().cameraOwner).toBe('none');
    expect(tour.snapshot().state).toBe('idle');
    expect(tour.snapshot().counters.introCompletions).toBe(1);
    expect(tour.snapshot().counters.handoffs).toBe(1);

    // Idle frames with no input never move the camera: the rig is in charge.
    const resting = camera.position.clone();
    tick(context, 30);
    expect(camera.position.distanceTo(resting)).toBeLessThan(1e-9);
  });

  it('hands off to free navigation that responds to the user immediately', () => {
    const { context, tour } = openComposition();
    tour.startIntro({ skip: true });
    tickUntil(context, () => tour.snapshot().running === false, 300);

    expect(tour.snapshot().running).toBe(false);
    expect(tour.snapshot().cameraOwner).toBe('none');

    const before = context.camera.position.clone();
    dragOrbit(context, 60);
    tick(context, 40);
    expect(context.camera.position.distanceTo(before)).toBeGreaterThan(1);
  });

  it('cancels on the first input and glides back to the rig without a jump', () => {
    const { context, rig, tour } = openComposition({
      intro: { durationMs: 4000, blendInMs: 400, handoffMs: 240 },
    });
    tour.startIntro();
    tick(context, 60);

    const inFlight = context.camera.position.clone();
    expect(distance(inFlight, rig.state.position)).toBeGreaterThan(10);
    expect(tour.intro.phase).toBe('flying');

    document.dispatchEvent(keyEvent('KeyW'));

    const cancelled = tour.snapshot();
    expect(cancelled.lastStopReason).toBe('user-input');
    expect(cancelled.state).toBe('idle');
    expect(cancelled.counters.introCancels).toBe(1);
    expect(tour.intro.phase).toBe('handoff');
    expect(tour.intro.ownsCamera).toBe(true);

    // The glide is continuous, is sized to the retreat, and lands on the rig.
    let previous = context.camera.position.clone();
    let maxStep = 0;
    let lastStep = 0;
    let frames = 0;
    while (tour.intro.phase !== 'finished' && frames < 600) {
      context.tick(1 / 60);
      const step = previous.distanceTo(context.camera.position);
      maxStep = Math.max(maxStep, step);
      lastStep = step;
      previous = context.camera.position.clone();
      frames += 1;
    }

    expect(tour.intro.phase).toBe('finished');
    expect(frames).toBeGreaterThan(10);
    expect(maxStep).toBeLessThan(3);
    // Eased: the glide is settling, not whipping, when it lands.
    expect(lastStep).toBeLessThan(0.05);
    expect(distance(context.camera.position, rig.state.position)).toBeLessThan(1e-6);
    expect(tour.intro.ownsCamera).toBe(false);
    // A cancelled cinematic is never reported as a completed one.
    expect(tour.snapshot().counters.introCompletions).toBe(0);

    // Control is live again straight away.
    const resting = context.camera.position.clone();
    dragOrbit(context, 40);
    tick(context, 30);
    expect(context.camera.position.distanceTo(resting)).toBeGreaterThan(0.5);
  });

  it('chains into the optional auto time-tour only after a completed flythrough', () => {
    const chained = openComposition({
      intro: { durationMs: 600, blendInMs: 100, handoffMs: 120 },
      tourOptions: { autoStartTimeTour: true },
    });
    chained.tour.startIntro();
    tickUntil(chained.context, () => chained.tour.snapshot().state === 'tour', 400);

    expect(chained.tour.snapshot().state).toBe('tour');
    expect(chained.tour.snapshot().counters.introCompletions).toBe(1);
    expect(chained.timeline.era).toBe('1945');
    chained.tour.stop('api');

    // An interrupted flythrough never chains: the visitor asked for control.
    const interrupted = openComposition({
      intro: { durationMs: 4000, blendInMs: 400 },
      tourOptions: { autoStartTimeTour: true },
    });
    interrupted.tour.startIntro();
    tick(interrupted.context, 30);
    interrupted.tour.cancel('user-input');
    tickUntil(interrupted.context, () => interrupted.tour.snapshot().running === false, 400);

    expect(interrupted.tour.snapshot().state).toBe('idle');
    expect(interrupted.tour.snapshot().counters.introCompletions).toBe(0);
    expect(interrupted.timeline.era).toBe('2025');
  });
});

/* ------------------------------------------------------------------ */
/* Auto time-tour                                                      */
/* ------------------------------------------------------------------ */

describe('auto time-tour', () => {
  it('cycles 1945 → 1965 → 1985 → 2005 → 2025 with era captions and full-scene transitions', () => {
    const { context, timeline, hud, tour, probe } = openComposition();

    const selected: EraId[] = [];
    timeline.subscribe((era) => selected.push(era));
    const captioned: EraId[] = [];

    tour.startTimeTour({ dwellMs: 400, transitionMs: 200 });

    expect(tour.snapshot().state).toBe('tour');
    expect(tour.snapshot().stopCount).toBe(5);
    expect(tour.snapshot().stopIndex).toBe(0);
    // The first stop is already selected, through the timeline.
    expect(timeline.era).toBe('1945');
    expect(tour.snapshot().captionEra).toBe('1945');
    expect(hud.snapshot().toasts.join(' ')).toContain('1945');

    let frames = 0;
    while (tour.snapshot().state === 'tour' && frames < 3000) {
      context.tick(1 / 60);
      frames += 1;
      const snapshot = tour.snapshot();
      if (snapshot.captionEra && captioned[captioned.length - 1] !== snapshot.captionEra) {
        captioned.push(snapshot.captionEra);
      }
      // The caption can never describe a year the scene is not showing.
      if (snapshot.captionEra) expect(snapshot.captionEra).toBe(timeline.era);
      // The tour never forks year state.
      expect(snapshot.era).toBe(timeline.era);
    }

    expect(frames).toBeLessThan(3000);
    expect(selected).toEqual([...DEFAULT_TOUR_STOPS]);
    expect(captioned).toEqual([...DEFAULT_TOUR_STOPS]);
    expect(probe.setups.map((setup) => setup.era)).toEqual([...DEFAULT_TOUR_STOPS]);

    // The whole scene transformed at every stop, not just the selection.
    for (const era of ERA_IDS) expect(probe.sawFullTransition(era)).toBe(true);
    const fullProgress = probe.frames.filter((frame) => frame.progress >= 1 && !frame.active);
    for (const era of ERA_IDS) {
      expect(fullProgress.some((frame) => frame.era === era)).toBe(true);
    }

    // The showcase ends cleanly: caption gone, camera handed back to the rig.
    const ended = tour.snapshot();
    expect(ended.lastStopReason).toBe('complete');
    expect(ended.caption).toBeNull();
    expect(ended.captionEra).toBeNull();
    expect(hud.snapshot().toasts).toHaveLength(0);
    expect(ended.counters.eraStops).toBe(5);
    expect(ended.counters.tourStops).toBe(1);

    tickUntil(context, () => tour.snapshot().cameraOwner === 'none', 300);
    expect(tour.snapshot().cameraOwner).toBe('none');
    expect(tour.snapshot().running).toBe(false);
  });

  it('floats the camera through the showcase and glides home when it ends', () => {
    const { context, rig, tour } = openComposition();
    tour.startTimeTour({ dwellMs: 300, transitionMs: 150 });

    tick(context, 30);
    expect(tour.snapshot().cameraOwner).toBe('tour');
    // The crane starts exactly on the rig's frame...
    const offset = distance(context.camera.position, rig.state.position);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(12);

    tickUntil(context, () => tour.snapshot().state === 'idle', 3000);
    expect(tour.snapshot().state).toBe('idle');
    expect(tour.snapshot().cameraOwner).toBe('handoff');

    tickUntil(context, () => tour.snapshot().cameraOwner === 'none', 300);
    expect(tour.snapshot().cameraOwner).toBe('none');
    expect(distance(context.camera.position, rig.state.position)).toBeLessThan(1e-6);
  });

  it('cancels the tour on user input and hands control back mid-flight', () => {
    const { context, rig, hud, tour } = openComposition();
    tour.startTimeTour({ dwellMs: 2000, transitionMs: 200 });
    tick(context, 40);

    expect(tour.snapshot().state).toBe('tour');
    expect(tour.snapshot().cameraOwner).toBe('tour');

    dragOrbit(context, 40);

    const cancelled = tour.snapshot();
    expect(cancelled.state).toBe('idle');
    expect(cancelled.lastStopReason).toBe('user-input');
    expect(cancelled.caption).toBeNull();
    expect(cancelled.counters.tourStops).toBe(1);
    expect(cancelled.counters.handoffs).toBeGreaterThanOrEqual(1);
    expect(hud.snapshot().toasts).toHaveLength(0);
    // The year stays where the timeline put it; the tour does not roll back.
    expect(tour.snapshot().era).toBe(cancelled.era);

    tickUntil(context, () => tour.snapshot().cameraOwner === 'none', 300);
    expect(tour.snapshot().cameraOwner).toBe('none');
    expect(distance(context.camera.position, rig.state.position)).toBeLessThan(1e-6);

    const resting = context.camera.position.clone();
    dragOrbit(context, 50);
    tick(context, 30);
    expect(context.camera.position.distanceTo(resting)).toBeGreaterThan(0.5);
  });

  it('voices one era whoosh per step through the AudioDirector', async () => {
    const { context, director, tour } = openComposition();
    await director.unlock();
    expect(director.isUnlocked).toBe(true);

    tour.startTimeTour({ dwellMs: 300, transitionMs: 150 });
    expect(director.activeVoiceCount).toBeGreaterThan(0);

    tickUntil(context, () => tour.snapshot().state === 'idle', 3000);

    const counters = tour.snapshot().counters;
    expect(counters.eraStops).toBe(5);
    expect(counters.whooshes).toBe(5);
    expect(counters.timelineWhooshes).toBe(0);
    // Five steps voiced five separate voices on the director.
    expect(director.activeVoiceCount).toBeGreaterThanOrEqual(5);
  });

  it('leaves the era seam to the timeline when the director is one of its blendables', async () => {
    const { context, director, timeline, tour } = openComposition({ audioBlendable: true });
    await director.unlock();

    tour.startTimeTour({ dwellMs: 300, transitionMs: 150 });
    expect(tour.snapshot().counters.whooshes).toBe(0);
    expect(director.eraTransitionActive).toBe(true);
    expect(director.eraTarget).toBe('1945');

    tickUntil(context, () => tour.snapshot().state === 'idle', 3000);

    const counters = tour.snapshot().counters;
    expect(counters.eraStops).toBe(5);
    expect(counters.whooshes).toBe(0);
    expect(counters.timelineWhooshes).toBe(5);
    // The seams were voiced all the same — by the timeline, not twice.
    expect(director.activeVoiceCount).toBeGreaterThanOrEqual(5);
    expect(timeline.hasBlendable('audio-director')).toBe(true);
  });

  it('reports a missing TimelineRuntime instead of moving the year behind its back', () => {
    const { context, timeline, tour } = openComposition();
    tour.connect({ timeline: null });

    tour.startTimeTour({ dwellMs: 5000, transitionMs: 100 });
    expect(tour.snapshot().warnings).toContain('timeline-missing');
    expect(timeline.era).toBe('2025');
    expect(tour.snapshot().captionEra).toBe('1945');

    tick(context, 40);
    expect(timeline.era).toBe('2025');
    expect(tour.snapshot().captionEra).toBe('1945');
    tour.stop('api');
    expect(tour.snapshot().state).toBe('idle');
  });
});

/* ------------------------------------------------------------------ */
/* First-run control hints                                             */
/* ------------------------------------------------------------------ */

describe('first-run control hints', () => {
  it('explains navigation and inspection once, and persists the dismissal across a reload', () => {
    const storage = createMemoryStorage();

    const first = openComposition({ storage, showOnboarding: true });
    const hints = first.tour.onboarding;
    expect(hints).not.toBeNull();
    expect(hints?.isVisible).toBe(true);
    expect(hints?.snapshot().hintCount).toBeGreaterThanOrEqual(8);

    const card = document.querySelector<HTMLElement>(ONBOARDING_SELECTORS.card);
    expect(card).not.toBeNull();
    const copy = card?.textContent ?? '';
    expect(copy).toMatch(/Orbit/);
    expect(copy).toMatch(/Walk/);
    expect(copy).toMatch(/Click|Inspect/);
    expect(document.querySelectorAll(ONBOARDING_SELECTORS.item).length).toBe(
      hints?.snapshot().hintCount,
    );

    const dismiss = document.querySelector<HTMLButtonElement>(ONBOARDING_SELECTORS.dismiss);
    expect(dismiss).not.toBeNull();
    dismiss?.click();

    expect(hints?.isVisible).toBe(false);
    expect(hints?.isDismissed).toBe(true);
    expect(hints?.dismissalReason).toBe('user');
    expect(first.tour.snapshot().lastOnboardingDismissReason).toBe('user');

    // "Reload": brand new objects, same storage.
    disposeComposition(first);
    const second = openComposition({ storage, showOnboarding: true });
    expect(second.tour.onboarding?.isVisible).toBe(false);
    expect(second.tour.onboarding?.shouldShow()).toBe(false);
    expect(second.tour.showOnboarding()).toBe(false);
    const reloadedCard = document.querySelector<HTMLElement>(ONBOARDING_SELECTORS.root);
    expect(reloadedCard?.hasAttribute('hidden')).toBe(true);

    // Clearing storage makes the visitor new again.
    second.tour.resetOnboarding();
    expect(second.tour.onboarding?.shouldShow()).toBe(true);
    expect(second.tour.showOnboarding()).toBe(true);
    expect(second.tour.onboarding?.isVisible).toBe(true);
  });

  it('persists the dismissal in the host storage the browser reloads with', () => {
    localStorage.clear();
    const storage: OnboardingStorage = localStorage;
    const first = openComposition({ storage, showOnboarding: true });
    expect(first.tour.onboarding?.isVisible).toBe(true);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toContain('"showCount":1');

    first.tour.dismissOnboarding('user');
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toContain('"dismissed":true');

    disposeComposition(first);
    const second = openComposition({ storage, showOnboarding: true });
    expect(second.tour.onboarding?.isVisible).toBe(false);
    localStorage.clear();
  });

  it('never nags a visitor who left the hints on screen', () => {
    const storage = createMemoryStorage();
    const first = openComposition({ storage, showOnboarding: true });
    expect(first.tour.onboarding?.isVisible).toBe(true);
    expect(first.tour.onboarding?.wasShown).toBe(true);

    disposeComposition(first);
    const second = openComposition({ storage, showOnboarding: true });
    expect(second.tour.onboarding?.shouldShow()).toBe(false);
    expect(second.tour.onboarding?.isVisible).toBe(false);
  });

  it('clears the hints on the first real input', () => {
    const { context, tour } = openComposition({ showOnboarding: true });
    expect(tour.onboarding?.isVisible).toBe(true);

    tour.startIntro();
    dragOrbit(context, 20);

    expect(tour.onboarding?.isVisible).toBe(false);
    expect(tour.onboarding?.dismissalReason).toBe('input');
    // The same gesture ended the cinematic: the visitor is in control.
    expect(tour.snapshot().lastStopReason).toBe('user-input');
  });
});

/* ------------------------------------------------------------------ */
/* Composition seam, boot and choreography primitives                  */
/* ------------------------------------------------------------------ */

describe('TourApi composition seam', () => {
  it('boots from the published application handles and starts the intro on load', async () => {
    const context = openSceneContext();
    const timeline = createTimelineRuntime({ initialEra: '2025', durationMs: 0 });
    timeline.attach(context);
    registerCleanup(() => timeline.dispose());
    const rig = createNavigationRig(context, { controls: false });
    registerCleanup(() => rig.dispose());
    const stub = new StubAudioContext();
    const director = createAudioDirector({
      createAudioContext: () => stub as unknown as AudioEngineContext,
    });
    director.registerCues(createSfxLibrary());
    registerCleanup(() => director.dispose());
    await director.unlock();
    const hud = createHudApi({ context, timeline, audio: director, integrateGlobal: false });
    registerCleanup(() => hud.dispose());

    // Exactly what `src/main.ts` + the integration layer publish.
    (window as unknown as Record<string, unknown>).__chronoCity = { context };
    (window as unknown as Record<string, unknown>).__chronoCityTimeline = timeline;
    (window as unknown as Record<string, unknown>).__chronoCityHud = hud;
    (window as unknown as Record<string, unknown>).__chronoCityAudio = director;

    const storage = createMemoryStorage();
    const tour = bootTour({ rig, onboarding: { storage } });
    expect(tour).not.toBeNull();
    expect(tour).toBeInstanceOf(TourApi);
    expect(getTourApi()).toBe(tour);
    expect(tour?.context).toBe(context);
    expect(tour?.timeline).toBe(timeline);
    expect(tour?.hud).toBe(hud);
    expect(tour?.audio).toBe(director);
    expect(tour?.navigationRig).toBe(rig);
    expect(tour?.snapshot().state).toBe('intro');
    expect(tour?.isAttached).toBe(true);
    expect(tour?.onboarding?.isVisible).toBe(true);

    // Booting twice returns the running tour, never a second one.
    expect(bootTour({ rig })).toBe(tour);
    registerCleanup(() => tour?.dispose());

    // The tour is published for overlays and browser probes, and its state is
    // mirrored on the document element so Playwright can assert it.
    expect((window as unknown as Record<string, unknown>)[TOUR_GLOBAL_KEY]).toBe(tour);
    tick(context);
    expect(document.documentElement.dataset.chronoTour).toBe('intro');
    expect(document.documentElement.dataset.chronoTourCamera).toBe('intro');

    tour?.stop('api');
    expect(tour?.snapshot().lastStopReason).toBe('api');
  });

  it('keeps the drift, the glide and the path continuous', () => {
    const base: CameraPose = cameraPose(vec3(0, 56, 82), vec3(0, 6, 0), 55);

    // The showcase sway starts exactly on the pose it was handed...
    const start = tourDriftPose(0, base);
    expect(start.position).toEqual(base.position);
    expect(start.target).toEqual(base.target);
    // ...and closes its loop after one period.
    const looped = tourDriftPose(26_000, base);
    expect(distance(looped.position, base.position)).toBeLessThan(0.01);
    // Half way through it has actually moved.
    expect(distance(tourDriftPose(13_000, base).position, base.position)).toBeGreaterThan(1);

    // The hand-off lands exactly on a target that moves under it.
    const glide = new HandoffBlend(200);
    glide.begin(cameraPose(vec3(120, 90, 140), vec3(0, 20, 0)));
    let sample = glide.advance(16, base);
    expect(sample.done).toBe(false);
    expect(sample.progress).toBeLessThan(1);
    const moving = cameraPose(vec3(4, 58, 86), vec3(0, 6, 0));
    for (let frame = 0; frame < 40 && !sample.done; frame += 1) {
      sample = glide.advance(16, moving);
    }
    expect(sample.done).toBe(true);
    expect(sample.pose).toBe(moving);
    expect(glide.active).toBe(false);

    // The default choreography is a real path: several beats, opening at 0 and
    // closing at 1 so the entry and the hand-off land on authored keyframes.
    const keyframes = defaultIntroKeyframes();
    expect(keyframes.length).toBeGreaterThanOrEqual(6);
    expect(keyframes[0]?.at).toBe(0);
    expect(keyframes[keyframes.length - 1]?.at).toBe(1);
    for (let index = 1; index < keyframes.length; index += 1) {
      expect(keyframes[index]?.at).toBeGreaterThan(keyframes[index - 1]?.at ?? 0);
    }
  });
});
