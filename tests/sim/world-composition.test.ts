/**
 * Composition tests for the city world against the foundation contracts.
 *
 * The world task consumes `src/sim/types.ts` (domain contracts), `src/sim/rng.ts`
 * (deterministic generation) and the shared fixture in `tests/helpers`. These
 * tests assert the integration the later schedule, traffic and economy systems
 * depend on: the generated city *is* a `WorldMap`, every building access point
 * resolves onto its own routing graph, and every route is expressed in the
 * domain's tile units.
 */

import { describe, expect, it } from 'vitest';

import type { SimSystem } from '../../src/sim/engine';
import { isInsideMap, tileIndex } from '../../src/sim/types';
import type { BuildingKind, WorldMap } from '../../src/sim/types';
import { createSimFixture, createTestWorldMap } from '../helpers/sim-fixtures';
import { CityWorld, createCityWorld, distanceBetweenPoints } from '../../src/sim/world';
import type { WorldBuilding, WorldStats } from '../../src/sim/world';

const WORKPLACE_KINDS: readonly BuildingKind[] = [
  'office',
  'shop',
  'factory',
  'warehouse',
  'school',
  'hospital',
  'civic',
];

/** Asserts the structural promises of the shared `WorldMap` contract. */
function expectWorldMapContract(map: WorldMap): void {
  expect(Number.isInteger(map.widthInTiles)).toBe(true);
  expect(Number.isInteger(map.heightInTiles)).toBe(true);
  expect(map.widthInTiles).toBeGreaterThan(0);
  expect(map.heightInTiles).toBeGreaterThan(0);
  expect(Number.isFinite(map.tileSize)).toBe(true);
  expect(map.tileSize).toBeGreaterThan(0);
  expect(map.tiles).toHaveLength(map.widthInTiles * map.heightInTiles);
  expect(map.nodes.length).toBeGreaterThan(0);
  expect(map.segments.length).toBeGreaterThan(0);
  expect(map.buildings.length).toBeGreaterThan(0);
  expect(map.spawnNodeId).not.toBeNull();

  const nodeIds = new Set(map.nodes.map((node) => node.id));
  expect(map.spawnNodeId === null ? false : nodeIds.has(map.spawnNodeId)).toBe(true);
  for (const segment of map.segments) {
    expect(nodeIds.has(segment.fromNodeId)).toBe(true);
    expect(nodeIds.has(segment.toNodeId)).toBe(true);
  }
  for (const building of map.buildings) {
    expect(building.footprint.width).toBeGreaterThan(0);
    expect(building.footprint.height).toBeGreaterThan(0);
    if (building.entranceNodeId !== null) {
      expect(nodeIds.has(building.entranceNodeId)).toBe(true);
    }
  }

  const first = map.tiles[0];
  const last = map.tiles[map.tiles.length - 1];
  for (const tile of [first, last]) {
    expect(isInsideMap(map, tile.x, tile.y)).toBe(true);
    expect(map.tiles[tileIndex(map.widthInTiles, tile.x, tile.y)]).toBe(tile);
  }
}

describe('world / foundation contracts', () => {
  it('builds the city from the shared seeded fixture and conforms to WorldMap', () => {
    const fixture = createSimFixture({ seed: 'city-world-composition' });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const asWorldMap: WorldMap = world;
      expectWorldMapContract(asWorldMap);

      // The same seed always produces the same city, in this process or another.
      expect(createCityWorld({ seed: fixture.rng.seed }).serialize()).toBe(world.serialize());
      expect(new CityWorld({ seed: fixture.rng.seed }).serialize()).toBe(world.serialize());

      // The world only provides places: population is owned by later systems.
      expect(asWorldMap.citizens).toEqual([]);
      expect(asWorldMap.companies).toEqual([]);
      expect(asWorldMap.vehicles).toEqual([]);
      expect(asWorldMap.households).toEqual([]);
    } finally {
      fixture.dispose();
    }
  });

  it('keeps the foundation test fixture a valid WorldMap too', () => {
    const fixtureWorld = createTestWorldMap();
    expectWorldMapContract(fixtureWorld);
    expect(fixtureWorld.citizens.length).toBeGreaterThan(0);
  });

  it('serves every building access point from its own routing graph', () => {
    const world = createCityWorld({ seed: 1_234 });
    const nodeIds = new Set(world.nodes.map((node) => node.id));

    for (const building of world.buildings) {
      expect(building.entranceNodeId).not.toBeNull();
      const entranceNodeId = building.entranceNodeId as string;
      expect(nodeIds.has(entranceNodeId)).toBe(true);

      const accessPoint = world.accessPointForBuilding(building.id);
      expect(accessPoint).not.toBeNull();
      if (accessPoint === null) {
        continue;
      }
      const node = world.nearestRoadNode(accessPoint);
      expect(nodeIds.has(node.id)).toBe(true);
      expect(node.id).toBe(entranceNodeId);
      expect(distanceBetweenPoints(accessPoint, { x: node.x, y: node.y })).toBeLessThanOrEqual(24);
    }

    expect(world.areAllBuildingsAccessible()).toBe(true);
    expect(world.isRoadNetworkConnected()).toBe(true);
  });

  it('expresses every sampled route in domain world-coordinate units', () => {
    const world = createCityWorld({ seed: 'routes' });
    const origin = world.buildings[0];

    for (const building of world.buildings) {
      const route = world.routeBetweenBuildings(origin.id, building.id);
      expect(route).not.toBeNull();
      if (!route) {
        continue;
      }
      expect(route.distanceTiles).toBeGreaterThanOrEqual(0);
      expect(route.distancePx).toBeCloseTo(route.distanceTiles * world.tileSize, 9);
      expect(route.nodeIds[0]).toBe(origin.entranceNodeId);
      expect(route.nodeIds[route.nodeIds.length - 1]).toBe(building.entranceNodeId);
      for (const step of route.steps) {
        const node = world.roadNodeById(step.nodeId);
        expect(node).not.toBeNull();
        expect(isInsideMap(world, node?.x ?? 0, node?.y ?? 0)).toBe(true);
      }
    }

    const trip = world.routeBetweenPoints({ x: 2, y: 2 }, { x: 158, y: 118 });
    expect(trip).not.toBeNull();
    if (trip) {
      expect(trip.distanceTiles).toBeGreaterThan(100);
      const expectedMinutes = trip.segmentIds.reduce((total, segmentId) => {
        const segment = world.roadSegmentById(segmentId);
        return segment === null ? total : total + segment.length / segment.speedLimit;
      }, 0);
      expect(trip.travelMinutes).toBeCloseTo(expectedMinutes, 9);
      expect(trip.averageSpeedLimit).toBeCloseTo(trip.distanceTiles / trip.travelMinutes, 9);
    }
  });

  it('supplies the homes, workplaces and entertainment venues later systems consume', () => {
    const world = createCityWorld({ seed: 'supply' });

    const homes = world.buildings.filter(
      (building) => building.kind === 'house' || building.kind === 'apartment',
    );
    expect(homes.length).toBeGreaterThanOrEqual(6);
    expect(homes.reduce((total, home) => total + home.capacity, 0)).toBeGreaterThanOrEqual(60);
    expect(homes.every((home) => home.residentHouseholdIds.length === 0)).toBe(true);

    const workplaces = world.buildings.filter(
      (building) => WORKPLACE_KINDS.includes(building.kind) && building.jobSlots > 0,
    );
    expect(workplaces.length).toBeGreaterThanOrEqual(12);
    // Premises are vacant until the company system moves businesses in.
    expect(workplaces.every((workplace) => workplace.companyId === null)).toBe(true);

    const venues: WorldBuilding[] = [...world.leisureVenues()];
    expect(venues.length).toBeGreaterThanOrEqual(3);
    expect(venues.every((venue) => venue.leisure)).toBe(true);

    const home = homes[0];
    for (const venue of venues.slice(0, 5)) {
      expect(world.routeBetweenBuildings(home.id, venue.id)).not.toBeNull();
    }
    for (const workplace of workplaces.slice(0, 5)) {
      expect(world.routeBetweenBuildings(home.id, workplace.id)).not.toBeNull();
    }

    const stats: WorldStats = world.stats();
    expect(stats.residentialCapacity).toBeGreaterThanOrEqual(60);
    expect(stats.jobBuildingCount).toBeGreaterThanOrEqual(12);
    expect(stats.leisureVenueCount).toBe(venues.length);
    expect(stats.buildingCount).toBeGreaterThanOrEqual(24);
    expect(stats.districtCount).toBe(9);
  });

  it('lets the simulation engine drive the world without changing its geometry', () => {
    const fixture = createSimFixture({ seed: 'world-engine', startHour: 6 });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const before = world.serialize();
      let observed: WorldStats | null = null;

      const reader: SimSystem = {
        name: 'world-reader',
        update() {
          observed = world.stats();
          world.update(1);
        },
      };
      fixture.engine.attach(reader);

      expect(fixture.advanceMinutes(120)).toBe(120);
      expect(observed).not.toBeNull();
      expect((observed as unknown as WorldStats).buildingCount).toBe(world.buildings.length);
      expect(world.elapsedMinutes).toBe(120);
      expect(world.serialize()).toBe(before);
      expect(world.citizens).toHaveLength(0);
      expect(world.routeBetweenNodes(world.spawnNodeId, world.nodes[0].id)).not.toBeNull();
    } finally {
      fixture.dispose();
    }
  });

  it('keeps a differently seeded city equally valid', () => {
    const first = createCityWorld({ seed: 'alpha' });
    const second = createCityWorld({ seed: 'beta' });
    expect(first.serialize()).not.toBe(second.serialize());

    for (const world of [first, second]) {
      expectWorldMapContract(world);
      expect(world.buildings.length).toBeGreaterThanOrEqual(24);
      expect(world.isRoadNetworkConnected()).toBe(true);
      expect(world.areAllBuildingsAccessible()).toBe(true);
      for (const building of world.buildings.slice(0, 10)) {
        expect(world.routeBetweenNodes(world.spawnNodeId, building.entranceNodeId as string)).not.toBeNull();
      }
    }
  });
});
