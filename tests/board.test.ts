import { describe, expect, it } from 'vitest';
import { clearLines, collides, createBoard, ghostPiece, merge } from '../src/game/board';
import { BOARD_COLS, BOARD_ROWS, FIRST_VISIBLE_ROW } from '../src/game/constants';

describe('board', () => {
  it('creates a BOARD_ROWS x BOARD_COLS empty grid', () => {
    const board = createBoard();
    expect(board).toHaveLength(BOARD_ROWS);
    for (const row of board) {
      expect(row).toHaveLength(BOARD_COLS);
      expect(row.every((c) => c === null)).toBe(true);
    }
  });

  it('collides with out-of-bounds cells and locked cells', () => {
    const board = createBoard();
    expect(collides(board, [{ row: -1, col: 0 }])).toBe(true);
    expect(collides(board, [{ row: BOARD_ROWS, col: 0 }])).toBe(true);
    expect(collides(board, [{ row: 0, col: -1 }])).toBe(true);
    expect(collides(board, [{ row: 0, col: BOARD_COLS }])).toBe(true);
    expect(collides(board, [{ row: 10, col: 4 }])).toBe(false);

    const locked = merge(board, [{ row: 10, col: 4 }], 'J');
    expect(collides(locked, [{ row: 10, col: 4 }])).toBe(true);
    expect(collides(locked, [{ row: 10, col: 5 }])).toBe(false);
  });

  it('clearLines removes full visible rows and shifts the stack down', () => {
    const board = createBoard();
    // Hidden rows must never shift.
    board[2][0] = 'O';
    // A marker above the cleared rows.
    board[FIRST_VISIBLE_ROW + 1][3] = 'J';
    // Fill the last row completely.
    for (let c = 0; c < BOARD_COLS; c++) board[BOARD_ROWS - 1][c] = 'T';

    const { board: next, cleared } = clearLines(board);
    expect(cleared).toEqual([BOARD_ROWS - 1]);
    expect(next[BOARD_ROWS - 1].every((c) => c === null)).toBe(true);
    // The marker shifted down one row (the cleared row was below it).
    expect(next[FIRST_VISIBLE_ROW + 2][3]).toBe('J');
    // Hidden rows untouched.
    expect(next[2][0]).toBe('O');
  });

  it('clearLines returns an unchanged clone when nothing is full', () => {
    const board = createBoard();
    board[10][2] = 'S';
    const { board: next, cleared } = clearLines(board);
    expect(cleared).toEqual([]);
    expect(next).not.toBe(board);
    expect(next[10][2]).toBe('S');
  });

  it('clearLines clears multiple rows at once', () => {
    const board = createBoard();
    for (let r = BOARD_ROWS - 2; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) board[r][c] = 'Z';
    }
    const { board: next, cleared } = clearLines(board);
    expect(cleared).toEqual([BOARD_ROWS - 2, BOARD_ROWS - 1]);
    for (let r = BOARD_ROWS - 2; r < BOARD_ROWS; r++) {
      expect(next[r].every((c) => c === null)).toBe(true);
    }
  });

  it('ghostPiece finds the lowest collision-free placement', () => {
    const board = createBoard();
    const ghost = ghostPiece(board, { type: 'T', rotation: 0, x: 3, y: 0 });
    // T's lowest cell is row 1 of its box; it stops at the floor (row 23).
    expect(ghost.y).toBe(22);
    expect(ghost.x).toBe(3);
  });
});