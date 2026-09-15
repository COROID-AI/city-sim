/**
 * SceneKernel — the runtime every café module is driven by.
 *
 * Responsibilities:
 *  - boot a three.js renderer into a container element, or fall back to a
 *    headless scene graph when the browser cannot produce a WebGL context,
 *  - own the scene, the composition root (`world`) and the camera rig,
 *  - drive a delta-timed frame loop through an injectable scheduler so the loop
 *    can also be stepped deterministically from tests,
 *  - keep the camera and viewport in sync with the container size and the
 *    window `resize` event,
 *  - release renderer resources, scene resources and DOM listeners on dispose.
 *
 * The kernel deliberately knows nothing about the five eras beyond remembering
 * which year is currently displayed; period data and module composition belong
 * to the period registry and the app composition layer.
 */

import * as THREE from 'three';
import {
  DEFAULT_ROOM_BOUNDS,
  DEFAULT_YEAR_ID,
  yearToNumber,
  type BuildContext,
  type PeriodDefinition,
  type RoomBounds,
  type YearId,
} from '../contracts/period';

/** Removes a previously registered listener. Safe to call more than once. */
export type Unsubscribe = () => void;

/** Plain numeric triple, accepted anywhere a position is read. */
export interface VectorLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/* -------------------------------------------------------------------------- */
/* Frame scheduling                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Frame source used by the render loop. Injecting it lets tests run the loop
 * without a browser (`createManualFrameScheduler`) while the browser uses
 * `requestAnimationFrame`.
 */
export interface FrameScheduler {
  /** Monotonic time source in milliseconds. */
  now(): number;
  /** Schedule `callback` for the next frame and return its handle. */
  request(callback: (timeMs: number) => void): number;
  /** Cancel a handle returned by {@link FrameScheduler.request}. */
  cancel(handle: number): void;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** `setTimeout` based frame source, used when `requestAnimationFrame` is absent. */
export function createTimeoutScheduler(frameMs = 1000 / 60): FrameScheduler {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextHandle = 1;
  return {
    now: defaultNow,
    request(callback: (timeMs: number) => void): number {
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(
        handle,
        setTimeout(() => {
          timers.delete(handle);
          callback(defaultNow());
        }, frameMs),
      );
      return handle;
    },
    cancel(handle: number): void {
      const timer = timers.get(handle);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(handle);
      }
    },
  };
}

/** `requestAnimationFrame` frame source, falling back to timers off-DOM. */
export function createAnimationFrameScheduler(): FrameScheduler {
  const scope = globalThis as typeof globalThis & {
    requestAnimationFrame?: (callback: (timeMs: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  const request = scope.requestAnimationFrame;
  const cancel = scope.cancelAnimationFrame;
  if (typeof request === 'function' && typeof cancel === 'function') {
    return {
      now: defaultNow,
      request: (callback) => request.call(scope, callback),
      cancel: (handle) => cancel.call(scope, handle),
    };
  }
  return createTimeoutScheduler();
}

/** Frame source a test can advance by hand, without timers or a browser. */
export interface ManualFrameScheduler extends FrameScheduler {
  /** Move the clock forward without running callbacks. */
  advance(milliseconds: number): number;
  /** Advance the clock (optional) and run every callback scheduled so far. */
  tick(milliseconds?: number): number;
  /** Number of callbacks waiting to run. */
  readonly pending: number;
  /** Current clock value in milliseconds. */
  readonly time: number;
}

/** Creates a deterministic {@link FrameScheduler} for tests. */
export function createManualFrameScheduler(startTimeMs = 0): ManualFrameScheduler {
  let time = startTimeMs;
  let nextHandle = 1;
  const callbacks = new Map<number, (timeMs: number) => void>();
  return {
    now: () => time,
    request(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      callbacks.delete(handle);
    },
    advance(milliseconds) {
      time += milliseconds;
      return time;
    },
    tick(milliseconds = 0) {
      time += milliseconds;
      const due = [...callbacks.entries()];
      let ran = 0;
      for (const [handle, callback] of due) {
        if (!callbacks.delete(handle)) continue;
        ran += 1;
        callback(time);
      }
      return ran;
    },
    get pending() {
      return callbacks.size;
    },
    get time() {
      return time;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* WebGL capability probe                                                     */
/* -------------------------------------------------------------------------- */

export type WebGLBackend = 'webgl2' | 'webgl' | 'none';

export interface WebGLProbeResult {
  /** Whether a WebGL context could be created. */
  readonly supported: boolean;
  /** Which context was obtained. */
  readonly backend: WebGLBackend;
  /** Human readable explanation, surfaced in headless fallbacks. */
  readonly reason: string;
}

function defaultCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  try {
    return document.createElement('canvas');
  } catch {
    return null;
  }
}

/**
 * Probes for a GPU backed context. When no context can be created — no DOM at
 * all, a canvas that refuses `getContext`, or a context that throws — the
 * kernel keeps running on a plain scene graph so scene composition can still be
 * asserted headlessly (and in vitest) without a GPU.
 */
export function probeWebGLCapabilities(
  createCanvas: () => HTMLCanvasElement | null = defaultCanvas,
): WebGLProbeResult {
  let canvas: HTMLCanvasElement | null;
  try {
    canvas = createCanvas();
  } catch (error) {
    return {
      supported: false,
      backend: 'none',
      reason: `Canvas creation failed: ${describeError(error)}`,
    };
  }
  if (canvas === null) {
    return {
      supported: false,
      backend: 'none',
      reason: 'No DOM canvas available (headless environment).',
    };
  }
  if (typeof canvas.getContext !== 'function') {
    return {
      supported: false,
      backend: 'none',
      reason: 'Canvas element does not implement getContext (headless environment).',
    };
  }
  const attributes: WebGLContextAttributes = { failIfMajorPerformanceCaveat: false };
  try {
    const webgl2 = canvas.getContext('webgl2', attributes);
    if (webgl2) {
      return { supported: true, backend: 'webgl2', reason: 'WebGL2 context created.' };
    }
    const webgl1 = canvas.getContext('webgl', attributes);
    if (webgl1) {
      return { supported: true, backend: 'webgl', reason: 'WebGL context created.' };
    }
    return {
      supported: false,
      backend: 'none',
      reason: 'Canvas refused to create a WebGL context.',
    };
  } catch (error) {
    return {
      supported: false,
      backend: 'none',
      reason: `WebGL probe failed: ${describeError(error)}`,
    };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportError(scope: string, error: unknown): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(`[cafe-kernel] ${scope}`, error);
  }
}

/* -------------------------------------------------------------------------- */
/* Camera rig                                                                 */
/* -------------------------------------------------------------------------- */

export interface CameraView {
  readonly position: VectorLike;
  readonly target: VectorLike;
  readonly fov?: number;
}

/**
 * The camera rig keeps a perspective camera aimed at a target, easing between
 * views so timeline transitions and view presets never snap.
 */
export interface CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Current (eased) camera position. */
  readonly position: THREE.Vector3;
  /** Current (eased) look-at point. */
  readonly target: THREE.Vector3;
  /** View the rig is easing towards. */
  readonly desiredPosition: THREE.Vector3;
  /** Look-at point the rig is easing towards. */
  readonly desiredTarget: THREE.Vector3;
  /** Aim the rig at `view`; `immediate` snaps instead of easing. */
  view(view: CameraView, immediate?: boolean): void;
  /** Frame the room from the default interior viewpoint. */
  reset(bounds?: RoomBounds, immediate?: boolean): void;
  /** Update the projection for a new viewport aspect ratio. */
  setAspect(aspect: number): void;
  /** Ease the camera one step towards the desired view. */
  update(deltaSeconds: number): void;
  /** Release the rig; further calls become no-ops. */
  dispose(): void;
}

export interface CameraRigOptions {
  readonly bounds?: RoomBounds;
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
  readonly aspect?: number;
  /** Exponential damping rate per second used by {@link CameraRig.update}. */
  readonly damping?: number;
}

/** Default viewpoint: standing near the entrance, looking down the room. */
export function defaultInteriorView(bounds: RoomBounds): CameraView {
  return {
    position: { x: 0, y: Math.min(1.62, bounds.height * 0.5), z: bounds.depth / 2 - 0.6 },
    target: { x: 0, y: Math.min(1.3, bounds.height * 0.4), z: -bounds.depth / 2 + 0.4 },
    fov: 58,
  };
}

/** Builds the camera rig used by the kernel (and reusable by later camera work). */
export function createCameraRig(options: CameraRigOptions = {}): CameraRig {
  const bounds = options.bounds ?? DEFAULT_ROOM_BOUNDS;
  const camera = new THREE.PerspectiveCamera(
    options.fov ?? 58,
    options.aspect ?? 16 / 9,
    options.near ?? 0.1,
    options.far ?? 200,
  );
  const damping = Math.max(options.damping ?? 6, 0);
  const target = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  let disposed = false;

  const rig: CameraRig = {
    camera,
    get position() {
      return camera.position;
    },
    target,
    desiredPosition,
    desiredTarget,
    view(view, immediate = false) {
      if (disposed) return;
      desiredPosition.set(view.position.x, view.position.y, view.position.z);
      desiredTarget.set(view.target.x, view.target.y, view.target.z);
      if (view.fov !== undefined && view.fov !== camera.fov) {
        camera.fov = view.fov;
        camera.updateProjectionMatrix();
      }
      if (immediate) {
        camera.position.copy(desiredPosition);
        target.copy(desiredTarget);
        camera.lookAt(target);
      }
    },
    reset(nextBounds = bounds, immediate = false) {
      rig.view(defaultInteriorView(nextBounds), immediate);
    },
    setAspect(aspect) {
      if (disposed) return;
      if (!Number.isFinite(aspect) || aspect <= 0) return;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    update(deltaSeconds) {
      if (disposed) return;
      const step = Math.max(deltaSeconds, 0);
      const alpha = damping <= 0 ? 1 : 1 - Math.exp(-damping * step);
      camera.position.lerp(desiredPosition, alpha);
      target.lerp(desiredTarget, alpha);
      if (camera.position.distanceToSquared(desiredPosition) < 1e-10) {
        camera.position.copy(desiredPosition);
      }
      if (target.distanceToSquared(desiredTarget) < 1e-10) {
        target.copy(desiredTarget);
      }
      camera.lookAt(target);
    },
    dispose() {
      disposed = true;
    },
  };

  rig.view(defaultInteriorView(bounds), true);
  return rig;
}

/* -------------------------------------------------------------------------- */
/* Scene graph disposal                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Releases every geometry, material and texture owned by `root`'s sub tree and
 * detaches `root` from its parent. Used by `kernel.dispose()` and by modules
 * that rebuild their own content.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (renderable.geometry) geometries.add(renderable.geometry);
    const material = renderable.material;
    if (Array.isArray(material)) {
      for (const entry of material) materials.add(entry);
    } else if (material) {
      materials.add(material);
    }
  });

  for (const material of materials) {
    for (const value of Object.values(material as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  }
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();

  if (root.parent) root.parent.remove(root);
  root.clear();
}

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                   */
/* -------------------------------------------------------------------------- */

/** Small, fast, seedable PRNG (mulberry32) returning values in `[0, 1)`. */
export function createSeededRandom(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/* Kernel                                                                     */
/* -------------------------------------------------------------------------- */

export interface KernelSize {
  readonly width: number;
  readonly height: number;
}

export interface KernelResize extends KernelSize {
  readonly aspect: number;
  readonly pixelRatio: number;
}

/** Information handed to frame listeners once per step. */
export interface KernelFrame {
  /** Seconds advanced by this step. */
  readonly deltaSeconds: number;
  /** Seconds simulated since the kernel started. */
  readonly elapsedSeconds: number;
  /** Monotonic frame counter. */
  readonly frame: number;
  /** Era currently displayed. */
  readonly year: YearId;
}

export interface KernelListenerStats {
  readonly frame: number;
  readonly resize: number;
  readonly dispose: number;
  /** DOM listeners the kernel attached (viewport resize, container observer). */
  readonly dom: number;
}

export interface BuildContextOptions {
  /** Node the module attaches its objects to. Defaults to the kernel's `world`. */
  readonly root?: THREE.Object3D;
  /** Custom random source, replacing the seeded per-era source. */
  readonly random?: () => number;
  /** Shared services handed to the modules for this era. */
  readonly services?: Readonly<Record<string, unknown>>;
}

export interface KernelOptions {
  /** Element the canvas is appended to. `null` boots without a canvas. */
  readonly container?: HTMLElement | null;
  /** Room the café is laid out in. */
  readonly bounds?: RoomBounds;
  /** Scene clear colour. */
  readonly background?: THREE.ColorRepresentation;
  /** Era reported through `KernelFrame` and build contexts. */
  readonly initialYear?: YearId;
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
  readonly cameraDamping?: number;
  readonly pixelRatio?: number;
  readonly antialias?: boolean;
  readonly shadows?: boolean;
  /** Skip the WebGL probe and run purely on the scene graph. */
  readonly forceHeadless?: boolean;
  /** Attach DOM resize listeners and observer. Defaults to `true`. */
  readonly autoResize?: boolean;
  /** Start the frame loop immediately. Defaults to `false`. */
  readonly autoStart?: boolean;
  /** Frame source for the render loop. Defaults to `requestAnimationFrame`. */
  readonly scheduler?: FrameScheduler;
  /** Event target reporting viewport changes. Defaults to `window`. */
  readonly resizeTarget?: EventTarget | null;
  /** Custom viewport measurement, replacing container/window measurement. */
  readonly measureViewport?: () => KernelSize;
  /** Custom WebGL capability probe, mainly for tests. */
  readonly probe?: () => WebGLProbeResult;
  /** Upper bound applied to a single loop delta (tab switches). Defaults to 0.1s. */
  readonly maxDeltaSeconds?: number;
  /** Seed of the per-era deterministic random source. Defaults to `0xcafe`. */
  readonly seed?: number;
  /** Fallback viewport width when nothing can be measured. Defaults to 1280. */
  readonly width?: number;
  /** Fallback viewport height when nothing can be measured. Defaults to 720. */
  readonly height?: number;
}

/**
 * The running scene runtime. Obtain one with {@link createKernel}; it owns the
 * scene, the camera rig and the frame loop until {@link Kernel.dispose} is
 * called.
 */
export interface Kernel {
  readonly scene: THREE.Scene;
  /** Composition root: every domain module attaches its objects here. */
  readonly world: THREE.Group;
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraRig: CameraRig;
  /** WebGL renderer, or `null` when running headless. */
  readonly renderer: THREE.WebGLRenderer | null;
  readonly canvas: HTMLCanvasElement | null;
  readonly container: HTMLElement | null;
  readonly capabilities: WebGLProbeResult;
  /** True when no GPU backed renderer is in use. */
  readonly headless: boolean;
  readonly bounds: RoomBounds;
  readonly year: YearId;
  /** Frames advanced so far. */
  readonly frame: number;
  /** Seconds simulated so far. */
  readonly elapsedSeconds: number;
  readonly isRunning: boolean;
  readonly isDisposed: boolean;
  /** Total listeners currently registered (frame + resize + dispose + DOM). */
  readonly listenerCount: number;
  /** Start the frame loop. Throws when the kernel has been disposed. */
  start(): void;
  /** Stop the frame loop (the kernel stays usable). */
  stop(): void;
  /** Advance simulation and render one step with an explicit delta. */
  update(deltaSeconds: number): void;
  /** Advance one step using the scheduler clock; returns the delta in seconds. */
  step(): number;
  /** Render the current scene (no-op without a renderer). */
  render(): void;
  /** Re-measure the viewport (or apply an explicit size) and notify listeners. */
  resize(width?: number, height?: number): void;
  getSize(): KernelSize;
  /** Set the era reported through frame listeners and build contexts. */
  setYear(year: YearId): void;
  getListenerStats(): KernelListenerStats;
  /** Build the shared context a {@link SceneModule} is built/applied with. */
  createBuildContext(period: PeriodDefinition, options?: BuildContextOptions): BuildContext;
  onFrame(listener: (frame: KernelFrame) => void): Unsubscribe;
  onResize(listener: (resize: KernelResize) => void): Unsubscribe;
  onDispose(listener: () => void): Unsubscribe;
  dispose(): void;
}

const FALLBACK_VIEWPORT: KernelSize = { width: 1280, height: 720 };

function sanitizeSize(size: KernelSize): KernelSize {
  return {
    width: Math.max(1, Math.round(Number.isFinite(size.width) ? size.width : FALLBACK_VIEWPORT.width)),
    height: Math.max(1, Math.round(Number.isFinite(size.height) ? size.height : FALLBACK_VIEWPORT.height)),
  };
}

function listenerRemover<T>(listeners: Set<T>, listener: T): Unsubscribe {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function defaultResizeTarget(): EventTarget | null {
  return typeof window === 'undefined' ? null : window;
}

function defaultPixelRatio(): number {
  return typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
    ? Math.min(Math.max(window.devicePixelRatio, 1), 2)
    : 1;
}

/**
 * Creates the scene runtime.
 *
 * @param container element the canvas is appended to (`null` for headless boots)
 * @param options kernel configuration, see {@link KernelOptions}
 */
export function createKernel(
  container: HTMLElement | null = null,
  options: KernelOptions = {},
): Kernel {
  const scheduler = options.scheduler ?? createAnimationFrameScheduler();
  const bounds = options.bounds ?? DEFAULT_ROOM_BOUNDS;
  const resizeTarget = options.resizeTarget !== undefined ? options.resizeTarget : defaultResizeTarget();
  const autoResize = options.autoResize ?? true;
  const maxDeltaSeconds = Math.max(options.maxDeltaSeconds ?? 0.1, 0);
  const pixelRatio = options.pixelRatio ?? defaultPixelRatio();
  const seed = options.seed ?? 0xcafe;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(options.background ?? 0x14100c);

  const world = new THREE.Group();
  world.name = 'world';
  scene.add(world);

  /* -- capability probe / renderer bootstrap ------------------------------- */

  let capabilities: WebGLProbeResult =
    options.forceHeadless === true
      ? { supported: false, backend: 'none', reason: 'Headless mode requested by the caller.' }
      : (options.probe ?? (() => probeWebGLCapabilities()))();

  let canvas: HTMLCanvasElement | null = null;
  let renderer: THREE.WebGLRenderer | null = null;

  if (capabilities.supported) {
    try {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        throw new Error('no DOM available');
      }
      const element = document.createElement('canvas');
      const gl = new THREE.WebGLRenderer({
        canvas: element,
        antialias: options.antialias ?? true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      gl.setPixelRatio(pixelRatio);
      gl.outputColorSpace = THREE.SRGBColorSpace;
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 1.05;
      if (options.shadows ?? true) {
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = THREE.PCFShadowMap;
      }
      if (container) {
        element.style.display = 'block';
        element.style.width = '100%';
        element.style.height = '100%';
        container.appendChild(element);
      }
      canvas = element;
      renderer = gl;
    } catch (error) {
      capabilities = {
        supported: false,
        backend: 'none',
        reason: `WebGL renderer could not be created, continuing headless: ${describeError(error)}`,
      };
      canvas = null;
      renderer = null;
    }
  }

  const cameraRig = createCameraRig({
    bounds,
    fov: options.fov,
    near: options.near,
    far: options.far,
    aspect: FALLBACK_VIEWPORT.width / FALLBACK_VIEWPORT.height,
    damping: options.cameraDamping,
  });
  const camera = cameraRig.camera;
  scene.add(camera);

  /* -- viewport ------------------------------------------------------------ */

  let size: KernelSize = { ...FALLBACK_VIEWPORT };

  const measure = (): KernelSize => {
    if (options.measureViewport) return sanitizeSize(options.measureViewport());
    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
      return sanitizeSize({ width: container.clientWidth, height: container.clientHeight });
    }
    const target = resizeTarget as (EventTarget & { innerWidth?: number; innerHeight?: number }) | null;
    const viewport = typeof window !== 'undefined' ? window : null;
    const width =
      options.width ?? target?.innerWidth ?? viewport?.innerWidth ?? size.width ?? FALLBACK_VIEWPORT.width;
    const height =
      options.height ?? target?.innerHeight ?? viewport?.innerHeight ?? size.height ?? FALLBACK_VIEWPORT.height;
    return sanitizeSize({ width, height });
  };

  /* -- listeners ----------------------------------------------------------- */

  const frameListeners = new Set<(frame: KernelFrame) => void>();
  const resizeListeners = new Set<(resize: KernelResize) => void>();
  const disposeListeners = new Set<() => void>();
  let domListenerCount = 0;

  /* -- state --------------------------------------------------------------- */

  let year: YearId = options.initialYear ?? DEFAULT_YEAR_ID;
  let running = false;
  let disposed = false;
  let frameHandle: number | null = null;
  let lastTimeMs: number | null = scheduler.now();
  let frameCount = 0;
  let elapsedSeconds = 0;

  /* -- rendering ----------------------------------------------------------- */

  const render = (): void => {
    if (disposed) return;
    if (renderer) {
      renderer.render(scene, camera);
    } else {
      scene.updateMatrixWorld(true);
    }
  };

  const update = (deltaSeconds: number): void => {
    if (disposed) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
    elapsedSeconds += delta;
    frameCount += 1;
    cameraRig.update(delta);
    scene.updateMatrixWorld(true);
    const frame: KernelFrame = { deltaSeconds: delta, elapsedSeconds, frame: frameCount, year };
    for (const listener of [...frameListeners]) {
      try {
        listener(frame);
      } catch (error) {
        reportError('frame listener failed', error);
      }
    }
    render();
  };

  const step = (): number => {
    if (disposed) return 0;
    const now = scheduler.now();
    const previous = lastTimeMs ?? now;
    lastTimeMs = now;
    const delta = Math.max(now - previous, 0) / 1000;
    update(delta);
    return delta;
  };

  const handleFrame = (timeMs: number): void => {
    frameHandle = null;
    if (disposed || !running) return;
    const previous = lastTimeMs ?? timeMs;
    lastTimeMs = timeMs;
    const delta = Math.min(Math.max(timeMs - previous, 0) / 1000, maxDeltaSeconds);
    update(delta);
    if (running && !disposed) {
      frameHandle = scheduler.request(handleFrame);
    }
  };

  const resize = (width?: number, height?: number): void => {
    if (disposed) return;
    const measured = measure();
    size = sanitizeSize({
      width: width ?? measured.width,
      height: height ?? measured.height,
    });
    const aspect = size.width / size.height;
    cameraRig.setAspect(aspect);
    if (renderer) {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(size.width, size.height, false);
    }
    const info: KernelResize = { width: size.width, height: size.height, aspect, pixelRatio };
    for (const listener of [...resizeListeners]) {
      try {
        listener(info);
      } catch (error) {
        reportError('resize listener failed', error);
      }
    }
  };

  const handleViewportResize = (): void => {
    resize();
  };

  let observer: ResizeObserver | null = null;
  if (autoResize && resizeTarget) {
    resizeTarget.addEventListener('resize', handleViewportResize);
    domListenerCount += 1;
  }
  if (autoResize && container && typeof ResizeObserver !== 'undefined') {
    try {
      observer = new ResizeObserver(handleViewportResize);
      observer.observe(container);
      domListenerCount += 1;
    } catch (error) {
      observer = null;
      reportError('container observer could not be attached', error);
    }
  }

  /* -- lifecycle ----------------------------------------------------------- */

  const start = (): void => {
    if (disposed) {
      throw new Error('SceneKernel has been disposed and cannot be restarted.');
    }
    if (running) return;
    running = true;
    lastTimeMs = scheduler.now();
    frameHandle = scheduler.request(handleFrame);
  };

  const stop = (): void => {
    running = false;
    if (frameHandle !== null) {
      scheduler.cancel(frameHandle);
      frameHandle = null;
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    running = false;
    if (frameHandle !== null) {
      scheduler.cancel(frameHandle);
      frameHandle = null;
    }
    if (resizeTarget) {
      resizeTarget.removeEventListener('resize', handleViewportResize);
      domListenerCount = Math.max(domListenerCount - 1, 0);
    }
    if (observer) {
      observer.disconnect();
      observer = null;
      domListenerCount = Math.max(domListenerCount - 1, 0);
    }
    for (const listener of [...disposeListeners]) {
      try {
        listener();
      } catch (error) {
        reportError('dispose listener failed', error);
      }
    }
    frameListeners.clear();
    resizeListeners.clear();
    disposeListeners.clear();

    // Composition content first (modules own their resources), then whatever is
    // left in the scene (camera, helpers).
    disposeObject3D(world);
    disposeObject3D(scene);
    if (renderer) {
      const target = renderer.domElement;
      if (canvas && container && target.parentNode === container) {
        container.removeChild(target);
      }
      renderer.dispose();
      if (typeof renderer.forceContextLoss === 'function') {
        renderer.forceContextLoss();
      }
      renderer = null;
      canvas = null;
    }
    scene.remove(camera);
    cameraRig.dispose();
  };

  const kernel: Kernel = {
    scene,
    world,
    camera,
    cameraRig,
    get renderer() {
      return renderer;
    },
    get canvas() {
      return canvas;
    },
    container,
    get capabilities() {
      return capabilities;
    },
    get headless() {
      return renderer === null;
    },
    bounds,
    get year() {
      return year;
    },
    get frame() {
      return frameCount;
    },
    get elapsedSeconds() {
      return elapsedSeconds;
    },
    get isRunning() {
      return running;
    },
    get isDisposed() {
      return disposed;
    },
    get listenerCount() {
      return frameListeners.size + resizeListeners.size + disposeListeners.size + domListenerCount;
    },
    start,
    stop,
    update,
    step,
    render,
    resize,
    getSize: () => ({ ...size }),
    setYear: (next: YearId) => {
      year = next;
    },
    getListenerStats: () => ({
      frame: frameListeners.size,
      resize: resizeListeners.size,
      dispose: disposeListeners.size,
      dom: domListenerCount,
    }),
    createBuildContext: (period: PeriodDefinition, contextOptions: BuildContextOptions = {}) => ({
      scene,
      root: contextOptions.root ?? world,
      camera,
      bounds,
      year: period.year,
      period,
      random: contextOptions.random ?? createSeededRandom(seed + yearToNumber(period.year)),
      services: contextOptions.services,
    }),
    onFrame: (listener) => listenerRemover(frameListeners, listener),
    onResize: (listener) => listenerRemover(resizeListeners, listener),
    onDispose: (listener) => listenerRemover(disposeListeners, listener),
    dispose,
  };

  resize();
  if (options.autoStart) start();
  return kernel;
}
