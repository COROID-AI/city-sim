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