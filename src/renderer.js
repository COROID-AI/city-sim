/**
 * Canvas 2D rendering module.
 *
 * High-DPI aware (devicePixelRatio scaling). Redraws only when the game state
 * changes (driven by the onChange callback registered by main.js).
 * Separated from input so it remains testable.
 */

import { COLS, ROWS, BLOCK_SIZE_PX } from './config.js';
import { getCells } from './tetrominoes.js';

// Subtle grid line color
const GRID_COLOR = 'rgba(148, 163, 184, 0.12)';
const GHOST_ALPHA = 0.22;

/**
 * Sets up a canvas for high-DPI rendering: sizes the backing store to
 * the logical CSS dimensions scaled by devicePixelRatio.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} widthCss - Logical width in CSS pixels
 * @param {number} heightCss - Logical height in CSS pixels
 * @returns {CanvasRenderingContext2D} The 2D context, scaled for DPR
 */
export function setupCanvas(canvas, widthCss, heightCss) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(widthCss * dpr);
  canvas.height = Math.round(heightCss * dpr);
  canvas.style.width = `${widthCss}px`;
  canvas.style.height = `${heightCss}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Draws the faint grid lines on the board. */
export function drawGrid(ctx) {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  const width = COLS * BLOCK_SIZE_PX;
  const height = ROWS * BLOCK_SIZE_PX;

  ctx.beginPath();
  for (let c = 0; c <= COLS; c++) {
    const x = c * BLOCK_SIZE_PX + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = r * BLOCK_SIZE_PX + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

/**
 * Draws a single block at the given grid position.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} col
 * @param {number} row
 * @param {string} color
 * @param {number} [alpha]
 */
export function drawBlock(ctx, col, row, color, alpha = 1) {
  if (row < 0) return; // do not draw above the visible board
  const x = col * BLOCK_SIZE_PX;
  const y = row * BLOCK_SIZE_PX;
  const size = BLOCK_SIZE_PX;

  ctx.globalAlpha = alpha;
  // Fill
  ctx.fillStyle = color;
  ctx.fillRect(x, y, size, size);
  // Inner highlight (top + left bevel)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fillRect(x, y, size, 3);
  ctx.fillRect(x, y, 3, size);
  // Inner shadow (bottom + right bevel)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(x, y + size - 3, size, 3);
  ctx.fillRect(x + size - 3, y, 3, size);
  ctx.globalAlpha = 1;
}

/** Draws all locked cells on the board. */
export function drawBoard(ctx, board) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) {
        drawBlock(ctx, c, r, board[r][c]);
      }
    }
  }
}

/**
 * Draws a tetromino piece at its current position.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ type: string, rotation: number, x: number, y: number, color: string }} piece
 * @param {number} [alpha]
 */
export function drawPiece(ctx, piece, alpha = 1) {
  if (!piece) return;
  const cells = getCells(piece.type, piece.rotation);
  for (let i = 0; i < cells.length; i++) {
    const [c, r] = cells[i];
    drawBlock(ctx, piece.x + c, piece.y + r, piece.color, alpha);
  }
}

/**
 * Draws the ghost (shadow) piece showing where the active piece will land.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ type: string, rotation: number, x: number, color: string }} ghost
 */
export function drawGhost(ctx, ghost) {
  if (!ghost) return;
  const cells = getCells(ghost.type, ghost.rotation);
  for (let i = 0; i < cells.length; i++) {
    const [c, r] = cells[i];
    drawBlock(ctx, ghost.x + c, ghost.y + r, ghost.color, GHOST_ALPHA);
  }
}

/**
 * Clears the canvas and renders a full frame: grid, locked cells, ghost,
 * and the active piece.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} params
 * @param {(null|string)[][]} params.board
 * @param {object|null} params.piece - Active piece
 * @param {number} params.ghostY - Row where the ghost piece sits
 */
export function render(ctx, { board, piece, ghostY }) {
  const width = COLS * BLOCK_SIZE_PX;
  const height = ROWS * BLOCK_SIZE_PX;

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx);
  drawBoard(ctx, board);

  // Ghost piece
  if (piece) {
    drawGhost(ctx, { ...piece, y: ghostY });
    drawPiece(ctx, piece);
  }
}

/**
 * Draws a preview piece on a small next-piece canvas (centered).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ type: string, color: string }|null} piece
 * @param {number} cssWidth
 * @param {number} cssHeight
 */
export function renderPreview(ctx, piece, cssWidth, cssHeight) {
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  if (!piece) return;
  const cells = getCells(piece.type, 0);
  // Compute bounding box of the piece
  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (let i = 0; i < cells.length; i++) {
    const [c, r] = cells[i];
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }
  const pieceW = (maxC - minC + 1) * BLOCK_SIZE_PX;
  const pieceH = (maxR - minR + 1) * BLOCK_SIZE_PX;
  const scale = Math.min(1, cssWidth / (pieceW + 10), cssHeight / (pieceH + 10));
  const offsetX = (cssWidth - pieceW * scale) / 2 - minC * BLOCK_SIZE_PX * scale;
  const offsetY = (cssHeight - pieceH * scale) / 2 - minR * BLOCK_SIZE_PX * scale;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  for (let i = 0; i < cells.length; i++) {
    const [c, r] = cells[i];
    drawBlock(ctx, c, r, piece.color);
  }
  ctx.restore();
}
