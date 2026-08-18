/* game.js — browser runtime for Tetris.
 * Depends on the global TetrisCore (loaded via tetris-core.js).
 * Rendering only; all game rules live in the pure core module.
 */
(function () {
  'use strict';

  var core = window.TetrisCore;

  if (!core) {
    throw new Error('tetris-core.js must be loaded before game.js');
  }

  var CELL = 30;
  var BOARD_W = core.WIDTH * CELL; // 300
  var BOARD_H = core.HEIGHT * CELL; // 600

  var COLORS = {
    I: '#00e5ff',
    O: '#ffd500',
    T: '#b14bff',
    S: '#3ddc55',
    Z: '#ff3b3b',
    J: '#3b6bff',
    L: '#ff9a2b'
  };

  var boardCanvas = document.getElementById('board');
  var boardCtx = boardCanvas.getContext('2d');
  var nextCanvas = document.getElementById('next');
  var nextCtx = nextCanvas.getContext('2d');

  var scoreEl = document.getElementById('score');
  var linesEl = document.getElementById('lines');
  var levelEl = document.getElementById('level');
  var readyEl = document.getElementById('ready');
  var gameOverEl = document.getElementById('game-over');
  var finalScoreEl = document.getElementById('final-score');

  var game = core.createGameState();

  // ---- Rendering ----

  function fillCell(ctx, x, y, color, size) {
    var px = x * size;
    var py = y * size;
    ctx.fillStyle = color;
    ctx.fillRect(px, py, size - 1, size - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(px, py, size - 1, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(px, py + size - 4, size - 1, 3);
  }

  function drawPiece(ctx, piece, boardOffsetX, boardOffsetY, size, color) {
    var cells = core.pieceCells(piece);
    for (var i = 0; i < cells.length; i++) {
      var cx = cells[i][0] - boardOffsetX;
      var cy = cells[i][1] - boardOffsetY;
      if (cy < 0) continue;
      fillCell(ctx, cx, cy, color, size);
    }
  }

  // Landing position for the ghost piece (where the current piece will rest).
  function ghostY() {
    var y = game.current.y;
    while (core.canPlace(game.board, game.current, game.current.x, y + 1)) {
      y++;
    }
    return y;
  }

  function drawBoard() {
    boardCtx.clearRect(0, 0, BOARD_W, BOARD_H);
    boardCtx.fillStyle = '#0a0d14';
    boardCtx.fillRect(0, 0, BOARD_W, BOARD_H);

    // Grid lines.
    boardCtx.strokeStyle = 'rgba(255,255,255,0.05)';
    boardCtx.lineWidth = 1;
    for (var x = 0; x <= core.WIDTH; x++) {
      boardCtx.beginPath();
      boardCtx.moveTo(x * CELL + 0.5, 0);
      boardCtx.lineTo(x * CELL + 0.5, BOARD_H);
      boardCtx.stroke();
    }
    for (var y = 0; y <= core.HEIGHT; y++) {
      boardCtx.beginPath();
      boardCtx.moveTo(0, y * CELL + 0.5);
      boardCtx.lineTo(BOARD_W, y * CELL + 0.5);
      boardCtx.stroke();
    }

    // Locked cells.
    for (y = 0; y < core.HEIGHT; y++) {
      for (x = 0; x < core.WIDTH; x++) {
        var type = game.board[y][x];
        if (type !== 0) {
          fillCell(boardCtx, x, y, COLORS[type] || '#888', CELL);
        }
      }
    }

    if (game.current && !game.over) {
      // Ghost piece (landing preview) — subtle outline only.
      var gy = ghostY();
      var ghostCells = core.pieceCells(game.current);
      var g = game.current;
      for (var i = 0; i < ghostCells.length; i++) {
        var gx = ghostCells[i][0];
        var gyy = ghostCells[i][1] + (gy - g.y);
        if (gyy < 0) continue;
        boardCtx.strokeStyle = 'rgba(255,255,255,0.35)';
        boardCtx.lineWidth = 2;
        boardCtx.strokeRect(gx * CELL + 2, gyy * CELL + 2, CELL - 5, CELL - 5);
      }
      drawPiece(boardCtx, game.current, 0, 0, CELL, COLORS[game.current.type]);
    }
  }

  function drawNext() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!game.next) return;
    var cells = core.pieceCells(game.next);
    var size = 24;
    // Center the preview within the 120x100 canvas.
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i][0] < minX) minX = cells[i][0];
      if (cells[i][0] > maxX) maxX = cells[i][0];
      if (cells[i][1] < minY) minY = cells[i][1];
      if (cells[i][1] > maxY) maxY = cells[i][1];
    }
    var w = (maxX - minX + 1) * size;
    var h = (maxY - minY + 1) * size;
    var ox = (nextCanvas.width - w) / 2;
    var oy = (nextCanvas.height - h) / 2;
    for (i = 0; i < cells.length; i++) {
      var cx = ox + (cells[i][0] - minX) * size;
      var cy = oy + (cells[i][1] - minY) * size;
      nextCtx.fillStyle = COLORS[game.next.type] || '#888';
      nextCtx.fillRect(cx, cy, size - 1, size - 1);
    }
  }

  function updateHud() {
    scoreEl.textContent = game.score;
    linesEl.textContent = game.lines;
    levelEl.textContent = game.level;
  }

  function updateOverlays() {
    readyEl.classList.toggle('hidden', game.started);
    gameOverEl.classList.toggle('hidden', !game.over);
    if (game.over) {
      finalScoreEl.textContent = 'Final score: ' + game.score;
    }
  }

  function render() {
    drawBoard();
    drawNext();
    updateHud();
    updateOverlays();
  }

  // ---- Game loop (requestAnimationFrame with a time accumulator) ----

  var lastTime = 0;
  var acc = 0;

  function loop(now) {
    var dt = Math.min(now - lastTime, 200); // clamp pauses / tab switches
    lastTime = now;

    if (game.started && !game.over) {
      acc += dt;
      var interval = core.gravityInterval(game.level);
      var steps = 0;
      while (acc >= interval && steps < 8 && !game.over) {
        core.tick(game);
        acc -= interval;
        steps++;
      }
      if (game.over) acc = 0;
    }

    render();
    requestAnimationFrame(loop);
  }

  // ---- Input: arrow keys only ----

  var ARROW_KEYS = {
    ArrowLeft: true,
    ArrowRight: true,
    ArrowUp: true,
    ArrowDown: true
  };

  function applyAction(key, repeat) {
    switch (key) {
      case 'ArrowLeft':
        core.moveLeft(game);
        break;
      case 'ArrowRight':
        core.moveRight(game);
        break;
      case 'ArrowUp':
        // Ignore OS key-repeat so holding Up does not spin the piece wildly.
        if (!repeat) core.rotate(game);
        break;
      case 'ArrowDown':
        core.softDrop(game);
        break;
    }
  }

  function onKeyDown(e) {
    if (!ARROW_KEYS[e.key]) return;
    // Never let arrow keys scroll or move the page.
    e.preventDefault();

    if (game.over) {
      core.resetGameState(game);
      applyAction(e.key, e.repeat);
    } else if (!game.started) {
      game.started = true;
      applyAction(e.key, e.repeat);
    } else {
      applyAction(e.key, e.repeat);
    }
    render();
  }

  // Reset the loop baseline on blur so gravity does not leap after refocus.
  // There is no held-key state to clear: movement uses OS key-repeat, so a
  // blur can never leave a piece "stuck" moving.
  function onBlur() {
    lastTime = performance.now();
    acc = 0;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', onBlur);

  // ---- Boot ----
  lastTime = performance.now();
  updateOverlays();
  render();
  requestAnimationFrame(loop);
})();