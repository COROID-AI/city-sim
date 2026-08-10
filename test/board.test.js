import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoard,
  collides,
  lockPiece,
  getFullRows,
  clearLines,
  getDropCells,
} from '../src/board.js';

test('createBoard builds an all-empty 10x20 field', () => {
  const board = createBoard();
  assert.equal(board.length, 20);
  assert.equal(board[0].length, 10);
  for (const row of board) assert.ok(row.every((cell) => cell === 0));
});

test('collides detects walls, floor and locked cells', () => {
  const board = createBoard();
  assert.equal(collides(board, [[0, 0]]), false);
  assert.equal(collides(board, [[-1, 0]]), true);
  assert.equal(collides(board, [[10, 0]]), true);
  assert.equal(collides(board, [[0, 20]]), true);
  board[5][3] = 'T';
  assert.equal(collides(board, [[3, 5]]), true);
  assert.equal(collides(board, [[4, 5]]), false);
});

test('lockPiece writes cells and leaves the original board untouched', () => {
  const board = createBoard();
  const next = lockPiece(board, [[2, 1], [3, 1], [4, 1]], 'I');
  assert.equal(board[1][2], 0);
  assert.equal(next[1][2], 'I');
  assert.equal(next[1][3], 'I');
  assert.equal(next[1][4], 'I');
  // Returns a copy, not a mutation.
  assert.notEqual(next, board);
});

test('getFullRows returns indices of completely filled rows', () => {
  const board = createBoard();
  fillRow(board, 4);
  fillRow(board, 9);
  assert.deepEqual(getFullRows(board), [4, 9]);
});

test('clearLines clears a single line, shifts the stack down and prepends empty rows', () => {
  const board = createBoard();
  board[2][0] = 'J'; // sentinel above the cleared row
  fillRow(board, 3);
  const { board: next, cleared } = clearLines(board, [3]);
  assert.equal(cleared, 1);
  // The sentinel row moved down to row 3.
  assert.equal(next[3][0], 'J');
  assert.equal(next[2][0], 0);
  assert.ok(next[2].every((cell) => cell === 0));
  assert.equal(next.length, 20);
});

test('clearLines handles double, triple and tetris clears with correct counts', () => {
  for (const count of [2, 3, 4]) {
    const board = createBoard();
    const full = [];
    for (let i = 0; i < count; i++) {
      fillRow(board, 18 - i);
      full.push(18 - i);
    }
    const { cleared } = clearLines(board, full);
    assert.equal(cleared, count);
  }
});

test('clearLines with no full rows returns the same board and zero count', () => {
  const board = createBoard();
  board[0][0] = 'L';
  const { board: next, cleared } = clearLines(board, []);
  assert.equal(cleared, 0);
  assert.equal(next[0][0], 'L');
});

test('getDropCells returns the deepest valid position (ghost)', () => {
  const board = createBoard();
  const cells = [[3, 0], [4, 0], [5, 0]];
  assert.deepEqual(getDropCells(board, cells), [[3, 19], [4, 19], [5, 19]]);

  board[19][4] = 'O';
  assert.deepEqual(getDropCells(board, cells), [[3, 18], [4, 18], [5, 18]]);
});

function fillRow(board, y, type = 'J') {
  for (let x = 0; x < board[y].length; x++) board[y][x] = type;
}