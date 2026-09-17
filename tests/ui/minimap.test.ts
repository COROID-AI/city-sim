// @vitest-environment jsdom
/**
 * Unit suite for the minimap.
 *
 * The minimap is a compact second canvas that (a) always draws the *whole*
 * city - district fills, the road network, every building footprint and live
 * traffic dots - and (b) draws the rectangle of the area the browser window is
 * looking at, derived from the one authoritative camera. It also steers that
 * same camera on click/drag and clamps zoom gestures through the camera's own
 * API.
 *
 * These tests build the real seeded `CityWorld` plus a real `ViewportCamera`,
 * record every canvas call through the shared fake-canvas helper, and assert
 * the mapped geometry against the camera's own visible bounds.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeCanvas } from '../helpers/fake-canvas';
import type { ContextCall, FakeCanvasHandle } from '../helpers/fake-canvas';
import { createTestVehicle, createTestWorldMap } from '../helpers/sim-fixtures';
import { createViewportCamera } from '../../src/render/camera';
import type { ViewportCamera } from '../../src/render/camera';
import { createCityWorld } from '../../src/sim/world';
import type { CityWorld } from '../../src/sim/world';
import {
  MINIMAP_HEIGHT,
  MINIMAP_REDRAW_INTERVAL_MS,
  MINIMAP_WIDTH,
  Minimap,
  minimapPointToWorld,
  minimapRectToWorldRect,
  worldPointToMinimap,
  worldRectToMinimapRect,
} from '../../src/ui/minimap';
import type { MinimapRect } from '../../src/ui/minimap';

const VIEWPORT = { width: 960, height: 720 };

const activeMinimaps: Minimap[] = [];

interface Harness {
  readonly world: CityWorld;
  readonly camera: ViewportCamera;
  readonly canvas: FakeCanvasHandle;
  readonly minimap: Minimap;
}

/** Seeded city + camera + minimap over a recording canvas. */
function createHarness(options: { zoom?: number; pixelRatio?: number } = {}): Harness {
  const world = createCityWorld({ seed: 'minimap-unit' });
  const camera = createViewportCamera(world, VIEWPORT, { zoom: options.zoom ?? 2 });
  const canvas = createFakeCanvas({ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT });
  const minimap = new Minimap({
    world,
    camera,
    canvas: canvas.canvas,
    pixelRatio: options.pixelRatio ?? 1,
  });
  activeMinimaps.push(minimap);
  return { world, camera, canvas, minimap };
}

afterEach(() => {
  for (const minimap of activeMinimaps.splice(0)) {
    if (!minimap.isDisposed) {
      minimap.dispose();
    }
  }
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/* ---------------------------------------------------------------- helpers -- */

/** Finds a `fillRect`/`strokeRect` call drawn with exactly this rectangle. */
function findRect(calls: ContextCall[], expected: MinimapRect): ContextCall | undefined {
  return calls.find((call) => {
    const [x, y, width, height] = call.args as [number, number, number, number];
    return (
      Math.abs(x - expected.x) < 1e-9 &&
      Math.abs(y - expected.y) < 1e-9 &&
      Math.abs(width - expected.width) < 1e-9 &&
      Math.abs(height - expected.height) < 1e-9
    );
  });
}

/** The last `strokeRect` of a frame: district hairlines come first, the viewport frame last. */
function lastStrokeRect(canvas: FakeCanvasHandle): number[] {
  const call = canvas.callsFor('strokeRect').at(-1);
  if (!call) {
    throw new Error('the minimap recorded no strokeRect');
  }
  return call.args as number[];
}

function expectStrokeMatches(stroke: number[], rect: MinimapRect): void {
  expect(stroke[0]).toBeCloseTo(rect.x, 9);
  expect(stroke[1]).toBeCloseTo(rect.y, 9);
  expect(stroke[2]).toBeCloseTo(rect.width, 9);
  expect(stroke[3]).toBeCloseTo(rect.height, 9);
}

/**
 * Dispatches one gesture step as both pointer and mouse events. The minimap
 * listens to whichever pair the DOM supports, so dispatching both exercises the
 * registered path exactly once on every environment.
 */
function dispatchGesture(
  canvas: HTMLCanvasElement,
  type: 'down' | 'move' | 'up',
  clientX: number,
  clientY: number,
): void {
  for (const name of [`pointer${type}`, `mouse${type}`]) {
    canvas.dispatchEvent(
      new MouseEvent(name, { bubbles: true, cancelable: true, clientX, clientY }),
    );
  }
}

function dispatchWheel(canvas: HTMLCanvasElement, deltaY: number): void {
  const event = new Event('wheel', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'deltaY', { value: deltaY });
  canvas.dispatchEvent(event);
}

/* --------------------------------------------------------------- content -- */

describe('minimap overview content', () => {
  it('draws the whole city - districts, roads, buildings, traffic - on one compact canvas', () => {
    const { world, canvas, minimap } = createHarness();
    world.vehicles.push(
      createTestVehicle({ id: 'vehicle-a', position: { x: 40, y: 30 } }),
      createTestVehicle({ id: 'vehicle-b', position: { x: 120, y: 90 }, color: '#ffd479' }),
    );

    minimap.draw();

    // The overview is the full 5120x3840 world squeezed into the compact canvas.
    const view = minimap.view;
    expect(view).toEqual({
      width: MINIMAP_WIDTH,
      height: MINIMAP_HEIGHT,
      worldWidthInTiles: world.widthInTiles,
      worldHeightInTiles: world.heightInTiles,
    });
    expect(MINIMAP_WIDTH / MINIMAP_HEIGHT).toBeCloseTo(
      world.widthInTiles / world.heightInTiles,
      9,
    );
    expect(canvas.canvas.width).toBe(MINIMAP_WIDTH);
    expect(canvas.canvas.height).toBe(MINIMAP_HEIGHT);
    const wholeWorld = worldRectToMinimapRect(
      { x: 0, y: 0, width: world.widthInTiles, height: world.heightInTiles },
      view,
    );
    expect(wholeWorld.x).toBeCloseTo(0, 9);
    expect(wholeWorld.y).toBeCloseTo(0, 9);
    expect(wholeWorld.width).toBeCloseTo(MINIMAP_WIDTH, 9);
    expect(wholeWorld.height).toBeCloseTo(MINIMAP_HEIGHT, 9);

    // Districts: nine quarters, each filled at its mapped bounds in its own colour.
    expect(world.districts).toHaveLength(9);
    expect(minimap.districts).toHaveLength(9);
    const fills = canvas.callsFor('fillRect');
    for (const district of world.districts) {
      expect(findRect(fills, worldRectToMinimapRect(district.bounds, view))).toBeDefined();
      expect(
        canvas.writes.some(
          (write) => write.property === 'fillStyle' && write.value === district.color,
        ),
      ).toBe(true);
    }

    // Roads: exactly one stroked line per road segment, between mapped nodes.
    expect(canvas.countOf('stroke')).toBe(world.segments.length);
    const moves = canvas.callsFor('moveTo');
    const lines = canvas.callsFor('lineTo');
    expect(moves).toHaveLength(world.segments.length);
    expect(lines).toHaveLength(world.segments.length);
    const nodes = new Map(world.nodes.map((node) => [node.id, node]));
    for (const [index, segment] of world.segments.entries()) {
      const from = worldPointToMinimap(nodes.get(segment.fromNodeId)!, view);
      const to = worldPointToMinimap(nodes.get(segment.toNodeId)!, view);
      expect(moves[index].args[0]).toBeCloseTo(from.x, 9);
      expect(moves[index].args[1]).toBeCloseTo(from.y, 9);
      expect(lines[index].args[0]).toBeCloseTo(to.x, 9);
      expect(lines[index].args[1]).toBeCloseTo(to.y, 9);
    }

    // Buildings: every footprint of the 24+ building city is drawn scaled down.
    expect(world.buildings.length).toBeGreaterThanOrEqual(24);
    for (const building of world.buildings) {
      expect(findRect(fills, worldRectToMinimapRect(building.footprint, view))).toBeDefined();
      expect(
        canvas.writes.some(
          (write) => write.property === 'fillStyle' && write.value === building.color,
        ),
      ).toBe(true);
    }

    // Traffic: one dot per vehicle at its live position.
    const dots = canvas.callsFor('arc');
    expect(dots).toHaveLength(world.vehicles.length);
    for (const [index, vehicle] of world.vehicles.entries()) {
      const point = worldPointToMinimap(vehicle.position, view);
      expect(dots[index].args[0]).toBeCloseTo(point.x, 9);
      expect(dots[index].args[1]).toBeCloseTo(point.y, 9);
    }

    // Nothing spills outside the compact canvas: it really is an overview.
    for (const call of fills) {
      const [x, y, width, height] = call.args as [number, number, number, number];
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(x + width).toBeLessThanOrEqual(MINIMAP_WIDTH + 1e-9);
      expect(y + height).toBeLessThanOrEqual(MINIMAP_HEIGHT + 1e-9);
    }
  });

  it('reads traffic dots from the live vehicle collection on every frame', () => {
    const { world, canvas, minimap } = createHarness();
    const vehicle = createTestVehicle({ id: 'vehicle-live', position: { x: 16, y: 12 } });
    world.vehicles.push(vehicle);

    minimap.draw();
    const first = canvas.callsFor('arc')[0];
    const parked = worldPointToMinimap({ x: 16, y: 12 }, minimap.view);
    expect(first.args[0]).toBeCloseTo(parked.x, 9);
    expect(first.args[1]).toBeCloseTo(parked.y, 9);

    // The simulation moves the vehicle; the next frame picks the new position up.
    vehicle.position = { x: 96, y: 72 };
    const before = world.vehicles.map((moving) => ({ ...moving.position }));
    canvas.reset();
    minimap.draw();
    const second = canvas.callsFor('arc')[0];
    const moved = worldPointToMinimap({ x: 96, y: 72 }, minimap.view);
    expect(second.args[0]).toBeCloseTo(moved.x, 9);
    expect(second.args[1]).toBeCloseTo(moved.y, 9);
    expect(second.args[0]).not.toBeCloseTo(first.args[0] as number, 3);

    // Drawing is read-only: the minimap never owns or mutates the traffic.
    expect(world.vehicles.map((moving) => ({ ...moving.position }))).toEqual(before);
  });

  it('synthesises district fills when the world publishes no district metadata', () => {
    const world = createTestWorldMap();
    const camera = createViewportCamera(world, VIEWPORT, { zoom: 2 });
    const canvas = createFakeCanvas({ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT });
    const minimap = new Minimap({ world, camera, canvas: canvas.canvas, pixelRatio: 1 });
    activeMinimaps.push(minimap);

    expect('districts' in world).toBe(false);
    minimap.draw();

    // The mapping follows the declared extent, not a hard-coded city.
    expect(minimap.view.worldWidthInTiles).toBe(8);
    expect(minimap.view.worldHeightInTiles).toBe(8);
    expect(minimap.districts).toHaveLength(9);

    const quarters = minimap.districts.map((district) =>
      worldRectToMinimapRect(district.bounds, minimap.view),
    );
    const fills = canvas.callsFor('fillRect');
    for (const rect of quarters) {
      expect(findRect(fills, rect)).toBeDefined();
    }
    // The nine quarters tile the whole overview exactly, leaving no blank city.
    const covered = quarters.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    expect(covered).toBeCloseTo(MINIMAP_WIDTH * MINIMAP_HEIGHT, 6);

    // Roads, buildings and traffic of the structural world are drawn as well.
    expect(canvas.countOf('stroke')).toBe(world.segments.length);
    expect(world.buildings).toHaveLength(3);
    for (const building of world.buildings) {
      expect(findRect(fills, worldRectToMinimapRect(building.footprint, minimap.view))).toBeDefined();
    }
    expect(canvas.countOf('arc')).toBe(world.vehicles.length);
  });
});

/* -------------------------------------------------------------- rectangle -- */

describe('minimap viewport rectangle', () => {
  it('maps the camera visible bounds exactly at several camera states', () => {
    const { world, camera, canvas, minimap } = createHarness();
    expect(minimap.camera).toBe(camera);

    const states = [
      { zoom: 1, center: { x: 20, y: 100 } },
      { zoom: 2, center: { x: 80, y: 60 } },
      { zoom: 4, center: { x: 140, y: 20 } },
      { zoom: 8, center: { x: 44, y: 92 } },
      { zoom: camera.minAllowedZoom, center: { x: 10, y: 10 } },
    ];

    for (const state of states) {
      camera.zoomTo(state.zoom);
      camera.centerOn(state.center.x, state.center.y);

      const bounds = camera.visibleWorldBounds();
      const rect = minimap.viewportRect();

      // The rectangle is the camera's visible world bounds through the fixed scale.
      expect(rect.x).toBeCloseTo((bounds.x / world.widthInTiles) * MINIMAP_WIDTH, 9);
      expect(rect.y).toBeCloseTo((bounds.y / world.heightInTiles) * MINIMAP_HEIGHT, 9);
      expect(rect.width).toBeCloseTo((bounds.width / world.widthInTiles) * MINIMAP_WIDTH, 9);
      expect(rect.height).toBeCloseTo((bounds.height / world.heightInTiles) * MINIMAP_HEIGHT, 9);

      // Mapping the rectangle back reproduces the camera's own bounds.
      const roundTrip = minimapRectToWorldRect(rect, minimap.view);
      expect(roundTrip.x).toBeCloseTo(bounds.x, 9);
      expect(roundTrip.y).toBeCloseTo(bounds.y, 9);
      expect(roundTrip.width).toBeCloseTo(bounds.width, 9);
      expect(roundTrip.height).toBeCloseTo(bounds.height, 9);

      // Corner to corner: the two top-left corners and the two bottom-right ones agree.
      const topLeft = minimapPointToWorld({ x: rect.x, y: rect.y }, minimap.view);
      expect(topLeft.x).toBeCloseTo(bounds.x, 9);
      expect(topLeft.y).toBeCloseTo(bounds.y, 9);
      const bottomRight = worldPointToMinimap(
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        minimap.view,
      );
      expect(bottomRight.x).toBeCloseTo(rect.x + rect.width, 9);
      expect(bottomRight.y).toBeCloseTo(rect.y + rect.height, 9);

      // And that is exactly what the frame paints: district hairlines, then the viewport.
      canvas.reset();
      minimap.draw();
      const strokes = canvas.callsFor('strokeRect');
      expect(strokes).toHaveLength(minimap.districts.length + 1);
      expectStrokeMatches(lastStrokeRect(canvas), rect);

      // The frame never leaves the overview while zoomed in.
      expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.x + rect.width).toBeLessThanOrEqual(MINIMAP_WIDTH + 1e-9);
      expect(rect.y + rect.height).toBeLessThanOrEqual(MINIMAP_HEIGHT + 1e-9);
    }
  });

  it('covers the whole overview when the camera sees the whole city', () => {
    const world = createCityWorld({ seed: 'minimap-unit' });
    const camera = createViewportCamera(world, {
      width: world.widthInTiles * world.tileSize,
      height: world.heightInTiles * world.tileSize,
    });
    const canvas = createFakeCanvas({ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT });
    const minimap = new Minimap({ world, camera, canvas: canvas.canvas, pixelRatio: 1 });
    activeMinimaps.push(minimap);

    expect(camera.zoom).toBeCloseTo(camera.fitZoom, 12);
    const rect = minimap.viewportRect();
    expect(rect.x).toBeCloseTo(0, 9);
    expect(rect.y).toBeCloseTo(0, 9);
    expect(rect.width).toBeCloseTo(MINIMAP_WIDTH, 9);
    expect(rect.height).toBeCloseTo(MINIMAP_HEIGHT, 9);

    const back = minimapRectToWorldRect(rect, minimap.view);
    expect(back.x).toBeCloseTo(0, 9);
    expect(back.y).toBeCloseTo(0, 9);
    expect(back.width).toBeCloseTo(world.widthInTiles, 9);
    expect(back.height).toBeCloseTo(world.heightInTiles, 9);
  });

  it('follows camera pan, zoom and resize without stale geometry', () => {
    const { camera, canvas, minimap } = createHarness();
    minimap.draw();
    const before = lastStrokeRect(canvas);

    camera.centerOn(140, 30);
    camera.zoomTo(6);

    // Step just past the cadence window: the next frame must repaint with the
    // camera's new geometry.
    const due = (minimap.lastDrawAt ?? 0) + MINIMAP_REDRAW_INTERVAL_MS + 1;
    expect(minimap.update(due)).toBe(true);
    const after = lastStrokeRect(canvas);
    expect(after).not.toEqual(before);
    expectStrokeMatches(after, minimap.viewportRect());

    // Inside the cadence window nothing is repainted...
    const draws = minimap.drawCount;
    expect(minimap.update(due + 1)).toBe(false);
    expect(minimap.drawCount).toBe(draws);

    // ...while a viewport resize is reflected on the next frame.
    const resized = camera.resize({ width: 640, height: 480 });
    minimap.draw();
    expectStrokeMatches(lastStrokeRect(canvas), minimap.viewportRect());
    expect(minimap.viewportRect().height).toBeCloseTo(
      (resized.height / 120) * MINIMAP_HEIGHT,
      9,
    );
  });

  it('redraws at a low fixed cadence rather than once per frame', () => {
    const { minimap } = createHarness();
    minimap.draw(0);
    expect(minimap.drawCount).toBe(1);

    expect(minimap.update(100)).toBe(false);
    expect(minimap.update(MINIMAP_REDRAW_INTERVAL_MS - 1)).toBe(false);
    expect(minimap.update(MINIMAP_REDRAW_INTERVAL_MS)).toBe(true);
    expect(minimap.drawCount).toBe(2);
    expect(minimap.lastDrawAt).toBe(MINIMAP_REDRAW_INTERVAL_MS);

    // A 60 fps host loop therefore produces ~4 overview frames per second.
    let frames = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      if (minimap.update(MINIMAP_REDRAW_INTERVAL_MS + 1 + (frame * 1000) / 60)) {
        frames += 1;
      }
    }
    expect(frames).toBeGreaterThanOrEqual(3);
    expect(frames).toBeLessThanOrEqual(4);
  });

  it('repaints on its own cadence timer once attached', () => {
    vi.useFakeTimers();
    const { minimap } = createHarness();
    minimap.attach(document.body);
    expect(minimap.isAttached).toBe(true);
    expect(document.body.contains(minimap.canvas)).toBe(true);
    const attachedDraws = minimap.drawCount;

    // Attaching twice must not install a second timer.
    minimap.attach(document.body);

    vi.advanceTimersByTime(MINIMAP_REDRAW_INTERVAL_MS - 1);
    expect(minimap.drawCount).toBe(attachedDraws);
    vi.advanceTimersByTime(1);
    expect(minimap.drawCount).toBe(attachedDraws + 1);
    vi.advanceTimersByTime(MINIMAP_REDRAW_INTERVAL_MS * 2);
    expect(minimap.drawCount).toBe(attachedDraws + 3);

    minimap.dispose();
    vi.advanceTimersByTime(MINIMAP_REDRAW_INTERVAL_MS * 10);
    expect(minimap.drawCount).toBe(attachedDraws + 3);
  });
});

/* ------------------------------------------------------------- navigation -- */

describe('minimap navigation', () => {
  it('recentres the main camera on click and clamps to the world edges', () => {
    const { camera, canvas, minimap } = createHarness();
    minimap.attach(document.body);

    const point = { x: 165, y: 41 };
    dispatchGesture(canvas.canvas, 'down', point.x, point.y);
    dispatchGesture(canvas.canvas, 'up', point.x, point.y);

    const expected = minimapPointToWorld(point, minimap.view);
    expect(camera.center.x).toBeCloseTo(expected.x, 6);
    expect(camera.center.y).toBeCloseTo(expected.y, 6);
    expect(minimap.isDragging).toBe(false);

    // One camera only: navigation recentres the injected instance, never a copy.
    expect(minimap.camera).toBe(camera);
    expect(camera.zoom).toBe(2);

    // The rectangle followed the jump straight away, before the next frame.
    expectStrokeMatches(lastStrokeRect(canvas), minimap.viewportRect());
    const bounds = camera.visibleWorldBounds();
    expect(bounds.x).toBeCloseTo(expected.x - bounds.width / 2, 6);
    expect(bounds.y).toBeCloseTo(expected.y - bounds.height / 2, 6);

    // Clicking the very top-left corner clamps against the world edge.
    dispatchGesture(canvas.canvas, 'down', 0, 0);
    dispatchGesture(canvas.canvas, 'up', 0, 0);
    expect(camera.viewport.x).toBeCloseTo(0, 9);
    expect(camera.viewport.y).toBeCloseTo(0, 9);
    expect(camera.center.x).toBeCloseTo(camera.viewport.width / 2, 9);
    expect(camera.center.y).toBeCloseTo(camera.viewport.height / 2, 9);
  });

  it('steers the camera continuously while dragging and stops on release', () => {
    const { camera, canvas, minimap } = createHarness();
    minimap.attach(document.body);

    dispatchGesture(canvas.canvas, 'down', 110, 82);
    expect(minimap.isDragging).toBe(true);
    const pressedCenter = camera.center;

    dispatchGesture(canvas.canvas, 'move', 154, 33);
    const midExpected = minimapPointToWorld({ x: 154, y: 33 }, minimap.view);
    expect(camera.center.x).toBeCloseTo(midExpected.x, 6);
    expect(camera.center.y).toBeCloseTo(midExpected.y, 6);
    expect(camera.center).not.toEqual(pressedCenter);
    expectStrokeMatches(lastStrokeRect(canvas), minimap.viewportRect());

    // Dragging past the minimap edge keeps steering and clamps to the world.
    dispatchGesture(canvas.canvas, 'move', -40, 20);
    expect(camera.viewport.x).toBeCloseTo(0, 9);
    expectStrokeMatches(lastStrokeRect(canvas), minimap.viewportRect());

    dispatchGesture(canvas.canvas, 'up', -40, 20);
    expect(minimap.isDragging).toBe(false);
    const released = camera.center;
    dispatchGesture(canvas.canvas, 'move', 12, 12);
    expect(camera.center).toEqual(released);
  });

  it('clamps zoom gestures through the camera zoom range', () => {
    const { world, camera, canvas, minimap } = createHarness();
    minimap.attach(document.body);
    const start = minimap.viewportRect();

    dispatchWheel(canvas.canvas, -5000);
    expect(camera.zoom).toBe(camera.maxAllowedZoom);
    const zoomedIn = minimap.viewportRect();
    expect(zoomedIn.width).toBeLessThan(start.width);
    expectStrokeMatches(lastStrokeRect(canvas), zoomedIn);

    dispatchWheel(canvas.canvas, 5000);
    expect(camera.zoom).toBe(camera.minAllowedZoom);
    const zoomedOut = minimap.viewportRect();
    expect(zoomedOut.width).toBeGreaterThan(zoomedIn.width);
    expect(zoomedOut.width).toBeCloseTo(
      (camera.viewport.width / world.widthInTiles) * MINIMAP_WIDTH,
      9,
    );
    expect(zoomedOut.x).toBeGreaterThanOrEqual(-1e-9);
    expect(zoomedOut.x + zoomedOut.width).toBeLessThanOrEqual(MINIMAP_WIDTH + 1e-9);
  });

  it('maps a scaled CSS box back onto the logical overview grid', () => {
    const { world, camera, canvas, minimap } = createHarness();
    const box = { x: 30, y: 40, left: 30, top: 40, right: 470, bottom: 370, width: 440, height: 330 };
    canvas.canvas.getBoundingClientRect = () =>
      ({ ...box, toJSON: () => box }) as unknown as DOMRect;
    minimap.attach(document.body);

    // The centre of a 2x-scaled 440x330 box is the centre of the 220x165 grid.
    expect(minimap.clientToMinimapPoint(30 + 220, 40 + 165)).toEqual({ x: 110, y: 82.5 });

    dispatchGesture(canvas.canvas, 'down', 30 + 220, 40 + 165);
    dispatchGesture(canvas.canvas, 'up', 30 + 220, 40 + 165);
    // The world centre is clamped nowhere, so it is the viewport centre exactly.
    expect(camera.center.x).toBeCloseTo(world.widthInTiles / 2, 6);
    expect(camera.center.y).toBeCloseTo(world.heightInTiles / 2, 6);
  });

  it('scales the backing store without changing the logical grid', () => {
    const { canvas, minimap } = createHarness({ pixelRatio: 2 });
    expect(minimap.canvas.width).toBe(MINIMAP_WIDTH * 2);
    expect(minimap.canvas.height).toBe(MINIMAP_HEIGHT * 2);
    expect(canvas.canvas.style.width).toBe(`${MINIMAP_WIDTH}px`);
    expect(canvas.canvas.style.height).toBe(`${MINIMAP_HEIGHT}px`);

    minimap.draw();
    expect(canvas.callsFor('setTransform')[0].args).toEqual([2, 0, 0, 2, 0, 0]);

    const rect = minimap.viewportRect();
    expectStrokeMatches(lastStrokeRect(canvas), rect);
    expect(rect.x + rect.width).toBeLessThanOrEqual(MINIMAP_WIDTH + 1e-9);
  });
});

/* --------------------------------------------------------------- lifecycle -- */

describe('minimap lifecycle', () => {
  it('disposes listeners, timer and interaction state', () => {
    vi.useFakeTimers();
    const { camera, canvas, minimap } = createHarness();
    minimap.attach(document.body);
    const pressed = camera.center;

    minimap.dispose();
    expect(minimap.isDisposed).toBe(true);
    expect(minimap.isDragging).toBe(false);

    dispatchGesture(canvas.canvas, 'down', 10, 10);
    dispatchGesture(canvas.canvas, 'move', 20, 20);
    dispatchGesture(canvas.canvas, 'up', 20, 20);
    expect(camera.center).toEqual(pressed);

    const draws = minimap.drawCount;
    vi.advanceTimersByTime(MINIMAP_REDRAW_INTERVAL_MS * 4);
    expect(minimap.drawCount).toBe(draws);
    expect(canvas.countOf('clearRect')).toBeGreaterThan(0);

    expect(() => minimap.draw()).toThrow(/after dispose/);
    expect(minimap.update(0)).toBe(false);
    expect(() => minimap.dispose()).not.toThrow();
  });

  it('validates its inputs', () => {
    const world = createTestWorldMap();
    const camera = createViewportCamera(world, VIEWPORT);

    expect(() => new Minimap({ world: null as never, camera })).toThrow(TypeError);
    expect(() => new Minimap({ world, camera: null as never })).toThrow(TypeError);
    expect(() => new Minimap({ world, camera, width: 0 })).toThrow(RangeError);
    expect(() => new Minimap({ world, camera, height: -1 })).toThrow(RangeError);
    expect(() => new Minimap({ world, camera, redrawIntervalMs: 0 })).toThrow(RangeError);
    expect(() => new Minimap({ world, camera, pixelRatio: Number.NaN })).toThrow(RangeError);
  });
});
