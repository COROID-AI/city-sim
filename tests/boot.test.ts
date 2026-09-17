// @vitest-environment happy-dom
/**
 * Runtime boot smoke test.
 *
 * Proves the composition contract end to end without a GPU:
 *  - `createGame` instantiates with the headless adapter, attaches the systems it
 *    is given (including the live registry), advances fixed steps, renders
 *    through the adapter and disposes every system and the adapter exactly once;
 *  - the fixed-step loop is accumulator-driven, clock-injectable and seeded;
 *  - the boot scene mounts a full-viewport canvas and renders the empty
 *    holographic factory floor.
 *
 * Runs under happy-dom so the DOM-level assertions are real, while every
 * simulation assertion still goes through the headless adapter (no canvas, no
 * WebGL context).
 */

import { Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootGame, BOOT_SCENE_NAMES, FLOOR_SIZE } from '../src/main';
import { createGame, type Game, type GameFrame } from '../src/game/Game';
import {
  getRegisteredSystems,
  registerSystem,
  systems as systemRegistry,
  unregisterSystem,
  type GameSystem,
  type SystemContext,
  type SystemUpdate,
} from '../src/game/systems';
import { createFixedStepLoop, createManualClock, createRng, type FrameContext, type StepContext } from '../src/game/loop';
import { createHeadlessAdapter } from '../src/render/headless';
import { createRenderAdapter, supportsWebGL } from '../src/render/renderer';
import { createSampleState, SAMPLE_SEED } from '../src/sim/fixtures';
import { makeDomainEvent } from '../src/sim/state';

const STEP_MS = 10;

interface SystemRecord {
  attach: number;
  update: number;
  dispose: number;
  contexts: SystemContext[];
  updates: SystemUpdate[];
  alphaFreeState: boolean[];
}

function createRecordingSystem(
  id: string,
  hooks: { onUpdate?: (update: SystemUpdate) => void } = {},
): { system: GameSystem; record: SystemRecord } {
  const record: SystemRecord = {
    attach: 0,
    update: 0,
    dispose: 0,
    contexts: [],
    updates: [],
    alphaFreeState: [],
  };
  const system: GameSystem = {
    id,
    attach(context: SystemContext): void {
      record.attach += 1;
      record.contexts.push(context);
    },
    update(update: SystemUpdate): void {
      record.update += 1;
      record.updates.push(update);
      record.alphaFreeState.push(Object.isFrozen(update.state));
      hooks.onUpdate?.(update);
    },
    dispose(): void {
      record.dispose += 1;
    },
  };
  return { system, record };
}

function createRngProbeSystem(): GameSystem {
  return {
    id: 'rng-probe',
    attach(): void {},
    update(update: SystemUpdate): void {
      update.context.events.emit(
        makeDomainEvent(
          'quality/measured',
          {
            metric: {
              id: 'metric-rng',
              label: 'rng',
              value: update.context.rng.next(),
              target: 1,
              weight: 1,
            },
          },
          update.elapsedMs,
        ),
      );
    },
    dispose(): void {},
  };
}

const openGames: Game[] = [];

afterEach(() => {
  for (const game of openGames.splice(0)) {
    game.dispose();
  }
  document.body.innerHTML = '';
});

describe('headless render adapter', () => {
  it('satisfies the render adapter contract with no canvas or GPU', () => {
    const adapter = createHeadlessAdapter({ width: 800, height: 600 });

    expect(adapter.kind).toBe('headless');
    expect(adapter.canvas).toBeNull();
    expect(adapter.scene).toBeInstanceOf(Scene);
    expect(adapter.frameCount).toBe(0);

    adapter.resize(1024, 512);
    expect([adapter.width, adapter.height]).toEqual([1024, 512]);
    expect(adapter.camera.aspect).toBeCloseTo(2, 6);

    adapter.render(0.25);
    adapter.render(0.5);
    expect(adapter.frameCount).toBe(2);
    expect(adapter.stats.frames).toBe(2);

    adapter.dispose();
    expect(adapter.disposed).toBe(true);
    adapter.render(0);
    expect(adapter.frameCount).toBe(2);
    adapter.dispose();
    expect(adapter.disposed).toBe(true);
  });

  it('reports WebGL as unavailable and refuses a WebGL adapter without a context', () => {
    expect(supportsWebGL()).toBe(false);
    expect(() => createRenderAdapter({ width: 320, height: 240 })).toThrow(/WebGL/i);
  });
});

describe('createGame runtime', () => {
  it('keeps the shipped system registry empty and drives whatever it contains', () => {
    expect(systemRegistry).toHaveLength(0);
    expect(getRegisteredSystems()).toHaveLength(0);

    const { system, record } = createRecordingSystem('registered-probe');
    registerSystem(system);
    try {
      const adapter = createHeadlessAdapter();
      const game = createGame({ adapter, stepMs: STEP_MS });
      openGames.push(game);

      expect(getRegisteredSystems()).toHaveLength(1);
      expect(game.systems.map((entry) => entry.id)).toEqual(['registered-probe']);
      expect(record.attach).toBe(1);

      game.advance(STEP_MS);
      expect(record.update).toBe(1);
    } finally {
      unregisterSystem(system);
    }
  });

  it('attaches systems once with the adapter scene, then advances fixed steps and renders', () => {
    const adapter = createHeadlessAdapter({ width: 640, height: 360 });
    const first = createRecordingSystem('first');
    const second = createRecordingSystem('second');
    const frames: GameFrame[] = [];

    const game = createGame({
      adapter,
      systems: [first.system, second.system],
      state: createSampleState(11),
      seed: 11,
      stepMs: STEP_MS,
      onFrame: (frame) => frames.push({ ...frame }),
    });
    openGames.push(game);

    // Attach: once per system, with the adapter's scene as the render root.
    expect(first.record.attach).toBe(1);
    expect(second.record.attach).toBe(1);
    expect(first.record.contexts[0]?.scene).toBe(adapter.scene);
    expect(first.record.contexts[0]?.camera).toBe(adapter.camera);
    expect(first.record.contexts[0]?.adapter).toBe(adapter);
    expect(first.record.contexts[0]?.stepMs).toBe(STEP_MS);
    expect(first.record.contexts[0]?.seed).toBe(11);
    expect(first.record.contexts[0]?.rng).toBe(second.record.contexts[0]?.rng);

    // Advance: 35ms at a 10ms step is 3 whole steps plus a 5ms remainder.
    const executed = game.advance(35);
    expect(executed).toBe(3);
    expect(game.stats.steps).toBe(3);
    expect(first.record.update).toBe(3);
    expect(second.record.update).toBe(3);
    expect(first.record.updates.map((update) => update.step)).toEqual([1, 2, 3]);
    expect(first.record.updates[1]?.deltaMs).toBe(STEP_MS);
    expect(first.record.updates[2]?.elapsedMs).toBe(30);
    expect(first.record.alphaFreeState.every(Boolean)).toBe(true);

    // Each advance suggests exactly one frame, with the draw-time alpha only.
    expect(frames).toHaveLength(1);
    expect(frames[0]?.steps).toBe(3);
    expect(frames[0]?.totalSteps).toBe(3);
    expect(frames[0]?.alpha).toBeCloseTo(0.5, 6);
    expect(game.stats.frames).toBe(1);
    expect(adapter.frameCount).toBe(1);

    // Interpolation happens at draw time, not in the simulation: a delta too
    // small for another step still paints a frame with a fresh alpha.
    game.advance(2);
    expect(game.stats.steps).toBe(3);
    expect(game.stats.frames).toBe(2);
    expect(frames[1]?.alpha).toBeCloseTo(0.7, 6);
    expect(first.record.update).toBe(3);
  });

  it('reduces events emitted by systems into state within the same step', () => {
    const adapter = createHeadlessAdapter();
    const emitter = createRecordingSystem('emitter', {
      onUpdate: (update) => {
        update.context.events.emit(
          makeDomainEvent(
            'quality/measured',
            { metric: { id: 'metric-holo', label: 'Hologram', value: 0.75, target: 1, weight: 1 } },
            update.elapsedMs,
          ),
        );
      },
    });

    const game = createGame({
      adapter,
      systems: [emitter.system],
      state: createSampleState(3),
      stepMs: STEP_MS,
    });
    openGames.push(game);

    const revisionBefore = game.stats.revision;
    game.advance(STEP_MS);

    expect(game.state.quality.metrics['metric-holo']?.value).toBe(0.75);
    expect(game.stats.revision).toBe(revisionBefore + 1);
    expect(game.stats.pendingEvents).toBe(0);
    expect(Object.isFrozen(game.state)).toBe(true);
  });

  it('queues events emitted outside a step until the next step boundary', () => {
    const adapter = createHeadlessAdapter();
    const game = createGame({ adapter, systems: [], state: createSampleState(5), stepMs: STEP_MS });
    openGames.push(game);

    game.emit(makeDomainEvent('mission/status', { status: 'delivering' }, 500));
    expect(game.stats.pendingEvents).toBe(1);
    expect(game.state.mission.status).toBe('running');

    game.commit();
    expect(game.stats.pendingEvents).toBe(0);
    expect(game.state.mission.status).toBe('delivering');
  });

  it('produces identical runs for identical seeds and step schedules', () => {
    const runOnce = (seed: number) => {
      const adapter = createHeadlessAdapter();
      const game = createGame({
        adapter,
        systems: [createRngProbeSystem()],
        state: createSampleState(seed),
        seed,
        stepMs: STEP_MS,
      });
      game.advance(STEP_MS * 4);
      const result = {
        metric: game.state.quality.metrics['metric-rng']?.value,
        revision: game.stats.revision,
        status: game.state.mission.status,
      };
      game.dispose();
      return result;
    };

    const first = runOnce(99);
    const second = runOnce(99);
    const other = runOnce(100);

    expect(second).toEqual(first);
    expect(first.metric).toBeDefined();
    expect(other.metric).not.toBe(first.metric);
  });

  it('rejects duplicate system ids and already disposed adapters', () => {
    const adapter = createHeadlessAdapter();
    const duplicate = createRecordingSystem('same-id');
    expect(() =>
      createGame({ adapter, systems: [duplicate.system, createRecordingSystem('same-id').system] }),
    ).toThrow(/duplicate system id/i);

    const closed = createHeadlessAdapter();
    closed.dispose();
    expect(() => createGame({ adapter: closed })).toThrow(/already disposed/i);
  });

  it('disposes every system and the adapter exactly once', () => {
    const adapter = createHeadlessAdapter();
    const first = createRecordingSystem('first');
    const second = createRecordingSystem('second');
    const game = createGame({
      adapter,
      systems: [first.system, second.system],
      stepMs: STEP_MS,
    });

    const seen: string[] = [];
    const originalDispose = second.system.dispose;
    second.system.dispose = (): void => {
      seen.push('second');
      originalDispose.call(second.system);
    };

    game.dispose();
    game.dispose();

    expect(first.record.dispose).toBe(1);
    expect(second.record.dispose).toBe(1);
    expect(seen).toEqual(['second']);
    expect(adapter.disposed).toBe(true);
    expect(game.disposed).toBe(true);

    // A disposed game is inert rather than half-alive.
    expect(game.advance(100)).toBe(0);
    game.stop();
    game.start();
    expect(game.stats.steps).toBe(0);
    expect(first.record.update).toBe(0);
  });

  it('keeps disposing the remaining systems when one throws', () => {
    const adapter = createHeadlessAdapter();
    const healthy = createRecordingSystem('healthy');
    const broken: GameSystem = {
      id: 'broken',
      attach(): void {},
      update(): void {},
      dispose(): void {
        throw new Error('teardown exploded');
      },
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const game = createGame({ adapter, systems: [healthy.system, broken], stepMs: STEP_MS });
    game.dispose();

    expect(healthy.record.dispose).toBe(1);
    expect(adapter.disposed).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('fixed-step loop', () => {
  it('spends whole steps from the accumulator and clamps runaway frames', () => {
    const steps: StepContext[] = [];
    const loop = createFixedStepLoop({
      clock: createManualClock(0),
      stepMs: 10,
      maxStepsPerFrame: 5,
      onStep: (step) => steps.push(step),
    });

    expect(loop.advance(35)).toBe(3);
    expect(loop.steps).toBe(3);
    expect(loop.elapsedMs).toBe(30);
    expect(loop.accumulator).toBeCloseTo(5, 6);

    expect(loop.advance(1_000)).toBe(5);
    expect(loop.steps).toBe(8);
    expect(loop.accumulator).toBeLessThan(10);
    expect(steps).toHaveLength(8);
    expect(steps[0]?.step).toBe(1);
    expect(loop.frames).toBe(2);

    loop.reset();
    expect([loop.steps, loop.frames, loop.accumulator, loop.elapsedMs]).toEqual([0, 0, 0, 0]);
    loop.dispose();
    expect(loop.disposed).toBe(true);
  });

  it('drives real-time playback from the injected clock', () => {
    const clock = createManualClock(0);
    const steps: StepContext[] = [];
    const frames: FrameContext[] = [];
    const loop = createFixedStepLoop({
      clock,
      stepMs: 20,
      onStep: (step) => steps.push(step),
      onFrame: (frame) => frames.push(frame),
    });

    loop.start();
    expect(loop.running).toBe(true);
    clock.advance(55);
    loop.tick();
    loop.stop();
    expect(loop.running).toBe(false);

    expect(steps).toHaveLength(2);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.alpha).toBeCloseTo(0.75, 6);
    expect(loop.dispose).toBeTypeOf('function');
    loop.dispose();
  });

  it('derives a deterministic random stream from its seed', () => {
    const a = createRng('coroid');
    const b = createRng('coroid');
    const c = createRng('coroid-2');

    const draw = (rng: ReturnType<typeof createRng>): number[] => [
      rng.next(),
      rng.next(),
      rng.int(0, 100),
    ];

    expect(draw(b)).toEqual(draw(a));
    expect(draw(c)).not.toEqual(draw(a));

    a.reset();
    expect(a.next()).toBe(createRng('coroid').next());
    expect(createRng(7).peek()).toBe(createRng(7).peek());
  });
});

describe('boot scene', () => {
  it('mounts a full-viewport canvas and renders the empty holographic floor', () => {
    const host = document.createElement('div');
    document.body.append(host);

    const boot = bootGame({ host, seed: SAMPLE_SEED, autoStart: false });
    const { harness, scene } = boot;

    // Canvas mounts inside the host and fills it.
    expect(host.contains(harness.canvas)).toBe(true);
    expect(harness.canvas.className).toBe('boot-canvas');
    expect(harness.canvas.dataset.coroidCanvas).toBe('true');
    expect(harness.adapter.width).toBeGreaterThan(0);
    expect(harness.adapter.height).toBeGreaterThan(0);

    // happy-dom provides no WebGL context, so the harness falls back cleanly.
    expect(harness.adapter.kind).toBe('headless');
    expect(harness.usedHeadlessFallback).toBe(true);

    // The floor exists, is named, and is empty of gameplay: the shipped registry
    // contributes no systems, so the boot scene is all there is.
    expect(scene.root.name).toBe(BOOT_SCENE_NAMES.root);
    expect(scene.root.parent).toBe(harness.adapter.scene);
    expect(scene.floorSize).toBe(FLOOR_SIZE);
    for (const name of [
      BOOT_SCENE_NAMES.plate,
      BOOT_SCENE_NAMES.grid,
      BOOT_SCENE_NAMES.subgrid,
      BOOT_SCENE_NAMES.emitter,
      BOOT_SCENE_NAMES.column,
      BOOT_SCENE_NAMES.pillars,
      BOOT_SCENE_NAMES.lights,
      `${BOOT_SCENE_NAMES.rings}-0`,
      `${BOOT_SCENE_NAMES.rings}-1`,
    ]) {
      expect(scene.root.getObjectByName(name), name).toBeTruthy();
    }
    expect(systemRegistry).toHaveLength(0);
    expect(harness.game.systems).toHaveLength(0);

    // The HUD reports the run, and the shell is marked live after frame one.
    expect(harness.overlay?.element.textContent).toContain('COROID');
    expect(host.classList.contains('is-live')).toBe(true);

    // Rendering: the boot reset painted once, then fixed-step advances keep painting.
    const painted = harness.adapter.frameCount;
    const steps = harness.game.advance(50);
    expect(steps).toBeGreaterThan(0);
    expect(harness.adapter.frameCount).toBe(painted + 1);
    expect(harness.game.stats.steps).toBe(steps);

    // Teardown releases the scene, the harness and the DOM it created.
    boot.dispose();
    expect(scene.disposed).toBe(true);
    expect(harness.disposed).toBe(true);
    expect(host.querySelector('canvas')).toBeNull();
    expect(host.querySelector('.preview-overlay')).toBeNull();
    expect(scene.root.children).toHaveLength(0);
    expect(scene.root.parent).toBeNull();
  });

  it('animates the hologram purely as a function of simulated time', () => {
    const host = document.createElement('div');
    document.body.append(host);

    const boot = bootGame({ host, autoStart: false });
    const rings = boot.scene.root.getObjectByName(`${BOOT_SCENE_NAMES.rings}-1`);
    const before = rings?.rotation.z ?? Number.NaN;

    boot.scene.update(6_000);
    const after = rings?.rotation.z ?? Number.NaN;
    boot.scene.update(0);
    const rewound = rings?.rotation.z ?? Number.NaN;

    expect(after).not.toBe(before);
    expect(rewound).toBeCloseTo(before, 9);

    boot.dispose();
  });
});
