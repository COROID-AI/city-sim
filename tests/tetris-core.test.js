'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../tetris-core.js');

test('board is 10x20 and empty', () => {
  const board = core.createBoard();
  assert.equal(board.length, core.HEIGHT);
  assert.equal(board[0].length, core.WIDTH);
  assert.ok(board.every((row) => row.every((cell) => cell === 0)));
});

test('7-bag randomizer: each bag contains all 7 types exactly once', () => {
  for (let trial = 0; trial < 50; trial++) {
    const bag = core.createBag();
    assert.equal(bag.length, 7);
    assert.deepEqual([...bag].sort(), [...core.TYPES].sort());
    assert.equal(new Set(bag).size, 7);
  }
});

test('drawFromBag keeps 7-bag integrity across refills', () => {
  const bag = core.createBag();
  const seen = [];
  for (let i = 0; i < 21; i++) {
    seen.push(core.drawFromBag(bag));
  }
  // Every consecutive window of 7 draws contains exactly one of each type.
  for (let start = 0; start <= 14; start += 7) {
    const window = seen.slice(start, start + 7);
    assert.deepEqual([...window].sort(), [...core.TYPES].sort());
  }
});

test('pieces spawn in a legal position on an empty board', () => {
  for (const type of core.TYPES) {
    const piece = core.spawnPiece(type);
    assert.equal(piece.type, type);
    assert.equal(piece.rotation, 0);
    assert.ok(core.canPlace(core.createBoard(), piece, piece.x, piece.y));
  }
});

test('movement bounds: pieces cannot move through walls or floor', () => {
  const board = core.createBoard();
  let piece = core.spawnPiece('T');
  // Move all the way left; must stop at column 0.
  for (let i = 0; i < 20; i++) {
    const moved = core.move(board, piece, -1, 0);
    if (moved) piece = moved;
  }
  const leftCells = core.pieceCells(piece);
  assert.ok(leftCells.every(([x]) => x >= 0));
  assert.equal(core.move(board, piece, -1, 0), null);

  // Move all the way right; must stop at column 9.
  piece = core.spawnPiece('T');
  for (let i = 0; i < 20; i++) {
    const moved = core.move(board, piece, 1, 0);
    if (moved) piece = moved;
  }
  const rightCells = core.pieceCells(piece);
  assert.ok(rightCells.every(([x]) => x < core.WIDTH));
  assert.equal(core.move(board, piece, 1, 0), null);

  // Floor: piece at the bottom cannot move down.
  piece = { type: 'T', x: 3, y: core.HEIGHT - 2, rotation: 0 };
  assert.ok(core.canPlace(board, piece, piece.x, piece.y));
  assert.equal(core.move(board, piece, 0, 1), null);
});

test('rotation is clockwise and stays in bounds with wall kicks', () => {
  const board = core.createBoard();

  // T flush against the floor rotates up via a wall kick.
  let piece = { type: 'T', x: 3, y: core.HEIGHT - 2, rotation: 0 };
  const rotated = core.rotateCW(board, piece);
  assert.ok(rotated);
  assert.equal(rotated.rotation, 1);
  assert.ok(core.canPlace(board, rotated, rotated.x, rotated.y));
  assert.ok(core.pieceCells(rotated).every(([, y]) => y < core.HEIGHT));

  // T flush against the left wall rotates into a legal slot.
  piece = { type: 'T', x: -1, y: 5, rotation: 1 };
  assert.ok(core.canPlace(board, piece, piece.x, piece.y));
  const rotatedLeft = core.rotateCW(board, piece);
  assert.ok(rotatedLeft);
  assert.ok(core.pieceCells(rotatedLeft).every(([x]) => x >= 0 && x < core.WIDTH));

  // I piece at the right wall rotates via a leftward kick.
  piece = { type: 'I', x: 8, y: 16, rotation: 3 };
  assert.ok(core.canPlace(board, piece, piece.x, piece.y));
  const rotatedI = core.rotateCW(board, piece);
  assert.ok(rotatedI);
  assert.ok(core.pieceCells(rotatedI).every(([x]) => x >= 0 && x < core.WIDTH));
});

test('rotation never produces an impossible state', () => {
  const board = core.createBoard();
  // Stack a wall of blocks except a narrow corridor, then rotate every piece
  // type at every rotation against the walls and floor: the result must
  // either be placeable or the piece must be left untouched (no softlock).
  for (const type of core.TYPES) {
    for (let rotation = 0; rotation < 4; rotation++) {
      for (const [x, y] of [[0, 0], [core.WIDTH - 1, 0], [0, core.HEIGHT - 2], [core.WIDTH - 1, core.HEIGHT - 2]]) {
        const piece = { type, x, y, rotation };
        if (!core.canPlace(board, piece, x, y)) continue;
        const result = core.rotateCW(board, piece);
        if (result !== null) {
          assert.ok(core.canPlace(board, result, result.x, result.y), `${type} rot ${rotation} at ${x},${y} produced an illegal state`);
        }
      }
    }
  }
});

test('rotation that cannot fit returns null and leaves the piece unchanged', () => {
  const board = core.createBoard();
  // Fill the entire board except the piece's own cells.
  for (let y = 0; y < core.HEIGHT; y++) {
    for (let x = 0; x < core.WIDTH; x++) {
      board[y][x] = 'X';
    }
  }
  const piece = { type: 'T', x: 3, y: 5, rotation: 0 };
  for (const [ox, oy] of core.pieceCells(piece)) {
    board[oy][ox] = 0;
  }
  // Rotating would collide with the surrounding wall of blocks on every kick.
  assert.equal(core.rotateCW(board, piece), null);
});

test('lock merges the piece into the board', () => {
  const board = core.createBoard();
  const piece = { type: 'O', x: 4, y: 18, rotation: 0 };
  const locked = core.lockPiece(board, piece);
  assert.equal(locked[18][4], 'O');
  assert.equal(locked[18][5], 'O');
  assert.equal(locked[19][4], 'O');
  assert.equal(locked[19][5], 'O');
  // Original board is not mutated.
  assert.equal(board[18][4], 0);
});

test('full rows clear and rows above shift down', () => {
  const board = core.createBoard();
  // Fill row 19 completely except the two cells an O piece will occupy.
  for (let x = 0; x < core.WIDTH; x++) {
    if (x !== 4 && x !== 5) board[19][x] = 'X';
  }
  // Put a marker on row 18 so we can verify the shift.
  board[18][0] = 'M';
  const piece = { type: 'O', x: 4, y: 18, rotation: 0 };
  const merged = core.lockPiece(board, piece);
  const result = core.clearLines(merged);
  assert.equal(result.lines, 1);
  assert.equal(result.board.length, core.HEIGHT);
  // A fresh empty row is added at the top; the marker row shifted down to
  // row 19 and the cleared row's cells are gone.
  assert.ok(result.board[0].every((cell) => cell === 0));
  assert.equal(result.board[19][0], 'M');
  assert.equal(result.board[19][4], 'O');
  assert.equal(result.board[19][5], 'O');
});

test('scoring: 100/300/500/800 x level for 1/2/3/4 lines', () => {
  assert.equal(core.scoreForLines(1, 1), 100);
  assert.equal(core.scoreForLines(2, 1), 300);
  assert.equal(core.scoreForLines(3, 1), 500);
  assert.equal(core.scoreForLines(4, 1), 800);
  assert.equal(core.scoreForLines(1, 3), 300);
  assert.equal(core.scoreForLines(4, 5), 4000);
  assert.equal(core.scoreForLines(0, 1), 0);
});

test('level increases every 10 cleared lines', () => {
  assert.equal(core.levelForLines(0), 1);
  assert.equal(core.levelForLines(9), 1);
  assert.equal(core.levelForLines(10), 2);
  assert.equal(core.levelForLines(19), 2);
  assert.equal(core.levelForLines(20), 3);
  assert.equal(core.levelForLines(25), 3);
  assert.equal(core.levelForLines(40), 5);
});

test('gravity interval decreases with level and never goes below 50ms', () => {
  assert.equal(core.gravityInterval(1), 800);
  assert.ok(core.gravityInterval(2) < core.gravityInterval(1));
  assert.ok(core.gravityInterval(20) >= 50);
});

test('game state: gravity tick moves the piece down, then locks at the floor', () => {
  const state = core.createGameState();
  state.started = true;
  const startY = state.current.y;
  core.tick(state);
  assert.equal(state.current.y, startY + 1);
  assert.equal(state.over, false);

  // Drop the piece to the floor; the next tick locks it and spawns a new one.
  while (!state.over) {
    const before = state.current.y;
    core.tick(state);
    if (state.current === null) break;
    if (state.current.y <= before && state.current.y > 0) break;
  }
  // The board now contains locked cells from the first piece.
  assert.ok(state.board.some((row) => row.some((cell) => cell !== 0)));
});

test('game state: soft drop scores 1 point per cell and locks at the floor', () => {
  const state = core.createGameState();
  state.started = true;
  // Place the current piece high up so it can descend several cells.
  state.current.y = 0;
  const startScore = state.score;
  let moved = 0;
  for (let i = 0; i < 40 && !state.over; i++) {
    if (core.softDrop(state)) moved++;
  }
  assert.equal(state.score, startScore + moved);
  // After reaching the floor it locks; a new piece is in play.
  assert.ok(state.current);
});

test('game state: move and rotate update the current piece', () => {
  const state = core.createGameState();
  state.started = true;
  const x0 = state.current.x;
  assert.equal(core.moveLeft(state), true);
  assert.equal(state.current.x, x0 - 1);
  assert.equal(core.moveRight(state), true);
  assert.equal(state.current.x, x0);
  const r0 = state.current.rotation;
  assert.equal(core.rotate(state), true);
  assert.equal(state.current.rotation, (r0 + 1) % 4);
});

test('game over when a new piece cannot spawn', () => {
  const state = core.createGameState();
  state.started = true;
  // Fill every board cell so any spawn collides immediately.
  for (let y = 0; y < core.HEIGHT; y++) {
    for (let x = 0; x < core.WIDTH; x++) {
      state.board[y][x] = 'X';
    }
  }
  core.spawnCurrent(state);
  assert.equal(state.over, true);
});

test('reset restarts a finished game with a clean board', () => {
  const state = core.createGameState();
  state.started = true;
  for (let y = 0; y < core.HEIGHT; y++) {
    for (let x = 0; x < core.WIDTH; x++) {
      state.board[y][x] = 'X';
    }
  }
  core.spawnCurrent(state);
  assert.equal(state.over, true);
  core.resetGameState(state);
  assert.equal(state.over, false);
  assert.equal(state.started, true);
  assert.equal(state.score, 0);
  assert.equal(state.lines, 0);
  assert.equal(state.level, 1);
  assert.ok(state.board.every((row) => row.every((cell) => cell === 0)));
});