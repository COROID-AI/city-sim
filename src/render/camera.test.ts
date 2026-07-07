import { Camera, KEYBOARD_PAN_SPEED, MIN_ZOOM, MAX_ZOOM } from './camera';
import type { CameraInput } from './camera';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a camera with a known viewport.
 *
 * Default world is 100×100 with an 800×600 viewport at zoom 10, giving a
 * visible area of 80×60 world units (valid center X ∈ [40,60], Y ∈ [30,70]).
 * Tests that need panning room pass `zoom: 20` (visible 40×30) or a larger
 * world via `overrides`.
 */
function makeCamera(overrides: Partial<ConstructorParameters<typeof Camera>[0]> = {}): Camera {
  return new Camera({
    worldWidth: 100,
    worldHeight: 100,
    viewportWidth: 800,
    viewportHeight: 600,
    zoom: 10,
    ...overrides,
  });
}

function input(keys: string[] = [], dragX = 0, dragY = 0): CameraInput {
  return {
    keys: new Set(keys),
    mouseDragX: dragX,
    mouseDragY: dragY,
  };
}

// ─── worldToScreen / screenToWorld ───────────────────────────────────────────

describe('Camera transforms', () => {
  it('maps the world center to the viewport center', () => {
    const cam = makeCamera({ zoom: 10 });
    const screen = cam.worldToScreen(cam.centerX, cam.centerY);
    expect(screen.x).toBeCloseTo(400, 5);
    expect(screen.y).toBeCloseTo(300, 5);
  });

  it('maps the world origin consistently', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: 10 });
    // origin (0,0) → ((0-50)*10+400, (0-50)*10+300) = (-100, -200)
    const screen = cam.worldToScreen(0, 0);
    expect(screen.x).toBeCloseTo(-100, 5);
    expect(screen.y).toBeCloseTo(-200, 5);
  });

  it('worldToScreen and screenToWorld are exact inverses', () => {
    const cam = makeCamera({ centerX: 37.3, centerY: 62.1, zoom: 14.5 });
    const points: Array<[number, number]> = [
      [0, 0],
      [100, 100],
      [12.5, 87.5],
      [37.3, 62.1],
      [-20, 120],
    ];
    for (const [wx, wy] of points) {
      const s = cam.worldToScreen(wx, wy);
      const w = cam.screenToWorld(s.x, s.y);
      expect(w.x).toBeCloseTo(wx, 7);
      expect(w.y).toBeCloseTo(wy, 7);
    }
  });

  it('screenToWorld maps the viewport center to the world center', () => {
    // zoom 16 → visibleWidth=50 (half 25), valid X∈[25,75]; 42 ok.
    //          visibleHeight=37.5 (half ~18.75), valid Y∈[~18.75,~81.25]; 58 ok.
    const cam = makeCamera({ centerX: 42, centerY: 58, zoom: 16 });
    const w = cam.screenToWorld(400, 300);
    expect(w.x).toBeCloseTo(42, 5);
    expect(w.y).toBeCloseTo(58, 5);
  });

  it('respects zoom in the transform', () => {
    const cam = makeCamera({ centerX: 0, centerY: 0, zoom: 20, viewportWidth: 0, viewportHeight: 0 });
    // (1 world unit) * 20 zoom = 20 screen px
    expect(cam.worldToScreen(1, 0).x).toBeCloseTo(20, 5);
  });
});

// ─── Clamping ────────────────────────────────────────────────────────────────

describe('Camera clamping', () => {
  it('clamps panning so the viewport cannot leave the left edge', () => {
    const cam = makeCamera({ zoom: 10, centerX: 50, centerY: 50 });
    // visibleWidth = 800/10 = 80; half = 40; min center X = 40
    cam.panBy(-1000, 0);
    expect(cam.centerX).toBeCloseTo(40, 5);
  });

  it('clamps panning so the viewport cannot leave the right edge', () => {
    const cam = makeCamera({ zoom: 10, centerX: 50, centerY: 50 });
    // max center X = 100 - 40 = 60
    cam.panBy(1000, 0);
    expect(cam.centerX).toBeCloseTo(60, 5);
  });

  it('clamps panning so the viewport cannot leave the top edge', () => {
    const cam = makeCamera({ zoom: 10, centerX: 50, centerY: 50 });
    // visibleHeight = 600/10 = 60; half = 30; min center Y = 30
    cam.panBy(0, -1000);
    expect(cam.centerY).toBeCloseTo(30, 5);
  });

  it('clamps panning so the viewport cannot leave the bottom edge', () => {
    const cam = makeCamera({ zoom: 10, centerX: 50, centerY: 50 });
    // max center Y = 100 - 30 = 70
    cam.panBy(0, 1000);
    expect(cam.centerY).toBeCloseTo(70, 5);
  });

  it('centers the world when the viewport is larger than the world', () => {
    const cam = makeCamera({
      worldWidth: 100,
      worldHeight: 100,
      viewportWidth: 800,
      viewportHeight: 600,
      zoom: 4, // visibleWidth = 200 > 100, visibleHeight = 150 > 100
    });
    cam.panBy(1000, 1000);
    expect(cam.centerX).toBeCloseTo(50, 5);
    expect(cam.centerY).toBeCloseTo(50, 5);
  });

  it('clamps setCenter directly', () => {
    const cam = makeCamera({ zoom: 10 });
    cam.setCenter(-100, -100);
    expect(cam.centerX).toBeCloseTo(40, 5);
    expect(cam.centerY).toBeCloseTo(30, 5);
    cam.setCenter(1000, 1000);
    expect(cam.centerX).toBeCloseTo(60, 5);
    expect(cam.centerY).toBeCloseTo(70, 5);
  });

  it('re-clamps when the viewport shrinks', () => {
    const cam = makeCamera({ zoom: 10, centerX: 60, centerY: 70 });
    // Shrink viewport: now visibleWidth = 400/10 = 40; half = 20; max center = 80
    cam.setViewport(400, 300);
    // center was 60 which is within [20,80], so unchanged
    expect(cam.centerX).toBe(60);
    expect(cam.centerY).toBe(70);
  });

  it('clamps zoom to valid bounds', () => {
    const cam = makeCamera();
    cam.setZoom(0.5);
    expect(cam.zoom).toBe(MIN_ZOOM);
    cam.setZoom(9999);
    expect(cam.zoom).toBe(MAX_ZOOM);
  });
});

// ─── setCenter / setViewport ─────────────────────────────────────────────────

describe('Camera setCenter / setViewport', () => {
  it('setCenter moves the center to a valid point', () => {
    const cam = makeCamera({ zoom: 10 });
    cam.setCenter(45, 55);
    expect(cam.centerX).toBe(45);
    expect(cam.centerY).toBe(55);
  });

  it('defaults the center to the world center', () => {
    const cam = makeCamera({ worldWidth: 100, worldHeight: 100, zoom: 10 });
    expect(cam.centerX).toBeCloseTo(50, 5);
    expect(cam.centerY).toBeCloseTo(50, 5);
  });

  it('setViewport updates dimensions', () => {
    const cam = makeCamera();
    cam.setViewport(1024, 768);
    expect(cam.viewportWidth).toBe(1024);
    expect(cam.viewportHeight).toBe(768);
  });
});

// ─── tick (keyboard + mouse) ─────────────────────────────────────────────────

describe('Camera.tick', () => {
  // zoom 20 → visibleWidth=40 (half 20, valid X∈[20,80]); visibleHeight=30
  //          (half 15, valid Y∈[15,85]). Center 50 has room to pan ±24.
  const tickZoom = 20;

  it('pans right with ArrowRight', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    const before = cam.centerX;
    cam.tick(input(['arrowright']), 1000); // 1 second
    expect(cam.centerX).toBeGreaterThan(before);
    expect(cam.centerX).toBeCloseTo(before + KEYBOARD_PAN_SPEED, 5);
  });

  it('pans left with ArrowLeft', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    const before = cam.centerX;
    cam.tick(input(['arrowleft']), 1000);
    expect(cam.centerX).toBeCloseTo(before - KEYBOARD_PAN_SPEED, 5);
  });

  it('pans up with ArrowUp', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    const before = cam.centerY;
    cam.tick(input(['arrowup']), 1000);
    expect(cam.centerY).toBeCloseTo(before - KEYBOARD_PAN_SPEED, 5);
  });

  it('pans down with ArrowDown', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    const before = cam.centerY;
    cam.tick(input(['arrowdown']), 1000);
    expect(cam.centerY).toBeCloseTo(before + KEYBOARD_PAN_SPEED, 5);
  });

  it('pans with WASD', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    const bx = cam.centerX;
    const by = cam.centerY;
    cam.tick(input(['w', 'a', 's', 'd']), 500); // cancels out → no move
    expect(cam.centerX).toBeCloseTo(bx, 5);
    expect(cam.centerY).toBeCloseTo(by, 5);
  });

  it('pans diagonally with W and D', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    const bx = cam.centerX;
    const by = cam.centerY;
    cam.tick(input(['w', 'd']), 1000);
    expect(cam.centerX).toBeCloseTo(bx + KEYBOARD_PAN_SPEED, 5);
    expect(cam.centerY).toBeCloseTo(by - KEYBOARD_PAN_SPEED, 5);
  });

  it('ignores unrecognised keys', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    cam.tick(input(['shift', 'space']), 1000);
    expect(cam.centerX).toBe(50);
    expect(cam.centerY).toBe(50);
  });

  it('pans via mouse drag (dragging right moves world right/center left)', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    const before = cam.centerX;
    // Drag right by 100px: world delta = -100/20 = -5 → center moves left
    cam.tick(input([], 100, 0), 16);
    expect(cam.centerX).toBeCloseTo(before - 5, 5);
  });

  it('pans via mouse drag vertically', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    const before = cam.centerY;
    // Drag down by 60px: world delta = -60/20 = -3 → center moves up
    cam.tick(input([], 0, 60), 16);
    expect(cam.centerY).toBeCloseTo(before - 3, 5);
  });

  it('mouse drag is clamped to world bounds', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    // Huge leftward drag → clamped to min center X (20)
    cam.tick(input([], 10000, 0), 16);
    expect(cam.centerX).toBeCloseTo(20, 5);
  });

  it('does nothing with empty input', () => {
    const cam = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    cam.tick(input(), 1000);
    expect(cam.centerX).toBe(50);
    expect(cam.centerY).toBe(50);
  });

  it('scales pan distance by elapsed time', () => {
    const cam1 = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    const cam2 = makeCamera({ centerX: 50, centerY: 50, zoom: tickZoom });
    cam1.tick(input(['arrowright']), 500);  // 0.5s
    cam2.tick(input(['arrowright']), 1000); // 1s
    expect(cam2.centerX - 50).toBeCloseTo(2 * (cam1.centerX - 50), 5);
  });
});

// ─── applyTransform ──────────────────────────────────────────────────────────

describe('Camera.applyTransform', () => {
  it('configures the context so worldToScreen matches direct drawing', () => {
    // zoom 20 → valid X∈[20,80], Y∈[15,85]; center (25,25) is within range.
    const cam = makeCamera({ centerX: 25, centerY: 25, zoom: 20 });
    // Stand-in context that records the transform operations.
    const operations: Array<[string, ...number[]]> = [];
    const ctx = {
      translate: jest.fn((x: number, y: number) => operations.push(['translate', x, y])),
      scale: jest.fn((x: number, y: number) => operations.push(['scale', x, y])),
    } as unknown as CanvasRenderingContext2D;

    cam.applyTransform(ctx);

    // translate(vw/2, vh/2) → scale(zoom) → translate(-centerX, -centerY)
    expect(operations).toEqual([
      ['translate', 400, 300],
      ['scale', 20, 20],
      ['translate', -25, -25],
    ]);
  });
});
