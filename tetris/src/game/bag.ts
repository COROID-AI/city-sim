/**
 * 7-bag randomizer with injectable seed for deterministic tests.
 *
 * Guarantees fairness: each of the 7 tetrominoes appears exactly once per
 * "bag" of 7, shuffled via Fisher–Yates. A fresh bag is generated whenever the
 * current one is exhausted.
 *
 * Pure — no global state, no I/O.
 */

import type { TetrominoId } from "./types";
import { PIECE_IDS } from "./tetrominoes";

/** A function returning a float in [0, 1). Injectable for testing. */
export type RandomFn = () => number;

/**
 * Simple linear-congruential generator (mulberry32). Deterministic given a
 * seed, suitable for reproducible test runs.
 */
export function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Default non-deterministic random source. */
const defaultRandom: RandomFn = Math.random;

/** Fisher–Yates in-place shuffle, returning the same array. */
function shuffle<T>(arr: T[], random: RandomFn): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export interface Bag {
  /** Returns the next tetromino id, generating a fresh bag when needed. */
  next(): TetrominoId;
}

/**
 * Create a new 7-bag randomizer.
 *
 * @param random Optional injectable RNG (e.g. {@link mulberry32}) for
 *               deterministic output in tests.
 */
export function createBag(random: RandomFn = defaultRandom): Bag {
  let bag: TetrominoId[] = [];
  let index = 0;

  function refill(): void {
    bag = shuffle([...PIECE_IDS], random);
    index = 0;
  }

  return {
    next() {
      if (index >= bag.length) {
        refill();
      }
      return bag[index++]!;
    },
  };
}
