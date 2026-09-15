/**
 * 1945 music device: a four-valve wooden wireless set on the storefront shelf,
 * with the household gramophone and its brass horn beside it.
 */

import type { MusicDeviceSpec } from '../devices';

export const MUSIC_SPEC_1945: MusicDeviceSpec = Object.freeze({
  year: '1945',
  deviceId: 'wireless-1945',
  kind: 'wireless-set',
  name: 'Four-valve wireless set and gramophone',
  maker: 'Vale & Foster',
  model: 'R4 Superhet',
  nameplate: Object.freeze(['VALE & FOSTER', 'MODEL R4 1945']),
  caption: Object.freeze(
    'A walnut-cased four-valve superhet with a cream glass dial, its cloth grille and a brass-horned gramophone beside it on the shelf.',
  ),
  palette: Object.freeze({
    body: '#6b4a2f',
    bodyDark: '#3d2817',
    trim: '#8a6a44',
    accent: '#c9a24a',
    cloth: '#d8c9a3',
    grille: '#a8895f',
    dial: '#efe3c4',
    glow: '#ffbb55',
    badgePlate: '#c9a24a',
    badgeInk: '#2b1d10',
    cable: '#4b3a2a',
  }),
  cabinet: Object.freeze({
    material: 'veneer',
    joinery:
      'Walnut-veneered ply carcass with mitred corner blocks, a moulded lid lip, a rebated back panel screwed through from behind and a solid plinth screwed to the base.',
    finish:
      'French-polished veneer bloomed matte around the dial from lamp heat, with a polished edge where hands turned the knobs.',
    width: 0.62,
    height: 0.78,
    depth: 0.34,
    plinthHeight: 0.05,
    cornerBlocks: 4,
    feet: 0,
  }),
  controls: Object.freeze({
    kind: 'knob',
    count: 3,
    labels: Object.freeze(['VOLUME', 'TONE', 'TUNING']),
    wear: 'Bakelite knobs flattened and polished on their upper edge, the tuning knob cracked at the skirt.',
  }),
  dial: Object.freeze({
    kind: 'dial-glass',
    scale: Object.freeze(['HOME', 'LIGHT', 'FORCES', 'WORLD', 'PARIS', 'BBC']),
    glowColor: '#ffbb55',
    glowIntensity: 1.1,
    needlePosition: 0.42,
  }),
  grille: Object.freeze({
    kind: 'grille-cloth',
    columns: 28,
    rows: 18,
    weave: 'Linen grille cloth in an open plain weave, sun-faded across the middle where the cloth faces the window.',
    cloth: '#d8c9a3',
    coneCount: 2,
  }),
  speaker: Object.freeze({
    coneDiameter: 0.16,
    coneCount: 2,
    dust: 'Twin paper cones with cloth surround and light dust in the cone throat.',
  }),
  cable: Object.freeze({
    kind: 'braid',
    route: 'wall-socket',
    gauge: 4.2,
    plug: 'Bakelite two-pin plug on a cloth-braided flex, run down the wall to the skirting socket.',
    coils: 0,
  }),
  glow: Object.freeze({
    color: '#ffbb55',
    intensity: 1.1,
    pulse: 0.18,
    parts: Object.freeze(['dial', 'lamps'] as const),
  }),
  accessories: Object.freeze([
    Object.freeze({
      kind: 'gramophone' as const,
      label: 'Household gramophone with brass horn',
      count: 1,
      side: 'right' as const,
      detail:
        'Oak-cased turntable with a felt platter, a bent chrome tone arm, a winding crank and a flared brass horn; the companion piece rather than a second source.',
    }),
    Object.freeze({
      kind: 'record-stack' as const,
      label: 'Stack of 78 rpm records',
      count: 3,
      side: 'right' as const,
      detail: 'Three shellac 78s leaning in their brown paper sleeves beside the horn base.',
    }),
  ]),
  placement: Object.freeze({
    kind: 'wall-shelf',
    zone: 'left-wall',
    surfaceHeight: 1.24,
    supportLength: 1.5,
    description:
      'On a bracketed timber shelf on the left wall beside the storefront, at shoulder height, where the set faces the tables.',
  }),
  programId: 'valve-ensemble-1945',
  wear: Object.freeze([
    'Ring of heat bloom in the veneer around the dial aperture.',
    'Finger polish on the plank lid and the knob skirts.',
    'Scuffed plinth edge and a chipped veneer corner at the front left.',
    'Dust film caught along the top and inside the grille weave.',
  ]),
  label: '1945 wireless set',
  tags: Object.freeze(['1945', 'valve', 'walnut', 'bakelite', 'gramophone', 'wall-shelf']),
  notes: Object.freeze([
    'Valve wireless sets of the mid 1940s were furniture: walnut veneer, a glass dial with named stations and a cloth grille.',
    'The gramophone is the same room’s second music machine; the wireless set is the source the audio engine plays.',
  ]),
});

export const MUSIC_SPECS_1945: Readonly<Record<'1945', MusicDeviceSpec>> = Object.freeze({
  '1945': MUSIC_SPEC_1945,
});
