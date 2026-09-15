/**
 * The ambience bus: a continuous conversation-murmur bed whose intensity
 * follows the era's patron density.
 *
 * The bed is built from three layers that all change with intensity, so "more
 * people in the room" reads as a real change in the hubbub rather than a volume
 * knob:
 *
 *  - a **murmur bed** — looping band-limited noise (the mass of voices),
 *  - a **density layer** — the same noise through a bandpass that opens up as
 *    patrons fill the room, adding spectral density and intelligibility, and
 *  - **voiced blips** — short formant-filtered vowel bursts whose *rate* rises
 *    with intensity, giving the bed its conversational grain.
 *
 * A constant low **room tone** (fridge, boiler, street) stays underneath
 * regardless of intensity: the café is never acoustically dead, even at closing.
 *
 * Intensity, bus level and the crossfades are all automation ramps, so an era
 * change in patron density never clicks.
 */

import {
  clamp,
  clamp01,
  createAudioRandom,
  createAudioResourceBag,
  createNoiseBuffer,
  deriveSeed,
  lerp,
  scheduleRamp,
  SILENT_GAIN,
  type AudioContextLike,
  type AudioNodeLike,
  type BiquadFilterNodeLike,
  type GainNodeLike,
} from './types';
import {
  normalizeAmbienceSpec,
  type AmbienceSpecDescriptor,
  type AmbienceSpecInput,
  type MurmurProfile,
} from './program';

/* -------------------------------------------------------------------------- */
/* Blips                                                                      */
/* -------------------------------------------------------------------------- */

/** One voiced murmur blip: a short, formant filtered vowel. */
export interface MurmurBlip {
  /** Absolute context time the blip starts at. */
  readonly time: number;
  readonly durationSeconds: number;
  /** Glottal fundamental, hertz. */
  readonly fundamentalHz: number;
  /** Formant centre frequencies (F1..F3), hertz. */
  readonly formants: readonly number[];
  readonly level: number;
  /** Index of the blip since the bed started (its deterministic seed input). */
  readonly index: number;
}

interface BlipVoice {
  readonly endTime: number;
  readonly index: number;
  stop(when?: number): void;
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Bed                                                                        */
/* -------------------------------------------------------------------------- */

export interface MurmurBedOptions {
  readonly context: AudioContextLike;
  /** Where the bed delivers its signal (the ambience bus input). */
  readonly destination: AudioNodeLike;
  readonly spec: AmbienceSpecInput;
  /** Deterministic seed for the bed's blip sequence. */
  readonly seed?: number;
  /** Starting intensity, `0..1`. */
  readonly intensity?: number;
  /** Starting bus level (the crossfade stage), `0..2`. */
  readonly level?: number;
  /** Absolute time the bed starts at. */
  readonly startTime?: number;
  /** Called for every scheduled blip; the engine uses it for its event log. */
  readonly onBlip?: (blip: MurmurBlip) => void;
}

export interface MurmurBed {
  readonly spec: AmbienceSpecDescriptor;
  /** Current intensity, `0..1`. */
  readonly intensity: number;
  /** Current crossfade level of the bed. */
  readonly level: number;
  /** Blips scheduled since the bed started. */
  readonly blipCount: number;
  /** Blips still sounding. */
  readonly activeBlipCount: number;
  readonly disposed: boolean;
  /** Crossfade stage, feeding the bus. */
  readonly output: GainNodeLike;
  /** Level of the mass-of-voices noise layer. */
  readonly bedGain: GainNodeLike;
  /** Level of the upper density layer. */
  readonly densityGain: GainNodeLike;
  /** Cutoff that opens up as intensity rises (spectral density). */
  readonly densityFilter: BiquadFilterNodeLike;
  /** Constant room tone layer. */
  readonly roomToneGain: GainNodeLike;
  /** Start of the blip sequence (advances as blips are scheduled). */
  readonly nextBlipTime: number;
  setIntensity(value: number, seconds: number, now: number): number;
  setLevel(value: number, seconds: number, now: number): number;
  /** Replaces the murmur recipe in place, without rebuilding the graph. */
  setSpec(spec: AmbienceSpecInput, seconds: number, now: number): void;
  /** Schedules every blip that falls inside `[cursor, untilTime)`. */
  scheduleAhead(untilTime: number): readonly MurmurBlip[];
  fadeIn(seconds: number, now: number): number;
  fadeOut(seconds: number, now: number): number;
  /** Releases blips whose tail has finished; returns how many. */
  reap(now: number): number;
  stop(fadeSeconds: number, now: number): void;
  dispose(): void;
}

/** Blip rate (per second) an intensity maps to. */
function blipRateFor(profile: MurmurProfile, intensity: number): number {
  return profile.blipRate * clamp01(intensity);
}

/**
 * Builds the murmur bed. The noise layers, room tone and blip sequence are all
 * created here; the bed is owned by the engine and released by
 * {@link MurmurBed.dispose}.
 */
export function createMurmurBed(options: MurmurBedOptions): MurmurBed {
  const context = options.context;
  const resources = createAudioResourceBag();
  const seed = Math.trunc(options.seed ?? 0x3a17);
  const startTime = options.startTime ?? 0;
  let spec = normalizeAmbienceSpec(options.spec, 'ambience spec');
  let intensity = clamp01(options.intensity ?? 0.5);
  let level = clamp(options.level ?? 0, 0, 2);
  let disposed = false;
  let stopping = false;
  let blipIndex = 0;
  let blipCount = 0;
  let cursor = startTime;
  const activeBlips: BlipVoice[] = [];

  const noise = createNoiseBuffer(context, { seconds: 3, seed: deriveSeed(seed, 0x0b1e), tilt: 0.55 });

  const output = resources.node(context.createGain());
  const bedGain = resources.node(context.createGain());
  const bedFilter = resources.node(context.createBiquadFilter());
  const bedHighpass = resources.node(context.createBiquadFilter());
  const densityFilter = resources.node(context.createBiquadFilter());
  const densityGain = resources.node(context.createGain());
  const roomToneFilter = resources.node(context.createBiquadFilter());
  const roomToneGain = resources.node(context.createGain());

  output.gain.value = level;

  bedFilter.type = 'lowpass';
  bedFilter.Q.value = 0.7;
  bedHighpass.type = 'highpass';
  bedHighpass.frequency.value = spec.murmur.bedLowHz;
  bedHighpass.Q.value = 0.7;
  densityFilter.type = 'bandpass';
  densityFilter.Q.value = 0.8;
  densityFilter.frequency.value = spec.murmur.bedHighHz;
  roomToneFilter.type = 'lowpass';
  roomToneFilter.frequency.value = spec.murmur.roomToneHz;
  roomToneGain.gain.value = spec.murmur.roomToneLevel;

  // Mass of voices: the same noise through a lowpass and a highpass shelf.
  const bedSource = resources.source(context.createBufferSource());
  bedSource.buffer = noise;
  bedSource.loop = true;
  bedSource.loopStart = 0;
  bedSource.loopEnd = noise.duration;
  bedSource.connect(bedFilter);
  bedFilter.connect(bedHighpass);
  bedHighpass.connect(bedGain);
  bedGain.connect(output);

  // Density layer: brighter, opened up by intensity.
  const densitySource = resources.source(context.createBufferSource());
  densitySource.buffer = noise;
  densitySource.loop = true;
  densitySource.loopStart = 0;
  densitySource.loopEnd = noise.duration;
  densitySource.connect(densityFilter);
  densityFilter.connect(densityGain);
  densityGain.connect(output);

  // Constant room tone: the building itself.
  const roomNoise = createNoiseBuffer(context, { seconds: 4, seed: deriveSeed(seed, 0x2c01), tilt: 0.12 });
  const roomToneSource = resources.source(context.createBufferSource());
  roomToneSource.buffer = roomNoise;
  roomToneSource.loop = true;
  roomToneSource.loopStart = 0;
  roomToneSource.loopEnd = roomNoise.duration;
  roomToneSource.connect(roomToneFilter);
  roomToneFilter.connect(roomToneGain);
  roomToneGain.connect(output);

  output.connect(options.destination);

  bedSource.start(startTime, 0);
  densitySource.start(startTime, 1.5);
  roomToneSource.start(startTime, 0);

  /** Applies intensity to every dependent parameter with one ramp each. */
  function applyIntensity(next: number, seconds: number, now: number, previous: number): void {
    const profile = spec.murmur;
    scheduleRamp(bedGain.gain, profile.bedLevel * previous, profile.bedLevel * next, seconds, now);
    scheduleRamp(
      densityGain.gain,
      profile.densityLevel * previous,
      profile.densityLevel * next,
      seconds,
      now,
    );
    const previousCutoff = Math.max(
      lerp(profile.bedHighHz, profile.densityHighHz, previous),
      40,
    );
    const nextCutoff = Math.max(lerp(profile.bedHighHz, profile.densityHighHz, next), 40);
    densityFilter.frequency.cancelScheduledValues(now);
    densityFilter.frequency.setValueAtTime(previousCutoff, now);
    if (seconds <= 0 || previousCutoff === nextCutoff) {
      densityFilter.frequency.setValueAtTime(nextCutoff, now);
    } else {
      densityFilter.frequency.exponentialRampToValueAtTime(nextCutoff, now + seconds);
    }
  }

  applyIntensity(intensity, 0, startTime, intensity);

  function planBlip(index: number, time: number): MurmurBlip {
    const profile = spec.murmur;
    const random = createAudioRandom(deriveSeed(seed, index, 0x5b17));
    const span = Math.max(profile.formantHighHz - profile.formantLowHz, 20);
    const firstFormant = profile.formantLowHz + span * (0.12 + random() * 0.45);
    const formants = [
      firstFormant,
      firstFormant * (1.85 + random() * 0.8),
      firstFormant * (3.1 + random() * 1.5),
    ];
    return {
      time,
      durationSeconds: Math.max(profile.blipSeconds * (0.7 + random() * 0.7), 0.05),
      fundamentalHz: lerp(84, 196, random()),
      formants,
      level: clamp(
        profile.blipLevel * (0.55 + 0.45 * intensity) * (0.6 + random() * 0.7),
        SILENT_GAIN * 10,
        4,
      ),
      index,
    };
  }

  function renderBlip(blip: MurmurBlip): void {
    const bag = createAudioResourceBag();
    const random = createAudioRandom(deriveSeed(seed, blip.index, 0x7a11));
    const carrier = bag.node(context.createOscillator());
    carrier.type = 'sawtooth';
    carrier.frequency.setValueAtTime(blip.fundamentalHz, blip.time);
    carrier.frequency.linearRampToValueAtTime(
      blip.fundamentalHz * (0.86 + random() * 0.1),
      blip.time + blip.durationSeconds,
    );
    const blipGain = bag.node(context.createGain());
    const peak = Math.max(blip.level, SILENT_GAIN * 10);
    const holdUntil = blip.time + blip.durationSeconds;
    const endTime = holdUntil + 0.07;
    const automation = blipGain.gain;
    automation.setValueAtTime(0, blip.time);
    automation.linearRampToValueAtTime(peak, blip.time + 0.022);
    automation.setValueAtTime(peak * 0.75, blip.time + blip.durationSeconds * 0.5);
    automation.exponentialRampToValueAtTime(SILENT_GAIN, endTime);
    blipGain.connect(output);

    const formants: readonly number[] = blip.formants;
    formants.forEach((centreHz, formantIndex) => {
      const band = bag.node(context.createBiquadFilter());
      band.type = 'bandpass';
      band.Q.value = 2.4 + formantIndex * 0.6;
      band.frequency.setValueAtTime(clamp(centreHz, 80, 8000), blip.time);
      if (random() < 0.4) {
        // Occasional second syllable: the formants move mid vowel.
        band.frequency.linearRampToValueAtTime(
          clamp(centreHz * (0.82 + random() * 0.4), 80, 8000),
          holdUntil,
        );
      }
      const bandGain = bag.node(context.createGain());
      bandGain.gain.value = 0.75 / (formantIndex + 1);
      carrier.connect(band);
      band.connect(bandGain);
      bandGain.connect(blipGain);
    });

    bag.startSource(carrier, blip.time);
    carrier.stop(endTime + 0.02);

    activeBlips.push({
      endTime,
      index: blip.index,
      stop(when) {
        bag.stopAll(when);
      },
      dispose() {
        bag.stopAll();
        bag.disconnectAll();
      },
    });
    blipCount += 1;
  }

  function scheduleAhead(untilTime: number): readonly MurmurBlip[] {
    const scheduled: MurmurBlip[] = [];
    if (disposed || stopping) return scheduled;
    const limit = Number.isFinite(untilTime) ? untilTime : cursor;
    const rate = blipRateFor(spec.murmur, intensity);
    if (rate <= 0.001) {
      // Silence: keep the cursor at the window edge so raising density resumes
      // the murmur from "now" instead of replaying a backlog of blips.
      cursor = Math.max(cursor, limit);
      return scheduled;
    }
    let guard = 0;
    while (cursor < limit && guard < 512) {
      guard += 1;
      const random = createAudioRandom(deriveSeed(seed, blipIndex, 0x9f31));
      const gap = (0.6 + random() * 0.9) / rate;
      const blip = planBlip(blipIndex, cursor);
      blipIndex += 1;
      if (blip.time < limit) {
        renderBlip(blip);
        scheduled.push(blip);
        options.onBlip?.(blip);
      }
      cursor += Math.max(gap, 0.02);
    }
    return scheduled;
  }

  return {
    get spec() {
      return spec;
    },
    get intensity() {
      return intensity;
    },
    get level() {
      return level;
    },
    get blipCount() {
      return blipCount;
    },
    get activeBlipCount() {
      return activeBlips.length;
    },
    get disposed() {
      return disposed;
    },
    output,
    bedGain,
    densityGain,
    densityFilter,
    roomToneGain,
    get nextBlipTime() {
      return cursor;
    },
    setIntensity(value, seconds, now) {
      const next = clamp01(value);
      const previous = intensity;
      intensity = next;
      applyIntensity(next, seconds, now, previous);
      return now + Math.max(seconds, 0);
    },
    setLevel(value, seconds, now) {
      const target = clamp(value, 0, 2);
      const previous = level;
      level = target;
      return scheduleRamp(output.gain, previous, target, seconds, now);
    },
    setSpec(next, seconds, now) {
      const previous = intensity;
      spec = normalizeAmbienceSpec(next, 'ambience spec');
      bedHighpass.frequency.value = spec.murmur.bedLowHz;
      roomToneFilter.frequency.value = spec.murmur.roomToneHz;
      roomToneGain.gain.value = spec.murmur.roomToneLevel;
      applyIntensity(previous, seconds, now, previous);
    },
    scheduleAhead,
    fadeIn(seconds, now) {
      return this.setLevel(1, seconds, now);
    },
    fadeOut(seconds, now) {
      return this.setLevel(0, seconds, now);
    },
    reap(now) {
      let released = 0;
      for (let index = activeBlips.length - 1; index >= 0; index -= 1) {
        const voice = activeBlips[index];
        if (voice === undefined || voice.endTime > now) continue;
        voice.dispose();
        activeBlips.splice(index, 1);
        released += 1;
      }
      return released;
    },
    stop(fadeSeconds, now) {
      if (stopping || disposed) return;
      stopping = true;
      this.setLevel(0, fadeSeconds, now);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopping = true;
      for (const voice of activeBlips) voice.dispose();
      activeBlips.length = 0;
      resources.stopAll();
      resources.disconnectAll();
    },
  };
}
