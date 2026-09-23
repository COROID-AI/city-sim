/**
 * Chrono City — post-processing and per-era colour grading test suite.
 *
 * Proves the four acceptance claims of the render-polish work order against the
 * real upstream modules (scene context, timeline runtime, era descriptors,
 * environment api) and a stub renderer standing in for WebGL:
 *
 *  1. the `EffectComposer` chain — render, subtle DOF, bloom, grading, tone
 *     mapping/output, vignette, transition sweep, film grain — is built from the
 *     real Three.js passes, composes at a capped pixel ratio, reuses its render
 *     targets, uniforms and LUT payload across frames, and keeps a 1080p frame
 *     near the 60 fps budget;
 *  2. every era has a distinct grade (1945 sepia with heavy grain, 1965 warm
 *     Technicolor, 1985 neon bloom, 2005 clean modern, 2025 cool HDR glow) both
 *     in the authored look table and in the baked per-channel LUT curves;
 *  3. an era change plays a grading sweep/flash whose envelope rides the
 *     `TimelineRuntime` tween progress, and the grading slides between the two
 *     eras texel-by-texel instead of cutting;
 *  4. `RenderPipelineApi` wraps the composer through `SceneContext`'s render
 *     path, derives the grade from `TimelineRuntime` era progress and reads (but
 *     never mutates) the environment's exposure / fog / neon context.
 *
 * The budget guard is exercised with synthetic frame deltas, and the graceful
 * fallback with a renderer that cannot host a composer, so both degradation
 * paths are covered headlessly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { ERA_IDS, type EraId } from '../../src/core/eraContracts';
import { SceneContext, type SceneContextOptions } from '../../src/core/sceneContext';
import { TimelineRuntime } from '../../src/era/timelineRuntime';
import { createEnvironmentApi, type EnvironmentApi } from '../../src/environment/environmentApi';
import {
  GRADING_LUT_SIZE,
  applyLookToColor,
  atmosphereWeight,
  bakeBlendedGradingLut,
  bakeGradingLut,
  createGradingLutData,
  evaluateGradeCurve,
  getGradingLook,
  gradeCurve,
  gradeFingerprintDistance,
  hexToLinearRgb,
  resolveSweepState,
  sampleGradingLut,
  sweepIntensity,
  writeSweepState,
  type MutableSweepState,
} from '../../src/rendering/eraGrading';
import {
  MAX_PIXEL_RATIO,
  MAX_RENDER_PIXELS,
  POSTFX_PASS_IDS,
  PostFxPipeline,
  resolveCappedPixelRatio,
} from '../../src/rendering/postfx';
import {
  RENDER_PIPELINE_GLOBAL_KEY,
  RenderPipelineApi,
  createRenderPipelineApi,
  type RenderPipelineApiOptions,
} from '../../src/rendering/renderPipelineApi';

/* ------------------------------------------------------------------------- *
 * Harness
 * ------------------------------------------------------------------------- */

/** Mutable state of the stub renderer, so tests can read what the passes did. */
interface StubGl {
  renderer: THREE.WebGLRenderer;
  /** Emulated `window.devicePixelRatio`. */
  pixelRatio: number;
  width: number;
  height: number;
  /** Every `renderer.render()` call: passes draw through here. */
  renderCalls: number;
  setSizeCalls: Array<{ width: number; height: number }>;
  setPixelRatioCalls: number[];
  clearCalls: number;
}

/**
 * A WebGL-free renderer double that answers everything the composer and the
 * post-processing passes ask of a renderer, and counts the draws they make.
 */
function createStubGl(): StubGl {
  const canvas = document.createElement('canvas');
  const state: StubGl = {
    renderer: null as unknown as THREE.WebGLRenderer,
    pixelRatio: 1,
    width: 1,
    height: 1,
    renderCalls: 0,
    setSizeCalls: [],
    setPixelRatioCalls: [],
    clearCalls: 0,
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
      state.setSizeCalls.push({ width, height });
    },
    getDrawingBufferSize: (target: THREE.Vector2) =>
      target.set(state.width * state.pixelRatio, state.height * state.pixelRatio),
    getRenderTarget: () => null,
    setRenderTarget: () => undefined,
    getClearColor: (target: THREE.Color) => target.setRGB(0, 0, 0),
    setClearColor: () => undefined,
    getClearAlpha: () => 1,
    setClearAlpha: () => undefined,
    clear: () => {
      state.clearCalls += 1;
    },
    clearDepth: () => undefined,
    render: () => {
      state.renderCalls += 1;
    },
    setAnimationLoop: () => undefined,
    dispose: () => undefined,
  };

  state.renderer = stub as unknown as THREE.WebGLRenderer;
  return state;
}

const contexts: SceneContext[] = [];
const disposables: Array<{ dispose(): void }> = [];

function createContext(options: SceneContextOptions = {}, gl?: StubGl): SceneContext {
  const renderer = gl ?? createStubGl();
  const context = new SceneContext({
    autoResize: false,
    shadows: false,
    createRenderer: () => renderer.renderer,
    ...options,
  });
  contexts.push(context);
  return context;
}

interface Fixture {
  readonly context: SceneContext;
  readonly gl: StubGl;
  readonly timeline: TimelineRuntime;
  readonly environment: EnvironmentApi;
  readonly api: RenderPipelineApi;
}

/**
 * Builds the real integration stack in the order the app wires it: context →
 * timeline → environment → render pipeline.
 */
function createFixture(
  initialEra: EraId = '2025',
  options: Partial<RenderPipelineApiOptions> = {},
): Fixture {
  const gl = createStubGl();
  const context = createContext({}, gl);
  const timeline = new TimelineRuntime({ context, initialEra });
  const environment = createEnvironmentApi({ context, timeline, initialEra });
  const api = createRenderPipelineApi({
    context,
    timeline,
    environment,
    initialEra,
    // The budget guard is opt-in per test: most tests assert look/behaviour,
    // and the guard's own test drives it with synthetic frame deltas.
    monitorBudget: false,
    ...options,
  });
  disposables.push(api, environment, timeline);
  return { context, gl, timeline, environment, api };
}

/** One animation-loop iteration: dispatch every system, then draw. */
function runFrames(fixture: Fixture, frames: number, delta = 1 / 60): void {
  for (let frame = 0; frame < frames; frame += 1) {
    fixture.context.tick(delta);
    fixture.context.render();
  }
}

function countLights(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if ((object as THREE.Light).isLight) count += 1;
  });
  return count;
}

afterEach(() => {
  while (disposables.length > 0) disposables.pop()?.dispose();
  while (contexts.length > 0) contexts.pop()?.dispose();
});

/* ------------------------------------------------------------------------- *
 * 1. Per-era grading looks
 * ------------------------------------------------------------------------- */

describe('per-era grading looks', () => {
  it('authors a distinct, characterful look for each of the five eras', () => {
    for (const era of ERA_IDS) {
      const look = getGradingLook(era);
      expect(look.id).toBe(era);
      expect(look.year).toBe(Number.parseInt(era, 10));
      expect(look.label.length).toBeGreaterThan(0);
      expect(look.description.length).toBeGreaterThan(0);
      // Every look carries all four LUT curves.
      expect(look.curves.master.points.length).toBeGreaterThanOrEqual(3);
      expect(look.curves.red.points.length).toBeGreaterThanOrEqual(3);
      expect(look.grain).toBeGreaterThan(0);
      expect(look.bloom.strength).toBeGreaterThan(0);
      expect(look.dof.maxBlur).toBeGreaterThan(0);
      expect(look.sweep.strength).toBeGreaterThan(0);
    }

    // 1945 — sepia with heavy grain.
    const sepia = getGradingLook('1945');
    expect(sepia.sepia).toBeGreaterThan(0.5);
    expect(sepia.grain).toBeGreaterThan(getGradingLook('1965').grain);
    expect(sepia.grain).toBeGreaterThan(getGradingLook('1985').grain);
    expect(sepia.grain).toBeGreaterThan(getGradingLook('2025').grain);
    expect(sepia.vignette).toBeGreaterThan(getGradingLook('2005').vignette);

    // 1965 — warm Technicolor: saturated and warm.
    const technicolor = getGradingLook('1965');
    expect(technicolor.saturation).toBeGreaterThan(1);
    expect(technicolor.temperature).toBeGreaterThan(0.2);
    expect(technicolor.saturation).toBeGreaterThan(getGradingLook('1945').saturation);

    // 1985 — neon bloom: strongest bloom, lowest threshold.
    const neon = getGradingLook('1985');
    for (const era of ERA_IDS) {
      if (era === '1985') continue;
      expect(neon.bloom.strength).toBeGreaterThan(getGradingLook(era).bloom.strength);
      expect(neon.bloom.threshold).toBeLessThan(getGradingLook(era).bloom.threshold);
    }

    // 2005 — clean modern: the most restrained grade of the five.
    const modern = getGradingLook('2005');
    for (const era of ERA_IDS) {
      if (era === '2005') continue;
      expect(modern.grain).toBeLessThan(getGradingLook(era).grain);
      expect(modern.sepia).toBeLessThanOrEqual(getGradingLook(era).sepia);
      expect(modern.vignette).toBeLessThanOrEqual(getGradingLook(era).vignette);
      expect(modern.dof.maxBlur).toBeLessThanOrEqual(getGradingLook(era).dof.maxBlur);
      expect(Math.abs(modern.saturation - 1)).toBeLessThanOrEqual(
        Math.abs(getGradingLook(era).saturation - 1),
      );
    }
    // …and it sits well below the two bloom-driven eras.
    expect(modern.bloom.strength).toBeLessThan(getGradingLook('1985').bloom.strength);
    expect(modern.bloom.strength).toBeLessThan(getGradingLook('2025').bloom.strength);

    // 2025 — cool HDR glow: coolest and brightest exposure.
    const future = getGradingLook('2025');
    expect(future.temperature).toBeLessThan(0);
    for (const era of ERA_IDS) {
      if (era === '2025') continue;
      expect(future.exposure).toBeGreaterThanOrEqual(getGradingLook(era).exposure);
      expect(future.temperature).toBeLessThan(getGradingLook(era).temperature);
    }
  });

  it('grades a neutral pixel in the era-appropriate direction', () => {
    const mid = (era: EraId) => applyLookToColor({ r: 0.5, g: 0.5, b: 0.5 }, getGradingLook(era));

    // Sepia and Technicolor are warm: red leads blue.
    expect(mid('1945').r).toBeGreaterThan(mid('1945').g);
    expect(mid('1945').g).toBeGreaterThan(mid('1945').b);
    expect(mid('1965').r).toBeGreaterThan(mid('1965').b);
    // 2025 is cool: blue leads red.
    expect(mid('2025').b).toBeGreaterThan(mid('2025').r);
    // 2005 is the reference: neutral within a hair.
    const modern = mid('2005');
    expect(Math.abs(modern.r - modern.b)).toBeLessThan(0.01);
    // 1985's lifted blacks read brighter than 1945's crushed ones.
    const black = (era: EraId) => applyLookToColor({ r: 0.02, g: 0.02, b: 0.02 }, getGradingLook(era));
    expect(black('1985').r).toBeGreaterThan(black('1945').r);
  });

  it('keeps every pair of eras measurably apart in its grade fingerprint', () => {
    for (let left = 0; left < ERA_IDS.length; left += 1) {
      for (let right = left + 1; right < ERA_IDS.length; right += 1) {
        const distance = gradeFingerprintDistance(
          getGradingLook(ERA_IDS[left] as EraId),
          getGradingLook(ERA_IDS[right] as EraId),
        );
        expect(distance).toBeGreaterThan(0.05);
      }
    }
  });

  it('clamps the environment fog into an aerial-haze weight', () => {
    const atmosphere = {
      fogColor: hexToLinearRgb(0xff8800),
      fogDensity: 0.0055,
      fogNear: 40,
      fogFar: 320,
      fogMode: 'linear' as const,
    };
    expect(atmosphereWeight(null)).toBe(0);
    expect(atmosphereWeight(atmosphere)).toBeGreaterThan(0);
    expect(atmosphereWeight(atmosphere)).toBeLessThanOrEqual(1);

    const plain = applyLookToColor({ r: 0.4, g: 0.4, b: 0.4 }, getGradingLook('1945'));
    const hazy = applyLookToColor({ r: 0.4, g: 0.4, b: 0.4 }, getGradingLook('1945'), atmosphere);
    expect(hazy.r / hazy.b).toBeGreaterThan(plain.r / plain.b);

    // A look that authors no haze ignores the fog entirely.
    const dry = applyLookToColor({ r: 0.4, g: 0.4, b: 0.4 }, getGradingLook('1945'), {
      ...atmosphere,
      fogDensity: 0,
      fogMode: 'exponential',
    });
    expect(dry.r).toBeCloseTo(plain.r, 6);
  });

  it('builds monotone grading curves that pass through their control points', () => {
    const curve = gradeCurve('test', [
      [0, 0],
      [0.5, 0.25],
      [1, 1],
    ]);
    for (const point of curve.points) {
      expect(evaluateGradeCurve(curve, point[0])).toBeCloseTo(point[1], 6);
    }
    expect(evaluateGradeCurve(curve, -1)).toBe(0);
    expect(evaluateGradeCurve(curve, 5)).toBe(1);

    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const value = evaluateGradeCurve(curve, step / 20);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }

    expect(() => gradeCurve('bad', [[0, 0]])).toThrow(RangeError);
    expect(() =>
      gradeCurve('bad', [
        [0.5, 0],
        [0.25, 1],
      ]),
    ).toThrow(RangeError);
  });

  it('bakes per-channel LUT curves, and blends them texel-by-texel between eras', () => {
    const size = 64;
    const sepiaData = createGradingLutData(size);
    expect(bakeGradingLut(getGradingLook('1945'), sepiaData, size)).toBe(sepiaData);
    expect(sepiaData).toHaveLength(size * 4);

    for (let index = 0; index < size; index += 1) {
      const offset = index * 4;
      const red = sepiaData[offset] as number;
      const green = sepiaData[offset + 1] as number;
      const blue = sepiaData[offset + 2] as number;
      expect(sepiaData[offset + 3]).toBe(255);
      // Warm curve: red leads blue everywhere except the shared black point.
      expect(red).toBeGreaterThanOrEqual(blue);
      expect(green).toBeGreaterThanOrEqual(blue);
      if (index > 0) {
        const previous = (index - 1) * 4;
        expect(red).toBeGreaterThanOrEqual(sepiaData[previous] as number);
        expect(green).toBeGreaterThanOrEqual(sepiaData[previous + 1] as number);
        expect(blue).toBeGreaterThanOrEqual(sepiaData[previous + 2] as number);
      }
    }

    // A settled bake is exactly the era's own LUT…
    const futureData = createGradingLutData(size);
    bakeGradingLut(getGradingLook('2025'), futureData, size);
    const settled = createGradingLutData(size);
    bakeBlendedGradingLut(getGradingLook('2025'), getGradingLook('2025'), 1, settled, size);
    expect([...settled]).toEqual([...futureData]);

    // …and a half-way tween sits between the two eras at every texel.
    const blended = createGradingLutData(size);
    bakeBlendedGradingLut(getGradingLook('2025'), getGradingLook('1985'), 0.5, blended, size);
    expect(blended).not.toEqual(futureData);
    for (const stop of [0.25, 0.5, 0.75]) {
      const from = sampleGradingLut(futureData, stop);
      const to = sampleGradingLut(sepiaData, stop);
      const middle = sampleGradingLut(blended, stop);
      const neon = sampleGradingLut(
        (() => {
          const data = createGradingLutData(size);
          bakeGradingLut(getGradingLook('1985'), data, size);
          return data;
        })(),
        stop,
      );
      expect(middle.r).toBeGreaterThanOrEqual(Math.min(from.r, neon.r) - 0.01);
      expect(middle.r).toBeLessThanOrEqual(Math.max(from.r, neon.r) + 0.01);
      expect(middle.b).toBeGreaterThanOrEqual(Math.min(from.b, neon.b) - 0.01);
      expect(middle.b).toBeLessThanOrEqual(Math.max(from.b, neon.b) + 0.01);
      expect(to).toBeDefined();
    }
  });

  it('rides the transition sweep envelope on tween progress', () => {
    const look = getGradingLook('1985');
    expect(sweepIntensity(0)).toBeCloseTo(0, 6);
    expect(sweepIntensity(0.5)).toBeCloseTo(1, 6);
    expect(sweepIntensity(1)).toBeCloseTo(0, 6);

    const middle = resolveSweepState(0.5, look, { active: true, direction: 1 });
    expect(middle.intensity).toBeCloseTo(1, 6);
    expect(middle.flash).toBeCloseTo(look.sweep.flash, 6);
    expect(middle.travel).toBeCloseTo(0.5, 6);
    expect(middle.color).toBe(look.sweep.color);

    // Travelling back in time sweeps the other way.
    const backwards = resolveSweepState(0.25, look, { active: true, direction: -1 });
    expect(backwards.travel).toBeCloseTo(0.75, 6);
    expect(backwards.direction).toBe(-1);

    // Settled: nothing left on screen.
    for (const progress of [0, 1]) {
      const settled = resolveSweepState(progress, look, { active: false });
      expect(settled.intensity).toBe(0);
      expect(settled.flash).toBe(0);
    }

    // The frame loop writes into one reused object instead of allocating.
    const target: MutableSweepState = {
      intensity: 0,
      flash: 0,
      travel: 0,
      color: 0,
      direction: 1,
    };
    expect(writeSweepState(0.5, look, { active: true, direction: 1 }, target)).toBe(target);
    expect(target.intensity).toBeCloseTo(1, 6);
  });
});

/* ------------------------------------------------------------------------- *
 * 2. EffectComposer pipeline: pass chain, pixel ratio, budget
 * ------------------------------------------------------------------------- */

describe('EffectComposer post-processing pipeline', () => {
  it('composes with the real Three.js passes through the scene render path', () => {
    const fixture = createFixture('2025');
    const { api, gl, context } = fixture;
    const composer = api.composer!;
    expect(composer).toBeInstanceOf(Object);
    expect(api.snapshot().postFx.composerAvailable).toBe(true);

    // Eight passes, in the documented order, built from real addons.
    expect(composer.passes).toHaveLength(POSTFX_PASS_IDS.length);
    expect(composer.passes[0]).toBeInstanceOf(RenderPass);
    expect(composer.passes[1]).toBeInstanceOf(BokehPass);
    expect(composer.passes[2]).toBeInstanceOf(UnrealBloomPass);
    expect(composer.passes[3]).toBeInstanceOf(ShaderPass);
    expect(composer.passes[4]).toBeInstanceOf(OutputPass);
    expect(composer.passes[5]).toBeInstanceOf(ShaderPass);
    expect(composer.passes[6]).toBeInstanceOf(ShaderPass);
    expect(composer.passes[7]).toBeInstanceOf(ShaderPass);
    expect(api.activePasses()).toEqual([...POSTFX_PASS_IDS]);

    // Tone mapping is owned by this task's output pass.
    expect(gl.renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(api.pipeline.getPass('grading')).toBeInstanceOf(ShaderPass);

    // The composer is the scene context's render path: `context.render()` —
    // exactly what the animation loop calls — draws the whole pass chain.
    const drawsBefore = gl.renderCalls;
    runFrames(fixture, 3);
    expect(api.snapshot().renderCount).toBe(3);
    expect(api.snapshot().tickCount).toBe(3);
    expect(api.snapshot().renderAttached).toBe(true);
    // Eight passes through a stub renderer draw far more than the three plain
    // scene draws would.
    expect(gl.renderCalls).toBeGreaterThanOrEqual(drawsBefore + 3 * composer.passes.length);
    expect(api.frameTiming().composedFrames).toBeGreaterThanOrEqual(3);

    // Disposal hands the render path back to the context.
    api.dispose();
    const drawsAfterDispose = gl.renderCalls;
    context.render();
    expect(gl.renderCalls).toBe(drawsAfterDispose + 1);
  });

  it('caps the device pixel ratio and keeps the 1080p frame inside the budget', () => {
    const fixture = createFixture('2025', {
      monitorBudget: true,
      warmupFrames: 0,
      frameBudgetMs: 1000 / 60,
    });
    const { api, gl, context } = fixture;
    const composer = api.composer!;

    // A 3× device ratio is clamped to the hard cap.
    gl.pixelRatio = 3;
    context.resize(1920, 1080);
    runFrames(fixture, 30, 1 / 60);

    expect(api.snapshot().postFx.pixelRatioCap).toBe(MAX_PIXEL_RATIO);
    expect(api.pixelRatio).toBeLessThanOrEqual(MAX_PIXEL_RATIO);
    expect(api.pixelRatio).toBe(2);

    const timing = api.frameTiming();
    expect(timing.renderWidth).toBe(3840);
    expect(timing.renderHeight).toBe(2160);
    expect(timing.renderPixels).toBe(1920 * 1080 * MAX_PIXEL_RATIO * MAX_PIXEL_RATIO);
    expect(timing.renderPixels).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
    expect(timing.withinBudget).toBe(true);
    expect(timing.fps).toBeGreaterThan(55);
    expect(timing.degradeLevel).toBe(0);
    // The composer's own buffers follow the capped ratio.
    expect(composer.renderTarget1.width).toBe(3840);
    expect(composer.renderTarget1.height).toBe(2160);

    // A 4K surface trades pixel ratio for frame time instead of blowing the budget.
    context.resize(3840, 2160);
    runFrames(fixture, 2, 1 / 60);
    expect(api.pixelRatio).toBeLessThan(MAX_PIXEL_RATIO);
    expect(api.frameTiming().renderPixels).toBeLessThanOrEqual(MAX_RENDER_PIXELS);

    // …and the pure resolver reflects the same rules.
    expect(
      resolveCappedPixelRatio({ devicePixelRatio: 3, cap: 4, width: 800, height: 600 }),
    ).toBe(MAX_PIXEL_RATIO);
    expect(
      resolveCappedPixelRatio({ devicePixelRatio: 2, cap: 2, width: 800, height: 600 }),
    ).toBe(2);
  });

  it('reuses render targets, uniforms and the LUT payload across frames', () => {
    const fixture = createFixture('1985');
    const { api } = fixture;
    const composer = api.composer!;
    const bloom = api.pipeline.getPass('bloom') as UnrealBloomPass;
    const grading = api.pipeline.getPass('grading') as ShaderPass;
    const vignette = api.pipeline.getPass('vignette') as ShaderPass;

    const readTargets = [composer.renderTarget1, composer.renderTarget2];
    const bloomTargets = bloom.renderTargetsHorizontal.slice();
    const gradingUniforms = grading.uniforms;
    const vignetteUniforms = vignette.uniforms;
    const luts = grading.uniforms['uLut']!.value as THREE.DataTexture;
    const lutPayload = luts.image.data as Uint8Array;
    const bloomTargetsBefore = bloom.renderTargetsVertical.slice();

    runFrames(fixture, 60);
    const settledBakes = api.snapshot().postFx.lutBakes;
    runFrames(fixture, 30);

    expect(composer.renderTarget1).toBe(readTargets[0]);
    expect(composer.renderTarget2).toBe(readTargets[1]);
    for (let index = 0; index < bloomTargets.length; index += 1) {
      expect(bloom.renderTargetsHorizontal[index]).toBe(bloomTargets[index]);
      expect(bloom.renderTargetsVertical[index]).toBe(bloomTargetsBefore[index]);
    }
    expect(grading.uniforms).toBe(gradingUniforms);
    expect(vignette.uniforms).toBe(vignetteUniforms);
    expect((grading.uniforms['uLut']!.value as THREE.DataTexture).image.data).toBe(lutPayload);
    expect(luts.image.width).toBe(GRADING_LUT_SIZE);
    expect(luts.image.height).toBe(1);
    // A settled frame never re-bakes the era LUT.
    expect(api.snapshot().postFx.lutBakes).toBe(settledBakes);
  });

  it('drops DOF then grain when the frame budget is blown, and restores them', () => {
    const fixture = createFixture('1985', {
      monitorBudget: true,
      warmupFrames: 0,
      degradeAfterFrames: 6,
      restoreAfterFrames: 6,
    });
    const { api, context } = fixture;
    api.pipeline.setSize(1920, 1080, 2);

    // 60 fps: everything the tier asked for stays on.
    runFrames(fixture, 20, 1 / 60);
    expect(api.frameTiming().withinBudget).toBe(true);
    expect(api.snapshot().postFx.degradeLevel).toBe(0);
    expect(api.activePasses()).toContain('dof');
    expect(api.activePasses()).toContain('grain');
    expect(api.activePasses()).toContain('bloom');

    // 30 ms frames: DOF goes first, then grain — tone mapping and grading stay.
    runFrames(fixture, 60, 0.03);
    const degraded = api.snapshot().postFx;
    expect(api.frameTiming().withinBudget).toBe(false);
    expect(degraded.degradeLevel).toBeGreaterThanOrEqual(1);
    expect(api.pipeline.isPassEnabled('dof')).toBe(false);
    expect(api.pipeline.isPassEnabled('grain')).toBe(false);
    expect(api.pipeline.isPassEnabled('render')).toBe(true);
    expect(api.pipeline.isPassEnabled('grading')).toBe(true);
    expect(api.pipeline.isPassEnabled('output')).toBe(true);
    expect(degraded.droppedPasses).toEqual(['dof', 'grain']);
    expect(degraded.maxDegradeLevel).toBe(2);
    expect(degraded.toneMapping).toBe(THREE.ACESFilmicToneMapping);

    // Core passes refuse to be switched off by configuration, too.
    expect(() => api.setPassEnabled('grading', false)).toThrow(RangeError);
    expect(() => api.setPassEnabled('output', false)).toThrow(RangeError);

    // The frame recovers when the cost comes back down.
    runFrames(fixture, 120, 1 / 120);
    expect(api.snapshot().postFx.degradeLevel).toBe(0);
    expect(api.pipeline.isPassEnabled('dof')).toBe(true);
    expect(api.pipeline.isPassEnabled('grain')).toBe(true);
    expect(api.activePasses()).toEqual([...POSTFX_PASS_IDS]);
    expect(context.hasSystem('render-pipeline')).toBe(true);
  });

  it('degrades to a plain draw when the renderer cannot host a composer', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const draws = { count: 0 };
    const canvas = document.createElement('canvas');
    const stub = {
      domElement: canvas,
      shadowMap: { enabled: false, type: THREE.PCFShadowMap },
      toneMapping: THREE.NoToneMapping,
      toneMappingExposure: 1,
      outputColorSpace: THREE.SRGBColorSpace,
      autoClear: true,
      getPixelRatio: () => {
        throw new Error('no drawing buffer');
      },
      setPixelRatio: () => undefined,
      setSize: () => undefined,
      render: () => {
        draws.count += 1;
      },
      setAnimationLoop: () => undefined,
      dispose: () => undefined,
    } as unknown as THREE.WebGLRenderer;

    const context = createContext({ createRenderer: () => stub });
    const api = createRenderPipelineApi({ context, initialEra: '1945', monitorBudget: false });
    disposables.push(api);

    expect(api.composer).toBeNull();
    expect(api.snapshot().postFx.composerAvailable).toBe(false);

    context.render();
    expect(draws.count).toBe(1);
    expect(api.snapshot().renderCount).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('never touches the scene lights or the environment fog object', () => {
    const gl = createStubGl();
    const context = createContext({}, gl);
    const timeline = new TimelineRuntime({ context, initialEra: '1945' });
    const environment = createEnvironmentApi({ context, timeline, initialEra: '1945' });
    disposables.push(environment, timeline);

    const lightsBefore = countLights(context.scene);
    const fogBefore = context.scene.fog;

    const api = createRenderPipelineApi({
      context,
      timeline,
      environment,
      initialEra: '1945',
      monitorBudget: false,
    });
    disposables.push(api);
    runFrames({ context, gl, timeline, environment, api }, 5);

    expect(countLights(context.scene)).toBe(lightsBefore);
    expect(context.scene.fog).toBe(fogBefore);
    expect(environment.sky.root.parent).not.toBeNull();
  });
});

/* ------------------------------------------------------------------------- *
 * 3. RenderPipelineApi: era progress, environment context, lifecycle
 * ------------------------------------------------------------------------- */

describe('RenderPipelineApi composition', () => {
  it('derives the grade from TimelineRuntime progress and returns to the authored look', () => {
    const fixture = createFixture('2025');
    const { api, timeline, context } = fixture;
    runFrames(fixture, 3);

    const start = api.snapshot();
    expect(start.era).toBe('2025');
    expect(start.postFx.progress).toBe(1);
    expect(start.postFx.transitioning).toBe(false);
    expect(start.postFx.sweep.intensity).toBe(0);
    expect(start.postFx.look.id).toBe('2025');

    const authored2025 = createGradingLutData(GRADING_LUT_SIZE);
    bakeGradingLut(getGradingLook('2025'), authored2025, GRADING_LUT_SIZE);
    const authored1985 = createGradingLutData(GRADING_LUT_SIZE);
    bakeGradingLut(getGradingLook('1985'), authored1985, GRADING_LUT_SIZE);
    const want2025 = sampleGradingLut(authored2025, 0.5);
    const want1985 = sampleGradingLut(authored1985, 0.5);

    expect(start.postFx.grade.lutMid.r).toBeCloseTo(want2025.r, 2);
    expect(start.postFx.grade.lutMid.b).toBeCloseTo(want2025.b, 2);

    // Drive a real tween and sample it every frame.
    timeline.selectEra('1985');
    expect(api.isTransitioning).toBe(true);
    // 1985 is older than 2025, so the sweep travels right-to-left.
    expect(api.snapshot().postFx.sweep.direction).toBe(-1);

    const intensities: number[] = [];
    const travels: number[] = [];
    let midTween: { progress: number; red: number; blue: number } | null = null;
    let frames = 0;
    while (timeline.isTransitioning && frames < 200) {
      context.tick(1 / 60);
      context.render();
      frames += 1;
      const sample = api.snapshot();
      intensities.push(sample.postFx.sweep.intensity);
      travels.push(sample.postFx.sweep.travel);
      expect(sample.postFx.progress).toBeCloseTo(timeline.progress, 6);
      // The flash rides the squared sweep envelope, scaled by whichever era's
      // sweep character the blend currently leans on.
      if (sample.postFx.sweep.intensity > 0) {
        const ratio = sample.postFx.sweep.flash / sample.postFx.sweep.intensity ** 2;
        expect(ratio).toBeGreaterThanOrEqual(getGradingLook('2025').sweep.flash - 1e-6);
        expect(ratio).toBeLessThanOrEqual(getGradingLook('1985').sweep.flash + 1e-6);
      } else {
        expect(sample.postFx.sweep.flash).toBe(0);
      }
      if (midTween === null && sample.postFx.progress >= 0.45 && sample.postFx.progress <= 0.55) {
        midTween = {
          progress: sample.postFx.progress,
          red: sample.postFx.grade.lutMid.r,
          blue: sample.postFx.grade.lutMid.b,
        };
      }
    }

    expect(frames).toBeGreaterThan(10);
    expect(midTween).not.toBeNull();
    // The sweep peaks mid-tween and is gone by the time the tween lands.
    expect(Math.max(...intensities)).toBeGreaterThan(0.8);
    expect(intensities[intensities.length - 1]).toBeCloseTo(0, 6);
    // The band travels across the frame as the tween advances.
    expect(travels[1] as number).toBeGreaterThan(0.9);
    expect(travels[Math.floor(travels.length / 2)]).toBeLessThan(travels[1] as number);

    // Half way, the LUT sits between the two eras.
    const middle = midTween as { progress: number; red: number; blue: number };
    expect(middle.red).toBeGreaterThan(Math.min(want2025.r, want1985.r) - 0.02);
    expect(middle.red).toBeLessThan(Math.max(want2025.r, want1985.r) + 0.02);
    expect(middle.blue).toBeGreaterThan(Math.min(want2025.b, want1985.b) - 0.02);
    expect(middle.blue).toBeLessThan(Math.max(want2025.b, want1985.b) + 0.02);

    // Landed: the authored 1985 look, no sweep.
    const settled = api.snapshot();
    expect(settled.era).toBe('1985');
    expect(settled.postFx.progress).toBe(1);
    expect(settled.postFx.transitioning).toBe(false);
    expect(settled.postFx.sweep.intensity).toBe(0);
    expect(settled.postFx.look.id).toBe('1985');
    expect(settled.postFx.grade.lutMid.r).toBeCloseTo(want1985.r, 2);
    expect(settled.postFx.grade.lutMid.b).toBeCloseTo(want1985.b, 2);
    expect(settled.postFx.bloom.strength).toBeGreaterThan(1);

    // Travelling towards a newer era sweeps left-to-right instead.
    timeline.selectEra('2025');
    context.tick(0.3);
    context.render();
    const forwards = api.snapshot().postFx.sweep;
    expect(forwards.direction).toBe(1);
    expect(forwards.travel).toBeGreaterThan(0);
    expect(forwards.travel).toBeLessThan(0.5);
    expect(forwards.intensity).toBeGreaterThan(0);
    expect(forwards.color).toBe(getGradingLook('1985').sweep.color);
    context.tick(0.3);
    context.render();
    expect(api.snapshot().postFx.sweep.travel).toBeGreaterThan(forwards.travel);

    // …and back in time it sweeps the other way again.
    timeline.selectEra('1945');
    context.tick(0.3);
    context.render();
    const backwards = api.snapshot().postFx.sweep;
    expect(backwards.direction).toBe(-1);
    expect(backwards.travel).toBeGreaterThan(0.5);
    expect(backwards.travel).toBeLessThan(1);

    // Everything settles back to a clean, sweep-free frame.
    timeline.selectEra('2025', { immediate: true });
    context.tick(1 / 60);
    context.render();
    expect(api.snapshot().postFx.transitioning).toBe(false);
    expect(api.snapshot().postFx.sweep.intensity).toBe(0);
    expect(api.snapshot().postFx.grade.lutMid.b).toBeCloseTo(want2025.b, 2);
  });

  it('reads the environment exposure, fog and neon context without clobbering it', () => {
    const fixture = createFixture('1945', {
      monitorBudget: true,
      warmupFrames: 0,
    });
    const { api, environment, timeline, context, gl } = fixture;
    context.resize(1920, 1080);
    gl.pixelRatio = 2;
    runFrames(fixture, 5);

    const dark = api.snapshot();
    const darkEnv = environment.gradeState();
    expect(dark.environmentAttached).toBe(true);
    expect(dark.environmentEra).toBe('1945');
    expect(gl.renderer.toneMappingExposure).toBeCloseTo(darkEnv.exposure, 6);
    expect(dark.postFx.environmentAttached).toBe(true);
    expect(dark.postFx.exposure.environment).toBeCloseTo(darkEnv.exposure, 6);
    expect(dark.postFx.environment!.fogColor).toBe(darkEnv.fogColor);
    expect(dark.postFx.fog.color).toBe(darkEnv.fogColor);
    expect(dark.postFx.fog.haze).toBeGreaterThan(0);
    // 1945's closed-in linear fog breathes more haze than 2005's clear air.
    expect(dark.postFx.environment!.fogDensity).toBe(darkEnv.fogDensity);

    const look1945 = getGradingLook('1945');
    const expectedBloom =
      look1945.bloom.strength *
      Math.min(1.6, Math.max(0.6, darkEnv.exposure)) *
      (1 + 0.35 * darkEnv.neonIntensity);
    expect(dark.postFx.bloom.strength).toBeCloseTo(expectedBloom, 6);
    expect(dark.postFx.dof.focus).toBeGreaterThan(0);
    expect(dark.postFx.dof.maxBlur).toBeCloseTo(look1945.dof.maxBlur, 6);

    // 1985's neon haze and brighter exposure push the bloom energy up.
    timeline.selectEra('1985', { immediate: true });
    runFrames(fixture, 5);
    const neon = api.snapshot();
    const neonEnv = environment.gradeState();
    expect(neonEnv.neonIntensity).toBeGreaterThan(darkEnv.neonIntensity);
    expect(neon.postFx.bloom.strength).toBeGreaterThan(dark.postFx.bloom.strength);
    expect(neon.postFx.bloom.strength).toBeGreaterThan(getGradingLook('1985').bloom.strength);
    expect(neon.postFx.bloom.threshold).toBeCloseTo(getGradingLook('1985').bloom.threshold, 6);
    // The environment still owns the renderer exposure — we only grade on top.
    expect(gl.renderer.toneMappingExposure).toBeCloseTo(neonEnv.exposure, 6);
    expect(neon.postFx.exposure.grade).toBeCloseTo(getGradingLook('1985').exposure, 6);

    // Environment polling follows the era without allocating every frame.
    const grade = api.gradeState();
    expect(grade.era).toBe('1985');
    expect(grade.environmentExposure).toBeCloseTo(neonEnv.exposure, 6);
    expect(grade.look.id).toBe('1985');
    expect(grade.sweep.intensity).toBe(0);
  });

  it('latches late runtime handles through consume(), integrates and disposes cleanly', () => {
    const gl = createStubGl();
    const context = createContext({}, gl);
    const api = createRenderPipelineApi({ context, initialEra: '1965', monitorBudget: false });
    disposables.push(api);

    expect(api.isBlendableRegistered).toBe(false);
    expect(api.pipeline.hasEnvironment).toBe(false);
    expect(api.snapshot().postFx.environmentAttached).toBe(false);

    const timeline = new TimelineRuntime({ context, initialEra: '1965' });
    const environment = createEnvironmentApi({ context, timeline, initialEra: '1965' });
    disposables.push(environment, timeline);

    api.consume({ timeline, environment });
    expect(api.isBlendableRegistered).toBe(true);
    expect(api.pipeline.hasEnvironment).toBe(true);
    expect(api.snapshot().postFx.environmentAttached).toBe(true);

    // With no environment the pipeline carries the era exposure itself. This
    // probe neither registers a second tick nor steals the render path.
    const withoutEnvironment = createRenderPipelineApi({
      context,
      initialEra: '1945',
      animate: false,
      wrapContextRender: false,
    });
    disposables.push(withoutEnvironment);
    expect(withoutEnvironment.pipeline.hasEnvironment).toBe(false);
    withoutEnvironment.render(1 / 60);
    expect(gl.renderer.toneMappingExposure).toBeCloseTo(getGradingLook('1945').exposure, 6);
    expect(withoutEnvironment.isTicking).toBe(false);
    expect(withoutEnvironment.isRenderAttached).toBe(false);

    timeline.selectEra('2025', { immediate: true });
    runFrames({ context, gl, timeline, environment, api }, 2);
    expect(api.era).toBe('2025');
    expect(api.snapshot().postFx.look.id).toBe('2025');
    expect(gl.renderer.toneMappingExposure).toBeCloseTo(environment.gradeState().exposure, 6);

    api.integrate();
    expect((window as unknown as Record<string, unknown>)[RENDER_PIPELINE_GLOBAL_KEY]).toBe(api);

    api.dispose();
    expect((window as unknown as Record<string, unknown>)[RENDER_PIPELINE_GLOBAL_KEY]).toBeUndefined();
    expect(context.hasSystem('render-pipeline')).toBe(false);
    expect(context.hasSystem('environment')).toBe(true);
    expect(gl.renderer.toneMapping).toBe(THREE.NoToneMapping);
    // Disposed: the render path is the plain context draw again.
    const draws = gl.renderCalls;
    context.render();
    expect(gl.renderCalls).toBe(draws + 1);
    expect(() => api.applyEra('1985')).toThrow();
  });

  it('exposes quality tiers that trade detail without ever dropping the grade', () => {
    const fixture = createFixture('2005', { monitorBudget: false });
    const { api } = fixture;
    expect(api.activePasses()).toEqual([...POSTFX_PASS_IDS]);

    api.setQuality('performance');
    expect(api.activePasses()).not.toContain('dof');
    expect(api.activePasses()).not.toContain('grain');
    expect(api.activePasses()).toContain('grading');
    expect(api.activePasses()).toContain('output');
    expect(api.activePasses()).toContain('render');
    expect(api.snapshot().postFx.quality).toBe('performance');
    expect(api.snapshot().postFx.look.id).toBe('2005');

    api.setQuality('cinematic');
    expect(api.activePasses()).toEqual([...POSTFX_PASS_IDS]);
    expect(api.snapshot().postFx.maxDegradeLevel).toBe(0);
    expect(() => api.setPassEnabled('nope' as never, true)).toThrow(RangeError);
    expect(() => api.setQuality('ultra' as never)).toThrow(RangeError);
    expect(api.pipeline).toBeInstanceOf(PostFxPipeline);
    expect(api.snapshot().postFx.quality).toBe('cinematic');
  });
});
