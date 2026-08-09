/*
 * tetris.js - Pure Tetris engine.
 *
 * No DOM, canvas, or browser APIs are touched here, so the same file works as:
 *   - a classic (non-module) browser script exposing window.Tetris
 *   - a CommonJS module for Node's `node --test` runner (require())
 *
 * Rotation is handled with precomputed rotation-state matrices (a 4x4 box for
 * the I piece, a 2x2 box for the O piece, 3x3 boxes for the rest). The O piece
 * is a 2x2 square, so it has exactly one rotation state and rotating it is a
 * safe no-op. Every rotation attempt also tries simple wall/floor kicks
 * (horizontal and one row up), so pieces never end up out of bounds when
 * rotated near walls, the floor, or stacked cells.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tetris = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLS = 10;
  var ROWS = 20;

  // Base orientation of every tetromino. Each matrix must be square so that
  // rotation is well-defined: I -> 4x4, O -> 2x2, all others -> 3x3.
  var BASE_SHAPES = {
    I: {
      color: '#00e5ff',
      matrix: [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0]
      ]
    },
    O: {
      color: '#ffd60a',
      matrix: [
        [1, 1],
        [1, 1]
      ]
    },
    T: {
      color: '#bf5af2',
      matrix: [
        [0, 1, 0],
        [1, 1, 1],
        [0, 0, 0]
      ]
    },
    S: {
      color: '#30d158',
      matrix: [
        [0, 1, 1],
        [1, 1, 0],
        [0, 0, 0]
      ]
    },
    Z: {
      color: '#ff453a',
      matrix: [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 0]
      ]
    },
    J: {
      color: '#0a84ff',
      matrix: [
        [1, 0, 0],
        [1, 1, 1],
        [0, 0, 0]
      ]
    },
    L: {
      color: '#ff9f0a',
      matrix: [
        [0, 0, 1],
        [1, 1, 1],
        [0, 0, 0]
      ]
    }
  };

  var KEYS = Object.keys(BASE_SHAPES); // 7 standard tetrominoes

  // Rotate a square matrix 90 degrees clockwise (pure function).
  function rotateCW(matrix) {
    var n = matrix.length;
    var out = [];
    for (var y = 0; y < n; y++) {
      out.push(new Array(n).fill(0));
    }
    for (var sy = 0; sy < n; sy++) {
      for (var sx = 0; sx < n; sx++) {
        out[sx][n - 1 - sy] = matrix[sy][sx];
      }
    }
    return out;
  }

  // Build the rotation-state list for one shape. O keeps a single state.
  function buildRotations(key) {
    var states = [BASE_SHAPES[key].matrix];
    if (key === 'O') return states;
    for (var i = 0; i < 3; i++) {
      states.push(rotateCW(states[states.length - 1]));
    }
    return states;
  }

  var SHAPES = {};
  KEYS.forEach(function (key) {
    SHAPES[key] = {
      color: BASE_SHAPES[key].color,
      rotations: buildRotations(key)
    };
  });

  // Simple kicks tried in order when a rotation would collide. Covers the
  // common near-wall and near-floor cases (including stacked-cell nudges).
  var WALL_KICKS = [
    { dx: 0, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -2, dy: 0 },
    { dx: 2, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: -1, dy: -1 },
    { dx: 1, dy: -1 }
  ];

  function createGrid(rows, cols) {
    var grid = [];
    for (var y = 0; y < rows; y++) {
      grid.push(new Array(cols).fill(null));
    }
    return grid;
  }

  function collides(grid, piece) {
    var m = piece.matrix;
    for (var y = 0; y < m.length; y++) {
      for (var x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        var gx = piece.x + x;
        var gy = piece.y + y;
        if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
        if (gy >= 0 && grid[gy][gx]) return true;
      }
    }
    return false;
  }

  function merge(grid, piece) {
    var next = grid.map(function (row) {
      return row.slice();
    });
    var m = piece.matrix;
    for (var y = 0; y < m.length; y++) {
      for (var x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        var gx = piece.x + x;
        var gy = piece.y + y;
        if (gx >= 0 && gx < COLS && gy >= 0 && gy < ROWS) {
          next[gy][gx] = piece.key;
        }
      }
    }
    return next;
  }

  function clearLines(grid) {
    var remaining = grid.filter(function (row) {
      return row.some(function (cell) {
        return cell === null;
      });
    });
    var cleared = grid.length - remaining.length;
    while (remaining.length < grid.length) {
      remaining.unshift(new Array(COLS).fill(null));
    }
    return { grid: remaining, cleared: cleared };
  }

  // Standard scoring: 1/2/3/4 lines -> 100/300/500/800 x level.
  var LINE_SCORES = [0, 100, 300, 500, 800];

  function levelForLines(lines) {
    return Math.floor(lines / 10) + 1;
  }

  // Gravity interval in ms. Shrinks as the level rises, with a floor so high
  // levels stay playable.
  function getGravityMs(level) {
    return Math.max(80, Math.round(800 * Math.pow(0.82, level - 1)));
  }

  function nextFromBag(game) {
    if (game.bag.length === 0) {
      var bag = KEYS.slice();
      // Fisher-Yates shuffle using the injected RNG (deterministic in tests).
      for (var i = bag.length - 1; i > 0; i--) {
        var j = Math.floor(game.rng() * (i + 1));
        if (j > i) j = i;
        var tmp = bag[i];
        bag[i] = bag[j];
        bag[j] = tmp;
      }
      game.bag = bag;
    }
    return game.bag.pop();
  }

  function spawnPiece(game, key) {
    var rotation = SHAPES[key].rotations[0];
    var w = rotation[0].length;
    // The I piece is defined with its filled row in matrix row 1; spawning at
    // y=-1 places it flush against the top edge (its empty top row hangs above
    // the visible field, which collides() and merge() tolerate).
    var y = key === 'I' ? -1 : 0;
    return {
      key: key,
      matrix: rotation,
      x: Math.floor((COLS - w) / 2),
      y: y,
      rot: 0
    };
  }

  // Spawn the queued piece; flag game over when it collides immediately
  // (top-out). Always draws the next piece from the bag afterwards.
  function spawn(game) {
    var piece = spawnPiece(game, game.next);
    game.piece = piece;
    if (collides(game.grid, piece)) {
      game.gameOver = true;
    }
    game.next = nextFromBag(game);
    return piece;
  }

  function createGame(rng) {
    var game = {
      cols: COLS,
      rows: ROWS,
      rng: rng || Math.random,
      bag: [],
      grid: createGrid(ROWS, COLS),
      piece: null,
      next: null,
      score: 0,
      lines: 0,
      level: 1,
      gameOver: false
    };
    game.next = nextFromBag(game);
    spawn(game);
    return game;
  }

  function tryMove(game, dx, dy) {
    if (game.gameOver || !game.piece) return false;
    var candidate = {
      key: game.piece.key,
      matrix: game.piece.matrix,
      x: game.piece.x + dx,
      y: game.piece.y + dy,
      rot: game.piece.rot
    };
    if (collides(game.grid, candidate)) return false;
    game.piece.x = candidate.x;
    game.piece.y = candidate.y;
    return true;
  }

  // Rotate clockwise (dir === 1). Returns true when a (possibly kicked)
  // rotation succeeded, false otherwise. O is a no-op with a single state.
  function tryRotate(game, dir) {
    if (game.gameOver || !game.piece) return false;
    var states = SHAPES[game.piece.key].rotations;
    if (states.length === 1) return false;
    var nextRot = (game.piece.rot + dir + states.length) % states.length;
    var matrix = states[nextRot];
    for (var k = 0; k < WALL_KICKS.length; k++) {
      var kick = WALL_KICKS[k];
      var candidate = {
        key: game.piece.key,
        matrix: matrix,
        x: game.piece.x + kick.dx,
        y: game.piece.y + kick.dy,
        rot: nextRot
      };
      if (!collides(game.grid, candidate)) {
        game.piece.matrix = matrix;
        game.piece.x = candidate.x;
        game.piece.y = candidate.y;
        game.piece.rot = nextRot;
        return true;
      }
    }
    return false;
  }

  // Landing row of a ghost copy of the active piece.
  function getGhostY(game) {
    var y = game.piece.y;
    while (
      !collides(game.grid, {
        key: game.piece.key,
        matrix: game.piece.matrix,
        x: game.piece.x,
        y: y + 1,
        rot: game.piece.rot
      })
    ) {
      y++;
    }
    return y;
  }

  function lockPiece(game) {
    game.grid = merge(game.grid, game.piece);
    var result = clearLines(game.grid);
    game.grid = result.grid;
    if (result.cleared > 0) {
      game.lines += result.cleared;
      game.score += LINE_SCORES[result.cleared] * game.level;
      game.level = levelForLines(game.lines);
    }
    spawn(game);
    return result.cleared;
  }

  // Move the active piece one row down; lock it (and spawn the next piece)
  // when it cannot move. Returns true when the piece moved, false when it
  // locked. Safe to call repeatedly from a gravity loop.
  function stepDown(game) {
    if (tryMove(game, 0, 1)) return true;
    lockPiece(game);
    return false;
  }

  // Instant drop; returns the distance in cells the piece traveled.
  function hardDrop(game) {
    if (game.gameOver || !game.piece) return 0;
    var distance = 0;
    while (tryMove(game, 0, 1)) {
      distance++;
    }
    lockPiece(game);
    return distance;
  }

  return {
    COLS: COLS,
    ROWS: ROWS,
    KEYS: KEYS,
    BASE_SHAPES: BASE_SHAPES,
    SHAPES: SHAPES,
    LINE_SCORES: LINE_SCORES,
    createGrid: createGrid,
    rotateCW: rotateCW,
    buildRotations: buildRotations,
    collides: collides,
    merge: merge,
    clearLines: clearLines,
    levelForLines: levelForLines,
    getGravityMs: getGravityMs,
    createGame: createGame,
    spawn: spawn,
    tryMove: tryMove,
    tryRotate: tryRotate,
    getGhostY: getGhostY,
    lockPiece: lockPiece,
    stepDown: stepDown,
    hardDrop: hardDrop
  };
});