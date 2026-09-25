/**
 * Renderer, lighting rig and frame loop.
 *
 * Deliberately thin: it owns the WebGLRenderer, the camera, the per-era light
 * rig, a fixed set of per-frame "systems" registered by the sim modules, and the
 * adaptive-quality / context-loss handling. Nothing here is imported by the unit
 * tests (constructing a WebGLRenderer needs a real canvas).
 */

import * as THREE from 'three';
import type { SkyPalette } from '../config/types';
import type { QualityTier } from '../state/store';
import { createPostFX, type PostFX } from './postfx';

export type EngineSystem = (dt: number, elapsed: number) => void;

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  maxPixelRatio?: number;
  /** Fired roughly once per second with the smoothed frame rate. */
  onFps?: (fps: number) => void;
  /** Fired when the renderer silently steps the quality tier up or down. */
  onQualityChange?: (tier: QualityTier, reason: 'adaptive' | 'manual') => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

/** Probe for WebGL support without throwing. */
export function isWebGLAvailable(): boolean {
  try {
    const doc = (globalThis as unknown as { document?: Document }).document;
    if (!doc || typeof doc.createElement !== 'function') return false;
    const canvas = doc.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl' as 'webgl');
    return Boolean(gl);
  } catch {
    return false;
  }
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  private readonly clock = new THREE.Clock();
  private readonly systems: EngineSystem[] = [];
  private readonly hemi: THREE.HemisphereLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly sun: THREE.DirectionalLight;
  private postfx: PostFX;
  private frameHandle = 0;
  private running = false;
  private elapsed = 0;
  private readonly options: EngineOptions;
  private quality: QualityTier = 'high';
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private lowFpsSeconds = 0;
  private highFpsSeconds = 0;
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;

  constructor(options: EngineOptions) {
    this.options = options;
    this.canvas = options.canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(this.pixelRatioFor('high'));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#101418');
    this.scene.fog = new THREE.FogExp2(new THREE.Color('#101418'), 0.0035);

    this.camera = new THREE.PerspectiveCamera(56, 1, 0.5, 1200);
    this.camera.position.set(120, 90, 120);

    this.ambient = new THREE.AmbientLight('#8b95a3', 0.5);
    this.hemi = new THREE.HemisphereLight('#a8bcd0', '#3a3326', 0.6);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.2);
    this.sun.position.set(-60, 90, -40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.camera.left = -120;
    this.sun.shadow.camera.right = 120;
    this.sun.shadow.camera.top = 120;
    this.sun.shadow.camera.bottom = -120;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.05;

    this.scene.add(this.ambient, this.hemi, this.sun, this.sun.target);

    const size = this.viewportSize();
    this.postfx = createPostFX(this.renderer, this.scene, this.camera, { ...size, pixelRatio: this.renderer.getPixelRatio() });
    this.resize(true);

    window.addEventListener('resize', this.handleResize, { passive: true });
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  /* ----------------------------------------------------------- systems --- */

  addSystem(system: EngineSystem): () => void {
    this.systems.push(system);
    return () => {
      const index = this.systems.indexOf(system);
      if (index >= 0) this.systems.splice(index, 1);
    };
  }

  /* ---------------------------------------------------------- lifecycle -- */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = (): void => {
      if (!this.running) return;
      this.frameHandle = requestAnimationFrame(loop);
      this.tick();
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** One frame: systems, grade, post-processing. */
  tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.elapsed += dt;

    for (const system of this.systems) system(dt, this.elapsed);

    this.postfx.update(dt);
    this.postfx.render(dt);
    this.trackFps(dt);
    this.checkResize();
  }

  /* ------------------------------------------------------------ visuals -- */

  /** Apply an era sky palette to the fog and light rig. */
  applyPalette(palette: SkyPalette): void {
    const fog = this.scene.fog;
    if (fog instanceof THREE.FogExp2) {
      fog.color.set(palette.fog);
      fog.density = palette.fogDensity;
    }
    if (this.scene.background instanceof THREE.Color) this.scene.background.set(palette.fog);

    this.ambient.color.set(palette.ambient);
    this.ambient.intensity = palette.ambientIntensity;
    this.hemi.color.set(palette.hemiSky);
    this.hemi.groundColor.set(palette.hemiGround);
    this.hemi.intensity = palette.hemiIntensity;
    this.sun.color.set(palette.sun);
    this.sun.intensity = palette.sunIntensity;
    this.sun.position.set(palette.sunPosition[0], palette.sunPosition[1], palette.sunPosition[2]);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
  }

  setGrade(grade: Parameters<PostFX['setGrade']>[0]): void {
    this.postfx.setGrade(grade);
  }

  setFlash(amount: number): void {
    this.postfx.setFlash(amount);
  }

  /** Manual quality override (also used by the adaptive controller). */
  setQuality(tier: QualityTier, reason: 'adaptive' | 'manual' = 'manual'): void {
    if (tier === this.quality) return;
    this.quality = tier;
    this.renderer.setPixelRatio(this.pixelRatioFor(tier));
    this.renderer.shadowMap.enabled = tier !== 'low';
    this.postfx.setQuality(tier);
    this.resize(true);
    this.options.onQualityChange?.(tier, reason);
  }

  get qualityTier(): QualityTier {
    return this.quality;
  }

  /* -------------------------------------------------------------- size --- */

  private viewportSize(): { width: number; height: number } {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    return { width, height };
  }

  /** Public resize entry point (called on window resize and after tier changes). */
  resize(force = false): void {
    const { width, height } = this.viewportSize();
    if (!force && width === this.lastResizeWidth && height === this.lastResizeHeight) return;
    this.lastResizeWidth = width;
    this.lastResizeHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.postfx.setSize(width, height, this.renderer.getPixelRatio());
  }

  private checkResize(): void {
    const { width, height } = this.viewportSize();
    if (width !== this.lastResizeWidth || height !== this.lastResizeHeight) this.resize();
  }

  private readonly handleResize = (): void => {
    this.resize();
  };

  private pixelRatioFor(tier: QualityTier): number {
    const cap = this.options.maxPixelRatio ?? 2;
    const limit = tier === 'high' ? cap : tier === 'medium' ? Math.min(cap, 1.5) : 1;
    return Math.min(window.devicePixelRatio || 1, limit);
  }

  /* --------------------------------------------------------------- fps --- */

  private trackFps(dt: number): void {
    if (dt <= 0) return;
    this.fpsAccumulator += dt;
    this.fpsFrames += 1;
    if (this.fpsAccumulator < 1) return;

    const fps = this.fpsFrames / this.fpsAccumulator;
    this.fpsAccumulator = 0;
    this.fpsFrames = 0;
    this.options.onFps?.(fps);

    // Adaptive quality: drop after ~2.5s below 40fps, restore after ~6s above 58fps.
    if (fps < 40 && this.quality !== 'low') {
      this.lowFpsSeconds += 1;
      this.highFpsSeconds = 0;
      if (this.lowFpsSeconds >= 3) {
        this.lowFpsSeconds = 0;
        this.setQuality(this.quality === 'high' ? 'medium' : 'low', 'adaptive');
      }
    } else if (fps > 58 && this.quality !== 'high') {
      this.highFpsSeconds += 1;
      this.lowFpsSeconds = 0;
      if (this.highFpsSeconds >= 6) {
        this.highFpsSeconds = 0;
        this.setQuality(this.quality === 'low' ? 'medium' : 'high', 'adaptive');
      }
    } else {
      this.lowFpsSeconds = 0;
      this.highFpsSeconds = 0;
    }
  }

  /* ---------------------------------------------------------- recovery --- */

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.stop();
    this.options.onContextLost?.();
  };

  private readonly handleContextRestored = (): void => {
    const size = this.viewportSize();
    this.postfx.dispose();
    this.postfx = createPostFX(this.renderer, this.scene, this.camera, {
      ...size,
      pixelRatio: this.renderer.getPixelRatio(),
    });
    this.options.onContextRestored?.();
    this.start();
  };

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.postfx.dispose();
    this.renderer.dispose();
  }
}
