/** 2025 patron inventory: athleisure, connected devices and reusable coffee gear. */
import type { FigureBlueprint } from '../figures/FigureRig';
import type { PatronPalette } from '../figures/Wardrobe';
import type { PatronSpec } from './1945';

const palette: PatronPalette = Object.freeze({
  skinTones: ['#8b5a3c', '#b87955', '#d29a76', '#e5b18f'],
  hairTones: ['#161719', '#4a3022', '#91603c', '#d5ae78'],
  dyeRamp: ['#192a38', '#547d79', '#d5b46b', '#e7e5df', '#a96787', '#39465e'],
  accents: ['#19222d', '#547d79', '#d5b46b', '#e7e5df', '#a96787', '#95b9c2'],
  notes: ['technical knitwear', 'athleisure layering', 'reusable cup culture'],
});
const barista: FigureBlueprint = {
  id: '2025-barista', role: 'barista', pose: 'standing', zone: 'counter', stature: 1.74,
  presentation: 'unisex', hair: 'undercut-fade', skinTone: 1,
  garments: [
    { slot: 'top', item: 'athleisure-top', colorway: 3 },
    { slot: 'bottom', item: 'performance-joggers', colorway: 0 },
    { slot: 'outerwear', item: 'puffer-jacket', colorway: 1 },
    { slot: 'footwear', item: 'knit-running-shoes', colorway: 5 },
  ],
  gadgets: ['reusable-cup', 'smartphone'], motion: 'stir-counter',
  caption: 'The 2025 barista wears technical layers, carries a smartphone and serves into a keep-cup.',
};
const figures: readonly FigureBlueprint[] = Object.freeze([
  barista,
  {
    id: '2025-headphones', role: 'patron', pose: 'seated', zone: 'table', stature: 1.68,
    presentation: 'womenswear', hair: 'curtain-waves', skinTone: 3,
    garments: [
      { slot: 'top', item: 'oversized-knit', colorway: 4 },
      { slot: 'bottom', item: 'compression-leggings', colorway: 0 },
      { slot: 'outerwear', item: 'puffer-jacket', colorway: 2 },
      { slot: 'footwear', item: 'knit-running-shoes', colorway: 5 },
    ],
    gadgets: ['headphones', 'smartphone', 'reusable-cup'], motion: 'glance-phone',
    caption: 'A drop-shoulder knit, over-ear headphones and a keep-cup make the 2025 profile legible.',
  },
  {
    id: '2025-laptop', role: 'patron', pose: 'seated', zone: 'table', stature: 1.78,
    presentation: 'menswear', hair: 'top-knot', skinTone: 2,
    garments: [
      { slot: 'top', item: 'athleisure-top', colorway: 5 },
      { slot: 'bottom', item: 'performance-joggers', colorway: 1 },
      { slot: 'outerwear', item: 'puffer-jacket', colorway: 0 },
      { slot: 'footwear', item: 'knit-running-shoes', colorway: 3 },
    ],
    gadgets: ['laptop', 'smartphone', 'reusable-cup'], motion: 'type-laptop',
    caption: 'A technical jogger, laptop and reusable cup show the café as a 2025 workplace.',
  },
  {
    id: '2025-earbuds', role: 'patron', pose: 'seated', zone: 'table', stature: 1.64,
    presentation: 'womenswear', hair: 'soft-curls', skinTone: 0,
    garments: [
      { slot: 'top', item: 'athleisure-top', colorway: 1 },
      { slot: 'bottom', item: 'compression-leggings', colorway: 3 },
      { slot: 'outerwear', item: 'oversized-knit', colorway: 4 },
      { slot: 'footwear', item: 'knit-running-shoes', colorway: 2 },
    ],
    gadgets: ['wireless-earbuds', 'smartphone', 'reusable-cup'], motion: 'nurse-cup',
    caption: 'Wireless earbuds, a smartphone and soft technical knitwear mark the newest era.',
  },
  {
    id: '2025-standing', role: 'patron', pose: 'standing', zone: 'window', stature: 1.8,
    presentation: 'unisex', hair: 'undercut-fade', skinTone: 1,
    garments: [
      { slot: 'top', item: 'oversized-knit', colorway: 5 },
      { slot: 'bottom', item: 'performance-joggers', colorway: 2 },
      { slot: 'outerwear', item: 'rain-shell', colorway: 1 },
      { slot: 'footwear', item: 'knit-running-shoes', colorway: 5 },
    ],
    gadgets: ['headphones', 'smartphone'], motion: 'sway-window',
    caption: 'The standing commuter combines a technical shell, headphones and a bright smartphone.',
  },
]);
export const PATRON_SPEC_2025: PatronSpec = Object.freeze({
  year: '2025', label: '2025', name: 'Athleisure work café', palette, figures,
  patronCount: 4, occupancy: 0.5, density: 0.76,
  tags: ['athleisure', 'headphones', 'smartphones', 'laptops', 'reusable cups'],
  notes: ['Connected devices and sustainable reusables share the table with modern performance clothing.'],
});
export const PATRON_SPECS_2025: Readonly<Record<'2025', PatronSpec>> = Object.freeze({ '2025': PATRON_SPEC_2025 });
