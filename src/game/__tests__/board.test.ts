/**
 * Tests for board primitives, including clearLines (acceptance criterion #3).
 */
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  Cell,
  clearLines,
  collides,
  createBoard,
  inBounds,
  mergePiece,
} from "../board";

/** Fills an entire row with a single tetromino type. */
function fillRow(board: Cell[][], row: number, type: Cell = "I"): void {
  for (let c = 0; c < board[row].length; c++) {
    board[row][c] = type;
  }
}

describe("board", () => {
  it("createBoard builds an empty grid with the standard dimensions", () => {
    const board = createBoard();
    expect(board).toHaveLength(BOARD_HEIGHT);
    for (const row of board) {
      expect(row).toHaveLength(BOARD_WIDTH);
      expect(row.every((cell) => cell === null)).toBe(true);
    }
  });

  it("inBounds accepts the corners and rejects out-of-range cells", () => {
    const board = createBoard();
    expect(inBounds(board, 0, 0)).toBe(true);
    expect(inBounds(board, BOARD_HEIGHT - 1, BOARD_WIDTH - 1)).toBe(true);
    expect(inBounds(board, -1, 0)).toBe(false);
    expect(inBounds(board, 0, -1)).toBe(false);
    expect(inBounds(board, BOARD_HEIGHT, 0)).toBe(false);
    expect(inBounds(board, 0, BOARD_WIDTH)).toBe(false);
  });

  it("collides detects the left and right walls", () => {
    const board = createBoard();
    // The vertical I (rotation 1) fills matrix column index 2, so the left
    // wall is only reached when col + 2 < 0.
    expect(collides(board, "I", 1, 0, -3)).toBe(true);
    // And the right wall when col + 2 >= BOARD_WIDTH.
    expect(collides(board, "I", 1, 0, BOARD_WIDTH - 2)).toBe(true);
    // A centred placement does not collide.
    expect(collides(board, "I", 1, 0, 3)).toBe(false);
  });

  it("collides detects the floor", () => {
    const board = createBoard();
    // O piece at the very bottom row fits exactly (rows 18..19).
    expect(collides(board, "O", 0, BOARD_HEIGHT - 2, 0)).toBe(false);
    // One row lower runs off the floor.
    expect(collides(board, "O", 0, BOARD_HEIGHT - 1, 0)).toBe(true);
  });

  it("collides detects overlap with a locked cell and a clear placement", () => {
    const board = createBoard();
    board[1][3] = "L"; // block where a freshly spawned T would sit
    expect(collides(board, "T", 0, 0, 3)).toBe(true);
    // Shifting right avoids the block.
    expect(collides(board, "T", 0, 0, 4)).toBe(false);
  });

  it("mergePiece writes exactly the piece's filled cells into the board", () => {
    const board = createBoard();
    // T at row 18, col 3, rotation 0 fills (18,4),(19,3),(19,4),(19,5).
    mergePiece(board, "T", 0, 18, 3);
    expect(board[18][4]).toBe("T");
    expect(board[19][3]).toBe("T");
    expect(board[19][4]).toBe("T");
    expect(board[19][5]).toBe("T");
    // The rest of the neighbourhood stays empty.
    expect(board[18][3]).toBeNull();
    expect(board[19][6]).toBeNull();
  });

  it("clearLines returns the cleared count and lets the board reflect the drop", () => {
    const board = createBoard();
    // Two complete rows at the bottom...
    fillRow(board, 18);
    fillRow(board, 19);
    // ...plus a single floating block above them at (17, 0).
    board[17][0] = "Z";

    const cleared = clearLines(board);

    expect(cleared).toBe(2);
    // The floating block dropped by two rows to the new bottom.
    expect(board[19][0]).toBe("Z");
    // Its old cell is now empty.
    expect(board[17][0]).toBeNull();
    // The top two refill rows are empty.
    expect(board[0].every((c) => c === null)).toBe(true);
    expect(board[1].every((c) => c === null)).toBe(true);
  });

  it("clearLines returns 0 and leaves the board untouched when no row is full", () => {
    const board = createBoard();
    board[19][0] = "I";
    board[19][1] = "I";
    const snapshot = board.map((row) => row.slice());
    expect(clearLines(board)).toBe(0);
    expect(board).toEqual(snapshot);
  });
});
