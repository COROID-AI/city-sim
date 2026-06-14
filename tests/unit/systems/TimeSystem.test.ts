/**
 * Unit tests for src/systems/TimeSystem.ts.
 *
 * The TimeSystem is pure TypeScript and depends only on the engine's
 * CityTime type. We exercise the tick math, isDaytime windows,
 * daylightFactor curve, setSpeed(0) freeze, day rollover, and the
 * onDayChange subscribe/unsubscribe contract.
 */

import {
  DEFAULT_DAY_START_HOUR,
  DEFAULT_NIGHT_START_HOUR,
  DEFAULT_REAL_TO_SIM_RATIO,
  HOURS_PER_DAY,
  TimeSystem,
} from '@/systems/TimeSystem';

describe('TimeSystem', () => {
  test('default constructor produces a sensible initial state', () => {
    const t = new TimeSystem();
    const snap = t.getTime();
    expect(snap.day).toBe(1);
    expect(snap.hour).toBeGreaterThanOrEqual(0);
    expect(snap.hour).toBeLessThan(HOURS_PER_DAY);
    expect(snap.tick).toBe(0);
    expect(snap.elapsed).toBe(0);
  });

  test('tick advances elapsed and tick counters', () => {
    const t = new TimeSystem({ realToSimRatio: 1 });
    t.tick(0.1);
    t.tick(0.1);
    const snap = t.getTime();
    expect(snap.elapsed).toBeCloseTo(0.2, 6);
    expect(snap.tick).toBe(2);
  });

  test('tick advances in-world hour proportional to speed and ratio', () => {
    // 1 real second = 60 sim seconds at 1× → 1/60 sim hour.
    const t = new TimeSystem({ realToSimRatio: 60 });
    t.tick(1);
    const snap = t.getTime();
    expect(snap.hour).toBeCloseTo(8 + 1 / 60, 4);
  });

  test('setSpeed(0) freezes the in-world clock', () => {
    const t = new TimeSystem({ realToSimRatio: 60 });
    t.setSpeed(0);
    t.tick(1);
    const snap = t.getTime();
    expect(snap.hour).toBe(8);
    expect(snap.day).toBe(1);
    // Elapsed + tick counters still advance (the loop is still alive).
    expect(snap.elapsed).toBeGreaterThan(0);
    expect(snap.tick).toBe(1);
  });

  test('pause() also freezes the in-world clock', () => {
    const t = new TimeSystem({ realToSimRatio: 60 });
    t.pause();
    t.tick(1);
    expect(t.getTime().hour).toBe(8);
    t.resume();
    t.tick(1);
    expect(t.getTime().hour).toBeGreaterThan(8);
  });

  test('togglePause flips between paused and running', () => {
    const t = new TimeSystem();
    expect(t.isPaused()).toBe(false);
    t.togglePause();
    expect(t.isPaused()).toBe(true);
    t.togglePause();
    expect(t.isPaused()).toBe(false);
  });

  test('higher speed multipliers advance faster', () => {
    const a = new TimeSystem({ realToSimRatio: 60 });
    const b = new TimeSystem({ realToSimRatio: 60 });
    a.setSpeed(1);
    b.setSpeed(4);
    a.tick(1);
    b.tick(1);
    expect(b.getTime().hour).toBeGreaterThan(a.getTime().hour);
    // b should advance roughly 4× as much.
    const expected = (b.getTime().hour - 8) / (a.getTime().hour - 8);
    expect(expected).toBeCloseTo(4, 1);
  });

  test('isDaytime matches the configured window', () => {
    const t = new TimeSystem({
      realToSimRatio: 3600, // 1 real second = 1 sim hour at 1×
      dayStartHour: 6,
      nightStartHour: 18,
      initial: { hour: 0, day: 1, tick: 0, elapsed: 0 },
    });
    t.setSpeed(1);
    // Noon
    t.tick(12);
    expect(t.isDaytime()).toBe(true);
    // Past nightStart
    t.tick(6);
    expect(t.isDaytime()).toBe(false);
  });

  test('daylightFactor is 1 at noon and 0 at midnight', () => {
    const t = new TimeSystem({ initial: { hour: 12 } });
    expect(t.daylightFactor(2)).toBeCloseTo(1, 5);
    const midnight = new TimeSystem({ initial: { hour: 0 } });
    expect(midnight.daylightFactor(2)).toBeCloseTo(0, 5);
  });

  test('daylightFactor is monotonically non-decreasing from 0 to noon', () => {
    const t = new TimeSystem({ initial: { hour: 0, day: 1, tick: 0, elapsed: 0 } });
    const samples: number[] = [];
    for (let h = 0; h <= 12; h += 1) {
      t.setSpeed(0);
      // Reset hour each iteration deterministically.
      const snap = t.getTime();
      void snap;
      // Set hour directly via initial.
      const fresh = new TimeSystem({ initial: { hour: h } });
      samples.push(fresh.daylightFactor(2));
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 1e-9);
    }
  });

  test('day rollover increments day and wraps hour', () => {
    const t = new TimeSystem({
      realToSimRatio: 60 * 60, // 1 real second = 60 sim hours at 1×
      initial: { hour: 23, day: 1, tick: 0, elapsed: 0 },
    });
    t.setSpeed(1);
    t.tick(1);
    const snap = t.getTime();
    expect(snap.day).toBe(2);
    expect(snap.hour).toBeGreaterThanOrEqual(0);
    expect(snap.hour).toBeLessThan(HOURS_PER_DAY);
  });

  test('onDayChange fires once per day rollover', () => {
    const t = new TimeSystem({
      realToSimRatio: 60 * 60,
      initial: { hour: 23, day: 5, tick: 0, elapsed: 0 },
    });
    t.setSpeed(1);
    const seen: Array<{ day: number; hour: number }> = [];
    const unsub = t.onDayChange((day, hour) => {
      seen.push({ day, hour });
    });
    // Each tick(1) with ratio=60*60 advances 1 in-world hour. Tick three
    // separate times of 1h to cross three day boundaries. Start at hour
    // 23 of day 5 → first tick rolls to day 6, hour 0; second to day 7;
    // third to day 8.
    t.tick(1); // 23h -> 0h, day 6
    t.tick(24); // 0h -> 0h, day 7
    t.tick(24); // 0h -> 0h, day 8
    expect(seen.length).toBe(3);
    expect(seen[0]?.day).toBe(6);
    expect(seen[1]?.day).toBe(7);
    expect(seen[2]?.day).toBe(8);
    unsub();
    t.tick(24);
    t.tick(24);
    // No new events after unsubscribe.
    expect(seen.length).toBe(3);
  });

  test('onDayChange errors do not break the simulation', () => {
    const t = new TimeSystem({
      realToSimRatio: 60 * 60,
      initial: { hour: 23, day: 1, tick: 0, elapsed: 0 },
    });
    t.setSpeed(1);
    t.onDayChange(() => {
      throw new Error('boom');
    });
    let count = 0;
    t.onDayChange(() => {
      count += 1;
    });
    expect(() => t.tick(1)).not.toThrow();
    expect(count).toBe(1);
  });

  test('exposes default constants', () => {
    expect(HOURS_PER_DAY).toBe(24);
    expect(DEFAULT_DAY_START_HOUR).toBe(6);
    expect(DEFAULT_NIGHT_START_HOUR).toBe(18);
    expect(DEFAULT_REAL_TO_SIM_RATIO).toBeGreaterThan(0);
  });

  test('rejects invalid options', () => {
    expect(() => new TimeSystem({ realToSimRatio: 0 })).toThrow(RangeError);
    expect(() => new TimeSystem({ dayStartHour: -1 })).toThrow(RangeError);
    expect(() => new TimeSystem({ nightStartHour: 24 })).toThrow(RangeError);
  });
});
