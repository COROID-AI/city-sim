import type { Cell, Tetromino, TetrominoId } from './types';

/**
 * Rotates a square matrix 90 degrees clockwise.
 * Returns a new matrix; the input is never mutated.
 */
function rotateMatrixCW<T>(matrix: T[][]): T[][] {
  const size = matrix.length;
  const rotated: T[][] = [];

  for (let row = 0; row < size; row++) {
    const nextRow: T[] = [];
    for (let col = 0; col < size; col++) {
      nextRow[col] = matrix[size - 1 - col][row];
    }
    rotated[row] = nextRow;
  }

  return rotated;
}

/** Base (rotation 0 / spawn) state of each piece, drawn in a 4x4 box. */
const SPAWN_STATES: Record<TetrominoId, Cell[][]> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [0, 0, 0, 0],
    [0, 2, 2, 0],
    [0, 2, 2, 0],
    [0, 0, 0, 0],
  ],
  T: [
    [0, 0, 0, 0],
    [0, 3, 0, 0],
    [3, 3, 3, 0],
    [0, 0, 0, 0],
  ],
  S: [
    [0, 0, 0, 0],
    [0, 4, 4, 0],
    [4, 4, 0, 0],
    [0, 0, 0, 0],
  ],
  Z: [
    [0, 0, 0, 0],
    [5, 5, 0, 0],
    [0, 5, 5, 0],
    [0, 0, 0, 0],
  ],
  J: [
    [0, 0, 0, 0],
    [6, 0, 0, 0],
    [6, 6, 6, 0],
    [0, 0, 0, 0],
  ],
  L: [
    [0, 0, 0, 0],
    [0, 0, 7, 0],
    [7, 7, 7, 0],
    [0, 0, 0, 0],
  ],
};

/**
 * Builds the four rotation states of a piece. State index 0 is the spawn
 * state; each following state is the previous one rotated 90 degrees
 * clockwise. The O piece is rotation-invariant, so all four states are
 * identical.
 */
function buildStates(id: TetrominoId, spawn: Cell[][]): Tetromino[] {
  const states: Tetromino[] = [
    { id, matrix: spawn.map((row) => [...row]) },
  ];

  let current = states[0].matrix;
  for (let i = 1; i < 4; i++) {
    current = rotateMatrixCW(current);
    states.push({ id, matrix: current });
  }

  return states;
}

/** The seven standard tetrominoes as rotation-state arrays. */
export const TETROMINOES: Record<TetrominoId, Tetromino[]> = {
  I: buildStates('I', SPAWN_STATES.I),
  O: buildStates('O', SPAWN_STATES.O),
  T: buildStates('T', SPAWN_STATES.T),
  S: buildStates('S', SPAWN_STATES.S),
  Z: buildStates('Z', SPAWN_STATES.Z),
  J: buildStates('J', SPAWN_STATES.J),
  L: buildStates('L', SPAWN_STATES.L),
};

/**
 * Returns the rotation state of `id` obtained by rotating the base
 * (rotation 0) state 90 degrees in the given direction:
 * - `dir = 1`  -> 90 degrees clockwise (state index 1)
 * - `dir = -1` -> 90 degrees counter-clockwise (state index 3)
 */
export function rotate(id: TetrominoId, dir: 1 | -1): Tetromino {
  const states = TETROMINOES[id];
  return dir === 1 ? states[1] : states[states.length - 1];
}