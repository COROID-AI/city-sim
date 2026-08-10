// ---------------------------------------------------------------------------
// Engine unit tests. Run with: npm run test:engine
// These tests import only the pure engine module (and constants), never DOM.
// ---------------------------------------------------------------------------
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tetris } from '../src/tetris.js';
import {
  COLS,
  ROWS,
  BAG,
  SHAPES,
  SPAWN,
  KICKS,
  CLEAR_SCORE,
  LINES_PER_LEVEL,
} from '../src/constants.js';

test('7-bag randomizer deals all 7 pieces exactly once per bag', () => {
  const engine = new Tetris();
  // Each spawn() consumes exactly one piece from the bag stream, and after 7
  // spawns the stream is back at a bag boundary, so each group of 7 spawned
  // pieces must be a permutation of the 7 tetrominoes.
  for (let bag = 0; bag < 3; bag++) {
    const drawn = [];
    for (let i = 0; i < 7; i++) {
      engine.spawn();
      drawn.push(engine.current.type);
    }
    assert.deepEqual(
      [...drawn].sort(),
      [...BAG].sort(),
      `bag ${bag} must contain each piece exactly once`,
    );
  }
});

test('pieces spawn within the board and are visible', () => {
  const engine = new Tetris();
  engine.spawn();
  assert.ok(engine.current, 'a piece should spawn');
  for (const [cx, cy] of SHAPES[engine.current.type][0]) {
    const bx = engine.current.x + cx;
    const by = engine.current.y + cy;
    assert.ok(bx >= 0 && bx < COLS, 'spawn cell inside columns');
    assert.ok(by >= 0 && by < ROWS, 'spawn cell inside rows');
  }
});

test('rotation changes the piece cell set (SRS states differ)', () => {
  const engine = new Tetris();
  engine.state = 'playing';
  engine.current = { type: 'T', rotation: 0, x: SPAWN.T, y: 0 };
  const before = JSON.stringify(SHAPES.T[0]);
  assert.ok(engine.rotateCW(), 'CW rotation should succeed in open space');
  assert.equal(engine.current.rotation, 1);
  assert.notEqual(JSON.stringify(SHAPES.T[1]), before, 'rotation state cells must change');
});

test('O piece never rotates', () => {
  const engine = new Tetris();
  engine.state = 'playing';
  engine.current = { type: 'O', rotation: 0, x: SPAWN.O, y: 0 };
  assert.equal(engine.rotateCW(), false);
  assert.equal(engine.rotateCCW(), false);
  assert.equal(engine.current.rotation, 0);
});

test('I piece uses a kick table distinct from JLSTZ', () => {
  assert.notDeepEqual(KICKS.I['0->1'], KICKS.JLSTZ['0->1'], 'I kick table differs from JLSTZ');
  assert.notDeepEqual(KICKS.I['1->0'], KICKS.JLSTZ['1->0']);
});

test('SRS wall kick lets a T piece rotate at the left wall', () => {
  const engine = new Tetris();
  engine.state = 'playing';
  // Block the cell the rotated T would occupy at offset (0,0): absolute (1,2).
  engine.board[2][1] = 'J';
  engine.current = { type: 'T', rotation: 0, x: 0, y: 0 };
  assert.ok(engine.rotateCW(), 'T should kick off the left wall');
  assert.equal(engine.current.rotation, 1);
  // The first kick offset that fits is (-1, 0) per the JLSTZ 0->1 table.
  assert.equal(engine.current.x, -1);
  assert.equal(engine.current.y, 0);
  assert.equal(
    engine.collides(engine.current.type, engine.current.rotation, engine.current.x, engine.current.y),
    false,
    'post-kick placement must not collide',
  );
});

test('horizontal moves respect board edges', () => {
  const engine = new Tetris();
  engine.state = 'playing';
  engine.current = { type: 'I', rotation: 0, x: 0, y: 2 };
  assert.equal(engine.moveLeft(), false, 'cannot move left into the wall');
  assert.equal(engine.current.x, 0);
  assert.equal(engine.moveRight(), true);
  assert.equal(engine.current.x, 1);
});

test('hard drop locks the piece at the landing position', () => {
  const engine = new Tetris();
  engine.state = 'playing';
  engine.current = { type: 'O', rotation: 0, x: SPAWN.O, y: 0 };
  assert.equal(engine.getGhostY(), ROWS - 2, 'O piece lands with its 2 rows at the bottom');
  engine.hardDrop();
  assert.ok(engine.board[ROWS - 2][SPAWN.O], 'landed cell filled');
  assert.ok(engine.board[ROWS - 1][SPAWN.O], 'landed cell filled');
  assert.ok(engine.current, 'a new piece spawns after the lock');
});

test('gravity tick moves the piece down and locks at the bottom', () => {
  const engine = new Tetris();
  engine.state = 'playing';
  engine.current = { type: 'O', rotation: 0, x: SPAWN.O, y: 0 };
  engine.tick(1001); // level 1 gravity interval is 1000ms
  assert.equal(engine.current.y, 1);
  assert.equal(engine.gravityAccum, 1);
});

test('single-row clear shifts higher rows down and scores', () => {
  const engine = new Tetris();
  engine.state = 'playing';
  // Bottom row full except columns 4,5,6; marker piece two rows above.
  engine.board[ROWS - 1] = Array.from({ length: COLS }, (_, i) =>
    i >= 4 && i <= 6 ? null : 'T',
  );
  const marker = new Array(COLS).fill(null);
  marker[0] = 'J';
  engine.board[ROWS - 3] = marker;
  const scoreBefore = engine.score;
  const linesBefore = engine.lines;

  // Lock a T at x=4, y=ROWS-2: its bottom row fills columns 4,5,6.
  engine.current = { type: 'T', rotation: 0, x: 4, y: ROWS - 2 };
  engine.lock();

  assert.equal(engine.lines, linesBefore + 1, 'one line cleared');
  assert.equal(engine.score - scoreBefore, CLEAR_SCORE[1] * engine.level);
  assert.equal(engine.board[ROWS - 2][0], 'J', 'marker shifted down one row');
  assert.equal(engine.board[ROWS - 3][0], null, 'old marker row emptied');
  // The locked T's top cell (column 5) remains in the new bottom row; every
  // other cell of that row is fresh.
  assert.equal(engine.board[ROWS - 1][5], 'T', 'locked piece cell remains');
  assert.equal(engine.board[ROWS - 1].filter((c) => c !== null).length, 1);
});

test('tetris (4-line) clear scores 800 x level', () => {
  const engine = new Tetris();
  engine.state = 'playing';
  for (let row = ROWS - 4; row < ROWS; row++) {
    engine.board[row] = Array.from({ length: COLS }, (_, i) => BAG[i % BAG.length]);
  }
  const scoreBefore = engine.score;
  const linesBefore = engine.lines;
  // Lock any piece above the full rows; lock() clears the four full rows.
  engine.current = { type: 'I', rotation: 0, x: 3, y: ROWS - 6 };
  engine.lock();
  assert.equal(engine.lines, linesBefore + 4);
  assert.equal(engine.score - scoreBefore, CLEAR_SCORE[4] * engine.level);
});

test('level increases every 10 lines', () => {
  const engine = new Tetris();
  engine.state = 'playing';
  engine.lines = 9;
  engine.level = 1;
  engine.board[ROWS - 1] = Array.from({ length: COLS }, (_, i) =>
    i >= 4 && i <= 6 ? null : 'T',
  );
  engine.current = { type: 'T', rotation: 0, x: 4, y: ROWS - 2 };
  engine.lock();
  assert.equal(engine.lines, 10);
  assert.equal(engine.level, Math.floor(10 / LINES_PER_LEVEL) + 1);
});

test('hold swaps once per piece and stashes on first use', () => {
  const engine = new Tetris();
  engine.state = 'playing';
  engine.spawn();
  const first = engine.current.type;

  // First hold: stash current, spawn a new piece.
  assert.ok(engine.holdPiece());
  assert.equal(engine.hold, first);
  assert.equal(engine.canHold, false, 'cannot hold again until lock');
  const second = engine.current.type;
  assert.ok(second, 'new piece spawned');

  // Second hold must be rejected (once per piece).
  assert.equal(engine.holdPiece(), false);
  assert.equal(engine.hold, first);

  // After the piece locks, hold becomes available and swaps with the held one.
  engine.canHold = true;
  engine.current = { type: second, rotation: 0, x: SPAWN[second], y: 0 };
  assert.ok(engine.holdPiece());
  assert.equal(engine.hold, second);
  assert.equal(engine.current.type, first, 'swapped piece becomes active');
});

test('game over when a piece cannot spawn', () => {
  const engine = new Tetris();
  engine.state = 'playing';
  // Block every cell in the top rows where pieces spawn.
  for (let y = 0; y < 4; y++) {
    engine.board[y] = new Array(COLS).fill('T');
  }
  // Empty the queue so spawn() draws a fresh piece that collides immediately.
  engine.next = [];
  engine.spawn();
  assert.equal(engine.state, 'over');
  assert.equal(engine.current, null);
});