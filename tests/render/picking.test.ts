/**
 * Picking tests: screen clicks resolved to the nearest building, citizen or
 * vehicle through the real camera transform.
 *
 * The suite builds the same `ViewportCamera` the renderer uses over a small
 * hand-placed world, projects known world points into screen space, and asserts
 * the documented rules: the nearest entity wins, agents beat buildings on a
 * distance tie, the tolerance is zoom-aware (constant on screen, shrinking in
 * world tiles as you zoom in), clicks off every entity resolve to ground, and
 * the result never depends on array order.
 */

import { describe, expect, it } from 'vitest';

import { createViewportCamera } from '../../src/render/camera';
import type { ViewportCamera } from '../../src/render/camera';
import {
  BUILDING_PICK_PRIORITY,
  CITIZEN_PICK_PRIORITY,
  DEFAULT_PICK_TOLERANCE_PX,
  EntityPicker,
  MAX_PICK_TOLERANCE_PX,
  MIN_PICK_TOLERANCE_PX,
  VEHICLE_PICK_PRIORITY,
  createEntityPicker,
  distanceToRect,
  isEntityPick,
  pickToleranceTiles,
  resolveTolerance,
} from '../../src/render/picking';
import type { PickingWorld } from '../../src/render/picking';
import { createTestBuilding, createTestCitizen, createTestVehicle } from '../helpers/sim-fixtures';

/** Tiles per world unit used by this suite's camera. */
const TILE_SIZE = 24;
/** Host viewport in logical pixels; 8x8 tiles are visible at zoom 1. */
const VIEWPORT = { width: 192, height: 192 } as const;
/** World extent (tiles) of the suite's camera. */
const WORLD_EXTENT = { widthInTiles: 16, heightInTiles: 16, tileSize: TILE_SIZE } as const;
/** Zoom 1 tolerance in world tiles: 16px over 24px per tile. */
const TOLERANCE_AT_ZOOM_1 = DEFAULT_PICK_TOLERANCE_PX / TILE_SIZE;

/** Hand-placed world: two citizens, one vehicle, two buildings. */
function createWorld(overrides: Partial<PickingWorld> = {}): PickingWorld {
  return {
    buildings: [
      createTestBuilding({ id: 'building-home', footprint: { x: 5, y: 5, width: 2, height: 2 } }),
      createTestBuilding({ id: 'building-shop', kind: 'shop', footprint: { x: 11, y: 5, width: 2, height: 2 } }),
    ],
    citizens: [
      createTestCitizen({ id: 'citizen-1', position: { x: 8, y: 8 } }),
      createTestCitizen({ id: 'citizen-2', position: { x: 5.5, y: 5.5 } }),
    ],
    vehicles: [createTestVehicle({ id: 'vehicle-1', position: { x: 10.5, y: 10.5 } })],
    ...overrides,
  };
}

function createCamera(zoom = 1): ViewportCamera {
  return createViewportCamera(WORLD_EXTENT, VIEWPORT, { zoom, center: { x: 8, y: 8 } });
}

interface Harness {
  readonly camera: ViewportCamera;
  readonly world: PickingWorld;
  readonly picker: EntityPicker;
}

function createHarness(zoom = 1, world: PickingWorld = createWorld()): Harness {
  const camera = createCamera(zoom);
  return { camera, world, picker: new EntityPicker({ camera, world }) };
}

function expectClose(actual: number, expected: number, digits = 6): void {
  expect(actual).toBeCloseTo(expected, digits);
}

describe('EntityPicker geometry', () => {
  it('measures points against building footprints', () => {
    const rect = { x: 2, y: 3, width: 2, height: 2 };
    expect(distanceToRect({ x: 3, y: 4 }, rect)).toBe(0);
    expect(distanceToRect({ x: 2, y: 3 }, rect)).toBe(0);
    expect(distanceToRect({ x: 5, y: 4 }, rect)).toBe(1);
    expect(distanceToRect({ x: 5, y: 6 }, rect)).toBeCloseTo(Math.hypot(1, 1), 10);
  });

  it('resolves the tolerance from its bounds', () => {
    expect(resolveTolerance().tolerancePx).toBe(DEFAULT_PICK_TOLERANCE_PX);
    expect(resolveTolerance({ baseTolerancePx: 30 }).tolerancePx).toBe(30);
    expect(resolveTolerance({ baseTolerancePx: 1 }).tolerancePx).toBe(MIN_PICK_TOLERANCE_PX);
    expect(resolveTolerance({ baseTolerancePx: 500 }).tolerancePx).toBe(MAX_PICK_TOLERANCE_PX);
    expect(() => resolveTolerance({ baseTolerancePx: 0 })).toThrow(RangeError);
    expect(() => resolveTolerance({ minTolerancePx: 20, maxTolerancePx: 10 })).toThrow(RangeError);
  });

  it('converts the on-screen tolerance into world tiles for a scale', () => {
    expect(pickToleranceTiles(TILE_SIZE)).toBeCloseTo(DEFAULT_PICK_TOLERANCE_PX / TILE_SIZE, 10);
    expect(pickToleranceTiles(TILE_SIZE * 4)).toBeCloseTo(DEFAULT_PICK_TOLERANCE_PX / (TILE_SIZE * 4), 10);
    expect(() => pickToleranceTiles(0)).toThrow(RangeError);
  });

  it('ranks agents above buildings, then vehicles above nothing at equal distance', () => {
    expect(CITIZEN_PICK_PRIORITY).toBeLessThan(VEHICLE_PICK_PRIORITY);
    expect(VEHICLE_PICK_PRIORITY).toBeLessThan(BUILDING_PICK_PRIORITY);
  });
});

describe('EntityPicker hits', () => {
  it('resolves a screen click on a citizen to that citizen', () => {
    const { camera, picker } = createHarness();
    const screen = camera.worldToScreen({ x: 8, y: 8 });

    const pick = picker.pickScreen(screen);

    expect(pick.kind).toBe('citizen');
    expect(pick.id).toBe('citizen-1');
    expect(pick.distanceTiles).toBe(0);
    expect(pick.world.x).toBeCloseTo(8, 9);
    expect(pick.world.y).toBeCloseTo(8, 9);
    expect(pick.tolerancePx).toBe(DEFAULT_PICK_TOLERANCE_PX);
    expectClose(pick.toleranceTiles, TOLERANCE_AT_ZOOM_1);
    expect(pick.zoom).toBe(1);
    expect(pick.scale).toBe(TILE_SIZE);
    expect(isEntityPick(pick)).toBe(true);
  });

  it('resolves a screen click on a vehicle to that vehicle', () => {
    const { camera, picker } = createHarness();
    const pick = picker.pickScreen(camera.worldToScreen({ x: 10.5, y: 10.5 }));

    expect(pick.kind).toBe('vehicle');
    expect(pick.id).toBe('vehicle-1');
    expect(pick.distanceTiles).toBe(0);
  });

  it('resolves a click inside a building footprint to that building', () => {
    const { camera, picker } = createHarness();

    expect(picker.pickScreen(camera.worldToScreen({ x: 6.5, y: 6.5 })).id).toBe('building-home');
    expect(picker.pickScreen(camera.worldToScreen({ x: 11.5, y: 6.5 })).id).toBe('building-shop');
    expect(picker.pickScreen(camera.worldToScreen({ x: 6.5, y: 6.5 })).kind).toBe('building');
  });

  it('picks agents over buildings at equal distance', () => {
    const { camera, picker } = createHarness();
    // citizen-2 stands inside the home footprint: both distances are 0.
    const pick = picker.pickScreen(camera.worldToScreen({ x: 5.5, y: 5.5 }));

    expect(pick.kind).toBe('citizen');
    expect(pick.id).toBe('citizen-2');
    expect(pick.distanceTiles).toBe(0);
  });

  it('picks the nearest of two candidates', () => {
    const world = createWorld({
      citizens: [
        createTestCitizen({ id: 'citizen-1', position: { x: 8, y: 8 } }),
        createTestCitizen({ id: 'citizen-3', position: { x: 9, y: 8 } }),
      ],
    });
    const { picker } = createHarness(1, world);
    const pick = picker.pickWorld({ x: 8.4, y: 8 });

    expect(pick.id).toBe('citizen-1');
    expectClose(pick.centreDistanceTiles, 0.4);
  });

  it('picks a building the click is inside over a farther agent', () => {
    const { picker } = createHarness();
    // (6.5, 6.5) is inside the home footprint; the nearest citizen stands
    // 1.84 tiles away, so distance decides and the building wins.
    const pick = picker.pickWorld({ x: 6.5, y: 6.5 });

    expect(pick.kind).toBe('building');
    expect(pick.id).toBe('building-home');
    expect(pick.distanceTiles).toBe(0);
  });

  it('keeps a tighter building footprint when two footprints contain the click', () => {
    const world: PickingWorld = {
      buildings: [
        createTestBuilding({ id: 'building-large', footprint: { x: 0, y: 0, width: 4, height: 4 } }),
        createTestBuilding({ id: 'building-small', footprint: { x: 1, y: 1, width: 2, height: 2 } }),
      ],
      citizens: [],
      vehicles: [],
    };
    const { picker } = createHarness(1, world);
    expect(picker.pickWorld({ x: 2, y: 2 }).id).toBe('building-small');
  });

  it('returns ground with the nearest candidate distance when nothing is in reach', () => {
    const { picker } = createHarness();
    const pick = picker.pickWorld({ x: 6.5, y: 9.5 });

    expect(pick.kind).toBe('ground');
    expect(pick.id).toBe(null);
    expect(pick.distanceTiles).toBeGreaterThan(pick.toleranceTiles);
    expect(pick.distancePx).toBeGreaterThan(pick.tolerancePx);
    // The nearest entity is still reported, for host-side debugging feedback.
    expectClose(pick.distanceTiles, Math.hypot(1.5, 1.5) - 0.28, 6);
  });

  it('reports Infinity when the world holds no entities at all', () => {
    const { picker } = createHarness(1, { buildings: [], citizens: [], vehicles: [] });
    const pick = picker.pickWorld({ x: 8, y: 8 });

    expect(pick.kind).toBe('ground');
    expect(pick.distanceTiles).toBe(Number.POSITIVE_INFINITY);
    expect(pick.distancePx).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('EntityPicker tolerance and zoom', () => {
  it('accepts and rejects clicks around the on-screen tolerance edge', () => {
    const { picker } = createHarness();

    // 0.6 tiles off the citizen: 0.32 tiles to its edge, inside 0.667.
    expect(picker.pickWorld({ x: 8.6, y: 8 }).id).toBe('citizen-1');
    // 0.9 tiles off: 0.62 tiles to its edge, still inside the tolerance.
    expect(picker.pickWorld({ x: 8.9, y: 8 }).id).toBe('citizen-1');
    // 1.0 tile off: 0.72 tiles to its edge, past the tolerance.
    expect(picker.pickWorld({ x: 9, y: 8 }).kind).toBe('ground');
  });

  it('scales the world tolerance with the camera zoom', () => {
    const { camera, picker } = createHarness();

    expectClose(picker.toleranceTiles, TOLERANCE_AT_ZOOM_1);
    const wide = picker.toleranceTiles;

    camera.zoomTo(4);
    expectClose(picker.toleranceTiles, DEFAULT_PICK_TOLERANCE_PX / (TILE_SIZE * 4));
    expect(picker.toleranceTiles).toBeLessThan(wide);
    expect(picker.tolerancePx).toBe(DEFAULT_PICK_TOLERANCE_PX);
    expectClose(picker.toleranceTilesForZoom(1), TOLERANCE_AT_ZOOM_1);
    expect(picker.toleranceTilesForZoom(8)).toBeLessThan(picker.toleranceTilesForZoom(2));
  });

  it('keeps the same tile offset clickable when zoomed out but not when zoomed in', () => {
    const wide = createHarness(1);
    // 0.6 tiles east of citizen-1: 0.32 tiles from its edge.
    expect(wide.picker.pickWorld({ x: 8.6, y: 8 }).id).toBe('citizen-1');

    const close = createHarness(4);
    // At zoom 4 the same world offset exceeds the shrunken tolerance.
    expect(close.picker.toleranceTiles).toBeLessThan(0.32);
    expect(close.picker.pickWorld({ x: 8.6, y: 8 }).kind).toBe('ground');

    // The identical click still lands when it is within the tighter tolerance.
    expect(close.picker.pickWorld({ x: 8.4, y: 8 }).id).toBe('citizen-1');
  });

  it('honours a custom tolerance', () => {
    const { camera } = createHarness();
    const picker = new EntityPicker({ camera, world: createWorld(), baseTolerancePx: 40 });
    expect(picker.tolerancePx).toBe(40);
    expectClose(picker.toleranceTiles, 40 / TILE_SIZE);
    // 1.0 tile off the citizen is inside a 40px tolerance (0.72 tiles to edge).
    expect(picker.pickWorld({ x: 9, y: 8 }).id).toBe('citizen-1');
  });
});

describe('EntityPicker integration with the camera and the world', () => {
  it('uses the camera transform to convert screen clicks', () => {
    const { camera, picker } = createHarness();
    const screen = camera.worldToScreen({ x: 5.5, y: 5.5 });

    const pick = picker.pickScreen(screen);

    expect(pick.id).toBe('citizen-2');
    const expectedWorld = camera.screenToWorld(screen);
    expect(pick.world.x).toBeCloseTo(expectedWorld.x, 9);
    expect(pick.world.y).toBeCloseTo(expectedWorld.y, 9);
  });

  it('follows camera pan and zoom', () => {
    const { camera, picker } = createHarness();
    camera.centerOn(6, 6);
    camera.zoomTo(2);

    const screen = camera.worldToScreen({ x: 5.5, y: 5.5 });
    expect(picker.pick(screen.x, screen.y).id).toBe('citizen-2');

    camera.centerOn(14, 8);
    const offscreen = camera.worldToScreen({ x: 12, y: 6.5 });
    expect(picker.pickScreen(offscreen).id).toBe('building-shop');
  });

  it('projects a world point into the screen space it reports', () => {
    const { camera, picker } = createHarness();
    const pick = picker.pickWorld({ x: 10.5, y: 10.5 });
    const expected = camera.worldToScreen({ x: 10.5, y: 10.5 });

    expect(pick.screen.x).toBeCloseTo(expected.x, 9);
    expect(pick.screen.y).toBeCloseTo(expected.y, 9);
    expect(pick.id).toBe('vehicle-1');
  });

  it('rebinds the world through update() and reads ground without one', () => {
    const { camera, picker } = createHarness(1, createWorld());
    expect(picker.world).not.toBeNull();

    const empty: PickingWorld = { buildings: [], citizens: [], vehicles: [] };
    picker.update(empty);
    expect(picker.world).toBe(empty);
    expect(picker.pickWorld({ x: 8, y: 8 }).kind).toBe('ground');

    const seeded = createWorld();
    picker.update(seeded);
    expect(picker.pickWorld({ x: 8, y: 8 }).id).toBe('citizen-1');

    const unbounded = new EntityPicker({ camera });
    expect(unbounded.world).toBe(null);
    expect(unbounded.pickWorld({ x: 8, y: 8 }).kind).toBe('ground');
    unbounded.update(seeded);
    expect(unbounded.pickWorld({ x: 8, y: 8 }).id).toBe('citizen-1');
  });

  it('is deterministic and independent of collection order', () => {
    const world = createWorld();
    const { picker } = createHarness(1, world);
    const first = picker.pickWorld({ x: 8.2, y: 8.1 });

    const shuffled: PickingWorld = {
      buildings: [...world.buildings].reverse(),
      citizens: [...world.citizens].reverse(),
      vehicles: [...world.vehicles].reverse(),
    };
    const { picker: other } = createHarness(1, shuffled);
    const second = other.pickWorld({ x: 8.2, y: 8.1 });

    expect(first.kind).toBe('citizen');
    expect(second.kind).toBe(first.kind);
    expect(second.id).toBe(first.id);
    expect(second.distanceTiles).toBeCloseTo(first.distanceTiles, 12);
  });

  it('can ignore entity classes', () => {
    const { camera, world } = createHarness();
    const citizensOff = new EntityPicker({ camera, world, pickCitizens: false });
    expect(citizensOff.pickWorld({ x: 8, y: 8 }).kind).toBe('ground');

    const buildingsOff = new EntityPicker({ camera, world, pickBuildings: false });
    expect(buildingsOff.pickWorld({ x: 6.5, y: 6.5 }).kind).toBe('ground');

    const vehiclesOff = new EntityPicker({ camera, world, pickVehicles: false });
    expect(vehiclesOff.pickWorld({ x: 10.5, y: 10.5 }).kind).toBe('ground');
  });

  it('reports ground after dispose() without throwing', () => {
    const { picker } = createHarness();
    picker.dispose();

    expect(picker.isDisposed).toBe(true);
    expect(picker.world).toBe(null);
    expect(picker.pickWorld({ x: 8, y: 8 }).kind).toBe('ground');
  });

  it('validates its constructor arguments', () => {
    const camera = createCamera();
    expect(() => new EntityPicker({ camera, baseTolerancePx: Number.NaN })).toThrow(RangeError);
    expect(() => new EntityPicker({ camera, citizenRadiusTiles: Number.NaN })).toThrow(RangeError);
    expect(createEntityPicker({ camera, world: createWorld() })).toBeInstanceOf(EntityPicker);
  });
});
