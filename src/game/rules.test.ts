import { createBoard } from './board';
import { getShape, TETROMINOES } from './tetrominoes';
import { TetrominoId } from './types';
import { canPlace, lockPiece, tryMove, tryRotate } from './rules';

const ROWS = 20;
const COLS = 10;

describe('canPlace', () => {
  it('allows an I-piece in the centre of an empty board', () => {
    const board = createBoard(ROWS, COLS);
    const shape = getShape(TETROMINOES[TetrominoId.I], 0);
    expect(canPlace(board, shape, 3, 1)).toBe(true);
  });

  it('rejects a placement off the left edge', () => {
    const board = createBoard(ROWS, COLS);
    const shape = getShape(TETROMINOES[TetrominoId.J], 0);
    expect(canPlace(board, shape, -1, 1)).toBe(false);
  });

  it('rejects a placement off the right edge', () => {
    const board = createBoard(ROWS, COLS);
    const shape = getShape(TETROMINOES[TetrominoId.I], 0);
    // I-piece is 4 wide; placing at col 7 hits the right wall.
    expect(canPlace(board, shape, 7, 1)).toBe(false);
  });

  it('rejects a placement below the floor', () => {
    const board = createBoard(ROWS, COLS);
    const shape = getShape(TETROMINOES[TetrominoId.O], 0);
    expect(canPlace(board, shape, 4, ROWS)).toBe(false);
  });

  it('rejects a collision with an occupied cell', () => {
    let board = createBoard(ROWS, COLS);
    // Put a block directly under the O-piece's cells.
    board = board.map((row, r) =>
      r === 2
        ? row.map((_, c) => (c === 4 || c === 5 ? TetrominoId.O : null))
        : row,
    );
    const shape = getShape(TETROMINOES[TetrominoId.O], 0);
    expect(canPlace(board, shape, 4, 1)).toBe(false);
  });

  it('allows cells above the board (negative rows) but enforces column bounds', () => {
    const board = createBoard(ROWS, COLS);
    const shape = getShape(TETROMINOES[TetrominoId.I], 0);
    // Row 1 of the I matrix is the filled row; with y = -1 that row maps to
    // board row 0, which is fine.
    expect(canPlace(board, shape, 3, -1)).toBe(true);
    // Pushing fully above is still allowed if columns are valid.
    expect(canPlace(board, shape, 3, -2)).toBe(true);
    // Off the left edge even when above is not allowed.
    expect(canPlace(board, shape, -1, -2)).toBe(false);
  });
});

describe('tryMove', () => {
  const board = createBoard(ROWS, COLS);

  it('moves a piece right when there is room', () => {
    const shape = getShape(TETROMINOES[TetrominoId.O], 0);
    expect(tryMove(board, shape, 4, 5, 1, 0)).toEqual({ x: 5, y: 5 });
  });

  it('moves a piece left when there is room', () => {
    const shape = getShape(TETROMINOES[TetrominoId.O], 0);
    expect(tryMove(board, shape, 4, 5, -1, 0)).toEqual({ x: 3, y: 5 });
  });

  it('moves a piece down when there is room', () => {
    const shape = getShape(TETROMINOES[TetrominoId.O], 0);
    expect(tryMove(board, shape, 4, 5, 0, 1)).toEqual({ x: 4, y: 6 });
  });

  it('returns null when moving into the wall', () => {
    const shape = getShape(TETROMINOES[TetrominoId.O], 0);
    // O at far-right column edge: moving right is impossible.
    expect(tryMove(board, shape, COLS - 2, 5, 1, 0)).toBeNull();
  });

  it('returns null when moving into the floor', () => {
    const shape = getShape(TETROMINOES[TetrominoId.O], 0);
    expect(tryMove(board, shape, 4, ROWS - 2, 0, 1)).toBeNull();
  });
});

describe('tryRotate', () => {
  it('rotates a T-piece clockwise in the open', () => {
    const board = createBoard(ROWS, COLS);
    const result = tryRotate(
      board,
      TetrominoId.T,
      0,
      4,
      1,
      'cw',
    );
    expect(result).toEqual({ rotation: 1, x: 4, y: 1 });
  });

  it('rotates counter-clockwise', () => {
    const board = createBoard(ROWS, COLS);
    const result = tryRotate(board, TetrominoId.T, 1, 4, 1, 'ccw');
    expect(result).toEqual({ rotation: 0, x: 4, y: 1 });
  });

  it('wraps rotation index 3 -> 0 on cw', () => {
    const board = createBoard(ROWS, COLS);
    const result = tryRotate(board, TetrominoId.T, 3, 4, 1, 'cw');
    expect(result?.rotation).toBe(0);
  });

  it('applies a wall-kick nudge when rotating against a wall', () => {
    const board = createBoard(ROWS, COLS);
    // Place an I-piece flush against the left wall and rotate; the nudge table
    // should find a valid offset to the right.
    const result = tryRotate(board, TetrominoId.I, 0, 0, 1, 'cw');
    expect(result).not.toBeNull();
    // The rotated I (vertical) fits after a rightward nudge.
    const shape = getShape(TETROMINOES[TetrominoId.I], 1);
    expect(canPlace(board, shape, result!.x, result!.y)).toBe(true);
  });

  it('returns null when rotation is impossible even with nudge', () => {
    // A completely full board leaves no room for the rotated piece anywhere.
    const board = createBoard(ROWS, COLS).map((row) =>
      row.map(() => TetrominoId.I),
    );
    const result = tryRotate(board, TetrominoId.T, 0, 4, 1, 'cw');
    expect(result).toBeNull();
  });

  it('is effectively a no-op for the symmetric O-piece', () => {
    const board = createBoard(ROWS, COLS);
    const result = tryRotate(board, TetrominoId.O, 0, 4, 5, 'cw');
    // O rotates to an identical shape; position should be unchanged.
    expect(result).toEqual({ rotation: 1, x: 4, y: 5 });
  });
});

describe('lockPiece', () => {
  it('writes the piece id into the correct cells', () => {
    const board = createBoard(ROWS, COLS);
    const shape = getShape(TETROMINOES[TetrominoId.O], 0);
    const locked = lockPiece(board, TetrominoId.O, shape, 4, 5);
    expect(locked[5][4]).toBe(TetrominoId.O);
    expect(locked[5][5]).toBe(TetrominoId.O);
    expect(locked[6][4]).toBe(TetrominoId.O);
    expect(locked[6][5]).toBe(TetrominoId.O);
  });

  it('does not mutate the original board', () => {
    const board = createBoard(ROWS, COLS);
    const shape = getShape(TETROMINOES[TetrominoId.O], 0);
    lockPiece(board, TetrominoId.O, shape, 4, 5);
    expect(board[5][4]).toBeNull();
    expect(board[6][5]).toBeNull();
  });

  it('ignores cells that fall above the board', () => {
    const board = createBoard(ROWS, COLS);
    const shape = getShape(TETROMINOES[TetrominoId.I], 0);
    // y = -2: only the filled row (matrix row 1) maps to board row -1, above
    // the field, so nothing should be written.
    const locked = lockPiece(board, TetrominoId.I, shape, 3, -2);
    expect(locked).toEqual(board);
  });
});
