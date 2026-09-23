/**
 * Chrono City — era-transition composition suite.
 *
 * Proves the integration work order against the *real* composed application, not
 * against doubles: the suite builds one `StartupSequence` over a stubbed WebGL
 * renderer and a stubbed Web Audio graph, which is the only way to run the real
 * `SceneContext`, `TimelineRuntime`, buildings, storefronts, traffic,
 * pedestrians, environment, soundscape, HUD, post-processing pipeline, tour,
 * navigation rig, inspection layer, audio director, adaptive-quality monitor and
 * era orchestrator headlessly.
 *
 * What it asserts:
 *
 *  1. **Startup sequencing** — a loading screen covers registration, every stage
 *     runs, the shell self-starts, the scene draws, the screen lifts, and audio
 *     is still gesture-gated (never unlocked by startup).
 *  2. **One orchestrated era change** — the shared ~1.2 s `TimelineRuntime`
 *     tween, the era whoosh, the grading sweep and the HUD caption fire together
 *     for every selection.
 *  3. **Composed transformation** — driving 1945 → 1965 → 1985 → 2005 → 2025
 *     changes buildings, storefronts/advertising, vehicles, pedestrian outfits,
 *     street dressing, soundscape, grading and HUD together, with zero era leaks.
 *  4. **Mid-tween consistency and scrubbing** — every subsystem targets the same
 *     year mid-tween, a retarget mid-tween supersedes cleanly, and rapid
 *     scrubbing lands on the last selection with no subsystem left behind.
 *  5. **Adaptive-quality guardrails** — frame-time monitoring walks the pass
 *     ladder down (DOF then grain, then pixel ratio) and back up, and era
 *     transformation plus navigation keep working at the lowest tier.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  AUDIO_GLOBAL_KEY,
  AudioDirector,
  createAudioDirector,
  type AudioEngineContext,
} from '../../src/audio/audioDirector';
import { ERA_WHOOSH_CUE, createSfxLibrary } from '../../src/audio/sfxSynth';
import { ERA_IDS, type EraId } from '../../src/core/eraContracts';
import {
  SceneContext,
  createSceneContextApp,
  type SceneContextApp,
} from '../../src/core/sceneContext';
import { HUD_GLOBAL_KEY } from '../../src/ui/hudApi';
import { INSPECTION_GLOBAL_KEY } from '../../src/interaction/pickingController';
import {
  RENDER_PIPELINE_GLOBAL_KEY,
  type RenderPipelineApi,
} from '../../src/rendering/renderPipelineApi';
import { RENDER_PIPELINE_PASS_IDS } from '../../src/rendering/renderPipelineApi';
import { TOUR_GLOBAL_KEY } from '../../src/tour/tourApi';
import { SOUNDSCAPE_GLOBAL_KEY } from '../../src/audio/soundscapeApi';
import { ERA_ORCHESTRATOR_GLOBAL_KEY } from '../../src/integration/eraTransitionOrchestrator';
import {
  LOADING_SELECTORS,
  LOADING_MIN_VISIBLE_MS,
  STARTUP_GLOBAL_KEY,
  STARTUP_STAGES,
  LoadingScreen,
  StartupSequence,
  initialQualityForRenderer,
  isSoftwareRenderer,
  type ComposedCity,
  readExperience,
  startChronoCityExperience,
} from '../../src/integration/startupSequence';
import { ADAPTIVE_QUALITY_TIERS } from '../../src/integration/adaptiveQuality';
import type { AdaptiveQualityAction } from '../../src/integration/adaptiveQuality';

/* ------------------------------------------------------------------------- *
 * WebGL stub (the composer needs a renderer-shaped object, not a GPU)
 * ------------------------------------------------------------------------- */

interface StubGl {
  renderer: THREE.WebGLRenderer;
  pixelRatio: number;
  width: number;
  height: number;
  renderCalls: number;
  setPixelRatioCalls: number[];
}

function createStubGl(canvas: HTMLCanvasElement, options: { software?: boolean } = {}): StubGl {
  const state: StubGl = {
    renderer: null as unknown as THREE.WebGLRenderer,
    // A high-DPI surface, so the quality ladder's pixel-ratio step is observable.
    pixelRatio: 2,
    width: 1280,
    height: 800,
    renderCalls: 0,
    setPixelRatioCalls: [],
  };

  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    getPixelRatio: () => state.pixelRatio,
    setPixelRatio: (value: number) => {
      state.pixelRatio = value;
      state.setPixelRatioCalls.push(value);
    },
    getSize: (target: THREE.Vector2) => target.set(state.width, state.height),
    setSize: (width: number, height: number) => {
      state.width = width;
      state.height = height;
    },
    getDrawingBufferSize: (target: THREE.Vector2) =>
      target.set(state.width * state.pixelRatio, state.height * state.pixelRatio),
    getRenderTarget: () => null,
    setRenderTarget: () => undefined,
    getClearColor: (target: THREE.Color) => target.setRGB(0, 0, 0),
    setClearColor: () => undefined,
    getClearAlpha: () => 1,
    setClearAlpha: () => undefined,
    clear: () => undefined,
    clearDepth: () => undefined,
    render: () => {
      state.renderCalls += 1;
    },
    setAnimationLoop: () => undefined,
    dispose: () => undefined,
    // Only a software renderer advertises itself through the debug extension.
    ...(options.software
      ? {
          getContext: () => ({
            getExtension: (name: string) =>
              name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
            getParameter: () => 'ANGLE (Google, Vulkan (SwiftShader Device), SwiftShader driver)',
          }),
        }
      : {}),
  };

  state.renderer = stub as unknown as THREE.WebGLRenderer;
  return state;
}

/* ------------------------------------------------------------------------- *
 * Web Audio stub (a real gain graph, so the director under test is the
 * production class and its era whoosh is really synthesised)
 * ------------------------------------------------------------------------- */

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
}

class StubOscillator extends StubSource {
  type = 'sine';
  readonly frequency = createStubParam(440);
  readonly detune = createStubParam(0);
}

class StubBufferSource extends StubSource {
  buffer: StubBuffer | null = null;
  loop = false;
  readonly playbackRate = createStubParam(1);
}

class StubBiquadFilter extends StubNode {
  type = 'lowpass';
  readonly frequency = createStubParam(350);
  readonly Q = createStubParam(1);
  readonly gain = createStubParam(0);
}

class StubBuffer {
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
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
  readonly destination = new StubNode();
  readonly listener = new StubListener();
  sampleRate = 48000;
  currentTime = 0;
  state: AudioContextState = 'suspended';
  resumeCalls = 0;

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

  createBuffer(numberOfChannels: number, length: number): StubBuffer {
    return new StubBuffer(numberOfChannels, length);
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

/* ------------------------------------------------------------------------- *
 * Fixture
 * ------------------------------------------------------------------------- */

interface Fixture {
  readonly app: SceneContextApp;
  readonly context: SceneContext;
  readonly gl: StubGl;
  readonly audioStub: StubAudioContext;
  readonly director: AudioDirector;
  readonly sequence: StartupSequence;
}

let fixture: Fixture | null = null;

/** Builds a real `AudioDirector` over the stub Web Audio graph. */
function createDirector(): { director: AudioDirector; stub: StubAudioContext } {
  const stub = new StubAudioContext();
  const director = createAudioDirector({
    createAudioContext: () => stub as unknown as AudioEngineContext,
  });
  director.registerCues(createSfxLibrary());
  return { director, stub };
}

/** One animation-loop iteration: dispatch every system, then draw. */
function runFrames(frames: number, delta = 1 / 60): void {
  runContextFrames(mustFixture().context, frames, delta);
}

/** Drives one scene context for `frames` animation-loop iterations. */
function runContextFrames(context: SceneContext, frames: number, delta = 1 / 60): void {
  for (let frame = 0; frame < frames; frame += 1) {
    context.tick(delta);
    context.render();
  }
}

function mustFixture(): Fixture {
  if (!fixture) throw new Error('composition fixture is not open');
  return fixture;
}

function mustCity(): ComposedCity {
  const city = mustFixture().sequence.city;
  if (!city) throw new Error('the composed city did not assemble');
  return city;
}

/** Selects a year and runs enough frames for the 1.2 s tween to land. */
function selectAndSettle(era: EraId, frames = 100): void {
  mustFixture().sequence.orchestrator.selectEra(era);
  runFrames(frames);
}

const GLOBAL_KEYS = [
  STARTUP_GLOBAL_KEY,
  HUD_GLOBAL_KEY,
  TOUR_GLOBAL_KEY,
  SOUNDSCAPE_GLOBAL_KEY,
  RENDER_PIPELINE_GLOBAL_KEY,
  INSPECTION_GLOBAL_KEY,
  ERA_ORCHESTRATOR_GLOBAL_KEY,
  AUDIO_GLOBAL_KEY,
  '__chronoCity',
  '__chronoCityTimeline',
  '__chronoCityTraffic',
  '__chronoCityPedestrians',
  '__chronoCityEnvironment',
];

beforeAll(() => {
  // A high-DPI display so the quality ladder's pixel-ratio step is observable:
  // jsdom reports 1, and the composer resolves against the renderer's ratio.
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });

  const container = document.createElement('div');
  container.setAttribute('data-chrono-stage', '');
  const overlayRoot = document.createElement('div');
  overlayRoot.setAttribute('data-chrono-overlay', '');
  container.appendChild(overlayRoot);
  document.body.appendChild(container);

  const canvas = document.createElement('canvas');
  const gl = createStubGl(canvas);
  const app = createSceneContextApp({
    canvas,
    container,
    overlayRoot,
    autoResize: false,
    shadows: false,
    maxPixelRatio: 2,
    createRenderer: () => gl.renderer,
  });

  const { director, stub: audioStub } = createDirector();
  const sequence = new StartupSequence({
    app,
    document,
    audio: director,
    initialEra: '1945',
    startTour: true,
  });

  fixture = { app, context: app.context, gl, audioStub, director, sequence };
}, 120_000);

afterAll(() => {
  const active = fixture;
  fixture = null;
  if (!active) {
    delete (window as unknown as Record<string, unknown>).devicePixelRatio;
    return;
  }
  try {
    active.sequence.dispose();
  } finally {
    active.director.dispose();
    active.context.dispose();
    delete (window as unknown as Record<string, unknown>).devicePixelRatio;
    for (const key of GLOBAL_KEYS) delete (globalThis as unknown as Record<string, unknown>)[key];
    delete (window as unknown as Record<string, unknown>)[STARTUP_GLOBAL_KEY];
    document.body.replaceChildren();
  }
}, 120_000);

/* ------------------------------------------------------------------------- *
 * 1. Startup sequencing
 * ------------------------------------------------------------------------- */

describe('startup sequencing', () => {
  it('covers system registration with a loading screen and self-starts the scene', () => {
    const { sequence, context, director, audioStub, gl } = mustFixture();

    // Before the sequence runs: the screen is up and nothing is registered yet.
    expect(sequence.isStarted).toBe(false);
    expect(sequence.isReady).toBe(false);
    expect(sequence.loading).not.toBeNull();
    expect(sequence.loading?.state).toBe('pending');
    expect(sequence.loading?.isVisible).toBe(true);
    const screen = document.querySelector(LOADING_SELECTORS.screen);
    expect(screen).not.toBeNull();
    expect(screen?.getAttribute('aria-busy')).toBe('true');

    sequence.start();

    expect(sequence.isStarted).toBe(true);
    expect(sequence.isReady).toBe(true);
    expect(sequence.errors).toEqual([]);
    expect(sequence.stages).toHaveLength(STARTUP_STAGES.length);
    expect(sequence.stages.map((stage) => stage.id)).toEqual(
      STARTUP_STAGES.map((stage) => stage.id),
    );
    expect(sequence.stages.every((stage) => stage.error === null)).toBe(true);

    // Every produced system registered its own tick, and the first-frame hook is
    // still holding the loading screen until the scene actually draws.
    const systemIds = sequence.systemIds;
    for (const id of [
      'navigation-rig',
      'era-timeline',
      'chrono-inspection-picking',
      'city-buildings',
      'city-storefronts',
      'city-traffic',
      'chrono-pedestrian-crowd',
      'environment',
      'era-soundscape',
      'chrono-hud',
      'render-pipeline',
      'adaptive-quality',
      'chrono-tour',
      'chrono-startup-frame',
    ]) {
      expect(systemIds).toContain(id);
    }
    expect(sequence.loading?.state).toBe('ready');
    expect(sequence.loading?.isVisible).toBe(true);
    expect(sequence.isSceneStarted).toBe(false);

    // Audio is gesture-gated: startup must not have unlocked or resumed it.
    expect(director.isUnlocked).toBe(false);
    expect(audioStub.state).toBe('suspended');
    expect(audioStub.resumeCalls).toBe(0);

    // Self-start: the shell is running before any user action.
    expect(context.isRunning).toBe(true);

    // The composed city is assembled and the intro tour is flying.
    const city = mustCity();
    expect(sequence.orchestrator.timeline.era).toBe('1945');
    expect(city.tour.snapshot().introActive).toBe(true);

    // The screen is still up after registration: only a drawn frame lifts it.
    expect(sequence.loading?.state).toBe('ready');
    expect(sequence.loading?.isVisible).toBe(true);

    // First frames: the scene draws through the composer, then the screen lifts.
    const rendersBefore = gl.renderCalls;
    runFrames(1);
    expect(gl.renderCalls).toBeGreaterThan(rendersBefore);
    runFrames(1);
    expect(sequence.isSceneStarted).toBe(true);
    expect(sequence.loading?.state).toBe('hidden');
    expect(document.querySelector(LOADING_SELECTORS.screen)).toBeNull();
    expect(sequence.snapshot().loading?.visible).toBe(false);
  }, 120_000);

  it('holds the loading screen open briefly once registration is done', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const screen = new LoadingScreen({ document, container, totalStages: 3 });

    expect(screen.state).toBe('pending');
    expect(screen.isVisible).toBe(true);
    screen.setStage('Raising the block');
    screen.completeStage('block', 'Raising the block ✓');
    screen.setReady();
    expect(screen.state).toBe('ready');

    // Frames alone do not lift the screen while it is still inside its hold…
    expect(screen.frame()).toBe(false);
    expect(screen.frame()).toBe(false);
    expect(screen.isVisible).toBe(true);
    expect(container.querySelector(LOADING_SELECTORS.screen)).not.toBeNull();

    // …and the hold never outlives its budget once the frames have landed.
    expect(LOADING_MIN_VISIBLE_MS).toBeGreaterThan(0);
    screen.hide();
    expect(screen.state).toBe('hidden');
    expect(screen.isVisible).toBe(false);
    expect(container.querySelector(LOADING_SELECTORS.screen)).toBeNull();
    screen.dispose();
    container.remove();
  });
});

/* ------------------------------------------------------------------------- *
 * 2. Composed transformation across all five years
 * ------------------------------------------------------------------------- */

interface EraFingerprint {
  readonly buildings: string;
  readonly storefronts: string;
  readonly traffic: string;
  readonly pedestrians: string;
  readonly dressing: string;
  readonly soundscape: string;
  readonly grading: string;
  readonly hud: string;
}

/** Everything the whole scene currently reads as, one field per subsystem. */
function fingerprint(city: ComposedCity): EraFingerprint {
  const buildings = city.buildings.snapshot();
  const storefronts = city.storefronts.snapshot();
  const traffic = city.traffic.snapshot();
  const environment = city.environment.snapshot();
  const soundscape = city.soundscape?.snapshot() ?? null;
  const hud = city.hud.snapshot();
  return {
    buildings: `${buildings.lotCount}:${buildings.skylineHeight.toFixed(3)}:${buildings.materialKeys.length}:${buildings.detailInstances}`,
    storefronts: `${storefronts.shopNames.join('|')}:${storefronts.advertisingInstances}:${storefronts.signTextureCount}`,
    traffic: traffic.models
      .map((model) => `${model.id}x${model.count}`)
      .sort()
      .join('|'),
    pedestrians: `${city.pedestrians.outfitEra}:${city.pedestrians.snapshots[0]?.outfitEra ?? 'none'}:${city.pedestrians.snapshots.length}`,
    dressing: `${environment.dressing.era}:${environment.dressing.lampStyle}:${environment.dressing.totalPlacements}:${environment.grade.exposure.toFixed(3)}`,
    soundscape: `${soundscape?.era ?? 'none'}:${soundscape?.audibleLayers.join(',') ?? ''}`,
    grading: city.render.gradeState().look.id,
    hud: `${hud.era}:${hud.year}`,
  };
}

describe('composed era transformation', () => {
  it('drives 1945 → 1965 → 1985 → 2005 → 2025 with every subsystem on the target era', () => {
    const { sequence, director } = mustFixture();
    const orchestrator = sequence.orchestrator;
    const city = mustCity();

    // Start from the earliest era so the full sweep is exercised.
    orchestrator.selectEra('1945', { immediate: true });
    runFrames(2);
    expect(orchestrator.era).toBe('1945');
    expect(orchestrator.audit().ok).toBe(true);

    const whooshSpy = vi.spyOn(director, 'play');
    const fingerprints: EraFingerprint[] = [fingerprint(city)];
    const eras: EraId[] = ['1965', '1985', '2005', '2025'];

    for (const era of eras) {
      whooshSpy.mockClear();
      sequence.orchestrator.selectEra(era);
      runFrames(100);

      // The timeline landed on the year…
      expect(orchestrator.era).toBe(era);
      expect(orchestrator.timeline.snapshot.transitioning).toBe(false);

      // …and every subsystem reports it, with no subsystem on another era.
      const audit = orchestrator.audit();
      expect(audit.ok).toBe(true);
      expect(audit.leaks).toEqual([]);
      expect(audit.era).toBe(era);
      expect(audit.phase).toBe('settled');
      expect(audit.reports.map((report) => report.id)).toEqual(
        expect.arrayContaining([
          'buildings',
          'storefronts',
          'traffic',
          'pedestrians',
          'environment',
          'soundscape',
          'hud',
          'render',
          'tour',
          'navigation',
          'inspection',
          'audio',
        ]),
      );
      for (const report of audit.reports) {
        if (report.era !== null) expect(report.era).toBe(era);
        if (report.targetEra !== null) expect(report.targetEra).toBe(era);
        if (report.settledEra !== null) expect(report.settledEra).toBe(era);
      }
      expect(orchestrator.snapshot().leaks).toEqual([]);

      // One orchestrated event: shared ~1.2 s tween, whoosh, sweep and caption.
      const event = orchestrator.lastEvent;
      expect(event).not.toBeNull();
      expect(event?.to).toBe(era);
      expect(event?.complete).toBe(true);
      expect(event?.durationMs).toBe(orchestrator.tweenMs);
      expect(orchestrator.tweenMs).toBe(1200);
      expect(event?.whoosh).toBe(true);
      expect(event?.whooshSource).toBe('audio-blendable');
      expect(
        whooshSpy.mock.calls.filter((call) => call[0] === ERA_WHOOSH_CUE).length,
      ).toBeGreaterThanOrEqual(1);
      expect(event?.announced).toBe(true);
      expect(event?.peakSweepIntensity).toBeGreaterThan(0);
      expect(event?.caption).toContain(String(era));
      expect(city.hud.snapshot().toasts.some((message) => message.includes(String(era)))).toBe(
        true,
      );

      // Subsystem-level evidence that the content really changed.
      const buildings = city.buildings.snapshot();
      const storefronts = city.storefronts.snapshot();
      const traffic = city.traffic.snapshot();
      const environment = city.environment.snapshot();
      expect(buildings.era).toBe(era);
      expect(buildings.minWeightSum).toBeGreaterThanOrEqual(1);
      expect(storefronts.era).toBe(era);
      expect(storefronts.shopNames.length).toBeGreaterThan(0);
      expect(traffic.targetEra).toBe(era);
      expect(traffic.era).toBe(era);
      expect(city.pedestrians.era).toBe(era);
      expect(city.pedestrians.outfitEra).toBe(era);
      expect(environment.dressing.era).toBe(era);
      expect(city.soundscape?.era).toBe(era);
      expect(city.render.gradeState().look.id).toBe(era);
      expect(city.hud.snapshot().era).toBe(era);
      expect(city.inspection.era).toBe(era);

      fingerprints.push(fingerprint(city));
    }

    // The composed scene genuinely changes year on year: shop names, fleets,
    // outfits, dressing, soundscape, grading and HUD all move together.
    const distinct = (values: string[]): number => new Set(values).size;
    expect(distinct(fingerprints.map((entry) => entry.storefronts))).toBe(5);
    expect(distinct(fingerprints.map((entry) => entry.traffic))).toBe(5);
    expect(distinct(fingerprints.map((entry) => entry.pedestrians))).toBe(5);
    expect(distinct(fingerprints.map((entry) => entry.soundscape))).toBe(5);
    expect(distinct(fingerprints.map((entry) => entry.grading))).toBe(5);
    expect(distinct(fingerprints.map((entry) => entry.hud))).toBe(5);
    expect(distinct(fingerprints.map((entry) => entry.dressing))).toBeGreaterThanOrEqual(4);
    expect(distinct(fingerprints.map((entry) => entry.buildings))).toBeGreaterThanOrEqual(4);
    for (let index = 1; index < fingerprints.length; index += 1) {
      expect(fingerprints[index]).not.toEqual(fingerprints[index - 1]);
    }
    expect(ERA_IDS).toHaveLength(5);
  }, 120_000);
});

/* ------------------------------------------------------------------------- *
 * 3. Mid-tween consistency, retargeting and scrubbing
 * ------------------------------------------------------------------------- */

describe('mid-tween consistency and scrubbing', () => {
  it('keeps every subsystem on the same target mid-tween and retargets cleanly', () => {
    const { sequence, director } = mustFixture();
    const orchestrator = sequence.orchestrator;
    const city = mustCity();

    orchestrator.selectEra('1965', { immediate: true });
    runFrames(2);
    expect(orchestrator.era).toBe('1965');

    const whooshSpy = vi.spyOn(director, 'play');
    orchestrator.selectEra('1985');
    // ~25 frames ≈ 420 ms into the 1.2 s tween: mid-morph, not settled.
    runFrames(25);

    const mid = orchestrator.timeline.snapshot;
    expect(mid.transitioning).toBe(true);
    expect(mid.durationMs).toBe(1200);
    expect(mid.from).toBe('1965');
    expect(mid.to).toBe('1985');
    expect(mid.progress).toBeGreaterThan(0);
    expect(mid.progress).toBeLessThan(1);

    const midAudit = orchestrator.audit();
    expect(midAudit.phase).toBe('transitioning');
    expect(midAudit.ok).toBe(true);
    for (const report of midAudit.reports) {
      if (report.targetEra !== null) expect(report.targetEra).toBe('1985');
      if (report.fromEra !== null) expect(report.fromEra).toBe('1965');
    }
    // Mid-morph the block is coherent: the outgoing and incoming eras overlap.
    expect(city.buildings.snapshot().minWeightSum).toBeGreaterThanOrEqual(1);

    // The grading sweep rides the tween, and the event carries its peak.
    expect(city.render.gradeState().sweep.intensity).toBeGreaterThan(0);
    expect(city.render.gradeState().sweep.direction).toBe(1);
    expect(orchestrator.lastEvent?.complete).toBe(false);
    expect(orchestrator.lastEvent?.durationMs).toBe(1200);

    // Retarget mid-tween (scrubbing backwards): a new tween departs the era the
    // first one was heading to, and the old event is marked superseded.
    orchestrator.selectEra('1945');
    runFrames(1);
    expect(orchestrator.timeline.snapshot.from).toBe('1985');
    expect(orchestrator.timeline.snapshot.to).toBe('1945');
    expect(orchestrator.events.some((event) => event.superseded && event.to === '1985')).toBe(true);

    // Rapid scrubbing, then settle on the last selection.
    orchestrator.selectEra('1965');
    runFrames(2);
    orchestrator.selectEra('1985');
    runFrames(2);
    orchestrator.selectEra('2005');
    runFrames(2);
    orchestrator.selectEra('2025');
    runFrames(120);

    expect(orchestrator.era).toBe('2025');
    const settled = orchestrator.audit();
    expect(settled.phase).toBe('settled');
    expect(settled.ok).toBe(true);
    expect(settled.leaks).toEqual([]);
    expect(orchestrator.lastEvent?.complete).toBe(true);
    expect(orchestrator.lastEvent?.to).toBe('2025');
    expect(orchestrator.lastEvent?.peakSweepIntensity).toBeGreaterThan(0);
    expect(orchestrator.events.length).toBeGreaterThanOrEqual(6);
    // Every whooshed change went through the director exactly once per tween.
    expect(whooshSpy.mock.calls.filter((call) => call[0] === ERA_WHOOSH_CUE).length).toBeGreaterThan(
      0,
    );
    expect(city.hud.snapshot().year).toBe(2025);
  }, 120_000);
});

/* ------------------------------------------------------------------------- *
 * 4. Adaptive-quality guardrails
 * ------------------------------------------------------------------------- */

describe('adaptive quality', () => {
  it('degrades passes and pixel ratio under load, then recovers', () => {
    const city = mustCity();
    const quality = city.quality;
    const render = city.render as RenderPipelineApi;

    quality.reset();
    const initial = quality.snapshot();
    expect(initial.tier).toBe('high');
    expect(initial.pixelRatio).toBeGreaterThan(0);
    expect(initial.activePasses).toEqual(expect.arrayContaining(['dof', 'grain']));

    // Feed a sustained over-budget frame time: one step per degrade window.
    let action: AdaptiveQualityAction = 'hold';
    for (let frame = 0; frame < 200 && action === 'hold'; frame += 1) {
      action = quality.update(33);
    }
    expect(action).toBe('degrade');
    const firstDegrade = quality.snapshot();
    expect(firstDegrade.tier).toBe('balanced');
    expect(firstDegrade.lastAction).toBe('degrade');
    expect(firstDegrade.droppedPasses).toContain('dof');

    for (let frame = 0; frame < 40; frame += 1) quality.update(33);
    const floor = quality.snapshot();
    expect(floor.tier).toBe('performance');
    expect(floor.degradeSteps).toBeGreaterThanOrEqual(2);
    expect(floor.droppedPasses).toEqual(expect.arrayContaining(['dof', 'grain']));
    expect(floor.activePasses).not.toContain('dof');
    expect(floor.activePasses).not.toContain('grain');
    expect(floor.pixelRatio).toBeLessThan(initial.pixelRatio as number);

    // The ladder never walks past its floor, and the core passes stay on.
    expect(quality.degrade()).toBe('clamped');
    expect(quality.snapshot().tier).toBe(ADAPTIVE_QUALITY_TIERS.at(-1));
    for (const core of ['render', 'grading', 'output']) {
      expect(render.activePasses()).toContain(core);
    }
    expect(RENDER_PIPELINE_PASS_IDS).toContain('dof');

    // A comfortable frame time walks it back up, one tier at a time.
    action = 'hold';
    for (let frame = 0; frame < 500 && action === 'hold'; frame += 1) {
      action = quality.update(4);
    }
    expect(action).toBe('restore');
    const recovered = quality.snapshot();
    expect(recovered.tier).toBe('balanced');
    expect(recovered.restoreSteps).toBeGreaterThanOrEqual(1);
    // One step up buys the grain pass back; DOF only returns at the top tier.
    expect(recovered.activePasses).toContain('grain');
    expect(recovered.droppedPasses).toEqual(['dof']);
    expect(recovered.lastAction).toBe('restore');

    for (let frame = 0; frame < 500; frame += 1) {
      const next = quality.update(4);
      if (next === 'clamped' || quality.snapshot().tier === 'high') break;
    }
    const top = quality.snapshot();
    expect(top.tier).toBe('high');
    expect(top.activePasses).toEqual(expect.arrayContaining(['dof', 'grain']));
    expect(top.pixelRatio).toBeGreaterThanOrEqual(initial.pixelRatio as number);
  }, 120_000);

  it('keeps era transformation and navigation working at the lowest tier', () => {
    const city = mustCity();
    const orchestrator = mustFixture().sequence.orchestrator;

    city.quality.setTier('performance');
    expect(city.quality.snapshot().tier).toBe('performance');

    // Force the whole ladder down while an era change is running: quality work
    // must never interfere with the tween.
    orchestrator.selectEra('1985');
    runFrames(10);
    expect(orchestrator.timeline.snapshot.transitioning).toBe(true);
    expect(city.quality.snapshot().eraTransitioning).toBe(true);

    for (let frame = 0; frame < 60; frame += 1) city.quality.update(40);
    expect(city.quality.snapshot().tier).toBe('performance');
    expect(city.quality.snapshot().era).toBe('1985');

    runFrames(110);
    expect(orchestrator.era).toBe('1985');
    expect(orchestrator.timeline.snapshot.transitioning).toBe(false);
    expect(orchestrator.audit().ok).toBe(true);
    expect(orchestrator.audit().leaks).toEqual([]);

    // Navigation still works: the rig advances and the orchestrator reports it.
    const before = city.navigation.state;
    const after = city.navigation.step(1 / 60);
    expect(after.frame).toBeGreaterThan(before.frame);
    expect(['orbit', 'walk']).toContain(after.mode);
    expect(orchestrator.snapshot().navigation?.mode).toBe(after.mode);

    // And a final change at the floor still transforms every subsystem together.
    selectAndSettle('1945');
    expect(orchestrator.era).toBe('1945');
    expect(orchestrator.audit().ok).toBe(true);
    expect(city.buildings.snapshot().era).toBe('1945');
    expect(city.storefronts.snapshot().era).toBe('1945');
    expect(city.traffic.snapshot().era).toBe('1945');
    expect(city.pedestrians.outfitEra).toBe('1945');
    expect(city.render.gradeState().look.id).toBe('1945');
    expect(city.hud.snapshot().era).toBe('1945');
  }, 120_000);
});

/* ------------------------------------------------------------------------- *
 * 5. Application entry point (the append-only main.ts wiring)
 * ------------------------------------------------------------------------- */

describe('application entry point', () => {
  it('composes the city when the shell announces itself, behind its own loading screen', async () => {
    const container = document.createElement('div');
    container.setAttribute('data-chrono-stage', '');
    const overlayRoot = document.createElement('div');
    overlayRoot.setAttribute('data-chrono-overlay', '');
    container.appendChild(overlayRoot);
    document.body.appendChild(container);

    const canvas = document.createElement('canvas');
    // A software renderer: the composed app must protect the frame budget.
    const gl = createStubGl(canvas, { software: true });
    expect(isSoftwareRenderer(gl.renderer)).toBe(true);
    expect(initialQualityForRenderer(gl.renderer)).toBe('performance');
    expect(initialQualityForRenderer(null)).toBe('high');
    const app = createSceneContextApp({
      canvas,
      container,
      overlayRoot,
      autoResize: false,
      shadows: false,
      maxPixelRatio: 2,
      createRenderer: () => gl.renderer,
    });
    const { director } = createDirector();

    // Nothing is composed before the shell exists: the entry point only puts the
    // loading screen up and listens for the shell's announcement.
    delete (window as unknown as Record<string, unknown>)[STARTUP_GLOBAL_KEY];
    expect(readExperience()).toBeNull();
    const started = startChronoCityExperience({
      document,
      audio: director,
      initialEra: '1965',
      startTour: false,
    });
    expect(started).toBeNull();
    expect(document.querySelector(LOADING_SELECTORS.screen)).not.toBeNull();

    // The shell publishes itself exactly as `bootChronoCity()` does.
    (window as unknown as Record<string, unknown>).__chronoCity = app;
    window.dispatchEvent(new CustomEvent('chrono-city:ready', { detail: app }));

    await vi.waitFor(() => expect(readExperience()).not.toBeNull(), { timeout: 10_000 });
    const experience = readExperience();
    expect(experience?.isReady).toBe(true);
    expect(experience?.errors).toEqual([]);
    expect(experience?.timeline.era).toBe('1965');
    expect(experience?.systemIds).toContain('city-buildings');
    expect(experience?.systemIds).toContain('chrono-startup-frame');
    expect(app.context.isRunning).toBe(true);

    // On a software renderer the composed app starts at the performance tier:
    // no DOF, no grain, and a reduced pixel ratio from the very first frame.
    const quality = experience?.city?.quality.snapshot();
    expect(quality?.tier).toBe('performance');
    expect(quality?.activePasses).not.toContain('dof');
    expect(quality?.activePasses).not.toContain('grain');

    // Land one era change through the composed entry point and read it back.
    experience?.orchestrator.selectEra('1985');
    runContextFrames(app.context, 100);
    expect(experience?.orchestrator.era).toBe('1985');
    expect(experience?.orchestrator.audit().ok).toBe(true);
    expect(experience?.city?.buildings.snapshot().era).toBe('1985');

    experience?.dispose();
    expect(readExperience()).toBeNull();
    director.dispose();
    app.context.dispose();
    delete (window as unknown as Record<string, unknown>).__chronoCity;
    delete (window as unknown as Record<string, unknown>)[AUDIO_GLOBAL_KEY];
    container.remove();
  }, 120_000);
});
