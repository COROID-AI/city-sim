/** 2005 patron inventory: layered casualwear and first-generation pocket tech. */
import type { FigureBlueprint } from '../figures/FigureRig';
import type { PatronPalette } from '../figures/Wardrobe';
import type { PatronSpec } from './1945';

const palette: PatronPalette = Object.freeze({
  skinTones: ['#8b5a3c', '#b87955', '#d29a76', '#e5b18f'],
  hairTones: ['#19191b', '#4a3022', '#90603f', '#d5ae78'],
  dyeRamp: ['#263e54', '#d15a4e', '#d2b268', '#d8d8d2', '#6c7694', '#3a2b45'],
  accents: ['#1d2530', '#d15a4e', '#d2b268', '#d8d8d2', '#6c7694', '#614a3c'],
  notes: ['low-rise denim', 'hoodie layering', 'flip-phone and MP3 culture'],
});
const barista: FigureBlueprint = {
  id: '2005-barista', role: 'barista', pose: 'standing', zone: 'counter', stature: 1.74,
  presentation: 'unisex', hair: 'textured-crop', skinTone: 1,
  garments: [
    { slot: 'top', item: 'pique-polo', colorway: 3 },
    { slot: 'bottom', item: 'slim-chinos', colorway: 0 },
    { slot: 'outerwear', item: 'zip-hoodie', colorway: 1 },
    { slot: 'footwear', item: 'running-trainers', colorway: 3 },
  ],
  gadgets: ['coffee-cup'], motion: 'stir-counter',
  caption: 'The 2005 barista layers a zip hoodie over a pique polo and keeps the counter moving.',
};
const figures: readonly FigureBlueprint[] = Object.freeze([
  barista,
  {
    id: '2005-flip', role: 'patron', pose: 'seated', zone: 'table', stature: 1.69,
    presentation: 'womenswear', hair: 'highlighted-waves', skinTone: 3,
    garments: [
      { slot: 'top', item: 'pique-polo', colorway: 4 },
      { slot: 'bottom', item: 'low-rise-jeans', colorway: 0 },
      { slot: 'outerwear', item: 'cropped-cardigan', colorway: 4 },
      { slot: 'footwear', item: 'running-trainers', colorway: 5 },
    ],
    gadgets: ['flip-phone', 'coffee-cup'], motion: 'glance-phone',
    caption: 'Low-rise bootcut jeans, a cropped cardigan and an open flip phone date this patron to 2005.',
  },
  {
    id: '2005-mp3', role: 'patron', pose: 'seated', zone: 'table', stature: 1.76,
    presentation: 'menswear', hair: 'frosted-tips', skinTone: 2,
    garments: [
      { slot: 'top', item: 'checked-flannel', colorway: 1 },
      { slot: 'bottom', item: 'cargo-shorts', colorway: 2 },
      { slot: 'outerwear', item: 'zip-track-jacket', colorway: 0 },
      { slot: 'footwear', item: 'running-trainers', colorway: 4 },
      { slot: 'headwear', item: 'baseball-cap', colorway: 2 },
    ],
    gadgets: ['mp3-player', 'wired-earbuds'], motion: 'bob-to-radio',
    caption: 'A checked layer, cargo shorts and a hard-drive MP3 player are pure mid-2000s casual.',
  },
  {
    id: '2005-laptop', role: 'patron', pose: 'seated', zone: 'table', stature: 1.64,
    presentation: 'womenswear', hair: 'messy-bun', skinTone: 1,
    garments: [
      { slot: 'top', item: 'checked-flannel', colorway: 3 },
      { slot: 'bottom', item: 'low-rise-jeans', colorway: 1 },
      { slot: 'outerwear', item: 'zip-hoodie', colorway: 4 },
      { slot: 'footwear', item: 'running-trainers', colorway: 3 },
    ],
    gadgets: ['laptop', 'coffee-cup'], motion: 'type-laptop',
    caption: 'The open laptop, hoodie and messy bun capture the café worker of 2005.',
  },
  {
    id: '2005-standing', role: 'patron', pose: 'standing', zone: 'window', stature: 1.8,
    presentation: 'unisex', hair: 'textured-crop', skinTone: 0,
    garments: [
      { slot: 'top', item: 'pique-polo', colorway: 2 },
      { slot: 'bottom', item: 'slim-chinos', colorway: 5 },
      { slot: 'outerwear', item: 'rain-shell', colorway: 4 },
      { slot: 'footwear', item: 'running-trainers', colorway: 1 },
    ],
    gadgets: ['flip-phone'], motion: 'shift-weight',
    caption: 'A layered rain shell and flip phone await a ride outside the storefront.',
  },
]);
export const PATRON_SPEC_2005: PatronSpec = Object.freeze({
  year: '2005', label: '2005', name: 'Connected casual café', palette, figures,
  patronCount: 4, occupancy: 0.5, density: 0.64,
  tags: ['casual layers', 'flip phones', 'MP3 players', 'laptops'],
  notes: ['Personal electronics become visible on every table and in every pocket.'],
});
export const PATRON_SPECS_2005: Readonly<Record<'2005', PatronSpec>> = Object.freeze({ '2005': PATRON_SPEC_2005 });
