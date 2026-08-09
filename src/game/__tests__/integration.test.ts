import { describe, expect, it } from '@jest/globals';
import { createBoard, getCell, setCell } from '../board';
import { createInitialState, step } from '../state';
import { TETROMINOES } from '../tetrominoes';
import type { GameState, RNG } from '../types';

const CONFIG = { width: 10, height: 20, tickMs: 500 };

/** Always draws the I piece, so the whole sequence is deterministic. */
const alwaysI: RNG = () => 0;

describe('integration: spawn -> hardDrop -> spawn -> rotate -> hardDrop', () => {
  it('locks, clears a line, then plays the spawned next piece', () => {
    // Bottom row filled except a 4-wide gap at cols 3..6, which the
    // horizontal I piece completes when it locks.
    let board = createBoard(CONFIG.width, CONFIG.height);
    for (let x = 0; x < CONFIG.width; x++) {
      if (x >= 3 && x <= 6) continue;
      board = setCell(board, x, CONFIG.height - 1, 1);
    }

    let state: GameState = {
      ...createInitialState(CONFIG, alwaysI),
      board,
    };
    expect(state.current).toBe(TETROMINOES.I[0]);

    // 1) Spawn -> hardDrop: drops 18 rows (2 points each), locks the I
    //    piece on the bottom row, that row clears, and the next piece
    //    spawns at the top. A single clear at level 0 scores 100 * 0.
    const first = step(state, { type: 'hardDrop' }, alwaysI);
    expect(first).not.toBe(state);
    expect(first.score).toBe(36); // 18 cells * 2 points + 0 line-clear
    expect(first.lines).toBe(1);
    expect(
      first.board[CONFIG.height - 1].every((cell) => cell === 0),
    ).toBe(true);
    expect(first.current).toBe(TETROMINOES.I[0]);
    expect(first.x).toBe(3);
    expect(first.y).toBe(0);
    expect(first.rotation).toBe(0);
    expect(first.gameOver).toBe(false);

    // 2) Rotate the freshly spawned piece clockwise (vertical I).
    const rotated = step(first, { type: 'rotate', dir: 1 }, alwaysI);
    expect(rotated.rotation).toBe(1);
    expect(rotated.current.matrix).toEqual(TETROMINOES.I[1].matrix);
    expect(rotated.y).toBe(0);

    // 3) HardDrop again: the vertical I lands in column 5 (rows 16..19).
    //    No new line clears, but the drop still scores 16 cells * 2.
    const second = step(rotated, { type: 'hardDrop' }, alwaysI);
    expect(second.score).toBe(68); // 36 + 32
    expect(second.score).toBeGreaterThan(first.score);
    expect(second.lines).toBe(1);
    expect(second.lines).toBeGreaterThan(0);
    expect(second.gameOver).toBe(false);

    for (let y = 16; y <= 19; y++) {
      expect(getCell(second.board, 5, y)).toBe(1); // locked I color
    }
  });
});