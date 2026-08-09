/**
 * Canvas renderer for the Tetris board.
 *
 * `draw` is pure with respect to its environment: it only writes through the
 * injected `DrawContext` (a minimal subset of `CanvasRenderingContext2D`) and
 * never touches the DOM, so tests can drive it with a mock context. All
 * geometry is derived from the pure `RenderConfig`, keeping rendering fully
 * deterministic for a given state.
 */
import type { GameConfig, GameState } from '../game/types';

/** Game config plus the pixel size of one board cell. */
export interface RenderConfig extends GameConfig {
  /** Edge length of one cell in CSS pixels. */
  cell: number;
}

/**
 * Minimal 2D-canvas surface the renderer needs. A real
 * `CanvasRenderingContext2D` satisfies this interface structurally, and tests
 * can use a small mock object.
 */
export interface DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

/** Horizontal gap (px) between the board and the side panel. */
const SIDE_GAP = 12;

/** Padding (px) inside the side panel edges. */
const SIDE_PADDING = 10;

/** The preview shows a piece inside its 4x4 rotation box. */
const PREVIEW_BOX = 4;

/** Font used for the side-panel labels. */
const LABEL_FONT = '16px monospace';

/** Fill colors keyed by the board `Cell` value (1-7). */
const COLORS: Record<number, string> = {
  1: '#00e5ff', // I  cyan
  2: '#ffe93b', // O  yellow
  3: '#b26bff', // T  purple
  4: '#3ddc55', // S  green
  5: '#ff3b3b', // Z  red
  6: '#3b6bff', // J  blue
  7: '#ff9a3b', // L  orange
};

/** Background colors and text color for the canvas. */
const BOARD_BG = '#0f1420';
const PANEL_BG = '#151b28';
const PREVIEW_BG = '#0a0e16';
const TEXT_COLOR = '#e8edf5';

/**
 * Total pixel width of the play area: the board, the side gap, and the side
 * panel containing the next-piece preview and the HUD.
 */
function panelWidth(config: RenderConfig): number {
  return PREVIEW_BOX * config.cell + SIDE_PADDING * 2;
}

/**
 * Total pixel dimensions the canvas must have for this config: the board
 * (`width` x `height` cells) plus the side panel. Exported so `main.ts` can
 * size the canvas element and the tests can assert the clearRect coverage.
 */
export function getCanvasSize(config: RenderConfig): {
  width: number;
  height: number;
} {
  return {
    width: config.width * config.cell + SIDE_GAP + panelWidth(config),
    height: config.height * config.cell,
  };
}

/**
 * Paints one full frame: clears the canvas, draws every locked board cell,
 * overlays the current piece from its rotation matrix, shows the next-piece
 * preview in the side panel, and renders the score/level/lines HUD.
 */
export function draw(
  ctx: DrawContext,
  state: GameState,
  config: RenderConfig,
): void {
  const { width, height, cell } = config;
  const boardWidth = width * cell;
  const boardHeight = height * cell;
  const panelX = boardWidth + SIDE_GAP;
  const panelW = panelWidth(config);

  // (a) Clear the whole canvas.
  ctx.clearRect(0, 0, panelX + panelW, boardHeight);

  // Board background.
  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, boardWidth, boardHeight);

  // (b) Locked board cells: color is derived from the cell value.
  for (let y = 0; y < height; y++) {
    const row = state.board[y];
    for (let x = 0; x < width; x++) {
      const value = row[x];
      if (value !== 0) fillCell(ctx, x, y, value, cell);
    }
  }

  // (c) Current piece at (state.x, state.y) using its rotation matrix.
  const matrix = state.current.matrix;
  for (let row = 0; row < matrix.length; row++) {
    const matrixRow = matrix[row];
    for (let col = 0; col < matrixRow.length; col++) {
      const value = matrixRow[col];
      if (value !== 0) {
        fillCell(ctx, state.x + col, state.y + row, value, cell);
      }
    }
  }

  // Side panel background.
  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(panelX, 0, panelW, boardHeight);

  const labelX = panelX + SIDE_PADDING;
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = LABEL_FONT;
  ctx.fillText('Next', labelX, SIDE_PADDING + 16);

  // (d) Next-piece preview inside the panel's 4x4 box.
  const previewLeft = panelX + SIDE_PADDING;
  const previewTop = SIDE_PADDING + 24;
  const previewSize = PREVIEW_BOX * cell;
  ctx.fillStyle = PREVIEW_BG;
  ctx.fillRect(previewLeft, previewTop, previewSize, previewSize);

  const next = state.next.matrix;
  for (let row = 0; row < next.length; row++) {
    const nextRow = next[row];
    for (let col = 0; col < nextRow.length; col++) {
      const value = nextRow[col];
      if (value === 0) continue;
      ctx.fillStyle = COLORS[value];
      ctx.fillRect(
        previewLeft + col * cell,
        previewTop + row * cell,
        cell,
        cell,
      );
    }
  }

  // (e) HUD: score, level, lines.
  let hudY = previewTop + previewSize + 32;
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(`Score: ${state.score}`, labelX, hudY);
  hudY += 26;
  ctx.fillText(`Level: ${state.level}`, labelX, hudY);
  hudY += 26;
  ctx.fillText(`Lines: ${state.lines}`, labelX, hudY);
}

/** Fills the cell at board coordinates (x, y) with the value's color. */
function fillCell(
  ctx: DrawContext,
  x: number,
  y: number,
  value: number,
  cell: number,
): void {
  ctx.fillStyle = COLORS[value];
  ctx.fillRect(x * cell, y * cell, cell, cell);
}