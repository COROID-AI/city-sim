import { clearFullRows, getCell, inBounds, setCell } from './board';
import type {
  Board,
  Cell,
  GameState,
  MoveDirection,
  RotationDirection,
} from './types';

/**
 * Base line-clear scores indexed by the number of rows cleared in a single
 * lock (`0` = no clear, `4` = Tetris).
 *
 * Per the game spec the awarded points are the base value multiplied by the
 * player's level at the time of the clear (`level = floor(lines / 10)`):
 * single = 100 * level, double = 200 * level, triple = 300 * level,
 * tetris = 800 * level. The spec writes these as `100 * level`, `200`,
 * `300`, `800`; the level multiplier applies uniformly.
 */
const LINE_CLEAR_SCORES: ReadonlyArray<number> = [0, 100, 200, 300, 800];

/**
 * The rotation-state matrix of the piece currently in play.
 */
function matrixAt(state: GameState): Cell[][] {
  return state.current.rotations[state.rotation];
}

/**
 * True when the shape `piece` can be placed at board position `(x, y)`.
 *
 * `piece` is a rotation-state matrix of a tetromino (for example
 * `state.current.rotations[state.rotation]`); every occupied cell must map
 * to a cell that is inside the board and currently empty.
 */
export function canPlace(board: Board, piece: Cell[][], x: number, y: number): boolean {
  for (let py = 0; py < piece.length; py++) {
    for (let px = 0; px < piece[py].length; px++) {
      if (piece[py][px] === 0) continue;
      const bx = x + px;
      const by = y + py;
      if (!inBounds(board, bx, by)) return false;
      if (getCell(board, bx, by) !== 0) return false;
    }
  }
  return true;
}

/**
 * Translate the current piece one cell horizontally.
 *
 * Returns a new state with `x` shifted by one cell; when the move would
 * collide (out of bounds or overlapping a locked cell) the original state
 * is returned unchanged, i.e. the move is rejected.
 */
export function tryMove(state: GameState, dir: MoveDirection): GameState {
  const dx = dir === 'left' ? -1 : 1;
  if (canPlace(state.board, matrixAt(state), state.x + dx, state.y)) {
    return { ...state, x: state.x + dx };
  }
  return state;
}

/**
 * Rotate the current piece one step (`dir = 1` clockwise, `-1`
 * counter-clockwise).
 *
 * Rotation choice: simple non-kick rotation. There is no Super Rotation
 * System wall-kick table. When the rotated shape collides at the current
 * position the function attempts a one-cell horizontal nudge (left first,
 * then right) before rejecting; if every placement fails the rotation is
 * rejected and the original state is returned unchanged.
 */
export function tryRotate(state: GameState, dir: RotationDirection): GameState {
  const rotations = state.current.rotations;
  const nextRotation =
    (state.rotation + (dir === 1 ? 1 : rotations.length - 1)) % rotations.length;
  const rotated = rotations[nextRotation];

  if (canPlace(state.board, rotated, state.x, state.y)) {
    return { ...state, rotation: nextRotation };
  }

  // One-cell nudge attempt (left, then right) before rejecting.
  if (canPlace(state.board, rotated, state.x - 1, state.y)) {
    return { ...state, rotation: nextRotation, x: state.x - 1 };
  }
  if (canPlace(state.board, rotated, state.x + 1, state.y)) {
    return { ...state, rotation: nextRotation, x: state.x + 1 };
  }
  return state;
}

/**
 * Lock the current piece into the board at its current position.
 *
 * Writes the piece's cells into the board, clears any full rows, awards
 * `dropPoints` (callers pass `2 * cells` for a hard drop; soft drops score
 * `1` per cell directly in the reducer), adds the line-clear score, and
 * updates `lines` / `level` (`level = floor(lines / 10)`).
 */
export function lockPiece(state: GameState, dropPoints = 0): GameState {
  const matrix = matrixAt(state);
  let board = state.board;
  for (let py = 0; py < matrix.length; py++) {
    for (let px = 0; px < matrix[py].length; px++) {
      const cell = matrix[py][px];
      if (cell === 0) continue;
      board = setCell(board, state.x + px, state.y + py, cell);
    }
  }

  const { board: clearedBoard, count } = clearFullRows(board);
  const lines = state.lines + count;
  const level = Math.floor(lines / 10);
  const levelAtClear = Math.floor(state.lines / 10);
  const score = state.score + dropPoints + LINE_CLEAR_SCORES[count] * levelAtClear;

  return { ...state, board: clearedBoard, score, lines, level };
}

/**
 * Apply one row of gravity to the current piece.
 *
 * Returns a new state with `y` lowered by one when the piece can fall; when
 * the move collides (the piece has landed), the original state is returned
 * unchanged and the caller is responsible for locking it.
 */
export function applyGravity(state: GameState): GameState {
  if (canPlace(state.board, matrixAt(state), state.x, state.y + 1)) {
    return { ...state, y: state.y + 1 };
  }
  return state;
}
