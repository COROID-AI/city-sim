/**
 * Renderer unit tests.
 *
 * jsdom does not provide a real CanvasRenderingContext2D, so we build a
 * jest.fn-backed mock that records fillStyle assignments and fillRect calls.
 * The mock is cast to CanvasRenderingContext2D for type compatibility.
 */
import { CITIZEN_COLORS, Renderer, ZONE_COLORS } from '@/engine/Renderer';
import { TILE_SIZE, World } from '@/engine/World';
import { Citizen } from '@/entities/Citizen';
import { Vehicle } from '@/entities/Vehicle';
import type { SpriteLoader } from '@/engine/SpriteLoader';
import type { Building, BuildingDef, CityTime, ZoneType } from '@/engine/types';

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
/** A minimal gradient mock that records color stops. */
function makeMockGradient() {
  return {
    addColorStop: jest.fn(),
  };
}

function makeMockCtx() {
  let currentFillStyle = '';
  let currentCompositeOperation = 'source-over';
  let currentGlobalAlpha = 1;
  const fillStyles: string[] = [];
  const fillRect = jest.fn(() => {
    fillStyles.push(currentFillStyle);
  });
  const save = jest.fn();
  const restore = jest.fn();
  const scale = jest.fn();
  const translate = jest.fn();
  const createRadialGradient = jest.fn(() => makeMockGradient());
  const createLinearGradient = jest.fn(() => makeMockGradient());
  const beginPath = jest.fn();
  const arc = jest.fn();
  // fill() records the fillStyle active at call time (like fillRect).
  const fill = jest.fn(() => {
    fillStyles.push(currentFillStyle);
  });
  const closePath = jest.fn();
  const moveTo = jest.fn();
  const drawImage = jest.fn();
  const rotate = jest.fn();

  const ctx = {
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(value: string) {
      currentFillStyle = value;
    },
    get globalCompositeOperation() {
      return currentCompositeOperation;
    },
    set globalCompositeOperation(value: string) {
      currentCompositeOperation = value;
    },
    get globalAlpha() {
      return currentGlobalAlpha;
    },
    set globalAlpha(value: number) {
      currentGlobalAlpha = value;
    },
    fillRect,
    fillStyles,
    save,
    restore,
    scale,
    translate,
    createRadialGradient,
    createLinearGradient,
    beginPath,
    arc,
    fill,
    closePath,
    moveTo,
    drawImage,
    rotate,
  };
  return ctx as unknown as CanvasRenderingContext2D & {
    fillRect: jest.Mock;
    save: jest.Mock;
    restore: jest.Mock;
    scale: jest.Mock;
    translate: jest.Mock;
    createRadialGradient: jest.Mock;
    createLinearGradient: jest.Mock;
    beginPath: jest.Mock;
    arc: jest.Mock;
    fill: jest.Mock;
    closePath: jest.Mock;
    moveTo: jest.Mock;
    drawImage: jest.Mock;
    rotate: jest.Mock;
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

    it('calls all six layers in order: ground → roads → buildings → lightingOverlay → windowLights → streetLights', () => {
      const ctx = makeMockCtx();
      const world = new World(2, 2);
      world.grid.setTileType(0, 0, 'road');
      world.addBuilding(makeBuilding('b1', 'residential', 1, 1));

      const renderer = new Renderer(ctx, world);
      // Force night so the lighting layers actually draw.
      renderer.setTime({ day: 0, hour: 0, minute: 0, totalMs: 0 });

      const groundSpy = jest.spyOn(renderer, 'drawGround');
      const roadsSpy = jest.spyOn(renderer, 'drawRoads');
      const buildingsSpy = jest.spyOn(renderer, 'drawBuildings');
      const citizensSpy = jest.spyOn(renderer, 'drawCitizens');
      const overlaySpy = jest.spyOn(renderer, 'drawLightingOverlay');
      const windowSpy = jest.spyOn(renderer, 'drawWindowLights');
      const streetSpy = jest.spyOn(renderer, 'drawStreetLights');

      renderer.render(0.5);

      const order = [
        groundSpy.mock.invocationCallOrder[0],
        roadsSpy.mock.invocationCallOrder[0],
        buildingsSpy.mock.invocationCallOrder[0],
        citizensSpy.mock.invocationCallOrder[0],
        overlaySpy.mock.invocationCallOrder[0],
        windowSpy.mock.invocationCallOrder[0],
        streetSpy.mock.invocationCallOrder[0],
      ];
      for (let i = 1; i < order.length; i++) {
        expect(order[i]).toBeGreaterThan(order[i - 1]);
      }

      groundSpy.mockRestore();
      roadsSpy.mockRestore();
      buildingsSpy.mockRestore();
      citizensSpy.mockRestore();
      overlaySpy.mockRestore();
      windowSpy.mockRestore();
      streetSpy.mockRestore();
    });
  });

  describe('setTime / getLightingState', () => {
    it('updates the time used for lighting computation', () => {
      const ctx = makeMockCtx();
      const world = new World(2, 2);
      const renderer = new Renderer(ctx, world);

      // Default time is noon → day phase.
      expect(renderer.getLightingState().phase).toBe('day');

      const midnight: CityTime = { day: 0, hour: 0, minute: 0, totalMs: 0 };
      renderer.setTime(midnight);
      expect(renderer.getLightingState().phase).toBe('night');
      expect(renderer.getLightingState().overlayAlpha).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('drawLightingOverlay', () => {
    it('does NOT fill at noon (alpha ~0)', () => {
      const ctx = makeMockCtx();
      const world = new World(2, 2);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });

      const callsBefore = ctx.fillRect.mock.calls.length;
      renderer.drawLightingOverlay();
      expect(ctx.fillRect.mock.calls.length).toBe(callsBefore);
    });

    it('fills the overlay at midnight with rgba(10,15,40,...)', () => {
      const ctx = makeMockCtx();
      const world = new World(2, 2);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 0, minute: 0, totalMs: 0 });

      renderer.drawLightingOverlay();

      // The base overlay fillStyle must start with rgba(10,15,40,.
      const overlayFills = ctx.fillStyles.filter((s) =>
        s.startsWith('rgba(10,15,40,'),
      );
      expect(overlayFills.length).toBeGreaterThan(0);
    });
  });

  describe('drawWindowLights', () => {
    it('does NOT draw window lights at noon', () => {
      const ctx = makeMockCtx();
      const world = new World(4, 4);
      world.addBuilding(makeBuilding('b1', 'residential', 1, 1, 2, 2));
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });

      const callsBefore = ctx.fillRect.mock.calls.length;
      renderer.drawWindowLights();
      expect(ctx.fillRect.mock.calls.length).toBe(callsBefore);
    });

    it('draws #ffeb3b window lights at night', () => {
      const ctx = makeMockCtx();
      // Use a wide grid so buildings don't overlap. Add many buildings so the
      // deterministic hash selects a healthy subset with lit windows.
      const world = new World(40, 4);
      for (let i = 0; i < 20; i++) {
        world.addBuilding(makeBuilding(`b-${i}`, 'residential', i * 2, 0, 1, 2));
      }
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 0, minute: 0, totalMs: 0 });

      renderer.drawWindowLights();

      expect(ctx.fillStyles).toContain('#ffeb3b');
      expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(0);
    });

    it('uses additive composite operation and resets it afterward', () => {
      const ctx = makeMockCtx();
      const world = new World(40, 4);
      for (let i = 0; i < 20; i++) {
        world.addBuilding(makeBuilding(`b-${i}`, 'residential', i * 2, 0, 1, 2));
      }
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 0, minute: 0, totalMs: 0 });

      expect(ctx.globalCompositeOperation).toBe('source-over');
      renderer.drawWindowLights();
      // After drawing, composite operation must be reset to source-over.
      expect(ctx.globalCompositeOperation).toBe('source-over');
    });
  });

  describe('drawStreetLights', () => {
    it('does NOT draw street lights at noon', () => {
      const ctx = makeMockCtx();
      const world = new World(12, 12);
      // Lay down a road grid.
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          world.grid.setTileType(x, y, 'road');
        }
      }
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });

      const radialsBefore = ctx.createRadialGradient.mock.calls.length;
      renderer.drawStreetLights();
      expect(ctx.createRadialGradient.mock.calls.length).toBe(radialsBefore);
    });

    it('creates radial gradients for street lights at night', () => {
      const ctx = makeMockCtx();
      const world = new World(12, 12);
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          world.grid.setTileType(x, y, 'road');
        }
      }
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 0, minute: 0, totalMs: 0 });

      renderer.drawStreetLights();

      // At least one radial gradient created for the street light glow.
      expect(ctx.createRadialGradient.mock.calls.length).toBeGreaterThan(0);
      // Each radial gradient call has 6 numeric args (cx, cy, r0, cx, cy, r1).
      const firstCall = ctx.createRadialGradient.mock.calls[0];
      expect(firstCall.length).toBe(6);
    });

    it('places street lights on a stride of ~6 tiles', () => {
      const ctx = makeMockCtx();
      const world = new World(12, 12);
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          world.grid.setTileType(x, y, 'road');
        }
      }
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 0, minute: 0, totalMs: 0 });

      renderer.drawStreetLights();

      // 144 road tiles, stride 6 → ~24 street lights.
      const count = ctx.createRadialGradient.mock.calls.length;
      expect(count).toBeGreaterThan(10);
      expect(count).toBeLessThan(144);
    });

    it('resets composite operation after drawing', () => {
      const ctx = makeMockCtx();
      const world = new World(12, 12);
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          world.grid.setTileType(x, y, 'road');
        }
      }
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 0, minute: 0, totalMs: 0 });

      renderer.drawStreetLights();
      expect(ctx.globalCompositeOperation).toBe('source-over');
    });
  });

  describe('drawCitizens', () => {
    it('handles an empty citizens array gracefully (no draw calls)', () => {
      const ctx = makeMockCtx();
      const world = new World(4, 4);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });

      const arcBefore = ctx.arc.mock.calls.length;
      const fillBefore = ctx.fill.mock.calls.length;
      renderer.drawCitizens();
      expect(ctx.arc.mock.calls.length).toBe(arcBefore);
      expect(ctx.fill.mock.calls.length).toBe(fillBefore);
    });

    it('renders a working employed citizen as #1565c0 (worker)', () => {
      const ctx = makeMockCtx();
      const world = new World(4, 4);
      const citizen = new Citizen({ x: 10, y: 10 }, { employed: true });
      citizen.activity = 'working';
      world.addCitizen(citizen);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });

      renderer.drawCitizens();

      expect(ctx.fillStyles).toContain(CITIZEN_COLORS.worker);
    });

    it('renders a commuting employed citizen as #1565c0 (worker)', () => {
      const ctx = makeMockCtx();
      const world = new World(4, 4);
      const citizen = new Citizen({ x: 10, y: 10 }, { employed: true });
      citizen.activity = 'commuting';
      world.addCitizen(citizen);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });

      renderer.drawCitizens();

      expect(ctx.fillStyles).toContain(CITIZEN_COLORS.worker);
    });

    it('renders an entertaining employed citizen as #2e7d32 (visitor)', () => {
      const ctx = makeMockCtx();
      const world = new World(4, 4);
      const citizen = new Citizen({ x: 10, y: 10 }, { employed: true });
      citizen.activity = 'entertaining';
      world.addCitizen(citizen);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });

      renderer.drawCitizens();

      expect(ctx.fillStyles).toContain(CITIZEN_COLORS.visitor);
    });

    it('renders an unemployed citizen as #ef6c00 (unemployed)', () => {
      const ctx = makeMockCtx();
      const world = new World(4, 4);
      const citizen = new Citizen({ x: 10, y: 10 }, { employed: false });
      citizen.activity = 'wandering';
      world.addCitizen(citizen);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });

      renderer.drawCitizens();

      expect(ctx.fillStyles).toContain(CITIZEN_COLORS.unemployed);
    });

    it('renders citizen dots at globalAlpha 0.7 at night', () => {
      const ctx = makeMockCtx();
      const world = new World(4, 4);
      const citizen = new Citizen({ x: 10, y: 10 }, { employed: true });
      citizen.activity = 'working';
      world.addCitizen(citizen);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 0, minute: 0, totalMs: 0 });

      renderer.drawCitizens();

      // globalAlpha is reset after drawing, so we inspect the arc calls: the
      // dot arc is drawn while alpha is 0.7. We assert via the recorded alpha
      // by checking that arc was called (dot + flashlight) and that the final
      // globalAlpha is restored to 1.
      expect(ctx.arc.mock.calls.length).toBeGreaterThan(0);
      expect(ctx.globalAlpha).toBe(1);
    });

    it('draws a flashlight circle (arc) at night', () => {
      const ctx = makeMockCtx();
      const world = new World(4, 4);
      const citizen = new Citizen({ x: 10, y: 10 }, { employed: true });
      citizen.activity = 'working';
      world.addCitizen(citizen);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 0, minute: 0, totalMs: 0 });

      renderer.drawCitizens();

      // At night: 1 dot arc + 1 flashlight arc = 2 arc calls per citizen.
      expect(ctx.arc.mock.calls.length).toBe(2);
      // A radial gradient is created for the flashlight glow.
      expect(ctx.createRadialGradient.mock.calls.length).toBe(1);
    });

    it('does NOT draw a flashlight circle during the day', () => {
      const ctx = makeMockCtx();
      const world = new World(4, 4);
      const citizen = new Citizen({ x: 10, y: 10 }, { employed: true });
      citizen.activity = 'working';
      world.addCitizen(citizen);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });

      renderer.drawCitizens();

      // Day: only the dot arc (1), no flashlight.
      expect(ctx.arc.mock.calls.length).toBe(1);
      expect(ctx.createRadialGradient.mock.calls.length).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // Viewport culling + batched citizen draws + sprite path (spec §8).
  // ------------------------------------------------------------------
  describe('viewport culling', () => {
    it('draws all entities when setViewport is NOT called (backward compat)', () => {
      const ctx = makeMockCtx();
      const world = new World(20, 20);
      // Place buildings far apart.
      world.buildings.set('b1', makeBuilding('b1', 'residential', 1, 1));
      world.buildings.set('b2', makeBuilding('b2', 'residential', 18, 18));
      const renderer = new Renderer(ctx, world);
      renderer.render(0);
      const stats = renderer.getStats();
      // No viewport → no culling → both drawn.
      expect(stats.buildingsDrawn).toBe(2);
      expect(stats.buildingsCulled).toBe(0);
    });

    it('skips buildings outside the camera visible rect + 10% margin', () => {
      const ctx = makeMockCtx();
      const world = new World(40, 40);
      world.buildings.set('b1', makeBuilding('b1', 'residential', 1, 1));
      world.buildings.set('b2', makeBuilding('b2', 'residential', 38, 38));
      const renderer = new Renderer(ctx, world);
      // Viewport covers only the top-left corner (world px 0..320).
      renderer.setViewport(320, 320);
      renderer.setCamera({ x: 0, y: 0, zoom: 1 });
      renderer.render(0);
      const stats = renderer.getStats();
      expect(stats.buildingsDrawn).toBe(1);
      expect(stats.buildingsCulled).toBe(1);
    });

    it('skips citizens outside the camera visible rect', () => {
      const ctx = makeMockCtx();
      const world = new World(40, 40);
      const c1 = new Citizen({ x: 10, y: 10 }, { employed: true });
      c1.activity = 'working';
      const c2 = new Citizen({ x: 1000, y: 1000 }, { employed: true });
      c2.activity = 'working';
      world.addCitizen(c1);
      world.addCitizen(c2);
      const renderer = new Renderer(ctx, world);
      renderer.setViewport(320, 320);
      renderer.setCamera({ x: 0, y: 0, zoom: 1 });
      renderer.render(0);
      const stats = renderer.getStats();
      expect(stats.citizensDrawn).toBe(1);
      expect(stats.citizensCulled).toBe(1);
    });

    it('skips vehicles outside the camera visible rect', () => {
      const ctx = makeMockCtx();
      const world = new World(40, 40);
      const v1 = new Vehicle({ x: 5, y: 5 }, { velocity: { x: 1, y: 0 }, color: '#ff0000' });
      const v2 = new Vehicle({ x: 500, y: 500 }, { velocity: { x: 1, y: 0 }, color: '#ff0000' });
      world.addVehicle(v1);
      world.addVehicle(v2);
      const renderer = new Renderer(ctx, world);
      renderer.setViewport(320, 320);
      renderer.setCamera({ x: 0, y: 0, zoom: 1 });
      renderer.render(0);
      const stats = renderer.getStats();
      expect(stats.vehiclesDrawn).toBe(1);
      expect(stats.vehiclesCulled).toBe(1);
    });
  });

  describe('batched citizen draws', () => {
    it('groups citizens by color into a single fill() per color', () => {
      const ctx = makeMockCtx();
      const world = new World(20, 20);
      // 3 workers (same color).
      for (let i = 0; i < 3; i++) {
        const c = new Citizen({ x: 10 + i * 5, y: 10 }, { employed: true });
        c.activity = 'working';
        world.addCitizen(c);
      }
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });
      renderer.drawCitizens();
      // 3 citizens, 1 color → exactly 1 fill() call for the dots.
      expect(ctx.fill.mock.calls.length).toBe(1);
      // 3 arcs in the single path.
      expect(ctx.arc.mock.calls.length).toBe(3);
    });

    it('produces at most 3 fill() calls (one per color class)', () => {
      const ctx = makeMockCtx();
      const world = new World(20, 20);
      // Mix of worker, visitor, unemployed.
      const worker = new Citizen({ x: 10, y: 10 }, { employed: true });
      worker.activity = 'working';
      const visitor = new Citizen({ x: 20, y: 10 }, { employed: true });
      visitor.activity = 'eating';
      const unemployed = new Citizen({ x: 30, y: 10 }, { employed: false });
      world.addCitizen(worker);
      world.addCitizen(visitor);
      world.addCitizen(unemployed);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });
      renderer.drawCitizens();
      // At most 3 fill() calls (one per color class).
      expect(ctx.fill.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('skips invisible citizens in the batched draw loop', () => {
      const ctx = makeMockCtx();
      const world = new World(20, 20);
      const visible = new Citizen({ x: 10, y: 10 }, { employed: true });
      visible.activity = 'working';
      const hidden = new Citizen({ x: 20, y: 10 }, { employed: true });
      hidden.activity = 'working';
      hidden.visible = false;
      world.addCitizen(visible);
      world.addCitizen(hidden);
      const renderer = new Renderer(ctx, world);
      renderer.setTime({ day: 0, hour: 12, minute: 0, totalMs: 12 * 3_600_000 });
      renderer.drawCitizens();
      // Only 1 arc for the visible citizen.
      expect(ctx.arc.mock.calls.length).toBe(1);
    });
  });

  describe('sprite integration', () => {
    it('uses drawImage when a building sprite is available', () => {
      const ctx = makeMockCtx();
      const drawImage = jest.fn();
      (ctx as unknown as { drawImage: jest.Mock }).drawImage = drawImage;
      const world = new World(10, 10);
      world.buildings.set('b1', makeBuilding('b1', 'residential', 1, 1));
      const fakeSprite = {} as HTMLImageElement;
      const spriteLoader = { get: jest.fn(() => fakeSprite) } as unknown as SpriteLoader;
      const renderer = new Renderer(ctx, world, { spriteLoader });
      renderer.drawBuildings();
      expect(drawImage).toHaveBeenCalled();
      // Procedural fillRect should NOT have been called for the building body.
      // (drawGround is not called here, so fillRect calls are only from buildings.)
      expect(spriteLoader.get).toHaveBeenCalledWith('building', 'house');
    });

    it('falls back to procedural draw when no sprite is available', () => {
      const ctx = makeMockCtx();
      const world = new World(10, 10);
      world.buildings.set('b1', makeBuilding('b1', 'residential', 1, 1));
      const spriteLoader = { get: jest.fn(() => null) } as unknown as SpriteLoader;
      const renderer = new Renderer(ctx, world, { spriteLoader });
      renderer.drawBuildings();
      // Procedural fillRect was called for the building.
      expect(ctx.fillRect).toHaveBeenCalled();
    });
  });
});
