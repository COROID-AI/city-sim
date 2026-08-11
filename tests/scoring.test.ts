import { describe, expect, it } from 'vitest';
import {
  gravityMsForLevel,
  hardDropScore,
  levelForLines,
  scoreForLines,
  softDropScore,
} from '../src/game/scoring';

describe('scoring', () => {
  it('applies Guideline line scores multiplied by level', () => {
    expect(scoreForLines(0, 1)).toBe(0);
    expect(scoreForLines(1, 1)).toBe(100);
    expect(scoreForLines(2, 1)).toBe(300);
    expect(scoreForLines(3, 1)).toBe(500);
    expect(scoreForLines(4, 1)).toBe(800);
    expect(scoreForLines(2, 3)).toBe(900);
    expect(scoreForLines(4, 2)).toBe(1600);
  });

  it('caps line scores beyond a tetris (back-to-back handled by caller caps)', () => {
    expect(scoreForLines(5, 1)).toBe(800);
  });

  it('scores drops by rows', () => {
    expect(softDropScore(3)).toBe(3);
    expect(hardDropScore(5)).toBe(10);
    expect(hardDropScore(0)).toBe(0);
  });

  it('levels up every 10 lines starting at level 1', () => {
    expect(levelForLines(0)).toBe(1);
    expect(levelForLines(9)).toBe(1);
    expect(levelForLines(10)).toBe(2);
    expect(levelForLines(25)).toBe(3);
  });

  it('gravity decays with level and floors at the minimum', () => {
    expect(gravityMsForLevel(1)).toBe(1000);
    expect(gravityMsForLevel(2)).toBeCloseTo(850);
    expect(gravityMsForLevel(10)).toBeLessThan(gravityMsForLevel(2));
    expect(gravityMsForLevel(50)).toBe(40);
  });
});