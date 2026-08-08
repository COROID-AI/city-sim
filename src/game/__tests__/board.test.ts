import { describe, expect, it } from '@jest/globals';
import {
  clearFullRows,
  createBoard,
  getCell,
  inBounds,
  isRowFull,
  setCell,
} from '../board';
import type { Board, Cell, GameConfig } from '../types';

const config: GameConfig = { width: 10, height: 20, tickMs: 500 };

describe('board', () => {
  it('creates a board whose dimensions match the game config', () => {
    const board = createBoard(config.width, config.height);
    expect(board).toHaveLength(config.height);
    for (const row of board) {
      expect(row).toHaveLength(config.width);
    }
    expect(board.every((row) => row.every((cell) => cell === 0))).toBe(true);
  });

  it('inBounds accepts on-grid cells and rejects off-grid coordinates', () => {
    const board = createBoard(config.width, config.height);
    expect(inBounds(board, 0, 0)).toBe(true);
    expect(inBounds(board, config.width - 1, config.height - 1)).toBe(true);
    expect(inBounds(board, -1, 0)).toBe(false);
    expect(inBounds(board, config.width, 0)).toBe(false);
    expect(inBounds(board, 0, -1)).toBe(false);
    expect(inBounds(board, 0, config.height)).toBe(false);
  });

  it('getCell returns the stored value in bounds and 0 off-grid', () => {
    const board = createBoard(config.width, config.height);
    expect(getCell(board, 3, 4)).toBe(0);
    expect(getCell(board, -1, 0)).toBe(0);
    expect(getCell(board, 0, config.height)).toBe(0);
  });

  it('setCell returns a new board without mutating the original', () => {
    const board = createBoard(config.width, config.height);
    const next = setCell(board, 4, 5, 7);
    expect(next).not.toBe(board);
    expect(next[5]).not.toBe(board[5]);
    expect(getCell(next, 4, 5)).toBe(7);
    // The original board is untouched.
    expect(getCell(board, 4, 5)).toBe(0);
  });

  it('isRowFull returns true only when every cell in the row is non-zero', () => {
    const board: Board = createBoard(4, 3);
    board[0] = [1, 2, 3, 4]; // full
    board[1] = [1, 2, 3, 0]; // one empty
    board[2] = [0, 0, 0, 0]; // empty
    expect(isRowFull(board, 0)).toBe(true);
    expect(isRowFull(board, 1)).toBe(false);
    expect(isRowFull(board, 2)).toBe(false);
    expect(isRowFull(board, 3)).toBe(false); // out of range
  });

  it('clearFullRows removes full rows and returns the cleared count', () => {
    const board: Board = createBoard(4, 4);
    board[0] = [1, 2, 3, 4]; // full
    board[1] = [1, 0, 3, 0]; // partial
    board[2] = [5, 6, 7, 7]; // full
    board[3] = [0, 0, 2, 0]; // partial

    const { board: cleared, count } = clearFullRows(board);

    expect(count).toBe(2);
    expect(cleared).toHaveLength(4);
    // Two empty rows are prepended at the top, partial rows keep their order.
    expect(cleared[0].every((cell) => cell === 0)).toBe(true);
    expect(cleared[1].every((cell) => cell === 0)).toBe(true);
    expect(cleared[2]).toEqual([1, 0, 3, 0]);
    expect(cleared[3]).toEqual([0, 0, 2, 0]);
    // The original board is not mutated.
    expect(board[0]).toEqual([1, 2, 3, 4]);
    expect(board[2]).toEqual([5, 6, 7, 7]);
  });

  it('clearFullRows clears every row when the board is full', () => {
    const board: Board = createBoard(2, 2);
    board[0] = [1, 1];
    board[1] = [7, 7];
    const { board: cleared, count } = clearFullRows(board);
    expect(count).toBe(2);
    expect(cleared.every((row) => row.every((cell: Cell) => cell === 0))).toBe(true);
  });
});