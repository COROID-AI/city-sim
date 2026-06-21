import { Camera, TILE_SIZE, MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM, LERP_FACTOR } from '@/engine/Camera';
import type { CameraOptions } from '@/engine/Camera';

/** Default camera options for tests: 800×600 viewport, 80×80 tile world. */
const defaultOptions: CameraOptions = {
  viewportWidth: 800,
  viewportHeight: 600,
  worldWidth: 80,
  worldHeight: 80,
};

/** World pixel dimensions for default options. */
const WORLD_PX = 80 * TILE_SIZE; // 1280

function createCamera(options: Partial<CameraOptions> = {}): Camera {
  return new Camera({ ...defaultOptions, ...options });
}

describe('Camera', () => {
  // -------------------------------------------------------------------------
  // Construction & defaults
  // -------------------------------------------------------------------------

  it('initializes with default zoom 1.0', () => {
    const cam = createCamera();
    expect(cam.targetZoomLevel).toBe(DEFAULT_ZOOM);
    expect(cam.zoom).toBeCloseTo(DEFAULT_ZOOM);
  });

  it('clamps initial position when world is larger than viewport', () => {
    // 800×600 viewport, 1280×1280 world. World doesn't fit, so clamp
    // range is [minX=-480, maxX=0]. Center (-240) is within range.
    const cam = createCamera();
    expect(cam.targetXPos).toBe(-240); // (800 - 1280) / 2
    expect(cam.targetYPos).toBe(-340); // (600 - 1280) / 2
  });

  it('centers the world when viewport is larger than world', () => {
    const cam = createCamera({ viewportWidth: 2000, viewportHeight: 2000 });
    const expectedX = (2000 - WORLD_PX) / 2;
    const expectedY = (2000 - WORLD_PX) / 2;
    expect(cam.targetXPos).toBeCloseTo(expectedX);
    expect(cam.targetYPos).toBeCloseTo(expectedY);
  });

  it('throws on invalid options', () => {
    expect(() => createCamera({ viewportWidth: 0 })).toThrow();
    expect(() => createCamera({ viewportWidth: -1 })).toThrow();
    expect(() => createCamera({ viewportHeight: 0 })).toThrow();
    expect(() => createCamera({ worldWidth: 0 })).toThrow();
    expect(() => createCamera({ worldHeight: -5 })).toThrow();
  });

  // -------------------------------------------------------------------------
  // Zoom clamping
  // -------------------------------------------------------------------------

  describe('zoom clamping', () => {
    it('clamps zoom to [0.25, 3.0]', () => {
      const cam = createCamera();

      // Try to zoom way in.
      cam.zoomAt(400, 300, 100);
      expect(cam.targetZoomLevel).toBe(MAX_ZOOM);

      // Try to zoom way out.
      cam.zoomAt(400, 300, -100);
      expect(cam.targetZoomLevel).toBe(MIN_ZOOM);
    });

    it('does not change zoom when already at limit', () => {
      const cam = createCamera();
      cam.zoomAt(400, 300, 100); // max out
      const zoomBefore = cam.targetZoomLevel;
      cam.zoomAt(400, 300, 0.5); // try to go further
      expect(cam.targetZoomLevel).toBe(zoomBefore);
    });

    it('applies small zoom deltas correctly', () => {
      const cam = createCamera();
      cam.zoomAt(400, 300, 0.5);
      expect(cam.targetZoomLevel).toBeCloseTo(1.5);
    });
  });

  // -------------------------------------------------------------------------
  // Zoom anchoring
  // -------------------------------------------------------------------------

  describe('zoom anchoring', () => {
    it('keeps the world point under the cursor fixed during zoom', () => {
      const cam = createCamera();
      const screenX = 400;
      const screenY = 300;

      // Record world point under cursor before zoom.
      const worldXBefore = (screenX - cam.targetXPos) / cam.targetZoomLevel;
      const worldYBefore = (screenY - cam.targetYPos) / cam.targetZoomLevel;

      cam.zoomAt(screenX, screenY, 0.5);

      // After zoom, the same world point should be under the cursor.
      const worldXAfter = (screenX - cam.targetXPos) / cam.targetZoomLevel;
      const worldYAfter = (screenY - cam.targetYPos) / cam.targetZoomLevel;

      expect(worldXAfter).toBeCloseTo(worldXBefore, 10);
      expect(worldYAfter).toBeCloseTo(worldYBefore, 10);
    });
  });

  // -------------------------------------------------------------------------
  // Pan
  // -------------------------------------------------------------------------

  describe('pan', () => {
    it('panBy(dx, dy) subtracts dx/dy from target position', () => {
      const cam = createCamera();
      const xBefore = cam.targetXPos;
      const yBefore = cam.targetYPos;
      cam.panBy(100, 50);
      // panBy does targetX -= dx, targetY -= dy
      expect(cam.targetXPos).toBe(xBefore - 100);
      expect(cam.targetYPos).toBe(yBefore - 50);
    });

    it('panBy is clamped by world boundaries (right/top edges)', () => {
      const cam = createCamera();
      // panBy(negative dx) moves target right: targetX -= (-10000) = +10000
      // Clamped to maxX = 0
      cam.panBy(-10000, -10000);
      expect(cam.targetXPos).toBe(0);
      expect(cam.targetYPos).toBe(0);
    });

    it('panBy clamps when panning beyond left/bottom edges', () => {
      const cam = createCamera();
      // panBy(positive dx) moves target left: targetX -= 10000
      // Clamped to minX = 800 - 1280 = -480
      cam.panBy(10000, 10000);
      expect(cam.targetXPos).toBe(-480);
      expect(cam.targetYPos).toBe(-680); // 600 - 1280 = -680
    });
  });

  // -------------------------------------------------------------------------
  // Lerp convergence
  // -------------------------------------------------------------------------

  describe('lerp convergence', () => {
    it('current state converges toward target with factor 0.1', () => {
      const cam = createCamera();
      const initialX = cam.x;
      cam.panBy(100, 0);
      const targetX = cam.targetXPos;

      // Before any update, current should still be at initial position.
      expect(cam.x).toBe(initialX);

      cam.update();
      // currentX += (targetX - currentX) * 0.1
      const expectedAfterOne = initialX + (targetX - initialX) * LERP_FACTOR;
      expect(cam.x).toBeCloseTo(expectedAfterOne);
    });

    it('converges to target after many updates', () => {
      const cam = createCamera();
      cam.panBy(100, 0);
      const targetX = cam.targetXPos;

      // Run many updates to converge (lerp 0.1 needs ~200 for 2-digit precision).
      for (let i = 0; i < 200; i += 1) {
        cam.update();
      }

      expect(cam.x).toBeCloseTo(targetX, 2);
    });

    it('zoom also lerps toward target', () => {
      const cam = createCamera();
      cam.zoomAt(400, 300, 1.0); // target zoom = 2.0

      expect(cam.zoom).toBeCloseTo(1.0); // current hasn't moved yet

      cam.update();
      const expectedZoom = 1.0 + (2.0 - 1.0) * LERP_FACTOR;
      expect(cam.zoom).toBeCloseTo(expectedZoom);

      // Converge
      for (let i = 0; i < 200; i += 1) {
        cam.update();
      }
      expect(cam.zoom).toBeCloseTo(2.0, 2);
    });
  });

  // -------------------------------------------------------------------------
  // Matrix output
  // -------------------------------------------------------------------------

  describe('matrix output', () => {
    it('getTransform returns CameraTransform with current values', () => {
      const cam = createCamera();
      cam.panBy(50, 30);
      for (let i = 0; i < 200; i += 1) cam.update();

      const t = cam.getTransform();
      expect(t.x).toBeCloseTo(cam.targetXPos, 2);
      expect(t.y).toBeCloseTo(cam.targetYPos, 2);
      expect(t.zoom).toBeCloseTo(DEFAULT_ZOOM, 2);
    });

    it('getTranslateMatrix returns [tx, ty]', () => {
      const cam = createCamera();
      cam.panBy(50, 30);
      for (let i = 0; i < 200; i += 1) cam.update();

      const [tx, ty] = cam.getTranslateMatrix();
      expect(tx).toBeCloseTo(cam.targetXPos, 2);
      expect(ty).toBeCloseTo(cam.targetYPos, 2);
    });

    it('getScaleMatrix returns [zoom, zoom]', () => {
      const cam = createCamera();
      cam.zoomAt(400, 300, 0.5);
      for (let i = 0; i < 200; i += 1) cam.update();

      const [sx, sy] = cam.getScaleMatrix();
      expect(sx).toBeCloseTo(1.5, 2);
      expect(sy).toBeCloseTo(1.5, 2);
    });
  });

  // -------------------------------------------------------------------------
  // Boundary clamping
  // -------------------------------------------------------------------------

  describe('boundary clamping', () => {
    it('never shows void beyond world left edge', () => {
      const cam = createCamera();
      // panBy(positive dx) moves target left (targetX -= dx).
      cam.panBy(10000, 0);
      // At zoom 1.0: minX = 800 - 1280 = -480
      expect(cam.targetXPos).toBe(-480);
    });

    it('never shows void beyond world right edge', () => {
      const cam = createCamera();
      // panBy(negative dx) moves target right: targetX -= (-10000) = +10000
      // Clamped to maxX = 0
      cam.panBy(-10000, 0);
      expect(cam.targetXPos).toBe(0);
    });

    it('centers world when zoomed out enough to fit in viewport', () => {
      const cam = createCamera({ viewportWidth: 2000, viewportHeight: 2000 });
      // At zoom 1.0, world (1280px) fits in viewport (2000px).
      const expectedX = (2000 - WORLD_PX) / 2;
      const expectedY = (2000 - WORLD_PX) / 2;
      expect(cam.targetXPos).toBeCloseTo(expectedX);
      expect(cam.targetYPos).toBeCloseTo(expectedY);

      // Zoom out further — should still center.
      cam.zoomAt(1000, 1000, -0.5);
      const zoomedExpectedX = (2000 - WORLD_PX * cam.targetZoomLevel) / 2;
      const zoomedExpectedY = (2000 - WORLD_PX * cam.targetZoomLevel) / 2;
      expect(cam.targetXPos).toBeCloseTo(zoomedExpectedX);
      expect(cam.targetYPos).toBeCloseTo(zoomedExpectedY);
    });

    it('clamps correctly at max zoom', () => {
      const cam = createCamera();
      cam.zoomAt(400, 300, 100); // max zoom 3.0
      // At zoom 3.0, visible world = 1280 * 3 = 3840px. Viewport = 800px.
      // minX = 800 - 3840 = -3040, maxX = 0
      expect(cam.targetXPos).toBeGreaterThanOrEqual(-3040);
      expect(cam.targetXPos).toBeLessThanOrEqual(0);
    });

    it('clamps correctly at min zoom when world fits in viewport', () => {
      const cam = createCamera({ viewportWidth: 2000, viewportHeight: 2000 });
      cam.zoomAt(1000, 1000, -100); // min zoom 0.25
      // At zoom 0.25, visible world = 1280 * 0.25 = 320px. Viewport = 2000px.
      // World fits, so center it.
      const expectedX = (2000 - 320) / 2;
      expect(cam.targetXPos).toBeCloseTo(expectedX);
    });
  });

  // -------------------------------------------------------------------------
  // Event attach/detach
  // -------------------------------------------------------------------------

  describe('event attach/detach', () => {
    function createMockCanvas(): {
      canvas: HTMLCanvasElement;
      listeners: Record<string, Array<EventListenerOrEventListenerObject>>;
    } {
      const listeners: Record<string, Array<EventListenerOrEventListenerObject>> = {};

      const canvas = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        addEventListener: jest.fn((event: string, handler: EventListenerOrEventListenerObject) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event]!.push(handler);
        }),
        removeEventListener: jest.fn((event: string, handler: EventListenerOrEventListenerObject) => {
          if (!listeners[event]) return;
          const idx = listeners[event]!.indexOf(handler);
          if (idx >= 0) listeners[event]!.splice(idx, 1);
        }),
      } as unknown as HTMLCanvasElement;

      return { canvas, listeners };
    }

    it('attach registers pointer and wheel event listeners', () => {
      const { canvas, listeners } = createMockCanvas();
      const cam = createCamera();
      cam.attach(canvas);

      expect(listeners['pointerdown']).toHaveLength(1);
      expect(listeners['pointermove']).toHaveLength(1);
      expect(listeners['pointerup']).toHaveLength(1);
      expect(listeners['pointercancel']).toHaveLength(1);
      expect(listeners['wheel']).toHaveLength(1);
    });

    it('detach removes all event listeners', () => {
      const { canvas, listeners } = createMockCanvas();
      const cam = createCamera();
      cam.attach(canvas);
      cam.detach();

      expect(listeners['pointerdown']).toHaveLength(0);
      expect(listeners['pointermove']).toHaveLength(0);
      expect(listeners['pointerup']).toHaveLength(0);
      expect(listeners['pointercancel']).toHaveLength(0);
      expect(listeners['wheel']).toHaveLength(0);
    });

    it('attach on new canvas detaches from previous canvas', () => {
      const { canvas: canvas1, listeners: listeners1 } = createMockCanvas();
      const { canvas: canvas2, listeners: listeners2 } = createMockCanvas();
      const cam = createCamera();
      cam.attach(canvas1);
      expect(listeners1['pointerdown']).toHaveLength(1);

      cam.attach(canvas2);
      expect(listeners1['pointerdown']).toHaveLength(0); // detached from canvas1
      expect(listeners2['pointerdown']).toHaveLength(1); // attached to canvas2
    });

    it('detach without prior attach is a no-op', () => {
      const cam = createCamera();
      expect(() => cam.detach()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // setViewportSize
  // -------------------------------------------------------------------------

  describe('setViewportSize', () => {
    it('updates viewport and re-clamps', () => {
      const cam = createCamera();
      cam.setViewportSize(2000, 2000);
      expect(cam.viewWidth).toBe(2000);
      expect(cam.viewHeight).toBe(2000);
      // World now fits in viewport, so should be centered.
      const expectedX = (2000 - WORLD_PX) / 2;
      expect(cam.targetXPos).toBeCloseTo(expectedX);
    });

    it('throws on invalid dimensions', () => {
      const cam = createCamera();
      expect(() => cam.setViewportSize(0, 600)).toThrow();
      expect(() => cam.setViewportSize(800, -1)).toThrow();
    });
  });
});
