// @vitest-environment happy-dom
/**
 * Full-runtime composition test.
 *
 * This is the single integration point of the game: it proves that the shipped
 * system registry in `src/game/systems.ts` composes the whole product over the
 * fixed `createGame` runtime —
 *
 *  - every phase-2 and phase-3 module is instantiated, in the documented order,
 *    by the shipped registry a default `createGame` attaches;
 *  - the composed runtime boots headlessly (no WebGL), attaches once, steps the
 *    fixed loop through a scripted playthrough of mission one, renders a frame
 *    per step and mirrors the mission's domain events into the runtime state the
 *    world, the views, the HUD, the event log and the audio bus read;
 *  - player intents raised by the real input router drive the mission, the
 *    camera rig, the inspector and the audio bus;
 *  - disposing the game releases every system exactly once, the interface DOM,
 *    the listeners and the render adapter.
 *
 * Runs under happy-dom so the interface layer is real while every simulation
 * assertion goes through the headless adapter (no canvas, no GPU, no WebGL).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createGame, type Game } from '../src/game/Game';
import {
  createMissionInitialState,
  createSystems,
  getRegisteredSystems,
  systems as registry,
  type GameSystem,
  type GameSystems,
  type MissionSystem,
} from '../src/game/systems';
import { getMission } from '../src/content/missions';
import { createHeadlessAdapter } from '../src/render/headless';

/** Mission the composed game plays by default. */
const MISSION_KEY = 'request-to-plan';
/** Fixed simulation step the runtime and the mission share. */
const STEP_MS = 1000 / 60;

/**
 * Attachment order the registry promises.
 *
 * The ten module systems of phase 2 and 3 come first, in this order; the
 * fidelity governor (`render/quality-tiers`) and its readout (`ui/perf-badge`)
 * are appended after them, because the governor reads the adapter, the composed
 * scene and the world's post chain, and the badge mounts on the HUD overlay
 * anchor. See the composition contract in `src/game/systems.ts`.
 */
const EXPECTED_ORDER = [
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
  'render/quality-tiers',
  'ui/perf-badge',
] as const;

/**
 * sha256 of `src/game/Game.ts` as shipped by the foundation task.
 *
 * The runtime is closed for modification: this task composes the game by
 * populating the registry it consumes, so the guard fails loudly if the runtime
 * contract is ever edited instead.
 */
const RUNTIME_CONTRACT_SHA256 =
  '388ee647c37eb360adf1877287d338b7886273b3725addeb371158efa586619a';

/** One composed system plus the counters its runtime lifecycle is observed with. */
interface Instrumented {
  readonly wrapper: GameSystem;
  readonly counts: { attach: number; update: number; dispose: number };
}

/** Wrap a system so the test can see attach/update/dispose without touching it. */
function instrument(inner: GameSystem): Instrumented {
  const counts = { attach: 0, update: 0, dispose: 0 };
  const wrapper: GameSystem = {
    id: inner.id,
    attach(context): void {
      counts.attach += 1;
      inner.attach(context);
    },
    update(update): void {
      counts.update += 1;
      inner.update(update);
    },
    dispose(): void {
      counts.dispose += 1;
      inner.dispose();
    },
  };
  return { wrapper, counts };
}

const openGames: Game[] = [];

afterEach(() => {
  for (const game of openGames.splice(0)) game.dispose();
  document.body.innerHTML = '';
});

/** A host element for the interface layers. */
function mountHost(): HTMLElement {
  const host = document.createElement('div');
  host.id = 'integration-host';
  document.body.append(host);
  return host;
}

/** Press a key on the document, where the router's keyboard surface lives. */
function press(key: string): void {
  document.dispatchEvent(keyEvent(key));
}

/** Cancelable key event, so `preventDefault()` is observable in the test. */
function keyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
}

/** Play the mission to its terminal state in fixed slices of real time. */
function playToTerminal(game: Game, mission: MissionSystem, maxFrames = 9_000, sliceMs = 200): number {
  let frames = 0;
  while (mission.outcome === 'running' && frames < maxFrames) {
    game.advance(sliceMs);
    frames += 1;
  }
  return frames;
}

describe('composed game registry', () => {
  it('keeps the frozen runtime contract byte-identical', () => {
    // Vitest runs from the project root; read the shipped runtime straight off
    // disk instead of going through the module graph.
    const source = readFileSync(resolve(process.cwd(), 'src/game/Game.ts'));
    const digest = createHash('sha256').update(source).digest('hex');
    expect(
      digest,
      'src/game/Game.ts is closed for modification: compose the game in src/game/systems.ts',
    ).toBe(RUNTIME_CONTRACT_SHA256);
  });

  it('instantiates every phase-2 and phase-3 module in attachment order', () => {
    expect(registry.map((system) => system.id)).toEqual([...EXPECTED_ORDER]);
    expect(getRegisteredSystems()).toBe(registry);
    expect(new Set(registry.map((system) => system.id)).size).toBe(EXPECTED_ORDER.length);
    for (const system of registry) {
      expect(system.attach, system.id).toBeTypeOf('function');
      expect(system.update, system.id).toBeTypeOf('function');
      expect(system.dispose, system.id).toBeTypeOf('function');
    }
  });

  it('is what a default createGame attaches: the composed runtime boots and steps', () => {
    const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
    // No `systems` option: the runtime must compose the shipped registry itself.
    const game = createGame({
      adapter,
      state: createMissionInitialState(MISSION_KEY),
      stepMs: STEP_MS,
    });
    openGames.push(game);

    expect(game.systems.map((system) => system.id)).toEqual([...EXPECTED_ORDER]);
    expect(game.stats.systems).toBe(EXPECTED_ORDER.length);

    game.advance(500);
    // 500ms at a 60Hz step is 30 whole steps, less whatever the accumulator
    // cannot spend (floating-point step length): assert the range, not a point.
    expect(game.stats.steps).toBeGreaterThanOrEqual(29);
    expect(game.stats.steps).toBeLessThanOrEqual(30);
    expect(game.stats.frames).toBeGreaterThan(0);
    expect(adapter.frameCount).toBe(game.stats.frames);
    // The mission's own events reached the runtime state through the registry.
    expect(game.state.mission.status).not.toBe('bootstrapping');
    expect(game.state.plan.order.length).toBeGreaterThan(0);
  });
});

describe('composed game runtime', () => {
  it('plays mission one end to end, mirrors every slice and disposes each system once', () => {
    const mission = getMission(MISSION_KEY);
    expect(mission).toBeDefined();

    const bundle: GameSystems = createSystems();
    const instrumented = bundle.list.map(instrument);
    const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
    const host = mountHost();

    const game = createGame({
      adapter,
      systems: instrumented.map((entry) => entry.wrapper),
      state: createMissionInitialState(MISSION_KEY),
      seed: mission?.pacing.seed ?? 1,
      stepMs: STEP_MS,
    });
    openGames.push(game);

    // Attach: every system exactly once, and the interface mounted.
    for (const entry of instrumented) {
      expect(entry.counts.attach, entry.wrapper.id).toBe(1);
    }
    expect(bundle.cameraRig.rig).not.toBeNull();
    expect(bundle.planGraph.view).not.toBeNull();
    expect(bundle.hud.overlay).not.toBeNull();
    expect(bundle.panels.host).not.toBeNull();
    expect(bundle.audio.bus).not.toBeNull();
    expect(bundle.input.router).not.toBeNull();
    expect(bundle.input.router?.attachedListeners).toBeGreaterThan(0);
    expect(document.querySelector('[data-hud="root"]')).not.toBeNull();
    expect(document.querySelector('[data-hud="panel-layer"]')).not.toBeNull();

    // The composed mission boots into its running arc without a splash gate.
    const flow = bundle.mission.flow;
    expect(flow).not.toBeNull();
    expect(bundle.mission.phase).toBe('dispatch');

    const frames = playToTerminal(game, bundle.mission);
    expect(frames).toBeLessThan(9_000);
    expect(bundle.mission.outcome).toBe('won');
    expect(bundle.mission.phase).toBe('release');
    expect(flow?.snapshot().manifest.shipped).toBe(true);

    // The runtime state is the mission's own history: same tasks, gates,
    // metrics and economy, because the registry mirrors the flow's events.
    const missionState = flow?.state;
    expect(missionState).toBeDefined();
    expect(game.state.plan.order.length).toBe(missionState?.plan.order.length);
    expect(game.state.plan.order.length).toBeGreaterThanOrEqual(mission?.pacing.planTasks ?? 1);
    expect(game.state.verification.order.length).toBe(missionState?.verification.order.length);
    expect(game.state.quality.order.length).toBe(missionState?.quality.order.length);
    expect(game.state.economy.contextSpent).toBe(missionState?.economy.contextSpent);
    expect(game.state.mission.elapsedMs).toBeGreaterThan(0);
    expect(game.stats.frames).toBeGreaterThan(0);

    // The plan graph rendered the mission's own tasks and phase tiers.
    const view = bundle.planGraph.view;
    expect(view).not.toBeNull();
    expect(view?.count).toBeGreaterThanOrEqual(mission?.pacing.planTasks ?? 1);
    expect(view?.tiers.length).toBeGreaterThan(0);
    const firstTaskId = game.state.plan.order[0];
    expect(firstTaskId).toBeDefined();
    expect(view?.node(firstTaskId ?? '')).toBeTruthy();

    // The HUD reads the same snapshot: mission identity, live counters, lanes.
    const overlay = bundle.hud.overlay;
    expect(overlay?.query('codename')?.textContent).toBe(mission?.codename);
    expect(overlay?.query('mission-id')?.textContent).toBe(mission?.id);
    expect(overlay?.query('budget')?.textContent).not.toBe('—');
    expect(overlay?.query('credits')?.textContent).not.toBe('—');
    expect(overlay?.queryAll('lane').length).toBeGreaterThan(0);
    // The event-log terminal received the mission's domain events.
    expect(overlay?.query('event-log-lines')?.children.length).toBeGreaterThan(0);

    // The audio bus was subscribed to the runtime channel: with no WebAudio in
    // this environment every supplied cue is counted as suppressed, which can
    // only happen if the mission's events were delivered.
    expect(bundle.audio.bus?.stats.cuesSuppressed).toBeGreaterThan(0);

    const router = bundle.input.router;
    const panelHost = bundle.panels.host;

    // Teardown: each system once, then the DOM, listeners and adapter.
    game.dispose();
    for (const entry of instrumented) {
      expect(entry.counts.dispose, entry.wrapper.id).toBe(1);
      expect(entry.counts.update, entry.wrapper.id).toBeGreaterThan(0);
    }
    expect(game.disposed).toBe(true);
    expect(adapter.disposed).toBe(true);
    expect(router?.disposed).toBe(true);
    expect(router?.attachedListeners).toBe(0);
    expect(panelHost?.open).toBeNull();
    expect(document.querySelector('[data-hud="root"]')).toBeNull();
    expect(document.querySelector('[data-hud="panel-layer"]')).toBeNull();
    expect(bundle.hud.overlay).toBeNull();
    expect(bundle.panels.host).toBeNull();
    expect(bundle.audio.bus).toBeNull();
    expect(bundle.mission.flow).toBeNull();
    expect(bundle.planGraph.view).toBeNull();
    expect(bundle.input.router).toBeNull();

    // Disposal is idempotent: nothing is released twice.
    game.dispose();
    for (const entry of instrumented) {
      expect(entry.counts.dispose, entry.wrapper.id).toBe(1);
    }
    void host;
  });
});

describe('composed game input wiring', () => {
  it('routes player intents to the mission, the camera, the inspector and the audio', () => {
    const host = mountHost();
    const canvas = document.createElement('canvas');
    host.append(canvas);

    const bundle = createSystems({
      canvas,
      interfaceHost: host,
      // The human-gated arc: nothing runs until the player approves.
      autoStart: false,
      autoApprove: false,
    });
    const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
    const game = createGame({
      adapter,
      systems: [...bundle.list],
      state: createMissionInitialState(MISSION_KEY),
      stepMs: STEP_MS,
    });
    openGames.push(game);

    const rig = bundle.cameraRig.rig;
    const router = bundle.input.router;
    expect(rig).not.toBeNull();
    expect(router).not.toBeNull();
    expect(bundle.mission.phase).toBe('brief');
    expect(rig?.state).toBe('brief');

    // The human gate: `A` (approve) acknowledges the brief, then approves the
    // plan, and the mission's phase changes fly the camera with it — the phase
    // hook runs on the fixed step that follows the intent.
    press('a');
    expect(bundle.mission.phase).toBe('approve');
    game.advance(20);
    expect(rig?.state).toBe('plan');
    press('a');
    expect(bundle.mission.phase).toBe('dispatch');
    game.advance(20);
    expect(rig?.state).toBe('execute');

    game.advance(200);
    expect(game.state.plan.order.length).toBeGreaterThan(0);
    expect(game.state.plan.order.length).toBe(bundle.mission.flow?.state.plan.order.length);

    // Dispatch: with a task focused, `D` is consumed by the router and reaches
    // the mission (which acknowledges the tutorial step it is waiting on).
    expect(router?.stepFocus(1)).toBe(true);
    const focused = router?.focusedTaskId;
    expect(focused).toBeTruthy();
    const dispatchKey = keyEvent('d');
    expect(router?.handleKey(dispatchKey)).toBe(true);
    expect(dispatchKey.defaultPrevented).toBe(true);

    // Camera input drives the rig through the router: keyboard nudge and a
    // pointer drag both move the orbit target the damping follows.
    const nudgedFrom = rig?.target.azimuth ?? 0;
    press('ArrowLeft');
    expect(rig?.target.azimuth).not.toBe(nudgedFrom);

    const draggedFrom = rig?.target.azimuth ?? 0;
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 220, clientY: 140, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: 220, clientY: 140, bubbles: true }));
    expect(rig?.target.azimuth).not.toBe(draggedFrom);
    game.advance(200);

    // The first gesture also asked the audio bus to unlock and cued the click.
    expect(bundle.audio.bus?.stats.cuesSuppressed).toBeGreaterThan(0);

    // Panels: `I` opens the inspector on the HUD's contract, and the keyboard
    // cursor moves the graph's selection, which lands in the inspector.
    press('i');
    expect(bundle.panels.host?.open).toBe('inspector');
    press('.');
    const selected = bundle.panels.host?.selectedTaskId;
    expect(selected).toBeTruthy();
    expect(bundle.planGraph.view?.selectedTaskId).toBe(selected);
    game.advance(200);

    // The inspector renders the execution contract the mission registered —
    // read/write sets and checks the runtime state alone does not carry.
    const contract = bundle.mission.contracts()[selected ?? ''];
    expect(contract).toBeDefined();
    const inspector = bundle.panels.host?.panelElement('inspector');
    expect(inspector?.querySelector('[data-hud="inspector-task-id"]')?.textContent).toBe(selected);
    expect(inspector?.textContent).toContain(`Read set (${contract?.readSet?.length ?? 0})`);
    expect(inspector?.textContent).toContain(`Write set (${contract?.writeSet?.length ?? 0})`);

    // Picking results reach the inspector through the same contract: a programmatic
    // pick at the canvas corner either resolves a node or clears the subject.
    const pick = router?.pickAt(4, 4);
    expect(pick?.type).toBe('pick');
    expect(bundle.panels.host?.selectedTaskId).toBe(pick?.taskId ?? null);

    // A modal panel owns the keyboard: the router yields while it is open.
    expect(router?.handleKey(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))).toBe(false);
    press('Escape');
    expect(bundle.panels.host?.open).toBeNull();

    game.dispose();
  });
});
