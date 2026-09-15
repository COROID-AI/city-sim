/**
 * 1945 — post-war utility brewing.
 *
 * Austerity with pride in it: the bar brews on a big enamelled *percolator urn*
 * standing on a cast-iron heating pad, filled by scoop and watched through a
 * glass sight tube. There is no espresso group, no steam wand and no panel
 * readout — the only control is a bakelite heat switch with three positions.
 * In the corner brews a sock-filter dripolator and an enamel kettle boils on the
 * ring; beans are ground by hand on a cast-iron wall mill bolted beside the
 * counter. Cobalt-banded white enamel, brass fittings and tinned copper are the
 * materials of the year, all of them showing their age.
 */

import type { BrewingSpec } from '../BrewingModule';
import { machineRecipe } from '../textures';

export const SPEC_1945: BrewingSpec = {
  year: '1945',
  label: '1945',
  name: 'Post-war utility',
  summary:
    'A 15-cup enamelled percolator urn on a cast-iron pad, a sock-filter dripolator, an enamel kettle and a hand-crank wall mill — cobalt banding, tinned copper and brass, all of it patched and scrubbed.',
  paletteName: 'Ivory enamel, cobalt rim and cast iron',
  materialSetId: 'material-set:1945-ivory-enamel-and-cast-iron',
  accentColor: '#2f4a6b',
  tags: ['enamel', 'cast-iron', 'brass', 'bakelite', 'percolator', 'utility'],
  notes: [
    'Espresso had not reached the British café in 1945: coffee meant percolated or filtered coffee, or a bottle of Camp coffee essence.',
    'The percolator urn was heated by a cast-iron element pad; the pump action was visible through the glass knob in the lid.',
    'Beans were ground to order on a wall-mounted cast-iron mill with a wooden crank and a tin grounds drawer.',
    'Milk was served from an enamel jug; the kettle and jug share the same chipped white enamel with a cobalt rim.',
  ],

  surfaces: [
    machineRecipe('body-enamel', 'Ivory enamelled base', 'enamel', '#e8e3d3', '#2f4a6b', 0.45, 0.02, {
      detail: '#9d9887',
      highlight: '#fbf8f0',
      scale: 5,
      wear: 0.72,
    }),
    machineRecipe('urn-enamel', 'Cobalt-banded urn envelope', 'enamel', '#efeade', '#27456b', 0.38, 0.03, {
      detail: '#8f8a79',
      highlight: '#ffffff',
      scale: 4,
      repeat: [2, 1],
      wear: 0.55,
    }),
    machineRecipe('trim-brass', 'Brass spigot, bands and bezels', 'brass', '#b08d4f', '#6b5326', 0.4, 0.75, {
      detail: '#4d3a18',
      highlight: '#e6cd8f',
      wear: 0.5,
    }),
    machineRecipe('handle-bakelite', 'Bakelite knobs and tap handle', 'bakelite', '#2a2018', '#4a3423', 0.55, 0.0, {
      detail: '#160f0a',
      highlight: '#6a4c33',
      wear: 0.4,
    }),
    machineRecipe('base-iron', 'Cast-iron heating pad and mill plate', 'cast-iron', '#2c2b28', '#171614', 0.8, 0.35, {
      detail: '#100f0e',
      highlight: '#4a4845',
      wear: 0.6,
    }),
    machineRecipe('boiler-copper', 'Tinned copper urn jacket', 'copper', '#a45f2c', '#4c7a55', 0.42, 0.7, {
      detail: '#5d3413',
      highlight: '#d99a5f',
      wear: 0.6,
    }),
    machineRecipe('pipe-copper', 'Copper percolator tube', 'copper', '#9a5a2b', '#4a6f4d', 0.45, 0.72, {
      detail: '#57300f',
      highlight: '#c98d55',
      wear: 0.5,
      scale: 3,
    }),
    machineRecipe('glass-sight', 'Boiler sight tube', 'glass', '#cfe3e0', '#5c7f78', 0.12, 0.0, {
      detail: '#3f5f59',
      highlight: '#ffffff',
      transparent: true,
      opacity: 0.5,
    }),
    machineRecipe('cup-porcelain', 'Warming-shelf cups', 'ceramic', '#f3f0e6', '#2f4a6b', 0.25, 0.0, {
      detail: '#c9c3b4',
      highlight: '#ffffff',
      wear: 0.3,
    }),
    machineRecipe('enamel-ware', 'Enamel kettle, jug and dripolator', 'enamel', '#f2f4f1', '#28457a', 0.35, 0.03, {
      detail: '#a8aca6',
      highlight: '#ffffff',
      scale: 6,
      wear: 0.55,
    }),
    machineRecipe('filter-cloth', 'Cotton filter sock and frame cloth', 'plastic', '#e8e0cc', '#9c8f74', 0.85, 0.0, {
      detail: '#7d7159',
      highlight: '#fbf6e8',
      scale: 3,
      orientation: 'vertical',
      wear: 0.45,
    }),
    machineRecipe('wood-grinder', 'Beech wall-mill body and crank', 'wood', '#7a4b24', '#3f2512', 0.7, 0.02, {
      detail: '#3a2210',
      highlight: '#b07f45',
      scale: 5,
      wear: 0.5,
    }),
    machineRecipe('dial-face', 'Heat-switch escutcheon', 'dial-face', '#efe6cf', '#242019', 0.35, 0.05, {
      detail: '#1c1913',
      highlight: '#fdf6e4',
      grid: 8,
      needle: 0.3,
      legend: { title: 'LOW', subtitle: 'HEAT' },
    }),
    machineRecipe('panel-legend', 'Enamelled maker plate', 'legend', '#e8e3d3', '#1d3b5c', 0.5, 0.0, {
      detail: '#8d8776',
      highlight: '#ffffff',
      transparency: 'pattern',
      legend: {
        title: 'PERCO',
        subtitle: 'ELECTRIC PERCOLATOR',
        lines: ['MODEL 45', 'MADE IN ENGLAND'],
        ink: '#1d3b5c',
        smallInk: '#5c6b7d',
      },
    }),
    machineRecipe('lamp-pilot', 'Amber boil lamp', 'plastic', '#c8781e', '#ffd9a0', 0.35, 0.0, {
      detail: '#7a4a10',
      highlight: '#ffe9c4',
      emissive: { color: '#ffb45c', intensity: 1.1 },
    }),
    machineRecipe('wear-patch', 'Scuffs, chips and coffee stains', 'wear', '#3a2a1c', '#5a4632', 0.7, 0.0, {
      detail: '#241708',
      highlight: '#8a7150',
      transparency: 'pattern',
      wear: 0.8,
      transparent: true,
      opacity: 0.4,
    }),
  ],

  machine: {
    id: 'machines:1945:percolator',
    archetype: 'percolator',
    label: 'Electric percolator urn',
    model: 'PERCO 45',
    brand: 'HARWOOD',
    summary:
      'A 15-cup enamelled percolator urn heated from a cast-iron pad, with a domed lid, a brass spigot and an enamel drip bowl.',
    dimensions: { width: 0.44, depth: 0.42, height: 0.74 },
    housing: {
      body: 'base-iron',
      front: 'urn-enamel',
      panel: 'panel-legend',
      trim: 'trim-brass',
      handle: 'handle-bakelite',
      boiler: 'boiler-copper',
      pipe: 'pipe-copper',
      glass: 'glass-sight',
      cup: 'cup-porcelain',
      cheek: 'body-enamel',
      display: 'panel-legend',
      wearPatch: 'wear-patch',
      panelStyle: 'riveted-enamel',
      feet: 'cast-iron-pads',
      wearLevel: 0.72,
      ventCount: 4,
      patina:
        'Chipped enamel on the urn shoulder, a dark ring of old boiling on the cast-iron pad and brass rubbed bright where hands lift the spigot.',
      panelNote:
        'One riveted enamel maker plate and a single bakelite heat switch: low, medium and high, with no scale, timer or lamp before the amber boil lens.',
    },
    groupCount: 0,
    hasEspressoGroup: false,
    brewMethod: 'percolation',
    dosingKind: 'none',
    dosingLabel: 'No dose control — basket filled by scoop',
    dosingDetail:
      'Coffee is measured with a tin scoop into the perforated basket; strength is judged by the colour in the sight tube.',
    hasDigitalDisplay: false,
    hasTouchPanel: false,
    hasSteamWand: false,
    steam: {
      boiler: 'Tinned copper urn on a cast-iron element pad',
      boilerLitres: 5.6,
      groupHead: 'none',
      wandCount: 0,
      wandLength: 0,
      pressureBar: 0.4,
      sightGlass: true,
      dripTray: 'brass-tray',
      pipeRuns: 2,
      purgeSeconds: 0,
      detail:
        'A copper pump tube lifts water over the basket and lets it fall back through the grounds: a gentle, gurgling percolation rather than pressure.',
    },
    dials: [
      {
        id: 'heat',
        label: 'Heat switch',
        face: 'knob',
        slot: 'dial-face',
        bezel: 'handle-bakelite',
        detail: 'Three-position bakelite switch, worn smooth, on a printed enamel escutcheon.',
      },
    ],
    lamps: [{ slot: 'lamp-pilot', label: 'Boil lamp', count: 1 }],
    cupWarmer: 'shelf',
    knockBox: false,
    portafilterMm: 0,
    basketCount: 2,
    clearance: 0.5,
    wear: [
      'Chipped enamel at the urn shoulder and the lid rim',
      'Brass spigot polished thin by decades of taps',
      'Cast-iron pad bloomed with rust where water dripped',
    ],
    detail: [
      'Domed urn lid with a glass percolator knob',
      'Glass sight tube between brass caps on the urn flank',
      'Brass spigot with a bakelite tap over an enamel drip bowl',
      'Cast-iron heating pad and four cast-iron feet',
    ],
    tags: ['percolator', 'enamel', 'urn', 'no-espresso', '1945'],
  },

  accessories: [
    {
      id: 'machines:1945:grinder',
      kind: 'grinder',
      label: 'Cast-iron wall grinder',
      model: 'No. 3 MILL',
      variant: 'wall-crank',
      material: 'base-iron',
      trim: 'trim-brass',
      secondary: 'wood-grinder',
      dimensions: { width: 0.24, depth: 0.2, height: 0.44 },
      mount: 'wall',
      wallX: 0.35,
      wallHeight: 1.52,
      grinderKind: 'manual-conical-burr',
      hopperDetail:
        'A flared tin hopper feeds conical steel burrs; the crank is turned by hand and the grounds drop into a tin drawer.',
      detail: [
        'Bolted to the wall beside the counter at chest height',
        'Wooden crank with a turned knob',
        'Tin grounds drawer that slides out below the burrs',
      ],
      tags: ['manual', 'burr', 'wall-mounted', '1945'],
    },
    {
      id: 'machines:1945:kettle',
      kind: 'kettle',
      label: 'Enamelled stovetop kettle',
      model: 'Whistling No. 4',
      variant: 'enamel-stovetop',
      material: 'enamel-ware',
      trim: 'trim-brass',
      secondary: 'handle-bakelite',
      dimensions: { width: 0.19, depth: 0.17, height: 0.2 },
      mount: 'counter-slot',
      counterSlot: 'tray-run',
      offset: { x: -0.3, z: 0 },
      capacityLitres: 2.2,
      detail: [
        'White enamel over steel with a cobalt rim',
        'Bakelite knob on a domed lid',
        'Chip on the spout lip from years on the range',
      ],
      tags: ['kettle', 'enamel', '1945'],
    },
    {
      id: 'machines:1945:filter-brewer',
      kind: 'filter-brewer',
      label: 'Sock-filter dripolator',
      model: 'Dripolator 12',
      variant: 'sock-filter-dripolator',
      material: 'enamel-ware',
      trim: 'trim-brass',
      secondary: 'filter-cloth',
      dimensions: { width: 0.24, depth: 0.2, height: 0.34 },
      mount: 'counter-slot',
      counterSlot: 'tray-run',
      offset: { x: 0.28, z: 0 },
      capacityLitres: 1.7,
      detail: [
        'Enamelled jug under a wire frame',
        'Cotton filter sock boiled and reused for years',
        'Brass pour spout and wire bail handle',
      ],
      tags: ['filter', 'dripolator', 'enamel', '1945'],
    },
    {
      id: 'machines:1945:milk-pitcher',
      kind: 'milk-pitcher',
      label: 'Enamelled milk jug',
      model: 'Half-pint jug',
      variant: 'enamel-jug',
      material: 'enamel-ware',
      trim: 'trim-brass',
      dimensions: { width: 0.12, depth: 0.12, height: 0.16 },
      mount: 'counter-slot',
      counterSlot: 'handoff',
      offset: { x: -0.44, z: 0 },
      capacityLitres: 0.6,
      detail: [
        'Same chipped enamel and cobalt rim as the kettle',
        'Bruised lip from a decade of service',
        'Stands beside the urn for splash milk',
      ],
      tags: ['milk', 'enamel', '1945'],
    },
  ],
};
