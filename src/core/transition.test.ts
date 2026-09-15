/**
 * Period transition suite — the choreography, headless.
 *
 * The unit half drives the engine against deterministic stub modules, a real
 * headless `SceneKernel` host and fixture era definitions, and proves the
 * behaviour the acceptance criteria describe: stagger ordering from the camera
 * distance, the scale/opacity blend around the geometry swap, the lighting
 * colour/intensity ramp, signage flicker, interrupt/re-target, the
 * reduced-motion fast path, reproducible timing for a fixed step schedule, the
 * arrival caption, the camera micro-move, the gesture gate and full cleanup.
 *
 * The composition half composes the *real* participants: the period registry,
 * the ten domain modules it instantiates, a real `AudioEngine` driven through
 * its headless audio-context fake, and the real music programme tables. It
 * drives a full 1945 -> 2025 switch and asserts every module reports the target
 * year, the music programme crossfaded to the 2025 programme, the caption
 * arrived, materials/camera were restored and nothing was left in the graph.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_YEAR_ID,
  YEAR_IDS,
  type BuildContext,
  type DomainSpecBase,
  type Hotspot,
  type PeriodDefinition,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../contracts/period';
import { createKernel, createManualFrameScheduler, type Kernel } from './kernel';
import {
  PERIOD_TRANSITION_ID,
  createMusicEraAudioProvider,
  createPeriodTransition,
  isPeriodTransition,
  type PeriodTransition,
  type TransitionAudioTarget,
  type TransitionSignal,
} from './transition';
import {
  createAudioEngine,
  isCafeAudioEngine,
  type AudioEngineState,
  type AudioMixState,
  type AudioTransitionPlan,
  type AudioYearProvider,
  type EraMixInput,
  type MachineTriggerRecord,
  type MusicProgramInput,
} from '../audio';
import { eraMusicMix, musicProgram } from '../domains/music/MusicSourceModule';
import { createFakeAudioContextFactory } from '../../tests/audio/fakeAudioContext';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** Fixture era with intensities and palette luminance that really differ. */
function fixturePeriod(year: YearId): PeriodDefinition {
  const index = YEAR_IDS.indexOf(year);
  const wall = `#${(0x330000 + index * 0x220000).toString(16).padStart(6, '0')}`;
  return Object.freeze({
    year,
    label: year,
    name: `Fixture era ${year}`,
    summary: `Fixture note for the ${year} cafe.`,
    palette: {
      background: '#101010',
      floor: '#2b2b2b',
      wall,
      ceiling: '#cccccc',
      accent: '#cc8844',
      lamp: '#ffd9a3',
    },
    lighting: {
      ambientColor: '#ffffff',
      ambientIntensity: 0.4 + index * 0.05,
      keyColor: '#fff4e0',
      keyIntensity: 1.1 + index * 0.15,
      fillColor: '#a8c4ff',
      fillIntensity: 0.3,
      lampColor: '#ffcc88',
      lampIntensity: 10 + index * 4,
      fogDensity: 0,
    },
    details: Object.freeze([`era-${year}`]),
  });
}

const FIXTURE_PERIODS: Readonly<Record<YearId, PeriodDefinition>> = Object.freeze(
  Object.fromEntries(YEAR_IDS.map((year) => [year, fixturePeriod(year)])) as Record<
    YearId,
    PeriodDefinition
  >,
);

function fixtureLookup(year: YearId): PeriodDefinition {
  const period = FIXTURE_PERIODS[year];
  if (period === undefined) throw new RangeError(`No fixture era for ${String(year)}`);
  return period;
}

/* -------------------------------------------------------------------------- */
/* Stub module                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Minimal `SceneModule` with the surfaces the choreography touches: a root
 * group with an opaque surface, a lit "sign" surface and a punctual light.
 */
class StubModule implements SceneModule<DomainSpecBase> {
  readonly id: string;
  readonly group = new THREE.Group();
  readonly surface: THREE.MeshStandardMaterial;
  readonly sign: THREE.MeshStandardMaterial;
  readonly lamp = new THREE.PointLight(0xffffff, 3, 12);
  /** Era the module currently reports. */
  yearValue: YearId;
  /** Eras `applyPeriod` was asked for, in order. */
  readonly applied: YearId[] = [];
  builds = 0;
  private readonly position: THREE.Vector3;

  constructor(id: string, year: YearId, position: THREE.Vector3) {
    this.id = id;
    this.yearValue = year;
    this.position = position;
    this.group.name = id;

    this.surface = new THREE.MeshStandardMaterial({ color: 0xb0a090, opacity: 1 });
    const surfaceMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), this.surface);
    surfaceMesh.name = `${id}-surface`;
    this.group.add(surfaceMesh);

    this.sign = new THREE.MeshStandardMaterial({
      color: 0x101010,
      emissive: new THREE.Color('#ffd9a3'),
      emissiveIntensity: 0.9,
    });
    this.sign.userData = { signage: { role: 'sign-face' } };
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), this.sign);
    signMesh.name = `${id}-sign`;
    this.group.add(signMesh);

    this.group.add(this.lamp);
  }

  get spec(): DomainSpecBase {
    return { year: this.yearValue, label: this.id };
  }

  get year(): YearId {
    return this.yearValue;
  }

  get root(): THREE.Object3D {
    return this.group;
  }

  build(context: BuildContext): void {
    this.builds += 1;
    this.group.position.copy(this.position);
    context.root.add(this.group);
  }

  applyPeriod(period: PeriodDefinition, _context: BuildContext): void {
    this.yearValue = period.year;
    this.applied.push(period.year);
  }

  update(_deltaSeconds: number, _context: UpdateContext): void {
    // The stubs are static; the choreography owns the motion.
  }

  dispose(): void {
    this.group.removeFromParent();
  }

  getHotspots(): readonly Hotspot[] {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];
const openEngines: PeriodTransition[] = [];
const openAudio: { dispose(): void }[] = [];

afterEach(() => {
  for (const engine of openEngines.splice(0)) {
    if (!engine.isDisposed) engine.dispose();
  }
  for (const audio of openAudio.splice(0)) audio.dispose();
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
});

function headlessKernel(): Kernel {
  const kernel = createKernel(null, {
    forceHeadless: true,
    autoResize: false,
    resizeTarget: null,
    scheduler: createManualFrameScheduler(),
    seed: 0x1945,
  });
  openKernels.push(kernel);
  return kernel;
}

/** Three stubs at increasing distance from the kernel's default interior view. */
function buildStubs(kernel: Kernel, year: YearId = '1945'): StubModule[] {
  const period = fixtureLookup(year);
  const stubs = [
    new StubModule('near', year, new THREE.Vector3(0, 0.5, 3.6)),
    new StubModule('middle', year, new THREE.Vector3(0, 0.5, 0.2)),
    new StubModule('far', year, new THREE.Vector3(0, 0.5, -4.6)),
  ];
  for (const stub of stubs) stub.build(kernel.createBuildContext(period));
  return stubs;
}

interface HarnessOverrides {
  readonly audio?: TransitionAudioTarget;
  readonly audioProvider?: AudioYearProvider;
  readonly resolvePeriod?: (year: YearId) => PeriodDefinition;
  readonly initialYear?: YearId;
  readonly reducedMotion?: boolean | 'auto';
  readonly services?: Readonly<Record<string, unknown>>;
}

function harness(
  kernel: Kernel,
  modules: readonly SceneModule[],
  overrides: HarnessOverrides = {},
): PeriodTransition {
  const engine = createPeriodTransition({
    modules,
    host: kernel,
    resolvePeriod: overrides.resolvePeriod ?? fixtureLookup,
    initialYear: overrides.initialYear ?? '1945',
    ...(overrides.audio === undefined ? {} : { audio: overrides.audio }),
    ...(overrides.audioProvider === undefined ? {} : { audioProvider: overrides.audioProvider }),
    ...(overrides.reducedMotion === undefined ? {} : { reducedMotion: overrides.reducedMotion }),
    ...(overrides.services === undefined ? {} : { services: overrides.services }),
  });
  openEngines.push(engine);
  return engine;
}

const STEP = 1 / 60;

/** Steps the engine until `done` (or the budget) and returns the steps taken. */
function stepUntil(
  engine: PeriodTransition,
  done: () => boolean,
  budget = 400,
  delta = STEP,
): number {
  let steps = 0;
  while (!done() && steps < budget) {
    engine.update(delta);
    steps += 1;
  }
  return steps;
}

/** Every material reachable from the given roots, in traversal order. */
function collectMaterials(roots: readonly (THREE.Object3D | undefined)[]): THREE.Material[] {
  const materials = new Set<THREE.Material>();
  for (const root of roots) {
    root?.traverse((object) => {
      const material = (object as { material?: THREE.Material | THREE.Material[] }).material;
      if (material === undefined) return;
      if (Array.isArray(material)) for (const entry of material) materials.add(entry);
      else materials.add(material);
    });
  }
  return [...materials];
}

interface MaterialSnapshot {
  readonly opacity: number;
  readonly transparent: boolean;
  readonly emissiveIntensity: number | null;
}

function snapshotMaterials(
  roots: readonly (THREE.Object3D | undefined)[],
): Map<THREE.Material, MaterialSnapshot> {
  const snapshot = new Map<THREE.Material, MaterialSnapshot>();
  for (const material of collectMaterials(roots)) {
    const emissiveIntensity = (material as { emissiveIntensity?: number }).emissiveIntensity;
    snapshot.set(material, {
      opacity: material.opacity,
      transparent: material.transparent,
      emissiveIntensity: typeof emissiveIntensity === 'number' ? emissiveIntensity : null,
    });
  }
  return snapshot;
}

function expectMaterialsRestored(
  roots: readonly (THREE.Object3D | undefined)[],
  snapshot: Map<THREE.Material, MaterialSnapshot>,
): void {
  for (const material of collectMaterials(roots)) {
    const before = snapshot.get(material);
    if (before === undefined) continue;
    expect(material.opacity, 'material opacity restored').toBeCloseTo(before.opacity, 10);
    expect(material.transparent, 'material transparency restored').toBe(before.transparent);
    if (before.emissiveIntensity !== null) {
      const current = (material as { emissiveIntensity?: number }).emissiveIntensity;
      expect(current, 'emissive intensity restored').toBeCloseTo(before.emissiveIntensity, 10);
    }
  }
}

/** Comparable signature of the state a finished switch leaves behind. */
function endState(
  kernel: Kernel,
  stubs: readonly StubModule[],
  transition: PeriodTransition,
): string {
  return JSON.stringify({
    years: stubs.map((stub) => stub.yearValue),
    opacity: stubs.flatMap((stub) => [stub.surface.opacity, stub.sign.opacity]),
    transparent: stubs.flatMap((stub) => [stub.surface.transparent, stub.sign.transparent]),
    emissive: stubs.map((stub) => stub.sign.emissiveIntensity),
    scale: stubs.map((stub) => [stub.group.scale.x, stub.group.scale.y, stub.group.scale.z]),
    camera: [kernel.camera.position.x, kernel.camera.position.y, kernel.camera.position.z],
    caption: transition.caption,
    reported: transition.modules.map((view) => view.reportedYear),
  });
}

/* -------------------------------------------------------------------------- */
/* Unit: timeline, ordering, blend                                            */
/* -------------------------------------------------------------------------- */

describe('period transition choreography', () => {
  it('exposes the published identity and is recognised by its guard', () => {
    const kernel = headlessKernel();
    const engine = harness(kernel, buildStubs(kernel));

    expect(engine.id).toBe(PERIOD_TRANSITION_ID);
    expect(isPeriodTransition(engine)).toBe(true);
    expect(isPeriodTransition({ id: 'nope' })).toBe(false);
    expect(engine.status).toBe('settled');
    expect(engine.settledYear).toBe(DEFAULT_YEAR_ID);
    expect(engine.progress).toBe(1);
    expect(engine.targetYear).toBeNull();
  });

  it('orders module swaps by distance from the active camera and staggers them', () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const engine = harness(kernel, stubs);

    void engine.requestYear('2025');
    const views = engine.modules;

    // Nearest first, and the distance comes from the live camera.
    expect(views.map((view) => view.id)).toEqual(['near', 'middle', 'far']);
    expect(views.map((view) => view.order)).toEqual([0, 1, 2]);
    expect(views[0]!.distance).toBeLessThan(views[1]!.distance);
    expect(views[1]!.distance).toBeLessThan(views[2]!.distance);

    // Staggered, all inside the timeline and strictly increasing.
    const times = views.map((view) => view.swapAtSeconds);
    expect(times[0]!).toBeGreaterThan(0);
    expect(times[1]!).toBeGreaterThan(times[0]!);
    expect(times[2]!).toBeGreaterThan(times[1]!);
    expect(views.every((view) => view.toYear === '2025' && view.needsSwap)).toBe(true);

    // The nearest prop changes first, while the far one is still on the old era.
    stepUntil(engine, () => engine.modules[0]!.applied, 400);
    expect(engine.modules[0]!.applied).toBe(true);
    expect(engine.modules[1]!.applied).toBe(false);
    expect(engine.modules[2]!.applied).toBe(false);
    expect(stubs[0]!.yearValue).toBe('2025');
    expect(stubs[2]!.yearValue).toBe('1945');
  });

  it('blends geometry scale and material opacity out and back around the era swap', () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const engine = harness(kernel, stubs);
    const nearest = stubs[0]!;
    const startScale = nearest.group.scale.clone();

    void engine.requestYear('2025');
    const swapAt = engine.modules[0]!.swapAtSeconds;
    const window = engine.modules[0]!.windowSeconds;

    // Quarter of the way through the nearest module's window: blended out but
    // not yet swapped.
    stepUntil(engine, () => engine.getSnapshot().elapsedSeconds >= swapAt + window * 0.25);
    expect(nearest.group.scale.x).toBeLessThan(startScale.x);
    expect(nearest.surface.transparent).toBe(true);
    expect(nearest.surface.opacity).toBeLessThan(1);
    expect(nearest.surface.opacity).toBeGreaterThan(0.1);
    expect(nearest.yearValue).toBe('1945');

    // Past the trough the geometry swap has happened.
    stepUntil(engine, () => engine.getSnapshot().elapsedSeconds >= swapAt + window * 0.6);
    expect(nearest.yearValue).toBe('2025');
    expect(nearest.applied).toEqual(['2025']);

    // On completion the blend is fully restored.
    stepUntil(engine, () => !engine.isTransitioning);
    expect(nearest.group.scale.x).toBeCloseTo(startScale.x, 10);
    expect(nearest.surface.transparent).toBe(false);
    expect(nearest.surface.opacity).toBeCloseTo(1, 10);
  });

  it('ramps lighting colour temperature and intensity and settles on the target recipe', () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const engine = harness(kernel, stubs);
    const lamp = stubs[0]!.lamp;

    const sourceIntensity = lamp.intensity;
    const sourceColor = lamp.color.clone();
    const targetColor = new THREE.Color(fixtureLookup('2025').lighting.lampColor);

    void engine.requestYear('2025');
    const duration = engine.getSnapshot().durationSeconds;
    const lightingStart = duration * 0.18;
    const lightingEnd = duration * 0.78;

    // Sample the light across the whole ramp: the intensity must climb
    // monotonically from the source era's value towards the target's recipe.
    stepUntil(engine, () => engine.getSnapshot().elapsedSeconds >= lightingStart);
    const intensities: number[] = [];
    const colors = new Set<string>();
    while (engine.isTransitioning && engine.getSnapshot().elapsedSeconds < lightingEnd - STEP) {
      engine.update(STEP);
      intensities.push(lamp.intensity);
      colors.add(lamp.color.getHexString());
    }

    const lightView = engine.getSnapshot().lights[0]!;
    expect(lightView.kind).toBe('PointLight');
    expect(lightView.sourceIntensity).toBeCloseTo(sourceIntensity, 10);
    expect(lightView.targetIntensity).toBeGreaterThan(sourceIntensity);
    expect(intensities.length).toBeGreaterThan(10);
    for (let index = 1; index < intensities.length; index += 1) {
      expect(intensities[index]!, 'intensity ramps monotonically').toBeGreaterThanOrEqual(
        intensities[index - 1]! - 1e-9,
      );
    }
    const first = intensities[0]!;
    const last = intensities[intensities.length - 1]!;
    expect(first).toBeGreaterThanOrEqual(sourceIntensity);
    expect(last).toBeGreaterThan(first);
    expect(last).toBeLessThan(lightView.targetIntensity);

    // Colour temperature moves through intermediate values, starting at the
    // source colour and landing on the target's, in small quantised steps.
    const distinct = [...colors];
    expect(distinct.length).toBeGreaterThan(2);
    expect(distinct.length).toBeLessThan(intensities.length);
    expect(distinct[0]).toBe(sourceColor.getHexString());
    expect(distinct[distinct.length - 1]).toBe(targetColor.getHexString());

    stepUntil(engine, () => !engine.isTransitioning);
    expect(lamp.color.getHexString()).toBe(targetColor.getHexString());
    expect(lamp.intensity).toBeCloseTo(lightView.targetIntensity, 6);
  });

  it('flickers lit signage surfaces through the change and restores them exactly', () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const engine = harness(kernel, stubs);
    const sign = stubs[0]!.sign;
    const baseline = sign.emissiveIntensity;
    const seen = new Set<number>();

    void engine.requestYear('2025');
    const swapAt = engine.modules[0]!.swapAtSeconds;
    const window = engine.modules[0]!.windowSeconds;
    while (engine.isTransitioning && engine.getSnapshot().elapsedSeconds < swapAt + window) {
      engine.update(STEP);
      seen.add(Number(sign.emissiveIntensity.toFixed(6)));
    }

    // The sign flickered (more than one distinct glow) and never went dark.
    expect(seen.size).toBeGreaterThan(1);
    expect([...seen].every((value) => value > 0)).toBe(true);

    stepUntil(engine, () => !engine.isTransitioning);
    expect(sign.emissiveIntensity).toBeCloseTo(baseline, 10);
  });

  it('publishes the era caption from the target definition on arrival', () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const engine = harness(kernel, stubs);
    const captions: string[] = [];
    const completions: TransitionSignal[] = [];
    engine.onCaption((caption) => captions.push(`${caption.year}:${caption.name}`));
    engine.onComplete((signal) => completions.push(signal));

    const completion = engine.requestYear('1985');
    while (engine.isTransitioning) engine.update(STEP);
    expect(captions).toEqual(['1985:Fixture era 1985']);
    expect(engine.caption).toEqual({
      year: '1985',
      label: '1985',
      name: 'Fixture era 1985',
      note: 'Fixture note for the 1985 cafe.',
    });

    return completion.then((signal) => {
      expect(signal.outcome).toBe('arrived');
      expect(signal.settledYear).toBe('1985');
      expect(signal.requestedYear).toBe('1985');
      expect(completions).toEqual([signal]);
      expect(engine.settledYear).toBe('1985');
      expect(engine.modules.every((view) => view.reportedYear === '1985')).toBe(true);
      expect(stubs.every((stub) => stub.yearValue === '1985')).toBe(true);
    });
  });

  it('performs a camera micro-move that settles back to the prior framing', () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const engine = harness(kernel, stubs);
    const before = kernel.camera.position.clone();
    let moved = false;

    void engine.requestYear('2025');
    while (engine.isTransitioning) {
      engine.update(STEP);
      if (kernel.camera.position.distanceTo(before) > 0.001) moved = true;
    }

    expect(moved).toBe(true);
    expect(kernel.camera.position.x).toBeCloseTo(before.x, 10);
    expect(kernel.camera.position.y).toBeCloseTo(before.y, 10);
    expect(kernel.camera.position.z).toBeCloseTo(before.z, 10);
    const camera = engine.getSnapshot().camera;
    expect(camera.settled).toBe(true);
    expect(camera.offset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('interrupts mid-flight, re-targets from the current state and leaves no orphans', async () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const engine = harness(kernel, stubs);
    const worldBefore = kernel.world.children.length;
    const materialsBefore = snapshotMaterials(stubs.map((stub) => stub.group));

    const first = engine.requestYear('2025');
    // Interrupt while the near module has swapped and the others have not.
    stepUntil(engine, () => engine.getSnapshot().progress >= 0.23);
    expect(engine.isTransitioning).toBe(true);
    expect(stubs[0]!.yearValue).toBe('2025');
    expect(stubs.some((stub) => stub.yearValue === '1945')).toBe(true);

    const second = engine.requestYear('1985');
    const superseded = await first;
    expect(superseded.outcome).toBe('superseded');
    expect(superseded.supersededBy).toBe('1985');
    expect(superseded.settledYear).toBeNull();

    // The re-targeted plan starts from each module's current era.
    expect(engine.isTransitioning).toBe(true);
    expect(engine.modules.every((view) => view.needsSwap)).toBe(true);

    while (engine.isTransitioning) engine.update(STEP);
    const arrived = await second;
    expect(arrived.outcome).toBe('arrived');
    expect(arrived.settledYear).toBe('1985');

    // Every module ends in the same single era. The module that had already
    // reached 2025 travels on to 1985; the ones still on 1945 go straight there.
    expect(stubs.every((stub) => stub.yearValue === '1985')).toBe(true);
    expect(engine.modules.every((view) => view.reportedYear === '1985')).toBe(true);
    expect(stubs[0]!.applied).toEqual(['2025', '1985']);
    expect(stubs[1]!.applied).toEqual(['1985']);
    expect(stubs[2]!.applied).toEqual(['1985']);

    // No orphaned or duplicated objects, and every material restored.
    expect(kernel.world.children.length).toBe(worldBefore);
    for (const stub of stubs) {
      expect(kernel.world.children.filter((child) => child === stub.group)).toHaveLength(1);
    }
    expectMaterialsRestored(stubs.map((stub) => stub.group), materialsBefore);

    // The interrupted run leaves the same object counts as a direct 1945 -> 1985
    // switch on a fresh scene.
    const directKernel = headlessKernel();
    const directStubs = buildStubs(directKernel);
    const direct = harness(directKernel, directStubs);
    const directCompletion = direct.requestYear('1985');
    while (direct.isTransitioning) direct.update(STEP);
    await directCompletion;
    expect(directStubs.map((stub) => stub.applied)).toEqual([['1985'], ['1985'], ['1985']]);
    expect(kernel.world.children.length).toBe(directKernel.world.children.length);
  });

  it('reduced motion resolves to an immediate swap that still applies the full target state', async () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const recording = new RecordingAudio();
    const engine = harness(kernel, stubs, { audio: recording, reducedMotion: true });
    const cameraBefore = kernel.camera.position.clone();
    const materialsBefore = snapshotMaterials(stubs.map((stub) => stub.group));

    expect(engine.reducedMotion).toBe(true);
    const completion = engine.requestYear('2025');

    // Synchronous: no frame has been stepped.
    expect(engine.status).toBe('settled');
    expect(engine.isTransitioning).toBe(false);
    expect(stubs.every((stub) => stub.yearValue === '2025')).toBe(true);
    expect(engine.modules.every((view) => view.reportedYear === '2025')).toBe(true);
    expect(engine.caption?.year).toBe('2025');

    const signal = await completion;
    expect(signal.outcome).toBe('arrived');
    expect(signal.elapsedSeconds).toBe(0);

    // The full audio programme was applied instantly, with no sweep.
    expect(recording.plans).toHaveLength(1);
    expect(recording.plans[0]!.year).toBe('2025');
    expect(recording.plans[0]!.crossfadeSeconds).toBe(0);
    expect(recording.programId).toBe(musicProgram('2025').id);
    expect(recording.mixId).toBe(eraMusicMix('2025').id ?? null);
    expect(recording.tones).toHaveLength(0);

    // Nothing was blended, so nothing had to be restored, and the camera stayed put.
    expectMaterialsRestored(stubs.map((stub) => stub.group), materialsBefore);
    expect(kernel.camera.position.distanceTo(cameraBefore)).toBe(0);

    // The instant path lands on exactly the state the animated path lands on.
    const animatedKernel = headlessKernel();
    const animatedStubs = buildStubs(animatedKernel);
    const animated = harness(animatedKernel, animatedStubs);
    const animatedCompletion = animated.requestYear('2025');
    while (animated.isTransitioning) animated.update(STEP);
    await animatedCompletion;
    expect(endState(animatedKernel, animatedStubs, animated)).toEqual(
      endState(kernel, stubs, engine),
    );
  });

  it('does not start audio before the user gesture unlock, only stages descriptors', async () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    let factoryCalls = 0;
    const audio = createAudioEngine({
      contextFactory: () => {
        factoryCalls += 1;
        return null;
      },
    });
    openAudio.push(audio);
    const engine = harness(kernel, stubs, { audio, audioProvider: createMusicEraAudioProvider() });

    expect(isCafeAudioEngine(audio)).toBe(true);
    const completion = engine.requestYear('2025');
    while (engine.isTransitioning) engine.update(STEP);
    await completion;

    expect(factoryCalls).toBe(0);
    expect(audio.state).toBe('locked');
    expect(audio.getMixState().programId).toBe(musicProgram('2025').id);
    expect(audio.getMixState().mixId).toBe(eraMusicMix('2025').id ?? null);
    expect(audio.getMixState().year).toBe('2025');
    expect(engine.getSnapshot().audio.locked).toBe(true);
  });

  it('opens a machine-cue subscription only while running, and closes it on arrival', async () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const recording = new RecordingAudio();
    const engine = harness(kernel, stubs, { audio: recording });

    const completion = engine.requestYear('2025');
    expect(engine.getSnapshot().audio.listeners).toBe(1);
    expect(recording.listenerCount).toBe(1);

    while (engine.isTransitioning) engine.update(STEP);
    await completion;

    expect(engine.getSnapshot().audio.listeners).toBe(0);
    expect(recording.listenerCount).toBe(0);
  });

  it('sweeps the music bus across the crossfade while the engine is unlocked', async () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const recording = new RecordingAudio();
    const engine = harness(kernel, stubs, { audio: recording });

    const completion = engine.requestYear('2025');
    while (engine.isTransitioning) engine.update(STEP);
    const signal = await completion;

    const audioView = engine.getSnapshot().audio;
    expect(signal.outcome).toBe('arrived');
    expect(recording.tones.length).toBeGreaterThan(1);
    expect(recording.tones[0]!).toBeGreaterThanOrEqual(audioView.sourceToneHz);
    expect(recording.tones[0]!).toBeLessThan(audioView.targetToneHz);
    expect(recording.tones[recording.tones.length - 1]!).toBeCloseTo(audioView.targetToneHz, 6);
    expect(audioView.sweep).toBe(1);
  });

  it('is reproducible for a fixed step schedule', async () => {
    const first = await recordRun();
    const second = await recordRun();
    expect(second).toEqual(first);
  });

  it('treats a re-selection of the settled era as an already-arrived no-op', async () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const engine = harness(kernel, stubs);
    const cameraBefore = kernel.camera.position.clone();

    const first = engine.requestYear('1965');
    while (engine.isTransitioning) engine.update(STEP);
    await first;
    expect(stubs.map((stub) => stub.applied)).toEqual([['1965'], ['1965'], ['1965']]);

    const again = engine.requestYear('1965');
    const signal = await again;
    expect(signal.outcome).toBe('arrived');
    expect(signal.elapsedSeconds).toBe(0);
    expect(engine.isTransitioning).toBe(false);
    // The engine neither re-applies the era nor replays the choreography.
    expect(stubs.map((stub) => stub.applied)).toEqual([['1965'], ['1965'], ['1965']]);
    expect(kernel.camera.position.distanceTo(cameraBefore)).toBe(0);
    engine.update(STEP);
    expect(engine.isTransitioning).toBe(false);
  });

  it('dispose mid-flight restores every material, the camera and the audio subscription', async () => {
    const kernel = headlessKernel();
    const stubs = buildStubs(kernel);
    const recording = new RecordingAudio();
    const engine = harness(kernel, stubs, { audio: recording });
    const cameraBefore = kernel.camera.position.clone();
    const materialsBefore = snapshotMaterials(stubs.map((stub) => stub.group));

    const completion = engine.requestYear('2025');
    stepUntil(engine, () => engine.getSnapshot().progress >= 0.4);
    expect(recording.listenerCount).toBe(1);

    const worldBefore = kernel.world.children.length;
    engine.dispose();
    const signal = await completion;

    expect(signal.outcome).toBe('disposed');
    expect(engine.status).toBe('disposed');
    expect(engine.isDisposed).toBe(true);
    expect(recording.listenerCount).toBe(0);
    expect(engine.getSnapshot().audio.listeners).toBe(0);
    expectMaterialsRestored(stubs.map((stub) => stub.group), materialsBefore);
    expect(kernel.camera.position.x).toBeCloseTo(cameraBefore.x, 10);
    expect(kernel.camera.position.y).toBeCloseTo(cameraBefore.y, 10);
    expect(kernel.camera.position.z).toBeCloseTo(cameraBefore.z, 10);

    // No engine-owned nodes, no timers: further frames change nothing.
    expect(engine.getSnapshot().ownedNodes).toBe(0);
    const disposedSnapshot = engine.getSnapshot();
    engine.update(STEP);
    engine.update(STEP);
    expect(engine.getSnapshot().progress).toBe(disposedSnapshot.progress);
    expect(kernel.world.children.length).toBe(worldBefore);

    // Disposal is idempotent and a disposed engine refuses new switches.
    engine.dispose();
    expect(() => engine.requestYear('2025')).toThrow(/disposed/i);
  });
});

/** One deterministic run: same stubs, same fixed delta schedule, same snapshots. */
async function recordRun(): Promise<readonly string[]> {
  const kernel = headlessKernel();
  const stubs = buildStubs(kernel);
  const engine = harness(kernel, stubs);
  const journal: string[] = [];
  const completion = engine.requestYear('2025');

  for (let step = 0; step < 260 && engine.isTransitioning; step += 1) {
    engine.update(STEP);
    const snapshot = engine.getSnapshot();
    journal.push(
      [
        step,
        snapshot.phase,
        snapshot.progress.toFixed(6),
        snapshot.swapsApplied,
        snapshot.modules
          .map((view) => `${view.id}@${view.order}:${view.applied ? 1 : 0}:${view.reportedYear}`)
          .join(','),
      ].join('|'),
    );
  }
  const signal = await completion;
  journal.push(`end:${signal.outcome}:${signal.settledYear}:${signal.steps}`);
  return Object.freeze(journal);
}

/* -------------------------------------------------------------------------- */
/* Recording audio port                                                       */
/* -------------------------------------------------------------------------- */

function baseMixState(): AudioMixState {
  return {
    state: 'running',
    year: null,
    mixId: null,
    programId: null,
    ambienceId: null,
    machineCharacterId: null,
    machineArchetype: null,
    musicLevel: 0.8,
    musicToneHz: 8000,
    ambienceLevel: 0.7,
    ambienceDensity: 0.5,
    machineLevel: 0.6,
    masterLevel: 0.9,
    reverbDryWet: 0.25,
    reverbSeconds: 1.1,
    limiterReduction: 1,
    mutes: { music: false, ambience: false, machine: false },
    sends: { music: 0.35, ambience: 0.2, machine: 0.3 },
    activeMusicVoices: 0,
    scheduledNotes: 0,
    murmurBlips: 0,
    machineTriggers: 0,
  };
}

/** Bus tone the audio engine derives from an era mix (mirrors `applyMix`). */
function toneFromMix(mix: EraMixInput): number {
  const brightness = mix.music.brightness ?? 1;
  return Math.min(
    Math.max(mix.music.toneHz * (0.65 + 0.5 * brightness) * brightness, 200),
    20000,
  );
}

/** Records the transition's audio calls without a Web Audio implementation. */
class RecordingAudio implements TransitionAudioTarget {
  state: AudioEngineState = 'running';
  readonly plans: AudioTransitionPlan[] = [];
  readonly tones: number[] = [];
  programId: string | null = null;
  mixId: string | null = null;
  private currentTone = 8000;
  private listeners: ((record: MachineTriggerRecord) => void)[] = [];

  get listenerCount(): number {
    return this.listeners.length;
  }

  transitionTo(plan: AudioTransitionPlan): void {
    this.plans.push(plan);
    if (plan.program !== undefined && plan.program !== null) this.programId = plan.program.id;
    if (plan.mix !== undefined && plan.mix !== null) {
      this.mixId = plan.mix.id ?? null;
      this.currentTone = toneFromMix(plan.mix);
    }
  }

  setMusicProgram(program: MusicProgramInput | null): void {
    this.programId = program?.id ?? null;
  }

  getMixState(): AudioMixState {
    return {
      ...baseMixState(),
      programId: this.programId,
      mixId: this.mixId,
      musicToneHz: this.currentTone,
    };
  }

  setBusTone(_bus: 'music', hertz: number): void {
    this.tones.push(hertz);
    this.currentTone = hertz;
  }

  onMachineTrigger(listener: (record: MachineTriggerRecord) => void): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Composition: real registry modules and a real audio engine                  */
/* -------------------------------------------------------------------------- */

interface RegistryModule {
  createEraModules: typeof import('../data/periodRegistry').createEraModules;
  resolvePeriod: typeof import('../data/periodRegistry').resolvePeriod;
}

/**
 * Loads the real period registry. The composition check genuinely needs it: the
 * fixture eras used by the unit half would not prove that the ten aggregated
 * domain modules reach the target era.
 */
async function loadRegistry(): Promise<RegistryModule> {
  try {
    const registry = await import('../data/periodRegistry');
    return { createEraModules: registry.createEraModules, resolvePeriod: registry.resolvePeriod };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      'The period registry could not be loaded, so the transition composition check cannot run. ' +
        `Reason: ${reason}`,
    );
  }
}

function reportedYearOf(module: SceneModule): YearId | null {
  const candidate = module as {
    readonly year?: unknown;
    readonly spec?: { readonly year?: unknown } | undefined;
  };
  if (typeof candidate.year === 'string') return candidate.year as YearId;
  const specYear = candidate.spec?.year;
  return typeof specYear === 'string' ? (specYear as YearId) : null;
}

describe('period transition composition', () => {
  it('composition: drives the real registry from 1945 to 2025 with a real AudioEngine', async () => {
    const registry = await loadRegistry();
    const kernel = headlessKernel();
    const startYear: YearId = '1945';
    const targetYear: YearId = '2025';
    const startPeriod = registry.resolvePeriod(startYear);
    const targetPeriod = registry.resolvePeriod(targetYear);

    // The ten real domain modules, built headlessly, exactly as the registry
    // test (and the composition root) builds them.
    const instances = registry.createEraModules(startYear, {
      bounds: startPeriod.roomDefaults.bounds,
      seed: 0x1945,
    });
    expect(instances).toHaveLength(10);
    const environment = instances.find((instance) => instance.id === 'environment');
    expect(environment).toBeDefined();
    const services = Object.freeze({ environmentModule: environment!.module });
    for (const instance of instances) {
      instance.module.build(kernel.createBuildContext(startPeriod, { services }));
    }

    const fakeContexts = createFakeAudioContextFactory();
    const audio = createAudioEngine({ contextFactory: fakeContexts.factory, seed: 0x1945 });
    openAudio.push(audio);
    expect(await audio.unlock()).toBe('running');

    const transition = harness(kernel, instances.map((instance) => instance.module), {
      audio,
      resolvePeriod: registry.resolvePeriod,
      initialYear: startYear,
      services,
    });

    // Boot the scene at 1945 through the engine's instant path.
    transition.applyYear(startYear);
    expect(audio.getMixState().programId).toBe(musicProgram(startYear).id);
    const sourceMachine = audio.getMixState().machineCharacterId;
    expect(sourceMachine).not.toBeNull();

    const worldChildrenBefore = kernel.world.children.length;
    const cameraBefore = kernel.camera.position.clone();
    const roots = instances.map((instance) => instance.module.root);
    const materialsBefore = snapshotMaterials(roots);
    const captions: string[] = [];
    transition.onCaption((caption) =>
      captions.push(`${caption.year}|${caption.name}|${caption.note}`),
    );

    const completion = transition.requestYear(targetYear);
    let cameraMoved = false;
    const tones = new Set<number>();
    for (let step = 0; step < 400 && transition.isTransitioning; step += 1) {
      transition.update(STEP);
      audio.update(STEP);
      tones.add(Number(audio.getMixState().musicToneHz.toFixed(6)));
      if (kernel.camera.position.distanceTo(cameraBefore) > 0.001) cameraMoved = true;
    }
    const signal = await completion;

    // Every module reached the target era.
    expect(signal.outcome).toBe('arrived');
    expect(signal.settledYear).toBe(targetYear);
    for (const instance of instances) {
      expect(reportedYearOf(instance.module), `${instance.id} reports ${targetYear}`).toBe(
        targetYear,
      );
    }
    expect(transition.modules.every((view) => view.reportedYear === targetYear)).toBe(true);
    expect(transition.modules.every((view) => view.applied)).toBe(true);

    // The music programme crossfaded to the target era, at that era's level.
    const mixState = audio.getMixState();
    expect(mixState.programId).toBe(musicProgram(targetYear).id);
    expect(mixState.mixId).toBe(eraMusicMix(targetYear).id ?? null);
    expect(mixState.year).toBe(targetYear);
    expect(mixState.musicLevel).toBeCloseTo(eraMusicMix(targetYear).music.level, 6);
    expect(mixState.machineCharacterId).not.toBeNull();
    expect(mixState.machineArchetype).not.toBeNull();
    // The machine character is the target era's, not the era we left.
    expect(mixState.machineCharacterId).toBe(eraMusicMix(targetYear).machine.character.id ?? null);
    expect(mixState.machineCharacterId).not.toBe(sourceMachine);
    const programmeIds = audio
      .getEventLog()
      .filter((event) => event.kind === 'music-program')
      .map((event) => event.id);
    expect(programmeIds).toContain(musicProgram(startYear).id);
    expect(programmeIds).toContain(musicProgram(targetYear).id);

    // The transition sweep moved the music bus tone and landed on the era tone.
    expect(tones.size).toBeGreaterThan(1);
    expect(transition.getSnapshot().audio.sweep).toBe(1);

    // The era caption carries the target period's name and historical note.
    expect(captions).toEqual([`${targetYear}|${targetPeriod.name}|${targetPeriod.summary}`]);
    expect(transition.caption?.year).toBe(targetYear);
    expect(transition.caption?.name).toBe(targetPeriod.name);
    expect(transition.caption?.note).toBe(targetPeriod.summary);

    // The camera micro-moved and settled back to the prior framing.
    expect(cameraMoved).toBe(true);
    expect(kernel.camera.position.x).toBeCloseTo(cameraBefore.x, 10);
    expect(kernel.camera.position.y).toBeCloseTo(cameraBefore.y, 10);
    expect(kernel.camera.position.z).toBeCloseTo(cameraBefore.z, 10);

    // Nothing engine-owned was added, nothing orphaned, materials restored.
    expect(transition.getSnapshot().ownedNodes).toBe(0);
    expect(kernel.world.children.length).toBeLessThanOrEqual(worldChildrenBefore);
    for (const instance of instances) {
      const root = instance.module.root;
      expect(root, `${instance.id} owns a root`).toBeDefined();
      const owners = kernel.world.children.filter(
        (child) => child === root || child.getObjectById(root!.id) !== undefined,
      );
      expect(owners, `${instance.id} appears once in the world`).toHaveLength(1);
    }
    expectMaterialsRestored(roots, materialsBefore);
    expect(transition.getSnapshot().audio.listeners).toBe(0);

    // Dispose the way the composition root tears the scene down.
    transition.dispose();
    expect(transition.isDisposed).toBe(true);
    for (const instance of instances) instance.module.dispose();
  });
});
