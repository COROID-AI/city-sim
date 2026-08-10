import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { createBoard } from '../src/board.js';
import { gravityMs, PIECE_TYPES } from '../src/constants.js';

// --- Setup helpers ----------------------------------------------------------

function newRunningGame() {
  const game = new Game();
  assert.equal(game.start(), true);
  return game;
}

function fillRow(board, y, type = 'J') {
  for (let x = 0; x < board[y].length; x++) board[y][x] = type;
}

// Row 18 has gaps at cols 3-6, row 19 is filled at cols 3-6. Dropping a
// horizontal I into the gap completes row 18 -> single line clear.
function singleLineBoard(game) {
  game.board = createBoard();
  const row18 = ['J', 'J', 'J', 0, 0, 0, 0, 'J', 'J', 'J'];
  const row19 = [0, 0, 0, 'J', 'J', 'J', 'J', 0, 0, 0];
  game.board[18] = row18;
  game.board[19] = row19;
  game.active = { type: 'I', x: 3, y: 1, rotation: 0 };
}

// Rows 10-13 are full except col 5; row 14 col 5 is a stopper. A vertical I
// at col 5 completes all four rows -> tetris.
function tetrisBoard(game) {
  game.board = createBoard();
  for (let y = 10; y <= 13; y++) {
    for (let x = 0; x < 10; x++) game.board[y][x] = x === 5 ? 0 : 'J';
  }
  game.board[14][5] = 'J';
  game.active = { type: 'I', x: 3, y: 0, rotation: 1 };
}

// --- Lifecycle --------------------------------------------------------------

test('start begins a running game with zeroed stats and a preview queue', () => {
  const game = newRunningGame();
  assert.equal(game.status, 'running');
  assert.ok(game.active);
  assert.equal(game.cells().length, 4);
  assert.equal(game.score, 0);
  assert.equal(game.lines, 0);
  assert.equal(game.level, 1);
  assert.equal(game.canHold, true);
  const state = game.getState();
  assert.equal(state.next.length, 3);
  for (const type of state.next) assert.ok(PIECE_TYPES.includes(type));
  assert.ok(state.active.ghost.length === 4);
});

test('start is an idempotent restart that resets score and lines', () => {
  const game = newRunningGame();
  game.score = 4000;
  game.lines = 7;
  game.start();
  assert.equal(game.score, 0);
  assert.equal(game.lines, 0);
  assert.equal(game.status, 'running');
});

test('pause/resume/togglePause transition states; gravity step is inert while paused', () => {
  const game = newRunningGame();
  const yBefore = game.active.y;
  game.pause();
  assert.equal(game.status, 'paused');
  assert.equal(game.step(), false);
  assert.equal(game.active.y, yBefore);
  game.resume();
  assert.equal(game.status, 'running');
  game.togglePause();
  assert.equal(game.status, 'paused');
  game.togglePause();
  assert.equal(game.status, 'running');
});

test('game over is detected when the spawn position collides', () => {
  const game = newRunningGame();
  for (let y = 0; y < 20; y++) fillRow(game.board, y);
  game.spawnNext();
  assert.equal(game.status, 'over');
  assert.equal(game.active, null);
  assert.equal(game.getState().status, 'over');
});

// --- Movement ---------------------------------------------------------------

test('moveLeft/moveRight shift the piece and stop at walls', () => {
  const game = newRunningGame();
  game.active = { type: 'T', x: 3, y: 0, rotation: 0 };
  assert.equal(game.moveLeft(), true);
  assert.equal(game.active.x, 2);
  // T spans 3 columns: from x=5 two right moves fit (x=6, x=7), the third
  // would push its rightmost cell to column 10.
  game.active.x = 5;
  assert.equal(game.moveRight(), true);
  assert.equal(game.active.x, 6);
  assert.equal(game.moveRight(), true);
  assert.equal(game.active.x, 7);
  assert.equal(game.moveRight(), false);
  assert.equal(game.active.x, 7);
});

test('softDrop moves down one row and scores 1 point per cell', () => {
  const game = newRunningGame();
  const y0 = game.active.y;
  assert.equal(game.softDrop(), true);
  assert.equal(game.active.y, y0 + 1);
  assert.equal(game.score, 1);
});

test('softDrop at the floor locks the piece and spawns the next one', () => {
  const game = newRunningGame();
  game.active = { type: 'I', x: 3, y: 18, rotation: 0 }; // cells at row 19
  assert.equal(game.softDrop(), false);
  assert.ok(PIECE_TYPES.includes(game.active.type));
  assert.equal(game.status, 'running');
  assert.equal(game.active.y, 0);
});

test('hard drop locks instantly and scores 2 points per dropped cell', () => {
  const game = newRunningGame();
  game.active = { type: 'I', x: 3, y: 1, rotation: 0 }; // cells at row 2
  const ghost = game.ghostCells();
  const dist = ghost[0][1] - 2; // cells start at row 2
  game.hardDrop();
  assert.equal(game.score, dist * 2);
  assert.ok(game.active); // next piece spawned
  assert.equal(game.lines, 0);
  assert.ok(game.board[19].some((cell) => cell !== 0));
});

// --- Rotation & SRS wall kicks ---------------------------------------------

test('four clockwise rotations restore the original cells', () => {
  const game = newRunningGame();
  game.active = { type: 'T', x: 3, y: 0, rotation: 0 };
  const original = game.cells().map((c) => [...c]);
  for (let i = 0; i < 4; i++) game.rotateCW();
  assert.deepEqual(game.cells(), original);
});

test('I piece kicks up against the floor via canonical SRS offset (-2,-1)', () => {
  const game = newRunningGame();
  game.active = { type: 'I', x: 3, y: 0, rotation: 0 };
  for (let i = 0; i < 17; i++) game.softDrop(); // cells at rows 17-18, score 17
  assert.equal(game.active.y, 17);
  assert.equal(game.score, 17);
  // Vertical I needs rows y..y+3; the flat state at y=17 overflows, so SRS
  // test 4 (0->R: -2,-1) applies: up 1, left 2 -> x=1, y=16.
  assert.equal(game.rotateCW(), true);
  assert.equal(game.active.rotation, 1);
  assert.equal(game.active.y, 16);
  assert.equal(game.active.x, 1);
});

test('T piece kicks left when rotating CCW into a wider state at the right wall', () => {
  const game = newRunningGame();
  game.active = { type: 'T', x: 3, y: 0, rotation: 0 };
  game.rotateCCW(); // state L
  assert.equal(game.active.rotation, 3);
  for (let i = 0; i < 5; i++) game.moveRight();
  assert.equal(game.active.x, 8);
  assert.equal(game.rotateCCW(), true);
  assert.equal(game.active.rotation, 2);
  assert.equal(game.active.x, 7); // kicked left by (-1, 0)
});

test('rotation refuses when no wall kick fits (piece boxed in)', () => {
  const game = newRunningGame();
  // T in R state at the right wall (cols 8-9). Rotating R->2 (180°) would put
  // its 3-wide span at cols 7-9; the foot cell (8,y+2) is blocked and the
  // vertical kicks clash with stacked blocks, so every SRS offset must fail.
  game.active = { type: 'T', x: 7, y: 6, rotation: 1 };
  game.board[7][8] = 'J'; // blocks basic offset: 180° foot at (8, 7)
  game.board[9][7] = 'J'; // blocks kick (0, 2): 180° foot at (7, 9)
  const rotationBefore = game.active.rotation;
  assert.equal(game.rotateCW(), false);
  assert.equal(game.active.rotation, rotationBefore);
  assert.equal(game.active.x, 7);
  assert.equal(game.active.y, 6);
});

test('O piece never rotates', () => {
  const game = newRunningGame();
  game.active = { type: 'O', x: 4, y: 0, rotation: 0 };
  const original = game.cells().map((c) => [...c]);
  assert.equal(game.rotateCW(), false);
  assert.equal(game.rotateCCW(), false);
  assert.deepEqual(game.cells(), original);
});

// --- Scoring, lines, level --------------------------------------------------

test('single line clear scores 100 x level plus hard-drop bonus', () => {
  const game = newRunningGame();
  singleLineBoard(game);
  game.hardDrop();
  assert.equal(game.lines, 1);
  assert.equal(game.level, 1);
  assert.equal(game.score, 100 + 2 * 16);
  assert.ok(game.board[18].every((cell) => cell === 0));
});

test('line score is multiplied by the current level', () => {
  const game = newRunningGame();
  game.lines = 10;
  game.level = 2;
  singleLineBoard(game);
  game.hardDrop();
  assert.equal(game.score, 200 + 2 * 16);
  assert.equal(game.lines, 11);
  assert.equal(game.level, 2);
});

test('tetris scores 800 x level plus hard-drop bonus', () => {
  const game = newRunningGame();
  tetrisBoard(game);
  game.hardDrop();
  assert.equal(game.lines, 4);
  assert.equal(game.score, 800 + 2 * 10);
  assert.equal(game.level, 1);
});

test('level increases every 10 lines', () => {
  const game = newRunningGame();
  assert.equal(game.level, 1);
  game.lines = 9;
  singleLineBoard(game);
  game.hardDrop();
  assert.equal(game.lines, 10);
  assert.equal(game.level, 2);
});

test('gravity visibly increases with level', () => {
  assert.equal(gravityMs(1), 1000);
  assert.ok(gravityMs(2) < gravityMs(1));
  assert.ok(gravityMs(5) < gravityMs(2));
  const sequence = [];
  for (let l = 1; l <= 10; l++) sequence.push(gravityMs(l));
  for (let i = 1; i < sequence.length; i++) {
    assert.ok(sequence[i] <= sequence[i - 1], `level ${i + 1} not faster`);
  }
});

// --- Hold -------------------------------------------------------------------

test('hold locks immediately, re-enables after the next spawn, and swaps', () => {
  const game = newRunningGame();
  assert.equal(game.canHold, true);
  const first = game.active.type;

  assert.equal(game.holdPiece(), true);
  assert.equal(game.canHold, false);
  assert.equal(game.hold, first);
  assert.ok(game.active);

  // Disabled until the next natural spawn.
  assert.equal(game.holdPiece(), false);
  assert.equal(game.canHold, false);

  // Locking spawns the next piece, which re-enables hold.
  game.hardDrop();
  assert.equal(game.canHold, true);
  const third = game.active.type;

  // Holding again swaps: the stored piece comes back, current goes to hold.
  assert.notEqual(game.active.type, first);
  game.holdPiece();
  assert.equal(game.active.type, first);
  assert.equal(game.hold, third);
  assert.equal(game.canHold, false);
});

// --- Preview queue consistency ---------------------------------------------

test('next preview head matches the piece drawn after the next lock', () => {
  const game = newRunningGame();
  const previewHead = game.peekQueue(3)[0];
  game.hardDrop();
  assert.equal(game.active.type, previewHead);
});

test('getState exposes a renderer-ready snapshot', () => {
  const game = newRunningGame();
  const state = game.getState();
  assert.equal(state.status, 'running');
  assert.equal(state.board.length, 20);
  assert.equal(typeof state.score, 'number');
  assert.equal(typeof state.lines, 'number');
  assert.equal(typeof state.level, 'number');
  assert.equal(state.active.cells.length, 4);
  assert.equal(state.active.ghost.length, 4);
  assert.equal(state.next.length, 3);
  assert.equal(state.lastClear, 0);
});