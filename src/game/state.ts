/**
 * State module: initial state creation, piece spawning, and the `step`
 * reducer. All randomness flows through the injected `rng` so the behavior
 * is fully deterministic under test.
 */
import { createBoard } from './board';
import { applyGravity, canPlace, lockPiece, tryMove, tryRotate } from './rules';
import { TETROMINOES } from './tetrominoes';
import type {
  Board,
  GameAction,
  GameConfig,
  GameState,
  RNG,
  Tetromino,
  TetrominoId,
} from './types';

/** Fixed piece order; `pickPiece` selects an index uniformly via `rng`. */
const PIECE_IDS: TetrominoId[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/**
 * Picks a fresh (rotation 0) tetromino using one draw from `rng`. The
 * `Math.min` guard keeps a buggy rng (e.g. exactly 1.0) from indexing past
 * the piece list.
 */
function pickPiece(rng: RNG): Tetromino {
  const index = Math.min(
    PIECE_IDS.length - 1,
    Math.floor(rng() * PIECE_IDS.length),
  );
  return TETROMINOES[PIECE_IDS[index]][0];
}

/** Horizontal spawn column centered on a board of the given width. */
function spawnX(width: number): number {
  return Math.floor((width - 4) / 2);
}

/**
 * Creates a fresh game: empty board, two random pieces (current + next) in
 * their rotation-0 state at the spawn column, and zero score/level/lines.
 */
export function createInitialState(
  config: GameConfig,
  rng: RNG,
): GameState {
  const board = createBoard(config.width, config.height);

  return {
    board,
    current: pickPiece(rng),
    next: pickPiece(rng),
    x: spawnX(config.width),
    y: 0,
    rotation: 0,
    score: 0,
    level: 0,
    lines: 0,
    gameOver: false,
  };
}

/**
 * Promotes the queued `next` piece to `current` at the spawn position and
 * queues a fresh random piece. When the spawn cells are occupied the piece
 * cannot be placed, so `gameOver` is set to true (the board is left as-is).
 */
export function spawnPiece(state: GameState, rng: RNG): GameState {
  const current = state.next;
  const next = pickPiece(rng);
  const x = spawnX(state.board[0]?.length ?? 10);

  if (!canPlace(state.board, current, x, 0)) {
    return { ...state, current, next, x, y: 0, rotation: 0, gameOver: true };
  }

  return { ...state, current, next, x, y: 0, rotation: 0 };
}

/**
 * Soft drop: move the current piece down one row and award 1 point per cell
 * descended. Rejects (returns the same state) when the piece cannot move.
 */
function softDrop(state: GameState): GameState {
  if (!canPlace(state.board, state.current, state.x, state.y + 1)) {
    return state;
  }
  return { ...state, y: state.y + 1, score: state.score + 1 };
}

/**
 * Hard drop: drop the current piece to the lowest valid row (2 points per
 * cell descended), lock it, and spawn the next piece.
 */
function hardDrop(state: GameState, rng: RNG): GameState {
  let y = state.y;
  while (canPlace(state.board, state.current, state.x, y + 1)) {
    y += 1;
  }
  const descended = y - state.y;
  const dropped: GameState = {
    ...state,
    y,
    score: state.score + 2 * descended,
  };
  return spawnPiece(lockPiece(dropped), rng);
}

/**
 * Gravity tick: apply one row of gravity. When the piece collides, lock it
 * and spawn the next piece. `spawnPiece` reports a top-out through
 * `gameOver` when the new piece cannot be placed.
 */
function tick(state: GameState, rng: RNG): GameState {
  const { state: afterGravity, locked } = applyGravity(state);
  if (!locked) return afterGravity;
  return spawnPiece(lockPiece(afterGravity), rng);
}

/**
 * The reducer: dispatches on `action.type` and returns a new immutable
 * state. Any action on a game-over state is a no-op.
 */
export function step(
  state: GameState,
  action: GameAction,
  rng: RNG,
): GameState {
  if (state.gameOver) return state;

  switch (action.type) {
    case 'move':
      return tryMove(state, action.dir);
    case 'rotate':
      return tryRotate(state, action.dir);
    case 'softDrop':
      return softDrop(state);
    case 'hardDrop':
      return hardDrop(state, rng);
    case 'tick':
      return tick(state, rng);
  }
}

/** Helper kept for callers that need the spawn column (e.g. the loop). */
export function getSpawnColumn(board: Board): number {
  return spawnX(board[0]?.length ?? 10);
}