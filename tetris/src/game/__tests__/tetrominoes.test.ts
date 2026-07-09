import { describe, it, expect } from "vitest";
import { SHAPES, PIECE_IDS, COLORS, colorIndexOf } from "../tetrominoes";
import type { TetrominoId } from "../types";

describe("tetrominoes", () => {
  it("exports all 7 standard tetrominoes", () => {
    expect(PIECE_IDS).toHaveLength(7);
    for (const id of PIECE_IDS) {
      expect(SHAPES[id]).toBeDefined();
    }
    const ids: TetrominoId[] = ["I", "O", "T", "S", "Z", "J", "L"];
    for (const id of ids) {
      expect(PIECE_IDS).toContain(id);
    }
  });

  it("each piece has exactly 4 rotation states", () => {
    for (const id of PIECE_IDS) {
      const shape = SHAPES[id];
      expect(shape).toHaveLength(4);
      for (const rotation of shape) {
        expect(rotation.length).toBe(4); // each tetromino has 4 cells
      }
    }
  });

  it("all four O-piece rotations are identical (rotation-invariant)", () => {
    const shape = SHAPES.O;
    const cellKey = (cells: typeof shape[0]) =>
      cells
        .map(([r, c]) => `${r},${c}`)
        .sort()
        .join("|");
    const first = cellKey(shape[0]);
    expect(cellKey(shape[1])).toBe(first);
    expect(cellKey(shape[2])).toBe(first);
    expect(cellKey(shape[3])).toBe(first);
  });

  it("the I-piece has 4 distinct rotation states", () => {
    const shape = SHAPES.I;
    const cellKey = (cells: typeof shape[0]) =>
      cells
        .map(([r, c]) => `${r},${c}`)
        .sort()
        .join("|");
    const keys = shape.map(cellKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(4);
  });

  it("has a colour for every piece", () => {
    expect(Object.keys(COLORS)).toHaveLength(7);
    for (const id of PIECE_IDS) {
      expect(COLORS[id]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("colorIndexOf returns a 1-based index per piece", () => {
    PIECE_IDS.forEach((id, i) => {
      expect(colorIndexOf(id)).toBe(i + 1);
    });
  });
});
