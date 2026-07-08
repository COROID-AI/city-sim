/**
 * Tests for tetromino definitions (acceptance criterion #1).
 */
import {
  ALL_TETROMINO_TYPES,
  CELLS_PER_TETROMINO,
  TETROMINOES,
  type TetrominoType,
} from "../tetrominoes";

const EXPECTED_TYPES: TetrominoType[] = ["I", "O", "T", "S", "Z", "J", "L"];

describe("tetrominoes", () => {
  it("defines all seven standard tetromino types", () => {
    for (const type of EXPECTED_TYPES) {
      expect(TETROMINOES[type]).toBeDefined();
      expect(TETROMINOES[type].type).toBe(type);
    }
  });

  it("each tetromino has exactly four rotation states", () => {
    for (const type of EXPECTED_TYPES) {
      expect(TETROMINOES[type].rotations).toHaveLength(4);
    }
  });

  it("each rotation state of every piece has exactly four filled cells", () => {
    for (const type of EXPECTED_TYPES) {
      for (const rotation of TETROMINOES[type].rotations) {
        const filled = rotation.reduce(
          (sum, row) => sum + row.reduce((s, cell) => s + cell, 0),
          0
        );
        expect(filled).toBe(CELLS_PER_TETROMINO);
      }
    }
  });

  it("the O piece repeats an identical 2x2 square across all four states", () => {
    const rotations = TETROMINOES.O.rotations;
    const first = JSON.stringify(rotations[0]);
    for (const rotation of rotations) {
      expect(JSON.stringify(rotation)).toBe(first);
    }
    expect(rotations[0]).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  it("every piece exposes a non-empty colour string", () => {
    for (const type of EXPECTED_TYPES) {
      expect(typeof TETROMINOES[type].color).toBe("string");
      expect(TETROMINOES[type].color.length).toBeGreaterThan(0);
    }
  });

  it("ALL_TETROMINO_TYPES lists seven unique types", () => {
    expect(ALL_TETROMINO_TYPES).toHaveLength(7);
    expect(new Set(ALL_TETROMINO_TYPES).size).toBe(7);
    for (const type of EXPECTED_TYPES) {
      expect(ALL_TETROMINO_TYPES).toContain(type);
    }
  });
});
