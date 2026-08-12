import { spawnFood } from './food';
import type { Direction, GameConfig, GameState, Point, Status } from './types';
import { DEFAULT_CONFIG } from './types';

/** Maps a direction to its (x, y) delta. */
const DIRECTION_DELTA: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** The direction directly opposite to the given one. */
const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function containsPoint(points: Point[], target: Point): boolean {
  return points.some((p) => samePoint(p, target));
}

function isOutOfBounds(state: GameState, point: Point): boolean {
  return point.x < 0 || point.x >= state.cols || point.y < 0 || point.y >= state.rows;
}

/**
 * Builds a new GameState with a centered 3-cell snake and a food cell on a
 * free cell. Accepts a partial config; unspecified fields use DEFAULT_CONFIG.
 */
export function createInitialState(config: Partial<GameConfig> = {}): GameState {
  const cfg: GameConfig = { ...DEFAULT_CONFIG, ...config };

  const headX = Math.floor(cfg.cols / 2);
  const headY = Math.floor(cfg.rows / 2);

  // Head in the center, body extending leftward, moving right initially.
  const snake: Point[] = [
    { x: headX, y: headY },
    { x: headX - 1, y: headY },
    { x: headX - 2, y: headY },
  ];

  const state: GameState = {
    snake,
    food: { x: 0, y: 0 },
    direction: 'right',
    status: 'idle',
    score: 0,
    cols: cfg.cols,
    rows: cfg.rows,
  };

  state.food = spawnFood(state);
  return state;
}

/**
 * Advances the game by one tick: moves the head one cell in the current
 * direction, handles eating/growth/food respawn, and detects collisions.
 * Returns a new GameState; the input state is never mutated.
 */
export function tick(state: GameState): GameState {
  if (state.status === 'gameover') {
    return state;
  }

  const delta = DIRECTION_DELTA[state.direction];
  const head: Point = {
    x: state.snake[0].x + delta.x,
    y: state.snake[0].y + delta.y,
  };

  // Wall collision: with the default (non-wrapping) rules, leaving the board
  // ends the game.
  if (isOutOfBounds(state, head)) {
    return { ...state, status: 'gameover' as Status };
  }

  const willEat = samePoint(head, state.food);

  // When not eating, the tail cell is vacated this tick, so landing on it is legal.
  const collisionBody = willEat ? state.snake : state.snake.slice(0, -1);
  if (containsPoint(collisionBody, head)) {
    return { ...state, status: 'gameover' as Status };
  }

  if (willEat) {
    const nextSnake = [head, ...state.snake];
    const nextState: GameState = {
      ...state,
      snake: nextSnake,
      score: state.score + 1,
      food: state.food,
    };
    nextState.food = spawnFood(nextState);
    return nextState;
  }

  const nextSnake = [head, ...state.snake.slice(0, -1)];
  return { ...state, snake: nextSnake };
}

/**
 * Sets the movement direction, rejecting a direct 180-degree reversal
 * against the current heading. Returns a new state when accepted, or the
 * unchanged state when rejected.
 */
export function setDirection(state: GameState, dir: Direction): GameState {
  if (OPPOSITE[state.direction] === dir) {
    return state;
  }
  return { ...state, direction: dir };
}
