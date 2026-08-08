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

/**
 * Horizontal translation directions used by `move` actions and `tryMove`.
 */
export type MoveDirection = 'left' | 'right';

/**
 * Rotation direction: `1` = clockwise, `-1` = counter-clockwise.
 */
export type RotationDirection = 1 | -1;

/**
 * Random number generator injected into the state functions.
 *
 * All randomness (piece selection) flows through this function so tests can
 * supply deterministic sequences. It returns a float in `[0, 1)`.
 */
export type Rng = () => number;

/**
 * The complete immutable game state produced by the `step` reducer.
 */
export interface GameState {
  /** The play field with all locked pieces. */
  board: Board;
  /** The piece currently being controlled. */
  current: Tetromino;
  /** The next piece that will spawn when `current` locks. */
  next: Tetromino;
  /** Board x position of the current piece's rotation matrix. */
  x: number;
  /** Board y position of the current piece's rotation matrix. */
  y: number;
  /** Index into `current.rotations` (0-3, clockwise order). */
  rotation: number;
  /** Total score (line clears + soft/hard drop points). */
  score: number;
  /** `floor(lines / 10)`. */
  level: number;
  /** Total number of cleared lines. */
  lines: number;
  /** True once a spawned piece cannot be placed (top-out). */
  gameOver: boolean;
}

/**
 * Actions handled by the `step(state, action, rng)` reducer.
 */
export type GameAction =
  | { type: 'move'; dir: MoveDirection }
  | { type: 'rotate'; dir: RotationDirection }
  | { type: 'softDrop' }
  | { type: 'hardDrop' }
  | { type: 'tick' };