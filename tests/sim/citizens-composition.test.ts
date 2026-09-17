/**
 * Composition tests: the citizen system running on the foundation engine.
 *
 * This suite wires the three upstream pieces together exactly the way the app
 * composition will: the seeded `CityWorld` (homes, workplaces, leisure venues,
 * routes), the fixture `SimulationEngine` with its fixed-step `SimClock`, and
 * `CitizensSystem`. It then advances one full simulated day and asserts the
 * integrated behaviour: every citizen walks exactly one complete schedule cycle
 * in the order home -> commute -> work -> lunch -> work -> entertainment ->
 * commute home, stays inside the building the schedule names, ends the night at
 * home, keeps building occupancy in sync, moves across the world while
 * commuting, and publishes commute intents for the traffic task - all without
 * touching the world's geometry.
 */

import { describe, expect, it } from 'vitest';

import { MINUTES_PER_DAY } from '../../src/sim/clock';
import {
  CITIZENS_SYSTEM_NAME,
  COMMUTE_MODES,
  ROUTINE_STAGES,
  STAGES_BY_ACTIVITY,
  CitizensSystem,
} from '../../src/sim/citizens';
import type { CommuteIntent, RoutineStage } from '../../src/sim/citizens';
import { NEED_KINDS } from '../../src/sim/types';
import type { Building } from '../../src/sim/types';
import { createCityWorld } from '../../src/sim/world';
import { createSimFixture, SIM_DAY_MINUTES } from '../helpers/sim-fixtures';
import type { SimFixture } from '../helpers/sim-fixtures';

/** Next stage on the routine ring; `null` is impossible for a valid stage. */
function nextStage(stage: RoutineStage): RoutineStage {
  const index = ROUTINE_STAGES.indexOf(stage);
  return ROUTINE_STAGES[(index + 1) % ROUTINE_STAGES.length];
}

/**
 * Asserts a stage log is exactly one trip around the routine ring: every stage
 * visited once, always followed by the next stage in {@link ROUTINE_STAGES},
 * and the log closing back on its first stage when it happens to wrap.
 */
function expectOneFullCycle(observed: readonly RoutineStage[], label: string): void {
  expect(observed.length, label).toBeGreaterThanOrEqual(ROUTINE_STAGES.length);
  expect(observed.length, label).toBeLessThanOrEqual(ROUTINE_STAGES.length + 1);
  const stages = observed.slice();
  if (stages.length === ROUTINE_STAGES.length + 1) {
    expect(stages[0], label).toBe(stages[stages.length - 1]);
    stages.pop();
  }
  expect(new Set(stages).size, label).toBe(ROUTINE_STAGES.length);
  for (let index = 0; index < stages.length; index += 1) {
    expect(stages[(index + 1) % stages.length], label).toBe(nextStage(stages[index]));
  }
}

/** Stage-independent summary of a building collection, for regression checks. */
function geometryFingerprint(fixtureWorld: ReturnType<typeof createCityWorld>): string {
  return JSON.stringify({
    nodes: fixtureWorld.nodes,
    segments: fixtureWorld.segments,
    buildings: fixtureWorld.buildings.map((building) => ({
      id: building.id,
      kind: building.kind,
      footprint: building.footprint,
      capacity: building.capacity,
      jobSlots: building.jobSlots,
      entranceNodeId: building.entranceNodeId,
      leisure: building.leisure,
    })),
  });
}

describe('citizens / engine + world composition', () => {
  it('runs one complete schedule cycle per citizen over a simulated day', () => {
    const fixture: SimFixture = createSimFixture({
      seed: 'citizens-composition',
      startHour: 0,
      minutesPerTick: 1,
    });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const geometryBefore = geometryFingerprint(world);

      const citizens = new CitizensSystem({ world, count: 72, seed: fixture.rng.seed });
      // The integration owner path: the engine attaches the produced system.
      fixture.engine.attach(citizens);
      expect(fixture.engine.getSystem(CITIZENS_SYSTEM_NAME)).toBe(citizens);
      expect(fixture.engine.systemCount).toBe(3); // fixture alpha + beta + citizens

      const observedStages = new Map<string, RoutineStage[]>();
      const stageTicks = new Map<string, Map<RoutineStage, number>>();
      const homeTicks = new Map<string, number>();
      const intents = new Map<string, CommuteIntent>();
      const moodStart = new Map<string, number>();
      const moodEnd = new Map<string, number>();
      const needStart = new Map<string, number>();
      const needEnd = new Map<string, number>();
      let maxOccupancyDrift = 0;

      const tick = (): void => {
        const insideCount = world.buildings.reduce((total, building) => total + building.occupantIds.length, 0);
        let listedCitizens = 0;
        for (const citizen of citizens.citizens) {
          const live = citizens.liveStateFor(citizen.id);
          expect(live).not.toBeNull();
          if (!live) {
            continue;
          }
          const stages = observedStages.get(citizen.id) ?? [];
          if (stages[stages.length - 1] !== live.stage) {
            stages.push(live.stage);
          }
          observedStages.set(citizen.id, stages);

          const perStage = stageTicks.get(citizen.id) ?? new Map<RoutineStage, number>();
          perStage.set(live.stage, (perStage.get(live.stage) ?? 0) + 1);
          stageTicks.set(citizen.id, perStage);

          if (live.insideBuildingId === citizen.homeBuildingId) {
            homeTicks.set(citizen.id, (homeTicks.get(citizen.id) ?? 0) + 1);
          }

          const building = world.buildingById(live.insideBuildingId ?? '');
          if (live.insideBuildingId === null) {
            expect(live.travelling).toBe(true);
            expect(STAGES_BY_ACTIVITY[live.activity]).toContain(live.stage);
          } else {
            expect(building).not.toBeNull();
            expect(building?.occupantIds).toContain(citizen.id);
            expect(citizen.position).toEqual(world.accessPointForBuilding(live.insideBuildingId));
            listedCitizens += 1;
          }

          if (live.commuteIntent) {
            intents.set(
              `${live.commuteIntent.citizenId}:${live.commuteIntent.fromBuildingId}->${live.commuteIntent.toBuildingId}`,
              live.commuteIntent,
            );
          }
        }
        maxOccupancyDrift = Math.max(maxOccupancyDrift, insideCount - listedCitizens);
        for (const citizen of citizens.citizens) {
          moodEnd.set(citizen.id, citizen.mood);
          needEnd.set(
            citizen.id,
            citizen.needs.reduce((total, need) => total + need.level, 0),
          );
        }
      };

      for (const citizen of citizens.citizens) {
        moodStart.set(citizen.id, citizen.mood);
        needStart.set(
          citizen.id,
          citizen.needs.reduce((total, need) => total + need.level, 0),
        );
      }

      for (let minute = 0; minute < SIM_DAY_MINUTES; minute += 1) {
        const previousTicks = fixture.engine.tickCount;
        fixture.advanceMinutes(1);
        expect(fixture.engine.tickCount).toBe(previousTicks + 1);
        tick();
      }

      // One full sim-day really elapsed on the engine's fixed-step clock.
      expect(SIM_DAY_MINUTES).toBe(MINUTES_PER_DAY);
      expect(fixture.engine.tickCount).toBe(SIM_DAY_MINUTES);
      expect(fixture.clock.totalMinutes).toBe(SIM_DAY_MINUTES);
      expect(fixture.clock.day).toBe(1);
      expect(fixture.clock.hourOfDay).toBe(0);
      expect(citizens.updateCount).toBe(SIM_DAY_MINUTES);

      // Every citizen walked exactly one complete cycle, in the required order.
      for (const citizen of citizens.citizens) {
        const stages = observedStages.get(citizen.id) ?? [];
        expectOneFullCycle(stages, citizen.id);

        const perStage = stageTicks.get(citizen.id) ?? new Map<RoutineStage, number>();
        for (const stage of ROUTINE_STAGES) {
          expect(perStage.get(stage) ?? 0).toBeGreaterThan(0);
        }
        // Night hours are spent at home, and the day ends where it began.
        expect(perStage.get('home') ?? 0).toBeGreaterThanOrEqual(240);
        expect(homeTicks.get(citizen.id) ?? 0).toBeGreaterThanOrEqual(240);
        expect(citizens.routineFor(citizen.id)?.blocks[0].destinationId).toBe(citizen.homeBuildingId);
      }

      // Occupancy bookkeeping never drifts: every citizen inside a building is
      // listed exactly once, and nobody is left behind in a building they left.
      expect(maxOccupancyDrift).toBe(0);
      const occupancyTotal = world.buildings.reduce(
        (total, building) => total + building.occupantIds.length,
        0,
      );
      expect(occupancyTotal).toBe(
        citizens.citizens.filter((citizen) => citizen.insideBuildingId !== null).length,
      );
      for (const building of world.buildings as Building[]) {
        expect(new Set(building.occupantIds).size).toBe(building.occupantIds.length);
      }

      // Commute intents are published for the traffic task, one per leg, and
      // always between two real buildings over the road network.
      expect(intents.size).toBeGreaterThanOrEqual(citizens.citizens.length * 3);
      for (const intent of intents.values()) {
        expect(COMMUTE_MODES).toContain(intent.mode);
        expect(world.buildingById(intent.fromBuildingId)).not.toBeNull();
        expect(world.buildingById(intent.toBuildingId)).not.toBeNull();
        expect(intent.nodeIds.length).toBeGreaterThan(0);
        expect(intent.distanceTiles).toBeGreaterThan(0);
        expect(intent.durationMinutes).toBeGreaterThanOrEqual(6);
        expect(intent.citizenId).toMatch(/^citizen-\d+$/);
        // Citizens only publish intent: the traffic task spawns the vehicles.
        expect(citizens.citizenById(intent.citizenId)?.vehicleId).toBeNull();
      }
      const departures = new Set([...intents.values()].map((intent) => intent.citizenId));
      expect(departures.size).toBe(citizens.citizens.length);

      // Live mood and needs moved on from their generated values, in range.
      let moodChanged = 0;
      let needsGrew = 0;
      for (const citizen of citizens.citizens) {
        for (const need of citizen.needs) {
          expect(need.level).toBeGreaterThanOrEqual(0);
          expect(need.level).toBeLessThanOrEqual(100);
        }
        expect(citizen.mood).toBeGreaterThanOrEqual(0);
        expect(citizen.mood).toBeLessThanOrEqual(1);
        if (Math.abs((moodEnd.get(citizen.id) ?? 0) - (moodStart.get(citizen.id) ?? 0)) > 0.001) {
          moodChanged += 1;
        }
        if ((needEnd.get(citizen.id) ?? 0) !== (needStart.get(citizen.id) ?? 0)) {
          needsGrew += 1;
        }
      }
      expect(moodChanged).toBe(citizens.citizens.length);
      expect(needsGrew).toBe(citizens.citizens.length);

      // Every need kind is tracked live for every citizen.
      for (const citizen of citizens.citizens) {
        expect(citizen.needs.map((need) => need.kind)).toEqual([...NEED_KINDS]);
      }

      const stats = citizens.stats();
      expect(stats.citizenCount).toBe(citizens.citizens.length);
      expect(stats.employedCount).toBe(citizens.citizens.length);
      expect(stats.averageMood).toBeGreaterThan(0);
      expect(citizens.activeCitizens().length).toBeGreaterThanOrEqual(50);
      expect(Object.values(stats.stageCounts).reduce((total, count) => total + count, 0)).toBe(
        citizens.citizens.length,
      );

      // Citizens only ever move inside the static city: no geometry changes.
      expect(geometryFingerprint(world)).toBe(geometryBefore);

      // Detaching hands the world back clean: no citizen occupancy is left.
      fixture.engine.detach(citizens);
      expect(citizens.attached).toBe(false);
      expect(
        world.buildings.every((building) =>
          building.occupantIds.every((id) => !id.startsWith('citizen-')),
        ),
      ).toBe(true);
      expect(world.buildings.every((building) => building.residentHouseholdIds.length === 0)).toBe(true);
    } finally {
      fixture.dispose();
    }
  });

  it('keeps the population alive for a second day without re-spawning anyone', () => {
    const fixture: SimFixture = createSimFixture({ seed: 'citizens-two-days', startHour: 6 });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const citizens = new CitizensSystem({ world, seed: fixture.rng.seed });
      fixture.engine.attach(citizens);

      const before = citizens.fingerprint();
      const rosterSize = citizens.citizens.length;
      const householdCount = world.households.length;

      // Day one from 06:00, then a whole second day from the new midnight.
      fixture.advanceMinutes(SIM_DAY_MINUTES - 6 * 60);
      expect(fixture.clock.day).toBe(1);
      const stagesDayOne = new Map<string, RoutineStage[]>();
      for (let minute = 0; minute < SIM_DAY_MINUTES; minute += 1) {
        fixture.advanceMinutes(1);
        for (const citizen of citizens.citizens) {
          const stage = citizens.stageFor(citizen.id);
          if (!stage) {
            continue;
          }
          const list = stagesDayOne.get(citizen.id) ?? [];
          if (list[list.length - 1] !== stage) {
            list.push(stage);
          }
          stagesDayOne.set(citizen.id, list);
        }
      }

      expect(fixture.clock.day).toBe(2);
      // No re-spawning: the roster, the households and the world collections
      // are exactly what generation produced.
      expect(citizens.citizens.length).toBe(rosterSize);
      expect(world.citizens.length).toBe(rosterSize);
      expect(world.households.length).toBe(householdCount);
      expect(citizens.fingerprint()).toBe(before);
      expect(new Set(citizens.citizens.map((citizen) => citizen.id)).size).toBe(rosterSize);

      for (const list of stagesDayOne.values()) {
        expectOneFullCycle(list, 'second day');
      }
      const citizensAtHome = citizens.citizens.filter((citizen) => {
        const live = citizens.liveStateFor(citizen.id);
        return live?.insideBuildingId === citizen.homeBuildingId;
      });
      expect(citizensAtHome.length).toBeGreaterThan(0);
    } finally {
      fixture.dispose();
    }
  });
});
