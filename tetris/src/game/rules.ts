/**
 * Pure game rule engine — the heart of Tetris.
 *
 * Every function here is pure: no DOM, no canvas, no I/O, no mutation of input
 * arguments. State transitions always return new objects. This makes the entire
 * rules layer fully unit-testable in isolation.
 */

import { createBag, mulberry32, type Bag, type RandomFn } from "./bag";
import { colorIndexOf, SHAPES } from "./tetrominoes";
import type {
  ActivePiece,
  Board,
  Cell,
  GameState,
  TetrominoId,
} from "./types";
import {
  COLS,
  GRAVITY_MS,
  LINE_SCORES,
  LINES_PER_LEVEL,
  LOCK_DELAY_MS,
  ROWS,
  SOFT_DROP_FACTOR,
} from "./types";

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

/** Create a fresh empty board: {@link ROWS} × {@link COLS} grid of zeros. */
export function createEmptyBoard(): Board {
  return Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0));
}

/** Deep-clone a board (used internally before mutations). */
function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

// ---------------------------------------------------------------------------
// Collision & piece queries
// ---------------------------------------------------------------------------

/**
 * Return the absolute board coordinates of every filled cell in `piece`.
 */
export function getCells(piece: ActivePiece): Cell[] {
  const rotation = SHAPES[piece.id][piece.rotationIndex]!;
  return rotation.map(([r, c]) => [
    piece.position.row + r,
    piece.position.col + c,
  ] as Cell);
}

/**
 * Does `piece` collide with the walls, floor, or settled blocks of `board`?
 */
export function collides(board: Board, piece: ActivePiece): boolean {
  const cells = getCells(piece);
  for (const [r, c] of cells) {
    if (c < 0 || c >= COLS || r >= ROWS) return true;
    if (r >= 0 && board[r]![c]! !== 0) return true;
  }
  return false;
}

/**
 * Attempt to translate `piece` by (dr, dc). Returns a new piece if the move is
 * valid (no collision), otherwise `null`.
 */
export function tryMove(
  board: Board,
  piece: ActivePiece,
  dr: number,
  dc: number,
): ActivePiece | null {
  const moved: ActivePiece = {
    ...piece,
    position: {
      row: piece.position.row + dr,
      col: piece.position.col + dc,
    },
  };
  return collides(board, moved) ? null : moved;
}

/** Simple wall-kick offsets tried in order when a rotation is blocked. */
const WALL_KICKS: readonly Cell[] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-2, 0],
];

/**
 * Attempt to rotate `piece` by `dir` (+1 = clockwise). If the rotated piece
 * collides, try a sequence of wall-kick offsets. Returns the new piece if any
 * kick succeeds, otherwise `null`.
 */
export function tryRotate(
  board: Board,
  piece: ActivePiece,
  dir: number,
): ActivePiece | null {
  const rotationIndex =
    (piece.rotationIndex + dir + 4) % 4;

  for (const [kr, kc] of WALL_KICKS) {
    const candidate: ActivePiece = {
      ...piece,
      rotationIndex,
      position: {
        row: piece.position.row + kr,
        col: piece.position.col + kc,
      },
    };
    if (!collides(board, candidate)) {
      return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lock & line clear
// ---------------------------------------------------------------------------

/**
 * Merge `piece` into a clone of `board`, returning the new board. Cells above
 * the top edge (row < 0) are discarded (they were never visible).
 */
export function mergePiece(board: Board, piece: ActivePiece): Board {
  const next = cloneBoard(board);
  const colorIndex = colorIndexOf(piece.id);
  for (const [r, c] of getCells(piece)) {
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      next[r]![c] = colorIndex;
    }
  }
  return next;
}

/**
 * Remove all full rows from `board`, shifting the rows above downward.
 * Returns the new board and the number of lines cleared.
 */
export function clearLines(board: Board): { board: Board; linesCleared: number } {
  const result = board.filter((row) => row.some((cell) => cell === 0));
  const linesCleared = ROWS - result.length;
  while (result.length < ROWS) {
    result.unshift(new Array<number>(COLS).fill(0));
  }
  return { board: result, linesCleared };
}

// ---------------------------------------------------------------------------
// Scoring & level
// ---------------------------------------------------------------------------

/**
 * Standard scoring: clearing 1/2/3/4 lines awards 100/300/500/800 base points
 * multiplied by (level + 1).
 */
export function computeScore(linesCleared: number, level: number): number {
  const base = LINE_SCORES[linesCleared] ?? 0;
  return base * (level + 1);
}

/** Level increases by 1 for every {@link LINES_PER_LEVEL} lines cleared. */
export function computeLevel(totalLines: number): number {
  return Math.floor(totalLines / LINES_PER_LEVEL);
}

/** Gravity interval (ms per cell) for a given level, clamped to the table. */
export function gravityForLevel(level: number): number {
  return GRAVITY_MS[Math.min(level, GRAVITY_MS.length - 1)]!;
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

/** Spawn column (centred). */
const SPAWN_COL = Math.floor((COLS - 4) / 2);

/** Create a freshly-spawned piece of the given id at the top of the board. */
function spawnPiece(id: TetrominoId): ActivePiece {
  return {
    id,
    rotationIndex: 0,
    position: { row: 0, col: SPAWN_COL },
  };
}

/**
 * Transition to the next piece. If the spawn position collides with settled
 * blocks, the game transitions to `gameOver`.
 */
export function spawnNext(
  state: GameState,
  bag: Bag,
): GameState {
  const id = state.nextId;
  const nextId = bag.next();
  const active = spawnPiece(id);

  if (collides(state.board, active)) {
    // Spawn position is blocked → game over.
    return {
      ...state,
      status: "gameOver",
      active: null,
      nextId,
      gravityAccumulator: 0,
      lockTimer: 0,
    };
  }

  return {
    ...state,
    status: "playing",
    active,
    nextId,
    gravityAccumulator: 0,
    lockTimer: 0,
  };
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

export interface CreateGameOptions {
  /** Injectable RNG for deterministic tests. */
  random?: RandomFn;
  /** Optional persisted high score to seed the new game. */
  highScore?: number;
}

/**
 * Create a fresh game state in `playing` status with an active piece and a
 * queued next piece.
 */
export function createGame(options: CreateGameOptions = {}): {
  state: GameState;
  bag: Bag;
} {
  const random = options.random ?? mulberry32(Date.now() % 2147483647);
  const bag = createBag(random);
  const firstId = bag.next();
  const nextId = bag.next();

  const state: GameState = {
    status: "playing",
    board: createEmptyBoard(),
    active: spawnPiece(firstId),
    nextId,
    score: 0,
    level: 0,
    lines: 0,
    softDrop: false,
    gravityAccumulator: 0,
    lockTimer: 0,
    elapsed: 0,
    highScore: options.highScore ?? 0,
  };

  // Detect immediate game-over (unlikely on an empty board, but be safe).
  if (state.active && collides(state.board, state.active)) {
    return { state: { ...state, status: "gameOver", active: null }, bag };
  }

  return { state, bag };
}

// ---------------------------------------------------------------------------
// Tick — advance the simulation by `dt` milliseconds
// ---------------------------------------------------------------------------

/**
 * Determine whether the active piece is resting on a surface (floor or settled
 * block) and therefore subject to lock delay.
 */
function isGrounded(board: Board, piece: ActivePiece): boolean {
  return tryMove(board, piece, 1, 0) === null;
}

/**
 * Advance the game simulation by `dt` ms, applying gravity and lock delay.
 * On lock, the piece is merged, lines are cleared, score/level updated, and the
 * next piece is spawned.
 */
export function tick(state: GameState, dt: number, bag: Bag): GameState {
  if (state.status !== "playing" || state.active === null) {
    return state;
  }

  let { elapsed } = state;
  elapsed += dt;

  const piece = state.active;
  const grounded = isGrounded(state.board, piece);

  // --- Lock delay handling -------------------------------------------------
  if (grounded) {
    const lockTimer = state.lockTimer + dt;
    if (lockTimer >= LOCK_DELAY_MS) {
      return lockPiece(state, bag, elapsed);
    }
    // Still resting — accumulate lock timer but keep falling check for safety.
    let s: GameState = { ...state, lockTimer, elapsed };
    return applyGravity(s, dt);
  }

  // --- Gravity -------------------------------------------------------------
  return applyGravity({ ...state, lockTimer: 0, elapsed }, dt);
}

/** Apply accumulated gravity, stepping the piece down when threshold reached. */
function applyGravity(state: GameState, dt: number): GameState {
  if (state.active === null) return state;

  const interval = state.softDrop
    ? Math.min(gravityForLevel(state.level), SOFT_DROP_FACTOR)
    : gravityForLevel(state.level);

  let accumulator = state.gravityAccumulator + dt;
  let piece = state.active;
  const board = state.board;

  while (accumulator >= interval) {
    accumulator -= interval;
    const moved = tryMove(board, piece, 1, 0);
    if (moved === null) {
      // Hit the floor while falling — will be handled by lock delay on next tick.
      break;
    }
    piece = moved;
  }

  return { ...state, active: piece, gravityAccumulator: accumulator };
}

/** Lock the active piece, clear lines, update score, and spawn next. */
function lockPiece(state: GameState, bag: Bag, elapsed: number): GameState {
  if (state.active === null) return state;

  const merged = mergePiece(state.board, state.active);
  const { board, linesCleared } = clearLines(merged);

  const lines = state.lines + linesCleared;
  const level = computeLevel(lines);
  const gained = computeScore(linesCleared, state.level);
  const score = state.score + gained;
  const highScore = Math.max(state.highScore, score);

  const intermediate: GameState = {
    ...state,
    board,
    active: null,
    score,
    level,
    lines,
    highScore,
    gravityAccumulator: 0,
    lockTimer: 0,
    elapsed,
  };

  return spawnNext(intermediate, bag);
}

/**
 * Apply a soft-drop flag change. This does not move the piece immediately; the
 * tick loop honours the flag to accelerate gravity.
 */
export function setSoftDrop(state: GameState, on: boolean): GameState {
  if (state.softDrop === on) return state;
  return { ...state, softDrop: on };
}
