/*!
 * Snake — a classic browser snake game.
 * Classic (non-module) IIFE so it runs over http:// and directly via file://.
 */
(function () {
  "use strict";

  /* ----------------------------- Grid / rules ----------------------------- */
  var COLS = 24;
  var ROWS = 24;
  var BASE_INTERVAL = 150; // ms per step at the start
  var MIN_INTERVAL = 55; // speed-up floor so the game never becomes unplayable
  var SPEED_BY_FOOD = 6; // ms shaved off the interval per food eaten

  /* ------------------------------- Elements ------------------------------- */
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var speedEl = document.getElementById("speed");
  var statusEl = document.getElementById("status");

  var overlayStart = document.getElementById("overlay-start");
  var overlayPaused = document.getElementById("overlay-paused");
  var overlayGameover = document.getElementById("overlay-gameover");
  var finalScoreEl = document.getElementById("final-score");
  var finalBestEl = document.getElementById("final-best");

  var btnStart = document.getElementById("btn-start");
  var btnResume = document.getElementById("btn-resume");
  var btnRestart = document.getElementById("btn-restart");
  var btnPause = document.getElementById("btn-pause");

  /* ------------------------------ Game state ------------------------------ */
  var state = "start"; // start | playing | paused | gameover
  var snake = [];
  var dir = { x: 1, y: 0 }; // last APPLIED direction
  var pendingDir = { x: 1, y: 0 }; // direction for the next step
  var inputQueue = []; // queued direction changes (FIFO)
  var food = null;
  var score = 0;
  var best = 0;
  var interval = BASE_INTERVAL;
  var timer = null;
  var cell = 0; // px per cell, recomputed on resize

  /* ------------------------- Safe localStorage ---------------------------- */
  // localStorage can throw (e.g. blocked on file:// or in strict privacy
  // modes). Wrap every access so persistence degrades gracefully instead of
  // breaking the game.
  var storage = (function () {
    var available = false;
    var testKey = "__snake_test__";
    try {
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      available = true;
    } catch (e) {
      available = false;
    }
    return {
      available: available,
      get: function (key) {
        if (!available) return null;
        try {
          return window.localStorage.getItem(key);
        } catch (e) {
          return null;
        }
      },
      set: function (key, value) {
        if (!available) return;
        try {
          window.localStorage.setItem(key, value);
        } catch (e) {
          /* ignore */
        }
      }
    };
  })();

  var BEST_KEY = "snake.best";

  /* ------------------------- High-DPI aware canvas ------------------------ */
  function resize() {
    var wrap = canvas.parentElement;
    var width = wrap.clientWidth;
    var height = wrap.clientHeight;
    var dpr = window.devicePixelRatio || 1;
    var pxW = Math.max(1, Math.round(width * dpr));
    var pxH = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Recompute cell size from the logical (CSS px) drawing area.
    cell = Math.floor(Math.min(width / COLS, height / ROWS));
    render();
  }

  /* --------------------------------- Input -------------------------------- */
  var DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  function isOpposite(a, b) {
    return a.x === -b.x && a.y === -b.y;
  }

  // Queue a direction change. Validation happens against the LAST APPLIED
  // direction (not the newest queued one), and each new request is validated
  // against the tail of the queue. This prevents quick double key presses from
  // reversing the snake onto itself or skipping a needed turn.
  function queueDirection(d) {
    if (!d) return;
    var last = inputQueue.length > 0 ? inputQueue[inputQueue.length - 1] : dir;
    if (isOpposite(d, last)) return; // ignore 180-degree reversals
    if (inputQueue.length < 3) {
      inputQueue.push(d);
    }
  }

  function setDirection(d) {
    if (!d) return;
    // Immediate validation against the last applied direction.
    if (isOpposite(d, dir)) return;
    pendingDir = d;
    queueDirection(d);
  }

  function handleKeyboard(e) {
    var key = e.key;
    var handled = true;
    var d = null;

    if (key === "ArrowUp" || key === "w" || key === "W") d = DIRS.up;
    else if (key === "ArrowDown" || key === "s" || key === "S") d = DIRS.down;
    else if (key === "ArrowLeft" || key === "a" || key === "A") d = DIRS.left;
    else if (key === "ArrowRight" || key === "d" || key === "D") d = DIRS.right;
    else if (key === "p" || key === "P") {
      if (state === "playing") pause();
      else if (state === "paused") resume();
    } else if (key === " ") {
      // Space: start / resume / pause depending on state.
      if (state === "start") startGame();
      else if (state === "gameover") startGame();
      else if (state === "playing") pause();
      else if (state === "paused") resume();
    } else if (key === "Enter") {
      if (state === "start" || state === "gameover") startGame();
    } else {
      handled = false;
    }

    if (handled) {
      e.preventDefault(); // stop arrows/space from scrolling the page
    }

    if (d) setDirection(d);
  }

  function handleTouchStart(x, y) {
    var wrap = canvas.parentElement;
    var rect = wrap.getBoundingClientRect();
    var dx = x - (rect.left + rect.width / 2);
    var dy = y - (rect.top + rect.height / 2);
    if (Math.abs(dx) > Math.abs(dy)) {
      setDirection(dx > 0 ? DIRS.right : DIRS.left);
    } else {
      setDirection(dy > 0 ? DIRS.down : DIRS.up);
    }
  }

  /* ------------------------------- Game flow ------------------------------ */
  function resetGame() {
    snake = [
      { x: 7, y: 12 },
      { x: 6, y: 12 },
      { x: 5, y: 12 }
    ];
    dir = { x: 1, y: 0 };
    pendingDir = { x: 1, y: 0 };
    inputQueue = [];
    score = 0;
    interval = BASE_INTERVAL;
    food = spawnFood();
    updateHud();
  }

  function startGame() {
    resetGame();
    state = "playing";
    showOverlay(null);
    setStatus("Playing");
    scheduleStep();
  }

  function pause() {
    if (state !== "playing") return;
    state = "paused";
    clearTimeout(timer);
    timer = null;
    showOverlay(overlayPaused);
    setStatus("Paused");
  }

  function resume() {
    if (state !== "playing" && state !== "paused") return;
    state = "playing";
    showOverlay(null);
    setStatus("Playing");
    scheduleStep();
  }

  function gameOver() {
    state = "gameover";
    clearTimeout(timer);
    timer = null;
    if (score > best) {
      best = score;
      storage.set(BEST_KEY, String(best));
    }
    finalScoreEl.textContent = String(score);
    finalBestEl.textContent = String(best);
    bestEl.textContent = String(best);
    showOverlay(overlayGameover);
    setStatus("Game over");
  }

  /* -------------------------------- Stepping ------------------------------ */
  function scheduleStep() {
    clearTimeout(timer);
    timer = setTimeout(step, interval);
  }

  // Apply the next queued direction (validated against the last applied one).
  function applyNextDirection() {
    if (inputQueue.length === 0) return;
    var next = inputQueue.shift();
    // Re-check against the current applied direction; ignore reversals.
    if (!isOpposite(next, dir)) {
      dir = next;
      pendingDir = next;
    }
  }

  function step() {
    if (state !== "playing") return;

    applyNextDirection();

    var head = snake[0];
    var nx = head.x + dir.x;
    var ny = head.y + dir.y;

    // Wall collision.
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      gameOver();
      render();
      return;
    }

    var nextHead = { x: nx, y: ny };
    var willGrow = food && nextHead.x === food.x && nextHead.y === food.y;

    // Body collision — ignore the tail cell that will move away unless growing.
    var bodyToCheck = willGrow ? snake : snake.slice(0, snake.length - 1);
    for (var i = 0; i < bodyToCheck.length; i++) {
      if (bodyToCheck[i].x === nextHead.x && bodyToCheck[i].y === nextHead.y) {
        gameOver();
        render();
        return;
      }
    }

    snake.unshift(nextHead);
    if (willGrow) {
      score += 1;
      // Bounded speed-up: shave time per food but never below MIN_INTERVAL.
      interval = Math.max(MIN_INTERVAL, BASE_INTERVAL - score * SPEED_BY_FOOD);
      food = spawnFood();
      updateHud();
    } else {
      snake.pop();
    }

    render();
    scheduleStep();
  }

  function spawnFood() {
    var free = [];
    var occupied = {};
    for (var i = 0; i < snake.length; i++) {
      occupied[snake[i].x + "," + snake[i].y] = true;
    }
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (!occupied[x + "," + y]) free.push({ x: x, y: y });
      }
    }
    if (free.length === 0) return null; // board full — player wins
    return free[Math.floor(Math.random() * free.length)];
  }

  /* --------------------------------- HUD ---------------------------------- */
  function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    var speedLevel = Math.max(1, Math.round((BASE_INTERVAL - interval) / SPEED_BY_FOOD) + 1);
    speedEl.textContent = String(speedLevel);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function showOverlay(overlay) {
    overlayStart.classList.toggle("hidden", overlay !== overlayStart);
    overlayPaused.classList.toggle("hidden", overlay !== overlayPaused);
    overlayGameover.classList.toggle("hidden", overlay !== overlayGameover);
    if (overlay) {
      var btn = overlay.querySelector("button");
      if (btn) btn.focus();
    }
  }

  /* -------------------------------- Rendering ----------------------------- */
  function render() {
    var width = canvas.parentElement.clientWidth;
    var height = canvas.parentElement.clientHeight;
    if (cell <= 0) cell = Math.floor(Math.min(width / COLS, height / ROWS));
    var ox = Math.floor((width - cell * COLS) / 2);
    var oy = Math.floor((height - cell * ROWS) / 2);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#141a2e";
    ctx.fillRect(0, 0, width, height);

    // Grid checkerboard.
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#1b2240" : "#181f38";
        ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      }
    }

    // Food.
    if (food) {
      ctx.fillStyle = "#ff5c7a";
      var fx = ox + food.x * cell;
      var fy = oy + food.y * cell;
      ctx.beginPath();
      ctx.arc(fx + cell / 2, fy + cell / 2, cell * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }

    // Snake.
    for (var i = snake.length - 1; i >= 0; i--) {
      var s = snake[i];
      var isHead = i === 0;
      ctx.fillStyle = isHead ? "#b6ffd9" : "#39e08a";
      var pad = isHead ? cell * 0.06 : cell * 0.12;
      var sx = ox + s.x * cell + pad;
      var sy = oy + s.y * cell + pad;
      var size = cell - pad * 2;
      ctx.beginPath();
      ctx.roundRect(sx, sy, size, size, isHead ? cell * 0.18 : cell * 0.14);
      ctx.fill();
    }
  }

  /* ------------------------------ Event wiring ---------------------------- */
  btnStart.addEventListener("click", startGame);
  btnRestart.addEventListener("click", startGame);
  btnResume.addEventListener("click", resume);
  btnPause.addEventListener("click", function () {
    if (state === "playing") pause();
    else if (state === "paused") resume();
  });

  window.addEventListener("keydown", handleKeyboard);

  // Touch swipe on the canvas.
  var touchStart = null;
  canvas.addEventListener(
    "touchstart",
    function (e) {
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      e.preventDefault();
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchmove",
    function (e) {
      e.preventDefault();
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchend",
    function (e) {
      if (!touchStart) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - touchStart.x;
      var dy = t.clientY - touchStart.y;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return; // tap, ignore
      handleTouchStart(t.clientX, t.clientY);
      touchStart = null;
    },
    { passive: true }
  );

  // On-screen D-pad.
  var dpadBtns = document.querySelectorAll(".dpad-btn");
  for (var i = 0; i < dpadBtns.length; i++) {
    dpadBtns[i].addEventListener("click", function () {
      var d = DIRS[this.getAttribute("data-dir")];
      if (d) setDirection(d);
    });
  }

  // Auto-pause when the tab loses focus.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "playing") pause();
  });

  window.addEventListener("resize", resize);

  /* -------------------------------- Init ---------------------------------- */
  (function init() {
    var stored = storage.get(BEST_KEY);
    best = stored ? parseInt(stored, 10) || 0 : 0;
    resetGame();
    resize();
    setStatus("Ready");
  })();
})();
