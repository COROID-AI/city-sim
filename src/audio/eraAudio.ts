/**
 * Declarative per-era audio parameters.
 *
 * All sound is synthesised at runtime (no audio files), so an era's soundscape
 * is fully described by its ambience layer list, engine profile, music motif
 * and transition character. Keeping this data separate from the Web Audio
 * graph means the era audio signatures can be asserted headlessly.
 */

import { YEARS, type AudioSpec, type Year } from '../config/types';

export const ERA_AUDIO: Record<Year, AudioSpec> = {
  1945: {
    engineProfile: 'trolley',
    engineBaseHz: 180,
    streetcarBell: true,
    transition: 'whoosh-warm',
    music: { motif: 'jazz', tempo: 108, root: 55, gain: 0.16 },
    ambience: [
      { id: '1945-trolley-bell', kind: 'bell', label: 'Streetcar bell', gain: 0.22, filterHz: 2400, q: 0.8 },
      { id: '1945-crowd-murmur', kind: 'murmur', label: 'Sidewalk murmur', gain: 0.16, filterHz: 900 },
      { id: '1945-birds', kind: 'birds', label: 'Pigeons and sparrows', gain: 0.12, filterHz: 3200 },
      { id: '1945-coal-traffic', kind: 'noise', label: 'Coal-hauler traffic', gain: 0.2, filterHz: 420 },
      { id: '1945-distant-siren', kind: 'siren', label: 'Distant civil-defence siren', gain: 0.06, filterHz: 700, q: 3 },
    ],
  },
  1965: {
    engineProfile: 'v8',
    engineBaseHz: 96,
    streetcarBell: true,
    transition: 'whoosh-mod',
    music: { motif: 'surf', tempo: 132, root: 62, gain: 0.15 },
    ambience: [
      { id: '1965-traffic-drone', kind: 'noise', label: 'V8 traffic drone', gain: 0.24, filterHz: 520 },
      { id: '1965-crowd-murmur', kind: 'murmur', label: 'Shopper murmur', gain: 0.18, filterHz: 1100 },
      { id: '1965-birds', kind: 'birds', label: 'Birdsong', gain: 0.09, filterHz: 3000 },
      { id: '1965-neon-buzz', kind: 'buzz', label: 'Neon transformer buzz', gain: 0.07, filterHz: 6000, q: 6 },
      { id: '1965-transistor-radio', kind: 'tone', label: 'Transistor radio spilling onto the street', gain: 0.1, filterHz: 800 },
    ],
  },
  1985: {
    engineProfile: 'six-cylinder',
    engineBaseHz: 110,
    streetcarBell: false,
    transition: 'whoosh-analog',
    music: { motif: 'synth', tempo: 118, root: 60, gain: 0.17 },
    ambience: [
      { id: '1985-traffic-drone', kind: 'noise', label: 'Six-cylinder traffic', gain: 0.26, filterHz: 560 },
      { id: '1985-crowd-murmur', kind: 'murmur', label: 'Mall crowd', gain: 0.17, filterHz: 1200 },
      { id: '1985-arcade-buzz', kind: 'buzz', label: 'Arcade cabinet hum', gain: 0.12, filterHz: 5200, q: 5 },
      { id: '1985-neon-buzz', kind: 'buzz', label: 'Neon sign buzz', gain: 0.09, filterHz: 7000, q: 7 },
      { id: '1985-distant-siren', kind: 'siren', label: 'Down-town siren', gain: 0.08, filterHz: 760, q: 3 },
    ],
  },
  2005: {
    engineProfile: 'v6',
    engineBaseHz: 88,
    streetcarBell: false,
    transition: 'whoosh-digital',
    music: { motif: 'downtempo', tempo: 96, root: 57, gain: 0.14 },
    ambience: [
      { id: '2005-traffic-drone', kind: 'noise', label: 'SUV traffic', gain: 0.24, filterHz: 600 },
      { id: '2005-crowd-murmur', kind: 'murmur', label: 'Commuters on phones', gain: 0.16, filterHz: 1400 },
      { id: '2005-ac-hum', kind: 'hum', label: 'Rooftop condenser hum', gain: 0.11, filterHz: 240 },
      { id: '2005-phone-rings', kind: 'tone', label: 'Ring tones', gain: 0.05, filterHz: 1800 },
      { id: '2005-air-brake', kind: 'noise', label: 'Bus air brakes', gain: 0.07, filterHz: 300 },
    ],
  },
  2025: {
    engineProfile: 'electric',
    engineBaseHz: 420,
    streetcarBell: false,
    transition: 'whoosh-neon',
    music: { motif: 'lofi', tempo: 88, root: 53, gain: 0.15 },
    ambience: [
      { id: '2025-ev-hum', kind: 'hum', label: 'EV drivetrain hum', gain: 0.26, filterHz: 180 },
      { id: '2025-crowd-murmur', kind: 'murmur', label: 'Streetwear crowd', gain: 0.15, filterHz: 1600 },
      { id: '2025-birds', kind: 'birds', label: 'Rooftop birds', gain: 0.1, filterHz: 2800 },
      { id: '2025-led-buzz', kind: 'buzz', label: 'LED driver buzz', gain: 0.05, filterHz: 8000, q: 8 },
      { id: '2025-ebike-whir', kind: 'tone', label: 'Cargo-bike whir', gain: 0.09, filterHz: 400 },
    ],
  },
};

/** Signature string used by tests to prove era soundscapes differ. */
export function audioSignature(year: Year): string {
  const spec = ERA_AUDIO[year];
  return [
    spec.engineProfile,
    spec.music.motif,
    spec.transition,
    spec.ambience.map((layer) => layer.kind).join('+'),
    spec.ambience.map((layer) => layer.id).join('|'),
  ].join('::');
}

/** All era audio signatures, ordered by year. */
export function allAudioSignatures(): string[] {
  return YEARS.map((year) => audioSignature(year));
}
