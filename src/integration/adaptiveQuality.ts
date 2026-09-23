/**
 * Chrono City — adaptive-quality guardrail (the frame-budget safety net).
 *
 * The composed app has one owner for quality: this monitor. It watches the real
 * frame time the render loop reports, and when the block cannot hold the budget
 * it walks the post-processing **quality ladder** down one tier at a time —
 * dropping the depth-of-field pass first, then the film-grain pass, and finally
 * reducing the pixel ratio — before walking back up once the frame time has
 * comfortably recovered.
 *
 * Ownership rules this module exists to enforce:
 *
 *   1. Quality is the only thing it touches. It never calls `setEra()`,
 *      `selectEra()`, a content system or the camera rig, so an era transition
 *      and navigation keep working at every tier. `snapshot()` reports
 *      `eraTransitioning` as the standing proof of that.
 *   2. It drives the shared `RenderPipelineApi`, not the renderer directly: the
 *      tier switch re-enables the tier's pass set through the pipeline's own
 *      `setQuality()`, and applies the tier's pixel-ratio budget through the
 *      shared renderer ratio the composer resolves against (then resyncs the
 *      composer), so the floor tier really renders fewer pixels.
 *   3. Degradation is progressive and bounded: at most one step per
 *      `degradeAfterFrames` slow frames, and never past `minTier` (the floor
 *      keeps the render / grading / output passes, which the pipeline marks
 *      core and refuses to disable).
 *
 * Tier ladder (heaviest → lightest), mirroring `POSTFX_QUALITY_SETTINGS`:
 *
 *   cinematic   every pass, full pixel ratio, no budget head-room
 *   high        every pass, full pixel ratio          ← shipped default
 *   balanced    DOF dropped, bloom at 0.75×
 *   performance DOF + grain dropped, bloom at 0.5×, pixel ratio at 0.9×
 *
 * Lifecycle:
 *   create    → `new AdaptiveQualityMonitor({ context, render })`.
 *   consume   → `update(frameMs)` / `snapshot()` / `setTier()`.
 *   integrate → `attach(context)` registers one late tick system, so the
 *               monitor sees the same frame delta the render pipeline rendered.
 */

import type { FrameInfo, SceneContext, SystemRegistration } from '../core/sceneContext';
import {
  DEFAULT_FRAME_BUDGET_MS,
  MAX_PIXEL_RATIO,
  MIN_PIXEL_RATIO,
  POSTFX_PASS_IDS,
  POSTFX_QUALITY_SETTINGS,
  type PostFxPassId,
  type PostFxQuality,
} from '../rendering/postfx';
import type { RenderPipelineApi } from '../rendering/renderPipelineApi';

export const ADAPTIVE_QUALITY_VERSION = 1;

/** Tick-registry id the monitor registers under. */
export const ADAPTIVE_QUALITY_SYSTEM_ID = 'adaptive-quality';

/**
 * Tick order: *after* the render pipeline (`900`), so the frame time being
 * judged already includes this frame's composed work — but before
 * `context.render()`, so a tier switch lands on the frame about to be drawn.
 */
export const ADAPTIVE_QUALITY_SYSTEM_ORDER = 950;

/** The quality ladder, heaviest first. Index order is the degrade order. */
export const ADAPTIVE_QUALITY_TIERS: readonly PostFxQuality[] = Object.freeze([
  'cinematic',
  'high',
  'balanced',
  'performance',
]);

/** Heaviest tier the monitor may restore to by default. */
export const DEFAULT_MAX_TIER: PostFxQuality = 'high';

/** Lightest tier the monitor may degrade to by default. */
export const DEFAULT_MIN_TIER: PostFxQuality = 'performance';

/** Frame budget the monitor guards: the same 60 fps budget the composer uses. */
export const DEFAULT_TARGET_FRAME_MS = DEFAULT_FRAME_BUDGET_MS;

/** Frames averaged into the rolling frame-time estimate. */
export const DEFAULT_SAMPLE_WINDOW = 24;

/** Consecutive over-budget frames before one degrade step. */
export const DEFAULT_DEGRADE_AFTER_FRAMES = 20;

/** Consecutive under-budget frames before one restore step. */
export const DEFAULT_RESTORE_AFTER_FRAMES = 150;

/** Fraction over budget that counts as "too slow" (15 % head-room). */
export const DEFAULT_OVER_BUDGET_TOLERANCE = 0.15;

/** Fraction under budget that counts as "comfortable" (10 % head-room). */
export const DEFAULT_RECOVERY_TOLERANCE = 0.1;

/** Passes the ladder sacrifices first, in sacrifice order. */
export const DEGRADED_PASS_IDS: readonly PostFxPassId[] = Object.freeze(['dof', 'grain']);

/** Reads the shared renderer's pixel ratio, or `null` when it cannot be read. */
function readRendererPixelRatio(context: SceneContext | null): number | null {
  const renderer = context?.renderer;
  if (!renderer || typeof renderer.getPixelRatio !== 'function') return null;
  try {
    const value = renderer.getPixelRatio();
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** What one `update()` decided. */
export type AdaptiveQualityAction = 'hold' | 'degrade' | 'restore' | 'clamped';

/** Flat, serialisable view of the monitor for tests, HUDs and harnesses. */
export interface AdaptiveQualitySnapshot {
  readonly version: number;
  readonly tier: PostFxQuality;
  readonly tierIndex: number;
  readonly tiers: readonly PostFxQuality[];
  readonly maxTier: PostFxQuality;
  readonly minTier: PostFxQuality;
  readonly frameMs: number;
  readonly averageFrameMs: number;
  readonly budgetMs: number;
  readonly degradedThresholdMs: number;
  readonly recoveryThresholdMs: number;
  readonly sampleCount: number;
  readonly window: number;
  readonly overBudgetFrames: number;
  readonly underBudgetFrames: number;
  readonly degradeSteps: number;
  readonly restoreSteps: number;
  readonly lastAction: AdaptiveQualityAction;
  readonly tracking: boolean;
  readonly tickCount: number;
  /** Composer pixel ratio, or `null` when no render pipeline is attached. */
  readonly pixelRatio: number | null;
  /** Passes contributing to the frame right now. */
  readonly activePasses: readonly PostFxPassId[];
  /** Passes missing relative to the heaviest tier (what the ladder bought back). */
  readonly droppedPasses: readonly PostFxPassId[];
  /**
   * `true` while an era tween is running. Adaptive quality must never stop this
   * from happening, which is why it is part of the monitor's own report.
   */
  readonly eraTransitioning: boolean;
  readonly era: string | null;
}

export interface AdaptiveQualityOptions {
  /** Scene context whose frame delta drives the monitor; also the tick target. */
  readonly context?: SceneContext | null;
  /** Pipeline the tier ladder drives. Without one the monitor only reports. */
  readonly render?: RenderPipelineApi | null;
  /** Starting tier. Defaults to the pipeline's current tier, then `maxTier`. */
  readonly initialTier?: PostFxQuality;
  /** Heaviest tier the monitor may climb back to. Defaults to `high`. */
  readonly maxTier?: PostFxQuality;
  /** Lightest tier the monitor may drop to. Defaults to `performance`. */
  readonly minTier?: PostFxQuality;
  /** Frame budget in milliseconds. Defaults to 60 fps. */
  readonly targetFrameMs?: number;
  readonly sampleWindow?: number;
  readonly degradeAfterFrames?: number;
  readonly restoreAfterFrames?: number;
  readonly overBudgetTolerance?: number;
  readonly recoveryTolerance?: number;
  /** Register the per-frame tick when a context is supplied. Defaults to `true`. */
  readonly autoRegister?: boolean;
  readonly systemId?: string;
  readonly order?: number;
  /** Called once per tier change, with the state that caused it. */
  readonly onChange?: (snapshot: AdaptiveQualitySnapshot) => void;
}

/** Index of a tier on the ladder; unknown tiers land on `high`. */
function tierIndex(tier: PostFxQuality): number {
  const index = ADAPTIVE_QUALITY_TIERS.indexOf(tier);
  return index === -1 ? ADAPTIVE_QUALITY_TIERS.indexOf(DEFAULT_MAX_TIER) : index;
}

function clampIndex(index: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(index)));
}

function isTier(value: unknown): value is PostFxQuality {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(POSTFX_QUALITY_SETTINGS, value)
  );
}

/**
 * Watches frame time and walks the post-processing quality ladder down under
 * load and back up once the frame recovers.
 */
export class AdaptiveQualityMonitor {
  readonly version = ADAPTIVE_QUALITY_VERSION;

  readonly systemId: string;
  readonly order: number;

  private readonly renderState: RenderPipelineApi | null;
  private readonly contextState: SceneContext | null;
  /** Renderer pixel ratio the ladder scales down from (the display's ratio). */
  private readonly basePixelRatio: number;
  private readonly budgetMs: number;
  private readonly sampleWindow: number;
  private readonly degradeAfterFrames: number;
  private readonly restoreAfterFrames: number;
  private readonly degradeThreshold: number;
  private readonly recoverThreshold: number;
  private readonly minIndex: number;
  private readonly maxIndex: number;
  private readonly onChangeCallback: ((snapshot: AdaptiveQualitySnapshot) => void) | null;

  private readonly samples: number[] = [];
  private sampleCursor = 0;
  private sampleSum = 0;
  private sampleCountState = 0;

  private tierState: PostFxQuality;
  private lastFrameMsState = 0;
  private averageFrameMsState = 0;
  private overBudgetFramesState = 0;
  private underBudgetFramesState = 0;
  private degradeStepsState = 0;
  private restoreStepsState = 0;
  private lastActionState: AdaptiveQualityAction = 'hold';
  private tickCountState = 0;

  private registration: SystemRegistration | null = null;
  private disposedState = false;

  constructor(options: AdaptiveQualityOptions = {}) {
    this.renderState = options.render ?? null;
    this.contextState = options.context ?? null;
    this.basePixelRatio = readRendererPixelRatio(this.contextState) ?? 1;
    this.systemId = options.systemId ?? ADAPTIVE_QUALITY_SYSTEM_ID;
    this.order = options.order ?? ADAPTIVE_QUALITY_SYSTEM_ORDER;

    this.budgetMs =
      Number.isFinite(options.targetFrameMs) && (options.targetFrameMs as number) > 0
        ? (options.targetFrameMs as number)
        : DEFAULT_TARGET_FRAME_MS;
    this.sampleWindow = Math.max(
      2,
      Math.round(options.sampleWindow ?? DEFAULT_SAMPLE_WINDOW),
    );
    this.degradeAfterFrames = Math.max(
      1,
      Math.round(options.degradeAfterFrames ?? DEFAULT_DEGRADE_AFTER_FRAMES),
    );
    this.restoreAfterFrames = Math.max(
      this.degradeAfterFrames,
      Math.round(options.restoreAfterFrames ?? DEFAULT_RESTORE_AFTER_FRAMES),
    );

    const overTolerance = Number.isFinite(options.overBudgetTolerance)
      ? Math.max(0, options.overBudgetTolerance as number)
      : DEFAULT_OVER_BUDGET_TOLERANCE;
    const recoveryTolerance = Number.isFinite(options.recoveryTolerance)
      ? Math.max(0, options.recoveryTolerance as number)
      : DEFAULT_RECOVERY_TOLERANCE;
    this.degradeThreshold = this.budgetMs * (1 + overTolerance);
    this.recoverThreshold = this.budgetMs * (1 - recoveryTolerance);

    this.maxIndex = clampIndex(
      tierIndex(isTier(options.maxTier) ? options.maxTier : DEFAULT_MAX_TIER),
      0,
      ADAPTIVE_QUALITY_TIERS.length - 1,
    );
    this.minIndex = clampIndex(
      tierIndex(isTier(options.minTier) ? options.minTier : DEFAULT_MIN_TIER),
      this.maxIndex,
      ADAPTIVE_QUALITY_TIERS.length - 1,
    );

    const requested =
      options.initialTier ??
      (this.renderState ? this.renderState.snapshot().postFx.quality : undefined) ??
      ADAPTIVE_QUALITY_TIERS[this.maxIndex];
    this.tierState =
      ADAPTIVE_QUALITY_TIERS[
        clampIndex(tierIndex(requested), this.maxIndex, this.minIndex)
      ];
    this.onChangeCallback = options.onChange ?? null;
    this.applyTier();

    const context = options.context ?? null;
    if (context && (options.autoRegister ?? true)) this.attach(context);
  }

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */

  get tier(): PostFxQuality {
    return this.tierState;
  }

  get tierIndex(): number {
    return tierIndex(this.tierState);
  }

  get maxTier(): PostFxQuality {
    return ADAPTIVE_QUALITY_TIERS[this.maxIndex];
  }

  get minTier(): PostFxQuality {
    return ADAPTIVE_QUALITY_TIERS[this.minIndex];
  }

  /** Rolling average frame time in milliseconds (`0` before the first sample). */
  get averageFrameMs(): number {
    return this.averageFrameMsState;
  }

  /** `true` while the monitor is registered on a scene context. */
  get isTracking(): boolean {
    return this.registration !== null;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** Pixel ratio the composer is rendering at, or `null` without a pipeline. */
  get pixelRatio(): number | null {
    return this.renderState ? this.renderState.pixelRatio : null;
  }

  /** `true` when the tier ladder is already at its lightest allowed step. */
  get isAtFloor(): boolean {
    return this.tierIndex >= this.minIndex;
  }

  /** Passes the tier ladder has switched off relative to the heaviest tier. */
  droppedPasses(): readonly PostFxPassId[] {
    const settings = POSTFX_QUALITY_SETTINGS[this.tierState];
    return POSTFX_PASS_IDS.filter((id) => !settings.enabled.includes(id));
  }

  /** Passes contributing to the frame right now. */
  activePasses(): readonly PostFxPassId[] {
    if (this.renderState) return this.renderState.activePasses();
    return POSTFX_QUALITY_SETTINGS[this.tierState].enabled;
  }

  snapshot(): AdaptiveQualitySnapshot {
    const render = this.renderState;
    return Object.freeze({
      version: ADAPTIVE_QUALITY_VERSION,
      tier: this.tierState,
      tierIndex: tierIndex(this.tierState),
      tiers: ADAPTIVE_QUALITY_TIERS,
      maxTier: this.maxTier,
      minTier: this.minTier,
      frameMs: this.lastFrameMsState,
      averageFrameMs: this.averageFrameMsState,
      budgetMs: this.budgetMs,
      degradedThresholdMs: this.degradeThreshold,
      recoveryThresholdMs: this.recoverThreshold,
      sampleCount: this.sampleCountState,
      window: this.sampleWindow,
      overBudgetFrames: this.overBudgetFramesState,
      underBudgetFrames: this.underBudgetFramesState,
      degradeSteps: this.degradeStepsState,
      restoreSteps: this.restoreStepsState,
      lastAction: this.lastActionState,
      tracking: this.isTracking,
      tickCount: this.tickCountState,
      pixelRatio: render ? render.pixelRatio : null,
      activePasses: this.activePasses(),
      droppedPasses: this.droppedPasses(),
      eraTransitioning: render ? render.isTransitioning : false,
      era: render ? render.era : null,
    });
  }

  /* ------------------------------------------------------------------ *
   * frame observation
   * ------------------------------------------------------------------ */

  /**
   * Feeds one frame time into the rolling estimate and returns the action the
   * monitor decided on. Called once per frame by the registered tick system;
   * safe (and the normal path in tests) to call directly.
   */
  update(frameMs: number): AdaptiveQualityAction {
    if (this.disposedState) return 'hold';
    if (!Number.isFinite(frameMs) || frameMs <= 0) return this.lastActionState;

    this.lastFrameMsState = frameMs;
    this.pushSample(frameMs);
    this.averageFrameMsState = this.sampleSum / this.samples.length;
    this.sampleCountState += 1;

    const average = this.averageFrameMsState;
    if (average > this.degradeThreshold) {
      this.overBudgetFramesState += 1;
      this.underBudgetFramesState = 0;
    } else if (average < this.recoverThreshold) {
      this.underBudgetFramesState += 1;
      this.overBudgetFramesState = 0;
    } else {
      // Comfortably inside the band: forget both streaks rather than letting
      // them accumulate towards a switch the frame time no longer justifies.
      this.overBudgetFramesState = 0;
      this.underBudgetFramesState = 0;
    }

    if (this.overBudgetFramesState >= this.degradeAfterFrames) {
      this.overBudgetFramesState = 0;
      return this.degrade();
    }
    if (this.underBudgetFramesState >= this.restoreAfterFrames) {
      this.underBudgetFramesState = 0;
      return this.restore();
    }
    this.lastActionState = 'hold';
    return 'hold';
  }

  /* ------------------------------------------------------------------ *
   * the ladder
   * ------------------------------------------------------------------ */

  /** Drops one tier (lighter passes, lower pixel ratio at the floor). */
  degrade(): AdaptiveQualityAction {
    if (this.tierIndex >= this.minIndex) {
      this.lastActionState = 'clamped';
      return 'clamped';
    }
    const next = ADAPTIVE_QUALITY_TIERS[this.tierIndex + 1] as PostFxQuality;
    this.tierState = next;
    this.degradeStepsState += 1;
    this.applyTier();
    this.lastActionState = 'degrade';
    return 'degrade';
  }

  /** Restores one tier, up to `maxTier`. */
  restore(): AdaptiveQualityAction {
    if (this.tierIndex <= this.maxIndex) {
      this.lastActionState = 'clamped';
      return 'clamped';
    }
    const next = ADAPTIVE_QUALITY_TIERS[this.tierIndex - 1] as PostFxQuality;
    this.tierState = next;
    this.restoreStepsState += 1;
    this.applyTier();
    this.lastActionState = 'restore';
    return 'restore';
  }

  /**
   * Sets the tier explicitly (bounded by `maxTier` / `minTier`) and clears the
   * streak counters. Used by the app to honour a user preference and by tests.
   */
  setTier(tier: PostFxQuality, options: { countStep?: boolean } = {}): PostFxQuality {
    if (this.disposedState) throw new Error('AdaptiveQualityMonitor has been disposed.');
    if (!isTier(tier)) {
      throw new RangeError(`Unknown quality tier "${String(tier)}".`);
    }
    const index = clampIndex(tierIndex(tier), this.maxIndex, this.minIndex);
    const next = ADAPTIVE_QUALITY_TIERS[index] as PostFxQuality;
    if (next !== this.tierState) {
      this.tierState = next;
      if (options.countStep ?? false) this.restoreStepsState += 1;
      this.applyTier();
      this.lastActionState = 'hold';
    }
    this.resetSamples();
    return this.tierState;
  }

  /** Clears the rolling window and the streak counters. */
  resetSamples(): void {
    this.samples.length = 0;
    this.sampleCursor = 0;
    this.sampleSum = 0;
    this.averageFrameMsState = 0;
    this.sampleCountState = 0;
    this.overBudgetFramesState = 0;
    this.underBudgetFramesState = 0;
    this.lastActionState = 'hold';
  }

  /** Returns the ladder to the heaviest allowed tier and clears the counters. */
  reset(): void {
    this.tierState = ADAPTIVE_QUALITY_TIERS[this.maxIndex] as PostFxQuality;
    this.applyTier();
    this.resetSamples();
  }

  /* ------------------------------------------------------------------ *
   * tick integration
   * ------------------------------------------------------------------ */

  /** Registers the per-frame tick; the monitor reads the frame delta itself. */
  attach(context: SceneContext): this {
    if (this.disposedState) throw new Error('AdaptiveQualityMonitor has been disposed.');
    if (this.registration) this.detach();
    this.registration = context.registerSystem(
      this.systemId,
      (_context: SceneContext, frame: FrameInfo) => {
        this.tickCountState += 1;
        this.update(frame.delta * 1000);
      },
      { order: this.order },
    );
    return this;
  }

  detach(): void {
    this.registration?.dispose();
    this.registration = null;
  }

  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.detach();
    this.samples.length = 0;
  }

  /* ------------------------------------------------------------------ *
   * internals
   * ------------------------------------------------------------------ */

  private pushSample(frameMs: number): void {
    if (this.samples.length < this.sampleWindow) {
      this.samples.push(frameMs);
      this.sampleSum += frameMs;
      return;
    }
    const index = this.sampleCursor % this.sampleWindow;
    this.sampleSum -= this.samples[index] as number;
    this.samples[index] = frameMs;
    this.sampleSum += frameMs;
    this.sampleCursor = (this.sampleCursor + 1) % this.sampleWindow;
  }

  private applyTier(): void {
    this.renderState?.setQuality(this.tierState);
    this.applyPixelRatio();
    this.onChangeCallback?.(this.snapshot());
  }

  /**
   * Applies the tier's pixel-ratio budget. The composer resolves its ratio from
   * the shared renderer's ratio, so the ladder writes the scaled ratio there and
   * resyncs the composer: the floor tier genuinely renders fewer pixels, and the
   * steady-state frame loop keeps reading the ratio we set.
   */
  private applyPixelRatio(): void {
    const renderer = this.contextState?.renderer;
    const pipeline = this.renderState?.pipeline;
    if (!renderer || !pipeline || typeof renderer.setPixelRatio !== 'function') return;
    const scale = POSTFX_QUALITY_SETTINGS[this.tierState].pixelRatioScale;
    const ratio = Math.min(
      MAX_PIXEL_RATIO,
      Math.max(MIN_PIXEL_RATIO, this.basePixelRatio * scale),
    );
    try {
      renderer.setPixelRatio(ratio);
      pipeline.syncViewport(true);
    } catch (error) {
      if (typeof console !== 'undefined') {
        console.warn('[chrono-city] adaptive quality: pixel ratio not applied', error);
      }
    }
  }
}

/** Creates an adaptive-quality monitor (the `create` half of the lifecycle). */
export function createAdaptiveQualityMonitor(
  options: AdaptiveQualityOptions = {},
): AdaptiveQualityMonitor {
  return new AdaptiveQualityMonitor(options);
}
