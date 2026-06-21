import { Renderer } from '@/engine/Renderer';
import { createWorld } from '@/engine/World';
import type { Building, ZoneType } from '@/engine/types';
import { ZONE_BOUNDS } from '@/constants';

type MockFillRect = { x: number; y: number; w: number; h: number; style: string };

function createMockContext(): {
  ctx: CanvasRenderingContext2D;
  records: {
    fillRects: MockFillRect[];
    translate: Array<[number, number]>;
    scale: Array<[number, number]>;
    setTransform: Array<[number, number, number, number, number, number]>;
  };
} {
  const records = {
    fillRects: [] as MockFillRect[],
    translate: [] as Array<[number, number]>,
    scale: [] as Array<[number, number]>,
    setTransform: [] as Array<[number, number, number, number, number, number]>,
  };

  const canvas = {
    width: 800,
    height: 600,
  } as unknown as HTMLCanvasElement;

  const fillStyleHolder = { value: '#000000' };

  const ctx = {
    canvas,
    get fillStyle(): string {
      return fillStyleHolder.value;
    },
    set fillStyle(v: string) {
      fillStyleHolder.value = v;
    },
    translate: (tx: number, ty: number) => records.translate.push([tx, ty]),
    scale: (sx: number, sy: number) => records.scale.push([sx, sy]),
    setTransform: (...args: [number, number, number, number, number, number]) => {
      records.setTransform.push(args);
    },
    clearRect: jest.fn(),
    fillRect: (x: number, y: number, w: number, h: number) => {
      records.fillRects.push({ x, y, w, h, style: fillStyleHolder.value });
    },
  } as unknown as CanvasRenderingContext2D;

  return { ctx, records };
}

describe('Renderer', () => {
  it('drawBuildings sorts buildings by Y ascending (lower Y drawn first)', () => {
    const { ctx, records } = createMockContext();

    const world = createWorld(10, 10, {
      residential: { ...ZONE_BOUNDS.residential, type: 'residential' },
      commercial: { ...ZONE_BOUNDS.commercial, type: 'commercial' },
      industrial: { ...ZONE_BOUNDS.industrial, type: 'industrial' },
      entertainment: { ...ZONE_BOUNDS.entertainment, type: 'entertainment' },
      park: { ...ZONE_BOUNDS.park, type: 'park' },
    } as Record<ZoneType, (typeof ZONE_BOUNDS)[ZoneType] & { type: ZoneType }>);

    const buildings: Building[] = [
      { id: 'b1', zone: 'residential', x: 0, y: 5, width: 1, height: 1 },
      { id: 'b2', zone: 'commercial', x: 0, y: 1, width: 1, height: 1 },
      { id: 'b3', zone: 'industrial', x: 0, y: 3, width: 1, height: 1 },
    ];
    world.buildings = buildings;

    const renderer = new Renderer(ctx, 10);
    renderer.render(world, { x: 0, y: 0, zoom: 1 });

    // First fillRect is ground, then roads (none), then buildings.
    const groundFill = records.fillRects[0];
    expect(groundFill.style).toBe('#e8e0d5');

    const buildingFills = records.fillRects.slice(1); // no roads drawn in this test world
    const stylesInOrder = buildingFills.map((r) => r.style);

    // Expected building draw order by y: b2(y=1), b3(y=3), b1(y=5)
    expect(stylesInOrder).toEqual(['#42a5f5', '#8d6e63', '#7cb342']);
  });

  it('drawGround uses warm beige and applies camera translate/scale', () => {
    const { ctx, records } = createMockContext();
    const world = createWorld(2, 2, {
      residential: { ...ZONE_BOUNDS.residential, type: 'residential' },
      commercial: { ...ZONE_BOUNDS.commercial, type: 'commercial' },
      industrial: { ...ZONE_BOUNDS.industrial, type: 'industrial' },
      entertainment: { ...ZONE_BOUNDS.entertainment, type: 'entertainment' },
      park: { ...ZONE_BOUNDS.park, type: 'park' },
    } as unknown as Record<ZoneType, unknown>);

    const renderer = new Renderer(ctx, 10);
    renderer.render(world, { x: 7, y: 11, zoom: 2 });

    expect(records.setTransform).toEqual([[1, 0, 0, 1, 0, 0]]);
    expect(records.translate).toEqual([[7, 11]]);
    expect(records.scale).toEqual([[2, 2]]);

    const first = records.fillRects[0];
    expect(first.style).toBe('#e8e0d5');
  });
});
