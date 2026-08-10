// Tetromino definitions, SRS rotation states, SRS wall-kick tables and the
// 7-bag randomizer. Pure logic: no DOM access so node:test can load this.
//
// Rotation states are numbered per the SRS convention:
//   0 = spawn (0°), 1 = R (90° CW), 2 = 180°, 3 = L (270° CW / 90° CCW).
// Cells are [x, y] offsets (col, row) from the bounding-box top-left corner.

import { COLS, PIECE_TYPES } from './constants.js';

// Spawn-state matrices ("X" = filled cell). All states are derived by rotating
// the matrix 90° clockwise inside its bounding box, which matches SRS.
const SPAWN_MATRICES = Object.freeze({
  I: Object.freeze(['....', 'XXXX', '....', '....']),
  O: Object.freeze(['XX', 'XX']),
  T: Object.freeze(['.X.', 'XXX', '...']),
  S: Object.freeze(['.XX', 'XX.', '...']),
  Z: Object.freeze(['XX.', '.XX', '...']),
  J: Object.freeze(['X..', 'XXX', '...']),
  L: Object.freeze(['..X', 'XXX', '...']),
});

function rotateMatrixCW(matrix) {
  const h = matrix.length;
  const w = matrix[0].length;
  const out = [];
  for (let c = 0; c < w; c++) {
    let row = '';
    for (let r = h - 1; r >= 0; r--) row += matrix[r][c];
    out.push(row);
  }
  return out;
}

function matrixCells(matrix) {
  const cells = [];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] === 'X') cells.push([c, r]);
    }
  }
  return cells;
}

// TETROMINOES[type] = { type, states: [{ cells } x4] } where index = SRS state.
export const TETROMINOES = {};
for (const type of PIECE_TYPES) {
  const states = [];
  let matrix = SPAWN_MATRICES[type];
  for (let i = 0; i < 4; i++) {
    states.push({ cells: matrixCells(matrix) });
    matrix = rotateMatrixCW(matrix);
  }
  TETROMINOES[type] = { type, states };
}

export function getCells(type, rotation) {
  return TETROMINOES[type].states[rotation % 4].cells;
}

export function rotateState(type, rotation, dir) {
  // dir: 1 = clockwise, -1 = counter-clockwise. O never changes cells.
  if (type === 'O') return rotation;
  return (rotation + (dir === 1 ? 1 : 3)) % 4;
}

// --- SRS wall kicks ----------------------------------------------------------
// Canonical Guideline kick tables (tetris.wiki/SRS), stored as [dx, dy] with
// dy positive meaning DOWN (screen coordinates), which is what game logic adds
// to the piece origin. Each entry: basic offset then up to 4 test offsets.
const KICKS_JLSTZ = Object.freeze({
  '0>1': Object.freeze([[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]]),
  '1>0': Object.freeze([[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]),
  '1>2': Object.freeze([[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]),
  '2>1': Object.freeze([[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]]),
  '2>3': Object.freeze([[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]),
  '3>2': Object.freeze([[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]]),
  '3>0': Object.freeze([[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]]),
  '0>3': Object.freeze([[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]),
});

const KICKS_I = Object.freeze({
  '0>1': Object.freeze([[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]]),
  '1>0': Object.freeze([[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]]),
  '1>2': Object.freeze([[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]]),
  '2>1': Object.freeze([[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]]),
  '2>3': Object.freeze([[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]]),
  '3>2': Object.freeze([[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]]),
  '3>0': Object.freeze([[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]]),
  '0>3': Object.freeze([[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]]),
});

// O does not rotate and therefore has no kick table.
export const WALL_KICKS = Object.freeze({
  I: KICKS_I,
  O: Object.freeze({}),
  T: KICKS_JLSTZ,
  S: KICKS_JLSTZ,
  Z: KICKS_JLSTZ,
  J: KICKS_JLSTZ,
  L: KICKS_JLSTZ,
});

export function getWallKicks(type, from, to) {
  const table = WALL_KICKS[type];
  if (!table) return [];
  return table[`${from}>${to}`] ?? [];
}

// --- 7-bag randomizer --------------------------------------------------------
function shuffle(items, rng) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// Refills so the queue always contains a complete future bag ahead.
export function refillQueue(queue, rng = Math.random) {
  while (queue.length < PIECE_TYPES.length) {
    queue.push(...shuffle([...PIECE_TYPES], rng));
  }
  return queue;
}

export function createQueue(rng = Math.random) {
  return refillQueue([], rng);
}

export function drawFromBag(queue, rng = Math.random) {
  refillQueue(queue, rng);
  return queue.shift();
}

// Spawn column centers the piece's bounding box on a COLUMNS-wide field.
export function spawnColumn(type, cols = COLS) {
  const width = SPAWN_MATRICES[type][0].length;
  return Math.floor((cols - width) / 2);
}