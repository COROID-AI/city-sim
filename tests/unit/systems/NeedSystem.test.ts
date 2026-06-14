/**
 * Unit tests for src/systems/NeedSystem.ts.
 *
 * Exercises the decay/replenish tables, the [0, 1] clamp, and the
 * NeedSystem.tick integration. Uses a small in-memory fake world so
 * the test doesn't depend on the engine's World class.
 */

import { World } from '@/engine/World';
import { createCitizen } from '@/entities/Citizen';
import {
  NeedSystem,
  NEED_DECAY_PER_HOUR,
  NEED_REPLENISH_PER_HOUR,
  NEED_DELTAS,
  computeNeed,
  type ScheduleMap,
} from '@/systems/NeedSystem';
import { generateSchedule, type Schedule } from '@/systems/ScheduleGenerator';
import { createRng } from '@/generation/random';

function makeWorldWithCitizens(count: number, work: boolean): { world: World; schedules: ScheduleMap } {
  const world = new World({ width: 32, height: 32 });
  const schedules = new Map<string, Schedule>();
  const rng = createRng(7);
  for (let i = 0; i < count; i++) {
    const c = createCitizen({ id: `c-${i}`, name: `C${i}` });
    world.addCitizen(c);
    schedules.set(c.id, generateSchedule(rng, work));
  }
  return { world, schedules };
}

describe('NEED_DELTAS matrix', () => {
  it('has the expected per-activity deltas', () => {
    expect(NEED_DELTAS.sleeping.energy).toBeGreaterThan(0);
    expect(NEED_DELTAS.sleeping.hunger).toBeLessThan(0);
    expect(NEED_DELTAS.working.hunger).toBeLessThan(NEED_DELTAS.sleeping.hunger);
    expect(NEED_DELTAS.leisure.fun).toBeGreaterThan(0);
  });

  it('covers all 5 activities', () => {
    const activities = Object.keys(NEED_DELTAS);
    expect(activities).toEqual(
      expect.arrayContaining(['sleeping', 'commuting', 'working', 'leisure', 'errand']),
    );
  });
});

describe('computeNeed', () => {
  it('replenishes energy during sleep', () => {
    const v = computeNeed('energy', 'sleeping', 0.1, 1);
    expect(v).toBeGreaterThan(0.1);
  });

  it('decays hunger during work', () => {
    const v = computeNeed('hunger', 'working', 1, 1);
    expect(v).toBeLessThan(1);
  });

  it('clamps to [0, 1] when replenishing past full', () => {
    const v = computeNeed('energy', 'sleeping', 0.95, 100);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('clamps to [0, 1] when decaying below zero', () => {
    const v = computeNeed('hunger', 'errand', 0.05, 100);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it('rejects negative dtHours', () => {
    expect(() => computeNeed('hunger', 'sleeping', 0.5, -1)).toThrow(RangeError);
  });
});

describe('NeedSystem', () => {
  it('exposes the default tunables', () => {
    expect(NEED_DECAY_PER_HOUR).toBeGreaterThan(0);
    expect(NEED_REPLENISH_PER_HOUR).toBeGreaterThan(0);
  });

  it('rejects invalid options', () => {
    expect(() => new NeedSystem({ decayPerHour: -0.1 })).toThrow(RangeError);
    expect(() => new NeedSystem({ replenishPerHour: -0.1 })).toThrow(RangeError);
  });

  it('rejects negative dtHours', () => {
    const sys = new NeedSystem();
    const { world, schedules } = makeWorldWithCitizens(1, true);
    expect(() => sys.tick(world, -0.1, schedules, 12)).toThrow(RangeError);
  });

  it('no-op when dtHours is zero', () => {
    const sys = new NeedSystem();
    const { world, schedules } = makeWorldWithCitizens(1, true);
    const c = world.citizens_().next().value!;
    const before = { hunger: c.hunger, energy: c.energy, fun: c.fun };
    sys.tick(world, 0, schedules, 12);
    expect(c.hunger).toBe(before.hunger);
    expect(c.energy).toBe(before.energy);
    expect(c.fun).toBe(before.fun);
  });

  it('decays hunger over time when working', () => {
    const sys = new NeedSystem();
    const { world, schedules } = makeWorldWithCitizens(2, true);
    const citizens = Array.from(world.citizens_());
    for (const c of citizens) c.hunger = 1;
    // Working hours: 9..17
    sys.tick(world, 4, schedules, 13);
    for (const c of citizens) {
      expect(c.hunger).toBeLessThan(1);
      expect(c.hunger).toBeGreaterThanOrEqual(0);
    }
  });

  it('replenishes energy during sleep', () => {
    const sys = new NeedSystem();
    const { world, schedules } = makeWorldWithCitizens(1, true);
    const c = world.citizens_().next().value!;
    c.energy = 0.1;
    sys.tick(world, 4, schedules, 1); // 1am, well within the sleep window
    expect(c.energy).toBeGreaterThan(0.1);
  });

  it('clamps to [0, 1] over a long tick', () => {
    const sys = new NeedSystem();
    const { world, schedules } = makeWorldWithCitizens(1, true);
    const c = world.citizens_().next().value!;
    c.hunger = 1;
    c.energy = 1;
    c.fun = 1;
    // 100 hours is way more than enough to drain or saturate any need.
    sys.tick(world, 100, schedules, 13);
    expect(c.hunger).toBeGreaterThanOrEqual(0);
    expect(c.hunger).toBeLessThanOrEqual(1);
    expect(c.energy).toBeGreaterThanOrEqual(0);
    expect(c.energy).toBeLessThanOrEqual(1);
    expect(c.fun).toBeGreaterThanOrEqual(0);
    expect(c.fun).toBeLessThanOrEqual(1);
  });

  it('falls back to unemployed when a citizen has no schedule', () => {
    const sys = new NeedSystem();
    const world = new World({ width: 8, height: 8 });
    const c = createCitizen({ id: 'c-orphan', name: 'Orphan' });
    world.addCitizen(c);
    const empty: ScheduleMap = new Map();
    c.hunger = 0.5;
    c.energy = 0.5;
    c.fun = 0.5;
    // During midday, unemployed default is leisure (fun replenishes).
    sys.tick(world, 4, empty, 14);
    expect(c.fun).toBeGreaterThan(0.5);
  });
});
