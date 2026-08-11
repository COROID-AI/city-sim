import { describe, expect, it } from 'vitest';
import { AutoRepeater } from '../src/game/input';
import { ARR_MS, DAS_MS } from '../src/game/constants';

describe('AutoRepeater (DAS/ARR)', () => {
  it('emits nothing before the DAS delay', () => {
    const ar = new AutoRepeater();
    ar.press(0);
    expect(ar.poll(DAS_MS - 1)).toBeNull();
  });

  it('emits exactly one initial step when DAS elapses', () => {
    const ar = new AutoRepeater();
    ar.press(0);
    expect(ar.poll(DAS_MS)).toBe('initial');
    expect(ar.poll(DAS_MS + 1)).toBeNull(); // still waiting for ARR
  });

  it('repeats at every ARR interval after DAS', () => {
    const ar = new AutoRepeater();
    ar.press(0);
    expect(ar.poll(DAS_MS)).toBe('initial');
    expect(ar.poll(DAS_MS + ARR_MS)).toBe('repeat');
    expect(ar.poll(DAS_MS + ARR_MS + 1)).toBeNull();
    expect(ar.poll(DAS_MS + ARR_MS * 2)).toBe('repeat');
  });

  it('honors custom DAS/ARR timings', () => {
    const ar = new AutoRepeater(100, 25);
    ar.press(0);
    expect(ar.poll(99)).toBeNull();
    expect(ar.poll(100)).toBe('initial');
    expect(ar.poll(124)).toBeNull();
    expect(ar.poll(125)).toBe('repeat');
  });

  it('stops emitting on release even if time keeps passing', () => {
    const ar = new AutoRepeater(50, 20);
    ar.press(0);
    ar.poll(50);
    ar.release();
    expect(ar.poll(1000)).toBeNull();
  });

  it('re-pressing restarts the DAS window', () => {
    const ar = new AutoRepeater(100, 20);
    ar.press(0);
    ar.poll(100); // initial emitted
    ar.press(500); // held again after a gap
    expect(ar.poll(560)).toBeNull();
    expect(ar.poll(600)).toBe('initial');
  });
});