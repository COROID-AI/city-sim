/**
 * Chrono City — per-era pedestrian outfits.
 *
 * The single source of truth for *what a pedestrian in a given year wears*:
 * garment colours, headwear, leg form, bag and a small era accessory, plus the
 * silhouette parameters the figure factory turns into geometry.
 *
 * Design rules:
 *  - Colours are **derived from the era descriptor** (`eraDescriptors.ts`
 *    `fashion.palette`), so an era palette edit flows straight into the crowd
 *    instead of drifting from a private copy. Only the neutral tones a palette
 *    never carries — skin, hair and shoe leather — are authored here.
 *  - `style`, `notes`, `silhouettes`, `hats` and `formalRatio` are read from the
 *    descriptor too, so the crowd always speaks the era contract's language.
 *  - The authored tables add what the descriptor intentionally leaves open:
 *    *which* palette slot each garment takes, how wide the shoulders are, how
 *    long the coat is, whether the session dress code is trousers or a skirt,
 *    and how the headwear reads (brimmed hat, pillbox, mohawk, cap, hood).
 *
 * Lifecycle:
 *   create    → `OUTFITS` / `outfitFor()` build the frozen per-era table.
 *   consume   → the figure factory reads colours + form; the crowd reads
 *               `resolveFigureForm()` for the per-figure variant.
 *   integrate → `blendOutfits()` crossfades two eras for the `TimelineRuntime`
 *               tween (colours interpolate, garment forms/accessories swap at the
 *               midpoint), and `OUTFIT_COPY_BY_ERA` feeds the inspection
 *               registry's per-year info cards.
 */

import { ERA_IDS, type EraId } from '../../core/eraContracts';
import { blendEraColor, getEraDescriptor } from '../../era/eraDescriptors';
import type { InspectableCopy, InspectableCopyByEra } from '../../interaction/inspectionRegistry';

export const OUTFITS_VERSION = 1;

/**
 * Progress at which garment *forms* (headwear, leg shape, bag, accessory) swap
 * during a transition. Colours crossfade the whole way; only the discrete
 * silhouette pieces jump, and they jump exactly halfway so the change reads as
 * a deliberate wardrobe switch rather than a glitch.
 */
export const OUTFIT_SWAP_MIDPOINT = 0.5;

/** Headwear the era's pedestrians wear. */
export type HatForm = 'none' | 'brimmed' | 'pillbox' | 'mohawk' | 'cap' | 'hood';

/** Lower-body garment form. */
export type LegForm = 'trousers' | 'skirt' | 'bootcut' | 'wide-leg';

/** Carried bag form. */
export type BagForm = 'none' | 'handbag' | 'satchel' | 'messenger' | 'tote';

/** Small era accessory that sells the decade in a close-up. */
export type AccessoryForm = 'none' | 'scarf' | 'badge' | 'bandana' | 'headphones' | 'sunglasses';

/**
 * Discrete silhouette parameters applied to the articulated low-poly body.
 * The numbers are multipliers on authored body metrics, which is what makes the
 * five years read as five distinct silhouettes at a glance.
 */
export interface EraGarmentForm {
  readonly hat: HatForm;
  /** Dominant lower-body form (per-figure dress ratio can override it). */
  readonly legs: LegForm;
  readonly bag: BagForm;
  readonly accessory: AccessoryForm;
  /** `0` = cropped jacket, `1` = knee-length coat. */
  readonly coatLength: number;
  /** `1` = era-neutral shoulders; `> 1` padded (power suits), `< 1` slim (mod). */
  readonly shoulderWidth: number;
  /** `0` = straight hem, `1` = strongly flared. */
  readonly hemFlare: number;
}

/** Garment slots the figure factory tints. */
export interface EraGarmentColors {
  readonly hat: number;
  readonly hair: number;
  readonly outerwear: number;
  readonly top: number;
  readonly legs: number;
  /** Colour of the skirt/dress when the figure's variant wears one. */
  readonly dress: number;
  readonly shoes: number;
  /** Trim, bag, scarf and accessory colour. */
  readonly accent: number;
}

/** Stable iteration order for the colour slots (blends and tests rely on it). */
export const GARMENT_COLOR_KEYS = [
  'hat',
  'hair',
  'outerwear',
  'top',
  'legs',
  'dress',
  'shoes',
  'accent',
] as const;

export type GarmentColorKey = (typeof GARMENT_COLOR_KEYS)[number];

/** A complete, frozen description of one year's street wardrobe. */
export interface EraOutfit {
  readonly era: EraId;
  readonly year: number;
  /** Descriptor `fashion.style` — the one-line summary. */
  readonly style: string;
  /** Descriptor `fashion.silhouettes`, verbatim. */
  readonly silhouettes: readonly string[];
  /** Descriptor `fashion.palette`; every garment colour comes from here. */
  readonly palette: readonly number[];
  /** Descriptor `fashion.hats`: the historical hat share. */
  readonly hatProbability: number;
  /** Authored share of figures showing the era's *headwear* (mohawk, hood, …). */
  readonly headwearRatio: number;
  /** Descriptor `fashion.formalRatio`: how often a figure wears outerwear. */
  readonly formalRatio: number;
  /** Authored share of figures in a skirt/dress instead of trousers. */
  readonly dressRatio: number;
  readonly colors: EraGarmentColors;
  readonly form: EraGarmentForm;
  /** Keywords used by tests, the HUD and info cards. */
  readonly tags: readonly string[];
  /** Descriptor `fashion.notes`, verbatim. */
  readonly notes: string;
  /**
   * Stable key over the authored silhouette parameters; two seasons with the
   * same key would look identical, so the five years must all differ.
   */
  readonly silhouetteKey: string;
}

/**
 * Neutral skin tones. Skin is a property of the *person*, not of the year, so
 * it lives outside the era tables and is picked per figure from the seed.
 */
export const SKIN_TONES: readonly number[] = Object.freeze([
  0xe4b892, 0xd0a074, 0xba8757, 0x9d6c44, 0x7d5334, 0x5f3d24,
]);

/* ------------------------------------------------------------------------- *
 * Authored tables
 * ------------------------------------------------------------------------- */

/** Which palette slot each garment takes. Slots index `fashion.palette`. */
interface GarmentRoleSlots {
  readonly hat: number;
  readonly outerwear: number;
  readonly top: number;
  readonly legs: number;
  readonly dress: number;
  readonly accent: number;
}

const ERA_GARMENT_ROLES: Readonly<Record<EraId, GarmentRoleSlots>> = Object.freeze({
  // Austerity wool: olive coats, navy suits and dresses, brick-red scarves.
  '1945': { hat: 2, outerwear: 0, top: 2, legs: 1, dress: 3, accent: 3 },
  // Mod tailoring: mustard suits, teal trench coats, cream shift dresses.
  '1965': { hat: 3, outerwear: 1, top: 0, legs: 1, dress: 3, accent: 4 },
  // Punk black leather and magenta power tailoring against cyan trim.
  '1985': { hat: 2, outerwear: 2, top: 0, legs: 2, dress: 0, accent: 1 },
  // Denim is the decade: blue jeans, dark hoodies, grey tees, red accents.
  '2005': { hat: 1, outerwear: 1, top: 2, legs: 0, dress: 4, accent: 3 },
  // Technical shells in charcoal and teal with gold hardware.
  '2025': { hat: 2, outerwear: 2, top: 0, legs: 2, dress: 4, accent: 1 },
});

/** Hair colour per era: sooty 40s, dark 60s, bleached punk 80s, then modern. */
const ERA_HAIR: Readonly<Record<EraId, number>> = Object.freeze({
  '1945': 0x3b2f24,
  '1965': 0x2c2118,
  '1985': 0xe0d8c4,
  '2005': 0x5a4230,
  '2025': 0x22252b,
});

/** Footwear per era: leather oxfords → tan loafers → boots → sneakers → tech. */
const ERA_SHOES: Readonly<Record<EraId, number>> = Object.freeze({
  '1945': 0x2f2a24,
  '1965': 0x6b5f4d,
  '1985': 0x17181c,
  '2005': 0xd8d5cc,
  '2025': 0x2b3038,
});

/**
 * Authored silhouettes. These carry the acceptance story directly:
 * 1945 hats/suits/dresses, 1965 slim mod tailoring, 1985 padded punk/power
 * shoulders, 2005 casual denim bootcuts, 2025 wide-leg technical wear.
 */
const ERA_FORMS: Readonly<Record<EraId, EraGarmentForm>> = Object.freeze({
  '1945': {
    hat: 'brimmed',
    legs: 'trousers',
    bag: 'handbag',
    accessory: 'scarf',
    coatLength: 0.88,
    shoulderWidth: 1.08,
    hemFlare: 0.12,
  },
  '1965': {
    hat: 'pillbox',
    legs: 'trousers',
    bag: 'satchel',
    accessory: 'badge',
    coatLength: 0.6,
    shoulderWidth: 0.9,
    hemFlare: 0.34,
  },
  '1985': {
    hat: 'mohawk',
    legs: 'trousers',
    bag: 'none',
    accessory: 'bandana',
    coatLength: 0.44,
    shoulderWidth: 1.3,
    hemFlare: 0.06,
  },
  '2005': {
    hat: 'cap',
    legs: 'bootcut',
    bag: 'messenger',
    accessory: 'headphones',
    coatLength: 0.42,
    shoulderWidth: 1.02,
    hemFlare: 0.04,
  },
  '2025': {
    hat: 'hood',
    legs: 'wide-leg',
    bag: 'tote',
    accessory: 'sunglasses',
    coatLength: 0.72,
    shoulderWidth: 1.14,
    hemFlare: 0.1,
  },
});

/** Authored headwear share (punk crests and tech hoods are not "hats"). */
const ERA_HEADWEAR_RATIO: Readonly<Record<EraId, number>> = Object.freeze({
  '1945': 0.78,
  '1965': 0.55,
  '1985': 0.5,
  '2005': 0.28,
  '2025': 0.46,
});

/** Authored skirt/dress share: 40s and 60s wear dresses, the 80s rarely do. */
const ERA_DRESS_RATIO: Readonly<Record<EraId, number>> = Object.freeze({
  '1945': 0.45,
  '1965': 0.55,
  '1985': 0.14,
  '2005': 0.2,
  '2025': 0.26,
});

/** Keywords the acceptance criteria name explicitly, per year. */
const ERA_OUTFIT_TAGS: Readonly<Record<EraId, readonly string[]>> = Object.freeze({
  '1945': ['hats', 'suits', 'dresses', 'wool', 'utility'],
  '1965': ['mod', 'tailoring', 'shift-dress', 'pillbox'],
  '1985': ['punk', 'power-suit', 'mohawk', 'leather'],
  '2005': ['casual', 'denim', 'hoodie', 'sneakers'],
  '2025': ['techwear', 'technical-shell', 'wide-leg', 'utility'],
});

/** Per-year info-card blurb for the crowd inspectables. */
const ERA_OUTFIT_BLURBS: Readonly<Record<EraId, string>> = Object.freeze({
  '1945':
    'Wool overcoats are buttoned to the collar and a wide-brim felt hat sits level against the drizzle; dresses are hemmed at the knee and every seam has been mended twice.',
  '1965':
    'Slim-lapel tailoring in mustard and teal, a cream pillbox hat worn dead flat and shift dresses cut short: the block has discovered the future and wants everyone to see it.',
  '1985':
    'Black leather jackets and shoulder-padded power suits share the pavement with bleached mohawks, tartan patches and tied bandanas; everything is zipped, studded or neon-trimmed.',
  '2005':
    'Casual denim from head to toe: bootcut jeans, layered tees and hoodies, white sneakers, a cross-body messenger bag and earbuds trailing from a jacket pocket.',
  '2025':
    'Technical shells in charcoal and teal, wide-leg utility trousers with cinched cuffs, a deep hood up against the wind, a tote bag and sunglasses against the glare.',
});

/* ------------------------------------------------------------------------- *
 * Construction
 * ------------------------------------------------------------------------- */

/** Rounds to two decimals so silhouette keys are stable and readable. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function silhouetteKeyOf(form: EraGarmentForm, dressRatio: number): string {
  return [
    form.hat,
    form.legs,
    form.bag,
    form.accessory,
    `s${round2(form.shoulderWidth)}`,
    `c${round2(form.coatLength)}`,
    `h${round2(form.hemFlare)}`,
    `d${round2(dressRatio)}`,
  ].join('-');
}

const outfitCache = new Map<EraId, EraOutfit>();

/**
 * Builds one era's outfit from the era descriptor plus the authored role and
 * form tables. Results are cached, so `outfitFor()` returns a stable instance.
 */
export function buildEraOutfit(era: EraId): EraOutfit {
  const cached = outfitCache.get(era);
  if (cached) return cached;

  const descriptor = getEraDescriptor(era);
  const fashion = descriptor.fashion;
  const palette = fashion.palette;
  const roles = ERA_GARMENT_ROLES[era];
  const form = ERA_FORMS[era];

  if (!roles || !form) {
    throw new RangeError(`No pedestrian outfit authored for era ${era}.`);
  }

  // Authored roles index the descriptor palette; wrapping keeps a malformed
  // table from producing `undefined` colours.
  const slot = (index: number): number => {
    const wrapped = ((index % palette.length) + palette.length) % palette.length;
    return palette[wrapped] as number;
  };

  const dressRatio = ERA_DRESS_RATIO[era] ?? 0;
  const colors: EraGarmentColors = Object.freeze({
    hat: slot(roles.hat),
    hair: ERA_HAIR[era] ?? 0x3b2f24,
    outerwear: slot(roles.outerwear),
    top: slot(roles.top),
    legs: slot(roles.legs),
    dress: slot(roles.dress),
    shoes: ERA_SHOES[era] ?? 0x2f2a24,
    accent: slot(roles.accent),
  });

  const outfit: EraOutfit = Object.freeze({
    era,
    year: descriptor.year,
    style: fashion.style,
    silhouettes: Object.freeze([...fashion.silhouettes]),
    palette: Object.freeze([...palette]),
    hatProbability: fashion.hats,
    headwearRatio: ERA_HEADWEAR_RATIO[era] ?? fashion.hats,
    formalRatio: fashion.formalRatio,
    dressRatio,
    colors,
    form: Object.freeze({ ...form }),
    tags: Object.freeze([...(ERA_OUTFIT_TAGS[era] ?? [])]),
    notes: fashion.notes,
    silhouetteKey: silhouetteKeyOf(form, dressRatio),
  });

  outfitCache.set(era, outfit);
  return outfit;
}

/** Every era's outfit, keyed by era id. */
export const OUTFITS: Readonly<Record<EraId, EraOutfit>> = Object.freeze(
  ERA_IDS.reduce<Record<string, EraOutfit>>((table, era) => {
    table[era] = buildEraOutfit(era);
    return table;
  }, {}) as Record<EraId, EraOutfit>,
);

/** Outfit lookup by era id. */
export function outfitFor(era: EraId): EraOutfit {
  return OUTFITS[era];
}

/**
 * The garment form a specific figure wears: figures whose variant falls inside
 * the era's dress ratio swap the base lower-body form for a skirt, which is how
 * 1945 shows both suits *and* dresses on the same pavement.
 */
export function resolveFigureForm(
  form: EraGarmentForm,
  dressRatio: number,
  variant: number,
): EraGarmentForm {
  if (variant >= dressRatio) return form;
  return form.legs === 'skirt' ? form : Object.freeze({ ...form, legs: 'skirt' as LegForm });
}

/* ------------------------------------------------------------------------- *
 * Blendable transition surface
 * ------------------------------------------------------------------------- */

/** A two-era outfit morph, ready to push into a figure every tween frame. */
export interface BlendedOutfit {
  /** Eased tween progress in `[0, 1]`. */
  readonly progress: number;
  readonly from: EraOutfit;
  readonly to: EraOutfit;
  /** Era the *wardrobe* currently reads as (swaps at the midpoint). */
  readonly era: EraId;
  /** Colour for every garment slot, crossfaded between the two eras. */
  readonly colors: EraGarmentColors;
  /** Garment form, swapped at the midpoint so nothing pops mid-crossfade. */
  readonly form: EraGarmentForm;
  readonly dressRatio: number;
  readonly headwearRatio: number;
  readonly formalRatio: number;
  readonly style: string;
  readonly tags: readonly string[];
  /** `true` while the morph still mixes two seasons. */
  readonly blending: boolean;
}

/**
 * Crossfades two eras.
 *
 *  - `progress <= 0` returns the source outfit exactly, `progress >= 1` the
 *    target outfit exactly, which is what keeps settled crowds from popping.
 *  - Colours interpolate channel-wise through `blendEraColor`.
 *  - Discrete pieces (headwear, leg form, bag, accessory, ratio thresholds) swap
 *    at `OUTFIT_SWAP_MIDPOINT`, i.e. the tween's halfway point.
 */
export function blendOutfits(from: EraOutfit, to: EraOutfit, progress: number): BlendedOutfit {
  const t = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
  const target = t >= OUTFIT_SWAP_MIDPOINT ? to : from;

  const colors = {} as Record<GarmentColorKey, number>;
  for (const key of GARMENT_COLOR_KEYS) {
    colors[key] = blendEraColor(from.colors[key], to.colors[key], t);
  }

  return Object.freeze({
    progress: t,
    from,
    to,
    era: target.era,
    colors: Object.freeze(colors as unknown as EraGarmentColors),
    form: target.form,
    dressRatio: target.dressRatio,
    headwearRatio: target.headwearRatio,
    formalRatio: target.formalRatio,
    style: target.style,
    tags: target.tags,
    blending: t > 0 && t < 1 && from.era !== to.era,
  });
}

/** Convenience wrapper: `blendOutfitEras('1945', '2025', 0.5)`. */
export function blendOutfitEras(from: EraId, to: EraId, progress: number): BlendedOutfit {
  return blendOutfits(outfitFor(from), outfitFor(to), progress);
}

/* ------------------------------------------------------------------------- *
 * Inspection copy
 * ------------------------------------------------------------------------- */

/** Per-year info card copy describing what the crowd is wearing. */
export const OUTFIT_COPY_BY_ERA: InspectableCopyByEra = Object.freeze(
  ERA_IDS.reduce<Record<string, InspectableCopy>>((table, era) => {
    const outfit = outfitFor(era);
    table[era] = Object.freeze({
      name: `${outfit.year} street fashion`,
      blurb: ERA_OUTFIT_BLURBS[era] ?? `${outfit.style}. ${outfit.notes}`,
    });
    return table;
  }, {}) as InspectableCopyByEra,
);

/** Copy for one era, for callers that resolve the year themselves. */
export function outfitCopy(era: EraId): InspectableCopy {
  const copy = OUTFIT_COPY_BY_ERA[era];
  return copy ?? { name: `${era} street fashion`, blurb: outfitFor(era).style };
}

/** One-line "what is on the pavement right now" summary for HUD/fallback copy. */
export function outfitsSummaryFor(era: EraId): string {
  const outfit = outfitFor(era);
  return `${outfit.year}: ${outfit.style} (${outfit.silhouettes.join(', ')}).`;
}
