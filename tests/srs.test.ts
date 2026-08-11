import { describe, expect, it } from 'vitest';
import { createBoard, merge } from '../src/game/board';
import { getKickTests, nextRotationState, tryRotate } from '../src/game/srs';
import { getShape, pieceCells, rotateCW, spawnPiece } from '../src/game/tetrominoes';
import type { ShapeMatrix } from '../src/game/tetrominoes';
import type { Piece, RotationState, TetrominoType } from '../src/game/types';

const T0: ShapeMatrix = [
  [0, 1, 0],
  [1, 1, 1],
  [0, 0, 0],
];
const T1: ShapeMatrix = [
  [0, 1, 0],
  [0, 1, 1],
  [0, 1, 0],
];
const T2: ShapeMatrix = [
  [0, 0, 0],
  [1, 1, 1],
  [0, 1, 0],
];
const T3: ShapeMatrix = [
  [0, 1, 0],
  [1, 1, 0],
  [0, 1, 0],
];

const J0: ShapeMatrix = [
  [1, 0, 0],
  [1, 1, 1],
  [0, 0, 0],
];
const J1: ShapeMatrix = [
  [0, 1, 1],
  [0, 1, 0],
  [0, 1, 0],
];

const I0: ShapeMatrix = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [1, 1, 1, 1],
];
const I2: ShapeMatrix = [
  [1, 1, 1, 1],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];

function assertValid(board: ReturnType<typeof createBoard>, piece: Piece): void {
  for (const { row, col } of pieceCells(piece)) {
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(24);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThan(10);
    expect(board[row][col]).toBeNull();
  }
}

describe('SRS orientation states', () => {
  it('uses the canonical Guideline spawn matrices', () => {
    expect(getShape('T', 0)).toEqual(T0);
    expect(getShape('J', 0)).toEqual(J0);
    expect(getShape('I', 0)).toEqual(I0);
  });

  it('rotates through four distinct states per piece (I, JLSTZ)', () => {
    const types: TetrominoType[] = ['I', 'T', 'S', 'Z', 'J', 'L'];
    for (const type of types) {
      const states = [0, 1, 2, 3].map((r) => getShape(type, r as RotationState));
      expect(states[0]).not.toEqual(states[1]);
      expect(states[1]).not.toEqual(states[2]);
      expect(states[2]).not.toEqual(states[3]);
      expect(states[3]).not.toEqual(states[0]);
    }
  });

  it('pins the documented clockwise convention (T and J)', () => {
    expect(getShape('T', 1)).toEqual(T1);
    expect(getShape('T', 2)).toEqual(T2);
    expect(getShape('T', 3)).toEqual(T3);
    expect(getShape('J', 1)).toEqual(J1);
    expect(getShape('I', 1)).toEqual(rotateCW(I0));
    expect(getShape('I', 2)).toEqual(I2);
  });

  it('keeps every state inside the bounding box (rotation never clips)', () => {
    expect(pieceCells({ type: 'T', rotation: 0, x: 0, y: 0 }).length).toBe(4);
    expect(pieceCells({ type: 'S', rotation: 1, x: 0, y: 0 }).every((c) => c.col >= 0 && c.col <= 2)).toBe(true);
  });
});

describe('published SRS wall-kick tables', () => {
  it('J/L/S/T/Z use the JLSTZ table', () => {
    const jlstz = [
      [0, 0],
      [-1, 0],
      [-1, 1],
      [0, -2],
      [-1, -2],
    ];
    expect(getKickTests('T', 0, 1)).toEqual(jlstz);
    expect(getKickTests('J', 0, 1)).toEqual(jlstz);
    expect(getKickTests('S', 0, 1)).toEqual(jlstz);
  });

  it('the I tetromino uses its own dedicated table', () => {
    expect(getKickTests('I', 0, 1)).toEqual([
      [0, 0],
      [-2, 0],
      [1, 0],
      [-2, -1],
      [1, 2],
    ]);
    // The I's first non-zero test differs from the JLSTZ's.
    expect(getKickTests('I', 0, 1)[1]).not.toEqual(getKickTests('T', 0, 1)[1]);
  });

  it('the O tetromino rotates entirely in place', () => {
    expect(getKickTests('O', 0, 1)).toEqual([[0, 0]]);
    expect(getKickTests('O', 2, 3)).toEqual([[0, 0]]);
  });

  it('inverse transitions are exact negations (round-trip consistency)', () => {
    const transitions: Array<[RotationState, RotationState]> = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ];
    for (const type of ['T', 'S', 'Z', 'J', 'L', 'I'] as TetrominoType[]) {
      for (const [from, to] of transitions) {
        const fwd = getKickTests(type, from, to);
        const back = getKickTests(type, to, from);
        // `+ 0` normalizes -0 to +0 for the comparison.
        expect(back.map(([dx, dy]) => [-dx + 0, -dy + 0])).toEqual(fwd);
      }
    }
  });

  it('cycles rotation states correctly in both directions', () => {
    expect(nextRotationState(3, 'cw')).toBe(0);
    expect(nextRotationState(0, 'ccw')).toBe(3);
    expect(nextRotationState(1, 'ccw')).toBe(0);
    expect(nextRotationState(1, 'cw')).toBe(2);
  });
});

describe('tryRotate behavior', () => {
  it('rotates freely in open space and round-trips exactly (CW then CCW)', () => {
    const board = createBoard();
    for (const type of ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as TetrominoType[]) {
      for (const rotation of [0, 1, 2, 3] as RotationState[]) {
        const piece: Piece = { type, rotation, x: 3, y: 8 };
        const cw = tryRotate(board, piece, 'cw');
        expect(cw).not.toBeNull();
        assertValid(board, cw!);
        const back = tryRotate(board, cw!, 'ccw');
        expect(back).toEqual(piece);
      }
    }
  });

  it('pieces flush against the outer walls rotate without clipping', () => {
    const board = createBoard();
    const left: Piece = { type: 'T', rotation: 0, x: 0, y: 10 };
    const right: Piece = { type: 'S', rotation: 0, x: 7, y: 10 };
    const lcw = tryRotate(board, left, 'cw');
    const lccw = tryRotate(board, left, 'ccw');
    const rcw = tryRotate(board, right, 'cw');
    const rccw = tryRotate(board, right, 'ccw');
    expect(lcw).not.toBeNull();
    expect(lccw).not.toBeNull();
    expect(rcw).not.toBeNull();
    expect(rccw).not.toBeNull();
    for (const result of [lcw, lccw, rcw, rccw]) assertValid(board, result!);
  });

  it('the J piece uses the (-1,+1) floor kick to rotate on the floor', () => {
    const board = createBoard();
    // J spawn state at y=22 sits on the floor (lowest cells at row 23);
    // its CW orientation would extend to row 24 unless the kick lifts it.
    const piece: Piece = { type: 'J', rotation: 0, x: 3, y: 22 };
    const result = tryRotate(board, piece, 'cw');
    expect(result).not.toBeNull();
    expect(result!.rotation).toBe(1);
    expect(result!.x).toBe(2);
    expect(result!.y).toBe(21);
    assertValid(board, result!);
  });

  it('the I tetromino uses its own kick table against a stack', () => {
    const board = createBoard();
    // I spawn bar at row 13, cols 3-6. CW goes vertical at col 3.
    // Block col 3 (all kick tests would need it) and col 2 (the JLSTZ
    // table's first nonzero test), leaving col 1 clear for the I table's
    // (-2,0) test.
    const blocks = [
      [10, 3],
      [11, 3],
      [12, 3],
      [10, 2],
      [11, 2],
      [12, 2],
    ];
    for (const [row, col] of blocks) {
      board[row][col] = 'Z';
    }
    const piece: Piece = { type: 'I', rotation: 0, x: 3, y: 10 };
    const result = tryRotate(board, piece, 'cw');
    expect(result).not.toBeNull();
    expect(result!.rotation).toBe(1);
    expect(result!.x).toBe(1);
    expect(result!.y).toBe(10);
    assertValid(board, result!);
  });

  it('the O tetromino stays in place through all rotations', () => {
    const board = createBoard();
    const piece: Piece = { type: 'O', rotation: 0, x: 4, y: 10 };
    const r1 = tryRotate(board, piece, 'cw')!;
    const r2 = tryRotate(board, r1, 'cw')!;
    const r3 = tryRotate(board, r2, 'cw')!;
    expect(r1.x).toBe(4);
    expect(r1.y).toBe(10);
    expect(r2.x).toBe(4);
    expect(r3.y).toBe(10);
    expect(pieceCells(r3)).toEqual(pieceCells(piece));
  });

  it('returns null and leaves the piece unchanged when every kick is blocked', () => {
    const board = createBoard();
    // Four solid rows block every test of the T 0->1 table.
    for (let r = 9; r <= 12; r++) {
      for (let c = 0; c < 10; c++) board[r][c] = 'L';
    }
    const piece: Piece = { type: 'T', rotation: 0, x: 3, y: 10 };
    const result = tryRotate(board, piece, 'cw');
    expect(result).toBeNull();
    // The board is untouched by a failed rotation.
    expect(board[9].every((c) => c === 'L')).toBe(true);
  });

  it('never clips when rotating beside arbitrary stacks', () => {
    const board = createBoard();
    const wall: Array<[number, number]> = [];
    for (let r = 6; r < 16; r++) wall.push([r, 6]);
    for (const [row, col] of wall) board[row][col] = 'O';
    const piece: Piece = { type: 'S', rotation: 0, x: 3, y: 8 };
    const result = tryRotate(board, piece, 'cw');
    if (result) assertValid(board, result);
    const back = tryRotate(board, result ?? piece, 'ccw');
    if (back) assertValid(board, back);
  });

  it('spawnPiece produces the guideline spawn placement', () => {
    const I = spawnPiece('I');
    const T = spawnPiece('T');
    expect(I.x).toBe(3);
    expect(I.y).toBe(0);
    expect(T.x).toBe(3);
    expect(T.y).toBe(0);
    expect(pieceCells(I)).toEqual([
      { row: 3, col: 3 },
      { row: 3, col: 4 },
      { row: 3, col: 5 },
      { row: 3, col: 6 },
    ]);
  });

  it('pending merge helper keeps lock cells intact', () => {
    const board = createBoard();
    const merged = merge(board, [{ row: 5, col: 5 }], 'T');
    expect(merged[5][5]).toBe('T');
  });
});