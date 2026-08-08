/**
 * Direction of movement / input for the game.
 */
export type Direction = 'left' | 'right' | 'down' | 'up';

/**
 * A single board cell: `0` is empty, `1`-`7` identify the piece colors.
 */
export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * The seven standard tetrominoes.
 */
export type TetrominoId = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

/**
 * A tetromino: its id plus its rotation states. Each rotation state is a
 * 4x4 matrix; occupied cells carry the piece color (`1`-`7`), empty cells
 * are `0`.
 */
export interface Tetromino {
  id: TetrominoId;
  /**
   * Rotation states ordered [spawn, 90°, 180°, 270°] (clockwise).
   */
  rotations: Cell[][][];
}

/**
 * The play field: a `Cell[][]` grid of width 10 x height 20, indexed
 * `[y][x]`.
 */
export type Board = Cell[][];

/**
 * Game configuration.
 */
export interface GameConfig {
  /** Board width in cells. */
  width: number;
  /** Board height in cells. */
  height: number;
  /** Milliseconds per gravity tick. */
  tickMs: number;
}