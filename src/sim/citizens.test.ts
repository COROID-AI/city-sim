import { spawnCitizens, determineScheduleState, tickCitizens } from './citizens';
import { createWorld } from './world';
import { generateCity, DEFAULT_CITY_SEED } from './worldGen';
import { MIN_CITIZENS, SIM_HOUR_MS, CITIZEN_SPEED } from './constants';
import type { Citizen, World } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Build a fully-generated city ready for citizen spawning. */
function makeCity(seed: number = DEFAULT_CITY_SEED): World {
  const world = createWorld();
  generateCity(world, seed);
  return world;
}

/** Build a city and spawn the default population into it. */
function makeCityWithCitizens(
  seed: number = DEFAULT_CITY_SEED,
  count: number = MIN_CITIZENS,
): World {
  const world = makeCity(seed);
  spawnCitizens(world, count);
  return world;
}

/** Create a SimTime object at a given hour-of-day on day 0. */
function timeAt(hour: number): { elapsedHours: number } {
  return { elapsedHours: hour };
}

// ─── spawnCitizens ───────────────────────────────────────────────────────────

describe('spawnCitizens', () => {
  it('creates at least 50 citizens by default', () => {
    const world = makeCity();
    spawnCitizens(world);
    expect(world.citizens.size).toBeGreaterThanOrEqual(50);
  });

  it('creates exactly the requested count', () => {
    const world = makeCity();
    spawnCitizens(world, 75);
    expect(world.citizens.size).toBe(75);
  });

  it('assigns a home building to every citizen', () => {
    const world = makeCityWithCitizens();
    for (const c of world.citizens.values()) {
      expect(c.home).not.toBeNull();
      expect(world.buildings.has(c.home!)).toBe(true);
      const home = world.buildings.get(c.home!)!;
      expect(home.kind).toBe('HOME');
    }
  });

  it('assigns a workplace to ~80% of citizens', () => {
    const world = makeCityWithCitizens();
    let employed = 0;
    let total = 0;
    for (const c of world.citizens.values()) {
      total++;
      if (c.work !== null) {
        employed++;
        const work = world.buildings.get(c.work)!;
        expect(work.kind).toBe('WORK');
      }
    }
    // Expect 60–95% employed (generous tolerance for RNG).
    const rate = employed / total;
    expect(rate).toBeGreaterThanOrEqual(0.6);
    expect(rate).toBeLessThanOrEqual(0.95);
  });

  it('assigns an entertainment venue to every citizen (when available)', () => {
    const world = makeCityWithCitizens();
    for (const c of world.citizens.values()) {
      if (c.entertainment !== null) {
        const ent = world.buildings.get(c.entertainment)!;
        expect(ent.kind).toBe('ENTERTAINMENT');
      }
    }
  });

  it('gives every citizen a small money balance', () => {
    const world = makeCityWithCitizens();
    for (const c of world.citizens.values()) {
      expect(c.money).toBeGreaterThan(0);
    }
  });

  it('starts every citizen at their home building', () => {
    const world = makeCityWithCitizens();
    for (const c of world.citizens.values()) {
      const home = world.buildings.get(c.home!)!;
      const centerX = home.position.x + Math.floor(home.size.width / 2);
      const centerY = home.position.y + Math.floor(home.size.height / 2);
      expect(c.position.x).toBe(centerX);
      expect(c.position.y).toBe(centerY);
    }
  });

  it('starts every citizen in the HOME state', () => {
    const world = makeCityWithCitizens();
    for (const c of world.citizens.values()) {
      expect(c.state.kind).toBe('HOME');
    }
  });

  it('gives every citizen a unique ID', () => {
    const world = makeCityWithCitizens();
    const ids = new Set<string>();
    for (const c of world.citizens.values()) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
    }
  });

  it('is deterministic: identical seeds produce identical citizens', () => {
    const a = makeCityWithCitizens(12345, 60);
    const b = makeCityWithCitizens(12345, 60);
    const sa = JSON.stringify(Array.from(a.citizens.values()));
    const sb = JSON.stringify(Array.from(b.citizens.values()));
    expect(sa).toEqual(sb);
  });
});

// ─── determineScheduleState ──────────────────────────────────────────────────

describe('determineScheduleState', () => {
  // Use a generic citizen — schedule is purely time-based.
  const dummyCitizen = {} as Citizen;

  it('returns "home" at hour 2', () => {
    expect(determineScheduleState(dummyCitizen, timeAt(2))).toBe('home');
  });

  it('returns "commutingToWork" at hour 6', () => {
    expect(determineScheduleState(dummyCitizen, timeAt(6))).toBe(
      'commutingToWork',
    );
  });

  it('returns "commutingToWork" at hour 7', () => {
    expect(determineScheduleState(dummyCitizen, timeAt(7))).toBe(
      'commutingToWork',
    );
  });

  it('returns "atWork" at hour 12', () => {
    expect(determineScheduleState(dummyCitizen, timeAt(12))).toBe('atWork');
  });

  it('returns "commutingToEntertainment" at hour 17', () => {
    expect(determineScheduleState(dummyCitizen, timeAt(17))).toBe(
      'commutingToEntertainment',
    );
  });

  it('returns "commutingToEntertainment" at hour 18', () => {
    expect(determineScheduleState(dummyCitizen, timeAt(18))).toBe(
      'commutingToEntertainment',
    );
  });

  it('returns "atEntertainment" at hour 20', () => {
    expect(determineScheduleState(dummyCitizen, timeAt(20))).toBe(
      'atEntertainment',
    );
  });

  it('returns "home" at hour 23', () => {
    expect(determineScheduleState(dummyCitizen, timeAt(23))).toBe('home');
  });

  it('returns "home" at hour 0 (midnight)', () => {
    expect(determineScheduleState(dummyCitizen, timeAt(0))).toBe('home');
  });

  it('handles the full day cycle', () => {
    // Verify each hour maps to the expected phase.
    const expected: Record<number, string> = {
      0: 'home',
      1: 'home',
      2: 'home',
      3: 'home',
      4: 'home',
      5: 'home',
      6: 'commutingToWork',
      7: 'commutingToWork',
      8: 'atWork',
      9: 'atWork',
      10: 'atWork',
      11: 'atWork',
      12: 'atWork',
      13: 'atWork',
      14: 'atWork',
      15: 'atWork',
      16: 'atWork',
      17: 'commutingToEntertainment',
      18: 'commutingToEntertainment',
      19: 'atEntertainment',
      20: 'atEntertainment',
      21: 'atEntertainment',
      22: 'home',
      23: 'home',
    };
    for (let h = 0; h < 24; h++) {
      expect(determineScheduleState(dummyCitizen, timeAt(h))).toBe(expected[h]);
    }
  });

  it('wraps correctly across day boundaries', () => {
    // 25 hours elapsed = hour 1 next day → home
    expect(
      determineScheduleState(dummyCitizen, { elapsedHours: 25 }),
    ).toBe('home');
    // 30 hours elapsed = hour 6 next day → commutingToWork
    expect(
      determineScheduleState(dummyCitizen, { elapsedHours: 30 }),
    ).toBe('commutingToWork');
  });
});

// ─── tickCitizens ────────────────────────────────────────────────────────────

describe('tickCitizens', () => {
  it('moves citizens from home toward work during morning commute', () => {
    const world = makeCityWithCitizens();
    // Set the clock to 7:00 (commutingToWork).
    world.simTime = { elapsedHours: 7 };

    // Find an employed citizen.
    const citizen = Array.from(world.citizens.values()).find(
      (c) => c.work !== null,
    )!;
    const startPos = { ...citizen.position };

    // Tick enough to move along the path.
    tickCitizens(world, SIM_HOUR_MS);

    // Citizen should either have started moving or have a path assigned.
    expect(citizen.path.length).toBeGreaterThan(0);
    const moved =
      citizen.position.x !== startPos.x || citizen.position.y !== startPos.y;
    expect(moved).toBe(true);
  });

  it('advances citizens along their path each tick', () => {
    const world = makeCityWithCitizens();
    world.simTime = { elapsedHours: 7 };

    const citizen = Array.from(world.citizens.values()).find(
      (c) => c.work !== null,
    )!;
    const initialIndex = citizen.pathIndex;

    // First tick starts the trip.
    tickCitizens(world, SIM_HOUR_MS);
    expect(citizen.pathIndex).toBeGreaterThanOrEqual(1);

    // Second tick advances further.
    const midIndex = citizen.pathIndex;
    tickCitizens(world, SIM_HOUR_MS);
    // pathIndex should advance (or citizen may have arrived).
    expect(citizen.pathIndex).toBeGreaterThanOrEqual(midIndex);
    expect(initialIndex).toBe(0);
  });

  it('does not crash when called on an empty world', () => {
    const world = createWorld();
    expect(() => tickCitizens(world, SIM_HOUR_MS)).not.toThrow();
  });

  it('keeps citizens at home during nighttime hours', () => {
    const world = makeCityWithCitizens();
    // Set the clock to 2:00 AM (home).
    world.simTime = { elapsedHours: 2 };

    for (const citizen of world.citizens.values()) {
      const before = { ...citizen.position };
      tickCitizens(world, SIM_HOUR_MS);
      // Position should not change — already at home.
      expect(citizen.position.x).toBe(before.x);
      expect(citizen.position.y).toBe(before.y);
      expect(citizen.state.kind).toBe('HOME');
    }
  });

  it('transitions citizens to COMMUTING when a trip starts', () => {
    const world = makeCityWithCitizens();
    world.simTime = { elapsedHours: 7 };

    const citizen = Array.from(world.citizens.values()).find(
      (c) => c.work !== null,
    )!;

    tickCitizens(world, SIM_HOUR_MS);
    expect(citizen.state.kind).toBe('COMMUTING');
  });

  it('eventually arrives at the workplace', () => {
    const world = makeCityWithCitizens();
    world.simTime = { elapsedHours: 7 };

    const citizen = Array.from(world.citizens.values()).find(
      (c) => c.work !== null,
    )!;
    const work = world.buildings.get(citizen.work!)!;

    // Tick many times to ensure arrival.
    for (let i = 0; i < 60; i++) {
      tickCitizens(world, SIM_HOUR_MS);
      if (citizen.state.kind === 'WORKING') break;
    }

    expect(citizen.state.kind).toBe('WORKING');
    // Should be at the work building.
    const workCenterX = work.position.x + Math.floor(work.size.width / 2);
    const workCenterY = work.position.y + Math.floor(work.size.height / 2);
    expect(citizen.position.x).toBeCloseTo(workCenterX, 0);
    expect(citizen.position.y).toBeCloseTo(workCenterY, 0);
  });

  it('clears the path on arrival', () => {
    const world = makeCityWithCitizens();
    world.simTime = { elapsedHours: 7 };

    const citizen = Array.from(world.citizens.values()).find(
      (c) => c.work !== null,
    )!;

    // Tick until arrived.
    for (let i = 0; i < 60; i++) {
      tickCitizens(world, SIM_HOUR_MS);
      if (citizen.state.kind === 'WORKING') break;
    }

    expect(citizen.path.length).toBe(0);
    expect(citizen.pathIndex).toBe(0);
  });

  it('unemployed citizens stay at or return home during work hours', () => {
    const world = makeCityWithCitizens();
    world.simTime = { elapsedHours: 12 }; // atWork phase

    const unemployed = Array.from(world.citizens.values()).filter(
      (c) => c.work === null,
    );

    // Skip if RNG produced no unemployed citizens (very unlikely with 50).
    if (unemployed.length === 0) return;

    for (const citizen of unemployed) {
      tickCitizens(world, SIM_HOUR_MS);
      // Unemployed should be HOME or RETURNING home.
      expect(['HOME', 'RETURNING']).toContain(citizen.state.kind);
    }
  });

  it('walks citizens at CITIZEN_SPEED cells per sim-hour', () => {
    const world = makeCityWithCitizens();
    world.simTime = { elapsedHours: 7 };

    const citizen = Array.from(world.citizens.values()).find(
      (c) => c.work !== null,
    )!;

    // First tick: assign a path and move one step.
    tickCitizens(world, SIM_HOUR_MS);
    expect(citizen.path.length).toBeGreaterThan(0);

    // Record position after first move.
    const pos1 = { ...citizen.position };

    // Tick once more (same hour → schedule unchanged).
    tickCitizens(world, SIM_HOUR_MS);
    const pos2 = { ...citizen.position };

    // The citizen should have moved (unless they just arrived).
    if (citizen.path.length > 0) {
      const dist = Math.hypot(pos2.x - pos1.x, pos2.y - pos1.y);
      // Should move approximately CITIZEN_SPEED cells in one sim-hour.
      expect(dist).toBeGreaterThan(0);
      expect(dist).toBeLessThanOrEqual(CITIZEN_SPEED + 1);
    }
  });
});
