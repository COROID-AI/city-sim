/** 1965 patron inventory: slim tailoring, mod dresses and transistor radios. */
import type { FigureBlueprint } from '../figures/FigureRig';
import type { PatronPalette } from '../figures/Wardrobe';
import type { PatronSpec } from './1945';

const palette: PatronPalette = Object.freeze({
  skinTones: ['#8b5a3c', '#b87955', '#d29a76', '#e5b18f'],
  hairTones: ['#1c1715', '#432b1d', '#795038', '#d0a06e'],
  dyeRamp: ['#142d48', '#e34832', '#f3c441', '#4f8f74', '#f2e6cb', '#30284f'],
  accents: ['#1b2430', '#e34832', '#f2c744', '#f6f0dc', '#477f73', '#d5d9dd'],
  notes: ['slim mod tailoring', 'colour-block shifts', 'portable transistor culture'],
});
const barista: FigureBlueprint = {
  id: '1965-barista', role: 'barista', pose: 'standing', zone: 'counter', stature: 1.74,
  presentation: 'menswear', hair: 'mop-top', skinTone: 1,
  garments: [
    { slot: 'top', item: 'mod-shirt', colorway: 4 },
    { slot: 'bottom', item: 'slim-trousers', colorway: 0 },
    { slot: 'outerwear', item: 'slim-suit-jacket', colorway: 1 },
    { slot: 'accessory', item: 'slim-tie', colorway: 2 },
    { slot: 'footwear', item: 'chelsea-boots', colorway: 0 },
  ],
  gadgets: ['coffee-cup'], motion: 'stir-counter',
  caption: 'The 1965 server works the counter in a narrow-lapelled suit and skinny tie.',
};
const figures: readonly FigureBlueprint[] = Object.freeze([
  barista,
  {
    id: '1965-mod-man', role: 'patron', pose: 'seated', zone: 'table', stature: 1.78,
    presentation: 'menswear', hair: 'mop-top', skinTone: 2,
    garments: [
      { slot: 'top', item: 'mod-shirt', colorway: 5 },
      { slot: 'bottom', item: 'slim-trousers', colorway: 1 },
      { slot: 'outerwear', item: 'slim-suit-jacket', colorway: 0 },
      { slot: 'accessory', item: 'slim-tie', colorway: 3 },
      { slot: 'footwear', item: 'chelsea-boots', colorway: 1 },
    ],
    gadgets: ['transistor-radio', 'coffee-cup'], motion: 'bob-to-radio',
    caption: 'A slim mod suit and transistor radio bring 1965 youth culture to the table.',
  },
  {
    id: '1965-shift', role: 'patron', pose: 'seated', zone: 'table', stature: 1.62,
    presentation: 'womenswear', hair: 'mod-bob', skinTone: 3,
    garments: [
      { slot: 'top', item: 'shift-dress', colorway: 1 },
      { slot: 'bottom', item: 'a-line-skirt', colorway: 2 },
      { slot: 'outerwear', item: 'mod-blazer', colorway: 5 },
      { slot: 'footwear', item: 'canvas-plimsolls', colorway: 5 },
    ],
    gadgets: ['transistor-radio', 'coffee-cup'], motion: 'nurse-cup',
    caption: 'The colour-block shift, mod bob and portable radio are the unmistakable 1965 trio.',
  },
  {
    id: '1965-beehive', role: 'patron', pose: 'seated', zone: 'table', stature: 1.65,
    presentation: 'womenswear', hair: 'beehive', skinTone: 1,
    garments: [
      { slot: 'top', item: 'shift-dress', colorway: 3 },
      { slot: 'outerwear', item: 'trench-coat', colorway: 4 },
      { slot: 'footwear', item: 'penny-loafers', colorway: 0 },
    ],
    gadgets: ['cassette-tape', 'coffee-cup'], motion: 'breathe',
    caption: 'A sprayed beehive and bright shift dress sit beside a labelled compact cassette.',
  },
  {
    id: '1965-standing', role: 'patron', pose: 'standing', zone: 'standing', stature: 1.72,
    presentation: 'menswear', hair: 'slick-side-part', skinTone: 0,
    garments: [
      { slot: 'top', item: 'roll-neck-knit', colorway: 0 },
      { slot: 'bottom', item: 'slim-trousers', colorway: 5 },
      { slot: 'outerwear', item: 'mod-blazer', colorway: 2 },
      { slot: 'headwear', item: 'bucket-hat', colorway: 3 },
      { slot: 'footwear', item: 'penny-loafers', colorway: 1 },
    ],
    gadgets: ['transistor-radio'], motion: 'shift-weight',
    caption: 'A bucket hat, roll neck and transistor radio make a sharp 1965 passer-by.',
  },
]);
export const PATRON_SPEC_1965: PatronSpec = Object.freeze({
  year: '1965', label: '1965', name: 'Mod café', palette, figures,
  patronCount: 4, occupancy: 0.5, density: 0.5,
  tags: ['slim suits', 'mod dresses', 'beehives', 'transistor radios'],
  notes: ['Colour blocking and narrow tailoring replace the austerity palette.'],
});
export const PATRON_SPECS_1965: Readonly<Record<'1965', PatronSpec>> = Object.freeze({ '1965': PATRON_SPEC_1965 });
