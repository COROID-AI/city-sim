import type { Cell, GameConfig, GameState } from '../game/types';

/**
 * The minimal 2D-canvas surface that `draw` needs.
 *
 * Declared as a structural interface so tests can pass a lightweight mock
 * that records calls, without requiring a real `CanvasRenderingContext2D`.
 * `CanvasRenderingContext2D` satisfies this interface structurally, so a
 * real context can be passed from the render loop unchanged.
 */
export interface DrawContext {
  fillRect(x: number, y: number, w: number, h: number): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  clearRect(x: number, y: number, w: number, h: number): void;
  font: string;
  fillText(text: string, x: number, y: number): void;
}

/**
 * Color palette indexed by the `Cell` value (1-7). The I, O, T, S, Z, J, L
 * pieces map to cyan, yellow, purple, green, red, blue, and orange. `0`
 * (empty) is never painted.
 */
const CELL_COLORS: Record<Cell, string> = {
  0: '#000000',
  1: '#00e5ff', // I
  2: '#ffd500', // O
  3: '#a000f0', // T
  4: '#00f000', // S
  5: '#f00000', // Z
  6: '#0000f0', // J
  7: '#f0a000', // L
};

/** Width in CSS pixels of the side panel (next preview + HUD). */
const PANEL_WIDTH = 160;

/**
 * Paint the full game frame onto `ctx`.
 *
 * The function is pure with respect to the context: it never reads or writes
 * the DOM and only mutates the provided `DrawContext`. It draws, in order:
 *   (a) clears the whole canvas and fills the background;
 *   (b) every non-zero locked board cell, colored by its value;
 *   (c) the current piece's cells at (state.x, state.y) using its rotation;
 *   (d) the next-piece preview in the side panel;
 *   (e) a HUD showing score, level, and lines.
 */
export function draw(ctx: DrawContext, state: GameState, config: GameConfig): void {
  const cell = config.cell;
  const boardWidth = config.width * cell;
  const boardHeight = config.height * cell;
  const canvasWidth = boardWidth + PANEL_WIDTH;

  // (a) Clear the canvas and paint the background.
  ctx.clearRect(0, 0, canvasWidth, boardHeight);
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, canvasWidth, boardHeight);

  // (b) Locked board cells.
  for (let y = 0; y < state.board.length; y++) {
    const row = state.board[y];
    for (let x = 0; x < row.length; x++) {
      const value = row[x];
      if (value === 0) continue;
      ctx.fillStyle = CELL_COLORS[value];
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  // (c) Current piece at (state.x, state.y) with its rotation.
  const matrix = state.current.rotations[state.rotation];
  for (let py = 0; py < matrix.length; py++) {
    for (let px = 0; px < matrix[py].length; px++) {
      const value = matrix[py][px];
      if (value === 0) continue;
      ctx.fillStyle = CELL_COLORS[value];
      ctx.fillRect((state.x + px) * cell, (state.y + py) * cell, cell, cell);
    }
  }

  // (d) Next-piece preview in the side panel.
  const panelX = boardWidth;
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px monospace';
  ctx.fillText('NEXT', panelX + 12, 28);

  const previewCell = 24;
  const previewWidth = 4 * previewCell;
  const previewX = panelX + Math.floor((PANEL_WIDTH - previewWidth) / 2);
  const previewY = 48;
  const nextMatrix = state.next.rotations[0];
  for (let py = 0; py < nextMatrix.length; py++) {
    for (let px = 0; px < nextMatrix[py].length; px++) {
      const value = nextMatrix[py][px];
      if (value === 0) continue;
      ctx.fillStyle = CELL_COLORS[value];
      ctx.fillRect(previewX + px * previewCell, previewY + py * previewCell, previewCell, previewCell);
    }
  }

  // (e) HUD: score, level, and lines.
  ctx.fillStyle = '#ffffff';
  ctx.font = '16px monospace';
  ctx.fillText(`SCORE ${state.score}`, panelX + 12, 180);
  ctx.fillText(`LEVEL ${state.level}`, panelX + 12, 220);
  ctx.fillText(`LINES ${state.lines}`, panelX + 12, 260);
}
