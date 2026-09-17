// @vitest-environment jsdom
/**
 * Composition suite: the minimap running on top of the live simulation.
 *
 * This suite wires the upstream pieces the way the app composition will - the
 * seeded `CityWorld`, a `SimulationEngine` with its fixed-step clock, the
 * citizens roster and the vehicle fleet, one `ViewportCamera` and the
 * `Minimap` - and then asserts the integrated behaviour the product requires:
 *
 * - the overview shows the whole city (districts, roads, buildings) with the
 *   seeded world's own traffic drawn as live dots;
 * - the viewport rectangle is the mapped camera visible bounds, and follows the
 *   camera as it pans across the city while days of traffic drive the roads;
 * - drawing never mutates the simulation: the minimap reads the vehicle fleet
 *   at draw time without owning it.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeCanvas } from '../helpers/fake-canvas';
import type { ContextCall, FakeCanvasHandle } from '../helpers/fake-canvas';
import { createSimFixture } from '../helpers/sim-fixtures';
import { CitizensSystem } from '../../src/sim/citizens';
import { MIN_ACTIVE_VEHICLES, VehiclesSystem } from '../../src/sim/vehicles';
import { createCityWorld } from '../../src/sim/world';
import type { CityWorld } from '../../src/sim/world';
import { createViewportCamera } from '../../src/render/camera';
import type { ViewportCamera } from '../../src/render/camera';
import {
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
  Minimap,
  worldRectToMinimapRect,
} from '../../src/ui/minimap';
import type { MinimapRect } from '../../src/ui/minimap';
import type { SimFixture } from '../helpers/sim-fixtures';

const VIEWPORT = { width: 1280, height: 960 };

interface Composition {
  readonly fixture: SimFixture;
  readonly world: CityWorld;
  readonly citizens: CitizensSystem;
  readonly vehicles: VehiclesSystem;
  readonly camera: ViewportCamera;
  readonly canvas: FakeCanvasHandle;
  readonly minimap: Minimap;
}

const activeMinimaps: Minimap[] = [];

/** Seeded city + live sim systems + camera + minimap, mounted in the document. */
function createComposition(): Composition {
  const fixture = createSimFixture({ seed: 'minimap-composition', startHour: 0, minutesPerTick: 1 });
  const world = createCityWorld({ seed: fixture.rng.seed });
  const citizens = new CitizensSystem({ world, count: 72, seed: fixture.rng.seed });
  const vehicles = new VehiclesSystem({ world, citizens });
  // The integration owner path: engine attaches the population, then traffic.
  fixture.engine.attach(citizens);
  fixture.engine.attach(vehicles);

  const camera = createViewportCamera(world, VIEWPORT, { zoom: 0.6 });
  const canvas = createFakeCanvas({ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT });
  const minimap = new Minimap({ world, camera, canvas: canvas.canvas, pixelRatio: 1 });
  minimap.attach(document.body);
  activeMinimaps.push(minimap);

  return { fixture, world, citizens, vehicles, camera, canvas, minimap };
}

afterEach(() => {
  for (const minimap of activeMinimaps.splice(0)) {
    if (!minimap.isDisposed) {
      minimap.dispose();
    }
  }
  document.body.innerHTML = '';
});

/* ---------------------------------------------------------------- helpers -- */

function findRect(calls: ContextCall[], expected: MinimapRect): boolean {
  return calls.some((call) => {
    const [x, y, width, height] = call.args as [number, number, number, number];
    return (
      Math.abs(x - expected.x) < 1e-9 &&
      Math.abs(y - expected.y) < 1e-9 &&
      Math.abs(width - expected.width) < 1e-9 &&
      Math.abs(height - expected.height) < 1e-9
    );
  });
}

function lastStrokeRect(canvas: FakeCanvasHandle): number[] {
  const call = canvas.callsFor('strokeRect').at(-1);
  if (!call) {
    throw new Error('the minimap recorded no strokeRect');
  }
  return call.args as number[];
}

function expectFrameMatchesCamera(composition: Composition): MinimapRect {
  const { camera, world, canvas, minimap } = composition;
  const bounds = camera.visibleWorldBounds();
  const rect = minimap.viewportRect();

  expect(rect.x).toBeCloseTo((bounds.x / world.widthInTiles) * MINIMAP_WIDTH, 9);
  expect(rect.y).toBeCloseTo((bounds.y / world.heightInTiles) * MINIMAP_HEIGHT, 9);
  expect(rect.width).toBeCloseTo((bounds.width / world.widthInTiles) * MINIMAP_WIDTH, 9);
  expect(rect.height).toBeCloseTo((bounds.height / world.heightInTiles) * MINIMAP_HEIGHT, 9);

  // The frame actually painted is that rectangle, not a cached copy.
  const stroke = lastStrokeRect(canvas);
  expect(stroke[0]).toBeCloseTo(rect.x, 9);
  expect(stroke[1]).toBeCloseTo(rect.y, 9);
  expect(stroke[2]).toBeCloseTo(rect.width, 9);
  expect(stroke[3]).toBeCloseTo(rect.height, 9);

  // ...and it never leaves the overview canvas.
  expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.x + rect.width).toBeLessThanOrEqual(MINIMAP_WIDTH + 1e-9);
  expect(rect.y + rect.height).toBeLessThanOrEqual(MINIMAP_HEIGHT + 1e-9);
  return rect;
}

/* ------------------------------------------------------------------ tests -- */

describe('minimap over the live seeded city', () => {
  it('draws the whole city overview with a rectangle on the visible part of it', () => {
    const composition = createComposition();
    const { fixture, world, canvas, minimap } = composition;

    // Morning commute: the fleet is on the road by now.
    fixture.advanceMinutes(7 * 60);
    canvas.reset();
    minimap.draw();

    // Compact canvas, whole 5120x3840 world mapped onto it.
    expect(canvas.canvas.width).toBe(MINIMAP_WIDTH);
    expect(canvas.canvas.height).toBe(MINIMAP_HEIGHT);
    const wholeWorld = worldRectToMinimapRect(
      { x: 0, y: 0, width: world.widthInTiles, height: world.heightInTiles },
      minimap.view,
    );
    expect(wholeWorld.width).toBeCloseTo(MINIMAP_WIDTH, 9);
    expect(wholeWorld.height).toBeCloseTo(MINIMAP_HEIGHT, 9);

    // The overview layers are all present.
    expect(minimap.districts).toHaveLength(9);
    expect(world.segments.length).toBeGreaterThan(0);
    expect(world.buildings.length).toBeGreaterThanOrEqual(24);
    expect(world.vehicles.length).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);

    const fills = canvas.callsFor('fillRect');
    for (const district of world.districts) {
      expect(findRect(fills, worldRectToMinimapRect(district.bounds, minimap.view))).toBe(true);
    }
    for (const building of world.buildings) {
      expect(findRect(fills, worldRectToMinimapRect(building.footprint, minimap.view))).toBe(true);
    }
    expect(canvas.countOf('stroke')).toBeGreaterThanOrEqual(world.segments.length);

    // One live dot per vehicle, inside the overview.
    const dots = canvas.callsFor('arc');
    expect(dots).toHaveLength(world.vehicles.length);
    for (const [index, vehicle] of world.vehicles.entries()) {
      const expected = worldPointToMinimapFor(vehicle.position, composition);
      expect(dots[index].args[0]).toBeCloseTo(expected.x, 9);
      expect(dots[index].args[1]).toBeCloseTo(expected.y, 9);
    }

    // The camera sees a slice of the city, and the rectangle shows exactly it.
    const rect = expectFrameMatchesCamera(composition);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.width).toBeLessThan(MINIMAP_WIDTH);
    expect(rect.height).toBeLessThan(MINIMAP_HEIGHT);
  });

  it('keeps the rectangle on the visible city while days of traffic roll past', () => {
    const composition = createComposition();
    const { fixture, world, camera, canvas, minimap } = composition;

    fixture.advanceMinutes(7 * 60);

    interface Frame {
      readonly hour: number;
      readonly rect: MinimapRect;
      readonly dots: ReadonlyMap<string, { x: number; y: number }>;
    }

    const frames: Frame[] = [];
    for (let step = 0; step < 24; step += 1) {
      fixture.advanceMinutes(60);

      // The camera pans across the city over the simulated day.
      const t = step / 23;
      camera.centerOn(20 + t * 120, 55 + Math.sin(t * Math.PI * 2) * 45);

      const trafficBefore = world.vehicles.map((vehicle) => ({ ...vehicle.position }));
      canvas.reset();
      minimap.draw();

      // Drawing reads traffic, it never owns or moves it.
      expect(world.vehicles.map((vehicle) => ({ ...vehicle.position }))).toEqual(trafficBefore);

      const rect = expectFrameMatchesCamera(composition);
      const dots = canvas.callsFor('arc');
      expect(dots).toHaveLength(world.vehicles.length);
      expect(dots.length).toBeGreaterThan(0);

      frames.push({
        hour: fixture.clock.time.hour,
        rect,
        dots: new Map(
          world.vehicles.map((vehicle, index) => [
            vehicle.id,
            { x: dots[index].args[0] as number, y: dots[index].args[1] as number },
          ]),
        ),
      });
    }

    expect(frames).toHaveLength(24);

    // The rectangle moved with the camera instead of sticking to one place.
    const distinctRects = new Set(
      frames.map((frame) => `${frame.rect.x.toFixed(3)},${frame.rect.y.toFixed(3)}`),
    );
    expect(distinctRects.size).toBeGreaterThanOrEqual(12);

    // Traffic is genuinely moving between frames, and the minimap shows it.
    let framesWithMovement = 0;
    for (let index = 1; index < frames.length; index += 1) {
      const previous = frames[index - 1];
      const current = frames[index];
      let moved = false;
      for (const [vehicleId, point] of current.dots) {
        const before = previous.dots.get(vehicleId);
        if (before && (Math.abs(before.x - point.x) > 0.02 || Math.abs(before.y - point.y) > 0.02)) {
          moved = true;
          break;
        }
      }
      if (moved) {
        framesWithMovement += 1;
      }
    }
    expect(framesWithMovement).toBeGreaterThanOrEqual(18);

    // During service hours the overview carries the full commuter fleet.
    const peakFrames = frames.filter((frame) => frame.hour >= 7 && frame.hour <= 21);
    expect(peakFrames.length).toBeGreaterThan(0);
    for (const frame of peakFrames) {
      expect(frame.dots.size).toBeGreaterThanOrEqual(MIN_ACTIVE_VEHICLES);
    }

    // And the minimap still mirrors the one camera at the end of the run.
    expect(minimap.camera).toBe(camera);
    expect(minimap.world).toBe(world);
  });
});

/** Local mapping helper so the assertions read like the class's own maths. */
function worldPointToMinimapFor(
  point: { x: number; y: number },
  composition: Composition,
): { x: number; y: number } {
  const view = composition.minimap.view;
  return {
    x: (point.x / view.worldWidthInTiles) * view.width,
    y: (point.y / view.worldHeightInTiles) * view.height,
  };
}
