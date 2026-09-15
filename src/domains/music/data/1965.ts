/**
 * 1965 music device: a floor-standing jukebox against the right wall, with its
 * arched top, bubble tubes, record drum and number-and-letter selector keypad.
 */

import type { MusicDeviceSpec } from '../devices';

export const MUSIC_SPEC_1965: MusicDeviceSpec = Object.freeze({
  year: '1965',
  deviceId: 'jukebox-1965',
  kind: 'jukebox',
  name: 'Wall jukebox with selector',
  maker: 'Amerijuke',
  model: 'J-700 Constellation',
  nameplate: Object.freeze(['AMERIJUKE', 'MODEL J-700']),
  caption: Object.freeze(
    'A chrome-trimmed jukebox standing against the wall: arched top, lit bubble tubes, a glassed record drum and a twelve-button selector pad.',
  ),
  palette: Object.freeze({
    body: '#7a2f26',
    bodyDark: '#3a170f',
    trim: '#d8dde3',
    accent: '#e0b040',
    cloth: '#d9cfae',
    grille: '#8a7a58',
    dial: '#f2e3bd',
    glow: '#ffd27a',
    badgePlate: '#d8dde3',
    badgeInk: '#20191a',
    cable: '#2a2a2e',
  }),
  cabinet: Object.freeze({
    material: 'veneer',
    joinery:
      'Cherry-veneered ply carcase with a steam-bent arch top, mitred chrome mouldings, a bolted base frame and four levelling feet through the plinth.',
    finish:
      'Lacquered veneer with scuffed chrome mouldings and a bloomed lacquer patch beside the bubble tubes where the lamp heat sits.',
    width: 0.78,
    height: 1.62,
    depth: 0.62,
    plinthHeight: 0.1,
    cornerBlocks: 0,
    feet: 4,
  }),
  controls: Object.freeze({
    kind: 'keypad',
    count: 12,
    labels: Object.freeze(['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4']),
    wear: 'Chrome button rims polished bright where thumbs press, the A-row legends half worn away.',
  }),
  dial: Object.freeze({
    kind: 'dial-led',
    scale: Object.freeze(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']),
    glowColor: '#ffd27a',
    glowIntensity: 1.3,
    needlePosition: 0.5,
  }),
  grille: Object.freeze({
    kind: 'perforated',
    columns: 30,
    rows: 12,
    weave: 'Perforated steel backing behind a coarse cream cloth, with three chrome-ringed drivers proud of the panel.',
    cloth: '#d9cfae',
    coneCount: 3,
  }),
  speaker: Object.freeze({
    coneDiameter: 0.19,
    coneCount: 3,
    dust: 'Three paper cones with bright chrome rings; the centre cone has a dented dust cap.',
  }),
  cable: Object.freeze({
    kind: 'rubber',
    route: 'floor-run',
    gauge: 5.5,
    plug: 'Moulded rubber plug on a heavy flex, clipped along the skirting to the wall outlet.',
    coils: 0,
  }),
  glow: Object.freeze({
    color: '#ffd27a',
    intensity: 1.4,
    pulse: 0.3,
    parts: Object.freeze(['tubes', 'lamps', 'dial', 'leds'] as const),
  }),
  accessories: Object.freeze([
    Object.freeze({
      kind: 'record-stack' as const,
      label: 'Rack of 45 rpm singles',
      count: 4,
      side: 'right' as const,
      detail: 'Four seven-inch singles leaning in their picture sleeves against the jukebox base.',
    }),
  ]),
  placement: Object.freeze({
    kind: 'wall-floor',
    zone: 'right-wall',
    surfaceHeight: 0,
    supportLength: 0.9,
    alongOffset: 0.1,
    description:
      'Standing on the floor against the right wall between the counter and the middle tables, facing across the room.',
  }),
  programId: 'orchestral-pop-1965',
  wear: Object.freeze([
    'Chrome mouldings dulled and scratched at hip height.',
    'Coin entry brightened to bare metal by thousands of coins.',
    'Scuffed plinth and a worn carpet shadow under the feet.',
    'Dust film on the arch and grime in the perforated grille.',
  ]),
  label: '1965 jukebox',
  tags: Object.freeze(['1965', 'jukebox', 'chrome', 'bubble-tube', 'shellac', 'selector']),
  notes: Object.freeze([
    'Mid-century jukeboxes were lit furniture: an arch top, bubble tubes and a glassed drum of records on show.',
    'The selector keypad and coin slot are the era’s interaction model; the drum turns while a side plays.',
  ]),
});

export const MUSIC_SPECS_1965: Readonly<Record<'1965', MusicDeviceSpec>> = Object.freeze({
  '1965': MUSIC_SPEC_1965,
});
