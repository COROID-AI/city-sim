import { describe, expect, it } from 'vitest';

import { createTestWorldMap } from '../helpers/sim-fixtures';
import { MAX_ZOOM, MIN_ZOOM, createViewportCamera, worldExtentOf } from '../../src/render/camera';
import type { ViewportCamera } from '../../src/render/camera';
import type { Vec2, WorldMap } from '../../src/sim/types';

/**
 * Composition suite: the camera is driven by the world extent declared by the
 * domain contracts (`src/sim/types.ts`) and by nothing else. It never imports a
 * world generator, so this file proves the camera works over a real
 * `WorldMap`-shaped city while keeping the world module itself out of the loop.
 *
 * The suite exercises exactly the three consumers the plan promises:
 * rendering (world -> screen), picking (screen -> world) and the minimap
 * (the viewport rectangle in world coordinates).
 */

const VIEWPORT = { width: 320, height: 240 };

const renderSources = import.meta.glob('../../src/render/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function cameraSource(): string {
  const path = Object.keys(renderSources).find((candidate) => candidate.endsWith('/render/camera.ts'));
  expect(path, 'src/render/camera.ts must be readable as source text').toBeTypeOf('string');
  return renderSources[path as string];
}

/** Probe points drawn from the actual entities the renderer and picking see. */
function sampleWorldPoints(world: WorldMap): Vec2[] {
  const points: Vec2[] = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: world.widthInTiles, y: world.heightInTiles },
    { x: world.widthInTiles / 2, y: world.heightInTiles / 2 },
  ];
  for (const node of world.nodes) {
    points.push({ x: node.x, y: node.y });
  }
  for (const building of world.buildings) {
    const footprint = building.footprint;
    points.push(
      { x: footprint.x, y: footprint.y },
      { x: footprint.x + footprint.width, y: footprint.y + footprint.height },
      { x: footprint.x + footprint.width / 2, y: footprint.y + footprint.height / 2 },
    );
  }
  for (const citizen of world.citizens) {
    points.push({ x: citizen.position.x, y: citizen.position.y });
  }
  for (const vehicle of world.vehicles) {
    points.push({ x: vehicle.position.x, y: vehicle.position.y });
  }
  return points;
}

function expectInsideDeclaredExtents(camera: ViewportCamera, world: WorldMap): void {
  const rect = camera.viewport;
  expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.x + rect.width).toBeLessThanOrEqual(world.widthInTiles + 1e-9);
  expect(rect.y + rect.height).toBeLessThanOrEqual(world.heightInTiles + 1e-9);
}

describe('camera over the declared world extents', () => {
  it('builds itself from the domain contract extents alone', () => {
    const world = createTestWorldMap();

    expect(worldExtentOf(world)).toEqual({
      widthInTiles: world.widthInTiles,
      heightInTiles: world.heightInTiles,
      tileSize: world.tileSize,
    });

    const camera = createViewportCamera(world, VIEWPORT);

    expect(camera.worldBounds).toEqual({
      x: 0,
      y: 0,
      width: world.widthInTiles,
      height: world.heightInTiles,
    });
    expect(camera.center).toEqual({ x: world.widthInTiles / 2, y: world.heightInTiles / 2 });
    expect(camera.scale).toBe(world.tileSize * camera.zoom);
    expectInsideDeclaredExtents(camera, world);
  });

  it('follows a different declared tile size instead of a hard-coded city', () => {
    const scaled = createTestWorldMap({ tileSize: 48 });
    const camera = createViewportCamera(scaled, VIEWPORT, { zoom: 1 });

    expect(camera.world.tileSize).toBe(48);
    expect(camera.scale).toBe(48);
    expect(camera.viewport.width).toBeCloseTo(VIEWPORT.width / 48, 9);
    expectInsideDeclaredExtents(camera, scaled);
  });

  it('maps sampled world points through worldToScreen and back losslessly', () => {
    const world = createTestWorldMap();
    const points = sampleWorldPoints(world);
    expect(points.length).toBeGreaterThan(10);

    for (const zoom of [MIN_ZOOM, 0.5, 1, 2, 4, MAX_ZOOM]) {
      const camera = createViewportCamera(world, VIEWPORT, { zoom });
      expect(camera.zoom).toBeGreaterThanOrEqual(camera.fitZoom - 1e-9);
      expect(camera.zoom).toBeLessThanOrEqual(MAX_ZOOM + 1e-9);

      // Pan to an arbitrary in-bounds position: losslessness must not depend on
      // the camera happening to be centred.
      camera.panByScreen(37, -21);

      for (const worldPoint of points) {
        const screen = camera.worldToScreen(worldPoint);
        const roundTrip = camera.screenToWorld(screen);
        expect(roundTrip.x).toBeCloseTo(worldPoint.x, 8);
        expect(roundTrip.y).toBeCloseTo(worldPoint.y, 8);
      }
    }
  });

  it('never zooms out past the declared extents, even at the zoom floor', () => {
    const world = createTestWorldMap();
    const camera = createViewportCamera(world, VIEWPORT, { zoom: MIN_ZOOM });

    expect(camera.zoom).toBeCloseTo(camera.fitZoom, 12);
    expect(camera.viewport.width).toBeLessThanOrEqual(world.widthInTiles + 1e-9);
    expect(camera.viewport.height).toBeLessThanOrEqual(world.heightInTiles + 1e-9);
    expectInsideDeclaredExtents(camera, world);

    // At the fit zoom the whole city is inside the viewport rect.
    expect(camera.viewport.width).toBeCloseTo(world.widthInTiles, 9);
    expect(camera.viewport.height).toBeLessThanOrEqual(world.heightInTiles + 1e-9);
  });

  it('keeps the visible bounds inside the declared extents under long interaction', () => {
    const world = createTestWorldMap();
    const camera = createViewportCamera(world, VIEWPORT);
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let step = 0; step < 300; step += 1) {
      const operation = random();
      if (operation < 0.35) {
        camera.panByScreen((random() - 0.5) * 2000, (random() - 0.5) * 2000);
      } else if (operation < 0.7) {
        camera.zoomBy(0.25 + random() * 3, {
          x: random() * VIEWPORT.width,
          y: random() * VIEWPORT.height,
        });
      } else if (operation < 0.9) {
        camera.centerOn(random() * world.widthInTiles, random() * world.heightInTiles);
      } else {
        camera.resize({ width: 160 + random() * 640, height: 120 + random() * 480 });
      }

      expectInsideDeclaredExtents(camera, world);
      expect(camera.zoom).toBeGreaterThanOrEqual(camera.minAllowedZoom - 1e-9);
      expect(camera.zoom).toBeLessThanOrEqual(MAX_ZOOM + 1e-9);
    }
  });
});

describe('renderer, picking and minimap share one viewport', () => {
  it('culls with exactly the rectangle the minimap will draw', () => {
    const world = createTestWorldMap();
    const camera = createViewportCamera(world, VIEWPORT);
    camera.zoomTo(2);
    camera.panByScreen(24, -12);

    const minimap = { width: 160, height: 120 };
    const rect = camera.viewport;
    const minimapRect = {
      x: (rect.x / world.widthInTiles) * minimap.width,
      y: (rect.y / world.heightInTiles) * minimap.height,
      width: (rect.width / world.widthInTiles) * minimap.width,
      height: (rect.height / world.heightInTiles) * minimap.height,
    };

    // The culling query and the minimap read one and the same state.
    expect(camera.visibleWorldBounds()).toEqual(rect);
    expect(camera.viewportSize).toEqual(VIEWPORT);
    expect(camera.worldBounds).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    expect(minimapRect.x).toBeGreaterThanOrEqual(-1e-9);
    expect(minimapRect.y).toBeGreaterThanOrEqual(-1e-9);
    expect(minimapRect.x + minimapRect.width).toBeLessThanOrEqual(minimap.width + 1e-9);
    expect(minimapRect.y + minimapRect.height).toBeLessThanOrEqual(minimap.height + 1e-9);

    // Clicking the centre of the minimap viewport rectangle must look at the
    // same tile the screen centre already looks at.
    const clickedWorld = {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
    const screen = camera.worldToScreen(clickedWorld);
    expect(screen.x).toBeCloseTo(VIEWPORT.width / 2, 6);
    expect(screen.y).toBeCloseTo(VIEWPORT.height / 2, 6);
    expect(camera.screenToWorld(screen).x).toBeCloseTo(clickedWorld.x, 8);
  });

  it('picks a building footprint straight from a screen point', () => {
    const world = createTestWorldMap();
    const shop = world.buildings.find((building) => building.id === 'building-shop');
    expect(shop).toBeDefined();
    const footprint = shop!.footprint;

    const camera = createViewportCamera(world, VIEWPORT, { zoom: 4 });
    camera.centerOn(footprint.x + footprint.width / 2, footprint.y + footprint.height / 2);

    // The screen centre picks the tile the camera was centred on.
    const picked = camera.screenToWorld({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
    expect(picked.x).toBeCloseTo(footprint.x + footprint.width / 2, 6);
    expect(picked.y).toBeCloseTo(footprint.y + footprint.height / 2, 6);
    expect(picked.x).toBeGreaterThanOrEqual(footprint.x);
    expect(picked.x).toBeLessThanOrEqual(footprint.x + footprint.width);
    expect(picked.y).toBeGreaterThanOrEqual(footprint.y);
    expect(picked.y).toBeLessThanOrEqual(footprint.y + footprint.height);

    // And any building corner drawn through worldToScreen picks back to itself.
    for (const corner of [
      { x: footprint.x + 0.25, y: footprint.y + 0.25 },
      { x: footprint.x + footprint.width - 0.25, y: footprint.y + footprint.height - 0.25 },
    ]) {
      const screen = camera.worldToScreen(corner);
      const back = camera.screenToWorld(screen);
      expect(back.x).toBeCloseTo(corner.x, 8);
      expect(back.y).toBeCloseTo(corner.y, 8);
      expect(back.x).toBeGreaterThanOrEqual(footprint.x);
      expect(back.x).toBeLessThanOrEqual(footprint.x + footprint.width);
    }
  });
});

describe('phase independence', () => {
  it('imports the domain contracts but no world module', () => {
    const specifiers = [...cameraSource().matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(specifiers).toEqual(['../sim/types']);
    expect(specifiers.some((specifier) => /world/i.test(specifier))).toBe(false);
  });
});
