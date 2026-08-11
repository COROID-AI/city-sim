import { ghostPiece } from './board';
import {
  BOARD_COLS,
  BOARD_ROWS,
  COLORS,
  FIRST_VISIBLE_ROW,
  LINE_CLEAR_FLASH_MS,
  NEXT_PIECES_VISIBLE,
  VISIBLE_ROWS,
} from './constants';
import type { EngineState } from './engine';
import { getShape } from './tetrominoes';
import type { ShapeMatrix } from './tetrominoes';
import type { TetrominoType } from './types';

export interface RendererOptions {
  reducedMotion: boolean;
}

export interface Renderer {
  render(state: EngineState): void;
}

const BOARD_CELL = 28;
const HOLD_SIZE = 112;
const HOLD_CELL = 24;
const PREVIEW_WIDTH = 112;
const PREVIEW_CELL = 20;
const PREVIEW_SLOT_H = 80;
const PREVIEW_HEIGHT = PREVIEW_SLOT_H * NEXT_PIECES_VISIBLE;

const FIELD_BG = '#0d1118';
const GRID_LINE = 'rgba(255,255,255,0.05)';


type DrawMode = 'solid' | 'ghost';

export function createRenderer(
  boardCanvas: HTMLCanvasElement,
  holdCanvas: HTMLCanvasElement,
  nextCanvas: HTMLCanvasElement,
  opts: RendererOptions,
): Renderer {
  const boardCtx = setupCanvas(boardCanvas, BOARD_COLS * BOARD_CELL, VISIBLE_ROWS * BOARD_CELL);
  const holdCtx = setupCanvas(holdCanvas, HOLD_SIZE, HOLD_SIZE);
  const nextCtx = setupCanvas(nextCanvas, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  return {
    render(state: EngineState): void {
      if (boardCtx) renderBoard(boardCtx, state, opts);
      if (holdCtx) renderHold(holdCtx, state);
      if (nextCtx) renderNext(nextCtx, state);
    },
  };
}

/** Set device-pixel-ratio-aware sizing and return the 2D context. */
function setupCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  return ctx;
}

/**
 * A single colored block with a beveled look: light top/left edges, dark
 * bottom/right edges, a subtle top sheen and a 1px outline. The 2px inset
 * around each cell lets the grid lines read as block gaps.
 */
function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  type: TetrominoType,
  alpha = 1,
): void {
  const { base, light, dark } = COLORS[type];
  const e = Math.max(1, Math.round(size * 0.1));
  const inset = Math.max(1, Math.round(size * 0.07));
  const w = size - inset * 2;

  ctx.globalAlpha = alpha;
  ctx.fillStyle = base;
  ctx.fillRect(x + inset, y + inset, w, w);

  // Light edges: top + left
  ctx.fillStyle = light;
  ctx.fillRect(x + inset, y + inset, w, e);
  ctx.fillRect(x + inset, y + inset, e, w);

  // Dark edges: bottom + right
  ctx.fillStyle = dark;
  ctx.fillRect(x + inset, y + size - inset - e, w, e);
  ctx.fillRect(x + size - inset - e, y + inset, e, w);

  // Top sheen
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x + inset + e, y + inset, w - e * 2, Math.max(1, e - 1));

  // Crisp outline separating adjacent blocks
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, w - 1, w - 1);

  ctx.globalAlpha = 1;
}

/** Dashed placeholder outline for the landing-ghost piece. */
function drawGhostBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  type: TetrominoType,
): void {
  const { base, dark } = COLORS[type];
  const inset = Math.max(1, Math.round(size * 0.07));
  const w = size - inset * 2;
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = base;
  ctx.fillRect(x + inset, y + inset, w, w);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, w - 1, w - 1);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawPieceMatrix(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  matrix: ShapeMatrix,
  type: TetrominoType,
  mode: DrawMode,
): void {
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (!matrix[r][c]) continue;
      if (mode === 'ghost') drawGhostBlock(ctx, x + c * cell, y + r * cell, cell, type);
      else drawBlock(ctx, x + c * cell, y + r * cell, cell, type);
    }
  }
}

function boundingBox(
  matrix: ShapeMatrix,
): { minRow: number; minCol: number; rows: number; cols: number } {
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = -Infinity;
  let maxCol = -Infinity;
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c]) {
        minRow = Math.min(minRow, r);
        minCol = Math.min(minCol, c);
        maxRow = Math.max(maxRow, r);
        maxCol = Math.max(maxCol, c);
      }
    }
  }
  return {
    minRow: minRow === Infinity ? 0 : minRow,
    minCol: minCol === Infinity ? 0 : minCol,
    rows: maxRow - minRow + 1,
    cols: maxCol - minCol + 1,
  };
}

function drawCentered(
  ctx: CanvasRenderingContext2D,
  matrix: ShapeMatrix,
  type: TetrominoType,
  cell: number,
  areaWidth: number,
  areaHeight: number,
  alpha: number,
  yTop = 0,
): void {
  const { minRow, minCol, rows, cols } = boundingBox(matrix);
  const x = Math.round((areaWidth - cols * cell) / 2);
  const y = yTop + Math.round((areaHeight - rows * cell) / 2);
  for (let r = minRow; r < minRow + rows; r++) {
    for (let c = minCol; c < minCol + cols; c++) {
      if (!matrix[r][c]) continue;
      drawBlock(ctx, x + (c - minCol) * cell, y + (r - minRow) * cell, cell, type, alpha);
    }
  }
}

function renderBoard(
  ctx: CanvasRenderingContext2D,
  state: EngineState,
  opts: RendererOptions,
): void {
  const { board, active } = state;
  const cell = BOARD_CELL;
  const w = BOARD_COLS * cell;
  const h = VISIBLE_ROWS * cell;

  // Field background
  ctx.fillStyle = FIELD_BG;
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth = 1;
  for (let c = 1; c < BOARD_COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cell, 0);
    ctx.lineTo(c * cell, h);
    ctx.stroke();
  }
  for (let r = 1; r < VISIBLE_ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * cell);
    ctx.lineTo(w, r * cell);
    ctx.stroke();
  }

  // Locked cells (only visible rows render; hidden rows sit above the canvas)
  for (let r = FIRST_VISIBLE_ROW; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const t = board[r][c];
      if (t) drawBlock(ctx, c * cell, (r - FIRST_VISIBLE_ROW) * cell, cell, t);
    }
  }

  if (active) {
    const top = (active.y - FIRST_VISIBLE_ROW) * cell;
    // Ghost piece: exact landing position, dimmed + dashed
    if (state.status === 'playing' || state.status === 'paused') {
      const ghost = ghostPiece(board, active);
      if (ghost.y !== active.y) {
        drawPieceMatrix(
          ctx,
          ghost.x * cell,
          (ghost.y - FIRST_VISIBLE_ROW) * cell,
          cell,
          getShape(ghost.type, ghost.rotation),
          ghost.type,
          'ghost',
        );
      }
    }
    drawPieceMatrix(ctx, active.x * cell, top, cell, getShape(active.type, active.rotation), active.type, 'solid');
  }

  // Line-clear flash decay (skipped under reduced motion)
  if (state.lastClear && !opts.reducedMotion) {
    const elapsed = performance.now() - state.lastClear.at;
    if (elapsed < LINE_CLEAR_FLASH_MS) {
      const alpha = 0.6 * (1 - elapsed / LINE_CLEAR_FLASH_MS);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      for (const row of state.lastClear.rows) {
        ctx.fillRect(0, (row - FIRST_VISIBLE_ROW) * cell, w, cell);
      }
      ctx.globalAlpha = 1;
    }
  }
}

function renderHold(ctx: CanvasRenderingContext2D, state: EngineState): void {
  ctx.fillStyle = FIELD_BG;
  ctx.fillRect(0, 0, HOLD_SIZE, HOLD_SIZE);
  if (state.hold) {
    const matrix = getShape(state.hold, 0);
    drawCentered(ctx, matrix, state.hold, HOLD_CELL, HOLD_SIZE, HOLD_SIZE, state.holdUsed ? 0.35 : 1);
  } else {
    // Empty-slot dash
    ctx.fillStyle = '#3a4356';
    ctx.fillRect(HOLD_SIZE / 2 - 12, HOLD_SIZE / 2 - 2, 24, 4);
  }
}

function renderNext(ctx: CanvasRenderingContext2D, state: EngineState): void {
  ctx.fillStyle = FIELD_BG;
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  state.queue.slice(0, NEXT_PIECES_VISIBLE).forEach((type, i) => {
    const matrix = getShape(type, 0);
    drawCentered(ctx, matrix, type, PREVIEW_CELL, PREVIEW_WIDTH, PREVIEW_SLOT_H, 1, i * PREVIEW_SLOT_H);
  });
}

