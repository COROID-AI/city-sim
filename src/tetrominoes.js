/**
 * Pure tetromino data: the 7 standard pieces with their 4 SRS rotation states,
 * plus the 7-bag randomizer factory.
 *
 * Each rotation state is a square matrix of 0s and 1s. The matrix dimension
 * is 4x4 for the I-piece and 3x3 for all others (O-piece uses 2x2 effectively
 * but is represented as 3x3 for uniformity — it never changes on rotate).
 *
 * Rotation states are precomputed using the standard SRS (Super Rotation System)
 * clockwise rotation.
 */

import { COLORS, SPAWN_X, SPAWN_Y } from './config.js';

/**
 * The canonical SRS rotation matrices for each piece type.
 * State 0 is the spawn orientation; each subsequent state is a clockwise rotation.
 */
export const SHAPES = Object.freeze({
  I: Object.freeze([
    [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
    ],
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
    ],
  ]),
  O: Object.freeze([
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  ]),
  T: Object.freeze([
    [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ]),
  S: Object.freeze([
    [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
    [
      [0, 0, 0],
      [0, 1, 1],
      [1, 1, 0],
    ],
    [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ]),
  Z: Object.freeze([
    [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 1],
    ],
    [
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  ]),
  J: Object.freeze([
    [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 1],
      [0, 1, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [0, 0, 1],
    ],
    [
      [0, 1, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  ]),
  L: Object.freeze([
    [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 1],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [1, 0, 0],
    ],
    [
      [1, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ],
  ]),
});

/**
 * Returns the cells (as [col, row] offsets within the matrix) for a given
 * piece type and rotation state.
 * @param {string} type - Piece type (I, O, T, S, Z, J, L)
 * @param {number} rotation - Rotation state (0-3)
 * @returns {number[][]} Array of [col, row] cell offsets
 */
export function getCells(type, rotation) {
  const matrix = SHAPES[type][rotation];
  const cells = [];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c]) cells.push([c, r]);
    }
  }
  return cells;
}

/**
 * Creates a new tetromino object at spawn position.
 * @param {string} type - Piece type
 * @returns {{ type: string, rotation: number, x: number, y: number, color: string }}
 */
export function createPiece(type) {
  return {
    type,
    rotation: 0,
    x: SPAWN_X[type],
    y: SPAWN_Y,
    color: COLORS[type],
  };
}

/**
 * Creates a Fisher-Yates shuffle of the 7 piece types.
 * @param {() => number} [rand] - Optional random function for testing (defaults to Math.random)
 * @returns {string[]} Shuffled array of piece types
 */
export function shuffledBag(rand = Math.random) {
  const types = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  return types;
}

/**
 * 7-bag randomizer factory. Each bag contains all 7 pieces in random order;
 * a new bag is generated only when the current bag is exhausted, guaranteeing
 * that no piece repeats before all 7 have appeared.
 *
 * @param {() => number} [rand] - Optional random function for testing
 * @returns {{ next: () => string }} Object with a next() method returning the next piece type
 */
export function createBag(rand = Math.random) {
  let bag = shuffledBag(rand);
  return {
    next() {
      if (bag.length === 0) {
        bag = shuffledBag(rand);
      }
      return bag.shift();
    },
  };
}
