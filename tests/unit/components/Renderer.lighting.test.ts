/**
 * Renderer lighting & culling unit tests.
 *
 * Verifies the lighting alpha curve (0 at noon, 0.55 at midnight,
 * ~0.275 at dawn/dusk) and that drawCitizens/drawVehicles/drawBuildings
 * skip entities outside the visible world rect (via a spy on ctx.arc).
 */
import { JSDOM } from 'jsdom';
import {
  bucketAlpha,
  computeLightingAlpha,
  createRenderer,
  type Camera,
  VIEWPORT_CULL_MARGIN,
} from '@/components/city/Renderer';
import { createCamera, getViewportRect } from '@/components/city/Camera';
import {
  createCitizen,
  type Citizen,
  createVehicle,
} from '@/entities';
import type {
  ActivityId,
  BuildingId,
  CitizenId,
  VehicleId,
} from '@/types/common';

function makeCtxStub(): CanvasRenderingContext2D {
  // jsdom's HTMLCanvasElement.getContext('2d') returns null. Inject a
  // minimal no-op 2D context so the Renderer can run; tests then spy
  // on individual methods (e.g. `arc`) to verify culling behaviour.
  const noop = () => {};
  return {
    canvas: null as unknown as HTMLCanvasElement,
    fillStyle: '#000',
    strokeStyle: '#000',
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillRect: noop,
    clearRect: noop,
    strokeRect: noop,
    fillText: noop,
    strokeText: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    setTransform: noop,
    resetTransform: noop,
    createLinearGradient: () => ({ addColorStop: noop }) as unknown as CanvasGradient,
    createRadialGradient: () => ({ addColorStop: noop }) as unknown as CanvasGradient,
    measureText: () => ({ width: 0 }) as TextMetrics,
    drawImage: noop,
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) as ImageData,
    putImageData: noop,
  } as unknown as CanvasRenderingContext2D;
}

function makeCanvas(): HTMLCanvasElement {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const canvas = dom.window.document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 480;
  // Inject a no-op 2D context — jsdom's HTMLCanvasElement.getContext
  // returns null. Tests spy on `arc` to assert off-screen skipping.
  (canvas as unknown as { getContext: (id: string) => unknown }).getContext = () => makeCtxStub();
  return canvas;
}

function makeCitizen(id: string, x: number, y: number, activity: ActivityId = 'sleep'): Citizen {
  return createCitizen({
    id: id as CitizenId,
    position: { x, y },
    name: id,
    homeId: 'bldg-home-0' as BuildingId,
    workplaceId: null,
    schedule: Array.from({ length: 24 }, () => activity),
    currentActivity: activity,
  });
}

describe('Renderer lighting', () => {
  describe('computeLightingAlpha', () => {
    it('returns 0 at noon (hour 12)', () => {
      expect(computeLightingAlpha(12)).toBe(0);
    });
    it('returns 0.55 at midnight (hour 0)', () => {
      expect(computeLightingAlpha(0)).toBeCloseTo(0.55, 5);
    });
    it('returns ~0.275 at dawn (hour 6)', () => {
      expect(computeLightingAlpha(6)).toBeCloseTo(0.275, 5);
    });
    it('returns ~0.275 at dusk (hour 18)', () => {
      expect(computeLightingAlpha(18)).toBeCloseTo(0.275, 5);
    });
    it('interpolates between noon and midnight', () => {
      // Hour 3 is halfway between midnight and dawn -> 0.4125
      const alpha = computeLightingAlpha(3);
      expect(alpha).toBeGreaterThan(0.275);
      expect(alpha).toBeLessThan(0.55);
    });
    it('handles wrap-around hours (>= 24)', () => {
      expect(computeLightingAlpha(24)).toBeCloseTo(computeLightingAlpha(0), 5);
      expect(computeLightingAlpha(36)).toBeCloseTo(computeLightingAlpha(12), 5);
    });
    it('returns 0 for non-finite hours', () => {
      expect(computeLightingAlpha(Number.NaN)).toBe(0);
      expect(computeLightingAlpha(Number.POSITIVE_INFINITY)).toBe(0);
    });
  });

  describe('bucketAlpha', () => {
    it('returns 0 for alpha 0', () => {
      expect(bucketAlpha(0)).toBe(0);
    });
    it('clamps to [0, 1]', () => {
      expect(bucketAlpha(-1)).toBe(0);
      expect(bucketAlpha(2)).toBeLessThanOrEqual(1);
    });
    it('returns 0 for NaN', () => {
      expect(bucketAlpha(Number.NaN)).toBe(0);
    });
    it('produces discrete buckets', () => {
      // With 16 buckets, values within the same bucket should collide.
      const a = bucketAlpha(0.10);
      const b = bucketAlpha(0.12);
      // Both round to 1/16 = 0.0625 (bucket 1)
      expect(a).toBe(b);
    });
  });

  describe('drawLightingOverlay', () => {
    it('does not call fillRect when alpha is 0', () => {
      const canvas = makeCanvas();
      const renderer = createRenderer(canvas, { width: 800, height: 480, pixelRatio: 1 });
      const fillRectSpy = jest.spyOn(canvas.getContext('2d') as CanvasRenderingContext2D, 'fillRect');
      renderer.drawLightingOverlay(12, createCamera());
      // Noon => no fill
      expect(fillRectSpy).not.toHaveBeenCalled();
      renderer.dispose();
    });

    it('calls fillRect with the cached gradient when alpha > 0', () => {
      const canvas = makeCanvas();
      const renderer = createRenderer(canvas, { width: 800, height: 480, pixelRatio: 1 });
      const fillRectSpy = jest.spyOn(canvas.getContext('2d') as CanvasRenderingContext2D, 'fillRect');
      renderer.drawLightingOverlay(0, createCamera()); // midnight => 0.55
      expect(fillRectSpy).toHaveBeenCalled();
      renderer.dispose();
    });

    it('reuses the gradient across multiple frames at the same hour', () => {
      const canvas = makeCanvas();
      const renderer = createRenderer(canvas, { width: 800, height: 480, pixelRatio: 1 });
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      const gradientSpy = jest.spyOn(ctx, 'createRadialGradient');
      renderer.drawLightingOverlay(0, createCamera());
      renderer.drawLightingOverlay(0, createCamera());
      renderer.drawLightingOverlay(0, createCamera());
      // Three frames at the same hour should create the gradient once
      // and cache the result.
      expect(gradientSpy).toHaveBeenCalledTimes(1);
      renderer.dispose();
    });
  });
});

describe('Renderer culling', () => {
  it('skips citizens that are outside the visible world rect', () => {
    const canvas = makeCanvas();
    const camera: Camera = createCamera({ origin: { x: 0, y: 0 }, scale: 1 });
    const renderer = createRenderer(canvas, { width: 800, height: 480, pixelRatio: 1 });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const arcSpy = jest.spyOn(ctx, 'arc');

    const inView = makeCitizen('in', 400, 240);
    const outOfView = makeCitizen('out', 5000, 5000);
    renderer.drawCitizens([inView, outOfView], camera);

    // Citizen "in" produces 2 arc calls (halo + dot). "out" produces 0.
    // We assert the spy was called at least once (proves the in-view
    // citizen rendered) but exactly 2 times (proves the out-of-view
    // one was culled).
    expect(arcSpy.mock.calls.length).toBe(2);
    renderer.dispose();
  });

  it('skips vehicles that are outside the visible world rect', () => {
    const canvas = makeCanvas();
    const camera: Camera = createCamera({ origin: { x: 0, y: 0 }, scale: 1 });
    const renderer = createRenderer(canvas, { width: 800, height: 480, pixelRatio: 1 });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const fillSpy = jest.spyOn(ctx, 'fill');

    const inView = createVehicle({
      id: 'v-in' as VehicleId,
      position: { x: 400, y: 240 },
    });
    const outOfView = createVehicle({
      id: 'v-out' as VehicleId,
      position: { x: 5000, y: 5000 },
    });
    renderer.drawVehicles([inView, outOfView], camera);

    // Vehicle "in" should have been drawn (body fill + arrow head fill = 2).
    expect(fillSpy.mock.calls.length).toBe(2);
    renderer.dispose();
  });

  it('skips buildings that are outside the visible world rect', () => {
    const canvas = makeCanvas();
    const camera: Camera = createCamera({ origin: { x: 0, y: 0 }, scale: 1 });
    const renderer = createRenderer(canvas, { width: 800, height: 480, pixelRatio: 1 });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const fillSpy = jest.spyOn(ctx, 'fill');

    const inView = { id: 'b-in', position: { x: 100, y: 100 } };
    const outOfView = { id: 'b-out', position: { x: 5000, y: 5000 } };
    renderer.drawBuildings([inView, outOfView], camera);

    // In-view building fills (1) + the in-view vehicle we drew earlier
    // did not run in this test. Just the one fill call.
    expect(fillSpy.mock.calls.length).toBe(1);
    renderer.dispose();
  });

  it('uses a 10% margin so entities just outside the viewport are still drawn', () => {
    // Verify the rect math, since the renderer's cull decision is
    // based on the margin rect.
    const camera = createCamera({ origin: { x: 0, y: 0 }, scale: 1 });
    const rect = getViewportRect(camera, 800, 480, VIEWPORT_CULL_MARGIN);
    // A citizen at x=820 is OUTSIDE the raw 800px viewport but INSIDE
    // the 880px rect (10% margin on each side).
    expect(rect.x).toBeLessThan(0);
    expect(rect.x + rect.width).toBeGreaterThan(820);
  });
});
