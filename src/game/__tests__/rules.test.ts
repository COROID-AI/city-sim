/**
 * Tests for the rule helpers.
 *
 * Covers tryMove/tryRotate success booleans and the "never mutate on failure"
 * contract (acceptance criterion #2), plus game-over detection when a freshly
 * spawned piece collides (acceptance criterion #4).
 */
import {
  ActivePiece,
  isGameOver,
  lockAndAdvance,
  spawnPiece,
  tryMove,
  tryRotate,
} from "../rules";
import {
  BOARD_WIDTH,
  Board,
  Cell,
  cloneBoard,
  createBoard,
} from "../board";
import { TETROMINOES, TetrominoType } from "../tetrominoes";

/** Builds a completely solid board (every cell filled). */
function solidBoard(type: Cell = "I"): Board {
  const board = createBoard();
  for (const row of board) {
    for (let c = 0; c < row.length; c++) {
      row[c] = type;
    }
  }
  return board;
}

/** Carves out (empties) the exact cells of a piece so it fits in a solid board. */
function carve(
  board: Board,
  type: TetrominoType,
  rotation: number,
  row: number,
  col: number
): void {
  const matrix = TETROMINOES[type].rotations[rotation];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] !== 0) {
        board[row + r][col + c] = null;
      }
    }
  }
}

describe("rules", () => {
  it("spawnPiece centres the tetromino horizontally at the top", () => {
    const t = spawnPiece("T", BOARD_WIDTH);
    const pieceWidth = TETROMINOES.T.rotations[0][0].length;
    expect(t.col).toBe(Math.floor((BOARD_WIDTH - pieceWidth) / 2));
    expect(t.row).toBe(0);
    expect(t.rotation).toBe(0);

    const i = spawnPiece("I", BOARD_WIDTH);
    expect(i.col).toBe(Math.floor((BOARD_WIDTH - 4) / 2));
  });

  it("tryMove returns true and updates the piece on a legal move", () => {
    const board = createBoard();
    const piece: ActivePiece = { type: "T", rotation: 0, row: 5, col: 4 };
    expect(tryMove(board, piece, 0, -1)).toBe(true);
    expect(piece.col).toBe(3);
  });

  it("tryMove returns false and mutates neither piece nor board on failure", () => {
    const board = solidBoard();
    const piece: ActivePiece = { type: "T", rotation: 0, row: 9, col: 3 };
    carve(board, piece.type, piece.rotation, piece.row, piece.col);

    const boardBefore = cloneBoard(board);
    const rowBefore = piece.row;
    const colBefore = piece.col;

    // Moving down lands on a solid cell.
    expect(tryMove(board, piece, 1, 0)).toBe(false);
    expect(piece.row).toBe(rowBefore);
    expect(piece.col).toBe(colBefore);
    expect(board).toEqual(boardBefore);
  });

  it("tryRotate returns true and advances the rotation on an open board", () => {
    const board = createBoard();
    const piece: ActivePiece = { type: "T", rotation: 0, row: 5, col: 4 };
    expect(tryRotate(board, piece, 1)).toBe(true);
    expect(piece.rotation).toBe(1);
  });

  it("tryRotate returns false and mutates neither piece nor board when boxed in", () => {
    const board = solidBoard();
    const piece: ActivePiece = { type: "T", rotation: 0, row: 9, col: 3 };
    carve(board, piece.type, piece.rotation, piece.row, piece.col);

    const boardBefore = cloneBoard(board);
    const rotationBefore = piece.rotation;
    const rowBefore = piece.row;
    const colBefore = piece.col;

    expect(tryRotate(board, piece, 1)).toBe(false);
    expect(piece.rotation).toBe(rotationBefore);
    expect(piece.row).toBe(rowBefore);
    expect(piece.col).toBe(colBefore);
    expect(board).toEqual(boardBefore);
  });

  it("lockAndAdvance merges, clears lines, and spawns the next piece", () => {
    const board = createBoard();
    // Pre-fill the bottom row so locking the piece completes it.
    for (let c = 0; c < BOARD_WIDTH; c++) {
      board[19][c] = c < BOARD_WIDTH - 2 ? "I" : null;
    }
    // An O at row 18, col 8 fills (18,8),(18,9),(19,8),(19,9), completing row 19.
    const piece: ActivePiece = { type: "O", rotation: 0, row: 18, col: 8 };

    const result = lockAndAdvance(board, piece, "T");

    expect(result.cleared).toBe(1);
    // The cleared bottom row is gone; the O cells from row 18 dropped to row 19.
    expect(board[19][8]).toBe("O");
    expect(board[19][9]).toBe("O");
    expect(board[19][0]).toBeNull();
    // The former row 18 is now empty (it dropped to 19).
    expect(board[18].every((c) => c === null)).toBe(true);
    // A fresh T piece was spawned at the top.
    expect(result.current.type).toBe("T");
    expect(result.current.rotation).toBe(0);
    expect(result.current.row).toBe(0);
    // Game is not over on an otherwise-empty board.
    expect(result.gameOver).toBe(false);
  });

  it("flags game over when a freshly spawned piece immediately collides", () => {
    const board = createBoard();
    // Block the spawn region (cols 3-6, rows 0-1) without completing any row.
    for (let r = 0; r <= 1; r++) {
      for (let c = 3; c <= 6; c++) {
        board[r][c] = "L";
      }
    }

    // Direct check: a freshly spawned T collides at its spawn position.
    const spawned = spawnPiece("T");
    expect(isGameOver(board, spawned)).toBe(true);

    // End-to-end via lockAndAdvance: spawning the next piece collides.
    const lockingPiece: ActivePiece = { type: "O", rotation: 0, row: 18, col: 0 };
    const result = lockAndAdvance(board, lockingPiece, "T");
    expect(result.gameOver).toBe(true);
  });
});
