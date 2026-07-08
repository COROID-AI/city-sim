/**
 * Pure game state reducer.
 *
 * Owns the high-level `GameState` snapshot and the `applyAction` reducer that
 * the input layer will drive. No DOM or browser APIs are used so the module
 * stays fully unit-testable.
 */

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  cloneBoard,
  createBoard,
  type Board,
} from "./board.js";
import {
  isGameOver,
  lockAndAdvance,
  spawnPiece,
  tryMove,
  tryRotate,
  type ActivePiece,
} from "./rules.js";
import { ALL_TETROMINO_TYPES, type TetrominoType } from "./tetrominoes.js";

/** Player actions that drive the game. */
export type Action =
  | { readonly type: "MoveLeft" }
  | { readonly type: "MoveRight" }
  | { readonly type: "Rotate" }
  | { readonly type: "SoftDrop" }
  | { readonly type: "HardDrop" }
  | { readonly type: "Tick" };

/** A complete, immutable snapshot of the game. */
export interface GameState {
  readonly board: Board;
  readonly current: ActivePiece | null;
  readonly queue: readonly TetrominoType[];
  readonly bag: readonly TetrominoType[];
  readonly score: number;
  readonly lines: number;
  readonly level: number;
  readonly gameOver: boolean;
  /** Injectable RNG carried with the state for deterministic sequences. */
  readonly random: () => number;
}

/** Options for starting a new game. */
export interface GameOptions {
  readonly random?: () => number;
  readonly width?: number;
  readonly height?: number;
}

/** Points awarded for clearing 0..4 lines at once (scaled by level). */
const LINE_SCORES: readonly number[] = [0, 100, 300, 500, 800];

/** Minimum number of upcoming pieces kept buffered (look-ahead for the UI). */
const LOOKAHEAD = 7;

/** Fisher–Yates shuffle producing a fresh 7-bag. */
function shuffleBag(random: () => number): TetrominoType[] {
  const bag = ALL_TETROMINO_TYPES.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = bag[i];
    bag[i] = bag[j];
    bag[j] = tmp;
  }
  return bag;
}

/**
 * Draws from `bag` (refilling it with a new shuffled 7-bag when empty) into
 * `queue` until at least `needed` pieces are buffered.
 */
function ensureQueue(
  queue: TetrominoType[],
  bag: TetrominoType[],
  random: () => number,
  needed: number
): { queue: TetrominoType[]; bag: TetrominoType[] } {
  let nextBag = bag;
  while (queue.length < needed) {
    if (nextBag.length === 0) {
      nextBag = shuffleBag(random);
    }
    queue.push(nextBag.shift() as TetrominoType);
  }
  return { queue, bag: nextBag };
}

/** Starts a new game with an empty board and a freshly spawned piece. */
export function newGame(options: GameOptions = {}): GameState {
  const random = options.random ?? Math.random;
  const width = options.width ?? BOARD_WIDTH;
  const height = options.height ?? BOARD_HEIGHT;
  const board = createBoard(width, height);

  let queue: TetrominoType[] = [];
  let bag: TetrominoType[] = [];
  ({ queue, bag } = ensureQueue(queue, bag, random, LOOKAHEAD));

  const firstType = queue.shift() as TetrominoType;
  const current = spawnPiece(firstType, width);
  ({ queue, bag } = ensureQueue(queue, bag, random, LOOKAHEAD));

  return {
    board,
    current,
    queue,
    bag,
    score: 0,
    lines: 0,
    level: 1,
    gameOver: isGameOver(board, current),
    random,
  };
}

/** Returns an independent copy of an active piece. */
function clonePiece(piece: ActivePiece): ActivePiece {
  return {
    type: piece.type,
    rotation: piece.rotation,
    row: piece.row,
    col: piece.col,
  };
}

/** Shared outcome of locking a piece into the board and spawning the next. */
interface LockOutcome {
  readonly queue: TetrominoType[];
  readonly bag: TetrominoType[];
  readonly current: ActivePiece;
  readonly lines: number;
  readonly level: number;
  readonly score: number;
  readonly gameOver: boolean;
}

/**
 * Locks `piece` into the board, clears full lines, spawns the next piece from
 * the 7-bag, and recomputes score/level. Shared by both `HardDrop` and the
 * gravity `Tick` so the lock-and-spawn behaviour stays identical and in one
 * place.
 */
function lockCurrentPiece(
  board: Board,
  piece: ActivePiece,
  queue: TetrominoType[],
  bag: TetrominoType[],
  random: () => number,
  lines: number,
  level: number,
  score: number
): LockOutcome {
  const nextType = queue.shift() as TetrominoType;
  const ensured = ensureQueue(queue, bag, random, LOOKAHEAD);

  const result = lockAndAdvance(board, piece, nextType);
  const newLines = lines + result.cleared;
  const newScore = score + LINE_SCORES[result.cleared] * level;
  const newLevel = Math.floor(newLines / 10) + 1;

  return {
    queue: ensured.queue,
    bag: ensured.bag,
    current: result.current,
    lines: newLines,
    level: newLevel,
    score: newScore,
    gameOver: result.gameOver,
  };
}

/**
 * Applies a single action, returning a brand-new state.
 *
 * The input state is never mutated: the board and active piece are cloned
 * before any rule helper touches them.
 */
export function applyAction(state: GameState, action: Action): GameState {
  if (state.gameOver || state.current === null) {
    return state;
  }

  const random = state.random;
  const board = cloneBoard(state.board);
  const piece = clonePiece(state.current);
  let queue = state.queue.slice();
  let bag = state.bag.slice();
  let score = state.score;
  let lines = state.lines;
  let level = state.level;
  let current: ActivePiece = piece;
  let gameOver: boolean = state.gameOver;

  switch (action.type) {
    case "MoveLeft":
      tryMove(board, piece, 0, -1);
      break;
    case "MoveRight":
      tryMove(board, piece, 0, 1);
      break;
    case "Rotate":
      tryRotate(board, piece, 1);
      break;
    case "SoftDrop":
      if (tryMove(board, piece, 1, 0)) {
        score += 1;
      }
      break;
    case "HardDrop": {
      let dropped = 0;
      while (tryMove(board, piece, 1, 0)) {
        dropped += 1;
      }
      score += dropped * 2;

      const hardDropOutcome = lockCurrentPiece(
        board,
        piece,
        queue,
        bag,
        random,
        lines,
        level,
        score
      );
      queue = hardDropOutcome.queue;
      bag = hardDropOutcome.bag;
      current = hardDropOutcome.current;
      lines = hardDropOutcome.lines;
      level = hardDropOutcome.level;
      score = hardDropOutcome.score;
      gameOver = hardDropOutcome.gameOver;
      break;
    }
    case "Tick": {
      // Gravity: drop one row when possible; otherwise lock the piece.
      if (tryMove(board, piece, 1, 0)) {
        break;
      }
      const tickOutcome = lockCurrentPiece(
        board,
        piece,
        queue,
        bag,
        random,
        lines,
        level,
        score
      );
      queue = tickOutcome.queue;
      bag = tickOutcome.bag;
      current = tickOutcome.current;
      lines = tickOutcome.lines;
      level = tickOutcome.level;
      score = tickOutcome.score;
      gameOver = tickOutcome.gameOver;
      break;
    }
    default:
      break;
  }

  return { board, current, queue, bag, score, lines, level, gameOver, random };
}
