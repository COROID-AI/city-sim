/**
 * Shared, framework-agnostic types and grid constants for the snake game.
 * This module is pure TypeScript and must not import any DOM/canvas APIs.
 */

/** A compass direction the snake can move in. */
export type Direction = 'up' | 'down' | 'left' | 'right'

/** A cell position on the grid (column, row). */
export interface Point {
  x: number
  y: number
}

/** Lifecycle status of the game. */
export type GameStatus = 'ready' | 'running' | 'gameover'

/**
 * Snake runtime state.
 * `body` is ordered from head (index 0) to tail. `direction` is the current
 * heading; `nextDirection` is a FIFO queue of buffered turns to apply on
 * subsequent ticks (used to avoid double-turns within a single tick).
 */
export interface SnakeState {
  body: Point[]
  direction: Direction
  nextDirection: Direction[]
}

/** Full immutable snapshot of the game at a given tick. */
export interface GameState {
  snake: SnakeState
  food: Point
  score: number
  highScore: number
  status: GameStatus
  tickInterval: number
}

/** Number of grid columns. */
export const COLS = 20
/** Number of grid rows. */
export const ROWS = 20
/** Pixel size of a single grid cell when rendered. */
export const CELL_SIZE = 24
/** Base tick interval in milliseconds at score 0. */
export const BASE_TICK_INTERVAL = 200
/** Minimum tick interval (fastest speed) in milliseconds. */
export const MIN_TICK_INTERVAL = 80