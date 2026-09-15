/**
 * 1945 — the hand-chalked slate.
 *
 * A patched-up corner café still living under rationing. The menu is chalked
 * afresh each morning on a riven slate in a stained oak surround, in pre-decimal
 * money that nobody had to think about: a cup of tea is a penny, coffee tuppence.
 * The kitchen is honest about the ration — where an ingredient has gone short it
 * offers the substitute and prices it, so the board carries a substitute-price
 * line under the dish it replaces.
 */

import { menuPrice } from '../types';
import type { MenuBoardSpec } from '../types';

export const SPEC_1945: MenuBoardSpec = {
  year: '1945',
  label: '1945',
  name: 'Post-war austerity',
  summary:
    'Chalk on slate in a stained oak frame: penny tea, tuppenny coffee, and the kitchen telling you plainly what the ration would not stretch to.',
  boardKind: 'chalk-slate',
  boardName: 'Hand-chalked slate',
  heading: 'THE CORNER CAFE',
  subheading: 'TEAS · SNACKS · SOMETHING WARM',
  currency: 'gbp-predecimal',
  lettering: 'hand-chalk',
  sections: [
    { id: 'hot-drinks', label: 'Teas & coffee', note: 'Milk when the jug is out' },
    { id: 'cold-drinks', label: 'Cold drinks' },
    { id: 'savoury', label: 'Cooked & cold' },
    { id: 'sweet', label: 'Sweet things' },
  ],
  panels: [
    { id: 'drinks', title: 'TEAS & COFFEE', sectionIds: ['hot-drinks', 'cold-drinks'] },
    { id: 'kitchen', title: 'KITCHEN', sectionIds: ['savoury', 'sweet'] },
  ],
  items: [
    {
      id: 'tea',
      section: 'hot-drinks',
      name: 'Tea, cup',
      description: 'Brewed from the ration tin, in a thick cup.',
      price: menuPrice('1d'),
      note: 'Sugar short — bring your own if you take it.',
      tags: ['rationed'],
    },
    {
      id: 'coffee',
      section: 'hot-drinks',
      name: 'Coffee, cup',
      description: 'Bottle coffee with hot milk, served thick.',
      price: menuPrice('2d'),
      tags: ['benchmark'],
    },
    {
      id: 'cocoa',
      section: 'hot-drinks',
      name: 'Cocoa, cup',
      description: 'Mixed with National dried milk, stirred well.',
      price: menuPrice('2d'),
      note: 'No cream.',
    },
    {
      id: 'lemonade',
      section: 'cold-drinks',
      name: 'Lemonade, glass',
      description: 'Made up in the back room, with a slice if there is one.',
      price: menuPrice('2d'),
    },
    {
      id: 'iced-milk',
      section: 'cold-drinks',
      name: 'Iced milk',
      description: 'Chilled overnight on the slab in the back room.',
      price: menuPrice('3d'),
    },
    {
      id: 'bread-butter',
      section: 'savoury',
      name: 'Bread & butter',
      description: 'Two slices, cut thin, on a plate.',
      price: menuPrice('1d'),
      note: 'Margarine on the ration.',
    },
    {
      id: 'cheese-sandwich',
      section: 'savoury',
      name: 'Cheese & chutney sandwich',
      description: 'National cheese and homemade chutney, brown bread.',
      price: menuPrice('4d'),
      note: 'One per customer while it lasts.',
      substitute: {
        name: 'Dripping on bread',
        price: menuPrice('2d'),
        note: 'When the cheese van is late.',
      },
    },
    {
      id: 'spam-fritter',
      section: 'savoury',
      name: 'Spam fritter with pickle',
      description: 'Fried in batter, straight from the pan.',
      price: menuPrice('5d'),
      tags: ['hot'],
    },
    {
      id: 'meat-pie',
      section: 'savoury',
      name: 'Hot meat pie',
      description: 'Minced beef and potato, kept warm in the cabinet.',
      price: menuPrice('6d'),
      note: 'Sold out most days by noon.',
    },
    {
      id: 'seed-cake',
      section: 'sweet',
      name: 'Seed cake, slice',
      description: 'Caraway, cut thick and buttered.',
      price: menuPrice('2d'),
    },
    {
      id: 'jam-tart',
      section: 'sweet',
      name: 'Jam tart',
      description: 'Damson jam from the last of the preserves.',
      price: menuPrice('2d'),
    },
    {
      id: 'rice-pudding',
      section: 'sweet',
      name: 'Rice pudding, saucer',
      description: 'Baked slowly in the oven with a nutmeg top.',
      price: menuPrice('3d'),
      note: 'Evaporated milk, not fresh.',
    },
  ],
  boardNote: 'RATIONS ARE SHORT — SUBSTITUTES SERVED ON REQUEST',
  surface: {
    face: '#2f3538',
    faceAccent: '#4a5459',
    faceShadow: '#171b1d',
    ink: '#f2efe4',
    inkAccent: '#e3d09a',
    frame: '#4a3524',
    trim: '#8c6b3f',
    glow: '#f7f1de',
    roughness: 0.92,
    metalness: 0.02,
    wear: 0.62,
  },
  benchmarkItemId: 'coffee',
  tags: ['chalk', 'slate', 'rationing', 'pre-decimal', 'wartime'],
  notes: [
    'Chalk on slate, wiped with a damp cloth and re-chalked each morning.',
    'Pre-decimal money: twelve pence to the shilling, written 1d, 6d, 1/3.',
    'Every shortage is priced openly — the substitute line is part of the menu.',
    'Rationing of sugar, butter, cheese and meat shaped the whole board.',
  ],
};
