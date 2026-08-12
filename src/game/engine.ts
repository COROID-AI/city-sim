/**
 * Pure, framework-agnostic snake game engine.
 *
 * This module contains no DOM/canvas imports: it only manipulates
 * `GameState` snapshots and returns new ones. The renderer and game loop
 * drive it by calling `step()` with the current state.
 */

import type { Direction, GameState, Point, SnakeState } from './types'
import {
  BASE_TICK_INTERVAL,
  COLS,
  MIN_TICK_INTERVAL,
  ROWS,
} from './types'

/** Per-cell movement deltas for each direction. */
const DIRECTION_DELTAS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/** The direction that would reverse a given direction. */
const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

/**
 * Speed model: the tick interval shrinks as the score rises so the snake
 * moves faster, clamped to a sensible minimum.
 */
export function tickIntervalForScore(score: number): number {
  const interval = BASE_TICK_INTERVAL - score * 8
  return Math.max(MIN_TICK_INTERVAL, interval)
}

/**
 * Create a fresh game in the `ready` status with a centered snake of length
 * 3, a random food cell, and the base tick interval. `highScore` is carried
 * over so a reset preserves the record.
 */
export function createInitialState(highScore = 0): GameState {
  const startX = Math.floor(COLS / 2)
  const startY = Math.floor(ROWS / 2)

  const snake: SnakeState = {
    body: [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ],
    direction: 'right',
    nextDirection: [],
  }

  const state: GameState = {
    snake,
    food: { x: 0, y: 0 },
    score: 0,
    highScore,
    status: 'ready',
    tickInterval: BASE_TICK_INTERVAL,
  }

  return { ...state, food: spawnFood(state) }
}

/**
 * Pick a random free cell to place the food on. Never returns a cell the
 * snake currently occupies. If the board is completely full (win), the
 * existing food position is returned unchanged.
 */
export function spawnFood(state: GameState): Point {
  const occupied = new Set(state.snake.body.map((p) => `${p.x},${p.y}`))
  const freeCells: Point[] = []

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!occupied.has(`${x},${y}`)) {
        freeCells.push({ x, y })
      }
    }
  }

  if (freeCells.length === 0) {
    return state.food
  }

  const index = Math.floor(Math.random() * freeCells.length)
  return freeCells[index]
}

/**
 * Advance the snake one cell in its current direction.
 *
 * - Buffered turns from `nextDirection` are applied (first valid, non-reverse
 *   turn wins).
 * - Moving out of the grid (wall) or into the snake's own body sets the
 *   status to `gameover`.
 * - Eating the food grows the snake, increments the score, spawns new food
 *   on a free cell, and speeds up the tick interval.
 */
export function step(state: GameState): GameState {
  if (state.status === 'gameover') {
    return state
  }

  const status: GameState['status'] =
    state.status === 'ready' ? 'running' : state.status

  const { direction, nextDirection } = consumeNextDirection(state.snake)
  const head = state.snake.body[0]
  const delta = DIRECTION_DELTAS[direction]
  const newHead: Point = { x: head.x + delta.x, y: head.y + delta.y }

  // Wall collision: the head left the grid.
  if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS) {
    return {
      ...state,
      status: 'gameover',
      snake: { ...state.snake, direction, nextDirection },
    }
  }

  const body = state.snake.body
  const willEat = newHead.x === state.food.x && newHead.y === state.food.y

  // Self collision: when not eating, the tail vacates its cell this tick, so
  // it is excluded from the check; when eating, the tail stays and counts.
  const collisionBody = willEat ? body : body.slice(0, -1)
  if (
    collisionBody.some((segment) => segment.x === newHead.x && segment.y === newHead.y)
  ) {
    return {
      ...state,
      status: 'gameover',
      snake: { ...state.snake, direction, nextDirection },
    }
  }

  const newBody = willEat
    ? [newHead, ...body]
    : [newHead, ...body.slice(0, -1)]

  const moved: GameState = {
    ...state,
    status,
    snake: { ...state.snake, body: newBody, direction, nextDirection },
  }

  return willEat ? eat(moved) : moved
}

/**
 * Consume the food currently on the board: grow the snake (already done by
 * the caller before invoking this), increment the score, update the high
 * score, respawn food on a free cell, and speed up.
 */
function eat(state: GameState): GameState {
  const score = state.score + 1
  const highScore = Math.max(state.highScore, score)
  const withScore: GameState = {
    ...state,
    score,
    highScore,
    tickInterval: tickIntervalForScore(score),
  }
  return { ...withScore, food: spawnFood(withScore) }
}

/**
 * Reset the game to a fresh initial state, preserving the high score.
 */
export function resetGame(state: GameState): GameState {
  return createInitialState(state.highScore)
}

/**
 * Pop the first valid buffered turn from the snake's direction queue. A turn
 * is valid when it is not the current direction and not a full reversal of
 * it. Returns the applied direction and the remaining queue.
 */
function consumeNextDirection(snake: SnakeState): {
  direction: Direction
  nextDirection: Direction[]
} {
  for (let i = 0; i < snake.nextDirection.length; i++) {
    const dir = snake.nextDirection[i]
    if (dir !== snake.direction && dir !== OPPOSITE[snake.direction]) {
      return { direction: dir, nextDirection: snake.nextDirection.slice(i + 1) }
    }
  }
  return { direction: snake.direction, nextDirection: [] }
}