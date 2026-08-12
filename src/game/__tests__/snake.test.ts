import { createInitialState, setDirection, tick } from '../snake';
import { DEFAULT_CONFIG } from '../types';
import type { GameState } from '../types';

function occupiedBySnake(state: GameState, point: { x: number; y: number }): boolean {
  return state.snake.some((p) => p.x === point.x && p.y === point.y);
}

describe('createInitialState', () => {
  it('returns a valid GameState with a centered 3-cell snake and free food', () => {
    const state = createInitialState();

    expect(state.snake).toHaveLength(3);
    expect(state.status).toBe('idle');
    expect(state.score).toBe(0);
    expect(state.direction).toBe('right');
    expect(state.cols).toBe(DEFAULT_CONFIG.cols);
    expect(state.rows).toBe(DEFAULT_CONFIG.rows);

    // Snake is centered.
    const head = state.snake[0];
    expect(head.x).toBe(Math.floor(DEFAULT_CONFIG.cols / 2));
    expect(head.y).toBe(Math.floor(DEFAULT_CONFIG.rows / 2));

    // Food is on a free cell and within bounds.
    expect(occupiedBySnake(state, state.food)).toBe(false);
    expect(state.food.x).toBeGreaterThanOrEqual(0);
    expect(state.food.x).toBeLessThan(state.cols);
    expect(state.food.y).toBeGreaterThanOrEqual(0);
    expect(state.food.y).toBeLessThan(state.rows);
  });

  it('accepts config overrides', () => {
    const state = createInitialState({ cols: 10, rows: 8 });
    expect(state.cols).toBe(10);
    expect(state.rows).toBe(8);
  });
});

describe('tick', () => {
  it('moves the head one cell in the current direction', () => {
    const state = createInitialState();
    const before = state.snake[0];
    const next = tick(state);

    expect(next.snake[0]).toEqual({ x: before.x + 1, y: before.y });
    // Tail shifts unless food was eaten.
    expect(next.snake).toHaveLength(3);
  });

  it('eats food, increments score, grows by one, and respawns food on a free cell', () => {
    // Force food directly in front of the head (moving right).
    const state = createInitialState();
    const head = state.snake[0];
    const forced: GameState = { ...state, food: { x: head.x + 1, y: head.y } };

    const next = tick(forced);

    expect(next.score).toBe(forced.score + 1);
    expect(next.snake).toHaveLength(forced.snake.length + 1);
    expect(next.snake[0]).toEqual({ x: head.x + 1, y: head.y });
    // New food is on a free cell, not on the snake.
    expect(occupiedBySnake(next, next.food)).toBe(false);
  });

  it('sets gameover on wall collision (wrapWalls=false)', () => {
    // Place the snake near the right wall moving right.
    const state = createInitialState();
    const head = state.snake[0];
    const nearWall: GameState = {
      ...state,
      snake: [
        { x: state.cols - 1, y: head.y },
        { x: state.cols - 2, y: head.y },
        { x: state.cols - 3, y: head.y },
      ],
      food: { x: 0, y: 0 },
    };

    const next = tick(nearWall);
    expect(next.status).toBe('gameover');
  });

  it('sets gameover on self collision', () => {
    // Build a snake that will run into its own body.
    const state = createInitialState();
    const head = state.snake[0];
    const selfColliding: GameState = {
      ...state,
      // Moving right into a body cell directly ahead.
      snake: [
        { x: head.x, y: head.y },
        { x: head.x + 1, y: head.y },
        { x: head.x + 1, y: head.y + 1 },
        { x: head.x, y: head.y + 1 },
      ],
      food: { x: 0, y: 0 },
    };

    const next = tick(selfColliding);
    expect(next.status).toBe('gameover');
  });
});

describe('setDirection', () => {
  it('accepts a perpendicular direction', () => {
    const state = createInitialState(); // moving right
    const next = setDirection(state, 'up');
    expect(next.direction).toBe('up');
  });

  it('rejects a 180-degree reversal into the opposite direction', () => {
    const state = createInitialState(); // moving right
    const next = setDirection(state, 'left');
    expect(next.direction).toBe('right');
    // Movement direction unchanged.
    expect(next).toBe(state);
  });
});
