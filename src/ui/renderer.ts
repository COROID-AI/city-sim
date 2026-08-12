import type { GameState, Point } from '../game';

/**
 * Renders a snake GameState onto a <canvas> using the Canvas 2D API.
 *
 * This is a pure view layer: it only reads state, never mutates it, and
 * contains no game logic. Redraws are driven by the host (a setInterval game
 * loop in main.ts); requestAnimationFrame is never used to advance the tick.
 */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cellSize: number,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to acquire 2D rendering context');
    }
    this.ctx = ctx;
  }

  /** Clears the canvas and redraws the full board from the given state. */
  draw(state: GameState): void {
    const { ctx, canvas, cellSize } = this;

    const boardWidth = state.cols * cellSize;
    const boardHeight = state.rows * cellSize;
    // Center the board within the canvas backing store.
    const offsetX = Math.max(0, Math.floor((canvas.width - boardWidth) / 2));
    const offsetY = Math.max(0, Math.floor((canvas.height - boardHeight) / 2));

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Board background.
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(offsetX, offsetY, boardWidth, boardHeight);

    // Subtle grid lines.
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= state.cols; x += 1) {
      const px = offsetX + x * cellSize;
      ctx.moveTo(px, offsetY);
      ctx.lineTo(px, offsetY + boardHeight);
    }
    for (let y = 0; y <= state.rows; y += 1) {
      const py = offsetY + y * cellSize;
      ctx.moveTo(offsetX, py);
      ctx.lineTo(offsetX + boardWidth, py);
    }
    ctx.stroke();

    // Food.
    this.fillCell(state.food, '#f43f5e', offsetX, offsetY);

    // Snake body (all cells except the head).
    for (let i = 1; i < state.snake.length; i += 1) {
      this.fillCell(state.snake[i], '#22c55e', offsetX, offsetY);
    }

    // Snake head — a visually distinct darker green.
    const head = state.snake[0];
    if (head) {
      this.fillCell(head, '#15803d', offsetX, offsetY);
    }

    // Status overlays.
    if (state.status === 'paused') {
      this.drawOverlay('Paused');
    } else if (state.status === 'gameover') {
      this.drawOverlay('Game Over \u2014 press Space to restart');
    }
  }

  private fillCell(
    point: Point,
    color: string,
    offsetX: number,
    offsetY: number,
  ): void {
    const { ctx, cellSize } = this;
    const pad = Math.max(1, Math.floor(cellSize * 0.08));
    ctx.fillStyle = color;
    ctx.fillRect(
      offsetX + point.x * cellSize + pad,
      offsetY + point.y * cellSize + pad,
      cellSize - pad * 2,
      cellSize - pad * 2,
    );
  }

  /** Draws a dimmed scrim with centered text across the whole canvas. */
  private drawOverlay(text: string): void {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    ctx.restore();
  }
}
