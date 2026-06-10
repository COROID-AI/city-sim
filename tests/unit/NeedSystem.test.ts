import {
  NeedSystem,
  DEFAULT_ACTIVITY_DELTAS,
  advanceSchedule,
  advanceNeeds,
  applyActivityDeltas,
} from '@/systems/NeedSystem';
import { createCitizen, type Citizen } from '@/entities';
import { TimeSystem, type TimeProvider } from '@/systems/TimeSystem';
import type { ActivityId, BuildingId, CitizenId } from '@/types/common';

const HOME = 'bldg-home-0' as BuildingId;
const WORK = 'bldg-work-0' as BuildingId;

function citizen(
  id: string,
  activity: ActivityId,
  overrides: Partial<{ energy: number; hunger: number; fun: number; social: number }> = {},
): Citizen {
  const schedule: ActivityId[] = new Array(24).fill(activity);
  return createCitizen({
    id: id as CitizenId,
    position: { x: 0, y: 0 },
    name: id,
    homeId: HOME,
    workplaceId: WORK,
    schedule,
    currentActivity: activity,
    needs: { energy: 50, hunger: 50, fun: 50, social: 50, ...overrides },
  });
}

/** Fake time provider for deterministic tests. */
function fakeTime(initialHour: number, hoursToAdvance = 0): TimeProvider & {
  advance: (h: number) => void;
} {
  let hour = initialHour;
  let last = -1;
  for (let i = 0; i < hoursToAdvance; i += 1) hour = (hour + 1) % 24;
  const provider: TimeProvider & { advance: (h: number) => void } = {
    getCurrentHour: () => hour,
    getCurrentMinute: () => 0,
    getElapsedMinutes: () => hour * 60,
    hasHourChanged: () => {
      if (hour !== last) {
        last = hour;
        return true;
      }
      return false;
    },
    advance: (h: number) => {
      hour = (hour + h) % 24;
    },
  };
  return provider;
}

describe('NeedSystem', () => {
  describe('advanceSchedule', () => {
    it('updates currentActivity from the schedule for the given hour', () => {
      const c = citizen('a', 'sleep');
      const schedule: ActivityId[] = new Array(24).fill('sleep');
      schedule[9] = 'work';
      const working = { ...c, schedule };
      const advanced = advanceSchedule([working], 9);
      expect(advanced[0]?.currentActivity).toBe('work');
    });

    it('returns the same citizen reference when activity is unchanged', () => {
      const c = citizen('a', 'work');
      const result = advanceSchedule([c], 12);
      // All entries are 'work' so the result should be the same reference.
      expect(result[0]).toBe(c);
    });
  });

  describe('advanceNeeds', () => {
    it('applies the activity delta matrix to every citizen', () => {
      const a = citizen('a', 'sleep', { energy: 20 });
      const b = citizen('b', 'work', { energy: 50 });
      const [nextA, nextB] = advanceNeeds([a, b]);
      expect(nextA?.needs.energy).toBe(24); // 20 + 4 (sleep)
      expect(nextB?.needs.energy).toBe(48); // 50 - 2 (work)
    });

    it('clamps all needs to [0, 100] across many ticks', () => {
      const a = citizen('a', 'work', { energy: 100, hunger: 100, fun: 100, social: 100 });
      let current = a;
      for (let i = 0; i < 1000; i += 1) {
        current = applyActivityDeltas(current, DEFAULT_ACTIVITY_DELTAS);
      }
      expect(current.needs.energy).toBeLessThanOrEqual(100);
      expect(current.needs.energy).toBeGreaterThanOrEqual(0);
      expect(current.needs.hunger).toBeLessThanOrEqual(100);
      expect(current.needs.hunger).toBeGreaterThanOrEqual(0);
      expect(current.needs.fun).toBeLessThanOrEqual(100);
      expect(current.needs.fun).toBeGreaterThanOrEqual(0);
      expect(current.needs.social).toBeLessThanOrEqual(100);
      expect(current.needs.social).toBeGreaterThanOrEqual(0);
    });
  });

  describe('NeedSystem decay (24 update() ticks)', () => {
    it('24 update() ticks with a "work" citizen at 50/50/50/50 decay energy/hunger/fun and clamp >= 0', () => {
      const time = fakeTime(0);
      // 50/50/50/50 across the board. Work deltas: energy -2, hunger -2, fun -1.5, social -0.5.
      const c = citizen('a', 'work', {
        energy: 50,
        hunger: 50,
        fun: 50,
        social: 50,
      });
      const sys = new NeedSystem([c], { timeProvider: time });
      for (let i = 0; i < 24; i += 1) {
        sys.update();
      }
      const after = sys.getCitizens()[0];
      expect(after).toBeDefined();
      if (after === undefined) return;
      // All four needs must remain in [0, 100].
      expect(after.needs.energy).toBeLessThanOrEqual(100);
      expect(after.needs.energy).toBeGreaterThanOrEqual(0);
      expect(after.needs.hunger).toBeLessThanOrEqual(100);
      expect(after.needs.hunger).toBeGreaterThanOrEqual(0);
      expect(after.needs.fun).toBeLessThanOrEqual(100);
      expect(after.needs.fun).toBeGreaterThanOrEqual(0);
      expect(after.needs.social).toBeLessThanOrEqual(100);
      expect(after.needs.social).toBeGreaterThanOrEqual(0);
      // Energy / hunger / fun are strictly lower than the start (work drains all three).
      expect(after.needs.energy).toBeLessThan(50);
      expect(after.needs.hunger).toBeLessThan(50);
      expect(after.needs.fun).toBeLessThan(50);
    });

    it('24 update() ticks never drive any need below 0 even with starting values at the floor', () => {
      const time = fakeTime(0);
      const c = citizen('a', 'work', {
        energy: 0,
        hunger: 0,
        fun: 0,
        social: 0,
      });
      const sys = new NeedSystem([c], { timeProvider: time });
      for (let i = 0; i < 24; i += 1) {
        sys.update();
      }
      const after = sys.getCitizens()[0];
      expect(after).toBeDefined();
      if (after === undefined) return;
      expect(after.needs.energy).toBe(0);
      expect(after.needs.hunger).toBe(0);
      expect(after.needs.fun).toBe(0);
      expect(after.needs.social).toBe(0);
    });
  });

  describe('applyActivityDeltas', () => {
    it('returns the same citizen when no delta is defined for the activity', () => {
      const c = citizen('a', 'sleep');
      const result = applyActivityDeltas(c, {});
      expect(result).toBe(c);
    });

    it('clamps individual deltas to [0, 100]', () => {
      const c = citizen('a', 'eat', { hunger: 1 });
      const next = applyActivityDeltas(c, { eat: { hunger: 999 } });
      expect(next.needs.hunger).toBe(100);
    });
  });

  describe('NeedSystem class', () => {
    it('advances schedule only when the hour has changed', () => {
      const time = fakeTime(0);
      const a = citizen('a', 'sleep');
      const schedule: ActivityId[] = new Array(24).fill('sleep');
      schedule[5] = 'leisure';
      const seeded: Citizen = { ...a, schedule };
      const sys = new NeedSystem([seeded], { timeProvider: time });
      // First update: hour changes (from -1 sentinel to 0).
      sys.update();
      expect(sys.getCitizens()[0]?.currentActivity).toBe('sleep');
      // Same hour — no schedule change.
      sys.update();
      expect(sys.getCitizens()[0]?.currentActivity).toBe('sleep');
      // Advance hour to 5.
      time.advance(5);
      sys.update();
      expect(sys.getCitizens()[0]?.currentActivity).toBe('leisure');
    });

    it('uses a default TimeSystem when no provider is injected', () => {
      const c = citizen('a', 'sleep');
      const sys = new NeedSystem([c]);
      expect(sys.getCitizens()).toHaveLength(1);
    });

    it('applies need deltas every tick regardless of hour transitions', () => {
      const time = fakeTime(0);
      const c = citizen('a', 'eat', { hunger: 10 });
      const sys = new NeedSystem([c], { timeProvider: time });
      sys.update();
      const energy = sys.getCitizens()[0]?.needs.energy;
      // 1 hunger tick on eat: 10 + 4 = 14
      expect(sys.getCitizens()[0]?.needs.hunger).toBe(14);
      expect(energy).toBeDefined();
    });

    it('schedule flips on hour 8 -> commute and hour 9 -> work with advanceSchedule', () => {
      // Build a citizen whose 24h schedule is mixed.
      const schedule: ActivityId[] = new Array(24).fill('sleep') as ActivityId[];
      schedule[7] = 'sleep';
      schedule[8] = 'commute';
      schedule[9] = 'work';
      schedule[17] = 'commute';
      schedule[18] = 'leisure';
      schedule[23] = 'sleep';
      const c = createCitizen({
        id: 'cit-mixed' as CitizenId,
        position: { x: 0, y: 0 },
        name: 'Mixed',
        homeId: HOME,
        workplaceId: WORK,
        schedule,
        currentActivity: schedule[0] ?? 'sleep',
      });
      // h=7 -> sleep, h=8 -> commute, h=9 -> work.
      const at7 = advanceSchedule([c], 7);
      const at8 = advanceSchedule(at7, 8);
      const at9 = advanceSchedule(at8, 9);
      expect(at7[0]?.currentActivity).toBe('sleep');
      expect(at8[0]?.currentActivity).toBe('commute');
      expect(at9[0]?.currentActivity).toBe('work');
    });
  });

  describe('TimeSystem', () => {
    it('reports hour transitions once per change', () => {
      const time = new TimeSystem();
      // 1 game hour at 1x scale: 60 minutes -> 60,000 ms.
      time.tick(60 * 1000, 1);
      expect(time.getCurrentHour()).toBe(1);
      expect(time.hasHourChanged()).toBe(true);
      expect(time.hasHourChanged()).toBe(false);
    });

    it('wraps the hour after a full 24h cycle', () => {
      const time = new TimeSystem();
      time.tick(24 * 60 * 1000, 1);
      expect(time.getCurrentHour()).toBe(0);
    });
  });
});
