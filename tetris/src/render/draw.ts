/**
 * Canvas rendering layer for the Tetris board, active piece, ghost piece, and
 * next-piece preview.
 *
 * Uses pure fillRect / clearRect calls — no images, no assets, deterministic.
 * Handles device-pixel-ratio (DPR) scaling for crisp rendering.
 */

import { getCells, tryMove } from "../game/rules";
import { colorAt, COLORS, SHAPES } from "../game/tetrominoes";
import { COLS, ROWS } from "../game/types";
import type { ActivePiece, GameState } from "../game/types";

export interface RendererCanvases {
  boardCanvas: HTMLCanvasElement;
  nextCanvas: HTMLCanvasElement;
}

export interface RendererOptions extends RendererCanvases {
  /** Pixel size of a single cell. Default 30. */
  cellSize?: number;
}

export interface Renderer {
  /** Draw the full current game state to both canvases. */
  render: (state: GameState) => void;
}

const GHOST_ALPHA = 0.25;
const PREVIEW_CELL = 22;

/**
 * Create a renderer bound to the given board and next-piece canvases. The
 * canvases are sized and DPR-scaled on creation.
 */
export function createRenderer(options: RendererOptions): Renderer {
  const { boardCanvas, nextCanvas } = options;
  const cellSize = options.cellSize ?? 30;

  // --- Board canvas setup (DPR-aware) ---------------------------------------
  const boardW = COLS * cellSize;
  const boardH = ROWS * cellSize;
  setupCanvas(boardCanvas, boardW, boardH);

  // --- Next-piece canvas setup (4×4 grid) -----------------------------------
  const previewW = 4 * PREVIEW_CELL;
  const previewH = 4 * PREVIEW_CELL;
  setupCanvas(nextCanvas, previewW, previewH);

  const boardCtx = boardCanvas.getContext("2d");
  const nextCtx = nextCanvas.getContext("2d");

  return {
    render(state: GameState) {
      drawBoard(boardCtx, state, cellSize);
      drawNext(nextCtx, state.nextId);
    },
  };
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

/** Resize a canvas to `w × h` CSS pixels, scaled by DPR for crispness. */
function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

/** Draw the board, settled cells, active piece, and ghost. */
function drawBoard(
  ctx: CanvasRenderingContext2D | null,
  state: GameState,
  cellSize: number,
): void {
  if (!ctx) return;

  const { board, active } = state;
  const w = COLS * cellSize;
  const h = ROWS * cellSize;

  // Clear.
  ctx.clearRect(0, 0, w, h);

  // Settled cells.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const val = board[r]![c]!;
      if (val !== 0) {
        drawCell(ctx, c, r, cellSize, colorAt(val));
      }
    }
  }

  // Ghost piece at landing position.
  if (active) {
    const ghost = computeGhost(board, active);
    drawPiece(ctx, ghost, cellSize, COLORS[active.id], GHOST_ALPHA, true);
    // Active piece.
    drawPiece(ctx, active, cellSize, COLORS[active.id], 1, false);
  }
}

/** Draw the next-piece preview centred in a 4×4 grid. */
function drawNext(
  ctx: CanvasRenderingContext2D | null,
  id: GameState["nextId"],
): void {
  if (!ctx) return;
  ctx.clearRect(0, 0, 4 * PREVIEW_CELL, 4 * PREVIEW_CELL);
  const rotation = SHAPES[id][0]!;
  // Centre the shape in the 4×4 preview box.
  const minCol = Math.min(...rotation.map(([, c]) => c));
  const maxCol = Math.max(...rotation.map(([, c]) => c));
  const minRow = Math.min(...rotation.map(([r]) => r));
  const maxRow = Math.max(...rotation.map(([r]) => r));
  const shapeW = maxCol - minCol + 1;
  const shapeH = maxRow - minRow + 1;
  const offsetCol = (4 - shapeW) / 2 - minCol;
  const offsetRow = (4 - shapeH) / 2 - minRow;

  for (const [r, c] of rotation) {
    drawCell(
      ctx,
      c + offsetCol,
      r + offsetRow,
      PREVIEW_CELL,
      COLORS[id],
    );
  }
}

/** Draw a single filled cell at grid coords (col, row). */
function drawCell(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  size: number,
  fill: string,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  const x = col * size;
  const y = row * size;
  ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  ctx.restore();
}

/** Draw all cells of a piece. */
function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: ActivePiece,
  cellSize: number,
  fill: string,
  alpha: number,
  outlineOnly: boolean,
): void {
  for (const [r, c] of getCells(piece)) {
    drawCell(ctx, c, r, cellSize, fill, alpha);
    if (outlineOnly) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = fill;
      ctx.lineWidth = 1;
      const x = c * cellSize;
      const y = r * cellSize;
      ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
      ctx.restore();
    }
  }
}

/**
 * Compute the landing position of the active piece (lowest non-colliding row).
 * Returns a copy of the piece translated down as far as possible.
 */
function computeGhost(board: GameState["board"], piece: ActivePiece): ActivePiece {
  let ghost = piece;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const moved = tryMove(board, ghost, 1, 0);
    if (moved === null) break;
    ghost = moved;
  }
  return ghost;
}
