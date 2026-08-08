import { describe, expect, it } from '@jest/globals';
import { createInitialState, step } from '../state';
import { setCell } from '../board';
import type { GameConfig, GameState, Rng } from '../types';

const CONFIG: GameConfig = { width: 10, height: 20, cell: 30, tickMs: 500 };

/**
 * Deterministic rng: cycles through the given values, clamped at the end.
 */
function seq(values: number[]): Rng {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('game integration', () => {
  it('plays spawn -> hardDrop -> spawn -> rotate -> hardDrop and scores points', () => {
    // Deterministic sequence: current I, next O, then O, O, ...
    const rng = seq([0, 0.2]);
    let state: GameState = createInitialState(CONFIG, rng);

    expect(state.current.id).toBe('I');
    expect(state.next.id).toBe('O');
    expect(state.score).toBe(0);

    // Pre-fill the bottom row except the four cells the I piece will occupy
    // on lock (x = 3..6), so the first hard drop completes a row and clears
    // it — guaranteeing lines becomes non-zero.
    const occupy = new Set([3, 4, 5, 6]);
    let board = state.board;
    for (let x = 0; x < CONFIG.width; x++) {
      if (!occupy.has(x)) {
        board = setCell(board, x, CONFIG.height - 1, 1);
      }
    }
    state = { ...state, board };

    // 1) Hard drop to lock the I piece. It clears the pre-filled row.
    const scoreBeforeFirstDrop = state.score;
    state = step(state, { type: 'hardDrop' }, rng);
    expect(state.score).toBeGreaterThan(scoreBeforeFirstDrop);
    expect(state.lines).toBeGreaterThan(0);
    // 2) The hard drop spawned the queued next piece (O).
    expect(state.current.id).toBe('O');

    // 3) Rotate the current piece.
    state = step(state, { type: 'rotate', dir: 1 }, rng);
    expect(state.rotation).toBe(1);

    // 4) Hard drop again to lock the rotated piece.
    const scoreBeforeSecondDrop = state.score;
    state = step(state, { type: 'hardDrop' }, rng);
    expect(state.score).toBeGreaterThan(scoreBeforeSecondDrop);

    // 5) Total score and cleared lines are both non-zero.
    expect(state.score).toBeGreaterThan(0);
    expect(state.lines).toBeGreaterThan(0);
  });
});
