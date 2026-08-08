import { createBoard } from './board';
import { applyGravity, canPlace, lockPiece, tryMove, tryRotate } from './rules';
import { TETROMINOES } from './tetrominoes';
import type {
  Cell,
  GameAction,
  GameConfig,
  GameState,
  Rng,
  Tetromino,
  TetrominoId,
} from './types';

/**
 * Piece draw order used with the injected rng (index = floor(rng() * 7)).
 */
const PIECE_IDS: TetrominoId[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/**
 * Draw the next tetromino from the injected rng.
 */
function randomTetromino(rng: Rng): Tetromino {
  const index = Math.min(
    PIECE_IDS.length - 1,
    Math.floor(rng() * PIECE_IDS.length),
  );
  return TETROMINOES[PIECE_IDS[index]];
}

/**
 * Rotation-state matrix of the piece currently in play.
 */
function currentMatrix(state: GameState): Cell[][] {
  return state.current.rotations[state.rotation];
}

/**
 * Create a fresh game state: an empty board, a spawned `current` piece, and
 * a queued `next` piece, both drawn from `rng`.
 */
export function createInitialState(config: GameConfig, rng: Rng): GameState {
  const board = createBoard(config.width, config.height);
  const next = randomTetromino(rng);
  // `current` is a placeholder — spawning promotes the queued piece.
  const base: GameState = {
    board,
    current: next,
    next,
    x: 0,
    y: 0,
    rotation: 0,
    score: 0,
    level: 0,
    lines: 0,
    gameOver: false,
  };
  return spawnPiece(base, rng);
}

/**
 * Promote the queued piece to `current`, draw a fresh `next` piece, and
 * place the new piece at the spawn position (horizontally centered, top of
 * the board). When the spawn position is occupied the piece cannot be
 * placed and `gameOver` is set to true (top-out).
 */
export function spawnPiece(state: GameState, rng: Rng): GameState {
  const current = state.next;
  const next = randomTetromino(rng);
  const width = state.board.length === 0 ? 0 : state.board[0].length;
  const x = Math.floor((width - 4) / 2);
  const y = 0;
  const rotation = 0;

  const placed: GameState = { ...state, current, next, x, y, rotation };
  if (!canPlace(state.board, current.rotations[0], x, y)) {
    return { ...placed, gameOver: true };
  }
  return placed;
}

/**
 * Number of rows the current piece can fall before colliding.
 */
function dropDistance(state: GameState): number {
  let distance = 0;
  while (canPlace(state.board, currentMatrix(state), state.x, state.y + distance + 1)) {
    distance++;
  }
  return distance;
}

/**
 * The state reducer.
 *
 * Dispatches on `action.type` and always returns a new immutable state (or
 * the same reference for a rejected operation). All randomness flows through
 * the injected `rng`. Once `gameOver` is set, every action is a no-op.
 *
 * - `move` / `rotate` delegate to the pure rules in `rules.ts`.
 * - `softDrop` moves the piece one row down and scores 1 point per cell.
 * - `hardDrop` drops the piece to its landing position, scores 2 points per
 *   cell descended, locks it, and spawns the next piece.
 * - `tick` applies gravity; on collision the piece is locked and the next
 *   piece spawns.
 */
export function step(state: GameState, action: GameAction, rng: Rng): GameState {
  if (state.gameOver) return state;

  switch (action.type) {
    case 'move':
      return tryMove(state, action.dir);
    case 'rotate':
      return tryRotate(state, action.dir);
    case 'softDrop': {
      if (!canPlace(state.board, currentMatrix(state), state.x, state.y + 1)) {
        return state;
      }
      return { ...state, y: state.y + 1, score: state.score + 1 };
    }
    case 'hardDrop': {
      const distance = dropDistance(state);
      const dropped = { ...state, y: state.y + distance };
      const locked = lockPiece(dropped, 2 * distance);
      return spawnPiece(locked, rng);
    }
    case 'tick': {
      const fallen = applyGravity(state);
      if (fallen === state) {
        // Gravity collided: lock in place and spawn the next piece.
        const locked = lockPiece(state);
        return spawnPiece(locked, rng);
      }
      return fallen;
    }
    default:
      return state;
  }
}
