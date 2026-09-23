/**
 * Chrono City — era timeline core test suite.
 *
 * Covers the two modules of the era brain:
 *  - `src/era/eraDescriptors.ts` — complete tables for 1945/1965/1985/2005/2025
 *    (palette, fog, lighting mood, typography, architecture, vehicles, fashion,
 *    signage and soundscape id) plus colour/descriptor blending.
 *  - `src/era/timelineRuntime.ts` — selected-year store, subscribe/notify,
 *    input clamping, the eased ~1.2 s tween with per-frame progress, instant
 *    sets for slider scrubbing, and EraBlendable registration/deregistration.
 *
 * The composition suite at the bottom drives the runtime exclusively through
 * `SceneContext.tick()` to prove transitions advance with the render loop and
 * that a registered blendable visibly morphs across all five years.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  DEFAULT_ERA,
  ERA_IDS,
  smoothStep01,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../../src/core/eraContracts';
import {
  ERA_DESCRIPTORS,
  ERA_DESCRIPTORS_VERSION,
  EraDescriptors,
  blendEraColor,
  getEraDescriptor,
  resolveEraBlend,
  tryGetEraDescriptor,
  type EraTimelineDescriptor,
} from '../../src/era/eraDescriptors';
import {
  DEFAULT_ERA_TRANSITION_MS,
  TIMELINE_SYSTEM_ID,
  TimelineRuntime,
  createTimelineRuntime,
  type EraProgressSnapshot,
} from '../../src/era/timelineRuntime';
import { SceneContext, type SceneContextOptions } from '../../src/core/sceneContext';

/* ------------------------------------------------------------------------- *
 * Test doubles
 * ------------------------------------------------------------------------- */

/** Renderer stub so the scene context runs headless (no WebGL in jsdom). */
function createStubRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    setPixelRatio: () => {},
    setSize: () => {},
    render: () => {},
    setAnimationLoop: () => {},
    dispose: () => {},
  };
  return stub as unknown as THREE.WebGLRenderer;
}

const contexts: SceneContext[] = [];

function createContext(options: SceneContextOptions = {}): SceneContext {
  const context = new SceneContext({
    autoResize: false,
    shadows: false,
    createRenderer: createStubRenderer,
    ...options,
  });
  contexts.push(context);
  return context;
}

/**
 * Blendable that records every call and resolves the in-between descriptor with
 * the module under test, standing in for a real city-block system.
 */
class RecordingBlendable implements EraBlendable {
  readonly setEraCalls: Array<{ era: EraId; options?: EraTransitionOptions }> = [];
  readonly updates: Array<{ progress: number; info: EraTransitionInfo }> = [];
  blended: EraTimelineDescriptor | null = null;

  setEra(era: EraId, options?: EraTransitionOptions): void {
    this.setEraCalls.push({ era, options });
  }

  updateEraTransition(progress: number, transition: EraTransitionInfo): void {
    this.updates.push({ progress, info: transition });
    this.blended = resolveEraBlend(transition.from, transition.to, progress);
  }

  get progressValues(): number[] {
    return this.updates.map((update) => update.progress);
  }

  get last(): { progress: number; info: EraTransitionInfo } | undefined {
    return this.updates.at(-1);
  }

  reset(): void {
    this.setEraCalls.length = 0;
    this.updates.length = 0;
    this.blended = null;
  }
}

afterEach(() => {
  for (const context of contexts) context.dispose();
  contexts.length = 0;
});

/* ------------------------------------------------------------------------- *
 * Descriptor tables
 * ------------------------------------------------------------------------- */

describe('era descriptor tables', () => {
  it('authors complete tables for all five eras', () => {
    expect(ERA_DESCRIPTORS_VERSION).toBe(1);
    expect(Object.keys(ERA_DESCRIPTORS)).toEqual([...ERA_IDS]);

    const paletteColorKeys = [
      'sky',
      'skyHorizon',
      'ground',
      'asphalt',
      'sidewalk',
      'buildingPrimary',
      'buildingSecondary',
      'ambient',
      'emissive',
    ] as const;

    for (const era of ERA_IDS) {
      const descriptor = getEraDescriptor(era);

      // Identity shared with the era contracts.
      expect(descriptor.id).toBe(era);
      expect(descriptor.year).toBe(Number(era));
      expect(descriptor.label.length).toBeGreaterThan(0);
      expect(descriptor.description.length).toBeGreaterThan(0);
      expect(descriptor.keywords.length).toBeGreaterThan(0);

      // Palette.
      for (const key of paletteColorKeys) {
        const color = descriptor.palette[key];
        expect(Number.isInteger(color), `${era}.palette.${key} is an integer colour`).toBe(true);
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThanOrEqual(0xffffff);
      }
      expect(descriptor.palette.accents.length).toBeGreaterThanOrEqual(3);
      expect(descriptor.palette.notes.length).toBeGreaterThan(0);

      // Fog.
      expect(['linear', 'exponential']).toContain(descriptor.fog.mode);
      expect(descriptor.fog.near).toBeGreaterThan(0);
      expect(descriptor.fog.far).toBeGreaterThan(descriptor.fog.near);
      expect(descriptor.fog.density).toBeGreaterThan(0);
      expect(descriptor.fog.color).toBeGreaterThanOrEqual(0);
      expect(descriptor.fog.notes.length).toBeGreaterThan(0);

      // Lighting mood.
      expect(descriptor.lighting.mood.length).toBeGreaterThan(0);
      expect(descriptor.lighting.sunIntensity).toBeGreaterThan(0);
      expect(descriptor.lighting.ambientIntensity).toBeGreaterThan(0);
      expect(descriptor.lighting.exposure).toBeGreaterThan(0);
      expect(descriptor.lighting.contrast).toBeGreaterThan(0);
      expect(descriptor.lighting.sunElevationDeg).toBeGreaterThanOrEqual(0);
      expect(descriptor.lighting.sunElevationDeg).toBeLessThanOrEqual(90);
      expect(descriptor.lighting.notes.length).toBeGreaterThan(0);

      // Typography.
      expect(descriptor.typography.displayFont.length).toBeGreaterThan(0);
      expect(descriptor.typography.bodyFont.length).toBeGreaterThan(0);
      expect(descriptor.typography.headingWeight).toBeGreaterThanOrEqual(300);
      expect(['upper', 'mixed', 'lower']).toContain(descriptor.typography.signageCase);
      expect(descriptor.typography.notes.length).toBeGreaterThan(0);

      // Architecture.
      expect(descriptor.architecture.style.length).toBeGreaterThan(0);
      expect(descriptor.architecture.storeysMin).toBeGreaterThanOrEqual(1);
      expect(descriptor.architecture.storeysMax).toBeGreaterThanOrEqual(
        descriptor.architecture.storeysMin,
      );
      expect(descriptor.architecture.facadeRoughness).toBeGreaterThanOrEqual(0);
      expect(descriptor.architecture.facadeRoughness).toBeLessThanOrEqual(1);
      expect(descriptor.architecture.windowRatio).toBeGreaterThan(0);
      expect(descriptor.architecture.windowRatio).toBeLessThanOrEqual(1);
      expect(descriptor.architecture.roofStyle.length).toBeGreaterThan(0);
      expect(descriptor.architecture.materials.length).toBeGreaterThan(0);

      // Vehicles.
      expect(descriptor.vehicles.style.length).toBeGreaterThan(0);
      expect(descriptor.vehicles.bodyShapes.length).toBeGreaterThan(0);
      expect(descriptor.vehicles.dominantColors.length).toBeGreaterThan(0);
      expect(descriptor.vehicles.topSpeedKph).toBeGreaterThan(0);
      const mixTotal = Object.values(descriptor.vehicles.mix).reduce((sum, share) => sum + share, 0);
      expect(mixTotal).toBeCloseTo(1, 5);
      expect(Object.keys(descriptor.vehicles.mix)).toEqual([...EraDescriptors.vehicleClasses]);

      // Fashion.
      expect(descriptor.fashion.style.length).toBeGreaterThan(0);
      expect(descriptor.fashion.palette.length).toBeGreaterThan(0);
      expect(descriptor.fashion.silhouettes.length).toBeGreaterThan(0);
      expect(descriptor.fashion.hats).toBeGreaterThanOrEqual(0);
      expect(descriptor.fashion.hats).toBeLessThanOrEqual(1);
      expect(descriptor.fashion.formalRatio).toBeGreaterThanOrEqual(0);
      expect(descriptor.fashion.formalRatio).toBeLessThanOrEqual(1);

      // Signage / advertising.
      expect(descriptor.signage.style.length).toBeGreaterThan(0);
      expect(descriptor.signage.slogans.length).toBeGreaterThan(0);
      for (const ratio of [
        descriptor.signage.adDensity,
        descriptor.signage.neonRatio,
        descriptor.signage.backlitRatio,
        descriptor.signage.billboardRatio,
      ]) {
        expect(ratio).toBeGreaterThanOrEqual(0);
        expect(ratio).toBeLessThanOrEqual(1);
      }

      // Soundscape id.
      expect(descriptor.soundscapeId.length).toBeGreaterThan(0);
      expect(descriptor.soundscape.id).toBe(descriptor.soundscapeId);
      expect(descriptor.soundscape.musicBed.length).toBeGreaterThan(0);
      expect(descriptor.soundscape.ambience.length).toBeGreaterThan(0);
      expect(descriptor.soundscape.loudness).toBeGreaterThan(0);
      expect(descriptor.soundscape.loudness).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the five eras distinct, ordered and frozen', () => {
    const years = ERA_IDS.map((era) => getEraDescriptor(era).year);
    expect(years).toEqual([...years].sort((left, right) => left - right));
    expect(new Set(years).size).toBe(ERA_IDS.length);

    const soundscapeIds = ERA_IDS.map((era) => getEraDescriptor(era).soundscapeId);
    expect(new Set(soundscapeIds).size).toBe(ERA_IDS.length);

    const skyColors = ERA_IDS.map((era) => getEraDescriptor(era).palette.sky);
    expect(new Set(skyColors).size).toBe(ERA_IDS.length);

    const archive = getEraDescriptor('1985');
    expect(Object.isFrozen(ERA_DESCRIPTORS)).toBe(true);
    expect(Object.isFrozen(archive)).toBe(true);
    expect(Object.isFrozen(archive.palette)).toBe(true);
    expect(Object.isFrozen(archive.palette.accents)).toBe(true);
    expect(Object.isFrozen(archive.vehicles.mix)).toBe(true);
  });

  it('looks tables up safely and through the aggregate', () => {
    expect(getEraDescriptor('1985').label).toBe('Neon Downtown');
    expect(EraDescriptors.get('2025')).toBe(getEraDescriptor('2025'));
    expect(EraDescriptors.all['1965']).toBe(getEraDescriptor('1965'));
    expect(EraDescriptors.blendColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(tryGetEraDescriptor('2005')).toBe(getEraDescriptor('2005'));
    expect(tryGetEraDescriptor('1999')).toBeNull();
    expect(tryGetEraDescriptor(1985)).toBeNull();
    expect(() => getEraDescriptor('1999')).toThrow(RangeError);
  });

  it('blends colours and descriptors between two eras', () => {
    expect(blendEraColor(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(blendEraColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(blendEraColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    // Out-of-range progress clamps to the endpoints.
    expect(blendEraColor(0x123456, 0x654321, -1)).toBe(0x123456);
    expect(blendEraColor(0x123456, 0x654321, 2)).toBe(0x654321);

    const start = getEraDescriptor('1945');
    const end = getEraDescriptor('2025');
    expect(resolveEraBlend('1945', '2025', 0)).toBe(start);
    expect(resolveEraBlend('1945', '2025', 1)).toBe(end);
    expect(resolveEraBlend('1985', '1985', 0.5)).toBe(getEraDescriptor('1985'));

    const midpoint = resolveEraBlend('1945', '2025', 0.5);
    expect(midpoint.year).toBe(1985);
    expect(midpoint.palette.sky).not.toBe(start.palette.sky);
    expect(midpoint.palette.sky).not.toBe(end.palette.sky);
    const between = (value: number, low: number, high: number): boolean =>
      value > Math.min(low, high) - 1 && value < Math.max(low, high) + 1 && value !== low && value !== high;
    expect(between(midpoint.palette.sky & 0xff, start.palette.sky & 0xff, end.palette.sky & 0xff)).toBe(
      true,
    );
    expect(midpoint.fog.far).toBeGreaterThan(start.fog.far);
    expect(midpoint.fog.far).toBeLessThan(end.fog.far);
    expect([start.architecture.style, end.architecture.style]).toContain(midpoint.architecture.style);
    expect(midpoint.vehicles.mix.car).toBeLessThan(1);
  });
});

/* ------------------------------------------------------------------------- *
 * Selection store
 * ------------------------------------------------------------------------- */

describe('TimelineRuntime selection store', () => {
  it('starts in the default era and exposes year, settled era and descriptor', () => {
    const runtime = new TimelineRuntime();
    expect(runtime.era).toBe(DEFAULT_ERA);
    expect(runtime.selectedEra).toBe(DEFAULT_ERA);
    expect(runtime.year).toBe(Number(DEFAULT_ERA));
    expect(runtime.settledEra).toBe(DEFAULT_ERA);
    expect(runtime.isTransitioning).toBe(false);
    expect(runtime.progress).toBe(1);
    expect(runtime.rawProgress).toBe(1);
    expect(runtime.transitionInfo).toBeNull();
    expect(runtime.descriptor).toBe(getEraDescriptor(DEFAULT_ERA));
    expect(runtime.snapshot.transitioning).toBe(false);
  });

  it('accepts an initial era as id, year number or year string', () => {
    expect(createTimelineRuntime({ initialEra: '1945' }).era).toBe('1945');
    expect(createTimelineRuntime({ initialEra: 1965 }).era).toBe('1965');
    expect(createTimelineRuntime({ initialEra: '1985' }).era).toBe('1985');
    // Out-of-range or in-between years snap to the nearest authored era.
    expect(createTimelineRuntime({ initialEra: 1000 }).era).toBe('1945');
    expect(createTimelineRuntime({ initialEra: 9999 }).era).toBe('2025');
  });

  it('subscribes to selected-year changes and unsubscribes cleanly', () => {
    const runtime = createTimelineRuntime({ initialEra: '1945' });
    const seen: EraId[] = [];
    const unsubscribe = runtime.subscribe((era) => seen.push(era));

    runtime.selectEra('1965');
    runtime.selectEra('1985', { immediate: true });
    expect(seen).toEqual(['1965', '1985']);

    // Re-selecting the current era is a no-op rather than a duplicate notify.
    runtime.selectEra('1985');
    expect(seen).toEqual(['1965', '1985']);

    unsubscribe();
    runtime.selectEra('2025');
    expect(seen).toEqual(['1965', '1985']);
    expect(runtime.era).toBe('2025');
  });

  it('clamps every input to the five valid years', () => {
    const runtime = createTimelineRuntime({ initialEra: '1985' });

    expect(runtime.selectYear(1000, { immediate: true })).toBe('1945');
    expect(runtime.selectYear(-400, { immediate: true })).toBe('1945');
    expect(runtime.selectYear(9999, { immediate: true })).toBe('2025');
    expect(runtime.selectYear(1945, { immediate: true })).toBe('1945');
    expect(runtime.selectYear(2025, { immediate: true })).toBe('2025');

    // In-between years snap to the nearest authored era.
    expect(runtime.selectEra(1990, { immediate: true })).toBe('1985');
    expect(runtime.selectEra('1964', { immediate: true })).toBe('1965');
    expect(runtime.selectEra('1968', { immediate: true })).toBe('1965');
    expect(runtime.selectEra('1976', { immediate: true })).toBe('1985');

    // Non-numeric input fails loudly instead of silently showing the wrong year.
    expect(() => runtime.selectEra('banana')).toThrow(RangeError);
    expect(() => runtime.selectEra(Number.NaN)).toThrow(RangeError);
    expect(runtime.era).toBe('1985');

    for (const era of ERA_IDS) {
      expect(runtime.selectEra(era, { immediate: true })).toBe(era);
      expect(ERA_IDS).toContain(runtime.era);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * Tween behaviour
 * ------------------------------------------------------------------------- */

describe('TimelineRuntime era tween', () => {
  it('drives every registered blendable with eased per-frame progress over ~1.2 s', () => {
    const runtime = createTimelineRuntime({ initialEra: '2025' });
    const recorder = new RecordingBlendable();
    runtime.registerBlendable(recorder, { id: 'recorder' });
    expect(recorder.setEraCalls).toEqual([{ era: '2025', options: { immediate: true } }]);
    expect(recorder.updates).toHaveLength(1);
    recorder.reset();

    const snapshots: EraProgressSnapshot[] = [];
    runtime.onProgress((snapshot) => snapshots.push(snapshot));

    runtime.selectEra('1945');
    expect(runtime.isTransitioning).toBe(true);
    expect(runtime.transitionInfo).toMatchObject({
      from: '2025',
      to: '1945',
      elapsedMs: 0,
      durationMs: DEFAULT_ERA_TRANSITION_MS,
      active: true,
    });
    expect(DEFAULT_ERA_TRANSITION_MS).toBe(1200);
    expect(recorder.setEraCalls).toEqual([
      { era: '1945', options: { durationMs: DEFAULT_ERA_TRANSITION_MS } },
    ]);
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.updates[0]!.progress).toBe(0);
    expect(recorder.updates[0]!.info.active).toBe(true);

    const observed: number[] = [];
    const expected: number[] = [];
    for (let step = 1; step <= 12; step += 1) {
      expect(runtime.advance(DEFAULT_ERA_TRANSITION_MS / 12)).toBe(true);
      observed.push(recorder.last!.progress);
      expected.push(smoothStep01(step / 12));
    }

    expect(observed).toEqual(expected);
    expect(observed.every((value, index) => index === 0 || value > observed[index - 1]!)).toBe(true);
    expect(observed.at(-1)).toBe(1);

    // Completion: tween ends, the target era is settled and one final call lands.
    expect(runtime.isTransitioning).toBe(false);
    expect(runtime.era).toBe('1945');
    expect(runtime.settledEra).toBe('1945');
    expect(runtime.progress).toBe(1);
    expect(recorder.updates.at(-1)!.progress).toBe(1);
    expect(recorder.updates.at(-1)!.info).toMatchObject({
      from: '2025',
      to: '1945',
      durationMs: DEFAULT_ERA_TRANSITION_MS,
      active: false,
    });
    expect(recorder.blended).toBe(getEraDescriptor('1945'));
    expect(runtime.advance(500)).toBe(false);

    // Progress listeners saw every frame, including the settling frame.
    expect(snapshots).toHaveLength(DEFAULT_ERA_TRANSITION_MS / 100 + 1);
    expect(snapshots[0]!.progress).toBe(0);
    expect(snapshots.at(-1)!.transitioning).toBe(false);
    expect(snapshots.at(-1)!.progress).toBe(1);
    expect(snapshots.at(-1)!.descriptor.id).toBe('1945');
  });

  it('eases the raw tween with a smooth curve', () => {
    const runtime = createTimelineRuntime({ initialEra: '2025' });
    const recorder = new RecordingBlendable();
    runtime.registerBlendable(recorder);

    runtime.selectEra('1945');
    runtime.advance(300);
    expect(runtime.rawProgress).toBeCloseTo(0.25, 8);
    expect(runtime.progress).toBeCloseTo(smoothStep01(0.25), 8);
    expect(runtime.progress).toBeLessThan(runtime.rawProgress);

    runtime.advance(300);
    expect(runtime.rawProgress).toBeCloseTo(0.5, 8);
    expect(runtime.progress).toBeCloseTo(0.5, 8);

    runtime.advance(1000);
    expect(runtime.rawProgress).toBe(1);
    expect(runtime.progress).toBe(1);
    expect(runtime.isTransitioning).toBe(false);
  });

  it('applies an instant era set (no tween) for slider scrubbing', () => {
    const runtime = createTimelineRuntime({ initialEra: '1945' });
    const recorder = new RecordingBlendable();
    runtime.registerBlendable(recorder);
    recorder.reset();

    runtime.selectEra('2005', { immediate: true });
    expect(runtime.isTransitioning).toBe(false);
    expect(runtime.era).toBe('2005');
    expect(runtime.settledEra).toBe('2005');
    expect(runtime.progress).toBe(1);
    expect(recorder.setEraCalls).toEqual([{ era: '2005', options: { immediate: true } }]);
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.updates[0]!.progress).toBe(1);
    expect(recorder.updates[0]!.info).toMatchObject({
      from: '1945',
      to: '2005',
      durationMs: 0,
      active: false,
    });
    expect(recorder.blended).toBe(getEraDescriptor('2005'));
    expect(runtime.advance(500)).toBe(false);

    // A zero-length duration takes the same instant path.
    recorder.reset();
    runtime.selectEra('1965', { durationMs: 0 });
    expect(runtime.settledEra).toBe('1965');
    expect(recorder.updates[0]!.progress).toBe(1);
    expect(recorder.updates[0]!.info.durationMs).toBe(0);
  });

  it('keeps up with rapid slider scrubbing', () => {
    const runtime = createTimelineRuntime({ initialEra: '1945' });
    const recorder = new RecordingBlendable();
    runtime.registerBlendable(recorder);

    runtime.selectYear(1965);
    runtime.advance(200);
    runtime.selectYear(2025);
    runtime.advance(150);
    runtime.selectEra(1985, { immediate: true });
    runtime.advance(500);
    runtime.selectYear(2005);
    for (let step = 0; step < 12; step += 1) runtime.advance(100);

    expect(recorder.setEraCalls.map((call) => call.era)).toEqual([
      '1945',
      '1965',
      '2025',
      '1985',
      '2005',
    ]);
    for (const update of recorder.updates) {
      expect(update.progress).toBeGreaterThanOrEqual(0);
      expect(update.progress).toBeLessThanOrEqual(1);
      expect(ERA_IDS).toContain(update.info.from);
      expect(ERA_IDS).toContain(update.info.to);
      // The registration sync reports the settled era as both endpoints.
      if (update.info.active) expect(update.info.from).not.toBe(update.info.to);
    }
    expect(runtime.isTransitioning).toBe(false);
    expect(runtime.era).toBe('2005');
    expect(runtime.settledEra).toBe('2005');
    expect(recorder.blended).toBe(getEraDescriptor('2005'));
  });

  it('rebases an interrupted tween onto the previous selection', () => {
    const runtime = createTimelineRuntime({ initialEra: '1945' });
    const recorder = new RecordingBlendable();
    runtime.registerBlendable(recorder);

    runtime.selectEra('2025');
    runtime.advance(400);
    recorder.reset();

    runtime.selectEra('1965');
    expect(recorder.updates[0]!.info).toMatchObject({ from: '2025', to: '1965', active: true });
    expect(recorder.updates[0]!.progress).toBe(0);

    for (let step = 0; step < 12; step += 1) runtime.advance(100);
    expect(runtime.settledEra).toBe('1965');
    expect(recorder.blended).toBe(getEraDescriptor('1965'));
  });

  it('ignores duplicate selections and can stop notifying progress listeners', () => {
    const runtime = createTimelineRuntime({ initialEra: '1945' });
    const recorder = new RecordingBlendable();
    runtime.registerBlendable(recorder);
    const seen: EraProgressSnapshot[] = [];
    const unsubscribe = runtime.onProgress((snapshot) => seen.push(snapshot));

    runtime.selectEra('1965');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.transitioning).toBe(true);
    expect(seen[0]!.progress).toBe(0);
    expect(recorder.setEraCalls).toHaveLength(2); // registration sync + selection

    // Selecting the target of the running tween again restarts nothing.
    runtime.selectEra('1965');
    expect(seen).toHaveLength(1);
    expect(recorder.setEraCalls).toHaveLength(2);

    runtime.advance(600);
    expect(seen.at(-1)!.rawProgress).toBeCloseTo(0.5, 8);
    runtime.advance(600);
    expect(seen.at(-1)!.transitioning).toBe(false);
    expect(seen.at(-1)!.progress).toBe(1);

    const count = seen.length;
    unsubscribe();
    runtime.selectEra('2025');
    runtime.advance(1200);
    expect(seen).toHaveLength(count);
  });
});

/* ------------------------------------------------------------------------- *
 * Blendable registration
 * ------------------------------------------------------------------------- */

describe('EraBlendable registration', () => {
  it('tracks, deregisters and stops driving a disposed registration', () => {
    const runtime = createTimelineRuntime({ initialEra: '1945' });
    const first = new RecordingBlendable();
    const second = new RecordingBlendable();
    const handle = runtime.registerBlendable(first, { id: 'first' });
    runtime.registerBlendable(second, { id: 'second' });

    expect(runtime.blendableCount).toBe(2);
    expect(runtime.blendableIds).toEqual(['first', 'second']);
    expect(runtime.hasBlendable('first')).toBe(true);
    expect(handle.id).toBe('first');
    expect(handle.blendable).toBe(first);

    handle.dispose();
    expect(runtime.blendableCount).toBe(1);
    expect(runtime.hasBlendable('first')).toBe(false);
    // Disposing twice is harmless.
    handle.dispose();
    expect(runtime.blendableCount).toBe(1);

    runtime.selectEra('1965');
    runtime.advance(1200);
    expect(first.updates).toHaveLength(1); // registration sync only
    expect(second.updates.length).toBeGreaterThan(1);
    expect(second.blended).toBe(getEraDescriptor('1965'));
  });

  it('rejects duplicate ids, invalid blendables and unregisters by object or id', () => {
    const runtime = createTimelineRuntime();
    const recorder = new RecordingBlendable();
    runtime.registerBlendable(recorder, { id: 'city-block' });

    expect(() => runtime.registerBlendable(new RecordingBlendable(), { id: 'city-block' })).toThrow(
      /already registered/,
    );
    expect(() =>
      runtime.registerBlendable({} as unknown as EraBlendable, { id: 'broken' }),
    ).toThrow(TypeError);

    expect(runtime.unregisterBlendable(recorder)).toBe(true);
    expect(runtime.blendableCount).toBe(0);

    runtime.registerBlendable(recorder, { id: 'again' });
    expect(runtime.unregisterBlendable('again')).toBe(true);
    expect(runtime.unregisterBlendable('missing')).toBe(false);
    expect(runtime.unregisterBlendable(new RecordingBlendable())).toBe(false);
  });

  it('syncs a late registration to the settled era and to a running tween', () => {
    const runtime = createTimelineRuntime({ initialEra: '2025' });

    const settled = new RecordingBlendable();
    runtime.registerBlendable(settled, { id: 'settled' });
    expect(settled.setEraCalls).toEqual([{ era: '2025', options: { immediate: true } }]);
    expect(settled.updates).toHaveLength(1);
    expect(settled.updates[0]!.progress).toBe(1);
    expect(settled.updates[0]!.info).toMatchObject({
      from: '2025',
      to: '2025',
      active: false,
    });

    runtime.selectEra('1945');
    runtime.advance(600);

    const midTween = new RecordingBlendable();
    runtime.registerBlendable(midTween, { id: 'mid-tween' });
    expect(midTween.setEraCalls).toEqual([
      { era: '1945', options: { durationMs: DEFAULT_ERA_TRANSITION_MS } },
    ]);
    expect(midTween.updates).toHaveLength(1);
    expect(midTween.updates[0]!.progress).toBeCloseTo(0.5, 8);
    expect(midTween.updates[0]!.info).toMatchObject({ from: '2025', to: '1945', active: true });

    const quiet = new RecordingBlendable();
    runtime.registerBlendable(quiet, { id: 'quiet', syncOnRegister: false });
    expect(quiet.setEraCalls).toHaveLength(0);
    expect(quiet.updates).toHaveLength(0);
  });

  it('detaches from the context and clears state on dispose', () => {
    const context = createContext();
    const runtime = new TimelineRuntime({ initialEra: '1945', context });
    const recorder = new RecordingBlendable();
    runtime.registerBlendable(recorder, { id: 'city-block' });

    expect(runtime.isAttached).toBe(true);
    expect(context.hasSystem(TIMELINE_SYSTEM_ID)).toBe(true);

    runtime.dispose();
    expect(runtime.isAttached).toBe(false);
    expect(runtime.isDisposed).toBe(true);
    expect(runtime.blendableCount).toBe(0);
    expect(context.hasSystem(TIMELINE_SYSTEM_ID)).toBe(false);
    expect(() => runtime.selectEra('1985')).toThrow(/disposed/);
  });
});

/* ------------------------------------------------------------------------- *
 * Composition with the shared SceneContext
 * ------------------------------------------------------------------------- */

describe('TimelineRuntime composition with SceneContext', () => {
  it('ticks through the system registry and transforms blendables across all five years', () => {
    const context = createContext();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const runtime = new TimelineRuntime({ initialEra: DEFAULT_ERA, context });
    expect(context.systemCount).toBe(1);
    expect(context.getSystems()[0]!.id).toBe(TIMELINE_SYSTEM_ID);
    expect(context.getSystem(TIMELINE_SYSTEM_ID)!.order).toBe(-1000);

    const recorder = new RecordingBlendable();
    runtime.registerBlendable(recorder, { id: 'city-block' });
    expect(recorder.blended).toBe(getEraDescriptor(DEFAULT_ERA));

    const skyPerEra: number[] = [];
    for (const era of ERA_IDS) {
      const before = recorder.updates.length;
      runtime.selectEra(era);

      // Only the shared render loop advances the transition.
      let frames = 0;
      while (runtime.isTransitioning && frames < 60) {
        context.tick(0.1);
        frames += 1;
      }

      expect(runtime.isTransitioning).toBe(false);
      expect(frames).toBeGreaterThanOrEqual(10);
      expect(frames).toBeLessThanOrEqual(20);
      expect(runtime.era).toBe(era);
      expect(runtime.settledEra).toBe(era);

      const eraUpdates = recorder.updates.slice(before);
      expect(eraUpdates.length).toBeGreaterThanOrEqual(10);
      expect(eraUpdates.some((update) => update.progress > 0 && update.progress < 1)).toBe(true);
      expect(eraUpdates.at(-1)!.progress).toBe(1);
      expect(eraUpdates.at(-1)!.info.active).toBe(false);

      const blended = recorder.blended;
      expect(blended).not.toBeNull();
      expect(blended!.palette.sky).toBe(getEraDescriptor(era).palette.sky);
      expect(blended!.fog.far).toBeCloseTo(getEraDescriptor(era).fog.far, 8);
      skyPerEra.push(blended!.palette.sky);
    }

    // Five distinct looks, one per year on the timeline slider.
    expect(new Set(skyPerEra).size).toBe(ERA_IDS.length);
    expect(errorSpy).not.toHaveBeenCalled();

    // A blendable may also join as a SceneContext system; the timeline runs first.
    const observed: number[] = [];
    context.registerSystem('observer', () => observed.push(recorder.last!.progress), { order: 0 });
    runtime.selectEra('1965');
    context.tick(0.1);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBeGreaterThan(0);
    expect(observed[0]).toBeCloseTo(runtime.progress, 10);
    expect(recorder.last!.info.to).toBe('1965');

    runtime.dispose();
    expect(context.hasSystem(TIMELINE_SYSTEM_ID)).toBe(false);
    expect(context.tick(0.1).frame).toBeGreaterThan(0);
    errorSpy.mockRestore();
  });

  it('only advances through the context when attached', () => {
    const context = createContext();
    const runtime = createTimelineRuntime({ initialEra: '1945' });
    runtime.registerBlendable(new RecordingBlendable(), { id: 'city-block' });

    runtime.selectEra('2005');
    for (let step = 0; step < 12; step += 1) context.tick(0.1);
    expect(runtime.isTransitioning).toBe(true);
    expect(runtime.progress).toBe(0);
    expect(runtime.isAttached).toBe(false);
    expect(context.systemCount).toBe(0);

    runtime.attach(context);
    expect(runtime.isAttached).toBe(true);
    for (let step = 0; step < 12; step += 1) context.tick(0.1);
    expect(runtime.isTransitioning).toBe(false);
    expect(runtime.settledEra).toBe('2005');

    runtime.detach();
    expect(runtime.isAttached).toBe(false);
    expect(context.hasSystem(TIMELINE_SYSTEM_ID)).toBe(false);
  });
});
