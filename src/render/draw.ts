/**
 * Canvas renderer for the Tetris playfield.
 *
 * Pure drawing helpers: they never mutate game state and have no knowledge of
 * the game loop or input. Every function is given the 2D context it needs so
 * the module stays trivial to unit-test with jsdom's canvas stub.
 */

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  type Board,
  type Cell,
} from "../game/board.js";
import type { ActivePiece } from "../game/rules.js";
import { TETROMINOES, type TetrominoType } from "../game/tetrominoes.js";

/** Pixel size of a single board cell. */
export const CELL_SIZE = 30;

/** Width/height of the playfield canvas in pixels. */
export const BOARD_PIXEL_WIDTH = BOARD_WIDTH * CELL_SIZE;
export const BOARD_PIXEL_HEIGHT = BOARD_HEIGHT * CELL_SIZE;

/** Background, grid, and overlay colours. */
const COLORS = {
  background: "#0f0f1e",
  gridLine: "#2a2a44",
  overlay: "rgba(0, 0, 0, 0.75)",
  overlayText: "#e0e0e0",
} as const;

/** Clears the canvas with the board background colour. */
export function clearBoard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);
}

/** Draws the faint grid lines that delimit every cell on the playfield. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  cols: number = BOARD_WIDTH,
  rows: number = BOARD_HEIGHT
): void {
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= cols; c++) {
    const x = c * CELL_SIZE + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, rows * CELL_SIZE);
  }
  for (let r = 0; r <= rows; r++) {
    const y = r * CELL_SIZE + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(cols * CELL_SIZE, y);
  }
  ctx.stroke();
}

/** Draws a single filled cell of the given tetromino type at (col, row). */
function drawCell(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  type: TetrominoType
): void {
  const x = col * CELL_SIZE;
  const y = row * CELL_SIZE;

  ctx.fillStyle = TETROMINOES[type].color;
  ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);

  // Subtle inner highlight to give blocks a little depth.
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, 4);
}

/** Draws every locked cell currently on the board. */
export function drawBoard(ctx: CanvasRenderingContext2D, board: Board): void {
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const cell: Cell = board[r][c];
      if (cell !== null) {
        drawCell(ctx, c, r, cell);
      }
    }
  }
}

/** Draws an active (falling) tetromino on the playfield. */
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: ActivePiece | null
): void {
  if (piece === null) {
    return;
  }
  const matrix = TETROMINOES[piece.type].rotations[piece.rotation];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] !== 0) {
        drawCell(ctx, piece.col + c, piece.row + r, piece.type);
      }
    }
  }
}

/**
 * Draws a preview of the next upcoming piece into a dedicated preview canvas.
 * The piece is centred within the provided canvas bounds.
 */
export function drawNextPiece(
  ctx: CanvasRenderingContext2D,
  type: TetrominoType | null,
  canvasWidth: number,
  canvasHeight: number
): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  if (type === null) {
    return;
  }

  const matrix = TETROMINOES[type].rotations[0];
  // Trim empty border rows/cols so the piece is visually centred.
  let minR = matrix.length;
  let maxR = -1;
  let minC = matrix[0].length;
  let maxC = -1;
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] !== 0) {
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
    }
  }
  const pieceW = (maxC - minC + 1) * CELL_SIZE;
  const pieceH = (maxR - minR + 1) * CELL_SIZE;
  const offsetX = (canvasWidth - pieceW) / 2;
  const offsetY = (canvasHeight - pieceH) / 2;

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (matrix[r][c] !== 0) {
        const x = offsetX + (c - minC) * CELL_SIZE;
        const y = offsetY + (r - minR) * CELL_SIZE;
        ctx.fillStyle = TETROMINOES[type].color;
        ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
        ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, 4);
      }
    }
  }
}

/** Draws a semi-transparent "Game Over" overlay across the canvas. */
export function drawGameOver(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  ctx.fillStyle = COLORS.overlay;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = COLORS.overlayText;
  ctx.font = "bold 28px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("GAME OVER", width / 2, height / 2 - 16);

  ctx.font = "16px monospace";
  ctx.fillText("Refresh to play again", width / 2, height / 2 + 20);
}
