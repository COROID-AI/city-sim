/**
 * Chrono City — shared scene context and application shell.
 *
 * The scene context owns everything a system needs in order to draw into the
 * city block: the WebGL renderer, the root scene and camera, a `THREE.Clock`,
 * the deterministic random source, the HUD overlay root, and the system tick
 * registry that dispatches every registered system once per animation frame.
 * It also owns viewport handling, so a resize updates both the renderer and the
 * camera projection before the next frame.
 *
 * Lifecycle:
 *   create    → `createSceneContext()` / `new SceneContext()` builds the shell.
 *   consume   → systems call `registerSystem()`, read `random` / `scene` /
 *               `camera` / `overlayRoot`, and `dispose()` when they tear down.
 *   integrate → `createSceneContextApp()` + `integrateSceneContextGlobal()`
 *               publish the live handle on `window.__chronoCity`.
 *
 * The renderer is injectable (`createRenderer`) so headless tests can exercise
 * the tick registry, resize handling and overlay wiring without a GPU.
 */

import * as THREE from 'three';

export const SCENE_CONTEXT_VERSION = 1;

/** Fixed seed shared by the whole app: identical runs, comparable screenshots. */
export const DEFAULT_SEED = 20250101;

/** Global key the live app handle is published on. */
export const CHRONO_CITY_GLOBAL_KEY = '__chronoCity';

/** Neutral base colour behind the block until era systems paint the sky. */
export const SCENE_BACKGROUND_COLOR = 0x070b14;

export const DEFAULT_FOV = 55;
export const DEFAULT_NEAR = 0.1;
export const DEFAULT_FAR = 4000;
export const DEFAULT_CAMERA_POSITION: readonly [number, number, number] = [0, 60, 120];

/* ------------------------------------------------------------------------- *
 * Deterministic random source
 * ------------------------------------------------------------------------- */

/** Draws the deterministic pseudo-random values every procedural system shares. */
export interface RandomSource {
  /** Seed the stream was created from. */
  readonly seed: number;
  /** Next float in `[0, 1)`. */
  next(): number;
  /** Next float in `[min, max)`. */
  float(min?: number, max?: number): number;
  /** Next integer in `[min, max]`, inclusive. */
  int(min: number, max: number): number;
  /** `true` with the given probability. */
  bool(probability?: number): boolean;
  /** Uniform pick; throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** Deterministic copy-shuffle of the input. */
  shuffle<T>(items: readonly T[]): T[];
  /** Independent, label-derived sub-stream (stable for a given stream state). */
  fork(label: string): SeededRandom;
  /** Rewind the stream, optionally to another seed. */
  reset(seed?: number): void;
}

function hashSeed(seed: number): number {
  let value = seed >>> 0;
  value = Math.imul(value ^ (value >>> 16), 2246822507);
  value = Math.imul(value ^ (value >>> 13), 3266489909);
  value = (value ^ (value >>> 16)) >>> 0;
  return value === 0 ? 0x9e3779b9 : value;
}

function hashLabel(label: string): number {
  let value = 2166136261 >>> 0; // FNV-1a
  for (let index = 0; index < label.length; index += 1) {
    value ^= label.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return hashSeed(value);
}

/**
 * mulberry32 PRNG. Small, fast and fully deterministic for a given seed, which
 * is what keeps procedural city generation screenshot-comparable.
 */
export class SeededRandom implements RandomSource {
  readonly seed: number;
  private state: number;

  constructor(seed: number = DEFAULT_SEED) {
    this.seed = Math.trunc(seed) >>> 0;
    this.state = hashSeed(this.seed);
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value = (value ^ (value + Math.imul(value ^ (value >>> 7), value | 61))) >>> 0;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  float(min = 0, max = 1): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    const low = Math.ceil(Math.min(min, max));
    const high = Math.floor(Math.max(min, max));
    if (high < low) return low;
    return low + Math.floor(this.next() * (high - low + 1));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('SeededRandom.pick() needs a non-empty list');
    }
    return items[this.int(0, items.length - 1)] as T;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let index = out.length - 1; index > 0; index -= 1) {
      const swap = this.int(0, index);
      const held = out[index] as T;
      out[index] = out[swap] as T;
      out[swap] = held;
    }
    return out;
  }

  fork(label: string): SeededRandom {
    return new SeededRandom(hashSeed(this.state ^ hashLabel(label)));
  }

  reset(seed: number = this.seed): void {
    this.state = hashSeed(Math.trunc(seed) >>> 0);
  }
}

/** Creates the shared deterministic random source. */
export function createSeededRng(seed: number = DEFAULT_SEED): SeededRandom {
  return new SeededRandom(seed);
}

/* ------------------------------------------------------------------------- *
 * Scene clock
 * ------------------------------------------------------------------------- */

/**
 * Frame clock for the shared context.
 *
 * Three's `Clock` is deprecated in favour of `Timer`, which is what this wraps:
 * it keeps the familiar `getDelta()` / `getElapsedTime()` surface every system
 * expects, never returns a huge delta after the tab was hidden, and can be
 * connected to the document for Page Visibility handling.
 */
export class SceneClock {
  private timer: THREE.Timer;
  private runningState = false;

  constructor(autoStart = true) {
    this.timer = new THREE.Timer();
    if (autoStart) this.start();
  }

  /** `true` between `start()` and `stop()`. */
  get running(): boolean {
    return this.runningState;
  }

  /** Seconds accumulated while running. */
  get elapsedTime(): number {
    return this.timer.getElapsed();
  }

  /** Enables the Page Visibility API when a document is available. */
  connect(documentRef: Document | null): this {
    if (documentRef) this.timer.connect(documentRef);
    return this;
  }

  /** Starts (or restarts) timing. */
  start(): this {
    this.runningState = true;
    this.timer.reset();
    return this;
  }

  /** Stops timing; `getDelta()` returns `0` until the next `start()`. */
  stop(): this {
    this.runningState = false;
    return this;
  }

  /** Restarts the elapsed-time origin. */
  reset(): this {
    this.timer = new THREE.Timer();
    return this;
  }

  /** Seconds since the previous `getDelta()` call (`0` while stopped). */
  getDelta(): number {
    this.timer.update();
    return this.runningState ? this.timer.getDelta() : 0;
  }

  /** Seconds accumulated while running. */
  getElapsedTime(): number {
    return this.timer.getElapsed();
  }

  /** Releases the visibility listener held by the underlying timer. */
  dispose(): void {
    this.timer.dispose();
  }
}

/* ------------------------------------------------------------------------- *
 * Frame and system contracts
 * ------------------------------------------------------------------------- */

/** Per-frame timing handed to every registered system. */
export interface FrameInfo {
  /** Zero-based frame index since the context was created. */
  readonly frame: number;
  /** Seconds since the previous frame (`0` for the very first frame). */
  readonly delta: number;
  /** Seconds since the first frame, this frame included. */
  readonly elapsed: number;
  /** Wall-clock timestamp (ms) of this frame. */
  readonly timeMs: number;
}

/** A system tick: one call per frame while registered and enabled. */
export type SystemTickFn = (context: SceneContext, frame: FrameInfo) => void;

export interface RegisterSystemOptions {
  /** Lower runs first; ties keep registration order. Defaults to `0`. */
  readonly order?: number;
  /** Registered-but-paused systems are skipped until enabled. Defaults to `true`. */
  readonly enabled?: boolean;
}

/** Read-only snapshot of a registered system. */
export interface RegisteredSystemInfo {
  readonly id: string;
  readonly order: number;
  readonly enabled: boolean;
  readonly tick: SystemTickFn;
}

/** Handle returned by `registerSystem()`; use it to pause or unregister. */
export interface SystemRegistration {
  readonly id: string;
  readonly order: number;
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

interface SystemEntry {
  readonly id: string;
  readonly order: number;
  enabled: boolean;
  readonly tick: SystemTickFn;
  readonly sequence: number;
}

class SystemHandle implements SystemRegistration {
  private readonly context: SceneContext;
  private readonly entry: SystemEntry;
  private disposed = false;

  constructor(context: SceneContext, entry: SystemEntry) {
    this.context = context;
    this.entry = entry;
  }

  get id(): string {
    return this.entry.id;
  }

  get order(): number {
    return this.entry.order;
  }

  get enabled(): boolean {
    return this.entry.enabled;
  }

  setEnabled(enabled: boolean): void {
    if (!this.disposed) this.entry.enabled = enabled;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.context.unregisterSystem(this.entry.id);
  }
}

/* ------------------------------------------------------------------------- *
 * Scene context
 * ------------------------------------------------------------------------- */

/** Builds the renderer; overridable so headless tests need no WebGL context. */
export type RendererFactory = (canvas: HTMLCanvasElement) => THREE.WebGLRenderer;

export interface SceneContextOptions {
  /** Canvas to draw into. Created and mounted automatically when omitted. */
  canvas?: HTMLCanvasElement;
  /** Element the canvas is mounted into. Defaults to `#app`, then `<body>`. */
  container?: HTMLElement;
  /** HUD root. Defaults to `[data-chrono-overlay]`, then a fresh `<div>`. */
  overlayRoot?: HTMLElement;
  /** Deterministic RNG seed. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /** Upper bound for the device pixel ratio. Defaults to `2`. */
  maxPixelRatio?: number;
  /** Start the animation loop during construction. Defaults to `false`. */
  autoStart?: boolean;
  /** Track window resizes. Defaults to `true` in a DOM environment. */
  autoResize?: boolean;
  /** Enable the shadow map. Defaults to `true`. */
  shadows?: boolean;
  fov?: number;
  near?: number;
  far?: number;
  cameraPosition?: readonly [number, number, number];
  /** Renderer factory override (tests). */
  createRenderer?: RendererFactory;
}

interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

const defaultRendererFactory: RendererFactory = (canvas) =>
  new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });

function resolveContainer(documentRef: Document | null): HTMLElement | null {
  if (!documentRef) return null;
  return documentRef.getElementById('app') ?? documentRef.body ?? null;
}

function resolveOverlayRoot(
  documentRef: Document | null,
  container: HTMLElement | null,
): { root: HTMLElement; owned: boolean } {
  if (!documentRef) {
    throw new Error('SceneContext needs a DOM to create the HUD overlay root.');
  }
  const existing = documentRef.querySelector<HTMLElement>('[data-chrono-overlay]');
  if (existing) return { root: existing, owned: false };

  const root = documentRef.createElement('div');
  root.className = 'chrono-overlay';
  root.setAttribute('data-chrono-overlay', '');
  root.setAttribute('aria-label', 'Chrono City overlay');
  (container ?? documentRef.body).appendChild(root);
  return { root, owned: true };
}

function readDevicePixelRatio(): number {
  return typeof window !== 'undefined' && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * The shared scene context: renderer, stage, camera, clock, RNG, HUD root and
 * the tick registry every system plugs into.
 */
export class SceneContext {
  readonly version = SCENE_CONTEXT_VERSION;

  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly clock: SceneClock;
  readonly random: SeededRandom;
  readonly seed: number;
  readonly overlayRoot: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly startedAt: number;

  private readonly container: HTMLElement | null;
  private readonly ownsCanvas: boolean;
  private readonly ownsOverlayRoot: boolean;
  private readonly tracksResize: boolean;
  private readonly resizeListener: () => void;

  private readonly systems = new Map<string, SystemEntry>();
  private ordered: SystemEntry[] = [];
  private orderDirty = false;
  private sequence = 0;

  private frameIndex = 0;
  private elapsedSeconds = 0;
  private runningState = false;
  private disposedState = false;
  private viewportSize: ViewportSize = { width: 1, height: 1 };

  constructor(options: SceneContextOptions = {}) {
    const documentRef = typeof document === 'undefined' ? null : document;

    this.container = options.container ?? resolveContainer(documentRef);

    const canvas = options.canvas ?? documentRef?.createElement('canvas') ?? null;
    if (!canvas) {
      throw new Error('SceneContext needs a canvas element (no DOM available).');
    }
    this.canvas = canvas;
    this.ownsCanvas = options.canvas === undefined;
    if (this.ownsCanvas && this.container) {
      this.container.appendChild(canvas);
    }
    canvas.classList.add('chrono-canvas');

    const createRenderer = options.createRenderer ?? defaultRendererFactory;
    this.renderer = createRenderer(canvas);

    const maxPixelRatio = options.maxPixelRatio ?? 2;
    this.renderer.setPixelRatio(Math.min(readDevicePixelRatio(), maxPixelRatio));
    this.renderer.shadowMap.enabled = options.shadows ?? true;
    if (this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.scene = new THREE.Scene();
    this.scene.name = 'chrono-city';
    this.scene.background = new THREE.Color(SCENE_BACKGROUND_COLOR);

    this.camera = new THREE.PerspectiveCamera(
      options.fov ?? DEFAULT_FOV,
      1,
      options.near ?? DEFAULT_NEAR,
      options.far ?? DEFAULT_FAR,
    );
    this.camera.name = 'chrono-city-camera';
    const position = options.cameraPosition ?? DEFAULT_CAMERA_POSITION;
    this.camera.position.set(position[0], position[1], position[2]);
    this.camera.lookAt(0, 0, 0);

    this.clock = new SceneClock(true).connect(documentRef);

    this.random = new SeededRandom(options.seed ?? DEFAULT_SEED);
    this.seed = this.random.seed;
    this.startedAt = nowMs();

    const providedOverlayRoot = options.overlayRoot;
    const overlay = providedOverlayRoot
      ? { root: providedOverlayRoot, owned: false }
      : resolveOverlayRoot(documentRef, this.container);
    this.overlayRoot = overlay.root;
    this.ownsOverlayRoot = overlay.owned;

    this.resizeListener = () => {
      this.resize();
    };
    this.tracksResize = options.autoResize ?? typeof window !== 'undefined';
    if (this.tracksResize && typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeListener);
    }

    this.resize();

    if (options.autoStart ?? false) {
      this.start();
    }
  }

  /* ---------------- render loop ---------------- */

  get isRunning(): boolean {
    return this.runningState;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  get frameCount(): number {
    return this.frameIndex;
  }

  get elapsed(): number {
    return this.elapsedSeconds;
  }

  get viewport(): ViewportSize {
    return { width: this.viewportSize.width, height: this.viewportSize.height };
  }

  /** Starts the animation loop (idempotent). */
  start(): void {
    if (this.disposedState) throw new Error('SceneContext has been disposed.');
    if (this.runningState) return;
    this.runningState = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this.animationLoop);
  }

  /** Stops the animation loop (idempotent). Systems stay registered. */
  stop(): void {
    if (!this.runningState) return;
    this.runningState = false;
    this.renderer.setAnimationLoop(null);
  }

  /** Advances one frame: dispatch every enabled system, then draw. */
  private readonly animationLoop = (): void => {
    this.tick(this.clock.getDelta());
    this.render();
  };

  /** Draws the current scene with the current camera. */
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /* ---------------- tick registry ---------------- */

  /** Registers a per-frame system. Ids must be unique. */
  registerSystem(
    id: string,
    tick: SystemTickFn,
    options: RegisterSystemOptions = {},
  ): SystemRegistration {
    if (this.disposedState) throw new Error('SceneContext has been disposed.');
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('registerSystem() requires a non-empty system id.');
    }
    if (typeof tick !== 'function') {
      throw new TypeError(`System "${id}" must be a function.`);
    }
    if (this.systems.has(id)) {
      throw new Error(`System "${id}" is already registered.`);
    }

    const entry: SystemEntry = {
      id,
      order: options.order ?? 0,
      enabled: options.enabled ?? true,
      tick,
      sequence: this.sequence,
    };
    this.sequence += 1;
    this.systems.set(id, entry);
    this.orderDirty = true;
    return new SystemHandle(this, entry);
  }

  /** Unregisters a system by id. Returns `false` when it was not registered. */
  unregisterSystem(id: string): boolean {
    const removed = this.systems.delete(id);
    if (removed) this.orderDirty = true;
    return removed;
  }

  hasSystem(id: string): boolean {
    return this.systems.has(id);
  }

  getSystem(id: string): RegisteredSystemInfo | undefined {
    return this.systems.get(id);
  }

  /** Registered systems in dispatch order. */
  getSystems(): readonly RegisteredSystemInfo[] {
    return this.orderedSystems();
  }

  get systemCount(): number {
    return this.systems.size;
  }

  /** Removes every registered system. */
  clearSystems(): void {
    if (this.systems.size === 0) return;
    this.systems.clear();
    this.orderDirty = true;
  }

  /**
   * Runs one frame: resolves the delta, dispatches every enabled system in
   * order and returns the frame timing handed to them. A throwing system is
   * reported and skipped so one broken system cannot stall the city.
   */
  tick(delta?: number): FrameInfo {
    const resolved = delta ?? this.clock.getDelta();
    const step = Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
    const frame: FrameInfo = {
      frame: this.frameIndex,
      delta: step,
      elapsed: this.elapsedSeconds + step,
      timeMs: nowMs(),
    };
    this.frameIndex += 1;
    this.elapsedSeconds = frame.elapsed;

    for (const entry of this.orderedSystems()) {
      if (!entry.enabled) continue;
      try {
        entry.tick(this, frame);
      } catch (error) {
        console.error(`[chrono-city] system "${entry.id}" failed on frame ${frame.frame}`, error);
      }
    }

    return frame;
  }

  private orderedSystems(): SystemEntry[] {
    if (this.orderDirty) {
      this.ordered = [...this.systems.values()].sort(
        (left, right) => left.order - right.order || left.sequence - right.sequence,
      );
      this.orderDirty = false;
    }
    return this.ordered;
  }

  /* ---------------- viewport ---------------- */

  /** Resizes the renderer and camera. Without arguments the window is measured. */
  resize(width?: number, height?: number): ViewportSize {
    const size = this.measureViewport(width, height);
    this.viewportSize = size;
    this.camera.aspect = size.width / size.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(size.width, size.height, false);
    return size;
  }

  private measureViewport(width?: number, height?: number): ViewportSize {
    let resolvedWidth = width;
    let resolvedHeight = height;

    if (resolvedWidth === undefined || resolvedHeight === undefined) {
      const clientWidth = this.container?.clientWidth ?? 0;
      const clientHeight = this.container?.clientHeight ?? 0;
      const windowWidth = typeof window === 'undefined' ? 0 : window.innerWidth;
      const windowHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
      resolvedWidth = resolvedWidth ?? (clientWidth > 0 ? clientWidth : windowWidth);
      resolvedHeight = resolvedHeight ?? (clientHeight > 0 ? clientHeight : windowHeight);
    }

    return {
      width: Math.max(1, Math.round(resolvedWidth || 1)),
      height: Math.max(1, Math.round(resolvedHeight || 1)),
    };
  }

  /* ---------------- teardown ---------------- */

  /** Stops the loop, releases the renderer and unregisters every system. */
  dispose(): void {
    if (this.disposedState) return;
    this.stop();
    this.disposedState = true;
    this.systems.clear();
    this.orderDirty = true;
    if (this.tracksResize && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeListener);
    }
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.clock.dispose();
    if (this.ownsCanvas) this.canvas.remove();
    if (this.ownsOverlayRoot) this.overlayRoot.remove();
  }
}

/** Creates a scene context (the `create` half of the context lifecycle). */
export function createSceneContext(options: SceneContextOptions = {}): SceneContext {
  return new SceneContext(options);
}

/* ------------------------------------------------------------------------- *
 * Application handle
 * ------------------------------------------------------------------------- */

/** The live app handle published for HUD systems and Playwright harnesses. */
export interface SceneContextApp {
  readonly context: SceneContext;
  readonly seed: number;
  readonly startedAt: number;
  readonly random: SeededRandom;
  readonly overlayRoot: HTMLElement;
  start(): void;
  stop(): void;
  dispose(): void;
}

/** Builds the context plus the stable handle later tasks consume. */
export function createSceneContextApp(options: SceneContextOptions = {}): SceneContextApp {
  const context = new SceneContext(options);
  return {
    context,
    seed: context.seed,
    startedAt: context.startedAt,
    random: context.random,
    overlayRoot: context.overlayRoot,
    start: () => context.start(),
    stop: () => context.stop(),
    dispose: () => context.dispose(),
  };
}

declare global {
  interface Window {
    __chronoCity?: SceneContextApp;
  }
}

/**
 * Publishes the live app handle on `window` and announces it, so browser
 * harnesses can drive the real scene instead of re-creating one.
 */
export function integrateSceneContextGlobal(
  app: SceneContextApp,
  key: string = CHRONO_CITY_GLOBAL_KEY,
): SceneContextApp {
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[key] = app;
    if (typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('chrono-city:ready', { detail: app }));
    }
  }
  return app;
}
