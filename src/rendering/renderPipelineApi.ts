/**
 * Chrono City — render pipeline api (the composition root for the final frame).
 *
 * The task's delivered export: one stable handle that owns the post-processing
 * stack, drives it from the era timeline, and makes it *be* the scene context's
 * render path so every frame in the app goes through the composer.
 *
 * Responsibilities:
 *   create    → `createRenderPipelineApi({ context, timeline?, environment? })`
 *               builds the `PostFxPipeline`, registers the per-frame tick on the
 *               `SceneContext`, registers itself as an `EraBlendable` and (by
 *               default) wraps `context.render()` with the composer.
 *   consume   → `consume({ timeline?, environment? })` latches runtime handles
 *               that were not known at construction time. The timeline is the
 *               single source of era progress; the environment is read-only
 *               context for exposure, fog and neon energy.
 *   integrate → `integrate()` publishes the handle on
 *               `window.__chronoCityRender` for the HUD and Playwright, and
 *               dispatches `chrono-city:render-ready`.
 *
 * How the frame flows with this api attached:
 *
 *   SceneContext.animationLoop()
 *     → tick(): timeline (-1000) … environment (-420) … render-pipeline (900)
 *     → context.render()  →  wrapped  →  PostFxPipeline.render(delta)
 *                                        → EffectComposer (8 passes)
 *
 * Conflict boundary: sky, fog and lights belong to the environment task. This
 * api never mutates a light, the scene fog or `renderer.toneMappingExposure`
 * while an environment is attached — it reads `EnvironmentApi.gradeState()` and
 * grades the frame with it.
 *
 * Wiring (the integration owner's half):
 * ```ts
 * const render = createRenderPipelineApi({ context, timeline, environment });
 * render.integrate(); // composes every frame and publishes `window.__chronoCityRender`
 * ```
 */

import type * as THREE from 'three';

import {
  DEFAULT_ERA,
  assertEraId,
  clamp01,
  eraIndex,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../core/eraContracts';
import type { FrameInfo, SceneContext, SystemRegistration } from '../core/sceneContext';
import type { EnvironmentApi } from '../environment/environmentApi';
import type { EnvironmentGradeState } from '../environment/skyAndLighting';
import type { EraBlendableRegistration, TimelineRuntime } from '../era/timelineRuntime';
import type { EraGradeLook, SweepState } from './eraGrading';
import {
  POSTFX_PASS_IDS,
  PostFxPipeline,
  createPostFxPipeline,
  type PostFxPassId,
  type PostFxPassReport,
  type PostFxFrameTiming,
  type PostFxPipelineOptions,
  type PostFxQuality,
  type PostFxSnapshot,
} from './postfx';

export const RENDER_PIPELINE_API_VERSION = 1;

/** Global key the live render handle is published on. */
export const RENDER_PIPELINE_GLOBAL_KEY = '__chronoCityRender';

/** Tick-system id the api registers on the scene context. */
export const RENDER_PIPELINE_SYSTEM_ID = 'render-pipeline';

/**
 * Tick order: after the timeline (`-1000`) and every content system (the
 * environment sits at `-420`), so the frame is composed from this frame's era
 * progress and environment state — but still before `context.render()` draws.
 */
export const RENDER_PIPELINE_SYSTEM_ORDER = 900;

/** Blendable id the api registers with the timeline. */
export const RENDER_PIPELINE_BLENDABLE_ID = 'chrono-render-pipeline';

/**
 * Frames between environment reads once the era has settled. While a tween runs
 * the environment is read every frame, and an era change forces a fresh read, so
 * fog/exposure always follow the timeline.
 */
export const DEFAULT_ENVIRONMENT_POLL_FRAMES = 30;

/** Delta used when a frame arrives without one (e.g. a manual `render()` call). */
export const DEFAULT_FRAME_SECONDS = 1 / 60;

/** Runtime handles the api consumes after `create()`. */
export interface RenderPipelineDependencies {
  /** Timeline that drives the era grading. `null` detaches. */
  readonly timeline?: TimelineRuntime | null;
  /** Environment whose grade context (exposure / fog / neon) is read. */
  readonly environment?: EnvironmentApi | null;
}

export interface RenderPipelineApiOptions extends Omit<PostFxPipelineOptions, 'context'> {
  /** Shared scene context (required): renderer, scene, camera, tick registry. */
  readonly context: SceneContext;
  /** Era timeline; when supplied the api registers as a blendable. */
  readonly timeline?: TimelineRuntime | null;
  /** Environment to read exposure / fog / neon context from. */
  readonly environment?: EnvironmentApi | null;
  /** Register the per-frame tick. Defaults to `true`. */
  readonly animate?: boolean;
  /** Wrap `context.render()` with the composer. Defaults to `true`. */
  readonly wrapContextRender?: boolean;
  /** Frames between environment reads once settled. Defaults to `30`. */
  readonly pollEnvironmentEvery?: number;
  /** Blendable id. Defaults to `RENDER_PIPELINE_BLENDABLE_ID`. */
  readonly blendableId?: string;
  /** Tick-system id. Defaults to `RENDER_PIPELINE_SYSTEM_ID`. */
  readonly systemId?: string;
  /** Tick-system order. Defaults to `RENDER_PIPELINE_SYSTEM_ORDER`. */
  readonly systemOrder?: number;
}

/** The grading state of the frame: era blend, resolved look, sweep, exposure. */
export interface RenderPipelineGradeState {
  readonly era: EraId;
  readonly from: EraId;
  readonly to: EraId;
  readonly progress: number;
  readonly transitioning: boolean;
  /** `1` when travelling towards newer eras, `-1` towards older ones. */
  readonly direction: number;
  readonly look: EraGradeLook;
  readonly sweep: SweepState;
  /** Environment exposure the frame is graded against, when attached. */
  readonly environmentExposure: number | null;
}

/** Full, read-only state of the render pipeline. */
export interface RenderPipelineSnapshot {
  readonly version: number;
  readonly era: EraId;
  readonly from: EraId;
  readonly to: EraId;
  readonly progress: number;
  readonly transitioning: boolean;
  readonly direction: number;
  readonly systemId: string;
  readonly blendableId: string;
  /** `true` while the per-frame tick is registered. */
  readonly ticking: boolean;
  /** `true` while the composer owns `context.render()`. */
  readonly renderAttached: boolean;
  readonly blendableRegistered: boolean;
  readonly tickCount: number;
  readonly renderCount: number;
  readonly environmentAttached: boolean;
  readonly environmentEra: EraId | null;
  readonly postFx: PostFxSnapshot;
}

export class RenderPipelineApi implements EraBlendable {
  readonly version = RENDER_PIPELINE_API_VERSION;

  /** The composer stack. Published so the HUD/orchestrator can reach it. */
  readonly pipeline: PostFxPipeline;

  readonly context: SceneContext;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;

  /** Tick-system id; also the id the blendable registers under. */
  readonly id: string;

  private readonly systemId: string;
  private readonly systemOrder: number;
  private readonly animate: boolean;
  private readonly wrapRender: boolean;
  private readonly pollEnvironmentEvery: number;

  private timelineState: TimelineRuntime | null;
  private environmentState: EnvironmentApi | null;
  private environmentGrade: EnvironmentGradeState | null = null;
  private environmentFrameCounter = 0;

  private systemRegistration: SystemRegistration | null = null;
  private blendableRegistration: EraBlendableRegistration | null = null;

  private fromEra: EraId;
  private toEra: EraId;
  private progressState = 1;
  private directionState = 1;

  private tickCountState = 0;
  private renderCountState = 0;
  private pendingDelta: number | null = null;

  private wrapped = false;
  private hadOwnRender = false;
  private originalRender: (() => void) | null = null;

  private disposedState = false;

  constructor(options: RenderPipelineApiOptions) {
    if (!options?.context) throw new TypeError('RenderPipelineApi needs a SceneContext.');

    this.context = options.context;
    this.scene = options.context.scene;
    this.camera = options.context.camera;
    this.timelineState = options.timeline ?? null;
    this.environmentState = options.environment ?? null;
    this.id = options.blendableId ?? RENDER_PIPELINE_BLENDABLE_ID;
    this.systemId = options.systemId ?? RENDER_PIPELINE_SYSTEM_ID;
    this.systemOrder = options.systemOrder ?? RENDER_PIPELINE_SYSTEM_ORDER;
    this.animate = options.animate ?? true;
    this.wrapRender = options.wrapContextRender ?? true;
    this.pollEnvironmentEvery = Math.max(
      1,
      Math.round(options.pollEnvironmentEvery ?? DEFAULT_ENVIRONMENT_POLL_FRAMES),
    );

    const initial = assertEraId(options.initialEra ?? this.timelineState?.era ?? DEFAULT_ERA);
    this.fromEra = initial;
    this.toEra = initial;

    this.pipeline = createPostFxPipeline({
      context: options.context,
      scene: options.scene,
      camera: options.camera,
      quality: options.quality,
      pixelRatioCap: options.pixelRatioCap,
      maxRenderPixels: options.maxRenderPixels,
      frameBudgetMs: options.frameBudgetMs,
      maxDegradeLevel: options.maxDegradeLevel,
      toneMapping: options.toneMapping,
      initialEra: initial,
      focusTarget: options.focusTarget,
      monitorBudget: options.monitorBudget,
      warmupFrames: options.warmupFrames,
      degradeAfterFrames: options.degradeAfterFrames,
      restoreAfterFrames: options.restoreAfterFrames,
      averageWeight: options.averageWeight,
    });

    if (this.environmentState) {
      this.environmentGrade = this.environmentState.gradeState();
      this.pipeline.setEnvironmentGrade(this.environmentGrade);
    }

    if (this.timelineState) {
      this.blendableRegistration = this.timelineState.registerBlendable(this, { id: this.id });
    }

    if (this.animate) {
      this.systemRegistration = this.context.registerSystem(this.systemId, this.tick, {
        order: this.systemOrder,
      });
    }

    if (this.wrapRender) this.attach();
  }

  /* ---------------- era state ---------------- */

  /** Era the frame is graded for (the target of a running tween). */
  get era(): EraId {
    return this.toEra;
  }

  /** Era the running tween started from. */
  get from(): EraId {
    return this.fromEra;
  }

  /** Eased tween progress; `1` when settled. */
  get progress(): number {
    return this.progressState;
  }

  get isTransitioning(): boolean {
    return this.fromEra !== this.toEra;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** The timeline driving the grades, or `null` before `consume()`. */
  get timeline(): TimelineRuntime | null {
    return this.timelineState;
  }

  /** The environment whose context is read, or `null`. */
  get environment(): EnvironmentApi | null {
    return this.environmentState;
  }

  /** `true` while the per-frame tick is registered. */
  get isTicking(): boolean {
    return this.systemRegistration !== null;
  }

  /** `true` while the composer owns `context.render()`. */
  get isRenderAttached(): boolean {
    return this.wrapped;
  }

  /** `true` while the api is registered as a timeline blendable. */
  get isBlendableRegistered(): boolean {
    return this.blendableRegistration !== null;
  }

  /* ---------------- EraBlendable ---------------- */

  /**
   * `EraBlendable`: called once when a transition starts. `{ immediate: true }`
   * snaps the grade; otherwise the sweep starts at `progress === 0` and the
   * grading slides from the era currently shown to the target.
   */
  setEra(era: EraId, options: EraTransitionOptions = {}): void {
    this.assertUsable();
    const target = assertEraId(era);
    const durationMs = options.durationMs ?? 0;
    this.environmentFrameCounter = this.pollEnvironmentEvery;

    if (options.immediate === true || durationMs <= 0) {
      this.fromEra = target;
      this.toEra = target;
      this.progressState = 1;
      this.pipeline.applyGradeLook(target);
      return;
    }

    this.fromEra = this.toEra;
    this.toEra = target;
    this.progressState = 0;
    this.directionState = eraIndex(target) >= eraIndex(this.fromEra) ? 1 : -1;
    this.pipeline.setGradeBlend(this.fromEra, this.toEra, 0, {
      active: true,
      direction: this.directionState,
    });
  }

  /** `EraBlendable`: one call per frame while the timeline tween runs. */
  updateEraTransition(progress: number, transition: EraTransitionInfo): void {
    if (this.disposedState) return;
    const target = assertEraId(transition.to);
    const source = assertEraId(transition.from);
    const value = clamp01(progress);
    const complete = !transition.active || value >= 1;

    this.fromEra = complete ? target : source;
    this.toEra = target;
    this.progressState = complete ? 1 : value;
    this.directionState = eraIndex(target) >= eraIndex(source) ? 1 : -1;

    this.pipeline.setGradeBlend(this.fromEra, this.toEra, this.progressState, {
      active: !complete,
      direction: this.directionState,
    });
  }

  /** Snaps the grade to an era without a sweep. */
  applyEra(era: EraId): void {
    this.setEra(era, { immediate: true });
  }

  /* ---------------- lifecycle ---------------- */

  /**
   * Attaches the shared runtime handles not known at construction time. Safe to
   * call more than once: a timeline already registered is re-registered with its
   * new handle, and the environment context is refreshed.
   */
  consume(dependencies: RenderPipelineDependencies = {}): this {
    this.assertUsable();

    if (dependencies.timeline !== undefined) {
      if (this.blendableRegistration) {
        this.blendableRegistration.dispose();
        this.blendableRegistration = null;
      }
      const timeline = dependencies.timeline ?? null;
      this.timelineState = timeline;
      if (timeline) {
        this.blendableRegistration = timeline.registerBlendable(this, { id: this.id });
      }
    }

    if (dependencies.environment !== undefined) {
      this.environmentState = dependencies.environment ?? null;
      this.environmentGrade = null;
      this.pipeline.setEnvironmentGrade(null);
      this.environmentFrameCounter = this.pollEnvironmentEvery;
      if (this.environmentState) {
        this.environmentGrade = this.environmentState.gradeState();
        this.pipeline.setEnvironmentGrade(this.environmentGrade);
      }
    }

    return this;
  }

  /**
   * Makes the composer the scene context's render path. The original method is
   * restored by `detach()` / `dispose()`, so the app can always fall back to a
   * plain draw.
   */
  attach(): this {
    this.assertUsable();
    if (this.wrapped) return this;

    const context = this.context as unknown as Record<string, unknown>;
    this.hadOwnRender = Object.prototype.hasOwnProperty.call(context, 'render');
    this.originalRender = context['render'] as () => void;
    this.wrapped = true;
    context['render'] = () => {
      this.render();
    };
    return this;
  }

  /** Restores the scene context's original render path. */
  detach(): this {
    if (!this.wrapped) return this;
    const context = this.context as unknown as Record<string, unknown>;
    if (this.hadOwnRender && this.originalRender) {
      context['render'] = this.originalRender;
    } else {
      delete context['render'];
    }
    this.wrapped = false;
    this.originalRender = null;
    return this;
  }

  /**
   * Publishes the live handle for the HUD and browser harnesses. Wiring is the
   * integration owner's call; this only makes the api discoverable.
   */
  integrate(): this {
    this.assertUsable();
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>)[RENDER_PIPELINE_GLOBAL_KEY] = this;
      if (typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('chrono-city:render-ready', { detail: this }));
      }
    }
    return this;
  }

  /* ---------------- frame ---------------- */

  /**
   * Composes one frame through the composer. Called by `SceneContext` once per
   * animation frame (the api installs itself as the context's render path), or
   * directly by a harness; the delta defaults to the tick's frame delta.
   */
  render(deltaSeconds?: number): void {
    if (this.disposedState) return;
    const delta =
      deltaSeconds ?? this.pendingDelta ?? DEFAULT_FRAME_SECONDS;
    this.pendingDelta = null;
    this.pipeline.render(delta);
    this.renderCountState += 1;
  }

  private readonly tick = (_context: SceneContext, frame: FrameInfo): void => {
    this.tickCountState += 1;
    this.pendingDelta = frame.delta > 0 ? frame.delta : null;
    this.refreshEnvironment();
  };

  /**
   * Reads the environment's grade context. While a tween runs it is read every
   * frame (fog and exposure follow the era); once settled it is polled at
   * `pollEnvironmentEvery`, so the steady-state frame loop allocates nothing.
   */
  private refreshEnvironment(): void {
    const environment = this.environmentState;
    if (!environment) return;

    this.environmentFrameCounter += 1;
    const every = this.isTransitioning ? 1 : this.pollEnvironmentEvery;
    if (this.environmentFrameCounter < every) return;

    this.environmentFrameCounter = 0;
    this.environmentGrade = environment.gradeState();
    this.pipeline.setEnvironmentGrade(this.environmentGrade);
  }

  /* ---------------- observation ---------------- */

  /** Era grading state of the current frame. */
  gradeState(): RenderPipelineGradeState {
    return Object.freeze({
      era: this.toEra,
      from: this.fromEra,
      to: this.toEra,
      progress: this.progressState,
      transitioning: this.isTransitioning,
      direction: this.directionState,
      // The look actually applied this frame (interpolated mid-tween).
      look: this.pipeline.look,
      sweep: this.pipeline.sweepState,
      environmentExposure: this.environmentGrade?.exposure ?? null,
    });
  }

  /** Environment context currently being graded against, or `null`. */
  environmentGradeState(): EnvironmentGradeState | null {
    return this.environmentGrade;
  }

  /** Rolling frame timing, including the capped pixel ratio and degrade level. */
  frameTiming(): PostFxFrameTiming {
    return this.pipeline.frameTiming();
  }

  /** Per-pass enablement report. */
  passes(): readonly PostFxPassReport[] {
    return this.pipeline.passes();
  }

  /** Passes currently contributing to the frame. */
  activePasses(): readonly PostFxPassId[] {
    return this.pipeline.activePasses();
  }

  get pixelRatio(): number {
    return this.pipeline.devicePixelRatio;
  }

  /** The composer, or `null` when the renderer could not host one. */
  get composer(): PostFxPipeline['composer'] {
    return this.pipeline.composer;
  }

  /** Switches quality tier (and therefore the pass set / pixel ratio). */
  setQuality(quality: PostFxQuality): void {
    this.pipeline.setQuality(quality);
  }

  setPassEnabled(id: PostFxPassId, enabled: boolean): void {
    this.pipeline.setPassEnabled(id, enabled);
  }

  /** Everything a HUD, a test or the visual harness needs at once. */
  snapshot(): RenderPipelineSnapshot {
    return Object.freeze({
      version: RENDER_PIPELINE_API_VERSION,
      era: this.toEra,
      from: this.fromEra,
      to: this.toEra,
      progress: this.progressState,
      transitioning: this.isTransitioning,
      direction: this.directionState,
      systemId: this.systemId,
      blendableId: this.id,
      ticking: this.systemRegistration !== null,
      renderAttached: this.wrapped,
      blendableRegistered: this.blendableRegistration !== null,
      tickCount: this.tickCountState,
      renderCount: this.renderCountState,
      environmentAttached: this.environmentState !== null,
      environmentEra: this.environmentGrade?.sourceEra ?? null,
      postFx: this.pipeline.snapshot(),
    });
  }

  /** Detaches the tick, the blendable, the global handle and the composer. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;

    this.detach();
    this.systemRegistration?.dispose();
    this.systemRegistration = null;
    this.blendableRegistration?.dispose();
    this.blendableRegistration = null;
    this.pipeline.dispose();

    if (typeof window !== 'undefined') {
      const global = window as unknown as Record<string, unknown>;
      if (global[RENDER_PIPELINE_GLOBAL_KEY] === this) {
        delete global[RENDER_PIPELINE_GLOBAL_KEY];
      }
    }
  }

  /* ---------------- internals ---------------- */

  private assertUsable(): void {
    if (this.disposedState) throw new Error('RenderPipelineApi has been disposed.');
  }
}

/** Creates a render pipeline api (the `create` half of the lifecycle). */
export function createRenderPipelineApi(options: RenderPipelineApiOptions): RenderPipelineApi {
  return new RenderPipelineApi(options);
}

/** Every pass id the api's composer can own. */
export const RENDER_PIPELINE_PASS_IDS: readonly PostFxPassId[] = POSTFX_PASS_IDS;
