/**
 * Tests for the Canvas renderer.
 *
 * jsdom does not implement a real canvas drawing pipeline, but it does expose
 * a `CanvasRenderingContext2D` with stubbed methods, so we can assert that the
 * drawing helpers call the expected context operations and stay pure (no game
 * state mutation).
 */
import {
  CELL_SIZE,
  BOARD_PIXEL_WIDTH,
  BOARD_PIXEL_HEIGHT,
  clearBoard,
  drawGrid,
  drawBoard,
  drawPiece,
  drawNextPiece,
  drawGameOver,
} from "../draw";
import { createBoard } from "../../game/board";
import type { ActivePiece } from "../../game/rules";
import { newGame } from "../../game/state";

/** A minimal spy context that records fillRect/strokeStyle/etc. calls. */
interface RecordedFill {
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function makeSpyCtx(): {
  ctx: CanvasRenderingContext2D;
  fills: RecordedFill[];
  strokeStyle: string[];
} {
  const fills: RecordedFill[] = [];
  const strokeStyle: string[] = [];
  const ctx = {
    fillRect: (x: number, y: number, w: number, h: number) => {
      // Record only the block-coloured fills (skip highlight overlay).
      fills.push({ color: ctx.fillStyle as string, x, y, w, h });
    },
    fillStyle: "",
    set fillStyleSetter(v: string) {
      ctx.fillStyle = v;
    },
    strokeStyle: "",
    lineWidth: 1,
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {
      strokeStyle.push(ctx.strokeStyle as string);
    },
    font: "",
    textAlign: "",
    textBaseline: "",
    fillText: () => {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fills, strokeStyle };
}

describe("renderer constants", () => {
  it("uses a 30px cell size", () => {
    expect(CELL_SIZE).toBe(30);
  });

  it("computes board pixel dimensions from the standard grid", () => {
    expect(BOARD_PIXEL_WIDTH).toBe(300);
    expect(BOARD_PIXEL_HEIGHT).toBe(600);
  });
});

describe("clearBoard", () => {
  it("fills the entire canvas with the background colour", () => {
    const { ctx, fills } = makeSpyCtx();
    clearBoard(ctx, 300, 600);
    expect(fills).toContainEqual({
      color: "#0f0f1e",
      x: 0,
      y: 0,
      w: 300,
      h: 600,
    });
  });
});

describe("drawBoard", () => {
  it("draws one cell per filled board cell using its tetromino colour", () => {
    const { ctx, fills } = makeSpyCtx();
    const board = createBoard();
    board[19][0] = "I";
    board[19][1] = "L";

    drawBoard(ctx, board);

    // Two locked cells → at least two block fills at the expected coordinates.
    const blockFills = fills.filter(
      (f) => f.w === CELL_SIZE - 2 && f.h === CELL_SIZE - 2
    );
    expect(blockFills.length).toBeGreaterThanOrEqual(2);
    // Cell (0,19): x = 0*30 = 0, y = 19*30 = 570.
    expect(
      blockFills.some((f) => f.x === 1 && f.y === 571)
    ).toBe(true);
    // Cell (1,19): x = 1*30 = 30, y = 570.
    expect(
      blockFills.some((f) => f.x === 31 && f.y === 571)
    ).toBe(true);
  });

  it("does not mutate the board", () => {
    const { ctx } = makeSpyCtx();
    const board = createBoard();
    const before = JSON.stringify(board);
    drawBoard(ctx, board);
    expect(JSON.stringify(board)).toBe(before);
  });
});

describe("drawPiece", () => {
  it("draws the active piece at its current position", () => {
    const { ctx, fills } = makeSpyCtx();
    const piece: ActivePiece = {
      type: "O",
      rotation: 0,
      row: 0,
      col: 0,
    };
    drawPiece(ctx, piece);

    const blockFills = fills.filter(
      (f) => f.w === CELL_SIZE - 2 && f.h === CELL_SIZE - 2
    );
    // O piece is 2x2 = 4 filled cells.
    expect(blockFills.length).toBe(4);
  });

  it("draws nothing when the piece is null", () => {
    const { ctx, fills } = makeSpyCtx();
    drawPiece(ctx, null);
    expect(fills).toHaveLength(0);
  });
});

describe("drawNextPiece", () => {
  it("clears the preview then draws the next piece", () => {
    const { ctx, fills } = makeSpyCtx();
    drawNextPiece(ctx, "I", 120, 120);
    // At least one background clear + block fills.
    expect(fills.length).toBeGreaterThan(0);
  });

  it("draws nothing but the background when the type is null", () => {
    const { ctx, fills } = makeSpyCtx();
    drawNextPiece(ctx, null, 120, 120);
    expect(fills).toHaveLength(1);
    expect(fills[0].color).toBe("#0f0f1e");
  });
});

describe("drawGameOver", () => {
  it("draws a translucent overlay and text", () => {
    const { ctx, fills } = makeSpyCtx();
    drawGameOver(ctx, 300, 600);
    expect(fills.length).toBeGreaterThan(0);
  });
});

describe("drawGrid", () => {
  it("issues a single stroke for the full grid", () => {
    const { ctx, strokeStyle } = makeSpyCtx();
    drawGrid(ctx);
    expect(strokeStyle.length).toBe(1);
  });
});

describe("integration with game state", () => {
  it("renders a fresh game state without throwing", () => {
    const { ctx } = makeSpyCtx();
    const state = newGame();
    expect(() => {
      clearBoard(ctx, BOARD_PIXEL_WIDTH, BOARD_PIXEL_HEIGHT);
      drawGrid(ctx);
      drawBoard(ctx, state.board);
      drawPiece(ctx, state.current);
    }).not.toThrow();
  });
});
