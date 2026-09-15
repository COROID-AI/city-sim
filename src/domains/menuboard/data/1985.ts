/**
 * 1985 — the fluorescent letter board in a light box.
 *
 * An aluminium-framed letter board with twin fluorescent tubes behind slotted
 * rails: each character is a moulded plastic tile, and the board is missing one
 * or two of them, as working letter boards always are. The promo strip along the
 * foot is the period's real voice — lunchtime specials, a badge and a price.
 * Money is decimal, and the board says so: prices include VAT at 15%.
 */

import { menuPrice } from '../types';
import type { MenuBoardSpec } from '../types';

export const SPEC_1985: MenuBoardSpec = {
  year: '1985',
  label: '1985',
  name: 'High-street boom',
  summary:
    'Fluorescent tiles clicked into a light box, a promo strip across the bottom, and an espresso bar menu that has discovered cappuccino and the jacket potato.',
  boardKind: 'fluorescent-letterboard',
  boardName: 'Fluorescent letter board in a light box',
  heading: 'THE CORNER CAFE',
  subheading: 'MENU',
  currency: 'gbp-decimal',
  lettering: 'fluorescent-tiles',
  sections: [
    { id: 'hot-drinks', label: 'Hot drinks' },
    { id: 'cold-drinks', label: 'Cold drinks' },
    { id: 'savoury', label: 'Sandwiches & hot' },
    { id: 'sweet', label: 'Cakes' },
  ],
  panels: [
    { id: 'drinks', title: 'DRINKS', sectionIds: ['hot-drinks', 'cold-drinks'] },
    { id: 'food', title: 'SANDWICHES & CAKES', sectionIds: ['savoury', 'sweet'] },
  ],
  items: [
    {
      id: 'tea',
      section: 'hot-drinks',
      name: 'Pot of tea',
      description: 'One pot, two cups, extra hot water.',
      price: menuPrice('30p'),
      note: 'Extra hot water on request.',
    },
    {
      id: 'filter-coffee',
      section: 'hot-drinks',
      name: 'Filter coffee',
      description: 'Bottomless filter coffee, refilled at the counter.',
      price: menuPrice('45p'),
      note: 'Regular or large.',
      tags: ['benchmark'],
    },
    {
      id: 'hot-chocolate',
      section: 'hot-drinks',
      name: 'Hot chocolate',
      description: 'With squirty cream and marshmallows.',
      price: menuPrice('55p'),
    },
    {
      id: 'cappuccino',
      section: 'hot-drinks',
      name: 'Cappuccino',
      description: 'Frothed milk and a dusting of chocolate.',
      price: menuPrice('70p'),
      note: 'Large 85p · decaf 80p.',
      tags: ['espresso-bar'],
    },
    {
      id: 'can-of-pop',
      section: 'cold-drinks',
      name: 'Can of pop',
      description: 'Coke, lemonade or orange, from the fridge.',
      price: menuPrice('40p'),
    },
    {
      id: 'fruit-juice',
      section: 'cold-drinks',
      name: 'Fruit juice',
      description: 'Orange or apple, in a glass with ice.',
      price: menuPrice('40p'),
    },
    {
      id: 'sparkling-water',
      section: 'cold-drinks',
      name: 'Sparkling mineral water',
      description: 'Chilled, with a slice of lemon.',
      price: menuPrice('45p'),
    },
    {
      id: 'cheese-pickle',
      section: 'savoury',
      name: 'Cheese & pickle sandwich',
      description: 'Brown or white, with a side salad.',
      price: menuPrice('£1.05'),
    },
    {
      id: 'toastie',
      section: 'savoury',
      name: 'Ham & cheese toastie',
      description: 'Pressed in the sandwich machine.',
      price: menuPrice('£1.15'),
    },
    {
      id: 'bacon-bap',
      section: 'savoury',
      name: 'Bacon bap',
      description: 'Three rashers, red or brown sauce.',
      price: menuPrice('£1.25'),
    },
    {
      id: 'jacket-potato',
      section: 'savoury',
      name: 'Jacket potato',
      description: 'Cheese, coleslaw or beans, with butter.',
      price: menuPrice('£1.45'),
      note: 'Add salad 25p.',
    },
    {
      id: 'doughnut',
      section: 'sweet',
      name: 'Doughnut',
      description: 'Jam or custard, rolled in sugar.',
      price: menuPrice('40p'),
    },
    {
      id: 'danish',
      section: 'sweet',
      name: 'Danish pastry',
      description: 'Apple or apricot, warmed on request.',
      price: menuPrice('55p'),
    },
    {
      id: 'fudge-cake',
      section: 'sweet',
      name: 'Chocolate fudge cake',
      description: 'A big slice, warmed, with cream.',
      price: menuPrice('75p'),
      note: 'Warmed with cream 90p.',
    },
  ],
  promo: {
    id: 'promo-lunch',
    headline: 'LUNCHTIME SPECIAL',
    detail: 'ANY SANDWICH & A CAN OF POP',
    price: menuPrice('£2.20'),
    badge: 'TODAY',
    stripes: ['#d81e5b', '#f7d002'],
  },
  boardNote: 'PRICES INCLUDE VAT AT 15% — ORDER AT THE COUNTER',
  surface: {
    face: '#101418',
    faceAccent: '#1b222a',
    faceShadow: '#05070a',
    ink: '#e9f7c9',
    inkAccent: '#ffe27a',
    frame: '#3a3f45',
    trim: '#c9cdd2',
    glow: '#c8ff6b',
    roughness: 0.5,
    metalness: 0.22,
    wear: 0.42,
  },
  benchmarkItemId: 'filter-coffee',
  tags: ['letter-board', 'fluorescent', 'light-box', 'promo-strip', 'vat'],
  notes: [
    'Moulded plastic tiles pressed into slotted rails; a tile or two always missing.',
    'Twin fluorescent tubes behind the felt, so the letters glow green-white.',
    'The promo strip is a printed acetate band pushed into a glazed housing.',
    'Prices include VAT at 15%, the standard rate of the day.',
  ],
};
