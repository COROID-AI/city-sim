/**
 * Behavioural tests for the citizen population (`src/sim/citizens.ts`).
 *
 * The suite asserts what the rest of the app depends on: a deterministic roster
 * of at least 60 fully detailed citizens (name, age, household, occupation,
 * income, mood, needs, schedule slots) placed in real homes, real workplaces
 * and real leisure venues; personalised daily routines that read home -> work
 * (with a lunch break) -> entertainment -> home; and a per-tick state machine
 * that moves citizens, updates their needs and mood and keeps building
 * occupancy in sync without any extra bookkeeping in the renderer. It closes
 * with the DOM-free guard for the whole `src/sim` layer.
 */

import { describe, expect, it } from 'vitest';

import { MINUTES_PER_DAY, SimClock } from '../../src/sim/clock';
import {
  ACTIVE_CITIZEN_FLOOR,
  CITIZENS_SYSTEM_NAME,
  COMMUTE_MODES,
  CitizensSystem,
  DEFAULT_CITIZEN_COUNT,
  INCOME_TAX_RATE,
  ROSTER_HEADROOM,
  ROUTINE_STAGES,
  STAGE_ACTIVITY,
  canonicalActivityChain,
  createCitizensSystem,
} from '../../src/sim/citizens';
import type { CitizenDetails, CitizensStats, RoutineStage, ShiftPatternId } from '../../src/sim/citizens';
import { SimulationEngine } from '../../src/sim/engine';
import { NEED_KINDS } from '../../src/sim/types';
import type { ActivityKind, BuildingKind, Citizen, NeedKind, ScheduleSlot } from '../../src/sim/types';
import { RESIDENTIAL_BUILDING_KINDS, createCityWorld } from '../../src/sim/world';
import { createSimFixture } from '../helpers/sim-fixtures';
import type { SimFixture } from '../helpers/sim-fixtures';

const WORKPLACE_KINDS: readonly BuildingKind[] = [
  'office',
  'shop',
  'factory',
  'warehouse',
  'school',
  'hospital',
  'civic',
];

const TEST_SEED = 'citizens-suite';

/* ------------------------------------------------------------- utilities -- */

function buildRoster(seed: number | string = TEST_SEED): {
  world: ReturnType<typeof createCityWorld>;
  citizens: CitizensSystem;
} {
  const world = createCityWorld({ seed });
  const citizens = createCitizensSystem({ world, seed: world.seed });
  return { world, citizens };
}

function needLevel(citizen: Citizen, kind: NeedKind): number {
  const need = citizen.needs.find((entry) => entry.kind === kind);
  if (!need) {
    throw new Error(`citizen ${citizen.id} has no ${kind} need`);
  }
  return need.level;
}

/** Slot window in whole sim-minutes, wrapping into `0..1439`. */
function slotMinutes(slot: ScheduleSlot): { start: number; end: number; duration: number } {
  const start = Math.round(slot.startHour * 60) % MINUTES_PER_DAY;
  const end = Math.round(slot.endHour * 60) % MINUTES_PER_DAY;
  return { start, end, duration: (end - start + MINUTES_PER_DAY) % MINUTES_PER_DAY };
}

function everyCitizen(citizens: CitizensSystem, check: (citizen: Citizen) => void): void {
  for (const citizen of citizens.citizens) {
    check(citizen);
  }
}

/* ------------------------------------------------------------------ tests -- */

describe('citizen roster', () => {
  const { world, citizens } = buildRoster();

  it('generates a deterministic roster of at least 60 fully detailed citizens', () => {
    expect(citizens.citizens.length).toBeGreaterThanOrEqual(ROSTER_HEADROOM);
    expect(citizens.citizens.length).toBe(DEFAULT_CITIZEN_COUNT);
    expect(citizens.activeCitizens().length).toBeGreaterThanOrEqual(ACTIVE_CITIZEN_FLOOR);
    // The roster is the world's population collection, not a private copy.
    expect(world.citizens).toHaveLength(citizens.citizens.length);
    expect(world.citizens[0]).toBe(citizens.citizens[0]);
    expect(world.citizens[world.citizens.length - 1]).toBe(citizens.citizens[citizens.citizens.length - 1]);
  });

  it('gives every citizen a unique identity and complete detail fields', () => {
    const ids = new Set<string>();
    const names = new Set<string>();
    const householdIds = new Set(world.households.map((household) => household.id));

    everyCitizen(citizens, (citizen) => {
      expect(citizen.id).toMatch(/^citizen-\d+$/);
      expect(ids.has(citizen.id)).toBe(false);
      ids.add(citizen.id);
      expect(citizen.name.trim().length).toBeGreaterThan(3);
      expect(names.has(citizen.name)).toBe(false);
      names.add(citizen.name);
      expect(citizen.age).toBeGreaterThanOrEqual(18);
      expect(citizen.age).toBeLessThanOrEqual(69);
      expect(citizen.mood).toBeGreaterThanOrEqual(0);
      expect(citizen.mood).toBeLessThanOrEqual(1);
      expect(citizen.vehicleId).toBeNull();

      expect(householdIds.has(citizen.householdId)).toBe(true);
      expect(citizen.household.id).toBe(citizen.householdId);
      expect(citizen.household.homeBuildingId).toBe(citizen.homeBuildingId);
      expect(citizen.household.memberIds).toContain(citizen.id);
      expect(citizen.household.funds).toBeGreaterThan(0);
      expect(citizen.household.memberIds.length).toBeGreaterThanOrEqual(1);
      expect(citizen.household.memberIds.length).toBeLessThanOrEqual(4);

      expect(citizen.needs.map((need) => need.kind)).toEqual([...NEED_KINDS]);
      for (const need of citizen.needs) {
        expect(need.level).toBeGreaterThanOrEqual(0);
        expect(need.level).toBeLessThanOrEqual(100);
        expect(need.growthPerHour).toBeGreaterThan(0);
        expect(need.growthPerHour).toBeLessThan(6);
      }

      expect(citizen.schedule.length).toBe(ROUTINE_STAGES.length);
      expect(citizen.occupation.companyId).toBeNull();
    });

    expect(ids.size).toBe(citizens.citizens.length);
    expect(names.size).toBe(citizens.citizens.length);
  });

  it('places every citizen in a real home, workplace and entertainment venue', () => {
    const venues = new Set(world.leisureVenues().map((venue) => venue.id));
    const workplaceKinds = new Set<BuildingKind>();

    everyCitizen(citizens, (citizen) => {
      const home = world.buildingById(citizen.homeBuildingId);
      expect(home).not.toBeNull();
      expect(RESIDENTIAL_BUILDING_KINDS).toContain(home?.kind as BuildingKind);
      expect((home?.capacity ?? 0)).toBeGreaterThan(0);

      const workplaceId = citizen.occupation.workplaceBuildingId;
      expect(workplaceId).not.toBeNull();
      const workplace = world.buildingById(workplaceId as string);
      expect(workplace).not.toBeNull();
      expect(WORKPLACE_KINDS).toContain(workplace?.kind as BuildingKind);
      expect(workplace?.jobSlots).toBeGreaterThan(0);
      expect(workplace?.id).not.toBe(home?.id);
      workplaceKinds.add(workplace?.kind as BuildingKind);

      const routine = citizens.routineFor(citizen.id);
      expect(routine).not.toBeNull();
      expect(venues.has(routine?.entertainmentVenueId as string)).toBe(true);
      expect(routine?.entertainmentVenueId).not.toBe(home?.id);
      expect(citizens.venueTypeFor(routine?.entertainmentVenueId as string)).not.toBeNull();
      expect(routine?.entertainmentVenueName.length as number).toBeGreaterThan(2);
      expect(
        routine?.lunchVenueId === workplaceId ||
          venues.has(routine?.lunchVenueId as string),
      ).toBe(true);
    });

    // The roster spreads over the whole city rather than one district.
    expect(workplaceKinds.size).toBeGreaterThanOrEqual(3);
    expect(new Set(citizens.citizens.map((citizen) => citizen.homeBuildingId)).size).toBeGreaterThan(
      10,
    );
    expect(new Set(citizens.citizens.map((citizen) => citizen.occupation.workplaceBuildingId)).size).toBeGreaterThan(
      10,
    );
    expect(new Set(citizens.allRoutines().map((routine) => routine.entertainmentVenueId)).size).toBeGreaterThan(
      5,
    );
  });

  it('links households to their home building without exceeding its capacity', () => {
    expect(world.households.length).toBeGreaterThan(5);
    const membersPerHome = new Map<string, number>();
    for (const household of world.households) {
      const home = world.buildingById(household.homeBuildingId);
      expect(home).not.toBeNull();
      expect(home?.residentHouseholdIds).toContain(household.id);
      const members = household.memberIds.length;
      expect(members).toBeGreaterThanOrEqual(1);
      membersPerHome.set(household.homeBuildingId, (membersPerHome.get(household.homeBuildingId) ?? 0) + members);
    }
    for (const [homeId, members] of membersPerHome) {
      expect(members).toBeLessThanOrEqual(world.buildingById(homeId)?.capacity ?? 0);
    }
    // Household plans are cumulative: the members own the city's income.
    expect(citizens.households).toHaveLength(world.households.length);
    expect(citizens.households[0]).toBe(world.households[0]);
  });

  it('pays every citizen a net daily income derived from wage and shift hours', () => {
    everyCitizen(citizens, (citizen) => {
      const { wagePerHour, shiftStartHour, shiftEndHour } = citizen.occupation;
      expect(wagePerHour).toBeGreaterThan(8);
      expect(wagePerHour).toBeLessThan(60);
      const shiftHours = (shiftEndHour - shiftStartHour + 24) % 24;
      expect(shiftHours).toBeGreaterThanOrEqual(7);
      expect(shiftHours).toBeLessThanOrEqual(9);
      const expected = Math.round(wagePerHour * shiftHours * (1 - INCOME_TAX_RATE) * 100) / 100;
      expect(citizen.income).toBeCloseTo(expected, 6);
    });
    const incomes = new Set(citizens.citizens.map((citizen) => citizen.income));
    expect(incomes.size).toBeGreaterThan(20);
    const stats: CitizensStats = citizens.stats();
    expect(stats.employedCount).toBe(citizens.citizens.length);
    expect(stats.averageIncome).toBeGreaterThan(0);
    expect(stats.averageMood).toBeGreaterThan(0);
    expect(stats.averageMood).toBeLessThanOrEqual(1);
    expect(stats.averageAge).toBeGreaterThan(18);
    expect(stats.averageAge).toBeLessThan(69);
  });
});

describe('daily schedule', () => {
  const { world, citizens } = buildRoster(TEST_SEED);

  it('runs home -> commute -> work -> lunch -> work -> commute -> entertainment -> commute home', () => {
    everyCitizen(citizens, (citizen) => {
      const routine = citizens.routineFor(citizen.id);
      expect(routine).not.toBeNull();
      if (!routine) {
        return;
      }
      expect(routine.stageOrder).toEqual([...ROUTINE_STAGES]);
      expect(routine.blocks.map((block) => block.stage)).toEqual([...ROUTINE_STAGES]);

      // The ring closes: the last leg arrives home exactly when home resumes.
      expect(routine.blocks[0].stage).toBe('home');
      expect(routine.blocks[0].destinationId).toBe(citizen.homeBuildingId);
      expect(routine.blocks[routine.blocks.length - 1].stage).toBe('commute-home');
      expect(routine.blocks[routine.blocks.length - 1].destinationId).toBe(citizen.homeBuildingId);

      // Schedule slots mirror the ring 1:1, in routine order, covering 24h.
      expect(citizen.schedule).toHaveLength(ROUTINE_STAGES.length);
      let covered = 0;
      for (let index = 0; index < citizen.schedule.length; index += 1) {
        const slot = citizen.schedule[index];
        const block = routine.blocks[index];
        expect(slot.activity).toBe(STAGE_ACTIVITY[block.stage]);
        expect(slot.destinationId).toBe(block.destinationId);
        const window = slotMinutes(slot);
        const next = slotMinutes(citizen.schedule[(index + 1) % citizen.schedule.length]);
        expect(next.start).toBe(window.end);
        expect(window.duration).toBe(block.durationMinutes);
        covered += window.duration;
      }
      expect(covered).toBe(MINUTES_PER_DAY);
      expect(routine.blocks[0].durationMinutes).toBeGreaterThanOrEqual(240);
    });
  });

  it('collapses to the README daily sequence home -> work -> entertainment -> home', () => {
    everyCitizen(citizens, (citizen) => {
      const chain = canonicalActivityChain(citizen.schedule);
      expect(chain).toEqual<ActivityKind[]>(['home', 'work', 'entertainment']);
      // Closing the ring back onto the night home block is one full cycle.
      expect([...chain, chain[0]]).toEqual<ActivityKind[]>(['home', 'work', 'entertainment', 'home']);
    });
  });

  it('keeps the lunch break and both work blocks inside the shift', () => {
    everyCitizen(citizens, (citizen) => {
      const routine = citizens.routineFor(citizen.id);
      expect(routine).not.toBeNull();
      if (!routine) {
        return;
      }
      const [home, commuteToWork, morning, lunch, afternoon, toVenue, entertainment, homeLeg] = routine.blocks;
      expect(home.durationMinutes + commuteToWork.durationMinutes + morning.durationMinutes).toBeGreaterThan(0);
      expect(morning.durationMinutes + lunch.durationMinutes + afternoon.durationMinutes).toBe(
        routine.shiftMinutes,
      );
      expect(lunch.durationMinutes).toBeGreaterThanOrEqual(30);
      expect(lunch.durationMinutes).toBeLessThanOrEqual(75);
      if (routine.lunchOffSite) {
        // Walking out costs real time, and the break pays for the round trip.
        expect(lunch.travelMinutes).toBe(routine.lunchTravelMinutes);
        expect(lunch.returnTravelMinutes).toBe(routine.lunchTravelMinutes);
        expect(lunch.durationMinutes).toBeGreaterThanOrEqual(lunch.travelMinutes * 2 + 15);
        expect(lunch.destinationId).toBe(routine.lunchVenueId);
        expect(lunch.destinationId).not.toBe(citizen.occupation.workplaceBuildingId);
      } else {
        expect(lunch.travelMinutes).toBe(0);
        expect(lunch.returnTravelMinutes).toBe(0);
        expect(lunch.destinationId).toBe(citizen.occupation.workplaceBuildingId);
      }
      expect(morning.durationMinutes).toBeGreaterThan(0);
      expect(afternoon.durationMinutes).toBeGreaterThan(0);
      expect(commuteToWork.durationMinutes).toBeGreaterThanOrEqual(6);
      expect(commuteToWork.durationMinutes).toBeLessThanOrEqual(90);
      expect(toVenue.durationMinutes).toBeGreaterThanOrEqual(6);
      expect(homeLeg.durationMinutes).toBeGreaterThanOrEqual(6);
      expect(entertainment.durationMinutes).toBeGreaterThanOrEqual(60);
      expect(entertainment.destinationId).toBe(routine.entertainmentVenueId);
      expect(morning.destinationId).toBe(citizen.occupation.workplaceBuildingId);
      expect(afternoon.destinationId).toBe(citizen.occupation.workplaceBuildingId);
      expect(lunch.activity).toBe('errand');
      expect(commuteToWork.activity).toBe('errand');
      expect(homeLeg.activity).toBe('errand');
      // Commutes reserve exactly their own transit time, so citizens arrive on time.
      expect(commuteToWork.travelMinutes).toBe(commuteToWork.durationMinutes);
      expect(toVenue.travelMinutes).toBe(toVenue.durationMinutes);
      expect(homeLeg.travelMinutes).toBe(homeLeg.durationMinutes);
      expect(commuteToWork.nodeIds.length).toBeGreaterThan(0);
      expect(commuteToWork.distanceTiles).toBeGreaterThan(0);
    });
  });

  it('personalises shifts, breaks, travel modes and venues from the seeded RNG', () => {
    const routines = citizens.allRoutines();
    const shiftStarts = new Set(citizens.citizens.map((citizen) => citizen.occupation.shiftStartHour));
    const shiftPatterns = new Set<ShiftPatternId>(routines.map((routine) => routine.shiftPatternId));
    const modes = new Set(routines.map((routine) => routine.commuteMode));
    const venues = new Set(routines.map((routine) => routine.entertainmentVenueId));
    const venueTypes = new Set(routines.map((routine) => routine.entertainmentVenueType));
    const entertainmentLengths = new Set(routines.map((routine) => routine.entertainmentMinutes));
    const titles = new Set(citizens.citizens.map((citizen) => citizen.occupation.title));
    const sectors = new Set(citizens.citizens.map((citizen) => citizen.occupation.sector));
    const homeLengths = new Set(routines.map((routine) => routine.blocks[0].durationMinutes));

    expect(shiftStarts.size).toBeGreaterThan(3);
    expect(shiftPatterns).toEqual(new Set<ShiftPatternId>(['early', 'day', 'late', 'night']));
    expect(modes.size).toBeGreaterThan(1);
    for (const mode of modes) {
      expect(COMMUTE_MODES).toContain(mode);
    }
    expect(venues.size).toBeGreaterThan(5);
    expect(venueTypes.size).toBeGreaterThan(3);
    expect(entertainmentLengths.size).toBeGreaterThan(2);
    expect(titles.size).toBeGreaterThan(8);
    expect(sectors.size).toBeGreaterThanOrEqual(4);
    expect(homeLengths.size).toBeGreaterThan(10);

    // Night shifts exist and wrap past midnight, as the sim-day must allow.
    const nightShifts = routines.filter((routine) => routine.shiftPatternId === 'night');
    expect(nightShifts.length).toBeGreaterThan(0);
    expect(nightShifts.every((routine) => routine.shiftEndMinute < routine.shiftStartMinute)).toBe(true);

    // Some citizens walk out for lunch, others eat at work.
    expect(routines.some((routine) => routine.lunchOffSite)).toBe(true);
    expect(routines.filter((routine) => routine.lunchOffSite).every((routine) => routine.lunchTravelMinutes > 0)).toBe(
      true,
    );
    expect(routines.some((routine) => !routine.lunchOffSite)).toBe(true);
  });

  it('rebuilds the same roster for the same seed and a different one for another seed', () => {
    const same = buildRoster(TEST_SEED);
    expect(same.citizens.fingerprint()).toBe(citizens.fingerprint());
    expect(same.world.buildings.length).toBe(world.buildings.length);

    const other = buildRoster('citizens-suite-other');
    expect(other.citizens.fingerprint()).not.toBe(citizens.fingerprint());
    expect(other.citizens.citizens.length).toBe(citizens.citizens.length);

    // The constructor and the factory are interchangeable.
    const worldAgain = createCityWorld({ seed: TEST_SEED });
    const viaClass = new CitizensSystem({ world: worldAgain, seed: worldAgain.seed });
    expect(viaClass.fingerprint()).toBe(citizens.fingerprint());
    expect(viaClass.name).toBe(CITIZENS_SYSTEM_NAME);
  });

  it('refuses to under-populate the city or to run without a city to live in', () => {
    const tinyWorld = createCityWorld({ seed: TEST_SEED });
    expect(() => new CitizensSystem({ world: tinyWorld, count: 10, seed: 1 })).toThrow(/50/);
    const emptyWorld = createCityWorld({ seed: 3 });
    emptyWorld.buildings.length = 0;
    expect(() => new CitizensSystem({ world: emptyWorld, seed: 1 })).toThrow(/buildings/);
  });
});

describe('live state machine', () => {
  it('drives roster, clocks and engine together through a simulated working day', () => {
    const fixture: SimFixture = createSimFixture({ seed: 'citizens-live', startHour: 0 });
    try {
      const world = createCityWorld({ seed: fixture.rng.seed });
      const citizens = createCitizensSystem({ world, seed: fixture.rng.seed });

      expect(citizens.attached).toBe(false);
      expect(citizens.liveStateFor(citizens.citizens[0].id)).toBeNull();

      const detach = citizens.attach(fixture.engine);
      expect(citizens.attached).toBe(true);
      expect(fixture.engine.getSystem(CITIZENS_SYSTEM_NAME)).toBe(citizens);
      expect(citizens.liveStateFor(citizens.citizens[0].id)).not.toBeNull();

      const sample = citizens.citizens[0];
      const startNeeds = NEED_KINDS.map((kind) => needLevel(sample, kind));
      const startMood = sample.mood;
      const visitedStages = new Map<string, Set<RoutineStage>>();
      const travelTicks = new Map<string, number>();
      const positionKeys = new Map<string, Set<string>>();
      let introspects = 0;

      for (let tick = 0; tick < 8 * 60; tick += 1) {
        fixture.engine.step(1);
        for (const citizen of citizens.citizens) {
          const live = citizens.liveStateFor(citizen.id);
          expect(live).not.toBeNull();
          if (!live) {
            continue;
          }
          expect(live.stage).toBe(citizens.stageFor(citizen.id));
          expect(live.activity).toBe(citizen.currentActivity);
          expect(live.insideBuildingId).toBe(citizen.insideBuildingId);
          expect(live.position).toEqual(citizen.position);

          const stages = visitedStages.get(citizen.id) ?? new Set<RoutineStage>();
          stages.add(live.stage);
          visitedStages.set(citizen.id, stages);
          const keys = positionKeys.get(citizen.id) ?? new Set<string>();
          keys.add(`${live.position.x.toFixed(3)}:${live.position.y.toFixed(3)}`);
          positionKeys.set(citizen.id, keys);

          if (live.travelling) {
            // Commuting happens on the street, never inside a building.
            expect(live.insideBuildingId).toBeNull();
            expect(live.travelProgress).toBeGreaterThanOrEqual(0);
            expect(live.travelProgress).toBeLessThan(1);
            travelTicks.set(citizen.id, (travelTicks.get(citizen.id) ?? 0) + 1);
          } else {
            expect(live.insideBuildingId).toBe(live.destinationId);
            expect(citizen.position).toEqual(
              world.accessPointForBuilding(live.destinationId as string) as { x: number; y: number },
            );
          }
        }
        introspects += 1;
      }

      expect(introspects).toBe(8 * 60);
      expect(fixture.engine.tickCount).toBe(8 * 60);
      expect(citizens.updateCount).toBe(8 * 60);
      expect(citizens.minuteOfDay).toBe(8 * 60);

      // Everybody moved through several routine stages and at least some
      // citizens were on the street while doing so.
      const allStagesSeen = new Set<RoutineStage>();
      let multiStageCitizens = 0;
      for (const stages of visitedStages.values()) {
        for (const stage of stages) {
          allStagesSeen.add(stage);
        }
        if (stages.size >= 2) {
          multiStageCitizens += 1;
        }
      }
      expect(allStagesSeen.size).toBeGreaterThanOrEqual(6);
      expect(multiStageCitizens).toBeGreaterThan(5);
      expect(travelTicks.size).toBeGreaterThan(10);
      expect([...travelTicks.values()].every((count) => count > 0)).toBe(true);
      const sampledPositions = [...positionKeys.values()].reduce((total, keys) => total + keys.size, 0);
      expect(sampledPositions).toBeGreaterThan(citizens.citizens.length * 3);

      // Needs and mood are live, in range, and moved on from their spawn values.
      const endNeeds = NEED_KINDS.map((kind) => needLevel(sample, kind));
      expect(endNeeds).not.toEqual(startNeeds);
      for (const citizen of citizens.citizens) {
        for (const need of citizen.needs) {
          expect(need.level).toBeGreaterThanOrEqual(0);
          expect(need.level).toBeLessThanOrEqual(100);
        }
        expect(citizen.mood).toBeGreaterThanOrEqual(0);
        expect(citizen.mood).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(sample.mood - startMood)).toBeGreaterThan(0.0001);

      // Building occupancy matches who is inside.
      for (const citizen of citizens.citizens) {
        for (const building of world.buildings) {
          const listed = building.occupantIds.includes(citizen.id);
          if (building.id === citizen.insideBuildingId) {
            expect(listed).toBe(true);
          } else {
            expect(listed).toBe(false);
          }
        }
      }

      const aCitizen = citizens.citizens[0];
      const details: CitizenDetails | null = citizens.detailsFor(aCitizen.id);
      expect(details).not.toBeNull();
      expect(details?.name).toBe(aCitizen.name);
      expect(details?.live).not.toBeNull();
      expect(details?.shiftHours).toMatch(/^\d{2}:\d{2}-\d{2}:\d{2}$/);
      expect(details?.stageOrder).toEqual([...ROUTINE_STAGES]);

      expect(detach()).toBe(true);
      expect(citizens.attached).toBe(false);
      expect(world.buildings.every((building) => !building.occupantIds.includes(aCitizen.id))).toBe(true);
      const before = citizens.updateCount;
      fixture.engine.step(5);
      expect(citizens.updateCount).toBe(before);
    } finally {
      fixture.dispose();
    }
  });

  it('resolves the same live state whatever fixed step the engine uses', () => {
    const seed = 'citizens-clock';
    const fineWorld = createCityWorld({ seed });
    const coarseWorld = createCityWorld({ seed });
    const fine = new CitizensSystem({ world: fineWorld, seed });
    const coarse = new CitizensSystem({ world: coarseWorld, seed });

    // One 15 minute world-day step must land on the same state as fifteen
    // one-minute steps: live state is a function of sim time, not an accumulator.
    const fineClock = new SimClock({ startHour: 14 });
    const fineEngine = new SimulationEngine({ clock: fineClock, minutesPerTick: 1 });
    const coarseClock = new SimClock({ startHour: 14 });
    const coarseEngine = new SimulationEngine({ clock: coarseClock, minutesPerTick: 15 });
    const detachFine = fine.attach(fineEngine);
    const detachCoarse = coarse.attach(coarseEngine);

    fineEngine.step(15);
    coarseEngine.step(1);
    expect(fineClock.formatDayTime()).toBe(coarseClock.formatDayTime());

    const stages = new Set<RoutineStage>();
    for (let index = 0; index < fine.citizens.length; index += 1) {
      const left = fine.citizens[index];
      const right = coarse.citizens[index];
      expect(right.id).toBe(left.id);
      expect(right.name).toBe(left.name);
      expect(right.currentActivity).toBe(left.currentActivity);
      expect(right.insideBuildingId).toBe(left.insideBuildingId);
      expect(right.position).toEqual(left.position);
      expect(fine.stageFor(left.id)).toBe(coarse.stageFor(right.id));
      // 14:00 plus a quarter of an hour, on both engines.
      expect(fine.liveStateFor(left.id)?.minuteOfDay).toBe(14 * 60 + 15);
      stages.add(fine.stageFor(left.id) as RoutineStage);
      expect(left.position.x).toBeGreaterThanOrEqual(0);
      expect(left.position.y).toBeGreaterThanOrEqual(0);
    }
    // 15:00 is a busy hour of the day, so citizens are spread over the routine.
    expect(stages.size).toBeGreaterThan(1);

    detachFine();
    detachCoarse();
    fineEngine.dispose();
    coarseEngine.dispose();
  });
});

/* ------------------------------------------------------------ dom guard -- */

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

describe('dom-free guard', () => {
  const sources = Object.entries(SIM_SOURCES);

  it('keeps citizens.ts free of browser globals and outside the DOM layer', () => {
    const entry = sources.find(([path]) => path.endsWith('/sim/citizens.ts'));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? '';
    expect(source.length).toBeGreaterThan(1000);
    expect(stripComments(source)).not.toMatch(BROWSER_GLOBAL);

    const specifiers = [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    // Only platform-agnostic sim modules: contracts, RNG, world and engine types.
    expect(new Set(specifiers)).toEqual(
      new Set(['./clock', './rng', './types', './world', './engine']),
    );
  });
});
