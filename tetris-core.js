/*
 * tetris-core.js — pure Tetris game logic (no DOM, no rendering).
 *
 * Works in two environments:
 *   - Node.js (CommonJS):  const core = require('./tetris-core.js');
 *   - Browser (script tag): window.TetrisCore
 *
 * Coordinate system: x = column (0..9, left to right), y = row (0..19, top to
 * bottom). Rotation is clockwise. Wall kicks follow the SRS kick tables
 * (converted to y-down coordinates) so rotating flush against a wall or the
 * floor always lands the piece in a legal, placeable state.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TetrisCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WIDTH = 10;
  var HEIGHT = 20;

  var TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  // Each tetromino lists its 4 rotation states (0 = spawn, CW each step) as
  // cell offsets within a bounding box (3x3 for JLSTZ, 4x4 for I, 2x2 for O).
  var SHAPES = {
    I: [
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[2, 0], [2, 1], [2, 2], [2, 3]],
      [[0, 2], [1, 2], [2, 2], [3, 2]],
      [[1, 0], [1, 1], [1, 2], [1, 3]]
    ],
    O: [
      [[0, 0], [1, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [0, 1], [1, 1]]
    ],
    T: [
      [[1, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]],
      [[1, 0], [0, 1], [1, 1], [1, 2]]
    ],
    S: [
      [[1, 0], [2, 0], [0, 1], [1, 1]],
      [[1, 0], [1, 1], [2, 1], [2, 2]],
      [[0, 2], [1, 1], [1, 2], [2, 1]],
      [[0, 0], [0, 1], [1, 1], [1, 2]]
    ],
    Z: [
      [[0, 0], [1, 0], [1, 1], [2, 1]],
      [[1, 1], [1, 2], [2, 0], [2, 1]],
      [[0, 1], [1, 1], [1, 2], [2, 2]],
      [[1, 0], [0, 1], [1, 1], [0, 2]]
    ],
    J: [
      [[0, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [0, 2], [1, 2]]
    ],
    L: [
      [[2, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]],
      [[0, 0], [1, 0], [1, 1], [1, 2]]
    ]
  };

  // SRS wall-kick tables for clockwise rotation, y-down coordinates.
  // Key: "<from>-><to>" where 0=R(1)=2=L(3)=0.
  var KICKS = {
    JLSTZ: {
      '0->1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
      '1->2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
      '2->3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
      '3->0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]]
    },
    I: {
      '0->1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
      '1->2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
      '2->3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
      '3->0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]]
    },
    O: {
      '0->1': [[0, 0]],
      '1->2': [[0, 0]],
      '2->3': [[0, 0]],
      '3->0': [[0, 0]]
    }
  };

  function emptyRow() {
    var row = [];
    for (var i = 0; i < WIDTH; i++) row.push(0);
    return row;
  }

  function createBoard() {
    var board = [];
    for (var y = 0; y < HEIGHT; y++) board.push(emptyRow());
    return board;
  }

  // Fisher-Yates shuffle of the 7 tetromino types (a "bag").
  function createBag() {
    var bag = TYPES.slice();
    for (var i = bag.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = bag[i];
      bag[i] = bag[j];
      bag[j] = tmp;
    }
    return bag;
  }

  // Draw the next type from the bag, refilling with a fresh shuffled bag
  // whenever it runs empty (guarantees 7-bag integrity forever).
  function drawFromBag(bag) {
    if (bag.length === 0) {
      bag.push.apply(bag, createBag());
    }
    return bag.shift();
  }

  function spawnPiece(type) {
    var piece = { type: type, x: 3, y: 0, rotation: 0 };
    if (type === 'I') {
      piece.x = 3;
      piece.y = -1;
    } else if (type === 'O') {
      piece.x = 4;
      piece.y = 0;
    }
    return piece;
  }

  // Absolute board cells occupied by the piece at its current position.
  function pieceCells(piece) {
    return SHAPES[piece.type][piece.rotation].map(function (cell) {
      return [piece.x + cell[0], piece.y + cell[1]];
    });
  }

  // Collision check at (x, y). Cells above the board (y < 0) are allowed;
  // walls, the floor, and stacked cells are not.
  function canPlace(board, piece, x, y) {
    if (x === undefined) x = piece.x;
    if (y === undefined) y = piece.y;
    var cells = SHAPES[piece.type][piece.rotation];
    for (var i = 0; i < cells.length; i++) {
      var cx = x + cells[i][0];
      var cy = y + cells[i][1];
      if (cx < 0 || cx >= WIDTH || cy >= HEIGHT) return false;
      if (cy >= 0 && board[cy][cx] !== 0) return false;
    }
    return true;
  }

  function canPlaceCurrent(board, piece) {
    return canPlace(board, piece, piece.x, piece.y);
  }

  // Try to rotate the piece clockwise, applying SRS wall kicks in order.
  // Returns the rotated piece (possibly kicked) or null if no offset fits.
  function rotateCW(board, piece) {
    var from = piece.rotation;
    var to = (from + 1) % 4;
    var key = from + '->' + to;
    var table = piece.type === 'I' ? KICKS.I : piece.type === 'O' ? KICKS.O : KICKS.JLSTZ;
    var kicks = table[key];
    for (var i = 0; i < kicks.length; i++) {
      var candidate = {
        type: piece.type,
        x: piece.x + kicks[i][0],
        y: piece.y + kicks[i][1],
        rotation: to
      };
      if (canPlaceCurrent(board, candidate)) return candidate;
    }
    return null;
  }

  // Move the piece by (dx, dy); returns the moved piece or null if blocked.
  function move(board, piece, dx, dy) {
    var candidate = { type: piece.type, x: piece.x + dx, y: piece.y + dy, rotation: piece.rotation };
    if (canPlaceCurrent(board, candidate)) return candidate;
    return null;
  }

  // Merge the piece into the board. Cells above the board are skipped.
  function lockPiece(board, piece) {
    var next = board.map(function (row) { return row.slice(); });
    var cells = SHAPES[piece.type][piece.rotation];
    for (var i = 0; i < cells.length; i++) {
      var cx = piece.x + cells[i][0];
      var cy = piece.y + cells[i][1];
      if (cy >= 0 && cy < HEIGHT && cx >= 0 && cx < WIDTH) {
        next[cy][cx] = piece.type;
      }
    }
    return next;
  }

  // Remove full rows; empty rows are added at the top.
  function clearLines(board) {
    var remaining = board.filter(function (row) {
      return row.some(function (cell) { return cell === 0; });
    });
    var cleared = board.length - remaining.length;
    var next = [];
    for (var i = 0; i < cleared; i++) next.push(emptyRow());
    return { board: next.concat(remaining), lines: cleared };
  }

  // 1/2/3/4 lines -> 100/300/500/800 x level.
  var LINE_SCORES = [0, 100, 300, 500, 800];
  function scoreForLines(lines, level) {
    return (LINE_SCORES[lines] || 0) * level;
  }

  function levelForLines(lines) {
    return Math.floor(lines / 10) + 1;
  }

  // Gravity interval in ms for a level (faster as level rises).
  function gravityInterval(level) {
    return Math.max(50, 800 - (level - 1) * 60);
  }

  // ---- Game state machine (mutable, deterministic, unit-testable) ----

  function createGameState() {
    var state = {
      board: createBoard(),
      bag: createBag(),
      current: null,
      next: null,
      score: 0,
      lines: 0,
      level: 1,
      over: false,
      started: false
    };
    state.next = spawnPiece(drawFromBag(state.bag));
    state.current = spawnPiece(drawFromBag(state.bag));
    return state;
  }

  function resetGameState(state) {
    var fresh = createGameState();
    state.board = fresh.board;
    state.bag = fresh.bag;
    state.current = fresh.current;
    state.next = fresh.next;
    state.score = 0;
    state.lines = 0;
    state.level = 1;
    state.over = false;
    state.started = true;
  }

  function spawnCurrent(state) {
    state.current = state.next;
    state.next = spawnPiece(drawFromBag(state.bag));
    if (!canPlaceCurrent(state.board, state.current)) {
      state.over = true;
    }
  }

  function lockCurrent(state) {
    state.board = lockPiece(state.board, state.current);
    var result = clearLines(state.board);
    state.board = result.board;
    if (result.lines > 0) {
      state.lines += result.lines;
      state.score += scoreForLines(result.lines, state.level);
      state.level = levelForLines(state.lines);
    }
    spawnCurrent(state);
  }

  // One gravity step: move the piece down, or lock it at the floor/stack.
  function tick(state) {
    if (state.over || !state.started || !state.current) return;
    var down = move(state.board, state.current, 0, 1);
    if (down) {
      state.current = down;
    } else {
      lockCurrent(state);
    }
  }

  function moveLeft(state) {
    return movePiece(state, -1, 0);
  }

  function moveRight(state) {
    return movePiece(state, 1, 0);
  }

  function movePiece(state, dx, dy) {
    if (state.over || !state.started || !state.current) return false;
    var moved = move(state.board, state.current, dx, dy);
    if (moved) {
      state.current = moved;
      return true;
    }
    return false;
  }

  function rotate(state) {
    if (state.over || !state.started || !state.current) return false;
    var rotated = rotateCW(state.board, state.current);
    if (rotated) {
      state.current = rotated;
      return true;
    }
    return false;
  }

  // Soft drop: one cell down (+1 point per cell); locks when it cannot descend.
  function softDrop(state) {
    if (state.over || !state.started || !state.current) return false;
    var down = move(state.board, state.current, 0, 1);
    if (down) {
      state.current = down;
      state.score += 1;
      return true;
    }
    lockCurrent(state);
    return false;
  }

  return {
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    TYPES: TYPES,
    SHAPES: SHAPES,
    KICKS: KICKS,
    createBoard: createBoard,
    createBag: createBag,
    drawFromBag: drawFromBag,
    spawnPiece: spawnPiece,
    pieceCells: pieceCells,
    canPlace: canPlace,
    rotateCW: rotateCW,
    move: move,
    lockPiece: lockPiece,
    clearLines: clearLines,
    scoreForLines: scoreForLines,
    levelForLines: levelForLines,
    gravityInterval: gravityInterval,
    createGameState: createGameState,
    resetGameState: resetGameState,
    spawnCurrent: spawnCurrent,
    lockCurrent: lockCurrent,
    tick: tick,
    moveLeft: moveLeft,
    moveRight: moveRight,
    rotate: rotate,
    softDrop: softDrop
  };
});