/**
 * 1945 — utility china, plated steel and rationed portions.
 *
 * The café's service is patched together from pre-war china and Utility scheme
 * replacements: heavy white cups with a cobalt line at the rim, thick saucers,
 * pressed glass water tumblers, plated nickel-silver cutlery worn thin at the
 * bolster, a lidded china sugar bowl that is only a third full, an enamelled
 * steel tray and a folded linen napkin. Tea is poured **two-thirds** of the way
 * up the cup because tea was still on the ration; sugar was shorter still. The
 * cigarette is not rationed, so every table carries a thick glass ashtray.
 */

import type { TablewareSpec } from '../TablewareModule';
import { tablewareRecipe } from '../tablewareTextures';

export const SPEC_1945: TablewareSpec = {
  year: '1945',
  label: '1945',
  name: 'Utility china and plated steel',
  summary:
    'Heavy white utility china with a cobalt rim line, pressed glass tumblers, plated cutlery and a lidded sugar bowl kept one third full.',
  paletteName: 'Utility china and plated steel',
  materialSetId: 'material-set:1945-utility-china',
  tags: ['utility-china', 'plated', 'rationed', 'enamel', 'pressed-glass', 'linen'],
  notes: [
    'Cups are poured two-thirds full: tea and sugar were both still rationed in 1945.',
    'The service mixes pre-war china with Utility scheme replacements, so nothing matches exactly.',
    'Cutlery is plated nickel-silver rather than stainless, and every piece shows the plating worn at the bolster.',
    'Smoking indoors is unremarkable: every table has a thick glass ashtray with rests for a cigarette.',
  ],
  accentColor: '#c9c2ad',

  vessels: {
    cup: {
      kind: 'china-cup',
      label: 'Heavy utility china cup',
      bodySlot: 'china',
      trimSlot: 'chinaRim',
      printSlot: null,
      mark: null,
      rimDiameter: 0.082,
      baseDiameter: 0.056,
      height: 0.064,
      wall: 0.0052,
      capacityMl: 190,
      fillFraction: 0.6,
      handle: 'small-loop',
      rest: 'saucer',
      lid: 'none',
      sleeve: 'none',
      detail: 'Thick vitreous body, rolled rim, cobalt line and a small loop handle of hollowed china.',
      note: 'Served two-thirds full — a short pour from a thick cup, with the saucer under it to catch the spill.',
    },
    espresso: null,
    tumbler: {
      kind: 'glass-tumbler',
      label: 'Pressed glass water tumbler',
      bodySlot: 'glass',
      trimSlot: null,
      printSlot: null,
      mark: null,
      rimDiameter: 0.07,
      baseDiameter: 0.06,
      height: 0.105,
      wall: 0.004,
      capacityMl: 200,
      fillFraction: 0.55,
      handle: 'none',
      rest: 'none',
      lid: 'none',
      sleeve: 'none',
      detail: 'Heavy pressed base with a faint mould seam and no decoration at all.',
      note: 'Tap water stood on every table in a pressed glass tumbler rented from the local dairy.',
    },
    takeaway: null,
    serveMl: 180,
    note: 'A 180 ml pour in the utility cup and a 200 ml water glass beside it.',
  },

  tableService: {
    cutlery: [
      {
        kind: 'knife',
        label: 'Plated nickel-silver knife',
        metalSlot: 'plated',
        handleSlot: null,
        length: 0.17,
        polish: 'High polish, rubbed dull along the blade',
        note: 'A plated table knife, re-plated once and rounded at the tip.',
      },
      {
        kind: 'fork',
        label: 'Plated nickel-silver fork',
        metalSlot: 'plated',
        handleSlot: null,
        length: 0.166,
        polish: 'High polish, worn matte at the neck',
        note: 'Four-tined plated fork with a plain, slightly tapered handle.',
      },
      {
        kind: 'spoon',
        label: 'Plated dessert spoon',
        metalSlot: 'plated',
        handleSlot: null,
        length: 0.164,
        polish: 'High polish with fine service scratches',
        note: 'A shallow dessert spoon for pudding and for stirring the sugar down.',
      },
    ],
    teaspoon: {
      label: 'Plated teaspoon',
      metalSlot: 'plated',
      handleSlot: null,
      length: 0.135,
      note: 'Short plated teaspoon, resting on the saucer where it left a ring.',
    },
    sugarBowl: {
      style: 'lidded-china',
      label: 'Lidded utility sugar bowl',
      bodySlot: 'china',
      lidSlot: 'china',
      fittingSlot: null,
      fillFraction: 0.35,
      capacityMl: 180,
      note: 'Lidded bowl kept barely a third full: sugar was the last thing to come off the ration.',
    },
    creamer: {
      style: 'china-jug',
      label: 'China cream jug',
      bodySlot: 'china',
      trimSlot: 'chinaRim',
      capacityMl: 90,
      note: 'Small china jug, filled with watered milk and wiped at the lip.',
    },
    condimentCaddy: {
      label: 'Glass cruet tray',
      traySlot: 'glass',
      bottleSlot: 'glass',
      capSlot: 'plated',
      bottles: 3,
      sachets: false,
      stirrers: 0,
      note: 'A glass tray carrying salt, pepper and a mustard pot with plated lids.',
    },
    napkinHolder: {
      style: 'folded-linen',
      label: 'Folded linen napkins',
      holderSlot: 'plated',
      napkinSlot: 'napkin',
      napkins: 6,
      mark: null,
      note: 'Three linen napkins folded in a pile with a plated ring through them.',
    },
    ashtray: {
      style: 'thick-glass',
      label: 'Thick glass ashtray',
      slot: 'glass',
      diameter: 0.084,
      notches: 3,
      note: 'Deep pressed glass ashtray with a rest for a cigarette at the rim.',
    },
    tray: {
      style: 'enamel-metal',
      label: 'Enamelled steel tray',
      slot: 'enamel',
      rimSlot: 'plated',
      width: 0.26,
      depth: 0.18,
      rimHeight: 0.014,
      note: 'White enamelled steel tray with a rolled rim and a chip or two on the edge.',
    },
    placement:
      'A cup, saucer and plated spoon at each chair, plated cutlery to the left, the cruet tray, sugar bowl, folded napkins and ashtray down the middle of the table.',
  },

  counterPass: {
    stacks: [
      {
        kind: 'saucer-stack',
        label: 'Stack of six saucers',
        pieces: 6,
        note: 'Six thick saucers stacked with their wells up, ready for the next order.',
      },
      {
        kind: 'cup-stack',
        label: 'Stack of four cups',
        pieces: 4,
        note: 'Four utility cups nested upside-down on a clean cloth.',
      },
      {
        kind: 'tumbler-row',
        label: 'Row of pressed tumblers',
        pieces: 4,
        note: 'Water glasses stood in a row, drying mouth-down on the counter.',
      },
      {
        kind: 'tray-stack',
        label: 'Stack of enamelled trays',
        pieces: 3,
        note: 'Three trays stacked by the pass for the waitress run.',
      },
      {
        kind: 'cutlery-caddy',
        label: 'Cutlery caddy',
        pieces: 6,
        note: 'A caddy of plated spoons and forks, heads up, by the till.',
      },
      {
        kind: 'napkin-stack',
        label: 'Napkin stack',
        pieces: 5,
        note: 'Folded linen napkins stacked under a weight.',
      },
    ],
    arrangement:
      'Cup and saucer stacks with a row of water glasses on the tray run, trays and the cutlery caddy on the handoff side.',
  },

  surfaces: {
    china: tablewareRecipe('Thick white utility china', 'glaze', '#efe9dc', '#b8ad96', 0.34, 0.02, {
      detail: '#cbc2ab',
      highlight: '#fdfaf2',
      scale: 3,
      side: 'double',
    }),
    chinaRim: tablewareRecipe('Cobalt rim line', 'glaze', '#33517d', '#1d3457', 0.3, 0.04, {
      detail: '#16273f',
      highlight: '#6d8cb5',
      scale: 3,
      side: 'double',
    }),
    porcelain: tablewareRecipe('Fine cream porcelain', 'glaze', '#f6f2e7', '#c3b9a4', 0.24, 0.02, {
      detail: '#d5cdb9',
      highlight: '#fffdf6',
      scale: 3,
      side: 'double',
    }),
    stoneware: tablewareRecipe('Brown salt-glazed stoneware', 'stoneware', '#b07a4e', '#7c5030', 0.55, 0.03, {
      detail: '#5f3a20',
      highlight: '#d8a878',
      scale: 5,
      side: 'double',
    }),
    glass: tablewareRecipe('Pressed utility glass', 'glass', '#dfe7e2', '#b6c2bc', 0.09, 0.02, {
      detail: '#9aa8a2',
      highlight: '#fbfdfb',
      scale: 4,
      transparent: true,
      opacity: 0.5,
      side: 'double',
    }),
    tintedGlass: tablewareRecipe('Water in the tumbler', 'glass', '#cfe0d6', '#a9bdb2', 0.08, 0.02, {
      detail: '#8fa498',
      highlight: '#f4fbf6',
      scale: 3,
      transparent: true,
      opacity: 0.45,
      side: 'double',
    }),
    paper: tablewareRecipe('Wartime paper napkin stock', 'paper', '#f2ece0', '#8a7657', 0.86, 0, {
      detail: '#c6b998',
      highlight: '#fdf8ee',
      scale: 5,
      mark: 'CAFE',
      side: 'double',
    }),
    corrugated: tablewareRecipe('Kraft corrugated board', 'flute', '#c8a273', '#8f6c44', 0.92, 0, {
      detail: '#6f5231',
      highlight: '#e2c39a',
      scale: 7,
      side: 'double',
    }),
    sleeve: tablewareRecipe('Printed sleeve card', 'card', '#efe6d5', '#6d5136', 0.8, 0, {
      detail: '#b9a583',
      highlight: '#fdf7ea',
      scale: 4,
      mark: 'CAFE',
      side: 'double',
    }),
    plastic: tablewareRecipe('Early phenolic moulding', 'bakelite', '#4a3a2c', '#2b211a', 0.42, 0.05, {
      detail: '#241b15',
      highlight: '#7d6851',
      scale: 4,
    }),
    steel: tablewareRecipe('Wartime steel sheet', 'steel', '#a9a49a', '#6f6a62', 0.42, 0.6, {
      detail: '#56534d',
      highlight: '#d8d5cd',
      scale: 4,
    }),
    plated: tablewareRecipe('Plated nickel-silver cutlery', 'plated', '#d8d5cb', '#8d8a80', 0.24, 0.93, {
      detail: '#6f6c63',
      highlight: '#fbfaf6',
      scale: 5,
    }),
    enamel: tablewareRecipe('Enamelled steel tray', 'enamel', '#dfd9c8', '#2b2a26', 0.28, 0.14, {
      detail: '#8d877a',
      highlight: '#fdfbf5',
      scale: 3,
      side: 'double',
    }),
    chrome: tablewareRecipe('Polished nickel trim', 'chrome', '#c3c6c5', '#7a7d7c', 0.2, 0.9, {
      detail: '#5f6262',
      highlight: '#f4f7f7',
      scale: 4,
    }),
    bakelite: tablewareRecipe('Black bakelite fittings', 'bakelite', '#3a2f28', '#1e1815', 0.4, 0.06, {
      detail: '#171310',
      highlight: '#68584c',
      scale: 5,
    }),
    wood: tablewareRecipe('Painted deal caddy', 'wood', '#8a6a44', '#5a4128', 0.7, 0.02, {
      detail: '#463220',
      highlight: '#b49469',
      scale: 5,
    }),
    napkin: tablewareRecipe('Linen table napkin', 'weave', '#efe7d6', '#c8bba3', 0.9, 0, {
      detail: '#a89b83',
      highlight: '#fdf9ef',
      scale: 5,
      side: 'double',
    }),
    print: tablewareRecipe('Carbon-copy bill of fare', 'print', '#f4efe2', '#3b3a35', 0.85, 0, {
      detail: '#8d877a',
      highlight: '#fffdf6',
      scale: 3,
      mark: 'CAFE',
      side: 'double',
    }),
    sugar: tablewareRecipe('Loose rationed sugar', 'granular', '#f6f1e6', '#cfc7b4', 0.7, 0, {
      detail: '#b3ab97',
      highlight: '#fffdf6',
      scale: 6,
    }),
    condiment: tablewareRecipe('Brown sauce', 'sauce', '#5a3418', '#8a5a2a', 0.3, 0.02, {
      detail: '#3a2110',
      highlight: '#b08050',
      scale: 3,
    }),
    brew: tablewareRecipe('Strong tea, poured short', 'sauce', '#7a4a1e', '#b07a3a', 0.22, 0.02, {
      detail: '#4c2c11',
      highlight: '#d8a860',
      scale: 3,
    }),
    rubber: tablewareRecipe('Rubber gasket ring', 'rubber', '#4a4640', '#2e2b26', 0.75, 0.02, {
      detail: '#262320',
      highlight: '#736d64',
      scale: 6,
    }),
    accent: tablewareRecipe('Utility cream enamel', 'enamel', '#d9cfae', '#a89a76', 0.34, 0.08, {
      detail: '#8d805f',
      highlight: '#f6efd9',
      scale: 3,
    }),
  },
};
