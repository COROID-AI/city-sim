/**
 * Chrono City — `TourApi`: the tour layer's integration seam.
 *
 * One object coordinates everything cinematic in the app:
 *
 *   * the **intro flythrough** — a cinematic camera path that plays on load and
 *     hands the camera back to `NavigationRig` the moment the visitor touches
 *     anything (input cancels it, it never traps the user);
 *   * the **auto time-tour** — an optional showcase that walks the five eras
 *     (`1945 → 1965 → 1985 → 2005 → 2025`), one stop at a time, with a HUD
 *     caption and an era whoosh per step and a slow crane around the block;
 *   * the **first-run control hints** — the once-only onboarding card;
 *   * **era-caption sync** — captions always describe the year the timeline is
 *     actually showing, whoever moved it.
 *
 * Ownership rules this module exists to enforce:
 *
 *   1. Year changes go **only** through `TimelineRuntime.selectEra()`, so every
 *      `EraBlendable` in the scene transforms together. The tour never pokes a
 *      system directly.
 *   2. Captions go **only** through `HudApi.toast()` / `dismissToast()`, so they
 *      land in the same live region as the rest of the HUD.
 *   3. Era cues go **only** through `AudioDirector.play()`. When the director is
 *      itself one of the timeline's blendables, the timeline already voices the
 *      seam in `setEra()`; the tour detects that and stays quiet rather than
 *      doubling the whoosh.
 *   4. The camera is borrowed, never seized: while the tour flies it registers a
 *      system *after* the rig (`TOUR_SYSTEM_ORDER` > `NAVIGATION_SYSTEM_ORDER`)
 *      and writes its pose, then glides back onto the rig's **live** pose — a
 *      user already dragging is followed, not fought, and the last hand-off
 *      frame is exactly the pose the rig takes over with (no camera jump).
 *
 * Lifecycle:
 *   create    → `createTourApi()` / `new TourApi(options)`, or `bootTour()`
 *               which discovers the live scene, timeline, HUD and audio handles.
 *   consume   → `startIntro()`, `startTimeTour()` / `stop()`, `snapshot()`,
 *               `showOnboarding()` / `dismissOnboarding()`, `syncCaption()`.
 *   integrate → the application entry point builds one `TourApi` once the scene
 *               is live and publishes it on `window.__chronoCityTour`; the HUD
 *               and audio handles may be attached later through `connect()`,
 *               because nothing is read until a tour actually runs.
 */

import * as THREE from 'three';

import { AUDIO_GLOBAL_KEY, getAudioDirector, type AudioDirector } from '../audio/audioDirector';
import { ERA_WHOOSH_CUE } from '../audio/sfxSynth';
import { ERA_IDS, eraYear, isEraId, type EraId } from '../core/eraContracts';
import {
  CHRONO_CITY_GLOBAL_KEY,
  type FrameInfo,
  type SceneContext,
  type SystemRegistration,
} from '../core/sceneContext';
import { getEraDescriptor } from '../era/eraDescriptors';
import type { TimelineRuntime } from '../era/timelineRuntime';
import type { NavigationRig } from '../navigation/navigationRig';
import {
  HUD_GLOBAL_KEY,
  TIMELINE_GLOBAL_KEY,
  discoverSceneContext,
  discoverTimelineRuntime,
  getHudApi,
  type HudApi,
} from '../ui/hudApi';
import {
  DEFAULT_HANDOFF_MS,
  HandoffBlend,
  IntroTour,
  cameraPose,
  handoffDurationForDistance,
  poseDistance,
  tourDriftPose,
  vec3,
  type CameraPose,
  type IntroPhase,
  type IntroTourOptions,
  type TourDriftOptions,
} from './introTour';
import {
  ONBOARDING_ATTRIBUTE,
  createOnboardingHints,
  type OnboardingDismissReason,
  type OnboardingHints,
  type OnboardingHintsOptions,
  type OnboardingSnapshot,
} from './onboardingHints';

export const TOUR_API_VERSION = 1;

/** Global key the live tour is published on for overlays and harnesses. */
export const TOUR_GLOBAL_KEY = '__chronoCityTour';

/** Tick-registry id the tour camera registers under. */
export const TOUR_SYSTEM_ID = 'chrono-tour';

/**
 * The tour runs *after* the navigation rig (`-100`) so its cinematic pose wins
 * the frame, and before the HUD (`100`) so captions describe what was drawn.
 */
export const TOUR_SYSTEM_ORDER = -50;

/** Descendants of an element carrying this attribute never cancel a tour. */
export const TOUR_IGNORE_ATTRIBUTE = 'data-chrono-tour-ignore';

/** Stable id of the persistent caption toast the tour owns. */
export const TOUR_CAPTION_TOAST_ID = 'chrono-tour-caption';

/** How long each era stop is held before the tour steps on. */
export const DEFAULT_TOUR_DWELL_MS = 3600;

/** Era tween length the tour asks the timeline for at each stop. */
export const DEFAULT_TOUR_TRANSITION_MS = 1200;

/** The five authored stops, in chronological order. */
export const DEFAULT_TOUR_STOPS: readonly EraId[] = Object.freeze([...ERA_IDS]);

/** Physical key that starts/stops the auto time-tour. */
export const TOUR_HOTKEY_CODE = 'KeyT';

/** Shortest dwell we will honour, so a bad option cannot spin the schedule. */
const MIN_TOUR_DWELL_MS = 250;

/** Framing used when the tour has neither a rig nor a camera to lean on. */
const FALLBACK_POSE: CameraPose = cameraPose(vec3(0, 56, 82), vec3(0, 6, 0));

/* ------------------------------------------------------------------------- *
 * Public shapes
 * ------------------------------------------------------------------------- */

/** What the tour is doing: nothing, the intro, or the era showcase. */
export type TourState = 'idle' | 'intro' | 'tour';

/** Who is writing the camera this frame. */
export type TourCameraOwner = 'none' | 'intro' | 'tour' | 'handoff';

/** Why a running tour ended. */
export type TourStopReason = 'user-input' | 'complete' | 'api' | 'restart' | 'disposed';

/** Counters the tour keeps so browser harnesses and tests can see what happened. */
export interface TourCounters {
  readonly introStarts: number;
  readonly introCompletions: number;
  readonly introCancels: number;
  readonly handoffs: number;
  readonly tourStarts: number;
  readonly tourStops: number;
  readonly eraStops: number;
  /** Whooshes the tour voiced itself. */
  readonly whooshes: number;
  /** Era seams the timeline voiced because the director is one of its blendables. */
  readonly timelineWhooshes: number;
  readonly captions: number;
  /** User gestures observed while the tour was running (each one cancels). */
  readonly userInputs: number;
}

/** The tour's own mutable counter store; the snapshot publishes it read-only. */
type MutableTourCounters = { -readonly [Key in keyof TourCounters]: number };

/** Flat, serialisable view of the tour for tests and browser harnesses. */
export interface TourSnapshot {
  readonly version: number;
  readonly state: TourState;
  readonly running: boolean;
  readonly cameraOwner: TourCameraOwner;
  readonly introPhase: IntroPhase;
  readonly introActive: boolean;
  readonly introProgress: number;
  /** Id of the intro beat currently playing, or `null` before the first frame. */
  readonly introKeyframe: string | null;
  /** The timeline's era, i.e. the year the scene is really showing. */
  readonly era: EraId | null;
  readonly year: number | null;
  readonly stops: readonly EraId[];
  readonly stopIndex: number;
  readonly stopCount: number;
  readonly tourElapsedMs: number;
  readonly caption: string | null;
  readonly captionEra: EraId | null;
  readonly lastStopReason: TourStopReason | null;
  readonly lastOnboardingDismissReason: OnboardingDismissReason | null;
  readonly onboarding: OnboardingSnapshot | null;
  readonly warnings: readonly string[];
  readonly counters: TourCounters;
}

/** The collaborators the tour drives; every one of them is optional. */
export interface TourConnections {
  readonly context?: SceneContext | null;
  readonly timeline?: TimelineRuntime | null;
  readonly rig?: NavigationRig | null;
  readonly hud?: HudApi | null;
  readonly audio?: AudioDirector | null;
}

/** Options for starting the intro flythrough. */
export interface TourStartOptions {
  /** Jump straight to the last beat and glide home instead of flying. */
  readonly skip?: boolean;
  /** Restart the flythrough even when one is already in the air. */
  readonly restart?: boolean;
}

/** Options for one run of the auto time-tour. */
export interface TimeTourOptions {
  /** Stop list; defaults to the five authored eras. */
  readonly stops?: readonly EraId[];
  /** Hold per stop, in milliseconds. */
  readonly dwellMs?: number;
  /** Era tween length per stop, in milliseconds (`0` snaps). */
  readonly transitionMs?: number;
  /** Fly the slow crane while the eras change. Defaults to `true`. */
  readonly camera?: boolean;
  /** Show an era caption per stop. Defaults to `true`. */
  readonly captions?: boolean;
  /** Voice an era whoosh per stop. Defaults to `true`. */
  readonly whoosh?: boolean;
  /** Restart from the first stop after the last one. Defaults to `false`. */
  readonly loop?: boolean;
  /** Stop to begin on. Defaults to `0`. */
  readonly startIndex?: number;
  /** Snap the first stop instead of tweening into it. Defaults to `false`. */
  readonly instant?: boolean;
}

export interface TourApiOptions {
  /** Scene to join. Supplying one registers the per-frame tick. */
  readonly context?: SceneContext | null;
  /** Authoritative year store. The tour only ever moves the year through it. */
  readonly timeline?: TimelineRuntime | null;
  /** The rig the camera is handed back to. */
  readonly rig?: NavigationRig | null;
  /** HUD the captions are rendered through. */
  readonly hud?: HudApi | null;
  /** Audio director the era whooshes are played through. */
  readonly audio?: AudioDirector | null;
  /** Element the onboarding card mounts into. Defaults to the overlay root. */
  readonly overlayRoot?: HTMLElement | null;
  readonly document?: Document | null;
  /** Intro choreography options (path, timings). */
  readonly intro?: IntroTourOptions | null;
  readonly introDurationMs?: number;
  readonly introBlendInMs?: number;
  /** Hand-off glide length in milliseconds. Defaults to `DEFAULT_HANDOFF_MS`. */
  readonly handoffMs?: number;
  /** Slow-crane options for the time-tour camera. */
  readonly drift?: TourDriftOptions | null;
  readonly tourStops?: readonly EraId[];
  readonly tourDwellMs?: number;
  readonly tourTransitionMs?: number;
  readonly tourCamera?: boolean;
  readonly tourCaptions?: boolean;
  readonly tourWhoosh?: boolean;
  readonly tourLoop?: boolean;
  /** Start the time-tour as soon as the intro lands. Defaults to `false`. */
  readonly autoStartTimeTour?: boolean;
  /** Onboarding card options; `null` disables the card entirely. */
  readonly onboarding?: OnboardingHintsOptions | null;
  /** Show the first-run card when the visitor has not seen it. Defaults to `true`. */
  readonly autoShowOnboarding?: boolean;
  /** Any user input cancels a running tour. Defaults to `true`. */
  readonly cancelOnInput?: boolean;
  /** `T` toggles the auto time-tour. Defaults to `true`. */
  readonly hotkeys?: boolean;
  readonly autoRegister?: boolean;
  readonly systemId?: string;
  readonly order?: number;
  /** Publish the tour on `window.__chronoCityTour`. Defaults to `true` in a DOM. */
  readonly integrateGlobal?: boolean;
  readonly globalKey?: string;
  /** Called after every frame that changed the tour's state. */
  readonly onStateChange?: (snapshot: TourSnapshot, api: TourApi) => void;
  readonly onIntroComplete?: (api: TourApi) => void;
  readonly onEraStop?: (era: EraId, index: number, api: TourApi) => void;
  readonly onCaption?: (caption: string, era: EraId, api: TourApi) => void;
  readonly onStop?: (reason: TourStopReason, api: TourApi) => void;
}

interface TimeTourRun {
  readonly stops: readonly EraId[];
  index: number;
  readonly dwellMs: number;
  readonly transitionMs: number;
  readonly camera: boolean;
  readonly captions: boolean;
  readonly whoosh: boolean;
  readonly loop: boolean;
  readonly basePose: CameraPose;
  /** Milliseconds of crane time since the last hand-off landed. */
  elapsedMs: number;
  /** Milliseconds spent on the current stop. */
  stopElapsedMs: number;
}

/* ------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------- */

/** Lifts a camera pose out of a live Three.js camera (used when there is no rig). */
function poseFromCamera(camera: THREE.PerspectiveCamera): CameraPose {
  const position = vec3(camera.position.x, camera.position.y, camera.position.z);
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const lookAhead = 60;
  return cameraPose(
    position,
    vec3(
      position.x + direction.x * lookAhead,
      position.y + direction.y * lookAhead,
      position.z + direction.z * lookAhead,
    ),
    camera.fov,
  );
}

function positive(value: number | undefined, fallback: number, minimum: number): number {
  const resolved = value !== undefined && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, resolved);
}

function integerInRange(value: number | undefined, fallback: number, max: number): number {
  const resolved = value !== undefined && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(0, resolved));
}

/* ------------------------------------------------------------------------- *
 * TourApi
 * ------------------------------------------------------------------------- */

/**
 * The tour layer. One instance owns the intro, the era showcase, the camera
 * hand-offs, the captions and the first-run hints for the whole application.
 */
export class TourApi {
  readonly version = TOUR_API_VERSION;

  /** Tick-registry id this tour registers under. */
  readonly systemId: string;
  /** Tick-registry order this tour registers with. */
  readonly order: number;

  private readonly options: TourApiOptions;
  private readonly documentRef: Document | null;
  private readonly introTour: IntroTour;
  private readonly handoffMs: number;
  private readonly driftOptions: TourDriftOptions;
  private readonly cancelOnInput: boolean;
  private readonly hotkeys: boolean;
  private readonly autoRegister: boolean;
  private readonly autoShowOnboarding: boolean;
  private readonly autoStartTimeTour: boolean;

  private contextValue: SceneContext | null;
  private timelineValue: TimelineRuntime | null;
  private rigValue: NavigationRig | null;
  private hudValue: HudApi | null;
  private audioValue: AudioDirector | null;

  private readonly onboardingHints: OnboardingHints | null;
  private settle: HandoffBlend | null = null;
  private tourRun: TimeTourRun | null = null;
  private registration: SystemRegistration | null = null;
  private unsubscribeTimeline: (() => void) | null = null;

  private stateValue: TourState = 'idle';
  private introKeyframeId: string | null = null;
  private introCompletionReported = false;
  private introCancelled = false;
  private anchorPose: CameraPose | null = null;
  private lastAppliedPose: CameraPose | null = null;
  private savedFov: number | null = null;
  private captionValue: string | null = null;
  private captionEraValue: EraId | null = null;
  private lastStopReason: TourStopReason | null = null;
  private lastDismissReason: OnboardingDismissReason | null = null;
  private readonly warnings = new Set<string>();
  private inputAttached = false;
  private disposedState = false;
  private lastPublishedSignature = '';
  private counters: MutableTourCounters = {
    introStarts: 0,
    introCompletions: 0,
    introCancels: 0,
    handoffs: 0,
    tourStarts: 0,
    tourStops: 0,
    eraStops: 0,
    whooshes: 0,
    timelineWhooshes: 0,
    captions: 0,
    userInputs: 0,
  };

  constructor(options: TourApiOptions = {}) {
    this.options = options;
    this.documentRef = options.document ?? (typeof document === 'undefined' ? null : document);
    this.systemId = options.systemId ?? TOUR_SYSTEM_ID;
    this.order = options.order ?? TOUR_SYSTEM_ORDER;
    this.handoffMs = positive(options.handoffMs, DEFAULT_HANDOFF_MS, 0);
    this.driftOptions = options.drift ?? {};
    this.cancelOnInput = options.cancelOnInput ?? true;
    this.hotkeys = options.hotkeys ?? true;
    this.autoRegister = options.autoRegister ?? true;
    this.autoShowOnboarding = options.autoShowOnboarding ?? true;
    this.autoStartTimeTour = options.autoStartTimeTour ?? false;

    this.introTour = new IntroTour({
      durationMs: options.introDurationMs,
      blendInMs: options.introBlendInMs,
      handoffMs: this.handoffMs,
      ...(options.intro ?? undefined),
    });

    this.contextValue = options.context ?? null;
    this.timelineValue = null;
    this.rigValue = options.rig ?? null;
    this.hudValue = options.hud ?? null;
    this.audioValue = options.audio ?? null;
    if (options.timeline !== undefined) this.useTimeline(options.timeline);

    this.onboardingHints = this.buildOnboarding(options);

    if (this.contextValue && this.autoRegister) this.registerSystem();
    if (this.cancelOnInput || this.hotkeys) this.attachInput();
    if (this.autoShowOnboarding && this.onboardingHints?.shouldShow()) this.onboardingHints.show();

    if (options.integrateGlobal ?? (typeof window !== 'undefined')) {
      integrateTourGlobal(this, options.globalKey ?? TOUR_GLOBAL_KEY);
    }
  }

  /* ---------------- state ---------------- */

  get state(): TourState {
    return this.stateValue;
  }

  /** `true` while the tour is flying, showcasing or gliding the camera home. */
  get isRunning(): boolean {
    return this.stateValue !== 'idle' || this.introTour.isRunning || this.settle !== null;
  }

  get cameraOwner(): TourCameraOwner {
    if (this.introTour.isRunning) return 'intro';
    if (this.settle) return 'handoff';
    if (this.stateValue === 'tour' && this.tourRun?.camera) return 'tour';
    return 'none';
  }

  /** The intro flythrough state machine (path, phases, progress). */
  get intro(): IntroTour {
    return this.introTour;
  }

  /** The first-run card, or `null` when onboarding was disabled. */
  get onboarding(): OnboardingHints | null {
    return this.onboardingHints;
  }

  /** The authoritative year store, if one is connected. */
  get timeline(): TimelineRuntime | null {
    return this.timelineValue;
  }

  /** The rig the camera is handed back to, if one is connected. */
  get navigationRig(): NavigationRig | null {
    return this.rigValue;
  }

  get hud(): HudApi | null {
    return this.hudValue;
  }

  get audio(): AudioDirector | null {
    return this.audioValue;
  }

  get context(): SceneContext | null {
    return this.contextValue;
  }

  /** Caption currently on screen, or `null`. */
  get caption(): string | null {
    return this.captionValue;
  }

  get isAttached(): boolean {
    return this.registration !== null;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /* ---------------- wiring ---------------- */

  /**
   * Attaches or replaces collaborators. Safe to call at any time: nothing is
   * read until a tour actually runs, so the HUD, the audio director and the rig
   * may all arrive after the tour was created.
   */
  connect(connections: TourConnections): this {
    if (connections.context !== undefined) {
      this.contextValue = connections.context;
      if (connections.context && this.autoRegister) this.registerSystem();
    }
    if (connections.timeline !== undefined) this.useTimeline(connections.timeline);
    if (connections.rig !== undefined) this.rigValue = connections.rig;
    if (connections.hud !== undefined) this.hudValue = connections.hud;
    if (connections.audio !== undefined) this.audioValue = connections.audio;
    return this;
  }

  /** Joins a scene: registers the per-frame tick that drives the tour. */
  attach(context: SceneContext): this {
    this.contextValue = context;
    this.registerSystem();
    return this;
  }

  /** Leaves the scene tick; tour state and the onboarding card stay intact. */
  detach(): void {
    this.registration?.dispose();
    this.registration = null;
    this.publishState();
  }

  /* ---------------- intro ---------------- */

  /** Starts the intro flythrough (the `create` half of the tour lifecycle). */
  start(options: TourStartOptions = {}): TourSnapshot {
    return this.startIntro(options);
  }

  /**
   * Plays the cinematic flythrough, ending on the pose the navigation rig will
   * resume from. Starting a tour always yields to the newest request: a running
   * era showcase is closed first.
   */
  startIntro(options: TourStartOptions = {}): TourSnapshot {
    this.assertUsable();
    if (this.stateValue === 'tour') this.endTimeTour();

    if (this.introTour.isRunning && !(options.restart ?? false)) {
      if (options.skip ?? false) this.introTour.skipToEnd();
      this.stateValue = 'intro';
      this.registerSystem();
      this.publishState();
      return this.snapshot();
    }

    this.settle?.cancel();
    this.settle = null;
    this.anchorPose = this.livePose();
    this.stateValue = 'intro';
    this.introCompletionReported = false;
    this.introCancelled = false;
    this.introKeyframeId = null;
    this.introTour.start(this.anchorPose);
    this.counters.introStarts += 1;
    if (options.skip ?? false) this.introTour.skipToEnd();
    if (this.autoShowOnboarding && this.onboardingHints?.shouldShow()) this.onboardingHints.show();
    this.registerSystem();
    this.publishState();
    return this.snapshot();
  }

  /** Jumps to the last beat of the intro and glides the camera home. */
  skipIntro(): TourSnapshot {
    if (!this.introTour.isRunning) return this.snapshot();
    this.introTour.skipToEnd();
    this.publishState();
    return this.snapshot();
  }

  /* ---------------- time tour ---------------- */

  /**
   * Starts the automatic era showcase: `1945 → 1965 → 1985 → 2005 → 2025`, one
   * caption and one whoosh per stop, each year change routed through
   * `TimelineRuntime` so the whole block transforms together.
   */
  startTimeTour(options: TimeTourOptions = {}): TourSnapshot {
    this.assertUsable();
    const stops = this.resolveStops(options.stops);
    if (stops.length === 0) {
      throw new RangeError('startTimeTour() needs at least one era stop.');
    }

    const basePose = this.livePose();
    const from = this.cameraOwner === 'none' ? null : this.lastAppliedPose;

    this.introTour.reset();
    this.introKeyframeId = null;
    this.introCancelled = false;
    this.settle?.cancel();
    this.settle = null;
    this.anchorPose = basePose;

    const run: TimeTourRun = {
      stops,
      index: 0,
      dwellMs: positive(options.dwellMs, this.options.tourDwellMs ?? DEFAULT_TOUR_DWELL_MS, MIN_TOUR_DWELL_MS),
      transitionMs: positive(
        options.transitionMs,
        this.options.tourTransitionMs ?? DEFAULT_TOUR_TRANSITION_MS,
        0,
      ),
      camera: options.camera ?? this.options.tourCamera ?? true,
      captions: options.captions ?? this.options.tourCaptions ?? true,
      whoosh: options.whoosh ?? this.options.tourWhoosh ?? true,
      loop: options.loop ?? this.options.tourLoop ?? false,
      basePose,
      elapsedMs: 0,
      stopElapsedMs: 0,
    };
    run.index = integerInRange(options.startIndex, 0, stops.length - 1);
    this.tourRun = run;
    this.stateValue = 'tour';

    if (from) {
      this.beginHandoff(from, basePose);
    }

    this.counters.tourStarts += 1;
    this.enterStop(run, run.index, { instant: options.instant === true });
    this.registerSystem();
    this.publishState();
    return this.snapshot();
  }

  /** Starts the showcase, or stops it when one is already running. */
  toggleTimeTour(options: TimeTourOptions = {}): TourSnapshot {
    if (this.stateValue === 'tour') return this.stop('api');
    return this.startTimeTour(options);
  }

  /* ---------------- stopping ---------------- */

  /**
   * Ends whatever is running. The camera is never dropped mid-frame: an intro
   * glides back to the rig through its own hand-off, and the showcase camera
   * glides back through a `HandoffBlend`, both landing exactly on the rig's
   * live pose.
   */
  stop(reason: TourStopReason = 'api'): TourSnapshot {
    if (this.disposedState) return this.snapshot();
    const wasRunning = this.isRunning;
    this.lastStopReason = reason;

    if (this.stateValue === 'tour') this.endTimeTour();
    else if (this.introTour.isRunning || this.stateValue === 'intro') this.endIntro(reason);

    if (wasRunning) {
      this.clearCaption();
      try {
        this.options.onStop?.(reason, this);
      } catch (error) {
        console.warn('[chrono-city] tour: stop callback failed', error);
      }
    }
    this.publishState();
    return this.snapshot();
  }

  /** Alias of `stop()` with "the user touched something" semantics. */
  cancel(reason: TourStopReason = 'user-input'): TourSnapshot {
    return this.stop(reason);
  }

  /* ---------------- captions ---------------- */

  /**
   * Renders the era caption through the HUD and remembers it, so the caption and
   * the visible year can never disagree. Returns the caption text.
   */
  syncCaption(era?: EraId | number | string): string {
    const resolved = this.resolveEra(era);
    const descriptor = getEraDescriptor(resolved);
    const caption = `${descriptor.year} — ${descriptor.label} · ${descriptor.description}`;
    this.captionValue = caption;
    this.captionEraValue = resolved;

    const hud = this.hudValue;
    const captions = this.tourRun?.captions ?? true;
    if (hud && captions) {
      const stops = this.tourRun?.stops ?? DEFAULT_TOUR_STOPS;
      const index = stops.indexOf(resolved);
      try {
        hud.toast(caption, {
          id: TOUR_CAPTION_TOAST_ID,
          tone: 'era',
          title: index >= 0 ? `Stop ${index + 1} of ${stops.length}` : 'Era',
          era: resolved,
          durationMs: 0,
          sound: null,
        });
        this.counters.captions += 1;
      } catch (error) {
        console.warn('[chrono-city] tour: caption failed', error);
      }
    }

    try {
      this.options.onCaption?.(caption, resolved, this);
    } catch (error) {
      console.warn('[chrono-city] tour: caption callback failed', error);
    }
    return caption;
  }

  /** Removes the tour's caption toast and forgets it. */
  clearCaption(): void {
    this.captionValue = null;
    this.captionEraValue = null;
    try {
      this.hudValue?.dismissToast(TOUR_CAPTION_TOAST_ID);
    } catch (error) {
      console.warn('[chrono-city] tour: caption dismiss failed', error);
    }
  }

  /* ---------------- onboarding ---------------- */

  /** Shows the first-run control hints (once per visitor by default). */
  showOnboarding(): boolean {
    return this.onboardingHints?.show() ?? false;
  }

  /** Hides the hints and persists the dismissal. */
  dismissOnboarding(reason: OnboardingDismissReason = 'programmatic'): boolean {
    this.lastDismissReason = reason;
    return this.onboardingHints?.dismiss(reason) ?? false;
  }

  /** Forgets the persisted flag, so the hints can appear again. */
  resetOnboarding(): void {
    this.onboardingHints?.reset();
    this.lastDismissReason = null;
  }

  /* ---------------- per-frame integration ---------------- */

  /**
   * Advances the tour by `deltaMs`. Called once per frame by the registered
   * `SceneContext` system; safe to call directly from tests.
   */
  advance(deltaMs: number): void {
    if (this.disposedState) return;
    const step = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
    const live = this.livePose();

    // 1. The intro owns the camera while it flies, and while it glides home.
    if (this.introTour.isRunning) {
      const sample = this.introTour.advance(step, live);
      this.introKeyframeId = sample.keyframe.id;
      if (sample.ownsCamera) this.applyPose(sample.pose);
      if (sample.finished && !this.introCompletionReported) {
        this.introCompletionReported = true;
        this.completeIntro();
      }
      this.publishState();
      return;
    }

    // 2. A glide home left over from a stopped showcase.
    let gliding = false;
    if (this.settle) {
      const result = this.settle.advance(step, live);
      this.applyPose(result.pose);
      if (result.done) {
        this.settle = null;
        if (this.stateValue !== 'tour') this.anchorPose = null;
        // Restart the crane from the base frame, so the sway begins seamlessly.
        if (this.tourRun) this.tourRun.elapsedMs = 0;
      } else {
        gliding = true;
      }
    }

    // 3. The era showcase: crane, dwell, then one stop further.
    const run = this.tourRun;
    if (this.stateValue === 'tour' && run) {
      if (!gliding) {
        run.elapsedMs += step;
        if (run.camera) this.applyPose(tourDriftPose(run.elapsedMs, run.basePose, this.driftOptions));
      }
      run.stopElapsedMs += step;
      while (this.stateValue === 'tour' && run.stopElapsedMs >= run.dwellMs) {
        run.stopElapsedMs -= run.dwellMs;
        const next = run.index + 1;
        if (next < run.stops.length) this.enterStop(run, next);
        else if (run.loop) this.enterStop(run, 0);
        else {
          this.stop('complete');
          break;
        }
      }
    }

    if (!this.settle && this.stateValue !== 'tour') this.releaseFov();
    this.publishState();
  }

  /* ---------------- diagnostics ---------------- */

  /** Flat view of the tour for tests, overlays and browser harnesses. */
  snapshot(): TourSnapshot {
    const timeline = this.timelineValue;
    const run = this.tourRun;
    const era = timeline?.era ?? null;
    return {
      version: TOUR_API_VERSION,
      state: this.stateValue,
      running: this.isRunning,
      cameraOwner: this.cameraOwner,
      introPhase: this.introTour.phase,
      introActive: this.introTour.isRunning,
      introProgress: this.introTour.progress,
      introKeyframe: this.introKeyframeId,
      era,
      year: era === null ? null : eraYear(era),
      stops: run?.stops ?? this.options.tourStops ?? DEFAULT_TOUR_STOPS,
      stopIndex: run ? run.index : -1,
      stopCount: run ? run.stops.length : 0,
      tourElapsedMs: run?.elapsedMs ?? 0,
      caption: this.captionValue,
      captionEra: this.captionEraValue,
      lastStopReason: this.lastStopReason,
      lastOnboardingDismissReason: this.lastDismissReason,
      onboarding: this.onboardingHints?.snapshot() ?? null,
      warnings: [...this.warnings],
      counters: { ...this.counters },
    };
  }

  /** Leaves the scene and releases everything the tour installed. */
  dispose(): void {
    if (this.disposedState) return;
    this.detachedInput();
    this.introTour.reset();
    this.settle?.cancel();
    this.settle = null;
    this.tourRun = null;
    this.stateValue = 'idle';
    this.lastStopReason = 'disposed';
    this.clearCaption();
    this.detachTimeline();
    this.registration?.dispose();
    this.registration = null;
    this.onboardingHints?.dispose();
    this.releaseFov();
    this.anchorPose = null;
    detachTourGlobal(this.options.globalKey ?? TOUR_GLOBAL_KEY, this);
    this.disposedState = true;
  }

  /* ---------------- internals: wiring ---------------- */

  private buildOnboarding(options: TourApiOptions): OnboardingHints | null {
    if (options.onboarding === null) return null;
    const provided = options.onboarding ?? {};
    const providedOnShow = provided.onShow;
    const providedOnDismiss = provided.onDismiss;
    try {
      return createOnboardingHints({
        ...provided,
        root: provided.root ?? options.overlayRoot ?? options.context?.overlayRoot ?? null,
        document: provided.document ?? this.documentRef ?? undefined,
        autoShow: false,
        onShow: () => {
          providedOnShow?.();
        },
        onDismiss: (reason) => {
          this.lastDismissReason = reason;
          providedOnDismiss?.(reason);
        },
      });
    } catch (error) {
      // Onboarding is additive: a host without a DOM must still get a tour.
      console.warn('[chrono-city] tour: onboarding card unavailable', error);
      return null;
    }
  }

  private useTimeline(timeline: TimelineRuntime | null): void {
    if (this.timelineValue === timeline) return;
    this.detachTimeline();
    this.timelineValue = timeline;
    if (!timeline) return;
    this.unsubscribeTimeline = timeline.subscribe((era) => this.handleTimelineSelection(era));
  }

  private detachTimeline(): void {
    this.unsubscribeTimeline?.();
    this.unsubscribeTimeline = null;
  }

  private registerSystem(): void {
    if (this.registration || this.disposedState || !this.contextValue || !this.autoRegister) return;
    this.registration = this.contextValue.registerSystem(this.systemId, this.handleTick, {
      order: this.order,
    });
  }

  private attachInput(): void {
    const doc = this.documentRef;
    if (!doc || this.inputAttached) return;
    this.inputAttached = true;
    doc.addEventListener('pointerdown', this.handleUserInput, { capture: true, passive: true });
    doc.addEventListener('touchstart', this.handleUserInput, { capture: true, passive: true });
    doc.addEventListener('wheel', this.handleUserInput, { capture: true, passive: true });
    doc.addEventListener('keydown', this.handleKeyDown, true);
  }

  private detachedInput(): void {
    const doc = this.documentRef;
    if (!doc || !this.inputAttached) return;
    this.inputAttached = false;
    doc.removeEventListener('pointerdown', this.handleUserInput, true);
    doc.removeEventListener('touchstart', this.handleUserInput, true);
    doc.removeEventListener('wheel', this.handleUserInput, true);
    doc.removeEventListener('keydown', this.handleKeyDown, true);
  }

  private assertUsable(): void {
    if (this.disposedState) throw new Error('TourApi has been disposed.');
  }

  /* ---------------- internals: schedule ---------------- */

  private resolveStops(stops?: readonly EraId[]): readonly EraId[] {
    const requested = stops ?? this.options.tourStops ?? DEFAULT_TOUR_STOPS;
    const resolved = requested.filter((era) => isEraId(era));
    return resolved.length > 0 ? Object.freeze([...resolved]) : DEFAULT_TOUR_STOPS;
  }

  private resolveEra(value?: EraId | number | string): EraId {
    if (value === undefined) return this.timelineValue?.era ?? this.captionEraValue ?? ERA_IDS[0];
    if (isEraId(value)) return value;
    const year = typeof value === 'number' ? value : Number.parseFloat(value);
    if (!Number.isFinite(year)) return this.timelineValue?.era ?? ERA_IDS[0];
    let best: EraId = ERA_IDS[0];
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const era of ERA_IDS) {
      const delta = Math.abs(eraYear(era) - year);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = era;
      }
    }
    return best;
  }

  /** Moves the year — the only way the tour is allowed to change the scene. */
  private selectEraThroughTimeline(era: EraId, durationMs: number): void {
    const timeline = this.timelineValue;
    if (!timeline) {
      if (!this.warnings.has('timeline-missing')) {
        this.warnings.add('timeline-missing');
        console.warn(
          '[chrono-city] tour: no TimelineRuntime connected — era stops cannot transform the scene.',
        );
      }
      return;
    }
    timeline.selectEra(era, { durationMs });
  }

  private enterStop(run: TimeTourRun, index: number, options: { instant?: boolean } = {}): void {
    const era = run.stops[index];
    if (!era) return;
    run.index = index;
    run.stopElapsedMs = 0;
    this.selectEraThroughTimeline(era, options.instant === true ? 0 : run.transitionMs);
    this.counters.eraStops += 1;
    this.syncCaption(era);
    this.playStepCue(era, index, run.whoosh);
    try {
      this.options.onEraStop?.(era, index, this);
    } catch (error) {
      console.warn('[chrono-city] tour: era stop callback failed', error);
    }
  }

  /**
   * Voices one era step. When the audio director is one of the timeline's own
   * blendables, `TimelineRuntime` has already played the seam inside `setEra()`;
   * adding ours on top would double the whoosh, so we stand down and record it.
   */
  private playStepCue(era: EraId, index: number, enabled: boolean): void {
    if (!enabled) return;
    const audio = this.audioValue;
    if (!audio || audio.isDisposed) return;
    if (audio.eraTransitionActive && audio.eraTarget === era) {
      this.counters.timelineWhooshes += 1;
      return;
    }
    try {
      const handle = audio.play(ERA_WHOOSH_CUE, {
        era,
        gain: 0.9,
        rate: 0.94 + Math.min(4, index) * 0.03,
      });
      if (handle) this.counters.whooshes += 1;
    } catch (error) {
      console.warn('[chrono-city] tour: era cue failed', error);
    }
  }

  /* ---------------- internals: stopping ---------------- */

  private endIntro(reason: TourStopReason): void {
    this.stateValue = 'idle';
    // Whatever phase the intro was in, the visitor asked to take over: the
    // landing must not be reported as a completed flythrough.
    this.introCancelled = true;
    if (this.introTour.phase === 'flying') {
      this.counters.introCancels += 1;
      this.introTour.cancel();
    }
    // While a glide is still running the field of view stays blended; it is
    // restored the moment the camera is handed over.
    if (!this.introTour.isRunning && reason !== 'restart') this.releaseFov();
  }

  private endTimeTour(): void {
    const run = this.tourRun;
    this.stateValue = 'idle';
    this.tourRun = null;
    this.counters.tourStops += 1;
    const from = run && run.camera ? this.lastAppliedPose : null;
    if (from) this.beginHandoff(from, this.livePose());
    else this.releaseFov();
  }

  /** Glides the camera back onto `target` from wherever the tour left it. */
  private beginHandoff(from: CameraPose, target: CameraPose): void {
    this.settle?.cancel();
    const glide = new HandoffBlend(this.handoffMs);
    glide.begin(
      from,
      handoffDurationForDistance(poseDistance(from, target), { baseMs: this.handoffMs }),
    );
    this.settle = glide;
    this.counters.handoffs += 1;
  }

  private completeIntro(): void {
    if (this.stateValue === 'intro') this.stateValue = 'idle';
    // A hand-off landed either way; only an undisturbed flythrough counts as a
    // completion and may chain into the optional auto time-tour.
    this.counters.handoffs += 1;
    const cancelled = this.introCancelled;
    this.introCancelled = false;
    this.anchorPose = null;
    this.releaseFov();
    this.publishState();
    if (cancelled) return;

    this.counters.introCompletions += 1;
    try {
      this.options.onIntroComplete?.(this);
    } catch (error) {
      console.warn('[chrono-city] tour: intro callback failed', error);
    }
    if (this.autoStartTimeTour) this.startTimeTour();
  }

  /* ---------------- internals: camera ---------------- */

  /** Where the user's navigation would put the camera right now. */
  private livePose(): CameraPose {
    const rig = this.rigValue;
    if (rig) {
      const state = rig.state;
      return cameraPose(
        vec3(state.position.x, state.position.y, state.position.z),
        vec3(state.target.x, state.target.y, state.target.z),
      );
    }
    if (this.anchorPose) return this.anchorPose;
    const camera = this.contextValue?.camera;
    return camera ? poseFromCamera(camera) : FALLBACK_POSE;
  }

  /** Writes one tour pose to the shared camera and remembers it. */
  private applyPose(pose: CameraPose): void {
    this.lastAppliedPose = pose;
    const camera = this.contextValue?.camera;
    if (!camera) return;
    camera.up.set(0, 1, 0);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    if (pose.fov !== undefined && Math.abs(camera.fov - pose.fov) > 1e-3) {
      if (this.savedFov === null) this.savedFov = camera.fov;
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  /** Restores the camera's own field of view once the tour lets go of it. */
  private releaseFov(): void {
    const camera = this.contextValue?.camera;
    if (!camera || this.savedFov === null) return;
    const restore = this.savedFov;
    this.savedFov = null;
    if (Math.abs(camera.fov - restore) > 1e-3) {
      camera.fov = restore;
      camera.updateProjectionMatrix();
    }
  }

  /* ---------------- internals: reactions ---------------- */

  private handleTimelineSelection(era: EraId): void {
    const run = this.tourRun;
    if (this.stateValue === 'tour' && run) {
      // The tour's own steps set `run.index` first, so this only fires when
      // somebody else moved the year: mirror it instead of drifting out of sync.
      if (run.stops[run.index] === era) return;
      const index = run.stops.indexOf(era);
      if (index >= 0) {
        run.index = index;
        run.stopElapsedMs = 0;
        this.syncCaption(era);
        this.counters.eraStops += 1;
      } else {
        this.clearCaption();
      }
      return;
    }
    if (this.captionValue) this.clearCaption();
  }

  private readonly handleTick = (_context: SceneContext, frame: FrameInfo): void => {
    this.advance(frame.delta * 1000);
  };

  private readonly handleUserInput = (event: Event): void => {
    if (!this.cancelOnInput || this.disposedState) return;
    if (this.isIgnoredTarget(event.target)) return;
    this.counters.userInputs += 1;
    if (this.onboardingHints?.isVisible) this.onboardingHints.dismiss('input');
    if (this.introTour.isRunning || this.stateValue === 'tour') this.stop('user-input');
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.isIgnoredTarget(event.target)) return;
    if (this.hotkeys && (event.code === TOUR_HOTKEY_CODE || event.key === 't' || event.key === 'T')) {
      this.toggleTimeTour();
      return;
    }
    this.handleUserInput(event);
  };

  /**
   * Text fields, the onboarding card and anything marked
   * `data-chrono-tour-ignore` are never read as "the user wants the cinematic
   * to stop" — dismissing the hints is not a request to skip the tour.
   */
  private isIgnoredTarget(target: EventTarget | null): boolean {
    if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (typeof target.closest !== 'function') return false;
    if (target.closest(`[${ONBOARDING_ATTRIBUTE}="root"]`)) return true;
    return target.closest(`[${TOUR_IGNORE_ATTRIBUTE}]`) !== null;
  }

  private publishState(): void {
    const element = this.documentRef?.documentElement;
    if (element) {
      const signature = [
        this.stateValue,
        this.cameraOwner,
        this.tourRun?.index ?? -1,
        this.captionEraValue ?? '',
        this.introKeyframeId ?? '',
      ].join('|');
      if (signature !== this.lastPublishedSignature) {
        this.lastPublishedSignature = signature;
        element.dataset.chronoTour = this.stateValue;
        element.dataset.chronoTourCamera = this.cameraOwner;
        element.dataset.chronoTourStop = String(this.tourRun?.index ?? -1);
        if (this.captionEraValue) element.dataset.chronoTourEra = this.captionEraValue;
        else delete element.dataset.chronoTourEra;
      }
    }

    const callback = this.options.onStateChange;
    if (!callback) return;
    try {
      callback(this.snapshot(), this);
    } catch (error) {
      console.warn('[chrono-city] tour: state callback failed', error);
    }
  }
}

/* ------------------------------------------------------------------------- *
 * Application boot
 * ------------------------------------------------------------------------- */

/** Options for `bootTour()`: `TourApiOptions` plus global-handle discovery. */
export interface TourBootOptions extends TourApiOptions {
  /** Global key the scene app handle is published on. Defaults to `__chronoCity`. */
  readonly appKey?: string;
  /** Global key the audio director is published on. Defaults to `__chronoCityAudio`. */
  readonly audioKey?: string;
  /** Global key a shared timeline runtime is published on. */
  readonly timelineKey?: string;
  /** Global key the HUD is published on. Defaults to `__chronoCityHud`. */
  readonly hudKey?: string;
  /** Start the intro flythrough as soon as the tour is wired. Defaults to `true`. */
  readonly startIntro?: boolean;
}

/** Creates a tour (`create` half of the lifecycle). */
export function createTourApi(options: TourApiOptions = {}): TourApi {
  return new TourApi(options);
}

/** Publishes the live tour on `window` for overlays and browser harnesses. */
export function integrateTourGlobal(api: TourApi, key: string = TOUR_GLOBAL_KEY): TourApi {
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[key] = api;
  }
  return api;
}

/** Removes a published tour (only when the handle still points at it). */
export function detachTourGlobal(key: string = TOUR_GLOBAL_KEY, api?: TourApi): void {
  if (typeof window === 'undefined') return;
  const scope = window as unknown as Record<string, unknown>;
  if (api && scope[key] !== api) return;
  delete scope[key];
}

/** The published tour, or `null` before boot. */
export function getTourApi(key: string = TOUR_GLOBAL_KEY): TourApi | null {
  if (typeof window === 'undefined') return null;
  const value = (window as unknown as Record<string, unknown>)[key];
  return value instanceof TourApi ? value : null;
}

/**
 * Boots the tour against the live application: discovers the scene context, the
 * shared timeline, the HUD and the audio director, onboards the visitor on the
 * first run and starts the intro flythrough.
 *
 * The rig is not published globally, so the integration layer passes it in
 * (or later through `connect()`); without a rig the tour still flies and still
 * hands the camera back, it just glides onto its own captured frame. Booting
 * twice returns the already-running tour instead of a second one.
 */
export function bootTour(options: TourBootOptions = {}): TourApi | null {
  const key = options.globalKey ?? TOUR_GLOBAL_KEY;
  const existing = getTourApi(key);
  if (existing) return existing;
  try {
    const context = options.context ?? discoverSceneContext(options.appKey ?? CHRONO_CITY_GLOBAL_KEY);
    const timeline = options.timeline ?? discoverTimelineRuntime(options.timelineKey ?? TIMELINE_GLOBAL_KEY);
    const hud = options.hud ?? getHudApi(options.hudKey ?? HUD_GLOBAL_KEY);
    const audio = options.audio ?? getAudioDirector(options.audioKey ?? AUDIO_GLOBAL_KEY);
    const api = new TourApi({ ...options, context, timeline, hud, audio, globalKey: key });
    if (options.startIntro ?? true) api.startIntro();
    return api;
  } catch (error) {
    console.warn('[chrono-city] tour: boot failed', error);
    return null;
  }
}

declare global {
  interface Window {
    __chronoCityTour?: TourApi;
  }
}
