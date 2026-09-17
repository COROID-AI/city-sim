/**
 * Behavioural tests for the generated city world (`src/sim/world.ts`).
 *
 * The suite asserts the promises the rest of the simulation depends on: the
 * map is large, the road graph is routable, the city contains enough homes,
 * workplaces and leisure venues, generation is deterministic per seed, the
 * spatial helpers answer with correct results, and the whole `src/sim` layer
 * stays free of browser globals.
 */

import { describe, expect, it } from 'vitest';

import { BUILDING_KINDS, TERRAIN_KINDS, isInsideMap, tileIndex } from '../../src/sim/types';
import type { BuildingKind, Tile, WorldMap } from '../../src/sim/types';
import {
  AVENUE_XS,
  CityWorld,
  DEFAULT_WORLD_SEED,
  DISTRICT_KINDS,
  RESIDENTIAL_BUILDING_KINDS,
  STREET_YS,
  WORLD_HEIGHT_IN_TILES,
  WORLD_HEIGHT_PX,
  WORLD_TILE_SIZE,
  WORLD_WIDTH_IN_TILES,
  WORLD_WIDTH_PX,
  createCityWorld,
  distanceBetweenPoints,
  districtIndexForTile,
} from '../../src/sim/world';
import type { WorldBuilding } from '../../src/sim/world';

/**
 * Raw sources of the sim layer. `import.meta.glob` reads the real files without
 * pulling Node built-ins into the type-checked test project.
 */
const SIM_SOURCES = import.meta.glob('../../src/sim/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const BROWSER_GLOBAL =
  /\b(document|window|canvas|navigator|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|HTMLCanvasElement|HTMLDivElement|ImageData|OffscreenCanvas|CanvasRenderingContext2D|devicePixelRatio)\b/;
const IMPORT_SPECIFIER = /from\s+'([^']+)'/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function tileAt(world: CityWorld, x: number, y: number): Tile {
  return world.tiles[tileIndex(world.widthInTiles, x, y)];
}

function footprintIds(building: WorldBuilding): string[] {
  const ids: string[] = [];
  for (let y = building.footprint.y; y < building.footprint.y + building.footprint.height; y += 1) {
    for (let x = building.footprint.x; x < building.footprint.x + building.footprint.width; x += 1) {
      ids.push(`${x},${y}`);
    }
  }
  return ids;
}

describe('city scale', () => {
  const world = createCityWorld({ seed: 11 });

  it('covers at least 160x120 tiles at 32 px per tile', () => {
    expect(WORLD_WIDTH_IN_TILES).toBeGreaterThanOrEqual(160);
    expect(WORLD_HEIGHT_IN_TILES).toBeGreaterThanOrEqual(120);
    expect(WORLD_WIDTH_PX).toBe(WORLD_WIDTH_IN_TILES * WORLD_TILE_SIZE);
    expect(WORLD_HEIGHT_PX).toBe(WORLD_HEIGHT_IN_TILES * WORLD_TILE_SIZE);
    expect(WORLD_WIDTH_PX).toBe(5120);
    expect(WORLD_HEIGHT_PX).toBe(3840);

    // The world is much larger than any browser viewport, which is what makes
    // the minimap necessary.
    expect(WORLD_WIDTH_PX).toBeGreaterThan(1920);
    expect(WORLD_HEIGHT_PX).toBeGreaterThan(1080);

    expect(world.widthInTiles).toBe(WORLD_WIDTH_IN_TILES);
    expect(world.heightInTiles).toBe(WORLD_HEIGHT_IN_TILES);
    expect(world.tileSize).toBe(WORLD_TILE_SIZE);
    expect(world.tiles).toHaveLength(WORLD_WIDTH_IN_TILES * WORLD_HEIGHT_IN_TILES);
  });

  it('fills every tile with valid row-major grid data', () => {
    let misplaced = 0;
    let badTerrain = 0;
    for (const tile of world.tiles) {
      if (!isInsideMap(world, tile.x, tile.y)) {
        misplaced += 1;
        continue;
      }
      if (world.tiles[tileIndex(world.widthInTiles, tile.x, tile.y)] !== tile) {
        misplaced += 1;
      }
      if (!TERRAIN_KINDS.includes(tile.terrain)) {
        badTerrain += 1;
      }
    }
    expect(misplaced).toBe(0);
    expect(badTerrain).toBe(0);
    expect(world.tiles[0]).toMatchObject({ x: 0, y: 0 });
    expect(world.tiles[world.tiles.length - 1]).toMatchObject({
      x: WORLD_WIDTH_IN_TILES - 1,
      y: WORLD_HEIGHT_IN_TILES - 1,
    });
  });

  it('stamps road tiles along the avenue and street grid', () => {
    const roadTiles = world.tiles.filter((tile) => tile.terrain === 'road');
    expect(roadTiles.length).toBeGreaterThan(0);
    let onGrid = 0;
    let missingSegment = 0;
    let buildingOnRoad = 0;
    for (const tile of roadTiles) {
      if (AVENUE_XS.includes(tile.x) || STREET_YS.includes(tile.y)) {
        onGrid += 1;
      }
      if (tile.segmentId === null || world.roadSegmentById(tile.segmentId) === null) {
        missingSegment += 1;
      }
      if (tile.buildingId !== null) {
        buildingOnRoad += 1;
      }
    }
    expect(onGrid).toBe(roadTiles.length);
    expect(missingSegment).toBe(0);
    expect(buildingOnRoad).toBe(0);

    let straySegments = 0;
    for (const tile of world.tiles) {
      if (tile.terrain !== 'road' && tile.segmentId !== null) {
        straySegments += 1;
      }
    }
    expect(straySegments).toBe(0);
  });
});

describe('districts', () => {
  const world = createCityWorld({ seed: 12 });

  it('covers the map with nine named quarters', () => {
    expect(world.districts).toHaveLength(9);
    expect(new Set(world.districts.map((district) => district.kind))).toEqual(new Set(DISTRICT_KINDS));
    expect(new Set(world.districts.map((district) => district.id)).size).toBe(9);
    for (const district of world.districts) {
      expect(district.name.length).toBeGreaterThan(0);
      expect(district.streetName.length).toBeGreaterThan(0);
      expect(district.bounds.width).toBeGreaterThan(0);
      expect(district.bounds.height).toBeGreaterThan(0);
      expect(district.buildingIds.length).toBeGreaterThan(0);
      expect(district.roadNodeIds.length).toBeGreaterThan(0);
      for (const roadNodeId of district.roadNodeIds) {
        const node = world.roadNodeById(roadNodeId);
        expect(node).not.toBeNull();
        const point = { x: node === null ? 0 : node.x, y: node === null ? 0 : node.y };
        expect(world.districtAt(point).id).toBe(district.id);
      }
    }
  });

  it('maps any tile into exactly one district', () => {
    expect(districtIndexForTile(0, 0, WORLD_WIDTH_IN_TILES, WORLD_HEIGHT_IN_TILES)).toBe(0);
    expect(
      districtIndexForTile(WORLD_WIDTH_IN_TILES - 1, 0, WORLD_WIDTH_IN_TILES, WORLD_HEIGHT_IN_TILES),
    ).toBe(2);
    expect(
      districtIndexForTile(0, WORLD_HEIGHT_IN_TILES - 1, WORLD_WIDTH_IN_TILES, WORLD_HEIGHT_IN_TILES),
    ).toBe(6);
    expect(
      districtIndexForTile(
        WORLD_WIDTH_IN_TILES - 1,
        WORLD_HEIGHT_IN_TILES - 1,
        WORLD_WIDTH_IN_TILES,
        WORLD_HEIGHT_IN_TILES,
      ),
    ).toBe(8);
    expect(world.districtAt({ x: world.widthInTiles / 2, y: world.heightInTiles / 2 }).id).toBe(
      world.districts[4].id,
    );
  });

  it('lists its buildings by district', () => {
    for (const district of world.districts) {
      const buildings = world.buildingsInDistrict(district.id);
      expect(buildings.map((building) => building.id)).toEqual(
        district.buildingIds.slice().sort(),
      );
      expect(buildings.every((building) => building.districtId === district.id)).toBe(true);
    }
    expect(world.buildingsInDistrict('district-does-not-exist')).toEqual([]);
  });
});

describe('road network', () => {
  const world = createCityWorld({ seed: 13 });

  it('builds every avenue/street intersection as a road node', () => {
    expect(world.nodes).toHaveLength(AVENUE_XS.length * STREET_YS.length);
    expect(world.nodes.length).toBeGreaterThan(0);
    expect(world.segments.length).toBeGreaterThan(0);
    expect(new Set(world.nodes.map((node) => node.id)).size).toBe(world.nodes.length);
    expect(new Set(world.segments.map((segment) => segment.id)).size).toBe(world.segments.length);
  });

  it('links segments and neighbour lists consistently', () => {
    const nodeIds = new Set(world.nodes.map((node) => node.id));
    for (const segment of world.segments) {
      expect(nodeIds.has(segment.fromNodeId)).toBe(true);
      expect(nodeIds.has(segment.toNodeId)).toBe(true);
      expect(segment.length).toBeGreaterThan(0);
      expect(segment.lanes).toBeGreaterThanOrEqual(1);
      expect(segment.speedLimit).toBeGreaterThan(0);
      const from = world.roadNodeById(segment.fromNodeId);
      const to = world.roadNodeById(segment.toNodeId);
      expect(from).not.toBeNull();
      expect(to).not.toBeNull();
      if (from && to) {
        expect(distanceBetweenPoints({ x: from.x, y: from.y }, { x: to.x, y: to.y })).toBeCloseTo(
          segment.length,
          9,
        );
        expect(from.neighborIds).toContain(to.id);
        expect(to.neighborIds).toContain(from.id);
      }
    }

    let asymmetric = 0;
    for (const node of world.nodes) {
      if (node.neighborIds.length < 2) {
        asymmetric += 1;
        continue;
      }
      for (const neighborId of node.neighborIds) {
        const neighbor = world.roadNodeById(neighborId);
        if (!neighbor || !neighbor.neighborIds.includes(node.id)) {
          asymmetric += 1;
        }
      }
    }
    expect(asymmetric).toBe(0);
  });

  it('classifies nodes and lights intersections', () => {
    for (const node of world.nodes) {
      expect(['intersection', 'junction', 'dead-end']).toContain(node.kind);
      expect(node.hasTrafficLight).toBe(node.neighborIds.length >= 3);
      expect(node.kind).toBe(node.neighborIds.length >= 4 ? 'intersection' : 'junction');
      expect(node.speedLimit).toBeGreaterThan(0);
    }
    expect(world.nodes.some((node) => node.kind === 'intersection')).toBe(true);
    expect(world.nodes.some((node) => node.hasTrafficLight)).toBe(true);
    expect(isInsideMap(world, world.nodes[0].x, world.nodes[0].y)).toBe(true);
  });

  it('forms one connected graph covering every node', () => {
    expect(world.isRoadNetworkConnected()).toBe(true);

    const visited = new Set<string>([world.spawnNodeId]);
    const queue = [world.spawnNodeId];
    while (queue.length > 0) {
      const current = world.roadNodeById(queue.shift() as string);
      expect(current).not.toBeNull();
      for (const neighborId of current === null ? [] : current.neighborIds) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
    expect(visited.size).toBe(world.nodes.length);
  });
});

describe('buildings', () => {
  const world = createCityWorld({ seed: 14 });
  const stats = world.stats();

  it('places at least 24 buildings spanning several kinds', () => {
    expect(world.buildings.length).toBeGreaterThanOrEqual(24);
    expect(stats.buildingCount).toBe(world.buildings.length);
    const kinds = new Set(world.buildings.map((building) => building.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
    for (const kind of BUILDING_KINDS) {
      expect(world.buildingsOfKind(kind).every((building) => building.kind === kind)).toBe(true);
    }
    const residentialKinds = RESIDENTIAL_BUILDING_KINDS.filter((kind) => kinds.has(kind));
    expect(residentialKinds.length).toBeGreaterThanOrEqual(1);
    expect(kinds.has('shop')).toBe(true);
    expect(kinds.has('office')).toBe(true);
    expect(kinds.has('park')).toBe(true);
    expect(kinds.has('civic')).toBe(true);
    expect(kinds.has('factory') || kinds.has('warehouse')).toBe(true);
  });

  it('supplies homes, workplaces and entertainment venues', () => {
    const residential = world.buildings.filter(
      (building) => building.kind === 'house' || building.kind === 'apartment',
    );
    const residentialCapacity = residential.reduce((total, building) => total + building.capacity, 0);
    expect(residential.length).toBeGreaterThanOrEqual(6);
    expect(residentialCapacity).toBeGreaterThanOrEqual(60);
    expect(stats.residentialCapacity).toBe(residentialCapacity);
    expect(stats.residentialBuildingCount).toBe(residential.length);

    const jobBuildings = world.buildings.filter(
      (building) => building.jobSlots > 0 && building.kind !== 'house' && building.kind !== 'apartment',
    );
    expect(jobBuildings.length).toBeGreaterThanOrEqual(12);
    expect(stats.jobBuildingCount).toBe(jobBuildings.length);
    expect(stats.jobSlotCount).toBe(
      world.buildings.reduce((total, building) => total + building.jobSlots, 0),
    );
    expect(stats.jobSlotCount).toBeGreaterThanOrEqual(12);

    const venues = world.leisureVenues();
    expect(venues.length).toBeGreaterThanOrEqual(3);
    expect(venues.length).toBe(stats.leisureVenueCount);
    expect(venues.every((venue) => venue.leisure)).toBe(true);
    expect(world.buildings.some((building) => building.kind === 'park' && building.leisure)).toBe(true);

    const landmarks = world.landmarks();
    expect(landmarks.length).toBeGreaterThanOrEqual(1);
    expect(landmarks.length).toBe(stats.landmarkCount);
    expect(landmarks.every((building) => building.landmark)).toBe(true);
  });

  it('gives every building an id, address, footprint and capacity data', () => {
    const seenIds = new Set<string>();
    const tileOwners = new Map<string, string>();
    let overlaps = 0;
    let badEntrances = 0;
    let unreachableEntrances = 0;

    for (const building of world.buildings) {
      expect(seenIds.has(building.id)).toBe(false);
      seenIds.add(building.id);
      expect(building.name.length).toBeGreaterThan(0);
      expect(building.address).toMatch(/^\d+ \S+/);
      expect(building.floors).toBeGreaterThanOrEqual(1);
      expect(building.capacity).toBeGreaterThanOrEqual(1);
      expect(building.jobSlots).toBeGreaterThanOrEqual(0);
      expect(building.occupantIds).toEqual([]);
      expect(building.residentHouseholdIds).toEqual([]);
      expect(building.companyId).toBeNull();
      expect(world.buildingById(building.id)?.id).toBe(building.id);
      expect(world.districtAt(buildingCenter(building)).id).toBe(building.districtId);

      const rect = building.footprint;
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(world.widthInTiles);
      expect(rect.y + rect.height).toBeLessThanOrEqual(world.heightInTiles);

      const entrance = world.accessNodeForBuilding(building.id);
      if (entrance === null || entrance.id !== building.entranceNodeId) {
        badEntrances += 1;
      }
      const accessPoint = world.accessPointForBuilding(building.id);
      if (accessPoint === null) {
        unreachableEntrances += 1;
      } else {
        const nearest = world.nearestRoadNode(accessPoint);
        expect(distanceBetweenPoints(accessPoint, { x: nearest.x, y: nearest.y })).toBeLessThanOrEqual(24);
      }

      for (const key of footprintIds(building)) {
        const owner = tileOwners.get(key);
        if (owner !== undefined && owner !== building.id) {
          overlaps += 1;
        }
        tileOwners.set(key, building.id);
        const [x, y] = key.split(',').map(Number);
        const tile = tileAt(world, x, y);
        expect(tile.buildingId).toBe(building.id);
        expect(tile.terrain).not.toBe('road');
      }
    }

    expect(badEntrances).toBe(0);
    expect(unreachableEntrances).toBe(0);
    expect(overlaps).toBe(0);
    expect(seenIds.size).toBe(world.buildings.length);
    expect(world.buildingById('building-does-not-exist')).toBeNull();
  });
});

describe('determinism', () => {
  it('rebuilds the same city for the same seed', () => {
    const first = new CityWorld({ seed: 'coroid-city' });
    const second = new CityWorld({ seed: 'coroid-city' });

    expect(first.serialize()).toBe(second.serialize());
    expect(first.serialize()).toBe(first.serialize());
    expect(first.id).toBe(second.id);
    expect(first.seed).toBe(second.seed);
    expect(first.tiles).toEqual(second.tiles);
    expect(first.avenueXs).toEqual(second.avenueXs);
    expect(first.streetYs).toEqual(second.streetYs);
    expect(first.buildings.map((building) => building.id)).toEqual(
      second.buildings.map((building) => building.id),
    );
    expect(first.districts.map((district) => district.id)).toEqual(
      second.districts.map((district) => district.id),
    );
  });

  it('serialises districts, roads and buildings as one canonical document', () => {
    const world = createCityWorld({ seed: 15 });
    const snapshot = world.snapshot();
    expect(JSON.parse(world.serialize())).toEqual(snapshot);
    expect(snapshot.buildings).toHaveLength(world.buildings.length);
    expect(snapshot.nodes).toHaveLength(world.nodes.length);
    expect(snapshot.segments).toHaveLength(world.segments.length);
    expect(snapshot.districts).toHaveLength(world.districts.length);

    // Snapshots are detached copies, so callers cannot corrupt the live world.
    snapshot.buildings[0].footprint.x = -999;
    expect(world.buildings[0].footprint.x).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(world.serialize())).toEqual(world.snapshot());
  });

  it('accepts numeric and string seeds alike and defaults sensibly', () => {
    expect(createCityWorld(42).serialize()).toBe(new CityWorld({ seed: 42 }).serialize());
    expect(createCityWorld('42').serialize()).toBe(new CityWorld({ seed: '42' }).serialize());
    expect(new CityWorld().serialize()).toBe(new CityWorld({ seed: DEFAULT_WORLD_SEED }).serialize());
  });

  it('produces a different but equally valid city for another seed', () => {
    const base = createCityWorld({ seed: 'seed-a' });
    const other = createCityWorld({ seed: 'seed-b' });

    expect(other.serialize()).not.toBe(base.serialize());
    expect(other.buildings.length).toBeGreaterThanOrEqual(24);
    expect(other.isRoadNetworkConnected()).toBe(true);
    expect(other.areAllBuildingsAccessible()).toBe(true);
    expect(
      other.nearestRoadNode({ x: other.widthInTiles / 2, y: other.heightInTiles / 2 }).id,
    ).toBe(other.spawnNodeId);
    expect(new Set(other.buildings.map((building) => building.id)).size).toBe(other.buildings.length);
  });
});

describe('spatial queries', () => {
  const world = createCityWorld({ seed: 16 });

  it('returns buildings by kind', () => {
    for (const kind of BUILDING_KINDS) {
      const queried = world.buildingsOfKind(kind);
      const expected = world.buildings
        .filter((building) => building.kind === kind)
        .map((building) => building.id)
        .sort();
      expect(queried.map((building) => building.id)).toEqual(expected);
    }
  });

  it('returns buildings within a radius, nearest first', () => {
    const center = { x: world.widthInTiles / 2, y: world.heightInTiles / 2 };
    const radius = 40;
    const found = world.buildingsWithinRadius(center, radius);
    const expected = world.buildings.filter(
      (building) => distanceBetweenPoints(buildingCenter(building), center) <= radius,
    );
    expect(found).toHaveLength(expected.length);
    expect(new Set(found.map((building) => building.id))).toEqual(
      new Set(expected.map((building) => building.id)),
    );

    let previous = -1;
    for (const building of found) {
      const distance = distanceBetweenPoints(buildingCenter(building), center);
      expect(distance).toBeLessThanOrEqual(radius);
      expect(distance).toBeGreaterThanOrEqual(previous);
      previous = distance;
    }

    const tighter = world.buildingsWithinRadius(center, radius / 4);
    expect(tighter.length).toBeLessThanOrEqual(found.length);
    expect(tighter.every((building) => found.includes(building))).toBe(true);
    expect(world.buildingsWithinRadius(center, 0).length).toBeLessThanOrEqual(1);
    expect(() => world.buildingsWithinRadius(center, -5)).toThrow(RangeError);
  });

  it('finds the nearest building of a kind', () => {
    const probes = [
      { x: 4, y: 4 },
      { x: world.widthInTiles / 2, y: world.heightInTiles / 2 },
      { x: world.widthInTiles - 4, y: world.heightInTiles - 4 },
    ];
    for (const point of probes) {
      for (const kind of ['house', 'shop', 'office', 'park'] as BuildingKind[]) {
        const nearest = world.nearestBuildingOfKind(point, kind);
        const candidates = world.buildingsOfKind(kind);
        expect(candidates.length).toBeGreaterThan(0);
        expect(nearest).not.toBeNull();
        const bruteForce = candidates.reduce((best, building) =>
          distanceBetweenPoints(buildingCenter(building), point) <
          distanceBetweenPoints(buildingCenter(best), point)
            ? building
            : best,
        );
        expect(nearest?.id).toBe(bruteForce.id);
      }
    }
    expect(world.nearestBuilding(probes[0], { kind: 'house' })?.id).toBe(
      world.nearestBuildingOfKind(probes[0], 'house')?.id,
    );
    expect(world.nearestBuilding(probes[0], { leisureOnly: true })?.leisure).toBe(true);
    expect(world.nearestBuilding(probes[0], { landmarkOnly: true })?.landmark).toBe(true);
  });

  it('snaps any world coordinate onto the nearest road node', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 1.5, y: 77.25 },
      { x: world.widthInTiles - 1, y: world.heightInTiles - 1 },
      { x: world.spawnNodeId.length, y: 0 },
    ];
    for (const point of samples) {
      const nearest = world.nearestRoadNode(point);
      const bruteForce = world.nodes.reduce((best, node) =>
        distanceBetweenPoints({ x: node.x, y: node.y }, point) <
        distanceBetweenPoints({ x: best.x, y: best.y }, point)
          ? node
          : best,
      );
      expect(nearest.id).toBe(bruteForce.id);
      expect(nearest.id).toBe(world.nearestRoadNode({ x: nearest.x, y: nearest.y }).id);
    }
  });

  it('converts between tile and pixel world units', () => {
    expect(world.tileToPixel({ x: 3, y: 4 })).toEqual({ x: 96, y: 128 });
    expect(world.pixelToTile(world.tileToPixel({ x: 7.5, y: 2.25 }))).toEqual({ x: 7.5, y: 2.25 });
  });

  it('answers with the road node nearest to a building access point', () => {
    const building = world.buildings[0];
    const accessPoint = world.accessPointForBuilding(building.id);
    expect(accessPoint).not.toBeNull();
    const node = world.nearestRoadNode(accessPoint as { x: number; y: number });
    expect(node.id).toBe(building.entranceNodeId);
  });
});

describe('routing', () => {
  const world = createCityWorld({ seed: 17 });
  const home = world.buildingsOfKind('house')[0];
  const workplace = world.buildingsOfKind('office')[0];

  it('routes between two building access points with distances in tiles', () => {
    const route = world.routeBetweenBuildings(home.id, workplace.id);
    expect(route).not.toBeNull();
    if (!route) {
      return;
    }
    expect(route.nodeIds[0]).toBe(home.entranceNodeId);
    expect(route.nodeIds[route.nodeIds.length - 1]).toBe(workplace.entranceNodeId);
    expect(route.segmentIds).toHaveLength(route.nodeIds.length - 1);
    expect(route.distanceTiles).toBeGreaterThan(0);
    expect(route.distancePx).toBeCloseTo(route.distanceTiles * world.tileSize, 9);
    expect(route.travelMinutes).toBeGreaterThan(0);
    expect(route.averageSpeedLimit).toBeGreaterThan(0);

    const summed = route.segmentIds.reduce(
      (total, segmentId) => total + (world.roadSegmentById(segmentId)?.length ?? 0),
      0,
    );
    expect(route.distanceTiles).toBeCloseTo(summed, 9);
    expect(route.steps).toHaveLength(route.nodeIds.length);
    expect(route.steps[0].segmentId).toBeNull();
    expect(route.steps[route.steps.length - 1].distanceTiles).toBeCloseTo(route.distanceTiles, 9);

    // Routes are at least as long as the straight line between the nodes.
    const from = world.roadNodeById(route.fromNodeId);
    const to = world.roadNodeById(route.toNodeId);
    expect(route.distanceTiles).toBeGreaterThanOrEqual(
      from && to ? distanceBetweenPoints({ x: from.x, y: from.y }, { x: to.x, y: to.y }) - 1e-9 : 0,
    );
  });

  it('is stable for the same world and symmetric in distance', () => {
    const outbound = world.routeBetweenBuildings(home.id, workplace.id);
    const again = world.routeBetweenBuildings(home.id, workplace.id);
    expect(again).toEqual(outbound);

    const inbound = world.routeBetweenBuildings(workplace.id, home.id);
    expect(inbound).not.toBeNull();
    expect(inbound?.distanceTiles).toBeCloseTo(outbound?.distanceTiles ?? 0, 9);
    expect(world.routeBetweenPoints({ x: 20, y: 20 }, { x: 60, y: 60 })).toEqual(
      world.routeBetweenPoints({ x: 20, y: 20 }, { x: 60, y: 60 }),
    );
  });

  it('handles trivial and impossible routes', () => {
    const self = world.routeBetweenBuildings(home.id, home.id);
    expect(self).not.toBeNull();
    expect(self?.nodeIds).toEqual([home.entranceNodeId]);
    expect(self?.distanceTiles).toBe(0);
    expect(self?.travelMinutes).toBe(0);

    expect(world.routeBetweenNodes('node-unknown', world.spawnNodeId)).toBeNull();
    expect(world.routeBetweenNodes(world.spawnNodeId, 'node-unknown')).toBeNull();
    expect(world.routeBetweenBuildings('building-unknown', home.id)).toBeNull();
    expect(world.accessPointForBuilding('building-unknown')).toBeNull();
    expect(world.accessNodeForBuilding('building-unknown')).toBeNull();
  });

  it('routes from any world coordinate across the whole city', () => {
    const long = world.routeBetweenPoints({ x: 0, y: 0 }, { x: 159, y: 119 });
    expect(long).not.toBeNull();
    expect(long?.distanceTiles).toBeGreaterThan(100);
    expect(long?.distancePx).toBeCloseTo((long?.distanceTiles ?? 0) * world.tileSize, 9);
    for (const step of long?.steps ?? []) {
      const node = world.roadNodeById(step.nodeId);
      expect(node).not.toBeNull();
      expect(isInsideMap(world, node?.x ?? 0, node?.y ?? 0)).toBe(true);
    }
  });

  it('reaches every building and every node from the spawn point', () => {
    for (const node of world.nodes) {
      expect(world.routeBetweenNodes(world.spawnNodeId, node.id)).not.toBeNull();
    }
    const origin = world.buildings[0].entranceNodeId;
    expect(origin).not.toBeNull();
    for (const building of world.buildings) {
      expect(building.entranceNodeId).not.toBeNull();
      expect(
        world.routeBetweenNodes(origin as string, building.entranceNodeId as string),
      ).not.toBeNull();
    }
  });
});

describe('lifecycle', () => {
  it('advances its clock without changing generated geometry', () => {
    const world = createCityWorld({ seed: 18 });
    const before = world.serialize();
    const spawn = world.spawnNodeId;

    expect(world.elapsedMinutes).toBe(0);
    const stats = world.update(15);
    expect(world.elapsedMinutes).toBe(15);
    expect(stats.buildingCount).toBe(world.buildings.length);
    expect(world.update(0).buildingCount).toBe(world.buildings.length);
    expect(() => world.update(-1)).toThrow(RangeError);
    expect(() => world.update(Number.NaN)).toThrow(RangeError);

    expect(world.serialize()).toBe(before);
    expect(world.spawnNodeId).toBe(spawn);
    expect(world.isRoadNetworkConnected()).toBe(true);
  });

  it('conforms to the shared WorldMap contract', () => {
    const world: WorldMap = createCityWorld({ seed: 19 });
    expect(world.widthInTiles).toBe(WORLD_WIDTH_IN_TILES);
    expect(world.tiles).toHaveLength(world.widthInTiles * world.heightInTiles);
    expect(world.citizens).toEqual([]);
    expect(world.companies).toEqual([]);
    expect(world.vehicles).toEqual([]);
    expect(world.households).toEqual([]);
  });
});

describe('dom-free guard', () => {
  const sources = Object.entries(SIM_SOURCES);

  it('keeps every src/sim module free of browser globals', () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const [path, source] of sources) {
      expect(stripComments(source), `${path} must not reference a browser global`).not.toMatch(
        BROWSER_GLOBAL,
      );
    }
  });

  it('imports only the platform-agnostic sim modules from world.ts', () => {
    const entry = sources.find(([path]) => path.endsWith('/sim/world.ts'));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? '';
    const specifiers = [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(new Set(specifiers)).toEqual(new Set(['./rng', './types']));
  });
});

function buildingCenter(building: WorldBuilding): { x: number; y: number } {
  return {
    x: building.footprint.x + building.footprint.width / 2,
    y: building.footprint.y + building.footprint.height / 2,
  };
}
