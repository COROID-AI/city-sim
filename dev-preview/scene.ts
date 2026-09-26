/**
 * Dev preview: the neon holographic factory floor, the camera rig and the post
 * chain, driven through the shared preview harness.
 *
 * The page mounts `dev-preview/harness.ts` (canvas, adapter with headless
 * fallback, deterministic `createSampleState` fixture, resize wiring) and
 * composes exactly two systems:
 *
 *  1. `createCameraRigSystem` — orbit / pan / zoom on the canvas plus the six
 *     cinematic screen states;
 *  2. `createWorldSystem` — the floor, its lighting and atmosphere, and the
 *     bloom / god-ray / vignette chain.
 *
 * The rig is registered **before** the world, because the post chain places its
 * camera-locked screen pass on the pose it reads at update time.
 *
 * The page adds:
 *
 *  - a ticker describing the live camera pose and the active post cost tier;
 *  - buttons for every named screen state and every quality preset, wired to the
 *    same handles a verifier can drive through `window.coroidScene`;
 *  - a deterministic **cinematic director** that cycles the six states on a
 *    fixed cadence, so the whole transition set can be watched hands-free;
 *  - keyboard shortcuts (`1`–`6`, `C`) mirroring the buttons.
 *
 * Nothing here imports a simulation module beyond the fixture, per the
 * presentation constraints.
 */

import '../src/styles/base.css';

import type { GameFrame } from '../src/game/Game';
import {
  CAMERA_SCREEN_STATES,
  CAMERA_STATES,
  createCameraRigSystem,
  type CameraRig,
  type CameraStateName,
} from '../src/render/camera';
import {
  POST_QUALITY_PRESETS,
  type PostQualityPreset,
} from '../src/render/effects';
import { FLOOR_SIZE, GRID_CELL, WORLD_FOG, createWorldSystem, type World } from '../src/render/scene';
import { createSampleState } from '../src/sim/fixtures';
import { mountGamePreview, type PreviewHarness } from './harness';

/** The six named camera states, in canonical order. */
export const SCENE_PREVIEW_CAMERA_STATES: readonly CameraStateName[] = CAMERA_STATES;
/** The four post-processing tiers, cheapest first. */
export const SCENE_PREVIEW_QUALITY_PRESETS: readonly PostQualityPreset[] = POST_QUALITY_PRESETS;
/** Cadence of the hands-free cinematic run, milliseconds. */
export const CINEMATIC_INTERVAL_MS = 5_200;

/* -------------------------------------------------------------------------- */
/* Cinematic director                                                         */
/* -------------------------------------------------------------------------- */

/** Anything that can be asked for a named screen state. */
export interface CameraStateTarget {
  setState(name: CameraStateName, options?: { immediate?: boolean; durationMs?: number }): void;
}

export interface CinematicDirectorOptions {
  /** State order to cycle. Defaults to the canonical six. */
  order?: readonly CameraStateName[];
  /** Milliseconds each state holds. Defaults to `CINEMATIC_INTERVAL_MS`. */
  intervalMs?: number;
  /** State the cycle starts on. Defaults to the first of `order`. */
  state?: CameraStateName;
}

export interface CinematicDirector {
  readonly order: readonly CameraStateName[];
  readonly intervalMs: number;
  /** Index of the state currently held. */
  readonly index: number;
  /** Whether the cycle is running. */
  readonly enabled: boolean;
  /** Pause or resume the cycle. */
  setEnabled(enabled: boolean): void;
  /** Jump back to a given state and restart the cadence. */
  reset(state?: CameraStateName): void;
  /**
   * Advance the cycle for a simulated time. Pure function of `elapsedMs`: the
   * same elapsed value always resolves to the same state, so a verifier can
   * replay the whole show deterministically.
   */
  tick(elapsedMs: number): CameraStateName | null;
}

/**
 * Build the hands-free cinematic run.
 *
 * The cycle is `floor(elapsedMs / intervalMs) % order.length`, so it is
 * deterministic and monotonic: no random choice, no wall clock, and a repeated
 * or out-of-order `tick` cannot desynchronise it.
 */
export function createCinematicDirector(
  target: CameraStateTarget,
  options: CinematicDirectorOptions = {},
): CinematicDirector {
  const order = options.order && options.order.length > 0 ? [...options.order] : [...CAMERA_STATES];
  const intervalMs = Math.max(500, options.intervalMs ?? CINEMATIC_INTERVAL_MS);

  const startIndex = Math.max(0, order.indexOf(options.state ?? order[0] ?? 'brief'));
  let index = startIndex;
  let enabled = false;
  /** Simulated time the current cadence started from; `null` until the first tick. */
  let anchorMs: number | null = null;
  /** State the cadence counts forward from. */
  let anchorIndex = startIndex;

  const apply = (next: number, immediate: boolean): void => {
    index = next;
    const name = order[index];
    if (!name) return;
    target.setState(name, immediate ? { immediate: true } : undefined);
  };

  apply(startIndex, true);

  return {
    order,
    intervalMs,
    get index() {
      return index;
    },
    get enabled() {
      return enabled;
    },
    setEnabled(next: boolean): void {
      enabled = next;
      anchorMs = null;
      anchorIndex = index;
    },
    reset(state?: CameraStateName): void {
      const restart = state === undefined ? index : order.indexOf(state);
      anchorMs = null;
      anchorIndex = restart < 0 ? 0 : restart;
      apply(anchorIndex, true);
    },
    tick(elapsedMs: number): CameraStateName | null {
      if (!enabled) return null;
      const now = Math.max(0, elapsedMs);
      if (anchorMs === null) {
        // First tick after resuming: start counting from here, so the cadence
        // continues from the state on screen instead of jumping.
        anchorMs = now;
        anchorIndex = index;
        return null;
      }
      const step = Math.max(0, Math.floor((now - anchorMs) / intervalMs));
      const next = (anchorIndex + step) % order.length;
      if (next === index) return null;
      apply(next, false);
      return order[next] ?? null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Ticker copy                                                                */
/* -------------------------------------------------------------------------- */

function degrees(radians: number): string {
  const value = (radians * 180) / Math.PI;
  return `${value >= 0 ? '+' : ''}${value.toFixed(0)}`;
}

/** Ticker lines for the live camera pose. */
export function describeCameraRig(rig: CameraRig | null): string[] {
  if (!rig) return ['camera    offline'];
  const pose = rig.pose;
  const state = CAMERA_SCREEN_STATES[rig.state];
  const progress = rig.transitioning ? ` → ${(rig.transitionProgress * 100).toFixed(0)}%` : '';
  return [
    `camera    ${state.label.toLowerCase()} · ${rig.mode}${progress}`,
    `orbit     az ${degrees(pose.azimuth)}°  polar ${degrees(pose.polar)}°  d ${pose.distance.toFixed(1)}  fov ${pose.fov.toFixed(0)}°`,
    `focus     ${pose.focus.x.toFixed(1)} ${pose.focus.y.toFixed(1)} ${pose.focus.z.toFixed(1)}`,
  ];
}

/** Ticker lines for the floor and its post chain. */
export function describeWorld(world: World | null): string[] {
  if (!world) return ['world     offline'];
  const settings = world.post.settings;
  return [
    `post      ${settings.preset} · halos ${world.post.visibleHalos} · rays ${world.post.visibleRays}`,
    `floor     ${FLOOR_SIZE}u grid ${GRID_CELL}u · fog ${WORLD_FOG.density} · lanes ${world.laneCount} · gates ${world.gateCount}`,
    `bloom     ${settings.haloRings} rings · vignette ${settings.vignette} · aberration ${settings.aberration.toFixed(4)}`,
  ];
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

declare global {
  interface Window {
    /** Browser-verification handle for the scene preview page. */
    coroidScene?: ScenePreviewHandle;
  }
}

export interface ScenePreviewHandle {
  readonly harness: PreviewHarness;
  readonly world: World;
  readonly rig: CameraRig;
  readonly director: CinematicDirector;
  /** Cinematic transition into a named screen state. */
  setState(name: CameraStateName): void;
  /** Apply a post-processing tier. */
  setQuality(preset: PostQualityPreset): void;
  /** Start or stop the hands-free cinematic run. */
  setCinematic(enabled: boolean): void;
  /** Exactly the lines the page ticker shows. */
  summary(): string[];
  /** Tear down the harness, the systems, the controls and the window handle. */
  dispose(): void;
}

export interface ScenePreviewOptions {
  host: HTMLElement;
  /** Ticker element updated every few frames. */
  ticker?: HTMLElement | null;
  preset?: PostQualityPreset;
  state?: CameraStateName;
  cinematic?: boolean;
  seed?: number;
  /** Begin real-time playback immediately. Defaults to `true`. */
  autoStart?: boolean;
}

/**
 * Mount the preview over a host element.
 *
 * Returns the live world, rig and director so a browser verifier (or a test) can
 * drive exactly what the buttons drive.
 */
export function createScenePreview(options: ScenePreviewOptions): ScenePreviewHandle {
  // One fixture instance for the whole page: the harness reduces it and the world
  // is coded from the very same snapshot, so the first painted frame is already
  // the floor the mission describes.
  const fixture = createSampleState({ seed: options.seed });
  const rigSystem = createCameraRigSystem({ state: options.state ?? 'brief' });
  const worldSystem = createWorldSystem({ preset: options.preset, seed: options.seed, state: fixture });

  let handle: ScenePreviewHandle | null = null;

  const harness = mountGamePreview({
    container: options.host,
    adapter: 'auto',
    // The page renders its own ticker and control panel.
    overlay: false,
    state: fixture,
    systems: [rigSystem, worldSystem],
    autoStart: options.autoStart,
    onFrame: (frame: GameFrame) => {
      handle?.director.tick(frame.elapsedMs);
      if (options.ticker && (frame.frame === 1 || frame.frame % 10 === 0)) {
        options.ticker.textContent = [...describeCameraRig(rigSystem.rig), ...describeWorld(worldSystem.world)].join(
          '\n',
        );
      }
    },
  });

  const world = worldSystem.world;
  const rig = rigSystem.rig;
  if (!world || !rig) {
    harness.dispose();
    throw new Error('[coroid] the scene preview could not compose the world and the camera rig');
  }

  const director = createCinematicDirector(rig, { state: options.state ?? 'brief' });
  const onKeyDown = (event: KeyboardEvent): void => {
    const digit = Number.parseInt(event.key, 10);
    if (Number.isInteger(digit) && digit >= 1 && digit <= SCENE_PREVIEW_CAMERA_STATES.length) {
      const name = SCENE_PREVIEW_CAMERA_STATES[digit - 1];
      if (name) {
        director.setEnabled(false);
        handle?.setState(name);
      }
      return;
    }
    if (event.key.toLowerCase() === 'c') handle?.setCinematic(!director.enabled);
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown);

  handle = {
    harness,
    world,
    rig,
    director,
    setState(name: CameraStateName): void {
      rig.setState(name);
    },
    setQuality(preset: PostQualityPreset): void {
      world.setPreset(preset);
    },
    setCinematic(enabled: boolean): void {
      director.setEnabled(enabled);
    },
    summary(): string[] {
      return [...describeCameraRig(rig), ...describeWorld(world)];
    },
    dispose(): void {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', onKeyDown);
        if (window.coroidScene === handle) delete window.coroidScene;
      }
      harness.dispose();
    },
  };

  director.setEnabled(options.cinematic ?? true);
  return handle;
}

/** Hook the page's `data-coroid-*` controls up to a mounted preview. */
export function wireScenePreviewControls(handle: ScenePreviewHandle, document: Document): void {
  const stateButtons = document.querySelectorAll<HTMLButtonElement>('[data-coroid-camera-state]');
  const qualityButtons = document.querySelectorAll<HTMLButtonElement>('[data-coroid-quality]');
  const cinematicButton = document.querySelector<HTMLButtonElement>('[data-coroid-cinematic]');

  const syncStateButtons = (): void => {
    for (const button of stateButtons) {
      const active = button.dataset.coroidCameraState === handle.rig.state;
      button.dataset.active = active ? 'true' : 'false';
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (cinematicButton) {
      cinematicButton.dataset.active = handle.director.enabled ? 'true' : 'false';
      cinematicButton.setAttribute('aria-pressed', handle.director.enabled ? 'true' : 'false');
      cinematicButton.textContent = handle.director.enabled ? 'Cinematic run: on' : 'Cinematic run: off';
    }
    for (const button of qualityButtons) {
      const active = button.dataset.coroidQuality === handle.world.post.preset;
      button.dataset.active = active ? 'true' : 'false';
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };

  for (const button of stateButtons) {
    button.addEventListener('click', () => {
      const name = button.dataset.coroidCameraState as CameraStateName | undefined;
      if (!name) return;
      handle.setCinematic(false);
      handle.setState(name);
      syncStateButtons();
    });
  }

  for (const button of qualityButtons) {
    button.addEventListener('click', () => {
      const preset = button.dataset.coroidQuality as PostQualityPreset | undefined;
      if (!preset) return;
      handle.setQuality(preset);
      syncStateButtons();
    });
  }

  if (cinematicButton) {
    cinematicButton.addEventListener('click', () => {
      handle.setCinematic(!handle.director.enabled);
      syncStateButtons();
    });
  }

  syncStateButtons();
}

export interface ScenePreviewBootOptions {
  /** Host element. Defaults to `#scene`. */
  host?: HTMLElement | null;
  /** Ticker element. Defaults to `#scene-ticker`. */
  ticker?: HTMLElement | null;
}

/** Boot the page: composition, controls and the verification handle. */
export function bootScenePreview(options: ScenePreviewBootOptions = {}): ScenePreviewHandle | null {
  if (typeof document === 'undefined') return null;
  const host = options.host ?? document.getElementById('scene');
  if (!host) return null;
  const ticker = options.ticker === undefined ? document.getElementById('scene-ticker') : options.ticker;

  const handle = createScenePreview({ host, ticker });
  wireScenePreviewControls(handle, document);
  window.coroidScene = handle;
  return handle;
}

try {
  bootScenePreview();
} catch (error) {
  console.error('[coroid] failed to mount the scene preview', error);
  const ticker = typeof document === 'undefined' ? null : document.getElementById('scene-ticker');
  if (ticker) {
    ticker.textContent = 'Hologram offline — this browser could not provide a renderer for the floor.';
  }
}
