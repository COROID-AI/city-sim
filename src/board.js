// Pure board primitives: collision, locking, line clearing and the ghost drop.
// No DOM access so node:test can load this; renderer/main never mutate state
// through these helpers in a way that breaks tests (all helpers are pure).

import { COLS, ROWS } from './constants.js';

export function createBoard(cols = COLS, rows = ROWS) {
  return Array.from({ length: rows }, () => Array(cols).fill(0));
}

// cells: array of [x, y]. True when any cell is out of bounds or overlaps a
// locked (non-zero) board cell.
export function collides(board, cells, cols = COLS, rows = ROWS) {
  for (const [x, y] of cells) {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return true;
    if (board[y][x] !== 0) return true;
  }
  return false;
}

// Returns a new board with `type` written into each cell.
export function lockPiece(board, cells, type) {
  const next = board.map((row) => [...row]);
  for (const [x, y] of cells) next[y][x] = type;
  return next;
}

export function getFullRows(board) {
  const full = [];
  for (let y = 0; y < board.length; y++) {
    if (board[y].every((cell) => cell !== 0)) full.push(y);
  }
  return full;
}

// Removes the given full rows, shifts the stack down and prepends empty rows.
// Returns { board, cleared }.
export function clearLines(board, fullRows) {
  const toClear = new Set(fullRows);
  const kept = board.filter((_, y) => !toClear.has(y));
  const cleared = board.length - kept.length;
  const cols = board.length > 0 ? board[0].length : COLS;
  while (kept.length < board.length) kept.unshift(Array(cols).fill(0));
  return { board: kept, cleared };
}

// Deepest valid position for a set of cells (ghost piece).
export function getDropCells(board, cells, cols = COLS, rows = ROWS) {
  let current = cells;
  for (;;) {
    const next = current.map(([x, y]) => [x, y + 1]);
    if (collides(board, next, cols, rows)) return current;
    current = next;
  }
}