// Shared, DOM-free game constants.
// This module must never reference browser/DOM APIs so node:test can load it.

export const COLS = 10;
export const ROWS = 20;

// Distinct color per tetromino type (guideline-inspired palette).
export const PIECE_COLORS = Object.freeze({
  I: '#00d4ff',
  O: '#ffd23f',
  T: '#c77dff',
  S: '#4ade80',
  Z: '#ff5c6c',
  J: '#4d9fff',
  L: '#ffa94d',
});

export const PIECE_TYPES = Object.freeze(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);

// Guideline line-clear scores indexed by cleared-line count, multiplied by level.
export const LINE_SCORES = Object.freeze([0, 100, 300, 500, 800]);

export const SOFT_DROP_SCORE = 1; // per cell
export const HARD_DROP_SCORE = 2; // per cell

export const LINES_PER_LEVEL = 10;

// Gravity in milliseconds per row; decreases with level so speed visibly ramps.
export function gravityMs(level) {
  const safe = Math.max(1, level);
  return Math.max(80, Math.round(1000 * (0.8 - (safe - 1) * 0.007) ** (safe - 1)));
}

export const NEXT_PREVIEW_COUNT = 3;