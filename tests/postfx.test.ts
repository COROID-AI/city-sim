import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ERAS,
  ERA_IDS,
  getEraConfig,
  resolveEraWeights,
  type EraId,
} from "../src/era/eraTypes";
import {
  createMutableGrade,
  deriveGrade,
  gradeForEra,
  interpolateGrade,
  toGrade,
  writeGrade,
  type ColorGrade,
} from "../src/render/colorGrading";
import {
  CINEMATIC_GRADE_SHADER,
  DEFAULT_BLOOM_SCALE,
  createCinematicPostFX,
  type CinematicPostFX,
  type GradeUniforms,
  type PostFXRenderer,
} from "../src/render/postfx";

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * GL-free stand-in for `THREE.WebGLRenderer`.
 *
 * `EffectComposer` only needs the renderer at construction (`getPixelRatio`)
 * and while rendering; every call it makes is recorded so the tests can assert
 * the frame path without a WebGL context.
 */
function makeStubRenderer(pixelRatio = 2): PostFXRenderer {
  return {
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    getPixelRatio: () => pixelRatio,
    getSize: (target: THREE.Vector2) => target.set(1280, 720),
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    render: vi.fn(),
    clear: vi.fn(),
    getClearColor: (target: THREE.Color) => target.setRGB(0, 0, 0),
    getClearAlpha: () => 1,
    setClearColor: vi.fn(),
    setClearAlpha: vi.fn(),
  };
}

function buildPipeline(overrides: { pixelRatio?: number; bloomScale?: number } = {}): {
  pipeline: CinematicPostFX;
  renderer: PostFXRenderer;
} {
  const renderer = makeStubRenderer(overrides.pixelRatio ?? 2);
  const pipeline = createCinematicPostFX({
    renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 800),
    viewport: { width: 1600, height: 900, pixelRatio: overrides.pixelRatio ?? 2 },
    bloomScale: overrides.bloomScale,
    initialEra: ERAS[0].id,
  });
  return { pipeline, renderer };
}

function uniform(pipeline: CinematicPostFX, name: keyof GradeUniforms): { value: unknown } {
  return pipeline.gradePass.uniforms[name] as { value: unknown };
}

/** Every numeric channel of a grade, for exhaustive comparisons. */
function gradeChannels(grade: ColorGrade): number[] {
  return [
    grade.exposure,
    grade.contrast,
    grade.saturation,
    grade.temperature,
    grade.tint,
    ...grade.lift,
    ...grade.gamma,
    ...grade.gain,
    grade.bloomStrength,
    grade.bloomRadius,
    grade.bloomThreshold,
    grade.vignette,
    grade.vignetteRadius,
    grade.grain,
  ];
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                 */
/* -------------------------------------------------------------------------- */

describe("per-era colour grade derivation", () => {
  it("derives each timeline stop from the era contract without drifting", () => {
    for (const era of ERAS) {
      const derived = deriveGrade(era);
      // The cached accessor and a fresh derivation of the frozen descriptor must
      // agree, and must be stable across repeated calls.
      expect(gradeChannels(gradeForEra(era.id))).toEqual(gradeChannels(derived));
      expect(gradeForEra(era.id)).toBe(gradeForEra(era.id));
      expect(gradeChannels(deriveGrade(getEraConfig(era.id)))).toEqual(gradeChannels(derived));
    }
  });

  it("gives every era a distinct grade", () => {
    const signatures = new Set(ERA_IDS.map((id) => gradeChannels(gradeForEra(id)).join(",")));
    expect(signatures.size).toBe(ERA_IDS.length);
  });

  it("keeps every channel inside its documented range", () => {
    for (const id of ERA_IDS) {
      const grade = gradeForEra(id);
      expect(grade.exposure).toBeGreaterThanOrEqual(0.8);
      expect(grade.exposure).toBeLessThanOrEqual(1.4);
      expect(grade.contrast).toBeGreaterThanOrEqual(0.85);
      expect(grade.contrast).toBeLessThanOrEqual(1.25);
      expect(grade.saturation).toBeGreaterThanOrEqual(0.6);
      expect(grade.saturation).toBeLessThanOrEqual(1.15);
      expect(Math.abs(grade.temperature)).toBeLessThanOrEqual(1);
      expect(Math.abs(grade.tint)).toBeLessThanOrEqual(0.25);
      for (const channel of [...grade.lift, ...grade.gamma, ...grade.gain]) {
        expect(channel).toBeGreaterThan(0);
      }
      expect(grade.bloomStrength).toBeGreaterThanOrEqual(0.25);
      expect(grade.bloomStrength).toBeLessThanOrEqual(1.4);
      expect(grade.bloomRadius).toBeGreaterThanOrEqual(0.2);
      expect(grade.bloomRadius).toBeLessThanOrEqual(0.8);
      // Selective bloom: the threshold must stay high enough that the diffuse
      // frame does not wash out.
      expect(grade.bloomThreshold).toBeGreaterThanOrEqual(0.82);
      expect(grade.bloomThreshold).toBeLessThanOrEqual(0.96);
      expect(grade.vignette).toBeGreaterThanOrEqual(0.12);
      expect(grade.vignette).toBeLessThanOrEqual(0.55);
      expect(grade.vignetteRadius).toBeGreaterThanOrEqual(0.55);
      expect(grade.vignetteRadius).toBeLessThanOrEqual(0.95);
      expect(grade.grain).toBeGreaterThanOrEqual(0.08);
      expect(grade.grain).toBeLessThanOrEqual(0.42);
    }
  });

  it("separates warm hazy 1945 from crisp cool 2025", () => {
    const past = gradeForEra("1945");
    const future = gradeForEra("2025");

    // Warm vs cool, realised through the per-channel gain as well as reported
    // by the temperature channel.
    expect(past.temperature).toBeGreaterThan(0);
    expect(future.temperature).toBeLessThan(0);
    expect(past.temperature).toBeGreaterThan(future.temperature);
    expect(past.gain[0]).toBeGreaterThan(past.gain[2]);
    expect(future.gain[2]).toBeGreaterThan(future.gain[0]);

    // Desaturated, hazy, flat and grainy vs saturated, crisp, high-key, clean.
    expect(past.saturation).toBeLessThan(future.saturation);
    expect(past.contrast).toBeLessThan(future.contrast);
    expect(past.exposure).toBeLessThan(future.exposure);
    expect(past.grain).toBeGreaterThan(future.grain);
    expect(past.vignette).toBeGreaterThan(future.vignette);

    // A hazy era lifts warm; a clean era barely lifts at all, and coolest in red.
    expect(past.lift[0]).toBeGreaterThan(past.lift[2]);
    expect(past.lift[0]).toBeGreaterThan(future.lift[0]);
    expect(future.lift[2]).toBeGreaterThan(future.lift[0]);
  });

  it("gives the neon 1985 dusk the strongest and widest bloom", () => {
    const neon = gradeForEra("1985");
    const painted = gradeForEra("1945");
    for (const id of ERA_IDS) {
      expect(neon.bloomStrength).toBeGreaterThanOrEqual(gradeForEra(id).bloomStrength);
    }
    expect(neon.bloomStrength).toBeGreaterThan(painted.bloomStrength);
    expect(neon.bloomRadius).toBeGreaterThan(painted.bloomRadius);
    // A brighter era lowers the cut-off, but never below the selective floor.
    expect(neon.bloomThreshold).toBeLessThan(painted.bloomThreshold);
  });
});

/* -------------------------------------------------------------------------- */
/* Blending                                                                   */
/* -------------------------------------------------------------------------- */

describe("era-blend interpolation", () => {
  const pairs: ReadonlyArray<readonly [EraId, EraId]> = [
    ["1945", "1965"],
    ["1965", "2025"],
    ["2025", "1945"],
    ["1985", "1985"],
  ];
  const blends = [0, 0.25, 0.5, 0.75, 1, -0.5, 1.5, Number.NaN];

  it("matches the era contract's resolveEraWeights spread exactly", () => {
    for (const [from, to] of pairs) {
      for (const blend of blends) {
        const viaContract = interpolateGrade(from, to, blend);
        const viaWrite = toGrade(writeGrade(from, to, blend, createMutableGrade()));
        expect(gradeChannels(viaWrite)).toEqual(gradeChannels(viaContract));
      }
    }
  });

  it("interpolates linearly at the midpoint", () => {
    const from = gradeForEra("1945");
    const to = gradeForEra("2025");
    const half = interpolateGrade("1945", "2025", 0.5);
    const expectedWeights = resolveEraWeights("1945", "2025", 0.5);
    expect(expectedWeights["1945"]).toBeCloseTo(0.5, 12);
    expect(expectedWeights["2025"]).toBeCloseTo(0.5, 12);

    expect(half.contrast).toBeCloseTo(from.contrast * 0.5 + to.contrast * 0.5, 12);
    expect(half.saturation).toBeCloseTo(from.saturation * 0.5 + to.saturation * 0.5, 12);
    expect(half.temperature).toBeCloseTo(from.temperature * 0.5 + to.temperature * 0.5, 12);
    expect(half.grain).toBeCloseTo(from.grain * 0.5 + to.grain * 0.5, 12);
  });

  it("returns the endpoint grades at blend 0 and 1 and clamps out-of-range input", () => {
    for (const [from, to] of pairs) {
      expect(gradeChannels(interpolateGrade(from, to, 0))).toEqual(gradeChannels(gradeForEra(from)));
      expect(gradeChannels(interpolateGrade(from, to, 1))).toEqual(gradeChannels(gradeForEra(to)));
      expect(gradeChannels(interpolateGrade(from, to, -3))).toEqual(gradeChannels(gradeForEra(from)));
      expect(gradeChannels(interpolateGrade(from, to, 4))).toEqual(gradeChannels(gradeForEra(to)));
      // NaN (an untouched slider) resolves to the fully "from" state.
      expect(gradeChannels(interpolateGrade(from, to, Number.NaN))).toEqual(
        gradeChannels(gradeForEra(from)),
      );
    }
  });

  it("writes into the supplied buffer without replacing it", () => {
    const buffer = createMutableGrade();
    const lift = buffer.lift;
    const gain = buffer.gain;
    const returned = writeGrade("1945", "2025", 0.4, buffer);
    expect(returned).toBe(buffer);
    expect(buffer.lift).toBe(lift);
    expect(buffer.gain).toBe(gain);
  });

  it("throws on an era id outside the contract", () => {
    expect(() => gradeForEra("1999" as EraId)).toThrow(/Unknown Chrono City era/);
    expect(() => interpolateGrade("1999" as EraId, "2025", 0.5)).toThrow(/Unknown Chrono City era/);
    expect(() => interpolateGrade("1945", "1999" as EraId, 0.5)).toThrow(/Unknown Chrono City era/);
    expect(() => writeGrade("1999" as EraId, "2025", 0.5, createMutableGrade())).toThrow(
      /Unknown Chrono City era/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Pipeline composition                                                       */
/* -------------------------------------------------------------------------- */

describe("cinematic post-processing pipeline", () => {
  let pipeline: CinematicPostFX;
  let renderer: PostFXRenderer;

  beforeEach(() => {
    ({ pipeline, renderer } = buildPipeline());
  });

  afterEach(() => {
    pipeline.dispose();
  });

  it("wires ACES filmic tone mapping and the composer pass order", () => {
    // ACES is applied by the output pass, which reads the renderer setting.
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(pipeline.outputPass.isOutputPass).toBe(true);

    const order = pipeline.composer.passes;
    expect(order).toContain(pipeline.renderPass);
    expect(order).toContain(pipeline.bloomPass);
    expect(order).toContain(pipeline.gradePass);
    expect(order).toContain(pipeline.outputPass);
    expect(order.indexOf(pipeline.renderPass)).toBeLessThan(order.indexOf(pipeline.bloomPass));
    expect(order.indexOf(pipeline.bloomPass)).toBeLessThan(order.indexOf(pipeline.gradePass));
    expect(order.indexOf(pipeline.gradePass)).toBeLessThan(order.indexOf(pipeline.outputPass));

    // The grade pass reads the composited frame through the ShaderPass default.
    expect(pipeline.gradePass.textureID).toBe("tDiffuse");
    expect(CINEMATIC_GRADE_SHADER.fragmentShader).toContain("texture2D(tDiffuse, vUv)");
  });

  it("applies each era's grade to the uniforms, bloom trim and exposure", () => {
    for (const id of ERA_IDS) {
      pipeline.applyEra(id, 1);
      const expected = gradeForEra(id);

      expect(pipeline.toEra).toBe(id);
      expect(pipeline.grade.contrast).toBeCloseTo(expected.contrast, 12);
      expect(uniform(pipeline, "contrast").value).toBeCloseTo(expected.contrast, 12);
      expect(uniform(pipeline, "saturation").value).toBeCloseTo(expected.saturation, 12);
      expect((uniform(pipeline, "lift").value as THREE.Vector3).toArray()).toEqual([
        ...expected.lift,
      ]);
      expect((uniform(pipeline, "gamma").value as THREE.Vector3).toArray()).toEqual([
        ...expected.gamma,
      ]);
      expect((uniform(pipeline, "gain").value as THREE.Vector3).toArray()).toEqual([
        ...expected.gain,
      ]);
      expect(uniform(pipeline, "vignette").value).toBeCloseTo(expected.vignette, 12);
      expect(uniform(pipeline, "vignetteRadius").value).toBeCloseTo(expected.vignetteRadius, 12);
      expect(uniform(pipeline, "grain").value).toBeCloseTo(expected.grain, 12);

      expect(pipeline.bloomPass.strength).toBeCloseTo(expected.bloomStrength, 12);
      expect(pipeline.bloomPass.radius).toBeCloseTo(expected.bloomRadius, 12);
      expect(pipeline.bloomPass.threshold).toBeCloseTo(expected.bloomThreshold, 12);
      expect(renderer.toneMappingExposure).toBeCloseTo(expected.exposure, 12);
    }
  });

  it("morphs the grade with the same blend value as scene content", () => {
    pipeline.applyEra("1945", 1);
    expect(pipeline.fromEra).toBe("1945");
    expect(pipeline.toEra).toBe("1945");

    // Mid-morph: blend 0 is fully the outgoing era, 1 fully the incoming one.
    pipeline.applyEra("2025", 0.35);
    expect(pipeline.fromEra).toBe("1945");
    expect(pipeline.toEra).toBe("2025");
    const mid = interpolateGrade("1945", "2025", 0.35);
    expect(pipeline.grade.contrast).toBeCloseTo(mid.contrast, 12);
    expect(pipeline.grade.temperature).toBeCloseTo(mid.temperature, 12);
    expect(uniform(pipeline, "contrast").value).toBeCloseTo(mid.contrast, 12);

    pipeline.applyEra("2025", 0.85);
    const late = interpolateGrade("1945", "2025", 0.85);
    expect(pipeline.grade.contrast).toBeCloseTo(late.contrast, 12);
    expect(pipeline.grade.saturation).toBeCloseTo(late.saturation, 12);

    // Settling at blend 1 retargets the baseline, so the next morph starts here.
    pipeline.applyEra("2025", 1);
    expect(pipeline.fromEra).toBe("2025");
    expect(pipeline.toEra).toBe("2025");
    expect(gradeChannels(pipeline.grade)).toEqual(gradeChannels(gradeForEra("2025")));

    // Repeated identical calls are idempotent.
    const settled = gradeChannels(pipeline.grade);
    pipeline.applyEra("2025", 1);
    expect(gradeChannels(pipeline.grade)).toEqual(settled);
  });

  it("resizes the composer, the bloom mip chain and the grain resolution", () => {
    // Default viewport: 1600x900 @ dpr 2 -> 3200x1800 composer, half-res bloom.
    expect(pipeline.composer.renderTarget1.width).toBe(3200);
    expect(pipeline.composer.renderTarget1.height).toBe(1800);
    expect(pipeline.bloomScale).toBe(DEFAULT_BLOOM_SCALE);
    expect(pipeline.bloomSize.width).toBe(1600);
    expect(pipeline.bloomSize.height).toBe(900);

    // Bloom runs at a coarser resolution than the composed frame.
    expect(pipeline.bloomSize.width).toBeLessThan(pipeline.composer.renderTarget1.width);
    expect(pipeline.bloomPass.renderTargetBright.width).toBe(800);
    expect(pipeline.bloomPass.renderTargetsHorizontal).toHaveLength(pipeline.bloomPass.nMips);
    for (const target of pipeline.bloomPass.renderTargetsHorizontal) {
      expect(target.width).toBeGreaterThanOrEqual(1);
      expect(target.width).toBeLessThanOrEqual(pipeline.bloomSize.width);
    }
    for (const target of pipeline.bloomPass.renderTargetsVertical) {
      expect(target.width).toBeGreaterThanOrEqual(1);
    }
    expect((uniform(pipeline, "resolution").value as THREE.Vector2).toArray()).toEqual([1600, 900]);

    // Re-size: every render target and pass follows the new viewport.
    pipeline.resize({ width: 1280, height: 720, pixelRatio: 1 });
    expect(pipeline.viewport).toEqual({ width: 1280, height: 720, pixelRatio: 1 });
    expect(pipeline.composer.renderTarget1.width).toBe(1280);
    expect(pipeline.composer.renderTarget2.height).toBe(720);
    expect(pipeline.bloomSize.width).toBe(640);
    expect(pipeline.bloomSize.height).toBe(360);
    expect(pipeline.bloomPass.renderTargetBright.width).toBe(320);
    expect((uniform(pipeline, "resolution").value as THREE.Vector2).toArray()).toEqual([1280, 720]);

    // Degenerate input is clamped instead of producing zero-sized targets.
    pipeline.resize({ width: 0, height: 0, pixelRatio: 0 });
    expect(pipeline.viewport.width).toBe(1);
    expect(pipeline.viewport.height).toBe(1);
    expect(pipeline.viewport.pixelRatio).toBe(1);
    expect(pipeline.bloomSize.width).toBeGreaterThanOrEqual(1);
  });

  it("renders the composed frame without allocating per-frame state", () => {
    pipeline.applyEra("1945", 1);
    const gradeBuffer = pipeline.grade;
    const liftBuffer = pipeline.grade.lift;
    const bloomPass = pipeline.bloomPass;
    const composer = pipeline.composer;
    const contrastUniform = pipeline.gradePass.uniforms["contrast"];
    const liftUniform = pipeline.gradePass.uniforms["lift"];
    const liftValue = liftUniform.value;
    const timeUniform = pipeline.gradePass.uniforms["time"];

    pipeline.render(1 / 60);
    pipeline.render(1 / 60);
    pipeline.applyEra("2025", 0.5);
    pipeline.render(1 / 60);

    expect(renderer.render).toHaveBeenCalled();
    expect(composer.renderTarget1.width).toBeGreaterThan(0);

    // State is mutated in place: the grade buffer, uniform holders, vector
    // values and passes all keep their identity across frames.
    expect(pipeline.grade).toBe(gradeBuffer);
    expect(pipeline.grade.lift).toBe(liftBuffer);
    expect(pipeline.bloomPass).toBe(bloomPass);
    expect(pipeline.composer).toBe(composer);
    expect(pipeline.gradePass.uniforms["contrast"]).toBe(contrastUniform);
    expect(pipeline.gradePass.uniforms["lift"]).toBe(liftUniform);
    expect(pipeline.gradePass.uniforms["lift"].value).toBe(liftValue);
    expect(pipeline.gradePass.uniforms["time"]).toBe(timeUniform);
    // The grain clock advanced by exactly the deltas that were rendered.
    expect(timeUniform.value).toBeCloseTo(3 / 60, 12);
  });

  it("disposes every pass and target and rejects use after teardown", () => {
    const composer = pipeline.composer;
    const gradePass = pipeline.gradePass;
    const bloomPass = pipeline.bloomPass;
    const outputPass = pipeline.outputPass;
    const renderPass = pipeline.renderPass;

    const spies = [
      vi.spyOn(gradePass, "dispose"),
      vi.spyOn(bloomPass, "dispose"),
      vi.spyOn(outputPass, "dispose"),
      vi.spyOn(renderPass, "dispose"),
      vi.spyOn(composer, "dispose"),
      vi.spyOn(composer.renderTarget1, "dispose"),
      vi.spyOn(composer.renderTarget2, "dispose"),
      vi.spyOn(bloomPass.renderTargetBright, "dispose"),
    ];
    const bloomTargetSpies = bloomPass.renderTargetsHorizontal.map((target) =>
      vi.spyOn(target, "dispose"),
    );

    pipeline.dispose();

    for (const spy of spies) {
      expect(spy).toHaveBeenCalled();
    }
    for (const spy of bloomTargetSpies) {
      expect(spy).toHaveBeenCalled();
    }
    expect(composer.passes).toHaveLength(0);
    expect(pipeline.disposed).toBe(true);

    expect(() => pipeline.render(1 / 60)).toThrow(/disposed/);
    expect(() => pipeline.applyEra("2025", 1)).toThrow(/disposed/);
    expect(() => pipeline.resize({ width: 100, height: 100, pixelRatio: 1 })).toThrow(/disposed/);

    // Teardown is idempotent.
    expect(() => pipeline.dispose()).not.toThrow();
  });

  it("accepts the real WebGL renderer surface", () => {
    // Compile-time integration guard: production passes a real WebGLRenderer.
    const acceptsRenderer = (value: THREE.WebGLRenderer): PostFXRenderer => value;
    expect(acceptsRenderer).toBeTypeOf("function");
  });
});
