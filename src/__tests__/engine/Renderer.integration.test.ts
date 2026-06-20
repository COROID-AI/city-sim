// Integration test: Renderer works with a real Grid produced by
// CityGenerator (80x80 grid with a road network). Verifies the renderer does
// not throw and exercises both horizontal and vertical road rendering paths
// against a realistic city layout.

import { Renderer, PALETTE } from '../../engine/Renderer';
import { Grid } from '../../engine/Grid';
import { generateCity } from '../../generation/CityGenerator';
import { GRID_SIZE } from '@/lib/constants';

/**
 * Build a mock CanvasRenderingContext2D whose methods are jest.fn spies.
 * `calls` is a convenience log of `[method, args]` entries in invocation order.
 */
function createMockCtx() {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const track = (method: string) =>
    jest.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return undefined;
    });

  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    fillRect: track('fillRect'),
    strokeRect: track('strokeRect'),
    clearRect: track('clearRect'),
    beginPath: track('beginPath'),
    moveTo: track('moveTo'),
    lineTo: track('lineTo'),
    stroke: track('stroke'),
    fill: track('fill'),
    save: track('save'),
    restore: track('restore'),
    translate: track('translate'),
    scale: track('scale'),
    rotate: track('rotate'),
  } as unknown as CanvasRenderingContext2D & {
    calls: typeof calls;
  };

  Object.defineProperty(ctx, 'calls', { value: calls, writable: false });
  return ctx;
}

/** Generate an 80x80 city grid (mutated in place by generateCity). */
function makeCityGrid(): Grid {
  const grid = new Grid(GRID_SIZE, GRID_SIZE);
  generateCity(grid, { seed: 42 });
  return grid;
}

describe('Renderer + CityGenerator integration', () => {
  it('renders an 80x80 generated city without throwing', () => {
    const grid = makeCityGrid();
    const ctx = createMockCtx();
    const renderer = new Renderer();

    expect(() =>
      renderer.render(ctx, grid, { x: 0, y: 0, zoom: 1 }),
    ).not.toThrow();
  });

  it('draws ground and road tiles for the generated city', () => {
    const grid = makeCityGrid();
    const ctx = createMockCtx();
    const renderer = new Renderer();

    renderer.render(ctx, grid, { x: 0, y: 0, zoom: 1 });

    const fillRects = ctx.calls.filter((c) => c.method === 'fillRect');
    // A full 80x80 city should produce many fillRect calls (ground + roads).
    expect(fillRects.length).toBeGreaterThan(0);

    // The generated city must contain road tiles (strokes for center lines).
    const strokes = ctx.calls.filter((c) => c.method === 'stroke');
    expect(strokes.length).toBeGreaterThan(0);
  });

  it('uses the spec palette colors when rendering the generated city', () => {
    const grid = makeCityGrid();
    const ctx = createMockCtx();
    const renderer = new Renderer();

    renderer.render(ctx, grid, { x: 0, y: 0, zoom: 1 });

    // fillStyle is set last to ROAD_FILL (roads drawn after ground). Verify it
    // is one of the palette colors by checking the final value is ROAD_FILL
    // (the last fillStyle assignment in drawRoads).
    expect(ctx.fillStyle).toBe(PALETTE.ROAD_FILL);
    expect(ctx.strokeStyle).toBe(PALETTE.ROAD_CENTER);
  });
});
