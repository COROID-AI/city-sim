/**
 * Cross-system event-instrumentation tests.
 *
 * Verifies the AC that says:
 *   - TimeSystem emits `new_day` on hour transition
 *   - CommuteManager emits `commute_arrived` on citizen restoration
 *   - TrafficSystem emits `traffic_jam` after the threshold + duration
 */
import { type Citizen, createCitizen } from '@/entities';
import type { Vector2, CitizenId, VehicleId, BuildingId } from '@/types/common';
import { EventBus, type CityEventMap } from '@/systems/EventBus';
import { TimeSystem } from '@/systems/TimeSystem';
import { TrafficSystem, DEFAULT_JAM_DURATION_MS, DEFAULT_JAM_THRESHOLD } from '@/systems/TrafficSystem';
import { CommuteManager } from '@/systems/CommuteManager';

const HOME_ID = 'bldg-home' as BuildingId;
const WORK_ID = 'bldg-work' as BuildingId;
const CITIZEN_ID = 'citizen-1' as CitizenId;
const VEHICLE_ID = 'vehicle-1' as VehicleId;

function makeCitizen(): Citizen {
  return createCitizen({
    id: CITIZEN_ID,
    position: { x: 0, y: 0 },
    name: 'Alice',
    homeId: HOME_ID,
    workplaceId: WORK_ID,
    schedule: Array.from({ length: 24 }, () => 'work' as const),
  });
}

describe('TimeSystem event emission', () => {
  it('emits new_day when the in-game day counter rolls over', () => {
    const bus = new EventBus<CityEventMap>();
    const events: Array<{ day: number }> = [];
    bus.on('new_day', (p) => events.push(p));
    const time = new TimeSystem();
    time.setBus(bus);
    // 1 in-game minute = 1000/60 ms of real time at timeScale=60.
    // 1 in-game day = 24 * 60 = 1440 minutes = 1440 * 1000 ms at scale 1.
    // Use scale 1 to make the math simple: 1 real ms = 1 in-game ms.
    // Advance enough real time at the default scale (60) to roll over
    // multiple in-game days. 24*60*60*1000 ms = 1 real day; with
    // timeScale=60 that's 1440 in-game minutes = 1 in-game day.
    time.tick(24 * 60 * 60 * 1000);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.day).toBeGreaterThan(0);
  });
});

describe('CommuteManager event emission', () => {
  it('emits commute_arrived when a citizen is restored', () => {
    const bus = new EventBus<CityEventMap>();
    const arrivals: Array<{ citizenId: CitizenId; destination: Vector2 }> = [];
    bus.on('commute_arrived', (p) => arrivals.push(p));
    const mgr = new CommuteManager({ bus, idFactory: (): string => VEHICLE_ID });
    const citizen = makeCitizen();
    const path: Vector2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    mgr.beginCommute(citizen, path);
    // Tick until the vehicle arrives.
    let ticks = 0;
    while (ticks < 10) {
      const result = mgr.tick([citizen]);
      if (result.restoredCitizens.length > 0) break;
      ticks += 1;
    }
    expect(arrivals.length).toBe(1);
    expect(arrivals[0]?.citizenId).toBe(CITIZEN_ID);
  });
});

describe('TrafficSystem event emission', () => {
  it('emits traffic_jam when a tile stays over the threshold for jamDurationMs', () => {
    const bus = new EventBus<CityEventMap>();
    const jams: Array<{ tileKey: string; vehicleCount: number }> = [];
    bus.on('traffic_jam', (p) => jams.push(p));
    const traffic = new TrafficSystem({
      bus,
      jamThreshold: 2,
      jamDurationMs: 0, // any single report fires the jam
    });
    traffic.reportTileOccupancy('1,1', 5);
    expect(jams.length).toBe(1);
    expect(jams[0]?.tileKey).toBe('1,1');
  });

  it('emits traffic_clear when a jammed tile returns below threshold', () => {
    const bus = new EventBus<CityEventMap>();
    const clears: string[] = [];
    bus.on('traffic_clear', (p) => clears.push(p.tileKey));
    const traffic = new TrafficSystem({
      bus,
      jamThreshold: 2,
      jamDurationMs: 0,
    });
    traffic.reportTileOccupancy('1,1', 5);
    traffic.reportTileOccupancy('1,1', 0);
    expect(clears).toEqual(['1,1']);
  });

  it('does not emit traffic_jam below the threshold', () => {
    const bus = new EventBus<CityEventMap>();
    const fn = jest.fn();
    bus.on('traffic_jam', fn);
    const traffic = new TrafficSystem({ bus, jamThreshold: DEFAULT_JAM_THRESHOLD, jamDurationMs: DEFAULT_JAM_DURATION_MS });
    traffic.reportTileOccupancy('1,1', 1);
    expect(fn).not.toHaveBeenCalled();
  });
});
