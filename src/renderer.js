// ---------------------------------------------------------------------------
// Canvas renderer.
//
// Handles devicePixelRatio-aware sizing so blocks stay crisp on high-DPI
// displays. The canvas backing store is set to the CSS logical size times the
// DPR and the context is pre-scaled, so all drawing can use logical pixels.
// ---------------------------------------------------------------------------
import { COLS, ROWS, COLORS, SHAPES } from './constants.js';

export class BoardRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.blockSize = 24;
    this.offsetX = 0;
    this.offsetY = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Backing store = logical size x DPR for crisp rendering.
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.width = rect.width;
    this.height = rect.height;

    // Integer block size keeps edges crisp; center the board in the canvas.
    this.blockSize = Math.max(6, Math.floor(this.width / COLS));
    this.boardPx = this.blockSize * COLS;
    this.offsetX = Math.floor((this.width - this.boardPx) / 2);
    this.offsetY = Math.floor((this.height - this.blockSize * ROWS) / 2);
  }

  boardToPx(x, y) {
    return [this.offsetX + x * this.blockSize, this.offsetY + y * this.blockSize];
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Board background.
    ctx.fillStyle = 'rgba(10, 14, 24, 0.9)';
    ctx.fillRect(this.offsetX, this.offsetY, this.boardPx, this.blockSize * ROWS);

    // Grid lines.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      const [px] = this.boardToPx(x, 0);
      ctx.beginPath();
      ctx.moveTo(px, this.offsetY);
      ctx.lineTo(px, this.offsetY + this.blockSize * ROWS);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      const [, py] = this.boardToPx(0, y);
      ctx.beginPath();
      ctx.moveTo(this.offsetX, py);
      ctx.lineTo(this.offsetX + this.boardPx, py);
      ctx.stroke();
    }

    // Locked cells.
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const type = this.engine.board[y][x];
        if (type) this.drawBlock(x, y, COLORS[type], 1);
      }
    }

    // Ghost piece (outline of the landing position).
    if (this.engine.current) {
      const cells = SHAPES[this.engine.current.type][this.engine.current.rotation];
      const color = COLORS[this.engine.current.type];
      for (const [cx, cy] of cells) {
        this.drawBlock(this.engine.current.x + cx, this.engine.ghostY + cy, color, 0, true);
      }
    }

    // Active piece.
    if (this.engine.current) {
      const cells = SHAPES[this.engine.current.type][this.engine.current.rotation];
      const color = COLORS[this.engine.current.type];
      for (const [cx, cy] of cells) {
        this.drawBlock(this.engine.current.x + cx, this.engine.current.y + cy, color, 1);
      }
    }
  }

  // Draw a single block with a subtle bevel for depth. When ghost is true,
  // only an outline is drawn so the landing spot reads as a preview.
  drawBlock(x, y, color, alpha, ghost = false) {
    const ctx = this.ctx;
    const [px, py] = this.boardToPx(x, y);
    const s = this.blockSize;
    const inset = ghost ? 0 : 1;

    ctx.globalAlpha = alpha;

    if (ghost) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + inset, py + inset, s - inset * 2, s - inset * 2);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(px + inset, py + inset, s - inset * 2, s - inset * 2);
      ctx.globalAlpha = alpha;
    } else {
      // Base fill.
      ctx.fillStyle = color;
      ctx.fillRect(px, py, s, s);
      // Top highlight.
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(px, py, s, Math.max(1, s * 0.22));
      // Left highlight.
      ctx.fillRect(px, py, Math.max(1, s * 0.18), s);
      // Bottom shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(px, py + s - Math.max(1, s * 0.22), s, Math.max(1, s * 0.22));
      // Right shadow.
      ctx.fillRect(px + s - Math.max(1, s * 0.18), py, Math.max(1, s * 0.18), s);
      // Inner border to separate cells.
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
    }

    ctx.globalAlpha = 1;
  }

  // Render a single piece into a small preview canvas, centered and scaled to
  // fit the given logical box.
  drawPreview(canvas, type) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.width;
    const h = rect.height || canvas.height;
    this.drawPreviewInto(canvas, type, w, h);
  }

  // Draw a single piece centered into a canvas with explicit logical size
  // (used for hold/next preview slots, including off-DOM slot canvases).
  drawPreviewInto(canvas, type, w, h) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!type) return;

    const cells = SHAPES[type][0];
    // Determine the piece's bounding box in its local coordinate space.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [cx, cy] of cells) {
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
    }
    const pw = maxX - minX + 1;
    const ph = maxY - minY + 1;
    const cell = Math.max(4, Math.floor(Math.min(w / pw, h / ph)));
    const bw = cell * pw;
    const bh = cell * ph;
    const ox = Math.floor((w - bw) / 2) - minX * cell;
    const oy = Math.floor((h - bh) / 2) - minY * cell;

    ctx.fillStyle = COLORS[type];
    for (const [cx, cy] of cells) {
      ctx.fillRect(ox + cx * cell, oy + cy * cell, cell, cell);
    }
  }
}
