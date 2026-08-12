/**
 * Pure canvas renderer for the snake game.
 *
 * This module only reads `GameState` and draws it to the canvas. It performs
 * no game logic and never mutates state. The grid is centered within the
 * canvas and scaled from `RendererConfig`, so it stays responsive to whatever
 * backing-store dimensions `ctx.canvas` reports.
 */

import type { GameState, Point } from '../game/types'

/** Rendering configuration derived from the game's grid constants. */
export interface RendererConfig {
  /** Pixel size of a single grid cell. */
  cellSize: number
  /** Number of grid columns. */
  cols: number
  /** Number of grid rows. */
  rows: number
}

/** The renderer surface returned by `createRenderer`. */
export interface Renderer {
  /** Draw the given game state onto the canvas. */
  render(state: GameState): void
}

/** Clean, readable palette kept as module-level constants. */
const COLORS = {
  background: '#0e1b2a',
  gridLine: 'rgba(255, 255, 255, 0.08)',
  snakeBody: '#2ecc71',
  snakeHead: '#9dffc3',
  food: '#ff5a5a',
  foodGlow: 'rgba(255, 90, 90, 0.25)',
} as const

/**
 * Create a renderer bound to a 2D canvas context and a grid config.
 * The returned `render` is a pure draw given a state; it is independent of
 * requestAnimationFrame and reads canvas dimensions responsively.
 */
export function createRenderer(
  ctx: CanvasRenderingContext2D,
  config: RendererConfig,
): Renderer {
  return {
    render(state: GameState): void {
      const { cellSize, cols, rows } = config
      const { width, height } = ctx.canvas

      // Clear the full canvas, then paint the background layer.
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = COLORS.background
      ctx.fillRect(0, 0, width, height)

      // Center the grid within the canvas so it adapts to any canvas size.
      const gridWidth = cols * cellSize
      const gridHeight = rows * cellSize
      const offsetX = Math.max(0, Math.floor((width - gridWidth) / 2))
      const offsetY = Math.max(0, Math.floor((height - gridHeight) / 2))

      drawGrid(ctx, offsetX, offsetY, gridWidth, gridHeight, cols, rows, cellSize)
      drawFood(ctx, state.food, offsetX, offsetY, cellSize)
      drawSnake(ctx, state.snake.body, offsetX, offsetY, cellSize)
    },
  }
}

/** Paint the faint background grid lines. */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  gridWidth: number,
  gridHeight: number,
  cols: number,
  rows: number,
  cellSize: number,
): void {
  ctx.strokeStyle = COLORS.gridLine
  ctx.lineWidth = 1
  ctx.beginPath()

  for (let col = 0; col <= cols; col++) {
    const x = offsetX + col * cellSize
    ctx.moveTo(x, offsetY)
    ctx.lineTo(x, offsetY + gridHeight)
  }
  for (let row = 0; row <= rows; row++) {
    const y = offsetY + row * cellSize
    ctx.moveTo(offsetX, y)
    ctx.lineTo(offsetX + gridWidth, y)
  }

  ctx.stroke()
}

/** Draw the food cell with a soft glow so it contrasts with the grid. */
function drawFood(
  ctx: CanvasRenderingContext2D,
  food: Point,
  offsetX: number,
  offsetY: number,
  cellSize: number,
): void {
  const x = offsetX + food.x * cellSize
  const y = offsetY + food.y * cellSize
  const inset = Math.max(1, Math.floor(cellSize * 0.18))
  const size = cellSize - inset * 2

  ctx.fillStyle = COLORS.foodGlow
  ctx.beginPath()
  ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize / 2, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = COLORS.food
  ctx.beginPath()
  ctx.arc(x + cellSize / 2, y + cellSize / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Draw the snake body from tail to head. Body segments use the base color
 * while the head (index 0) is drawn on top in a brighter color so it reads
 * as visually distinct.
 */
function drawSnake(
  ctx: CanvasRenderingContext2D,
  body: Point[],
  offsetX: number,
  offsetY: number,
  cellSize: number,
): void {
  for (let i = body.length - 1; i >= 1; i--) {
    const segment = body[i]
    ctx.fillStyle = COLORS.snakeBody
    ctx.fillRect(
      offsetX + segment.x * cellSize,
      offsetY + segment.y * cellSize,
      cellSize,
      cellSize,
    )
  }

  const head = body[0]
  if (head) {
    ctx.fillStyle = COLORS.snakeHead
    ctx.fillRect(
      offsetX + head.x * cellSize,
      offsetY + head.y * cellSize,
      cellSize,
      cellSize,
    )
  }
}
