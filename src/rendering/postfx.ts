/**
 * Chrono City — post-processing pipeline (the EffectComposer stack).
 *
 * One composer, eight passes, one job: turn the raw block render into a graded
 * frame that reads as the selected era.
 *
 *   render    RenderPass          — the block, drawn into a half-float HDR buffer
 *   dof       BokehPass           — subtle depth-of-field (droppable)
 *   bloom     UnrealBloomPass     — neon / media halation
 *   grading   ShaderPass          — per-era LUT curves, exposure, white balance,
 *                                   contrast, saturation, sepia, aerial haze
 *   output    OutputPass          — ACES tone mapping + sRGB encode
 *   vignette  ShaderPass          — era vignette, tinted by the environment fog
 *   sweep     ShaderPass          — the transition sweep band and flash
 *   grain     ShaderPass          — film grain (droppable)
 *
 * Guarantees this module owns:
 *   - **Capped pixel ratio.** `resolveCappedPixelRatio()` clamps the device
 *     pixel ratio to `<= 2` and additionally to `MAX_RENDER_PIXELS`, so a 4K
 *     surface cannot quietly quadruple the frame cost.
 *   - **No per-frame allocations.** Render targets, uniforms, colours, the LUT
 *     payload and the grain resolution vector are created once and mutated in
 *     place; the era LUT is only re-baked while a transition actually runs.
 *   - **Graceful degradation.** A rolling frame-time average drives a drop
 *     ladder (`dof` → `grain` → `bloom`); tone mapping (`output`) and grading
 *     are never dropped, and a composer that throws falls back to a plain draw
 *     instead of stalling the render loop.
 *   - **Conflict boundary.** Sky, fog and lights belong to the environment task:
 *     this pipeline only *reads* `EnvironmentApi.gradeState()` (exposure, fog
 *     colour/range, neon intensity) and never mutates a light or the scene fog.
 *
 * Lifecycle:
 *   create    → `new PostFxPipeline({ context })` / `createPostFxPipeline()`.
 *   consume   → `setGradeBlend()` / `setEnvironmentGrade()` / `setSize()` /
 *               `render(delta)` each frame; `snapshot()` to observe.
 *   integrate → `RenderPipelineApi` owns the instance, wraps
 *               `SceneContext.render()` with `render()` and publishes it.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';

import { ERA_IDS, clamp01, type EraId } from '../core/eraContracts';
import type { SceneContext } from '../core/sceneContext';
import type { EnvironmentGradeState } from '../environment/skyAndLighting';
import {
  CONTRAST_PIVOT,
  GRADING_LUT_SIZE,
  LUMA_WEIGHTS,
  atmosphereWeightFrom,
  bakeBlendedGradingLut,
  createGradingLutData,
  getGradingLook,
  hexToLinearRgb,
  linearRgbToHex,
  resolveGradeLook,
  sampleGradingLut,
  writeSweepState,
  type EraGradeLook,
  type LinearRGB,
  type MutableSweepState,
  type SweepState,
} from './eraGrading';

export const POSTFX_VERSION = 1;

/** Hard ceiling on the device pixel ratio the composer will render at. */
export const MAX_PIXEL_RATIO = 2;

/** Floor for the pixel ratio, so the degrade path can never black the frame out. */
export const MIN_PIXEL_RATIO = 0.5;

/**
 * Pixel budget for the HDR render buffers: 1080p at the maximum pixel ratio.
 * Wider surfaces trade pixel ratio for frame time instead of blowing the budget.
 */
export const MAX_RENDER_PIXELS = 1920 * 1080 * MAX_PIXEL_RATIO * MAX_PIXEL_RATIO;

/** Frame budget the degrade ladder guards: 60 fps. */
export const DEFAULT_FRAME_BUDGET_MS = 1000 / 60;

/** Composer pass order. Also the order the passes are added in. */
export const POSTFX_PASS_IDS = Object.freeze([
  'render',
  'dof',
  'bloom',
  'grading',
  'output',
  'vignette',
  'sweep',
  'grain',
] as const);

export type PostFxPassId = (typeof POSTFX_PASS_IDS)[number];

/** Passes that keep the frame readable and are therefore never dropped. */
export const POSTFX_CORE_PASS_IDS: readonly PostFxPassId[] = Object.freeze([
  'render',
  'grading',
  'output',
]);

/** Order the budget guard sacrifices detail in. */
export const POSTFX_DEGRADE_LADDER: readonly PostFxPassId[] = Object.freeze([
  'dof',
  'grain',
  'bloom',
]);

/* ------------------------------------------------------------------------- *
 * Quality tiers
 * ------------------------------------------------------------------------- */

export type PostFxQuality = 'cinematic' | 'high' | 'balanced' | 'performance';

export interface PostFxQualitySettings {
  /** Passes enabled at this tier before the budget guard runs. */
  readonly enabled: readonly PostFxPassId[];
  /** Multiplier on the bloom pass resolution. */
  readonly bloomScale: number;
  /** Multiplier on the capped pixel ratio. */
  readonly pixelRatioScale: number;
  /** Deepest degrade level this tier tolerates. */
  readonly maxDegradeLevel: number;
}

/** Per-tier settings. `high` is the shipped default; the rest are fallbacks. */
export const POSTFX_QUALITY_SETTINGS: Readonly<Record<PostFxQuality, PostFxQualitySettings>> =
  Object.freeze({
    cinematic: Object.freeze({
      enabled: POSTFX_PASS_IDS,
      bloomScale: 1,
      pixelRatioScale: 1,
      maxDegradeLevel: 0,
    }),
    high: Object.freeze({
      enabled: POSTFX_PASS_IDS,
      bloomScale: 1,
      pixelRatioScale: 1,
      maxDegradeLevel: 2,
    }),
    balanced: Object.freeze({
      enabled: POSTFX_PASS_IDS.filter((id) => id !== 'dof'),
      bloomScale: 0.75,
      pixelRatioScale: 1,
      maxDegradeLevel: 2,
    }),
    performance: Object.freeze({
      enabled: POSTFX_PASS_IDS.filter((id) => id !== 'dof' && id !== 'grain'),
      bloomScale: 0.5,
      pixelRatioScale: 0.9,
      maxDegradeLevel: 3,
    }),
  });

/* ------------------------------------------------------------------------- *
 * Shaders
 * ------------------------------------------------------------------------- */

const PASSTHROUGH_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Era grading, applied to the linear HDR buffer. The step order mirrors
 * `applyLookToColor()` in `eraGrading.ts` exactly — that CPU function is the
 * reference the tests assert against.
 */
const LUMA_GLSL = `vec3(${LUMA_WEIGHTS.join(', ')})`;

const GRADING_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D uLut;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uSepia;
uniform float uTemperature;
uniform float uTint;
uniform float uShadowLift;
uniform float uHighlightRoll;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform vec3 uFogColor;
uniform float uHaze;
varying vec2 vUv;

const float PIVOT = ${CONTRAST_PIVOT};

vec3 applyCurve(vec3 color) {
  // One LUT texel per channel: the channel shaper composed with the master curve.
  float r = texture2D(uLut, vec2(clamp(color.r, 0.0, 1.0), 0.5)).r;
  float g = texture2D(uLut, vec2(clamp(color.g, 0.0, 1.0), 0.5)).g;
  float b = texture2D(uLut, vec2(clamp(color.b, 0.0, 1.0), 0.5)).b;
  // Energy above 1.0 rides over the curve so bloom keeps its halation.
  return vec3(r + max(color.r - 1.0, 0.0), g + max(color.g - 1.0, 0.0), b + max(color.b - 1.0, 0.0));
}

void main() {
  vec3 color = max(texture2D(tDiffuse, vUv).rgb, vec3(0.0));

  // 1. era exposure bias. (The environment owns renderer.toneMappingExposure.)
  color *= uExposure;

  // 2. white balance: temperature red<->blue, tint green<->magenta.
  color *= vec3(
    1.0 + 0.18 * uTemperature + 0.04 * uTint,
    1.0 - 0.08 * uTint,
    1.0 - 0.18 * uTemperature + 0.04 * uTint
  );

  // 3. contrast around linear mid-grey.
  color = vec3(PIVOT) * pow(max(color, vec3(1e-5)) / PIVOT, vec3(uContrast));

  // 4. saturation.
  float luma = dot(color, ${LUMA_GLSL});
  color = mix(vec3(luma), color, uSaturation);

  // 5. shadow lift / 6. highlight roll.
  float shadowWeight = 1.0 - smoothstep(0.02, 0.45, luma);
  float highlightWeight = smoothstep(0.5, 1.6, luma);
  color += uShadowTint * uShadowLift * shadowWeight;
  color += uHighlightTint * uHighlightRoll * highlightWeight;

  // 7. sepia mix.
  if (uSepia > 0.0) {
    float warm = dot(color, ${LUMA_GLSL});
    color = mix(color, vec3(warm * 1.07, warm * 0.94, warm * 0.74), uSepia);
  }

  // 8. aerial haze from the environment's fog (read-only use of its context).
  if (uHaze > 0.0) {
    float depth = 0.35 + 0.65 * clamp(dot(color, ${LUMA_GLSL}), 0.0, 1.0);
    color = mix(color, uFogColor * depth, uHaze);
  }

  // 9. per-channel grading curve.
  color = applyCurve(color);

  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

/** Era vignette, applied in display space after tone mapping. */
const VIGNETTE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 uColor;
uniform float uStrength;
uniform float uPower;
varying vec2 vUv;

void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  vec2 centered = (vUv - 0.5) * 2.0;
  float distanceFromCentre = clamp(length(centered) * 0.7071, 0.0, 1.0);
  float falloff = pow(distanceFromCentre, max(uPower, 0.01));
  vec3 color = mix(texel.rgb, uColor, clamp(falloff * uStrength, 0.0, 1.0));
  gl_FragColor = vec4(color, texel.a);
}
`;

/**
 * Film grain. Cell-based so the grain keeps a constant physical size at any
 * resolution, and weighted so shadows show more grain than highlights — which is
 * what makes 1945 read as newsreel stock rather than noise.
 */
const GRAIN_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSeed;
uniform float uGrain;
uniform float uGrainScale;
varying vec2 vUv;

float hash(vec2 cell) {
  return fract(sin(dot(cell, vec2(12.9898, 78.233)) + uSeed) * 43758.5453123);
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  vec3 color = texel.rgb;

  if (uGrain > 0.0) {
    vec2 cell = floor(vUv * uResolution / max(uGrainScale, 0.5)) + vec2(floor(uTime * 24.0) * 7.0, uSeed);
    float noise = hash(cell) - 0.5;
    float luma = dot(color, ${LUMA_GLSL});
    float weight = mix(1.0, 0.45, clamp(luma, 0.0, 1.0));
    color += vec3(noise * uGrain * weight);
  }

  gl_FragColor = vec4(max(color, vec3(0.0)), texel.a);
}
`;

/**
 * Transition sweep: a bright band travelling across the frame plus a soft
 * full-frame flash, both driven by the `TimelineRuntime` tween progress.
 */
const SWEEP_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uFlash;
uniform float uTravel;
varying vec2 vUv;

void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  vec3 color = texel.rgb;

  if (uIntensity > 0.0) {
    float band = 1.0 - smoothstep(0.0, 0.16, abs(vUv.x - uTravel));
    float ripple = 0.75 + 0.25 * sin(vUv.y * 48.0 + uTravel * 12.0);
    float sweep = band * ripple * uIntensity;
    float flash = uFlash * uIntensity;
    color = mix(color, uColor, clamp(sweep * 0.75, 0.0, 1.0));
    color += uColor * (sweep * 0.35 + flash * 0.25);
  }

  gl_FragColor = vec4(max(color, vec3(0.0)), texel.a);
}
`;

/* ------------------------------------------------------------------------- *
 * Pixel ratio
 * ------------------------------------------------------------------------- */

export interface PixelRatioRequest {
  /** `window.devicePixelRatio`, or the renderer's current ratio. */
  readonly devicePixelRatio: number;
  /** Requested ceiling; hard-clamped to `MAX_PIXEL_RATIO`. */
  readonly cap?: number;
  /** CSS width of the drawing surface. */
  readonly width: number;
  /** CSS height of the drawing surface. */
  readonly height: number;
  /** Pixel budget for the HDR buffers. Defaults to `MAX_RENDER_PIXELS`. */
  readonly maxPixels?: number;
}

/**
 * Resolves the pixel ratio the composer renders at: the device ratio clamped
 * into `[MIN_PIXEL_RATIO, min(cap, MAX_PIXEL_RATIO)]` (and by the quality tier
 * before it gets here), then reduced further when the resulting HDR buffer would
 * exceed `maxPixels`.
 */
export function resolveCappedPixelRatio(request: PixelRatioRequest): number {
  const pixels = Math.max(1, request.width * request.height);
  const requestedCap = Number.isFinite(request.cap) ? (request.cap as number) : MAX_PIXEL_RATIO;
  const cap = Math.min(MAX_PIXEL_RATIO, Math.max(MIN_PIXEL_RATIO, requestedCap));
  const device = Number.isFinite(request.devicePixelRatio) ? request.devicePixelRatio : 1;
  let ratio = Math.min(cap, Math.max(MIN_PIXEL_RATIO, device));

  const maxPixels = Number.isFinite(request.maxPixels)
    ? (request.maxPixels as number)
    : MAX_RENDER_PIXELS;
  if (maxPixels > 0) {
    const budgetRatio = Math.sqrt(maxPixels / pixels);
    if (ratio > budgetRatio) ratio = Math.max(MIN_PIXEL_RATIO, budgetRatio);
  }

  return ratio;
}

/* ------------------------------------------------------------------------- *
 * Reports
 * ------------------------------------------------------------------------- */

/** Live environment context copied out of `EnvironmentApi.gradeState()`. */
export interface PostFxEnvironmentContext {
  readonly exposure: number;
  readonly neonIntensity: number;
  readonly fogColor: number;
  readonly fogDensity: number;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly fogMode: 'linear' | 'exponential';
  readonly sourceEra: EraId;
}

/** Rolling frame-timing report; the "is this still 60 fps?" readout. */
export interface PostFxFrameTiming {
  readonly frameCount: number;
  readonly composedFrames: number;
  readonly fps: number;
  readonly averageFrameMs: number;
  readonly budgetMs: number;
  readonly withinBudget: boolean;
  readonly degradeLevel: number;
  readonly pixelRatio: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly renderPixels: number;
  readonly maxRenderPixels: number;
}

/** One pass and whether it is currently contributing to the frame. */
export interface PostFxPassReport {
  readonly id: PostFxPassId;
  /** Enabled in the quality tier / by the integrator. */
  readonly enabled: boolean;
  /** Disabled by the budget guard rather than by configuration. */
  readonly dropped: boolean;
  readonly core: boolean;
}

/** Everything a HUD, a test or the visual harness needs to read at once. */
export interface PostFxSnapshot {
  readonly version: number;
  readonly era: EraId;
  readonly from: EraId;
  readonly to: EraId;
  readonly progress: number;
  readonly transitioning: boolean;
  readonly look: { readonly id: EraId; readonly label: string; readonly description: string };
  readonly quality: PostFxQuality;
  readonly pixelRatio: number;
  readonly pixelRatioCap: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly renderPixels: number;
  readonly toneMapping: THREE.ToneMapping;
  readonly toneMappingExposure: number;
  readonly composerAvailable: boolean;
  readonly passes: readonly PostFxPassReport[];
  readonly droppedPasses: readonly PostFxPassId[];
  readonly degradeLevel: number;
  readonly maxDegradeLevel: number;
  readonly bloom: { readonly strength: number; readonly radius: number; readonly threshold: number };
  readonly dof: { readonly focus: number; readonly aperture: number; readonly maxBlur: number };
  readonly grain: number;
  readonly vignette: number;
  readonly exposure: { readonly grade: number; readonly environment: number };
  readonly fog: { readonly color: number; readonly density: number; readonly haze: number };
  readonly sweep: SweepState;
  readonly grade: { readonly lutSize: number; readonly lutMid: LinearRGB; readonly lutMidHex: number };
  readonly environment: PostFxEnvironmentContext | null;
  readonly environmentAttached: boolean;
  readonly lutBakes: number;
  readonly frameTiming: PostFxFrameTiming;
}

/* ------------------------------------------------------------------------- *
 * Options
 * ------------------------------------------------------------------------- */

export interface PostFxPipelineOptions {
  /** Shared scene context (required): renderer, scene, camera and viewport. */
  readonly context: SceneContext;
  /** Scene to compose. Defaults to `context.scene`. */
  readonly scene?: THREE.Scene;
  /** Camera to compose. Defaults to `context.camera`. */
  readonly camera?: THREE.Camera;
  /** Starting quality tier. Defaults to `'high'`. */
  readonly quality?: PostFxQuality;
  /** Pixel-ratio ceiling. Clamped to `MAX_PIXEL_RATIO`. Defaults to `2`. */
  readonly pixelRatioCap?: number;
  /** Pixel budget for the HDR buffers. Defaults to `MAX_RENDER_PIXELS`. */
  readonly maxRenderPixels?: number;
  /** Frame budget the degrade ladder guards. Defaults to `DEFAULT_FRAME_BUDGET_MS`. */
  readonly frameBudgetMs?: number;
  /** Deepest degrade level allowed. Defaults to the tier's own limit. */
  readonly maxDegradeLevel?: number;
  /** Tone mapping operator handed to the `OutputPass` path. Defaults to ACES. */
  readonly toneMapping?: THREE.ToneMapping;
  /** Era the pipeline starts graded for. Defaults to `2025`. */
  readonly initialEra?: EraId;
  /** Point the depth of field focuses on. Defaults to the block centre. */
  readonly focusTarget?: THREE.Vector3;
  /** Watch the frame time and drop passes. Defaults to `true`. */
  readonly monitorBudget?: boolean;
  /** Frames ignored by the budget guard before it starts reacting. Defaults to `45`. */
  readonly warmupFrames?: number;
  /** Frames over budget before a pass is dropped. Defaults to `30`. */
  readonly degradeAfterFrames?: number;
  /** Frames under budget before a pass is restored. Defaults to `150`. */
  readonly restoreAfterFrames?: number;
  /** Weight of the newest frame in the rolling average. Defaults to `0.1`. */
  readonly averageWeight?: number;
}

interface EnvironmentState {
  exposure: number;
  neonIntensity: number;
  fogColor: number;
  fogDensity: number;
  fogNear: number;
  fogFar: number;
  fogMode: 'linear' | 'exponential';
  sourceEra: EraId;
}

type UniformMap = Record<string, THREE.IUniform>;

const RAW_COLOR_SPACE = THREE.LinearSRGBColorSpace;

'0.18';

/* ------------------------------------------------------------------------- *
 * Pipeline
 * ------------------------------------------------------------------------- */

/**
 * The composer stack plus its budget guard, LUT baking and pass bookkeeping.
 * Headless-testable: with a stub renderer standing in for WebGL the whole pass
 * chain still constructs, updates its uniforms and runs its render loop.
 */
export class PostFxPipeline {
  readonly version = POSTFX_VERSION;

  readonly context: SceneContext;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;

  /** The Three.js composer everything is wired through. `null` after `dispose()`. */
  composer: EffectComposer | null = null;

  readonly pixelRatioCap: number;
  readonly maxRenderPixels: number;
  readonly frameBudgetMs: number;

  private qualityState: PostFxQuality;
  private maxDegradeLevelState: number;
  private readonly qualitySettings: PostFxQualitySettings;

  private readonly passMap = new Map<PostFxPassId, Pass>();
  private readonly baseEnabled = new Map<PostFxPassId, boolean>();
  private readonly focusTarget: THREE.Vector3;

  private readonly lutData: Uint8Array;
  private readonly lutTexture: THREE.DataTexture;
  private readonly gradingUniforms: UniformMap;
  private readonly vignetteUniforms: UniformMap;
  private readonly grainUniforms: UniformMap;
  private readonly sweepUniforms: UniformMap;
  private readonly dofUniforms: UniformMap;

  private gradeFrom: EraId;
  private gradeTo: EraId;
  private gradeProgress = 1;
  private gradeActive = false;
  private gradeDirection = 1;
  private gradeLook: EraGradeLook;
  /** Reused sweep state: the frame loop writes into it, observers copy it. */
  private readonly sweepScratch: MutableSweepState = {
    intensity: 0,
    flash: 0,
    travel: 0,
    color: 0,
    direction: 1,
  };
  /** Reused options object, so resolving the sweep allocates nothing. */
  private readonly sweepOptions: { active: boolean; direction: number } = {
    active: false,
    direction: 1,
  };

  private environment: EnvironmentState | null = null;
  private readonly environmentScratch: EnvironmentState = {
    exposure: 1,
    neonIntensity: 0,
    fogColor: 0xb8b3a6,
    fogDensity: 0,
    fogNear: 0,
    fogFar: 0,
    fogMode: 'linear',
    sourceEra: '2025',
  };
  private environmentLinearFog: LinearRGB = Object.freeze({ r: 0, g: 0, b: 0 });
  /** Cached "how hazy is this era's air" weight, refreshed with the fog fields. */
  private atmosphereWeightState = 0;

  private readonly sizeScratch = new THREE.Vector2();
  private readonly viewportSize = new THREE.Vector2(1, 1);
  private readonly renderSizeVector = new THREE.Vector2(1, 1);
  private pixelRatio = 1;
  private renderWidth = 1;
  private renderHeight = 1;

  private composedFrames = 0;
  private frameIndex = 0;
  private elapsedSeconds = 0;
  private averageFrameMs = 0;
  private timingSamples = 0;
  private overBudgetFrames = 0;
  private underBudgetFrames = 0;
  private warmupRemaining: number;
  private degradeLevel = 0;
  private readonly monitorBudget: boolean;
  private readonly degradeAfterFrames: number;
  private readonly restoreAfterFrames: number;
  private readonly averageWeight: number;

  private bakedFrom: EraId | null = null;
  private bakedTo: EraId | null = null;
  private bakedProgress = -1;
  private bakedActive = false;
  private lutBakes = 0;
  private bakeRequested = true;

  private composerAvailable = true;
  private readonly previousToneMapping: THREE.ToneMapping;
  private disposedState = false;

  constructor(options: PostFxPipelineOptions) {
    if (!options?.context) throw new TypeError('PostFxPipeline needs a SceneContext.');

    this.context = options.context;
    this.renderer = options.context.renderer;
    this.scene = options.scene ?? options.context.scene;
    this.camera = options.camera ?? options.context.camera;

    this.pixelRatioCap = Math.min(
      MAX_PIXEL_RATIO,
      Math.max(MIN_PIXEL_RATIO, options.pixelRatioCap ?? MAX_PIXEL_RATIO),
    );
    this.maxRenderPixels = options.maxRenderPixels ?? MAX_RENDER_PIXELS;
    this.frameBudgetMs = options.frameBudgetMs ?? DEFAULT_FRAME_BUDGET_MS;

    this.qualityState = options.quality ?? 'high';
    this.qualitySettings = POSTFX_QUALITY_SETTINGS[this.qualityState];
    this.maxDegradeLevelState =
      options.maxDegradeLevel ?? this.qualitySettings.maxDegradeLevel;

    this.monitorBudget = options.monitorBudget ?? true;
    this.warmupRemaining = Math.max(0, options.warmupFrames ?? 45);
    this.degradeAfterFrames = Math.max(1, options.degradeAfterFrames ?? 30);
    this.restoreAfterFrames = Math.max(1, options.restoreAfterFrames ?? 150);
    this.averageWeight = Math.min(1, Math.max(0.01, options.averageWeight ?? 0.1));

    this.focusTarget = options.focusTarget?.clone() ?? new THREE.Vector3(0, 0, 0);

    this.gradeFrom = options.initialEra ?? '2025';
    this.gradeTo = this.gradeFrom;
    this.gradeLook = getGradingLook(this.gradeFrom);
    writeSweepState(1, this.gradeLook, this.sweepOptions, this.sweepScratch);

    // Reused for the lifetime of the pipeline: baking only writes into it, and
    // the texture upload is flagged with `needsUpdate`, never reallocated.
    this.lutData = createGradingLutData(GRADING_LUT_SIZE);
    this.lutTexture = new THREE.DataTexture(
      this.lutData,
      GRADING_LUT_SIZE,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.lutTexture.name = 'chrono-era-grading-lut';
    this.lutTexture.minFilter = THREE.LinearFilter;
    this.lutTexture.magFilter = THREE.LinearFilter;
    this.lutTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.lutTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.lutTexture.generateMipmaps = false;
    this.lutTexture.needsUpdate = true;

    /* ---- passes -------------------------------------------------------- */

    const renderPass = new RenderPass(this.scene, this.camera);
    renderPass.clear = true;

    const dofPass = new BokehPass(this.scene, this.camera, {
      focus: 40,
      aperture: this.gradeLook.dof.aperture,
      maxblur: this.gradeLook.dof.maxBlur,
    });

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      this.gradeLook.bloom.strength,
      this.gradeLook.bloom.radius,
      this.gradeLook.bloom.threshold,
    );

    const gradingPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uLut: { value: this.lutTexture },
        uExposure: { value: 1 },
        uContrast: { value: 1 },
        uSaturation: { value: 1 },
        uSepia: { value: 0 },
        uTemperature: { value: 0 },
        uTint: { value: 0 },
        uShadowLift: { value: 0 },
        uHighlightRoll: { value: 0 },
        uShadowTint: { value: new THREE.Color(0, 0, 0) },
        uHighlightTint: { value: new THREE.Color(1, 1, 1) },
        uFogColor: { value: new THREE.Color(0, 0, 0) },
        uHaze: { value: 0 },
      },
      vertexShader: PASSTHROUGH_VERTEX_SHADER,
      fragmentShader: GRADING_FRAGMENT_SHADER,
    });

    const outputPass = new OutputPass();

    const vignettePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uColor: { value: new THREE.Color(0, 0, 0) },
        uStrength: { value: this.gradeLook.vignette },
        uPower: { value: this.gradeLook.vignettePower },
      },
      vertexShader: PASSTHROUGH_VERTEX_SHADER,
      fragmentShader: VIGNETTE_FRAGMENT_SHADER,
    });

    const sweepPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uIntensity: { value: 0 },
        uFlash: { value: 0 },
        uTravel: { value: 0 },
      },
      vertexShader: PASSTHROUGH_VERTEX_SHADER,
      fragmentShader: SWEEP_FRAGMENT_SHADER,
    });

    const grainPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uSeed: { value: 0 },
        uGrain: { value: this.gradeLook.grain },
        uGrainScale: { value: this.gradeLook.grainScale },
      },
      vertexShader: PASSTHROUGH_VERTEX_SHADER,
      fragmentShader: GRAIN_FRAGMENT_SHADER,
    });

    // ShaderPass clones its uniforms, so the maps below are the live ones; the
    // LUT texture is assigned afterwards to keep the exact instance we mutate.
    this.gradingUniforms = gradingPass.uniforms as UniformMap;
    this.vignetteUniforms = vignettePass.uniforms as UniformMap;
    this.sweepUniforms = sweepPass.uniforms as UniformMap;
    this.grainUniforms = grainPass.uniforms as UniformMap;
    this.dofUniforms = dofPass.uniforms as UniformMap;
    this.gradingUniforms['uLut']!.value = this.lutTexture;
    this.grainUniforms['uResolution']!.value = this.renderSizeVector;

    const entries: readonly (readonly [PostFxPassId, Pass])[] = [
      ['render', renderPass],
      ['dof', dofPass],
      ['bloom', bloomPass],
      ['grading', gradingPass],
      ['output', outputPass],
      ['vignette', vignettePass],
      ['sweep', sweepPass],
      ['grain', grainPass],
    ];
    for (const [id, pass] of entries) {
      this.passMap.set(id, pass);
      this.baseEnabled.set(id, POSTFX_QUALITY_SETTINGS[this.qualityState].enabled.includes(id));
    }

    /* ---- tone mapping -------------------------------------------------- */

    this.previousToneMapping = this.renderer.toneMapping;
    this.renderer.toneMapping = options.toneMapping ?? THREE.ACESFilmicToneMapping;

    /* ---- composer ------------------------------------------------------ */

    try {
      this.composer = new EffectComposer(this.renderer);
      for (const id of POSTFX_PASS_IDS) {
        const pass = this.passMap.get(id);
        if (pass) this.composer.addPass(pass);
      }
    } catch (error) {
      // A renderer that cannot host a composer (no GL, partial test double)
      // must not take the city down: fall back to the plain render path.
      this.composerAvailable = false;
      this.composer = null;
      console.error('[chrono-city] post-processing unavailable, rendering directly', error);
    }

    this.applyPassState();
    this.syncViewport(true);
    this.bakeLut();
  }

  /* ---------------- era state ---------------- */

  /** Era the frame is graded for (the target of a running tween). */
  get era(): EraId {
    return this.gradeTo;
  }

  /** Era the running tween started from. */
  get fromEra(): EraId {
    return this.gradeFrom;
  }

  /** Eased tween progress; `1` when settled. */
  get progress(): number {
    return this.gradeProgress;
  }

  get isTransitioning(): boolean {
    return this.gradeActive;
  }

  /** The look currently applied (interpolated while a tween runs). */
  get look(): EraGradeLook {
    return this.gradeLook;
  }

  /** Resolved sweep uniforms for the current frame (frozen copy). */
  get sweepState(): SweepState {
    return Object.freeze({ ...this.sweepScratch });
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  get quality(): PostFxQuality {
    return this.qualityState;
  }

  get isComposerAvailable(): boolean {
    return this.composerAvailable;
  }

  /** Pixel ratio the composer renders at (already capped). */
  get devicePixelRatio(): number {
    return this.pixelRatio;
  }

  /** Size of the HDR buffer in device pixels. */
  get renderSize(): { width: number; height: number } {
    return { width: this.renderWidth, height: this.renderHeight };
  }

  /* ---------------- grading ---------------- */

  /** Snaps the grade to one era with no sweep. */
  applyGradeLook(era: EraId): void {
    this.assertUsable();
    const look = getGradingLook(era);
    this.gradeFrom = look.id;
    this.gradeTo = look.id;
    this.gradeProgress = 1;
    this.gradeActive = false;
    this.gradeLook = look;
    this.sweepOptions.active = false;
    writeSweepState(1, look, this.sweepOptions, this.sweepScratch);
    this.bakeRequested = true;
  }

  /**
   * Sets the era blend for this frame. `progress` is the eased
   * `TimelineRuntime` value: `0` is fully `from`, `1` fully `to`.
   */
  setGradeBlend(
    from: EraId,
    to: EraId,
    progress: number,
    options: { active?: boolean; direction?: number } = {},
  ): void {
    this.assertUsable();
    const active = options.active ?? progress < 1;
    this.gradeFrom = from;
    this.gradeTo = to;
    this.gradeProgress = clamp01(progress);
    this.gradeActive = active && this.gradeFrom !== this.gradeTo;
    if (options.direction !== undefined) {
      this.gradeDirection = options.direction < 0 ? -1 : 1;
    }
    // While a tween runs the interpolated look is refreshed on the same cadence
    // as the LUT (see `refreshGrade()`), so the frame loop stays allocation-free.
    if (!this.gradeActive) this.gradeLook = getGradingLook(to);
    this.bakeRequested = true;
    this.sweepOptions.active = this.gradeActive;
    this.sweepOptions.direction = this.gradeDirection;
    writeSweepState(this.gradeProgress, this.gradeLook, this.sweepOptions, this.sweepScratch);
  }

  /** `1` when travelling towards newer eras, `-1` towards older ones. */
  get sweepDirection(): number {
    return this.gradeDirection;
  }

  /* ---------------- environment ---------------- */

  /**
   * Copies the environment's grade context for the coming frames. The pipeline
   * only reads it: exposure biases bloom energy, the fog colour and density feed
   * the aerial haze, and neon intensity adds bloom on top of the era's look.
   */
  setEnvironmentGrade(state: EnvironmentGradeState | null | undefined): void {
    if (state === null || state === undefined) {
      this.environment = null;
      return;
    }

    const scratch = this.environmentScratch;
    scratch.exposure = Number.isFinite(state.exposure) ? state.exposure : 1;
    scratch.neonIntensity = clamp01(state.neonIntensity);
    scratch.fogColor = state.fogColor >>> 0;
    scratch.fogDensity = Number.isFinite(state.fogDensity) ? state.fogDensity : 0;
    scratch.fogNear = Number.isFinite(state.fogNear) ? state.fogNear : 0;
    scratch.fogFar = Number.isFinite(state.fogFar) ? state.fogFar : 0;
    scratch.fogMode = state.fogMode === 'exponential' ? 'exponential' : 'linear';
    scratch.sourceEra = state.sourceEra;

    this.environmentLinearFog = hexToLinearRgb(scratch.fogColor);
    this.atmosphereWeightState = atmosphereWeightFrom(
      scratch.fogDensity,
      scratch.fogNear,
      scratch.fogFar,
      scratch.fogMode,
    );
    this.environment = scratch;
  }

  /** Frozen copy of the environment context the pipeline is grading against. */
  environmentContext(): PostFxEnvironmentContext | null {
    const state = this.environment;
    if (!state) return null;
    return Object.freeze({
      exposure: state.exposure,
      neonIntensity: state.neonIntensity,
      fogColor: state.fogColor,
      fogDensity: state.fogDensity,
      fogNear: state.fogNear,
      fogFar: state.fogFar,
      fogMode: state.fogMode,
      sourceEra: state.sourceEra,
    });
  }

  /** True once an environment grade context has been consumed. */
  get hasEnvironment(): boolean {
    return this.environment !== null;
  }

  /* ---------------- focus ---------------- */

  /** Moves the depth-of-field focus point (defaults to the block centre). */
  setFocusTarget(target: THREE.Vector3): void {
    this.focusTarget.copy(target);
  }

  /** Current focus distance the DOF pass is using. */
  get focusDistance(): number {
    return this.resolveFocusDistance();
  }

  /* ---------------- quality and passes ---------------- */

  /** Switches quality tier: re-enables passes and rescales bloom + pixel ratio. */
  setQuality(quality: PostFxQuality): void {
    this.assertUsable();
    if (!POSTFX_QUALITY_SETTINGS[quality]) {
      throw new RangeError(`Unknown post-processing quality "${String(quality)}".`);
    }
    this.qualityState = quality;
    const settings = POSTFX_QUALITY_SETTINGS[quality];
    for (const id of POSTFX_PASS_IDS) this.baseEnabled.set(id, settings.enabled.includes(id));
    this.maxDegradeLevelState = settings.maxDegradeLevel;
    this.degradeLevel = 0;
    this.overBudgetFrames = 0;
    this.underBudgetFrames = 0;
    this.applyPassState();
    this.applyBloomResolution();
    this.syncViewport(true);
  }

  /** Deepest degrade level the budget guard may reach. */
  get maxDegradeLevel(): number {
    return this.maxDegradeLevelState;
  }

  /** Current degrade level (`0` = everything the tier asked for is on). */
  get degradeLevelState(): number {
    return this.degradeLevel;
  }

  /**
   * Enables or disables one pass. The core passes (render, grading, output) can
   * never be switched off: tone mapping and grading are the frame's floor.
   */
  setPassEnabled(id: PostFxPassId, enabled: boolean): void {
    this.assertUsable();
    const pass = this.passMap.get(id);
    if (!pass) throw new RangeError(`Unknown post-processing pass "${String(id)}".`);
    if (!enabled && POSTFX_CORE_PASS_IDS.includes(id)) {
      throw new RangeError(
        `Pass "${id}" is core: the composer always keeps its render, grading and output passes.`,
      );
    }
    this.baseEnabled.set(id, enabled);
    this.applyPassState();
  }

  isPassEnabled(id: PostFxPassId): boolean {
    return this.passMap.get(id)?.enabled ?? false;
  }

  /** Passes currently contributing to the frame. */
  activePasses(): readonly PostFxPassId[] {
    return POSTFX_PASS_IDS.filter((id) => this.isPassEnabled(id));
  }

  /** Passes the budget guard has switched off. */
  droppedPasses(): readonly PostFxPassId[] {
    return POSTFX_DEGRADE_LADDER.slice(0, this.degradeLevel);
  }

  passes(): readonly PostFxPassReport[] {
    const dropped = new Set(this.droppedPasses());
    return POSTFX_PASS_IDS.map((id) =>
      Object.freeze({
        id,
        enabled: this.isPassEnabled(id),
        dropped: dropped.has(id),
        core: POSTFX_CORE_PASS_IDS.includes(id),
      }),
    );
  }

  /** The Three.js pass instance behind an id (tests and integrators). */
  getPass(id: PostFxPassId): Pass | undefined {
    return this.passMap.get(id);
  }

  /* ---------------- viewport ---------------- */

  /** Re-reads the renderer size and pixel ratio and resizes the composer. */
  syncViewport(force = false): boolean {
    const renderer = this.renderer;
    let width = this.viewportSize.x;
    let height = this.viewportSize.y;
    let ratio = this.pixelRatio;

    if (typeof renderer.getSize === 'function') {
      try {
        renderer.getSize(this.sizeScratch);
        width = Math.max(1, Math.round(this.sizeScratch.x));
        height = Math.max(1, Math.round(this.sizeScratch.y));
      } catch {
        // A partial renderer double must not block the frame; keep the last size.
      }
    }
    if (typeof renderer.getPixelRatio === 'function') {
      try {
        ratio = renderer.getPixelRatio();
      } catch {
        ratio = this.pixelRatio;
      }
    }

    const resolved = this.resolvePixelRatio(ratio, width, height);
    const changed =
      force ||
      width !== this.viewportSize.x ||
      height !== this.viewportSize.y ||
      resolved !== this.pixelRatio;
    if (!changed) return false;

    this.viewportSize.set(width, height);
    this.applyRenderSize(resolved);
    return true;
  }

  /** Resizes explicitly (tests and integrators that know the CSS size). */
  setSize(width: number, height: number, pixelRatio?: number): void {
    this.assertUsable();
    const targetWidth = Math.max(1, Math.round(width));
    const targetHeight = Math.max(1, Math.round(height));
    this.viewportSize.set(targetWidth, targetHeight);
    this.applyRenderSize(
      this.resolvePixelRatio(pixelRatio ?? this.pixelRatio, targetWidth, targetHeight),
    );
  }

  /* ---------------- frame ---------------- */

  /**
   * Composes one frame. Call it from the render path (the api wraps
   * `SceneContext.render()`), once per animation frame, with the frame delta.
   *
   * Allocation-free apart from the composer's own work: uniforms, colours, the
   * LUT payload and the render targets are all reused.
   */
  render(deltaSeconds = 0): void {
    if (this.disposedState) return;
    const delta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    this.elapsedSeconds += delta;
    this.frameIndex += 1;
    this.syncViewport();

    if (this.shouldBake()) this.refreshGrade();
    this.sweepOptions.active = this.gradeActive;
    this.sweepOptions.direction = this.gradeDirection;
    writeSweepState(this.gradeProgress, this.gradeLook, this.sweepOptions, this.sweepScratch);
    this.applyUniforms();

    if (!this.composerAvailable || !this.composer) {
      this.renderer.render(this.scene, this.camera);
      this.composedFrames += 1;
      this.updateBudget(delta);
      return;
    }

    try {
      this.composer.render(delta);
    } catch (error) {
      this.composerAvailable = false;
      console.error('[chrono-city] post-processing failed, rendering directly', error);
      this.renderer.render(this.scene, this.camera);
    }
    this.composedFrames += 1;
    this.updateBudget(delta);
  }

  /* ---------------- observation ---------------- */

  frameTiming(): PostFxFrameTiming {
    const average = this.averageFrameMs;
    return Object.freeze({
      frameCount: this.frameIndex,
      composedFrames: this.composedFrames,
      fps: average > 0 ? 1000 / average : 0,
      averageFrameMs: average,
      budgetMs: this.frameBudgetMs,
      withinBudget: average === 0 || average <= this.frameBudgetMs,
      degradeLevel: this.degradeLevel,
      pixelRatio: this.pixelRatio,
      renderWidth: this.renderWidth,
      renderHeight: this.renderHeight,
      renderPixels: this.renderWidth * this.renderHeight,
      maxRenderPixels: this.maxRenderPixels,
    });
  }

  /** Everything a HUD, a test or the visual harness needs, in one frozen read. */
  snapshot(): PostFxSnapshot {
    return Object.freeze({
      version: POSTFX_VERSION,
      era: this.gradeTo,
      from: this.gradeFrom,
      to: this.gradeTo,
      progress: this.gradeProgress,
      transitioning: this.gradeActive,
      look: Object.freeze({
        id: this.gradeLook.id,
        label: this.gradeLook.label,
        description: this.gradeLook.description,
      }),
      quality: this.qualityState,
      pixelRatio: this.pixelRatio,
      pixelRatioCap: this.pixelRatioCap,
      renderWidth: this.renderWidth,
      renderHeight: this.renderHeight,
      renderPixels: this.renderWidth * this.renderHeight,
      toneMapping: this.renderer.toneMapping,
      toneMappingExposure: this.renderer.toneMappingExposure,
      composerAvailable: this.composerAvailable,
      passes: this.passes(),
      droppedPasses: this.droppedPasses(),
      degradeLevel: this.degradeLevel,
      maxDegradeLevel: this.maxDegradeLevelState,
      bloom: Object.freeze({
        strength: this.bloomStrength(),
        radius: this.gradeLook.bloom.radius,
        threshold: this.gradeLook.bloom.threshold,
      }),
      dof: Object.freeze({
        focus: this.resolveFocusDistance(),
        aperture: this.gradeLook.dof.aperture,
        maxBlur: this.gradeLook.dof.maxBlur,
      }),
      grain: this.gradeLook.grain,
      vignette: this.gradeLook.vignette,
      exposure: Object.freeze({
        grade: this.resolveGradeExposure(),
        environment: this.environment?.exposure ?? this.renderer.toneMappingExposure,
      }),
      fog: Object.freeze({
        color: this.environment?.fogColor ?? 0,
        density: this.environment?.fogDensity ?? 0,
        haze: this.resolveHaze(),
      }),
      sweep: this.sweepState,
      grade: Object.freeze({
        lutSize: GRADING_LUT_SIZE,
        lutMid: sampleGradingLut(this.lutData, 0.5),
        lutMidHex: linearRgbToHex(sampleGradingLut(this.lutData, 0.5)),
      }),
      environment: this.environmentContext(),
      environmentAttached: this.environment !== null,
      lutBakes: this.lutBakes,
      frameTiming: this.frameTiming(),
    });
  }

  /** Resets the rolling frame-time average and the degrade ladder. */
  resetTiming(): void {
    this.averageFrameMs = 0;
    this.timingSamples = 0;
    this.overBudgetFrames = 0;
    this.underBudgetFrames = 0;
    this.degradeLevel = 0;
    this.applyPassState();
  }

  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    for (const pass of this.passMap.values()) {
      pass.dispose();
    }
    this.passMap.clear();
    this.lutTexture.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.renderer.toneMapping = this.previousToneMapping;
  }

  /* ---------------- internals ---------------- */

  private assertUsable(): void {
    if (this.disposedState) throw new Error('PostFxPipeline has been disposed.');
  }

  private resolvePixelRatio(devicePixelRatio: number, width: number, height: number): number {
    return resolveCappedPixelRatio({
      devicePixelRatio,
      cap: this.pixelRatioCap * this.qualitySettings.pixelRatioScale,
      width,
      height,
      maxPixels: this.maxRenderPixels,
    });
  }

  /** Applies a resolved pixel ratio to the composer and every pass. */
  private applyRenderSize(pixelRatio: number): void {
    this.pixelRatio = pixelRatio;
    this.renderWidth = Math.max(1, Math.round(this.viewportSize.x * pixelRatio));
    this.renderHeight = Math.max(1, Math.round(this.viewportSize.y * pixelRatio));
    this.renderSizeVector.set(this.renderWidth, this.renderHeight);
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(this.viewportSize.x, this.viewportSize.y);
    }
    this.applyBloomResolution();
  }

  private applyBloomResolution(): void {
    const bloom = this.passMap.get('bloom') as UnrealBloomPass | undefined;
    if (!bloom) return;
    const scale = this.qualitySettings.bloomScale;
    bloom.setSize(
      Math.max(1, Math.round(this.renderWidth * scale)),
      Math.max(1, Math.round(this.renderHeight * scale)),
    );
  }

  private applyPassState(): void {
    const dropped = new Set(this.droppedPasses());
    for (const [id, pass] of this.passMap) {
      pass.enabled = (this.baseEnabled.get(id) ?? true) && !dropped.has(id);
    }
  }

  private environmentExposureFactor(): number {
    if (!this.environment) return 1;
    return Math.min(1.6, Math.max(0.6, this.environment.exposure));
  }

  private neoFactor(): number {
    if (!this.environment) return 1;
    return 1 + 0.35 * clamp01(this.environment.neonIntensity);
  }

  private bloomStrength(): number {
    return this.gradeLook.bloom.strength * this.environmentExposureFactor() * this.neoFactor();
  }

  private resolveGradeExposure(): number {
    // With an environment attached the renderer exposure (owned by the
    // environment) already carries the era's light level, so the grader only
    // applies its own bias; without one it must carry the whole exposure.
    return this.environment ? this.gradeLook.exposure : 1;
  }

  private resolveHaze(): number {
    if (!this.environment) return 0;
    // The era's fog weight is cached when the environment context is read, so
    // the frame loop only multiplies two numbers here.
    return clamp01(this.gradeLook.fogHaze * this.atmosphereWeightState);
  }

  private resolveFocusDistance(): number {
    const distance = this.camera.position.distanceTo(this.focusTarget);
    return Math.min(1200, Math.max(2, distance * this.gradeLook.dof.focusBias));
  }

  private shouldBake(): boolean {
    if (this.bakeRequested) return true;
    if (this.bakedFrom !== this.gradeFrom || this.bakedTo !== this.gradeTo) return true;
    if (!this.gradeActive) return this.bakedActive;
    return Math.abs(this.gradeProgress - this.bakedProgress) >= 0.01;
  }

  /**
   * Re-resolves the interpolated look and bakes it into the LUT payload. Called
   * from the frame loop only when `shouldBake()` says something actually moved
   * (a new era, or ~1 % of tween progress), so a settled frame never re-bakes.
   */
  private refreshGrade(): void {
    this.gradeLook = resolveGradeLook(
      this.gradeFrom,
      this.gradeTo,
      this.gradeActive ? this.gradeProgress : 1,
    );
    this.bakeLut();
  }

  private bakeLut(): void {
    const from = getGradingLook(this.gradeFrom);
    const to = getGradingLook(this.gradeTo);
    if (this.gradeActive && from !== to) {
      bakeBlendedGradingLut(from, to, this.gradeProgress, this.lutData, GRADING_LUT_SIZE);
    } else {
      bakeBlendedGradingLut(to, to, 1, this.lutData, GRADING_LUT_SIZE);
    }
    this.lutTexture.needsUpdate = true;
    this.bakedFrom = this.gradeFrom;
    this.bakedTo = this.gradeTo;
    this.bakedProgress = this.gradeProgress;
    this.bakedActive = this.gradeActive;
    this.bakeRequested = false;
    this.lutBakes += 1;
  }

  private applyUniforms(): void {
    const look = this.gradeLook;
    const grading = this.gradingUniforms;
    const vignette = this.vignetteUniforms;
    const grain = this.grainUniforms;
    const sweep = this.sweepUniforms;

    grading['uExposure']!.value = this.resolveGradeExposure();
    grading['uContrast']!.value = look.contrast;
    grading['uSaturation']!.value = look.saturation;
    grading['uSepia']!.value = look.sepia;
    grading['uTemperature']!.value = look.temperature;
    grading['uTint']!.value = look.tint;
    grading['uShadowLift']!.value = look.shadowLift;
    grading['uHighlightRoll']!.value = look.highlightRoll;
    (grading['uShadowTint']!.value as THREE.Color).setRGB(
      look.shadowTint.r,
      look.shadowTint.g,
      look.shadowTint.b,
      RAW_COLOR_SPACE,
    );
    (grading['uHighlightTint']!.value as THREE.Color).setRGB(
      look.highlightTint.r,
      look.highlightTint.g,
      look.highlightTint.b,
      RAW_COLOR_SPACE,
    );
    const fogLinear = this.environmentLinearFog;
    (grading['uFogColor']!.value as THREE.Color).setRGB(
      fogLinear.r,
      fogLinear.g,
      fogLinear.b,
      RAW_COLOR_SPACE,
    );
    grading['uHaze']!.value = this.resolveHaze();

    // Display-space passes read raw sRGB components (no colour-space conversion).
    const fogHex = this.environment?.fogColor ?? 0x070b14;
    (vignette['uColor']!.value as THREE.Color).setRGB(
      ((fogHex >> 16) & 0xff) / 255,
      ((fogHex >> 8) & 0xff) / 255,
      (fogHex & 0xff) / 255,
      RAW_COLOR_SPACE,
    );
    vignette['uStrength']!.value = look.vignette;
    vignette['uPower']!.value = look.vignettePower;

    grain['uTime']!.value = this.elapsedSeconds;
    grain['uSeed']!.value = this.frameIndex % 1024;
    grain['uGrain']!.value = look.grain;
    grain['uGrainScale']!.value = look.grainScale;

    const sweepState = this.sweepScratch;
    (sweep['uColor']!.value as THREE.Color).setRGB(
      ((sweepState.color >> 16) & 0xff) / 255,
      ((sweepState.color >> 8) & 0xff) / 255,
      (sweepState.color & 0xff) / 255,
      RAW_COLOR_SPACE,
    );
    sweep['uIntensity']!.value = sweepState.intensity;
    sweep['uFlash']!.value = sweepState.flash;
    sweep['uTravel']!.value = sweepState.travel;

    const bloom = this.passMap.get('bloom') as UnrealBloomPass | undefined;
    if (bloom) {
      bloom.strength = this.bloomStrength();
      bloom.radius = look.bloom.radius;
      bloom.threshold = look.bloom.threshold;
    }

    const dof = this.dofUniforms;
    dof['focus']!.value = this.resolveFocusDistance();
    dof['aperture']!.value = look.dof.aperture;
    dof['maxblur']!.value = look.dof.maxBlur;

    // Without an environment the pipeline owns the renderer exposure; with one,
    // the environment keeps it (that is the conflict boundary).
    if (!this.environment) {
      this.renderer.toneMappingExposure = look.exposure;
    }
  }

  private updateBudget(deltaSeconds: number): void {
    if (!this.monitorBudget) return;

    const milliseconds = deltaSeconds * 1000;
    if (Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds < 250) {
      this.averageFrameMs =
        this.timingSamples === 0
          ? milliseconds
          : this.averageFrameMs + (milliseconds - this.averageFrameMs) * this.averageWeight;
      this.timingSamples += 1;
    }

    if (this.warmupRemaining > 0) {
      this.warmupRemaining -= 1;
      return;
    }
    if (this.timingSamples < 2) return;

    if (this.averageFrameMs > this.frameBudgetMs * 1.15) {
      this.overBudgetFrames += 1;
      this.underBudgetFrames = 0;
      if (
        this.overBudgetFrames >= this.degradeAfterFrames &&
        this.degradeLevel < this.maxDegradeLevelState
      ) {
        this.degradeLevel += 1;
        this.overBudgetFrames = 0;
        this.applyPassState();
      }
      return;
    }

    this.underBudgetFrames += 1;
    this.overBudgetFrames = 0;
    if (
      this.averageFrameMs < this.frameBudgetMs * 0.92 &&
      this.underBudgetFrames >= this.restoreAfterFrames &&
      this.degradeLevel > 0
    ) {
      this.degradeLevel -= 1;
      this.underBudgetFrames = 0;
      this.applyPassState();
    }
  }
}

/** Creates a post-processing pipeline (the `create` half of the lifecycle). */
export function createPostFxPipeline(options: PostFxPipelineOptions): PostFxPipeline {
  return new PostFxPipeline(options);
}

/** Every era the pipeline can grade for, in timeline order. */
export const POSTFX_ERAS: readonly EraId[] = ERA_IDS;
