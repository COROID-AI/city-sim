import type { Cell, Tetromino, TetrominoId } from './types';

/**
 * The seven standard tetrominoes with their four rotation states.
 *
 * Each rotation state is a 4x4 matrix. Occupied cells carry the piece's
 * color id (`1`-`7`); empty cells are `0`. The states are ordered
 * [spawn, 90°, 180°, 270°] clockwise.
 *
 * Color assignment: I = 1, O = 2, T = 3, S = 4, Z = 5, J = 6, L = 7.
 */
function piece(id: TetrominoId, rotations: Cell[][][]): Tetromino {
  return { id, rotations };
}

export const TETROMINOES: Record<TetrominoId, Tetromino> = {
  I: piece('I', [
    [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
    ],
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
    ],
  ]),
  O: piece('O', [
    [
      [0, 2, 2, 0],
      [0, 2, 2, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 2, 2, 0],
      [0, 2, 2, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 2, 2, 0],
      [0, 2, 2, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 2, 2, 0],
      [0, 2, 2, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  ]),
  T: piece('T', [
    [
      [0, 3, 0, 0],
      [3, 3, 3, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 3, 0, 0],
      [0, 3, 3, 0],
      [0, 3, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 0, 0],
      [3, 3, 3, 0],
      [0, 3, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 3, 0, 0],
      [3, 3, 0, 0],
      [0, 3, 0, 0],
      [0, 0, 0, 0],
    ],
  ]),
  S: piece('S', [
    [
      [0, 4, 4, 0],
      [4, 4, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 4, 0, 0],
      [0, 4, 4, 0],
      [0, 0, 4, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 0, 0],
      [0, 4, 4, 0],
      [4, 4, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [4, 0, 0, 0],
      [4, 4, 0, 0],
      [0, 4, 0, 0],
      [0, 0, 0, 0],
    ],
  ]),
  Z: piece('Z', [
    [
      [5, 5, 0, 0],
      [0, 5, 5, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 5, 0],
      [0, 5, 5, 0],
      [0, 5, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 0, 0],
      [5, 5, 0, 0],
      [0, 5, 5, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 5, 0, 0],
      [5, 5, 0, 0],
      [5, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  ]),
  J: piece('J', [
    [
      [6, 0, 0, 0],
      [6, 6, 6, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 6, 6, 0],
      [0, 6, 0, 0],
      [0, 6, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 0, 0],
      [6, 6, 6, 0],
      [0, 0, 6, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 6, 0, 0],
      [0, 6, 0, 0],
      [6, 6, 0, 0],
      [0, 0, 0, 0],
    ],
  ]),
  L: piece('L', [
    [
      [0, 0, 7, 0],
      [7, 7, 7, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 7, 0, 0],
      [0, 7, 0, 0],
      [0, 7, 7, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 0, 0],
      [7, 7, 7, 0],
      [7, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [7, 7, 0, 0],
      [0, 7, 0, 0],
      [0, 7, 0, 0],
      [0, 0, 0, 0],
    ],
  ]),
};

/**
 * Rotate a piece one step from its spawn state.
 *
 * Returns the rotation-state matrix obtained after rotating clockwise
 * (`dir = 1`) or counter-clockwise (`dir = -1`) from the spawn state
 * (rotation index 0).
 */
export function rotate(id: TetrominoId, dir: 1 | -1): Cell[][] {
  const t = TETROMINOES[id];
  // All pieces have four rotation states; from the spawn state (index 0)
  // one clockwise step is index 1 and one counter-clockwise step is index 3.
  const index = dir === 1 ? 1 : 3;
  return t.rotations[index];
}