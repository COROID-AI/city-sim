import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_KINDS,
  BUILDING_KINDS,
  COMPANY_SECTORS,
  DAY_PHASES,
  NEED_KINDS,
  ROAD_NODE_KINDS,
  TERRAIN_KINDS,
  VEHICLE_KINDS,
  isInsideMap,
  tileIndex,
} from '../../src/sim/types';
import type {
  ActivityKind,
  Building,
  BuildingKind,
  Citizen,
  Company,
  CompanySector,
  DayPhase,
  EconomySnapshot,
  EntityId,
  Household,
  HudStats,
  Need,
  NeedKind,
  Occupation,
  RoadNode,
  RoadNodeKind,
  RoadSegment,
  ScheduleSlot,
  TerrainKind,
  Tile,
  TileRect,
  Vec2,
  Vehicle,
  VehicleKind,
  VehicleRoute,
  WorldMap,
} from '../../src/sim/types';

/**
 * Every `src/sim` module loaded as source text, so the DOM-free boundary can be
 * asserted against the real files instead of a hand-maintained list.
 */
const simSources = import.meta.glob('../../src/sim/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const DOM_ONLY_GLOBALS =
  /\b(document|window|navigator|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|HTMLCanvasElement|HTMLDivElement|ImageData|OffscreenCanvas|CanvasRenderingContext2D|devicePixelRatio)\b/;

describe('domain contracts', () => {
  it('instantiates a representative object for every exported contract', () => {
    const id: EntityId = 'citizen-1';
    const position: Vec2 = { x: 1.5, y: 2.25 };
    const footprint: TileRect = { x: 0, y: 0, width: 2, height: 3 };
    const phase: DayPhase = 'dawn';
    const activity: ActivityKind = 'work';
    const needKind: NeedKind = 'hunger';
    const sector: CompanySector = 'retail';
    const buildingKind: BuildingKind = 'shop';
    const nodeKind: RoadNodeKind = 'intersection';
    const terrain: TerrainKind = 'road';
    const vehicleKind: VehicleKind = 'bus';

    const need: Need = { kind: needKind, level: 38, growthPerHour: 1.5 };
    const slot: ScheduleSlot = { activity, startHour: 8, endHour: 16, destinationId: 'building-shop' };
    const household: Household = {
      id: 'household-1',
      homeBuildingId: 'building-home',
      memberIds: [id],
      funds: 1_000,
    };
    const occupation: Occupation = {
      title: 'Shopkeeper',
      sector,
      companyId: 'company-1',
      workplaceBuildingId: 'building-shop',
      shiftStartHour: 8,
      shiftEndHour: 16,
      wagePerHour: 12,
    };
    const citizen: Citizen = {
      id,
      name: 'Ada',
      age: 30,
      householdId: household.id,
      household,
      homeBuildingId: household.homeBuildingId,
      occupation,
      income: 96,
      mood: 0.8,
      needs: [need],
      schedule: [slot],
      currentActivity: activity,
      insideBuildingId: 'building-shop',
      position,
      vehicleId: null,
    };
    const company: Company = {
      id: 'company-1',
      name: 'Corner Shop',
      sector,
      buildingId: 'building-shop',
      employees: [citizen.id],
      employeeCount: 1,
      revenue: 500,
      costs: 300,
      cash: 2_000,
      openHour: 8,
      closeHour: 20,
      color: '#c9884a',
    };
    const building: Building = {
      id: 'building-home',
      kind: buildingKind,
      name: 'Home',
      footprint,
      floors: 2,
      capacity: 4,
      occupantIds: [citizen.id],
      residentHouseholdIds: [household.id],
      companyId: company.id,
      entranceNodeId: 'node-1',
      color: '#8fb7d8',
    };
    const node: RoadNode = {
      id: 'node-1',
      kind: nodeKind,
      x: 2,
      y: 4,
      neighborIds: ['node-2'],
      speedLimit: 0.5,
      hasTrafficLight: true,
    };
    const segment: RoadSegment = {
      id: 'segment-1',
      fromNodeId: node.id,
      toNodeId: 'node-2',
      length: 4,
      lanes: 2,
      speedLimit: 0.5,
    };
    const tile: Tile = { x: 2, y: 4, terrain, buildingId: building.id, segmentId: segment.id };
    const route: VehicleRoute = { id: 'route-1', kind: 'loop', stopNodeIds: [node.id], loop: true };
    const vehicle: Vehicle = {
      id: 'vehicle-1',
      kind: vehicleKind,
      plate: 'CITY-001',
      capacity: 40,
      route,
      occupancy: 1,
      occupantIds: [citizen.id],
      fuel: 80,
      fuelCapacity: 120,
      speed: 0.3,
      headingRadians: 1.2,
      position,
      currentNodeId: node.id,
      targetNodeId: 'node-2',
      ownerCompanyId: company.id,
      color: '#e0e6f2',
    };
    const world: WorldMap = {
      id: 'world-1',
      widthInTiles: 4,
      heightInTiles: 4,
      tileSize: 24,
      tiles: [tile],
      nodes: [node],
      segments: [segment],
      buildings: [building],
      households: [household],
      citizens: [citizen],
      companies: [company],
      vehicles: [vehicle],
      spawnNodeId: node.id,
    };
    const snapshot: EconomySnapshot = {
      day: 0,
      hour: 12,
      minute: 0,
      totalMinutes: 720,
      population: world.citizens.length,
      companyCount: world.companies.length,
      employedCitizens: 1,
      employmentRate: 1,
      unemploymentRate: 0,
      averageWage: occupation.wagePerHour,
      totalRevenue: company.revenue,
      totalCosts: company.costs,
      netProfit: company.revenue - company.costs,
      cityBudget: 10_000,
      taxRate: 0.12,
      sectorRevenue: { ...emptySectors(), retail: company.revenue },
      sectorCosts: { ...emptySectors(), retail: company.costs },
      averageMood: citizen.mood,
    };
    const hud: HudStats = {
      population: 1,
      employedCitizens: 1,
      employmentRate: 1,
      cityTimeLabel: 'Day 1, 12:00',
      cityBudget: snapshot.cityBudget,
      day: 0,
      hour: 12,
      minute: 0,
      phase,
      citizenCount: 1,
      vehicleCount: 1,
      companyCount: 1,
      buildingCount: 1,
      averageMood: citizen.mood,
    };

    expect(citizen.occupation.companyId).toBe(company.id);
    expect(citizen.schedule).toHaveLength(1);
    expect(citizen.needs[0].kind).toBe('hunger');
    expect(citizen.household.memberIds).toContain(citizen.id);
    expect(company.employeeCount).toBe(company.employees.length);
    expect(vehicle.occupancy).toBe(vehicle.occupantIds.length);
    expect(world.tiles).toHaveLength(1);
    expect(snapshot.netProfit).toBe(200);
    expect(hud.phase).toBe('dawn');
  });

  it('exports the runtime kind lists used to build the world', () => {
    expect(DAY_PHASES).toEqual(['night', 'dawn', 'morning', 'day', 'evening']);
    expect(ACTIVITY_KINDS).toEqual(['home', 'work', 'errand', 'entertainment']);
    expect(NEED_KINDS).toEqual(['hunger', 'energy', 'social', 'fun', 'hygiene']);
    expect(COMPANY_SECTORS).toHaveLength(6);
    expect(BUILDING_KINDS).toContain('apartment');
    expect(ROAD_NODE_KINDS).toEqual(['intersection', 'junction', 'dead-end']);
    expect(TERRAIN_KINDS).toContain('water');
    expect(VEHICLE_KINDS).toContain('tram');
  });

  it('indexes and bounds-checks the tile grid', () => {
    expect(tileIndex(8, 0, 0)).toBe(0);
    expect(tileIndex(8, 3, 2)).toBe(19);
    const map = { widthInTiles: 8, heightInTiles: 4 };
    expect(isInsideMap(map, 7, 3)).toBe(true);
    expect(isInsideMap(map, 8, 3)).toBe(false);
    expect(isInsideMap(map, -1, 0)).toBe(false);
  });
});

function emptySectors(): Record<CompanySector, number> {
  return {
    retail: 0,
    office: 0,
    manufacturing: 0,
    logistics: 0,
    hospitality: 0,
    civic: 0,
  };
}

describe('src/sim module boundary', () => {
  it('reads every sim module and covers the expected files', () => {
    const paths = Object.keys(simSources).sort();
    expect(paths.length).toBeGreaterThanOrEqual(4);
    for (const expected of ['clock.ts', 'engine.ts', 'rng.ts', 'types.ts']) {
      expect(paths.some((path) => path.endsWith(`/sim/${expected}`))).toBe(true);
    }
  });

  it('never references browser or canvas globals', () => {
    for (const [path, source] of Object.entries(simSources)) {
      const match = DOM_ONLY_GLOBALS.exec(source);
      expect(match?.[1], `${path} must stay DOM-free but references "${match?.[1]}"`).toBeUndefined();
    }
  });
});
