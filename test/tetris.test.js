'use strict';

const test = require('node:test');
const assert = require('node:assert');

const Tetris = require('../tetris.js');

const { COLS, ROWS, SHAPES, KEYS } = Tetris;

// Deterministic RNG so bag order and spawns are reproducible in tests.
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function piece(key, x, y, rot) {
  return {
    key,
    matrix: SHAPES[key].rotations[rot || 0],
    x,
    y,
    rot: rot || 0
  };
}

test('createGrid builds an empty 20x10 grid', () => {
  const grid = Tetris.createGrid(ROWS, COLS);
  assert.strictEqual(grid.length, 20);
  assert.strictEqual(grid[0].length, 10);
  assert.ok(grid.every((row) => row.every((c) => c === null)));
});

test('rotateCW rotates a square matrix clockwise', () => {
  assert.deepStrictEqual(Tetris.rotateCW([[1, 0], [0, 0]]), [[0, 1], [0, 0]]);
  // 4x CW rotations return to the original matrix.
  let m = [[1, 0], [1, 0]];
  for (let i = 0; i < 4; i++) m = Tetris.rotateCW(m);
  assert.deepStrictEqual(m, [[1, 0], [1, 0]]);
});

test('all 7 tetrominoes exist with distinct rotation-state handling', () => {
  assert.strictEqual(KEYS.length, 7);
  assert.deepStrictEqual(KEYS.slice().sort(), ['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
  // O is a 2x2 square: exactly one rotation state (rotation is a safe no-op).
  assert.strictEqual(SHAPES.O.rotations.length, 1);
  assert.deepStrictEqual(SHAPES.O.rotations[0], [[1, 1], [1, 1]]);
  // I uses a 4x4 box: 4 states, each the CW rotation of the previous one.
  assert.strictEqual(SHAPES.I.rotations.length, 4);
  assert.deepStrictEqual(
    Tetris.rotateCW(SHAPES.I.rotations[0]),
    SHAPES.I.rotations[1]
  );
  assert.deepStrictEqual(
    Tetris.rotateCW(SHAPES.I.rotations[1]),
    SHAPES.I.rotations[2]
  );
  assert.deepStrictEqual(
    Tetris.rotateCW(SHAPES.I.rotations[2]),
    SHAPES.I.rotations[3]
  );
  assert.deepStrictEqual(
    Tetris.rotateCW(SHAPES.I.rotations[3]),
    SHAPES.I.rotations[0]
  );
  // The vertical states fill column 2, then column 1 after another CW turn.
  assert.deepStrictEqual(SHAPES.I.rotations[1], [
    [0, 0, 1, 0],
    [0, 0, 1, 0],
    [0, 0, 1, 0],
    [0, 0, 1, 0]
  ]);
  // Every other shape has 4 states and every state is square.
  ['T', 'S', 'Z', 'J', 'L'].forEach((key) => {
    assert.strictEqual(SHAPES[key].rotations.length, 4);
    SHAPES[key].rotations.forEach((m) => {
      assert.strictEqual(m.length, m[0].length);
    });
  });
  // Distinct colors.
  const colors = KEYS.map((k) => SHAPES[k].color);
  assert.strictEqual(new Set(colors).size, 7);
});

test('collides detects walls, floor, and stacked cells', () => {
  const grid = Tetris.createGrid(ROWS, COLS);
  const t = piece('T', 3, 5);
  assert.strictEqual(Tetris.collides(grid, t), false);
  // Left wall.
  assert.strictEqual(Tetris.collides(grid, piece('T', -1, 5)), true);
  // Right wall (row 1 spans cols x..x+2; x=8 reaches col 10).
  assert.strictEqual(Tetris.collides(grid, piece('T', 8, 5)), true);
  // Floor (bottom filled row of T would land at row 20).
  assert.strictEqual(Tetris.collides(grid, piece('T', 3, 19)), true);
  // Occupied cell under the piece's top row.
  grid[5][4] = 'X';
  assert.strictEqual(Tetris.collides(grid, t), true);
});

test('merge stamps the piece key into a copy of the grid', () => {
  const grid = Tetris.createGrid(ROWS, COLS);
  const merged = Tetris.merge(grid, piece('T', 3, 5));
  assert.strictEqual(merged[5][4], 'T');
  assert.strictEqual(merged[6][3], 'T');
  assert.strictEqual(merged[6][5], 'T');
  // The original grid is untouched.
  assert.strictEqual(grid[5][4], null);
  assert.strictEqual(grid[6][3], null);
});

test('clearLines removes a single full row and shifts rows down', () => {
  const grid = Tetris.createGrid(ROWS, COLS);
  grid[18][0] = 'L';
  for (let x = 0; x < COLS; x++) grid[19][x] = 'L';
  const result = Tetris.clearLines(grid);
  assert.strictEqual(result.cleared, 1);
  assert.strictEqual(result.grid[19][0], 'L');
  assert.strictEqual(result.grid[18][0], null);
});

test('clearLines removes multiple rows (tetris)', () => {
  const grid = Tetris.createGrid(ROWS, COLS);
  for (let y = 16; y < 20; y++) {
    for (let x = 0; x < COLS; x++) grid[y][x] = 'S';
  }
  const result = Tetris.clearLines(grid);
  assert.strictEqual(result.cleared, 4);
  assert.ok(result.grid.every((row) => row.every((c) => c === null)));
});

test('tryMove is blocked at walls and the floor', () => {
  const game = Tetris.createGame(makeRng(1));
  game.piece = piece('T', 0, 5);
  assert.strictEqual(Tetris.tryMove(game, -1, 0), false);
  assert.strictEqual(game.piece.x, 0);

  game.piece = piece('T', 7, 5);
  assert.strictEqual(Tetris.tryMove(game, 1, 0), false);
  assert.strictEqual(game.piece.x, 7);

  game.piece = piece('T', 3, 18);
  assert.strictEqual(Tetris.tryMove(game, 0, 1), false);
  assert.strictEqual(game.piece.y, 18);
});

test('rotation cycles T through 4 states and back', () => {
  const game = Tetris.createGame(makeRng(1));
  game.grid = Tetris.createGrid(ROWS, COLS);
  game.piece = piece('T', 3, 10, 0);
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(Tetris.tryRotate(game, 1), true);
  }
  assert.strictEqual(game.piece.rot, 0);
  assert.deepStrictEqual(game.piece.matrix, SHAPES.T.rotations[0]);
});

test('rotating the O piece is a safe no-op', () => {
  const game = Tetris.createGame(makeRng(1));
  game.grid = Tetris.createGrid(ROWS, COLS);
  game.piece = piece('O', 4, 5, 0);
  const before = JSON.stringify(game.piece);
  assert.strictEqual(Tetris.tryRotate(game, 1), false);
  assert.strictEqual(JSON.stringify(game.piece), before);
  assert.strictEqual(Tetris.collides(game.grid, game.piece), false);
});

test('I piece rotation near the floor uses a vertical kick', () => {
  const game = Tetris.createGame(makeRng(1));
  game.grid = Tetris.createGrid(ROWS, COLS);
  // Horizontal I; its filled row sits at grid row 18.
  game.piece = piece('I', 3, 17, 0);
  assert.strictEqual(Tetris.tryRotate(game, 1), true);
  // Vertical I would occupy rows 17..20; the kick moves it up to 16.
  assert.strictEqual(game.piece.y, 16);
  assert.strictEqual(game.piece.rot, 1);
  assert.strictEqual(Tetris.collides(game.grid, game.piece), false);
});

test('rotating near the right wall keeps pieces in bounds', () => {
  const game = Tetris.createGame(makeRng(1));
  game.grid = Tetris.createGrid(ROWS, COLS);
  game.piece = piece('J', 7, 5, 0); // spans cols 7..9
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(Tetris.tryRotate(game, 1), true);
    assert.ok(game.piece.x >= 0 && game.piece.x + 3 <= COLS);
    assert.strictEqual(Tetris.collides(game.grid, game.piece), false);
  }
  // I at its spawn column stays in bounds through all 4 rotations too.
  game.piece = piece('I', 3, 5, 0);
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(Tetris.tryRotate(game, 1), true);
    assert.strictEqual(Tetris.collides(game.grid, game.piece), false);
  }
});

test('rotation is rejected when every candidate collides', () => {
  const game = Tetris.createGame(makeRng(1));
  game.grid = Tetris.createGrid(ROWS, COLS);
  game.piece = piece('T', 3, 5, 0);
  // Block the rows that every rotated/kicked candidate could reach, while
  // leaving the piece's own four cells free so it starts in a valid spot.
  for (let x = 3; x <= 5; x++) game.grid[4][x] = 'X';
  for (let x = 2; x <= 6; x++) game.grid[7][x] = 'X';
  assert.strictEqual(Tetris.collides(game.grid, game.piece), false);
  const before = JSON.stringify(game.piece);
  assert.strictEqual(Tetris.tryRotate(game, 1), false);
  assert.strictEqual(JSON.stringify(game.piece), before);
});

test('scoring and leveling follow the standard table', () => {
  assert.deepStrictEqual(Tetris.LINE_SCORES, [0, 100, 300, 500, 800]);
  assert.strictEqual(Tetris.levelForLines(0), 1);
  assert.strictEqual(Tetris.levelForLines(9), 1);
  assert.strictEqual(Tetris.levelForLines(10), 2);
  assert.strictEqual(Tetris.levelForLines(24), 3);
});

test('clearing one line adds 100 x level and updates lines', () => {
  const game = Tetris.createGame(makeRng(1));
  game.gameOver = false;
  game.grid = Tetris.createGrid(ROWS, COLS);
  for (let x = 4; x < COLS; x++) game.grid[19][x] = 'T';
  // Horizontal I at y=18 fills grid row 19, cols 0..3 -> row 19 completes.
  game.piece = piece('I', 0, 18, 0);
  const cleared = Tetris.lockPiece(game);
  assert.strictEqual(cleared, 1);
  assert.strictEqual(game.lines, 1);
  assert.strictEqual(game.level, 1);
  assert.strictEqual(game.score, 100);
});

test('clearing two lines adds 300 x level', () => {
  const game = Tetris.createGame(makeRng(1));
  game.gameOver = false;
  game.grid = Tetris.createGrid(ROWS, COLS);
  for (let x = 0; x < COLS; x++) game.grid[18][x] = 'O';
  for (let x = 4; x < COLS; x++) game.grid[19][x] = 'T';
  game.piece = piece('I', 0, 18, 0);
  const cleared = Tetris.lockPiece(game);
  assert.strictEqual(cleared, 2);
  assert.strictEqual(game.score, 300);
  assert.strictEqual(game.lines, 2);
});

test('level rises after 10 lines; score uses the pre-clear level', () => {
  const game = Tetris.createGame(makeRng(1));
  game.gameOver = false;
  game.grid = Tetris.createGrid(ROWS, COLS);
  game.lines = 9; // level 1; clearing one more line crosses 10
  for (let x = 4; x < COLS; x++) game.grid[19][x] = 'T';
  game.piece = piece('I', 0, 18, 0);
  Tetris.lockPiece(game);
  assert.strictEqual(game.lines, 10);
  assert.strictEqual(game.level, 2);
  assert.strictEqual(game.score, 100); // 100 x level 1
});

test('gravity interval shrinks as the level rises', () => {
  assert.ok(Tetris.getGravityMs(1) > Tetris.getGravityMs(5));
  assert.ok(Tetris.getGravityMs(5) > Tetris.getGravityMs(10));
  assert.ok(Tetris.getGravityMs(99) >= 80); // floored
});

test('getGhostY reports the hard-drop landing row', () => {
  const game = Tetris.createGame(makeRng(1));
  game.grid = Tetris.createGrid(ROWS, COLS);
  game.piece = piece('T', 3, 0, 0);
  const ghostY = Tetris.getGhostY(game);
  assert.strictEqual(ghostY, 18); // bottom filled row of T would reach 19
  // One row further down collides.
  assert.strictEqual(
    Tetris.collides(game.grid, piece('T', 3, ghostY + 1, 0)),
    true
  );
});

test('hardDrop locks the piece and spawns the next one', () => {
  const game = Tetris.createGame(makeRng(1));
  game.gameOver = false;
  game.grid = Tetris.createGrid(ROWS, COLS);
  game.piece = piece('T', 3, 0, 0);
  const distance = Tetris.hardDrop(game);
  assert.strictEqual(distance, 18);
  assert.strictEqual(game.grid[19][4], 'T');
  assert.strictEqual(game.grid[19][3], 'T');
  assert.ok(KEYS.includes(game.piece.key)); // next piece spawned
  assert.strictEqual(game.gameOver, false);
});

test('game over is detected when a spawn immediately collides', () => {
  const game = Tetris.createGame(makeRng(1));
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) game.grid[y][x] = 'X';
  }
  game.next = 'T';
  Tetris.spawn(game);
  assert.strictEqual(game.gameOver, true);
});

test('the 7-bag deals all seven tetrominoes per cycle', () => {
  const game = Tetris.createGame(makeRng(42));
  const seen = new Set();
  for (let i = 0; i < 7; i++) {
    seen.add(game.piece.key);
    Tetris.spawn(game);
  }
  assert.strictEqual(seen.size, 7);
});