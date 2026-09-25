/**
 * Chrono City entry point.
 *
 * Boots the whole experience: WebGL capability check with a styled fallback,
 * progressive era-layer construction behind the loading overlay, the renderer /
 * camera / control / post-processing stack, the timeline and HUD wiring, the
 * transition controller, the Web Audio soundscape, focus-mode picking and every
 * keyboard shortcut.
 */

import './styles.css';
import * as THREE from 'three';
import { AudioEngine } from './audio/audioEngine';
import { ERAS } from './config/eras';
import { YEARS, type SkyPalette, type Year } from './config/types';
import { OrbitCameraController } from './core/cameraControls';
import { Engine, isWebGLAvailable } from './core/engine';
import { EraTransitionController } from './era/transition';
import { cameraDrift } from './sim/animation';
import { Store, formatYearHash, parseYearHash, type FocusTarget } from './state/store';
import { Hud, queryHudElements } from './ui/hud';
import { TimelineUI } from './ui/timeline';
import { buildAllEraLayers, buildEraLayer } from './world/cityBlock';
import { createTextureFactory } from './world/textures';
import type { EraLayer } from './config/types';

const IDLE_BEFORE_DRIFT = 14;
const PASS_BY_INTERVAL = 2.8;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Yield to the browser so the loading overlay can paint between busy steps. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else window.setTimeout(resolve, 0);
  });
}

interface Focusable {
  kind: FocusTarget['kind'];
  id: string;
  label: string;
  detail: string;
  period: string;
}

async function boot(): Promise<void> {
  const canvasCandidate = document.getElementById('scene') as HTMLCanvasElement | null;
  const hudElements = queryHudElements(document);
  const hud = new Hud(hudElements, {
    onToggleMute: () => toggleMute(),
    onToggleHelp: (open) => setHelp(open),
    onCloseFocus: () => clearFocus(),
    onEnableAudio: () => enableAudio(),
    onToggleFps: () => toggleFps(true),
  });

  if (!canvasCandidate) {
    hud.showFallback('The 3D canvas could not be found in the page.');
    return;
  }
  const canvas: HTMLCanvasElement = canvasCandidate;
  if (!isWebGLAvailable()) {
    hud.showFallback(
      'This browser could not create a WebGL context, so the 3D city block cannot be rendered. ' +
        'Try a recent version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.',
    );
    return;
  }

  const reducedMotion = prefersReducedMotion();
  const initialYear = parseYearHash(window.location.hash) ?? 1945;
  const store = new Store(initialYear);

  hud.setLoading(true, 0.02, 'Waking up the block…');
  await nextFrame();

  // ---- generation ---------------------------------------------------------
  const textures = createTextureFactory();
  const layers: Map<Year, EraLayer> = new Map();
  // Build era by era, yielding between each so the progress bar animates.
  for (let index = 0; index < YEARS.length; index += 1) {
    const year = YEARS[index];
    hud.setLoading(true, 0.05 + (index / YEARS.length) * 0.85, `Reconstructing ${year}…`);
    await nextFrame();
    layers.set(year, buildEraLayer(ERAS[year], { textures }));
  }

  hud.setLoading(true, 0.93, 'Lighting the lamps…');
  await nextFrame();

  // ---- engine / camera ----------------------------------------------------
  const engine = new Engine({
    canvas,
    onFps: (fps) => {
      store.patch({ fps });
      hud.setFps(fps, engine.qualityTier);
    },
    onQualityChange: (tier) => {
      store.patch({ quality: tier });
      hud.setFps(store.getState().fps, tier);
    },
    onContextLost: () => hud.showFallback('The graphics context was lost. Reload the page to restore the scene.'),
    onContextRestored: () => {
      hudElements.fallback.hidden = true;
    },
  });

  const controls = new OrbitCameraController(engine.camera);
  controls.attach(canvas);

  const sceneRoot = new THREE.Group();
  sceneRoot.name = 'city';
  for (const layer of layers.values()) sceneRoot.add(layer.group);
  engine.scene.add(sceneRoot);

  // ---- transition ---------------------------------------------------------
  const transition = new EraTransitionController({
    layers,
    reducedMotion,
    onEvent: (event) => {
      if (event.type === 'start') {
        audio.setYear(event.to);
        audio.playWhoosh();
        hud.setTransitionProgress(0);
      } else if (event.type === 'complete') {
        hud.setTransitionProgress(null);
      }
    },
  });
  transition.applyImmediate(initialYear);
  engine.applyPalette(transition.currentPalette);
  engine.setGrade(transition.currentGrade);

  // ---- audio --------------------------------------------------------------
  const audio = new AudioEngine();
  audio.setYear(initialYear);

  // ---- UI -----------------------------------------------------------------
  const timeline = new TimelineUI(
    {
      root: document.getElementById('timeline') as HTMLElement,
      track: document.querySelector('.timeline-track') as HTMLElement,
      stops: document.getElementById('timeline-stops') as HTMLElement,
      progress: document.getElementById('timeline-progress') as HTMLElement,
      handle: document.getElementById('timeline-handle') as HTMLElement,
    },
    {
      onPreview: (index) => {
        if (index === null) {
          // Drag released (or a stop was clicked): drop the scrub and settle the
          // blended frame onto the era that was actually on screen.
          transition.cancelPreview();
          return;
        }
        transition.preview(index);
      },
      onCommit: (index) => {
        const year = YEARS[Math.max(0, Math.min(YEARS.length - 1, Math.round(index)))];
        selectYear(year, 'ui');
      },
      onYearChange: (year) => hud.setEra(year),
      onInteraction: () => {
        registerInteraction();
      },
    },
  );
  timeline.setYear(initialYear, false);
  hud.setEra(initialYear);
  hud.setMuted(audio.muted);
  hud.setSoundPromptVisible(!audio.unlocked && audio.available);
  hud.setLoading(false, 1, 'Ready');

  // ---- interaction helpers ------------------------------------------------
  let lastInteraction = performance.now();

  function setHelp(open: boolean): void {
    hud.setHelp(open);
    store.patch({ helpOpen: open });
    if (open) audio.playClick();
  }

  function toggleFps(force?: boolean): void {
    const next = force ?? !(hudElements.fpsReadout.hidden === false);
    hud.setFps(store.getState().fps, engine.qualityTier, next);
  }

  function toggleMute(): void {
    const muted = audio.toggleMuted();
    store.patch({ muted });
    hud.setMuted(muted);
    if (!muted) audio.playClick();
  }

  function enableAudio(): void {
    if (audio.unlock()) {
      store.patch({ audioUnlocked: true, soundPromptVisible: false });
      hud.setSoundPromptVisible(false);
      audio.setYear(store.getState().year);
      audio.playClick();
    } else {
      hud.setSoundPromptVisible(false);
    }
  }

  /** Any gesture unlocks Web Audio (autoplay policy) and quiets the hints. */
  function registerInteraction(): void {
    lastInteraction = performance.now();
    hud.dimHint(true);
    if (!audio.unlocked) enableAudio();
  }

  function pushHash(year: Year): void {
    const next = formatYearHash(year);
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', next);
    }
  }

  function selectYear(year: Year, source: 'ui' | 'external'): void {
    const state = transition.state;
    if (source === 'ui' && !state.previewing && distanceOf(store.getState().year, year) === 0) {
      // Already there - or already animating there (a stop click reports itself
      // through both the pointer release and the button click): never begin a
      // second change towards an era the scene already shows or is heading to.
      if (!state.active || state.to === year) {
        audio.playClick();
        return;
      }
    }
    store.setYear(year);
    transition.selectYear(year);
    timeline.setYear(year, false);
    hud.setEra(year);
    pushHash(year);
    if (source === 'ui') audio.playClick();
  }

  // ---- picking / focus ----------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDown = { x: 0, y: 0, time: 0 };

  function clearFocus(): void {
    store.setFocus(null);
    hud.setFocus(null);
    controls.reset(store.getState().focus ? 0.9 : 0.7);
  }

  function focusFrom(object: THREE.Object3D): boolean {
    let node: THREE.Object3D | null = object;
    while (node) {
      const focus = node.userData?.focus as Focusable | undefined;
      if (focus) {
        const target: FocusTarget = {
          kind: focus.kind,
          id: focus.id,
          label: focus.label,
          detail: focus.detail,
          period: focus.period,
          position: [node.getWorldPosition(new THREE.Vector3()).x, node.position.y, node.getWorldPosition(new THREE.Vector3()).z],
        };
        store.setFocus(target);
        hud.setFocus(target);
        const world = node.getWorldPosition(new THREE.Vector3());
        controls.flyTo(world, { distance: focus.kind === 'building' ? 60 : 26, duration: 0.95 });
        audio.playClick();
        return true;
      }
      node = node.parent;
    }
    return false;
  }

  function onPointerDown(event: PointerEvent): void {
    pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
    registerInteraction();
  }

  function onPointerUp(event: PointerEvent): void {
    const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    if (moved > 6 || performance.now() - pointerDown.time > 700) return;
    if (event.button !== 0) return;
    if (!hudElements.helpOverlay.hidden) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    raycaster.setFromCamera(pointer, engine.camera);
    const year = transition.dominantYear();
    const layer = layers.get(year);
    if (!layer) return;
    const hits = raycaster.intersectObjects([layer.group], true);
    for (const hit of hits) {
      if (focusFrom(hit.object)) return;
    }
    clearFocus();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  const gestureHandler = (): void => {
    registerInteraction();
  };
  window.addEventListener('pointerdown', gestureHandler);
  window.addEventListener('keydown', gestureHandler);

  // ---- keyboard -----------------------------------------------------------
  function onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    switch (event.key) {
      case '1':
      case '2':
      case '3':
      case '4':
      case '5': {
        const index = Number(event.key) - 1;
        const year = YEARS[index];
        if (year) selectYear(year, 'ui');
        break;
      }
      case 'ArrowLeft':
      case 'ArrowDown':
        if (event.shiftKey) break;
        event.preventDefault();
        selectYear(YEARS[Math.max(0, YEARS.indexOf(store.getState().year) - 1)], 'ui');
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        if (event.shiftKey) break;
        event.preventDefault();
        selectYear(YEARS[Math.min(YEARS.length - 1, YEARS.indexOf(store.getState().year) + 1)], 'ui');
        break;
      case 'Home':
        selectYear(YEARS[0], 'ui');
        break;
      case 'End':
        selectYear(YEARS[YEARS.length - 1], 'ui');
        break;
      case 'h':
      case 'H':
        setHelp(!hud.isHelpOpen);
        break;
      case 'm':
      case 'M':
        toggleMute();
        break;
      case 'e':
      case 'E':
        clearFocus();
        break;
      case 'f':
      case 'F':
        toggleFps();
        break;
      case 'Escape':
        if (hud.isHelpOpen) setHelp(false);
        else clearFocus();
        break;
      default:
        break;
    }
  }
  window.addEventListener('keydown', onKeyDown);

  window.addEventListener('hashchange', () => {
    const year = parseYearHash(window.location.hash);
    if (year && year !== store.getState().year) selectYear(year, 'external');
  });

  // ---- per-frame systems --------------------------------------------------
  const drift = cameraDrift({
    isIdle: () => performance.now() - lastInteraction > IDLE_BEFORE_DRIFT * 1000 && !transition.state.active,
    apply: (dx, dy) => controls.orbit(dx, dy),
  });

  let passByTimer = 1.5;
  engine.addSystem((dt) => {
    controls.update(dt);

    const wasActive = transition.state.active;
    if (wasActive) {
      transition.update(dt);
      const p = transition.state.progress;
      // Camera micro-dolly plus a brief bloom flash to sell the morph.
      const pose = controls.getPose();
      const scale = 1 - 0.03 * Math.sin(Math.PI * p);
      engine.camera.position.sub(pose.target).multiplyScalar(scale).add(pose.target);
      engine.setFlash(Math.sin(Math.PI * p) * 0.4);
      hud.setTransitionProgress(p);
      audio.update(dt);
    } else {
      // A change can be aborted mid-flight (scrub, retarget), and low quality
      // tiers skip the bloom pass entirely, so always clear the flash.
      engine.setFlash(0);
    }

    const grade = transition.currentGrade;
    engine.setGrade(grade);
    const palette = transition.currentPalette as SkyPalette;
    engine.applyPalette(palette);
    for (const year of transition.visibleYears) {
      const sky = layers.get(year)?.categories.sky;
      const apply = sky?.userData?.applyPalette as ((value: SkyPalette) => void) | undefined;
      apply?.(palette);
    }

    for (const year of transition.visibleYears) {
      layers.get(year)?.update(dt);
    }

    drift.update(dt, dt);
    audio.update(dt);

    // Occasional vehicle pass-by from the era currently in control.
    passByTimer -= dt;
    if (passByTimer <= 0) {
      passByTimer = PASS_BY_INTERVAL * (0.7 + Math.random() * 0.8);
      if (audio.unlocked) {
        const layer = layers.get(transition.dominantYear());
        const fleet = layer?.group.userData?.trafficVehicles as
          | { spec: { id: string; kind: string }; group: THREE.Object3D; moving: boolean }[]
          | undefined;
        if (fleet && fleet.length > 0) {
          const moving = fleet.filter((entry) => entry.moving);
          const pick = moving[Math.floor(Math.random() * Math.max(1, moving.length))] ?? fleet[0];
          if (pick) {
            const world = pick.group.getWorldPosition(new THREE.Vector3());
            const view = engine.camera.position.clone().sub(world).normalize();
            const right = new THREE.Vector3().crossVectors(engine.camera.up, view).normalize();
            const pan = Math.max(-1, Math.min(1, world.clone().sub(engine.camera.position).normalize().dot(right.multiplyScalar(-1)) * 1.6));
            audio.playPassBy({ pan });
          }
        }
      }
    }
  });

  // ---- context-loss / error surfacing -------------------------------------
  window.addEventListener('error', (event) => {
    if (!engine.isRunning) return;
    // Keep rendering; surface the message without destroying the scene.
    store.patch({ error: event.message });
    hud.hint(`Recovered from a runtime error: ${event.message}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    store.patch({ error: String(event.reason) });
  });

  engine.start();
  timeline.setYear(initialYear, false);
  window.setTimeout(() => hud.dimHint(true), 12000);
  // Expose a tiny debug handle for smoke checks.
  (window as unknown as { chronoCity?: unknown }).chronoCity = { engine, store, transition, layers, controls, audio };
}

/** Absolute distance between two stop years on the timeline. */
function distanceOf(a: Year, b: Year): number {
  return Math.abs(YEARS.indexOf(a) - YEARS.indexOf(b));
}

void boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const fallback = document.getElementById('fallback');
  const fallbackMessage = document.getElementById('fallback-message');
  if (fallbackMessage) fallbackMessage.textContent = `Chrono City failed to start: ${message}`;
  if (fallback) fallback.hidden = false;
  const loading = document.getElementById('loading-overlay');
  if (loading) loading.hidden = true;
});

/** Re-exported for tooling/tests that want the builder without the DOM boot. */
export { buildAllEraLayers };
