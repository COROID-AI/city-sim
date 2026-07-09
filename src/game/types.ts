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

/** Rotation sense. Only clockwise is reachable via the arrow keys. */
export type RotationDirection = 'cw' | 'ccw';

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

/**
 * A random number generator matching the signature of `Math.random`.
 *
 * Returning a float in `[0, 1)` lets the state module stay deterministic and
 * testable by injecting a seeded/fixed sequence instead of the real
 * `Math.random`.
 */
export type Rng = () => number;

/**
 * The currently active (falling) tetromino.
 *
 * `x` / `y` are the top-left anchor of the piece's bounding box on the board
 * (column / row respectively). `rotation` is an index into the piece's
 * `rotations` array (0–3).
 */
export interface ActivePiece {
  readonly id: TetrominoId;
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Actions that drive the game state forward.
 *
 * Every user input and every gravity tick is represented as one of these
 * discriminated-union variants, so the reducer in `state.ts` can switch on
 * `action.type` exhaustively.
 */
export type Action =
  | { readonly type: 'move'; readonly dir: Direction }
  | { readonly type: 'rotate'; readonly dir: RotationDirection }
  | { readonly type: 'softDrop' }
  | { readonly type: 'hardDrop' }
  | { readonly type: 'tick' };

/**
 * Complete immutable snapshot of the game at a point in time.
 *
 * Every transition returns a brand-new object so that React-style rendering
 * and time-travel debugging remain possible.
 */
export interface GameState {
  /** The configuration the game was started with. */
  readonly config: GameConfig;
  /** The playing field. */
  readonly board: Board;
  /** The piece currently falling, or `null` when between lock and spawn. */
  readonly current: ActivePiece | null;
  /** The id of the next piece to spawn (shown in the preview). */
  readonly next: TetrominoId;
  /** Total accumulated score. */
  readonly score: number;
  /** Current difficulty level (starts at 1, increases every 10 lines). */
  readonly level: number;
  /** Total lines cleared across the game. */
  readonly lines: number;
  /** `true` once a piece cannot be spawned (board overflow). */
  readonly gameOver: boolean;
}
