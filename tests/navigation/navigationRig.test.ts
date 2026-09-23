/**
 * Chrono City — navigation rig composition suite.
 *
 * Proves the navigation contract end to end against the real `SceneContext`
 * tick registry in jsdom (stubbed renderer, no GPU):
 *
 *  - the rig registers its tick with `SceneContext` and drives the shared
 *    camera before every other system, exposing a frozen read-only state
 *  - pointer drag orbits the block with damped, frame-rate independent motion
 *    and pointer lock / wheel zoom are clamped to the orbit limits
 *  - WASD walking is bounded by the shared `BlockLayout` constants, keeps the
 *    eye inside the 1.6-1.8 m band and cannot leave the walkable rectangle
 *  - touch users get an analog joystick plus drag-look, with pinch zoom
 *
 * Every interaction in this suite is delivered as a real DOM event on the real
 * canvas / window, so the specs fail if the rig stops listening.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { BLOCK, CELL, SIDEWALK_CENTER_Z } from '../../src/core/blockLayout';
import { SceneContext, createSceneContext, type SceneContextOptions } from '../../src/core/sceneContext';
import {
  DEFAULT_MAX_DISTANCE,
  DEFAULT_MAX_EYE_HEIGHT,
  DEFAULT_MAX_ORBIT_PITCH,
  DEFAULT_MAX_WALK_PITCH,
  DEFAULT_MIN_DISTANCE,
  DEFAULT_MIN_EYE_HEIGHT,
  DEFAULT_MIN_ORBIT_PITCH,
  DEFAULT_ORBIT_DISTANCE,
  DEFAULT_ORBIT_TARGET_HEIGHT,
  MovementController,
  distanceBetween,
} from '../../src/navigation/movementController';
import {
  DEFAULT_BLOCK_MARGIN,
  NAVIGATION_RIG_VERSION,
  NAVIGATION_SYSTEM_ID,
  NAVIGATION_SYSTEM_ORDER,
  NavigationRig,
  blockWalkSpawn,
  createBlockWalkBounds,
  createNavigationRig,
  type NavigationRigOptions,
} from '../../src/navigation/navigationRig';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

interface StubRenderer {
  renderer: THREE.WebGLRenderer;
  renderCount(): number;
  disposeCount(): number;
  runFrame(): void;
}

function createStubRenderer(canvas: HTMLCanvasElement): StubRenderer {
  let renders = 0;
  let disposals = 0;
  let loop: (() => void) | null = null;

  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    render: () => {
      renders += 1;
    },
    setAnimationLoop: (callback: (() => void) | null) => {
      loop = callback;
    },
    dispose: () => {
      disposals += 1;
    },
  };

  return {
    renderer: stub as unknown as THREE.WebGLRenderer,
    renderCount: () => renders,
    disposeCount: () => disposals,
    runFrame: () => loop?.(),
  };
}

interface RigHarness {
  context: SceneContext;
  rig: NavigationRig;
  canvas: HTMLCanvasElement;
  overlayRoot: HTMLElement;
  stub: StubRenderer;
}

const openHarnesses: RigHarness[] = [];

afterEach(() => {
  while (openHarnesses.length > 0) {
    const harness = openHarnesses.pop();
    harness?.rig.dispose();
    harness?.context.dispose();
  }
  Reflect.deleteProperty(document, 'pointerLockElement');
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function openRig(options: NavigationRigOptions = {}, contextOptions: SceneContextOptions = {}): RigHarness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const canvas = document.createElement('canvas');
  const overlayRoot = document.createElement('div');
  container.appendChild(canvas);
  container.appendChild(overlayRoot);

  const stub = createStubRenderer(canvas);
  const context = createSceneContext({
    canvas,
    container,
    overlayRoot,
    seed: 7,
    autoResize: false,
    autoStart: false,
    maxPixelRatio: 1,
    createRenderer: () => stub.renderer,
    ...contextOptions,
  });

  const rig = createNavigationRig(context, options);
  const harness: RigHarness = { context, rig, canvas, overlayRoot, stub };
  openHarnesses.push(harness);
  return harness;
}

function runFrames(context: SceneContext, frames: number, delta = 1 / 60): void {
  for (let frame = 0; frame < frames; frame += 1) context.tick(delta);
}

function requireElement<T extends Element>(element: T | null | undefined): T {
  if (!element) throw new Error('expected the navigation rig to create this element');
  return element;
}

/* ------------------------------------------------------------------ */
/* Event helpers — real DOM events, as a browser would deliver them     */
/* ------------------------------------------------------------------ */

function pointerEvent(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    isPrimary: true,
    button: 0,
    ...init,
  });
}

function keyEvent(type: 'keydown' | 'keyup', code: string): KeyboardEvent {
  return new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true });
}

function wheelEvent(deltaY: number): WheelEvent {
  return new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
}

function mouseMove(movementX: number, movementY = 0): MouseEvent {
  return new MouseEvent('mousemove', { bubbles: true, cancelable: true, movementX, movementY });
}

interface TouchSpec {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

function touchEvent(type: string, points: readonly TouchSpec[]): Event {
  const event = new TouchEvent(type, { bubbles: true, cancelable: true });
  const list = points.map((point) => ({
    identifier: point.id,
    clientX: point.x,
    clientY: point.y,
    target: null,
  }));
  Object.defineProperty(event, 'touches', { value: list, configurable: true });
  Object.defineProperty(event, 'changedTouches', { value: list, configurable: true });
  return event;
}

/** Drags with a real pointer sequence: down on the canvas, move/up on `window`. */
function dragCanvas(
  harness: RigHarness,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerId = 1,
): void {
  harness.canvas.dispatchEvent(
    pointerEvent('pointerdown', { clientX: from.x, clientY: from.y, pointerId }),
  );
  window.dispatchEvent(pointerEvent('pointermove', { clientX: to.x, clientY: to.y, pointerId }));
  window.dispatchEvent(pointerEvent('pointerup', { clientX: to.x, clientY: to.y, pointerId }));
}

/** Simulates the browser granting or releasing pointer lock on the canvas. */
function lockPointer(canvas: HTMLCanvasElement, locked: boolean): void {
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => (locked ? canvas : null),
  });
  document.dispatchEvent(new Event('pointerlockchange'));
}

function joystickRect(): DOMRect {
  return {
    left: 300,
    top: 600,
    width: 120,
    height: 120,
    right: 420,
    bottom: 720,
    x: 300,
    y: 600,
  } as unknown as DOMRect;
}

/* ------------------------------------------------------------------ */
/* Registration + read-only camera state                               */
/* ------------------------------------------------------------------ */

describe('NavigationRig — SceneContext integration', () => {
  it('registers its tick with SceneContext and drives the shared camera first', () => {
    const { context, rig } = openRig();

    expect(rig).toBeInstanceOf(NavigationRig);
    expect(rig.version).toBe(NAVIGATION_RIG_VERSION);
    expect(context.hasSystem(NAVIGATION_SYSTEM_ID)).toBe(true);
    expect(context.getSystem(NAVIGATION_SYSTEM_ID)?.order).toBe(NAVIGATION_SYSTEM_ORDER);
    // Negative order: the rig resolves the camera before any consumer ticks.
    expect(context.getSystems()[0]?.id).toBe(NAVIGATION_SYSTEM_ID);

    const observed: Array<{ x: number; y: number; z: number; frame: number }> = [];
    context.registerSystem('inspection-probe', (ctx, frame) => {
      observed.push({ x: ctx.camera.position.x, y: ctx.camera.position.y, z: ctx.camera.position.z, frame: frame.frame });
    });

    context.tick(1 / 60);

    expect(observed).toHaveLength(1);
    // The probe saw the pose the rig produced on this very frame.
    expect(observed[0].x).toBeCloseTo(rig.state.position.x, 9);
    expect(observed[0].y).toBeCloseTo(rig.state.position.y, 9);
    expect(observed[0].z).toBeCloseTo(rig.state.position.z, 9);
    expect(rig.state.frame).toBe(1);
    expect(rig.state.mode).toBe('orbit');

    // The camera really looks at the orbit pivot.
    const direction = context.camera.getWorldDirection(new THREE.Vector3());
    const expected = new THREE.Vector3(
      rig.state.target.x - rig.state.position.x,
      rig.state.target.y - rig.state.position.y,
      rig.state.target.z - rig.state.position.z,
    ).normalize();
    expect(direction.dot(expected)).toBeCloseTo(1, 6);
  });

  it('exposes frozen read-only camera state instead of a mutable camera handle', () => {
    const { context, rig } = openRig();

    const state = rig.state;
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.position)).toBe(true);
    expect(Object.isFrozen(state.target)).toBe(true);
    expect(Object.isFrozen(state.bounds)).toBe(true);

    // Consumers cannot mutate the camera by writing to the snapshot.
    expect(Reflect.set(state.position, 'x', 999)).toBe(false);
    expect(Reflect.set(state, 'mode', 'walk')).toBe(false);

    const cameraX = context.camera.position.x;
    context.tick(1 / 60);
    expect(state.position.x).not.toBe(999);
    expect(context.camera.position.x).toBeCloseTo(cameraX, 9);
  });

  it('stops driving the camera and removes its controls once disposed', () => {
    const { context, rig, overlayRoot, canvas } = openRig();
    const controlsRoot = requireElement(rig.controls.root);
    expect(overlayRoot.contains(controlsRoot)).toBe(true);

    const frozen = { ...rig.state.position };
    rig.dispose();

    expect(context.hasSystem(NAVIGATION_SYSTEM_ID)).toBe(false);
    expect(controlsRoot.isConnected).toBe(false);

    window.dispatchEvent(keyEvent('keydown', 'KeyW'));
    canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 200, clientY: 10 }));
    window.dispatchEvent(pointerEvent('pointerup', { clientX: 200, clientY: 10 }));
    runFrames(context, 60);

    expect(context.camera.position.x).toBeCloseTo(frozen.x, 9);
    expect(context.camera.position.y).toBeCloseTo(frozen.y, 9);
    expect(context.camera.position.z).toBeCloseTo(frozen.z, 9);
  });
});

/* ------------------------------------------------------------------ */
/* Orbit inspection                                                    */
/* ------------------------------------------------------------------ */

describe('NavigationRig — orbit inspection', () => {
  it('orbits the block on pointer drag with damped motion that keeps easing', () => {
    const { context, rig, canvas } = openRig();

    const start = { ...rig.state.position };
    expect(rig.state.distance).toBeCloseTo(DEFAULT_ORBIT_DISTANCE, 6);
    expect(rig.state.target.y).toBeCloseTo(DEFAULT_ORBIT_TARGET_HEIGHT, 6);

    canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 400, clientY: 300 }));
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 520, clientY: 300 }));
    window.dispatchEvent(pointerEvent('pointerup', { clientX: 520, clientY: 300 }));

    context.tick(1 / 60);
    const afterOneFrame = distanceBetween(start, rig.state.position);

    runFrames(context, 120);
    const settled = { ...rig.state.position };
    const afterSettling = distanceBetween(start, settled);

    // The camera moved a long way around the block...
    expect(afterSettling).toBeGreaterThan(20);
    // ...but not on the first frame: the motion is eased, not raw pointer mapping.
    expect(afterOneFrame).toBeGreaterThan(0.2);
    expect(afterOneFrame).toBeLessThan(afterSettling * 0.5);

    // A rightward drag turns the view to the right (yaw decreases).
    expect(rig.state.yaw).toBeCloseTo(-0.384, 2);

    // Once the damping settles, the camera stops moving.
    runFrames(context, 120);
    expect(distanceBetween(settled, rig.state.position)).toBeLessThan(1e-6);
    // The orbit radius is preserved while swinging around the pivot.
    expect(distanceBetween(rig.state.position, rig.state.target)).toBeCloseTo(
      rig.state.distance,
      6,
    );
  });

  it('produces the same pose for the same input at 60 fps and at 10 fps', () => {
    const fast = openRig();
    const slow = openRig();

    for (const harness of [fast, slow]) {
      dragCanvas(harness, { x: 400, y: 300 }, { x: 460, y: 340 });
    }

    runFrames(fast.context, 60, 1 / 60);
    runFrames(slow.context, 10, 1 / 10);

    expect(fast.rig.state.position.x).toBeCloseTo(slow.rig.state.position.x, 6);
    expect(fast.rig.state.position.y).toBeCloseTo(slow.rig.state.position.y, 6);
    expect(fast.rig.state.position.z).toBeCloseTo(slow.rig.state.position.z, 6);
    expect(fast.rig.state.yaw).toBeCloseTo(slow.rig.state.yaw, 6);
  });

  it('clamps wheel zoom between the configured distance limits', () => {
    const { context, rig, canvas } = openRig();

    for (let step = 0; step < 12; step += 1) canvas.dispatchEvent(wheelEvent(-240));
    runFrames(context, 240);

    expect(rig.state.distance).toBeCloseTo(DEFAULT_MIN_DISTANCE, 3);
    expect(distanceBetween(rig.state.position, rig.state.target)).toBeCloseTo(
      DEFAULT_MIN_DISTANCE,
      3,
    );

    for (let step = 0; step < 12; step += 1) canvas.dispatchEvent(wheelEvent(240));
    runFrames(context, 400);

    expect(rig.state.distance).toBeCloseTo(DEFAULT_MAX_DISTANCE, 3);
  });

  it('honours custom zoom limits and keeps the orbit camera above the ground', () => {
    const rigHarness = openRig({ minDistance: 40, maxDistance: 60 });
    const { context, rig, canvas } = rigHarness;

    for (let step = 0; step < 12; step += 1) canvas.dispatchEvent(wheelEvent(-240));
    runFrames(context, 240);
    expect(rig.state.distance).toBeCloseTo(40, 3);

    for (let step = 0; step < 12; step += 1) canvas.dispatchEvent(wheelEvent(240));
    runFrames(context, 400);
    expect(rig.state.distance).toBeCloseTo(60, 3);

    // Pitch is clamped, so the camera never dives under the block.
    dragCanvas(rigHarness, { x: 400, y: 300 }, { x: 400, y: 9000 }, 4);
    runFrames(context, 240);
    expect(rig.state.pitch).toBeCloseTo(DEFAULT_MAX_ORBIT_PITCH, 3);
    expect(rig.state.position.y).toBeGreaterThan(2);

    dragCanvas(rigHarness, { x: 400, y: 300 }, { x: 400, y: -9000 }, 5);
    runFrames(context, 240);
    expect(rig.state.pitch).toBeCloseTo(DEFAULT_MIN_ORBIT_PITCH, 3);
    expect(rig.state.position.y).toBeGreaterThan(2);
  });

  it('ignores movement keys while inspecting', () => {
    const { context, rig } = openRig();
    const before = { ...rig.state.position };

    window.dispatchEvent(keyEvent('keydown', 'KeyW'));
    window.dispatchEvent(keyEvent('keydown', 'KeyD'));
    runFrames(context, 60);
    window.dispatchEvent(keyEvent('keyup', 'KeyW'));
    window.dispatchEvent(keyEvent('keyup', 'KeyD'));

    expect(rig.state.mode).toBe('orbit');
    expect(distanceBetween(rig.state.position, before)).toBeLessThan(1e-9);
  });
});

/* ------------------------------------------------------------------ */
/* Mode switching                                                      */
/* ------------------------------------------------------------------ */

describe('NavigationRig — mode switching', () => {
  it('switches between orbit inspection and walking from the overlay control', () => {
    const { rig } = openRig();
    const toggle = requireElement(rig.controls.modeToggle);

    expect(rig.state.mode).toBe('orbit');
    expect(toggle.textContent).toBe('Orbit');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();

    expect(rig.state.mode).toBe('walk');
    expect(toggle.textContent).toBe('Walk');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    // Walking starts on the shared BlockLayout sidewalk, at eye height.
    expect(rig.state.position.z).toBeCloseTo(SIDEWALK_CENTER_Z, 6);
    expect(rig.state.position.x).toBeCloseTo(BLOCK.center.x, 6);
    expect(rig.state.position.y).toBeGreaterThanOrEqual(DEFAULT_MIN_EYE_HEIGHT);
    expect(rig.state.position.y).toBeLessThanOrEqual(DEFAULT_MAX_EYE_HEIGHT);

    toggle.click();

    expect(rig.state.mode).toBe('orbit');
    expect(toggle.textContent).toBe('Orbit');
    expect(rig.state.position.y).toBeGreaterThan(DEFAULT_MAX_EYE_HEIGHT);
  });

  it('toggles with the F key and keeps the toolchain headless-safe', () => {
    const { rig } = openRig();

    window.dispatchEvent(keyEvent('keydown', 'KeyF'));
    expect(rig.state.mode).toBe('walk');
    window.dispatchEvent(keyEvent('keyup', 'KeyF'));

    window.dispatchEvent(keyEvent('keydown', 'KeyF'));
    expect(rig.state.mode).toBe('orbit');
  });
});

/* ------------------------------------------------------------------ */
/* Walk bounds derived from BlockLayout                                */
/* ------------------------------------------------------------------ */

describe('NavigationRig — block bounds', () => {
  it('derives the walkable rectangle from the shared BlockLayout constants', () => {
    const bounds = createBlockWalkBounds();

    expect(bounds).toEqual({
      minX: CELL.minX + DEFAULT_BLOCK_MARGIN,
      maxX: CELL.maxX - DEFAULT_BLOCK_MARGIN,
      minZ: CELL.minZ + DEFAULT_BLOCK_MARGIN,
      maxZ: CELL.maxZ - DEFAULT_BLOCK_MARGIN,
    });
    expect(createBlockWalkBounds(4)).toEqual({
      minX: CELL.minX + 4,
      maxX: CELL.maxX - 4,
      minZ: CELL.minZ + 4,
      maxZ: CELL.maxZ - 4,
    });
    expect(blockWalkSpawn()).toEqual({ x: BLOCK.center.x, z: SIDEWALK_CENTER_Z });

    const { rig } = openRig();
    expect(rig.state.bounds).toEqual(bounds);
  });

  it('prefers an explicit bounds override when one is supplied', () => {
    const explicit = { minX: -10, maxX: 10, minZ: -5, maxZ: 5 };
    const { context, rig } = openRig({ mode: 'walk', bounds: explicit });

    expect(rig.state.bounds).toEqual(explicit);

    window.dispatchEvent(keyEvent('keydown', 'KeyA'));
    runFrames(context, 600);
    window.dispatchEvent(keyEvent('keyup', 'KeyA'));

    expect(rig.state.position.x).toBeCloseTo(explicit.minX, 3);
  });
});

/* ------------------------------------------------------------------ */
/* First-person walking                                                */
/* ------------------------------------------------------------------ */

describe('NavigationRig — first-person walk', () => {
  it('walks the block with WASD at a clamped eye height', () => {
    const { context, rig } = openRig({ mode: 'walk' });
    const spawn = { ...rig.state.position };
    const eyeSamples: number[] = [];

    window.dispatchEvent(keyEvent('keydown', 'KeyW'));
    for (let frame = 0; frame < 90; frame += 1) {
      context.tick(1 / 60);
      eyeSamples.push(rig.state.position.y);
    }
    window.dispatchEvent(keyEvent('keyup', 'KeyW'));

    // W walks north (towards the block) from the south sidewalk spawn.
    expect(rig.state.position.z).toBeLessThan(spawn.z - 3);
    expect(rig.state.position.x).toBeCloseTo(spawn.x, 3);
    expect(eyeSamples.every((y) => y >= DEFAULT_MIN_EYE_HEIGHT && y <= DEFAULT_MAX_EYE_HEIGHT)).toBe(
      true,
    );

    // Releasing the key damps the walker to a stop.
    runFrames(context, 60);
    const resting = { ...rig.state.position };
    runFrames(context, 60);
    expect(distanceBetween(resting, rig.state.position)).toBeLessThan(0.05);

    // D strafes east, A strafes west.
    window.dispatchEvent(keyEvent('keydown', 'KeyD'));
    runFrames(context, 60);
    window.dispatchEvent(keyEvent('keyup', 'KeyD'));
    expect(rig.state.position.x).toBeGreaterThan(resting.x + 1);

    const afterStrafe = { ...rig.state.position };
    window.dispatchEvent(keyEvent('keydown', 'KeyA'));
    runFrames(context, 120);
    window.dispatchEvent(keyEvent('keyup', 'KeyA'));
    expect(rig.state.position.x).toBeLessThan(afterStrafe.x - 1);

    // S walks back south, and the arrow keys mirror WASD.
    const afterLeft = { ...rig.state.position };
    window.dispatchEvent(keyEvent('keydown', 'ArrowDown'));
    runFrames(context, 90);
    window.dispatchEvent(keyEvent('keyup', 'ArrowDown'));
    expect(rig.state.position.z).toBeGreaterThan(afterLeft.z + 2);
  });

  it('keeps the eye inside the 1.6-1.8 m band while walking and while idle', () => {
    const { context, rig } = openRig({ mode: 'walk' });

    // Idle: head bob is damped out, and the eye never leaves the band.
    for (let frame = 0; frame < 60; frame += 1) {
      context.tick(1 / 60);
      expect(rig.state.position.y).toBeGreaterThanOrEqual(DEFAULT_MIN_EYE_HEIGHT);
      expect(rig.state.position.y).toBeLessThanOrEqual(DEFAULT_MAX_EYE_HEIGHT);
    }
    expect(rig.state.position.y).toBeCloseTo(1.7, 6);
    expect(rig.state.eyeHeight).toBe(rig.state.position.y);

    window.dispatchEvent(keyEvent('keydown', 'KeyW'));
    for (let frame = 0; frame < 300; frame += 1) {
      context.tick(1 / 60);
      expect(rig.state.position.y).toBeGreaterThanOrEqual(DEFAULT_MIN_EYE_HEIGHT);
      expect(rig.state.position.y).toBeLessThanOrEqual(DEFAULT_MAX_EYE_HEIGHT);
    }
    window.dispatchEvent(keyEvent('keyup', 'KeyW'));
    expect(rig.state.moving).toBe(true);
  });

  it('clamps the walker to the block bounds when walking into the edge', () => {
    const { context, rig } = openRig({ mode: 'walk' });
    const bounds = rig.state.bounds;

    window.dispatchEvent(keyEvent('keydown', 'KeyW'));
    window.dispatchEvent(keyEvent('keydown', 'KeyA'));

    let inside = true;
    for (let frame = 0; frame < 1500; frame += 1) {
      context.tick(1 / 60);
      const position = rig.state.position;
      inside =
        inside &&
        position.x >= bounds.minX - 1e-6 &&
        position.x <= bounds.maxX + 1e-6 &&
        position.z >= bounds.minZ - 1e-6 &&
        position.z <= bounds.maxZ + 1e-6;
    }

    expect(inside).toBe(true);
    // The north-west corner of the layout is exactly where the shared constants put it.
    expect(rig.state.position.z).toBeCloseTo(bounds.minZ, 3);
    expect(rig.state.position.x).toBeCloseTo(bounds.minX, 3);
    expect(bounds.minZ).toBe(CELL.minZ + DEFAULT_BLOCK_MARGIN);
    expect(bounds.minX).toBe(CELL.minX + DEFAULT_BLOCK_MARGIN);

    // Holding into the wall cannot push the walker through it.
    const pinned = { ...rig.state.position };
    runFrames(context, 180);
    expect(distanceBetween(pinned, rig.state.position)).toBeLessThan(1e-6);

    window.dispatchEvent(keyEvent('keyup', 'KeyW'));
    window.dispatchEvent(keyEvent('keyup', 'KeyA'));
  });

  it('sprints with Shift while Shift is held', () => {
    const { context, rig } = openRig({ mode: 'walk' });

    window.dispatchEvent(keyEvent('keydown', 'KeyW'));
    runFrames(context, 60);
    const walkStart = rig.state.position.z;
    runFrames(context, 60);
    const walkDistance = walkStart - rig.state.position.z;

    window.dispatchEvent(keyEvent('keydown', 'ShiftLeft'));
    runFrames(context, 60);
    const sprintStart = rig.state.position.z;
    runFrames(context, 60);
    const sprintDistance = sprintStart - rig.state.position.z;

    expect(walkDistance).toBeGreaterThan(3);
    expect(sprintDistance).toBeGreaterThan(walkDistance * 1.4);
  });

  it('looks around with drag-look and clamps the walk pitch', () => {
    const rigHarness = openRig({ mode: 'walk' });
    const { context, rig } = rigHarness;

    // Drag right turns the view right.
    dragCanvas(rigHarness, { x: 400, y: 300 }, { x: 520, y: 300 }, 11);
    runFrames(context, 60);
    const turnedYaw = rig.state.yaw;
    expect(turnedYaw).toBeLessThan(-0.3);

    // Drag far up: the pitch stops at the walk limit and the camera looks up.
    dragCanvas(rigHarness, { x: 400, y: 400 }, { x: 400, y: -5000 }, 12);
    runFrames(context, 120);
    expect(rig.state.pitch).toBeCloseTo(DEFAULT_MAX_WALK_PITCH, 3);
    let forward = context.camera.getWorldDirection(new THREE.Vector3());
    expect(forward.y).toBeCloseTo(Math.sin(rig.state.pitch), 4);
    expect(forward.y).toBeGreaterThan(0.9);

    // Drag far down: the pitch stops at the other limit.
    dragCanvas(rigHarness, { x: 400, y: 400 }, { x: 400, y: 9000 }, 13);
    runFrames(context, 120);
    expect(rig.state.pitch).toBeCloseTo(-DEFAULT_MAX_WALK_PITCH, 3);
    forward = context.camera.getWorldDirection(new THREE.Vector3());
    expect(forward.y).toBeCloseTo(Math.sin(rig.state.pitch), 4);
    expect(forward.y).toBeLessThan(-0.9);
  });

  it('honours pointer-lock look deltas only while the lock is held', () => {
    const { context, rig, canvas } = openRig({ mode: 'walk' });
    const startYaw = rig.state.yaw;

    // jsdom has no Pointer Lock API: asking must fail gracefully, and a canvas
    // click in walk mode must still work as a drag.
    expect(rig.requestPointerLock()).toBe(false);
    expect(() =>
      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 21 })),
    ).not.toThrow();
    window.dispatchEvent(pointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 21 }));
    runFrames(context, 5);

    // Without a lock, bare movement deltas are ignored.
    document.dispatchEvent(mouseMove(200));
    runFrames(context, 20);
    expect(rig.state.yaw).toBeCloseTo(startYaw, 6);

    // With the lock held, movement deltas drive the look.
    lockPointer(canvas, true);
    expect(rig.pointerLocked).toBe(true);
    expect(rig.state.pointerLocked).toBe(true);
    document.dispatchEvent(mouseMove(120));
    runFrames(context, 120);
    expect(rig.state.yaw).toBeCloseTo(startYaw - 120 * 0.0032, 3);

    // Releasing the lock stops the deltas again: with the view already settled,
    // extra movement deltas cannot change the heading at all.
    lockPointer(canvas, false);
    expect(rig.pointerLocked).toBe(false);
    const lockedYaw = rig.state.yaw;
    document.dispatchEvent(mouseMove(300));
    runFrames(context, 40);
    expect(rig.state.yaw).toBeCloseTo(lockedYaw, 9);
  });
});

/* ------------------------------------------------------------------ */
/* Touch controls                                                      */
/* ------------------------------------------------------------------ */

describe('NavigationRig — touch input on a mobile viewport', () => {
  it('walks with the joystick and looks with a drag on a 390x844 viewport', () => {
    const { context, rig, canvas } = openRig({ mode: 'walk', touch: true });

    context.resize(390, 844);
    expect(context.viewport).toEqual({ width: 390, height: 844 });

    const joystick = requireElement(rig.controls.joystick);
    expect(joystick.getAttribute('aria-hidden')).toBe('false');
    expect(joystick.style.display).toBe('block');
    joystick.getBoundingClientRect = () => joystickRect();

    const spawn = { ...rig.state.position };
    joystick.dispatchEvent(
      pointerEvent('pointerdown', {
        clientX: 360,
        clientY: 660,
        pointerId: 31,
        pointerType: 'touch',
      }),
    );
    // Push the stick "up" (screen -Y) means walk forwards.
    window.dispatchEvent(
      pointerEvent('pointermove', {
        clientX: 360,
        clientY: 600,
        pointerId: 31,
        pointerType: 'touch',
      }),
    );
    runFrames(context, 60);

    expect(rig.state.position.z).toBeLessThan(spawn.z - 2);
    expect(rig.state.position.y).toBeGreaterThanOrEqual(DEFAULT_MIN_EYE_HEIGHT);
    expect(rig.state.position.y).toBeLessThanOrEqual(DEFAULT_MAX_EYE_HEIGHT);

    window.dispatchEvent(
      pointerEvent('pointerup', {
        clientX: 360,
        clientY: 600,
        pointerId: 31,
        pointerType: 'touch',
      }),
    );
    runFrames(context, 90);
    const resting = { ...rig.state.position };
    runFrames(context, 60);
    expect(distanceBetween(resting, rig.state.position)).toBeLessThan(0.05);

    // Drag-look with one finger on the canvas.
    const yawBefore = rig.state.yaw;
    canvas.dispatchEvent(touchEvent('touchstart', [{ id: 1, x: 200, y: 400 }]));
    canvas.dispatchEvent(touchEvent('touchmove', [{ id: 1, x: 320, y: 400 }]));
    canvas.dispatchEvent(touchEvent('touchend', []));
    runFrames(context, 40);

    expect(rig.state.yaw).toBeLessThan(yawBefore - 0.2);
  });

  it('pinch-zooms the orbit view with two fingers', () => {
    const { context, rig, canvas } = openRig({ touch: true });

    const before = rig.state.distance;
    canvas.dispatchEvent(
      touchEvent('touchstart', [
        { id: 2, x: 200, y: 400 },
        { id: 3, x: 260, y: 400 },
      ]),
    );
    // Spreading the fingers zooms in (distance shrinks).
    canvas.dispatchEvent(
      touchEvent('touchmove', [
        { id: 2, x: 180, y: 400 },
        { id: 3, x: 280, y: 400 },
      ]),
    );
    runFrames(context, 120);
    canvas.dispatchEvent(touchEvent('touchend', []));

    expect(rig.state.distance).toBeLessThan(before);
    expect(rig.state.distance).toBeGreaterThanOrEqual(DEFAULT_MIN_DISTANCE);

    // Pinching the fingers together widens the view again, towards the zoom limit.
    const pinched = rig.state.distance;
    for (let step = 0; step < 8; step += 1) {
      canvas.dispatchEvent(
        touchEvent('touchstart', [
          { id: 4, x: 200, y: 400 },
          { id: 5, x: 260, y: 400 },
        ]),
      );
      canvas.dispatchEvent(
        touchEvent('touchmove', [
          { id: 4, x: 225, y: 400 },
          { id: 5, x: 235, y: 400 },
        ]),
      );
      canvas.dispatchEvent(touchEvent('touchend', []));
      runFrames(context, 20);
    }
    runFrames(context, 240);
    expect(rig.state.distance).toBeGreaterThan(pinched);
    expect(rig.state.distance).toBeLessThanOrEqual(DEFAULT_MAX_DISTANCE);
  });

  it('shows the joystick only for touch devices in walk mode', () => {
    const desktop = openRig();
    expect(requireElement(desktop.rig.controls.joystick).style.display).toBe('none');

    const touchHarness = openRig({ touch: true });
    expect(requireElement(touchHarness.rig.controls.joystick).style.display).toBe('none');

    touchHarness.rig.setMode('walk');
    expect(requireElement(touchHarness.rig.controls.joystick).style.display).toBe('block');
    expect(requireElement(touchHarness.rig.controls.joystick).getAttribute('aria-hidden')).toBe(
      'false',
    );

    touchHarness.rig.setMode('orbit');
    expect(requireElement(touchHarness.rig.controls.joystick).style.display).toBe('none');
  });
});

/* ------------------------------------------------------------------ */
/* MovementController maths (unit level)                               */
/* ------------------------------------------------------------------ */

describe('MovementController', () => {
  it('damps exponentially and clamps its inputs', () => {
    const controller = new MovementController({
      bounds: createBlockWalkBounds(),
      orbitDistance: 40,
      minDistance: 10,
      maxDistance: 60,
    });

    expect(controller.mode).toBe('orbit');
    expect(controller.orbit.distance).toBeCloseTo(40, 9);
    expect(controller.setKey('KeyW', true)).toBe(true);
    expect(controller.setKey('KeyQ', true)).toBe(false);

    controller.addZoom(1000);
    controller.update(1 / 60);
    // The zoom target clamps at once; the camera eases towards it.
    expect(controller.desired.distance).toBe(60);
    expect(controller.orbit.distance).toBeGreaterThan(40);
    expect(controller.orbit.distance).toBeLessThan(60);

    for (let frame = 0; frame < 600; frame += 1) controller.update(1 / 60);
    expect(controller.orbit.distance).toBeCloseTo(60, 3);

    controller.addZoom(-1000);
    for (let frame = 0; frame < 600; frame += 1) controller.update(1 / 60);
    expect(controller.orbit.distance).toBeCloseTo(10, 3);

    // Zero and negative deltas never move the rig.
    const settled = { ...controller.currentPose.position };
    controller.update(0);
    controller.update(-1);
    expect(distanceBetween(settled, controller.currentPose.position)).toBeLessThan(1e-9);
  });

  it('records pointer-lock ownership and walk position clamps', () => {
    const bounds = createBlockWalkBounds();
    const controller = new MovementController({ bounds, mode: 'walk', walkPosition: { x: 0, z: 0 } });

    controller.setPointerLocked(true);
    expect(controller.pointerLocked).toBe(true);
    controller.setPointerLocked(false);
    expect(controller.pointerLocked).toBe(false);

    controller.setWalkPosition({ x: 10_000, z: -10_000 });
    expect(controller.position2).toEqual({ x: bounds.maxX, z: bounds.minZ });
    expect(controller.currentPose.position.x).toBe(bounds.maxX);
  });
});
