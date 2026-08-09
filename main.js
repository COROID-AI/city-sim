/*
 * main.js - Tetris UI: rendering, input (keyboard + on-screen buttons),
 * and the game loop. Depends on the classic-script global `Tetris` from
 * tetris.js.
 */
(function () {
  'use strict';

  var Tetris = window.Tetris;
  if (!Tetris) {
    throw new Error('tetris.js must be loaded before main.js');
  }

  var COLS = Tetris.COLS;
  var ROWS = Tetris.ROWS;

  var boardCanvas = document.getElementById('board');
  var boardCtx = boardCanvas.getContext('2d');
  var nextCanvas = document.getElementById('next');
  var nextCtx = nextCanvas.getContext('2d');
  var scoreEl = document.getElementById('score');
  var levelEl = document.getElementById('level');
  var linesEl = document.getElementById('lines');
  var overlay = document.getElementById('overlay');
  var overlayTitle = document.getElementById('overlay-title');
  var overlayText = document.getElementById('overlay-text');
  var overlayResume = document.getElementById('overlay-resume');
  var overlayRestart = document.getElementById('overlay-restart');
  var pauseIcon = document.getElementById('pause-icon');

  var game = null;
  var paused = false;

  // Canvas logical (CSS-pixel) size set by resize(); draw() uses these.
  var cell = 30;
  var boardW = COLS * cell;
  var boardH = ROWS * cell;
  var boardDPR = 1;

  // Game loop state (see finding: gate by paused/gameOver, clamp dt).
  var lastTime = null;
  var gravityAcc = 0;
  var holdSince = {
    ArrowLeft: null,
    ArrowRight: null,
    ArrowDown: null
  };
  var keys = new Set();
  var HOLD_DELAY = 180; // ms before held-key auto-repeat starts
  var HOLD_INTERVAL = 70; // ms between auto-repeat steps
  var MAX_DT = 100; // clamp frame delta to avoid jumps after tab switches

  // ---------------------------------------------------------------- sizing

  function resize() {
    var pad = 24;
    var gap = 20;
    var panelAllowance = 230;
    var borderAllowance = 8;
    var sideBySide = window.innerWidth >= 820;

    var availW = window.innerWidth - pad * 2 - borderAllowance;
    var availH = window.innerHeight - pad * 2 - borderAllowance - gap;
    if (sideBySide) {
      availW -= panelAllowance;
    }

    cell = Math.max(
      10,
      Math.min(36, Math.floor(Math.min(availW / COLS, availH / ROWS)))
    );
    boardW = cell * COLS;
    boardH = cell * ROWS;
    boardDPR = window.devicePixelRatio || 1;

    boardCanvas.style.width = boardW + 'px';
    boardCanvas.style.height = boardH + 'px';
    boardCanvas.width = Math.round(boardW * boardDPR);
    boardCanvas.height = Math.round(boardH * boardDPR);

    var nextDPR = window.devicePixelRatio || 1;
    nextCanvas.width = Math.round(160 * nextDPR);
    nextCanvas.height = Math.round(160 * nextDPR);

    draw();
  }

  // ---------------------------------------------------------------- drawing

  function cellStyle(key) {
    return Tetris.SHAPES[key] ? Tetris.SHAPES[key].color : '#8b93a1';
  }

  function drawCell(ctx, x, y, size, color, inset) {
    var s = size;
    var i = inset || 0;
    ctx.fillStyle = color;
    ctx.fillRect(x * s + i, y * s + i, s - i * 2, s - i * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x * s + i, y * s + s - i - 2, s - i * 2, 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x * s + i + 0.5, y * s + i + 0.5, s - i * 2 - 1, s - i * 2 - 1);
  }

  function drawPieceCells(ctx, piece, xOff, yOff, size, alpha) {
    var m = piece.matrix;
    ctx.globalAlpha = alpha;
    for (var y = 0; y < m.length; y++) {
      for (var x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        var gx = piece.x + x - xOff;
        var gy = piece.y + y - yOff;
        if (gy < 0) continue; // cells above the visible field
        drawCell(ctx, gx, gy, size, cellStyle(piece.key), 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    var ctx = boardCtx;
    ctx.setTransform(boardDPR, 0, 0, boardDPR, 0, 0);
    ctx.clearRect(0, 0, boardW, boardH);

    // Background + grid lines.
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, boardW, boardH);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (var x = 1; x < COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cell + 0.5, 0);
      ctx.lineTo(x * cell + 0.5, boardH);
      ctx.stroke();
    }
    for (var y = 1; y < ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cell + 0.5);
      ctx.lineTo(boardW, y * cell + 0.5);
      ctx.stroke();
    }

    if (!game) return;

    // Locked cells.
    for (var gy = 0; gy < ROWS; gy++) {
      for (var gx = 0; gx < COLS; gx++) {
        if (game.grid[gy][gx]) {
          drawCell(ctx, gx, gy, cell, cellStyle(game.grid[gy][gx]), 1);
        }
      }
    }

    if (game.piece && !game.gameOver) {
      // Ghost piece at the hard-drop landing position.
      var ghostY = Tetris.getGhostY(game);
      var ghostPiece = {
        key: game.piece.key,
        matrix: game.piece.matrix,
        x: game.piece.x,
        y: ghostY,
        rot: game.piece.rot
      };
      drawPieceCells(ctx, ghostPiece, 0, 0, cell, 0.25);

      // Active piece.
      drawPieceCells(ctx, game.piece, 0, 0, cell, 1);
    }

    drawNext();
    updateHud();
  }

  function drawNext() {
    var ctx = nextCtx;
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 160, 160);
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, 160, 160);
    if (!game || !game.next) return;

    var m = Tetris.SHAPES[game.next].rotations[0];
    // Bounding box of the filled cells.
    var minX = m[0].length, maxX = -1, minY = m.length, maxY = -1;
    for (var y = 0; y < m.length; y++) {
      for (var x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    var w = maxX - minX + 1;
    var h = maxY - minY + 1;
    var n = Math.max(w, h);
    var size = Math.min(30, Math.floor(120 / n));
    var offX = (160 - w * size) / 2;
    var offY = (160 - h * size) / 2;
    ctx.fillStyle = cellStyle(game.next);
    for (var yy = minY; yy <= maxY; yy++) {
      for (var xx = minX; xx <= maxX; xx++) {
        if (!m[yy][xx]) continue;
        ctx.fillRect(offX + (xx - minX) * size + 1, offY + (yy - minY) * size + 1, size - 2, size - 2);
      }
    }
  }

  var lastHud = { score: null, level: null, lines: null };

  function updateHud() {
    var score = game.score;
    var level = game.level;
    var lines = game.lines;
    if (score !== lastHud.score) {
      scoreEl.textContent = String(score);
      lastHud.score = score;
    }
    if (level !== lastHud.level) {
      levelEl.textContent = String(level);
      lastHud.level = level;
    }
    if (lines !== lastHud.lines) {
      linesEl.textContent = String(lines);
      lastHud.lines = lines;
    }
  }

  // ------------------------------------------------------------ game control

  function setPaused(value) {
    paused = value;
    if (paused) {
      gravityAcc = 0;
      lastTime = null;
      overlayTitle.textContent = 'Paused';
      overlayText.textContent = 'Press P or tap the pause button to resume.';
      overlayResume.style.display = '';
      overlay.classList.remove('hidden');
      pauseIcon.textContent = '\u25B6'; // play icon while paused
    } else {
      overlayResume.style.display = 'none';
      overlay.classList.add('hidden');
      pauseIcon.textContent = '\u23F8'; // pause icon while running
    }
  }

  function showGameOver() {
    overlayTitle.textContent = 'Game Over';
    overlayText.textContent = 'Final score: ' + game.score;
    overlayResume.style.display = 'none';
    overlay.classList.remove('hidden');
  }

  function restart() {
    game = Tetris.createGame();
    paused = false;
    gravityAcc = 0;
    lastTime = null;
    lastHud = { score: null, level: null, lines: null };
    overlayResume.style.display = 'none';
    overlay.classList.add('hidden');
    pauseIcon.textContent = '\u23F8';
    draw();
  }

  // ---------------------------------------------------------------- actions

  function actionMove(dx) {
    if (paused || !game || game.gameOver) return;
    Tetris.tryMove(game, dx, 0);
  }

  function actionRotate() {
    if (paused || !game || game.gameOver) return;
    Tetris.tryRotate(game, 1);
  }

  function actionSoft() {
    if (paused || !game || game.gameOver) return;
    gravityAcc = 0;
    if (!Tetris.stepDown(game)) {
      // Locked and a new piece spawned; keep a fresh gravity accumulator.
      gravityAcc = 0;
    }
    if (game.gameOver) showGameOver();
  }

  function actionHard() {
    if (paused || !game || game.gameOver) return;
    Tetris.hardDrop(game);
    gravityAcc = 0;
    if (game.gameOver) showGameOver();
  }

  function actionPause() {
    if (!game || game.gameOver) return;
    setPaused(!paused);
  }

  // ------------------------------------------------------------- game loop

  function frame(now) {
    if (lastTime === null) lastTime = now;
    var dt = Math.min(now - lastTime, MAX_DT);
    lastTime = now;

    if (!paused && game && !game.gameOver) {
      // Held-key auto-repeat (only after the initial delay).
      if (keys.has('ArrowLeft') && holdSince.ArrowLeft !== null) {
        if (now - holdSince.ArrowLeft >= HOLD_DELAY) {
          Tetris.tryMove(game, -1, 0);
          holdSince.ArrowLeft += HOLD_INTERVAL;
        }
      }
      if (keys.has('ArrowRight') && holdSince.ArrowRight !== null) {
        if (now - holdSince.ArrowRight >= HOLD_DELAY) {
          Tetris.tryMove(game, 1, 0);
          holdSince.ArrowRight += HOLD_INTERVAL;
        }
      }
      if (keys.has('ArrowDown') && holdSince.ArrowDown !== null) {
        if (now - holdSince.ArrowDown >= HOLD_DELAY) {
          gravityAcc = 0;
          if (!Tetris.stepDown(game)) gravityAcc = 0;
          holdSince.ArrowDown += HOLD_INTERVAL;
        }
      }

      // Gravity accumulation, gated by paused/gameOver and clamped dt.
      gravityAcc += dt;
      var interval = Tetris.getGravityMs(game.level);
      if (gravityAcc >= interval) {
        gravityAcc = 0;
        Tetris.stepDown(game);
      }
      if (game.gameOver) showGameOver();
    }

    draw();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- input

  function handleKeyDown(e) {
    var code = e.code;
    var handled = true;

    // Always keep Space/Arrows from scrolling the page, even when the game
    // is paused or over.
    if (code === 'Space' || code.indexOf('Arrow') === 0) {
      e.preventDefault();
    }

    if (code === 'KeyP') {
      actionPause();
    } else if (code === 'KeyR') {
      restart();
    } else if (paused || !game || game.gameOver) {
      handled = false;
    } else if (code === 'ArrowLeft') {
      if (e.repeat) return;
      holdSince.ArrowLeft = performance.now();
      keys.add('ArrowLeft');
      actionMove(-1);
    } else if (code === 'ArrowRight') {
      if (e.repeat) return;
      holdSince.ArrowRight = performance.now();
      keys.add('ArrowRight');
      actionMove(1);
    } else if (code === 'ArrowDown') {
      if (e.repeat) return;
      holdSince.ArrowDown = performance.now();
      keys.add('ArrowDown');
      actionSoft();
    } else if (code === 'ArrowUp' || code === 'KeyX') {
      actionRotate();
    } else if (code === 'Space') {
      actionHard();
    } else {
      handled = false;
    }

    if (handled) e.preventDefault();
  }

  function handleKeyUp(e) {
    keys.delete(e.code);
    if (e.code === 'ArrowLeft') holdSince.ArrowLeft = null;
    else if (e.code === 'ArrowRight') holdSince.ArrowRight = null;
    else if (e.code === 'ArrowDown') holdSince.ArrowDown = null;
  }

  function wireButtons() {
    var actions = {
      left: function () { actionMove(-1); },
      right: function () { actionMove(1); },
      rotate: actionRotate,
      soft: actionSoft,
      hard: actionHard,
      pause: actionPause,
      restart: restart
    };
    var buttons = document.querySelectorAll('.controls button[data-action]');
    Array.prototype.forEach.call(buttons, function (btn) {
      var action = actions[btn.getAttribute('data-action')];
      if (!action) return;
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault(); // keep focus/space away from the button
        action();
      });
    });
    overlayResume.addEventListener('click', function () {
      setPaused(false);
    });
    overlayRestart.addEventListener('click', restart);
  }

  // ---------------------------------------------------------------- init

  function init() {
    game = Tetris.createGame();
    wireButtons();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Pause when the tab/window loses focus so gravity cannot run unseen.
    window.addEventListener('blur', function () {
      if (game && !game.gameOver && !paused) setPaused(true);
    });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 80);
    });

    resize();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();