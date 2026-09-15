/**
 * 2025 counter technology — the tablet POS and the contactless reader.
 *
 * The till is a tablet clamped into an aluminium stand, the payment device is a
 * contactless puck on the customer lip that acknowledges every tap with a
 * pulsing ring, a printed QR card invites guests to order from their table, and
 * a slim pick-up shelf stands beside the counter for app orders. The cash
 * drawer is a slim note drawer: the coin tray is a compact tray in the operator
 * row, never the drawer frontage.
 *
 * Placement (offsets in metres from the band anchors published by
 * `CounterTechModule.counterBandAnchors`): the slim drawer and the tablet stand
 * in the front band, the compact coin tray, contactless notice and the braided
 * lead around it, the reader, tap disc, QR card and tip jar on the customer lip,
 * and the pick-up shelf on the floor beside the counter.
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

/** The 2025 counter: a tablet, a tap-to-pay puck and a pick-up shelf. */
export const SPEC_2025: CounterTechSpec = {
  year: '2025',
  label: '2025',
  name: 'Contactless, QR and pick-up',
  summary:
    'The till is a tablet on a stand: orders arrive from the QR card, the contactless puck takes the tap and the pick-up shelf holds the finished bags.',
  caption: 'tablet POS with contactless and QR ordering',
  deviceFamily: 'tablet-contactless',
  device: {
    name: 'CounterTab tablet POS',
    kind: 'tablet',
    detail:
      'Glass tablet clamped into an aluminium stand, showing the live order list and the tap-to-pay prompt.',
  },
  payment: {
    name: 'Contactless reader',
    kind: 'contactless-reader',
    mode: 'contactless-first',
    detail:
      'Puck reader on the customer lip; its ring pulses and its lamp lights whenever a card is tapped.',
  },
  displayDetail: 'The tablet screen breathes behind glass, and the reader answers every tap with a ring pulse.',
  paletteName: 'Glass, anodised aluminium and limewash',
  materialSetId: 'counter-2025-glass-aluminium-and-limewash',
  surfaces: {
    steel: {
      finish: 'brushed stainless drawer and shelf steel',
      style: { kind: 'steel-drawer', base: '#aeb3b5', accent: '#82878a', ink: '#454a4c' },
      roughness: 0.38,
      metalness: 0.62,
    },
    chrome: {
      finish: 'anodised aluminium stand and trim',
      style: { kind: 'chrome', base: '#d9dcdd', accent: '#9aa0a2', ink: '#5b6062' },
      roughness: 0.24,
      metalness: 0.78,
    },
    bakelite: {
      finish: 'glass-fronted tablet body and bezel',
      style: { kind: 'bakelite', base: '#26292b', accent: '#4c5254', ink: '#141617' },
      roughness: 0.22,
      metalness: 0.12,
    },
    tabletScreen: {
      finish: 'backlit tablet order screen with the tap-to-pay prompt',
      style: {
        kind: 'tablet-screen',
        base: '#1c2124',
        accent: '#2f6f6a',
        ink: '#eef3f2',
        mark: 'COUNTER TAB',
        lines: ['ORDER 248', 'FLAT WHITE x2', 'CROISSANT x1', 'PICKUP 12:40'],
      },
      emissive: '#8fb8c4',
      emissiveIntensity: 1.25,
    },
    contactless: {
      finish: 'contactless reader pad with the tap emblem',
      style: {
        kind: 'contactless-pad',
        base: '#f2f3f0',
        accent: '#5f6563',
        ink: '#3d4341',
        mark: 'TAP HERE',
      },
      roughness: 0.28,
      metalness: 0.1,
    },
    qr: {
      finish: 'printed QR ordering card in a card holder',
      style: {
        kind: 'qr-code',
        base: '#f7f6f1',
        accent: '#24292b',
        ink: '#4c524f',
        mark: 'SCAN TO ORDER',
      },
      roughness: 0.52,
      metalness: 0.03,
    },
    label: {
      finish: 'printed contactless notice plate',
      style: {
        kind: 'printed-label',
        base: '#eae5d8',
        accent: '#8d8a80',
        ink: '#33322d',
        mark: 'COUNTER TAB',
        text: 'TAP TO PAY',
        lines: ['ALL MAJOR CARDS'],
      },
      roughness: 0.6,
    },
    receiptPaper: {
      finish: 'recycled note paper for the pickup tickets',
      style: {
        kind: 'receipt-paper',
        base: '#f6f4ee',
        accent: '#ded9cd',
        ink: '#403c35',
        mark: 'PICK UP',
        lines: ['ORDER 248', 'FLAT WHITE x2', 'CROISSANT x1'],
        text: '12:40',
      },
    },
    shelfPaint: {
      finish: 'powder-coated steel pick-up shelf with a printed header',
      style: { kind: 'painted-shelf', base: '#8f948f', accent: '#5c615f', ink: '#333735' },
      roughness: 0.46,
      metalness: 0.4,
    },
    felt: {
      finish: 'felt-lined compact coin tray in the operator row',
      style: { kind: 'coin-felt', base: '#41413d', accent: '#83817a', ink: '#27272a', size: 64 },
    },
    rubber: {
      finish: 'braided USB-C lead with a clip',
      style: { kind: 'rubber-cable', base: '#2b2b2a', accent: '#57544d', ink: '#161615' },
    },
  },
  animation: {
    displayKind: 'tablet',
    displayBlinkSeconds: 0,
    displayOnFraction: 1,
    displayGlow: 1.25,
    screenBreatheSeconds: 5.5,
    statusPulseSeconds: 2.6,
    tapeSpeed: 0,
    tapeLength: 0,
    drawerNudgeSeconds: 14,
    drawerNudgeDuration: 0.85,
    drawerNudgeMetres: 0.015,
    tapPeriodSeconds: 7.5,
    tapDurationSeconds: 1.1,
    cue: 'The tablet screen breathes and the reader ring pulses with every contactless tap.',
  },
  inventory: [
    prop(
      'cash-drawer',
      'cash-drawer',
      'Slim note drawer',
      'Low-profile steel drawer for notes and the odd coin, flush under the tablet stand.',
      'cash',
      'counter-front',
      [0, 0],
      [0.3, 0.07, 0.2],
      'steel',
      { trim: 'felt', tags: ['slim-drawer', 'notes-only'] },
    ),
    prop(
      'tablet-stand',
      'tablet-stand',
      'Tablet stand',
      'Weighted aluminium base with a plated pole and a hinged clamp for the tablet.',
      'register',
      'drawer-line',
      [0, -0.02],
      [0.16, 0.28, 0.16],
      'chrome',
      { tags: ['tablet-stand', 'aluminium'] },
    ),
    prop(
      'tablet',
      'tablet',
      'CounterTab tablet',
      'Glass-fronted tablet showing the order list, clamped upright facing the counter.',
      'register',
      'drawer-line',
      [0, -0.02],
      [0.26, 0.2, 0.016],
      'bakelite',
      { lift: 0.28, rotationY: 0.12, trim: 'tabletScreen', tags: ['tablet-pos', 'display', 'animated'] },
    ),
    prop(
      'contactless-reader',
      'contactless-reader',
      'Contactless reader',
      'Puck reader on the customer lip with a printed tap emblem and an LED ring.',
      'payment',
      'counter-lip',
      [-0.16, 0],
      [0.1, 0.035, 0.1],
      'contactless',
      { trim: 'chrome', tags: ['contactless-reader', 'status-lamp'] },
    ),
    prop(
      'tap-target',
      'tap-target',
      'Tap acknowledgement disc',
      'Acrylic disc over the reader: the ring scales and lights for each acknowledged tap.',
      'payment',
      'counter-lip',
      [-0.16, 0],
      [0.06, 0.008, 0.06],
      'contactless',
      { lift: 0.035, tags: ['tap-acknowledgement', 'animated'] },
    ),
    prop(
      'qr-card',
      'qr-card',
      'QR ordering card',
      'Printed QR card in a holder, inviting guests to order from their table.',
      'signage',
      'counter-lip',
      [-0.02, 0],
      [0.09, 0.13, 0.015],
      'qr',
      { rotationY: 0.12, trim: 'chrome', tags: ['qr-ordering', 'printed'] },
    ),
    prop(
      'tip-jar',
      'tip-jar',
      'Glass tip jar',
      'Slim glass jar with a printed label, standing at the customer edge.',
      'payment',
      'counter-lip',
      [0.16, 0],
      [0.09, 0.13, 0.09],
      'glass',
      { tags: ['tip-jar', 'glass'] },
    ),
    prop(
      'coin-tray',
      'coin-tray',
      'Compact coin tray',
      'Small felt-lined tray kept in the operator row, well away from the drawer frontage.',
      'cash',
      'counter-back',
      [0.1, -0.1],
      [0.14, 0.025, 0.1],
      'felt',
      { trim: 'steel', tags: ['coin-tray', 'compact'] },
    ),
    prop(
      'printed-label',
      'printed-label',
      'Contactless notice plate',
      'Printed plate on the counter reading TAP TO PAY, with the accepted card symbols.',
      'signage',
      'counter-back',
      [-0.12, 0.1],
      [0.14, 0.02, 0.1],
      'label',
      { tags: ['printed-labelling', 'contactless'] },
    ),
    prop(
      'cable',
      'cable',
      'Braided USB-C lead',
      'Braided lead from the tablet stand to the reader, clipped flat along the island edge.',
      'cabling',
      'counter-front',
      [0.2, -0.03],
      [0.02, 0.02, 0.24],
      'rubber',
      { tags: ['cable', 'braided', 'era-correct-cable'] },
    ),
    prop(
      'pickup-shelf',
      'pickup-shelf',
      'Pick-up shelf',
      'Two-board steel shelf with a printed header and order tickets for app and QR orders.',
      'pickup',
      'floor-side',
      [0, 0],
      [0.42, 1.42, 0.95],
      'shelfPaint',
      { trim: 'receiptPaper', tags: ['pickup-shelf', 'app-orders', 'floor-standing'] },
    ),
  ],
  notes: [
    'The cash drawer frontage is deliberately plain: the compact coin tray lives in the operator row.',
    'No paper receipt is printed in this era; tickets on the pick-up shelf take its place.',
    'The contactless reader acknowledges every tap with a deterministic ring pulse.',
  ],
  tags: ['tablet-pos', 'contactless', 'tap-acknowledgement', 'qr-ordering', 'pickup-shelf'],
};

export default SPEC_2025;
