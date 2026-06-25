/**
 * BenchmarkReporter — periodic performance snapshot writer (spec §8).
 *
 * Every 10 seconds, collects a performance snapshot and writes it to
 * `window.__CITY_BENCHMARK__` (latest) plus `.history[]` (capped at 60 entries
 * = 10 minutes at a 10s interval).
 *
 * DESIGN (see plan notes):
 *  - Uses setInterval(10000) — simple and reliable.
 *  - Memory: feature-detect `performance.memory` (Chrome-only); fall back to a
 *    heuristic estimate (entityCount * ~2KB) when unavailable.
 *  - Event throughput: EventBus.getAndResetEventCount() returns the cumulative
 *    count since the last reset, divided by the interval for per-second rate.
 *  - SSR-safe: all `window`/`performance` access is guarded.
 */
import type { EventBus } from '@/systems/EventBus';
import type { GameLoop } from '@/engine/GameLoop';
import type { World } from '@/engine/World';

/** Reporting interval in milliseconds (spec §8: 10s). */
export const REPORT_INTERVAL_MS = 10_000;

/** Maximum number of historical snapshots retained (10 min @ 10s). */
export const MAX_HISTORY = 60;

/** Heuristic bytes-per-entity when performance.memory is unavailable. */
const ESTIMATED_BYTES_PER_ENTITY = 2048;

/** A single performance snapshot. */
export interface BenchmarkSnapshot {
  /** Frames per second (1-second sliding window from GameLoop). */
  fps: number;
  /** Total entity count (citizens + vehicles + buildings). */
  entityCount: number;
  /** Estimated JS heap usage in MB (Chrome-only; heuristic elsewhere). */
  memoryEstimateMB: number;
  /** Events processed per second over the last interval. */
  eventThroughputPerSec: number;
  /** Epoch timestamp (ms) of the snapshot. */
  timestamp: number;
}

/** The shape written to `window.__CITY_BENCHMARK__`. */
export interface CityBenchmark {
  /** Latest snapshot. */
 [key: string]: unknown;
  /** Rolling history of the last 60 snapshots (oldest first). */
  history: BenchmarkSnapshot[];
}

declare global {
  interface Window {
    __CITY_BENCHMARK__?: CityBenchmark;
  }
}

export interface BenchmarkReporterOptions {
  /** GameLoop providing getFps(). */
  gameLoop: GameLoop;
  /** World providing entity counts. */
  world: World;
  /** EventBus providing getAndResetEventCount(). */
  eventBus: EventBus;
  /** Override interval (ms); defaults to 10s. Test-only. */
  intervalMs?: number;
}

export class BenchmarkReporter {
  private readonly gameLoop: GameLoop;
  private readonly world: World;
  private readonly eventBus: EventBus;
  private readonly intervalMs: number;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(options: BenchmarkReporterOptions) {
    this.gameLoop = options.gameLoop;
    this.world = options.world;
    this.eventBus = options.eventBus;
    this.intervalMs = options.intervalMs ?? REPORT_INTERVAL_MS;
  }

  /**
   * Begin periodic reporting. Idempotent — safe to call twice.
   * SSR guard: no-op if `window` is undefined (Node).
   */
  start(): void {
    if (typeof window === 'undefined') return;
    if (this.timerId !== null) return;
    // Initialize the global object so history accumulates from the start.
    if (!window.__CITY_BENCHMARK__) {
      window.__CITY_BENCHMARK__ = { history: [] };
    }
    this.timerId = setInterval(() => this.report(), this.intervalMs);
  }

  /** Stop periodic reporting and clear the timer. */
  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Collect a single snapshot and write it to `window.__CITY_BENCHMARK__`.
   * Exposed for unit testing without waiting for the interval.
   */
  report(): BenchmarkSnapshot {
    const snapshot = this.collect();
    if (typeof window !== 'undefined') {
      const bench = window.__CITY_BENCHMARK__ ?? { history: [] };
      // Copy scalar fields onto the top-level object (latest snapshot).
      Object.assign(bench, snapshot);
      bench.history.push(snapshot);
      // Cap history at MAX_HISTORY entries (drop oldest).
      if (bench.history.length > MAX_HISTORY) {
        bench.history.splice(0, bench.history.length - MAX_HISTORY);
      }
      window.__CITY_BENCHMARK__ = bench;
    }
    return snapshot;
  }

  /**
   * Gather a snapshot from the engine + environment.
   */
  private collect(): BenchmarkSnapshot {
    const fps = this.gameLoop.getFps();
    const entityCount = this.countEntities();
    const memoryEstimateMB = this.estimateMemoryMB(entityCount);
    // getAndResetEventCount() returns cumulative count since last reset.
    const events = this.eventBus.getAndResetEventCount();
    const eventThroughputPerSec = events / (this.intervalMs / 1000);
    const timestamp = Date.now();
    return {
      fps,
      entityCount,
      memoryEstimateMB,
      eventThroughputPerSec,
      timestamp,
    };
  }

  /** Total entity count across all actor types. */
  private countEntities(): number {
    return (
      this.world.citizens.length +
      this.world.vehicles.length +
      this.world.buildings.size
    );
  }

  /**
   * Estimate JS heap usage in MB. Uses `performance.memory` when available
   * (Chrome); otherwise falls back to a heuristic (entityCount * ~2KB).
   */
  private estimateMemoryMB(entityCount: number): number {
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    if (typeof perf !== 'undefined' && perf.memory) {
      return perf.memory.usedJSHeapSize / (1024 * 1024);
    }
    return (entityCount * ESTIMATED_BYTES_PER_ENTITY) / (1024 * 1024);
  }
}
