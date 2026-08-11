import {
  GRAVITY_DECAY,
  HARD_DROP_SCORE,
  LEVEL_1_GRAVITY_MS,
  LINE_SCORES,
  LINES_PER_LEVEL,
  MIN_GRAVITY_MS,
  SOFT_DROP_SCORE,
  START_LEVEL,
} from './constants';

/** Guideline line-clear scoring, multiplied by the current level. */
export function scoreForLines(lines: number, level: number): number {
  if (lines <= 0) return 0;
  return LINE_SCORES[Math.min(lines, LINE_SCORES.length - 1)] * level;
}

export function softDropScore(rows: number): number {
  return rows * SOFT_DROP_SCORE;
}

export function hardDropScore(rows: number): number {
  return rows * HARD_DROP_SCORE;
}

/** A level-up every 10 lines, starting at level 1. */
export function levelForLines(lines: number): number {
  return START_LEVEL + Math.floor(lines / LINES_PER_LEVEL);
}

/** Gravity speed in ms/row for a level, decaying toward a floor. */
export function gravityMsForLevel(level: number): number {
  return Math.max(MIN_GRAVITY_MS, LEVEL_1_GRAVITY_MS * Math.pow(GRAVITY_DECAY, level - 1));
}