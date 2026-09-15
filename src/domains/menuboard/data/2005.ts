/**
 * 2005 — backlit acrylic menu panels.
 *
 * Three frosted acrylic panels spaced off a brushed aluminium light box, printed
 * with the modern coffee-shop menu: espresso, latte, panini, smoothie, allergens.
 * The lettering is set type, evenly backlit, with a sheen sliding across the
 * acrylic — no chalk, no tiles, no hand in it. Money is decimal and casually
 * expensive: a filter coffee has passed the price of a 1985 lunch.
 */

import { menuPrice } from '../types';
import type { MenuBoardSpec } from '../types';

export const SPEC_2005: MenuBoardSpec = {
  year: '2005',
  label: '2005',
  name: 'Coffee-shop chain years',
  summary:
    'Frosted acrylic panels on standoffs, evenly backlit, printed with a coffee-shop menu of latte, panini and allergen notes.',
  boardKind: 'backlit-acrylic',
  boardName: 'Backlit acrylic menu panels',
  heading: 'THE CORNER CAFE',
  subheading: 'COFFEE & KITCHEN',
  currency: 'gbp-decimal',
  lettering: 'backlit-print',
  sections: [
    { id: 'hot-drinks', label: 'Coffee' },
    { id: 'cold-drinks', label: 'Cold drinks' },
    { id: 'savoury', label: 'Kitchen' },
    { id: 'sweet', label: 'Bakery' },
  ],
  panels: [
    { id: 'coffee', title: 'COFFEE', sectionIds: ['hot-drinks'] },
    { id: 'cold', title: 'COLD DRINKS', sectionIds: ['cold-drinks'] },
    { id: 'kitchen', title: 'KITCHEN & BAKERY', sectionIds: ['savoury', 'sweet'] },
  ],
  items: [
    {
      id: 'espresso',
      section: 'hot-drinks',
      name: 'Espresso',
      description: 'Double shot, served with a glass of water.',
      price: menuPrice('£1.60'),
    },
    {
      id: 'filter-coffee',
      section: 'hot-drinks',
      name: 'Filter coffee',
      description: 'Fairtrade beans, brewed all day and topped up free.',
      price: menuPrice('£1.85'),
      tags: ['benchmark', 'fairtrade'],
    },
    {
      id: 'cappuccino',
      section: 'hot-drinks',
      name: 'Cappuccino',
      description: 'Whole milk, dusted with cocoa.',
      price: menuPrice('£2.10'),
    },
    {
      id: 'latte',
      section: 'hot-drinks',
      name: 'Latte',
      description: 'In a glass, with an extra shot for 40p.',
      price: menuPrice('£2.20'),
      tags: ['signature'],
    },
    {
      id: 'hot-chocolate',
      section: 'hot-drinks',
      name: 'Hot chocolate',
      description: 'With whipped cream and marshmallows.',
      price: menuPrice('£2.30'),
    },
    {
      id: 'bottled-water',
      section: 'cold-drinks',
      name: 'Bottled water',
      description: 'Still or sparkling, 500ml, from the chiller.',
      price: menuPrice('£1.35'),
    },
    {
      id: 'orange-juice',
      section: 'cold-drinks',
      name: 'Fresh orange juice',
      description: 'Squeezed each morning, served over ice.',
      price: menuPrice('£2.10'),
    },
    {
      id: 'iced-latte',
      section: 'cold-drinks',
      name: 'Iced latte',
      description: 'Over ice in a tall glass, with a shot of vanilla.',
      price: menuPrice('£2.60'),
    },
    {
      id: 'smoothie',
      section: 'cold-drinks',
      name: 'Fruit smoothie',
      description: 'Mango, banana and yogurt, blended to order.',
      price: menuPrice('£3.10'),
    },
    {
      id: 'soup',
      section: 'savoury',
      name: 'Soup of the day',
      description: 'With sourdough toast, served until 3pm.',
      price: menuPrice('£3.60'),
      note: 'Ask about allergens.',
    },
    {
      id: 'bacon-bloomer',
      section: 'savoury',
      name: 'Bacon & egg bloomer',
      description: 'Dry-cured bacon, free-range egg, served until 11am.',
      price: menuPrice('£3.85'),
    },
    {
      id: 'panini',
      section: 'savoury',
      name: 'Toasted panini',
      description: 'Mozzarella, tomato and basil, pressed to order.',
      price: menuPrice('£3.95'),
    },
    {
      id: 'caesar-wrap',
      section: 'savoury',
      name: 'Chicken caesar wrap',
      description: 'With parmesan, cos lettuce and dressing.',
      price: menuPrice('£4.25'),
    },
    {
      id: 'flapjack',
      section: 'sweet',
      name: 'Flapjack',
      description: 'Oat, golden syrup and sultana.',
      price: menuPrice('£1.60'),
    },
    {
      id: 'pain-au-chocolat',
      section: 'sweet',
      name: 'Pain au chocolat',
      description: 'Baked here every morning.',
      price: menuPrice('£1.85'),
    },
    {
      id: 'muffin',
      section: 'sweet',
      name: 'Blueberry muffin',
      description: 'With a crumble top, warmed on request.',
      price: menuPrice('£1.95'),
    },
    {
      id: 'carrot-cake',
      section: 'sweet',
      name: 'Carrot cake',
      description: 'With cream cheese icing and walnut.',
      price: menuPrice('£2.50'),
    },
  ],
  boardNote: 'ALL PRICES IN STERLING — PLEASE ASK ABOUT ALLERGENS',
  surface: {
    face: '#f4f1ea',
    faceAccent: '#e3ded2',
    faceShadow: '#c3bcae',
    ink: '#2b2b2e',
    inkAccent: '#8a4b2a',
    frame: '#8e9296',
    trim: '#c8cdd2',
    glow: '#fff3d6',
    roughness: 0.34,
    metalness: 0.16,
    wear: 0.24,
  },
  benchmarkItemId: 'filter-coffee',
  tags: ['acrylic', 'backlit', 'standoffs', 'fairtrade', 'allergens'],
  notes: [
    'Three frosted acrylic panels, printed and spaced off the box on standoffs.',
    'Even backlighting from a slim diffuser, with a sheen across the acrylic.',
    'The menu has become a coffee-shop menu: latte, panini, smoothie, allergens.',
    'Decimal sterling, and a filter coffee now costs more than a 1985 lunch.',
  ],
};
