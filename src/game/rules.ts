/**
 * Pure game rules: placement, movement, rotation, locking, and gravity.
 *
 * Every function here is pure — it reads its inputs, computes a new state,
 * and never mutates the board, piece, or state it was given.
 */
import { clearFullRows, getCell, inBounds, setCell } from './board';
import { TETROMINOES } from './tetrominoes';
import type {
  Board,
  GameState,
  MoveDirection,
  Rotation,
  Tetromino,
} from './types';

/** Euclidean modulo so rotation indices stay in 0..3 for either direction. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Points awarded for clearing `count` rows at the current `level`.
 *
 * Follows the scoring table from the task's acceptance criteria:
 * - single (1 line) = 100 * level
 * - double (2 lines) = 200
 * - triple (3 lines) = 300
 * - tetris (4 lines) = 800
 *
 * `lockPiece` passes the level *before* the clear is applied — the level at
 * which the clear happened — so the score reflects the pre-clear level.
 */
function lineClearScore(count: number, level: number): number {
  switch (count) {
    case 1:
      return 100 * level;
    case 2:
      return 200;
    case 3:
      return 300;
    case 4:
      return 800;
    default:
      return 0;
  }
}

/**
 * Returns true when `piece` fits on `board` at (x, y): every non-empty cell
 * of the piece's 4x4 matrix lands inside the grid and on an empty cell.
 */
export function canPlace(
  board: Board,
  piece: Tetromino,
  x: number,
  y: number,
): boolean {
  for (let row = 0; row < piece.matrix.length; row++) {
    const matrixRow = piece.matrix[row];
    for (let col = 0; col < matrixRow.length; col++) {
      if (matrixRow[col] === 0) continue;
      if (!inBounds(board, x + col, y + row)) return false;
      if (getCell(board, x + col, y + row) !== 0) return false;
    }
  }
  return true;
}

/**
 * Translates the current piece one cell left or right. Returns the same
 * state (rejects) when the translated position is out of bounds or would
 * overlap a placed block.
 */
export function tryMove(state: GameState, dir: MoveDirection): GameState {
  const dx = dir === 'left' ? -1 : 1;
  const x = state.x + dx;

  if (!canPlace(state.board, state.current, x, state.y)) return state;

  return { ...state, x };
}

/**
 * Rotates the current piece 90 degrees in `dir` (1 = clockwise, -1 =
 * counter-clockwise) and returns a new state, or the same state (rejects)
 * when the rotated shape would overlap or go out of bounds.
 *
 * Rotation choice (documented): simple non-kick rotation with a one-cell
 * nudge attempt. The rotated matrix is picked straight from the piece's
 * precomputed rotation states. If it does not fit at the current position,
 * one horizontal nudge is tried — left first, then right — before giving
 * up. This is a deliberate simplification of the SRS wall-kick tables,
 * which are out of scope for this phase.
 */
export function tryRotate(state: GameState, dir: 1 | -1): GameState {
  const rotation = mod(state.rotation + dir, 4) as Rotation;
  const candidate = TETROMINOES[state.current.id][rotation];

  const attempts: Array<{ x: number; y: number }> = [
    { x: state.x, y: state.y },
    { x: state.x - 1, y: state.y },
    { x: state.x + 1, y: state.y },
  ];

  for (const { x, y } of attempts) {
    if (canPlace(state.board, candidate, x, y)) {
      return { ...state, current: candidate, rotation, x, y };
    }
  }

  return state;
}

/**
 * Writes the current piece's color cells into the board at its current
 * position, clears any full rows, and updates `score` (line-clear points),
 * `lines`, and `level` (level = floor(lines / 10)).
 *
 * Drop points are awarded by the caller at the moment the drop happens
 * (soft = 1/cell, hard = 2/cell); this function only scores line clears.
 * The returned state keeps `current`/`next` as-is; the caller spawns the
 * next piece afterwards.
 */
export function lockPiece(state: GameState): GameState {
  let board = state.board;

  for (let row = 0; row < state.current.matrix.length; row++) {
    const matrixRow = state.current.matrix[row];
    for (let col = 0; col < matrixRow.length; col++) {
      const cell = matrixRow[col];
      if (cell === 0) continue;
      board = setCell(board, state.x + col, state.y + row, cell);
    }
  }

  const { board: clearedBoard, count } = clearFullRows(board);
  const lines = state.lines + count;
  const level = Math.floor(lines / 10);

  return {
    ...state,
    board: clearedBoard,
    lines,
    level,
    score: state.score + lineClearScore(count, state.level),
  };
}

/** Result of one gravity step; `locked` is true when the piece must lock. */
export interface GravityResult {
  state: GameState;
  locked: boolean;
}

/**
 * Applies one row of gravity (the rule behind the 'tick' action). When the
 * piece can move down one row the translated state is returned with
 * `locked: false`; when it cannot (floor or block below), the state is
 * returned unchanged with `locked: true` so the reducer can lock it.
 */
export function applyGravity(state: GameState): GravityResult {
  if (state.gameOver) return { state, locked: false };

  if (canPlace(state.board, state.current, state.x, state.y + 1)) {
    return { state: { ...state, y: state.y + 1 }, locked: false };
  }

  return { state, locked: true };
}