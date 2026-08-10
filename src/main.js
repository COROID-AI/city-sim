// Browser entry point: wires game <-> renderer <-> input and runs the rAF loop
// with gravity timing. This is the only module allowed to touch page elements
// beyond renderer.js / input.js.

import { Game, STATUS } from './game.js';
import { createRenderer } from './renderer.js';
import { attachInput } from './input.js';

const boardCanvas = document.getElementById('board-canvas');
const holdCanvas = document.getElementById('hold-canvas');
const nextCanvas = document.getElementById('next-canvas');
const holdPanel = document.getElementById('hold-panel');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMessage = document.getElementById('overlay-message');
const overlayBtn = document.getElementById('overlay-btn');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const boardFrame = document.querySelector('.board-frame');

const game = new Game();
const renderer = createRenderer({ boardCanvas, holdCanvas, nextCanvas });

// --- Overlay ----------------------------------------------------------------
function showOverlay(title, message, buttonLabel) {
  overlayTitle.textContent = title;
  overlayMessage.textContent = message;
  overlayBtn.textContent = buttonLabel;
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}

function hideOverlay() {
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
}

function startGame() {
  game.start();
  hideOverlay();
  boardCanvas.focus();
}

function syncOverlay(state) {
  if (state.status === STATUS.READY) {
    showOverlay(
      'TETRIS',
      'Arrows move · Space hard-drops · Z/X rotate · C holds · P pauses. Press Enter or click Start.',
      'Start Game',
    );
  } else if (state.status === STATUS.OVER) {
    showOverlay(
      'Game Over',
      `Final score ${state.score} · ${state.lines} lines · level ${state.level}. Press Enter to play again.`,
      'Play Again',
    );
  } else if (state.status === STATUS.PAUSED) {
    showOverlay('Paused', 'Press P, Esc or click Resume.', 'Resume');
  } else {
    hideOverlay();
  }
}

// --- HUD --------------------------------------------------------------------
function updateHud(state) {
  scoreEl.textContent = String(state.score);
  linesEl.textContent = String(state.lines);
  levelEl.textContent = String(state.level);
  pauseBtn.textContent = state.status === STATUS.PAUSED ? 'Resume' : 'Pause';
  pauseBtn.disabled = state.status === STATUS.READY || state.status === STATUS.OVER;
  holdPanel.classList.toggle('hold-locked', !state.canHold);
}

let lastClear = 0;
function handleFlash(state) {
  if (state.lastClear > 0 && state.lastClear !== lastClear) {
    boardFrame.classList.remove('line-flash');
    // Restart the CSS animation even on consecutive clears.
    void boardFrame.offsetWidth;
    boardFrame.classList.add('line-flash');
  }
  lastClear = state.lastClear;
}

// --- Input ------------------------------------------------------------------
attachInput({
  moveLeft: () => game.moveLeft(),
  moveRight: () => game.moveRight(),
  softDrop: () => game.softDrop(),
  rotateCW: () => game.rotateCW(),
  rotateCCW: () => game.rotateCCW(),
  hardDrop: () => game.hardDrop(),
  hold: () => game.holdPiece(),
  togglePause: () => {
    if (game.status === STATUS.RUNNING || game.status === STATUS.PAUSED) game.togglePause();
  },
  startOrRestart: () => {
    if (game.status === STATUS.READY || game.status === STATUS.OVER) startGame();
    else if (game.status === STATUS.PAUSED) game.resume();
  },
});

startBtn.addEventListener('click', startGame);
pauseBtn.addEventListener('click', () => game.togglePause());
overlayBtn.addEventListener('click', () => {
  if (game.status === STATUS.READY || game.status === STATUS.OVER) startGame();
  else if (game.status === STATUS.PAUSED) game.resume();
});
boardCanvas.addEventListener('pointerdown', () => boardCanvas.focus());

// --- Main loop --------------------------------------------------------------
let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min(now - last, 250);
  last = now;

  if (game.status === STATUS.RUNNING) {
    acc += dt;
    const g = game.gravityMs();
    let guard = 0;
    while (acc >= g && game.status === STATUS.RUNNING && guard < 4) {
      game.step();
      acc -= g;
      guard++;
    }
    if (game.status !== STATUS.RUNNING) acc = 0;
  } else {
    acc = 0;
  }

  const state = game.getState();
  syncOverlay(state);
  updateHud(state);
  handleFlash(state);
  renderer.draw(state);
  requestAnimationFrame(frame);
}

// Initial ready screen.
syncOverlay(game.getState());
updateHud(game.getState());
renderer.draw(game.getState());
requestAnimationFrame(frame);