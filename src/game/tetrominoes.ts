/**
 * Tetromino definitions following the Super Rotation System (SRS).
 *
 * Each of the seven tetrominoes is described by exactly four rotation states
 * (the O piece simply repeats its single state four times) and a display
 * colour. This module has no dependencies and uses no browser APIs so it stays
 * fully unit-testable.
 */

/** A single rotation state: a grid of 0 (empty) / 1 (filled) cells. */
export type RotationMatrix = ReadonlyArray<ReadonlyArray<number>>;

/** The seven standard tetromino types. */
export type TetrominoType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

/** Full definition of one tetromino. */
export interface TetrominoDefinition {
  readonly type: TetrominoType;
  readonly rotations: readonly RotationMatrix[];
  readonly color: string;
}

const I: TetrominoDefinition = {
  type: "I",
  color: "#22d3ee", // cyan
  rotations: [
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
  ],
};

const O: TetrominoDefinition = {
  type: "O",
  color: "#fbbf24", // yellow
  rotations: [
    [
      [1, 1],
      [1, 1],
    ],
    [
      [1, 1],
      [1, 1],
    ],
    [
      [1, 1],
      [1, 1],
    ],
    [
      [1, 1],
      [1, 1],
    ],
  ],
};

const T: TetrominoDefinition = {
  type: "T",
  color: "#a855f7", // purple
  rotations: [
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
  ],
};

const S: TetrominoDefinition = {
  type: "S",
  color: "#22c55e", // green
  rotations: [
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
  ],
};

const Z: TetrominoDefinition = {
  type: "Z",
  color: "#ef4444", // red
  rotations: [
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
  ],
};

const J: TetrominoDefinition = {
  type: "J",
  color: "#3b82f6", // blue
  rotations: [
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
  ],
};

const L: TetrominoDefinition = {
  type: "L",
  color: "#f97316", // orange
  rotations: [
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
  ],
};

/** All seven tetrominoes keyed by type. */
export const TETROMINOES: Readonly<Record<TetrominoType, TetrominoDefinition>> = {
  I,
  O,
  T,
  S,
  Z,
  J,
  L,
};

/** Ordered list of the seven types, used by the 7-bag randomiser. */
export const ALL_TETROMINO_TYPES: readonly TetrominoType[] = [
  "I",
  "O",
  "T",
  "S",
  "Z",
  "J",
  "L",
];

/** The number of filled cells in every tetromino. */
export const CELLS_PER_TETROMINO = 4;
