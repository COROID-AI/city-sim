/**
 * Core game state and rules: spawning, movement, rotation with SRS wall-kicks,
 * gravity stepping, scoring, leveling, game-over detection, pause/resume.
 *
 * Pure state management; communicates state changes to a renderer via an
 * onChange callback. No DOM access here (except optional clock injection
 * for testing).
 */

import {
  SCORE_TABLE,
  LINES_PER_LEVEL,
  getGravityInterval,
  SOFT_DROP_DIVISOR,
  getKicks,
} from './config.js';
import {
  createBoard,
  isValidPosition,
  lockPiece,
  clearLines,
} from './board.js';
import { createPiece, createBag } from './tetrominoes.js';

/**
 * Creates a new game instance.
 * @param {object} [opts]
 * @param {() => number} [opts.rand] - Optional RNG for deterministic testing.
 */
export function createGame(opts = {}) {
  const rand = opts.rand || Math.random;
  const bag = createBag(rand);

  const state = {
    board: createBoard(),
    piece: null,
    nextPiece: null,
    score: 0,
    lines: 0,
    level: 0,
    isGameOver: false,
    isPaused: false,
    softDropActive: false,
  };

  // Listeners notified on every meaningful state change
  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* listener errors must not break the game */
      }
    });
  }

  /** @param {() => void} fn */
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * Promotes nextPiece to the active piece and refills the preview.
   * Detects game-over when the new piece overlaps locked cells.
   */
  function spawnNextFromQueue() {
    state.piece = state.nextPiece;
    state.nextPiece = createPiece(bag.next());
    const valid = isValidPosition(state.board, state.piece);
    if (!valid) {
      state.isGameOver = true;
    }
    notify();
    return valid;
  }

  /** Initialize the first two pieces. */
  function init() {
    state.board = createBoard();
    state.score = 0;
    state.lines = 0;
    state.level = 0;
    state.isGameOver = false;
    state.isPaused = false;
    state.softDropActive = false;
    state.nextPiece = createPiece(bag.next());
    spawnNextFromQueue();
  }

  /** Try to move the active piece by (dx, dy). Returns true on success. */
  function tryMove(dx, dy) {
    if (state.isGameOver || state.isPaused || !state.piece) return false;
    if (isValidPosition(state.board, state.piece, dx, dy)) {
      state.piece.x += dx;
      state.piece.y += dy;
      notify();
      return true;
    }
    return false;
  }

  /**
   * Try to rotate the active piece clockwise (1) or counter-clockwise (-1).
   * Applies SRS wall-kicks when blocked. Returns true if rotation succeeded.
   */
  function tryRotate(dir = 1) {
    if (state.isGameOver || state.isPaused || !state.piece) return false;
    const { type } = state.piece;
    // O-piece never rotates
    if (type === 'O') return false;

    const fromRot = state.piece.rotation;
    const toRot = ((fromRot + dir) % 4 + 4) % 4;
    const kicks = getKicks(type, fromRot, toRot);

    for (let i = 0; i < kicks.length; i++) {
      const [kdx, kdy] = kicks[i];
      if (isValidPosition(state.board, state.piece, kdx, kdy, toRot)) {
        state.piece.rotation = toRot;
        state.piece.x += kdx;
        state.piece.y += kdy;
        notify();
        return true;
      }
    }
    return false;
  }

  /**
   * Compute the ghost piece's Y (the lowest row the current piece can drop to).
   */
  function getGhostY() {
    if (!state.piece) return 0;
    let dy = 0;
    while (isValidPosition(state.board, state.piece, 0, dy + 1)) {
      dy++;
    }
    return state.piece.y + dy;
  }

  /** Lock the active piece, clear lines, update score, then spawn next. */
  function lockAndAdvance() {
    if (!state.piece) return;
    state.board = lockPiece(state.board, state.piece);
    const result = clearLines(state.board);
    state.board = result.board;

    if (result.cleared > 0) {
      state.lines += result.cleared;
      const points = SCORE_TABLE[result.cleared] * (state.level + 1);
      state.score += points;
      // Level up every LINES_PER_LEVEL lines
      state.level = Math.floor(state.lines / LINES_PER_LEVEL);
    }

    spawnNextFromQueue();
  }

  /**
   * Advance the game by one gravity tick. If the piece cannot move down,
   * it is locked and the next piece spawns.
   * @returns {boolean} true if the piece moved, false if it locked
   */
  function step() {
    if (state.isGameOver || state.isPaused || !state.piece) return false;
    if (isValidPosition(state.board, state.piece, 0, 1)) {
      state.piece.y += 1;
      notify();
      return true;
    }
    lockAndAdvance();
    return false;
  }

  /**
   * Perform a soft-drop tick: move down one row if possible.
   * Used by the loop when ArrowDown is held (at soft-drop speed).
   * @returns {boolean} true if the piece moved down
   */
  function softDrop() {
    if (state.isGameOver || state.isPaused || !state.piece) return false;
    if (isValidPosition(state.board, state.piece, 0, 1)) {
      state.piece.y += 1;
      notify();
      return true;
    }
    lockAndAdvance();
    return false;
  }

  /** Pause or resume the game. */
  function togglePause() {
    if (state.isGameOver) return;
    state.isPaused = !state.isPaused;
    notify();
  }

  /** Full reset: reinitialize the board and start fresh. */
  function reset() {
    init();
  }

  /**
   * Returns a deep snapshot of the game state for testing.
   */
  function snapshot() {
    return {
      board: state.board.map((row) => [...row]),
      piece: state.piece ? { ...state.piece } : null,
      nextPiece: state.nextPiece ? { ...state.nextPiece } : null,
      score: state.score,
      lines: state.lines,
      level: state.level,
      isGameOver: state.isGameOver,
      isPaused: state.isPaused,
      softDropActive: state.softDropActive,
    };
  }

  // Bootstrap initial state
  init();

  return {
    state,
    init,
    reset,
    onChange,
    tryMove,
    tryRotate,
    getGhostY,
    step,
    softDrop,
    lockAndAdvance,
    togglePause,
    snapshot,
    /** Returns the gravity interval (ms per row) for the current level. */
    getGravityInterval: () => getGravityInterval(state.level),
    /** Returns the soft-drop interval (ms per row) for the current level. */
    getSoftDropInterval: () =>
      Math.max(1, Math.round(getGravityInterval(state.level) / SOFT_DROP_DIVISOR)),
  };
}
