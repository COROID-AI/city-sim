import { describe, expect, it } from '@jest/globals';
import { rotate, TETROMINOES } from '../tetrominoes';
import type { Cell, TetrominoId } from '../types';

const ALL_IDS: TetrominoId[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/** Extract the occupied cells (non-zero) from a rotation-state matrix. */
function occupiedCells(state: Cell[][]): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  state.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell !== 0) cells.push([x, y]);
    });
  });
  return cells;
}

/**
 * Normalize a set of cells to its bounding-box origin so that translation
 * (which piece position within the 4x4 field) is ignored.
 */
function normalize(cells: Array<[number, number]>): string {
  if (cells.length === 0) return '';
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of cells) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }
  return cells
    .map(([x, y]) => `${x - minX},${y - minY}`)
    .sort()
    .join('|');
}

/**
 * Rotate a set of cells 90° clockwise in grid coordinates (y axis points
 * down): (x, y) -> (-y, x).
 */
function rotateCw(cells: Array<[number, number]>): Array<[number, number]> {
  return cells.map(([x, y]) => [-y, x]);
}

describe('tetrominoes', () => {
  it('defines the 7 standard pieces', () => {
    expect(Object.keys(TETROMINOES).sort()).toEqual([...ALL_IDS].sort());
  });

  it('gives every piece 4 rotation states, each 4x4', () => {
    for (const id of ALL_IDS) {
      expect(TETROMINOES[id].rotations).toHaveLength(4);
      for (const state of TETROMINOES[id].rotations) {
        expect(state).toHaveLength(4);
        for (const row of state) {
          expect(row).toHaveLength(4);
        }
      }
    }
  });

  it('gives the I piece 4 distinct rotation states', () => {
    const states = TETROMINOES.I.rotations;
    expect(states).toHaveLength(4);
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        expect(states[i]).not.toEqual(states[j]);
      }
    }
  });

  it('treats the O piece rotation as identity', () => {
    const spawn = TETROMINOES.O.rotations[0];
    for (const state of TETROMINOES.O.rotations) {
      expect(state).toEqual(spawn);
    }
    expect(rotate('O', 1)).toEqual(spawn);
    expect(rotate('O', -1)).toEqual(spawn);
  });

  it("rotate('T', 1) is a 90° clockwise rotation", () => {
    const expected: Cell[][] = [
      [0, 3, 0, 0],
      [0, 3, 3, 0],
      [0, 3, 0, 0],
      [0, 0, 0, 0],
    ];
    expect(rotate('T', 1)).toEqual(expected);
  });

  it("rotate('T', -1) is the 270° (counter-clockwise) state", () => {
    expect(rotate('T', -1)).toEqual(TETROMINOES.T.rotations[3]);
  });

  it('returns rotation states that form a clockwise cycle for every piece', () => {
    for (const id of ALL_IDS) {
      for (let i = 0; i < 4; i++) {
        const current = TETROMINOES[id].rotations[i];
        const next = TETROMINOES[id].rotations[(i + 1) % 4];
        expect(normalize(rotateCw(occupiedCells(current)))).toBe(
          normalize(occupiedCells(next)),
        );
      }
    }
  });
});