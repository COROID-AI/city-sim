import {
  Camera,
  DEFAULT_MIN_ZOOM,
  DEFAULT_MAX_ZOOM,
  DEFAULT_SMOOTHING_RATE,
  MAX_DT,
} from '@/engine/Camera';

describe('Camera', () => {
  it('initialises at origin with zoom 1 and target equal to position', () => {
    const cam = new Camera({ width: 1000, height: 1000 });
    expect(cam.position).toEqual({ x: 0, y: 0 });
    expect(cam.zoom).toBe(1);
    expect(cam.targetPosition).toEqual({ x: 0, y: 0 });
    expect(cam.targetZoom).toBe(1);
  });

  it('panBy + update converges to target within tolerance', () => {
    const cam = new Camera({ width: 1000, height: 1000 }, { smoothingRate: 12 });
    cam.setViewport(800, 600);
    cam.panBy(200, 100);
    // Run many small steps; should converge.
    for (let i = 0; i < 2000; i++) cam.update(0.01);
    expect(cam.position.x).toBeCloseTo(200, 0);
    expect(cam.position.y).toBeCloseTo(100, 0);
  });

  it('zoom converges to target', () => {
    const cam = new Camera({ width: 1000, height: 1000 });
    cam.setZoom(2);
    for (let i = 0; i < 2000; i++) cam.update(0.01);
    expect(cam.zoom).toBeCloseTo(2, 2);
  });

  it('setZoom outside [min,max] is clamped', () => {
    const cam = new Camera({ width: 1000, height: 1000 });
    cam.setZoom(-5);
    expect(cam.targetZoom).toBe(DEFAULT_MIN_ZOOM);
    cam.setZoom(1000);
    expect(cam.targetZoom).toBe(DEFAULT_MAX_ZOOM);
  });

  it('update respects max dt cap', () => {
    const cam = new Camera({ width: 1000, height: 1000 });
    cam.setZoom(2);
    // A huge dt should not cause the camera to overshoot dramatically;
    // it should be clamped to MAX_DT and the smoothing formula remains stable.
    cam.update(10);
    expect(cam.zoom).toBeLessThanOrEqual(DEFAULT_MAX_ZOOM);
    expect(cam.zoom).toBeGreaterThanOrEqual(DEFAULT_MIN_ZOOM);
  });

  it('viewport cannot extend past world edges (clampToWorld)', () => {
    const cam = new Camera({ width: 1000, height: 1000 });
    cam.setViewport(800, 600);
    // The visible half-extents are 400 and 300, so position must stay in
    // [400, 600] for x and [300, 700] for y.
    cam.panTo(100000, 100000);
    // After clamping, target should sit at the max corner.
    expect(cam.targetPosition.x).toBe(600);
    expect(cam.targetPosition.y).toBe(700);
    cam.panTo(-100000, -100000);
    expect(cam.targetPosition.x).toBe(400);
    expect(cam.targetPosition.y).toBe(300);
  });

  it('centres when viewport is larger than world on an axis', () => {
    const cam = new Camera({ width: 100, height: 100 });
    cam.setViewport(200, 50);
    cam.panTo(0, 0);
    // World is 100 wide; viewport 200 wide → camera should be centred at 50.
    expect(cam.targetPosition.x).toBe(50);
    // y still uses normal clamp: minY=25, maxY=75
    expect(cam.targetPosition.y).toBe(25);
  });

  it('visibleRect grows with smaller zoom and shrinks with larger zoom', () => {
    const cam = new Camera({ width: 1000, height: 1000 });
    cam.setViewport(200, 100);
    cam.panTo(500, 500);
    const r1 = cam.visibleRect();
    cam.setZoom(2);
    for (let i = 0; i < 5000; i++) cam.update(0.01);
    const r2 = cam.visibleRect();
    const w1 = r1.maxX - r1.minX;
    const w2 = r2.maxX - r2.minX;
    expect(w2).toBeLessThan(w1);
  });

  it('getState returns a snapshot that is decoupled from the camera', () => {
    const cam = new Camera({ width: 1000, height: 1000 });
    cam.setViewport(800, 600);
    cam.panBy(50, 50);
    const s = cam.getState();
    cam.panBy(50, 50);
    expect(s.targetPosition.x).toBe(50);
  });

  it('setWorldBounds re-clamps current position', () => {
    const cam = new Camera({ width: 1000, height: 1000 });
    cam.setViewport(800, 600);
    cam.panTo(500, 500);
    cam.setWorldBounds({ width: 100, height: 100 });
    // New bounds: viewport 800 > world 100, so x is centred at 50.
    expect(cam.position.x).toBe(50);
    expect(cam.position.y).toBe(50);
  });

  it('exposes default zoom bounds via constants', () => {
    expect(DEFAULT_MIN_ZOOM).toBeGreaterThan(0);
    expect(DEFAULT_MAX_ZOOM).toBeGreaterThan(DEFAULT_MIN_ZOOM);
    expect(DEFAULT_SMOOTHING_RATE).toBeGreaterThan(0);
    expect(MAX_DT).toBeGreaterThan(0);
  });

  it('rejects invalid viewport and zoom bounds', () => {
    expect(() => new Camera({ width: 100, height: 100 }, { minZoom: 0 })).toThrow();
    expect(() => new Camera({ width: 100, height: 100 }, { minZoom: 2, maxZoom: 1 })).toThrow();
    const cam = new Camera({ width: 100, height: 100 });
    expect(() => cam.setViewport(-1, 0)).toThrow();
    expect(() => cam.setWorldBounds({ width: 0, height: 1 })).toThrow();
  });
});
