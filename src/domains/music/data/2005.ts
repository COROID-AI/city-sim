/**
 * 2005 music device: an iPod standing in a speaker dock on the right end of the
 * counter, with the cable clutter of the MP3 era around it.
 */

import type { MusicDeviceSpec } from '../devices';

export const MUSIC_SPEC_2005: MusicDeviceSpec = Object.freeze({
  year: '2005',
  deviceId: 'ipod-dock-2005',
  kind: 'ipod-dock',
  name: 'iPod in a speaker dock with cable clutter',
  maker: 'Aurex',
  model: 'Dock 200 Stereo',
  nameplate: Object.freeze(['AUREX', 'DOCK 200']),
  caption: Object.freeze(
    'A white iPod leaning in its chrome-cradled dock between two speaker cubes, with coiled dock, USB and headphone cables on the counter.',
  ),
  palette: Object.freeze({
    body: '#f2f3f5',
    bodyDark: '#c6c9cd',
    trim: '#d7dade',
    accent: '#4a90e2',
    cloth: '#3d4145',
    grille: '#23262a',
    dial: '#101318',
    glow: '#79c0ff',
    badgePlate: '#d7dade',
    badgeInk: '#2a2d31',
    cable: '#e4e6e9',
  }),
  cabinet: Object.freeze({
    material: 'plastic',
    joinery:
      'Gloss white polycarbonate dock base on a rubber mat, with a brushed aluminium cradle lip, a 30-pin connector block and a screwed underside.',
    finish:
      'Gloss shell micro-scratched from a countertop life, the chrome cradle lip fingerprint dulled, dust settled in the cradle recess.',
    width: 0.24,
    height: 0.05,
    depth: 0.18,
    plinthHeight: 0.008,
    cornerBlocks: 0,
    feet: 0,
  }),
  controls: Object.freeze({
    kind: 'click-wheel',
    count: 1,
    labels: Object.freeze(['MENU', 'PLAY', 'NEXT', 'PREV']),
    wear: 'Click wheel polished smooth in the centre, its legends worn grey.',
  }),
  dial: Object.freeze({
    kind: 'display',
    scale: Object.freeze(['NOW PLAYING', 'SIDE A', 'TRACK 04']),
    glowColor: '#79c0ff',
    glowIntensity: 1.2,
    needlePosition: 0.5,
  }),
  grille: Object.freeze({
    kind: 'fabric-wrap',
    columns: 18,
    rows: 18,
    weave: 'Dark speaker wrap over a perforated baffle, with a fine dust bloom across the lower half.',
    cloth: '#3d4145',
    coneCount: 2,
  }),
  speaker: Object.freeze({
    coneDiameter: 0.06,
    coneCount: 2,
    dust: 'Two small drivers behind their wrap; the dust caps have a faint fingerprint.',
  }),
  cable: Object.freeze({
    kind: 'rubber',
    route: 'coiled',
    gauge: 4,
    plug: 'USB-A power brick with a captive 30-pin lead, coiled beside the dock.',
    coils: 3,
  }),
  glow: Object.freeze({
    color: '#79c0ff',
    intensity: 1.2,
    pulse: 0.25,
    parts: Object.freeze(['screen', 'leds'] as const),
  }),
  accessories: Object.freeze([
    Object.freeze({
      kind: 'cable-clutter' as const,
      label: 'Cable clutter',
      count: 3,
      side: 'front' as const,
      detail:
        'Three coiled leads — dock, USB charger and a spare headphone cable — tangled around a power brick on the counter.',
    }),
  ]),
  placement: Object.freeze({
    kind: 'counter-top',
    zone: 'counter-right',
    surfaceHeight: 1.08,
    supportLength: 0.8,
    description:
      'Standing on the right end of the service counter, facing back along the counter towards the tables.',
  }),
  programId: 'dock-pop-2005',
  wear: Object.freeze([
    'Micro-scratches across the gloss white shell.',
    'Fingerprint polish on the chrome cradle lip and click wheel.',
    'Dust settled in the cradle recess and on the dock mat.',
    'Cable jackets kinked where they coil under the counter lip.',
  ]),
  label: '2005 iPod dock',
  tags: Object.freeze(['2005', 'ipod', 'dock', 'click-wheel', 'cable-clutter', 'counter']),
  notes: Object.freeze([
    'By 2005 the music library had moved onto a hard drive: a dock, a click wheel and a screen replace the dial and the tape.',
    'The era’s signature look is clean white hardware buried in a nest of cables.',
  ]),
});

export const MUSIC_SPECS_2005: Readonly<Record<'2005', MusicDeviceSpec>> = Object.freeze({
  '2005': MUSIC_SPEC_2005,
});
