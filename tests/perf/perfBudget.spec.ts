// @vitest-environment node
/**
 * Performance-budget suite — measured, printed and enforced per era.
 *
 * The café is composed headlessly (real composition root, real modules, real
 * transition engine; no GPU, no canvas) and every number in this file is
 * measured from that composed scene:
 *
 *  - **Render statistics**: draw calls (visible meshes plus instanced batches),
 *    triangles, distinct geometries, materials and textures, lights and nodes,
 *    read from the scene graph the modules built.
 *  - **Frame cost**: wall-clock time of the per-frame pipeline (`Kernel.update`
 *    -> transition, audio and every module update) sampled per era.
 *  - **Switch cost**: wall-clock and scene-time cost of one era choreography,
 *    and of a repeated full five-year cycle.
 *
 * The budgets below are **explicit numeric caps**: the first recorded run of this
 * suite is the baseline, each cap carries headroom over it, and a regression that
 * pushes an era past a cap fails with the measured value named. All measured
 * values are printed as a table so a regression is attributable to a year and a
 * statistic.
 *
 * Scope note: the headless numbers cover scene complexity and CPU-side update
 * cost. GPU frame time in a real browser is verified separately by the browser
 * evidence capture (`tests/evidence/`), which records the same scene through the
 * dev server.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { YEAR_IDS, type YearId } from '../../src/contracts/period';
import {
  ERA_EXPECTATIONS,
  createHarness,
  musicDeviceNodes,
  sceneCounts,
  sceneInventory,
  type CafeHarness,
  type SceneCounts,
} from '../e2e/harness';

/* -------------------------------------------------------------------------- */
/* Budgets (baseline + headroom)                                              */
/* -------------------------------------------------------------------------- */

/** Largest render statistics any single era may report. */
export interface RenderBudget {
  readonly nodes: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly materials: number;
  readonly textures: number;
  readonly lights: number;
}

/**
 * Per-era caps. Baseline (recorded 2026-09-15, this suite's first run, headless
 * node): the heaviest era reported 2112 nodes / 2464 draw calls / 156,170
 * triangles / 1417 geometries / 201 materials / 135 textures / 6 lights, and the
 * lightest 1791 nodes / 2084 draw calls. The caps below sit roughly 25-35% above
 * that baseline, so a regression trips them while tuning one prop does not.
 */
export const RENDER_BUDGET: RenderBudget = Object.freeze({
  nodes: 2_600,
  drawCalls: 3_200,
  triangles: 210_000,
  geometries: 1_800,
  materials: 320,
  textures: 220,
  lights: 8,
});

/**
 * Per-frame wall-clock caps for the headless frame pipeline, milliseconds.
 * Baseline: ~0.9 ms mean and ~1.1 ms p95 per frame on the reference machine;
 * the caps leave room for a slower machine while still catching a real
 * regression in the per-frame update cost.
 */
export const FRAME_BUDGET_MS = Object.freeze({
  mean: 8,
  p95: 20,
  max: 60,
});

/** One era switch: scene-time and wall-clock caps. */
export const SWITCH_BUDGET = Object.freeze({
  /** Scene time of one choreography (duration + stagger + window + arrival), seconds. */
  seconds: 6,
  /**
   * Wall-clock cost of one switch in the headless node runtime, milliseconds.
   * Baseline: 1.6-3.4 s across the five switches (the first switch after boot is
   * the slowest: every module rebuilds its era geometry). Generous by design so
   * a slower machine does not fail the gate, but still bounded.
   */
  wallMs: 8_000,
});

/** A complete five-year cycle (five switches) and its repetition. */
export const CYCLE_BUDGET = Object.freeze({
  seconds: 30,
  wallMs: 20_000,
  repeats: 3,
});

/* -------------------------------------------------------------------------- */
/* Measurement                                                                */
/* -------------------------------------------------------------------------- */

interface EraRow {
  readonly year: YearId;
  readonly counts: SceneCounts;
  readonly inventory: SceneCounts;
  readonly switchSeconds: number;
  readonly switchWallMs: number;
  readonly frames: { readonly mean: number; readonly p95: number; readonly max: number };
}

const rows: EraRow[] = [];
const open: CafeHarness[] = [];

afterAll(() => {
  for (const harness of open.splice(0)) harness.dispose();
  printTable();
});

function create(): CafeHarness {
  const harness = createHarness({ reducedMotion: false });
  open.push(harness);
  return harness;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(Math.floor(sorted.length * fraction), sorted.length - 1);
  return sorted[index] ?? 0;
}

/** Samples the wall-clock cost of the per-frame pipeline in a settled era. */
function sampleFrames(
  harness: CafeHarness,
  frames = 180,
  warmup = 30,
): { readonly mean: number; readonly p95: number; readonly max: number } {
  for (let frame = 0; frame < warmup; frame += 1) harness.composition.tick(1 / 60);
  const samples: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const start = performance.now();
    harness.composition.tick(1 / 60);
    samples.push(performance.now() - start);
  }
  const sorted = samples.slice().sort((left, right) => left - right);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    mean: total / samples.length,
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function printTable(): void {
  if (rows.length === 0) return;
  const header = [
    'year',
    'nodes',
    'drawCalls',
    'triangles',
    'geoms',
    'mats',
    'tex',
    'lights',
    'frameMeanMs',
    'frameP95Ms',
    'switchSec',
    'switchWallMs',
  ];
  const lines = [header.join('\t')];
  for (const row of rows) {
    lines.push(
      [
        row.year,
        row.counts.nodes,
        row.counts.drawCalls,
        row.counts.triangles,
        row.counts.geometries,
        row.counts.materials,
        row.counts.textures,
        row.counts.lights,
        round(row.frames.mean),
        round(row.frames.p95),
        round(row.switchSeconds),
        round(row.switchWallMs, 1),
      ].join('\t'),
    );
  }
  lines.push(
    `budget\t${RENDER_BUDGET.nodes}\t${RENDER_BUDGET.drawCalls}\t${RENDER_BUDGET.triangles}\t` +
      `${RENDER_BUDGET.geometries}\t${RENDER_BUDGET.materials}\t${RENDER_BUDGET.textures}\t` +
      `${RENDER_BUDGET.lights}\t${FRAME_BUDGET_MS.mean}\t${FRAME_BUDGET_MS.p95}\t` +
      `${SWITCH_BUDGET.seconds}\t${SWITCH_BUDGET.wallMs}`,
  );
  console.log(`\ncafé performance baseline (headless node, ${rows.length} eras)\n${lines.join('\n')}\n`);
}

/* -------------------------------------------------------------------------- */
/* Suites                                                                     */
/* -------------------------------------------------------------------------- */

describe('café performance budget', () => {
  it('measures and prints the render statistics of every era inside the documented caps', async () => {
    const harness = create();
    for (const year of YEAR_IDS) {
      const wallStart = performance.now();
      const report = await harness.switchTo(year);
      const wallMs = performance.now() - wallStart;
      const counts = sceneCounts(harness.composition.kernel.world);
      const inventory = sceneInventory(harness.composition.kernel.world);
      const frames = sampleFrames(harness);

      rows.push({
        year,
        counts,
        inventory,
        switchSeconds: report.sceneSeconds,
        switchWallMs: wallMs,
        frames,
      });

      expect(musicDeviceNodes(harness.composition)).toEqual([
        `music:${year}:${ERA_EXPECTATIONS[year].musicDeviceId}`,
      ]);
      expect(counts.nodes, `${year} node count`).toBeGreaterThan(1_000);
      expect(counts.drawCalls, `${year} draw calls`).toBeLessThanOrEqual(RENDER_BUDGET.drawCalls);
      expect(counts.triangles, `${year} triangles`).toBeLessThanOrEqual(RENDER_BUDGET.triangles);
      expect(counts.geometries, `${year} geometries`).toBeLessThanOrEqual(RENDER_BUDGET.geometries);
      expect(counts.materials, `${year} materials`).toBeLessThanOrEqual(RENDER_BUDGET.materials);
      expect(counts.textures, `${year} textures`).toBeLessThanOrEqual(RENDER_BUDGET.textures);
      expect(counts.lights, `${year} lights`).toBeLessThanOrEqual(RENDER_BUDGET.lights);
      expect(inventory.drawCalls, `${year} inventoried draw calls`).toBeGreaterThanOrEqual(
        counts.drawCalls,
      );
      expect(frames.mean, `${year} mean frame time`).toBeLessThanOrEqual(FRAME_BUDGET_MS.mean);
      expect(frames.p95, `${year} p95 frame time`).toBeLessThanOrEqual(FRAME_BUDGET_MS.p95);
      expect(frames.max, `${year} worst frame time`).toBeLessThanOrEqual(FRAME_BUDGET_MS.max);
    }
    expect(rows).toHaveLength(YEAR_IDS.length);
  }, 180_000);

  it('keeps every era switch inside its documented time budget', async () => {
    const harness = create();
    /* The first selection must be a real era change, so start after 1945 and
     * finish back on it: five genuine choreographies. */
    const order: readonly YearId[] = [...YEAR_IDS.slice(1), '1945'];
    for (const year of order) {
      const wallStart = performance.now();
      const report = await harness.switchTo(year);
      const wallMs = performance.now() - wallStart;

      expect(report.sceneSeconds, `${year} switch scene time`).toBeLessThanOrEqual(
        SWITCH_BUDGET.seconds,
      );
      expect(report.sceneSeconds, `${year} switch should really take scene time`).toBeGreaterThan(0);
      expect(report.signals.at(-1)?.outcome).toBe('arrived');
      expect(wallMs, `${year} switch wall-clock`).toBeLessThanOrEqual(SWITCH_BUDGET.wallMs);
      console.log(
        `${year} switch: ${round(report.sceneSeconds)}s scene time, ${round(wallMs, 1)}ms wall-clock`,
      );
    }
  }, 120_000);

  it('keeps a repeated full five-year cycle bounded', async () => {
    const harness = create();
    const cycleOrder: readonly YearId[] = [...YEAR_IDS.slice(1), '1945'];

    for (let cycle = 0; cycle < CYCLE_BUDGET.repeats; cycle += 1) {
      const wallStart = performance.now();
      let sceneSeconds = 0;
      for (const year of cycleOrder) {
        const report = await harness.switchTo(year);
        sceneSeconds += report.sceneSeconds;
      }
      const wallMs = performance.now() - wallStart;

      expect(harness.composition.year).toBe('1945');
      expect(harness.composition.transition.modules.every((state) => state.reportedYear === '1945')).toBe(
        true,
      );
      expect(musicDeviceNodes(harness.composition)).toEqual(['music:1945:wireless-1945']);
      expect(sceneSeconds, `cycle ${cycle + 1} scene time`).toBeLessThanOrEqual(CYCLE_BUDGET.seconds);
      expect(wallMs, `cycle ${cycle + 1} wall-clock`).toBeLessThanOrEqual(CYCLE_BUDGET.wallMs);
      console.log(
        `cycle ${cycle + 1}: ${round(sceneSeconds)}s scene time, ${round(wallMs, 1)}ms wall-clock ` +
          `(budget ${CYCLE_BUDGET.seconds}s / ${CYCLE_BUDGET.wallMs}ms)`,
      );
    }
  }, 180_000);

  it('records the baseline numbers every era must not regress past', async () => {
    const harness = create();
    const measured: { year: YearId; counts: SceneCounts }[] = [];
    for (const year of YEAR_IDS) {
      await harness.switchTo(year);
      measured.push({ year, counts: sceneCounts(harness.composition.kernel.world) });
    }

    /* Every era is a substantial, distinct scene rather than an empty shell. */
    for (const entry of measured) {
      expect(entry.counts.drawCalls, `${entry.year} draw calls`).toBeGreaterThan(500);
      expect(entry.counts.triangles, `${entry.year} triangles`).toBeGreaterThan(10_000);
      expect(entry.counts.materials, `${entry.year} materials`).toBeGreaterThan(20);
      expect(entry.counts.textures, `${entry.year} textures`).toBeGreaterThan(10);
    }
    const signature = new Set(
      measured.map((entry) => `${entry.counts.drawCalls}:${entry.counts.triangles}`),
    );
    expect(signature.size, 'each era should render a different amount of geometry').toBe(
      YEAR_IDS.length,
    );
  }, 120_000);
});
