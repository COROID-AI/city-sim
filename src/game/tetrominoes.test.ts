import { rotate } from './tetrominoes';
import { TETROMINOES } from './tetrominoes';
import { TetrominoId } from './types';

describe('TETROMINOES', () => {
  it('contains exactly the seven standard tetrominoes', () => {
    expect(Object.keys(TETROMINOES).sort()).toEqual(
      ['I', 'J', 'L', 'O', 'S', 'T', 'Z'],
    );
  });

  it('gives every piece a non-empty color and id', () => {
    for (const id of Object.values(TetrominoId)) {
      const piece = TETROMINOES[id];
      expect(piece.id).toBe(id);
      expect(piece.color.length).toBeGreaterThan(0);
    }
  });

  it('produces exactly four rotation states per piece', () => {
    for (const id of Object.values(TetrominoId)) {
      expect(TETROMINOES[id].rotations).toHaveLength(4);
    }
  });

  it('counts four filled cells in every rotation of every piece', () => {
    for (const id of Object.values(TetrominoId)) {
      for (const shape of TETROMINOES[id].rotations) {
        const filled = shape
          .flat()
          .filter((cell) => cell === true).length;
        expect(filled).toBe(4);
      }
    }
  });
});

describe('rotate', () => {
  it('advances through 0 -> 1 -> 2 -> 3 -> 0', () => {
    const piece = TETROMINOES[TetrominoId.T];
    expect(rotate(piece, 0)).toBe(1);
    expect(rotate(piece, 1)).toBe(2);
    expect(rotate(piece, 2)).toBe(3);
    expect(rotate(piece, 3)).toBe(0);
  });

  it('normalizes out-of-range indices', () => {
    const piece = TETROMINOES[TetrominoId.I];
    expect(rotate(piece, -1)).toBe(0);
    expect(rotate(piece, 4)).toBe(1);
  });
});
