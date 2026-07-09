/**
 * Pure tetromino shape data and colours.
 *
 * Each of the 7 standard tetrominoes (I, O, T, S, Z, J, L) is described as
 * four clockwise rotation states. A rotation state is a list of filled
 * {@link Cell} offsets within a square bounding box. The first state is the
 * canonical spawn orientation; the remaining three are derived by rotating 90°,
 * 180°, and 270° clockwise respectively.
 *
 * No side effects, no DOM access — this module is pure data.
 */

import type { Cell, Rotation, TetrominoId, TetrominoShape } from "./types";

// ---------------------------------------------------------------------------
// Rotation helper
// ---------------------------------------------------------------------------

/**
 * Rotate a set of cells 90° clockwise within an `size`×`size` bounding box.
 *
 * Formula: [r, c] → [c, size - 1 - r]
 */
function rotateCW(cells: readonly Cell[], size: number): Cell[] {
  return cells.map(([r, c]) => [c, size - 1 - r] as Cell);
}

/**
 * Build a full {@link TetrominoShape} (4 clockwise rotation states) from the
 * canonical spawn orientation.
 */
function makeShape(
  initial: readonly Cell[],
  size: number,
): TetrominoShape {
  const r1 = rotateCW(initial, size);
  const r2 = rotateCW(r1, size);
  const r3 = rotateCW(r2, size);
  return [initial, r1, r2, r3] as const;
}

// ---------------------------------------------------------------------------
// Shape definitions
// ---------------------------------------------------------------------------

/** Canonical spawn orientation for each tetromino. */
const SPAWN: Record<TetrominoId, { cells: readonly Cell[]; size: number }> = {
  // 4×4 grid — horizontal bar on the second row
  I: { cells: [[1, 0], [1, 1], [1, 2], [1, 3]], size: 4 },
  // 2×2 square — rotation-invariant
  O: { cells: [[0, 0], [0, 1], [1, 0], [1, 1]], size: 2 },
  // 3×3 — T pointing up
  T: { cells: [[0, 1], [1, 0], [1, 1], [1, 2]], size: 3 },
  // 3×3 — S (horizontal)
  S: { cells: [[0, 1], [0, 2], [1, 0], [1, 1]], size: 3 },
  // 3×3 — Z (horizontal)
  Z: { cells: [[0, 0], [0, 1], [1, 1], [1, 2]], size: 3 },
  // 3×3 — J
  J: { cells: [[0, 0], [1, 0], [1, 1], [1, 2]], size: 3 },
  // 3×3 — L
  L: { cells: [[0, 2], [1, 0], [1, 1], [1, 2]], size: 3 },
};

/**
 * All 7 tetrominoes, each with four clockwise rotation states.
 */
export const SHAPES: Record<TetrominoId, TetrominoShape> = {
  I: makeShape(SPAWN.I.cells, SPAWN.I.size),
  O: makeShape(SPAWN.O.cells, SPAWN.O.size),
  T: makeShape(SPAWN.T.cells, SPAWN.T.size),
  S: makeShape(SPAWN.S.cells, SPAWN.S.size),
  Z: makeShape(SPAWN.Z.cells, SPAWN.Z.size),
  J: makeShape(SPAWN.J.cells, SPAWN.J.size),
  L: makeShape(SPAWN.L.cells, SPAWN.L.size),
};

// ---------------------------------------------------------------------------
// Colour mapping
// ---------------------------------------------------------------------------

/** Ordered list of tetromino ids — used to derive 1-based colour indices. */
export const PIECE_IDS: readonly TetrominoId[] = [
  "I",
  "O",
  "T",
  "S",
  "Z",
  "J",
  "L",
];

/** Display colours for each tetromino. */
export const COLORS: Record<TetrominoId, string> = {
  I: "#22d3ee", // cyan
  O: "#fbbf24", // amber/yellow
  T: "#a855f7", // purple
  S: "#22c55e", // green
  Z: "#ef4444", // red
  J: "#3b82f6", // blue
  L: "#f97316", // orange
};

/**
 * 1-based colour index for a tetromino id. Board cells store this index (0 =
 * empty) so the renderer can look up the colour without a reverse map.
 */
export function colorIndexOf(id: TetrominoId): number {
  return PIECE_IDS.indexOf(id) + 1;
}

/** Hex colour string for a board colour index (0 = empty → transparent). */
export function colorAt(index: number): string {
  if (index <= 0 || index > PIECE_IDS.length) return "";
  const id = PIECE_IDS[index - 1]!;
  return COLORS[id];
}

export type { Cell, Rotation, TetrominoId, TetrominoShape };
