/**
 * 2025 music device: a phone on its charging stand paired to a fabric-wrapped
 * smart speaker, standing on a ledge under the storefront glazing.
 */

import type { MusicDeviceSpec } from '../devices';

export const MUSIC_SPEC_2025: MusicDeviceSpec = Object.freeze({
  year: '2025',
  deviceId: 'phone-speaker-2025',
  kind: 'smart-speaker',
  name: 'Phone paired to a smart speaker',
  maker: 'Halo',
  model: 'Dot Mini',
  nameplate: Object.freeze(['HALO', 'DOT MINI']),
  caption: Object.freeze(
    'A cream fabric-wrapped smart speaker with a lit LED ring, the paired phone standing on its charging stand beside a wireless pad.',
  ),
  palette: Object.freeze({
    body: '#e9e6e1',
    bodyDark: '#b9b4ad',
    trim: '#cfd3d8',
    accent: '#7bd6c4',
    cloth: '#cfc8bd',
    grille: '#a9a29a',
    dial: '#0b0d10',
    glow: '#7bd6c4',
    badgePlate: '#cfd3d8',
    badgeInk: '#2b2f33',
    cable: '#f2f3f4',
  }),
  cabinet: Object.freeze({
    material: 'plastic',
    joinery:
      'Seamless moulded puck with a knitted fabric wrap, a matte touch top recessed into the shell and a silicone anti-slip base bonded underneath.',
    finish:
      'Fabric wrap lightly pilled on the front where it is handled, its top cap dusted, the lens of the LED ring smeared.',
    width: 0.07,
    height: 0.09,
    depth: 0.07,
    plinthHeight: 0.008,
    cornerBlocks: 0,
    feet: 0,
  }),
  controls: Object.freeze({
    kind: 'touch',
    count: 4,
    labels: Object.freeze(['PLAY', 'NEXT', 'PREV', 'ASSIST']),
    wear: 'Touch legends faded from cleaning; the ring lens has a dull smear across the front.',
  }),
  dial: Object.freeze({
    kind: 'display',
    scale: Object.freeze(['NOW PLAYING', 'PAIRED', 'SIDE A']),
    glowColor: '#7bd6c4',
    glowIntensity: 1.3,
    needlePosition: 0.5,
  }),
  grille: Object.freeze({
    kind: 'fabric-wrap',
    columns: 22,
    rows: 14,
    weave: 'Knitted acoustic fabric wrap, the weave opening into a fine mesh over the forward-facing driver.',
    cloth: '#cfc8bd',
    coneCount: 1,
  }),
  speaker: Object.freeze({
    coneDiameter: 0.05,
    coneCount: 1,
    dust: 'One small cone behind the wrap, its dust cap clean but the surround dusted.',
  }),
  cable: Object.freeze({
    kind: 'usb-c',
    route: 'coiled',
    gauge: 3.2,
    plug: 'Braided USB-C charging cable from the phone stand to a socket behind the ledge.',
    coils: 2,
  }),
  glow: Object.freeze({
    color: '#7bd6c4',
    intensity: 1.5,
    pulse: 0.35,
    parts: Object.freeze(['ring', 'leds', 'screen'] as const),
  }),
  accessories: Object.freeze([
    Object.freeze({
      kind: 'phone-stand' as const,
      label: 'Phone on its charging stand',
      count: 1,
      side: 'right' as const,
      detail: 'A slim phone standing in an aluminium charging stand, its screen showing the paired session.',
    }),
    Object.freeze({
      kind: 'charging-pad' as const,
      label: 'Wireless charging pad',
      count: 1,
      side: 'left' as const,
      detail: 'A puck charging pad with a slim indicator ring glowing on the ledge.',
    }),
  ]),
  placement: Object.freeze({
    kind: 'storefront-ledge',
    zone: 'storefront-right',
    surfaceHeight: 1.0,
    supportLength: 0.7,
    description:
      'On the oak ledge under the right-hand storefront glazing, where the pair faces the room and the window light.',
  }),
  programId: 'stream-pop-2025',
  wear: Object.freeze([
    'Fabric wrap lightly pilled where it is picked up.',
    'Dust settled on the touch cap and along the ledge.',
    'Smear across the LED ring lens.',
    'Cable braid scuffed where it crosses the ledge edge.',
  ]),
  label: '2025 phone and smart speaker',
  tags: Object.freeze(['2025', 'smart-speaker', 'phone', 'paired', 'usb-c', 'storefront']),
  notes: Object.freeze([
    'The wireless era inverts the 1945 shelf: the loudspeaker is a small puck and the music library is the phone beside it.',
    'Playback is paired, not plugged: the cable exists only to charge.',
  ]),
});

export const MUSIC_SPECS_2025: Readonly<Record<'2025', MusicDeviceSpec>> = Object.freeze({
  '2025': MUSIC_SPEC_2025,
});
