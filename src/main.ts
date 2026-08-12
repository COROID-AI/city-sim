/**
 * Snake game entry point.
 *
 * Wires together the pure engine (game/engine), the canvas renderer
 * (render/renderer), the DOM HUD (hud/hud), and keyboard input
 * (input/input), then runs a requestAnimationFrame loop that paces ticks
 * with an accumulator so the snake moves at the engine's (score-dependent)
 * tick interval rather than a fixed frame rate.
 */

import { createInitialState, resetGame, step } from './game/engine'
import { CELL_SIZE, COLS, ROWS } from './game/types'
import type { Direction, GameState } from './game/types'
import { attachInput } from './input/input'
import { createRenderer } from './render/renderer'
import { createHud, loadHighScore, saveHighScore } from './hud/hud'

function getGameCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')
  if (!canvas) {
    throw new Error('Canvas element #game not found')
  }
  return canvas
}

function getHudElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('#hud')
  if (!element) {
    throw new Error('HUD overlay element #hud not found')
  }
  return element
}

const canvas = getGameCanvas()
const ctx = canvas.getContext('2d')
if (!ctx) {
  throw new Error('2D canvas context unavailable')
}

const renderer = createRenderer(ctx, {
  cellSize: CELL_SIZE,
  cols: COLS,
  rows: ROWS,
})

const hud = createHud(getHudElement())

/**
 * Match the canvas backing store to the current viewport (CSS pixels). The
 * renderer centers the grid from `ctx.canvas.width/height`, so keeping the
 * backing store in CSS pixels keeps the grid correctly centered.
 */
function resize(): void {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}
resize()
window.addEventListener('resize', () => {
  resize()
  renderer.render(state)
})

// --- Game state -----------------------------------------------------------

let state: GameState = createInitialState(loadHighScore())
let persistedHighScore = state.highScore
hud.update(state.score, state.highScore)

// --- Loop bookkeeping ------------------------------------------------------

let rafId = 0
let lastTime = performance.now()
let accumulator = 0

/**
 * Buffer a raw direction press into the snake's turn queue. The engine
 * rejects reversals (and no-ops) when it applies the first valid turn on the
 * next tick, so we do not need to filter here.
 */
function queueDirection(direction: Direction): void {
  if (state.status === 'gameover') {
    return
  }
  state = {
    ...state,
    snake: {
      ...state.snake,
      nextDirection: [...state.snake.nextDirection, direction],
    },
  }
}

/**
 * One animation frame: accumulate elapsed time and advance the game by whole
 * ticks at the current tick interval, then render. The loop stops scheduling
 * itself once the game is over and is resumed by {@link restart}.
 */
function loop(now: number): void {
  const delta = now - lastTime
  lastTime = now

  if (state.status !== 'gameover') {
    accumulator += delta
    while (accumulator >= state.tickInterval) {
      accumulator -= state.tickInterval
      state = step(state)

      // Persist the high score only when it was actually exceeded.
      if (state.highScore > persistedHighScore) {
        persistedHighScore = state.highScore
        saveHighScore(state.highScore)
      }
      hud.update(state.score, state.highScore)

      if (state.status === 'gameover') {
        hud.showGameOver(state.score, state.highScore)
        break
      }
    }
  }

  renderer.render(state)

  if (state.status !== 'gameover') {
    rafId = requestAnimationFrame(loop)
  }
}

/**
 * Reset to a fresh game (high score preserved) and resume the loop. Triggered
 * by the restart key (Space / Enter / R).
 */
function restart(): void {
  state = resetGame(state)
  persistedHighScore = state.highScore
  accumulator = 0
  lastTime = performance.now()
  hud.hideGameOver()
  hud.update(state.score, state.highScore)
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(loop)
}

attachInput(document.body, {
  onDirection: queueDirection,
  onRestart: restart,
})

rafId = requestAnimationFrame(loop)
