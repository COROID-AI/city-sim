import { describe, expect, it } from 'vitest';

import {
  DayNightLighting,
  LIGHTING_PHASES,
  dayPhaseForLightingPhase,
  sampleLighting,
  skyLuminance,
} from '../../src/render/daynight';
import type { LightingPhase, LightingSample } from '../../src/render/daynight';
import { MINUTES_PER_DAY, resolveDayPhase } from '../../src/sim/clock';
import { DAY_PHASES } from '../../src/sim/types';
import { SIM_DAY_MINUTES, createSimFixture } from '../helpers/sim-fixtures';

/**
 * Composition suite: the lighting model driven by the shared fixture engine.
 *
 * `tests/helpers/sim-fixtures.ts` builds a real `SimClock` + `SimulationEngine`
 * pair, so this file proves the integration claim the plan makes — lighting is
 * a pure view of sim time, sampled straight from the engine's clock across a
 * full simulated day, with no conversion layer between renderer and HUD.
 */

/**
 * Phase the lighting model must report at each hour boundary of the day.
 * This restates the acceptance grid independently of the module's own table.
 */
const EXPECTED_PHASE_BY_HOUR: readonly LightingPhase[] = [
  'night', // 00
  'night', // 01
  'night', // 02
  'night', // 03
  'night', // 04
  'dawn', // 05
  'dawn', // 06
  'morning', // 07
  'morning', // 08
  'morning', // 09
  'morning', // 10
  'noon', // 11
  'noon', // 12
  'noon', // 13
  'afternoon', // 14
  'afternoon', // 15
  'afternoon', // 16
  'afternoon', // 17
  'dusk', // 18
  'dusk', // 19
  'night', // 20
  'night', // 21
  'night', // 22
  'night', // 23
];

/**
 * Hours where the finer six-way lighting table hands over an hour away from the
 * clock's coarser five-way `DayPhase` table. Both tables describe the same day
 * on the same clock; everywhere else they must agree exactly.
 */
const COARSE_LABEL_HANDOVER_HOURS: readonly number[] = [7, 11, 17, 20];

describe('lighting sampled from the fixture engine clock', () => {
  it('returns the acceptance phase at every hour boundary of a simulated day', () => {
    const fixture = createSimFixture({ startHour: 0, minutesPerTick: 1 });
    const lighting = new DayNightLighting(fixture.clock);
    const observed: LightingPhase[] = [];

    for (let hour = 0; hour < 24; hour += 1) {
      const sample = lighting.update();

      // The sample is a view of the engine's clock, not of a private counter.
      expect(sample.hour, `hour boundary ${hour}`).toBe(hour);
      expect(sample).toEqual(sampleLighting(fixture.clock.time));
      expect(sample.phase, `phase at ${hour}:00`).toBe(EXPECTED_PHASE_BY_HOUR[hour]);
      observed.push(sample.phase);

      fixture.advanceMinutes(60);
      expect(fixture.clock.hourOfDay).toBe((hour + 1) % 24);
    }

    expect(observed).toEqual([...EXPECTED_PHASE_BY_HOUR]);
    fixture.dispose();
  });

  it('stays a faithful view of the clock for all 1440 minutes', () => {
    // Start in the evening so the sweep crosses midnight inside the run.
    const fixture = createSimFixture({ startHour: 21, minutesPerTick: 1 });
    const lighting = new DayNightLighting(fixture.clock);
    const phases = new Set<LightingPhase>();

    for (let minute = 0; minute < SIM_DAY_MINUTES; minute += 1) {
      fixture.advanceMinutes(1);

      const clockHour = fixture.clock.hourOfDay + fixture.clock.minuteOfHour / 60;
      const sample = lighting.update();

      expect(sample.hour, `minute ${minute}`).toBeCloseTo(clockHour, 12);
      expect(sample.phase).toBe(sampleLighting(clockHour).phase);
      expect(sample).toEqual(sampleLighting(fixture.clock.time));
      phases.add(sample.phase);
    }

    // One simulated day exercises the whole palette.
    expect([...phases].sort()).toEqual([...LIGHTING_PHASES].sort());
    expect(fixture.clock.totalMinutes).toBe(21 * 60 + MINUTES_PER_DAY);
    fixture.dispose();
  });

  it('walks the six phases in cycle order as the engine ticks', () => {
    const fixture = createSimFixture({ startHour: 0, minutesPerTick: 1 });
    const lighting = new DayNightLighting(fixture.clock);
    const order: LightingPhase[] = [];
    let previous: LightingPhase | null = null;

    for (let minute = 0; minute < SIM_DAY_MINUTES; minute += 1) {
      const { phase } = lighting.update();
      if (phase !== previous) {
        order.push(phase);
        previous = phase;
      }
      fixture.advanceMinutes(1);
    }

    expect(order).toEqual(['night', 'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night']);
    fixture.dispose();
  });

  it('labels the same instant consistently with the clock phase table', () => {
    const mismatches: number[] = [];

    for (let hour = 0; hour < 24; hour += 1) {
      const lightingSample = sampleLighting(hour);
      const coarseLabel = dayPhaseForLightingPhase(lightingSample.phase);
      if (coarseLabel !== resolveDayPhase(hour)) {
        mismatches.push(hour);
      }
    }

    expect(mismatches).toEqual([...COARSE_LABEL_HANDOVER_HOURS]);
    expect(new Set(LIGHTING_PHASES.map(dayPhaseForLightingPhase))).toEqual(new Set(DAY_PHASES));
  });

  it('makes the cycle visually provable on the engine clock', () => {
    const fixture = createSimFixture({ startHour: 1, minutesPerTick: 1 });
    const lighting = new DayNightLighting(fixture.clock);

    const night: LightingSample = lighting.update();
    expect(night.phase).toBe('night');

    fixture.advanceMinutes(11 * 60 + 30); // 12:30
    const noon = lighting.update();
    expect(noon.phase).toBe('noon');

    fixture.advanceMinutes(6 * 60 + 30); // 19:00
    const dusk = lighting.update();
    expect(dusk.phase).toBe('dusk');
    expect(fixture.clock.formatTime()).toBe('19:00');

    // Direction and length of shadows, sky brightness and city lights all move
    // with the clock, which is what the renderer draws.
    expect(skyLuminance(noon)).toBeGreaterThan(skyLuminance(night) + 60);
    expect(skyLuminance(noon)).toBeGreaterThan(skyLuminance(dusk) + 20);
    expect(skyLuminance(dusk)).toBeGreaterThan(skyLuminance(night) + 40);
    expect(night.windowGlow).toBeGreaterThan(noon.windowGlow);
    expect(night.streetlightIntensity).toBeGreaterThan(noon.streetlightIntensity);
    expect(noon.shadowLengthFactor).toBeLessThan(dusk.shadowLengthFactor);
    expect(dusk.shadowDirection.x).toBeGreaterThan(0.9);
    // At 12:30 the light source is past its zenith: the shadow sits north and
    // has barely any east-west offset left.
    expect(noon.shadowDirection.y).toBeLessThan(-0.9);
    expect(Math.abs(noon.shadowDirection.x)).toBeLessThan(0.2);

    fixture.dispose();
  });

  it('keeps every intermediate minute of the day finite while the engine runs', () => {
    const fixture = createSimFixture({ startHour: 0, minutesPerTick: 5 });
    const lighting = new DayNightLighting(fixture.clock);
    const problems: string[] = [];

    for (let step = 0; step < MINUTES_PER_DAY / 5; step += 1) {
      const sample = lighting.update();
      const numbers = [
        sample.hour,
        sample.sunElevation,
        sample.ambient.strength,
        sample.shadowDirection.x,
        sample.shadowDirection.y,
        sample.shadowLengthFactor,
        sample.windowGlow,
        sample.streetlightIntensity,
        sample.haze,
        ...sample.sky.flatMap((stop) => [stop.offset, ...stop.color]),
      ];
      if (numbers.some((value) => !Number.isFinite(value))) {
        problems.push(`step ${step} at ${fixture.clock.formatTime()}`);
      }
      fixture.advanceMinutes(5);
    }

    expect(problems).toEqual([]);
    fixture.dispose();
  });
});
