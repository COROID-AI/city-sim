import type { TetrominoType } from './types';

/**
 * Single source of truth for dimensions, colors, scoring, gravity timing,
 * DAS/ARR input and lock-delay rules.
 */

export const BOARD_COLS = 10;
/** Total board rows, including hidden rows above the visible field. */
export const BOARD_ROWS = 24;
export const VISIBLE_ROWS = 20;
/** Rows hidden above the visible field where pieces spawn/lock out. */
export const HIDDEN_ROWS = BOARD_ROWS - VISIBLE_ROWS; // 4
export const FIRST_VISIBLE_ROW = HIDDEN_ROWS;

export const NEXT_PIECES_VISIBLE = 3;
/** Keep at least this many pieces in the upcoming queue. */
export const QUEUE_KEEP_ALIVE = 5;

/**
 * Guideline scoring: single/double/triple/tetris, multiplied by level.
 * Indexed by cleared-line count.
 */
export const LINE_SCORES = [0, 100, 300, 500, 800] as const;
export const SOFT_DROP_SCORE = 1;
export const HARD_DROP_SCORE = 2;
export const LINES_PER_LEVEL = 10;
export const START_LEVEL = 1;

/** Milliseconds per row at level 1, and the per-level decay factor. */
export const LEVEL_1_GRAVITY_MS = 1000;
export const GRAVITY_DECAY = 0.85;
export const MIN_GRAVITY_MS = 40;

/* Input feel (Guideline-ish). */
export const DAS_MS = 170; // delayed auto shift
export const ARR_MS = 50; // auto repeat rate
export const SOFT_DROP_REPEAT_MS = 40;

/* Lock delay. */
export const LOCK_DELAY_MS = 500;
/** Maximum lock-delay resets per grounding (prevents infinite stalling). */
export const LOCK_DELAY_RESET_CAP = 15;
export const LINE_CLEAR_FLASH_MS = 220;

/**
 * Canonical Guideline palette, tuned for the dark cohesive world.
 * Each tetromino carries base/light/dark shades used to bevel blocks
 * (light = top/left edge, dark = bottom/right edge).
 */
export const COLORS: Record<
  TetrominoType,
  { base: string; light: string; dark: string; glow: string }
> = {
  I: {
    base: '#2ec4d6',
    light: '#8be7f0',
    dark: '#0e6d7a',
    glow: 'rgba(46,196,214,0.45)',
  },
  O: {
    base: '#f2c638',
    light: '#ffe38a',
    dark: '#96700a',
    glow: 'rgba(242,198,56,0.45)',
  },
  T: {
    base: '#a06cd5',
    light: '#d3b1f2',
    dark: '#55307c',
    glow: 'rgba(160,108,213,0.45)',
  },
  S: {
    base: '#5ccb6b',
    light: '#a3e8a9',
    dark: '#2a6a37',
    glow: 'rgba(92,203,107,0.45)',
  },
  Z: {
    base: '#e05656',
    light: '#f5a4a4',
    dark: '#852323',
    glow: 'rgba(224,86,86,0.45)',
  },
  J: {
    base: '#4f8fe0',
    light: '#9cc3f2',
    dark: '#244a8a',
    glow: 'rgba(79,143,224,0.45)',
  },
  L: {
    base: '#f08c3f',
    light: '#f9c394',
    dark: '#96471a',
    glow: 'rgba(240,140,63,0.45)',
  },
};

/* UI palette (used by CSS through mirrored token values). */
export const THEME = {
  background: '#0b0e14',
  panel: '#12161f',
  panelRaised: '#191f2b',
  border: '#242c3b',
  text: '#e6ebf2',
  textMuted: '#98a2b3',
  accent: '#2ec4d6',
  ghost: 'rgba(230,235,242,0.16)',
} as const;