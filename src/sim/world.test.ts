import {
  createWorld,
  placeBuilding,
  isRoad,
  isWalkable,
  neighbors,
  cellAt,
  CellKind,
  GRID_WIDTH,
  GRID_HEIGHT,
  BuildingKind,
  isRoadNetworkConnected,
} from './world';
import { createRng } from './rng';

describe('createWorld', () => {
  const world = createWorld(42);

  it('produces a grid of the documented dimensions', () => {
    expect(world.width).toBe(GRID_WIDTH);
    expect(world.height).toBe(GRID_HEIGHT);
    expect(world.cells).toHaveLength(GRID_WIDTH * GRID_HEIGHT);
  });

  it('materializes at least 20 buildings', () => {
    expect(world.buildings.length).toBeGreaterThanOrEqual(20);
  });

  it('materializes at least 10 road segments', () => {
    expect(world.roads.length).toBeGreaterThanOrEqual(10);
  });

  it('places road tiles onto the grid', () => {
    const roadTileCount = world.cells.filter((c) => c === CellKind.Road).length;
    expect(roadTileCount).toBeGreaterThan(0);
  });

  it('yields a single connected road network spanning the grid', () => {
    expect(isRoadNetworkConnected(world)).toBe(true);
  });

  it('is deterministic — same seed yields the same layout', () => {
    const a = createWorld(123);
    const b = createWorld(123);
    expect(a.cells).toEqual(b.cells);
    expect(a.buildings).toEqual(b.buildings);
  });

  it('accepts an Rng instance directly', () => {
    const rng = createRng(7);
    const w = createWorld(rng);
    expect(w.buildings.length).toBeGreaterThanOrEqual(20);
  });
});

describe('isRoad', () => {
  it('returns true only for road cells', () => {
    expect(isRoad(CellKind.Road)).toBe(true);
    expect(isRoad(CellKind.Building)).toBe(false);
    expect(isRoad(CellKind.Sidewalk)).toBe(false);
    expect(isRoad(CellKind.Empty)).toBe(false);
  });
});

describe('isWalkable', () => {
  it('treats sidewalk, empty, and road as walkable', () => {
    expect(isWalkable(CellKind.Sidewalk)).toBe(true);
    expect(isWalkable(CellKind.Empty)).toBe(true);
    expect(isWalkable(CellKind.Road)).toBe(true);
    expect(isWalkable(CellKind.Building)).toBe(false);
  });
});

describe('placeBuilding', () => {
  it('stamps the building footprint and surrounds it with sidewalk', () => {
    const world = createWorld(1);
    const before = world.buildings.length;
    const rect = { x: 5, y: 5, width: 3, height: 3 };
    placeBuilding(world, rect, BuildingKind.Commercial);

    // Building registered.
    expect(world.buildings).toHaveLength(before + 1);
    expect(world.buildings[before].kind).toBe(BuildingKind.Commercial);

    // Core is building.
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        expect(cellAt(world, x, y)).toBe(CellKind.Building);
      }
    }

    // Ring around it is sidewalk (top-left corner of the ring).
    expect(cellAt(world, rect.x - 1, rect.y - 1)).toBe(CellKind.Sidewalk);
    expect(cellAt(world, rect.x + rect.width, rect.y)).toBe(CellKind.Sidewalk);
  });
});

describe('neighbors', () => {
  it('returns the 4-connected neighbours within bounds', () => {
    const world = createWorld(1);
    const center = { x: 10, y: 10 };
    const ns = neighbors(world, center);
    expect(ns).toHaveLength(4);
    expect(ns.map((n) => `${n.x},${n.y}`).sort()).toEqual(
      ['10,9', '11,10', '10,11', '9,10'].sort(),
    );
  });

  it('clamps neighbours at the grid corner', () => {
    const world = createWorld(1);
    const ns = neighbors(world, { x: 0, y: 0 });
    expect(ns).toHaveLength(2);
  });
});
