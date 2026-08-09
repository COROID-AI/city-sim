import { describe, expect, it } from '@jest/globals';
import { createBoard, getCell, setCell } from '../board';
import {
  applyGravity,
  canPlace,
  lockPiece,
  tryMove,
  tryRotate,
} from '../rules';
import { TETROMINOES } from '../tetrominoes';
import type { Board, GameState } from '../types';

const CONFIG = { width: 10, height: 20, tickMs: 500 };

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: createBoard(CONFIG.width, CONFIG.height),
    current: TETROMINOES.T[0],
    next: TETROMINOES.I[0],
    x: 3,
    y: 15,
    rotation: 0,
    score: 0,
    level: 0,
    lines: 0,
    gameOver: false,
    ...overrides,
  };
}

/** Fills board row `y` (skipping the given columns) with color 1. */
function fillRow(board: Board, y: number, skip: number[] = []): Board {
  let next = board;
  const skipSet = new Set(skip);
  for (let x = 0; x < CONFIG.width; x++) {
    if (skipSet.has(x)) continue;
    next = setCell(next, x, y, 1);
  }
  return next;
}

describe('canPlace', () => {
  it('accepts a piece on an empty board', () => {
    const board = createBoard(10, 20);
    expect(canPlace(board, TETROMINOES.T[0], 3, 0)).toBe(true);
  });

  it('rejects a piece that would be out of bounds', () => {
    const board = createBoard(10, 20);
    // The I piece spans matrix cols 0-3, so x = -1 pushes it off the left.
    expect(canPlace(board, TETROMINOES.I[0], -1, 0)).toBe(false);
    // The T piece has non-empty matrix rows 1-2 -> board rows 20-21.
    expect(canPlace(board, TETROMINOES.T[0], 3, 18)).toBe(false);
    expect(canPlace(board, TETROMINOES.T[0], 3, 17)).toBe(true);
  });

  it('rejects a piece overlapping placed blocks', () => {
    const board = setCell(createBoard(10, 20), 4, 1, 1);
    // T at (3, 0) occupies board cell (4, 1) via matrix row 1 col 1.
    expect(canPlace(board, TETROMINOES.T[0], 3, 0)).toBe(false);
  });
});

describe('tryMove', () => {
  it('translates the piece in the requested direction', () => {
    const state = makeState();
    const right = tryMove(state, 'right');
    expect(right.x).toBe(4);
    expect(right.y).toBe(state.y);
    expect(right).not.toBe(state);

    const left = tryMove(makeState(), 'left');
    expect(left.x).toBe(2);
  });

  it('rejects a move that would go out of bounds', () => {
    // I piece at x = 6 occupies cols 6-9; x = 7 would be out of bounds.
    const state = makeState({ current: TETROMINOES.I[0], x: 6 });
    expect(tryMove(state, 'right')).toBe(state);
  });

  it('rejects a move that would overlap a placed block', () => {
    const board = setCell(createBoard(10, 20), 4, 17, 1);
    // T at (2, 15) after moving left occupies (4, 17) via matrix row 2 col 2.
    const state = makeState({ board, x: 3 });
    expect(tryMove(state, 'left')).toBe(state);
  });

  it('does not mutate the input state on success', () => {
    const state = makeState();
    const before = { ...state, board: state.board.map((row) => [...row]) };
    tryMove(state, 'right');
    expect(state).toEqual(before);
  });
});

describe('tryRotate', () => {
  it('rotates the piece clockwise and counter-clockwise', () => {
    const cw = tryRotate(makeState(), 1);
    expect(cw.rotation).toBe(1);
    expect(cw.current.id).toBe('T');
    expect(cw.current.matrix).toEqual(TETROMINOES.T[1].matrix);

    const ccw = tryRotate(makeState(), -1);
    expect(ccw.rotation).toBe(3);
    expect(ccw.current.matrix).toEqual(TETROMINOES.T[3].matrix);
  });

  it('rejects a rotation when the rotated shape would overlap', () => {
    // Horizontal I at (3, 5) occupies row 6. Its CW rotation occupies
    // column 5 (same), 4 (left nudge), or 6 (right nudge). Blocks in all
    // three columns force a rejection.
    let board = createBoard(10, 20);
    board = setCell(board, 5, 5, 1);
    board = setCell(board, 4, 5, 1);
    board = setCell(board, 6, 5, 1);
    const state = makeState({
      board,
      current: TETROMINOES.I[0],
      x: 3,
      y: 5,
    });

    expect(tryRotate(state, 1)).toBe(state);
  });

  it('accepts a one-cell nudge when the rotated shape is close to a block', () => {
    // Same as above but only the same-position column is blocked; the
    // one-cell left nudge fits, so the rotation succeeds with x - 1.
    const board = setCell(createBoard(10, 20), 5, 5, 1);
    const state = makeState({
      board,
      current: TETROMINOES.I[0],
      x: 3,
      y: 5,
    });

    const result = tryRotate(state, 1);
    expect(result.rotation).toBe(1);
    expect(result.x).toBe(2);
    expect(result.y).toBe(5);
    expect(result.current.matrix).toEqual(TETROMINOES.I[1].matrix);
  });

  it('does not mutate the input state', () => {
    const state = makeState();
    const rotationBefore = state.rotation;
    tryRotate(state, 1);
    expect(state.rotation).toBe(rotationBefore);
  });
});

describe('applyGravity', () => {
  it('moves the piece down one row when there is space', () => {
    const state = makeState();
    const { state: after, locked } = applyGravity(state);
    expect(locked).toBe(false);
    expect(after.y).toBe(16);
    expect(after).not.toBe(state);
  });

  it('reports locked when the piece cannot move down', () => {
    // I piece at y = 18 occupies the bottom row; y = 19 is out of bounds.
    const state = makeState({ current: TETROMINOES.I[0], y: 18 });
    const { state: after, locked } = applyGravity(state);
    expect(locked).toBe(true);
    expect(after.y).toBe(18);
  });
});

describe('lockPiece', () => {
  it('writes the piece colors into the board without clearing rows', () => {
    const state = makeState({ current: TETROMINOES.I[0], y: 18 });
    const result = lockPiece(state);

    expect(getCell(result.board, 3, 19)).toBe(1);
    expect(getCell(result.board, 4, 19)).toBe(1);
    expect(getCell(result.board, 5, 19)).toBe(1);
    expect(getCell(result.board, 6, 19)).toBe(1);
    expect(getCell(result.board, 2, 19)).toBe(0);
    expect(result.lines).toBe(0);
    expect(result.score).toBe(0);
  });

  it('scores and levels a single-line clear (single = 100 * level)', () => {
    const board = fillRow(createBoard(10, 20), 19, [3, 4, 5, 6]);
    const state = makeState({
      board,
      current: TETROMINOES.I[0],
      y: 18,
      lines: 20,
      level: 2,
    });

    const result = lockPiece(state);
    expect(result.lines).toBe(21);
    expect(result.level).toBe(2);
    expect(result.score).toBe(200);
    expect(result.board[19].every((cell) => cell === 0)).toBe(true);
  });

  it('advances level across a 10-line boundary', () => {
    const board = fillRow(createBoard(10, 20), 19, [3, 4, 5, 6]);
    const state = makeState({
      board,
      current: TETROMINOES.I[0],
      y: 18,
      lines: 9,
      level: 0,
    });

    const result = lockPiece(state);
    expect(result.lines).toBe(10);
    expect(result.level).toBe(1);
  });

  it('scores a double line clear (double = 200)', () => {
    let board = fillRow(createBoard(10, 20), 19);
    board = fillRow(board, 18, [3, 4, 5, 6]);
    const state = makeState({ board, current: TETROMINOES.I[0], y: 17 });

    const result = lockPiece(state);
    expect(result.lines).toBe(2);
    expect(result.score).toBe(200);
  });

  it('scores a triple line clear (triple = 300)', () => {
    let board = fillRow(createBoard(10, 20), 19);
    board = fillRow(board, 18);
    board = fillRow(board, 17, [3, 4, 5, 6]);
    const state = makeState({ board, current: TETROMINOES.I[0], y: 16 });

    const result = lockPiece(state);
    expect(result.lines).toBe(3);
    expect(result.score).toBe(300);
  });

  it('scores a tetris (tetris = 800) and empties the board', () => {
    let board = fillRow(createBoard(10, 20), 19);
    board = fillRow(board, 18);
    board = fillRow(board, 17);
    board = fillRow(board, 16, [3, 4, 5, 6]);
    const state = makeState({ board, current: TETROMINOES.I[0], y: 15 });

    const result = lockPiece(state);
    expect(result.lines).toBe(4);
    expect(result.score).toBe(800);
    expect(result.board.every((row) => row.every((cell) => cell === 0))).toBe(
      true,
    );
  });

  it('does not mutate the input board or state', () => {
    const board = fillRow(createBoard(10, 20), 19, [3, 4, 5, 6]);
    const before = board.map((row) => [...row]);
    const state = makeState({ board, current: TETROMINOES.I[0], y: 18 });

    lockPiece(state);

    expect(board).toEqual(before);
    expect(state.lines).toBe(0);
    expect(state.score).toBe(0);
  });
});