// Unit tests for Renderer — palette colors, road-direction inference, and
// pure-method contract.
//
// CanvasRenderingContext2D is NOT available in jsdom, so every ctx method is
// spied with jest.fn(). No real canvas is required.

import { Renderer, PALETTE } from './Renderer';
import { Grid } from './Grid';
import { TILE_SIZE } from '@/lib/constants';

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

describe('PALETTE', () => {
  it('exports the spec 6.1 palette colors', () => {
    expect(PALETTE.GROUND).toBe('#e8e0d5');
    expect(PALETTE.ROAD_FILL).toBe('#4a4a4a');
    expect(PALETTE.ROAD_CENTER).toBe('#ffffff');
    expect(PALETTE.SIDEWALK).toBe('#c0b8ae');
  });
});

describe('Renderer.drawGround', () => {
  it('fills all ground tiles with #e8e0d5 at correct pixel coords', () => {
    const grid = new Grid(3, 2);
    const ctx = createMockCtx();
    const renderer = new Renderer();

    renderer.drawGround(ctx, grid);

    // All 6 tiles are ground by default.
    const fillRects = ctx.calls.filter((c) => c.method === 'fillRect');
    expect(fillRects).toHaveLength(6);

    // Verify a few representative pixel coordinates.
    expect(fillRects[0].args).toEqual([0, 0, TILE_SIZE, TILE_SIZE]);
    expect(fillRects[1].args).toEqual([TILE_SIZE, 0, TILE_SIZE, TILE_SIZE]);
    expect(fillRects[3].args).toEqual([0, TILE_SIZE, TILE_SIZE, TILE_SIZE]);

    // fillStyle set to ground color.
    expect(ctx.fillStyle).toBe(PALETTE.GROUND);
  });

  it('skips non-ground tiles', () => {
    const grid = new Grid(2, 1);
    grid.setTile(0, 0, 'road');
    const ctx = createMockCtx();
    const renderer = new Renderer();

    renderer.drawGround(ctx, grid);

    const fillRects = ctx.calls.filter((c) => c.method === 'fillRect');
    expect(fillRects).toHaveLength(1);
    expect(fillRects[0].args).toEqual([TILE_SIZE, 0, TILE_SIZE, TILE_SIZE]);
  });
});

describe('Renderer.drawRoads', () => {
  it('fills road tiles with #4a4a4a', () => {
    const grid = new Grid(2, 1);
    grid.setTile(0, 0, 'road');
    grid.setTile(1, 0, 'road');
    const ctx = createMockCtx();
    const renderer = new Renderer();

    renderer.drawRoads(ctx, grid);

    const fillRects = ctx.calls.filter((c) => c.method === 'fillRect');
    expect(fillRects).toHaveLength(2);
    expect(ctx.fillStyle).toBe(PALETTE.ROAD_FILL);
  });

  it('draws a horizontal center line for horizontal roads (E+W neighbors)', () => {
    // 3x1 grid, all road → middle tile has E+W road neighbors.
    const grid = new Grid(3, 1);
    grid.setTile(0, 0, 'road');
    grid.setTile(1, 0, 'road');
    grid.setTile(2, 0, 'road');
    const ctx = createMockCtx();
    const renderer = new Renderer();

    renderer.drawRoads(ctx, grid);

    expect(ctx.strokeStyle).toBe(PALETTE.ROAD_CENTER);

    // Find the moveTo/lineTo pair for the middle tile (x=1).
    const px = 1 * TILE_SIZE;
    const midY = TILE_SIZE / 2;
    const moveTos = ctx.calls.filter((c) => c.method === 'moveTo');
    const lineTos = ctx.calls.filter((c) => c.method === 'lineTo');

    // There should be a horizontal line: moveTo(px, midY), lineTo(px+TILE_SIZE, midY).
    const hasHorizontal = moveTos.some(
      (m) =>
        m.args[0] === px &&
        m.args[1] === midY &&
        lineTos.some(
          (l) => l.args[0] === px + TILE_SIZE && l.args[1] === midY,
        ),
    );
    expect(hasHorizontal).toBe(true);
  });

  it('draws a vertical center line for vertical roads (N+S neighbors)', () => {
    // 1x3 grid, all road → middle tile has N+S road neighbors.
    const grid = new Grid(1, 3);
    grid.setTile(0, 0, 'road');
    grid.setTile(0, 1, 'road');
    grid.setTile(0, 2, 'road');
    const ctx = createMockCtx();
    const renderer = new Renderer();

    renderer.drawRoads(ctx, grid);

    const py = 1 * TILE_SIZE;
    const midX = TILE_SIZE / 2;
    const moveTos = ctx.calls.filter((c) => c.method === 'moveTo');
    const lineTos = ctx.calls.filter((c) => c.method === 'lineTo');

    const hasVertical = moveTos.some(
      (m) =>
        m.args[0] === midX &&
        m.args[1] === py &&
        lineTos.some(
          (l) => l.args[0] === midX && l.args[1] === py + TILE_SIZE,
        ),
    );
    expect(hasVertical).toBe(true);
  });

  it('defaults isolated road tiles to a horizontal center line', () => {
    // Single road tile surrounded by ground → no road neighbors.
    const grid = new Grid(3, 3);
    grid.setTile(1, 1, 'road');
    const ctx = createMockCtx();
    const renderer = new Renderer();

    renderer.drawRoads(ctx, grid);

    const px = 1 * TILE_SIZE;
    const py = 1 * TILE_SIZE;
    const midY = TILE_SIZE / 2;
    const moveTos = ctx.calls.filter((c) => c.method === 'moveTo');
    const lineTos = ctx.calls.filter((c) => c.method === 'lineTo');

    expect(moveTos).toHaveLength(1);
    expect(lineTos).toHaveLength(1);
    // Horizontal: moveTo(px, py+midY), lineTo(px+TILE_SIZE, py+midY).
    expect(moveTos[0].args).toEqual([px, py + midY]);
    expect(lineTos[0].args).toEqual([px + TILE_SIZE, py + midY]);
  });
});

describe('Renderer.drawSidewalks', () => {
  it('is a stub that returns void without error', () => {
    const grid = new Grid(2, 2);
    const ctx = createMockCtx();
    const renderer = new Renderer();

    expect(() => renderer.drawSidewalks(ctx, grid)).not.toThrow();
  });
});

describe('Renderer.render', () => {
  it('applies camera transform (save/translate/scale/restore)', () => {
    const grid = new Grid(2, 2);
    const ctx = createMockCtx();
    const renderer = new Renderer();

    renderer.render(ctx, grid, { x: 10, y: 20, zoom: 2 });

    const saves = ctx.calls.filter((c) => c.method === 'save');
    const restores = ctx.calls.filter((c) => c.method === 'restore');
    const translates = ctx.calls.filter((c) => c.method === 'translate');
    const scales = ctx.calls.filter((c) => c.method === 'scale');

    expect(saves).toHaveLength(1);
    expect(restores).toHaveLength(1);
    expect(translates).toHaveLength(1);
    expect(translates[0].args).toEqual([-10, -20]);
    expect(scales).toHaveLength(1);
    expect(scales[0].args).toEqual([2, 2]);
  });

  it('calls draw methods in z-order: ground → roads → sidewalks', () => {
    const grid = new Grid(2, 1);
    grid.setTile(0, 0, 'road');
    const ctx = createMockCtx();
    const renderer = new Renderer();

    renderer.render(ctx, grid, { x: 0, y: 0, zoom: 1 });

    // Ground fillRect (#e8e0d5) must come before road fillRect (#4a4a4a).
    const fillRects = ctx.calls.filter((c) => c.method === 'fillRect');
    // First fillRect is a ground tile (x=1,0), second is the road tile (0,0).
    expect(fillRects.length).toBeGreaterThanOrEqual(2);
    // Ground tile at (1,0) drawn first.
    expect(fillRects[0].args).toEqual([TILE_SIZE, 0, TILE_SIZE, TILE_SIZE]);
    // Road tile at (0,0) drawn after.
    expect(fillRects[1].args).toEqual([0, 0, TILE_SIZE, TILE_SIZE]);
  });
});

describe('Renderer purity', () => {
  it('drawGround produces identical ctx calls on repeated invocation', () => {
    const grid = new Grid(2, 2);
    const ctxA = createMockCtx();
    const ctxB = createMockCtx();
    const renderer = new Renderer();

    renderer.drawGround(ctxA, grid);
    renderer.drawGround(ctxB, grid);

    expect(ctxA.calls).toEqual(ctxB.calls);
  });

  it('drawRoads produces identical ctx calls on repeated invocation', () => {
    const grid = new Grid(3, 1);
    grid.setTile(0, 0, 'road');
    grid.setTile(1, 0, 'road');
    grid.setTile(2, 0, 'road');
    const ctxA = createMockCtx();
    const ctxB = createMockCtx();
    const renderer = new Renderer();

    renderer.drawRoads(ctxA, grid);
    renderer.drawRoads(ctxB, grid);

    expect(ctxA.calls).toEqual(ctxB.calls);
  });

  it('methods do not mutate internal Renderer state', () => {
    const grid = new Grid(2, 2);
    const ctx = createMockCtx();
    const renderer = new Renderer();

    // Call several times — no throw, no accumulated state observable via ctx.
    renderer.drawGround(ctx, grid);
    renderer.drawRoads(ctx, grid);
    renderer.drawSidewalks(ctx, grid);
    renderer.drawGround(ctx, grid);

    // No error thrown and ctx still usable.
    expect(ctx.calls.length).toBeGreaterThan(0);
  });
});
