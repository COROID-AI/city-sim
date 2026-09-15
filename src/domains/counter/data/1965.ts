/**
 * 1965 counter technology — the mechanical register.
 *
 * The lever till is gone. In its place an enamelled steel register on a spring
 * drawer: three rows of round keys on a sloped key bank, a glazed window over
 * the accumulating dials, a side crank for the staff to wind, and a receipt
 * printer that feeds printed tape out of its slot. Printed plates carry the
 * model name and the price list, and the coin tray is a steel insert with
 * labelled compartments.
 *
 * Placement (offsets in metres from the band anchors published by
 * `CounterTechModule.counterBandAnchors`): the drawer and the register body sit
 * in the front band, the printer, tape, coin tray and printed plate in the
 * operator's back band, the cord along the island's outer edge, and the price
 * card and tip jar on the customer lip.
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

/** The 1965 counter: an enamelled key register with printed paper tape. */
export const SPEC_1965: CounterTechSpec = {
  year: '1965',
  label: '1965',
  name: 'Formica and decimal counting',
  summary:
    'The counter has a key bank and a crank now: prices are rung up, accumulated in the glazed dials and printed onto a paper tape that feeds out of the printer.',
  caption: 'key-and-crank register with a printed tape',
  deviceFamily: 'mechanical-register',
  device: {
    name: 'Norvic 200 key register',
    kind: 'register-body',
    detail:
      'Enamelled steel register with three rows of keys, a glazed dial window, a winding crank and a tape printer on top.',
  },
  payment: {
    name: 'Spring cash drawer',
    kind: 'cash-drawer',
    mode: 'cash-only',
    detail: 'The key bank trips the spring drawer; change is counted from the labelled steel compartments.',
  },
  displayDetail: 'The dials step over behind glass as the keys are pressed, and printed tape carries the total.',
  paletteName: 'Cream enamel, chrome and formica',
  materialSetId: 'counter-1965-enamel-chrome-and-formica',
  surfaces: {
    enamel: {
      finish: 'cream enamel register housing with a flecked green second colour',
      style: { kind: 'enamel-plate', base: '#ddd6bd', accent: '#6f7a5c', ink: '#3c3a2c' },
      roughness: 0.34,
      metalness: 0.1,
    },
    steel: {
      finish: 'chromed steel drawer face',
      style: { kind: 'steel-drawer', base: '#b7bcc0', accent: '#7c8286', ink: '#43484b' },
      roughness: 0.36,
      metalness: 0.68,
    },
    chrome: {
      finish: 'polished chrome crank and trim',
      style: { kind: 'chrome', base: '#e9edef', accent: '#9aa4aa', ink: '#5c6468' },
      roughness: 0.12,
      metalness: 0.95,
    },
    keyface: {
      finish: 'printed key bank with white ringed keys',
      style: {
        kind: 'key-legend',
        base: '#c8c1ad',
        accent: '#8b8471',
        ink: '#33302a',
        text: '1234567890',
      },
      roughness: 0.44,
      metalness: 0.14,
    },
    receiptPaper: {
      finish: 'printed paper tape from the Norvic printer',
      style: {
        kind: 'receipt-paper',
        base: '#f4f0e2',
        accent: '#d8d2bd',
        ink: '#3d382e',
        mark: 'NORVIC 200',
        lines: ['2 COFFEE 11d', '1 TEA 9d', '1 CAKE 1s', 'CASH 2s 8d'],
        text: 'TOTAL 2s 8d',
      },
    },
    label: {
      finish: 'printed enamel price plate in a chrome holder',
      style: {
        kind: 'printed-label',
        base: '#e4dcc4',
        accent: '#7d7259',
        ink: '#332c20',
        mark: 'NORVIC',
        text: 'COFFEE 11d',
        lines: ['TEA 9d', 'CAKE 1s'],
      },
    },
    wood: {
      finish: 'teak edge and drawer runners',
      style: { kind: 'wood-till', base: '#6f4d2e', accent: '#432d1a', ink: '#281a10', scale: 2 },
      roughness: 0.6,
    },
    felt: {
      finish: 'felt-lined coin compartments with printed labels',
      style: { kind: 'coin-felt', base: '#3a3f46', accent: '#78818c', ink: '#22262a', size: 64 },
    },
    rubber: {
      finish: 'braided cloth power cord',
      style: { kind: 'rubber-cable', base: '#4b463c', accent: '#6d6555', ink: '#26231d' },
    },
  },
  animation: {
    displayKind: 'mechanical-dial',
    displayBlinkSeconds: 0,
    displayOnFraction: 0,
    displayGlow: 0,
    screenBreatheSeconds: 0,
    statusPulseSeconds: 3.5,
    tapeSpeed: 0.05,
    tapeLength: 0.16,
    drawerNudgeSeconds: 11,
    drawerNudgeDuration: 1.3,
    drawerNudgeMetres: 0.02,
    tapPeriodSeconds: 0,
    tapDurationSeconds: 0,
    cue: 'The crank winds, the dials step over behind the glass and printed tape feeds out of the printer slot.',
  },
  inventory: [
    prop(
      'cash-drawer',
      'cash-drawer',
      'Spring cash drawer',
      'Steel drawer with a chromed face, pressed note wells and a removable coin insert.',
      'cash',
      'counter-front',
      [0, 0],
      [0.3, 0.1, 0.2],
      'steel',
      { trim: 'felt', tags: ['spring-drawer', 'steel'] },
    ),
    prop(
      'register-body',
      'register-body',
      'Norvic 200 register',
      'Enamelled housing on a sloped key bank; the glazed window shows the accumulating dials.',
      'register',
      'drawer-line',
      [0, 0],
      [0.3, 0.24, 0.18],
      'enamel',
      { lift: 0, trim: 'keyface', tags: ['key-bank', 'mechanical-dial', 'enamel'] },
    ),
    prop(
      'register-crank',
      'register-crank',
      'Winding crank',
      'Chrome crank on the right cheek; the staff wind it once per sale to reset the dials.',
      'register',
      'counter-front',
      [0.19, 0],
      [0.03, 0.2, 0.1],
      'chrome',
      { lift: 0.02, tags: ['crank', 'animated'] },
    ),
    prop(
      'receipt-printer',
      'receipt-printer',
      'Tape printer',
      'Printer unit clamped to the back of the register, with a slot, a roll housing and a printed plate.',
      'register',
      'counter-back',
      [-0.09, -0.1],
      [0.16, 0.12, 0.14],
      'printerShell',
      { trim: 'chrome', tags: ['receipt-printer', 'paper'] },
    ),
    prop(
      'receipt-tape',
      'receipt-tape',
      'Printed receipt tape',
      'Paper tape feeding out of the printer slot, printed with the era price list.',
      'register',
      'counter-back',
      [-0.09, -0.005],
      [0.06, 0.16, 0.02],
      'receiptPaper',
      { lift: 0.06, tags: ['paper', 'animated'] },
    ),
    prop(
      'coin-tray',
      'coin-tray',
      'Steel coin tray',
      'Six labelled compartments for the new cupro-nickel coins, lined with felt.',
      'cash',
      'counter-back',
      [0.09, -0.1],
      [0.18, 0.03, 0.12],
      'steel',
      { trim: 'felt', tags: ['coin-tray', 'labelled'] },
    ),
    prop(
      'printed-label',
      'printed-label',
      'Printed model plate',
      'Enamelled plate in a chrome holder, lettered NORVIC 200 in the period block type.',
      'signage',
      'counter-back',
      [-0.09, 0.1],
      [0.14, 0.02, 0.1],
      'label',
      { tags: ['printed-labelling', 'enamel'] },
    ),
    prop(
      'price-card',
      'price-card',
      'Printed price card',
      'Card printed with the counter price list, propped in a chrome holder.',
      'signage',
      'counter-lip',
      [-0.12, 0],
      [0.1, 0.09, 0.02],
      'label',
      { rotationY: 0.32, trim: 'chrome', tags: ['printed-labelling'] },
    ),
    prop(
      'tip-jar',
      'tip-jar',
      'Glass tip jar',
      'Screw-top jar with a printed saucer label, standing beside the price card.',
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
      'Braided counter cord',
      'Braided cloth cord running along the island edge from the register to the wall socket.',
      'cabling',
      'counter-front',
      [-0.2, -0.03],
      [0.02, 0.025, 0.26],
      'rubber',
      { tags: ['cable', 'era-correct-cable'] },
    ),
  ],
  notes: [
    'The crank and the key bank replace the lever and the bell; the dials replace the handwritten docket total.',
    'The tape printer turns the docket into printed paper: the tape feeds and its printed lines scroll.',
    'Prices are still in pounds, shillings and pence.',
  ],
  tags: ['mechanical-register', 'cash-only', 'key-bank', 'crank', 'receipt-printer', 'printed-labelling'],
};

export default SPEC_1965;
