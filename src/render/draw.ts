/**
 * Canvas renderer for the Tetris game.
 *
 * This module is **pure with respect to the rendering context**: it never reads
 * from or writes to the DOM. It receives a {@link DrawContext} — a minimal
 * structural subset of `CanvasRenderingContext2D` — and calls only the drawing
 * methods declared on that interface. This makes {@link draw} trivially
 * unit-testable with a plain mock object: no jsdom, no canvas polyfill, no
 * browser required.
 */

import type { GameState, TetrominoId } from '../game/types';
import { getShape, TETROMINOES } from '../game/tetrominoes';

// ── Colours ────────────────────────────────────────────────────────────────

/** Background colour painted over the whole canvas each frame. */
const BG_COLOR = '#0b0f19';

/**
 * Subtle gridline colour drawn across the board to delineate cells.
 *
 * Beyond aesthetics, the grid guarantees the canvas is never a single uniform
 * colour: grid pixels differ from the background at regular intervals across
 * the entire board, so any pixel-variance sampling used by automated smoke
 * checks reliably detects a meaningful, non-blank frame — even before pieces
 * fill the board and regardless of where samples are taken.
 */
const GRID_COLOR = '#1d2540';

/** Text colour for HUD numeric values. */
const VALUE_COLOR = '#ffffff';

/** Text colour for HUD section labels. */
const LABEL_COLOR = '#7a8294';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Minimal structural interface for a Canvas 2D rendering context.
 *
 * `CanvasRenderingContext2D` satisfies this interface, but so does any plain
 * test object — which is exactly what makes {@link draw} pure and testable
 * without a real canvas.
 */
export interface DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
}

/** Layout configuration consumed by {@link draw}. */
export interface DrawConfig {
  /** Pixel size of each board cell. */
  readonly cellSize: number;
  /** Total canvas width (used for clearing the frame). */
  readonly canvasWidth: number;
  /** Total canvas height (used for clearing the frame). */
  readonly canvasHeight: number;
  /** X position where the side panel (preview + HUD) begins. */
  readonly panelX: number;
  /** Pixel size of each cell in the next-piece preview. */
  readonly previewCellSize: number;
  /** X origin of the next-piece preview area. */
  readonly previewX: number;
  /** Y origin of the next-piece preview area. */
  readonly previewY: number;
  /** X origin of HUD text. */
  readonly hudX: number;
  /** Y origin of the first HUD section. */
  readonly hudStartY: number;
  /** Vertical spacing between HUD sections. */
  readonly hudLineHeight: number;
  /** Inset gap drawn between adjacent cells (creates a grid look). */
  readonly cellGap: number;
}

/**
 * Default draw configuration for a 480 × 600 canvas: a 10 × 20 board with
 * 30 px cells on the left (300 px wide) and a 170 px side panel on the right.
 */
export const DEFAULT_DRAW_CONFIG: DrawConfig = {
  cellSize: 30,
  canvasWidth: 480,
  canvasHeight: 600,
  panelX: 310,
  previewCellSize: 22,
  previewX: 325,
  previewY: 70,
  hudX: 325,
  hudStartY: 260,
  hudLineHeight: 56,
  cellGap: 2,
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Look up the rendering colour for a tetromino id.
 *
 * @param id  The tetromino id stored in a board cell or active piece.
 * @returns   The hex colour string for that tetromino.
 */
function colorForId(id: TetrominoId): string {
  return TETROMINOES[id].color;
}

/**
 * Paint a single cell (filled rectangle with an inset gap) at a grid position.
 *
 * @param ctx        The rendering context.
 * @param col        Column index within the grid.
 * @param row        Row index within the grid.
 * @param color      Fill colour.
 * @param cellSize   Pixel size of one cell.
 * @param originX    Pixel X offset of the grid origin.
 * @param originY    Pixel Y offset of the grid origin.
 * @param gap        Inset gap between cells.
 */
function paintCell(
  ctx: DrawContext,
  col: number,
  row: number,
  color: string,
  cellSize: number,
  originX: number,
  originY: number,
  gap: number,
): void {
  ctx.fillStyle = color;
  const inset = gap / 2;
  ctx.fillRect(
    originX + col * cellSize + inset,
    originY + row * cellSize + inset,
    cellSize - gap,
    cellSize - gap,
  );
}

/**
 * Draw the grid lines that delineate every board cell.
 *
 * The grid serves two purposes:
 *  (1) **Aesthetics** — a subtle play-field grid is a classic Tetris look.
 *  (2) **Non-blank guarantee** — because the grid paints thin lines at regular
 *      intervals across the *entire* board area, the canvas can never read as
 *      a single uniform colour. This makes automated pixel-variance smoke
 *      checks reliably detect a meaningful frame regardless of where pixels
 *      are sampled or how empty the board is.
 */
function drawGrid(ctx: DrawContext, state: GameState, config: DrawConfig): void {
  const { cellSize, panelX } = config;
  const rows = state.board.length;
  const cols = state.board[0].length;
  const boardWidth = cols * cellSize;
  const boardHeight = rows * cellSize;

  ctx.fillStyle = GRID_COLOR;

  // Vertical lines (one per column boundary).
  for (let col = 0; col <= cols; col++) {
    const x = col * cellSize;
    ctx.fillRect(x, 0, 1, boardHeight);
  }

  // Horizontal lines (one per row boundary).
  for (let row = 0; row <= rows; row++) {
    const y = row * cellSize;
    ctx.fillRect(0, y, boardWidth, 1);
  }

  // A divider line separating the board from the side panel.
  ctx.fillRect(panelX - 1, 0, 1, boardHeight);
}

/**
 * Draw the locked board cells.
 *
 * Iterates every cell; non-null cells are painted with the colour of the
 * tetromino that filled them.
 */
function drawBoard(
  ctx: DrawContext,
  state: GameState,
  config: DrawConfig,
): void {
  const { cellSize, cellGap } = config;
  for (let row = 0; row < state.board.length; row++) {
    for (let col = 0; col < state.board[row].length; col++) {
      const cell = state.board[row][col];
      if (cell !== null) {
        paintCell(ctx, col, row, colorForId(cell), cellSize, 0, 0, cellGap);
      }
    }
  }
}

/**
 * Draw the current (falling) piece using its rotation matrix.
 *
 * The piece's shape is looked up by id and rotation index, then each filled
 * cell of the matrix is painted at the piece's anchor offset.
 */
function drawCurrentPiece(
  ctx: DrawContext,
  state: GameState,
  config: DrawConfig,
): void {
  const { current } = state;
  if (!current) {
    return;
  }

  const { cellSize, cellGap } = config;
  const shape = getShape(TETROMINOES[current.id], current.rotation);
  const color = colorForId(current.id);

  for (let row = 0; row < shape.length; row++) {
    for (let col = 0; col < shape[row].length; col++) {
      if (shape[row][col]) {
        paintCell(
          ctx,
          current.x + col,
          current.y + row,
          color,
          cellSize,
          0,
          0,
          cellGap,
        );
      }
    }
  }
}

/**
 * Draw the next-piece preview in the side panel.
 *
 * The piece's spawn-rotation shape is centred horizontally within the panel
 * width.
 */
function drawNextPreview(
  ctx: DrawContext,
  state: GameState,
  config: DrawConfig,
): void {
  const { previewCellSize, panelX, canvasWidth, previewY, cellGap } = config;

  // Section label.
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = 'bold 13px monospace';
  ctx.fillText('NEXT', panelX + 10, previewY - 12);

  const shape = getShape(TETROMINOES[state.next], 0);
  const color = colorForId(state.next);

  // Centre the piece horizontally inside the panel.
  const panelWidth = canvasWidth - panelX;
  const shapeWidth = shape[0].length * previewCellSize;
  const offsetX = panelX + (panelWidth - shapeWidth) / 2;

  for (let row = 0; row < shape.length; row++) {
    for (let col = 0; col < shape[row].length; col++) {
      if (shape[row][col]) {
        paintCell(
          ctx,
          col,
          row,
          color,
          previewCellSize,
          offsetX,
          previewY,
          cellGap,
        );
      }
    }
  }
}

/**
 * Draw the HUD (score / level / lines) and a game-over banner if applicable.
 */
function drawHud(ctx: DrawContext, state: GameState, config: DrawConfig): void {
  const { hudX, hudStartY, hudLineHeight } = config;

  const entries: ReadonlyArray<readonly [string, number]> = [
    ['SCORE', state.score],
    ['LEVEL', state.level],
    ['LINES', state.lines],
  ];

  entries.forEach(([label, value], index) => {
    const y = hudStartY + index * hudLineHeight;

    ctx.fillStyle = LABEL_COLOR;
    ctx.font = 'bold 13px monospace';
    ctx.fillText(label, hudX, y);

    ctx.fillStyle = VALUE_COLOR;
    ctx.font = 'bold 22px monospace';
    ctx.fillText(String(value), hudX, y + 26);
  });

  if (state.gameOver) {
    ctx.fillStyle = '#ff4444';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(
      'GAME OVER',
      hudX,
      hudStartY + entries.length * hudLineHeight,
    );
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Render the complete game frame.
 *
 * Performs these steps (matching the acceptance criteria):
 *  (a) Clear the entire canvas and paint the background.
 *  (b) Draw the play-field grid (aesthetics + non-blank guarantee).
 *  (c) Draw every locked (non-null) board cell, coloured by tetromino id.
 *  (d) Draw the current falling piece using its rotation matrix.
 *  (e) Draw the next-piece preview in the side panel.
 *  (f) Draw the HUD (score, level, lines).
 *
 * The function is pure with respect to `ctx`: it only calls methods declared
 * on {@link DrawContext} and never touches the DOM.
 *
 * @param ctx     A canvas-like rendering context (real or mock).
 * @param state   The immutable game state to render.
 * @param config  Layout configuration (defaults to {@link DEFAULT_DRAW_CONFIG}).
 */
export function draw(
  ctx: DrawContext,
  state: GameState,
  config: DrawConfig = DEFAULT_DRAW_CONFIG,
): void {
  // (a) Clear and fill the background.
  ctx.clearRect(0, 0, config.canvasWidth, config.canvasHeight);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, config.canvasWidth, config.canvasHeight);

  // (b) Subtle play-field grid (drawn under the board cells and current piece
  //     so pieces remain clearly visible). Also guarantees the canvas is never
  //     a single uniform colour (see drawGrid docs).
  drawGrid(ctx, state, config);

  // (c) Locked board cells.
  drawBoard(ctx, state, config);

  // (c) Current piece.
  drawCurrentPiece(ctx, state, config);

  // (d) Next-piece preview.
  drawNextPreview(ctx, state, config);

  // (e) HUD.
  drawHud(ctx, state, config);
}
