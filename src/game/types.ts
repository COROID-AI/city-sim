/**
 * Shared game types for the Tetris implementation.
 */

/** Direction of a move or rotation input. */
export type Direction = 'left' | 'right' | 'down' | 'up';

/**
 * A single cell on the board.
 * 0 = empty; 1-7 identify the color of a placed tetromino.
 */
export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Identifiers of the seven standard tetrominoes. */
export type TetrominoId = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

/** A tetromino: its id plus a 4x4 rotation matrix. */
export interface Tetromino {
  id: TetrominoId;
  /** 4x4 grid; 0 = empty, 1-7 = piece color. */
  matrix: Cell[][];
}

/** The play field: `width` cells per row and `height` rows (10x20 by default). */
export type Board = Cell[][];

/** Immutable configuration shared by the game modules. */
export interface GameConfig {
  width: number;
  height: number;
  tickMs: number;
}

/** Rotation state index (0-3) of a tetromino within its rotation array. */
export type Rotation = 0 | 1 | 2 | 3;

/** Horizontal translate direction for a piece move. */
export type MoveDirection = 'left' | 'right';

/**
 * Random number source injected into the state helpers so all randomness is
 * deterministic under test. Returns a uniform value in [0, 1).
 */
export type RNG = () => number;

/**
 * An input or loop action consumed by the `step` reducer:
 * - `move`: translate the current piece left or right
 * - `rotate`: rotate the current piece 90 degrees (1 = CW, -1 = CCW)
 * - `softDrop`: move the piece down one row (1 point per cell)
 * - `hardDrop`: drop the piece to the floor (2 points per cell) then lock
 * - `tick`: gravity step (one row down); locks + spawns when blocked
 */
export type GameAction =
  | { type: 'move'; dir: MoveDirection }
  | { type: 'rotate'; dir: 1 | -1 }
  | { type: 'softDrop' }
  | { type: 'hardDrop' }
  | { type: 'tick' };

/**
 * Full immutable snapshot of a running game. `current` is the piece in play
 * (its matrix reflects the current `rotation` state); `next` is the piece
 * that will spawn when the current piece locks. Every update returns a new
 * state and never mutates the previous one.
 */
export interface GameState {
  board: Board;
  current: Tetromino;
  next: Tetromino;
  x: number;
  y: number;
  rotation: Rotation;
  score: number;
  level: number;
  lines: number;
  gameOver: boolean;
}