/**
 * Chrono City era wardrobe: everything that decides *what a pedestrian looks
 * like*, kept separate from the walking/routing system in `./pedestrians`.
 *
 * The module is pure data plus pure math:
 *
 * - {@link FigureRigParams} is a flat, fully numeric parameter space that
 *   describes a low-poly human rig: body proportions, garment layering, hair,
 *   hats, bags, footwear, carried gadgets and support props. Because every
 *   parameter is a number, morphing between two eras is a plain linear blend —
 *   that is what lets `applyEra(era, blend)` reshape a crowd continuously
 *   without ever adding or removing geometry.
 * - Silhouettes, hair styles, hat/bag/shoe styles and accessories are authored
 *   as *overrides* over {@link BASE_RIG_PARAMS}. Real per-era outfits come from
 *   the frozen era contract (`ERAS[...].pedestrians.outfits`), so the wardrobe
 *   can never disagree with the era dataset: it only adds shape, fabric and
 *   detail parameters on top of the authoritative rules.
 * - Fabrics are procedural canvas textures (weave + pattern) painted from
 *   deterministic pixel math; headless test environments without a 2D canvas
 *   fall back to an equivalent `THREE.DataTexture`.
 */

import * as THREE from "three";

import {
  ERAS,
  getEraConfig,
  type AgeMix,
  type EraId,
  type OutfitRule,
  type SilhouetteId,
} from "../era/eraTypes";

/* -------------------------------------------------------------------------- */
/* Deterministic sampling                                                     */
/* -------------------------------------------------------------------------- */

/** Two-pi, hoisted because the fabric painter uses it heavily. */
const TWO_PI = Math.PI * 2;

/** Stable 32-bit string hash (FNV-1a), used to seed deterministic choices. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic `0..1` sample for a `(seed, salt)` pair; order-independent. */
function sample(seed: number, salt: string): number {
  let state = (hashString(salt) ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0;
  state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
  state = Math.imul(state ^ (state >>> 12), 0x297a2d39) >>> 0;
  return ((state ^ (state >>> 15)) >>> 0) / 4294967296;
}

/** Deterministic integer sample in `[0, max)`. */
function sampleIndex(seed: number, salt: string, max: number): number {
  if (max <= 1) {
    return 0;
  }
  return Math.min(max - 1, Math.floor(sample(seed, salt) * max));
}

/** Picks one entry of `values` deterministically. */
function pick<T>(values: readonly T[], seed: number, salt: string): T {
  return values[sampleIndex(seed, salt, values.length)]!;
}

/** Clamps to the `0..1` range, treating `NaN` as 0. */
function clampUnit(value: number): number {
  return Number.isNaN(value) ? 0 : value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/* -------------------------------------------------------------------------- */
/* Rig parameter space                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Flat numeric description of one pedestrian rig.
 *
 * All lengths are metres at a nominal 1.72 m adult height; all weights are
 * `0..1` presence or blend factors. Every rig parameter is blended linearly by
 * {@link blendRigParams}, so a transition can never pop a figure.
 */
export interface FigureRigParams {
  /* Overall body */
  /** Uniform rig scale: age bracket times individual variation. */
  heightScale: number;
  build: number;
  torsoWidth: number;
  torsoHeight: number;
  torsoDepth: number;
  shoulderWidth: number;
  /** 0..1 shoulder-pad lift, the 1985 power-suit tell. */
  shoulderLift: number;
  waistCinched: number;
  collarHeight: number;
  lapelWidth: number;
  /* Outfit layers */
  /** 0..1 of the leg length covered by a skirt, dress or coat hem. */
  hemLength: number;
  hemFlare: number;
  hemSway: number;
  sleeveLength: number;
  sleeveWidth: number;
  coverage: number;
  legCoverage: number;
  legWidth: number;
  trouserBreak: number;
  seamLines: number;
  patternStrength: number;
  fabricRoughness: number;
  fabricSheen: number;
  fabricMetalness: number;
  /* Hair */
  hairVolume: number;
  hairLength: number;
  hairFringe: number;
  hairTail: number;
  hairCurl: number;
  hairSidePart: number;
  hairLift: number;
  /* Headwear */
  hatWeight: number;
  hatCrownRadius: number;
  hatCrownHeight: number;
  hatCrownRound: number;
  hatBrimRadius: number;
  hatBrimThickness: number;
  hatBrimTilt: number;
  hatBandHeight: number;
  hatPeakLength: number;
  hatVeilDrop: number;
  hatBackwards: number;
  /* Eyewear */
  eyewearWeight: number;
  eyewearWidth: number;
  eyewearLensHeight: number;
  eyewearWrap: number;
  /* Neckwear */
  neckWeight: number;
  neckDrop: number;
  neckBeads: number;
  /* Gloves */
  handsWeight: number;
  handsCuff: number;
  /* Wristwear */
  wristWeight: number;
  wristFaceWidth: number;
  /* Head-worn audio */
  audioWeight: number;
  audioPodRadius: number;
  audioBandDrop: number;
  /* Over-layers (windbreaker, blazer, running vest) */
  overlayerWeight: number;
  overlayerBulk: number;
  overlayerLength: number;
  overlayerCollar: number;
  /* Bags */
  bagWeight: number;
  bagWidth: number;
  bagHeight: number;
  bagDepth: number;
  bagStrapDrop: number;
  bagSway: number;
  /** 0 = hip/shoulder, 1 = carried in hand, 2 = worn on the back. */
  bagWear: number;
  /* Carried items */
  carriedWeight: number;
  carriedWidth: number;
  carriedHeight: number;
  carriedDepth: number;
  /* Support props (walking cane) */
  supportWeight: number;
  supportLength: number;
  /* Footwear */
  footwearWeight: number;
  shoeLength: number;
  shoeHeight: number;
  shoeSole: number;
  shoeToe: number;
}

/** Canonical parameter order; blending and inspection both iterate this list. */
export const FIGURE_PARAM_KEYS = [
  "heightScale",
  "build",
  "torsoWidth",
  "torsoHeight",
  "torsoDepth",
  "shoulderWidth",
  "shoulderLift",
  "waistCinched",
  "collarHeight",
  "lapelWidth",
  "hemLength",
  "hemFlare",
  "hemSway",
  "sleeveLength",
  "sleeveWidth",
  "coverage",
  "legCoverage",
  "legWidth",
  "trouserBreak",
  "seamLines",
  "patternStrength",
  "fabricRoughness",
  "fabricSheen",
  "fabricMetalness",
  "hairVolume",
  "hairLength",
  "hairFringe",
  "hairTail",
  "hairCurl",
  "hairSidePart",
  "hairLift",
  "hatWeight",
  "hatCrownRadius",
  "hatCrownHeight",
  "hatCrownRound",
  "hatBrimRadius",
  "hatBrimThickness",
  "hatBrimTilt",
  "hatBandHeight",
  "hatPeakLength",
  "hatVeilDrop",
  "hatBackwards",
  "eyewearWeight",
  "eyewearWidth",
  "eyewearLensHeight",
  "eyewearWrap",
  "neckWeight",
  "neckDrop",
  "neckBeads",
  "handsWeight",
  "handsCuff",
  "wristWeight",
  "wristFaceWidth",
  "audioWeight",
  "audioPodRadius",
  "audioBandDrop",
  "overlayerWeight",
  "overlayerBulk",
  "overlayerLength",
  "overlayerCollar",
  "bagWeight",
  "bagWidth",
  "bagHeight",
  "bagDepth",
  "bagStrapDrop",
  "bagSway",
  "bagWear",
  "carriedWeight",
  "carriedWidth",
  "carriedHeight",
  "carriedDepth",
  "supportWeight",
  "supportLength",
  "footwearWeight",
  "shoeLength",
  "shoeHeight",
  "shoeSole",
  "shoeToe",
] as const satisfies readonly (keyof FigureRigParams)[];

/** Neutral rig: an unremarkable adult in plain clothes. */
export const BASE_RIG_PARAMS: FigureRigParams = {
  heightScale: 1,
  build: 1,
  torsoWidth: 1,
  torsoHeight: 1,
  torsoDepth: 1,
  shoulderWidth: 0.34,
  shoulderLift: 0,
  waistCinched: 0.35,
  collarHeight: 0.04,
  lapelWidth: 0.05,
  hemLength: 0.28,
  hemFlare: 0.16,
  hemSway: 0.5,
  sleeveLength: 0.85,
  sleeveWidth: 0.055,
  coverage: 0.8,
  legCoverage: 1,
  legWidth: 0.062,
  trouserBreak: 0.1,
  seamLines: 2,
  patternStrength: 0.2,
  fabricRoughness: 0.8,
  fabricSheen: 0.1,
  fabricMetalness: 0.05,
  hairVolume: 0.4,
  hairLength: 0.2,
  hairFringe: 0.4,
  hairTail: 0,
  hairCurl: 0.1,
  hairSidePart: 0.3,
  hairLift: 0.2,
  hatWeight: 0,
  hatCrownRadius: 0.11,
  hatCrownHeight: 0.08,
  hatCrownRound: 0.5,
  hatBrimRadius: 0.02,
  hatBrimThickness: 0.014,
  hatBrimTilt: -0.05,
  hatBandHeight: 0.02,
  hatPeakLength: 0,
  hatVeilDrop: 0,
  hatBackwards: 0,
  eyewearWeight: 0,
  eyewearWidth: 0.17,
  eyewearLensHeight: 0.045,
  eyewearWrap: 0.3,
  neckWeight: 0,
  neckDrop: 0.08,
  neckBeads: 0,
  handsWeight: 0,
  handsCuff: 0,
  wristWeight: 0,
  wristFaceWidth: 1,
  audioWeight: 0,
  audioPodRadius: 0.024,
  audioBandDrop: 0,
  overlayerWeight: 0,
  overlayerBulk: 1,
  overlayerLength: 0.8,
  overlayerCollar: 0.6,
  bagWeight: 0,
  bagWidth: 0.24,
  bagHeight: 0.26,
  bagDepth: 0.1,
  bagStrapDrop: 0.34,
  bagSway: 0.3,
  bagWear: 0,
  carriedWeight: 0,
  carriedWidth: 0.07,
  carriedHeight: 0.12,
  carriedDepth: 0.03,
  supportWeight: 0,
  supportLength: 0.86,
  footwearWeight: 1,
  shoeLength: 0.27,
  shoeHeight: 0.09,
  shoeSole: 0.026,
  shoeToe: 0.5,
};

/** Partial parameter override, as authored by every wardrobe table below. */
export type FigureParamPatch = Partial<FigureRigParams>;

/** Applies any number of overrides on top of `base`, later patches winning. */
export function withOverrides(
  base: FigureRigParams,
  ...patches: readonly (FigureParamPatch | undefined | null)[]
): FigureRigParams {
  const result: FigureRigParams = { ...base };
  for (const patch of patches) {
    if (patch) {
      Object.assign(result, patch);
    }
  }
  return result;
}

/** Multiplies / offsets selected parameters, used for per-figure variation. */
function modulateParams(
  base: FigureRigParams,
  scale: FigureParamPatch,
  offset: FigureParamPatch = {},
): FigureRigParams {
  const result: FigureRigParams = { ...base };
  for (const [key, factor] of Object.entries(scale) as [keyof FigureRigParams, number][]) {
    result[key] = result[key] * factor;
  }
  for (const [key, delta] of Object.entries(offset) as [keyof FigureRigParams, number][]) {
    result[key] = result[key] + delta;
  }
  return result;
}

/**
 * Linear blend of two full parameter sets.
 *
 * This single function is the whole outfit-morph mechanism: because every rig
 * parameter is numeric, adapters, hair, hats, bags and shoes all reshape
 * continuously as `progress` sweeps `0..1`.
 */
export function blendRigParams(from: FigureRigParams, to: FigureRigParams, progress: number): FigureRigParams {
  const t = clampUnit(progress);
  const blended = {} as Record<keyof FigureRigParams, number>;
  for (const key of FIGURE_PARAM_KEYS) {
    blended[key] = from[key] + (to[key] - from[key]) * t;
  }
  return blended;
}

/* -------------------------------------------------------------------------- */
/* Colours                                                                    */
/* -------------------------------------------------------------------------- */

/** Per-figure colour set; every entry is a 24-bit `0xRRGGBB` integer. */
export interface FigureColors {
  skin: number;
  hair: number;
  garment: number;
  garmentAccent: number;
  trousers: number;
  footwear: number;
  headwear: number;
  bag: number;
  glove: number;
  metal: number;
  eye: number;
  lens: number;
  support: number;
}

/** Canonical colour order. */
export const FIGURE_COLOR_KEYS = [
  "skin",
  "hair",
  "garment",
  "garmentAccent",
  "trousers",
  "footwear",
  "headwear",
  "bag",
  "glove",
  "metal",
  "eye",
  "lens",
  "support",
] as const satisfies readonly (keyof FigureColors)[];

/** Neutral colour set, replaced per figure by the era palette sample. */
export const BASE_FIGURE_COLORS: FigureColors = {
  skin: 0xe4b48f,
  hair: 0x4a3a2c,
  garment: 0x6f7a8a,
  garmentAccent: 0xd8d4cb,
  trousers: 0x3a4152,
  footwear: 0x2b2f3a,
  headwear: 0x3a3f4a,
  bag: 0x6b5b45,
  glove: 0x3a2a24,
  metal: 0xc2c7cc,
  eye: 0x2b2f3a,
  lens: 0x1b2026,
  support: 0x5a3f2c,
};

const skinColorScratch = new THREE.Color();
const hairColorScratch = new THREE.Color();
const lerpScratch = new THREE.Color();

/** Channel-wise blend of two hex colours; returns a fresh `0xRRGGBB`. */
export function blendHexColors(from: number, to: number, progress: number): number {
  const t = clampUnit(progress);
  skinColorScratch.setHex(from);
  hairColorScratch.setHex(to);
  lerpScratch.copy(skinColorScratch).lerp(hairColorScratch, t);
  return lerpScratch.getHex();
}

/** Blends two complete colour sets, so fabrics grade continuously. */
export function blendColors(from: FigureColors, to: FigureColors, progress: number): FigureColors {
  const t = clampUnit(progress);
  const blended = {} as Record<keyof FigureColors, number>;
  for (const key of FIGURE_COLOR_KEYS) {
    blended[key] = blendHexColors(from[key], to[key], t);
  }
  return blended;
}

/* -------------------------------------------------------------------------- */
/* Silhouettes                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Shape language for one outfit rule's silhouette, as overrides over
 * {@link BASE_RIG_PARAMS}. Covers all twenty `SilhouetteId` members of the era
 * contract, from 1945 long overcoats to 2025 repairable techwear shells.
 */
export const SILHOUETTE_SHAPES = {
  "long-overcoat": {
    hemLength: 0.82, hemFlare: 0.24, hemSway: 0.75, collarHeight: 0.09, lapelWidth: 0.11,
    sleeveLength: 1, sleeveWidth: 0.062, coverage: 0.96, legCoverage: 0.55, waistCinched: 0.5, seamLines: 4,
  },
  "a-line-knee": {
    hemLength: 0.5, hemFlare: 0.46, hemSway: 0.65, collarHeight: 0.05, lapelWidth: 0.04,
    sleeveLength: 0.9, sleeveWidth: 0.056, coverage: 0.9, legCoverage: 0.32, waistCinched: 0.6, seamLines: 3,
  },
  "tunic-trousers": {
    hemLength: 0.36, hemFlare: 0.12, collarHeight: 0.07, lapelWidth: 0.08, shoulderLift: 0.25,
    sleeveLength: 1, coverage: 0.96, legCoverage: 1, waistCinched: 0.7, seamLines: 4,
  },
  knickerbocker: {
    hemLength: 0.18, hemFlare: 0.1, collarHeight: 0.04, sleeveLength: 0.7, coverage: 0.85,
    legCoverage: 0.5, trouserBreak: 0.55, legWidth: 0.07, seamLines: 3,
  },
  "shift-mini": {
    hemLength: 0.34, hemFlare: 0.52, hemSway: 0.9, collarHeight: 0.03, sleeveLength: 0, sleeveWidth: 0.05,
    coverage: 0.62, legCoverage: 0.15, legWidth: 0.058, waistCinched: 0.2, seamLines: 2,
  },
  "slim-lapel-suit": {
    hemLength: 0.3, hemFlare: 0.06, collarHeight: 0.05, lapelWidth: 0.05, sleeveLength: 1, sleeveWidth: 0.052,
    coverage: 0.88, legCoverage: 1, waistCinched: 0.45, seamLines: 3, trouserBreak: 0.05,
  },
  "sleeveless-a-line": {
    hemLength: 0.52, hemFlare: 0.42, hemSway: 0.7, sleeveLength: 0, sleeveWidth: 0.05,
    coverage: 0.68, legCoverage: 0.2, waistCinched: 0.35, seamLines: 2,
  },
  dungaree: {
    hemLength: 0.28, hemFlare: 0.08, shoulderWidth: 0.37, sleeveLength: 0.35, coverage: 0.9,
    legCoverage: 1, legWidth: 0.068, waistCinched: 0.1, seamLines: 5,
  },
  "boxy-denim": {
    hemLength: 0.3, hemFlare: 0.1, build: 1.05, shoulderWidth: 0.38, sleeveLength: 0.9, sleeveWidth: 0.06,
    coverage: 0.8, legCoverage: 1, legWidth: 0.072, seamLines: 4, trouserBreak: 0.2,
  },
  "oversized-shoulder-pad": {
    hemLength: 0.36, hemFlare: 0.14, build: 1.08, shoulderWidth: 0.46, shoulderLift: 1, sleeveWidth: 0.07,
    sleeveLength: 1, coverage: 0.9, legCoverage: 1, waistCinched: 0.15, seamLines: 3,
  },
  "leotard-legwarmers": {
    hemLength: 0.12, hemFlare: 0.1, sleeveLength: 0.45, sleeveWidth: 0.05, coverage: 0.7,
    legCoverage: 0.55, legWidth: 0.068, waistCinched: 0.55, seamLines: 2,
  },
  "belted-trench": {
    hemLength: 0.78, hemFlare: 0.28, hemSway: 0.8, collarHeight: 0.1, lapelWidth: 0.09,
    waistCinched: 0.95, coverage: 0.92, legCoverage: 0.5, sleeveLength: 1, seamLines: 4,
  },
  "low-rise-bootcut": {
    hemLength: 0.22, hemFlare: 0.1, coverage: 0.72, legCoverage: 1, legWidth: 0.062,
    trouserBreak: 0.7, waistCinched: 0.1, seamLines: 3,
  },
  "baggy-athletic": {
    hemLength: 0.26, hemFlare: 0.12, build: 1.03, sleeveLength: 0.85, sleeveWidth: 0.066,
    coverage: 0.82, legCoverage: 1, legWidth: 0.085, trouserBreak: 0.35, seamLines: 2,
  },
  "untucked-shirt-trouser": {
    hemLength: 0.32, hemFlare: 0.08, collarHeight: 0.03, sleeveLength: 0.9, coverage: 0.85,
    legCoverage: 1, waistCinched: 0.05, seamLines: 3,
  },
  "cargo-utility": {
    hemLength: 0.26, hemFlare: 0.1, sleeveLength: 0.5, coverage: 0.7, legCoverage: 0.85,
    legWidth: 0.078, waistCinched: 0.15, seamLines: 6, trouserBreak: 0.4,
  },
  "oversized-techwear": {
    hemLength: 0.34, hemFlare: 0.12, build: 1.06, shoulderWidth: 0.4, sleeveWidth: 0.068,
    coverage: 0.8, legCoverage: 1, legWidth: 0.075, waistCinched: 0.2, seamLines: 7,
  },
  "compression-knit": {
    hemLength: 0.24, hemFlare: 0.06, build: 0.97, sleeveLength: 0.8, sleeveWidth: 0.048,
    coverage: 0.74, legCoverage: 1, legWidth: 0.058, waistCinched: 0.4, seamLines: 2, patternStrength: 0.15,
  },
  "relaxed-single-breasted": {
    hemLength: 0.42, hemFlare: 0.08, collarHeight: 0.05, lapelWidth: 0.08, sleeveLength: 1,
    coverage: 0.88, legCoverage: 1, waistCinched: 0.25, seamLines: 2,
  },
  "repair-panelled-shell": {
    hemLength: 0.4, hemFlare: 0.1, shoulderWidth: 0.38, sleeveWidth: 0.066, coverage: 0.9,
    legCoverage: 1, waistCinched: 0.3, seamLines: 8, patternStrength: 0.5,
  },
} as const satisfies Readonly<Record<SilhouetteId, FigureParamPatch>>;

/* -------------------------------------------------------------------------- */
/* Hair                                                                       */
/* -------------------------------------------------------------------------- */

/** Era hair styles; ids are deliberately descriptive of the period. */
export type HairStyleId =
  | "victory-rolls"
  | "brylcreemed-side-part"
  | "pin-curls"
  | "schoolboy-crop"
  | "bouffant"
  | "mop-top"
  | "beehive"
  | "mod-crop"
  | "big-perm"
  | "mullet"
  | "feathered-bob"
  | "flat-top"
  | "frosted-tips"
  | "straight-layered"
  | "buzz-cut"
  | "pulled-back-ponytail"
  | "undercut-fade"
  | "sleek-bun"
  | "natural-curls"
  | "shaved-side-part";

/** Human-readable label plus rig overrides for one styled wardrobe item. */
export interface StyleSpec {
  readonly label: string;
  readonly params: FigureParamPatch;
}

export const HAIR_STYLES = {
  "victory-rolls": { label: "Victory rolls", params: { hairVolume: 0.75, hairLength: 0.35, hairFringe: 0.7, hairCurl: 0.8, hairLift: 0.55, hairSidePart: 0.2 } },
  "brylcreemed-side-part": { label: "Brylcreemed side part", params: { hairVolume: 0.3, hairLength: 0.1, hairFringe: 0.3, hairCurl: 0.05, hairLift: 0.05, hairSidePart: 0.9 } },
  "pin-curls": { label: "Pin curls", params: { hairVolume: 0.6, hairLength: 0.55, hairFringe: 0.4, hairCurl: 0.95, hairLift: 0.35, hairSidePart: 0.35 } },
  "schoolboy-crop": { label: "Schoolboy crop", params: { hairVolume: 0.35, hairLength: 0.12, hairFringe: 0.8, hairCurl: 0.15, hairLift: 0.1, hairSidePart: 0.5 } },
  bouffant: { label: "Bouffant", params: { hairVolume: 0.9, hairLength: 0.45, hairFringe: 0.6, hairCurl: 0.6, hairLift: 0.85, hairSidePart: 0.25 } },
  "mop-top": { label: "Mop top", params: { hairVolume: 0.7, hairLength: 0.3, hairFringe: 0.95, hairCurl: 0.35, hairLift: 0.25, hairSidePart: 0.15 } },
  beehive: { label: "Beehive", params: { hairVolume: 1, hairLength: 0.4, hairFringe: 0.5, hairCurl: 0.7, hairLift: 1, hairSidePart: 0.3 } },
  "mod-crop": { label: "Mod crop", params: { hairVolume: 0.4, hairLength: 0.2, hairFringe: 0.85, hairCurl: 0.1, hairLift: 0.2, hairSidePart: 0.7 } },
  "big-perm": { label: "Big perm", params: { hairVolume: 1, hairLength: 0.6, hairFringe: 0.45, hairCurl: 0.9, hairLift: 0.7, hairSidePart: 0.2 } },
  mullet: { label: "Mullet", params: { hairVolume: 0.55, hairLength: 0.7, hairFringe: 0.35, hairTail: 1, hairCurl: 0.4, hairLift: 0.3, hairSidePart: 0.4 } },
  "feathered-bob": { label: "Feathered bob", params: { hairVolume: 0.7, hairLength: 0.5, hairFringe: 0.9, hairCurl: 0.5, hairLift: 0.45, hairSidePart: 0.6 } },
  "flat-top": { label: "Flat top", params: { hairVolume: 0.45, hairLength: 0.1, hairFringe: 0.2, hairCurl: 0.05, hairLift: 0.95, hairSidePart: 0.05 } },
  "frosted-tips": { label: "Frosted tips", params: { hairVolume: 0.5, hairLength: 0.25, hairFringe: 0.85, hairCurl: 0.25, hairLift: 0.75, hairSidePart: 0.45 } },
  "straight-layered": { label: "Straight layered", params: { hairVolume: 0.45, hairLength: 0.75, hairFringe: 0.5, hairCurl: 0.08, hairLift: 0.15, hairSidePart: 0.55 } },
  "buzz-cut": { label: "Buzz cut", params: { hairVolume: 0.12, hairLength: 0.05, hairFringe: 0.1, hairCurl: 0.02, hairLift: 0.05, hairSidePart: 0.2 } },
  "pulled-back-ponytail": { label: "Pulled-back ponytail", params: { hairVolume: 0.35, hairLength: 0.55, hairFringe: 0.2, hairTail: 0.9, hairCurl: 0.15, hairLift: 0.1, hairSidePart: 0.1 } },
  "undercut-fade": { label: "Undercut fade", params: { hairVolume: 0.42, hairLength: 0.18, hairFringe: 0.6, hairCurl: 0.2, hairLift: 0.6, hairSidePart: 0.85 } },
  "sleek-bun": { label: "Sleek bun", params: { hairVolume: 0.4, hairLength: 0.4, hairFringe: 0.1, hairTail: 0.5, hairCurl: 0.12, hairLift: 0.3, hairSidePart: 0.15 } },
  "natural-curls": { label: "Natural curls", params: { hairVolume: 0.9, hairLength: 0.5, hairFringe: 0.5, hairCurl: 1, hairLift: 0.4, hairSidePart: 0.25 } },
  "shaved-side-part": { label: "Shaved side part", params: { hairVolume: 0.3, hairLength: 0.15, hairFringe: 0.4, hairCurl: 0.08, hairLift: 0.35, hairSidePart: 0.95 } },
} as const satisfies Readonly<Record<HairStyleId, StyleSpec>>;

/* -------------------------------------------------------------------------- */
/* Hats, bags and footwear styles                                             */
/* -------------------------------------------------------------------------- */

/** Hat/headwear styles the wardrobe can place on a figure. */
export type HatStyleId =
  | "fedora"
  | "flat-cap"
  | "head-scarf"
  | "patterned-headscarf"
  | "peaked-cap"
  | "pillbox-hat"
  | "rain-hat"
  | "trucker-cap"
  | "backwards-cap"
  | "e-bike-helmet"
  | "beanie-knit"
  | "sweatband"
  | "sun-visor";

export const HAT_STYLES = {
  fedora: { label: "Fedora", params: { hatCrownRadius: 0.115, hatCrownHeight: 0.15, hatCrownRound: 0.25, hatBrimRadius: 0.3, hatBrimThickness: 0.02, hatBrimTilt: -0.06, hatBandHeight: 0.035 } },
  "flat-cap": { label: "Flat cap", params: { hatCrownRadius: 0.12, hatCrownHeight: 0.075, hatCrownRound: 0.8, hatBrimRadius: 0.17, hatBrimThickness: 0.018, hatBrimTilt: -0.12, hatBandHeight: 0.012, hatPeakLength: 0.02 } },
  "head-scarf": { label: "Head scarf", params: { hatCrownRadius: 0.115, hatCrownHeight: 0.11, hatCrownRound: 0.9, hatBrimRadius: 0.03, hatBrimThickness: 0.012, hatBrimTilt: 0, hatBandHeight: 0.022, hatVeilDrop: 0.22 } },
  "patterned-headscarf": { label: "Patterned headscarf", params: { hatCrownRadius: 0.118, hatCrownHeight: 0.115, hatCrownRound: 0.9, hatBrimRadius: 0.03, hatBrimThickness: 0.012, hatBrimTilt: 0, hatBandHeight: 0.03, hatVeilDrop: 0.18 } },
  "peaked-cap": { label: "Peaked cap", params: { hatCrownRadius: 0.115, hatCrownHeight: 0.09, hatCrownRound: 0.6, hatBrimRadius: 0.025, hatBrimThickness: 0.012, hatBrimTilt: -0.08, hatBandHeight: 0.02, hatPeakLength: 0.11 } },
  "pillbox-hat": { label: "Pillbox hat", params: { hatCrownRadius: 0.1, hatCrownHeight: 0.075, hatCrownRound: 0.15, hatBrimRadius: 0.012, hatBrimThickness: 0.01, hatBrimTilt: 0, hatBandHeight: 0.05 } },
  "rain-hat": { label: "Rain hat", params: { hatCrownRadius: 0.125, hatCrownHeight: 0.1, hatCrownRound: 0.5, hatBrimRadius: 0.24, hatBrimThickness: 0.016, hatBrimTilt: -0.16, hatBandHeight: 0.02, hatVeilDrop: 0.06 } },
  "trucker-cap": { label: "Trucker cap", params: { hatCrownRadius: 0.12, hatCrownHeight: 0.085, hatCrownRound: 0.4, hatBrimRadius: 0.02, hatBrimThickness: 0.012, hatBrimTilt: -0.1, hatBandHeight: 0.015, hatPeakLength: 0.12 } },
  "backwards-cap": { label: "Backwards cap", params: { hatCrownRadius: 0.12, hatCrownHeight: 0.085, hatCrownRound: 0.4, hatBrimRadius: 0.02, hatBrimThickness: 0.012, hatBrimTilt: -0.02, hatBandHeight: 0.015, hatPeakLength: 0.12, hatBackwards: 1 } },
  "e-bike-helmet": { label: "E-bike helmet", params: { hatCrownRadius: 0.135, hatCrownHeight: 0.12, hatCrownRound: 0.95, hatBrimRadius: 0.05, hatBrimThickness: 0.02, hatBrimTilt: -0.03, hatBandHeight: 0.022, hatPeakLength: 0.05 } },
  "beanie-knit": { label: "Knit beanie", params: { hatCrownRadius: 0.12, hatCrownHeight: 0.13, hatCrownRound: 0.95, hatBrimRadius: 0.04, hatBrimThickness: 0.016, hatBandHeight: 0.05 } },
  sweatband: { label: "Terry sweatband", params: { hatCrownRadius: 0.116, hatCrownHeight: 0.01, hatCrownRound: 0.5, hatBrimRadius: 0.02, hatBrimThickness: 0.01, hatBandHeight: 0.045 } },
  "sun-visor": { label: "Sun visor", params: { hatCrownRadius: 0.115, hatCrownHeight: 0.012, hatCrownRound: 0.4, hatBrimRadius: 0.02, hatBrimThickness: 0.01, hatBrimTilt: -0.3, hatBandHeight: 0.028, hatPeakLength: 0.06 } },
} as const satisfies Readonly<Record<HatStyleId, StyleSpec>>;

/** Bag styles, from 1945 ration bags to 2025 solar daypacks. */
export type BagStyleId =
  | "canvas-satchel"
  | "ration-book-bag"
  | "canvas-duffel"
  | "satchel"
  | "patent-bag"
  | "attache-case"
  | "clutch-bag"
  | "lunch-pail"
  | "bum-bag"
  | "briefcase"
  | "fanny-pack"
  | "laptop-bag"
  | "crossbody-sling"
  | "sustainable-tote"
  | "solar-daypack";

export const BAG_STYLES = {
  "canvas-satchel": { label: "Canvas satchel", params: { bagWidth: 0.22, bagHeight: 0.26, bagDepth: 0.09, bagStrapDrop: 0.42, bagSway: 0.35, bagWear: 0 } },
  "ration-book-bag": { label: "Ration book bag", params: { bagWidth: 0.18, bagHeight: 0.2, bagDepth: 0.08, bagStrapDrop: 0.36, bagSway: 0.3, bagWear: 0.5 } },
  "canvas-duffel": { label: "Canvas duffel", params: { bagWidth: 0.3, bagHeight: 0.18, bagDepth: 0.18, bagStrapDrop: 0.2, bagSway: 0.22, bagWear: 1 } },
  satchel: { label: "Leather satchel", params: { bagWidth: 0.17, bagHeight: 0.19, bagDepth: 0.07, bagStrapDrop: 0.4, bagSway: 0.32, bagWear: 0 } },
  "patent-bag": { label: "Patent handbag", params: { bagWidth: 0.14, bagHeight: 0.17, bagDepth: 0.06, bagStrapDrop: 0.44, bagSway: 0.42, bagWear: 1 } },
  "attache-case": { label: "Attache case", params: { bagWidth: 0.3, bagHeight: 0.22, bagDepth: 0.06, bagStrapDrop: 0.18, bagSway: 0.12, bagWear: 1 } },
  "clutch-bag": { label: "Clutch bag", params: { bagWidth: 0.16, bagHeight: 0.1, bagDepth: 0.05, bagStrapDrop: 0.14, bagSway: 0.15, bagWear: 1 } },
  "lunch-pail": { label: "Lunch pail", params: { bagWidth: 0.16, bagHeight: 0.16, bagDepth: 0.14, bagStrapDrop: 0.16, bagSway: 0.1, bagWear: 1 } },
  "bum-bag": { label: "Bum bag", params: { bagWidth: 0.24, bagHeight: 0.12, bagDepth: 0.08, bagStrapDrop: 0.1, bagSway: 0.2, bagWear: 0 } },
  briefcase: { label: "Briefcase", params: { bagWidth: 0.34, bagHeight: 0.26, bagDepth: 0.09, bagStrapDrop: 0.2, bagSway: 0.12, bagWear: 1 } },
  "fanny-pack": { label: "Fanny pack", params: { bagWidth: 0.26, bagHeight: 0.13, bagDepth: 0.09, bagStrapDrop: 0.08, bagSway: 0.2, bagWear: 0 } },
  "laptop-bag": { label: "Laptop bag", params: { bagWidth: 0.32, bagHeight: 0.24, bagDepth: 0.07, bagStrapDrop: 0.46, bagSway: 0.28, bagWear: 0 } },
  "crossbody-sling": { label: "Crossbody sling", params: { bagWidth: 0.18, bagHeight: 0.26, bagDepth: 0.06, bagStrapDrop: 0.5, bagSway: 0.45, bagWear: 0 } },
  "sustainable-tote": { label: "Recycled tote", params: { bagWidth: 0.26, bagHeight: 0.3, bagDepth: 0.1, bagStrapDrop: 0.24, bagSway: 0.2, bagWear: 1 } },
  "solar-daypack": { label: "Solar daypack", params: { bagWidth: 0.26, bagHeight: 0.36, bagDepth: 0.14, bagStrapDrop: 0.2, bagSway: 0.12, bagWear: 2 } },
} as const satisfies Readonly<Record<BagStyleId, StyleSpec>>;

/** Footwear styles; shoe height is the boot/sneaker tell. */
export type FootwearStyleId =
  | "oxford-shoes"
  | "leather-boots"
  | "wingtip-shoes"
  | "ballet-flats"
  | "steel-toe-boots"
  | "high-top-sneakers"
  | "court-shoes"
  | "canvas-sneakers"
  | "running-shoes"
  | "loafers"
  | "sport-sandals"
  | "chunky-trainers"
  | "derby-shoes"
  | "trail-sneakers";

export const FOOTWEAR_STYLES = {
  "oxford-shoes": { label: "Oxford shoes", params: { shoeLength: 0.26, shoeHeight: 0.07, shoeSole: 0.022, shoeToe: 0.5 } },
  "leather-boots": { label: "Leather boots", params: { shoeLength: 0.27, shoeHeight: 0.16, shoeSole: 0.03, shoeToe: 0.45 } },
  "wingtip-shoes": { label: "Wingtip shoes", params: { shoeLength: 0.27, shoeHeight: 0.075, shoeSole: 0.022, shoeToe: 0.55 } },
  "ballet-flats": { label: "Ballet flats", params: { shoeLength: 0.23, shoeHeight: 0.05, shoeSole: 0.014, shoeToe: 0.7 } },
  "steel-toe-boots": { label: "Steel-toe boots", params: { shoeLength: 0.29, shoeHeight: 0.18, shoeSole: 0.035, shoeToe: 0.3 } },
  "high-top-sneakers": { label: "High-top sneakers", params: { shoeLength: 0.28, shoeHeight: 0.17, shoeSole: 0.035, shoeToe: 0.45 } },
  "court-shoes": { label: "Court shoes", params: { shoeLength: 0.27, shoeHeight: 0.09, shoeSole: 0.026, shoeToe: 0.5 } },
  "canvas-sneakers": { label: "Canvas sneakers", params: { shoeLength: 0.27, shoeHeight: 0.085, shoeSole: 0.024, shoeToe: 0.55 } },
  "running-shoes": { label: "Running shoes", params: { shoeLength: 0.29, shoeHeight: 0.1, shoeSole: 0.032, shoeToe: 0.4 } },
  loafers: { label: "Loafers", params: { shoeLength: 0.25, shoeHeight: 0.07, shoeSole: 0.02, shoeToe: 0.55 } },
  "sport-sandals": { label: "Sport sandals", params: { shoeLength: 0.26, shoeHeight: 0.055, shoeSole: 0.025, shoeToe: 0.6 } },
  "chunky-trainers": { label: "Chunky trainers", params: { shoeLength: 0.31, shoeHeight: 0.13, shoeSole: 0.05, shoeToe: 0.45 } },
  "derby-shoes": { label: "Derby shoes", params: { shoeLength: 0.26, shoeHeight: 0.08, shoeSole: 0.021, shoeToe: 0.5 } },
  "trail-sneakers": { label: "Trail sneakers", params: { shoeLength: 0.3, shoeHeight: 0.12, shoeSole: 0.038, shoeToe: 0.42 } },
} as const satisfies Readonly<Record<FootwearStyleId, StyleSpec>>;

/* -------------------------------------------------------------------------- */
/* Fabrics                                                                    */
/* -------------------------------------------------------------------------- */

/** Weave families the procedural fabric painter can render. */
export type FabricWeave =
  | "worsted-wool"
  | "tweed"
  | "utility-poplin"
  | "leather-grain"
  | "gabardine"
  | "cotton-poplin"
  | "mohair"
  | "patent-pvc"
  | "steel-denim"
  | "nylon-taffeta"
  | "terry-knit"
  | "cotton-jersey"
  | "cargo-canvas"
  | "technical-softshell"
  | "technical-ripstop"
  | "recycled-knit"
  | "merino-jersey"
  | "bio-nylon";

/** Printed/patterned over-weave motifs painted on top of the weave. */
export type FabricPattern =
  | "plain"
  | "pinstripe"
  | "twill-diagonal"
  | "plaid-windowpane"
  | "houndstooth"
  | "neon-colour-block"
  | "terry-loop"
  | "rib-knit"
  | "ripstop-grid"
  | "quilted-panel"
  | "mesh-vent"
  | "camo-panel";

/** One fabric recipe: cloth weave, printed motif and PBR response. */
export interface FabricSpec {
  readonly id: string;
  readonly label: string;
  readonly weave: FabricWeave;
  readonly pattern: FabricPattern;
  /** Texture repeats across the garment; finer cloth reads as more modern. */
  readonly repeats: number;
  readonly roughness: number;
  readonly sheen: number;
  readonly metalness: number;
  /** 0..1 printed pattern strength used by the overlay texture alpha. */
  readonly patternStrength: number;
}

const FABRIC_LIST: readonly FabricSpec[] = [
  { id: "wool-worsted-charcoal", label: "Charcoal worsted wool", weave: "worsted-wool", pattern: "plain", repeats: 6, roughness: 0.92, sheen: 0.12, metalness: 0.02, patternStrength: 0.08 },
  { id: "tweed-brown-check", label: "Brown tweed check", weave: "tweed", pattern: "plaid-windowpane", repeats: 4, roughness: 0.95, sheen: 0.08, metalness: 0, patternStrength: 0.5 },
  { id: "utility-poplin-tan", label: "Utility poplin", weave: "utility-poplin", pattern: "plain", repeats: 8, roughness: 0.88, sheen: 0.1, metalness: 0, patternStrength: 0.1 },
  { id: "leather-oxblood", label: "Oxblood leather", weave: "leather-grain", pattern: "plain", repeats: 7, roughness: 0.42, sheen: 0.35, metalness: 0.05, patternStrength: 0.05 },
  { id: "gabardine-tan", label: "Tan gabardine", weave: "gabardine", pattern: "twill-diagonal", repeats: 7, roughness: 0.86, sheen: 0.14, metalness: 0.02, patternStrength: 0.2 },
  { id: "cotton-poplin-sorbet", label: "Sorbet cotton poplin", weave: "cotton-poplin", pattern: "plain", repeats: 9, roughness: 0.82, sheen: 0.12, metalness: 0, patternStrength: 0.08 },
  { id: "mohair-pinstripe", label: "Mohair pinstripe", weave: "mohair", pattern: "pinstripe", repeats: 5, roughness: 0.78, sheen: 0.3, metalness: 0.04, patternStrength: 0.55 },
  { id: "patent-pvc-white", label: "Patent PVC", weave: "patent-pvc", pattern: "plain", repeats: 3, roughness: 0.22, sheen: 0.7, metalness: 0.1, patternStrength: 0.06 },
  { id: "denim-indigo", label: "Indigo denim", weave: "steel-denim", pattern: "twill-diagonal", repeats: 5, roughness: 0.9, sheen: 0.06, metalness: 0.02, patternStrength: 0.4 },
  { id: "neon-nylon-taffeta", label: "Neon nylon taffeta", weave: "nylon-taffeta", pattern: "neon-colour-block", repeats: 3, roughness: 0.55, sheen: 0.55, metalness: 0.06, patternStrength: 0.85 },
  { id: "terry-sweat-fleece", label: "Terry sweat fleece", weave: "terry-knit", pattern: "terry-loop", repeats: 6, roughness: 0.94, sheen: 0.04, metalness: 0, patternStrength: 0.35 },
  { id: "cotton-jersey-grey", label: "Heather cotton jersey", weave: "cotton-jersey", pattern: "plain", repeats: 10, roughness: 0.9, sheen: 0.05, metalness: 0, patternStrength: 0.06 },
  { id: "cargo-canvas-khaki", label: "Khaki cargo canvas", weave: "cargo-canvas", pattern: "quilted-panel", repeats: 5, roughness: 0.93, sheen: 0.05, metalness: 0.02, patternStrength: 0.4 },
  { id: "technical-softshell", label: "Technical softshell", weave: "technical-softshell", pattern: "mesh-vent", repeats: 8, roughness: 0.6, sheen: 0.28, metalness: 0.08, patternStrength: 0.3 },
  { id: "ripstop-tech-olive", label: "Ripstop tech shell", weave: "technical-ripstop", pattern: "ripstop-grid", repeats: 6, roughness: 0.65, sheen: 0.32, metalness: 0.1, patternStrength: 0.45 },
  { id: "recycled-knit-sage", label: "Recycled knit", weave: "recycled-knit", pattern: "rib-knit", repeats: 8, roughness: 0.88, sheen: 0.08, metalness: 0, patternStrength: 0.3 },
  { id: "merino-jersey-stone", label: "Stone merino jersey", weave: "merino-jersey", pattern: "plain", repeats: 10, roughness: 0.78, sheen: 0.18, metalness: 0.02, patternStrength: 0.05 },
  { id: "camo-panel-shell", label: "Repair-panelled camo shell", weave: "bio-nylon", pattern: "camo-panel", repeats: 4, roughness: 0.7, sheen: 0.25, metalness: 0.08, patternStrength: 0.6 },
];

/** Every fabric recipe by id. */
export const FABRICS: Readonly<Record<string, FabricSpec>> = Object.freeze(
  Object.fromEntries(FABRIC_LIST.map((fabric) => [fabric.id, Object.freeze(fabric)] as const)),
);

/* -------------------------------------------------------------------------- */
/* Era wardrobes                                                              */
/* -------------------------------------------------------------------------- */

/** Per-era detail layer: hair, fabrics and the accessories layered above a rule. */
export interface EraWardrobe {
  /** Hair styles this era's crowd draws from. */
  readonly hairStyles: readonly HairStyleId[];
  /** Hair colours sampled per figure (greys added for seniors). */
  readonly hairColors: readonly number[];
  /** Era-typical hats, used when the outfit rule itself carries no hat. */
  readonly fallbackHats: readonly string[];
  readonly fallbackEyewear: readonly string[];
  readonly fallbackBags: readonly string[];
  /** Always-on footwear pool, sampled when the rule names no shoes. */
  readonly footwear: readonly string[];
  /** Personal-device pool scaled by `descriptor.gadgetUse`. */
  readonly devices: readonly string[];
  readonly fabrics: readonly string[];
  /** Human-readable era tells, surfaced in outlines and the HUD. */
  readonly signatures: readonly string[];
}

export const ERA_WARDROBE = {
  "1945": {
    hairStyles: ["victory-rolls", "brylcreemed-side-part", "pin-curls", "schoolboy-crop"],
    hairColors: [0x2b2320, 0x4a3a2c, 0x6b5340, 0x8a7f75],
    fallbackHats: ["fedora", "flat-cap", "head-scarf"],
    fallbackEyewear: ["spectacles"],
    fallbackBags: ["canvas-satchel", "ration-book-bag"],
    footwear: ["oxford-shoes", "leather-boots", "ballet-flats"],
    devices: [],
    fabrics: ["wool-worsted-charcoal", "tweed-brown-check", "utility-poplin-tan", "leather-oxblood", "gabardine-tan"],
    signatures: ["fedora", "wide-lapel-suit", "trench-coat", "tea-dress", "utility-clothing"],
  },
  "1965": {
    hairStyles: ["bouffant", "mop-top", "beehive", "mod-crop"],
    hairColors: [0x2f2a26, 0x5a4630, 0x8a6a3f, 0xc2a15f],
    fallbackHats: ["pillbox-hat", "patterned-headscarf", "peaked-cap"],
    fallbackEyewear: ["oversized-sunglasses"],
    fallbackBags: ["patent-bag", "clutch-bag"],
    footwear: ["wingtip-shoes", "ballet-flats", "court-shoes"],
    devices: ["transistor-radio"],
    fabrics: ["cotton-poplin-sorbet", "mohair-pinstripe", "patent-pvc-white", "gabardine-tan"],
    signatures: ["mod-suit", "pillbox-hat", "a-line-dress", "shift-dress", "space-age-pop"],
  },
  "1985": {
    hairStyles: ["big-perm", "mullet", "feathered-bob", "flat-top"],
    hairColors: [0x33261e, 0x6f4a2c, 0xb07a3f, 0xd8c07a],
    fallbackHats: ["rain-hat", "sweatband", "backwards-cap"],
    fallbackEyewear: ["mirrored-aviators"],
    fallbackBags: ["bum-bag", "fanny-pack"],
    footwear: ["high-top-sneakers", "court-shoes", "running-shoes"],
    devices: ["walkman"],
    fabrics: ["neon-nylon-taffeta", "denim-indigo", "wool-worsted-charcoal", "leather-oxblood", "terry-sweat-fleece"],
    signatures: ["bright-sportswear", "denim", "power-suit", "trench-coat", "neon"],
  },
  "2005": {
    hairStyles: ["frosted-tips", "straight-layered", "buzz-cut", "pulled-back-ponytail"],
    hairColors: [0x2a2422, 0x6b4f38, 0xb08a5f, 0xdcd0b0],
    fallbackHats: ["trucker-cap", "beanie-knit"],
    fallbackEyewear: ["tinted-shades"],
    fallbackBags: ["laptop-bag", "satchel"],
    footwear: ["canvas-sneakers", "running-shoes", "sport-sandals"],
    devices: ["flip-phone", "mp3-player"],
    fabrics: ["cotton-jersey-grey", "cargo-canvas-khaki", "denim-indigo", "technical-softshell", "terry-sweat-fleece"],
    signatures: ["casual-jeans", "hoodie", "business-casual", "low-rise-denim", "track-pants"],
  },
  "2025": {
    hairStyles: ["undercut-fade", "sleek-bun", "natural-curls", "shaved-side-part"],
    hairColors: [0x1f1b1a, 0x4a3a30, 0xcbb894, 0x9a9ea3],
    fallbackHats: ["e-bike-helmet", "beanie-knit", "sun-visor"],
    fallbackEyewear: ["smart-glasses"],
    fallbackBags: ["crossbody-sling", "solar-daypack", "sustainable-tote"],
    footwear: ["chunky-trainers", "trail-sneakers", "derby-shoes"],
    devices: ["smartphone", "wireless-charger"],
    fabrics: ["ripstop-tech-olive", "recycled-knit-sage", "merino-jersey-stone", "camo-panel-shell", "technical-softshell"],
    signatures: ["techwear", "layered-synthetics", "smart-accessories", "upcycled-outdoor", "athleisure"],
  },
} as const satisfies Readonly<Record<EraId, EraWardrobe>>;

/* -------------------------------------------------------------------------- */
/* Accessory catalog                                                          */
/* -------------------------------------------------------------------------- */

/** Rig slot an accessory occupies; each slot owns exactly one tunable detail. */
export type AccessorySlot =
  | "hat"
  | "eyewear"
  | "neck"
  | "hands"
  | "wrist"
  | "audio"
  | "overlayer"
  | "bag"
  | "carried"
  | "support"
  | "footwear";

/** Canonical slot order, used by resolution, rigging and inspection. */
export const ACCESSORY_SLOTS = [
  "hat",
  "eyewear",
  "neck",
  "hands",
  "wrist",
  "audio",
  "overlayer",
  "bag",
  "carried",
  "support",
  "footwear",
] as const satisfies readonly AccessorySlot[];

/** Rig parameter that switches a slot on and morphs its presence weight. */
export const SLOT_WEIGHT_KEYS = {
  hat: "hatWeight",
  eyewear: "eyewearWeight",
  neck: "neckWeight",
  hands: "handsWeight",
  wrist: "wristWeight",
  audio: "audioWeight",
  overlayer: "overlayerWeight",
  bag: "bagWeight",
  carried: "carriedWeight",
  support: "supportWeight",
  footwear: "footwearWeight",
} as const satisfies Readonly<Record<AccessorySlot, keyof FigureRigParams>>;

/**
 * One accessory a pedestrian can wear or carry.
 *
 * `style` selects a shape from the matching style table (hat, bag, footwear);
 * `params` carries the rig overrides for every other slot. Ids are identical
 * to the accessory strings used by the era dataset, so a crowd never wears
 * anything the era contract does not name.
 */
export interface AccessorySpec {
  readonly id: string;
  readonly slot: AccessorySlot;
  readonly label: string;
  readonly color: number;
  readonly accent: number;
  readonly style?: string;
  readonly params?: FigureParamPatch;
}

export const ACCESSORY_CATALOG: Readonly<Record<string, AccessorySpec>> = Object.freeze({
  /* Headwear */
  fedora: { id: "fedora", slot: "hat", label: "Fedora", style: "fedora", color: 0x4a3a2c, accent: 0x2b2320 },
  "flat-cap": { id: "flat-cap", slot: "hat", label: "Flat cap", style: "flat-cap", color: 0x5b4a3f, accent: 0x3a2f28 },
  "head-scarf": { id: "head-scarf", slot: "hat", label: "Head scarf", style: "head-scarf", color: 0xa89a80, accent: 0x6f5d52 },
  "patterned-headscarf": { id: "patterned-headscarf", slot: "hat", label: "Patterned headscarf", style: "patterned-headscarf", color: 0xbf5f8f, accent: 0xf0d24a },
  "peaked-cap": { id: "peaked-cap", slot: "hat", label: "Peaked cap", style: "peaked-cap", color: 0x39463a, accent: 0x8a7f5f },
  "pillbox-hat": { id: "pillbox-hat", slot: "hat", label: "Pillbox hat", style: "pillbox-hat", color: 0xf0a63c, accent: 0xe0562f },
  "rain-hat": { id: "rain-hat", slot: "hat", label: "Rain hat", style: "rain-hat", color: 0x4a4f52, accent: 0x2b2f3a },
  "trucker-cap": { id: "trucker-cap", slot: "hat", label: "Trucker cap", style: "trucker-cap", color: 0x2f7fbf, accent: 0xdfe3e6 },
  "backwards-cap": { id: "backwards-cap", slot: "hat", label: "Backwards cap", style: "backwards-cap", color: 0xc23f5f, accent: 0x8f9aa6 },
  "e-bike-helmet": { id: "e-bike-helmet", slot: "hat", label: "E-bike helmet", style: "e-bike-helmet", color: 0x2b2f3a, accent: 0x54d69a },
  "beanie-knit": { id: "beanie-knit", slot: "hat", label: "Knit beanie", style: "beanie-knit", color: 0x6f5d52, accent: 0xcbb894 },
  sweatband: { id: "sweatband", slot: "hat", label: "Terry sweatband", style: "sweatband", color: 0xff5fc8, accent: 0x2ad4d4 },
  "sun-visor": { id: "sun-visor", slot: "hat", label: "Sun visor", style: "sun-visor", color: 0xdfe6e0, accent: 0x9aa39c },

  /* Eyewear */
  "oversized-sunglasses": { id: "oversized-sunglasses", slot: "eyewear", label: "Oversized sunglasses", color: 0x1b1f26, accent: 0xd8d4cb, params: { eyewearWidth: 0.2, eyewearLensHeight: 0.055, eyewearWrap: 0.5 } },
  spectacles: { id: "spectacles", slot: "eyewear", label: "Spectacles", color: 0x4a4034, accent: 0xb0a082, params: { eyewearWidth: 0.15, eyewearLensHeight: 0.036, eyewearWrap: 0.15 } },
  "mirrored-aviators": { id: "mirrored-aviators", slot: "eyewear", label: "Mirrored aviators", color: 0xc9d4dd, accent: 0x8f9aa6, params: { eyewearWidth: 0.17, eyewearLensHeight: 0.05, eyewearWrap: 0.35 } },
  "tinted-shades": { id: "tinted-shades", slot: "eyewear", label: "Tinted shades", color: 0x3a2f2a, accent: 0x8a7f5f, params: { eyewearWidth: 0.16, eyewearLensHeight: 0.038, eyewearWrap: 0.25 } },
  "smart-glasses": { id: "smart-glasses", slot: "eyewear", label: "Smart glasses", color: 0x20262b, accent: 0x54d69a, params: { eyewearWidth: 0.18, eyewearLensHeight: 0.04, eyewearWrap: 0.3 } },

  /* Neckwear */
  "skinny-tie": { id: "skinny-tie", slot: "neck", label: "Skinny tie", color: 0x2f3a4a, accent: 0xdfe3e6, params: { neckDrop: 0.34, neckBeads: 0 } },
  "beaded-necklace": { id: "beaded-necklace", slot: "neck", label: "Beaded necklace", color: 0xf0d24a, accent: 0xbf5f8f, params: { neckDrop: 0.07, neckBeads: 1 } },
  "dog-tags": { id: "dog-tags", slot: "neck", label: "Dog tags", color: 0xb0b6bd, accent: 0x6f7480, params: { neckDrop: 0.12, neckBeads: 0.35 } },
  lanyard: { id: "lanyard", slot: "neck", label: "Lanyard", color: 0x2f7fbf, accent: 0xdfe3e6, params: { neckDrop: 0.22, neckBeads: 0.3 } },

  /* Gloves and wristwear */
  "leather-gloves": { id: "leather-gloves", slot: "hands", label: "Leather gloves", color: 0x3a2a24, accent: 0x6b5b45, params: { handsCuff: 0.6 } },
  smartwatch: { id: "smartwatch", slot: "wrist", label: "Smartwatch", color: 0x22262b, accent: 0x54d69a, params: { wristFaceWidth: 1.2 } },

  /* Head-worn audio */
  earbuds: { id: "earbuds", slot: "audio", label: "Wired earbuds", color: 0x1f1f22, accent: 0x8f9aa6, params: { audioPodRadius: 0.022, audioBandDrop: 0 } },
  "bone-conduction-earbuds": { id: "bone-conduction-earbuds", slot: "audio", label: "Bone-conduction earbuds", color: 0x2b3036, accent: 0x54d69a, params: { audioPodRadius: 0.026, audioBandDrop: 0.05 } },

  /* Over-layers */
  windbreaker: { id: "windbreaker", slot: "overlayer", label: "Windbreaker", color: 0x2ad4d4, accent: 0xffd24a, params: { overlayerBulk: 1.06, overlayerLength: 1, overlayerCollar: 1 } },
  "shoulder-pad-blazer": { id: "shoulder-pad-blazer", slot: "overlayer", label: "Shoulder-pad blazer", color: 0x1f2430, accent: 0xc2a15f, params: { overlayerBulk: 1.01, overlayerLength: 0.7, overlayerCollar: 0.8 } },
  "running-vest": { id: "running-vest", slot: "overlayer", label: "Running vest", color: 0xff5fc8, accent: 0xe0e4dd, params: { overlayerBulk: 0.92, overlayerLength: 0.6, overlayerCollar: 0.2 } },

  /* Bags */
  "canvas-satchel": { id: "canvas-satchel", slot: "bag", label: "Canvas satchel", style: "canvas-satchel", color: 0x8a7f5f, accent: 0x4a3a2c },
  "ration-book-bag": { id: "ration-book-bag", slot: "bag", label: "Ration book bag", style: "ration-book-bag", color: 0x6f6a52, accent: 0x3a3f4a },
  "canvas-duffel": { id: "canvas-duffel", slot: "bag", label: "Canvas duffel", style: "canvas-duffel", color: 0x4a5a48, accent: 0x39463a },
  satchel: { id: "satchel", slot: "bag", label: "Leather satchel", style: "satchel", color: 0x5b4a3f, accent: 0x3a2f28 },
  "patent-bag": { id: "patent-bag", slot: "bag", label: "Patent handbag", style: "patent-bag", color: 0xdfe3e6, accent: 0xbf5f8f },
  "attache-case": { id: "attache-case", slot: "bag", label: "Attache case", style: "attache-case", color: 0x4a3a2c, accent: 0xc2a15f },
  "clutch-bag": { id: "clutch-bag", slot: "bag", label: "Clutch bag", style: "clutch-bag", color: 0xf0d24a, accent: 0x8f7a4a },
  "lunch-pail": { id: "lunch-pail", slot: "bag", label: "Lunch pail", style: "lunch-pail", color: 0x8f9aa6, accent: 0x4a5560 },
  "bum-bag": { id: "bum-bag", slot: "bag", label: "Bum bag", style: "bum-bag", color: 0xc23f5f, accent: 0x2f3a4a },
  briefcase: { id: "briefcase", slot: "bag", label: "Briefcase", style: "briefcase", color: 0x1f2430, accent: 0xc2a15f },
  "fanny-pack": { id: "fanny-pack", slot: "bag", label: "Fanny pack", style: "fanny-pack", color: 0x2ad4d4, accent: 0xff5fc8 },
  "laptop-bag": { id: "laptop-bag", slot: "bag", label: "Laptop bag", style: "laptop-bag", color: 0x3a3f4a, accent: 0xb8bcc4 },
  "crossbody-sling": { id: "crossbody-sling", slot: "bag", label: "Crossbody sling", style: "crossbody-sling", color: 0x2b2f3a, accent: 0x54d69a },
  "sustainable-tote": { id: "sustainable-tote", slot: "bag", label: "Recycled tote", style: "sustainable-tote", color: 0xcbb894, accent: 0x4f6f5f },
  "solar-daypack": { id: "solar-daypack", slot: "bag", label: "Solar daypack", style: "solar-daypack", color: 0x4f6f5f, accent: 0xa85f2f },

  /* Carried items */
  walkman: { id: "walkman", slot: "carried", label: "Walkman", color: 0x2f3a4a, accent: 0x8f9aa6, params: { carriedWidth: 0.08, carriedHeight: 0.12, carriedDepth: 0.035 } },
  "brick-mobile-phone": { id: "brick-mobile-phone", slot: "carried", label: "Brick mobile phone", color: 0x1f2430, accent: 0xc2a15f, params: { carriedWidth: 0.05, carriedHeight: 0.22, carriedDepth: 0.05 } },
  "mp3-player": { id: "mp3-player", slot: "carried", label: "MP3 player", color: 0xdfe3e6, accent: 0x2f7fbf, params: { carriedWidth: 0.05, carriedHeight: 0.085, carriedDepth: 0.02 } },
  "flip-phone": { id: "flip-phone", slot: "carried", label: "Flip phone", color: 0x8f9aa6, accent: 0x2f3a4a, params: { carriedWidth: 0.045, carriedHeight: 0.09, carriedDepth: 0.022 } },
  smartphone: { id: "smartphone", slot: "carried", label: "Smartphone", color: 0x1b1f26, accent: 0x54d69a, params: { carriedWidth: 0.07, carriedHeight: 0.14, carriedDepth: 0.012 } },
  pager: { id: "pager", slot: "carried", label: "Pager", color: 0x2b2f3a, accent: 0x8f9aa6, params: { carriedWidth: 0.045, carriedHeight: 0.07, carriedDepth: 0.02 } },
  "digital-camera": { id: "digital-camera", slot: "carried", label: "Digital camera", color: 0x3a3f4a, accent: 0xc2c7cc, params: { carriedWidth: 0.11, carriedHeight: 0.075, carriedDepth: 0.06 } },
  "insulated-bottle": { id: "insulated-bottle", slot: "carried", label: "Insulated bottle", color: 0x35504a, accent: 0xd8d4cb, params: { carriedWidth: 0.065, carriedHeight: 0.2, carriedDepth: 0.065 } },
  "wireless-charger": { id: "wireless-charger", slot: "carried", label: "Wireless charger", color: 0xe0e4dd, accent: 0x9aa39c, params: { carriedWidth: 0.09, carriedHeight: 0.09, carriedDepth: 0.014 } },
  "transistor-radio": { id: "transistor-radio", slot: "carried", label: "Transistor radio", color: 0x8a7f5f, accent: 0xc2a15f, params: { carriedWidth: 0.12, carriedHeight: 0.09, carriedDepth: 0.05 } },

  /* Support props */
  "walking-cane": { id: "walking-cane", slot: "support", label: "Walking cane", color: 0x5a3f2c, accent: 0xc2a15f, params: { supportLength: 0.86 } },

  /* Footwear */
  "oxford-shoes": { id: "oxford-shoes", slot: "footwear", label: "Oxford shoes", style: "oxford-shoes", color: 0x2b2320, accent: 0x6b5b45 },
  "leather-boots": { id: "leather-boots", slot: "footwear", label: "Leather boots", style: "leather-boots", color: 0x4a3a2c, accent: 0x2b2320 },
  "wingtip-shoes": { id: "wingtip-shoes", slot: "footwear", label: "Wingtip shoes", style: "wingtip-shoes", color: 0x5b4a3f, accent: 0x2b2320 },
  "ballet-flats": { id: "ballet-flats", slot: "footwear", label: "Ballet flats", style: "ballet-flats", color: 0xd8d4cb, accent: 0x8f9aa6 },
  "steel-toe-boots": { id: "steel-toe-boots", slot: "footwear", label: "Steel-toe boots", style: "steel-toe-boots", color: 0x7a5a3a, accent: 0x3a3f4a },
  "high-top-sneakers": { id: "high-top-sneakers", slot: "footwear", label: "High-top sneakers", style: "high-top-sneakers", color: 0xe0e4dd, accent: 0xc23f5f },
  "court-shoes": { id: "court-shoes", slot: "footwear", label: "Court shoes", style: "court-shoes", color: 0xdfe3e6, accent: 0x6b5f70 },
  "canvas-sneakers": { id: "canvas-sneakers", slot: "footwear", label: "Canvas sneakers", style: "canvas-sneakers", color: 0x4f6f9f, accent: 0xdfe3e6 },
  "running-shoes": { id: "running-shoes", slot: "footwear", label: "Running shoes", style: "running-shoes", color: 0x8f9aa6, accent: 0xc26f5f },
  loafers: { id: "loafers", slot: "footwear", label: "Loafers", style: "loafers", color: 0x5f4a3a, accent: 0x2b2320 },
  "sport-sandals": { id: "sport-sandals", slot: "footwear", label: "Sport sandals", style: "sport-sandals", color: 0x6f8f6a, accent: 0xd8d4cb },
  "chunky-trainers": { id: "chunky-trainers", slot: "footwear", label: "Chunky trainers", style: "chunky-trainers", color: 0xe0e4dd, accent: 0x54d69a },
  "derby-shoes": { id: "derby-shoes", slot: "footwear", label: "Derby shoes", style: "derby-shoes", color: 0x3a2f28, accent: 0xb0a082 },
  "trail-sneakers": { id: "trail-sneakers", slot: "footwear", label: "Trail sneakers", style: "trail-sneakers", color: 0xa85f2f, accent: 0x4f6f5f },
} as const satisfies Readonly<Record<string, AccessorySpec>>);

/** Extracts the parameter patch of every style in a style table. */
function styleParams<T extends string>(table: Readonly<Record<T, StyleSpec>>): Readonly<Record<string, FigureParamPatch>> {
  const patches: Record<string, FigureParamPatch> = {};
  for (const [id, style] of Object.entries(table) as [string, StyleSpec][]) {
    patches[id] = style.params;
  }
  return patches;
}

/** Style tables by slot, so a catalog entry only has to name its shape. */
const STYLE_TABLES: Readonly<Partial<Record<AccessorySlot, Readonly<Record<string, FigureParamPatch>>>>> = {
  hat: styleParams(HAT_STYLES),
  bag: styleParams(BAG_STYLES),
  footwear: styleParams(FOOTWEAR_STYLES),
};

/**
 * Pre-resolved rig patch per accessory: style shape, direct overrides and the
 * final `1` presence weight for its slot. Built once at module load, so
 * per-figure resolution is a handful of object merges with no per-frame work.
 */
const ACCESSORY_PARAMS: Readonly<Record<string, FigureParamPatch>> = buildAccessoryParams();

function buildAccessoryParams(): Readonly<Record<string, FigureParamPatch>> {
  const params: Record<string, FigureParamPatch> = {};
  for (const spec of Object.values(ACCESSORY_CATALOG)) {
    const stylePatch = spec.style ? STYLE_TABLES[spec.slot]?.[spec.style] : undefined;
    const patch: FigureParamPatch = { ...stylePatch, ...spec.params };
    patch[SLOT_WEIGHT_KEYS[spec.slot]] = 1;
    params[spec.id] = Object.freeze(patch);
  }
  return Object.freeze(params);
}

/** Public alias of the deterministic sampler, used by routing code. */
export function deterministicSample(seed: number, salt: string): number {
  return sample(seed, salt);
}

/* -------------------------------------------------------------------------- */
/* Appearance resolution                                                      */
/* -------------------------------------------------------------------------- */

/** Life stage a figure is drawn from, per `AgeMix`. */
export type AgeBracket = "child" | "adult" | "senior";

/** Body scale per age bracket, applied through `heightScale`. */
export const AGE_BODY_SCALE = { child: 0.64, adult: 1, senior: 0.96 } as const satisfies Readonly<Record<AgeBracket, number>>;

/** Walking-speed factor per age bracket. */
export const AGE_SPEED_FACTOR = { child: 0.88, adult: 1, senior: 0.8 } as const satisfies Readonly<Record<AgeBracket, number>>;

/** Skin tones sampled per figure. */
export const SKIN_TONES = [0xf2d3bd, 0xe4b48f, 0xc98f63, 0xa9714a, 0x82513a, 0x5f3a28] as const;

/** Grey a senior's hair blends towards. */
export const GREY_HAIR = 0xb8bcc4;

/** How much grey a senior's hair takes on. */
export const SENIOR_GREY_BLEND = 0.65;

/** Draws a life stage from an era `AgeMix`, deterministically. */
export function pickAgeBracket(mix: AgeMix, seed: number): AgeBracket {
  const roll = sample(seed, "age-bracket");
  if (roll < mix.child) {
    return "child";
  }
  return roll < mix.child + mix.adult ? "adult" : "senior";
}

/** Draws an outfit rule from the era wardrobe, weighted by rule share. */
export function pickOutfitRule(rules: readonly OutfitRule[], seed: number): OutfitRule {
  const roll = sample(seed, "outfit-rule");
  let cumulative = 0;
  for (const rule of rules) {
    cumulative += rule.share;
    if (roll < cumulative) {
      return rule;
    }
  }
  return rules[rules.length - 1]!;
}

/** One accessory placed on a figure, with its provenance. */
export interface ResolvedAccessory {
  readonly spec: AccessorySpec;
  /** `outfit` when the era outfit rule named it, else the era detail layer. */
  readonly source: "outfit" | "wardrobe";
}

/** Accessory per rig slot; `null` means the figure wears nothing there. */
export type AccessorySlotState = Readonly<Record<AccessorySlot, ResolvedAccessory | null>>;

/**
 * Fully resolved look for one figure in one era.
 *
 * `parameters` and `colors` are complete (nothing is left to inherit), so
 * blending two appearances is a single numeric pass and the rig can be updated
 * without any further lookups.
 */
export interface FigureAppearance {
  readonly eraId: EraId;
  readonly seed: number;
  readonly ageBracket: AgeBracket;
  readonly outfitId: string;
  readonly outfitShare: number;
  readonly outfitAccessories: readonly string[];
  readonly silhouette: SilhouetteId;
  readonly coverage: number;
  readonly fabric: FabricSpec;
  readonly hairStyle: HairStyleId;
  readonly accessorySlots: AccessorySlotState;
  readonly accessoryIds: readonly string[];
  readonly parameters: FigureRigParams;
  readonly colors: FigureColors;
  readonly signatures: readonly string[];
  readonly seasonalWear: string;
}

function createEmptySlots(): Record<AccessorySlot, ResolvedAccessory | null> {
  const slots = {} as Record<AccessorySlot, ResolvedAccessory | null>;
  for (const slot of ACCESSORY_SLOTS) {
    slots[slot] = null;
  }
  return slots;
}

/** Fills a still-empty slot from an era detail pool, at the given chance. */
function fillSlot(
  slots: Record<AccessorySlot, ResolvedAccessory | null>,
  slot: AccessorySlot,
  pool: readonly string[],
  seed: number,
  salt: string,
  chance: number,
): void {
  if (slots[slot] || pool.length === 0 || sample(seed, salt) >= chance) {
    return;
  }
  const spec = ACCESSORY_CATALOG[pick(pool, seed, `${salt}-id`)];
  if (spec && spec.slot === slot) {
    slots[slot] = { spec, source: "wardrobe" };
  }
}

/**
 * Resolves the complete look for figure `seed` in `era`.
 *
 * Outfit rules, silhouettes, palettes and accessory lists come straight from
 * the frozen era contract; this function only turns them into rig parameters,
 * colours and fabric choices, then layers the era's hair and detail pool (plus
 * `gadgetUse`-scaled personal devices) on top.
 */
export function resolveFigureAppearance(era: EraId, seed: number): FigureAppearance {
  const descriptor = getEraConfig(era).pedestrians;
  const wardrobe = ERA_WARDROBE[era];
  const rule = pickOutfitRule(descriptor.outfits, seed);
  const ageBracket = pickAgeBracket(descriptor.ageMix, seed);

  const slots = createEmptySlots();
  for (const id of rule.accessories) {
    const spec = ACCESSORY_CATALOG[id];
    if (spec && !slots[spec.slot]) {
      slots[spec.slot] = { spec, source: "outfit" };
    }
  }
  fillSlot(slots, "hat", wardrobe.fallbackHats, seed, "hat-fallback", 0.55);
  fillSlot(slots, "eyewear", wardrobe.fallbackEyewear, seed, "eyewear-fallback", 0.4);
  fillSlot(slots, "bag", wardrobe.fallbackBags, seed, "bag-fallback", 0.6);
  fillSlot(slots, "footwear", wardrobe.footwear, seed, "footwear-fallback", 1);
  fillSlot(slots, "carried", wardrobe.devices, seed, "device-fallback", descriptor.gadgetUse);
  const caneChance = ageBracket === "senior" ? 0.7 : ageBracket === "adult" ? 0.05 : 0;
  if (!slots.support && sample(seed, "support") < caneChance) {
    slots.support = { spec: ACCESSORY_CATALOG["walking-cane"]!, source: "wardrobe" };
  }

  const fabric = FABRICS[pick(wardrobe.fabrics, seed, "fabric")]!;
  const hairStyle = pick(wardrobe.hairStyles, seed, "hair-style");

  let parameters = withOverrides(
    BASE_RIG_PARAMS,
    SILHOUETTE_SHAPES[rule.silhouette],
    ...ACCESSORY_SLOTS.map((slot) => (slots[slot] ? ACCESSORY_PARAMS[slots[slot]!.spec.id] : undefined)),
    HAIR_STYLES[hairStyle].params,
    {
      coverage: rule.coverage,
      patternStrength: fabric.patternStrength,
      fabricRoughness: fabric.roughness,
      fabricSheen: fabric.sheen,
      fabricMetalness: fabric.metalness,
    } satisfies FigureParamPatch,
  );
  parameters = modulateParams(
    parameters,
    {
      heightScale: AGE_BODY_SCALE[ageBracket] * (0.95 + sample(seed, "height") * 0.1),
      torsoWidth: 0.96 + sample(seed, "torso-width") * 0.09,
      sleeveWidth: 0.92 + sample(seed, "sleeve-width") * 0.16,
      hemFlare: 0.85 + sample(seed, "hem-flare") * 0.3,
      hairVolume: 0.85 + sample(seed, "hair-volume") * 0.3,
      bagSway: 0.7 + sample(seed, "bag-sway") * 0.6,
    },
    {
      waistCinched: (sample(seed, "waist") - 0.5) * 0.12,
      hatBrimTilt: (sample(seed, "hat-tilt") - 0.5) * 0.08,
    },
  );

  const palette = rule.palette;
  const hairBase = pick(wardrobe.hairColors, seed, "hair-color");
  const trouserColor = pick(palette, seed, "trousers");
  const colors: FigureColors = {
    skin: pick(SKIN_TONES, seed, "skin"),
    hair: ageBracket === "senior" ? blendHexColors(hairBase, GREY_HAIR, SENIOR_GREY_BLEND) : hairBase,
    garment: pick(palette, seed, "garment"),
    garmentAccent: pick(palette, seed, "garment-accent"),
    trousers: trouserColor,
    footwear: slots.footwear ? slots.footwear.spec.color : blendHexColors(trouserColor, 0x1b1f26, 0.5),
    headwear: slots.hat ? slots.hat.spec.color : pick(palette, seed, "hat-accent"),
    bag: slots.bag ? slots.bag.spec.color : trouserColor,
    glove: slots.hands ? slots.hands.spec.color : BASE_FIGURE_COLORS.glove,
    metal: 0xc2c7cc,
    eye: 0x2b2f3a,
    lens: slots.eyewear ? slots.eyewear.spec.color : 0x1b2026,
    support: slots.support ? slots.support.spec.color : 0x5a3f2c,
  };

  const accessoryIds = ACCESSORY_SLOTS
    .map((slot) => slots[slot]?.spec.id)
    .filter((id): id is string => typeof id === "string");

  return {
    eraId: era,
    seed,
    ageBracket,
    outfitId: rule.id,
    outfitShare: rule.share,
    outfitAccessories: rule.accessories,
    silhouette: rule.silhouette,
    coverage: rule.coverage,
    fabric,
    hairStyle,
    accessorySlots: slots,
    accessoryIds,
    parameters,
    colors,
    signatures: wardrobe.signatures,
    seasonalWear: descriptor.seasonalWear,
  };
}

/**
 * Blends two resolved appearances.
 *
 * Discrete choices (outfit id, silhouette, fabric, hair, accessories) come
 * from whichever side is dominant at `progress`, while rig parameters and
 * colours interpolate continuously. The rig cross-fades the two fabrics, so
 * the switch at the midpoint is never visible as a pop.
 */
export function blendAppearances(from: FigureAppearance, to: FigureAppearance, progress: number): FigureAppearance {
  const t = clampUnit(progress);
  const dominant = t < 0.5 ? from : to;
  return {
    eraId: dominant.eraId,
    seed: from.seed,
    ageBracket: from.ageBracket,
    outfitId: dominant.outfitId,
    outfitShare: dominant.outfitShare,
    outfitAccessories: dominant.outfitAccessories,
    silhouette: dominant.silhouette,
    coverage: from.coverage + (to.coverage - from.coverage) * t,
    fabric: dominant.fabric,
    hairStyle: dominant.hairStyle,
    accessorySlots: dominant.accessorySlots,
    accessoryIds: dominant.accessoryIds,
    parameters: blendRigParams(from.parameters, to.parameters, t),
    colors: blendColors(from.colors, to.colors, t),
    signatures: dominant.signatures,
    seasonalWear: dominant.seasonalWear,
  };
}

/** Read-only, HUD-friendly description of one appearance. */
export interface PedestrianLookSummary {
  readonly eraId: EraId;
  readonly outfitId: string;
  readonly silhouette: SilhouetteId;
  readonly fabricId: string;
  readonly fabricLabel: string;
  readonly hairStyle: HairStyleId;
  readonly hairLabel: string;
  readonly slotLabels: Readonly<Record<AccessorySlot, string | null>>;
  readonly accessoryIds: readonly string[];
  readonly signatures: readonly string[];
}

/** Flattens an appearance into labels for inspection and HUD captions. */
export function describeLook(appearance: FigureAppearance): PedestrianLookSummary {
  const slotLabels = {} as Record<AccessorySlot, string | null>;
  for (const slot of ACCESSORY_SLOTS) {
    slotLabels[slot] = appearance.accessorySlots[slot]?.spec.label ?? null;
  }
  return {
    eraId: appearance.eraId,
    outfitId: appearance.outfitId,
    silhouette: appearance.silhouette,
    fabricId: appearance.fabric.id,
    fabricLabel: appearance.fabric.label,
    hairStyle: appearance.hairStyle,
    hairLabel: HAIR_STYLES[appearance.hairStyle].label,
    slotLabels,
    accessoryIds: appearance.accessoryIds,
    signatures: appearance.signatures,
  };
}

/**
 * Every accessory id the era dataset or an era wardrobe references but the
 * catalog cannot build. Empty in a healthy build; asserted by tests so a new
 * era accessory can never silently disappear from the crowd.
 */
export function missingAccessoryIds(): readonly string[] {
  const missing = new Set<string>();
  const requireAccessory = (id: string): void => {
    if (!ACCESSORY_CATALOG[id]) {
      missing.add(id);
    }
  };
  for (const era of ERAS) {
    for (const rule of era.pedestrians.outfits) {
      for (const id of rule.accessories) {
        requireAccessory(id);
      }
    }
  }
  for (const wardrobe of Object.values(ERA_WARDROBE)) {
    const pools: readonly (readonly string[])[] = [
      wardrobe.fallbackHats,
      wardrobe.fallbackEyewear,
      wardrobe.fallbackBags,
      wardrobe.footwear,
      wardrobe.devices,
    ];
    for (const pool of pools) {
      for (const id of pool) {
        requireAccessory(id);
      }
    }
  }
  return [...missing].sort();
}

/* -------------------------------------------------------------------------- */
/* Procedural fabric textures                                                 */
/* -------------------------------------------------------------------------- */

/** Which half of a fabric's look a texture carries. */
export type FabricTextureFlavour = "weave" | "pattern";

/** How the fabric pixels reached the GPU. */
export type FabricTextureTransport = "canvas-2d" | "data-texture";

/** Default fabric texture edge length in pixels. */
export const FABRIC_TEXTURE_SIZE = 64;

/** Per-weave pixel recipe for the procedural cloth painter. */
interface WeaveProfile {
  readonly threadsU: number;
  readonly threadsV: number;
  readonly angle: number;
  readonly contrast: number;
  readonly slub: number;
  readonly hole: number;
}

const WEAVE_PROFILES: Readonly<Record<FabricWeave, WeaveProfile>> = {
  "worsted-wool": { threadsU: 24, threadsV: 24, angle: 0, contrast: 0.16, slub: 0.08, hole: 0 },
  tweed: { threadsU: 11, threadsV: 9, angle: 0.1, contrast: 0.34, slub: 0.42, hole: 0 },
  "utility-poplin": { threadsU: 30, threadsV: 30, angle: 0, contrast: 0.1, slub: 0.05, hole: 0 },
  "leather-grain": { threadsU: 40, threadsV: 36, angle: 0.3, contrast: 0.07, slub: 0.18, hole: 0 },
  gabardine: { threadsU: 26, threadsV: 26, angle: 0.25, contrast: 0.14, slub: 0.06, hole: 0 },
  "cotton-poplin": { threadsU: 26, threadsV: 26, angle: 0, contrast: 0.11, slub: 0.06, hole: 0 },
  mohair: { threadsU: 18, threadsV: 18, angle: 0.05, contrast: 0.13, slub: 0.14, hole: 0 },
  "patent-pvc": { threadsU: 8, threadsV: 8, angle: 0.6, contrast: 0.05, slub: 0.02, hole: 0 },
  "steel-denim": { threadsU: 20, threadsV: 20, angle: 0.32, contrast: 0.2, slub: 0.1, hole: 0 },
  "nylon-taffeta": { threadsU: 34, threadsV: 30, angle: 0.15, contrast: 0.12, slub: 0.04, hole: 0 },
  "terry-knit": { threadsU: 16, threadsV: 16, angle: 0, contrast: 0.22, slub: 0.3, hole: 0.05 },
  "cotton-jersey": { threadsU: 22, threadsV: 22, angle: 0.05, contrast: 0.12, slub: 0.12, hole: 0 },
  "cargo-canvas": { threadsU: 14, threadsV: 14, angle: 0, contrast: 0.2, slub: 0.16, hole: 0 },
  "technical-softshell": { threadsU: 28, threadsV: 28, angle: 0.2, contrast: 0.1, slub: 0.05, hole: 0 },
  "technical-ripstop": { threadsU: 12, threadsV: 12, angle: 0.1, contrast: 0.14, slub: 0.05, hole: 0 },
  "recycled-knit": { threadsU: 20, threadsV: 18, angle: 0, contrast: 0.16, slub: 0.2, hole: 0 },
  "merino-jersey": { threadsU: 24, threadsV: 24, angle: 0.04, contrast: 0.1, slub: 0.08, hole: 0 },
  "bio-nylon": { threadsU: 26, threadsV: 26, angle: 0.18, contrast: 0.1, slub: 0.06, hole: 0 },
};

/** Deterministic value noise on a lattice, used for slubs and camo blobs. */
function hashNoise(x: number, y: number, seed: number): number {
  let state = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed) >>> 0;
  state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
  state = Math.imul(state ^ (state >>> 13), 0x297a2d39) >>> 0;
  return ((state ^ (state >>> 16)) >>> 0) / 4294967296;
}

/** Symmetric stripe of `width` centred every `period` units of `value`. */
function stripeMask(value: number, period: number, width: number): number {
  const wrapped = ((value % period) + period) % period;
  return Math.abs(wrapped - period / 2) < width / 2 ? 1 : 0;
}

/** Soft dot grid used by terry loop and mesh-vent weaves. */
function dotMask(u: number, v: number, cells: number, radius: number): number {
  const du = (u * cells) % 1 - 0.5;
  const dv = (v * cells) % 1 - 0.5;
  return du * du + dv * dv < radius ? 1 : 0;
}

/** Printed motif coverage at `(u, v)`; `0` for plain cloth. */
function patternMask(pattern: FabricPattern, u: number, v: number, seed: number): number {
  switch (pattern) {
    case "plain":
      return 0;
    case "pinstripe":
      return stripeMask(u, 1 / 8, 0.035);
    case "twill-diagonal":
      return 0.45 + 0.45 * Math.sin(TWO_PI * 8 * (u + v));
    case "plaid-windowpane":
      return Math.max(stripeMask(u, 1 / 4, 0.06), stripeMask(v, 1 / 4, 0.06));
    case "houndstooth":
      return (Math.floor(u * 8) + Math.floor(v * 8)) % 2 === 0 ? 0.75 : 0.15;
    case "neon-colour-block":
      return Math.floor((u + v) * 3) % 2 === 0 ? 1 : 0.12;
    case "terry-loop":
      return dotMask(u, v, 16, 0.08) > 0 ? 0.8 : 0.1;
    case "rib-knit":
      return 0.5 + 0.5 * Math.sin(TWO_PI * 10 * u);
    case "ripstop-grid":
      return Math.max(stripeMask(u, 1 / 6, 0.04), stripeMask(v, 1 / 6, 0.04));
    case "quilted-panel":
      return Math.max(stripeMask(u + v, 1 / 3, 0.05), stripeMask(u - v, 1 / 3, 0.05));
    case "mesh-vent":
      return dotMask(u, v, 10, 0.05) > 0 ? 1 : 0;
    case "camo-panel":
      return hashNoise(Math.floor(u * 6), Math.floor(v * 6), seed) > 0.55 ? 0.8 : 0.15;
    default:
      return 0;
  }
}

/**
 * Paints one fabric texture into a fresh RGBA byte buffer.
 *
 * Weave and printed motif are deterministic functions of the fabric recipe, so
 * a cloth always looks identical, in the browser and in headless tests. The
 * `pattern` flavour keeps the cloth transparent and only paints the motif,
 * which is what lets the rig cross-fade two era fabrics smoothly.
 */
export function paintFabricPattern(
  fabric: FabricSpec,
  size: number = FABRIC_TEXTURE_SIZE,
  flavour: FabricTextureFlavour = "weave",
): Uint8ClampedArray {
  const pixels = Math.max(4, Math.min(256, Math.round(size)));
  const bytes = new Uint8ClampedArray(pixels * pixels * 4);
  const profile = WEAVE_PROFILES[fabric.weave];
  const seed = hashString(fabric.id);
  const angle = profile.angle * Math.PI;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  for (let y = 0; y < pixels; y += 1) {
    const v = (y + 0.5) / pixels;
    for (let x = 0; x < pixels; x += 1) {
      const u = (x + 0.5) / pixels;
      const motif = patternMask(fabric.pattern, u, v, seed);
      const index = (y * pixels + x) * 4;
      if (flavour === "pattern") {
        const alpha = Math.round(255 * clampUnit(motif) * clampUnit(fabric.patternStrength));
        const motifTone = Math.round(255 * clampUnit(0.3 + 0.4 * (1 - motif)));
        bytes[index] = motifTone;
        bytes[index + 1] = motifTone;
        bytes[index + 2] = motifTone;
        bytes[index + 3] = alpha;
        continue;
      }

      const warp = Math.sin(TWO_PI * profile.threadsU * (u * cos + v * sin));
      const weft = Math.sin(TWO_PI * profile.threadsV * (-u * sin + v * cos));
      const interlaced = (warp * weft + 1) * 0.5;
      const grain = hashNoise(Math.floor(u * profile.threadsU * 2), Math.floor(v * profile.threadsV * 2), seed);
      const holes = profile.hole > 0 ? dotMask(u, v, profile.threadsU, profile.hole) : 0;
      let luminance = 0.78 + profile.contrast * (interlaced - 0.5);
      luminance += profile.slub * (grain - 0.5) * 0.6;
      luminance -= holes * 0.8;
      const shade = clampUnit(luminance * (1 - 0.28 * motif * fabric.patternStrength));
      const tone = Math.round(255 * shade);
      bytes[index] = tone;
      bytes[index + 1] = tone;
      bytes[index + 2] = tone;
      bytes[index + 3] = 255;
    }
  }
  return bytes;
}

let cachedTransport: FabricTextureTransport | null = null;

/**
 * Detects whether a real 2D canvas is available.
 *
 * Browsers paint the fabric pixels onto a canvas (crisp, mip-mapped, matched to
 * the display colour space); headless test environments get the same pixels
 * wrapped in a `THREE.DataTexture` instead.
 */
export function fabricTextureTransport(): FabricTextureTransport {
  if (cachedTransport) {
    return cachedTransport;
  }
  cachedTransport = detectCanvas2d() ? "canvas-2d" : "data-texture";
  return cachedTransport;
}

function detectCanvas2d(): boolean {
  try {
    if (typeof OffscreenCanvas === "function") {
      return true;
    }
    // Browsers expose the 2D context constructor; headless DOM shims do not, and
    // probing one would log "not implemented" noise instead of returning null.
    if (
      typeof document === "undefined" ||
      typeof HTMLCanvasElement === "undefined" ||
      typeof CanvasRenderingContext2D === "undefined"
    ) {
      return false;
    }
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    return probe.getContext("2d") !== null;
  } catch {
    return false;
  }
}

function configureTexture(texture: THREE.Texture, repeats: number): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeats, repeats);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function tryCanvasTexture(bytes: Uint8ClampedArray, size: number): THREE.Texture | null {
  if (fabricTextureTransport() !== "canvas-2d") {
    return null;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context || typeof context.createImageData !== "function") {
      return null;
    }
    const image = context.createImageData(size, size);
    image.data.set(bytes);
    context.putImageData(image, 0, 0);
    return new THREE.CanvasTexture(canvas);
  } catch {
    return null;
  }
}

function dataTexture(bytes: Uint8ClampedArray, size: number): THREE.Texture {
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/** The two textures that carry one fabric: opaque cloth and printed motif. */
export interface FabricTextureSet {
  readonly fabricId: string;
  readonly transport: FabricTextureTransport;
  readonly weave: THREE.Texture;
  readonly pattern: THREE.Texture;
}

/**
 * Builds the fabric texture pair for one recipe.
 *
 * Textures are owned by the caller (the pedestrian system caches one set per
 * fabric id and disposes them all on teardown), so a passing era transition
 * never allocates or leaks a texture.
 */
export function createFabricTextureSet(fabric: FabricSpec, size: number = FABRIC_TEXTURE_SIZE): FabricTextureSet {
  const pixels = Math.max(8, Math.min(256, Math.round(size)));
  const transport = fabricTextureTransport();
  const weaveBytes = paintFabricPattern(fabric, pixels, "weave");
  const patternBytes = paintFabricPattern(fabric, pixels, "pattern");
  const weave = configureTexture(tryCanvasTexture(weaveBytes, pixels) ?? dataTexture(weaveBytes, pixels), fabric.repeats);
  const pattern = configureTexture(tryCanvasTexture(patternBytes, pixels) ?? dataTexture(patternBytes, pixels), fabric.repeats);
  return { fabricId: fabric.id, transport, weave, pattern };
}
