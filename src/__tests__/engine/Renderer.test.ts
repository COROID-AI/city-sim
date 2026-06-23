/**
 * Renderer unit tests.
 *
 * jsdom does not provide a real CanvasRenderingContext2D, so we build a
 * jest.fn-backed mock that records fillStyle assignments and fillRect calls.
 * The mock is cast to CanvasRenderingContext2D for type compatibility.
 */
import { Renderer, ZONE_COLORS } from '@/engine/Renderer';
import { TILE_SIZE, World } from '@/engine/World';
import type { Building, BuildingDef, ZoneType } from '@/engine/types';

/** Minimal BuildingDef factory for tests. */
function makeDef(id: string, color = '#000000'): BuildingDef {
  return {
    id,
    name: id,
    type: 'house',
    width: 1,
    height: 1,
    cost: 0,
    upkeep: 0,
    capacity: 0,
    color,
  };
}

/** Build a Building instance. */
function makeBuilding(
  id: string,
  zone: ZoneType,
  x: number,
  y: number,
  width = 1,
  height = 1,
): Building {
  return {
    id,
    type: 'house',
    zone,
    x,
    y,
    width,
    height,
    def: makeDef(id),
  };
}

/**
 * Build a mock CanvasRenderingContext2D. fillStyle is tracked via a getter so
 * tests can assert the last-assigned color; fillRect is a jest.fn recording all
 * (x, y, w, h) calls AND the fillStyle active at each call (fillStyles[]).
 */
function makeMockCtx() {
  let currentFillStyle = '';
  const fillStyles: string[] = [];
  const fillRect = jest.fn(() => {
    fillStyles.push(currentFillStyle);
  });
  const save = jest.fn();
  const restore = jest.fn();
  const scale = jest.fn();
  const translate = jest.fn();

  const ctx = {
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(value: string) {
      currentFillStyle = value;
    },
    fillRect,
    fillStyles,
    save,
    restore,
    scale,
    translate,
  };
  return ctx as unknown as CanvasRenderingContext2D & {
    fillRect: jest.Mock;
    save: jest.Mock;
    restore: jest.Mock;
    scale: jest.Mock;
    translate: jest.Mock;
    fillStyles: string[];
  };
}

describe('Renderer', () => {
  it('exports ZONE_COLORS with the spec §6.1 hex values', () => {
    expect(ZONE_COLORS.residential).toBe('#7cb342');
    expect(ZONE_COLORS.commercial).toBe('#42a5f5');
    expect(ZONE_COLORS.industrial).toBe('#8d6e63');
    expect(ZONE_COLORS.entertainment).toBe('#ab47bc');
  });

  describe('drawGround', () => {
    it('fills the world rect with #e8e0d5', () => {
      const ctx = makeMockCtx();
      const world = new World(2, 3);
      const renderer = new Renderer(ctx, world);

      renderer.drawGround();

      expect(ctx.fillStyle).toBe('#e8e0d5');
      expect(ctx.fillRect).toHaveBeenCalledWith(
        0,
        0,
        2 * TILE_SIZE,
        3 * TILE_SIZE,
      );
    });
  });

  describe('drawRoads', () => {
    it('draws road surface #4a4a4a, sidewalk #c0b8ae, and center line #ffffff for road tiles', () => {
      const ctx = makeMockCtx();
      const world = new World(2, 2);
      world.grid.setTileType(0, 0, 'road');

      const renderer = new Renderer(ctx, world);
      renderer.drawRoads();

      // fillStyles records the fillStyle active at each fillRect call.
      const styles = ctx.fillStyles;
      // The three fillStyle assignments for the single road tile.
      expect(styles).toContain('#c0b8ae');
      expect(styles).toContain('#4a4a4a');
      expect(styles).toContain('#ffffff');
    });

    it('skips non-road tiles', () => {
      const ctx = makeMockCtx();
      const world = new World(2, 2);
      // No road tiles set.

      const renderer = new Renderer(ctx, world);
      renderer.drawRoads();

      expect(ctx.fillRect).not.toHaveBeenCalled();
    });
  });

  describe('drawBuildings', () => {
    it('colors buildings by ZONE_COLORS (spec hex), not def.color', () => {
      const ctx = makeMockCtx();
      const world = new World(10, 10);
      // def.color is deliberately different from the spec hex.
      const residential = makeBuilding('b1', 'residential', 1, 1);
      residential.def.color = '#ffffff';
      const commercial = makeBuilding('b2', 'commercial', 2, 1);
      commercial.def.color = '#ffffff';
      const industrial = makeBuilding('b3', 'industrial', 3, 1);
      industrial.def.color = '#ffffff';
      const entertainment = makeBuilding('b4', 'entertainment', 4, 1);
      entertainment.def.color = '#ffffff';
      world.addBuilding(residential);
      world.addBuilding(commercial);
      world.addBuilding(industrial);
      world.addBuilding(entertainment);

      const renderer = new Renderer(ctx, world);
      renderer.drawBuildings();

      // Each building produces exactly one fillRect.
      expect(ctx.fillRect.mock.calls.length).toBe(4);
      // fillStyles records the fillStyle active at each fillRect call.
      const usedColors = new Set<string>(ctx.fillStyles);

      expect(usedColors.has(ZONE_COLORS.residential)).toBe(true);
      expect(usedColors.has(ZONE_COLORS.commercial)).toBe(true);
      expect(usedColors.has(ZONE_COLORS.industrial)).toBe(true);
      expect(usedColors.has(ZONE_COLORS.entertainment)).toBe(true);
      // def.color (#ffffff) must NOT be used.
      expect(usedColors.has('#ffffff')).toBe(false);
    });

    it('depth-sorts buildings by south edge (y + height) ascending', () => {
      const ctx = makeMockCtx();
      const world = new World(10, 10);
      // Tall building at low y (south edge = 5 + 3 = 8).
      const tall = makeBuilding('tall', 'residential', 0, 5, 1, 3);
      // Short building at higher y (south edge = 6 + 1 = 7).
      const shortB = makeBuilding('short', 'commercial', 0, 6, 1, 1);
      world.addBuilding(tall);
      world.addBuilding(shortB);

      const renderer = new Renderer(ctx, world);
      const sorted = renderer.sortByDepth([tall, shortB]);
      // shortB south edge (7) < tall south edge (8) → shortB first.
      expect(sorted[0].id).toBe('short');
      expect(sorted[1].id).toBe('tall');
    });

    it('draws buildings in depth-sorted order (fillRect call order matches sort)', () => {
      const ctx = makeMockCtx();
      const world = new World(10, 10);
      const b1 = makeBuilding('b1', 'residential', 0, 9); // south = 10
      const b2 = makeBuilding('b2', 'commercial', 0, 1); // south = 2
      const b3 = makeBuilding('b3', 'industrial', 0, 5); // south = 6
      world.addBuilding(b1);
      world.addBuilding(b2);
      world.addBuilding(b3);

      const renderer = new Renderer(ctx, world);
      renderer.drawBuildings();

      const calls = ctx.fillRect.mock.calls;
      expect(calls.length).toBe(3);
      // Order should be b2 (y=1), b3 (y=5), b1 (y=9).
      expect(calls[0][1]).toBe(1 * TILE_SIZE); // b2.y
      expect(calls[1][1]).toBe(5 * TILE_SIZE); // b3.y
      expect(calls[2][1]).toBe(9 * TILE_SIZE); // b1.y
    });
  });

  describe('render', () => {
    it('calls layers in order: ground → roads → buildings', () => {
      const ctx = makeMockCtx();
      const world = new World(2, 2);
      world.grid.setTileType(0, 0, 'road');
      world.addBuilding(makeBuilding('b1', 'residential', 1, 1));

      const renderer = new Renderer(ctx, world);
      const spy = jest.spyOn(renderer, 'drawBuildings');
      const groundSpy = jest.spyOn(renderer, 'drawGround');
      const roadsSpy = jest.spyOn(renderer, 'drawRoads');

      renderer.render(0.5);

      // All three layers invoked.
      expect(groundSpy).toHaveBeenCalled();
      expect(roadsSpy).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
      // Verify call order via mock.invocationCallOrder.
      expect(groundSpy.mock.invocationCallOrder[0]).toBeLessThan(
        roadsSpy.mock.invocationCallOrder[0],
      );
      expect(roadsSpy.mock.invocationCallOrder[0]).toBeLessThan(
        spy.mock.invocationCallOrder[0],
      );

      // save/restore bracket the frame.
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
      spy.mockRestore();
      groundSpy.mockRestore();
      roadsSpy.mockRestore();
    });
  });
});
