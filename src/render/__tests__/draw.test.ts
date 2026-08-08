import { describe, expect, it, jest } from '@jest/globals';
import { createBoard, setCell } from '../../game/board';
import { TETROMINOES } from '../../game/tetrominoes';
import { draw, type DrawContext } from '../draw';
import type { GameConfig, GameState } from '../../game/types';

const CONFIG: GameConfig = { width: 10, height: 20, cell: 30, tickMs: 500 };

const PANEL_WIDTH = 160;
const BOARD_WIDTH = CONFIG.width * CONFIG.cell; // 300
const BOARD_HEIGHT = CONFIG.height * CONFIG.cell; // 600
const CANVAS_WIDTH = BOARD_WIDTH + PANEL_WIDTH; // 460

/**
 * A mock 2D context that records every draw call.
 */
function makeMockContext(): DrawContext & {
  fillRect: jest.Mock;
  clearRect: jest.Mock;
  fillText: jest.Mock;
} {
  return {
    fillRect: jest.fn(),
    fillStyle: '',
    clearRect: jest.fn(),
    font: '',
    fillText: jest.fn(),
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: createBoard(CONFIG.width, CONFIG.height),
    current: TETROMINOES.T,
    next: TETROMINOES.S,
    x: 3,
    y: 0,
    rotation: 0,
    score: 123,
    level: 1,
    lines: 12,
    gameOver: false,
    ...overrides,
  };
}

describe('draw', () => {
  it('clears the full canvas first', () => {
    const ctx = makeMockContext();
    draw(ctx, makeState(), CONFIG);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, CANVAS_WIDTH, BOARD_HEIGHT);
  });

  it('paints the current piece cells at (x, y) using its rotation matrix', () => {
    const ctx = makeMockContext();
    // T piece spawn rotation occupies local (1,0), (0,1), (1,1), (2,1).
    // With x=3, y=0, cell=30 that maps to board (4,0), (3,1), (4,1), (5,1).
    draw(ctx, makeState(), CONFIG);
    expect(ctx.fillRect).toHaveBeenCalledWith(120, 0, 30, 30); // (4,0)
    expect(ctx.fillRect).toHaveBeenCalledWith(90, 30, 30, 30); // (3,1)
    expect(ctx.fillRect).toHaveBeenCalledWith(120, 30, 30, 30); // (4,1)
    expect(ctx.fillRect).toHaveBeenCalledWith(150, 30, 30, 30); // (5,1)
  });

  it('paints locked board cells colored by their value', () => {
    const ctx = makeMockContext();
    const board = setCell(createBoard(CONFIG.width, CONFIG.height), 0, 19, 1);
    draw(ctx, makeState({ board }), CONFIG);
    // Locked cell at board (0,19) -> pixel (0, 570).
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 570, 30, 30);
  });

  it('draws exactly the locked cell, current piece, and next preview cells', () => {
    const ctx = makeMockContext();
    const board = setCell(createBoard(CONFIG.width, CONFIG.height), 0, 19, 1);
    draw(ctx, makeState({ board }), CONFIG);
    // 1 background + 1 locked + 4 current-piece + 4 next-preview cells.
    expect(ctx.fillRect).toHaveBeenCalledTimes(10);
  });

  it('renders a HUD with score, level, and lines', () => {
    const ctx = makeMockContext();
    draw(ctx, makeState(), CONFIG);
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining('123'),
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining('1'),
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining('12'),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
