import {
  drawMinimap,
  computeMinimapBox,
  MINIMAP_MAX_SIZE,
  MINIMAP_MARGIN,
  VIEWPORT_FILL,
  VIEWPORT_STROKE,
  BUILDING_COLORS,
} from './minimap';
import { Camera } from './camera';
import type { World, Tile, Building, Citizen, Vehicle, BuildingKind } from '../sim/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Build a minimal valid {@link World} with optional entities. */
function makeWorld(opts: {
  width?: number;
  height?: number;
  tiles?: Tile[];
  buildings?: Building[];
  citizens?: Citizen[];
  vehicles?: Vehicle[];
}): World {
  const width = opts.width ?? 1;
  const height = opts.height ?? 1;
  return {
    width,
    height,
    tiles: opts.tiles ?? [],
    buildings: new Map((opts.buildings ?? []).map((b) => [b.id, b])),
    citizens: new Map((opts.citizens ?? []).map((c) => [c.id, c])),
    vehicles: new Map((opts.vehicles ?? []).map((v) => [v.id, v])),
    companies: new Map(),
    simTime: { elapsedHours: 0 },
    budget: 0,
    derivedStats: {
      population: 0,
      employmentRate: 0,
      lastHourTaxIncome: 0,
      lastHourExpenses: 0,
    },
    lastEconomyHour: -1,
    lastRevenueBaseline: 0,
  };
}

type MockFn = jest.Mock;

interface MockCtx {
  ctx: CanvasRenderingContext2D;
  fillStyles: string[];
  strokeStyles: string[];
  lineWidths: number[];
  fns: {
    save: MockFn;
    restore: MockFn;
    setTransform: MockFn;
    fillRect: MockFn;
    strokeRect: MockFn;
    beginPath: MockFn;
    rect: MockFn;
    arc: MockFn;
    fill: MockFn;
  };
}

/** Recording mock for `CanvasRenderingContext2D`. */
function createMockCtx(): MockCtx {
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  const lineWidths: number[] = [];
  let currentFillStyle = '';
  let currentStrokeStyle = '';
  let currentLineWidth = 1;

  const save = jest.fn();
  const restore = jest.fn();
  const setTransform = jest.fn();
  const fillRect = jest.fn();
  const strokeRect = jest.fn();
  const beginPath = jest.fn();
  const rect = jest.fn();
  const arc = jest.fn();
  const fill = jest.fn();

  const ctx = {
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(value: string) {
      currentFillStyle = value;
      fillStyles.push(value);
    },
    get strokeStyle() {
      return currentStrokeStyle;
    },
    set strokeStyle(value: string) {
      currentStrokeStyle = value;
      strokeStyles.push(value);
    },
    get lineWidth() {
      return currentLineWidth;
    },
    set lineWidth(value: number) {
      currentLineWidth = value;
      lineWidths.push(value);
    },
    save,
    restore,
    setTransform,
    fillRect,
    strokeRect,
    beginPath,
    rect,
    arc,
    fill,
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    fillStyles,
    strokeStyles,
    lineWidths,
    fns: { save, restore, setTransform, fillRect, strokeRect, beginPath, rect, arc, fill },
  };
}

const VIEW_W = 1280;
const VIEW_H = 800;

// ─── Exports ─────────────────────────────────────────────────────────────────

describe('minimap exports', () => {
  it('exports drawMinimap as a function', () => {
    expect(typeof drawMinimap).toBe('function');
  });
});

// ─── computeMinimapBox ───────────────────────────────────────────────────────

describe('computeMinimapBox', () => {
  it('preserves aspect ratio for a square world', () => {
    const world = makeWorld({ width: 100, height: 100 });
    const box = computeMinimapBox(world, VIEW_W, VIEW_H);
    expect(box.width).toBeCloseTo(MINIMAP_MAX_SIZE, 5);
    expect(box.height).toBeCloseTo(MINIMAP_MAX_SIZE, 5);
  });

  it('anchors the box to the bottom-right corner with a margin', () => {
    const world = makeWorld({ width: 100, height: 100 });
    const box = computeMinimapBox(world, VIEW_W, VIEW_H);
    expect(box.originX).toBeCloseTo(VIEW_W - box.width - MINIMAP_MARGIN, 5);
    expect(box.originY).toBeCloseTo(VIEW_H - box.height - MINIMAP_MARGIN, 5);
  });

  it('scales world coordinates into the box', () => {
    const world = makeWorld({ width: 100, height: 50 });
    const box = computeMinimapBox(world, VIEW_W, VIEW_H);
    // A full world width maps to the panel width.
    expect(100 * box.scaleX).toBeCloseTo(box.width, 5);
    expect(50 * box.scaleY).toBeCloseTo(box.height, 5);
  });

  it('preserves aspect ratio for a wide world', () => {
    const world = makeWorld({ width: 200, height: 100 });
    const box = computeMinimapBox(world, VIEW_W, VIEW_H);
    expect(box.width).toBeCloseTo(MINIMAP_MAX_SIZE, 5);
    // height is half of width for a 2:1 world
    expect(box.height).toBeCloseTo(MINIMAP_MAX_SIZE / 2, 5);
  });
});

// ─── drawMinimap layers ──────────────────────────────────────────────────────

describe('drawMinimap', () => {
  it('calls save/restore and resets to identity transform', () => {
    const { ctx, fns } = createMockCtx();
    const world = makeWorld({ width: 100, height: 100 });
    const camera = new Camera({
      worldWidth: 100,
      worldHeight: 100,
      viewportWidth: VIEW_W,
      viewportHeight: VIEW_H,
      zoom: 16,
    });
    drawMinimap(ctx, world, camera, VIEW_W, VIEW_H);
    expect(fns.save).toHaveBeenCalledTimes(1);
    expect(fns.restore).toHaveBeenCalledTimes(1);
    // setTransform called once with the identity matrix.
    expect(fns.setTransform).toHaveBeenCalledTimes(1);
    expect(fns.setTransform.mock.calls[0]).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('draws a panel background fill and outline', () => {
    const { ctx, fillStyles } = createMockCtx();
    const world = makeWorld({ width: 100, height: 100 });
    const camera = new Camera({
      worldWidth: 100,
      worldHeight: 100,
      viewportWidth: VIEW_W,
      viewportHeight: VIEW_H,
      zoom: 16,
    });
    drawMinimap(ctx, world, camera, VIEW_W, VIEW_H);
    // The first fillStyle is the panel background.
    expect(fillStyles[0]).toBe('rgba(0, 0, 0, 0.55)');
  });
});

// ─── Roads ───────────────────────────────────────────────────────────────────

describe('drawMinimap roads', () => {
  it('draws a rect for each road tile', () => {
    const { ctx, fns } = createMockCtx();
    const tiles: Tile[] = [
      { x: 0, y: 0, zone: 'COMMERCIAL', terrain: 'ROAD', buildingId: null },
      { x: 1, y: 0, zone: 'COMMERCIAL', terrain: 'GRASS', buildingId: null },
      { x: 0, y: 1, zone: 'COMMERCIAL', terrain: 'ROAD', buildingId: null },
    ];
    const world = makeWorld({ width: 10, height: 10, tiles });
    const camera = new Camera({
      worldWidth: 10,
      worldHeight: 10,
      viewportWidth: VIEW_W,
      viewportHeight: VIEW_H,
      zoom: 16,
    });
    drawMinimap(ctx, world, camera, VIEW_W, VIEW_H);

    // `rect` is called for each road tile (2 roads here).
    const roadRectCount = fns.rect.mock.calls.length;
    expect(roadRectCount).toBe(2);
  });
});

// ─── Buildings ───────────────────────────────────────────────────────────────

describe('drawMinimap buildings', () => {
  it('draws each building using the colour for its kind', () => {
    const { ctx, fns, fillStyles } = createMockCtx();
    const buildings: Building[] = [
      {
        id: 'b0',
        kind: 'HOME',
        position: { x: 1, y: 1 },
        size: { width: 3, height: 3 },
        capacity: 4,
        name: 'A',
        owner: null,
      },
      {
        id: 'b1',
        kind: 'WORK',
        position: { x: 5, y: 5 },
        size: { width: 3, height: 3 },
        capacity: 4,
        name: 'B',
        owner: null,
      },
    ];
    const world = makeWorld({ width: 20, height: 20, buildings });
    const camera = new Camera({
      worldWidth: 20,
      worldHeight: 20,
      viewportWidth: VIEW_W,
      viewportHeight: VIEW_H,
      zoom: 16,
    });
    drawMinimap(ctx, world, camera, VIEW_W, VIEW_H);

    // Each building should produce a rect call.
    expect(fns.rect.mock.calls.length).toBe(2);
    // The building colours appear in the fillStyle history.
    expect(fillStyles).toContain(BUILDING_COLORS.HOME);
    expect(fillStyles).toContain(BUILDING_COLORS.WORK);
  });

  it('defines a distinct colour for every building kind', () => {
    const kinds: BuildingKind[] = ['HOME', 'WORK', 'ENTERTAINMENT', 'CIVIC'];
    const colours = kinds.map((k) => BUILDING_COLORS[k]);
    // All colours are unique.
    expect(new Set(colours).size).toBe(kinds.length);
  });
});

// ─── Citizens & vehicles ─────────────────────────────────────────────────────

describe('drawMinimap agents', () => {
  it('draws an arc dot for each citizen and vehicle', () => {
    const { ctx, fns } = createMockCtx();
    const citizens: Citizen[] = [
      {
        id: 'c0',
        home: 'b0',
        work: null,
        entertainment: null,
        state: { kind: 'HOME', buildingId: 'b0' },
        position: { x: 2, y: 2 },
        money: 0,
        path: [],
        pathIndex: 0,
      },
      {
        id: 'c1',
        home: 'b0',
        work: null,
        entertainment: null,
        state: { kind: 'HOME', buildingId: 'b0' },
        position: { x: 4, y: 4 },
        money: 0,
        path: [],
        pathIndex: 0,
      },
    ];
    const vehicles: Vehicle[] = [
      {
        id: 'v0',
        kind: 'CAR',
        position: { x: 6, y: 6 },
        velocity: { x: 0, y: 0 },
        driver: null,
        target: null,
        currentRoadPath: [],
        pathIndex: 0,
        pathProgress: 0,
        passengers: [],
        speed: 0,
        fuel: 100,
      },
    ];
    const world = makeWorld({ width: 20, height: 20, citizens, vehicles });
    const camera = new Camera({
      worldWidth: 20,
      worldHeight: 20,
      viewportWidth: VIEW_W,
      viewportHeight: VIEW_H,
      zoom: 16,
    });
    drawMinimap(ctx, world, camera, VIEW_W, VIEW_H);

    // 2 citizens + 1 vehicle = 3 arc calls.
    expect(fns.arc.mock.calls.length).toBe(3);
  });
});

// ─── Viewport rectangle ──────────────────────────────────────────────────────

describe('drawMinimap viewport rectangle', () => {
  it('draws a fill and a stroke for the camera viewport', () => {
    const { ctx, fns, fillStyles, strokeStyles } = createMockCtx();
    const world = makeWorld({ width: 100, height: 100 });
    const camera = new Camera({
      worldWidth: 100,
      worldHeight: 100,
      viewportWidth: VIEW_W,
      viewportHeight: VIEW_H,
      zoom: 16,
    });
    drawMinimap(ctx, world, camera, VIEW_W, VIEW_H);

    // One fillRect + one strokeRect for the viewport rect (plus the panel).
    expect(fns.fillRect).toHaveBeenCalled();
    expect(fns.strokeRect).toHaveBeenCalled();
    expect(fillStyles).toContain(VIEWPORT_FILL);
    expect(strokeStyles).toContain(VIEWPORT_STROKE);
  });

  it('the viewport rectangle moves when the camera pans', () => {
    const world = makeWorld({ width: 100, height: 100 });
    // zoom 16 → visibleWidth = 1280/16 = 80 (half 40), valid X ∈ [40, 60]
    const cameraA = new Camera({
      worldWidth: 100,
      worldHeight: 100,
      viewportWidth: VIEW_W,
      viewportHeight: VIEW_H,
      zoom: 16,
      centerX: 40,
      centerY: 50,
    });
    const cameraB = new Camera({
      worldWidth: 100,
      worldHeight: 100,
      viewportWidth: VIEW_W,
      viewportHeight: VIEW_H,
      zoom: 16,
      centerX: 60,
      centerY: 50,
    });

    const rectA = findViewportRect(createMockCtx(), world, cameraA, VIEW_W, VIEW_H);
    const rectB = findViewportRect(createMockCtx(), world, cameraB, VIEW_W, VIEW_H);

    expect(rectB.x).toBeGreaterThan(rectA.x);
  });

  it('the viewport rectangle matches the camera visible extents', () => {
    const world = makeWorld({ width: 100, height: 100 });
    const camera = new Camera({
      worldWidth: 100,
      worldHeight: 100,
      viewportWidth: VIEW_W,
      viewportHeight: VIEW_H,
      zoom: 16,
      centerX: 50,
      centerY: 50,
    });
    const { fns } = createMockCtx();
    drawMinimap(fns as unknown as CanvasRenderingContext2D, world, camera, VIEW_W, VIEW_H);

    const box = computeMinimapBox(world, VIEW_W, VIEW_H);
    // Expected viewport rect: left = originX + (50 - 40) * scaleX, width = 80*scaleX
    const expectedX = box.originX + (camera.centerX - camera.visibleWidth / 2) * box.scaleX;
    const expectedY = box.originY + (camera.centerY - camera.visibleHeight / 2) * box.scaleY;
    const expectedW = camera.visibleWidth * box.scaleX;
    const expectedH = camera.visibleHeight * box.scaleY;

    // The matching fillRect is the one with VIEWPORT_FILL as the active style.
    // Inspect fillRect calls and compare the viewport-sized one.
    const fillRectCalls = (fns.fillRect as MockFn).mock.calls as Array<
      [number, number, number, number]
    >;
    const matched = fillRectCalls.find(
      ([x, y, w, h]) =>
        Math.abs(x - expectedX) < 0.001 &&
        Math.abs(y - expectedY) < 0.001 &&
        Math.abs(w - expectedW) < 0.001 &&
        Math.abs(h - expectedH) < 0.001,
    );
    expect(matched).toBeDefined();
  });
});

// ─── Helper: extract the viewport rectangle from a draw ─────────────────────

/**
 * Draw the minimap and return the `{x, y}` of the viewport rectangle
 * (the strokeRect whose style is VIEWPORT_STROKE).
 */
function findViewportRect(
  mock: MockCtx,
  world: World,
  camera: Camera,
  vw: number,
  vh: number,
): { x: number; y: number; w: number; h: number } {
  drawMinimap(mock.ctx, world, camera, vw, vh);
  // strokeRect calls happen in order of strokeStyle assignment.
  const strokeCalls = (mock.fns.strokeRect as MockFn).mock.calls as Array<
    [number, number, number, number]
  >;
  expect(strokeCalls.length).toBeGreaterThan(0);
  // The viewport rect is the first strokeRect; use the first call.
  const first = strokeCalls[0];
  if (!first) throw new Error('expected at least one strokeRect call');
  const [x, y, w, h] = first;
  return { x, y, w, h };
}
