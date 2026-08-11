import type { TetrominoType } from './types';

const ALL: TetrominoType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/**
 * Standard 7-bag randomizer: every bag is a fresh permutation of the seven
 * tetrominoes, so long droughts/repeats never happen. The RNG is injectable
 * for deterministic tests.
 */
export class Bag {
  private queue: TetrominoType[] = [];

  constructor(private rng: () => number = Math.random) {}

  next(): TetrominoType {
    if (this.queue.length === 0) this.refill();
    return this.queue.shift()!;
  }

  private refill(): void {
    const bag = ALL.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.queue.push(...bag);
  }
}