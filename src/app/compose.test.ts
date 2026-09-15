// @vitest-environment node
/**
 * Composition proof: the real registry factories, kernel, transition engine,
 * navigation controller, hotspots and audio engine are booted without a DOM or
 * WebGL context. The five slider selections are driven through the composition
 * selection path, not by calling domain modules directly.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createManualFrameScheduler } from '../core/kernel';
import { YEAR_IDS } from '../contracts/period';
import { bootHeadlessCafe, type CafeComposition } from './compose';

const open: CafeComposition[] = [];

afterEach(() => {
  for (const composition of open.splice(0)) composition.dispose();
});

describe('café application composition', () => {
  it('boots every registered domain headlessly, ticks, and disposes cleanly', () => {
    const scheduler = createManualFrameScheduler();
    const composition = bootHeadlessCafe({ scheduler, reducedMotion: true });
    open.push(composition);

    expect(composition.kernel.headless).toBe(true);
    expect(composition.modules).toHaveLength(10);
    expect(composition.sceneModules).toHaveLength(10);
    expect(composition.navigation.attached).toBe(true);
    expect(composition.hotspots.size).toBeGreaterThanOrEqual(6);
    expect(composition.audio.state).toBe('locked');
    expect(composition.transition.isDisposed).toBe(false);

    composition.tick(1 / 60);
    expect(composition.kernel.frame).toBe(1);
    expect(composition.kernel.isRunning).toBe(false);

    for (const module of composition.sceneModules) {
      expect(module.root).toBeDefined();
      expect(module.spec?.year).toBe('1945');
    }

    composition.dispose();
    expect(composition.disposed).toBe(true);
    expect(composition.kernel.isDisposed).toBe(true);
    expect(composition.navigation.attached).toBe(false);
    expect(composition.hotspots.disposed).toBe(true);
    expect(composition.audio.isDisposed).toBe(true);
    expect(composition.transition.isDisposed).toBe(true);
  });

  it('five-year composition drives all eras through the timeline selection path', () => {
    const composition = bootHeadlessCafe({ reducedMotion: true });
    open.push(composition);

    for (const year of YEAR_IDS) {
      composition.selectYear(year);
      expect(composition.year).toBe(year);
      expect(composition.transition.settledYear).toBe(year);
      expect(composition.transition.caption?.year).toBe(year);
      expect(composition.audio.getMixState().year).toBe(year);
      for (const module of composition.sceneModules) {
        expect(module.spec?.year, `${module.id} did not apply ${year}`).toBe(year);
      }
      expect(composition.transition.modules.every((state) => state.reportedYear === year)).toBe(true);
    }
  }, 30000);

  it('re-initializes as one clean runtime after disposal', () => {
    const first = bootHeadlessCafe({ reducedMotion: true });
    open.push(first);
    first.tick();
    const framesBeforeDispose = first.kernel.frame;
    first.dispose();
    expect(first.kernel.listenerCount).toBe(0);

    const second = bootHeadlessCafe({ reducedMotion: true });
    open.push(second);
    second.selectYear('2025');
    second.tick();
    expect(second.kernel.frame).toBe(1);
    expect(second.kernel.frame).not.toBe(framesBeforeDispose + 1);
    expect(second.sceneModules.every((module) => module.spec?.year === '2025')).toBe(true);
  });
});
