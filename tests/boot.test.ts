// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordingContext2D, createRecordingContext } from './helpers/fake-canvas';
import type { CitySimHandle } from '../src/main';

const recordedContexts: RecordingContext2D[] = [];
const originalGetContext = HTMLCanvasElement.prototype.getContext;

/**
 * jsdom has no canvas backend, so serve the recording context instead.
 * The boot contract (auto start, no user interaction) is unaffected.
 */
function installRecordingContexts(): void {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
  ): CanvasRenderingContext2D | null {
    if (type !== '2d') {
      return null;
    }
    const recording = createRecordingContext(this);
    recordedContexts.push(recording);
    return recording.toContext2D();
  } as unknown as HTMLCanvasElement['getContext'];
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

beforeEach(() => {
  // Fresh module registry + empty DOM: each test really does "load the page".
  vi.resetModules();
  document.body.innerHTML = '';
  installRecordingContexts();
});

afterEach(async () => {
  const module = await import('../src/main');
  module.stopCitySimulation();
  recordedContexts.length = 0;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  document.body.innerHTML = '';
  delete window.__citySim;
});

describe('browser boot', () => {
  it('starts the simulation on load without any start button', async () => {
    // Importing the entry module is exactly what the browser does on page load.
    await import('../src/main');

    const handle: CitySimHandle | undefined = window.__citySim;
    expect(handle).toBeDefined();
    const sim = handle as CitySimHandle;

    expect(document.querySelector('button')).toBeNull();
    expect(document.querySelector('#city-canvas')).toBe(sim.canvas);
    expect(document.querySelectorAll('#city-canvas')).toHaveLength(1);
    expect(sim.canvas.isConnected).toBe(true);
    expect(recordedContexts).toHaveLength(1);

    const startedAt = sim.clock.totalMinutes;
    expect(sim.engine.state).toBe('running');
    expect(sim.clock.hourOfDay).toBe(6);

    // No test code drives the engine: the render loop must advance sim time itself.
    const advanced = await waitFor(() => sim.clock.totalMinutes > startedAt, 4000);

    expect(advanced).toBe(true);
    expect(sim.engine.tickCount).toBeGreaterThan(0);
    expect(sim.frames).toBeGreaterThan(0);
    expect(recordedContexts[0].countOf('fillRect')).toBeGreaterThan(0);
    expect(recordedContexts[0].callsFor('fillText').length).toBeGreaterThan(0);
  });

  it('stops the loop and disposes the engine on request', async () => {
    const module = await import('../src/main');

    const sim = window.__citySim as CitySimHandle;
    expect(sim).toBeDefined();
    await waitFor(() => sim.engine.tickCount > 0, 4000);

    module.stopCitySimulation();
    const ticksWhenStopped = sim.engine.tickCount;
    expect(sim.engine.state).toBe('disposed');
    expect(window.__citySim).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(sim.engine.tickCount).toBe(ticksWhenStopped);
  });
});
