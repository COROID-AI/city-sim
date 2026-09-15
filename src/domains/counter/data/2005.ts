/**
 * 2005 counter technology — the integrated POS terminal.
 *
 * The standalone electronic register is gone. A beige terminal with a
 * CRT-style monitor on its lid sits on the drawer, a thermal printer under the
 * counter roller prints the receipt, a PIN pad stands on the customer lip with
 * the chip-and-PIN slot and its status lamp, and a stack of loyalty cards waits
 * in a holder. Bundled cables and a trunking strip run behind the terminal.
 *
 * Placement (offsets in metres from the band anchors published by
 * `CounterTechModule.counterBandAnchors`): the drawer and the terminal stack in
 * the front band, the printer, tape, coin tray, cards and printed plate in the
 * operator's back band, the PIN pad and tip jar on the customer lip, and the
 * cable bundle along the island edge.
 */

import type {
  CounterTechSpec,
  CounterInventoryEntry,
  CounterPlacementBand,
  CounterPropGroup,
  CounterPropKind,
} from '../CounterTechModule';
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

/** The 2005 counter: a CRT terminal, a PIN pad and a loyalty card stack. */
export const SPEC_2005: CounterTechSpec = {
  year: '2005',
  label: '2005',
  name: 'Espresso and chip-and-PIN',
  summary:
    'The counter runs a till system now: a beige terminal with a CRT monitor takes the order, a thermal printer rolls out the receipt and the PIN pad takes the card.',
  caption: 'CRT till system with a PIN pad',
  deviceFamily: 'pos-terminal',
  device: {
    name: 'Meridian Point till system',
    kind: 'pos-terminal',
    detail:
      'Beige terminal chassis carrying a CRT-style monitor, a printed keyboard fascia and a printer slot on its lower deck.',
  },
  payment: {
    name: 'PIN pad card terminal',
    kind: 'card-terminal',
    mode: 'card-and-cash',
    detail: 'Chip-and-PIN pad on the customer lip with its own keys, screen and status lamp, backed by the cash drawer.',
  },
  displayDetail: 'A CRT-style screen glows green over the till, breathing gently as the order lines list the sale.',
  paletteName: 'Espresso beige, brushed steel and green phosphor',
  materialSetId: 'counter-2005-espresso-beige-and-phosphor',
  surfaces: {
    enamel: {
      finish: 'beige ABS terminal and monitor casing',
      style: { kind: 'enamel-plate', base: '#d5cdb8', accent: '#9a9179', ink: '#3f3a2f' },
      roughness: 0.42,
      metalness: 0.06,
    },
    steel: {
      finish: 'brushed steel drawer with a note clip',
      style: { kind: 'steel-drawer', base: '#a5aaad', accent: '#74797c', ink: '#3f4447' },
      roughness: 0.4,
      metalness: 0.75,
    },
    chrome: {
      finish: 'chrome monitor stand and trim',
      style: { kind: 'chrome', base: '#e2e6e8', accent: '#99a1a6', ink: '#585f63' },
      roughness: 0.16,
      metalness: 0.93,
    },
    screen: {
      finish: 'green phosphor CRT with the till menu burnt in',
      style: {
        kind: 'crt-screen',
        base: '#585349',
        accent: '#0e1a10',
        ink: '#c3e8ac',
        mark: 'MERIDIAN POINT',
        lines: ['ESPRESSO   2.10', 'CAPPUCCINO 2.60', 'CROISSANT  1.40', 'TOTAL      6.10'],
      },
      emissive: '#8fc072',
      emissiveIntensity: 1.05,
    },
    pinpad: {
      finish: 'grey PIN pad with moulded keys and a small screen',
      style: {
        kind: 'pinpad-face',
        base: '#5c6063',
        accent: '#2d3133',
        ink: '#e8ebec',
        mark: 'PIN',
        text: 'INSERT CARD',
      },
      roughness: 0.46,
      metalness: 0.16,
    },
    card: {
      finish: 'printed loyalty card plastic with a magnetic stripe',
      style: {
        kind: 'card-plastic',
        base: '#2d4666',
        accent: '#d8c88c',
        ink: '#f3f1e8',
        mark: 'BEAN CLUB',
      },
      roughness: 0.3,
      metalness: 0.06,
    },
    receiptPaper: {
      finish: 'thermal receipt paper with itemised pounds and pence',
      style: {
        kind: 'receipt-paper',
        base: '#f7f5ef',
        accent: '#dedad0',
        ink: '#403d37',
        mark: 'MERIDIAN POINT',
        lines: ['1 ESPRESSO 2.10', '1 CAPPUCCINO 2.60', '1 CROISSANT 1.40', 'CARD 6.10'],
        text: 'TOTAL 6.10',
      },
    },
    label: {
      finish: 'printed plate over the till keyboard',
      style: {
        kind: 'printed-label',
        base: '#e6e1d3',
        accent: '#8b8578',
        ink: '#33302a',
        mark: 'MERIDIAN POINT',
        text: 'LATTE 2.60',
        lines: ['MOCHA 2.90'],
      },
    },
    printerShell: {
      finish: 'dark grey thermal printer with a paper slot and vents',
      style: { kind: 'printer-shell', base: '#4a4d4f', accent: '#22252a', ink: '#d8d9d6' },
      roughness: 0.44,
      metalness: 0.18,
    },
    felt: {
      finish: 'felt-lined steel coin compartments',
      style: { kind: 'coin-felt', base: '#453231', accent: '#8b6f66', ink: '#2a1e1d', size: 64 },
    },
    rubber: {
      finish: 'bundled grey data and mains cables behind the terminal',
      style: { kind: 'rubber-cable', base: '#33322f', accent: '#514f4a', ink: '#1b1a18' },
    },
  },
  animation: {
    displayKind: 'crt',
    displayBlinkSeconds: 0,
    displayOnFraction: 1,
    displayGlow: 1.05,
    screenBreatheSeconds: 4.2,
    statusPulseSeconds: 1.4,
    tapeSpeed: 0.06,
    tapeLength: 0.18,
    drawerNudgeSeconds: 12,
    drawerNudgeDuration: 1,
    drawerNudgeMetres: 0.022,
    tapPeriodSeconds: 0,
    tapDurationSeconds: 0,
    cue: 'The CRT screen breathes over the till, the printer rolls out paper and the drawer eases open on its runners.',
  },
  inventory: [
    prop(
      'cash-drawer',
      'cash-drawer',
      'Steel cash drawer',
      'Brushed steel drawer with a note clip and a removable coin insert.',
      'cash',
      'counter-front',
      [0, 0],
      [0.3, 0.14, 0.2],
      'steel',
      { trim: 'felt', tags: ['steel', 'note-clip'] },
    ),
    prop(
      'pos-terminal',
      'pos-terminal',
      'Meridian Point terminal',
      'Beige chassis with a moulded keyboard fascia, a printer slot and a green power lamp.',
      'register',
      'drawer-line',
      [0, -0.01],
      [0.3, 0.14, 0.22],
      'enamel',
      { lift: 0, trim: 'chrome', tags: ['pos-terminal', 'integrated-printer'] },
    ),
    prop(
      'crt-monitor',
      'crt-monitor',
      'CRT till monitor',
      'Deep beige CRT housing with a glowing green screen, a bezel with vent slots and a tilt stand.',
      'register',
      'drawer-line',
      [0, -0.06],
      [0.28, 0.3, 0.24],
      'screen',
      { lift: 0.14, trim: 'chrome', tags: ['crt-monitor', 'display', 'animated'] },
    ),
    prop(
      'receipt-printer',
      'receipt-printer',
      'Thermal receipt printer',
      'Compact printer unit with a paper slot, three vent slats and a green ready lamp.',
      'register',
      'counter-back',
      [-0.11, -0.1],
      [0.16, 0.12, 0.14],
      'printerShell',
      { trim: 'chrome', tags: ['receipt-printer', 'paper'] },
    ),
    prop(
      'receipt-tape',
      'receipt-tape',
      'Receipt tape',
      'Itemised receipt curling out of the printer slot, scrolling as the sale totals.',
      'register',
      'counter-back',
      [-0.11, -0.005],
      [0.06, 0.16, 0.02],
      'receiptPaper',
      { lift: 0.06, tags: ['paper', 'animated'] },
    ),
    prop(
      'coin-tray',
      'coin-tray',
      'Steel coin tray',
      'Steel tray with felt-lined compartments for the new coin sizes.',
      'cash',
      'counter-back',
      [0.06, -0.1],
      [0.16, 0.03, 0.1],
      'steel',
      { trim: 'felt', tags: ['coin-tray'] },
    ),
    prop(
      'loyalty-cards',
      'loyalty-cards',
      'Loyalty card stack',
      'Stack of printed loyalty cards waiting in a folding holder beside the till.',
      'payment',
      'counter-back',
      [0.06, 0.1],
      [0.09, 0.015, 0.06],
      'card',
      { rotationY: 0.14, tags: ['loyalty-cards', 'printed'] },
    ),
    prop(
      'printed-label',
      'printed-label',
      'Printed till plate',
      'Printed plate lettered with the counter price list and the till system name.',
      'signage',
      'counter-back',
      [-0.11, 0.1],
      [0.14, 0.02, 0.1],
      'label',
      { tags: ['printed-labelling'] },
    ),
    prop(
      'card-terminal',
      'card-terminal',
      'PIN pad card terminal',
      'Chip-and-PIN pad with moulded keys, a small screen, a card slot and a status lamp.',
      'payment',
      'counter-lip',
      [-0.16, 0],
      [0.11, 0.12, 0.1],
      'pinpad',
      { trim: 'chrome', tags: ['card-terminal', 'chip-and-pin', 'status-lamp'] },
    ),
    prop(
      'tip-jar',
      'tip-jar',
      'Glass tip jar',
      'Straight-sided jar with a printed label, standing beside the PIN pad.',
      'payment',
      'counter-lip',
      [0.16, 0],
      [0.09, 0.13, 0.09],
      'glass',
      { tags: ['tip-jar', 'glass'] },
    ),
    prop(
      'cable',
      'cable',
      'Cable bundle',
      'Bundled data and mains cables clipped along the island edge behind the terminal.',
      'cabling',
      'counter-front',
      [0.2, -0.03],
      [0.03, 0.03, 0.26],
      'rubber',
      { tags: ['cable', 'bundled', 'era-correct-cable'] },
    ),
  ],
  notes: [
    'The standalone electronic register is replaced by an integrated terminal with a CRT monitor.',
    'Card payment arrives: the PIN pad sits on the customer lip and the loyalty card stack beside the till.',
    'Cables are routed flat along the island edge, so nothing loops through the counter or the room.',
  ],
  tags: ['pos-terminal', 'crt-monitor', 'receipt-printer', 'card-terminal', 'loyalty-cards', 'card-and-cash'],
};

export default SPEC_2005;
