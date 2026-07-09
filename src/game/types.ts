/**
 * Core type definitions for the Tetris game.
 *
 * This module is intentionally pure data — no DOM, no I/O, no randomness — so
 * that the entire game model can be unit-tested headlessly with Jest.
 */

/** Player input is restricted to the four arrow keys. */
export enum Direction {
  Left = 'Left',
  Right = 'Right',
  Down = 'Down',
}

/**
 * A single cell on the board.
 *
 * `null` represents an empty cell; otherwise the value is the id of the
 * tetromino that filled it. We store the tetromino id (rather than a colour)
 * so the board stays pure data and the renderer can decide how to paint it.
 */
export type Cell = TetrominoId | null;

/** The seven standard tetrominoes plus an empty marker. */
export enum TetrominoId {
  I = 'I',
  O = 'O',
  T = 'T',
  S = 'S',
  Z = 'Z',
  J = 'J',
  L = 'L',
}

/** A 2D matrix of filled/empty cells that defines one rotation of a piece. */
export type Shape = ReadonlyArray<ReadonlyArray<boolean>>;

/**
 * A tetromino definition: its id, the four rotation states, and the colour
 * used to render it. The `rotations` array always contains exactly four
 * entries (the 0°, 90°, 180° and 270° states).
 */
export interface Tetromino {
  readonly id: TetrominoId;
  readonly color: string;
  readonly rotations: readonly Shape[];
}

/** The playing field is a grid of cells indexed `[row][col]` (top-to-bottom). */
export type Board = ReadonlyArray<ReadonlyArray<Cell>>;

/** Tunable configuration for the game. */
export interface GameConfig {
  /** Number of columns in the board. */
  readonly columns: number;
  /** Number of rows in the board. */
  readonly rows: number;
  /** Starting column for a newly-spawned piece (top-left anchor). */
  readonly spawnColumn: number;
  /** Starting row for a newly-spawned piece (top-left anchor). */
  readonly spawnRow: number;
  /** Milliseconds between automatic gravity steps at level 1. */
  readonly baseDropIntervalMs: number;
}
