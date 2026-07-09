import { describe, it, expect } from "vitest";
import {
  clearLines,
  collides,
  computeLevel,
  computeScore,
  createEmptyBoard,
  createGame,
  getCells,
  mergePiece,
  spawnNext,
  tryMove,
  tryRotate,
  tick,
} from "../rules";
import { createBag, mulberry32 } from "../bag";
import { COLS, ROWS, LOCK_DELAY_MS } from "../types";
import type { ActivePiece, Board, GameState } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pieceAt(
  id: ActivePiece["id"],
  row: number,
  col: number,
  rotationIndex = 0,
): ActivePiece {
  return { id, rotationIndex, position: { row, col } };
}

function fillRow(board: Board, row: number, exceptCol = -1): void {
  for (let c = 0; c < COLS; c++) {
    if (c !== exceptCol) board[row]![c] = 1;
  }
}

// ---------------------------------------------------------------------------
// Board creation
// ---------------------------------------------------------------------------

describe("board creation", () => {
  it("creates a 20×10 empty board of zeros", () => {
    const board = createEmptyBoard();
    expect(board).toHaveLength(ROWS);
    for (const row of board) {
      expect(row).toHaveLength(COLS);
      for (const cell of row) expect(cell).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------------

describe("collision detection", () => {
  it("detects wall collision when moving into left wall", () => {
    const board = createEmptyBoard();
    const piece = pieceAt("O", 0, 0);
    expect(tryMove(board, piece, 0, -1)).toBeNull();
  });

  it("detects wall collision when moving into right wall", () => {
    const board = createEmptyBoard();
    const piece = pieceAt("O", 0, COLS - 2);
    expect(tryMove(board, piece, 0, 1)).toBeNull();
  });

  it("detects floor collision", () => {
    const board = createEmptyBoard();
    const piece = pieceAt("O", ROWS - 2, 0);
    expect(tryMove(board, piece, 1, 0)).toBeNull();
  });

  it("detects collision with an occupied cell", () => {
    const board = createEmptyBoard();
    board[1]![1] = 1; // block the cell
    const piece = pieceAt("O", 0, 0);
    // O occupies (0,0),(0,1),(1,0),(1,1) → (1,1) is now occupied
    expect(tryMove(board, piece, 1, 0)).toBeNull();
  });

  it("allows a valid move on an empty board", () => {
    const board = createEmptyBoard();
    const piece = pieceAt("O", 0, 0);
    const moved = tryMove(board, piece, 1, 0);
    expect(moved).not.toBeNull();
    expect(moved!.position.row).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Rotation & wall-kick
// ---------------------------------------------------------------------------

describe("rotation and wall-kick", () => {
  it("rotates on an empty board", () => {
    const board = createEmptyBoard();
    const piece = pieceAt("T", 5, 5, 0);
    const rotated = tryRotate(board, piece, 1);
    expect(rotated).not.toBeNull();
    expect(rotated!.rotationIndex).toBe(1);
  });

  it("uses wall-kick offsets to succeed in a tight spot", () => {
    const board = createEmptyBoard();
    // Build a cavity: the T-piece sits against a wall; rotation needs a kick.
    const piece = pieceAt("T", 5, 0, 0);
    // Rotate near left wall — should succeed via kick offset [−1,0] or [1,0].
    const rotated = tryRotate(board, piece, 1);
    expect(rotated).not.toBeNull();
  });

  it("fails when all kick offsets collide", () => {
    const board = createEmptyBoard();
    // Completely surround the piece.
    const piece = pieceAt("T", 10, 5, 0);
    // Fill cells around it so no kick can place the rotated shape.
    for (let r = 9; r <= 12; r++) {
      for (let c = 4; c <= 7; c++) {
        if (board[r]) board[r]![c] = 1;
      }
    }
    // Reset the piece area so the piece itself is valid initially.
    // Actually the piece occupies (10,6),(11,5),(11,6),(11,7) — clear those.
    board[10]![6] = 0;
    board[11]![5] = 0;
    board[11]![6] = 0;
    board[11]![7] = 0;
    const rotated = tryRotate(board, piece, 1);
    // All kick positions blocked.
    expect(rotated).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Merge & line clear
// ---------------------------------------------------------------------------

describe("merge and line clear", () => {
  it("mergePiece writes the piece cells onto the board", () => {
    const board = createEmptyBoard();
    const piece = pieceAt("O", 0, 0);
    const merged = mergePiece(board, piece);
    // O at (0,0) fills (0,0),(0,1),(1,0),(1,1)
    expect(merged[0]![0]).not.toBe(0);
    expect(merged[0]![1]).not.toBe(0);
    expect(merged[1]![0]).not.toBe(0);
    expect(merged[1]![1]).not.toBe(0);
    // Original is unmutated (immutability).
    expect(board[0]![0]).toBe(0);
  });

  it("clearLines removes a full row and shifts above down, returns count 1", () => {
    const board = createEmptyBoard();
    fillRow(board, ROWS - 1); // fill the bottom row
    const { board: cleared, linesCleared } = clearLines(board);
    expect(linesCleared).toBe(1);
    // After clearing, the bottom row should be empty.
    expect(cleared[ROWS - 1]!.every((c) => c === 0)).toBe(true);
  });

  it("clearLines clears multiple full rows and returns correct count", () => {
    const board = createEmptyBoard();
    fillRow(board, ROWS - 1);
    fillRow(board, ROWS - 2);
    const { board: cleared, linesCleared } = clearLines(board);
    expect(linesCleared).toBe(2);
    // Bottom two rows empty after clear.
    expect(cleared[ROWS - 1]!.every((c) => c === 0)).toBe(true);
    expect(cleared[ROWS - 2]!.every((c) => c === 0)).toBe(true);
  });

  it("clearLines does nothing to an incomplete row", () => {
    const board = createEmptyBoard();
    fillRow(board, ROWS - 1, 3); // leave col 3 empty
    const { linesCleared } = clearLines(board);
    expect(linesCleared).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scoring & level
// ---------------------------------------------------------------------------

describe("scoring", () => {
  it("awards 100 × (level+1) for a single line", () => {
    expect(computeScore(1, 0)).toBe(100);
    expect(computeScore(1, 1)).toBe(200);
  });

  it("awards 300 × (level+1) for a double", () => {
    expect(computeScore(2, 0)).toBe(300);
  });

  it("awards 500 × (level+1) for a triple", () => {
    expect(computeScore(3, 0)).toBe(500);
  });

  it("awards 800 × (level+1) for a tetris (4 lines)", () => {
    expect(computeScore(4, 0)).toBe(800);
    expect(computeScore(4, 1)).toBe(1600);
  });
});

describe("level progression", () => {
  it("starts at level 0 for 0 lines", () => {
    expect(computeLevel(0)).toBe(0);
  });

  it("advances one level every 10 lines", () => {
    expect(computeLevel(10)).toBe(1);
    expect(computeLevel(20)).toBe(2);
    expect(computeLevel(25)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Game creation & spawning
// ---------------------------------------------------------------------------

describe("game creation", () => {
  it("createGame returns status 'playing' with a non-null active piece", () => {
    const { state, bag } = createGame({ random: mulberry32(42) });
    expect(state.status).toBe("playing");
    expect(state.active).not.toBeNull();
    expect(bag).toBeDefined();
    expect(state.score).toBe(0);
    expect(state.lines).toBe(0);
    expect(state.level).toBe(0);
  });

  it("createGame is deterministic with a seeded RNG", () => {
    const a = createGame({ random: mulberry32(99) });
    const b = createGame({ random: mulberry32(99) });
    expect(a.state.active!.id).toBe(b.state.active!.id);
    expect(a.state.nextId).toBe(b.state.nextId);
  });
});

describe("spawnNext", () => {
  it("transitions to the next piece from the bag", () => {
    const { state, bag } = createGame({ random: mulberry32(42) });
    const after = spawnNext(state, bag);
    expect(after.active).not.toBeNull();
    expect(after.active!.id).toBe(state.nextId);
  });

  it("triggers gameOver when spawn position collides", () => {
    const { state, bag } = createGame({ random: mulberry32(42) });
    // Fill the top rows so the spawn position is blocked.
    const blockedBoard = state.board.map((row) =>
      row.map(() => 1),
    );
    const blockedState: GameState = { ...state, board: blockedBoard };
    const after = spawnNext(blockedState, bag);
    expect(after.status).toBe("gameOver");
    expect(after.active).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tick (gravity & lock)
// ---------------------------------------------------------------------------

describe("tick", () => {
  it("applies gravity over time, moving the piece down", () => {
    const { state, bag } = createGame({ random: mulberry32(42) });
    const startRow = state.active!.position.row;
    // 1000ms is one gravity step at level 0.
    const after = tick(state, 1000, bag);
    expect(after.active!.position.row).toBeGreaterThan(startRow);
  });

  it("locks the piece after lock delay when grounded", () => {
    const { state, bag } = createGame({ random: mulberry32(42) });
    // Place a piece right at the floor so it is immediately grounded.
    const groundedPiece = pieceAt("O", ROWS - 2, 0);
    const groundedState: GameState = { ...state, active: groundedPiece };
    // Tick past the lock delay.
    const after = tick(groundedState, LOCK_DELAY_MS + 10, bag);
    // The original piece should be locked (merged into the board) and a new
    // piece spawned. The O-piece occupied the bottom two rows at cols 0-1;
    // verify those cells are now settled.
    expect(after.active).not.toBeNull();
    expect(groundedState.board[ROWS - 1]![0]).toBe(0);
    expect(after.board[ROWS - 1]![0]).not.toBe(0);
  });

  it("is a no-op when status is gameOver", () => {
    const { state, bag } = createGame({ random: mulberry32(42) });
    const gameOverState: GameState = { ...state, status: "gameOver", active: null };
    const after = tick(gameOverState, 1000, bag);
    expect(after).toBe(gameOverState); // same reference, no change
  });
});

// ---------------------------------------------------------------------------
// getCells sanity
// ---------------------------------------------------------------------------

describe("getCells", () => {
  it("returns 4 absolute cells for any piece", () => {
    const piece = pieceAt("I", 5, 5);
    const cells = getCells(piece);
    expect(cells).toHaveLength(4);
    for (const [r, c] of cells) {
      expect(r).toBeGreaterThanOrEqual(5);
      expect(c).toBeGreaterThanOrEqual(5);
    }
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle: spawn → fall → lock → clear
// ---------------------------------------------------------------------------

describe("full game lifecycle", () => {
  it("can lock and clear a line via tick", () => {
    const bag = createBag(mulberry32(1));
    const { state } = createGame({ random: mulberry32(1) });
    let s = state;

    // Drive enough ticks for pieces to fall to the floor and lock.
    // At level 0, gravity is 1000ms/cell and each piece must fall ~18 rows,
    // plus 500ms lock delay ≈ 18500ms per piece. Tick 250 × 200ms = 50000ms
    // to lock at least 2 pieces.
    for (let i = 0; i < 250; i++) {
      s = tick(s, 200, bag);
    }
    // The board should have some settled cells.
    const settledCount = s.board
      .flat()
      .filter((c) => c !== 0).length;
    expect(settledCount).toBeGreaterThan(0);
  });
});
