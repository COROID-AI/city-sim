/**
 * The five period music programmes and their per-era mixes.
 *
 * This module owns the *sound* of the café's music domain: for each of 1945,
 * 1965, 1985, 2005 and 2025 it declares
 *
 *  - a {@link MusicProgramInput} — instrumentation, tempo, key, era-flavoured
 *    melody and the device profile that shapes the tone (valve wireless, jukebox
 *    transport flutter, boombox saturation, dock hiss, phone speaker bandwidth),
 *  - an {@link EraMixInput} — the music bus level and tone plus the rest of the
 *    era mix the audio engine expects.
 *
 * The shapes are the frozen descriptors from `src/audio/program.ts`; the audio
 * engine validates them with `normalizeMusicProgram` / `normalizeEraMix` when the
 * module routes them, so a typo in an era table fails loudly instead of playing
 * the wrong thing.
 *
 * Musical character, era by era:
 *
 *  - **1945** — a small valve ensemble: warm string bed, clarinet lead, piano
 *    accompaniment and a plucked double bass, at a stately 78 bpm in F major,
 *    heard through a narrow, mid-heavy wireless speaker.
 *  - **1965** — orchestral pop: string stabs, sax lead and a walking bass under a
 *    live kit, 118 bpm in G major, played off shellac with transport wobble.
 *  - **1985** — synth and drum machine: square-wave arpeggio, wide pad, sub bass
 *    and a four-on-the-floor kit at 124 bpm in A minor, driven hard through
 *    boombox saturation.
 *  - **2005** — compressed pop: electric-piano chords, plucked guitar hook, bell
 *    counter-melody and a modern kit at 108 bpm in D mixolydian, with dock hiss.
 *  - **2025** — streaming-clean pop: soft pads, a light lead, pizzicato plucks
 *    and a sparse, syncopated beat at 100 bpm in C# dorian, with the narrow,
 *    slightly driven tone of a phone speaker.
 */

import { YEAR_IDS, yearToNumber, type YearId } from '../../contracts/period';
import type {
  DeviceKind,
  EraMixInput,
  InstrumentKind,
  MachineCharacterInput,
  MachineArchetype,
  MusicProgramInput,
  PatternStepInput,
} from '../../audio';

/* -------------------------------------------------------------------------- */
/* Pattern helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Compiles a space-separated grid into pattern steps.
 *
 * Each token is one grid step: a number is a scale degree, `-` (or `.`) is a
 * rest. Keeping the patterns as strings makes the era tables readable — you can
 * see the melody — while still producing the exact descriptor shape the engine
 * validates.
 */
function grid(
  pattern: string,
  options: { readonly durationSteps?: number; readonly velocity?: number; readonly tie?: boolean } = {},
): readonly PatternStepInput[] {
  const tokens = pattern.trim().split(/\s+/);
  const steps: PatternStepInput[] = [];
  tokens.forEach((token, step) => {
    if (token === '-' || token === '.') return;
    const note = Number.parseInt(token, 10);
    if (!Number.isFinite(note)) return;
    steps.push({
      step,
      note,
      durationSteps: options.durationSteps,
      velocity: options.velocity,
      tie: options.tie,
    });
  });
  return steps;
}

/** Repeating grid helper: `repeat('0 - - -', 4)` lays a bar down four times. */
function repeat(pattern: string, times: number): string {
  return Array.from({ length: Math.max(Math.trunc(times), 1) }, () => pattern.trim()).join(' ');
}

/** Quarter-note kick pattern, `hits` times per two bars of sixteenths. */
function fourOnTheFloor(stepsPerLoop: number, every: number, offset = 0): readonly PatternStepInput[] {
  const steps: PatternStepInput[] = [];
  for (let step = offset; step < stepsPerLoop; step += every) {
    steps.push({ step, note: 0, velocity: 0.85 });
  }
  return steps;
}

/* -------------------------------------------------------------------------- */
/* Machine characters                                                         */
/* -------------------------------------------------------------------------- */

function machineCharacter(year: YearId, archetype: MachineArchetype): MachineCharacterInput {
  const index = YEAR_IDS.indexOf(year);
  return {
    id: `music-machine-${year}`,
    year,
    label: `${year} machine character`,
    extraction: {
      archetype,
      noiseHz: 2200 + index * 420,
      noiseQ: 0.9 + index * 0.05,
      pumpHz: archetype === 'percolator' ? 4.6 : archetype === 'lever' ? 1.4 : 6.2,
      pumpDepth: archetype === 'percolator' ? 0.4 : 0.18,
      bubbleRate: archetype === 'percolator' ? 7.5 : 0,
      clickLevel: archetype === 'lever' ? 0.5 : 0.25,
      durationSeconds: archetype === 'percolator' ? 3.2 : 2.4 - index * 0.2,
      level: 0.5,
      brightness: 0.4 + index * 0.1,
      toneHz: 900 + index * 120,
    },
    steam: { burstSeconds: 1, hissHz: 4200 + index * 500, level: 0.5, pressureRise: 0.25, chatterHz: 3.2 },
    grinder: { burrHz: 260 + index * 55, durationSeconds: 1.2 - index * 0.08, level: 0.5, pitchJitter: 0.12 },
    clatter: { material: index <= 1 ? 'porcelain' : index === 2 ? 'ceramic' : 'heavy-china', pieces: 2 + index },
    milk: { knockHz: 200 + index * 12, level: 0.45 },
    till: { drawer: index <= 2, beep: index >= 3, contactless: index === 4 },
    tags: ['machine', year],
  };
}

/* -------------------------------------------------------------------------- */
/* Eras                                                                       */
/* -------------------------------------------------------------------------- */

/** Era programme id, tempo, key, device profile and arrangement of 1945. */
const PROGRAM_1945: MusicProgramInput = {
  id: 'valve-ensemble-1945',
  year: '1945',
  label: 'Valve ensemble',
  tempo: 78,
  key: { root: 'F', mode: 'major' },
  beatsPerBar: 4,
  bars: 2,
  stepsPerBeat: 2,
  swing: 0.05,
  gain: 0.95,
  seed: 19450,
  voices: [
    {
      id: 'strings',
      label: 'String ensemble',
      instrument: { kind: 'strings', octave: -1, gain: 0.24, attack: 0.22, release: 0.7, brightness: 2800 },
      pattern: grid('0 - 2 - 4 - 2 - 5 - 4 - 2 - 0 -', { durationSteps: 2, velocity: 0.5 }),
      gain: 0.9,
      humanize: 0.22,
    },
    {
      id: 'clarinet',
      label: 'Clarinet lead',
      instrument: { kind: 'reed', gain: 0.2, brightness: 2300, vibratoHz: 4.8, vibratoCents: 7 },
      pattern: grid('- 4 - 5 6 - 7 - 6 - 5 - 4 - 2 -', { velocity: 0.68 }),
      gain: 1,
      humanize: 0.28,
    },
    {
      id: 'piano',
      label: 'Piano accompaniment',
      instrument: { kind: 'pluck', octave: -1, gain: 0.26, decay: 0.7, brightness: 3600 },
      pattern: grid('0 2 4 2 0 2 4 2 5 4 2 4 0 2 4 2', { velocity: 0.38 }),
      gain: 0.85,
      humanize: 0.34,
    },
    {
      id: 'bass',
      label: 'Plucked double bass',
      instrument: { kind: 'bass', octave: -2, gain: 0.32, brightness: 900 },
      pattern: grid('0 - - - 5 - - - 3 - - - 4 - - -', { durationSteps: 4, velocity: 0.62 }),
      gain: 1,
      humanize: 0.18,
    },
  ],
  device: { kind: 'wireless', lowHz: 170, highHz: 3400, resonance: 1.6, drive: 0.18, hiss: 0.26, wobble: 0 },
  tags: ['1945', 'valve', 'small-ensemble', 'wireless'],
  notes: [
    'Small valve ensemble: strings, clarinet, piano and plucked bass at a stately 78 bpm.',
    'Narrow, mid-heavy wireless bandwidth with a audible noise floor.',
  ],
};

const PROGRAM_1965: MusicProgramInput = {
  id: 'orchestral-pop-1965',
  year: '1965',
  label: 'Orchestral pop on shellac',
  tempo: 118,
  key: { root: 'G', mode: 'major' },
  beatsPerBar: 4,
  bars: 2,
  stepsPerBeat: 4,
  swing: 0.16,
  gain: 1,
  seed: 19650,
  voices: [
    {
      id: 'strings',
      label: 'String section stabs',
      instrument: { kind: 'strings', octave: -1, gain: 0.22, attack: 0.12, release: 0.5, brightness: 3200 },
      pattern: grid('0 - - - 0 - - - 4 - - - 4 - - - 5 - - - 5 - - - 2 - - - 2 - - -', {
        durationSteps: 4,
        velocity: 0.52,
      }),
      gain: 0.95,
      humanize: 0.15,
    },
    {
      id: 'sax',
      label: 'Saxophone lead',
      instrument: { kind: 'reed', gain: 0.22, brightness: 2700, vibratoHz: 5.4, vibratoCents: 11 },
      pattern: grid('- 4 5 6 - 7 - 5 6 - 4 - 2 - 4 - 7 - - 9 7 - 6 - 5 4 - 2 - 4 - -', {
        velocity: 0.62,
      }),
      gain: 1,
      humanize: 0.3,
    },
    {
      id: 'guitar',
      label: 'Electric piano off-beats',
      instrument: { kind: 'electric-piano', gain: 0.24, decay: 0.9, brightness: 4200 },
      pattern: grid('- - 7 - - - 7 - - - 9 - - - 7 - - - 7 - - - 4 - - - 7 - - - 7 -', {
        velocity: 0.44,
      }),
      gain: 0.8,
      humanize: 0.2,
    },
    {
      id: 'bass',
      label: 'Walking bass',
      instrument: { kind: 'bass', octave: -2, gain: 0.32, brightness: 1100 },
      pattern: grid('0 - 2 - 4 - 5 - 7 - 5 - 4 - 2 - 0 - 2 - 4 - 5 - 4 - 2 - 0 - - -', {
        velocity: 0.6,
      }),
      gain: 1,
      humanize: 0.24,
    },
    {
      id: 'kit-kick',
      label: 'Kick drum',
      instrument: { kind: 'kick', gain: 0.48, octave: -3 },
      pattern: fourOnTheFloor(32, 8),
      gain: 0.9,
      humanize: 0.05,
    },
    {
      id: 'kit-snare',
      label: 'Snare backbeat',
      instrument: { kind: 'snare', gain: 0.3, octave: -2 },
      pattern: grid('- - - - 0 - - - - - - - 0 - - - - - - - 0 - - - - - - - 0 - - -', {
        velocity: 0.66,
      }),
      gain: 0.9,
      humanize: 0.08,
    },
    {
      id: 'kit-hat',
      label: 'Hi-hat eighths',
      instrument: { kind: 'hi-hat', gain: 0.18 },
      pattern: grid(repeat('0 - 0 -', 8), { velocity: 0.34 }),
      gain: 0.75,
      humanize: 0.12,
    },
  ],
  device: { kind: 'jukebox', lowHz: 90, highHz: 8200, resonance: 1.15, drive: 0.28, hiss: 0.14, wobble: 0.35 },
  tags: ['1965', 'orchestral-pop', 'shellac', 'jukebox'],
  notes: [
    'Orchestral pop at 118 bpm with a swinging sax lead and a walking bass.',
    'Vinyl grit and transport wobble from the jukebox mechanism.',
  ],
};

const PROGRAM_1985: MusicProgramInput = {
  id: 'synth-drive-1985',
  year: '1985',
  label: 'Synth and drum machine',
  tempo: 124,
  key: { root: 'A', mode: 'minor' },
  beatsPerBar: 4,
  bars: 2,
  stepsPerBeat: 4,
  swing: 0,
  gain: 1.05,
  seed: 19850,
  voices: [
    {
      id: 'lead',
      label: 'Square arpeggio',
      instrument: { kind: 'lead', gain: 0.2, brightness: 3800, resonance: 5, vibratoHz: 6.2, vibratoCents: 12 },
      pattern: grid('0 3 5 7 0 3 5 7 12 7 5 3 0 3 5 7 0 3 5 7 10 7 5 3 0 3 5 7 12 7 5 3', {
        velocity: 0.5,
      }),
      gain: 0.9,
      humanize: 0.05,
    },
    {
      id: 'pad',
      label: 'Wide pad',
      instrument: { kind: 'pad', octave: -1, gain: 0.2, attack: 0.8, detuneCents: 11, brightness: 2200 },
      pattern: grid('- - - - - - - - - - - - - - - - 5 - - - - - - - - - - - - - - -', {
        durationSteps: 16,
        velocity: 0.42,
      }),
      gain: 0.85,
      humanize: 0.1,
    },
    {
      id: 'bass',
      label: 'Sub bass pulses',
      instrument: { kind: 'sub', octave: -2, gain: 0.4, brightness: 620 },
      pattern: grid('0 - 0 - 0 - 0 - 5 - 5 - 5 - 5 - 3 - 3 - 3 - 3 - 4 - 4 - 4 - 4 -', {
        velocity: 0.78,
      }),
      gain: 1,
      humanize: 0.04,
    },
    {
      id: 'marimba',
      label: 'Marimba counter-line',
      instrument: { kind: 'marimba', octave: 1, gain: 0.28, decay: 0.5, brightness: 3200 },
      pattern: grid('- - 12 - - 10 - - - - 7 - - 5 - - - - 12 - - 14 - - - - 15 - - 12 - -', {
        velocity: 0.38,
      }),
      gain: 0.7,
      humanize: 0.14,
    },
    {
      id: 'kit-kick',
      label: 'Four-on-the-floor kick',
      instrument: { kind: 'kick', gain: 0.52, octave: -3 },
      pattern: fourOnTheFloor(32, 4),
      gain: 1,
      humanize: 0.03,
    },
    {
      id: 'kit-snare',
      label: 'Backbeat snare',
      instrument: { kind: 'snare', gain: 0.32, octave: -2 },
      pattern: grid('- - - - - - - - 0 - - - - - - - - - - - - - - - 0 - - - - - - -', {
        velocity: 0.72,
      }),
      gain: 0.95,
      humanize: 0.05,
    },
    {
      id: 'kit-hat',
      label: 'Offbeat hi-hat',
      instrument: { kind: 'hi-hat', gain: 0.2, brightness: 9500 },
      pattern: grid(repeat('- 0 - 0', 8), { velocity: 0.4 }),
      gain: 0.8,
      humanize: 0.08,
    },
  ],
  device: { kind: 'boombox', lowHz: 65, highHz: 11000, resonance: 1.35, drive: 0.42, hiss: 0.1, wobble: 0.07 },
  tags: ['1985', 'synth', 'drum-machine', 'boombox'],
  notes: [
    'Synth and drum machine at 124 bpm in A minor, four-on-the-floor.',
    'Boombox saturation lifts the square arpeggio above the room.',
  ],
};

const PROGRAM_2005: MusicProgramInput = {
  id: 'dock-pop-2005',
  year: '2005',
  label: 'Compressed dock pop',
  tempo: 108,
  key: { root: 'D', mode: 'mixolydian' },
  beatsPerBar: 4,
  bars: 2,
  stepsPerBeat: 4,
  swing: 0.05,
  gain: 1,
  seed: 20050,
  voices: [
    {
      id: 'keys',
      label: 'Electric piano chords',
      instrument: { kind: 'electric-piano', octave: -1, gain: 0.26, decay: 1.1, brightness: 4600 },
      pattern: grid('0 - - - 0 - - - 5 - - - 5 - - - 3 - - - 3 - - - 4 - - - 4 - - -', {
        durationSteps: 4,
        velocity: 0.5,
      }),
      gain: 0.9,
      humanize: 0.12,
    },
    {
      id: 'guitar',
      label: 'Plucked guitar hook',
      instrument: { kind: 'pluck', gain: 0.28, decay: 0.4, brightness: 4400 },
      pattern: grid('7 - 7 9 - 7 - 4 7 - 7 9 - 11 - 9 7 - 7 9 - 7 - 4 2 - 4 - 7 - - -', {
        velocity: 0.52,
      }),
      gain: 0.95,
      humanize: 0.18,
    },
    {
      id: 'bells',
      label: 'Bell counter-melody',
      instrument: { kind: 'bell', octave: 1, gain: 0.2, decay: 1.6, brightness: 8000 },
      pattern: grid('- - - - 12 - - - - - - - 14 - - - - - - - 12 - - - - - - - 10 - - -', {
        velocity: 0.32,
      }),
      gain: 0.6,
      humanize: 0.2,
    },
    {
      id: 'bass',
      label: 'Syncopated bass',
      instrument: { kind: 'bass', octave: -2, gain: 0.34, brightness: 1300 },
      pattern: grid('0 - 0 0 - - 4 - 0 - 0 0 - - 4 - 5 - 5 5 - - 2 - 4 - 4 4 - - 0 -', {
        velocity: 0.64,
      }),
      gain: 1,
      humanize: 0.1,
    },
    {
      id: 'kit-kick',
      label: 'Kick drum',
      instrument: { kind: 'kick', gain: 0.5, octave: -3 },
      pattern: grid('0 - - - - - 0 - 0 - - - - - 0 - 0 - - - - - 0 - 0 - - - - - 0 -', {
        velocity: 0.8,
      }),
      gain: 1,
      humanize: 0.04,
    },
    {
      id: 'kit-snare',
      label: 'Snare backbeat',
      instrument: { kind: 'snare', gain: 0.3, octave: -2 },
      pattern: grid('- - - - - - - - 0 - - - - - - - - - - - - - - - 0 - - - - - - -', {
        velocity: 0.68,
      }),
      gain: 0.9,
      humanize: 0.06,
    },
    {
      id: 'kit-hat',
      label: 'Hi-hat eighths',
      instrument: { kind: 'hi-hat', gain: 0.18 },
      pattern: grid(repeat('0 - 0 -', 8), { velocity: 0.32 }),
      gain: 0.75,
      humanize: 0.1,
    },
  ],
  device: { kind: 'ipod', lowHz: 55, highHz: 14500, resonance: 0.95, drive: 0.34, hiss: 0.17, wobble: 0.02 },
  tags: ['2005', 'compressed-pop', 'dock', 'ipod'],
  notes: [
    'Compressed pop at 108 bpm in D mixolydian with a bell counter-melody.',
    'Dock hiss and a slightly overdriven output stage.',
  ],
};

const PROGRAM_2025: MusicProgramInput = {
  id: 'stream-pop-2025',
  year: '2025',
  label: 'Streaming-clean pop',
  tempo: 100,
  key: { root: 'C#', mode: 'dorian' },
  beatsPerBar: 4,
  bars: 2,
  stepsPerBeat: 4,
  swing: 0.02,
  gain: 1,
  seed: 20250,
  voices: [
    {
      id: 'pad',
      label: 'Soft pad bed',
      instrument: { kind: 'pad', octave: -1, gain: 0.18, attack: 1.1, release: 1.6, detuneCents: 8 },
      pattern: grid('0 - - - - - - - - - - - - - - - 6 - - - - - - - - - - - - - - -', {
        durationSteps: 16,
        velocity: 0.4,
      }),
      gain: 0.85,
      humanize: 0.08,
    },
    {
      id: 'lead',
      label: 'Light lead',
      instrument: { kind: 'sine', gain: 0.3, attack: 0.03, release: 0.4, brightness: 5200 },
      pattern: grid('4 - 6 - - 7 - 4 - 6 - 9 - 7 - 6 4 - 6 - - 7 - 11 - 9 - 7 - 6 -', {
        velocity: 0.52,
      }),
      gain: 0.9,
      humanize: 0.16,
    },
    {
      id: 'pluck',
      label: 'Pizzicato plucks',
      instrument: { kind: 'pluck', gain: 0.24, decay: 0.3, brightness: 3800 },
      pattern: grid('- - 0 - - - 4 - - - 6 - - - 4 - - - 0 - - - 4 - - - 6 - - - 4 -', {
        velocity: 0.4,
      }),
      gain: 0.75,
      humanize: 0.2,
    },
    {
      id: 'bass',
      label: 'Sparse sub bass',
      instrument: { kind: 'sub', octave: -2, gain: 0.38, brightness: 700 },
      pattern: grid('0 - - - - - 0 - - - 4 - - - - - 3 - - - - - 3 - - - 6 - - 4 - -', {
        durationSteps: 3,
        velocity: 0.72,
      }),
      gain: 1,
      humanize: 0.06,
    },
    {
      id: 'kit-kick',
      label: 'Syncopated kick',
      instrument: { kind: 'kick', gain: 0.5, octave: -3 },
      pattern: grid('0 - - 0 - - 0 - - - 0 - - 0 - - 0 - - 0 - - 0 - - - 0 - - 0 - -', {
        velocity: 0.78,
      }),
      gain: 1,
      humanize: 0.03,
    },
    {
      id: 'kit-snare',
      label: 'Layered snare',
      instrument: { kind: 'snare', gain: 0.28, octave: -2 },
      pattern: grid('- - - - 0 - - - - - - - 0 - - - - - - - 0 - - - - - - - 0 - - -', {
        velocity: 0.66,
      }),
      gain: 0.9,
      humanize: 0.05,
    },
    {
      id: 'kit-sparkle',
      label: 'Sparkle hi-hat',
      instrument: { kind: 'hi-hat', gain: 0.16, brightness: 10500 },
      pattern: grid(repeat('0 - 0 0', 8), { velocity: 0.3 }),
      gain: 0.7,
      humanize: 0.12,
    },
  ],
  device: { kind: 'phone', lowHz: 180, highHz: 11500, resonance: 1.7, drive: 0.16, hiss: 0.05, wobble: 0 },
  tags: ['2025', 'streaming', 'phone-speaker', 'paired'],
  notes: [
    'Streaming-clean pop at 100 bpm in C# dorian, sparse and syncopated.',
    'Phone speaker: narrow bandwidth with a resonant upper bass.',
  ],
};

/* -------------------------------------------------------------------------- */
/* Mixes                                                                      */
/* -------------------------------------------------------------------------- */

const MIX_1945: EraMixInput = {
  id: 'music-mix-1945',
  year: '1945',
  label: '1945 valve mix',
  music: { level: 0.62, toneHz: 3600, send: 0.18, brightness: 0.86 },
  ambience: { level: 0.55, density: 0.35, toneHz: 3600, send: 0.15 },
  machine: { level: 0.5, character: machineCharacter('1945', 'percolator'), send: 0.2 },
  brightness: 0.42,
  reverb: { dryWet: 0.18, sizeSeconds: 0.8, decay: 2.4 },
  master: 0.88,
  tags: ['1945', 'valve', 'narrow-band'],
};

const MIX_1965: EraMixInput = {
  id: 'music-mix-1965',
  year: '1965',
  label: '1965 jukebox mix',
  music: { level: 0.8, toneHz: 7400, send: 0.3, brightness: 0.94 },
  ambience: { level: 0.62, density: 0.5, toneHz: 4800, send: 0.2 },
  machine: { level: 0.58, character: machineCharacter('1965', 'lever'), send: 0.28 },
  brightness: 0.62,
  reverb: { dryWet: 0.24, sizeSeconds: 1.0, decay: 3.0 },
  master: 0.9,
  tags: ['1965', 'jukebox', 'shellac'],
};

const MIX_1985: EraMixInput = {
  id: 'music-mix-1985',
  year: '1985',
  label: '1985 boombox mix',
  music: { level: 0.88, toneHz: 9800, send: 0.26, brightness: 1 },
  ambience: { level: 0.64, density: 0.55, toneHz: 5200, send: 0.22 },
  machine: { level: 0.62, character: machineCharacter('1985', 'semi-automatic'), send: 0.3 },
  brightness: 0.7,
  reverb: { dryWet: 0.28, sizeSeconds: 1.1, decay: 3.2 },
  master: 0.92,
  tags: ['1985', 'boombox', 'saturated'],
};

const MIX_2005: EraMixInput = {
  id: 'music-mix-2005',
  year: '2005',
  label: '2005 dock mix',
  music: { level: 0.74, toneHz: 8200, send: 0.32, brightness: 0.9 },
  ambience: { level: 0.6, density: 0.5, toneHz: 4600, send: 0.24 },
  machine: { level: 0.6, character: machineCharacter('2005', 'super-automatic'), send: 0.32 },
  brightness: 0.66,
  reverb: { dryWet: 0.3, sizeSeconds: 1.2, decay: 3.4 },
  master: 0.9,
  tags: ['2005', 'dock', 'compressed'],
};

const MIX_2025: EraMixInput = {
  id: 'music-mix-2025',
  year: '2025',
  label: '2025 paired mix',
  music: { level: 0.68, toneHz: 11200, send: 0.22, brightness: 0.96 },
  ambience: { level: 0.58, density: 0.45, toneHz: 4200, send: 0.2 },
  machine: { level: 0.55, character: machineCharacter('2025', 'multi-group'), send: 0.3 },
  brightness: 0.74,
  reverb: { dryWet: 0.22, sizeSeconds: 1.0, decay: 3.0 },
  master: 0.89,
  tags: ['2025', 'paired', 'clean'],
};

/* -------------------------------------------------------------------------- */
/* Public tables                                                              */
/* -------------------------------------------------------------------------- */

/** The five era programmes, keyed by the shared `YearId`. */
export const MUSIC_PROGRAMS: Readonly<Record<YearId, MusicProgramInput>> = Object.freeze({
  '1945': PROGRAM_1945,
  '1965': PROGRAM_1965,
  '1985': PROGRAM_1985,
  '2005': PROGRAM_2005,
  '2025': PROGRAM_2025,
});

/** The five era mixes (bus levels, tones and machine character), by `YearId`. */
export const ERA_MUSIC_MIXES: Readonly<Record<YearId, EraMixInput>> = Object.freeze({
  '1945': MIX_1945,
  '1965': MIX_1965,
  '1985': MIX_1985,
  '2005': MIX_2005,
  '2025': MIX_2025,
});

/** Programme of `year` (always defined for the five café eras). */
export function musicProgram(year: YearId): MusicProgramInput {
  return MUSIC_PROGRAMS[year];
}

/** Era mix of `year` (always defined for the five café eras). */
export function eraMusicMix(year: YearId): EraMixInput {
  return ERA_MUSIC_MIXES[year];
}

/** Playback device profile of `year`'s programme. */
export function musicDeviceKind(year: YearId): DeviceKind {
  return MUSIC_PROGRAMS[year].device?.kind ?? 'none';
}

/** Distinct instruments `program` calls for, in declaration order. */
export function musicInstrumentation(program: MusicProgramInput): readonly InstrumentKind[] {
  const kinds: InstrumentKind[] = [];
  for (const voice of program.voices) {
    const kind = typeof voice.instrument === 'string' ? voice.instrument : voice.instrument.kind;
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/** Grid length of `program` (steps per loop), applying the engine's defaults. */
export function musicProgramSteps(program: MusicProgramInput): number {
  const beatsPerBar = program.beatsPerBar ?? 4;
  const stepsPerBeat = program.stepsPerBeat ?? 2;
  const bars = program.bars ?? 4;
  return beatsPerBar * stepsPerBeat * bars;
}

/** Compact, comparable signature of a programme (used by the tests). */
export function musicProgramSignature(program: MusicProgramInput): string {
  const instruments = musicInstrumentation(program).join(',');
  return [
    program.id,
    program.tempo,
    `${program.key.root} ${program.key.mode}`,
    program.device?.kind ?? 'none',
    musicProgramSteps(program),
    program.voices.length,
    instruments,
  ].join('|');
}

/** Compact, comparable signature of an era mix. */
export function eraMixSignature(mix: EraMixInput): string {
  return [
    mix.id ?? 'unnamed',
    mix.music.level,
    mix.music.toneHz,
    mix.ambience.level,
    mix.ambience.density,
    mix.machine.level,
    mix.machine.character.extraction.archetype,
    mix.brightness,
    mix.master ?? 1,
  ].join('|');
}

/** Fields the tests compare across eras to prove the programmes differ. */
export const MUSIC_ERA_DISCRIMINATOR_FIELDS = [
  'programId',
  'tempo',
  'keyRoot',
  'keyMode',
  'deviceKind',
  'musicLevel',
  'musicToneHz',
  'machineArchetype',
] as const;

export type MusicEraDiscriminatorField = (typeof MUSIC_ERA_DISCRIMINATOR_FIELDS)[number];

/** Diagnostics view of one era's programme plus its mix. */
export interface MusicProgramDescription {
  readonly year: YearId;
  readonly programId: string;
  readonly label: string;
  readonly tempo: number;
  readonly keyRoot: string;
  readonly keyMode: string;
  readonly bars: number;
  readonly stepsPerLoop: number;
  readonly voiceCount: number;
  readonly instruments: readonly InstrumentKind[];
  readonly deviceKind: DeviceKind;
  readonly deviceBandwidth: readonly [number, number];
  readonly musicLevel: number;
  readonly musicToneHz: number;
  readonly machineArchetype: MachineArchetype;
  readonly musicSend: number;
  readonly brightness: number;
  readonly signature: string;
}

/** Everything a diagnostic panel (or a test) needs about one era's music. */
export function describeMusicProgram(year: YearId): MusicProgramDescription {
  const program = musicProgram(year);
  const mix = eraMusicMix(year);
  return {
    year,
    programId: program.id,
    label: program.label ?? program.id,
    tempo: program.tempo,
    keyRoot: program.key.root,
    keyMode: program.key.mode,
    bars: program.bars ?? 4,
    stepsPerLoop: musicProgramSteps(program),
    voiceCount: program.voices.length,
    instruments: musicInstrumentation(program),
    deviceKind: program.device?.kind ?? 'none',
    deviceBandwidth: [program.device?.lowHz ?? 60, program.device?.highHz ?? 16000],
    musicLevel: mix.music.level,
    musicToneHz: mix.music.toneHz,
    machineArchetype: mix.machine.character.extraction.archetype,
    musicSend: mix.music.send ?? 0.35,
    brightness: mix.brightness,
    signature: musicProgramSignature(program),
  };
}

/** Discriminator values of one era, keyed by {@link MUSIC_ERA_DISCRIMINATOR_FIELDS}. */
export function musicEraDiscriminators(year: YearId): Readonly<Record<MusicEraDiscriminatorField, string | number>> {
  const description = describeMusicProgram(year);
  return {
    programId: description.programId,
    tempo: description.tempo,
    keyRoot: description.keyRoot,
    keyMode: description.keyMode,
    deviceKind: description.deviceKind,
    musicLevel: description.musicLevel,
    musicToneHz: description.musicToneHz,
    machineArchetype: description.machineArchetype,
  };
}

/** The five eras this module supplies, in timeline order. */
export const MUSIC_PROGRAM_YEARS: readonly YearId[] = Object.freeze([...YEAR_IDS]);

/** Seed offset the programme of `year` uses (deterministic and era specific). */
export function musicProgramSeed(year: YearId): number {
  return yearToNumber(year) * 7919 + 17;
}
