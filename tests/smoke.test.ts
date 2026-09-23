/**
 * Chrono City — foundation smoke suite.
 *
 * Covers the contracts every later task builds on:
 *  - the SceneContext tick registry dispatches every registered system per frame
 *  - deterministic RNG + viewport handling on the shared context
 *  - the five-value EraId contract and the EraBlendable tween hooks
 *  - the BlockLayout geometry constants consumed by navigation/traffic systems
 *  - the live boot path that publishes `window.__chronoCity`
 *
 * The suite runs in jsdom with a stubbed renderer, so no GPU is required.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  BLOCK,
  BLOCK_DEPTH,
  BLOCK_HALF_DEPTH,
  BLOCK_HALF_WIDTH,
  BLOCK_LAYOUT_VERSION,
  BLOCK_WIDTH,
  BlockLayout,
  CELL,
  CROSSWALK_ANCHORS,
  CROSSWALK_WIDTH,
  ROAD_WIDTH,
  ROADS,
  SIDEWALK,
  SIDEWALK_LOOP,
  SIDEWALK_LOOP_LENGTH,
  isInsideBlock,
  isOnCrosswalk,
  isOnRoad,
  isOnSidewalk,
  lanePoint,
  pointOnSidewalkLoop,
} from '../src/core/blockLayout';
import {
  DEFAULT_ERA,
  ERA_CONTRACTS_VERSION,
  ERA_IDS,
  EraContracts,
  assertEraId,
  clamp01,
  eraIndex,
  eraYear,
  isEraId,
  nextEra,
  previousEra,
  smoothStep01,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../src/core/eraContracts';
import {
  DEFAULT_SEED,
  SceneClock,
  SeededRandom,
  SceneContext,
  createSceneContext,
  createSceneContextApp,
  integrateSceneContextGlobal,
  type SceneContextOptions,
} from '../src/core/sceneContext';
import { bootChronoCity, getChronoCity, stopChronoCity } from '../src/main';

/* ------------------------------------------------------------------ */
/* Renderer stub                                                       */
/* ------------------------------------------------------------------ */

interface StubRenderer {
  renderer: THREE.WebGLRenderer;
  setSizeCalls: Array<[number, number]>;
  pixelRatios: number[];
  renderCount(): number;
  disposeCount(): number;
  hasAnimationLoop(): boolean;
  runFrame(): void;
}

function createStubRenderer(canvas: HTMLCanvasElement): StubRenderer {
  const setSizeCalls: Array<[number, number]> = [];
  const pixelRatios: number[] = [];
  let renders = 0;
  let disposals = 0;
  let loop: (() => void) | null = null;

  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    setPixelRatio: (value: number) => {
      pixelRatios.push(value);
    },
    setSize: (width: number, height: number) => {
      setSizeCalls.push([width, height]);
    },
    render: () => {
      renders += 1;
    },
    setAnimationLoop: (callback: (() => void) | null) => {
      loop = callback;
    },
    dispose: () => {
      disposals += 1;
    },
  };

  return {
    renderer: stub as unknown as THREE.WebGLRenderer,
    setSizeCalls,
    pixelRatios,
    renderCount: () => renders,
    disposeCount: () => disposals,
    hasAnimationLoop: () => loop !== null,
    runFrame: () => loop?.(),
  };
}

interface TestContext {
  context: SceneContext;
  stub: StubRenderer;
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  overlayRoot: HTMLElement;
}

function createTestContext(options: SceneContextOptions = {}): TestContext {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const canvas = document.createElement('canvas');
  const overlayRoot = document.createElement('div');
  container.appendChild(overlayRoot);

  const stub = createStubRenderer(canvas);
  const context = createSceneContext({
    canvas,
    container,
    overlayRoot,
    seed: 1234,
    autoResize: false,
    autoStart: false,
    maxPixelRatio: 1.5,
    createRenderer: () => stub.renderer,
    ...options,
  });

  return { context, stub, canvas, container, overlayRoot };
}

const openContexts: TestContext[] = [];

afterEach(() => {
  while (openContexts.length > 0) {
    openContexts.pop()?.context.dispose();
  }
  stopChronoCity();
  document.body.replaceChildren();
});

function openTestContext(options: SceneContextOptions = {}): TestContext {
  const harness = createTestContext(options);
  openContexts.push(harness);
  return harness;
}

/* ------------------------------------------------------------------ */
/* SceneContext                                                        */
/* ------------------------------------------------------------------ */

describe('SceneContext', () => {
  it('exposes the shared stage, camera, clock, RNG and overlay root', () => {
    const { context, stub, overlayRoot } = openTestContext();

    expect(context.renderer).toBe(stub.renderer);
    expect(context.scene).toBeInstanceOf(THREE.Scene);
    expect(context.camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(context.clock).toBeInstanceOf(SceneClock);
    expect(context.overlayRoot).toBe(overlayRoot);
    expect(context.canvas.classList.contains('chrono-canvas')).toBe(true);
    expect(context.version).toBe(1);

    // Seeded RNG: the context stream is reproducible from its seed.
    expect(context.seed).toBe(1234);
    expect(context.random.next()).toBe(new SeededRandom(1234).next());
    // Device pixel ratio is clamped to the requested maximum.
    expect(stub.pixelRatios).toEqual([Math.min(window.devicePixelRatio, 1.5)]);
    expect(context.camera.aspect).toBeGreaterThan(0);
  });

  it('measures frame time with the shared clock', async () => {
    const { context } = openTestContext();

    expect(context.clock).toBeInstanceOf(SceneClock);
    expect(context.clock.running).toBe(true);
    expect(context.clock.getDelta()).toBeGreaterThanOrEqual(0);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(context.clock.getDelta()).toBeGreaterThan(0);
    expect(context.clock.getElapsedTime()).toBeGreaterThan(0);

    context.clock.stop();
    expect(context.clock.running).toBe(false);
    expect(context.clock.getDelta()).toBe(0);
    expect(context.clock.start().running).toBe(true);
  });

  it('dispatches every registered system once per frame, in order', () => {
    const { context } = openTestContext();
    const calls: string[] = [];

    context.registerSystem('alpha', (_ctx, frame) => calls.push(`alpha:${frame.frame}`), {
      order: 10,
    });
    context.registerSystem('beta', (_ctx, frame) => calls.push(`beta:${frame.frame}`), {
      order: -5,
    });
    context.registerSystem('gamma', (_ctx, frame) => calls.push(`gamma:${frame.frame}`));

    expect(context.systemCount).toBe(3);

    const first = context.tick(0.5);
    expect(calls).toEqual(['beta:0', 'gamma:0', 'alpha:0']);
    expect(first.delta).toBe(0.5);
    expect(first.elapsed).toBeCloseTo(0.5, 5);

    context.tick(0.25);
    expect(calls).toHaveLength(6);
    expect(calls.slice(3)).toEqual(['beta:1', 'gamma:1', 'alpha:1']);
    expect(context.frameCount).toBe(2);
    expect(context.elapsed).toBeCloseTo(0.75, 5);
  });

  it('skips paused systems and unregisters disposed ones', () => {
    const { context } = openTestContext();
    const calls: string[] = [];

    const probe = context.registerSystem('probe', () => calls.push('probe'));
    context.registerSystem('steady', () => calls.push('steady'));

    // Equal order values keep registration order: probe was registered first.
    context.tick();
    expect(calls).toEqual(['probe', 'steady']);

    calls.length = 0;
    probe.setEnabled(false);
    context.tick();
    expect(calls).toEqual(['steady']);

    calls.length = 0;
    probe.setEnabled(true);
    probe.dispose();
    context.tick();
    expect(calls).toEqual(['steady']);
    expect(context.hasSystem('probe')).toBe(false);
    expect(context.unregisterSystem('probe')).toBe(false);
  });

  it('rejects duplicate ids and reports registry contents', () => {
    const { context } = openTestContext();
    context.registerSystem('city-time', () => undefined, { order: 2 });

    expect(context.hasSystem('city-time')).toBe(true);
    expect(context.getSystem('city-time')?.order).toBe(2);
    expect(() => context.registerSystem('city-time', () => undefined)).toThrow(/already registered/);
    expect(context.getSystems().map((system) => system.id)).toEqual(['city-time']);

    context.clearSystems();
    expect(context.systemCount).toBe(0);
  });

  it('isolates a throwing system from the rest of the frame', () => {
    const { context } = openTestContext();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const calls: string[] = [];

    context.registerSystem('broken', () => {
      throw new Error('boom');
    }, { order: -1 });
    context.registerSystem('healthy', () => calls.push('healthy'));

    expect(() => context.tick(0.1)).not.toThrow();
    expect(calls).toEqual(['healthy']);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('renders every animation frame once started', () => {
    const { context, stub } = openTestContext();
    const frames: number[] = [];
    context.registerSystem('probe', (_ctx, frame) => frames.push(frame.frame));

    context.start();
    expect(context.isRunning).toBe(true);
    expect(stub.hasAnimationLoop()).toBe(true);

    stub.runFrame();
    stub.runFrame();

    expect(frames).toEqual([0, 1]);
    expect(stub.renderCount()).toBe(2);

    context.stop();
    expect(context.isRunning).toBe(false);
    expect(stub.hasAnimationLoop()).toBe(false);
  });

  it('resizes the renderer and camera together', () => {
    const { context, stub } = openTestContext();

    const size = context.resize(800, 400);

    expect(size).toEqual({ width: 800, height: 400 });
    expect(context.viewport).toEqual({ width: 800, height: 400 });
    expect(context.camera.aspect).toBeCloseTo(2, 5);
    expect(stub.setSizeCalls.at(-1)).toEqual([800, 400]);
  });

  it('releases the renderer and clears systems on dispose', () => {
    const { context, stub } = openTestContext();
    context.registerSystem('probe', () => undefined);

    context.dispose();

    expect(context.isDisposed).toBe(true);
    expect(stub.disposeCount()).toBe(1);
    expect(stub.hasAnimationLoop()).toBe(false);
    expect(context.systemCount).toBe(0);
    expect(() => context.registerSystem('late', () => undefined)).toThrow(/disposed/);
  });

  it('publishes the live app handle on window', () => {
    const { context } = openTestContext();
    const app = createSceneContextApp({ createRenderer: () => context.renderer as never });

    integrateSceneContextGlobal(app);
    expect(window.__chronoCity).toBe(app);
    expect(window.__chronoCity?.seed).toBe(DEFAULT_SEED);

    app.dispose();
    delete window.__chronoCity;
  });
});

/* ------------------------------------------------------------------ */
/* Seeded random source                                                */
/* ------------------------------------------------------------------ */

describe('SeededRandom', () => {
  it('is deterministic for a given seed and resettable', () => {
    const left = new SeededRandom(DEFAULT_SEED);
    const right = new SeededRandom(DEFAULT_SEED);

    const leftSeries = Array.from({ length: 8 }, () => left.next());
    const rightSeries = Array.from({ length: 8 }, () => right.next());
    expect(leftSeries).toEqual(rightSeries);

    left.reset();
    expect(left.next()).toBe(leftSeries[0]);
  });

  it('keeps every helper inside its documented range', () => {
    const rng = new SeededRandom(7);

    for (let index = 0; index < 200; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);

      const integer = rng.int(3, 6);
      expect(Number.isInteger(integer)).toBe(true);
      expect(integer).toBeGreaterThanOrEqual(3);
      expect(integer).toBeLessThanOrEqual(6);

      const floated = rng.float(-2, -1);
      expect(floated).toBeGreaterThanOrEqual(-2);
      expect(floated).toBeLessThan(-1);
    }

    expect(rng.pick(['only'])).toBe('only');
    expect(() => rng.pick([])).toThrow(/non-empty/);
    expect(new Set(rng.shuffle([1, 2, 3, 4, 5])).size).toBe(5);
  });

  it('forks stable, independent sub-streams', () => {
    const parent = new SeededRandom(99);
    const roads = parent.fork('roads');
    const roadsAgain = parent.fork('roads');
    const people = parent.fork('people');

    expect(roads.next()).toBe(roadsAgain.next());
    expect(roads.next()).not.toBe(people.next());
  });
});

/* ------------------------------------------------------------------ */
/* Era contracts                                                       */
/* ------------------------------------------------------------------ */

describe('EraContracts', () => {
  it('defines exactly the five canonical eras', () => {
    expect(ERA_IDS).toEqual(['1945', '1965', '1985', '2005', '2025']);
    expect(new Set(ERA_IDS).size).toBe(5);
    expect(ERA_IDS).toHaveLength(5);
    expect(EraContracts.ids).toBe(ERA_IDS);
  });

  it('narrows and validates era ids', () => {
    expect(isEraId('1945')).toBe(true);
    expect(isEraId('1985')).toBe(true);
    expect(isEraId('1955')).toBe(false);
    expect(isEraId(1985)).toBe(false);
    expect(assertEraId('2005')).toBe('2005');
    expect(() => assertEraId('1955')).toThrow(RangeError);

    expect(eraIndex('1945')).toBe(0);
    expect(eraIndex('2025')).toBe(4);
    expect(eraYear('1965')).toBe(1965);
    expect(previousEra('1945')).toBeNull();
    expect(previousEra('2025')).toBe('2005');
    expect(nextEra('2025')).toBeNull();
    expect(nextEra('1985')).toBe('2005');
    expect(DEFAULT_ERA).toBe('2025');
    expect(ERA_CONTRACTS_VERSION).toBe(1);
  });

  it('clamps and eases tween progress', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.42)).toBeCloseTo(0.42, 6);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(smoothStep01(0)).toBe(0);
    expect(smoothStep01(1)).toBe(1);
    expect(smoothStep01(0.5)).toBeCloseTo(0.5, 6);
  });

  it('drives systems through setEra + per-frame tween progress', () => {
    class SampleSystem implements EraBlendable {
      target: EraId | null = null;
      progress = 0;
      history: EraTransitionInfo[] = [];

      setEra(era: EraId, options?: EraTransitionOptions): void {
        this.target = era;
        if (options?.immediate) this.progress = 1;
      }

      updateEraTransition(progress: number, transition: EraTransitionInfo): void {
        this.progress = clamp01(progress);
        this.history.push(transition);
      }
    }

    const system: EraBlendable = new SampleSystem();
    const from: EraId = '1985';
    const to: EraId = '2005';
    system.setEra(to, { durationMs: 1000 });

    const frames = [0, 0.5, 1];
    for (const progress of frames) {
      system.updateEraTransition(progress, {
        from,
        to,
        elapsedMs: progress * 1000,
        durationMs: 1000,
        active: progress < 1,
      });
    }

    const sample = system as SampleSystem;
    expect(sample.target).toBe('2005');
    expect(sample.progress).toBe(1);
    expect(sample.history.map((info) => info.active)).toEqual([true, true, false]);
    expect(sample.history[1].from).toBe('1985');

    // Out-of-range progress must be clamped rather than snapping the scene.
    system.updateEraTransition(4, {
      from,
      to,
      elapsedMs: 1000,
      durationMs: 1000,
      active: false,
    });
    expect(sample.progress).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Block layout                                                        */
/* ------------------------------------------------------------------ */

describe('BlockLayout', () => {
  it('describes the fixed 80 x 50 m block and its surrounding bands', () => {
    expect(BLOCK_WIDTH).toBe(80);
    expect(BLOCK_DEPTH).toBe(50);
    expect(BLOCK_HALF_WIDTH).toBe(40);
    expect(BLOCK_HALF_DEPTH).toBe(25);
    expect(BLOCK).toMatchObject({ minX: -40, maxX: 40, minZ: -25, maxZ: 25 });

    expect(SIDEWALK.width).toBe(3);
    expect(SIDEWALK.innerX).toBe(40);
    expect(SIDEWALK.outerX).toBe(43);
    expect(SIDEWALK.innerZ).toBe(25);
    expect(SIDEWALK.outerZ).toBe(28);

    expect(ROAD_WIDTH).toBe(8);
    expect(BlockLayout.roadRing.width).toBe(8);
    expect(BlockLayout.roadRing.halfWidth).toBe(4);
    expect(BlockLayout.roadRing.innerX).toBe(43);
    expect(BlockLayout.roadRing.outerX).toBe(51);
    expect(BlockLayout.roadRing.innerZ).toBe(28);
    expect(BlockLayout.roadRing.outerZ).toBe(36);

    expect(CELL.width).toBe(102);
    expect(CELL.depth).toBe(72);
    expect(BlockLayout.version).toBe(BLOCK_LAYOUT_VERSION);
  });

  it('places the walkable, drivable and buildable areas consistently', () => {
    expect(isInsideBlock({ x: 0, z: 0 })).toBe(true);
    expect(isInsideBlock({ x: 39, z: 24 })).toBe(true);
    expect(isInsideBlock({ x: 41, z: 0 })).toBe(false);

    expect(isOnSidewalk({ x: 41.5, z: 0 })).toBe(true);
    expect(isOnSidewalk({ x: 0, z: 26.5 })).toBe(true);
    expect(isOnSidewalk({ x: 0, z: 0 })).toBe(false);
    expect(isOnSidewalk({ x: 47, z: 0 })).toBe(false);

    expect(isOnRoad({ x: 47, z: 0 })).toBe(true);
    expect(isOnRoad({ x: 47, z: -32 })).toBe(true);
    expect(isOnRoad({ x: 41.5, z: 0 })).toBe(false);
    expect(isOnRoad({ x: 60, z: 0 })).toBe(false);
  });

  it('maps the road ring into four two-lane legs', () => {
    expect(ROADS).toHaveLength(4);
    expect(ROADS.map((road) => road.id)).toEqual(['north', 'east', 'south', 'west']);

    for (const road of ROADS) {
      expect(road.lanes).toHaveLength(2);
      expect(road.lanes.map((lane) => lane.direction)).toEqual([1, -1]);
      const headings = road.lanes.map((lane) => lane.heading);
      expect(new Set(headings).size).toBe(2);
      const maxOffset = Math.max(...road.lanes.map((lane) => Math.abs(lane.offset)));
      expect(maxOffset).toBe(ROAD_WIDTH / 4);

      for (const lane of road.lanes) {
        const point = lanePoint(road, lane, road.length / 2);
        expect(isOnRoad(point)).toBe(true);
      }
    }

    const north = BlockLayout.roadSegment('north');
    expect(north.center).toBe(-32);
    expect(north.innerEdge).toBe(-28);
    expect(north.outerEdge).toBe(-36);
    expect(north.length).toBe(102);
    expect(lanePoint(north, north.lanes[0], 0)).toEqual({ x: -51, z: -30 });
    // Clamped past the end of the leg.
    expect(lanePoint(north, north.lanes[1], 999)).toEqual({ x: 51, z: -34 });
  });

  it('anchors crosswalks across every road leg at each corner', () => {
    expect(CROSSWALK_ANCHORS).toHaveLength(8);
    expect(BlockLayout.crosswalks).toHaveLength(8);
    expect(BlockLayout.crosswalksAtCorner('northEast')).toHaveLength(2);

    for (const anchor of CROSSWALK_ANCHORS) {
      expect(anchor.length).toBe(ROAD_WIDTH);
      expect(anchor.width).toBe(CROSSWALK_WIDTH);
      expect(isOnRoad(anchor.center)).toBe(true);
      expect(isOnSidewalk(anchor.near)).toBe(true);
      expect(isOnCrosswalk(anchor.center)).toBe(true);
      expect(Math.hypot(anchor.far.x - anchor.near.x, anchor.far.z - anchor.near.z)).toBeCloseTo(
        ROAD_WIDTH,
        5,
      );
    }

    const northEast = BlockLayout.crosswalksAtCorner('northEast');
    expect(northEast.map((anchor) => anchor.road).sort()).toEqual(['east', 'north']);
    expect(northEast.find((anchor) => anchor.road === 'east')?.center).toEqual({ x: 47, z: -26.5 });
    expect(northEast.find((anchor) => anchor.road === 'north')?.center).toEqual({ x: 41.5, z: -32 });
  });

  it('offers a closed sidewalk loop for pedestrians', () => {
    expect(SIDEWALK_LOOP).toHaveLength(8);
    expect(SIDEWALK_LOOP_LENGTH).toBe(272);
    expect(BlockLayout.sidewalkLoopLength).toBe(SIDEWALK_LOOP_LENGTH);

    for (const waypoint of SIDEWALK_LOOP) {
      expect(isOnSidewalk(waypoint)).toBe(true);
    }

    const start = pointOnSidewalkLoop(0);
    expect(start).toEqual({ x: 41.5, z: -26.5 });
    expect(pointOnSidewalkLoop(1)).toEqual(start);

    const halfway = pointOnSidewalkLoop(0.5);
    expect(halfway.x).toBeCloseTo(-41.5, 5);
    expect(halfway.z).toBeCloseTo(26.5, 5);
    expect(isOnSidewalk(halfway)).toBe(true);
  });

  it('freezes the shared geometry so systems cannot mutate layout data', () => {
    expect(Object.isFrozen(BlockLayout)).toBe(true);
    expect(Object.isFrozen(BLOCK)).toBe(true);
    expect(Object.isFrozen(ROADS)).toBe(true);
    expect(Object.isFrozen(ROADS[0].lanes)).toBe(true);
    expect(Object.isFrozen(CROSSWALK_ANCHORS)).toBe(true);
    expect(typeof BlockLayout.isOnRoad).toBe('function');
  });
});

/* ------------------------------------------------------------------ */
/* Boot path                                                           */
/* ------------------------------------------------------------------ */

describe('app boot', () => {
  it('starts the renderer and tick loop and exposes the global handle', () => {
    const container = document.createElement('div');
    container.dataset.chronoStage = '';
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    const overlayRoot = document.createElement('div');
    container.appendChild(overlayRoot);

    const stub = createStubRenderer(canvas);
    const app = bootChronoCity({
      canvas,
      container,
      overlayRoot,
      autoResize: false,
      seed: 4242,
      createRenderer: () => stub.renderer,
    });

    expect(app.context.isRunning).toBe(true);
    expect(stub.hasAnimationLoop()).toBe(true);
    expect(window.__chronoCity).toBe(app);
    expect(getChronoCity()).toBe(app);
    expect(document.documentElement.dataset.chronoBoot).toBe('ready');
    expect(overlayRoot.dataset.chronoHud).toBe('root');

    // The establishing shot looks down on the block from outside the road ring.
    const { camera } = app.context;
    expect(camera.position.y).toBeGreaterThan(BLOCK_HALF_WIDTH);
    expect(Math.abs(camera.position.z)).toBeGreaterThan(CELL.halfDepth);
    expect(Math.hypot(camera.position.x, camera.position.y, camera.position.z)).toBeGreaterThan(
      CELL.width,
    );

    app.context.tick(0.016);
    expect(app.context.frameCount).toBeGreaterThan(0);

    stopChronoCity();
    expect(getChronoCity()).toBeNull();
    expect(window.__chronoCity).toBeUndefined();
    expect(stub.disposeCount()).toBe(1);
  });
});
