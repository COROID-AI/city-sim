import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_LIMITS, OrbitCameraController } from '../src/core/cameraControls';

function makeControls() {
  const camera = new THREE.PerspectiveCamera(58, 1.6, 0.5, 2000);
  const controls = new OrbitCameraController(camera);
  return { camera, controls };
}

function settle(controls: OrbitCameraController, seconds = 2, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) controls.update(step);
}

describe('orbit camera controls', () => {
  it('starts at a sensible above-street overview of the block', () => {
    const { camera, controls } = makeControls();
    expect(camera.position.y).toBeGreaterThan(DEFAULT_LIMITS.groundY);
    const pose = controls.getPose();
    expect(pose.distance).toBeGreaterThan(DEFAULT_LIMITS.minDistance);
    expect(pose.distance).toBeLessThan(DEFAULT_LIMITS.maxDistance);
    expect(pose.polar).toBeLessThan(DEFAULT_LIMITS.maxPolar);
  });

  it('orbits the viewpoint around the block when the user drags', () => {
    const { camera, controls } = makeControls();
    const before = camera.position.clone();
    const beforePose = controls.getPose();

    controls.orbit(180, 0);
    settle(controls);

    expect(controls.getPose().azimuth).not.toBeCloseTo(beforePose.azimuth, 3);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(30);
    // The camera stays on its orbit sphere around the look target.
    const target = controls.getPose().target;
    expect(camera.position.distanceTo(target)).toBeCloseTo(controls.getPose().distance, 3);
    expect(camera.position.y).toBeGreaterThan(DEFAULT_LIMITS.groundY);
  });

  it('damps smoothly instead of snapping', () => {
    const { camera, controls } = makeControls();
    controls.orbit(300, 0);
    controls.update(1 / 120);
    const first = camera.position.clone();
    controls.update(1 / 120);
    const second = camera.position.clone();
    controls.update(1 / 120);
    const third = camera.position.clone();
    // Each frame moves, but the first frames are not a teleport.
    expect(first.distanceTo(second)).toBeGreaterThan(0);
    expect(second.distanceTo(third)).toBeGreaterThan(0);
    expect(first.distanceTo(second)).toBeLessThan(30);
  });

  it('zooms with the wheel and clamps to the distance limits', () => {
    const { controls } = makeControls();
    const start = controls.getPose().distance;

    controls.zoom(2);
    settle(controls);
    expect(controls.getPose().distance).toBeGreaterThan(start);

    controls.zoom(500);
    settle(controls);
    expect(controls.getPose().distance).toBeCloseTo(DEFAULT_LIMITS.maxDistance, 0);

    controls.zoom(-500);
    settle(controls);
    expect(controls.getPose().distance).toBeCloseTo(DEFAULT_LIMITS.minDistance, 0);
  });

  it('pans the look target laterally and clamps it inside the city bounds', () => {
    const { controls } = makeControls();
    const before = controls.getPose().target.clone();

    controls.pan(320, 0);
    settle(controls);
    const panned = controls.getPose().target;
    expect(panned.distanceTo(before)).toBeGreaterThan(5);
    expect(Math.abs(panned.x)).toBeLessThanOrEqual(DEFAULT_LIMITS.panBoundsX);
    expect(Math.abs(panned.z)).toBeLessThanOrEqual(DEFAULT_LIMITS.panBoundsZ);

    // A huge drag cannot escape the block.
    controls.pan(9000, 0);
    settle(controls);
    expect(Math.abs(controls.getPose().target.x)).toBeCloseTo(DEFAULT_LIMITS.panBoundsX, 2);

    controls.pan(0, -9000);
    settle(controls);
    const clamped = controls.getPose().target;
    expect(Math.abs(clamped.z)).toBeCloseTo(DEFAULT_LIMITS.panBoundsZ, 2);
    expect(Math.abs(clamped.x)).toBeLessThanOrEqual(DEFAULT_LIMITS.panBoundsX + 1e-6);
  });

  it('never lets the camera dip below the street when dragged past the horizon', () => {
    const { camera, controls } = makeControls();
    for (let i = 0; i < 40; i += 1) {
      controls.orbit(0, 900);
      controls.update(1 / 60);
      expect(camera.position.y).toBeGreaterThan(DEFAULT_LIMITS.groundY);
    }
    expect(controls.getPose().polar).toBeLessThanOrEqual(DEFAULT_LIMITS.maxPolar + 1e-6);
    expect(controls.getPose().polar).toBeGreaterThanOrEqual(DEFAULT_LIMITS.minPolar - 1e-6);
  });

  it('stays above the street even when zoomed all the way in and panned hard', () => {
    const { camera, controls } = makeControls();
    controls.zoom(-900);
    controls.orbit(0, 900);
    controls.pan(4000, 4000);
    settle(controls, 3);
    expect(camera.position.y).toBeGreaterThan(DEFAULT_LIMITS.groundY);
  });

  it('flies smoothly to a clicked object and reports when it lands', () => {
    const { camera, controls } = makeControls();
    const focus = new THREE.Vector3(58, 6, -42);
    controls.flyTo(focus, { distance: 30, duration: 0.6 });
    expect(controls.flying).toBe(true);
    controls.update(0.1);
    expect(camera.position.distanceTo(focus)).toBeGreaterThan(35);

    settle(controls, 1.4);
    expect(controls.flying).toBe(false);
    const pose = controls.getPose();
    expect(pose.target.x).toBeCloseTo(focus.x, 0);
    expect(pose.target.z).toBeCloseTo(focus.z, 0);
    expect(pose.distance).toBeCloseTo(30, 0);
    expect(camera.position.distanceTo(focus)).toBeCloseTo(30, 0);
  });

  it('clamps fly-to distance requests to the zoom limits', () => {
    const { controls } = makeControls();
    controls.flyTo(new THREE.Vector3(0, 4, 0), { distance: 5000, duration: 0.2 });
    settle(controls, 0.6);
    expect(controls.getPose().distance).toBeLessThanOrEqual(DEFAULT_LIMITS.maxDistance);
  });

  it('returns to the block overview on reset', () => {
    const { camera, controls } = makeControls();
    controls.flyTo(new THREE.Vector3(70, 8, 60), { distance: 40, duration: 0.3 });
    settle(controls, 1);
    expect(controls.getPose().target.x).toBeCloseTo(70, 0);

    controls.reset(0.4);
    settle(controls, 1.5);
    const pose = controls.getPose();
    expect(pose.distance).toBeCloseTo(168, 0);
    expect(pose.target.x).toBeCloseTo(0, 0);
    expect(pose.target.z).toBeCloseTo(0, 0);
    expect(camera.position.y).toBeGreaterThan(DEFAULT_LIMITS.groundY);
  });

  it('nudges with the keyboard axes within the same clamps', () => {
    const { controls } = makeControls();
    const azimuth = controls.getPose().azimuth;
    controls.nudge('left');
    settle(controls);
    expect(controls.getPose().azimuth).toBeGreaterThan(azimuth);

    controls.nudge('in');
    settle(controls);
    expect(controls.getPose().distance).toBeLessThan(168);
  });
});
