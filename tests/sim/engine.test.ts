import { describe, expect, it } from 'vitest';

import { MINUTES_PER_DAY, MINUTES_PER_HOUR, SimClock } from '../../src/sim/clock';
import { SimulationEngine } from '../../src/sim/engine';
import type { EconomySnapshot } from '../../src/sim/types';
import {
  createEconomySystem,
  createRecordingSystem,
  createSimFixture,
} from '../helpers/sim-fixtures';

describe('SimulationEngine', () => {
  it('runs systems in registration order with a fixed sim-minute step', () => {
    const engine = new SimulationEngine({ minutesPerTick: 1 });
    const order: string[] = [];
    const first = createRecordingSystem('first', order);
    const second = createRecordingSystem('second', order);

    engine.attach(first);
    engine.attach(second);
    expect(engine.systemCount).toBe(2);
    expect(engine.systems.map((system) => system.name)).toEqual(['first', 'second']);

    expect(engine.step(3)).toBe(3);
    expect(order).toEqual(['first', 'second', 'first', 'second', 'first', 'second']);
    expect(first.updates).toEqual([1, 2, 3]);
    expect(second.updates).toEqual([1, 2, 3]);
    expect(engine.tickCount).toBe(3);
    expect(engine.clock.totalMinutes).toBe(3);
    expect(first.minuteLog).toEqual([1, 2, 3]);
  });

  it('scales the clock by minutesPerTick', () => {
    const engine = new SimulationEngine({ minutesPerTick: 7 });
    expect(engine.step(5)).toBe(5);
    expect(engine.clock.totalMinutes).toBe(35);
    expect(engine.clock.hourOfDay).toBe(0);
    expect(engine.clock.minuteOfHour).toBe(35);
  });

  it('calls hour hooks exactly once per boundary across one simulated day', () => {
    const fixture = createSimFixture({ startHour: 0, minutesPerTick: 1 });
    const [alpha, beta] = fixture.systems;

    expect(fixture.advanceMinutes(MINUTES_PER_DAY)).toBe(MINUTES_PER_DAY);

    for (const system of [alpha, beta]) {
      expect(system.updates).toHaveLength(MINUTES_PER_DAY);
      expect(system.hourEnds).toHaveLength(24);
      expect(system.hourStarts).toHaveLength(24);
      expect(system.hourEnds[0]).toBe(0);
      expect(system.hourStarts[0]).toBe(1);
      expect(system.hourEnds.at(-1)).toBe(23);
      expect(system.hourStarts.at(-1)).toBe(0);
    }
    expect(alpha.boundaries.at(-1)).toMatchObject({
      endedHour: 23,
      endedDay: 0,
      startedHour: 0,
      day: 1,
      totalMinutes: MINUTES_PER_DAY,
      phase: 'night',
    });
    expect(fixture.clock.day).toBe(1);
    expect(fixture.clock.hourOfDay).toBe(0);
    expect(fixture.order.filter((entry) => entry.endsWith(':hour-end'))).toHaveLength(48);
    expect(fixture.order.filter((entry) => entry.endsWith(':hour-start'))).toHaveLength(48);
  });

  it('orders hour hooks before the tick update that ends the hour', () => {
    const order: string[] = [];
    const engine = new SimulationEngine({ clock: new SimClock({ startHour: 0, startMinute: 59 }) });
    engine.attach(createRecordingSystem('a', order));
    engine.attach(createRecordingSystem('b', order));

    engine.step(1);

    expect(order).toEqual(['a:hour-end', 'b:hour-end', 'a:hour-start', 'b:hour-start', 'a', 'b']);
  });

  it('fires hooks once per boundary when a single step spans several hours', () => {
    const engine = new SimulationEngine({ minutesPerTick: 90 });
    const system = createRecordingSystem('logger');
    engine.attach(system);

    engine.step(3);

    expect(engine.clock.totalMinutes).toBe(270);
    expect(system.hourStarts).toEqual([1, 2, 3, 4]);
    expect(system.hourEnds).toEqual([0, 1, 2, 3]);
  });

  it('keeps boundary counts correct for step sizes that do not divide an hour', () => {
    const engine = new SimulationEngine({ minutesPerTick: 7 });
    const system = createRecordingSystem('logger');
    engine.attach(system);

    const ticks = Math.ceil(MINUTES_PER_DAY / 7);
    engine.step(ticks);

    expect(engine.clock.totalMinutes).toBe(ticks * 7);
    expect(system.hourStarts).toHaveLength(Math.floor(engine.clock.totalMinutes / MINUTES_PER_HOUR));
    expect(system.hourEnds).toHaveLength(system.hourStarts.length);
  });

  it('supports pause, resume and togglePause', () => {
    const engine = new SimulationEngine({ ticksPerSecond: 60 });
    engine.step(5);
    expect(engine.state).toBe('running');

    engine.pause();
    expect(engine.state).toBe('paused');
    expect(engine.isPaused).toBe(true);
    expect(engine.update(1000)).toBe(0);
    expect(engine.step(10)).toBe(0);
    expect(engine.clock.totalMinutes).toBe(5);

    expect(engine.togglePause()).toBe(false);
    expect(engine.state).toBe('running');
    expect(engine.update(1000)).toBe(60);
    expect(engine.clock.totalMinutes).toBe(65);

    engine.resume();
    expect(engine.isPaused).toBe(false);
  });

  it('scales real elapsed time by the speed multiplier', () => {
    const slow = new SimulationEngine({ ticksPerSecond: 60, speed: 1 });
    const fast = new SimulationEngine({ ticksPerSecond: 60, speed: 3 });

    expect(slow.update(500)).toBe(30);
    expect(fast.update(500)).toBe(90);

    fast.setSpeed(0.5);
    expect(fast.speed).toBe(0.5);
    expect(fast.update(500)).toBe(15);
  });

  it('caps catch-up steps per update instead of spiralling', () => {
    const engine = new SimulationEngine({ ticksPerSecond: 60, maxStepsPerUpdate: 5 });
    expect(engine.update(1000)).toBe(5);
    expect(engine.clock.totalMinutes).toBe(5);
    expect(engine.update(1000)).toBe(5);
    expect(engine.clock.totalMinutes).toBe(10);
  });

  it('ignores empty or invalid real-time deltas', () => {
    const engine = new SimulationEngine({ ticksPerSecond: 60 });
    expect(engine.update(0)).toBe(0);
    expect(engine.update(-100)).toBe(0);
    expect(engine.update(Number.NaN)).toBe(0);
    expect(engine.update(Number.POSITIVE_INFINITY)).toBe(0);
    expect(engine.clock.totalMinutes).toBe(0);
    expect(() => engine.step(1.5)).toThrow(RangeError);
    expect(() => engine.step(-1)).toThrow(RangeError);
  });

  it('detaches systems through the returned handle', () => {
    const engine = new SimulationEngine();
    const first = createRecordingSystem('first');
    const second = createRecordingSystem('second');
    const detachFirst = engine.attach(first);
    engine.attach(second);

    expect(first.detachCount).toBe(0);
    expect(detachFirst()).toBe(true);
    expect(first.detachCount).toBe(1);
    expect(detachFirst()).toBe(false);
    expect(engine.systemCount).toBe(1);
    expect(engine.getSystem('first')).toBeUndefined();

    engine.step(2);
    expect(first.updates).toHaveLength(0);
    expect(second.updates).toHaveLength(2);

    expect(engine.detach('second')).toBe(true);
    expect(engine.detach('second')).toBe(false);
    const reattach = engine.attach(first);
    expect(reattach).toBeTypeOf('function');
    expect(engine.getSystem('first')).toBe(first);
  });

  it('rejects invalid construction, duplicate names and malformed systems', () => {
    expect(() => new SimulationEngine({ minutesPerTick: 0 })).toThrow(RangeError);
    expect(() => new SimulationEngine({ minutesPerTick: 1.5 })).toThrow(RangeError);
    expect(() => new SimulationEngine({ ticksPerSecond: 0 })).toThrow(RangeError);
    expect(() => new SimulationEngine({ maxStepsPerUpdate: 0 })).toThrow(RangeError);
    expect(() => new SimulationEngine({ speed: 0 })).toThrow(RangeError);

    const engine = new SimulationEngine();
    engine.attach(createRecordingSystem('dup'));
    expect(() => engine.attach(createRecordingSystem('dup'))).toThrow(/dup/);
    expect(() => engine.attach({ name: 'broken' } as never)).toThrow(TypeError);
    expect(() => engine.setSpeed(-1)).toThrow(RangeError);
  });

  it('disposes cleanly and unsubscribes from the clock', () => {
    const clock = new SimClock({ startHour: 0 });
    const engine = new SimulationEngine({ clock });
    const system = createRecordingSystem('logger');
    engine.attach(system);
    expect(clock.hourStartListenerCount).toBe(1);
    expect(clock.hourEndListenerCount).toBe(1);

    engine.step(30);
    engine.dispose();

    expect(engine.state).toBe('disposed');
    expect(engine.systemCount).toBe(0);
    expect(engine.systems).toHaveLength(0);
    expect(system.detachCount).toBe(1);
    expect(clock.hourStartListenerCount).toBe(0);
    expect(clock.hourEndListenerCount).toBe(0);

    expect(engine.update(1000)).toBe(0);
    expect(engine.step(10)).toBe(0);
    clock.advanceMinutes(MINUTES_PER_HOUR);
    expect(system.hourStarts).toHaveLength(0);
    expect(() => engine.attach(createRecordingSystem('later'))).toThrow(/after dispose/);

    engine.pause();
    expect(engine.state).toBe('disposed');
    expect(engine.dispose()).toBeUndefined();
  });

  it('collects exact hourly economy snapshots for a full simulated day', () => {
    const fixture = createSimFixture({ startHour: 0, minutesPerTick: 1, seed: 7 });
    const economy = createEconomySystem('economy', fixture.world, { taxRate: 0.1, cityBudget: 1_000 });
    fixture.engine.attach(economy);

    fixture.advanceMinutes(MINUTES_PER_DAY);

    const snapshots: EconomySnapshot[] = economy.snapshots;
    expect(snapshots).toHaveLength(24);
    expect(snapshots[0]).toMatchObject({ day: 0, hour: 1, minute: 0, totalMinutes: MINUTES_PER_HOUR });
    expect(snapshots.at(-1)).toMatchObject({ day: 1, hour: 0, totalMinutes: MINUTES_PER_DAY });
    expect(snapshots[0]).toMatchObject({
      population: 1,
      companyCount: 1,
      employedCitizens: 1,
      employmentRate: 1,
      unemploymentRate: 0,
      averageWage: 14,
      totalRevenue: 640,
      totalCosts: 410,
      netProfit: 230,
      taxRate: 0.1,
      averageMood: 0.72,
    });
    expect(snapshots[0].cityBudget).toBeCloseTo(1_064, 10);
    expect(snapshots[0].sectorRevenue.hospitality).toBe(640);
    expect(snapshots[0].sectorCosts.hospitality).toBe(410);
    expect(snapshots.every((snapshot) => snapshot.totalMinutes % MINUTES_PER_HOUR === 0)).toBe(true);
  });
});
