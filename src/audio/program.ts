/**
 * Era audio descriptors — the data contract between the audio engine and the
 * modules that supply per-era sound data.
 *
 * Nothing in this module makes sound. It owns the *shape* of the four
 * descriptors the café audio engine consumes, each keyed by the shared
 * {@link YearId} from `src/contracts/period.ts`:
 *
 *  - {@link MusicProgramDescriptor} — tempo, key, instrument voices and the
 *    arrangement pattern the music bus schedules as a seamless loop,
 *  - {@link AmbienceSpecDescriptor} — the conversation murmur bed recipe,
 *  - {@link MachineCharacterDescriptor} — the character of the coffee machine's
 *    parameterised one-shots (espresso extraction, steam purge, grinder burrs,
 *    cup clatter, milk knock, till),
 *  - {@link EraMixDescriptor} — bus levels, tone, brightness and reverb depth.
 *
 * The five era specific programs and mix values belong to the
 * `domain-music-sources` task, which supplies them through exactly these shapes;
 * `period-registry` and `app-composition` then assemble and inject them. This
 * task owns the generic shapes, the defaulting rules and the runtime validation
 * that rejects a missing or malformed descriptor.
 *
 * Every `*Input` type is the author facing shape (optional fields fall back to
 * the documented defaults); every `*Descriptor` type is the fully resolved shape
 * the synthesis code consumes. `normalize*(input)` performs the conversion and
 * throws an {@link AudioDescriptorError} listing every problem it found.
 */

import { isYearId, yearToNumber, type DomainSpecBase, type YearId } from '../contracts/period';
import { clamp, type OscillatorTypeLike } from './types';

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** Thrown when a descriptor is missing required data or carries bad values. */
export class AudioDescriptorError extends Error {
  /** Name of the descriptor that failed validation (for diagnostics). */
  readonly descriptor: string;
  /** One message per problem found, in the order the validator met them. */
  readonly issues: readonly string[];

  constructor(descriptor: string, issues: readonly string[]) {
    super(`${descriptor} is malformed: ${issues.join('; ')}`);
    this.name = 'AudioDescriptorError';
    this.descriptor = descriptor;
    this.issues = [...issues];
  }
}

/* -------------------------------------------------------------------------- */
/* Validation primitives                                                      */
/* -------------------------------------------------------------------------- */

type IssueList = string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Optional finite number within `[min, max]`, falling back to `fallback`. */
function readNumber(
  issues: IssueList,
  path: string,
  value: unknown,
  fallback: number,
  min = -Infinity,
  max = Infinity,
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`${path} must be a finite number`);
    return fallback;
  }
  if (value < min || value > max) {
    issues.push(`${path} must be within ${min}..${max} (received ${value})`);
    return clamp(value, min, max);
  }
  return value;
}

/** Required finite number within `[min, max]`. */
function requireNumber(
  issues: IssueList,
  path: string,
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || value === null) {
    issues.push(`${path} is required`);
    return fallback;
  }
  return readNumber(issues, path, value, fallback, min, max);
}

/** Required non empty string. */
function requireString(issues: IssueList, path: string, value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(`${path} is required and must be a non empty string`);
    return fallback;
  }
  return value.trim();
}

/** Optional string with a default. */
function readString(issues: IssueList, path: string, value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') {
    issues.push(`${path} must be a string`);
    return fallback;
  }
  return value;
}

/** Optional boolean with a default. */
function readBoolean(issues: IssueList, path: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') {
    issues.push(`${path} must be a boolean`);
    return fallback;
  }
  return value;
}

/** Optional value from a closed set of strings. */
function readEnum<T extends string>(
  issues: IssueList,
  path: string,
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    issues.push(`${path} must be one of ${allowed.join(', ')} (received ${JSON.stringify(value)})`);
    return fallback;
  }
  return value as T;
}

/** Optional string array, filtered to strings. */
function readStringList(issues: IssueList, path: string, value: unknown): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array of strings`);
    return [];
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') out.push(entry);
    else issues.push(`${path} must only contain strings`);
  }
  return out;
}

/** Resolves the era a descriptor claims, rejecting anything outside `YearId`. */
function readYear(issues: IssueList, path: string, value: unknown, fallback: YearId): YearId {
  if (value === undefined || value === null) {
    issues.push(`${path} is required`);
    return fallback;
  }
  if (!isYearId(value)) {
    issues.push(`${path} must be one of 1945, 1965, 1985, 2005, 2025 (received ${JSON.stringify(value)})`);
    return fallback;
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Musical key vocabulary                                                     */
/* -------------------------------------------------------------------------- */

/** Scale shapes available to an era music program. */
export type ScaleMode =
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'pentatonic-major'
  | 'pentatonic-minor'
  | 'blues'
  | 'chromatic';

export const SCALE_MODES = [
  'major',
  'minor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'pentatonic-major',
  'pentatonic-minor',
  'blues',
  'chromatic',
] as const satisfies readonly ScaleMode[];

/** Semitone offsets of every supported scale, measured from the tonic. */
export const SCALE_INTERVALS: Readonly<Record<ScaleMode, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'pentatonic-major': [0, 2, 4, 7, 9],
  'pentatonic-minor': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/** Pitch class of every note name a key or pattern may use. */
const PITCH_CLASSES: Readonly<Record<string, number>> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  'E#': 5,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

/** MIDI note number of middle C. */
export const MIDDLE_C_MIDI = 60;

/**
 * Parses scientific pitch notation (`'C4'`, `'A#3'`, `'db2'`) into a MIDI note
 * number. Returns `null` for anything it cannot read.
 */
export function noteToMidi(note: string): number | null {
  const match = /^([A-Ga-g])([#b]?)(-?\d{1,2})$/.exec(note.trim());
  if (!match) return null;
  const letter = match[1];
  const accidental = match[2];
  const octave = match[3];
  if (letter === undefined || accidental === undefined || octave === undefined) return null;
  const pitchClass = PITCH_CLASSES[`${letter.toUpperCase()}${accidental}`];
  if (pitchClass === undefined) return null;
  const octaveNumber = Number.parseInt(octave, 10);
  if (!Number.isFinite(octaveNumber)) return null;
  return pitchClass + (octaveNumber + 1) * 12;
}

/** Concert pitch frequency of a MIDI note number. */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Pitch class of a note name without an octave, or `null`. */
function pitchClassOf(note: string): number | null {
  const direct = PITCH_CLASSES[note];
  if (direct !== undefined) return direct;
  const letter = note.slice(0, 1).toUpperCase();
  const accidental = note.slice(1);
  const candidate = PITCH_CLASSES[`${letter}${accidental}`];
  return candidate ?? null;
}

/** A program's tonic and scale; patterns address notes as scale degrees. */
export interface MusicalKey {
  /** Tonic note name, for example `'Bb'` or `'F#'`. */
  readonly root: string;
  readonly mode: ScaleMode;
}

/**
 * Resolves a scale degree (which may be negative, or higher than the scale
 * length, wrapping into further octaves) into a MIDI note number. Degree `0` is
 * the tonic in octave 4.
 */
export function scaleDegreeToMidi(degree: number, key: MusicalKey, octave = 0): number {
  const intervals = SCALE_INTERVALS[key.mode];
  const length = intervals.length;
  const steps = Math.round(degree);
  const index = ((steps % length) + length) % length;
  const octaveShift = Math.floor(steps / length);
  const interval = intervals[index] ?? 0;
  const tonic = pitchClassOf(key.root) ?? 0;
  return (octave + octaveShift + 4 + 1) * 12 + tonic + interval;
}

/**
 * Resolves a pattern note — a pitch name (`'C4'`) or a scale degree (`3`) — to a
 * MIDI note number. `note` is `undefined` for a rest.
 */
export function resolvePitch(
  note: number | string | undefined | null,
  key: MusicalKey,
  octave = 0,
): number | null {
  if (note === undefined || note === null) return null;
  if (typeof note === 'string') {
    const midi = noteToMidi(note);
    return midi === null ? null : midi + octave * 12;
  }
  if (!Number.isFinite(note)) return null;
  return scaleDegreeToMidi(note, key, octave);
}

/* -------------------------------------------------------------------------- */
/* Instruments                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The procedural instrument primitives the music scheduler can synthesise. Each
 * one is a recipe built from oscillators, filters, envelopes and noise, so an
 * era program stays pure data while still being able to sound like a plucked
 * string, a reed, a bell, a pad or a drum kit.
 */
export const INSTRUMENT_KINDS = [
  'sine',
  'triangle',
  'square',
  'sawtooth',
  'pluck',
  'harp',
  'marimba',
  'bell',
  'electric-piano',
  'reed',
  'organ',
  'strings',
  'pad',
  'lead',
  'bass',
  'sub',
  'percussion',
  'kick',
  'snare',
  'hi-hat',
] as const;

export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

/** Wave shapes a program may request for a voice. */
export const INSTRUMENT_WAVEFORMS = ['sine', 'square', 'sawtooth', 'triangle'] as const;

export type InstrumentWaveform = (typeof INSTRUMENT_WAVEFORMS)[number];

/**
 * Fully defaulted instrument settings. Values are deliberately in physical
 * units (seconds, hertz, cents) so era data reads like a synth patch.
 */
export interface InstrumentSpec {
  readonly kind: InstrumentKind;
  /** Peak level of one note at velocity 1. */
  readonly gain: number;
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
  /** Filter cutoff in hertz used to shape the voice's brightness. */
  readonly brightness: number;
  /** Filter resonance (Q). */
  readonly resonance: number;
  readonly detuneCents: number;
  /** Octave transposition applied on top of the pattern's own octave. */
  readonly octave: number;
  readonly vibratoHz: number;
  readonly vibratoCents: number;
  readonly pan: number;
  readonly waveform: InstrumentWaveform;
}

/** Author facing instrument: only `kind` is required. */
export interface InstrumentSpecInput {
  readonly kind: InstrumentKind;
  readonly gain?: number;
  readonly attack?: number;
  readonly decay?: number;
  readonly sustain?: number;
  readonly release?: number;
  readonly brightness?: number;
  readonly resonance?: number;
  readonly detuneCents?: number;
  readonly octave?: number;
  readonly vibratoHz?: number;
  readonly vibratoCents?: number;
  readonly pan?: number;
  readonly waveform?: InstrumentWaveform;
}

type InstrumentDefaults = Omit<InstrumentSpec, 'kind'>;

/** Per primitive default patch, used whenever the era data omits a field. */
export const INSTRUMENT_PROFILES: Readonly<Record<InstrumentKind, InstrumentDefaults>> = {
  sine: { gain: 0.32, attack: 0.01, decay: 0.08, sustain: 0.75, release: 0.25, brightness: 6000, resonance: 0.7, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'sine' },
  triangle: { gain: 0.3, attack: 0.008, decay: 0.1, sustain: 0.7, release: 0.3, brightness: 7000, resonance: 0.7, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'triangle' },
  square: { gain: 0.2, attack: 0.005, decay: 0.06, sustain: 0.8, release: 0.12, brightness: 4200, resonance: 0.8, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'square' },
  sawtooth: { gain: 0.2, attack: 0.005, decay: 0.08, sustain: 0.7, release: 0.18, brightness: 5200, resonance: 0.8, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'sawtooth' },
  pluck: { gain: 0.34, attack: 0.002, decay: 0.5, sustain: 0.12, release: 0.35, brightness: 4200, resonance: 1.1, detuneCents: 4, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'triangle' },
  harp: { gain: 0.3, attack: 0.003, decay: 0.9, sustain: 0.18, release: 0.5, brightness: 5200, resonance: 0.9, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'triangle' },
  marimba: { gain: 0.32, attack: 0.002, decay: 0.45, sustain: 0.06, release: 0.25, brightness: 3200, resonance: 0.8, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'sine' },
  bell: { gain: 0.26, attack: 0.004, decay: 2.2, sustain: 0.04, release: 1.6, brightness: 9000, resonance: 0.7, detuneCents: 3, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'sine' },
  'electric-piano': { gain: 0.3, attack: 0.004, decay: 1.2, sustain: 0.22, release: 0.7, brightness: 5200, resonance: 1, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'sine' },
  reed: { gain: 0.22, attack: 0.04, decay: 0.2, sustain: 0.8, release: 0.18, brightness: 2600, resonance: 3.2, detuneCents: 0, octave: 0, vibratoHz: 5.2, vibratoCents: 9, pan: 0, waveform: 'sawtooth' },
  organ: { gain: 0.24, attack: 0.02, decay: 0.1, sustain: 0.92, release: 0.2, brightness: 4200, resonance: 0.6, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'sine' },
  strings: { gain: 0.2, attack: 0.18, decay: 0.3, sustain: 0.85, release: 0.5, brightness: 3400, resonance: 0.9, detuneCents: 6, octave: 0, vibratoHz: 4.6, vibratoCents: 6, pan: 0, waveform: 'sawtooth' },
  pad: { gain: 0.2, attack: 0.6, decay: 1, sustain: 0.8, release: 1.4, brightness: 2400, resonance: 0.8, detuneCents: 9, octave: 0, vibratoHz: 0.6, vibratoCents: 5, pan: 0, waveform: 'sawtooth' },
  lead: { gain: 0.22, attack: 0.01, decay: 0.18, sustain: 0.7, release: 0.2, brightness: 3600, resonance: 4, detuneCents: 3, octave: 0, vibratoHz: 5.5, vibratoCents: 11, pan: 0, waveform: 'square' },
  bass: { gain: 0.34, attack: 0.006, decay: 0.2, sustain: 0.7, release: 0.18, brightness: 1200, resonance: 1.2, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'triangle' },
  sub: { gain: 0.38, attack: 0.01, decay: 0.3, sustain: 0.85, release: 0.3, brightness: 700, resonance: 0.7, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'sine' },
  percussion: { gain: 0.28, attack: 0.001, decay: 0.16, sustain: 0.02, release: 0.12, brightness: 3000, resonance: 1.4, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'sine' },
  kick: { gain: 0.5, attack: 0.001, decay: 0.32, sustain: 0.02, release: 0.22, brightness: 260, resonance: 1, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'sine' },
  snare: { gain: 0.32, attack: 0.001, decay: 0.22, sustain: 0.03, release: 0.16, brightness: 3600, resonance: 1.1, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'triangle' },
  'hi-hat': { gain: 0.2, attack: 0.001, decay: 0.09, sustain: 0.01, release: 0.07, brightness: 9000, resonance: 0.7, detuneCents: 0, octave: 0, vibratoHz: 0, vibratoCents: 0, pan: 0, waveform: 'square' },
};

function isInstrumentKind(value: unknown): value is InstrumentKind {
  return (
    typeof value === 'string' && (INSTRUMENT_KINDS as readonly string[]).includes(value)
  );
}

function defaultInstrument(kind: InstrumentKind): InstrumentSpec {
  return { kind, ...INSTRUMENT_PROFILES[kind] };
}

function normalizeInstrument(
  issues: IssueList,
  path: string,
  value: unknown,
): InstrumentSpec {
  if (typeof value === 'string') {
    if (!isInstrumentKind(value)) {
      issues.push(`${path} must be one of ${INSTRUMENT_KINDS.join(', ')} (received ${value})`);
      return defaultInstrument('sine');
    }
    return defaultInstrument(value);
  }
  if (!isRecord(value)) {
    issues.push(`${path} must be an instrument kind or an instrument object`);
    return defaultInstrument('sine');
  }
  const kind = readEnum(issues, `${path}.kind`, value['kind'], INSTRUMENT_KINDS, 'sine');
  const defaults = INSTRUMENT_PROFILES[kind];
  return {
    kind,
    gain: readNumber(issues, `${path}.gain`, value['gain'], defaults.gain, 0, 4),
    attack: readNumber(issues, `${path}.attack`, value['attack'], defaults.attack, 0, 30),
    decay: readNumber(issues, `${path}.decay`, value['decay'], defaults.decay, 0, 30),
    sustain: readNumber(issues, `${path}.sustain`, value['sustain'], defaults.sustain, 0, 1),
    release: readNumber(issues, `${path}.release`, value['release'], defaults.release, 0, 30),
    brightness: readNumber(issues, `${path}.brightness`, value['brightness'], defaults.brightness, 40, 20000),
    resonance: readNumber(issues, `${path}.resonance`, value['resonance'], defaults.resonance, 0.1, 30),
    detuneCents: readNumber(issues, `${path}.detuneCents`, value['detuneCents'], defaults.detuneCents, -100, 100),
    octave: readNumber(issues, `${path}.octave`, value['octave'], defaults.octave, -4, 4),
    vibratoHz: readNumber(issues, `${path}.vibratoHz`, value['vibratoHz'], defaults.vibratoHz, 0, 20),
    vibratoCents: readNumber(issues, `${path}.vibratoCents`, value['vibratoCents'], defaults.vibratoCents, 0, 100),
    pan: readNumber(issues, `${path}.pan`, value['pan'], defaults.pan, -1, 1),
    waveform: readEnum(issues, `${path}.waveform`, value['waveform'], INSTRUMENT_WAVEFORMS, defaults.waveform),
  };
}

function normalizeKey(issues: IssueList, path: string, value: unknown): MusicalKey {
  if (!isRecord(value)) {
    issues.push(`${path} is required and must be { root, mode }`);
    return { root: 'C', mode: 'major' };
  }
  const root = requireString(issues, `${path}.root`, value['root'], 'C');
  if (pitchClassOf(root) === null) {
    issues.push(`${path}.root must be a note name such as C, Bb or F# (received ${JSON.stringify(root)})`);
  }
  const mode = readEnum(issues, `${path}.mode`, value['mode'], SCALE_MODES, 'major');
  return { root, mode };
}

/* -------------------------------------------------------------------------- */
/* Music programs                                                             */
/* -------------------------------------------------------------------------- */

/** Playback device an era's music comes out of (its tone shaping). */
export type DeviceKind = 'none' | 'wireless' | 'jukebox' | 'boombox' | 'ipod' | 'phone';

export const DEVICE_KINDS = ['none', 'wireless', 'jukebox', 'boombox', 'ipod', 'phone'] as const;

/**
 * Fully defaulted device profile. `lowHz`/`highHz` model the device's bandwidth
 * (a 1945 wireless set is narrow and mid-heavy, a 2025 phone is close to full
 * range), `drive` its saturation, `hiss` its noise floor and `wobble` the
 * mechanical flutter of a jukebox transport.
 */
export interface DeviceProfile {
  readonly kind: DeviceKind;
  readonly lowHz: number;
  readonly highHz: number;
  readonly resonance: number;
  readonly drive: number;
  readonly hiss: number;
  readonly wobble: number;
}

export interface DeviceProfileInput {
  readonly kind?: DeviceKind;
  readonly lowHz?: number;
  readonly highHz?: number;
  readonly resonance?: number;
  readonly drive?: number;
  readonly hiss?: number;
  readonly wobble?: number;
}

export const DEVICE_PROFILE_DEFAULTS: DeviceProfile = {
  kind: 'none',
  lowHz: 60,
  highHz: 16000,
  resonance: 0.7,
  drive: 0,
  hiss: 0,
  wobble: 0,
};

/** One note (or rest) on a voice's arrangement grid. */
export interface PatternStep {
  /** Grid step within the loop, `0 .. stepsPerLoop - 1`. */
  readonly step: number;
  /** Scale degree (may be negative) or a pitch name such as `'C4'`; omit for a rest. */
  readonly note?: number | string;
  /** Note length in grid steps. Defaults to `1`. */
  readonly durationSteps: number;
  /** Note level, `0..1`. Defaults to `0.85`. */
  readonly velocity: number;
  /** When true the note is held until the voice's next note. */
  readonly tie: boolean;
}

export interface PatternStepInput {
  readonly step: number;
  readonly note?: number | string;
  readonly durationSteps?: number;
  readonly velocity?: number;
  readonly tie?: boolean;
}

/** A single instrument line of a program. */
export interface ProgramVoice {
  readonly id: string;
  readonly label?: string;
  readonly instrument: InstrumentSpec;
  /** Arrangement, ordered by step. */
  readonly pattern: readonly PatternStep[];
  /** Silences the voice without removing it from the program. */
  readonly mute: boolean;
  /** Voice level relative to the program output, `0..4`. */
  readonly gain: number;
  /** Octave transposition applied to every note of the voice. */
  readonly octave: number;
  /** `0..1` amount of seeded timing and velocity variation, repeated each loop. */
  readonly humanize: number;
}

export interface ProgramVoiceInput {
  readonly id: string;
  readonly label?: string;
  readonly instrument: InstrumentSpecInput | InstrumentKind;
  readonly pattern: readonly PatternStepInput[];
  readonly mute?: boolean;
  readonly gain?: number;
  readonly octave?: number;
  readonly humanize?: number;
}

/** Author facing era music program. */
export interface MusicProgramInput extends DomainSpecBase {
  readonly id: string;
  readonly label?: string;
  /** Tempo in beats per minute. */
  readonly tempo: number;
  readonly key: MusicalKey;
  readonly beatsPerBar?: number;
  /** Loop length in bars. */
  readonly bars?: number;
  /** Grid resolution: steps per beat (2 = eighth notes, 4 = sixteenths). */
  readonly stepsPerBeat?: number;
  /** Swing applied to odd steps, `0..0.75`. */
  readonly swing?: number;
  readonly voices: readonly ProgramVoiceInput[];
  readonly device?: DeviceProfileInput;
  readonly seed?: number;
  readonly gain?: number;
}

/** Fully resolved program descriptor handed to the scheduler. */
export interface MusicProgramDescriptor extends DomainSpecBase {
  readonly id: string;
  readonly label: string;
  readonly tempo: number;
  readonly key: MusicalKey;
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly stepsPerBeat: number;
  readonly stepsPerLoop: number;
  readonly swing: number;
  readonly secondsPerBeat: number;
  readonly secondsPerStep: number;
  readonly loopDurationSeconds: number;
  readonly voices: readonly ProgramVoice[];
  readonly device: DeviceProfile;
  readonly seed: number;
  readonly gain: number;
}

function normalizePatternStep(
  issues: IssueList,
  path: string,
  value: unknown,
  stepsPerLoop: number,
): PatternStep | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object of shape { step, note?, durationSteps?, velocity? }`);
    return null;
  }
  const step = requireNumber(issues, `${path}.step`, value['step'], 0, 100000, 0);
  const roundedStep = Math.round(step);
  if (roundedStep >= stepsPerLoop) {
    issues.push(`${path}.step ${roundedStep} is outside the loop (0..${stepsPerLoop - 1})`);
    return null;
  }
  let note: number | string | undefined;
  const rawNote = value['note'];
  if (rawNote !== undefined && rawNote !== null) {
    if (typeof rawNote === 'number') {
      if (Number.isFinite(rawNote)) note = rawNote;
      else issues.push(`${path}.note must be a finite scale degree`);
    } else if (typeof rawNote === 'string') {
      if (noteToMidi(rawNote) === null) {
        issues.push(`${path}.note ${JSON.stringify(rawNote)} is not a pitch name such as C4 or Bb3`);
      } else {
        note = rawNote;
      }
    } else {
      issues.push(`${path}.note must be a scale degree or a pitch name`);
    }
  }
  const durationSteps = Math.max(
    1,
    Math.round(readNumber(issues, `${path}.durationSteps`, value['durationSteps'], 1, 1, stepsPerLoop * 8)),
  );
  return {
    step: roundedStep,
    note,
    durationSteps,
    velocity: readNumber(issues, `${path}.velocity`, value['velocity'], 0.85, 0, 1),
    tie: readBoolean(issues, `${path}.tie`, value['tie'], false),
  };
}

/**
 * Defaults, validates and resolves an era music program.
 *
 * Rejects a descriptor that declares no voices — and one whose every voice is
 * muted or has an empty pattern, which would emit nothing but silence where the
 * scene expects music.
 */
export function normalizeMusicProgram(
  value: unknown,
  subject = 'music program',
): MusicProgramDescriptor {
  const issues: IssueList = [];
  if (!isRecord(value)) {
    throw new AudioDescriptorError(subject, ['descriptor must be an object']);
  }
  const id = requireString(issues, 'id', value['id'], 'unnamed-program');
  const year = readYear(issues, 'year', value['year'], '1945');
  const tempo = requireNumber(issues, 'tempo', value['tempo'], 20, 320, 100);
  const key = normalizeKey(issues, 'key', value['key']);
  const beatsPerBar = Math.round(readNumber(issues, 'beatsPerBar', value['beatsPerBar'], 4, 1, 16));
  const bars = Math.round(readNumber(issues, 'bars', value['bars'], 4, 1, 64));
  const stepsPerBeat = Math.round(readNumber(issues, 'stepsPerBeat', value['stepsPerBeat'], 2, 1, 8));
  const swing = readNumber(issues, 'swing', value['swing'], 0, 0, 0.75);
  const seed = Math.round(readNumber(issues, 'seed', value['seed'], yearToNumber(year) * 7919 + 17, 0, 0xffffffff));
  const gain = readNumber(issues, 'gain', value['gain'], 1, 0, 4);

  const stepsPerLoop = bars * beatsPerBar * stepsPerBeat;
  const secondsPerBeat = 60 / tempo;

  const rawVoices = value['voices'];
  const voices: ProgramVoice[] = [];
  if (!Array.isArray(rawVoices)) {
    issues.push('voices is required and must be an array of voice descriptors');
  } else if (rawVoices.length === 0) {
    issues.push('voices must declare at least one voice');
  } else {
    rawVoices.forEach((entry, index) => {
      const path = `voices[${index}]`;
      if (!isRecord(entry)) {
        issues.push(`${path} must be a voice object`);
        return;
      }
      const voiceId = requireString(issues, `${path}.id`, entry['id'], `voice-${index}`);
      const instrument = normalizeInstrument(issues, `${path}.instrument`, entry['instrument']);
      const rawPattern = entry['pattern'];
      const pattern: PatternStep[] = [];
      if (!Array.isArray(rawPattern)) {
        issues.push(`${path}.pattern is required and must be an array of steps`);
      } else {
        rawPattern.forEach((rawStep, stepIndex) => {
          const parsed = normalizePatternStep(
            issues,
            `${path}.pattern[${stepIndex}]`,
            rawStep,
            stepsPerLoop,
          );
          if (parsed !== null) pattern.push(parsed);
        });
        pattern.sort((a, b) => a.step - b.step);
      }
      voices.push({
        id: voiceId,
        label: readString(issues, `${path}.label`, entry['label'], voiceId),
        instrument,
        pattern,
        mute: readBoolean(issues, `${path}.mute`, entry['mute'], false),
        gain: readNumber(issues, `${path}.gain`, entry['gain'], 1, 0, 4),
        octave: readNumber(issues, `${path}.octave`, entry['octave'], 0, -4, 4),
        humanize: readNumber(issues, `${path}.humanize`, entry['humanize'], 0, 0, 1),
      });
    });
  }

  const audible = voices.filter((voice) => !voice.mute && voice.pattern.length > 0);
  if (voices.length > 0 && audible.length === 0) {
    issues.push('every voice is muted or has an empty pattern, so the program would emit silence');
  }

  const device = isRecord(value['device'])
    ? normalizeDevice(issues, 'device', value['device'])
    : normalizeDevice(issues, 'device', {});

  if (issues.length > 0) {
    throw new AudioDescriptorError(`${subject} "${id}"`, issues);
  }

  return {
    id,
    year,
    label: readString(issues, 'label', value['label'], id),
    tempo,
    key,
    beatsPerBar,
    bars,
    stepsPerBeat,
    stepsPerLoop,
    swing,
    secondsPerBeat,
    secondsPerStep: secondsPerBeat / stepsPerBeat,
    loopDurationSeconds: secondsPerBeat * beatsPerBar * bars,
    voices,
    device,
    seed,
    gain,
    tags: readStringList(issues, 'tags', value['tags']),
    notes: readStringList(issues, 'notes', value['notes']),
  };
}

function normalizeDevice(
  issues: IssueList,
  path: string,
  value: Record<string, unknown>,
): DeviceProfile {
  return {
    kind: readEnum(issues, `${path}.kind`, value['kind'], DEVICE_KINDS, DEVICE_PROFILE_DEFAULTS.kind),
    lowHz: readNumber(issues, `${path}.lowHz`, value['lowHz'], DEVICE_PROFILE_DEFAULTS.lowHz, 20, 2000),
    highHz: readNumber(issues, `${path}.highHz`, value['highHz'], DEVICE_PROFILE_DEFAULTS.highHz, 200, 20000),
    resonance: readNumber(issues, `${path}.resonance`, value['resonance'], DEVICE_PROFILE_DEFAULTS.resonance, 0.1, 20),
    drive: readNumber(issues, `${path}.drive`, value['drive'], DEVICE_PROFILE_DEFAULTS.drive, 0, 1),
    hiss: readNumber(issues, `${path}.hiss`, value['hiss'], DEVICE_PROFILE_DEFAULTS.hiss, 0, 1),
    wobble: readNumber(issues, `${path}.wobble`, value['wobble'], DEVICE_PROFILE_DEFAULTS.wobble, 0, 1),
  };
}

/* -------------------------------------------------------------------------- */
/* Ambience (conversation murmur)                                             */
/* -------------------------------------------------------------------------- */

/** Recipe of the conversation murmur bed: noise layers plus voiced blips. */
export interface MurmurProfile {
  /** Bed level at intensity 1. */
  readonly bedLevel: number;
  /** Highpass on the murmur noise, hertz. */
  readonly bedLowHz: number;
  /** Lowpass on the murmur noise at intensity 0, hertz. */
  readonly bedHighHz: number;
  /** Lowpass on the murmur noise at intensity 1, hertz (spectral density). */
  readonly densityHighHz: number;
  /** Level of the upper density layer at intensity 1. */
  readonly densityLevel: number;
  /** Voiced blips per second at intensity 1. */
  readonly blipRate: number;
  readonly blipLevel: number;
  readonly formantLowHz: number;
  readonly formantHighHz: number;
  readonly blipSeconds: number;
  /** Constant low room tone (fridge, boiler, traffic) level, `0..1`. */
  readonly roomToneLevel: number;
  readonly roomToneHz: number;
}

export interface MurmurProfileInput {
  readonly bedLevel?: number;
  readonly bedLowHz?: number;
  readonly bedHighHz?: number;
  readonly densityHighHz?: number;
  readonly densityLevel?: number;
  readonly blipRate?: number;
  readonly blipLevel?: number;
  readonly formantLowHz?: number;
  readonly formantHighHz?: number;
  readonly blipSeconds?: number;
  readonly roomToneLevel?: number;
  readonly roomToneHz?: number;
}

export const MURMUR_PROFILE_DEFAULTS: MurmurProfile = {
  bedLevel: 0.32,
  bedLowHz: 120,
  bedHighHz: 900,
  densityHighHz: 2600,
  densityLevel: 0.28,
  blipRate: 3.2,
  blipLevel: 0.18,
  formantLowHz: 420,
  formantHighHz: 1800,
  blipSeconds: 0.22,
  roomToneLevel: 0.12,
  roomToneHz: 160,
};

export interface AmbienceSpecInput extends DomainSpecBase {
  readonly id: string;
  readonly label?: string;
  readonly murmur?: MurmurProfileInput;
}

export interface AmbienceSpecDescriptor extends DomainSpecBase {
  readonly id: string;
  readonly label: string;
  readonly murmur: MurmurProfile;
}

/** Defaults, validates and resolves an era murmur bed spec. */
export function normalizeAmbienceSpec(
  value: unknown,
  subject = 'ambience spec',
): AmbienceSpecDescriptor {
  const issues: IssueList = [];
  if (!isRecord(value)) {
    throw new AudioDescriptorError(subject, ['descriptor must be an object']);
  }
  const id = requireString(issues, 'id', value['id'], 'unnamed-ambience');
  const year = readYear(issues, 'year', value['year'], '1945');
  const murmurInput = isRecord(value['murmur']) ? value['murmur'] : {};
  if (value['murmur'] !== undefined && !isRecord(value['murmur'])) {
    issues.push('murmur must be an object of noise and blip settings');
  }
  const murmur: MurmurProfile = {
    bedLevel: readNumber(issues, 'murmur.bedLevel', murmurInput['bedLevel'], MURMUR_PROFILE_DEFAULTS.bedLevel, 0, 4),
    bedLowHz: readNumber(issues, 'murmur.bedLowHz', murmurInput['bedLowHz'], MURMUR_PROFILE_DEFAULTS.bedLowHz, 20, 8000),
    bedHighHz: readNumber(issues, 'murmur.bedHighHz', murmurInput['bedHighHz'], MURMUR_PROFILE_DEFAULTS.bedHighHz, 40, 12000),
    densityHighHz: readNumber(issues, 'murmur.densityHighHz', murmurInput['densityHighHz'], MURMUR_PROFILE_DEFAULTS.densityHighHz, 60, 16000),
    densityLevel: readNumber(issues, 'murmur.densityLevel', murmurInput['densityLevel'], MURMUR_PROFILE_DEFAULTS.densityLevel, 0, 4),
    blipRate: readNumber(issues, 'murmur.blipRate', murmurInput['blipRate'], MURMUR_PROFILE_DEFAULTS.blipRate, 0, 40),
    blipLevel: readNumber(issues, 'murmur.blipLevel', murmurInput['blipLevel'], MURMUR_PROFILE_DEFAULTS.blipLevel, 0, 4),
    formantLowHz: readNumber(issues, 'murmur.formantLowHz', murmurInput['formantLowHz'], MURMUR_PROFILE_DEFAULTS.formantLowHz, 80, 4000),
    formantHighHz: readNumber(issues, 'murmur.formantHighHz', murmurInput['formantHighHz'], MURMUR_PROFILE_DEFAULTS.formantHighHz, 200, 8000),
    blipSeconds: readNumber(issues, 'murmur.blipSeconds', murmurInput['blipSeconds'], MURMUR_PROFILE_DEFAULTS.blipSeconds, 0.03, 3),
    roomToneLevel: readNumber(issues, 'murmur.roomToneLevel', murmurInput['roomToneLevel'], MURMUR_PROFILE_DEFAULTS.roomToneLevel, 0, 4),
    roomToneHz: readNumber(issues, 'murmur.roomToneHz', murmurInput['roomToneHz'], MURMUR_PROFILE_DEFAULTS.roomToneHz, 20, 2000),
  };
  if (issues.length > 0) {
    throw new AudioDescriptorError(`${subject} "${id}"`, issues);
  }
  return {
    id,
    year,
    label: readString(issues, 'label', value['label'], id),
    murmur,
    tags: readStringList(issues, 'tags', value['tags']),
    notes: readStringList(issues, 'notes', value['notes']),
  };
}

/* -------------------------------------------------------------------------- */
/* Coffee machine character                                                   */
/* -------------------------------------------------------------------------- */

/** How the era's machine actually extracts coffee; drives the SFX recipe. */
export type MachineArchetype =
  | 'percolator'
  | 'lever'
  | 'semi-automatic'
  | 'super-automatic'
  | 'multi-group'
  | 'manual';

export const MACHINE_ARCHETYPES = [
  'percolator',
  'lever',
  'semi-automatic',
  'super-automatic',
  'multi-group',
  'manual',
] as const;

/** Cup and saucer material, which decides pitch and ring time of clatter. */
export type ClatterMaterial =
  | 'porcelain'
  | 'china'
  | 'heavy-china'
  | 'glass'
  | 'ceramic'
  | 'paper'
  | 'steel';

export const CLATTER_MATERIALS = [
  'porcelain',
  'china',
  'heavy-china',
  'glass',
  'ceramic',
  'paper',
  'steel',
] as const;

/** Espresso extraction / percolation profile. */
export interface ExtractionProfile {
  readonly archetype: MachineArchetype;
  readonly noiseHz: number;
  readonly noiseQ: number;
  /** Pump, motor or burr flutter rate; `0` disables the modulation. */
  readonly pumpHz: number;
  readonly pumpDepth: number;
  /** Bubbles per second for percolator era machines; `0` disables them. */
  readonly bubbleRate: number;
  /** Solenoid, lever or portafilter knock level, `0..1`. */
  readonly clickLevel: number;
  readonly durationSeconds: number;
  readonly level: number;
  readonly brightness: number;
  readonly toneHz: number;
}

export interface ExtractionProfileInput {
  readonly archetype: MachineArchetype;
  readonly noiseHz?: number;
  readonly noiseQ?: number;
  readonly pumpHz?: number;
  readonly pumpDepth?: number;
  readonly bubbleRate?: number;
  readonly clickLevel?: number;
  readonly durationSeconds?: number;
  readonly level?: number;
  readonly brightness?: number;
  readonly toneHz?: number;
}

/** Steam wand purge profile. */
export interface SteamProfile {
  readonly burstSeconds: number;
  readonly hissHz: number;
  readonly hissQ: number;
  readonly level: number;
  /** How much the hiss rises before falling again, `0..1`. */
  readonly pressureRise: number;
  /** Chatter modulation rate (sputtering wand); `0` disables it. */
  readonly chatterHz: number;
}

export interface SteamProfileInput {
  readonly burstSeconds?: number;
  readonly hissHz?: number;
  readonly hissQ?: number;
  readonly level?: number;
  readonly pressureRise?: number;
  readonly chatterHz?: number;
}

/** Grinder burr run profile. */
export interface GrinderProfile {
  readonly burrHz: number;
  readonly burrQ: number;
  readonly durationSeconds: number;
  readonly level: number;
  readonly wobbleHz: number;
  readonly wobbleDepth: number;
  /** Relative random pitch spread per trigger, `0..1`. */
  readonly pitchJitter: number;
  readonly motorHz: number;
}

export interface GrinderProfileInput {
  readonly burrHz?: number;
  readonly burrQ?: number;
  readonly durationSeconds?: number;
  readonly level?: number;
  readonly wobbleHz?: number;
  readonly wobbleDepth?: number;
  readonly pitchJitter?: number;
  readonly motorHz?: number;
}

/** Cup and saucer clatter profile. */
export interface ClatterProfile {
  readonly material: ClatterMaterial;
  /** Number of contact events in one clatter. */
  readonly pieces: number;
  /** Overall decay of the clatter, seconds. */
  readonly decaySeconds: number;
  readonly ringHz: number;
  readonly ringDecaySeconds: number;
  /** Time the pieces are spread over, seconds. */
  readonly spreadSeconds: number;
  readonly level: number;
  /** Whether a saucer joins the clatter. */
  readonly saucer: boolean;
}

export interface ClatterProfileInput {
  readonly material?: ClatterMaterial;
  readonly pieces?: number;
  readonly decaySeconds?: number;
  readonly ringHz?: number;
  readonly ringDecaySeconds?: number;
  readonly spreadSeconds?: number;
  readonly level?: number;
  readonly saucer?: boolean;
}

/** Milk pitcher knock profile. */
export interface MilkProfile {
  readonly knockHz: number;
  readonly decaySeconds: number;
  readonly level: number;
  /** Level of the steam tail that follows the knock, `0..1`. */
  readonly steamTail: number;
}

export interface MilkProfileInput {
  readonly knockHz?: number;
  readonly decaySeconds?: number;
  readonly level?: number;
  readonly steamTail?: number;
}

/**
 * Till profile. Eras without a till simply leave `drawer`/`beep` false, and the
 * engine then emits nothing for that one-shot instead of a generic click.
 */
export interface TillProfile {
  readonly drawer: boolean;
  readonly beep: boolean;
  readonly beepHz: number;
  readonly beepSeconds: number;
  readonly drawerSeconds: number;
  readonly level: number;
  /** Contactless reader chirp instead of a mechanical till. */
  readonly contactless: boolean;
}

export interface TillProfileInput {
  readonly drawer?: boolean;
  readonly beep?: boolean;
  readonly beepHz?: number;
  readonly beepSeconds?: number;
  readonly drawerSeconds?: number;
  readonly level?: number;
  readonly contactless?: boolean;
}

/** Author facing machine character; only the extraction archetype is required. */
export interface MachineCharacterInput extends DomainSpecBase {
  readonly id?: string;
  readonly extraction: ExtractionProfileInput;
  readonly steam?: SteamProfileInput;
  readonly grinder?: GrinderProfileInput;
  readonly clatter?: ClatterProfileInput;
  readonly milk?: MilkProfileInput;
  readonly till?: TillProfileInput;
}

/** Fully resolved machine character. */
export interface MachineCharacterDescriptor extends DomainSpecBase {
  readonly id: string;
  readonly extraction: ExtractionProfile;
  readonly steam: SteamProfile;
  readonly grinder: GrinderProfile;
  readonly clatter: ClatterProfile;
  readonly milk: MilkProfile;
  readonly till: TillProfile;
}

export const EXTRACTION_PROFILE_DEFAULTS: Omit<ExtractionProfile, 'archetype'> = {
  noiseHz: 3200,
  noiseQ: 0.9,
  pumpHz: 0,
  pumpDepth: 0,
  bubbleRate: 0,
  clickLevel: 0.25,
  durationSeconds: 2.4,
  level: 0.5,
  brightness: 0.5,
  toneHz: 900,
};

export const STEAM_PROFILE_DEFAULTS: SteamProfile = {
  burstSeconds: 1.1,
  hissHz: 5200,
  hissQ: 0.7,
  level: 0.5,
  pressureRise: 0.25,
  chatterHz: 0,
};

export const GRINDER_PROFILE_DEFAULTS: GrinderProfile = {
  burrHz: 320,
  burrQ: 1.1,
  durationSeconds: 1.4,
  level: 0.5,
  wobbleHz: 0,
  wobbleDepth: 0,
  pitchJitter: 0.06,
  motorHz: 60,
};

export const CLATTER_PROFILE_DEFAULTS: ClatterProfile = {
  material: 'china',
  pieces: 3,
  decaySeconds: 0.5,
  ringHz: 2400,
  ringDecaySeconds: 0.22,
  spreadSeconds: 0.12,
  level: 0.45,
  saucer: true,
};

export const MILK_PROFILE_DEFAULTS: MilkProfile = {
  knockHz: 220,
  decaySeconds: 0.3,
  level: 0.45,
  steamTail: 0.35,
};

export const TILL_PROFILE_DEFAULTS: TillProfile = {
  drawer: false,
  beep: false,
  beepHz: 1180,
  beepSeconds: 0.12,
  drawerSeconds: 0.35,
  level: 0.4,
  contactless: false,
};

/** Defaults, validates and resolves an era machine character. */
export function normalizeMachineCharacter(
  value: unknown,
  subject = 'machine character',
): MachineCharacterDescriptor {
  const issues: IssueList = [];
  if (!isRecord(value)) {
    throw new AudioDescriptorError(subject, ['descriptor must be an object']);
  }
  const year = readYear(issues, 'year', value['year'], '1945');
  const extractionInput = isRecord(value['extraction']) ? value['extraction'] : {};
  if (!isRecord(value['extraction'])) {
    issues.push('extraction is required and must be an object with an archetype');
  }
  const extraction: ExtractionProfile = {
    archetype: readEnum(
      issues,
      'extraction.archetype',
      extractionInput['archetype'],
      MACHINE_ARCHETYPES,
      'manual',
    ),
    noiseHz: readNumber(issues, 'extraction.noiseHz', extractionInput['noiseHz'], EXTRACTION_PROFILE_DEFAULTS.noiseHz, 60, 16000),
    noiseQ: readNumber(issues, 'extraction.noiseQ', extractionInput['noiseQ'], EXTRACTION_PROFILE_DEFAULTS.noiseQ, 0.1, 20),
    pumpHz: readNumber(issues, 'extraction.pumpHz', extractionInput['pumpHz'], EXTRACTION_PROFILE_DEFAULTS.pumpHz, 0, 60),
    pumpDepth: readNumber(issues, 'extraction.pumpDepth', extractionInput['pumpDepth'], EXTRACTION_PROFILE_DEFAULTS.pumpDepth, 0, 1),
    bubbleRate: readNumber(issues, 'extraction.bubbleRate', extractionInput['bubbleRate'], EXTRACTION_PROFILE_DEFAULTS.bubbleRate, 0, 60),
    clickLevel: readNumber(issues, 'extraction.clickLevel', extractionInput['clickLevel'], EXTRACTION_PROFILE_DEFAULTS.clickLevel, 0, 1),
    durationSeconds: readNumber(issues, 'extraction.durationSeconds', extractionInput['durationSeconds'], EXTRACTION_PROFILE_DEFAULTS.durationSeconds, 0.05, 30),
    level: readNumber(issues, 'extraction.level', extractionInput['level'], EXTRACTION_PROFILE_DEFAULTS.level, 0, 2),
    brightness: readNumber(issues, 'extraction.brightness', extractionInput['brightness'], EXTRACTION_PROFILE_DEFAULTS.brightness, 0, 1),
    toneHz: readNumber(issues, 'extraction.toneHz', extractionInput['toneHz'], EXTRACTION_PROFILE_DEFAULTS.toneHz, 40, 8000),
  };

  const steamInput = isRecord(value['steam']) ? value['steam'] : {};
  const steam: SteamProfile = {
    burstSeconds: readNumber(issues, 'steam.burstSeconds', steamInput['burstSeconds'], STEAM_PROFILE_DEFAULTS.burstSeconds, 0.05, 20),
    hissHz: readNumber(issues, 'steam.hissHz', steamInput['hissHz'], STEAM_PROFILE_DEFAULTS.hissHz, 200, 18000),
    hissQ: readNumber(issues, 'steam.hissQ', steamInput['hissQ'], STEAM_PROFILE_DEFAULTS.hissQ, 0.1, 20),
    level: readNumber(issues, 'steam.level', steamInput['level'], STEAM_PROFILE_DEFAULTS.level, 0, 2),
    pressureRise: readNumber(issues, 'steam.pressureRise', steamInput['pressureRise'], STEAM_PROFILE_DEFAULTS.pressureRise, 0, 1),
    chatterHz: readNumber(issues, 'steam.chatterHz', steamInput['chatterHz'], STEAM_PROFILE_DEFAULTS.chatterHz, 0, 60),
  };

  const grinderInput = isRecord(value['grinder']) ? value['grinder'] : {};
  const grinder: GrinderProfile = {
    burrHz: readNumber(issues, 'grinder.burrHz', grinderInput['burrHz'], GRINDER_PROFILE_DEFAULTS.burrHz, 60, 12000),
    burrQ: readNumber(issues, 'grinder.burrQ', grinderInput['burrQ'], GRINDER_PROFILE_DEFAULTS.burrQ, 0.1, 20),
    durationSeconds: readNumber(issues, 'grinder.durationSeconds', grinderInput['durationSeconds'], GRINDER_PROFILE_DEFAULTS.durationSeconds, 0.05, 30),
    level: readNumber(issues, 'grinder.level', grinderInput['level'], GRINDER_PROFILE_DEFAULTS.level, 0, 2),
    wobbleHz: readNumber(issues, 'grinder.wobbleHz', grinderInput['wobbleHz'], GRINDER_PROFILE_DEFAULTS.wobbleHz, 0, 60),
    wobbleDepth: readNumber(issues, 'grinder.wobbleDepth', grinderInput['wobbleDepth'], GRINDER_PROFILE_DEFAULTS.wobbleDepth, 0, 1),
    pitchJitter: readNumber(issues, 'grinder.pitchJitter', grinderInput['pitchJitter'], GRINDER_PROFILE_DEFAULTS.pitchJitter, 0, 1),
    motorHz: readNumber(issues, 'grinder.motorHz', grinderInput['motorHz'], GRINDER_PROFILE_DEFAULTS.motorHz, 0, 400),
  };

  const clatterInput = isRecord(value['clatter']) ? value['clatter'] : {};
  const clatter: ClatterProfile = {
    material: readEnum(issues, 'clatter.material', clatterInput['material'], CLATTER_MATERIALS, CLATTER_PROFILE_DEFAULTS.material),
    pieces: Math.round(readNumber(issues, 'clatter.pieces', clatterInput['pieces'], CLATTER_PROFILE_DEFAULTS.pieces, 1, 12)),
    decaySeconds: readNumber(issues, 'clatter.decaySeconds', clatterInput['decaySeconds'], CLATTER_PROFILE_DEFAULTS.decaySeconds, 0.02, 10),
    ringHz: readNumber(issues, 'clatter.ringHz', clatterInput['ringHz'], CLATTER_PROFILE_DEFAULTS.ringHz, 200, 14000),
    ringDecaySeconds: readNumber(issues, 'clatter.ringDecaySeconds', clatterInput['ringDecaySeconds'], CLATTER_PROFILE_DEFAULTS.ringDecaySeconds, 0.01, 10),
    spreadSeconds: readNumber(issues, 'clatter.spreadSeconds', clatterInput['spreadSeconds'], CLATTER_PROFILE_DEFAULTS.spreadSeconds, 0, 5),
    level: readNumber(issues, 'clatter.level', clatterInput['level'], CLATTER_PROFILE_DEFAULTS.level, 0, 2),
    saucer: readBoolean(issues, 'clatter.saucer', clatterInput['saucer'], CLATTER_PROFILE_DEFAULTS.saucer),
  };

  const milkInput = isRecord(value['milk']) ? value['milk'] : {};
  const milk: MilkProfile = {
    knockHz: readNumber(issues, 'milk.knockHz', milkInput['knockHz'], MILK_PROFILE_DEFAULTS.knockHz, 40, 4000),
    decaySeconds: readNumber(issues, 'milk.decaySeconds', milkInput['decaySeconds'], MILK_PROFILE_DEFAULTS.decaySeconds, 0.01, 10),
    level: readNumber(issues, 'milk.level', milkInput['level'], MILK_PROFILE_DEFAULTS.level, 0, 2),
    steamTail: readNumber(issues, 'milk.steamTail', milkInput['steamTail'], MILK_PROFILE_DEFAULTS.steamTail, 0, 1),
  };

  const tillInput = isRecord(value['till']) ? value['till'] : {};
  const till: TillProfile = {
    drawer: readBoolean(issues, 'till.drawer', tillInput['drawer'], TILL_PROFILE_DEFAULTS.drawer),
    beep: readBoolean(issues, 'till.beep', tillInput['beep'], TILL_PROFILE_DEFAULTS.beep),
    beepHz: readNumber(issues, 'till.beepHz', tillInput['beepHz'], TILL_PROFILE_DEFAULTS.beepHz, 120, 8000),
    beepSeconds: readNumber(issues, 'till.beepSeconds', tillInput['beepSeconds'], TILL_PROFILE_DEFAULTS.beepSeconds, 0.02, 3),
    drawerSeconds: readNumber(issues, 'till.drawerSeconds', tillInput['drawerSeconds'], TILL_PROFILE_DEFAULTS.drawerSeconds, 0.02, 5),
    level: readNumber(issues, 'till.level', tillInput['level'], TILL_PROFILE_DEFAULTS.level, 0, 2),
    contactless: readBoolean(issues, 'till.contactless', tillInput['contactless'], TILL_PROFILE_DEFAULTS.contactless),
  };

  if (issues.length > 0) {
    throw new AudioDescriptorError(`${subject} for ${year}`, issues);
  }
  return {
    id: readString(issues, 'id', value['id'], `machine-${year}`),
    year,
    label: readString(issues, 'label', value['label'], `machine-${year}`),
    extraction,
    steam,
    grinder,
    clatter,
    milk,
    till,
    tags: readStringList(issues, 'tags', value['tags']),
    notes: readStringList(issues, 'notes', value['notes']),
  };
}

/* -------------------------------------------------------------------------- */
/* Era mix                                                                    */
/* -------------------------------------------------------------------------- */

export interface MusicMix {
  /** Music bus level, `0..2`. */
  readonly level: number;
  /** Tone control: lowpass cutoff applied to the music bus, hertz. */
  readonly toneHz: number;
  /** Reverb send amount, `0..1`. */
  readonly send: number;
  /** Extra brightness tilt, `0..1` (1 = untouched). */
  readonly brightness: number;
}

export interface MusicMixInput {
  readonly level: number;
  readonly toneHz: number;
  readonly send?: number;
  readonly brightness?: number;
}

export interface AmbienceMix {
  /** Ambience bus level, `0..2`. */
  readonly level: number;
  /** Patron density, `0..1`: drives murmur level, density and blip rate. */
  readonly density: number;
  readonly toneHz: number;
  readonly send: number;
}

export interface AmbienceMixInput {
  readonly level: number;
  readonly density: number;
  readonly toneHz?: number;
  readonly send?: number;
}

export interface MachineMix {
  /** Machine SFX bus level, `0..2`. */
  readonly level: number;
  readonly character: MachineCharacterDescriptor;
  readonly send: number;
}

export interface MachineMixInput {
  readonly level: number;
  readonly character: MachineCharacterInput;
  readonly send?: number;
}

export interface ReverbMix {
  readonly dryWet: number;
  readonly sizeSeconds: number;
  readonly decay: number;
}

export interface ReverbMixInput {
  readonly dryWet?: number;
  readonly sizeSeconds?: number;
  readonly decay?: number;
}

/** Author facing per-era mix. */
export interface EraMixInput extends DomainSpecBase {
  readonly id?: string;
  readonly music: MusicMixInput;
  readonly ambience: AmbienceMixInput;
  readonly machine: MachineMixInput;
  /** Overall brightness of the era's sound, `0..1`. */
  readonly brightness: number;
  readonly reverb?: ReverbMixInput;
  readonly master?: number;
}

/** Fully resolved per-era mix. */
export interface EraMixDescriptor extends DomainSpecBase {
  readonly id: string;
  readonly label: string;
  readonly music: MusicMix;
  readonly ambience: AmbienceMix;
  readonly machine: MachineMix;
  readonly brightness: number;
  readonly reverb: ReverbMix;
  readonly master: number;
}

export const REVERB_MIX_DEFAULTS: ReverbMix = {
  dryWet: 0.25,
  sizeSeconds: 1.1,
  decay: 3.2,
};

/**
 * Defaults, validates and resolves a per-year mix descriptor.
 *
 * This is the descriptor the composition root injects; a missing or malformed
 * one is rejected with every problem listed, so a hand authored era table fails
 * loudly at load time instead of quietly playing the wrong thing.
 */
export function normalizeEraMix(value: unknown, subject = 'era mix'): EraMixDescriptor {
  const issues: IssueList = [];
  if (!isRecord(value)) {
    throw new AudioDescriptorError(subject, [
      value === undefined
        ? 'descriptor is required'
        : 'descriptor must be an object with music, ambience, machine and brightness',
    ]);
  }
  const year = readYear(issues, 'year', value['year'], '1945');
  const id = readString(issues, 'id', value['id'], `mix-${year}`);

  if (!isRecord(value['music'])) {
    issues.push('music is required and must be { level, toneHz }');
  }
  if (!isRecord(value['ambience'])) {
    issues.push('ambience is required and must be { level, density }');
  }
  if (!isRecord(value['machine'])) {
    issues.push('machine is required and must be { level, character }');
  }

  const musicInput: Record<string, unknown> = isRecord(value['music']) ? value['music'] : {};
  const music: MusicMix = {
    level: requireNumber(issues, 'music.level', musicInput['level'], 0, 2, 0.8),
    toneHz: requireNumber(issues, 'music.toneHz', musicInput['toneHz'], 200, 20000, 8000),
    send: readNumber(issues, 'music.send', musicInput['send'], 0.35, 0, 1),
    brightness: readNumber(issues, 'music.brightness', musicInput['brightness'], 1, 0, 1),
  };

  const ambienceInput: Record<string, unknown> = isRecord(value['ambience']) ? value['ambience'] : {};
  const ambience: AmbienceMix = {
    level: requireNumber(issues, 'ambience.level', ambienceInput['level'], 0, 2, 0.7),
    density: requireNumber(issues, 'ambience.density', ambienceInput['density'], 0, 1, 0.5),
    toneHz: readNumber(issues, 'ambience.toneHz', ambienceInput['toneHz'], 4200, 200, 20000),
    send: readNumber(issues, 'ambience.send', ambienceInput['send'], 0.2, 0, 1),
  };

  const machineInput: Record<string, unknown> = isRecord(value['machine']) ? value['machine'] : {};
  const rawCharacter = machineInput['character'];
  const characterSource: unknown = isRecord(rawCharacter) ? { year, ...rawCharacter } : rawCharacter;
  let character: MachineCharacterDescriptor;
  try {
    character = normalizeMachineCharacter(characterSource, `${subject} machine character`);
  } catch (error) {
    if (error instanceof AudioDescriptorError) {
      issues.push(...error.issues.map((issue) => `machine.character: ${issue}`));
      character = normalizeMachineCharacter({ year, extraction: { archetype: 'manual' } });
    } else {
      throw error;
    }
  }
  const machine: MachineMix = {
    level: requireNumber(issues, 'machine.level', machineInput['level'], 0, 2, 0.6),
    character,
    send: readNumber(issues, 'machine.send', machineInput['send'], 0.3, 0, 1),
  };

  const reverbInput: Record<string, unknown> = isRecord(value['reverb']) ? value['reverb'] : {};
  const reverb: ReverbMix = {
    dryWet: readNumber(issues, 'reverb.dryWet', reverbInput['dryWet'], REVERB_MIX_DEFAULTS.dryWet, 0, 1),
    sizeSeconds: readNumber(issues, 'reverb.sizeSeconds', reverbInput['sizeSeconds'], REVERB_MIX_DEFAULTS.sizeSeconds, 0.1, 6),
    decay: readNumber(issues, 'reverb.decay', reverbInput['decay'], REVERB_MIX_DEFAULTS.decay, 0.5, 12),
  };

  const brightness = requireNumber(issues, 'brightness', value['brightness'], 0, 1, 0.7);
  const master = readNumber(issues, 'master', value['master'], 0.9, 0, 2);

  if (issues.length > 0) {
    throw new AudioDescriptorError(`${subject} "${id}"`, issues);
  }
  return {
    id,
    year,
    label: readString(issues, 'label', value['label'], id),
    music,
    ambience,
    machine,
    brightness,
    reverb,
    master,
    tags: readStringList(issues, 'tags', value['tags']),
    notes: readStringList(issues, 'notes', value['notes']),
  };
}

/**
 * Per-year descriptor source the audio scene module reads from. The registry
 * (or any other creator of per-era data) implements it; the audio engine only
 * ever sees descriptors through this interface.
 */
export interface AudioYearProvider {
  /** Mix for `year`; omit or return `undefined` to leave the engine as it is. */
  mix(year: YearId): EraMixInput | undefined | null;
  /** Music program for `year`, scheduled on the music bus. */
  program?(year: YearId): MusicProgramInput | undefined | null;
  /** Murmur bed spec for `year`, played on the ambience bus. */
  ambience?(year: YearId): AmbienceSpecInput | undefined | null;
}

/** Wave shape helper shared with the synthesis code. */
export type { OscillatorTypeLike };
