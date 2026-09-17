/**
 * Render adapter contract plus the WebGL implementation.
 *
 * The adapter owns the three.js scene graph root, the active camera and the
 * frame counter. Systems add objects to `adapter.scene`; the runtime calls
 * `render(alpha)` once per frame, where `alpha` is the fixed-step interpolation
 * factor produced by the simulation loop (interpolation happens only here, at
 * draw time).
 *
 * A headless implementation lives in `./headless` and is re-exported here so
 * callers can depend on a single module.
 */

import {
  ACESFilmicToneMapping,
  Color,
  FogExp2,
  Material,
  Object3D,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Texture,
  WebGLRenderer,
  type ColorRepresentation,
} from 'three';

export type RenderAdapterKind = 'webgl' | 'headless';

/** Wall-clock-free counters describing what an adapter has rendered. */
export interface RenderStats {
  /** Number of `render()` calls served. */
  readonly frames: number;
  /** Draw calls reported by the last WebGL render (0 for headless). */
  readonly drawCalls: number;
  /** Triangles reported by the last WebGL render (0 for headless). */
  readonly triangles: number;
}

/** A render target the runtime can draw a frame through. */
export interface RenderAdapter {
  readonly kind: RenderAdapterKind;
  /** Scene graph root that systems attach their objects to. */
  readonly scene: Scene;
  /** Active camera. Replace with `setCamera`. */
  readonly camera: PerspectiveCamera;
  /** Backing canvas, or `null` for adapters without a drawing surface. */
  readonly canvas: HTMLCanvasElement | null;
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly stats: RenderStats;
  readonly disposed: boolean;
  setCamera(camera: PerspectiveCamera): void;
  resize(width: number, height: number, pixelRatio?: number): void;
  /** Present one frame. `alpha` is the draw-time interpolation factor. */
  render(alpha: number): void;
  /** Release the renderer and every geometry/material/texture it created. */
  dispose(): void;
}

export interface RenderAdapterOptions {
  /** Existing canvas to draw into. Created on demand when omitted. */
  canvas?: HTMLCanvasElement;
  width?: number;
  height?: number;
  pixelRatio?: number;
  antialias?: boolean;
  /** Clear colour. Defaults to the Coroid void blue. */
  background?: ColorRepresentation;
  /** Exponential fog for depth cueing; pass `false` to disable. */
  fog?: { color: ColorRepresentation; density: number } | false;
  /** Initial camera; a sensible 3D default is created when omitted. */
  camera?: PerspectiveCamera;
}

/** Counts of GPU resources released by `disposeRenderResources`. */
export interface DisposedResources {
  geometries: number;
  materials: number;
  textures: number;
}

/**
 * Traverse a subtree and dispose every geometry, material and texture it holds.
 *
 * Materials are scanned generically so texture maps, env maps and custom
 * uniforms are all released without the adapter having to know each material.
 */
export function disposeRenderResources(root: Object3D): DisposedResources {
  const disposed: DisposedResources = { geometries: 0, materials: 0, textures: 0 };
  const seenMaterials = new Set<Material>();

  root.traverse((object) => {
    const withGeometry = object as Object3D & { geometry?: { dispose?: () => void } };
    if (withGeometry.geometry && typeof withGeometry.geometry.dispose === 'function') {
      withGeometry.geometry.dispose();
      disposed.geometries += 1;
    }

    const withMaterial = object as Object3D & { material?: Material | Material[] };
    const material = withMaterial.material;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const entry of list) {
      if (seenMaterials.has(entry)) continue;
      seenMaterials.add(entry);
      for (const value of Object.values(entry as unknown as Record<string, unknown>)) {
        if (value instanceof Texture) {
          value.dispose();
          disposed.textures += 1;
        }
      }
      entry.dispose();
      disposed.materials += 1;
    }
  });

  return disposed;
}

/**
 * Probe for a usable WebGL context without leaving the canvas in a bad state:
 * the same canvas and context type is handed to three.js right afterwards.
 */
export function supportsWebGL(canvas?: HTMLCanvasElement): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = canvas ?? document.createElement('canvas');
    const context =
      probe.getContext('webgl2') ??
      (probe.getContext('webgl') as WebGLRenderingContext | null) ??
      null;
    return context !== null;
  } catch {
    return false;
  }
}

/** Default camera framing for the factory floor. */
export function createDefaultCamera(aspect = 1): PerspectiveCamera {
  const camera = new PerspectiveCamera(52, aspect <= 0 ? 1 : aspect, 0.1, 400);
  camera.position.set(18, 13, 26);
  camera.lookAt(0, 2, 0);
  return camera;
}

/**
 * Create a WebGL render adapter backed by three.js.
 *
 * Throws when the host cannot provide a WebGL context; callers that must keep
 * running (headless tests, dev previews on machines without GPU access) should
 * fall back to `createHeadlessAdapter`.
 */
export function createRenderAdapter(options: RenderAdapterOptions = {}): RenderAdapter {
  if (typeof document === 'undefined') {
    throw new Error('[coroid] createRenderAdapter requires a DOM; use createHeadlessAdapter instead');
  }

  const canvas = options.canvas ?? document.createElement('canvas');
  const renderer = new WebGLRenderer({
    canvas,
    antialias: options.antialias ?? true,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
  });

  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  let pixelRatio = options.pixelRatio ?? Math.min(2, globalThis.devicePixelRatio ?? 1);
  const width = Math.max(1, Math.floor(options.width ?? canvas.clientWidth ?? 1));
  const height = Math.max(1, Math.floor(options.height ?? canvas.clientHeight ?? 1));

  const scene = new Scene();
  const background = new Color(options.background ?? 0x04070f);
  scene.background = background;
  if (options.fog !== false) {
    const fogOptions = options.fog ?? { color: 0x04070f, density: 0.011 };
    scene.fog = new FogExp2(new Color(fogOptions.color), fogOptions.density);
  }

  const camera = options.camera ?? createDefaultCamera(width / height);

  let frames = 0;
  let disposed = false;

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);

  return {
    kind: 'webgl',
    scene,
    get camera() {
      return camera;
    },
    canvas,
    get frameCount() {
      return frames;
    },
    get width() {
      return Math.max(1, Math.floor(renderer.domElement.width / pixelRatio));
    },
    get height() {
      return Math.max(1, Math.floor(renderer.domElement.height / pixelRatio));
    },
    get pixelRatio() {
      return pixelRatio;
    },
    get stats() {
      const info = renderer.info;
      return { frames, drawCalls: info.render.calls, triangles: info.render.triangles };
    },
    get disposed() {
      return disposed;
    },
    setCamera(next: PerspectiveCamera): void {
      camera.copy(next);
      camera.updateProjectionMatrix();
    },
    resize(nextWidth: number, nextHeight: number, nextPixelRatio?: number): void {
      if (disposed) return;
      if (nextPixelRatio !== undefined && nextPixelRatio > 0) {
        pixelRatio = nextPixelRatio;
        renderer.setPixelRatio(pixelRatio);
      }
      renderer.setSize(Math.max(1, Math.floor(nextWidth)), Math.max(1, Math.floor(nextHeight)), false);
      camera.aspect = Math.max(1, nextWidth) / Math.max(1, nextHeight);
      camera.updateProjectionMatrix();
    },
    render(alpha: number): void {
      if (disposed) return;
      void alpha;
      renderer.render(scene, camera);
      frames += 1;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeRenderResources(scene);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export { createHeadlessAdapter } from './headless';
export type { HeadlessAdapterOptions } from './headless';
