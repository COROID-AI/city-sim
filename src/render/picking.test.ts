import {
  pickEntityAt,
  CITIZEN_PICK_RADIUS,
  VEHICLE_PICK_RADIUS,
  type Selection,
} from './picking';
import { Camera } from './camera';
import type {
  Building,
  Citizen,
  Tile,
  Vehicle,
  World,
} from '../sim/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Build a minimal valid {@link World} with optional entities. */
function makeWorld(opts: {
  width?: number;
  height?: number;
  tiles?: Tile[];
  buildings?: Building[];
  citizens?: Citizen[];
  vehicles?: Vehicle[];
}): World {
  const width = opts.width ?? 1;
  const height = opts.height ?? 1;
  return {
    width,
    height,
    tiles: opts.tiles ?? [],
    buildings: new Map((opts.buildings ?? []).map((b) => [b.id, b])),
    citizens: new Map((opts.citizens ?? []).map((c) => [c.id, c])),
    vehicles: new Map((opts.vehicles ?? []).map((v) => [v.id, v])),
    companies: new Map(),
    simTime: { elapsedHours: 0 },
    budget: 0,
    derivedStats: {
      population: 0,
      employmentRate: 0,
      lastHourTaxIncome: 0,
      lastHourExpenses: 0,
    },
    lastEconomyHour: -1,
    lastRevenueBaseline: 0,
  };
}

/**
 * Build tiles for a small grid, marking specific cells as building tiles.
 *
 * @param width   Grid width.
 * @param height  Grid height.
 * @param buildings  Buildings to stamp into tiles.
 */
function buildTiles(
  width: number,
  height: number,
  buildings: Building[],
): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push({
        x,
        y,
        zone: 'MIXED',
        terrain: 'GRASS',
        buildingId: null,
      });
    }
  }
  // Stamp building footprints.
  for (const b of buildings) {
    for (let dy = 0; dy < b.size.height; dy++) {
      for (let dx = 0; dx < b.size.width; dx++) {
        const tx = b.position.x + dx;
        const ty = b.position.y + dy;
        if (tx >= 0 && ty >= 0 && tx < width && ty < height) {
          const tile = tiles[ty * width + tx]!;
          tile.terrain = 'BUILDING';
          tile.buildingId = b.id;
        }
      }
    }
  }
  return tiles;
}

/** Build a sample building. */
function makeBuilding(overrides: Partial<Building> = {}): Building {
  return {
    id: 'b0',
    kind: 'WORK',
    position: { x: 10, y: 10 },
    size: { width: 3, height: 3 },
    capacity: 10,
    name: 'Tech Hub',
    owner: null,
    ...overrides,
  };
}

/** Build a sample citizen. */
function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: 'c0',
    home: 'b0',
    work: null,
    entertainment: null,
    state: { kind: 'HOME', buildingId: 'b0' },
    position: { x: 5, y: 5 },
    money: 500,
    path: [],
    pathIndex: 0,
    ...overrides,
  };
}

/** Build a sample vehicle. */
function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v0',
    kind: 'CAR',
    position: { x: 8, y: 8 },
    velocity: { x: 0, y: 0 },
    driver: null,
    target: null,
    currentRoadPath: [],
    pathIndex: 0,
    pathProgress: 0,
    passengers: [],
    speed: 30,
    fuel: 100,
    ...overrides,
  };
}

// ─── Camera helpers ──────────────────────────────────────────────────────────

/**
 * Camera dimensions used by every test.
 *
 * With a 200×200 world, a 200×200 viewport, and zoom 1, the visible area
 * equals the world so no clamping occurs, and `screenToWorld` is the
 * identity function (screen pixels == world cells).  This makes all
 * picking tests trivially predictable: a click at screen (x, y) targets
 * world cell (x, y).
 */
const WORLD_SIZE = 200;
const VIEW_W = 200;
const VIEW_H = 200;

/** Create a standard identity-transform camera. */
function makeCamera(): Camera {
  return new Camera({
    worldWidth: WORLD_SIZE,
    worldHeight: WORLD_SIZE,
    viewportWidth: VIEW_W,
    viewportHeight: VIEW_H,
    zoom: 1,
    centerX: WORLD_SIZE / 2,
    centerY: WORLD_SIZE / 2,
  });
}

/**
 * Pick at a **world** coordinate.  Because the standard camera has an
 * identity transform, world coords == screen coords.
 */
function pickAt(
  world: World,
  camera: Camera,
  worldX: number,
  worldY: number,
): Selection | null {
  const screen = camera.worldToScreen(worldX, worldY);
  return pickEntityAt(world, camera, screen.x, screen.y);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

describe('picking exports', () => {
  it('exports pickEntityAt as a function', () => {
    expect(typeof pickEntityAt).toBe('function');
  });

  it('exports pick radius constants', () => {
    expect(CITIZEN_PICK_RADIUS).toBeGreaterThan(0);
    expect(VEHICLE_PICK_RADIUS).toBeGreaterThan(0);
  });
});

// ─── Building picking ────────────────────────────────────────────────────────

describe('pickEntityAt — buildings', () => {
  it('returns a building selection when clicking inside a building footprint', () => {
    const building = makeBuilding({
      id: 'b0',
      position: { x: 10, y: 10 },
      size: { width: 3, height: 3 },
    });
    const tiles = buildTiles(WORLD_SIZE, WORLD_SIZE, [building]);
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE, tiles, buildings: [building] });
    const camera = makeCamera();

    // Click at world (11, 11) — inside the building footprint.
    const sel = pickAt(world, camera, 11, 11);
    expect(sel).not.toBeNull();
    expect(sel!.kind).toBe('building');
    expect(sel!.id).toBe('b0');
  });

  it('returns null when clicking on empty grass', () => {
    const building = makeBuilding({ position: { x: 50, y: 50 } });
    const tiles = buildTiles(WORLD_SIZE, WORLD_SIZE, [building]);
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE, tiles, buildings: [building] });
    const camera = makeCamera();

    const sel = pickAt(world, camera, 5, 5);
    expect(sel).toBeNull();
  });

  it('respects the camera screenToWorld transform', () => {
    // Use a camera with zoom 2 and an off-center viewpoint to verify the
    // transform is applied (not a raw coordinate pass-through).
    const building = makeBuilding({ position: { x: 40, y: 40 } });
    const tiles = buildTiles(WORLD_SIZE, WORLD_SIZE, [building]);
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE, tiles, buildings: [building] });
    // Camera: zoom 2, center (50, 50).  This is a non-identity transform so
    // the test verifies that pickEntityAt converts screen → world correctly.
    const camera = new Camera({
      worldWidth: WORLD_SIZE,
      worldHeight: WORLD_SIZE,
      viewportWidth: VIEW_W,
      viewportHeight: VIEW_H,
      zoom: 2,
      centerX: 50,
      centerY: 50,
    });

    // Convert the target world point to screen pixels, then pick there.
    const screen = camera.worldToScreen(41, 41);
    // Verify the transform is actually non-trivial (not identity).
    expect(screen.x).not.toBe(41);
    const sel = pickEntityAt(world, camera, screen.x, screen.y);
    expect(sel).not.toBeNull();
    expect(sel!.kind).toBe('building');
  });
});

// ─── Citizen picking ─────────────────────────────────────────────────────────

describe('pickEntityAt — citizens', () => {
  it('returns a citizen selection when clicking near a citizen', () => {
    const citizen = makeCitizen({ id: 'c0', position: { x: 30, y: 30 } });
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE, citizens: [citizen] });
    const camera = makeCamera();

    const sel = pickAt(world, camera, 30, 30);
    expect(sel).not.toBeNull();
    expect(sel!.kind).toBe('citizen');
    expect(sel!.id).toBe('c0');
  });

  it('returns the closest citizen when multiple are within range', () => {
    const c0 = makeCitizen({ id: 'c0', position: { x: 30, y: 30 } });
    const c1 = makeCitizen({ id: 'c1', position: { x: 30.4, y: 30.4 } });
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE, citizens: [c0, c1] });
    const camera = makeCamera();

    const sel = pickAt(world, camera, 30, 30);
    expect(sel!.id).toBe('c0');
  });

  it('returns null when clicking far from all citizens', () => {
    const citizen = makeCitizen({ position: { x: 30, y: 30 } });
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE, citizens: [citizen] });
    const camera = makeCamera();

    const sel = pickAt(world, camera, 60, 60);
    expect(sel).toBeNull();
  });

  it('respects the CITIZEN_PICK_RADIUS boundary', () => {
    const citizen = makeCitizen({ position: { x: 50, y: 50 } });
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE, citizens: [citizen] });
    const camera = makeCamera();

    // Click just inside the radius.
    const offset = CITIZEN_PICK_RADIUS - 0.01;
    const inside = pickAt(world, camera, 50 + offset, 50);
    expect(inside).not.toBeNull();

    // Click just outside the radius.
    const offsetOut = CITIZEN_PICK_RADIUS + 0.5;
    const outside = pickAt(world, camera, 50 + offsetOut, 50);
    expect(outside).toBeNull();
  });
});

// ─── Vehicle picking ─────────────────────────────────────────────────────────

describe('pickEntityAt — vehicles', () => {
  it('returns a vehicle selection when clicking near a vehicle', () => {
    const vehicle = makeVehicle({ id: 'v0', position: { x: 40, y: 40 } });
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE, vehicles: [vehicle] });
    const camera = makeCamera();

    const sel = pickAt(world, camera, 40, 40);
    expect(sel).not.toBeNull();
    expect(sel!.kind).toBe('vehicle');
    expect(sel!.id).toBe('v0');
  });

  it('returns the closest vehicle when multiple are within range', () => {
    const v0 = makeVehicle({ id: 'v0', position: { x: 40, y: 40 } });
    const v1 = makeVehicle({ id: 'v1', position: { x: 40.3, y: 40.3 } });
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE, vehicles: [v0, v1] });
    const camera = makeCamera();

    const sel = pickAt(world, camera, 40, 40);
    expect(sel!.id).toBe('v0');
  });

  it('returns null when clicking far from all vehicles', () => {
    const vehicle = makeVehicle({ position: { x: 40, y: 40 } });
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE, vehicles: [vehicle] });
    const camera = makeCamera();

    const sel = pickAt(world, camera, 80, 80);
    expect(sel).toBeNull();
  });
});

// ─── Priority: buildings over citizens/vehicles ──────────────────────────────

describe('pickEntityAt — priority', () => {
  it('prefers buildings over citizens at the same location', () => {
    const building = makeBuilding({
      id: 'b0',
      position: { x: 20, y: 20 },
      size: { width: 2, height: 2 },
    });
    const citizen = makeCitizen({ id: 'c0', position: { x: 21, y: 21 } });
    const tiles = buildTiles(WORLD_SIZE, WORLD_SIZE, [building]);
    const world = makeWorld({
      width: WORLD_SIZE,
      height: WORLD_SIZE,
      tiles,
      buildings: [building],
      citizens: [citizen],
    });
    const camera = makeCamera();

    const sel = pickAt(world, camera, 21, 21);
    expect(sel!.kind).toBe('building');
  });

  it('prefers citizens over vehicles when both are at the same location', () => {
    const citizen = makeCitizen({ id: 'c0', position: { x: 50, y: 50 } });
    const vehicle = makeVehicle({ id: 'v0', position: { x: 50, y: 50 } });
    const world = makeWorld({
      width: WORLD_SIZE,
      height: WORLD_SIZE,
      citizens: [citizen],
      vehicles: [vehicle],
    });
    const camera = makeCamera();

    const sel = pickAt(world, camera, 50, 50);
    expect(sel!.kind).toBe('citizen');
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe('pickEntityAt — edge cases', () => {
  it('returns null for an empty world', () => {
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE });
    const camera = makeCamera();
    const sel = pickAt(world, camera, 50, 50);
    expect(sel).toBeNull();
  });

  it('returns a valid Selection shape', () => {
    const citizen = makeCitizen({ id: 'c0', position: { x: 50, y: 50 } });
    const world = makeWorld({ width: WORLD_SIZE, height: WORLD_SIZE, citizens: [citizen] });
    const camera = makeCamera();

    const sel = pickAt(world, camera, 50, 50);
    expect(sel).not.toBeNull();
    expect(sel).toHaveProperty('kind');
    expect(sel).toHaveProperty('id');
    expect(typeof (sel as Selection).id).toBe('string');
  });
});
