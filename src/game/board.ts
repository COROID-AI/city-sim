import type { Board, Cell } from './types';

/**
 * Create a board with `w` columns and `h` rows, filled with empty cells (0).
 */
export function createBoard(w: number, h: number): Board {
  const board: Board = [];
  for (let y = 0; y < h; y++) {
    board.push(new Array<Cell>(w).fill(0));
  }
  return board;
}

/**
 * True when the cell `(x, y)` lies on the board.
 */
export function inBounds(board: Board, x: number, y: number): boolean {
  const height = board.length;
  const width = height === 0 ? 0 : board[0].length;
  return y >= 0 && y < height && x >= 0 && x < width;
}

/**
 * Read the cell at `(x, y)`; out-of-bounds positions read as empty (0).
 */
export function getCell(board: Board, x: number, y: number): Cell {
  if (!inBounds(board, x, y)) return 0;
  return board[y][x];
}

/**
 * Immutably set the cell at `(x, y)` to `value`.
 *
 * Returns a new board and never mutates the input. Throws a `RangeError`
 * when `(x, y)` is outside the board.
 */
export function setCell(board: Board, x: number, y: number, value: Cell): Board {
  if (!inBounds(board, x, y)) {
    throw new RangeError(`setCell: cell (${x}, ${y}) is outside the board`);
  }
  const next = board.map((row) => row.slice());
  next[y][x] = value;
  return next;
}

/**
 * True when every cell in row `y` is non-zero (i.e. the row is full).
 */
export function isRowFull(board: Board, y: number): boolean {
  const row = board[y];
  if (!row) return false;
  return row.every((cell) => cell !== 0);
}

/**
 * Remove every full row from the board.
 *
 * Returns a new board with the same height: new empty rows are prepended at
 * the top and the remaining rows keep their relative order, plus the number
 * of rows cleared.
 */
export function clearFullRows(board: Board): { board: Board; count: number } {
  const width = board.length === 0 ? 0 : board[0].length;
  const kept = board.filter((row) => !row.every((cell) => cell !== 0));
  const count = board.length - kept.length;
  const cleared = Array.from({ length: count }, () => new Array<Cell>(width).fill(0));
  return { board: [...cleared, ...kept], count };
}