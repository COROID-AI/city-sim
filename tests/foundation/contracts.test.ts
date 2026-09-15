/**
 * Foundation contracts suite.
 *
 * Asserts the frozen era vocabulary every downstream task compiles against:
 * the five YearIds and their order, the narrowing helpers, the shape of
 * PeriodDefinition / BuildContext / RoomBounds / Hotspot, and the fact that a
 * stub SceneModule can be built, applied to a year, updated and disposed
 * against a GPU-free kernel without touching contract internals.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_ROOM_BOUNDS,
  DEFAULT_YEAR_ID,
  YEAR_IDS,
  isInsideRoom,
  isPeriodDefinition,
  isSceneModule,
  isYearId,
  nextYearId,
  parseYearId,
  previousYearId,
  roomCenter,
  toYearId,
  yearAt,
  yearIndex,
  yearToNumber,
  type BuildContext,
  type DomainSpecBase,
  type Hotspot,
  type PeriodDefinition,
  type RoomBounds,
  type SceneModule,
  type UpdateContext,
  type YearId,
} from '../../src/contracts/period';
import { createKernel, type Kernel } from '../../src/core/kernel';

const openKernels: Kernel[] = [];

function headlessKernel(): Kernel {
  const kernel = createKernel(null, { forceHeadless: true });
  openKernels.push(kernel);
  return kernel;
}

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
});

/** Contract fixture: a complete era definition for `year`. */
function periodFor(year: YearId): PeriodDefinition {
  return {
    year,
    label: year,
    name: `Test era ${year}`,
    summary: `Contract fixture describing the café in ${year}.`,
    palette: {
      background: '#101010',
      floor: '#202020',
      wall: '#303030',
      ceiling: '#404040',
      accent: '#505050',
      lamp: '#606060',
    },
    lighting: {
      ambientColor: '#111111',
      ambientIntensity: 0.4,
      keyColor: '#222222',
      keyIntensity: 1,
      fillColor: '#333333',
      fillIntensity: 0.3,
      lampColor: '#444444',
      lampIntensity: 10,
      fogDensity: 0,
    },
    details: [`fixture detail for ${year}`],
  };
}

/** Minimal domain module: uses only the frozen contract, no internals. */
class StubDomainModule implements SceneModule<DomainSpecBase> {
  readonly id = 'stub-domain';
  readonly root = new THREE.Group();
  readonly spec: DomainSpecBase;
  readonly appliedYears: YearId[] = [];
  readonly deltas: number[] = [];
  buildCount = 0;
  disposeCount = 0;
  lastFrame: number | null = null;
  hotspots: readonly Hotspot[] = [];

  constructor(spec: DomainSpecBase) {
    this.spec = spec;
    this.hotspots = [
      {
        id: 'stub-hotspot',
        label: 'Stub hotspot',
        position: new THREE.Vector3(0.5, 1, -0.5),
        radius: 0.35,
        year: spec.year,
        moduleId: this.id,
        kind: 'info',
      },
    ];
  }

  build(context: BuildContext): void {
    this.buildCount += 1;
    this.root.name = `${this.id}-${context.year}`;
    context.root.add(this.root);
  }

  applyPeriod(period: PeriodDefinition, _context: BuildContext): void {
    this.appliedYears.push(period.year);
    this.root.name = `${this.id}-${period.year}`;
  }

  update(deltaSeconds: number, context: UpdateContext): void {
    this.deltas.push(deltaSeconds);
    this.lastFrame = context.frame;
  }

  dispose(): void {
    this.disposeCount += 1;
    this.root.removeFromParent();
  }

  getHotspots(): readonly Hotspot[] {
    return this.hotspots;
  }
}

describe('era vocabulary', () => {
  it('declares the five café eras in chronological order', () => {
    expect(YEAR_IDS).toEqual(['1945', '1965', '1985', '2005', '2025']);
    expect(YEAR_IDS).toHaveLength(5);
    expect(DEFAULT_YEAR_ID).toBe('1945');
    expect(YEAR_IDS).toContain(DEFAULT_YEAR_ID);
  });

  it('maps indexes to years and clamps the ends of the timeline', () => {
    expect(YEAR_IDS.map((year) => yearIndex(year))).toEqual([0, 1, 2, 3, 4]);
    expect(yearAt(0)).toBe('1945');
    expect(yearAt(4)).toBe('2025');
    expect(yearAt(-3)).toBe('1945');
    expect(yearAt(99)).toBe('2025');
    expect(nextYearId('1945')).toBe('1965');
    expect(nextYearId('2025')).toBe('2025');
    expect(previousYearId('2025')).toBe('2005');
    expect(previousYearId('1945')).toBe('1945');
    expect(yearToNumber('1985')).toBe(1985);
  });

  it('narrows unknown values to a YearId at runtime', () => {
    for (const year of YEAR_IDS) {
      expect(isYearId(year)).toBe(true);
      expect(parseYearId(year)).toBe(year);
      expect(toYearId(year)).toBe(year);
    }
    expect(isYearId('1955')).toBe(false);
    expect(isYearId(1945)).toBe(false);
    expect(isYearId(null)).toBe(false);
    expect(isYearId(undefined)).toBe(false);
    expect(isYearId({ year: '1945' })).toBe(false);

    expect(parseYearId(1985)).toBe('1985');
    expect(parseYearId('2005')).toBe('2005');
    expect(() => parseYearId('1955')).toThrow(TypeError);
    expect(() => parseYearId(1955)).toThrow(TypeError);
    expect(() => parseYearId(undefined)).toThrow(/not a supported café era/);

    expect(toYearId('1955')).toBe(DEFAULT_YEAR_ID);
    expect(toYearId(2005)).toBe('2005');
    expect(toYearId(null, '2025')).toBe('2025');
  });
});

describe('period, room and hotspot shapes', () => {
  it('accepts a complete period definition and rejects malformed ones', () => {
    const period = periodFor('1965');
    expect(isPeriodDefinition(period)).toBe(true);
    expect(period.palette.background).toBeTypeOf('string');
    expect(period.lighting.lampIntensity).toBeGreaterThan(0);
    expect(period.details.length).toBeGreaterThan(0);

    expect(isPeriodDefinition({ ...period, year: '1955' })).toBe(false);
    expect(isPeriodDefinition({ year: '1965' })).toBe(false);
    expect(isPeriodDefinition(null)).toBe(false);
  });

  it('exposes the room bounds helpers', () => {
    const bounds: RoomBounds = DEFAULT_ROOM_BOUNDS;
    expect(Object.keys(bounds).sort()).toEqual(['depth', 'height', 'width']);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.depth).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(2);
    expect(roomCenter(bounds)).toEqual({ x: 0, y: bounds.height / 2, z: 0 });
    expect(isInsideRoom(bounds, 0, 0)).toBe(true);
    expect(isInsideRoom(bounds, bounds.width, 0)).toBe(false);
    expect(isInsideRoom(bounds, 0, bounds.depth / 2 - 0.1, 0.5)).toBe(false);
  });

  it('exposes the hotspot shape', () => {
    const hotspot: Hotspot = {
      id: 'counter',
      label: 'Counter',
      description: 'Where the espresso machine lives.',
      position: new THREE.Vector3(1, 0.9, -2),
      radius: 0.6,
      year: '1945',
      moduleId: 'furniture',
      kind: 'interactive',
    };
    expect(Object.keys(hotspot).sort()).toEqual([
      'description',
      'id',
      'kind',
      'label',
      'moduleId',
      'position',
      'radius',
      'year',
    ]);
    expect(hotspot.position).toBeInstanceOf(THREE.Vector3);
    expect(hotspot.radius).toBeGreaterThan(0);
    expect(isYearId(hotspot.year)).toBe(true);
  });

  it('builds a kernel context that satisfies BuildContext', () => {
    const kernel = headlessKernel();
    const period = periodFor('2005');
    const context = kernel.createBuildContext(period);

    expect(context.year).toBe('2005');
    expect(context.period).toBe(period);
    expect(context.scene).toBe(kernel.scene);
    expect(context.scene).toBeInstanceOf(THREE.Scene);
    expect(context.root).toBe(kernel.world);
    expect(context.root).toBeInstanceOf(THREE.Object3D);
    expect(context.camera).toBe(kernel.camera);
    expect(context.bounds).toBe(kernel.bounds);
    expect(context.bounds).toEqual(DEFAULT_ROOM_BOUNDS);
    expect(typeof context.random).toBe('function');
    expect(context.services).toBeUndefined();

    const first = kernel.createBuildContext(period);
    const second = kernel.createBuildContext(period);
    const sample = [first.random(), first.random(), first.random()];
    expect(sample).toEqual([second.random(), second.random(), second.random()]);
    expect(sample.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});

describe('SceneModule contract', () => {
  it('keeps the five method surface', () => {
    const module = new StubDomainModule({ year: DEFAULT_YEAR_ID });
    for (const name of ['build', 'applyPeriod', 'update', 'dispose', 'getHotspots']) {
      expect(typeof (module as unknown as Record<string, unknown>)[name]).toBe('function');
    }
    expect(module.id).toBe('stub-domain');
  });

  it('recognises structural module implementations', () => {
    expect(isSceneModule(new StubDomainModule({ year: '1945' }))).toBe(true);
    expect(
      isSceneModule({
        id: 'plain',
        build: () => undefined,
        applyPeriod: () => undefined,
        update: () => undefined,
        dispose: () => undefined,
        getHotspots: () => [],
      }),
    ).toBe(true);
    expect(isSceneModule({ id: 'incomplete' })).toBe(false);
    expect(isSceneModule(null)).toBe(false);
    expect(isSceneModule('stub-domain')).toBe(false);
  });

  it('runs a stub module through build, applyPeriod, update and dispose on a headless kernel', () => {
    const kernel = headlessKernel();
    const module = new StubDomainModule({ year: '1945', tags: ['pre-war'], notes: ['fixture'] });

    const context = kernel.createBuildContext(periodFor('1945'));
    module.build(context);
    expect(module.buildCount).toBe(1);
    expect(context.root.children).toContain(module.root);
    expect(module.root.name).toBe('stub-domain-1945');

    for (const year of YEAR_IDS) {
      const period = periodFor(year);
      kernel.setYear(year);
      module.applyPeriod(period, kernel.createBuildContext(period));
      expect(kernel.year).toBe(year);
    }
    expect(module.appliedYears).toEqual([...YEAR_IDS]);
    expect(module.root.name).toBe('stub-domain-2025');

    const unsubscribe = kernel.onFrame((frame) => {
      module.update(frame.deltaSeconds, {
        year: frame.year,
        elapsedSeconds: frame.elapsedSeconds,
        frame: frame.frame,
      });
    });
    kernel.update(1 / 60);
    kernel.update(1 / 30);
    unsubscribe();
    kernel.update(1 / 60);

    expect(module.deltas).toEqual([1 / 60, 1 / 30]);
    expect(module.lastFrame).toBe(2);

    expect(module.getHotspots()).toHaveLength(1);
    expect(module.getHotspots()[0]?.moduleId).toBe(module.id);

    module.dispose();
    module.dispose();
    expect(module.disposeCount).toBe(2);
    expect(module.root.parent).toBeNull();
  });
});
