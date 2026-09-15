/** 1945 patron inventory: rationing-era uniforms, hats, print and tobacco. */
import type { DomainSpecBase, YearId } from '../../../contracts/period';
import type { FigureBlueprint } from '../figures/FigureRig';
import type { PatronPalette } from '../figures/Wardrobe';

export interface PatronSpec extends DomainSpecBase {
  readonly year: YearId;
  readonly name: string;
  readonly palette: PatronPalette;
  readonly figures: readonly FigureBlueprint[];
  readonly patronCount: number;
  readonly occupancy: number;
  readonly density: number;
  readonly tags: readonly string[];
}

const palette: PatronPalette = Object.freeze({
  skinTones: ['#8b5a3c', '#b87955', '#d29a76', '#e5b18f'],
  hairTones: ['#1e1715', '#39251b', '#6a4129', '#9b7048'],
  dyeRamp: ['#344039', '#665846', '#806b52', '#8e3d32', '#b19a73', '#f0e6d1'],
  accents: ['#292522', '#755139', '#b89e73', '#e4d7bd', '#a33e32', '#f7f1e4'],
  notes: ['utility tailoring', 'ration-book muted dyes', 'hand-knitted details'],
});

const barista: FigureBlueprint = {
  id: '1945-barista', role: 'barista', pose: 'standing', zone: 'counter', stature: 1.74,
  presentation: 'menswear', hair: 'short-back-and-sides', skinTone: 1, hairToneOffset: 1,
  garments: [
    { slot: 'top', item: 'utility-shirt', colorway: 0 },
    { slot: 'bottom', item: 'utility-trousers', colorway: 1 },
    { slot: 'accessory', item: 'barista-apron', colorway: 5 },
    { slot: 'headwear', item: 'flat-cap', colorway: 1 },
    { slot: 'footwear', item: 'brogues', colorway: 0 },
  ],
  gadgets: ['coffee-cup'], motion: 'wipe-counter',
  caption: 'The 1945 server wears a white bib apron over utility wool and a tweed flat cap.',
};

const figures: readonly FigureBlueprint[] = Object.freeze([
  barista,
  {
    id: '1945-reader', role: 'patron', pose: 'seated', zone: 'table', stature: 1.68,
    presentation: 'menswear', hair: 'slick-side-part', skinTone: 2,
    garments: [
      { slot: 'top', item: 'utility-shirt', colorway: 1 },
      { slot: 'bottom', item: 'utility-trousers', colorway: 2 },
      { slot: 'outerwear', item: 'uniform-waistcoat', colorway: 0 },
      { slot: 'accessory', item: 'narrow-wool-tie', colorway: 1 },
      { slot: 'headwear', item: 'fedora', colorway: 1 },
      { slot: 'footwear', item: 'brogues', colorway: 0 },
    ],
    gadgets: ['newspaper', 'coffee-cup'], motion: 'read-newspaper',
    caption: 'A flat-capped regular studies the folded broadsheet over a thick coffee cup.',
  },
  {
    id: '1945-worker', role: 'patron', pose: 'seated', zone: 'table', stature: 1.71,
    presentation: 'menswear', hair: 'buzz-cut', skinTone: 0,
    garments: [
      { slot: 'top', item: 'utility-shirt', colorway: 2 },
      { slot: 'bottom', item: 'utility-trousers', colorway: 0 },
      { slot: 'outerwear', item: 'wool-coat', colorway: 1 },
      { slot: 'headwear', item: 'flat-cap', colorway: 2 },
      { slot: 'footwear', item: 'brogues', colorway: 1 },
    ],
    gadgets: ['cigarette', 'coffee-cup'], motion: 'sip-coffee',
    caption: 'A wartime worker pauses with a cigarette, wool overcoat and ration-era tailoring.',
  },
  {
    id: '1945-tea-dress', role: 'patron', pose: 'seated', zone: 'table', stature: 1.62,
    presentation: 'womenswear', hair: 'victory-rolls', skinTone: 3,
    garments: [
      { slot: 'top', item: 'tea-dress', colorway: 4 },
      { slot: 'outerwear', item: 'womens-cardigan', colorway: 4 },
      { slot: 'footwear', item: 'brogues', colorway: 2 },
      { slot: 'headwear', item: 'silk-headscarf', colorway: 4 },
    ],
    gadgets: ['newspaper', 'coffee-cup'], motion: 'read-newspaper',
    caption: 'Victory rolls and a printed tea dress mark a 1945 visitor at the front table.',
  },
  {
    id: '1945-standing', role: 'patron', pose: 'standing', zone: 'standing', stature: 1.77,
    presentation: 'womenswear', hair: 'pin-curls', skinTone: 2,
    garments: [
      { slot: 'top', item: 'tea-dress', colorway: 3 },
      { slot: 'outerwear', item: 'wool-coat', colorway: 0 },
      { slot: 'headwear', item: 'wool-beret', colorway: 0 },
      { slot: 'footwear', item: 'brogues', colorway: 1 },
    ],
    gadgets: ['cigarette'], motion: 'shift-weight',
    caption: 'A beret and belted wool coat give the standing figure a distinctly post-war silhouette.',
  },
]);

export const PATRON_SPEC_1945: PatronSpec = Object.freeze({
  year: '1945', label: '1945', name: 'Post-war coffee room', palette, figures,
  patronCount: 4, occupancy: 0.5, density: 0.42,
  tags: ['uniforms', 'flat caps', 'victory rolls', 'newspapers', 'cigarettes'],
  notes: ['Austerity tailoring and ration-era accessories keep the room subdued.'],
});
export const PATRON_SPECS_1945: Readonly<Record<'1945', PatronSpec>> = Object.freeze({ '1945': PATRON_SPEC_1945 });
