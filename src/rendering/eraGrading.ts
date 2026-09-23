/**
 * Chrono City — per-era colour grading.
 *
 * The authored "look" of each year: the tone curve, white balance, saturation,
 * film-stock character (sepia, grain, vignette), bloom energy and depth-of-field
 * bias that make 1945 read as a sepia newsreel and 2025 as a cool HDR glow.
 *
 * This module is deliberately **pure maths with no Three.js dependency** so the
 * exact same numbers can be used in three places:
 *
 *   create    → the authored `GRADING_LOOKS` table plus the curve/LUT builders.
 *   consume   → the post-processing pipeline bakes `bakeGradingLut()` into a
 *               256×1 RGBA `DataTexture` (one curve per channel) and feeds the
 *               remaining parameters into its grading / vignette / grain / sweep
 *               shader uniforms. HUD and inspection systems read `snapshot()`.
 *   integrate → `resolveGradeLook(from, to, progress)` is the era-blended look
 *               the pipeline applies while the `TimelineRuntime` tween runs.
 *
 * `applyLookToColor()` is the CPU reference implementation of the grading
 * shader (same order of operations, documented step by step) so unit tests can
 * assert what a given era *does* to a pixel without a GPU.
 *
 * Colours are authored as sRGB hex and converted to linear working values with
 * `hexToLinearRgb()`, because the composer grades the linear HDR frame *before*
 * tone mapping.
 *
 * Lifecycle:
 *   create    → `gradeCurve()` / the look table / `EraGrading` aggregate.
 *   consume   → `getGradingLook()`, `bakeGradingLut()`, `applyLookToColor()`,
 *               `resolveSweepState()`.
 *   integrate → `blendGradeLooks()` driven by `TimelineRuntime` progress.
 */

import { ERA_IDS, clamp01, type EraId } from '../core/eraContracts';

export const ERA_GRADING_VERSION = 1;

/** Width of the per-channel grading LUT texture (1D, RGBA, height 1). */
export const GRADING_LUT_SIZE = 256;

/* ------------------------------------------------------------------------- *
 * Small numeric helpers
 * ------------------------------------------------------------------------- */

/** A working-space (linear) colour triple used for tinting. */
export interface LinearRGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Rec. 709 luminance weights, shared by the shader and the CPU reference. */
export const LUMA_WEIGHTS: readonly [number, number, number] = Object.freeze([
  0.2126, 0.7152, 0.0722,
]);

/** Linear mid-grey: the pivot contrast works around and the LUT is neutral at. */
export const CONTRAST_PIVOT = 0.18;

function saturate(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** Hermite smoothstep matching the GLSL builtin. */
export function smoothStepValue(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Exact sRGB transfer function (IEC 61966-2-1). */
function srgbChannelToLinear(channel: number): number {
  const c = saturate(channel);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearChannelToSrgb(channel: number): number {
  const c = saturate(channel);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** Converts an authored sRGB hex colour into linear working values. */
export function hexToLinearRgb(hex: number): LinearRGB {
  const value = hex >>> 0;
  return Object.freeze({
    r: srgbChannelToLinear(((value >> 16) & 0xff) / 255),
    g: srgbChannelToLinear(((value >> 8) & 0xff) / 255),
    b: srgbChannelToLinear((value & 0xff) / 255),
  });
}

/** Converts linear working values back into a packed sRGB hex colour. */
export function linearRgbToHex(color: LinearRGB): number {
  const r = Math.round(linearChannelToSrgb(color.r) * 255);
  const g = Math.round(linearChannelToSrgb(color.g) * 255);
  const b = Math.round(linearChannelToSrgb(color.b) * 255);
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

function lerpRgb(from: LinearRGB, to: LinearRGB, t: number): LinearRGB {
  return Object.freeze({
    r: lerp(from.r, to.r, t),
    g: lerp(from.g, to.g, t),
    b: lerp(from.b, to.b, t),
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  // Typed arrays cannot be frozen once they hold elements; their contents are
  // never mutated after authoring, so leaving them alone is safe.
  if (ArrayBuffer.isView(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

/* ------------------------------------------------------------------------- *
 * Curves
 * ------------------------------------------------------------------------- */

/**
 * A monotone cubic curve, authored as `[input, output]` control points in
 * `[0, 1]` and compiled once into Hermite knots so evaluating it (256 times per
 * bake, twice while a tween runs) never allocates.
 */
export interface GradeCurve {
  readonly name: string;
  /** Authored control points, kept for inspection, HUD copy and tests. */
  readonly points: readonly (readonly [number, number])[];
  /** Compiled knot positions (`x`). */
  readonly knots: Float64Array;
  /** Compiled knot values (`y`). */
  readonly values: Float64Array;
  /** Compiled monotone tangents (`dy/dx`) at each knot. */
  readonly tangents: Float64Array;
}

/**
 * Compiles control points into a monotone cubic Hermite curve using the
 * Fritsch–Carlson tangent limiter: the curve passes through every point and
 * never overshoots, so `0 → 0` and `1 → 1` stay true and no highlight detail is
 * invented out of a flat shoulder.
 */
export function gradeCurve(
  name: string,
  points: readonly (readonly [number, number])[],
): GradeCurve {
  if (points.length < 2) {
    throw new RangeError(`Grade curve "${name}" needs at least two control points.`);
  }

  const count = points.length;
  const knots = new Float64Array(count);
  const values = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const [x, y] = points[index] as readonly [number, number];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError(`Grade curve "${name}" has a non-finite control point.`);
    }
    if (index > 0 && x <= (knots[index - 1] as number)) {
      throw new RangeError(`Grade curve "${name}" control points must ascend in x.`);
    }
    knots[index] = x;
    values[index] = y;
  }

  const secants = new Float64Array(count - 1);
  for (let index = 0; index < count - 1; index += 1) {
    secants[index] =
      ((values[index + 1] as number) - (values[index] as number)) /
      ((knots[index + 1] as number) - (knots[index] as number));
  }

  const tangents = new Float64Array(count);
  tangents[0] = secants[0] as number;
  tangents[count - 1] = secants[count - 2] as number;
  for (let index = 1; index < count - 1; index += 1) {
    const previous = secants[index - 1] as number;
    const next = secants[index] as number;
    tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }

  // Fritsch–Carlson limiter: keeps the interpolant monotone between knots.
  for (let index = 0; index < count - 1; index += 1) {
    const secant = secants[index] as number;
    if (secant === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const alpha = (tangents[index] as number) / secant;
    const beta = (tangents[index + 1] as number) / secant;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * alpha * secant;
      tangents[index + 1] = scale * beta * secant;
    }
  }

  return deepFreeze({
    name,
    points: points.map(([x, y]) => [x, y] as const),
    knots,
    values,
    tangents,
  });
}

/**
 * Evaluates a compiled curve. Inputs outside the authored range clamp to the
 * end values, so an overbright HDR pixel never wraps the curve.
 * Allocation-free: call it from the LUT bake, which runs inside a frame.
 */
export function evaluateGradeCurve(curve: GradeCurve, x: number): number {
  const { knots, values, tangents } = curve;
  const count = knots.length;
  if (!Number.isFinite(x)) return values[0] as number;

  const first = knots[0] as number;
  const last = knots[count - 1] as number;
  if (x <= first) return values[0] as number;
  if (x >= last) return values[count - 1] as number;

  let index = 0;
  while (index < count - 2 && x >= (knots[index + 1] as number)) index += 1;

  const x0 = knots[index] as number;
  const x1 = knots[index + 1] as number;
  const span = x1 - x0;
  const t = span <= 0 ? 0 : (x - x0) / span;
  const t2 = t * t;
  const t3 = t2 * t;

  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return (
    h00 * (values[index] as number) +
    h10 * span * (tangents[index] as number) +
    h01 * (values[index + 1] as number) +
    h11 * span * (tangents[index + 1] as number)
  );
}

/** The four curves one era applies: one master tone curve plus per-channel shaping. */
export interface GradeCurveSet {
  /** Tone curve applied to every channel (lift / S-curve / shoulder). */
  readonly master: GradeCurve;
  readonly red: GradeCurve;
  readonly green: GradeCurve;
  readonly blue: GradeCurve;
}

/**
 * Evaluates the composite curve of one channel: the channel shaper first, the
 * master tone curve second — exactly the order `bakeGradingLut()` bakes and the
 * shader later samples.
 */
export function evaluateChannelCurve(curves: GradeCurveSet, channel: 'r' | 'g' | 'b', x: number): number {
  const shaper = channel === 'r' ? curves.red : channel === 'g' ? curves.green : curves.blue;
  return evaluateGradeCurve(curves.master, evaluateGradeCurve(shaper, x));
}

/* ------------------------------------------------------------------------- *
 * The authored look
 * ------------------------------------------------------------------------- */

export interface GradeBloom {
  readonly strength: number;
  readonly radius: number;
  /** Luminance above which pixels start to bloom; 1985 lowers it for neon. */
  readonly threshold: number;
}

export interface GradeDepthOfField {
  /** Multiplier on the camera→focus-target distance. */
  readonly focusBias: number;
  readonly aperture: number;
  readonly maxBlur: number;
}

export interface GradeSweep {
  /** sRGB hex the sweep band and flash glow with. */
  readonly color: number;
  /** Band brightness at the peak of the transition. */
  readonly strength: number;
  /** Full-frame flash layered under the band. */
  readonly flash: number;
}

/** Everything one era's frame is graded with. */
export interface EraGradeLook {
  readonly id: EraId;
  readonly year: number;
  readonly label: string;
  readonly description: string;
  /** Exposure bias applied by the grader (see `PostFxPipeline`). */
  readonly exposure: number;
  /** Contrast around `CONTRAST_PIVOT`; `1` is neutral. */
  readonly contrast: number;
  /** Saturation; `1` is neutral. */
  readonly saturation: number;
  /** `-1` cool … `1` warm. */
  readonly temperature: number;
  /** `-1` green … `1` magenta. */
  readonly tint: number;
  /** Amount of the sepia mix (`0` neutral, `1` fully sepia). */
  readonly sepia: number;
  /** How strongly `shadowTint` is added into the darkest tones. */
  readonly shadowLift: number;
  readonly shadowTint: LinearRGB;
  readonly highlightTint: LinearRGB;
  /** How strongly `highlightTint` is added into the brightest tones. */
  readonly highlightRoll: number;
  /** Weight of the environment's fog read as aerial haze (`0` disables it). */
  readonly fogHaze: number;
  /** Film grain amplitude in linear frame units. */
  readonly grain: number;
  /** Grain cell size in device pixels — larger means coarser stock. */
  readonly grainScale: number;
  /** Vignette darkening strength, `0…1`. */
  readonly vignette: number;
  /** Vignette falloff exponent: higher keeps the centre cleaner longer. */
  readonly vignettePower: number;
  readonly bloom: GradeBloom;
  readonly dof: GradeDepthOfField;
  readonly sweep: GradeSweep;
  readonly curves: GradeCurveSet;
  /** Short working note carried over from the era descriptors. */
  readonly notes: string;
}

/* ------------------------------------------------------------------------- *
 * Authored table
 * ------------------------------------------------------------------------- */

/** 1945 — sepia newsreel stock: warm, desaturated, grainy, heavily vignetted. */
const LOOK_1945: EraGradeLook = {
  id: '1945',
  year: 1945,
  label: 'Sepia Newsreel',
  description: 'Warm sepia with crushed blues, coarse grain and a slow, heavy vignette.',
  exposure: 0.98,
  contrast: 1.06,
  saturation: 0.76,
  temperature: 0.22,
  tint: 0.05,
  sepia: 0.62,
  shadowLift: 0.34,
  shadowTint: hexToLinearRgb(0x3a2a18),
  highlightTint: hexToLinearRgb(0xffe9c4),
  highlightRoll: 0.18,
  fogHaze: 0.35,
  grain: 0.085,
  grainScale: 1.7,
  vignette: 0.44,
  vignettePower: 2.6,
  bloom: { strength: 0.16, radius: 0.4, threshold: 0.86 },
  dof: { focusBias: 0.96, aperture: 0.026, maxBlur: 0.009 },
  sweep: { color: 0xffd9a0, strength: 0.55, flash: 0.3 },
  curves: {
    master: gradeCurve('1945.master', [
      [0, 0.035],
      [0.25, 0.2],
      [0.5, 0.5],
      [0.75, 0.79],
      [1, 0.97],
    ]),
    red: gradeCurve('1945.red', [
      [0, 0.04],
      [0.5, 0.55],
      [1, 1],
    ]),
    green: gradeCurve('1945.green', [
      [0, 0.03],
      [0.5, 0.47],
      [1, 0.96],
    ]),
    blue: gradeCurve('1945.blue', [
      [0, 0.02],
      [0.5, 0.4],
      [1, 0.92],
    ]),
  },
  notes: 'Silver-halide contrast, warm highlights and almost no saturated blue.',
};

/** 1965 — warm Technicolor: rich, saturated, gently lifted colour. */
const LOOK_1965: EraGradeLook = {
  id: '1965',
  year: 1965,
  label: 'Warm Technicolor',
  description: 'Saturated warm Technicolor with creamy highlights and fine stock grain.',
  exposure: 1.04,
  contrast: 1.14,
  saturation: 1.24,
  temperature: 0.3,
  tint: -0.05,
  sepia: 0.08,
  shadowLift: 0.22,
  shadowTint: hexToLinearRgb(0x2d2130),
  highlightTint: hexToLinearRgb(0xfff0cf),
  highlightRoll: 0.12,
  fogHaze: 0.22,
  grain: 0.045,
  grainScale: 1.3,
  vignette: 0.3,
  vignettePower: 2.4,
  bloom: { strength: 0.3, radius: 0.45, threshold: 0.8 },
  dof: { focusBias: 0.99, aperture: 0.018, maxBlur: 0.007 },
  sweep: { color: 0xfff2d0, strength: 0.5, flash: 0.26 },
  curves: {
    master: gradeCurve('1965.master', [
      [0, 0.025],
      [0.25, 0.17],
      [0.5, 0.52],
      [0.75, 0.84],
      [1, 1],
    ]),
    red: gradeCurve('1965.red', [
      [0, 0.03],
      [0.5, 0.55],
      [1, 1],
    ]),
    green: gradeCurve('1965.green', [
      [0, 0.02],
      [0.5, 0.5],
      [1, 1],
    ]),
    blue: gradeCurve('1965.blue', [
      [0, 0.04],
      [0.5, 0.46],
      [1, 0.98],
    ]),
  },
  notes: 'Three-strip warmth: reds and ambers bloom, greens stay true, blues pull back.',
};

/** 1985 — neon night: lifted blacks, magenta flare and full neon haze bloom. */
const LOOK_1985: EraGradeLook = {
  id: '1985',
  year: 1985,
  label: 'Neon Night',
  description: 'Lifted blacks, magenta flare and heavy neon bloom over wet asphalt.',
  exposure: 1.07,
  contrast: 1.12,
  saturation: 1.2,
  temperature: 0.05,
  tint: 0.12,
  sepia: 0.02,
  shadowLift: 0.3,
  shadowTint: hexToLinearRgb(0x2a0f3a),
  highlightTint: hexToLinearRgb(0xffd7f2),
  highlightRoll: 0.22,
  fogHaze: 0.18,
  grain: 0.05,
  grainScale: 1.5,
  vignette: 0.38,
  vignettePower: 2.5,
  bloom: { strength: 1.15, radius: 0.72, threshold: 0.62 },
  dof: { focusBias: 1.0, aperture: 0.022, maxBlur: 0.008 },
  sweep: { color: 0xff5ce1, strength: 0.7, flash: 0.42 },
  curves: {
    master: gradeCurve('1985.master', [
      [0, 0.07],
      [0.25, 0.22],
      [0.5, 0.54],
      [0.75, 0.85],
      [1, 1],
    ]),
    red: gradeCurve('1985.red', [
      [0, 0.05],
      [0.5, 0.53],
      [1, 1],
    ]),
    green: gradeCurve('1985.green', [
      [0, 0.04],
      [0.5, 0.48],
      [1, 0.99],
    ]),
    blue: gradeCurve('1985.blue', [
      [0, 0.06],
      [0.5, 0.56],
      [1, 1],
    ]),
  },
  notes: 'VHS-era blacks are never black; every light source halates.',
};

/** 2005 — clean modern: near-neutral digital, the most restrained grade. */
const LOOK_2005: EraGradeLook = {
  id: '2005',
  year: 2005,
  label: 'Clean Modern',
  description: 'Neutral modern digital grade with minimal grain and a gentle vignette.',
  exposure: 1.0,
  contrast: 1.0,
  saturation: 1.02,
  temperature: 0.0,
  tint: 0.0,
  sepia: 0,
  shadowLift: 0.06,
  shadowTint: hexToLinearRgb(0x0c1016),
  highlightTint: hexToLinearRgb(0xffffff),
  highlightRoll: 0.05,
  fogHaze: 0.12,
  grain: 0.012,
  grainScale: 1.0,
  vignette: 0.18,
  vignettePower: 2.8,
  bloom: { strength: 0.35, radius: 0.4, threshold: 0.9 },
  dof: { focusBias: 1.02, aperture: 0.01, maxBlur: 0.004 },
  sweep: { color: 0xffffff, strength: 0.42, flash: 0.2 },
  curves: {
    master: gradeCurve('2005.master', [
      [0, 0],
      [0.25, 0.24],
      [0.5, 0.5],
      [0.75, 0.76],
      [1, 0.99],
    ]),
    red: gradeCurve('2005.red', [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ]),
    green: gradeCurve('2005.green', [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ]),
    blue: gradeCurve('2005.blue', [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ]),
  },
  notes: 'Reference grade: the frame is only cleaned up, not stylised.',
};

/** 2025 — cool HDR glow: lifted mids, cool highlights and bright media bloom. */
const LOOK_2025: EraGradeLook = {
  id: '2025',
  year: 2025,
  label: 'Cool HDR Glow',
  description: 'Cool high-dynamic-range glow with lifted mids, clean highlights and media bloom.',
  exposure: 1.12,
  contrast: 1.04,
  saturation: 1.08,
  temperature: -0.28,
  tint: 0.06,
  sepia: 0,
  shadowLift: 0.14,
  shadowTint: hexToLinearRgb(0x0d1a33),
  highlightTint: hexToLinearRgb(0xd9ecff),
  highlightRoll: 0.2,
  fogHaze: 0.15,
  grain: 0.022,
  grainScale: 1.1,
  vignette: 0.3,
  vignettePower: 2.7,
  bloom: { strength: 0.85, radius: 0.6, threshold: 0.7 },
  dof: { focusBias: 1.04, aperture: 0.014, maxBlur: 0.005 },
  sweep: { color: 0x8fe3ff, strength: 0.6, flash: 0.34 },
  curves: {
    master: gradeCurve('2025.master', [
      [0, 0],
      [0.25, 0.29],
      [0.5, 0.57],
      [0.75, 0.83],
      [1, 1],
    ]),
    red: gradeCurve('2025.red', [
      [0, 0],
      [0.5, 0.49],
      [1, 0.99],
    ]),
    green: gradeCurve('2025.green', [
      [0, 0.01],
      [0.5, 0.51],
      [1, 1],
    ]),
    blue: gradeCurve('2025.blue', [
      [0, 0.02],
      [0.5, 0.55],
      [1, 1],
    ]),
  },
  notes: 'Cool, bright and clean: lifted mid-tones read as emissive media surfaces.',
};

/** The five authored looks, one per era. Frozen: treat as shared constants. */
export const GRADING_LOOKS: Readonly<Record<EraId, EraGradeLook>> = deepFreeze({
  '1945': LOOK_1945,
  '1965': LOOK_1965,
  '1985': LOOK_1985,
  '2005': LOOK_2005,
  '2025': LOOK_2025,
});

/** Every era the grading table covers, in timeline order. */
export const GRADING_ERAS: readonly EraId[] = ERA_IDS;

/** Placeholder look used to satisfy the record type above before freezing. */
const DEFAULT_LOOK: EraGradeLook = LOOK_2025;

/** The look of one era (falls back to the latest era for unknown input). */
export function getGradingLook(era: EraId | string | null | undefined): EraGradeLook {
  if (era === null || era === undefined) return DEFAULT_LOOK;
  return GRADING_LOOKS[era as EraId] ?? DEFAULT_LOOK;
}

/** The look of one era, or `null` when the id is unknown. */
export function tryGetGradingLook(value: unknown): EraGradeLook | null {
  if (typeof value !== 'string') return null;
  return GRADING_LOOKS[value as EraId] ?? null;
}

/* ------------------------------------------------------------------------- *
 * Era blending
 * ------------------------------------------------------------------------- */

/**
 * Interpolates two looks. Continuous parameters (curves excepted) blend
 * linearly; the character colours blend in linear space; the four curves snap to
 * whichever era is nearer, because a curve only carries meaning as a whole.
 *
 * During a transition the pipeline does not grade with a blended curve *object*
 * at all — it blends the baked LUT texel-by-texel (`bakeBlendedGradingLut`),
 * which is what makes the look slide between eras instead of popping.
 */
export function blendGradeLooks(from: EraGradeLook, to: EraGradeLook, progress: number): EraGradeLook {
  const t = clamp01(progress);
  if (from === to || t >= 1) return to;
  if (t <= 0) return from;
  const nearer = t < 0.5 ? from : to;

  return {
    id: nearer.id,
    year: Math.round(lerp(from.year, to.year, t)),
    label: nearer.label,
    description: nearer.description,
    exposure: lerp(from.exposure, to.exposure, t),
    contrast: lerp(from.contrast, to.contrast, t),
    saturation: lerp(from.saturation, to.saturation, t),
    temperature: lerp(from.temperature, to.temperature, t),
    tint: lerp(from.tint, to.tint, t),
    sepia: lerp(from.sepia, to.sepia, t),
    shadowLift: lerp(from.shadowLift, to.shadowLift, t),
    shadowTint: lerpRgb(from.shadowTint, to.shadowTint, t),
    highlightTint: lerpRgb(from.highlightTint, to.highlightTint, t),
    highlightRoll: lerp(from.highlightRoll, to.highlightRoll, t),
    fogHaze: lerp(from.fogHaze, to.fogHaze, t),
    grain: lerp(from.grain, to.grain, t),
    grainScale: lerp(from.grainScale, to.grainScale, t),
    vignette: lerp(from.vignette, to.vignette, t),
    vignettePower: lerp(from.vignettePower, to.vignettePower, t),
    bloom: {
      strength: lerp(from.bloom.strength, to.bloom.strength, t),
      radius: lerp(from.bloom.radius, to.bloom.radius, t),
      threshold: lerp(from.bloom.threshold, to.bloom.threshold, t),
    },
    dof: {
      focusBias: lerp(from.dof.focusBias, to.dof.focusBias, t),
      aperture: lerp(from.dof.aperture, to.dof.aperture, t),
      maxBlur: lerp(from.dof.maxBlur, to.dof.maxBlur, t),
    },
    sweep: {
      color: t < 0.5 ? from.sweep.color : to.sweep.color,
      strength: lerp(from.sweep.strength, to.sweep.strength, t),
      flash: lerp(from.sweep.flash, to.sweep.flash, t),
    },
    curves: nearer.curves,
    notes: nearer.notes,
  };
}

/**
 * Resolves the look for a point between two eras, mirroring the
 * `resolveEraBlend()` convention used by the other era systems: `progress <= 0`
 * returns the `from` look, `progress >= 1` the `to` look.
 */
export function resolveGradeLook(from: EraId, to: EraId, progress: number): EraGradeLook {
  const source = getGradingLook(from);
  if (from === to) return source;
  const t = clamp01(progress);
  if (t <= 0) return source;
  const target = getGradingLook(to);
  if (t >= 1) return target;
  return blendGradeLooks(source, target, t);
}

/* ------------------------------------------------------------------------- *
 * CPU reference implementation of the grading shader
 * ------------------------------------------------------------------------- */

/**
 * The environment's fog / exposure context, read (never written) from
 * `EnvironmentApi.gradeState()`. Structurally typed so this module stays free of
 * Three.js and can be unit tested on its own.
 */
export interface AtmosphereGrade {
  readonly fogColor: LinearRGB;
  readonly fogDensity: number;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly fogMode: 'linear' | 'exponential';
}

/**
 * Normalises an era's fog settings into "how much haze does this frame breathe"
 * in `[0, 1]`: exponential fog reads straight off its density, linear fog off
 * how tightly the visible range is closed in. Allocation-free, so the render
 * loop can call it whenever the environment context changes.
 */
export function atmosphereWeightFrom(
  fogDensity: number,
  fogNear: number,
  fogFar: number,
  fogMode: 'linear' | 'exponential',
): number {
  const density = saturate(fogDensity * 24);
  if (fogMode === 'exponential') return saturate(density * 1.6);
  const span = saturate(1 - Math.max(0, fogFar - fogNear) / 600);
  return saturate(span * 0.9 + density * 0.4);
}

/** Convenience form of `atmosphereWeightFrom()` for an `AtmosphereGrade`. */
export function atmosphereWeight(atmosphere: AtmosphereGrade | null | undefined): number {
  if (!atmosphere) return 0;
  return atmosphereWeightFrom(
    atmosphere.fogDensity,
    atmosphere.fogNear,
    atmosphere.fogFar,
    atmosphere.fogMode,
  );
}

/**
 * CPU reference for the grading shader — same steps, same order:
 *
 *   1. exposure              6. highlight roll toward `highlightTint`
 *   2. white balance gains   7. sepia mix
 *   3. contrast at the pivot 8. aerial haze toward the environment fog colour
 *   4. saturation            9. per-channel LUT curve (highlight energy kept)
 *   5. shadow lift toward `shadowTint`
 *
 * Tests use it to assert what each era does to a pixel; the pipeline mirrors it
 * in GLSL.
 */
export function applyLookToColor(
  color: LinearRGB,
  look: EraGradeLook,
  atmosphere?: AtmosphereGrade | null,
): LinearRGB {
  let r = Math.max(0, color.r);
  let g = Math.max(0, color.g);
  let b = Math.max(0, color.b);

  // 1. exposure bias of the era.
  r *= look.exposure;
  g *= look.exposure;
  b *= look.exposure;

  // 2. white balance: temperature is red↔blue, tint is green↔magenta.
  const temperature = Math.max(-1, Math.min(1, look.temperature));
  const tint = Math.max(-1, Math.min(1, look.tint));
  r *= 1 + 0.18 * temperature + 0.04 * tint;
  g *= 1 - 0.08 * tint;
  b *= 1 - 0.18 * temperature + 0.04 * tint;

  // 3. contrast around linear mid-grey.
  const contrast = Math.max(0.01, look.contrast);
  const pivot = CONTRAST_PIVOT;
  r = pivot * (r / pivot) ** contrast;
  g = pivot * (g / pivot) ** contrast;
  b = pivot * (b / pivot) ** contrast;

  // 4. saturation.
  const luma = r * LUMA_WEIGHTS[0] + g * LUMA_WEIGHTS[1] + b * LUMA_WEIGHTS[2];
  r = luma + (r - luma) * look.saturation;
  g = luma + (g - luma) * look.saturation;
  b = luma + (b - luma) * look.saturation;

  // 5. shadow lift, 6. highlight roll.
  const shadowWeight = 1 - smoothStepValue(0.02, 0.45, luma);
  const highlightWeight = smoothStepValue(0.5, 1.6, luma);
  const lift = look.shadowLift * shadowWeight;
  const roll = look.highlightRoll * highlightWeight;
  r += look.shadowTint.r * lift + look.highlightTint.r * roll;
  g += look.shadowTint.g * lift + look.highlightTint.g * roll;
  b += look.shadowTint.b * lift + look.highlightTint.b * roll;

  // 7. sepia mix (luma-driven, so it tints without flattening the image).
  const sepia = saturate(look.sepia);
  if (sepia > 0) {
    const warm = Math.max(0, r * LUMA_WEIGHTS[0] + g * LUMA_WEIGHTS[1] + b * LUMA_WEIGHTS[2]);
    r = lerp(r, warm * 1.07, sepia);
    g = lerp(g, warm * 0.94, sepia);
    b = lerp(b, warm * 0.74, sepia);
  }

  // 8. aerial haze: mid-tones drift toward the environment's fog colour.
  const haze = saturate(look.fogHaze * atmosphereWeight(atmosphere));
  if (haze > 0 && atmosphere) {
    const depth = 0.35 + 0.65 * saturate(luma);
    r = lerp(r, atmosphere.fogColor.r * depth, haze);
    g = lerp(g, atmosphere.fogColor.g * depth, haze);
    b = lerp(b, atmosphere.fogColor.b * depth, haze);
  }

  // 9. per-channel curve; energy above 1.0 rides over the curve untouched so
  //    bloom keeps its halation into the tone mapper.
  const lutR = evaluateChannelCurve(look.curves, 'r', Math.min(1, r));
  const lutG = evaluateChannelCurve(look.curves, 'g', Math.min(1, g));
  const lutB = evaluateChannelCurve(look.curves, 'b', Math.min(1, b));
  r = lutR + Math.max(0, r - 1);
  g = lutG + Math.max(0, g - 1);
  b = lutB + Math.max(0, b - 1);

  return { r: Math.max(0, r), g: Math.max(0, g), b: Math.max(0, b) };
}

/* ------------------------------------------------------------------------- *
 * LUT baking
 * ------------------------------------------------------------------------- */

/** Allocates the RGBA payload of the per-era grading LUT texture. */
export function createGradingLutData(size: number = GRADING_LUT_SIZE): Uint8Array {
  if (!Number.isFinite(size) || size < 2) {
    throw new RangeError(`Grading LUT size must be at least 2, received ${String(size)}.`);
  }
  return new Uint8Array(Math.round(size) * 4);
}

/**
 * Bakes one look into an existing LUT payload (no allocation, safe inside a
 * frame). Each texel holds the composite curve value of every channel at that
 * input level, so the shader only needs three texture fetches.
 */
export function bakeGradingLut(
  look: EraGradeLook,
  data: Uint8Array,
  size: number = data.length / 4,
): Uint8Array {
  const packed = size * 4;
  if (data.length < packed) {
    throw new RangeError('Grading LUT payload is smaller than the requested size.');
  }
  const last = size - 1;
  for (let index = 0; index < size; index += 1) {
    const x = last <= 0 ? 0 : index / last;
    const offset = index * 4;
    data[offset] = Math.round(saturate(evaluateChannelCurve(look.curves, 'r', x)) * 255);
    data[offset + 1] = Math.round(saturate(evaluateChannelCurve(look.curves, 'g', x)) * 255);
    data[offset + 2] = Math.round(saturate(evaluateChannelCurve(look.curves, 'b', x)) * 255);
    data[offset + 3] = 255;
  }
  return data;
}

/**
 * Bakes a *blend* of two looks into an existing LUT payload: each texel is the
 * linear interpolation of the two baked curves. This is how the grading sweep
 * slides between eras without a hard cut.
 */
export function bakeBlendedGradingLut(
  from: EraGradeLook,
  to: EraGradeLook,
  progress: number,
  data: Uint8Array,
  size: number = data.length / 4,
): Uint8Array {
  const t = clamp01(progress);
  if (from === to || t >= 1) return bakeGradingLut(to, data, size);
  if (t <= 0) return bakeGradingLut(from, data, size);

  const packed = size * 4;
  if (data.length < packed) {
    throw new RangeError('Grading LUT payload is smaller than the requested size.');
  }
  const last = size - 1;
  for (let index = 0; index < size; index += 1) {
    const x = last <= 0 ? 0 : index / last;
    const offset = index * 4;
    data[offset] = Math.round(
      saturate(lerp(evaluateChannelCurve(from.curves, 'r', x), evaluateChannelCurve(to.curves, 'r', x), t)) * 255,
    );
    data[offset + 1] = Math.round(
      saturate(lerp(evaluateChannelCurve(from.curves, 'g', x), evaluateChannelCurve(to.curves, 'g', x), t)) * 255,
    );
    data[offset + 2] = Math.round(
      saturate(lerp(evaluateChannelCurve(from.curves, 'b', x), evaluateChannelCurve(to.curves, 'b', x), t)) * 255,
    );
    data[offset + 3] = 255;
  }
  return data;
}

/** Samples a baked LUT at one input level (used for HUD readouts and tests). */
export function sampleGradingLut(data: Uint8Array, x: number): LinearRGB {
  const size = data.length / 4;
  const index = Math.min(size - 1, Math.max(0, Math.round(saturate(x) * (size - 1))));
  const offset = index * 4;
  return {
    r: (data[offset] as number) / 255,
    g: (data[offset + 1] as number) / 255,
    b: (data[offset + 2] as number) / 255,
  };
}

/* ------------------------------------------------------------------------- *
 * Transition sweep
 * ------------------------------------------------------------------------- */

/** Resolved sweep uniforms for one frame. */
export interface SweepState {
  /** Band / flash amplitude in `[0, 1]`; exactly `0` when the tween is done. */
  readonly intensity: number;
  /** Full-frame flash contribution in `[0, 1]`. */
  readonly flash: number;
  /** Horizontal position of the sweeping edge, `0…1`. */
  readonly travel: number;
  /** sRGB hex the band glows with. */
  readonly color: number;
  /** `1` when travelling towards newer eras, `-1` towards older ones. */
  readonly direction: number;
}

/** Options accepted by `resolveSweepState()`. */
export interface SweepOptions {
  /** `true` while the `TimelineRuntime` tween is running. */
  readonly active?: boolean;
  /** Transition direction: `1` forward in time, `-1` backwards. */
  readonly direction?: number;
}

/** Writable form of `SweepState`, so the render loop can reuse one object. */
export interface MutableSweepState {
  intensity: number;
  flash: number;
  travel: number;
  color: number;
  direction: number;
}

/** Envelope of the sweep: `0` at both ends of the tween, `1` at its midpoint. */
export function sweepIntensity(progress: number): number {
  return Math.sin(Math.PI * clamp01(progress));
}

/**
 * Resolves the grading sweep from the timeline tween progress into a caller
 * supplied object. The envelope is tied to `progress` (not to wall-clock time),
 * so the sweep is always in sync with the era tween however long it is
 * configured to run. Allocation-free: the composer calls this every frame.
 */
export function writeSweepState(
  progress: number,
  look: EraGradeLook,
  options: SweepOptions,
  target: MutableSweepState,
): MutableSweepState {
  const active = options.active ?? true;
  const direction = (options.direction ?? 1) < 0 ? -1 : 1;
  const t = clamp01(progress);
  const intensity = !active || t >= 1 || t <= 0 ? 0 : sweepIntensity(t);

  target.intensity = intensity;
  target.flash = intensity * intensity * look.sweep.flash;
  target.travel = direction > 0 ? t : 1 - t;
  target.color = look.sweep.color;
  target.direction = direction;
  return target;
}

/**
 * Frozen snapshot of the sweep state (for observation, not for the frame loop).
 */
export function resolveSweepState(
  progress: number,
  look: EraGradeLook,
  options: SweepOptions = {},
): SweepState {
  return Object.freeze(
    writeSweepState(progress, look, options, {
      intensity: 0,
      flash: 0,
      travel: 0,
      color: look.sweep.color,
      direction: 1,
    }),
  );
}

/* ------------------------------------------------------------------------- *
 * Fingerprints
 * ------------------------------------------------------------------------- */

/** Probe levels the fingerprint samples the graded grey ramp at. */
export const FINGERPRINT_STOPS: readonly number[] = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

/**
 * A compact numeric signature of a look: the graded response of a grey ramp
 * (three channels × five stops) followed by the character parameters that are
 * not part of the curve. Two eras whose fingerprints are close look alike —
 * which is exactly what the tests assert they are not.
 */
export function gradeFingerprint(look: EraGradeLook): readonly number[] {
  const values: number[] = [];
  for (const stop of FINGERPRINT_STOPS) {
    const graded = applyLookToColor({ r: stop, g: stop, b: stop }, look);
    values.push(graded.r, graded.g, graded.b);
  }
  values.push(
    look.saturation,
    look.contrast,
    look.temperature,
    look.sepia,
    look.grain,
    look.vignette,
    look.bloom.strength,
    look.bloom.threshold,
    look.dof.maxBlur,
    look.sweep.strength,
    look.sweep.flash,
  );
  return Object.freeze(values);
}

/** Euclidean distance between two fingerprints. */
export function gradeFingerprintDistance(left: EraGradeLook, right: EraGradeLook): number {
  const a = gradeFingerprint(left);
  const b = gradeFingerprint(right);
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    const delta = (a[index] as number) - (b[index] as number);
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

/* ------------------------------------------------------------------------- *
 * Aggregate
 * ------------------------------------------------------------------------- */

/**
 * Convenience aggregate, mirroring `EraContracts` / `EraDescriptors` so a
 * consumer can reach the whole grading surface from one import.
 */
export const EraGrading = Object.freeze({
  version: ERA_GRADING_VERSION,
  lutSize: GRADING_LUT_SIZE,
  eras: GRADING_ERAS,
  looks: GRADING_LOOKS,
  get: getGradingLook,
  tryGet: tryGetGradingLook,
  blend: blendGradeLooks,
  resolve: resolveGradeLook,
  apply: applyLookToColor,
  bakeLut: bakeGradingLut,
  bakeBlendedLut: bakeBlendedGradingLut,
  sampleLut: sampleGradingLut,
  sweep: resolveSweepState,
  writeSweep: writeSweepState,
  sweepEnvelope: sweepIntensity,
  atmosphereWeight,
  atmosphereWeightFrom,
  fingerprint: gradeFingerprint,
  fingerprintDistance: gradeFingerprintDistance,
});
