/**
 * 1945 counter technology — the manual till.
 *
 * The post-war counter takes cash and nothing else: a brass-and-oak cash drawer
 * with a lever release and a bell, a tin coin tray, a handwritten docket pad
 * with a pencil on a string, the day ledger and the hand-lettered price card.
 * There is no display, no printer and no card equipment anywhere on the counter;
 * the only power on the counter is the counter bell's own spring.
 *
 * Placement (all offsets are metres from the band anchor published by
 * `CounterTechModule.counterBandAnchors`; the island is the free strip at the
 * counter's service end, clear of the back-room doorway and of the machine and
 * grinder bays):
 *
 *  - back band  — the operator's row: coin tray, docket pad and pencil, ledger;
 *  - front band — the drawer itself, the till box stacked on it, the lever and
 *                 the brass pull at the drawer face;
 *  - lip band   — the customer's edge: price card and tip jar.
 */

import type { CounterTechSpec, CounterInventoryEntry, CounterPlacementBand, CounterPropGroup, CounterPropKind } from '../CounterTechModule';
import type { CounterMaterialSlot } from '../textures/labels';

function prop(
  id: string,
  kind: CounterPropKind,
  label: string,
  detail: string,
  group: CounterPropGroup,
  band: CounterPlacementBand,
  offset: readonly [x: number, z: number],
  size: readonly [x: number, y: number, z: number],
  material: CounterMaterialSlot,
  options: {
    readonly lift?: number;
    readonly rotationY?: number;
    readonly trim?: CounterMaterialSlot;
    readonly tags?: readonly string[];
  } = {},
): CounterInventoryEntry {
  return {
    id,
    kind,
    label,
    detail,
    group,
    band,
    offset: { x: offset[0], z: offset[1] },
    size: { x: size[0], y: size[1], z: size[2] },
    lift: options.lift ?? 0,
    rotationY: options.rotationY ?? 0,
    material,
    trim: options.trim ?? null,
    tags: options.tags ?? [],
  };
}

/** The 1945 counter: a lever till, a docket pad and a day book. */
export const SPEC_1945: CounterTechSpec = {
  year: '1945',
  label: '1945',
  name: 'Post-war austerity',
  summary:
    'Rationing is still in force, so the counter takes cash and keeps the day book by hand: a lever drawer rings a bell and the docket pad records every cup.',
  caption: 'brass lever till and handwritten dockets',
  deviceFamily: 'manual-till',
  device: {
    name: 'Hallam No. 3 lever till',
    kind: 'till-body',
    detail:
      'An oak cash box clamped onto a drawer that the brass lever pops open, with a nickel bell to mark the sale.',
  },
  payment: {
    name: 'Lever cash drawer',
    kind: 'cash-drawer',
    mode: 'cash-only',
    detail: 'Notes and loose change counted by hand into the till compartments and the day book.',
  },
  displayDetail: 'Nothing on the counter is electric: the only display is the bell and the pencilled docket totals.',
  paletteName: 'Oak, brass and tin under a 60 W bulb',
  materialSetId: 'counter-1945-oak-brass-and-tin',
  surfaces: {
    wood: {
      finish: 'oiled oak cash box with a rubbed wax edge',
      style: { kind: 'wood-till', base: '#7a5230', accent: '#4a3120', ink: '#2c1d12', scale: 3 },
      roughness: 0.58,
    },
    enamel: {
      finish: 'cream stove-enamelled tin',
      style: { kind: 'enamel-plate', base: '#ded3b6', accent: '#9c8f74', ink: '#413a2c' },
      roughness: 0.36,
    },
    steel: {
      finish: 'worn tinned sheet',
      style: { kind: 'steel-drawer', base: '#a9a79c', accent: '#77746a', ink: '#45423a' },
      roughness: 0.5,
      metalness: 0.55,
    },
    brass: {
      finish: 'hand-polished brass lever and pull',
      style: { kind: 'brass', base: '#c9a04c', accent: '#8b6520', ink: '#5b4314' },
      roughness: 0.26,
      metalness: 0.9,
    },
    glass: {
      finish: 'moulded glass tip jar',
      style: { kind: 'glass-jar', base: '#d3dddc', accent: '#94b0ad', ink: '#5f7a78' },
      transparent: true,
      opacity: 0.5,
    },
    docketPaper: {
      finish: 'ruled docket pad with a carbon sheet and pencil totals',
      style: {
        kind: 'docket-paper',
        base: '#efe4c4',
        accent: '#c6b48d',
        ink: '#3b3226',
        mark: 'DOCKET',
      },
    },
    ledgerPaper: {
      finish: 'ruled day book kept in ink and pencil',
      style: {
        kind: 'ledger-paper',
        base: '#e9e4cd',
        accent: '#a5b0bb',
        ink: '#38372f',
        lines: ['MON 27th', 'COFFEE 3d', 'TEA 2d', 'CAKE 4d', 'TILL 1 4s 6d'],
      },
    },
    receiptPaper: {
      finish: 'pale rationed paper stock',
      style: {
        kind: 'receipt-paper',
        base: '#f2eddd',
        accent: '#d6cfb9',
        ink: '#433d33',
        mark: 'HALLAM',
        lines: ['TEA 2d', 'CAKE 4d'],
        text: '1 4s 6d',
      },
    },
    label: {
      finish: 'hand-lettered price card in a brass holder',
      style: {
        kind: 'printed-label',
        base: '#efe3c2',
        accent: '#8d7a55',
        ink: '#33291c',
        mark: 'PRICES',
        text: 'COFFEE 3d',
        lines: ['TEA 2d'],
      },
    },
    felt: {
      finish: 'green baize coin compartments',
      style: { kind: 'coin-felt', base: '#3f4a35', accent: '#7d8a62', ink: '#262e21', size: 64 },
    },
    rubber: {
      finish: 'waxed cotton bell cord',
      style: { kind: 'rubber-cable', base: '#4a4038', accent: '#6a5c4c', ink: '#241e1a' },
    },
  },
  animation: {
    displayKind: 'none',
    displayBlinkSeconds: 0,
    displayOnFraction: 0,
    displayGlow: 0,
    screenBreatheSeconds: 0,
    statusPulseSeconds: 0,
    tapeSpeed: 0,
    tapeLength: 0,
    drawerNudgeSeconds: 9,
    drawerNudgeDuration: 1.2,
    drawerNudgeMetres: 0.018,
    tapPeriodSeconds: 0,
    tapDurationSeconds: 0,
    cue: 'The lever swings and the bell rocks as the oak drawer eases back on its runners.',
  },
  inventory: [
    prop(
      'cash-drawer',
      'cash-drawer',
      'Lever cash drawer',
      'Oak drawer with two note wells, a tin coin tray and a lever release.',
      'cash',
      'counter-front',
      [0, 0],
      [0.3, 0.1, 0.2],
      'wood',
      { trim: 'brass', tags: ['lever-operated', 'oak', 'no-electric-part'] },
    ),
    prop(
      'till-body',
      'till-body',
      'Hallam No. 3 cash box',
      'Clamped cash box with separate note and coin wells and a brass plate lettered HALLAM.',
      'register',
      'drawer-line',
      [0, 0],
      [0.3, 0.17, 0.18],
      'wood',
      { lift: 0, trim: 'brass', tags: ['manual-till', 'cash-only'] },
    ),
    prop(
      'till-lid',
      'till-lid',
      'Hinged till lid',
      'Hinged oak lid with a brass thumb-knob and a felt underside.',
      'register',
      'drawer-line',
      [0, 0],
      [0.3, 0.03, 0.18],
      'wood',
      { lift: 0.17, trim: 'felt', tags: ['hinged'] },
    ),
    prop(
      'till-bell',
      'till-bell',
      'Nickel counter bell',
      'Dome bell screwed to the lid; it rings when the lever trips the drawer.',
      'register',
      'drawer-line',
      [0, 0],
      [0.07, 0.05, 0.07],
      'brass',
      { lift: 0.2, tags: ['acoustic', 'sale-marker'] },
    ),
    prop(
      'till-lever',
      'till-lever',
      'Brass drawer lever',
      'Lever on the right cheek of the box: press it down and the spring drawer shoots back.',
      'register',
      'counter-front',
      [0.19, 0],
      [0.03, 0.16, 0.09],
      'brass',
      { lift: 0.02, tags: ['lever-operated', 'animated'] },
    ),
    prop(
      'drawer-pull',
      'drawer-pull',
      'Brass drawer pull',
      'Cast pull on the drawer face, worn bright in the middle.',
      'cash',
      'counter-front',
      [0, 0.115],
      [0.1, 0.03, 0.02],
      'brass',
      { lift: 0.02, tags: ['brass'] },
    ),
    prop(
      'coin-tray',
      'coin-tray',
      'Tin coin tray',
      'Six tin compartments lined with green baize, for farthings up to half-crowns.',
      'cash',
      'counter-back',
      [-0.09, -0.1],
      [0.18, 0.03, 0.12],
      'steel',
      { trim: 'felt', tags: ['coin-tray', 'pre-decimal'] },
    ),
    prop(
      'docket-pad',
      'docket-pad',
      'Handwritten docket pad',
      'Card-backed pad of ruled dockets over a carbon sheet; every order is written by hand.',
      'docket',
      'counter-back',
      [0.09, -0.06],
      [0.16, 0.015, 0.18],
      'docketPaper',
      { rotationY: 0.08, tags: ['handwritten', 'paper'] },
    ),
    prop(
      'docket-pencil',
      'docket-pencil',
      'Pencil on a string',
      'Half-chewed cedar pencil on a string, lying across the docket pad.',
      'docket',
      'counter-back',
      [0.09, -0.12],
      [0.14, 0.012, 0.012],
      'wood',
      { lift: 0.015, tags: ['handwritten'] },
    ),
    prop(
      'ledger',
      'ledger',
      'Day ledger',
      'Cloth-bound day book, ruled for takings and credit; the till total is copied in each evening.',
      'docket',
      'counter-back',
      [-0.09, 0.13],
      [0.18, 0.03, 0.12],
      'ledgerPaper',
      { rotationY: -0.06, tags: ['handwritten', 'paper'] },
    ),
    prop(
      'price-card',
      'price-card',
      'Hand-lettered price card',
      'Card in a brass holder, lettered in the same hand as the window: COFFEE 3d, TEA 2d.',
      'signage',
      'counter-lip',
      [-0.12, 0],
      [0.1, 0.09, 0.02],
      'label',
      { rotationY: 0.32, trim: 'brass', tags: ['pre-decimal', 'hand-lettered'] },
    ),
    prop(
      'tip-jar',
      'tip-jar',
      'Glass tip jar',
      'Moulded glass jar with a paper label; a few coppers from a grateful regular.',
      'payment',
      'counter-lip',
      [0.16, 0],
      [0.09, 0.13, 0.09],
      'glass',
      { tags: ['tip-jar', 'glass'] },
    ),
  ],
  notes: [
    'No electronic display, no printer and no card equipment exists in this era: the counter is entirely mechanical.',
    'Pre-decimal money (pounds, shillings and pence) is quoted throughout the printed marks.',
    'The bell and the lever are the two animated parts; the drawer itself eases back on its runners.',
  ],
  tags: ['manual-till', 'cash-only', 'lever-drawer', 'handwritten-docket', 'pre-decimal'],
};

export default SPEC_1945;
