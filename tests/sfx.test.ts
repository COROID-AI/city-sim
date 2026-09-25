import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ERAS,
  ERAS_BY_ID,
  resolveEraWeights,
  type EraAware,
  type EraId,
  type EraUpdateContext,
} from "../src/era/eraTypes";
import {
  MIX_LIMITS,
  SFX_SAFE_RANGES,
  clampRange,
  computeMasterGain,
  createSfxEngine,
} from "../src/audio/sfx";
import {
  ACOUSTIC_PROFILES,
  FALLBACK_ACOUSTIC_PROFILE,
  FALLBACK_MOTIF,
  LAYER_BUS,
  MUSIC_MOTIFS,
  SOUNDSCAPE_LIMITS,
  busForLayerKind,
  createSoundscape,
  describeEraSoundscape,
  describeSoundscapeMix,
  resolveAcousticProfile,
  resolveMusicMotif,
} from "../src/audio/soundscape";

/* -------------------------------------------------------------------------- */
/* Recording Web Audio double                                                 */
/* -------------------------------------------------------------------------- */

interface AutomationEvent {
  readonly type: "set" | "linear" | "exponential" | "cancel";
  readonly value: number;
  readonly time: number;
}

/** AudioParam double that records every automation call. */
class FakeParam {
  value = 0;
  readonly events: AutomationEvent[] = [];
  readonly defaultValue = 0;

  setValueAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.events.push({ type: "set", value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.events.push({ type: "linear", value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.events.push({ type: "exponential", value, time });
    return this;
  }

  cancelScheduledValues(time: number): FakeParam {
    this.events.push({ type: "cancel", value: this.value, time });
    return this;
  }

  get last(): AutomationEvent | undefined {
    return this.events[this.events.length - 1];
  }
}

/** Minimal AudioNode double: connection bookkeeping only. */
class FakeNode {
  readonly context: FakeAudioContext;
  readonly connections: Array<FakeNode | FakeParam> = [];

  constructor(context: FakeAudioContext) {
    this.context = context;
  }

  connect(target: FakeNode | FakeParam): FakeNode | FakeParam {
    this.connections.push(target);
    return target;
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type: OscillatorType = "sine";
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  startedAt = -1;
  stoppedAt = -1;

  start(when = 0): void {
    this.startedAt = when;
    this.context.oscillators.push(this);
  }

  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

class FakeBufferSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  startedAt = -1;
  stoppedAt = -1;

  start(when = 0): void {
    this.startedAt = when;
    this.context.bufferSources.push(this);
  }

  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

class FakeFilter extends FakeNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

class FakeDelay extends FakeNode {
  readonly delayTime = new FakeParam();
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
}

/** Recording AudioContext double; enough of the API for the audio modules. */
class FakeAudioContext {
  sampleRate = 48000;
  currentTime = 0;
  state: AudioContextState = "suspended";
  readonly destination = new FakeNode(this);
  readonly gains: FakeGain[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly bufferSources: FakeBufferSource[] = [];
  readonly filters: FakeFilter[] = [];
  readonly delays: FakeDelay[] = [];
  readonly compressors: FakeCompressor[] = [];
  resumeCalls = 0;
  closeCalls = 0;

  createGain(): FakeGain {
    const node = new FakeGain(this);
    this.gains.push(node);
    return node;
  }

  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }

  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }

  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter(this);
    this.filters.push(node);
    return node;
  }

  createDelay(): FakeDelay {
    const node = new FakeDelay(this);
    this.delays.push(node);
    return node;
  }

  createDynamicsCompressor(): FakeCompressor {
    const node = new FakeCompressor(this);
    this.compressors.push(node);
    return node;
  }

  createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = new Float32Array(Math.max(1, length));
    return {
      length: data.length,
      sampleRate,
      numberOfChannels: 1,
      duration: data.length / sampleRate,
      getChannelData: () => data,
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = "running";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = "closed";
    return Promise.resolve();
  }
}

/** Casts the recorder into the DOM type the audio modules expect. */
function asContext(fake: FakeAudioContext): AudioContext {
  return fake as unknown as AudioContext;
}

/** The one gain node that feeds the speakers: the capped master stage. */
function masterNode(fake: FakeAudioContext): FakeGain {
  const masters = fake.gains.filter((gain) => gain.connections.includes(fake.destination));
  if (masters.length !== 1) {
    throw new Error(`expected exactly one master node, found ${masters.length}`);
  }
  return masters[0]!;
}

/** Runs `frames` deterministic 60 Hz updates. */
function runFrames(soundscape: { update(delta: number): void }, frames: number): void {
  for (let index = 0; index < frames; index += 1) {
    soundscape.update(1 / 60);
  }
}

function eraFrame(era: EraId, blend: number, from: EraId = era, delta = 1 / 60): EraUpdateContext {
  return {
    era,
    from,
    blend,
    weights: resolveEraWeights(from, era, blend),
    delta,
    elapsed: 0,
  };
}

/** Boots a started soundscape on a fresh recording context. */
function runningSoundscape(era: EraId = "1945", volume = 0.8): {
  fake: FakeAudioContext;
  soundscape: ReturnType<typeof createSoundscape>;
} {
  const fake = new FakeAudioContext();
  const soundscape = createSoundscape({ context: asContext(fake), era, volume });
  soundscape.start(true);
  return { fake, soundscape };
}

/* -------------------------------------------------------------------------- */
/* Era descriptors drive the soundscape                                       */
/* -------------------------------------------------------------------------- */

describe("era soundscapes driven by the real era contract", () => {
  it("resolves every era descriptor into mix, layers and motif parameters", () => {
    for (const era of ERAS) {
      const descriptor = era.sound;
      const state = describeEraSoundscape(era.id);

      expect(state.era).toBe(era.id);
      expect(state.soundscape).toBe(descriptor.soundscape);
      expect(state.ambience).toBe(descriptor.ambience);
      expect(state.musicStyle).toBe(descriptor.musicStyle);
      expect(state.musicTempo).toBe(descriptor.musicTempo);
      expect(state.reverbSeconds).toBe(descriptor.reverbSeconds);
      expect(state.trafficGain).toBe(descriptor.trafficGain);
      expect(state.listenerProfile).toBe(descriptor.listenerProfile);
      expect(state.signatureCues).toEqual([...descriptor.signatureCues]);
      expect(state.mixer).toEqual(descriptor.mixer);

      // Layers keep the descriptor's identity and route to their mixer bus.
      expect(state.layers.map((layer) => layer.id)).toEqual(descriptor.layers.map((layer) => layer.id));
      for (const layer of state.layers) {
        const source = descriptor.layers.find((candidate) => candidate.id === layer.id)!;
        expect(layer.kind).toBe(source.kind);
        expect(layer.character).toBe(source.character);
        expect(layer.bus).toBe(busForLayerKind(source.kind));
        expect(LAYER_BUS[source.kind]).toBe(layer.bus);
        expect(layer.gain).toBeGreaterThan(0);
        expect(layer.gain).toBeLessThanOrEqual(SFX_SAFE_RANGES.layerGain.max);
        expect(layer.voiceGain).toBeGreaterThan(0);
        expect(layer.voiceGain).toBeLessThanOrEqual(SFX_SAFE_RANGES.layerGain.max);
        expect(layer.level).toBe(layer.voiceGain);
        expect(layer.weight).toBe(1);
        expect(layer.busGain).toBe(state.busGains[layer.bus]);
      }

      // Bus faders: the mixer, with traffic scaled by its pre-mixer level.
      for (const bus of ["ambience", "traffic", "music", "effects"] as const) {
        const expected =
          bus === "traffic" ? descriptor.mixer.traffic * descriptor.trafficGain : descriptor.mixer[bus];
        expect(state.busGains[bus]).toBeCloseTo(expected, 8);
        expect(state.busGains[bus]).toBeLessThanOrEqual(SOUNDSCAPE_LIMITS.maxBusGain);
      }

      // Every populated bus presents the same nominal material to its fader,
      // so the mixer profile — not the layer count — sets the era's loudness.
      for (const bus of ["ambience", "traffic", "music", "effects"] as const) {
        const populated = state.layers.some((layer) => layer.bus === bus);
        if (!populated) {
          continue;
        }
        expect(state.materialByBus[bus]).toBeCloseTo(SOUNDSCAPE_LIMITS.busMaterialGain, 6);
        expect(state.materialByBus[bus]).toBeLessThanOrEqual(SOUNDSCAPE_LIMITS.busMaterialGain + 1e-9);
      }
      const busMaterialTotal = (["ambience", "traffic", "music", "effects"] as const).reduce(
        (sum, bus) => sum + state.materialByBus[bus],
        0,
      );
      expect(busMaterialTotal).toBeLessThanOrEqual(SOUNDSCAPE_LIMITS.maxMaterialLoad + 1e-9);
      expect(busMaterialTotal).toBeGreaterThan(0);
    }
  });

  it("gives each era a distinct motif with a dedicated acoustic profile", () => {
    const expectedLabels: Readonly<Record<EraId, string>> = {
      "1945": "jazz",
      "1965": "rock",
      "1985": "synth",
      "2005": "pop",
      "2025": "ambient",
    };

    const signatures = new Set<string>();
    for (const era of ERAS) {
      const state = describeEraSoundscape(era.id);
      expect(state.motif.label).toBe(expectedLabels[era.id]);
      expect(state.motif.style).toBe(era.sound.musicStyle);
      expect(MUSIC_MOTIFS[era.sound.musicStyle]).toBe(state.motif);

      // Real descriptors resolve to authored profiles, never the fallback.
      expect(ACOUSTIC_PROFILES[era.sound.soundscape]).toBeDefined();
      expect(state.profile).toBe(resolveAcousticProfile(era.sound.soundscape));
      expect(state.profile).not.toBe(FALLBACK_ACOUSTIC_PROFILE);
      expect(state.motif).not.toBe(FALLBACK_MOTIF);

      signatures.add(
        `${state.motif.rootHz}|${state.motif.waveform}|${state.motif.scale.join(",")}|${state.motif.melody.join(",")}`,
      );
    }
    expect(signatures.size).toBe(ERAS.length);

    // Period-appropriate contrasts the era data implies.
    const jazz = describeEraSoundscape("1945");
    const synth = describeEraSoundscape("1985");
    const ambient = describeEraSoundscape("2025");
    expect(jazz.motif.swing).toBeGreaterThan(synth.motif.swing);
    expect(synth.motif.stepBeats).toBeLessThan(ambient.motif.stepBeats);
    expect(synth.motif.brightness).toBeGreaterThan(jazz.motif.brightness);
    expect(ambient.motif.holdSteps).toBeGreaterThan(synth.motif.holdSteps);

    // Era-appropriate traffic intensity changes with the period.
    expect(describeEraSoundscape("1965").busGains.traffic).toBeGreaterThan(
      describeEraSoundscape("1945").busGains.traffic,
    );
    expect(describeEraSoundscape("1945").busGains.traffic).toBeGreaterThan(
      describeEraSoundscape("2025").busGains.traffic,
    );

    // Unknown styles stay audible instead of throwing.
    expect(resolveMusicMotif("unknown-future-style")).toBe(FALLBACK_MOTIF);
    expect(resolveAcousticProfile("unknown-soundscape")).toBe(FALLBACK_ACOUSTIC_PROFILE);
  });
});

/* -------------------------------------------------------------------------- */
/* Crossfade + transition stinger                                             */
/* -------------------------------------------------------------------------- */

describe("era transitions and stingers", () => {
  it("crossfades the two real era mixes while the whoosh and chime stinger plays", () => {
    const { fake, soundscape } = runningSoundscape("1945");
    const from = describeEraSoundscape("1945");
    const to = describeEraSoundscape("1985");

    soundscape.triggerTransition("1945", "1985");

    const started = soundscape.state;
    expect(started.transitions).toBe(1);
    expect(started.stingerRequests).toBe(1);
    expect(started.stingers).toBe(1);
    expect(started.activeEras).toEqual(["1945", "1985"]);

    // The event-driven hook settles the deterministic mix on the incoming era
    // while the outgoing voice set is faded out over the descriptor's own
    // transition duration, so the audible crossfade matches the timeline.
    expect(started.mix.weights["1945"]).toBe(0);
    expect(started.mix.weights["1985"]).toBe(1);
    for (const bus of ["ambience", "traffic", "music", "effects"] as const) {
      expect(started.mix.busGains[bus]).toBeLessThanOrEqual(to.busGains[bus] + 1e-9);
    }
    const fadeSeconds = ERAS_BY_ID["1985"].transition.durationMs / 1000;
    const ramps = fake.gains
      .flatMap((gain) => gain.gain.events)
      .filter((event) => event.type === "linear");
    expect(ramps.some((event) => Math.abs(event.time - fadeSeconds) < 1e-9 && event.value === 0)).toBe(true);

    // The stinger is a whoosh (noise through a swept band-pass) plus a chime
    // (a partial stack of sines), and it ducks the music bus underneath.
    const engineCues = soundscape.engine.state.cues;
    expect(engineCues.whooshes).toBe(1);
    expect(engineCues.chimes).toBe(1);
    expect(engineCues.stingers).toBe(1);
    expect(fake.oscillators.length).toBeGreaterThanOrEqual(4);
    expect(fake.filters.some((filter) => filter.type === "bandpass")).toBe(true);
    expect(soundscape.state.mix.musicDuck).toBeGreaterThan(0);
    expect(soundscape.state.mix.busGains.music).toBeLessThan(to.busGains.music);

    // Mid-crossfade the mix is the weighted average of both era profiles.
    soundscape.applyEra("1985", 0.5);
    const middle = soundscape.state.mix;
    expect(middle.blend).toBeCloseTo(0.5, 8);
    for (const bus of ["ambience", "traffic", "music", "effects"] as const) {
      const expected = (from.busGains[bus] + to.busGains[bus]) / 2;
      expect(middle.busGains[bus]).toBeLessThanOrEqual(Math.max(from.busGains[bus], to.busGains[bus]));
      expect(middle.busGains[bus]).toBeGreaterThanOrEqual(0);
      if (bus !== "music") {
        expect(middle.busGains[bus]).toBeCloseTo(expected, 8);
      }
    }
    expect(middle.weights["1945"]).toBeCloseTo(0.5, 8);
    expect(middle.layers.length).toBe(from.layers.length + to.layers.length);

    // Settled on the new era the mix is exactly its descriptor profile, and
    // the stinger duck has decayed away over its tail.
    runFrames(soundscape, 180);
    soundscape.applyEra("1985", 1);
    const settled = soundscape.state.mix;
    expect(settled.weights["1945"]).toBe(0);
    expect(settled.weights["1985"]).toBe(1);
    expect(settled.musicDuck).toBe(0);
    for (const bus of ["ambience", "traffic", "music", "effects"] as const) {
      expect(settled.busGains[bus]).toBeCloseTo(to.busGains[bus], 8);
    }
    // Old voices are released once a third era arrives.
    soundscape.applyEra("2005", 1);
    expect(soundscape.state.activeEras).toEqual(["1985", "2005"]);
    expect(soundscape.state.transitions).toBe(2);
    expect(soundscape.state.transitions).toBe(soundscape.state.stingerRequests);
  });

  it("fires exactly one stinger per era change through the EraAware hook", () => {
    const { soundscape } = runningSoundscape("1945");

    soundscape.applyEra("1965", 0);
    expect(soundscape.state.transitions).toBe(1);
    expect(soundscape.state.stingerRequests).toBe(1);

    // Repeated frames of the same transition must not re-trigger.
    soundscape.applyEra("1965", 0.25);
    soundscape.applyEra("1965", 1);
    expect(soundscape.state.transitions).toBe(1);
    expect(soundscape.state.stingers).toBe(1);

    // The shared loop entry point drives era and clock together.
    soundscape.applyFrame(eraFrame("1985", 0.5, "1965", 1 / 60));
    expect(soundscape.state.era).toBe("1985");
    expect(soundscape.state.from).toBe("1965");
    expect(soundscape.state.blend).toBeCloseTo(0.5, 8);
    expect(soundscape.state.transitions).toBe(2);

    // And the structural EraAware contract is satisfied.
    const aware: EraAware = soundscape;
    aware.applyEra("2025", 1);
    expect(soundscape.state.era).toBe("2025");
  });

  it("keeps the pure mix helper consistent with the runtime state", () => {
    const { soundscape } = runningSoundscape("1945");
    soundscape.applyEra("2005", 0.4);
    const live = soundscape.state.mix;
    expect(live.musicDuck).toBeGreaterThan(0);
    const pure = describeSoundscapeMix("1945", "2005", 0.4, { musicDuck: live.musicDuck });
    expect(live.busGains).toEqual(pure.busGains);
    expect(live.materialLoad).toBeCloseTo(pure.materialLoad, 10);
    expect(live.masterInputGain).toBeCloseTo(pure.masterInputGain, 10);

    // Out-of-range blends clamp instead of extrapolating.
    expect(describeSoundscapeMix("1945", "2005", 4).blend).toBe(1);
    expect(describeSoundscapeMix("1945", "2005", Number.NaN).blend).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Mute, volume and gesture gating                                            */
/* -------------------------------------------------------------------------- */

describe("mute, volume and gesture-gated start", () => {
  it("routes volume through a capped master gain and silences the mix when muted", () => {
    const fake = new FakeAudioContext();
    const soundscape = createSoundscape({ context: asContext(fake), era: "1945", volume: 1 });
    soundscape.start(true);

    const master = masterNode(fake);
    expect(soundscape.state.masterGain).toBeCloseTo(MIX_LIMITS.defaultHeadroom, 8);
    expect(master.gain.value).toBeCloseTo(MIX_LIMITS.defaultHeadroom, 8);
    expect(soundscape.state.masterGain).toBeLessThanOrEqual(MIX_LIMITS.maxMasterGain);

    // Out-of-range volumes clamp rather than scale past the cap.
    soundscape.setVolume(3);
    expect(soundscape.state.volume).toBe(1);
    expect(master.gain.value).toBeCloseTo(MIX_LIMITS.defaultHeadroom, 8);

    soundscape.setVolume(-2);
    expect(soundscape.state.volume).toBe(0);
    expect(soundscape.state.masterGain).toBe(0);

    soundscape.setVolume(0.5);
    expect(soundscape.state.masterGain).toBeCloseTo(0.5 * MIX_LIMITS.defaultHeadroom, 8);

    // Mute zeroes the master stage and freezes the musical clock.
    soundscape.setMuted(true);
    expect(soundscape.state.muted).toBe(true);
    expect(soundscape.state.masterGain).toBe(0);
    expect(master.gain.value).toBe(0);
    expect(soundscape.state.running).toBe(false);

    const notesBefore = soundscape.state.musicNotes;
    const cuesBefore = soundscape.engine.state.cues.tones;
    runFrames(soundscape, 60);
    soundscape.footstep();
    soundscape.horn();
    expect(soundscape.state.musicNotes).toBe(notesBefore);
    expect(soundscape.engine.state.cues.tones).toBe(cuesBefore);
    expect(soundscape.state.footsteps).toBe(0);

    soundscape.setMuted(false);
    expect(soundscape.state.muted).toBe(false);
    expect(soundscape.state.masterGain).toBeCloseTo(0.5 * MIX_LIMITS.defaultHeadroom, 8);
    expect(master.gain.value).toBeCloseTo(0.5 * MIX_LIMITS.defaultHeadroom, 8);
  });

  it("never resumes audio until a real user gesture arrives", () => {
    const fake = new FakeAudioContext();
    const soundscape = createSoundscape({ context: asContext(fake), era: "1985" });

    expect(soundscape.state.started).toBe(false);
    expect(soundscape.state.running).toBe(false);
    expect(soundscape.start()).toBe(false);
    expect(fake.resumeCalls).toBe(0);
    expect(fake.state).toBe("suspended");
    expect(soundscape.engine.state.gestureSeen).toBe(false);

    // A detached gesture listener must not start anything.
    const detachedTarget = new EventTarget();
    soundscape.attachGestureStart(detachedTarget)();
    detachedTarget.dispatchEvent(new Event("pointerdown"));
    expect(fake.resumeCalls).toBe(0);
    expect(soundscape.state.started).toBe(false);

    // A live gesture listener resumes the context and the voices.
    const target = new EventTarget();
    const detach = soundscape.attachGestureStart(target);
    target.dispatchEvent(new Event("pointerdown"));

    expect(fake.resumeCalls).toBe(1);
    expect(fake.state).toBe("running");
    expect(soundscape.state.started).toBe(true);
    expect(soundscape.state.running).toBe(true);
    expect(soundscape.state.voiceCount).toBeGreaterThan(0);

    // An explicit in-gesture start is the documented alternative.
    const direct = createSfxEngine({ context: asContext(fake) });
    expect(direct.start(false)).toBe(false);
    expect(direct.start(true)).toBe(true);
    expect(direct.isRunning()).toBe(true);

    detach();
    runFrames(soundscape, 30);
    expect(soundscape.state.musicNotes).toBeGreaterThan(0);
  });

  it("plays footsteps, horns and motif notes into the live graph", () => {
    const { fake, soundscape } = runningSoundscape("1985");
    const sourcesBefore = fake.bufferSources.length;

    soundscape.footstep({ surface: "grate" });
    soundscape.footstep({ surface: "pavement" });
    soundscape.horn({ timbre: "air-horn" });
    soundscape.horn({ timbre: "streetcar-bell" });

    expect(soundscape.state.footsteps).toBe(2);
    expect(soundscape.state.horns).toBe(2);
    expect(fake.bufferSources.length).toBeGreaterThan(sourcesBefore);
    expect(soundscape.engine.state.cues.footsteps).toBe(2);
    expect(soundscape.engine.state.cues.horns).toBe(2);

    // Motif notes follow the era tempo: 1985's sixteenth-note synth arpeggio
    // fires far more often than 2025's one-note-per-bar ambient pads.
    runFrames(soundscape, 120);
    const dense = soundscape.state.musicNotes;
    expect(dense).toBeGreaterThan(8);

    const sparse = runningSoundscape("2025");
    runFrames(sparse.soundscape, 120);
    expect(sparse.soundscape.state.musicNotes).toBeGreaterThan(0);
    expect(sparse.soundscape.state.musicNotes).toBeLessThan(dense);

    // Every oscillator stays inside a legal range: audio voices inside the
    // audible window, modulation (LFO) voices inside the sub-audio window.
    const allOscillators = [...fake.oscillators, ...sparse.fake.oscillators];
    const audioVoices = allOscillators.filter(
      (oscillator) => oscillator.frequency.value >= SFX_SAFE_RANGES.frequency.min,
    );
    expect(audioVoices.length).toBeGreaterThan(0);
    for (const oscillator of allOscillators) {
      expect(oscillator.frequency.value).toBeGreaterThan(0);
      expect(oscillator.frequency.value).toBeLessThanOrEqual(SFX_SAFE_RANGES.frequency.max);
    }
    for (const voice of audioVoices) {
      for (const event of voice.frequency.events) {
        if (event.type === "cancel") {
          continue;
        }
        expect(event.value).toBeGreaterThanOrEqual(SFX_SAFE_RANGES.frequency.min);
        expect(event.value).toBeLessThanOrEqual(SFX_SAFE_RANGES.frequency.max);
      }
    }
    for (const filter of fake.filters) {
      expect(filter.Q.value).toBeLessThanOrEqual(SFX_SAFE_RANGES.q.max);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Gain staging and graceful degradation                                      */
/* -------------------------------------------------------------------------- */

describe("gain staging and degraded environments", () => {
  it("sums every layer through a capped master with headroom for every era and blend", () => {
    const fake = new FakeAudioContext();
    const soundscape = createSoundscape({ context: asContext(fake), era: "1945", volume: 1 });
    soundscape.start(true);

    const blends = [0, 0.2, 0.5, 0.8, 1];
    for (let index = 0; index < ERAS.length; index += 1) {
      const era = ERAS[index]!;
      const next = ERAS[(index + 1) % ERAS.length]!;
      for (const blend of blends) {
        soundscape.triggerTransition(era.id, next.id);
        soundscape.applyEra(next.id, blend);
        const mix = soundscape.state.mix;

        expect(mix.materialLoad).toBeLessThanOrEqual(SOUNDSCAPE_LIMITS.maxMaterialLoad);
        expect(mix.masterInputGain).toBeLessThanOrEqual(SOUNDSCAPE_LIMITS.maxMasterInput);
        expect(mix.masterInputGain).toBeLessThanOrEqual(SOUNDSCAPE_LIMITS.busMaterialGain + 1e-9);
        expect(mix.peakBusGain).toBeLessThanOrEqual(SOUNDSCAPE_LIMITS.maxBusGain);
        for (const layer of mix.layers) {
          expect(layer.level).toBeLessThanOrEqual(SFX_SAFE_RANGES.layerGain.max);
          expect(layer.voiceGain).toBeLessThanOrEqual(SFX_SAFE_RANGES.layerGain.max);
          expect(layer.voiceGain).toBeGreaterThanOrEqual(0);
          expect(layer.busGain).toBeLessThanOrEqual(SOUNDSCAPE_LIMITS.maxBusGain);
        }
        // Capped master plus a load that never exceeds unity: no clipping.
        expect(soundscape.state.masterGain).toBeLessThanOrEqual(MIX_LIMITS.maxMasterGain);
        expect(mix.masterInputGain * soundscape.state.masterGain).toBeLessThan(1);
      }
    }

    // The limiter is a real compressor stage, not a pass-through.
    expect(fake.compressors).toHaveLength(1);
    expect(fake.compressors[0]!.ratio.value).toBeGreaterThan(1);
    expect(fake.compressors[0]!.threshold.value).toBeLessThan(0);

    // Every gain node the graph ramps to stays within the legal window.
    for (const gain of fake.gains) {
      for (const event of gain.gain.events) {
        if (event.type === "cancel") {
          continue;
        }
        expect(event.value).toBeGreaterThanOrEqual(0);
        expect(event.value).toBeLessThanOrEqual(1);
      }
    }

    expect(computeMasterGain(1, false, MIX_LIMITS.defaultHeadroom)).toBe(MIX_LIMITS.defaultHeadroom);
    expect(computeMasterGain(1, true, MIX_LIMITS.defaultHeadroom)).toBe(0);
    expect(computeMasterGain(1, false, 5)).toBe(MIX_LIMITS.maxMasterGain);
    expect(clampRange(Number.NaN, 0.2, 0.9)).toBe(0.2);
  });

  it("degrades to a silent, deterministic no-op without Web Audio", () => {
    const makeUnavailable = (): ReturnType<typeof createSoundscape> =>
      createSoundscape({ context: null, era: "1985", volume: 1 });

    const soundscape = makeUnavailable();
    expect(soundscape.state.available).toBe(false);
    expect(soundscape.state.voiceCount).toBe(0);
    expect(soundscape.state.running).toBe(false);
    expect(soundscape.start(true)).toBe(false);
    expect(soundscape.engine.context).toBeNull();
    expect(soundscape.engine.busInput("music")).toBeNull();

    // Re-applying the current era is not a change: no stinger, no transitions.
    soundscape.applyEra("1985", 1);
    expect(soundscape.state.transitions).toBe(0);

    // The deterministic mix is still resolved from the real descriptors.
    soundscape.applyEra("2025", 0.5);
    expect(soundscape.state.transitions).toBe(1);
    expect(soundscape.state.stingerRequests).toBe(1);
    const expected = describeSoundscapeMix("1985", "2025", 0.5);
    expect(soundscape.state.mix.busGains).toEqual(expected.busGains);
    expect(soundscape.state.mix.masterInputGain).toBeLessThanOrEqual(1);

    soundscape.triggerTransition("1985", "2025");
    expect(soundscape.state.transitions).toBe(2);
    expect(soundscape.state.stingerRequests).toBe(2);
    // Nothing can be scheduled without an audio device.
    expect(soundscape.state.stingers).toBe(0);

    expect(() => {
      runFrames(soundscape, 120);
      soundscape.footstep();
      soundscape.horn({ timbre: "ev-chirp" });
      soundscape.setMuted(true);
      soundscape.setVolume(0.25);
      soundscape.setMuted(false);
      soundscape.update(1);
      soundscape.dispose();
    }).not.toThrow();
    expect(soundscape.state.musicNotes).toBe(0);
    expect(soundscape.state.footsteps).toBe(0);

    // A factory that refuses (or throws) behaves the same way.
    const broken = createSoundscape({
      factory: () => {
        throw new Error("no audio device");
      },
    });
    expect(broken.state.available).toBe(false);
    expect(() => broken.start(true)).not.toThrow();
    expect(broken.start(true)).toBe(false);

    // jsdom has no Web Audio implementation: the default path is the fallback.
    const automatic = createSfxEngine();
    expect(automatic.available).toBe(false);
    expect(automatic.state.masterGain).toBeGreaterThan(0);
    expect(() => {
      automatic.setVolume(0.4);
      automatic.start(true);
      automatic.transitionStinger();
      automatic.dispose();
    }).not.toThrow();
  });

  it("synthesizes everything: no audio files, network or decoders", () => {
    const sources = ["../src/audio/sfx.ts", "../src/audio/soundscape.ts"].map((path) =>
      readFileSync(new URL(path, import.meta.url), "utf8"),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/XMLHttpRequest|decodeAudioData|createConvolver/);
      expect(source).not.toMatch(/\.(mp3|wav|ogg|m4a|flac)\b/);
    }
  });
});

