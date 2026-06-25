/**
 * Unit tests for ScheduleGenerator (spec §7.2).
 *
 * Covers:
 *  - 24-entry schedule generation.
 *  - Employed vs unemployed activity blocks.
 *  - Jitter bounds [-30, +30].
 *  - Determinism with a seeded RNG.
 *  - getScheduleActivity lookup.
 */
import {
  canonicalActivity,
  generateSchedule,
  getScheduleActivity,
  MAX_JITTER_MINUTES,
} from '@/systems/ScheduleGenerator';
import { mulberry32 } from '@/generation/BuildingPlacer';

describe('canonicalActivity', () => {
  it('employed: sleeping at night, commuting at 8/17, working 9-16, eating at 12', () => {
    expect(canonicalActivity(0, true)).toBe('sleeping');
    expect(canonicalActivity(5, true)).toBe('sleeping');
    expect(canonicalActivity(8, true)).toBe('commuting');
    expect(canonicalActivity(9, true)).toBe('working');
    expect(canonicalActivity(11, true)).toBe('working');
    expect(canonicalActivity(12, true)).toBe('eating');
    expect(canonicalActivity(13, true)).toBe('working');
    expect(canonicalActivity(16, true)).toBe('working');
    expect(canonicalActivity(17, true)).toBe('commuting');
    expect(canonicalActivity(18, true)).toBe('entertaining');
    expect(canonicalActivity(21, true)).toBe('entertaining');
    expect(canonicalActivity(22, true)).toBe('sleeping');
    expect(canonicalActivity(23, true)).toBe('sleeping');
  });

  it('unemployed: wandering during day, eating at noon, entertaining evening', () => {
    expect(canonicalActivity(0, false)).toBe('sleeping');
    expect(canonicalActivity(9, false)).toBe('wandering');
    expect(canonicalActivity(12, false)).toBe('eating');
    expect(canonicalActivity(15, false)).toBe('wandering');
    expect(canonicalActivity(18, false)).toBe('entertaining');
    expect(canonicalActivity(21, false)).toBe('entertaining');
    expect(canonicalActivity(22, false)).toBe('sleeping');
  });

  it('wraps hours outside [0,23] via modulo', () => {
    expect(canonicalActivity(24, true)).toBe('sleeping');
    expect(canonicalActivity(32, true)).toBe('commuting');
    expect(canonicalActivity(-1, true)).toBe('sleeping');
  });
});

describe('generateSchedule', () => {
  it('produces exactly 24 entries indexed by hour', () => {
    const schedule = generateSchedule(true, mulberry32(1));
    expect(schedule).toHaveLength(24);
    for (let h = 0; h < 24; h++) {
      expect(schedule[h].hour).toBe(h);
    }
  });

  it('every jitterMinutes is within [-30, +30]', () => {
    const schedule = generateSchedule(true, mulberry32(99));
    for (const entry of schedule) {
      expect(entry.jitterMinutes).toBeGreaterThanOrEqual(-MAX_JITTER_MINUTES);
      expect(entry.jitterMinutes).toBeLessThanOrEqual(MAX_JITTER_MINUTES);
    }
  });

  it('employed schedule contains working blocks', () => {
    const schedule = generateSchedule(true, mulberry32(1));
    const activities = schedule.map((e) => e.activity);
    expect(activities).toContain('working');
    expect(activities).toContain('commuting');
    expect(activities).toContain('eating');
  });

  it('unemployed schedule contains wandering blocks and no working/commuting', () => {
    const schedule = generateSchedule(false, mulberry32(1));
    const activities = schedule.map((e) => e.activity);
    expect(activities).toContain('wandering');
    expect(activities).not.toContain('working');
    expect(activities).not.toContain('commuting');
  });

  it('is deterministic for the same seed', () => {
    const a = generateSchedule(true, mulberry32(42));
    const b = generateSchedule(true, mulberry32(42));
    expect(a).toEqual(b);
  });

  it('different seeds usually produce different jitter', () => {
    const a = generateSchedule(true, mulberry32(1));
    const b = generateSchedule(true, mulberry32(2));
    const jitterA = a.map((e) => e.jitterMinutes);
    const jitterB = b.map((e) => e.jitterMinutes);
    expect(jitterA).not.toEqual(jitterB);
  });
});

describe('getScheduleActivity', () => {
  const schedule = generateSchedule(true, mulberry32(1));

  it('returns the activity for the given hour', () => {
    expect(getScheduleActivity(schedule, 9)).toBe('working');
    expect(getScheduleActivity(schedule, 12)).toBe('eating');
  });

  it('wraps hours outside [0,23]', () => {
    expect(getScheduleActivity(schedule, 24)).toBe(getScheduleActivity(schedule, 0));
    expect(getScheduleActivity(schedule, -1)).toBe(getScheduleActivity(schedule, 23));
  });
});
