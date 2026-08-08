import { describe, expect, it } from '@jest/globals';
import { createBoard, setCell } from '../board';
import { TETROMINOES } from '../tetrominoes';
import {
  applyGravity,
  canPlace,
  lockPiece,
  tryMove,
  tryRotate,
} from '../rules';
import type { Board, GameState } from '../types';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: createBoard(10, 20),
    current: TETROMINOES.T,
    next: TETROMINOES.S,
    x: 3,
    y: 0,
    rotation: 0,
    score: 0,
    level: 0,
    lines: 0,
    gameOver: false,
    ...overrides,
  };
}

describe('canPlace', () => {
  it('accepts an empty placement', () => {
    expect(canPlace(createBoard(10, 20), TETROMINOES.I.rotations[0], 3, 0)).toBe(true);
  });

  it('rejects an overlapping placement', () => {
    const board = setCell(createBoard(10, 20), 7, 1, 1);
    // I piece (rotation 0) occupies x = 3..6 at row 1 -> no collision.
    expect(canPlace(board, TETROMINOES.I.rotations[0], 3, 0)).toBe(true);
    // Shifted two cells right the piece reaches the occupied cell (7, 1).
    expect(canPlace(board, TETROMINOES.I.rotations[0], 4, 0)).toBe(false);
  });

  it('rejects out-of-bounds placements', () => {
    const board = createBoard(10, 20);
    expect(canPlace(board, TETROMINOES.I.rotations[0], 9, 0)).toBe(false);
    expect(canPlace(board, TETROMINOES.O.rotations[0], 3, -1)).toBe(false);
  });
});

describe('tryMove', () => {
  it('translates the piece and returns a new state', () => {
    const state = makeState();
    const moved = tryMove(state, 'right');
    expect(moved.x).toBe(4);
    expect(moved.board).toEqual(state.board);
    expect(moved.current).toBe(state.current);
  });

  it('rejects a move out of bounds', () => {
    // O piece at x = 7 occupies x = 8..9; moving right would go off-board.
    const state = makeState({ current: TETROMINOES.O, x: 7, y: 5 });
    const moved = tryMove(state, 'right');
    expect(moved).toBe(state);
    expect(moved.x).toBe(7);
  });

  it('rejects a move that overlaps locked cells', () => {
    const board = setCell(createBoard(10, 20), 7, 10, 1);
    const state = makeState({ board, current: TETROMINOES.T, x: 5, y: 10 });
    // Moving right would place a cell at (7, 10), which is occupied.
    expect(tryMove(state, 'right')).toBe(state);
    // Moving left is clear.
    expect(tryMove(state, 'left').x).toBe(4);
  });
});

describe('tryRotate', () => {
  it('rotates in place when the rotated shape fits', () => {
    const state = makeState({ current: TETROMINOES.T, x: 3, y: 5 });
    const rotated = tryRotate(state, 1);
    expect(rotated.rotation).toBe(1);
    expect(rotated.x).toBe(3);
  });

  it('rejects a rotation that would go out of bounds', () => {
    // Horizontal I at the bottom row; rotating vertical extends below the board.
    const state = makeState({ current: TETROMINOES.I, x: 3, y: 18, rotation: 0 });
    expect(tryRotate(state, 1)).toBe(state);
  });

  it('rejects a rotation whose shape would overlap', () => {
    let board = createBoard(10, 20);
    board = setCell(board, 6, 10, 1); // blocks in-place
    board = setCell(board, 5, 10, 1); // blocks left nudge
    board = setCell(board, 7, 10, 1); // blocks right nudge
    const state = makeState({ board, current: TETROMINOES.T, x: 5, y: 10 });
    const rotated = tryRotate(state, 1);
    expect(rotated).toBe(state);
    expect(rotated.rotation).toBe(0);
    expect(rotated.x).toBe(5);
  });

  it('nudges one cell horizontally when blocked in place', () => {
    // Blocks only the in-place rotation; the left nudge is clear.
    const board = setCell(createBoard(10, 20), 6, 10, 1);
    const state = makeState({ board, current: TETROMINOES.T, x: 5, y: 10 });
    const rotated = tryRotate(state, 1);
    expect(rotated.rotation).toBe(1);
    expect(rotated.x).toBe(4);
  });

  it('rotates counter-clockwise with dir -1', () => {
    const state = makeState({ current: TETROMINOES.T, x: 3, y: 5 });
    expect(tryRotate(state, -1).rotation).toBe(3);
  });
});

describe('applyGravity', () => {
  it('moves the piece down one row when it can fall', () => {
    const state = makeState({ current: TETROMINOES.I, x: 3, y: 10 });
    expect(applyGravity(state).y).toBe(11);
  });

  it('returns the state unchanged when the piece has landed', () => {
    const state = makeState({ current: TETROMINOES.I, x: 3, y: 18 });
    expect(applyGravity(state)).toBe(state);
  });
});

describe('lockPiece', () => {
  /**
   * Board whose listed rows are full except for a single gap at column 5.
   */
  function boardWithGaps(rows: number[]): Board {
    let board = createBoard(10, 20);
    for (const row of rows) {
      for (let x = 0; x < 10; x++) {
        if (x !== 5) board = setCell(board, x, row, 1);
      }
    }
    return board;
  }

  /**
   * Vertical-I setup: I (rotation 1) at x = 3, y = 16 fills column 5 across
   * rows 16-19, completing the first `lines` near-full rows.
   */
  function stateClearingRows(lines: number): GameState {
    const rows = [16, 17, 18, 19].slice(0, lines);
    return makeState({
      board: boardWithGaps(rows),
      current: TETROMINOES.I,
      x: 3,
      y: 16,
      rotation: 1,
      lines: 10,
      level: 1,
    });
  }

  it.each([
    [1, 100],
    [2, 200],
    [3, 300],
    [4, 800],
  ])('clearing %i rows scores %i and updates lines/level', (cleared, expectedScore) => {
    const state = stateClearingRows(cleared);
    const locked = lockPiece(state);
    expect(locked.lines).toBe(10 + cleared);
    expect(locked.level).toBe(Math.floor((10 + cleared) / 10));
    expect(locked.score).toBe(expectedScore);
  });

  it('scores drop points and line clears independently', () => {
    const state = makeState({ lines: 10, level: 1 });
    const locked = lockPiece(state, 7);
    expect(locked.score).toBe(7);
    expect(locked.lines).toBe(10);
  });

  it('does not mutate the input board', () => {
    const state = stateClearingRows(1);
    const before = state.board.map((row) => row.slice());
    lockPiece(state);
    expect(state.board).toEqual(before);
  });

  it('recomputes level as floor(lines / 10) after a clear', () => {
    const state = stateClearingRows(1);
    const atNine = makeState({
      board: state.board,
      current: TETROMINOES.I,
      x: 3,
      y: 16,
      rotation: 1,
      lines: 9,
      level: 0,
    });
    const locked = lockPiece(atNine);
    expect(locked.lines).toBe(10);
    expect(locked.level).toBe(1);
    // Score uses the level at the time of the clear: floor(9 / 10) = 0.
    expect(locked.score).toBe(0);
  });
});
