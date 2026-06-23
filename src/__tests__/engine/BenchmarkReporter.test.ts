/**
 * BenchmarkReporter unit tests.
 *
 * Tests the 10s interval reporting, window.__CITY_BENCHMARK__ shape, history
 * accumulation, stop() cleanup, and SSR guard.
 */
import { BenchmarkReporter, MAX_HISTORY } from '@/engine/BenchmarkReporter';
import type { GameLoop } from '@/engine/GameLoop';
import type { World } from '@/engine/World';
import { EventBus } from '@/systems/EventBus';

/** Minimal GameLoop mock with getFps(). */
function makeGameLoop(fps = 60): GameLoop {
  return { getFps: () => fps } as unknown as GameLoop;
}

/** Minimal World mock with entity arrays. */
function makeWorld(citizens = 10, vehicles = 5, buildings = 3): World {
  return {
    citizens: new Array(citizens),
    vehicles: new Array(vehicles),
    buildings: new Map(new Array(buildings).fill(0).map((_, i) => [String(i), {}])),
  } as unknown as World;
}

describe('BenchmarkReporter', () => {
  let originalWindow: typeof global.window;

  beforeEach(() => {
    originalWindow = global.window;
    // Ensure window exists (jsdom provides it, but be explicit).
    if (typeof global.window === 'undefined') {
      global.window = {} as typeof global.window;
    }
    // Clean any previous benchmark data.
    delete (global.window as unknown as { __CITY_BENCHMARK__?: unknown }).__CITY_BENCHMARK__;
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  it('report() writes a snapshot with the required fields', () => {
    const eventBus = new EventBus();
    const reporter = new BenchmarkReporter({
      gameLoop: makeGameLoop(60),
      world: makeWorld(10, 5, 3),
      eventBus,
    });
    const snap = reporter.report();
    expect(snap).toHaveProperty('fps', 60);
    expect(snap).toHaveProperty('entityCount', 18);
    expect(snap).toHaveProperty('memoryEstimateMB');
    expect(typeof snap.memoryEstimateMB).toBe('number');
    expect(snap).toHaveProperty('eventThroughputPerSec');
    expect(snap).toHaveProperty('timestamp');
    expect(typeof snap.timestamp).toBe('number');
  });

  it('writes to window.__CITY_BENCHMARK__', () => {
    const eventBus = new EventBus();
    const reporter = new BenchmarkReporter({
      gameLoop: makeGameLoop(60),
      world: makeWorld(),
      eventBus,
    });
    reporter.report();
    const bench = (global.window as unknown as { __CITY_BENCHMARK__: { fps: number; history: unknown[] } }).__CITY_BENCHMARK__;
    expect(bench).toBeDefined();
    expect(bench.fps).toBe(60);
    expect(bench.history).toHaveLength(1);
  });

  it('history accumulates snapshots', () => {
    const eventBus = new EventBus();
    const reporter = new BenchmarkReporter({
      gameLoop: makeGameLoop(60),
      world: makeWorld(),
      eventBus,
    });
    reporter.report();
    reporter.report();
    reporter.report();
    const bench = (global.window as unknown as { __CITY_BENCHMARK__: { history: unknown[] } }).__CITY_BENCHMARK__;
    expect(bench.history).toHaveLength(3);
  });

  it('history is capped at MAX_HISTORY (60)', () => {
    const eventBus = new EventBus();
    const reporter = new BenchmarkReporter({
      gameLoop: makeGameLoop(60),
      world: makeWorld(),
      eventBus,
    });
    for (let i = 0; i < MAX_HISTORY + 10; i++) {
      reporter.report();
    }
    const bench = (global.window as unknown as { __CITY_BENCHMARK__: { history: unknown[] } }).__CITY_BENCHMARK__;
    expect(bench.history.length).toBe(MAX_HISTORY);
  });

  it('start() sets up an interval; stop() clears it', () => {
    jest.useFakeTimers();
    const eventBus = new EventBus();
    const reporter = new BenchmarkReporter({
      gameLoop: makeGameLoop(60),
      world: makeWorld(),
      eventBus,
      intervalMs: 1000,
    });
    reporter.start();
    // Advance 3 intervals.
    jest.advanceTimersByTime(3000);
    let bench = (global.window as unknown as { __CITY_BENCHMARK__: { history: unknown[] } }).__CITY_BENCHMARK__;
    expect(bench.history.length).toBe(3);
    // Stop and advance more — no new snapshots.
    reporter.stop();
    jest.advanceTimersByTime(5000);
    bench = (global.window as unknown as { __CITY_BENCHMARK__: { history: unknown[] } }).__CITY_BENCHMARK__;
    expect(bench.history.length).toBe(3);
    jest.useRealTimers();
  });

  it('start() is idempotent (no duplicate intervals)', () => {
    jest.useFakeTimers();
    const eventBus = new EventBus();
    const reporter = new BenchmarkReporter({
      gameLoop: makeGameLoop(60),
      world: makeWorld(),
      eventBus,
      intervalMs: 1000,
    });
    reporter.start();
    reporter.start(); // second call should be a no-op.
    jest.advanceTimersByTime(1000);
    const bench = (global.window as unknown as { __CITY_BENCHMARK__: { history: unknown[] } }).__CITY_BENCHMARK__;
    expect(bench.history.length).toBe(1);
    reporter.stop();
    jest.useRealTimers();
  });

  it('eventThroughputPerSec reflects events emitted since last report', () => {
    const eventBus = new EventBus();
    const reporter = new BenchmarkReporter({
      gameLoop: makeGameLoop(60),
      world: makeWorld(),
      eventBus,
      intervalMs: 10_000,
    });
    // Emit 50 events.
    for (let i = 0; i < 50; i++) {
      eventBus.emit({ type: 'new_day', time: { day: 0, hour: 0, minute: 0, totalMs: 0 }, data: { day: 0 } });
    }
    const snap = reporter.report();
    // 50 events / 10s = 5 events/sec.
    expect(snap.eventThroughputPerSec).toBeCloseTo(5, 5);
    // Counter reset — next report should show 0 throughput.
    const snap2 = reporter.report();
    expect(snap2.eventThroughputPerSec).toBe(0);
  });

  it('memoryEstimateMB falls back to heuristic when performance.memory is unavailable', () => {
    const eventBus = new EventBus();
    const reporter = new BenchmarkReporter({
      gameLoop: makeGameLoop(60),
      world: makeWorld(100, 0, 0),
      eventBus,
    });
    const snap = reporter.report();
    // 100 entities * 2048 bytes / 1MB ≈ 0.195 MB.
    expect(snap.memoryEstimateMB).toBeCloseTo((100 * 2048) / (1024 * 1024), 5);
  });
});
