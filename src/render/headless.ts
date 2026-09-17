/**
 * Headless render adapter: the same contract as the WebGL adapter with no
 * canvas, no GPU and no DOM.
 *
 * It keeps a real three.js `Scene` and `PerspectiveCamera`, updates their world
 * matrices (so layout systems that read world transforms behave identically to
 * the WebGL path) and counts frames. That makes it usable from Node tests,
 * fast-forwards and CI smoke runs.
 */

import { Scene, type PerspectiveCamera } from 'three';
import { createDefaultCamera, disposeRenderResources, type RenderAdapter } from './renderer';

export interface HeadlessAdapterOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
  /** Camera to expose; a default framing is created when omitted. */
  camera?: PerspectiveCamera;
}

/**
 * Create an adapter that renders nowhere.
 *
 * `render(alpha)` still advances the frame counter and refreshes world
 * matrices, so a headless game run exercises the exact same call sequence as a
 * WebGL run.
 */
export function createHeadlessAdapter(options: HeadlessAdapterOptions = {}): RenderAdapter {
  const width = Math.max(1, Math.floor(options.width ?? 1280));
  const height = Math.max(1, Math.floor(options.height ?? 720));
  const scene = new Scene();
  const camera = options.camera ?? createDefaultCamera(width / height);

  let frames = 0;
  let disposed = false;
  let currentWidth = width;
  let currentHeight = height;
  let pixelRatio = options.pixelRatio ?? 1;

  return {
    kind: 'headless',
    scene,
    get camera() {
      return camera;
    },
    canvas: null,
    get frameCount() {
      return frames;
    },
    get width() {
      return currentWidth;
    },
    get height() {
      return currentHeight;
    },
    get pixelRatio() {
      return pixelRatio;
    },
    get stats() {
      return { frames, drawCalls: 0, triangles: 0 };
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
      currentWidth = Math.max(1, Math.floor(nextWidth));
      currentHeight = Math.max(1, Math.floor(nextHeight));
      if (nextPixelRatio !== undefined) pixelRatio = nextPixelRatio;
      camera.aspect = currentWidth / currentHeight;
      camera.updateProjectionMatrix();
    },
    render(alpha: number): void {
      if (disposed) return;
      void alpha;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      frames += 1;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeRenderResources(scene);
      scene.clear();
    },
  };
}
