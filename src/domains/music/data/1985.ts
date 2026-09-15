/**
 * 1985 music device: a boombox parked on the left end of the service counter,
 * with dual cassette decks, an equaliser and a spindle of tapes beside it.
 */

import type { MusicDeviceSpec } from '../devices';

export const MUSIC_SPEC_1985: MusicDeviceSpec = Object.freeze({
  year: '1985',
  deviceId: 'boombox-1985',
  kind: 'boombox',
  name: 'Counter boombox with tape stacks',
  maker: 'Kanto',
  model: 'RX-8 Stereo Radio Cassette',
  nameplate: Object.freeze(['KANTO', 'RX-8 STEREO']),
  caption: Object.freeze(
    'A black RX-8 boombox with chrome speaker rings, twin cassette decks, a five-band equaliser and a spindle of mix tapes on the counter.',
  ),
  palette: Object.freeze({
    body: '#2b2f33',
    bodyDark: '#15181b',
    trim: '#c9ced6',
    accent: '#e8452f',
    cloth: '#9aa2a8',
    grille: '#5c646b',
    dial: '#cfd6dc',
    glow: '#7cf0c0',
    badgePlate: '#c9ced6',
    badgeInk: '#14181b',
    cable: '#1d2023',
  }),
  cabinet: Object.freeze({
    material: 'plastic',
    joinery:
      'Injection-moulded ABS shell with a screwed rear pan, a folding carry handle on two zinc mounts and a chrome-plated trim band around the lid.',
    finish:
      'Matte textured plastic polished shiny at the corners, with paint chips along the handle mounts and the plinth.',
    width: 0.66,
    height: 0.34,
    depth: 0.3,
    plinthHeight: 0.012,
    cornerBlocks: 2,
    feet: 0,
  }),
  controls: Object.freeze({
    kind: 'slider',
    count: 5,
    labels: Object.freeze(['EQ 100', 'EQ 300', 'EQ 1K', 'EQ 3K', 'EQ 10K']),
    wear: 'Slider caps scuffed by fingernails, transport buttons polished in the middle from thumb use.',
  }),
  dial: Object.freeze({
    kind: 'dial-led',
    scale: Object.freeze(['FM 88', 'FM 92', 'FM 96', 'FM 100', 'FM 104', 'FM 108']),
    glowColor: '#7cf0c0',
    glowIntensity: 1.2,
    needlePosition: 0.55,
  }),
  grille: Object.freeze({
    kind: 'grille-cloth',
    columns: 24,
    rows: 10,
    weave: 'Grey acoustic cloth stretched over a slotted baffle, sagging slightly at the left driver.',
    cloth: '#9aa2a8',
    coneCount: 4,
  }),
  speaker: Object.freeze({
    coneDiameter: 0.09,
    coneCount: 4,
    dust: 'Four paper cones behind grey cloth, one pushing slightly proud of its surround.',
  }),
  cable: Object.freeze({
    kind: 'rubber',
    route: 'counter-edge',
    gauge: 5,
    plug: 'Moulded two-pin plug on a black flex, dropped over the counter face to the outlet behind.',
    coils: 1,
  }),
  glow: Object.freeze({
    color: '#7cf0c0',
    intensity: 1.3,
    pulse: 0.4,
    parts: Object.freeze(['dial', 'leds', 'meters'] as const),
  }),
  accessories: Object.freeze([
    Object.freeze({
      kind: 'tape-stack' as const,
      label: 'Tape stacks',
      count: 5,
      side: 'left' as const,
      detail: 'Five hand-labelled cassettes in their cases, stacked like books beside the boombox.',
    }),
  ]),
  placement: Object.freeze({
    kind: 'counter-top',
    zone: 'counter-left',
    surfaceHeight: 1.08,
    supportLength: 0.9,
    description:
      'Parked on the left end of the service counter, turned to face along the counter towards the tables.',
  }),
  programId: 'synth-drive-1985',
  wear: Object.freeze([
    'Paint chips on the handle mounts and the plinth corners.',
    'Finger polish on the volume wheel and the transport buttons.',
    'Dust caught in the grille cloth and along the tuning scale.',
    'Speaker cloth sagging where the left driver pushes it out.',
  ]),
  label: '1985 boombox',
  tags: Object.freeze(['1985', 'boombox', 'cassette', 'equaliser', 'counter', 'chrome']),
  notes: Object.freeze([
    'Portable radio cassettes of the mid 1980s were the café’s jukebox: high output, heavy saturation and a stack of tapes.',
    'The tuning scale, VU meters and deck reels all move while a side plays.',
  ]),
});

export const MUSIC_SPECS_1985: Readonly<Record<'1985', MusicDeviceSpec>> = Object.freeze({
  '1985': MUSIC_SPEC_1985,
});
