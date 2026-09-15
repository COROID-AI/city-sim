/**
 * 2025 — the emissive digital screen with rotating panels.
 *
 * A slim bezelled screen tilted down to the customer, split into four sections
 * that rotate on a timer: coffee, cold bar, kitchen and a feature panel that
 * comes round every cycle carrying the seasonal special. The lettering is
 * rendered light rather than ink, so the whole board glows; the only wear on it
 * is a little image retention and one lazy pixel row along the bottom bezel.
 */

import { menuPrice } from '../types';
import type { MenuBoardSpec } from '../types';

export const SPEC_2025: MenuBoardSpec = {
  year: '2025',
  label: '2025',
  name: 'Third-wave coffee bar',
  summary:
    'A slim digital screen split into rotating panels: single-origin coffee, a cold bar, a kitchen, and a feature panel that cycles the seasonal special.',
  boardKind: 'digital-screen',
  boardName: 'Emissive digital menu screen',
  heading: 'CORNER',
  subheading: 'DAY MENU',
  currency: 'gbp-decimal',
  lettering: 'emissive-digital',
  sections: [
    { id: 'hot-drinks', label: 'Coffee' },
    { id: 'cold-drinks', label: 'Cold bar' },
    { id: 'savoury', label: 'Kitchen' },
    { id: 'sweet', label: 'Bakery' },
  ],
  panels: [
    { id: 'coffee', title: 'COFFEE', sectionIds: ['hot-drinks'], rotationSeconds: 9 },
    { id: 'cold', title: 'COLD BAR', sectionIds: ['cold-drinks'], rotationSeconds: 9 },
    { id: 'kitchen', title: 'KITCHEN & BAKERY', sectionIds: ['savoury', 'sweet'], rotationSeconds: 12 },
  ],
  items: [
    {
      id: 'espresso',
      section: 'hot-drinks',
      name: 'Espresso',
      description: 'Double shot of the house blend.',
      price: menuPrice('£2.80'),
    },
    {
      id: 'cortado',
      section: 'hot-drinks',
      name: 'Cortado',
      description: 'Equal parts espresso and steamed milk.',
      price: menuPrice('£3.50'),
    },
    {
      id: 'filter-coffee',
      section: 'hot-drinks',
      name: 'Filter coffee',
      description: 'Single origin, brewed to order.',
      price: menuPrice('£3.60'),
      tags: ['benchmark'],
    },
    {
      id: 'flat-white',
      section: 'hot-drinks',
      name: 'Flat white',
      description: 'Whole or oat milk, poured by hand.',
      price: menuPrice('£3.80'),
    },
    {
      id: 'oat-flat-white',
      section: 'hot-drinks',
      name: 'Oat flat white',
      description: 'Barista oat, no extra charge.',
      price: menuPrice('£4.10'),
    },
    {
      id: 'matcha-latte',
      section: 'hot-drinks',
      name: 'Matcha latte',
      description: 'Ceremonial grade, whisked to order.',
      price: menuPrice('£4.40'),
    },
    {
      id: 'sparkling-water',
      section: 'cold-drinks',
      name: 'Sparkling water',
      description: 'Chilled, with a slice of lime.',
      price: menuPrice('£2.60'),
    },
    {
      id: 'kombucha',
      section: 'cold-drinks',
      name: 'Kombucha',
      description: 'Ginger and yuzu, on draught.',
      price: menuPrice('£4.20'),
    },
    {
      id: 'iced-filter',
      section: 'cold-drinks',
      name: 'Iced filter',
      description: 'Brewed over ice, with a twist of orange.',
      price: menuPrice('£4.20'),
    },
    {
      id: 'cold-brew',
      section: 'cold-drinks',
      name: 'Cold brew',
      description: 'Steeped eighteen hours, served over ice.',
      price: menuPrice('£4.60'),
    },
    {
      id: 'soup-sourdough',
      section: 'savoury',
      name: 'Soup & sourdough',
      description: 'Today: roast tomato and basil.',
      price: menuPrice('£7.60'),
    },
    {
      id: 'avocado-toast',
      section: 'savoury',
      name: 'Avocado toast',
      description: 'Sourdough, chilli, lime and toasted seed.',
      price: menuPrice('£8.50'),
    },
    {
      id: 'halloumi-wrap',
      section: 'savoury',
      name: 'Halloumi wrap',
      description: 'Charred halloumi, harissa and pickled slaw.',
      price: menuPrice('£8.90'),
    },
    {
      id: 'kimchi-toastie',
      section: 'savoury',
      name: 'Kimchi grilled cheese',
      description: 'On sourdough, with a dill pickle.',
      price: menuPrice('£9.40'),
      tags: ['signature'],
    },
    {
      id: 'brownie',
      section: 'sweet',
      name: 'Vegan brownie',
      description: 'Dark chocolate and sea salt.',
      price: menuPrice('£4.20'),
    },
    {
      id: 'cinnamon-bun',
      section: 'sweet',
      name: 'Cinnamon bun',
      description: 'Cardamom glaze, baked each morning.',
      price: menuPrice('£4.25'),
    },
    {
      id: 'pistachio-croissant',
      section: 'sweet',
      name: 'Pistachio croissant',
      description: 'Twice baked with frangipane.',
      price: menuPrice('£4.80'),
    },
    {
      id: 'basque-cheesecake',
      section: 'sweet',
      name: 'Basque cheesecake',
      description: 'Burnt top, served at room temperature.',
      price: menuPrice('£5.50'),
    },
  ],
  promo: {
    id: 'seasonal',
    headline: 'SEASONAL SPECIAL',
    detail: 'PUMPKIN SPICE LATTE · OAT MILK, NO EXTRA CHARGE',
    price: menuPrice('£4.80'),
    badge: 'NEW',
    stripes: ['#f0a500', '#2b7a78'],
  },
  boardNote: 'OAT, SOY & ALMOND AT NO EXTRA CHARGE — PLEASE ASK ABOUT ALLERGENS',
  surface: {
    face: '#0b1116',
    faceAccent: '#152232',
    faceShadow: '#05090d',
    ink: '#e8f4ff',
    inkAccent: '#7fd8c8',
    frame: '#1d2731',
    trim: '#8d99a6',
    glow: '#79c6ff',
    roughness: 0.26,
    metalness: 0.36,
    wear: 0.18,
  },
  benchmarkItemId: 'filter-coffee',
  tags: ['digital', 'emissive', 'rotating-panels', 'third-wave', 'allergens'],
  notes: [
    'A slim bezelled screen, tilted down to the customer, split into sections.',
    'Panels rotate on a timer; the feature panel cycles the seasonal special.',
    'Lettering is emitted light rather than ink, so the whole face is the light source.',
    'Image retention and one lazy pixel row are the only wear a glass screen takes.',
  ],
};
