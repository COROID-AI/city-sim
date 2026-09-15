/** 1985 patron inventory: denim, shoulder volume, big hair and tape players. */
import type { FigureBlueprint } from '../figures/FigureRig';
import type { PatronPalette } from '../figures/Wardrobe';
import type { PatronSpec } from './1945';

const palette: PatronPalette = Object.freeze({
  skinTones: ['#8b5a3c', '#b87955', '#d29a76', '#e5b18f'],
  hairTones: ['#171419', '#3e261e', '#7d4626', '#d5ad73'],
  dyeRamp: ['#2551a3', '#e44b79', '#f2bf38', '#d9e1e4', '#6e3d9a', '#1e2734'],
  accents: ['#131a2d', '#e44b79', '#f2bf38', '#d9e1e4', '#6e3d9a', '#5d84bf'],
  notes: ['stonewashed denim', 'shoulder pads', 'neon tape culture'],
});
const barista: FigureBlueprint = {
  id: '1985-barista', role: 'barista', pose: 'standing', zone: 'counter', stature: 1.76,
  presentation: 'unisex', hair: 'mullet', skinTone: 1,
  garments: [
    { slot: 'top', item: 'band-tee', colorway: 3 },
    { slot: 'bottom', item: 'straight-jeans', colorway: 0 },
    { slot: 'outerwear', item: 'denim-jacket', colorway: 0 },
    { slot: 'accessory', item: 'oversized-sunglasses', colorway: 4 },
    { slot: 'footwear', item: 'chunky-high-tops', colorway: 3 },
  ],
  gadgets: ['coffee-cup'], motion: 'wipe-counter',
  caption: 'The 1985 barista wears stonewash denim, a graphic tee and a high-volume mullet.',
};
const figures: readonly FigureBlueprint[] = Object.freeze([
  barista,
  {
    id: '1985-walkman', role: 'patron', pose: 'seated', zone: 'table', stature: 1.7,
    presentation: 'unisex', hair: 'big-hair', skinTone: 2,
    garments: [
      { slot: 'top', item: 'band-tee', colorway: 1 },
      { slot: 'bottom', item: 'straight-jeans', colorway: 0 },
      { slot: 'outerwear', item: 'shoulder-pad-blazer', colorway: 4 },
      { slot: 'footwear', item: 'chunky-high-tops', colorway: 2 },
    ],
    gadgets: ['walkman', 'shoulder-bag', 'coffee-cup'], motion: 'bob-to-radio',
    caption: 'Big hair, a denim jacket and a belt-clipped Walkman define this 1985 listener.',
  },
  {
    id: '1985-denim', role: 'patron', pose: 'seated', zone: 'table', stature: 1.66,
    presentation: 'womenswear', hair: 'perm-curls', skinTone: 3,
    garments: [
      { slot: 'top', item: 'aerobics-leotard', colorway: 2 },
      { slot: 'bottom', item: 'denim-mini-skirt', colorway: 0 },
      { slot: 'outerwear', item: 'varsity-bomber', colorway: 1 },
      { slot: 'accessory', item: 'leg-warmers', colorway: 2 },
      { slot: 'footwear', item: 'chunky-high-tops', colorway: 3 },
    ],
    gadgets: ['shoulder-bag', 'cassette-tape'], motion: 'nurse-cup',
    caption: 'Perm curls, a denim mini and a shoulder bag read as an 80s café regular.',
  },
  {
    id: '1985-boombox', role: 'patron', pose: 'standing', zone: 'standing', stature: 1.79,
    presentation: 'menswear', hair: 'frosted-tips', skinTone: 0,
    garments: [
      { slot: 'top', item: 'band-tee', colorway: 5 },
      { slot: 'bottom', item: 'straight-jeans', colorway: 1 },
      { slot: 'outerwear', item: 'varsity-bomber', colorway: 2 },
      { slot: 'headwear', item: 'mesh-trucker-cap', colorway: 4 },
      { slot: 'footwear', item: 'laced-work-boots', colorway: 1 },
    ],
    gadgets: ['boombox', 'shoulder-bag'], motion: 'sway-window',
    caption: 'A shoulder-carried boombox and frosted tips make the standing figure an 1985 snapshot.',
  },
  {
    id: '1985-shag', role: 'patron', pose: 'seated', zone: 'table', stature: 1.73,
    presentation: 'unisex', hair: 'shag-cut', skinTone: 1,
    garments: [
      { slot: 'top', item: 'band-tee', colorway: 4 },
      { slot: 'bottom', item: 'straight-jeans', colorway: 0 },
      { slot: 'outerwear', item: 'denim-jacket', colorway: 0 },
      { slot: 'footwear', item: 'laced-work-boots', colorway: 0 },
    ],
    gadgets: ['walkman', 'coffee-cup'], motion: 'tap-watch',
    caption: 'A layered shag and second Walkman complete the café’s 1985 tape culture.',
  },
]);
export const PATRON_SPEC_1985: PatronSpec = Object.freeze({
  year: '1985', label: '1985', name: 'Neon tape café', palette, figures,
  patronCount: 4, occupancy: 0.5, density: 0.58,
  tags: ['big hair', 'denim', 'shoulder pads', 'Walkman', 'shoulder bags'],
  notes: ['Volume, bright accents and portable cassette players dominate the silhouette.'],
});
export const PATRON_SPECS_1985: Readonly<Record<'1985', PatronSpec>> = Object.freeze({ '1985': PATRON_SPEC_1985 });
