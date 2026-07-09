import {
  clearFullRows,
  createBoard,
  getCell,
  inBounds,
  isRowFull,
  setCell,
} from './board';
import { TetrominoId } from './types';

const ROWS = 4;
const COLS = 3;

describe('createBoard', () => {
  it('creates a board of the given dimensions filled with null', () => {
    const board = createBoard(ROWS, COLS);
    expect(board).toHaveLength(ROWS);
    expect(board[0]).toHaveLength(COLS);
    for (const row of board) {
      for (const cell of row) {
        expect(cell).toBeNull();
      }
    }
  });

  it('rejects non-positive dimensions', () => {
    expect(() => createBoard(0, COLS)).toThrow(RangeError);
    expect(() => createBoard(ROWS, -1)).toThrow(RangeError);
    expect(() => createBoard(1.5, COLS)).toThrow(RangeError);
  });
});

describe('inBounds', () => {
  const board = createBoard(ROWS, COLS);

  it('returns true for coordinates inside the board', () => {
    expect(inBounds(board, 0, 0)).toBe(true);
    expect(inBounds(board, ROWS - 1, COLS - 1)).toBe(true);
  });

  it('returns false for coordinates outside the board', () => {
    expect(inBounds(board, -1, 0)).toBe(false);
    expect(inBounds(board, 0, -1)).toBe(false);
    expect(inBounds(board, ROWS, 0)).toBe(false);
    expect(inBounds(board, 0, COLS)).toBe(false);
  });
});

describe('getCell', () => {
  const board = createBoard(ROWS, COLS);

  it('returns null for empty cells', () => {
    expect(getCell(board, 0, 0)).toBeNull();
  });

  it('returns null for out-of-bounds coordinates', () => {
    expect(getCell(board, -1, 0)).toBeNull();
    expect(getCell(board, ROWS, 0)).toBeNull();
  });
});

describe('setCell', () => {
  const board = createBoard(ROWS, COLS);

  it('returns a new board with the cell set', () => {
    const next = setCell(board, 1, 1, TetrominoId.T);
    expect(getCell(next, 1, 1)).toBe(TetrominoId.T);
    // original board is untouched (immutable)
    expect(getCell(board, 1, 1)).toBeNull();
  });

  it('throws for out-of-bounds coordinates', () => {
    expect(() => setCell(board, ROWS, 0, TetrominoId.I)).toThrow(RangeError);
    expect(() => setCell(board, 0, COLS, TetrominoId.I)).toThrow(RangeError);
  });
});

describe('isRowFull', () => {
  it('returns false for an empty row', () => {
    const board = createBoard(1, COLS);
    expect(isRowFull(board, 0)).toBe(false);
  });

  it('returns true only when every cell is filled', () => {
    let board = createBoard(1, COLS);
    board = setCell(board, 0, 0, TetrominoId.I);
    expect(isRowFull(board, 0)).toBe(false);
    board = setCell(board, 0, 1, TetrominoId.I);
    expect(isRowFull(board, 0)).toBe(false);
    board = setCell(board, 0, 2, TetrominoId.I);
    expect(isRowFull(board, 0)).toBe(true);
  });

  it('returns false for out-of-bounds rows', () => {
    const board = createBoard(1, COLS);
    expect(isRowFull(board, 5)).toBe(false);
  });
});

describe('clearFullRows', () => {
  it('removes full rows and reports the count cleared', () => {
    let board = createBoard(2, COLS);
    // Fill the bottom row completely.
    board = setCell(board, 1, 0, TetrominoId.I);
    board = setCell(board, 1, 1, TetrominoId.I);
    board = setCell(board, 1, 2, TetrominoId.I);

    const result = clearFullRows(board);
    expect(result.linesCleared).toBe(1);
    expect(result.board).toHaveLength(2);
    // Bottom row should now be empty.
    expect(isRowFull(result.board, 1)).toBe(false);
    expect(getCell(result.board, 1, 0)).toBeNull();
  });

  it('does nothing when no rows are full', () => {
    const board = createBoard(2, COLS);
    const result = clearFullRows(board);
    expect(result.linesCleared).toBe(0);
    expect(result.board).toEqual(board);
  });

  it('clears multiple full rows and keeps board height', () => {
    let board = createBoard(3, COLS);
    // Fill all three rows.
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < COLS; c++) {
        board = setCell(board, r, c, TetrominoId.I);
      }
    }

    const result = clearFullRows(board);
    expect(result.linesCleared).toBe(3);
    expect(result.board).toHaveLength(3);
    for (const row of result.board) {
      for (const cell of row) {
        expect(cell).toBeNull();
      }
    }
  });
});
