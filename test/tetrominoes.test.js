import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECE_TYPES } from '../src/constants.js';
import {
  TETROMINOES,
  getCells,
  rotateState,
  getWallKicks,
  WALL_KICKS,
  createQueue,
  drawFromBag,
  spawnColumn,
} from '../src/tetrominoes.js';

test('every tetromino has four cells in every rotation state', () => {
  for (const type of PIECE_TYPES) {
    for (let state = 0; state < 4; state++) {
      assert.equal(getCells(type, state).length, 4, `${type} state ${state}`);
      for (const [x, y] of getCells(type, state)) {
        const size = TETROMINOES[type].states[0].cells.length === 4 && type === 'I' ? 4 : type === 'O' ? 2 : 3;
        assert.ok(x >= 0 && x < size && y >= 0 && y < size, `${type} state ${state} cell ${x},${y}`);
      }
    }
  }
});

test('rotateState: counter-clockwise inverts clockwise for every state', () => {
  for (const type of PIECE_TYPES) {
    for (let state = 0; state < 4; state++) {
      const cw = rotateState(type, state, 1);
      assert.equal(rotateState(type, cw, -1), state, `${type} state ${state}`);
    }
  }
});

test('rotateState: four clockwise rotations restore the original state', () => {
  for (const type of PIECE_TYPES) {
    for (let state = 0; state < 4; state++) {
      let s = state;
      for (let i = 0; i < 4; i++) s = rotateState(type, s, 1);
      assert.equal(s, state, `${type} state ${state}`);
    }
  }
});

test('O piece never changes cells when rotated', () => {
  const base = getCells('O', 0);
  for (let i = 1; i < 4; i++) {
    assert.deepEqual(getCells('O', i), base);
  }
});

test('SRS kick tables exist for all eight JLSTZ transitions with the base offset first', () => {
  const transitions = [[0, 1], [1, 0], [1, 2], [2, 1], [2, 3], [3, 2], [3, 0], [0, 3]];
  for (const type of ['T', 'S', 'Z', 'J', 'L']) {
    for (const [from, to] of transitions) {
      const kicks = getWallKicks(type, from, to);
      assert.equal(kicks.length, 5, `${type} ${from}>${to} has 5 offsets`);
      assert.deepEqual(kicks[0], [0, 0], `${type} ${from}>${to} starts at origin`);
    }
  }
});

test('SRS kick tables for the I piece cover all eight transitions', () => {
  const transitions = [[0, 1], [1, 0], [1, 2], [2, 1], [2, 3], [3, 2], [3, 0], [0, 3]];
  for (const [from, to] of transitions) {
    const kicks = getWallKicks('I', from, to);
    assert.equal(kicks.length, 5, `I ${from}>${to}`);
    assert.deepEqual(kicks[0], [0, 0]);
  }
});

test('O has no wall kicks (it never rotates)', () => {
  assert.deepEqual(WALL_KICKS.O, {});
  assert.deepEqual(getWallKicks('O', 0, 1), []);
});

test('7-bag: each bag contains every piece exactly once', () => {
  const queue = createQueue();
  assert.equal(queue.length, POOL_SIZE());
  const first = [];
  for (let i = 0; i < POOL_SIZE(); i++) first.push(drawFromBag(queue));
  assert.deepEqual(new Set(first).size, POOL_SIZE());
  assert.deepEqual([...new Set(first)].sort(), [...PIECE_TYPES].sort());
});

test('7-bag: drawn sequences stay grouped in full bags across refills', () => {
  const queue = createQueue();
  const drawn = [];
  for (let i = 0; i < 21; i++) drawn.push(drawFromBag(queue));
  for (let bag = 0; bag < 3; bag++) {
    const group = drawn.slice(bag * 7, bag * 7 + 7);
    assert.equal(new Set(group).size, 7, `bag ${bag}`);
    assert.deepEqual([...new Set(group)].sort(), [...PIECE_TYPES].sort());
  }
});

test('spawnColumn centers each piece on a 10-wide field', () => {
  assert.equal(spawnColumn('I', 10), 3);
  assert.equal(spawnColumn('O', 10), 4);
  assert.equal(spawnColumn('T', 10), 3);
  assert.equal(spawnColumn('S', 10), 3);
});

function POOL_SIZE() {
  return PIECE_TYPES.length;
}