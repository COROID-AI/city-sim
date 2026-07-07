import { SimClock, isNight, SIM_HOUR_MS, NIGHT_START_HOUR } from './time';

describe('isNight', () => {
  it('returns true for the night range 19-5 inclusive', () => {
    // Hours 19..23
    for (let h = 19; h <= 23; h++) {
      expect(isNight(h)).toBe(true);
    }
    // Hours 0..5
    for (let h = 0; h <= 5; h++) {
      expect(isNight(h)).toBe(true);
    }
  });

  it('returns false for daytime hours 6-18 inclusive', () => {
    for (let h = 6; h <= 18; h++) {
      expect(isNight(h)).toBe(false);
    }
  });

  it('is correct at the exact boundary 18 -> 19 -> 20', () => {
    expect(isNight(18)).toBe(false);
    expect(isNight(19)).toBe(true);
    expect(isNight(20)).toBe(true);
  });

  it('is correct at the dawn boundary 4 -> 5 -> 6', () => {
    expect(isNight(4)).toBe(true);
    expect(isNight(5)).toBe(true);
    expect(isNight(6)).toBe(false);
  });
});

describe('SimClock', () => {
  it('starts at the given hour and day', () => {
    const clock = new SimClock(8, 0);
    expect(clock.currentSimHour).toBe(8);
    expect(clock.day).toBe(0);
  });

  it('wraps the start hour modulo 24', () => {
    const clock = new SimClock(26, 0);
    expect(clock.currentSimHour).toBe(2);
  });

  it('advances one whole hour after SIM_HOUR_MS ms', () => {
    const clock = new SimClock(8, 0);
    clock.step(SIM_HOUR_MS);
    expect(clock.currentSimHour).toBe(9);
    expect(clock.day).toBe(0);
  });

  it('accumulates sub-hour remainders across steps', () => {
    const clock = new SimClock(8, 0);
    const half = Math.floor(SIM_HOUR_MS / 2);
    clock.step(half);
    expect(clock.currentSimHour).toBe(8); // not yet a full hour
    clock.step(half);
    expect(clock.currentSimHour).toBe(9); // now a full hour
  });

  it('wraps the hour from 23 to 0 and increments the day', () => {
    const clock = new SimClock(23, 0);
    clock.step(SIM_HOUR_MS);
    expect(clock.currentSimHour).toBe(0);
    expect(clock.day).toBe(1);
  });

  it('can advance multiple days in a single large step', () => {
    const clock = new SimClock(23, 0);
    // 25 hours -> wraps to hour 0 of the following day, then +1 day.
    clock.step(SIM_HOUR_MS * 25);
    expect(clock.currentSimHour).toBe(0);
    expect(clock.day).toBe(2);
  });

  it('reports isNight correctly as the hour changes', () => {
    const clock = new SimClock(NIGHT_START_HOUR, 0);
    expect(clock.isNight).toBe(true);
    // Advance to 06:00 (daytime).
    const hoursToSix = (24 + 6 - NIGHT_START_HOUR) % 24;
    clock.step(SIM_HOUR_MS * hoursToSix);
    expect(clock.currentSimHour).toBe(6);
    expect(clock.isNight).toBe(false);
  });

  it('rejects negative delta', () => {
    const clock = new SimClock(8, 0);
    expect(() => clock.step(-1)).toThrow();
  });

  it('reset restores the initial state', () => {
    const clock = new SimClock(8, 2);
    clock.step(SIM_HOUR_MS * 50);
    clock.reset(12, 0);
    expect(clock.currentSimHour).toBe(12);
    expect(clock.day).toBe(0);
  });

  it('no-op step with zero delta', () => {
    const clock = new SimClock(8, 0);
    const advanced = clock.step(0);
    expect(advanced).toBe(0);
    expect(clock.currentSimHour).toBe(8);
  });
});
