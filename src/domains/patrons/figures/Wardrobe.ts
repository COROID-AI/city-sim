/**
 * Patron wardrobe — the era-exact clothing, hair and fabric vocabulary.
 *
 * The patron figures are built from primitives, so every readable era cue has
 * to come from three places: the *cut* of a garment (how {@link FigureRig}
 * folds the primitive volumes), the *fabric* it is drawn from (a procedural
 * pattern painted here, never a downloaded texture) and the *era colour ramp*
 * the figure's colourway indexes into.
 *
 * This module owns those three things plus the chronology guard:
 *
 *  - {@link WARDROBE} — the catalogue of garments (utility shirts, flat caps,
 *    shift dresses, big-shoulder blazers, puffer jackets, …) each carrying the
 *    year it becomes legible, so no era can wear something that does not exist
 *    yet,
 *  - {@link HAIR_STYLES} — the hairstyle silhouettes (victory rolls, beehives,
 *    big hair, curtain waves) with the volume and length the rig extrudes,
 *  - {@link PatronPalette} — the era's skin, hair and garment dye ramps, kept
 *    low-chroma for the 40s and high-chroma for the 60s/80s,
 *  - {@link createFigureMaterialLibrary} — the shared material/texture library
 *    one era's figure set is drawn with, so thirteen patrons cost a couple of
 *    dozen materials instead of a couple of hundred,
 *  - {@link createFigureTexture} — the procedural fabric/paper/screen painter
 *    (canvas when the DOM is available, a data texture otherwise).
 *
 * Everything here is data plus pure helpers: no scene graph, no timers, no
 * network. `Wardrobe` knows nothing about placement, animation or the kernel.
 */

import * as THREE from 'three';
import type { YearId } from '../../../contracts/period';
import { createSeededRandom } from '../../../core/kernel';
import {
  PixelBuffer,
  defaultCanvasFactory,
  hashString,
  parseColor,
  shade,
  type CanvasFactory,
} from '../../environment';

/* -------------------------------------------------------------------------- */
/* Garment vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/** Slot a garment occupies on the body. */
export type GarmentSlot = 'top' | 'bottom' | 'outerwear' | 'headwear' | 'footwear' | 'accessory';

/** Every slot, in the order the rig layers them. */
export const GARMENT_SLOTS: readonly GarmentSlot[] = Object.freeze([
  'top',
  'bottom',
  'outerwear',
  'footwear',
  'headwear',
  'accessory',
]);

/**
 * How the rig cuts a garment from primitives. Each cut is one small recipe in
 * {@link FigureRig}; the wardrobe only names which one to use.
 */
export type GarmentCut =
  | 'shirt'
  | 'blouse'
  | 'knit'
  | 'dress'
  | 'vest'
  | 'jacket'
  | 'coat'
  | 'apron'
  | 'leotard'
  | 'trousers'
  | 'skirt'
  | 'jeans'
  | 'shorts'
  | 'leggings'
  | 'cap'
  | 'hat'
  | 'beret'
  | 'beanie'
  | 'headscarf'
  | 'shoes'
  | 'boots'
  | 'trainers'
  | 'tie'
  | 'scarf'
  | 'bag'
  | 'glasses';

/** Collar treatment; drives how much volume sits at the neckline. */
export type CollarStyle = 'none' | 'open' | 'tall' | 'lapel' | 'roll' | 'hood' | 'peter-pan';

/** Sleeve treatment. */
export type SleeveStyle = 'none' | 'short' | 'long' | 'puff' | 'raglan';

/** How the era cut a garment, expressed as numbers the rig can build from. */
export interface GarmentForm {
  readonly family: GarmentSlot;
  readonly cut: GarmentCut;
  /** `0` = tailored and close, `1` = loose and oversized. */
  readonly fit: number;
  /** `0` = cropped, `1` = floor length. */
  readonly length: number;
  /** `0` = straight, `1` = flared. */
  readonly flare: number;
  readonly collar: CollarStyle;
  readonly sleeve: SleeveStyle;
  /** Era-exact detail line used in the inspect caption. */
  readonly detail: string;
}

/** Procedurally painted fabric patterns. */
export type FigurePattern =
  | 'solid'
  | 'stripe'
  | 'check'
  | 'twill'
  | 'denim'
  | 'knit'
  | 'floral'
  | 'print'
  | 'quilt'
  | 'mesh';

/** Every pattern, for diagnostics and tests. */
export const FIGURE_PATTERNS: readonly FigurePattern[] = Object.freeze([
  'solid',
  'stripe',
  'check',
  'twill',
  'denim',
  'knit',
  'floral',
  'print',
  'quilt',
  'mesh',
]);

/** One garment in the catalogue. */
export interface WardrobeItem {
  readonly id: string;
  /** Era-exact label (`'tweed flat cap'`). */
  readonly label: string;
  /** First year the garment reads as period correct; the chronology guard uses it. */
  readonly introduced: number;
  readonly form: GarmentForm;
  readonly pattern: FigurePattern;
  /** Default index into the era's dye ramp. */
  readonly defaultColorway: number;
}

function garment(
  id: string,
  label: string,
  introduced: number,
  form: GarmentForm,
  pattern: FigurePattern,
  defaultColorway: number,
): WardrobeItem {
  return Object.freeze({ id, label, introduced, form: Object.freeze(form), pattern, defaultColorway });
}

const SOLID = 'solid' as const;

function form(
  family: GarmentSlot,
  cut: GarmentCut,
  fit: number,
  length: number,
  flare: number,
  collar: CollarStyle,
  sleeve: SleeveStyle,
  detail: string,
): GarmentForm {
  return { family, cut, fit, length, flare, collar, sleeve, detail };
}

/**
 * The catalogue. Ids are era-neutral, `introduced` carries the chronology and
 * the per-year specs choose which ones their figures wear, so a 1945 patron
 * physically cannot be handed a Walkman-era puffer jacket.
 */
export const WARDROBE: Readonly<Record<string, WardrobeItem>> = Object.freeze({
  /* -- 1945: austerity tailoring, uniforms and home-knits ------------------ */
  'utility-shirt': garment(
    'utility-shirt',
    'khaki utility shirt',
    1940,
    form('top', 'shirt', 0.3, 0.35, 0, 'open', 'long', 'yoke, flap pockets and utility buttons'),
    'twill',
    2,
  ),
  'utility-trousers': garment(
    'utility-trousers',
    'high-waisted wool trousers',
    1932,
    form('bottom', 'trousers', 0.35, 0.85, 0.15, 'none', 'none', 'wide waistband with turn-ups'),
    'twill',
    1,
  ),
  'uniform-waistcoat': garment(
    'uniform-waistcoat',
    'dark wool waistcoat',
    1930,
    form('outerwear', 'vest', 0.25, 0.3, 0, 'open', 'none', 'five-button front with a watch pocket'),
    SOLID,
    0,
  ),
  'barista-apron': garment(
    'barista-apron',
    'long white server apron',
    1900,
    form('accessory', 'apron', 0.45, 0.6, 0.2, 'none', 'none', 'bib apron with a waist tie'),
    SOLID,
    5,
  ),
  'suit-jacket-1945': garment(
    'suit-jacket-1945',
    'single-breasted suit jacket',
    1920,
    form('outerwear', 'jacket', 0.3, 0.4, 0.05, 'lapel', 'long', 'wide peak lapels and a three-button front'),
    'twill',
    0,
  ),
  'tea-dress': garment(
    'tea-dress',
    'printed tea dress',
    1930,
    form('top', 'dress', 0.4, 0.5, 0.45, 'peter-pan', 'short', 'puffed sleeves over a bias-cut skirt'),
    'floral',
    4,
  ),
  'pleated-skirt': garment(
    'pleated-skirt',
    'knee-length pleated skirt',
    1935,
    form('bottom', 'skirt', 0.35, 0.45, 0.5, 'none', 'none', 'knife pleats caught at a narrow waistband'),
    'check',
    3,
  ),
  'womens-cardigan': garment(
    'womens-cardigan',
    'buttoned wool cardigan',
    1930,
    form('outerwear', 'knit', 0.45, 0.4, 0, 'open', 'long', 'hand-knitted cardigan worn buttoned high'),
    'knit',
    4,
  ),
  'wool-coat': garment(
    'wool-coat',
    'belted wool overcoat',
    1925,
    form('outerwear', 'coat', 0.55, 0.85, 0.2, 'lapel', 'long', 'double-breasted with a half belt'),
    SOLID,
    1,
  ),
  'flat-cap': garment(
    'flat-cap',
    'tweed flat cap',
    1910,
    form('headwear', 'cap', 0.4, 0.2, 0.1, 'none', 'none', 'wool flat cap with a stitched peak'),
    'check',
    1,
  ),
  fedora: garment(
    'fedora',
    'felt fedora',
    1920,
    form('headwear', 'hat', 0.3, 0.3, 0.15, 'none', 'none', 'snap brim with a grosgrain band'),
    SOLID,
    1,
  ),
  'wool-beret': garment(
    'wool-beret',
    'wool beret',
    1920,
    form('headwear', 'beret', 0.5, 0.2, 0.3, 'none', 'none', 'slouched felt beret'),
    SOLID,
    0,
  ),
  'silk-headscarf': garment(
    'silk-headscarf',
    'knotted silk headscarf',
    1935,
    form('headwear', 'headscarf', 0.55, 0.3, 0.2, 'none', 'none', 'scarf tied over pin curls'),
    'print',
    4,
  ),
  brogues: garment(
    'brogues',
    'leather brogues',
    1900,
    form('footwear', 'shoes', 0.25, 0.15, 0, 'none', 'none', 'punched leather uppers with heavy soles'),
    SOLID,
    0,
  ),
  'narrow-wool-tie': garment(
    'narrow-wool-tie',
    'narrow wool tie',
    1920,
    form('accessory', 'tie', 0.1, 0.3, 0, 'none', 'none', 'short narrow tie in a muted stripe'),
    'stripe',
    0,
  ),
  'knitted-scarf': garment(
    'knitted-scarf',
    'hand-knitted scarf',
    1910,
    form('accessory', 'scarf', 0.4, 0.6, 0.1, 'none', 'none', 'chunky ribbed scarf wound twice'),
    'knit',
    4,
  ),

  /* -- 1965: slim mod tailoring and colour-block shifts ------------------- */
  'mod-shirt': garment(
    'mod-shirt',
    'slim collar shirt',
    1955,
    form('top', 'shirt', 0.22, 0.4, 0, 'open', 'long', 'slim pointed collar and single cuffs'),
    'stripe',
    5,
  ),
  'slim-suit-jacket': garment(
    'slim-suit-jacket',
    'slim two-button mod suit jacket',
    1960,
    form('outerwear', 'jacket', 0.22, 0.38, 0.05, 'lapel', 'long', 'narrow lapels, side vents, four buttons'),
    'twill',
    4,
  ),
  'slim-trousers': garment(
    'slim-trousers',
    'tapered slim trousers',
    1958,
    form('bottom', 'trousers', 0.2, 0.8, 0.1, 'none', 'none', 'flat-front trousers with a sharp crease'),
    SOLID,
    0,
  ),
  'slim-tie': garment(
    'slim-tie',
    'narrow mod tie',
    1960,
    form('accessory', 'tie', 0.05, 0.3, 0, 'none', 'none', 'skinny tie under a button-down collar'),
    'stripe',
    3,
  ),
  'shift-dress': garment(
    'shift-dress',
    'colour-block shift dress',
    1960,
    form('top', 'dress', 0.3, 0.35, 0.15, 'none', 'short', 'sleeveless shift cut well above the knee'),
    'print',
    1,
  ),
  'a-line-skirt': garment(
    'a-line-skirt',
    'A-line mini skirt',
    1961,
    form('bottom', 'skirt', 0.25, 0.25, 0.6, 'none', 'none', 'mini A-line skirt with a contrast waistband'),
    'check',
    3,
  ),
  'roll-neck-knit': garment(
    'roll-neck-knit',
    'roll-neck knit',
    1955,
    form('top', 'knit', 0.25, 0.4, 0, 'roll', 'long', 'fine-gauge roll neck'),
    'knit',
    4,
  ),
  'mod-blazer': garment(
    'mod-blazer',
    'boxy mod blazer',
    1962,
    form('outerwear', 'jacket', 0.35, 0.4, 0.1, 'lapel', 'long', 'boxy velvet-collar blazer'),
    SOLID,
    2,
  ),
  'trench-coat': garment(
    'trench-coat',
    'belted trench coat',
    1950,
    form('outerwear', 'coat', 0.4, 0.75, 0.2, 'lapel', 'long', 'cotton trench with epaulettes and a belt'),
    SOLID,
    4,
  ),
  'bucket-hat': garment(
    'bucket-hat',
    'down-turned bucket hat',
    1962,
    form('headwear', 'hat', 0.35, 0.22, 0.2, 'none', 'none', 'soft bucket hat with a stitched brim'),
    SOLID,
    3,
  ),
  'penny-loafers': garment(
    'penny-loafers',
    'penny loafers',
    1955,
    form('footwear', 'shoes', 0.2, 0.15, 0, 'none', 'none', 'suede loafers with a coin slot'),
    SOLID,
    1,
  ),
  'chelsea-boots': garment(
    'chelsea-boots',
    'Chelsea boots',
    1960,
    form('footwear', 'boots', 0.25, 0.3, 0, 'none', 'none', 'elastic-sided cuban-heeled boots'),
    SOLID,
    0,
  ),
  'canvas-plimsolls': garment(
    'canvas-plimsolls',
    'canvas plimsolls',
    1955,
    form('footwear', 'trainers', 0.3, 0.15, 0, 'none', 'none', 'low canvas plimsolls with rubber soles'),
    SOLID,
    5,
  ),

  /* -- 1985: denim, volume and shoulder pads ------------------------------ */
  'band-tee': garment(
    'band-tee',
    'printed band tee',
    1975,
    form('top', 'shirt', 0.5, 0.35, 0, 'none', 'short', 'washed-out tour tee with a printed front'),
    'print',
    3,
  ),
  'denim-jacket': garment(
    'denim-jacket',
    'stonewash denim jacket',
    1970,
    form('outerwear', 'jacket', 0.45, 0.38, 0.05, 'lapel', 'long', 'boxy trucker jacket, sleeves rolled once'),
    'denim',
    0,
  ),
  'shoulder-pad-blazer': garment(
    'shoulder-pad-blazer',
    'shoulder-padded blazer',
    1978,
    form('outerwear', 'jacket', 0.55, 0.42, 0.1, 'lapel', 'long', 'pronounced shoulder pads over a long lapel'),
    SOLID,
    4,
  ),
  'straight-jeans': garment(
    'straight-jeans',
    'stonewash straight jeans',
    1970,
    form('bottom', 'jeans', 0.4, 0.95, 0.15, 'none', 'none', 'high-waisted stonewash jeans, pegged cuffs'),
    'denim',
    0,
  ),
  'denim-mini-skirt': garment(
    'denim-mini-skirt',
    'denim mini skirt',
    1975,
    form('bottom', 'skirt', 0.35, 0.2, 0.3, 'none', 'none', 'frayed-hem denim mini skirt'),
    'denim',
    0,
  ),
  'varsity-bomber': garment(
    'varsity-bomber',
    'varsity bomber jacket',
    1975,
    form('outerwear', 'jacket', 0.55, 0.35, 0.1, 'open', 'long', 'contrast-sleeve bomber with ribbed cuffs'),
    'stripe',
    1,
  ),
  'aerobics-leotard': garment(
    'aerobics-leotard',
    'aerobics leotard',
    1980,
    form('top', 'leotard', 0.05, 0.3, 0, 'none', 'none', 'high-cut leotard with side stripes'),
    'stripe',
    2,
  ),
  'leg-warmers': garment(
    'leg-warmers',
    'ribbed leg warmers',
    1979,
    form('accessory', 'scarf', 0.4, 0.25, 0.1, 'none', 'none', 'slouched leg warmers over trainers'),
    'knit',
    2,
  ),
  'mesh-trucker-cap': garment(
    'mesh-trucker-cap',
    'mesh trucker cap',
    1978,
    form('headwear', 'cap', 0.3, 0.2, 0.15, 'none', 'none', 'foam-fronted cap with a mesh back'),
    'mesh',
    5,
  ),
  'chunky-high-tops': garment(
    'chunky-high-tops',
    'chunky high-top sneakers',
    1975,
    form('footwear', 'trainers', 0.5, 0.25, 0, 'none', 'none', 'padded high-tops with a fat tongue'),
    SOLID,
    4,
  ),
  'laced-work-boots': garment(
    'laced-work-boots',
    'laced work boots',
    1970,
    form('footwear', 'boots', 0.4, 0.3, 0, 'none', 'none', 'tan work boots laced to the ankle'),
    SOLID,
    1,
  ),
  'oversized-sunglasses': garment(
    'oversized-sunglasses',
    'oversized sunglasses',
    1970,
    form('accessory', 'glasses', 0.2, 0.1, 0, 'none', 'none', 'wide tinted lenses in a thick frame'),
    SOLID,
    3,
  ),

  /* -- 2005: casual layers and low-rise denim ----------------------------- */
  'zip-hoodie': garment(
    'zip-hoodie',
    'zip hoodie',
    1990,
    form('outerwear', 'jacket', 0.6, 0.42, 0, 'hood', 'long', 'fleece-backed hoodie with a full zip'),
    SOLID,
    1,
  ),
  'cargo-shorts': garment(
    'cargo-shorts',
    'cargo shorts',
    1995,
    form('bottom', 'shorts', 0.6, 0.35, 0, 'none', 'none', 'baggy cargos with bellows pockets'),
    SOLID,
    2,
  ),
  'low-rise-jeans': garment(
    'low-rise-jeans',
    'low-rise bootcut jeans',
    2000,
    form('bottom', 'jeans', 0.45, 1, 0.25, 'none', 'none', 'low-rise jeans with whiskered fading'),
    'denim',
    0,
  ),
  'pique-polo': garment(
    'pique-polo',
    'pique polo shirt',
    1995,
    form('top', 'shirt', 0.35, 0.35, 0, 'open', 'short', 'knitted collar and a three-button placket'),
    'mesh',
    4,
  ),
  'zip-track-jacket': garment(
    'zip-track-jacket',
    'zip track jacket',
    1990,
    form('outerwear', 'jacket', 0.45, 0.4, 0, 'open', 'long', 'contrast side panels and a stand collar'),
    'stripe',
    0,
  ),
  'rain-shell': garment(
    'rain-shell',
    'two-tone rain shell',
    1995,
    form('outerwear', 'coat', 0.5, 0.6, 0.1, 'hood', 'long', 'taped seams and a storm flap'),
    SOLID,
    3,
  ),
  'baseball-cap': garment(
    'baseball-cap',
    'logo baseball cap',
    1990,
    form('headwear', 'cap', 0.3, 0.2, 0.1, 'none', 'none', 'six-panel cap, curved brim'),
    SOLID,
    2,
  ),
  'running-trainers': garment(
    'running-trainers',
    'mesh running trainers',
    1998,
    form('footwear', 'trainers', 0.45, 0.22, 0, 'none', 'none', 'chunky mesh runners with a visible air unit'),
    'mesh',
    4,
  ),
  'checked-flannel': garment(
    'checked-flannel',
    'checked flannel shirt',
    1995,
    form('top', 'shirt', 0.55, 0.4, 0, 'open', 'long', 'brushed plaid shirt worn open over a tee'),
    'check',
    1,
  ),
  'cropped-cardigan': garment(
    'cropped-cardigan',
    'cropped cardigan',
    1998,
    form('outerwear', 'knit', 0.4, 0.28, 0, 'open', 'long', 'single-button cropped cardigan'),
    'knit',
    4,
  ),
  'slim-chinos': garment(
    'slim-chinos',
    'slim chinos',
    2000,
    form('bottom', 'trousers', 0.3, 0.85, 0.05, 'none', 'none', 'slim chinos with a faded finish'),
    SOLID,
    3,
  ),

  /* -- 2025: athleisure, technical shells and knitwear -------------------- */
  'athleisure-top': garment(
    'athleisure-top',
    'seamless athleisure top',
    2015,
    form('top', 'shirt', 0.35, 0.32, 0, 'none', 'short', 'seamless knit with bonded seams'),
    'mesh',
    5,
  ),
  'performance-joggers': garment(
    'performance-joggers',
    'tapered performance joggers',
    2012,
    form('bottom', 'trousers', 0.4, 0.8, 0.05, 'none', 'none', 'elasticated cuffs and zip pockets'),
    'knit',
    3,
  ),
  'compression-leggings': garment(
    'compression-leggings',
    'compression leggings',
    2010,
    form('bottom', 'leggings', 0.05, 0.9, 0, 'none', 'none', 'high-rise compression leggings'),
    SOLID,
    0,
  ),
  'puffer-jacket': garment(
    'puffer-jacket',
    'oversized puffer jacket',
    2010,
    form('outerwear', 'coat', 0.85, 0.5, 0.1, 'hood', 'long', 'boxy baffle-quilted puffer'),
    'quilt',
    2,
  ),
  'knit-running-shoes': garment(
    'knit-running-shoes',
    'knit running shoes',
    2012,
    form('footwear', 'trainers', 0.5, 0.22, 0, 'none', 'none', 'sock-fit knit uppers on a foam midsole'),
    'knit',
    5,
  ),
  'ribbed-beanie': garment(
    'ribbed-beanie',
    'ribbed wool beanie',
    2005,
    form('headwear', 'beanie', 0.45, 0.25, 0.1, 'none', 'none', 'deep ribbed beanie with a folded cuff'),
    'knit',
    4,
  ),
  'oversized-knit': garment(
    'oversized-knit',
    'oversized cashmere knit',
    2000,
    form('top', 'knit', 0.75, 0.45, 0.05, 'roll', 'long', 'drop-shoulder knit with a high roll neck'),
    'knit',
    4,
  ),
});

/** Every catalogue id, sorted for stable diagnostics. */
export const WARDROBE_IDS: readonly string[] = Object.freeze(Object.keys(WARDROBE).sort());

/** Looks up a catalogue entry, throwing for an unknown id. */
export function wardrobeItem(id: string): WardrobeItem {
  const item = WARDROBE[id];
  if (!item) {
    throw new RangeError(`Unknown wardrobe item "${id}". Known ids: ${WARDROBE_IDS.join(', ')}.`);
  }
  return item;
}

/** True when `id` names a catalogue entry. */
export function hasWardrobeItem(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(WARDROBE, id);
}

/** Catalogue entries for one era, optionally filtered by slot. */
export function wardrobeItemsFor(year: YearId, slot?: GarmentSlot): readonly WardrobeItem[] {
  const limit = Number.parseInt(year, 10);
  return Object.freeze(
    Object.values(WARDROBE)
      .filter((item) => item.introduced <= limit && (slot === undefined || item.form.family === slot))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

/** Chronology guard: ids that did not exist yet in `year`. */
export function wardrobeConflicts(year: YearId, ids: readonly string[]): readonly string[] {
  const limit = Number.parseInt(year, 10);
  const problems: string[] = [];
  for (const id of ids) {
    const item = WARDROBE[id];
    if (!item) {
      problems.push(`unknown garment "${id}"`);
      continue;
    }
    if (item.introduced > limit) {
      problems.push(`"${id}" (${item.introduced}) is anachronistic in ${year}`);
    }
  }
  return problems;
}

/** Human readable labels for a garment id list (`['tweed flat cap', …]`). */
export function wardrobeLabels(ids: readonly string[]): readonly string[] {
  return Object.freeze(ids.map((id) => WARDROBE[id]?.label ?? id));
}

/* -------------------------------------------------------------------------- */
/* Hairstyles                                                                 */
/* -------------------------------------------------------------------------- */

/** Silhouette recipe the rig extrudes for a hairstyle. */
export type HairSilhouette =
  | 'crop'
  | 'side-part'
  | 'pompadour'
  | 'victory-rolls'
  | 'bob'
  | 'beehive'
  | 'bouffant'
  | 'curls'
  | 'shag'
  | 'mullet'
  | 'long-straight'
  | 'bun'
  | 'top-knot'
  | 'waves'
  | 'buzz';

export type HairStyleId =
  | 'short-back-and-sides'
  | 'slick-side-part'
  | 'pompadour'
  | 'victory-rolls'
  | 'pin-curls'
  | 'buzz-cut'
  | 'mod-bob'
  | 'beehive'
  | 'mop-top'
  | 'bouffant'
  | 'long-straight'
  | 'big-hair'
  | 'perm-curls'
  | 'mullet'
  | 'shag-cut'
  | 'flat-fringe'
  | 'textured-crop'
  | 'frosted-tips'
  | 'messy-bun'
  | 'highlighted-waves'
  | 'undercut-fade'
  | 'curtain-waves'
  | 'top-knot'
  | 'soft-curls';

export interface HairStyle {
  readonly id: HairStyleId;
  /** Era-exact label (`'beehive'`). */
  readonly label: string;
  /** First year the style reads as period correct. */
  readonly introduced: number;
  readonly silhouette: HairSilhouette;
  /** `0` = close to the skull, `1` = enormous. */
  readonly volume: number;
  /** `0` = crop, `1` = below the shoulders. */
  readonly length: number;
  /** Index into the era's hair tone ramp, before the figure's own offset. */
  readonly colorTone: number;
}

function hair(
  id: HairStyleId,
  label: string,
  introduced: number,
  silhouette: HairSilhouette,
  volume: number,
  length: number,
  colorTone: number,
): HairStyle {
  return Object.freeze({ id, label, introduced, silhouette, volume, length, colorTone });
}

/** Every hairstyle the figure rig can wear, with its introduction year. */
export const HAIR_STYLES: Readonly<Record<HairStyleId, HairStyle>> = Object.freeze({
  'short-back-and-sides': hair('short-back-and-sides', 'short back and sides', 1900, 'crop', 0.25, 0.15, 0),
  'slick-side-part': hair('slick-side-part', 'slick side part', 1900, 'side-part', 0.3, 0.2, 0),
  pompadour: hair('pompadour', 'brilliantined pompadour', 1925, 'pompadour', 0.55, 0.25, 1),
  'victory-rolls': hair('victory-rolls', 'victory rolls', 1940, 'victory-rolls', 0.6, 0.35, 1),
  'pin-curls': hair('pin-curls', 'pin curls', 1930, 'curls', 0.5, 0.3, 2),
  'buzz-cut': hair('buzz-cut', 'army buzz cut', 1917, 'buzz', 0.1, 0.1, 0),
  'mod-bob': hair('mod-bob', 'sharp mod bob', 1963, 'bob', 0.45, 0.3, 1),
  beehive: hair('beehive', 'backcombed beehive', 1960, 'beehive', 0.85, 0.3, 1),
  'mop-top': hair('mop-top', 'fringe mop top', 1963, 'shag', 0.5, 0.35, 0),
  bouffant: hair('bouffant', 'sprayed bouffant', 1955, 'bouffant', 0.8, 0.35, 2),
  'long-straight': hair('long-straight', 'long straight hair', 1960, 'long-straight', 0.35, 0.85, 1),
  'big-hair': hair('big-hair', 'teased big hair', 1982, 'bouffant', 1, 0.6, 2),
  'perm-curls': hair('perm-curls', 'permed curls', 1980, 'curls', 0.85, 0.4, 2),
  mullet: hair('mullet', 'business-in-front mullet', 1978, 'mullet', 0.6, 0.7, 1),
  'shag-cut': hair('shag-cut', 'layered shag cut', 1976, 'shag', 0.7, 0.5, 1),
  'flat-fringe': hair('flat-fringe', 'blunt flat fringe', 1983, 'bob', 0.5, 0.3, 0),
  'textured-crop': hair('textured-crop', 'textured short crop', 1998, 'crop', 0.35, 0.2, 0),
  'frosted-tips': hair('frosted-tips', 'frosted spiky tips', 2001, 'crop', 0.45, 0.2, 2),
  'messy-bun': hair('messy-bun', 'messy top bun', 2000, 'bun', 0.4, 0.5, 1),
  'highlighted-waves': hair('highlighted-waves', 'highlighted waves', 2002, 'waves', 0.5, 0.7, 2),
  'undercut-fade': hair('undercut-fade', 'skin fade undercut', 2013, 'crop', 0.3, 0.25, 0),
  'curtain-waves': hair('curtain-waves', 'curtain waves', 2015, 'waves', 0.55, 0.6, 1),
  'top-knot': hair('top-knot', 'tight top knot', 2012, 'top-knot', 0.35, 0.55, 0),
  'soft-curls': hair('soft-curls', 'soft defined curls', 2015, 'curls', 0.6, 0.6, 2),
});

/** Every style id, sorted for stable diagnostics. */
export const HAIR_STYLE_IDS: readonly HairStyleId[] = Object.freeze(
  Object.keys(HAIR_STYLES).sort() as HairStyleId[],
);

/** Looks up a hairstyle, throwing for an unknown id. */
export function hairStyle(id: HairStyleId): HairStyle {
  const style = HAIR_STYLES[id];
  if (!style) throw new RangeError(`Unknown hairstyle "${id}".`);
  return style;
}

/** Chronology guard for hairstyles: ids that did not exist yet in `year`. */
export function hairConflicts(year: YearId, ids: readonly HairStyleId[]): readonly string[] {
  const limit = Number.parseInt(year, 10);
  const problems: string[] = [];
  for (const id of ids) {
    const style = HAIR_STYLES[id];
    if (!style) {
      problems.push(`unknown hairstyle "${id}"`);
      continue;
    }
    if (style.introduced > limit) {
      problems.push(`hairstyle "${id}" (${style.introduced}) is anachronistic in ${year}`);
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Era palettes                                                              */
/* -------------------------------------------------------------------------- */

/** One era's skin, hair and garment colour ramps. Values are CSS colours. */
export interface PatronPalette {
  /** Skin tones, darkest to lightest, indexed by a figure's skin tone. */
  readonly skinTones: readonly string[];
  /** Hair tones, indexed by a hairstyle's tone plus the figure's offset. */
  readonly hairTones: readonly string[];
  /** Garment dye ramp a figure's `colorway` indexes into. */
  readonly dyeRamp: readonly string[];
  /** Small accents: buttons, trim, bag leather, lanyards. */
  readonly accents: readonly string[];
  readonly notes?: readonly string[];
}

/** Wraps an index into a non-empty list, so colourway indices never overflow. */
export function rampColor(ramp: readonly string[], index: number): string {
  const fallback = ramp[0] ?? '#808080';
  if (ramp.length === 0 || !Number.isFinite(index)) return fallback;
  const wrapped = ((Math.trunc(index) % ramp.length) + ramp.length) % ramp.length;
  return ramp[wrapped] ?? fallback;
}

/* -------------------------------------------------------------------------- */
/* Procedural figure textures                                                 */
/* -------------------------------------------------------------------------- */

/** Default procedural map resolution; figures are low detail on purpose. */
export const DEFAULT_FIGURE_TEXTURE_SIZE = 64;

export interface FigureTextureStyle {
  readonly key: string;
  readonly pattern: FigurePattern;
  /** Base paint colour. */
  readonly base: string;
  /** Pattern ink colour. */
  readonly accent: string;
  /** Square resolution; defaults to {@link DEFAULT_FIGURE_TEXTURE_SIZE}. */
  readonly size?: number;
  /** Paint seed; defaults to a hash of the key. */
  readonly seed?: number;
}

export interface FigureTextureOptions {
  readonly canvasFactory?: CanvasFactory;
  readonly size?: number;
  readonly height?: number;
}

export interface FigureTexture {
  readonly key: string;
  readonly pattern: FigurePattern;
  readonly width: number;
  readonly height: number;
  /** Backend that materialised the map. */
  readonly source: 'canvas' | 'data';
  readonly texture: THREE.Texture;
  readonly canvas: HTMLCanvasElement | null;
}

function paintPattern(buffer: PixelBuffer, pattern: FigurePattern, seed: number): void {
  const base = parseColor('#d2d2d2');
  const accent = parseColor('#8e8e8e');
  const soft = shade(base, 0.9);
  const deep = shade(accent, 0.8);
  const random = createSeededRandom(seed);
  const width = buffer.width;
  const height = buffer.height;

  buffer.fill(base);

  switch (pattern) {
    case 'solid':
      return;
    case 'stripe': {
      const pitch = Math.max(Math.round(width / 10), 4);
      const band = Math.max(Math.round(pitch / 3), 1);
      for (let x = 0; x < width; x += pitch) buffer.fillRect(x, 0, band, height, accent);
      return;
    }
    case 'check': {
      const pitch = Math.max(Math.round(width / 6), 5);
      for (let x = 0; x < width; x += pitch) buffer.fillRect(x, 0, 2, height, accent);
      for (let y = 0; y < height; y += pitch) buffer.fillRect(0, y, width, 2, accent);
      return;
    }
    case 'twill': {
      for (let offset = -height; offset < width; offset += 4) {
        buffer.line(offset, 0, offset + height, height, accent, 1);
      }
      return;
    }
    case 'denim': {
      for (let offset = -height; offset < width; offset += 4) {
        buffer.line(offset, 0, offset + height, height, accent, 1);
      }
      for (let y = 0; y < height; y += 5) buffer.fillRect(0, y, width, 1, soft);
      return;
    }
    case 'knit': {
      const pitch = Math.max(Math.round(height / 8), 4);
      for (let y = 0; y < height; y += pitch) {
        for (let x = 0; x < width; x += pitch) {
          buffer.line(x, y + pitch, x + pitch / 2, y, accent, 2);
          buffer.line(x + pitch / 2, y, x + pitch, y + pitch, accent, 2);
        }
      }
      return;
    }
    case 'floral': {
      const clusters = 7;
      for (let cluster = 0; cluster < clusters; cluster += 1) {
        const cx = Math.round(random() * width);
        const cy = Math.round(random() * height);
        for (let petal = 0; petal < 5; petal += 1) {
          const angle = (petal / 5) * Math.PI * 2;
          buffer.fillRect(
            cx + Math.round(Math.cos(angle) * 3),
            cy + Math.round(Math.sin(angle) * 3),
            2,
            2,
            accent,
          );
        }
        buffer.fillRect(cx, cy, 1, 1, deep);
      }
      return;
    }
    case 'print': {
      const pitch = Math.max(Math.round(width / 8), 6);
      for (let y = 0; y < height; y += pitch) {
        for (let x = 0; x < width; x += pitch) {
          const offset = (y / pitch) % 2 === 0 ? 0 : Math.round(pitch / 2);
          buffer.fillRect(x + offset, y, 2, 2, accent);
          buffer.line(x + offset + 3, y + 3, x + offset + 5, y + 3, soft, 1);
        }
      }
      return;
    }
    case 'quilt': {
      const pitch = Math.max(Math.round(width / 5), 6);
      for (let offset = -height; offset < width; offset += pitch) {
        buffer.line(offset, 0, offset + height, height, accent, 1);
        buffer.line(offset + height, 0, offset, height, accent, 1);
      }
      return;
    }
    case 'mesh': {
      for (let x = 0; x < width; x += 3) buffer.fillRect(x, 0, 1, height, accent);
      for (let y = 0; y < height; y += 3) buffer.fillRect(0, y, width, 1, soft);
      return;
    }
    default: {
      return;
    }
  }
}

function applyTextureSettings(texture: THREE.Texture, key: string, seed: number): void {
  texture.name = `patron:${key}`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.userData['patron'] = { key, seed };
}

function clampSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_FIGURE_TEXTURE_SIZE;
  return Math.max(Math.round(value), 8);
}

/**
 * Paints one procedural figure map. Uses a canvas when the DOM (or a supplied
 * factory) is available and a `DataTexture` otherwise, so a headless test run
 * produces exactly the same pattern with no network and no filesystem access.
 */
export function createFigureTexture(
  style: FigureTextureStyle,
  options: FigureTextureOptions = {},
): FigureTexture {
  const width = clampSize(options.size ?? style.size);
  const height = clampSize(options.height ?? width);
  const buffer = new PixelBuffer(width, height);
  const seed = style.seed ?? hashString(`${style.key}:${style.pattern}`);
  paintPattern(buffer, style.pattern, seed);
  buffer.noise(createSeededRandom(seed ^ 0x9e3779b9), style.pattern === 'solid' ? 0.08 : 0.16);

  const factory = options.canvasFactory ?? defaultCanvasFactory;
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = factory(width, height);
  } catch {
    canvas = null;
  }
  const context = canvas ? canvas.getContext('2d') : null;

  if (canvas && context) {
    const image = context.createImageData(width, height);
    image.data.set(buffer.data);
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    applyTextureSettings(texture, style.key, seed);
    return { key: style.key, pattern: style.pattern, width, height, source: 'canvas', texture, canvas };
  }

  const texture = new THREE.DataTexture(buffer.data, width, height, THREE.RGBAFormat);
  applyTextureSettings(texture, style.key, seed);
  return { key: style.key, pattern: style.pattern, width, height, source: 'data', texture, canvas: null };
}

/* -------------------------------------------------------------------------- */
/* Material library                                                          */
/* -------------------------------------------------------------------------- */

/** Non-fabric surfaces the props and shoes are made of. */
export type FigurePanelKind =
  | 'newsprint'
  | 'paper-cup'
  | 'reusable-cup'
  | 'screen-lit'
  | 'screen-dim'
  | 'radio-dial'
  | 'cassette-window'
  | 'brand-plate'
  | 'headphone-cup'
  | 'plastic'
  | 'metal'
  | 'sole'
  | 'glass'
  | 'gloss-black'
  | 'white-plastic'
  | 'leather';

export const FIGURE_PANEL_KINDS: readonly FigurePanelKind[] = Object.freeze([
  'newsprint',
  'paper-cup',
  'reusable-cup',
  'screen-lit',
  'screen-dim',
  'radio-dial',
  'cassette-window',
  'brand-plate',
  'headphone-cup',
  'plastic',
  'metal',
  'sole',
  'glass',
  'gloss-black',
  'white-plastic',
  'leather',
]);

interface PanelRecipe {
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly pattern?: FigurePattern;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
}

const PANEL_RECIPES: Readonly<Record<FigurePanelKind, PanelRecipe>> = Object.freeze({
  newsprint: { color: '#efe9df', roughness: 0.9, metalness: 0, pattern: 'print' },
  'paper-cup': { color: '#f2ece0', roughness: 0.85, metalness: 0, pattern: 'stripe' },
  'reusable-cup': { color: '#2f6f62', roughness: 0.6, metalness: 0, pattern: 'mesh' },
  'screen-lit': {
    color: '#dfeaff',
    roughness: 0.25,
    metalness: 0.1,
    pattern: 'mesh',
    emissive: '#7fb2ff',
    emissiveIntensity: 0.7,
  },
  'screen-dim': {
    color: '#1b1e26',
    roughness: 0.3,
    metalness: 0.1,
    pattern: 'mesh',
    emissive: '#31415f',
    emissiveIntensity: 0.25,
  },
  'radio-dial': { color: '#e6dcc4', roughness: 0.55, metalness: 0.15, pattern: 'stripe' },
  'cassette-window': { color: '#22262c', roughness: 0.35, metalness: 0.2, pattern: 'check' },
  'brand-plate': { color: '#b9bcc2', roughness: 0.35, metalness: 0.65, pattern: 'stripe' },
  'headphone-cup': { color: '#2b2f36', roughness: 0.45, metalness: 0.25 },
  plastic: { color: '#3a3f47', roughness: 0.5, metalness: 0.05, pattern: 'solid' },
  metal: { color: '#9aa0a8', roughness: 0.3, metalness: 0.8 },
  sole: { color: '#d8d5cf', roughness: 0.8, metalness: 0 },
  glass: { color: '#cfe4ee', roughness: 0.1, metalness: 0.05 },
  'gloss-black': { color: '#15171a', roughness: 0.18, metalness: 0.2 },
  'white-plastic': { color: '#e8e6e1', roughness: 0.4, metalness: 0.05 },
  leather: { color: '#4a3428', roughness: 0.65, metalness: 0.1 },
});

export interface FigureMaterialLibraryOptions {
  readonly canvasFactory?: CanvasFactory;
  /** Map resolution override for the fabrics. */
  readonly textureSize?: number;
}

/**
 * The materials one era's figure set is drawn with: three skin tones, four hair
 * tones, a lazily built dye ramp (colourway × pattern) and the shared prop
 * surfaces. Materials are shared across every figure, so `dispose` releases the
 * whole set in one pass.
 */
export interface FigureMaterialLibrary {
  readonly id: string;
  readonly year: YearId;
  readonly palette: PatronPalette;
  readonly materialCount: number;
  readonly textureCount: number;
  /** Procedural maps built so far. */
  textures(): readonly FigureTexture[];
  materialNames(): readonly string[];
  skin(tone: number): THREE.MeshStandardMaterial;
  hair(tone: number): THREE.MeshStandardMaterial;
  dye(colorway: number, pattern: FigurePattern): THREE.MeshStandardMaterial;
  panel(kind: FigurePanelKind): THREE.MeshStandardMaterial;
  accent(index: number): THREE.MeshStandardMaterial;
  dispose(): void;
}

class MaterialLibrary implements FigureMaterialLibrary {
  readonly id: string;
  readonly palette: PatronPalette;
  private readonly yearValue: YearId;
  private readonly options: FigureMaterialLibraryOptions;
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly maps = new Map<string, FigureTexture>();
  private disposed = false;

  constructor(year: YearId, palette: PatronPalette, options: FigureMaterialLibraryOptions) {
    this.yearValue = year;
    this.palette = palette;
    this.options = options;
    this.id = `patron:${year}`;
  }

  get year(): YearId {
    return this.yearValue;
  }

  get materialCount(): number {
    return this.materials.size;
  }

  get textureCount(): number {
    return this.maps.size;
  }

  textures(): readonly FigureTexture[] {
    return Object.freeze([...this.maps.values()]);
  }

  materialNames(): readonly string[] {
    return Object.freeze([...this.materials.keys()].sort());
  }

  skin(tone: number): THREE.MeshStandardMaterial {
    const color = rampColor(this.palette.skinTones, tone);
    return this.cached(`skin:${tone}`, color, { roughness: 0.72, metalness: 0.02 });
  }

  hair(tone: number): THREE.MeshStandardMaterial {
    const color = rampColor(this.palette.hairTones, tone);
    return this.cached(`hair:${tone}`, color, { roughness: 0.55, metalness: 0.04 });
  }

  accent(index: number): THREE.MeshStandardMaterial {
    const color = rampColor(this.palette.accents, index);
    return this.cached(`accent:${index}`, color, { roughness: 0.5, metalness: 0.08 });
  }

  dye(colorway: number, pattern: FigurePattern): THREE.MeshStandardMaterial {
    const key = `dye:${colorway}:${pattern}`;
    const existing = this.materials.get(key);
    if (existing) return existing;
    const color = rampColor(this.palette.dyeRamp, colorway);
    const map = this.map(key, pattern);
    const material = new THREE.MeshStandardMaterial({
      name: `${this.id}:${key}`,
      color: new THREE.Color(color),
      map: map.texture,
      roughness: pattern === 'denim' ? 0.82 : pattern === 'knit' ? 0.92 : 0.68,
      metalness: 0.02,
    });
    this.materials.set(key, material);
    return material;
  }

  panel(kind: FigurePanelKind): THREE.MeshStandardMaterial {
    const key = `panel:${kind}`;
    const existing = this.materials.get(key);
    if (existing) return existing;
    const recipe = PANEL_RECIPES[kind];
    const material = new THREE.MeshStandardMaterial({
      name: `${this.id}:${key}`,
      color: new THREE.Color(recipe.color),
      roughness: recipe.roughness,
      metalness: recipe.metalness,
    });
    if (recipe.pattern !== undefined && recipe.pattern !== 'solid') {
      material.map = this.map(key, recipe.pattern).texture;
    }
    if (recipe.emissive !== undefined) {
      material.emissive = new THREE.Color(recipe.emissive);
      material.emissiveIntensity = recipe.emissiveIntensity ?? 0.4;
    }
    this.materials.set(key, material);
    return material;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const texture of this.maps.values()) texture.texture.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.maps.clear();
    this.materials.clear();
  }

  private cached(
    key: string,
    color: string,
    surface: { roughness: number; metalness: number },
  ): THREE.MeshStandardMaterial {
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new THREE.MeshStandardMaterial({
      name: `${this.id}:${key}`,
      color: new THREE.Color(color),
      roughness: surface.roughness,
      metalness: surface.metalness,
    });
    this.materials.set(key, material);
    return material;
  }

  private map(key: string, pattern: FigurePattern): FigureTexture {
    const existing = this.maps.get(key);
    if (existing) return existing;
    const texture = createFigureTexture(
      { key: `${this.yearValue}-${key}`, pattern, base: '#d2d2d2', accent: '#8e8e8e' },
      { canvasFactory: this.options.canvasFactory, size: this.options.textureSize },
    );
    this.maps.set(key, texture);
    return texture;
  }
}

/** Creates the material library for one era's palette. */
export function createFigureMaterialLibrary(
  year: YearId,
  palette: PatronPalette,
  options: FigureMaterialLibraryOptions = {},
): FigureMaterialLibrary {
  return new MaterialLibrary(year, palette, options);
}
