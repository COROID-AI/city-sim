/**
 * Composition suite: the audio engine driven the way the application will drive
 * it — through the shared period contracts and the SceneKernel headless harness.
 *
 * The engine is adapted with {@link createAudioSceneModule}, registered on the
 * kernel's own frame loop, driven across all five `YearId`s and disposed with the
 * scene. It also proves the gesture gate survives composition: building a period
 * (or switching years) schedules nothing until `unlock()` is called, and the
 * descriptors applied in the meantime are the ones that start playing.
 *
 * The era descriptors here are fixtures, generated from the shared `YearId`s; the
 * production values are owned by `domain-music-sources`.
 */

import { describe, expect, it } from 'vitest';
import { build } from 'vite';
import {
  YEAR_IDS,
  isSceneModule,
  type PeriodDefinition,
  type YearId,
} from '../../src/contracts/period';
import { createKernel, createManualFrameScheduler } from '../../src/core/kernel';
import {
  createAudioEngine,
  createAudioSceneModule,
  isCafeAudioEngine,
  type AmbienceSpecInput,
  type EraMixInput,
  type MachineCharacterInput,
  type MusicProgramInput,
} from '../../src/audio';
import { createFakeAudioContextFactory } from './fakeAudioContext';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const position = (year: YearId): number => {
  const index = YEAR_IDS.indexOf(year);
  return index < 0 ? 0 : index;
};

/** Minimal but complete period definition, shaped exactly like the registry's. */
function fixturePeriod(year: YearId): PeriodDefinition {
  const index = position(year);
  return {
    year,
    label: year,
    name: `Fixture era ${year}`,
    summary: `Fixture era ${year} used by the audio composition suite.`,
    palette: {
      background: '#101010',
      floor: '#332211',
      wall: `#${(0x220000 + index * 0x110000).toString(16).padStart(6, '0')}`,
      ceiling: '#dddddd',
      accent: '#cc8844',
      lamp: '#ffddaa',
    },
    lighting: {
      ambientColor: '#ffffff',
      ambientIntensity: 0.4 + index * 0.05,
      keyColor: '#fff4e0',
      keyIntensity: 1.1,
      fillColor: '#a8c4ff',
      fillIntensity: 0.3,
      lampColor: '#ffcc88',
      lampIntensity: 0.9,
      fogDensity: 0.02 + index * 0.002,
    },
    details: [`detail-${index}-a`, `detail-${index}-b`],
  };
}

function fixtureProgram(year: YearId): MusicProgramInput {
  const index = position(year);
  return {
    id: `fixture-program-${year}`,
    year,
    tempo: 88 + index * 11,
    key: { root: ['C', 'D', 'F', 'G', 'Bb'][index] ?? 'C', mode: 'dorian' },
    bars: 2,
    stepsPerBeat: 2,
    voices: [
      {
        id: 'bass',
        instrument: 'bass',
        pattern: [
          { step: 0, note: 0, durationSteps: 2 },
          { step: 4, note: 3 },
          { step: 8, note: 5 },
          { step: 12, note: 3 },
        ],
      },
      {
        id: 'lead',
        instrument: index >= 3 ? 'pad' : 'reed',
        pattern: [
          { step: 0, note: 7 },
          { step: 3, note: 9 },
          { step: 6, note: 11 },
          { step: 10, note: 12, velocity: 0.45 },
        ],
        humanize: 0.4,
      },
      {
        id: 'kit',
        instrument: index >= 3 ? 'hi-hat' : 'snare',
        pattern: [0, 4, 8, 12].map((step) => ({ step, note: 12, velocity: 0.5 })),
      },
    ],
    device: { kind: index === 0 ? 'wireless' : index === 4 ? 'phone' : 'boombox', hiss: 0.15 - index * 0.02 },
    seed: 900 + index,
  };
}

function fixtureAmbience(year: YearId): AmbienceSpecInput {
  const index = position(year);
  return {
    id: `fixture-ambience-${year}`,
    year,
    murmur: {
      bedLevel: 0.3 + index * 0.02,
      blipRate: 3.5 + index * 0.3,
      densityLevel: 0.22 + index * 0.03,
      roomToneLevel: 0.09,
    },
  };
}

function fixtureCharacter(year: YearId): MachineCharacterInput {
  const index = position(year);
  const archetypes = ['percolator', 'lever', 'semi-automatic', 'super-automatic', 'multi-group'] as const;
  return {
    id: `fixture-machine-${year}`,
    year,
    extraction: {
      archetype: archetypes[index] ?? 'manual',
      noiseHz: 2500 + index * 300,
      bubbleRate: index === 0 ? 7 : 0,
      durationSeconds: 1.5,
      level: 0.5,
    },
    steam: { burstSeconds: 1, hissHz: 5000, level: 0.5 },
    grinder: { burrHz: 300 + index * 40, durationSeconds: 1.2, level: 0.5 },
    clatter: { material: index % 2 === 0 ? 'porcelain' : 'glass', pieces: 2 + index },
    milk: { knockHz: 220, level: 0.45 },
    till: { drawer: index >= 1, beep: index === 4, contactless: index === 4 },
  };
}

function fixtureMix(year: YearId): EraMixInput {
  const index = position(year);
  return {
    id: `fixture-mix-${year}`,
    year,
    music: { level: 0.55 + index * 0.03, toneHz: 5000 + index * 800, send: 0.3 },
    ambience: { level: 0.5 + index * 0.03, density: 0.25 + index * 0.15 },
    machine: { level: 0.45 + index * 0.05, character: fixtureCharacter(year) },
    brightness: 0.35 + index * 0.13,
    reverb: { dryWet: 0.2 + index * 0.04, sizeSeconds: 0.85 + index * 0.12 },
    master: 0.9,
  };
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

describe('composing the audio engine with the shared contracts', () => {
  it('drives every era through the kernel frame loop and disposes with the scene', async () => {
    const kernel = createKernel(null, {
      forceHeadless: true,
      autoResize: false,
      resizeTarget: null,
      scheduler: createManualFrameScheduler(),
    });
    expect(kernel.headless).toBe(true);

    const { factory, contexts } = createFakeAudioContextFactory();
    const engine = createAudioEngine({ contextFactory: factory, seed: 20240915 });
    const module = createAudioSceneModule({
      engine,
      crossfadeSeconds: 0.3,
      provider: {
        mix: (year) => fixtureMix(year),
        program: (year) => fixtureProgram(year),
        ambience: (year) => fixtureAmbience(year),
      },
    });

    expect(isCafeAudioEngine(engine)).toBe(true);
    expect(isSceneModule(module)).toBe(true);
    expect(module.id).toBe('cafe-audio-engine');
    expect(module.getHotspots()).toEqual([]);

    // The engine is exposed to the scene through the shared build context services.
    const firstBuild = kernel.createBuildContext(fixturePeriod('1945'), {
      services: { audio: engine },
    });
    expect(firstBuild.year).toBe('1945');
    expect(firstBuild.services?.['audio']).toBe(engine);
    module.build(firstBuild);
    expect(module.spec?.year).toBe('1945');
    expect(module.spec?.mixId).toBe('fixture-mix-1945');

    // Building the scene did not touch the audio device: still no gesture.
    expect(engine.state).toBe('locked');
    expect(contexts).toHaveLength(0);

    // The composition root wires the module into the kernel frame loop…
    const off = kernel.onFrame((frame) => {
      module.update(frame.deltaSeconds, {
        year: frame.year,
        elapsedSeconds: frame.elapsedSeconds,
        frame: frame.frame,
      });
    });

    // …and frames before the gesture schedule nothing at all.
    for (let index = 0; index < 30; index += 1) kernel.update(1 / 60);
    expect(engine.getEventLog().some((event) => event.kind === 'music-note')).toBe(false);
    expect(contexts).toHaveLength(0);

    expect(await module.unlock()).toBe('running');
    expect(contexts).toHaveLength(1);
    expect(engine.state).toBe('running');

    const musicLevels = new Map<YearId, number>();
    const archetypes = new Set<string>();
    for (const year of YEAR_IDS) {
      const period = fixturePeriod(year);
      kernel.setYear(year);
      module.applyPeriod(period, kernel.createBuildContext(period, { services: { audio: engine } }));
      expect(module.spec?.year).toBe(year);
      expect(module.spec?.programId).toBe(`fixture-program-${year}`);
      expect(module.spec?.ambienceId).toBe(`fixture-ambience-${year}`);

      for (let index = 0; index < 90; index += 1) kernel.update(1 / 60);

      const state = engine.getMixState();
      expect(state.state).toBe('running');
      expect(state.year).toBe(year);
      expect(state.mixId).toBe(`fixture-mix-${year}`);
      expect(engine.getMachineSfx()?.character.year).toBe(year);
      musicLevels.set(year, state.musicLevel);
      archetypes.add(engine.getMachineSfx()?.character.extraction.archetype ?? '');
    }

    // Each era really is a different mix and a different machine.
    expect(musicLevels.size).toBe(YEAR_IDS.length);
    expect(new Set(musicLevels.values()).size).toBe(YEAR_IDS.length);
    expect(archetypes.size).toBe(YEAR_IDS.length);

    const log = engine.getEventLog();
    expect(log.filter((event) => event.kind === 'music-note').length).toBeGreaterThan(0);
    expect(log.filter((event) => event.kind === 'murmur-blip').length).toBeGreaterThan(0);
    const programIds = new Set(
      log.filter((event) => event.kind === 'music-program').map((event) => event.id ?? ''),
    );
    for (const year of YEAR_IDS) expect(programIds.has(`fixture-program-${year}`)).toBe(true);
    expect(log.every((event) => event.year === undefined || YEAR_IDS.includes(event.year))).toBe(true);

    // Machine SFX run through the composed engine against the active era.
    const shot = engine.triggerMachine('cupClatter');
    expect(shot.emitted).toBe(true);
    expect(shot.year).toBe('2025');

    // Moving back in time crossfades: the old program is retired after the fade.
    const outgoing = engine.getMusicScheduler();
    expect(outgoing).not.toBeNull();
    const back = fixturePeriod('1945');
    module.applyPeriod(back, kernel.createBuildContext(back, { services: { audio: engine } }));
    expect(engine.getMusicScheduler()).not.toBe(outgoing);
    for (let index = 0; index < 60; index += 1) kernel.update(1 / 60);
    expect(outgoing?.disposed).toBe(true);
    expect(engine.getMixState().year).toBe('1945');

    // Teardown: the module disposes the engine, the kernel releases the scene.
    off();
    expect(kernel.getListenerStats().frame).toBe(0);
    module.dispose();
    expect(engine.state).toBe('locked');
    expect(engine.isDisposed).toBe(true);
    expect(engine.context).toBeNull();

    const context = contexts[0];
    expect(context).toBeDefined();
    if (context !== undefined) {
      expect(context.closeCalls).toBe(1);
      expect(context.connectedNodes).toHaveLength(0);
      expect(context.runningSources).toHaveLength(0);
    }

    kernel.dispose();
    expect(kernel.isDisposed).toBe(true);
  });

  it('keeps era descriptors applied while locked and starts them on the gesture', async () => {
    const kernel = createKernel(null, {
      forceHeadless: true,
      autoResize: false,
      resizeTarget: null,
      scheduler: createManualFrameScheduler(),
    });
    const { factory, contexts } = createFakeAudioContextFactory();
    const engine = createAudioEngine({ contextFactory: factory, seed: 31337 });
    const module = createAudioSceneModule({
      engine,
      crossfadeSeconds: 0.2,
      provider: {
        mix: (year) => fixtureMix(year),
        program: (year) => fixtureProgram(year),
        ambience: (year) => fixtureAmbience(year),
      },
    });

    // The timeline moves while the visitor has not interacted yet.
    for (const year of ['1945', '1965', '1985'] as const) {
      const period = fixturePeriod(year);
      kernel.setYear(year);
      module.build(kernel.createBuildContext(period, { services: { audio: engine } }));
      kernel.update(1 / 60);
    }
    expect(module.spec?.year).toBe('1985');
    expect(engine.state).toBe('locked');
    expect(contexts).toHaveLength(0);
    expect(engine.getMusicScheduler()).toBeNull();
    expect(engine.getMurmurBed()).toBeNull();
    expect(() => engine.triggerMachine('grinder')).toThrow();

    // The gesture starts the era that is on screen, with every sink built.
    expect(await engine.unlock()).toBe('running');
    expect(contexts).toHaveLength(1);
    expect(engine.getMusicScheduler()?.program.id).toBe('fixture-program-1985');
    expect(engine.getMurmurBed()?.spec.id).toBe('fixture-ambience-1985');
    expect(engine.getMachineSfx()?.character.year).toBe('1985');

    const off = kernel.onFrame((frame) => {
      module.update(frame.deltaSeconds, {
        year: frame.year,
        elapsedSeconds: frame.elapsedSeconds,
        frame: frame.frame,
      });
    });
    for (let index = 0; index < 120; index += 1) kernel.update(1 / 60);
    expect(engine.getEventLog().filter((event) => event.kind === 'music-note').length).toBeGreaterThan(
      0,
    );
    expect(engine.getMixState().mixId).toBe('fixture-mix-1985');

    // Suspending and resuming mid-scene keeps the era and rebuilds the schedule.
    await engine.suspend();
    expect(engine.state).toBe('suspended');
    expect(await engine.unlock()).toBe('running');
    expect(engine.getMusicScheduler()?.program.id).toBe('fixture-program-1985');

    // Tearing the scene down and rebuilding it starts a fresh, working engine.
    off();
    module.dispose();
    expect(engine.isDisposed).toBe(true);
    expect(await engine.unlock()).toBe('running');
    expect(contexts).toHaveLength(2);
    for (let index = 0; index < 60; index += 1) kernel.update(1 / 60);
    expect(engine.getMusicScheduler()?.disposed).toBe(false);

    engine.dispose();
    kernel.dispose();
  });

  it('bundles through the production Vite pipeline without Node built-ins or assets', async () => {
    // The composition root imports the engine later, so this suite proves the
    // production bundler accepts `src/audio` on its own: `src/main.ts` is owned by
    // app-composition and is deliberately not touched here.
    const entry = new URL('../../src/audio/index.ts', import.meta.url).pathname;
    const root = new URL('../..', import.meta.url).pathname;
    const result = (await build({
      root,
      logLevel: 'silent',
      configFile: false,
      build: {
        write: false,
        minify: false,
        target: 'es2022',
        lib: {
          entry,
          formats: ['es'],
          name: 'CafeAudioEngine',
          fileName: 'cafe-audio-engine',
        },
      },
    })) as unknown;

    // Vite returns one rollup output per format; normalise before inspecting.
    const outputs: readonly unknown[] = Array.isArray(result) ? result : [result];
    const chunks = outputs.flatMap((entry) => {
      const files = (entry as { output?: readonly { type: string; code?: string }[] }).output ?? [];
      return files.filter((file) => file.type === 'chunk');
    });
    expect(chunks.length).toBeGreaterThan(0);
    const code = chunks.map((chunk) => chunk.code ?? '').join('\n');
    expect(code.length).toBeGreaterThan(1000);
    // No Node-only modules, no media elements, no bundled audio files.
    expect(code).not.toMatch(/from\s*['"]node:/);
    expect(code).not.toMatch(/require\s*\(\s*['"]node:/);
    expect(code).not.toMatch(/\.(mp3|wav|ogg|m4a|aac|flac|opus)\b/i);
    expect(code).not.toMatch(/HTMLAudioElement/);
    // The public surface survives the build.
    expect(code).toMatch(/cafe-audio-engine/);
  }, 180_000);
});
