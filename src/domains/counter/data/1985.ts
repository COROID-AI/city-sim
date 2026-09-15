/**
 * 1985 counter technology — the electronic cash register.
 *
 * The crank has gone: the register is a moulded wedge with a rubber keypad, a
 * numeric LED face that blinks as it counts, a thermal receipt roll under a
 * smoked lid, and a handheld barcode scanner in a cradle with labelled goods
 * beside it. The drawer is the same steel box, now with a moulded plastic coin
 * tray, and a grey PVC lead runs along the island edge.
 *
 * Placement (offsets in metres from the band anchors published by
 * `CounterTechModule.counterBandAnchors`): the drawer, register body and LED
 * face in the front band, the roll, tape, coin tray, labelled goods and printed
 * plate in the operator's back band, the scanner cradle on the customer lip and
 * the lead along the island edge.
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

/** The 1985 counter: an LED register with a barcode scanner and printed roll. */
export const SPEC_1985: CounterTechSpec = {
  year: '1985',
  label: '1985',
  name: 'Chrome, laminate and microchips',
  summary:
    'The register is electronic now: press the rubber keys, watch the red segments count the sale and the thermal roll click out a printed slip.',
  caption: 'LED register with a barcode scanner',
  deviceFamily: 'electronic-register',
  device: {
    name: 'Cirra 85 electronic cash register',
    kind: 'ecr-body',
    detail:
      'Moulded wedge housing with a rubber keypad, a red seven-segment LED face and a thermal receipt roll under a smoked lid.',
  },
  payment: {
    name: 'Steel drawer with a plastic coin tray',
    kind: 'cash-drawer',
    mode: 'cash-first',
    detail: 'The keypad releases the drawer; the plastic tray keeps the new £1 coins in labelled wells.',
  },
  displayDetail: 'A red numeric LED face counts the sale and blinks between entries; nothing on the counter prints but the roll.',
  paletteName: 'Dusty rose, dark bakelite and chrome',
  materialSetId: 'counter-1985-bakelite-chrome-and-dusty-rose',
  surfaces: {
    bakelite: {
      finish: 'moulded graphite-brown register housing',
      style: { kind: 'bakelite', base: '#3b3634', accent: '#6d625c', ink: '#191715' },
      roughness: 0.3,
    },
    steel: {
      finish: 'brushed stainless drawer face',
      style: { kind: 'steel-drawer', base: '#9ba1a5', accent: '#6b7175', ink: '#3c4144' },
      roughness: 0.44,
      metalness: 0.72,
    },
    chrome: {
      finish: 'chrome roll axle and trim',
      style: { kind: 'chrome', base: '#e6eaec', accent: '#98a2a8', ink: '#575f63' },
      roughness: 0.15,
      metalness: 0.94,
    },
    led: {
      finish: 'red seven-segment LED face with a smoked filter',
      style: { kind: 'led-face', base: '#141618', accent: '#3d4245', ink: '#ff4a2b', text: '12.85' },
      emissive: '#ff2c10',
      emissiveIntensity: 1.3,
    },
    keyface: {
      finish: 'moulded rubber keypad with printed legends',
      style: {
        kind: 'key-legend',
        base: '#4c4744',
        accent: '#2b2826',
        ink: '#e8e4dc',
        text: '1234567890',
      },
      roughness: 0.5,
      metalness: 0.08,
    },
    receiptPaper: {
      finish: 'thermal receipt roll, faint grey print',
      style: {
        kind: 'receipt-paper',
        base: '#f6f4ee',
        accent: '#dcd8ce',
        ink: '#43403a',
        mark: 'CIRRA 85',
        lines: ['2 CAPPUCCINO 1.80', '1 PASTRY 0.95', 'CASH 2.75', 'CHANGE 0.00'],
        text: 'TOTAL 2.75',
      },
    },
    label: {
      finish: 'printed fascia plate over the keypad',
      style: {
        kind: 'printed-label',
        base: '#ded9cd',
        accent: '#6f6a63',
        ink: '#2f2c28',
        mark: 'CIRRA 85',
        text: 'CAPPUCCINO 0.90',
        lines: ['ESPRESSO 0.75', 'CROISSANT 0.80'],
      },
    },
    scannerShell: {
      finish: 'moulded scanner shell with a barcode window',
      style: { kind: 'scanner-shell', base: '#3c3b39', accent: '#131211', ink: '#eceae4' },
      roughness: 0.36,
      metalness: 0.16,
    },
    felt: {
      finish: 'dark plastic coin tray with felt wells',
      style: { kind: 'coin-felt', base: '#3d3a3f', accent: '#7d7681', ink: '#232125', size: 64 },
    },
    rubber: {
      finish: 'grey PVC scanner and mains lead',
      style: { kind: 'rubber-cable', base: '#2f3234', accent: '#4f5457', ink: '#191b1c' },
    },
  },
  animation: {
    displayKind: 'led',
    displayBlinkSeconds: 1.6,
    displayOnFraction: 0.72,
    displayGlow: 1.35,
    screenBreatheSeconds: 0,
    statusPulseSeconds: 2.1,
    tapeSpeed: 0.07,
    tapeLength: 0.14,
    drawerNudgeSeconds: 8,
    drawerNudgeDuration: 0.95,
    drawerNudgeMetres: 0.02,
    tapPeriodSeconds: 0,
    tapDurationSeconds: 0,
    cue: 'The LED face blinks between entries, the receipt roll turns the tape out and the drawer kicks open.',
  },
  inventory: [
    prop(
      'cash-drawer',
      'cash-drawer',
      'Steel cash drawer',
      'Brushed steel drawer with a moulded plastic coin tray and a note clip.',
      'cash',
      'counter-front',
      [0, 0],
      [0.3, 0.12, 0.2],
      'steel',
      { trim: 'felt', tags: ['steel', 'plastic-coin-tray'] },
    ),
    prop(
      'ecr-body',
      'ecr-body',
      'Cirra 85 register',
      'Moulded wedge with a rubber keypad, a smoked receipt lid and a printed fascia plate.',
      'register',
      'drawer-line',
      [0, -0.05],
      [0.3, 0.16, 0.22],
      'bakelite',
      { lift: 0, trim: 'keyface', tags: ['keypad', 'electronic', 'thermal-printer'] },
    ),
    prop(
      'display-led',
      'display-led',
      'Numeric LED face',
      'Red seven-segment face behind a smoked filter, mounted on the rear slope of the register.',
      'register',
      'drawer-line',
      [0, -0.145],
      [0.26, 0.07, 0.03],
      'led',
      { lift: 0.16, trim: 'chrome', tags: ['display', 'led', 'animated'] },
    ),
    prop(
      'receipt-roll',
      'receipt-roll',
      'Thermal receipt roll',
      'Spare roll on a chrome axle at the back of the counter, paper visible at the edge.',
      'register',
      'counter-back',
      [-0.16, -0.1],
      [0.1, 0.1, 0.1],
      'receiptPaper',
      { trim: 'chrome', tags: ['paper', 'receipt-roll'] },
    ),
    prop(
      'receipt-tape',
      'receipt-tape',
      'Receipt tape strip',
      'Printed slip feeding out of the register lid, scrolling as the sale is rung up.',
      'register',
      'counter-back',
      [-0.16, -0.035],
      [0.06, 0.14, 0.02],
      'receiptPaper',
      { lift: 0.06, tags: ['paper', 'animated'] },
    ),
    prop(
      'coin-tray',
      'coin-tray',
      'Plastic coin tray',
      'Moulded tray with five labelled wells, sized for the round £1 coin.',
      'cash',
      'counter-back',
      [-0.02, -0.1],
      [0.16, 0.03, 0.1],
      'felt',
      { trim: 'keyface', tags: ['coin-tray', 'labelled'] },
    ),
    prop(
      'scanner-goods',
      'scanner-goods',
      'Labelled goods',
      'A printed tin waiting to be scanned, with its barcode label facing the scanner.',
      'payment',
      'counter-back',
      [0.16, -0.1],
      [0.12, 0.14, 0.12],
      'enamel',
      { trim: 'label', tags: ['labelled-goods', 'barcode'] },
    ),
    prop(
      'printed-label',
      'printed-label',
      'Printed counter plate',
      'Printed plate lettered with the counter price list in the period face.',
      'signage',
      'counter-back',
      [-0.14, 0.1],
      [0.14, 0.02, 0.1],
      'label',
      { tags: ['printed-labelling'] },
    ),
    prop(
      'barcode-scanner',
      'barcode-scanner',
      'Handheld barcode scanner',
      'Corded scanner resting in a cradle at the counter edge, read lamp lit.',
      'payment',
      'counter-lip',
      [0.13, 0],
      [0.16, 0.1, 0.06],
      'scannerShell',
      { lift: 0.02, trim: 'chrome', tags: ['barcode-scanner', 'scanner-cradle'] },
    ),
    prop(
      'price-card',
      'price-card',
      'Printed price card',
      'Printed card in a chrome holder beside the scanner.',
      'signage',
      'counter-lip',
      [-0.04, 0],
      [0.1, 0.09, 0.02],
      'label',
      { rotationY: 0.3, trim: 'chrome', tags: ['printed-labelling'] },
    ),
    prop(
      'tip-jar',
      'tip-jar',
      'Mug-shaped tip jar',
      'Novelty mug-shaped jar with a printed label, standing at the customer edge.',
      'payment',
      'counter-lip',
      [-0.16, 0],
      [0.09, 0.13, 0.09],
      'glass',
      { tags: ['tip-jar', 'novelty'] },
    ),
    prop(
      'cable',
      'cable',
      'PVC register lead',
      'Grey PVC lead from the register running along the island edge to the wall socket.',
      'cabling',
      'counter-front',
      [0.2, -0.03],
      [0.02, 0.025, 0.26],
      'rubber',
      { tags: ['cable', 'era-correct-cable'] },
    ),
  ],
  notes: [
    'The mechanical crank and the lever are gone; a keypad and a numeric LED face replace them.',
    'A handheld barcode scanner and a labelled tin sit beside the register, both carrying printed barcodes.',
    'The thermal roll and its tape replace the 1965 printer paper, and the tape still advances.',
  ],
  tags: ['electronic-register', 'led-display', 'barcode-scanner', 'receipt-roll', 'cash-first'],
};

export default SPEC_1985;
