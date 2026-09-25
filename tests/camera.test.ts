import { describe, expect, it } from "vitest";

import * as THREE from "three";

import {
  CAMERA_CONTROL_DEFAULTS,
  DEFAULT_NAVIGATION_BOUNDS,
  createCameraRig,
  createNavigationBounds,
  normalizeOrbit,
  orbitToPose,
  poseToOrbit,
  type CameraControlConfig,
  type CameraPose,
  type CameraRig,
  type FocusClearedPayload,
  type FocusEventPayload,
  type FocusInfo,
  type FocusTarget,
} from "../src/controls/camera";
import { createFocusController, type FocusController } from "../src/controls/focus";
import {
  BUILDING_LOTS,
  CAMERA_LANDMARKS,
  CENTRAL_BLOCK,
  CITY_LAYOUT,
  PERIMETER_STREETS,
  PROP_SLOTS,
} from "../src/scene/layout";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const FRAME = 1 / 60;
const EPS = 1e-6;
const VIEWPORT = { left: 0, top: 0, width: 800, height: 600 } as const;

/** A mid-block pose every test can snap to before driving the rig. */
const STREET_VIEW: CameraPose = {
  position: { x: 0, y: 6, z: 30 },
  target: { x: 0, y: 3, z: 0 },
};

function makeRig(config?: Partial<CameraControlConfig>): CameraRig {
  return createCameraRig({ layout: CITY_LAYOUT, viewport: { width: 800, height: 600 }, config });
}

/** Runs `seconds` of simulation in `dt` steps (sub-stepping makes 30/60 Hz parity exact). */
function step(rig: CameraRig, seconds: number, dt = FRAME): void {
  const frames = Math.max(1, Math.round(seconds / dt));
  for (let index = 0; index < frames; index += 1) rig.update(dt);
}

function settle(rig: CameraRig, seconds = 2.5): void {
  step(rig, seconds);
}

function poseDistance(a: CameraPose, b: CameraPose): number {
  return (
    Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z) +
    Math.hypot(a.target.x - b.target.x, a.target.y - b.target.y, a.target.z - b.target.z)
  );
}

function expectPoseClose(actual: CameraPose, expected: CameraPose, tolerance = 1e-6): void {
  expect(Math.abs(actual.position.x - expected.position.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.position.y - expected.position.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.position.z - expected.position.z)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.target.x - expected.target.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.target.y - expected.target.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.target.z - expected.target.z)).toBeLessThanOrEqual(tolerance);
}

/** The acceptance invariants: bounds, ground clearance, pitch and boom clamps. */
function expectNavigationInvariants(rig: CameraRig): void {
  const pose = rig.pose;
  const orbit = rig.orbit;
  const bounds = rig.bounds;
  const config = rig.config;

  for (const value of [
    pose.position.x,
    pose.position.y,
    pose.position.z,
    pose.target.x,
    pose.target.y,
    pose.target.z,
    orbit.distance,
    orbit.pitch,
  ]) {
    expect(Number.isFinite(value)).toBe(true);
  }

  // Pivot stays inside the block envelope (block + streets + frontage lots).
  expect(pose.target.x).toBeGreaterThanOrEqual(bounds.target.minX - EPS);
  expect(pose.target.x).toBeLessThanOrEqual(bounds.target.maxX + EPS);
  expect(pose.target.z).toBeGreaterThanOrEqual(bounds.target.minZ - EPS);
  expect(pose.target.z).toBeLessThanOrEqual(bounds.target.maxZ + EPS);
  expect(pose.target.y).toBeGreaterThanOrEqual(bounds.targetMinY - EPS);
  expect(pose.target.y).toBeLessThanOrEqual(bounds.targetMaxY + EPS);

  // Eye stays inside the navigation volume and never clips below ground.
  expect(pose.position.x).toBeGreaterThanOrEqual(bounds.eye.minX - EPS);
  expect(pose.position.x).toBeLessThanOrEqual(bounds.eye.maxX + EPS);
  expect(pose.position.z).toBeGreaterThanOrEqual(bounds.eye.minZ - EPS);
  expect(pose.position.z).toBeLessThanOrEqual(bounds.eye.maxZ + EPS);
  expect(pose.position.y).toBeGreaterThanOrEqual(bounds.eyeMinY - EPS);
  expect(pose.position.y).toBeLessThanOrEqual(bounds.eyeMaxY + EPS);

  // Pitch and boom clamps hold on every tick.
  expect(orbit.pitch).toBeGreaterThanOrEqual(config.minPitch - EPS);
  expect(orbit.pitch).toBeLessThanOrEqual(config.maxPitch + EPS);
  expect(orbit.distance).toBeGreaterThanOrEqual(config.minDistance - EPS);
  expect(orbit.distance).toBeLessThanOrEqual(config.maxDistance + EPS);
}

interface TouchPoint {
  identifier: number;
  clientX: number;
  clientY: number;
}

/** jsdom has no `TouchEvent`, so touches are attached to a plain bubbling event. */
function dispatchTouch(
  element: HTMLElement,
  type: string,
  touches: readonly TouchPoint[],
  changedTouches: readonly TouchPoint[] = touches,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { touches, changedTouches });
  element.dispatchEvent(event);
}

/* -------------------------------------------------------------------------- */
/* Navigation bounds                                                          */
/* -------------------------------------------------------------------------- */

describe("camera navigation bounds", () => {
  it("derives the playable volume from the real layout contract", () => {
    const bounds = createNavigationBounds(CITY_LAYOUT);
    expect(CAMERA_LANDMARKS.length).toBeGreaterThanOrEqual(6);

    // The central block sits inside the pivot envelope.
    expect(bounds.target.minX).toBeLessThanOrEqual(CENTRAL_BLOCK.bounds.minX);
    expect(bounds.target.maxX).toBeGreaterThanOrEqual(CENTRAL_BLOCK.bounds.maxX);
    expect(bounds.target.minZ).toBeLessThanOrEqual(CENTRAL_BLOCK.bounds.minZ);
    expect(bounds.target.maxZ).toBeGreaterThanOrEqual(CENTRAL_BLOCK.bounds.maxZ);

    // Frontage lots and perimeter streets are all reachable by panning.
    for (const lot of BUILDING_LOTS) {
      expect(bounds.target.minX).toBeLessThanOrEqual(lot.bounds.minX);
      expect(bounds.target.maxX).toBeGreaterThanOrEqual(lot.bounds.maxX);
      expect(bounds.target.minZ).toBeLessThanOrEqual(lot.bounds.minZ);
      expect(bounds.target.maxZ).toBeGreaterThanOrEqual(lot.bounds.maxZ);
    }
    for (const street of PERIMETER_STREETS) {
      expect(bounds.target.minX).toBeLessThanOrEqual(street.center.x);
      expect(bounds.target.maxX).toBeGreaterThanOrEqual(street.center.x);
      expect(bounds.target.minZ).toBeLessThanOrEqual(street.center.z);
      expect(bounds.target.maxZ).toBeGreaterThanOrEqual(street.center.z);
    }
    for (const slot of PROP_SLOTS) {
      expect(bounds.eye.minX).toBeLessThanOrEqual(slot.anchor.position.x);
      expect(bounds.eye.maxX).toBeGreaterThanOrEqual(slot.anchor.position.x);
    }

    // Every authored landmark is inside the eye volume, and its pivot inside the target envelope.
    for (const landmark of CAMERA_LANDMARKS) {
      expect(bounds.eye.minX).toBeLessThanOrEqual(landmark.position.x);
      expect(bounds.eye.maxX).toBeGreaterThanOrEqual(landmark.position.x);
      expect(bounds.eye.minZ).toBeLessThanOrEqual(landmark.position.z);
      expect(bounds.eye.maxZ).toBeGreaterThanOrEqual(landmark.position.z);
      expect(bounds.eyeMinY).toBeLessThanOrEqual(landmark.position.y);
      expect(bounds.eyeMaxY).toBeGreaterThanOrEqual(landmark.position.y);
      expect(bounds.target.minX).toBeLessThanOrEqual(landmark.target.x);
      expect(bounds.target.maxX).toBeGreaterThanOrEqual(landmark.target.x);
      expect(bounds.target.minZ).toBeLessThanOrEqual(landmark.target.z);
      expect(bounds.target.maxZ).toBeGreaterThanOrEqual(landmark.target.z);
    }

    expect(bounds.eyeMinY).toBe(CAMERA_CONTROL_DEFAULTS.minEyeHeight);
    expect(DEFAULT_NAVIGATION_BOUNDS).toEqual(bounds);
  });

  it("round-trips poses and normalizes idempotently", () => {
    const rig = makeRig();
    const pose = { position: { x: 12, y: 9, z: -14 }, target: { x: -3, y: 4, z: 2 } };
    const orbit = poseToOrbit(pose);
    expect(orbitToPose(orbit).position.x).toBeCloseTo(pose.position.x, 9);
    expect(orbitToPose(orbit).position.y).toBeCloseTo(pose.position.y, 9);
    expect(orbitToPose(orbit).position.z).toBeCloseTo(pose.position.z, 9);

    const wild = normalizeOrbit(
      { target: { x: 9999, y: 9999, z: -9999 }, distance: 99999, azimuth: 40, pitch: 9 },
      rig.bounds,
      rig.config,
    );
    const twice = normalizeOrbit(wild, rig.bounds, rig.config);
    expect(twice.distance).toBeCloseTo(wild.distance, 9);
    expect(twice.pitch).toBeCloseTo(wild.pitch, 9);
    expect(twice.azimuth).toBeCloseTo(wild.azimuth, 9);
    expect(twice.target.z).toBeCloseTo(wild.target.z, 9);
  });
});

/* -------------------------------------------------------------------------- */
/* Damped navigation                                                          */
/* -------------------------------------------------------------------------- */

describe("damped orbit, pan, zoom and movement", () => {
  it("damps orbit motion and is frame-rate independent", () => {
    const fast = makeRig();
    const slow = makeRig();
    for (const rig of [fast, slow]) {
      rig.setPose(STREET_VIEW, { immediate: true });
      rig.orbitBy(140, 40);
    }

    step(fast, 1, 1 / 60);
    step(slow, 1, 1 / 30);
    expectPoseClose(fast.pose, slow.pose, 1e-9);

    // Damped, not snappy: a single frame only travels a fraction of the way.
    const single = makeRig();
    single.setPose(STREET_VIEW, { immediate: true });
    single.orbitBy(140, 40);
    single.update(FRAME);
    expect(poseDistance(single.pose, fast.pose)).toBeGreaterThan(0.5);
    expect(poseDistance(single.pose, STREET_VIEW)).toBeGreaterThan(0.01);
  });

  it("moves with WASD, arrow keys and touch drag at frame-rate independent speeds", () => {
    const wasd = makeRig();
    const arrows = makeRig();
    const touch = makeRig();
    for (const rig of [wasd, arrows, touch]) rig.setPose(STREET_VIEW, { immediate: true });

    wasd.onKeyDown("w");
    arrows.onKeyDown("ArrowUp");
    step(wasd, 0.5, 1 / 60);
    step(arrows, 0.5, 1 / 30);
    wasd.onKeyUp("w");
    arrows.onKeyUp("ArrowUp");
    settle(wasd);
    settle(arrows);
    expectPoseClose(wasd.pose, arrows.pose, 1e-5);

    // Half a second at 16 m/s travels 8 m along the view direction.
    const travelled = Math.hypot(
      wasd.pose.target.x - STREET_VIEW.target.x,
      wasd.pose.target.z - STREET_VIEW.target.z,
    );
    expect(travelled).toBeCloseTo(CAMERA_CONTROL_DEFAULTS.moveSpeed * 0.5, 2);
    expect(wasd.activeKeys).toEqual([]);

    // Touch drag orbits with the same in-plane response as a mouse drag.
    touch.onTouchStart([{ id: 1, x: 400, y: 300 }]);
    expect(touch.dragging).toBe(true);
    touch.onTouchMove([{ id: 1, x: 500, y: 300 }]);
    touch.onTouchEnd([]);
    expect(touch.dragging).toBe(false);
    const dragged = touch.orbit.azimuth;

    const mouse = makeRig();
    mouse.setPose(STREET_VIEW, { immediate: true });
    mouse.onPointerDown(400, 300, "orbit");
    mouse.onPointerMove(500, 300);
    expect(mouse.onPointerUp()).toBe(false);
    expect(dragged).toBeCloseTo(mouse.orbit.azimuth, 9);
  });

  it("zooms with the wheel and with a two-finger pinch", () => {
    const wheel = makeRig();
    wheel.setPose(STREET_VIEW, { immediate: true });
    const startDistance = wheel.orbit.distance;
    wheel.zoomBy(-240);
    settle(wheel);
    expect(wheel.orbit.distance).toBeLessThan(startDistance);

    wheel.zoomBy(2400);
    settle(wheel);
    expect(wheel.orbit.distance).toBeLessThanOrEqual(CAMERA_CONTROL_DEFAULTS.maxDistance + EPS);
    wheel.zoomBy(-24000);
    settle(wheel);
    expect(wheel.orbit.distance).toBeGreaterThanOrEqual(CAMERA_CONTROL_DEFAULTS.minDistance - EPS);

    const pinch = makeRig();
    pinch.setPose(STREET_VIEW, { immediate: true });
    const before = pinch.orbit.distance;
    pinch.onTouchStart([
      { id: 1, x: 300, y: 300 },
      { id: 2, x: 500, y: 300 },
    ]);
    pinch.onTouchMove([
      { id: 1, x: 200, y: 300 },
      { id: 2, x: 600, y: 300 },
    ]);
    pinch.onTouchEnd([]);
    settle(pinch);
    expect(pinch.orbit.distance).toBeLessThan(before);
    expectNavigationInvariants(pinch);
  });

  it("clamps bounds, clearance and pitch for every input and every tick", () => {
    const rig = makeRig();
    let seed = 0x9e3779b9;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const keys = ["w", "a", "s", "d", "q", "e", "r", "f"] as const;

    for (let index = 0; index < 400; index += 1) {
      const roll = rand();
      if (roll < 0.3) rig.orbitBy((rand() - 0.5) * 6000, (rand() - 0.5) * 6000);
      else if (roll < 0.5) rig.panBy((rand() - 0.5) * 6000, (rand() - 0.5) * 6000);
      else if (roll < 0.7) rig.zoomBy((rand() - 0.5) * 8000);
      else if (roll < 0.85) rig.onKeyDown(keys[index % keys.length]!);
      else {
        rig.clearKeys();
        rig.onTouchStart([{ id: 1, x: 100, y: 100 }]);
        rig.onTouchMove([{ id: 1, x: 100 + (rand() - 0.5) * 500, y: 100 + (rand() - 0.5) * 500 }]);
        rig.onTouchEnd([]);
      }
      rig.update(index % 3 === 0 ? 1 / 30 : 1 / 60);
      expectNavigationInvariants(rig);
    }

    // A single absurd delta cannot teleport the rig out of the block either.
    rig.clearKeys();
    rig.orbitBy(1e6, 1e6);
    rig.panBy(1e6, -1e6);
    rig.zoomBy(1e6);
    rig.update(30);
    expectNavigationInvariants(rig);
  });
});

/* -------------------------------------------------------------------------- */
/* Landmark presets and reset                                                 */
/* -------------------------------------------------------------------------- */

describe("landmark presets", () => {
  it("glides to every named layout landmark and back to the establishing view", () => {
    expect(CAMERA_LANDMARKS.length).toBeGreaterThanOrEqual(6);
    const rig = makeRig();

    for (const landmark of CAMERA_LANDMARKS) {
      rig.setPose(STREET_VIEW, { immediate: true });
      const from = rig.pose;
      const goal = rig.applyLandmark(landmark.id);
      expect(rig.isGliding).toBe(true);

      const midway = rig.update(FRAME);
      expect(poseDistance(midway, from)).toBeGreaterThan(0);
      expect(poseDistance(midway, from)).toBeLessThan(poseDistance(from, goal) * 0.25);

      // Mid-glide the rig is strictly between the two views (in orbit space the
      // interpolation is monotone, which is what "glide" means here).
      step(rig, 0.4);
      expect(rig.isGliding).toBe(true);
      const fromOrbit = poseToOrbit(from);
      const goalOrbit = poseToOrbit(goal);
      expect(rig.orbit.distance).toBeGreaterThan(Math.min(fromOrbit.distance, goalOrbit.distance));
      expect(rig.orbit.distance).toBeLessThan(Math.max(fromOrbit.distance, goalOrbit.distance));
      expect(poseDistance(rig.pose, from)).toBeGreaterThan(0.05);
      expect(poseDistance(rig.pose, goal)).toBeGreaterThan(0.05);

      settle(rig);
      expect(rig.isGliding).toBe(false);
      expectPoseClose(rig.pose, { position: landmark.position, target: landmark.target }, 1e-5);
      expectNavigationInvariants(rig);
    }

    // Reset returns to the default establishing view, smoothly.
    expect(rig.defaultLandmark.id).toBe(CAMERA_LANDMARKS[0]!.id);
    rig.setPose({ position: { x: -20, y: 11, z: 0 }, target: { x: 0, y: 3, z: 0 } }, { immediate: true });
    const before = rig.pose;
    const defaultPose = rig.defaultPose;
    const distanceToDefault = poseDistance(before, defaultPose);
    expect(distanceToDefault).toBeGreaterThan(10);

    rig.reset();
    expect(rig.isGliding).toBe(true);
    expect(poseDistance(rig.pose, before)).toBe(0);

    // One frame in, the rig has only just started moving: a glide, not a snap.
    const afterOneFrame = rig.update(FRAME);
    const travelled = poseDistance(afterOneFrame, before);
    expect(travelled).toBeGreaterThan(0);
    expect(travelled).toBeLessThan(distanceToDefault * 0.02);

    step(rig, 0.4);
    expect(rig.isGliding).toBe(true);
    const beforeOrbit = poseToOrbit(before);
    const defaultOrbit = poseToOrbit(defaultPose);
    expect(rig.orbit.distance).toBeGreaterThan(Math.min(beforeOrbit.distance, defaultOrbit.distance));
    expect(rig.orbit.distance).toBeLessThan(Math.max(beforeOrbit.distance, defaultOrbit.distance));

    settle(rig);
    expect(rig.isGliding).toBe(false);
    expectPoseClose(rig.pose, defaultPose, 1e-5);
  });

  it("lets user input and era morphs keep the pose", () => {
    const rig = makeRig();
    rig.setPose(STREET_VIEW, { immediate: true });
    const before = rig.pose;

    // Era morphs never touch the camera, so the user's pose survives the swap.
    rig.applyEra("2025", 0.35);
    rig.applyEra("1985", 1);
    expectPoseClose(rig.pose, before, 1e-12);

    rig.applyLandmark("aerial-overview");
    expect(rig.isGliding).toBe(true);
    rig.update(FRAME);
    const during = rig.pose;
    rig.applyEra("2005", 0.5);
    expect(rig.isGliding).toBe(true);

    // A drag takes priority over the automated glide.
    rig.onPointerDown(400, 300, "orbit");
    rig.onPointerMove(560, 340);
    rig.onPointerUp();
    expect(rig.isGliding).toBe(false);
    const afterInput = rig.update(FRAME);
    expect(poseDistance(afterInput, during)).toBeGreaterThan(1e-4);
    expectNavigationInvariants(rig);

    // So do held keys.
    rig.applyLandmark("courtyard");
    expect(rig.isGliding).toBe(true);
    expect(rig.onKeyDown("d")).toBe(true);
    expect(rig.isGliding).toBe(false);
    expect(rig.onKeyUp("d")).toBe(true);
    rig.clearKeys();
    rig.update(FRAME);
    expectNavigationInvariants(rig);

    // And a wheel zoom.
    rig.applyLandmark("west-arcade");
    expect(rig.isGliding).toBe(true);
    rig.zoomBy(-120);
    expect(rig.isGliding).toBe(false);
    rig.update(FRAME);
    expectNavigationInvariants(rig);
  });
});

/* -------------------------------------------------------------------------- */
/* Click-to-inspect                                                           */
/* -------------------------------------------------------------------------- */

interface FocusScene {
  readonly rig: CameraRig;
  readonly controller: FocusController;
  readonly building: THREE.Mesh;
  readonly vehicle: THREE.Mesh;
  readonly pedestrianGroup: THREE.Group;
  readonly prop: THREE.Mesh;
  readonly plumbing: THREE.Mesh;
}

function makeFocusScene(): FocusScene {
  const rig = makeRig();
  const controller = createFocusController({ camera: rig, layout: CITY_LAYOUT, era: "1945" });

  const building = new THREE.Mesh(new THREE.BoxGeometry(8, 18, 8), new THREE.MeshBasicMaterial());
  building.position.set(0, 9, 0);
  building.name = "civic-hall-mesh";
  controller.register(
    {
      id: "civic-hall",
      kind: "building",
      title: "Civic Hall",
      description: "Municipal offices on the north frontage.",
      facts: { zone: "civic", floors: 5 },
      eraLabels: {
        "1945": { title: "Civic Hall", facts: { usage: "ration office" } },
        "2025": {
          title: "Civic Innovation Hub",
          description: "Adaptive-reuse offices with a public roof.",
          facts: { usage: "co-working", floors: 6 },
        },
      },
    },
    building,
  );

  const vehicle = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 4.4), new THREE.MeshBasicMaterial());
  vehicle.position.set(6, 0.75, 0);
  vehicle.name = "sedan";
  vehicle.userData.focus = {
    id: "vehicle-1",
    kind: "vehicle",
    title: "Sedan",
    eraLabels: { "2025": { title: "Electric hatchback" } },
  } satisfies FocusTarget;
  const registered = controller.registerSystem({ id: "vehicles", getPickables: () => [vehicle] });
  expect(registered).toBe(1);

  const pedestrianMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.7, 0.4), new THREE.MeshBasicMaterial());
  pedestrianMesh.position.set(0, 0.85, 0);
  const pedestrianGroup = new THREE.Group();
  pedestrianGroup.name = "pedestrian-1-rig";
  pedestrianGroup.position.set(-6, 0, 0);
  pedestrianGroup.add(pedestrianMesh);
  controller.registerObjects([pedestrianGroup], () => ({
    id: "pedestrian-1",
    kind: "pedestrian",
    title: "Commuter",
    eraLabels: { "2025": { title: "Rider" } },
  }));

  const prop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.2, 0.3), new THREE.MeshBasicMaterial());
  prop.position.set(10, 4, 0);
  prop.name = "ad-sign-1";
  controller.register(
    {
      id: "south-ad-sign-1",
      kind: "prop",
      title: "Painted wall bulletin",
      eraLabels: { "2025": { title: "Programmatic LED screen" } },
    },
    prop,
  );

  // Deliberately *not* registered: proves picking only sees camera-API pickables.
  const plumbing = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 2), new THREE.MeshBasicMaterial());
  plumbing.position.set(0, 15, 12);
  plumbing.name = "unregistered-occluder";

  return { rig, controller, building, vehicle, pedestrianGroup, prop, plumbing };
}

/** Asserts every corner of `object` lands inside the frame. */
function expectFramed(rig: CameraRig, object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object);
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const ndc = new THREE.Vector3(x, y, z).project(rig.camera);
        expect(ndc.z).toBeLessThan(1);
        expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
      }
    }
  }
}

describe("click-to-inspect focus", () => {
  it("raycasts buildings, vehicles, pedestrians and props and glides to a framed view", () => {
    const { rig, controller, building, vehicle, pedestrianGroup, prop } = makeFocusScene();
    const events: FocusEventPayload[] = [];
    controller.on("focus", (event) => events.push(event));

    rig.setPose({ position: { x: 0, y: 10, z: 40 }, target: { x: 0, y: 9, z: 0 } }, { immediate: true });
    const buildingInfo = controller.clickAt(400, 300, VIEWPORT);
    expect(buildingInfo?.id).toBe("civic-hall");
    expect(buildingInfo?.kind).toBe("building");
    expect(buildingInfo?.era).toBe("1945");
    expect(buildingInfo?.title).toBe("Civic Hall");
    expect(buildingInfo?.facts.zone).toBe("civic");
    expect(buildingInfo?.facts.usage).toBe("ration office");
    expect(rig.isGliding).toBe(true);
    settle(rig);
    expect(rig.isGliding).toBe(false);
    expect(rig.target.x).toBeCloseTo(buildingInfo!.worldPosition.x, 4);
    expect(rig.target.y).toBeCloseTo(buildingInfo!.worldPosition.y, 4);
    expect(rig.target.z).toBeCloseTo(buildingInfo!.worldPosition.z, 4);
    expectFramed(rig, building);
    expectNavigationInvariants(rig);

    rig.setPose({ position: { x: 6, y: 2.2, z: 12 }, target: { x: 6, y: 0.75, z: 0 } }, { immediate: true });
    const vehicleInfo = controller.clickAt(400, 300, VIEWPORT);
    expect(vehicleInfo?.kind).toBe("vehicle");
    expect(controller.focusedObject).toBe(vehicle);
    settle(rig);
    expectFramed(rig, vehicle);

    rig.setPose({ position: { x: -6, y: 2.2, z: 12 }, target: { x: -6, y: 0.6, z: 0 } }, { immediate: true });
    const pedestrianInfo = controller.clickAt(400, 300, VIEWPORT);
    expect(pedestrianInfo?.kind).toBe("pedestrian");
    // The hit mesh resolves to its registered ancestor.
    expect(controller.focusedObject).toBe(pedestrianGroup);
    settle(rig);

    rig.setPose({ position: { x: 10, y: 4, z: 10 }, target: { x: 10, y: 4, z: 0 } }, { immediate: true });
    const propInfo = controller.clickAt(400, 300, VIEWPORT);
    expect(propInfo?.kind).toBe("prop");
    expect(propInfo?.title).toBe("Painted wall bulletin");
    settle(rig);
    expectFramed(rig, prop);

    expect(events.map((event) => event.info.kind)).toEqual(["building", "vehicle", "pedestrian", "prop"]);
    expect(events.every((event) => event.source === "raycast")).toBe(true);
    expect(events.every((event) => event.object !== null)).toBe(true);
  });

  it("ignores objects that were never registered through the camera API", () => {
    const { rig, controller, plumbing } = makeFocusScene();
    rig.setPose({ position: { x: 0, y: 10, z: 40 }, target: { x: 0, y: 9, z: 0 } }, { immediate: true });

    // The unregistered slab sits between the eye and the civic hall.
    const occluderRay = new THREE.Raycaster();
    occluderRay.setFromCamera(new THREE.Vector2(0, 0), rig.camera);
    expect(occluderRay.intersectObject(plumbing, false)).toHaveLength(1);
    expect(controller.registry.objects()).not.toContain(plumbing);

    expect(controller.clickAt(400, 300, VIEWPORT)?.id).toBe("civic-hall");
  });

  it("refreshes era-aware labels without disturbing the camera pose", () => {
    const { rig, controller } = makeFocusScene();
    rig.setPose({ position: { x: 0, y: 10, z: 40 }, target: { x: 0, y: 9, z: 0 } }, { immediate: true });
    controller.clickAt(400, 300, VIEWPORT);
    settle(rig);
    const poseBefore = rig.pose;
    const distanceBefore = rig.orbit.distance;

    const events: FocusEventPayload[] = [];
    controller.on("focus", (event) => events.push(event));
    controller.setEra("2025");

    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("era");
    expect(events[0]!.info.era).toBe("2025");
    expect(events[0]!.info.title).toBe("Civic Innovation Hub");
    expect(events[0]!.info.description).toContain("Adaptive-reuse");
    expect(events[0]!.info.facts.usage).toBe("co-working");
    expect(events[0]!.info.facts.floors).toBe(6);
    expect(events[0]!.info.facts.zone).toBe("civic");
    expectPoseClose(events[0]!.pose, poseBefore, 1e-12);
    expectPoseClose(rig.pose, poseBefore, 1e-12);
    expect(rig.orbit.distance).toBeCloseTo(distanceBefore, 12);
    expect(rig.isGliding).toBe(false);

    // Re-focusing in the new era carries the new labels.
    const refocused = controller.clickAt(400, 300, VIEWPORT);
    expect(refocused?.title).toBe("Civic Innovation Hub");
  });

  it("clears the info card when a click misses every pickable", () => {
    const { rig, controller } = makeFocusScene();
    rig.setPose({ position: { x: 0, y: 10, z: 40 }, target: { x: 0, y: 9, z: 0 } }, { immediate: true });
    controller.clickAt(400, 300, VIEWPORT);
    settle(rig);

    const cleared: FocusClearedPayload[] = [];
    controller.on("focus-cleared", (event) => cleared.push(event));
    const poseBefore = rig.pose;
    expect(controller.clickAt(6, 6, VIEWPORT)).toBeNull();
    expect(cleared).toEqual([{ era: "1945", source: "raycast" }]);
    expect(controller.focused).toBeNull();
    expectPoseClose(rig.pose, poseBefore, 1e-12);
    expect(rig.isGliding).toBe(false);
  });

  it("focuses registered targets and layout landmarks by id", () => {
    const { rig, controller, vehicle } = makeFocusScene();
    const events: FocusEventPayload[] = [];
    controller.on("focus", (event) => events.push(event));

    const vehicleInfo = controller.focusTarget("vehicle-1");
    expect(vehicleInfo?.kind).toBe("vehicle");
    expect(vehicleInfo?.title).toBe("Sedan");
    expect(vehicleInfo?.id).toBe("vehicle-1");
    settle(rig);
    expectFramed(rig, vehicle);
    expectNavigationInvariants(rig);

    const landmarkInfo: FocusInfo = controller.focusLandmark("courtyard");
    expect(landmarkInfo.kind).toBe("landmark");
    expect(landmarkInfo.landmarkId).toBe("courtyard");
    expect(landmarkInfo.title).toBe("Central Courtyard");
    expect(landmarkInfo.era).toBe("1945");
    expect(landmarkInfo.description.length).toBeGreaterThan(0);
    settle(rig);
    expectPoseClose(rig.pose, rig.poseForLandmark("courtyard"), 1e-5);
    expectNavigationInvariants(rig);

    expect(() => controller.focusLandmark("no-such-landmark")).toThrow(/Unknown Chrono City camera landmark/);
    expect(controller.focusTarget("no-such-target")).toBeNull();
    expect(events.map((event) => event.source)).toEqual(["api", "landmark"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Input parity                                                               */
/* -------------------------------------------------------------------------- */

describe("input wiring", () => {
  it("binds mouse, wheel, touch and keyboard events on the canvas", () => {
    const rig = makeRig();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    rig.attach(canvas);
    rig.setViewport(800, 600);
    rig.setPose(STREET_VIEW, { immediate: true });

    // Mouse drag orbits, and the press/release pair stays short of a click.
    const azimuthBeforeDrag = rig.orbit.azimuth;
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 400, clientY: 300, button: 0 }));
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 520, clientY: 340, bubbles: true }));
    expect(rig.dragging).toBe(true);
    rig.update(FRAME);
    expect(rig.orbit.azimuth).not.toBeCloseTo(azimuthBeforeDrag, 6);
    canvas.dispatchEvent(new MouseEvent("mouseup", { clientX: 520, clientY: 340, button: 0 }));
    expect(rig.dragging).toBe(false);
    settle(rig);
    const afterDrag = rig.pose;
    expect(poseDistance(afterDrag, STREET_VIEW)).toBeGreaterThan(1);

    // Middle-button drag pans the pivot.
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 400, clientY: 300, button: 1 }));
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 340, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent("mouseup", { clientX: 300, clientY: 340, button: 1 }));
    settle(rig);
    expect(poseDistance(rig.pose, afterDrag)).toBeGreaterThan(0.5);
    expectNavigationInvariants(rig);

    // Wheel zooms.
    const distanceBefore = rig.orbit.distance;
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -300, cancelable: true }));
    settle(rig);
    expect(rig.orbit.distance).toBeLessThan(distanceBefore);

    // Touch drag orbits, two-finger pinch zooms in.
    const beforeTouch = rig.orbit;
    dispatchTouch(canvas, "touchstart", [{ identifier: 1, clientX: 400, clientY: 300 }]);
    dispatchTouch(canvas, "touchmove", [{ identifier: 1, clientX: 480, clientY: 320 }]);
    dispatchTouch(canvas, "touchend", []);
    settle(rig);
    expect(rig.orbit.azimuth).not.toBeCloseTo(beforeTouch.azimuth, 3);

    const distanceBeforePinch = rig.orbit.distance;
    dispatchTouch(canvas, "touchstart", [
      { identifier: 1, clientX: 300, clientY: 300 },
      { identifier: 2, clientX: 500, clientY: 300 },
    ]);
    dispatchTouch(canvas, "touchmove", [
      { identifier: 1, clientX: 200, clientY: 300 },
      { identifier: 2, clientX: 600, clientY: 300 },
    ]);
    dispatchTouch(canvas, "touchend", []);
    settle(rig);
    expect(rig.orbit.distance).toBeLessThan(distanceBeforePinch);
    expectNavigationInvariants(rig);

    // Keyboard parity: WASD and arrows drive the same actions.
    const beforeKeys = rig.pose;
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    expect(rig.activeKeys).toContain("forward");
    step(rig, 0.4);
    canvas.dispatchEvent(new KeyboardEvent("keyup", { key: "w", bubbles: true }));
    expect(rig.activeKeys).toEqual([]);
    settle(rig);
    expect(poseDistance(rig.pose, beforeKeys)).toBeGreaterThan(1);

    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(rig.activeKeys).toContain("right");
    canvas.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
    expect(rig.activeKeys).toEqual([]);

    // Ignored keys never leak into the rig.
    expect(rig.onKeyDown("k")).toBe(false);
    expect(rig.onKeyUp("k")).toBe(false);
    expect(rig.onKeyDown("PageUp")).toBe(false);
    expect(rig.onKeyDown("r")).toBe(true);
    expect(rig.activeKeys).toContain("rise");
    rig.clearKeys();

    rig.detach();
    const afterDetach = rig.pose;
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 400, clientY: 300, button: 0 }));
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 600, clientY: 500, bubbles: true }));
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -300, cancelable: true }));
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    expect(rig.dragging).toBe(false);
    expect(rig.activeKeys).toEqual([]);
    rig.update(FRAME);
    expectPoseClose(rig.pose, afterDetach, 1e-9);
    canvas.remove();
  });

  it("drives focus from DOM clicks, taps and info-card hotkeys", () => {
    const { rig, controller } = makeFocusScene();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    rig.attach(canvas);
    controller.attach(canvas);
    rig.setViewport(800, 600);
    rig.setPose({ position: { x: 0, y: 10, z: 40 }, target: { x: 0, y: 9, z: 0 } }, { immediate: true });

    const events: FocusEventPayload[] = [];
    const cleared: FocusClearedPayload[] = [];
    controller.on("focus", (event) => events.push(event));
    controller.on("focus-cleared", (event) => cleared.push(event));

    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 400, clientY: 300, button: 0 }));
    canvas.dispatchEvent(new MouseEvent("mouseup", { clientX: 400, clientY: 300, button: 0 }));
    expect(events).toHaveLength(1);
    expect(events[0]!.info.id).toBe("civic-hall");
    settle(rig);
    expect(controller.focusedObject).not.toBeNull();
    expectFramed(rig, controller.focusedObject!);
    expect(controller.focused?.title).toBe("Civic Hall");

    // A drag must not focus anything.
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 400, clientY: 300, button: 0 }));
    canvas.dispatchEvent(new MouseEvent("mouseup", { clientX: 470, clientY: 300, button: 0 }));
    expect(events).toHaveLength(1);

    // A tap focuses.
    dispatchTouch(canvas, "touchstart", [{ identifier: 1, clientX: 400, clientY: 300 }]);
    dispatchTouch(canvas, "touchend", [], [{ identifier: 1, clientX: 400, clientY: 300 }]);
    expect(events).toHaveLength(2);
    expect(events[1]!.source).toBe("raycast");

    // Escape hides the info card.
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(cleared).toEqual([{ era: "1945", source: "escape" }]);
    expect(controller.focused).toBeNull();

    // Digit hotkeys are landmark presets; Home resets the establishing view.
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "4", cancelable: true }));
    expect(controller.focused?.landmarkId).toBe(CAMERA_LANDMARKS[3]!.id);
    expect(rig.isGliding).toBe(true);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", cancelable: true }));
    expect(rig.isGliding).toBe(true);
    settle(rig);
    expectPoseClose(rig.pose, rig.defaultPose, 1e-5);
    expect(cleared).toHaveLength(2);

    controller.detach();
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 400, clientY: 300, button: 0 }));
    canvas.dispatchEvent(new MouseEvent("mouseup", { clientX: 400, clientY: 300, button: 0 }));
    expect(events).toHaveLength(3);
    canvas.remove();
  });
});
