import { describe, it, expect } from "vitest";
import { createRenderer } from "../draw";
import { createGame } from "../../game/rules";
import { mulberry32 } from "../../game/bag";
import { COLS, ROWS } from "../../game/types";
import type { GameState } from "../../game/types";

/**
 * Stub a canvas + 2D context for jsdom (which does not implement canvas).
 * We only track that the methods we rely on are invoked; we do not pixel-test.
 */
function makeStubCanvas(): HTMLCanvasElement {
  const canvas = {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: () => ({
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      set fillStyle(_v: string) {},
      set strokeStyle(_v: string) {},
      set lineWidth(_v: number) {},
      set globalAlpha(_v: number) {},
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return canvas as unknown as HTMLCanvasElement;
}

describe("renderer", () => {
  it("createRenderer does not throw with stubbed canvases", () => {
    expect(() =>
      createRenderer({
        boardCanvas: makeStubCanvas(),
        nextCanvas: makeStubCanvas(),
      }),
    ).not.toThrow();
  });

  it("rendering an empty fresh state does not throw", () => {
    const { state } = createGame({ random: mulberry32(7) });
    const renderer = createRenderer({
      boardCanvas: makeStubCanvas(),
      nextCanvas: makeStubCanvas(),
    });
    expect(() => renderer.render(state)).not.toThrow();
  });

  it("rendering a state with a partially filled row does not throw", () => {
    const { state } = createGame({ random: mulberry32(7) });
    const partialBoard = state.board.map((row) => [...row]);
    // Fill a few cells in the bottom row.
    partialBoard[ROWS - 1]![0] = 1;
    partialBoard[ROWS - 1]![1] = 2;
    partialBoard[ROWS - 1]![2] = 3;
    const partialState: GameState = { ...state, board: partialBoard };

    const renderer = createRenderer({
      boardCanvas: makeStubCanvas(),
      nextCanvas: makeStubCanvas(),
    });
    expect(() => renderer.render(partialState)).not.toThrow();
  });

  it("rendering a gameOver state (null active) does not throw", () => {
    const { state } = createGame({ random: mulberry32(7) });
    const overState: GameState = {
      ...state,
      status: "gameOver",
      active: null,
    };
    const renderer = createRenderer({
      boardCanvas: makeStubCanvas(),
      nextCanvas: makeStubCanvas(),
    });
    expect(() => renderer.render(overState)).not.toThrow();
  });

  it("board dimensions are consistent with COLS and ROWS", () => {
    // Sanity guard: constants match expected Tetris dimensions.
    expect(COLS).toBe(10);
    expect(ROWS).toBe(20);
  });
});
