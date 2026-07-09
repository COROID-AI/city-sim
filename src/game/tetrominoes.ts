import { Shape, Tetromino, TetrominoId } from './types';

/**
 * Tetromino shape definitions.
 *
 * Each piece is described by a single matrix whose `true` entries mark the
 * filled cells of that piece. The four rotation states are generated from the
 * base shape by {@link rotateMatrix}, so only the spawn orientation has to be
 * hand-authored.
 *
 * This module is pure data + pure functions: no DOM, no randomness, no I/O.
 */

const PIECE_I: Shape = [
  [false, false, false, false],
  [true, true, true, true],
  [false, false, false, false],
  [false, false, false, false],
];

const PIECE_O: Shape = [
  [true, true],
  [true, true],
];

const PIECE_T: Shape = [
  [false, true, false],
  [true, true, true],
  [false, false, false],
];

const PIECE_S: Shape = [
  [false, true, true],
  [true, true, false],
  [false, false, false],
];

const PIECE_Z: Shape = [
  [true, true, false],
  [false, true, true],
  [false, false, false],
];

const PIECE_J: Shape = [
  [true, false, false],
  [true, true, true],
  [false, false, false],
];

const PIECE_L: Shape = [
  [false, false, true],
  [true, true, true],
  [false, false, false],
];

/** Rotate a square boolean matrix 90° clockwise. */
function rotateMatrix(matrix: Shape): Shape {
  const size = matrix.length;
  const result: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      result[col][size - 1 - row] = matrix[row][col];
    }
  }

  return result;
}

/** Build the four rotation states for a piece from its spawn orientation. */
function buildRotations(base: Shape): readonly Shape[] {
  // The O piece (and only the O piece) is rotationally symmetric: all four
  // states are identical, but we still keep four entries so every piece has a
  // consistent shape contract.
  const states: Shape[] = [base];
  let current = base;
  for (let i = 0; i < 3; i++) {
    current = rotateMatrix(current);
    states.push(current);
  }
  return states;
}

/**
 * Rotate a tetromino's shape one step clockwise.
 *
 * @param piece   The tetromino definition.
 * @param index   Current rotation index (0–3).
 * @returns       The next rotation index, wrapping at 3 back to 0.
 */
export function rotate(_piece: Tetromino, index: number): number {
  void _piece; // The piece argument is part of the API contract but rotation is index-based.
  const normalized = ((index % 4) + 4) % 4;
  return (normalized + 1) % 4;
}

/**
 * Return the shape at a given rotation index.
 *
 * @param piece   The tetromino definition.
 * @param index   Rotation index (0–3).
 * @returns       The shape matrix for that rotation.
 */
export function getShape(piece: Tetromino, index: number): Shape {
  const normalized = ((index % 4) + 4) % 4;
  return piece.rotations[normalized];
}

/** The seven standard tetrominoes, keyed by id. */
export const TETROMINOES: Readonly<Record<TetrominoId, Tetromino>> = {
  [TetrominoId.I]: {
    id: TetrominoId.I,
    color: '#00f0f0',
    rotations: buildRotations(PIECE_I),
  },
  [TetrominoId.O]: {
    id: TetrominoId.O,
    color: '#f0f000',
    rotations: buildRotations(PIECE_O),
  },
  [TetrominoId.T]: {
    id: TetrominoId.T,
    color: '#a000f0',
    rotations: buildRotations(PIECE_T),
  },
  [TetrominoId.S]: {
    id: TetrominoId.S,
    color: '#00f000',
    rotations: buildRotations(PIECE_S),
  },
  [TetrominoId.Z]: {
    id: TetrominoId.Z,
    color: '#f00000',
    rotations: buildRotations(PIECE_Z),
  },
  [TetrominoId.J]: {
    id: TetrominoId.J,
    color: '#0000f0',
    rotations: buildRotations(PIECE_J),
  },
  [TetrominoId.L]: {
    id: TetrominoId.L,
    color: '#f0a000',
    rotations: buildRotations(PIECE_L),
  },
};

/** Ordered list of all tetromino ids (handy for randomised spawning). */
export const TETROMINO_IDS: readonly TetrominoId[] = Object.values(
  TetrominoId,
);
