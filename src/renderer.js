// Canvas renderer: board, ghost, active piece and next/hold previews.
// Only touches <canvas> element APIs; never mutates game state.

import { COLS, ROWS, PIECE_COLORS } from './constants.js';

export function createRenderer({ boardCanvas, holdCanvas, nextCanvas }) {
  const boardCtx = boardCanvas.getContext('2d');
  const holdCtx = holdCanvas.getContext('2d');
  const nextCtx = nextCanvas.getContext('2d');

  // Sizes the canvas backing store to the CSS box * devicePixelRatio and
  // returns the logical (CSS) dimensions.
  function applyDpr(ctx) {
    const canvas = ctx.canvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: cssW, h: cssH };
  }

  function drawCell(ctx, x, y, size, color, alpha = 1) {
    const pad = Math.max(0.5, size * 0.06);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x + pad, y + pad, size - pad * 2, size - pad * 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + pad + 0.5, y + pad + 0.5, size - pad * 2 - 1, size - pad * 2 - 1);
    if (alpha >= 1) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(x + pad + 1.5, y + pad + 1.5, size - pad * 2 - 3, Math.max(1, size * 0.14));
    }
    ctx.globalAlpha = 1;
  }

  function drawBoard(state) {
    const { w, h } = applyDpr(boardCtx);
    const cell = w / COLS;
    ctxBg(boardCtx, w, h);

    // Grid lines.
    boardCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    boardCtx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      boardCtx.beginPath();
      boardCtx.moveTo(Math.round(x * cell) + 0.5, 0);
      boardCtx.lineTo(Math.round(x * cell) + 0.5, h);
      boardCtx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      boardCtx.beginPath();
      boardCtx.moveTo(0, Math.round(y * cell) + 0.5);
      boardCtx.lineTo(w, Math.round(y * cell) + 0.5);
      boardCtx.stroke();
    }

    // Locked cells.
    for (let r = 0; r < state.board.length; r++) {
      for (let c = 0; c < state.board[r].length; c++) {
        const type = state.board[r][c];
        if (type !== 0) drawCell(boardCtx, c * cell, r * cell, cell, PIECE_COLORS[type]);
      }
    }

    // Ghost then active piece.
    if (state.active) {
      for (const [gx, gy] of state.active.ghost) {
        drawCell(boardCtx, gx * cell, gy * cell, cell, PIECE_COLORS[state.active.type], 0.16);
      }
      for (const [px, py] of state.active.cells) {
        drawCell(boardCtx, px * cell, py * cell, cell, PIECE_COLORS[state.active.type]);
      }
    }
  }

  function ctxBg(ctx, w, h) {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, w, h);
  }

  // Centered mini piece, spawn orientation, fitted into the canvas.
  function drawMini(ctx, type, clearBg = true) {
    const { w, h } = applyDpr(ctx);
    if (clearBg) ctxBg(ctx, w, h);
    if (!type) return;
    const cells = getPreviewCells(type);
    const minX = Math.min(...cells.map(([x]) => x));
    const maxX = Math.max(...cells.map(([x]) => x));
    const minY = Math.min(...cells.map(([, y]) => y));
    const maxY = Math.max(...cells.map(([, y]) => y));
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    const cell = Math.min((w - 10) / cw, (h - 10) / ch);
    const ox = (w - cw * cell) / 2;
    const oy = (h - ch * cell) / 2;
    for (const [x, y] of cells) {
      drawCell(ctx, ox + (x - minX) * cell, oy + (y - minY) * cell, cell, PIECE_COLORS[type]);
    }
  }

  function drawNext(state) {
    const { w, h } = applyDpr(nextCtx);
    ctxBg(nextCtx, w, h);
    const count = (state.next || []).length;
    if (count === 0) return;
    const cell = h / count;
    for (let i = 0; i < count; i++) {
      const type = state.next[i];
      const cells = getPreviewCells(type);
      const minX = Math.min(...cells.map(([x]) => x));
      const maxX = Math.max(...cells.map(([x]) => x));
      const minY = Math.min(...cells.map(([, y]) => y));
      const maxY = Math.max(...cells.map(([, y]) => y));
      const cw = maxX - minX + 1;
      const ch = maxY - minY + 1;
      const s = Math.min((w - 8) / cw, (cell - 10) / ch);
      const ox = (w - cw * s) / 2;
      const oy = i * cell + (cell - ch * s) / 2;
      for (const [x, y] of cells) {
        drawCell(nextCtx, ox + (x - minX) * s, oy + (y - minY) * s, s, PIECE_COLORS[type]);
      }
    }
  }

  return {
    draw(state) {
      drawBoard(state);
      drawMini(holdCtx, state.hold, true);
      drawNext(state);
    },
  };
}

// Preview cells in spawn orientation (state 0).
function getPreviewCells(type) {
  const preview = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]],
    O: [[0, 0], [1, 0], [0, 1], [1, 1]],
    T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
    J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  };
  return preview[type] || [];
}