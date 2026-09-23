/**
 * Chrono City — browser entry point.
 *
 * Runs on page load: it builds the scene context, frames the block, marks the
 * shell ready, starts the RAF tick loop and publishes the app handle on
 * `window.__chronoCity` so overlay systems and Playwright harnesses can drive
 * the live scene.
 */

import './app.css';

import { bootAudioDirector, type AudioDirector, type AudioDirectorBoot } from './audio/audioDirector';
import { CELL_HALF_DEPTH, CELL_HALF_WIDTH } from './core/blockLayout';
import {
  createSceneContextApp,
  integrateSceneContextGlobal,
  type SceneContextApp,
  type SceneContextOptions,
} from './core/sceneContext';
import { startChronoCityExperience } from './integration/startupSequence';

/** Currently booted app, if any. */
let activeApp: SceneContextApp | null = null;

/** Audio boot handle for the running app: unlock affordance + scene tick. */
let activeAudio: AudioDirectorBoot | null = null;

/**
 * Neutral establishing shot of the block: high, slightly south of the centre,
 * angled down at the origin. Era content and gameplay systems refine it later.
 */
function frameBlock(app: SceneContextApp): void {
  const { camera } = app.context;
  camera.position.set(CELL_HALF_WIDTH * 0.9, 72, CELL_HALF_DEPTH * 1.9);
  camera.lookAt(0, 0, 0);
  app.context.resize();
}

/** Marks the shell as booted and hands the HUD a ready-to-fill overlay root. */
function markReady(app: SceneContextApp): void {
  const root = document.documentElement;
  root.dataset.chronoBoot = 'ready';
  root.dataset.chronoVersion = String(app.context.version);

  app.overlayRoot.dataset.chronoHud = 'root';
  if (!app.overlayRoot.hasAttribute('aria-label')) {
    app.overlayRoot.setAttribute('aria-label', 'Chrono City overlay');
  }
}

/**
 * Boots the app. Safe to call twice: the second call returns the running app.
 */
export function bootChronoCity(options: SceneContextOptions = {}): SceneContextApp {
  if (activeApp) return activeApp;

  const app = createSceneContextApp({
    autoResize: true,
    shadows: true,
    ...options,
  });

  frameBlock(app);
  markReady(app);
  startAudio(app);
  app.start();
  integrateSceneContextGlobal(app);
  activeApp = app;
  return app;
}

/**
 * Boots the audio engine for the scene: the synthesized cue set, the
 * gesture-gated unlock affordance (which doubles as the mute toggle) and the
 * tick system that keeps the listener glued to the camera.
 *
 * Audio is additive by contract — a failure here must never stop the city from
 * booting, so the boot is defensive and simply logs when it cannot start.
 */
function startAudio(app: SceneContextApp): void {
  try {
    activeAudio = bootAudioDirector({
      scene: app.context,
      documentRef: document,
      container: app.overlayRoot,
    });
  } catch (error) {
    console.error('[chrono-city] audio boot failed', error);
  }
}

/** Stops the running app and clears the global handle (used by tests/HMR). */
export function stopChronoCity(): void {
  if (activeAudio) {
    activeAudio.dispose();
    activeAudio = null;
  }
  if (!activeApp) return;
  activeApp.dispose();
  activeApp = null;
  if (typeof window !== 'undefined') delete window.__chronoCity;
  document.documentElement.dataset.chronoBoot = 'stopped';
}

/** The live app handle, or `null` before boot. */
export function getChronoCity(): SceneContextApp | null {
  return activeApp;
}

/** The live audio engine, or `null` before boot (see `window.__chronoCityAudio`). */
export function getChronoCityAudio(): AudioDirector | null {
  return activeAudio?.director ?? null;
}

function bootFromDocument(): void {
  try {
    bootChronoCity();
  } catch (error) {
    document.documentElement.dataset.chronoBoot = 'error';
    console.error('[chrono-city] boot failed', error);
  }
}

// Self-start: the page markup provides the stage and overlay roots, so boot as
// soon as they exist (module scripts run after parsing, but be defensive).
if (typeof document !== 'undefined') {
  if (document.querySelector('[data-chrono-stage]')) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootFromDocument, { once: true });
    } else {
      bootFromDocument();
    }
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopChronoCity();
  });
}

// Era-transition integration: compose every produced system onto the live shell
// behind the loading screen and self-start the composed city. The call is
// append-only so the foundation boot path above stays untouched; it waits for
// `chrono-city:ready`, so it is safe whether the shell is already up or still
// parsing.
startChronoCityExperience();
