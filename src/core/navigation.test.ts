/**
 * Navigation controller suite.
 *
 * Runs in the node environment (no DOM, no GPU) the way the rest of the core
 * suites do: the controller accepts structural input surfaces, so a small
 * in-memory element/document stand in for the browser while a real three.js
 * perspective camera and the real scene kernel prove the integration.
 *
 * Coverage:
 *  - orbit drag + wheel zoom with clamped polar angle, distance, target and
 *    camera containment,
 *  - walk mode movement vectors, arrow-key turning, touch drag, pointer lock
 *    and gamepad input,
 *  - collision against a supplied `RoomBounds` from an environment-shaped
 *    module, including a high-speed anti-tunnelling pass,
 *  - hotspot / Object3D focus distance solving and the inspect round trip,
 *  - listener, pointer-lock and tick-subscription lifecycle.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_ROOM_BOUNDS,
  type BuildContext,
  type DomainSpecBase,
  type Hotspot,
  type PeriodDefinition,
  type RoomBounds,
  type SceneModule,
} from '../contracts/period';
import { createKernel, type Kernel } from './kernel';
import {
  NavigationController,
  createNavigationController,
  defaultNavigationLimits,
  navigationInterior,
  solveFocusDistance,
  type NavigationControllerOptions,
  type NavigationDocumentSource,
  type NavigationEventSource,
  type NavigationGamepadLike,
  type NavigationInterior,
} from './navigation';

/* -------------------------------------------------------------------------- */
/* Test doubles                                                               */
/* -------------------------------------------------------------------------- */

type Handler = (event: Event) => void;

interface FakeEventSource extends NavigationEventSource {
  readonly listeners: Map<string, Set<Handler>>;
  dispatch(type: string, event: unknown): void;
  listenerCount(): number;
}

function createEventSource(): FakeEventSource {
  const listeners = new Map<string, Set<Handler>>();
  return {
    listeners,
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
      if (typeof listener !== 'function') return;
      const set = listeners.get(type) ?? new Set<Handler>();
      set.add(listener as Handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
      if (typeof listener !== 'function') return;
      listeners.get(type)?.delete(listener as Handler);
    },
    dispatch(type: string, event: unknown): void {
      for (const handler of [...(listeners.get(type) ?? [])]) {
        handler(event as Event);
      }
    },
    listenerCount(): number {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
  };
}

interface FakeElement extends NavigationEventSource {
  readonly listeners: Map<string, Set<Handler>>;
  pointerLockRequests: number;
  dispatch(type: string, event: unknown): void;
  listenerCount(): number;
}

function createFakeElement(): FakeElement {
  const source = createEventSource();
  const element: FakeElement = {
    ...source,
    pointerLockRequests: 0,
    addEventListener: source.addEventListener.bind(source),
    removeEventListener: source.removeEventListener.bind(source),
    requestPointerLock(): void {
      element.pointerLockRequests += 1;
    },
    setPointerCapture(): void {},
    releasePointerCapture(): void {},
  } as FakeElement;
  return element;
}

interface FakeDocument extends NavigationDocumentSource {
  readonly listeners: Map<string, Set<Handler>>;
  pointerLockElement: Element | null;
  exitCalls: number;
  lockTo(element: Element | null): void;
  dispatch(type: string, event: unknown): void;
  listenerCount(): number;
}

function createFakeDocument(): FakeDocument {
  const source = createEventSource();
  const document: FakeDocument = {
    ...source,
    addEventListener: source.addEventListener.bind(source),
    removeEventListener: source.removeEventListener.bind(source),
    pointerLockElement: null,
    exitCalls: 0,
    lockTo(element: Element | null): void {
      document.pointerLockElement = element;
      source.dispatch('pointerlockchange', { type: 'pointerlockchange' });
    },
    exitPointerLock(): void {
      document.exitCalls += 1;
      document.lockTo(null);
    },
  } as FakeDocument;
  return document;
}

function gamepad(axes: readonly number[], pressed: readonly number[] = []): NavigationGamepadLike {
  return {
    axes,
    connected: true,
    buttons: Array.from({ length: 8 }, (_unused, index) => ({
      pressed: pressed.includes(index),
      value: pressed.includes(index) ? 1 : 0,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

interface Harness {
  readonly camera: THREE.PerspectiveCamera;
  readonly element: FakeElement;
  readonly document: FakeDocument;
  readonly controller: NavigationController;
  readonly interior: NavigationInterior;
}

function createHarness(overrides: Partial<NavigationControllerOptions> = {}): Harness {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 200);
  const element = createFakeElement();
  const ownerDocument = createFakeDocument();
  const controller = new NavigationController({
    camera,
    element,
    ownerDocument,
    ...overrides,
  });
  return { camera, element, document: ownerDocument, controller, interior: controller.interior };
}

/** Worst signed distance by which `point` lies outside `interior` (≤ 0 is inside). */
function containmentViolation(point: THREE.Vector3, interior: NavigationInterior): number {
  return Math.max(
    interior.minX - point.x,
    point.x - interior.maxX,
    interior.minY - point.y,
    point.y - interior.maxY,
    interior.minZ - point.z,
    point.z - interior.maxZ,
  );
}

function expectInside(camera: THREE.Camera, interior: NavigationInterior): void {
  expect(containmentViolation(camera.position, interior)).toBeLessThanOrEqual(1e-6);
}

const openKernels: Kernel[] = [];

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
});

/* -------------------------------------------------------------------------- */
/* Orbit and zoom                                                             */
/* -------------------------------------------------------------------------- */

describe('orbit and zoom', () => {
  it('orbits on pointer drag and clamps distance, polar angle and target', () => {
    const { camera, element, controller, interior } = createHarness();
    controller.attach();

    const azimuthBefore = controller.azimuth;
    const polarBefore = controller.polar;
    element.dispatch('pointerdown', {
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 200,
      clientY: 200,
    });
    element.dispatch('pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 260,
      clientY: 230,
    });
    element.dispatch('pointerup', { pointerId: 1, pointerType: 'mouse' });

    expect(controller.azimuth).not.toBeCloseTo(azimuthBefore, 6);
    expect(controller.polar).not.toBeCloseTo(polarBefore, 6);
    expectInside(camera, interior);

    // Wheel zoom out is clamped to the configured maximum distance.
    for (let step = 0; step < 80; step += 1) {
      element.dispatch('wheel', { deltaY: 240 });
    }
    expect(controller.distance).toBeLessThanOrEqual(controller.limits.maxDistance + 1e-9);
    // ... and zoom in to the configured minimum.
    for (let step = 0; step < 400; step += 1) {
      element.dispatch('wheel', { deltaY: -240 });
    }
    expect(controller.distance).toBeGreaterThanOrEqual(controller.limits.minDistance - 1e-9);
    expectInside(camera, interior);

    // A target outside the shell is pulled back inside it.
    controller.setTarget({ x: 500, y: 500, z: -500 });
    expect(controller.target.x).toBeLessThanOrEqual(interior.maxX + 1e-9);
    expect(controller.target.y).toBeLessThanOrEqual(interior.maxY + 1e-9);
    expect(controller.target.z).toBeGreaterThanOrEqual(interior.minZ - 1e-9);
    expectInside(camera, interior);

    controller.dispose();
  });

  it('never lets the orbit camera pass through the floor or the ceiling', () => {
    const { camera, controller, interior } = createHarness();
    controller.attach();
    controller.setTarget({ x: 0, y: 1, z: 0 });

    controller.orbit(0, 10);
    expect(camera.position.y).toBeGreaterThanOrEqual(interior.minY - 1e-6);
    expect(controller.polar).toBeLessThanOrEqual(controller.limits.maxPolar + 1e-9);
    expectInside(camera, interior);

    controller.orbit(0, -20);
    expect(camera.position.y).toBeLessThanOrEqual(interior.maxY + 1e-6);
    expect(controller.polar).toBeGreaterThanOrEqual(controller.limits.minPolar - 1e-9);
    expectInside(camera, interior);

    controller.dispose();
  });

  it('stays inside the room volume for a full orbit at maximum distance', () => {
    const { camera, controller, interior } = createHarness();
    controller.attach();
    controller.setDistance(controller.limits.maxDistance);

    let violation = 0;
    for (let step = 0; step < 96; step += 1) {
      controller.orbit((Math.PI * 2) / 96, 0);
      violation = Math.max(violation, containmentViolation(camera.position, interior));
    }
    // Orbiting a target pressed into a corner is the worst case for the solver.
    controller.setTarget({ x: 100, y: 1.6, z: -100 });
    for (let step = 0; step < 96; step += 1) {
      controller.orbit((Math.PI * 2) / 96, 0.05);
      violation = Math.max(violation, containmentViolation(camera.position, interior));
    }
    expect(violation).toBeLessThanOrEqual(1e-6);

    controller.dispose();
  });

  it('surveys the room from inside as well as from the wide vantage', () => {
    const { camera, controller } = createHarness();
    controller.attach();

    controller.setDistance(controller.limits.maxDistance);
    const wide = camera.position.clone();
    controller.setDistance(controller.limits.minDistance);
    const close = camera.position.clone();

    expect(wide.distanceTo(controller.target)).toBeGreaterThan(
      close.distanceTo(controller.target) + 1,
    );
    expect(camera.position.distanceTo(controller.target)).toBeCloseTo(controller.distance, 6);

    controller.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Walk mode                                                                  */
/* -------------------------------------------------------------------------- */

describe('walk mode input', () => {
  it('drives the camera along the forward and strafe vectors with WASD', () => {
    const { camera, controller, document, interior } = createHarness({ mode: 'walk' });
    controller.attach();

    const start = camera.position.clone();
    document.dispatch('keydown', { code: 'KeyW' });
    for (let step = 0; step < 30; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'KeyW' });
    const afterForward = camera.position.clone();
    expect(afterForward.z).toBeLessThan(start.z - 0.5);
    expect(Math.abs(afterForward.x - start.x)).toBeLessThan(1e-6);

    document.dispatch('keydown', { code: 'KeyD' });
    for (let step = 0; step < 30; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'KeyD' });
    expect(camera.position.x).toBeGreaterThan(afterForward.x + 0.5);

    document.dispatch('keydown', { code: 'KeyS' });
    for (let step = 0; step < 30; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'KeyS' });
    expect(camera.position.z).toBeGreaterThan(afterForward.z + 0.5);

    expect(camera.position.y).toBeGreaterThanOrEqual(controller.limits.minEyeHeight - 1e-6);
    expect(camera.position.y).toBeLessThanOrEqual(controller.limits.maxEyeHeight + 1e-6);
    expectInside(camera, interior);

    controller.dispose();
  });

  it('turns with the arrow keys and then walks along the new heading', () => {
    const { camera, controller, document } = createHarness({ mode: 'walk' });
    controller.attach();

    const yawBefore = controller.yaw;
    document.dispatch('keydown', { code: 'ArrowLeft' });
    for (let step = 0; step < 30; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'ArrowLeft' });
    expect(controller.yaw).toBeGreaterThan(yawBefore);

    const pitchBefore = controller.pitch;
    document.dispatch('keydown', { code: 'ArrowUp' });
    for (let step = 0; step < 15; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'ArrowUp' });
    expect(controller.pitch).toBeGreaterThan(pitchBefore);

    const heading = new THREE.Vector3(-Math.sin(controller.yaw), 0, -Math.cos(controller.yaw));
    const before = camera.position.clone();
    document.dispatch('keydown', { code: 'KeyW' });
    for (let step = 0; step < 30; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'KeyW' });

    const moved = camera.position.clone().sub(before);
    moved.y = 0;
    expect(moved.length()).toBeGreaterThan(0.5);
    expect(moved.normalize().dot(heading)).toBeGreaterThan(0.98);

    controller.dispose();
  });

  it('applies eye-height and vertical step limits', () => {
    const { camera, controller, document } = createHarness({ mode: 'walk' });
    controller.attach();

    const standing = controller.eyeHeight;
    const stepPerUpdate = controller.limits.maxEyeStep / 60;

    document.dispatch('keydown', { code: 'ControlLeft' });
    controller.update(1 / 60);
    expect(standing - controller.eyeHeight).toBeLessThanOrEqual(stepPerUpdate + 1e-9);
    for (let step = 0; step < 240; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'ControlLeft' });
    expect(controller.eyeHeight).toBeCloseTo(controller.limits.minEyeHeight, 6);

    controller.update(1 / 60);
    expect(controller.eyeHeight - controller.limits.minEyeHeight).toBeLessThanOrEqual(
      stepPerUpdate + 1e-9,
    );
    expect(camera.position.y).toBeGreaterThanOrEqual(controller.interior.minY - 1e-6);
    expect(camera.position.y).toBeLessThanOrEqual(controller.interior.maxY + 1e-6);

    controller.dispose();
  });

  it('supports pointer lock, locked pointer look and touch drag', () => {
    const { camera, controller, element, document } = createHarness({ mode: 'walk' });
    controller.attach();

    element.dispatch('pointerdown', {
      button: 0,
      pointerId: 2,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 10,
    });
    expect(element.pointerLockRequests).toBe(1);
    expect(controller.pointerLocked).toBe(false);

    document.lockTo(element as unknown as Element);
    expect(controller.pointerLocked).toBe(true);

    const yawBefore = controller.yaw;
    element.dispatch('pointermove', {
      pointerId: 2,
      pointerType: 'mouse',
      movementX: 40,
      movementY: -20,
    });
    expect(controller.yaw).toBeLessThan(yawBefore);
    expect(controller.pitch).toBeGreaterThan(0);

    element.dispatch('pointerup', { pointerId: 2, pointerType: 'mouse' });
    document.lockTo(null);
    expect(controller.pointerLocked).toBe(false);

    // Touch drag turns the first-person view.
    const yawBeforeTouch = controller.yaw;
    element.dispatch('touchstart', { touches: [{ identifier: 7, clientX: 100, clientY: 100 }] });
    element.dispatch('touchmove', { touches: [{ identifier: 7, clientX: 160, clientY: 100 }] });
    element.dispatch('touchend', { touches: [] });
    expect(controller.yaw).toBeLessThan(yawBeforeTouch);
    expectInside(camera, controller.interior);

    controller.dispose();
  });

  it('reads movement, look and zoom from a gamepad', () => {
    const walkingPad = gamepad([0, -1, 0, 0]);
    const { camera, controller } = createHarness({
      mode: 'walk',
      gamepadSource: () => [walkingPad],
    });
    controller.attach();

    const startZ = camera.position.z;
    for (let step = 0; step < 30; step += 1) controller.update(1 / 60);
    expect(camera.position.z).toBeLessThan(startZ - 0.5);

    const zoomPad = gamepad([0, 0, 0, 0], [7]);
    const zoomed = createHarness({ gamepadSource: () => [zoomPad] });
    zoomed.controller.attach();
    const distanceBefore = zoomed.controller.distance;
    for (let step = 0; step < 30; step += 1) zoomed.controller.update(1 / 60);
    expect(zoomed.controller.distance).toBeLessThan(distanceBefore);

    controller.dispose();
    zoomed.controller.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Collision                                                                  */
/* -------------------------------------------------------------------------- */

describe('collision against the supplied room bounds', () => {
  it('clamps walk movement against every wall, the floor and the ceiling', () => {
    const { camera, controller, document, interior } = createHarness({ mode: 'walk' });
    controller.attach();

    let violation = 0;
    const drive = (code: string, seconds: number): void => {
      document.dispatch('keydown', { code });
      const steps = Math.round(seconds * 60);
      for (let step = 0; step < steps; step += 1) {
        controller.update(1 / 60);
        violation = Math.max(violation, containmentViolation(camera.position, interior));
      }
      document.dispatch('keyup', { code });
    };

    drive('KeyW', 6);
    expect(camera.position.z).toBeCloseTo(interior.minZ, 2);
    drive('KeyS', 14);
    expect(camera.position.z).toBeCloseTo(interior.maxZ, 2);
    drive('KeyD', 14);
    expect(camera.position.x).toBeCloseTo(interior.maxX, 2);
    drive('KeyA', 14);
    expect(camera.position.x).toBeCloseTo(interior.minX, 2);

    expect(violation).toBeLessThanOrEqual(1e-6);
    expect(camera.position.y).toBeGreaterThanOrEqual(interior.minY - 1e-6);
    expect(camera.position.y).toBeLessThanOrEqual(interior.maxY + 1e-6);

    controller.dispose();
  });

  it('does not tunnel through a wall at high speed', () => {
    const { camera, controller, document, interior } = createHarness({
      mode: 'walk',
      limits: { walkSpeed: 250 },
    });
    controller.attach();

    document.dispatch('keydown', { code: 'KeyW' });
    let violation = 0;
    for (let step = 0; step < 20; step += 1) {
      // 25 m in one update: far more than the room is deep.
      controller.update(0.1);
      violation = Math.max(violation, containmentViolation(camera.position, interior));
    }
    document.dispatch('keyup', { code: 'KeyW' });

    expect(violation).toBeLessThanOrEqual(1e-6);
    expect(camera.position.z).toBeCloseTo(interior.minZ, 3);

    controller.dispose();
  });

  it('derives collision from the supplied bounds instead of hardcoded dimensions', () => {
    const bounds: RoomBounds = { width: 30, depth: 6, height: 2.8 };
    const { camera, controller, document, interior } = createHarness({ mode: 'walk', bounds });
    controller.attach();

    expect(interior.maxX).toBeCloseTo(bounds.width / 2 - controller.limits.wallMargin, 6);
    expect(interior.minZ).toBeCloseTo(-(bounds.depth / 2 - controller.limits.wallMargin), 6);
    expect(camera.position.y).toBeLessThanOrEqual(bounds.height - controller.limits.ceilingMargin);

    document.dispatch('keydown', { code: 'KeyA' });
    for (let step = 0; step < 1200; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'KeyA' });
    expect(camera.position.x).toBeCloseTo(interior.minX, 3);

    controller.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Hotspot focus and inspect                                                  */
/* -------------------------------------------------------------------------- */

describe('hotspot focus and inspect mode', () => {
  it('frames a hotspot at the supplied distance and looks straight at it', () => {
    const { camera, controller } = createHarness();
    controller.attach();

    const position = new THREE.Vector3(0, 0.95, -3);
    const counter: Hotspot = {
      id: 'counter',
      label: 'Counter',
      description: 'The service counter.',
      position: position.clone(),
      radius: 0.6,
      year: '1945',
      moduleId: 'environment',
      kind: 'interactive',
    };

    const distance = controller.focus(counter, { distance: 1.5 });
    expect(distance).toBeCloseTo(1.5, 6);
    expect(camera.position.distanceTo(position)).toBeCloseTo(1.5, 6);

    const looking = new THREE.Vector3();
    camera.getWorldDirection(looking);
    const toTarget = position.clone().sub(camera.position).normalize();
    expect(looking.dot(toTarget)).toBeCloseTo(1, 4);

    controller.dispose();
  });

  it('solves the framing distance from a radius and the camera field of view', () => {
    const limits = defaultNavigationLimits(DEFAULT_ROOM_BOUNDS);
    const near = solveFocusDistance(0.3, 58, 16 / 9, limits.focusFill);
    const far = solveFocusDistance(1.2, 58, 16 / 9, limits.focusFill);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeCloseTo(near * 4, 6);
    // A wider field of view frames the same object from closer.
    expect(solveFocusDistance(0.6, 90, 16 / 9)).toBeLessThan(solveFocusDistance(0.6, 40, 16 / 9));

    // The controller derives its default distance from that same solve.
    const { camera, controller } = createHarness();
    const descriptor = { position: new THREE.Vector3(0, 1, -1), radius: 0.5 };
    const distance = controller.focus(descriptor);
    expect(distance).toBeCloseTo(
      solveFocusDistance(0.5, camera.fov, camera.aspect, controller.limits.focusFill),
      6,
    );
    controller.dispose();
  });

  it('frames a plain Object3D as readily as a hotspot contract value', () => {
    const { camera, controller } = createHarness();
    const group = new THREE.Group();
    group.position.set(1, 1, -1);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.4, 0.4),
      new THREE.MeshBasicMaterial(),
    );
    group.add(mesh);
    group.updateMatrixWorld(true);

    const distance = controller.focus(group);
    expect(distance).toBeGreaterThan(0.3);
    expect(camera.position.distanceTo(new THREE.Vector3(1, 1, -1))).toBeCloseTo(distance, 5);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    controller.dispose();
  });

  it('presents the close-up and restores the previous pose on exit', () => {
    const { camera, controller, document } = createHarness({ mode: 'walk' });
    controller.attach();

    document.dispatch('keydown', { code: 'KeyW' });
    document.dispatch('keydown', { code: 'ArrowLeft' });
    for (let step = 0; step < 40; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'KeyW' });
    document.dispatch('keyup', { code: 'ArrowLeft' });
    // Let the optional head bob settle so the comparison is exact.
    for (let step = 0; step < 30; step += 1) controller.update(1 / 60);

    const archived = controller.savePose();
    const cameraBefore = camera.position.clone();
    const quaternionBefore = camera.quaternion.clone();

    const counter: Hotspot = {
      id: 'counter',
      label: 'Counter',
      position: new THREE.Vector3(0, 0.9, -2.5),
      radius: 0.5,
      year: '1945',
      moduleId: 'environment',
      kind: 'interactive',
    };
    const distance = controller.inspect(counter, { distance: 1.3 });

    expect(controller.inspecting).toBe(true);
    expect(controller.focusDistance).toBeCloseTo(1.3, 5);
    expect(distance).toBeCloseTo(1.3, 5);
    expect(camera.position.distanceTo(counter.position)).toBeCloseTo(1.3, 5);
    expect(camera.position.distanceTo(cameraBefore)).toBeGreaterThan(0.5);

    const snapshot = controller.snapshot();
    console.log(`[navigation] inspect camera-state snapshot: ${JSON.stringify(snapshot)}`);
    expect(snapshot.inspecting).toBe(true);
    expect(snapshot.focusDistance).toBeCloseTo(1.3, 5);
    expect(Object.keys(snapshot.position).sort()).toEqual(['x', 'y', 'z']);

    expect(controller.exitInspect()).toBe(true);
    expect(controller.inspecting).toBe(false);
    expect(controller.mode).toBe('walk');
    expect(camera.position.distanceTo(cameraBefore)).toBeLessThan(1e-9);
    expect(camera.quaternion.angleTo(quaternionBefore)).toBeLessThan(1e-6);
    expect(controller.yaw).toBeCloseTo(archived.yaw, 9);
    expect(controller.eyeHeight).toBeCloseTo(archived.eyeHeight, 9);
    // Leaving inspect again is a no-op.
    expect(controller.exitInspect()).toBe(false);

    controller.dispose();
  });

  it('exits inspect mode with the Escape key', () => {
    const { camera, controller, document } = createHarness({ mode: 'walk' });
    controller.attach();

    const before = camera.position.clone();
    controller.inspect({ position: new THREE.Vector3(0, 1, -2), radius: 0.4 }, { distance: 1.4 });
    expect(controller.inspecting).toBe(true);

    document.dispatch('keydown', { code: 'Escape' });
    expect(controller.inspecting).toBe(false);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9);

    controller.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

describe('lifecycle', () => {
  it('detaches every listener and re-attaches into a working controller', () => {
    const { camera, controller, element, document } = createHarness({ mode: 'walk' });
    const elementBefore = element.listenerCount();
    const documentBefore = document.listenerCount();
    expect(elementBefore).toBe(0);
    expect(documentBefore).toBe(0);

    controller.attach();
    const stats = controller.getListenerStats();
    expect(stats.input).toBe(9);
    expect(stats.keyboard).toBe(2);
    expect(stats.document).toBe(2);
    expect(stats.frame).toBe(0);
    expect(controller.listenerCount).toBe(13);
    expect(element.listenerCount()).toBe(elementBefore + 9);
    expect(document.listenerCount()).toBe(documentBefore + 4);

    controller.detach();
    expect(controller.attached).toBe(false);
    expect(controller.listenerCount).toBe(0);
    expect(element.listenerCount()).toBe(elementBefore);
    expect(document.listenerCount()).toBe(documentBefore);

    // A second attach/drive cycle still moves the camera.
    controller.attach();
    expect(controller.listenerCount).toBe(13);
    const startZ = camera.position.z;
    document.dispatch('keydown', { code: 'KeyW' });
    for (let step = 0; step < 30; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'KeyW' });
    expect(camera.position.z).toBeLessThan(startZ - 0.5);

    controller.dispose();
    expect(controller.listenerCount).toBe(0);
    expect(element.listenerCount()).toBe(elementBefore);
    expect(document.listenerCount()).toBe(documentBefore);
    controller.dispose();
    expect(controller.listenerCount).toBe(0);

    // ... and a third cycle still works after dispose.
    controller.attach();
    const restartZ = camera.position.z;
    document.dispatch('keydown', { code: 'KeyW' });
    for (let step = 0; step < 30; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'KeyW' });
    expect(camera.position.z).toBeLessThan(restartZ - 0.5);
    controller.dispose();
  });

  it('releases an active pointer lock session on detach', () => {
    const { controller, element, document } = createHarness({ mode: 'walk' });
    controller.attach();
    document.lockTo(element as unknown as Element);
    expect(controller.pointerLocked).toBe(true);

    controller.detach();
    expect(controller.pointerLocked).toBe(false);
    expect(document.exitCalls).toBe(1);
  });

  it('subscribes to and releases the kernel frame loop without disturbing it', () => {
    const kernel = createKernel(null, { forceHeadless: true });
    openKernels.push(kernel);
    const element = createFakeElement();
    const document = createFakeDocument();
    const controller = new NavigationController({
      camera: kernel.camera,
      rig: kernel.cameraRig,
      bounds: kernel.bounds,
      element,
      ownerDocument: document,
      frameSource: kernel,
      mode: 'walk',
    });

    const listenersBefore = kernel.getListenerStats();
    controller.attach();
    expect(kernel.getListenerStats().frame).toBe(listenersBefore.frame + 1);
    expect(controller.getListenerStats().frame).toBe(1);

    const startZ = kernel.camera.position.z;
    document.dispatch('keydown', { code: 'KeyW' });
    for (let step = 0; step < 30; step += 1) kernel.update(1 / 60);
    document.dispatch('keyup', { code: 'KeyW' });
    expect(kernel.camera.position.z).toBeLessThan(startZ - 0.5);
    expect(kernel.isRunning).toBe(false);

    controller.dispose();
    expect(kernel.getListenerStats().frame).toBe(listenersBefore.frame);
    expect(controller.listenerCount).toBe(0);

    // The kernel keeps ticking after navigation detaches.
    const framesBefore = kernel.frame;
    kernel.update(1 / 60);
    expect(kernel.frame).toBe(framesBefore + 1);
  });
});

/* -------------------------------------------------------------------------- */
/* Motion preferences                                                         */
/* -------------------------------------------------------------------------- */

describe('reduced motion', () => {
  it('suppresses damping and head bob when reduced motion is requested', () => {
    const { camera, controller, document } = createHarness({ mode: 'walk', damping: 8 });
    controller.attach();
    controller.setReducedMotion(true);
    expect(controller.reducedMotion).toBe(true);

    const yawBefore = controller.yaw;
    document.dispatch('keydown', { code: 'ArrowLeft' });
    for (let step = 0; step < 60; step += 1) controller.update(1 / 60);
    document.dispatch('keyup', { code: 'ArrowLeft' });
    expect(controller.yaw).toBeGreaterThan(yawBefore);
    // No head bob: the camera height is exactly the eye height.
    expect(camera.position.y).toBeCloseTo(controller.eyeHeight, 9);

    // Reduced motion snaps orbit changes immediately instead of easing them.
    controller.setMode('orbit');
    const beforeOrbit = camera.position.clone();
    controller.orbit(0.4, 0.1);
    expect(camera.position.distanceTo(beforeOrbit)).toBeGreaterThan(0.1);

    controller.dispose();
  });

  it('eases poses while damping is active and snaps when motion is reduced', () => {
    const { camera, controller } = createHarness({ damping: 8 });
    controller.attach();

    const before = camera.position.clone();
    controller.orbit(0, -0.3);
    // Damped: the pose waits for the next tick instead of jumping.
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9);

    controller.update(1 / 60);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0);

    controller.setReducedMotion(true);
    const middle = camera.position.clone();
    controller.orbit(0.5, 0);
    expect(camera.position.distanceTo(middle)).toBeGreaterThan(0);

    controller.dispose();
  });

  it('re-reads the reduced-motion preference through refreshReducedMotion', () => {
    let reduced = false;
    const { controller } = createHarness({ prefersReducedMotion: () => reduced });
    expect(controller.reducedMotion).toBe(false);
    reduced = true;
    expect(controller.refreshReducedMotion()).toBe(true);
    expect(controller.reducedMotion).toBe(true);
    controller.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Input contract shapes                                                      */
/* -------------------------------------------------------------------------- */

describe('input surface contracts', () => {
  it('accepts real DOM elements, documents and a kernel as structural inputs', () => {
    // Type-level assertions: these assignments only compile when a real element,
    // a real document and the scene kernel satisfy the controller's contracts.
    const element: NavigationEventSource = {} as unknown as HTMLCanvasElement;
    const ownerDocument: NavigationDocumentSource = {} as unknown as Document;
    expect(element).toBeTypeOf('object');
    expect(ownerDocument).toBeTypeOf('object');

    const kernel = createKernel(null, { forceHeadless: true });
    openKernels.push(kernel);
    const controller = createNavigationController({
      camera: kernel.camera,
      bounds: kernel.bounds,
      frameSource: kernel,
      gamepadSource: null,
    });
    expect(controller).toBeInstanceOf(NavigationController);
    expect(controller.getListenerStats().total).toBe(0);

    // A supplied rig owns its camera; the controller poses that one.
    const decoy = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const rigged = createNavigationController({
      camera: decoy,
      rig: kernel.cameraRig,
      bounds: kernel.bounds,
      gamepadSource: null,
    });
    expect(rigged.camera).toBe(kernel.camera);
  });
});

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

/** Era fixture: the composition test needs a period to build the environment with. */
function periodFixture(year: '1945'): PeriodDefinition {
  return {
    year,
    label: year,
    name: `Environment fixture ${year}`,
    summary: 'Fixture era used by the navigation composition test.',
    palette: {
      background: '#101010',
      floor: '#202020',
      wall: '#303030',
      ceiling: '#404040',
      accent: '#505050',
      lamp: '#606060',
    },
    lighting: {
      ambientColor: '#111111',
      ambientIntensity: 0.4,
      keyColor: '#222222',
      keyIntensity: 1,
      fillColor: '#333333',
      fillIntensity: 0.3,
      lampColor: '#444444',
      lampIntensity: 10,
      fogDensity: 0,
    },
    details: ['fixture'],
  };
}

/**
 * Environment-shell shaped stub: the room module owns the `RoomBounds` and the
 * hotspot list the navigation controller must consume without knowing anything
 * about the domain module's internals.
 */
class StubEnvironmentModule implements SceneModule<DomainSpecBase> {
  readonly id = 'environment';
  readonly spec: DomainSpecBase = { year: '1945', label: 'Environment shell stub' };
  readonly root = new THREE.Group();
  readonly bounds: RoomBounds;
  buildCount = 0;
  disposeCount = 0;
  private readonly hotspots: readonly Hotspot[];

  constructor(bounds: RoomBounds) {
    this.bounds = bounds;
    this.hotspots = [
      {
        id: 'counter',
        label: 'Counter',
        description: 'Where the espresso machine lives.',
        position: new THREE.Vector3(0, 0.95, -3.2),
        radius: 0.6,
        year: '1945',
        moduleId: this.id,
        kind: 'interactive',
      },
      {
        id: 'window',
        label: 'Shop window',
        position: new THREE.Vector3(-3.4, 1.5, 0),
        radius: 0.9,
        year: '1945',
        moduleId: this.id,
        kind: 'info',
      },
    ];
  }

  build(context: BuildContext): void {
    this.buildCount += 1;
    this.root.name = `${this.id}-${context.year}`;
    context.root.add(this.root);
  }

  applyPeriod(): void {
    /* The stub shell has no era specific surfaces. */
  }

  update(): void {
    /* Static shell. */
  }

  dispose(): void {
    this.disposeCount += 1;
    this.root.removeFromParent();
  }

  getHotspots(): readonly Hotspot[] {
    return this.hotspots;
  }
}

describe('composition with a real camera and an environment-shaped bounds provider', () => {
  it('traverses every boundary, frames a hotspot and restores poses', () => {
    const environment = new StubEnvironmentModule(DEFAULT_ROOM_BOUNDS);
    const kernel = createKernel(null, { forceHeadless: true, bounds: environment.bounds });
    openKernels.push(kernel);
    environment.build(kernel.createBuildContext(periodFixture('1945')));
    expect(environment.buildCount).toBe(1);
    expect(environment.root.parent).toBe(kernel.world);

    const element = createFakeElement();
    const document = createFakeDocument();
    const navigation = createNavigationController({
      camera: kernel.camera,
      rig: kernel.cameraRig,
      bounds: environment.bounds,
      element,
      ownerDocument: document,
      frameSource: kernel,
      mode: 'walk',
    });
    navigation.attach();
    expect(navigation.attached).toBe(true);

    const interior = navigationInterior(environment.bounds, navigation.limits);
    let violation = 0;
    const drive = (code: string, steps: number): void => {
      document.dispatch('keydown', { code });
      for (let step = 0; step < steps; step += 1) {
        kernel.update(1 / 60);
        violation = Math.max(violation, containmentViolation(kernel.camera.position, interior));
      }
      document.dispatch('keyup', { code });
    };

    // Full traversal into every wall of the environment shell.
    drive('KeyW', 600);
    expect(kernel.camera.position.z).toBeCloseTo(interior.minZ, 2);
    drive('KeyS', 1200);
    expect(kernel.camera.position.z).toBeCloseTo(interior.maxZ, 2);
    drive('KeyD', 1200);
    expect(kernel.camera.position.x).toBeCloseTo(interior.maxX, 2);
    drive('KeyA', 1200);
    expect(kernel.camera.position.x).toBeCloseTo(interior.minX, 2);

    // Settle the optional micro-motion, then archive the pose we must return to.
    for (let step = 0; step < 30; step += 1) kernel.update(1 / 60);
    const walkPose = navigation.savePose();
    const cameraBefore = kernel.camera.position.clone();
    expect(navigation.mode).toBe('walk');

    // Orbit into the floor and the ceiling from inside the room.
    navigation.setMode('orbit');
    navigation.setDistance(navigation.limits.maxDistance);
    for (let step = 0; step < 240; step += 1) {
      navigation.orbit(0.05, step % 2 === 0 ? 0.6 : -0.6);
      kernel.update(1 / 120);
      violation = Math.max(violation, containmentViolation(kernel.camera.position, interior));
    }
    expect(kernel.camera.position.y).toBeGreaterThanOrEqual(interior.minY - 1e-6);
    expect(kernel.camera.position.y).toBeLessThanOrEqual(interior.maxY + 1e-6);

    // Restoring the archived pose returns the visitor to the walk vantage.
    navigation.restorePose(walkPose);
    expect(navigation.mode).toBe('walk');
    expect(kernel.camera.position.distanceTo(cameraBefore)).toBeLessThan(1e-6);

    // Focus the counter hotspot registered by the environment module.
    const counter = environment.getHotspots()[0];
    expect(counter).toBeDefined();
    if (!counter) throw new Error('environment stub must expose a counter hotspot');

    const distance = navigation.inspect(counter, { distance: 1.6 });
    expect(navigation.inspecting).toBe(true);
    expect(distance).toBeCloseTo(1.6, 5);
    expect(kernel.camera.position.distanceTo(counter.position)).toBeCloseTo(1.6, 5);
    expect(containmentViolation(kernel.camera.position, interior)).toBeLessThanOrEqual(1e-6);

    const snapshot = navigation.snapshot();
    console.log(`[navigation] composition camera-state snapshot: ${JSON.stringify(snapshot)}`);
    expect(snapshot.mode).toBe('orbit');
    expect(snapshot.inspecting).toBe(true);
    expect(snapshot.focusDistance).toBeCloseTo(1.6, 5);
    expect(snapshot.position).toBeDefined();
    expect(snapshot.target).toBeDefined();

    // Escape / exitInspect returns to the archived pose.
    expect(navigation.exitInspect()).toBe(true);
    expect(navigation.inspecting).toBe(false);
    expect(navigation.mode).toBe('walk');
    expect(kernel.camera.position.distanceTo(cameraBefore)).toBeLessThan(1e-6);

    // Detaching leaves the kernel loop and listener set exactly as they were.
    const frameListeners = kernel.getListenerStats().frame;
    navigation.dispose();
    expect(navigation.listenerCount).toBe(0);
    expect(kernel.getListenerStats().frame).toBe(frameListeners - 1);
    expect(element.listenerCount()).toBe(0);
    expect(document.listenerCount()).toBe(0);
    expect(violation).toBeLessThanOrEqual(1e-6);

    environment.dispose();
    expect(environment.disposeCount).toBe(1);
  });
});
