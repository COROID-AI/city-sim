import type { Cell, Piece, RotationState, TetrominoType } from './types';

export type ShapeMatrix = number[][];

/**
 * Canonical Guideline spawn orientations: every piece appears with its flat
 * side toward the bottom so it can rest on a floor. Rows are top-to-bottom,
 * columns left-to-right.
 */
const BASE_SHAPES: Record<TetrominoType, ShapeMatrix> = {
  I: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [1, 1, 1, 1],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

/**
 * Rotate a square matrix 90° clockwise in screen space (row axis points down).
 * The shape always stays inside its bounding box, so the SRS kick tables are
 * what allow the box itself to slide against walls, floors and stacks.
 */
export function rotateCW(matrix: ShapeMatrix): ShapeMatrix {
  const n = matrix.length;
  const out: ShapeMatrix = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      out[c][n - 1 - r] = matrix[r][c];
    }
  }
  return out;
}

/**
 * All four SRS orientation matrices per tetromino. State `k + 1` is the 90°
 * clockwise rotation of state `k` (SRS state 0 = spawn, 1 = "R", 2 = "2",
 * 3 = "L"); the published Guideline kick tables are keyed to these indices.
 */
const SHAPES: Record<TetrominoType, Record<RotationState, ShapeMatrix>> = {
  I: buildStates('I'),
  O: buildStates('O'),
  T: buildStates('T'),
  S: buildStates('S'),
  Z: buildStates('Z'),
  J: buildStates('J'),
  L: buildStates('L'),
};

function buildStates(type: TetrominoType): Record<RotationState, ShapeMatrix> {
  const s0 = BASE_SHAPES[type];
  const s1 = rotateCW(s0);
  return {
    0: s0,
    1: s1,
    2: rotateCW(s1),
    3: rotateCW(rotateCW(s1)),
  };
}

export function getShape(type: TetrominoType, rotation: RotationState): ShapeMatrix {
  return SHAPES[type][rotation];
}

/**
 * Guideline spawn columns: I's 4-wide box starts at column 3 (bar at 3-6),
 * O's 2-wide box at column 4 (cells 4-5), the 3-wide boxes at column 3.
 */
export const SPAWN_COL: Record<TetrominoType, number> = {
  I: 3,
  O: 4,
  T: 3,
  S: 3,
  Z: 3,
  J: 3,
  L: 3,
};

/** Pieces spawn fully inside the hidden rows at the top of the board. */
export const SPAWN_ROW = 0;

export function spawnPiece(type: TetrominoType): Piece {
  return { type, rotation: 0, x: SPAWN_COL[type], y: SPAWN_ROW };
}

export function pieceCells(piece: Piece): Cell[] {
  const matrix = getShape(piece.type, piece.rotation);
  const cells: Cell[] = [];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c]) {
        cells.push({ row: piece.y + r, col: piece.x + c });
      }
    }
  }
  return cells;
}