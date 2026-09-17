import { describe, expect, it } from 'vitest';

import {
  HOURS_PER_DAY,
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  SimClock,
  resolveDayPhase,
} from '../../src/sim/clock';
import type { HourBoundary } from '../../src/sim/clock';
import type { DayPhase } from '../../src/sim/types';

describe('resolveDayPhase', () => {
  it('names the phase for every hour of the day', () => {
    const phaseByHour: DayPhase[] = Array.from({ length: HOURS_PER_DAY }, (_, hour) =>
      resolveDayPhase(hour),
    );
    expect(phaseByHour).toEqual([
      'night', 'night', 'night', 'night', 'night',
      'dawn', 'dawn', 'dawn',
      'morning', 'morning', 'morning', 'morning',
      'day', 'day', 'day', 'day', 'day',
      'evening', 'evening', 'evening', 'evening',
      'night', 'night', 'night',
    ]);
    expect(resolveDayPhase(24)).toBe('night');
    expect(resolveDayPhase(-1)).toBe('night');
    expect(() => resolveDayPhase(Number.NaN)).toThrow(RangeError);
  });
});

describe('SimClock', () => {
  it('converts fixed ticks into sim minutes, hours and days', () => {
    const clock = new SimClock({ startHour: 8, minutesPerTick: 5 });
    expect(clock.minutesPerTick).toBe(5);
    expect(clock.totalMinutes).toBe(8 * MINUTES_PER_HOUR);

    clock.advanceTicks(1);
    expect(clock.minuteOfHour).toBe(5);
    expect(clock.hourOfDay).toBe(8);
    expect(clock.time).toEqual({ day: 0, hour: 8, minute: 5, totalMinutes: 485 });

    clock.advanceTicks(11);
    expect(clock.hourOfDay).toBe(9);
    expect(clock.minuteOfHour).toBe(0);
    expect(clock.day).toBe(0);

    clock.advanceTicks(HOURS_PER_DAY * (MINUTES_PER_HOUR / 5));
    expect(clock.day).toBe(1);
    expect(clock.hourOfDay).toBe(9);
  });

  it('formats sim time for the HUD', () => {
    const clock = new SimClock({ startHour: 9, startMinute: 5 });
    expect(clock.formatTime()).toBe('09:05');
    expect(clock.formatDayTime()).toBe('Day 1, 09:05');
    clock.advanceMinutes(MINUTES_PER_DAY);
    expect(clock.formatDayTime()).toBe('Day 2, 09:05');
  });

  it('exposes phase and day progress', () => {
    const clock = new SimClock({ startHour: 12 });
    expect(clock.phase).toBe('day');
    expect(clock.dayProgress).toBeCloseTo(0.5, 10);
    clock.setTime({ hour: 23, minute: 30 });
    expect(clock.phase).toBe('night');
    expect(clock.dayProgress).toBeCloseTo(23.5 / 24, 10);
  });

  it('fires end-of-hour before start-of-hour exactly on the boundary', () => {
    const clock = new SimClock({ startHour: 12, startMinute: 59 });
    const events: string[] = [];
    const boundaries: HourBoundary[] = [];
    clock.onHourEnd((boundary) => {
      events.push(`end:${boundary.endedHour}`);
    });
    clock.onHourStart((boundary) => {
      events.push(`start:${boundary.startedHour}`);
      boundaries.push(boundary);
    });

    clock.advanceMinutes(1);
    expect(events).toEqual(['end:12', 'start:13']);
    expect(clock.hourOfDay).toBe(13);
    expect(boundaries[0]).toMatchObject({
      endedHour: 12,
      endedDay: 0,
      startedHour: 13,
      day: 0,
      totalMinutes: 13 * MINUTES_PER_HOUR,
      phase: 'day',
    });
    expect(boundaries[0].time).toEqual({
      day: 0,
      hour: 13,
      minute: 0,
      totalMinutes: 13 * MINUTES_PER_HOUR,
    });

    clock.advanceMinutes(59);
    expect(events).toEqual(['end:12', 'start:13']);
    clock.advanceMinutes(1);
    expect(events).toEqual(['end:12', 'start:13', 'end:13', 'start:14']);
  });

  it('rolls over from hour 23 to hour 0 on the next day', () => {
    const clock = new SimClock({ startDay: 0, startHour: 23, startMinute: 59 });
    const starts: number[] = [];
    const ends: number[] = [];
    const boundaries: HourBoundary[] = [];
    clock.onHourStart((boundary) => {
      starts.push(boundary.startedHour);
      boundaries.push(boundary);
    });
    clock.onHourEnd((boundary) => ends.push(boundary.endedHour));

    clock.advanceTicks(1);

    expect(clock.day).toBe(1);
    expect(clock.hourOfDay).toBe(0);
    expect(clock.minuteOfHour).toBe(0);
    expect(clock.phase).toBe('night');
    expect(starts).toEqual([0]);
    expect(ends).toEqual([23]);
    expect(boundaries[0]).toMatchObject({
      endedHour: 23,
      endedDay: 0,
      startedHour: 0,
      day: 1,
      totalMinutes: MINUTES_PER_DAY,
      phase: 'night',
    });
  });

  it('emits one callback pair per boundary for a large jump', () => {
    const clock = new SimClock({ startHour: 0 });
    const starts: number[] = [];
    const ends: number[] = [];
    clock.onHourStart((boundary) => starts.push(boundary.startedHour));
    clock.onHourEnd((boundary) => ends.push(boundary.endedHour));

    clock.advanceMinutes(150);
    expect(clock.hourOfDay).toBe(2);
    expect(clock.minuteOfHour).toBe(30);
    expect(starts).toEqual([1, 2]);
    expect(ends).toEqual([0, 1]);

    const dayClock = new SimClock({ startHour: 0 });
    const dayStarts: number[] = [];
    dayClock.onHourStart((boundary) => dayStarts.push(boundary.startedHour));
    dayClock.advanceMinutes(MINUTES_PER_DAY);
    expect(dayStarts).toHaveLength(HOURS_PER_DAY);
    expect(dayStarts[0]).toBe(1);
    expect(dayStarts[HOURS_PER_DAY - 1]).toBe(0);
    expect(dayClock.day).toBe(1);
  });

  it('notifies listeners in subscription order and stops after unsubscribe', () => {
    const clock = new SimClock({ startHour: 6, startMinute: 59 });
    const calls: string[] = [];
    const unsubscribeFirst = clock.onHourStart(() => calls.push('first'));
    const unsubscribeSecond = clock.onHourStart(() => calls.push('second'));
    const unsubscribeEnd = clock.onHourEnd(() => calls.push('end'));

    expect(clock.hourStartListenerCount).toBe(2);
    expect(clock.hourEndListenerCount).toBe(1);

    clock.advanceMinutes(1);
    expect(calls).toEqual(['end', 'first', 'second']);

    unsubscribeFirst();
    unsubscribeEnd();
    calls.length = 0;
    clock.advanceMinutes(MINUTES_PER_HOUR);
    expect(calls).toEqual(['second']);
    expect(clock.hourStartListenerCount).toBe(1);
    expect(clock.hourEndListenerCount).toBe(0);

    unsubscribeSecond();
    expect(clock.hourStartListenerCount).toBe(0);
  });

  it('does nothing when advanced by zero minutes', () => {
    const clock = new SimClock({ startHour: 10 });
    const calls: string[] = [];
    clock.onHourStart(() => calls.push('start'));
    clock.advanceMinutes(0);
    clock.advanceTicks(0);
    expect(calls).toEqual([]);
    expect(clock.hourOfDay).toBe(10);
  });

  it('validates configuration, jumps and advances', () => {
    expect(() => new SimClock({ startHour: 24 })).toThrow(RangeError);
    expect(() => new SimClock({ startMinute: 60 })).toThrow(RangeError);
    expect(() => new SimClock({ startDay: -1 })).toThrow(RangeError);
    expect(() => new SimClock({ minutesPerTick: 0 })).toThrow(RangeError);
    expect(() => new SimClock({ minutesPerTick: 2.5 })).toThrow(RangeError);

    const clock = new SimClock({ startHour: 3, minutesPerTick: 2 });
    expect(() => clock.advanceMinutes(-1)).toThrow(RangeError);
    expect(() => clock.advanceMinutes(1.5)).toThrow(RangeError);
    expect(() => clock.advanceTicks(-2)).toThrow(RangeError);
    expect(() => clock.advanceTicks(1.5)).toThrow(RangeError);
    expect(() => clock.setTime({ hour: 30 })).toThrow(RangeError);
  });

  it('supports absolute jumps and reset', () => {
    const clock = new SimClock({ startDay: 2, startHour: 6 });
    clock.advanceMinutes(125);
    expect(clock.totalMinutes).toBe(2 * MINUTES_PER_DAY + 6 * MINUTES_PER_HOUR + 125);

    expect(clock.setTime({ day: 5, hour: 7, minute: 15 })).toEqual({
      day: 5,
      hour: 7,
      minute: 15,
      totalMinutes: 5 * MINUTES_PER_DAY + 7 * MINUTES_PER_HOUR + 15,
    });
    expect(clock.time.day).toBe(5);
    expect(clock.setTime({ hour: 9 }).hour).toBe(9);

    expect(clock.reset().totalMinutes).toBe(2 * MINUTES_PER_DAY + 6 * MINUTES_PER_HOUR);
  });
});
