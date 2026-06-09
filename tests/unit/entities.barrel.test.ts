/**
 * Barrel tests: ensure `@/entities` and `@/systems` re-export the
 * expected symbols and don't accidentally introduce a circular import.
 */
import * as Entities from '@/entities';
import * as Systems from '@/systems';
import { isCitizen, createCitizen } from '@/entities';
import { generateCity, NeedSystem, TimeSystem } from '@/systems';
import type { BuildingId, CitizenId } from '@/types/common';

describe('Barrel exports', () => {
  it('@/entities exports Citizen and helpers', () => {
    expect(typeof Entities.createCitizen).toBe('function');
    expect(typeof Entities.activityAtHour).toBe('function');
    expect(typeof Entities.applyNeedDeltas).toBe('function');
    expect(typeof Entities.isCitizen).toBe('function');
    expect(Entities.DEFAULT_NEEDS).toBeDefined();
  });

  it('@/systems exports the expected systems', () => {
    expect(typeof Systems.TimeSystem).toBe('function');
    expect(typeof Systems.NeedSystem).toBe('function');
    expect(typeof Systems.generateCity).toBe('function');
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
});
