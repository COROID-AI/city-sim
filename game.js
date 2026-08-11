/*
 * game.js — Snake game engine and renderer.
 * Classic browser script (no ES import/export) so `node --check game.js` parses it
 * as a script/CommonJS file. All DOM access is guarded and happens after load.
 */
(function () {
  'use strict';

  /* ---------- Constants ---------- */
  var COLS = 20;
  var ROWS = 20;
  var BASE_INTERVAL_MS = 170;
  var MIN_INTERVAL_MS = 70;
  var SPEED_STEP_MS = 10;
  var FOODS_PER_LEVEL = 3;
  var MAX_LEVEL = 10;
  var HIGH_SCORE_KEY = 'snake-high-score';
  var SWIPE_THRESHOLD_PX = 24;
  var MIN_PLAYFIELD_PX = 120;
  var MAX_PLAYFIELD_PX = 640;
  var VIEWPORT_MARGIN_PX = 16;
  var CHROME_GAP_PX = 32; // headroom between HUD / D-pad and the playfield

  var PALETTE = {
    board: '#0b1220',
    grid: 'rgba(148, 163, 184, 0.12)',
    border: 'rgba(148, 163, 184, 0.35)',
    snakeBody: '#22c55e',
    snakeHead: '#4ade80',
    food: '#f87171'
  };

  /* ---------- Pure helpers (no DOM) ---------- */
  function levelForScore(score) {
    return Math.min(MAX_LEVEL, 1 + Math.floor(score / FOODS_PER_LEVEL));
  }

  function intervalForScore(score) {
    return Math.max(
      MIN_INTERVAL_MS,
      BASE_INTERVAL_MS - (levelForScore(score) - 1) * SPEED_STEP_MS
    );
  }

  function isOpposite(a, b) {
    return (
      (a === 'up' && b === 'down') ||
      (a === 'down' && b === 'up') ||
      (a === 'left' && b === 'right') ||
      (a === 'right' && b === 'left')
    );
  }

  function dirVector(dir) {
    switch (dir) {
      case 'up': return { x: 0, y: -1 };
      case 'down': return { x: 0, y: 1 };
      case 'left': return { x: -1, y: 0 };
      default: return { x: 1, y: 0 };
    }
  }

  /* ---------- Game state ---------- */
  var state = 'start'; // start | playing | paused | gameover
  var snake = [];
  var dir = 'right';
  var dirQueue = [];
  var food = null;
  var score = 0;
  var highScore = 0;
  var won = false;

  /* ---------- Loop / sizing state ---------- */
  var lastTick = 0;
  var acc = 0;
  var rafId = null;
  var touchStart = null;
  var dpr = 1;
  var cellPx = 0;
  var boardPx = 0;

  /* ---------- DOM refs ---------- */
  var canvas;
  var ctx;
  var playfield;
  var hudScore;
  var hudLevel;
  var hudHigh;
  var startOverlay;
  var pauseOverlay;
  var gameoverOverlay;
  var finalScore;
  var finalHighScore;
  var live;

  function $(id) {
    return document.getElementById(id);
  }

  function loadHighScore() {
    try {
      return parseInt(localStorage.getItem(HIGH_SCORE_KEY) || '0', 10) || 0;
    } catch (err) {
      return 0;
    }
  }

  function saveHighScore(value) {
    try {
      localStorage.setItem(HIGH_SCORE_KEY, String(value));
    } catch (err) {
      /* private browsing / storage disabled — ignore */
    }
  }

  function announce(text) {
    if (!live) return;
    live.textContent = '';
    window.setTimeout(function () {
      live.textContent = text;
    }, 20);
  }

  /* ---------- Sizing (finding: responsive canvas, no overflow) ---------- */
  function fitCanvas() {
    var hud = $('hud');
    var dpad = $('dpad');
    var hudH = hud ? hud.offsetHeight : 0;
    var padH = dpad ? dpad.offsetHeight : 0;
    var availW = document.documentElement.clientWidth - VIEWPORT_MARGIN_PX * 2;
    var availH = window.innerHeight - hudH - padH - CHROME_GAP_PX;
    var cssSize = Math.min(availW, availH, MAX_PLAYFIELD_PX);
    cssSize = Math.max(MIN_PLAYFIELD_PX, cssSize);

    cellPx = Math.max(5, Math.floor(cssSize / COLS));
    boardPx = cellPx * COLS;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(boardPx * dpr);
    canvas.height = Math.round(boardPx * dpr);
    canvas.style.width = boardPx + 'px';
    canvas.style.height = boardPx + 'px';
    playfield.style.width = boardPx + 'px';
    playfield.style.height = boardPx + 'px';
  }

  /* ---------- Rendering ---------- */
  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boardPx, boardPx);

    ctx.fillStyle = PALETTE.board;
    ctx.fillRect(0, 0, boardPx, boardPx);

    // Subtle board grid
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 1; x < COLS; x++) {
      ctx.moveTo(x * cellPx + 0.5, 0);
      ctx.lineTo(x * cellPx + 0.5, boardPx);
    }
    for (var y = 1; y < ROWS; y++) {
      ctx.moveTo(0, y * cellPx + 0.5);
      ctx.lineTo(boardPx, y * cellPx + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = PALETTE.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, boardPx - 1, boardPx - 1);

    // Food
    if (food) {
      var fx = food.x * cellPx + cellPx / 2;
      var fy = food.y * cellPx + cellPx / 2;
      ctx.fillStyle = PALETTE.food;
      ctx.beginPath();
      ctx.arc(fx, fy, Math.max(2, cellPx * 0.34), 0, Math.PI * 2);
      ctx.fill();
    }

    // Snake segments (tail first so the head is drawn on top)
    for (var i = snake.length - 1; i >= 0; i--) {
      var seg = snake[i];
      var inset = Math.max(1, Math.floor(cellPx * 0.08));
      ctx.fillStyle = i === 0 ? PALETTE.snakeHead : PALETTE.snakeBody;
      ctx.fillRect(
        seg.x * cellPx + inset,
        seg.y * cellPx + inset,
        cellPx - inset * 2,
        cellPx - inset * 2
      );
    }
  }

  /* ---------- Game logic ---------- */
  function requestDir(d) {
    if (state !== 'playing') return;
    var last = dirQueue.length ? dirQueue[dirQueue.length - 1] : dir;
    if (d === last || isOpposite(d, last)) return;
    if (dirQueue.length < 2) dirQueue.push(d);
  }

  function placeFood() {
    var free = [];
    for (var yy = 0; yy < ROWS; yy++) {
      for (var xx = 0; xx < COLS; xx++) {
        var occupied = false;
        for (var s = 0; s < snake.length; s++) {
          if (snake[s].x === xx && snake[s].y === yy) {
            occupied = true;
            break;
          }
        }
        if (!occupied) free.push({ x: xx, y: yy });
      }
    }
    if (free.length === 0) {
      won = true;
      food = null;
      gameOver();
      return;
    }
    food = free[Math.floor(Math.random() * free.length)];
  }

  function resetGame() {
    var cx = Math.floor(COLS / 2);
    var cy = Math.floor(ROWS / 2);
    snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy }
    ];
    dir = 'right';
    dirQueue = [];
    score = 0;
    won = false;
    placeFood();
  }

  function tick() {
    if (dirQueue.length) dir = dirQueue.shift();
    var v = dirVector(dir);
    var head = snake[0];
    var nHead = { x: head.x + v.x, y: head.y + v.y };

    // Wall collision
    if (nHead.x < 0 || nHead.x >= COLS || nHead.y < 0 || nHead.y >= ROWS) {
      gameOver();
      return;
    }

    var eating = !!food && nHead.x === food.x && nHead.y === food.y;
    // When not eating, the tail segment moves away this tick, so it is safe to overlap.
    var body = eating ? snake : snake.slice(0, -1);
    for (var i = 0; i < body.length; i++) {
      if (body[i].x === nHead.x && body[i].y === nHead.y) {
        gameOver();
        return;
      }
    }

    snake.unshift(nHead);
    if (eating) {
      score++;
      updateHud();
      if (score % FOODS_PER_LEVEL === 0) {
        announce('Speed up! Level ' + levelForScore(score) + '.');
      } else {
        announce('Score ' + score + '.');
      }
      if (snake.length === COLS * ROWS) {
        won = true;
        gameOver();
        return;
      }
      placeFood();
    } else {
      snake.pop();
    }
  }

  function gameOver() {
    state = 'gameover';
    if (score > highScore) {
      highScore = score;
      saveHighScore(highScore);
    }
    updateHud();
    finalScore.textContent = String(score);
    finalHighScore.textContent = String(highScore);
    showOverlay('gameover');
    if (won) {
      announce('You cleared the board! Final score ' + score + '.');
    } else {
      announce('Game over. Final score ' + score + '. High score ' + highScore + '.');
    }
    won = false;
  }

  /* ---------- State machine ---------- */
  function startGame() {
    if (state === 'playing') return;
    resetGame();
    state = 'playing';
    showOverlay(null);
    announce('Game started. Good luck!');
    updateHud();
    playfield.focus({ preventScroll: true });
  }

  function pauseGame() {
    state = 'paused';
    showOverlay('pause');
    announce('Game paused.');
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    showOverlay(null);
    announce('Game resumed.');
    playfield.focus({ preventScroll: true });
  }

  function showOverlay(name) {
    startOverlay.hidden = name !== 'start';
    pauseOverlay.hidden = name !== 'pause';
    gameoverOverlay.hidden = name !== 'gameover';
    if (name === 'start') $('btnStart').focus();
    else if (name === 'pause') $('btnResume').focus();
    else if (name === 'gameover') $('btnRestart').focus();
  }

  function updateHud() {
    hudScore.textContent = String(score);
    hudLevel.textContent = String(levelForScore(score));
    hudHigh.textContent = String(highScore);
  }

  /* ---------- Input (finding: window keydown for reliable steering) ---------- */
  function onKeyDown(e) {
    var key = e.key;
    var mapped = null;

    if (key === 'ArrowUp' || key === 'w' || key === 'W') mapped = 'up';
    else if (key === 'ArrowDown' || key === 's' || key === 'S') mapped = 'down';
    else if (key === 'ArrowLeft' || key === 'a' || key === 'A') mapped = 'left';
    else if (key === 'ArrowRight' || key === 'd' || key === 'D') mapped = 'right';

    if (mapped) {
      e.preventDefault();
      if (state === 'playing') requestDir(mapped);
      return;
    }

    if (key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      if (state === 'start' || state === 'gameover') startGame();
      else if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
    } else if (key === 'Enter') {
      if (state === 'start' || state === 'gameover') {
        e.preventDefault();
        startGame();
      } else if (state === 'paused') {
        e.preventDefault();
        resumeGame();
      }
    }
  }

  /* ---------- Touch input (swipe) ---------- */
  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }

  function onTouchMove(e) {
    // Keep swipe gestures from scrolling the page while playing.
    if (state === 'playing') e.preventDefault();
  }

  function onTouchEnd(e) {
    if (!touchStart || e.changedTouches.length !== 1) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchStart.x;
    var dy = t.clientY - touchStart.y;
    var absX = Math.abs(dx);
    var absY = Math.abs(dy);
    touchStart = null;
    if (Math.max(absX, absY) < SWIPE_THRESHOLD_PX) return;
    requestDir(
      absX > absY ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
    );
  }

  /* ---------- Main loop ---------- */
  function loop(now) {
    var elapsed = now - lastTick;
    lastTick = now;

    if (state === 'playing') {
      acc += elapsed;
      var interval = intervalForScore(score);
      while (acc >= interval) {
        tick();
        acc -= interval;
        if (state !== 'playing') break;
      }
    }

    render();
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- Boot (guarded DOM access) ---------- */
  function init() {
    canvas = $('canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    playfield = $('playfield');
    hudScore = $('hudScore');
    hudLevel = $('hudLevel');
    hudHigh = $('hudHigh');
    startOverlay = $('startOverlay');
    pauseOverlay = $('pauseOverlay');
    gameoverOverlay = $('gameoverOverlay');
    finalScore = $('finalScore');
    finalHighScore = $('finalHighScore');
    live = $('liveRegion');

    highScore = loadHighScore();

    $('btnStart').addEventListener('click', startGame);
    $('btnResume').addEventListener('click', resumeGame);
    $('btnRestart').addEventListener('click', startGame);
    ['up', 'down', 'left', 'right'].forEach(function (d) {
      var id = 'btn' + d.charAt(0).toUpperCase() + d.slice(1);
      $(id).addEventListener('click', function () {
        requestDir(d);
      });
    });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', fitCanvas);
    window.addEventListener('orientationchange', fitCanvas);

    playfield.addEventListener('touchstart', onTouchStart, { passive: true });
    playfield.addEventListener('touchmove', onTouchMove, { passive: false });
    playfield.addEventListener('touchend', onTouchEnd, { passive: true });

    fitCanvas();
    updateHud();
    showOverlay('start');
    render();
    lastTick = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  if (typeof document === 'undefined') return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();