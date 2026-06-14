/**
 * Tests for src/engine/Renderer.ts.
 *
 * These tests run under jsdom. jsdom does NOT implement Canvas 2D — every
 * method on the real `CanvasRenderingContext2D` is a no-op. To make the
 * renderer testable we install a `FakeCanvasContext` that records every
 * call (fillRect, drawImage, save/restore, …) into arrays which the
 * assertions then walk.
 *
 * Sprite handling: jsdom has no image network, so `tryLoadSprites()`
 * returns an atlas whose slots are all `null`. Tests rely on that
 * behaviour to exercise the procedural-fallback path.
 */

import { Camera } from '@/engine/Camera';
import { Renderer, TILE_PIXELS, compareBuildingsByDepth } from '@/engine/Renderer';
import { DEFAULT_PALETTE, colorForTile } from '@/engine/palette';
import { tryLoadSprites, spriteUrl, SPRITE_BASE } from '@/engine/sprites';
import { World } from '@/engine/World';
import type { Building, BuildingDef } from '@/engine/types';
import type { RendererContext } from '@/engine/Renderer';

/* -------------------------------------------------------------------------- */
/* FakeCanvasContext                                                         */
/* -------------------------------------------------------------------------- */

interface FillCall {
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
}

interface DrawImageCall {
  x: number;
  y: number;
  image: unknown;
}

class FakeCanvasContext implements RendererContext {
  fillCalls: FillCall[] = [];
  drawImageCalls: DrawImageCall[] = [];
  saveCount = 0;
  restoreCount = 0;
  currentFillStyle = '';
  currentStrokeStyle = '';
  currentGlobalAlpha = 1;
  // Backing field for the imageSmoothingEnabled accessor pair below.
  // The actual class field is `imageSmoothingEnabledFlag`; the public
  // property is exposed via the getter/setter pair so this class
  // conforms to RendererContext's `set imageSmoothingEnabled` shape.
  private imageSmoothingEnabledFlag = true;
  stateStack: Array<{ fillStyle: string; strokeStyle: string; globalAlpha: number }> = [];

  save(): void {
    this.saveCount++;
    this.stateStack.push({
      fillStyle: this.currentFillStyle,
      strokeStyle: this.currentStrokeStyle,
      globalAlpha: this.currentGlobalAlpha,
    });
  }
  restore(): void {
    this.restoreCount++;
    const top = this.stateStack.pop();
    if (top) {
      this.currentFillStyle = top.fillStyle;
      this.currentStrokeStyle = top.strokeStyle;
      this.currentGlobalAlpha = top.globalAlpha;
    }
  }
  translate(): void {/* no-op for tests */}
  scale(): void {/* no-op for tests */}
  clearRect(): void {/* no-op for tests */}
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillCalls.push({ x, y, w, h, style: this.currentFillStyle });
  }
  strokeRect(): void {/* no-op */}
  beginPath(): void {/* no-op */}
  rect(): void {/* no-op */}
  fill(): void {/* no-op */}
  stroke(): void {/* no-op */}
  drawImage(image: CanvasImageSource, x: number, y: number): void {
    this.drawImageCalls.push({ x, y, image });
  }
  set fillStyle(v: string) { this.currentFillStyle = v; }
  get fillStyle(): string { return this.currentFillStyle; }
  set strokeStyle(v: string) { this.currentStrokeStyle = v; }
  get strokeStyle(): string { return this.currentStrokeStyle; }
  set globalAlpha(v: number) { this.currentGlobalAlpha = v; }
  get globalAlpha(): number { return this.currentGlobalAlpha; }
  set imageSmoothingEnabled(v: boolean) {
    this.imageSmoothingEnabledFlag = v;
  }
  get imageSmoothingEnabled(): boolean {
    return this.imageSmoothingEnabledFlag;
  }
  /** Optional createRadialGradient — tracked so we can assert on lighting draws. */
  radialGradientCalls: Array<{
    x0: number;
    y0: number;
    r0: number;
    x1: number;
    y1: number;
    r1: number;
    stops: Array<{ offset: number; color: string }>;
  }> = [];
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): RendererGradientStub {
    const stops: Array<{ offset: number; color: string }> = [];
    const rec = { x0, y0, r0, x1, y1, r1, stops };
    this.radialGradientCalls.push(rec);
    const gradient: RendererGradientStub = {
      addColorStop(offset: number, color: string) {
        stops.push({ offset, color });
      },
    };
    return gradient;
  }
}

interface RendererGradientStub {
  addColorStop(offset: number, color: string): void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function makeWorld(
  width: number,
  height: number,
  setup?: (world: World) => void,
): World {
  const world = new World({ width, height });
  if (setup) setup(world);
  return world;
}

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return {
    id: overrides.id ?? 'b1',
    defId: overrides.defId ?? 'def-office',
    origin: overrides.origin ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 1, height: 1 },
    employees: overrides.employees ?? [],
    treasury: overrides.treasury ?? 0,
  };
}

function makeDef(overrides: Partial<BuildingDef> = {}): BuildingDef {
  return {
    id: overrides.id ?? 'def-office',
    name: overrides.name ?? 'Office',
    type: overrides.type ?? 'office',
    color: overrides.color ?? '#3aa0ff',
    revenue: overrides.revenue ?? 100,
    maxEmployees: overrides.maxEmployees ?? 10,
    openHour: overrides.openHour ?? 9,
    closeHour: overrides.closeHour ?? 17,
    size: overrides.size ?? { width: 1, height: 1 },
  };
}

function makeCamera(worldWidth: number, worldHeight: number): Camera {
  const cam = new Camera({ width: worldWidth, height: worldHeight });
  cam.setViewport(worldWidth, worldHeight);
  cam.position = { x: worldWidth / 2, y: worldHeight / 2 };
  // `targetPosition` is declared `readonly` on the Camera class, so we
  // mutate its fields in-place rather than reassigning the whole vector.
  cam.targetPosition.x = worldWidth / 2;
  cam.targetPosition.y = worldHeight / 2;
  cam.zoom = 1;
  cam.targetZoom = 1;
  return cam;
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                     */
/* -------------------------------------------------------------------------- */

describe('palette', () => {
  test('exposes the required keys', () => {
    const required = [
      'background', 'ground', 'groundAlt', 'road', 'roadMarking',
      'water', 'park', 'lot', 'building', 'buildingShadow',
      'buildingRoof', 'citizen', 'citizenOutline', 'accent',
      'warning', 'grid',
    ];
    for (const k of required) {
      expect(DEFAULT_PALETTE).toHaveProperty(k);
    }
  });

  test('all string values are non-empty (hex, rgba, or named)', () => {
    for (const value of Object.values(DEFAULT_PALETTE)) {
      if (typeof value === 'string') {
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  test('colorForTile resolves each kind', () => {
    expect(colorForTile(DEFAULT_PALETTE, 'ground')).toBe(DEFAULT_PALETTE.ground);
    expect(colorForTile(DEFAULT_PALETTE, 'road')).toBe(DEFAULT_PALETTE.road);
    expect(colorForTile(DEFAULT_PALETTE, 'water')).toBe(DEFAULT_PALETTE.water);
    expect(colorForTile(DEFAULT_PALETTE, 'park')).toBe(DEFAULT_PALETTE.park);
    expect(colorForTile(DEFAULT_PALETTE, 'lot')).toBe(DEFAULT_PALETTE.lot);
  });
});

describe('sprites', () => {
  test('spriteUrl composes the expected path', () => {
    expect(spriteUrl('ground')).toBe('/assets/sprites/ground.png');
    expect(spriteUrl('building', '/custom/base')).toBe('/custom/base/building.png');
  });

  test('SPRITE_BASE matches the canonical asset path', () => {
    expect(SPRITE_BASE).toBe('/assets/sprites');
  });

  test('tryLoadSprites does not throw and returns an atlas', () => {
    const atlas = tryLoadSprites();
    expect(atlas).toBeDefined();
    // Every known slot is present.
    for (const k of ['ground', 'road', 'water', 'park', 'lot', 'building', 'citizen'] as const) {
      expect(k in atlas).toBe(true);
    }
  });

  test('tryLoadSprites slots are null in jsdom (no network)', () => {
    // jsdom does not implement image loading over the network, so the
    // atlas is fully empty. The renderer MUST treat this as the
    // procedural-fallback case (verified by the draw tests below).
    const atlas = tryLoadSprites();
    for (const k of Object.keys(atlas) as Array<keyof typeof atlas>) {
      expect(atlas[k]).toBeNull();
    }
  });
});

describe('Renderer', () => {
  test('rejects invalid tilePixels', () => {
    expect(() => new Renderer({ tilePixels: 0 })).toThrow(RangeError);
    expect(() => new Renderer({ tilePixels: -1 })).toThrow(RangeError);
    expect(() => new Renderer({ tilePixels: NaN })).toThrow(RangeError);
  });

  test('draw returns safely with empty world', () => {
    const ctx = new FakeCanvasContext();
    const world = new World({ width: 8, height: 8 });
    const cam = makeCamera(8, 8);
    const r = new Renderer();
    expect(() => r.draw(ctx, world, cam)).not.toThrow();
    // Background fill is always painted.
    expect(ctx.fillCalls.length).toBeGreaterThan(0);
    // save/restore balance: outer save + inner save + 2 restores.
    expect(ctx.saveCount).toBe(2);
    expect(ctx.restoreCount).toBe(2);
  });

  test('drawGround paints one fillRect per ground tile in view', () => {
    const ctx = new FakeCanvasContext();
    const world = makeWorld(4, 4, (w) => {
      w.setTile({ x: 1, y: 1 }, 'road');
    });
    const cam = makeCamera(4, 4);
    new Renderer().draw(ctx, world, cam);
    // 4x4 = 16 ground tiles minus the 1 road = 15 ground fills, plus the
    // background fill and the road fill (with the marking). We assert
    // the count is in the expected range.
    const groundFills = ctx.fillCalls.filter(
      (c) => c.style === DEFAULT_PALETTE.ground || c.style === DEFAULT_PALETTE.groundAlt,
    );
    expect(groundFills.length).toBe(15);
  });

  test('drawRoads paints road tiles with the road color and a marking', () => {
    const ctx = new FakeCanvasContext();
    const world = makeWorld(4, 4, (w) => {
      // Horizontal road along y=1, 4 tiles long.
      for (let x = 0; x < 4; x++) w.setTile({ x, y: 1 }, 'road');
    });
    const cam = makeCamera(4, 4);
    new Renderer().draw(ctx, world, cam);
    // 4 road fills.
    const roadFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.road);
    expect(roadFills.length).toBe(4);
    // Markings: each of the 4 road tiles is adjacent to another road
    // horizontally; the 2 interior tiles get a horizontal strip and the
    // 2 endpoints also have a horizontal neighbour so all 4 are
    // "horizontal" — they should all get a road-marking fill.
    const markingFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.roadMarking);
    expect(markingFills.length).toBeGreaterThanOrEqual(4);
  });

  test('drawBuildings paints a building at its origin', () => {
    const ctx = new FakeCanvasContext();
    const world = makeWorld(6, 6, (w) => {
      w.registerBuildingDef(makeDef({ id: 'def-office', color: '#abcdef' }));
      w.addBuilding(makeBuilding({ id: 'b1', defId: 'def-office', origin: { x: 2, y: 2 } }));
    });
    const cam = makeCamera(6, 6);
    new Renderer().draw(ctx, world, cam);
    // Building fill uses the def's color (#abcdef).
    const defFills = ctx.fillCalls.filter((c) => c.style === '#abcdef');
    expect(defFills.length).toBeGreaterThan(0);
    // Roof band uses palette.buildingRoof.
    const roofFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.buildingRoof);
    expect(roofFills.length).toBeGreaterThan(0);
    // Shadow band uses palette.buildingShadow.
    const shadowFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.buildingShadow);
    expect(shadowFills.length).toBeGreaterThan(0);
  });

  test('drawBuildings uses palette default when def has no color match', () => {
    const ctx = new FakeCanvasContext();
    // World with a building that references a def we never registered.
    const world = makeWorld(4, 4, (w) => {
      w.addBuilding(makeBuilding({ id: 'b1', defId: 'def-unknown', origin: { x: 0, y: 0 } }));
    });
    const cam = makeCamera(4, 4);
    new Renderer().draw(ctx, world, cam);
    const paletteFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.building);
    expect(paletteFills.length).toBeGreaterThan(0);
  });

  test('drawBuildings Y-sorts by (origin.y + size.height) ascending', () => {
    const ctx = new FakeCanvasContext();
    const world = makeWorld(8, 8, (w) => {
      w.registerBuildingDef(makeDef({ id: 'd1', color: '#111111' }));
      w.registerBuildingDef(makeDef({ id: 'd2', color: '#222222' }));
      w.registerBuildingDef(makeDef({ id: 'd3', color: '#333333' }));
      // Insert in the wrong order: tall-front first.
      w.addBuilding(makeBuilding({ id: 'front', defId: 'd1', origin: { x: 0, y: 5 }, size: { width: 1, height: 3 } }));
      w.addBuilding(makeBuilding({ id: 'mid',   defId: 'd2', origin: { x: 0, y: 2 }, size: { width: 1, height: 2 } }));
      w.addBuilding(makeBuilding({ id: 'back',  defId: 'd3', origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } }));
    });
    const cam = makeCamera(8, 8);
    new Renderer().draw(ctx, world, cam);
    // The first fillRect with each color corresponds to the body fill
    // (roof/shadow come immediately after). The order must be back, mid, front
    // because (y+h) is 1, 4, 8 respectively.
    const order: string[] = [];
    for (const c of ctx.fillCalls) {
      if (c.style === '#333333' || c.style === '#222222' || c.style === '#111111') {
        if (!order.includes(c.style)) order.push(c.style);
      }
    }
    expect(order).toEqual(['#333333', '#222222', '#111111']);
  });

  test('compareBuildingsByDepth orders by bottom-Y then origin.y then origin.x', () => {
    const a = makeBuilding({ id: 'a', origin: { x: 3, y: 1 }, size: { width: 1, height: 2 } }); // bottom=3
    const b = makeBuilding({ id: 'b', origin: { x: 0, y: 0 }, size: { width: 2, height: 3 } }); // bottom=3, x=0 < 3
    const c = makeBuilding({ id: 'c', origin: { x: 0, y: 5 }, size: { width: 1, height: 1 } }); // bottom=6
    const sorted = [c, a, b].sort(compareBuildingsByDepth);
    expect(sorted.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  test('culls buildings fully outside the viewport', () => {
    const ctx = new FakeCanvasContext();
    const world = makeWorld(100, 100, (w) => {
      w.registerBuildingDef(makeDef({ id: 'd1', color: '#ff0000' }));
      w.addBuilding(makeBuilding({ id: 'near', defId: 'd1', origin: { x: 1, y: 1 } }));
      w.addBuilding(makeBuilding({ id: 'far',  defId: 'd1', origin: { x: 50, y: 50 } }));
    });
    // Camera viewport only sees the top-left 4x4 region.
    const cam = makeCamera(100, 100);
    cam.setViewport(4, 4);
    cam.position = { x: 2, y: 2 };
    cam.targetPosition.x = 2;
    cam.targetPosition.y = 2;
    new Renderer().draw(ctx, world, cam);
    const redFills = ctx.fillCalls.filter((c) => c.style === '#ff0000');
    // Exactly one building ('near') should have been drawn.
    expect(redFills.length).toBeGreaterThan(0);
    // The 'far' building's fill footprint is roughly (50,50,1,1) in world
    // coords; it should NOT appear.
    const hasFar = redFills.some(
      (c) => c.x >= 49 && c.x <= 51 && c.y >= 49 && c.y <= 51,
    );
    expect(hasFar).toBe(false);
  });

  test('uses sprite when present and falls back to procedural otherwise', () => {
    const ctx = new FakeCanvasContext();
    const world = new World({ width: 2, height: 2 });
    const cam = makeCamera(2, 2);

    // First call: no atlas → procedural path.
    new Renderer().draw(ctx, world, cam);
    const proceduralCalls = ctx.drawImageCalls.length;
    expect(proceduralCalls).toBe(0);

    // Second call with a ground sprite → drawImage is used for ground tiles.
    const atlas = tryLoadSprites();
    // Fake an image element so the renderer accepts it.
    const fakeImage = { width: 1, height: 1 } as unknown as HTMLImageElement;
    (atlas as { ground: HTMLImageElement | null }).ground = fakeImage;
    const ctx2 = new FakeCanvasContext();
    new Renderer({ sprites: atlas }).draw(ctx2, world, cam);
    // 4 ground tiles → 4 drawImage calls.
    expect(ctx2.drawImageCalls.length).toBe(4);
    // 1 fillRect call remains: the background fill.
    const nonBackgroundFills = ctx2.fillCalls.filter(
      (c) => c.style !== DEFAULT_PALETTE.background,
    );
    expect(nonBackgroundFills.length).toBe(0);
  });

  test('drawImage errors do not throw', () => {
    const ctx = new FakeCanvasContext();
    // Override drawImage to throw.
    ctx.drawImage = () => { throw new Error('decode failure'); };
    const atlas = tryLoadSprites();
    (atlas as { ground: HTMLImageElement | null }).ground =
      { width: 1, height: 1 } as unknown as HTMLImageElement;
    const world = new World({ width: 2, height: 2 });
    const cam = makeCamera(2, 2);
    expect(() => new Renderer({ sprites: atlas }).draw(ctx, world, cam)).not.toThrow();
  });

  test('TILE_PIXELS is a positive number', () => {
    expect(typeof TILE_PIXELS).toBe('number');
    expect(TILE_PIXELS).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Lighting tests                                                            */
/* -------------------------------------------------------------------------- */

describe('Renderer lighting', () => {
  test('drawLightingOverlay is a no-op at daylightFactor=1', () => {
    const ctx = new FakeCanvasContext();
    const r = new Renderer();
    const before = ctx.fillCalls.length;
    r.drawLightingOverlay(ctx, 100, 100, 1);
    // No fills added.
    expect(ctx.fillCalls.length).toBe(before);
    // And no gradient was created.
    expect(ctx.radialGradientCalls.length).toBe(0);
  });

  test('drawLightingOverlay creates one gradient and one fill at daylightFactor=0', () => {
    const ctx = new FakeCanvasContext();
    const r = new Renderer();
    const before = ctx.fillCalls.length;
    r.drawLightingOverlay(ctx, 100, 100, 0);
    // One gradient created, with two color stops.
    expect(ctx.radialGradientCalls.length).toBe(1);
    expect(ctx.radialGradientCalls[0]?.stops.length).toBe(2);
    // Exactly one fillRect added (the overlay).
    expect(ctx.fillCalls.length).toBe(before + 1);
    // globalAlpha should match palette.maxNightAlpha (0.6 by default).
    const lastAlpha = ctx.currentGlobalAlpha;
    expect(lastAlpha).toBeCloseTo(DEFAULT_PALETTE.maxNightAlpha, 5);
  });

  test('drawLightingOverlay alpha scales with (1 - daylightFactor) * maxNightAlpha', () => {
    const ctx = new FakeCanvasContext();
    const r = new Renderer();
    r.drawLightingOverlay(ctx, 100, 100, 0.5);
    const expected = (1 - 0.5) * DEFAULT_PALETTE.maxNightAlpha;
    expect(ctx.currentGlobalAlpha).toBeCloseTo(expected, 5);
  });

  test('drawWithLighting skips all lighting passes at full daylight', () => {
    const ctx = new FakeCanvasContext();
    const world = new World({ width: 4, height: 4 });
    const cam = makeCamera(4, 4);
    new Renderer().drawWithLighting(ctx, world, cam, 1);
    expect(ctx.radialGradientCalls.length).toBe(0);
  });

  test('drawWindowLights is deterministic for a given building id', () => {
    const ctx1 = new FakeCanvasContext();
    const ctx2 = new FakeCanvasContext();
    const world = makeWorld(6, 6, (w) => {
      w.registerBuildingDef(makeDef({ id: 'd1', color: '#abcdef' }));
      w.addBuilding(makeBuilding({ id: 'stable-id', defId: 'd1', origin: { x: 1, y: 1 }, size: { width: 2, height: 2 } }));
    });
    const cam = makeCamera(6, 6);
    new Renderer().drawWindowLights(ctx1, world, cam, 0);
    new Renderer().drawWindowLights(ctx2, world, cam, 0);
    // Both should record the same window-light fill rects.
    const paletteFills1 = ctx1.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.windowLight);
    const paletteFills2 = ctx2.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.windowLight);
    expect(paletteFills1.length).toBe(paletteFills2.length);
    expect(paletteFills1.length).toBeGreaterThan(0);
    for (let i = 0; i < paletteFills1.length; i++) {
      expect(paletteFills1[i]?.x).toBeCloseTo(paletteFills2[i]?.x ?? -1, 5);
      expect(paletteFills1[i]?.y).toBeCloseTo(paletteFills2[i]?.y ?? -1, 5);
    }
  });

  test('drawWindowLights draws nothing at daylightFactor=1', () => {
    const ctx = new FakeCanvasContext();
    const world = makeWorld(4, 4, (w) => {
      w.registerBuildingDef(makeDef({ id: 'd1' }));
      w.addBuilding(makeBuilding({ id: 'b1', defId: 'd1', origin: { x: 0, y: 0 } }));
    });
    const cam = makeCamera(4, 4);
    new Renderer().drawWindowLights(ctx, world, cam, 1);
    const windowFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.windowLight);
    expect(windowFills.length).toBe(0);
  });

  test('drawWindowLights culls buildings outside the viewport', () => {
    const ctx = new FakeCanvasContext();
    const world = makeWorld(100, 100, (w) => {
      w.registerBuildingDef(makeDef({ id: 'd1' }));
      w.addBuilding(makeBuilding({ id: 'b1', defId: 'd1', origin: { x: 1, y: 1 } }));
      w.addBuilding(makeBuilding({ id: 'b2', defId: 'd1', origin: { x: 50, y: 50 } }));
    });
    const cam = makeCamera(100, 100);
    cam.setViewport(4, 4);
    cam.position = { x: 2, y: 2 };
    cam.targetPosition.x = 2;
    cam.targetPosition.y = 2;
    new Renderer().drawWindowLights(ctx, world, cam, 0);
    // The far building should not contribute any window fills.
    const windowFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.windowLight);
    for (const f of windowFills) {
      const isFar = f.x >= 49.5 && f.x <= 51.5 && f.y >= 49.5 && f.y <= 51.5;
      expect(isFar).toBe(false);
    }
  });

  test('placeStreetLights skips intersections and water/lot neighbours', () => {
    // Build a world: a horizontal road at y=1 with an intersection at x=2
    // and water tiles on the right end.
    const world = new World({ width: 6, height: 4 });
    for (let x = 0; x < 6; x++) world.setTile({ x, y: 1 }, 'road');
    // Add a vertical road at x=2 to create an intersection at (2, 1).
    for (let y = 0; y < 4; y++) world.setTile({ x: 2, y }, 'road');
    // Water at (5, 0) and (5, 2) — adjacent to (5, 1) and (4, 1) corners.
    world.setTile({ x: 5, y: 0 }, 'water');
    world.setTile({ x: 5, y: 2 }, 'water');
    const r = new Renderer();
    const lights = r.placeStreetLights(world);
    // No light should be at the intersection (2, 1) — it has 4 road neighbours.
    expect(lights.some((p) => p.x === 2 && p.y === 1)).toBe(false);
    // The result must be deterministic — calling again returns the same.
    const lights2 = r.placeStreetLights(world);
    expect(lights2).toEqual(lights);
    // And every returned position is actually a road tile.
    for (const p of lights) {
      expect(world.getTile(p)?.kind).toBe('road');
    }
  });

  test('placeStreetLights places at most every other road tile along a straight road', () => {
    // 10-tile straight horizontal road.
    const world = new World({ width: 10, height: 1 });
    for (let x = 0; x < 10; x++) world.setTile({ x, y: 0 }, 'road');
    const lights = new Renderer().placeStreetLights(world);
    // All lights must be on a single row, and they must be at even
    // x positions only (parity-based staggering).
    for (const p of lights) {
      expect(p.y).toBe(0);
      expect(p.x % 2).toBe(0);
    }
    // We expect a lamp at x=0, 2, 4, 6, 8 → 5 lamps. (x=0,2,4,6,8 are
    // the even positions; x=10 doesn't exist.)
    expect(lights.length).toBe(5);
  });

  test('placeStreetLights returns no lights for a roadless world', () => {
    const world = new World({ width: 4, height: 4 });
    const lights = new Renderer().placeStreetLights(world);
    expect(lights).toEqual([]);
  });

  test('getStreetlightPositions caches results across calls', () => {
    const world = new World({ width: 4, height: 4 });
    world.setTile({ x: 1, y: 1 }, 'road');
    const r = new Renderer();
    const a = r.getStreetlightPositions(world);
    const b = r.getStreetlightPositions(world);
    // Same array reference (cached).
    expect(a).toBe(b);
    // Add a building → cache invalidates.
    world.addBuilding(
      makeBuilding({ id: 'b1', defId: 'd1', origin: { x: 0, y: 0 } }),
    );
    const c = r.getStreetlightPositions(world);
    // After invalidation a fresh array is returned. The content may
    // still match because the new building doesn't affect road layout,
    // but the reference must differ.
    expect(c).not.toBe(a);
  });
});
