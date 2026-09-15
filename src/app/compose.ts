/**
 * Application composition root for the runnable café timelapse.
 *
 * This file deliberately contains orchestration rather than era content. The
 * period registry owns the ten domain registrations and all five era records;
 * the transition engine remains the only writer of period changes; the kernel
 * remains the only absolute camera writer; the audio engine remains locked
 * until the enter-café gesture.
 */

import * as THREE from 'three';
import {
  YEAR_IDS,
  DEFAULT_YEAR_ID,
  type YearId,
  type SceneModule,
} from '../contracts/period';
import { createKernel, createManualFrameScheduler, type Kernel, type ManualFrameScheduler } from '../core/kernel';
import { createNavigationController, type NavigationController } from '../core/navigation';
import {
  createHotspotRegistry,
  registerDefaultAnchors,
  type HotspotRegistry,
  type HotspotRecord,
} from '../core/hotspots';
import { createPeriodTransition, type PeriodTransition } from '../core/transition';
import { createAudioEngine, type AudioEngine } from '../audio';
import { eraMusicMix, musicProgram } from '../domains/music/MusicSourceModule';
import { createTimelineSlider, type TimelineSlider } from '../ui/timeline/TimelineSlider';
import {
  createInspectMode,
  createInspectOverlay,
  type InspectMode,
  type InspectOverlay,
} from '../ui/inspect/InspectOverlay';
import {
  createEraModules,
  resolvePeriod,
  type EraDefinition,
  type EraModuleInstance,
} from '../data/periodRegistry';
import {
  createHud,
  createEnterGate,
  HUD_CONTROL_HINTS,
  type EnterGate,
  type Hud,
  type HudHotspot,
  type RenderQuality,
} from './hud';

/* -------------------------------------------------------------------------- */
/* Public composition types                                                   */
/* -------------------------------------------------------------------------- */

/** Options shared by browser boots and deterministic headless composition tests. */
export interface CafeCompositionOptions {
  /** Mount point for the WebGL canvas and app chrome. `null` is headless. */
  readonly container?: HTMLElement | null;
  /** Start the browser loop immediately; tests can manually tick instead. */
  readonly autoStart?: boolean;
  /** Force SceneKernel to omit WebGL even if a test runner exposes a probe. */
  readonly forceHeadless?: boolean;
  /** Inject a deterministic scheduler; defaults to the browser scheduler. */
  readonly scheduler?: ManualFrameScheduler | undefined;
  /** Do not create DOM chrome (useful for node-only integration checks). */
  readonly ui?: boolean;
  /** Initial era; the timeline still remains the only subsequent selection control. */
  readonly initialYear?: YearId;
  /** Explicit reduced-motion state, otherwise `matchMedia` is consulted. */
  readonly reducedMotion?: boolean;
  /** Explicit starting quality; high is the production default. */
  readonly quality?: RenderQuality;
  /** Audio options, chiefly an injected fake context for headless tests. */
  readonly audioOptions?: ConstructorParameters<typeof AudioEngine>[0];
}

/** Useful runtime handles exposed for manual QA and composition tests. */
export interface CafeComposition {
  readonly kernel: Kernel;
  readonly modules: readonly EraModuleInstance[];
  readonly sceneModules: readonly SceneModule[];
  readonly registry: Readonly<Record<YearId, EraDefinition>>;
  readonly audio: AudioEngine;
  readonly navigation: NavigationController;
  readonly hotspots: HotspotRegistry;
  readonly transition: PeriodTransition;
  readonly slider: TimelineSlider | null;
  readonly hud: Hud | null;
  readonly enterGate: EnterGate | null;
  readonly inspectOverlay: InspectOverlay | null;
  readonly inspectMode: InspectMode | null;
  readonly scheduler: ManualFrameScheduler | null;
  readonly quality: RenderQuality;
  readonly reducedMotion: boolean;
  readonly disposed: boolean;
  readonly year: YearId;
  /** True after the enter-café gesture has unlocked audio. */
  readonly entered: boolean;
  /** Boot the scene's user-gesture audio gate (safe to call repeatedly). */
  enter(): Promise<void>;
  /** Select an era through the same path as the slider. */
  selectYear(year: YearId): void;
  /** Advance a headless composition one frame. */
  tick(deltaSeconds?: number): void;
  /** Switch renderer quality without changing the scene graph. */
  setQuality(quality: RenderQuality): void;
  /** Tear down every controller, listener, module, audio and renderer resource. */
  dispose(): void;
}

/** Browser debug handle, intentionally small but sufficient for manual QA. */
declare global {
  interface Window {
    cafeComposition?: CafeComposition;
    cafeKernel?: Kernel;
    cafeReinit?: () => void;
  }
}

/* -------------------------------------------------------------------------- */
/* Pure composition helpers                                                   */
/* -------------------------------------------------------------------------- */

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function periodFor(year: YearId): EraDefinition {
  return resolvePeriod(year);
}

function hotspotView(records: readonly HotspotRecord[]): readonly HudHotspot[] {
  return Object.freeze(
    records.map((record) => ({
      id: record.id,
      label: record.label,
      moduleId: record.moduleId,
    })),
  );
}

function buildMurmur(year: YearId) {
  const mix = eraMusicMix(year);
  return {
    id: `murmur-${year}`,
    year,
    label: `${year} café conversation`,
    murmur: {
      bedLevel: mix.ambience.level,
      densityLevel: mix.ambience.density,
      bedLowHz: 120,
      bedHighHz: mix.ambience.toneHz ?? 4200,
      densityHighHz: Math.min((mix.ambience.toneHz ?? 4200) * 0.72, 16000),
      blipRate: 2.4 + mix.ambience.density * 3,
      blipLevel: 0.12 + mix.ambience.density * 0.14,
      formantLowHz: 360,
      formantHighHz: Math.min((mix.ambience.toneHz ?? 4200) * 0.5, 8000),
      blipSeconds: 0.2,
      roomToneLevel: 0.1,
      roomToneHz: 160,
    },
  };
}

function buildAudioProvider() {
  return {
    mix: (year: YearId) => eraMusicMix(year),
    program: (year: YearId) => musicProgram(year),
    ambience: (year: YearId) => buildMurmur(year),
  };
}

/** Applies renderer quality without rebuilding or changing camera ownership. */
function applyRendererQuality(kernel: Kernel, quality: RenderQuality): void {
  const renderer = kernel.renderer;
  if (!renderer) return;
  if (quality === 'high') {
    renderer.setPixelRatio(typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  } else {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
  }
  kernel.resize();
}

function moduleOptions(year: YearId, audio: AudioEngine, reducedMotion: boolean) {
  return {
    bounds: periodFor(year).roomDefaults.bounds,
    seed: 0xcafe,
    initialYear: year,
    // Registry factories only forward this common option surface. Domain
    // modules read the additional environment/audio services from BuildContext.
    ...(reducedMotion ? {} : {}),
    audio,
  };
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

/** Creates a fully wired café runtime. The browser entrypoint calls this once. */
export function createCafeComposition(options: CafeCompositionOptions = {}): CafeComposition {
  const initialYear = options.initialYear ?? DEFAULT_YEAR_ID;
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  const qualityState: { value: RenderQuality } = { value: options.quality ?? 'high' };
  const scheduler = options.scheduler ?? null;
  const container = options.container ?? null;
  const useUi = options.ui ?? typeof document !== 'undefined';
  const doc = typeof document === 'undefined' ? null : document;
  const stage = container ?? (doc?.getElementById('app') as HTMLElement | null) ?? null;

  const kernel = createKernel(stage, {
    forceHeadless: options.forceHeadless ?? stage === null,
    initialYear,
    scheduler: scheduler ?? undefined,
    autoResize: true,
    autoStart: false,
    background: periodFor(initialYear).palette.background,
    bounds: periodFor(initialYear).roomDefaults.bounds,
    shadows: qualityState.value === 'high',
  });

  const audio = createAudioEngine({
    ...options.audioOptions,
    program: musicProgram(initialYear),
    mix: eraMusicMix(initialYear),
    ambience: buildMurmur(initialYear),
  });

  const modules = createEraModules(
    initialYear,
    moduleOptions(initialYear, audio, reduced),
  );
  const sceneModules = Object.freeze(modules.map((entry) => entry.module));
  const periodRegistry = Object.freeze(
    Object.fromEntries(YEAR_IDS.map((year) => [year, periodFor(year)])) as Record<YearId, EraDefinition>,
  );

  const services: Readonly<Record<string, unknown>> = Object.freeze({
    audio,
    audioEngine: audio,
    cafeAudioEngine: audio,
  });
  const initialPeriod = periodFor(initialYear);

  // Build in registry order. The environment goes first; subsequent modules
  // can consume its layout from the shared service map without importing it.
  const environment = modules.find((entry) => entry.id === 'environment')?.module;
  const buildServices = Object.freeze({
    ...services,
    environment,
    environmentModule: environment,
    shell: environment,
  });
  const buildContext = kernel.createBuildContext(initialPeriod, { services: buildServices });
  for (const module of sceneModules) module.build(buildContext);
  for (const module of sceneModules) {
    const motionAware = module as SceneModule & {
      setReducedMotion?: (value: boolean | 'auto') => void;
    };
    motionAware.setReducedMotion?.(reduced);
  }
  kernel.setYear(initialYear);

  const hotspots = createHotspotRegistry();
  const bounds = periodFor(initialYear).roomDefaults.bounds;
  registerDefaultAnchors(hotspots, bounds);
  for (const module of sceneModules) {
    const records = module.getHotspots();
    const inputs = records.map((hotspot) => ({
      id: hotspot.id,
      label: hotspot.label,
      description: hotspot.description,
      focus: hotspot.position,
      radius: hotspot.radius,
      year: hotspot.year,
      moduleId: hotspot.moduleId,
      kind: hotspot.kind,
      anchor: hotspot.anchor,
    }));
    // Some modules intentionally publish the same semantic anchor. Registry ids
    // are scene-wide, so default anchors remain the guaranteed fallbacks and a
    // duplicate domain affordance is skipped rather than replacing it.
    const fresh = inputs.filter((input) => !hotspots.has(input.id));
    if (fresh.length > 0) hotspots.publishMany(module.id, fresh);
  }

  const navigation = createNavigationController({
    camera: kernel.camera,
    rig: kernel.cameraRig,
    bounds,
    frameSource: kernel,
    element: kernel.canvas ?? stage,
    ownerDocument: doc,
    keyTarget: doc,
    reducedMotion: reduced,
    damping: reduced ? 0 : 7,
    headBob: reduced ? null : { amplitude: 0.015, frequency: 1.6 },
  });
  navigation.attach();

  const transition = createPeriodTransition({
    modules: sceneModules,
    host: kernel,
    audio,
    audioProvider: buildAudioProvider(),
    resolvePeriod: periodFor,
    initialYear,
    reducedMotion: reduced,
    services: buildServices,
    durationSeconds: reduced ? 0.1 : undefined,
  });
  // applyYear is the transition engine's boot path and lets it publish the
  // initial caption while retaining modules' already-built scene graph.
  transition.applyYear(initialYear);

  let slider: TimelineSlider | null = null;
  let hud: Hud | null = null;
  let enterGate: EnterGate | null = null;
  let inspectOverlay: InspectOverlay | null = null;
  let inspectMode: InspectMode | null = null;
  let entered = false;
  let disposed = false;
  let unsubFrame: (() => void) | null = null;
  let unsubCaption: (() => void) | null = null;
  let unsubComplete: (() => void) | null = null;
  let pagehideHandler: (() => void) | null = null;

  const setYearUi = (year: YearId): void => {
    const period = periodFor(year);
    hud?.setPeriod(period);
    inspectMode?.setYear(year);
    kernel.setYear(year);
    navigation.setReducedMotion(reduced);
  };

  const qualityApi = {
    setQuality(quality: RenderQuality): void {
      qualityState.value = quality;
      applyRendererQuality(kernel, quality);
      hud?.setQuality(quality);
    },
  };

  const selectYear = (year: YearId): void => {
    if (disposed || !YEAR_IDS.includes(year)) return;
    // The transition is the only path that applies periods. During a transition
    // navigation input is detached, so the transition's camera micro-move is the
    // single absolute camera writer for its duration.
    navigation.detach();
    hud?.setStatus(transition.isTransitioning ? `Transforming the café to ${year}…` : `Transforming the café to ${year}…`);
    setYearUi(year);
    const completion = transition.requestYear(year);
    void completion.then(() => {
      if (disposed) return;
      navigation.attach();
      hud?.setStatus(entered ? `Sound on · ${year} café` : 'Audio locked — enter the café to start sound.');
      setYearUi(year);
    });
  };

  if (useUi && doc && stage) {
    slider = createTimelineSlider({
      container: stage,
      ownerDocument: doc,
      initialYear,
      reducedMotion: reduced,
    });
    slider.onYearChange((year) => selectYear(year));

    inspectOverlay = createInspectOverlay({ container: stage, ownerDocument: doc, reducedMotion: reduced });
    inspectMode = createInspectMode({
      registry: hotspots,
      navigation,
      overlay: inspectOverlay,
      year: initialYear,
    });

    hud = createHud({
      container: stage,
      period: initialPeriod,
      quality: qualityState.value,
      mode: navigation.mode,
      reducedMotion: reduced,
      audioState: audio.state,
      hotspots: hotspotView(hotspots.list()),
      hints: HUD_CONTROL_HINTS,
      onToggleMute: (muted) => {
        audio.setMasterLevel(muted ? 0 : 0.9, 0.12);
      },
      onToggleBus: (bus, muted) => audio.setBusMute(bus, muted, 0.12),
      onToggleQuality: (quality) => qualityApi.setQuality(quality),
      onToggleMode: (mode) => navigation.setMode(mode),
      onSelectHotspot: (id) => {
        inspectMode?.open(id, kernel.year);
      },
      onRebuild: () => {
        window.cafeReinit?.();
      },
    });

    enterGate = createEnterGate({
      container: stage,
      ownerDocument: doc,
      reducedMotion: reduced,
      onEnter: async () => {
        entered = true;
        try {
          await audio.unlock();
          hud?.setAudioState(audio.state);
          hud?.setStatus(`Sound on · ${kernel.year} café`);
        } catch (error) {
          entered = false;
          hud?.setStatus('Audio unavailable — the café remains playable without sound.');
          console.warn('[cafe] audio could not unlock', error);
        }
      },
    });
  }

  unsubCaption = transition.onCaption((caption) => {
    if (disposed) return;
    const period = periodFor(caption.year);
    hud?.setPeriod(period);
    inspectMode?.setYear(caption.year);
  });
  unsubComplete = transition.onComplete((signal) => {
    if (disposed) return;
    navigation.attach();
    hud?.setStatus(entered ? `Sound on · ${signal.settledYear ?? signal.requestedYear} café` : 'Audio locked — enter the café to start sound.');
  });

  unsubFrame = kernel.onFrame((frame) => {
    if (disposed) return;
    transition.update(frame.deltaSeconds);
    audio.update(frame.deltaSeconds);
    for (const module of sceneModules) {
      module.update(frame.deltaSeconds, {
        year: kernel.year,
        elapsedSeconds: frame.elapsedSeconds,
        frame: frame.frame,
      });
    }
  });

  // The transition and camera need a first render even when the loop is paused
  // behind the enter gate. The kernel still starts its loop; audio does not.
  kernel.render();
  if (options.autoStart !== false) kernel.start();

  const composition: CafeComposition = {
    kernel,
    modules,
    sceneModules,
    registry: periodRegistry,
    audio,
    navigation,
    hotspots,
    transition,
    get slider() {
      return slider;
    },
    get hud() {
      return hud;
    },
    get enterGate() {
      return enterGate;
    },
    get inspectOverlay() {
      return inspectOverlay;
    },
    get inspectMode() {
      return inspectMode;
    },
    scheduler,
    get quality() {
      return qualityState.value;
    },
    reducedMotion: reduced,
    get disposed() {
      return disposed;
    },
    get year() {
      return transition.settledYear ?? kernel.year;
    },
    get entered() {
      return entered;
    },
    enter: async () => {
      if (disposed) return;
      if (enterGate && enterGate.visible) enterGate.button.click();
      else {
        entered = true;
        await audio.unlock();
        hud?.setAudioState(audio.state);
      }
    },
    selectYear,
    tick: (deltaSeconds = 1 / 60) => {
      if (disposed) return;
      if (scheduler && scheduler.pending > 0) {
        scheduler.tick(deltaSeconds * 1000);
      } else {
        // A paused deterministic harness still advances the same kernel frame
        // pipeline; this avoids silently skipping transition/module updates.
        kernel.update(deltaSeconds);
      }
    },
    setQuality: qualityApi.setQuality,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (pagehideHandler) window.removeEventListener('pagehide', pagehideHandler);
      if (unsubFrame) unsubFrame();
      if (unsubCaption) unsubCaption();
      if (unsubComplete) unsubComplete();
      navigation.detach();
      inspectMode?.dispose();
      inspectOverlay?.dispose();
      slider?.dispose();
      hud?.dispose();
      enterGate?.dispose();
      transition.dispose();
      hotspots.dispose();
      audio.dispose();
      for (const module of sceneModules) module.dispose();
      kernel.stop();
      kernel.dispose();
      if (typeof window !== 'undefined' && window.cafeComposition === composition) {
        delete window.cafeComposition;
      }
    },
  };

  if (typeof window !== 'undefined') {
    window.cafeComposition = composition;
    window.cafeKernel = kernel;
    pagehideHandler = () => composition.dispose();
    window.addEventListener('pagehide', pagehideHandler, { once: true });
  }

  return composition;
}

/**
 * Small helper used by the headless composition suite. It builds a deterministic
 * no-DOM runtime and advances transitions until they settle.
 */
export function bootHeadlessCafe(options: Omit<CafeCompositionOptions, 'forceHeadless' | 'ui'> = {}): CafeComposition {
  const scheduler = options.scheduler ?? createManualFrameScheduler();
  return createCafeComposition({ ...options, scheduler, forceHeadless: true, ui: false, autoStart: false });
}

/** Rebuild helper used by the browser HUD and manual QA. */
export function reinitCafeComposition(options: CafeCompositionOptions = {}): CafeComposition {
  if (typeof window !== 'undefined') window.cafeComposition?.dispose();
  return createCafeComposition(options);
}
