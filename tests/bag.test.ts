import { describe, expect, it } from 'vitest';
import { Bag } from '../src/game/bag';
import type { TetrominoType } from '../src/game/types';

const ALL: TetrominoType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/** Deterministic RNG: Fisher-Yates with j = floor(0.5 * (i+1)). */
const halfRng = () => 0.5;

describe('Bag (7-bag randomizer)', () => {
  it('draws 7 pieces as a permutation of all tetrominoes', () => {
    const bag = new Bag(halfRng);
    const drawn: TetrominoType[] = [];
    for (let i = 0; i < 7; i++) drawn.push(bag.next());
    expect([...drawn].sort()).toEqual([...ALL].sort());
  });

  it('every rolling window of 7 pieces contains each type once', () => {
    const bag = new Bag(halfRng);
    const drawn: TetrominoType[] = [];
    for (let i = 0; i < 35; i++) drawn.push(bag.next());
    for (let start = 0; start <= drawn.length - 7; start += 7) {
      const window = drawn.slice(start, start + 7);
      expect(new Set(window).size).toBe(7);
      expect([...window].sort()).toEqual([...ALL].sort());
    }
  });

  it('never repeats the same piece twice in a row across bag boundaries', () => {
    const bag = new Bag(halfRng);
    let prev: TetrominoType | null = null;
    for (let i = 0; i < 28; i++) {
      const next = bag.next();
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});