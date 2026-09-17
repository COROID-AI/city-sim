import { describe, expect, it } from 'vitest';

import {
  DayNightLighting,
  LIGHTING_PHASE_BOUNDARIES,
  LIGHTING_PHASES,
  MAX_SHADOW_LENGTH_FACTOR,
  MIN_SHADOW_LENGTH_FACTOR,
  SUNRISE_HOUR,
  SUNSET_HOUR,
  colorToCss,
  colorToCssWithAlpha,
  dayPhaseForLightingPhase,
  luminanceOf,
  resolveLightingPhase,
  sampleLighting,
  skyLuminance,
} from '../../src/render/daynight';
import type { LightingPhase, LightingSample, RgbColor } from '../../src/render/daynight';
import { SimClock } from '../../src/sim/clock';
import { DAY_PHASES } from '../../src/sim/types';

/**
 * Unit suite for the day/night lighting model.
 *
 * The module is a pure function of sim time, so everything here is asserted
 * headlessly: the full 1440-minute sweep, the named phase grid, the continuity
 * of every interpolated channel across the whole day and the shadow model.
 */

/** Every `src/render` module loaded as source text, for the boundary checks. */
const renderSources = import.meta.glob('../../src/render/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const DOM_ONLY_GLOBALS =
  /\b(document|window|navigator|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|HTMLCanvasElement|HTMLDivElement|ImageData|OffscreenCanvas|CanvasRenderingContext2D|devicePixelRatio)\b/;

const MINUTES_PER_SIM_DAY = 1440;
const ONE_MINUTE = 1 / 60;

/**
 * Acceptance phase grid: night 0-5, dawn 5-7, morning 7-11, noon 11-14,
 * afternoon 14-18, dusk 18-20, night 20-24.
 */
const EXPECTED_PHASE_BY_HOUR: readonly LightingPhase[] = [
  'night', // 0
  'night', // 1
  'night', // 2
  'night', // 3
  'night', // 4
  'dawn', // 5
  'dawn', // 6
  'morning', // 7
  'morning', // 8
  'morning', // 9
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

/** Hours at which the named phase flips; used by the continuity assertions. */
const PHASE_HANDOVER_HOURS: readonly number[] = [5, 7, 11, 14, 18, 20];

/* ------------------------------------------------------------ inspection -- */

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

function isFiniteInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function isByteColor(color: RgbColor): boolean {
  return isByte(color[0]) && isByte(color[1]) && isByte(color[2]);
}

/** Describes every way one sample violates the lighting contract. */
function inspectSample(sample: LightingSample, label: string): string[] {
  const problems: string[] = [];
  const check = (condition: boolean, detail: string): void => {
    if (!condition) {
      problems.push(`${label}: ${detail}`);
    }
  };

  check(Number.isFinite(sample.hour) && sample.hour >= 0 && sample.hour < 24, `hour ${sample.hour}`);
  check(LIGHTING_PHASES.includes(sample.phase), `unknown phase ${sample.phase}`);
  check(isFiniteInRange(sample.sunElevation, 0, 1), `sunElevation ${sample.sunElevation}`);

  check(sample.sky.length >= 2, `sky stop count ${sample.sky.length}`);
  sample.sky.forEach((stop, index) => {
    check(
      Number.isFinite(stop.offset) && stop.offset >= 0 && stop.offset <= 1,
      `sky stop ${index} offset ${stop.offset}`,
    );
    check(isByteColor(stop.color), `sky stop ${index} colour ${stop.color.join(', ')}`);
    if (index > 0) {
      check(stop.offset > sample.sky[index - 1].offset, `sky offsets not ascending at ${index}`);
    }
  });

  check(isByteColor(sample.ambient.color), `ambient colour ${sample.ambient.color.join(', ')}`);
  check(
    isFiniteInRange(sample.ambient.strength, 0, 1),
    `ambient strength ${sample.ambient.strength}`,
  );

  const direction = sample.shadowDirection;
  check(
    Number.isFinite(direction.x) && Number.isFinite(direction.y),
    `shadow direction ${direction.x}, ${direction.y}`,
  );
  check(
    Math.abs(Math.hypot(direction.x, direction.y) - 1) < 1e-9,
    `shadow direction is not a unit vector (${Math.hypot(direction.x, direction.y)})`,
  );
  check(
    isFiniteInRange(
      sample.shadowLengthFactor,
      MIN_SHADOW_LENGTH_FACTOR - 1e-9,
      MAX_SHADOW_LENGTH_FACTOR + 1e-9,
    ),
    `shadowLengthFactor ${sample.shadowLengthFactor}`,
  );

  check(isFiniteInRange(sample.windowGlow, 0, 1), `windowGlow ${sample.windowGlow}`);
  check(
    isFiniteInRange(sample.streetlightIntensity, 0, 1),
    `streetlightIntensity ${sample.streetlightIntensity}`,
  );
  check(isFiniteInRange(sample.haze, 0, 1), `haze ${sample.haze}`);

  return problems;
}

function maxChannelDelta(from: RgbColor, to: RgbColor): number {
  return Math.max(
    Math.abs(to[0] - from[0]),
    Math.abs(to[1] - from[1]),
    Math.abs(to[2] - from[2]),
  );
}

interface SampleDelta {
  /** Largest sRGB channel step across sky and ambient colours. */
  readonly channel: number;
  readonly ambientStrength: number;
  readonly direction: number;
  readonly shadowLength: number;
  readonly sunElevation: number;
  readonly factor: number;
  readonly luminance: number;
}

/** Per-field change between two samples one sim-minute apart. */
function sampleDelta(previous: LightingSample, next: LightingSample): SampleDelta {
  let channel = maxChannelDelta(previous.ambient.color, next.ambient.color);
  previous.sky.forEach((stop, index) => {
    channel = Math.max(channel, maxChannelDelta(stop.color, next.sky[index].color));
  });

  return {
    channel,
    ambientStrength: Math.abs(next.ambient.strength - previous.ambient.strength),
    direction: Math.max(
      Math.abs(next.shadowDirection.x - previous.shadowDirection.x),
      Math.abs(next.shadowDirection.y - previous.shadowDirection.y),
    ),
    shadowLength: Math.abs(next.shadowLengthFactor - previous.shadowLengthFactor),
    sunElevation: Math.abs(next.sunElevation - previous.sunElevation),
    factor: Math.max(
      Math.abs(next.windowGlow - previous.windowGlow),
      Math.abs(next.streetlightIntensity - previous.streetlightIntensity),
      Math.abs(next.haze - previous.haze),
    ),
    luminance: Math.abs(skyLuminance(next) - skyLuminance(previous)),
  };
}

/** Largest per-minute change the day model is allowed to make anywhere. */
const CONTINUITY_LIMITS = {
  channel: 3,
  ambientStrength: 0.01,
  direction: 0.01,
  shadowLength: 0.02,
  sunElevation: 0.01,
  factor: 0.01,
  luminance: 3,
} as const;

function expectContinuous(previous: LightingSample, next: LightingSample, label: string): void {
  const delta = sampleDelta(previous, next);
  for (const key of Object.keys(CONTINUITY_LIMITS) as (keyof SampleDelta)[]) {
    expect(
      delta[key],
      `${label}: ${key} stepped by ${delta[key]} between consecutive sim-minutes`,
    ).toBeLessThanOrEqual(CONTINUITY_LIMITS[key]);
  }
}

/* --------------------------------------------------------------- phases -- */

describe('named phase grid', () => {
  it('maps every hour of the clock to the acceptance phase table', () => {
    for (let hour = 0; hour < EXPECTED_PHASE_BY_HOUR.length; hour += 1) {
      const expected = EXPECTED_PHASE_BY_HOUR[hour];
      expect(resolveLightingPhase(hour), `hour ${hour}`).toBe(expected);
      expect(sampleLighting(hour).phase, `sample at hour ${hour}`).toBe(expected);
    }
  });

  it('matches the example hours from the task brief', () => {
    expect(resolveLightingPhase(1)).toBe('night');
    expect(resolveLightingPhase(6)).toBe('dawn');
    expect(resolveLightingPhase(12)).toBe('noon');
    expect(resolveLightingPhase(19)).toBe('dusk');
    expect(resolveLightingPhase(0)).toBe('night');
    expect(resolveLightingPhase(23)).toBe('night');
  });

  it('flips exactly on the declared boundaries and nowhere else', () => {
    const boundaries = LIGHTING_PHASE_BOUNDARIES;
    expect(boundaries[0].sinceHour).toBe(0);
    expect(boundaries.length).toBeGreaterThanOrEqual(LIGHTING_PHASES.length);

    for (let index = 0; index < boundaries.length; index += 1) {
      const boundary = boundaries[index];
      expect(resolveLightingPhase(boundary.sinceHour)).toBe(boundary.phase);
      if (boundary.sinceHour > 0) {
        const previousPhase = boundaries[index - 1].phase;
        expect(resolveLightingPhase(boundary.sinceHour - ONE_MINUTE)).toBe(previousPhase);
        expect(previousPhase).not.toBe(boundary.phase);
      }
      if (index > 0) {
        expect(boundary.sinceHour).toBeGreaterThan(boundaries[index - 1].sinceHour);
      }
    }

    // Every handover hour is a declared boundary, and vice versa.
    const declared = boundaries.slice(1).map((boundary) => boundary.sinceHour);
    expect(declared).toEqual([...PHASE_HANDOVER_HOURS]);
  });

  it('covers all six phases across the day', () => {
    const seen = new Set(EXPECTED_PHASE_BY_HOUR);
    expect([...seen].sort()).toEqual([...LIGHTING_PHASES].sort());
  });

  it('wraps hours outside the day instead of failing', () => {
    expect(resolveLightingPhase(-1)).toBe('night');
    expect(resolveLightingPhase(29)).toBe('dawn');
    expect(sampleLighting(-3)).toEqual(sampleLighting(21));
    expect(sampleLighting(24)).toEqual(sampleLighting(0));
    expect(sampleLighting(-0.5).hour).toBeCloseTo(23.5, 12);
  });

  it('rejects non-finite sim times', () => {
    expect(() => sampleLighting(Number.NaN)).toThrow(RangeError);
    expect(() => sampleLighting(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => sampleLighting({ day: 0, hour: Number.NaN, minute: 0, totalMinutes: 0 })).toThrow(
      RangeError,
    );
    expect(() => resolveLightingPhase(Number.NaN)).toThrow(RangeError);
  });
});

/* ------------------------------------------------------- the 24h sweep -- */

describe('full 24-hour sweep', () => {
  it('yields finite, in-range samples at every sim-minute with a named phase', () => {
    const problems: string[] = [];
    const phases = new Set<LightingPhase>();

    for (let minute = 0; minute < MINUTES_PER_SIM_DAY; minute += 1) {
      const hour = minute / 60;
      const sample = sampleLighting(hour);
      phases.add(sample.phase);
      problems.push(...inspectSample(sample, `minute ${minute} (${hour.toFixed(3)}h)`));

      // Reflects the requested sim time exactly: no conversion is needed.
      expect(sample.hour).toBeCloseTo(hour, 12);
    }

    expect(problems).toEqual([]);
    expect([...phases].sort()).toEqual([...LIGHTING_PHASES].sort());
  });

  it('walks the six phases in cycle order, each exactly once', () => {
    const order: LightingPhase[] = [];
    let previous: LightingPhase | null = null;

    for (let minute = 0; minute < MINUTES_PER_SIM_DAY; minute += 1) {
      const { phase } = sampleLighting(minute / 60);
      if (phase !== previous) {
        order.push(phase);
        previous = phase;
      }
    }

    expect(order).toEqual(['night', 'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night']);
  });

  it('changes by less than one small step per sim-minute everywhere', () => {
    let worstRatio = 0;
    let worstLabel = 'no step taken';

    for (let minute = 1; minute < MINUTES_PER_SIM_DAY; minute += 1) {
      const previous = sampleLighting((minute - 1) / 60);
      const next = sampleLighting(minute / 60);
      const delta = sampleDelta(previous, next);
      for (const key of Object.keys(CONTINUITY_LIMITS) as (keyof SampleDelta)[]) {
        const ratio = delta[key] / CONTINUITY_LIMITS[key];
        if (ratio > worstRatio) {
          worstRatio = ratio;
          worstLabel = `${key} changed by ${delta[key]} at minute ${minute}`;
        }
      }
      expectContinuous(previous, next, `minute ${minute}`);
    }

    // The harshest single-minute step still stays inside the allowed budget.
    expect(worstRatio, `worst step: ${worstLabel}`).toBeLessThanOrEqual(1);
  });

  it('never pops at a phase handover', () => {
    for (const hour of PHASE_HANDOVER_HOURS) {
      const before = sampleLighting(hour - ONE_MINUTE);
      const atBoundary = sampleLighting(hour);
      const after = sampleLighting(hour + ONE_MINUTE);

      // The label flips on the boundary...
      expect(atBoundary.phase, `phase at ${hour}:00`).toBe(resolveLightingPhase(hour));
      expect(after.phase, `phase after ${hour}:00`).not.toBe(before.phase);

      // ...while the colours ramp through it like any other minute of the day.
      expectContinuous(before, atBoundary, `minute before handover at ${hour}:00`);
      expectContinuous(atBoundary, after, `minute after handover at ${hour}:00`);
    }
  });
});

/* ------------------------------------------------------------- pictures -- */

describe('visible day/night difference', () => {
  const night = sampleLighting(1);
  const noon = sampleLighting(12.5);
  const dusk = sampleLighting(19);

  it('is far brighter at noon than at deep night or dusk', () => {
    expect(skyLuminance(noon) - skyLuminance(night)).toBeGreaterThan(60);
    expect(skyLuminance(noon) - skyLuminance(dusk)).toBeGreaterThan(20);
    expect(skyLuminance(dusk) - skyLuminance(night)).toBeGreaterThan(40);
    expect(luminanceOf(noon.sky[1].color)).toBeGreaterThan(luminanceOf(night.sky[1].color) + 60);
  });

  it('paints a warm horizon at dawn and dusk, a cool one at noon', () => {
    const dawnHorizon = sampleLighting(6).sky[sampleLighting(6).sky.length - 1].color;
    const noonHorizon = noon.sky[noon.sky.length - 1].color;
    expect(dawnHorizon[0]).toBeGreaterThan(dawnHorizon[2]);
    expect(dusk.sky[dusk.sky.length - 1].color[0]).toBeGreaterThan(
      dusk.sky[dusk.sky.length - 1].color[2],
    );
    expect(noonHorizon[2]).toBeGreaterThan(noonHorizon[0]);
  });

  it('lights the city up at night and switches it off at noon', () => {
    expect(night.windowGlow).toBeGreaterThan(0.9);
    expect(night.streetlightIntensity).toBeGreaterThan(0.9);
    expect(noon.windowGlow).toBe(0);
    expect(noon.streetlightIntensity).toBe(0);
    expect(dusk.windowGlow).toBeGreaterThan(0.4);
    expect(dusk.windowGlow).toBeLessThan(night.windowGlow);
    expect(night.ambient.strength).toBeGreaterThan(noon.ambient.strength * 4);
  });
});

/* ---------------------------------------------------------------- shadow -- */

describe('shadow model', () => {
  it('sweeps the shadow from west through north to east', () => {
    const sunrise = sampleLighting(SUNRISE_HOUR);
    expect(sunrise.shadowDirection.x).toBeCloseTo(-1, 12);
    expect(sunrise.shadowDirection.y).toBeCloseTo(0, 12);

    const noon = sampleLighting((SUNRISE_HOUR + SUNSET_HOUR) / 2);
    expect(noon.shadowDirection.x).toBeCloseTo(0, 12);
    expect(noon.shadowDirection.y).toBeCloseTo(-1, 12);

    const sunset = sampleLighting(SUNSET_HOUR);
    expect(sunset.shadowDirection.x).toBeCloseTo(1, 12);
    expect(sunset.shadowDirection.y).toBeCloseTo(0, 12);
  });

  it('keeps shadows shortest at noon and longest at the horizon', () => {
    expect(sampleLighting(12).shadowLengthFactor).toBeCloseTo(MIN_SHADOW_LENGTH_FACTOR, 12);
    expect(sampleLighting(SUNRISE_HOUR).shadowLengthFactor).toBeCloseTo(
      MAX_SHADOW_LENGTH_FACTOR,
      12,
    );
    expect(sampleLighting(SUNSET_HOUR).shadowLengthFactor).toBeCloseTo(
      MAX_SHADOW_LENGTH_FACTOR,
      12,
    );
    expect(sampleLighting(0).shadowLengthFactor).toBeGreaterThan(
      sampleLighting(12).shadowLengthFactor,
    );
    expect(sampleLighting(0).shadowLengthFactor).toBeLessThan(
      sampleLighting(SUNRISE_HOUR).shadowLengthFactor,
    );
    expect(sampleLighting(12).sunElevation).toBeCloseTo(1, 12);
    expect(sampleLighting(0).sunElevation).toBe(0);
  });

  it('rotates the direction by well under a degree per sim-minute', () => {
    let previous = sampleLighting(0).shadowDirection;
    for (let minute = 1; minute <= MINUTES_PER_SIM_DAY; minute += 1) {
      const current = sampleLighting(minute / 60).shadowDirection;
      const dot = previous.x * current.x + previous.y * current.y;
      expect(dot, `minute ${minute}`).toBeGreaterThan(0.999);
      previous = current;
    }
  });
});

/* --------------------------------------------------------------- colours -- */

describe('colour helpers', () => {
  it('formats sRGB tuples for gradient stops and ambient veils', () => {
    expect(colorToCss([7, 10, 28])).toBe('rgb(7, 10, 28)');
    expect(colorToCssWithAlpha([255, 150, 96], 0.34)).toBe('rgba(255, 150, 96, 0.34)');
    expect(colorToCssWithAlpha([255, 150, 96], 4)).toBe('rgba(255, 150, 96, 1)');
  });

  it('measures brightness with Rec. 601 luminance', () => {
    expect(luminanceOf([0, 0, 0])).toBe(0);
    expect(luminanceOf([255, 255, 255])).toBeCloseTo(255, 9);
    expect(skyLuminance(sampleLighting(12))).toBeGreaterThan(skyLuminance(sampleLighting(1)));
  });
});

/* ----------------------------------------------------------------- purity -- */

describe('sampleLighting is a pure function of sim time', () => {
  it('returns equal but independent samples for equal input', () => {
    const first = sampleLighting(9.25);
    const second = sampleLighting(9.25);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.sky).not.toBe(first.sky);
  });

  it('accepts a clock reading exactly like a bare hour', () => {
    const clock = new SimClock({ startDay: 3, startHour: 9, startMinute: 15 });
    expect(sampleLighting(clock.time)).toEqual(sampleLighting(9.25));
  });

  it('does not touch its input', () => {
    const time = { day: 1, hour: 18, minute: 30, totalMinutes: 1_830 };
    const copy = { ...time };
    sampleLighting(time);
    expect(time).toEqual(copy);
  });
});

/* ------------------------------------------------------------ component -- */

describe('DayNightLighting', () => {
  it('holds the clock it was built with before any update', () => {
    const lighting = new DayNightLighting(new SimClock({ startHour: 6 }));
    expect(lighting.sample).toEqual(sampleLighting(6));
    expect(lighting.phase).toBe('dawn');
  });

  it('follows the clock on update() and caches between updates', () => {
    const clock = new SimClock({ startHour: 6 });
    const lighting = new DayNightLighting(clock);

    clock.advanceMinutes(90);
    expect(lighting.sample.hour).toBe(6); // still the construction sample
    expect(lighting.update()).toBe(lighting.sample);
    expect(lighting.sample.hour).toBe(7.5);
    expect(lighting.phase).toBe('morning');
    expect(lighting.sample).toEqual(sampleLighting(7.5));

    clock.advanceMinutes(240); // 11:30
    const noonish = lighting.update();
    expect(noonish.hour).toBe(11.5);
    expect(noonish.phase).toBe('noon');
    expect(noonish).toEqual(sampleLighting(clock.time));
  });

  it('reports the acceptance phase at every hour of a clock day', () => {
    const clock = new SimClock({ startHour: 0 });
    const lighting = new DayNightLighting(clock);
    const observed: LightingPhase[] = [];

    for (let hour = 0; hour < 24; hour += 1) {
      const sample = lighting.update();
      expect(sample.hour).toBe(hour);
      expect(sample).toEqual(sampleLighting(hour));
      observed.push(sample.phase);
      clock.advanceMinutes(60);
    }

    expect(observed).toEqual([...EXPECTED_PHASE_BY_HOUR]);
  });
});

/* ---------------------------------------------------------------- bridge -- */

describe('bridge to the HUD day phases', () => {
  it('maps the six lighting phases onto the coarse DayPhase contract', () => {
    expect(dayPhaseForLightingPhase('night')).toBe('night');
    expect(dayPhaseForLightingPhase('dawn')).toBe('dawn');
    expect(dayPhaseForLightingPhase('morning')).toBe('morning');
    expect(dayPhaseForLightingPhase('noon')).toBe('day');
    expect(dayPhaseForLightingPhase('afternoon')).toBe('day');
    expect(dayPhaseForLightingPhase('dusk')).toBe('evening');
    expect(new Set(LIGHTING_PHASES.map(dayPhaseForLightingPhase))).toEqual(new Set(DAY_PHASES));
  });
});

/* -------------------------------------------------------- module boundary -- */

describe('src/render/daynight.ts module boundary', () => {
  function daynightSource(): string {
    const path = Object.keys(renderSources).find((candidate) =>
      candidate.endsWith('/render/daynight.ts'),
    );
    expect(path, 'src/render/daynight.ts must be readable as source text').toBeTypeOf('string');
    return renderSources[path as string];
  }

  it('is pure data: it never references browser or canvas globals', () => {
    const match = DOM_ONLY_GLOBALS.exec(daynightSource());
    expect(
      match?.[1],
      `daynight.ts must stay DOM-free but references "${match?.[1]}"`,
    ).toBeUndefined();
  });

  it('imports only the sim clock and the domain contracts', () => {
    const specifiers = [...daynightSource().matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(specifiers.sort()).toEqual(['../sim/clock', '../sim/types']);
  });
});
