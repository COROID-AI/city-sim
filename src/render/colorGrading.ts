/**
 * Chrono City cinematic colour grading.
 *
 * Pure grade math for the screen-space pipeline in `./postfx`: contrast,
 * saturation, lift/gamma/gain, white balance (temperature/tint), vignette,
 * grain and the bloom trim all live here as plain numbers.
 *
 * Why every value is *derived* instead of tabulated: a grade is a documented
 * function of the era descriptor (`EraConfig` — its palette, environment and
 * advertising domains), so the screen-space look can never drift away from the
 * block it grades. The 1945 stop resolves warm, hazy and desaturated; the 2025
 * stop resolves cool, crisp and high-key — both purely from era data, never a
 * duplicated table of magic numbers.
 *
 * Blending reuses the era contract's own `clampBlend` / `resolveEraWeights`
 * semantics, so the grade morphs on exactly the same blend value as scene
 * geometry, lighting and audio.
 *
 * The module deliberately has no three.js import: everything here is
 * deterministic arithmetic over the frozen era contract, which keeps it
 * unit-testable without a GL context.
 */

import {
  ERA_IDS,
  clampBlend,
  getEraConfig,
  resolveEraWeights,
  type EraConfig,
  type EraId,
} from "../era/eraTypes";

/* -------------------------------------------------------------------------- */
/* Grade shape                                                                */
/* -------------------------------------------------------------------------- */

/** Per-era colour grade. `1` / `0` are the neutral values unless noted. */
export interface ColorGrade {
  /** Renderer tone-mapping exposure applied by the output pass. */
  readonly exposure: number;
  /** Linear contrast multiplier around a 0.18 mid-grey pivot. */
  readonly contrast: number;
  /** Colour saturation multiplier; `1` is untouched, `< 1` desaturates. */
  readonly saturation: number;
  /** `-1` fully cool … `+1` fully warm; realised through {@link gain}. */
  readonly temperature: number;
  /** `-1` green … `+1` magenta; realised through {@link gain}. */
  readonly tint: number;
  /** Additive shadow offset (R, G, B); hazy eras lift the blacks. */
  readonly lift: readonly [number, number, number];
  /** Midtone power (R, G, B); `> 1` brightens midtones. */
  readonly gamma: readonly [number, number, number];
  /** Highlight multiplier (R, G, B); carries the white balance. */
  readonly gain: readonly [number, number, number];
  /** Bloom mip-chain strength scaled by the era's signage brightness. */
  readonly bloomStrength: number;
  /** Bloom spread radius; neon eras bloom wider than painted ones. */
  readonly bloomRadius: number;
  /** Luminance cut-off that makes the bloom selective to emissives. */
  readonly bloomThreshold: number;
  /** `0` none … `1` maximum corner darkening. */
  readonly vignette: number;
  /** Normalised radius where the vignette starts to bite. */
  readonly vignetteRadius: number;
  /** `0` clean … `1` heavy film grain. */
  readonly grain: number;
}

/**
 * Mutable twin of {@link ColorGrade}.
 *
 * `writeGrade` fills one of these in place so `applyEra` never allocates on the
 * hot path; the tuple channels are preallocated arrays that are overwritten
 * rather than replaced.
 */
export interface MutableColorGrade {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  vignette: number;
  vignetteRadius: number;
  grain: number;
}

/* -------------------------------------------------------------------------- */
/* Derivation weights                                                         */
/* -------------------------------------------------------------------------- */

/*
 * Every constant below feeds one documented line of `deriveGradeInto`. They are
 * named so the derivation reads as a look recipe instead of unexplained magic
 * numbers, and so a reviewer can sanity-check the direction of each influence.
 */

const TEMPERATURE_SUN_WEIGHT = 0.5;
const TEMPERATURE_HORIZON_WEIGHT = 0.2;
const TEMPERATURE_SKY_WEIGHT = 0.3;
const TEMPERATURE_LIMIT = 1;
const TINT_SCALE = 2;
const TINT_LIMIT = 0.25;

const EXPOSURE_BASE = 0.85;
const EXPOSURE_LUX_SCALE = 0.55 / 100000;
const EXPOSURE_MIN = 0.8;
const EXPOSURE_MAX = 1.4;

const CONTRAST_BASE = 0.94;
const CONTRAST_AIR_SCALE = 0.28;
const CONTRAST_FOG_SCALE = 3.5;
const CONTRAST_MIN = 0.85;
const CONTRAST_MAX = 1.25;

const SATURATION_BASE = 0.72;
const SATURATION_AD_SCALE = 0.5;
const SATURATION_HAZE_SCALE = 0.2;
const SATURATION_MIN = 0.6;
const SATURATION_MAX = 1.15;

const HAZE_FOG_SCALE = 18;
const HAZE_AIR_SCALE = 0.35;
const HAZE_MAX = 0.6;
const LIFT_AMOUNT_SCALE = 0.06;

const GAMMA_BASE = 0.96;
const GAMMA_LUX_SCALE = 0.16 / 100000;
const GAMMA_MIN = 0.9;
const GAMMA_MAX = 1.15;

const GAIN_WHITE_BALANCE = 0.18;
const GAIN_TINT_SCALE = 0.08;

const BLOOM_STRENGTH_BASE = 0.35;
const BLOOM_STRENGTH_AD_SCALE = 0.9;
const BLOOM_STRENGTH_HAZE_SCALE = 0.1;
const BLOOM_STRENGTH_MIN = 0.25;
const BLOOM_STRENGTH_MAX = 1.4;

const BLOOM_RADIUS_BASE = 0.2;
const BLOOM_RADIUS_AD_SCALE = 0.55;
const BLOOM_RADIUS_MIN = 0.2;
const BLOOM_RADIUS_MAX = 0.8;

const BLOOM_THRESHOLD_BASE = 0.94;
const BLOOM_THRESHOLD_AD_SCALE = 0.14;
const BLOOM_THRESHOLD_MIN = 0.82;
const BLOOM_THRESHOLD_MAX = 0.96;

const VIGNETTE_BASE = 0.18;
const VIGNETTE_HAZE_SCALE = 0.34;
const VIGNETTE_MIN = 0.12;
const VIGNETTE_MAX = 0.55;

const VIGNETTE_RADIUS_BASE = 0.62;
const VIGNETTE_RADIUS_AIR_SCALE = 0.3;
const VIGNETTE_RADIUS_MIN = 0.55;
const VIGNETTE_RADIUS_MAX = 0.95;

const GRAIN_BASE = 0.16;
const GRAIN_AIR_SCALE = 0.3;
const GRAIN_FOG_SCALE = 1.8;
const GRAIN_MIN = 0.08;
const GRAIN_MAX = 0.42;

/* -------------------------------------------------------------------------- */
/* Source data helpers                                                        */
/* -------------------------------------------------------------------------- */

/** Splits a 24-bit `0xRRGGBB` era colour into normalised `[r, g, b]`. */
function hexChannels(color: number): readonly [number, number, number] {
  return [((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255];
}

/** Red-minus-blue balance of a colour: positive is warm, negative is cool. */
function warmth(color: number): number {
  const [red, , blue] = hexChannels(color);
  return red - blue;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return value < min ? min : value > max ? max : value;
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Derives the romanticised look of one era from its descriptor.
 *
 * The mapping is intentionally readable, not physically exact — it is a
 * cinematographer's read of the era data:
 *
 * - **temperature** averages the warm/cool balance of the era's sun, horizon
 *   and sky colours (sodium dusk comes out warm, clean daylight cool);
 * - **exposure/contrast/gamma** follow the lighting rig: low-lux overcast
 *   stops stay soft, high-lux clean daylight stops go crisp and high-key;
 * - **saturation/haze/vignette/grain** follow air quality and fog density, so
 *   soot and smog desaturate, flatten and lift the blacks;
 * - **bloom** follows advertising brightness so neon eras glow and painted
 *   eras barely sparkle, with the threshold kept high so only emissives bloom.
 */
export function deriveGradeInto(config: EraConfig, target: MutableColorGrade): MutableColorGrade {
  const { palette, environment, advertising } = config;
  const { lux, fogDensity, airQuality } = environment;

  const sunWarmth = warmth(palette.sunlight);
  const horizonWarmth = warmth(palette.skyHorizon);
  const skyWarmth = warmth(palette.sky);
  const fogWarmth = warmth(palette.fog);
  const [ambientRed, ambientGreen, ambientBlue] = hexChannels(palette.ambient);

  const temperature = clamp(
    sunWarmth * TEMPERATURE_SUN_WEIGHT +
      horizonWarmth * TEMPERATURE_HORIZON_WEIGHT +
      skyWarmth * TEMPERATURE_SKY_WEIGHT,
    -TEMPERATURE_LIMIT,
    TEMPERATURE_LIMIT,
  );
  const tint = clamp(
    ((ambientRed + ambientBlue) / 2 - ambientGreen) * TINT_SCALE,
    -TINT_LIMIT,
    TINT_LIMIT,
  );

  const haze = clamp(fogDensity * HAZE_FOG_SCALE + (1 - airQuality) * HAZE_AIR_SCALE, 0, HAZE_MAX);
  const liftAmount = haze * LIFT_AMOUNT_SCALE;
  const gammaLevel = clamp(
    GAMMA_BASE + lux * GAMMA_LUX_SCALE,
    GAMMA_MIN,
    GAMMA_MAX,
  );

  target.exposure = clamp(EXPOSURE_BASE + lux * EXPOSURE_LUX_SCALE, EXPOSURE_MIN, EXPOSURE_MAX);
  target.contrast = clamp(
    CONTRAST_BASE + airQuality * CONTRAST_AIR_SCALE - fogDensity * CONTRAST_FOG_SCALE,
    CONTRAST_MIN,
    CONTRAST_MAX,
  );
  target.saturation = clamp(
    SATURATION_BASE + advertising.saturation * SATURATION_AD_SCALE - (1 - airQuality) * SATURATION_HAZE_SCALE,
    SATURATION_MIN,
    SATURATION_MAX,
  );
  target.temperature = temperature;
  target.tint = tint;
  // Warm eras lift a touch of red/blue-asymmetric haze into the shadows; clean
  // eras stay eerily neutral, which is most of the 1945-vs-2025 read.
  target.lift[0] = liftAmount * (1 + fogWarmth);
  target.lift[1] = liftAmount;
  target.lift[2] = liftAmount * (1 - fogWarmth);
  target.gamma[0] = gammaLevel;
  target.gamma[1] = gammaLevel;
  target.gamma[2] = gammaLevel;
  // Gain carries the whole white balance: warm pushes red up and blue down.
  target.gain[0] = 1 + temperature * GAIN_WHITE_BALANCE;
  target.gain[1] = 1 - tint * GAIN_TINT_SCALE;
  target.gain[2] = 1 - temperature * GAIN_WHITE_BALANCE;
  target.bloomStrength = clamp(
    BLOOM_STRENGTH_BASE + advertising.brightness * BLOOM_STRENGTH_AD_SCALE - (1 - airQuality) * BLOOM_STRENGTH_HAZE_SCALE,
    BLOOM_STRENGTH_MIN,
    BLOOM_STRENGTH_MAX,
  );
  target.bloomRadius = clamp(
    BLOOM_RADIUS_BASE + advertising.brightness * BLOOM_RADIUS_AD_SCALE,
    BLOOM_RADIUS_MIN,
    BLOOM_RADIUS_MAX,
  );
  target.bloomThreshold = clamp(
    BLOOM_THRESHOLD_BASE - advertising.brightness * BLOOM_THRESHOLD_AD_SCALE,
    BLOOM_THRESHOLD_MIN,
    BLOOM_THRESHOLD_MAX,
  );
  target.vignette = clamp(
    VIGNETTE_BASE + (1 - airQuality) * VIGNETTE_HAZE_SCALE,
    VIGNETTE_MIN,
    VIGNETTE_MAX,
  );
  target.vignetteRadius = clamp(
    VIGNETTE_RADIUS_BASE + airQuality * VIGNETTE_RADIUS_AIR_SCALE,
    VIGNETTE_RADIUS_MIN,
    VIGNETTE_RADIUS_MAX,
  );
  target.grain = clamp(
    GRAIN_BASE + (1 - airQuality) * GRAIN_AIR_SCALE + fogDensity * GRAIN_FOG_SCALE,
    GRAIN_MIN,
    GRAIN_MAX,
  );

  return target;
}

/** Immutable convenience wrapper around {@link deriveGradeInto}. */
export function deriveGrade(config: EraConfig): ColorGrade {
  return toGrade(deriveGradeInto(config, createMutableGrade()));
}

/** A neutral, fully mutable grade ready to be written by {@link writeGrade}. */
export function createMutableGrade(): MutableColorGrade {
  return {
    exposure: 1,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    lift: [0, 0, 0],
    gamma: [1, 1, 1],
    gain: [1, 1, 1],
    bloomStrength: 0,
    bloomRadius: 0,
    bloomThreshold: 1,
    vignette: 0,
    vignetteRadius: 1,
    grain: 0,
  };
}

/** Copies every channel of `source` into `target` and returns `target`. */
export function copyGrade(source: ColorGrade, target: MutableColorGrade): MutableColorGrade {
  target.exposure = source.exposure;
  target.contrast = source.contrast;
  target.saturation = source.saturation;
  target.temperature = source.temperature;
  target.tint = source.tint;
  target.lift[0] = source.lift[0];
  target.lift[1] = source.lift[1];
  target.lift[2] = source.lift[2];
  target.gamma[0] = source.gamma[0];
  target.gamma[1] = source.gamma[1];
  target.gamma[2] = source.gamma[2];
  target.gain[0] = source.gain[0];
  target.gain[1] = source.gain[1];
  target.gain[2] = source.gain[2];
  target.bloomStrength = source.bloomStrength;
  target.bloomRadius = source.bloomRadius;
  target.bloomThreshold = source.bloomThreshold;
  target.vignette = source.vignette;
  target.vignetteRadius = source.vignetteRadius;
  target.grain = source.grain;
  return target;
}

/* -------------------------------------------------------------------------- */
/* Per-era cache                                                              */
/* -------------------------------------------------------------------------- */

const GRADE_CACHE: Partial<Record<EraId, ColorGrade>> = {};

/** The frozen, cached grade of one era. Throws on an unknown era id. */
export function gradeForEra(era: EraId): ColorGrade {
  const cached = GRADE_CACHE[era];
  if (cached) {
    return cached;
  }
  const grade = deriveGrade(getEraConfig(era));
  GRADE_CACHE[era] = grade;
  return grade;
}

/* -------------------------------------------------------------------------- */
/* Blending                                                                   */
/* -------------------------------------------------------------------------- */

function resetGrade(target: MutableColorGrade): void {
  target.exposure = 0;
  target.contrast = 0;
  target.saturation = 0;
  target.temperature = 0;
  target.tint = 0;
  target.lift[0] = 0;
  target.lift[1] = 0;
  target.lift[2] = 0;
  target.gamma[0] = 0;
  target.gamma[1] = 0;
  target.gamma[2] = 0;
  target.gain[0] = 0;
  target.gain[1] = 0;
  target.gain[2] = 0;
  target.bloomStrength = 0;
  target.bloomRadius = 0;
  target.bloomThreshold = 0;
  target.vignette = 0;
  target.vignetteRadius = 0;
  target.grain = 0;
}

function addScaled(grade: ColorGrade, weight: number, target: MutableColorGrade): void {
  target.exposure += grade.exposure * weight;
  target.contrast += grade.contrast * weight;
  target.saturation += grade.saturation * weight;
  target.temperature += grade.temperature * weight;
  target.tint += grade.tint * weight;
  target.lift[0] += grade.lift[0] * weight;
  target.lift[1] += grade.lift[1] * weight;
  target.lift[2] += grade.lift[2] * weight;
  target.gamma[0] += grade.gamma[0] * weight;
  target.gamma[1] += grade.gamma[1] * weight;
  target.gamma[2] += grade.gamma[2] * weight;
  target.gain[0] += grade.gain[0] * weight;
  target.gain[1] += grade.gain[1] * weight;
  target.gain[2] += grade.gain[2] * weight;
  target.bloomStrength += grade.bloomStrength * weight;
  target.bloomRadius += grade.bloomRadius * weight;
  target.bloomThreshold += grade.bloomThreshold * weight;
  target.vignette += grade.vignette * weight;
  target.vignetteRadius += grade.vignetteRadius * weight;
  target.grain += grade.grain * weight;
}

/**
 * Writes the `from → to` era transition at `blend` into `target`, in place.
 *
 * This is the allocation-free twin of {@link interpolateGrade}: it mirrors the
 * era contract's `resolveEraWeights` spread (`from` weight `1 - blend`, `to`
 * weight `blend`, and `to` alone once settled) without allocating a weights
 * record, so `applyEra` can be called continuously during a morph.
 */
export function writeGrade(
  from: EraId,
  to: EraId,
  blend: number,
  target: MutableColorGrade,
): MutableColorGrade {
  // Fail fast on ids outside the contract: the two-era spread below only ever
  // looks at real era ids, so an unknown id would otherwise pass silently.
  getEraConfig(from);
  getEraConfig(to);
  resetGrade(target);
  const progress = clampBlend(blend);
  if (from === to) {
    addScaled(gradeForEra(from), 1, target);
    return target;
  }
  const backward = 1 - progress;
  // Same chronological accumulation order as {@link interpolateGrade}, so both
  // entry points agree bit for bit instead of only mathematically.
  for (const id of ERA_IDS) {
    const weight = id === from ? backward : id === to ? progress : 0;
    if (weight === 0) {
      continue;
    }
    addScaled(gradeForEra(id), weight, target);
  }
  return target;
}

/**
 * The `from → to` era transition at `blend` as an immutable grade.
 *
 * Uses the era contract's `resolveEraWeights` directly, which is what makes the
 * colour grade share the scene's blend semantics exactly.
 */
export function interpolateGrade(from: EraId, to: EraId, blend: number): ColorGrade {
  // `resolveEraWeights` ignores ids outside the contract, so validate them here.
  getEraConfig(from);
  getEraConfig(to);
  const weights = resolveEraWeights(from, to, blend);
  const target = createMutableGrade();
  resetGrade(target);
  for (const id of ERA_IDS) {
    const weight = weights[id];
    if (weight === 0) {
      continue;
    }
    addScaled(gradeForEra(id), weight, target);
  }
  return toGrade(target);
}

/** Snapshot of a mutable grade as a frozen {@link ColorGrade}. */
export function toGrade(source: MutableColorGrade): ColorGrade {
  return Object.freeze({
    exposure: source.exposure,
    contrast: source.contrast,
    saturation: source.saturation,
    temperature: source.temperature,
    tint: source.tint,
    lift: [source.lift[0], source.lift[1], source.lift[2]] as const,
    gamma: [source.gamma[0], source.gamma[1], source.gamma[2]] as const,
    gain: [source.gain[0], source.gain[1], source.gain[2]] as const,
    bloomStrength: source.bloomStrength,
    bloomRadius: source.bloomRadius,
    bloomThreshold: source.bloomThreshold,
    vignette: source.vignette,
    vignetteRadius: source.vignetteRadius,
    grain: source.grain,
  });
}
