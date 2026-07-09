import { describe, it, expect } from "vitest";
import { createBag, mulberry32 } from "../bag";
import { PIECE_IDS } from "../tetrominoes";
import type { TetrominoId } from "../types";

describe("7-bag randomizer", () => {
  it("7 consecutive calls return all 7 distinct ids", () => {
    const bag = createBag();
    const drawn = new Set<TetrominoId>();
    for (let i = 0; i < 7; i++) {
      drawn.add(bag.next());
    }
    expect(drawn.size).toBe(7);
    for (const id of PIECE_IDS) {
      expect(drawn.has(id)).toBe(true);
    }
  });

  it("each of the 7 ids appears exactly once per bag of 7", () => {
    const bag = createBag();
    for (let bagNum = 0; bagNum < 3; bagNum++) {
      const batch: TetrominoId[] = [];
      for (let i = 0; i < 7; i++) {
        batch.push(bag.next());
      }
      // No duplicates within a bag.
      expect(new Set(batch).size).toBe(7);
    }
  });

  it("the 8th call starts a fresh permutation", () => {
    const bag = createBag();
    const firstBag: TetrominoId[] = [];
    for (let i = 0; i < 7; i++) firstBag.push(bag.next());
    const eighth = bag.next();
    // The 8th piece is the first of the new bag; it CAN be any piece.
    expect(PIECE_IDS).toContain(eighth);
    // Over 14 pieces each id appears exactly twice (2 full bags).
    const bag2 = createBag();
    const counts = new Map<TetrominoId, number>();
    for (let i = 0; i < 14; i++) {
      const id = bag2.next();
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const id of PIECE_IDS) {
      expect(counts.get(id)).toBe(2);
    }
  });

  it("seeded RNG produces deterministic order", () => {
    // Two bags with the same seed must produce the identical sequence.
    const bag1 = createBag(mulberry32(12345));
    const bag2 = createBag(mulberry32(12345));
    const a: TetrominoId[] = [];
    const b: TetrominoId[] = [];
    for (let i = 0; i < 7; i++) {
      a.push(bag1.next());
    }
    for (let i = 0; i < 7; i++) {
      b.push(bag2.next());
    }
    expect(a).toEqual(b);
  });
});
