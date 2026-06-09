/**
 * Pathfinder perf test: median findPath time on an 80x80 grid must be
 * under 5ms. Environment-sensitive, so we run 20 randomized paths and
 * use the median (not the mean) to dodge GC spikes and warmup noise.
 *
 * Skip guard: set SKIP_PATHFINDER_PERF=1 in CI to opt out.
 */
import { buildRoadGraph, type RoadGrid, type RoadKind } from '@/entities/Road';
import { findPath } from '@/engine/Pathfinder';
import type { Vector2 } from '@/types/common';

function makeOpenGrid(size: number): RoadGrid {
  // Every tile is an intersection -> fully connected grid graph.
  const rows: RoadKind[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: RoadKind[] = [];
    for (let x = 0; x < size; x += 1) {
      row.push('intersection');
    }
    rows.push(row);
  }
  return rows;
}

// Use a tiny seeded PRNG so the perf test is deterministic across runs.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

const skip = process.env.SKIP_PATHFINDER_PERF === '1';
const itFn = skip ? it.skip : it;

describe('Pathfinder perf', () => {
  itFn('median findPath time is under 5ms on an 80x80 grid (20 runs)', () => {
    const SIZE = 80;
    const RUNS = 20;
    const SEED = 0xc17e5e1d;
    const grid = makeOpenGrid(SIZE);
    const graph = buildRoadGraph(grid);
    expect(graph.intersections.size).toBe(SIZE * SIZE);

    const rng = mulberry32(SEED);
    const samples: number[] = [];

    for (let i = 0; i < RUNS; i += 1) {
      const start: Vector2 = { x: Math.floor(rng() * SIZE), y: Math.floor(rng() * SIZE) };
      let goal: Vector2;
      do {
        goal = { x: Math.floor(rng() * SIZE), y: Math.floor(rng() * SIZE) };
      } while (goal.x === start.x && goal.y === start.y);

      const t0 = performance.now();
      const path = findPath(graph, start, goal);
      const t1 = performance.now();
      expect(path).not.toBeNull();
      samples.push(t1 - t0);
    }

    const med = median(samples);
    // 5ms is the spec target. Surface the actual median in the failure
    // message so a CI run that misses it gives us something to work
    // with immediately.
    expect(med).toBeLessThan(5);
  });
});
