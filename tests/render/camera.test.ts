import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ViewportCamera,
  createViewportCamera,
  worldExtentOf,
} from '../../src/render/camera';
import type { ViewportSize, WorldExtent } from '../../src/render/camera';
import type { Vec2 } from '../../src/sim/types';

/**
 * Every `src/render` module loaded as source text, so the "pure data, no DOM"
 * boundary is asserted against the real files instead of a hand-maintained list.
 */
const renderSources = import.meta.glob('../../src/render/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const DOM_ONLY_GLOBALS =
  /\b(document|window|navigator|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|HTMLCanvasElement|HTMLDivElement|ImageData|OffscreenCanvas|CanvasRenderingContext2D|devicePixelRatio)\b/;

/** 256x192 tiles at 32 px/tile: far larger than the viewport in both axes. */
const BIG_WORLD: WorldExtent = { widthInTiles: 256, heightInTiles: 192, tileSize: 32 };
const VIEWPORT: ViewportSize = { width: 640, height: 480 };

/** World that fits the test viewport entirely, so the fit floor is exercised. */
const SMALL_WORLD: WorldExtent = { widthInTiles: 8, heightInTiles: 8, tileSize: 24 };

/** Deterministic LCG so "random" interaction sequences are reproducible. */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function expectInsideWorld(camera: ViewportCamera): void {
  const rect = camera.viewport;
  const bounds = camera.worldBounds;
  expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.width + 1e-9);
  expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.height + 1e-9);
  expect(rect.width).toBeLessThanOrEqual(bounds.width + 1e-9);
  expect(rect.height).toBeLessThanOrEqual(bounds.height + 1e-9);
}

describe('ViewportCamera construction', () => {
  it('publishes the zoom range as constants', () => {
    expect(MIN_ZOOM).toBeGreaterThan(0);
    expect(MAX_ZOOM).toBeGreaterThan(MIN_ZOOM);
    expect(DEFAULT_ZOOM).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(DEFAULT_ZOOM).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it('starts at zoom 1 centred on the world with the full world as bounds', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT);

    expect(camera.zoom).toBe(DEFAULT_ZOOM);
    expect(camera.scale).toBe(BIG_WORLD.tileSize);
    expect(camera.center).toEqual({ x: 128, y: 96 });
    expect(camera.worldBounds).toEqual({ x: 0, y: 0, width: 256, height: 192 });
    expect(camera.viewportSize).toEqual(VIEWPORT);
    // 640x480 px at 32 px/tile = 20x15 tiles, centred on (128, 96).
    expect(camera.viewport).toEqual({ x: 118, y: 88.5, width: 20, height: 15 });
    expect(camera.isDisposed).toBe(false);
  });

  it('accepts an explicit zoom, centre and zoom bounds', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, {
      zoom: 2,
      center: { x: 40, y: 30 },
      minZoom: 1,
      maxZoom: 3,
    });

    expect(camera.zoom).toBe(2);
    expect(camera.minZoom).toBe(1);
    expect(camera.maxZoom).toBe(3);
    expect(camera.scale).toBe(64);
    expect(camera.center).toEqual({ x: 40, y: 30 });
    expect(camera.viewport).toEqual({ x: 35, y: 26.25, width: 10, height: 7.5 });

    camera.zoomTo(100);
    expect(camera.zoom).toBe(3);
    camera.zoomTo(0.001);
    expect(camera.zoom).toBe(1);
  });

  it('builds from the declared world extent of a domain contract', () => {
    const extent = worldExtentOf({ widthInTiles: 12, heightInTiles: 9, tileSize: 16 });
    expect(extent).toEqual({ widthInTiles: 12, heightInTiles: 9, tileSize: 16 });

    const camera = createViewportCamera({ widthInTiles: 12, heightInTiles: 9, tileSize: 16 }, VIEWPORT);
    expect(camera.world).toEqual({ widthInTiles: 12, heightInTiles: 9, tileSize: 16 });
    expect(camera.worldBounds).toEqual({ x: 0, y: 0, width: 12, height: 9 });
    expect(camera.center).toEqual({ x: 6, y: 4.5 });
  });

  it('rejects unusable world extents, viewport sizes and options', () => {
    expect(() => new ViewportCamera({ ...BIG_WORLD, widthInTiles: 0 }, VIEWPORT)).toThrow(RangeError);
    expect(() => new ViewportCamera({ ...BIG_WORLD, tileSize: -8 }, VIEWPORT)).toThrow(RangeError);
    expect(() => new ViewportCamera(BIG_WORLD, { width: Number.NaN, height: 480 })).toThrow(RangeError);
    expect(() => new ViewportCamera(BIG_WORLD, { width: 640, height: 0 })).toThrow(RangeError);
    expect(() => new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom: Number.NaN })).toThrow(RangeError);
    expect(() => new ViewportCamera(BIG_WORLD, VIEWPORT, { minZoom: 0 })).toThrow(RangeError);
    expect(() =>
      new ViewportCamera(BIG_WORLD, VIEWPORT, { center: { x: Number.NaN, y: 1 } }),
    ).toThrow(RangeError);
  });
});

describe('world <-> screen transform', () => {
  it('is an exact inverse for probe points across the whole zoom range', () => {
    const probes: Vec2[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.25 },
      { x: 12.75, y: 41.5 },
      { x: 128, y: 96 },
      { x: 200.125, y: 130.75 },
      { x: 255.999, y: 191.999 },
    ];

    for (const zoom of [MIN_ZOOM, 0.4, DEFAULT_ZOOM, 2.5, MAX_ZOOM]) {
      const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom });
      camera.panByWorld(3.25, -2.5);
      expect(camera.zoom).toBeCloseTo(zoom, 12);

      for (const world of probes) {
        const screen = camera.worldToScreen(world);
        const roundTrip = camera.screenToWorld(screen);
        expect(roundTrip.x).toBeCloseTo(world.x, 9);
        expect(roundTrip.y).toBeCloseTo(world.y, 9);
      }

      // Every screen pixel round-trips too, not just world positions.
      for (const screen of [
        { x: 0, y: 0 },
        { x: VIEWPORT.width, y: VIEWPORT.height },
        { x: 123.5, y: 456.25 },
      ]) {
        const world = camera.screenToWorld(screen);
        const back = camera.worldToScreen(world);
        expect(back.x).toBeCloseTo(screen.x, 9);
        expect(back.y).toBeCloseTo(screen.y, 9);
      }
    }
  });

  it('maps the viewport origin to screen (0, 0) and the centre to the screen centre', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom: 2, center: { x: 70, y: 55 } });
    const rect = camera.viewport;

    expect(camera.worldToScreen({ x: rect.x, y: rect.y }).x).toBeCloseTo(0, 9);
    expect(camera.worldToScreen({ x: rect.x, y: rect.y }).y).toBeCloseTo(0, 9);
    expect(camera.worldToScreen(camera.center).x).toBeCloseTo(VIEWPORT.width / 2, 9);
    expect(camera.worldToScreen(camera.center).y).toBeCloseTo(VIEWPORT.height / 2, 9);
    expect(camera.screenToWorld({ x: 0, y: 0 })).toEqual({ x: rect.x, y: rect.y });
  });

  it('exposes the affine transform the renderer applies in one call', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom: 2, center: { x: 70, y: 55 } });
    const rect = camera.viewport;
    const transform = camera.transform;

    expect(transform.scale).toBe(64);
    expect(transform.offsetX).toBeCloseTo(-rect.x * 64, 9);
    expect(transform.offsetY).toBeCloseTo(-rect.y * 64, 9);

    // screen = world * scale + offset is the same mapping as worldToScreen.
    const probe: Vec2 = { x: 70, y: 55 };
    const screen = camera.worldToScreen(probe);
    expect(probe.x * transform.scale + transform.offsetX).toBeCloseTo(screen.x, 9);
    expect(probe.y * transform.scale + transform.offsetY).toBeCloseTo(screen.y, 9);
  });
});

describe('pan', () => {
  it('moves the viewport by the world delta equivalent of a screen drag', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom: 2, center: { x: 128, y: 96 } });
    const before = { ...camera.viewport };

    // 64 px per tile at zoom 2: dragging the pointer 128 px left pulls the
    // viewport 2 tiles east.
    camera.panByScreen(-128, 64);

    expect(camera.viewport.x).toBeCloseTo(before.x + 2, 9);
    expect(camera.viewport.y).toBeCloseTo(before.y - 1, 9);
    expect(camera.center).toEqual({ x: 130, y: 95 });
    expect(camera.viewport.width).toBeCloseTo(before.width, 9);
  });

  it('moves the viewport by a world-space delta', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom: 1, center: { x: 128, y: 96 } });
    const before = { ...camera.viewport };

    camera.panByWorld(3, -2);

    expect(camera.viewport.x).toBeCloseTo(before.x + 3, 9);
    expect(camera.viewport.y).toBeCloseTo(before.y - 2, 9);
    expect(camera.viewport.width).toBeCloseTo(before.width, 9);
    expect(camera.viewport.height).toBeCloseTo(before.height, 9);
  });

  it('clamps panning at every world edge', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom: 1 });

    camera.panByWorld(-10_000, -10_000);
    expect(camera.viewport.x).toBe(0);
    expect(camera.viewport.y).toBe(0);
    expectInsideWorld(camera);

    camera.panByWorld(10_000, 10_000);
    expect(camera.viewport.x + camera.viewport.width).toBeCloseTo(256, 9);
    expect(camera.viewport.y + camera.viewport.height).toBeCloseTo(192, 9);
    expectInsideWorld(camera);

    camera.centerOn(-50, 500);
    expect(camera.viewport.x).toBe(0);
    expect(camera.viewport.y + camera.viewport.height).toBeCloseTo(192, 9);
    expectInsideWorld(camera);

    expect(() => camera.panByWorld(Number.POSITIVE_INFINITY, 0)).toThrow(RangeError);
    expect(() => camera.panByScreen(Number.NaN, 0)).toThrow(RangeError);
  });
});

describe('zoom', () => {
  it('anchors zoom on the screen cursor, not on the origin', () => {
    const anchor: Vec2 = { x: 90, y: 300 };
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom: 1, center: { x: 128, y: 96 } });
    const worldUnderCursor = camera.screenToWorld(anchor);
    const otherPointBefore = camera.screenToWorld({ x: 500, y: 100 });

    camera.zoomBy(1.6, anchor);

    expect(camera.zoom).toBeCloseTo(1.6, 12);
    expect(camera.screenToWorld(anchor).x).toBeCloseTo(worldUnderCursor.x, 9);
    expect(camera.screenToWorld(anchor).y).toBeCloseTo(worldUnderCursor.y, 9);
    // Everything else moves: this is not a centre- or origin-anchored zoom.
    expect(camera.screenToWorld({ x: 500, y: 100 }).x).not.toBeCloseTo(otherPointBefore.x, 3);

    const originAnchored = new ViewportCamera(BIG_WORLD, VIEWPORT, {
      zoom: 1,
      center: { x: 128, y: 96 },
    });
    originAnchored.zoomBy(1.6, { x: 0, y: 0 });
    expect(camera.viewport.x).not.toBeCloseTo(originAnchored.viewport.x, 6);
    expectInsideWorld(camera);
  });

  it('keeps the viewport centre fixed when zooming with the default anchor', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom: 1, center: { x: 128, y: 96 } });

    camera.zoomBy(2);

    expect(camera.zoom).toBe(2);
    expect(camera.center).toEqual({ x: 128, y: 96 });
    expect(camera.worldToScreen(camera.center).x).toBeCloseTo(VIEWPORT.width / 2, 9);
    expect(camera.worldToScreen(camera.center).y).toBeCloseTo(VIEWPORT.height / 2, 9);
  });

  it('clamps zoom into the allowed range and keeps the viewport inside the world', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT);

    camera.zoomTo(MIN_ZOOM * 0.01, { x: 0, y: 0 });
    expect(camera.zoom).toBeCloseTo(MIN_ZOOM, 12);
    expect(camera.viewport.width).toBeCloseTo(80, 9);
    expect(camera.viewport.height).toBeCloseTo(60, 9);
    expectInsideWorld(camera);

    camera.zoomTo(MAX_ZOOM * 100, { x: VIEWPORT.width, y: VIEWPORT.height });
    expect(camera.zoom).toBeCloseTo(MAX_ZOOM, 12);
    expect(camera.viewport.width).toBeCloseTo(2.5, 9);
    expect(camera.viewport.height).toBeCloseTo(1.875, 9);
    expectInsideWorld(camera);

    expect(() => camera.zoomBy(0)).toThrow(RangeError);
    expect(() => camera.zoomTo(Number.NaN)).toThrow(RangeError);
  });

  it('never zooms out past the zoom at which the whole city fits', () => {
    const camera = new ViewportCamera(SMALL_WORLD, VIEWPORT);

    // 640 px / 192 world px is the limiting ratio for an 8x8 tile world.
    expect(camera.fitZoom).toBeCloseTo(640 / (8 * 24), 12);
    expect(camera.minAllowedZoom).toBeCloseTo(camera.fitZoom, 12);
    expect(camera.minAllowedZoom).toBeGreaterThan(MIN_ZOOM);
    expect(camera.zoom).toBeCloseTo(camera.fitZoom, 12);

    camera.zoomTo(MIN_ZOOM, { x: 0, y: 0 });
    expect(camera.zoom).toBeCloseTo(camera.fitZoom, 12);

    // The whole city fills the viewport: 8 tiles wide, 6 tall, flush with the
    // world edges on the axis that limits the fit.
    expect(camera.viewport.x).toBe(0);
    expect(camera.viewport.width).toBeCloseTo(8, 9);
    expect(camera.viewport.height).toBeCloseTo(6, 9);
    expect(camera.viewport.y).toBeCloseTo(1, 9);
    expectInsideWorld(camera);
  });

  it('stays inside the world at min and max zoom for extreme pans', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT);

    for (const zoom of [MIN_ZOOM, MAX_ZOOM]) {
      camera.zoomTo(zoom);
      for (const [dx, dy] of [
        [-1e6, -1e6],
        [1e6, 1e6],
        [-1e6, 1e6],
        [1e6, -1e6],
        [0, 0],
      ]) {
        camera.panByWorld(dx, dy);
        expect(camera.zoom).toBeCloseTo(zoom, 12);
        expectInsideWorld(camera);
      }
    }
  });
});

describe('resize', () => {
  it('keeps the world-space centre fixed through grow and shrink', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom: 1 });
    const centerBefore = camera.center;

    camera.resize({ width: 960, height: 720 });
    expect(camera.center).toEqual(centerBefore);
    expect(camera.viewportSize).toEqual({ width: 960, height: 720 });
    expect(camera.scale).toBe(32);
    expect(camera.viewport.width).toBeCloseTo(30, 9);
    expect(camera.viewport.height).toBeCloseTo(22.5, 9);
    expect(camera.worldToScreen(centerBefore).x).toBeCloseTo(480, 9);
    expect(camera.worldToScreen(centerBefore).y).toBeCloseTo(360, 9);

    camera.resize({ width: 320, height: 240 });
    expect(camera.center).toEqual(centerBefore);
    expect(camera.viewportSize).toEqual({ width: 320, height: 240 });
    expect(camera.viewport.width).toBeCloseTo(10, 9);
    expect(camera.viewport.height).toBeCloseTo(7.5, 9);

    // The transform is re-derived from the new rect and stays consistent.
    const corner = { x: camera.viewport.x, y: camera.viewport.y };
    expect(camera.worldToScreen(corner).x).toBeCloseTo(0, 9);
    expect(camera.worldToScreen(corner).y).toBeCloseTo(0, 9);
    expect(camera.screenToWorld({ x: 10, y: 10 }).x).toBeCloseTo(camera.viewport.x + 10 / 32, 9);
    expect(camera.screenToWorld({ x: 10, y: 10 }).y).toBeCloseTo(camera.viewport.y + 10 / 32, 9);
    expectInsideWorld(camera);
  });

  it('keeps the centre fixed and re-derives a consistent rect when attached', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom: 1, center: { x: 60, y: 70 } });

    camera.attach({ width: 800, height: 600 });

    expect(camera.viewportSize).toEqual({ width: 800, height: 600 });
    expect(camera.center).toEqual({ x: 60, y: 70 });
    expect(camera.viewport.width).toBeCloseTo(25, 9);
    expect(camera.viewport.height).toBeCloseTo(18.75, 9);
    expect(camera.worldToScreen(camera.center).x).toBeCloseTo(400, 9);
    expect(camera.worldToScreen(camera.center).y).toBeCloseTo(300, 9);
  });

  it('raises zoom only when the fit floor moves past it', () => {
    const camera = new ViewportCamera(SMALL_WORLD, { width: 200, height: 150 });
    expect(camera.zoom).toBeCloseTo(200 / 192, 9);

    camera.zoomTo(1.5);
    expect(camera.zoom).toBeCloseTo(1.5, 12);

    camera.resize({ width: 600, height: 450 });
    expect(camera.fitZoom).toBeCloseTo(3.125, 9);
    expect(camera.zoom).toBeCloseTo(3.125, 9);
    expect(camera.center).toEqual({ x: 4, y: 4 });
    expectInsideWorld(camera);

    // Shrinking again leaves the zoom alone: the floor only moves down.
    camera.resize({ width: 200, height: 150 });
    expect(camera.zoom).toBeCloseTo(3.125, 9);
    expectInsideWorld(camera);
  });

  it('rejects unusable sizes', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT);
    expect(() => camera.resize({ width: 0, height: 480 })).toThrow(RangeError);
    expect(() => camera.resize({ width: 640, height: Number.NaN })).toThrow(RangeError);
  });
});

describe('viewport as the single source of truth', () => {
  it('hands the same viewport object to the minimap and the picking layer', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT);
    const rect = camera.viewport;

    expect(camera.viewport).toBe(rect);
    expect(camera.visibleWorldBounds()).toEqual(rect);
    expect(camera.visibleWorldBounds()).not.toBe(rect);

    camera.panByWorld(5, 0);
    expect(rect.x).toBeCloseTo(123, 9);
    expect(camera.viewport).toBe(rect);
    expect(camera.visibleWorldBounds().x).toBeCloseTo(123, 9);

    // Picking reads the same state: the viewport corner is screen (0, 0).
    const picked = camera.screenToWorld({ x: 0, y: 0 });
    expect(picked.x).toBeCloseTo(rect.x, 9);
    expect(picked.y).toBeCloseTo(rect.y, 9);

    // A private copy cannot corrupt the camera.
    const copy = camera.visibleWorldBounds();
    copy.x = -999;
    copy.width = 1;
    expect(camera.viewport.x).toBeCloseTo(123, 9);
    expect(camera.viewport.width).toBeCloseTo(20, 9);
  });

  it('re-clamps in update() and returns the authoritative rect', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT, { zoom: MIN_ZOOM });
    camera.panByWorld(10_000, 10_000);

    expect(camera.update()).toBe(camera.viewport);
    expectInsideWorld(camera);
  });
});

describe('lifecycle', () => {
  it('disposes idempotently and refuses further mutation', () => {
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT);
    const rect = camera.visibleWorldBounds();

    camera.dispose();
    camera.dispose();

    expect(camera.isDisposed).toBe(true);
    expect(camera.visibleWorldBounds()).toEqual(rect);
    expect(camera.update()).toBe(camera.viewport);
    expect(camera.worldToScreen({ x: 1, y: 1 }).x).toBeCloseTo(
      (1 - rect.x) * BIG_WORLD.tileSize,
      9,
    );

    expect(() => camera.panByWorld(1, 0)).toThrow(/dispose/);
    expect(() => camera.panByScreen(1, 0)).toThrow(/dispose/);
    expect(() => camera.zoomTo(2)).toThrow(/dispose/);
    expect(() => camera.zoomBy(2)).toThrow(/dispose/);
    expect(() => camera.centerOn(1, 1)).toThrow(/dispose/);
    expect(() => camera.resize({ width: 100, height: 100 })).toThrow(/dispose/);
    expect(() => camera.attach({ width: 100, height: 100 })).toThrow(/dispose/);
  });
});

describe('invariants under long interaction sequences', () => {
  it('keeps the viewport inside the world and the transform exact', () => {
    const random = createSeededRandom(20240917);
    const camera = new ViewportCamera(BIG_WORLD, VIEWPORT);

    for (let step = 0; step < 400; step += 1) {
      const operation = random();
      if (operation < 0.4) {
        camera.panByScreen((random() - 0.5) * 4000, (random() - 0.5) * 4000);
      } else if (operation < 0.65) {
        camera.zoomBy(0.2 + random() * 4, {
          x: random() * VIEWPORT.width,
          y: random() * VIEWPORT.height,
        });
      } else if (operation < 0.85) {
        camera.centerOn(random() * 256, random() * 192);
      } else {
        camera.resize({ width: 200 + random() * 1200, height: 150 + random() * 900 });
      }

      expectInsideWorld(camera);
      expect(camera.zoom).toBeGreaterThanOrEqual(camera.minAllowedZoom - 1e-9);
      expect(camera.zoom).toBeLessThanOrEqual(camera.maxAllowedZoom + 1e-9);

      const probe: Vec2 = { x: random() * 256, y: random() * 192 };
      const roundTrip = camera.screenToWorld(camera.worldToScreen(probe));
      expect(roundTrip.x).toBeCloseTo(probe.x, 8);
      expect(roundTrip.y).toBeCloseTo(probe.y, 8);
    }
  });
});

describe('src/render/camera.ts module boundary', () => {
  function cameraSource(): string {
    const path = Object.keys(renderSources).find((candidate) =>
      candidate.endsWith('/render/camera.ts'),
    );
    expect(path, 'src/render/camera.ts must be readable as source text').toBeTypeOf('string');
    return renderSources[path as string];
  }

  it('is pure data: it never references browser or canvas globals', () => {
    const match = DOM_ONLY_GLOBALS.exec(cameraSource());
    expect(match?.[1], `camera.ts must stay DOM-free but references "${match?.[1]}"`).toBeUndefined();
  });

  it('imports only the domain contracts, keeping render tasks independent', () => {
    const specifiers = [...cameraSource().matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(specifiers).toEqual(['../sim/types']);
  });
});
