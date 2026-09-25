import { describe, expect, it } from 'vitest';
import { AudioEngine, type AudioContextLike } from '../src/audio/audioEngine';
import { ERA_AUDIO, allAudioSignatures } from '../src/audio/eraAudio';
import { YEARS, type Year } from '../src/config/types';

interface FakeStats {
  gains: number;
  oscillators: number;
  sources: number;
  filters: number;
  buffers: number;
  panners: number;
}

/**
 * Minimal fake Web Audio graph. It records how many nodes of each kind were
 * built and mirrors parameter values, which is enough to verify the engine's
 * era signature, mute behaviour, unlock gating and one-shot scheduling.
 */
function createFakeAudioContext(): AudioContextLike & { stats: FakeStats; stateValue: string } {
  const stats: FakeStats = { gains: 0, oscillators: 0, sources: 0, filters: 0, buffers: 0, panners: 0 };

  const makeParam = (initial = 0) => {
    const param = {
      value: initial,
      setValueAtTime(value: number) {
        param.value = value;
        return param;
      },
      linearRampToValueAtTime(value: number) {
        param.value = value;
        return param;
      },
      exponentialRampToValueAtTime(value: number) {
        param.value = value;
        return param;
      },
      setTargetAtTime(value: number) {
        param.value = value;
        return param;
      },
    };
    return param;
  };

  const makeNode = () => ({
    connect: (destination: unknown) => destination,
    disconnect: () => undefined,
  });

  const ctx = {
    state: 'suspended',
    currentTime: 0,
    sampleRate: 48_000,
    destination: makeNode(),
    stats,
    createGain() {
      stats.gains += 1;
      return { ...makeNode(), gain: makeParam(1) };
    },
    createOscillator() {
      stats.oscillators += 1;
      return { ...makeNode(), type: 'sine', frequency: makeParam(440), detune: makeParam(0), start: () => undefined, stop: () => undefined };
    },
    createBiquadFilter() {
      stats.filters += 1;
      return { ...makeNode(), type: 'lowpass', frequency: makeParam(1000), Q: makeParam(1) };
    },
    createBufferSource() {
      stats.sources += 1;
      return { ...makeNode(), buffer: null as unknown, loop: false, start: () => undefined, stop: () => undefined };
    },
    createBuffer(channels: number, length: number, sampleRate: number) {
      stats.buffers += 1;
      const data = new Float32Array(length);
      return { length, numberOfChannels: channels, sampleRate, getChannelData: () => data };
    },
    createDynamicsCompressor() {
      return {
        ...makeNode(),
        threshold: makeParam(-18),
        knee: makeParam(20),
        ratio: makeParam(3),
        attack: makeParam(0.004),
        release: makeParam(0.2),
      };
    },
    createStereoPanner() {
      stats.panners += 1;
      return { ...makeNode(), pan: makeParam(0) };
    },
    resume() {
      ctx.state = 'running';
      return Promise.resolve();
    },
    suspend() {
      ctx.state = 'suspended';
      return Promise.resolve();
    },
    close() {
      ctx.state = 'closed';
      return Promise.resolve();
    },
  };

  return ctx as unknown as AudioContextLike & { stats: FakeStats; stateValue: string };
}

function makeEngine() {
  const context = createFakeAudioContext();
  const engine = new AudioEngine({ contextFactory: () => context });
  return { engine, context, stats: context.stats };
}

describe('era audio parameters', () => {
  it('gives every decade a distinct ambience / engine / music signature', () => {
    const signatures = allAudioSignatures();
    expect(signatures).toHaveLength(YEARS.length);
    expect(new Set(signatures).size).toBe(YEARS.length);

    const motifs = YEARS.map((year) => ERA_AUDIO[year].music.motif);
    expect(new Set(motifs).size).toBe(YEARS.length);
    const profiles = YEARS.map((year) => ERA_AUDIO[year].engineProfile);
    expect(new Set(profiles).size).toBe(YEARS.length);
    const tempos = YEARS.map((year) => ERA_AUDIO[year].music.tempo);
    expect(new Set(tempos).size).toBe(YEARS.length);
    const transitions = YEARS.map((year) => ERA_AUDIO[year].transition);
    expect(new Set(transitions).size).toBe(YEARS.length);
  });

  it('describes the period soundscape each decade is known for', () => {
    expect(ERA_AUDIO[1945].streetcarBell).toBe(true);
    expect(ERA_AUDIO[1945].ambience.some((layer) => layer.kind === 'bell')).toBe(true);
    expect(ERA_AUDIO[1945].music.motif).toBe('jazz');

    expect(ERA_AUDIO[1965].engineProfile).toBe('v8');
    expect(ERA_AUDIO[1985].music.motif).toBe('synth');
    expect(ERA_AUDIO[1985].ambience.some((layer) => layer.kind === 'buzz')).toBe(true);
    expect(ERA_AUDIO[2005].music.motif).toBe('downtempo');

    expect(ERA_AUDIO[2025].engineProfile).toBe('electric');
    expect(ERA_AUDIO[2025].music.motif).toBe('lofi');
    expect(ERA_AUDIO[2025].ambience.some((layer) => layer.kind === 'hum')).toBe(true);
    expect(ERA_AUDIO[2025].streetcarBell).toBe(false);
  });
});

describe('audio engine', () => {
  it('only starts output after a simulated user gesture', () => {
    const { engine, context, stats } = makeEngine();

    expect(engine.unlocked).toBe(false);
    expect(engine.hasContext).toBe(false);
    expect(context.state).toBe('suspended');
    expect(stats.gains).toBe(0);

    // One-shots before the gesture are silently dropped.
    engine.playWhoosh();
    engine.playClick();
    expect(engine.events).toHaveLength(0);
    expect(stats.oscillators).toBe(0);

    expect(engine.unlock()).toBe(true);
    expect(engine.unlocked).toBe(true);
    expect(engine.hasContext).toBe(true);
    expect(context.state).toBe('running');
    expect(stats.gains).toBeGreaterThan(1);
    // 1945's bed is noise / murmur / bell based, so it is built from buffers
    // and filters rather than oscillators.
    expect(stats.sources).toBeGreaterThanOrEqual(4);
    expect(stats.filters).toBeGreaterThanOrEqual(4);
    // Ambience beds are mixed in for the current era.
    expect(engine.activeAmbienceIds.length).toBeGreaterThanOrEqual(4);

    // Switching to an electric era rebuilds the bed with oscillators.
    const oscillatorsBefore = stats.oscillators;
    engine.setYear(2025);
    expect(stats.oscillators).toBeGreaterThan(oscillatorsBefore);
  });

  it('degrades silently when Web Audio is unavailable', () => {
    const engine = new AudioEngine({ contextFactory: () => null });
    expect(engine.available).toBe(false);
    expect(engine.unlock()).toBe(false);
    expect(engine.unlocked).toBe(false);
    expect(() => {
      engine.playWhoosh();
      engine.playClick();
      engine.playPassBy({ pan: 0.5 });
      engine.setYear(2025);
      engine.update(1);
    }).not.toThrow();
    expect(engine.events).toHaveLength(0);
  });

  it('builds a different ambience bed for each era', () => {
    const { engine } = makeEngine();
    engine.unlock();
    const signatures = new Map<Year, string>();
    const beds = new Map<Year, string>();
    for (const year of YEARS) {
      engine.setYear(year);
      signatures.set(year, engine.eraSignature);
      beds.set(year, engine.activeAmbienceIds.join('+'));
      expect(engine.activeAmbienceIds).toEqual(ERA_AUDIO[year].ambience.map((layer) => layer.id));
    }
    expect(new Set(signatures.values()).size).toBe(YEARS.length);
    expect(new Set(beds.values()).size).toBe(YEARS.length);
    expect(beds.get(1945)).toContain('1945-trolley-bell');
    expect(beds.get(2025)).toContain('2025-ev-hum');
  });

  it('fires a whoosh for every era change', () => {
    const { engine } = makeEngine();
    engine.unlock();
    engine.setYear(1985);
    engine.playWhoosh();
    engine.setYear(2025);
    engine.playWhoosh();
    const whooshes = engine.events.filter((event) => event === 'whoosh');
    expect(whooshes).toHaveLength(2);
    expect(engine.events).toContain('whoosh');
  });

  it('mutes by zeroing the master gain and restores it on unmute', () => {
    const { engine } = makeEngine();
    engine.unlock();
    const open = engine.masterLevel;
    expect(open).toBeGreaterThan(0.5);

    engine.setMuted(true);
    expect(engine.muted).toBe(true);
    expect(engine.masterLevel).toBe(0);
    engine.playWhoosh();
    expect(engine.events).toHaveLength(0);

    engine.setMuted(false);
    expect(engine.muted).toBe(false);
    expect(engine.masterLevel).toBeCloseTo(open, 6);
    engine.playWhoosh();
    expect(engine.events).toContain('whoosh');
    expect(engine.toggleMuted()).toBe(true);
    expect(engine.masterLevel).toBe(0);
  });

  it('schedules clicks, pass-bys and bells through the graph', () => {
    const { engine, stats } = makeEngine();
    engine.unlock();
    const oscillatorsBefore = stats.oscillators;
    engine.playClick();
    expect(stats.oscillators).toBeGreaterThan(oscillatorsBefore);
    expect(engine.events).toContain('click');

    const sourcesBefore = stats.sources;
    engine.playPassBy({ pan: -0.6 });
    expect(stats.sources).toBeGreaterThan(sourcesBefore);
    expect(stats.panners).toBeGreaterThan(0);
    expect(engine.events).toContain('pass-by');

    // 1945 runs the trolley bell as well as the jazz bed.
    engine.setYear(1945);
    engine.playBell();
    expect(engine.events).toContain('bell');
  });

  it('advances a music sequencer while unlocked', () => {
    const { engine, stats } = makeEngine();
    engine.unlock();
    const before = stats.oscillators;
    for (let i = 0; i < 40; i += 1) engine.update(0.1);
    expect(stats.oscillators).toBeGreaterThan(before);
  });

  it('reports the current era and swaps the spec provider', () => {
    const { engine } = makeEngine();
    expect(engine.year).toBe(1945);
    engine.setYear(2005);
    expect(engine.year).toBe(2005);
    expect(engine.currentSpec.music.motif).toBe('downtempo');
    expect(engine.currentSpec.engineProfile).toBe('v6');
  });

  it('releases resources on dispose', () => {
    const { engine } = makeEngine();
    engine.unlock();
    expect(() => engine.dispose()).not.toThrow();
    expect(engine.hasContext).toBe(false);
    expect(engine.unlocked).toBe(false);
    expect(engine.activeAmbienceIds).toHaveLength(0);
  });
});
