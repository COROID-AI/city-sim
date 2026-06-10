import {
  applyNeedDeltas,
  activityAtHour,
  createCitizen,
  isCitizen,
  DEFAULT_NEEDS,
} from '@/entities';
import {
  ACTIVITY_IDS,
  clampNeed,
  isActivityId,
  type ActivityId,
  type BuildingId,
  type CitizenId,
} from '@/types/common';

const HOME = 'bldg-home-0' as BuildingId;
const WORK = 'bldg-work-0' as BuildingId;

function makeSchedule(activity: ActivityId = 'sleep'): ActivityId[] {
  return new Array(24).fill(activity) as ActivityId[];
}

describe('Citizen', () => {
  describe('createCitizen', () => {
    it('clamps need values into [0, 100]', () => {
      const c = createCitizen({
        id: 'cit-1' as CitizenId,
        position: { x: 0, y: 0 },
        name: 'Test',
        homeId: HOME,
        workplaceId: null,
        schedule: makeSchedule(),
        needs: { energy: 999, hunger: -50, fun: NaN, social: 42 },
      });
      expect(c.needs.energy).toBe(100);
      expect(c.needs.hunger).toBe(0);
      // NaN handling: clampNeed maps NaN to 0.
      expect(c.needs.fun).toBe(0);
      expect(c.needs.social).toBe(42);
    });

    it('requires a 24-entry schedule', () => {
      expect(() =>
        createCitizen({
          id: 'cit-1' as CitizenId,
          position: { x: 0, y: 0 },
          name: 'Test',
          homeId: HOME,
          workplaceId: null,
          schedule: makeSchedule().slice(0, 12),
        }),
      ).toThrow(/24 entries/);
    });

    it('rejects unknown activity ids in the schedule', () => {
      const bad: ActivityId[] = makeSchedule();
      (bad as unknown as string[])[5] = 'bogus';
      expect(() =>
        createCitizen({
          id: 'cit-1' as CitizenId,
          position: { x: 0, y: 0 },
          name: 'Test',
          homeId: HOME,
          workplaceId: null,
          schedule: bad,
        }),
      ).toThrow(/Invalid activity/);
    });

    it('defaults currentActivity to the first schedule entry', () => {
      const c = createCitizen({
        id: 'cit-1' as CitizenId,
        position: { x: 0, y: 0 },
        name: 'Test',
        homeId: HOME,
        workplaceId: null,
        schedule: makeSchedule('leisure'),
      });
      expect(c.currentActivity).toBe('leisure');
    });
  });

  describe('activityAtHour', () => {
    const c = createCitizen({
      id: 'cit-1' as CitizenId,
      position: { x: 0, y: 0 },
      name: 'Test',
      homeId: HOME,
      workplaceId: WORK,
      schedule: makeSchedule('work'),
    });

    it('returns the schedule entry for valid hours', () => {
      expect(activityAtHour(c, 0)).toBe('work');
      expect(activityAtHour(c, 23)).toBe('work');
    });

    it('returns sleep for out-of-range hours', () => {
      expect(activityAtHour(c, -1)).toBe('sleep');
      expect(activityAtHour(c, 24)).toBe('sleep');
      expect(activityAtHour(c, 1.5)).toBe('sleep');
    });
  });

  describe('state transitions (sleep -> commute -> work)', () => {
    function mixedSchedule(): ActivityId[] {
      // h=0..7 sleep, h=8 commute, h=9..17 work, h=18 commute, h=19..22 leisure, h=23 sleep
      const s: ActivityId[] = new Array(24).fill('sleep') as ActivityId[];
      s[8] = 'commute';
      for (let i = 9; i <= 17; i += 1) s[i] = 'work';
      s[18] = 'commute';
      for (let i = 19; i <= 22; i += 1) s[i] = 'leisure';
      s[23] = 'sleep';
      return s;
    }

    it('transitions sleep (h=7) -> commute (h=8) -> work (h=9) using activityAtHour', () => {
      const c = createCitizen({
        id: 'cit-transit' as CitizenId,
        position: { x: 0, y: 0 },
        name: 'Transit',
        homeId: HOME,
        workplaceId: WORK,
        schedule: mixedSchedule(),
      });
      expect(activityAtHour(c, 7)).toBe('sleep');
      expect(activityAtHour(c, 8)).toBe('commute');
      expect(activityAtHour(c, 9)).toBe('work');
    });

    it('transitions back to sleep in the evening (h=22 leisure, h=23 sleep)', () => {
      const c = createCitizen({
        id: 'cit-transit' as CitizenId,
        position: { x: 0, y: 0 },
        name: 'Transit',
        homeId: HOME,
        workplaceId: WORK,
        schedule: mixedSchedule(),
      });
      expect(activityAtHour(c, 22)).toBe('leisure');
      expect(activityAtHour(c, 23)).toBe('sleep');
      expect(activityAtHour(c, 0)).toBe('sleep');
    });
  });

  describe('applyNeedDeltas', () => {
    it('applies deltas for currentActivity and clamps', () => {
      const c = createCitizen({
        id: 'cit-1' as CitizenId,
        position: { x: 0, y: 0 },
        name: 'Test',
        homeId: HOME,
        workplaceId: null,
        schedule: makeSchedule('eat'),
        currentActivity: 'eat',
      });
      const next = applyNeedDeltas(c, {
        eat: { energy: 5, hunger: 50, fun: -1000, social: 0 },
      });
      expect(next.needs.energy).toBe(95);
      expect(next.needs.hunger).toBe(100); // clamped
      expect(next.needs.fun).toBe(0); // clamped from 60 + (-1000)
      expect(next.needs.social).toBe(55);
    });

    it('is a no-op for unrelated activities', () => {
      const c = createCitizen({
        id: 'cit-1' as CitizenId,
        position: { x: 0, y: 0 },
        name: 'Test',
        homeId: HOME,
        workplaceId: null,
        schedule: makeSchedule('sleep'),
        currentActivity: 'sleep',
      });
      const next = applyNeedDeltas(c, { work: { energy: -99 } });
      expect(next).toBe(c);
    });
  });

  describe('isCitizen type guard', () => {
    it('accepts a well-formed citizen', () => {
      const c = createCitizen({
        id: 'cit-1' as CitizenId,
        position: { x: 0, y: 0 },
        name: 'Test',
        homeId: HOME,
        workplaceId: null,
        schedule: makeSchedule(),
      });
      expect(isCitizen(c)).toBe(true);
    });

    it('rejects malformed input', () => {
      expect(isCitizen(null)).toBe(false);
      expect(isCitizen({})).toBe(false);
      expect(isCitizen({ id: 'x' })).toBe(false);
    });
  });

  describe('module surface', () => {
    it('exports DEFAULT_NEEDS that are all in [0, 100]', () => {
      for (const value of Object.values(DEFAULT_NEEDS)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    });

    it('ACTIVITY_IDS contains exactly the known activity ids', () => {
      expect(ACTIVITY_IDS.length).toBe(7);
      expect(ACTIVITY_IDS).toContain('sleep');
      expect(ACTIVITY_IDS).toContain('work');
    });

    it('isActivityId type-guard works for known and unknown values', () => {
      expect(isActivityId('sleep')).toBe(true);
      expect(isActivityId('bogus')).toBe(false);
      expect(isActivityId(42)).toBe(false);
    });

    it('clampNeed handles boundary values', () => {
      expect(clampNeed(0)).toBe(0);
      expect(clampNeed(100)).toBe(100);
      expect(clampNeed(-1)).toBe(0);
      expect(clampNeed(101)).toBe(100);
      expect(clampNeed(NaN)).toBe(0);
      expect(clampNeed(42.7)).toBe(42.7);
    });
  });
});
