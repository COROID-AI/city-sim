/**
 * Tests for the high-level game state reducer.
 */
import { applyAction, newGame, GameState } from "../state";
import { cloneBoard, createBoard } from "../board";

/** Deterministic linear-congruential RNG so sequences are reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("game state", () => {
  it("newGame returns a fresh, playable state", () => {
    const state = newGame({ random: makeRng(1) });
    expect(state.score).toBe(0);
    expect(state.lines).toBe(0);
    expect(state.level).toBe(1);
    expect(state.gameOver).toBe(false);
    expect(state.current).not.toBeNull();
    expect(state.board.every((row) => row.every((c) => c === null))).toBe(true);
    // Look-ahead queue is buffered for the UI.
    expect(state.queue.length).toBeGreaterThanOrEqual(1);
  });

  it("newGame is deterministic for the same seed", () => {
    const a = newGame({ random: makeRng(123) });
    const b = newGame({ random: makeRng(123) });
    expect(a.queue).toEqual(b.queue);
    expect(a.current?.type).toBe(b.current?.type);
  });

  it("MoveLeft decreases the column of the active piece", () => {
    const state = newGame({ random: makeRng(2) });
    const startCol = state.current!.col;
    const next = applyAction(state, { type: "MoveLeft" });
    expect(next.current!.col).toBe(startCol - 1);
  });

  it("MoveRight increases the column of the active piece", () => {
    const state = newGame({ random: makeRng(2) });
    const startCol = state.current!.col;
    const next = applyAction(state, { type: "MoveRight" });
    expect(next.current!.col).toBe(startCol + 1);
  });

  it("Rotate advances the rotation state of the active piece", () => {
    const state = newGame({ random: makeRng(3) });
    expect(state.current!.rotation).toBe(0);
    const next = applyAction(state, { type: "Rotate" });
    expect(next.current!.rotation).toBe(1);
  });

  it("SoftDrop lowers the piece by one row and awards a point", () => {
    const state = newGame({ random: makeRng(4) });
    const startRow = state.current!.row;
    const next = applyAction(state, { type: "SoftDrop" });
    expect(next.current!.row).toBe(startRow + 1);
    expect(next.score).toBe(state.score + 1);
  });

  it("HardDrop locks the piece, advances to the next, and scores", () => {
    const state = newGame({ random: makeRng(5) });
    const firstType = state.current!.type;

    const next = applyAction(state, { type: "HardDrop" });

    // The active piece advanced to something new.
    expect(next.current!.type).not.toBe(firstType);
    // Score increased (drop distance * 2, at minimum).
    expect(next.score).toBeGreaterThan(state.score);
    // The dropped piece is now locked into the bottom of the board.
    const bottomHasBlock = next.board.some((row) =>
      row.some((c) => c === firstType)
    );
    expect(bottomHasBlock).toBe(true);
    expect(next.gameOver).toBe(false);
  });

  it("becomes game over once the stack reaches the spawn area", () => {
    let state = newGame({ random: makeRng(6) });
    let guard = 0;
    while (!state.gameOver && guard < 2000) {
      state = applyAction(state, { type: "HardDrop" });
      guard += 1;
    }
    expect(state.gameOver).toBe(true);
    // Further actions are a no-op and return the same state.
    const after = applyAction(state, { type: "MoveLeft" });
    expect(after).toBe(state);
  });

  it("applyAction never mutates the input state", () => {
    const state = newGame({ random: makeRng(7) });
    const boardBefore = cloneBoard(state.board);
    const colBefore = state.current!.col;

    const next = applyAction(state, { type: "MoveLeft" });

    expect(state.board).toEqual(boardBefore);
    expect(state.current!.col).toBe(colBefore);
    expect(next).not.toBe(state);
  });
});
