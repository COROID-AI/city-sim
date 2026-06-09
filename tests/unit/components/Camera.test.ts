/**
 * Camera unit tests.
 *
 * Verifies the lerp convergence, the framerate-independent behaviour,
 * the 10% margin rect math, and the dt clamping.
 */
import {
  CAMERA_LERP,
  MAX_CAMERA_DT_MS,
  VIEWPORT_CULL_MARGIN,
  clampDt,
  createCamera,
  createTarget,
  getViewportRect,
  isPointInRect,
  updateCamera,
} from '@/components/city/Camera';

describe('Camera', () => {
  describe('module surface', () => {
    it('exposes the canonical lerp factor 0.1', () => {
      expect(CAMERA_LERP).toBeCloseTo(0.1, 5);
    });
    it('exposes the canonical cull margin 0.1', () => {
      expect(VIEWPORT_CULL_MARGIN).toBeCloseTo(0.1, 5);
    });
    it('exposes a sane max dt for tab-resume safety', () => {
      expect(MAX_CAMERA_DT_MS).toBe(100);
    });
  });

  describe('createCamera / createTarget', () => {
    it('builds a camera at the origin with scale 1 by default', () => {
      const cam = createCamera();
      expect(cam.origin).toEqual({ x: 0, y: 0 });
      expect(cam.scale).toBe(1);
    });
    it('honours provided overrides', () => {
      const cam = createCamera({ origin: { x: 10, y: 20 }, scale: 2 });
      expect(cam.origin).toEqual({ x: 10, y: 20 });
      expect(cam.scale).toBe(2);
    });
    it('createTarget mirrors the camera (independent object)', () => {
      const cam = createCamera({ origin: { x: 5, y: 5 }, scale: 3 });
      const target = createTarget(cam);
      expect(target).toEqual(cam);
      expect(target).not.toBe(cam);
    });
  });

  describe('clampDt', () => {
    it('clamps negative values to 0', () => {
      expect(clampDt(-5)).toBe(0);
    });
    it('clamps NaN to 0', () => {
      expect(clampDt(Number.NaN)).toBe(0);
    });
    it('clamps oversized dt to MAX_CAMERA_DT_MS', () => {
      expect(clampDt(5000)).toBe(MAX_CAMERA_DT_MS);
    });
    it('passes through reasonable dt', () => {
      expect(clampDt(16.6)).toBe(16.6);
    });
  });

  describe('updateCamera (lerp)', () => {
    it('moves the camera part-way toward the target per frame', () => {
      const cam = createCamera();
      const target = createCamera({ origin: { x: 100, y: 0 }, scale: 1 });
      // 16.6ms at lerp 0.1 should give exactly ~10% of the way.
      updateCamera(cam, target, 16.6, 0.1);
      expect(cam.origin.x).toBeGreaterThan(0);
      expect(cam.origin.x).toBeLessThan(100);
    });

    it('converges to the target after many frames', () => {
      const cam = createCamera();
      const target = createCamera({ origin: { x: 100, y: 50 }, scale: 2 });
      for (let i = 0; i < 200; i += 1) {
        updateCamera(cam, target, 16.6, 0.1);
      }
      expect(cam.origin.x).toBeCloseTo(100, 5);
      expect(cam.origin.y).toBeCloseTo(50, 5);
      expect(cam.scale).toBeCloseTo(2, 5);
    });

    it('handles dt larger than one frame (framerate-independent)', () => {
      const cam = createCamera();
      const target = createCamera({ origin: { x: 100, y: 0 }, scale: 1 });
      // 60 frames at 16.6ms = 996ms total. Equivalent to a single
      // 996ms update should give the same final value.
      for (let i = 0; i < 60; i += 1) {
        updateCamera(cam, target, 16.6, 0.1);
      }
      const cam2 = createCamera();
      updateCamera(cam2, target, 60 * 16.6, 0.1);
      expect(cam2.origin.x).toBeCloseTo(cam.origin.x, 4);
    });

    it('clamps huge dt so a backgrounded tab does not jump the camera', () => {
      const cam = createCamera();
      const target = createCamera({ origin: { x: 100, y: 0 }, scale: 1 });
      // 10 seconds of dt is way over the cap.
      updateCamera(cam, target, 10_000, 0.1);
      // 100ms of cap should move us ~63% of the way, not all the way.
      expect(cam.origin.x).toBeGreaterThan(0);
      expect(cam.origin.x).toBeLessThan(100);
    });
  });

  describe('getViewportRect (10% margin)', () => {
    it('produces a rect 10% larger on each side than the raw viewport', () => {
      const cam = createCamera({ origin: { x: 0, y: 0 }, scale: 1 });
      const rect = getViewportRect(cam, 800, 480, VIEWPORT_CULL_MARGIN);
      // Raw viewport is 800x480, margin adds 80 horizontally and 48 vertically.
      expect(rect.width).toBeCloseTo(800 + 80 * 2, 5);
      expect(rect.height).toBeCloseTo(480 + 48 * 2, 5);
      expect(rect.x).toBeCloseTo(-80, 5);
      expect(rect.y).toBeCloseTo(-48, 5);
    });

    it('accounts for camera scale (scale 2 means half the world width)', () => {
      const cam = createCamera({ origin: { x: 0, y: 0 }, scale: 2 });
      const rect = getViewportRect(cam, 800, 480, 0.1);
      // World width is 800/2 = 400; margin adds 40 each side.
      expect(rect.width).toBeCloseTo(400 + 80, 5);
    });

    it('offsets by the camera origin', () => {
      const cam = createCamera({ origin: { x: 100, y: 50 }, scale: 1 });
      const rect = getViewportRect(cam, 800, 480, 0.1);
      expect(rect.x).toBeCloseTo(100 - 80, 5);
      expect(rect.y).toBeCloseTo(50 - 48, 5);
    });

    it('isPointInRect returns true for points inside, false outside', () => {
      const rect = { x: 0, y: 0, width: 100, height: 100 };
      expect(isPointInRect({ x: 50, y: 50 }, rect)).toBe(true);
      expect(isPointInRect({ x: 0, y: 0 }, rect)).toBe(true);
      expect(isPointInRect({ x: 100, y: 100 }, rect)).toBe(true);
      expect(isPointInRect({ x: -1, y: 50 }, rect)).toBe(false);
      expect(isPointInRect({ x: 101, y: 50 }, rect)).toBe(false);
    });
  });
});
