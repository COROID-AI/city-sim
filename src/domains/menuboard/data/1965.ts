/**
 * 1965 — the painted panel with applied vinyl lettering.
 *
 * The café has been done up: gloss coach paint in two coats, a bright shop
 * window, a Wurlitzer in the corner and a menu said to be modern. The lettering
 * is cut vinyl, applied by hand with a squeegee, so it is crisp but never quite
 * level. Money is still pre-decimal — decimalisation is six years away — and
 * coffee has crept up to sixpence while iced milk and Coca-Cola appear for the
 * first time.
 */

import { menuPrice } from '../types';
import type { MenuBoardSpec } from '../types';

export const SPEC_1965: MenuBoardSpec = {
  year: '1965',
  label: '1965',
  name: 'Mid-century modern',
  summary:
    'A signwriter’s panel in gloss coach paint, vinyl letters squeezed into place by hand, and a menu that has discovered the ice-cream sundae.',
  boardKind: 'painted-vinyl',
  boardName: 'Painted panel with applied vinyl lettering',
  heading: 'THE CORNER CAFE',
  subheading: 'SNACKS · REFRESHMENTS · ICES',
  currency: 'gbp-predecimal',
  lettering: 'applied-vinyl',
  sections: [
    { id: 'hot-drinks', label: 'Coffee & tea' },
    { id: 'cold-drinks', label: 'Cold drinks' },
    { id: 'savoury', label: 'Snacks' },
    { id: 'sweet', label: 'Ices & cakes' },
  ],
  panels: [
    { id: 'refreshments', title: 'REFRESHMENTS', sectionIds: ['hot-drinks', 'cold-drinks'] },
    { id: 'snacks', title: 'SNACKS', sectionIds: ['savoury'] },
    { id: 'ices', title: 'ICES & CAKES', sectionIds: ['sweet'] },
  ],
  items: [
    {
      id: 'tea',
      section: 'hot-drinks',
      name: 'Tea, cup',
      description: 'Pot brewed, poured at the table.',
      price: menuPrice('5d'),
    },
    {
      id: 'coffee',
      section: 'hot-drinks',
      name: 'Coffee, white',
      description: 'Ground coffee and hot milk, or black if you prefer.',
      price: menuPrice('6d'),
      tags: ['benchmark'],
    },
    {
      id: 'instant-coffee',
      section: 'hot-drinks',
      name: 'Instant coffee',
      description: 'Nescafé, made to order in the cup.',
      price: menuPrice('7d'),
    },
    {
      id: 'coca-cola',
      section: 'cold-drinks',
      name: 'Coca-Cola, bottle',
      description: 'Ice cold, straight from the crate.',
      price: menuPrice('8d'),
    },
    {
      id: 'orange-squash',
      section: 'cold-drinks',
      name: 'Orange squash',
      description: 'With soda water or plain water.',
      price: menuPrice('5d'),
    },
    {
      id: 'iced-milk',
      section: 'cold-drinks',
      name: 'Iced milk',
      description: 'Served in a tall glass with a straw.',
      price: menuPrice('6d'),
    },
    {
      id: 'egg-cress',
      section: 'savoury',
      name: 'Egg & cress sandwich',
      description: 'Two rounds, thick cut, on white.',
      price: menuPrice('1/-'),
    },
    {
      id: 'cheese-toast',
      section: 'savoury',
      name: 'Cheese on toast',
      description: 'Grilled, with a shake of Worcestershire sauce.',
      price: menuPrice('1/3'),
    },
    {
      id: 'ham-roll',
      section: 'savoury',
      name: 'Ham salad roll',
      description: 'Ham, lettuce and salad cream in a soft roll.',
      price: menuPrice('1/6'),
    },
    {
      id: 'cornet',
      section: 'sweet',
      name: 'Ice cream, cornet',
      description: 'Raspberry ripple from the cabinet.',
      price: menuPrice('6d'),
    },
    {
      id: 'fruit-cake',
      section: 'sweet',
      name: 'Fruit cake, slice',
      description: 'Baked on the premises, iced on top.',
      price: menuPrice('8d'),
    },
    {
      id: 'knickerbocker',
      section: 'sweet',
      name: 'Knickerbocker glory',
      description: 'Layered in a tall glass with fruit and a wafer.',
      price: menuPrice('2/6'),
      tags: ['signature'],
    },
  ],
  boardNote: 'SERVICE WITH A SMILE — TABLES WAITED ON',
  surface: {
    face: '#155e4c',
    faceAccent: '#0f4638',
    faceShadow: '#0a2f26',
    ink: '#f4f0e2',
    inkAccent: '#f0d489',
    frame: '#5c5f63',
    trim: '#b9c0c4',
    glow: '#f7f3e4',
    roughness: 0.42,
    metalness: 0.12,
    wear: 0.3,
  },
  benchmarkItemId: 'coffee',
  tags: ['vinyl', 'coach-paint', 'pre-decimal', 'formica', 'juke-box'],
  notes: [
    'Vinyl letters cut by the sign shop and applied wet, with a squeegee.',
    'Gloss coach paint on blockboard, two coats over a primer.',
    'Still pre-decimal: the shilling buys a sandwich and change.',
    'Coffee, iced milk and Coca-Cola mark the arrival of the espresso bar.',
  ],
};
