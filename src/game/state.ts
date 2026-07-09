/**
 * Immutable game-state reducer for Tetris.
 *
 * This module owns the *narrative* of the game: spawning pieces, applying
 * moves/rotations/drops, locking pieces into the board, clearing lines, and
 * scoring. It is fully deterministic because randomness is injected via the
 * `rng` parameter — there is no module-level `Math.random` anywhere.
 *
 * Every transition returns a brand-new {@link GameState}; inputs are never
 * mutated, which keeps React-style rendering and time-travel debugging viable.
 */

import {
  Action,
  ActivePiece,
  Board,
  Direction,
  GameConfig,
  GameState,
  Rng,
  TetrominoId,
} from './types';
import { clearFullRows, createBoard } from './board';
import { getShape, TETROMINO_IDS, TETROMINOES } from './tetrominoes';
import { canPlace, lockPiece, tryMove, tryRotate } from './rules';

/**
 * Default 10×20 board with standard spawn position and a comfortable starting
 * gravity interval. Exported so tests and the UI can share one source of truth.
 */
export const DEFAULT_CONFIG: GameConfig = {
  columns: 10,
  rows: 20,
  spawnColumn: 3,
  spawnRow: 0,
  baseDropIntervalMs: 1000,
};

/** Lines that must be cleared before the level increases. */
const LINES_PER_LEVEL = 10;

/**
 * Standard Tetris line-clear scoring table.
 *
 * Index = lines cleared in a single lock (0 unused). Values are the *base*
 * points; the actual award multiplies by the current level:
 *   1 line → 100, 2 lines → 200, 3 lines → 300, 4 lines → 800.
 */
const LINE_SCORES: ReadonlyArray<number> = [0, 100, 200, 300, 800];

/**
 * Pick a tetromino id using the injected rng.
 *
 * @param rng  A `Math.random`-compatible function returning a float in [0, 1).
 * @returns    A random {@link TetrominoId}.
 */
function randomId(rng: Rng): TetrominoId {
  const index = Math.floor(rng() * TETROMINO_IDS.length);
  // Clamp to the valid range in case `rng()` returns exactly 1.
  const safe = Math.min(index, TETROMINO_IDS.length - 1);
  return TETROMINO_IDS[safe];
}

/**
 * Create the initial, empty game state.
 *
 * The first piece is chosen with the injected `rng` and becomes the active
 * piece; the *next* piece is also pre-rolled so the UI can show a preview.
 *
 * @param rng     Random source (defaults to `Math.random`; tests inject a stub).
 * @param config  Optional custom configuration.
 * @returns       A fresh {@link GameState} with the first piece on the board.
 */
export function createInitialState(
  rng: Rng = Math.random,
  config: GameConfig = DEFAULT_CONFIG,
): GameState {
  const board = createBoard(config.rows, config.columns);
  const firstId = randomId(rng);
  const nextId = randomId(rng);

  const state: GameState = {
    config,
    board,
    current: null,
    next: nextId,
    score: 0,
    level: 1,
    lines: 0,
    gameOver: false,
  };

  return spawnPiece(state, firstId);
}

/**
 * Spawn a new piece at the configured spawn anchor.
 *
 * If the spawn position collides with existing blocks, the game is over.
 *
 * @param state  The state to spawn into.
 * @param id     The tetromino id to spawn (falls back to `state.next`).
 * @returns      A new state with the spawned piece active.
 */
export function spawnPiece(
  state: GameState,
  id: TetrominoId = state.next,
): GameState {
  const { config } = state;
  const piece: ActivePiece = {
    id,
    rotation: 0,
    x: config.spawnColumn,
    y: config.spawnRow,
  };

  const shape = getShape(TETROMINOES[id], 0);
  const canSpawn = canPlace(state.board, shape, piece.x, piece.y);

  if (!canSpawn) {
    return { ...state, current: piece, gameOver: true };
  }

  return { ...state, current: piece };
}

/**
 * Advance a piece one row downward (gravity). Returns `null` if it cannot drop
 * further (meaning it should be locked).
 */
function dropOne(state: GameState): ActivePiece | null {
  if (!state.current) {
    return null;
  }
  const shape = getShape(TETROMINOES[state.current.id], state.current.rotation);
  const moved = tryMove(
    state.board,
    shape,
    state.current.x,
    state.current.y,
    0,
    1,
  );
  return moved ? { ...state.current, ...moved } : null;
}

/**
 * Lock the active piece, clear full lines, update score/level, and spawn the
 * next piece. Shared by `hardDrop` and `tick`.
 */
function lockAndAdvance(state: GameState): GameState {
  if (!state.current) {
    return state;
  }

  const piece = state.current;
  const shape = getShape(TETROMINOES[piece.id], piece.rotation);
  const locked = lockPiece(state.board, piece.id, shape, piece.x, piece.y);

  const { board, linesCleared } = clearFullRows(locked);

  const basePoints = LINE_SCORES[linesCleared] ?? 0;
  const linePoints = basePoints * state.level;
  const newLines = state.lines + linesCleared;
  const newLevel = Math.floor(newLines / LINES_PER_LEVEL) + 1;

  const intermediate: GameState = {
    ...state,
    board,
    current: null,
    score: state.score + linePoints,
    lines: newLines,
    level: newLevel,
  };

  return spawnPiece(intermediate);
}

/**
 * Apply a hard drop: slam the piece to the floor, scoring 2 points per cell.
 *
 * @returns A new state with the piece locked and the next piece spawned.
 */
function applyHardDrop(state: GameState): GameState {
  if (!state.current) {
    return state;
  }

  let x = state.current.x;
  let y = state.current.y;
  const id = state.current.id;
  const rotation = state.current.rotation;
  const shape = getShape(TETROMINOES[id], rotation);

  let dropped = 0;
  while (canPlace(state.board, shape, x, y + 1)) {
    y += 1;
    dropped += 1;
  }

  const droppedState: GameState = {
    ...state,
    current: { id, rotation, x, y },
    score: state.score + dropped * 2,
  };

  return lockAndAdvance(droppedState);
}

/**
 * The main reducer. Given a state and an {@link Action}, returns the next
 * state. Pure and deterministic.
 *
 * Behaviour by action type:
 *   - `move`     — translate left/right/down; reject on collision.
 *   - `rotate`   — rotate cw/ccw with a wall-kick nudge; reject on collision.
 *   - `softDrop` — move one cell down; +1 point if it moves, otherwise lock.
 *   - `hardDrop` — drop to the floor; +2 points/cell, then lock and advance.
 *   - `tick`     — gravity: move one cell down, or lock if it can't.
 *
 * If the game is over or there is no active piece, the state is returned
 * unchanged (except that a `tick` with no current piece has nothing to do).
 *
 * @param state   The current state.
 * @param action  The action to apply.
 * @returns       The next state.
 */
export function step(state: GameState, action: Action): GameState {
  if (state.gameOver) {
    return state;
  }
  if (!state.current) {
    return state;
  }

  const piece = state.current;
  const shape = getShape(TETROMINOES[piece.id], piece.rotation);

  switch (action.type) {
    case 'move': {
      const [dx, dy] =
        action.dir === Direction.Left
          ? [-1, 0]
          : action.dir === Direction.Right
            ? [1, 0]
            : [0, 1]; // Down
      const moved = tryMove(state.board, shape, piece.x, piece.y, dx, dy);
      if (!moved) {
        return state;
      }
      return { ...state, current: { ...piece, ...moved } };
    }

    case 'rotate': {
      const rotated = tryRotate(
        state.board,
        piece.id,
        piece.rotation,
        piece.x,
        piece.y,
        action.dir,
      );
      if (!rotated) {
        return state;
      }
      return { ...state, current: { ...piece, ...rotated } };
    }

    case 'softDrop': {
      const moved = dropOne(state);
      if (moved) {
        return { ...state, current: moved, score: state.score + 1 };
      }
      // Can't drop further: lock.
      return lockAndAdvance(state);
    }

    case 'hardDrop': {
      return applyHardDrop(state);
    }

    case 'tick': {
      const moved = dropOne(state);
      if (moved) {
        return { ...state, current: moved };
      }
      // Gravity can't lower the piece: lock it.
      return lockAndAdvance(state);
    }

    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** Re-exported for convenience and to keep the board import surface tidy. */
export type { Board };
