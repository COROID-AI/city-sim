/**
 * Barrel tests: ensure `@/entities` and `@/systems` re-export the
 * expected symbols and don't accidentally introduce a circular import.
 */
import * as Entities from '@/entities';
import * as Systems from '@/systems';
import {
  isCitizen,
  createCitizen,
  buildRoadGraph,
  createVehicle,
  advanceVehicle,
  tileKey,
} from '@/entities';
import {
  generateCity,
  NeedSystem,
  TimeSystem,
  TrafficSystem,
} from '@/systems';
import type { BuildingId, CitizenId, VehicleId } from '@/types/common';

describe('Barrel exports', () => {
  it('@/entities exports Citizen, Road, and Vehicle helpers', () => {
    expect(typeof Entities.createCitizen).toBe('function');
    expect(typeof Entities.activityAtHour).toBe('function');
    expect(typeof Entities.applyNeedDeltas).toBe('function');
    expect(typeof Entities.isCitizen).toBe('function');
    expect(Entities.DEFAULT_NEEDS).toBeDefined();
    expect(typeof Entities.buildRoadGraph).toBe('function');
    expect(typeof Entities.defaultNeighborCost).toBe('function');
    expect(typeof Entities.tileKey).toBe('function');
    expect(typeof Entities.createVehicle).toBe('function');
    expect(typeof Entities.advanceVehicle).toBe('function');
  });

  it('@/systems exports the expected systems', () => {
    expect(typeof Systems.TimeSystem).toBe('function');
    expect(typeof Systems.NeedSystem).toBe('function');
    expect(typeof Systems.generateCity).toBe('function');
    expect(typeof Systems.TrafficSystem).toBe('function');
    expect(Systems.DEFAULT_ACTIVITY_DELTAS).toBeDefined();
  });

  it('does not throw on a circular-safe import chain', () => {
    const buildings = [
      {
        id: 'bldg-w-0' as BuildingId,
        position: { x: 0, y: 0 },
        capacity: 50,
      },
    ];
    const city = generateCity(buildings, { seed: 1, citizenCount: 60 });
    const sys = new NeedSystem(city.citizens, { timeProvider: new TimeSystem() });
    sys.update();
    for (const c of sys.getCitizens()) {
      expect(isCitizen(c)).toBe(true);
    }
    // Touch createCitizen to keep the import live.
    const probe = createCitizen({
      id: 'probe' as CitizenId,
      position: { x: 0, y: 0 },
      name: 'Probe',
      homeId: 'bldg-home-probe' as BuildingId,
      workplaceId: null,
      schedule: new Array(24).fill('sleep'),
    });
    expect(probe.id).toBe('probe');
  });

  it('Road and Vehicle can be wired through the entities barrel end-to-end', () => {
    // Build a 3x3 intersection grid, find a path, and drive a vehicle.
    const grid = [
      ['intersection', 'intersection', 'intersection'],
      ['intersection', 'intersection', 'intersection'],
      ['intersection', 'intersection', 'intersection'],
    ] as const;
    const g = buildRoadGraph(grid);
    const path = Entities.findPath(g, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    let v = createVehicle({
      id: 'veh-barrel' as VehicleId,
      position: { x: 0, y: 0 },
      path: path!,
    });
    v = advanceVehicle(v);
    expect(v.position).toEqual({ x: 1, y: 0 });

    // And TrafficSystem can be wired through the systems barrel.
    const traffic = new TrafficSystem({ greenDurationMs: 50, allRedDurationMs: 10 });
    expect(traffic.getCurrentPhase()).toBe('NS_GREEN');
    expect(traffic.isIntersectionOpen(tileKey(0, 0))).toBe(true);
  });
});
