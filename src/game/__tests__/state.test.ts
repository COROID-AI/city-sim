import { describe, expect, it } from '@jest/globals';
import { createBoard, getCell, setCell } from '../board';
import { createInitialState, spawnPiece, step } from '../state';
import { TETROMINOES } from '../tetrominoes';
import type { GameAction, GameConfig, GameState, RNG } from '../types';

const CONFIG: GameConfig = { width: 10, height: 20, tickMs: 500 };

/** Deterministic rng that replays the given [0,1) draws (cycling). */
function makeRng(values: number[]): RNG {
  let i = 0;
  return () => {
    const value = values[i % values.length];
    i += 1;
    return value;
  };
}

const constRng: RNG = () => 0; // Always draws the first piece (I).

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: createBoard(CONFIG.width, CONFIG.height),
    current: TETROMINOES.T[0],
    next: TETROMINOES.I[0],
    x: 3,
    y: 15,
    rotation: 0,
    score: 0,
    level: 0,
    lines: 0,
    gameOver: false,
    ...overrides,
  };
}

describe('createInitialState', () => {
  it('creates an empty board and zeroed counters', () => {
    // Draws 0 (I) then 0.2 (O: floor(0.2 * 7) = 1).
    const state = createInitialState(CONFIG, makeRng([0, 0.2]));

    expect(state.board).toHaveLength(20);
    expect(state.board[0]).toHaveLength(10);
    expect(state.board.every((row) => row.every((cell) => cell === 0))).toBe(
      true,
    );
    expect(state.current).toBe(TETROMINOES.I[0]);
    expect(state.next).toBe(TETROMINOES.O[0]);
    expect(state.x).toBe(3);
    expect(state.y).toBe(0);
    expect(state.rotation).toBe(0);
    expect(state.score).toBe(0);
    expect(state.level).toBe(0);
    expect(state.lines).toBe(0);
    expect(state.gameOver).toBe(false);
  });

  it('is deterministic for a given rng', () => {
    const a = createInitialState(CONFIG, constRng);
    const b = createInitialState(CONFIG, constRng);
    expect(a.current.id).toBe(b.current.id);
    expect(a.next.id).toBe(b.next.id);
  });
});

describe('spawnPiece', () => {
  it('promotes next to current and queues a fresh piece', () => {
    const state = makeState({ next: TETROMINOES.O[0] });
    const result = spawnPiece(state, constRng);

    expect(result.current).toBe(TETROMINOES.O[0]);
    expect(result.next).toBe(TETROMINOES.I[0]);
    expect(result.rotation).toBe(0);
    expect(result.x).toBe(3);
    expect(result.y).toBe(0);
    expect(result.gameOver).toBe(false);
  });

  it('sets gameOver when the spawn cells are occupied', () => {
    let blocked = createBoard(10, 20);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 10; x++) {
        blocked = setCell(blocked, x, y, 1);
      }
    }
    const state = makeState({ board: blocked, next: TETROMINOES.T[0] });
    const result = spawnPiece(state, constRng);

    expect(result.gameOver).toBe(true);
    expect(result.board).toBe(blocked);
    expect(result.current).toBe(TETROMINOES.T[0]);
  });
});

describe('step', () => {
  it('handles move actions', () => {
    const state = createInitialState(CONFIG, constRng); // I piece, x = 3
    const left = step(state, { type: 'move', dir: 'left' }, constRng);
    expect(left.x).toBe(2);
    expect(left).not.toBe(state);

    const right = step(state, { type: 'move', dir: 'right' }, constRng);
    expect(right.x).toBe(4);
  });

  it('handles rotate actions', () => {
    const state = createInitialState(CONFIG, constRng); // I piece, x = 3
    const result = step(state, { type: 'rotate', dir: 1 }, constRng);
    expect(result.rotation).toBe(1);
    expect(result.current.matrix).toEqual(TETROMINOES.I[1].matrix);
  });

  it('soft drop moves down one row per cell and scores 1 per cell', () => {
    const state = createInitialState(CONFIG, makeRng([2])); // T piece
    const one = step(state, { type: 'softDrop' }, constRng);
    expect(one.y).toBe(1);
    expect(one.score).toBe(1);

    const two = step(one, { type: 'softDrop' }, constRng);
    expect(two.y).toBe(2);
    expect(two.score).toBe(2);
  });

  it('soft drop rejects at the floor without scoring', () => {
    const state = makeState({ current: TETROMINOES.I[0], y: 18 });
    const result = step(state, { type: 'softDrop' }, constRng);
    expect(result).toBe(state);
  });

  it('hard drop scores 2 per cell descended, locks, and spawns next', () => {
    // T piece at y = 0 drops to y = 17 (17 cells) on an empty 20-row board.
    const state = makeState({ current: TETROMINOES.T[0], y: 0 });
    const result = step(state, { type: 'hardDrop' }, constRng);

    expect(result.score).toBe(34); // 2 points * 17 cells descended
    expect(result.y).toBe(0); // the returned state holds the fresh spawn
    expect(result.lines).toBe(0);
    expect(getCell(result.board, 4, 18)).toBe(3); // T top cell on row 18
    expect(getCell(result.board, 3, 19)).toBe(3); // T base on row 19
    expect(getCell(result.board, 5, 19)).toBe(3); // T base on row 19
    expect(result.current).toBe(TETROMINOES.I[0]); // fresh spawn
    expect(result.gameOver).toBe(false);
  });

  it('tick applies one row of gravity without locking when space exists', () => {
    const state = makeState({ current: TETROMINOES.T[0], y: 0 });
    const result = step(state, { type: 'tick' }, constRng);
    expect(result.y).toBe(1);
    expect(result.current).toBe(state.current);
    expect(result.score).toBe(0);
  });

  it('tick locks and respawns when gravity collides', () => {
    const state = makeState({ current: TETROMINOES.I[0], y: 18 });
    const result = step(state, { type: 'tick' }, constRng);

    // The I piece is now locked on the bottom row.
    expect(getCell(result.board, 3, 19)).toBe(1);
    expect(getCell(result.board, 6, 19)).toBe(1);
    // A fresh piece was spawned at the top.
    expect(result.current).toBe(TETROMINOES.I[0]);
    expect(result.y).toBe(0);
    expect(result.x).toBe(3);
    expect(result.gameOver).toBe(false);
  });

  it('tick locks, clears rows, scores, and respawns', () => {
    let board = createBoard(10, 20);
    for (let x = 0; x < 10; x++) {
      if (x >= 3 && x <= 6) continue;
      board = setCell(board, x, 19, 1);
    }
    const state = makeState({ board, current: TETROMINOES.I[0], y: 18 });
    const result = step(state, { type: 'tick' }, constRng);

    expect(result.lines).toBe(1);
    expect(result.level).toBe(0);
    expect(result.score).toBe(0); // single at level 0 = 100 * 0
    expect(result.board[19].every((cell) => cell === 0)).toBe(true);
    expect(result.current).toBe(TETROMINOES.I[0]);
    expect(result.gameOver).toBe(false);
  });

  it('is a no-op for every action once the game is over', () => {
    const states = [
      makeState({ gameOver: true }),
      makeState({ gameOver: true, y: 0 }),
    ];
    const actions: GameAction[] = [
      { type: 'move', dir: 'left' },
      { type: 'move', dir: 'right' },
      { type: 'rotate', dir: 1 },
      { type: 'rotate', dir: -1 },
      { type: 'softDrop' },
      { type: 'hardDrop' },
      { type: 'tick' },
    ];
    for (const state of states) {
      for (const action of actions) {
        expect(step(state, action, constRng)).toBe(state);
      }
    }
  });
});