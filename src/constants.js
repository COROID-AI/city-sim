// ---------------------------------------------------------------------------
// Tetris constants.
//
// This module is DOM-free and Node-importable so the engine unit tests can
// require it without touching window/document.
// ---------------------------------------------------------------------------

export const COLS = 10;
export const ROWS = 20;
export const NEXT_COUNT = 5;

// Classic guideline colors.
export const COLORS = {
  I: '#00e5f0',
  O: '#f0d020',
  T: '#a04ef0',
  S: '#3fc24f',
  Z: '#ef3a3a',
  J: '#3a6df0',
  L: '#f08a2a',
};

// The 7-bag contents. Every 7 pieces the bag is reshuffled so each piece
// appears exactly once before any repeats.
export const BAG = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// Spawn column (top-left of the piece's bounding box) per piece type.
// JLSTZ use a 3x3 box, the I piece a 4x4 box and the O piece a 2x2 box, so
// each is horizontally centered on a 10-wide board.
export const SPAWN = { I: 3, O: 4, T: 3, S: 3, Z: 3, J: 3, L: 3 };

// Piece shapes as local cell offsets for each of the four rotation states
// (0 = spawn, 1 = CW, 2 = 180, 3 = CCW). Coordinates are [x, y] with y
// pointing DOWN (board convention). These are the canonical SRS cell sets.
export const SHAPES = {
  I: {
    0: [[0, 2], [1, 2], [2, 2], [3, 2]],
    1: [[2, 0], [2, 1], [2, 2], [2, 3]],
    2: [[0, 1], [1, 1], [2, 1], [3, 1]],
    3: [[1, 0], [1, 1], [1, 2], [1, 3]],
  },
  O: {
    0: [[0, 0], [1, 0], [0, 1], [1, 1]],
    1: [[0, 0], [1, 0], [0, 1], [1, 1]],
    2: [[0, 0], [1, 0], [0, 1], [1, 1]],
    3: [[0, 0], [1, 0], [0, 1], [1, 1]],
  },
  T: {
    0: [[1, 0], [0, 1], [1, 1], [2, 1]],
    1: [[1, 0], [1, 1], [2, 1], [1, 2]],
    2: [[0, 1], [1, 1], [2, 1], [1, 2]],
    3: [[1, 0], [0, 1], [1, 1], [1, 2]],
  },
  S: {
    0: [[1, 0], [2, 0], [0, 1], [1, 1]],
    1: [[1, 0], [1, 1], [2, 1], [2, 2]],
    2: [[1, 1], [2, 1], [0, 2], [1, 2]],
    3: [[0, 0], [0, 1], [1, 1], [1, 2]],
  },
  Z: {
    0: [[0, 0], [1, 0], [1, 1], [2, 1]],
    1: [[2, 0], [1, 1], [2, 1], [1, 2]],
    2: [[0, 1], [1, 1], [1, 2], [2, 2]],
    3: [[1, 0], [0, 1], [1, 1], [0, 2]],
  },
  J: {
    0: [[0, 0], [0, 1], [1, 1], [2, 1]],
    1: [[1, 0], [2, 0], [1, 1], [1, 2]],
    2: [[0, 1], [1, 1], [2, 1], [2, 2]],
    3: [[1, 0], [1, 1], [0, 2], [1, 2]],
  },
  L: {
    0: [[2, 0], [0, 1], [1, 1], [2, 1]],
    1: [[1, 0], [1, 1], [1, 2], [2, 2]],
    2: [[0, 1], [1, 1], [2, 1], [0, 2]],
    3: [[0, 0], [1, 0], [1, 1], [1, 2]],
  },
};

// ---------------------------------------------------------------------------
// SRS wall-kick tables.
//
// The canonical tables are expressed with y pointing UP. Our board uses y
// pointing DOWN, so every y component has been negated when transcribed.
// The I piece uses a DIFFERENT table than the JLSTZ pieces; the O piece never
// rotates and therefore has no kicks.
//
// Each entry maps a transition "fromState->toState" (0=spawn, 1=CW, 2=180,
// 3=CCW) to an ordered list of [dx, dy] offsets to try.
// ---------------------------------------------------------------------------
export const KICKS = {
  JLSTZ: {
    '0->1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '1->0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '1->2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '2->1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '2->3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '3->2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '3->0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '0->3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  },
  I: {
    '0->1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '1->0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '1->2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '2->1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '2->3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '3->2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '3->0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '0->3': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  },
};

// Guideline scoring (multiplied by the current level).
export const CLEAR_SCORE = { 1: 100, 2: 300, 3: 500, 4: 800 };

export const LINES_PER_LEVEL = 10;

// Gravity interval in ms for a given level (higher level = faster).
export const GRAVITY = (level) =>
  Math.max(60, Math.round(1000 * Math.pow(0.85, level - 1)));

// DAS/ARR tuning (ms). DAS is the delay before auto-repeat begins; ARR is
// the repeat interval once DAS has elapsed.
export const DAS_MS = 170;
export const ARR_MS = 40;
export const SOFT_DROP_MS = 45;
