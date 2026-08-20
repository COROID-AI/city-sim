import { describe, it, expect } from 'vitest';
import { lerpTimePeriods, getInterpolationWindow, ERA_COUNT, TIME_PERIODS } from './timePeriods';

describe('timePeriods', () => {
  it('has exactly six eras ending at 2050', () => {
    expect(ERA_COUNT).toBe(6);
    expect(TIME_PERIODS[0]?.shortLabel).toBe('1900');
    expect(TIME_PERIODS[5]?.shortLabel).toBe('2050');
  });

  it('getInterpolationWindow returns endpoints at 0 and ERA_COUNT-1', () => {
    const start = getInterpolationWindow(0);
    expect(start.t).toBe(0);
    expect(start.from.shortLabel).toBe('1900');
    expect(start.to.shortLabel).toBe('1920');

    const end = getInterpolationWindow(ERA_COUNT - 1);
    expect(end.from.shortLabel).toBe('2010');
    expect(end.to.shortLabel).toBe('2050');
    expect(end.t).toBe(1);
  });

  it('lerps numeric fields between adjacent eras', () => {
    const from = TIME_PERIODS[0]!;
    const to = TIME_PERIODS[1]!;
    const mid = lerpTimePeriods(from, to, 0.5);
    expect(mid.year).toBe(1910);
    expect(mid.scale[1]).toBeCloseTo((from.scale[1] + to.scale[1]) / 2, 5);
    expect(mid.lampDensity).toBeCloseTo((from.lampDensity + to.lampDensity) / 2, 5);
  });

  it('lerps colors to valid hex strings', () => {
    const from = TIME_PERIODS[0]!;
    const to = TIME_PERIODS[1]!;
    const mid = lerpTimePeriods(from, to, 0.5);
    expect(mid.palette.sky).toMatch(/^#[0-9a-f]{6}$/i);
    expect(mid.palette.sky).not.toBe(from.palette.sky);
    expect(mid.palette.sky).not.toBe(to.palette.sky);
  });

  it('clamps t outside [0,1]', () => {
    const from = TIME_PERIODS[1]!;
    const to = TIME_PERIODS[2]!;
    expect(lerpTimePeriods(from, to, -5).year).toBe(from.year);
    expect(lerpTimePeriods(from, to, 9).year).toBe(to.year);
  });
});