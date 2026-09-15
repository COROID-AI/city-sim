/**
 * Music × audio engine × environment composition suite (headless, node).
 *
 * This is the integration the plan asks for: a *real* `AudioEngine` (built on the
 * recording fake `AudioContext`, so the whole graph, scheduler and event log are
 * observable without an audio device) plus the real `EnvironmentModule` room,
 * driven by the music module through the shared period contracts and the
 * kernel's own frame loop.
 *
 * What it proves:
 *
 *  - every era routes its own programme and mix into the engine's music bus, and
 *    the engine reports them back (`getMixState`, `getMusicScheduler`, the music
 *    bus strip's gain and tone),
 *  - the audible programme always belongs to the device that is visible: the
 *    engine's device profile matches the era's device kind, and only one device
 *    is ever in the scene graph,
 *  - nothing is scheduled until the enter-café gesture unlocks the engine, and
 *    moving the timeline while suspended still applies the new era descriptors,
 *  - the domain bundles through the production Vite pipeline with no assets, no
 *    fonts and no network code.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';
import type * as THREE from 'three';
import {
  YEAR_IDS,
  isSceneModule,
  type PeriodDefinition,
  type YearId,
} from '../../contracts/period';
import { createKernel, createManualFrameScheduler, type Kernel } from '../../core/kernel';
import {
  createAudioEngine,
  isCafeAudioEngine,
  type CafeAudioEngine,
  type DeviceKind,
} from '../../audio';
import { createEnvironmentModule, environmentSpec } from '../environment';
import {
  ERA_MUSIC_MIXES,
  MUSIC_PROGRAMS,
  MUSIC_SOURCE_SPECS,
  createMusicSourceModule,
  describeMusicProgram,
  musicSpec,
  type MusicDeviceKind,
  type MusicSourceModule,
} from './MusicSourceModule';
import { createFakeAudioContextFactory } from '../../../tests/audio/fakeAudioContext';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
  vi.restoreAllMocks();
});

function headlessKernel(): Kernel {
  const kernel = createKernel(null, {
    forceHeadless: true,
    autoResize: false,
    resizeTarget: null,
    scheduler: createManualFrameScheduler(),
  });
  openKernels.push(kernel);
  return kernel;
}

function countNodes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse(() => {
    count += 1;
  });
  return count;
}

function deviceGroupNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((object) => {
    if (object.name.startsWith('music:') && object.userData['music'] !== undefined) {
      names.push(object.name);
    }
  });
  return names;
}

/**
 * Wires the two runtimes into the kernel frame loop the way the composition root
 * will: the engine pumps its scheduler, the music module animates its device.
 */
function pumpFrames(
  kernel: Kernel,
  engine: CafeAudioEngine,
  music: MusicSourceModule,
): () => void {
  return kernel.onFrame((frame) => {
    engine.update(frame.deltaSeconds);
    music.update(frame.deltaSeconds, {
      year: frame.year,
      elapsedSeconds: frame.elapsedSeconds,
      frame: frame.frame,
    });
  });
}

/** Period definition matching the room domain's own era spec (as a registry would). */
function periodFor(year: YearId): PeriodDefinition {
  const spec = environmentSpec(year);
  return {
    year,
    label: spec.label,
    name: spec.name,
    summary: spec.summary,
    palette: {
      background: spec.paint.trimBase,
      floor: spec.floor.palette.base,
      wall: spec.paint.wallBase,
      ceiling: spec.ceiling.finish.palette.base,
      accent: spec.accentColor,
      lamp: spec.signage.lampColor,
    },
    lighting: {
      ambientColor: spec.lightBounce.wall,
      ambientIntensity: 0.5,
      keyColor: spec.lightBounce.ceiling,
      keyIntensity: 1.4,
      fillColor: spec.lightBounce.wall,
      fillIntensity: 0.35,
      lampColor: spec.signage.lampColor,
      lampIntensity: 20,
      fogDensity: 0,
    },
    details: spec.tags,
  };
}

/** The engine's tone profile each visible device must be playing through. */
const PROGRAM_DEVICE_FOR_VISIBLE: Readonly<Record<MusicDeviceKind, DeviceKind>> = Object.freeze({
  'wireless-set': 'wireless',
  jukebox: 'jukebox',
  boombox: 'boombox',
  'ipod-dock': 'ipod',
  'smart-speaker': 'phone',
});

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

describe('composing the music domain with the audio engine and the room', () => {
  it('routes each era programme and mix into the music bus and only plays the visible device', async () => {
    const kernel = headlessKernel();
    const { factory, contexts } = createFakeAudioContextFactory();
    const engine = createAudioEngine({ contextFactory: factory, seed: 20250915 });
    expect(isCafeAudioEngine(engine)).toBe(true);
    const environment = createEnvironmentModule();

    // The room shell is built first, exactly as the registry will build it.
    const first = periodFor('1945');
    environment.build(kernel.createBuildContext(first));
    const roomNodes = countNodes(kernel.world);

    const music = createMusicSourceModule({ crossfadeSeconds: 0.3 });
    expect(isSceneModule(music)).toBe(true);
    kernel.setYear('1945');
    music.build(kernel.createBuildContext(first, { services: { audio: engine } }));

    // Locked: descriptors applied, nothing scheduled, no audio context yet.
    expect(engine.state).toBe('locked');
    expect(contexts).toHaveLength(0);
    expect(engine.getMusicScheduler()).toBeNull();
    expect(engine.getMixState().programId).toBe(MUSIC_PROGRAMS['1945'].id);
    expect(music.routing.awaitingUnlock).toBe(true);
    expect(music.activeDevice()?.kind).toBe('wireless-set');
    expect(deviceGroupNames(kernel.world)).toEqual(['music:1945:wireless-1945']);

    // The enter-café gesture, then the frame loop the composition root runs.
    expect(await engine.unlock()).toBe('running');
    expect(contexts).toHaveLength(1);
    expect(engine.getMusicScheduler()?.program.id).toBe(MUSIC_PROGRAMS['1945'].id);
    expect(engine.getMusicScheduler()?.program.device.kind).toBe('wireless');
    const off = pumpFrames(kernel, engine, music);

    const routed: string[] = [];
    const levels: number[] = [];
    const tones: number[] = [];

    for (const year of YEAR_IDS) {
      const period = periodFor(year);
      kernel.setYear(year);
      const context = kernel.createBuildContext(period, { services: { audio: engine } });
      environment.applyPeriod(period, context);
      if (year === '1945') {
        // Already built above; applying the same era twice must not duplicate.
        expect(deviceGroupNames(kernel.world)).toEqual(['music:1945:wireless-1945']);
      } else {
        music.applyPeriod(period, context);
      }

      const spec = musicSpec(year);
      const device = music.activeDevice();
      expect(device).not.toBeNull();
      expect(device?.kind).toBe(spec.kind);
      expect(device?.programId).toBe(MUSIC_PROGRAMS[year].id);
      expect(deviceGroupNames(kernel.world)).toHaveLength(1);
      expect(music.getHotspots()[0]?.year).toBe(year);

      // The sound matches the device that is on screen.
      const scheduler = engine.getMusicScheduler();
      expect(scheduler?.program.id).toBe(MUSIC_PROGRAMS[year].id);
      expect(scheduler?.program.year).toBe(year);
      expect(scheduler?.program.device.kind).toBe(PROGRAM_DEVICE_FOR_VISIBLE[spec.kind]);

      const state = engine.getMixState();
      expect(state.state).toBe('running');
      expect(state.year).toBe(year);
      expect(state.programId).toBe(MUSIC_PROGRAMS[year].id);
      expect(state.mixId).toBe(ERA_MUSIC_MIXES[year].id);
      // The engine's music bus carries the era's level and tone.
      expect(engine.getBus('music')?.gainValue).toBeCloseTo(state.musicLevel, 6);
      routed.push(state.programId ?? '');
      levels.push(state.musicLevel);
      tones.push(engine.getBus('music')?.toneHz ?? 0);

      // The engine's log records the programme change for this era.
      const programEvents = engine
        .getEventLog()
        .filter((event) => event.kind === 'music-program' && event.id === MUSIC_PROGRAMS[year].id);
      expect(programEvents.length).toBeGreaterThan(0);
      expect(programEvents[programEvents.length - 1]?.year).toBe(year);

      // Pumping frames schedules notes for this era, and animates the device.
      engine.clearEventLog();
      const updatesBefore = music.describe().updates;
      for (let index = 0; index < 120; index += 1) kernel.update(1 / 60);
      const notes = engine.getEventLog().filter((event) => event.kind === 'music-note');
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every((event) => event.year === year)).toBe(true);
      expect(music.describe().updates).toBeGreaterThan(updatesBefore);
    }

    // Five distinct programmes, five distinct bus levels and tones.
    expect(new Set(routed).size).toBe(YEAR_IDS.length);
    expect(new Set(levels).size).toBe(YEAR_IDS.length);
    expect(new Set(tones).size).toBe(YEAR_IDS.length);
    // The engine's routes are the module's own era tables.
    expect(routed).toEqual(YEAR_IDS.map((year) => MUSIC_PROGRAMS[year].id));

    // The room survived every music swap.
    expect(countNodes(kernel.world)).toBeGreaterThan(roomNodes);

    // Suspended mid-scene: a timeline change still applies the new descriptors.
    await engine.suspend();
    expect(engine.state).toBe('suspended');
    const back = periodFor('1945');
    kernel.setYear('1945');
    music.applyPeriod(back, kernel.createBuildContext(back, { services: { audio: engine } }));
    // Suspended, but the era is applied: the scheduler holds the 1945 programme
    // and starts scheduling again once the context resumes.
    expect(engine.getMusicScheduler()?.program.id).toBe(MUSIC_PROGRAMS['1945'].id);
    expect(engine.getMixState().year).toBe('1945');
    expect(engine.getMixState().programId).toBe(MUSIC_PROGRAMS['1945'].id);
    expect(music.activeDevice()?.kind).toBe('wireless-set');
    expect(await engine.unlock()).toBe('running');
    expect(engine.getMusicScheduler()?.program.id).toBe(MUSIC_PROGRAMS['1945'].id);

    // The music module never owns the engine: disposing it leaves the engine live.
    off();
    music.dispose();
    expect(deviceGroupNames(kernel.world)).toEqual([]);
    expect(engine.isDisposed).toBe(false);
    expect(engine.state).toBe('running');

    environment.dispose();
    expect(kernel.world.children).toHaveLength(0);

    // Composition teardown: the engine releases its graph and closes the context.
    engine.dispose();
    expect(engine.isDisposed).toBe(true);
    const context = contexts[0];
    expect(context?.closeCalls).toBe(1);
    kernel.dispose();
  });

  it('applies the upcoming era while the engine is still locked and starts it on the gesture', async () => {
    const kernel = headlessKernel();
    const { factory, contexts } = createFakeAudioContextFactory();
    const engine = createAudioEngine({ contextFactory: factory, seed: 4242 });
    const music = createMusicSourceModule({ engine, crossfadeSeconds: 0.2 });

    // The visitor moves the timeline before interacting with the page.
    for (const year of ['1945', '1965', '1985'] as const) {
      const period = periodFor(year);
      kernel.setYear(year);
      const context = kernel.createBuildContext(period, { services: { audio: engine } });
      if (music.spec === undefined) music.build(context);
      else music.applyPeriod(period, context);
      expect(music.activeDevice()?.kind).toBe(musicSpec(year).kind);
      expect(deviceGroupNames(kernel.world)).toEqual([`music:${year}:${musicSpec(year).deviceId}`]);
    }

    expect(engine.state).toBe('locked');
    expect(contexts).toHaveLength(0);
    expect(engine.getMusicScheduler()).toBeNull();
    expect(engine.getMixState().programId).toBe(MUSIC_PROGRAMS['1985'].id);
    expect(music.routing.awaitingUnlock).toBe(true);

    // The gesture starts exactly the era that is on screen.
    expect(await engine.unlock()).toBe('running');
    expect(engine.getMusicScheduler()?.program.id).toBe(MUSIC_PROGRAMS['1985'].id);
    expect(engine.getMusicScheduler()?.program.device.kind).toBe('boombox');
    expect(engine.getBus('music')?.gainValue).toBeCloseTo(
      describeMusicProgram('1985').musicLevel,
      6,
    );
    expect(engine.getBus('music')?.toneHz).toBeGreaterThan(2000);

    const off = pumpFrames(kernel, engine, music);
    engine.clearEventLog();
    for (let index = 0; index < 180; index += 1) kernel.update(1 / 60);
    const notes = engine.getEventLog().filter((event) => event.kind === 'music-note');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((event) => event.year === '1985')).toBe(true);
    expect(music.describe().updates).toBeGreaterThan(0);

    off();
    music.dispose();
    engine.dispose();
    kernel.dispose();
  });

  it('exposes the era tables the registry needs to assemble the five periods', () => {
    expect(Object.keys(MUSIC_SOURCE_SPECS)).toEqual([...YEAR_IDS]);
    for (const year of YEAR_IDS) {
      const description = describeMusicProgram(year);
      expect(description.deviceKind).toBe(PROGRAM_DEVICE_FOR_VISIBLE[musicSpec(year).kind]);
      expect(description.voiceCount).toBeGreaterThanOrEqual(4);
      expect(description.instruments.length).toBeGreaterThanOrEqual(3);
      expect(description.stepsPerLoop).toBeGreaterThan(0);
      expect(description.signature).toContain(description.programId);
      expect(MUSIC_PROGRAMS[year].id).toBe(musicSpec(year).programId);
    }
  });

  it('bundles through the production Vite pipeline without assets, fonts or network code', async () => {
    const entry = new URL('./MusicSourceModule.ts', import.meta.url).pathname;
    const root = new URL('../..', import.meta.url).pathname;
    const result = (await build({
      root,
      logLevel: 'silent',
      configFile: false,
      build: {
        write: false,
        minify: false,
        target: 'es2022',
        // `three` is the app's shared dependency; externalising it keeps this
        // check about *this domain's* sources and their assets.
        rollupOptions: { external: ['three'] },
        lib: {
          entry,
          formats: ['es'],
          name: 'CafeMusicSources',
          fileName: 'cafe-music-sources',
        },
      },
    })) as unknown;

    const outputs: readonly unknown[] = Array.isArray(result) ? result : [result];
    const chunks = outputs.flatMap((output) => {
      const files =
        (output as { output?: readonly { type: string; code?: string }[] }).output ?? [];
      return files.filter((file) => file.type === 'chunk');
    });
    const assets = outputs.flatMap((output) => {
      const files =
        (output as { output?: readonly { type: string; fileName?: string }[] }).output ?? [];
      return files.filter((file) => file.type === 'asset');
    });
    expect(chunks.length).toBeGreaterThan(0);
    // Nothing to download: a code-only bundle with no images, fonts or audio.
    expect(assets).toHaveLength(0);
    const code = chunks.map((chunk) => chunk.code ?? '').join('\n');
    expect(code.length).toBeGreaterThan(1000);

    // No asset fetches: images, fonts, audio files, remote URLs or network calls.
    expect(code).not.toMatch(/\.(png|jpe?g|gif|webp|avif|svg|ttf|otf|woff2?)\b/i);
    expect(code).not.toMatch(/\.(mp3|wav|ogg|m4a|aac|flac|opus)\b/i);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/XMLHttpRequest|HTMLAudioElement|new\s+Audio\s*\(/);
    expect(code).not.toMatch(/from\s*['"]node:/);
    expect(code).not.toMatch(/https?:\/\//);

    // The era device and programme data really is in the bundle.
    expect(code).toMatch(/wireless-1945/);
    expect(code).toMatch(/jukebox-1965/);
    expect(code).toMatch(/boombox-1985/);
    expect(code).toMatch(/ipod-dock-2005/);
    expect(code).toMatch(/phone-speaker-2025/);
    expect(code).toMatch(/valve-ensemble-1945/);
    expect(code).toMatch(/stream-pop-2025/);
  }, 180_000);
});
