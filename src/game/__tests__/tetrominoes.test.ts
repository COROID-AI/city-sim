import { describe, expect, it } from '@jest/globals';
import { rotate, TETROMINOES } from '../tetrominoes';
import type { Cell, TetrominoId } from '../types';

// Expected result of rotating the T piece's spawn state 90 degrees clockwise.
const T_SPAWN_CW: Cell[][] = [
  [0, 3, 0, 0],
  [0, 3, 3, 0],
  [0, 3, 0, 0],
  [0, 0, 0, 0],
];

const ALL_IDS: TetrominoId[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

describe('tetrominoes', () => {
  it('exports the seven standard tetrominoes', () => {
    expect(Object.keys(TETROMINOES)).toEqual(ALL_IDS);
  });

  it('I-piece has 4 rotation states', () => {
    expect(TETROMINOES.I).toHaveLength(4);
  });

  it('every piece is a rotation-state array with 4 states', () => {
    for (const id of ALL_IDS) {
      expect(TETROMINOES[id]).toHaveLength(4);
    }
  });

  it('O-piece rotation is the identity', () => {
    expect(rotate('O', 1).matrix).toEqual(TETROMINOES.O[0].matrix);
    expect(rotate('O', -1).matrix).toEqual(TETROMINOES.O[0].matrix);
    expect(TETROMINOES.O[1].matrix).toEqual(TETROMINOES.O[0].matrix);
  });

  it("rotate('T', 1) is a 90deg clockwise rotation", () => {
    const result = rotate('T', 1);
    expect(result).toBe(TETROMINOES.T[1]);
    expect(result.matrix).toEqual(T_SPAWN_CW);
  });

  it("rotate('T', -1) is a 90deg counter-clockwise rotation", () => {
    expect(rotate('T', -1)).toBe(TETROMINOES.T[3]);
  });

  it('rotation states keep the piece id', () => {
    expect(rotate('J', 1).id).toBe('J');
    expect(TETROMINOES.S[2].id).toBe('S');
  });
});