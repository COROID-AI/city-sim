/**
 * Shared immutable types and constants for the Tetris game.
 *
 * Everything in this module is a pure declaration — no side effects, no I/O.
 * The game layer (game/) depends on these types and constants exclusively.
 */

// ---------------------------------------------------------------------------
// Board geometry
// ---------------------------------------------------------------------------

/** Number of visible rows on the play field. */
export const ROWS = 20;
/** Number of columns on the play field. */
export const COLS = 10;

/**
 * The board is modelled as a grid of colour indices. A value of `0` means the
 * cell is empty; any positive value is a 1-based index into {@link COLORS}.
 */
export type Board = number[][];

// ---------------------------------------------------------------------------
// Tetromino references
// ---------------------------------------------------------------------------

export type TetrominoId = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

/** A [row, col] offset within a rotation matrix. */
export type Cell = readonly [row: number, col: number];

/**
 * A single rotation state: a list of the filled cells within a 4×4 (or smaller)
 * bounding box. Stored relative to the top-left of that bounding box.
 */
export type Rotation = readonly Cell[];

/** All four rotation states of a tetromino, ordered clockwise. */
export type TetrominoShape = readonly [Rotation, Rotation, Rotation, Rotation];

// ---------------------------------------------------------------------------
// Active piece
// ---------------------------------------------------------------------------

/** The piece currently under player control. */
export interface ActivePiece {
  readonly id: TetrominoId;
  /** Index into the four rotation states (0–3). */
  readonly rotationIndex: number;
  /** Top-left position of the piece's bounding box on the board. */
  readonly position: { readonly row: number; readonly col: number };
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type GameStatus = "idle" | "playing" | "gameOver";

/** The complete, serialisable state of a game at an instant in time. */
export interface GameState {
  readonly status: GameStatus;
  readonly board: Board;
  readonly active: ActivePiece | null;
  readonly nextId: TetrominoId;
  readonly score: number;
  readonly level: number;
  readonly lines: number;
  /**
   * Whether the player is currently holding the soft-drop key. The tick loop
   * honours this to apply a faster fall rate.
   */
  readonly softDrop: boolean;
  /**
   * Accumulated gravity time (ms) that has not yet been converted into a
   * downward step.
   */
  readonly gravityAccumulator: number;
  /**
   * Time (ms) the active piece has been resting on a surface without moving.
   * Used to implement lock delay.
   */
  readonly lockTimer: number;
  /** Game clock in milliseconds, advanced by the tick loop. */
  readonly elapsed: number;
  /** Persisted best score. */
  readonly highScore: number;
}

// ---------------------------------------------------------------------------
// Gravity / timing
// ---------------------------------------------------------------------------

/** Milliseconds per gravity step at a given level (0-based index). */
export const GRAVITY_MS: readonly number[] = [
  1000, 793, 618, 473, 355, 262, 190, 135, 94, 64, 43, 28, 18, 11, 7, 5, 4, 3,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1,
];

/**
 * Lock delay: how long (ms) a piece may rest on a surface before it locks.
 * Industry standard is ~500ms.
 */
export const LOCK_DELAY_MS = 500;

/** Acceleration factor applied to gravity while soft-dropping. */
export const SOFT_DROP_FACTOR = 20;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Base points awarded for clearing 1, 2, 3, or 4 lines (indexed 1–4). */
export const LINE_SCORES: readonly number[] = [0, 100, 300, 500, 800];

/** Number of lines that must be cleared to advance one level. */
export const LINES_PER_LEVEL = 10;
