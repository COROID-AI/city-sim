/**
 * Unit tests for TimeSystem (spec §3.1, §6.2).
 *
 * Time compression math:
 *  - 1 sim-day = 86,400,000 ms (sim) = 300,000 ms (real at 1x)
 *  - Compression ratio = 288
 *  - GameLoop fixed step = 50ms real → 14,400 ms sim at 1x
 *  - 6,000 steps × 50ms = 300,000 real-ms = 1 sim-day at 1x
 */
import {
  TimeSystem,
  TIME_COMPRESSION,
  MS_PER_DAY,
  NEW_DAY_EVENT,
} from '@/systems/TimeSystem';
import { SIMULATION_STEP } from '@/engine/GameLoop';

describe('TimeSystem', () => {
  let ts: TimeSystem;

  beforeEach(() => {
    ts = new TimeSystem();
  });

  describe('time compression', () => {
    it('exposes a 288x compression ratio', () => {
      expect(TIME_COMPRESSION).toBe(288);
      expect(MS_PER_DAY).toBe(86_400_000);
    });

    it('advances exactly 1 sim-day after 6,000 steps of 50ms at 1x', () => {
      for (let i = 0; i < 6000; i++) {
        ts.update(SIMULATION_STEP);
      }
      const time = ts.getTime();
      expect(time.day).toBe(1);
      expect(time.hour).toBe(0);
      expect(time.minute).toBe(0);
      expect(time.totalMs).toBe(MS_PER_DAY);
    });
  });

  describe('speed multipliers', () => {
    it('300,000 real-ms at 1x = exactly 1 sim-day', () => {
      ts.setSpeed(1);
      ts.update(300_000);
      const time = ts.getTime();
      expect(time.day).toBe(1);
      expect(time.hour).toBe(0);
      expect(time.minute).toBe(0);
    });

    it('300,000 real-ms at 2x = exactly 2 sim-days', () => {
      ts.setSpeed(2);
      ts.update(300_000);
      const time = ts.getTime();
      expect(time.day).toBe(2);
      expect(time.hour).toBe(0);
      expect(time.minute).toBe(0);
    });

    it('300,000 real-ms at 5x = exactly 5 sim-days', () => {
      ts.setSpeed(5);
      ts.update(300_000);
      const time = ts.getTime();
      expect(time.day).toBe(5);
      expect(time.hour).toBe(0);
      expect(time.minute).toBe(0);
    });

    it('pause (speed 0) freezes time', () => {
      ts.setSpeed(0);
      ts.update(300_000);
      const time = ts.getTime();
      expect(time.day).toBe(0);
      expect(time.hour).toBe(0);
      expect(time.minute).toBe(0);
      expect(time.totalMs).toBe(0);
      expect(ts.isPaused()).toBe(true);
    });

    it('pause() method freezes time', () => {
      ts.pause();
      ts.update(300_000);
      expect(ts.getTime().totalMs).toBe(0);
      expect(ts.isPaused()).toBe(true);
    });

    it('getSpeed returns the current multiplier', () => {
      ts.setSpeed(2);
      expect(ts.getSpeed()).toBe(2);
      ts.setSpeed(5);
      expect(ts.getSpeed()).toBe(5);
      ts.setSpeed(0);
      expect(ts.getSpeed()).toBe(0);
    });
  });

  describe('minute / hour carry math', () => {
    it('advances minutes correctly within an hour', () => {
      // 1 sim-minute = 60,000 ms sim = 60,000 / 288 ≈ 208.33 real-ms at 1x.
      // Use 7 sim-minutes = 420,000 ms sim → real-ms = 420,000 / 288.
      ts.update(420_000 / TIME_COMPRESSION);
      const time = ts.getTime();
      expect(time.minute).toBe(7);
      expect(time.hour).toBe(0);
    });

    it('carries minutes into hours', () => {
      // 90 sim-minutes = 1 sim-hour 30 sim-minutes = 5,400,000 ms sim.
      ts.update(5_400_000 / TIME_COMPRESSION);
      const time = ts.getTime();
      expect(time.hour).toBe(1);
      expect(time.minute).toBe(30);
    });

    it('carries hours into a new day at midnight (23 → 0)', () => {
      // Advance to 23:00 then one more hour → day 1, 00:00
      ts.setSpeed(1);
      // 23 hours = 23 × 3,600,000 = 82,800,000 ms sim
      // real-ms needed = 82,800,000 / 288 = 287,500
      ts.update(287_500);
      expect(ts.getTime().hour).toBe(23);
      // One more sim-hour: 3,600,000 / 288 = 12,500 real-ms
      ts.update(12_500);
      const time = ts.getTime();
      expect(time.day).toBe(1);
      expect(time.hour).toBe(0);
      expect(time.minute).toBe(0);
    });
  });

  describe('isDaytime (spec §6.2)', () => {
    /** Helper: set totalMs directly via update at 1x for an exact sim-ms. */
    function setSimMs(system: TimeSystem, simMs: number): void {
      system.reset();
      system.setSpeed(1);
      system.update(simMs / TIME_COMPRESSION);
    }

    it('returns false at hour 0 (midnight)', () => {
      setSimMs(ts, 0);
      expect(ts.isDaytime()).toBe(false);
    });

    it('returns false at hour 5 (just before dawn)', () => {
      setSimMs(ts, 5 * MS_PER_DAY / 24);
      expect(ts.getTime().hour).toBe(5);
      expect(ts.isDaytime()).toBe(false);
    });

    it('returns true at hour 6 (dawn boundary inclusive)', () => {
      setSimMs(ts, 6 * MS_PER_DAY / 24);
      expect(ts.getTime().hour).toBe(6);
      expect(ts.isDaytime()).toBe(true);
    });

    it('returns true at hour 19 (just before dusk)', () => {
      setSimMs(ts, 19 * MS_PER_DAY / 24);
      expect(ts.getTime().hour).toBe(19);
      expect(ts.isDaytime()).toBe(true);
    });

    it('returns false at hour 20 (dusk boundary exclusive)', () => {
      setSimMs(ts, 20 * MS_PER_DAY / 24);
      expect(ts.getTime().hour).toBe(20);
      expect(ts.isDaytime()).toBe(false);
    });

    it('returns false at hour 23', () => {
      setSimMs(ts, 23 * MS_PER_DAY / 24);
      expect(ts.getTime().hour).toBe(23);
      expect(ts.isDaytime()).toBe(false);
    });
  });

  describe('new_day event', () => {
    it('emits new_day with the correct day number on rollover', () => {
      const calls: number[] = [];
      ts.on(NEW_DAY_EVENT, (payload) => calls.push(payload.day));
      ts.update(300_000); // 1 sim-day
      expect(calls).toEqual([1]);
    });

    it('emits new_day to all subscribers', () => {
      const a: number[] = [];
      const b: number[] = [];
      ts.on(NEW_DAY_EVENT, (p) => a.push(p.day));
      ts.on(NEW_DAY_EVENT, (p) => b.push(p.day));
      ts.update(300_000);
      expect(a).toEqual([1]);
      expect(b).toEqual([1]);
    });

    it('does not emit new_day when no rollover occurs', () => {
      const calls: number[] = [];
      ts.on(NEW_DAY_EVENT, (p) => calls.push(p.day));
      // Advance only 12 sim-hours
      ts.update(150_000);
      expect(calls).toHaveLength(0);
    });

    it('payload includes the CityTime snapshot', () => {
      let captured: { day: number; hour: number; minute: number } | null = null;
      ts.on(NEW_DAY_EVENT, (p) => {
        captured = { day: p.day, hour: p.time.hour, minute: p.time.minute };
      });
      ts.update(300_000);
      expect(captured).toEqual({ day: 1, hour: 0, minute: 0 });
    });
  });

  describe('listener unsubscribe', () => {
    it('unsubscribe via returned function stops further callbacks', () => {
      const calls: number[] = [];
      const unsubscribe = ts.on(NEW_DAY_EVENT, (p) => calls.push(p.day));
      unsubscribe();
      ts.update(300_000);
      expect(calls).toHaveLength(0);
    });

    it('off() removes a specific listener', () => {
      const calls: number[] = [];
      const listener = (p: { day: number }): void => {
        calls.push(p.day);
      };
      ts.on(NEW_DAY_EVENT, listener);
      ts.off(NEW_DAY_EVENT, listener);
      ts.update(300_000);
      expect(calls).toHaveLength(0);
    });
  });

  describe('reset', () => {
    it('resets the clock to day 0, 00:00', () => {
      ts.update(300_000);
      expect(ts.getTime().day).toBe(1);
      ts.reset();
      const time = ts.getTime();
      expect(time.day).toBe(0);
      expect(time.hour).toBe(0);
      expect(time.minute).toBe(0);
      expect(time.totalMs).toBe(0);
    });

    it('does not emit new_day on reset', () => {
      const calls: number[] = [];
      ts.on(NEW_DAY_EVENT, (p) => calls.push(p.day));
      ts.reset();
      expect(calls).toHaveLength(0);
    });
  });

  describe('GameLoop integration', () => {
    it('update accepts the GameLoop SIMULATION_STEP (50ms)', () => {
      // Should not throw and should advance time proportionally.
      ts.update(SIMULATION_STEP);
      expect(ts.getTotalMs()).toBe(SIMULATION_STEP * TIME_COMPRESSION);
    });

    it('ignores non-positive deltaMs', () => {
      ts.update(0);
      ts.update(-100);
      expect(ts.getTotalMs()).toBe(0);
    });
  });
});
