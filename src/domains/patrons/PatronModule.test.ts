/**
 * Patron domain contract and inventory suite.
 *
 * These tests deliberately drive the real SceneModule surface in a headless
 * kernel. They do not inspect registration counters: the observable contract
 * is the populated scene graph, its era inventory, transforms, hotspots and
 * cleanup behaviour.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  YEAR_IDS,
  type PeriodDefinition,
  type YearId,
} from '../../contracts/period';
import { createKernel, type Kernel } from '../../core/kernel';
import {
  CAFE_ROOM_BOUNDS,
  createEnvironmentModule,
  environmentSpec,
} from '../environment';
import {
  PATRON_SPECS,
  createPatronModule,
  patronSpec,
  type PatronModule,
} from './PatronModule';
import {
  gadgetChronologyConflicts,
  type GadgetId,
} from './figures/GadgetProps';
import { placementConflicts } from './placement/placement';

const openKernels: Kernel[] = [];

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

function setup(options: { seed?: number; services?: Readonly<Record<string, unknown>> } = {}): {
  kernel: Kernel;
  module: PatronModule;
} {
  const kernel = createKernel(null, {
    forceHeadless: true,
    bounds: CAFE_ROOM_BOUNDS,
    autoResize: false,
    seed: options.seed ?? 0x1945,
  });
  openKernels.push(kernel);
  const module = createPatronModule({ seed: options.seed ?? 0x1945 });
  const context = kernel.createBuildContext(periodFor('1945'), { services: options.services });
  module.build(context);
  return { kernel, module };
}

function buildWithYear(module: PatronModule, kernel: Kernel, year: YearId, services?: Readonly<Record<string, unknown>>): void {
  const context = kernel.createBuildContext(periodFor(year), { services });
  if (module.spec) module.applyPeriod(periodFor(year), context);
  else module.build(context);
}

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
});

describe('era inventory', () => {
  it('exports one distinct, chronology-valid figure set for every selectable year', () => {
    expect(Object.keys(PATRON_SPECS).sort()).toEqual([...YEAR_IDS].sort());
    const signatures = new Set<string>();

    for (const year of YEAR_IDS) {
      const spec = patronSpec(year);
      const baristas = spec.figures.filter((figure) => figure.role === 'barista');
      expect(baristas).toHaveLength(1);
      expect(baristas[0]?.zone).toBe('counter');
      expect(spec.figures.some((figure) => figure.pose === 'seated')).toBe(true);
      expect(spec.figures.some((figure) => figure.pose === 'standing')).toBe(true);
      expect(spec.density).toBeGreaterThan(0);
      expect(spec.density).toBeLessThanOrEqual(1);

      const gadgetIds = spec.figures.flatMap((figure) => figure.gadgets) as GadgetId[];
      expect(gadgetChronologyConflicts(year, gadgetIds)).toEqual([]);
      signatures.add(`${year}:${spec.tags.join(',')}:${gadgetIds.join(',')}`);
    }
    expect(signatures).toHaveLength(5);

    const oldProps = patronSpec('1945').figures.flatMap((figure) => figure.gadgets);
    expect(oldProps).not.toContain('walkman');
    expect(oldProps).not.toContain('flip-phone');
    expect(oldProps).not.toContain('smartphone');
    expect(patronSpec('1985').figures.flatMap((figure) => figure.gadgets)).toEqual(
      expect.arrayContaining(['walkman', 'shoulder-bag']),
    );
    expect(patronSpec('2005').figures.flatMap((figure) => figure.gadgets)).toEqual(
      expect.arrayContaining(['flip-phone', 'mp3-player', 'laptop']),
    );
    expect(patronSpec('2025').figures.flatMap((figure) => figure.gadgets)).toEqual(
      expect.arrayContaining(['smartphone', 'headphones', 'laptop', 'reusable-cup']),
    );
  });
});

describe('SceneModule behaviour', () => {
  it('builds, applies all five eras, updates deterministic idle motion and disposes', () => {
    const first = setup({ seed: 0x5eed });
    const second = setup({ seed: 0x5eed });
    expect(first.module.figures).toHaveLength(5);
    expect(first.module.getHotspots()).toHaveLength(3);
    expect(first.module.placementConflicts()).toEqual([]);

    const initial = first.module.transforms().map((transform) => `${transform.id}:${transform.phase.toFixed(8)}`);
    first.module.update(0.25, { year: '1945', elapsedSeconds: 0.25, frame: 1 });
    const moved = first.module.transforms().map((transform) => `${transform.id}:${transform.phase.toFixed(8)}`);
    expect(moved).not.toEqual(initial);

    second.module.update(0.25, { year: '1945', elapsedSeconds: 0.25, frame: 1 });
    expect(second.module.transforms().map((transform) => `${transform.id}:${transform.phase.toFixed(8)}`)).toEqual(moved);

    for (const year of YEAR_IDS.slice(1)) {
      first.kernel.setYear(year);
      buildWithYear(first.module, first.kernel, year);
      expect(first.module.spec?.year).toBe(year);
      expect(first.module.getHotspots().map((hotspot) => hotspot.year)).toEqual([year, year, year]);
      expect(first.module.figures.filter((figure) => figure.role === 'barista')).toHaveLength(1);
    }

    const beforeDispose = first.module.transforms();
    first.module.dispose();
    first.module.update(10, { year: '2025', elapsedSeconds: 10, frame: 10 });
    expect(first.module.transforms()).toEqual([]);
    expect(first.module.getHotspots()).toEqual([]);
    expect(beforeDispose.length).toBeGreaterThan(0);
  });
});

describe('placement and density', () => {
  it('is deterministic, bounded and clear of the environment counter and lane', () => {
    const a = setup({ seed: 12345 });
    const b = setup({ seed: 12345 });
    expect(a.module.placementPlan?.signatures).toEqual(b.module.placementPlan?.signatures);
    expect(a.module.placementPlan?.placed.every((entry) =>
      entry.position.x >= -CAFE_ROOM_BOUNDS.width / 2 && entry.position.x <= CAFE_ROOM_BOUNDS.width / 2 &&
      entry.position.z >= -CAFE_ROOM_BOUNDS.depth / 2 && entry.position.z <= CAFE_ROOM_BOUNDS.depth / 2,
    )).toBe(true);
    expect(a.module.placementPlan).toBeDefined();
    const plan = a.module.placementPlan;
    if (!plan) throw new Error('placement plan missing');
    const layout = a.module.layout;
    if (!layout) throw new Error('layout missing');
    expect(placementConflicts(plan, layout)).toEqual([]);
    expect(plan.seated).toBeGreaterThan(0);
    expect(plan.standing).toBeGreaterThan(0);
  });

  it('publishes density without unlocking or starting an audio engine', () => {
    const calls: number[] = [];
    const audio = {
      setAmbienceIntensity(value: number): void { calls.push(value); },
    };
    const { module } = setup({ services: { audioEngine: audio } });
    expect(calls).toEqual([patronSpec('1945').density]);
    expect(module.density).toBe(patronSpec('1945').density);
    expect(module.patronCount).toBe(4);
  });
});

describe('composition', () => {
  it('composes the real environment module and leaves no scene children after disposal', () => {
    const kernel = createKernel(null, {
      forceHeadless: true,
      bounds: CAFE_ROOM_BOUNDS,
      autoResize: false,
      seed: 0x44,
    });
    openKernels.push(kernel);
    const environment = createEnvironmentModule();
    const patrons = createPatronModule({ seed: 0x44 });
    const firstContext = kernel.createBuildContext(periodFor('1945'), {
      services: { environmentModule: environment },
    });
    environment.build(firstContext);
    patrons.build(firstContext);
    expect(kernel.world.children).toHaveLength(2);

    for (const year of YEAR_IDS) {
      kernel.setYear(year);
      const context = kernel.createBuildContext(periodFor(year), {
        services: { environmentModule: environment },
      });
      if (year === '1945') {
        environment.applyPeriod(periodFor(year), context);
        patrons.applyPeriod(periodFor(year), context);
      } else {
        environment.applyPeriod(periodFor(year), context);
        patrons.applyPeriod(periodFor(year), context);
      }
      environment.update(0.1, { year, elapsedSeconds: 0.1, frame: 1 });
      patrons.update(0.1, { year, elapsedSeconds: 0.1, frame: 1 });
    }
    patrons.dispose();
    environment.dispose();
    expect(kernel.world.children).toHaveLength(0);
    expect(kernel.scene.children).toContain(kernel.world);
    kernel.dispose();
  });

  it('exposes real Object3D hotspot anchors for close inspection', () => {
    const { module } = setup();
    for (const hotspot of module.getHotspots()) {
      expect(hotspot.anchor).toBeInstanceOf(THREE.Object3D);
      expect(Number.isFinite(hotspot.position.x)).toBe(true);
      expect(hotspot.position.y).toBeGreaterThan(0);
      expect(hotspot.description).toBeTruthy();
    }
  });
});
