// @vitest-environment happy-dom
/**
 * Adaptive quality tiers, frame-time hardening and the performance badge.
 *
 * This is the acceptance suite for the fidelity governor: it proves the four
 * properties the work order names, against the *composed* game rather than a
 * preview page —
 *
 *  1. rolling frame-time statistics select `calm`, `boosted` or `minimal`
 *     deterministically, with hysteresis that stops the tier oscillating;
 *  2. applying a tier changes renderer pixel ratio, the shadow switches, the
 *     post-processing flags and the instanced field's draw count, and leaves the
 *     simulation state untouched;
 *  3. under a sustained over-budget load the composed game downgrades by itself
 *     and then holds the downgraded tier's budget (median under the target, p95
 *     under 2× the target);
 *  4. the badge mounts on the HUD's own overlay anchor, shows live FPS and the
 *     active tier, never intercepts pointer input, and exposes the
 *     `data-hud="stress-toggle"` stress control; at the default tier the neon art
 *     direction survives — bloom, god rays, conduits and the constellation are
 *     all still visible.
 *
 * The window loop is closed on purpose: the synthetic frame time of the next
 * frame is computed from the settings the governor just applied, so the suite
 * exercises the real feedback path (shed load → cheaper frame) instead of
 * replaying a fixed recording. The model is not a prediction of any GPU; it is
 * the monotone cost model the governor must converge under.
 */

import { Group } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGame, type Game } from '../src/game/Game';
import { createManualClock, type ManualClock } from '../src/game/loop';
import {
  createMissionInitialState,
  createSystems,
  systems as registry,
  type GameSystems,
} from '../src/game/systems';
import { createHeadlessAdapter } from '../src/render/headless';
import { PLAN_GRAPH_NAMES } from '../src/render/nodes';
import { CRITERION_NAMES } from '../src/render/qualityGraph';
import {
  CALM_TARGET_MS,
  MINIMAL_TARGET_MS,
  QUALITY_TIER_SETTINGS,
  QUALITY_TIER_RANK,
  QUALITY_WINDOW_SIZE,
  STRESS_FIELD_NAME,
  applyQualityTier,
  clampQualityTier,
  createAdaptiveQuality,
  createAppliedQualitySettings,
  createFrameTimeMonitor,
  createQualityTierSystem,
  createStressRig,
  detectDeviceSignals,
  deviceTierCeiling,
  initialQualityTier,
  selectQualityTier,
  stepQualityTier,
  type AppliedQualitySettings,
  type QualityInstanceHook,
  type QualityTier,
} from '../src/render/qualityTiers';
import type { RenderAdapter } from '../src/render/renderer';
import { createPerfBadge, PERF_HUD_KEYS, PERF_STYLE_ATTRIBUTE } from '../src/ui/perfBadge';
import { createHudOverlay } from '../src/ui/hud';
import { mountPerfPreview } from '../dev-preview/perf';

/** Attachment order of the module systems the governor is appended to. */
const MODULE_ORDER = [
  'camera-rig',
  'world',
  'render/plan-graph',
  'render/lane-agents',
  'render/quality-graph',
  'ui/hud',
  'ui/panels',
  'audio/bus',
  'mission/flow',
  'input/router',
] as const;

/** Synthetic fixed step used by the composed governor runs. */
const STEP_MS = 1000 / 60;

const openGames: Game[] = [];

beforeEach(() => {
  // The governor logs one line per tier handover; the tests below assert on the
  // lines they care about and keep the rest out of the suite output.
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  for (const game of openGames.splice(0)) game.dispose();
  document.body.innerHTML = '';
  for (const style of Array.from(document.querySelectorAll(`style[${PERF_STYLE_ATTRIBUTE}]`))) {
    style.remove();
  }
});

function mountHost(): HTMLElement {
  const host = document.createElement('div');
  host.id = 'perf-test-host';
  document.body.append(host);
  return host;
}

/** Element matching a stable HUD hook, or `null`. */
function hudElement(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-hud="${key}"]`);
}

/**
 * Frame-cost model of the closed loop.
 *
 * Cost rises with the four settings a tier writes — pixel ratio, the post
 * chain, shadows and instances — and never falls below the fixed step the
 * runtime already spends on simulation.
 */
function modelFrameMs(applied: AppliedQualitySettings, load: number, stepMs: number): number {
  const fill = applied.pixelRatio * applied.pixelRatio;
  const postFactor = applied.post ? 1 : 0.4;
  const shadowFactor = applied.shadows ? 1.3 : 1;
  const instanceFactor = 1 + applied.instanceCount / 4096;
  return stepMs + load * fill * postFactor * shadowFactor * instanceFactor;
}

interface ComposedRun {
  readonly game: Game;
  readonly bundle: GameSystems;
  readonly adapter: RenderAdapter;
  readonly clock: ManualClock;
  readonly stepMs: number;
  readonly load: number;
}

/** Boot the shipped registry over the headless adapter with a manual clock. */
function bootComposed(options: {
  load: number;
  stepMs?: number;
  host?: HTMLElement | null;
}): ComposedRun {
  const bundle = createSystems(options.host ? { interfaceHost: options.host } : {});
  const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
  const clock = createManualClock(0);
  const stepMs = options.stepMs ?? STEP_MS;
  const game = createGame({
    adapter,
    systems: bundle.list,
    state: createMissionInitialState(),
    clock,
    stepMs,
  });
  openGames.push(game);
  return { game, bundle, adapter, clock, stepMs, load: options.load };
}

/** Advance `frames` frames, each costing what the applied tier really carries. */
function driveFrames(run: ComposedRun, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) {
    const frameMs = modelFrameMs(run.bundle.quality.applied, run.load, run.stepMs);
    run.clock.advance(frameMs);
    run.game.advance(frameMs);
  }
}

/** Feed one whole window of identical frame times into a controller. */
function feedWindow(
  adaptive: { observe(frameMs: number): boolean },
  frameMs: number,
  window = QUALITY_WINDOW_SIZE,
): boolean {
  let changed = false;
  for (let sample = 0; sample < window; sample += 1) {
    if (adaptive.observe(frameMs)) changed = true;
  }
  return changed;
}

/* -------------------------------------------------------------------------- */
/* Rolling statistics                                                         */
/* -------------------------------------------------------------------------- */

describe('rolling frame-time statistics', () => {
  it('computes the window percentiles from a fixed-size ring buffer', () => {
    const monitor = createFrameTimeMonitor({ window: 8, budgetMs: CALM_TARGET_MS });
    const samples = [10, 10, 10, 10, 20, 20, 20, 20];

    for (let index = 0; index < samples.length; index += 1) {
      const completed = monitor.push(samples[index] ?? 0);
      expect(completed, `sample ${index}`).toBe(index === samples.length - 1);
    }

    const stats = monitor.stats;
    expect(stats.window).toBe(8);
    expect(stats.samples).toBe(8);
    expect(stats.medianMs).toBe(15);
    expect(stats.p95Ms).toBe(20);
    expect(stats.meanMs).toBe(15);
    expect(stats.minMs).toBe(10);
    expect(stats.maxMs).toBe(20);
    expect(stats.fps).toBeCloseTo(1000 / 15, 6);
    // 15 ms median sits inside the 16.7 ms target; 20 ms p95 sits inside 2×.
    expect(stats.overBudget).toBe(false);
    expect(stats.headroom).toBe(false);
    expect(stats.budgetHeld).toBe(true);
  });

  it('never grows, never reallocates and never counts a catch-up step', () => {
    const monitor = createFrameTimeMonitor({ window: 8 });
    const statsRef = monitor.stats;
    expect(monitor.stats).toBe(statsRef);

    for (let sample = 0; sample < 80; sample += 1) monitor.push(30);
    expect(monitor.count).toBe(8);
    expect(monitor.capacity).toBe(8);
    expect(monitor.stats.window).toBe(8);
    expect(monitor.stats.medianMs).toBe(30);
    // The statistics record is one owned object, updated in place.
    expect(monitor.stats).toBe(statsRef);
    expect(statsRef.revision).toBeGreaterThan(0);

    // Sub-millisecond deltas are catch-up steps inside an existing frame.
    monitor.reset();
    const accepted = monitor.accepted;
    expect(monitor.push(0.4)).toBe(false);
    expect(monitor.accepted).toBe(accepted);
    expect(monitor.count).toBe(0);
    expect(monitor.push(Number.NaN)).toBe(false);

    // A full rolling window is re-judged when the target changes under it.
    monitor.push(15);
    monitor.setBudget(10);
    expect(monitor.stats.overBudget).toBe(true);
    expect(monitor.stats.budgetMs).toBe(10);
  });

  it('keeps the ring whole when the window rolls over', () => {
    const monitor = createFrameTimeMonitor({ window: 8, budgetMs: CALM_TARGET_MS });
    for (let sample = 0; sample < 8; sample += 1) monitor.push(10);
    expect(monitor.stats.medianMs).toBe(10);
    for (let sample = 0; sample < 8; sample += 1) monitor.push(30);
    expect(monitor.windows).toBe(2);
    expect(monitor.stats.medianMs).toBe(30);
    expect(monitor.stats.samples).toBe(8);
  });
});

/* -------------------------------------------------------------------------- */
/* Deterministic, hysteretic selection                                        */
/* -------------------------------------------------------------------------- */

describe('adaptive tier selection', () => {
  it('steps down only on sustained over-budget windows', () => {
    const adaptive = createAdaptiveQuality({ tier: 'calm', window: QUALITY_WINDOW_SIZE });
    expect(adaptive.tier).toBe('calm');

    // One overloaded window is noise: the tier holds.
    expect(feedWindow(adaptive, 40)).toBe(false);
    expect(adaptive.tier).toBe('calm');
    expect(adaptive.decision.overBudgetWindows).toBe(1);

    // Two in a row is a budget the tier cannot hold: shed load.
    expect(feedWindow(adaptive, 40)).toBe(true);
    expect(adaptive.tier).toBe('minimal');
    expect(adaptive.decision.reason).toBe('over-budget');
    expect(adaptive.monitor.stats.budgetMs).toBe(MINIMAL_TARGET_MS);

    // Minimal is the floor: sustained overload cannot go lower.
    feedWindow(adaptive, 200);
    feedWindow(adaptive, 200);
    expect(adaptive.tier).toBe('minimal');
  });

  it('refuses to oscillate between over-budget and healthy windows', () => {
    const adaptive = createAdaptiveQuality({ tier: 'calm', window: QUALITY_WINDOW_SIZE });
    const seen: QualityTier[] = [];

    // Alternating slow/fast windows: no run of two ever accumulates, so the
    // tier stays put even though half of the windows are over budget.
    for (let window = 0; window < 12; window += 1) {
      feedWindow(adaptive, window % 2 === 0 ? 40 : 14);
      seen.push(adaptive.tier);
    }

    expect(new Set(seen).size).toBe(1);
    expect(adaptive.tier).toBe('calm');
    expect(adaptive.changes).toBe(0);
    // 14 ms is inside the 16.7 ms target but not inside the 60 % upgrade
    // margin, so neither branch fires.
    expect(adaptive.decision.reason).toBe('hold');
  });

  it('spends headroom only after several windows, and only with permission', () => {
    const adaptive = createAdaptiveQuality({ tier: 'calm', window: QUALITY_WINDOW_SIZE });
    for (let window = 0; window < 3; window += 1) feedWindow(adaptive, 6);
    expect(adaptive.tier).toBe('calm');
    expect(adaptive.decision.headroomWindows).toBe(3);

    // The fourth headroom window spends it.
    expect(feedWindow(adaptive, 6)).toBe(true);
    expect(adaptive.tier).toBe('boosted');
    expect(adaptive.decision.reason).toBe('headroom');

    // With upgrades pinned (a stress run) the governor may only shed load.
    const pinned = createAdaptiveQuality({ tier: 'minimal', window: 8 });
    pinned.setAllowUpgrade(false);
    for (let window = 0; window < 10; window += 1) feedWindow(pinned, 4, 8);
    expect(pinned.tier).toBe('minimal');
    expect(pinned.allowUpgrade).toBe(false);
  });

  it('is deterministic and respects the device band', () => {
    const stats = createFrameTimeMonitor({ window: 4, budgetMs: CALM_TARGET_MS });
    for (let sample = 0; sample < 4; sample += 1) stats.push(40);
    const input = {
      current: 'calm' as QualityTier,
      stats: stats.stats,
      overBudgetWindows: 1,
      headroomWindows: 0,
      windowsSinceChange: 4,
    };
    const first = selectQualityTier(input);
    const second = selectQualityTier(input);
    expect(second).toEqual(first);
    expect(first.tier).toBe('minimal');
    expect(first.changed).toBe(true);
    expect(first.reason).toBe('over-budget');

    // The same input replays identically from the controller side.
    const a = createAdaptiveQuality({ tier: 'calm', window: 4 });
    const b = createAdaptiveQuality({ tier: 'calm', window: 4 });
    for (let sample = 0; sample < 8; sample += 1) {
      a.observe(40);
      b.observe(40);
    }
    expect(b.tier).toBe(a.tier);
    expect(b.decision).toEqual(a.decision);

    // Device clamps: a calm-ceiling host never reaches boosted.
    const capped = createAdaptiveQuality({ tier: 'calm', window: 4, maxTier: 'calm' });
    for (let window = 0; window < 8; window += 1) feedWindow(capped, 3, 4);
    expect(capped.tier).toBe('calm');
    expect(clampQualityTier('boosted', 'minimal', 'calm')).toBe('calm');
    expect(stepQualityTier('minimal', -1)).toBe('minimal');
    expect(stepQualityTier('boosted', 1)).toBe('boosted');
    expect(stepQualityTier('calm', 1)).toBe('boosted');
  });

  it('reads device signals into the starting tier and the upgrade ceiling', () => {
    const weak = {
      devicePixelRatio: 1,
      hardwareConcurrency: 2,
      reducedMotion: false,
      saveData: false,
    };
    expect(initialQualityTier(weak)).toBe('minimal');
    expect(initialQualityTier({ ...weak, saveData: true })).toBe('minimal');
    expect(initialQualityTier({ ...weak, hardwareConcurrency: 8 })).toBe('calm');
    expect(deviceTierCeiling(weak)).toBe('calm');
    expect(deviceTierCeiling({ ...weak, hardwareConcurrency: 8 })).toBe('boosted');
    // A boosted start is never configured: it has to be measured.
    expect(initialQualityTier(detectDeviceSignals())).not.toBe('boosted');
  });
});

/* -------------------------------------------------------------------------- */
/* Applying a tier                                                            */
/* -------------------------------------------------------------------------- */

/** A stand-in instance field, for the instance-budget half of a tier. */
interface FakeField extends QualityInstanceHook {
  readonly count: number;
  readonly shadows: boolean;
}

function createFakeField(capacity: number): FakeField {
  const object = new Group();
  let count = 0;
  let shadows = false;
  return {
    object,
    capacity,
    get count() {
      return count;
    },
    get shadows() {
      return shadows;
    },
    setInstanceBudget(fraction: number): number {
      count = Math.round(capacity * fraction);
      return count;
    },
    setShadows(enabled: boolean): void {
      shadows = enabled;
    },
  };
}

/** Count the scene's light shadow emitters, for the shadow-switch assertions. */
function shadowEmitters(scene: { traverse(callback: (object: unknown) => void): void }): number {
  let lights = 0;
  scene.traverse((object) => {
    const candidate = object as { isLight?: boolean; castShadow?: boolean };
    if (candidate.isLight === true && candidate.castShadow === true) lights += 1;
  });
  return lights;
}

describe('applying a quality tier', () => {
  it('writes pixel ratio, shadows, post flags and instance count to the shared adapter', () => {
    const run = bootComposed({ load: 0 });
    driveFrames(run, 1);

    const world = run.bundle.world.world;
    const field = createFakeField(1024);
    const target = { adapter: run.adapter, world, instances: field };

    const minimal = applyQualityTier(target, 'minimal');
    expect(minimal.tier).toBe('minimal');
    expect(minimal.pixelRatio).toBe(QUALITY_TIER_SETTINGS.minimal.pixelRatio);
    expect(run.adapter.pixelRatio).toBe(QUALITY_TIER_SETTINGS.minimal.pixelRatio);
    expect(minimal.shadows).toBe(false);
    expect(minimal.post).toBe(false);
    expect(minimal.instanceScale).toBe(QUALITY_TIER_SETTINGS.minimal.instanceScale);
    expect(field.count).toBe(128);
    expect(field.shadows).toBe(false);
    expect(shadowEmitters(run.adapter.scene)).toBe(0);
    // Post-processing is off and the preset is the cheapest one available.
    expect(world?.post.glow.visible).toBe(false);
    expect(world?.post.rays.visible).toBe(false);
    expect(world?.post.screen.visible).toBe(false);
    expect(world?.preset).toBe('low');

    // The owned record can be reused: the governor applies tiers allocation-free.
    const into = createAppliedQualitySettings('minimal');
    const revision = into.revision;
    expect(applyQualityTier(target, 'boosted', into)).toBe(into);
    expect(into.revision).toBe(revision + 1);

    expect(into.pixelRatio).toBe(QUALITY_TIER_SETTINGS.boosted.pixelRatio);
    expect(run.adapter.pixelRatio).toBe(QUALITY_TIER_SETTINGS.boosted.pixelRatio);
    expect(into.shadows).toBe(true);
    expect(into.post).toBe(true);
    expect(into.postPreset).toBe('ultra');
    expect(into.haloRings).toBe(3);
    expect(into.rayCount).toBe(22);
    expect(field.count).toBe(1024);
    expect(field.shadows).toBe(true);
    expect(shadowEmitters(run.adapter.scene)).toBeGreaterThan(0);
    expect(into.shadowLights).toBeGreaterThan(0);
    expect(into.shadowReceivers).toBeGreaterThan(0);
    expect(world?.post.glow.visible).toBe(true);
    expect(world?.post.rays.visible).toBe(true);
    expect(world?.post.screen.visible).toBe(true);
    expect(world?.post.visibleRays).toBe(22);
    expect(world?.preset).toBe('ultra');
  });

  it('keeps the neon art direction at the default tier and never touches simulation', () => {
    const run = bootComposed({ load: 0 });
    driveFrames(run, 2);

    const quality = run.bundle.quality;
    expect(quality.tier).toBe('calm');
    const applied = quality.applied;
    expect(applied.pixelRatio).toBe(QUALITY_TIER_SETTINGS.calm.pixelRatio);
    expect(applied.post).toBe(true);
    expect(applied.postPreset).toBe('high');
    expect(applied.targetMs).toBe(CALM_TARGET_MS);
    expect(applied.ceilingMs).toBe(CALM_TARGET_MS * 2);

    // Bloom and god rays are drawing, and the world keeps its neon preset.
    const world = run.bundle.world.world;
    expect(world?.post.glow.visible).toBe(true);
    expect(world?.post.rays.visible).toBe(true);
    expect(world?.post.visibleHalos).toBeGreaterThan(0);
    expect(world?.post.visibleRays).toBeGreaterThan(0);
    expect(world?.preset).toBe('high');

    // Conduits and the quality constellation are still in the scene and visible.
    const conduits = run.adapter.scene.getObjectByName(PLAN_GRAPH_NAMES.conduits);
    const constellation = run.adapter.scene.getObjectByName(CRITERION_NAMES.root);
    expect(conduits, PLAN_GRAPH_NAMES.conduits).toBeTruthy();
    expect(constellation, CRITERION_NAMES.root).toBeTruthy();
    expect(conduits?.visible).toBe(true);
    expect(constellation?.visible).toBe(true);

    // Presentation only: a tier change cannot move the simulation.
    const before = run.game.state;
    const steps = run.game.stats.steps;
    const progress = before.mission.progress;
    expect(quality.setTier('boosted')).toBe(true);
    expect(quality.setTier('minimal')).toBe(true);
    expect(run.game.state).toBe(before);
    expect(run.game.state.mission.progress).toBe(progress);
    expect(run.game.stats.steps).toBe(steps);
    expect(run.adapter.pixelRatio).toBe(QUALITY_TIER_SETTINGS.minimal.pixelRatio);
  });

  it('shapes the stress field and calibrates its burn', () => {
    const parent = new Group();
    const rig = createStressRig(parent, { capacity: 64 });

    expect(rig.root.name).toBe(STRESS_FIELD_NAME);
    expect(rig.capacity).toBe(64);
    // Idle: allocated once, drawn never.
    expect(rig.root.visible).toBe(false);
    expect(rig.root.count).toBe(0);

    expect(rig.setInstanceBudget(0.5)).toBe(0);
    rig.setActive(true);
    expect(rig.count).toBe(32);
    expect(rig.root.visible).toBe(true);

    rig.setTier('minimal');
    expect(rig.targetMs).toBe(QUALITY_TIER_SETTINGS.minimal.stressMs);

    // A calibrating clock: the burn measured far under target, so the rig may
    // at most double its size, and it stays inside its hard bound.
    let clock = 0;
    const slow = (): number => {
      clock += 0.1;
      return clock;
    };
    const first = rig.burn(slow);
    expect(first).toBeCloseTo(0.1, 6);
    expect(rig.iterations).toBeLessThanOrEqual(60_000_000);
    const grown = rig.iterations;
    rig.burn(slow);
    expect(rig.iterations).toBeGreaterThanOrEqual(grown);

    // A frozen (manual) clock cannot calibrate, so the burn keeps its size.
    const frozen = rig.iterations;
    expect(rig.burn(() => 0)).toBe(0);
    expect(rig.iterations).toBe(frozen);

    rig.dispose();
    expect(parent.children).toHaveLength(0);
    rig.dispose();
  });

  it('governs the composed registry without a DOM host as well', () => {
    const governor = createQualityTierSystem({ tier: 'calm' });
    const adapter = createHeadlessAdapter({ width: 640, height: 360 });
    const game = createGame({
      adapter,
      systems: [
        governor,
        {
          id: 'noop',
          attach(): void {},
          update(): void {},
          dispose(): void {},
        },
      ],
      stepMs: 8,
    });
    openGames.push(game);

    // The stress rig is composed but idle: nothing is drawn until acceptance
    // engages it, while the tier's instance budget stays concrete.
    expect(governor.rig).not.toBeNull();
    expect(governor.rig?.active).toBe(false);
    expect(governor.rig?.count).toBe(0);
    expect(governor.rig?.capacity).toBe(4096);
    game.advance(64);
    expect(governor.applied.tier).toBe('calm');
    expect(governor.applied.pixelRatio).toBe(QUALITY_TIER_SETTINGS.calm.pixelRatio);
    expect(adapter.pixelRatio).toBe(QUALITY_TIER_SETTINGS.calm.pixelRatio);
    expect(governor.state.tier).toBe('calm');
    expect(governor.state.stress).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Frame budget under load                                                    */
/* -------------------------------------------------------------------------- */

describe('frame budget under sustained load', () => {
  it('downgrades by itself and then holds the downgraded tier budget', () => {
    // A load the calm tier cannot carry: 20 × 4.39 ms of extra work.
    const run = bootComposed({ load: 20 });
    const quality = run.bundle.quality;

    driveFrames(run, QUALITY_WINDOW_SIZE);
    expect(quality.tier).toBe('calm');
    expect(quality.stats.overBudget).toBe(true);
    expect(quality.stats.medianMs).toBeGreaterThan(CALM_TARGET_MS);

    // The second over-budget window is the sustained run: the governor sheds
    // load on its own, inside the composed game.
    driveFrames(run, QUALITY_WINDOW_SIZE);
    expect(quality.tier).toBe('minimal');
    expect(quality.applied.tier).toBe('minimal');
    expect(run.adapter.pixelRatio).toBe(QUALITY_TIER_SETTINGS.minimal.pixelRatio);
    expect(run.bundle.world.world?.post.glow.visible).toBe(false);

    // After the downgrade the selected tier's budget holds: median under the
    // 33.3 ms target and p95 under the 66.7 ms ceiling, for the rest of the run.
    for (let window = 0; window < 3; window += 1) {
      driveFrames(run, QUALITY_WINDOW_SIZE);
      expect(quality.tier, 'tier must stay shed').toBe('minimal');
      expect(quality.stats.medianMs).toBeLessThan(QUALITY_TIER_SETTINGS.minimal.budget.targetMs);
      expect(quality.stats.p95Ms).toBeLessThan(QUALITY_TIER_SETTINGS.minimal.budget.ceilingMs);
      expect(quality.stats.budgetHeld).toBe(true);
    }
    expect(quality.stats.fps).toBeGreaterThan(20);
  });

  it('spends headroom only when the measured frame really has it', () => {
    const run = bootComposed({ load: 0.1, stepMs: 8 });
    const quality = run.bundle.quality;
    expect(quality.tier).toBe('calm');

    // Four headroom windows: the governor climbs to boosted on its own.
    driveFrames(run, QUALITY_WINDOW_SIZE * 4);
    expect(quality.tier).toBe('boosted');
    expect(run.adapter.pixelRatio).toBe(QUALITY_TIER_SETTINGS.boosted.pixelRatio);
    expect(quality.applied.postPreset).toBe('ultra');

    // Boosted is where the ladder stops: the same load cannot fund a fourth.
    driveFrames(run, QUALITY_WINDOW_SIZE * 2);
    expect(quality.tier).toBe('boosted');
    expect(quality.stats.budgetHeld).toBe(true);
  });

  it('engages the composed stress rig through the governor', () => {
    const run = bootComposed({ load: 0 });
    const quality = run.bundle.quality;

    expect(quality.rig).not.toBeNull();
    expect(quality.rig?.active).toBe(false);
    expect(quality.rig?.count).toBe(0);

    expect(quality.toggleStress()).toBe(true);
    expect(quality.stressActive).toBe(true);
    expect(quality.adaptive.allowUpgrade).toBe(false);
    expect(quality.rig?.active).toBe(true);
    // Engaging the rig re-arms at the richest tier the device permits, so the
    // run starts from a configuration it has to shed…
    expect(quality.tier).toBe(quality.adaptive.maxTier);
    // …and the instance budget follows the tier that is now applied.
    expect(quality.rig?.count).toBe(
      Math.round((quality.rig?.capacity ?? 0) * quality.applied.instanceScale),
    );
    expect(quality.applied.instanceCount).toBe(quality.rig?.count);
    expect(run.adapter.scene.getObjectByName(STRESS_FIELD_NAME)).toBe(quality.rig?.root);

    expect(quality.setStress(false)).toBe(true);
    expect(quality.rig?.active).toBe(false);
    expect(quality.rig?.count).toBe(0);
    expect(quality.applied.instanceCount).toBe(0);
    expect(quality.adaptive.allowUpgrade).toBe(true);
    expect(quality.setStress(false)).toBe(false);
  });

  it('sheds an unaffordable configuration window by window, then pins the floor', () => {
    const signals = {
      devicePixelRatio: 1,
      hardwareConcurrency: 8,
      reducedMotion: false,
      saveData: false,
    };
    const governor = createQualityTierSystem({
      tier: 'minimal',
      signals,
      // A miniature rig: the ladder is what is under test here, not the size of
      // the load generator the composed game ships.
      stress: { capacity: 64, targets: { minimal: 0.05, calm: 0.1, boosted: 0.2 } },
    });
    const adapter = createHeadlessAdapter({ width: 640, height: 360 });
    const clock = createManualClock(0);
    const stepMs = 8;
    const load = 20;
    const game = createGame({ adapter, systems: [governor], clock, stepMs });
    openGames.push(game);

    const drive = (frames: number): void => {
      for (let frame = 0; frame < frames; frame += 1) {
        const frameMs = modelFrameMs(governor.applied, load, stepMs);
        clock.advance(frameMs);
        game.advance(frameMs);
      }
    };

    // The load is affordable at minimal: the run settles on the default floor.
    drive(QUALITY_WINDOW_SIZE * 3);
    expect(governor.tier).toBe('minimal');

    // Engaging the rig restarts the window at the device ceiling.
    expect(governor.toggleStress()).toBe(true);
    expect(governor.stressActive).toBe(true);
    expect(governor.tier).toBe('boosted');
    expect(governor.rig?.count).toBe(governor.rig?.capacity);
    expect(governor.adaptive.allowUpgrade).toBe(false);

    // Two over-budget windows shed boosted → calm; after the settle window two
    // more shed calm → minimal.
    drive(QUALITY_WINDOW_SIZE * 2);
    expect(governor.tier).toBe('calm');
    drive(QUALITY_WINDOW_SIZE * 4);
    expect(governor.tier).toBe('minimal');

    // Upgrades are pinned while the rig runs: the cheap frames cannot climb back.
    drive(QUALITY_WINDOW_SIZE * 6);
    expect(governor.tier).toBe('minimal');
    expect(governor.stats.medianMs).toBeLessThan(QUALITY_TIER_SETTINGS.minimal.budget.targetMs);
    expect(governor.stats.p95Ms).toBeLessThan(QUALITY_TIER_SETTINGS.minimal.budget.ceilingMs);
  });
});

/* -------------------------------------------------------------------------- */
/* Registry composition                                                       */
/* -------------------------------------------------------------------------- */

describe('registry composition', () => {
  it('appends the governor and the badge after every module registration', () => {
    const ids = registry.map((system) => system.id);
    expect(ids.slice(0, MODULE_ORDER.length)).toEqual([...MODULE_ORDER]);
    expect(ids.slice(MODULE_ORDER.length)).toEqual(['render/quality-tiers', 'ui/perf-badge']);
    expect(new Set(ids).size).toBe(ids.length);

    const bundle = createSystems();
    expect(bundle.list.map((system) => system.id)).toEqual(ids);
    expect(bundle.quality.id).toBe('render/quality-tiers');
    expect(bundle.perfBadge.id).toBe('ui/perf-badge');
  });

  it('is what a default createGame attaches, and disposes exactly once', () => {
    const host = mountHost();
    const run = bootComposed({ load: 0, host });
    driveFrames(run, 4);

    expect(run.game.systems.map((system) => system.id)).toEqual(registry.map((system) => system.id));
    expect(run.game.stats.systems).toBe(registry.length);
    // The badge mounted on the HUD's own overlay anchor, inside the host.
    expect(hudElement(PERF_HUD_KEYS.badge)).not.toBeNull();
    expect(hudElement('overlay')?.contains(hudElement(PERF_HUD_KEYS.badge))).toBe(true);

    const quality = run.bundle.quality;
    run.game.dispose();
    expect(run.adapter.disposed).toBe(true);
    expect(quality.rig).toBeNull();
    expect(run.bundle.perfBadge.badge).toBeNull();
    expect(hudElement(PERF_HUD_KEYS.badge)).toBeNull();
    // Idempotent: nothing is released twice.
    run.game.dispose();
    expect(quality.setStress(true)).toBe(false);
    expect(quality.setTier('minimal')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The perf badge                                                             */
/* -------------------------------------------------------------------------- */

describe('performance badge', () => {
  it('mounts on the HUD overlay anchor, shows FPS and the tier, and takes no input', () => {
    const host = mountHost();
    const overlay = createHudOverlay({ host });
    const quality = createQualityTierSystem({ tier: 'calm' });

    const badge = createPerfBadge({ quality, doc: document });
    expect(badge.anchor).toBe(overlay.overlay);
    expect(overlay.overlay.contains(badge.root)).toBe(true);
    expect(badge.root.getAttribute('data-hud')).toBe(PERF_HUD_KEYS.badge);
    expect(badge.root.dataset.tier).toBe('calm');
    expect(badge.tier.textContent).toBe('CALM');
    expect(badge.fps.textContent).toBe('—');
    expect(document.querySelectorAll(`style[${PERF_STYLE_ATTRIBUTE}]`)).toHaveLength(1);

    // The badge itself never intercepts a gesture; its stress control does.
    expect(badge.root.style.pointerEvents).toBe('none');
    const button = badge.stressButton;
    expect(button).not.toBeNull();
    expect(button?.getAttribute('data-hud')).toBe('stress-toggle');
    expect(button?.style.pointerEvents).toBe('auto');
    expect(button?.getAttribute('aria-pressed')).toBe('false');

    // Live readout: feed one window of 12 ms frames.
    for (let sample = 0; sample < QUALITY_WINDOW_SIZE; sample += 1) quality.adaptive.observe(12);
    badge.update();
    expect(badge.fps.textContent).toBe('83');
    expect(badge.median.textContent).toBe('median 12.0 / 16.7 ms ✓');
    expect(badge.p95.textContent).toBe('p95 12.0 / 33.4 ms ✓');
    expect(badge.verdict.textContent).toBe('INSIDE BUDGET');
    expect(badge.verdict.dataset.verdict).toBe('held');
    expect(badge.rendered).toBeGreaterThan(0);

    // An over-budget window flips the verdict: the badge reports the budget
    // check the acceptance criteria are written against.
    for (let sample = 0; sample < QUALITY_WINDOW_SIZE; sample += 1) quality.adaptive.observe(40);
    badge.update();
    expect(badge.verdict.textContent).toBe('OVER BUDGET');
    expect(badge.median.textContent).toBe('median 40.0 / 16.7 ms ✗');

    // A tier change repaints the readout immediately.
    quality.setTier('minimal');
    badge.update();
    expect(badge.tier.textContent).toBe('MINIMAL');
    expect(badge.root.dataset.tier).toBe('minimal');

    // The mode chip discloses a pinned tier: the readout stays live while the
    // governor stops moving.
    expect(badge.mode.textContent).toBe('AUTO');
    quality.holdTier('calm');
    badge.update();
    expect(quality.tier).toBe('calm');
    expect(badge.mode.textContent).toBe('HELD');
    expect(badge.mode.dataset.hold).toBe('true');
    quality.holdTier(null);
    badge.update();
    expect(badge.mode.textContent).toBe('AUTO');

    // The acceptance control drives the governor's stress rig.
    button?.click();
    expect(quality.stressActive).toBe(true);
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.textContent).toBe('STRESS ON');
    button?.click();
    expect(quality.stressActive).toBe(false);
    expect(button?.getAttribute('aria-pressed')).toBe('false');

    badge.dispose();
    expect(overlay.overlay.contains(badge.root)).toBe(false);
    expect(document.querySelectorAll(`style[${PERF_STYLE_ATTRIBUTE}]`)).toHaveLength(0);
    badge.dispose();
    overlay.dispose();
  });

  it('falls back to a plain host when no HUD anchor exists', () => {
    const host = mountHost();
    const quality = createQualityTierSystem({ tier: 'calm' });
    const badge = createPerfBadge({ quality, doc: document, host });

    expect(badge.anchor).toBeNull();
    expect(host.contains(badge.root)).toBe(true);
    badge.dispose();
    expect(document.querySelector(`[data-hud="${PERF_HUD_KEYS.badge}"]`)).toBeNull();
  });

  it('refreshes on the fixed-step cadence and on every tier change', () => {
    const host = mountHost();
    const run = bootComposed({ load: 0, host });
    const system = run.bundle.perfBadge;
    driveFrames(run, 1);

    const badge = system.badge;
    expect(badge).not.toBeNull();
    const seen = system.updates;
    driveFrames(run, 12);
    expect(system.updates).toBeGreaterThan(seen);

    // A tier change repaints outside the cadence, so the readout never lags.
    run.bundle.quality.setTier('minimal');
    expect(badge?.tier.textContent).toBe('MINIMAL');
    expect(badge?.root.dataset.tier).toBe('minimal');
  });
});

/* -------------------------------------------------------------------------- */
/* Frame budget preview page                                                  */
/* -------------------------------------------------------------------------- */

describe('frame budget preview page', () => {
  it('runs the composed game with the governor, the badge and the tier controls', () => {
    const container = document.createElement('div');
    container.id = 'perf-preview';
    container.innerHTML = [
      '<div id="perf-readout" data-tier="calm"></div>',
      '<canvas id="perf-chart" width="200" height="60"></canvas>',
      '<button type="button" data-coroid-tier="minimal">Minimal</button>',
      '<button type="button" data-coroid-tier="boosted">Boosted</button>',
      '<button type="button" data-coroid-tier-hold="auto" aria-pressed="true">Auto</button>',
      '<button type="button" data-coroid-stress-toggle="true" aria-pressed="false">Stress rig: off</button>',
    ].join('');
    document.body.append(container);

    const preview = mountPerfPreview(container, { autoStart: false });
    try {
      const readout = container.querySelector<HTMLElement>('#perf-readout');
      const stress = container.querySelector<HTMLButtonElement>('[data-coroid-stress-toggle]');

      // The composed registry drives the page: calm by default, with the badge
      // hanging off the HUD overlay anchor inside the container.
      expect(preview.systems.quality.applied.tier).toBe('calm');
      expect(readout?.dataset.tier).toBe('calm');
      expect(readout?.textContent).toContain('CALM');
      expect(readout?.textContent).toContain('target');
      expect(container.querySelector(`[data-hud="${PERF_HUD_KEYS.badge}"]`)).not.toBeNull();

      // The page's controls go through the governor, not around it: a tier
      // button pins the tier so its presentation can be inspected.
      container.querySelector<HTMLButtonElement>('[data-coroid-tier="minimal"]')?.click();
      expect(preview.systems.quality.tier).toBe('minimal');
      expect(preview.systems.quality.holding).toBe(true);
      expect(readout?.dataset.tier).toBe('minimal');
      expect(readout?.dataset.mode).toBe('held');
      expect(preview.harness.adapter.pixelRatio).toBe(
        QUALITY_TIER_SETTINGS.minimal.pixelRatio,
      );

      // "Auto" hands the tier back to the governor.
      container.querySelector<HTMLButtonElement>('[data-coroid-tier-hold]')?.click();
      expect(preview.systems.quality.holding).toBe(false);
      expect(readout?.dataset.mode).toBe('auto');
      preview.systems.quality.holdTier('calm');
      expect(preview.systems.quality.tier).toBe('calm');

      stress?.click();
      expect(preview.systems.quality.stressActive).toBe(true);
      // Engaging the stress rig releases the pin: the run has to adapt.
      expect(preview.systems.quality.holding).toBe(false);
      expect(stress?.getAttribute('aria-pressed')).toBe('true');
      expect(stress?.textContent).toBe('Stress rig: on');
      expect(preview.systems.quality.rig?.count).toBeGreaterThan(0);
      expect(preview.systems.quality.applied.instanceCount).toBeGreaterThan(0);

      // The page-local chart is a picture of the budget, and it survives a host
      // without a 2D canvas.
      preview.chart.push(12.5);
      expect(preview.chart.last).toBe(12.5);
      expect(preview.chart.samples).toBe(1);
      preview.chart.draw();
      preview.refresh();
      expect(readout?.dataset.stress).toBe('on');
    } finally {
      preview.dispose();
    }

    expect(container.querySelector(`[data-hud="${PERF_HUD_KEYS.badge}"]`)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

describe('governor diagnostics', () => {
  it('stops climbing back into a tier that keeps failing', () => {
    const adaptive = createAdaptiveQuality({ tier: 'calm', window: QUALITY_WINDOW_SIZE });

    // First demotion from calm: it is recorded as a strike against calm.
    feedWindow(adaptive, 40);
    feedWindow(adaptive, 40);
    expect(adaptive.tier).toBe('minimal');
    expect(adaptive.strikes[QUALITY_TIER_RANK.calm]).toBe(1);

    // A strike doubles the headroom run calm needs: four windows are not enough…
    for (let window = 0; window < 4; window += 1) feedWindow(adaptive, 6);
    expect(adaptive.tier).toBe('minimal');
    expect(adaptive.decision.upgradeWindowsRequired).toBe(8);

    // …eight windows buy it back.
    for (let window = 0; window < 4; window += 1) feedWindow(adaptive, 6);
    expect(adaptive.tier).toBe('calm');

    // Failing again makes twelve windows the price, and a third failure
    // condemns the tier: sustained headroom no longer climbs onto it at all.
    feedWindow(adaptive, 40);
    feedWindow(adaptive, 40);
    expect(adaptive.tier).toBe('minimal');
    expect(adaptive.strikes[QUALITY_TIER_RANK.calm]).toBe(2);
    for (let window = 0; window < 12; window += 1) feedWindow(adaptive, 6);
    expect(adaptive.tier).toBe('calm');

    // A third failure condemns calm: sustained headroom no longer climbs onto
    // it, and the decision says so.
    feedWindow(adaptive, 40);
    feedWindow(adaptive, 40);
    expect(adaptive.tier).toBe('minimal');
    for (let window = 0; window < 10; window += 1) feedWindow(adaptive, 6);
    expect(adaptive.tier).toBe('minimal');
    expect(adaptive.strikes[QUALITY_TIER_RANK.calm]).toBe(3);
    expect(adaptive.decision.upgradeBlocked).toBe(true);
  });

  it('pins a tier for inspection while the measurement keeps running', () => {
    const adaptive = createAdaptiveQuality({ tier: 'calm', window: QUALITY_WINDOW_SIZE });
    adaptive.setHold(true);
    expect(adaptive.holding).toBe(true);

    // Sustained over-budget windows cannot move a pinned tier…
    for (let window = 0; window < 4; window += 1) feedWindow(adaptive, 120);
    expect(adaptive.tier).toBe('calm');
    expect(adaptive.changes).toBe(0);
    // …but the statistics keep updating, so the readout stays live.
    expect(adaptive.stats.samples).toBe(QUALITY_WINDOW_SIZE);
    expect(adaptive.stats.medianMs).toBe(120);
    expect(adaptive.stats.overBudget).toBe(true);

    // Releasing the pin hands the decision back to the governor from a clean
    // slate: one settle window, then the sustained overload sheds the tier.
    adaptive.setHold(false);
    expect(adaptive.holding).toBe(false);
    feedWindow(adaptive, 120);
    expect(adaptive.tier).toBe('calm');
    feedWindow(adaptive, 120);
    expect(adaptive.tier).toBe('minimal');
  });

  it('logs every tier handover and the first window that holds it', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((value) => String(value)).join(' '));
    });

    const governor = createQualityTierSystem({
      tier: 'calm',
      signals: {
        devicePixelRatio: 1,
        hardwareConcurrency: 8,
        reducedMotion: false,
        saveData: false,
      },
      stress: false,
    });
    const adapter = createHeadlessAdapter({ width: 640, height: 360 });
    const clock = createManualClock(0);
    const stepMs = 8;
    const load = 20;
    const game = createGame({ adapter, systems: [governor], clock, stepMs });
    openGames.push(game);

    for (let frame = 0; frame < QUALITY_WINDOW_SIZE * 3; frame += 1) {
      const frameMs = modelFrameMs(governor.applied, load, stepMs);
      clock.advance(frameMs);
      game.advance(frameMs);
    }
    expect(governor.tier).toBe('minimal');

    // The handover is reported with the window that caused it…
    const handover = lines.find((line) => line.includes('quality tier → minimal'));
    expect(handover).toBeTruthy();
    expect(handover).toContain('(over-budget)');
    expect(handover).toContain('pixel ratio 0.75');
    // …and the next whole window reports whether the new tier holds its budget.
    const holding = lines.find((line) => line.includes('quality holding minimal'));
    expect(holding).toBeTruthy();
    expect(holding).toContain('ms target ✓');
    expect(holding).toContain('ms ceiling ✓');
  });
});
