/**
 * Cinematic post-processing pipeline for Chrono City.
 *
 * Wraps the renderer in a three.js `EffectComposer` chain that gives the block
 * its high-end look:
 *
 * ```
 * RenderPass → UnrealBloomPass → CinematicGradePass → OutputPass
 * ```
 *
 * - **RenderPass** draws the era geometry into a half-float HDR target. three
 *   keeps tone mapping disabled while rendering into a target, so the chain
 *   stays linear until the end.
 * - **UnrealBloomPass** extracts only the bright end of that linear frame, so
 *   emissive signage, warm windows and headlights bloom while the diffuse
 *   scene does not (`bloomThreshold` is derived per era and never drops below
 *   `0.82`). Its mip chain runs at `bloomScale` of the composer resolution.
 * - **CinematicGradePass** applies the per-era grade from `./colorGrading`
 *   (white balance, lift/gamma/gain, contrast, saturation, vignette and film
 *   grain) in one full-screen shader.
 * - **OutputPass** applies the renderer's ACES filmic tone mapping and sRGB
 *   output, which is why the pipeline configures the renderer for ACES.
 *
 * This module is strictly screen-space: it never touches `scene.fog`, the sky,
 * lights or material colours — environment-system owns per-era scene fog per
 * the environment-api contract. It only drives grade uniforms and the tone
 * mapping exposure.
 *
 * `applyEra(era, blend)` satisfies the shared `EraAware` contract and reuses
 * the era blend semantics, so grading morphs on the same value as scene
 * content. `resize` re-sizes the composer, every bloom render target and the
 * grain resolution, and `dispose` releases every target, material and pass.
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import { ERA_IDS, clampBlend, getEraConfig, type EraAware, type EraId } from "../era/eraTypes";
import {
  createMutableGrade,
  writeGrade,
  type ColorGrade,
  type MutableColorGrade,
} from "./colorGrading";

/* -------------------------------------------------------------------------- */
/* Tuning                                                                     */
/* -------------------------------------------------------------------------- */

/** Default bloom mip-chain scale against the composer resolution. */
export const DEFAULT_BLOOM_SCALE = 0.5;
/** Lowest accepted bloom scale; the pass runs blur mips at half of this again. */
export const MIN_BLOOM_SCALE = 0.125;
/** Highest accepted bloom scale; `1` matches the composer resolution. */
export const MAX_BLOOM_SCALE = 1;
/** Fallback frame delta for {@link CinematicPostFX.render}. */
export const DEFAULT_FRAME_DELTA = 1 / 60;
/** Render targets are never allowed to collapse to zero pixels. */
const MIN_RENDER_TARGET_SIZE = 1;
/** The earliest timeline stop, used when no initial era is supplied. */
const FIRST_ERA: EraId = ERA_IDS[0];

/* -------------------------------------------------------------------------- */
/* Structural renderer surface                                                */
/* -------------------------------------------------------------------------- */

/**
 * Per-frame grade uniform block of {@link CINEMATIC_GRADE_SHADER}.
 *
 * Kept as live `value` holders so `applyGrade` can mutate them in place instead
 * of rebuilding the uniform record.
 */
export interface GradeUniforms {
  tDiffuse: { value: THREE.Texture | null };
  contrast: { value: number };
  saturation: { value: number };
  lift: { value: THREE.Vector3 };
  gamma: { value: THREE.Vector3 };
  gain: { value: THREE.Vector3 };
  vignette: { value: number };
  vignetteRadius: { value: number };
  grain: { value: number };
  time: { value: number };
  resolution: { value: THREE.Vector2 };
}

/**
 * Minimal renderer surface the pipeline drives.
 *
 * `THREE.WebGLRenderer` satisfies this structurally, so production passes the
 * real renderer while tests can pass a GL-free stub. The method set is exactly
 * what `EffectComposer` and its passes call on the renderer.
 */
export interface PostFXRenderer {
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  outputColorSpace: string;
  autoClear: boolean;
  autoClearColor: boolean;
  autoClearDepth: boolean;
  autoClearStencil: boolean;
  getPixelRatio(): number;
  getSize(target: THREE.Vector2): THREE.Vector2;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  getClearColor(target: THREE.Color): THREE.Color;
  getClearAlpha(): number;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  setClearAlpha(alpha: number): void;
}

/** Renderer-independent viewport, structurally compatible with `core.Viewport`. */
export interface PostFXViewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

/* -------------------------------------------------------------------------- */
/* Grade shader                                                               */
/* -------------------------------------------------------------------------- */

const GRADE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GRADE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float contrast;
uniform float saturation;
uniform vec3 lift;
uniform vec3 gamma;
uniform vec3 gain;
uniform float vignette;
uniform float vignetteRadius;
uniform float grain;
uniform float time;
uniform vec2 resolution;

varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float PIVOT = 0.18;
const float DIAGONAL = 1.41421356;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  // Live frame, still in linear HDR (tone mapping happens in the output pass).
  vec3 color = max(texture2D(tDiffuse, vUv).rgb, vec3(0.0));

  // Lift / gamma / gain: out = pow(in * gain + lift, 1 / gamma).
  color = max(color * gain + lift, vec3(0.0));
  color = pow(color, vec3(1.0) / gamma);

  // Contrast around a linear mid-grey pivot so highlights do not clip early.
  color = (color - PIVOT) * contrast + PIVOT;

  // Saturation measured against Rec.709 luma.
  float luma = dot(color, LUMA);
  color = mix(vec3(luma), color, saturation);

  // Vignette: soft radial falloff, strongest in the corners.
  float radius = distance(vUv, vec2(0.5)) * DIAGONAL;
  float edge = smoothstep(vignetteRadius, 1.0, radius);
  color *= 1.0 - vignette * edge;

  // Subtle animated grain, resolution-scaled to keep the cell size stable.
  float noise = hash(vUv * resolution + time) - 0.5;
  color += noise * grain * 0.12;

  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

/**
 * Shader definition handed to `ShaderPass`.
 *
 * Inline GLSL keeps the pipeline self-contained: no external shader assets and
 * no network-loaded effects, per the task constraints. `ShaderPass` clones
 * these uniforms, so callers read the live values from `gradePass.uniforms`.
 */
export const CINEMATIC_GRADE_SHADER = {
  name: "CinematicGrade",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    contrast: { value: 1 },
    saturation: { value: 1 },
    lift: { value: new THREE.Vector3(0, 0, 0) },
    gamma: { value: new THREE.Vector3(1, 1, 1) },
    gain: { value: new THREE.Vector3(1, 1, 1) },
    vignette: { value: 0 },
    vignetteRadius: { value: 1 },
    grain: { value: 0 },
    time: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: GRADE_VERTEX_SHADER,
  fragmentShader: GRADE_FRAGMENT_SHADER,
} as const;

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                   */
/* -------------------------------------------------------------------------- */

export interface PostFXOptions {
  /** Renderer the composer wraps; receives ACES tone mapping on construction. */
  renderer: PostFXRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Initial viewport, normally produced by `core.normalizeViewport`. */
  viewport: PostFXViewport;
  /** Bloom mip-chain scale in `[MIN_BLOOM_SCALE, MAX_BLOOM_SCALE]`. */
  bloomScale?: number;
  /** Era applied at construction; defaults to the first timeline stop. */
  initialEra?: EraId;
}

/**
 * The composed pipeline plus the lifecycle surface scene-assembly drives.
 *
 * `render` replaces `renderer.render(scene, camera)`; `resize` replaces nothing
 * (the canvas size stays owned by `core`), it re-sizes the composer, bloom and
 * grade targets.
 */
export interface CinematicPostFX extends EraAware {
  /** Live grade, written in place by {@link applyEra} (no per-frame churn). */
  readonly grade: ColorGrade;
  readonly renderer: PostFXRenderer;
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly bloomPass: UnrealBloomPass;
  readonly gradePass: ShaderPass;
  readonly outputPass: OutputPass;
  /** Viewport currently applied to the composer and bloom targets. */
  readonly viewport: PostFXViewport;
  /** Bloom scale the pipeline was built with. */
  readonly bloomScale: number;
  /** Bloom target size in device pixels (composer size scaled by `bloomScale`). */
  readonly bloomSize: { readonly width: number; readonly height: number };
  /** Era the current blend is coming from. */
  readonly fromEra: EraId;
  /** Era the current blend is heading to. */
  readonly toEra: EraId;
  readonly disposed: boolean;
  resize(viewport: PostFXViewport): void;
  render(delta?: number): void;
  dispose(): void;
}

/**
 * Builds the cinematic pipeline around `options.renderer`.
 *
 * The renderer is switched to ACES filmic tone mapping immediately (the output
 * pass reads that setting), the composer and bloom mip chain are sized for the
 * supplied viewport, and the initial era is applied at full strength so the
 * very first frame is already graded.
 */
export function createCinematicPostFX(options: PostFXOptions): CinematicPostFX {
  const renderer = options.renderer;
  const scene = options.scene;
  const camera = options.camera;
  const bloomScale = clampBloomScale(options.bloomScale);
  const initialEra = options.initialEra ?? FIRST_ERA;
  getEraConfig(initialEra);

  // ACES filmic tone mapping is the app-wide look. three applies it only when
  // rendering to the screen, which is exactly what OutputPass does at the end.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  let viewport = normalizeViewport(options.viewport);
  const renderTarget = new THREE.WebGLRenderTarget(
    deviceWidth(viewport),
    deviceHeight(viewport),
    { type: THREE.HalfFloatType, depthBuffer: true },
  );
  renderTarget.texture.name = "cinematic-postfx";

  const composer = new EffectComposer(renderer as unknown as THREE.WebGLRenderer, renderTarget);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0, 1);
  const gradePass = new ShaderPass(CINEMATIC_GRADE_SHADER);
  const outputPass = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(gradePass);
  composer.addPass(outputPass);

  const uniforms = gradePass.uniforms as unknown as GradeUniforms;
  const grade: MutableColorGrade = createMutableGrade();
  const bloomSize = { width: MIN_RENDER_TARGET_SIZE, height: MIN_RENDER_TARGET_SIZE };
  let grainSeconds = 0;
  let fromEra: EraId = initialEra;
  let toEra: EraId = initialEra;
  let disposed = false;

  const assertLive = (): void => {
    if (disposed) {
      throw new Error("CinematicPostFX has been disposed.");
    }
  };

  /** Pushes the grade into the shader uniforms, bloom pass and tone mapping. */
  const applyGrade = (): void => {
    uniforms.contrast.value = grade.contrast;
    uniforms.saturation.value = grade.saturation;
    uniforms.lift.value.set(grade.lift[0], grade.lift[1], grade.lift[2]);
    uniforms.gamma.value.set(grade.gamma[0], grade.gamma[1], grade.gamma[2]);
    uniforms.gain.value.set(grade.gain[0], grade.gain[1], grade.gain[2]);
    uniforms.vignette.value = grade.vignette;
    uniforms.vignetteRadius.value = grade.vignetteRadius;
    uniforms.grain.value = grade.grain;
    bloomPass.strength = grade.bloomStrength;
    bloomPass.radius = grade.bloomRadius;
    bloomPass.threshold = grade.bloomThreshold;
    renderer.toneMappingExposure = grade.exposure;
  };

  /** Re-targets the composer, bloom mip chain and grain resolution. */
  const applyViewport = (next: PostFXViewport): void => {
    viewport = normalizeViewport(next);
    composer.setPixelRatio(viewport.pixelRatio);
    composer.setSize(viewport.width, viewport.height);
    // Composer.setSize sizes every pass at full resolution; the bloom pass is
    // re-scaled afterwards so its mips stay cheap regardless of frame size.
    const width = Math.max(MIN_RENDER_TARGET_SIZE, Math.round(deviceWidth(viewport) * bloomScale));
    const height = Math.max(MIN_RENDER_TARGET_SIZE, Math.round(deviceHeight(viewport) * bloomScale));
    bloomPass.setSize(width, height);
    bloomSize.width = width;
    bloomSize.height = height;
    uniforms.resolution.value.set(viewport.width, viewport.height);
  };

  const applyEra = (era: EraId, rawBlend: number): void => {
    assertLive();
    getEraConfig(era);
    const blend = clampBlend(rawBlend);
    if (era !== toEra) {
      fromEra = toEra;
      toEra = era;
    }
    const progress = fromEra === toEra ? 1 : blend;
    writeGrade(fromEra, toEra, progress, grade);
    if (progress >= 1) {
      fromEra = toEra;
    }
    applyGrade();
  };

  applyViewport(viewport);
  applyEra(initialEra, 1);

  return {
    get grade() {
      return grade;
    },
    get renderer() {
      return renderer;
    },
    get composer() {
      return composer;
    },
    get renderPass() {
      return renderPass;
    },
    get bloomPass() {
      return bloomPass;
    },
    get gradePass() {
      return gradePass;
    },
    get outputPass() {
      return outputPass;
    },
    get viewport() {
      return viewport;
    },
    get bloomScale() {
      return bloomScale;
    },
    get bloomSize() {
      return bloomSize;
    },
    get fromEra() {
      return fromEra;
    },
    get toEra() {
      return toEra;
    },
    get disposed() {
      return disposed;
    },
    applyEra,
    resize(next: PostFXViewport) {
      assertLive();
      applyViewport(next);
    },
    render(delta: number = DEFAULT_FRAME_DELTA) {
      assertLive();
      const seconds = Number.isFinite(delta) ? Math.max(0, delta) : 0;
      // Advancing the grain clock is a scalar write: the frame path allocates
      // nothing at all.
      grainSeconds += seconds;
      uniforms.time.value = grainSeconds;
      composer.render(seconds);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      composer.removePass(outputPass);
      composer.removePass(gradePass);
      composer.removePass(bloomPass);
      composer.removePass(renderPass);
      gradePass.dispose();
      bloomPass.dispose();
      outputPass.dispose();
      renderPass.dispose();
      // Releases the composer's read/write buffers and its copy pass.
      composer.dispose();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function clampBloomScale(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_BLOOM_SCALE;
  }
  return Math.min(MAX_BLOOM_SCALE, Math.max(MIN_BLOOM_SCALE, value));
}

function normalizeViewport(viewport: PostFXViewport): PostFXViewport {
  const width = Math.max(1, Math.round(Number.isFinite(viewport.width) ? viewport.width : 0));
  const height = Math.max(1, Math.round(Number.isFinite(viewport.height) ? viewport.height : 0));
  const pixelRatio =
    Number.isFinite(viewport.pixelRatio) && viewport.pixelRatio > 0 ? viewport.pixelRatio : 1;
  return { width, height, pixelRatio };
}

function deviceWidth(viewport: PostFXViewport): number {
  return viewport.width * viewport.pixelRatio;
}

function deviceHeight(viewport: PostFXViewport): number {
  return viewport.height * viewport.pixelRatio;
}
