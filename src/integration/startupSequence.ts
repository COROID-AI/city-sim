/**
 * Chrono City — startup sequence (register everything, then self-start).
 *
 * The page's foundation shell boots on load and publishes `window.__chronoCity`.
 * This module is what turns that empty stage into the composed city: it creates
 * every produced system in dependency order, wires them to the one shared
 * `TimelineRuntime`, composes them through `EraTransitionOrchestrator`, covers
 * the registration window with a loading screen, and then starts the scene
 * without waiting for the visitor to do anything.
 *
 * Ownership and sequencing rules this module exists to enforce:
 *
 *   1. **The loading screen covers registration.** It is created as soon as the
 *      entry point calls `startChronoCityExperience()` (before the shell is even
 *      live), reports each stage while systems register, and only comes down once
 *      the composed scene has drawn its first frame.
 *   2. **Register, never block.** Every stage is attempted in order and a failing
 *      stage is recorded, not fatal: the block still boots and still transforms.
 *   3. **Audio never gates startup.** The director is discovered, not created
 *      here, and its context stays suspended behind the existing gesture unlock;
 *      no stage waits on audio and nothing calls `ensureContext()`.
 *   4. **One timeline, one orchestrator.** Content systems receive the shared
 *      timeline and the shared material library, and the orchestrator is handed
 *      every produced handle so it can audit the composed era change.
 *   5. **Self-start.** Once registration is done the shell is started and the
 *      intro tour is launched; the city is live with no user action.
 *   6. **Software renderers start light.** The composed app opens on the
 *      post-processing tier the renderer can hold (`performance` on SwiftShader
 *      and friends, `high` on a real GPU), so the guardrail protects the frame
 *      budget from the very first frame.
 *
 * Lifecycle:
 *   create    → `createStartupSequence({ app })` builds the loading screen.
 *   consume   → `start()`, `whenReady()`, `snapshot()`, `dispose()`.
 *   integrate → `startChronoCityExperience()` is the entry point `main.ts`
 *               calls once; it waits for `chrono-city:ready` and publishes the
 *               live sequence on `window.__chronoCityExperience`.
 */

import { DEFAULT_ERA, type EraId } from '../core/eraContracts';
import {
  CHRONO_CITY_GLOBAL_KEY,
  type SceneContext,
  type SceneContextApp,
  type SystemRegistration,
} from '../core/sceneContext';
import { createTimelineRuntime, type TimelineRuntime } from '../era/timelineRuntime';
import { getAudioDirector, type AudioDirector } from '../audio/audioDirector';
import {
  createSoundscapeApi,
  integrateSoundscapeGlobal,
  type SoundscapeApi,
} from '../audio/soundscapeApi';
import { createBuildingsApi, type BuildingsApi } from '../city/buildings/buildingsApi';
import {
  createPedestriansApi,
  type PedestriansApi,
} from '../city/pedestrians/pedestriansApi';
import {
  createStorefrontsApi,
  type StorefrontsApi,
} from '../city/storefronts/storefrontsApi';
import { createTrafficApi, type TrafficApi } from '../city/traffic/trafficApi';
import {
  createEnvironmentApi,
  type EnvironmentApi,
} from '../environment/environmentApi';
import {
  createInspectionLayer,
  integrateInspectionGlobal,
  type InspectionLayer,
} from '../interaction/pickingController';
import {
  createMaterialLibraryFromScene,
  type MaterialLibrary,
} from '../materials/materialLibrary';
import { createNavigationRig, type NavigationRig } from '../navigation/navigationRig';
import {
  createRenderPipelineApi,
  type RenderPipelineApi,
} from '../rendering/renderPipelineApi';
import { createTourApi, integrateTourGlobal, type TourApi } from '../tour/tourApi';
import {
  createHudApi,
  TIMELINE_GLOBAL_KEY,
  type HudApi,
} from '../ui/hudApi';
import {
  createAdaptiveQualityMonitor,
  type AdaptiveQualityMonitor,
} from './adaptiveQuality';
import type { PostFxQuality } from '../rendering/postfx';
import {
  createEraTransitionOrchestrator,
  integrateOrchestratorGlobal,
  type EraTransitionOrchestrator,
  type OrchestratedSystems,
} from './eraTransitionOrchestrator';

export const STARTUP_SEQUENCE_VERSION = 1;

/** Global key the live startup sequence is published on. */
export const STARTUP_GLOBAL_KEY = '__chronoCityExperience';

/** Attribute marking the loading screen (harnesses never learn class names). */
export const LOADING_ATTRIBUTE = 'data-chrono-loading';

/** Stable query hooks for the loading screen. */
export const LOADING_SELECTORS = Object.freeze({
  screen: `[${LOADING_ATTRIBUTE}="screen"]`,
  status: `[${LOADING_ATTRIBUTE}="status"]`,
  bar: `[${LOADING_ATTRIBUTE}="bar"]`,
});

/** Tick-system id of the first-frame hook that lifts the loading screen. */
export const STARTUP_FRAME_SYSTEM_ID = 'chrono-startup-frame';

/** Runs after every content system (and after adaptive quality at `950`). */
export const STARTUP_FRAME_SYSTEM_ORDER = 5000;

/**
 * Frames the loading screen stays up after registration: the scene is only
 * uncovered once the first full frame (ticks + draw) has actually been composed.
 */
export const LOADING_MIN_VISIBLE_FRAMES = 2;

/**
 * Minimum time the screen stays up once registration is done. Registration is
 * synchronous, so without a short hold the screen would flash by too fast to
 * read — or to observe from a browser harness driving a reload.
 */
export const LOADING_MIN_VISIBLE_MS = 400;

/** Loading-screen states, in order. */
export type LoadingState = 'pending' | 'registering' | 'ready' | 'hidden';

/** One stage of the startup sequence. */
export interface StartupStageReport {
  readonly id: string;
  readonly label: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
  /** Tick-system ids that appeared while this stage ran. */
  readonly systemIds: readonly string[];
  /** `null` when the stage completed; the message when it did not. */
  readonly error: string | null;
  /** `true` when the stage was skipped for a documented reason (e.g. no audio). */
  readonly skipped: boolean;
}

/**
 * `true` when the renderer reports a software implementation (SwiftShader,
 * llvmpipe, a basic fallback, …). Such a renderer cannot hold the cinematic
 * frame budget, so the composed app starts it on the lightest tier.
 */
export function isSoftwareRenderer(renderer: {
  getContext?: () => unknown;
} | null | undefined): boolean {
  if (!renderer || typeof renderer.getContext !== 'function') return false;
  try {
    const context = renderer.getContext() as {
      getExtension?: (name: string) => { UNMASKED_RENDERER_WEBGL: number } | null;
      getParameter?: (parameter: number) => unknown;
    } | null;
    if (!context || typeof context.getExtension !== 'function') return false;
    const extension = context.getExtension('WEBGL_debug_renderer_info');
    if (!extension) return false;
    const name = String(context.getParameter?.(extension.UNMASKED_RENDERER_WEBGL) ?? '');
    return /swiftshader|software|llvmpipe|basic render|mesa offscreen|swrast/i.test(name);
  } catch {
    return false;
  }
}

/**
 * Quality tier the composed app starts on: `high` for real GPUs, `performance`
 * for software renderers, where the full 8-pass stack cannot hold 60 fps and the
 * frame budget matters more than depth-of-field and grain.
 */
export function initialQualityForRenderer(renderer: {
  getContext?: () => unknown;
} | null | undefined): PostFxQuality {
  return isSoftwareRenderer(renderer) ? 'performance' : 'high';
}

/** The registration plan, in execution order. */
export const STARTUP_STAGES: readonly { readonly id: string; readonly label: string }[] =
  Object.freeze([
    { id: 'navigation', label: 'Calibrating the camera rig' },
    { id: 'timeline', label: 'Setting the era timeline' },
    { id: 'inspection', label: 'Wiring inspection' },
    { id: 'buildings', label: 'Raising the block' },
    { id: 'storefronts', label: 'Fitting shopfronts and advertising' },
    { id: 'traffic', label: 'Releasing the traffic' },
    { id: 'pedestrians', label: 'Bringing the crowds out' },
    { id: 'environment', label: 'Painting sky, lighting and street dressing' },
    { id: 'soundscape', label: 'Tuning the era soundscape' },
    { id: 'hud', label: 'Assembling the timeline HUD' },
    { id: 'render', label: 'Grading the frame' },
    { id: 'quality', label: 'Arming the adaptive-quality guardrail' },
    { id: 'tour', label: 'Framing the intro tour' },
    { id: 'orchestrator', label: 'Linking every era transition' },
  ]);

/** Flat view of the loading screen for tests and harnesses. */
export interface LoadingScreenSnapshot {
  readonly state: LoadingState;
  readonly message: string;
  readonly stage: string | null;
  readonly completedStages: number;
  readonly totalStages: number;
  readonly progress: number;
  readonly visible: boolean;
  readonly frames: number;
}

export interface LoadingScreenOptions {
  readonly document?: Document | null;
  /** Element the screen is appended to. Defaults to `document.body`. */
  readonly container?: HTMLElement | null;
  readonly title?: string;
  readonly totalStages?: number;
  /** Minimum visible time after registration. Defaults to `LOADING_MIN_VISIBLE_MS`. */
  readonly minVisibleMs?: number;
}

/**
 * The full-viewport loading screen that covers system registration. Styling is
 * inline on purpose: the integration layer owns no stylesheet, and the screen
 * must look intentional from the very first paint.
 */
export class LoadingScreen {
  readonly element: HTMLElement | null;
  readonly statusElement: HTMLElement | null;
  readonly barElement: HTMLElement | null;

  private readonly total: number;
  private readonly minVisibleMs: number;
  private readonly openedAtMs = nowMs();
  private readonly completed = new Set<string>();

  private stateValue: LoadingState = 'pending';
  private messageValue: string;
  private stageValue: string | null = null;
  private framesValue = 0;
  private disposedState = false;

  constructor(options: LoadingScreenOptions = {}) {
    const documentRef = options.document ?? (typeof document === 'undefined' ? null : document);
    this.total = Math.max(1, Math.round(options.totalStages ?? STARTUP_STAGES.length));
    this.minVisibleMs = Math.max(0, options.minVisibleMs ?? LOADING_MIN_VISIBLE_MS);
    this.messageValue = 'Assembling the block…';

    if (!documentRef) {
      this.element = null;
      this.statusElement = null;
      this.barElement = null;
      return;
    }

    const container = options.container ?? documentRef.body ?? null;
    const element = documentRef.createElement('div');
    element.setAttribute(LOADING_ATTRIBUTE, 'screen');
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-busy', 'true');
    element.setAttribute('aria-label', 'Chrono City loading');
    element.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:60',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:radial-gradient(120% 120% at 50% 20%, #0d1626 0%, #05070d 70%)',
      'color:#e8eef7',
      'font-family:Inter, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
      'opacity:1',
    ].join(';');

    const panel = documentRef.createElement('div');
    panel.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:14px',
      'align-items:center',
      'min-width:min(78vw, 420px)',
      'padding:28px 32px',
      'border-radius:16px',
      'background:rgba(7,11,20,0.72)',
      'border:1px solid rgba(111,211,255,0.22)',
      'box-shadow:0 24px 60px rgba(0,0,0,0.45)',
    ].join(';');

    const title = documentRef.createElement('p');
    title.textContent = options.title ?? 'Chrono City';
    title.style.cssText =
      'margin:0;font-size:13px;letter-spacing:0.34em;text-transform:uppercase;color:#6fd3ff';

    const status = documentRef.createElement('p');
    status.setAttribute(LOADING_ATTRIBUTE, 'status');
    status.textContent = this.messageValue;
    status.style.cssText =
      'margin:0;font-size:15px;line-height:1.5;text-align:center;color:#c9d6e6';

    const track = documentRef.createElement('div');
    track.setAttribute('role', 'presentation');
    track.style.cssText =
      'position:relative;width:100%;height:3px;border-radius:2px;background:rgba(232,238,247,0.14);overflow:hidden';

    const bar = documentRef.createElement('div');
    bar.setAttribute(LOADING_ATTRIBUTE, 'bar');
    bar.style.cssText =
      'position:absolute;left:0;top:0;bottom:0;width:100%;border-radius:2px;transform:scaleX(0.04);transform-origin:left center;background:linear-gradient(90deg,#6fd3ff,#b7e9ff);transition:transform 200ms ease';
    track.appendChild(bar);
    panel.append(title, status, track);
    element.appendChild(panel);

    container.appendChild(element);
    this.element = element;
    this.statusElement = status;
    this.barElement = bar;
    this.writeState();
  }

  get state(): LoadingState {
    return this.stateValue;
  }

  get message(): string {
    return this.messageValue;
  }

  get isVisible(): boolean {
    return this.element !== null && this.stateValue !== 'hidden';
  }

  get frames(): number {
    return this.framesValue;
  }

  /** Records that a stage has begun (and moves the screen to `registering`). */
  setStage(stage: string, message?: string): void {
    if (this.disposedState) return;
    this.stateValue = 'registering';
    this.stageValue = stage;
    this.messageValue = message ?? `Registering ${stage}…`;
    this.writeState();
  }

  /** Records that a stage has finished, with progress on the bar. */
  completeStage(stage: string, message?: string): void {
    if (this.disposedState) return;
    this.completed.add(stage);
    if (message !== undefined) this.messageValue = message;
    this.writeState();
  }

  /** Registration is done: the scene is about to draw its first frame. */
  setReady(message = 'Starting the scene…'): void {
    if (this.disposedState) return;
    this.stateValue = 'ready';
    this.messageValue = message;
    this.writeState();
  }

  /** Called once per frame; after `LOADING_MIN_VISIBLE_FRAMES` the screen lifts. */
  frame(): boolean {
    if (this.disposedState) return true;
    this.framesValue += 1;
    if (this.stateValue === 'hidden') return true;
    const heldLongEnough = nowMs() - this.openedAtMs >= this.minVisibleMs;
    if (
      this.stateValue === 'ready' &&
      this.framesValue >= LOADING_MIN_VISIBLE_FRAMES &&
      heldLongEnough
    ) {
      this.hide();
      return true;
    }
    return false;
  }

  /** Removes the screen. */
  hide(): void {
    if (this.disposedState) return;
    this.stateValue = 'hidden';
    const element = this.element;
    if (element) {
      element.setAttribute(LOADING_ATTRIBUTE, 'hidden');
      element.setAttribute('aria-busy', 'false');
      element.style.opacity = '0';
      element.remove();
    }
    this.writeState();
  }

  snapshot(): LoadingScreenSnapshot {
    return Object.freeze({
      state: this.stateValue,
      message: this.messageValue,
      stage: this.stageValue,
      completedStages: this.completed.size,
      totalStages: this.total,
      progress: Math.min(1, this.completed.size / this.total),
      visible: this.isVisible,
      frames: this.framesValue,
    });
  }

  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.element?.remove();
  }

  private writeState(): void {
    const element = this.element;
    if (element) element.setAttribute(`${LOADING_ATTRIBUTE}-state`, this.stateValue);
    if (this.statusElement) this.statusElement.textContent = this.messageValue;
    if (this.barElement) {
      const progress = Math.min(1, Math.max(0.04, this.completed.size / this.total));
      this.barElement.style.transform = `scaleX(${progress.toFixed(3)})`;
    }
  }
}

/** The composed city: every produced handle plus the orchestration seam. */
export interface ComposedCity extends OrchestratedSystems {
  readonly buildings: BuildingsApi;
  readonly storefronts: StorefrontsApi;
  readonly traffic: TrafficApi;
  readonly pedestrians: PedestriansApi;
  readonly environment: EnvironmentApi;
  readonly soundscape: SoundscapeApi | null;
  readonly hud: HudApi;
  readonly render: RenderPipelineApi;
  readonly tour: TourApi;
  readonly navigation: NavigationRig;
  readonly inspection: InspectionLayer;
  readonly audio: AudioDirector | null;
  readonly quality: AdaptiveQualityMonitor;
  readonly materials: MaterialLibrary;
  readonly timeline: TimelineRuntime;
}

/**
 * Mutable draft of the composed systems while the sequence is registering. The
 * public `ComposedCity` stays readonly; only the startup sequence fills it in.
 */
type ComposedSystemsDraft = {
  -readonly [Key in keyof ComposedCity]?: ComposedCity[Key];
};

/** Flat view of the started sequence for tests and harnesses. */
export interface StartupSnapshot {
  readonly version: number;
  readonly ready: boolean;
  readonly sceneStarted: boolean;
  readonly frames: number;
  readonly stageCount: number;
  readonly stages: readonly StartupStageReport[];
  readonly systemIds: readonly string[];
  readonly errors: readonly string[];
  readonly loading: LoadingScreenSnapshot | null;
  readonly era: EraId;
}

export interface StartupSequenceOptions {
  /** Live shell handle. Required (the app is discovered by the entry point). */
  readonly app?: SceneContextApp | null;
  readonly document?: Document | null;
  /** Audio director; discovered from the global handle when omitted. */
  readonly audio?: AudioDirector | null;
  /** Era the composed city starts in. Defaults to `DEFAULT_ERA`. */
  readonly initialEra?: EraId;
  /** Pre-created handles (tests inject individual systems). */
  readonly systems?: Partial<ComposedCity>;
  /** Pre-created orchestration seam (tests that drive it directly). */
  readonly orchestrator?: EraTransitionOrchestrator | null;
  /** Pre-created loading screen (the entry point shows it before boot). */
  readonly loading?: LoadingScreen | null;
  /** Create a loading screen when none was supplied. Defaults to `true`. */
  readonly loadingScreen?: boolean;
  /** Launch the intro flythrough once the scene starts. Defaults to `true`. */
  readonly startTour?: boolean;
  /** Arm the adaptive-quality monitor. Defaults to `true`. */
  readonly adaptiveQuality?: boolean;
  /**
   * Hand the frame budget to the adaptive-quality monitor instead of the
   * composer's own guard, so exactly one owner drives the tier ladder.
   * Defaults to `true` (and is forced off when the monitor is disabled).
   */
  readonly adaptiveQualityOwnsBudget?: boolean;
  /** Publish the sequence and every handle global. Defaults to `true`. */
  readonly publishGlobal?: boolean;
  readonly onReady?: (sequence: StartupSequence) => void;
}

/**
 * Registers every produced system on one shell, then starts the scene. Safe to
 * call `start()` once; repeated calls are no-ops.
 */
export class StartupSequence {
  readonly version = STARTUP_SEQUENCE_VERSION;

  readonly app: SceneContextApp;
  readonly context: SceneContext;
  readonly timeline: TimelineRuntime;
  readonly loading: LoadingScreen | null;
  readonly orchestrator: EraTransitionOrchestrator;

  private readonly documentRef: Document | null;
  private readonly startTourFlag: boolean;
  private readonly publishFlag: boolean;
  private readonly adaptiveQualityEnabled: boolean;
  private readonly adaptiveQualityOwnsBudgetFlag: boolean;
  private readonly onReadyCallback: ((sequence: StartupSequence) => void) | null;
  private readonly injected: ComposedSystemsDraft;
  private readonly injectedOrchestrator: EraTransitionOrchestrator | null;
  private readonly audioState: AudioDirector | null;

  private readonly stageReports: StartupStageReport[] = [];
  private readonly errorList: string[] = [];
  private readonly created: Array<{ dispose(): void }> = [];

  private frameRegistration: SystemRegistration | null = null;
  private cityState: ComposedCity | null = null;
  private readyState = false;
  private startedState = false;
  private disposedState = false;

  constructor(options: StartupSequenceOptions = {}) {
    const app = options.app;
    if (!app?.context) {
      throw new TypeError('StartupSequence needs a live SceneContextApp.');
    }
    this.app = app;
    this.context = app.context;
    this.documentRef = options.document ?? (typeof document === 'undefined' ? null : document);
    this.startTourFlag = options.startTour ?? true;
    this.publishFlag = options.publishGlobal ?? true;
    this.adaptiveQualityEnabled = options.adaptiveQuality ?? true;
    this.adaptiveQualityOwnsBudgetFlag =
      this.adaptiveQualityEnabled && (options.adaptiveQualityOwnsBudget ?? true);
    this.onReadyCallback = options.onReady ?? null;
    this.injected = { ...options.systems };
    this.injectedOrchestrator = options.orchestrator ?? null;
    this.audioState = options.audio ?? options.systems?.audio ?? getAudioDirector();
    this.loading =
      options.loading ??
      ((options.loadingScreen ?? true)
        ? new LoadingScreen({ document: this.documentRef, container: this.app.overlayRoot })
        : null);

    // The timeline is the single year store: it registers first (order −1000) so
    // every content system created below can register as a blendable on it.
    this.timeline =
      this.injected.timeline ??
      createTimelineRuntime({
        context: this.context,
        initialEra: options.initialEra ?? DEFAULT_ERA,
      });
    this.track(this.timeline);

    this.orchestrator =
      this.injectedOrchestrator ??
      createEraTransitionOrchestrator({
        timeline: this.timeline,
        context: this.context,
        systems: { audio: this.audioState },
      });
  }

  /* ------------------------------------------------------------------ *
   * registration
   * ------------------------------------------------------------------ */

  /** Builds and wires the city, then self-starts the scene. Idempotent. */
  start(): this {
    if (this.startedState) return this;
    this.startedState = true;

    const audio = this.orchestrator.systems.audio ?? this.audioState;
    const initialEra = this.timeline.era;
    const systems = this.injected;

    this.runStage('navigation', () => {
      systems.navigation = systems.navigation ?? this.track(createNavigationRig(this.context));
    });

    this.runStage('timeline', () => {
      if (this.publishFlag && typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>)[TIMELINE_GLOBAL_KEY] = this.timeline;
      }
    });

    this.runStage('inspection', () => {
      systems.inspection =
        systems.inspection ?? this.track(createInspectionLayer({ context: this.context, era: initialEra }));
      if (this.publishFlag) integrateInspectionGlobal(systems.inspection);
    });

    this.runStage('buildings', () => {
      systems.materials = systems.materials ?? this.track(createMaterialLibraryFromScene(this.context));
      systems.buildings =
        systems.buildings ??
        this.track(
          createBuildingsApi({
            context: this.context,
            timeline: this.timeline,
            materials: systems.materials,
            registry: systems.inspection?.registry ?? null,
            initialEra,
          }),
        );
    });

    this.runStage('storefronts', () => {
      systems.storefronts =
        systems.storefronts ??
        this.track(
          createStorefrontsApi({
            context: this.context,
            timeline: this.timeline,
            materials: systems.materials,
            registry: systems.inspection?.registry ?? null,
            mountSurfaces: systems.buildings?.mountSurfaceList() ?? null,
            initialEra,
          }),
        );
    });

    this.runStage('traffic', () => {
      if (systems.traffic) return;
      systems.traffic = this.track(
        createTrafficApi({
          library: systems.materials,
          context: this.context,
          timeline: this.timeline,
          audio: audio ?? null,
          registry: systems.inspection?.registry ?? null,
          initialEra,
        }),
      );
      if (this.publishFlag) systems.traffic.publish();
    });

    this.runStage('pedestrians', () => {
      systems.pedestrians =
        systems.pedestrians ??
        this.track(
          createPedestriansApi({
            scene: this.context,
            timeline: this.timeline,
            materials: systems.materials,
            registry: systems.inspection?.registry ?? null,
            audio: audio ?? null,
            initialEra,
          }),
        );
    });

    this.runStage('environment', () => {
      systems.environment =
        systems.environment ??
        this.track(
          createEnvironmentApi({
            context: this.context,
            timeline: this.timeline,
            materials: systems.materials,
            registry: systems.inspection?.registry ?? null,
            initialEra,
          }),
        );
      systems.environment.integrate();
    });

    this.runStage('soundscape', () => {
      if (systems.soundscape) return true;
      if (!audio) return false;
      systems.soundscape = this.track(
        createSoundscapeApi({
          director: audio,
          timeline: this.timeline,
          rig: systems.navigation ?? null,
          context: this.context,
          initialEra,
          documentRef: this.documentRef,
        }),
      );
      if (this.publishFlag) integrateSoundscapeGlobal(systems.soundscape);
      return true;
    });

    this.runStage('hud', () => {
      systems.hud =
        systems.hud ??
        this.track(
          createHudApi({
            context: this.context,
            timeline: this.timeline,
            audio: audio ?? null,
            navigation: systems.navigation ?? null,
            integrateGlobal: this.publishFlag,
          }),
        );
    });

    this.runStage('render', () => {
      systems.render =
        systems.render ??
        this.track(
          createRenderPipelineApi({
            context: this.context,
            timeline: this.timeline,
            environment: systems.environment ?? null,
            initialEra,
            quality: initialQualityForRenderer(this.context.renderer),
            monitorBudget: !this.adaptiveQualityOwnsBudgetFlag,
          }),
        );
      systems.render.integrate();
    });

    this.runStage('quality', () => {
      if (!this.adaptiveQualityEnabled) return false;
      // The detected tier is also the ceiling: a software renderer has no
      // head-room to climb back into, so the ladder cannot start oscillating.
      const ceiling = initialQualityForRenderer(this.context.renderer);
      systems.quality =
        systems.quality ??
        this.track(
          createAdaptiveQualityMonitor({
            context: this.context,
            render: systems.render ?? null,
            initialTier: ceiling,
            maxTier: ceiling,
          }),
        );
      return true;
    });

    this.runStage('tour', () => {
      systems.tour =
        systems.tour ??
        this.track(
          createTourApi({
            context: this.context,
            timeline: this.timeline,
            rig: systems.navigation ?? null,
            hud: systems.hud ?? null,
            audio: audio ?? null,
            document: this.documentRef,
            overlayRoot: this.app.overlayRoot,
            integrateGlobal: this.publishFlag,
          }),
        );
      if (this.publishFlag) integrateTourGlobal(systems.tour);
    });

    this.runStage('orchestrator', () => {
      this.orchestrator.connect({
        buildings: systems.buildings ?? null,
        storefronts: systems.storefronts ?? null,
        traffic: systems.traffic ?? null,
        pedestrians: systems.pedestrians ?? null,
        environment: systems.environment ?? null,
        soundscape: systems.soundscape ?? null,
        hud: systems.hud ?? null,
        render: systems.render ?? null,
        tour: systems.tour ?? null,
        navigation: systems.navigation ?? null,
        inspection: systems.inspection ?? null,
        audio: audio ?? null,
        quality: systems.quality ?? null,
      });
      if (this.publishFlag) integrateOrchestratorGlobal(this.orchestrator);
    });

    this.cityState = this.assembleCity(systems, audio ?? null);
    this.readyState = true;

    // Register the first-frame hook before starting the loop so the loading
    // screen cannot be missed, then hand the scene to the shell: self-start.
    this.frameRegistration = this.context.registerSystem(
      STARTUP_FRAME_SYSTEM_ID,
      () => this.onFrame(),
      { order: STARTUP_FRAME_SYSTEM_ORDER },
    );
    this.loading?.setReady();
    this.context.start();
    if (this.startTourFlag && this.cityState) {
      try {
        this.cityState.tour.startIntro();
      } catch (error) {
        this.recordError('tour', error);
      }
    }
    if (this.publishFlag && typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>)[STARTUP_GLOBAL_KEY] = this;
      if (typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('chrono-city:experience-ready', { detail: this }));
      }
    }
    this.onReadyCallback?.(this);
    return this;
  }

  /** Resolves once the sequence has registered every system (or was disposed). */
  async whenReady(): Promise<this> {
    if (this.readyState || this.disposedState) return this;
    await new Promise<void>((resolve) => {
      if (typeof queueMicrotask === 'function') queueMicrotask(() => resolve());
      else resolve();
    });
    return this;
  }

  /* ------------------------------------------------------------------ *
   * observation
   * ------------------------------------------------------------------ */

  get isStarted(): boolean {
    return this.startedState;
  }

  /** `true` once every stage has been attempted. */
  get isReady(): boolean {
    return this.readyState;
  }

  /** `true` once the composed scene has drawn a frame and the screen lifted. */
  get isSceneStarted(): boolean {
    return this.readyState && this.frameRegistration === null;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** The composed handles, or `null` before `start()`. */
  get city(): ComposedCity | null {
    return this.cityState;
  }

  get stages(): readonly StartupStageReport[] {
    return this.stageReports;
  }

  /** Stage failures in stage order (empty in a healthy boot). */
  get errors(): readonly string[] {
    return this.errorList;
  }

  /** Tick-system ids currently registered on the shell. */
  get systemIds(): readonly string[] {
    return this.context.getSystems().map((system) => system.id);
  }

  snapshot(): StartupSnapshot {
    return Object.freeze({
      version: STARTUP_SEQUENCE_VERSION,
      ready: this.readyState,
      sceneStarted: this.isSceneStarted,
      frames: this.loading?.frames ?? 0,
      stageCount: this.stageReports.length,
      stages: this.stageReports,
      systemIds: this.systemIds,
      errors: this.errorList,
      loading: this.loading ? this.loading.snapshot() : null,
      era: this.timeline.era,
    });
  }

  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.frameRegistration?.dispose();
    this.frameRegistration = null;

    this.orchestrator.dispose();
    for (let index = this.created.length - 1; index >= 0; index -= 1) {
      try {
        this.created[index]?.dispose();
      } catch (error) {
        if (typeof console !== 'undefined') {
          console.warn('[chrono-city] startup dispose failed', error);
        }
      }
    }
    this.created.length = 0;
    this.cityState = null;
    this.readyState = false;
    this.loading?.dispose();

    if (typeof window !== 'undefined') {
      const scope = window as unknown as Record<string, unknown>;
      if (scope[STARTUP_GLOBAL_KEY] === this) delete scope[STARTUP_GLOBAL_KEY];
    }
  }

  /* ------------------------------------------------------------------ *
   * internals
   * ------------------------------------------------------------------ */

  /** Remembers a handle so `dispose()` can unwind it in reverse creation order. */
  private track<T extends { dispose(): void }>(system: T): T {
    this.created.push(system);
    return system;
  }

  private onFrame(): void {
    const registration = this.frameRegistration;
    this.loading?.frame();
    if (this.loading && !this.loading.isVisible && registration) {
      registration.dispose();
      this.frameRegistration = null;
    }
  }

  private runStage(id: string, body: () => boolean | void): void {
    const descriptor = STARTUP_STAGES.find((stage) => stage.id === id);
    const label = descriptor?.label ?? id;
    const startedAt = nowMs();
    const before = new Set(this.systemIds);
    this.loading?.setStage(label);
    let error: string | null = null;
    let skipped = false;
    try {
      skipped = body() === false;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      this.recordError(id, cause);
    }
    const after = this.systemIds.filter((systemId) => !before.has(systemId));
    this.stageReports.push(
      Object.freeze({
        id,
        label,
        startedAtMs: startedAt,
        durationMs: nowMs() - startedAt,
        systemIds: Object.freeze(after),
        error,
        skipped,
      }),
    );
    if (error) this.loading?.setStage(label, `Skipped ${label}: ${error}`);
    else this.loading?.completeStage(id, skipped ? `${label} — not available` : `${label} ✓`);
  }

  private recordError(stage: string, cause: unknown): void {
    const message = cause instanceof Error ? cause.message : String(cause);
    this.errorList.push(`${stage}: ${message}`);
    if (typeof console !== 'undefined') {
      console.error(`[chrono-city] startup stage "${stage}" failed`, cause);
    }
  }

  /** The composed city, or `null` when a required stage did not produce a handle. */
  private assembleCity(
    systems: ComposedSystemsDraft,
    audio: AudioDirector | null,
  ): ComposedCity | null {
    const required = [
      systems.buildings,
      systems.storefronts,
      systems.traffic,
      systems.pedestrians,
      systems.environment,
      systems.hud,
      systems.render,
      systems.tour,
      systems.navigation,
      systems.inspection,
      systems.quality,
      systems.materials,
    ];
    if (required.some((handle) => !handle)) return null;
    return Object.freeze({
      ...systems,
      buildings: systems.buildings as BuildingsApi,
      storefronts: systems.storefronts as StorefrontsApi,
      traffic: systems.traffic as TrafficApi,
      pedestrians: systems.pedestrians as PedestriansApi,
      environment: systems.environment as EnvironmentApi,
      soundscape: systems.soundscape ?? null,
      hud: systems.hud as HudApi,
      render: systems.render as RenderPipelineApi,
      tour: systems.tour as TourApi,
      navigation: systems.navigation as NavigationRig,
      inspection: systems.inspection as InspectionLayer,
      audio,
      quality: systems.quality as AdaptiveQualityMonitor,
      materials: systems.materials as MaterialLibrary,
      timeline: this.timeline,
    });
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Runs a callback on the next task (falls back to a microtask, then inline). */
function scheduleTask(task: () => void): void {
  if (typeof setTimeout === 'function') {
    setTimeout(task, 0);
    return;
  }
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(task);
    return;
  }
  task();
}

/** Creates the loading screen the entry point shows before the shell is live. */
export function createBootLoadingScreen(
  documentRef?: Document | null,
  container?: HTMLElement | null,
): LoadingScreen {
  return new LoadingScreen({ document: documentRef ?? null, container: container ?? null });
}

/** Reads the live shell handle, or `null` before it boots. */
export function discoverAppHandle(
  key: string = CHRONO_CITY_GLOBAL_KEY,
): SceneContextApp | null {
  if (typeof window === 'undefined') return null;
  const value = (window as unknown as Record<string, unknown>)[key];
  return value ? (value as SceneContextApp) : null;
}

/**
 * App entry point: waits for the shell to publish itself (or uses the handle that
 * is already live), composes the city and self-starts it.
 *
 * Returns the started sequence when the shell is already live; otherwise the
 * loading screen goes up immediately and the composition runs on the next task,
 * once `chrono-city:ready` has arrived *and* the shell is still the live one.
 * That deferral is deliberate: the loading screen paints before the (heavy)
 * registration work runs, and a shell that was booted and stopped again in the
 * meantime is never composed.
 */
export function startChronoCityExperience(
  options: StartupSequenceOptions = {},
): StartupSequence | null {
  if (typeof window === 'undefined') return null;
  const documentRef =
    options.document ?? (typeof document === 'undefined' ? null : document);

  const live = options.app ?? discoverAppHandle();
  if (live) return new StartupSequence({ ...options, app: live }).start();

  const loading =
    options.loading ?? createBootLoadingScreen(documentRef, documentRef?.body ?? null);
  const boot = (app: SceneContextApp | null): void => {
    if (!app) return;
    if (readExperience()) {
      loading.dispose();
      return;
    }
    scheduleTask(() => {
      // By now the shell may have been stopped or replaced: only ever compose
      // the live handle the ready event announced.
      if (readExperience() || discoverAppHandle() !== app || app.context.isDisposed) {
        loading.dispose();
        return;
      }
      new StartupSequence({ ...options, app, loading }).start();
    });
  };

  const onReady = (event: Event): void => {
    const detail = (event as CustomEvent<SceneContextApp>).detail;
    boot(detail ?? discoverAppHandle());
  };
  window.addEventListener('chrono-city:ready', onReady, { once: true });

  // Defensive: a shell that announced itself between the read above and the
  // listener registration would otherwise never be composed.
  const immediate = discoverAppHandle();
  if (immediate) {
    window.removeEventListener('chrono-city:ready', onReady);
    boot(immediate);
  }
  return null;
}

/** The published sequence, or `null` before the city is composed. */
export function readExperience(key: string = STARTUP_GLOBAL_KEY): StartupSequence | null {
  if (typeof window === 'undefined') return null;
  const value = (window as unknown as Record<string, unknown>)[key];
  return value instanceof StartupSequence ? value : null;
}

declare global {
  interface Window {
    __chronoCityExperience?: StartupSequence;
  }
}
