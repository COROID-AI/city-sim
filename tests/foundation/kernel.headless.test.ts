/**
 * Headless kernel suite.
 *
 * The kernel must be constructible, steppable, resizable and disposable
 * without a GPU: `vitest` runs this suite in the node environment, where no
 * WebGL context can ever be created, so it also exercises the capability probe
 * and the headless fallback path directly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_ROOM_BOUNDS } from '../../src/contracts/period';
import {
  createKernel,
  createManualFrameScheduler,
  probeWebGLCapabilities,
  type Kernel,
  type KernelOptions,
} from '../../src/core/kernel';

const openKernels: Kernel[] = [];

function headlessKernel(options: KernelOptions = {}): Kernel {
  const kernel = createKernel(null, { forceHeadless: true, ...options });
  openKernels.push(kernel);
  return kernel;
}

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
});

describe('capability probe and headless boot', () => {
  it('reports why no GPU context is available', () => {
    const probe = probeWebGLCapabilities();
    expect(probe.supported).toBe(false);
    expect(probe.backend).toBe('none');
    expect(probe.reason).toMatch(/canvas/i);

    expect(probeWebGLCapabilities(() => null).supported).toBe(false);

    const brokenCanvas = {
      getContext: () => {
        throw new Error('context unavailable');
      },
    } as unknown as HTMLCanvasElement;
    const broken = probeWebGLCapabilities(() => brokenCanvas);
    expect(broken.supported).toBe(false);
    expect(broken.reason).toMatch(/context unavailable/);
  });

  it('constructs a GPU-free kernel with a scene, camera rig and default viewport', () => {
    const kernel = headlessKernel({ width: 1280, height: 720 });

    expect(kernel.headless).toBe(true);
    expect(kernel.renderer).toBeNull();
    expect(kernel.canvas).toBeNull();
    expect(kernel.capabilities.supported).toBe(false);
    expect(kernel.capabilities.reason).toMatch(/headless/i);

    expect(kernel.scene).toBeInstanceOf(THREE.Scene);
    expect(kernel.world).toBeInstanceOf(THREE.Group);
    expect(kernel.world.parent).toBe(kernel.scene);
    expect(kernel.camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(kernel.cameraRig.camera).toBe(kernel.camera);
    expect(kernel.cameraRig.target).toBeInstanceOf(THREE.Vector3);

    expect(kernel.bounds).toEqual(DEFAULT_ROOM_BOUNDS);
    expect(kernel.year).toBe('1945');
    expect(kernel.isRunning).toBe(false);
    expect(kernel.isDisposed).toBe(false);
    expect(kernel.frame).toBe(0);
    expect(kernel.elapsedSeconds).toBe(0);
    expect(kernel.getSize()).toEqual({ width: 1280, height: 720 });
    expect(kernel.camera.aspect).toBeCloseTo(1280 / 720, 6);

    expect(() => kernel.render()).not.toThrow();
  });
});

describe('delta-timed updates', () => {
  it('advances frame listeners with the delta it was given', () => {
    const kernel = headlessKernel();
    const frames: { delta: number; elapsed: number; frame: number; year: string }[] = [];
    kernel.onFrame((frame) =>
      frames.push({
        delta: frame.deltaSeconds,
        elapsed: frame.elapsedSeconds,
        frame: frame.frame,
        year: frame.year,
      }),
    );

    kernel.update(0.016);
    kernel.update(0.032);
    kernel.update(0.016);

    expect(frames.map((frame) => frame.delta)).toEqual([0.016, 0.032, 0.016]);
    expect(frames.map((frame) => frame.frame)).toEqual([1, 2, 3]);
    expect(frames.every((frame) => frame.year === '1945')).toBe(true);
    expect(kernel.frame).toBe(3);
    expect(kernel.elapsedSeconds).toBeCloseTo(0.064, 6);

    kernel.update(Number.NaN);
    kernel.update(-1);
    expect(kernel.frame).toBe(5);
    expect(kernel.elapsedSeconds).toBeCloseTo(0.064, 6);
    expect(frames[3]?.delta).toBe(0);
    expect(frames[4]?.delta).toBe(0);

    kernel.setYear('2005');
    kernel.update(0.016);
    expect(frames[5]?.year).toBe('2005');
  });

  it('eases the camera rig towards the requested view', () => {
    const kernel = headlessKernel();
    kernel.cameraRig.view({
      position: { x: 1.5, y: 1.7, z: 2 },
      target: { x: 0, y: 1.2, z: -3 },
    });

    const before = kernel.camera.position.clone();
    const distanceBefore = before.distanceTo(kernel.cameraRig.desiredPosition);
    expect(distanceBefore).toBeGreaterThan(0);

    kernel.update(1 / 60);
    expect(kernel.camera.position.equals(before)).toBe(false);
    expect(kernel.camera.position.distanceTo(kernel.cameraRig.desiredPosition)).toBeLessThan(
      distanceBefore,
    );

    for (let step = 0; step < 600; step += 1) kernel.update(1 / 60);
    expect(kernel.camera.position.distanceTo(kernel.cameraRig.desiredPosition)).toBeLessThan(1e-4);
    expect(kernel.cameraRig.target.distanceTo(kernel.cameraRig.desiredTarget)).toBeLessThan(1e-4);
  });

  it('steps from the scheduler clock', () => {
    const scheduler = createManualFrameScheduler(500);
    const kernel = headlessKernel({ scheduler });

    scheduler.advance(20);
    expect(kernel.step()).toBeCloseTo(0.02, 6);
    scheduler.advance(10);
    expect(kernel.step()).toBeCloseTo(0.01, 6);

    expect(kernel.frame).toBe(2);
    expect(kernel.elapsedSeconds).toBeCloseTo(0.03, 6);
  });
});

describe('frame loop', () => {
  it('runs and stops through an injected scheduler', () => {
    const scheduler = createManualFrameScheduler(1_000);
    const kernel = headlessKernel({ scheduler });
    const deltas: number[] = [];
    kernel.onFrame((frame) => deltas.push(frame.deltaSeconds));

    kernel.start();
    expect(kernel.isRunning).toBe(true);
    expect(scheduler.pending).toBe(1);

    scheduler.tick(16.6667);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBeCloseTo(0.0166667, 5);
    expect(scheduler.pending).toBe(1);

    scheduler.tick(16.6667);
    expect(deltas).toHaveLength(2);
    expect(kernel.frame).toBe(2);

    kernel.stop();
    expect(kernel.isRunning).toBe(false);
    expect(scheduler.pending).toBe(0);
    scheduler.tick(50);
    expect(kernel.frame).toBe(2);

    // A long pause (backgrounded tab) is clamped to the configured maximum.
    kernel.start();
    scheduler.advance(5_000);
    scheduler.tick();
    expect(kernel.frame).toBe(3);
    expect(deltas[2]).toBe(0.1);
    expect(kernel.elapsedSeconds).toBeCloseTo(0.1 + deltas[0]! + deltas[1]!, 6);
  });
});

describe('viewport resize', () => {
  it('reacts to viewport events and explicit sizes', () => {
    const resizeTarget = new EventTarget();
    const addSpy = vi.spyOn(resizeTarget, 'addEventListener');
    const removeSpy = vi.spyOn(resizeTarget, 'removeEventListener');
    let viewport = { width: 640, height: 360 };

    const kernel = headlessKernel({
      resizeTarget,
      measureViewport: () => viewport,
    });

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls[0]?.[0]).toBe('resize');
    const handler = addSpy.mock.calls[0]?.[1];
    expect(typeof handler).toBe('function');
    expect(kernel.getSize()).toEqual({ width: 640, height: 360 });
    expect(kernel.camera.aspect).toBeCloseTo(640 / 360, 6);

    const aspects: number[] = [];
    kernel.onResize((info) => aspects.push(info.aspect));

    viewport = { width: 1024, height: 768 };
    resizeTarget.dispatchEvent(new Event('resize'));
    expect(kernel.getSize()).toEqual({ width: 1024, height: 768 });
    expect(kernel.camera.aspect).toBeCloseTo(1024 / 768, 6);
    expect(aspects).toEqual([1024 / 768]);

    kernel.resize(800, 600);
    expect(kernel.getSize()).toEqual({ width: 800, height: 600 });
    expect(kernel.camera.aspect).toBeCloseTo(800 / 600, 6);
    expect(aspects).toHaveLength(2);

    kernel.dispose();
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy.mock.calls[0]?.[0]).toBe('resize');
    expect(removeSpy.mock.calls[0]?.[1]).toBe(handler);

    viewport = { width: 320, height: 240 };
    resizeTarget.dispatchEvent(new Event('resize'));
    expect(kernel.getSize()).toEqual({ width: 800, height: 600 });
  });
});

describe('dispose', () => {
  it('releases scene resources, stops the loop and drops every listener', () => {
    const resizeTarget = new EventTarget();
    const removeSpy = vi.spyOn(resizeTarget, 'removeEventListener');
    const scheduler = createManualFrameScheduler();
    const kernel = headlessKernel({
      scheduler,
      resizeTarget,
      measureViewport: () => ({ width: 512, height: 512 }),
    });

    const frameListener = vi.fn();
    const resizeListener = vi.fn();
    const disposeListener = vi.fn();
    kernel.onFrame(frameListener);
    kernel.onResize(resizeListener);
    kernel.onDispose(disposeListener);
    kernel.start();
    expect(scheduler.pending).toBe(1);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    material.map = texture;
    const geometrySpy = vi.spyOn(geometry, 'dispose');
    const materialSpy = vi.spyOn(material, 'dispose');
    const textureSpy = vi.spyOn(texture, 'dispose');
    kernel.world.add(new THREE.Mesh(geometry, material));

    expect(kernel.getListenerStats()).toEqual({ frame: 1, resize: 1, dispose: 1, dom: 1 });
    expect(kernel.listenerCount).toBe(4);

    kernel.dispose();

    expect(kernel.isDisposed).toBe(true);
    expect(kernel.isRunning).toBe(false);
    expect(scheduler.pending).toBe(0);
    expect(geometrySpy).toHaveBeenCalled();
    expect(materialSpy).toHaveBeenCalled();
    expect(textureSpy).toHaveBeenCalled();
    expect(disposeListener).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(kernel.world.children).toHaveLength(0);
    expect(kernel.scene.children).toHaveLength(0);
    expect(kernel.getListenerStats()).toEqual({ frame: 0, resize: 0, dispose: 0, dom: 0 });
    expect(kernel.listenerCount).toBe(0);

    // Nothing fires again, and lifecycle calls stay safe.
    resizeTarget.dispatchEvent(new Event('resize'));
    kernel.update(1 / 60);
    kernel.resize(400, 300);
    kernel.stop();
    expect(frameListener).not.toHaveBeenCalled();
    expect(resizeListener).not.toHaveBeenCalled();
    expect(kernel.getSize()).toEqual({ width: 512, height: 512 });

    kernel.dispose();
    expect(disposeListener).toHaveBeenCalledTimes(1);
    expect(() => kernel.start()).toThrow(/disposed/i);
  });
});
