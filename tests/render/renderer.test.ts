/**
 * Unit suite for the canvas 2D city renderer.
 *
 * Everything here runs headlessly against `tests/helpers/fake-canvas.ts`, which
 * records every context call and property write. That turns the frame pipeline
 * into plain data: the suite replays recorded frames, counts per-entity draws,
 * asserts the ordered layers, proves viewport culling drops off-screen entities,
 * proves the lighting sample drives the night layers, and benchmarks the whole
 * frame against {@link FRAME_BUDGET_MS}.
 *
 * The fixture is a deterministic synthetic city built from the shared
 * `sim-fixtures` builders: 48x30 tiles, a 7x5 road grid with lane counts and
 * traffic lights, 28 buildings of every kind, 60 citizens, 12 vehicles and four
 * named districts. That is deliberately at or above the shipped scale the
 * `README.md` requires (>=20 buildings, >=50 citizens, >=10 vehicles), so a
 * single recorded frame proves the simultaneous-scale visuals claim at render
 * level. The camera viewport is chosen so the whole city fits exactly at zoom 1.
 */

import { describe, expect, it } from 'vitest';

import { createViewportCamera } from '../../src/render/camera';
import type { ViewportCamera } from '../../src/render/camera';
import { colorToCssWithAlpha, sampleLighting } from '../../src/render/daynight';
import type { RgbColor } from '../../src/render/daynight';
import {
  CityRenderer,
  DEFAULT_RENDERER_PALETTE,
  FRAME_BUDGET_MS,
  RENDER_LAYERS,
  createCityRenderer,
} from '../../src/render/renderer';
import type {
  CitizenSource,
  CitizenView,
  RendererDistrict,
  RendererPalette,
  RendererWorld,
  VehicleSource,
} from '../../src/render/renderer';
import { createFakeCanvas } from '../helpers/fake-canvas';
import type { FakeCanvasHandle } from '../helpers/fake-canvas';
import { createTestCitizen, createTestVehicle, createTestWorldMap } from '../helpers/sim-fixtures';
import { ACTIVITY_KINDS, BUILDING_KINDS, TERRAIN_KINDS, VEHICLE_KINDS } from '../../src/sim/types';
import type {
  Building,
  Citizen,
  EntityId,
  RoadNode,
  RoadSegment,
  TerrainKind,
  Tile,
  TileRect,
  Vehicle,
} from '../../src/sim/types';

/* -------------------------------------------------------------- fixture -- */

const GRID_WIDTH = 48;
const GRID_HEIGHT = 30;
const TILE_SIZE = 24;
const AVENUE_XS: readonly number[] = [2, 9, 16, 23, 30, 37, 44];
const STREET_YS: readonly number[] = [2, 8, 14, 20, 26];
const BUILDING_COUNT = 28;
const CITIZEN_COUNT = 60;
const VEHICLE_COUNT = 12;
/**
 * The scale the shipped city must reach (README.md: >=20 buildings, >=50
 * citizens, >=10 vehicles); the fixture is built past every one of them.
 */
const SCALE_MINIMUMS = { buildings: 24, citizens: 50, vehicles: 10 } as const;
const VIEWPORT = { width: GRID_WIDTH * TILE_SIZE, height: GRID_HEIGHT * TILE_SIZE };

/**
 * Independent restatement of the pipeline the page must draw. The renderer's own
 * `RENDER_LAYERS` table is asserted against this, so neither can drift silently.
 */
const EXPECTED_LAYER_ORDER = [
  'sky',
  'terrain',
  'districts',
  'roads',
  'lane-markings',
  'crossings',
  'shadows',
  'buildings',
  'windows',
  'streetlights',
  'citizens',
  'vehicles',
  'ambient',
  'haze',
] as const;

const LAYERS_WITHOUT_NIGHT_LIGHTS = EXPECTED_LAYER_ORDER.filter(
  (layer) => layer !== 'windows' && layer !== 'streetlights',
);

const DISTRICTS: readonly RendererDistrict[] = [
  {
    id: 'district-nw',
    name: 'North West',
    bounds: { x: 0, y: 0, width: 24, height: 15 },
    color: '#8fb7d8',
  },
  {
    id: 'district-ne',
    name: 'North East',
    bounds: { x: 24, y: 0, width: 24, height: 15 },
    color: '#d8a25f',
  },
  {
    id: 'district-sw',
    name: 'South West',
    bounds: { x: 0, y: 15, width: 24, height: 15 },
    color: '#7dbb6a',
  },
  {
    id: 'district-se',
    name: 'South East',
    bounds: { x: 24, y: 15, width: 24, height: 15 },
    color: '#c8b6e2',
  },
];

/** Unique wall colour per building, so one entity's draws can be found in a frame. */
function buildingColour(index: number): string {
  return `#${(0x101010 + index * 0x000707).toString(16).padStart(6, '0')}`;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildTiles(): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const onRoad = AVENUE_XS.includes(x) || STREET_YS.includes(y);
      let terrain: TerrainKind = onRoad ? 'road' : 'grass';
      if (!onRoad) {
        if (x >= 33 && x <= 35 && y >= 3 && y <= 5) {
          terrain = 'water';
        } else if (x >= 12 && x <= 14 && y >= 24 && y <= 26) {
          terrain = 'park';
        } else if (x >= 4 && x <= 5 && y >= 10 && y <= 12) {
          terrain = 'plaza';
        }
      }
      tiles.push({ x, y, terrain, buildingId: null, segmentId: onRoad ? 'segment-0' : null });
    }
  }
  return tiles;
}

function buildRoadNetwork(): { nodes: RoadNode[]; segments: RoadSegment[] } {
  const nodes: RoadNode[] = [];
  const byKey = new Map<string, RoadNode>();
  for (const x of AVENUE_XS) {
    for (const y of STREET_YS) {
      const node: RoadNode = {
        id: `node-${x}-${y}`,
        kind: 'intersection',
        x,
        y,
        neighborIds: [],
        speedLimit: 0.5,
        hasTrafficLight: (x + y) % 2 === 0,
      };
      nodes.push(node);
      byKey.set(`${x}:${y}`, node);
    }
  }
  const segments: RoadSegment[] = [];
  const link = (from: RoadNode, to: RoadNode, lanes: number): void => {
    const id = `segment-${from.id}-${to.id}`;
    from.neighborIds.push(to.id);
    to.neighborIds.push(from.id);
    segments.push({
      id,
      fromNodeId: from.id,
      toNodeId: to.id,
      length: Math.hypot(to.x - from.x, to.y - from.y),
      lanes,
      speedLimit: 0.5,
    });
  };
  for (let column = 0; column < AVENUE_XS.length - 1; column += 1) {
    for (const y of STREET_YS) {
      link(byKey.get(`${AVENUE_XS[column]}:${y}`)!, byKey.get(`${AVENUE_XS[column + 1]}:${y}`)!, 4);
    }
  }
  for (const x of AVENUE_XS) {
    for (let row = 0; row < STREET_YS.length - 1; row += 1) {
      link(byKey.get(`${x}:${STREET_YS[row]}`)!, byKey.get(`${x}:${STREET_YS[row + 1]}`)!, 2);
    }
  }
  return { nodes, segments };
}

function buildBuildings(): Building[] {
  const buildings: Building[] = [];
  const random = createRandom(7);
  for (const y of STREET_YS) {
    for (const x of AVENUE_XS) {
      if (buildings.length >= BUILDING_COUNT) {
        return buildings;
      }
      const index = buildings.length;
      const kind = BUILDING_KINDS[index % BUILDING_KINDS.length];
      const width = kind === 'park' ? 2 : 1 + Math.floor(random() * 2);
      const height = kind === 'park' ? 2 : 1 + Math.floor(random() * 2);
      buildings.push({
        id: `building-${index}`,
        kind,
        name: `${kind} ${index}`,
        footprint: { x: x + 1, y: y + 1, width, height },
        floors: 1 + (index % 6),
        capacity: 4 * (1 + (index % 6)),
        occupantIds: [],
        residentHouseholdIds: [],
        companyId: null,
        entranceNodeId: null,
        color: buildingColour(index),
      });
    }
  }
  return buildings;
}

function buildCitizens(): Citizen[] {
  const citizens: Citizen[] = [];
  for (let index = 0; index < CITIZEN_COUNT; index += 1) {
    citizens.push(
      createTestCitizen({
        id: `citizen-${index}`,
        name: `Citizen ${index}`,
        mood: (index % 10) / 9,
        currentActivity: ACTIVITY_KINDS[index % ACTIVITY_KINDS.length],
        position: { x: 1 + ((index * 7) % (GRID_WIDTH - 2)) + 0.5, y: 1 + ((index * 5) % (GRID_HEIGHT - 2)) + 0.5 },
      }),
    );
  }
  return citizens;
}

function buildVehicles(): Vehicle[] {
  const vehicles: Vehicle[] = [];
  for (let index = 0; index < VEHICLE_COUNT; index += 1) {
    const kind = VEHICLE_KINDS[index % VEHICLE_KINDS.length];
    const capacity = 2 + (index % 8);
    vehicles.push(
      createTestVehicle({
        id: `vehicle-${index}`,
        kind,
        plate: `CITY-${index}`,
        capacity,
        occupancy: index % (capacity + 1),
        occupantIds: [],
        position: {
          x: AVENUE_XS[index % AVENUE_XS.length] + (index % 3) * 0.3,
          y: STREET_YS[(index * 2) % STREET_YS.length] + 0.2,
        },
        headingRadians: (index * Math.PI) / 6,
      }),
    );
  }
  return vehicles;
}

interface FixtureOptions {
  /** Citizens all outside on the street, so their anchor is exactly their position. */
  outdoorCitizens?: boolean;
  /** Renderer palette overrides. */
  palette?: Parameters<typeof createCityRenderer>[0]['palette'];
  /** Device pixel ratio handed to the renderer. */
  pixelRatio?: number;
  /** Skip binding the context in the constructor (to exercise `attach()`). */
  detached?: boolean;
  /** Camera zoom; the whole city is visible at zoom 1. */
  zoom?: number;
}

interface RendererFixture {
  readonly world: RendererWorld;
  readonly camera: ViewportCamera;
  readonly handle: FakeCanvasHandle;
  readonly renderer: CityRenderer;
  readonly palette: RendererPalette;
  readonly buildings: Building[];
  readonly citizens: Citizen[];
  readonly vehicles: Vehicle[];
  readonly citizensSource: CitizenSource;
  readonly vehiclesSource: VehicleSource;
}

function createRendererFixture(options: FixtureOptions = {}): RendererFixture {
  const roadNetwork = buildRoadNetwork();
  const buildings = buildBuildings();
  const citizens = buildCitizens();
  const vehicles = buildVehicles();
  const world: RendererWorld = {
    ...createTestWorldMap(),
    widthInTiles: GRID_WIDTH,
    heightInTiles: GRID_HEIGHT,
    tileSize: TILE_SIZE,
    tiles: buildTiles(),
    nodes: roadNetwork.nodes,
    segments: roadNetwork.segments,
    buildings,
    citizens,
    vehicles,
    districts: DISTRICTS,
  };

  const liveStates = new Map<EntityId, CitizenView>();
  for (let index = 0; index < citizens.length; index += 1) {
    const citizen = citizens[index];
    const travelling = index % 5 === 0;
    const inside = !options.outdoorCitizens && !travelling && index % 2 === 0;
    liveStates.set(citizen.id, {
      citizenId: citizen.id,
      activity: citizen.currentActivity,
      travelling,
      position: citizen.position,
      insideBuildingId: inside ? buildings[index % buildings.length].id : null,
    });
  }
  const citizensSource: CitizenSource = {
    citizens,
    liveStateFor: (citizenId: EntityId) => liveStates.get(citizenId) ?? null,
  };
  const activeVehicles: Vehicle[] = [...vehicles];
  const vehiclesSource: VehicleSource = {
    activeVehicles: () => activeVehicles,
  };

  const camera = createViewportCamera(world, VIEWPORT, { zoom: options.zoom ?? 1 });
  const handle = createFakeCanvas({ width: VIEWPORT.width, height: VIEWPORT.height });
  const renderer = new CityRenderer({
    world,
    camera,
    context: options.detached ? null : handle.context.toContext2D(),
    citizens: citizensSource,
    vehicles: vehiclesSource,
    palette: options.palette,
    pixelRatio: options.pixelRatio,
  });

  return {
    world,
    camera,
    handle,
    renderer,
    palette: renderer.palette,
    buildings,
    citizens,
    vehicles,
    citizensSource,
    vehiclesSource,
  };
}

/* --------------------------------------------------------------- helpers -- */

/** Index of the first recorded write of `property` with exactly `value`. */
function styleWriteIndex(handle: FakeCanvasHandle, property: string, value: string): number {
  const expected = value.toLowerCase();
  return handle.writes.findIndex(
    (write) => write.property === property && String(write.value).toLowerCase() === expected,
  );
}

function expectLayerOrder(handle: FakeCanvasHandle, palette: RendererPalette, hour: number): void {
  const sample = sampleLighting(hour);
  const witnesses: readonly [string, string, string][] = [
    ['fillStyle', 'terrain', palette.terrain.grass],
    ['strokeStyle', 'roads', palette.roadSurface],
    ['strokeStyle', 'lane-markings', palette.laneMarking],
    ['fillStyle', 'crossings', palette.crosswalk],
    ['fillStyle', 'shadows', palette.shadow],
    ['fillStyle', 'buildings', palette.building.house.roof],
    ['fillStyle', 'windows', palette.windowGlow],
    ['fillStyle', 'streetlights', palette.streetlightGlow],
    ['fillStyle', 'citizens', palette.citizen.work],
    ['fillStyle', 'vehicles', palette.vehicleGlass],
    ['fillStyle', 'ambient', colorToCssWithAlpha(sample.ambient.color, sample.ambient.strength)],
    ['fillStyle', 'haze', colorToCssWithAlpha(palette.haze, sample.haze * 0.4)],
  ];
  const indices = witnesses.map(([property, layer, value]) => {
    const index = styleWriteIndex(handle, property, value);
    expect(index, `${layer} witness ${value} drawn`).toBeGreaterThanOrEqual(0);
    return index;
  });
  for (let index = 1; index < indices.length; index += 1) {
    expect(
      indices[index],
      `${witnesses[index][1]} drawn after ${witnesses[index - 1][1]}`,
    ).toBeGreaterThan(indices[index - 1]);
  }
}

function parseRgba(value: string): { r: number; g: number; b: number; a: number } | null {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value);
  if (!match) {
    return null;
  }
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

/**
 * Compares recorded property writes ignoring object identity: a gradient style
 * is a fresh object each frame, so it is folded to a stable label.
 */
function normaliseWrites(
  writes: readonly { readonly property: string; readonly value: unknown }[],
): { property: string; value: unknown }[] {
  return writes.map((write) => ({
    property: write.property,
    value: typeof write.value === 'object' && write.value !== null ? '[object-style]' : write.value,
  }));
}

/** The ambient veil actually painted, read back from the recorded fill style. */
function recordedAmbient(
  handle: FakeCanvasHandle,
  hour: number,
): { r: number; g: number; b: number; a: number } {
  const sample = sampleLighting(hour);
  const css = colorToCssWithAlpha(sample.ambient.color, sample.ambient.strength);
  const index = styleWriteIndex(handle, 'fillStyle', css);
  expect(index, 'ambient veil drawn').toBeGreaterThanOrEqual(0);
  const parsed = parseRgba(css);
  expect(parsed).not.toBeNull();
  return parsed!;
}

function halfOpenIntersects(left: TileRect, right: TileRect): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

function shrink(rect: TileRect, amount: number): TileRect {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    width: Math.max(0, rect.width - amount * 2),
    height: Math.max(0, rect.height - amount * 2),
  };
}

function expand(rect: TileRect, amount: number): TileRect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function pointInside(rect: TileRect, x: number, y: number): boolean {
  return x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height;
}

/* ----------------------------------------------------------------- tests -- */

describe('CityRenderer frame pipeline', () => {
  it('draws every layer of the documented order for a full night frame', () => {
    const fixture = createRendererFixture();
    const stats = fixture.renderer.frame(1);

    expect(stats.layers).toEqual([...EXPECTED_LAYER_ORDER]);
    expect(RENDER_LAYERS).toEqual([...EXPECTED_LAYER_ORDER]);
    expect(stats.phase).toBe('night');
    expect(stats.frame).toBe(1);
    expectLayerOrder(fixture.handle, fixture.palette, 1);
  });

  it('draws every building, citizen and vehicle of the fixture in one frame', () => {
    const fixture = createRendererFixture();
    const stats = fixture.renderer.frame(12.5);

    // The camera shows the whole 48x30 city, so nothing is culled.
    expect(stats.bounds).toEqual({ x: 0, y: 0, width: GRID_WIDTH, height: GRID_HEIGHT });
    expect(stats.buildings).toBe(BUILDING_COUNT);
    expect(stats.buildings).toBe(fixture.buildings.length);
    expect(stats.citizens).toBe(fixture.citizens.length);
    expect(stats.vehicles).toBe(fixture.vehicles.length);
    expect(stats.culled).toEqual({
      tiles: 0,
      districts: 0,
      roadSegments: 0,
      roadNodes: 0,
      buildings: 0,
      citizens: 0,
      vehicles: 0,
    });

    // The scale the product asks for is met by this single frame.
    expect(stats.buildings).toBeGreaterThanOrEqual(SCALE_MINIMUMS.buildings);
    expect(stats.citizens).toBeGreaterThanOrEqual(SCALE_MINIMUMS.citizens);
    expect(stats.vehicles).toBeGreaterThanOrEqual(SCALE_MINIMUMS.vehicles);

    // Every kind of building, activity and vehicle is present and counted.
    const kindTotal = BUILDING_KINDS.reduce((sum, kind) => sum + stats.buildingsByKind[kind], 0);
    expect(kindTotal).toBe(stats.buildings);
    expect(BUILDING_KINDS.every((kind) => stats.buildingsByKind[kind] > 0)).toBe(true);
    const activityTotal = ACTIVITY_KINDS.reduce(
      (sum, kind) => sum + stats.citizensByActivity[kind],
      0,
    );
    expect(activityTotal).toBe(stats.citizens);
    const vehicleKindTotal = VEHICLE_KINDS.reduce(
      (sum, kind) => sum + stats.vehiclesByKind[kind],
      0,
    );
    expect(vehicleKindTotal).toBe(stats.vehicles);
    expect(VEHICLE_KINDS.every((kind) => stats.vehiclesByKind[kind] > 0)).toBe(true);
    expect(stats.citizensIndoors).toBeGreaterThan(0);
    expect(stats.citizensTravelling).toBeGreaterThan(0);
    expect(stats.occupantCues).toBeGreaterThan(0);
    expect(stats.districts).toBe(DISTRICTS.length);
    expect(stats.roadSegments).toBe(fixture.world.segments.length);
    expect(stats.entitiesDrawn).toBe(
      stats.buildings + stats.citizens + stats.vehicles + stats.streetlights + stats.districts,
    );
    expect(stats.contextCalls).toBeGreaterThan(0);
  });

  it('draws kind-specific silhouettes, doors, windows and terrain kinds', () => {
    const fixture = createRendererFixture();
    const stats = fixture.renderer.frame(1);
    const palette = fixture.palette;

    // Terrain is batched: far fewer fills than visible tiles, but every kind present.
    expect(stats.terrainTiles).toBe(GRID_WIDTH * GRID_HEIGHT);
    expect(stats.terrainBatches).toBe(TERRAIN_KINDS.length);
    expect(stats.terrainRects).toBeLessThan(stats.terrainTiles);
    for (const kind of TERRAIN_KINDS) {
      expect(
        styleWriteIndex(fixture.handle, 'fillStyle', palette.terrain[kind]),
        `terrain ${kind}`,
      ).toBeGreaterThanOrEqual(0);
    }

    // Buildings: doors, per-kind roofs and the specific silhouettes.
    expect(stats.buildingDoors).toBeGreaterThan(0);
    expect(stats.buildingDetails).toBeGreaterThan(0);
    for (const kind of BUILDING_KINDS) {
      if (kind === 'park') {
        continue;
      }
      expect(
        styleWriteIndex(fixture.handle, 'fillStyle', palette.building[kind].roof),
        `${kind} roof`,
      ).toBeGreaterThanOrEqual(0);
    }
    expect(styleWriteIndex(fixture.handle, 'fillStyle', palette.buildingDoor)).toBeGreaterThanOrEqual(0);

    // Lane markings and crossings come from the road network.
    expect(stats.laneMarkings).toBeGreaterThan(0);
    expect(stats.crossings).toBeGreaterThan(0);
    expect(
      fixture.handle.callsFor('setLineDash').some((call) => (call.args[0] as number[]).length === 2),
    ).toBe(true);
  });

  it('replays a recorded frame byte-for-byte', () => {
    const fixture = createRendererFixture();
    const first = fixture.renderer.frame(6);
    const firstCalls = [...fixture.handle.calls];
    const firstWrites = [...fixture.handle.writes];

    fixture.handle.reset();
    const second = fixture.renderer.frame(6);

    expect(fixture.handle.calls).toEqual(firstCalls);
    // The sky fill style is a fresh gradient object every frame, so writes are
    // compared by property + value with gradients folded together.
    expect(normaliseWrites(fixture.handle.writes)).toEqual(normaliseWrites(firstWrites));
    expect(second).toEqual({ ...first, frame: first.frame + 1 });
  });
});

describe('city renderer viewport culling', () => {
  it('draws exactly the buildings whose footprint is inside the bounds', () => {
    const fixture = createRendererFixture({ outdoorCitizens: true });
    const bounds = fixture.camera.visibleWorldBounds();
    const stats = fixture.renderer.frame(12.5);

    for (let index = 0; index < fixture.buildings.length; index += 1) {
      const building = fixture.buildings[index];
      const visible = halfOpenIntersects(building.footprint, bounds);
      const drawn = styleWriteIndex(fixture.handle, 'fillStyle', buildingColour(index)) >= 0;
      expect(drawn, `building ${index} drawn=${drawn} visible=${visible}`).toBe(visible);
    }
    expect(stats.buildings).toBe(fixture.buildings.length);
  });

  it('culls entities at several seeded camera states and draws the rest', () => {
    const fixture = createRendererFixture({ outdoorCitizens: true });
    const random = createRandom(20260917);

    for (let step = 0; step < 8; step += 1) {
      fixture.camera.zoomTo(1.25 + random() * 4);
      fixture.camera.centerOn(random() * GRID_WIDTH, random() * GRID_HEIGHT);
      const bounds = fixture.camera.visibleWorldBounds();
      fixture.handle.reset();
      const stats = fixture.renderer.frame(12.5);

      expect(stats.bounds).toEqual(bounds);

      // Buildings are culled on their exact footprint.
      let expectedBuildings = 0;
      for (let index = 0; index < fixture.buildings.length; index += 1) {
        const building = fixture.buildings[index];
        const visible = halfOpenIntersects(building.footprint, bounds);
        expectedBuildings += visible ? 1 : 0;
        const drawn = styleWriteIndex(fixture.handle, 'fillStyle', buildingColour(index)) >= 0;
        expect(drawn, `step ${step} building ${index}`).toBe(visible);
      }
      expect(stats.buildings, `step ${step}`).toBe(expectedBuildings);
      expect(stats.culled.buildings + stats.buildings).toBe(fixture.buildings.length);

      // Citizens and vehicles are culled on a puck of at most one tile, so the
      // drawn count is bounded by the strictly inside and the padded set.
      const strict = shrink(bounds, 1);
      const padded = expand(bounds, 1);
      let insideCitizens = 0;
      let outsideCitizens = 0;
      for (const citizen of fixture.citizens) {
        insideCitizens += pointInside(strict, citizen.position.x, citizen.position.y) ? 1 : 0;
        outsideCitizens += pointInside(padded, citizen.position.x, citizen.position.y) ? 0 : 1;
      }
      expect(stats.citizens, `step ${step}`).toBeGreaterThanOrEqual(insideCitizens);
      expect(stats.citizens + outsideCitizens, `step ${step}`).toBeLessThanOrEqual(
        fixture.citizens.length,
      );
      expect(stats.culled.citizens + stats.citizens).toBe(fixture.citizens.length);

      let insideVehicles = 0;
      let outsideVehicles = 0;
      // A tram is the longest body in the fixture, so a vehicle is culled on a
      // puck of at most two and a half tiles.
      const vehicleReach = expand(bounds, 2.5);
      for (const vehicle of fixture.vehicles) {
        insideVehicles += pointInside(strict, vehicle.position.x, vehicle.position.y) ? 1 : 0;
        outsideVehicles += pointInside(vehicleReach, vehicle.position.x, vehicle.position.y) ? 0 : 1;
      }
      expect(stats.vehicles, `step ${step}`).toBeGreaterThanOrEqual(insideVehicles);
      expect(stats.vehicles + outsideVehicles, `step ${step}`).toBeLessThanOrEqual(
        fixture.vehicles.length,
      );
      expect(stats.culled.vehicles + stats.vehicles).toBe(fixture.vehicles.length);

      // Off-screen roads are skipped too.
      expect(stats.culled.roadSegments + stats.roadSegments).toBe(fixture.world.segments.length);
      expect(stats.culled.tiles + stats.terrainTiles).toBe(GRID_WIDTH * GRID_HEIGHT);
    }
  });

  it('issues no entity draw at all when the camera looks at empty ground', () => {
    const fixture = createRendererFixture({ outdoorCitizens: true });

    // Search the city for a test-verified empty window at a tight zoom. The
    // expectation is computed here from the fixture, not from the renderer.
    let emptyBounds: TileRect | null = null;
    fixture.camera.zoomTo(8);
    for (let y = 0.5; y < GRID_HEIGHT && !emptyBounds; y += 0.5) {
      for (let x = 0.5; x < GRID_WIDTH; x += 0.5) {
        fixture.camera.centerOn(x, y);
        const candidate = fixture.camera.visibleWorldBounds();
        const buildingsInside = fixture.buildings.some((building) =>
          halfOpenIntersects(building.footprint, candidate),
        );
        const citizensInside = fixture.citizens.some((citizen) =>
          pointInside(expand(candidate, 1), citizen.position.x, citizen.position.y),
        );
        const vehiclesInside = fixture.vehicles.some((vehicle) =>
          pointInside(expand(candidate, 1), vehicle.position.x, vehicle.position.y),
        );
        if (!buildingsInside && !citizensInside && !vehiclesInside) {
          emptyBounds = candidate;
          break;
        }
      }
    }
    expect(emptyBounds, 'fixture has an empty region').not.toBeNull();

    fixture.camera.centerOn(emptyBounds!.x + emptyBounds!.width / 2, emptyBounds!.y + emptyBounds!.height / 2);
    const bounds = fixture.camera.visibleWorldBounds();
    const stats = fixture.renderer.frame(12.5);

    expect(stats.buildings).toBe(0);
    expect(stats.citizens).toBe(0);
    expect(stats.vehicles).toBe(0);
    expect(stats.shadows).toBe(0);
    expect(stats.windowsLit).toBe(0);
    expect(stats.culled.buildings).toBe(fixture.buildings.length);
    expect(stats.culled.citizens).toBe(fixture.citizens.length);
    expect(stats.culled.vehicles).toBe(fixture.vehicles.length);
    expect(stats.layers).not.toContain('buildings');
    expect(stats.layers).not.toContain('citizens');
    expect(stats.layers).not.toContain('vehicles');
    expect(stats.layers).not.toContain('shadows');

    // No building wall colour, citizen or vehicle body colour was ever set, and
    // the whole frame is a small fraction of the work a populated frame does.
    for (let index = 0; index < fixture.buildings.length; index += 1) {
      expect(styleWriteIndex(fixture.handle, 'fillStyle', buildingColour(index)), `building ${index}`).toBe(-1);
    }
    expect(styleWriteIndex(fixture.handle, 'fillStyle', fixture.palette.citizenHead)).toBe(-1);

    const populated = createRendererFixture({ outdoorCitizens: true });
    const populatedStats = populated.renderer.frame(12.5);
    expect(stats.contextCalls).toBeLessThan(populatedStats.contextCalls / 4);
    expect(bounds.width).toBeGreaterThan(0);
  });

  it('draws an entity that sits just inside the bounds and skips one just outside', () => {
    const fixture = createRendererFixture({ outdoorCitizens: true });
    fixture.camera.zoomTo(4);
    fixture.camera.centerOn(GRID_WIDTH / 2, GRID_HEIGHT / 2);
    const bounds = fixture.camera.visibleWorldBounds();

    const inside = { x: bounds.x + bounds.width - 1.5, y: bounds.y + bounds.height / 2 };
    const outside = { x: bounds.x + bounds.width + 0.5, y: bounds.y + bounds.height / 2 };
    fixture.buildings.push(
      {
        ...fixture.buildings[0],
        id: 'building-inside',
        kind: 'shop',
        footprint: { x: inside.x, y: inside.y, width: 1, height: 1 },
        color: '#123456',
      },
      {
        ...fixture.buildings[0],
        id: 'building-outside',
        kind: 'shop',
        footprint: { x: outside.x, y: outside.y, width: 1, height: 1 },
        color: '#654321',
      },
    );

    const withBoth = fixture.renderer.frame(12.5);
    expect(styleWriteIndex(fixture.handle, 'fillStyle', '#123456')).toBeGreaterThanOrEqual(0);
    expect(styleWriteIndex(fixture.handle, 'fillStyle', '#654321')).toBe(-1);
    expect(withBoth.buildings).toBe(
      fixture.buildings.filter((building) => halfOpenIntersects(building.footprint, bounds)).length,
    );

    fixture.buildings.pop();
    fixture.buildings.pop();
    const without = fixture.renderer.frame(12.5);
    expect(withBoth.buildings).toBe(without.buildings + 1);
  });
});

describe('city renderer day/night lighting', () => {
  it('drives window glow and streetlights from the lighting sample', () => {
    const fixture = createRendererFixture();

    fixture.handle.reset();
    const night = fixture.renderer.frame(1);
    expect(night.windowGlow).toBe(1);
    expect(night.streetlightIntensity).toBe(1);
    expect(night.windowsLit).toBeGreaterThan(0);
    expect(night.streetlights).toBeGreaterThan(0);
    expect(night.layers).toContain('windows');
    expect(night.layers).toContain('streetlights');
    expect(styleWriteIndex(fixture.handle, 'fillStyle', fixture.palette.windowGlow)).toBeGreaterThanOrEqual(0);
    expect(styleWriteIndex(fixture.handle, 'fillStyle', fixture.palette.streetlightGlow)).toBeGreaterThanOrEqual(0);

    fixture.handle.reset();
    const noon = fixture.renderer.frame(12.5);
    expect(noon.windowGlow).toBe(0);
    expect(noon.streetlightIntensity).toBe(0);
    expect(noon.windowsLit).toBe(0);
    expect(noon.streetlights).toBe(0);
    expect(noon.layers).not.toContain('windows');
    expect(noon.layers).not.toContain('streetlights');
    expect(noon.layers).toEqual([...LAYERS_WITHOUT_NIGHT_LIGHTS]);
    expect(styleWriteIndex(fixture.handle, 'fillStyle', fixture.palette.windowGlow)).toBe(-1);
    expect(styleWriteIndex(fixture.handle, 'fillStyle', fixture.palette.streetlightGlow)).toBe(-1);

    // Dusk sits between the two: some windows are lit, lamps are warming up.
    const dusk = fixture.renderer.frame(18.5);
    expect(dusk.windowGlow).toBeGreaterThan(0);
    expect(dusk.windowGlow).toBeLessThan(1);
    expect(dusk.layers).toContain('windows');
  });

  it('tints night frames dark and noon frames bright', () => {
    const fixture = createRendererFixture();

    fixture.handle.reset();
    const night = fixture.renderer.frame(1);
    const nightAmbient = recordedAmbient(fixture.handle, 1);

    fixture.handle.reset();
    const noon = fixture.renderer.frame(12.5);
    const noonAmbient = recordedAmbient(fixture.handle, 12.5);

    expect(night.ambientTint).toBe(1);
    expect(noon.ambientTint).toBe(1);
    expect(night.ambient.strength).toBeGreaterThan(noon.ambient.strength);
    expect(nightAmbient.a).toBeCloseTo(night.ambient.strength, 10);
    expect(noonAmbient.a).toBeCloseTo(noon.ambient.strength, 10);
    expect([nightAmbient.r, nightAmbient.g, nightAmbient.b]).toEqual([...night.ambient.color]);
    expect([noonAmbient.r, noonAmbient.g, noonAmbient.b]).toEqual([...noon.ambient.color]);
    expect(luminance(nightAmbient)).toBeLessThan(luminance(noonAmbient));
    expect(luminance(nightAmbient)).toBeLessThan(60);
    expect(luminance(noonAmbient)).toBeGreaterThan(180);
  });

  it('casts shadows from the lighting sample, long at dawn and short at noon', () => {
    const fixture = createRendererFixture();

    const dawnSample = sampleLighting(6);
    const dawn = fixture.renderer.frame(6);
    const noonSample = sampleLighting(12.5);
    const noon = fixture.renderer.frame(12.5);

    expect(dawn.shadowLengthFactor).toBeCloseTo(dawnSample.shadowLengthFactor, 10);
    expect(noon.shadowLengthFactor).toBeCloseTo(noonSample.shadowLengthFactor, 10);
    expect(dawn.shadowLengthFactor).toBeGreaterThan(noon.shadowLengthFactor);

    const dawnLength = Math.hypot(dawn.shadowOffset.x, dawn.shadowOffset.y);
    const noonLength = Math.hypot(noon.shadowOffset.x, noon.shadowOffset.y);
    expect(dawnLength).toBeGreaterThan(noonLength);

    // The offset is proportional to the sample's length factor and points the
    // way the sample's shadow direction does.
    expect(dawnLength / noonLength).toBeCloseTo(
      dawn.shadowLengthFactor / noon.shadowLengthFactor,
      6,
    );
    for (const [stats, sample] of [
      [dawn, dawnSample],
      [noon, noonSample],
    ] as const) {
      expect(stats.shadowOffset.x * sample.shadowDirection.x).toBeGreaterThanOrEqual(0);
      expect(stats.shadowOffset.y * sample.shadowDirection.y).toBeGreaterThanOrEqual(0);
      const cross =
        stats.shadowOffset.x * sample.shadowDirection.y - stats.shadowOffset.y * sample.shadowDirection.x;
      expect(Math.abs(cross)).toBeLessThan(1e-9);
      expect(stats.shadows).toBeGreaterThan(0);
      expect(stats.shadowAlpha).toBeGreaterThan(0);
    }
  });

  it('draws more lit windows the darker the sky gets', () => {
    const fixture = createRendererFixture();
    const counts: number[] = [];
    for (const hour of [8, 17, 19, 21, 1]) {
      counts.push(fixture.renderer.frame(hour).windowsLit);
    }
    expect(counts[0]).toBe(0); // 08:00 daylight: no window is lit at all.
    expect(counts[1]).toBeGreaterThan(0); // 17:00: the first windows come on.
    expect(counts[4]).toBeGreaterThan(counts[1]); // 01:00: a fully lit skyline.
    // The skyline only ever fills up between dusk and deep night.
    expect(counts[2]).toBeGreaterThanOrEqual(counts[1]);
    expect(counts[3]).toBeGreaterThanOrEqual(counts[2]);
    expect(counts[4]).toBeGreaterThanOrEqual(counts[3]);

    // The glow factor itself is the driver, and it brightens as night falls.
    const glows = [8, 17, 19, 21, 1].map((hour) => fixture.renderer.frame(hour).windowGlow);
    expect(glows[0]).toBe(0);
    expect(glows[4]).toBe(1);
    expect(glows[2]).toBeGreaterThan(glows[1]);
    expect(glows[4]).toBeGreaterThan(glows[3]);
  });
});

function luminance(colour: { r: number; g: number; b: number }): number {
  return 0.299 * colour.r + 0.587 * colour.g + 0.114 * colour.b;
}

describe('city renderer frame budget', () => {
  it(`renders the fixture scale inside the ${FRAME_BUDGET_MS.toFixed(2)} ms 60 fps budget`, () => {
    // The budget is one 60 fps frame. A browser frame also composites, so the
    // headless budget below is the same number with the whole margin left over.
    const fixture = createRendererFixture();
    const hours = [6.25, 12.5, 18.5, 1];

    for (let warmup = 0; warmup < 12; warmup += 1) {
      fixture.renderer.frame(hours[warmup % hours.length]);
      fixture.handle.reset();
    }

    const samples = 40;
    let maxCommands = 0;
    let drawnBuildings = 0;
    const started = performance.now();
    for (let index = 0; index < samples; index += 1) {
      const stats = fixture.renderer.frame(hours[index % hours.length]);
      maxCommands = Math.max(maxCommands, stats.contextCalls);
      drawnBuildings = stats.buildings;
      fixture.handle.reset();
    }
    const meanFrameMs = (performance.now() - started) / samples;

    expect(drawnBuildings).toBe(fixture.buildings.length);
    expect(meanFrameMs).toBeLessThan(FRAME_BUDGET_MS);
    // A full frame is a few thousand canvas calls, not tens of thousands: the
    // batching (terrain runs, lane classes, window path) is what buys the margin.
    expect(maxCommands).toBeLessThan(20_000);
  });
});

describe('city renderer lifecycle', () => {
  it('requires a context and camera, attaches, and refuses work after dispose', () => {
    const fixture = createRendererFixture({ detached: true });
    expect(fixture.renderer.attached).toBe(false);
    expect(fixture.renderer.isDisposed).toBe(false);
    expect(() => fixture.renderer.frame()).toThrow(/attach/);

    fixture.renderer.attach(fixture.handle.context.toContext2D(), fixture.camera);
    expect(fixture.renderer.attached).toBe(true);
    expect(fixture.renderer.camera).toBe(fixture.camera);
    const stats = fixture.renderer.frame(12.5);
    expect(stats.frame).toBe(1);
    expect(fixture.renderer.frameCount).toBe(1);
    expect(fixture.renderer.lastFrame).toBe(stats);

    // Re-attaching a fresh surface restarts the frame counter.
    const second = createFakeCanvas({ width: VIEWPORT.width, height: VIEWPORT.height });
    fixture.renderer.attach(second.context.toContext2D());
    expect(fixture.renderer.frameCount).toBe(0);
    expect(fixture.renderer.frame(12.5).frame).toBe(1);
    expect(fixture.handle.calls.length).toBeGreaterThan(0);

    fixture.renderer.dispose();
    fixture.renderer.dispose();
    expect(fixture.renderer.isDisposed).toBe(true);
    expect(fixture.renderer.attached).toBe(false);
    expect(() => fixture.renderer.frame()).toThrow(/dispose/);
    expect(() => fixture.renderer.attach()).toThrow(/dispose/);
  });

  it('sizes the canvas backing store by the pixel ratio', () => {
    const fixture = createRendererFixture({ pixelRatio: 2 });
    expect(fixture.renderer.pixelRatio).toBe(2);
    expect(fixture.renderer.surfaceSize).toEqual({
      width: VIEWPORT.width * 2,
      height: VIEWPORT.height * 2,
    });
    expect(fixture.handle.canvas.width).toBe(VIEWPORT.width * 2);
    expect(fixture.handle.canvas.height).toBe(VIEWPORT.height * 2);

    const stats = fixture.renderer.frame(12.5);
    expect(stats.scale).toBeCloseTo(TILE_SIZE * fixture.camera.zoom * 2, 10);
    const setTransform = fixture.handle.callsFor('setTransform')[1];
    expect(setTransform.args[0]).toBeCloseTo(stats.scale, 10);
    expect(stats.surface).toEqual({ width: VIEWPORT.width * 2, height: VIEWPORT.height * 2 });
  });

  it('re-sizes itself when the camera viewport changes', () => {
    const fixture = createRendererFixture();
    expect(fixture.renderer.surfaceSize).toEqual({
      width: VIEWPORT.width,
      height: VIEWPORT.height,
    });
    fixture.camera.resize({ width: 640, height: 480 });
    const stats = fixture.renderer.frame(12.5);
    expect(stats.surface).toEqual({ width: 640, height: 480 });
    expect(fixture.handle.canvas.width).toBe(640);
    expect(fixture.handle.canvas.height).toBe(480);
  });

  it('exposes a factory and a palette that can be overridden per layer', () => {
    const custom: RgbColor = [10, 20, 30];
    const fixture = createRendererFixture({ palette: { haze: custom, terrain: { grass: '#010203' } } });
    expect(fixture.palette.terrain.grass).toBe('#010203');
    expect(fixture.palette.terrain.road).toBe(DEFAULT_RENDERER_PALETTE.terrain.road);
    fixture.renderer.frame(12.5);
    expect(styleWriteIndex(fixture.handle, 'fillStyle', '#010203')).toBeGreaterThanOrEqual(0);
    expect(styleWriteIndex(fixture.handle, 'fillStyle', colorToCssWithAlpha(custom, sampleLighting(12.5).haze * 0.4))).toBeGreaterThanOrEqual(0);
  });

  it('rejects frames until a context is available', () => {
    const roadNetwork = buildRoadNetwork();
    const world: RendererWorld = {
      ...createTestWorldMap(),
      widthInTiles: GRID_WIDTH,
      heightInTiles: GRID_HEIGHT,
      tileSize: TILE_SIZE,
      tiles: buildTiles(),
      nodes: roadNetwork.nodes,
      segments: roadNetwork.segments,
      buildings: buildBuildings(),
    };
    const camera = createViewportCamera(world, VIEWPORT);
    const renderer = createCityRenderer({ world, camera });
    expect(renderer.attached).toBe(false);
    expect(() => renderer.frame()).toThrow();
    renderer.attach(createFakeCanvas().context.toContext2D());
    // A world without districts and without agent systems still renders.
    const stats = renderer.frame(1);
    expect(stats.districts).toBe(0);
    expect(stats.citizens).toBe(0);
    expect(stats.vehicles).toBe(0);
    expect(stats.buildings).toBeGreaterThanOrEqual(24);
    expect(stats.layers).not.toContain('districts');
    expect(stats.layers).not.toContain('citizens');
    expect(stats.layers).not.toContain('vehicles');
    renderer.dispose();
  });

  it('accepts a lighting sample and an hour interchangeably', () => {
    const fixture = createRendererFixture();
    const sample = sampleLighting(19);
    const fromSample = fixture.renderer.frame(sample);
    const fromHour = fixture.renderer.frame(19);
    expect(fromSample.hour).toBe(fromHour.hour);
    expect(fromSample.phase).toBe(fromHour.phase);
    expect(fromSample.windowsLit).toBe(fromHour.windowsLit);
    expect(fromSample.streetlights).toBe(fromHour.streetlights);
    expect(fromSample.ambient).toEqual(fromHour.ambient);
  });

  it('counts an activity and mood indicator for every citizen drawn', () => {
    const fixture = createRendererFixture();
    const stats = fixture.renderer.frame(12.5);
    expect(stats.activityIndicators).toBe(stats.citizens);
    expect(stats.moodIndicators).toBe(stats.citizens);
    // Mood rings are stamped in the mood ramp colour of the citizen's bucket.
    expect(fixture.palette.citizenRing.length).toBe(5);
    const ringColours = new Set(
      fixture.handle.writes
        .filter((write) => write.property === 'strokeStyle')
        .map((write) => String(write.value)),
    );
    expect(
      fixture.palette.citizenRing.filter((colour) => ringColours.has(colour)).length,
    ).toBeGreaterThan(1);
  });
});
