import { GameEngine } from '@/engine/GameEngine';
import { TileType } from '@/engine/types';

type MockFillRect = { x: number; y: number; w: number; h: number; style: string };

function createMockCanvas(): {
  canvas: HTMLCanvasElement;
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

  const fillStyleHolder = { value: '#000000' };

  const ctx = {
    canvas: { width: 800, height: 600 } as unknown as HTMLCanvasElement,
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

  const canvas = {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    getContext: jest.fn().mockReturnValue(ctx),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    getBoundingClientRect: jest.fn().mockReturnValue({ left: 0, top: 0, width: 800, height: 600 }),
  } as unknown as HTMLCanvasElement;

  return { canvas, records };
}

describe('GameEngine', () => {
  it('constructs and exposes world, camera, renderer, and loop', () => {
    const { canvas } = createMockCanvas();
    const engine = new GameEngine(canvas);

    try {
      expect(engine.world).toBeDefined();
      expect(engine.world.grid.width).toBe(80);
      expect(engine.world.grid.height).toBe(80);
      expect(engine.camera).toBeDefined();
      expect(engine.renderer).toBeDefined();
      expect(engine.loop).toBeDefined();
    } finally {
      engine.dispose();
    }
  });

  it('generates a city with roads and buildings on construction', () => {
    const { canvas } = createMockCanvas();
    const engine = new GameEngine(canvas);

    try {
      const { grid } = engine.world;

      let roadCount = 0;
      let buildingCount = 0;
      for (let y = 0; y < grid.height; y += 1) {
        for (let x = 0; x < grid.width; x += 1) {
          const v = grid.getTile(x, y);
          if (v === TileType.Road || v === (TileType.Road | TileType.StreetLight)) roadCount += 1;
          if (v === TileType.Building) buildingCount += 1;
        }
      }

      expect(roadCount).toBeGreaterThan(0);
      expect(buildingCount).toBeGreaterThan(0);
      expect(engine.world.buildings.length).toBeGreaterThan(0);
    } finally {
      engine.dispose();
    }
  });

  it('start/stop/dispose lifecycle works without throwing', () => {
    const { canvas } = createMockCanvas();
    const engine = new GameEngine(canvas);

    expect(() => engine.start()).not.toThrow();
    expect(() => engine.stop()).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
  });

  it('render callback is invoked on start (initial render)', () => {
    const { canvas, records } = createMockCanvas();
    const engine = new GameEngine(canvas);

    try {
      engine.start();

      // GameLoop.start() performs an immediate initial render, so at least
      // one fillRect (ground) should have been drawn.
      expect(records.fillRects.length).toBeGreaterThan(0);
      expect(records.setTransform.length).toBeGreaterThan(0);
    } finally {
      engine.dispose();
    }
  });
});
