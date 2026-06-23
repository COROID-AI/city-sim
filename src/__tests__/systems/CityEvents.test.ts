/**
 * CityEvents integration tests — verify each system emits the correct typed
 * event through EventBus.
 */
import { EventBus } from '@/systems/EventBus';
import { TimeSystem, MS_PER_DAY } from '@/systems/TimeSystem';
import { MovementSystem } from '@/systems/MovementSystem';
import { TrafficSystem, TRAFFIC_JAM_MIN } from '@/systems/TrafficSystem';
import { BusinessHoursSystem, COMPANY_OPEN_HOUR, COMPANY_CLOSE_HOUR } from '@/systems/BusinessHoursSystem';
import { Citizen } from '@/entities/Citizen';
import { Vehicle } from '@/entities/Vehicle';
import { World } from '@/engine/World';
import type { Building, CityEvent } from '@/engine/types';

/** Helper: collect all events emitted during `fn` into an array. */
function captureEvents(bus: EventBus, fn: () => void): CityEvent[] {
  const events: CityEvent[] = [];
  const unsub = bus.on('*', (e) => events.push(e));
  fn();
  unsub();
  return events;
}

/** Build a minimal commercial building for BusinessHoursSystem tests. */
function makeBuilding(id: string, type: Building['type']): Building {
  return {
    id,
    type,
    zone: 'commercial',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    def: {
      id: type,
      name: type,
      type,
      width: 1,
      height: 1,
      cost: 0,
      upkeep: 0,
      capacity: 1,
      color: '#fff',
    },
  };
}

describe('CityEvents — system event emission', () => {
  describe('TimeSystem → new_day', () => {
    it('emits new_day when the day counter increments', () => {
      const bus = new EventBus();
      const time = new TimeSystem(bus);
      time.setSpeed(1);

      const events = captureEvents(bus, () => {
        // Advance past one full sim-day (MS_PER_DAY / 288 real ms at 1x).
        time.update(MS_PER_DAY / 288 + 1);
      });

      const newDay = events.filter((e) => e.type === 'new_day');
      expect(newDay.length).toBe(1);
      expect(newDay[0]!.data.day).toBe(1);
    });

    it('does not emit new_day when still within the same day', () => {
      const bus = new EventBus();
      const time = new TimeSystem(bus);
      time.setSpeed(1);

      const events = captureEvents(bus, () => {
        time.update(1000); // small step, well under a day
      });

      expect(events.filter((e) => e.type === 'new_day')).toHaveLength(0);
    });
  });

  describe('MovementSystem → citizen_arrived', () => {
    it('emits citizen_arrived when a walking citizen reaches their target', () => {
      const bus = new EventBus();
      const movement = new MovementSystem();
      const citizen = new Citizen({ x: 0, y: 0 }, { id: 'c1' });
      // Position the citizen just within arrival threshold of the target.
      citizen.setTarget({ x: 0.1, y: 0 });
      const time = { day: 0, hour: 8, minute: 0, totalMs: 0 };

      const events = captureEvents(bus, () => {
        movement.update([citizen], 50, {
          buildings: new Map(),
          eventBus: bus,
          time,
        });
      });

      const arrived = events.filter((e) => e.type === 'citizen_arrived');
      expect(arrived).toHaveLength(1);
      expect(arrived[0]!.data.citizenId).toBe('c1');
    });

    it('does not emit when no EventBus is provided (backward compat)', () => {
      const movement = new MovementSystem();
      const citizen = new Citizen({ x: 0, y: 0 }, { id: 'c1' });
      citizen.setTarget({ x: 0.1, y: 0 });

      expect(() => {
        movement.update([citizen], 50, { buildings: new Map() });
      }).not.toThrow();
    });
  });

  describe('TrafficSystem → traffic_jam', () => {
    it('emits traffic_jam when stopped count exceeds the threshold', () => {
      const bus = new EventBus();
      const traffic = new TrafficSystem({ eventBus: bus });
      const time = { day: 0, hour: 8, minute: 0, totalMs: 0 };

      // Add enough stopped vehicles to exceed the dynamic threshold.
      // With 10 vehicles the threshold is min(5, ceil(10*0.5)) = 5.
      for (let i = 0; i < 10; i++) {
        const v = new Vehicle({ x: i, y: 0 }, { isStopped: true });
        traffic.addVehicle(v);
      }

      const events = captureEvents(bus, () => {
        traffic.update(50, time);
      });

      const jams = events.filter((e) => e.type === 'traffic_jam');
      expect(jams).toHaveLength(1);
      expect(jams[0]!.data.stoppedCount).toBeGreaterThanOrEqual(TRAFFIC_JAM_MIN);
    });

    it('debounces: does not re-emit while the jam persists', () => {
      const bus = new EventBus();
      const traffic = new TrafficSystem({ eventBus: bus });
      const time = { day: 0, hour: 8, minute: 0, totalMs: 0 };

      for (let i = 0; i < 10; i++) {
        traffic.addVehicle(new Vehicle({ x: i, y: 0 }, { isStopped: true }));
      }

      // First update triggers the jam event.
      let events = captureEvents(bus, () => traffic.update(50, time));
      expect(events.filter((e) => e.type === 'traffic_jam')).toHaveLength(1);

      // Second update with jam still active should NOT re-emit.
      events = captureEvents(bus, () => traffic.update(50, time));
      expect(events.filter((e) => e.type === 'traffic_jam')).toHaveLength(0);
    });

    it('does not emit when fewer than half the vehicles are stopped', () => {
      const bus = new EventBus();
      const traffic = new TrafficSystem({ eventBus: bus });
      const time = { day: 0, hour: 8, minute: 0, totalMs: 0 };

      // 10 vehicles, only 2 stopped. Threshold = min(5, ceil(10*0.5)) = 5.
      // 2 < 5, so no jam should be reported.
      for (let i = 0; i < 10; i++) {
        const v = new Vehicle({ x: i, y: 0 }, { isStopped: i < 2 });
        traffic.addVehicle(v);
      }

      const events = captureEvents(bus, () => traffic.update(50, time));
      expect(events.filter((e) => e.type === 'traffic_jam')).toHaveLength(0);
    });
  });

  describe('BusinessHoursSystem → company_opened / company_closed', () => {
    it('emits company_opened at hour 8 for commercial buildings', () => {
      const bus = new EventBus();
      const world = new World(10, 10);
      world.addBuilding(makeBuilding('shop-1', 'shop'));
      world.addBuilding(makeBuilding('office-1', 'office'));
      world.addBuilding(makeBuilding('house-1', 'house'));
      const system = new BusinessHoursSystem(world, { eventBus: bus });

      const events = captureEvents(bus, () => {
        system.update({ day: 0, hour: COMPANY_OPEN_HOUR, minute: 0, totalMs: 0 });
      });

      const opened = events.filter((e) => e.type === 'company_opened');
      // shop + office = 2; house is excluded.
      expect(opened).toHaveLength(2);
      const ids = opened.map((e) => e.data.buildingId).sort();
      expect(ids).toEqual(['office-1', 'shop-1']);
    });

    it('emits company_closed at hour 18 for commercial/industrial buildings', () => {
      const bus = new EventBus();
      const world = new World(10, 10);
      world.addBuilding(makeBuilding('factory-1', 'factory'));
      const system = new BusinessHoursSystem(world, { eventBus: bus });

      const events = captureEvents(bus, () => {
        system.update({ day: 0, hour: COMPANY_CLOSE_HOUR, minute: 0, totalMs: 0 });
      });

      const closed = events.filter((e) => e.type === 'company_closed');
      expect(closed).toHaveLength(1);
      expect(closed[0]!.data.buildingType).toBe('factory');
    });

    it('does not emit on non-transition hours', () => {
      const bus = new EventBus();
      const world = new World(10, 10);
      world.addBuilding(makeBuilding('shop-1', 'shop'));
      const system = new BusinessHoursSystem(world, { eventBus: bus });

      const events = captureEvents(bus, () => {
        system.update({ day: 0, hour: 12, minute: 0, totalMs: 0 });
      });

      expect(events).toHaveLength(0);
    });

    it('emits only once per hour (not once per simulation step)', () => {
      const bus = new EventBus();
      const world = new World(10, 10);
      world.addBuilding(makeBuilding('shop-1', 'shop'));
      const system = new BusinessHoursSystem(world, { eventBus: bus });
      const hour8 = { day: 0, hour: COMPANY_OPEN_HOUR, minute: 0, totalMs: 0 };

      system.update(hour8);
      const events = captureEvents(bus, () => system.update(hour8));

      expect(events).toHaveLength(0);
    });
  });
});
