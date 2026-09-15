/**
 * 1985 — thick stoneware mugs, printed logos and glass tumblers.
 *
 * The high-street coffee shop arrives, and with it the first proper branding:
 * a wide cylindrical stoneware mug and a straight-sided tumbler both silkscreen
 * printed with the house logo, chunky stainless cutlery with black bakelite
 * handles, a moulded plastic condiment caddy full of sachets, a printed napkin
 * dispenser, a moulded plastic ashtray, and a canteen tray in coloured plastic.
 * Sugar and sauce arrive portioned in sachets rather than loose.
 */

import type { TablewareSpec } from '../TablewareModule';
import { tablewareRecipe } from '../tablewareTextures';

export const SPEC_1985: TablewareSpec = {
  year: '1985',
  label: '1985',
  name: 'Logo stoneware and glass tumblers',
  summary:
    'A thick printed house-logo stoneware mug, a matching printed tumbler, chunky cutlery with bakelite handles and sachets in a moulded caddy.',
  paletteName: 'Oxblood print on grey stoneware',
  materialSetId: 'material-set:1985-oxblood-stoneware',
  tags: ['stoneware', 'logo', 'bakelite', 'moulded-plastic', 'sachets', 'printed'],
  notes: [
    'The logo goes on the wares: the mug band and the tumbler band both carry the printed house monogram.',
    'Portions grow: a 285 ml mug poured five-sixths to the top, with the tumbler beside it.',
    'Sugar and sauces come portioned in printed sachets instead of loose in a bowl.',
    'Paper napkins are dispensed from a printed box, and the ashtray is moulded plastic rather than glass.',
  ],
  accentColor: '#a8383a',

  vessels: {
    cup: {
      kind: 'stoneware-mug',
      label: 'Thick house-logo stoneware mug',
      bodySlot: 'stoneware',
      trimSlot: 'stoneware',
      printSlot: 'print',
      mark: 'CAFE',
      rimDiameter: 0.088,
      baseDiameter: 0.078,
      height: 0.095,
      wall: 0.006,
      capacityMl: 320,
      fillFraction: 0.85,
      handle: 'chunky-loop',
      rest: 'coaster',
      lid: 'none',
      sleeve: 'none',
      detail: 'Straight cylindrical body, thick rolled rim, chunky loop handle and a silk-screened band.',
      note: 'Filled almost to the rim: a 285 ml mug, by now the standard measure of the decade.',
    },
    espresso: null,
    tumbler: {
      kind: 'glass-tumbler',
      label: 'Printed logo tumbler',
      bodySlot: 'glass',
      trimSlot: null,
      printSlot: 'print',
      mark: 'CAFE',
      rimDiameter: 0.072,
      baseDiameter: 0.064,
      height: 0.115,
      wall: 0.004,
      capacityMl: 260,
      fillFraction: 0.7,
      handle: 'none',
      rest: 'none',
      lid: 'none',
      sleeve: 'none',
      detail: 'Straight-sided tumbler with a heavy base and the house logo printed in one colour.',
      note: 'Iced coffee and water are served in the printed tumbler that matches the mug.',
    },
    takeaway: null,
    serveMl: 285,
    note: 'A 285 ml mug for hot drinks and a 260 ml printed tumbler for cold.',
  },

  tableService: {
    cutlery: [
      {
        kind: 'knife',
        label: 'Stainless knife with a bakelite handle',
        metalSlot: 'steel',
        handleSlot: 'bakelite',
        length: 0.168,
        polish: 'Satin stainless with a moulded handle',
        note: 'Chunky stainless blade riveted into a black bakelite handle.',
      },
      {
        kind: 'fork',
        label: 'Stainless fork with a bakelite handle',
        metalSlot: 'steel',
        handleSlot: 'bakelite',
        length: 0.164,
        polish: 'Satin stainless with a moulded handle',
        note: 'Four-tined fork with the same moulded handle as the knife.',
      },
    ],
    teaspoon: {
      label: 'Stainless teaspoon with a bakelite handle',
      metalSlot: 'steel',
      handleSlot: 'bakelite',
      length: 0.14,
      note: 'Longer teaspoon, so the printed coaster stays clear of the mug base.',
    },
    sugarBowl: {
      style: 'sachets-in-stoneware',
      label: 'Stoneware bowl of sugar sachets',
      bodySlot: 'stoneware',
      lidSlot: null,
      fittingSlot: null,
      fillFraction: 0.8,
      capacityMl: 220,
      note: 'Loose sugar is gone: the bowl holds printed white and brown sachets standing on edge.',
    },
    creamer: {
      style: 'stoneware-jug',
      label: 'Stoneware cream jug',
      bodySlot: 'stoneware',
      trimSlot: 'plastic',
      capacityMl: 120,
      note: 'Matching stoneware jug with a plastic lid to keep the milk cool between orders.',
    },
    condimentCaddy: {
      label: 'Moulded condiment caddy',
      traySlot: 'plastic',
      bottleSlot: 'plastic',
      capSlot: 'plastic',
      bottles: 2,
      sachets: true,
      stirrers: 0,
      note: 'A moulded caddy with two sauce bottles and a compartment of printed sachets.',
    },
    napkinHolder: {
      style: 'printed-dispenser',
      label: 'Printed napkin dispenser',
      holderSlot: 'plastic',
      napkinSlot: 'napkin',
      napkins: 20,
      mark: 'CAFE',
      note: 'Table-top dispenser in moulded plastic with the house logo printed on its face.',
    },
    ashtray: {
      style: 'moulded-plastic',
      label: 'Moulded plastic ashtray',
      slot: 'plastic',
      diameter: 0.086,
      notches: 3,
      note: 'Black moulded ashtray with three rests, stacked on the counter when the tables are cleared.',
    },
    tray: {
      style: 'plastic-canteen',
      label: 'Plastic canteen tray',
      slot: 'plastic',
      rimSlot: 'accent',
      width: 0.3,
      depth: 0.21,
      rimHeight: 0.014,
      note: 'Coloured plastic canteen tray with a rolled edge, wiped rather than polished.',
    },
    placement:
      'A printed mug on its coaster at each chair with the teaspoon beside it, a printed tumbler at the outer cover, chunky cutlery to the left, and the caddy, sugar sachets, dispenser and ashtray down the middle.',
  },

  counterPass: {
    stacks: [
      {
        kind: 'mug-stack',
        label: 'Stack of four mugs',
        pieces: 4,
        note: 'Four stoneware mugs stacked beside the grinder, logos all facing the room.',
      },
      {
        kind: 'tumbler-row',
        label: 'Row of printed tumblers',
        pieces: 5,
        note: 'Five printed tumblers stood in a row on the pass, drying upside-down.',
      },
      {
        kind: 'saucer-stack',
        label: 'Stack of four coasters',
        pieces: 4,
        note: 'Four printed coasters stacked on the pass for the table trays.',
      },
      {
        kind: 'tray-stack',
        label: 'Stack of canteen trays',
        pieces: 4,
        note: 'Four plastic trays stacked at the tray run.',
      },
      {
        kind: 'cutlery-caddy',
        label: 'Cutlery caddy',
        pieces: 6,
        note: 'A caddy of chunky handled cutlery, heads up, by the till.',
      },
      {
        kind: 'napkin-stack',
        label: 'Napkin stack',
        pieces: 6,
        note: 'Napkin refills stacked for the table dispensers.',
      },
    ],
    arrangement:
      'Mug and tumbler stacks fill the tray run, coasters under them, trays, cutlery caddy and napkin refills on the handoff side.',
  },

  surfaces: {
    china: tablewareRecipe('Cream vitrified china', 'glaze', '#f0e9da', '#bcb09a', 0.34, 0.02, {
      detail: '#cbc0aa',
      highlight: '#fffaf0',
      scale: 3,
      side: 'double',
    }),
    chinaRim: tablewareRecipe('Oxblood rim band', 'glaze', '#a8383a', '#7b2628', 0.3, 0.03, {
      detail: '#5c1b1d',
      highlight: '#d06e70',
      scale: 3,
      side: 'double',
    }),
    porcelain: tablewareRecipe('White porcelain', 'glaze', '#f7f3ea', '#c6bda9', 0.2, 0.02, {
      detail: '#d6cebb',
      highlight: '#ffffff',
      scale: 2,
      side: 'double',
    }),
    stoneware: tablewareRecipe('Thick grey stoneware', 'stoneware', '#9a948a', '#6f6a61', 0.66, 0.04, {
      detail: '#524e47',
      highlight: '#c2bcb1',
      scale: 6,
      side: 'double',
    }),
    glass: tablewareRecipe('Heavy clear tumbler glass', 'glass', '#e2eae7', '#b7c2bf', 0.08, 0.02, {
      detail: '#9aa5a2',
      highlight: '#fcfefc',
      scale: 4,
      transparent: true,
      opacity: 0.44,
      side: 'double',
    }),
    tintedGlass: tablewareRecipe('Cola-brown glass', 'glass', '#8d6746', '#66472e', 0.09, 0.03, {
      detail: '#503620',
      highlight: '#c9a37c',
      scale: 3,
      transparent: true,
      opacity: 0.52,
      side: 'double',
    }),
    paper: tablewareRecipe('Printed paper cup stock', 'paper', '#f4efe3', '#a8383a', 0.82, 0, {
      detail: '#c4b9a1',
      highlight: '#fffdf6',
      scale: 4,
      mark: 'CAFE',
      side: 'double',
    }),
    corrugated: tablewareRecipe('Kraft corrugated board', 'flute', '#c69f70', '#8d6a41', 0.9, 0, {
      detail: '#6b4e2e',
      highlight: '#e0c096',
      scale: 7,
      side: 'double',
    }),
    sleeve: tablewareRecipe('Printed sleeve card', 'card', '#f0e8d8', '#a8383a', 0.78, 0, {
      detail: '#b6a888',
      highlight: '#fffdf6',
      scale: 4,
      mark: 'CAFE',
      side: 'double',
    }),
    plastic: tablewareRecipe('Grey moulded plastic', 'plastic', '#8f8c85', '#6a6862', 0.44, 0.04, {
      detail: '#55534e',
      highlight: '#b8b5ad',
      scale: 5,
    }),
    steel: tablewareRecipe('Satin stainless steel', 'steel', '#bdbfbe', '#868988', 0.32, 0.82, {
      detail: '#666969',
      highlight: '#eef1f1',
      scale: 5,
    }),
    plated: tablewareRecipe('Plated hotel fittings', 'plated', '#d9d7cf', '#95928a', 0.24, 0.88, {
      detail: '#736f68',
      highlight: '#fbfaf7',
      scale: 5,
    }),
    enamel: tablewareRecipe('Enamelled steel', 'enamel', '#ddd7c6', '#2d2c28', 0.3, 0.14, {
      detail: '#8c8679',
      highlight: '#fdfbf4',
      scale: 3,
      side: 'double',
    }),
    chrome: tablewareRecipe('Chromed fittings', 'chrome', '#c6c9c8', '#7f8281', 0.18, 0.92, {
      detail: '#616463',
      highlight: '#f5f8f8',
      scale: 4,
    }),
    bakelite: tablewareRecipe('Black bakelite cutlery handle', 'bakelite', '#33302c', '#1a1815', 0.36, 0.08, {
      detail: '#131110',
      highlight: '#5f5a52',
      scale: 5,
    }),
    wood: tablewareRecipe('Varnished beech caddy', 'wood', '#8a6741', '#5b3f26', 0.62, 0.03, {
      detail: '#452f1b',
      highlight: '#b5925f',
      scale: 5,
    }),
    napkin: tablewareRecipe('Printed paper napkin', 'weave', '#f6f1e4', '#d0c7b3', 0.9, 0, {
      detail: '#b1a791',
      highlight: '#fffdf7',
      scale: 5,
      side: 'double',
    }),
    print: tablewareRecipe('House logo, silk-screened', 'print', '#f8f4ea', '#a8383a', 0.72, 0.02, {
      detail: '#8d8274',
      highlight: '#ffffff',
      scale: 3,
      mark: 'CAFE',
      side: 'double',
    }),
    sugar: tablewareRecipe('Sugar sachet contents', 'granular', '#f9f5ec', '#d3ccbb', 0.7, 0, {
      detail: '#b6ae9d',
      highlight: '#ffffff',
      scale: 6,
    }),
    condiment: tablewareRecipe('Brown sauce bottle', 'sauce', '#4f2c14', '#7d4c25', 0.3, 0.02, {
      detail: '#33190a',
      highlight: '#a4703f',
      scale: 3,
    }),
    brew: tablewareRecipe('Filter coffee, poured long', 'sauce', '#523018', '#7f5528', 0.2, 0.02, {
      detail: '#331c0b',
      highlight: '#ad7a44',
      scale: 3,
    }),
    rubber: tablewareRecipe('Rubber non-slip ring', 'rubber', '#43413d', '#2a2926', 0.76, 0.02, {
      detail: '#212020',
      highlight: '#6f6c66',
      scale: 6,
    }),
    accent: tablewareRecipe('Oxblood moulding', 'plastic', '#a8383a', '#7c2729', 0.4, 0.06, {
      detail: '#5e1d1f',
      highlight: '#d2706f',
      scale: 4,
    }),
  },
};
