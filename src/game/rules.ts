/**
 * Pure Tetris rule helpers operating on a board and the active piece.
 *
 * `tryMove` and `tryRotate` only ever read the board and mutate the active
 * piece on success; on failure nothing is touched. No browser APIs are used.
 */

import {
  BOARD_WIDTH,
  clearLines,
  collides,
  mergePiece,
  type Board,
} from "./board";
import { TETROMINOES, type TetrominoType } from "./tetrominoes";

/** The currently controlled tetromino. Mutated in place by the rule helpers. */
export interface ActivePiece {
  type: TetrominoType;
  rotation: number;
  row: number;
  col: number;
}

/**
 * Wall-kick offsets [dRow, dCol] tried, in order, when a rotation would
 * collide. A small, generic table that handles the common left-wall, right-wall
 * and floor-kick cases for every piece.
 */
const WALL_KICKS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, -1],
  [0, 1],
  [-1, 0],
  [0, -2],
  [0, 2],
];

/**
 * Attempts to translate the piece by (dRow, dCol).
 *
 * Returns `true` and updates the piece on success. Returns `false` and leaves
 * the piece and board untouched on failure. The board is never mutated.
 */
export function tryMove(
  board: Board,
  piece: ActivePiece,
  dRow: number,
  dCol: number
): boolean {
  const newRow = piece.row + dRow;
  const newCol = piece.col + dCol;
  if (collides(board, piece.type, piece.rotation, newRow, newCol)) {
    return false;
  }
  piece.row = newRow;
  piece.col = newCol;
  return true;
}

/**
 * Attempts to rotate the piece (`direction` 1 = clockwise, -1 = counter-
 * clockwise), applying wall kicks where necessary.
 *
 * Returns `true` and updates the piece on success. Returns `false` and leaves
 * the piece and board untouched on failure. The board is never mutated.
 */
export function tryRotate(
  board: Board,
  piece: ActivePiece,
  direction: 1 | -1 = 1
): boolean {
  const newRotation = (((piece.rotation + direction) % 4) + 4) % 4;
  for (const [dRow, dCol] of WALL_KICKS) {
    if (
      !collides(
        board,
        piece.type,
        newRotation,
        piece.row + dRow,
        piece.col + dCol
      )
    ) {
      piece.rotation = newRotation;
      piece.row += dRow;
      piece.col += dCol;
      return true;
    }
  }
  return false;
}

/** Creates a freshly spawned piece centred horizontally at the top. */
export function spawnPiece(
  type: TetrominoType,
  width: number = BOARD_WIDTH
): ActivePiece {
  const pieceWidth = TETROMINOES[type].rotations[0][0].length;
  return {
    type,
    rotation: 0,
    row: 0,
    col: Math.floor((width - pieceWidth) / 2),
  };
}

/**
 * True when the supplied piece overlaps the board (e.g. a freshly spawned
 * piece that cannot fit) — the condition that ends the game.
 */
export function isGameOver(board: Board, piece: ActivePiece): boolean {
  return collides(board, piece.type, piece.rotation, piece.row, piece.col);
}

/** Result of locking a piece and spawning the next one. */
export interface LockResult {
  readonly current: ActivePiece;
  readonly cleared: number;
  readonly gameOver: boolean;
}

/**
 * Locks `piece` into the board, clears any full lines, then spawns `nextType`
 * at the top of the board.
 *
 * Returns the new active piece, the number of lines cleared, and whether the
 * game is now over (the freshly spawned piece immediately collides).
 */
export function lockAndAdvance(
  board: Board,
  piece: ActivePiece,
  nextType: TetrominoType
): LockResult {
  mergePiece(board, piece.type, piece.rotation, piece.row, piece.col);
  const cleared = clearLines(board);
  const current = spawnPiece(nextType);
  return { current, cleared, gameOver: isGameOver(board, current) };
}
