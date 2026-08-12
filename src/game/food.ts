import type { GameState, Point } from './types';

/**
 * Returns the coordinates of a random free cell (a cell not currently
 * occupied by the snake). Throws if the board is completely full.
 */
export function spawnFood(state: GameState): Point {
  const occupied = new Set(state.snake.map((p) => `${p.x},${p.y}`));
  const free: Point[] = [];

  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      if (!occupied.has(`${x},${y}`)) {
        free.push({ x, y });
      }
    }
  }

  if (free.length === 0) {
    throw new Error('No free cells available to place food');
  }

  return free[Math.floor(Math.random() * free.length)];
}
