/**
 * Pure board state model — no DOM access.
 *
 * The board is a 2D array (ROWS x COLS) of cell values. Each cell is either
 * null (empty) or a color string (locked piece).
 */

import { COLS, ROWS } from './config.js';
import { getCells } from './tetrominoes.js';

/**
 * Creates a fresh empty board (all cells null).
 * @returns {(null|string)[][]}
 */
export function createBoard() {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
}

/**
 * Returns true if the cell at (col, row) is empty.
 */
export function isEmpty(board, col, row) {
  if (col < 0 || col >= COLS || row >= ROWS) return false;
  if (row < 0) return true; // above the board is allowed (spawn area)
  return board[row][col] === null;
}

/**
 * Returns the absolute cell positions of a piece given its matrix offset.
 * @param {{ type: string, rotation: number, x: number, y: number }} piece
 * @param {number} [dx] - Column delta to apply
 * @param {number} [dy] - Row delta to apply
 * @param {number} [rotation] - Override rotation state (optional)
 * @returns {number[][]} Array of [col, row] absolute positions
 */
export function getPieceCells(piece, dx = 0, dy = 0, rotation) {
  const rot = rotation !== undefined ? rotation : piece.rotation;
  const offsets = getCells(piece.type, rot);
  return offsets.map(([c, r]) => [piece.x + c + dx, piece.y + r + dy]);
}

/**
 * Validates whether a piece (optionally shifted/rotated) occupies only legal cells.
 *
 * @param {(null|string)[][]} board
 * @param {{ type: string, rotation: number, x: number, y: number }} piece
 * @param {number} [dx] - Column delta
 * @param {number} [dy] - Row delta
 * @param {number} [rotation] - Override rotation state
 * @returns {boolean} true if the position is valid (in-bounds, no collisions)
 */
export function isValidPosition(board, piece, dx = 0, dy = 0, rotation) {
  const cells = getPieceCells(piece, dx, dy, rotation);
  for (let i = 0; i < cells.length; i++) {
    const [col, row] = cells[i];
    // Left/right walls and the floor are illegal
    if (col < 0 || col >= COLS || row >= ROWS) return false;
    // Above the top is allowed; otherwise must not overlap locked cells
    if (row >= 0 && board[row][col] !== null) return false;
  }
  return true;
}

/**
 * Locks a piece into the board by stamping its color onto each occupied cell.
 * Does NOT validate — assumes the position is already known to be valid.
 * Returns a new board (does not mutate the input).
 *
 * @param {(null|string)[][]} board
 * @param {{ type: string, rotation: number, x: number, y: number, color: string }} piece
 * @returns {(null|string)[][]} New board with the piece locked in
 */
export function lockPiece(board, piece) {
  const next = board.map((row) => [...row]);
  const cells = getPieceCells(piece);
  for (let i = 0; i < cells.length; i++) {
    const [col, row] = cells[i];
    if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
      next[row][col] = piece.color;
    }
  }
  return next;
}

/**
 * Clears all completely-filled rows and shifts the rows above downward.
 * Returns the updated board and the count of lines cleared.
 *
 * @param {(null|string)[][]} board
 * @returns {{ board: (null|string)[][], cleared: number }}
 */
export function clearLines(board) {
  const remaining = board.filter((row) => !row.every((cell) => cell !== null));
  const cleared = ROWS - remaining.length;
  const emptyRows = Array.from({ length: cleared }, () =>
    Array.from({ length: COLS }, () => null),
  );
  return { board: [...emptyRows, ...remaining], cleared };
}
