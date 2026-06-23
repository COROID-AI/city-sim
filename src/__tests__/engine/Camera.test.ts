/**
 * Camera unit tests.
 *
 * Covers: round-trip transform identity, zoom clamping to [0.25, 3.0],
 * boundary clamping on all 4 edges, zoom-at-cursor point preservation,
 * and over-zoom-out centering.
 */
import {
  Camera,
  LERP_FACTOR,
  MAX_ZOOM,
  MIN_ZOOM,
} from '@/engine/Camera';

/** Tolerance for floating-point comparisons. */
const EPS = 1e-6;

/** World + viewport fixture: 1280x1280 world, 800x600 viewport. */
function makeCamera(
  overrides: {
    viewportWidth?: number;
    viewportHeight?: number;
    initialZoom?: number;
    worldWidth?: number;
    worldHeight?: number;
  } = {},
): Camera {
  return new Camera(
    overrides.worldWidth ?? 1280,
    overrides.worldHeight ?? 1280,
    {
      viewportWidth: overrides.viewportWidth ?? 800,
      viewportHeight: overrides.viewportHeight ?? 600,
      initialZoom: overrides.initialZoom ?? 1,
    },
  );
}

describe('Camera', () => {
  describe('worldToScreen / screenToWorld round-trip', () => {
    it.each([0.5, 1.0, 2.0])(
      'is identity at zoom %s (round-trip within 1e-6)',
      (zoom) => {
        const camera = makeCamera({ initialZoom: zoom });
        const samples = [
          [0, 0],
          [100, 200],
          [640, 360],
          [1279, 1279],
          [-50, -75],
        ];
        for (const [wx, wy] of samples) {
          const screen = camera.worldToScreen(wx, wy);
          const back = camera.screenToWorld(screen.x, screen.y);
          expect(Math.abs(back.x - wx)).toBeLessThan(EPS);
          expect(Math.abs(back.y - wy)).toBeLessThan(EPS);
        }
      },
    );

    it('worldToScreen then screenToWorld is identity after pan', () => {
      const camera = makeCamera();
      camera.pan(120, 80);
      const screen = camera.worldToScreen(300, 400);
      const back = camera.screenToWorld(screen.x, screen.y);
      expect(Math.abs(back.x - 300)).toBeLessThan(EPS);
      expect(Math.abs(back.y - 400)).toBeLessThan(EPS);
    });
  });

  describe('zoom clamping', () => {
    it('clamps initial zoom to [MIN_ZOOM, MAX_ZOOM]', () => {
      const tooLow = makeCamera({ initialZoom: 0.01 });
      const tooHigh = makeCamera({ initialZoom: 100 });
      expect(tooLow.zoom).toBe(MIN_ZOOM);
      expect(tooHigh.zoom).toBe(MAX_ZOOM);
    });

    it('zoomAt with extreme zoom-in factor never exceeds MAX_ZOOM', () => {
      const camera = makeCamera({ initialZoom: 2.5 });
      camera.zoomAt(1000, 400, 300);
      expect(camera.zoom).toBeLessThanOrEqual(MAX_ZOOM);
      expect(camera.zoom).toBe(MAX_ZOOM);
    });

    it('zoomAt with extreme zoom-out factor never goes below MIN_ZOOM', () => {
      const camera = makeCamera({ initialZoom: 0.3 });
      camera.zoomAt(0.0001, 400, 300);
      expect(camera.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(camera.zoom).toBe(MIN_ZOOM);
    });

    it('zoomAt with a normal factor scales zoom multiplicatively', () => {
      const camera = makeCamera({ initialZoom: 1 });
      camera.zoomAt(1.5, 400, 300);
      expect(camera.zoom).toBeCloseTo(1.5, 6);
    });
  });

  describe('boundary clamping', () => {
    it('clamps the left edge (camera.x >= 0)', () => {
      const camera = makeCamera({ initialZoom: 1 });
      // Pan far left/up beyond the world origin.
      camera.pan(5000, 5000);
      expect(camera.x).toBeGreaterThanOrEqual(-EPS);
      expect(camera.y).toBeGreaterThanOrEqual(-EPS);
    });

    it('clamps the right edge (visible rect <= worldWidth)', () => {
      const camera = makeCamera({ initialZoom: 1 });
      // Pan far right/down beyond the world's far edge.
      camera.pan(-5000, -5000);
      const visibleW = 800 / camera.zoom;
      expect(camera.x + visibleW).toBeLessThanOrEqual(1280 + EPS);
    });

    it('clamps the bottom edge (visible rect <= worldHeight)', () => {
      const camera = makeCamera({ initialZoom: 1 });
      camera.pan(-5000, -5000);
      const visibleH = 600 / camera.zoom;
      expect(camera.y + visibleH).toBeLessThanOrEqual(1280 + EPS);
    });

    it('clamps the top edge (camera.y >= 0)', () => {
      const camera = makeCamera({ initialZoom: 1 });
      camera.pan(0, 5000);
      expect(camera.y).toBeGreaterThanOrEqual(-EPS);
    });

    it('never shows void beyond any edge after aggressive panning', () => {
      const camera = makeCamera({ initialZoom: 1.5 });
      for (let i = 0; i < 20; i++) {
        camera.pan(-2000, -2000);
        camera.pan(2000, 2000);
      }
      const visibleW = 800 / camera.zoom;
      const visibleH = 600 / camera.zoom;
      expect(camera.x).toBeGreaterThanOrEqual(-EPS);
      expect(camera.y).toBeGreaterThanOrEqual(-EPS);
      expect(camera.x + visibleW).toBeLessThanOrEqual(1280 + EPS);
      expect(camera.y + visibleH).toBeLessThanOrEqual(1280 + EPS);
    });
  });

  describe('over-zoom-out centering', () => {
    it('centers the world when viewport/zoom exceeds world size', () => {
      // At MIN_ZOOM=0.25, visible = 800/0.25 = 3200 > 1280 world.
      const camera = makeCamera({ initialZoom: MIN_ZOOM });
      const visibleW = 800 / camera.zoom;
      const visibleH = 600 / camera.zoom;
      // Centered: camera.x = (worldW - visibleW) / 2 (negative => world centered).
      expect(camera.x).toBeCloseTo((1280 - visibleW) / 2, 6);
      expect(camera.y).toBeCloseTo((1280 - visibleH) / 2, 6);
    });

    it('over-zoom-out via zoomAt centers and stays within bounds', () => {
      const camera = makeCamera({ initialZoom: 1 });
      camera.zoomAt(0.01, 400, 300); // forces MIN_ZOOM
      expect(camera.zoom).toBe(MIN_ZOOM);
      const visibleW = 800 / camera.zoom;
      expect(camera.x).toBeCloseTo((1280 - visibleW) / 2, 6);
    });
  });

  describe('zoom-at-cursor point preservation', () => {
    it('keeps the world point under the cursor stationary across zoom-in', () => {
      const camera = makeCamera({ initialZoom: 1 });
      const cursorX = 400;
      const cursorY = 300;
      const worldBefore = camera.screenToWorld(cursorX, cursorY);
      camera.zoomAt(2.0, cursorX, cursorY);
      const worldAfter = camera.screenToWorld(cursorX, cursorY);
      expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(EPS);
      expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(EPS);
    });

    it('keeps the world point under the cursor stationary across zoom-out', () => {
      // Start zoomed in at the world center so zooming out keeps the cursor's
      // world point away from the clamped edges.
      const camera = makeCamera({ initialZoom: 2 });
      // Center the camera on the world before zooming so clamping does not
      // interfere with the cursor-anchor math.
      const centerVisibleW = 800 / camera.zoom;
      const centerVisibleH = 600 / camera.zoom;
      camera.x = (1280 - centerVisibleW) / 2;
      camera.y = (1280 - centerVisibleH) / 2;
      // Cursor at viewport center.
      const cursorX = 400;
      const cursorY = 300;
      const worldBefore = camera.screenToWorld(cursorX, cursorY);
      camera.zoomAt(0.5, cursorX, cursorY);
      const worldAfter = camera.screenToWorld(cursorX, cursorY);
      expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(EPS);
      expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(EPS);
    });

    it('preserves cursor point even when clamping kicks in (edge cursor)', () => {
      // Cursor at the world origin corner; clamping may shift camera but the
      // cursor world point should still be preserved when no clamp is needed.
      const camera = makeCamera({ initialZoom: 1 });
      const cursorX = 0;
      const cursorY = 0;
      const worldBefore = camera.screenToWorld(cursorX, cursorY);
      camera.zoomAt(1.5, cursorX, cursorY);
      const worldAfter = camera.screenToWorld(cursorX, cursorY);
      expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(EPS);
      expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(EPS);
    });
  });

  describe('getTransform', () => {
    it('returns {x, y, zoom} matching current camera state', () => {
      const camera = makeCamera({ initialZoom: 1.25 });
      camera.pan(100, 50);
      const t = camera.getTransform();
      expect(t.x).toBe(camera.x);
      expect(t.y).toBe(camera.y);
      expect(t.zoom).toBe(camera.zoom);
    });

    it('produces values compatible with Renderer scale-then-translate', () => {
      // worldToScreen must equal the Renderer's effective transform:
      // screen = (world - camera.xy) * zoom.
      const camera = makeCamera({ initialZoom: 2 });
      const t = camera.getTransform();
      const worldX = 300;
      const expectedScreenX = (worldX - t.x) * t.zoom;
      const actualScreenX = camera.worldToScreen(worldX, 0).x;
      expect(actualScreenX).toBeCloseTo(expectedScreenX, 6);
    });
  });

  describe('setViewport', () => {
    it('updates viewport and re-clamps', () => {
      const camera = makeCamera({ initialZoom: 1 });
      camera.pan(-5000, -5000); // push to far corner
      camera.setViewport(400, 300);
      const visibleW = 400 / camera.zoom;
      expect(camera.x + visibleW).toBeLessThanOrEqual(1280 + EPS);
    });
  });

  // ----------------------------------------------------------------
  // Smooth lerp (spec §6.3 Phase 7).
  // ----------------------------------------------------------------
  describe('smooth lerp (update / snapToTarget / target methods)', () => {
    it('exposes LERP_FACTOR = 0.1', () => {
      expect(LERP_FACTOR).toBe(0.1);
    });

    it('update() moves current 10% toward target per frame', () => {
      const camera = makeCamera({ initialZoom: 1 });
      // Set a target far from current (current x=0, target x=100).
      camera.targetX = 100;
      camera.targetY = 0;
      camera.targetZoom = 1;
      camera.update();
      // After one update, x should be 0 + (100-0)*0.1 = 10.
      expect(camera.x).toBeCloseTo(10, 6);
    });

    it('update() converges toward target after repeated calls', () => {
      const camera = makeCamera({ initialZoom: 1 });
      camera.targetX = 100;
      camera.targetY = 0;
      camera.targetZoom = 1;
      // Call update many times; should converge very close to target.
      for (let i = 0; i < 100; i++) camera.update();
      expect(camera.x).toBeCloseTo(100, 1);
    });

    it('snapToTarget instantly sets current to target', () => {
      const camera = makeCamera({ initialZoom: 1 });
      camera.targetX = 200;
      camera.targetY = 150;
      camera.targetZoom = 2;
      camera.snapToTarget();
      expect(camera.x).toBe(200);
      expect(camera.y).toBe(150);
      expect(camera.zoom).toBe(2);
    });

    it('panTarget updates target without moving current instantly', () => {
      // Use a large world so clamping does not interfere with the pan delta.
      const camera = makeCamera({ initialZoom: 1, worldWidth: 10000, worldHeight: 10000 });
      // Start the camera in the middle of the world so pan has room.
      camera.x = 5000;
      camera.y = 5000;
      camera.targetX = 5000;
      camera.targetY = 5000;
      const startX = camera.x;
      camera.panTarget(100, 0);
      // Current x should NOT have moved yet (only target).
      expect(camera.x).toBe(startX);
      // Target should have moved by -100/zoom = -100.
      expect(camera.targetX).toBeCloseTo(startX - 100, 6);
    });

    it('zoomTargetAt updates target zoom without changing current zoom', () => {
      const camera = makeCamera({ initialZoom: 1 });
      const startZoom = camera.zoom;
      camera.zoomTargetAt(2, 0, 0);
      expect(camera.zoom).toBe(startZoom);
      expect(camera.targetZoom).toBeCloseTo(2, 6);
    });

    it('existing pan() still mutates x/y instantly (backward compat)', () => {
      // Use a large world so clamping does not interfere with the pan delta.
      const camera = makeCamera({ initialZoom: 1, worldWidth: 10000, worldHeight: 10000 });
      // Start the camera in the middle of the world so pan has room.
      camera.x = 5000;
      camera.y = 5000;
      camera.targetX = 5000;
      camera.targetY = 5000;
      camera.pan(100, 50);
      // pan moves instantly: x decreases by dx/zoom.
      expect(camera.x).toBeCloseTo(5000 - 100, 6);
      expect(camera.y).toBeCloseTo(5000 - 50, 6);
      // target should be synced.
      expect(camera.targetX).toBeCloseTo(camera.x, 6);
      expect(camera.targetY).toBeCloseTo(camera.y, 6);
    });

    it('existing zoomAt() still mutates zoom instantly (backward compat)', () => {
      const camera = makeCamera({ initialZoom: 1 });
      camera.zoomAt(2, 0, 0);
      expect(camera.zoom).toBeCloseTo(2, 6);
      expect(camera.targetZoom).toBeCloseTo(camera.zoom, 6);
    });

    it('update() snaps exactly when within threshold', () => {
      const camera = makeCamera({ initialZoom: 1 });
      // Set target very close to current (within 0.01 threshold).
      camera.targetX = camera.x + 0.005;
      camera.update();
      expect(camera.x).toBe(camera.targetX);
    });
  });
});
