/**
 * Coroid entrypoint: mounts the WebGL canvas and renders the boot scene — an
 * empty holographic factory floor.
 *
 * Composition happens through `src/game/systems.ts`. This file adds no gameplay:
 * it owns the *floor* (grid, plate, rings, emitter, lights, camera drift), the
 * splash overlay and the adapter choice (WebGL with a headless fallback so the
 * page still boots where WebGL is unavailable).
 */

import {
  AdditiveBlending,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  type PerspectiveCamera,
} from 'three';

import './styles/base.css';

import { mountGamePreview, type PreviewAdapterPreference, type PreviewHarness } from '../dev-preview/harness';
import type { GameFrame } from './game/Game';
import { createInspectionSystem } from './game/inspection';
import { createMissionInitialState, createSystems, type GameSystem } from './game/systems';
import { disposeRenderResources } from './render/renderer';
import type { GameState } from './sim/state';

/** Object names the boot scene exposes, so tests and tooling can address it. */
export const BOOT_SCENE_NAMES = {
  root: 'boot-scene',
  plate: 'factory-floor-plate',
  grid: 'factory-floor-grid',
  subgrid: 'factory-floor-subgrid',
  rings: 'factory-floor-holo-rings',
  emitter: 'factory-floor-emitter',
  column: 'factory-floor-holo-column',
  pillars: 'factory-floor-pillars',
  lights: 'factory-floor-lights',
} as const;

/** Footprint of the factory floor in world units. */
export const FLOOR_SIZE = 96;
/** Number of cells across the main floor grid. */
export const FLOOR_DIVISIONS = 48;

export interface BootSceneOptions {
  /** Camera the scene gently orbits. Omit to keep the camera untouched. */
  camera?: PerspectiveCamera;
}

export interface BootSceneHandle {
  readonly root: Group;
  readonly floorSize: number;
  readonly gridDivisions: number;
  readonly disposed: boolean;
  /** Animate the hologram for a given simulated time. Draw-time only. */
  update(elapsedMs: number): void;
  dispose(): void;
}

/**
 * Build the empty holographic factory floor under `target`.
 *
 * The floor is deliberately empty: no tasks, no comets, no gates. It is the
 * canvas later systems populate, and it renders with zero external assets
 * (no textures, models or fonts).
 */
export function createBootScene(target: Object3D, options: BootSceneOptions = {}): BootSceneHandle {
  const root = new Group();
  root.name = BOOT_SCENE_NAMES.root;
  target.add(root);

  /* ---------------------------------------------------------------- floor */
  const plate = new Mesh(
    new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, 1, 1),
    new MeshStandardMaterial({
      color: 0x070d18,
      metalness: 0.86,
      roughness: 0.3,
    }),
  );
  plate.name = BOOT_SCENE_NAMES.plate;
  plate.rotation.x = -Math.PI / 2;
  root.add(plate);

  const grid = new GridHelper(FLOOR_SIZE, FLOOR_DIVISIONS, 0x35f0ff, 0x0d3346);
  grid.name = BOOT_SCENE_NAMES.grid;
  grid.position.y = 0.04;
  const gridMaterial = grid.material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.4;
  gridMaterial.depthWrite = false;
  root.add(grid);

  const subgrid = new GridHelper(FLOOR_SIZE * 0.36, 12, 0x9ffbff, 0x1ea7c8);
  subgrid.name = BOOT_SCENE_NAMES.subgrid;
  subgrid.position.y = 0.06;
  const subgridMaterial = subgrid.material;
  subgridMaterial.transparent = true;
  subgridMaterial.opacity = 0.26;
  subgridMaterial.depthWrite = false;
  root.add(subgrid);

  /* ---------------------------------------------------- holographic rings */
  const rings = new Group();
  rings.name = BOOT_SCENE_NAMES.rings;
  const ringMeshes: Mesh<RingGeometry, MeshBasicMaterial>[] = [];
  const ringRadii = [7.5, 12.5, 18.5];
  ringRadii.forEach((radius, index) => {
    const material = new MeshBasicMaterial({
      color: index === 1 ? 0x7ff8ff : 0x35f0ff,
      transparent: true,
      opacity: 0.42 - index * 0.08,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const ring = new Mesh(new RingGeometry(radius, radius + 0.08, 192), material);
    ring.name = `${BOOT_SCENE_NAMES.rings}-${index}`;
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08 + index * 0.006;
    rings.add(ring);
    ringMeshes.push(ring);
  });
  root.add(rings);

  /* ------------------------------------------------- emitter and hologram */
  const emitter = new Mesh(
    new CylinderGeometry(3.4, 3.9, 0.5, 64),
    new MeshStandardMaterial({
      color: 0x0b1626,
      metalness: 0.9,
      roughness: 0.22,
      emissive: 0x0d4657,
      emissiveIntensity: 0.6,
    }),
  );
  emitter.name = BOOT_SCENE_NAMES.emitter;
  emitter.position.y = 0.25;
  root.add(emitter);

  const columnMaterial = new MeshBasicMaterial({
    color: 0x35f0ff,
    transparent: true,
    opacity: 0.08,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const column = new Mesh(new CylinderGeometry(2.7, 3.2, 16, 64, 1, true), columnMaterial);
  column.name = BOOT_SCENE_NAMES.column;
  column.position.y = 8.5;
  root.add(column);

  /* --------------------------------------------------------- corner beams */
  const pillars = new Group();
  pillars.name = BOOT_SCENE_NAMES.pillars;
  const pillarMaterial = new MeshBasicMaterial({
    color: 0x6ff4ff,
    transparent: true,
    opacity: 0.12,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const pillarGeometry = new CylinderGeometry(0.32, 0.32, 26, 16, 1, true);
  const pillarReach = FLOOR_SIZE / 2 - 6;
  for (const [x, z] of [
    [pillarReach, pillarReach],
    [-pillarReach, pillarReach],
    [pillarReach, -pillarReach],
    [-pillarReach, -pillarReach],
  ] as const) {
    const pillar = new Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(x, 13, z);
    pillars.add(pillar);
  }
  root.add(pillars);

  /* -------------------------------------------------------------- lighting */
  const lights = new Group();
  lights.name = BOOT_SCENE_NAMES.lights;
  const hemisphere = new HemisphereLight(0x9ff6ff, 0x04070f, 0.55);
  const key = new DirectionalLight(0xbfefff, 1.2);
  key.position.set(16, 24, 12);
  const cyanFill = new PointLight(0x35f0ff, 90, 110, 2);
  cyanFill.position.set(14, 9, -10);
  const magentaFill = new PointLight(0xff4fd8, 60, 90, 2);
  magentaFill.position.set(-16, 7, 14);
  lights.add(hemisphere, key, cyanFill, magentaFill);
  root.add(lights);

  const camera = options.camera ?? null;
  let disposed = false;

  const update = (elapsedMs: number): void => {
    if (disposed) return;
    const seconds = Math.max(0, elapsedMs) / 1000;

    gridMaterial.opacity = 0.36 + Math.sin(seconds * 1.6) * 0.05;
    subgridMaterial.opacity = 0.24 + Math.sin(seconds * 2.3 + 1.2) * 0.05;
    columnMaterial.opacity = 0.07 + Math.sin(seconds * 0.9) * 0.02;
    emitter.position.y = 0.25 + Math.sin(seconds * 0.8) * 0.03;

    ringMeshes.forEach((ring, index) => {
      const direction = index % 2 === 0 ? 1 : -1;
      ring.rotation.z = direction * seconds * (0.07 + index * 0.03);
    });

    if (camera) {
      const angle = 0.62 + Math.sin(seconds * 0.06) * 0.24;
      const radius = 31;
      camera.position.set(
        Math.cos(angle) * radius,
        12 + Math.sin(seconds * 0.11) * 1.4,
        Math.sin(angle) * radius,
      );
      camera.lookAt(0, 2.6, 0);
    }
  };

  // Frame the floor immediately so a first paint (or a headless smoke test)
  // shows the intended composition without waiting for a step.
  update(0);

  return {
    root,
    floorSize: FLOOR_SIZE,
    gridDivisions: FLOOR_DIVISIONS,
    get disposed() {
      return disposed;
    },
    update,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeRenderResources(root);
      root.removeFromParent();
      root.clear();
    },
  };
}

export interface BootOptions {
  /** Host element. Defaults to `#boot`, then `document.body`. */
  host?: HTMLElement;
  adapterKind?: PreviewAdapterPreference;
  seed?: number;
  state?: GameState;
  systems?: readonly GameSystem[];
  autoStart?: boolean;
  /** Render the HUD overlay. Defaults to `true`. */
  overlay?: boolean;
}

/**
 * Whether the served page should boot the human-gated *inspection* arc.
 *
 * `/?guided=1` (or a bare `?guided`) composes mission one with `autoStart` and
 * `autoApprove` off and hands the lifecycle to the inspection rig, so every
 * phase can be held and observed instead of racing past in one 1.4 s arc. The
 * default page keeps the shipped auto-playing arc.
 */
export function wantsGuidedRun(search: string): boolean {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const value = new URLSearchParams(query).get('guided');
  return value === '' || value === '1' || value === 'true';
}

/**
 * Compose the systems the served page boots.
 *
 * The shipped registry plus the inspection rig: the registry itself is
 * untouched (it composes the mission, the world and the interfaces), and the rig
 * only reads them through ports. The served game runs mission one's *own*
 * document — the same state the acceptance suite asserts — so the HUD reports
 * the mission it is actually playing (100% shipped, every gate green at the
 * release) instead of a sample floor with the mission's events merged into it.
 */
export function composeServedGame(guided: boolean): GameSystem[] {
  const bundle = createSystems(guided ? { autoStart: false, autoApprove: false } : {});
  const inspection = createInspectionSystem({
    mission: () => bundle.mission,
    camera: () => bundle.cameraRig.rig,
    audio: () => bundle.audio.bus,
    quality: () => bundle.quality,
    guided,
  });
  return [...bundle.list, inspection];
}

export interface BootResult {
  harness: PreviewHarness;
  scene: BootSceneHandle;
  /** Tear down scene, harness and DOM in one call. */
  dispose(): void;
}

function resolveHost(explicit?: HTMLElement): HTMLElement {
  if (explicit) return explicit;
  const fromDom = document.getElementById('boot');
  if (fromDom) return fromDom;
  if (document.body) return document.body;
  throw new Error('[coroid] no host element available to boot into');
}

/** Mark the shell live and retire the splash copy once the hologram is up. */
function revealShell(host: HTMLElement): void {
  host.classList.add('is-live');
  const status = host.querySelector('#boot-status') ?? document.getElementById('boot-status');
  if (status) status.textContent = 'Hologram online · factory floor idle';
}

/**
 * Boot the game into a host element.
 *
 * Draw order per frame: boot-scene animation → system render hook → adapter
 * present. Nothing here mutates simulation state.
 */
export function bootGame(options: BootOptions = {}): BootResult {
  const host = resolveHost(options.host);
  let scene: BootSceneHandle | null = null;
  let revealed = false;

  const harness = mountGamePreview({
    container: host,
    adapter: options.adapterKind ?? 'auto',
    systems: options.systems,
    state: options.state,
    seed: options.seed,
    overlay: options.overlay,
    autoStart: options.autoStart,
    onFrame: (frame: GameFrame) => {
      scene?.update(frame.elapsedMs);
      if (!revealed) {
        revealed = true;
        revealShell(host);
      }
    },
  });

  scene = createBootScene(harness.adapter.scene, { camera: harness.adapter.camera });

  // Boot scene framing is applied above; redraw once so the first painted frame
  // already includes the floor even when playback is not started yet.
  if (options.autoStart === false) {
    harness.game.render();
  }

  const bootScene = scene;
  return {
    harness,
    scene: bootScene,
    dispose(): void {
      bootScene.dispose();
      harness.dispose();
    },
  };
}

function autoboot(): void {
  if (typeof document === 'undefined') return;
  const host = document.getElementById('boot');
  if (!host || host.dataset.coroidBooted === 'true') return;
  host.dataset.coroidBooted = 'true';
  try {
    const guided = typeof window === 'undefined' ? false : wantsGuidedRun(window.location.search);
    bootGame({
      host,
      state: createMissionInitialState(),
      systems: composeServedGame(guided),
    });
  } catch (error) {
    console.error('[coroid] failed to boot the factory floor', error);
    const status = document.getElementById('boot-status');
    if (status) {
      status.textContent = 'Hologram offline — this browser could not provide a renderer.';
    }
  }
}

autoboot();
