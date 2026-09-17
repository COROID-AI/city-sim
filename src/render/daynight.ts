/**
 * Day/night lighting model: the city's sky palette and light rig as pure data.
 *
 * The renderer asks one question every frame — "what does the city look like at
 * this sim time?" — and this module answers it with a single
 * {@link LightingSample}: a vertical sky gradient, an ambient colour veil,
 * shadow direction and length, how strongly lit windows and street lamps glow,
 * and how hazy the air is. Everything is derived from the hour of day alone, so
 * the module is a pure function of sim time: no drawing calls, no host globals
 * and no engine import. That keeps the model headlessly assertable, and lets
 * the renderer, the HUD and any later overlay share one palette.
 *
 * ## Six named phases
 *
 * {@link LIGHTING_PHASES} names six slices of the day — `night`, `dawn`,
 * `morning`, `noon`, `afternoon`, `dusk` — on the hour grid the HUD already
 * shows (see {@link LIGHTING_PHASE_BOUNDARIES}): night 0-5, dawn 5-7, morning
 * 7-11, noon 11-14, afternoon 14-18, dusk 18-20, then night again until
 * midnight. {@link dayPhaseForLightingPhase} maps them onto the coarser
 * `DayPhase` contract from `src/sim/types.ts`, so the overlay label and the
 * rendered palette always describe the same instant without either consumer
 * converting clock readings.
 *
 * ## Continuous interpolation
 *
 * The named phase is a label, never a switch: the palette itself is linearly
 * interpolated between a handful of keyframes that wrap through midnight, and
 * the sun/moon model is a smooth function of the hour. Two samples one
 * sim-minute apart therefore differ by a fraction of an sRGB step everywhere in
 * the day — the colour ramps continuously while the label flips at dawn and
 * dusk, so no phase boundary can pop.
 *
 * ## Shadow model
 *
 * The sun travels a half turn, east at {@link SUNRISE_HOUR} to west at
 * {@link SUNSET_HOUR}: its horizontal anchor is `(cos a, sin a)` in world space
 * (`x` grows east, `y` grows south) with `a = (hour - SUNRISE_HOUR) / 12 * PI`,
 * and {@link LightingSample.shadowDirection} points the opposite way — shadows
 * fall west in the morning, north at noon and east in the evening. Shadow
 * length grows as the light source drops towards the horizon; at night the
 * model treats the moon as the same source mirrored across the horizon, which
 * keeps both direction and length continuous through midnight.
 */

import type { SimTime } from '../sim/clock';
import type { DayPhase, Vec2 } from '../sim/types';

/* --------------------------------------------------------------- palette -- */

/** One sRGB colour, split into 0..255 integer channels. */
export type RgbColor = readonly [red: number, green: number, blue: number];

/**
 * One stop of the vertical sky gradient, ready for
 * `createLinearGradient(...)` + `addColorStop(offset, colorToCss(color))`.
 * Offset 0 is the zenith (top of the sky), offset 1 the horizon behind the city.
 */
export interface SkyStop {
  readonly offset: number;
  readonly color: RgbColor;
}

/**
 * Colour veil the renderer composites over the finished frame, either with
 * `globalCompositeOperation` or as a translucent fill.
 */
export interface AmbientTint {
  readonly color: RgbColor;
  /** 0 = the veil is invisible, 1 = it fully replaces the frame colour. */
  readonly strength: number;
}

/* ---------------------------------------------------------------- phases -- */

/** Named slice of the 24 sim-hour day the lighting palette is tuned for. */
export type LightingPhase = 'night' | 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk';

/** Every lighting phase in the order it occurs across one day, from midnight. */
export const LIGHTING_PHASES: readonly LightingPhase[] = [
  'night',
  'dawn',
  'morning',
  'noon',
  'afternoon',
  'dusk',
];

/** One named phase bucket; `phase` applies from `sinceHour` until the next one. */
export interface LightingPhaseBoundary {
  readonly sinceHour: number;
  readonly phase: LightingPhase;
}

/**
 * Phase boundaries on the hour grid, evaluated top to bottom; the last match
 * wins. The six buckets are:
 *
 * | hours      | phase       |
 * | ---------- | ----------- |
 * | 00:00-05:00 | `night`    |
 * | 05:00-07:00 | `dawn`     |
 * | 07:00-11:00 | `morning`  |
 * | 11:00-14:00 | `noon`     |
 * | 14:00-18:00 | `afternoon` |
 * | 18:00-20:00 | `dusk`     |
 * | 20:00-24:00 | `night`    |
 */
export const LIGHTING_PHASE_BOUNDARIES: readonly LightingPhaseBoundary[] = [
  { sinceHour: 0, phase: 'night' },
  { sinceHour: 5, phase: 'dawn' },
  { sinceHour: 7, phase: 'morning' },
  { sinceHour: 11, phase: 'noon' },
  { sinceHour: 14, phase: 'afternoon' },
  { sinceHour: 18, phase: 'dusk' },
  { sinceHour: 20, phase: 'night' },
];

/* ---------------------------------------------------------------- sample -- */

/**
 * Everything the renderer needs to paint one instant of the day.
 *
 * The sample is plain data: sRGB channels for gradients and tint colours,
 * scalar 0..1 factors for glow/streetlights/haze, and a unit shadow vector in
 * world (tile) space. Nothing here references the clock, the canvas or the
 * world, so a sample can be cached, compared or handed to a testing double.
 */
export interface LightingSample {
  /** Fractional hour-of-day in `[0, 24)` the sample was taken at. */
  readonly hour: number;
  /** Named phase bucket the hour falls into. */
  readonly phase: LightingPhase;
  /** 0 while the sun is below the horizon, 1 when it is at its zenith. */
  readonly sunElevation: number;
  /** Vertical sky gradient: zenith first (offset 0), horizon last (offset 1). */
  readonly sky: readonly SkyStop[];
  /** Colour veil composited over the whole frame. */
  readonly ambient: AmbientTint;
  /** Unit vector, world space, that shadows are cast towards. */
  readonly shadowDirection: Vec2;
  /** Shadow length multiplier: short at noon, long at dawn, dusk and night. */
  readonly shadowLengthFactor: number;
  /** Glow from lit windows: 0 = all dark, 1 = the whole city lit. */
  readonly windowGlow: number;
  /** Street lamp intensity: 0 = lamps off, 1 = fully lit. */
  readonly streetlightIntensity: number;
  /** Weather haze: 0 = crystal clear air, 1 = thick fog. */
  readonly haze: number;
}

/** Anything that can report the current sim time, i.e. every `SimClock`. */
export interface LightingClock {
  readonly time: SimTime;
}

/* ----------------------------------------------------------- sun / moon -- */

/** Hour the sun rises in the east, and the start of its half turn south. */
export const SUNRISE_HOUR = 6;
/** Hour the sun sets in the west, and the end of its half turn south. */
export const SUNSET_HOUR = 18;
/** Multiplier for shadow length when the light source is on the horizon. */
export const MAX_SHADOW_LENGTH_FACTOR = 1.6;
/** Multiplier for shadow length when the light source is at its zenith. */
export const MIN_SHADOW_LENGTH_FACTOR = 0.35;
/** How much of the night's moonlight shortens shadows relative to the sun. */
export const MOON_ELEVATION_WEIGHT = 0.75;

const HOURS_PER_DAY = 24;
const SUNRISE_HOURS_TO_SUNSET = SUNSET_HOUR - SUNRISE_HOUR;

/* ------------------------------------------------------------- keyframes -- */

/**
 * Colour + mood of one anchor of the day. Missing hours are interpolated
 * between the surrounding anchors; the first anchor (hour 0) and the last
 * (hour 24) share the deep-night palette so the cycle wraps through midnight
 * without a seam.
 */
interface LightingKeyframe {
  /** Anchor hour in `[0, 24]`, ascending across the table. */
  readonly hour: number;
  readonly sky: readonly SkyStop[];
  readonly ambient: AmbientTint;
  readonly windowGlow: number;
  readonly streetlightIntensity: number;
  readonly haze: number;
}

const NIGHT_SKY: readonly SkyStop[] = [
  { offset: 0, color: [7, 10, 28] },
  { offset: 0.6, color: [12, 18, 46] },
  { offset: 1, color: [26, 34, 74] },
];

const DAWN_SKY: readonly SkyStop[] = [
  { offset: 0, color: [58, 66, 132] },
  { offset: 0.6, color: [176, 116, 150] },
  { offset: 1, color: [252, 154, 92] },
];

const MORNING_SKY: readonly SkyStop[] = [
  { offset: 0, color: [82, 138, 224] },
  { offset: 0.6, color: [138, 186, 240] },
  { offset: 1, color: [214, 232, 244] },
];

const NOON_SKY: readonly SkyStop[] = [
  { offset: 0, color: [56, 132, 238] },
  { offset: 0.6, color: [110, 178, 246] },
  { offset: 1, color: [190, 226, 250] },
];

const AFTERNOON_SKY: readonly SkyStop[] = [
  { offset: 0, color: [74, 132, 222] },
  { offset: 0.6, color: [150, 178, 226] },
  { offset: 1, color: [238, 208, 162] },
];

const DUSK_SKY: readonly SkyStop[] = [
  { offset: 0, color: [46, 52, 110] },
  { offset: 0.6, color: [178, 100, 122] },
  { offset: 1, color: [250, 140, 78] },
];

/** Deep-night mood: the city lit by its own windows and street lamps. */
const NIGHT_MOOD = {
  ambient: { color: [24, 36, 72], strength: 0.6 },
  windowGlow: 1,
  streetlightIntensity: 1,
  haze: 0.16,
} as const;

/**
 * The anchors of the day: a deep-night plateau (0-4), sunrise, morning, midday,
 * afternoon, sunset, then the night plateau again (21.5-24). The first and last
 * entries pin the same palette at both ends of the table, so the cycle wraps
 * through midnight without a seam.
 */
const LIGHTING_KEYFRAMES: readonly LightingKeyframe[] = [
  { hour: 0, sky: NIGHT_SKY, ...NIGHT_MOOD },
  { hour: 4, sky: NIGHT_SKY, ...NIGHT_MOOD },
  {
    hour: 6,
    sky: DAWN_SKY,
    ambient: { color: [255, 172, 118], strength: 0.3 },
    windowGlow: 0.55,
    streetlightIntensity: 0.45,
    haze: 0.32,
  },
  {
    hour: 8,
    sky: MORNING_SKY,
    ambient: { color: [255, 242, 214], strength: 0.14 },
    windowGlow: 0,
    streetlightIntensity: 0,
    haze: 0.2,
  },
  {
    hour: 12.5,
    sky: NOON_SKY,
    ambient: { color: [255, 250, 236], strength: 0.08 },
    windowGlow: 0,
    streetlightIntensity: 0,
    haze: 0.12,
  },
  {
    hour: 16.5,
    sky: AFTERNOON_SKY,
    ambient: { color: [255, 224, 178], strength: 0.16 },
    windowGlow: 0.06,
    streetlightIntensity: 0,
    haze: 0.18,
  },
  {
    hour: 19,
    sky: DUSK_SKY,
    ambient: { color: [255, 150, 96], strength: 0.34 },
    windowGlow: 0.62,
    streetlightIntensity: 0.55,
    haze: 0.3,
  },
  { hour: 21.5, sky: NIGHT_SKY, ...NIGHT_MOOD },
  { hour: 24, sky: NIGHT_SKY, ...NIGHT_MOOD },
];

/* ------------------------------------------------------------- sampling -- */

/** Resolves the named phase for an hour-of-day (fractional values allowed). */
export function resolveLightingPhase(hour: number): LightingPhase {
  if (!Number.isFinite(hour)) {
    throw new RangeError(`resolveLightingPhase(hour) expects a finite hour, received ${hour}`);
  }
  const hourOfDay = normalizeHour(hour);
  let phase: LightingPhase = LIGHTING_PHASE_BOUNDARIES[0].phase;
  for (const entry of LIGHTING_PHASE_BOUNDARIES) {
    if (hourOfDay >= entry.sinceHour) {
      phase = entry.phase;
    }
  }
  return phase;
}

/**
 * Coarse `DayPhase` label the clock and the HUD contract use for a lighting
 * phase: `noon` and `afternoon` both live inside the clock's `day`, and `dusk`
 * inside its `evening`. The two tables agree everywhere except four handover
 * hours (7, 11, 17, 20) where the finer lighting table changes one hour away
 * from the coarse one, so both consumers label an instant consistently.
 */
export function dayPhaseForLightingPhase(phase: LightingPhase): DayPhase {
  switch (phase) {
    case 'night':
      return 'night';
    case 'dawn':
      return 'dawn';
    case 'morning':
      return 'morning';
    case 'noon':
      return 'day';
    case 'afternoon':
      return 'day';
    case 'dusk':
      return 'evening';
  }
}

/** Fractional hour-of-day of a clock reading, `hour + minute / 60`. */
function hourOfTime(time: SimTime): number {
  return time.hour + time.minute / 60;
}

/**
 * Samples the day/night lighting for a sim time.
 *
 * Accepts either a clock reading (`SimClock.time`, so renderer and HUD can pass
 * what they already hold) or a bare fractional hour-of-day; both are pure
 * inputs, and the same input always yields an equal sample. Hours outside
 * `[0, 24)` wrap around the day, so `-1` and `23` describe the same sky.
 * Throws a `RangeError` for non-finite input rather than emitting `NaN` colours.
 */
export function sampleLighting(input: number | SimTime): LightingSample {
  const rawHour = typeof input === 'number' ? input : hourOfTime(input);
  if (!Number.isFinite(rawHour)) {
    throw new RangeError(`sampleLighting(input) expects a finite sim time, received ${rawHour}`);
  }
  const hour = normalizeHour(rawHour);
  const { from, to, blend } = resolveKeyframeSegment(hour);

  const angle = ((hour - SUNRISE_HOUR) / SUNRISE_HOURS_TO_SUNSET) * Math.PI;
  const sunElevation = clamp01(Math.sin(angle));
  const moonElevation = clamp01(-Math.sin(angle));
  const lightElevation = Math.max(sunElevation, moonElevation * MOON_ELEVATION_WEIGHT);

  return {
    hour,
    phase: resolveLightingPhase(hour),
    sunElevation,
    sky: interpolateSky(from.sky, to.sky, blend),
    ambient: {
      color: interpolateColor(from.ambient.color, to.ambient.color, blend),
      strength: clamp01(lerp(from.ambient.strength, to.ambient.strength, blend)),
    },
    // The sun's horizontal anchor is (cos a, sin a); shadows point away from it.
    // The vector is unit length by construction (cos^2 + sin^2 = 1).
    shadowDirection: { x: -Math.cos(angle), y: -Math.sin(angle) },
    shadowLengthFactor: lerp(MAX_SHADOW_LENGTH_FACTOR, MIN_SHADOW_LENGTH_FACTOR, lightElevation),
    windowGlow: clamp01(lerp(from.windowGlow, to.windowGlow, blend)),
    streetlightIntensity: clamp01(
      lerp(from.streetlightIntensity, to.streetlightIntensity, blend),
    ),
    haze: clamp01(lerp(from.haze, to.haze, blend)),
  };
}

/* ---------------------------------------------------------------- colours -- */

/** Rec. 601 luminance of an sRGB colour, 0..255; handy for brightness checks. */
export function luminanceOf(color: RgbColor): number {
  return 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
}

/** Mean luminance of a sample's sky stops: one number for "how bright is it". */
export function skyLuminance(sample: LightingSample): number {
  if (sample.sky.length === 0) {
    return 0;
  }
  let total = 0;
  for (const stop of sample.sky) {
    total += luminanceOf(stop.color);
  }
  return total / sample.sky.length;
}

/** `rgb(r, g, b)` CSS colour for gradient stops and solid fills. */
export function colorToCss(color: RgbColor): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

/** `rgba(r, g, b, alpha)` CSS colour, the form an ambient veil needs. */
export function colorToCssWithAlpha(color: RgbColor, alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${clamp01(alpha)})`;
}

/* ------------------------------------------------------------- component -- */

/**
 * Cached lighting view of one clock, for the render loop.
 *
 * Instantiate once with the sim clock, then call {@link DayNightLighting.update}
 * after each engine step; the returned sample is the one the renderer draws for
 * that sim time. Recomputing only on `update()` keeps the per-frame cost a
 * single lookup and hands the renderer a stable object it can compare by
 * reference when it wants to know whether the palette changed.
 */
export class DayNightLighting {
  private readonly clock: LightingClock;
  private currentSample: LightingSample;

  constructor(clock: LightingClock) {
    this.clock = clock;
    this.currentSample = sampleLighting(clock.time);
  }

  /** Sample for the last `update()`, i.e. the palette currently on screen. */
  get sample(): LightingSample {
    return this.currentSample;
  }

  /** Named phase of the last `update()`. */
  get phase(): LightingPhase {
    return this.currentSample.phase;
  }

  /** Re-reads the clock and returns the fresh sample. */
  update(): LightingSample {
    this.currentSample = sampleLighting(this.clock.time);
    return this.currentSample;
  }
}

/* --------------------------------------------------------------- helpers -- */

/** Wraps any finite hour into `[0, 24)`. */
function normalizeHour(hour: number): number {
  return ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
}

/** Locates the keyframe pair surrounding an already normalised hour. */
function resolveKeyframeSegment(hour: number): {
  from: LightingKeyframe;
  to: LightingKeyframe;
  blend: number;
} {
  let index = 0;
  for (let candidate = 0; candidate < LIGHTING_KEYFRAMES.length - 1; candidate += 1) {
    if (LIGHTING_KEYFRAMES[candidate].hour <= hour) {
      index = candidate;
    }
  }
  const from = LIGHTING_KEYFRAMES[index];
  const to = LIGHTING_KEYFRAMES[index + 1];
  const span = to.hour - from.hour;
  return { from, to, blend: span <= 0 ? 0 : (hour - from.hour) / span };
}

function interpolateSky(
  from: readonly SkyStop[],
  to: readonly SkyStop[],
  blend: number,
): SkyStop[] {
  return from.map((stop, index) => ({
    offset: lerp(stop.offset, to[index].offset, blend),
    color: interpolateColor(stop.color, to[index].color, blend),
  }));
}

function interpolateColor(from: RgbColor, to: RgbColor, blend: number): RgbColor {
  return [
    interpolateChannel(from[0], to[0], blend),
    interpolateChannel(from[1], to[1], blend),
    interpolateChannel(from[2], to[2], blend),
  ];
}

function interpolateChannel(from: number, to: number, blend: number): number {
  return Math.min(255, Math.max(0, Math.round(lerp(from, to, blend))));
}

function lerp(from: number, to: number, blend: number): number {
  return from + (to - from) * blend;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
