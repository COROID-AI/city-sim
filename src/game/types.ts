/**
 * Shared types and configuration constants for the snake game core.
 * These types are framework-agnostic (no DOM) so they can be reused by
 * any renderer and unit-tested in isolation.
 */

/** A single cell coordinate on the game grid. */
export interface Point {
  x: number;
  y: number;
}

/** The four cardinal directions the snake can move in. */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** Lifecycle status of the game. */
export type Status = 'idle' | 'running' | 'paused' | 'gameover';

/** Configuration used to build a new game. */
export interface GameConfig {
  cols: number;
  rows: number;
  tickMs: number;
  /** When true, leaving the board wraps to the opposite edge instead of game over. */
  wrapWalls: boolean;
}

/** The full, serializable state of a snake game at a point in time. */
export interface GameState {
  snake: Point[];
  food: Point;
  direction: Direction;
  status: Status;
  score: number;
  cols: number;
  rows: number;
}

/** Default configuration used when no override is provided. */
export const DEFAULT_CONFIG: GameConfig = {
  cols: 20,
  rows: 20,
  tickMs: 120,
  wrapWalls: false,
};
