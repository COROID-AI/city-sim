import { describe, expect, it } from '@jest/globals';
import { createBoard, setCell } from '../../game/board';
import { TETROMINOES } from '../../game/tetrominoes';
import type { GameState } from '../../game/types';
import { draw, getCanvasSize } from '../draw';
import type { DrawContext, RenderConfig } from '../draw';

const CONFIG: RenderConfig = { width: 10, height: 20, cell: 30, tickMs: 500 };
const SIZE = getCanvasSize(CONFIG);

interface FillCall {
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RectCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

const cellAt = (x: number, y: number): RectCall => ({
  x: x * CONFIG.cell,
  y: y * CONFIG.cell,
  w: CONFIG.cell,
  h: CONFIG.cell,
});

/** Minimal `DrawContext` that records every call instead of painting. */
class MockContext implements DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  font = '';
  fills: FillCall[] = [];
  clears: RectCall[] = [];
  texts: Array<{ text: string; x: number; y: number }> = [];

  fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push({ color: String(this.fillStyle), x, y, w, h });
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.clears.push({ x, y, w, h });
  }

  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y });
  }
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: createBoard(CONFIG.width, CONFIG.height),
    current: TETROMINOES.T[0],
    next: TETROMINOES.I[0],
    x: 3,
    y: 15,
    rotation: 0,
    score: 0,
    level: 0,
    lines: 0,
    gameOver: false,
    ...overrides,
  };
}

describe('draw', () => {
  it('clears the full canvas first', () => {
    const ctx = new MockContext();
    draw(ctx, makeState(), CONFIG);

    expect(ctx.clears).toEqual([
      { x: 0, y: 0, w: SIZE.width, h: SIZE.height },
    ]);
  });

  it('paints every non-zero locked board cell with a value-derived color', () => {
    const board = setCell(
      setCell(createBoard(CONFIG.width, CONFIG.height), 4, 19, 1),
      7,
      18,
      3,
    );
    const ctx = new MockContext();
    draw(ctx, makeState({ board }), CONFIG);

    expect(ctx.fills).toContainEqual({
      ...cellAt(4, 19),
      color: '#00e5ff', // cell value 1 (I)
    });
    expect(ctx.fills).toContainEqual({
      ...cellAt(7, 18),
      color: '#b26bff', // cell value 3 (T)
    });
  });

  it('draws the current piece cells from its rotation matrix at (x, y)', () => {
    // Vertical I piece: all four cells share column x + 2, rows y..y + 3.
    const ctx = new MockContext();
    draw(ctx, makeState({ current: TETROMINOES.I[1], rotation: 1 }), CONFIG);

    for (let row = 0; row < 4; row++) {
      expect(ctx.fills).toContainEqual({
        ...cellAt(5, 15 + row),
        color: '#00e5ff',
      });
    }

    // The piece cells are drawn cell-sized on the board grid.
    const pieceFills = ctx.fills.filter(
      (fill) => fill.w === CONFIG.cell && fill.h === CONFIG.cell,
    );
    expect(pieceFills.length).toBeGreaterThanOrEqual(4);
  });

  it('draws the next-piece preview in the side panel and the HUD', () => {
    const ctx = new MockContext();
    draw(ctx, makeState({ score: 123, level: 4, lines: 37 }), CONFIG);

    // next = I[0]: horizontal row at preview row 1 -> y = (10 + 24) + 30.
    expect(ctx.fills).toContainEqual({
      x: CONFIG.width * CONFIG.cell + 12 + 10,
      y: 10 + 24 + CONFIG.cell,
      w: CONFIG.cell,
      h: CONFIG.cell,
      color: '#00e5ff',
    });

    expect(ctx.texts).toContainEqual(expect.objectContaining({ text: 'Next' }));
    expect(ctx.texts).toContainEqual(
      expect.objectContaining({ text: 'Score: 123' }),
    );
    expect(ctx.texts).toContainEqual(
      expect.objectContaining({ text: 'Level: 4' }),
    );
    expect(ctx.texts).toContainEqual(
      expect.objectContaining({ text: 'Lines: 37' }),
    );
    expect(ctx.font).toBe('16px monospace');
  });
});