import { TimeSystem } from '@/systems/TimeSystem';

describe('TimeSystem', () => {
  // ------------------------------------------------------------------
  // Initial state
  // ------------------------------------------------------------------

  it('starts at hour=0, minute=0, day=1, isDaytime=false', () => {
    const ts = new TimeSystem();
    const time = ts.getCityTime();
    expect(time.hour).toBe(0);
    expect(time.minute).toBe(0);
    expect(time.day).toBe(1);
    expect(time.isDaytime).toBe(false);
  });

  // ------------------------------------------------------------------
  // Speed multiplier tests
  // ------------------------------------------------------------------

  it('at 1× speed: 300 000 ms delta advances exactly 1 full day (24 hours)', () => {
    const ts = new TimeSystem();
    ts.update(300_000, 1);
    const time = ts.getCityTime();
    expect(time.day).toBe(2);
    expect(time.hour).toBe(0);
    expect(time.minute).toBe(0);
  });

  it('at 2× speed: 150 000 ms delta advances exactly 1 full day', () => {
    const ts = new TimeSystem();
    ts.update(150_000, 2);
    const time = ts.getCityTime();
    expect(time.day).toBe(2);
    expect(time.hour).toBe(0);
    expect(time.minute).toBe(0);
  });

  it('at 5× speed: 60 000 ms delta advances exactly 1 full day', () => {
    const ts = new TimeSystem();
    ts.update(60_000, 5);
    const time = ts.getCityTime();
    expect(time.day).toBe(2);
    expect(time.hour).toBe(0);
    expect(time.minute).toBe(0);
  });

  // ------------------------------------------------------------------
  // Pause
  // ------------------------------------------------------------------

  it('at speed 0 (pause): time does not advance regardless of deltaMs', () => {
    const ts = new TimeSystem();
    ts.update(1_000_000, 0);
    const time = ts.getCityTime();
    expect(time.hour).toBe(0);
    expect(time.minute).toBe(0);
    expect(time.day).toBe(1);
    expect(time.tick).toBe(0);
  });

  // ------------------------------------------------------------------
  // new_day event
  // ------------------------------------------------------------------

  it('emits new_day exactly once when crossing midnight (23:59 → 00:00)', () => {
    const ts = new TimeSystem();
    const listener = jest.fn();
    ts.on('new_day', listener);

    // Advance to 23:59 (23 h × 60 min + 59 min = 1439 sim-minutes).
    // Use exact integer ms: 1 sim-minute = 300000/1440 ms. To avoid
    // floating-point drift we advance in whole sim-days worth of ms and
    // subtract one sim-minute, keeping the total an exact multiple.
    // 1439 sim-minutes = 1 sim-day (1440 min) minus 1 min.
    const msPerSimDay = 300_000;
    const msForOneSimMinute = msPerSimDay / 1440;
    // Advance a full day first (lands at 00:00 day 2), then we'll reset.
    // Instead, advance 1439 minutes directly using integer ms per minute
    // accumulated via repeated small exact steps is noisy; use the closed
    // form and round to the nearest integer ms.
    const msFor1439Minutes = Math.round(1439 * msForOneSimMinute);
    ts.update(msFor1439Minutes, 1);

    const before = ts.getCityTime();
    expect(before.hour).toBe(23);
    expect(before.minute).toBe(59);
    expect(listener).not.toHaveBeenCalled();

    // Advance 1 more sim-minute to cross midnight.
    ts.update(Math.round(msForOneSimMinute), 1);

    const after = ts.getCityTime();
    expect(after.hour).toBe(0);
    expect(after.minute).toBe(0);
    expect(after.day).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(2);
  });

  it('emits new_day once per day when multiple days cross in one update', () => {
    const ts = new TimeSystem();
    const listener = jest.fn();
    ts.on('new_day', listener);

    // Advance 3 full days at 1×.
    ts.update(300_000 * 3, 1);

    expect(ts.getCityTime().day).toBe(4);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenNthCalledWith(1, 2);
    expect(listener).toHaveBeenNthCalledWith(2, 3);
    expect(listener).toHaveBeenNthCalledWith(3, 4);
  });

  // ------------------------------------------------------------------
  // isDaytime transitions
  // ------------------------------------------------------------------

  it('isDaytime is false at hour 5, true at hour 6, true at hour 18, false at hour 19', () => {
    const ts = new TimeSystem();

    // Advance to hour 5 (5 × 60 = 300 sim-minutes).
    const msFor5Hours = Math.round((300 * 300_000) / 1440);
    ts.update(msFor5Hours, 1);
    expect(ts.getCityTime().hour).toBe(5);
    expect(ts.getCityTime().isDaytime).toBe(false);

    // Advance 1 hour to hour 6.
    const msFor1Hour = Math.round((60 * 300_000) / 1440);
    ts.update(msFor1Hour, 1);
    expect(ts.getCityTime().hour).toBe(6);
    expect(ts.getCityTime().isDaytime).toBe(true);

    // Advance 12 hours to hour 18.
    ts.update(msFor1Hour * 12, 1);
    expect(ts.getCityTime().hour).toBe(18);
    expect(ts.getCityTime().isDaytime).toBe(true);

    // Advance 1 hour to hour 19.
    ts.update(msFor1Hour, 1);
    expect(ts.getCityTime().hour).toBe(19);
    expect(ts.getCityTime().isDaytime).toBe(false);
  });

  // ------------------------------------------------------------------
  // Invalid inputs
  // ------------------------------------------------------------------

  it('throws on negative deltaMs', () => {
    const ts = new TimeSystem();
    expect(() => ts.update(-1, 1)).toThrow('deltaMs must be >= 0');
  });

  it('throws on unsupported speedMultiplier', () => {
    const ts = new TimeSystem();
    expect(() => ts.update(100, 3)).toThrow('speedMultiplier must be one of');
    expect(() => ts.update(100, -1)).toThrow('speedMultiplier must be one of');
    expect(() => ts.update(100, 10)).toThrow('speedMultiplier must be one of');
  });

  // ------------------------------------------------------------------
  // Fractional accumulation
  // ------------------------------------------------------------------

  it('accumulates small deltas correctly without losing precision', () => {
    const ts = new TimeSystem();

    // Feed 300 000 ms in 1 ms increments at 1×.
    for (let i = 0; i < 300_000; i += 1) {
      ts.update(1, 1);
    }

    const time = ts.getCityTime();
    expect(time.day).toBe(2);
    expect(time.hour).toBe(0);
    // Minute may be off by ±1 due to integer-minute accumulation.
    expect(time.minute).toBeGreaterThanOrEqual(0);
    expect(time.minute).toBeLessThanOrEqual(1);
  });

  // ------------------------------------------------------------------
  // on / off lifecycle
  // ------------------------------------------------------------------

  it('off() removes a listener so it no longer fires', () => {
    const ts = new TimeSystem();
    const listener = jest.fn();
    ts.on('new_day', listener);
    ts.off('new_day', listener);

    ts.update(300_000, 1);
    expect(listener).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // reset
  // ------------------------------------------------------------------

  it('reset() returns the clock to initial state', () => {
    const ts = new TimeSystem();
    ts.update(300_000, 1);
    expect(ts.getCityTime().day).toBe(2);

    ts.reset();
    const time = ts.getCityTime();
    expect(time.hour).toBe(0);
    expect(time.minute).toBe(0);
    expect(time.day).toBe(1);
    expect(time.tick).toBe(0);
    expect(time.elapsedMs).toBe(0);
    expect(time.isDaytime).toBe(false);
  });

  // ------------------------------------------------------------------
  // deltaMs = 0 is a no-op
  // ------------------------------------------------------------------

  it('update() with deltaMs=0 is a no-op', () => {
    const ts = new TimeSystem();
    ts.update(0, 1);
    const time = ts.getCityTime();
    expect(time.tick).toBe(0);
    expect(time.hour).toBe(0);
    expect(time.minute).toBe(0);
  });

  // ------------------------------------------------------------------
  // Listener error isolation
  // ------------------------------------------------------------------

  it('a throwing listener does not prevent other listeners from firing', () => {
    const ts = new TimeSystem();
    const badListener = jest.fn(() => {
      throw new Error('boom');
    });
    const goodListener = jest.fn();

    ts.on('new_day', badListener);
    ts.on('new_day', goodListener);

    // Suppress console.error from the catch block.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    ts.update(300_000, 1);

    expect(badListener).toHaveBeenCalledTimes(1);
    expect(goodListener).toHaveBeenCalledTimes(1);
  });
});
