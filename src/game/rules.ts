/**
 * Pure game rules for Tetris.
 *
 * Every function here is side-effect free: it reads its inputs, computes a new
 * value, and returns it without mutating anything or touching the DOM. This
 * makes the rules trivially unit-testable and keeps them reusable for both the
 * real game loop and any future tooling (AI, replays, etc.).
 *
 * The functions operate on the low-level primitives from {@link board} and
 * {@link tetrominoes}: a {@link Board}, a {@link TetrominoId}/{@link Shape}, and
 * an anchor position. The higher-level reducer in {@link state} wires these
 * together with scoring, line clearing, and spawning.
 */

import { Board, Cell } from './types';
import { inBounds, setCell } from './board';
import { getShape, TETROMINOES } from './tetrominoes';
import { Shape, TetrominoId } from './types';

/** Offset table for the one-cell wall-kick nudge attempted on rotation. */
const NUDGE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-2, 0],
  [2, 0],
];

/**
 * Determine whether a piece's shape can be placed at a board position.
 *
 * A placement is legal when every `true` cell of the shape lands either inside
 * an empty board cell or in the out-of-bounds region *above* the board (so a
 * piece may spawn partially above the visible field). Left/right/below edges
 * and any occupied cell make the placement illegal.
 *
 * @param board   The board to test against.
 * @param shape   The piece shape (rotation state) being placed.
 * @param x       Column of the piece's top-left anchor.
 * @param y       Row of the piece's top-left anchor.
 * @returns       `true` when the piece fits without collision.
 */
export function canPlace(
  board: Board,
  shape: Shape,
  x: number,
  y: number,
): boolean {
  for (let row = 0; row < shape.length; row++) {
    for (let col = 0; col < shape[row].length; col++) {
      if (!shape[row][col]) {
        continue;
      }
      const boardRow = y + row;
      const boardCol = x + col;

      // Allow cells that sit above the board (negative rows) — this is how a
      // piece can spawn and slide near the top before becoming fully visible.
      const aboveBoard = boardRow < 0;

      const colInBounds = boardCol >= 0 && boardCol < board[0].length;
      const rowInBounds = boardRow >= 0 && boardRow < board.length;

      if (aboveBoard) {
        // Above the field: only horizontal bounds matter.
        if (!colInBounds) {
          return false;
        }
        continue;
      }

      if (!rowInBounds || !colInBounds) {
        return false;
      }
      if (board[boardRow][boardCol] !== null) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Write a piece's id into the board at its current anchor position.
 *
 * Returns a new board; the original is never mutated. Cells of the shape that
 * fall above the board (negative rows) are ignored.
 *
 * @param board  The source board.
 * @param id     The tetromino id to stamp into filled cells.
 * @param shape  The piece shape (rotation state).
 * @param x      Column of the piece's top-left anchor.
 * @param y      Row of the piece's top-left anchor.
 * @returns      A new board with the piece's cells filled.
 */
export function lockPiece(
  board: Board,
  id: TetrominoId,
  shape: Shape,
  x: number,
  y: number,
): Board {
  let next = board;
  for (let row = 0; row < shape.length; row++) {
    for (let col = 0; col < shape[row].length; col++) {
      if (!shape[row][col]) {
        continue;
      }
      const boardRow = y + row;
      const boardCol = x + col;
      if (!inBounds(next, boardRow, boardCol)) {
        continue;
      }
      next = setCell(next, boardRow, boardCol, id as Cell);
    }
  }
  return next;
}

/**
 * Attempt to translate a piece by `(dx, dy)`.
 *
 * @param board   The board.
 * @param shape   The piece's current shape.
 * @param x       Current anchor column.
 * @param y       Current anchor row.
 * @param dx      Horizontal delta (negative = left, positive = right).
 * @param dy      Vertical delta (positive = down).
 * @returns       The new `{ x, y }` on success, or `null` when the translation
 *                collides.
 */
export function tryMove(
  board: Board,
  shape: Shape,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { x: number; y: number } | null {
  const nx = x + dx;
  const ny = y + dy;
  if (canPlace(board, shape, nx, ny)) {
    return { x: nx, y: ny };
  }
  return null;
}

/**
 * Attempt to rotate a piece, applying a simple wall-kick nudge.
 *
 * Rotation policy (deliberately simple, documented for reviewers):
 *   - The shape is rotated one step (cw/ccw) using the index-based `rotate`.
 *   - If the rotated shape does not fit, we try a one-cell nudge in a small set
 *     of offsets (left, right, up, two-left, two-right) before giving up. This
 *     is *not* full SRS wall kicks — it is a minimal nudge that prevents the
 *     piece from feeling stuck against a wall while keeping the rules easy to
 *     reason about and test. The O-piece is rotationally symmetric, so this is
 *     a no-op for it.
 *
 * @param board        The board.
 * @param id           The piece's tetromino id (used to look up rotations).
 * @param rotation     Current rotation index (0–3).
 * @param x            Current anchor column.
 * @param y            Current anchor row.
 * @param direction    Rotation sense: `'cw'` (clockwise) or `'ccw'`.
 * @returns            The new `{ rotation, x, y }` on success, or `null` when
 *                     no nudge yields a valid placement.
 */
export function tryRotate(
  board: Board,
  id: TetrominoId,
  rotation: number,
  x: number,
  y: number,
  direction: 'cw' | 'ccw' = 'cw',
): { rotation: number; x: number; y: number } | null {
  const piece = TETROMINOES[id];
  const normalized = ((rotation % 4) + 4) % 4;
  const nextRotation =
    direction === 'cw'
      ? (normalized + 1) % 4
      : (normalized + 3) % 4; // ccw: -1 mod 4 == +3
  const rotatedShape = getShape(piece, nextRotation);

  for (const [dx, dy] of NUDGE_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (canPlace(board, rotatedShape, nx, ny)) {
      return { rotation: nextRotation, x: nx, y: ny };
    }
  }
  return null;
}
