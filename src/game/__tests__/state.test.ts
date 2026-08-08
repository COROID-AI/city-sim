import { describe, expect, it } from '@jest/globals';
import { createBoard, setCell } from '../board';
import { TETROMINOES } from '../tetrominoes';
import { canPlace } from '../rules';
import { createInitialState, spawnPiece, step } from '../state';
import type { GameConfig, GameState, Rng } from '../types';

const CONFIG: GameConfig = { width: 10, height: 20, tickMs: 1000 };

const ALL_IDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;

/**
 * Deterministic rng: cycles through the given values, clamped at the end.
 */
function seq(values: number[]): Rng {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: createBoard(10, 20),
    current: TETROMINOES.T,
    next: TETROMINOES.S,
    x: 3,
    y: 0,
    rotation: 0,
    score: 0,
    level: 0,
    lines: 0,
    gameOver: false,
    ...overrides,
  };
}

describe('createInitialState', () => {
  it('returns the documented state shape with a placeable current piece', () => {
    const state = createInitialState(CONFIG, () => 0);
    expect(state.board).toHaveLength(20);
    expect(state.board[0]).toHaveLength(10);
    expect(ALL_IDS).toContain(state.current.id);
    expect(ALL_IDS).toContain(state.next.id);
    expect(state.rotation).toBe(0);
    expect(state.score).toBe(0);
    expect(state.lines).toBe(0);
    expect(state.level).toBe(0);
    expect(state.gameOver).toBe(false);
    expect(
      canPlace(state.board, state.current.rotations[state.rotation], state.x, state.y),
    ).toBe(true);
  });

  it('is deterministic for identical rng sequences', () => {
    const a = createInitialState(CONFIG, seq([0, 0.2]));
    const b = createInitialState(CONFIG, seq([0, 0.2]));
    expect(a.current.id).toBe('I');
    expect(a.next.id).toBe('O');
    expect(b.current.id).toBe('I');
    expect(b.next.id).toBe('O');
  });
});

describe('spawnPiece', () => {
  it('promotes the queued piece and draws a fresh next piece', () => {
    const state = makeState({ next: TETROMINOES.J });
    const result = spawnPiece(state, seq([0.5]));
    expect(result.current).toBe(TETROMINOES.J);
    expect(result.next.id).toBe('S'); // floor(0.5 * 7) = 3 -> S
    expect(result.x).toBe(3);
    expect(result.y).toBe(0);
    expect(result.rotation).toBe(0);
    expect(result.gameOver).toBe(false);
  });

  it('sets gameOver when the spawn position is occupied', () => {
    let board = createBoard(10, 20);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 10; x++) {
        board = setCell(board, x, y, 1);
      }
    }
    const state = makeState({ board, next: TETROMINOES.I });
    const result = spawnPiece(state, seq([0.5]));
    expect(result.gameOver).toBe(true);
  });
});

describe('step', () => {
  it("moves the piece with 'move' actions", () => {
    const state = makeState();
    expect(step(state, { type: 'move', dir: 'right' }, () => 0).x).toBe(4);
    expect(step(state, { type: 'move', dir: 'left' }, () => 0).x).toBe(2);
  });

  it("rotates the piece with a 'rotate' action (one-cell nudge)", () => {
    const board = setCell(createBoard(10, 20), 6, 10, 1);
    const state = makeState({ board, current: TETROMINOES.T, x: 5, y: 10 });
    const result = step(state, { type: 'rotate', dir: 1 }, () => 0);
    expect(result.rotation).toBe(1);
    expect(result.x).toBe(4);
  });

  it("scores 1 point per cell on 'softDrop' and falls one row", () => {
    const state = makeState({ current: TETROMINOES.I, x: 3, y: 10 });
    const result = step(state, { type: 'softDrop' }, () => 0);
    expect(result.y).toBe(11);
    expect(result.score).toBe(1);
  });

  it("rejects 'softDrop' once the piece has landed", () => {
    const state = makeState({ current: TETROMINOES.I, x: 3, y: 18 });
    expect(step(state, { type: 'softDrop' }, () => 0)).toBe(state);
  });

  it("scores 2 points per cell on 'hardDrop', locks, and respawns", () => {
    const state = makeState({
      current: TETROMINOES.I,
      next: TETROMINOES.T,
      x: 3,
      y: 10,
    });
    const result = step(state, { type: 'hardDrop' }, seq([0.5]));
    expect(result.score).toBe(16); // 8 rows * 2 points
    // The piece is locked at the bottom and the next piece respawns at y = 0.
    expect(result.y).toBe(0);
    expect(result.board[19][4]).toBe(1);
    expect(result.board[19][6]).toBe(1);
    expect(result.current.id).toBe('T');
    expect(result.next.id).toBe('S');
  });

  it("locks and respawns on a colliding 'tick'", () => {
    const state = makeState({
      current: TETROMINOES.I,
      next: TETROMINOES.T,
      x: 3,
      y: 18,
    });
    const result = step(state, { type: 'tick' }, seq([0.5]));
    expect(result.board[19][4]).toBe(1);
    expect(result.board[19][6]).toBe(1);
    expect(result.current.id).toBe('T');
    expect(result.next.id).toBe('S');
    expect(result.x).toBe(3);
    expect(result.y).toBe(0);
    expect(result.rotation).toBe(0);
    expect(result.gameOver).toBe(false);
  });

  it("applies one row of gravity on a free 'tick'", () => {
    const state = makeState({ current: TETROMINOES.I, x: 3, y: 10 });
    const result = step(state, { type: 'tick' }, () => 0);
    expect(result.y).toBe(11);
    expect(result.current).toBe(state.current);
    expect(result.board).toEqual(state.board);
  });

  it('is a no-op after game over', () => {
    const state = makeState({ gameOver: true });
    expect(step(state, { type: 'move', dir: 'right' }, () => 0)).toBe(state);
    expect(step(state, { type: 'tick' }, () => 0)).toBe(state);
  });
});
