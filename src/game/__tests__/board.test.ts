import { describe, expect, it } from '@jest/globals';
import {
  clearFullRows,
  createBoard,
  getCell,
  inBounds,
  isRowFull,
  setCell,
} from '../board';
import type { GameConfig } from '../types';

const CONFIG: GameConfig = { width: 10, height: 20, tickMs: 500 };

describe('board', () => {
  it('creates a board with dimensions matching the config', () => {
    const board = createBoard(CONFIG.width, CONFIG.height);

    expect(board).toHaveLength(CONFIG.height);
    for (const row of board) {
      expect(row).toHaveLength(CONFIG.width);
    }
  });

  it('creates an empty board', () => {
    const board = createBoard(10, 20);

    expect(
      board.every((row) => row.every((cell) => cell === 0)),
    ).toBe(true);
  });

  it('inBounds rejects off-grid coordinates', () => {
    const board = createBoard(10, 20);

    expect(inBounds(board, 0, 0)).toBe(true);
    expect(inBounds(board, 9, 19)).toBe(true);
    expect(inBounds(board, -1, 0)).toBe(false);
    expect(inBounds(board, 0, -1)).toBe(false);
    expect(inBounds(board, 10, 0)).toBe(false);
    expect(inBounds(board, 0, 20)).toBe(false);
  });

  it('getCell reads cells and returns 0 outside the grid', () => {
    const board = createBoard(10, 20);

    expect(getCell(board, 3, 4)).toBe(0);
    expect(getCell(board, 10, 4)).toBe(0);
    expect(getCell(board, 3, 20)).toBe(0);
  });

  it('setCell returns a new board without mutating the original', () => {
    const board = createBoard(10, 20);
    const next = setCell(board, 5, 7, 3);

    expect(next).not.toBe(board);
    expect(next[7]).not.toBe(board[7]);
    expect(getCell(board, 5, 7)).toBe(0);
    expect(getCell(next, 5, 7)).toBe(3);
  });

  it('isRowFull returns true only when every cell is non-zero', () => {
    const board = createBoard(3, 3);

    expect(isRowFull(board, 1)).toBe(false);

    const almost = setCell(setCell(board, 0, 1, 1), 1, 1, 2);
    expect(isRowFull(almost, 1)).toBe(false);

    let full = board;
    for (let x = 0; x < 3; x++) {
      full = setCell(full, x, 1, x === 0 ? 1 : 2);
    }
    expect(isRowFull(full, 1)).toBe(true);
    expect(isRowFull(full, 2)).toBe(false);
    expect(isRowFull(full, 99)).toBe(false);
  });

  it('clearFullRows removes full rows and returns the cleared count', () => {
    let board = createBoard(4, 4);

    // Full bottom row.
    for (let x = 0; x < 4; x++) {
      board = setCell(board, x, 3, 1);
    }
    // Partial row above it.
    board = setCell(board, 0, 2, 3);

    const { board: next, count } = clearFullRows(board);

    expect(count).toBe(1);
    expect(next).toHaveLength(4);
    expect(isRowFull(next, 3)).toBe(false);
    // The partial row shifted down to the bottom.
    expect(getCell(next, 0, 3)).toBe(3);
    // A new empty row appeared at the top.
    expect(getCell(next, 0, 0)).toBe(0);
    expect(getCell(next, 0, 2)).toBe(0);
  });

  it('clearFullRows clears multiple full rows at once', () => {
    let board = createBoard(2, 3);

    board = setCell(board, 0, 2, 1);
    board = setCell(board, 1, 2, 2);
    board = setCell(board, 0, 1, 3);
    board = setCell(board, 1, 1, 4);

    const { board: next, count } = clearFullRows(board);

    expect(count).toBe(2);
    expect(
      next.every((row) => row.every((cell) => cell === 0)),
    ).toBe(true);
  });

  it('clearFullRows does not mutate the input board', () => {
    const board = createBoard(2, 2);
    const full = setCell(setCell(board, 0, 0, 1), 1, 0, 1);
    const before = full.map((row) => [...row]);

    clearFullRows(full);

    expect(full).toEqual(before);
  });
});