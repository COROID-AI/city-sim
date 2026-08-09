import type { Board, Cell } from './types';

/** Creates a `width` x `height` board filled with empty (0) cells. */
export function createBoard(width: number, height: number): Board {
  const board: Board = [];

  for (let y = 0; y < height; y++) {
    board.push(new Array<Cell>(width).fill(0));
  }

  return board;
}

/** Returns true when (x, y) is inside the board grid. */
export function inBounds(board: Board, x: number, y: number): boolean {
  if (y < 0 || y >= board.length) return false;

  const row = board[y];
  return row !== undefined && x >= 0 && x < row.length;
}

/** Reads the cell at (x, y); out-of-bounds reads return 0 (empty). */
export function getCell(board: Board, x: number, y: number): Cell {
  if (!inBounds(board, x, y)) return 0;
  return board[y][x];
}

/**
 * Immutable update: returns a brand-new board with `value` written at
 * (x, y). The input board is never mutated.
 */
export function setCell(
  board: Board,
  x: number,
  y: number,
  value: Cell,
): Board {
  return board.map((row, rowIndex) =>
    row.map((cell, colIndex) =>
      rowIndex === y && colIndex === x ? value : cell,
    ),
  );
}

/** Returns true only when every cell in row `y` is non-zero. */
export function isRowFull(board: Board, y: number): boolean {
  if (y < 0 || y >= board.length) return false;
  return board[y].every((cell) => cell !== 0);
}

export interface ClearResult {
  board: Board;
  count: number;
}

/**
 * Removes every full row, shifting the rows above down and adding empty
 * rows at the top. Returns a new board and the number of cleared rows;
 * the input board is never mutated.
 */
export function clearFullRows(board: Board): ClearResult {
  const width = Math.max(0, board[0]?.length ?? 0);
  const remaining = board.filter((row) => !row.every((cell) => cell !== 0));
  const cleared = board.length - remaining.length;

  const nextBoard: Board = [
    ...Array.from({ length: cleared }, () =>
      new Array<Cell>(width).fill(0),
    ),
    ...remaining.map((row) => [...row]),
  ];

  return { board: nextBoard, count: cleared };
}