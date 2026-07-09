/**
 * Pure board operations for the Tetris game.
 *
 * Every function here is pure: it takes a {@link Board} (or dimensions) and
 * returns a new value without mutating its inputs or touching the DOM. This
 * keeps the board logic trivially testable with Jest.
 */

import { Board, Cell } from './types';

/**
 * Create an empty board of the given dimensions.
 *
 * @param rows  Number of rows (must be a positive integer).
 * @param cols  Number of columns (must be a positive integer).
 * @returns     A `rows × cols` grid filled with `null`.
 * @throws {RangeError} If either dimension is not a positive integer.
 */
export function createBoard(rows: number, cols: number): Board {
  if (!Number.isInteger(rows) || rows <= 0) {
    throw new RangeError(`rows must be a positive integer, got ${rows}`);
  }
  if (!Number.isInteger(cols) || cols <= 0) {
    throw new RangeError(`cols must be a positive integer, got ${cols}`);
  }

  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, (): Cell => null),
  );
}

/**
 * Determine whether a coordinate is inside the board.
 *
 * @param board  The board to check against.
 * @param row    Row index (0-based, top-to-bottom).
 * @param col    Column index (0-based, left-to-right).
 * @returns      `true` if the coordinate is within the board bounds.
 */
export function inBounds(board: Board, row: number, col: number): boolean {
  return row >= 0 && row < board.length && col >= 0 && col < board[0].length;
}

/**
 * Read the cell at a coordinate, returning `null` for out-of-bounds positions.
 *
 * @param board  The board to read from.
 * @param row    Row index.
 * @param col    Column index.
 * @returns      The cell value, or `null` when out of bounds or empty.
 */
export function getCell(board: Board, row: number, col: number): Cell {
  if (!inBounds(board, row, col)) {
    return null;
  }
  return board[row][col];
}

/**
 * Return a new board with a single cell updated.
 *
 * The original board is never mutated.
 *
 * @param board  The source board.
 * @param row    Row index.
 * @param col    Column index.
 * @param value  The value to place.
 * @returns      A new board with the cell set.
 * @throws {RangeError} If the coordinate is out of bounds.
 */
export function setCell(
  board: Board,
  row: number,
  col: number,
  value: Cell,
): Board {
  if (!inBounds(board, row, col)) {
    throw new RangeError(
      `cell (${row}, ${col}) is out of bounds for board of size ${board.length}×${board[0].length}`,
    );
  }

  return board.map((r, rIndex) => {
    if (rIndex !== row) {
      return r;
    }
    return r.map((cell, cIndex) => (cIndex === col ? value : cell));
  });
}

/**
 * Check whether every cell in a row is filled.
 *
 * @param board  The board to inspect.
 * @param row    Row index.
 * @returns      `true` if the row exists and all its cells are non-null,
 *               `false` otherwise (including out-of-bounds rows).
 */
export function isRowFull(board: Board, row: number): boolean {
  if (row < 0 || row >= board.length) {
    return false;
  }
  return board[row].every((cell) => cell !== null);
}

/**
 * Remove all full rows and prepend empty rows to preserve board height.
 *
 * @param board  The source board.
 * @returns      An object with the new `board` and the number of
 *               `linesCleared`.
 */
export function clearFullRows(board: Board): {
  board: Board;
  linesCleared: number;
} {
  const cols = board[0].length;
  const surviving = board.filter((row) => !row.every((cell) => cell !== null));
  const linesCleared = board.length - surviving.length;

  if (linesCleared === 0) {
    return { board, linesCleared: 0 };
  }

  const emptyRows = Array.from({ length: linesCleared }, () =>
    Array.from({ length: cols }, (): Cell => null),
  );

  return { board: [...emptyRows, ...surviving], linesCleared };
}
