/**
 * Board primitives for the Tetris playfield.
 *
 * All functions here are side-effect-free with respect to their inputs except
 * `mergePiece` and `clearLines`, which intentionally mutate the board they are
 * given. No browser APIs are used.
 */

import { TETROMINOES, type TetrominoType } from "./tetrominoes";

/** Standard Tetris board dimensions. */
export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;

/** A single board cell: either a locked tetromino type or empty (null). */
export type Cell = TetrominoType | null;

/** The playfield: a grid of cells indexed [row][col]. */
export type Board = Cell[][];

/** Creates a fresh, completely empty board. */
export function createBoard(
  width: number = BOARD_WIDTH,
  height: number = BOARD_HEIGHT
): Board {
  return Array.from({ length: height }, () =>
    new Array<Cell>(width).fill(null)
  );
}

/** Returns a deep copy of a board. */
export function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice());
}

/** True when (row, col) lies strictly inside the board rectangle. */
export function inBounds(board: Board, row: number, col: number): boolean {
  return (
    row >= 0 &&
    row < board.length &&
    col >= 0 &&
    col < board[0].length
  );
}

/**
 * Determines whether a tetromino at the given orientation and top-left
 * position collides with a wall, the floor, or any locked cell.
 *
 * Cells above the board (row < 0) are treated as the spawn buffer and do not
 * count as a collision; this lets pieces spawn just above the playfield.
 */
export function collides(
  board: Board,
  type: TetrominoType,
  rotation: number,
  row: number,
  col: number
): boolean {
  const matrix = TETROMINOES[type].rotations[rotation];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] === 0) {
        continue;
      }
      const boardRow = row + r;
      const boardCol = col + c;
      // Left or right wall.
      if (boardCol < 0 || boardCol >= board[0].length) {
        return true;
      }
      // Floor.
      if (boardRow >= board.length) {
        return true;
      }
      // Overlap with a locked cell (only when inside the playfield).
      if (boardRow >= 0 && board[boardRow][boardCol] !== null) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Writes a tetromino's filled cells into the board as locked cells.
 *
 * Cells that fall outside the playfield (e.g. above the top row) are skipped.
 */
export function mergePiece(
  board: Board,
  type: TetrominoType,
  rotation: number,
  row: number,
  col: number
): void {
  const matrix = TETROMINOES[type].rotations[rotation];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] === 0) {
        continue;
      }
      const boardRow = row + r;
      const boardCol = col + c;
      if (inBounds(board, boardRow, boardCol)) {
        board[boardRow][boardCol] = type;
      }
    }
  }
}

/**
 * Removes every completely filled row, drops the surviving rows down, and
 * refills the top with empty rows.
 *
 * The board is mutated in place so that it reflects the drop. Returns the
 * number of lines cleared.
 */
export function clearLines(board: Board): number {
  const width = board[0].length;
  const surviving: Cell[][] = [];
  let cleared = 0;

  for (const row of board) {
    if (row.every((cell) => cell !== null)) {
      cleared += 1;
    } else {
      surviving.push(row);
    }
  }

  board.length = 0;
  for (let i = 0; i < cleared; i++) {
    board.push(new Array<Cell>(width).fill(null));
  }
  for (const row of surviving) {
    board.push(row);
  }

  return cleared;
}
