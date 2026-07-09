/**
 * Centralized configuration constants for the Tetris game.
 * All values are frozen to prevent accidental mutation.
 */

// --- Board dimensions ---
export const COLS = 10;
export const ROWS = 20;
export const BLOCK_SIZE_PX = 30;

// --- Piece types ---
export const PIECE_TYPES = Object.freeze(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);

// --- Tetromino colors (vibrant dark-theme palette) ---
export const COLORS = Object.freeze({
  I: '#22d3ee', // cyan
  O: '#fbbf24', // yellow/amber
  T: '#a855f7', // purple
  S: '#22c55e', // green
  Z: '#ef4444', // red
  J: '#3b82f6', // blue
  L: '#f97316', // orange
});

// --- Spawn offsets (column where the bounding-box left edge appears) ---
export const SPAWN_X = Object.freeze({
  I: 3, O: 4, T: 3, S: 3, Z: 3, J: 3, L: 3,
});
export const SPAWN_Y = 0;

// --- Gravity table: milliseconds per row drop, indexed by level ---
export const GRAVITY_TABLE = Object.freeze([
  800, 720, 630, 550, 470, 380, 300, 220, 130, 100, // 0-9
  100, 80, 80, 80, 70, 70, 70, 60, 50, 50,          // 10-19
  40, 40, 30, 30, 30, 30, 30, 30, 20, 20,            // 20-29
]);

/**
 * Returns the gravity interval (ms per row) for a given level.
 * Levels beyond the table use the fastest (last) entry.
 */
export function getGravityInterval(level) {
  const idx = Math.min(Math.max(level, 0), GRAVITY_TABLE.length - 1);
  return GRAVITY_TABLE[idx];
}

// --- Soft drop: divide gravity interval by this factor ---
export const SOFT_DROP_DIVISOR = 20;

// --- Scoring: points awarded by number of lines cleared (index 0 = no clear) ---
export const SCORE_TABLE = Object.freeze([0, 100, 300, 500, 800]);

// --- Level progression ---
export const LINES_PER_LEVEL = 10;

// --- DAS (Delayed Auto-Shift) for held Left/Right ---
export const DAS_DELAY = 150; // ms before auto-repeat starts
export const DAS_REPEAT = 50; // ms between auto-repeat moves

// --- Delta-time cap to prevent huge jumps when tab is backgrounded ---
export const DT_CAP = 100; // ms

// --- SRS Wall-Kick Tables ---
// Offsets are in grid coordinates: [dx, dy] where dy is positive = downward.
// Derived from the standard SRS specification (y-axis negated for screen coords).
export const KICK_TABLES = Object.freeze({
  // J, L, S, T, Z pieces share the same kick table
  JLSTZ: {
    '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  },
  // I-piece has its own kick table
  I: {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  },
  // O-piece never needs a kick (all rotations are identical)
  O: {
    '0>1': [[0, 0]],
    '1>0': [[0, 0]],
    '1>2': [[0, 0]],
    '2>1': [[0, 0]],
    '2>3': [[0, 0]],
    '3>2': [[0, 0]],
    '3>0': [[0, 0]],
    '0>3': [[0, 0]],
  },
});

/**
 * Returns the wall-kick offset list for a rotation transition.
 * @param {string} type - Piece type (I, O, T, S, Z, J, L)
 * @param {number} fromRot - Starting rotation (0-3)
 * @param {number} toRot - Target rotation (0-3)
 * @returns {number[][]} Array of [dx, dy] kick offsets to try in order
 */
export function getKicks(type, fromRot, toRot) {
  const table = type === 'I'
    ? KICK_TABLES.I
    : type === 'O'
      ? KICK_TABLES.O
      : KICK_TABLES.JLSTZ;
  const key = `${fromRot}>${toRot}`;
  return table[key] || [[0, 0]];
}
